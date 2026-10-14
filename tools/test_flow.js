/* node tools/test_flow.js
   End-to-end dry run of the planner + finder against a MOCKED railway API,
   so the whole extension logic can be exercised without a browser or a token. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
['data/stations.js', 'data/site-names.js', 'data/trains.js', 'lib/geo.js', 'lib/stations.js',
  'lib/planner.js', 'lib/api.js', 'lib/finder.js']
  .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }));

const { BR } = globalThis;
const F = BR.finder, S = BR.stations, P = BR.planner;

/* ------------------------------------------------------------------ */
/* fake API                                                            */
/* ------------------------------------------------------------------ */
const SEAT_PLAN = {                      // which (from,to) pairs "have" seats
  'Dhaka|Dhaka (Kamalapur)': 0,
  'Chatmohar|Dhaka': 0,                  // the route the user wants -> sold out
  'Ishwardi Junction|Dhaka': 3,
  'Boral Bridge|Dhaka': 12,
  'Chatmohar|Tejgao': 5,
  'Gofurabad|Dhaka': 0,
  'Dhaka|Dhaka Airport (Biman Bandar)': 21
};

function fakeTrains(fromName, toName, dateStr, seatClass) {
  // resolve the names the way the real API would (it returns trains for that pair)
  const f = S.resolve(fromName), t = S.resolve(toName);
  if (!f || !t) return [];
  const serving = P.trainsServing(f.code, t.code, (P.parseDoj(dateStr) || {}).weekday);
  const seats = SEAT_PLAN[f.name + '|' + t.name] || 0;
  if (!seats) return serving.length ? [] : [];       // sold out -> empty list
  return serving.slice(0, 3).map((sv, i) => ({
    trip_number: `${sv.name} (${sv.code})`,
    departure_date_time: `${dateStr} ${String(6 + i * 3).padStart(2, '0')}:15:00`,
    seat_types: [{
      type: seatClass === 'ALL' ? 'S_CHAIR' : seatClass,
      fare: 345 + i * 40,
      seat_counts: { online: Math.max(1, seats - i * 2), offline: 4 }
    }]
  }));
}

const CALL_LOG = [];

async function mockQuery(creds, q, opts) {
  const url = BR.api.buildUrl(BR.api.PATHS[0], q);
  CALL_LOG.push(url);
  if (!creds || !creds.token) return { ok: false, error: 'NO_TOKEN' };
  const trains = fakeTrains(q.from_city, q.to_city, q.date_of_journey, q.seat_class);
  return { ok: true, trains: BR.api.parseTrains({ data: { trains } }).trains, status: 200 };
}

/* ------------------------------------------------------------------ */
/* simulate one full run                                               */
/* ------------------------------------------------------------------ */
async function simulate(fromQ, toQ, doj, seatClass, settings) {
  const from = S.resolve(fromQ), to = S.resolve(toQ);
  const route = {
    from, to, fromRaw: fromQ, toRaw: toQ, doj, seatClass
  };
  const built = F.buildQueries(route, settings);
  const results = {};
  for (const item of built.queries) {
    results[item.key] = await mockQuery({ token: 'fake' }, item.q, {});
  }
  const { rows, stats } = F.rowsFromResults(results, built.meta, route, settings);
  return { built, rows, stats, route };
}

function show(title, out) {
  console.log('\n' + '='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
  const { built, rows, stats } = out;
  console.log(`queries: ${built.queries.length}   api ok: ${stats.ok}   failed: ${stats.failed}`);
  console.log('pairs queried:');
  built.queries.forEach(q => console.log(`   ${q.q.from_city} -> ${q.q.to_city}   ${q.q.date_of_journey}   ${q.q.seat_class}`));
  console.log('\nresults:');
  if (!rows.length) console.log('   (none)');
  rows.forEach(r => {
    const badges = [];
    if (r.leg.exact) badges.push('YOUR ROUTE');
    else {
      if (r.leg.fromShift) badges.push(`board ${r.leg.fromShift.dir} +${r.leg.fromShift.km}km`);
      if (r.leg.toShift) badges.push(`off ${r.leg.toShift.dir} +${r.leg.toShift.km}km`);
      if (r.leg.sameTrain.length) badges.push('same train');
    }
    if (r.off) badges.push(`${r.off > 0 ? '+' : ''}${r.off}d`);
    console.log(`   ${r.train.padEnd(34)} ${r.fromName} -> ${r.toName}`.padEnd(84) +
      `${r.classes.map(c => c.type + ':' + c.online).join(', ')}   [${badges.join(' · ')}]`);
    console.log(`      open: ${F.searchUrl(r.fromName, r.toName, r.doj, 'S_CHAIR')}`);
  });
  if (stats.emptyAltPairs.length) {
    console.log(`\n   ${stats.emptyAltPairs.length} alternative pair(s) returned no trains at all:`);
    stats.emptyAltPairs.slice(0, 6).forEach(m =>
      console.log(`     ${m.fromName} -> ${m.toName}`));
  }
}

(async () => {
  const settings = {
    hops: 2, maxDetourKm: 60, geoCount: 3, maxPairs: 14,
    dateOffsets: [0], onlyMyClass: false, nameOverrides: {}
  };

  await show('Chatmohar -> Dhaka, 16-Oct-2026, S_CHAIR  (exact route sold out)',
    await simulate('Chatmohar', 'Dhaka', '16-Oct-2026', 'S_CHAIR', settings));

  await show('Chatmohar -> Dhaka with -1/+1 day enabled',
    await simulate('Chatmohar', 'Dhaka', '16-Oct-2026', 'S_CHAIR',
      Object.assign({}, settings, { dateOffsets: [-1, 0, 1] })));

  await show('Rajshahi -> Dhaka, hops=1',
    await simulate('Rajshahi', 'Dhaka', '16-Oct-2026', 'S_CHAIR',
      Object.assign({}, settings, { hops: 1 })));

  console.log(`\ntotal mocked API calls: ${CALL_LOG.length}`);
  console.log('sample url: ' + CALL_LOG[0]);
})();
