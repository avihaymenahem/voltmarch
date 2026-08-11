/**
 * ============================================================================
 * VOLTMARCH — src/game/SaveGame.ts
 * ============================================================================
 * THE SNAPSHOT FORMAT. Capture a running match into bytes; put those bytes back
 * into a running match.
 *
 * ----------------------------------------------------------------------------
 * DESIGN CALL 1 — A STATE SNAPSHOT, NOT A REPLAY LOG
 * ----------------------------------------------------------------------------
 * `core/events.ts` calls the `Command` struct "the replay format", and the soak
 * test proves an AI-vs-AI match replays identically under a seed. A save could
 * therefore be seed + map + the command log, and it would be tiny.
 *
 * It is a snapshot instead, for two reasons that do not trade off against file
 * size:
 *
 *   1. RESTORE MUST BE O(1) IN MATCH LENGTH. An autosave taken at minute 40 has
 *      to load in the time it takes to build the terrain. A replay save costs
 *      40 minutes of simulation to reconstruct — 72000 ticks through every
 *      system — and that cost grows without bound while the player keeps
 *      playing. A snapshot costs the same whether the match is two minutes old
 *      or two hours.
 *
 *   2. A REPLAY SAVE STAKES THE WHOLE FEATURE ON PERFECT DETERMINISM. The soak
 *      asserts determinism for AI-vs-AI under one seed; it does not assert it
 *      for every scenario, every faction, every superweapon and every future
 *      module. The moment one desync exists, a replay save silently
 *      reconstructs a DIFFERENT match — the player finds out because their base
 *      is arranged wrongly, and the bug is very nearly unreportable. A snapshot
 *      cannot drift: it restores the numbers that were there.
 *
 * A hybrid (periodic snapshot + the commands since) buys nothing here. Its only
 * advantage is smaller deltas, and the deltas are already small — see the size
 * note below — while it inherits reason 2 in full for the tail.
 *
 * The command log is still worth capturing SEPARATELY as a replay feature, and
 * nothing in this file forecloses it: `CommandBus.drain` is untouched and the
 * chunk stream below accepts new chunk ids without a schema bump. That door is
 * left open deliberately and is NOT built here.
 *
 * ----------------------------------------------------------------------------
 * WHAT IS STORED, AND WHAT IS REGENERATED
 * ----------------------------------------------------------------------------
 * Terrain, roads and prop scatter are pure functions of (map, seed). They are
 * NOT in the file — the loader rebuilds the same world and then restores the
 * mutable state on top of it. That is the single largest size saving available.
 *
 * THE TRAP THAT COMES WITH IT: props are retired PERMANENTLY by two different
 * things — `src/world/scatter-clear.system.ts` when a building is placed, and
 * `src/sim/Crush.ts` when a vehicle drives over soft scenery. Regenerating
 * scatter from the seed puts every one of them back, so a loaded base grows a
 * copse through its own War Factory and a trail a player mowed through a wood
 * reappears. Re-deriving the clear from the buildings that are STANDING is not
 * enough either — a structure that was built and later destroyed also cleared
 * ground, and RA (and that module's own header) treat clearing as permanent.
 *
 * So the file carries THE FELLED-PROP MASK: one bit per generated prop
 * placement, from `Scatter.felledMask()`. It is bounded by the map's prop
 * ceiling at 1125 bytes however long the match runs — 523 raw on `temperate`,
 * and measured A/B at +32 bytes on a 46 kB save with nothing felled, +100 with
 * 56 felled, +364 after a sweep that flattened 40% of the map. It covers both
 * clears with one mechanism and needs no ledger of events on either side. It
 * travels with `Scatter.placementFingerprint` and is applied ONLY when the
 * regenerated scatter reports the same one; see §3.10b in `Scatter.ts` for why,
 * and for the measurements that ruled out persisting the crush discs instead.
 *
 * The CLEARED FOOTPRINT LIST — every rectangle any building has ever been
 * placed on, four int16 cell coordinates each — is still written and is still
 * the fallback. A save from before the mask existed carries only that; so does
 * a save whose fingerprint no longer matches, which is what a load into a
 * differently-generated scatter looks like. Replaying it restores the building
 * clears and stands the crushed vegetation back up, which is the conservative
 * direction: scenery returns, it is never felled wrongly.
 *
 * ----------------------------------------------------------------------------
 * GENERATION HANDLES — THE SILENT BUG THIS FILE IS BUILT AROUND
 * ----------------------------------------------------------------------------
 * An `EntityId` is `[gen:12][index:20]`. Restoring entities naively — writing
 * columns into slots and leaving the generations alone — makes every handle that
 * was live BEFORE the load resolve again, against a different unit. `targetId`
 * on a leftover object, a `PerEntity*` side array's stamp in some other module,
 * a control group the UI still holds: all of them silently start addressing the
 * wrong entity. Nothing throws. The player sees a tank shooting at a harvester
 * it was never ordered to shoot.
 *
 * Two rules close it, and `tests/savegame.spec.ts` asserts both:
 *
 *   A. ENTITIES ARE COMPACTED. Slots are not preserved. Live entities are
 *      written in dense order and `EntityStore.alloc` hands them slots 0..N-1 on
 *      the way back in, so the free list, the dense lists and the per-kind lists
 *      stay exactly consistent — none of which could be true if this file wrote
 *      into the store's private allocator state. Every handle-valued column is
 *      remapped through the save-local index; a handle that pointed at something
 *      dead becomes `NONE`, which is what it should already have been.
 *
 *   B. EVERY GENERATION IS BUMPED PAST ITS PRE-LOAD VALUE. After the restore,
 *      slot `i` carries `bumpGen(genBeforeLoad[i])`. No handle minted before the
 *      load can resolve, and every generation-stamped side array in the process
 *      reads as "absent" instead of inheriting the previous tenant's value.
 *
 * ----------------------------------------------------------------------------
 * VERSIONING — TWO GATES, AND THEY CHECK DIFFERENT THINGS
 * ----------------------------------------------------------------------------
 * A save written by build N and read by build N+1 does not fail loudly on its
 * own. It loads WRONG: a def table gained a row, every index past it shifted,
 * and the player's Grizzlies are now Rhinos. Two independent gates:
 *
 *   1. `SAVE_SCHEMA_VERSION` — bumped by hand whenever the meaning of a byte in
 *      this file changes. A mismatch refuses.
 *
 *   2. `structuralHash()` — a hash over the FRAME the data lives in:
 *      `MAX_ENTITIES`, `MAP_CELLS`, `ENTITY_KIND_COUNT`, `FACTION_COUNT`,
 *      `MAX_PLAYERS`, `BUILD_TAB_COUNT`, `ARMOR_CLASS_COUNT`,
 *      `WARHEAD_CLASS_COUNT`, `CELL`, `CONTROL_GROUP_COUNT`. These are the
 *      numbers that make a column index or an enum value mean what it means.
 *      A mismatch refuses.
 *
 * DEF TABLES ARE DELIBERATELY NOT IN EITHER HASH. Entities and queue items store
 * a def **key string**, not a table index, so appending a unit — the common
 * case, and the one a blunt table hash would refuse for no reason — is survived
 * silently. What is checked instead is far more precise and is checked at
 * RESTORE time, per key: every key in the file must still resolve, and every
 * building key's footprint must still be the size the save assumed. A failure
 * names the key. "Refuses because `mrdMonitor` no longer exists" is a bug report
 * a player can file; "content hash mismatch" is not.
 *
 * Every refusal is a value, never a throw, and every one carries a sentence
 * meant for a human. A refusal a player understands beats a corrupted match.
 *
 * ----------------------------------------------------------------------------
 * FILE LAYOUT
 * ----------------------------------------------------------------------------
 *   header   'VMSV' u16 schema, u16 flags, u32 structuralHash,
 *            u32 bodyLength, u32 bodyCrc32, u32 metaLength, meta JSON (pad 4)
 *   body     a stream of chunks: u32 id, u32 byteLength, payload (pad 4)
 *
 * Unknown chunks are SKIPPED, not fatal. Unknown entity columns are skipped too
 * (the entity chunk is self-describing: each column carries its own id and
 * element type). That is what lets a later build add a column, or a later save
 * carry one this build has never heard of, without a schema bump.
 *
 * ----------------------------------------------------------------------------
 * COST
 * ----------------------------------------------------------------------------
 * Capture allocates — it is not a frame-loop path and must never be called from
 * one. `save.system.ts` runs it from `frame()`, once, never from `simTick`, and
 * the autosave trigger is the TICK COUNTER (wall clock is banned inside the
 * sim). Measured numbers are reported by `captureSnapshot` itself in
 * `captureMs`, and by `tests/savegame.spec.ts` at a realistic entity count.
 * ============================================================================
 */

import {
  CELL, CONTROL_GROUP_COUNT, MAP_CELLS, MAP_CELL_COUNT,
  MAX_ENTITIES, MAX_PLAYERS, MAX_SELECTION,
} from '../core/config';
import {
  ARMOR_CLASS_COUNT, BUILD_TAB_COUNT, ENTITY_KIND_COUNT, FACTION_COUNT,
  WARHEAD_CLASS_COUNT, EntityFlag, EntityKind, NONE,
} from '../core/types';
import type {
  BuildTab, DefTables, EntityId, Faction, PlayerId, PlayerState,
  ProductionItem, ProductionQueue,
} from '../core/types';
import type { EntityStore, World } from '../core/world';
import { footprintOriginCell } from '../core/math';
import { snapRallyClear } from '../sim/Placement';
import { ownedUpgradeKeys, setUpgradesByKey } from '../sim/Upgrades';

/** Rally re-snap output on load. Module scope: the loop must not allocate. */
const loadRallySnap = new Float64Array(2);

/** Shared empty list for a save written before `upgradeKeys` existed. */
const EMPTY_UPGRADE_KEYS: readonly string[] = [];

/* ==========================================================================
 * 1. VERSION AND IDENTITY
 * ========================================================================== */

/**
 * Bump this by hand whenever a byte in this file changes meaning. Adding a
 * chunk id, or an entity column id, does NOT require a bump — both streams are
 * self-describing and skip what they do not recognise.
 */
export const SAVE_SCHEMA_VERSION = 1;

/** File magic, ASCII 'VMSV'. */
const MAGIC_0 = 0x56; // V
const MAGIC_1 = 0x4d; // M
const MAGIC_2 = 0x53; // S
const MAGIC_3 = 0x56; // V

/** Bytes before the meta JSON. */
const HEADER_FIXED_BYTES = 24;

/**
 * The frame the data lives in. See the header: this is deliberately NOT a hash
 * of the def tables, because def keys are stored as strings and validated by
 * name at restore, which is both stricter and kinder.
 */
export function structuralHash(): number {
  return fnv1aNumbers([
    MAX_ENTITIES, MAP_CELLS, MAP_CELL_COUNT, MAX_PLAYERS, MAX_SELECTION,
    CONTROL_GROUP_COUNT, CELL,
    ENTITY_KIND_COUNT, FACTION_COUNT, BUILD_TAB_COUNT,
    ARMOR_CLASS_COUNT, WARHEAD_CLASS_COUNT,
    // Guards against a flag bit being renumbered under a stored `flags` column.
    EntityFlag.Alive, EntityFlag.NotSelectable, EntityFlag.BlocksNav,
  ]);
}

/* ==========================================================================
 * 2. RESULT TYPES — every failure is a value with a sentence in it
 * ========================================================================== */

/** Machine-readable refusal codes. The UI may branch on these. */
export type SaveRefusalCode =
  | 'not-a-save'
  | 'truncated'
  | 'corrupt'
  | 'schema-mismatch'
  | 'build-mismatch'
  | 'content-missing'
  | 'content-changed'
  | 'world-mismatch'
  | 'no-match'
  | 'too-many-entities'
  | 'storage';

export interface SaveRefusal {
  ok: false;
  code: SaveRefusalCode;
  /** One sentence, addressed to the player. */
  reason: string;
}

export type SaveResult<T> = { ok: true; value: T } | SaveRefusal;

function refuse(code: SaveRefusalCode, reason: string): SaveRefusal {
  return { ok: false, code, reason };
}

/* ==========================================================================
 * 3. METADATA — what the load screen renders without opening the blob
 * ========================================================================== */

/**
 * The header block, duplicated into the store's index so a save list renders
 * instantly. Everything here is plain JSON and safe to show a player.
 */
export interface SaveMeta {
  schemaVersion: number;
  structuralHash: number;
  /** Player-facing label ("Autosave 3", "Before the push"). */
  label: string;
  /** Wall clock, ms since epoch. Written OUTSIDE the sim tick — see the header. */
  savedAtMs: number;
  /** Sim tick the snapshot was taken on. This is the in-game clock. */
  tick: number;
  simTimeSec: number;
  /** Scenario id and map name; the loader refuses a mismatch. */
  scenario: string;
  map: string;
  seed: number;
  localPlayerName: string;
  localFaction: number;
  credits: number;
  entityCount: number;
  /** Size of the whole blob. Filled in by `captureSnapshot`. */
  byteLength: number;
}

/* ==========================================================================
 * 4. THE HOST PORTS
 *
 * Structural, so `Vision`, `OreField`, `SuperweaponService` and `CameraRig`
 * satisfy them as they stand — this file imports none of those modules and
 * cannot make any of them depend on saving.
 * ========================================================================== */

/** Fog of war. `Vision` implements both of these already. */
export interface VisionAccess {
  /** The raw 2-bit grid. Read here, never written — see `restoreFog`. */
  gridFor(player: PlayerId): Uint8Array;
  /** Mark a circle explored without granting live vision. */
  exploreCircle(player: PlayerId, x: number, z: number, r: number): void;
}

/** Ore depletion. `OreField` implements both. */
export interface OreAccess {
  oreAt(cx: number, cz: number): number;
  takeOre(cx: number, cz: number, amount: number): number;
}

/** Superweapon charges. `SuperweaponService` implements the first two. */
export interface SuperweaponAccess {
  states(player: PlayerId): readonly { key: string; remaining: number; available: boolean }[];
  grantReady(player: PlayerId, key: string): boolean;
}

/**
 * The one method `SuperweaponService` does NOT have, and the only reason a
 * partially-charged superweapon restores as "still charging from full" rather
 * than "charging from where it was". Duck-typed rather than assumed, so the day
 * the owning module adds it the fidelity arrives with no change here and no
 * schema bump — the seconds are already in the file.
 */
export interface SuperweaponChargeSetter {
  setRemaining(player: PlayerId, key: string, seconds: number): boolean;
}

function hasChargeSetter(v: SuperweaponAccess): v is SuperweaponAccess & SuperweaponChargeSetter {
  return typeof (v as Partial<SuperweaponChargeSetter>).setRemaining === 'function';
}

/** Camera pose. `CameraRig` implements both. */
export interface CameraAccess {
  getPose(): { x: number; z: number; yaw: number; pitch: number; distance: number };
  setPose(pose: { x?: number; z?: number; yaw?: number; distance?: number; immediate?: boolean }): void;
}

/** Prop clearing. `Scatter` implements this signature. */
export interface ScatterAccess {
  clearFootprint(
    minX: number, minZ: number, maxX: number, maxZ: number,
    margin?: number, out?: Float32Array | null,
  ): number;
}

/**
 * The felled-prop mask — the half of `ScatterAccess` that survives a vehicle
 * crush as well as a building footprint. Split out and duck-typed for the same
 * reason `SuperweaponChargeSetter` is: a host that cannot supply it (a test
 * fake, a scatter-less world, a build where the module was cut) simply writes
 * no mask chunk and falls back to the footprint replay, with no schema bump and
 * no optional members threaded through the host type.
 */
export interface FelledPropAccess {
  /** Placements in the generated list, tombstones included. */
  readonly placementCount: number;
  /** Identity of that list. A mask is only valid against a matching one. */
  readonly placementFingerprint: number;
  /** One bit per placement, LSB-first, 1 = felled. Returns bytes written. */
  felledMask(out: Uint8Array): number;
  /** Fell every set bit that is still standing. Returns the count. */
  applyFelledMask(mask: Uint8Array): number;
}

function hasFelledMask(v: ScatterAccess): v is ScatterAccess & FelledPropAccess {
  const p = v as Partial<FelledPropAccess>;
  return typeof p.felledMask === 'function'
    && typeof p.applyFelledMask === 'function'
    && typeof p.placementCount === 'number'
    && typeof p.placementFingerprint === 'number';
}

/** One footprint that has ever been poured, in CELLS. */
export interface ClearedFootprint {
  cx: number; cz: number; w: number; h: number;
}

/**
 * Def key <-> table index, both directions. `defIndexFromTables` builds one from
 * the live `DefTables`; tests build one from a literal.
 */
export interface DefIndex {
  unitKeyOf(defId: number): string;
  unitIdOf(key: string): number;
  buildingKeyOf(defId: number): string;
  buildingIdOf(key: string): number;
  /** Footprint of a building key, for the per-key restore check. */
  buildingFootprint(key: string): { w: number; h: number } | null;
}

/** Build a `DefIndex` over the live def tables. */
export function defIndexFromTables(tables: DefTables): DefIndex {
  return {
    unitKeyOf: (id) => (id >= 0 && id < tables.units.length ? tables.units[id].key : ''),
    unitIdOf: (key) => tables.unitByKey.get(key) ?? -1,
    buildingKeyOf: (id) => (id >= 0 && id < tables.buildings.length ? tables.buildings[id].key : ''),
    buildingIdOf: (key) => tables.buildingByKey.get(key) ?? -1,
    buildingFootprint: (key) => {
      const i = tables.buildingByKey.get(key);
      if (i === undefined) return null;
      const b = tables.buildings[i];
      return { w: b.footprintW, h: b.footprintH };
    },
  };
}

/**
 * Everything a snapshot reads or writes. Assembled by `save.system.ts` from
 * `ctx()`; assembled by tests from a bare `World`. Every optional member is
 * genuinely optional — a snapshot taken without a camera simply carries no
 * camera chunk, and a restore into a world with no fog simply skips the fog.
 */
export interface SnapshotHost {
  world: World;
  /** The match seed. Terrain, roads and scatter are regenerated from it. */
  seed: number;
  tick: number;
  simTimeSec: number;
  /** `IRng.getState()` of the loop's sim RNG. */
  rngState: number;
  /** Index into `GAME_SPEEDS`. */
  speedIndex: number;
  scenario: string;
  map: string;
  defs: DefIndex | null;
  camera: CameraAccess | null;
  vision: VisionAccess | null;
  ore: OreAccess | null;
  scatter: ScatterAccess | null;
  superweapons: SuperweaponAccess | null;
  /** Every footprint ever poured this match. See the header. */
  clearedFootprints: readonly ClearedFootprint[];
}

/** What a restore hands back to its caller so it can re-seat the clocks. */
export interface RestoreOutcome {
  meta: SaveMeta;
  restoreMs: number;
  /** Sim tick the world is now at. Feed this back into `GameLoop`. */
  tick: number;
  simTimeSec: number;
  rngState: number;
  speedIndex: number;
  entityCount: number;
  /** Footprints replayed into the scatter, for the caller to keep accumulating. */
  clearedFootprints: readonly ClearedFootprint[];
}

export interface CaptureOutcome {
  bytes: Uint8Array;
  meta: SaveMeta;
  /** Wall-clock milliseconds the capture took. Reported, not guessed. */
  captureMs: number;
}

/* ==========================================================================
 * 5. CHUNK IDS
 * ========================================================================== */

const CHUNK_MATCH = fourcc('MTCH');
const CHUNK_ENTITIES = fourcc('ENTS');
const CHUNK_PLAYERS = fourcc('PLYR');
const CHUNK_FOG = fourcc('FOGX');
const CHUNK_ORE = fourcc('OREF');
const CHUNK_MISC = fourcc('MISC');
/**
 * The felled-prop mask. A LATER addition, and it needed no schema bump: the
 * chunk stream is length-prefixed and skips ids it does not know, so a build
 * that predates this reads a save carrying it and simply falls back to the
 * footprint replay — which is exactly what it did before the chunk existed.
 */
const CHUNK_SCATTER = fourcc('SCTR');

function fourcc(s: string): number {
  return (
    (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)
  ) >>> 0;
}

/* ==========================================================================
 * 6. ENTITY COLUMNS
 *
 * The entity chunk is self-describing: each column carries its own id and
 * element type, so a build that has never heard of a column skips it and a
 * build that expects one which is absent leaves the store's `alloc` default in
 * place. Neither case needs a schema bump.
 *
 * Handle-valued columns are NOT here — they are remapped by hand below, because
 * a raw copy of `targetId` is precisely the resurrection bug this format exists
 * to prevent.
 * ========================================================================== */

const enum ColType { F32 = 0, I32 = 1, U32 = 2, U8 = 3, U16 = 4, I16 = 5 }

interface ColumnSpec {
  readonly id: number;
  readonly type: ColType;
  readonly of: (s: EntityStore) =>
    Float32Array | Int32Array | Uint32Array | Uint8Array | Uint16Array | Int16Array;
}

function col(
  id: number, type: ColType,
  of: ColumnSpec['of'],
): ColumnSpec {
  return { id, type, of };
}

/**
 * Column ids are FROZEN. Append new ones; never renumber, never reuse. A reused
 * id is a save that loads a turret yaw into a hit-point column.
 */
const COLUMNS: readonly ColumnSpec[] = [
  col(1, ColType.U32, (s) => s.flags),
  col(2, ColType.U8, (s) => s.owner),
  col(3, ColType.U8, (s) => s.faction),
  col(4, ColType.U16, (s) => s.modelId),
  col(5, ColType.F32, (s) => s.seed),
  col(6, ColType.I32, (s) => s.spawnTick),

  col(10, ColType.F32, (s) => s.posX),
  col(11, ColType.F32, (s) => s.posY),
  col(12, ColType.F32, (s) => s.posZ),
  col(13, ColType.F32, (s) => s.yaw),
  col(14, ColType.F32, (s) => s.turretYaw),
  col(15, ColType.F32, (s) => s.barrelPitch),
  col(16, ColType.F32, (s) => s.hullPitch),
  col(17, ColType.F32, (s) => s.hullRoll),

  col(20, ColType.F32, (s) => s.velX),
  col(21, ColType.F32, (s) => s.velZ),
  col(22, ColType.F32, (s) => s.desiredYaw),
  col(23, ColType.F32, (s) => s.speed),
  col(24, ColType.F32, (s) => s.maxSpeed),
  col(25, ColType.F32, (s) => s.accel),
  col(26, ColType.F32, (s) => s.turnRate),
  col(27, ColType.F32, (s) => s.turretTurnRate),
  col(28, ColType.U8, (s) => s.locomotor),
  col(29, ColType.F32, (s) => s.radius),
  col(30, ColType.I16, (s) => s.cellX),
  col(31, ColType.I16, (s) => s.cellZ),
  col(32, ColType.F32, (s) => s.treadPhase),

  col(40, ColType.F32, (s) => s.hp),
  col(41, ColType.F32, (s) => s.maxHp),
  col(42, ColType.U8, (s) => s.armorClass),
  col(43, ColType.F32, (s) => s.sight),
  col(44, ColType.I16, (s) => s.weaponIndex),
  col(45, ColType.F32, (s) => s.cooldown),
  col(46, ColType.U8, (s) => s.burstLeft),
  col(47, ColType.F32, (s) => s.lastHitTime),
  col(48, ColType.U8, (s) => s.veterancy),
  col(49, ColType.U16, (s) => s.killCount),
  col(50, ColType.U8, (s) => s.crushLevel),
  col(51, ColType.U8, (s) => s.crushableBy),

  col(60, ColType.U8, (s) => s.state),
  col(61, ColType.U8, (s) => s.orderKind),
  col(62, ColType.F32, (s) => s.orderX),
  col(63, ColType.F32, (s) => s.orderZ),
  col(64, ColType.U8, (s) => s.stance),
  col(65, ColType.F32, (s) => s.guardX),
  col(66, ColType.F32, (s) => s.guardZ),

  col(70, ColType.F32, (s) => s.cargo),
  col(71, ColType.F32, (s) => s.cargoMax),

  col(80, ColType.F32, (s) => s.buildProgress),
  col(81, ColType.U8, (s) => s.footprintW),
  col(82, ColType.U8, (s) => s.footprintH),
  col(83, ColType.I16, (s) => s.powerDraw),

  col(90, ColType.F32, (s) => s.recoil),
  col(91, ColType.U8, (s) => s.animClip),
  col(92, ColType.F32, (s) => s.animTime),
  col(93, ColType.F32, (s) => s.emissive),
];

/** Columns that hold an `EntityId` and must be remapped, not copied. */
const REF_COLUMNS: readonly { id: number; of: (s: EntityStore) => Int32Array }[] = [
  { id: 200, of: (s) => s.targetId },
  { id: 201, of: (s) => s.orderTarget },
  { id: 202, of: (s) => s.dockTarget },
  { id: 203, of: (s) => s.lastAttackerId },
];

/** `kind` is written separately: `alloc` needs it before any column lands. */
const COL_KIND = 300;
/** Def key index into the chunk's own string table, or -1. */
const COL_DEF_KEY = 301;
/** The raw `defId`, kept as the fallback for kinds with no def key (props). */
const COL_DEF_RAW = 302;

/* ==========================================================================
 * 7. JSON SECTION SHAPES
 * ========================================================================== */

interface MatchSection {
  seed: number;
  tick: number;
  simTimeSec: number;
  rngState: number;
  speedIndex: number;
  scenario: string;
  map: string;
  localPlayer: number;
}

interface QueueItemSection {
  key: string;
  isBuilding: boolean;
  progress: number;
  spent: number;
  cost: number;
  ready: boolean;
  onHold: boolean;
}

interface QueueSection {
  tab: number;
  factoryCount: number;
  awaitingPlacement: boolean;
  items: QueueItemSection[];
}

interface PlayerSection {
  id: number;
  faction: number;
  name: string;
  isHuman: boolean;
  isLocal: boolean;
  defeated: boolean;
  allyMask: number;
  credits: number;
  storageMax: number;
  powerProduced: number;
  powerConsumed: number;
  buildSpeedMul: number;
  hasRadar: boolean;
  aiDifficulty: number;
  aiPersonality: number;
  queues: QueueSection[];
  /** Sparse: [index, value] pairs over the 256-byte tech mask. */
  techMask: number[];
  /** Sparse: [defIndex, count] pairs. Restored by KEY where one resolves. */
  buildingCount: number[];
  buildingCountKeys: string[];
  entityCount: number[];
  /** Rally points: [factorySaveIndex, x, z] triples. */
  rally: number[];
  stats: Record<string, number>;
  /**
   * In-match upgrades this player has bought, BY CONTENT KEY.
   *
   * Keys and not the raw bitmask, for the reason `buildingCountKeys` exists: a
   * later build that inserts a row would otherwise hand the loaded player a
   * different upgrade than the one they paid for, silently and permanently.
   * Keys survive any reordering of `UPGRADES`, and an unknown one is dropped.
   *
   * OPTIONAL, so a save written before upgrades existed still loads: it arrives
   * `undefined`, `restorePlayer` reads it as empty, and the player has none —
   * which is exactly true of that save. No SAVE_SCHEMA_VERSION bump: the
   * players chunk is JSON and this is a purely additive key.
   */
  upgradeKeys?: string[];
}

interface SuperweaponSection {
  player: number;
  key: string;
  remaining: number;
}

interface MiscSection {
  camera: { x: number; z: number; yaw: number; pitch: number; distance: number } | null;
  /** Selection, as save-local entity indices. */
  selection: number[];
  selectionGroups: number[][];
  /** Cleared footprints, flattened as cx,cz,w,h. */
  cleared: number[];
  superweapons: SuperweaponSection[];
}

/* ==========================================================================
 * 8. BYTE PLUMBING
 * ========================================================================== */

/** Thrown only inside this file; every entry point converts it to a refusal. */
class ReadError extends Error {}

class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initialBytes = 1 << 16) {
    this.buf = new Uint8Array(initialBytes);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length === 0 ? 1024 : this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void { this.ensure(1); this.view.setUint8(this.pos, v & 0xff); this.pos += 1; }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.pos, v & 0xffff, true); this.pos += 2; }
  u32(v: number): void { this.ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  i32(v: number): void { this.ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; }

  bytes(src: Uint8Array): void {
    this.ensure(src.length);
    this.buf.set(src, this.pos);
    this.pos += src.length;
  }

  /** Pad with zeroes to the next 4-byte boundary. Typed-array views need it. */
  align4(): void {
    while ((this.pos & 3) !== 0) this.u8(0);
  }

  patchU32(offset: number, v: number): void {
    this.view.setUint32(offset, v >>> 0, true);
  }

  get length(): number { return this.pos; }

  /** A copy sized exactly to the content. */
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

class ByteReader {
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array, private pos = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new ReadError('past the end of the file');
  }

  u8(): number { this.need(1); const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  u16(): number { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32(): number { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }

  /** A copy, so alignment of the source view never matters. */
  slice(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  skip(n: number): void { this.need(n); this.pos += n; }
  align4(): void { while ((this.pos & 3) !== 0) this.skip(1); }

  get offset(): number { return this.pos; }
  get remaining(): number { return this.bytes.length - this.pos; }
  seek(p: number): void {
    if (p < 0 || p > this.bytes.length) throw new ReadError('seek past the end of the file');
    this.pos = p;
  }
}

/* -- crc32 ----------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fnv1aNumbers(values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    let v = values[i] | 0;
    for (let b = 0; b < 4; b++) {
      h = (h ^ (v & 0xff)) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
      v >>>= 8;
    }
  }
  return h >>> 0;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function writeJson(w: ByteWriter, value: unknown): void {
  const encoded = TEXT_ENCODER.encode(JSON.stringify(value));
  w.u32(encoded.length);
  w.bytes(encoded);
  w.align4();
}

function readJsonText(r: ByteReader): string {
  const n = r.u32();
  const raw = r.slice(n);
  r.align4();
  return TEXT_DECODER.decode(raw);
}

/* ==========================================================================
 * 9. CAPTURE
 * ========================================================================== */

/** Wall clock in ms. Capture never runs inside `simTick`, so this is legal. */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Snapshot a live match.
 *
 * NEVER call this from `simTick`: it allocates the whole blob, and doing that on
 * the sim path is a visible hitch. `save.system.ts` calls it from `frame()`.
 */
export function captureSnapshot(
  host: SnapshotHost,
  label: string,
): SaveResult<CaptureOutcome> {
  const t0 = nowMs();
  const world = host.world;
  const store = world.store;

  if (world.players.length === 0) {
    return refuse('no-match', 'There is no match running to save.');
  }

  /* -- 1. the live set, in dense order ---------------------------------- */
  // `alloc` hands slots back in ascending order, so the save is written in
  // ascending slot order too. That is not required for correctness — every
  // reference goes through the save-local index — but it keeps a diff of two
  // consecutive autosaves readable, which matters the first time one is wrong.
  const live: number[] = [];
  for (let a = 0; a < store.aliveCount; a++) {
    const i = store.alive[a];
    const f = store.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & EntityFlag.PendingDestroy) !== 0) continue;
    live.push(i);
  }
  live.sort((a, b) => a - b);

  const n = live.length;
  /** slot -> save-local index, or -1. Sized to the store so lookup is O(1). */
  const localOf = new Int32Array(MAX_ENTITIES).fill(-1);
  for (let k = 0; k < n; k++) localOf[live[k]] = k;

  const w = new ByteWriter(Math.max(1 << 16, n * 220));

  /* -- 2. header placeholder -------------------------------------------- */
  w.u8(MAGIC_0); w.u8(MAGIC_1); w.u8(MAGIC_2); w.u8(MAGIC_3);
  w.u16(SAVE_SCHEMA_VERSION);
  w.u16(0);
  w.u32(structuralHash());
  const bodyLenAt = w.length; w.u32(0);
  const bodyCrcAt = w.length; w.u32(0);

  const localPlayer = world.localPlayer as number;
  const localState = world.players[localPlayer] ?? world.players[0];
  const meta: SaveMeta = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    structuralHash: structuralHash(),
    label,
    savedAtMs: Date.now(),
    tick: host.tick,
    simTimeSec: host.simTimeSec,
    scenario: host.scenario,
    map: host.map,
    seed: host.seed,
    localPlayerName: localState.name,
    localFaction: localState.faction as number,
    credits: Math.round(localState.credits),
    entityCount: n,
    byteLength: 0,
  };
  writeJson(w, meta);
  const bodyStart = w.length;

  /* -- 3. chunks --------------------------------------------------------- */
  writeChunk(w, CHUNK_MATCH, (c) => {
    const section: MatchSection = {
      seed: host.seed,
      tick: host.tick,
      simTimeSec: host.simTimeSec,
      rngState: host.rngState >>> 0,
      speedIndex: host.speedIndex,
      scenario: host.scenario,
      map: host.map,
      localPlayer,
    };
    writeJson(c, section);
  });

  writeChunk(w, CHUNK_ENTITIES, (c) => writeEntities(c, store, live, localOf, host.defs));
  writeChunk(w, CHUNK_PLAYERS, (c) => {
    writeJson(c, world.players.map((p) => capturePlayer(p, localOf, store, host.defs)));
  });

  if (host.vision !== null) {
    const chunk = captureFog(host.vision, world.players.length);
    if (chunk !== null) writeChunk(w, CHUNK_FOG, (c) => c.bytes(chunk));
  }
  if (host.ore !== null) {
    writeChunk(w, CHUNK_ORE, (c) => captureOre(c, host.ore as OreAccess));
  }
  if (host.scatter !== null && hasFelledMask(host.scatter)) {
    const chunk = captureFelledProps(host.scatter);
    if (chunk !== null) writeChunk(w, CHUNK_SCATTER, (c) => c.bytes(chunk));
  }

  writeChunk(w, CHUNK_MISC, (c) => {
    writeJson(c, captureMisc(host, world, localOf));
  });

  /* -- 4. seal ----------------------------------------------------------- */
  const bytes = w.toBytes();
  const bodyLength = bytes.length - bodyStart;
  const body = bytes.subarray(bodyStart);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(bodyLenAt, bodyLength >>> 0, true);
  view.setUint32(bodyCrcAt, crc32(body), true);

  meta.byteLength = bytes.length;

  return { ok: true, value: { bytes, meta, captureMs: nowMs() - t0 } };
}

/** Write one chunk, back-patching its length once the body is known. */
function writeChunk(w: ByteWriter, id: number, body: (c: ByteWriter) => void): void {
  w.u32(id);
  const lenAt = w.length;
  w.u32(0);
  const start = w.length;
  body(w);
  w.align4();
  w.patchU32(lenAt, w.length - start);
}

/* -- entities -------------------------------------------------------------- */

function writeEntities(
  w: ByteWriter,
  store: EntityStore,
  live: readonly number[],
  localOf: Int32Array,
  defs: DefIndex | null,
): void {
  const n = live.length;
  w.u32(n);

  /* String table: the def keys this snapshot refers to. Keys, not indexes —
   * see the header's note on def-table growth. */
  const keys: string[] = [];
  const keyIndex = new Map<string, number>();
  const defKeyCol = new Int32Array(n);
  const defRawCol = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const i = live[k];
    const raw = store.defId[i];
    defRawCol[k] = raw;
    let key = '';
    if (defs !== null && raw >= 0) {
      const kind = store.kind[i];
      if (kind === EntityKind.Building) key = defs.buildingKeyOf(raw);
      else if (kind === EntityKind.Infantry || kind === EntityKind.Vehicle) key = defs.unitKeyOf(raw);
    }
    if (key === '') { defKeyCol[k] = -1; continue; }
    let idx = keyIndex.get(key);
    if (idx === undefined) { idx = keys.length; keys.push(key); keyIndex.set(key, idx); }
    defKeyCol[k] = idx;
  }
  writeJson(w, keys);

  /* Columns. Count is back-patched so appending one later needs no bump. */
  const countAt = w.length;
  w.u32(0);
  let written = 0;

  // `kind` first: the restore needs it before it can call `alloc`.
  const kindCol = new Uint8Array(n);
  for (let k = 0; k < n; k++) kindCol[k] = store.kind[live[k]];
  writeColumn(w, COL_KIND, ColType.U8, kindCol); written++;

  writeColumn(w, COL_DEF_KEY, ColType.I32, defKeyCol); written++;
  writeColumn(w, COL_DEF_RAW, ColType.I32, defRawCol); written++;

  for (let c = 0; c < COLUMNS.length; c++) {
    const spec = COLUMNS[c];
    const src = spec.of(store);
    const dst = makeTyped(spec.type, n);
    for (let k = 0; k < n; k++) dst[k] = src[live[k]];
    writeColumn(w, spec.id, spec.type, dst);
    written++;
  }

  for (let c = 0; c < REF_COLUMNS.length; c++) {
    const spec = REF_COLUMNS[c];
    const src = spec.of(store);
    const dst = new Int32Array(n);
    for (let k = 0; k < n; k++) dst[k] = refOf(store, localOf, src[live[k]] as EntityId);
    writeColumn(w, spec.id, ColType.I32, dst);
    written++;
  }

  w.patchU32(countAt, written);
}

/**
 * A stored handle -> its save-local reference. `0` is "nothing", so a live
 * entity's reference is `index + 1`.
 *
 * A handle that no longer resolves — or resolves to something already marked
 * dead — becomes 0. That is not data loss: a stale `targetId` was already
 * meaningless, and writing it out would be the one way to make it meaningful
 * again on the far side.
 */
function refOf(store: EntityStore, localOf: Int32Array, h: EntityId): number {
  if ((h as number) === 0) return 0;
  const i = store.index(h);
  if (i < 0) return 0;
  const local = localOf[i];
  return local < 0 ? 0 : local + 1;
}

function makeTyped(
  type: ColType, n: number,
): Float32Array | Int32Array | Uint32Array | Uint8Array | Uint16Array | Int16Array {
  switch (type) {
    case ColType.F32: return new Float32Array(n);
    case ColType.I32: return new Int32Array(n);
    case ColType.U32: return new Uint32Array(n);
    case ColType.U8: return new Uint8Array(n);
    case ColType.U16: return new Uint16Array(n);
    default: return new Int16Array(n);
  }
}

function writeColumn(
  w: ByteWriter, id: number, type: ColType,
  data: Float32Array | Int32Array | Uint32Array | Uint8Array | Uint16Array | Int16Array,
): void {
  w.u32(id);
  w.u32(type);
  const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  w.u32(raw.length);
  w.bytes(raw);
  w.align4();
}

/* -- players --------------------------------------------------------------- */

function capturePlayer(
  p: PlayerState, localOf: Int32Array, store: EntityStore, defs: DefIndex | null,
): PlayerSection {
  const techMask: number[] = [];
  for (let i = 0; i < p.techMask.length; i++) {
    if (p.techMask[i] !== 0) { techMask.push(i, p.techMask[i]); }
  }

  const buildingCount: number[] = [];
  const buildingCountKeys: string[] = [];
  for (let i = 0; i < p.buildingCount.length; i++) {
    if (p.buildingCount[i] === 0) continue;
    buildingCount.push(i, p.buildingCount[i]);
    buildingCountKeys.push(defs === null ? '' : defs.buildingKeyOf(i));
  }

  const entityCount: number[] = [];
  for (let i = 0; i < p.entityCount.length; i++) entityCount.push(p.entityCount[i]);

  /* Rally points are keyed by factory handle. Remap through the save-local
   * index or drop the entry — a rally point on a factory that is not in this
   * snapshot would re-attach to whatever took its slot. */
  const rally: number[] = [];
  for (const [key, x] of p.rallyX) {
    const ref = refOf(store, localOf, key as EntityId);
    if (ref === 0) continue;
    const z = p.rallyZ.get(key);
    if (z === undefined) continue;
    rally.push(ref - 1, x, z);
  }

  return {
    id: p.id as number,
    faction: p.faction as number,
    name: p.name,
    isHuman: p.isHuman,
    isLocal: p.isLocal,
    defeated: p.defeated,
    allyMask: p.allyMask,
    credits: p.credits,
    storageMax: p.storageMax,
    powerProduced: p.powerProduced,
    powerConsumed: p.powerConsumed,
    buildSpeedMul: p.buildSpeedMul,
    hasRadar: p.hasRadar,
    aiDifficulty: p.aiDifficulty,
    aiPersonality: p.aiPersonality,
    queues: p.queues.map((q) => captureQueue(q, defs)),
    techMask,
    buildingCount,
    buildingCountKeys,
    entityCount,
    rally,
    stats: { ...p.stats } as unknown as Record<string, number>,
    upgradeKeys: ownedUpgradeKeys(p, []),
  };
}

function captureQueue(q: ProductionQueue, defs: DefIndex | null): QueueSection {
  return {
    tab: q.tab as number,
    factoryCount: q.factoryCount,
    awaitingPlacement: q.awaitingPlacement,
    items: q.items.map((it) => ({
      // Mid-progress queue items are the single most annoying thing to lose, and
      // the single easiest thing to corrupt: a raw `defId` here would silently
      // become a different unit the moment the table grew.
      key: defs === null
        ? ''
        : (it.isBuilding ? defs.buildingKeyOf(it.defId) : defs.unitKeyOf(it.defId)),
      isBuilding: it.isBuilding,
      progress: it.progress,
      spent: it.spent,
      cost: it.cost,
      ready: it.ready,
      onHold: it.onHold,
    })),
  };
}

/* -- fog ------------------------------------------------------------------- */

/**
 * The EXPLORED bitplane per player, byte-RLE'd.
 *
 * Only the explored bit is stored. The `visible` bit is re-stamped from unit
 * positions on the next vision pass — within 100 ms of the load, before a frame
 * the player could act on — so storing it would double the largest section in
 * the file to buy a tenth of a second. Explored is the part that is MEMORY and
 * cannot be re-derived from anything.
 *
 * A byte grid across four players is 64 kB. Packed to one bit per cell it is
 * 2 kB per player, and explored grids are almost entirely runs of 0x00 and
 * 0xFF, so the RLE typically lands under 400 bytes each.
 */
function captureFog(vision: VisionAccess, playerCount: number): Uint8Array | null {
  const w = new ByteWriter(8192);
  const planes: { player: number; rle: Uint8Array }[] = [];

  const packed = new Uint8Array(MAP_CELL_COUNT >> 3);
  for (let p = 0; p < playerCount && p < MAX_PLAYERS; p++) {
    const grid = vision.gridFor(p as PlayerId);
    if (grid === undefined || grid.length < MAP_CELL_COUNT) continue;
    packed.fill(0);
    let any = false;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      // VIS_EXPLORED is bit 1 of the 2-bit grid byte. Owned by sim/Vision.ts;
      // this file reads the port's documented layout and never writes it.
      if ((grid[i] & 0b10) === 0) continue;
      packed[i >> 3] |= 1 << (i & 7);
      any = true;
    }
    if (!any) continue;
    planes.push({ player: p, rle: rleEncode(packed) });
  }

  if (planes.length === 0) return null;
  w.u32(planes.length);
  for (const plane of planes) {
    w.u32(plane.player);
    w.u32(plane.rle.length);
    w.bytes(plane.rle);
    w.align4();
  }
  return w.toBytes();
}

function rleEncode(src: Uint8Array): Uint8Array {
  const out = new ByteWriter(src.length + 64);
  let i = 0;
  while (i < src.length) {
    const v = src[i];
    let run = 1;
    while (i + run < src.length && src[i + run] === v && run < 255) run++;
    out.u8(run);
    out.u8(v);
    i += run;
  }
  return out.toBytes();
}

function rleDecode(src: Uint8Array, expectedBytes: number, what = 'fog plane'): Uint8Array {
  const out = new Uint8Array(expectedBytes);
  let o = 0;
  for (let i = 0; i + 1 < src.length; i += 2) {
    const run = src[i];
    const v = src[i + 1];
    for (let k = 0; k < run && o < expectedBytes; k++) out[o++] = v;
  }
  if (o !== expectedBytes) throw new ReadError(`${what} is the wrong size`);
  return out;
}

/* -- felled props ---------------------------------------------------------- */

/**
 * One bit per prop placement, 1 = felled — by a building footprint, by a
 * vehicle crush, or by both. See the file header and `Scatter.ts` §3.10b.
 *
 * The mask is RLE'd only when that is actually smaller. A bitmask with a felled
 * prop every few bytes defeats a run encoder, and silently shipping 2x the
 * bytes for the tidiness of always compressing is the wrong trade on a payload
 * an autosave ring rewrites every few minutes. One `u32` says which it is.
 */
function captureFelledProps(scatter: ScatterAccess & FelledPropAccess): Uint8Array | null {
  const count = scatter.placementCount;
  if (count <= 0) return null;
  const bytes = (count + 7) >> 3;
  const raw = new Uint8Array(bytes);
  // 0 means the mask could not be written whole. A partial mask fells the wrong
  // props, so write no chunk at all and let the footprint replay stand in.
  if (scatter.felledMask(raw) !== bytes) return null;

  const rle = rleEncode(raw);
  const compressed = rle.length < raw.length;
  const body = compressed ? rle : raw;

  const w = new ByteWriter(body.length + 32);
  w.u32(count);
  w.u32(scatter.placementFingerprint >>> 0);
  w.u32(compressed ? 1 : 0);
  w.u32(body.length);
  w.bytes(body);
  return w.toBytes();
}

interface ScatterSection {
  placementCount: number;
  fingerprint: number;
  mask: Uint8Array;
}

function readScatterSection(r: ByteReader): ScatterSection {
  const placementCount = r.u32();
  const fingerprint = r.u32();
  const compressed = r.u32();
  const length = r.u32();
  const body = r.slice(length);
  const bytes = (placementCount + 7) >> 3;
  const mask = compressed === 1 ? rleDecode(body, bytes, 'the felled-prop mask') : body;
  if (mask.length < bytes) throw new ReadError('the felled-prop mask is the wrong size');
  return { placementCount, fingerprint, mask };
}

/**
 * Put the felled props back down. Returns true when the mask was applied, which
 * is the caller's signal that the footprint replay is redundant — the mask is a
 * superset of it, because a footprint clear tombstones the same placements.
 *
 * Every reason to refuse is a reason the mask would fell the WRONG props, so
 * each one falls through to the replay rather than doing nothing.
 */
function applyFelledProps(section: ScatterSection | null, scatter: ScatterAccess | null): boolean {
  if (section === null || scatter === null || !hasFelledMask(scatter)) return false;
  if (section.placementCount !== scatter.placementCount
    || section.fingerprint !== (scatter.placementFingerprint >>> 0)) {
    console.warn(
      `[save] this save's prop scatter (${section.placementCount} placements, ` +
      `#${section.fingerprint.toString(16)}) is not the one this match generated ` +
      `(${scatter.placementCount}, #${(scatter.placementFingerprint >>> 0).toString(16)}). ` +
      'Falling back to the building-footprint replay; crushed vegetation will stand again.',
    );
    return false;
  }
  scatter.applyFelledMask(section.mask);
  return true;
}

/* -- ore ------------------------------------------------------------------- */

/**
 * Ore remaining, as a sparse (cell, amount) list.
 *
 * The FIELDS are regenerated from the seed by the scenario, so what has to
 * survive is the DEPLETION — otherwise a forty-minute match reloads with every
 * mined-out patch full again, which is a straightforward economy exploit as
 * well as a wrong world. Only cells that still hold ore are written; the restore
 * takes every regenerated cell down to the number in the file.
 */
function captureOre(w: ByteWriter, ore: OreAccess): void {
  const cells: number[] = [];
  const amounts: number[] = [];
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      const v = ore.oreAt(cx, cz);
      if (v <= 0) continue;
      cells.push(cz * MAP_CELLS + cx);
      amounts.push(v);
    }
  }
  const n = cells.length;
  w.u32(n);
  w.align4();
  const cellArr = Int32Array.from(cells);
  const amtArr = Float32Array.from(amounts);
  w.bytes(new Uint8Array(cellArr.buffer, 0, cellArr.byteLength));
  w.bytes(new Uint8Array(amtArr.buffer, 0, amtArr.byteLength));
}

/* -- misc ------------------------------------------------------------------ */

function captureMisc(host: SnapshotHost, world: World, localOf: Int32Array): MiscSection {
  const sel = world.selection;
  const store = world.store;

  const selection: number[] = [];
  for (let i = 0; i < sel.count && i < MAX_SELECTION; i++) {
    const ref = refOf(store, localOf, sel.ids[i] as EntityId);
    if (ref !== 0) selection.push(ref - 1);
  }

  const selectionGroups: number[][] = [];
  for (let g = 0; g < CONTROL_GROUP_COUNT; g++) {
    const out: number[] = [];
    const count = sel.groupCounts[g];
    for (let i = 0; i < count && i < MAX_SELECTION; i++) {
      const ref = refOf(store, localOf, sel.groups[g][i] as EntityId);
      if (ref !== 0) out.push(ref - 1);
    }
    selectionGroups.push(out);
  }

  const cleared: number[] = [];
  for (const rect of host.clearedFootprints) {
    cleared.push(rect.cx, rect.cz, rect.w, rect.h);
  }

  const superweapons: SuperweaponSection[] = [];
  if (host.superweapons !== null) {
    for (let p = 0; p < world.players.length; p++) {
      const states = host.superweapons.states(p as PlayerId);
      for (const st of states) {
        if (!st.available) continue;
        superweapons.push({ player: p, key: st.key, remaining: st.remaining });
      }
    }
  }

  return {
    camera: host.camera === null ? null : { ...host.camera.getPose() },
    selection,
    selectionGroups,
    cleared,
    superweapons,
  };
}

/* ==========================================================================
 * 10. READING THE HEADER
 * ========================================================================== */

interface ParsedHeader {
  meta: SaveMeta;
  bodyStart: number;
  bodyLength: number;
}

function parseHeader(bytes: Uint8Array): SaveResult<ParsedHeader> {
  if (bytes.length < HEADER_FIXED_BYTES) {
    return refuse('truncated', 'This file is too short to be a saved game.');
  }
  if (
    bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1 ||
    bytes[2] !== MAGIC_2 || bytes[3] !== MAGIC_3
  ) {
    return refuse('not-a-save', 'This file is not a VOLTMARCH saved game.');
  }

  let header: {
    schema: number; hash: number; bodyLength: number; bodyCrc: number; metaText: string;
    bodyStart: number;
  };
  try {
    const r = new ByteReader(bytes, 4);
    const schema = r.u16();
    r.u16(); // reserved flags
    const hash = r.u32();
    const bodyLength = r.u32();
    const bodyCrc = r.u32();
    const metaText = readJsonText(r);
    header = { schema, hash, bodyLength, bodyCrc, metaText, bodyStart: r.offset };
  } catch {
    return refuse('truncated', 'This saved game is incomplete and cannot be read.');
  }

  if (header.schema !== SAVE_SCHEMA_VERSION) {
    return refuse(
      'schema-mismatch',
      `This save was written by save format ${header.schema}; this build reads ` +
      `format ${SAVE_SCHEMA_VERSION}. It cannot be loaded.`,
    );
  }
  if (header.hash !== structuralHash()) {
    return refuse(
      'build-mismatch',
      'This save was written by a different build of the game, and the world it ' +
      'describes no longer fits this one. It cannot be loaded.',
    );
  }
  if (header.bodyStart + header.bodyLength > bytes.length) {
    return refuse('truncated', 'This saved game is incomplete and cannot be read.');
  }

  const body = bytes.subarray(header.bodyStart, header.bodyStart + header.bodyLength);
  if (crc32(body) !== header.bodyCrc) {
    return refuse('corrupt', 'This saved game is damaged and cannot be loaded.');
  }

  let meta: SaveMeta;
  try {
    meta = JSON.parse(header.metaText) as SaveMeta;
  } catch {
    return refuse('corrupt', 'This saved game is damaged and cannot be loaded.');
  }
  if (typeof meta !== 'object' || meta === null || typeof meta.tick !== 'number') {
    return refuse('corrupt', 'This saved game is damaged and cannot be loaded.');
  }
  meta.byteLength = bytes.length;

  return {
    ok: true,
    value: { meta, bodyStart: header.bodyStart, bodyLength: header.bodyLength },
  };
}

/** Validate and read just the metadata. Cheap: it never touches the body. */
export function readSnapshotMeta(bytes: Uint8Array): SaveResult<SaveMeta> {
  const parsed = parseHeader(bytes);
  return parsed.ok ? { ok: true, value: parsed.value.meta } : parsed;
}

/* ==========================================================================
 * 11. RESTORE
 * ========================================================================== */

export interface RestoreOptions {
  /**
   * Refuse when the running world was not built from the same scenario, map and
   * seed. Default true, and it should stay true: terrain is regenerated, so
   * restoring a base onto a different heightfield puts buildings inside cliffs.
   */
  requireMatchingWorld?: boolean;
}

/**
 * Put a snapshot back into a running match.
 *
 * The world must ALREADY have been built from the save's scenario/map/seed —
 * terrain, roads and scatter are regenerated, not stored. `save.system.ts`
 * enforces that ordering; this function verifies it and refuses otherwise.
 */
export function restoreSnapshot(
  bytes: Uint8Array,
  host: SnapshotHost,
  options: RestoreOptions = {},
): SaveResult<RestoreOutcome> {
  const t0 = nowMs();

  const parsed = parseHeader(bytes);
  if (!parsed.ok) return parsed;
  const meta = parsed.value.meta;

  if (options.requireMatchingWorld !== false) {
    if (meta.scenario !== host.scenario || meta.map !== host.map || meta.seed !== host.seed) {
      return refuse(
        'world-mismatch',
        `This save is a "${meta.scenario}" match on "${meta.map}" (seed ${meta.seed}), ` +
        `but the running match is "${host.scenario}" on "${host.map}" (seed ${host.seed}). ` +
        'Start the right match first.',
      );
    }
  }

  let sections: Sections;
  try {
    sections = readSections(bytes, parsed.value.bodyStart, parsed.value.bodyLength);
  } catch (err) {
    return refuse(
      'corrupt',
      `This saved game is damaged and cannot be loaded (${err instanceof Error ? err.message : 'unreadable'}).`,
    );
  }

  if (sections.match === null || sections.entities === null || sections.players === null) {
    return refuse('corrupt', 'This saved game is missing part of the match and cannot be loaded.');
  }
  if (sections.entities.count > MAX_ENTITIES) {
    return refuse(
      'too-many-entities',
      `This save holds ${sections.entities.count} units, more than the ${MAX_ENTITIES} ` +
      'this build can hold. It cannot be loaded.',
    );
  }

  /* -- def keys must still resolve, by NAME ------------------------------ */
  const check = validateContent(sections, host.defs);
  if (!check.ok) return check;

  const applied = applySections(sections, host, meta);
  if (!applied.ok) return applied;

  return {
    ok: true,
    value: {
      meta,
      restoreMs: nowMs() - t0,
      tick: sections.match.tick,
      simTimeSec: sections.match.simTimeSec,
      rngState: sections.match.rngState >>> 0,
      speedIndex: sections.match.speedIndex,
      entityCount: sections.entities.count,
      clearedFootprints: applied.value,
    },
  };
}

/* -- section decoding ------------------------------------------------------ */

interface EntityColumn {
  id: number;
  type: ColType;
  data: Uint8Array;
}

interface EntitySection {
  count: number;
  keys: string[];
  columns: EntityColumn[];
}

interface Sections {
  match: MatchSection | null;
  entities: EntitySection | null;
  players: PlayerSection[] | null;
  fog: { player: number; packed: Uint8Array }[];
  ore: { cells: Int32Array; amounts: Float32Array } | null;
  misc: MiscSection | null;
  scatter: ScatterSection | null;
}

function readSections(bytes: Uint8Array, start: number, length: number): Sections {
  const out: Sections = {
    match: null, entities: null, players: null, fog: [], ore: null, misc: null, scatter: null,
  };
  const r = new ByteReader(bytes.subarray(start, start + length));

  while (r.remaining >= 8) {
    const id = r.u32();
    const len = r.u32();
    const payloadStart = r.offset;
    if (len > r.remaining) throw new ReadError('a section runs past the end of the file');
    const payload = new ByteReader(bytes.subarray(start + payloadStart, start + payloadStart + len));

    switch (id) {
      case CHUNK_MATCH:
        out.match = JSON.parse(readJsonText(payload)) as MatchSection;
        break;
      case CHUNK_ENTITIES:
        out.entities = readEntitySection(payload);
        break;
      case CHUNK_PLAYERS:
        out.players = JSON.parse(readJsonText(payload)) as PlayerSection[];
        break;
      case CHUNK_FOG:
        out.fog = readFogSection(payload);
        break;
      case CHUNK_ORE:
        out.ore = readOreSection(payload);
        break;
      case CHUNK_MISC:
        out.misc = JSON.parse(readJsonText(payload)) as MiscSection;
        break;
      case CHUNK_SCATTER:
        out.scatter = readScatterSection(payload);
        break;
      default:
        // An unknown chunk is a chunk a later build wrote. Skipping it is the
        // whole reason the stream is length-prefixed.
        break;
    }

    r.seek(payloadStart + len);
    r.align4();
  }
  return out;
}

function readEntitySection(r: ByteReader): EntitySection {
  const count = r.u32();
  const keys = JSON.parse(readJsonText(r)) as string[];
  const columnCount = r.u32();
  const columns: EntityColumn[] = [];
  for (let c = 0; c < columnCount; c++) {
    const id = r.u32();
    const type = r.u32() as ColType;
    const byteLength = r.u32();
    const data = r.slice(byteLength);
    r.align4();
    columns.push({ id, type, data });
  }
  return { count, keys, columns };
}

function readFogSection(r: ByteReader): { player: number; packed: Uint8Array }[] {
  const n = r.u32();
  const out: { player: number; packed: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const player = r.u32();
    const rleLength = r.u32();
    const rle = r.slice(rleLength);
    r.align4();
    out.push({ player, packed: rleDecode(rle, MAP_CELL_COUNT >> 3) });
  }
  return out;
}

function readOreSection(r: ByteReader): { cells: Int32Array; amounts: Float32Array } {
  const n = r.u32();
  r.align4();
  const cellBytes = r.slice(n * 4);
  const amtBytes = r.slice(n * 4);
  return {
    cells: new Int32Array(cellBytes.buffer, cellBytes.byteOffset, n),
    amounts: new Float32Array(amtBytes.buffer, amtBytes.byteOffset, n),
  };
}

/* -- per-key content validation -------------------------------------------- */

/**
 * THE GATE THAT MATTERS. The schema version catches a deliberate format change
 * and the structural hash catches an engine change, but neither notices that
 * `mrdMonitor` was renamed or that the Refinery went from 3x2 to 3x3. That is
 * what silently loads WRONG, so it is checked by name, and a failure says which
 * name.
 */
function validateContent(sections: Sections, defs: DefIndex | null): SaveResult<true> {
  if (defs === null) return { ok: true, value: true };
  const ents = sections.entities;
  if (ents === null) return { ok: true, value: true };

  for (const key of ents.keys) {
    if (key === '') continue;
    const unit = defs.unitIdOf(key);
    const building = defs.buildingIdOf(key);
    if (unit < 0 && building < 0) {
      return refuse(
        'content-missing',
        `This save contains "${key}", which no longer exists in this build of the ` +
        'game. Loading it would put a different unit in its place, so it is refused.',
      );
    }
  }

  /* Building footprints are the one def field a save's geometry depends on:
   * the terrain occupancy grid is re-marked from `footprintW/H`, and a def that
   * changed size would claim the wrong cells. */
  const kindCol = findColumn(ents, COL_KIND);
  const defKeyCol = findColumn(ents, COL_DEF_KEY);
  const fwCol = findColumn(ents, 81);
  const fhCol = findColumn(ents, 82);
  if (kindCol !== null && defKeyCol !== null && fwCol !== null && fhCol !== null) {
    const kinds = viewOf(kindCol, ents.count);
    const defKeys = viewOf(defKeyCol, ents.count);
    const fw = viewOf(fwCol, ents.count);
    const fh = viewOf(fhCol, ents.count);
    for (let k = 0; k < ents.count; k++) {
      if (kinds[k] !== EntityKind.Building) continue;
      const ki = defKeys[k];
      if (ki < 0 || ki >= ents.keys.length) continue;
      const key = ents.keys[ki];
      const fp = defs.buildingFootprint(key);
      if (fp === null) continue;
      if (fp.w !== fw[k] || fp.h !== fh[k]) {
        return refuse(
          'content-changed',
          `"${key}" is now ${fp.w}x${fp.h} cells but this save has it at ` +
          `${fw[k]}x${fh[k]}. The base in this save no longer fits the map, so it ` +
          'is refused rather than loaded wrongly.',
        );
      }
    }
  }

  return { ok: true, value: true };
}

function findColumn(ents: EntitySection, id: number): EntityColumn | null {
  for (const c of ents.columns) if (c.id === id) return c;
  return null;
}

/** A typed view over a column's bytes. Copies, so alignment is never an issue. */
function viewOf(
  c: EntityColumn, n: number,
): Float32Array | Int32Array | Uint32Array | Uint8Array | Uint16Array | Int16Array {
  const b = c.data;
  switch (c.type) {
    case ColType.F32: return new Float32Array(b.buffer, b.byteOffset, Math.min(n, b.byteLength >> 2));
    case ColType.I32: return new Int32Array(b.buffer, b.byteOffset, Math.min(n, b.byteLength >> 2));
    case ColType.U32: return new Uint32Array(b.buffer, b.byteOffset, Math.min(n, b.byteLength >> 2));
    case ColType.U16: return new Uint16Array(b.buffer, b.byteOffset, Math.min(n, b.byteLength >> 1));
    case ColType.I16: return new Int16Array(b.buffer, b.byteOffset, Math.min(n, b.byteLength >> 1));
    default: return new Uint8Array(b.buffer, b.byteOffset, Math.min(n, b.byteLength));
  }
}

/* -- applying -------------------------------------------------------------- */

/** Advance a generation exactly the way `EntityStore.flushDestroyed` does. */
function bumpGen(g: number): number {
  const next = (g + 1) & 0xfff;
  return next === 0 ? 1 : next;
}

function applySections(
  sections: Sections, host: SnapshotHost, meta: SaveMeta,
): SaveResult<readonly ClearedFootprint[]> {
  const world = host.world;
  const store = world.store;
  const ents = sections.entities as EntitySection;
  const match = sections.match as MatchSection;
  const players = sections.players as PlayerSection[];

  /* -- 1. release what the running match claimed ------------------------- */
  // The occupancy grid is the one piece of world state a `store.reset()` cannot
  // clear, because it lives in terrain and is keyed by cell, not by entity.
  // Every standing building has to hand its cells back before the store forgets
  // which cells those were.
  const originScratch = new Int32Array(2);
  for (let a = 0; a < store.aliveCount; a++) {
    const i = store.alive[a];
    if (store.footprintW[i] <= 0) continue;
    footprintOriginCell(
      store.posX[i], store.posZ[i], store.footprintW[i], store.footprintH[i], originScratch,
    );
    world.terrain.clearOccupied(
      originScratch[0], originScratch[1], store.footprintW[i], store.footprintH[i],
    );
  }

  /* -- 2. snapshot the generations we must invalidate -------------------- */
  // Taken BEFORE `reset()`, which sets every generation back to 1. See rule B
  // in the file header: after the restore, every slot must carry a generation
  // no handle in this process has ever seen.
  const preGen = new Uint16Array(MAX_ENTITIES);
  preGen.set(store.gen);

  world.reset();

  /* -- 3. players -------------------------------------------------------- */
  const sorted = players.slice().sort((a, b) => a.id - b.id);
  for (const ps of sorted) {
    world.addPlayer(ps.faction as Faction, ps.name, ps.isHuman, ps.isLocal);
  }
  world.localPlayer = (match.localPlayer as PlayerId) ?? (0 as PlayerId);

  /* -- 4. entities ------------------------------------------------------- */
  const n = ents.count;
  const kindCol = findColumn(ents, COL_KIND);
  if (kindCol === null) {
    return refuse('corrupt', 'This saved game is missing its unit table and cannot be loaded.');
  }
  const kinds = viewOf(kindCol, n);
  for (let k = 0; k < n; k++) {
    const kind = kinds[k];
    if (!Number.isInteger(kind) || kind < 0 || kind >= ENTITY_KIND_COUNT) {
      return refuse('corrupt', 'This saved game contains a unit this build does not recognise.');
    }
  }

  const ownerCol = findColumn(ents, 2);
  const factionCol = findColumn(ents, 3);
  const owners = ownerCol === null ? null : viewOf(ownerCol, n);
  const factions = factionCol === null ? null : viewOf(factionCol, n);

  /* `alloc` is the ONLY correct way in: it maintains the free list, the alive
   * list and the per-kind lists, none of which are reachable from here. A fresh
   * store hands out slot 0, then 1, then 2 — so the save's dense order becomes
   * the store's slot order and every reference resolves by construction. */
  const slotOf = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    const id = store.alloc(
      kinds[k] as EntityKind,
      -1,
      (owners === null ? 0 : owners[k]) as PlayerId,
      (factions === null ? 0 : factions[k]) as Faction,
      0, 0, 0, 0,
    );
    if ((id as number) === 0) {
      return refuse(
        'too-many-entities',
        'This save holds more units than this build can allocate. It cannot be loaded.',
      );
    }
    slotOf[k] = store.index(id);
  }

  /* Columns. `alloc` has already set a safe default in every one of them, so a
   * column this build has never heard of — or one the save happens not to
   * carry — leaves a sane value rather than a zero. */
  for (const c of ents.columns) {
    if (c.id === COL_KIND || c.id === COL_DEF_KEY || c.id === COL_DEF_RAW) continue;
    const spec = COLUMNS.find((s) => s.id === c.id);
    if (spec === undefined) continue;
    const src = viewOf(c, n);
    const dst = spec.of(store);
    for (let k = 0; k < n; k++) dst[slotOf[k]] = src[k];
  }

  /* Def ids: by KEY where the save has one, falling back to the raw index for
   * kinds that have no def table (props, wrecks, crates). */
  const defKeyCol = findColumn(ents, COL_DEF_KEY);
  const defRawCol = findColumn(ents, COL_DEF_RAW);
  const defKeys = defKeyCol === null ? null : viewOf(defKeyCol, n);
  const defRaw = defRawCol === null ? null : viewOf(defRawCol, n);
  for (let k = 0; k < n; k++) {
    const slot = slotOf[k];
    let resolved = -1;
    if (defKeys !== null && host.defs !== null) {
      const ki = defKeys[k];
      if (ki >= 0 && ki < ents.keys.length) {
        const key = ents.keys[ki];
        resolved = kinds[k] === EntityKind.Building
          ? host.defs.buildingIdOf(key)
          : host.defs.unitIdOf(key);
      }
    }
    if (resolved < 0 && defRaw !== null) resolved = defRaw[k];
    store.defId[slot] = resolved;
  }

  /* Flags: alive, never pending. A snapshot only ever contains live entities,
   * and a stray `PendingDestroy` would delete the unit on the first Cleanup. */
  for (let k = 0; k < n; k++) {
    const slot = slotOf[k];
    store.flags[slot] = (store.flags[slot] | EntityFlag.Alive) & ~EntityFlag.PendingDestroy;
    // Flow fields are refcounted runtime state and are not in the file. -1 makes
    // the pathing layer request a fresh one, which is what a reload should do.
    store.navField[slot] = -1;
  }

  /* -- 5. THE GENERATION BUMP ------------------------------------------- */
  // Rule B. Do this before a single handle is minted below: everything after
  // this line uses `handleOf`, so every handle written into the world carries
  // the new generation, and every handle from before the load is dead.
  for (let i = 0; i < MAX_ENTITIES; i++) store.gen[i] = bumpGen(preGen[i]);

  const handleOfLocal = (local: number): EntityId => {
    if (local < 0 || local >= n) return NONE;
    return store.handleOf(slotOf[local]);
  };

  /* -- 6. handle-valued columns ----------------------------------------- */
  for (const spec of REF_COLUMNS) {
    const c = findColumn(ents, spec.id);
    if (c === null) continue;
    const src = viewOf(c, n);
    const dst = spec.of(store);
    for (let k = 0; k < n; k++) {
      const ref = src[k];
      dst[slotOf[k]] = ref === 0 ? 0 : (handleOfLocal(ref - 1) as number);
    }
  }

  /* -- 7. render interpolation ------------------------------------------ */
  // prev == cur, or the first frame after a load lerps every unit in from
  // wherever it happened to be standing before.
  for (let k = 0; k < n; k++) {
    const i = slotOf[k];
    store.prevX[i] = store.posX[i];
    store.prevY[i] = store.posY[i];
    store.prevZ[i] = store.posZ[i];
    store.prevYaw[i] = store.yaw[i];
    store.prevTurretYaw[i] = store.turretYaw[i];
    store.prevBarrelPitch[i] = store.barrelPitch[i];
  }

  /* -- 8. per-player state ---------------------------------------------- */
  for (const ps of sorted) {
    const p = world.players[ps.id];
    if (p === undefined) continue;
    restorePlayer(p, ps, host.defs, handleOfLocal);
  }

  /* -- 9. terrain occupancy --------------------------------------------- */
  for (let k = 0; k < n; k++) {
    const i = slotOf[k];
    if (store.footprintW[i] <= 0) continue;
    footprintOriginCell(
      store.posX[i], store.posZ[i], store.footprintW[i], store.footprintH[i], originScratch,
    );
    world.terrain.markOccupied(
      originScratch[0], originScratch[1], store.footprintW[i], store.footprintH[i],
      store.handleOf(i),
    );
  }

  /* -- 9b. rally points, re-snapped ---------------------------------------
   * AFTER section 9, and that ordering is the whole point: occupancy is
   * stamped above, so a snap run during section 8's `restorePlayer` would read
   * an empty grid and do nothing at all.
   *
   * A save written before rally snapping landed can carry a flag inside a
   * footprint, and restoring it verbatim would bring the defect back for that
   * file forever — the unit parks metres short of a flag drawn exactly where
   * the player once clicked. The snap is a no-op for a point already clear, so
   * this costs one grid read per rally on a modern save.
   * --------------------------------------------------------------------- */
  for (const p of world.players) {
    if (p === undefined) continue;
    for (const [key, rx] of p.rallyX) {
      const rz = p.rallyZ.get(key);
      if (rz === undefined) continue;
      if (!snapRallyClear(world, rx, rz, loadRallySnap)) continue;
      p.rallyX.set(key, loadRallySnap[0]);
      p.rallyZ.set(key, loadRallySnap[1]);
    }
  }

  /* -- 10. spatial index ------------------------------------------------- */
  // Phase.SpatialRebuild would do this next tick, but the UI, the minimap and
  // any click the player makes before that tick all query it.
  world.spatial.rebuild();

  /* -- 11. clocks -------------------------------------------------------- */
  world.tick = match.tick;
  world.time = match.simTimeSec;

  /* -- 12. selection, camera, fog, ore, scatter, superweapons ------------ *
   * The felled-prop mask goes down FIRST: when it applies it already covers
   * every building footprint in the ledger, so replaying them after it would be
   * a few dozen redundant cell scans over props that are already tombstoned. */
  const felled = applyFelledProps(sections.scatter, host.scatter);
  const cleared = applyMisc(sections.misc, host, handleOfLocal, !felled);
  applyFog(sections.fog, host.vision);
  applyOre(sections.ore, host.ore);

  void meta;
  return { ok: true, value: cleared };
}

function restorePlayer(
  p: PlayerState,
  ps: PlayerSection,
  defs: DefIndex | null,
  handleOfLocal: (local: number) => EntityId,
): void {
  p.defeated = ps.defeated;
  p.allyMask = ps.allyMask;
  p.credits = ps.credits;
  p.storageMax = ps.storageMax;
  p.powerProduced = ps.powerProduced;
  p.powerConsumed = ps.powerConsumed;
  p.buildSpeedMul = ps.buildSpeedMul;
  p.hasRadar = ps.hasRadar;
  p.aiDifficulty = ps.aiDifficulty;
  p.aiPersonality = ps.aiPersonality;

  p.techMask.fill(0);
  for (let i = 0; i + 1 < ps.techMask.length; i += 2) {
    const idx = ps.techMask[i];
    if (idx >= 0 && idx < p.techMask.length) p.techMask[idx] = ps.techMask[i + 1];
  }

  /* In-match upgrades. `setUpgradesByKey` REPLACES rather than merges and
   * rebuilds the derived multiplier table from the restored mask, so a load
   * cannot leave a player wearing the previous match's numbers — and a save
   * written before this key existed correctly restores to none. */
  setUpgradesByKey(p, ps.upgradeKeys ?? EMPTY_UPGRADE_KEYS);

  /* Building counts drive prereqs and the victory check, so they are restored
   * by KEY wherever the save recorded one: a def table that gained a row would
   * otherwise credit the player with a Battle Lab they never built. */
  p.buildingCount.fill(0);
  for (let i = 0, slot = 0; i + 1 < ps.buildingCount.length; i += 2, slot++) {
    const savedIndex = ps.buildingCount[i];
    const count = ps.buildingCount[i + 1];
    const key = ps.buildingCountKeys[slot] ?? '';
    let target = savedIndex;
    if (key !== '' && defs !== null) {
      const resolved = defs.buildingIdOf(key);
      if (resolved >= 0) target = resolved;
    }
    if (target >= 0 && target < p.buildingCount.length) p.buildingCount[target] = count;
  }

  for (let i = 0; i < ps.entityCount.length && i < p.entityCount.length; i++) {
    p.entityCount[i] = ps.entityCount[i];
  }

  p.rallyX.clear();
  p.rallyZ.clear();
  for (let i = 0; i + 2 < ps.rally.length; i += 3) {
    const handle = handleOfLocal(ps.rally[i]);
    if ((handle as number) === 0) continue;
    p.rallyX.set(handle as number, ps.rally[i + 1]);
    p.rallyZ.set(handle as number, ps.rally[i + 2]);
  }

  const stats = p.stats as unknown as Record<string, number>;
  for (const key of Object.keys(stats)) {
    const v = ps.stats[key];
    if (typeof v === 'number') stats[key] = v;
  }

  /* Queues: a half-built Rhino keeps its progress AND its `spent`, because
   * cancelling refunds exactly what was paid and a lost `spent` is either a
   * free tank or a stolen refund. */
  for (let t = 0; t < p.queues.length; t++) {
    const q = p.queues[t];
    const saved = ps.queues[t];
    q.items.length = 0;
    if (saved === undefined) { q.factoryCount = 0; q.awaitingPlacement = false; continue; }
    q.factoryCount = saved.factoryCount;
    q.awaitingPlacement = saved.awaitingPlacement;
    for (const it of saved.items) {
      let defId = -1;
      if (defs !== null && it.key !== '') {
        defId = it.isBuilding ? defs.buildingIdOf(it.key) : defs.unitIdOf(it.key);
      }
      // A key that no longer resolves was already refused by `validateContent`
      // for entities; a queue item is not worth refusing the whole save over, so
      // it is dropped and the credits already spent stay spent — the same thing
      // that happens when a factory is destroyed mid-build.
      if (defId < 0) continue;
      const item: ProductionItem = {
        defId,
        isBuilding: it.isBuilding,
        progress: it.progress,
        spent: it.spent,
        cost: it.cost,
        ready: it.ready,
        onHold: it.onHold,
      };
      q.items.push(item);
    }
    q.tab = (saved.tab as BuildTab) ?? q.tab;
  }
}

function applyMisc(
  misc: MiscSection | null,
  host: SnapshotHost,
  handleOfLocal: (local: number) => EntityId,
  replayFootprints: boolean,
): readonly ClearedFootprint[] {
  if (misc === null) return [];
  const world = host.world;
  const store = world.store;
  const sel = world.selection;

  sel.count = 0;
  sel.isBuilding = false;
  sel.homogeneousDef = -1;
  // `EntityFlag.Selected` is stored in the flags column AND implied by the
  // selection list. Clearing it first is what keeps the two from disagreeing
  // when a selected entity did not make it into the snapshot: an orphaned
  // Selected bit is a unit with a permanent selection ring nothing can clear.
  for (let a = 0; a < store.aliveCount; a++) {
    store.flags[store.alive[a]] &= ~EntityFlag.Selected;
  }
  for (const local of misc.selection) {
    if (sel.count >= MAX_SELECTION) break;
    const h = handleOfLocal(local);
    if ((h as number) === 0) continue;
    sel.ids[sel.count++] = h as number;
    world.store.flags[world.store.index(h)] |= EntityFlag.Selected;
  }
  if (sel.count > 0) {
    const first = world.store.index(sel.ids[0] as EntityId);
    sel.isBuilding = first >= 0 && world.store.kind[first] === EntityKind.Building;
  }

  sel.groupCounts.fill(0);
  for (let g = 0; g < CONTROL_GROUP_COUNT && g < misc.selectionGroups.length; g++) {
    const list = misc.selectionGroups[g];
    let count = 0;
    for (const local of list) {
      if (count >= MAX_SELECTION) break;
      const h = handleOfLocal(local);
      if ((h as number) === 0) continue;
      sel.groups[g][count++] = h as number;
    }
    sel.groupCounts[g] = count;
  }

  if (misc.camera !== null && host.camera !== null) {
    host.camera.setPose({
      x: misc.camera.x, z: misc.camera.z,
      yaw: misc.camera.yaw, distance: misc.camera.distance,
      immediate: true,
    });
  }

  /* The scatter-clear replay. See the header: regenerating props from the seed
   * puts every felled tree back, so every footprint ever poured is replayed
   * through the same call the live game makes.
   *
   * The list is decoded either way — `save.system.ts` keeps accumulating it, and
   * it stays the fallback for the next save. It is only REPLAYED when the
   * felled-prop mask did not apply, because the mask already includes it. */
  const cleared: ClearedFootprint[] = [];
  for (let i = 0; i + 3 < misc.cleared.length; i += 4) {
    cleared.push({
      cx: misc.cleared[i], cz: misc.cleared[i + 1],
      w: misc.cleared[i + 2], h: misc.cleared[i + 3],
    });
  }
  if (host.scatter !== null && replayFootprints) {
    for (const rect of cleared) {
      host.scatter.clearFootprint(
        rect.cx * CELL, rect.cz * CELL, (rect.cx + rect.w) * CELL, (rect.cz + rect.h) * CELL,
      );
    }
  }

  if (host.superweapons !== null) {
    const sw = host.superweapons;
    const setter = hasChargeSetter(sw) ? sw : null;
    for (const st of misc.superweapons) {
      if (setter !== null) setter.setRemaining(st.player as PlayerId, st.key, st.remaining);
      else if (st.remaining <= 0) sw.grantReady(st.player as PlayerId, st.key);
      // A partial charge with no setter available restarts from full. That is
      // the conservative direction — it never hands a player a superweapon they
      // had not earned — and it is the only thing the module's public surface
      // permits today. The seconds are in the file either way.
    }
  }

  return cleared;
}

/**
 * Re-explore the saved cells.
 *
 * `exploreCircle` is the port's own "mark explored without granting sight", and
 * a radius under half a cell lights exactly the cell whose centre it is on. That
 * is deliberately the public route rather than writing into the array
 * `gridFor()` hands back: that array is documented "do not mutate", and its
 * owner also keeps a countdown grid and a version counter in step with it.
 */
function applyFog(
  planes: readonly { player: number; packed: Uint8Array }[],
  vision: VisionAccess | null,
): void {
  if (vision === null || planes.length === 0) return;
  const r = CELL * 0.4;
  for (const plane of planes) {
    const player = plane.player as PlayerId;
    const packed = plane.packed;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if ((packed[i >> 3] & (1 << (i & 7))) === 0) continue;
      const cx = i % MAP_CELLS;
      const cz = (i / MAP_CELLS) | 0;
      vision.exploreCircle(player, (cx + 0.5) * CELL, (cz + 0.5) * CELL, r);
    }
  }
}

/**
 * Take the regenerated ore fields back down to what the save recorded.
 *
 * The scenario re-seeds every field at full capacity, so the difference between
 * that and the file is exactly the ore that was mined. `takeOre` is the port's
 * own withdrawal path, so the field records, the totals, the dirty list and the
 * exhausted listeners all stay consistent — which writing into the amount array
 * would not.
 */
function applyOre(
  ore: { cells: Int32Array; amounts: Float32Array } | null,
  access: OreAccess | null,
): void {
  if (ore === null || access === null) return;

  /* Cells the save says are empty must be emptied too, and they are not in the
   * sparse list — so walk the regenerated field and drain anything the save
   * does not mention. */
  const saved = new Float32Array(MAP_CELL_COUNT);
  for (let k = 0; k < ore.cells.length; k++) {
    const c = ore.cells[k];
    if (c >= 0 && c < MAP_CELL_COUNT) saved[c] = ore.amounts[k];
  }

  for (let cz = 0; cz < MAP_CELLS; cz++) {
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      const current = access.oreAt(cx, cz);
      if (current <= 0) continue;
      const target = saved[cz * MAP_CELLS + cx];
      const delta = current - target;
      if (delta > 1e-4) access.takeOre(cx, cz, delta);
    }
  }
}
