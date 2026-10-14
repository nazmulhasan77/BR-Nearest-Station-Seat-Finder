/* planner.js -- work out which *other* station pairs are worth querying */
(function (root) {
  'use strict';

  var S = root.BR.stations;
  var geo = root.BR.geo;
  var TRAINS = (root.BR_DATA && root.BR_DATA.trains) || [];

  // lazy per-train position index: { trainIdx: {code: position} }
  var posCache = [];
  function posOf(ti) {
    if (!posCache[ti]) {
      var m = Object.create(null);
      var stops = TRAINS[ti][2].split('|');
      for (var i = 0; i < stops.length; i++) m[stops[i]] = i;
      posCache[ti] = m;
    }
    return posCache[ti];
  }
  function stopsOf(ti) { return TRAINS[ti][2].split('|'); }

  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  /** '16-Oct-2026' -> {date:Date, iso:'2026-10-16', weekday:0..6 (0=Sunday)} */
  function parseDoj(doj) {
    var d = null;
    var m = /^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/.exec(String(doj || '').trim());
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
      d = new Date(Date.UTC(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]));
    } else {
      var t = Date.parse(doj);
      if (!isNaN(t)) d = new Date(t);
    }
    if (!d || isNaN(d.getTime())) return null;
    return {
      date: d,
      iso: d.toISOString().slice(0, 10),
      weekday: d.getUTCDay(),
      label: doj
    };
  }

  function formatDoj(date) {
    var mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = date.getUTCDate();
    return (d < 10 ? '0' + d : d) + '-' + mons[date.getUTCMonth()] + '-' + date.getUTCFullYear();
  }

  function shiftDoj(doj, days) {
    var p = parseDoj(doj);
    if (!p) return doj;
    var d = new Date(p.date.getTime() + days * 86400000);
    return formatDoj(d);
  }

  /** Trains that run `from -> to` (in that order) and are not off on that weekday. */
  function trainsServing(fromCode, toCode, weekday) {
    var off = weekday + 1; // our encoding: 1=Sunday .. 7=Saturday
    var out = [];
    for (var i = 0; i < TRAINS.length; i++) {
      var t = TRAINS[i];
      if (t[3] === off) continue;                 // train does not run that day
      var p = posOf(i);
      var a = p[fromCode], b = p[toCode];
      if (a === undefined || b === undefined || b <= a) continue;
      out.push({ idx: i, code: t[0], name: t[1], fi: a, ti: b });
    }
    return out;
  }

  /**
   * Build the list of alternative (from, to) pairs worth asking the API about.
   *
   * opts = {
   *   from, to        : station objects
   *   hops            : how many stations before/after to consider (1-3)
   *   maxDetourKm     : ignore alternatives further than this by road
   *   geoCount        : how many purely-distance-based neighbours to add
   *   maxPairs        : cap on how many pairs to query
   *   weekday         : 0..6 (0 = Sunday)
   * }
   */
  function buildPlan(opts) {
    var from = opts.from, to = opts.to;
    var hops = Math.max(1, Math.min(3, opts.hops || 2));
    var maxDetourKm = opts.maxDetourKm || 60;
    var geoCount = opts.geoCount == null ? 3 : opts.geoCount;
    var maxPairs = Math.max(1, opts.maxPairs || 14);
    var weekday = opts.weekday;

    if (!from || !to || from.code === to.code) {
      return { from: from, to: to, pairs: [], serving: [], note: 'bad-input' };
    }

    var serving = trainsServing(from.code, to.code, weekday);

    /* --- 1. route-based neighbours ------------------------------------- */
    // key `${dir}|${code}` -> {station, dir, hops, trains:[codes]}
    var origAlts = Object.create(null);
    var destAlts = Object.create(null);

    function noteAlt(bucket, code, dir, hops, trainCode) {
      if (code === undefined || code === from.code && bucket === origAlts) return;
      var key = dir + '|' + code;
      var e = bucket[key];
      if (!e) {
        var st = S.byCode[code];
        if (!st) return;
        e = bucket[key] = { station: st, dir: dir, hops: hops, trains: [] };
      }
      if (hops < e.hops) e.hops = hops;
      if (e.trains.indexOf(trainCode) === -1) e.trains.push(trainCode);
    }

    serving.forEach(function (sv) {
      var stops = stopsOf(sv.idx);
      for (var h = 1; h <= hops; h++) {
        // board EARLIER: a station h stops before our origin
        if (sv.fi - h >= 0) noteAlt(origAlts, stops[sv.fi - h], 'before', h, sv.code);
        // board LATER: a station h stops after our origin, but still before our destination
        if (sv.fi + h < sv.ti) noteAlt(origAlts, stops[sv.fi + h], 'after', h, sv.code);
        // get off EARLIER: h stops before our destination, but still after our origin
        if (sv.ti - h > sv.fi) noteAlt(destAlts, stops[sv.ti - h], 'before', h, sv.code);
        // get off LATER: ride past our destination
        if (sv.ti + h < stops.length) noteAlt(destAlts, stops[sv.ti + h], 'after', h, sv.code);
      }
    });

    function toOptions(bucket, base) {
      var list = Object.keys(bucket).map(function (k) {
        var e = bucket[k];
        return {
          station: e.station,
          dir: e.dir,
          hops: e.hops,
          trains: e.trains,
          km: geo.roadKm(base.lat, base.lng, e.station.lat, e.station.lng)
        };
      }).filter(function (o) { return o.km <= maxDetourKm; });
      // nearest first
      list.sort(function (a, b) { return a.km - b.km || a.hops - b.hops; });
      return list;
    }

    var originOpts = toOptions(origAlts, from);
    var destOpts = toOptions(destAlts, to);

    /* --- 2. distance based fallback ------------------------------------ */
    if (geoCount > 0) {
      var usedO = originOpts.map(function (o) { return o.station.code; }).concat([from.code]);
      var usedD = destOpts.map(function (o) { return o.station.code; }).concat([to.code]);
      S.nearby(from, maxDetourKm, geoCount * 3, usedO).slice(0, geoCount).forEach(function (n) {
        originOpts.push({
          station: n.station, dir: 'near', hops: 1, trains: [],
          km: geo.roadKm(from.lat, from.lng, n.station.lat, n.station.lng)
        });
      });
      S.nearby(to, maxDetourKm, geoCount * 3, usedD).slice(0, geoCount).forEach(function (n) {
        destOpts.push({
          station: n.station, dir: 'near', hops: 1, trains: [],
          km: geo.roadKm(to.lat, to.lng, n.station.lat, n.station.lng)
        });
      });
    }

    // dedupe options by station code (keep smallest km)
    function dedupe(list) {
      var seen = Object.create(null), out = [];
      list.sort(function (a, b) { return a.km - b.km; });
      list.forEach(function (o) {
        var prev = seen[o.station.code];
        if (prev) {
          prev.trains = prev.trains.concat(o.trains);
          return;
        }
        seen[o.station.code] = o;
        out.push(o);
      });
      return out;
    }
    originOpts = dedupe(originOpts);
    destOpts = dedupe(destOpts);

    /* --- 3. build & validate pairs ------------------------------------ */
    var base = { station: from, dir: null, hops: 0, trains: serving.map(function (s) { return s.code; }), km: 0 };
    var allO = [base].concat(originOpts);
    var baseD = { station: to, dir: null, hops: 0, trains: serving.map(function (s) { return s.code; }), km: 0 };
    var allD = [baseD].concat(destOpts);

    var servingCodes = serving.map(function (s) { return s.code; });
    var pairs = [];
    var seenPair = Object.create(null);

    for (var i = 0; i < allO.length; i++) {
      for (var j = 0; j < allD.length; j++) {
        var o = allO[i], d = allD[j];
        if (i === 0 && j === 0) continue;                       // the original pair
        if (o.station.code === d.station.code) continue;
        var key = o.station.code + '>' + d.station.code;
        if (seenPair[key]) continue;

        // only keep pairs that at least one (running) train actually serves
        var hit = trainsServing(o.station.code, d.station.code, weekday);
        if (!hit.length) continue;
        var hitCodes = hit.map(function (h) { return h.code; });
        var sameTrain = hitCodes.filter(function (c) { return servingCodes.indexOf(c) !== -1; });

        seenPair[key] = true;
        pairs.push({
          key: key,
          from: o.station,
          to: d.station,
          fromShift: i === 0 ? null : { dir: o.dir, hops: o.hops, km: Math.round(o.km) },
          toShift: j === 0 ? null : { dir: d.dir, hops: d.hops, km: Math.round(d.km) },
          detourKm: Math.round(o.km + d.km),
          trains: hitCodes,
          sameTrain: sameTrain,                                 // trains that also serve your exact route
          score: (o.km + d.km) + 1.5 * (o.hops + d.hops) - 6 * (sameTrain.length ? 1 : 0)
        });
      }
    }

    pairs.sort(function (a, b) { return a.score - b.score; });

    return {
      from: from,
      to: to,
      serving: serving,
      servingCodes: servingCodes,
      originOptions: originOpts,
      destOptions: destOpts,
      pairs: pairs.slice(0, maxPairs),
      totalPairs: pairs.length,
      truncated: pairs.length > maxPairs
    };
  }

  root.BR.planner = {
    buildPlan: buildPlan,
    trainsServing: trainsServing,
    parseDoj: parseDoj,
    formatDoj: formatDoj,
    shiftDoj: shiftDoj
  };
})(typeof window !== 'undefined' ? window : globalThis);
