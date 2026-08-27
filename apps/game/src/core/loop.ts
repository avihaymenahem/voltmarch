/**
 * ============================================================================
 * VOLTMARCH — src/core/loop.ts
 * ============================================================================
 * THE FIXED-TIMESTEP SIMULATION LOOP AND THE SYSTEM REGISTRY.
 *
 * WHY FIXED TIMESTEP
 * ------------------
 * The simulation runs at exactly 30 Hz with a constant dt, decoupled from the
 * render rate. That buys three things at once:
 *   - Determinism. Same seed + same commands => same result, on any machine at
 *     any frame rate. This is what makes the AI-vs-AI soak test meaningful.
 *   - Half the pathfinding and targeting cost of a 60 Hz sim, with the
 *     difference completely hidden by render interpolation.
 *   - Stable physics. A variable dt makes separation forces explode on a hitch.
 *
 * Render interpolates between the previous and current tick by `alpha`, so the
 * image is smooth at 144 Hz even though the sim only moved 30 times a second.
 *
 * THE SPIRAL-OF-DEATH GUARD
 * -------------------------
 * If a frame takes too long we run at most MAX_SUBSTEPS catch-up steps and
 * then DISCARD the remaining accumulated time. Simulated time falls behind
 * wall-clock time, which is correct: the alternative is a feedback loop where
 * catching up makes the next frame slower, forever.
 *
 * ============================================================================
 * THE WRITE-OWNERSHIP TABLE (NORMATIVE)
 * ============================================================================
 * File-disjointness alone does NOT prevent two modules writing `velX`. This
 * table does. Each EntityStore column has exactly ONE writing phase. Reading is
 * unrestricted. In dev builds, `assertWritePhase()` checks this at runtime.
 *
 *   COLUMN                      | WRITER (phase)          | OWNING MODULE
 *   ----------------------------|-------------------------|------------------
 *   flags:Selected/Hovered      | (render, outside sim)   | input-camera
 *   flags:UnderConstruction     | Production              | production
 *   flags:Powered               | Economy                 | economy
 *   flags:Veteran1/2            | Damage                  | combat
 *   flags:Burning               | Damage                  | combat
 *   flags:PendingDestroy        | any (via markDead)      | —
 *   kind/owner/faction/defId    | spawn only              | —
 *   posX/posY/posZ              | Movement                | nav-movement
 *   yaw / desiredYaw            | Movement / Steering     | nav-movement
 *   turretYaw / barrelPitch     | Weapons                 | combat
 *   hullPitch / hullRoll        | Movement                | nav-movement
 *   prev* (all)                 | Clock.snapshotPrev      | foundation
 *   velX / velZ                 | Steering                | nav-movement
 *   speed                       | Movement                | nav-movement
 *   maxSpeed/accel/turnRate     | spawn only              | production
 *   cellX / cellZ               | Movement                | nav-movement
 *   navField                    | PathRequest             | nav-movement
 *   treadPhase                  | Movement                | nav-movement
 *   hp                          | Damage (applyDamage)    | combat
 *   maxHp                       | spawn / Damage(vet)     | combat
 *   cooldown / burstLeft        | Weapons                 | combat
 *   targetId                    | Targeting               | combat
 *   lastHitTime/lastAttackerId  | Damage                  | combat
 *   veterancy / killCount       | Damage                  | combat
 *   state                       | Command / Economy / AI  | see note
 *                               | / Targeting             | see note 2
 *   orderKind / orderTarget     | Command                 | foundation(Orders)
 *   orderX / orderZ             | Command, then Targeting  | see note 2
 *   stance                      | Command                 | foundation
 *   guardX / guardZ             | Command, PathRequest    | see note 3
 *   cargo                       | Economy                 | economy
 *   dockTarget                  | Economy                 | economy
 *   buildProgress               | Production              | production
 *   footprintW/H                | spawn only              | production
 *   powerDraw                   | spawn / Economy         | economy
 *   recoil / animClip / animTime| render frame            | unit-art
 *   emissive                    | render frame            | building-art
 *
 *   NOTE on `state`: the behaviour FSM is written by whichever phase owns that
 *   behaviour — Command sets Moving/Attacking, Economy sets the harvester
 *   states, Production sets UnderConstruction. Two phases never write it in the
 *   same tick because a unit is only ever in one behaviour family.
 *
 *   NOTE 2 — THE ORDER POINT HAS A SECOND WRITER, AND IT ALWAYS HAS HAD.
 *   Command establishes `orderX/orderZ` at phase 100; `sim/Targeting.ts` then
 *   MAINTAINS them at phase 900 for the two behaviours that need a goal nobody
 *   else can compute, because both need a weapon range and nothing in the nav
 *   layer has one:
 *
 *     `UnitState.Attacking` — closing on an ordered target, stopping at a
 *       firing standoff rather than at the target's wall.
 *     `UnitState.Guarding`  — a stance excursion: out to a target of
 *       opportunity within `STANCE_CHASE_METRES` of the post, then back to
 *       `guardX/guardZ`.
 *
 *   This row read "Command" alone for a long time while `Targeting.ts`'s own
 *   header already documented the first half, which is a table describing less
 *   than the code does — the defect `docs/SPEC_DRIFT_AUDIT.md` catalogues.
 *
 *   The ordering is what makes it safe rather than a race: 100 is strictly
 *   before 900, so a right-click always lands first and Targeting sees the
 *   state it produced in the SAME tick. Every state except those two belongs to
 *   somebody else and Targeting refuses to touch it, which is why an
 *   auto-engagement can never overwrite an order the player is still waiting
 *   on. `orderKind` and `orderTarget` stay with Command, unqualified.
 *
 *   NOTE 3 — THE POST. `guardX/guardZ` is where a unit belongs when nobody is
 *   telling it anything, and it is the return goal for every stance excursion.
 *   Command pins it explicitly for `OrderKind.Guard`; `NavAssigner`
 *   (Phase.PathRequest) re-takes it on exactly one edge — the tick a
 *   goal-seeking state ends — so it follows the player's last expressed intent
 *   and nothing else. Spawn, rally, transport unload and the pocket rescue all
 *   seed it, and each of those is a spawn-like event rather than a per-tick
 *   writer.
 * ============================================================================
 */

import {
  SIM_DT, MAX_SUBSTEPS, MAX_FRAME_DT, GAME_SPEEDS, DEFAULT_SPEED_INDEX,
} from './config';
import { Phase, RenderPhase } from './types';
import type { SystemModule, SimContext, RenderContext, QualityTier, IRng } from './types';
import type { World } from './world';
import type { Channels } from './events';
import { Rng } from './math';

/* ==========================================================================
 * 1. TIME SOURCE
 *
 * One indirection so tests can drive the loop deterministically without any
 * real clock, and so `performance.now()` never appears inside a sim system.
 * ========================================================================== */

/** Monotonic milliseconds. Falls back to Date.now in non-browser contexts. */
export const now: () => number =
  (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

/** Schedule a frame. Falls back to a 16 ms timer for headless test runs. */
type FrameScheduler = (cb: (t: number) => void) => number;
type FrameCanceller = (h: number) => void;

const scheduleFrame: FrameScheduler =
  (typeof requestAnimationFrame === 'function')
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(now()), 16) as unknown as number;

const cancelFrame: FrameCanceller =
  (typeof cancelAnimationFrame === 'function')
    ? (h) => cancelAnimationFrame(h)
    : (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>);

/* ==========================================================================
 * 2. PROFILER
 *
 * Per-system rolling timings, plus the heap canary that backs the zero-GC
 * assertion. Sampling is behind a flag because `now()` is not free at 30 calls
 * per tick.
 * ========================================================================== */

/** Rolling window length for the per-system average. */
const PROFILE_WINDOW = 60;

export interface SystemTiming {
  id: string;
  phase: number;
  /** Milliseconds for the most recent call. */
  last: number;
  /** Rolling mean over PROFILE_WINDOW calls. */
  avg: number;
  /** Worst observed since the last reset. */
  peak: number;
}

/** Per-system timing collector. */
export class Profiler {
  enabled = false;
  private readonly timings = new Map<string, SystemTiming>();
  private readonly samples = new Map<string, Float64Array>();
  private readonly cursor = new Map<string, number>();

  /** Milliseconds of the whole sim step and the whole render frame. */
  simMs = 0;
  frameMs = 0;
  /** Rolling mean frame time, used by the quality governor. */
  avgFrameMs = 16.7;
  private readonly frameSamples = new Float64Array(PROFILE_WINDOW);
  private frameCursor = 0;
  private frameFilled = 0;

  /** Heap canary. Flat over a 60 s soak means we are not allocating per frame. */
  heapBytes = 0;
  heapStartBytes = 0;

  record(id: string, phase: number, ms: number): void {
    let t = this.timings.get(id);
    if (t === undefined) {
      t = { id, phase, last: 0, avg: 0, peak: 0 };
      this.timings.set(id, t);
      this.samples.set(id, new Float64Array(PROFILE_WINDOW));
      this.cursor.set(id, 0);
    }
    t.last = ms;
    if (ms > t.peak) t.peak = ms;

    const buf = this.samples.get(id)!;
    let c = this.cursor.get(id)!;
    buf[c] = ms;
    c = (c + 1) % PROFILE_WINDOW;
    this.cursor.set(id, c);

    let sum = 0;
    for (let i = 0; i < PROFILE_WINDOW; i++) sum += buf[i];
    t.avg = sum / PROFILE_WINDOW;
  }

  recordFrame(ms: number): void {
    this.frameMs = ms;
    this.frameSamples[this.frameCursor] = ms;
    this.frameCursor = (this.frameCursor + 1) % PROFILE_WINDOW;
    if (this.frameFilled < PROFILE_WINDOW) this.frameFilled++;
    let sum = 0;
    for (let i = 0; i < this.frameFilled; i++) sum += this.frameSamples[i];
    this.avgFrameMs = sum / this.frameFilled;
  }

  /** Sample the JS heap where the browser exposes it (Chromium only). */
  sampleHeap(): void {
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
    if (perf.memory !== undefined) {
      this.heapBytes = perf.memory.usedJSHeapSize;
      if (this.heapStartBytes === 0) this.heapStartBytes = this.heapBytes;
    }
  }

  /** Heap growth in bytes since the first sample. Should be ~flat. */
  get heapGrowth(): number {
    return this.heapStartBytes === 0 ? 0 : this.heapBytes - this.heapStartBytes;
  }

  /** All timings, for the F3 overlay. Sorted by phase. */
  all(out: SystemTiming[]): SystemTiming[] {
    out.length = 0;
    for (const t of this.timings.values()) out.push(t);
    out.sort((a, b) => a.phase - b.phase);
    return out;
  }

  get(id: string): SystemTiming | undefined {
    return this.timings.get(id);
  }

  reset(): void {
    this.timings.clear();
    this.samples.clear();
    this.cursor.clear();
    this.frameFilled = 0;
    this.frameCursor = 0;
    this.heapStartBytes = 0;
  }
}

/* ==========================================================================
 * 3. SYSTEM REGISTRY
 *
 * Modules register with a numeric phase. The registry sorts once and then runs
 * flat arrays — no per-tick sorting, no map lookups, no closures.
 * ========================================================================== */

/** Internal record: the module plus its resolved sort key. */
interface Registered {
  module: SystemModule;
  phase: number;
  order: number;
  /** Registration index, the final tie-break so ordering is fully determined. */
  seq: number;
}

export class SystemRegistry {
  private readonly all: Registered[] = [];
  /** Sorted, flat, sim-tick-capable modules. */
  private simSystems: SystemModule[] = [];
  private simPhases: number[] = [];
  /** Sorted, flat, frame-capable modules. */
  private frameSystems: SystemModule[] = [];
  private framePhases: number[] = [];
  private dirty = false;
  private seq = 0;
  private initialised = false;

  constructor(readonly profiler: Profiler) {}

  /**
   * Register a module. Safe to call before or after `init`; a module added
   * later is initialised immediately if the registry has already booted.
   */
  add(module: SystemModule): void {
    if (this.all.some((r) => r.module.id === module.id)) {
      // Duplicate ids would make profiling and the write-phase assert lie.
      console.warn(`[SystemRegistry] duplicate module id "${module.id}" ignored`);
      return;
    }
    this.all.push({
      module,
      phase: module.phase ?? Phase.Command,
      order: module.order ?? 0,
      seq: this.seq++,
    });
    this.dirty = true;
  }

  /** Register several at once. */
  addAll(modules: readonly SystemModule[]): void {
    for (let i = 0; i < modules.length; i++) this.add(modules[i]);
  }

  /** Remove by id. Calls dispose(). */
  remove(id: string): void {
    const i = this.all.findIndex((r) => r.module.id === id);
    if (i < 0) return;
    this.all[i].module.dispose?.();
    this.all.splice(i, 1);
    this.dirty = true;
  }

  /** Sort and rebuild the flat run lists. Idempotent. */
  private rebuild(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const sim = this.all
      .filter((r) => typeof r.module.simTick === 'function')
      .sort((a, b) => (a.phase - b.phase) || (a.order - b.order) || (a.seq - b.seq));
    this.simSystems = sim.map((r) => r.module);
    this.simPhases = sim.map((r) => r.phase);

    const frame = this.all
      .filter((r) => typeof r.module.frame === 'function')
      .sort((a, b) => {
        const pa = a.module.renderPhase ?? RenderPhase.Bridge;
        const pb = b.module.renderPhase ?? RenderPhase.Bridge;
        return (pa - pb) || (a.order - b.order) || (a.seq - b.seq);
      });
    this.frameSystems = frame.map((r) => r.module);
    this.framePhases = frame.map((r) => r.module.renderPhase ?? RenderPhase.Bridge);
  }

  /**
   * Run every module's `init` in phase order. Async inits are awaited in
   * sequence, so a module can rely on everything in an earlier phase being
   * ready (materials before models, models before the render bridge).
   */
  async init(): Promise<void> {
    this.rebuild();
    const ordered = this.all
      .slice()
      .sort((a, b) => (a.phase - b.phase) || (a.order - b.order) || (a.seq - b.seq));
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i].module;
      if (m.init === undefined) continue;
      const t0 = now();
      await m.init();
      this.profiler.record(`${m.id}:init`, ordered[i].phase, now() - t0);
    }
    this.initialised = true;
  }

  /**
   * One fixed simulation step: every sim system in phase order.
   *
   * `beginPhase` is called per system, not once per step: without it
   * `activePhase()` reads -1 for the whole tick and `assertWritePhase()` reports
   * a violation for EVERY column written from EVERY system, which is why the
   * assertion had no callers. One integer store per system per tick is beneath
   * measurement next to the system bodies themselves.
   */
  runSim(ctx: SimContext): void {
    this.rebuild();
    const sys = this.simSystems;
    const prof = this.profiler.enabled;
    if (prof) {
      for (let i = 0; i < sys.length; i++) {
        const t0 = now();
        beginPhase(this.simPhases[i]);
        sys[i].simTick!(ctx);
        this.profiler.record(sys[i].id, this.simPhases[i], now() - t0);
      }
    } else {
      for (let i = 0; i < sys.length; i++) {
        beginPhase(this.simPhases[i]);
        sys[i].simTick!(ctx);
      }
    }
    beginPhase(-1);
  }

  /**
   * One rendered frame: every frame system in render-phase order.
   *
   * The phase is pinned to -1 throughout. RenderPhase and Phase are two
   * different numeric spaces (RenderPhase.Terrain is 10, Phase.Command is 100),
   * so publishing a RenderPhase through `beginPhase` would make
   * `assertWritePhase` compare apples to oranges and pass by coincidence.
   * Nothing owned by the write table may be written from a frame system anyway.
   */
  runFrame(ctx: RenderContext): void {
    this.rebuild();
    beginPhase(-1);
    const sys = this.frameSystems;
    const prof = this.profiler.enabled;
    if (prof) {
      for (let i = 0; i < sys.length; i++) {
        const t0 = now();
        sys[i].frame!(ctx);
        this.profiler.record(`${sys[i].id}#f`, this.framePhases[i], now() - t0);
      }
    } else {
      for (let i = 0; i < sys.length; i++) sys[i].frame!(ctx);
    }
  }

  /** Tear down every module in reverse phase order. */
  dispose(): void {
    const ordered = this.all
      .slice()
      .sort((a, b) => (b.phase - a.phase) || (b.order - a.order) || (b.seq - a.seq));
    // One module that throws in dispose() must not abandon the teardown of
    // every module after it — that leaks a renderer, a scene and a set of
    // listeners onto the canvas the NEXT boot claims, and the symptom shows up
    // as a corrupt second match rather than as this stack trace.
    for (let i = 0; i < ordered.length; i++) {
      try {
        ordered[i].module.dispose?.();
      } catch (err) {
        console.error(`[systems] "${ordered[i].module.id}" threw in dispose():`, err);
      }
    }
    this.all.length = 0;
    this.simSystems = [];
    this.frameSystems = [];
    this.simPhases = [];
    this.framePhases = [];
    this.dirty = true;
    this.initialised = false;
  }

  /** Look a module up by id. */
  find(id: string): SystemModule | undefined {
    return this.all.find((r) => r.module.id === id)?.module;
  }

  get count(): number { return this.all.length; }
  get ready(): boolean { return this.initialised; }

  /** Module ids in run order — used by tests to assert the manifest. */
  simOrder(): string[] { this.rebuild(); return this.simSystems.map((m) => m.id); }
  frameOrder(): string[] { this.rebuild(); return this.frameSystems.map((m) => m.id); }
}

/* ==========================================================================
 * 4. WRITE-PHASE ASSERTION (dev builds only)
 *
 * The table at the top of this file is normative; this makes it enforceable.
 * A module calls `beginPhase()` via the loop, and a debug build of a system
 * can call `assertWritePhase('velX', Phase.Steering)` before touching a column.
 * Zero cost in production: the whole thing compiles out behind `devAsserts`.
 * ========================================================================== */

/** Toggle set by Bootstrap from the `__DEV__` define. */
export const devAsserts = { enabled: false };

/** The phase currently executing, for the write assertion. */
let currentPhase: number = -1;

/** Called by the loop before each system runs. */
export function beginPhase(phase: number): void {
  currentPhase = phase;
}

/** The phase currently running, or -1 outside the sim. */
export function activePhase(): number {
  return currentPhase;
}

/**
 * Assert that a column is being written from its owning phase.
 * Logs once per violating (column, phase) pair so a bug does not spam 200
 * messages a tick.
 */
const reportedViolations = new Set<string>();
export function assertWritePhase(column: string, ownerPhase: Phase): void {
  if (!devAsserts.enabled) return;
  if (currentPhase === ownerPhase) return;
  const key = `${column}@${currentPhase}`;
  if (reportedViolations.has(key)) return;
  reportedViolations.add(key);
  console.error(
    `[write-ownership] "${column}" is owned by phase ${ownerPhase} but was ` +
    `written during phase ${currentPhase}. See the table in core/loop.ts.`,
  );
}

/* ==========================================================================
 * 5. THE GAME LOOP
 * ========================================================================== */

/** Callbacks the loop invokes; supplied by Bootstrap. */
export interface LoopHooks {
  /** Called at the start of every sim step, before any system runs. */
  beforeSimStep?(tick: number): void;
  /** Called at the end of every sim step, after Cleanup. */
  afterSimStep?(tick: number): void;
  /** Called once per rendered frame after every frame system has run. */
  render?(ctx: RenderContext): void;
  /**
   * The half of `render` that is NOT presentation — camera integration, aspect,
   * shadow fitting — for a frame that runs every system but does not draw.
   *
   * `advanceTicks` needs one of these per tick. Presenting all of them would be
   * a few hundred full 1440p draws for a four-second advance; skipping the host
   * work entirely would leave camera damping and screen shake frozen while the
   * effects that caused the shake played out, which is a different frame from
   * the one live play produces. So: run the host work every tick, present once.
   */
  hostFrame?(ctx: RenderContext): void;
}

export class GameLoop {
  /** Accumulated unsimulated real time, in seconds. */
  private accumulator = 0;
  /** Timestamp of the previous frame, in ms. */
  private lastTime = 0;
  /** rAF handle. */
  private handle = 0;
  private running = false;

  /** Monotonic sim tick counter. Never resets except on a new match. */
  tick = 0;
  /** Frames rendered since boot. */
  frame = 0;
  /** Interpolation factor 0..1 between the previous and current tick. */
  alpha = 0;
  /** Simulated seconds since match start. */
  simTime = 0;
  /** Wall-clock seconds since the loop started. */
  wallTime = 0;

  paused = false;

  /**
   * THE CAPTURE CLOCK — set by Bootstrap under `?shot=`.
   *
   * A rendered frame normally advances `wallTime` and publishes the real
   * elapsed `dt`, and a great deal of the PRESENTATION reads that: the vfx
   * pools age by it, `buildings.system.ts` feeds it straight into the shared
   * `uTime` that drives radar sweeps, bay doors, damage flicker and the
   * selection pulse, road decals fade on it, the fog-of-war reveal eases on it,
   * the camera damps and shakes on it.
   *
   * A capture cannot afford any of that. The number of rAF frames between boot
   * and the shutter is not fixed — `ready()` polls the loading manager, the
   * harness polls for the curtain — and neither is how long each one took. So
   * two captures of identical code photographed two different moments of every
   * one of those animations. Measured over the full 12-shot set on an idle
   * machine: ZERO of twelve frames were byte-identical between two runs of the
   * same build, and `10-selection` — a fixture with no `advance` at all and a
   * frozen sim — moved `vividPixelFrac` by 0.0146, which is the selection pulse
   * being photographed at a different phase.
   *
   * With this on, an ORGANIC frame advances the render clock by exactly zero.
   * Time moves only when the harness asks for it, through `advanceTicks`, in
   * whole simulation steps. The capture is then a function of the scenario, the
   * seed and the tick count, and of nothing else.
   */
  captureClock = false;

  /** Index into GAME_SPEEDS. */
  speedIndex: number = DEFAULT_SPEED_INDEX;
  /** Steps executed in the most recent frame, for the hitch indicator. */
  lastSteps = 0;
  /** Times we hit MAX_SUBSTEPS and discarded time. */
  hitchCount = 0;

  quality: QualityTier = 2 as QualityTier;

  /** The RNG every sim system draws from. Reseeded per match. */
  rng: IRng;

  /**
   * THE STEP GATE — set by a lockstep client, null in every other match.
   *
   * A deterministic multiplayer client may not run tick N until it holds every
   * peer's commands for the turn N opens. The loop must therefore be able to
   * decline to step, and only the loop can: by the time `beforeSimStep` fires
   * the tick has already been incremented and the world has already advanced
   * its clock.
   *
   * `src/net/net.system.ts` installs it in `init()` and clears it in
   * `dispose()`, so the loop never learns what a network is — the same shape as
   * every other seam here.
   *
   * ONLY `onFrame` CONSULTS IT. `advanceTicks`, `advanceFrames`, `runHeadless`
   * and `captureFrame` step unconditionally: those are the test and capture
   * paths, they have no wall clock and no peer, and a gate there would let a
   * network stall change what a screenshot photographs.
   */
  private stepGate: (() => boolean) | null = null;

  /** Reused context objects — the loop must not allocate. */
  private readonly simCtx: { dt: number; tick: number; time: number; rng: IRng };
  private readonly renderCtx: {
    dt: number; time: number; alpha: number; frame: number; quality: QualityTier;
  };

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
    private readonly registry: SystemRegistry,
    private readonly hooks: LoopHooks = {},
    seed = 1,
  ) {
    this.rng = new Rng(seed);
    this.simCtx = { dt: SIM_DT, tick: 0, time: 0, rng: this.rng };
    this.renderCtx = { dt: 0, time: 0, alpha: 0, frame: 0, quality: this.quality };
    (globalThis as { __vmGameSpeed?: number }).__vmGameSpeed = this.speed;
  }

  /** Reseed the sim RNG. Call before a match starts, never during. */
  seed(s: number): void {
    this.rng = new Rng(s);
    this.simCtx.rng = this.rng;
  }

  /**
   * Install the predicate the loop asks before each fixed step, or null to
   * remove it. See `stepGate`. Returning false stalls simulated time; it never
   * drops or reorders a tick, which is what makes it safe for lockstep — tick N
   * is tick N on every machine no matter when each one got there.
   */
  setStepGate(fn: (() => boolean) | null): void {
    this.stepGate = fn;
  }

  /** True while the gate is refusing to advance. Drives the "waiting" indicator. */
  get stalled(): boolean {
    return this.stepGate !== null && !this.stepGate();
  }

  /** Current speed multiplier. */
  get speed(): number { return GAME_SPEEDS[this.speedIndex]; }

  setSpeed(index: number): void {
    this.speedIndex = index < 0 ? 0 : index >= GAME_SPEEDS.length ? GAME_SPEEDS.length - 1 : index;
    (globalThis as { __vmGameSpeed?: number }).__vmGameSpeed = this.speed;
  }

  cycleSpeed(): void {
    this.setSpeed((this.speedIndex + 1) % GAME_SPEEDS.length);
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  togglePause(): void { this.paused = !this.paused; }

  /** Begin driving frames. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = now();
    this.accumulator = 0;
    const step = (t: number) => {
      if (!this.running) return;
      this.handle = scheduleFrame(step);
      this.onFrame(t);
    };
    this.handle = scheduleFrame(step);
  }

  /** Stop driving frames. The world is left untouched. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelFrame(this.handle);
    this.handle = 0;
  }

  get isRunning(): boolean { return this.running; }

  /**
   * One frame: accumulate real time, run 0..MAX_SUBSTEPS fixed sim steps,
   * compute alpha, then render.
   */
  private onFrame(t: number): void {
    const profiler = this.registry.profiler;
    const frameStart = now();

    // --- accumulate ------------------------------------------------------
    let realDt = (t - this.lastTime) / 1000;
    this.lastTime = t;
    // Clamp: a tab-switch or a breakpoint must not queue 40 seconds of sim.
    if (!(realDt > 0)) realDt = 0;
    if (realDt > MAX_FRAME_DT) realDt = MAX_FRAME_DT;
    // Under `?shot=` an organic frame is worth no time at all — see captureClock.
    if (this.captureClock) realDt = 0;
    // `wallTime` is advanced by `renderPass`, so that a frame the harness
    // synthesises moves the render clock by exactly its own dt and an organic
    // one moves it by the real elapsed time. One writer, one meaning.

    if (!this.paused) {
      // Game speed scales the ACCUMULATOR, never SIM_DT — changing dt would
      // change physics behaviour and break determinism across speed settings.
      this.accumulator += realDt * this.speed;
    }

    // --- fixed steps -----------------------------------------------------
    let steps = 0;
    let gated = false;
    const gate = this.stepGate;
    while (this.accumulator >= SIM_DT && steps < MAX_SUBSTEPS) {
      if (gate !== null && !gate()) { gated = true; break; }
      this.stepSim();
      this.accumulator -= SIM_DT;
      steps++;
    }
    this.lastSteps = steps;

    if (gated) {
      // A NETWORK WAIT IS NOT A FRAME-TIME SPIRAL, and must not be counted as
      // one. Left alone, the accumulator would keep filling for as long as the
      // peer is late, and the branch below would score every stalled frame as a
      // hitch — a perf HUD reporting hundreds of hitches for a healthy match on
      // a slow connection, which trains everyone to ignore the counter.
      //
      // Clamped rather than zeroed: one step's worth of credit is kept so the
      // frame the frame arrives on steps immediately instead of waiting out
      // another SIM_DT.
      if (this.accumulator > SIM_DT) this.accumulator = SIM_DT;
    } else if (this.accumulator >= SIM_DT) {
      // Still behind after MAX_SUBSTEPS: discard the backlog rather than
      // spiral. Simulated time legitimately falls behind wall-clock here.
      this.hitchCount++;
      this.accumulator = this.accumulator % SIM_DT;
    }

    // --- interpolation factor -------------------------------------------
    this.alpha = this.paused ? 1 : this.accumulator / SIM_DT;

    // --- render ----------------------------------------------------------
    this.renderPass(realDt, this.alpha, true);

    profiler.recordFrame(now() - frameStart);
    if ((this.frame & 63) === 0) profiler.sampleHeap();
  }

  /**
   * ONE COMPLETE FRAME OF THE PRESENTATION: every frame system in render-phase
   * order, then the host's per-frame work, then the presentation queue is
   * emptied.
   *
   * The one and only place a frame is assembled. `onFrame` calls it with the
   * real clock; `advanceTicks` calls it with a fixed one; `captureFrame` calls
   * it for a screenshot. That matters because the ORDER inside it is a
   * contract — `registry.runFrame` before the camera integrates, the fx queue
   * drained by a frame system before it is cleared — and a second copy of that
   * order is a second thing to keep in step.
   *
   * `present` false runs the host work without drawing. Allocation-free: the
   * render context is the one the loop has always reused.
   */
  private renderPass(dt: number, alpha: number, present: boolean): void {
    this.frame++;
    this.wallTime += dt;
    const rc = this.renderCtx;
    rc.dt = dt;
    rc.time = this.wallTime;
    rc.alpha = alpha;
    rc.frame = this.frame;
    rc.quality = this.quality;

    this.registry.runFrame(rc);
    if (present) this.hooks.render?.(rc);
    else this.hooks.hostFrame?.(rc);

    // The presentation queue accumulates across every substep and is drained
    // exactly once here, so a 5-step catch-up frame does not emit five muzzle
    // flashes for one shot.
    this.channels.fx.clear();
  }

  /**
   * One complete frame, on demand, outside the rAF loop. This is what
   * `__VM.screenshot()` renders through.
   *
   * It used to be a bare present — camera, shadow fit, draw — with no
   * `registry.runFrame` in it at all. That made the capture API a trap: any
   * work queued for the next SYSTEM frame had not run when the pixels were
   * read, so `__vmVfx.advance(ms)` followed by `screenshot()` photographed the
   * frame BEFORE the advance. An investigation into an explosion that "was not
   * there" cost real time to exactly this. A capture must never be one frame
   * stale, and the fix is not to remember to call something else first.
   *
   * `dt` defaults to zero so a screenshot ages nothing by itself.
   */
  captureFrame(dt = 0): void {
    this.renderPass(dt, this.alpha, true);
  }

  /**
   * Advance the world by `ticks` fixed steps WITH THE PRESENTATION IN LOCKSTEP:
   * one `stepSim()`, then one complete system frame at exactly SIM_DT, per
   * tick. Synchronous, no rAF, no wall clock, no scheduler.
   *
   * WHY THIS EXISTS RATHER THAN `step(n)` + a sleep
   * -----------------------------------------------
   * `step(n)` runs n simulations and no frames. Everything those ticks pushed
   * into `channels.fx` then arrives in ONE frame — a four-second battle's worth
   * of muzzle flashes, all spawned at age zero — and the harness used to age
   * that pile back down by sleeping in wall clock and photographing whatever
   * the machine reached. Effects age per RENDERED FRAME, so their age at the
   * shutter was a function of frame rate.
   *
   * Interleaving from the harness side does not fix it either, and this was
   * measured: pausing the loop and issuing one `step(1)` plus one
   * `__vmVfx.advance(SIM_DT)` per rAF made `05-combat` p99 luminance WORSE
   * (0.0014 -> 0.0870 between runs). Total elapsed time was exact; which
   * rendered frame consumed which advance was not, so an effect spawned by the
   * tick between two coalesced frames was aged twice over.
   *
   * The only way spawn and age stay in lockstep is for the two to be the same
   * loop, with no scheduler between them. That is this method. An effect
   * spawned by tick T is drained by the frame belonging to tick T and has aged
   * exactly (N - T) * SIM_DT when the last one returns — on any machine, at any
   * frame rate, under any load.
   */
  advanceTicks(ticks: number): void {
    const n = ticks | 0;
    for (let i = 0; i < n; i++) {
      this.stepSim();
      // alpha 1: a fixed step lands exactly ON the tick, never between two.
      this.renderPass(SIM_DT, 1, i === n - 1);
    }
  }

  /**
   * Advance the PRESENTATION by `frames` fixed steps of SIM_DT, leaving the
   * simulation exactly where it is.
   *
   * This is what a `?shot=` fixture needs. Those boot PAUSED, and all of their
   * motion comes from `settleTicks` at scenario init, which runs the ticks with
   * `runHeadless` — no frames — so every effect all of those ticks spawned
   * lands in ONE frame at age zero. What the fixture then wants is for that
   * pile to play out to a chosen moment: smoke to rise, fireballs to fade,
   * damaged hulls to keep wisping. That is presentation time, not simulation
   * time, and the harness used to buy it by sleeping in wall clock.
   *
   * Advancing the SIMULATION instead was tried and rejected on the image:
   * `05-combat` with 120 live ticks on top of its 120 settle ticks is not a
   * battlefield, it is a white sheet — four seconds of tread dust and cook-offs
   * from two dozen vehicles with nothing to clear it. Deterministic, and
   * useless as a measurement of anything else in the frame. `advanceTicks`
   * remains the right primitive for a fixture authored around it; no current
   * one is.
   */
  advanceFrames(frames: number): void {
    const n = frames | 0;
    for (let i = 0; i < n; i++) this.renderPass(SIM_DT, this.alpha, i === n - 1);
  }

  /** Exactly one fixed simulation step. */
  private stepSim(): void {
    const profiler = this.registry.profiler;
    const t0 = now();

    // Snapshot BEFORE anything moves, so render can lerp prev -> cur.
    this.world.store.snapshotPrev();

    this.tick++;
    this.simTime = this.tick * SIM_DT;
    this.world.tick = this.tick;
    this.world.time = this.simTime;
    this.channels.setTick(this.tick);

    this.simCtx.tick = this.tick;
    this.simCtx.time = this.simTime;

    this.hooks.beforeSimStep?.(this.tick);
    this.registry.runSim(this.simCtx);
    this.hooks.afterSimStep?.(this.tick);

    // Damage is applied at Phase.Damage and the queue is emptied here, so a
    // record can never survive into the next tick and double-apply.
    this.channels.damage.clear();

    beginPhase(-1);
    profiler.simMs = now() - t0;
  }

  /**
   * Run N sim steps immediately, with no rendering and no real clock.
   * This is the headless path used by tests and the determinism soak.
   */
  runHeadless(steps: number): void {
    for (let i = 0; i < steps; i++) this.stepSim();
  }

  /** Reset counters for a new match. Does not touch the registry. */
  resetMatch(seed: number): void {
    this.tick = 0;
    this.frame = 0;
    this.alpha = 0;
    this.simTime = 0;
    this.accumulator = 0;
    this.hitchCount = 0;
    this.paused = false;
    this.speedIndex = DEFAULT_SPEED_INDEX;
    (globalThis as { __vmGameSpeed?: number }).__vmGameSpeed = this.speed;
    this.seed(seed);
  }
}

/* ==========================================================================
 * 6. HELPERS FOR MODULE AUTHORS
 * ========================================================================== */

/**
 * Build a SystemModule without repeating the boilerplate. Purely a
 * convenience — returning a plain object literal is equally valid.
 *
 *   export default defineSystem({
 *     id: 'combat.targeting',
 *     phase: Phase.Targeting,
 *     simTick(ctx) { ... },
 *   });
 */
export function defineSystem(m: SystemModule): SystemModule {
  return m;
}

/**
 * True every `n`-th tick, offset by `offset`. The standard way to slice
 * expensive work (targeting, vision, ore scoring) across ticks without every
 * system spiking on the same frame.
 */
export function everyNth(tick: number, n: number, offset = 0): boolean {
  return ((tick + offset) % n) === 0;
}

/**
 * Round-robin slice test for per-entity work: entity `i` is processed on the
 * tick where `(tick + i) % n === 0`. Spreads 200 units' targeting scans evenly
 * across `n` ticks instead of doing all 200 on one.
 */
export function sliceForEntity(tick: number, index: number, n: number): boolean {
  return ((tick + index) % n) === 0;
}
