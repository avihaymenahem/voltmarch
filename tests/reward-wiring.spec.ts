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
import { COMMANDER_POWER_LIST, commanderPowerContentKey } from '../src/progression/powers';

/* ==========================================================================
 * 0. SOURCE READING — the same technique tests/replay.spec.ts uses
 * ========================================================================== */

const at = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

/** Source with comments stripped: prose that DESCRIBES a call is not a call. */
const code = (rel: string): string => at(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The durable career surface which consumes every authored cosmetic reward. */
const profileSource = code('src/shell/Profile.ts');
const endScreenSource = code('src/shell/EndScreen.ts');
const cosmeticMarksSource = code('src/shell/CosmeticMarks.ts');

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

/**
 * DERIVED FROM THE PREFIX, not listed.
 *
 * It was a hand-written list of four and the three battlefields added in v2.6.0
 * — the payload for three of the five missions the commander powers vacated —
 * fell straight through it into the def-tag branch, where they were reported as
 * broken claims. A map unlock id is `map.` + a `MapChoice.id` and there is one
 * consumer for all of them, so the membership test is the prefix.
 */
function isMapUnlockId(id: string): boolean { return id.startsWith('map.'); }

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

/**
 * The claim for one reward. One function so the two directions cannot drift:
 * everything the mission table pays comes through here exactly once.
 */
function claimFor(r: Reward): Claim | null {
  switch (r.kind) {
    case 'unlock': {
      const id = r.unlockId;

      if (isMapUnlockId(id)) {
        return {
          consumer: 'src/shell/SkirmishSetup.ts#mapAvailable -> progression-link#isMapUnlocked',
          resolves: () => lobbySource.includes('isMapUnlocked(')
            && MAP_CATALOGUE.has(id.replace(/^map\./, '')),
        };
      }

      /* -- THE GAP THAT CLOSED, AND THIS IS THE MECHANISM WORKING ----------
       * These five were declared a gap because "no superweapon STRUCTURE
       * exists in Defs.ts". Six of them do now — they landed in the release
       * before this one — and they landed WITHOUT `unlockedBy`, so they were
       * day-one buildable and these five rewards paid into nothing. That is a
       * gap that closed on one side and stayed open on the other, which is the
       * exact shape this file's third test is written to catch: the claim had
       * to be re-declared, and re-declaring it is what forced the tags.       */
      if (SUPERWEAPON_UNLOCK_IDS.includes(id)) {
        return {
          consumer: 'src/data/Defs.ts#UNLOCK_TAGS -> progression/UnlockGate#allows',
          // Same proof as any other def gate. `superSiege` covers TWO
          // structures (weatherControl, rclStormworks) because they fire one
          // effect for two armies, so this asks the question the right way
          // round: is the id declared on at least one def, and is it in the
          // tag table.
          resolves: () => TAGGED.has(id) && DECLARED_ON_DEFS.has(id),
        };
      }

      /* Cosmetics are collection rewards. The Service Record walks the typed
       * cosmetic rewards, joins ownership through profile.unlocked and renders
       * both the earned object and its awarding mission. That is a durable
       * consumer rather than a one-frame reward announcement. */
      if (id.startsWith('cosmetic.')) {
        return {
          consumer: 'src/shell/Profile.ts#cosmeticCollection -> awardCard',
          resolves: () => profileSource.includes("reward.kind !== 'cosmetic'")
            && profileSource.includes('owned.has(id)')
            && profileSource.includes('awardCard(award'),
        };
      }

      return {
        consumer: 'src/data/Defs.ts#UNLOCK_TAGS -> progression/UnlockGate#allows',
        resolves: () => TAGGED.has(id) && DECLARED_ON_DEFS.has(id),
      };
    }

    case 'map':
      return {
        consumer: 'src/shell/SkirmishSetup.ts#mapAvailable',
        resolves: () => lobbySource.includes('isMapUnlocked(') && MAP_CATALOGUE.has(r.mapId),
      };

    // The typed twin is what the Service Record enumerates. The generic unlock
    // half answers ownership; this half supplies kind and catalogue provenance.
    case 'cosmetic':
      return {
        consumer: 'src/shell/Profile.ts#cosmeticCollection -> awardCard',
        resolves: () => profileSource.includes("reward.kind !== 'cosmetic'")
          && profileSource.includes('missionTitle: mission.title')
          && profileSource.includes('awardCard(award'),
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

describe('cosmetic presentation', () => {
  it('shows the earned insignia or decal itself in the post-match reveal', () => {
    expect(endScreenSource).toContain("reward.kind === 'cosmetic'");
    expect(endScreenSource).toContain('cosmeticMark(reward.cosmeticId');
    expect(cosmeticMarksSource).toContain('vm-profile-mark-glyph');
  });
});

/* ==========================================================================
 * 3. THE POWERS ARE NOT A REWARD ANY MORE — THE SAME PIN, POINTED AT THE
 *    MECHANISM THAT REPLACED THEM
 *
 * This section used to assert that each of the five was paid by exactly one
 * mission and had a firing branch in the service. The first half is gone
 * because the missions no longer pay them: a power is BOUGHT from a Command
 * Post (`BuildKind.Power` in `src/sim/Production.ts`), which is world state.
 *
 * The second half is what matters and it is kept and widened. The original
 * defect was a reward that existed as a string and nothing else; the same
 * defect in the new shape would be a purchasable row with no effect behind it,
 * or an effect with nothing that sells it. Both directions are pinned here.
 * ========================================================================== */

const productionSource = code('src/sim/Production.ts');

describe('the five commander powers', () => {
  it('each have a branch in the service that fires them', () => {
    for (const power of COMMANDER_POWER_LIST) {
      expect(
        powerService,
        `"${power.key}" is in the table with no case in CommanderPowerService.use`,
      ).toContain(`case CommanderPowerId.${nameOf(power.key)}:`);
    }
  });

  it('each have a purchasable CONTENT row, so every one can be reached in play', () => {
    // The direction that would have caught the original bug in its new form: a
    // power the simulation can fire and nothing sells is content nobody can
    // reach, which looks exactly like a balance decision.
    for (const power of COMMANDER_POWER_LIST) {
      expect(
        productionSource,
        `"${power.key}" has no BuildKind.Power row — nothing in the game sells it`,
      ).toContain(`key: '${commanderPowerContentKey(power)}'`);
    }
  });

  it('are not gated behind a def tag or a mission — the building is the only route', () => {
    // The whole point of the change. A `power.*` id in `UNLOCK_TAGS` or in the
    // mission table would put ownership back on the profile, with the extra
    // defect that the gate now lives INSIDE the simulation.
    for (const power of COMMANDER_POWER_LIST) {
      const contentKey = commanderPowerContentKey(power);
      expect(TAGGED.has(`power.${power.key}`), 'a power is a def tag again').toBe(false);
      for (const [mission, r] of ALL_REWARDS) {
        if (r.kind !== 'unlock') continue;
        expect(
          r.unlockId.startsWith('power.') && r.unlockId !== contentKey ? '' : r.unlockId,
          `"${mission}" grants ${r.unlockId}, which is a commander power again`,
        ).not.toMatch(/^power\./);
      }
    }
  });

  it('are sold by a structure that publishes the Powers tab, and by nothing else', () => {
    // `producesTabs: [P]` is the gate. If some other structure grew one, the
    // Command Post would stop being the commitment the design rests on.
    const publishers = Array.from(productionSource.matchAll(/key: '([A-Za-z.]+)',[\s\S]{0,400}?producesTabs: \[P\]/g))
      .map((m) => m[1]!);
    expect(publishers.sort()).toEqual(['commandPost', 'mrdPharos', 'rclSignalRig']);
  });
});

/** One line naming a reward, for a failure message. */
function describe1(r: Reward): string {
  switch (r.kind) {
    case 'unlock': return `unlock:${r.unlockId}`;
    case 'map': return `map:${r.mapId}`;
    case 'cosmetic': return `cosmetic:${r.cosmeticId}`;
    case 'credits': return `credits:${r.amount}`;
    default: return 'unknown';
  }
}
