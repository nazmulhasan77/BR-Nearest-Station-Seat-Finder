/* geo.js -- tiny haversine helper (works in browser + node) */
(function (root) {
  'use strict';
  var R = 6371.0088; // mean earth radius, km

  function toRad(d) { return d * Math.PI / 180; }

  /** Straight-line (great circle) distance in km. */
  function distanceKm(lat1, lng1, lat2, lng2) {
    if ([lat1, lng1, lat2, lng2].some(function (v) { return typeof v !== 'number' || isNaN(v); })) {
      return Infinity;
    }
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /**
   * Rough *road* distance: straight line * detour factor.
   * Bangladeshi roads/river crossings make 1.3 a reasonable default.
   */
  function roadKm(lat1, lng1, lat2, lng2, factor) {
    return distanceKm(lat1, lng1, lat2, lng2) * (factor || 1.3);
  }

  root.BR = root.BR || {};
  root.BR.geo = { distanceKm: distanceKm, roadKm: roadKm, ROAD_FACTOR: 1.3 };
})(typeof window !== 'undefined' ? window : globalThis);
