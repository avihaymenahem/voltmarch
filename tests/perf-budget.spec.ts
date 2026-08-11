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
 * MSAA is the same defect wearing different clothes and is guarded the same way.
 * `PostConfig.msaaSamples` was handed to `new EffectComposer(renderer, rt)`,
 * which CLONES that target for its ping-pong pair — so a setting written to
 * antialias the geometry silently multisampled every full-screen quad in the
 * chain and made each of them resolve. Five resolves where one was wanted; it
 * cost a reporter 7-8 fps of ~22 and was reverted. Nothing about that was
 * visible in the config, which read `msaaSamples: 4` either way. The sample
 * clamp is a pure function now, and the structural claim — one multisampled
 * target, reachable from one place — is read out of `post.ts` as text.
 *
 * NODE ENVIRONMENT. Nothing here may touch WebGL, `document` or `window`. That
 * is also why the pass wiring is checked by reading `post.ts` as text, exactly
 * as `tests/compositing.spec.ts` does: importing it would pull in three's
 * postprocessing passes, several of which allocate at module scope.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AO_HALF_RES_SCALE, aoDenoiseRadius, aoTargetSize, msaaSampleCount } from '../src/render/post';
import { RENDER_CONFIG } from '../src/render/renderer';
import { defaultSettings } from '../src/shell/settings-store';
import { VFX_LIGHT_POOL_BY_TIER, VFX_LIGHT_POOL } from '../src/core/config';

const ROOT = join(__dirname, '..');
const POST_SRC = readFileSync(join(ROOT, 'src/render/post.ts'), 'utf8');
const RENDERER_SRC = readFileSync(join(ROOT, 'src/render/renderer.ts'), 'utf8');

/**
 * Prose must not be able to satisfy or break an assertion about code. Same
 * helper, same reasoning, as `tests/compositing.spec.ts` — and it matters more
 * here than anywhere, because the MSAA sections of both files are mostly
 * comment and every string these tests look for appears in them.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const POST_CODE = stripComments(POST_SRC);

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

/* -------------------------------------------------------------------------- */
/* MSAA — the scene pass only, resolved once                                  */
/* -------------------------------------------------------------------------- */

describe('MSAA sample count', () => {
  it('clamps to what the driver reports', () => {
    // WebGL2 guarantees MAX_SAMPLES >= 4. Asking for 8 where the driver caps at
    // 4 is, on some drivers, an incomplete framebuffer rather than a clamp —
    // i.e. a black frame, which is the one failure this whole file guards.
    expect(msaaSampleCount(8, 4)).toBe(4);
    expect(msaaSampleCount(16, 8)).toBe(8);
  });

  it('passes a supported request through untouched', () => {
    expect(msaaSampleCount(4, 4)).toBe(4);
    expect(msaaSampleCount(4, 8)).toBe(4);
    expect(msaaSampleCount(2, 8)).toBe(2);
  });

  it('treats anything below 2 samples as off, not as 1', () => {
    // A one-sample "multisampled" target costs a second full-size allocation, a
    // resolve blit and a transfer copy, and returns the image a plain target
    // already produced. 0 is the encoding the caller branches on.
    for (const n of [1, 0, -1, -4]) expect(msaaSampleCount(n, 8)).toBe(0);
  });

  it('is off when the driver reports no multisampling at all', () => {
    for (const cap of [0, 1, -1]) expect(msaaSampleCount(4, cap)).toBe(0);
  });

  it('never returns a fraction — samples is an integer count', () => {
    expect(msaaSampleCount(4.9, 8)).toBe(4);
    expect(msaaSampleCount(8, 4.5)).toBe(4);
  });

  it('survives a driver that answers with a non-number', () => {
    // `gl.getParameter` returns null on a lost context, and NaN propagating
    // into a render-target descriptor is exactly how this project has produced
    // a black frame before.
    expect(msaaSampleCount(4, Number.NaN)).toBe(0);
    expect(msaaSampleCount(Number.NaN, 4)).toBe(0);
    expect(msaaSampleCount(4, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('MSAA multisamples the scene pass and nothing else', () => {
  it('never hands EffectComposer a multisampled target', () => {
    // THE BUG THIS FILE EXISTS TO PREVENT A SECOND TIME. `EffectComposer` does
    // `this.renderTarget2 = renderTarget.clone()`, and `WebGLRenderTarget.copy`
    // copies `samples` — so a sample count here multisamples BOTH halves of the
    // ping-pong pair and every pass in the chain then forces a resolve of its
    // own. Five resolves a frame where the geometry needed one; it cost a
    // reporter 7-8 fps of ~22 and was reverted.
    const start = POST_CODE.indexOf('new THREE.WebGLRenderTarget(');
    const end = POST_CODE.indexOf('new EffectComposer(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const composerTarget = POST_CODE.slice(start, end);
    const declared = [...composerTarget.matchAll(/samples:\s*([\w.]+)/g)].map((m) => m[1]);
    // Declared exactly once, and the value is the literal 0 — not a variable
    // that some later edit could make non-zero without touching this test.
    expect(declared).toEqual(['0']);
  });

  it('constructs exactly two render targets, exactly one of them multisampled', () => {
    expect(POST_CODE.match(/new THREE\.WebGLRenderTarget\(/g)).toHaveLength(2);
    expect(POST_CODE.match(/samples: want,/g)).toHaveLength(1);
  });

  it('lets no post pass reach the multisampled target', () => {
    // Every downstream pass takes its destination from the composer's pair, and
    // both halves of that pair are `samples: 0`. The one target with samples on
    // it is reachable through the scene-pass wrapper and nowhere else, which is
    // the whole of the "exactly one resolve" claim in post.ts's header.
    expect(POST_CODE.match(/const target = sceneMsaa;/g)).toHaveLength(1);
    expect(POST_CODE.match(/base\(r, writeBuffer, target, deltaTime, maskActive\)/g))
      .toHaveLength(1);
    expect(POST_CODE).not.toMatch(/setRenderTarget\([^)]*sceneMsaa/);
  });

  it('transfers into the composer read buffer, or to the screen when alone', () => {
    // The degenerate chain — every pass but `render` disabled — must keep its
    // antialiasing rather than quietly falling back to an aliased direct draw.
    expect(POST_CODE).toMatch(
      /r\.setRenderTarget\(toScreen \? null : readBuffer\);\s*\n\s*quad\.render\(r\);/
    );
  });

  it('is inert with one null check when MSAA is off', () => {
    // Off is the default and every quality tier, so this branch is the one
    // essentially every player runs.
    expect(POST_CODE).toMatch(/if \(target === null \|\| quad === null \|\| mat === null\)/);
  });

  it('resizes the multisampled target with the drawing buffer', () => {
    // `composer.setSize` only knows about its own pair and its passes. Miss
    // this and the transfer quad stretches a boot-sized image over the frame.
    expect(POST_CODE).toContain('sceneMsaa?.setSize(pw, ph)');
  });

  it('frees it on dispose and on being switched off', () => {
    expect(POST_CODE.match(/disposeMsaa\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(POST_CODE).toContain('function disposeMsaa()');
  });

  it('warms up a frame after a toggle, so no half-built chain is presented', () => {
    const start = POST_CODE.indexOf('function applyMsaaConfig()');
    const end = POST_CODE.indexOf('function seedAoDenoiseNoise');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(POST_CODE.slice(start, end)).toContain('chainDirty = true;');
  });
});

describe('MSAA stays opt-in', () => {
  it('defaults to off', () => {
    expect(RENDER_CONFIG.post.msaaSamples).toBe(0);
    expect(defaultSettings().graphics.msaa).toBe(false);
  });

  it('is set by no quality tier', () => {
    // Tier is picked from a rough capability guess, and the cost here is
    // dominated by memory bandwidth, which that guess does not model at all: a
    // discrete card at `high` and an iGPU at `high` are not the same machine
    // for this one setting.
    const src = stripComments(RENDERER_SRC);
    const start = src.indexOf('const RENDER_QUALITY_PRESETS');
    const end = src.indexOf('export function applyQualityTier');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain('msaaSamples');
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
