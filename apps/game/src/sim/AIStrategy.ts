/**
 * ============================================================================
 * VOLTMARCH — src/sim/AIStrategy.ts
 * ============================================================================
 * THE AI's CONTENT MODEL AND ITS DOCTRINE. No world, no entities, no commands.
 *
 * Everything here is pure: data tables plus functions over them. `AI.ts` holds
 * all of the state and all of the side effects; this file holds everything the
 * brain KNOWS before the match starts. Splitting it that way means the doctrine
 * can be unit-tested with no World, no Channels and no GL context, and it means
 * a balance change is a data edit rather than a control-flow edit.
 *
 * FOUR THINGS LIVE HERE
 * ---------------------
 * 1. THE CATALOG. The AI needs cost, tab, prereqs, power and footprint for
 *    everything it might build. When `src/data/**` publishes a real `DefTables`
 *    those numbers come from there and the AI plays the real game. Until then
 *    `FALLBACK_CATALOG` supplies the same shape so the brain is fully
 *    exercisable today — the AI is written once and never learns it was talking
 *    to a stub.
 *
 * 2. THE OPENING. A fixed structure order per faction, bent by personality.
 *    Real RTS AIs open from a script and only start thinking once the script
 *    runs out, because the first ninety seconds have no meaningful decisions in
 *    them and an AI that "reasons" about them just plays worse, slower.
 *
 * 3. THE COMPOSITION SCORER. This is the honest difficulty axis. Every AI sees
 *    exactly what its vision grid shows it (see the IVision discipline in
 *    AI.ts). What changes with difficulty is how well it USES that: at
 *    composition 0 the army roll is flat, at composition 1 every unit is picked
 *    for how well it answers the threat mix actually observed. An Easy AI that
 *    builds nine light tanks into massed infantry is losing to its own
 *    decisions, not to a handicap we bolted on.
 *
 * 4. THE LATE GAME (section 3b). Which superweapon an army builds and what it
 *    aims at, when a commander power is worth its charge, and whether a 1200-
 *    credit multiplier beats the 1200 credits of tank it competes with. All
 *    three shipped in v2.2.0 fully player-usable and the AI simply never asked;
 *    what was missing was never plumbing, it was an opinion, and this is it.
 *
 * TWO IMPORTS THAT LOOK LIKE LAYERING VIOLATIONS AND ARE NOT. `./Upgrades` and
 * `../progression/powers` are both LEAF DATA TABLES — neither imports the
 * engine, the world or the entity store, and `sim/CommanderPowers.ts` already
 * reaches for the second one. Taking the twelve upgrade rows and the five power
 * ids from the tables that define them is the alternative to a fourth
 * hand-maintained copy of both lists, which is the exact defect
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues. The rule this file actually keeps —
 * `src/sim/**` never imports `src/data/**` — is untouched.
 *
 * DETERMINISM: nothing in this file reads a clock or a global RNG. `pickUnit`
 * takes the `IRng` the sim step handed us.
 * ============================================================================
 */

import {
  AI_SKILL, AI_THREAT_CLASS_COUNT, BUILDING_DIMENSIONS, NAVAL_BUILDING_DIMENSIONS, SIM_HZ,
  AI_DIFFICULTY, AI_PERSONALITY, FACTORY_SPEED_BONUS, FACTORY_SPEED_CAP,
} from '../core/config';
import { BuildTab, EntityKind, Faction, UpgradeLever, UpgradeScope } from '../core/types';
import type { ArmorClass, DefTables, UnitDef, BuildingDef } from '../core/types';
import { CommanderPowerId } from '../progression/powers';
import { UPGRADES } from './Upgrades';

/* ==========================================================================
 * 1. VOCABULARY
 * ========================================================================== */

/**
 * What a thing is FOR, from the strategist's point of view. This is the axis
 * the build layer scores on — it never reasons about "grizzly", it reasons
 * about "I need another Vehicle producer".
 */
export const enum BuildRole {
  /** Construction Yard. Losing every one of these is the crippled state. */
  Builder = 0,
  Power = 1,
  Refinery = 2,
  /** Produces infantry. */
  Barracks = 3,
  /** Produces vehicles. */
  WarFactory = 4,
  /** Unlocks the mid tier and lights the minimap. */
  Radar = 5,
  /** Unlocks the top tier. */
  TechLab = 6,
  /** Raises the credit cap. */
  Storage = 7,
  /** Static ground defence. */
  Defense = 8,
  /** Static defence that can answer something airborne. */
  AntiAir = 9,
  /** Mines ore. */
  Harvester = 10,
  /** Cheap, fast, expendable — the scout and the early rush body. */
  Skirmisher = 11,
  /** Line infantry. */
  Infantry = 12,
  /** Main battle line. */
  Armor = 13,
  /** Long-ranged / high-tech striker. */
  Siege = 14,
  /** Commanders and other unique non-composition support. */
  Support = 15,
  /** Redeploys into a Construction Yard. */
  Mcv = 16,
  /**
   * A structure this AI has no opinion about — a civilian building, a wall, or
   * anything the flag heuristic cannot separate. Deliberately its own bucket
   * rather than being folded into Storage: an AI that believes it owns twelve
   * ore silos is reporting a lie to whoever reads the probe.
   */
  Unknown = 17,
  /**
   * The Repair Depot. Its own role rather than `Support`, and the reason is
   * the classifier below rather than doctrine.
   *
   * `roleOfBuilding`'s flag fallback ends with "2x2 and draws power" => TechLab,
   * because until now nothing else in the game matched that description. A
   * depot does, exactly. Folding it into Storage or Unknown would have been
   * enough to stop the misfile, but `roleCount[TechLab] > 0` is the gate on
   * every top-tier unit the AI can build — an army that thought a service pad
   * was its Proving Ground would stop building the real one and quietly never
   * field a Refractor Tank for the rest of the match.
   */
  Repair = 18,
  /**
   * A superweapon structure. Its own role for exactly the reason `Repair` is:
   * `roleOfBuilding`'s flag fallback ends at "draws power and is bigger than
   * 1x1" => TechLab, and a Nuclear Silo matches that to the letter. An AI that
   * filed one as its Proving Ground would believe the tech gate was already open
   * and stop building the real lab.
   *
   * That paragraph used to end "Nothing in `AI.considerBuild` asks for this
   * role, so the AI does not build superweapons yet." It does now — see
   * `superweaponPlanFor` below and `AiBrain.lateGame` — and the classification
   * job is still the reason the role has to be its own bucket.
   */
  Superweapon = 19,
  /**
   * A purchasable in-match upgrade. NOT A STRUCTURE AND NOT A UNIT, which is
   * why it cannot borrow either of the buckets above.
   *
   * `roleCount` is indexed by this enum and is fed from `roleOfBuilding`, so an
   * upgrade never lands in it — an upgrade never becomes an entity at all. The
   * role exists so the build layer can ASK for one (`upgradePlanFor`) using the
   * same `CatalogEntry` machinery every other purchase goes through, and so
   * `buildUnits` can tell an upgrade apart from a tank when it walks
   * `catalog.all` looking for something to shoot with.
   */
  Upgrade = 20,
  /**
   * A Naval Yard, Sub Pen, Slipway or Breaker Dock.
   *
   * ITS OWN BUCKET FOR THE REASON `Repair` AND `Superweapon` ARE, and this one
   * was already mis-filing before the AI could build one. `roleOfBuilding`'s
   * flag fallback reaches `IsFactory` and separates barracks from war factory
   * by width: "every infantry producer is 2 cells wide, every vehicle producer
   * is 3". Every naval yard in the game is `IsFactory` and 3x3, so it lands on
   * `BuildRole.WarFactory` exactly — and `roleCount[WarFactory] > 0` is the gate
   * that stops the build layer asking for a war factory. An AI that built a
   * dock would have believed it owned a tank plant and never built one.
   */
  NavalYard = 21,
  /**
   * A hull with seats. NOT `Support`, and never a weight in `buildUnits`.
   *
   * The composition scorer picks army by answer vector; a transport answers
   * nothing and is bought for a PLAN, not for a threat mix. It is also the row
   * `census` keys the strike-group exclusion off — see `isNavalHull`.
   */
  Transport = 22,
  /**
   * An armed hull that floats. Escorts and capital ships both.
   *
   * The exclusion this role exists for is the same one the transport gets and
   * it is the more dangerous of the two: a warship carries `CanAttack`, so
   * without a role of its own the census drops it straight into `armyIds`, the
   * squad layer tags it GROUP_STRIKE, and the AI marches a destroyer overland
   * at the enemy base. It would count toward `waveThreshold` on the way, so the
   * wave that never arrives is also a wave that is permanently N units short.
   */
  Warship = 23,
  /**
   * The Command Post — the ONE structure that publishes `BuildTab.Powers`.
   *
   * A ROLE OF ITS OWN, and not because the AI needs a fifth adjective: without
   * one, `roleOfBuilding`'s flag fallback ends at "2x2 and draws power => a tech
   * lab", so a standing Command Post would be counted as the army's Proving Ground
   * and the brain would stop building the real one — every tier-3 hull silently
   * unreachable for the rest of the match. `forRole(TechLab)` would also be able
   * to answer with it.
   */
  CommandPost = 24,
  /**
   * A purchasable commander power. `BuildRole.Upgrade`'s twin.
   *
   * Separate because `requestProduction` has to record an ASK TICK for anything
   * that produces no entity — an upgrade and a power are both invisible to
   * every census, so without it the scorer re-proposes the same 2500-credit
   * purchase on every build pass forever — and because the two have different
   * plans, different earn conditions and different caps.
   */
  CommanderPower = 25,
  /**
   * A cheap fast hull bought for its sight radius, not its gun.
   *
   * A ROLE OF ITS OWN because `BuildRole.Warship` carries a CAP — `maxWarships`
   * — and a recon boat competing with escorts for those three slots would mean
   * an army that can see the enemy and not fight them, or the reverse, chosen
   * by whichever `forRole` returned first. It also keeps `holdTheLane` off it:
   * parking the map's best eyes on a station midpoint is the one thing a scout
   * must not do.
   */
  ReconHull = 26,
  /** Infantry bought for a capture operation, separate from commander support. */
  Engineer = 27,
}
export const BUILD_ROLE_COUNT = 28;

/**
 * The five things an army can be asked to kill. The composition scorer works
 * in this space so it never needs the weapon table: a unit is described by how
 * well it answers each class, which is exactly the judgement a player makes.
 */
export const enum ThreatClass {
  Infantry = 0,
  /** Jeeps, harvesters, transports — thin-skinned vehicles. */
  Light = 1,
  /** Battle tanks. */
  Heavy = 2,
  /** Structures, including static defence. */
  Structure = 3,
  /** Anything airborne. */
  Air = 4,
}

/** Human-readable names, for the debug probe. */
export const THREAT_CLASS_NAMES: readonly string[] = ['infantry', 'light', 'heavy', 'structure', 'air'];

export const BUILD_ROLE_NAMES: readonly string[] = [
  'builder', 'power', 'refinery', 'barracks', 'warFactory', 'radar', 'techLab',
  'storage', 'defense', 'antiAir', 'harvester', 'skirmisher', 'infantry',
  'armor', 'siege', 'support', 'mcv', 'unknown', 'repair', 'superweapon',
  'upgrade', 'navalYard', 'transport', 'warship', 'commandPost', 'commanderPower',
  'reconHull', 'engineer',
];

/* ==========================================================================
 * 2. THE CATALOG
 * ========================================================================== */

/** Everything the AI needs to know about one buildable. */
export interface CatalogEntry {
  /** Content key, shared with `src/game/Scenarios.ts`'s vocabulary. */
  readonly key: string;
  /** Index into the real def table, or -1 when no def table has landed. */
  defId: number;
  readonly isBuilding: boolean;
  readonly tab: BuildTab;
  readonly cost: number;
  readonly buildTimeSec: number;
  /** Positive generates power, negative consumes. 0 for units. */
  readonly power: number;
  /** Footprint in cells. 0 for units. */
  readonly footprintW: number;
  readonly footprintH: number;
  /** Content keys of structures that must exist first. */
  readonly prereqs: readonly string[];
  readonly role: BuildRole;
  /** Neutral means both armies field it. */
  readonly faction: Faction;
  /**
   * Effectiveness against each ThreatClass, 0..2. 1.0 is "does its job".
   * Length is always AI_THREAT_CLASS_COUNT.
   */
  readonly answers: readonly number[];
  /** Relative frequency in a default army. 0 for anything not army. */
  readonly weight: number;
  /**
   * Cargo slots this hull carries. 0 for everything that is not a carrier.
   *
   * THE ONE FACT ABOUT A CARRIER THE BUILD LAYER CANNOT GET ANY OTHER WAY.
   * `TransportService.capacityAt` answers it for a hull that EXISTS, which is
   * what `stageAmphibious` uses, but `considerNavy` is choosing which one to
   * BUY and there is nothing to measure yet. `ProductionFacts` does not carry
   * it either — the live oracle in `ai.system.ts` publishes cost, tab, power and
   * prereqs, and widening that seam means widening every implementation of it.
   *
   * So it is DOCTRINE, exactly as `answers` and `weight` are: authored here,
   * overwritten from `UnitDef.cargoSlots` the moment a real def table binds, and
   * checked against that table by `tests/ai-naval-yard.spec.ts` so the authored
   * number cannot quietly stop being the shipped one. Without it `forRole`
   * hands a Meridian brain the 2-slot Sandskiff for an amphibious assault — the
   * first Transport-role row its faction can field — and a 2-slot hull cannot
   * carry `AI_NAVAL.minLandingSquad`, so the operation is refused forever by a
   * purchase made three minutes earlier.
   */
  readonly slots: number;
}

/** Shorthand for an all-zero answer vector (structures, economy). */
const NO_ANSWER: readonly number[] = [0, 0, 0, 0, 0];
/** Shared empty prereq list. See `power()` for why a power row has none. */
const NO_PREREQS: readonly string[] = [];

/**
 * THE MERIDIAN PACT's faction id.
 *
 * Declared here rather than imported from `src/data/Defs.ts` — which exports
 * the identical constant — because the whole point of this file is that
 * `src/sim/**` never imports `src/data/**`. Content reaches the brain through
 * `bind()` / `bindOracle()`, and an import edge for one integer would be the
 * first crack in that. Both constants disappear the moment
 * `Faction.Meridian = 3` lands in `core/types.ts`.
 */
export const FACTION_MERIDIAN = 3 as Faction;

/**
 * THE RECLAMATION's faction id. Same reasoning as the line above: declared
 * rather than imported, so `src/sim/**` keeps its zero-import rule against
 * `src/data/**`. `Faction.Reclaim` is 4 and `tests/faction4-art.spec.ts` asserts
 * the two constants agree.
 *
 * That sentence named `tests/faction4.spec.ts` until 2026-08-07 — a file that has
 * never existed. Nothing checked this constant against the enum at all, which is
 * the whole hazard the comment was describing: two hand-kept 4s in files that are
 * forbidden to import each other. The assertion is real now.
 */
export const FACTION_RECLAIM = 4 as Faction;

function structure(
  key: string,
  role: BuildRole,
  cost: number,
  power: number,
  dim: { w: number; h: number },
  prereqs: readonly string[],
  faction: Faction = Faction.Neutral,
  tab: BuildTab = BuildTab.Structures,
  answers: readonly number[] = NO_ANSWER,
): CatalogEntry {
  return {
    key, defId: -1, isBuilding: true, tab, cost,
    // The real def table carries authored build times; this derivation only has
    // to be monotonic in cost so the AI's "can I afford to start this" maths
    // behaves the same shape either way.
    buildTimeSec: Math.max(3, cost / 60),
    power, footprintW: dim.w, footprintH: dim.h,
    prereqs, role, faction, answers, weight: 0, slots: 0,
  };
}

function fighter(
  key: string,
  role: BuildRole,
  kind: EntityKind.Infantry | EntityKind.Vehicle,
  cost: number,
  prereqs: readonly string[],
  faction: Faction,
  answers: readonly number[],
  weight: number,
  slots: number = 0,
): CatalogEntry {
  return {
    key, defId: -1, isBuilding: false,
    tab: kind === EntityKind.Infantry ? BuildTab.Infantry : BuildTab.Vehicles,
    cost, buildTimeSec: Math.max(2, cost / 90),
    power: 0, footprintW: 0, footprintH: 0,
    prereqs, role, faction, answers, weight, slots,
  };
}

/**
 * One purchasable upgrade, as the AI's build layer sees it.
 *
 * `isBuilding: false` and `weight: 0`, which together are the whole reason this
 * is a third factory rather than a call to `fighter()`. `weight` 0 keeps it out
 * of `buildUnits`' candidate list — an upgrade is not something you attack with
 * and must never win the composition roll — and `isBuilding` false keeps it out
 * of the placement path, because a finished upgrade emits `production:ready`
 * with `isBuilding: false` and there is nowhere to put it.
 *
 * The tab is NOT derived from the scope here even though `UPGRADE_SCOPE_TAB`
 * derives exactly that: the tab is what GATES the purchase (an Infantry-tab row
 * needs a barracks servicing that queue), so it is a fact about the buy and
 * belongs on the row a human can read next to the cost.
 */
function upgrade(
  key: string,
  faction: Faction,
  tab: BuildTab,
  cost: number,
  buildTimeSec: number,
  prereqs: readonly string[],
): CatalogEntry {
  return {
    key, defId: -1, isBuilding: false, tab, cost, buildTimeSec,
    power: 0, footprintW: 0, footprintH: 0,
    prereqs, role: BuildRole.Upgrade, faction, answers: NO_ANSWER, weight: 0, slots: 0,
  };
}

/**
 * One purchasable commander power, as the AI's build layer sees it.
 *
 * `upgrade()`'s twin, and every word of that function's docstring applies:
 * `isBuilding: false` keeps it out of the placement path, `weight: 0` keeps it
 * out of `buildUnits`' candidate list.
 *
 * NO PREREQS, deliberately, because the CONTENT row has none either. The gate
 * is the tab: the Powers queue has a factory only while a completed, powered
 * Command Post stands, and `available()` reads the oracle's answer, which is
 * `availabilityOf`'s. Naming `commandPost` here would be a second copy of that
 * rule that a Pact brain could not satisfy, since its building is called
 * something else.
 */
function power(key: string, cost: number, buildTimeSec: number): CatalogEntry {
  return {
    key, defId: -1, isBuilding: false, tab: BuildTab.Powers, cost, buildTimeSec,
    power: 0, footprintW: 0, footprintH: 0,
    prereqs: NO_PREREQS, role: BuildRole.CommanderPower, faction: Faction.Neutral,
    answers: NO_ANSWER, weight: 0, slots: 0,
  };
}

const B = BUILDING_DIMENSIONS;
const NB = NAVAL_BUILDING_DIMENSIONS;

/**
 * The AI's world model when no `DefTables` exists yet. Costs are the classic
 * Red Alert 2 numbers because the whole doctrine below — when a refinery pays
 * for itself, whether a tech lab is affordable before the second wave — is
 * calibrated against those ratios, and inventing new ones would silently
 * decalibrate every threshold in `AI.ts`.
 *
 * Keys match `FALLBACK_UNITS` / `FALLBACK_BUILDINGS` in `src/game/Scenarios.ts`
 * exactly, which is also the vocabulary `resolveDefBinding()` maps onto real
 * def ids. So the day the data module lands, `bind()` swaps the numbers out
 * underneath and nothing else changes.
 */
export const FALLBACK_CATALOG: readonly CatalogEntry[] = [
  /* -- economy and tech ------------------------------------------------- */
  structure('conyard',    BuildRole.Builder,    3000, -20, B.conYard,    []),
  structure('powerPlant', BuildRole.Power,       800, 100, B.powerPlant, []),
  structure('refinery',   BuildRole.Refinery,   2000, -30, B.refinery,   ['powerPlant']),
  structure('barracks',   BuildRole.Barracks,    500, -20, B.barracks,   ['powerPlant']),
  structure('warFactory', BuildRole.WarFactory, 2000, -40, B.warFactory, ['refinery']),
  structure('radar',      BuildRole.Radar,      1000, -40, B.radar,      ['refinery']),
  structure('battleLab',  BuildRole.TechLab,    2000, -60, B.battleLab,  ['radar']),
  // The Command Post, one row per army — three rows, not four, because the
  // Neutral key is shared by the two original armies exactly as `repairDepot`
  // is. Without these the brain cannot NAME the structure in a
  // `ProductionStart` (`bindOracle` only asks `factsFor` about keys in this
  // array), and a captured or scenario-placed one would be misfiled as a tech
  // lab by `roleOfBuilding`.
  structure('commandPost',  BuildRole.CommandPost, 1500, -80, B.commandPost, ['radar']),
  structure('mrdPharos',    BuildRole.CommandPost, 1500, -80, B.commandPost, ['mrdOculus'],
    FACTION_MERIDIAN),
  structure('rclSignalRig', BuildRole.CommandPost, 1500, -80, B.commandPost, ['rclSpotter'],
    FACTION_RECLAIM),

  /* -- the five commander powers ------------------------------------------
   * FIVE ROWS FOR FOUR ARMIES, matching the CONTENT table: a power is not an
   * army's hardware, so `Faction.Neutral` here means universal rather than "the
   * two original armies". `forRole` would only ever return the first row of a
   * role anyway; these are reached by KEY through `powerPlanFor`. */
  power('power.orbitalScan',      800, 15),
  power('power.emergencyRepair', 1200, 20),
  power('power.airstrike',       1500, 24),
  power('power.oreBoost',        2000, 24),
  power('power.chronoshift',     2500, 30),
  structure('oreSilo',    BuildRole.Storage,     150, -10, B.oreSilo,    ['refinery']),
  // The service pad, one row per army. Three rows, not four: `repairDepot` is
  // Faction.Neutral, which the two original armies share. Without these the
  // catalog has no entry for the depot's defId and `roleOfBuilding` falls all
  // the way through to its "2x2 and draws power" branch — see BuildRole.Repair.
  structure('repairDepot', BuildRole.Repair, 800, -30, B.repairDepot, ['warFactory']),
  structure('mrdDepot',    BuildRole.Repair, 800, -30, B.repairDepot, ['mrdForgeyard'],
    FACTION_MERIDIAN),
  structure('rclDepot',    BuildRole.Repair, 800, -30, B.repairDepot, ['rclBreakerYard'],
    FACTION_RECLAIM),

  /* -- the superweapons -------------------------------------------------- */
  // Rows for classification, not for doctrine — see `BuildRole.Superweapon`.
  // `roleOfBuilding` answers from this table when it can and falls through to
  // an EntityFlag heuristic when it cannot, and the heuristic's last branch
  // ("bigger than 1x1 and draws power" => TechLab) is exactly what a 3x3 silo
  // looks like from the flags alone.
  structure('nuclearSilo',   BuildRole.Superweapon, 2500, -150, B.superweapon,
    ['battleLab'], Faction.Soviets),
  structure('ironCurtain',   BuildRole.Superweapon, 2000, -150, B.superweapon,
    ['battleLab'], Faction.Soviets),
  structure('chronosphere',  BuildRole.Superweapon, 2000, -150, B.superweapon,
    ['battleLab'], Faction.Allies),
  structure('weatherControl', BuildRole.Superweapon, 2500, -150, B.superweapon,
    ['battleLab'], Faction.Allies),
  structure('mrdHeliograph', BuildRole.Superweapon, 2500, -150, B.superweapon,
    ['mrdReliquary'], FACTION_MERIDIAN),
  structure('rclStormworks', BuildRole.Superweapon, 2500, -150, B.superweapon,
    ['rclCrucible'], FACTION_RECLAIM),

  /* -- THE NAVY -------------------------------------------------------------
   * WHY THESE ROWS DID NOT EXIST, stated as it was measured. `bindOracle` walks
   * THIS array and asks `factsFor(e.key)` about each entry, so a key that is not
   * here is a key the AI never resolves a `publicId` for and can therefore never
   * name in a `ProductionStart`. Four naval structures and nine hulls shipped;
   * `grep -n naval src/sim/AI.ts` returned nothing, and the reason is one level
   * further down than the brain: the opponent had no WORD for a dock. It could
   * not have built one if it had wanted to.
   *
   * THE YARD ROWS ARE LOAD-BEARING EVEN IF NOTHING EVER QUEUES ONE. Every naval
   * yard in the game is `IsFactory` and 3x3, and `roleOfBuilding`'s flag
   * fallback separates producers by width — "2 wide is a barracks, 3 wide is a
   * war factory". So a dock the AI captured, or one a scenario handed it, was
   * already being counted as its war factory, and `roleCount[WarFactory] > 0` is
   * the gate that stops the build layer asking for the real one.
   *
   * `mrdSkiff` USED TO BE FILED HERE TOO, as a second `BuildRole.Transport` row
   * on top of the `Skirmisher` one in the Pact's army block below — the only
   * duplicate key in this whole array — on the grounds that the Sandskiff is an
   * amphibious raider gated on `mrdForgeyard` rather than on a slipway, so a
   * Pact brain could ferry without ever paying for a dock. IT COULD NOT. `byKey`
   * and `unitByDef` both keep the LAST row of a key, so every skiff the census
   * ever saw resolved to the Skirmisher row and `transportCount` stayed 0 — the
   * shadow row was reachable by exactly one call, `forRole(Transport, Pact)`,
   * which is the buy. A Pact brain would therefore buy skiffs for an operation
   * that could never see them, forever, because the cap it is bought against
   * counts a list the purchase never joins.
   *
   * It is deleted rather than repaired: two slots cannot carry
   * `AI_NAVAL.minLandingSquad`, so `forLift` — which sizes a hull to the party —
   * would never return it in any case. The skiff is still line army with a real
   * weight, which is how the Pact actually fields it.
   *
   * WEIGHT IS 0 ON EVERY HULL BELOW, and it is the whole safety property.
   * `buildUnits` skips `weight <= 0`, so no ship can ever win the composition
   * roll and be bought as line army. The navy layer asks for these by ROLE,
   * explicitly, when it has a plan for them — which is the only way a 1800
   * credit capital ship should ever be bought.
   *
   * The answer vectors are authored honestly anyway: they are what a naval gun
   * is actually good against, and they are what the composition scorer would use
   * the day a hull is given a weight.
   * ---------------------------------------------------------------------- */
  structure('navalYard',  BuildRole.NavalYard, 1000, -30, NB.navalYard, ['refinery'],
    Faction.Allies),
  structure('subPen',     BuildRole.NavalYard, 1000, -30, NB.subPen,    ['refinery'],
    Faction.Soviets),
  structure('mrdSlipway', BuildRole.NavalYard, 1000, -30, NB.navalYard, ['mrdCistern'],
    FACTION_MERIDIAN),
  structure('rclDrydock', BuildRole.NavalYard, 1000, -30, NB.navalYard, ['rclSorter'],
    FACTION_RECLAIM),

  // The troop hulls. `transport` is Faction.Neutral because the Allied yard and
  // the Soviet pen both list it in `produces`.
  fighter('transport', BuildRole.Transport, EntityKind.Vehicle, 900, ['navalYard'],
    Faction.Neutral, NO_ANSWER, 0, 8),
  fighter('rclScow',   BuildRole.Transport, EntityKind.Vehicle, 850, ['rclDrydock'],
    FACTION_RECLAIM, [0.8, 0.9, 0.4, 0.7, 0.0], 0, 4),

  // The escorts, and then the capital ships behind a tech gate.
  fighter('gunboat',     BuildRole.Warship, EntityKind.Vehicle, 1000, ['navalYard'],
    Faction.Allies, [1.0, 1.1, 0.8, 1.0, 0.6], 0),
  fighter('submarine',   BuildRole.Warship, EntityKind.Vehicle, 1000, ['subPen'],
    Faction.Soviets, [0.2, 1.2, 1.2, 0.6, 0.0], 0),
  fighter('mrdCorvette', BuildRole.Warship, EntityKind.Vehicle, 950, ['mrdSlipway'],
    FACTION_MERIDIAN, [1.0, 1.0, 0.7, 1.2, 0.4], 0),
  fighter('rclHulk',     BuildRole.Warship, EntityKind.Vehicle, 1800, ['rclDrydock', 'rclCrucible'],
    FACTION_RECLAIM, [0.8, 1.1, 1.2, 1.4, 0.3], 0),
  // THE AIR COLUMN IS 0.4, NOT 1.0, AND THE NAME IS WHY IT WAS WRONG. This hull
  // is called "Aircraft Cruiser" and carries exactly one weapon — `navalGun` —
  // whose `canTargetAir` is false. `answers` documents 1.0 as "does its job",
  // and `tests/air-layer.spec.ts` refuses any unit that claims a real air
  // answer its gun cannot deliver, because seeing a gunship would then make the
  // AI build the wrong army confidently. The same gate previously caught
  // `apocalypse` at 1.2 with a 125 mm gun.
  //
  // Scored 0.4 alongside `mrdCorvette` — incidental deterrence, not an answer.
  // The alternative is to give the ship an AA mount and earn the name, which is
  // a combat-balance change and does not belong in a catalog row.
  fighter('destroyer',   BuildRole.Warship, EntityKind.Vehicle, 1800, ['navalYard', 'battleLab'],
    Faction.Allies, [0.9, 1.2, 1.1, 1.2, 0.4], 0),
  fighter('dreadnought', BuildRole.Warship, EntityKind.Vehicle, 2000, ['subPen', 'battleLab'],
    Faction.Soviets, [0.7, 1.0, 1.2, 1.6, 0.2], 0),
  fighter('mrdMonitor',  BuildRole.Warship, EntityKind.Vehicle, 1900, ['mrdSlipway', 'mrdReliquary'],
    FACTION_MERIDIAN, [0.8, 1.1, 1.1, 1.5, 0.5], 0),

  /* -- the rest of the naval line -----------------------------------------
   * WEIGHT 0 ON EVERY ROW, as on the hulls above and for the same reason: the
   * navy layer asks for these by role when it has a plan for them, and nothing
   * here may win a composition roll and be bought as line army.
   *
   * The recon hulls answer almost nothing on purpose — they are bought for a
   * sight radius, and an honest answer vector is what keeps the composition
   * scorer from ever mistaking one for a cheap escort.                       */
  fighter('hydrofoil',    BuildRole.ReconHull, EntityKind.Vehicle, 450, ['navalYard'],
    Faction.Allies, [0.5, 0.3, 0.1, 0.1, 0.3], 0),
  fighter('picketBoat',   BuildRole.ReconHull, EntityKind.Vehicle, 450, ['subPen'],
    Faction.Soviets, [0.4, 0.5, 0.2, 0.2, 0.0], 0),
  fighter('mrdCutter',    BuildRole.ReconHull, EntityKind.Vehicle, 480, ['mrdSlipway'],
    FACTION_MERIDIAN, [0.5, 0.4, 0.1, 0.1, 0.2], 0),
  fighter('rclSkimmer',   BuildRole.ReconHull, EntityKind.Vehicle, 400, ['rclDrydock'],
    FACTION_RECLAIM, [0.6, 0.3, 0.1, 0.1, 0.0], 0),

  // The carriers. All four rungs are `Transport`, and the brain picks between
  // them by SLOTS rather than by role — see `stageAmphibious`, which sizes the
  // hull to the squad it is about to move instead of always taking the biggest.
  fighter('landingCraft', BuildRole.Transport, EntityKind.Vehicle, 700, ['navalYard'],
    Faction.Allies, NO_ANSWER, 0, 4),
  fighter('assaultBarge', BuildRole.Transport, EntityKind.Vehicle, 680, ['subPen'],
    Faction.Soviets, NO_ANSWER, 0, 4),
  fighter('mrdLighter',   BuildRole.Transport, EntityKind.Vehicle, 720, ['mrdSlipway'],
    FACTION_MERIDIAN, NO_ANSWER, 0, 4),
  fighter('mrdArgosy',    BuildRole.Transport, EntityKind.Vehicle, 1250, ['mrdSlipway'],
    FACTION_MERIDIAN, NO_ANSWER, 0, 8),
  fighter('rclHauler',    BuildRole.Transport, EntityKind.Vehicle, 1100, ['rclDrydock'],
    FACTION_RECLAIM, NO_ANSWER, 0, 8),

  /* -- the swimmers. LINE INFANTRY, with weight, and that is the difference
   * between them and everything else in this block: they are bought off a
   * barracks on a dry map like any other rifleman, and their extra verb costs
   * the AI nothing to own. Weighted low — they are slower and softer than the
   * rifleman beside them, so the scorer should prefer that rifleman unless the
   * water is the point.                                                      */
  fighter('frogman',       BuildRole.Infantry, EntityKind.Infantry, 350, ['barracks'],
    Faction.Allies, [0.8, 0.2, 0.1, 0.2, 0.0], 0.15),
  fighter('navalInfantry', BuildRole.Infantry, EntityKind.Infantry, 320, ['barracks'],
    Faction.Soviets, [0.8, 0.2, 0.1, 0.2, 0.0], 0.15),
  fighter('mrdTidewalker', BuildRole.Infantry, EntityKind.Infantry, 380, ['mrdChapterhouse'],
    FACTION_MERIDIAN, [0.8, 0.3, 0.1, 0.2, 0.0], 0.15),
  fighter('rclDredger',    BuildRole.Infantry, EntityKind.Infantry, 300, ['rclRookery'],
    FACTION_RECLAIM, [0.9, 0.3, 0.1, 0.2, 0.0], 0.15),

  /* -- THE TWELVE UPGRADES --------------------------------------------------
   * THESE ROWS ARE WHY THE AI CAN BUY AN UPGRADE AT ALL. `bindOracle` walks
   * THIS array and asks `factsFor(e.key)` about each entry — a key that is not
   * here is a key the AI never asks about, never resolves a `publicId` for, and
   * therefore can never name in a `ProductionStart`. Twelve upgrades shipped in
   * v2.2.0, a human with Composite Armour took 18% less damage for the rest of
   * the match, and the opponent had no way to express the purchase.
   *
   * Cost, build time, tab and prereqs are transcribed from the `CONTENT` rows in
   * `src/sim/Production.ts`, which is also what the oracle overwrites them with
   * the moment production is in the process. They are authored honestly anyway,
   * for the same reason every other fallback row is: the headless tests run
   * against exactly these numbers, and a fallback that lied would calibrate the
   * doctrine below against a game nobody plays.
   *
   * THE PREREQS ARE THE REAL GATE AND THEY ARE NOT CHEAP. Every one of the
   * twelve names a radar-tier structure, so no upgrade is reachable before the
   * AI has finished its scripted opening — which is the correct shape. An AI
   * that opened on Composite Armour would have spent a war factory on a
   * multiplier over an army of zero.
   * ---------------------------------------------------------------------- */
  upgrade('upgAlliedOptics',    Faction.Allies,   BuildTab.Infantry,    800, 20,
    ['barracks', 'radar']),
  upgrade('upgAlliedComposite', Faction.Allies,   BuildTab.Vehicles,   1200, 26,
    ['warFactory', 'radar']),
  upgrade('upgAlliedLogistics', Faction.Allies,   BuildTab.Structures, 1000, 24,
    ['refinery', 'radar']),

  upgrade('upgSovietBodyArmour', Faction.Soviets, BuildTab.Infantry,    800, 20,
    ['barracks', 'radar']),
  upgrade('upgSovietUranium',    Faction.Soviets, BuildTab.Vehicles,   1200, 26,
    ['warFactory', 'battleLab']),
  upgrade('upgSovietSlurry',     Faction.Soviets, BuildTab.Structures, 1000, 24,
    ['refinery', 'radar']),

  upgrade('upgMrdWayfinding', FACTION_MERIDIAN, BuildTab.Infantry,    800, 20,
    ['mrdChapterhouse', 'mrdOculus']),
  upgrade('upgMrdSolarSails', FACTION_MERIDIAN, BuildTab.Vehicles,   1200, 26,
    ['mrdForgeyard', 'mrdOculus']),
  upgrade('upgMrdCapacitors', FACTION_MERIDIAN, BuildTab.Structures, 1000, 24,
    ['mrdOculus', 'mrdReliquary']),

  upgrade('upgRclSwarmDrill', FACTION_RECLAIM, BuildTab.Infantry,    800, 20,
    ['rclRookery', 'rclSpotter']),
  upgrade('upgRclOvercharge', FACTION_RECLAIM, BuildTab.Vehicles,   1200, 26,
    ['rclBreakerYard', 'rclSpotter']),
  upgrade('upgRclSalvage',    FACTION_RECLAIM, BuildTab.Structures, 1000, 24,
    ['rclSorter', 'rclSpotter']),

  /* -- defence ----------------------------------------------------------- */
  // Answer vectors matter here: the build layer will not put up a flame tower
  // against an air threat just because "defence" scored high.
  structure('pillbox',    BuildRole.Defense, 400,   0, B.pillbox,    ['barracks'],
    Faction.Allies,  BuildTab.Defense, [1.6, 0.8, 0.3, 0, 0]),
  structure('prismTower', BuildRole.AntiAir, 1500, -50, B.prismTower, ['battleLab'],
    Faction.Allies,  BuildTab.Defense, [1.2, 1.4, 1.2, 0, 1.3]),
  structure('flameTower', BuildRole.Defense, 600, -20, B.flameTower,  ['barracks'],
    Faction.Soviets, BuildTab.Defense, [1.8, 0.9, 0.4, 0, 0]),
  structure('teslaCoil',  BuildRole.AntiAir, 1500, -75, B.teslaCoil,   ['radar'],
    Faction.Soviets, BuildTab.Defense, [2.0, 1.2, 1.4, 0, 1.1]),

  /* -- the ore chain ------------------------------------------------------ */
  fighter('harvester', BuildRole.Harvester, EntityKind.Vehicle, 1400, ['refinery'],
    Faction.Neutral, NO_ANSWER, 0),
  // War factory only, mirroring `src/data/Defs.ts`. A match OPENS from one of
  // these now, so it is the first structure in the game rather than a late-game
  // expansion tool — gating it on the tech lab would mean an AI that lost its
  // yard could never rebuild one.
  fighter('mcv', BuildRole.Mcv, EntityKind.Vehicle, 2000, ['warFactory'],
    Faction.Neutral, NO_ANSWER, 0),
  fighter('engineer', BuildRole.Engineer, EntityKind.Infantry, 500, ['barracks'],
    Faction.Neutral, NO_ANSWER, 0),

  /* -- THE COMMANDERS ------------------------------------------------------
   * `weight: 1` — the AI wants exactly one and the cap gives it exactly one.
   * `availabilityOf` refuses a second while the first is alive OR queued, so
   * the AI does not need a rule of its own; a higher weight would just make it
   * ask repeatedly and be refused repeatedly.
   *
   * BuildRole.Support, not Infantry: `forRole(Infantry)` returns the FIRST
   * matching entry, and a commander answering that call would have the AI
   * building a 1500-credit hero every time it wanted a rifleman.
   *
   * The answer vector is broad and unremarkable — a hero is not the answer to
   * any particular threat class, it is a thing you have one of.
   * --------------------------------------------------------------------- */
  fighter('fieldMarshal', BuildRole.Support, EntityKind.Infantry, 1500, ['barracks', 'radar'],
    Faction.Allies, [1.0, 1.0, 0.8, 0.6, 0.4], 1),
  fighter('commissar', BuildRole.Support, EntityKind.Infantry, 1500, ['barracks', 'radar'],
    Faction.Soviets, [1.0, 1.0, 0.8, 0.6, 0.4], 1),
  fighter('mrdHierarch', BuildRole.Support, EntityKind.Infantry, 1500,
    ['mrdChapterhouse', 'mrdOculus'],
    FACTION_MERIDIAN, [1.0, 1.0, 0.8, 0.6, 0.4], 1),
  fighter('rclBaron', BuildRole.Support, EntityKind.Infantry, 1500, ['rclRookery', 'rclSpotter'],
    FACTION_RECLAIM, [1.0, 1.0, 0.8, 0.6, 0.4], 1),

  /* -- Allied army -------------------------------------------------------- */
  fighter('gi', BuildRole.Infantry, EntityKind.Infantry, 200, ['barracks'],
    Faction.Allies, [1.3, 0.7, 0.2, 0.4, 0.9], 3),
  // THE HEAVY COLUMN IS WHY THIS ROW EXISTS. Read it against the G.I. above:
  // 0.2 there, 1.5 here. Until the Javelin landed, the best answer the Allied
  // INFANTRY tab offered against an Anvil was 0.2, so a composition scorer facing
  // massed heavies had nothing to reach for and spent the whole match rolling
  // Wardens. Its Infantry column is deliberately BELOW the G.I.'s: a rocket
  // is 0.55 against flesh, and an AI that screened with these would be feeding
  // 500-credit soldiers to conscripts.
  fighter('javelin', BuildRole.Skirmisher, EntityKind.Infantry, 500, ['barracks', 'radar'],
    Faction.Allies, [0.5, 1.3, 1.5, 0.9, 1.5], 2),
  fighter('grizzly', BuildRole.Armor, EntityKind.Vehicle, 700, ['warFactory'],
    Faction.Allies, [0.9, 1.4, 1.2, 1.1, 0], 4),
  fighter('ifv', BuildRole.Skirmisher, EntityKind.Vehicle, 600, ['warFactory'],
    Faction.Allies, [1.1, 1.3, 0.5, 0.4, 1.5], 2),
  fighter('prismTank', BuildRole.Siege, EntityKind.Vehicle, 1200, ['warFactory', 'battleLab'],
    Faction.Allies, [1.4, 1.1, 1.3, 1.8, 0], 2),

  /* -- Soviet army -------------------------------------------------------- */
  fighter('conscript', BuildRole.Infantry, EntityKind.Infantry, 100, ['barracks'],
    Faction.Soviets, [1.2, 0.6, 0.2, 0.4, 0.7], 4),
  fighter('attackDog', BuildRole.Skirmisher, EntityKind.Infantry, 200, ['barracks'],
    Faction.Soviets, [1.9, 0.1, 0.0, 0.0, 0], 1),
  // The Soviet mirror, and a DIFFERENT shape on purpose. `flakBurst` is an
  // autocannon: 1.00 against Light and only 0.35 against Heavy, so this reads
  // 1.5 / 0.7 where the Javelin reads 1.3 / 1.5. The Structure column is 0.4
  // because 0.35 vs Concrete cannot take a base apart, and the Air column is
  // the highest of the pair — a flak gun is an AA gun first.
  fighter('flakTrooper', BuildRole.Skirmisher, EntityKind.Infantry, 300, ['barracks', 'radar'],
    Faction.Soviets, [0.9, 1.5, 0.7, 0.4, 1.7], 2),
  fighter('rhino', BuildRole.Armor, EntityKind.Vehicle, 900, ['warFactory'],
    Faction.Soviets, [0.8, 1.5, 1.5, 1.2, 0], 5),
  fighter('v4', BuildRole.Siege, EntityKind.Vehicle, 1400, ['warFactory', 'radar'],
    Faction.Soviets, [1.2, 0.9, 1.1, 2.0, 0], 2),
  // The Air column WAS 1.2 here. It was never wrong in a way anything could
  // notice — nothing in the game could get airborne, so the column was dead —
  // but it is wrong now: the Sledge fields exactly one weapon, `twinCannon`,
  // and a 125 mm gun does not elevate. An answer vector that promises air cover
  // a unit cannot deliver sends the whole build layer chasing 1750-credit tanks
  // the moment a gunship crosses the map. `tests/air-layer.spec.ts` asserts the
  // general rule: anything scoring >= 1.0 against Air must carry a weapon whose
  // `canTargetAir` is true.
  fighter('apocalypse', BuildRole.Siege, EntityKind.Vehicle, 1750, ['warFactory', 'battleLab'],
    Faction.Soviets, [1.0, 1.6, 1.9, 1.5, 0], 2),

  /* -- THE MERIDIAN PACT --------------------------------------------------
   * The Pact's tech tree is the same three tiers with different names, so the
   * catalog shape is identical and only the answer vectors carry doctrine.
   *
   * Every Pact key is `FACTION_MERIDIAN`, never `Faction.Neutral`, including
   * the ones that look shared: a Neutral entry appears in BOTH other armies'
   * candidate lists (`forFaction` treats Neutral as universal), so a Neutral
   * 'mrdCollector' would have the Soviets trying to order Meridian harvesters.
   *
   * `BuildCatalog.forRole` returns the first entry with a role that the faction
   * can field, preferring an exact faction match over a Neutral fallback — so
   * a Pact brain asking for `BuildRole.Power` gets the Solar Array rather than
   * the shared Power Plant purely because this entry exists.
   * ---------------------------------------------------------------------- */
  structure('mrdConclave',   BuildRole.Builder,    3000, -20, B.conYard,    [],
    FACTION_MERIDIAN),
  structure('mrdSolarArray', BuildRole.Power,       350, 160, B.powerPlant, ['mrdConclave'],
    FACTION_MERIDIAN),
  structure('mrdCistern',    BuildRole.Refinery,   2000, -30, B.refinery,   ['mrdSolarArray'],
    FACTION_MERIDIAN),
  structure('mrdChapterhouse', BuildRole.Barracks,  500, -20, B.barracks,   ['mrdSolarArray'],
    FACTION_MERIDIAN),
  structure('mrdForgeyard',  BuildRole.WarFactory, 2000, -40, B.warFactory, ['mrdCistern'],
    FACTION_MERIDIAN),
  structure('mrdOculus',     BuildRole.Radar,      1000, -40, B.radar,      ['mrdCistern'],
    FACTION_MERIDIAN),
  structure('mrdReliquary',  BuildRole.TechLab,    2000, -60, B.battleLab,  ['mrdOculus'],
    FACTION_MERIDIAN),
  structure('mrdVault',      BuildRole.Storage,     150, -10, B.oreSilo,    ['mrdCistern'],
    FACTION_MERIDIAN),

  // The Glaive Post answers infantry and nothing else, which is exactly the
  // threat the rest of the Pact army is worst against — so the build layer
  // will reach for it precisely when it should.
  structure('mrdGlaive', BuildRole.Defense, 450, -10, B.pillbox, ['mrdChapterhouse'],
    FACTION_MERIDIAN, BuildTab.Defense, [1.7, 0.7, 0.3, 0, 0]),
  structure('mrdHelios', BuildRole.AntiAir, 1500, -55, B.prismTower, ['mrdReliquary'],
    FACTION_MERIDIAN, BuildTab.Defense, [1.1, 1.4, 1.3, 0, 1.4]),

  fighter('mrdCollector', BuildRole.Harvester, EntityKind.Vehicle, 1000, ['mrdCistern'],
    FACTION_MERIDIAN, NO_ANSWER, 0),
  fighter('mrdCarryall', BuildRole.Mcv, EntityKind.Vehicle, 3000, ['mrdForgeyard'],
    FACTION_MERIDIAN, NO_ANSWER, 0),
  fighter('mrdArtificer', BuildRole.Engineer, EntityKind.Infantry, 500, ['mrdChapterhouse'],
    FACTION_MERIDIAN, NO_ANSWER, 0),

  // Wayfarers are a screen, not a line: cheap, quick, and the only thing in the
  // army that answers massed infantry at all until a Glaive Post is up.
  fighter('mrdWayfarer', BuildRole.Infantry, EntityKind.Infantry, 175, ['mrdChapterhouse'],
    FACTION_MERIDIAN, [1.25, 0.6, 0.2, 0.35, 0.8], 3),
  fighter('mrdLancer', BuildRole.Skirmisher, EntityKind.Infantry, 450, ['mrdChapterhouse', 'mrdOculus'],
    FACTION_MERIDIAN, [0.5, 1.3, 1.4, 0.9, 1.6], 2),
  // Two cargo slots, declared on a Skirmisher row: `slots` describes the HULL,
  // not the doctrine, and `fromUnitDef` would overwrite a 0 here with the def's
  // 2 the moment a real table bound. Nothing buys it as a lift — `forLift`
  // asks for `minLandingSquad` and 2 is short of it — but a human can still put
  // two men in one, and the AI's own number has to agree with the game's.
  fighter('mrdSkiff', BuildRole.Skirmisher, EntityKind.Vehicle, 550, ['mrdForgeyard'],
    FACTION_MERIDIAN, [1.2, 1.4, 0.5, 0.4, 1.2], 3, 2),
  fighter('mrdSolarch', BuildRole.Armor, EntityKind.Vehicle, 800, ['mrdForgeyard'],
    FACTION_MERIDIAN, [0.7, 1.4, 1.3, 1.0, 0], 5),
  fighter('mrdZenith', BuildRole.Siege, EntityKind.Vehicle, 1500, ['mrdForgeyard', 'mrdReliquary'],
    FACTION_MERIDIAN, [1.3, 1.1, 1.4, 1.9, 0], 2),
  // Air 0 -> 1.5. The Kestrel is an AIRCRAFT (`Locomotor.Air`) carrying guided
  // pods that elevate, so it is the Pact's mobile answer to a gunship as well as
  // its raider — and the only reason its Air column read 0 is that nothing
  // could fly when the vector was written.
  fighter('mrdKestrel', BuildRole.Siege, EntityKind.Vehicle, 1100, ['mrdForgeyard', 'mrdOculus'],
    FACTION_MERIDIAN, [1.0, 1.5, 1.2, 1.3, 1.5], 1),

  /* -- THE RECLAMATION -----------------------------------------------------
   * The tree is the same three tiers with different names and a much shallower
   * prereq column, so the catalog SHAPE is identical; the doctrine is entirely
   * in the answer vectors, and it is lopsided on purpose.
   *
   * Every arc unit scores 1.5-1.9 against ThreatClass.Infantry and 0.2-0.5
   * against ThreatClass.Structure, which is exactly what ARMOR_MATRIX does to
   * a Tesla warhead (1.60 vs Infantry, 0.60 vs Concrete). The consequence at
   * the strategy layer is the one we want: a Reclamation brain that has seen an
   * infantry-heavy enemy floods Grinders, and a Reclamation brain looking at a
   * base rolls onto `rclSlaghurler` — the ONE entry in the list with a
   * structure answer above 1.0 — because nothing else it owns can do the job.
   *
   * Every key is `FACTION_RECLAIM`, never `Faction.Neutral`: a Neutral entry
   * appears in every other army's candidate list (`forFaction` treats Neutral
   * as universal), so a Neutral 'rclScrapper' would have the Allies ordering
   * Reclamation harvesters.
   * ---------------------------------------------------------------------- */
  structure('rclFoundry',     BuildRole.Builder,    3000, -20, B.conYard,    [],
    FACTION_RECLAIM),
  structure('rclFurnace',     BuildRole.Power,       240,  80, B.powerPlant, ['rclFoundry'],
    FACTION_RECLAIM),
  structure('rclSorter',      BuildRole.Refinery,   2000, -30, B.refinery,   ['rclFurnace'],
    FACTION_RECLAIM),
  structure('rclRookery',     BuildRole.Barracks,    450, -20, B.barracks,   ['rclFurnace'],
    FACTION_RECLAIM),
  structure('rclBreakerYard', BuildRole.WarFactory, 1900, -40, B.warFactory, ['rclSorter'],
    FACTION_RECLAIM),
  structure('rclSpotter',     BuildRole.Radar,      1000, -40, B.radar,      ['rclSorter'],
    FACTION_RECLAIM),
  structure('rclCrucible',    BuildRole.TechLab,    2000, -60, B.battleLab,  ['rclSpotter'],
    FACTION_RECLAIM),
  structure('rclHeap',        BuildRole.Storage,     150, -10, B.oreSilo,    ['rclSorter'],
    FACTION_RECLAIM),

  // The Spitpost is the cheapest static defence any army fields and it answers
  // infantry hardest, which is what the build layer should reach for first when
  // it is being rushed. The Arc Pylon takes the AntiAir slot and is gated on
  // the RADAR rather than the tech lab — a tier earlier than a Refractor Tower —
  // which is why its 90-power draw has to be modelled honestly here.
  structure('rclSpitpost', BuildRole.Defense, 420, 0, B.pillbox, ['rclRookery'],
    FACTION_RECLAIM, BuildTab.Defense, [1.9, 0.8, 0.3, 0, 0]),
  structure('rclPylon', BuildRole.AntiAir, 1450, -90, B.prismTower, ['rclSpotter'],
    FACTION_RECLAIM, BuildTab.Defense, [2.0, 1.3, 1.1, 0, 1.2]),

  fighter('rclScrapper', BuildRole.Harvester, EntityKind.Vehicle, 1150, ['rclSorter'],
    FACTION_RECLAIM, NO_ANSWER, 0),
  fighter('rclCrawler', BuildRole.Mcv, EntityKind.Vehicle, 3000, ['rclBreakerYard'],
    FACTION_RECLAIM, NO_ANSWER, 0),
  fighter('rclTinker', BuildRole.Engineer, EntityKind.Infantry, 500, ['rclRookery'],
    FACTION_RECLAIM, NO_ANSWER, 0),

  // Weight 5 on a 90-credit body: the Reclamation's default army really is
  // mostly pickers, and at composition 0 an Easy brain fielding a horde of them
  // is playing the faction correctly by accident.
  fighter('rclPicker', BuildRole.Infantry, EntityKind.Infantry, 90, ['rclRookery'],
    FACTION_RECLAIM, [1.5, 0.5, 0.2, 0.2, 0.6], 5),
  // The army's only real answer to a structure on foot. Role `Infantry` rather
  // than `Siege` deliberately: `forRole` returns the FIRST entry with a role,
  // and a Reclamation brain asking for siege has to be handed the Slaghurler,
  // not a man with a satchel. The anti-structure doctrine is carried by the
  // answer vector, which is where the scorer reads it anyway.
  fighter('rclSlagger', BuildRole.Infantry, EntityKind.Infantry, 380, ['rclRookery'],
    FACTION_RECLAIM, [0.9, 1.0, 0.8, 1.6, 0], 1),
  fighter('rclSpitter', BuildRole.Skirmisher, EntityKind.Vehicle, 420, ['rclBreakerYard'],
    FACTION_RECLAIM, [1.6, 1.1, 0.4, 0.3, 1.1], 3),
  fighter('rclGrinder', BuildRole.Armor, EntityKind.Vehicle, 600, ['rclBreakerYard'],
    FACTION_RECLAIM, [1.7, 1.3, 1.1, 0.5, 0], 5),
  fighter('rclSlaghurler', BuildRole.Siege, EntityKind.Vehicle, 1150, ['rclBreakerYard', 'rclCrucible'],
    FACTION_RECLAIM, [1.1, 1.0, 0.9, 1.9, 0], 2),
  // Air 0 -> 1.4, for the same reason as the Kestrel: it flies, and its arc
  // reaches up.
  fighter('rclHornet', BuildRole.Skirmisher, EntityKind.Vehicle, 900, ['rclBreakerYard', 'rclSpotter'],
    FACTION_RECLAIM, [1.6, 1.4, 1.0, 0.4, 1.4], 1),

  /* -- THE ALLIED AND SOVIET AIR ARMS ---------------------------------------
   * Without these two rows the brain does not know the aircraft EXIST. The
   * catalog is what `chooseUnit` scores over, `ROLE_BY_KEY` and
   * `DOCTRINE_BY_KEY` are both derived from this array, and `bind()` only
   * touches keys already in it — so a def row with no entry here is a unit a
   * human can build and an AI never will, in a match the AI is supposed to be
   * playing by the same rules.
   *
   * APPENDED, not filed into the Allied and Soviet blocks above, and the reason
   * is `forRole`: it returns the FIRST entry with a matching role that the
   * faction can field. `prismTank` must stay the Allied `Siege` answer and
   * `attackDog` the Soviet `Skirmisher`, so a new row of either role has to
   * land after them. Appending is the only placement that changes no existing
   * role resolution.
   *
   * THE TWO ANSWER VECTORS ARE THE ONE PLACE THE ASYMMETRY IS WRITTEN DOWN
   * FOR THE BRAIN. `air-layer.spec` §6 enforces the floor — nothing may score
   * >= 1.0 against Air without a gun whose `canTargetAir` is true — and both
   * of these clear it honestly. Above that floor:
   *
   *   Petrel Bomber   Rocket warhead: 0.90 vs Concrete and 0.95 vs Heavy, so
   *                   Structure 1.4 and Heavy 1.5. Air 1.2 — it CAN elevate,
   *                   but a 2.58 s missile cycle will not catch an Interceptor.
   *   Interceptor     AutoCannon: 1.00 vs Light, and every aircraft in the game
   *                   is Light. Air 1.9 is the highest figure in the table,
   *                   ahead of the Flak Trooper's 1.7, which is correct — a
   *                   Soviet brain that sees a gunship should reach for the
   *                   Interceptor first. 0.35 vs Heavy AND Concrete is why
   *                   Structure is 0.3: this must never look like an answer to
   *                   a base.
   *
   * Weight 1 on both, matching the Kestrel and the Hornet. Aircraft are an
   * accent on an army, not the bulk of one, and a weight that said otherwise
   * would have an AI spending its whole bank on things a single Flak Trooper
   * answers.
   * ---------------------------------------------------------------------- */
  fighter('vindicator', BuildRole.Siege, EntityKind.Vehicle, 1200, ['warFactory', 'radar'],
    Faction.Allies, [0.6, 1.3, 1.5, 1.4, 1.2], 1),
  fighter('mig', BuildRole.Skirmisher, EntityKind.Vehicle, 1000, ['warFactory', 'radar'],
    Faction.Soviets, [1.2, 1.6, 0.7, 0.3, 1.9], 1),
];

/**
 * Content-key -> role, used when binding to a REAL def table: the data module
 * publishes cost/power/prereqs but has no reason to publish "this is what the
 * AI should think this building is for".
 */
const ROLE_BY_KEY: Readonly<Record<string, BuildRole>> = (() => {
  const m: Record<string, BuildRole> = {};
  for (const e of FALLBACK_CATALOG) m[e.key] = e.role;
  return m;
})();

/**
 * Same idea for the answer vectors, army weights and cargo slots.
 *
 * `slots` rides here rather than beside `cost` because it is the same KIND of
 * fact as the other two: something the AI needs to know about a hull that the
 * production module has no reason to publish. `fromUnitDef` overwrites it from
 * `UnitDef.cargoSlots` whenever a real def table is bound; on the oracle path
 * this value is the only one there is.
 */
const DOCTRINE_BY_KEY: Readonly<
  Record<string, { answers: readonly number[]; weight: number; slots: number }>
> = (() => {
  const m: Record<string, { answers: readonly number[]; weight: number; slots: number }> = {};
  for (const e of FALLBACK_CATALOG) {
    m[e.key] = { answers: e.answers, weight: e.weight, slots: e.slots };
  }
  return m;
})();

/**
 * The shape `src/game/Scenarios.ts` returns from `resolveDefBinding()`.
 * Declared structurally rather than imported so `src/sim/**` never depends on
 * `src/game/**` — `ai.system.ts` does the import and hands the result down.
 */
export interface DefLookup {
  readonly tables: DefTables | null;
  readonly unitId: Readonly<Record<string, number>>;
  readonly buildingId: Readonly<Record<string, number>>;
}

/** What the production module knows about one buildable. */
export interface ProductionFacts {
  /** `BuildEntry.publicId` — the id every production command speaks in. */
  readonly publicId: number;
  readonly isBuilding: boolean;
  readonly tab: BuildTab;
  readonly cost: number;
  readonly buildTimeSec: number;
  readonly power: number;
  readonly footprintW: number;
  readonly footprintH: number;
  readonly prereqs: readonly string[];
  readonly faction: Faction;
  readonly buildable: boolean;
}

/**
 * THE INTEGRATION SEAM WITH THE PRODUCTION MODULE.
 *
 * Declared structurally, and supplied by `ai.system.ts`, for the same reason as
 * `DefLookup`: `AI.ts` stays testable with no production module in the process,
 * and there is no import edge between two sibling sim modules.
 *
 * What it buys is worth more than the indirection. With an oracle attached the
 * AI stops carrying its own opinion about what is buildable and where: it asks
 * `available()`, which is the exact call the sidebar makes to grey out a cameo,
 * and `placeable()`, which is the exact call the build ghost makes to turn red.
 * The AI and the human are then provably playing by one set of rules, which is
 * the whole reason the AI is required to go through the command bus.
 */
export interface ProductionOracle {
  /** Facts for a content key, or null when the tech tree has no such thing. */
  factsFor(key: string): ProductionFacts | null;
  /** The sidebar's own answer: prereqs, faction and a servicing factory. */
  available(player: number, publicId: number): boolean;
  /**
   * The tooltip the sidebar would show for a greyed-out cameo. Optional, and
   * worth supplying: it is what turns "the AI built nothing" into "the AI was
   * told it needs a Construction Yard", which is a bug report instead of a
   * mystery. Empty string when the item IS available.
   */
  reason?(player: number, publicId: number): string;
  /**
   * True when the only obstacle is a per-army cap that is already met.
   *
   * Optional, and separate from `reason` on purpose: the AI declines a capped
   * entry either way, but it must not REPORT the refusal. "You already have a
   * War Commissar" is permanent, and the brain's `blocked` diagnostic keeps the
   * first refusal of each build pass — so without this the field pins to the
   * hero cap for the rest of the match and buries any real reason under it.
   */
  atCap?(player: number, publicId: number): boolean;
  /** The build ghost's own answer for a footprint ORIGIN cell. */
  placeable(player: number, publicId: number, cx: number, cz: number): boolean;
  /**
   * The content key of a LIVE entity, or '' when the service cannot name it.
   *
   * THE ONLY RELIABLE ENTITY -> CATALOG BRIDGE, and the reason it had to be
   * added. `BuildCatalog.entryForUnit`/`entryForBuilding` are keyed on
   * `facts.publicId` — the id `issueProductionStart` speaks — while every
   * caller looks them up with `store.defId`, which is the DEF TABLE index. The
   * two id spaces are not the same in a real match, so both reverse maps miss
   * every time and both callers fall through to their heuristics. That was
   * invisible while the heuristics happened to be right: `roleOfBuilding`'s
   * EntityFlag fallback correctly separates a yard from a refinery, so nothing
   * ever asked why the catalog path was not answering.
   *
   * It stops being invisible the moment a WARSHIP exists. There is no flag that
   * separates a Kite Corvette from a Solarch — every ship and the entire
   * Meridian army share `Locomotor.Hover` — so a missed lookup puts a destroyer
   * in the land strike group, which then marches on the enemy base overland and
   * counts toward a `waveThreshold` it can never help reach.
   *
   * `ProductionService` already keeps this map (`entryOfEntity`, stamped at
   * spawn) and already exposes it as `entryOf`. Optional so the headless tests,
   * which have no production module, keep working against the heuristics.
   */
  entityKey?(id: number): string;
}

/**
 * The AI's buildable universe.
 *
 * Constructed from `FALLBACK_CATALOG` and then optionally re-bound against a
 * real def table. Rebinding REPLACES entries so cost, power, prereqs and
 * footprint all come from content once content exists; the role, the answer
 * vector and the army weight stay authored here because they are doctrine, not
 * content.
 */
export class BuildCatalog {
  private readonly byKey = new Map<string, CatalogEntry>();
  /** Dense list, stable order, so iteration is deterministic. */
  private readonly list: CatalogEntry[] = [];
  /** Reverse maps, so a spawned entity's `defId` can be named. */
  private readonly buildingByDef = new Map<number, CatalogEntry>();
  private readonly unitByDef = new Map<number, CatalogEntry>();
  /** True once a real DefTables has been bound. */
  bound = false;

  constructor() {
    for (const e of FALLBACK_CATALOG) {
      const copy: CatalogEntry = { ...e };
      this.byKey.set(copy.key, copy);
      this.list.push(copy);
    }
  }

  get all(): readonly CatalogEntry[] { return this.list; }

  get(key: string): CatalogEntry | undefined { return this.byKey.get(key); }

  /** True when this key has a def id the production system can actually accept. */
  resolved(key: string): boolean {
    const e = this.byKey.get(key);
    return e !== undefined && e.defId >= 0;
  }

  /** Number of entries with a real def id. 0 means "no data module yet". */
  get resolvedCount(): number {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].defId >= 0) n++;
    return n;
  }

  /**
   * Adopt a real def table. Safe to call with a partially-populated binding:
   * a key that resolves to -1 keeps its fallback numbers and stays unbuildable
   * (`resolved()` is false), which is exactly the honest state — the AI knows
   * the unit exists in doctrine and knows it cannot order one.
   */
  bind(lookup: DefLookup | null | undefined): void {
    if (lookup == null) return;
    const tables = lookup.tables;
    this.bound = tables !== null;
    this.buildingByDef.clear();
    this.unitByDef.clear();

    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      const id = e.isBuilding ? lookup.buildingId[e.key] : lookup.unitId[e.key];
      if (id === undefined || id < 0) continue;
      e.defId = id;
      let final = e;

      if (tables !== null) {
        const doctrine = DOCTRINE_BY_KEY[e.key] ?? { answers: NO_ANSWER, weight: 0, slots: 0 };
        const replacement = e.isBuilding
          ? fromBuildingDef(tables.buildings[id], e, doctrine)
          : fromUnitDef(tables.units[id], e, doctrine);
        if (replacement !== null) {
          this.byKey.set(e.key, replacement);
          this.list[i] = replacement;
          final = replacement;
        }
      }

      if (final.isBuilding) this.buildingByDef.set(id, final);
      else this.unitByDef.set(id, final);
    }
  }

  /**
   * Adopt the production module's tech tree. Strictly better than `bind()` and
   * strictly preferred: `publicId` is the id `issueProductionStart` and
   * `issuePlaceBuilding` actually speak, and cost/prereqs/footprint come from
   * the same authored table the human's sidebar reads.
   *
   * Doctrine — role, answer vector, army weight — stays authored here, because
   * the production module has no reason to publish "what the AI should think
   * this is for".
   */
  bindOracle(oracle: ProductionOracle): number {
    this.buildingByDef.clear();
    this.unitByDef.clear();
    let n = 0;

    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      const facts = oracle.factsFor(e.key);
      if (facts === null || !facts.buildable || facts.publicId < 0) {
        // Not in the tech tree (or exists only as a prereq). Keep the authored
        // entry, leave defId at -1: the AI knows of it and knows it cannot
        // order one, which is the honest state.
        continue;
      }
      const doctrine = DOCTRINE_BY_KEY[e.key] ?? { answers: NO_ANSWER, weight: 0, slots: 0 };
      const merged: CatalogEntry = {
        key: e.key,
        defId: facts.publicId,
        isBuilding: facts.isBuilding,
        tab: facts.tab,
        cost: facts.cost,
        buildTimeSec: facts.buildTimeSec,
        power: facts.power,
        footprintW: facts.footprintW,
        footprintH: facts.footprintH,
        prereqs: facts.prereqs.length > 0 ? facts.prereqs : e.prereqs,
        role: ROLE_BY_KEY[e.key] ?? e.role,
        faction: facts.faction,
        answers: doctrine.answers,
        weight: doctrine.weight,
        slots: doctrine.slots,
      };
      this.byKey.set(e.key, merged);
      this.list[i] = merged;
      if (merged.isBuilding) this.buildingByDef.set(merged.defId, merged);
      else this.unitByDef.set(merged.defId, merged);
      n++;
    }
    this.bound = n > 0;
    return n;
  }

  /** The catalog entry a live building's `defId` names, if any. */
  entryForBuilding(defId: number): CatalogEntry | undefined {
    return defId < 0 ? undefined : this.buildingByDef.get(defId);
  }

  /** The catalog entry a live unit's `defId` names, if any. */
  entryForUnit(defId: number): CatalogEntry | undefined {
    return defId < 0 ? undefined : this.unitByDef.get(defId);
  }

  /**
   * Every entry a faction may build, in catalog order. `Faction.Neutral`
   * entries belong to both armies.
   */
  forFaction(faction: Faction, out: CatalogEntry[]): CatalogEntry[] {
    out.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.faction === Faction.Neutral || e.faction === faction) out.push(e);
    }
    return out;
  }

  /** First entry with this role that the faction can field, or undefined. */
  forRole(role: BuildRole, faction: Faction): CatalogEntry | undefined {
    let fallback: CatalogEntry | undefined;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.role !== role) continue;
      if (e.faction === faction) return e;
      if (e.faction === Faction.Neutral && fallback === undefined) fallback = e;
    }
    return fallback;
  }

  /**
   * The SMALLEST carrier this faction can buy that holds `wantSlots`, or the
   * biggest it can buy when nothing does.
   *
   * `forRole(Transport)` cannot answer this and never could: it returns the
   * FIRST row of a role, which was `mrdSkiff` for the Pact — a 2-slot land
   * raider gated on their war factory — and for everyone else whichever carrier
   * happened to be filed first. Every army now fields a 4-slot landing ship and
   * an 8-slot heavy, so "a transport" is no longer a thing you can ask for: an
   * 8-slot hull at 1100-1250 credits to ferry three riflemen is 500 credits of
   * nothing, and a 2-slot hull for a six-man landing is an operation that never
   * stages.
   *
   * SMALLEST-THAT-FITS RATHER THAN CHEAPEST-THAT-FITS, because cost and
   * capacity are the same ordering in every faction's list today and slots are
   * the property the operation is actually sized against. A tie goes to the row
   * declared first, so the answer is stable and does not depend on catalog
   * order beyond that.
   *
   * `allowed` IS NOT AN OPTIMISATION AND THE CALLER MUST PASS IT. Faction
   * `Neutral` on a hull means "the two ORIGINAL armies share this", not
   * "everyone" — `transport`, the 8-slot Heavy, is gated on `navalYard`, which
   * the Sub Pen aliases and the Slipway and the Breaker Dock do NOT. Without a
   * buildability filter this function hands the Pact and the Reclamation the
   * one carrier they can never order, `consider` refuses it, and the brain owns
   * a dock and no ferry: measured over a 24-minute four-army match as two
   * brains with a naval yard, four warships between them and ZERO transports.
   * The filter also carries affordability, which is the other half of the same
   * lesson — a 1200-credit heavy the brain cannot pay for must not shut out the
   * 700-credit landing craft it can.
   */
  forLift(
    faction: Faction, wantSlots: number, allowed?: (e: CatalogEntry) => boolean,
  ): CatalogEntry | undefined {
    let best: CatalogEntry | undefined;
    let biggest: CatalogEntry | undefined;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.role !== BuildRole.Transport || e.slots <= 0) continue;
      if (e.faction !== faction && e.faction !== Faction.Neutral) continue;
      if (allowed !== undefined && !allowed(e)) continue;
      if (biggest === undefined || e.slots > biggest.slots) biggest = e;
      if (e.slots < wantSlots) continue;
      if (best === undefined || e.slots < best.slots) best = e;
    }
    return best ?? biggest;
  }
}

function fromBuildingDef(
  def: BuildingDef | undefined,
  base: CatalogEntry,
  doctrine: { answers: readonly number[]; weight: number; slots: number },
): CatalogEntry | null {
  if (def === undefined) return null;
  return {
    key: base.key,
    defId: base.defId,
    isBuilding: true,
    tab: def.tab,
    cost: def.cost,
    buildTimeSec: def.buildTime,
    power: def.power,
    footprintW: def.footprintW,
    footprintH: def.footprintH,
    // Def prereqs are real content keys; the AI's own prereq check normalises
    // both sides, so a data module spelling it 'war_factory' still matches.
    prereqs: def.prereqs.length > 0 ? def.prereqs : base.prereqs,
    role: ROLE_BY_KEY[base.key] ?? base.role,
    faction: def.faction,
    answers: doctrine.answers,
    weight: doctrine.weight,
    slots: 0,
  };
}

function fromUnitDef(
  def: UnitDef | undefined,
  base: CatalogEntry,
  doctrine: { answers: readonly number[]; weight: number; slots: number },
): CatalogEntry | null {
  if (def === undefined) return null;
  return {
    key: base.key,
    defId: base.defId,
    isBuilding: false,
    tab: def.tab,
    cost: def.cost,
    buildTimeSec: def.buildTime,
    power: 0,
    footprintW: 0,
    footprintH: 0,
    prereqs: def.prereqs.length > 0 ? def.prereqs : base.prereqs,
    role: ROLE_BY_KEY[base.key] ?? base.role,
    faction: def.faction,
    answers: doctrine.answers,
    weight: doctrine.weight,
    // THE DEF TABLE WINS on this one field, unlike `answers` and `weight`:
    // slots are content, not doctrine, and the authored number beside the row
    // above exists only for the oracle path and the headless tests.
    slots: def.cargoSlots,
  };
}

/* ==========================================================================
 * 3. THE OPENING
 * ========================================================================== */

/** One scripted step. `optional` steps are skipped rather than waited for. */
export interface OpeningStep {
  readonly key: string;
  /** Skip this step instead of stalling the opening when it is unavailable. */
  readonly optional: boolean;
}

function step(key: string, optional = false): OpeningStep {
  return { key, optional };
}

/**
 * Allies open economy-first: the extra refinery before the war factory is what
 * pays for the mid game, and the Allied early game has no unit worth rushing
 * with.
 */
const OPENING_ALLIES: readonly OpeningStep[] = [
  step('powerPlant'),
  step('refinery'),
  step('barracks'),
  step('powerPlant'),
  step('warFactory'),
  step('refinery'),
  step('radar'),
];

/**
 * Soviets open with barracks before the second refinery: conscripts cost 100
 * and the Soviet early pressure is the whole point of the faction.
 */
const OPENING_SOVIETS: readonly OpeningStep[] = [
  step('powerPlant'),
  step('barracks'),
  step('refinery'),
  step('powerPlant'),
  step('warFactory'),
  step('refinery'),
  step('radar'),
];

/**
 * Personality edits the script rather than replacing it — a Rusher and a Boomer
 * that shared no build order at all would read as two different games, and the
 * personalities are supposed to be a tilt, not a fork.
 */
/**
 * MERIDIAN. Power, then BARRACKS, then the first refinery — an order neither
 * rival can copy, and the whole faction identity expressed as a build script.
 *
 * A Solar Array is 350 credits for 160 power against a Power Plant's 300 for
 * 100. One array carries the Conclave (-20), a Chapterhouse (-20) AND a Cistern
 * (-30) with 90 to spare, where the other two armies are 70 in the hole and
 * must buy a second plant before the war factory. That surplus is spent here,
 * on getting a screen of Wayfarers out before the first refinery has paid for
 * itself — because the Pact's army is fragile and the one thing it cannot
 * survive is an early rush arriving before anything is on the field.
 *
 * The second array is deliberately BEFORE the Oculus rather than after: both
 * Pact defences and the Zenith Emitter carry `needsPower` weapons, so a brownout
 * is not an inconvenience for this faction, it is a disarm.
 */
const OPENING_MERIDIAN: readonly OpeningStep[] = [
  step('mrdSolarArray'),
  step('mrdChapterhouse'),
  step('mrdCistern'),
  step('mrdForgeyard'),
  step('mrdSolarArray'),
  step('mrdCistern'),
  step('mrdOculus'),
];

/**
 * THE RECLAMATION. Furnace, ROOKERY, Sorter, and then a SECOND FURNACE before
 * the Breaker Yard — the only opening in the game that buys two power plants
 * before its vehicle factory, and it has to.
 *
 * A Scrap Furnace is 80 power. One carries the Foundry (-20) and the Rookery
 * (-20) with 40 spare; add the Ore Sorter (-30) and the Breaker Yard (-40) and
 * the base is 30 in the hole on one plant and 50 to the good on two. Neither
 * rival has to think about this before its factory; this faction always does,
 * which is the price of a plant that costs 240 credits.
 *
 * What the tempo buys back is on the other side of the Breaker Yard: Grinders
 * and Arcspitters name NO further prereq, so this script is four structures
 * from nothing to a full line army, where the Allied script is five and the
 * Soviet script is five. The radar step at the end is for the Arc Pylon and the
 * Swarmhornet, not for the army.
 */
const OPENING_RECLAIM: readonly OpeningStep[] = [
  step('rclFurnace'),
  step('rclRookery'),
  step('rclSorter'),
  step('rclFurnace'),
  step('rclBreakerYard'),
  step('rclSorter'),
  step('rclSpotter'),
];

/* --------------------------------------------------------------------------
 * THE STEP BEFORE STEP ONE
 *
 * Every script above starts at a power plant, and that is correct — but it is
 * only reachable once a Construction Yard exists, and a match no longer hands
 * one out. `game/Scenarios.ts` start condition `mcv` (the default) gives each
 * army ONE construction vehicle and an escort, and the yard is something the
 * commander has to drive somewhere and unfold.
 *
 * That step is NOT in the script. A scripted step is a production request, and
 * deploying is an ORDER issued to a unit that already exists — different verb,
 * different layer. `AI.ts` runs it as its own layer ahead of the build layer,
 * and the script below picks up unchanged the moment a yard is standing.
 *
 * What the script DOES have to survive is the gap: for the first few seconds the
 * AI owns no structures at all, so `chooseBuild` finds nothing available and
 * `available()` records "no Construction Yard". That is the honest state and it
 * must not be mistaken for a stall — see `AiBrain.mcvPending`.
 * -------------------------------------------------------------------------- */

/**
 * Everything the deploy layer is tuned by. Local to the AI rather than in
 * `core/config.ts` because it is doctrine, not a shared engine tunable, and
 * because `src/sim/AIStrategy.ts` is where the rest of the AI's doctrine lives.
 */
export const AI_DEPLOY = {
  /**
   * Ticks between the FIRST Deploy order for a site and writing that site off.
   *
   * Measured from the first order and never refreshed by a re-issue, because a
   * clock the re-issue resets can never expire — see `AiBrain.deployArmedTick`.
   * The vehicle is already standing on the site by this point (the drive has
   * its own, much longer clock below), so ten seconds at 30 Hz is generous:
   * a deploy that has not produced a yard in that time is a deploy the ground
   * refused, and the answer is to go somewhere else.
   */
  retryTicks: 300,
  /**
   * Ticks allowed for the DRIVE to the site before the site is written off as
   * unreachable.
   *
   * Separate from `retryTicks`, and it has to be: `maxTravel` is 64 m and a
   * construction vehicle does about 4.5 m/s, so a perfectly good approach takes
   * fifteen seconds before the first Deploy order is even issued. Sharing one
   * clock would have the AI re-siting mid-drive, forever, and never arriving
   * anywhere — the exact "does nothing all match" failure, arrived at from the
   * opposite direction. 900 ticks is thirty seconds: twice the honest drive,
   * with room for a detour around a rock.
   */
  approachTicks: 900,
  /** Cells the deploy siter will search outward from its anchor. */
  searchRings: 14,
  /** Clear cells required on every side of the yard footprint. */
  gapCells: 1,
  /**
   * Cells to look for ore around the vehicle. A yard beyond this from ore is a
   * yard whose refinery cannot pay for itself.
   */
  oreSearchCells: 44,
  /**
   * Metres the yard is set BACK from the ore it was sited against. A refinery
   * has to fit between the two, and a yard planted on top of the field
   * bulldozes the cells its own harvesters were going to mine.
   */
  oreStandoff: 26,
  /**
   * Metres the vehicle will drive to reach a better site.
   *
   * There is a real trade here and it is not close. A construction vehicle
   * moves at about 4.5 m/s, so every 45 m of detour is ten seconds of a match
   * in which the AI has no base, no power, no income and nothing on the field —
   * and it is ten seconds spent driving an undefended 3000-credit truck through
   * open ground. Past roughly a minute of build time saved, siting closer to the
   * ore stops paying for itself, and 64 m is where that lands.
   */
  maxTravel: 64,
  /**
   * Metres a SECOND yard must be from the first. Below this it is not an
   * expansion, it is two yards sharing one build radius.
   */
  expansionSpacing: 90,
  /** Attempts before the AI stops relocating and just deploys where it stands. */
  maxRelocations: 6,
} as const;

/* ==========================================================================
 * 3a-bis. THE NAVY
 *
 * WHAT THE MEASUREMENT SAYS, BEFORE ANY OF THESE NUMBERS MEAN ANYTHING.
 * Run against the real generator through the real `FlowFieldCache`, on the
 * pinned seed and biome of both shipped sea maps:
 *
 *                       land regions   A->B by land   water on the A->B line
 *     contested-strait   1 (100%)       68 cells       0 cells
 *     coral-shore        1 (100%)       68 cells       0 cells
 *
 * The land is ONE region on both. Nothing is unreachable, and the straight line
 * between the two openings does not touch water at all — `MAP_SEAS` derives its
 * waterline from the PERPENDICULAR BISECTOR of the two openings so that both
 * armies are equidistant from it, which necessarily puts the sea off a FLANK
 * and never between them. `SeaSpec` is a signed half-plane (`seaDistance` is a
 * dot product), so a strait with a far shore is not expressible by this
 * generator at all.
 *
 * AND A MAP WITH NO SEA GETS NO NAVY AT ALL. `mapSupportsNaval()` in
 * `sim/NavalWater.ts` is the gate in front of every constant below — the largest
 * contiguous body the real `FlowFieldCache` routes `MoveClass.Naval` through,
 * which is 3622/3952 cells on the two sea maps against 0-14 on the four
 * landlocked ones. It lives there rather than here so the build menu can share
 * the one definition instead of growing a second.
 *
 * SO THE LANDING CORRECTLY REFUSES ON BOTH, and the reason is `isReachable`:
 * the land is one region, so the objective is walkable and there is nothing the
 * sea can do about it. `Sunder Atoll` is the map where that inverts — four
 * islands, one sea, and an objective in another land region — and there the
 * same test fires.
 *
 * THIS HEADER USED TO CREDIT THAT REFUSAL TO `amphibiousMinSaving`, AND THAT
 * WAS NEVER TRUE. That gate compared a STRAIGHT LINE from the group to the
 * objective against a THREE-SEGMENT POLYLINE over the same two endpoints
 * (group -> beach -> far beach -> objective). By the triangle inequality the
 * polyline is never shorter, so the saving was never positive, so the test
 * `saving < 12` was true on every map, every seed, every tick, and the second
 * arm of `amphibiousWanted` was unreachable code wearing a measurement's
 * clothes. The quoted "104-113 cells against 68" is that same arithmetic: it is
 * the triangle inequality restated, not a property of those two maps. The
 * constant is gone and `amphibiousWanted` has one arm, which is what it always
 * had. See the block comment there for what a real second arm would need.
 *
 * The sea is still worth contesting on both: it is a quarter of the map that
 * currently belongs to whoever bothers to sail on it, which is nobody.
 * ========================================================================== */

export const AI_NAVAL = {
  /**
   * Cells around the base the BEACH search anchors on.
   *
   * The "does this map have a navy" question does NOT live here — it is
   * `mapSupportsNaval()` in `sim/NavalWater.ts`, deliberately, so the build
   * menu, the placement rule and the brain share one definition instead of
   * several that drift. Two of them DID land in the same wave, at thresholds
   * 400 and 300, each calling itself the single source of truth; they agreed on
   * every shipped map, which is what made it dangerous rather than visible.
   * This constant only bounds how far from the base a beach is still ours.
   */
  seaSearchCells: 40,
  /**
   * Warships the AI will own at once, before the difficulty cap.
   *
   * Low, and deliberately: a hull cannot take ground, so every credit here is a
   * credit not spent on the army that can. Two escorts deny the lane to
   * harvesting and scouting hulls, which is the whole return on the water.
   */
  maxWarships: 3,
  /** Transports owned at once. One operation at a time, so one hull plus a spare. */
  maxTransports: 2,
  /**
   * Recon hulls owned at once.
   *
   * ONE. It is a pair of eyes, not a picket line: `chooseScout` drives exactly
   * one scout at a time, so a second boat is 450 credits of nothing. Its own
   * number rather than a share of `maxWarships` for the reason `BuildRole.
   * ReconHull` is its own role — a scout competing with the escorts for those
   * three slots is an army that can see or fight, chosen by catalog order.
   */
  maxReconHulls: 1,
  /**
   * Score the naval yard enters the build scorer at.
   *
   * Below every producer the AI does not own yet (`barracks` 1.5, `warFactory`
   * 1.8) and below the first refinery, so the navy is bought OUT OF a working
   * economy and never INSTEAD OF one — the same ordering rule `considerSuper-
   * weapon` had to learn the hard way.
   */
  yardScore: 1.15,
  /**
   * Ticks a brain may spend BUYING ITS WAY TO THE COAST before it gives up.
   *
   * A Naval Yard has to stand on a shore, and construction has to stand inside
   * a build radius. Those two sets can be disjoint, and on Sunder Atoll they
   * WERE: the nearest buildable-and-coastal site was 72-79 m from the opening
   * Construction Yard against a 56 m radius, so three of the four armies had no
   * legal dock site at all on turn one. That particular hole is closed in the
   * MAP — `islandSeats` in `src/game/Scenarios.ts` seats each opening 30 m along
   * its own coast — because the human opens with the same envelope and had the
   * same problem, and no amount of AI cleverness was going to fix a start
   * position.
   *
   * The creep stays, because "a base that cannot reach water" is a state a
   * match can still arrive at: a yard rebuilt inland after the first one is
   * bombed, a future map, an opening pushed off its shelf. This bounds how long
   * the brain will PAY for the walk. Ten minutes: long enough to cross 20 m of
   * gap several times over at the rate a poor brain completes structures, short
   * enough that a base whose only beach is a cliff face stops buying generators
   * for a dock it will never found. Probing does NOT stop when this expires;
   * only paying does.
   */
  coastReachTicks: 30 * 60 * 10,
  /**
   * Cargo SLOTS a landing party must fill before it is worth the crossing.
   *
   * Slots and not bodies, because they stopped being the same number when
   * vehicles were allowed to ride: three riflemen are three slots and so is one
   * tank and a rifleman. Counting heads would refuse a two-tank landing, which
   * is four slots of the best ground-holding a hull can carry.
   */
  minLandingSquad: 3,
  /**
   * Bodies the strike group keeps while a landing party is taken out of it.
   *
   * THIS USED TO BE `waveThreshold()` AND THAT IS A LAND WAVE. The gate read
   * `strikeCount >= minLandingSquad + waveThreshold()` — 3 + 12 on a Normal
   * Turtle — so a brain needed FIFTEEN free bodies before it would put four men
   * on a four-slot landing ship. Measured on Sunder Atoll: three brains that
   * never staged an operation and one that reached the number at minute eight.
   *
   * The reserve belongs to the OPERATION, not to the wave, and the arithmetic
   * that made it a wave is backwards where it matters most: `amphibiousWanted`
   * is only true when the objective is UNREACHABLE ON LAND, so the wave those
   * bodies are being held back for has nowhere to walk. Two is enough to keep a
   * landing from emptying the base of everything that can shoot.
   */
  landingReserve: 2,
  /**
   * Ticks between amphibious evaluations.
   *
   * Rate-limited because the answer is bounded but not cheap: refusing costs a
   * full `shoreSearchCells` ring walk, and a map with no beach near the
   * objective refuses every single time. Five seconds is far inside the
   * timescale of "should I run a landing" and takes the cost to nothing.
   */
  evalTicks: 150,
  /**
   * Ticks a boarding may run before the operation is abandoned.
   *
   * SIZED TO THE WALK, and the first value was not. 450 ticks is 15 seconds;
   * the beach can be `shoreSearchCells` away (30 cells, 120 m) and infantry
   * move at roughly 3.8 m/s, so an honest boarding takes past 30 seconds before
   * anyone is aboard. The clock expired first, every time — the operation
   * re-staged on a loop and the probe sat at `boarding 0/5` forever while the
   * squad was doing exactly what it had been told to.
   *
   * Same shape as the bug `AI_DEPLOY.approachTicks` exists to record: a clock
   * that measures a decision must not be shorter than the movement the decision
   * requires. 1800 is a minute — twice the longest honest walk, with room for a
   * detour around the base.
   */
  boardTicks: 1800,
  /** Ticks the crossing may take before the operation is abandoned. */
  crossTicks: 1200,
  /** Metres from the landing point at which the hull unloads. */
  landingArriveMetres: 12,
  /** Cells searched outward for a shore cell (a beach touching open sea). */
  shoreSearchCells: 30,
} as const;

/* ==========================================================================
 * 3b. THE LATE GAME — superweapons, commander powers, upgrades
 *
 * Everything in this block is DOCTRINE ONLY: which button is worth pressing,
 * when, and at what. No world, no entities, no commands — `AI.ts` holds all
 * three of those, exactly as it does for the opening and the composition
 * scorer.
 *
 * WHY THE AI WAS DEAF TO ALL THREE. Each of these shipped complete and
 * player-usable, and each reaches the simulation through a verb the brain
 * ALREADY knows how to say:
 *
 *   superweapon      `OrderKind.UseAbility` on the gating structure — the same
 *                    order `commanderAbility` has issued since it was written.
 *   commander power  `CommandKind.UsePower`.
 *   upgrade          `CommandKind.ProductionStart`, an ordinary queue item.
 *
 * So none of this is new plumbing. What was missing was an OPINION: which
 * superweapon is worth 2500 credits and 150 power, what a nuke is worth aiming
 * at, and whether a 1200-credit multiplier beats the 1200 credits of tank it
 * costs. That opinion is below.
 *
 * THE DIFFICULTY LADDER IS PART OF THE OPINION, NOT A BOLT-ON. `AI_LATE_GAME`
 * is indexed by difficulty and it is the first knob every rule here consults,
 * because all three of these systems are FORCE MULTIPLIERS and handing them to
 * an Easy brain would undo the whole ladder in one release. The config header
 * for `AI_DIFFICULTY` is a record of that exact complaint being made about the
 * economy — "even on easy mode" — and a nuke landing on a beginner's base is
 * a louder version of it. Easy therefore gets NONE OF THIS: no superweapon, no
 * power, no upgrade. That is not laziness, it is the answer to "should an easy
 * AI use superweapons at all".
 * ========================================================================== */

/**
 * What an upgrade IMPROVES, from the buyer's point of view.
 *
 * Derived from `UpgradeScope` + `UpgradeLever` rather than authored, so a
 * thirteenth upgrade added to `src/sim/Upgrades.ts` is classified rather than
 * silently ignored. The distinction `UpgradeScope` does not draw, and that the
 * build layer needs, is between the two kinds of `UpgradeScope.All`: a Yield or
 * BuildSpeed multiplier is an ECONOMY purchase whose payback is measured in
 * income, and a Cooldown multiplier over the same scope is an ARMY purchase
 * whose payback is measured in units that own it. The Meridian Pact is the
 * faction where that matters — its `All`-scope row is Capacitor Banks.
 */
export const enum UpgradeAudience {
  /** Gated on how much infantry is on the field. */
  Infantry = 0,
  /** Gated on how many hulls are on the field. */
  Vehicle = 1,
  /** Gated on the whole army — an `All`-scope combat lever. */
  Army = 2,
  /** Gated on the economy — Yield and BuildSpeed. */
  Economy = 3,
}

export interface UpgradePlanStep {
  /** Content key. Must resolve in the catalog before the AI can name it. */
  readonly key: string;
  readonly audience: UpgradeAudience;
}

function audienceOf(scope: UpgradeScope, lever: UpgradeLever): UpgradeAudience {
  if (scope === UpgradeScope.Infantry) return UpgradeAudience.Infantry;
  if (scope === UpgradeScope.Vehicle) return UpgradeAudience.Vehicle;
  return lever === UpgradeLever.Yield || lever === UpgradeLever.BuildSpeed
    ? UpgradeAudience.Economy : UpgradeAudience.Army;
}

/** Buy order within an army, cheapest-payback first. See `UPGRADE_PLAN`. */
const AUDIENCE_ORDER: readonly UpgradeAudience[] = [
  UpgradeAudience.Economy, UpgradeAudience.Army,
  UpgradeAudience.Vehicle, UpgradeAudience.Infantry,
];

/**
 * The three upgrades each army buys, IN THE ORDER IT BUYS THEM.
 *
 * ECONOMY FIRST, and this is the one ordering decision here with an arithmetic
 * answer rather than a taste one. A Yield or BuildSpeed multiplier is the only
 * lever of the three that pays for ITSELF: 1000 credits for +20-25% on an
 * income stream repays inside a couple of minutes at the AI's own harvester
 * counts and then keeps paying, and every later purchase — including the other
 * two upgrades — arrives sooner because of it. Combat multipliers never do
 * that; they convert credits into army quality and stop.
 *
 * ARMY-WIDE NEXT, then VEHICLE, then INFANTRY, which is a value-density
 * ordering: a multiplier is worth the credits standing under it, and a hull
 * costs three to six times a body. Composite Armour at 1200 covers ~1.7
 * Wardens' worth of purchase and improves every hull the AI will ever build;
 * Advanced Optics at 800 covers four G.I.s.
 *
 * THE BREAK-EVEN IS A FLOW, NOT A STOCK, and `AI.ts` gates on the stock anyway.
 * The honest sum is not "what is my army worth now" — an armour multiplier over
 * eight conscripts is plainly not worth 800 credits — it is "how many more of
 * these will I buy before the match ends", because the multiplier covers all of
 * them and the tank it competes with covers one. That number is unknowable, so
 * the build layer uses the cheapest available proxy for "I am committed to
 * fielding this class": am I fielding it in quantity right now. See
 * `AI_UPGRADE` for the thresholds.
 */
const UPGRADE_PLAN: ReadonlyMap<number, readonly UpgradePlanStep[]> = (() => {
  const byFaction = new Map<number, UpgradePlanStep[]>();
  for (const audience of AUDIENCE_ORDER) {
    for (const u of UPGRADES) {
      if (audienceOf(u.scope, u.lever) !== audience) continue;
      const f = u.faction as number;
      let list = byFaction.get(f);
      if (list === undefined) { list = []; byFaction.set(f, list); }
      list.push({ key: u.key, audience });
    }
  }
  return byFaction;
})();

/** The upgrades this faction buys, in buy order. Empty for `Faction.Neutral`. */
export function upgradePlanFor(faction: Faction): readonly UpgradePlanStep[] {
  return UPGRADE_PLAN.get(faction as number) ?? EMPTY_PLAN;
}

const EMPTY_PLAN: readonly UpgradePlanStep[] = [];

/**
 * Thresholds the build layer checks before an upgrade is worth its cost.
 *
 * Every number here is a "am I committed to this class" proxy, not a break-even
 * — see `UPGRADE_PLAN`. They are deliberately reachable: a Normal brain running
 * three refineries clears the economy gate well before its radar is up, which
 * is the point. What they stop is the pathological buy — a multiplier over an
 * army of two, purchased instead of the barracks that would have made it eight.
 */
export const AI_UPGRADE = {
  /** Infantry on the field before an infantry-scope multiplier is worth 800. */
  minInfantry: 8,
  /** Hulls on the field before a vehicle-scope multiplier is worth 1200. */
  minVehicles: 6,
  /** Army before an `All`-scope COMBAT multiplier is worth 1000. */
  minArmy: 10,
  /** Refineries and trucks before an income multiplier repays 1000 credits. */
  minRefineries: 2,
  minHarvesters: 4,
  /**
   * Base score for an upgrade in `chooseBuild`.
   *
   * Sits between "reinforcing the base" (0.4 + pressure) and "need a war
   * factory" (1.8), and BELOW "expanding to a new ore field" (2.2) — an upgrade
   * must never outrank a producer the AI does not own yet or a field it is
   * about to be cut off from. Multiplied by `pers.tech`, so a Boomer (1.3)
   * reaches for upgrades and a Rusher (0.6) mostly puts the credits into bodies,
   * which is what those two personalities are for.
   */
  score: 1.45,
  /**
   * Cost multiple of the bank the AI insists on holding before it buys one.
   *
   * An upgrade is the one purchase in the game with NO immediate output — no
   * hull leaves a door, no wall goes up — so buying one at exactly its price
   * hands the enemy a window in which the AI has spent everything and fielded
   * nothing. Requiring 1.6x means there is still an army's worth of change in
   * the bank when the multiplier lands.
   */
  bankMultiple: 1.6,
  /**
   * Ticks before the AI will ask for the same upgrade a second time.
   *
   * A minute. This is a BACKSTOP, not the mechanism — `upgradeSettled` answers
   * from `PlayerState.upgradeMask` and from the live queue first, and in a
   * normal match neither ever lets a second request through. What this covers
   * is the gap where the command has been issued and the queue does not show it
   * yet, and the case where nothing is listening at all. It is not permanent
   * because a request issued before the production module finished booting has
   * to be retried, or one unlucky tick costs the AI an upgrade for the match.
   */
  reaskTicks: 1800,
} as const;

/**
 * BUYING BUILD CAPABILITY — what a bank that is running ahead of the line is
 * for.
 *
 * Reported as *"AI building capabilities should be according to his money"*,
 * and the gap was exact: `BuildQueue` gives a queue to the PLAYER rather than
 * to a building, so a second Barracks does not open a second queue — it makes
 * the one queue `FACTORY_SPEED_BONUS` faster, compounding to `FACTORY_SPEED_CAP`.
 * That is the game's whole money-for-tempo trade and it is identical for both
 * sides. `AiBrain.chooseBuild` proposed a barracks or a war factory only while
 * it owned NONE, so the AI's production line was a constant and its bank could
 * not move it.
 *
 * These numbers deliberately have no per-rung row. The ladder is already in the
 * money: `AI_SKILL[].creditFloor`, `maxRefineries` and `maxHarvesters` decide
 * how rich a rung ever gets, and `AiBrain.considerExtraProducers` measures
 * `spendable` (post-floor) rather than raw credits. An Easy brain running two
 * refineries and leaving 1400 idle does not clear `bankMultiple` on a barracks;
 * a Brutal brain with a finished economy clears it easily. Adding a
 * `maxProducers` column to `AI_SKILL` would be the orthodox home for a rung
 * knob if this ever needs one — see the note over that table — but it does not
 * need one to ladder correctly, and a constant only one reader honours is how
 * the ladder ends up flat again.
 */
/**
 * FOCUS FIRE — the brain naming ONE target instead of pointing at a place.
 *
 * The audit that produced this found the brain issuing seven order kinds and
 * `OrderKind.Attack` was not among them: every engagement in the game's history
 * was an `AttackMove`, which hands target choice to `Targeting`'s automatic
 * acquisition. Automatic acquisition is per-unit and range-first, so a line of
 * twelve hulls spreads its damage across everything in front of it and kills
 * nothing — the single most visible difference between an AI army and a
 * player's, and the reason "0 skills" and "one objective forever" were the same
 * gap wearing two hats.
 *
 * WHAT THIS IS NOT. It is not a micro suite. There is no kiting, no per-unit
 * repositioning and no target juggling; the group is told what to kill and the
 * existing movement, stance and retreat layers do everything else. A player can
 * SEE this one — their wounded tank dies instead of limping away — which is the
 * test the coordinator set for it.
 *
 * THE LADDER IS `AI_SKILL[].discipline`, WHICH ALREADY MEANS THIS. Its own
 * declaration reads "how well it fights" and the retreat layer already rolls
 * against it. Easy sits at 0.35 and is excluded outright by `minDiscipline`, so
 * that rung is byte-identical; the other three roll `rng.chance(discipline)`
 * every re-pick, so Normal concentrates two fights in three and Brutal every
 * one. No new per-rung row, and nothing in `config.ts` had to move.
 */
/**
 * THE OPENING GOVERNOR — the brain declines to spend the opening bank on
 * ARMY AND DEFENCE before it has earned anything.
 *
 * THIS IS THE THIRD DELIBERATE AI ASYMMETRY, and the only one in this file.
 * CLAUDE.md documents the other two — `AI_DIFFICULTY[].resourceBonus` on
 * harvested income, and `aiMirrorsUnlocks` — and is emphatic that the "prebuilt
 * AI base" is NOT one. It is not, and this does not add one: both sides start
 * with an MCV and zero buildings, and the deploy layer is worth **-0.83 s** to
 * the AI (a human pressing Deploy on tick 0 finishes their yard at t+1.60 s
 * against the AI's t+2.43 s).
 *
 * WHAT A PLAYER IS ACTUALLY LOOKING AT IS THE 10 000-CREDIT OPENING BANK.
 * Measured with nobody touching the controls, seed 7, Normal:
 *
 *     t+30s    1 bld   6 un   cr 9746      conyard    t+2.4s
 *     t+60s    4 bld   6 un   cr 8900      power      t+37.4s
 *     t+90s    7 bld  11 un   cr 4852      barracks   t+61.4s
 *     t+240s  16 bld  27 un   cr    0      flameTower t+74.9s
 *                                          refinery   t+90.4s
 *
 * By ninety seconds the AI has a seven-building base with a defence tower and
 * eleven troops and HAS MINED ZERO ORE — its first refinery pays out at that
 * exact moment. It is spending the same bank the player is holding and has not
 * spent yet. The author's decision was to keep the 10 000 and slow the AI, so
 * the player's economy is untouched and this is the whole of the change.
 *
 * IT IS PER-CANDIDATE, AND THE FIRST VERSION WAS NOT — THAT IS THE WHOLE
 * LESSON. Capping `AiBrain.spendable` caps EVERY purchase, including the
 * refinery that ends the governor, and that manufactures two failures that
 * cannot both be tuned away:
 *
 *   THE DEADLOCK. Easy holds the largest `creditFloor` (1400), so a bank-wide
 *   cap stacks with it. Measured at hold 0.75: allowance 2500 - floor 1400 =
 *   1100 against a 2000 refinery. Easy sat on 9400 credits with three buildings
 *   and zero ore for the entire match, permanently unable to buy the thing that
 *   would have freed it.
 *
 *   THE FLOOR THAT UNDOES THE LADDER. Flooring the allowance at the refinery's
 *   price fixes the deadlock and then IS the allowance for the tightest rung —
 *   2000 of Easy's 2500 — so the floor becomes general room and Easy spent it
 *   on a pillbox at t+50.1 s, BEFORE its own refinery finished at t+78.6 s.
 *   That is the exact thing this feature exists to prevent.
 *
 * So the discrimination belongs where the brain already knows what it is
 * buying. `AiBrain.consider` sees a `CatalogEntry` and therefore a role:
 * economy and production measure against the ungoverned budget, everything
 * else against the governed one. The governor STRUCTURALLY CANNOT block the
 * refinery, so no floor is needed, no deadlock is possible, and Easy can be
 * governed as hard as the ladder wants.
 *
 * IT IS A SPENDING POLICY, NOT A RULE ABOUT MONEY. It only lowers a number the
 * brain uses to decide WHEN IT CHOOSES to issue a `ProductionStart`. It changes
 * nothing about what credits can buy, binds the human nowhere, and lives
 * entirely on the brain's side of `channels.command`. The same rule in
 * `Production` or `Economy` would have bound both sides and been the wrong fix.
 *
 * IT CANNOT DESYNC A LOCKSTEP MATCH, and the next reader will ask, so: every
 * input is sim state both clients compute identically (`p.credits`,
 * `p.stats.oreMined`, `p.stats.creditsSpent`), there is no RNG draw, no wall
 * clock and no profile read, and the only output is which command goes on the
 * bus — replayed on both machines exactly as any other AI order is.
 *
 * IT RETIRES AT THE FIRST ORE, and latches. `oreMined > 0` is the earliest
 * honest exit: the property bought is "the AI cannot field an army and a
 * defence tower before its first refinery pays out", not "the AI is slow".
 * Anything later would be a delay dressed up as a policy. Once retired the
 * governed budget IS the ungoverned one, so every later decision in the match
 * is bit-identical to a brain that never had a governor.
 *
 * THE LADDER IS WHAT MAKES IT DEFENSIBLE — a Brutal opponent spending its bank
 * fast is a legitimate difficulty. The table lives here rather than in
 * `AI_SKILL` for the same reason `AI_LATE_GAME` does: it is doctrine only this
 * brain reads. Discretionary allowance against the shipped 10 000:
 *
 *     Easy    0.85    1500
 *     Normal  0.70    3000
 *     Hard    0.50    5000
 *     Brutal  0.30    7000
 */
export const AI_OPENING = [
  { holdFraction: 0.85 },
  { holdFraction: 0.70 },
  { holdFraction: 0.50 },
  { holdFraction: 0.30 },
] as const;

/** Fraction of the opening bank a rung will not spend on army or defence. */
export function openingHoldFor(difficulty: number): number {
  const i = difficulty < 0 ? 0
    : difficulty >= AI_OPENING.length ? AI_OPENING.length - 1
      : difficulty | 0;
  return AI_OPENING[i].holdFraction;
}

/**
 * Is this role part of getting an economy standing, rather than something
 * bought out of one?
 *
 * THE GOVERNOR NEVER SEES THESE, which is what makes the deadlock structurally
 * impossible rather than merely tuned around. `Refinery` and `Harvester` are
 * the exit condition itself; `Builder`/`Mcv` and `Power` are its prerequisites;
 * `Barracks` and `WarFactory` are production CAPABILITY, which is the thing a
 * player also builds before they have income and which produces nothing on its
 * own — what comes OUT of them is army, and army is governed.
 *
 * Everything else is discretionary before the first ore lands: static defence,
 * anti-air, radar and the tech lab, storage, the whole late-game tier, and
 * every combat unit.
 */
export function isOpeningEconomyRole(role: BuildRole): boolean {
  switch (role) {
    case BuildRole.Builder:
    case BuildRole.Mcv:
    case BuildRole.Power:
    case BuildRole.Refinery:
    case BuildRole.Harvester:
    case BuildRole.Barracks:
    case BuildRole.WarFactory:
      return true;
    default:
      return false;
  }
}

/**
 * THE SECOND FRONT — a few hulls sent at the enemy economy while the wave goes
 * somewhere else.
 *
 * Reported as *"kinda boring"*, and the measurement behind that was blunt: the
 * military-goal histogram over a 24-minute match reads `436x attacking with N
 * at 314,226`. One objective, re-picked to the same coordinate for sixteen
 * straight minutes, no harassment and no second front. The brain was not doing
 * anything WRONG — it was doing one thing.
 *
 * BEING RAIDED IS THE MOST HUMAN THING AN OPPONENT DOES. A player who loses
 * three harvesters to four tanks that appeared behind their refinery has met
 * someone; a player whose base is attacked from the front for the ninth time
 * has met a script. That is the whole justification for this layer, and it is
 * why the target is the ECONOMY rather than whatever happens to be nearest.
 *
 * IT IS NOT A NEW STRATEGY LAYER. Everything it needs already existed: the
 * brain remembers enemy structures BY ROLE (`memRole`), `OrderKind.Attack`
 * arrived with focus fire, and the group tag that keeps a detachment out of
 * `regroupSquads` is on its FOURTH use after the scout, the amphibious squad
 * and the withdrawal. This block is the DECISION — whether to split, how many,
 * how often — and nothing else.
 *
 * THE LADDER IS `AI_DIFFICULTY[].aggression`. It is the one per-rung knob that
 * already means "how readily does this brain commit to an attack", and the only
 * one not yet spoken for — `discipline` now carries the group retreat, the
 * focus fire and the per-unit withdrawal, and loading a fourth behaviour onto
 * it would make those four impossible to tune apart. It gates the rung AND
 * scales the cadence, which is exactly the never / occasionally / routinely the
 * ladder wants:
 *
 *     Easy    0.4   below `minAggression` — never raids
 *     Normal  0.7   cooldown ~129 s
 *     Hard    1.0   ~90 s
 *     Brutal  1.3   ~69 s
 *
 * THAT COLUMN IS THE COOLDOWN, NOT THE PERIOD, and an earlier draft of this
 * block quoted it as though it were the period. A raid RUNS for up to
 * `maxTicks` (60 s) before the cooldown starts counting, and the cooldown runs
 * from the moment it ENDS, so the real cycle is 60 s + cooldown and the ceiling
 * over a twenty-minute match is roughly six to nine raids rather than the nine
 * to seventeen the cooldown alone suggests. On top of that the gates in
 * `considerRaid` are real: measured over 20 sim-minutes on seed 90210 the
 * counts were 0 / 2 / 4 / 2 by rung. Easy's zero is structural and the rest is
 * one seed — a raid needs a live reserve, and how often that exists is a fact
 * about how the match is going rather than about this table.
 *
 * PERSONALITY IS DELIBERATELY NOT IN IT. `pers.push` already decides how big a
 * wave has to be before it goes, so folding it in here too would make a Rusher
 * both raid more and attack sooner off one number, and the rung would stop
 * being the thing the player is actually setting.
 */
export const AI_RAID = {
  /** Aggression below which a rung never opens a second front. Easy is 0.4. */
  minAggression: 0.55,
  /**
   * Hulls in a raiding party.
   *
   * SMALL ON PURPOSE. A raid is meant to cost the enemy an economy, not to be a
   * second wave — and the party is taken out of the strike group, so every hull
   * here is one the main attack does not have. Three is enough to kill
   * harvesters and not enough to crack a defended base, which is the right
   * shape for the thing being built.
   */
  partySize: 3,
  /**
   * Base ticks between raids, DIVIDED by aggression. See the table above.
   *
   * Long, because a raid that re-forms the moment it dies is just a second wave
   * with extra steps, and because the party comes out of the strike group:
   * raiding too often is indistinguishable from attacking with a permanently
   * smaller army.
   */
  cooldownTicks: 2700,
  /**
   * Ticks a raid runs before it is called off and folded back into the army.
   *
   * A raid with no expiry is a detachment permanently deleted from the wave —
   * the same failure mode the withdrawal tag has, and the reason both have a
   * release path. Sixty seconds is long enough to cross a map and kill
   * something, and short enough that a party which achieved nothing comes home.
   */
  maxTicks: 1800,
} as const;

/**
 * PULLING A NEARLY-DEAD HULL OUT OF THE FIGHT.
 *
 * Reported as *"0 skills"*, and the honest version of that is narrower than it
 * sounds: the brain retreats ARMIES and has never retreated a UNIT. That gap is
 * visible from the other side of the screen — a player watches an AI tank sit
 * in the open at 8% health until it dies, and no human does that.
 *
 * ONE BEHAVIOUR, NOT A MICRO SUITE. There is no kiting, no focus-target
 * juggling and no per-unit repositioning; a hull that is nearly dead AND
 * currently being shot at walks to the rally point, and comes back when it is
 * healthy. Everything else — pathing, the group retreat in `shouldRetreat`, the
 * repair depot that happens to sit near the rally point and will mend whatever
 * parks beside it — already exists and does the rest. A pile of invisible
 * optimisations makes an AI harder without making it feel human, which is the
 * opposite of what was asked for.
 *
 * IT IS THE PLAYER'S OWN VERB. `OrderKind.Move` to the rally point, through
 * `channels.command`, costing an action out of the same APM budget. There is no
 * "flee" flag to set: `UnitState.Fleeing` is declared in `core/types.ts` and
 * ASSIGNED BY NOTHING IN THE ENTIRE CODEBASE — three call sites read it, none
 * writes it — so the harvester layer's own retreat is likewise a plain Move,
 * and this is the same mechanism pointed at a tank.
 *
 * THE LADDER IS `AI_SKILL[].discipline` again, for the same reason `AI_FOCUS`
 * uses it: its declared meaning is "how well it fights" and the group retreat
 * already rolls against it. Easy is 0.35 against `minDiscipline` 0.5 and is
 * excluded before the roll, so that rung does not even consume a draw.
 */
export const AI_RETREAT = {
  /** Health fraction below which a hull under fire is pulled out. */
  hpFraction: 0.3,
  /**
   * Health fraction at which it rejoins the army.
   *
   * WELL ABOVE `hpFraction`, and the gap is the whole point: equal thresholds
   * give a hull that oscillates between the rally point and the front every
   * time it takes a graze, which reads as a broken unit rather than a cautious
   * one and burns an action every pass.
   */
  rejoinHpFraction: 0.75,
  /**
   * Seconds since the last hit inside which a hull counts as "in the fight".
   *
   * Without it the brain walks every damaged hull home the moment it is
   * tagged — including ones that have been sitting at 20% since a raid two
   * minutes ago, which is a retreat from nothing. Same number and same reason
   * as `AI_ECONOMY.harvesterThreatSec`.
   */
  underFireSeconds: 3.0,
  /**
   * The same threshold for an AIRCRAFT, and it is nearly twice as high.
   *
   * MEASURED, NOT PICKED. An aircraft parked over a defended target is under
   * thirty percent health for **2.07 seconds** against eight G.I.s and 2.47
   * against eight conscripts before it dies. `withdrawWounded` polls every
   * 0.2 s, moves ONE hull per pass, and rolls against discipline each time —
   * so against a two-second window the ground threshold is a coin flip, and
   * the hull it is deciding about costs a thousand credits and has 190 hp.
   *
   * At 0.5 the decision happens while the hull can still cross the ground it
   * needs to. `rejoinHpFraction` 0.75 is unchanged and still well clear of it,
   * so this buys the earlier decision without reintroducing the oscillation
   * that gap exists to prevent.
   *
   * THIS IS A BRAIN RULE AND THAT IS WHY IT IS SAFE. It only lowers the AI's
   * willingness to leave a hull in a fight; it issues an ordinary
   * `OrderKind.Move`, writes nothing a human's units read, and cannot desync a
   * lockstep match. The player already has the same verb and it already works —
   * measured, a move order pulls a parked aircraft out on the first try and it
   * does not come back.
   */
  airHpFraction: 0.5,
  /** Discipline below which a rung never withdraws a unit. Easy stays out. */
  minDiscipline: 0.5,
  /**
   * Ceiling on how much of the strike group may be withdrawing at once.
   *
   * A rout is not micro. Without a cap, one bad engagement pulls every hull out
   * at the same moment and the wave evaporates instead of trading — which is
   * both worse play and, from the other side, far stranger to watch than the
   * AI simply losing the fight.
   *
   * **AIRCRAFT ARE EXEMPT FROM IT, AND FROM THE ONE-HULL-PER-PASS SLOT.** The
   * cap is about a WAVE's cohesion — a ground line that dissolves all at once
   * — and every army fields exactly one airframe, so an aircraft is never part
   * of that line. Leaving it in the shared slot is worse than pointless: with
   * one hull chosen per pass by worst health, an aircraft at forty-five percent
   * loses every pass to a tank at twenty-five, which is precisely the pass it
   * had two seconds to win.
   *
   * THAT EXEMPTION IS ENFORCED IN TWO PLACES AND THE SECOND IS EASY TO MISS.
   * Skipping the cap when the order is ISSUED is only half of it: `withdrawing`
   * is recounted from the tags on every later pass, so an airframe parked at
   * the rally went on spending one of the ground line's slots for as long as it
   * stayed there — one lost ground withdrawal at every strike-group size
   * measured. The release branch in `AiBrain.withdrawWounded` carries the
   * numbers. The DENOMINATOR still counts airframes, deliberately; see the note
   * beside `striking++` for why the symmetric-looking version is worse.
   */
  maxFraction: 0.34,
} as const;

/**
 * A small, deliberate engineer operation rather than another army-composition
 * weight. The AI buys one only after it has seen a legal prize, walks that one
 * engineer to it, and sends a compact escort through the ordinary command bus.
 */
export const AI_CAPTURE = {
  /** Easy remains readable and does not execute multi-unit capture tactics. */
  minDiscipline: 0.5,
  /** Fighting units required before 500 credits may leave the main force. */
  minEscort: 3,
  /** Maximum units peeled off to accompany the engineer. */
  escortSize: 4,
  /** Do not launch a side operation while the home base is under pressure. */
  maxPressure: 0.6,
  /** Five seconds between identical capture orders. */
  reissueTicks: 150,
  /** Below economy/first-producer interrupts, above discretionary filler. */
  buildScore: 0.85,
} as const;

export const AI_FOCUS = {
  /**
   * Metres around the strike group's centre searched for a target worth naming.
   *
   * DELIBERATELY SHORT. An explicit attack order drives the unit to its target
   * (`Targeting.approach`), so a generous radius would turn focus fire into a
   * chase and pull the wave off its objective. At 34 m the group is already in
   * contact and this only decides which of the things in front of it dies
   * first. It is the same number as `VFX_GLARE.wide` by coincidence of scale,
   * not by relation — roughly one screen at the default camera height.
   */
  radiusM: 34,
  /**
   * Discipline below which a rung never focuses. Easy is 0.35 and stays out.
   */
  minDiscipline: 0.5,
  /**
   * Ticks between re-picks. One second: long enough that the brain is not
   * re-issuing a group order every squad tick out of an APM budget it shares
   * with the build layer, short enough that a dead target is replaced before
   * the group has finished standing still over the corpse.
   */
  retargetTicks: 30,
  /**
   * Units allowed to share one named target on Normal.
   *
   * The rest of the strike group keeps its attack-move order and therefore
   * acquires independently. Hard and Brutal deliberately keep whole-group
   * focus; Normal gets useful concentration without frame-perfect army-wide
   * deletion micro.
   */
  normalFireteamSize: 5,
  /**
   * Class weights for "what is worth killing first".
   *
   * A harvester outranks a tank because killing it is worth a tank AND the
   * income behind it, and because a player who loses harvesters to a raid
   * notices; a defensive structure outranks a producer because it is the thing
   * currently shooting back. Everything else is the fallback.
   */
  weightHarvester: 1.7,
  weightDefence: 1.4,
  weightProducer: 1.2,
  weightUnit: 1.0,
  weightOther: 0.5,
  /**
   * How much a wounded target is preferred, as a multiplier at zero health.
   *
   * `1 + woundBonus * (1 - hpFraction)`, so a target at 20% scores 1.8x its
   * class weight at `woundBonus` 1. FINISHING THINGS OFF IS THE WHOLE POINT:
   * damage spread across two half-dead tanks kills neither, and this is the
   * term that turns a group order into concentration rather than a preference
   * for whatever is biggest.
   */
  woundBonus: 1.0,
} as const;

export const AI_SAVING = {
  /**
   * Fraction of a saving target's price the build layer protects from the army.
   *
   * `AiBrain.consider` promotes a candidate the bank cannot yet cover into a
   * saving target instead of dropping it, and `spendRemainder` takes this much
   * of its price off `spendable` before the leftover goes to `buildUnits`. The
   * number matters because the two failures either side of it are both real:
   *
   *   AT 0 the reserve does not exist and the highest-value purchase in the
   *   game loses every pass to the cheapest — 1400 for a harvester against 200
   *   for a rifleman, forever. That is the reported defect.
   *
   *   AT 1 the reserve is TOTAL whenever it fires, because a saving target is
   *   by definition one whose price exceeds `spendable`. A brain that stops
   *   producing army outright every time it wants a refinery loses the ramp,
   *   which is the failure the scripted opening's own comment is about.
   *
   * A fraction degrades correctly in both directions on its own: a brain a long
   * way short of the price holds everything it has (the leftover is negative
   * and `canQueue` refuses), and a brain nearly there keeps a trickle of army
   * going while it closes the gap. No clock, no timeout, no state.
   *
   * 0.75 is `AI_REBUILD.bankFraction`, deliberately — that constant answers the
   * identical question for the Construction Vehicle ("hold most of the price
   * back so the army does not eat it one rifleman at a time, and let the rest
   * buy defence"), and it is a SEPARATE constant here rather than an import
   * because the two are free to diverge: one protects the only route out of a
   * lost base, this one protects an ordinary purchase.
   */
  holdFraction: 0.75,
} as const;

export const AI_PRODUCERS = {
  /**
   * Producers of one kind past which another buys literally nothing.
   *
   * DERIVED, NOT AUTHORED. `factorySpeed(n) = min(CAP, 1 + BONUS * (n - 1))`,
   * so the multiplier saturates at `1 + ceil((CAP - 1) / BONUS)` — 4 at the
   * shipped 0.35 / 2.0. Writing the 4 down here instead would be a third
   * opinion that can disagree with the two constants that decide it.
   */
  maxUseful: 1 + Math.ceil((FACTORY_SPEED_CAP - 1) / FACTORY_SPEED_BONUS),
  /**
   * Cost multiple of `spendable` held before an EXTRA producer is bought.
   *
   * Higher than `AI_UPGRADE.bankMultiple`'s 1.6 for the reason that governs
   * this whole block: a second war factory is worth nothing on its own, it is
   * worth the units that go through it, so the bank has to still hold a
   * queue's worth of purchases after the building is paid for. Below this the
   * honest answer is that the money is already the constraint and another door
   * does not help.
   */
  bankMultiple: 2.5,
  /**
   * Score in `chooseBuild`.
   *
   * BELOW every first-of-kind producer (1.5 / 1.8), below the harvester (1.6 x
   * economy), below both refinery cases (1.4 x economy, 2.2 expanding) and
   * below an upgrade (1.45). Above the 0.35 banking floor and above a
   * quiet-base defence score. A second factory must never win a pass in which
   * the brain still lacks a producer, a refinery or a truck — that ordering is
   * the difference between spending a surplus and mortgaging an economy.
   */
  score: 0.9,
} as const;

/**
 * The producers whose count the bank may raise, and the tab each one speeds up.
 *
 * The pairing is DOCTRINE and lives here rather than on `CatalogEntry`, which
 * carries the tab a thing is BUILT FROM and has never carried the tab a
 * building SERVICES. Two rows, because a Barracks and a War Factory are the
 * only structures in the catalogue whose count is a build-speed multiplier the
 * AI has any reason to raise: a Refinery's count is already `maxRefineries`, a
 * Construction Yard's second copy is the MCV rebuild path, and everything else
 * publishes a tab it is the sole publisher of.
 */
export const EXTRA_PRODUCERS: readonly { readonly role: BuildRole; readonly tab: BuildTab }[] = [
  { role: BuildRole.Barracks, tab: BuildTab.Infantry },
  { role: BuildRole.WarFactory, tab: BuildTab.Vehicles },
];

/**
 * Which superweapon each army builds, and IN WHICH ORDER.
 *
 * This exists because `BuildCatalog.forRole` returns the FIRST entry with a
 * matching role, and for the Allies that is the Displacement Ring purely because of
 * where it sits in `FALLBACK_CATALOG`. A Displacement Ring is worth exactly as much
 * as the plan you have for nine teleported tanks; a Weather Control Device is
 * worth a base to anyone who can click. So the offensive weapon is named first
 * in every army that has one, which is the same judgement a human makes with
 * 2500 credits and one build slot.
 *
 * The Pact and the Reclamation field one each, so their order is trivial and
 * the list is still exhaustive rather than falling through to `forRole`.
 */
const SUPERWEAPON_PLAN: ReadonlyMap<number, readonly string[]> = new Map<number, readonly string[]>([
  [Faction.Soviets as number, ['nuclearSilo', 'ironCurtain']],
  [Faction.Allies as number, ['weatherControl', 'chronosphere']],
  [FACTION_MERIDIAN as number, ['mrdHeliograph']],
  [FACTION_RECLAIM as number, ['rclStormworks']],
]);

const EMPTY_KEYS: readonly string[] = [];

/** Superweapon structure keys this faction builds, best first. */
export function superweaponPlanFor(faction: Faction): readonly string[] {
  return SUPERWEAPON_PLAN.get(faction as number) ?? EMPTY_KEYS;
}

/**
 * What the AI insists on before it spends 2500 credits and 150 power on a
 * building that shoots nothing for the next seven minutes.
 *
 * THE POWER GATE IS THE LOAD-BEARING ONE. `SuperweaponService.rescanAvailability`
 * skips any structure that `NeedsPower` and is not `Powered`, so a silo built
 * into a brownout does not charge SLOWLY — it does not charge at all, and the
 * AI would have paid a war factory and a half for a dark building. -150 is more
 * than three Power Plants produce between them, so this has to be checked
 * against a projected surplus rather than the current one.
 */
export const AI_SUPERWEAPON = {
  /** Refineries required, so 2500 credits is not the whole economy. */
  minRefineries: 2,
  /** Power surplus required ON TOP of the structure's own draw. */
  powerHeadroom: 40,
  /**
   * Score in `chooseBuild`. Above ordinary army, below every producer the AI
   * does not own yet and below an expansion refinery — a superweapon is a
   * luxury bought out of a working economy, never instead of one. Multiplied by
   * `pers.tech`.
   */
  score: 1.6,
  /**
   * Ticks the fire layer waits after failing to find a target worth a strike.
   *
   * Without it a charged weapon re-runs its cluster scan every layer tick for
   * the rest of the match. Ten seconds is far shorter than any charge and far
   * longer than the scan is worth repeating.
   */
  retargetBackoffTicks: 300,
  /**
   * Metres from the AI's OWN base centre inside which no blast is allowed.
   *
   * A nuke and a lightning storm are `attacker: NONE` splash records — they hit
   * whatever is standing there, ours included. Every target below is derived
   * from remembered ENEMY structures or an observed threat, so this should
   * never bind; it binds the day an enemy builds inside the AI's base, which is
   * exactly the day nobody would be looking.
   */
  friendlyStandoff: 56,
  /** Hostiles inside the curtain radius before 20 s of invulnerability is worth it. */
  curtainMinEnemies: 4,
  /** Threat-grid weight a bucket needs before a lightning storm is aimed at it. */
  stormMinThreat: 3.0,
  /** Strikers required before a chronoshift into the objective is worth staging. */
  chronoMinStrike: 5,
  /** Metres the group must still have to walk for a chronoshift to save anything. */
  chronoMinTravel: 90,
  /** Ticks between the Displacement Ring's source command and its destination command. */
  chronoCommitTicks: 60,
  /**
   * Metres SHORT of the objective that a chronoshifted wave is set down.
   *
   * `applyChrono` spirals arrivals outward from the destination at 3.2 m a
   * slot, so a drop exactly on target puts the first rank inside whatever is
   * already standing there. Landing beside it instead lets nine hulls arrive as
   * a formation facing the right way, which is the difference between a
   * teleport that opens a fight and one that starts a shoving match.
   */
  chronoDropStandoff: 16,
} as const;

/**
 * WHICH POWERS THE AI BUYS, AND IN WHICH ORDER.
 *
 * Ordered by what the brain can actually USE, which is not the same as what a
 * human would rank them by. `AI.callPower` fires Emergency Repair and the
 * Airstrike off live measurements it takes every half second, and Ore Boost off
 * a bank test that is nearly always available late — so those three are the
 * ones that reliably turn credits into effect. Orbital Scan self-limits (it
 * fires once, while the AI does not know where the enemy lives) and Chronoshift
 * needs a five-hull reserve, an attacking posture and a quiet base at the same
 * moment, so both sit at the back where a brain that only affords two or three
 * never reaches them.
 *
 * ONE LIST FOR EVERY ARMY, unlike `UPGRADE_PLAN` and `SUPERWEAPON_PLAN`. Those
 * two are per-faction because the content is; a commander power is the same
 * five rows for everybody (see the `byFactionTab` note in `Production.ts`).
 */
const POWER_PLAN: readonly string[] = [
  'power.emergencyRepair',
  'power.airstrike',
  'power.oreBoost',
  'power.orbitalScan',
  'power.chronoshift',
];

/** The commander powers the AI buys, best first. */
export function powerPlanFor(): readonly string[] { return POWER_PLAN; }

/**
 * What the AI insists on before it buys a commander power.
 *
 * MODELLED ON `AI_UPGRADE`, because the purchase has the same shape: credits
 * out, no entity in, a bit set. The differences are the two numbers that are
 * not shared.
 */
export const AI_POWER_BUY = {
  /**
   * Refineries required before 800-2500 credits on a button is defensible.
   *
   * The same gate the superweapon uses, and for the same reason: a power bought
   * out of a one-refinery economy is a power bought instead of the second
   * refinery.
   */
  minRefineries: 2,
  /**
   * Score in `chooseBuild`.
   *
   * Below `AI_UPGRADE.score` (1.45) deliberately. An upgrade improves every
   * unit the AI will build for the rest of the match; a power is one button on
   * a two-to-four-minute clock. When the brain can afford exactly one of them,
   * the multiplier is the better buy and this number is what says so.
   * Multiplied by `pers.tech`, like the other two late-game layers.
   */
  score: 1.25,
  /**
   * Cost multiple of the bank held before buying. Higher than the upgrade's 1.6
   * because the powers cost up to 2500 and buy nothing that can defend the
   * base — an AI that emptied its account onto a Chronoshift it cannot use for
   * four minutes has handed the player the window.
   */
  bankMultiple: 1.8,
  /** Ticks before the AI re-asks for the same power. See `AI_UPGRADE.reaskTicks`. */
  reaskTicks: 1800,
} as const;

/**
 * When the AI calls each commander power.
 *
 * These are the cheapest of the three systems to use badly, because the only
 * thing they cost once bought is a clock — so every rule below is a MINIMUM
 * EFFECT test rather than a cost test. A power spent on two scouts is a power
 * not available for the push four minutes later, and that is the only currency
 * it has after the purchase.
 */
export const AI_POWER = {
  /** Hostiles under the marker before a bombing run is worth its charge. */
  airstrikeMinEnemies: 4,
  /** Damaged friendlies near the fighting before Emergency Repair is called. */
  repairMinDamaged: 4,
  /** Base pressure below which the AI is not in enough trouble to repair. */
  repairMinPressure: 0.6,
  /**
   * Fraction of the storage cap below which an Ore Boost is not wasted.
   *
   * 2500 credits paid into a bank already near `storageMax` is 2500 credits
   * poured on the floor — `Economy.grant` clamps at the cap. Half full is early
   * enough that the whole grant lands and late enough that the AI has somewhere
   * to spend it.
   */
  oreBoostFillFraction: 0.5,
  /** Units in the home reserve before a Chronoshift reinforcement is worth it. */
  chronoshiftMinReserve: 4,
  /** Base pressure above which the AI will not strip its home guard. */
  chronoshiftMaxPressure: 0.4,
} as const;

/**
 * Per-difficulty caps on all three late-game systems.
 *
 * `powers` is a BITMASK over `CommanderPowerId`, which is why the ids are
 * imported here — the alternative was five booleans per rung, and the whole
 * point of one table is that the ladder can be read down a column.
 *
 * THE LADDER, AND WHY IT IS SHAPED LIKE THIS:
 *
 *   Easy    Nothing. Every system here is a force multiplier and the bottom
 *           rung is where the ladder is supposed to be gentlest. An Easy brain
 *           also cannot afford any of it honestly — `creditFloor` is 1400 and
 *           `maxRefineries` is 2 — so letting it try would produce the worst
 *           outcome available: an AI that banks for a silo it never finishes
 *           and stops building an army in the meantime.
 *   Normal  ONE superweapon and ONE upgrade — the economy one, which is the
 *           purchase that pays for itself. Powers are the two that do not
 *           attack: Ore Boost and Emergency Repair. Normal is the reference
 *           rung and it should FEEL the late game without leading with it.
 *   Hard    The full upgrade set, and the two powers that project force. A
 *           Hard brain runs three refineries and nine trucks; it can pay.
 *   Brutal  Everything, and a second superweapon structure — which for the two
 *           original armies means the offensive weapon AND the support one.
 */
const AI_LATE_GAME = [
  { superweapons: 0, upgrades: 0, powers: 0 },
  {
    superweapons: 1,
    upgrades: 1,
    powers: (1 << CommanderPowerId.OreBoost) | (1 << CommanderPowerId.EmergencyRepair),
  },
  {
    superweapons: 1,
    upgrades: 3,
    powers: (1 << CommanderPowerId.OreBoost) | (1 << CommanderPowerId.EmergencyRepair)
      | (1 << CommanderPowerId.Airstrike) | (1 << CommanderPowerId.OrbitalScan),
  },
  {
    superweapons: 2,
    upgrades: 3,
    powers: (1 << CommanderPowerId.OreBoost) | (1 << CommanderPowerId.EmergencyRepair)
      | (1 << CommanderPowerId.Airstrike) | (1 << CommanderPowerId.OrbitalScan)
      | (1 << CommanderPowerId.Chronoshift),
  },
] as const;

/** The three per-faction key sets the personality edits below reach for. */
interface OpeningKeys {
  barracks: string;
  refinery: string;
  radar: string;
  techLab: string;
  warFactory: string;
  defence: string;
}

function openingKeys(faction: Faction): OpeningKeys {
  if ((faction as number) === (FACTION_MERIDIAN as number)) {
    return {
      barracks: 'mrdChapterhouse', refinery: 'mrdCistern', radar: 'mrdOculus',
      techLab: 'mrdReliquary', warFactory: 'mrdForgeyard', defence: 'mrdGlaive',
    };
  }
  if ((faction as number) === (FACTION_RECLAIM as number)) {
    return {
      barracks: 'rclRookery', refinery: 'rclSorter', radar: 'rclSpotter',
      techLab: 'rclCrucible', warFactory: 'rclBreakerYard', defence: 'rclSpitpost',
    };
  }
  return {
    barracks: 'barracks', refinery: 'refinery', radar: 'radar',
    techLab: 'battleLab', warFactory: 'warFactory',
    defence: faction === Faction.Soviets ? 'flameTower' : 'pillbox',
  };
}

function openingBase(faction: Faction): readonly OpeningStep[] {
  switch (faction as number) {
    case FACTION_MERIDIAN as number: return OPENING_MERIDIAN;
    case FACTION_RECLAIM as number: return OPENING_RECLAIM;
    case Faction.Soviets as number: return OPENING_SOVIETS;
    default: return OPENING_ALLIES;
  }
}

export function openingFor(faction: Faction, personality: number): readonly OpeningStep[] {
  const base = openingBase(faction);
  const out = base.slice();
  const k = openingKeys(faction);
  const name = AI_PERSONALITY[personality]?.name ?? 'Turtle';

  if (name === 'Rusher') {
    // Barracks first, and drop the greedy second refinery entirely.
    const barracks = out.findIndex((s) => s.key === k.barracks);
    if (barracks > 0) {
      const [b] = out.splice(barracks, 1);
      out.unshift(b);
    }
    const lastRefinery = out.map((s) => s.key).lastIndexOf(k.refinery);
    if (lastRefinery > 0) out.splice(lastRefinery, 1);
  } else if (name === 'Turtle') {
    // A defensive structure as soon as the barracks can support one.
    const factory = out.findIndex((s) => s.key === k.warFactory);
    out.splice(factory < 0 ? out.length : factory, 0, step(k.defence, true));
  } else if (name === 'Boomer') {
    // A third refinery before radar, and the tech lab in the script.
    const radar = out.findIndex((s) => s.key === k.radar);
    out.splice(radar < 0 ? out.length : radar, 0, step(k.refinery, true));
    out.push(step(k.techLab, true));
  }
  return out;
}

/* ==========================================================================
 * 4. DIFFICULTY AND PERSONALITY
 * ========================================================================== */

/** Everything difficulty changes, resolved once at brain construction. */
export interface DifficultyProfile {
  readonly index: number;
  readonly name: string;
  /** Ticks between observing something and being allowed to act on it. */
  readonly reactionTicks: number;
  /** Commands per tick this brain may issue, as a fractional budget. */
  readonly actionsPerTick: number;
  /** Multiplier on the strike-group size threshold. */
  readonly waveSizeMul: number;
  /** 0..1.3 — how readily it commits to an attack. */
  readonly aggression: number;
  /**
   * Published for the ECONOMY module to honour, never applied here. The brain
   * has no write access to credits and must not: see the write-ownership table
   * in core/loop.ts.
   */
  readonly resourceBonus: number;
  /** 0..1 — how well the army composition answers the observed threat. */
  readonly composition: number;
  /** Credits deliberately left unspent. The beginner's handicap. */
  readonly creditFloor: number;
  /** Multiplier on how attractive teching up looks. */
  readonly techBias: number;
  /** Multiplier on the scouting delay. */
  readonly scoutDelayMul: number;
  /** 0..1 — how reliably it actually retreats when it should. */
  readonly discipline: number;
  /** Cap on static defence structures. */
  readonly maxDefense: number;
  /**
   * Cap on ANTI-AIR structures specifically, counted separately from
   * `maxDefense` because the anti-air branch is an interrupt that pre-empts
   * almost everything else. Without its own ceiling an Easy brain answers its
   * first sighted gunship with four towers before it answers anything.
   */
  readonly maxAntiAir: number;
  /**
   * Ticks between FIRST seeing an aircraft and being willing to answer it.
   * `reactionTicks` is the base-attack latency and is not reused here: a raid
   * arriving overhead and an aircraft crossing the map are different events
   * with different tells, and folding them together made Easy answer air
   * faster than it answers a tank sitting in its refinery.
   */
  readonly airReactionTicks: number;
  /**
   * Harvesters this brain will field, regardless of refinery count. The size of
   * the economy IS the difficulty: everything downstream of income — units,
   * structures, defence — is paced by it, because `BuildQueue` advances only
   * the slice of a build it managed to pay for on that tick.
   */
  readonly maxHarvesters: number;
  /** Refineries it will build before it stops growing its economy. */
  readonly maxRefineries: number;
  /**
   * Structures this brain will have drip-repairing AT ONCE.
   *
   * A cap on concurrency, not on the verb: every rung mends, because a base
   * that never heals is not a gentle opponent, it is a broken one. What the
   * ladder buys is how much of a raid gets undone at the same time — Easy
   * patches one building while the next two burn, Brutal answers the whole
   * salvo. It is also a spending cap by proxy: `REPAIR_COST_PER_HP` is charged
   * per structure per tick, so eight concurrent repairs is eight times the
   * drain on the same account the army is bought from.
   */
  readonly maxRepairs: number;
  /** Items it keeps queued per unit tab. 1 leaves an audible gap between units. */
  readonly queueDepth: number;
  /**
   * Superweapon STRUCTURES this brain will own. 0 means it never builds one and
   * — because the fire layer is gated on the same number — never fires one it
   * was handed either.
   */
  readonly maxSuperweapons: number;
  /** In-match upgrades it will buy, taken from the front of `upgradePlanFor`. */
  readonly maxUpgrades: number;
  /**
   * Bitmask over `CommanderPowerId` of the powers this brain will call.
   *
   * A MASK RATHER THAN A COUNT, because which powers a rung gets is the point:
   * Normal is allowed the two that do not attack and Hard is allowed the two
   * that do, and a count could not express that. 0 is a brain that never calls
   * one.
   *
   * Named `powerMask` and not, say, `powerSightMask`: `tests/ai.spec.ts` asserts
   * that no `DifficultyProfile` key matches /vision|sight|reveal|fog/, because a
   * difficulty knob with one of those words in it would be the ladder buying
   * information rather than skill. Nothing here does.
   */
  readonly powerMask: number;
}

/** Clamp an arbitrary difficulty index into the table. */
export function difficultyProfile(index: number): DifficultyProfile {
  const i = index < 0 ? 0 : index >= AI_DIFFICULTY.length ? AI_DIFFICULTY.length - 1 : index | 0;
  const d = AI_DIFFICULTY[i];
  const s = AI_SKILL[i];
  // Indexed by the SAME clamped `i`, so the late-game ladder can never point at
  // a different rung from the one the rest of the profile came from.
  const late = AI_LATE_GAME[i];
  return {
    index: i,
    name: d.name,
    reactionTicks: Math.max(1, Math.round(d.reactionSec * SIM_HZ)),
    // apmCap is actions per MINUTE; the sim runs at SIM_HZ ticks per second.
    actionsPerTick: d.apmCap / (60 * SIM_HZ),
    waveSizeMul: d.waveSizeMul,
    aggression: d.aggression,
    resourceBonus: d.resourceBonus,
    composition: s.composition,
    creditFloor: s.creditFloor,
    techBias: s.techBias,
    scoutDelayMul: s.scoutDelayMul,
    discipline: s.discipline,
    maxDefense: s.maxDefense,
    maxAntiAir: s.maxAntiAir,
    // Rounded, never floored to zero on a rung that asked for a delay: Brutal
    // asks for 0 and gets 0, everyone else gets at least one tick.
    airReactionTicks: s.airReactionSec <= 0 ? 0 : Math.max(1, Math.round(s.airReactionSec * SIM_HZ)),
    maxHarvesters: s.maxHarvesters,
    maxRefineries: s.maxRefineries,
    maxRepairs: s.maxRepairs,
    queueDepth: s.queueDepth,
    maxSuperweapons: late.superweapons,
    maxUpgrades: late.upgrades,
    powerMask: late.powers,
  };
}

export interface PersonalityProfile {
  readonly index: number;
  readonly name: string;
  readonly economy: number;
  readonly army: number;
  readonly tech: number;
  readonly defense: number;
  readonly push: number;
}

export function personalityProfile(index: number): PersonalityProfile {
  const i = index < 0 ? 0 : index >= AI_PERSONALITY.length ? AI_PERSONALITY.length - 1 : index | 0;
  const p = AI_PERSONALITY[i];
  return { index: i, name: p.name, economy: p.economy, army: p.army, tech: p.tech, defense: p.defense, push: p.push };
}

/** Parse a `?ai=` flag into a difficulty index. -1 when unrecognised. */
export function difficultyByName(name: string): number {
  const n = name.trim().toLowerCase();
  for (let i = 0; i < AI_DIFFICULTY.length; i++) {
    if (AI_DIFFICULTY[i].name.toLowerCase() === n) return i;
  }
  const num = Number(n);
  return Number.isInteger(num) && num >= 0 && num < AI_DIFFICULTY.length ? num : -1;
}

/** Parse a `?aip=` flag into a personality index. -1 when unrecognised. */
export function personalityByName(name: string): number {
  const n = name.trim().toLowerCase();
  for (let i = 0; i < AI_PERSONALITY.length; i++) {
    if (AI_PERSONALITY[i].name.toLowerCase() === n) return i;
  }
  const num = Number(n);
  return Number.isInteger(num) && num >= 0 && num < AI_PERSONALITY.length ? num : -1;
}

/* ==========================================================================
 * 5. THREAT CLASSIFICATION
 * ========================================================================== */

/**
 * Which ThreatClass an observed entity belongs to.
 *
 * `airborne` is decided by the caller from altitude, because the contract layer
 * has no air kind (see AI_BUILD.airAltitudeMetres). Everything else falls out
 * of kind + armour, both of which are plain columns in the entity store, so
 * this needs no def table.
 */
export function classifyThreat(
  kind: EntityKind,
  armor: ArmorClass,
  airborne: boolean,
): ThreatClass {
  if (airborne) return ThreatClass.Air;
  if (kind === EntityKind.Building) return ThreatClass.Structure;
  if (kind === EntityKind.Infantry) return ThreatClass.Infantry;
  // ArmorClass: 0 Infantry, 1 Light, 2 Medium, 3 Heavy, 4 Concrete, 5 Wood.
  if ((armor as number) >= 2) return ThreatClass.Heavy;
  return ThreatClass.Light;
}

/* ==========================================================================
 * 6. THE COMPOSITION SCORER
 * ========================================================================== */

/**
 * Score one candidate against an observed threat mix.
 *
 * `threat` is a normalised histogram over ThreatClass (it should sum to ~1, but
 * a zero vector is handled: the result collapses to the authored weight, which
 * is the right answer when the AI has seen nothing yet).
 *
 * `composition` is the difficulty dial. At 0 the answer vector is ignored
 * entirely and the AI just rolls its default army; at 1 the score is fully the
 * dot product of "what this unit answers" with "what I have seen".
 */
export function scoreComposition(
  entry: CatalogEntry,
  threat: Float32Array,
  composition: number,
): number {
  if (entry.weight <= 0) return 0;
  let counter = 0;
  let total = 0;
  for (let c = 0; c < AI_THREAT_CLASS_COUNT; c++) {
    counter += entry.answers[c] * threat[c];
    total += threat[c];
  }
  // No observations yet -> every candidate scores its authored weight.
  const informed = total > 1e-4 ? counter / total : 1;
  const blended = composition * informed + (1 - composition) * 1;
  return entry.weight * Math.max(0.05, blended);
}

/**
 * Roulette-select the next unit to queue.
 *
 * Roulette rather than argmax on purpose: an AI that always builds its single
 * best-scoring unit fields nine identical tanks, which both looks wrong and is
 * trivially countered. Weighted-random over the scored roster reproduces the
 * mixed armies a competent player actually fields, and it means the SAME scorer
 * produces variety at high difficulty and noise at low difficulty.
 *
 * `available` is the caller's affordability/prereq gate; entries that fail it
 * are excluded before the roll, so the roll never has to be retried.
 *
 * Zero allocation: `scratch` is a caller-owned scratch buffer at least as long
 * as `candidates`.
 */
export function pickUnit(
  candidates: readonly CatalogEntry[],
  threat: Float32Array,
  composition: number,
  rng: { next(): number },
  scratch: Float32Array,
): CatalogEntry | null {
  const n = Math.min(candidates.length, scratch.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = scoreComposition(candidates[i], threat, composition);
    scratch[i] = s;
    sum += s;
  }
  if (sum <= 0) return null;
  let roll = rng.next() * sum;
  for (let i = 0; i < n; i++) {
    roll -= scratch[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[n - 1] ?? null;
}

/* ==========================================================================
 * 7. PREREQUISITE MATCHING
 * ========================================================================== */

/** Normalise a content key so 'War Factory', 'war_factory' and 'warFactory' match. */
export function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when every prerequisite of `entry` is satisfied.
 *
 * `haveRole` answers "do I own a completed structure that plays this role"; the
 * AI reasons in roles, not keys, because it identifies its own buildings from
 * `EntityFlag` bits rather than from def ids (which are -1 until the data
 * module lands). A prereq key it does not recognise is treated as SATISFIED
 * rather than blocking — a data module that adds 'sovietTechCentre' to a prereq
 * list must not silently freeze the whole build layer.
 */
export function prereqsMet(
  entry: CatalogEntry,
  haveRole: (role: BuildRole) => boolean,
): boolean {
  for (let i = 0; i < entry.prereqs.length; i++) {
    const role = roleForPrereq(entry.prereqs[i]);
    if (role < 0) continue;
    if (!haveRole(role as BuildRole)) return false;
  }
  return true;
}

/**
 * Prereq key -> role, over both the authored keys and a set of normalised
 * spellings a data module is likely to use. Returns -1 for anything
 * unrecognised, which `prereqsMet` treats as satisfied.
 */
const NORM_ROLE = new Map<string, BuildRole>();
for (const key of Object.keys(ROLE_BY_KEY)) NORM_ROLE.set(normKey(key), ROLE_BY_KEY[key]);
NORM_ROLE.set('power', BuildRole.Power);
NORM_ROLE.set('reactor', BuildRole.Power);
NORM_ROLE.set('teslareactor', BuildRole.Power);
NORM_ROLE.set('factory', BuildRole.WarFactory);
NORM_ROLE.set('weaponsfactory', BuildRole.WarFactory);
NORM_ROLE.set('vehiclefactory', BuildRole.WarFactory);
NORM_ROLE.set('techcenter', BuildRole.TechLab);
NORM_ROLE.set('lab', BuildRole.TechLab);
NORM_ROLE.set('researchlab', BuildRole.TechLab);
NORM_ROLE.set('radardome', BuildRole.Radar);
NORM_ROLE.set('airfield', BuildRole.Radar);
NORM_ROLE.set('constructionyard', BuildRole.Builder);
NORM_ROLE.set('commandcenter', BuildRole.Builder);
NORM_ROLE.set('orerefinery', BuildRole.Refinery);
NORM_ROLE.set('processor', BuildRole.Refinery);
NORM_ROLE.set('bootcamp', BuildRole.Barracks);
NORM_ROLE.set('infantrybarracks', BuildRole.Barracks);

/** -1 when the key names nothing this AI models. */
export function roleForPrereq(key: string): number {
  const hit = NORM_ROLE.get(normKey(key));
  return hit === undefined ? -1 : hit;
}
