/* options.js */
(function () {
  'use strict';
  var DEFAULTS = {
    hops: 2, maxDetourKm: 60, geoCount: 3, maxPairs: 14, dateOffsets: [0],
    onlyMyClass: false, autoRun: true, refreshSec: 0, notify: true, seatClass: '', nameOverrides: {}
  };
  var settings = Object.assign({}, DEFAULTS);
  var $ = function (id) { return document.getElementById(id); };

  function load() {
    chrome.storage.sync.get({ brsf_settings: null }, function (o) {
      settings = Object.assign({}, DEFAULTS, (o && o.brsf_settings) || {});
      $('hops').value = String(settings.hops);
      $('detour').value = String(settings.maxDetourKm);
      $('geocount').value = String(settings.geoCount);
      $('maxpairs').value = String(settings.maxPairs);
      $('seatclass').value = settings.seatClass || '';
      $('refresh').value = String(settings.refreshSec || 0);
      $('autorun').checked = !!settings.autoRun;
      $('notify').checked = !!settings.notify;
      $('onlymyclass').checked = !!settings.onlyMyClass;
      $('overrides').value = Object.keys(settings.nameOverrides || {})
        .map(function (k) { return k + ' = ' + settings.nameOverrides[k]; }).join('\n');
      var d = new Date();
      var mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      $('tdate').value = (d.getDate() < 10 ? '0' + d.getDate() : d.getDate()) + '-' + mons[d.getMonth()] + '-' + (d.getFullYear() + 1 > d.getFullYear() ? d.getFullYear() : d.getFullYear());
    });
  }

  function collect() {
    settings.hops = parseInt($('hops').value, 10) || 2;
    settings.maxDetourKm = parseInt($('detour').value, 10) || 60;
    settings.geoCount = parseInt($('geocount').value, 10);
    settings.maxPairs = parseInt($('maxpairs').value, 10) || 14;
    settings.seatClass = ($('seatclass').value || '').trim();
    settings.refreshSec = parseInt($('refresh').value, 10) || 0;
    settings.autoRun = $('autorun').checked;
    settings.notify = $('notify').checked;
    settings.onlyMyClass = $('onlymyclass').checked;
    var ov = {};
    ($('overrides').value || '').split(/\r?\n/).forEach(function (line) {
      var m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (m) ov[m[1].toUpperCase()] = m[2];
    });
    settings.nameOverrides = ov;
  }

  $('save').addEventListener('click', function () {
    collect();
    chrome.storage.sync.set({ brsf_settings: settings }, function () {
      $('savestatus').textContent = 'Saved ✓';
      setTimeout(function () { $('savestatus').textContent = ''; }, 2200);
      // tell any open railway tab to re-read settings
      chrome.tabs.query({ url: 'https://eticket.railway.gov.bd/*' }, function (tabs) {
        tabs.forEach(function (t) {
          chrome.tabs.sendMessage(t.id, { type: 'BR_SETTINGS_CHANGED' }, function () { void chrome.runtime.lastError; });
        });
      });
    });
  });

  $('reset').addEventListener('click', function () {
    settings = Object.assign({}, DEFAULTS);
    chrome.storage.sync.set({ brsf_settings: settings }, load);
  });

  $('test').addEventListener('click', function () {
    var out = $('testout'), st = $('teststatus');
    st.textContent = 'working…';
    out.style.display = 'none';
    chrome.tabs.query({ url: 'https://eticket.railway.gov.bd/*' }, function (tabs) {
      if (!tabs.length) {
        st.textContent = 'Open eticket.railway.gov.bd in a tab (and log in) first.';
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'BR_READ_CREDS' }, function (r) {
        if (!r || !r.creds || !r.creds.token) {
          st.textContent = 'No session token — log in on the railway site, then try again.';
          return;
        }
        var q = {
          from_city: $('tfrom').value.trim() || 'Dhaka',
          to_city: $('tto').value.trim() || 'Chatmohar',
          date_of_journey: $('tdate').value.trim(),
          seat_class: 'ALL'
        };
        chrome.runtime.sendMessage({ type: 'BR_TEST', creds: r.creds, q: q }, function (res) {
          if (!res) { st.textContent = 'no response'; return; }
          st.textContent = res.result && res.result.ok
            ? 'OK — ' + res.result.trains.length + ' trains returned'
            : 'FAILED: ' + (res.result && res.result.error);
          out.style.display = '';
          out.textContent = 'GET ' + res.url + '\n\n' +
            JSON.stringify(res.result && res.result.trains ? res.result.trains.slice(0, 3) : res.result, null, 2);
        });
      });
    });
  });

  load();
})();
