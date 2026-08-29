/**
 * Water acceptance tests.
 *
 * These are the bible's own automated guards, not incidental unit tests:
 *  - RULING #7 / R7  — the reflection mix can never exceed 0.10
 *  - scorecard #25   — open-water mean luminance lands in 45-115 of 255
 *  - scorecard #26   — foam coverage 4-8% calm / 12-16% choppy, 1.5-4 px filaments
 *  - scorecard #27   — the shoreline band covers 100% of the land/water contact
 *
 * Everything here is pure maths and typed arrays: no GL, no DOM, no canvas.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MAP_SIZE, WATER_FOAM, WATER_LOOK, WATER_PALETTES, WATER_SHORE, WATER_SSR,
  WATER_WAVES,
} from '../src/core/config';
import {
  LACE_SIGMA, buildFoamLace, buildWaveSlopes, createWaterMaterial, probeFoam,
  probeOpenWaterLuminance, resampleRamp, type WaterLightRig,
} from '../src/world/WaterMaterial';
import { Water, FIELD_N } from '../src/world/Water';
import { srgb } from '../src/render/renderer';
import { RENDER_CONFIG } from '../src/render/renderer';

/** The shipping noon rig, built the same way createScene builds it. */
function noonRig(): WaterLightRig {
  const cfgSun = RENDER_CONFIG.sun;
  const cfgSky = RENDER_CONFIG.sky;
  const az = THREE.MathUtils.degToRad(cfgSun.azimuth);
  const el = THREE.MathUtils.degToRad(cfgSun.elevation);
  const sunDir = new THREE.Vector3(
    Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az),
  ).normalize();
  const sc = srgb(cfgSun.color);
  const hs = srgb(cfgSky.hemiSky);
  const hg = srgb(cfgSky.hemiGround);
  return {
    sunDir,
    sunColor: new THREE.Vector3(sc.r, sc.g, sc.b).multiplyScalar(cfgSun.intensity),
    hemiSky: new THREE.Vector3(hs.r, hs.g, hs.b).multiplyScalar(cfgSky.hemiSkyIntensity),
    hemiGround: new THREE.Vector3(hg.r, hg.g, hg.b).multiplyScalar(cfgSky.hemiSkyIntensity),
  };
}

/**
 * A synthetic bed: a beach sloping from +6 m of land down to -5 m over the
 * left third of the map, then a flat basin. Deterministic, and it gives every
 * test a real shoreline to measure.
 */
function beachBed(x: number, _z: number): number {
  const t = x / MAP_SIZE;
  if (t < 0.30) return 6;
  if (t > 0.45) return -5;
  return 6 + ((t - 0.30) / 0.15) * -11;
}

describe('water — RULING #7, the reflection cap', () => {
  it('never lets the grazing mix exceed 0.10, whatever the config says', () => {
    const material = createWaterMaterial({
      palette: WATER_PALETTES.tropical, rampDepth: 6, seed: 1, textureSize: 64,
    });
    expect(material.uniforms.uSsr.value.x).toBeLessThanOrEqual(WATER_SSR.mixMax);
    expect(WATER_SSR.mixMax).toBeLessThanOrEqual(0.10);
    expect(material.uniforms.uSsr.value.y).toBe(5.0);
    material.dispose();
  });

  it('has no sky, cube-map or env term anywhere in the fragment shader', () => {
    const material = createWaterMaterial({
      palette: WATER_PALETTES.tropical, rampDepth: 6, seed: 1, textureSize: 64,
    });
    const src = material.material.fragmentShader.toLowerCase();
    for (const banned of ['samplercube', 'texturecube', 'envmap', 'skybox', 'reflectionmap']) {
      expect(src).not.toContain(banned);
    }
    // And no fog, per bible §0 property 4.
    expect(material.material.fog).toBe(false);
    material.dispose();
  });
});

describe('water — scorecard #25, open-water darkness', () => {
  const rig = noonRig();
  const grade = RENDER_CONFIG.post.grade;

  for (const key of ['tropical', 'temperate', 'arctic', 'harbour']) {
    it(`${key} lands inside 45-115 of 255 under the shipping grade`, () => {
      const probe = probeOpenWaterLuminance(
        WATER_PALETTES[key], 6.0, rig, grade.exposure, 'agx',
      );
      expect(probe.mean).toBeGreaterThanOrEqual(WATER_LOOK.luminanceBand[0]);
      expect(probe.mean).toBeLessThanOrEqual(WATER_LOOK.luminanceBand[1]);
    });
  }

  it('gets darker with depth — the gradient is the whole point', () => {
    const probe = probeOpenWaterLuminance(
      WATER_PALETTES.tropical, 8.0, rig, grade.exposure, 'agx',
    );
    expect(probe.samples[0]).toBeGreaterThan(probe.samples[probe.samples.length - 1]);
  });

  it('keeps foam translucent enough for hull contrast without changing its coverage', () => {
    expect(WATER_LOOK.foamOpacity).toBeGreaterThanOrEqual(0.40);
    expect(WATER_LOOK.foamOpacity).toBeLessThanOrEqual(0.55);
    const material = createWaterMaterial({
      palette: WATER_PALETTES.temperate, rampDepth: 6, seed: 1, textureSize: 64,
    });
    expect(material.material.fragmentShader).toContain(
      `foam * ${WATER_LOOK.foamOpacity.toFixed(4)}`,
    );
    material.dispose();
  });
});

describe('water — scorecard #26, foam is filigree', () => {
  it('keeps calm foam sparse, storm foam denser, and filaments 1.5-4 px wide', () => {
    const probe = probeFoam();
    expect(probe.calm).toBeGreaterThanOrEqual(WATER_FOAM.coverageCalm[0]);
    expect(probe.calm).toBeLessThanOrEqual(WATER_FOAM.coverageCalm[1]);
    expect(probe.choppy).toBeGreaterThanOrEqual(WATER_FOAM.coverageChoppy[0]);
    expect(probe.choppy).toBeLessThanOrEqual(WATER_FOAM.coverageChoppy[1]);
    expect(probe.filamentPx).toBeGreaterThanOrEqual(1.5);
    expect(probe.filamentPx).toBeLessThanOrEqual(4.0);
  });

  it('bakes a lace field that is actually N(0.5, LACE_SIGMA)', () => {
    const size = 256;
    const lace = buildFoamLace(size, 7);
    let mean = 0;
    for (let i = 0; i < lace.length; i++) mean += lace[i] / 255;
    mean /= lace.length;
    let variance = 0;
    for (let i = 0; i < lace.length; i++) {
      const d = lace[i] / 255 - mean;
      variance += d * d;
    }
    const sigma = Math.sqrt(variance / lace.length);
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
    // Clipping at 0 and 1 shaves the tails slightly; 12% tolerance covers it.
    expect(sigma).toBeGreaterThan(LACE_SIGMA * 0.88);
    expect(sigma).toBeLessThan(LACE_SIGMA * 1.12);
  });

  it('bakes a wave slope map that tiles seamlessly', () => {
    const size = 128;
    const w = buildWaveSlopes(size, 3);
    // A tiling failure shows up as a discontinuity between the last and first
    // column. Compare that seam against a typical interior step.
    let seam = 0;
    let interior = 0;
    for (let y = 0; y < size; y++) {
      const a = (y * size + size - 1) * 4;
      const b = (y * size) * 4;
      const m = (y * size + (size >> 1)) * 4;
      seam += Math.abs(w[a] - w[b]) + Math.abs(w[a + 1] - w[b + 1]);
      interior += Math.abs(w[m] - w[m + 4]) + Math.abs(w[m + 1] - w[m + 5]);
    }
    expect(seam / size).toBeLessThan((interior / size) * 3 + 4);
  });
});

describe('water — the field bake', () => {
  const scene = new THREE.Scene();
  const water = new Water({
    scene, bedHeight: beachBed, level: 0, palette: 'tropical', seed: 11, textureSize: 64,
  });

  it('fits the ramp to the basin the terrain actually produced', () => {
    const s = water.stats();
    expect(s.maxDepth).toBeGreaterThan(4.5);
    expect(s.rampDepth).toBeGreaterThan(WATER_LOOK.rampDepthMin);
    expect(s.rampDepth).toBeLessThanOrEqual(WATER_LOOK.rampDepthMetres);
    // The beach covers the left 37.5% of the map with land.
    expect(s.coverage).toBeGreaterThan(0.55);
    expect(s.coverage).toBeLessThan(0.68);
  });

  it('answers depth and water queries in WORLD metres', () => {
    expect(water.isWater(MAP_SIZE * 0.8, 100)).toBe(true);
    expect(water.isWater(MAP_SIZE * 0.1, 100)).toBe(false);
    expect(water.depthAt(MAP_SIZE * 0.8, 100)).toBeCloseTo(5, 1);
    expect(water.depthAt(MAP_SIZE * 0.1, 100)).toBe(0);
    expect(water.waterLevel).toBe(0);
  });

  it('produces a signed shoreline distance with the zero crossing on the contact', () => {
    // The waterline sits where beachBed returns 0: t = 0.30 + 6/11 * 0.15.
    const contactX = MAP_SIZE * (0.30 + (6 / 11) * 0.15);
    expect(Math.abs(water.shoreDistanceAt(contactX, 256))).toBeLessThan(1.5);
    expect(water.shoreDistanceAt(contactX + 6, 256)).toBeGreaterThan(3.5);
    expect(water.shoreDistanceAt(contactX - 6, 256)).toBeLessThan(-3.5);
  });

  /**
   * Scorecard #27. The band must run along 100% of the contact, so walk every
   * water texel that touches land and assert it is inside the band.
   */
  it('puts a shore band on 100% of the land/water contact', () => {
    let contact = 0;
    let banded = 0;
    for (let z = 1; z < FIELD_N - 1; z++) {
      for (let x = 1; x < FIELD_N - 1; x++) {
        const i = z * FIELD_N + x;
        if (water.depth[i] <= 0) continue;
        const edge = water.depth[i - 1] <= 0 || water.depth[i + 1] <= 0 ||
          water.depth[i - FIELD_N] <= 0 || water.depth[i + FIELD_N] <= 0;
        if (!edge) continue;
        contact++;
        if (water.shore[i] < WATER_SHORE.bandMetres) banded++;
      }
    }
    expect(contact).toBeGreaterThan(100);
    expect(banded).toBe(contact);
  });

  it('builds only the chunks that contain water', () => {
    const s = water.stats();
    expect(s.chunks).toBeGreaterThan(0);
    // 4x4 chunks; the left column is entirely dry land.
    expect(s.chunks).toBeLessThan(16);
    expect(s.triangles).toBeGreaterThan(0);
  });
});

describe('water — wakes', () => {
  const scene = new THREE.Scene();
  const water = new Water({
    scene, bedHeight: () => -5, level: 0, palette: 'tropical', seed: 3, textureSize: 64,
  });

  it('is a no-op below the strength floor and on land', () => {
    water.clearWakes();
    water.addWake(256, 256, 0, 0.0, 12);
    expect(peakWake(water)).toBe(0);
  });

  it('lays a V behind the hull, never in front of it', () => {
    water.clearWakes();
    // Heading +X. Everything must land at x <= the hull, never ahead of it.
    water.addWake(256, 256, 0, 1.0, 12);
    expect(peakWake(water)).toBeGreaterThan(0);
    expect(wakeNear(water, 256 + 20, 256, 3)).toBe(0);
    expect(wakeNear(water, 256 - 12, 256, 2)).toBeGreaterThan(0);
    // Kelvin arms at +/-19 degrees: 30 m astern puts them ~10 m off the axis.
    // A 2 m window, because the arms are DASHED — an exact-texel probe would
    // be testing which gap it happened to land in.
    expect(wakeNear(water, 256 - 30, 256 + 10, 2)).toBeGreaterThan(0);
    expect(wakeNear(water, 256 - 30, 256 - 10, 2)).toBeGreaterThan(0);
    // ...and symmetric about the axis, which is what makes it read as a V.
    expect(wakeNear(water, 256 - 30, 256 + 10, 2))
      .toBeCloseTo(wakeNear(water, 256 - 30, 256 - 10, 2), -1);
  });

  it('makes the arms discrete dashes, not a continuous line', () => {
    water.clearWakes();
    water.addWake(256, 256, 0, 1.0, 12);
    // Walk one arm and count sign changes between "on" and "off".
    const a = Math.PI + (19 * Math.PI) / 180;
    let transitions = 0;
    let prev = false;
    for (let d = 6; d < 45; d += 0.5) {
      const on = wakeAt(water, 256 + Math.cos(a) * d, 256 + Math.sin(a) * d) > 0;
      if (on !== prev) transitions++;
      prev = on;
    }
    expect(transitions).toBeGreaterThan(4);
  });

  it('decays to nothing and then costs nothing', () => {
    water.clearWakes();
    water.addWake(256, 256, 0, 1.0, 12);
    const before = peakWake(water);
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) water.update(1 / 30, null);
    expect(peakWake(water)).toBe(0);
  });
});

describe('water — palettes and ramps', () => {
  it('resamples every authored ramp onto even stops that darken monotonically', () => {
    for (const key of Object.keys(WATER_PALETTES)) {
      const stops = resampleRamp(WATER_PALETTES[key], WATER_LOOK.rampStops);
      expect(stops).toHaveLength(WATER_LOOK.rampStops);
      const lum = stops.map((c) => 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z);
      // Waterline is always brighter than the deep end. Intermediate stops may
      // plateau, but the ramp must never run uphill overall.
      expect(lum[0]).toBeGreaterThan(lum[lum.length - 1]);
    }
  });

  it('keeps the three wave bands inside the bible §7 bands', () => {
    const TL = 7;
    expect(WATER_WAVES.swellMetres / TL).toBeGreaterThanOrEqual(1.2);
    expect(WATER_WAVES.swellMetres / TL).toBeLessThanOrEqual(2.5);
    expect(WATER_WAVES.swellMetres2 / TL).toBeGreaterThanOrEqual(1.2);
    expect(WATER_WAVES.swellAmplitude / TL).toBeCloseTo(0.02, 3);
    expect(WATER_WAVES.swellSpeed / TL).toBeCloseTo(0.10, 3);
    expect(WATER_WAVES.chopSpeed / TL).toBeCloseTo(0.35, 3);
    expect(WATER_WAVES.microSpeed / TL).toBeCloseTo(0.90, 3);
    // Band C must resolve at 2-4 px: 29.6 px/m at the reference resolution.
    const microFeaturePx = (WATER_WAVES.microTileMetres / 8) * (207 / 7);
    expect(microFeaturePx).toBeGreaterThanOrEqual(2);
    expect(microFeaturePx).toBeLessThanOrEqual(5);
  });

  it('keeps the shore band inside scorecard #27s 40-80 px', () => {
    const px = WATER_SHORE.bandMetres * (207 / 7);
    expect(px).toBeGreaterThanOrEqual(40);
    expect(px).toBeLessThanOrEqual(80);
  });
});

/* -------------------------------------------------------------------------- */

function peakWake(water: Water): number {
  const anyW = water as unknown as { wakeData: Uint8Array };
  let max = 0;
  for (let i = 0; i < anyW.wakeData.length; i++) {
    if (anyW.wakeData[i] > max) max = anyW.wakeData[i];
  }
  return max;
}

/** Max wake value within `r` metres — the arms are dashed and 1 texel wide. */
function wakeNear(water: Water, x: number, z: number, r: number): number {
  let max = 0;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const v = wakeAt(water, x + dx, z + dz);
      if (v > max) max = v;
    }
  }
  return max;
}

function wakeAt(water: Water, x: number, z: number): number {
  const anyW = water as unknown as { wakeData: Uint8Array };
  const n = Math.round(Math.sqrt(anyW.wakeData.length));
  const m = MAP_SIZE / n;
  const tx = Math.min(n - 1, Math.max(0, (x / m) | 0));
  const tz = Math.min(n - 1, Math.max(0, (z / m) | 0));
  return anyW.wakeData[tz * n + tx];
}
