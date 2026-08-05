/**
 * ============================================================================
 * VOLTMARCH — src/game/save.system.ts
 * ============================================================================
 * THE SAVE SYSTEM. Wires `SaveGame.ts` (the format) and `SaveStore.ts` (the
 * bytes) to the running game, and publishes ONE object — `saveApi()` — that the
 * menus, the pause screen and the autosave policy call.
 *
 * A module joins the game by existing, so this file is discovered by glob and
 * nothing in `Bootstrap.ts` or `Systems.ts` knows it is here.
 *
 * ----------------------------------------------------------------------------
 * AUTOSAVE FIRES ON THE TICK COUNTER, NEVER ON A CLOCK
 * ----------------------------------------------------------------------------
 * `Date.now()` and `performance.now()` are banned inside `simTick` and a test
 * asserts it. That is not an inconvenience to route around — it is the right
 * trigger anyway: a player at 2x game speed should autosave twice as often in
 * wall-clock terms, because twice as much MATCH has happened. So `simTick` does
 * one integer compare against `tick`, and the only thing it does when the
 * interval elapses is set a flag.
 *
 * THE SNAPSHOT ITSELF IS TAKEN IN `frame()`, NOT IN `simTick`. Capture allocates
 * the whole blob; doing that inside the fixed step would put a hitch in the
 * simulation, and the frame loop is where a one-off allocation is at least
 * bounded by one frame. The write after it is asynchronous and does not block
 * anything.
 *
 * The CADENCE is not decided here. `setAutosaveIntervalTicks` defaults to 0 —
 * off — and the UI layer turns it on. This module owns the mechanism; the
 * policy belongs with the screen that tells the player it happened.
 *
 * ----------------------------------------------------------------------------
 * THE CLEARED-FOOTPRINT LEDGER
 * ----------------------------------------------------------------------------
 * Terrain, roads and props are regenerated from the seed, so a save that only
 * stored buildings would reload with every felled tree standing again — through
 * the roof of the War Factory that felled it. `src/world/scatter-clear.system.ts`
 * does that felling off `building:placed`, and treats it as permanent (its own
 * header explains why: the concrete pad and the occupancy claim are not reverted
 * either).
 *
 * So this module listens to the SAME event and keeps the list of every footprint
 * ever poured. Four int16s per placement. Re-deriving the list from the
 * buildings that are standing would be free, and would be wrong: a barracks that
 * was built and then destroyed also cleared its ground, and re-deriving would
 * grow that copse back.
 *
 * ----------------------------------------------------------------------------
 * LOADING NEEDS A MATCH ALREADY RUNNING
 * ----------------------------------------------------------------------------
 * The snapshot does not contain terrain. `load()` therefore refuses unless the
 * running match was built from the save's scenario, map and seed —
 * `requiredWorldFor(slot)` tells the caller what to boot first. Restoring a base
 * onto a differently-seeded heightfield puts buildings inside cliffs, and doing
 * it silently would be exactly the class of bug `docs/SPEC_DRIFT_AUDIT.md` is
 * about.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase, RenderPhase } from '../core/types';
import type { PlayerId, RenderContext, SimContext } from '../core/types';
import type { World } from '../core/world';

import { ctx } from './context';
import { activeScenario, resolveDefBinding } from './Scenarios';
import { getScatter } from '../world/Scatter';
import { superweapons } from '../sim/Superweapons';
import {
  captureSnapshot, defIndexFromTables, readSnapshotMeta, restoreSnapshot,
  type CaptureOutcome, type ClearedFootprint, type DefIndex, type RestoreOutcome,
  type SaveMeta, type SaveResult, type SnapshotHost,
} from './SaveGame';
import {
  MANUAL_SLOT_PREFIX, SaveStore, nextAutosaveSlot,
  type SaveBackendName, type SaveSlotInfo,
} from './SaveStore';

/* ==========================================================================
 * 1. THE PUBLIC API
 * ========================================================================== */

/** What the world a save expects looks like. Boot this, then `load()`. */
export interface RequiredWorld {
  scenario: string;
  map: string;
  seed: number;
}

/**
 * The one object the UI layer talks to. Every method is safe to call at any
 * time; the ones that need a running match refuse politely when there is not
 * one, and none of them throw.
 */
export interface SaveApi {
  /** Where the bytes go: 'indexeddb', 'localstorage' or 'memory'. */
  readonly backend: SaveBackendName;

  /** False before `init()` has finished, or after `dispose()`. */
  ready(): boolean;
  /** True when there is a match worth snapshotting. */
  canSave(): boolean;

  /** Every known save, newest first. Synchronous — see SaveStore's header. */
  list(): readonly SaveSlotInfo[];
  peek(slot: string): SaveMeta | null;
  /** What the caller must boot before `load(slot)` will accept. */
  requiredWorldFor(slot: string): RequiredWorld | null;

  /** Snapshot the match and store it under `slot`. */
  save(slot: string, label: string): Promise<SaveResult<SaveMeta>>;
  /** Snapshot into the next slot of the autosave ring. */
  autosave(label?: string): Promise<SaveResult<SaveMeta>>;
  /** A fresh manual slot id, unique against the current index. */
  newManualSlot(): string;

  /** Read a stored save and put it back into the running match. */
  load(slot: string): Promise<SaveResult<RestoreOutcome>>;
  /** Same, from bytes the caller already holds (an imported file). */
  loadBytes(bytes: Uint8Array): SaveResult<RestoreOutcome>;

  remove(slot: string): Promise<void>;

  /** Capture without storing. For measurement, for export, and for tests. */
  capture(label: string): SaveResult<CaptureOutcome>;

  /**
   * Autosave cadence in SIM TICKS (30 per second). 0 turns it off, which is the
   * default — the cadence is the UI layer's decision, not this module's.
   */
  setAutosaveIntervalTicks(ticks: number): void;
  autosaveIntervalTicks(): number;
  ticksSinceAutosave(): number;

  /** Fired after a snapshot lands in the store. */
  onSaved(fn: (info: SaveSlotInfo) => void): () => void;
  /** Fired after a restore completes. The world is already the new world. */
  onRestored(fn: (outcome: RestoreOutcome) => void): () => void;
  /** Fired when an autosave refuses, so the UI can say so. */
  onAutosaveFailed(fn: (refusalReason: string) => void): () => void;

  /** Milliseconds the last capture / restore took. Measured, not estimated. */
  lastCaptureMs(): number;
  lastRestoreMs(): number;
  /** Bytes in the last snapshot this session. */
  lastSnapshotBytes(): number;
}

/* ==========================================================================
 * 2. MODULE STATE
 * ========================================================================== */

let store: SaveStore | null = null;
let defs: DefIndex | null = null;
let api: SaveApi | null = null;
let unsubscribePlaced: (() => void) | null = null;

/** Every footprint poured this match, deduped. See the header. */
let cleared: ClearedFootprint[] = [];
const clearedSeen = new Set<number>();
/**
 * A 512-cell map at a 1x1 minimum footprint cannot exceed this, and a real
 * match is two orders of magnitude under it. The cap exists so a pathological
 * session cannot grow the save without bound.
 */
const CLEARED_CAP = 8192;

let autosaveIntervalTicks = 0;
let lastAutosaveTick = 0;
let autosaveDue = false;
let busy = false;

let lastCaptureMs = 0;
let lastRestoreMs = 0;
let lastBytes = 0;

const savedListeners: ((info: SaveSlotInfo) => void)[] = [];
const restoredListeners: ((outcome: RestoreOutcome) => void)[] = [];
const autosaveFailedListeners: ((reason: string) => void)[] = [];

function subscribe<T>(list: T[], fn: T): () => void {
  list.push(fn);
  return (): void => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}

/* ==========================================================================
 * 3. ASSEMBLING THE HOST
 * ========================================================================== */

/**
 * `world.vision` is typed as the `IVision` port, which carries `gridFor` but not
 * `exploreCircle` — the "mark explored without granting sight" call the restore
 * needs. `sim/Vision.ts` has both. Tested for structurally rather than imported,
 * so this module does not force a dependency on the fog implementation and a
 * world running the null-object vision simply saves no fog.
 */
function visionAccessOf(world: World): SnapshotHost['vision'] {
  const v = world.vision;
  const probe = v as Partial<SnapshotHost['vision'] & object>;
  if (typeof probe.gridFor === 'function' && typeof probe.exploreCircle === 'function') {
    return probe as NonNullable<SnapshotHost['vision']>;
  }
  return null;
}

/** Everything a capture or a restore reads, gathered from the live context. */
function makeHost(): SnapshotHost | null {
  const { world, loop, cameraRig } = ctx();
  const spec = activeScenario();
  if (spec === null) return null;

  return {
    world,
    seed: spec.seed,
    tick: loop.tick,
    simTimeSec: loop.simTime,
    rngState: loop.rng.getState(),
    speedIndex: loop.speedIndex,
    scenario: spec.name,
    map: spec.map,
    defs,
    camera: cameraRig,
    vision: visionAccessOf(world),
    // `IOreField` already carries exactly `oreAt` and `takeOre`.
    ore: world.ore,
    scatter: getScatter(),
    superweapons: superweapons(),
    clearedFootprints: cleared,
  };
}

/* ==========================================================================
 * 4. CAPTURE / RESTORE
 * ========================================================================== */

function doCapture(label: string): SaveResult<CaptureOutcome> {
  const host = makeHost();
  if (host === null) {
    return { ok: false, code: 'no-match', reason: 'There is no match running to save.' };
  }
  const result = captureSnapshot(host, label);
  if (result.ok) {
    lastCaptureMs = result.value.captureMs;
    lastBytes = result.value.bytes.length;
    ctx().debug.setCounter('saveBytes', lastBytes);
    ctx().debug.setCounter('saveMs', Math.round(lastCaptureMs * 100) / 100);
  }
  return result;
}

function doRestore(bytes: Uint8Array): SaveResult<RestoreOutcome> {
  const host = makeHost();
  if (host === null) {
    return {
      ok: false,
      code: 'no-match',
      reason: 'Start a match before loading a save — the terrain is rebuilt, not stored.',
    };
  }

  const result = restoreSnapshot(bytes, host);
  if (!result.ok) return result;

  /* Re-seat the clocks the snapshot does not own. `restoreSnapshot` writes
   * `world.tick`/`world.time`; the LOOP keeps its own copies and is the thing
   * that increments them, so leaving these behind would make the next tick jump
   * the match back to where the loop thought it was. */
  const { loop } = ctx();
  loop.tick = result.value.tick;
  loop.simTime = result.value.simTimeSec;
  loop.rng.setState(result.value.rngState);
  loop.setSpeed(result.value.speedIndex);

  cleared = result.value.clearedFootprints.slice();
  clearedSeen.clear();
  for (const rect of cleared) clearedSeen.add(clearedKey(rect));

  lastRestoreMs = result.value.restoreMs;
  lastAutosaveTick = result.value.tick;
  autosaveDue = false;

  for (const fn of restoredListeners.slice()) fn(result.value);
  return result;
}

function clearedKey(rect: ClearedFootprint): number {
  // cx, cz < 128 and w, h < 16 on this map, so one integer is a lossless key.
  return ((rect.cx & 0x1ff) << 22) | ((rect.cz & 0x1ff) << 13) | ((rect.w & 0x3f) << 7) | (rect.h & 0x3f);
}

async function storeSnapshot(
  slot: string, label: string,
): Promise<SaveResult<SaveMeta>> {
  const s = store;
  if (s === null) {
    return { ok: false, code: 'storage', reason: 'The save system is not ready yet.' };
  }
  const captured = doCapture(label);
  if (!captured.ok) return captured;

  const written = await s.write(slot, captured.value.bytes, captured.value.meta);
  if (!written.ok) return written;

  for (const fn of savedListeners.slice()) fn(written.value);
  return { ok: true, value: written.value.meta };
}

/* ==========================================================================
 * 5. THE MODULE
 * ========================================================================== */

export const SAVE_SYSTEM_ID = 'game.save';

export default defineSystem({
  id: SAVE_SYSTEM_ID,
  /**
   * Cleanup, ordered AFTER `game.scenario` (10 000) so `activeScenario()` is
   * populated by the time `init()` runs, and after `world.scatterClear` (20 500)
   * so a placement is felled before this module records it.
   */
  phase: Phase.Cleanup,
  order: 30_000,
  // Only so the deferred autosave capture has a frame to happen on.
  renderPhase: RenderPhase.Present,

  async init(): Promise<void> {
    const { channels, debug } = ctx();

    store = SaveStore.shared();
    cleared = [];
    clearedSeen.clear();
    autosaveIntervalTicks = 0;
    lastAutosaveTick = 0;
    autosaveDue = false;
    busy = false;
    lastCaptureMs = 0;
    lastRestoreMs = 0;
    lastBytes = 0;

    try {
      const binding = await resolveDefBinding();
      defs = binding.tables === null ? null : defIndexFromTables(binding.tables);
    } catch (err) {
      console.warn('[save] def discovery failed; saves will carry raw def indices', err);
      defs = null;
    }

    // The cleared-footprint ledger. See the header for why the standing
    // buildings are not enough.
    unsubscribePlaced = channels.events.on('building:placed', (e) => {
      if (cleared.length >= CLEARED_CAP) return;
      const rect: ClearedFootprint = { cx: e.cx, cz: e.cz, w: e.w, h: e.h };
      const key = clearedKey(rect);
      if (clearedSeen.has(key)) return;
      clearedSeen.add(key);
      cleared.push(rect);
    });

    api = buildApi();
    // Published, not exported: `src/shell/**` may import `src/game/**` but never
    // the other way round. `LoadGame.saveService()` duck-types this handle.
    (globalThis as { __vmSave?: unknown }).__vmSave = buildFrontEndService();
    debug.setCounter('saveSlots', store.list().length);

    console.info(
      `%c[save]%c snapshots -> ${store.backendName}, index -> ${store.indexName}` +
      `${defs === null ? ' (no def tables: def ids stored raw)' : ''}`,
      'color:#7fd', 'color:inherit',
    );
  },

  /**
   * One integer compare. No clock, no allocation, no capture — see the header.
   */
  simTick(s: SimContext): void {
    if (autosaveIntervalTicks <= 0 || autosaveDue) return;
    if (s.tick - lastAutosaveTick < autosaveIntervalTicks) return;
    autosaveDue = true;
  },

  /**
   * The deferred capture. At most one per frame, never re-entrant, and the
   * store write that follows is asynchronous.
   */
  frame(_r: RenderContext): void {
    if (!autosaveDue || busy || store === null || api === null) return;
    autosaveDue = false;
    if (!api.canSave()) return;

    busy = true;
    lastAutosaveTick = ctx().loop.tick;
    void api.autosave().then((result) => {
      busy = false;
      if (result.ok) return;
      console.warn(`[save] autosave refused: ${result.reason}`);
      for (const fn of autosaveFailedListeners.slice()) fn(result.reason);
    }, (err: unknown) => {
      busy = false;
      console.error('[save] autosave threw', err);
    });
  },

  dispose(): void {
    unsubscribePlaced?.();
    unsubscribePlaced = null;
    // A stale handle would let the shell call into a torn-down world.
    if ((globalThis as { __vmSave?: unknown }).__vmSave !== undefined) {
      delete (globalThis as { __vmSave?: unknown }).__vmSave;
    }
    api = null;
    store = null;
    defs = null;
    cleared = [];
    clearedSeen.clear();
    savedListeners.length = 0;
    restoredListeners.length = 0;
    autosaveFailedListeners.length = 0;
    autosaveDue = false;
    busy = false;
  },
});

/* ==========================================================================
 * 6. API CONSTRUCTION
 * ========================================================================== */

function buildApi(): SaveApi {
  const s = store as SaveStore;
  return {
    backend: s.backendName,

    ready: () => store !== null,

    canSave(): boolean {
      if (store === null) return false;
      const spec = activeScenario();
      if (spec === null) return false;
      const { world } = ctx();
      return world.players.length > 0 && world.store.aliveCount > 0;
    },

    list: () => s.list(),
    peek: (slot) => s.peek(slot),

    requiredWorldFor(slot): RequiredWorld | null {
      const meta = s.peek(slot);
      if (meta === null) return null;
      return { scenario: meta.scenario, map: meta.map, seed: meta.seed };
    },

    save: (slot, label) => storeSnapshot(slot, label),

    autosave(label?: string): Promise<SaveResult<SaveMeta>> {
      const slot = nextAutosaveSlot(s.list());
      const { loop } = ctx();
      const minutes = Math.floor(loop.simTime / 60);
      const seconds = Math.floor(loop.simTime % 60);
      const stamp = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
      return storeSnapshot(slot, label ?? `Autosave — ${stamp}`);
    },

    newManualSlot(): string {
      const taken = new Set(s.list().map((e) => e.slot));
      for (let i = 1; i < 1000; i++) {
        const slot = `${MANUAL_SLOT_PREFIX}${i}`;
        if (!taken.has(slot)) return slot;
      }
      return `${MANUAL_SLOT_PREFIX}${Date.now()}`;
    },

    async load(slot): Promise<SaveResult<RestoreOutcome>> {
      const bytes = await s.read(slot);
      if (!bytes.ok) return bytes;
      return doRestore(bytes.value);
    },

    loadBytes: (bytes) => doRestore(bytes),

    remove: (slot) => s.remove(slot),

    capture: (label) => doCapture(label),

    setAutosaveIntervalTicks(ticks): void {
      autosaveIntervalTicks = ticks > 0 ? Math.floor(ticks) : 0;
      lastAutosaveTick = store === null ? 0 : ctx().loop.tick;
      autosaveDue = false;
    },
    autosaveIntervalTicks: () => autosaveIntervalTicks,
    ticksSinceAutosave: () => (store === null ? 0 : ctx().loop.tick - lastAutosaveTick),

    onSaved: (fn) => subscribe(savedListeners, fn),
    onRestored: (fn) => subscribe(restoredListeners, fn),
    onAutosaveFailed: (fn) => subscribe(autosaveFailedListeners, fn),

    lastCaptureMs: () => lastCaptureMs,
    lastRestoreMs: () => lastRestoreMs,
    lastSnapshotBytes: () => lastBytes,
  };
}

/* ==========================================================================
 * 7. THE FRONT-END SERVICE — `globalThis.__vmSave`
 *
 * `src/shell/LoadGame.ts` reaches the save system through a five-method
 * structural contract on `globalThis.__vmSave`, duck-typed at the call site. It
 * is published from here rather than imported from there, because `src/game/**`
 * must not depend on `src/shell/**` — the shell already depends on the game, and
 * closing that loop would make the engine unloadable without a DOM.
 *
 * The two shapes are declared LOCALLY and structurally, so this file and that
 * one can be edited independently and the compiler still checks each side
 * against its own copy. Every field below is one the codec already produces.
 * ========================================================================== */

/** Opaque to this layer: stored in the index verbatim and handed straight back. */
interface ServiceContext {
  readonly mapId: string;
  readonly playerFaction: string;
  readonly aiFaction: string;
  readonly difficulty: number;
  readonly speed: number;
  readonly seed: number;
}

interface ServiceSlotMeta {
  readonly id: string;
  readonly kind: 'auto' | 'manual';
  readonly label: string;
  readonly savedAtMs: number;
  readonly tick: number;
  readonly simSeconds: number;
  readonly credits: number;
  readonly bytes: number;
  readonly thumbnail: string | null;
  readonly context: ServiceContext;
}

interface ServiceRequest {
  readonly kind: 'auto' | 'manual';
  readonly label: string;
  readonly context: ServiceContext;
  readonly slotId?: string;
  readonly thumbnail?: boolean;
}

interface ServiceRefusal {
  readonly ok: false;
  readonly reason: string;
  readonly code?: string;
}

interface FrontEndSaveService {
  list(): readonly ServiceSlotMeta[];
  canSave(): boolean;
  save(request: ServiceRequest): Promise<ServiceSlotMeta | ServiceRefusal>;
  load(id: string): Promise<ServiceRefusal | void>;
  remove(id: string): Promise<ServiceRefusal | void>;
}

/** What is kept in the index row alongside the blob header. */
interface SlotExtra {
  kind: 'auto' | 'manual';
  thumbnail: string | null;
  context: ServiceContext;
}

const EMPTY_CONTEXT: ServiceContext = {
  mapId: '', playerFaction: '', aiFaction: '', difficulty: 0, speed: 1, seed: 0,
};

function extraOf(info: SaveSlotInfo): SlotExtra {
  const e = info.extra as Partial<SlotExtra> | null;
  return {
    kind: e?.kind === 'manual' || e?.kind === 'auto'
      ? e.kind
      : (info.slot.startsWith('auto') ? 'auto' : 'manual'),
    thumbnail: typeof e?.thumbnail === 'string' ? e.thumbnail : null,
    context: e?.context ?? { ...EMPTY_CONTEXT, mapId: info.meta.map, seed: info.meta.seed },
  };
}

function toServiceMeta(info: SaveSlotInfo): ServiceSlotMeta {
  const extra = extraOf(info);
  return {
    id: info.slot,
    kind: extra.kind,
    label: info.meta.label,
    savedAtMs: info.meta.savedAtMs,
    tick: info.meta.tick,
    simSeconds: info.meta.simTimeSec,
    credits: info.meta.credits,
    bytes: info.meta.byteLength,
    thumbnail: extra.thumbnail,
    context: extra.context,
  };
}

/**
 * Thumbnail dimensions. Small on purpose: the index lives in `localStorage`,
 * which is a ~5 MB budget shared with the settings and progression stores, so
 * eight slots have to fit in tens of kilobytes, not megabytes.
 */
const THUMB_W = 192;
const THUMB_H = 108;

/**
 * A downscaled frame as a `data:` URI, or null.
 *
 * `__VM.screenshot()` is the only correct source: it renders a fresh frame and
 * reads the pixels back inside the same task, which is what a canvas without
 * `preserveDrawingBuffer` requires. Reading `canvas.toDataURL()` directly would
 * return a cleared buffer — the exact trap the debug handle exists to avoid.
 *
 * Returns null rather than throwing on any failure. A save without a picture is
 * still a save.
 */
async function captureThumbnail(): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const full = await ctx().debug.api.screenshot({ mime: 'image/jpeg', quality: 0.7 });
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = (): void => resolve(el);
      el.onerror = (): void => resolve(null);
      el.src = full;
    });
    if (img === null) return null;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const g = canvas.getContext('2d');
    if (g === null) return null;
    // Cover, not stretch: an aspect-squashed base looks broken on the card.
    const scale = Math.max(THUMB_W / img.width, THUMB_H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    g.drawImage(img, (THUMB_W - w) * 0.5, (THUMB_H - h) * 0.5, w, h);
    return canvas.toDataURL('image/jpeg', 0.55);
  } catch (err) {
    console.warn('[save] thumbnail capture failed; saving without one', err);
    return null;
  }
}

function buildFrontEndService(): FrontEndSaveService {
  return {
    list(): readonly ServiceSlotMeta[] {
      return store === null ? [] : store.list().map(toServiceMeta);
    },

    canSave(): boolean {
      return api !== null && api.canSave();
    },

    async save(request): Promise<ServiceSlotMeta | ServiceRefusal> {
      const s = store;
      if (s === null || api === null) {
        return { ok: false, code: 'storage', reason: 'The save system is not ready yet.' };
      }
      const slot = request.slotId ?? (
        request.kind === 'auto' ? nextAutosaveSlot(s.list()) : api.newManualSlot()
      );

      const captured = doCapture(request.label);
      if (!captured.ok) return { ok: false, code: captured.code, reason: captured.reason };

      const thumbnail = request.thumbnail === true ? await captureThumbnail() : null;
      const extra: SlotExtra = { kind: request.kind, thumbnail, context: request.context };

      const written = await s.write(slot, captured.value.bytes, captured.value.meta, extra);
      if (!written.ok) return { ok: false, code: written.code, reason: written.reason };

      lastAutosaveTick = ctx().loop.tick;
      for (const fn of savedListeners.slice()) fn(written.value);
      return toServiceMeta(written.value);
    },

    async load(id): Promise<ServiceRefusal | void> {
      if (api === null) {
        return { ok: false, code: 'storage', reason: 'The save system is not ready yet.' };
      }
      const result = await api.load(id);
      if (!result.ok) return { ok: false, code: result.code, reason: result.reason };
      return undefined;
    },

    async remove(id): Promise<ServiceRefusal | void> {
      if (store === null) {
        return { ok: false, code: 'storage', reason: 'The save system is not ready yet.' };
      }
      await store.remove(id);
      return undefined;
    },
  };
}

/* ==========================================================================
 * 8. THE ACCESSOR
 * ========================================================================== */

/**
 * The live save API, or null before `init()` has run. Same shape as
 * `production()`, `superweapons()` and `getScatter()` — one idiom in the
 * codebase for reaching a module without importing its system.
 */
export function saveApi(): SaveApi | null {
  return api;
}

/**
 * Validate bytes without a running match. The load screen uses this to show a
 * save as unreadable BEFORE it offers to boot a whole match for it.
 */
export function inspectSnapshot(bytes: Uint8Array): SaveResult<SaveMeta> {
  return readSnapshotMeta(bytes);
}

/**
 * The footprints this match has poured. Exported for the tests, which drive the
 * ledger without standing up an event bus.
 */
export function clearedFootprints(): readonly ClearedFootprint[] {
  return cleared;
}

/** Seed the ledger directly. Tests only. */
export function setClearedFootprints(list: readonly ClearedFootprint[]): void {
  cleared = list.slice();
  clearedSeen.clear();
  for (const rect of cleared) clearedSeen.add(clearedKey(rect));
}

/** Player id helper for callers that hold a raw number. */
export function asPlayerId(n: number): PlayerId {
  return n as PlayerId;
}
