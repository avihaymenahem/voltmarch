/**
 * VOLTMARCH — Bootstrap.
 *
 * The one file that knows about every layer at once. `src/main.ts` hands it the
 * DOM and the boot flags; it returns a `GameHandle`. Everything else in the
 * program talks through the five frozen seams.
 *
 * Construction order matters and is not negotiable:
 *   1. push core config + art into RENDER_CONFIG   (before anything reads it)
 *   2. renderer  -> owns the GL context and the canvas size
 *   3. scene     -> needs the renderer for the PMREM env bake
 *   4. camera    -> needs the canvas for input, RENDER_CONFIG for its limits
 *   5. post      -> needs handle + scene + camera
 *   6. world/channels/registry/loop -> pure sim, no GL
 *   7. registry.init() (async: shaders, textures) then loop.start()
 *
 * The frame body is the integration contract published by src/render/debug.ts
 * and must stay in that order — `fitShadow` after the camera moved, before the
 * render; `handle.beginFrame()` once or draw-call counts accumulate.
 */

import { Channels } from '../core/events';
import { GameLoop, Profiler, SystemRegistry, devAsserts, now } from '../core/loop';
import { World } from '../core/world';
import { DEFAULT_QUALITY_TIER, MAP_SIZE, SIM_HZ } from '../core/config';
import { Faction, type QualityTier as CoreQualityTier, type RenderContext } from '../core/types';

import {
  RENDER_CONFIG,
  applyQualityTier,
  coreQualityTierOf,
  createRenderer,
  detectQualityTier,
  parseQualityTier,
  type RenderQualityTier,
  type RendererHandle,
} from '../render/renderer';
import { createScene, type SceneRig } from '../render/scene';
import { createCameraRig, type CameraRig } from '../render/camera';
import { createPostChain, type PostChain } from '../render/post';
import { initDebug, type DebugHandle } from '../render/debug';

import { pushArt, pushCamera, resolveArt } from './ArtBridge';
import { setGameContext } from './context';
import { logDiscovery, registerDiscoveredSystems } from './Systems';

/* -------------------------------------------------------------------------- */
/* Contract with main.ts                                                      */
/* -------------------------------------------------------------------------- */

export interface BootOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  menuRoot: HTMLElement;
  debugRoot: HTMLElement;
  shot?: string | null;
  map?: string | null;
  art?: string | null;
  tier?: string | null;
  seed?: number | null;
}

export interface GameHandle {
  ready: Promise<void>;
  start(): void;
  resize(width: number, height: number, dpr: number): void;
  setPaused(paused: boolean): void;
  dispose(): void;
  /** Live sub-objects, for modules that land later and for the console. */
  readonly ctx: GameContext;
}

/** Everything a gameplay module gets handed once it exists. */
export interface GameContext {
  readonly world: World;
  readonly channels: Channels;
  readonly registry: SystemRegistry;
  readonly loop: GameLoop;
  readonly handle: RendererHandle;
  readonly sceneRig: SceneRig;
  readonly cameraRig: CameraRig;
  readonly post: PostChain;
  readonly debug: DebugHandle;
}

/* -------------------------------------------------------------------------- */

function parseTier(tier: string | null | undefined): RenderQualityTier | null {
  const parsed = parseQualityTier(tier);
  if (parsed === null && tier) console.warn(`[boot] unknown ?tier=${tier} — auto-detecting`);
  return parsed;
}

/**
 * Render's string tier -> core's numeric const enum. They are NOT the same
 * type: render's picks a PIPELINE preset (resolution, shadow map, post passes),
 * core's picks a CONTENT budget (particles, decals, texture size, LOD). The
 * conversion itself lives in renderer.ts so there is exactly one copy of the
 * ordering; this wrapper only supplies the fallback core cares about.
 */
function coreTier(tier: RenderQualityTier): CoreQualityTier {
  const i = coreQualityTierOf(tier);
  return (i < 0 ? (DEFAULT_QUALITY_TIER as number) : i) as CoreQualityTier;
}

// Declared locally, as in post.ts / renderer.ts / UnitFactory.ts. The global in
// main.ts covers `tsconfig.json` (which includes all of src/**), but NOT
// `tsconfig.test.json`, whose `include` is tests/** — nothing there imports
// main.ts, so the global never loads and this file failed `npm run typecheck`
// the moment any test reached Bootstrap.ts, even through a type-only import.
declare const __DEV__: boolean;

function devBuild(): boolean {
  // __DEV__ is a vite `define`. Guard so this file is also importable from a
  // plain node context (tests) where the define never ran.
  return typeof __DEV__ !== 'undefined' ? __DEV__ : false;
}

/* -------------------------------------------------------------------------- */
/* bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

export function bootstrap(options: BootOptions): GameHandle {
  const shotMode = options.shot != null && options.shot !== '';
  const seed = options.seed ?? 1;

  /* -- 1. config ---------------------------------------------------------- */
  const art = resolveArt(options.art);
  pushCamera();
  pushArt(art);

  const tier = parseTier(options.tier) ?? detectQualityTier();
  applyQualityTier(tier);

  devAsserts.enabled = devBuild();

  /* -- 2..5. render stack ------------------------------------------------- */
  const handle = createRenderer({
    canvas: options.canvas,
    container: options.canvas.parentElement,
    preserveDrawingBuffer: shotMode || undefined,
  });

  const sceneRig = createScene({ renderer: handle.renderer });

  const cameraRig = createCameraRig({
    domElement: options.canvas,
    focusX: MAP_SIZE * 0.5,
    focusZ: MAP_SIZE * 0.5,
    aspect: handle.size.cssWidth / Math.max(1, handle.size.cssHeight),
    // A screenshot is posed by the harness; live input would fight it.
    attachInput: !shotMode,
  });

  const post = createPostChain({
    handle,
    scene: sceneRig.scene,
    camera: cameraRig.camera,
  });

  /* -- 6. simulation core ------------------------------------------------- */
  const world = new World();
  const channels = new Channels();
  const profiler = new Profiler();
  const registry = new SystemRegistry(profiler);

  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);


  const loop = new GameLoop(
    world,
    channels,
    registry,
    { render: renderFrame, hostFrame: hostFrame },
    seed,
  );
  loop.quality = coreTier(tier);
  // A capture is a measurement, so it may not depend on how many frames the
  // machine happened to render or how long they took. See GameLoop.captureClock.
  loop.captureClock = shotMode;

  /* -- 7. debug ----------------------------------------------------------- */
  const debug = initDebug({
    handle,
    sceneRig,
    cameraRig,
    post,
    mount: options.debugRoot,
    hooks: {
      /*
       * Guarantees screenshot() never captures a cleared buffer: it renders and
       * reads back inside the same task.
       *
       * It used to be `renderOnce(1 / 60)` — a bare present, with no
       * `registry.runFrame` in it. So anything queued for the next SYSTEM frame
       * had not run when the pixels were read: `__vmVfx.advance(ms)` then
       * `screenshot()` returned the frame BEFORE the advance, and one
       * investigation concluded from that image that an explosion was absent.
       * `loop.captureFrame()` runs every frame system first. dt 0, so the
       * capture itself ages nothing.
       */
      renderFrame: () => loop.captureFrame(0),
      pause: () => loop.pause(),
      resume: () => loop.resume(),
      step: (n: number) => loop.runHeadless(Math.max(1, n | 0)),
      // The deterministic advance the screenshot harness runs on: sim and
      // presentation in lockstep, no wall clock anywhere. See
      // GameLoop.advanceTicks.
      advanceTicks: (n: number) => loop.advanceTicks(Math.max(0, n | 0)),
      advanceFrames: (n: number) => loop.advanceFrames(Math.max(0, n | 0)),
      // Published so `tools/shoot.mjs` can corroborate the tick rate it does
      // its seconds-to-ticks arithmetic with. The harness never imports source
      // — it drives a built bundle over HTTP — so its copy of SIM_HZ is a
      // duplicate, and a duplicate nobody checks is a duplicate that drifts.
      simHz: () => SIM_HZ,
      setTimeScale: (scale: number) => {
        // GAME_SPEEDS is [0.5, 1, 1.5, 2]; pick the closest index.
        const speeds = [0.5, 1.0, 1.5, 2.0];
        let best = 1;
        for (let i = 0; i < speeds.length; i++) {
          if (Math.abs(speeds[i] - scale) < Math.abs(speeds[best] - scale)) best = i;
        }
        loop.setSpeed(best);
      },
      setUiVisible: (v: boolean) => {
        options.hudRoot.style.visibility = v ? '' : 'hidden';
        options.menuRoot.style.visibility = v ? '' : 'hidden';
      },
      restart: (s?: number) => loop.resetMatch(s ?? seed),
    },
  });

  // A flat sampler until `world.terrain`'s init replaces it. The rig must have
  // SOMETHING before the first frame or its focus point falls through the floor.
  cameraRig.setGroundHeightFn(() => 0);

  /* -- frame body --------------------------------------------------------- */

  let disposed = false;

  /**
   * Everything that must happen to put one frame on screen. Called from the
   * loop's `render` hook, and directly by `hooks.renderFrame` for capture.
   */
  /**
   * The host's per-frame work that is not drawing: integrate the camera, keep
   * the aspect honest, refit the shadow frustum to where the camera now is.
   *
   * Split out of `present` so `GameLoop.advanceTicks` can run it once per tick
   * without paying for a full 1440p draw per tick. Camera damping and screen
   * shake decay live in `cameraRig.update`, and a deterministic advance that
   * skipped them would leave the camera shaking from an explosion that finished
   * three seconds of simulated time ago.
   */
  function hostFrame(ctx: RenderContext): void {
    if (disposed) return;
    cameraRig.update(ctx.dt);
    cameraRig.setAspect(handle.size.cssWidth, handle.size.cssHeight);
    sceneRig.fitShadow(cameraRig.camera);
  }

  function present(dt: number): void {
    if (disposed) return;
    handle.beginFrame();
    cameraRig.update(dt);
    cameraRig.setAspect(handle.size.cssWidth, handle.size.cssHeight);
    sceneRig.fitShadow(cameraRig.camera);
    post.render(dt);
  }

  /** The GameLoop's per-frame render hook. */
  function renderFrame(ctx: RenderContext): void {
    if (disposed) return;
    const wallDt = debug.beginFrame(now());
    // Prefer the loop's dt; fall back to the debug clock when the loop has not
    // produced one yet (frame 0).
    //
    // NOT under `?shot=`. There the loop's dt is deliberately zero on an
    // organic frame (GameLoop.captureClock), and falling back to the wall clock
    // would put exactly the thing the capture clock exists to remove — real
    // elapsed time — back into camera damping and shake decay.
    const dt = ctx.dt > 0 ? ctx.dt : (shotMode ? 0 : wallDt);
    present(dt);
    debug.counters.entities = world.store.aliveCount;
    debug.counters.simMs = profiler.simMs;
    debug.counters.substeps = loop.lastSteps;
    debug.endFrame();
  }

  /** One synchronous present, outside the loop. Used for the boot paint. */
  function renderOnce(dt: number): void {
    if (disposed) return;
    debug.beginFrame(now());
    present(dt);
    debug.endFrame();
  }

  /*
   * THE UNDRAWN-BUFFER GUARANTEE.
   *
   * `renderer.ts` knows when the drawing buffer has just been reallocated and is
   * holding nothing; it does not know how to draw the game. So it borrows
   * `present`. Anything that resizes the canvas outside a frame — `src/main.ts`
   * debouncing a window `resize` or a DPR change into `GameHandle.resize()`, a
   * fullscreen toggle, a display switch, a context restore — now gets a complete
   * frame drawn into the new buffer before the browser paints, instead of the
   * flat clear that was being presented. See `src/render/RepaintGuard.ts`.
   *
   * `dt` is zero: a repaint is the SAME moment redrawn at a new size, not a new
   * moment. Anything else would let a window drag age the effect pools and would
   * put wall-clock time into a `?shot=` capture, which is the defect
   * `GameLoop.captureClock` exists to remove.
   */
  handle.setPresenter(() => {
    if (disposed) return;
    present(0);
  });

  /* -- handle ------------------------------------------------------------- */

  const ctx: GameContext = {
    world,
    channels,
    registry,
    loop,
    handle,
    sceneRig,
    cameraRig,
    post,
    debug,
  };

  // Modules reach the world through ctx(); it must exist before any init runs.
  setGameContext(ctx);

  // A module joins the frame by existing — see src/game/Systems.ts. Discovery
  // happens after the placeholder is registered so a real terrain system, which
  // shares its render phase, sorts deterministically behind it.
  logDiscovery(registerDiscoveredSystems(registry));

  const ready = registry
    .init()
    .then(() => {
      // Compile every shader now rather than hitching on frame one.
      handle.renderer.compile(sceneRig.scene, cameraRig.camera);
      sceneRig.bakeEnvironment();
      // Paint once before main.ts drops the loading curtain, so the reveal is
      // a battlefield and not one frame of clear colour. Zero dt under `?shot=`
      // — this paint must not be the one thing that smuggles wall-clock time
      // into a capture.
      renderOnce(shotMode ? 0 : 1 / 60);
    })
    .catch((err: unknown) => {
      console.error('[boot] system init failed', err);
      throw err;
    });

  return {
    ready,
    ctx,

    start(): void {
      if (disposed) return;
      if (shotMode) {
        // A shot must be reproducible: no wall clock, no drifting animation.
        // Route through the debug api, not loop.pause(), so `__VM.paused`
        // agrees with reality — the harness reads that flag.
        debug.api.pause();
      }
      loop.start();
    },

    resize(): void {
      if (disposed) return;
      // The renderer owns measurement itself (ResizeObserver + a DPR media
      // query), so the reported size is authoritative and main.ts's numbers are
      // ignored on purpose. This call just forces an immediate re-evaluation so
      // a window drag feels instant instead of waiting for the rAF debounce.
      handle.resize(true);
      cameraRig.setAspect(handle.size.cssWidth, handle.size.cssHeight);
    },

    setPaused(paused: boolean): void {
      if (disposed) return;
      if (paused) loop.pause();
      else loop.resume();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      loop.stop();
      // registry.dispose() BEFORE the context is torn down. A module's own
      // dispose() legitimately reaches for ctx() — `sim/features.system.ts`
      // does, to unregister its five siblings — and clearing the context first
      // made every one of those throw, aborting the teardown loop and leaving
      // the renderer, the post chain and the scene alive on the canvas that the
      // next boot then claims.
      registry.dispose();
      setGameContext(null);
      debug.dispose();
      post.dispose();
      cameraRig.dispose();
      sceneRig.dispose();
      handle.dispose();
      channels.clear();
    },
  };
}

export default bootstrap;
