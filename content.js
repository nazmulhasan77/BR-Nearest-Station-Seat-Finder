/* content.js -- injects the "nearest station" finder panel into eticket.railway.gov.bd
   and drives the search: plan -> API queries (via the background worker) -> results list. */
(function () {
  'use strict';
  if (window.__brSeatFinderLoaded) return;
  window.__brSeatFinderLoaded = true;

  var S = window.BR.stations;
  var P = window.BR.planner;
  var F = window.BR.finder;
  var GEO = window.BR.geo;

  var DEFAULTS = {
    hops: 2,               // stations before/after to consider
    maxDetourKm: 60,       // ignore alternatives further than this by road
    geoCount: 3,           // purely distance-based neighbours to add
    maxPairs: 14,          // how many station pairs to query
    dateOffsets: [0],      // 0 = journey day only; -1/+1/+2 add nearby days
    onlyMyClass: false,
    autoRun: true,
    refreshSec: 0,         // 0 = no auto refresh
    notify: true,
    seatClass: '',         // '' = use the class from the URL
    nameOverrides: {}      // { 'TEJ': 'Tejgaon' }  -- user fixes for station spellings
  };

  var settings = Object.assign({}, DEFAULTS);
  var creds = null;
  var route = null;
  var running = false;
  var refreshTimer = null;
  var lastKeySet = Object.create(null);
  var lastRunAt = 0;
  var hasRunBefore = false;
  var port = null;

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function cleanLs(v) {
    if (v == null) return '';
    var s = String(v).trim();
    if (/^".*"$/.test(s)) { try { s = JSON.parse(s); } catch (e) { /* keep */ } }
    return String(s).trim();
  }

  function readCreds() {
    try {
      return {
        token: cleanLs(localStorage.getItem('token')),
        uudid: cleanLs(localStorage.getItem('uudid')),
        ssdk: cleanLs(localStorage.getItem('ssdk'))
      };
    } catch (e) { return { token: '', uudid: '', ssdk: '' }; }
  }

  function siteNameFor(station) {
    var ov = settings.nameOverrides || {};
    if (ov[station.code]) return ov[station.code];
    return S.siteName(station);
  }

  function detectRoute() {
    var u = new URL(location.href);
    var g = function (k) { return u.searchParams.get(k); };
    var r = {
      fromRaw: g('fromcity') || g('from_city') || '',
      toRaw: g('tocity') || g('to_city') || '',
      doj: g('doj') || g('date_of_journey') || '',
      seatClass: g('class') || g('seat_class') || ''
    };
    if (!r.fromRaw || !r.toRaw) {
      var fi = document.querySelector('#dest_from, input[name="dest_from"], input[formcontrolname="fromcity"]');
      var ti = document.querySelector('#dest_to, input[name="dest_to"], input[formcontrolname="tocity"]');
      if (fi && !r.fromRaw) r.fromRaw = fi.value || '';
      if (ti && !r.toRaw) r.toRaw = ti.value || '';
    }
    if (!r.doj) {
      var di = document.querySelector('#doj, input[name="doj"], input[formcontrolname="doj"]');
      if (di) r.doj = di.value || '';
    }
    if (!r.seatClass) {
      var ci = document.querySelector('#choose_class, select[formcontrolname="class"]');
      if (ci) r.seatClass = ci.value || '';
    }
    if (!r.doj) {
      var d = new Date();
      r.doj = P.formatDoj(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
    }
    if (settings.seatClass) r.seatClass = settings.seatClass;
    r.from = S.resolve(r.fromRaw);
    r.to = S.resolve(r.toRaw);
    return r;
  }

  function searchUrl(fromName, toName, doj, cls) {
    var p = new URLSearchParams();
    p.set('fromcity', fromName);
    p.set('tocity', toName);
    p.set('doj', doj);
    if (cls) p.set('class', cls);
    return '/booking/train/search?' + p.toString();
  }

  function notify(title, message) {
    if (!settings.notify) return;
    try {
      chrome.runtime.sendMessage({ type: 'BR_NOTIFY', title: title, message: message });
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* panel (shadow DOM so the site's CSS cannot touch it)                */
  /* ------------------------------------------------------------------ */

  var host = null, root = null, ui = {};

  var CSS = [
    '.brsf{position:fixed;right:16px;bottom:16px;width:392px;max-width:calc(100vw - 24px);',
    'z-index:2147483000;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
    'color:#0f172a;--acc:#0d7a5f;}',
    '.brsf *{box-sizing:border-box;}',
    '.brsf-box{background:#fff;border-radius:14px;border:1px solid #d8e0e6;',
    'box-shadow:0 12px 34px rgba(15,23,42,.22);overflow:hidden;}',
    '.brsf-head{display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:default;',
    'background:linear-gradient(180deg,#0d7a5f,#0a6250);color:#fff;}',
    '.brsf-head h3{margin:0;font-size:13.5px;font-weight:700;letter-spacing:.2px;flex:1;}',
    '.brsf-head .brsf-sub{font-size:11px;opacity:.85;font-weight:400;display:block;}',
    '.brsf-btn{border:0;background:rgba(255,255,255,.16);color:#fff;border-radius:7px;padding:4px 9px;',
    'font-size:12px;cursor:pointer;font-weight:600;}',
    '.brsf-btn:hover{background:rgba(255,255,255,.3);}',
    '.brsf-btn:disabled{opacity:.5;cursor:default;}',
    '.brsf-btn.primary{background:#fff;color:#0a6250;}',
    '.brsf-body{max-height:min(62vh,560px);overflow:auto;padding:10px 11px 12px;}',
    '.brsf-route{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:9px;}',
    '.chip{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:2px 9px;font-size:11.5px;color:#334155;}',
    '.chip.acc{background:#e8f6f1;border-color:#bfe3d6;color:#0a6250;font-weight:600;}',
    '.brsf-opts{display:flex;flex-wrap:wrap;gap:10px;margin:2px 0 10px;font-size:11.5px;color:#475569;}',
    '.brsf-opts label{display:flex;align-items:center;gap:4px;cursor:pointer;}',
    '.brsf-opts select,.brsf-opts input[type=number]{font-size:11.5px;padding:1px 3px;border:1px solid #cbd5e1;border-radius:5px;}',
    '.brsf-bar{height:6px;background:#eef2f5;border-radius:99px;overflow:hidden;margin:6px 0 10px;}',
    '.brsf-bar span{display:block;height:100%;background:linear-gradient(90deg,#14b8a6,#0d7a5f);width:0;transition:width .2s;}',
    '.brsf-msg{font-size:12px;color:#475569;background:#f8fafc;border:1px solid #e6ecf1;border-radius:8px;padding:7px 9px;margin-bottom:9px;}',
    '.brsf-msg.err{background:#fef2f2;border-color:#fecaca;color:#991b1b;}',
    '.brsf-msg.ok{background:#ecfdf5;border-color:#a7f3d0;color:#065f46;}',
    '.row{border:1px solid #e6ecf1;border-radius:10px;padding:8px 9px;margin-bottom:7px;background:#fff;}',
    '.row.exact{border-color:#0d7a5f;background:#f4fdfa;}',
    '.row-hd{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;}',
    '.train{font-weight:700;font-size:13px;color:#0f172a;}',
    '.dep{font-size:11.5px;color:#64748b;}',
    '.pair{font-size:12.5px;color:#0f172a;margin:3px 0 5px;font-weight:600;}',
    '.pair .arrow{color:#94a3b8;font-weight:400;padding:0 3px;}',
    '.badges{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px;}',
    '.badge{font-size:10.5px;border-radius:5px;padding:1px 6px;border:1px solid #dbe3ea;background:#f8fafc;color:#475569;}',
    '.badge.good{background:#ecfdf5;border-color:#a7f3d0;color:#047857;}',
    '.badge.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;}',
    '.badge.info{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}',
    '.seats{display:flex;gap:5px;flex-wrap:wrap;align-items:center;}',
    '.seat{background:#0d7a5f;color:#fff;border-radius:6px;padding:2px 7px;font-size:11.5px;font-weight:700;}',
    '.seat.alt{background:#64748b;}',
    '.seat .n{opacity:.8;font-weight:500;font-size:10.5px;margin-left:3px;}',
    '.row-ft{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;}',
    '.fare{font-size:11px;color:#64748b;}',
    '.open{border:1px solid #0d7a5f;background:#fff;color:#0a6250;border-radius:7px;padding:3px 10px;',
    'font-size:11.5px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;}',
    '.open:hover{background:#0d7a5f;color:#fff;}',
    '.brsf-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 11px;',
    'border-top:1px solid #eef2f5;background:#fbfdfe;font-size:11px;color:#64748b;}',
    '.brsf-foot a{color:#0a6250;cursor:pointer;text-decoration:underline;}',
    '.empty{text-align:center;color:#64748b;font-size:12px;padding:14px 6px;}',
    '.link{color:#0a6250;cursor:pointer;text-decoration:underline;}'
  ].join('\n');

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildPanel() {
    host = document.createElement('div');
    host.className = 'brsf';
    host.id = 'br-seat-finder-root';
    root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var box = el('div', 'brsf-box');
    var head = el('div', 'brsf-head');
    head.innerHTML =
      '<h3>Nearest-station finder' +
      '<span class="brsf-sub" id="brsf-sub">checking nearby stations…</span></h3>' +
      '<button class="brsf-btn" id="brsf-refresh" title="Run now">Find seats</button>' +
      '<button class="brsf-btn" id="brsf-toggle" title="Collapse">–</button>' +
      '<button class="brsf-btn" id="brsf-close" title="Hide">×</button>';
    box.appendChild(head);

    var body = el('div', 'brsf-body');
    var routeBox = el('div', 'brsf-route');
    body.appendChild(routeBox);
    var opts = el('div', 'brsf-opts');
    body.appendChild(opts);
    var bar = el('div', 'brsf-bar');
    bar.style.display = 'none';
    bar.appendChild(el('span'));
    body.appendChild(bar);
    var msg = el('div', 'brsf-msg');
    msg.style.display = 'none';
    body.appendChild(msg);
    var list = el('div', 'brsf-list');
    body.appendChild(list);
    box.appendChild(body);

    var foot = el('div', 'brsf-foot');
    foot.innerHTML = '<span id="brsf-stats"></span><span>' +
      '<a id="brsf-opts-link">Settings</a></span>';
    box.appendChild(foot);

    root.appendChild(box);
    (document.body || document.documentElement).appendChild(host);

    ui = {
      sub: root.getElementById('brsf-sub'),
      refreshBtn: root.getElementById('brsf-refresh'),
      toggleBtn: root.getElementById('brsf-toggle'),
      closeBtn: root.getElementById('brsf-close'),
      body: body,
      route: routeBox,
      opts: opts,
      bar: bar,
      barFill: bar.firstChild,
      msg: msg,
      list: list,
      stats: root.getElementById('brsf-stats'),
      optsLink: root.getElementById('brsf-opts-link')
    };

    ui.refreshBtn.addEventListener('click', function () { run(true); });
    ui.closeBtn.addEventListener('click', function () { host.style.display = 'none'; });
    ui.toggleBtn.addEventListener('click', function () {
      var hidden = ui.body.style.display === 'none';
      ui.body.style.display = hidden ? '' : 'none';
      ui.toggleBtn.textContent = hidden ? '–' : '+';
    });
    ui.optsLink.addEventListener('click', function () {
      try { chrome.runtime.sendMessage({ type: 'BR_OPEN_OPTIONS' }); } catch (e) { }
    });
  }

  function setMsg(text, kind) {
    if (!text) { ui.msg.style.display = 'none'; return; }
    ui.msg.style.display = '';
    ui.msg.className = 'brsf-msg' + (kind ? ' ' + kind : '');
    ui.msg.innerHTML = text;
  }

  function renderRoute() {
    if (!route) return;
    var chips = [];
    chips.push('<span class="chip acc">' + esc(route.from ? route.from.name : route.fromRaw) + '</span>');
    chips.push('<span class="chip">→</span>');
    chips.push('<span class="chip acc">' + esc(route.to ? route.to.name : route.toRaw) + '</span>');
    chips.push('<span class="chip">' + esc(route.doj) + '</span>');
    if (route.seatClass) chips.push('<span class="chip">' + esc(route.seatClass) + '</span>');
    if (!route.from || !route.to) {
      chips.push('<span class="chip" style="border-color:#fecaca;color:#b91c1c">station not in local data</span>');
    }
    ui.route.innerHTML = chips.join(' ');
  }

  function renderOpts() {
    ui.opts.innerHTML =
      '<label>hops ' + sel('hops', [1, 2, 3], settings.hops) + '</label>' +
      '<label>max detour ' + num('maxDetourKm', settings.maxDetourKm, 5, 300, 5) + ' km</label>' +
      '<label>pairs ' + num('maxPairs', settings.maxPairs, 3, 40, 1) + '</label>' +
      '<label><input type="checkbox" id="brsf-d1"' + (settings.dateOffsets.indexOf(-1) >= 0 ? ' checked' : '') + '> −1 day</label>' +
      '<label><input type="checkbox" id="brsf-d2"' + (settings.dateOffsets.indexOf(1) >= 0 ? ' checked' : '') + '> +1 day</label>' +
      '<label><input type="checkbox" id="brsf-d3"' + (settings.dateOffsets.indexOf(2) >= 0 ? ' checked' : '') + '> +2 days</label>' +
      '<label><input type="checkbox" id="brsf-oc"' + (settings.onlyMyClass ? ' checked' : '') + '> only my class</label>';

    ui.opts.querySelectorAll('select,input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (inp.id === 'brsf-d1') toggleOffset(-1, inp.checked);
        else if (inp.id === 'brsf-d2') toggleOffset(1, inp.checked);
        else if (inp.id === 'brsf-d3') toggleOffset(2, inp.checked);
        else if (inp.id === 'brsf-oc') { settings.onlyMyClass = inp.checked; }
        else if (inp.dataset.k === 'hops') settings.hops = parseInt(inp.value, 10);
        else if (inp.dataset.k === 'maxDetourKm') settings.maxDetourKm = parseInt(inp.value, 10);
        else if (inp.dataset.k === 'maxPairs') settings.maxPairs = parseInt(inp.value, 10);
        saveSettings();
        run(true);
      });
    });
  }

  function sel(k, values, current) {
    return '<select data-k="' + k + '">' + values.map(function (v) {
      return '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>' + v + '</option>';
    }).join('') + '</select>';
  }
  function num(k, current, min, max, step) {
    return '<input type="number" data-k="' + k + '" value="' + current + '" min="' + min + '" max="' + max + '" step="' + step + '" style="width:52px">';
  }
  function toggleOffset(off, on) {
    var s = settings.dateOffsets.filter(function (d) { return d !== off; });
    if (on) s.push(off);
    settings.dateOffsets = s.sort(function (a, b) { return a - b; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------ */
  /* the search                                                          */
  /* ------------------------------------------------------------------ */

  function run(manual) {
    if (running) return;
    route = detectRoute();
    renderRoute();
    renderOpts();

    if (!route.from || !route.to) {
      setMsg('Could not match <b>' + esc(route.fromRaw || '?') + '</b> / <b>' + esc(route.toRaw || '?') +
        '</b> to a station in the bundled timetable. Add the right spelling in <span class="link" id="brsf-fix">Settings → station name overrides</span>.', 'err');
      var fix = root.getElementById('brsf-fix');
      if (fix) fix.addEventListener('click', openOptions);
      ui.list.innerHTML = '';
      return;
    }
    creds = readCreds();
    if (!creds.token) {
      setMsg('Log in to eticket.railway.gov.bd first — the finder re-uses your session to query availability.', 'err');
      ui.list.innerHTML = '';
      return;
    }

    var built = F.buildQueries(route, settings);
    var meta = built.meta, plan = built.plan;
    running = true;
    ui.refreshBtn.disabled = true;
    ui.refreshBtn.textContent = 'Searching…';
    ui.bar.style.display = '';
    ui.barFill.style.width = '0%';
    ui.list.innerHTML = '';
    setMsg('');
    ui.sub.textContent = 'checking ' + built.queries.length + ' station pairs…';

    connectPort();
    try {
      port.postMessage({ type: 'SEARCH', creds: creds, queries: built.queries, options: {} });
    } catch (e) {
      finishRun();
      setMsg('Could not reach the extension background worker. Reload this tab (or reinstall the extension) and try again.', 'err');
      return;
    }

    var pendingHandler = function (m) {
      if (!m) return;
      if (m.type === 'progress') {
        var pct = m.total ? Math.round(100 * m.done / m.total) : 0;
        ui.barFill.style.width = pct + '%';
        ui.sub.textContent = 'checked ' + m.done + '/' + m.total + ' pairs…';
      } else if (m.type === 'done') {
        finishRun();
        if (m.deviceKey && m.deviceKey !== creds.ssdk) {
          try { localStorage.setItem('ssdk', m.deviceKey); } catch (e) { }
        }
        if (!m.ok && m.error === 'TOKEN') {
          setMsg('Session expired (HTTP 401). Please log in to eticket.railway.gov.bd again.', 'err');
          return;
        }
        render(m.results || {}, meta, plan, built.queries.length);
      }
    };
    port.onMessage.addListener(pendingHandler);
  }

  function openOptions() {
    try { chrome.runtime.sendMessage({ type: 'BR_OPEN_OPTIONS' }); } catch (e) { }
  }

  function finishRun() {
    running = false;
    if (!ui.refreshBtn) return;
    ui.refreshBtn.disabled = false;
    ui.refreshBtn.textContent = 'Find seats';
    ui.bar.style.display = 'none';
    lastRunAt = Date.now();
  }

  function connectPort() {
    if (port) { try { port.disconnect(); } catch (e) { } }
    try {
      port = chrome.runtime.connect({ name: 'br-seat-finder' });
    } catch (e) {
      port = null;
      return;
    }
    port.onDisconnect.addListener(function () {
      if (running) {                       // worker went away mid-search
        finishRun();
        setMsg('The extension was reloaded — press <b>Find seats</b> to run again.');
      }
    });
  }

  function render(results, meta, plan, queryCount) {
    var built = F.rowsFromResults(results, meta, route, settings);
    var rows = built.rows;
    var okCount = built.stats.ok;
    var errCount = built.stats.failed;
    var emptyPairs = built.stats.emptyAltPairs;

    ui.list.innerHTML = '';
    var foundNew = 0;
    var keySet = Object.create(null);

    rows.forEach(function (r) {
      var k = [r.train, r.fromName, r.toName, r.doj, r.classes.map(function (c) { return c.type + c.online; }).join(',')].join('|');
      keySet[k] = true;
      if (!lastKeySet[k]) foundNew++;
      ui.list.appendChild(renderRow(r));
    });

    lastKeySet = keySet;

    var exact = rows.filter(function (r) { return r.leg.exact; }).length;
    var alts = rows.length - exact;

    ui.stats.textContent = queryCount + ' pairs · ' + okCount + ' ok' +
      (errCount ? ' · ' + errCount + ' failed' : '') +
      (lastRunAt ? ' · ' + new Date(lastRunAt).toLocaleTimeString() : '');

    if (!rows.length) {
      var txt;
      if (!okCount) {
        txt = 'No response from the railway API. Check your connection / session, or open Settings → Test API.';
        setMsg(txt, 'err');
      } else {
        txt = '<b>No seats on ' + esc(route.doj) + ' — not on your route and not at any nearby station.</b>';
        if (emptyPairs.length) {
          txt += '<br><span style="font-size:11.5px">' + emptyPairs.length + ' of the alternative pairs returned no trains at all ' +
            '(the site may spell some small stations differently — you can fix names in Settings).</span>';
        }
        setMsg(txt, 'warn');
      }
      ui.sub.textContent = 'nothing available';
    } else {
      setMsg('<b>' + (exact ? 'Your exact route has ' + exact + ' option(s). ' : 'No seats on your exact route, but ') +
        (alts ? alts + ' alternative(s) nearby.' : 'no alternatives nearby.') + '</b>', exact ? 'ok' : 'warn');
      ui.sub.textContent = rows.length + ' option' + (rows.length === 1 ? '' : 's') + ' found';
      if (foundNew > 0 && hasRunBefore && !document.hidden) {
        notify('🎫 Seat found', rows[0].train + ' · ' + rows[0].fromName + ' → ' + rows[0].toName +
          ' · ' + rows[0].classes[0].online + ' ' + rows[0].classes[0].type);
      }
    }
    hasRunBefore = true;
  }

  function renderRow(r) {
    var row = el('div', 'row' + (r.leg.exact ? ' exact' : ''));
    var badges = [];
    if (r.leg.exact) badges.push('<span class="badge good">your route</span>');
    else {
      var fs = r.leg.fromShift, ts = r.leg.toShift;
      if (fs) {
        badges.push('<span class="badge ' + (fs.dir === 'before' ? 'info' : 'warn') + '">board ' +
          (fs.dir === 'before' ? 'earlier' : 'later') + ' · +' + fs.km + ' km</span>');
      }
      if (ts) {
        badges.push('<span class="badge ' + (ts.dir === 'after' ? 'info' : 'warn') + '">get off ' +
          (ts.dir === 'after' ? 'later' : 'earlier') + ' · +' + ts.km + ' km</span>');
      }
      if (r.leg.detourKm) badges.push('<span class="badge">detour ' + r.leg.detourKm + ' km</span>');
      if (r.leg.sameTrain && r.leg.sameTrain.length) {
        badges.push('<span class="badge good">same train</span>');
      }
    }
    if (r.off) badges.push('<span class="badge">' + (r.off > 0 ? '+' : '') + r.off + ' day (' + esc(r.doj) + ')</span>');

    var seats = r.classes.map(function (c, i) {
      return '<span class="seat' + (i ? ' alt' : '') + '">' + esc(c.type) + ' ' + c.online +
        (c.offline ? '<span class="n">+' + c.offline + ' off</span>' : '') + '</span>';
    }).join(' ');

    row.innerHTML =
      '<div class="row-hd"><span class="train">' + esc(r.train) + '</span>' +
      '<span class="dep">' + esc(r.dep) + '</span></div>' +
      '<div class="pair">' + esc(r.fromName) + '<span class="arrow">→</span>' + esc(r.toName) + '</div>' +
      '<div class="badges">' + badges.join('') + '</div>' +
      '<div class="seats">' + seats + '</div>' +
      '<div class="row-ft"><span class="fare">৳ ' + (r.classes[0].fare || '—') + '</span>' +
      '<span class="open">Open this search</span></div>';

    var url = searchUrl(r.fromName, r.toName, r.doj, route.seatClass);
    row.querySelector('.open').addEventListener('click', function () { window.location.href = url; });
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* settings + lifecycle                                                */
  /* ------------------------------------------------------------------ */

  function saveSettings() {
    try { chrome.storage.sync.set({ brsf_settings: settings }); } catch (e) { }
  }

  function loadSettings(cb) {
    try {
      chrome.storage.sync.get({ brsf_settings: null }, function (o) {
        if (o && o.brsf_settings) settings = Object.assign({}, DEFAULTS, o.brsf_settings);
        cb && cb();
      });
    } catch (e) { cb && cb(); }
  }

  function setupRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (settings.refreshSec > 0) {
      refreshTimer = setInterval(function () {
        if (document.hidden) return;
        run(false);
      }, Math.max(20, settings.refreshSec) * 1000);
    }
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync' && changes.brsf_settings) {
      settings = Object.assign({}, DEFAULTS, changes.brsf_settings.newValue || {});
      setupRefresh();
      if (ui.opts) { renderOpts(); renderRoute(); }
    }
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (msg.type === 'BR_READ_CREDS') {
      respond({ ok: true, creds: readCreds(), route: route });
      return true;
    }
    if (msg.type === 'BR_RUN') { loadSettings(function () { setupRefresh(); run(true); }); respond({ ok: true }); return true; }
    if (msg.type === 'BR_STATUS') {
      respond({ ok: true, running: running, route: route, settings: settings, lastRunAt: lastRunAt });
      return true;
    }
    if (msg.type === 'BR_SETTINGS_CHANGED') {
      loadSettings(function () { setupRefresh(); renderOpts(); renderRoute(); });
      return true;
    }
  });

  /* Which pages deserve the panel? The Angular app never reloads, so we watch the URL. */
  function isSearchPage() {
    return /\/booking\/train\/search/.test(location.pathname);
  }
  function hasSearchForm() {
    return !!document.querySelector('#dest_from, input[formcontrolname="fromcity"], #doj');
  }
  function pageIsRelevant() {
    return isSearchPage() || hasSearchForm() || !!routeHasValues();
  }
  function routeHasValues() {
    var u = new URL(location.href);
    return !!(u.searchParams.get('fromcity') && u.searchParams.get('tocity'));
  }

  function syncVisibility() {
    if (!host) return;
    host.style.display = pageIsRelevant() ? '' : 'none';
  }

  var lastHref = location.href;
  setInterval(function () {
    if (location.href === lastHref) return;
    lastHref = location.href;
    syncVisibility();
    if (isSearchPage()) {
      lastKeySet = Object.create(null);
      hasRunBefore = false;
      loadSettings(function () {
        setupRefresh();
        if (settings.autoRun) setTimeout(function () { run(false); }, 1000);
        else { route = detectRoute(); renderRoute(); renderOpts(); }
      });
    }
  }, 800);

  /* boot */
  loadSettings(function () {
    buildPanel();
    route = detectRoute();
    renderRoute();
    renderOpts();
    setupRefresh();
    syncVisibility();
    if (isSearchPage() && settings.autoRun) {
      setTimeout(function () { run(false); }, 1500);
    } else if (isSearchPage()) {
      setMsg('Press <b>Find seats</b> to check the stations before / after your route.');
    } else {
      ui.sub.textContent = 'run a search to enable';
    }
  });
})();
