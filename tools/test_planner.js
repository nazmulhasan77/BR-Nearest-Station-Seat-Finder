/* node tools/test_planner.js  -- sanity checks for the data + planner (no browser needed) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
['data/stations.js', 'data/trains.js', 'lib/geo.js', 'lib/stations.js', 'lib/planner.js']
  .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }));

const { BR, BR_DATA } = globalThis;

function line(s) { console.log(s); }
function hr(t) { line('\n===== ' + t + ' ' + '='.repeat(Math.max(0, 60 - t.length))); }

hr('data');
line(`stations: ${BR.stations.all.length}   trains: ${BR_DATA.trains.length}`);

hr('resolve() checks');
[
  'Chatmohar', 'Dhaka', 'Dhaka (Kamalapur)', 'dhaka', 'Ishwardi', 'Ishurdi',
  'Sirajganj Bazar', 'Jamalpur Town', "Cox's Bazar", 'Kishorganj', 'Kishoreganj',
  'Panchagarh', 'Santahar', 'Rajshahi', 'Chattogram', 'ঢাকা', 'chittagong', 'CTG', 'DA',
  'Bhairab Bazar Junction', 'Natore', 'Abdulpur', 'Dhaka Cantonment'
].forEach(q => {
  const s = BR.stations.resolve(q);
  line(`  ${String(q).padEnd(24)} -> ${s ? s.code.padEnd(6) + s.name : 'NOT FOUND'}`);
});

hr('siteName() checks');
['DA', 'CGB', 'DA_AIR', 'DNC'].forEach(c => {
  const s = BR.stations.byCode[c];
  if (s) line(`  ${c.padEnd(8)} -> "${BR.stations.siteName(s)}"   variants: ${BR.stations.siteNameVariants(s).join(' | ')}`);
});

function runCase(fromQ, toQ, doj, opts = {}) {
  const from = BR.stations.resolve(fromQ);
  const to = BR.stations.resolve(toQ);
  if (!from || !to) { line(`  could not resolve ${fromQ} / ${toQ}`); return; }
  const p = BR.planner.parseDoj(doj);
  const plan = BR.planner.buildPlan(Object.assign({
    from, to,
    hops: 2, maxDetourKm: 60, geoCount: 3, maxPairs: 14, weekday: p ? p.weekday : undefined
  }, opts));
  hr(`${from.name} -> ${to.name}   ${doj} (weekday ${p ? p.weekday : '?'})`);
  line(`  trains serving exact route: ${plan.serving.length}`);
  line(`  ${plan.serving.slice(0, 8).map(t => t.code + ' ' + t.name).join(', ')}${plan.serving.length > 8 ? ' …' : ''}`);
  line(`  origin alternatives: ${plan.originOptions.map(o => `${o.station.name} (${o.dir}, ${Math.round(o.km)}km)`).join(', ') || '-'}`);
  line(`  dest  alternatives: ${plan.destOptions.map(o => `${o.station.name} (${o.dir}, ${Math.round(o.km)}km)`).join(', ') || '-'}`);
  line(`  candidate pairs: ${plan.totalPairs} (querying ${plan.pairs.length})`);
  plan.pairs.forEach(pr => {
    line(`    ${pr.from.name.padEnd(24)} -> ${pr.to.name.padEnd(22)} ` +
      `detour ${String(pr.detourKm).padStart(3)}km  ` +
      `fromShift:${pr.fromShift ? pr.fromShift.dir + '/' + pr.fromShift.hops : '-'}  ` +
      `toShift:${pr.toShift ? pr.toShift.dir + '/' + pr.toShift.hops : '-'}  ` +
      `sameTrain:${pr.sameTrain.length}`);
  });
}

const DOJ = '16-Oct-2026';
runCase('Chatmohar', 'Dhaka', DOJ);
runCase('Rajshahi', 'Dhaka', DOJ);
runCase('Dhaka', 'Sylhet', DOJ);
runCase('Chattogram', 'Dhaka', DOJ);
runCase('Khulna', 'Dhaka', DOJ);
runCase('Chatmohar', 'Dhaka', DOJ, { hops: 1, maxPairs: 8 });

hr('date helpers');
line('  shiftDoj(16-Oct-2026, -1) = ' + BR.planner.shiftDoj('16-Oct-2026', -1));
line('  shiftDoj(16-Oct-2026, +2) = ' + BR.planner.shiftDoj('16-Oct-2026', +2));
line('  parseDoj(2026-10-16)      = ' + JSON.stringify(BR.planner.parseDoj('2026-10-16')));
