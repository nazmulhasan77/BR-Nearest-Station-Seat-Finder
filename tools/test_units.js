/* node tools/test_units.js -- small unit checks for the parsing / naming layer */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
['data/stations.js', 'data/site-names.js', 'data/trains.js', 'lib/geo.js', 'lib/stations.js',
  'lib/planner.js', 'lib/api.js', 'lib/finder.js']
  .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }));

const { BR } = globalThis;
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '  -> ' + e.message); fail++; }
}

console.log('\n-- api.parseTrains');
const SAMPLE = {
  data: {
    device_key: 'abc123',
    trains: [{
      trip_number: 'PARABAT EXPRESS (709)',
      train_name: 'Parabat Express',
      departure_date_time: '2026-10-16 06:45:00',
      arrival_date_time: '2026-10-16 13:30:00',
      seat_types: [
        { type: 'S_CHAIR', fare: '595.00', seat_counts: { online: 12, offline: 8 } },
        { type: 'SNIGDHA', fare: 1120, seat_counts: { online: 0, offline: 3 } },
        { type: 'AC_B', fare: 1490, seat_counts: { online: '2', offline: 0 } }
      ]
    }, {
      trip_number: 'UPABAN EXPRESS (739)',
      departure_date_time: '2026-10-16 20:30:00',
      seat_types: [{ type: 'S_CHAIR', fare: 595, seat_counts: { online: 0, offline: 0 } }]
    }]
  }
};
const parsed = BR.api.parseTrains(SAMPLE);
check('device key picked up', () => assert.equal(parsed.deviceKey, 'abc123'));
check('two trains parsed', () => assert.equal(parsed.trains.length, 2));
check('train name', () => assert.equal(parsed.trains[0].train, 'PARABAT EXPRESS (709)'));
check('seat counts numeric (string "2" -> 2)', () => assert.equal(parsed.trains[0].classes[2].online, 2));
check('fare parsed from "595.00"', () => assert.equal(parsed.trains[0].classes[0].fare, 595));
check('zero seats kept but filterable', () => {
  const free = parsed.trains[0].classes.filter(c => c.online > 0);
  assert.equal(free.length, 2);
});

console.log('\n-- api.buildUrl');
check('encodes spaces', () => {
  const u = BR.api.buildUrl('/bookings/search-trips-v2', {
    from_city: "Cox's Bazar", to_city: 'Dhaka', date_of_journey: '16-Oct-2026', seat_class: 'S_CHAIR'
  });
  assert.ok(u.startsWith('https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2?'));
  assert.ok(u.includes('from_city=Cox%27s+Bazar'));
  assert.ok(u.includes('date_of_journey=16-Oct-2026'));
});

console.log('\n-- stations.resolve');
[
  ['Chatmohar', 'CGB'], ['Dhaka', 'DA'], ['dhaka', 'DA'], ['Dhaka (Kamalapur)', 'DA'],
  ['Ishwardi', 'ISW'], ['Ishurdi', 'ISW'], ['Kishorganj', 'KSG'], ['Kishoreganj', 'KSG'],
  ['chittagong', 'CTG'], ['CTG', 'CTG'], ['ঢাকা', 'DA'], ['Sirajganj Bazar', 'SRJ'],
  ['Cox’s Bazar', 'COX'], ['Panchagarh', 'PCH'], ['Bhairab Bazar', 'BHB']
].forEach(([q, code]) => check(`resolve("${q}") -> ${code}`, () => {
  const s = BR.stations.resolve(q);
  assert.ok(s, 'not found');
  assert.equal(s.code, code);
}));
check('resolve(garbage) -> null', () => assert.equal(BR.stations.resolve('zzz nowhereville'), null));

console.log('\n-- stations.siteName');
check('Dhaka (Kamalapur) -> "Dhaka"', () => assert.equal(BR.stations.siteName(BR.stations.byCode.DA), 'Dhaka'));
check('Ishwardi Junction -> "Ishwardi"', () => assert.equal(BR.stations.siteName(BR.stations.byCode.ISW), 'Ishwardi'));
check('Panchagarh (Bir Muktijoddha…) -> "Panchagarh"', () => assert.equal(BR.stations.siteName(BR.stations.byCode.PCH), 'Panchagarh'));
check('manual override Tejgao -> Tejgaon', () => assert.equal(BR.stations.siteName(BR.stations.byCode.TEJ), 'Tejgaon'));
check('site name override for Kishoreganj', () => assert.equal(BR.stations.siteName(BR.stations.byCode.KSG), 'Kishorganj'));

console.log('\n-- geo');
check('Dhaka -> Chattogram ~ 240km', () => {
  const a = BR.stations.byCode.DA, b = BR.stations.byCode.CTG;
  const d = BR.geo.distanceKm(a.lat, a.lng, b.lat, b.lng);
  assert.ok(d > 200 && d < 270, 'got ' + d);
});
check('roadKm > distanceKm', () => {
  const a = BR.stations.byCode.DA, b = BR.stations.byCode.CTG;
  assert.ok(BR.geo.roadKm(a.lat, a.lng, b.lat, b.lng) > BR.geo.distanceKm(a.lat, a.lng, b.lat, b.lng));
});

console.log('\n-- finder.searchUrl');
check('builds the site search URL', () => {
  assert.equal(BR.finder.searchUrl('Chatmohar', 'Dhaka', '16-Oct-2026', 'S_CHAIR'),
    '/booking/train/search?fromcity=Chatmohar&tocity=Dhaka&doj=16-Oct-2026&class=S_CHAIR');
});

console.log('\n-- planner date helpers');
check('shiftDoj -1', () => assert.equal(BR.planner.shiftDoj('16-Oct-2026', -1), '15-Oct-2026'));
check('shiftDoj +2 across month end', () => assert.equal(BR.planner.shiftDoj('30-Oct-2026', 2), '01-Nov-2026'));
check('parseDoj weekday', () => assert.equal(BR.planner.parseDoj('16-Oct-2026').weekday, 5));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
