/**
 * Domain-owned config slice: renderer quality, ordering and performance contracts.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import type { QualityTier } from '../types';

/* ==========================================================================
 * 13. RENDER QUALITY TIERS
 *
 * THIS TABLE DOES NOT SET THE RESOLUTION SCALE AND NEVER DID.
 *
 * The header here used to read "The governor drops resolutionScale BEFORE it
 * drops particles", describing a governor that was never written — and while
 * that sentence sat here, `QUALITY_PRESETS[t].resolutionScale` (0.72 / 0.85 /
 * 1.0 / 1.0) had **zero readers**, and disagreed with the table that does the
 * job. Audited on a booted page, the live chain is:
 *
 *   1. `RENDER_QUALITY_PRESETS` in `src/render/renderer.ts` — 0.75 / 0.9 /
 *      1.0 / 1.0 — applied by `applyQualityTier` at boot;
 *   2. then OVERWRITTEN a moment later by `settings.graphics.resolutionScale`
 *      (default 1.0), which `Settings.apply` pushes through
 *      `handle.setResolutionScale` whenever the tier or the slider changes;
 *   3. then steered below that ceiling by `src/render/AdaptiveResolution.ts`,
 *      which adopts whatever (2) chose as its ceiling.
 *
 * So the SLIDER wins, the renderer's tier table is a transient, and this one
 * was decoration. Measured: booting `?tier=low|medium|high|ultra` produced a
 * 1152x648 buffer in all four cases at t=0 and 1280x720 in all four once
 * settings landed — the tier column never reaches the screen at all.
 *
 * `resolutionScale` is deleted from `QualitySettings` for that reason, along
 * with `GOVERNOR_DROP_MS` / `GOVERNOR_RAISE_MS` / `GOVERNOR_WINDOW` /
 * `MIN_RESOLUTION_SCALE`, which were the never-built governor's tunables and
 * also had zero readers. `MIN_RESOLUTION_SCALE` was 0.6 against the live
 * `ADAPTIVE.minScale` of 0.55 — a third number for one quantity.
 *
 * TEN OF THE ELEVEN REMAINING FIELDS ARE STILL DEAD. `textureSize` is the only
 * one any reader touches (four `*.system.ts` art modules, for the greeble
 * atlas). They are left alone here because they are not resolution scaling and
 * are not this audit; do not read their survival as evidence they are wired.
 * ========================================================================== */

/*
 * FOUR FIELDS WERE DELETED FROM THIS INTERFACE, and the reason is worth
 * keeping because it is the shape of `docs/SPEC_DRIFT_AUDIT.md` #22:
 *
 *   - `resolutionScale` (0.72/0.85/1.0/1.0) named the one quantity in this
 *     file that a live system steers, and was read by nobody while three other
 *     places disagreed with it. See the block above for the real chain.
 *
 *   - `shadowCascades` (1/2/2/2) configured a cascade chain that does not
 *     exist. `scene.ts` builds ONE `DirectionalLight` with ONE orthographic
 *     shadow camera; the ground bounce beside it sets `castShadow = false`.
 *   - `shadowResolution` (1024/1536/2048/2048) had no reader. The LIVE shadow
 *     map size is chosen in `src/shell/Settings.ts` from the graphics tier
 *     (1024/1536/2048/4096, default 'high') and lands on
 *     `RENDER_CONFIG.renderer.shadows.mapSize`. Two tables disagreeing about
 *     one number, with only one of them wired up, is worse than one table.
 *   - `lodBias` (0.6/0.85/1.0/1.4) was "metres at which units drop to their
 *     lowest LOD" and THERE IS NO LOD SYSTEM: no `THREE.LOD`, no
 *     `SimplifyModifier`, nothing repo-wide. `ModelBuild.lodDistances` went
 *     with it.
 *
 * THIS PARAGRAPH USED TO READ "Everything left here has a real consumer", and
 * that was not true when it was written and is not true now: `textureSize` is
 * the only field below that anything reads. The instruction it carried is the
 * good half and stands — do not add a knob back until the thing it configures
 * exists — but do not take the survival of the other ten as evidence of a
 * consumer. Grep before you tune one.
 */
export interface QualitySettings {
  ssao: boolean;
  bloom: boolean;
  godRays: boolean;
  heatHaze: boolean;
  /** 'smaa' | 'fxaa' | 'none'. */
  antialias: string;
  maxParticles: number;
  maxDecals: number;
  maxDynamicLights: number;
  waterReflections: boolean;
  anisotropy: number;
  /** Edge length of generated albedo textures. */
  textureSize: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  0 /* Low */: {
    ssao: false, bloom: true, godRays: false, heatHaze: false,
    antialias: 'fxaa', maxParticles: 1200, maxDecals: 128, maxDynamicLights: 2,
    waterReflections: false, anisotropy: 1, textureSize: 256,
  },
  1 /* Medium */: {
    ssao: true, bloom: true, godRays: false, heatHaze: false,
    antialias: 'smaa', maxParticles: 3000, maxDecals: 256, maxDynamicLights: 4,
    waterReflections: false, anisotropy: 4, textureSize: 512,
  },
  2 /* High */: {
    ssao: true, bloom: true, godRays: true, heatHaze: true,
    antialias: 'smaa', maxParticles: 6000, maxDecals: 512, maxDynamicLights: 8,
    waterReflections: true, anisotropy: 8, textureSize: 512,
  },
  3 /* Ultra */: {
    ssao: true, bloom: true, godRays: true, heatHaze: true,
    antialias: 'smaa', maxParticles: 10000, maxDecals: 768, maxDynamicLights: 8,
    waterReflections: true, anisotropy: 16, textureSize: 1024,
  },
};

export const DEFAULT_QUALITY_TIER = 2 as QualityTier;


/* ==========================================================================
 * 14. RENDER ORDER BANDS
 *
 * No module ever writes a raw renderOrder integer — it picks a band.
 * ========================================================================== */

export const RENDER_ORDER = {
  terrain: 0,
  decals: 100,
  opaque: 200,
  water: 300,
  particles: 1000,
  trails: 1100,
  overlay: 2000,
  shroud: 3000,
} as const;

/** Camera/mesh layer bits. */
export const LAYERS = {
  default: 0,
  terrain: 1,
  units: 2,
  effects: 3,
  overlay: 4,
  /** Rendered only into the reflection RT. */
  reflection: 5,
  /** Excluded from shadow casting. */
  noShadow: 6,
} as const;

/* ==========================================================================
 * 15. PERFORMANCE CONTRACT
 * ========================================================================== */

/**
 * Draw call ceiling for the COLOUR PASS. Exceeding this means a batch key is
 * wrong.
 *
 * It does NOT budget `shots/_report.json`'s `frame.drawCalls`, which reads
 * `renderer.info.render.calls` with `autoReset` off and is therefore the SUM
 * over colour + shadow + the GTAO normal prepass + the post quads. Live
 * instrumentation splits `01-establishing-base`'s 219 as 78 colour + 54 shadow
 * + 67 prepass + 20 post. The colour pass is ~78, comfortably inside this
 * number, so do NOT raise the constant to "match" a figure that measures a
 * different quantity.
 */
export const MAX_DRAW_CALLS = 130;
/** Cells a flow field may expand per tick, across ALL fields. */
export const FLOWFIELD_BUDGET_CELLS = 8000;
/** Goal positions quantize to this many cells, so a selection shares a field. */
export const FLOWFIELD_GOAL_BUCKET = 4;
/** LRU capacity for cached flow fields. */
export const FLOWFIELD_CACHE_SIZE = 24;
/** Fraction of units that re-run target acquisition per tick (1/8 = 12.5%). */
export const TARGETING_SLICE = 8;
/** Vision is stamped every Nth tick. */
export const VISION_TICK_INTERVAL = 3;
/** Ore summary grid rebuild interval in ticks. */
export const ORE_SCORING_INTERVAL = 30;
/** Max neighbours considered for unit separation. */
export const SEPARATION_NEIGHBOURS = 8;
/** Overlap relaxation iterations per movement tick. */
export const RELAX_ITERATIONS = 2;
/** Max relaxation push per iteration, as a fraction of the unit radius. */
export const RELAX_MAX_PUSH = 0.35;
/** Relaxation damping. */
export const RELAX_DAMPING = 0.5;
