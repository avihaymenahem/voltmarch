/**
 * ============================================================================
 * tests/reward-wiring.spec.ts — every reward a mission pays reaches something
 * ============================================================================
 * WHY THIS FILE EXISTS
 * --------------------
 * Five missions paid out `power.airstrike`, `power.orbital-scan`,
 * `power.emergency-repair`, `power.ore-boost` and `power.chronoshift`. All five
 * were recorded on the profile, all five were announced on the end screen as
 * "Commander Power — <name> — Callable once charged, in any match", and no line
 * of code anywhere read any of them. The join that would have caught it —
 * "reward id -> the thing that honours it" — was never written down, so there
 * was nothing to be wrong.
 *
 * `tests/credits-truthful.spec.ts` exists for exactly this shape of rot in the
 * credits screen, and CLAUDE.md gives the reason in one line: **a reviewer
 * noticing is not a mechanism.** This is the same mechanism for rewards.
 *
 * HOW IT WORKS, AND WHY IT CHECKS BOTH DIRECTIONS
 * -----------------------------------------------
 * `WIRING` below claims, for every reward the mission table can pay, WHICH
 * module consumes it. Each claim is then verified against the code:
 *
 *   a `consumer` claim must RESOLVE — the def must really carry the tag, the
 *     power must really be in the table, the lobby must really gate on the map.
 *
 *   a `gap` claim must STILL BE A GAP — nothing may consume it. So a content
 *     gap that someone quietly closes fails this file and has to be re-declared
 *     as wired, and a gap nobody ever closes at least says so out loud, with a
 *     reason, in a place that is read.
 *
 * A reward with neither claim fails. That is the whole point: the next person
 * to add a reward kind, or a reward id, cannot land it inert without either
 * wiring it up or writing down that they did not.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MISSIONS, UNLOCKS } from '../src/data/Missions';
import { BUILDINGS, UNITS, UNLOCK_TAGS } from '../src/data/Defs';
import type { Reward } from '../src/progression/types';
import {
  COMMANDER_POWER_LIST, COMMANDER_POWER_UNLOCK_IDS, powerByUnlockId,
} from '../src/progression/powers';

/* ==========================================================================
 * 0. SOURCE READING — the same technique tests/replay.spec.ts uses
 * ========================================================================== */

const at = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

/** Source with comments stripped: prose that DESCRIBES a call is not a call. */
const code = (rel: string): string => at(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ==========================================================================
 * 1. THE CLAIMS
 * ========================================================================== */

interface Wired {
  /** `module#symbol` — the thing that reads this reward. Prose is not enough. */
  readonly consumer: string;
  /** Proves the consumer really resolves for this reward. */
  readonly resolves: (r: Reward) => boolean;
}

interface Gap {
  /** Why nothing honours it yet. Must be true, and is asserted to still be. */
  readonly gap: string;
  /** Proves nothing consumes it. A gap that closes must be re-declared. */
  readonly stillMissing: (r: Reward) => boolean;
}

type Claim = Wired | Gap;

const isGap = (c: Claim): c is Gap => 'gap' in c;

/** Unlock ids carried by a production def, i.e. honoured by `UnlockGate`. */
const TAGGED: ReadonlySet<string> = new Set(Object.values(UNLOCK_TAGS));

/** Every unlock id any def actually declares, read off the defs themselves. */
const DECLARED_ON_DEFS: ReadonlySet<string> = new Set(
  [...UNITS, ...BUILDINGS]
    .map((d) => (d as { unlockedBy?: string }).unlockedBy)
    .filter((s): s is string => typeof s === 'string' && s.length > 0),
);

const MAP_UNLOCK_IDS: readonly string[] = [
  UNLOCKS.mapFrozenSector, UNLOCKS.mapIndustrialGrid,
  UNLOCKS.mapContestedStrait, UNLOCKS.mapCoralShore,
];

const SUPERWEAPON_UNLOCK_IDS: readonly string[] = [
  UNLOCKS.superSiege, UNLOCKS.superStrategic, UNLOCKS.superChronosphere,
  UNLOCKS.superIronCurtain, UNLOCKS.superSolarLance,
];

const lobbySource = code('src/shell/SkirmishSetup.ts');
/** Map ids the lobby can actually offer. The catalogue, not the gate. */
const MAP_CATALOGUE: ReadonlySet<string> = new Set(
  Array.from(code('src/shell/settings-store.ts').matchAll(/id:\s*'([a-z0-9-]+)',\s*name:/g))
    .map((m) => m[1]!),
);
const powerService = code('src/sim/CommanderPowers.ts');
const rewardCopySource = code('src/shell/Missions.ts');

/**
 * The claim for one reward. One function so the two directions cannot drift:
 * everything the mission table pays comes through here exactly once.
 */
function claimFor(r: Reward): Claim | null {
  switch (r.kind) {
    case 'unlock': {
      const id = r.unlockId;

      if (COMMANDER_POWER_UNLOCK_IDS.includes(id)) {
        return {
          consumer: 'src/sim/CommanderPowers.ts#CommanderPowerService.use',
          resolves: () => {
            const spec = powerByUnlockId(id);
            if (spec === undefined) return false;
            // The service must have a branch for it. A power in the table with
            // no case in the switch is the same inert reward one layer down.
            return powerService.includes(`case CommanderPowerId.${nameOf(spec.key)}:`);
          },
        };
      }

      if (MAP_UNLOCK_IDS.includes(id)) {
        return {
          consumer: 'src/shell/SkirmishSetup.ts#mapAvailable -> progression-link#isMapUnlocked',
          resolves: () => lobbySource.includes('isMapUnlocked(')
            && MAP_CATALOGUE.has(id.replace(/^map\./, '')),
        };
      }

      if (SUPERWEAPON_UNLOCK_IDS.includes(id)) {
        return {
          gap: 'no superweapon STRUCTURE exists in Defs.ts, so nothing can be gated behind '
            + 'these ids. Declared ahead of the content on purpose; see the comment on '
            + 'UNLOCKS.superSiege in src/data/Missions.ts.',
          stillMissing: () => !DECLARED_ON_DEFS.has(id) && !TAGGED.has(id),
        };
      }

      if (id.startsWith('cosmetic.')) {
        return {
          consumer: 'src/shell/Missions.ts#rewardCopy — display only, and it says so',
          // The honest consumer of a cosmetic is the screen that names it. The
          // reward copy promises "No effect on the battle", so display IS the
          // whole contract — unlike a power, which promised to be callable.
          resolves: () => rewardCopySource.includes("case 'cosmetic':")
            && rewardCopySource.includes('No effect on the battle'),
        };
      }

      return {
        consumer: 'src/data/Defs.ts#UNLOCK_TAGS -> progression/UnlockGate#allows',
        resolves: () => TAGGED.has(id) && DECLARED_ON_DEFS.has(id),
      };
    }

    case 'power':
      return {
        consumer: 'src/progression/powers.ts#COMMANDER_POWERS',
        resolves: () => powerByUnlockId(r.powerId) !== undefined,
      };

    case 'map':
      return {
        consumer: 'src/shell/SkirmishSetup.ts#mapAvailable',
        resolves: () => lobbySource.includes('isMapUnlocked(') && MAP_CATALOGUE.has(r.mapId),
      };

    case 'cosmetic':
      return {
        consumer: 'src/shell/Missions.ts#rewardCopy — display only, and it says so',
        resolves: () => rewardCopySource.includes('No effect on the battle'),
      };

    case 'credits':
      return {
        gap: 'NOTHING PAYS THESE. Thirteen match objectives award credits and no module '
          + 'grants them: `Economy.grant` has no caller for a mission reward, and '
          + '`ProgressionView.drainPending` is drained only by the end screen, which '
          + 'prints them. src/ui/ObjectiveBanner.ts advertises "+N credits" while the '
          + 'ledger never moves. It is NOT fixed here because paying it safely is a '
          + 'design problem, not a plumbing one: the objective board is drawn from the '
          + 'profile (`MissionTracker.drawObjectives` skips locked rows), so two lockstep '
          + 'clients with different profiles would be paid different amounts on different '
          + 'ticks. Fixing it needs a profile-independent board or a payout outside the '
          + 'simulation.',
        stillMissing: () => {
          for (const rel of ['src/ui/Objectives.ts', 'src/ui/ObjectiveBanner.ts', 'src/shell/EndScreen.ts']) {
            if (/\.grant\s*\(|getEconomy\s*\(/.test(code(rel))) return false;
          }
          return true;
        },
      };

    default:
      return null;
  }
}

/** `orbitalScan` -> `OrbitalScan`, to match the enum member in the switch. */
function nameOf(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Every reward the shipped table can pay, with the mission that pays it. */
const ALL_REWARDS: ReadonlyArray<readonly [string, Reward]> =
  MISSIONS.flatMap((m) => m.reward.map((r) => [m.id, r] as const));

/* ==========================================================================
 * 2. THE GATE
 * ========================================================================== */

describe('every reward the mission table pays is accounted for', () => {
  it('has a claim for each one — wired, or a gap with a reason', () => {
    const unclaimed: string[] = [];
    for (const [mission, r] of ALL_REWARDS) {
      if (claimFor(r) === null) unclaimed.push(`${mission}: ${r.kind}`);
    }
    expect(
      unclaimed,
      'a reward kind with no entry in WIRING is a reward that may be paying nothing. '
      + 'Add a `consumer` claim, or a `gap` claim saying why not.',
    ).toEqual([]);
  });

  it('resolves every consumer it claims', () => {
    const broken: string[] = [];
    for (const [mission, r] of ALL_REWARDS) {
      const claim = claimFor(r);
      if (claim === null || isGap(claim)) continue;
      if (!claim.resolves(r)) {
        broken.push(`${mission} -> ${describe1(r)} claims ${claim.consumer}, which does not resolve`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('still finds every declared gap genuinely empty', () => {
    // A gap that has quietly been closed must be re-declared as wired, or the
    // list rots into a permanent excuse — which is how the powers survived.
    const closed: string[] = [];
    for (const [mission, r] of ALL_REWARDS) {
      const claim = claimFor(r);
      if (claim === null || !isGap(claim)) continue;
      if (!claim.stillMissing(r)) {
        closed.push(`${mission} -> ${describe1(r)} is declared a gap but something now consumes it`);
      }
    }
    expect(closed).toEqual([]);
  });
});

/* ==========================================================================
 * 3. THE POWERS, BOTH DIRECTIONS
 *
 * The specific defect, pinned. These fail on the old code in the most direct
 * way there is: `src/progression/powers.ts` does not exist there.
 * ========================================================================== */

describe('the five commander powers', () => {
  it('are each paid by exactly one mission', () => {
    for (const power of COMMANDER_POWER_LIST) {
      const payers = MISSIONS.filter(
        (m) => m.reward.some((r) => r.kind === 'unlock' && r.unlockId === power.unlockId),
      );
      expect(payers.map((m) => m.id), `"${power.key}" is not paid exactly once`).toHaveLength(1);
    }
  });

  it('are paid as BOTH an unlock and a power, never one without the other', () => {
    // The `unlock` half is what the profile stores and what the HUD asks about;
    // the `power` half is what the end screen prints. One alone is either a
    // power the player owns and is never told about, or a power the player is
    // told about and does not own.
    for (const m of MISSIONS) {
      for (const r of m.reward) {
        if (r.kind !== 'power') continue;
        expect(
          m.reward.some((o) => o.kind === 'unlock' && o.unlockId === r.powerId),
          `"${m.id}" pays power ${r.powerId} with no matching unlock`,
        ).toBe(true);
      }
      for (const r of m.reward) {
        if (r.kind !== 'unlock' || !COMMANDER_POWER_UNLOCK_IDS.includes(r.unlockId)) continue;
        expect(
          m.reward.some((o) => o.kind === 'power' && o.powerId === r.unlockId),
          `"${m.id}" unlocks power ${r.unlockId} with no matching power reward`,
        ).toBe(true);
      }
    }
  });

  it('each have a branch in the service that fires them', () => {
    for (const power of COMMANDER_POWER_LIST) {
      expect(
        powerService,
        `"${power.key}" is in the table with no case in CommanderPowerService.use`,
      ).toContain(`case CommanderPowerId.${nameOf(power.key)}:`);
    }
  });

  it('are not gated behind a production def, which is what made them look wired', () => {
    // The trap that hid this for so long: `power.*` ids sit in `profile.unlocked`
    // exactly like `unit.raider` does, so they LOOK honoured. `UnlockGate` only
    // ever answers about a def carrying `unlockedBy`, and no def carries these.
    for (const id of COMMANDER_POWER_UNLOCK_IDS) {
      expect(TAGGED.has(id), `${id} is now a def tag — re-point its claim`).toBe(false);
    }
  });
});

/** One line naming a reward, for a failure message. */
function describe1(r: Reward): string {
  switch (r.kind) {
    case 'unlock': return `unlock:${r.unlockId}`;
    case 'power': return `power:${r.powerId}`;
    case 'map': return `map:${r.mapId}`;
    case 'cosmetic': return `cosmetic:${r.cosmeticId}`;
    case 'credits': return `credits:${r.amount}`;
    default: return 'unknown';
  }
}
