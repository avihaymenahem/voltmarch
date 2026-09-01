/**
 * THE RENDERER SEAM — which backend was asked for, which one is actually live,
 * and how to read `renderer.info` without believing a lie.
 *
 * This module exists because of one measured fact (`docs/RENDER_FINDINGS.md`
 * §7c): `THREE.WebGPURenderer` installs a `getFallback` that hands back a
 * `WebGLBackend`, and the ONLY signal that it fired is a `console.warn`. A page
 * that asked for WebGPU and silently got WebGL2 renders fine, reports fine, and
 * captures fine. Stage A of the migration spent its first hour measuring
 * WebGL2-against-WebGL2 with one column labelled "webgpu".
 *
 * That is the same shape as the defect CLAUDE.md records for the shot harness —
 * a GPU-process crash dropping Chromium to SwiftShader, changing 76.5% of
 * pixels while the harness printed `ok`. The lesson there was that the backend
 * must be READ and compared, never inferred, and that a mismatch must fail the
 * run rather than annotate it. Same lesson, new renderer.
 *
 * Nothing here imports three. It is structural on purpose: `RendererInfoLike`
 * describes both renderers' statistics objects, so this file typechecks and
 * tests without a GL context, and `tests/render-backend.spec.ts` can drive every
 * branch against hand-built fakes.
 */

/** The two renderers the product could run. `webgpu` is the product default. */
export type GpuBackend = 'webgl' | 'webgpu';

/**
 * What is ACTUALLY live. Three values, not two, and the third is the whole
 * point: `webgl2-fallback` is `WebGPURenderer` running its WebGL2 backend, which
 * is a DIFFERENT renderer from both of the others — node materials over WebGL2 —
 * and measured the slowest of the three (§7b). Collapsing it into `webgl` would
 * hide exactly the case this module was written for.
 */
export type LiveBackend = GpuBackend | 'webgl2-fallback';

/** Temporary rollback flag. The normal product path is WebGPU without a query. */
export const GPU_QUERY_PARAM = 'gpu';

/**
 * Reads the requested backend off a query string.
 *
 * WebGPU is the product default. `?gpu=webgl` remains as a temporary explicit
 * rollback; absent and unrecognised values stay on the product renderer.
 */
export function requestedBackend(search: string): GpuBackend {
  // Tolerate a bare query string with or without its leading '?'.
  const q = search.startsWith('?') ? search.slice(1) : search;
  const value = new URLSearchParams(q).get(GPU_QUERY_PARAM);
  return value !== null && value.toLowerCase() === 'webgl' ? 'webgl' : 'webgpu';
}

/**
 * The minimum of a renderer this module needs to name its backend.
 *
 * `WebGLRenderer` carries `isWebGLRenderer`; `WebGPURenderer` carries
 * `isWebGPURenderer` plus a `backend` whose two subclasses each set exactly one
 * of `isWebGPUBackend` / `isWebGLBackend`.
 */
export interface BackendBearing {
  readonly isWebGPURenderer?: boolean;
  readonly backend?: {
    readonly isWebGPUBackend?: boolean;
    readonly isWebGLBackend?: boolean;
  };
}

/** True when `o[key]` is exactly `true`, for an object of unknown shape. */
function flag(o: unknown, key: string): boolean {
  return (
    typeof o === 'object' &&
    o !== null &&
    (o as Record<string, unknown>)[key] === true
  );
}

/**
 * READS the live backend. Never infers it from what was requested, from
 * `navigator.gpu`, or from the fact that construction succeeded — all three were
 * true and all three were wrong in the case that motivated this file.
 *
 * THE PARAMETER IS `unknown` ON PURPOSE. The two renderer families share no base
 * type: `WebGLRenderer` and `WebGPURenderer` come from different entry points
 * (`three` and `three/webgpu`) and `@types/three` does not even declare the
 * runtime's own `isWebGLRenderer` marker, so there is no declared type that both
 * satisfy. Probing structurally is what the code genuinely does; typing the
 * parameter as an all-optional interface instead would make it a WEAK TYPE and
 * TypeScript would reject a real `WebGLRenderer` outright (TS2559).
 * `BackendBearing` is kept as documentation of the shape being probed.
 */
export function liveBackendOf(renderer: unknown): LiveBackend {
  if (!flag(renderer, 'isWebGPURenderer')) return 'webgl';
  const backend = (renderer as { backend?: unknown }).backend;
  if (flag(backend, 'isWebGPUBackend')) return 'webgpu';
  // A WebGPURenderer that is not on the WebGPU backend took its fallback. Say
  // so specifically; it is not the same thing as the shipping WebGL renderer.
  return 'webgl2-fallback';
}

/** Thrown when the live backend is not the one that was asked for. */
export class BackendMismatchError extends Error {
  constructor(
    readonly requested: GpuBackend,
    readonly live: LiveBackend,
    detail: string,
  ) {
    super(
      `renderer backend mismatch: asked for '${requested}', got '${live}'. ${detail}`,
    );
    this.name = 'BackendMismatchError';
  }
}

/**
 * The tripwire. Throws unless the live backend is the requested one.
 *
 * IT REFUSES RATHER THAN DEGRADES, and that is the deliberate half. Falling back
 * is what `WebGPURenderer` already does, and the fallback is precisely the
 * failure mode: every downstream number — `shots/_report.json`, the perf HUD,
 * any benchmark — would go on being produced, correctly formatted, about a
 * renderer nobody selected. `validateCommand`'s client half in
 * `src/net/protocol.ts` makes the same choice for the same reason: dropping the
 * bad thing quietly is worse than stopping, because the quiet version has no
 * findable cause.
 *
 * `webgl2-fallback` gets its own message because it has a known cause worth
 * naming at the point of failure — see `docs/RENDER_FINDINGS.md` §7c.
 */
export function assertBackend(requested: GpuBackend, live: LiveBackend): void {
  if (requested === live) return;
  const detail =
    live === 'webgl2-fallback'
      ? "WebGPURenderer took its WebGL2 fallback — requestDevice() failed. In headless " +
        "Playwright Chromium this is Dawn failing to load dxil.dll; launch real Chrome " +
        "(channel: 'chrome'). See docs/RENDER_FINDINGS.md §7c."
      : 'Refusing to report frames under a renderer that was not selected.';
  throw new BackendMismatchError(requested, live, detail);
}

/* ==========================================================================
 * THE ADAPTER — which GPU the device actually came from
 * ========================================================================== */

/**
 * What a WebGPU adapter reports about itself.
 *
 * **THIS EXISTS BECAUSE `powerPreference` IS A HINT AND NOTHING MORE.** Stage A
 * asked for `'high-performance'` (`gpu-path-install.ts`) and its probe still
 * observed an INTEGRATED `amd` / `gcn-5` adapter, on a box that also holds an
 * RTX 3080 — on Windows hybrid-graphics setups the preference is routed through
 * the driver's own application profile and the browser does not overrule it. So
 * a WebGPU measurement, or a WebGPU crash report, can be about a GPU nobody
 * chose, and nothing in the product could say which one it was.
 *
 * Four strings, all possibly empty: `GPUAdapterInfo` is deliberately vague for
 * fingerprinting reasons and several configurations report almost nothing. An
 * adapter that reports four empty strings is a different fact from no adapter at
 * all, which is why `normaliseAdapterInfo` distinguishes them.
 */
export interface AdapterIdentity {
  /** `'amd'`, `'nvidia'`, `'intel'`, `'apple'`, `'qualcomm'`, … */
  readonly vendor: string;
  /** `'gcn-5'`, `'ampere'`, `'gen-12lp'`, … — the microarchitecture family. */
  readonly architecture: string;
  /** Usually empty. A vendor-specific device id when reported. */
  readonly device: string;
  /** Free text; where a real model name shows up when one shows up at all. */
  readonly description: string;
}

/**
 * Reads an adapter identity off whatever the runtime handed us.
 *
 * SAME CONTRACT AS `normaliseInfo`, AND FOR THE SAME REASON: the shape moves
 * between browsers and between three versions, and reading it raw at the call
 * site is how a field silently becomes `undefined` and gets printed as the word
 * "undefined" into the one report somebody was relying on.
 *
 * `GPUAdapterInfo` is a live interface object rather than a plain record, so its
 * fields sit on the PROTOTYPE: `Object.keys()` returns `[]` and `{ ...info }`
 * copies nothing. Property access is the only read that works, so property
 * access is the only read this does — a spread here would produce `null` on
 * every real adapter and look like "the browser reported nothing".
 *
 * The source may be `adapter.info` or `device.adapterInfo`; both carry the same
 * four fields. Returns `null` only when the object is absent or carries none of
 * them.
 */
export function normaliseAdapterInfo(info: unknown): AdapterIdentity | null {
  if (typeof info !== 'object' || info === null) return null;
  const o = info as Record<string, unknown>;
  const read = (key: string): string => {
    const v = o[key];
    return typeof v === 'string' ? v : '';
  };
  const id: AdapterIdentity = {
    vendor: read('vendor'),
    architecture: read('architecture'),
    device: read('device'),
    description: read('description'),
  };
  const any =
    id.vendor !== '' || id.architecture !== '' || id.device !== '' || id.description !== '';
  return any ? id : null;
}

/**
 * One line naming the adapter, for a boot log or a bug report.
 *
 * `null` when there is nothing to say — never the string "unknown", so the
 * caller picks its own fallback instead of inheriting one from here.
 */
export function describeAdapter(id: AdapterIdentity | null): string | null {
  if (id === null) return null;
  // `description` is the only field that ever carries a marketing name, so it
  // leads when present; vendor/architecture are the two usually set.
  const family = [id.vendor, id.architecture].filter((s) => s !== '').join(' ');
  const parts = [id.description, family].filter((s) => s !== '');
  if (parts.length === 0) return id.device !== '' ? `device ${id.device}` : null;
  return parts.length === 2 && parts[0] !== parts[1] ? `${parts[0]} (${parts[1]})` : parts[0];
}

/**
 * Both renderers' `info` objects, structurally.
 *
 * EVERY FIELD IS OPTIONAL BECAUSE THE TWO SHAPES OVERLAP WITHOUT MATCHING, and
 * the overlap is where the danger is: `render.calls` exists on both and means
 * DIFFERENT THINGS. See `normaliseInfo`.
 */
export interface RendererInfoLike {
  readonly render?: {
    readonly calls?: number;
    readonly drawCalls?: number;
    readonly frameCalls?: number;
    readonly triangles?: number;
    readonly points?: number;
    readonly lines?: number;
  };
  readonly memory?: {
    readonly geometries?: number;
    readonly textures?: number;
    readonly programs?: number;
  };
  /**
   * WebGL only — an ARRAY of programs, and `null` before the first compile.
   * Absent entirely under WebGPU, where the count is `memory.programs`.
   */
  readonly programs?: ReadonlyArray<unknown> | null;
}

/** The per-frame numbers, meaning the same thing whichever renderer produced them. */
export interface NormalisedFrameInfo {
  /** Draw calls submitted THIS FRAME, across every pass. */
  readonly drawCalls: number;
  readonly triangles: number;
  readonly points: number;
  readonly lines: number;
  /** Shader programs / pipelines currently in flight. */
  readonly programs: number;
  readonly geometries: number;
  readonly textures: number;
}

/* ==========================================================================
 * THE READBACK — one picture, two byte layouts
 *
 * `src/ui/Cameos.ts` renders each portrait into a render target and copies the
 * pixels back to a 2D canvas. That copy is the ONE place in the product where
 * the two renderers hand back the same image in genuinely different bytes, and
 * both differences are silent: the wrong one produces a picture, just not the
 * right picture.
 *
 *   ROW ORDER. `gl.readPixels(0, 0, …)` starts at the BOTTOM-LEFT of the
 *   framebuffer, so a WebGL readback arrives bottom-up and has to be flipped.
 *   WebGPU's `copyTextureToBuffer` takes a texel origin, and a WebGPU texture's
 *   origin is its TOP-LEFT — three's `WebGPUTextureUtils.copyTextureToBuffer`
 *   passes our `y` straight through as `origin.y` — so that readback arrives
 *   top-down and flipping it turns every cameo upside down.
 *
 *   ROW STRIDE. `WebGPUTextureUtils.copyTextureToBuffer` rounds `bytesPerRow`
 *   up to 256 bytes, because `GPUCommandEncoder.copyTextureToBuffer` requires
 *   it. A 202 px cameo therefore comes back with 808 bytes of pixels and 216
 *   bytes of padding in every row, and a `set(subarray(y * w * 4, …))` blit
 *   walks diagonally through the image. WebGL's rows are tight.
 *
 * Neither fact is inferred from the requested backend. `readbackStride` DERIVES
 * the stride from the buffer it was actually given and refuses a length that
 * matches no layout it knows — so a three upgrade that changes the padding rule
 * fails loudly at the blit instead of skewing twenty portraits.
 * ========================================================================== */

/**
 * Which end of the image a readback's FIRST row came from.
 *
 * `bottom-up` is `gl.readPixels`; `top-down` is `copyTextureToBuffer`. Named
 * rather than a boolean because `flip: true` reads as a property of the blitter
 * and this is a property of the source.
 */
export type ReadbackRowOrder = 'bottom-up' | 'top-down';

/**
 * WebGPU's mandatory `bytesPerRow` alignment for a texture-to-buffer copy.
 * Fixed by the WebGPU specification, not by three.
 */
export const READBACK_ROW_ALIGNMENT = 256;

/**
 * The row order a given live backend's readback produces.
 *
 * `webgl2-fallback` answers `bottom-up` because it IS `gl.readPixels` —
 * `WebGLTextureUtils.copyTextureToBuffer` in three's webgl-fallback backend.
 * It is unreachable in this product (`assertBackend` refuses that renderer at
 * boot) and answered anyway, because a function with a hole in it is worse than
 * one nobody calls.
 */
export function readbackRowOrder(live: LiveBackend): ReadbackRowOrder {
  return live === 'webgpu' ? 'top-down' : 'bottom-up';
}

/**
 * The stride, in bytes, of one row of an RGBA8 readback buffer.
 *
 * DERIVED FROM THE BUFFER, NOT FROM THE BACKEND. Three layouts are recognised:
 *
 *   tight            `width * height * 4`                       (WebGL)
 *   aligned, exact   `(height - 1) * stride + width * 4`        (three 0.185)
 *   aligned, padded  `height * stride`                          (the obvious
 *                                                                one, and what
 *                                                                three did
 *                                                                before #31658)
 *
 * Anything else throws. That is the point: the alternative is to assume a
 * stride, and an assumed stride that is wrong by 216 bytes produces a sheared
 * cameo that still looks like a rendering bug rather than a layout bug.
 */
export function readbackStride(width: number, height: number, byteLength: number): number {
  if (width <= 0 || height <= 0) {
    throw new Error(`[readback] refusing a ${width}x${height} readback`);
  }
  const tight = width * 4;
  if (byteLength === tight * height) return tight;
  const aligned =
    Math.ceil(tight / READBACK_ROW_ALIGNMENT) * READBACK_ROW_ALIGNMENT;
  if (byteLength === (height - 1) * aligned + tight) return aligned;
  if (byteLength === height * aligned) return aligned;
  throw new Error(
    `[readback] ${byteLength} bytes matches no known layout for ${width}x${height} RGBA8 ` +
      `(tight ${tight * height}, aligned ${(height - 1) * aligned + tight}); ` +
      'three changed its copyTextureToBuffer packing.',
  );
}

/**
 * Copies a readback into a TIGHT, TOP-DOWN RGBA8 image — the layout
 * `ImageData` wants.
 *
 * `dst` must hold `width * height * 4` bytes. Rows are copied whole through
 * `TypedArray.set`, which is the same operation the WebGL path has always
 * performed; with `stride === width * 4` and `bottom-up` this function is
 * byte-for-byte the loop it replaced, and `tests/cameo-readback.spec.ts` pins
 * that equivalence rather than assuming it.
 */
export function blitReadback(
  src: Uint8Array,
  dst: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  stride: number,
  rowOrder: ReadbackRowOrder,
): void {
  const rowBytes = width * 4;
  if (dst.length < rowBytes * height) {
    throw new Error(`[readback] destination holds ${dst.length} bytes, needs ${rowBytes * height}`);
  }
  const flip = rowOrder === 'bottom-up';
  for (let y = 0; y < height; y++) {
    const s = (flip ? height - 1 - y : y) * stride;
    dst.set(src.subarray(s, s + rowBytes), y * rowBytes);
  }
}

/**
 * Reads a frame's statistics out of either renderer.
 *
 * THE TRAP THIS FUNCTION EXISTS FOR, in one line: under WebGPU,
 * `info.render.calls` is a MONOTONIC COUNT OF `render()` INVOCATIONS SINCE PAGE
 * LOAD, and `info.reset()` does not clear it. Under WebGL the same property is
 * the draw count for the current frame. `src/render/post.ts` derives
 * `drawCallsByPass` from differences of it and `MAX_DRAW_CALLS` is compared
 * against the result, so a port that keeps reading `render.calls` gets a
 * draw-call budget checked against a number that only ever goes up. Nothing
 * throws; the build stays green.
 *
 * The per-frame figure under WebGPU is `render.drawCalls`, which does not exist
 * on the WebGL side — so preferring it when present and falling back to `calls`
 * is correct for both and wrong for neither.
 *
 * `programs` has the quieter version of the same defect: `info.programs` is an
 * array on WebGL and `undefined` on WebGPU, where the count lives at
 * `memory.programs`. `info.programs?.length ?? 0` — which is what
 * `src/render/debug.ts` reads today — therefore reports 0 forever under WebGPU
 * rather than failing.
 */
export function normaliseInfo(info: RendererInfoLike | null | undefined): NormalisedFrameInfo {
  const r = info?.render;
  const m = info?.memory;
  return {
    // `drawCalls` first: WebGPU's per-frame counter. `calls` is WebGL's.
    drawCalls: r?.drawCalls ?? r?.calls ?? 0,
    triangles: r?.triangles ?? 0,
    points: r?.points ?? 0,
    lines: r?.lines ?? 0,
    // Array on WebGL, a number under `memory` on WebGPU.
    programs: info?.programs?.length ?? m?.programs ?? 0,
    geometries: m?.geometries ?? 0,
    textures: m?.textures ?? 0,
  };
}
