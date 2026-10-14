/* popup.js -- quick controls; the real work happens in the page panel */
(function () {
  'use strict';
  var DEFAULTS = {
    hops: 2, maxDetourKm: 60, geoCount: 3, maxPairs: 14, dateOffsets: [0],
    onlyMyClass: false, autoRun: true, refreshSec: 0, notify: true, seatClass: '', nameOverrides: {}
  };
  var settings = Object.assign({}, DEFAULTS);

  var $ = function (id) { return document.getElementById(id); };

  function msg(text, kind) {
    var m = $('msg');
    if (!text) { m.style.display = 'none'; return; }
    m.style.display = '';
    m.className = 'msg' + (kind ? ' ' + kind : '');
    m.innerHTML = text;
  }

  function withTab(fn) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = tabs && tabs[0];
      if (!t || !/^https:\/\/eticket\.railway\.gov\.bd\//.test(t.url || '')) {
        msg('Open <b>eticket.railway.gov.bd</b> in this tab first.', 'err');
        return;
      }
      fn(t);
    });
  }

  function send(tab, message, cb) {
    chrome.tabs.sendMessage(tab.id, message, function (r) {
      if (chrome.runtime.lastError) { msg('Reload the railway tab once (the extension was just installed).', 'err'); return; }
      cb && cb(r);
    });
  }

  function load() {
    chrome.storage.sync.get({ brsf_settings: null }, function (o) {
      settings = Object.assign({}, DEFAULTS, (o && o.brsf_settings) || {});
      $('hops').value = String(settings.hops);
      $('detour').value = String(settings.maxDetourKm);
      $('dm1').checked = settings.dateOffsets.indexOf(-1) >= 0;
      $('dp1').checked = settings.dateOffsets.indexOf(1) >= 0;
      $('dp2').checked = settings.dateOffsets.indexOf(2) >= 0;
      refreshStatus();
    });
  }

  function save() {
    chrome.storage.sync.set({ brsf_settings: settings });
  }

  function refreshStatus() {
    withTab(function (tab) {
      send(tab, { type: 'BR_STATUS' }, function (r) {
        if (!r || !r.ok) return;
        var rt = r.route || {};
        if (rt.fromRaw && rt.toRaw) {
          $('route').innerHTML = '<b>' + (rt.from ? rt.from.name : rt.fromRaw) + '</b> → <b>' +
            (rt.to ? rt.to.name : rt.toRaw) + '</b><br>' + (rt.doj || '') + (rt.seatClass ? ' · ' + rt.seatClass : '');
        }
        $('stats').textContent = r.lastRunAt ? 'last run ' + new Date(r.lastRunAt).toLocaleTimeString() : '';
        if (r.running) msg('Searching…');
      });
    });
  }

  $('hops').addEventListener('change', function () { settings.hops = +this.value; save(); });
  $('detour').addEventListener('change', function () { settings.maxDetourKm = +this.value; save(); });
  [['dm1', -1], ['dp1', 1], ['dp2', 2]].forEach(function (pair) {
    $(pair[0]).addEventListener('change', function () {
      var off = pair[1];
      var s = settings.dateOffsets.filter(function (d) { return d !== off; });
      if (this.checked) s.push(off);
      settings.dateOffsets = s.sort(function (a, b) { return a - b; });
      save();
    });
  });

  $('run').addEventListener('click', function () {
    save();
    msg('');
    withTab(function (tab) {
      send(tab, { type: 'BR_RUN' }, function () { msg('Started — see the panel on the page.', 'ok'); });
    });
  });

  $('options').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });

  load();
})();
