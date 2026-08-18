/**
 * ============================================================================
 * src/shell/Diagnostics.ts — WHAT THE GAME THINKS IS TRUE, WRITTEN DOWN
 * ============================================================================
 * Asked for as *"we should add dedicated Developer tab inside settings to allow
 * exporting game state"*, after a match that would not end. That specific bug
 * is fixed — `Viability.surveyViability` §HELD — and this is deliberately NOT a
 * monument to it. It is the general tool the incident proved was missing: a
 * player who sees the game do something inexplicable can hand somebody a page
 * of text and that text answers "why", without a repro, a build or a save.
 *
 * The garrison bug is nevertheless the worked example this file is measured
 * against, because it is the best one available. What was needed to diagnose it
 * was, exactly:
 *
 *   1. `heldUnits` — the count that did not exist, of units alive and owned but
 *      indoors, and therefore neither drawn nor targetable.
 *   2. `contestingUnits` next to it, so the reader can see the two disagree.
 *   3. `isBeaten` / `canContest`, so the reader can see WHICH predicate the
 *      match was hanging on.
 *   4. Per entity, `EntityFlag.Garrisoned` — DECODED TO ITS NAME. A bitmask in
 *      a bug report is a number somebody has to go and decode by hand, which
 *      means they will not. `tests/diagnostics.spec.ts` reproduces the bug and
 *      requires all four to be present in the output.
 *
 * ----------------------------------------------------------------------------
 * IT READS. IT NEVER WRITES.
 * ----------------------------------------------------------------------------
 * Every number here comes out of a pure read over `World` plus the shell's own
 * accessors. Nothing calls a service that advances state, nothing mutates an
 * entity, nothing touches `s.rng`, and the surveys are taken with
 * `surveyViability` — the SAME function the sell guard and the match-outcome
 * rule read — into scratch objects this module owns. A diagnostic that changes
 * what it measures is worse than no diagnostic, and this one is invoked from a
 * button on a screen that is sometimes open over a LIVE PvP match.
 *
 * It allocates freely, because it runs once per click and never from a frame.
 *
 * ----------------------------------------------------------------------------
 * NO DOM, ON PURPOSE.
 * ----------------------------------------------------------------------------
 * The whole suite runs under `environment: 'node'`. Keeping the report a pure
 * function of a plain input record is what lets `tests/diagnostics.spec.ts`
 * build a real `World`, garrison a real man in a real building and assert on
 * the real output — rather than asserting that some source text contains a
 * word. The rendering half lives in `src/shell/Settings.ts`.
 * ============================================================================
 */

import {
  EntityFlag, EntityKind, Faction, Locomotor, OrderKind, Stance, UnitState,
} from '../core/types';
import type { DefTables, PlayerId } from '../core/types';
import type { World } from '../core/world';

import {
  canContest, canRebuild, describeViability, hasAssets, isBeaten, isStranded,
  makeViabilitySurvey, surveyViability,
} from '../sim/Viability';

import { DIFFICULTIES, PERSONALITIES } from './settings-store';

/**
 * Bumped when a field is added, removed or changes meaning.
 *
 * A dump is a thing somebody pastes into a message and somebody else reads six
 * weeks later. Without a version on the page, "the export did not have that
 * field" and "the build did not have that bug" are indistinguishable.
 */
export const DIAGNOSTICS_FORMAT_VERSION = 1;

/* ==========================================================================
 * 1. NAMES FOR NUMBERS
 *
 * Every one of these is a `Record<TheEnum, string>`, which is not decoration:
 * it makes the table EXHAUSTIVE at compile time, so a member appended to
 * `UnitState` or `EntityFlag` fails `npm run typecheck` here rather than
 * printing as a bare integer in the one report somebody was relying on.
 *
 * They cannot be replaced by a reverse map (`UnitState[n]`). These are
 * `const enum`s, and the reverse map of one is illegal under `isolatedModules`
 * — the exact `TS2476` that took a v1.31.0 deploy down.
 * ========================================================================== */

const KIND_NAMES: Record<EntityKind, string> = {
  [EntityKind.None]: 'None',
  [EntityKind.Infantry]: 'Infantry',
  [EntityKind.Vehicle]: 'Vehicle',
  [EntityKind.Building]: 'Building',
  [EntityKind.Wreck]: 'Wreck',
  [EntityKind.Prop]: 'Prop',
  [EntityKind.Crate]: 'Crate',
};

const FACTION_NAMES: Record<Faction, string> = {
  [Faction.Neutral]: 'Neutral',
  [Faction.Allies]: 'Allies',
  [Faction.Soviets]: 'Soviets',
  [Faction.Meridian]: 'Meridian',
  [Faction.Reclaim]: 'Reclamation',
};

const STATE_NAMES: Record<UnitState, string> = {
  [UnitState.Idle]: 'Idle',
  [UnitState.Moving]: 'Moving',
  [UnitState.AttackMoving]: 'AttackMoving',
  [UnitState.Attacking]: 'Attacking',
  [UnitState.Guarding]: 'Guarding',
  [UnitState.SeekOre]: 'SeekOre',
  [UnitState.Harvesting]: 'Harvesting',
  [UnitState.ReturnToRefinery]: 'ReturnToRefinery',
  [UnitState.Docked]: 'Docked',
  [UnitState.Deploying]: 'Deploying',
  [UnitState.UnderConstruction]: 'UnderConstruction',
  [UnitState.Capturing]: 'Capturing',
  [UnitState.Fleeing]: 'Fleeing',
  [UnitState.Dying]: 'Dying',
  [UnitState.Repairing]: 'Repairing',
  [UnitState.Selling]: 'Selling',
  [UnitState.Drowned]: 'Drowned',
};

const ORDER_NAMES: Record<OrderKind, string> = {
  [OrderKind.None]: 'None',
  [OrderKind.Move]: 'Move',
  [OrderKind.AttackMove]: 'AttackMove',
  [OrderKind.Attack]: 'Attack',
  [OrderKind.ForceAttack]: 'ForceAttack',
  [OrderKind.Stop]: 'Stop',
  [OrderKind.Guard]: 'Guard',
  [OrderKind.Harvest]: 'Harvest',
  [OrderKind.Deploy]: 'Deploy',
  [OrderKind.Capture]: 'Capture',
  [OrderKind.Repair]: 'Repair',
  [OrderKind.Enter]: 'Enter',
  [OrderKind.Scatter]: 'Scatter',
  [OrderKind.Patrol]: 'Patrol',
  [OrderKind.SetRally]: 'SetRally',
  [OrderKind.UseAbility]: 'UseAbility',
  [OrderKind.Unload]: 'Unload',
};

const LOCOMOTOR_NAMES: Record<Locomotor, string> = {
  [Locomotor.Foot]: 'Foot',
  [Locomotor.Track]: 'Track',
  [Locomotor.Wheel]: 'Wheel',
  [Locomotor.Hover]: 'Hover',
  [Locomotor.Static]: 'Static',
  [Locomotor.Air]: 'Air',
};

const STANCE_NAMES: Record<Stance, string> = {
  [Stance.Aggressive]: 'Aggressive',
  [Stance.Defensive]: 'Defensive',
  [Stance.HoldFire]: 'HoldFire',
  [Stance.HoldGround]: 'HoldGround',
};

/**
 * THE HIGHEST-VALUE FIELD IN THE WHOLE DUMP.
 *
 * `Garrisoned` is the bit the unfinishable match turned on: the only one a
 * living, owned unit can carry that makes it BOTH undrawn
 * (`RenderBridge.HIDDEN_MASK`) and untargetable (`TARGETABLE_REJECT_MASK`). A
 * player looking at a raw `0x40081` would never have found it. A player looking
 * at `["Alive","Garrisoned","CanMove"]` finds it in a second.
 */
const FLAG_NAMES: Record<EntityFlag, string> = {
  [EntityFlag.Alive]: 'Alive',
  [EntityFlag.PendingDestroy]: 'PendingDestroy',
  [EntityFlag.Selected]: 'Selected',
  [EntityFlag.Hovered]: 'Hovered',
  [EntityFlag.UnderConstruction]: 'UnderConstruction',
  [EntityFlag.Powered]: 'Powered',
  [EntityFlag.Immobilized]: 'Immobilized',
  [EntityFlag.Garrisoned]: 'Garrisoned',
  [EntityFlag.CanAttack]: 'CanAttack',
  [EntityFlag.CanMove]: 'CanMove',
  [EntityFlag.HasTurret]: 'HasTurret',
  [EntityFlag.Crushable]: 'Crushable',
  [EntityFlag.Crusher]: 'Crusher',
  [EntityFlag.NeedsPower]: 'NeedsPower',
  [EntityFlag.IsHarvester]: 'IsHarvester',
  [EntityFlag.IsBuilder]: 'IsBuilder',
  [EntityFlag.IsRadar]: 'IsRadar',
  [EntityFlag.IsFactory]: 'IsFactory',
  [EntityFlag.PrimaryFactory]: 'PrimaryFactory',
  [EntityFlag.IsRefinery]: 'IsRefinery',
  [EntityFlag.Deployed]: 'Deployed',
  [EntityFlag.Burning]: 'Burning',
  [EntityFlag.BeingRepaired]: 'BeingRepaired',
  [EntityFlag.Sellable]: 'Sellable',
  [EntityFlag.Veteran1]: 'Veteran1',
  [EntityFlag.Veteran2]: 'Veteran2',
  [EntityFlag.Cloaked]: 'Cloaked',
  [EntityFlag.ProvidesVision]: 'ProvidesVision',
  [EntityFlag.BlocksNav]: 'BlocksNav',
  [EntityFlag.NotATarget]: 'NotATarget',
  [EntityFlag.NotSelectable]: 'NotSelectable',
};

/** `[bit, name]`, ascending. Built once, from the exhaustive table above. */
const FLAG_BITS: ReadonlyArray<readonly [number, string]> = Object
  .keys(FLAG_NAMES)
  .map((k) => [Number(k), FLAG_NAMES[Number(k) as EntityFlag]] as const)
  .sort((a, b) => a[0] - b[0]);

/** Every bit `FLAG_NAMES` accounts for, so an unnamed one can be spotted. */
const FLAG_KNOWN_MASK: number = FLAG_BITS.reduce((m, [bit]) => m | bit, 0);

/**
 * Bits set on `flags`, by name.
 *
 * An unnamed bit is reported as `unnamed:0x…` rather than dropped. Dropping it
 * would make a flag added without a name here INVISIBLE in the dump, which is
 * the same failure the raw bitmask has and harder to notice.
 */
export function decodeFlags(flags: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < FLAG_BITS.length; i++) {
    if ((flags & FLAG_BITS[i][0]) !== 0) out.push(FLAG_BITS[i][1]);
  }
  const unnamed = (flags & ~FLAG_KNOWN_MASK) >>> 0;
  if (unnamed !== 0) out.push(`unnamed:0x${unnamed.toString(16)}`);
  return out;
}

function kindName(k: number): string {
  return KIND_NAMES[k as EntityKind] ?? `kind#${k}`;
}

function factionName(f: number): string {
  return FACTION_NAMES[f as Faction] ?? `faction#${f}`;
}

/* ==========================================================================
 * 2. THE INPUT
 *
 * Two records the caller fills. Everything the report needs that is NOT in the
 * world comes in through these, so this module never reads `location`, never
 * reads `navigator` and never reaches for a global — which is what keeps it
 * a pure function and therefore testable against a real world.
 * ========================================================================== */

/** The GPU actually in use. Null before a renderer exists. */
export interface DiagnosticsRenderer {
  /** `webgl` / `webgpu` / `webgl2-fallback` — the LIVE backend, not the flag. */
  readonly backend: string;
  /** One line naming the chip, however the platform chose to name it. */
  readonly gpu: string;
  /**
   * The WebGPU adapter identity, or null on the WebGL path.
   *
   * Kept separate from `gpu` because they can disagree and the disagreement is
   * the finding: `powerPreference: 'high-performance'` is a hint Windows
   * ignores, so a machine with two GPUs can report one chip here and the other
   * one there. See `RENDER_FINDINGS.md` §7g.
   */
  readonly adapter: string | null;
  readonly drawCalls: number;
  readonly triangles: number;
}

/** Picture settings, because half of all "it looks wrong" reports are these. */
export interface DiagnosticsGraphics {
  readonly tier: string;
  readonly resolutionScale: number;
  readonly adaptiveResolution: boolean;
  /**
   * False means the one-time hardware calibration has not run yet or was
   * retired; true means the settings on this machine are a decision somebody
   * (or the calibration) committed to. `HardwareCalibration.ts` owns the rule.
   */
  readonly calibrated: boolean;
  readonly shadows: boolean;
  readonly ao: boolean;
  readonly bloom: boolean;
  readonly msaa: boolean;
  readonly perfOverlay: boolean;
}

/** Everything true about the app rather than about a match. */
export interface DiagnosticsEnvironment {
  readonly buildVersion: string;
  /** ISO-8601. Taken with `Date`, which is legal — this is not a sim tick. */
  readonly generatedAt: string;
  /** `Shell.getState()`. */
  readonly shellState: string;
  readonly platform: 'desktop' | 'web';
  /** The Electron bridge version in force, or null in a browser. */
  readonly bridgeVersion: number | null;
  readonly userAgent: string;
  /** Origin + path. The query string is reported separately, redacted. */
  readonly page: string;
  /** Boot flags, `?relay=` redacted. See `redactBootFlags`. */
  readonly bootFlags: Readonly<Record<string, string>>;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number } | null;
  /**
   * Every progression gate is off — `?unlockall`, or the Diagnostics toggle.
   *
   * IN THE REPORT BECAUSE IT CHANGES WHAT GAME IS BEING DESCRIBED. An ungated
   * session fields content a normal profile cannot build, on both sides, so a
   * screenshot or a survey taken in one answers a different question from the
   * one the reader thinks they asked. `progression.system.ts` already shouts it
   * into the console for exactly this reason; a console line does not travel
   * with a pasted report and this does.
   */
  readonly unlockAll: boolean;
  readonly renderer: DiagnosticsRenderer | null;
  readonly graphics: DiagnosticsGraphics;
}

/** The running engine. Null on the title screen with nothing booted. */
export interface DiagnosticsMatch {
  readonly world: World;
  /** `match` | `backdrop` (the title screen's scene) | `replay`. */
  readonly kind: 'match' | 'backdrop' | 'replay';
  readonly simTick: number;
  readonly simSeconds: number;
  readonly paused: boolean;
  readonly speed: number;
  /**
   * THE TERRAIN ROLL — `?mapseed=`. The landform, the ore fields, the scatter.
   *
   * NOT the same number as `simSeed`, and a report that conflates the two is
   * useless for reproduction: a v1 replay file stored only this one and could
   * therefore reproduce the hills and nothing else.
   */
  readonly mapSeed: number;
  /** THE SCENARIO ROLL — `?seed=`. Army layout and every draw of `s.rng`. */
  readonly simSeed: number;
  readonly mapId: string;
  readonly mapName: string;
  readonly mapPreset: string;
  readonly biome: string;
  /** `mcv` or `base` — what each army started with. */
  readonly opening: string;
  readonly scenario: string;
  /**
   * The LIVE def binding (`ProductionService.bindingTables`), or null.
   *
   * Passed in rather than imported so this module does not pull the content
   * layer into the shell chunk, and so a caller can hand it the binding that
   * is actually bound rather than one this file guessed at. Null degrades to
   * `unit#12` / `building#7` in the def column, which is still diagnostic.
   */
  readonly defs: DefTables | null;
}

/** What `buildDiagnostics` is handed. */
export interface DiagnosticsInput {
  readonly env: DiagnosticsEnvironment;
  readonly match: DiagnosticsMatch | null;
  /** Include the per-entity list. Off by default; it is the big tier. */
  readonly includeEntities: boolean;
}

/* ==========================================================================
 * 3. THE REPORT
 * ========================================================================== */

/** One player's viability, and the four readings of it. */
export interface DiagnosticsViability {
  /** Which function produced every number in this block. */
  readonly source: string;
  readonly buildings: number;
  readonly units: number;
  readonly producers: number;
  readonly constructionVehicles: number;
  readonly contestingUnits: number;
  /** Alive, owned, and inside a building or a hull. See `Viability` §HELD. */
  readonly heldUnits: number;
  readonly hasAssets: boolean;
  readonly canRebuild: boolean;
  readonly canContest: boolean;
  readonly isStranded: boolean;
  readonly isBeaten: boolean;
  /** `describeViability()`, verbatim — the same line the boot log prints. */
  readonly line: string;
}

export interface DiagnosticsPlayer {
  readonly id: number;
  readonly name: string;
  readonly faction: string;
  readonly isLocal: boolean;
  readonly controller: string;
  readonly defeated: boolean;
  /** Binary, LSB = player 0. Always includes self. */
  readonly allyMask: string;
  readonly credits: number;
  readonly storageMax: number;
  readonly powerProduced: number;
  readonly powerConsumed: number;
  readonly buildSpeedMul: number;
  readonly hasRadar: boolean;
  /** Non-zero rows of `PlayerState.buildingCount`, keyed by def key. */
  readonly buildingCount: Readonly<Record<string, number>>;
  readonly buildingCountTotal: number;
  readonly entitiesByKind: Readonly<Record<string, number>>;
  readonly viability: DiagnosticsViability;
}

/** The match-outcome rule, evaluated right now. */
export interface DiagnosticsOutcome {
  readonly source: string;
  /** Why this is not the same thing as "the match is about to end". */
  readonly note: string;
  readonly localPlayer: number;
  readonly localHasAssets: boolean;
  readonly localStranded: boolean;
  readonly localBeaten: boolean;
  readonly hostiles: number;
  readonly hostilesBeaten: number;
  readonly victoryConditionMet: boolean;
  readonly defeatConditionMet: boolean;
  readonly reading: string;
}

export interface DiagnosticsEntities {
  readonly note: string;
  readonly listed: number;
  readonly storeCapacity: number;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<ReadonlyArray<string | number | readonly string[]>>;
}

export interface DiagnosticsReport {
  readonly report: 'voltmarch-diagnostics';
  readonly formatVersion: number;
  readonly notes: readonly string[];
  readonly environment: DiagnosticsEnvironment;
  readonly match: {
    readonly kind: string;
    readonly simTick: number;
    readonly simSeconds: number;
    readonly paused: boolean;
    readonly speed: number;
    readonly mapSeed: number;
    readonly simSeed: number;
    readonly seedNote: string;
    readonly mapId: string;
    readonly mapName: string;
    readonly mapPreset: string;
    readonly biome: string;
    readonly opening: string;
    readonly scenario: string;
    readonly entityTotals: Readonly<Record<string, number>>;
    readonly outcome: DiagnosticsOutcome;
    readonly players: readonly DiagnosticsPlayer[];
    readonly entities: DiagnosticsEntities | null;
  } | null;
}

/* ==========================================================================
 * 4. THE BUILDER
 * ========================================================================== */

/**
 * The two scratch surveys, module-scope and reused.
 *
 * Not because allocation matters here — this runs on a click — but because
 * `surveyViability` takes a caller-supplied output object and reusing one is
 * how every other caller uses it. Two, not one: the outcome block compares a
 * local survey against a hostile one in the same pass.
 */
const localScratch = makeViabilitySurvey();
const otherScratch = makeViabilitySurvey();

/** `unit#12` when there is no binding, the content key when there is. */
function defLabel(defs: DefTables | null, kind: number, defId: number): string {
  if (defId < 0) return '-';
  if (defs === null) {
    return kind === (EntityKind.Building as number) ? `building#${defId}` : `unit#${defId}`;
  }
  if (kind === (EntityKind.Building as number)) return defs.buildings[defId]?.key ?? `building#${defId}`;
  if (kind === (EntityKind.Infantry as number) || kind === (EntityKind.Vehicle as number)) {
    return defs.units[defId]?.key ?? `unit#${defId}`;
  }
  return `def#${defId}`;
}

/** One decimal. Positions and hit points; nothing here needs more. */
function r1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Take a survey and read it four ways. */
function viabilityOf(world: World, player: PlayerId, out = otherScratch): DiagnosticsViability {
  const s = surveyViability(world, player, out);
  return {
    source: 'src/sim/Viability.ts#surveyViability — the same function the sell guard '
      + 'and game/outcome.system.ts read',
    buildings: s.buildings,
    units: s.units,
    producers: s.producers,
    constructionVehicles: s.constructionVehicles,
    contestingUnits: s.contestingUnits,
    heldUnits: s.heldUnits,
    hasAssets: hasAssets(s),
    canRebuild: canRebuild(s),
    canContest: canContest(s),
    isStranded: isStranded(s),
    isBeaten: isBeaten(s),
    line: describeViability(s),
  };
}

/**
 * Every live slot, in ascending entity id.
 *
 * SORTED, so two exports of one state produce byte-identical text and can be
 * diffed. `store.alive` is maintained by swap-remove, so its natural order
 * changes every time anything dies and a raw dump of it would look different
 * every time for no reason.
 */
function entityRows(match: DiagnosticsMatch): DiagnosticsEntities {
  const st = match.world.store;
  const slots: number[] = [];
  for (let a = 0; a < st.aliveCount; a++) slots.push(st.alive[a]);
  slots.sort((x, y) => st.handleOf(x) - st.handleOf(y));

  const rows: Array<Array<string | number | string[]>> = [];
  for (let a = 0; a < slots.length; a++) {
    const i = slots[a];
    rows.push([
      st.handleOf(i) as number,
      st.owner[i],
      kindName(st.kind[i]),
      defLabel(match.defs, st.kind[i], st.defId[i]),
      r1(st.posX[i]),
      r1(st.posZ[i]),
      r1(st.hp[i]),
      r1(st.maxHp[i]),
      STATE_NAMES[st.state[i] as UnitState] ?? `state#${st.state[i]}`,
      ORDER_NAMES[st.orderKind[i] as OrderKind] ?? `order#${st.orderKind[i]}`,
      st.orderTarget[i],
      STANCE_NAMES[st.stance[i] as Stance] ?? `stance#${st.stance[i]}`,
      LOCOMOTOR_NAMES[st.locomotor[i] as Locomotor] ?? `loco#${st.locomotor[i]}`,
      st.carrierId[i],
      st.garrisonId[i],
      decodeFlags(st.flags[i]),
    ]);
  }

  return {
    /*
     * NO CAP, AND THE REASON IS STRUCTURAL RATHER THAN A JUDGEMENT CALL.
     * `EntityStore` is a fixed-capacity SoA — `MAX_ENTITIES` slots, allocated
     * once at boot — so this list has a hard ceiling that does not depend on
     * how long the match ran or how big the map is. There is nothing to
     * truncate and therefore nothing to under-report, which is the failure
     * mode a silent cap would introduce.
     */
    note: 'Complete. The entity store is fixed-capacity, so this list cannot be truncated. '
      + 'One row per live slot, ascending by id. `carrier` and `garrison` are the host '
      + 'entity ids (0 = none) and `flags` is decoded from EntityFlag.',
    listed: rows.length,
    storeCapacity: st.capacity,
    columns: [
      'id', 'owner', 'kind', 'def', 'x', 'z', 'hp', 'maxHp',
      'state', 'order', 'orderTarget', 'stance', 'locomotor',
      'carrier', 'garrison', 'flags',
    ],
    rows,
  };
}

/** `Easy`, `AI (Brutal / Rusher)` — whatever the player is looking at. */
function controllerOf(isHuman: boolean, difficulty: number, personality: number): string {
  if (isHuman) return 'human';
  const d = DIFFICULTIES[difficulty] ?? `difficulty#${difficulty}`;
  const p = PERSONALITIES[personality] ?? `personality#${personality}`;
  return `AI (${d} / ${p})`;
}

function buildPlayers(match: DiagnosticsMatch): DiagnosticsPlayer[] {
  const world = match.world;
  const st = world.store;
  const out: DiagnosticsPlayer[] = [];

  for (const p of world.players) {
    // Per-owner entity tally, taken over the live list rather than off
    // `PlayerState.entityCount`. The cached counter is what the sim maintains
    // incrementally, and a diagnostic whose job is to catch bookkeeping drift
    // must not read the bookkeeping it might be catching.
    const byKind: Record<string, number> = {};
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== (p.id as number)) continue;
      const key = kindName(st.kind[i]);
      byKind[key] = (byKind[key] ?? 0) + 1;
    }

    // `buildingCount` is `Int32Array` indexed by DEF INDEX and mostly zeroes.
    // Printing 200 of them buries the four that matter.
    const built: Record<string, number> = {};
    let builtTotal = 0;
    for (let d = 0; d < p.buildingCount.length; d++) {
      const n = p.buildingCount[d];
      if (n === 0) continue;
      built[match.defs?.buildings[d]?.key ?? `building#${d}`] = n;
      builtTotal += n;
    }

    out.push({
      id: p.id as number,
      name: p.name,
      faction: factionName(p.faction),
      isLocal: p.isLocal,
      controller: controllerOf(p.isHuman, p.aiDifficulty, p.aiPersonality),
      defeated: p.defeated,
      allyMask: `0b${(p.allyMask >>> 0).toString(2)}`,
      credits: Math.round(p.credits),
      storageMax: p.storageMax,
      powerProduced: p.powerProduced,
      powerConsumed: p.powerConsumed,
      buildSpeedMul: r1(p.buildSpeedMul * 100) / 100,
      hasRadar: p.hasRadar,
      buildingCount: built,
      buildingCountTotal: builtTotal,
      entitiesByKind: byKind,
      viability: viabilityOf(world, p.id),
    });
  }
  return out;
}

/**
 * The victory / defeat rule, evaluated on the spot.
 *
 * A RESTATEMENT OF `game/outcome.system.ts#evaluate`, NOT A READ OF IT. That
 * module keeps its accumulators private, and it is right to: they are the
 * grace timers that stop an MCV mid-deploy from ending a match. So this block
 * reports the INSTANTANEOUS reading and says so in `note`, rather than
 * implying it knows how long the state has held. The predicates themselves are
 * the shared ones from `src/sim/Viability.ts`, so the two cannot disagree about
 * what "beaten" means.
 */
function buildOutcome(match: DiagnosticsMatch): DiagnosticsOutcome {
  const world = match.world;
  const local = world.localPlayer;
  const localView = viabilityOf(world, local, localScratch);

  let hostiles = 0;
  let hostilesBeaten = 0;
  for (const p of world.players) {
    if (p.faction === Faction.Neutral) continue;
    if (world.areAllied(local, p.id)) continue;
    hostiles++;
    const s = surveyViability(world, p.id, otherScratch);
    if (isBeaten(s)) hostilesBeaten++;
  }

  const victory = hostiles > 0 && hostilesBeaten === hostiles;
  const defeat = !localView.hasAssets || localView.isBeaten;

  let reading: string;
  if (victory && defeat) {
    reading = 'both sides are finished; the outcome rule checks victory first, so this resolves '
      + 'as a win for the local player';
  } else if (victory) {
    reading = `every hostile player (${hostiles}) is beaten — the match should resolve as a `
      + 'victory once the grace window elapses';
  } else if (defeat) {
    reading = 'the local player cannot build and has nothing on the field but harvesters — the '
      + 'match should resolve as a defeat once the grace window elapses';
  } else if (localView.isStranded) {
    reading = 'the local player is stranded (assets, but nothing that can build). That is a '
      + 'WARNING, not a defeat: an army with no base can still win';
  } else {
    reading = `the match should continue: ${hostilesBeaten} of ${hostiles} hostile players are `
      + 'beaten and the local player is viable';
  }

  return {
    source: 'src/sim/Viability.ts predicates, evaluated the way '
      + 'src/game/outcome.system.ts#evaluate evaluates them',
    note: 'INSTANTANEOUS. game/outcome.system.ts holds a beaten state for several seconds before '
      + 'acting on it, and that accumulator is module-private, so this says what the rule sees '
      + 'right now — not how long it has seen it.',
    localPlayer: local as number,
    localHasAssets: localView.hasAssets,
    localStranded: localView.isStranded,
    localBeaten: localView.isBeaten,
    hostiles,
    hostilesBeaten,
    victoryConditionMet: victory,
    defeatConditionMet: defeat,
    reading,
  };
}

/** Live entities by kind, over every owner including nobody. */
function entityTotals(match: DiagnosticsMatch): Record<string, number> {
  const st = match.world.store;
  const totals: Record<string, number> = { total: st.aliveCount, pendingDestroy: 0 };
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    const key = kindName(st.kind[i]);
    totals[key] = (totals[key] ?? 0) + 1;
    if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) totals.pendingDestroy++;
  }
  return totals;
}

/**
 * The notes block, which is the part a human reads first.
 *
 * Every entry answers a question somebody would otherwise have to go and look
 * up: which function produced a number, why two seeds are not one seed, and
 * what `heldUnits` means. The garrison bug cost a day precisely because the
 * distinction in the third one was nowhere on screen or in any log.
 */
function notesFor(input: DiagnosticsInput): string[] {
  const notes: string[] = [
    'A snapshot. Nothing here was measured over time and nothing here changed the game to '
    + 'produce it — the whole report is a read.',
    'Contains no personal information: no profile, no save data, no file paths, and any '
    + '?relay= address is redacted to "(set)".',
  ];
  if (input.env.unlockAll) {
    // FIRST-CLASS, not a field buried in the environment block. Anything
    // measured in an ungated session is a measurement of a different game.
    notes.push(
      'UNLOCK EVERYTHING IS ON. Every progression gate is off for this session, for the AI as '
      + 'well as for you (UnlockGate.mirrorAI resolves the AI against your profile). Rosters, '
      + 'available battlefields and anything either side has built may not match a normal '
      + 'profile. Nothing was written to the profile.',
    );
  }
  if (input.match === null) {
    notes.push(
      'NO MATCH IS RUNNING, so there is no world to describe. The environment block below is '
      + 'still complete and is what a graphics, audio or boot report needs.',
    );
    return notes;
  }
  notes.push(
    'mapSeed and simSeed are DIFFERENT SEEDS. mapSeed (?mapseed=) is the terrain roll — '
    + 'landform, ore fields, scatter. simSeed (?seed=) is the scenario layout and every draw '
    + 'of the simulation RNG. Reproducing a match needs both.',
    'Every viability number comes from src/sim/Viability.ts#surveyViability, the one function '
    + 'the sell guard and the match-outcome rule both read.',
    'heldUnits counts units that are alive and owned but inside a building or a transport '
    + '(EntityFlag.Garrisoned). They are neither drawn nor targetable, so they are deliberately '
    + 'NOT counted in contestingUnits — a squad indoors is a structure\'s ammunition, not an '
    + 'army. contestingUnits + heldUnits + harvesters = units.',
  );
  if (!input.includeEntities) {
    notes.push(
      'The per-entity list is not included. Turn on "Include Every Entity" and export again if '
      + 'the question is about one specific unit or building.',
    );
  }
  return notes;
}

/** Build the whole report. Pure: same input, same output, no side effects. */
export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsReport {
  const m = input.match;
  return {
    report: 'voltmarch-diagnostics',
    formatVersion: DIAGNOSTICS_FORMAT_VERSION,
    notes: notesFor(input),
    environment: input.env,
    match: m === null ? null : {
      kind: m.kind,
      simTick: m.simTick,
      simSeconds: r1(m.simSeconds),
      paused: m.paused,
      speed: m.speed,
      mapSeed: m.mapSeed,
      simSeed: m.simSeed,
      seedNote: 'mapSeed = terrain (?mapseed=); simSeed = scenario and RNG (?seed=)',
      mapId: m.mapId,
      mapName: m.mapName,
      mapPreset: m.mapPreset,
      biome: m.biome,
      opening: m.opening,
      scenario: m.scenario,
      entityTotals: entityTotals(m),
      outcome: buildOutcome(m),
      players: buildPlayers(m),
      entities: input.includeEntities ? entityRows(m) : null,
    },
  };
}

/* ==========================================================================
 * 5. TEXT
 * ========================================================================== */

/**
 * Longest single-line form an array is allowed before it is broken up.
 *
 * `JSON.stringify(x, null, 2)` would put every entity row across seventeen
 * lines, which turns a 4000-entity dump into 68 000 lines nobody will scroll.
 * Inlining short arrays gives one line per entity — which is also what makes
 * the dump greppable: `grep Garrisoned` returns the id, owner, def, position
 * and full flag list of every affected entity, on one line each.
 *
 * OBJECTS ALWAYS EXPAND. The summary is the tier a person reads, and a
 * viability block folded onto one line is unreadable at any width.
 */
const INLINE_WIDTH = 420;

/** JSON, but arrays stay on one line when they fit. See `INLINE_WIDTH`. */
export function formatDiagnostics(report: DiagnosticsReport): string {
  return render(report, '');
}

function render(value: unknown, indent: string): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  const next = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const flat = JSON.stringify(value);
    if (flat !== undefined && flat.length + indent.length <= INLINE_WIDTH) return flat;
    const parts = value.map((v) => next + render(v, next));
    return `[\n${parts.join(',\n')}\n${indent}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const parts = entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${render(v, next)}`);
  return `{\n${parts.join(',\n')}\n${indent}}`;
}

/* ==========================================================================
 * 6. HELPERS THE SCREEN USES
 * ========================================================================== */

/**
 * Boot flags as a plain map, with `relay` redacted.
 *
 * THE REDACTION IS THE POINT OF THE FUNCTION. This report ships to every
 * player and is designed to be pasted into a public issue; `?relay=` carries
 * whichever multiplayer server the player was on, which is the one value in a
 * query string that is theirs rather than the game's. Whether the flag was set
 * is diagnostic; its value is not.
 */
export function redactBootFlags(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.forEach((value, key) => {
    out[key] = key.toLowerCase() === 'relay' ? '(set)' : value;
  });
  return out;
}

/**
 * A one-line-per-player readout for the screen itself.
 *
 * The tab is not only an export button: the single most useful thing it can do
 * is put `describeViability` on screen, because that line is what makes an
 * inexplicable match legible without anyone leaving the game. It is the same
 * string the export carries and the same string the boot log prints.
 */
export function viabilityLines(world: World): string[] {
  const out: string[] = [];
  for (const p of world.players) {
    // The survey line comes FIRST and verbatim, and the name is a suffix. Both
    // halves of that are deliberate: `describeViability` opens with `p0:`/`p1:`
    // so the slot ids line up in a monospace block and the counts read as
    // columns, which is the entire reason this readout exists — and a variable
    // width player name in front of them would destroy exactly that. Verbatim
    // so the line on screen, the line in the export and the line in the boot
    // log are provably one string.
    const line = describeViability(surveyViability(world, p.id, otherScratch));
    out.push(`${line}  (${p.name}${p.isLocal ? ', you' : ''})`);
  }
  return out;
}
