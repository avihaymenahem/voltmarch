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
 * A survey counts six things about one player and the three predicates below
 * are the only interpretations of it anyone should write:
 *
 *   canRebuild  — owns a structure that produces something buildable, OR a
 *                 construction vehicle that unpacks into one. This is the test
 *                 the sell guard runs against the world MINUS the structure
 *                 being sold: if the answer is no, the sell is a soft lock.
 *   canContest  — owns at least one unit that is ON THE FIELD and is not a
 *                 harvester. Deliberately loose about what a field unit might
 *                 achieve: a rifleman can still walk into an enemy base and an
 *                 engineer can still capture something, and ending a match a
 *                 player might yet play is a worse error than letting a hopeless
 *                 one run on with a warning on screen. Harvesters are excluded
 *                 because ore you cannot spend is not a comeback; units inside
 *                 a garrison or a hull are excluded for the reason in
 *                 `surveyViability` §HELD, which is the opposite error.
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

import { BuildTab, EntityFlag, EntityKind, NONE } from '../core/types';
import type { EntityId, PlayerId } from '../core/types';
import type { World } from '../core/world';

import { isDeployable } from './Deploy';
import { production } from './Production';

/* ==========================================================================
 * 1. THE SURVEY
 * ========================================================================== */

/** What one player still owns, in the only six categories that decide a match. */
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
  /**
   * Field units that are not harvesters — anything that can go and do
   * something. Excludes anything inside a garrison or a hull; see §HELD.
   */
  contestingUnits: number;
  /**
   * Units inside a structure or a transport (`EntityFlag.Garrisoned`).
   *
   * Counted separately rather than dropped, because "the enemy still owns five
   * men and every one of them is indoors" is the exact state that used to hang
   * a match, and a survey that cannot say so leaves the next report as
   * undiagnosable as the last one. `describeViability` prints it.
   */
  heldUnits: number;
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
    heldUnits: 0,
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
  if (entry === null) return false;
  // A TAB THAT MAKES NOTHING IS NOT PRODUCTION, and `BuildTab.Powers` is the
  // one that makes nothing: a Command Post sells commander powers, which are
  // BITS on the player and never entities. A player down to one of those has
  // exactly the Refinery's problem in the paragraph above — an asset that
  // cannot rebuild anything — and counting it would be the same way of telling
  // a stranded player they are fine.
  for (let i = 0; i < entry.producesTabs.length; i++) {
    if ((entry.producesTabs[i] as BuildTab) !== BuildTab.Powers) return true;
  }
  return false;
}

/**
 * Count what `player` owns, into `out`.
 *
 * Structures still under construction COUNT as producers. A War Factory at 40%
 * finishes on its own — nothing has to be alive to push it — so a player who has
 * one on the ground has a future, and a rule that said otherwise would end
 * matches during the ten seconds after a placement.
 *
 * §HELD — A UNIT INDOORS IS NOT AN ARMY, AND THIS IS WHY THE MATCH HUNG
 * ---------------------------------------------------------------------
 * Reported as *"i killed every visible building and troops and game didnt
 * finish"*. `EntityFlag.Garrisoned` — set by `sim/Garrison.ts` on an occupant
 * and by `sim/Transport.ts` on a passenger — is, measurably, THE ONLY BIT IN
 * THE GAME that makes an owned, living unit both undrawn and untargetable:
 * `RenderBridge.HIDDEN_MASK` is that flag and nothing else, and it is the only
 * member of `TARGETABLE_REJECT_MASK` that a live unit can carry (`Cloaked` has
 * no caller anywhere in `src/`, `NotATarget` is set only on props and wrecks,
 * and `PendingDestroy` is filtered by the loop below before it gets here). So
 * a survey that counted one as a contesting unit was keeping a match open on an
 * asset the opponent cannot see and cannot shoot at.
 *
 * IT IS NOT "HELD THINGS ARE NOT REAL". The occupants of a garrison do real
 * damage. But look at where that damage comes from: `GarrisonService.weaponsTick`
 * resolves ONE target scan on the HOST, pushes the damage record with the HOST
 * as the attacker and draws the muzzle flash on the HOST's wall. The men are
 * that structure's ammunition, not a force in the field — and this engine has
 * never let an armed structure keep a player in a match. A commander down to
 * nothing but Pillboxes and Tesla Coils is BEATEN today, for everyone, because
 * emplacements have never touched `contestingUnits`. A garrison is an
 * emplacement whose firepower happens to be stored in five entities, and
 * counting its ammunition as an army was the inconsistency. A transport
 * passenger is the easier half: `sim/Transport.ts`'s header states that
 * passengers deliberately do not shoot at all, and the HULL is itself a
 * non-harvester vehicle that this loop already counts, so dropping its cargo
 * changes no verdict while the hull lives.
 *
 * WHAT IT COSTS, STATED RATHER THAN GLOSSED. A player whose last force is a
 * squad in a building is now beaten `beatenGraceSeconds` after their last field
 * unit dies, where before they could have evacuated and gone raiding. They are
 * already being warned every `warnRepeatSeconds` by `game/outcome.system.ts`
 * (`isStranded` is unchanged — it reads `hasAssets`, which still counts them),
 * and it binds the AI identically. `src/sim/AI.ts` never garrisons anything, so
 * in a skirmish this can only ever bind a human, which is exactly why it must
 * be written as one rule for both rather than as a victory-side special case.
 *
 * `constructionVehicles` DELIBERATELY STILL COUNTS A HELD UNIT, and the
 * asymmetry has a reason rather than being an oversight. Only infantry can
 * garrison (`Garrison.tally` and every scan there is `byKind[Infantry]`), so a
 * held MCV is necessarily inside a HULL — a visible, targetable field vehicle
 * that this same loop counts. There is no invisible-asset problem to fix, and
 * `canRebuild` is the SELL GUARD's predicate (`Production.applySell`), which
 * must not move on a change about match outcomes.
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
  out.heldUnits = 0;

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
      // §HELD. Inside a building or a hull: not on the field, so not a way to
      // contest the map. Still `units`, so `hasAssets` and therefore
      // `isStranded` and the wiped-out defeat are byte-identical.
      const held = (flags & EntityFlag.Garrisoned) !== 0;
      if (held) out.heldUnits++;
      else if ((flags & EntityFlag.IsHarvester) === 0) out.contestingUnits++;
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

/**
 * Owns something ON THE FIELD that could still go and do damage. Harvesters do
 * not count, and neither does anything indoors — see `surveyViability` §HELD.
 */
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
    + `held ${s.heldUnits} `
    + `${isBeaten(s) ? 'BEATEN' : isStranded(s) ? 'stranded' : 'viable'}`;
}
