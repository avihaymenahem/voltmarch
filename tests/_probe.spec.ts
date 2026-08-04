import { describe, it } from 'vitest';
import { formatStats } from '../src/art/MassList';
import {
  RECLAIM_UNIT_MASS_LISTS, RECLAIM_UNIT_PALETTE, reclaimUnitLibrary,
} from '../src/art/Faction4Units';

describe('probe', () => {
  it('reports', () => {
    for (const l of RECLAIM_UNIT_MASS_LISTS) {
      try {
        const m = reclaimUnitLibrary.build(l, RECLAIM_UNIT_PALETTE, 256, 0x5243);
        console.log(formatStats(m.stats));
        for (const e of m.stats.errors) console.log('  ERR  ' + e);
        for (const w of m.stats.warnings) console.log('  warn ' + w);
      } catch (err) {
        console.log(l.key + ': THREW ' + String(err));
      }
    }
  });
});
