import { WEAPONS, UNITS, BUILDINGS, UNLOCK_TAGS, FACTIONS } from './src/data/Defs';
import { ARMOR_MATRIX, COMBAT_DAMAGE } from './src/core/config';
import * as CFG from './src/core/config';
declare const process: any;
const out = { WEAPONS, UNITS, BUILDINGS, UNLOCK_TAGS, FACTIONS, ARMOR_MATRIX, COMBAT_DAMAGE,
  CRUSH: {
    CRUSH_SPEED_MIN: (CFG as any).CRUSH_SPEED_MIN,
  },
};
process.stdout.write(JSON.stringify(out));
