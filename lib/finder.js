/* finder.js -- the pure, testable core: plan -> query list -> result rows.
   No DOM, no chrome.* : the content script and the node test share it. */
(function (root) {
  'use strict';

  var S = root.BR.stations;
  var P = root.BR.planner;

  function siteNameFor(station, overrides) {
    var ov = overrides || {};
    if (station && ov[station.code]) return ov[station.code];
    return S.siteName(station);
  }

  function searchUrl(fromName, toName, doj, cls) {
    var p = new URLSearchParams();
    p.set('fromcity', fromName);
    p.set('tocity', toName);
    p.set('doj', doj);
    if (cls) p.set('class', cls);
    return '/booking/train/search?' + p.toString();
  }

  /**
   * route    = {from, to (station objects), fromRaw, toRaw, doj, seatClass}
   * settings = {hops, maxDetourKm, geoCount, maxPairs, dateOffsets, onlyMyClass, nameOverrides}
   */
  function buildQueries(route, settings) {
    var plan = P.buildPlan({
      from: route.from,
      to: route.to,
      hops: settings.hops,
      maxDetourKm: settings.maxDetourKm,
      geoCount: settings.geoCount,
      maxPairs: settings.maxPairs,
      weekday: (P.parseDoj(route.doj) || {}).weekday
    });

    var dates = (settings.dateOffsets && settings.dateOffsets.length) ? settings.dateOffsets.slice() : [0];
    dates.sort(function (a, b) { return a - b; });

    var pairBudget = plan.pairs;
    if (dates.length > 1) {
      pairBudget = plan.pairs.slice(0, Math.max(3, Math.floor(settings.maxPairs / dates.length)));
    }

    var original = {
      key: 'ORIG',
      from: route.from,
      to: route.to,
      detourKm: 0,
      fromShift: null,
      toShift: null,
      sameTrain: plan.servingCodes || [],
      exact: true
    };

    var legs = [original].concat(pairBudget);
    var queries = [];
    var meta = Object.create(null);

    legs.forEach(function (leg, li) {
      var fn = leg.exact ? (route.fromRaw || siteNameFor(leg.from, settings.nameOverrides))
        : siteNameFor(leg.from, settings.nameOverrides);
      var tn = leg.exact ? (route.toRaw || siteNameFor(leg.to, settings.nameOverrides))
        : siteNameFor(leg.to, settings.nameOverrides);
      dates.forEach(function (off) {
        var doj = off ? P.shiftDoj(route.doj, off) : route.doj;
        var key = 'q' + li + '_' + off;
        queries.push({
          key: key,
          q: {
            from_city: fn,
            to_city: tn,
            date_of_journey: doj,
            seat_class: route.seatClass || 'ALL'
          }
        });
        meta[key] = { leg: leg, doj: doj, off: off, fromName: fn, toName: tn };
      });
    });

    return { plan: plan, queries: queries, meta: meta, legs: legs, dates: dates };
  }

  /**
   * Turn raw per-key API results into display rows.
   * results = { key: {ok, trains:[...]} }
   */
  function rowsFromResults(results, meta, route, settings) {
    var rows = [];
    var stats = { ok: 0, failed: 0, emptyAltPairs: [] };

    Object.keys(meta).forEach(function (key) {
      var m = meta[key];
      var res = results[key];
      if (!res) return;
      if (!res.ok) { stats.failed++; return; }
      stats.ok++;
      var trains = res.trains || [];
      if (!trains.length) {
        if (!m.leg.exact) stats.emptyAltPairs.push(m);
        return;
      }
      trains.forEach(function (t) {
        var classes = (t.classes || []).filter(function (c) { return c.online > 0; });
        if (settings.onlyMyClass && route.seatClass) {
          var want = String(route.seatClass).toUpperCase();
          classes = classes.filter(function (c) { return String(c.type).toUpperCase() === want; });
        }
        if (!classes.length) return;
        classes.sort(function (a, b) {
          var ra = classRank(a.type, route.seatClass), rb = classRank(b.type, route.seatClass);
          return ra - rb || b.online - a.online;
        });
        rows.push({
          train: t.train || t.trainName || '',
          dep: t.depTime || '',
          fromName: m.fromName,
          toName: m.toName,
          doj: m.doj,
          off: m.off,
          leg: m.leg,
          classes: classes
        });
      });
    });

    rows.sort(function (a, b) {
      if (a.leg.exact !== b.leg.exact) return a.leg.exact ? -1 : 1;
      if (a.off !== b.off) return a.off - b.off;
      return (a.leg.detourKm - b.leg.detourKm) || (b.classes[0].online - a.classes[0].online);
    });

    return { rows: rows, stats: stats };
  }

  function classRank(type, seatClass) {
    var t = String(type || '').toUpperCase();
    if (seatClass && t === String(seatClass).toUpperCase()) return 0;
    return 1;
  }

  root.BR.finder = {
    buildQueries: buildQueries,
    rowsFromResults: rowsFromResults,
    searchUrl: searchUrl,
    siteNameFor: siteNameFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
