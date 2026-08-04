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
 *   orderKind/orderTarget/order*| Command                 | foundation(Orders)
 *   stance                      | Command                 | foundation
 *   guardX / guardZ             | Command                 | foundation
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
  /** Index into GAME_SPEEDS. */
  speedIndex: number = DEFAULT_SPEED_INDEX;
  /** Steps executed in the most recent frame, for the hitch indicator. */
  lastSteps = 0;
  /** Times we hit MAX_SUBSTEPS and discarded time. */
  hitchCount = 0;

  quality: QualityTier = 2 as QualityTier;

  /** The RNG every sim system draws from. Reseeded per match. */
  rng: IRng;

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
  }

  /** Reseed the sim RNG. Call before a match starts, never during. */
  seed(s: number): void {
    this.rng = new Rng(s);
    this.simCtx.rng = this.rng;
  }

  /** Current speed multiplier. */
  get speed(): number { return GAME_SPEEDS[this.speedIndex]; }

  setSpeed(index: number): void {
    this.speedIndex = index < 0 ? 0 : index >= GAME_SPEEDS.length ? GAME_SPEEDS.length - 1 : index;
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
    this.wallTime += realDt;

    if (!this.paused) {
      // Game speed scales the ACCUMULATOR, never SIM_DT — changing dt would
      // change physics behaviour and break determinism across speed settings.
      this.accumulator += realDt * this.speed;
    }

    // --- fixed steps -----------------------------------------------------
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < MAX_SUBSTEPS) {
      this.stepSim();
      this.accumulator -= SIM_DT;
      steps++;
    }
    this.lastSteps = steps;

    if (this.accumulator >= SIM_DT) {
      // Still behind after MAX_SUBSTEPS: discard the backlog rather than
      // spiral. Simulated time legitimately falls behind wall-clock here.
      this.hitchCount++;
      this.accumulator = this.accumulator % SIM_DT;
    }

    // --- interpolation factor -------------------------------------------
    this.alpha = this.paused ? 1 : this.accumulator / SIM_DT;

    // --- render ----------------------------------------------------------
    this.frame++;
    const rc = this.renderCtx;
    rc.dt = realDt;
    rc.time = this.wallTime;
    rc.alpha = this.alpha;
    rc.frame = this.frame;
    rc.quality = this.quality;

    this.registry.runFrame(rc);
    this.hooks.render?.(rc);

    // The presentation queue accumulates across every substep and is drained
    // exactly once here, so a 5-step catch-up frame does not emit five muzzle
    // flashes for one shot.
    this.channels.fx.clear();

    profiler.recordFrame(now() - frameStart);
    if ((this.frame & 63) === 0) profiler.sampleHeap();
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
