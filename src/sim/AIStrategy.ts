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
 * THREE THINGS LIVE HERE
 * ----------------------
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
 * DETERMINISM: nothing in this file reads a clock or a global RNG. `pickUnit`
 * takes the `IRng` the sim step handed us.
 * ============================================================================
 */

import {
  AI_SKILL, AI_THREAT_CLASS_COUNT, BUILDING_DIMENSIONS, SIM_HZ,
  AI_DIFFICULTY, AI_PERSONALITY,
} from '../core/config';
import { BuildTab, EntityKind, Faction } from '../core/types';
import type { ArmorClass, DefTables, UnitDef, BuildingDef } from '../core/types';

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
  /** Captures and repairs. */
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
}
export const BUILD_ROLE_COUNT = 18;

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
  'armor', 'siege', 'support', 'mcv', 'unknown',
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
}

/** Shorthand for an all-zero answer vector (structures, economy). */
const NO_ANSWER: readonly number[] = [0, 0, 0, 0, 0];

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
    prereqs, role, faction, answers, weight: 0,
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
): CatalogEntry {
  return {
    key, defId: -1, isBuilding: false,
    tab: kind === EntityKind.Infantry ? BuildTab.Infantry : BuildTab.Vehicles,
    cost, buildTimeSec: Math.max(2, cost / 90),
    power: 0, footprintW: 0, footprintH: 0,
    prereqs, role, faction, answers, weight,
  };
}

const B = BUILDING_DIMENSIONS;

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
  structure('oreSilo',    BuildRole.Storage,     150, -10, B.oreSilo,    ['refinery']),

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
  fighter('mcv', BuildRole.Mcv, EntityKind.Vehicle, 2000, ['battleLab'],
    Faction.Neutral, NO_ANSWER, 0),
  fighter('engineer', BuildRole.Support, EntityKind.Infantry, 500, ['barracks'],
    Faction.Neutral, NO_ANSWER, 0),

  /* -- Allied army -------------------------------------------------------- */
  fighter('gi', BuildRole.Infantry, EntityKind.Infantry, 200, ['barracks'],
    Faction.Allies, [1.3, 0.7, 0.2, 0.4, 0.9], 3),
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
  fighter('rhino', BuildRole.Armor, EntityKind.Vehicle, 900, ['warFactory'],
    Faction.Soviets, [0.8, 1.5, 1.5, 1.2, 0], 5),
  fighter('apocalypse', BuildRole.Siege, EntityKind.Vehicle, 1750, ['warFactory', 'battleLab'],
    Faction.Soviets, [1.0, 1.6, 1.9, 1.5, 1.2], 2),

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
  fighter('mrdCarryall', BuildRole.Mcv, EntityKind.Vehicle, 3000, ['mrdReliquary'],
    FACTION_MERIDIAN, NO_ANSWER, 0),
  fighter('mrdArtificer', BuildRole.Support, EntityKind.Infantry, 500, ['mrdChapterhouse'],
    FACTION_MERIDIAN, NO_ANSWER, 0),

  // Wayfarers are a screen, not a line: cheap, quick, and the only thing in the
  // army that answers massed infantry at all until a Glaive Post is up.
  fighter('mrdWayfarer', BuildRole.Infantry, EntityKind.Infantry, 175, ['mrdChapterhouse'],
    FACTION_MERIDIAN, [1.25, 0.6, 0.2, 0.35, 0.8], 3),
  fighter('mrdLancer', BuildRole.Skirmisher, EntityKind.Infantry, 450, ['mrdChapterhouse', 'mrdOculus'],
    FACTION_MERIDIAN, [0.5, 1.3, 1.4, 0.9, 1.6], 2),
  fighter('mrdSkiff', BuildRole.Skirmisher, EntityKind.Vehicle, 550, ['mrdForgeyard'],
    FACTION_MERIDIAN, [1.2, 1.4, 0.5, 0.4, 1.2], 3),
  fighter('mrdSolarch', BuildRole.Armor, EntityKind.Vehicle, 800, ['mrdForgeyard'],
    FACTION_MERIDIAN, [0.7, 1.4, 1.3, 1.0, 0], 5),
  fighter('mrdZenith', BuildRole.Siege, EntityKind.Vehicle, 1500, ['mrdForgeyard', 'mrdReliquary'],
    FACTION_MERIDIAN, [1.3, 1.1, 1.4, 1.9, 0], 2),
  fighter('mrdKestrel', BuildRole.Siege, EntityKind.Vehicle, 1100, ['mrdForgeyard', 'mrdOculus'],
    FACTION_MERIDIAN, [1.0, 1.5, 1.2, 1.3, 0], 1),
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

/** Same idea for the answer vectors and army weights. */
const DOCTRINE_BY_KEY: Readonly<Record<string, { answers: readonly number[]; weight: number }>> = (() => {
  const m: Record<string, { answers: readonly number[]; weight: number }> = {};
  for (const e of FALLBACK_CATALOG) m[e.key] = { answers: e.answers, weight: e.weight };
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
  /** The build ghost's own answer for a footprint ORIGIN cell. */
  placeable(player: number, publicId: number, cx: number, cz: number): boolean;
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
        const doctrine = DOCTRINE_BY_KEY[e.key] ?? { answers: NO_ANSWER, weight: 0 };
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
      const doctrine = DOCTRINE_BY_KEY[e.key] ?? { answers: NO_ANSWER, weight: 0 };
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
}

function fromBuildingDef(
  def: BuildingDef | undefined,
  base: CatalogEntry,
  doctrine: { answers: readonly number[]; weight: number },
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
  };
}

function fromUnitDef(
  def: UnitDef | undefined,
  base: CatalogEntry,
  doctrine: { answers: readonly number[]; weight: number },
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
  return {
    barracks: 'barracks', refinery: 'refinery', radar: 'radar',
    techLab: 'battleLab', warFactory: 'warFactory',
    defence: faction === Faction.Soviets ? 'flameTower' : 'pillbox',
  };
}

export function openingFor(faction: Faction, personality: number): readonly OpeningStep[] {
  const base = (faction as number) === (FACTION_MERIDIAN as number)
    ? OPENING_MERIDIAN
    : faction === Faction.Soviets ? OPENING_SOVIETS : OPENING_ALLIES;
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
}

/** Clamp an arbitrary difficulty index into the table. */
export function difficultyProfile(index: number): DifficultyProfile {
  const i = index < 0 ? 0 : index >= AI_DIFFICULTY.length ? AI_DIFFICULTY.length - 1 : index | 0;
  const d = AI_DIFFICULTY[i];
  const s = AI_SKILL[i];
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
