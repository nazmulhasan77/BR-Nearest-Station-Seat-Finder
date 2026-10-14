/* api.js -- talks to the same JSON API the eticket site itself uses
   (https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2).
   Runs in the background service worker (no CORS there) and in node tests. */
(function (root) {
  'use strict';

  var BASE = 'https://railspaapi.shohoz.com/v1.0/web';
  var PATHS = ['/bookings/search-trips-v2', '/bookings/search-trips'];

  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    var m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  /** Build the URL for one query. */
  function buildUrl(path, q) {
    var p = new URLSearchParams();
    p.set('from_city', q.from_city);
    p.set('to_city', q.to_city);
    p.set('date_of_journey', q.date_of_journey);
    p.set('seat_class', q.seat_class || 'ALL');
    if (q.page) p.set('page', q.page);
    return BASE + path + '?' + p.toString();
  }

  function headersFor(creds, deviceKey) {
    var h = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://eticket.railway.gov.bd',
      'Referer': 'https://eticket.railway.gov.bd/',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (creds && creds.token) h['Authorization'] = 'Bearer ' + creds.token;
    if (creds && creds.uudid) h['X-Device-Id'] = creds.uudid;
    var ssdk = deviceKey || (creds && creds.ssdk);
    if (ssdk) h['X-Device-Key'] = ssdk;
    return h;
  }

  /** Normalise the API payload into [{train, depTime, arrTime, classes:[{type,fare,online,offline}]}] */
  function parseTrains(json) {
    var data = (json && json.data) || {};
    var list = data.trains || data.results || (Array.isArray(data) ? data : []);
    if (!Array.isArray(list)) return { trains: [], deviceKey: data.device_key, raw: json };

    var out = list.map(function (t) {
      var types = t.seat_types || t.seatTypes || t.seat_classes || [];
      var classes = (Array.isArray(types) ? types : []).map(function (s) {
        var sc = s.seat_counts || s.seatCounts || {};
        return {
          type: String(s.type || s.seat_class || s.class || '').toUpperCase(),
          fare: toNum(s.fare),
          online: toNum(sc.online != null ? sc.online : s.online),
          offline: toNum(sc.offline != null ? sc.offline : s.offline)
        };
      });
      return {
        train: String(t.trip_number || t.train_name || t.name || '').trim(),
        trainName: String(t.train_name || t.name || '').trim(),
        trainNo: String(t.train_no || t.train_number || '').trim(),
        depTime: String(t.departure_date_time || t.departure_time || '').trim(),
        arrTime: String(t.arrival_date_time || t.arrival_time || '').trim(),
        classes: classes
      };
    });
    return { trains: out, deviceKey: data.device_key, raw: json };
  }

  /**
   * One query. Returns {ok, trains, error, status, deviceKey}
   * error codes: 'NO_TOKEN' | 'TOKEN' | 'RATE' | 'NET' | 'HTTP' | 'PARSE'
   */
  async function query(creds, q, opts) {
    opts = opts || {};
    var deviceKey = opts.deviceKey;
    var lastErr = null;
    if (!creds || !creds.token) return { ok: false, error: 'NO_TOKEN' };

    for (var i = 0; i < PATHS.length; i++) {
      var url = buildUrl(PATHS[i], q);
      var res, text;
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, (opts.timeoutMs || 15000));
        res = await fetch(url, {
          method: 'GET',
          headers: headersFor(creds, deviceKey),
          credentials: 'omit',
          signal: ctrl.signal
        });
        clearTimeout(timer);
        text = await res.text();
      } catch (e) {
        lastErr = { ok: false, error: 'NET', message: String(e && e.message || e) };
        continue;
      }

      if (res.status === 401) return { ok: false, error: 'TOKEN', status: 401 };
      if (res.status === 429) return { ok: false, error: 'RATE', status: 429 };
      if (res.status === 404 || res.status === 405) { lastErr = { ok: false, error: 'HTTP', status: res.status }; continue; }
      if (!res.ok) return { ok: false, error: 'HTTP', status: res.status, body: text.slice(0, 300) };

      var json;
      try { json = JSON.parse(text); }
      catch (e) { return { ok: false, error: 'PARSE', body: text.slice(0, 300) }; }

      var parsed = parseTrains(json);
      if (!parsed.trains.length && (json.error || json.errors)) {
        return { ok: false, error: 'HTTP', status: res.status, body: JSON.stringify(json.error || json.errors).slice(0, 300) };
      }
      return {
        ok: true,
        trains: parsed.trains,
        deviceKey: parsed.deviceKey,
        path: PATHS[i],
        status: res.status
      };
    }
    return lastErr || { ok: false, error: 'HTTP' };
  }

  root.BR = root.BR || {};
  root.BR.api = {
    BASE: BASE,
    PATHS: PATHS,
    buildUrl: buildUrl,
    headersFor: headersFor,
    parseTrains: parseTrains,
    query: query
  };
})(typeof window !== 'undefined' ? window : globalThis);
