/* stations.js -- station index, name matching and "what does the eticket site call it?" */
(function (root) {
  'use strict';

  var data = (root.BR_DATA && root.BR_DATA.stations) || [];
  var geo = root.BR.geo;

  var all = data.map(function (r) {
    return {
      code: r[0], name: r[1], bn: r[2],
      lat: r[3], lng: r[4],
      major: !!(r[5] & 1)
    };
  });

  var byCode = Object.create(null);
  all.forEach(function (s) { byCode[s.code] = s; });

  /* Names as the eticket site spells them.
     - data/site-names.js is generated from the public /all-trains/info endpoint
     - MANUAL holds hand-written fixes for names the timetable dataset misspells  */
  var OVERRIDES = (root.BR_DATA && root.BR_DATA.siteNames) || {};
  var MANUAL = {
    TEJ: 'Tejgaon',
    BONA: 'Banani',
    DA: 'Dhaka',
    KSG: 'Kishorganj'   // the site spells it without the extra 'e'
  };
  Object.keys(MANUAL).forEach(function (k) {
    if (!OVERRIDES[k]) OVERRIDES[k] = MANUAL[k];
  });

  /* Common alternative spellings -> something resolve() can find. */
  var SPELLINGS = {
    chittagong: 'Chattogram', comilla: 'Cumilla', barisal: 'Barishal', borisal: 'Barishal',
    jessore: 'Jashore', ishurdi: 'Ishwardi', kishorganj: 'Kishoreganj', bogra: 'Bogura',
    dacca: 'Dhaka', noakhali: 'Noakhali', mymensing: 'Mymensingh', saidpur: 'Saidpur'
  };

  /* ---------------- name normalisation ---------------- */

  var DROP_TOKENS = { junction: 1, jn: 1, junc: 1, jn_dot: 1 };

  /** lowercase, drop parentheticals and punctuation -> "dhaka kamalapur" */
  function normalize(name) {
    if (!name) return '';
    var s = String(name).toLowerCase();
    s = s.replace(/\([^)]*\)/g, ' ');        // (Kamalapur), (Iconic), ...
    s = s.replace(/&/g, ' and ');
    s = s.replace(/[^a-z0-9\u0980-\u09FF]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /** normalise + drop trailing "junction"/"jn" words */
  function normalizeLoose(name) {
    var s = normalize(name);
    var parts = s.split(' ').filter(function (p) { return !DROP_TOKENS[p] && p !== 'jn.'; });
    return parts.join(' ').trim();
  }

  /**
   * Consonant skeleton: "Kishorganj" and "Kishoreganj" both -> "kshrgnj".
   * Used as a last-resort fuzzy key.
   */
  function skeleton(name) {
    var s = normalizeLoose(name).replace(/[aeiouy]/g, '');
    s = s.replace(/(.)\1+/g, '$1');
    return s;
  }

  /** A short-ish name we can send to the railway API, e.g. "Dhaka", "Ishwardi". */
  function siteName(station) {
    if (!station) return '';
    var override = OVERRIDES[station.code];
    if (override) return override;
    var s = String(station.name || '').replace(/\([^)]*\)/g, ' ');
    s = s.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
    s = s.replace(/\b(Junction|Jn\.?|Junc\.?)\b\s*$/i, '').trim();
    s = s.replace(/[,\s]+$/, '');
    return s;
  }

  /** All spellings worth trying against the API, best guess first. */
  function siteNameVariants(station) {
    var out = [];
    function push(v) {
      v = String(v || '').trim();
      if (v && out.indexOf(v) === -1) out.push(v);
    }
    push(siteName(station));
    push(siteName(station).replace(/ /g, '_'));          // some endpoints use slugs
    push(String(station.name || '').replace(/\s+/g, ' ').trim());
    push(String(station.name || '').replace(/\s+/g, ' ').trim().replace(/ /g, '_'));
    return out;
  }

  /* ---------------- index ---------------- */

  var aliasMap = Object.create(null);   // alias -> [station,...]
  var banglaMap = Object.create(null);

  function addAlias(alias, st) {
    if (!alias) return;
    var list = aliasMap[alias] || (aliasMap[alias] = []);
    if (list.indexOf(st) === -1) list.push(st);
  }

  all.forEach(function (st) {
    addAlias(normalize(st.name), st);
    addAlias(normalizeLoose(st.name), st);
    addAlias(normalizeLoose(st.name).replace(/\b(bazar|town|road|hat|ghat|bridge)\b/g, ' ').replace(/\s+/g, ' ').trim(), st);
    if (OVERRIDES[st.code]) {
      addAlias(normalize(OVERRIDES[st.code]), st);
      addAlias(normalizeLoose(OVERRIDES[st.code]), st);
    }
    if (st.bn) {
      var b = String(st.bn).replace(/[\s\u200c\u200d]+/g, '');
      if (b) (banglaMap[b] || (banglaMap[b] = [])).push(st);
      var bnNorm = normalize(st.bn).replace(/\s+/g, '');
      if (bnNorm) addAlias(bnNorm, st);
    }
  });

  function pick(list) {
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    // prefer a major junction when several stations share an alias
    for (var i = 0; i < list.length; i++) if (list[i].major) return list[i];
    return list[0];
  }

  /**
   * Resolve anything the site/user gives us ("Chatmohar", "dhaka", "ঢাকা", "Dhaka (Kamalapur)")
   * to a station record.
   */
  function resolve(query) {
    if (!query) return null;
    if (typeof query === 'object' && query.code) return query;
    if (byCode[String(query).toUpperCase()]) return byCode[String(query).toUpperCase()];
    if (/^[A-Za-z0-9_]{2,6}$/.test(String(query)) && byCode[String(query)]) return byCode[String(query)];

    var raw = String(query);
    var n1 = normalize(raw);
    var n2 = normalizeLoose(raw);
    var hit = pick(aliasMap[n1]) || pick(aliasMap[n2]);
    if (hit) return hit;

    var spelling = SPELLINGS[n1] || SPELLINGS[n2];
    if (spelling) {
      var viaSpelling = pick(aliasMap[normalize(spelling)]) || pick(aliasMap[normalizeLoose(spelling)]);
      if (viaSpelling) return viaSpelling;
    }

    // prefix match both ways (shortest alias wins): "dhaka" -> "dhaka kamalapur"
    var cands = [];
    Object.keys(aliasMap).forEach(function (a) {
      if (!a) return;
      if (a === n1 || a.indexOf(n1) === 0 || n1.indexOf(a) === 0) cands.push([a, aliasMap[a]]);
    });
    if (cands.length) {
      cands.sort(function (x, y) { return x[0].length - y[0].length; });
      return pick(cands[0][1]);
    }
    // fuzzy: consonant skeleton (Kishorganj ~ Kishoreganj, Ishurdi ~ Ishwardi)
    var sk = skeleton(raw);
    if (sk.length >= 4) {
      var skHit = all.filter(function (st) { return skeleton(st.name) === sk; });
      if (!skHit.length) {
        skHit = all.filter(function (st) {
          var s2 = skeleton(st.name);
          return s2.length >= 4 && (s2.indexOf(sk) === 0 || sk.indexOf(s2) === 0);
        });
      }
      if (skHit.length) return pick(skHit);
    }
    // last resort: substring
    var sub = all.filter(function (st) {
      var a = normalize(st.name);
      return a && (a.indexOf(n1) >= 0 || n1.indexOf(a) >= 0);
    });
    if (sub.length) return pick(sub);

    var bn = String(raw).replace(/[\s\u200c\u200d]+/g, '');
    if (banglaMap[bn]) return pick(banglaMap[bn]);
    return null;
  }

  /** Stations within maxKm (straight line) of a station, nearest first. */
  function nearby(station, maxKm, limit, excludeCodes) {
    var excl = excludeCodes || [];
    return all
      .filter(function (s) { return s.code !== station.code && excl.indexOf(s.code) === -1; })
      .map(function (s) { return { station: s, km: geo.distanceKm(station.lat, station.lng, s.lat, s.lng) }; })
      .filter(function (x) { return isFinite(x.km) && x.km <= maxKm; })
      .sort(function (a, b) { return a.km - b.km; })
      .slice(0, limit || 10);
  }

  root.BR.stations = {
    all: all,
    byCode: byCode,
    resolve: resolve,
    siteName: siteName,
    siteNameVariants: siteNameVariants,
    nearby: nearby,
    normalize: normalize,
    normalizeLoose: normalizeLoose,
    skeleton: skeleton,
    overrides: OVERRIDES
  };
})(typeof window !== 'undefined' ? window : globalThis);
