/**
 * RED ALERT — Bootstrap.
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
import { DEFAULT_QUALITY_TIER, MAP_SIZE } from '../core/config';
import { Faction, type QualityTier as CoreQualityTier, type RenderContext } from '../core/types';
import { hexToInt } from '../core/math';

import {
  RENDER_CONFIG,
  applyQualityTier,
  createRenderer,
  detectQualityTier,
  type QualityTier as RenderQualityTier,
  type RendererHandle,
} from '../render/renderer';
import { createScene, type SceneRig } from '../render/scene';
import { createCameraRig, type CameraRig } from '../render/camera';
import { createPostChain, type PostChain } from '../render/post';
import { initDebug, type DebugHandle } from '../render/debug';

import { pushArt, pushCamera, resolveArt } from './ArtBridge';
import { createPlaceholderScene } from './PlaceholderScene';
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

const RENDER_TIERS: readonly RenderQualityTier[] = ['low', 'medium', 'high', 'ultra'];

function parseTier(tier: string | null | undefined): RenderQualityTier | null {
  if (!tier) return null;
  const t = tier.toLowerCase();
  if ((RENDER_TIERS as readonly string[]).includes(t)) return t as RenderQualityTier;
  // Numeric form, matching core's QualityTier const enum (0..3).
  const n = Number(t);
  if (Number.isInteger(n) && n >= 0 && n < RENDER_TIERS.length) return RENDER_TIERS[n];
  console.warn(`[boot] unknown ?tier=${tier} — auto-detecting`);
  return null;
}

/** Render's string tier -> core's numeric const enum. They are NOT the same type. */
function coreTier(tier: RenderQualityTier): CoreQualityTier {
  const i = RENDER_TIERS.indexOf(tier);
  return (i < 0 ? (DEFAULT_QUALITY_TIER as number) : i) as CoreQualityTier;
}

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

  const scenario = createPlaceholderScene({
    sceneRig,
    alliesColor: hexToInt(art.factions.allies.armorBase),
    sovietsColor: hexToInt(art.factions.soviets.armorBase),
    alliesEmissive: hexToInt(art.factions.allies.emissivePanel),
    sovietsEmissive: hexToInt(art.factions.soviets.emissivePanel),
    animate: !shotMode,
  });
  registry.add(scenario);

  const loop = new GameLoop(world, channels, registry, { render: renderFrame }, seed);
  loop.quality = coreTier(tier);

  /* -- 7. debug ----------------------------------------------------------- */
  const debug = initDebug({
    handle,
    sceneRig,
    cameraRig,
    post,
    mount: options.debugRoot,
    hooks: {
      // Guarantees screenshot() never captures a cleared buffer: it renders
      // and reads back inside the same task.
      renderFrame: () => renderOnce(1 / 60),
      pause: () => loop.pause(),
      resume: () => loop.resume(),
      step: (n: number) => loop.runHeadless(Math.max(1, n | 0)),
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

  cameraRig.setGroundHeightFn(scenario.heightAt);

  /* -- frame body --------------------------------------------------------- */

  let disposed = false;

  /**
   * Everything that must happen to put one frame on screen. Called from the
   * loop's `render` hook, and directly by `hooks.renderFrame` for capture.
   */
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
    const dt = debug.beginFrame(now());
    // Prefer the loop's clamped real dt; fall back to the debug clock when the
    // loop has not produced one yet (frame 0).
    present(ctx.dt > 0 ? ctx.dt : dt);
    debug.counters.entities = world.store.aliveCount;
    debug.counters.simMs = profiler.simMs;
    debug.counters.substeps = loop.lastSteps;
    debug.endFrame();
  }

  /** One synchronous frame, outside the loop. Used by the capture path. */
  function renderOnce(dt: number): void {
    if (disposed) return;
    debug.beginFrame(now());
    present(dt);
    debug.endFrame();
  }

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
      // a battlefield and not one frame of clear colour.
      renderOnce(1 / 60);
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
        // Route through the debug api, not loop.pause(), so `__RA.paused`
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
      setGameContext(null);
      loop.stop();
      registry.dispose();
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
