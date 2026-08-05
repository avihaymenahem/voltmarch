/**
 * PERFORMANCE BUDGET — the settings that were measured, asserted.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Everything guarded here was, at some point, a documented setting wired to
 * nothing. `AoConfig.halfRes` shipped with the comment "Render AO at half
 * resolution and bilaterally upsample", defaulted to `true`, was mapped in
 * three of the four quality tiers — and the only line in the codebase that
 * mentioned it wrote to `pdMaterial.uniforms.pdRadius`, a uniform GTAOPass has
 * never had. Every player ran full-resolution GTAO. It cost 15.7 ms a frame at
 * 1440p on the machine that reported 17 fps: 24% of the frame, spent on a
 * feature the config said was already off.
 *
 * A number nobody has watched a test produce is a wish. So the arithmetic that
 * turns `halfRes` into a render-target size is a pure exported function, and it
 * is asserted here — no GL context, no browser, no fixture.
 *
 * NODE ENVIRONMENT. Nothing here may touch WebGL, `document` or `window`. That
 * is also why the pass wiring is checked by reading `post.ts` as text, exactly
 * as `tests/compositing.spec.ts` does: importing it would pull in three's
 * postprocessing passes, several of which allocate at module scope.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AO_HALF_RES_SCALE, aoDenoiseRadius, aoTargetSize } from '../src/render/post';
import { RENDER_CONFIG } from '../src/render/renderer';
import { VFX_LIGHT_POOL_BY_TIER, VFX_LIGHT_POOL } from '../src/core/config';

const ROOT = join(__dirname, '..');
const POST_SRC = readFileSync(join(ROOT, 'src/render/post.ts'), 'utf8');

/** The capture resolution the art bible quotes every pixel tolerance at. */
const NATIVE = { width: 2560, height: 1440 };

describe('AO render-target sizing', () => {
  it('halves both axes when halfRes is on', () => {
    const s = aoTargetSize(NATIVE.width, NATIVE.height, true);
    expect(s).toEqual({ width: 1280, height: 720 });
  });

  it('is the identity when halfRes is off', () => {
    const s = aoTargetSize(NATIVE.width, NATIVE.height, false);
    expect(s).toEqual({ width: 2560, height: 1440 });
  });

  it('quarters the pixel count, which is the whole point', () => {
    const full = aoTargetSize(NATIVE.width, NATIVE.height, false);
    const half = aoTargetSize(NATIVE.width, NATIVE.height, true);
    expect((half.width * half.height) / (full.width * full.height)).toBeCloseTo(0.25, 6);
  });

  it('never produces a zero-sized target', () => {
    // A render target of 0 is a GL error, and the adaptive controller can drive
    // the drawing buffer small while the window is being dragged between
    // displays. Two is the floor everywhere else in the renderer.
    for (const [w, h] of [[1, 1], [2, 2], [3, 1], [0, 0]]) {
      const s = aoTargetSize(w, h, true);
      expect(s.width).toBeGreaterThanOrEqual(2);
      expect(s.height).toBeGreaterThanOrEqual(2);
    }
  });

  it('rounds rather than truncates, so an odd buffer stays centred', () => {
    expect(aoTargetSize(1921, 1081, true)).toEqual({ width: 961, height: 541 });
  });

  it('is a half and not a third', () => {
    // Measured: full-res 64.8 ms, half 49.1 ms, third 46.4 ms. The third only
    // buys 2.7 ms more because what is left is the full-resolution composite,
    // and it keeps paying upsample error for it.
    expect(AO_HALF_RES_SCALE).toBe(0.5);
  });
});

describe('AO denoise radius tracks the AO resolution', () => {
  it('halves with the resolution so the blur covers the same image area', () => {
    expect(aoDenoiseRadius(false)).toBe(8);
    expect(aoDenoiseRadius(true)).toBe(4);
    expect(aoDenoiseRadius(true) * 2).toBe(aoDenoiseRadius(false));
  });

  it('is not the old, backwards pair', () => {
    // The dead line it replaces wrote 4 at half resolution and 2 at full: a
    // WIDER kernel where there are FEWER texels.
    expect(aoDenoiseRadius(true)).not.toBe(2);
  });
});

describe('post.ts wiring', () => {
  it('reads halfRes through aoTargetSize rather than ignoring it', () => {
    expect(POST_SRC).toContain('aoTargetSize(');
    expect(POST_SRC).toContain('installAoResolutionScale');
  });

  it('wraps the pass\'s own setSize, because EffectComposer also calls it', () => {
    // Scaling at the call site in `applyPendingSize` alone would be undone by
    // the very next `composer.setSize`, which every resize and every adaptive
    // resolution step triggers.
    expect(POST_SRC).toMatch(/p\.setSize\s*=\s*\(w: number, h: number\)/);
  });

  it('no longer writes to the uniform GTAOPass does not have', () => {
    expect(POST_SRC).not.toMatch(/uniforms\.pdRadius/);
    expect(POST_SRC).toContain('updatePdMaterial');
  });

  it('composites AO in place, declining the composer swap', () => {
    expect(POST_SRC).toContain('GTAOPass.OUTPUT.Off');
    expect(POST_SRC).toMatch(/needsSwap\s*=\s*false/);
  });

  it('still keeps AO ahead of bloom', () => {
    // An occluded crevice must not bloom. The order is the file's contract and
    // no performance change is allowed to quietly reshuffle it.
    const order = POST_SRC.match(/PASS_ORDER[^=]*=\s*\[([^\]]*)\]/);
    expect(order).not.toBeNull();
    const ids = (order as RegExpMatchArray)[1];
    expect(ids.indexOf("'ao'")).toBeGreaterThan(ids.indexOf("'render'"));
    expect(ids.indexOf("'bloom'")).toBeGreaterThan(ids.indexOf("'ao'"));
    expect(ids.indexOf("'smaa'")).toBeGreaterThan(ids.indexOf("'grade'"));
  });
});

describe('quality tiers spend the frame where it was measured', () => {
  it('ships half-resolution AO by default', () => {
    expect(RENDER_CONFIG.post.ao.halfRes).toBe(true);
  });
});

describe('the VFX light pool is sized against a measurement', () => {
  it('honours bible §8.9 (a pool of 8-12) at High and Ultra', () => {
    // High and Ultra are the tiers the scorecard is judged at, and §8.9 is
    // marked NON-NEGOTIABLE. Performance work does not get to move these.
    expect(VFX_LIGHT_POOL_BY_TIER[2]).toBeGreaterThanOrEqual(8);
    expect(VFX_LIGHT_POOL_BY_TIER[2]).toBeLessThanOrEqual(12);
    expect(VFX_LIGHT_POOL_BY_TIER[3]).toBeGreaterThanOrEqual(8);
    expect(VFX_LIGHT_POOL_BY_TIER[3]).toBeLessThanOrEqual(12);
  });

  it('cuts Low and Medium, where a resident light costs 2.57 ms at 1440p', () => {
    expect(VFX_LIGHT_POOL_BY_TIER[0]).toBeLessThanOrEqual(1);
    expect(VFX_LIGHT_POOL_BY_TIER[1]).toBeLessThanOrEqual(2);
  });

  it('always leaves at least one light, so a single blast still washes', () => {
    // Scorecard #28 measures the ground wash around ONE explosion. A pool of
    // zero would fail it at every tier; a small pool only limits how many
    // SIMULTANEOUS washes there can be.
    for (const n of VFX_LIGHT_POOL_BY_TIER) expect(n).toBeGreaterThanOrEqual(1);
  });

  it('never asks for more slots than the SoA arrays were allocated for', () => {
    for (const n of VFX_LIGHT_POOL_BY_TIER) expect(n).toBeLessThanOrEqual(VFX_LIGHT_POOL);
  });

  it('is monotonic across tiers', () => {
    for (let i = 1; i < VFX_LIGHT_POOL_BY_TIER.length; i++) {
      expect(VFX_LIGHT_POOL_BY_TIER[i]).toBeGreaterThanOrEqual(VFX_LIGHT_POOL_BY_TIER[i - 1]);
    }
  });
});
