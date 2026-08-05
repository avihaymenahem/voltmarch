/**
 * ============================================================================
 * VOLTMARCH — src/sim/Viability.ts
 * ============================================================================
 * CAN THIS PLAYER STILL PLAY?
 *
 * One question, asked from two places that had each answered it differently and
 * both answered it wrong:
 *
 *   1. `Production.applySell` refused a sell only for "not a building / not
 *      yours / not sellable". Selling the last Construction Yard was therefore
 *      legal, instantaneous, unconfirmed and irreversible — and it left a player
 *      who owned nothing else that produces with a bank they could not spend, a
 *      sidebar of greyed cameos and no explanation.
 *   2. `Shell.pollOutcome` declared defeat only at ZERO living assets. A player
 *      with four harvesters and no base is not at zero, so the match never
 *      ended. Between those two rules sat a session that could neither act nor
 *      finish — the bug this module exists to make impossible.
 *
 * THE VOCABULARY
 * --------------
 * A survey counts five things about one player and the three predicates below
 * are the only interpretations of it anyone should write:
 *
 *   canRebuild  — owns a structure that produces something buildable, OR a
 *                 construction vehicle that unpacks into one. This is the test
 *                 the sell guard runs against the world MINUS the structure
 *                 being sold: if the answer is no, the sell is a soft lock.
 *   canContest  — owns at least one unit that is not a harvester. Deliberately
 *                 loose. A rifleman can still walk into an enemy base and an
 *                 engineer can still capture something, and ending a match a
 *                 player might yet play is a worse error than letting a hopeless
 *                 one run on with a warning on screen. Harvesters are excluded
 *                 because ore you cannot spend is not a comeback.
 *   isBeaten    — neither of the above. Nothing to build with, nothing to fight
 *                 with. There is no sequence of inputs that changes the result,
 *                 so the match should say so rather than sit there.
 *
 * WHY IT LIVES IN src/sim AND NOT IN THE SHELL
 * --------------------------------------------
 * Because the sell guard runs inside `simTick` and must see exactly the same
 * rule the outcome poll sees. Two copies of "can this player still play" is how
 * you get a sell that is refused for a state the match then refuses to end.
 * Nothing in here writes: `surveyViability` is a read over the entity store with
 * a caller-supplied output object, so it is legal from a sim tick, from a render
 * frame and from a test, and it allocates nothing on the hot path.
 *
 * DETERMINISM. No clock, no RNG, and iteration order is the store's dense
 * per-kind list, which is allocation order. Two runs of one seed survey
 * identically.
 * ============================================================================
 */

import { EntityFlag, EntityKind, NONE } from '../core/types';
import type { EntityId, PlayerId } from '../core/types';
import type { World } from '../core/world';

import { isDeployable } from './Deploy';
import { production } from './Production';

/* ==========================================================================
 * 1. THE SURVEY
 * ========================================================================== */

/** What one player still owns, in the only five categories that decide a match. */
export interface ViabilitySurvey {
  /** Player index this survey describes. -1 before the first fill. */
  player: number;
  /** Live structures, including ones still under construction. */
  buildings: number;
  /** Live infantry and vehicles. */
  units: number;
  /** Structures that produce something buildable (Con Yard, factories). */
  producers: number;
  /** Units that unpack into a structure (MCV and its two cousins). */
  constructionVehicles: number;
  /** Units that are not harvesters — anything that can go and do something. */
  contestingUnits: number;
}

/** A reusable survey. Fill it with `surveyViability`; never allocate per frame. */
export function makeViabilitySurvey(): ViabilitySurvey {
  return {
    player: -1,
    buildings: 0,
    units: 0,
    producers: 0,
    constructionVehicles: 0,
    contestingUnits: 0,
  };
}

/**
 * Overrides for a survey.
 *
 * `ignore` is what makes the sell guard honest: it asks "what would I own if
 * this structure were already gone", which is a different question from "what
 * do I own", and answering the second one would let a player sell their only
 * Construction Yard because, at the moment of the check, they still had it.
 *
 * `isProducer` exists so `ProductionService` can answer from the catalog it
 * already holds rather than through the module singleton — a service that has
 * not been published yet (every headless test that never calls `setProduction`)
 * would otherwise fail the check against its own buildings.
 */
export interface ViabilityProbes {
  /** Pretend this entity is already gone. */
  readonly ignore?: EntityId;
  /** True when this building slot produces something buildable. */
  readonly isProducer?: (world: World, slot: number) => boolean;
  /** True when this unit slot unpacks into a structure. */
  readonly isConstructionVehicle?: (world: World, slot: number) => boolean;
}

const NO_PROBES: ViabilityProbes = {};

/** Kinds that count as "a unit". Wrecks, props and crates are not assets. */
const UNIT_KINDS: readonly EntityKind[] = [EntityKind.Infantry, EntityKind.Vehicle];

/**
 * Does the structure in `slot` produce anything buildable?
 *
 * Flags first because they are free and a scenario sets them directly, then the
 * production catalog, which is the authority (`producesTabs` is what
 * `availabilityOf` gates every cameo on). A Refinery deliberately fails both: it
 * earns money, it does not build, and treating it as production is exactly how a
 * "you can still play" check tells a stranded player they are fine.
 */
export function defaultIsProducer(world: World, slot: number): boolean {
  const st = world.store;
  if ((st.flags[slot] & (EntityFlag.IsBuilder | EntityFlag.IsFactory)) !== 0) return true;
  const entry = production()?.entryOf(st.handleOf(slot)) ?? null;
  return entry !== null && entry.producesTabs.length > 0;
}

/**
 * Count what `player` owns, into `out`.
 *
 * Structures still under construction COUNT as producers. A War Factory at 40%
 * finishes on its own — nothing has to be alive to push it — so a player who has
 * one on the ground has a future, and a rule that said otherwise would end
 * matches during the ten seconds after a placement.
 */
export function surveyViability(
  world: World,
  player: PlayerId,
  out: ViabilitySurvey,
  probes: ViabilityProbes = NO_PROBES,
): ViabilitySurvey {
  const st = world.store;
  const owner = player as number;
  const ignore = probes.ignore ?? NONE;
  const isProducer = probes.isProducer ?? defaultIsProducer;
  const isConVehicle = probes.isConstructionVehicle ?? isDeployable;

  out.player = owner;
  out.buildings = 0;
  out.units = 0;
  out.producers = 0;
  out.constructionVehicles = 0;
  out.contestingUnits = 0;

  const dead = EntityFlag.PendingDestroy;

  const blist = st.byKind[EntityKind.Building];
  const bcount = st.byKindCount[EntityKind.Building];
  for (let a = 0; a < bcount; a++) {
    const i = blist[a];
    if (st.owner[i] !== owner) continue;
    const flags = st.flags[i];
    if ((flags & EntityFlag.Alive) === 0) continue;
    if ((flags & dead) !== 0) continue;
    if (ignore !== NONE && st.handleOf(i) === ignore) continue;
    out.buildings++;
    if (isProducer(world, i)) out.producers++;
  }

  for (let k = 0; k < UNIT_KINDS.length; k++) {
    const list = st.byKind[UNIT_KINDS[k]];
    const count = st.byKindCount[UNIT_KINDS[k]];
    for (let a = 0; a < count; a++) {
      const i = list[a];
      if (st.owner[i] !== owner) continue;
      const flags = st.flags[i];
      if ((flags & EntityFlag.Alive) === 0) continue;
      if ((flags & dead) !== 0) continue;
      if (ignore !== NONE && st.handleOf(i) === ignore) continue;
      out.units++;
      if ((flags & EntityFlag.IsHarvester) === 0) out.contestingUnits++;
      if (isConVehicle(world, i)) out.constructionVehicles++;
    }
  }

  return out;
}

/* ==========================================================================
 * 2. THE THREE READINGS
 * ========================================================================== */

/** Owns anything at all. The classic "wiped out" test is `!hasAssets`. */
export function hasAssets(s: ViabilitySurvey): boolean {
  return s.buildings + s.units > 0;
}

/** Can put a new structure or a new unit on the field, now or after a deploy. */
export function canRebuild(s: ViabilitySurvey): boolean {
  return s.producers > 0 || s.constructionVehicles > 0;
}

/** Owns something that could still go and do damage. Harvesters do not count. */
export function canContest(s: ViabilitySurvey): boolean {
  return s.contestingUnits > 0;
}

/**
 * Still on the field, but with no way to replace anything. The state that earns
 * a warning — NOT a defeat, because an army with no base can still win.
 */
export function isStranded(s: ViabilitySurvey): boolean {
  return hasAssets(s) && !canRebuild(s);
}

/**
 * Nothing to build with and nothing to fight with. No sequence of inputs
 * changes the outcome from here, so the match owes the player an answer.
 * `!hasAssets` implies this, which is deliberate: total elimination is the
 * degenerate case of being beaten, not a separate rule.
 */
export function isBeaten(s: ViabilitySurvey): boolean {
  return !canRebuild(s) && !canContest(s);
}

/** One line for the boot log and the F3 overlay. */
export function describeViability(s: ViabilitySurvey): string {
  return `p${s.player}: ${s.buildings}b/${s.units}u `
    + `prod ${s.producers} mcv ${s.constructionVehicles} contest ${s.contestingUnits} `
    + `${isBeaten(s) ? 'BEATEN' : isStranded(s) ? 'stranded' : 'viable'}`;
}
