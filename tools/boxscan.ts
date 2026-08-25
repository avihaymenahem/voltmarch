/**
 * Where every unit in the game sits on the boxiness metric.
 *
 *   npx vite-node tools/boxscan.ts
 *
 * This started as a throwaway probe answering one question — can
 * `BOXINESS.warn` / `.reject` ever fire? — and the answer was no: the
 * thresholds sat above the boxiest unit in the game, so the gate could not
 * catch anything that existed.
 *
 * It is committed rather than deleted because the measured-roster table in
 * `src/art/MassList.ts` §4b had rotted into being wrong in every single row
 * while claiming to tell the next author what "good" looks like. A table of
 * measurements that cannot be regenerated in one command is a table that will
 * be wrong again by the next release. Run this, paste the result.
 *
 * Pure data + arithmetic: `boxiness()` reads mass definitions, so there is no
 * GL context and no build step involved.
 */
import { BOXINESS, boxiness, type UnitMassList } from '../apps/game/src/art/MassList';
import { UNIT_MASS_LISTS } from '../apps/game/src/art/UnitDefs';
import { MERIDIAN_UNIT_MASS_LISTS } from '../apps/game/src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../apps/game/src/art/Faction4Units';

const all: Array<[string, UnitMassList]> = [
  ...UNIT_MASS_LISTS.map((l) => ['allied/soviet', l] as [string, UnitMassList]),
  ...MERIDIAN_UNIT_MASS_LISTS.map((l) => ['meridian', l] as [string, UnitMassList]),
  ...RECLAIM_UNIT_MASS_LISTS.map((l) => ['reclaim', l] as [string, UnitMassList]),
];

const rows = all.map(([roster, l]) => {
  const b = boxiness(l);
  return { roster, key: l.key, cls: l.cls, score: b.score, axis: b.axisFraction };
});

rows.sort((a, b) => b.score - a.score);
const byAxis = [...rows].sort((a, b) => b.axis - a.axis);

console.log('thresholds   warn', BOXINESS.warn, '/ axisWarn', BOXINESS.axisWarn,
  '  reject', BOXINESS.reject, '/ axisReject', BOXINESS.axisReject);
console.log('units measured:', rows.length);

console.log('\nTOP 12 BY SCORE');
for (const r of rows.slice(0, 12)) {
  console.log(`  ${r.score.toFixed(3)}  axis ${r.axis.toFixed(3)}  ${r.roster.padEnd(13)} ${r.cls.padEnd(9)} ${r.key}`);
}

console.log('\nTOP 8 BY AXIS FRACTION');
for (const r of byAxis.slice(0, 8)) {
  console.log(`  axis ${r.axis.toFixed(3)}  score ${r.score.toFixed(3)}  ${r.roster.padEnd(13)} ${r.cls.padEnd(9)} ${r.key}`);
}

console.log('\nWORST score', rows[0].score.toFixed(4), `(${rows[0].key})`,
  '| WORST axis', byAxis[0].axis.toFixed(4), `(${byAxis[0].key})`);
console.log('headroom to warn     ', (BOXINESS.warn - rows[0].score).toFixed(4));
console.log('headroom to axisWarn ', (BOXINESS.axisWarn - byAxis[0].axis).toFixed(4));

console.log('\nFULL LIST (score / axis), worst first');
for (const r of rows) {
  console.log(`  ${r.score.toFixed(3)} / ${r.axis.toFixed(3)}  ${r.roster.padEnd(13)} ${r.cls.padEnd(9)} ${r.key}`);
}
