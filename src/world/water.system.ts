/**
 * ============================================================================
 * RED ALERT — src/world/water.system.ts
 * ============================================================================
 * The registration shim for the water body. All of the work is in Water.ts and
 * WaterMaterial.ts; this file builds one from the terrain, keeps its clock and
 * its light rig current, and runs the two automated guards the bible demands.
 *
 * ORDER
 * -----
 * `Phase.Command, order: 60` puts init AFTER `world.terrain` (order 40) and
 * before every gameplay module. The registry initialises in sim-phase order
 * (see `SystemRegistry.init`), so this is the only lever available — the
 * module has no `simTick` and does not want one.
 *
 * `RenderPhase.Terrain, order: 60` runs `frame()` alongside the ground, well
 * before `RenderPhase.Bridge`, so anything that reads `getWater()` during the
 * bridge or the VFX phase sees a surface whose clock has already advanced.
 *
 * THE TWO GUARDS
 * --------------
 * R7's stated mitigation is "SSR clamped in the shader plus an automated
 * water-luminance probe". Both run here at boot and print, and both fail
 * LOUDLY rather than silently drifting:
 *   scorecard #25 — open-water mean luminance must be 45-115 of 255
 *   scorecard #26 — foam coverage 4-8% calm / 12-16% choppy, filaments 1.5-4 px
 * They are pure maths (no GL), so they also run under vitest and in node.
 *
 * WHEN THE TERRAIN MOVES UNDER US
 * -------------------------------
 * `?biome=` can be changed from the console at runtime, and `Terrain.setBiome`
 * / `setSeed` rebuild the whole heightfield without telling anybody. There is
 * no generation counter on Terrain to subscribe to, so this module keeps a
 * 96-sample checksum of the height array and re-bakes when it changes. The
 * check costs ~96 array reads twice a second; a stale water field costs a lake
 * floating over a hill.
 * ============================================================================
 */

import * as THREE from 'three';
import { defineSystem } from '../core/loop';
import { Phase, RenderPhase, type RenderContext } from '../core/types';
import { WATER_LOOK, WATER_WAVES } from '../core/config';
import { RENDER_CONFIG } from '../render/renderer';
import { ctx } from '../game/context';
import { getTerrain } from './Terrain';
import { Water, getWater, setActiveWater } from './Water';
import type { WaterLightRig } from './WaterMaterial';

/* -------------------------------------------------------------------------- */
/* URL overrides — a critic must be able to A/B every water knob from the bar. */
/* -------------------------------------------------------------------------- */

function query(name: string): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}

function numberQuery(name: string, fallback: number): number {
  const q = query(name);
  if (q === null) return fallback;
  const n = Number(q);
  return Number.isFinite(n) ? n : fallback;
}

/* -------------------------------------------------------------------------- */

let water: Water | null = null;

/** Reused every frame — allocating a rig per frame is 60 Vector3s a second. */
const rig: WaterLightRig = {
  sunDir: new THREE.Vector3(0, 1, 0),
  sunColor: new THREE.Vector3(),
  hemiSky: new THREE.Vector3(),
  hemiGround: new THREE.Vector3(),
};

/** Terrain-regeneration canary. */
let bedChecksum = 0;
let checkAccum = 0;
let lastBiome = '';

function heightChecksum(): number {
  const t = getTerrain();
  if (t === null) return 0;
  const h = t.height;
  const stride = Math.max(1, (h.length / 96) | 0);
  let acc = 0;
  for (let i = 0; i < h.length; i += stride) {
    // Integer mix: float noise in the low bits would make this trip constantly.
    acc = (acc * 31 + Math.round(h[i] * 64)) | 0;
  }
  return acc;
}

export default defineSystem({
  id: 'world.water',
  phase: Phase.Command,
  order: 60,
  renderPhase: RenderPhase.Terrain,

  init(): void {
    const { sceneRig, handle, debug } = ctx();
    const terrain = getTerrain();

    if (terrain === null) {
      // Not fatal: a unit-parade or studio fixture legitimately has no ground.
      // Registering nothing is the correct outcome, and saying so once beats a
      // silent no-op that looks like a bug when a naval shot comes up dry.
      console.warn('[water] no terrain — water is disabled for this map');
      return;
    }

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    water = new Water({
      scene: sceneRig.scene,
      bedHeight: (x, z) => terrain.heightAt(x, z),
      palette: query('water') ?? terrain.biomeKey,
      anisotropy: handle.renderer.capabilities.getMaxAnisotropy(),
    });
    water.setSeaState(numberQuery('sea', WATER_WAVES.seaState));
    setActiveWater(water);

    bedChecksum = heightChecksum();
    lastBiome = terrain.biomeKey;

    pushLightRig(sceneRig.sun, sceneRig.hemi, sceneRig.sunDir);
    water.update(0, rig);

    const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    const s = water.stats();

    if (water.isEmpty) {
      console.info(
        `%c[water]%c ${terrain.biomeKey} is landlocked — no water surface built (${ms | 0} ms)`,
        'color:#7cf', 'color:inherit',
      );
      debug.counters.waterDraws = 0;
      debug.counters.waterTris = 0;
      return;
    }

    console.info(
      `%c[water]%c ${water.paletteName} — ${(s.coverage * 100).toFixed(1)}% of the map, ` +
        `max ${s.maxDepth.toFixed(1)} m, ramp fitted to ${s.rampDepth.toFixed(1)} m, ` +
        `${(s.shorelineMetres | 0)} m of coastline, ` +
        `${s.chunks} draw(s) / ${s.triangles | 0} tris in ${ms | 0} ms`,
      'color:#7cf', 'color:inherit',
    );

    /* ---- guard: scorecard #25, open-water luminance -------------------- */
    const grade = RENDER_CONFIG.post.grade;
    const toneMode = grade.enabled && RENDER_CONFIG.post.enabled
      ? (grade.mode === 'aces' ? 'aces' : grade.mode === 'agx' ? 'agx' : 'none')
      : 'aces';
    const lum = water.probeLuminance(rig, grade.exposure, toneMode);
    const band = WATER_LOOK.luminanceBand;
    const lumMsg = `open water L=${lum.mean.toFixed(1)} of 255 ` +
      `(shallow ${lum.samples[0].toFixed(0)} -> deep ${lum.samples[lum.samples.length - 1].toFixed(0)}, ` +
      `want ${band[0]}-${band[1]})`;
    if (lum.pass) {
      console.info(`%c[water]%c scorecard #25 pass — ${lumMsg}`, 'color:#7cf', 'color:inherit');
    } else {
      console.warn(
        `[water] SCORECARD #25 FAIL — ${lumMsg}. This is bible R7: water that ` +
        'reads bright kills the contrast trick and the whole map goes mobile-game. ' +
        'Fix it with WATER_LOOK.outputGain in core/config.ts — never by adding a ' +
        'reflection term, and never by brightening the ramp.',
      );
    }

    /* ---- guard: scorecard #26, foam is filigree ------------------------ */
    const foam = water.probeFoamCoverage();
    const foamMsg = `foam ${(foam.calm * 100).toFixed(1)}% calm / ` +
      `${(foam.choppy * 100).toFixed(1)}% choppy, filaments ~${foam.filamentPx.toFixed(1)} px ` +
      '(want 4-8 / 12-16 / 1.5-4)';
    if (foam.pass) {
      console.info(`%c[water]%c scorecard #26 pass — ${foamMsg}`, 'color:#7cf', 'color:inherit');
    } else {
      console.warn(`[water] scorecard #26 out of band — ${foamMsg}. Tune WATER_FOAM in core/config.ts.`);
    }

    debug.counters.waterDraws = s.chunks;
    debug.counters.waterTris = s.triangles;

    // Console handle, matching the pattern the other modules use.
    (globalThis as Record<string, unknown>).__raWater = water;
  },

  frame(r: RenderContext): void {
    if (water === null) return;
    const { sceneRig, debug } = ctx();

    pushLightRig(sceneRig.sun, sceneRig.hemi, sceneRig.sunDir);
    water.update(r.dt, rig);

    // Terrain canary, twice a second. Cheap enough to be unconditional and
    // the only thing standing between a biome swap and a floating lake.
    checkAccum += r.dt;
    if (checkAccum >= 0.5) {
      checkAccum = 0;
      const terrain = getTerrain();
      if (terrain !== null) {
        const sum = heightChecksum();
        if (sum !== bedChecksum || terrain.biomeKey !== lastBiome) {
          bedChecksum = sum;
          if (terrain.biomeKey !== lastBiome) {
            lastBiome = terrain.biomeKey;
            if (query('water') === null) water.setPalette(terrain.biomeKey);
          }
          water.rebuild();
          const s = water.stats();
          debug.counters.waterDraws = s.chunks;
          debug.counters.waterTris = s.triangles;
          console.info(
            `%c[water]%c re-baked for ${terrain.biomeKey} — ` +
              `${(s.coverage * 100).toFixed(1)}% water, ${s.chunks} draw(s)`,
            'color:#7cf', 'color:inherit',
          );
        }
      }
    }
  },

  dispose(): void {
    if (water === null) return;
    water.dispose();
    if (getWater() === water) setActiveWater(null);
    delete (globalThis as Record<string, unknown>).__raWater;
    water = null;
  },
});

/**
 * Copy the scene's live rig into the reusable struct.
 *
 * `sun.color` and `hemi.color` are already in the renderer's LINEAR working
 * space (createScene builds them through `srgb()`), so no conversion here —
 * converting twice is the classic way to end up with grey water under a warm
 * sun.
 */
function pushLightRig(
  sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, sunDir: THREE.Vector3,
): void {
  rig.sunDir.copy(sunDir).normalize();
  rig.sunColor.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity);
  rig.hemiSky.set(hemi.color.r, hemi.color.g, hemi.color.b).multiplyScalar(hemi.intensity);
  rig.hemiGround
    .set(hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b)
    .multiplyScalar(hemi.intensity);
}
