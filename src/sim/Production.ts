/**
 * ============================================================================
 * VOLTMARCH — src/sim/Production.ts
 * ============================================================================
 * THE BUILD LOOP: TECH TREE, ROSTERS, CONSTRUCTION AND EGRESS.
 *
 * This is the loop the player actually lives in. Click a cameo, watch a clock
 * wipe, plant a structure, watch it rise, watch the cameos it unlocked appear.
 * Everything in this file exists to make that circuit tight and legible.
 *
 * WHAT IS AUTHORED HERE AND WHAT IS BORROWED
 * ------------------------------------------
 * The PRODUCTION LAYER is authored here and nowhere else: which faction can
 * build what, in which tab, for how much, in how long, gated behind which
 * structures, and which structure services which queue. That is a tech tree,
 * and a tech tree is a design document, not a data-table detail.
 *
 * The ENTITY LAYER — hit points, speed, armour, footprint, power draw — is
 * borrowed. When `src/data/**` publishes a real `DefTables` we read cost,
 * build time, footprint and power out of it; until then we fall back to
 * `FALLBACK_UNITS` / `FALLBACK_BUILDINGS` in game/Scenarios.ts so that a
 * Grizzly rolling off my War Factory is byte-for-byte the same entity as a
 * Grizzly the scenario parked on the map. Two spawn paths that disagree about
 * what a Grizzly is would be a bug nobody finds for a week.
 *
 * THE `defId` CONVENTION — READ THIS BEFORE CALLING ANYTHING
 * ---------------------------------------------------------
 * Every `defId` on MY api and in MY events is a CATALOG INDEX (`BuildEntry.index`),
 * not an index into `DefTables.units`/`.buildings`. It has to be: the catalog
 * exists at boot and is stable whether or not a def table was ever found,
 * whereas a real def index is -1 for everything until the data module lands.
 * The real one is still there when you need it (`entry.defId`), and
 * `catalog.fromDefId()` maps back. The entity store keeps storing the real one,
 * because that is what `EntityStore.defId` is documented to hold.
 *
 * WRITE OWNERSHIP (see the table in core/loop.ts)
 * ----------------------------------------------
 * This module owns `buildProgress`, `flags:UnderConstruction`, `footprintW/H`
 * and the spawn-time initialisation of every column of a unit it produces. It
 * writes `credits` (as the buyer; economy writes it as the earner) and
 * `techMask`. It writes `orderKind/orderX/orderZ/state` exactly once per unit,
 * at spawn, to point a fresh vehicle at its rally flag — the same spawn-time
 * initialisation `ScenarioBuilder.spawnUnit` performs, and never again after.
 * ============================================================================
 */

import {
  BUILD_RADIUS, CELL, CONSTRUCTION_RISE_SECONDS, MAP_CELLS, MAX_PLAYERS,
  PLACEMENT, PRODUCTION, SELL_REFUND,
} from '../core/config';
import {
  BUILD_TAB_COUNT, BuildTab, CommandKind, CreditReason, EntityFlag, EntityKind, EvaLine,
  Faction, FxKind, Locomotor, MatchPhase, NONE, OrderKind, Stance, UnitState,
} from '../core/types';
import type {
  AvailabilityResult, BuildingDef, Command, DefTables, EntityId, HudCameo, HudSnapshot,
  PlayerId, PlayerState, ProductionItem, SimContext, UnitDef,
} from '../core/types';
import { PerEntityI16, type World } from '../core/world';
import type { Channels } from '../core/events';
import { clampWorld, footprintOriginCell, isInMap, worldToCell } from '../core/math';

import {
  FALLBACK_BUILDINGS, FALLBACK_UNITS, activeScenario, entityKeyOf, resolveDefBinding,
  type DefBinding, type FallbackBuilding, type FallbackUnit,
} from '../game/Scenarios';

// The ONE edge from src/sim/** into src/progression/**, and it is deliberately
// the narrowest one available: `UnlockGate.ts` imports nothing but its own
// type-only module, so this pulls in no store, no localStorage and no mission
// table. Both functions answer "yes" when no gate is installed, which is what
// keeps the sim running with the whole progression layer absent — the state the
// `?shot=` harness and every node test are in.
import { isBuildable, LOCKED_REASON } from '../progression/UnlockGate';

import { BuildQueues, HoldReason, type QueueHooks, type QueueItemInfo } from './BuildQueue';
import {
  PlacementPhase, evaluatePlacement, facedFootprintH, facedFootprintW, facingYaw,
  normaliseFacing, placementReport, yawToFacing,
  type PlacementListener, type PlacementNotice,
  snapRallyClear,
} from './Placement';
// The last-way-out guard, shared verbatim with the outcome poll so a sell that
// is refused and a match that will not end cannot disagree about what "this
// player can still play" means. The edge Viability -> Deploy -> Production
// closes a cycle back to this file; every binding in it is read inside a
// function body, never at module scope, which is the only kind of ESM cycle
// that is safe — and `npm test` / `npm run build` both exercise it.
import {
  canRebuild, makeViabilitySurvey, surveyViability,
  type ViabilityProbes, type ViabilitySurvey,
} from './Viability';

// The placement vocabulary lives in Placement.ts so the runtime import edge
// only ever points Production -> Placement. Re-exported here because callers
// think of it as part of the production api.
export { PlacementPhase };
export type { PlacementListener, PlacementNotice };

/* ==========================================================================
 * 1. THE CATALOG — the authored tech tree
 * ========================================================================== */

export const enum BuildKind {
  Building = 0,
  Unit = 1,
}

/**
 * Added to a unit's real def index to make `BuildEntry.publicId` unique across
 * both def tables. Far above any plausible roster size and far below the point
 * where a double stops being an exact integer; nothing stores a publicId in a
 * typed array (`Command.defId` is a plain object field).
 */
export const UNIT_PUBLIC_ID_BASE = 4096;

/** One buildable, fully resolved. `index` is the id every api here speaks in. */
export interface BuildEntry {
  /** Stable catalog index. Also the bit this entry occupies in `techMask`. */
  readonly index: number;
  /**
   * THE ID EVERY OTHER MODULE SPEAKS IN.
   *
   * The real `DefTables` index when a data module published one, and the
   * catalog index when it did not. That choice is not arbitrary: the HUD
   * (src/ui/Hud.ts) and the AI (src/sim/AIStrategy.ts) both carry their own
   * catalogues keyed on real def indices, and `ProductionItem.defId` is
   * documented as "index into units[]/buildings[]". So when content exists we
   * speak content; when it does not, the catalog index is the only id in the
   * building, and it is unambiguous precisely because no real ones exist.
   *
   * UNITS ARE OFFSET BY `UNIT_PUBLIC_ID_BASE`. `DefTables` has two independent
   * index spaces — `units[7]` is the Rhino, `buildings[7]` is the Naval Yard —
   * so a bare def index is only meaningful next to an `isBuilding` flag, and
   * `availability(player, defId)` does not take one. Before this offset,
   * `resolve()` guessed buildings first and a Soviet AI asking "can I build a
   * Rhino?" was answered about an ALLIED Naval Yard: "Wrong faction", forever.
   * (That is a real bug this repo shipped the moment src/data/Defs.ts landed,
   * caught by tests/ai.spec.ts.) `resolve()` strips the offset, and still
   * accepts a bare def index when the caller supplies `isBuilding` — which is
   * what every command path does, since the tab already says which space it
   * meant.
   */
  readonly publicId: number;
  /** Content key, shared with game/Scenarios.ts ('warFactory', 'grizzly'). */
  readonly key: string;
  readonly name: string;
  readonly blurb: string;
  readonly kind: BuildKind;
  /** Neutral means BOTH armies field it. */
  readonly faction: Faction;
  readonly tab: BuildTab;
  readonly cost: number;
  /** Seconds at full power with exactly one factory. */
  readonly buildTime: number;
  /** Content keys of structures that must be built and powered first. */
  readonly prereqs: readonly string[];
  readonly sortOrder: number;
  /** False for things that exist only as prereqs / MCV deploy targets. */
  readonly buildable: boolean;
  /**
   * Progression gate id, or '' for "available from the first match".
   *
   * Copied off the def, never authored in `CONTENT`: the tech tree below is
   * the same in every save, and what changes per profile is which of its rows
   * the player has earned. Empty string rather than `undefined` so every entry
   * has the identical shape — `UnlockGate` treats '' and absent alike.
   */
  readonly unlockedBy: string;
  /** Index into DefTables.units / .buildings, or -1 when no def table exists. */
  readonly defId: number;

  /* -- buildings ------------------------------------------------------- */
  readonly footprintW: number;
  readonly footprintH: number;
  /** Metres. The ghost volume's height. */
  readonly height: number;
  /** Positive generates power. */
  readonly power: number;
  readonly storage: number;
  /** Metres within which THIS structure permits new construction. */
  readonly buildRadius: number;
  /** Which queues this structure services. Empty for non-factories. */
  readonly producesTabs: readonly BuildTab[];
  /** Local-space exit, metres, +Z forward. */
  readonly exitX: number;
  readonly exitZ: number;
  /**
   * Content key of a unit this structure HANDS YOU, free, the moment it
   * finishes. '' for almost everything.
   *
   * This exists for exactly one thing: the refinery's harvester. Three
   * factions' refinery blurbs have said "Ships with one" since the content
   * layer was written and nothing implemented it, which did not matter while
   * every match opened with a pre-built base whose harvesters the scenario
   * placed by hand. From an MCV it is the whole economy: the first harvester
   * is gated behind a war factory AND 1000-1400 credits, so a player (or an
   * AI) who spends the opening bank getting there earns nothing in the
   * meantime and can deadlock permanently one credit short. Measured: three of
   * the four factions' AIs flatlined at 0-1600 credits with a refinery
   * standing and no harvester, forever.
   *
   * Free means free — no charge, no queue slot, no build time. It is part of
   * what the refinery costs, exactly as in every C&C.
   */
  readonly shipsWith: string;

  /* -- units ------------------------------------------------------------ */
  readonly entityKind: EntityKind;
  /**
   * Cap on how many of this entry one player may have at once. 0 = unlimited,
   * which is every entry except the four commanders.
   *
   * Copied off `UnitDef.maxAlive`, never authored in `CONTENT`, for the same
   * reason `unlockedBy` is: the def table is the authority on content and the
   * catalog is a view of it. On a fallback boot (no data module) it lands at 0
   * and the cap is simply off — a headless test that spawns three commanders is
   * doing something the sidebar cannot, and there is nothing to protect there.
   */
  readonly maxAlive: number;
}

/** The authored half. Everything else is derived from the fallback tables. */
interface ContentSpec {
  key: string;
  name: string;
  blurb: string;
  kind: BuildKind;
  faction: Faction;
  tab: BuildTab;
  cost: number;
  buildTime: number;
  prereqs: readonly string[];
  sortOrder: number;
  buildable?: boolean;
  producesTabs?: readonly BuildTab[];
  buildRadius?: number;
  /** See `BuildEntry.shipsWith`. Authored on the three refineries only. */
  shipsWith?: string;
}

const S = BuildTab.Structures;
const D = BuildTab.Defense;
const I = BuildTab.Infantry;
const V = BuildTab.Vehicles;

/**
 * THE TECH TREE.
 *
 * Costs and times are the RA2 curve, which is the one this game's economy
 * constants (START_CREDITS 10000, HARVESTER_CAPACITY 700) were tuned against:
 * a Power Plant inside 10 seconds, a Refinery paying for itself in about three
 * loads, and an Apocalypse costing roughly two and a half Rhinos.
 *
 * Prerequisites are deliberately SHALLOW — three tiers, never four. RA2's real
 * tree is: power, then economy, then army, then one tech building that opens
 * the top of every tab at once. A deeper tree reads as homework.
 */
const CONTENT: readonly ContentSpec[] = [
  /* -- tier 0: the thing you start with ---------------------------------- */
  {
    key: 'conyard', name: 'Construction Yard', blurb: 'Deploys your base. Builds structures.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 3000, buildTime: 40, prereqs: [], sortOrder: 0, buildable: false,
    producesTabs: [S, D], buildRadius: BUILD_RADIUS,
  },

  /* -- tier 1: power and economy ----------------------------------------- */
  {
    key: 'powerPlant', name: 'Power Plant', blurb: 'Generates 100 power. Everything else needs it.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 300, buildTime: 8, prereqs: ['conyard'], sortOrder: 10,
  },
  {
    key: 'refinery', name: 'Ore Refinery', blurb: 'Unloads harvesters. Ships with one.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['powerPlant'], sortOrder: 20,
    shipsWith: 'harvester',
  },
  {
    key: 'barracks', name: 'Barracks', blurb: 'Trains infantry.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 500, buildTime: 10, prereqs: ['powerPlant'], sortOrder: 30,
    producesTabs: [I],
  },

  /* -- tier 2: army and sight -------------------------------------------- */
  {
    key: 'warFactory', name: 'War Factory', blurb: 'Builds vehicles. Sets a rally point.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['refinery'], sortOrder: 40,
    producesTabs: [V],
  },
  {
    key: 'radar', name: 'Radar Dome', blurb: 'Reveals the minimap. Opens tier two.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 1000, buildTime: 14, prereqs: ['refinery'], sortOrder: 50,
  },
  {
    key: 'oreSilo', name: 'Ore Silo', blurb: 'Stores 1500 credits of ore.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 150, buildTime: 5, prereqs: ['refinery'], sortOrder: 60,
  },
  {
    key: 'navalYard', name: 'Naval Yard', blurb: 'Builds Allied warships.',
    kind: BuildKind.Building, faction: Faction.Allies, tab: S,
    cost: 1000, buildTime: 14, prereqs: ['refinery'], sortOrder: 70,
    producesTabs: [V],
  },
  {
    key: 'subPen', name: 'Naval Pen', blurb: 'Builds Soviet warships.',
    kind: BuildKind.Building, faction: Faction.Soviets, tab: S,
    cost: 1000, buildTime: 14, prereqs: ['refinery'], sortOrder: 70,
    producesTabs: [V],
  },

  /* -- tier 3: the one tech building ------------------------------------- */
  {
    key: 'battleLab', name: 'Battle Lab', blurb: 'Unlocks the top of every tab.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['radar'], sortOrder: 80,
  },

  /* -- defences ----------------------------------------------------------- */
  {
    key: 'wall', name: 'Concrete Wall', blurb: 'Stops vehicles. Stops nothing else.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: D,
    cost: 100, buildTime: 2, prereqs: ['barracks'], sortOrder: 10,
  },
  {
    key: 'pillbox', name: 'Pillbox', blurb: 'Cheap anti-infantry emplacement.',
    kind: BuildKind.Building, faction: Faction.Allies, tab: D,
    cost: 400, buildTime: 8, prereqs: ['barracks'], sortOrder: 20,
  },
  {
    key: 'flameTower', name: 'Flame Tower', blurb: 'Short-ranged, brutal on infantry.',
    kind: BuildKind.Building, faction: Faction.Soviets, tab: D,
    cost: 600, buildTime: 10, prereqs: ['barracks'], sortOrder: 20,
  },
  {
    key: 'prismTower', name: 'Prism Tower', blurb: 'Long-ranged beam defence. Needs power.',
    kind: BuildKind.Building, faction: Faction.Allies, tab: D,
    cost: 1500, buildTime: 16, prereqs: ['battleLab'], sortOrder: 30,
  },
  {
    key: 'teslaCoil', name: 'Tesla Coil', blurb: 'Melts armour. Dies in a brownout.',
    kind: BuildKind.Building, faction: Faction.Soviets, tab: D,
    cost: 1500, buildTime: 16, prereqs: ['radar'], sortOrder: 30,
  },
  {
    key: 'aaTurret', name: 'Multigunner AA', blurb: 'Flak battery. Reaches what tanks cannot.',
    kind: BuildKind.Building, faction: Faction.Allies, tab: D,
    cost: 800, buildTime: 12, prereqs: ['radar'], sortOrder: 25,
  },
  {
    key: 'sentryGun', name: 'Sentry Gun', blurb: 'Cheap anti-infantry emplacement.',
    kind: BuildKind.Building, faction: Faction.Soviets, tab: D,
    cost: 400, buildTime: 8, prereqs: ['barracks'], sortOrder: 25,
  },

  /* -- infantry ----------------------------------------------------------- */
  {
    key: 'gi', name: 'G.I.', blurb: 'Rifleman. The Allied line.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: I,
    cost: 200, buildTime: 5, prereqs: ['barracks'], sortOrder: 10,
  },
  {
    key: 'conscript', name: 'Conscript', blurb: 'Cheap, expendable, everywhere.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: I,
    cost: 100, buildTime: 4, prereqs: ['barracks'], sortOrder: 10,
  },
  {
    key: 'attackDog', name: 'Attack Dog', blurb: 'Fast scout. Shreds infantry.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: I,
    cost: 300, buildTime: 6, prereqs: ['barracks'], sortOrder: 20,
  },
  /* -- the anti-armour pair -------------------------------------------------
   * THIS TABLE IS THE ONE THAT DECIDES WHETHER A UNIT CAN BE ORDERED. A def row
   * in `src/data/Defs.ts` names a unit and a fallback row in `Scenarios.ts` lets
   * it spawn, but `ProductionCatalog` is keyed on CONTENT and the def binding
   * only supplies ids for keys that already appear here. A key missing from this
   * list is `catalog.byKey(...) === null`, which makes `BuildCatalog.bindOracle`
   * skip it, which leaves the AI's entry at `defId -1` — and the brain then
   * reports "no production catalog" and stops, with a def table sitting right
   * there fully bound. That is exactly how these two rows were first found.
   * ---------------------------------------------------------------------- */
  {
    key: 'javelin', name: 'Javelin', blurb: 'Shoulder launcher. Kills armour and aircraft.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: I,
    cost: 500, buildTime: 7, prereqs: ['barracks', 'radar'], sortOrder: 20,
  },
  {
    key: 'flakTrooper', name: 'Flak Trooper', blurb: 'Drum-fed autocannon. Hates anything light.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: I,
    cost: 300, buildTime: 6, prereqs: ['barracks', 'radar'], sortOrder: 25,
  },
  {
    key: 'engineer', name: 'Engineer', blurb: 'Captures structures. Repairs them.',
    kind: BuildKind.Unit, faction: Faction.Neutral, tab: I,
    cost: 500, buildTime: 10, prereqs: ['barracks', 'refinery'], sortOrder: 30,
  },

  /* -- vehicles ------------------------------------------------------------ */
  {
    key: 'harvester', name: 'Ore Harvester', blurb: 'Mines ore. Your entire economy.',
    kind: BuildKind.Unit, faction: Faction.Neutral, tab: V,
    cost: 1400, buildTime: 16, prereqs: ['warFactory', 'refinery'], sortOrder: 10,
  },
  {
    key: 'grizzly', name: 'Grizzly Tank', blurb: 'The Allied main battle tank.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: V,
    cost: 700, buildTime: 11, prereqs: ['warFactory'], sortOrder: 20,
  },
  {
    key: 'rhino', name: 'Rhino Tank', blurb: 'Slower, heavier, hits harder.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: V,
    cost: 900, buildTime: 13, prereqs: ['warFactory'], sortOrder: 20,
  },
  {
    key: 'ifv', name: 'Multigunner IFV', blurb: 'Fast wheeled gun platform.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: V,
    cost: 600, buildTime: 10, prereqs: ['warFactory', 'radar'], sortOrder: 30,
  },
  {
    key: 'prismTank', name: 'Prism Tank', blurb: 'Beam artillery. Fragile.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: V,
    cost: 1200, buildTime: 17, prereqs: ['warFactory', 'battleLab'], sortOrder: 40,
  },
  {
    key: 'apocalypse', name: 'Apocalypse Tank', blurb: 'The end of an argument.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: V,
    cost: 1750, buildTime: 24, prereqs: ['warFactory', 'battleLab'], sortOrder: 40,
  },
  {
    key: 'mcv', name: 'Construction Vehicle', blurb: 'Deploys into a second base.',
    kind: BuildKind.Unit, faction: Faction.Neutral, tab: V,
    // WAR FACTORY ONLY, and this row is the one the game reads. `battleLab`
    // carries `struct.tech`, which `UnlockGate` withholds from a fresh profile,
    // so gating the rebuild behind it strands a new player who loses the MCV
    // every match opens with. The same fix was written three times in
    // `Defs.ts` (:677, :848, :1012) and never took, because `resolveEntry`
    // reads `prereqs` from HERE unconditionally — see the note above `CONTENT`.
    cost: 3000, buildTime: 32, prereqs: ['warFactory'], sortOrder: 50,
  },

  /* -- naval (shares the Vehicles tab; there are only four tabs) ---------- */
  {
    key: 'transport', name: 'Hover Transport', blurb: 'Carries a squad across water.',
    kind: BuildKind.Unit, faction: Faction.Neutral, tab: V,
    cost: 900, buildTime: 12, prereqs: ['navalYard'], sortOrder: 60,
  },
  {
    key: 'gunboat', name: 'Assault Destroyer', blurb: 'Allied escort. Shoots at everything.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: V,
    cost: 1000, buildTime: 14, prereqs: ['navalYard'], sortOrder: 70,
  },
  {
    key: 'destroyer', name: 'Aircraft Cruiser', blurb: 'Allied capital ship.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: V,
    cost: 1800, buildTime: 22, prereqs: ['navalYard', 'battleLab'], sortOrder: 80,
  },
  {
    key: 'submarine', name: 'Attack Submarine', blurb: 'Soviet ambush hull.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: V,
    cost: 1000, buildTime: 14, prereqs: ['subPen'], sortOrder: 70,
  },
  {
    key: 'dreadnought', name: 'Dreadnought', blurb: 'Soviet siege ship.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: V,
    cost: 2000, buildTime: 24, prereqs: ['subPen', 'battleLab'], sortOrder: 80,
  },

  /* ======================================================================
   * THE MERIDIAN PACT — a self-contained tech tree.
   *
   * Every number is verbatim from `src/data/Defs.ts`. The Pact shares NOTHING
   * with the Neutral pool (see SHARED_POOL_FACTIONS below): it has its own
   * construction yard, its own power, its own refinery, its own harvester and
   * its own MCV, and mixing the shared rows in would give a Pact player two
   * of each in the same tab.
   *
   * The shape of the tree is the faction: the Solar Array is 350 credits for
   * 160 power, so the Chapterhouse opens off ONE array where the other armies
   * need a second plant — and the Array has 420 hp against a Power Plant's 800.
   * ====================================================================== */
  {
    key: 'mrdConclave', name: 'Conclave', blurb: 'Unfolds the Pact. Builds structures.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 3000, buildTime: 40, prereqs: [], sortOrder: 0, buildable: false,
    producesTabs: [S, D], buildRadius: BUILD_RADIUS,
  },
  {
    key: 'mrdSolarArray', name: 'Solar Array', blurb: 'Generates 160 power. Made of mirrors.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 350, buildTime: 8, prereqs: ['mrdConclave'], sortOrder: 10,
  },
  {
    key: 'mrdCistern', name: 'Ore Cistern', blurb: 'Unloads collectors. Ships with one.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['mrdSolarArray'], sortOrder: 20,
    shipsWith: 'mrdCollector',
  },
  {
    key: 'mrdChapterhouse', name: 'Chapterhouse', blurb: 'Trains Pact infantry.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 500, buildTime: 10, prereqs: ['mrdSolarArray'], sortOrder: 30,
    producesTabs: [I],
  },
  {
    key: 'mrdForgeyard', name: 'Forgeyard', blurb: 'Builds every Pact hull. Sets a rally point.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['mrdCistern'], sortOrder: 40,
    producesTabs: [V],
  },
  {
    key: 'mrdOculus', name: 'Oculus', blurb: 'Reveals the minimap. Opens tier two.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 1000, buildTime: 14, prereqs: ['mrdCistern'], sortOrder: 50,
  },
  {
    key: 'mrdVault', name: 'Sun Vault', blurb: 'Stores 1500 credits of ore.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 150, buildTime: 5, prereqs: ['mrdCistern'], sortOrder: 60,
  },
  {
    key: 'mrdSlipway', name: 'Slipway', blurb: 'Builds Pact warships.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 1000, buildTime: 14, prereqs: ['mrdCistern'], sortOrder: 70,
    producesTabs: [V],
  },
  {
    key: 'mrdReliquary', name: 'Reliquary', blurb: 'Unlocks the top of every tab.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['mrdOculus'], sortOrder: 80,
  },
  {
    key: 'mrdRampart', name: 'Rampart', blurb: 'Stops vehicles. Stops nothing else.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: D,
    cost: 100, buildTime: 2, prereqs: ['mrdChapterhouse'], sortOrder: 10,
  },
  {
    key: 'mrdGlaive', name: 'Glaive Post', blurb: 'Anti-infantry repeater. Needs the grid.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: D,
    cost: 450, buildTime: 8, prereqs: ['mrdChapterhouse'], sortOrder: 20,
  },
  {
    key: 'mrdHelios', name: 'Helios Spire', blurb: 'Long beam defence. Dark in a brownout.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: D,
    cost: 1500, buildTime: 16, prereqs: ['mrdReliquary'], sortOrder: 30,
  },

  {
    key: 'mrdWayfarer', name: 'Wayfarer', blurb: 'Line infantry. Long eyes, thin skin.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: I,
    cost: 175, buildTime: 5, prereqs: ['mrdChapterhouse'], sortOrder: 10,
  },
  {
    key: 'mrdLancer', name: 'Sunlancer', blurb: 'Shoulder lance. Kills armour and aircraft.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: I,
    cost: 450, buildTime: 8, prereqs: ['mrdChapterhouse', 'mrdOculus'], sortOrder: 20,
  },
  {
    key: 'mrdArtificer', name: 'Artificer', blurb: 'Captures structures. Repairs them.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: I,
    cost: 500, buildTime: 10, prereqs: ['mrdChapterhouse', 'mrdCistern'], sortOrder: 30,
  },
  {
    key: 'mrdCollector', name: 'Sun Collector', blurb: 'Half the load, twice the trips.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    cost: 1000, buildTime: 13, prereqs: ['mrdForgeyard', 'mrdCistern'], sortOrder: 10,
  },
  {
    key: 'mrdSkiff', name: 'Sandskiff', blurb: 'Fastest hull on the map. Made of foil.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    cost: 550, buildTime: 9, prereqs: ['mrdForgeyard'], sortOrder: 20,
  },
  {
    key: 'mrdSolarch', name: 'Solarch', blurb: 'The Pact main line. Outranges, never brawls.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    cost: 800, buildTime: 12, prereqs: ['mrdForgeyard'], sortOrder: 30,
  },
  {
    key: 'mrdZenith', name: 'Zenith Emitter', blurb: 'Siege beam. Dies in a brownout.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    cost: 1500, buildTime: 19, prereqs: ['mrdForgeyard', 'mrdReliquary'], sortOrder: 40,
  },
  {
    key: 'mrdCarryall', name: 'Pactworks Carryall', blurb: 'Deploys into a second Conclave.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    // Forgeyard only — `mrdReliquary` carries `struct.tech`. See `mcv` above.
    cost: 3000, buildTime: 32, prereqs: ['mrdForgeyard'], sortOrder: 50,
  },
  {
    key: 'mrdKestrel', name: 'Kestrel Gunship', blurb: 'Fast rocket pods. Nothing to shoot back with.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    cost: 1100, buildTime: 15, prereqs: ['mrdForgeyard', 'mrdOculus'], sortOrder: 60,
  },
  {
    key: 'mrdCorvette', name: 'Kite Corvette', blurb: 'Escort hull. Shells shorelines.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    cost: 950, buildTime: 13, prereqs: ['mrdSlipway'], sortOrder: 70,
  },
  {
    key: 'mrdMonitor', name: 'Sunmonitor', blurb: 'Pact capital ship. Forty metres of reach.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: V,
    cost: 1900, buildTime: 23, prereqs: ['mrdSlipway', 'mrdReliquary'], sortOrder: 80,
  },

  /* ======================================================================
   * THE RECLAMATION — a self-contained tech tree, and a deliberately FLAT one.
   *
   * Every number is verbatim from `src/data/Defs.ts`. Like the Pact this
   * faction draws nothing from the `Faction.Neutral` pool (see
   * SHARED_POOL_FACTIONS below) — it has its own yard, power, refinery,
   * harvester and MCV.
   *
   * READ THE PREREQ COLUMN, because it is the whole faction: `rclSpitter` and
   * `rclGrinder` name ONLY `rclBreakerYard`. Four structures — Foundry,
   * Furnace, Sorter, Breaker Yard — and the Reclamation's line army exists,
   * where an Allied or Soviet player needs six before a Grizzly, and a Pact
   * player needs five. It buys that tempo with an 80-power plant (against 100
   * and 160) and with the softest hulls in the game.
   * ====================================================================== */
  {
    key: 'rclFoundry', name: 'Foundry', blurb: 'Unfolds the Reclamation. Builds structures.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 3000, buildTime: 40, prereqs: [], sortOrder: 0, buildable: false,
    producesTabs: [S, D], buildRadius: BUILD_RADIUS,
  },
  {
    key: 'rclFurnace', name: 'Scrap Furnace', blurb: 'Generates 80 power. Cheap, tough, and never enough.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 240, buildTime: 7, prereqs: ['rclFoundry'], sortOrder: 10,
  },
  {
    key: 'rclSorter', name: 'Ore Sorter', blurb: 'Unloads Scrapjaws. Ships with one.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['rclFurnace'], sortOrder: 20,
    shipsWith: 'rclScrapper',
  },
  {
    key: 'rclRookery', name: 'Rookery', blurb: 'Trains pickers. Ninety credits at a time.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 450, buildTime: 9, prereqs: ['rclFurnace'], sortOrder: 30,
    producesTabs: [I],
  },
  {
    key: 'rclBreakerYard', name: 'Breaker Yard', blurb: 'Builds every Reclamation hull. Sets a rally point.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 1900, buildTime: 22, prereqs: ['rclSorter'], sortOrder: 40,
    producesTabs: [V],
  },
  {
    key: 'rclSpotter', name: 'Spotter Mast', blurb: 'Reveals the minimap. Opens the heavy coil.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 1000, buildTime: 14, prereqs: ['rclSorter'], sortOrder: 50,
  },
  {
    key: 'rclHeap', name: 'Slag Heap', blurb: 'Stores 1500 credits of ore.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 150, buildTime: 5, prereqs: ['rclSorter'], sortOrder: 60,
  },
  {
    key: 'rclDrydock', name: 'Breaker Dock', blurb: 'Builds Reclamation hulls that float.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 1000, buildTime: 14, prereqs: ['rclSorter'], sortOrder: 70,
    producesTabs: [V],
  },
  {
    key: 'rclCrucible', name: 'Crucible', blurb: 'Opens the siege hull, the Yardcrawler and the Hulk.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 2000, buildTime: 24, prereqs: ['rclSpotter'], sortOrder: 80,
  },
  {
    key: 'rclBarricade', name: 'Scrap Barricade', blurb: 'Stops vehicles. Stops nothing else.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: D,
    cost: 100, buildTime: 2, prereqs: ['rclRookery'], sortOrder: 10,
  },
  {
    key: 'rclSpitpost', name: 'Spitpost', blurb: 'Cheap chained coil. Fires through a blackout.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: D,
    cost: 420, buildTime: 8, prereqs: ['rclRookery'], sortOrder: 20,
  },
  {
    key: 'rclPylon', name: 'Arc Pylon', blurb: 'Three chained arcs. Draws ninety power to do it.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: D,
    cost: 1450, buildTime: 16, prereqs: ['rclSpotter'], sortOrder: 30,
  },

  {
    key: 'rclPicker', name: 'Scrap Picker', blurb: 'Ninety credits. Three seconds. Bring forty.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: I,
    cost: 90, buildTime: 3, prereqs: ['rclRookery'], sortOrder: 10,
  },
  {
    key: 'rclSlagger', name: 'Slagger', blurb: 'Satchel of molten slag. The only thing that hurts a wall.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: I,
    cost: 380, buildTime: 7, prereqs: ['rclRookery'], sortOrder: 20,
  },
  {
    key: 'rclTinker', name: 'Tinker', blurb: 'Captures structures. Repairs them.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: I,
    cost: 500, buildTime: 10, prereqs: ['rclRookery', 'rclSorter'], sortOrder: 30,
  },
  {
    key: 'rclScrapper', name: 'Scrapjaw', blurb: 'Ore crusher on wheels. Drives over anything soft.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    cost: 1150, buildTime: 14, prereqs: ['rclBreakerYard', 'rclSorter'], sortOrder: 10,
  },
  {
    key: 'rclSpitter', name: 'Arcspitter', blurb: 'Fast coil buggy. Sixteen metres of reach and no armour.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    cost: 420, buildTime: 6, prereqs: ['rclBreakerYard'], sortOrder: 20,
  },
  {
    key: 'rclGrinder', name: 'Grinder', blurb: 'The line. Cheap, quick, blind past eighteen metres.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    cost: 600, buildTime: 9, prereqs: ['rclBreakerYard'], sortOrder: 30,
  },
  {
    key: 'rclSlaghurler', name: 'Slaghurler', blurb: 'The only thing in the army that can break a base.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    cost: 1150, buildTime: 15, prereqs: ['rclBreakerYard', 'rclCrucible'], sortOrder: 40,
  },
  {
    key: 'rclCrawler', name: 'Yardcrawler', blurb: 'Unfolds into a second Foundry.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    // Breaker Yard only — `rclCrucible` carries `struct.tech`. See `mcv` above.
    cost: 3000, buildTime: 32, prereqs: ['rclBreakerYard'], sortOrder: 50,
  },
  {
    key: 'rclHornet', name: 'Swarmhornet', blurb: 'Chained arc from a lifting body. Nothing to shoot back with.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    cost: 900, buildTime: 12, prereqs: ['rclBreakerYard', 'rclSpotter'], sortOrder: 60,
  },
  {
    key: 'rclScow', name: 'Slag Scow', blurb: 'A barge with a bow gun bolted to it.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    cost: 850, buildTime: 12, prereqs: ['rclDrydock'], sortOrder: 70,
  },
  {
    key: 'rclHulk', name: 'Reclaimed Hulk', blurb: 'Somebody else’s capital ship, welded back together.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: V,
    cost: 1800, buildTime: 22, prereqs: ['rclDrydock', 'rclCrucible'], sortOrder: 80,
  },
  /*
   * APPENDED, NOT INSERTED. A building's `publicId` is its index in THIS
   * array, so placing `gate` next to `wall` where it belongs visually
   * renumbered every later key and collided with `pillbox`. Sort order is
   * what places it in the grid; array position is an id.
   */
  {
    key: 'gate', name: 'Gate', blurb: 'A way through your own wall. Friendlies only.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: D,
    cost: 150, buildTime: 3, prereqs: ['barracks'], sortOrder: 11,
  },

  /* -- THE COMMANDERS, appended for the same reason the gate is -------------
   * One per army, `sortOrder: 90` so they sit at the bottom of the Infantry
   * tab. The one-at-a-time rule is NOT authored here: it is `maxAlive` on the
   * def row, copied into `BuildEntry` by `resolveEntry` and enforced in
   * `availabilityOf`. This table has no column for it on purpose — a cap
   * written in two places is a cap that will disagree with itself.
   * --------------------------------------------------------------------- */
  {
    key: 'fieldMarshal', name: 'Field Marshal', blurb: 'One only. Recalls your army to their side.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: I,
    cost: 1500, buildTime: 20, prereqs: ['barracks', 'radar'], sortOrder: 90,
  },
  {
    key: 'commissar', name: 'War Commissar', blurb: 'One only. Makes nearby troops untouchable.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: I,
    cost: 1500, buildTime: 20, prereqs: ['barracks', 'radar'], sortOrder: 90,
  },
  {
    key: 'mrdHierarch', name: 'Hierarch', blurb: 'One only. Burns everything standing too close.',
    kind: BuildKind.Unit, faction: Faction.Meridian, tab: I,
    cost: 1500, buildTime: 20, prereqs: ['mrdChapterhouse', 'mrdOculus'], sortOrder: 90,
  },
  {
    key: 'rclBaron', name: 'Scrap Baron', blurb: 'One only. Cashes in the dead and mends the living.',
    kind: BuildKind.Unit, faction: Faction.Reclaim, tab: I,
    cost: 1500, buildTime: 20, prereqs: ['rclRookery', 'rclSpotter'], sortOrder: 90,
  },

  /* -- THE REPAIR DEPOTS ----------------------------------------------------
   * Three rows for four armies: the first is `Faction.Neutral`, which in this
   * table means the two original armies share it — see SHARED_POOL_FACTIONS
   * below.
   *
   * The pad radius, the rate and the price are NOT here. They are
   * `REPAIR_DEPOT` in `core/config.ts`, read by `RepairSell.tickDepots`, which
   * finds a depot by DEF ID rather than by anything authored in this table. A
   * building whose behaviour was half-described here and half in the sim is
   * the drift this repo keeps paying for.
   *
   * Gated on the vehicle factory, not the refinery: the building is worthless
   * until you own armour, and the moment you do it is the cheapest way to keep
   * it. `sortOrder: 75` puts it after the naval yard and before the lab.
   * ---------------------------------------------------------------------- */
  {
    key: 'repairDepot', name: 'Repair Depot', blurb: 'Mends any vehicle parked on the pad.',
    kind: BuildKind.Building, faction: Faction.Neutral, tab: S,
    cost: 800, buildTime: 10, prereqs: ['warFactory'], sortOrder: 75,
  },
  {
    key: 'mrdDepot', name: 'Solar Infirmary', blurb: 'Mends any hull standing in the light.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 800, buildTime: 10, prereqs: ['mrdForgeyard'], sortOrder: 75,
  },
  {
    key: 'rclDepot', name: 'Patch Yard', blurb: 'Welds any hull that stops moving.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 800, buildTime: 10, prereqs: ['rclBreakerYard'], sortOrder: 75,
  },

  /* -- THE ALLIED AND SOVIET AIR ARMS ---------------------------------------
   * `ProductionCatalog` is keyed on THIS table, not on the def table: a unit
   * with a def row, a fallback row, a model binding and an AI catalog entry
   * and no spec here is not in any roster, has no cameo, and cannot be
   * ordered. The def table only supplies the numbers for a key that already
   * appears below (`resolveEntry` reads `binding.unitId[spec.key]`).
   *
   * No new PRODUCER. Both are `tab: V`, so the War Factory — whose
   * `producesTabs` is `[V]` — services them, exactly as the Forgeyard services
   * the Kestrel and the Breaker Yard the Hornet. An airfield structure would
   * be a second building per army for no mechanical difference, and this game
   * has no rearm cycle for one to host.
   *
   * `radar` is the second prereq and it is not a stand-in: its own alias row
   * in `game/Scenarios.ts` has read `['radar', 'radardome', 'airfield']` since
   * before anything could fly.
   *
   * `sortOrder: 45` seats them between the tier-3 tank (40) and the MCV (50),
   * so the Vehicles tab runs economy, line armour, raider, specialist,
   * aircraft, MCV, transport, navy — ascending by role rather than by the
   * order rows happened to be written.
   *
   * APPENDED rather than filed in the Allied and Soviet blocks above: on an
   * UNBOUND boot (no data module) `resolveEntry` falls back to `publicId =
   * index`, so inserting a row here would renumber every entry after it. The
   * sidebar reads `sortOrder`, never array order, so nothing is lost by
   * putting them last.
   * ---------------------------------------------------------------------- */
  {
    key: 'vindicator', name: 'Vindicator',
    blurb: 'Strike aircraft. Kills armour from a place tanks cannot reach.',
    kind: BuildKind.Unit, faction: Faction.Allies, tab: V,
    cost: 1200, buildTime: 16, prereqs: ['warFactory', 'radar'], sortOrder: 45,
  },
  {
    key: 'mig', name: 'MiG Fighter', blurb: 'Interceptor. Owns the sky and nothing under it.',
    kind: BuildKind.Unit, faction: Faction.Soviets, tab: V,
    cost: 1000, buildTime: 14, prereqs: ['warFactory', 'radar'], sortOrder: 45,
  },

  /* -- THE SUPERWEAPONS -----------------------------------------------------
   * Six rows, one per entry in `SUPERWEAPONS` (src/sim/Superweapons.ts). They
   * are the only reason any of that file is reachable: the service charges a
   * weapon only while its owner holds a finished, powered structure whose
   * content key it names, and until these rows existed the sidebar had no way
   * to offer one.
   *
   * NOTHING ABOUT THE WEAPON IS HERE. The charge time, the radius, the effect
   * and the targeting mode are `SUPERWEAPONS`, read by the service, which finds
   * the structure BY CONTENT KEY rather than by anything authored in this
   * table. Same discipline the Repair Depot block above states: a building
   * whose behaviour was half-described here and half in the sim is the drift
   * this repo keeps paying for.
   *
   * `prereqs` MUST match `src/data/Defs.ts` exactly — `resolveEntry` takes the
   * spec's list unconditionally while every other field falls back to the def,
   * and `tests/catalog-prereqs.spec.ts` exists because that has silently
   * diverged before. `sortOrder` 90/91 puts them last in the Structures tab,
   * after the lab, which is also where they sit on the tech tree.
   * ---------------------------------------------------------------------- */
  {
    key: 'nuclearSilo', name: 'Nuclear Missile Silo',
    blurb: 'Charges a single annihilating warhead. Announced before it lands.',
    kind: BuildKind.Building, faction: Faction.Soviets, tab: S,
    cost: 2500, buildTime: 32, prereqs: ['battleLab'], sortOrder: 90,
  },
  {
    key: 'ironCurtain', name: 'Iron Curtain Device',
    blurb: 'Makes everything in the radius untouchable for twenty seconds.',
    kind: BuildKind.Building, faction: Faction.Soviets, tab: S,
    cost: 2000, buildTime: 28, prereqs: ['battleLab'], sortOrder: 91,
  },
  {
    key: 'chronosphere', name: 'Chronosphere',
    blurb: 'Lifts nine of your units out of one place and sets them down in another.',
    kind: BuildKind.Building, faction: Faction.Allies, tab: S,
    cost: 2000, buildTime: 28, prereqs: ['battleLab'], sortOrder: 90,
  },
  {
    key: 'weatherControl', name: 'Weather Control Device',
    blurb: 'Nine seconds of lightning. None of it lands where you thought.',
    kind: BuildKind.Building, faction: Faction.Allies, tab: S,
    cost: 2500, buildTime: 32, prereqs: ['battleLab'], sortOrder: 91,
  },
  {
    key: 'mrdHeliograph', name: 'Heliograph',
    blurb: 'Turns the sky on one point. Announced before it burns.',
    kind: BuildKind.Building, faction: Faction.Meridian, tab: S,
    cost: 2500, buildTime: 32, prereqs: ['mrdReliquary'], sortOrder: 90,
  },
  {
    key: 'rclStormworks', name: 'Stormworks',
    blurb: 'Nine seconds of loose arcs over anywhere on the map.',
    kind: BuildKind.Building, faction: Faction.Reclaim, tab: S,
    cost: 2500, buildTime: 32, prereqs: ['rclCrucible'], sortOrder: 90,
  },
];

/** Every army a player or an AI can be. Neutral is not one of them. */
const PLAYABLE_FACTIONS: readonly Faction[] = [
  Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim,
];

/**
 * The armies that draw from the `Faction.Neutral` content pool.
 *
 * Neutral is not "everyone" — it is "the original two armies field the same
 * thing". The Meridian Pact and the Reclamation are complete parallel trees
 * down to their own construction yards, so neither is in this list.
 */
const SHARED_POOL_FACTIONS: readonly Faction[] = [Faction.Allies, Faction.Soviets];

/** The Soviet naval yard is called a Sub Pen but services the same queue. */
const NAVAL_PREREQ_ALIASES: Readonly<Record<string, string>> = {
  navalYard: 'subPen',
  subPen: 'navalYard',
};

/* ==========================================================================
 * 2. CATALOG CONSTRUCTION
 * ========================================================================== */

/**
 * The resolved catalog. Built once at init, immutable afterwards.
 *
 * Lookups are all O(1) through pre-built maps because the HUD asks
 * "what is entry 14" sixty times a second and the tech pass asks
 * "who owns key 'refinery'" once per structure per tick.
 */
export class ProductionCatalog {
  readonly entries: readonly BuildEntry[];
  /** Buildable entries per (faction, tab), pre-sorted by sortOrder. */
  private readonly byFactionTab = new Map<number, BuildEntry[]>();
  private readonly byKeyMap = new Map<string, BuildEntry>();
  private readonly byDefIdBuilding = new Map<number, BuildEntry>();
  private readonly byDefIdUnit = new Map<number, BuildEntry>();
  /** True when a real DefTables was found and merged. */
  readonly bound: boolean;

  constructor(binding: DefBinding) {
    this.bound = binding.tables !== null;
    const entries: BuildEntry[] = [];

    for (let i = 0; i < CONTENT.length; i++) {
      const spec = CONTENT[i];
      const entry = resolveEntry(spec, i, binding);
      if (entry === null) continue;
      entries.push(entry);
    }
    this.entries = entries;

    for (const e of entries) {
      this.byKeyMap.set(e.key, e);
      if (e.defId >= 0) {
        (e.kind === BuildKind.Building ? this.byDefIdBuilding : this.byDefIdUnit).set(e.defId, e);
      }
    }

    // One list per (faction, tab). A Neutral entry appears in the list of every
    // army in SHARED_POOL_FACTIONS, which is the whole reason 'engineer' and
    // 'harvester' are authored once — but NOT in the Meridian Pact's, which
    // ships its own Conclave, Solar Array, Cistern and Sun Collector and would
    // otherwise show two of each in the same tab.
    for (const faction of PLAYABLE_FACTIONS) {
      const sharesPool = SHARED_POOL_FACTIONS.includes(faction);
      for (let t = 0; t < BUILD_TAB_COUNT; t++) {
        const list = entries
          .filter((e) => e.buildable && e.tab === (t as BuildTab)
            && ((sharesPool && e.faction === Faction.Neutral) || e.faction === faction))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index);
        this.byFactionTab.set(faction * BUILD_TAB_COUNT + t, list);
      }
    }
  }

  /** Catalog entry by its index. Null for an out-of-range id. */
  at(index: number): BuildEntry | null {
    return index >= 0 && index < this.entries.length ? this.entries[index] : null;
  }

  byKey(key: string): BuildEntry | null {
    return this.byKeyMap.get(key) ?? null;
  }

  /** Map a REAL def-table index back to a catalog entry. */
  fromDefId(defId: number, isBuilding: boolean): BuildEntry | null {
    if (defId < 0) return null;
    return (isBuilding ? this.byDefIdBuilding : this.byDefIdUnit).get(defId) ?? null;
  }

  /**
   * Turn whatever id a caller has into an entry. See `BuildEntry.publicId`.
   *
   * Accepts THREE spellings of the same thing, because three different modules
   * legitimately hold different ones:
   *   - a `publicId`      (units offset by UNIT_PUBLIC_ID_BASE) — the AI, Placement
   *   - a bare def index  plus an `isBuilding` hint             — every command path,
   *                                                               where the tab already
   *                                                               said which table
   *   - a catalog index                                         — no def table bound
   *
   * With no hint and no offset the id can only be read as a BUILDING def index:
   * that is the one case where guessing is safe, because a caller holding a raw
   * unit index without a hint has no way to have meant anything else and would
   * have been wrong under the old code too.
   */
  resolve(id: number, isBuilding?: boolean): BuildEntry | null {
    if (id < 0) return null;
    if (this.bound) {
      const offset = id >= UNIT_PUBLIC_ID_BASE;
      const bare = offset ? id - UNIT_PUBLIC_ID_BASE : id;
      if (isBuilding === true) {
        // An offset id is a unit by construction; never answer with a building.
        if (!offset) {
          const b = this.byDefIdBuilding.get(id);
          if (b !== undefined) return b;
        }
      } else if (isBuilding === false) {
        const u = this.byDefIdUnit.get(bare);
        if (u !== undefined) return u;
      } else if (offset) {
        const u = this.byDefIdUnit.get(bare);
        if (u !== undefined) return u;
      } else {
        const b = this.byDefIdBuilding.get(id);
        if (b !== undefined) return b;
      }
    }
    const byIndex = this.at(id);
    if (byIndex === null) return null;
    if (isBuilding !== undefined && (byIndex.kind === BuildKind.Building) !== isBuilding) return null;
    return byIndex;
  }

  /** Everything `faction` may build in `tab`, in sidebar order. */
  roster(faction: Faction, tab: BuildTab): readonly BuildEntry[] {
    return this.byFactionTab.get(faction * BUILD_TAB_COUNT + (tab as number)) ?? EMPTY_ROSTER;
  }

  get count(): number { return this.entries.length; }
}

const EMPTY_ROSTER: readonly BuildEntry[] = [];

/** Entity kinds `unitCensus` walks. Module scope: it runs every tick. */
const OWNED_COUNT_KINDS: readonly EntityKind[] = [EntityKind.Infantry, EntityKind.Vehicle];

/**
 * Def-id slots the unit census buckets into, per player.
 *
 * `store.defId` is an `Int16Array` holding an index into `DefTables.units`,
 * which has 48 rows. 256 is that with room to grow twice over, and it is what
 * the old single-player scratch used; the array is now `MAX_PLAYERS` of these,
 * which is 2 KB total and still zeroed with one `fill`.
 */
const UNIT_DEF_SLOTS = 256;

/** Merge one authored spec with the fallback tables and any real def. */
function resolveEntry(spec: ContentSpec, index: number, binding: DefBinding): BuildEntry | null {
  const isBuilding = spec.kind === BuildKind.Building;

  if (isBuilding) {
    const fb: FallbackBuilding | undefined = FALLBACK_BUILDINGS[spec.key];
    if (fb === undefined) {
      console.warn(`[production] no fallback building for "${spec.key}" — entry dropped`);
      return null;
    }
    const defId = binding.buildingId[spec.key] ?? -1;
    const def: BuildingDef | undefined = defId >= 0 ? binding.tables?.buildings[defId] : undefined;
    const fw = def?.footprintW ?? fb.footprintW;
    const fh = def?.footprintH ?? fb.footprintH;
    return {
      index,
      key: spec.key,
      name: def?.name ?? spec.name,
      blurb: def?.blurb ?? spec.blurb,
      kind: BuildKind.Building,
      faction: spec.faction,
      tab: def?.tab ?? spec.tab,
      cost: def?.cost ?? spec.cost,
      buildTime: def?.buildTime ?? spec.buildTime,
      prereqs: spec.prereqs,
      sortOrder: spec.sortOrder,
      buildable: spec.buildable !== false,
      unlockedBy: def?.unlockedBy ?? '',
      defId,
      publicId: defId >= 0 ? defId : index,
      footprintW: fw,
      footprintH: fh,
      height: fb.height,
      power: def?.power ?? fb.power,
      storage: def?.storage ?? fb.storage,
      buildRadius: spec.buildRadius ?? def?.buildRadius ?? PLACEMENT.adjacencyRadius,
      producesTabs: spec.producesTabs ?? EMPTY_TABS,
      // Default exit: dead centre of the front (+Z) edge, one clearance out.
      exitX: def?.exitOffsetX ?? 0,
      exitZ: def?.exitOffsetZ ?? (fh * CELL * 0.5 + PRODUCTION.exitClearanceMetres),
      shipsWith: spec.shipsWith ?? '',
      entityKind: EntityKind.Building,
      // No structure is capped. If one ever is, this reads the def field.
      maxAlive: 0,
    };
  }

  const fb: FallbackUnit | undefined = FALLBACK_UNITS[spec.key];
  if (fb === undefined) {
    console.warn(`[production] no fallback unit for "${spec.key}" — entry dropped`);
    return null;
  }
  const defId = binding.unitId[spec.key] ?? -1;
  const def: UnitDef | undefined = defId >= 0 ? binding.tables?.units[defId] : undefined;
  return {
    index,
    key: spec.key,
    name: def?.name ?? spec.name,
    blurb: def?.blurb ?? spec.blurb,
    kind: BuildKind.Unit,
    faction: spec.faction,
    tab: def?.tab ?? spec.tab,
    cost: def?.cost ?? spec.cost,
    buildTime: def?.buildTime ?? spec.buildTime,
    prereqs: spec.prereqs,
    sortOrder: spec.sortOrder,
    buildable: spec.buildable !== false,
    unlockedBy: def?.unlockedBy ?? '',
    defId,
    // See BuildEntry.publicId: the offset is what keeps a unit's id from
    // colliding with the building sharing its def index.
    publicId: defId >= 0 ? defId + UNIT_PUBLIC_ID_BASE : index,
    footprintW: 0,
    footprintH: 0,
    height: fb.height,
    power: 0,
    storage: 0,
    buildRadius: 0,
    producesTabs: EMPTY_TABS,
    exitX: 0,
    exitZ: 0,
    shipsWith: '',
    entityKind: def?.kind ?? fb.kind,
    maxAlive: def?.maxAlive ?? 0,
  };
}

const EMPTY_TABS: readonly BuildTab[] = [];

/* ==========================================================================
 * 3. INTENTS
 *
 * Every public mutator queues an intent instead of touching the world. The
 * whole point is that the sim mutates in exactly one place, inside simTick, in
 * a fixed order — so a HUD click at frame time and an AI command at tick time
 * produce the same result in the same order on every machine.
 * ========================================================================== */

const enum IntentKind {
  Enqueue = 0,
  Cancel = 1,
  Pause = 2,
  Place = 3,
  Rally = 4,
  Primary = 5,
  Sell = 6,
}

interface Intent {
  kind: IntentKind;
  player: number;
  tab: BuildTab;
  /** Catalog index. */
  defId: number;
  arg: number;
  x: number;
  z: number;
  target: number;
}

const INTENT_CAPACITY = 256;

/* ==========================================================================
 * 4. THE SERVICE
 * ========================================================================== */

/** Per-player scratch the service owns. Sized once. */
interface PlayerScratch {
  /** Credits spent/refunded this tick, netted so we emit one event. */
  creditDelta: number;
  /** Eased credits readout for the HUD. */
  creditsDisplay: number;
  /** Sim time of the last "insufficient funds" line. */
  lastFundsEva: number;
  /** Sim time of the last refused sell, so a held-down sell cursor cannot spam. */
  lastSellRefusal: number;
  /** Number of available cameos last tick, to detect NEW options. */
  availableCount: number;
  /** Seconds until a blocked egress is retried. */
  egressRetry: Float32Array;
}

export class ProductionService implements QueueHooks {
  readonly queues: BuildQueues;
  /** HUD-facing snapshot for the LOCAL player. Rebuilt in place every tick. */
  readonly snapshot: HudSnapshot;

  /** Catalog index of the entity in each slot, or -1. Generation-stamped. */
  private readonly entryOfEntity: PerEntityI16;
  /** Completed buildings per (player, catalog index). */
  private readonly builtCount: Int32Array;
  /** Live-but-unfinished buildings per (player, catalog index). */
  private readonly buildingCount: Int32Array;
  /** Factory count per (player, tab), recomputed every tick. */
  private readonly factories: Int32Array;
  /** Chosen spawn factory per (player, tab). Slot index, or -1. */
  private readonly primaryFactory: Int32Array;

  private readonly scratch: PlayerScratch[] = [];
  private readonly intents: Intent[] = [];
  private intentCount = 0;

  private readonly placementListeners: PlacementListener[] = [];
  private readonly notice: PlacementNotice = {
    phase: PlacementPhase.Began, player: 0 as PlayerId, defId: -1, key: '',
    cx: 0, cz: 0, w: 0, h: 0, facing: 0, ok: false, reason: '', id: NONE,
  };

  /** Cameo objects, pooled per tab so the HUD snapshot never allocates. */
  private readonly cameoPool: HudCameo[][] = [[], [], [], []];
  private cameoFaction: Faction = Faction.Neutral;

  /**
   * The real def tables, when a data module published some. Spawn paths read
   * hp/speed/armour straight out of this so a produced Grizzly is identical to
   * a scenario-placed one. Set once by `production.system.ts` at init.
   */
  bindingTables: DefTables | null = null;

  /** True once we have decided we are the one draining the command bus. */
  private commandFallback = false;
  private commandFallbackLogged = false;

  private tickCount = 0;
  /** Set when a structure completes, so tech is re-derived exactly once. */
  private techDirty = true;

  /** Reused by the sell guard. A sell is rare; the object is still not per-call. */
  private readonly viability: ViabilitySurvey = makeViabilitySurvey();

  constructor(
    readonly world: World,
    readonly channels: Channels,
    readonly catalog: ProductionCatalog,
  ) {
    this.queues = new BuildQueues(this);
    this.entryOfEntity = new PerEntityI16(world.store, -1);
    const n = MAX_PLAYERS * catalog.count;
    this.builtCount = new Int32Array(n);
    this.buildingCount = new Int32Array(n);
    this.factories = new Int32Array(MAX_PLAYERS * BUILD_TAB_COUNT);
    this.primaryFactory = new Int32Array(MAX_PLAYERS * BUILD_TAB_COUNT).fill(-1);

    for (let p = 0; p < MAX_PLAYERS; p++) {
      this.scratch.push({
        creditDelta: 0,
        creditsDisplay: 0,
        lastFundsEva: -1e9,
        lastSellRefusal: -1e9,
        availableCount: 0,
        egressRetry: new Float32Array(BUILD_TAB_COUNT),
      });
    }
    for (let i = 0; i < INTENT_CAPACITY; i++) {
      this.intents.push({
        kind: IntentKind.Enqueue, player: 0, tab: BuildTab.Structures,
        defId: -1, arg: 0, x: 0, z: 0, target: 0,
      });
    }

    this.snapshot = {
      credits: 0, creditsDisplay: 0,
      powerProduced: 0, powerConsumed: 0, brownout: false, hasRadar: false,
      activeTab: BuildTab.Structures,
      cameos: [[], [], [], []],
      tabAlert: [false, false, false, false],
      selectionCount: 0, selectionPrimary: NONE,
      gameTimeSec: 0, matchPhase: MatchPhase.Playing,
    };

    // Structures placed by anything other than us (the scenario, a deploying
    // MCV) still have to release their nav cells when they die.
    channels.events.on('entity:killed', (ev) => {
      if (ev.kind === EntityKind.Building) this.onBuildingRemoved(ev.id, ev.player);
    });
    channels.events.on('building:captured', () => { this.techDirty = true; });
  }

  /* ======================================================================
   * 5a. PUBLIC API — everything the HUD, the AI and the tests call
   * ====================================================================== */

  /**
   * Queue `count` of a buildable. `defId` is a `BuildEntry.publicId` — a real
   * def index when content exists, a catalog index when it does not. Applied
   * at the next Phase.Production, never inline.
   */
  enqueue(player: PlayerId, defId: number, count = 1, isBuilding?: boolean): void {
    const entry = this.catalog.resolve(defId, isBuilding);
    if (entry === null) return;
    this.push(IntentKind.Enqueue, player, entry.tab, entry.index, count, 0, 0, 0);
  }

  /** Queue by content key ('warFactory'). The unambiguous entry point. */
  enqueueByKey(player: PlayerId, key: string, count = 1): void {
    const entry = this.catalog.byKey(key);
    if (entry === null) return;
    this.push(IntentKind.Enqueue, player, entry.tab, entry.index, count, 0, 0, 0);
  }

  /** Cancel one queued item. `slot` -1 cancels the most recently queued. */
  cancel(player: PlayerId, defId: number, slot = -1, isBuilding?: boolean): void {
    const entry = this.catalog.resolve(defId, isBuilding);
    if (entry === null) return;
    this.push(IntentKind.Cancel, player, entry.tab, entry.index, slot, 0, 0, 0);
  }

  /** Pause or resume the head of a tab. */
  setPaused(player: PlayerId, tab: BuildTab, paused: boolean): void {
    this.push(IntentKind.Pause, player, tab, -1, paused ? 1 : 0, 0, 0, 0);
  }

  /**
   * Commit a ready structure at an origin cell, turned `facing` quarter turns.
   * Validity is re-checked at Phase.Production against the SAME facing.
   *
   * `facing` defaults to 0 — the AI never turns anything and its command path
   * carries no facing, so its behaviour is byte-for-byte what it was.
   */
  placeBuilding(player: PlayerId, defId: number, cx: number, cz: number, facing = 0): void {
    const entry = this.catalog.resolve(defId, true);
    if (entry === null) return;
    this.push(
      IntentKind.Place, player, BuildTab.Structures, entry.index,
      normaliseFacing(facing), cx, cz, 0,
    );
  }

  /** Move a factory's rally flag. Persists for the factory's whole life. */
  setRally(player: PlayerId, factory: EntityId, x: number, z: number): void {
    this.push(IntentKind.Rally, player, BuildTab.Structures, -1, 0, x, z, factory as number);
  }

  /** Make a factory the one that units come out of. */
  setPrimary(player: PlayerId, factory: EntityId): void {
    this.push(IntentKind.Primary, player, BuildTab.Structures, -1, 0, 0, 0, factory as number);
  }

  /** Sell a structure for SELL_REFUND of its cost. */
  sell(player: PlayerId, building: EntityId): void {
    this.push(IntentKind.Sell, player, BuildTab.Structures, -1, 0, 0, 0, building as number);
  }

  /**
   * Can `player` build this right now? The reason string is the tooltip; it is
   * never empty when `ok` is false.
   */
  availability(player: PlayerId, defId: number, out?: AvailabilityResult): AvailabilityResult {
    const result = out ?? { ok: false, reason: '', capped: false };
    // Reset here rather than at each write site: `out` is a reused scratch
    // object, so a stale `true` from the previous call would otherwise leak
    // into the answer for a completely different buildable.
    result.capped = false;
    const entry = this.catalog.resolve(defId);
    if (entry === null) { result.ok = false; result.reason = 'Unknown'; return result; }
    return this.availabilityOf(player, entry, result);
  }

  /** The same question with the entry already in hand. */
  availabilityOf(player: PlayerId, entry: BuildEntry, out: AvailabilityResult): AvailabilityResult {
    // Same reset as `availability()`: every caller passes a reused scratch.
    out.capped = false;
    const result = out;
    const p = this.world.players[player as number];
    if (p === undefined) { result.ok = false; result.reason = 'Unknown player'; return result; }

    if (!entry.buildable) { result.ok = false; result.reason = 'Not buildable'; return result; }
    if (entry.faction !== Faction.Neutral && entry.faction !== p.faction) {
      result.ok = false; result.reason = 'Wrong faction'; return result;
    }
    // The progression gate. Third, not first: "Wrong faction" is a fact about
    // the entry and "Locked" is a fact about the profile, and reporting the
    // profile answer for an entry the army could never field either way would
    // promise a Soviet player an Apocalypse the moment they unlock one.
    //
    // `p` is passed so the AI resolves against the SAME profile the human does
    // (see UnlockGate.allowsFor). An opponent fielding a unit the player has
    // never seen and cannot build reads as the game cheating, and it spoils the
    // reveal the unlock exists to deliver. Difficulty stays where it lives: the
    // economy handicap and composition quality in AIStrategy.
    if (!isBuildable(entry, p)) {
      result.ok = false; result.reason = LOCKED_REASON; return result;
    }
    for (let i = 0; i < entry.prereqs.length; i++) {
      const key = entry.prereqs[i];
      if (this.hasStructure(player, key)) continue;
      const alias = NAVAL_PREREQ_ALIASES[key];
      if (alias !== undefined && this.hasStructure(player, alias)) continue;
      const req = this.catalog.byKey(key);
      result.ok = false;
      result.reason = `Requires ${req?.name ?? key}`;
      return result;
    }
    if (this.factories[(player as number) * BUILD_TAB_COUNT + (entry.tab as number)] <= 0) {
      result.ok = false;
      result.reason = entry.tab === BuildTab.Structures || entry.tab === BuildTab.Defense
        ? 'Requires a Construction Yard'
        : 'Requires a production structure';
      return result;
    }
    // THE HERO CAP. Last, because it is the only reason on this list that is
    // temporary: every other refusal is "you cannot have this yet", and this
    // one is "you already do". Reporting it ahead of a missing prereq would
    // tell a player who has neither a barracks nor a commander the wrong thing.
    //
    // WHAT IS COUNTED: alive units of this def PLUS whatever is in the tab's
    // queue. The queued half is not decoration — the alive count alone lets a
    // player queue five commanders while the first is still on the line, and
    // then all five walk out. `queued` includes the head that is currently
    // building, which is exactly right.
    if (entry.maxAlive > 0) {
      const inHand = this.aliveOf(player, entry.defId)
        + this.queues.countOf(p, entry.tab, entry.publicId, entry.kind === BuildKind.Building);
      if (inHand >= entry.maxAlive) {
        result.ok = false;
        result.capped = true;
        result.reason = entry.maxAlive === 1
          ? `You already have a ${entry.name}`
          : `Limit ${entry.maxAlive}`;
        return result;
      }
    }
    result.ok = true;
    result.reason = '';
    return result;
  }

  /** True when a completed, powered structure of this key exists. */
  hasStructure(player: PlayerId, key: string): boolean {
    const entry = this.catalog.byKey(key);
    if (entry === null) return false;
    return this.builtCount[(player as number) * this.catalog.count + entry.index] > 0;
  }

  /** Completed structures of a key. */
  structureCount(player: PlayerId, key: string): number {
    const entry = this.catalog.byKey(key);
    if (entry === null) return 0;
    return this.builtCount[(player as number) * this.catalog.count + entry.index];
  }

  /** Catalog entry an existing entity was built from, or null. */
  entryOf(id: EntityId): BuildEntry | null {
    return this.catalog.at(this.entryOfEntity.get(id));
  }

  /** The factory a unit of `tab` would currently come out of, or NONE. */
  spawnFactory(player: PlayerId, tab: BuildTab): EntityId {
    const i = this.primaryFactory[(player as number) * BUILD_TAB_COUNT + (tab as number)];
    return i < 0 ? NONE : this.world.store.handleOf(i);
  }

  /** Rally point of a factory into `out` as [x, z]. False when it has none. */
  rallyPoint(player: PlayerId, factory: EntityId, out: Float32Array): boolean {
    const p = this.world.players[player as number];
    if (p === undefined) return false;
    const x = p.rallyX.get(factory as number);
    const z = p.rallyZ.get(factory as number);
    if (x === undefined || z === undefined) return false;
    out[0] = x; out[1] = z;
    return true;
  }

  /** Which sidebar tab the HUD is showing. Snapshot-only; no sim effect. */
  setActiveTab(tab: BuildTab): void {
    this.snapshot.activeTab = tab;
  }

  setMatchPhase(phase: MatchPhase): void {
    this.snapshot.matchPhase = phase;
  }

  /** Subscribe to the placement flow. Returns an unsubscribe. */
  onPlacement(fn: PlacementListener): () => void {
    this.placementListeners.push(fn);
    return () => {
      const i = this.placementListeners.indexOf(fn);
      if (i >= 0) this.placementListeners.splice(i, 1);
    };
  }

  /**
   * Feed one drained Command in. Returns true when it was ours, so the module
   * that owns the CommandBus drain can pass everything through here without
   * knowing what production commands look like.
   */
  handleCommand(cmd: Command): boolean {
    switch (cmd.kind) {
      case CommandKind.ProductionStart:
        this.enqueue(cmd.player, cmd.defId, Math.max(1, cmd.arg), tabIsStructural(cmd.tab));
        return true;
      case CommandKind.ProductionPause:
        this.setPaused(cmd.player, cmd.tab, cmd.arg !== 0);
        return true;
      case CommandKind.ProductionCancel:
        this.cancel(cmd.player, cmd.defId, cmd.arg, tabIsStructural(cmd.tab));
        return true;
      case CommandKind.PlaceBuilding:
        // `arg` is the facing. Zero for every command the AI issues, which is
        // exactly the behaviour it had before rotation existed.
        this.placeBuilding(cmd.player, cmd.defId, cmd.cx, cmd.cz, cmd.arg);
        return true;
      case CommandKind.SetRally:
        this.setRally(cmd.player, cmd.target, cmd.x, cmd.z);
        return true;
      case CommandKind.SetPrimary:
        this.setPrimary(cmd.player, cmd.target);
        return true;
      case CommandKind.SellBuilding:
        this.sell(cmd.player, cmd.target);
        return true;
      default:
        return false;
    }
  }

  /* ======================================================================
   * 5b. THE TICK
   * ====================================================================== */

  tick(s: SimContext): void {
    this.tickCount++;
    const world = this.world;

    // 0. Who is alive, by def. BEFORE the intents, not after: this is what
    //    `availabilityOf` reads to enforce `maxAlive`, and an enqueue arriving
    //    this tick must be judged against the state of the field NOW. Cleanup
    //    ran at the end of last tick, so a commander that died is already gone
    //    from the store and its build slot is free on this very tick.
    this.unitCensus(world);

    // 1. Intent, then commands. Player intent wins ties by arriving first.
    this.drainIntents();
    this.drainCommands();

    // 2. Census: who owns what, which queues have a factory, what is unlocked.
    //    One pass over every building, every tick. At a few hundred structures
    //    that is nothing, and it means a structure captured, sold, destroyed or
    //    spawned by ANY module is reflected without an event contract.
    this.census();

    const progressTick = (this.tickCount % PRODUCTION.progressEventInterval) === 0;

    for (let pi = 0; pi < world.players.length; pi++) {
      const p = world.players[pi];
      if (p.faction === Faction.Neutral) continue;
      const sc = this.scratch[pi];

      this.queues.advance(p, s.dt, progressTick);

      // A finished vehicle tries the door every few ticks until it fits.
      for (let t = 0; t < BUILD_TAB_COUNT; t++) {
        const tab = t as BuildTab;
        const head = this.queues.head(p, tab);
        if (head === null || !head.ready || head.isBuilding) continue;
        sc.egressRetry[t] -= s.dt;
        if (sc.egressRetry[t] > 0) continue;
        if (this.tryEgress(p, tab, head, s)) this.queues.completeHead(p, tab);
        else sc.egressRetry[t] = PRODUCTION.egressRetrySeconds;
      }

      // One netted credits event per player per tick instead of four.
      if (sc.creditDelta !== 0) {
        this.emitCredits(p, sc.creditDelta, sc.creditDelta > 0 ? CreditReason.Refund : CreditReason.Build);
        sc.creditDelta = 0;
      }
      // The readout eases toward the truth; a hard snap reads as a bug.
      const k = 1 - Math.exp(-PRODUCTION.creditsDisplayLambda * s.dt);
      sc.creditsDisplay += (p.credits - sc.creditsDisplay) * k;
      if (Math.abs(p.credits - sc.creditsDisplay) < 1) sc.creditsDisplay = p.credits;
    }

    // 3. Structures rise.
    this.advanceConstruction(s);

    // 4. Publish for the HUD.
    this.refreshSnapshot(s);
  }

  /* ======================================================================
   * 5c. CENSUS — buildings, factories, tech
   * ====================================================================== */

  private census(): void {
    const world = this.world;
    const st = world.store;
    const n = this.catalog.count;

    this.builtCount.fill(0);
    this.buildingCount.fill(0);
    this.factories.fill(0);
    this.primaryFactory.fill(-1);

    const list = st.byKind[EntityKind.Building];
    const count = st.byKindCount[EntityKind.Building];

    for (let a = 0; a < count; a++) {
      const i = list[a];
      const flags = st.flags[i];
      if ((flags & EntityFlag.Alive) === 0) continue;
      if ((flags & EntityFlag.PendingDestroy) !== 0) continue;

      const entry = this.entryForSlot(i);
      if (entry === null) continue;
      const owner = st.owner[i];
      const base = owner * n + entry.index;

      const complete = (flags & EntityFlag.UnderConstruction) === 0 && st.buildProgress[i] >= 1;
      if (!complete) { this.buildingCount[base]++; continue; }

      // NOTE: a brownout does NOT revoke a prerequisite here, even though
      // BuildableDef.prereqs says "must exist (and be powered)". Gating
      // construction on power soft-locks a player whose only route out of a
      // blackout is building the Power Plant they are now forbidden from
      // building. The blackout lever is POWER_BLACKOUT_MUL — production gets
      // four times slower, never impossible. That is also why config says of
      // it: "Never zero — that is a soft lock."
      this.builtCount[base]++;

      for (let t = 0; t < entry.producesTabs.length; t++) {
        const tab = entry.producesTabs[t] as number;
        const fi = owner * BUILD_TAB_COUNT + tab;
        this.factories[fi]++;
        // Primary wins; otherwise the first one found. Deterministic either way
        // because byKind is a dense list in allocation order.
        if (this.primaryFactory[fi] < 0) this.primaryFactory[fi] = i;
        else if ((flags & EntityFlag.PrimaryFactory) !== 0
          && (st.flags[this.primaryFactory[fi]] & EntityFlag.PrimaryFactory) === 0) {
          this.primaryFactory[fi] = i;
        }
      }
    }

    // Mirror into the shared columns so nobody has to ask us.
    for (let pi = 0; pi < world.players.length; pi++) {
      const p = world.players[pi];
      for (let t = 0; t < BUILD_TAB_COUNT; t++) {
        p.queues[t].factoryCount = this.factories[pi * BUILD_TAB_COUNT + t];
      }
    }

    this.refreshTech();
  }

  /** Recompute `techMask` and announce genuinely new options. */
  private refreshTech(): void {
    const world = this.world;
    const scratchResult: AvailabilityResult = { ok: false, reason: '', capped: false };

    for (let pi = 0; pi < world.players.length; pi++) {
      const p = world.players[pi];
      if (p.faction === Faction.Neutral) continue;
      let available = 0;
      for (let e = 0; e < this.catalog.count; e++) {
        const entry = this.catalog.entries[e];
        if (!entry.buildable) { p.techMask[e] = 0; continue; }
        this.availabilityOf(p.id, entry, scratchResult);
        const ok = scratchResult.ok ? 1 : 0;
        p.techMask[e] = ok;
        available += ok;
      }
      const sc = this.scratch[pi];
      if (available > sc.availableCount) {
        // Strictly MORE options than last tick: that is the EVA line. Losing
        // options (a bombed Radar Dome) is announced by the loss, not by this.
        this.channels.events.emit('tech:changed', { player: p.id });
        if (sc.availableCount > 0) this.eva(p, EvaLine.NewConstructionOptions);
      } else if (available < sc.availableCount) {
        this.channels.events.emit('tech:changed', { player: p.id });
      }
      sc.availableCount = available;
    }
    this.techDirty = false;
  }

  /**
   * Catalog entry for a live building slot. Three routes, cheapest first:
   * our own stamp, the real def table, then the scenario's content key.
   */
  private entryForSlot(i: number): BuildEntry | null {
    const stamped = this.entryOfEntity.getAt(i);
    if (stamped >= 0) return this.catalog.at(stamped);
    // -2 is a remembered miss: a prop, a civilian structure, anything this
    // catalog has no opinion about. Re-running the string lookup for those
    // every tick is exactly the kind of quiet cost that never shows up in a
    // profile until there are 200 of them.
    if (stamped === MISS) return null;

    const st = this.world.store;
    const defId = st.defId[i];
    if (defId >= 0) {
      const byDef = this.catalog.fromDefId(defId, st.kind[i] === EntityKind.Building);
      if (byDef !== null) {
        this.entryOfEntity.setAt(i, byDef.index);
        return byDef;
      }
    }
    const key = entityKeyOf(st.handleOf(i));
    if (key !== '') {
      const byKey = this.catalog.byKey(key);
      if (byKey !== null) {
        this.entryOfEntity.setAt(i, byKey.index);
        return byKey;
      }
    }
    this.entryOfEntity.setAt(i, MISS);
    return null;
  }

  /**
   * The catalog entry behind a queued item.
   *
   * Items WE queue carry a catalog index. Items pushed in from outside — the
   * `?shot=placement` fixture stages one directly — carry a real def index, or
   * -1 when no def table exists. All three are resolved here, preferring our
   * own convention, then the def table, then the scenario's published key.
   */
  private resolveQueueEntry(item: ProductionItem): BuildEntry | null {
    const resolved = this.catalog.resolve(item.defId, item.isBuilding);
    if (resolved !== null) return resolved;
    if (item.isBuilding) {
      const key = activeScenario()?.placement?.key;
      if (key !== undefined) return this.catalog.byKey(key);
    }
    return null;
  }

  /* ======================================================================
   * 5d. CONSTRUCTION
   * ====================================================================== */

  private advanceConstruction(s: SimContext): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Building];
    const count = st.byKindCount[EntityKind.Building];
    const rate = s.dt / Math.max(0.05, CONSTRUCTION_RISE_SECONDS);

    for (let a = 0; a < count; a++) {
      const i = list[a];
      const flags = st.flags[i];
      if ((flags & EntityFlag.UnderConstruction) === 0) continue;
      if ((flags & EntityFlag.PendingDestroy) !== 0) continue;

      const next = st.buildProgress[i] + rate;
      if (next < 1) {
        st.buildProgress[i] = next;
        // HP ramps with the rise, so a structure caught half-built is soft.
        const f = PRODUCTION.buildingStartHpFrac;
        const target = st.maxHp[i] * (f + (1 - f) * next);
        if (st.hp[i] < target) st.hp[i] = target;
        continue;
      }

      st.buildProgress[i] = 1;
      st.flags[i] = flags & ~EntityFlag.UnderConstruction;
      st.state[i] = UnitState.Idle;
      st.hp[i] = st.maxHp[i];
      this.onBuildingCompleted(i);
    }
  }

  private onBuildingCompleted(i: number): void {
    const st = this.world.store;
    const id = st.handleOf(i);
    const owner = st.owner[i] as PlayerId;
    const p = this.world.players[owner as number];
    const entry = this.entryForSlot(i);

    if (p !== undefined && entry !== null) {
      p.storageMax += entry.storage;
      p.stats.buildingsBuilt++;
      if (entry.defId >= 0 && entry.defId < p.buildingCount.length) p.buildingCount[entry.defId]++;
      // Give the fresh factory a rally flag so its first unit has somewhere to
      // go before the player ever right-clicks.
      if (entry.producesTabs.length > 0) this.defaultRally(p, i, entry);
    }
    this.techDirty = true;

    const ev = this.channels.events.payload('building:completed');
    ev.id = id;
    ev.defId = entry?.publicId ?? -1;
    ev.player = owner;
    ev.x = st.posX[i];
    ev.z = st.posZ[i];
    this.channels.events.emitPooled('building:completed');

    if (p !== undefined) {
      this.eva(p, EvaLine.ConstructionComplete);
      this.world.vfx.play(FxKind.BuildComplete, st.posX[i], st.posY[i], st.posZ[i], 0, 1, 0, 1);
    }

    if (p !== undefined && entry !== null && entry.shipsWith !== '') {
      this.deliverBundledUnit(p, i, entry);
    }
  }

  /**
   * Hand over the unit a structure "ships with" — in practice, the refinery's
   * harvester. See `BuildEntry.shipsWith` for why this exists.
   *
   * IT IS A GIFT, NOT A PURCHASE: no charge, no queue slot, no build time, and
   * no factory needed. A refinery is the only building in the game that is
   * useless on its own, and the harvester is the thing that makes the economy
   * start at all — under the MCV opening there is no scenario builder placing
   * one for you.
   *
   * DELIBERATELY NOT GATED ON "is this your first refinery". Every refinery
   * ships one, which is both the C&C rule and the rule the blurb states. It is
   * also self-limiting: at 2000 credits a refinery is a worse way to buy a
   * 1000-1400 credit harvester than buying the harvester.
   *
   * Deterministic: `findEgressSpot` walks a fixed ring order and nothing here
   * touches the RNG or a clock. Silently does nothing if there is nowhere to
   * put it — a refinery walled in on all sides is the player's problem, and a
   * harvester spawned inside a cliff would be worse.
   */
  private deliverBundledUnit(p: PlayerState, i: number, entry: BuildEntry): void {
    const unit = this.catalog.byKey(entry.shipsWith);
    if (unit === null || unit.kind !== BuildKind.Unit) return;

    const st = this.world.store;
    const yaw = st.yaw[i];
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ex = entry.exitX;
    const ez = entry.exitZ;
    const exitX = st.posX[i] + ex * cos + ez * sin;
    const exitZ = st.posZ[i] + ez * cos - ex * sin;

    const fb = FALLBACK_UNITS[unit.key];
    const def: UnitDef | undefined =
      unit.defId >= 0 ? this.bindingTables?.units[unit.defId] : undefined;
    const radius = def?.radius ?? (fb === undefined ? 2 : Math.max(fb.width, fb.length) * 0.45);
    const loco = def?.locomotor ?? fb?.locomotor ?? Locomotor.Wheel;

    if (!this.findEgressSpot(exitX, exitZ, radius, loco, spot)) return;
    if (this.spawnUnit(p, unit, spot[0], spot[1], yaw) === NONE) return;
    p.stats.unitsBuilt++;
  }

  /** Release nav cells and cached economy when a structure leaves the world. */
  private onBuildingRemoved(id: EntityId, owner: PlayerId): void {
    const st = this.world.store;
    const i = st.index(id);
    if (i < 0) return;
    const fw = st.footprintW[i];
    const fh = st.footprintH[i];
    if (fw > 0) {
      footprintOriginCell(st.posX[i], st.posZ[i], fw, fh, cellScratch);
      this.world.terrain.clearOccupied(cellScratch[0], cellScratch[1], fw, fh);
    }
    const p = this.world.players[owner as number];
    const entry = this.entryForSlot(i);
    if (p !== undefined && entry !== null) {
      p.storageMax = Math.max(0, p.storageMax - entry.storage);
      p.rallyX.delete(id as number);
      p.rallyZ.delete(id as number);
      if (entry.defId >= 0 && entry.defId < p.buildingCount.length) {
        p.buildingCount[entry.defId] = Math.max(0, p.buildingCount[entry.defId] - 1);
      }
    }
    this.techDirty = true;
  }

  /* ======================================================================
   * 5e. INTENT APPLICATION
   * ====================================================================== */

  private push(
    kind: IntentKind, player: PlayerId, tab: BuildTab,
    defId: number, arg: number, x: number, z: number, target: number,
  ): void {
    if (this.intentCount >= INTENT_CAPACITY) return;
    const it = this.intents[this.intentCount++];
    it.kind = kind;
    it.player = player as number;
    it.tab = tab;
    it.defId = defId;
    it.arg = arg;
    it.x = x;
    it.z = z;
    it.target = target;
  }

  private drainIntents(): void {
    const n = this.intentCount;
    for (let i = 0; i < n; i++) {
      const it = this.intents[i];
      const p = this.world.players[it.player];
      if (p === undefined) continue;
      switch (it.kind) {
        case IntentKind.Enqueue: this.applyEnqueue(p, it.defId, it.arg); break;
        case IntentKind.Cancel: {
          const entry = this.catalog.at(it.defId);
          if (entry !== null) this.queues.cancel(p, it.tab, entry.publicId, it.arg);
          break;
        }
        case IntentKind.Pause: this.queues.setPaused(p, it.tab, it.arg !== 0); break;
        // `arg` carries the facing for a Place; it is unused by that intent
        // otherwise, and the struct is pooled and fixed-shape on purpose.
        case IntentKind.Place: this.applyPlace(p, it.defId, it.x, it.z, it.arg); break;
        case IntentKind.Rally: this.applyRally(p, it.target as EntityId, it.x, it.z); break;
        case IntentKind.Primary: this.applyPrimary(p, it.target as EntityId); break;
        case IntentKind.Sell: this.applySell(p, it.target as EntityId); break;
      }
    }
    this.intentCount = 0;
  }

  /**
   * Drain whatever is still on the CommandBus at Phase.Production.
   *
   * `src/input/Commands.ts` drains at Phase.Command, applies Order/SetRally and
   * RE-ISSUES everything else onto the bus, so production commands are still
   * sitting there when we get here. If no Phase.Command consumer exists at all,
   * they are here for the same reason. Either way taking them is right, and
   * anything we do not recognise was going nowhere regardless.
   *
   * A module that wants to own the drain outright should call
   * `production().handleCommand(cmd)` for each command instead of re-issuing.
   */
  private drainCommands(): void {
    const bus = this.channels.commands;
    if (bus.pending === 0) return;
    if (!this.commandFallbackLogged) {
      this.commandFallbackLogged = true;
      console.info('[production] draining leftover commands at Phase.Production');
    }
    this.commandFallback = true;
    bus.drain((cmd) => { this.handleCommand(cmd); });
  }

  private applyEnqueue(p: PlayerState, index: number, count: number): void {
    const entry = this.catalog.at(index);
    if (entry === null) return;
    const avail = this.availabilityOf(p.id, entry, availScratch);
    if (!avail.ok) return;
    // Clicking a cameo you cannot afford still queues it — that is C&C, and it
    // is how you line up an army while the harvesters catch up. It does earn
    // the EVA line, which is what VISUAL_DNA §3 asks for ("cameo click over
    // budget OR production stalls on funds").
    if (p.credits < entry.cost) this.evaFunds(p);
    // Shift-click queues five. `availabilityOf` answered "you may have ONE
    // more", not "you may have five more", so a capped entry has to clamp here
    // as well — otherwise the single gate above passes and five commanders go
    // onto the line behind it.
    let n = count;
    if (entry.maxAlive > 0) {
      const inHand = this.aliveOf(p.id, entry.defId)
        + this.queues.countOf(p, entry.tab, entry.publicId, entry.kind === BuildKind.Building);
      n = Math.min(n, entry.maxAlive - inHand);
      if (n <= 0) return;
    }
    this.queues.enqueue(p, entry.tab, entry.publicId, entry.kind === BuildKind.Building, n);
  }

  private applyRally(p: PlayerState, factory: EntityId, x: number, z: number): void {
    const st = this.world.store;
    const i = st.index(factory);
    if (i < 0 || st.kind[i] !== EntityKind.Building) return;
    if (st.owner[i] !== (p.id as number)) return;
    // `clampWorld(_, 1)` is inside `snapRallyClear`.
    snapRallyClear(this.world, x, z, rallySnap);
    p.rallyX.set(factory as number, rallySnap[0]);
    p.rallyZ.set(factory as number, rallySnap[1]);
  }

  private applyPrimary(p: PlayerState, factory: EntityId): void {
    const st = this.world.store;
    const i = st.index(factory);
    if (i < 0 || st.kind[i] !== EntityKind.Building) return;
    if (st.owner[i] !== (p.id as number)) return;
    const entry = this.entryForSlot(i);
    if (entry === null || entry.producesTabs.length === 0) return;

    // Clear the flag on every other factory that services any of the same tabs.
    const list = st.byKind[EntityKind.Building];
    const count = st.byKindCount[EntityKind.Building];
    for (let a = 0; a < count; a++) {
      const j = list[a];
      if (j === i) continue;
      if (st.owner[j] !== (p.id as number)) continue;
      const other = this.entryForSlot(j);
      if (other === null) continue;
      let shares = false;
      for (let t = 0; t < other.producesTabs.length && !shares; t++) {
        for (let u = 0; u < entry.producesTabs.length; u++) {
          if (other.producesTabs[t] === entry.producesTabs[u]) { shares = true; break; }
        }
      }
      if (shares) st.flags[j] &= ~EntityFlag.PrimaryFactory;
    }
    st.flags[i] |= EntityFlag.PrimaryFactory;
  }

  private applySell(p: PlayerState, building: EntityId): void {
    const st = this.world.store;
    const i = st.index(building);
    if (i < 0 || st.kind[i] !== EntityKind.Building) return;
    if (st.owner[i] !== (p.id as number)) return;
    if ((st.flags[i] & EntityFlag.Sellable) === 0) return;

    const entry = this.entryForSlot(i);

    // THE LAST-WAY-OUT GUARD.
    //
    // C&C lets you sell everything and then lose, and that is defensible when
    // losing is a thing the game actually says. Here it was not: `applySell`
    // had no notion of "last", `Shell.pollOutcome` declares defeat only at zero
    // living assets, and a player who sold their only Construction Yard while
    // owning a harvester was therefore neither able to act nor able to finish.
    // One misclick on a zero-confirmation, instantaneous, irreversible button
    // ended the session with no message of any kind.
    //
    // So this refuses exactly one sell: the one that leaves the player with no
    // structure that produces anything AND no construction vehicle to unpack
    // into one. That is not a strategic choice being taken away — the refund
    // buys nothing, because there is nothing left to spend it on. Every sell a
    // player might actually want still goes through, including selling the yard
    // while a War Factory stands and the classic sell-the-yard-you-already-have
    // -an-MCV-for play.
    //
    // It is enforced HERE, in the sim, so the AI is bound by the identical rule
    // through the identical `channels.command` path. (It never sells today; if
    // it learns to, it cannot learn to sell itself into a coma.)
    if (this.sellWouldStrand(p, i)) {
      this.refuseSell(p, entry?.name ?? 'that structure');
      return;
    }
    // A half-built structure refunds against what it is worth so far, not what
    // it will be worth. Otherwise "place, sell, repeat" prints money.
    const worth = (entry?.cost ?? 0) * (st.buildProgress[i] >= 1 ? 1 : st.buildProgress[i]);
    const refund = Math.round(worth * SELL_REFUND);

    st.state[i] = UnitState.Selling;
    this.grant(p, refund);
    this.emitCredits(p, refund, CreditReason.Sell);

    const ev = this.channels.events.payload('building:sold');
    ev.id = building;
    ev.defId = entry?.publicId ?? -1;
    ev.player = p.id;
    ev.refund = refund;
    this.channels.events.emitPooled('building:sold');

    this.onBuildingRemoved(building, p.id);
    // Forget the entry BEFORE markDead so the `entity:killed` listener that
    // combat will fire for the same structure cannot subtract its storage a
    // second time.
    this.entryOfEntity.setAt(i, MISS);
    this.world.vfx.play(FxKind.SellPuff, st.posX[i], st.posY[i], st.posZ[i], 0, 1, 0, 1);
    st.markDead(building);
    p.stats.buildingsLost++;
  }

  /**
   * Would selling the structure in `slot` TAKE AWAY this player's last way to
   * build?
   *
   * Two surveys, and the first one matters as much as the second. A player who
   * already cannot build — one Power Plant left standing after the yard was
   * bombed — is not protected by refusing their sell; they are just told no for
   * no reason, and the refund is the only thing left that is worth anything to
   * them. So the guard fires ONLY on the transition: could build, then could
   * not. (`tests/features.spec.ts`'s sell-survivors case is exactly that world,
   * and it is right to keep passing.)
   *
   * The second survey is taken against the world MINUS the structure, which is
   * the only version of the question worth asking — at the moment of the check
   * the yard is obviously still standing.
   *
   * `isProducer` is answered from THIS service's catalog rather than the module
   * singleton, because `setProduction()` may never have been called (headless
   * tests, the `?shot=` harness) and the default probe would then judge every
   * building of ours to be a non-producer and refuse every sell in the game.
   */
  private sellWouldStrand(p: PlayerState, slot: number): boolean {
    const probes: ViabilityProbes = { isProducer: this.isProducerProbe };
    surveyViability(this.world, p.id, this.viability, probes);
    if (!canRebuild(this.viability)) return false;

    const after: ViabilityProbes = {
      ignore: this.world.store.handleOf(slot),
      isProducer: this.isProducerProbe,
    };
    surveyViability(this.world, p.id, this.viability, after);
    return !canRebuild(this.viability);
  }

  /** `Viability`'s producer test, answered from the catalog we already hold. */
  private readonly isProducerProbe = (_world: World, slot: number): boolean => {
    const st = this.world.store;
    if ((st.flags[slot] & (EntityFlag.IsBuilder | EntityFlag.IsFactory)) !== 0) return true;
    const entry = this.entryForSlot(slot);
    return entry !== null && entry.producesTabs.length > 0;
  };

  /**
   * Say no, and say why.
   *
   * There is no EVA line for this and adding one would mean editing
   * `core/types.ts` and `ui/Hud.ts`, so the refusal goes out on the HUD's public
   * toast api, duck-typed against `globalThis.__vmHud` exactly the way
   * `sim/Superweapons.ts` drives its countdown rows. No HUD (headless, tests,
   * `?shot=`) means no toast and no throw. The console line is unconditional so
   * a bug report always has something to quote.
   */
  private refuseSell(p: PlayerState, name: string): void {
    const local = (p.id as number) === (this.world.localPlayer as number);
    if (local) {
      hudToast()?.toast(
        'warn', 'sell-lastbase', 'Cannot sell',
        `${name} is your last way to build. Selling it would end the match.`,
      );
    }
    const sc = this.scratch[p.id as number];
    if (sc !== undefined) {
      if (this.world.time - sc.lastSellRefusal < PRODUCTION_SELL_REFUSAL_LOG_SECONDS) return;
      sc.lastSellRefusal = this.world.time;
    }
    console.info(
      `[production] sell refused for player ${p.id as number}: "${name}" is their last `
      + 'structure that can produce, and they hold no construction vehicle',
    );
  }

  /* ======================================================================
   * 5f. PLACEMENT
   * ====================================================================== */

  /** The ready structure a player is holding, or null. */
  pendingStructure(player: PlayerId): BuildEntry | null {
    const p = this.world.players[player as number];
    if (p === undefined) return null;
    for (const tab of PLACEABLE_TABS) {
      const head = this.queues.head(p, tab);
      if (head !== null && head.ready && head.isBuilding) return this.resolveQueueEntry(head);
    }
    return null;
  }

  /**
   * The placement the active scenario staged, if any, resolved against this
   * catalog. `?shot=placement` publishes a key and an origin cell and expects
   * the ghost to be sitting exactly there when the shutter opens.
   */
  stagedPlacement(): { entry: BuildEntry; cx: number; cz: number } | null {
    const spec = activeScenario()?.placement;
    if (spec === undefined || spec === null) return null;
    const entry = this.catalog.byKey(spec.key);
    if (entry === null) return null;
    if (this.pendingStructure(this.world.localPlayer) === null) return null;
    return { entry, cx: spec.cx, cz: spec.cz };
  }

  /** Which tab holds the ready structure with this catalog index, or -1. */
  private readyTabOf(p: PlayerState, index: number): BuildTab | -1 {
    for (const tab of PLACEABLE_TABS) {
      const head = this.queues.head(p, tab);
      if (head === null || !head.ready || !head.isBuilding) continue;
      const entry = this.resolveQueueEntry(head);
      if (entry !== null && entry.index === index) return tab;
    }
    return -1;
  }

  /**
   * Re-check and apply a placement. The ghost checked the same thing last
   * frame, but a tank may have parked on the site since, so the authoritative
   * answer is taken HERE, inside the sim, and it is the one that is obeyed.
   */
  private applyPlace(
    p: PlayerState, index: number, cx: number, cz: number, facing: number,
  ): void {
    const entry = this.catalog.at(index);
    if (entry === null || entry.kind !== BuildKind.Building) return;
    const tab = this.readyTabOf(p, index);
    if (tab === -1) {
      this.notifyPlacement(
        PlacementPhase.Rejected, p.id, entry, cx, cz, false, 'Not ready', NONE, facing,
      );
      return;
    }

    // Checked at the SAME facing the ghost was showing, and spawned at the same
    // one again below. Three places have to agree about a swapped footprint —
    // the rule, the occupancy stamp and the model's yaw — and this is where two
    // of the three are decided.
    const report = evaluatePlacement(this.world, p.id, entry, cx, cz, placementReport, null, facing);
    if (!report.ok) {
      this.notifyPlacement(
        PlacementPhase.Rejected, p.id, entry, cx, cz, false, report.reason, NONE, facing,
      );
      this.eva(p, EvaLine.CannotDeployHere);
      return;
    }

    const id = this.spawnBuilding(p, entry, cx, cz, 0, facingYaw(facing));
    if (id === NONE) {
      this.notifyPlacement(
        PlacementPhase.Rejected, p.id, entry, cx, cz, false, 'World is full', NONE, facing,
      );
      return;
    }

    this.queues.completeHead(p, tab);
    this.notifyPlacement(PlacementPhase.Committed, p.id, entry, cx, cz, true, '', id, facing);
  }

  /**
   * Plant a structure. `buildProgress` 0 means it rises; 1 means it is already
   * finished (an MCV unfolding, a scenario fixture).
   *
   * `yaw` is the ONLY input that decides the world footprint. At a quarter or
   * three-quarter turn the rectangle swaps — a 3x2 War Factory takes 2x3 cells —
   * and every column and grid written below is derived from the swapped pair, so
   * `store.footprintW/H`, `terrain.markOccupied`, the concrete pad, the picker's
   * half-extents and the nav clamp cannot disagree with the model on screen.
   * Callers that already had a yaw (`Relocate.arrive` re-founding a structure at
   * the angle it left at) get the correct footprint for free.
   */
  spawnBuilding(
    p: PlayerState,
    entry: BuildEntry,
    cx: number,
    cz: number,
    buildProgress: number,
    yaw = 0,
  ): EntityId {
    const st = this.world.store;
    const facing = yawToFacing(yaw);
    const fw = facedFootprintW(entry.footprintW, entry.footprintH, facing);
    const fh = facedFootprintH(entry.footprintW, entry.footprintH, facing);
    const px = (cx + fw * 0.5) * CELL;
    const pz = (cz + fh * 0.5) * CELL;
    const py = this.world.terrain.heightAt(px, pz);

    const id = st.alloc(EntityKind.Building, entry.defId, p.id, p.faction, px, py, pz, yaw);
    if (id === NONE) return NONE;
    const i = st.index(id);
    const fb = FALLBACK_BUILDINGS[entry.key];
    const def: BuildingDef | undefined =
      entry.defId >= 0 ? this.bindingTables?.buildings[entry.defId] : undefined;

    const maxHp = def?.maxHp ?? fb.maxHp;
    st.maxHp[i] = maxHp;
    st.hp[i] = buildProgress >= 1 ? maxHp : maxHp * PRODUCTION.buildingStartHpFrac;
    st.armorClass[i] = def?.armor ?? fb.armor;
    st.sight[i] = def?.sight ?? fb.sight;
    st.footprintW[i] = fw;
    st.footprintH[i] = fh;
    st.powerDraw[i] = entry.power;
    st.locomotor[i] = Locomotor.Static;
    st.radius[i] = Math.max(fw, fh) * CELL * 0.5;
    st.weaponIndex[i] = def !== undefined && def.weapons.length > 0 ? def.weapons[0] : -1;
    st.buildProgress[i] = buildProgress;
    st.state[i] = buildProgress < 1 ? UnitState.UnderConstruction : UnitState.Idle;
    st.spawnTick[i] = this.world.tick;

    let flags = st.flags[i] | fb.flags | (def?.flags ?? 0);
    if (def?.hasTurret ?? false) flags |= EntityFlag.HasTurret;
    if (buildProgress < 1) flags |= EntityFlag.UnderConstruction;
    // Only the FIRST factory of a kind claims primary; the fallback table sets
    // the bit unconditionally and a second War Factory must not steal the flag.
    if (entry.producesTabs.length > 0
      && this.factories[(p.id as number) * BUILD_TAB_COUNT + (entry.producesTabs[0] as number)] > 0) {
      flags &= ~EntityFlag.PrimaryFactory;
    }
    st.flags[i] = flags;

    this.entryOfEntity.setAt(i, entry.index);

    // Nav and render must agree about which cells are taken from the instant
    // the foundation is poured, not from when the structure finishes.
    this.world.terrain.markOccupied(cx, cz, fw, fh, id);
    this.stampPad(cx, cz, fw, fh);

    if (entry.power > 0) p.powerProduced += entry.power;
    else p.powerConsumed += -entry.power;
    p.entityCount[EntityKind.Building]++;

    const spawned = this.channels.events.payload('entity:spawned');
    spawned.id = id;
    spawned.kind = EntityKind.Building;
    spawned.defId = entry.publicId;
    spawned.player = p.id;
    spawned.x = px;
    spawned.z = pz;
    this.channels.events.emitPooled('entity:spawned');

    const placed = this.channels.events.payload('building:placed');
    placed.id = id;
    placed.defId = entry.publicId;
    placed.player = p.id;
    placed.cx = cx;
    placed.cz = cz;
    placed.w = fw;
    placed.h = fh;
    this.channels.events.emitPooled('building:placed');

    if (buildProgress >= 1) this.onBuildingCompleted(i);
    else this.techDirty = true;
    return id;
  }

  /**
   * Paint concrete under the footprint.
   *
   * Every RA3 structure sits on a poured pad with a painted border
   * (refs/ra3steam_07.jpg) and the terrain module generates two empty splat
   * layers for exactly this. Duck-typed rather than imported: the port in
   * core/types.ts has no stamp method, and reaching into world/Terrain.ts from
   * src/sim would invert the layering for a cosmetic.
   */
  private stampPad(cx: number, cz: number, w: number, h: number): void {
    const t = this.world.terrain as unknown as Partial<SurfaceStamper>;
    if (typeof t.stampSurface !== 'function' || typeof t.commitSplat !== 'function') return;
    const m = PLACEMENT.padMarginCells;
    for (let z = cz - m; z < cz + h + m; z++) {
      for (let x = cx - m; x < cx + w + m; x++) {
        if (!isInMap(x, z)) continue;
        // Full strength under the structure, half on the painted margin.
        const inside = x >= cx && x < cx + w && z >= cz && z < cz + h;
        t.stampSurface(x, z, PLACEMENT.padSurface, PLACEMENT.padWeight * (inside ? 1 : 0.5));
      }
    }
    t.commitSplat();
  }

  private notifyPlacement(
    phase: PlacementPhase, player: PlayerId, entry: BuildEntry,
    cx: number, cz: number, ok: boolean, reason: string, id: EntityId, facing = 0,
  ): void {
    const f = normaliseFacing(facing);
    const n = this.notice;
    n.phase = phase;
    n.player = player;
    n.defId = entry.publicId;
    n.key = entry.key;
    n.cx = cx;
    n.cz = cz;
    // WORLD-SPACE, so a listener drawing the rectangle draws the one the sim
    // stamped rather than the catalog's unturned pair.
    n.w = facedFootprintW(entry.footprintW, entry.footprintH, f);
    n.h = facedFootprintH(entry.footprintW, entry.footprintH, f);
    n.facing = f;
    n.ok = ok;
    n.reason = reason;
    n.id = id;
    for (let i = 0; i < this.placementListeners.length; i++) this.placementListeners[i](n);
  }

  /** Called by PlacementController so the HUD hears began/moved/cancelled too. */
  publishPlacement(
    phase: PlacementPhase, player: PlayerId, entry: BuildEntry,
    cx: number, cz: number, ok: boolean, reason: string, facing = 0,
  ): void {
    this.notifyPlacement(phase, player, entry, cx, cz, ok, reason, NONE, facing);
  }

  /* ======================================================================
   * 5g. EGRESS — a finished unit leaves the building
   * ====================================================================== */

  private tryEgress(p: PlayerState, tab: BuildTab, item: ProductionItem, s: SimContext): boolean {
    // `item.defId` is a publicId, and it may not even be ours — resolve it the
    // same way everything else that reads a queue item does.
    const entry = this.resolveQueueEntry(item);
    if (entry === null || entry.kind !== BuildKind.Unit) return true; // drop the impossible

    const fi = (p.id as number) * BUILD_TAB_COUNT + (tab as number);
    const slot = this.primaryFactory[fi];
    if (slot < 0) return false;

    const st = this.world.store;
    const factory = st.handleOf(slot);
    const fEntry = this.entryForSlot(slot);
    const yaw = st.yaw[slot];
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ex = fEntry?.exitX ?? 0;
    const ez = fEntry?.exitZ ?? (st.radius[slot] + PRODUCTION.exitClearanceMetres);
    // Rotate the local exit into world space: +Z is forward at yaw 0.
    const exitX = st.posX[slot] + ex * cos + ez * sin;
    const exitZ = st.posZ[slot] + ez * cos - ex * sin;

    const fb = FALLBACK_UNITS[entry.key];
    const def: UnitDef | undefined =
      entry.defId >= 0 ? this.bindingTables?.units[entry.defId] : undefined;
    const radius = def?.radius ?? Math.max(fb.width, fb.length) * 0.45;
    const loco = def?.locomotor ?? fb.locomotor;

    if (!this.findEgressSpot(exitX, exitZ, radius, loco, spot)) return false;

    const id = this.spawnUnit(p, entry, spot[0], spot[1], yaw);
    if (id === NONE) return false;

    // Point it at the rally flag. This is spawn-time initialisation of the
    // order columns, exactly as ScenarioBuilder.spawnUnit does — the unit is
    // handed to the movement layer already knowing where it is going.
    const i = st.index(id);
    const rx = p.rallyX.get(factory as number);
    const rz = p.rallyZ.get(factory as number);
    if (rx !== undefined && rz !== undefined) {
      st.orderKind[i] = OrderKind.Move;
      st.orderX[i] = rx;
      st.orderZ[i] = rz;
      st.state[i] = UnitState.Moving;
      st.guardX[i] = rx;
      st.guardZ[i] = rz;
    }

    p.stats.unitsBuilt++;
    this.eva(p, EvaLine.UnitReady);
    return true;
  }

  /**
   * Spiral outward from the factory door for somewhere the unit fits.
   * Deterministic ring order, so two machines produce the same column.
   *
   * AIRCRAFT DO NOT SEARCH, AND THE REASON IS A BUG THIS LINE USED TO CAUSE.
   *
   * `Terrain.passGrid` packs ONE BIT PER LOCOMOTOR and nothing has ever set
   * bit 5. `core/types.ts` says so at `Locomotor.Air` and calls it correct —
   * "`ITerrain.isPassable(_, _, Air)` is false everywhere and NO AIR CODE PATH
   * ASKS IT". This function was the one that did, and the whole clause was
   * false because of it.
   *
   * The symptom is invisible in every direction a reviewer would look. The
   * queue charges the player, runs to `progress: 1`, sets `ready: true` — and
   * then this returns false forever, `egressRetry` re-arms every
   * `egressRetrySeconds`, and the aircraft never comes out. No error, no
   * warning, no refund, a permanently occupied factory queue. Measured on a
   * live match: 1200 credits taken, `ready` at tick 1377, still sitting there
   * at tick 1802 with the tab blocked behind it.
   *
   * It was NOT introduced by the Vindicator and the MiG. The Kestrel and the
   * Hornet have been unbuildable by exactly this route since `Locomotor.Air`
   * shipped, in both of the factions that were supposed to have an air arm —
   * which is why `tests/air-layer.spec.ts` could assert an end-to-end air layer
   * and be right about every link except the one that hands a player a plane.
   *
   * So the air branch asks the question the rest of the air layer asks.
   * `Flowfield.isPassableClass` answers `isInMap(cx, cz)` for `MoveClass.Air`
   * and nothing else; the ground checks below are all about SHARING SPACE, and
   * an aircraft shares none — `Steering` and `Movement` both skip it in their
   * separation passes, and `Movement` lifts it to `AIR_CRUISE_ALTITUDE` inside
   * a second. Ring 0 is the factory door, so an aircraft lifts off the pad.
   */
  private findEgressSpot(
    x: number, z: number, radius: number, loco: number, out: Float32Array,
  ): boolean {
    const world = this.world;
    const step = CELL;
    if (loco === (Locomotor.Air as number)) {
      const cx = worldToCell(x);
      const cz = worldToCell(z);
      if (!isInMap(cx, cz)) return false;
      out[0] = x;
      out[1] = z;
      return true;
    }
    for (let ring = 0; ring <= PRODUCTION.egressSearchRings; ring++) {
      const cells = ring === 0 ? 1 : ring * 8;
      for (let c = 0; c < cells; c++) {
        let dx = 0, dz = 0;
        if (ring > 0) {
          // Walk the ring perimeter in a fixed order.
          const side = Math.floor(c / (ring * 2));
          const t = c % (ring * 2);
          const a = -ring + t;
          if (side === 0) { dx = a; dz = -ring; }
          else if (side === 1) { dx = ring; dz = a; }
          else if (side === 2) { dx = -a; dz = ring; }
          else { dx = -ring; dz = -a; }
        }
        const px = x + dx * step;
        const pz = z + dz * step;
        const cx = worldToCell(px);
        const cz = worldToCell(pz);
        if (!isInMap(cx, cz)) continue;
        if (!world.terrain.isPassable(cx, cz, loco)) continue;
        if (world.terrain.isOccupied(cx, cz)) continue;
        if (this.blockedByEntity(px, pz, radius + PRODUCTION.egressClearanceMetres)) continue;
        out[0] = px;
        out[1] = pz;
        return true;
      }
    }
    return false;
  }

  private blockedByEntity(x: number, z: number, r: number): boolean {
    const world = this.world;
    const st = world.store;
    const buf = world.queryScratchB;
    const n = world.spatial.queryCircleFat(x, z, r, buf);
    for (let k = 0; k < n; k++) {
      const i = buf[k];
      const flags = st.flags[i];
      if ((flags & EntityFlag.PendingDestroy) !== 0) continue;
      const kind = st.kind[i];
      if (kind === EntityKind.Wreck || kind === EntityKind.Crate) continue;
      if (kind === EntityKind.Prop && (flags & EntityFlag.BlocksNav) === 0) continue;
      return true;
    }
    return false;
  }

  /** Spawn a produced unit. Mirrors ScenarioBuilder.spawnUnit exactly. */
  spawnUnit(p: PlayerState, entry: BuildEntry, x: number, z: number, yaw: number): EntityId {
    const st = this.world.store;
    const fb = FALLBACK_UNITS[entry.key];
    if (fb === undefined) return NONE;
    const def: UnitDef | undefined =
      entry.defId >= 0 ? this.bindingTables?.units[entry.defId] : undefined;

    const px = clampWorld(x, 2);
    const pz = clampWorld(z, 2);
    const py = this.world.terrain.heightAt(px, pz);
    const kind = def?.kind ?? fb.kind;

    const id = st.alloc(kind, entry.defId, p.id, p.faction, px, py, pz, yaw);
    if (id === NONE) return NONE;
    const i = st.index(id);

    const maxHp = def?.maxHp ?? fb.maxHp;
    st.maxHp[i] = maxHp;
    st.hp[i] = maxHp;
    st.armorClass[i] = def?.armor ?? fb.armor;
    st.sight[i] = def?.sight ?? fb.sight;
    st.maxSpeed[i] = def?.maxSpeed ?? fb.maxSpeed;
    st.accel[i] = def?.accel ?? fb.accel;
    st.turnRate[i] = def?.turnRate ?? fb.turnRate;
    st.turretTurnRate[i] = fb.turretTurnRate;
    st.locomotor[i] = def?.locomotor ?? fb.locomotor;
    st.radius[i] = def?.radius ?? Math.max(fb.width, fb.length) * 0.45;
    st.crushLevel[i] = def?.crushLevel ?? fb.crushLevel;
    st.crushableBy[i] = def?.crushableBy ?? fb.crushableBy;
    st.cargoMax[i] = def?.cargoMax ?? fb.cargoMax;
    st.cargo[i] = 0;
    st.weaponIndex[i] = def !== undefined && def.weapons.length > 0 ? def.weapons[0] : -1;
    st.state[i] = UnitState.Idle;
    st.stance[i] = Stance.Aggressive;
    st.spawnTick[i] = this.world.tick;

    let flags = st.flags[i] | fb.flags | (def?.flags ?? 0);
    if ((def?.maxSpeed ?? fb.maxSpeed) > 0) flags |= EntityFlag.CanMove;
    if (def?.hasTurret ?? false) flags |= EntityFlag.HasTurret;
    st.flags[i] = flags;

    st.orderKind[i] = OrderKind.None;
    st.orderX[i] = px;
    st.orderZ[i] = pz;
    st.guardX[i] = px;
    st.guardZ[i] = pz;

    this.entryOfEntity.setAt(i, entry.index);
    if (kind < p.entityCount.length) p.entityCount[kind]++;

    const ev = this.channels.events.payload('entity:spawned');
    ev.id = id;
    ev.kind = kind;
    ev.defId = entry.publicId;
    ev.player = p.id;
    ev.x = px;
    ev.z = pz;
    this.channels.events.emitPooled('entity:spawned');
    return id;
  }

  /** Put a rally flag a short walk in front of a brand new factory. */
  private defaultRally(p: PlayerState, slot: number, entry: BuildEntry): void {
    const st = this.world.store;
    const id = st.handleOf(slot);
    if (p.rallyX.has(id as number)) return;
    const yaw = st.yaw[slot];
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ez = entry.exitZ + PRODUCTION.rallyForwardMetres;
    // Snapped too: the default is placed by geometry alone, so on a tight base
    // it can land inside a NEIGHBOUR's footprint without the player ever
    // touching it.
    snapRallyClear(
      this.world,
      st.posX[slot] + entry.exitX * cos + ez * sin,
      st.posZ[slot] + ez * cos - entry.exitX * sin,
      rallySnap,
    );
    p.rallyX.set(id as number, rallySnap[0]);
    p.rallyZ.set(id as number, rallySnap[1]);
  }

  /* ======================================================================
   * 5h. QueueHooks
   * ====================================================================== */

  info(defId: number, isBuilding: boolean): QueueItemInfo | null {
    return this.catalog.resolve(defId, isBuilding);
  }

  charge(player: PlayerState, amount: number): number {
    const paid = Math.min(amount, Math.max(0, player.credits));
    if (paid <= 0) return 0;
    player.credits -= paid;
    player.stats.creditsSpent += paid;
    this.scratch[player.id as number].creditDelta -= paid;
    return paid;
  }

  refund(player: PlayerState, amount: number): void {
    this.grant(player, amount);
    this.scratch[player.id as number].creditDelta += amount;
  }

  started(player: PlayerState, tab: BuildTab, item: ProductionItem): void {
    const ev = this.channels.events.payload('production:started');
    ev.player = player.id;
    ev.tab = tab;
    ev.defId = item.defId;
    ev.isBuilding = item.isBuilding;
    ev.cost = item.cost;
    this.channels.events.emitPooled('production:started');
  }

  progressed(player: PlayerState, tab: BuildTab, item: ProductionItem): void {
    const ev = this.channels.events.payload('production:progress');
    ev.player = player.id;
    ev.tab = tab;
    ev.defId = item.defId;
    ev.progress = item.progress;
    this.channels.events.emitPooled('production:progress');
  }

  ready(player: PlayerState, tab: BuildTab, item: ProductionItem): void {
    const ev = this.channels.events.payload('production:ready');
    ev.player = player.id;
    ev.tab = tab;
    ev.defId = item.defId;
    ev.isBuilding = item.isBuilding;
    this.channels.events.emitPooled('production:ready');
    this.snapshot.tabAlert[tab as number] = true;
    // A finished vehicle gets its EVA line when it actually drives out; a
    // finished structure gets one now, because "ready" is the whole point.
    if (item.isBuilding) this.eva(player, EvaLine.ConstructionComplete);
  }

  cancelled(player: PlayerState, tab: BuildTab, item: ProductionItem, refunded: number): void {
    const ev = this.channels.events.payload('production:cancelled');
    ev.player = player.id;
    ev.tab = tab;
    ev.defId = item.defId;
    ev.refund = refunded;
    this.channels.events.emitPooled('production:cancelled');
  }

  holdChanged(player: PlayerState, tab: BuildTab, reason: HoldReason): void {
    if (reason === HoldReason.Funds) this.evaFunds(player);
  }

  /* ======================================================================
   * 5i. HUD SNAPSHOT
   * ====================================================================== */

  private refreshSnapshot(s: SimContext): void {
    const world = this.world;
    const p = world.players[world.localPlayer as number];
    if (p === undefined) return;
    const snap = this.snapshot;
    const sc = this.scratch[world.localPlayer as number];

    snap.credits = p.credits;
    snap.creditsDisplay = sc.creditsDisplay;
    snap.powerProduced = p.powerProduced;
    snap.powerConsumed = p.powerConsumed;
    snap.brownout = p.powerConsumed > p.powerProduced;
    snap.hasRadar = p.hasRadar || this.hasStructure(p.id, 'radar');
    snap.selectionCount = world.selection.count;
    snap.selectionPrimary = world.selection.count > 0
      ? (world.selection.ids[0] as EntityId) : NONE;
    snap.gameTimeSec = s.time;

    if (this.cameoFaction !== p.faction) this.rebuildCameos(p.faction);

    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const tab = t as BuildTab;
      const list = snap.cameos[t];
      const roster = this.catalog.roster(p.faction, tab);
      for (let c = 0; c < list.length; c++) {
        const cameo = list[c];
        const entry = roster[c];
        const head = this.queues.head(p, tab);
        const isHead = head !== null && head.defId === entry.publicId;
        cameo.progress = isHead ? head!.progress : 0;
        cameo.queued = this.queues.countOf(p, tab, entry.publicId, entry.kind === BuildKind.Building);
        cameo.ready = isHead && head!.ready;
        cameo.onHold = isHead && head!.onHold;
        const avail = this.availabilityOf(p.id, entry, availScratch);
        cameo.available = avail.ok;
        cameo.reason = avail.ok
          ? (p.credits < entry.cost ? 'Insufficient funds' : '')
          : avail.reason;
        // Buildings: the sim already keeps an exact per-def tally, so use it
        // rather than adding a second source of truth. Units: bucketed once per
        // snapshot above.
        //
        // NOTE THE TWO DIFFERENT IDS, because getting this wrong is silent. A
        // unit's `publicId` is `defId + UNIT_PUBLIC_ID_BASE` (4096) so it cannot
        // collide with the building sharing its def index, while `ownedByDef` is
        // bucketed by the RAW `store.defId`. Indexing it by `publicId` put every
        // lookup past the end of a 256-entry array, so every unit badge read
        // zero and only buildings ever worked. Buildings are unoffset, hence
        // `publicId` is right on that branch and `defId` on this one.
        cameo.owned = entry.kind === BuildKind.Building
          ? (entry.publicId >= 0 && entry.publicId < p.buildingCount.length
            ? p.buildingCount[entry.publicId] : 0)
          : this.aliveOf(p.id, entry.defId);
      }
    }
  }

  /**
   * Completed mobile units, bucketed by (player, def id). PLAYER-MAJOR.
   *
   * This started life as a 256-entry scratch for the local player's sidebar
   * badges. It is now also what enforces `BuildEntry.maxAlive`, and that
   * second reader is why it had to grow a player axis: `availabilityOf` is
   * asked the same question by the HUD, by the AI and by the dequeue check,
   * for every player, and a count that only ever described the local one would
   * have capped the human's commander and let all three AIs field a squad of
   * them. Nothing would have logged an error.
   */
  private readonly aliveByPlayerDef = new Int32Array(MAX_PLAYERS * UNIT_DEF_SLOTS);

  /** Alive, completed units of one def that one player owns. */
  aliveOf(player: PlayerId, defId: number): number {
    if (defId < 0 || defId >= UNIT_DEF_SLOTS) return 0;
    const pi = player as number;
    if (pi < 0 || pi >= MAX_PLAYERS) return 0;
    return this.aliveByPlayerDef[pi * UNIT_DEF_SLOTS + defId];
  }

  /**
   * Recount every player's mobile units by def id. Once per tick, from `tick`,
   * BEFORE the queues advance — so a commander that died this tick frees its
   * slot on the same tick the player tries to rebuild.
   *
   * ONE pass over the two mobile kind lists, not one per cameo: the grid is
   * ~60 cells across four tabs and a per-cell scan would walk the same arrays
   * sixty times a frame.
   *
   * `UnderConstruction` is excluded deliberately: a unit still on the line is
   * already shown by `queued` and the progress bar, and counting it here too
   * would tell the player they own something that does not exist yet. The cap
   * adds the queued count back on separately — see `availabilityOf`.
   */
  private unitCensus(world: World): void {
    const alive = this.aliveByPlayerDef;
    alive.fill(0);
    const st = world.store;
    // MODULE CONSTANT, not an inline literal. `[a, b]` here allocates a fresh
    // array every snapshot, which is a per-frame allocation and exactly what
    // `tests/perf-hud.spec.ts` "allocates nothing per frame" exists to catch —
    // it did, in CI, on the first push.
    for (let k = 0; k < OWNED_COUNT_KINDS.length; k++) {
      const kind = OWNED_COUNT_KINDS[k];
      const list = st.byKind[kind];
      const n = st.byKindCount[kind];
      for (let j = 0; j < n; j++) {
        const e = list[j];
        if ((st.flags[e] & EntityFlag.UnderConstruction) !== 0) continue;
        const d = st.defId[e];
        if (d < 0 || d >= UNIT_DEF_SLOTS) continue;
        const pi = st.owner[e];
        if (pi >= MAX_PLAYERS) continue;
        alive[pi * UNIT_DEF_SLOTS + d]++;
      }
    }
  }

  /** Rebuild the pooled cameo objects for a faction. Cold path. */
  private rebuildCameos(faction: Faction): void {
    this.cameoFaction = faction;
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const roster = this.catalog.roster(faction, t as BuildTab);
      const pool = this.cameoPool[t];
      while (pool.length < roster.length) {
        pool.push({
          defId: -1, isBuilding: false, key: '', name: '', cost: 0,
          progress: 0, queued: 0, ready: false, onHold: false, available: false, reason: '', owned: 0,
        });
      }
      const list: HudCameo[] = [];
      for (let i = 0; i < roster.length; i++) {
        const cameo = pool[i];
        const entry = roster[i];
        cameo.defId = entry.publicId;
        cameo.isBuilding = entry.kind === BuildKind.Building;
        cameo.key = entry.key;
        cameo.name = entry.name;
        cameo.cost = entry.cost;
        list.push(cameo);
      }
      this.snapshot.cameos[t] = list;
    }
  }

  /** Clear the "something finished" badge on a tab. Called by the HUD. */
  clearTabAlert(tab: BuildTab): void {
    this.snapshot.tabAlert[tab as number] = false;
  }

  /* ======================================================================
   * 5j. small helpers
   * ====================================================================== */

  private grant(p: PlayerState, amount: number): void {
    if (amount <= 0) return;
    p.credits += amount;
  }

  private emitCredits(p: PlayerState, delta: number, reason: CreditReason): void {
    const ev = this.channels.events.payload('economy:credits');
    ev.player = p.id;
    ev.credits = p.credits;
    ev.delta = delta;
    ev.storage = p.credits;
    ev.storageMax = p.storageMax;
    ev.reason = reason;
    this.channels.events.emitPooled('economy:credits');
  }

  private evaFunds(p: PlayerState): void {
    const sc = this.scratch[p.id as number];
    if (this.world.time - sc.lastFundsEva < PRODUCTION.evaInsufficientFundsSeconds) return;
    sc.lastFundsEva = this.world.time;
    this.eva(p, EvaLine.InsufficientFunds);
  }

  private eva(p: PlayerState, line: EvaLine): void {
    this.world.audio.eva(p.id, line);
    this.channels.events.emit('eva:line', { player: p.id, line });
  }

  /** Diagnostics for the F3 overlay and the boot log. */
  stats(): string {
    const p = this.world.players[this.world.localPlayer as number];
    if (p === undefined) return 'production: no local player';
    const parts: string[] = [];
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const q = p.queues[t];
      parts.push(`${TAB_NAMES[t]} ${q.items.length}/${q.factoryCount}f`);
    }
    return `production: ${parts.join(' ')} credits ${Math.round(p.credits)}`;
  }

  dispose(): void {
    this.placementListeners.length = 0;
    this.intentCount = 0;
  }
}

/** Duck-typed terrain extension — see `stampPad`. */
interface SurfaceStamper {
  stampSurface(cx: number, cz: number, layer: number, weight: number): void;
  commitSplat(): void;
}

/** Duck-typed slice of the HUD's public toast api. See `refuseSell`. */
interface HudToastSink {
  toast(kind: string, key: string, title: string, detail?: string): void;
}

/** Never log the same refusal more often than this. Sim seconds. */
const PRODUCTION_SELL_REFUSAL_LOG_SECONDS = 3;

function hudToast(): HudToastSink | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const h = g.__vmHud as Partial<HudToastSink> | undefined;
  if (h === undefined || h === null) return null;
  return typeof h.toast === 'function' ? (h as HudToastSink) : null;
}

const MISS = -2;

/** Structures and defences are placed; infantry and vehicles walk out. */
function tabIsStructural(tab: BuildTab): boolean {
  return tab === BuildTab.Structures || tab === BuildTab.Defense;
}
const TAB_NAMES = ['STR', 'DEF', 'INF', 'VEH'];
const PLACEABLE_TABS: readonly BuildTab[] = [BuildTab.Structures, BuildTab.Defense];
const cellScratch = new Int32Array(2);
const spot = new Float32Array(2);
const availScratch: AvailabilityResult = { ok: false, reason: '', capped: false };
/** Rally snap output. Module scope so no rally write allocates. */
const rallySnap = new Float64Array(2);

/* ==========================================================================
 * 6. MODULE SINGLETON
 * ========================================================================== */

let active: ProductionService | null = null;

/** Publish the live service. production.system.ts calls this at init. */
export function setProduction(next: ProductionService | null): void {
  active = next;
}

/** The live service, or null before init / after dispose. */
export function production(): ProductionService | null {
  return active;
}

/**
 * Build the catalog. Awaits the def-table glob, which is why init is async.
 * Never throws: a data module that explodes degrades to fallback stats.
 */
export async function createCatalog(): Promise<{ catalog: ProductionCatalog; binding: DefBinding }> {
  let binding: DefBinding;
  try {
    binding = await resolveDefBinding();
  } catch (err) {
    console.warn(`[production] def binding failed, using fallback content: ${String(err)}`);
    binding = { tables: null, unitId: {}, buildingId: {} };
  }
  return { catalog: new ProductionCatalog(binding), binding };
}

/** Exposed for tests and the console. */
export { CONTENT as PRODUCTION_CONTENT };
