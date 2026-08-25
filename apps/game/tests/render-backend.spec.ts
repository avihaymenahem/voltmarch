/**
 * The renderer seam: which backend was asked for, which is live, and how a
 * frame's statistics are read out of either renderer.
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS. Every case here is a defect that was
 * observed, not imagined — Stage A of the WebGPU migration ran a benchmark for
 * an hour with a column labelled "webgpu" that was measuring WebGL2, because
 * `THREE.WebGPURenderer` falls back behind a single `console.warn`. The
 * `renderer.info` cases are the same class: `render.calls` and `programs` both
 * exist on both renderers, both mean different things, and neither mismatch
 * throws. See `docs/RENDER_FINDINGS.md` §7b and §7c.
 *
 * The fakes are hand-built rather than mocked out of three, so this file needs
 * no GL context and runs in the ordinary node pool.
 */

import { describe, expect, it } from 'vitest';

import {
  BackendMismatchError,
  assertBackend,
  liveBackendOf,
  normaliseInfo,
  requestedBackend,
  type BackendBearing,
  type RendererInfoLike,
} from '../src/render/backend';

describe('requestedBackend', () => {
  it('defaults to webgl when the flag is absent', () => {
    expect(requestedBackend('')).toBe('webgl');
    expect(requestedBackend('?')).toBe('webgl');
    expect(requestedBackend('?shot=01-establishing-base&seed=7')).toBe('webgl');
  });

  it('selects webgpu only for an exact opt-in', () => {
    expect(requestedBackend('?gpu=webgpu')).toBe('webgpu');
    expect(requestedBackend('gpu=webgpu')).toBe('webgpu');
    expect(requestedBackend('?seed=3&gpu=WebGPU&map=coral-shore')).toBe('webgpu');
  });

  it('treats every unrecognised value as webgl', () => {
    // A typo in a debug flag must never decide which renderer a player gets.
    for (const s of ['?gpu=', '?gpu=web-gpu', '?gpu=wgpu', '?gpu=1', '?gpu=true', '?gpu=gl']) {
      expect(requestedBackend(s)).toBe('webgl');
    }
  });

  it('accepts an explicit ?gpu=webgl so a bug report can pin it', () => {
    expect(requestedBackend('?gpu=webgl')).toBe('webgl');
  });
});

describe('liveBackendOf', () => {
  it('names a plain WebGLRenderer webgl', () => {
    expect(liveBackendOf({} as BackendBearing)).toBe('webgl');
  });

  it('names a WebGPURenderer on its WebGPU backend webgpu', () => {
    const r: BackendBearing = { isWebGPURenderer: true, backend: { isWebGPUBackend: true } };
    expect(liveBackendOf(r)).toBe('webgpu');
  });

  it('DISTINGUISHES the WebGL2 fallback from the shipping WebGL renderer', () => {
    /*
     * This is the case the whole module exists for. `WebGPURenderer` whose
     * `requestDevice()` failed is running node materials over WebGL2 — a third
     * renderer, measured the SLOWEST of the three, and not the one that ships.
     * Collapsing it into 'webgl' would make the mismatch undetectable, which is
     * the state Stage A was in.
     */
    const r: BackendBearing = { isWebGPURenderer: true, backend: { isWebGLBackend: true } };
    expect(liveBackendOf(r)).toBe('webgl2-fallback');
  });

  it('calls a WebGPURenderer with an unreadable backend a fallback, never webgpu', () => {
    // Unknown must fail closed: claiming 'webgpu' on no evidence is the lie.
    expect(liveBackendOf({ isWebGPURenderer: true })).toBe('webgl2-fallback');
    expect(liveBackendOf({ isWebGPURenderer: true, backend: {} })).toBe('webgl2-fallback');
  });
});

describe('assertBackend', () => {
  it('passes when the live backend is the requested one', () => {
    expect(() => assertBackend('webgl', 'webgl')).not.toThrow();
    expect(() => assertBackend('webgpu', 'webgpu')).not.toThrow();
  });

  it('throws — never degrades — when WebGPU silently became WebGL2', () => {
    expect(() => assertBackend('webgpu', 'webgl2-fallback')).toThrow(BackendMismatchError);
  });

  it('names dxil.dll and the real-Chrome fix in the fallback message', () => {
    // The cause is known and was expensive to find; the failure should not send
    // the next person back through the same eight flag sets.
    let msg = '';
    try {
      assertBackend('webgpu', 'webgl2-fallback');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('dxil.dll');
    expect(msg).toContain("channel: 'chrome'");
    expect(msg).toContain('RENDER_FINDINGS');
  });

  it('carries the requested and live values on the error for a caller to log', () => {
    try {
      assertBackend('webgl', 'webgpu');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as BackendMismatchError;
      expect(err.requested).toBe('webgl');
      expect(err.live).toBe('webgpu');
    }
  });
});

describe('normaliseInfo', () => {
  /** `renderer.info` as WebGLRenderer builds it. */
  const webglInfo: RendererInfoLike = {
    render: { calls: 63, triangles: 812_004, points: 0, lines: 12 },
    memory: { geometries: 214, textures: 61 },
    programs: new Array(71).fill(null),
  };

  /** `renderer.info` as three/webgpu's Info builds it. */
  const webgpuInfo: RendererInfoLike = {
    // `calls` is CUMULATIVE render() invocations here, not this frame's draws.
    render: { calls: 4181, drawCalls: 63, frameCalls: 2, triangles: 812_004, points: 0, lines: 12 },
    memory: { geometries: 214, textures: 61, programs: 71 },
    // `programs` the array does not exist under WebGPU.
  };

  it('reads a WebGL frame exactly as the raw fields do today', () => {
    const n = normaliseInfo(webglInfo);
    expect(n.drawCalls).toBe(63);
    expect(n.triangles).toBe(812_004);
    expect(n.lines).toBe(12);
    expect(n.programs).toBe(71);
    expect(n.geometries).toBe(214);
    expect(n.textures).toBe(61);
  });

  it('reports the SAME frame identically from the WebGPU shape', () => {
    // The point of the whole function: one meaning, two sources.
    expect(normaliseInfo(webgpuInfo)).toEqual(normaliseInfo(webglInfo));
  });

  it('does NOT mistake WebGPU cumulative render() calls for this frame draws', () => {
    /*
     * `info.render.calls` is 4181 in the fake above and the frame drew 63. A
     * port that kept reading `render.calls` would compare a monotonically
     * climbing number against MAX_DRAW_CALLS (130) and derive
     * `drawCallsByPass` from differences of it, silently, with a green build.
     */
    expect(normaliseInfo(webgpuInfo).drawCalls).toBe(63);
    expect(normaliseInfo(webgpuInfo).drawCalls).not.toBe(4181);
  });

  it('finds the program count under WebGPU, where info.programs is undefined', () => {
    // `info.programs?.length ?? 0` — what src/render/debug.ts reads today —
    // yields 0 here forever rather than failing.
    expect(webgpuInfo.programs).toBeUndefined();
    expect(normaliseInfo(webgpuInfo).programs).toBe(71);
  });

  it('returns zeros rather than throwing on a partial or absent info', () => {
    // A renderer mid-teardown, or a context loss, must not take the HUD with it.
    const zero = { drawCalls: 0, triangles: 0, points: 0, lines: 0, programs: 0, geometries: 0, textures: 0 };
    expect(normaliseInfo(null)).toEqual(zero);
    expect(normaliseInfo(undefined)).toEqual(zero);
    expect(normaliseInfo({})).toEqual(zero);
    expect(normaliseInfo({ render: {} })).toEqual(zero);
  });

  it('keeps a genuine zero draw count instead of falling through to `calls`', () => {
    // 0 is not nullish; a WebGPU frame that drew nothing must read 0, not the
    // lifetime `calls` total sitting beside it.
    const idle: RendererInfoLike = { render: { calls: 900, drawCalls: 0 } };
    expect(normaliseInfo(idle).drawCalls).toBe(0);
  });
});
