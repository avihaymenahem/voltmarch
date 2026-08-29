/**
 * ============================================================================
 * A CAMEO IS THE SAME PICTURE ON BOTH RENDERERS, OR IT IS A DIFFERENT BUG.
 * ============================================================================
 * Reported under `?gpu=webgpu`: *"The 3D models in side menu not showing"*.
 * Every build slot fell back to a flat glyph, so a player could not tell what
 * they were building.
 *
 * The cause was one line. `CameoRenderer` originally read its render target
 * back with `renderer.readRenderTargetPixels`, which is synchronous and exists
 * only on `WebGLRenderer`; the node `Renderer` publishes only the async form.
 * Modern THREE also exposes an asynchronous WebGL read. The shipping path uses
 * that now so a portrait cannot wait on the world's queued GPU work while the
 * player is clicking through the sidebar.
 *
 * ── WHY THIS FILE IS MOSTLY ARITHMETIC ──────────────────────────────────────
 * Because the two ways a fix like this ships looking fine and being wrong are
 * both arithmetic, and both are silent:
 *
 *   ROW ORDER. `gl.readPixels` starts at the framebuffer's BOTTOM-left;
 *   WebGPU's `copyTextureToBuffer` takes a texel origin and a WebGPU texture's
 *   origin is its TOP-left. Keeping the existing flip on the node path renders
 *   every cameo upside down — and a three-quarter-view tank, sunk into a
 *   graded backdrop, upside down at 74 px, is exactly the kind of wrong that
 *   survives a glance. Stage B found a Y-flip of this class in the grade pass
 *   only by probing for it deliberately.
 *
 *   ROW STRIDE. `WebGPUTextureUtils.copyTextureToBuffer` rounds `bytesPerRow`
 *   up to 256 bytes because `GPUCommandEncoder.copyTextureToBuffer` requires
 *   it. Nothing in the cameo grid is 64 px wide, so EVERY node-path readback
 *   is padded, and a blit that assumes tight rows walks diagonally through the
 *   image. WebGL's rows are tight.
 *
 * Neither of those needs a GPU to test. They need an asymmetric picture and a
 * buffer in the layout the backend actually produces, which is what §1 and §2
 * build. §3 drives the whole `CameoRenderer` against a fake node renderer whose
 * readback resolves when the test says so, which is the only way to observe the
 * lifetime rules (unbind, rebind, invalidate, dispose, reject) at all.
 *
 * **WHAT THIS FILE CANNOT ESTABLISH** is that a real WebGPU device produces the
 * layout §1 asserts. That is `tools/cameo-readback-probe.mjs`, which renders an
 * asymmetric target through a real `WebGPURenderer` and reports the corner it
 * finds at buffer offset 0. Its result is recorded in `docs/RENDER_FINDINGS.md`
 * §7h. Do not quote this suite as hardware evidence.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  READBACK_ROW_ALIGNMENT,
  blitReadback,
  liveBackendOf,
  readbackRowOrder,
  readbackStride,
} from '../src/render/backend';
import { BuildTab, Faction } from '../src/core/types';
import { HUD_CAMEO } from '../src/core/config';

/* ==========================================================================
 * 1. THE LAYOUT — derived from the buffer, never from the request
 * ========================================================================== */

describe('readbackRowOrder', () => {
  it('flips WebGL and does not flip WebGPU', () => {
    // The whole defect in two lines. `gl.readPixels(0, 0, ...)` is the bottom
    // row of the framebuffer; `copyTextureToBuffer` with origin.y = 0 is the
    // top row of the texture.
    expect(readbackRowOrder('webgl')).toBe('bottom-up');
    expect(readbackRowOrder('webgpu')).toBe('top-down');
  });

  it('treats the WebGL2 fallback as WebGL, because it IS gl.readPixels', () => {
    // `WebGLBackend.copyTextureToBuffer` in three's webgl-fallback backend is a
    // framebuffer bind and a `gl.readPixels`. Collapsing this into 'webgpu'
    // because the renderer class says WebGPURenderer would flip it wrongly.
    expect(readbackRowOrder('webgl2-fallback')).toBe('bottom-up');
  });

  it('is driven by what liveBackendOf READS off the renderer', () => {
    // The three shapes `backend.ts` probes, end to end, so the cameo renderer's
    // constructor is not making its own guess about which one it holds.
    const gl = { isWebGLRenderer: true };
    const gpu = { isWebGPURenderer: true, backend: { isWebGPUBackend: true } };
    const fell = { isWebGPURenderer: true, backend: { isWebGLBackend: true } };
    expect(readbackRowOrder(liveBackendOf(gl))).toBe('bottom-up');
    expect(readbackRowOrder(liveBackendOf(gpu))).toBe('top-down');
    expect(readbackRowOrder(liveBackendOf(fell))).toBe('bottom-up');
  });
});

describe('readbackStride', () => {
  it('reads a tight WebGL buffer as tight', () => {
    expect(readbackStride(202, 130, 202 * 130 * 4)).toBe(808);
  });

  it("reads three 0.185's padded WebGPU buffer as 256-aligned", () => {
    // `_bufferDescriptor.size = ((height - 1) * bytesPerRow) + (width * bytesPerTexel)`
    // — the last row is NOT padded, per mrdoob/three.js#31658. A reader that
    // expects `height * bytesPerRow` sees a short buffer and must not guess.
    const stride = Math.ceil((202 * 4) / READBACK_ROW_ALIGNMENT) * READBACK_ROW_ALIGNMENT;
    expect(stride).toBe(1024);
    expect(readbackStride(202, 130, 129 * 1024 + 808)).toBe(1024);
  });

  it('also reads the plainer fully-padded layout, in case three goes back to it', () => {
    expect(readbackStride(202, 130, 130 * 1024)).toBe(1024);
  });

  it('is unambiguous when the row happens to be 256-aligned already', () => {
    // 64 px is exactly 256 bytes, so tight and aligned coincide and both
    // formulas give the same answer. No cameo is this size; the case exists so
    // the ordering of the three checks cannot matter.
    expect(readbackStride(64, 40, 64 * 40 * 4)).toBe(256);
    expect(readbackStride(64, 40, 39 * 256 + 256)).toBe(256);
  });

  it('handles a single row, where every formula collapses to one', () => {
    expect(readbackStride(202, 1, 808)).toBe(808);
  });

  it('REFUSES a length that matches no layout it knows', () => {
    // The point of deriving rather than assuming. If three changes its packing
    // rule, this throws at the blit and the cameo keeps its glyph — instead of
    // shearing twenty portraits in a way that reads as a rendering bug.
    expect(() => readbackStride(202, 130, 12345)).toThrow(/matches no known layout/);
    expect(() => readbackStride(202, 130, 202 * 130 * 4 - 4)).toThrow(/matches no known layout/);
  });

  it('refuses a degenerate size rather than returning 0', () => {
    expect(() => readbackStride(0, 10, 0)).toThrow(/refusing/);
    expect(() => readbackStride(10, 0, 0)).toThrow(/refusing/);
  });
});

/* ==========================================================================
 * 2. THE BLIT — proved with an asymmetric picture
 *
 * `looksRight()` on a real cameo is not a test: a tank at 74 px is roughly
 * symmetric about both axes and a flip is invisible. These images are not.
 * ========================================================================== */

const W = 3;
const H = 2;

/**
 * A picture with a different colour in every cell, so BOTH axes are pinned.
 *
 * A vertical gradient would catch a Y flip and miss an X mirror; four distinct
 * corners catch either. Written top-down, which is what `ImageData` wants.
 */
const TOP_DOWN: ReadonlyArray<readonly number[]> = [
  [10, 11, 12, 255, 20, 21, 22, 255, 30, 31, 32, 255],
  [40, 41, 42, 255, 50, 51, 52, 255, 60, 61, 62, 255],
];

/** The same picture as `gl.readPixels` hands it over: last row first. */
function bottomUpTight(): Uint8Array {
  return new Uint8Array([...TOP_DOWN[1], ...TOP_DOWN[0]]);
}

/** The same picture as `copyTextureToBuffer` hands it over: first row first. */
function topDownTight(): Uint8Array {
  return new Uint8Array([...TOP_DOWN[0], ...TOP_DOWN[1]]);
}

/**
 * Top-down with a padded row stride, and the padding filled with a value that
 * is in NO row of the picture — so a blit that reads through the padding
 * produces 0xEE and is caught, rather than producing a plausible colour.
 */
function topDownPadded(stride: number): Uint8Array {
  const buf = new Uint8Array(stride * H).fill(0xee);
  buf.set(TOP_DOWN[0], 0);
  buf.set(TOP_DOWN[1], stride);
  return buf;
}

function expected(): number[] {
  return [...TOP_DOWN[0], ...TOP_DOWN[1]];
}

describe('blitReadback', () => {
  it('flips a bottom-up tight buffer upright', () => {
    const dst = new Uint8Array(W * H * 4);
    blitReadback(bottomUpTight(), dst, W, H, W * 4, 'bottom-up');
    expect([...dst]).toEqual(expected());
  });

  it('leaves a top-down tight buffer alone', () => {
    const dst = new Uint8Array(W * H * 4);
    blitReadback(topDownTight(), dst, W, H, W * 4, 'top-down');
    expect([...dst]).toEqual(expected());
  });

  it('THE MUTATION THAT WOULD SHIP: flipping a top-down buffer inverts it', () => {
    // This is the failure the whole file exists to make loud. It is asserted
    // rather than merely avoided, so that "we did not flip" is a claim with a
    // test behind it and not a comment.
    const dst = new Uint8Array(W * H * 4);
    blitReadback(topDownTight(), dst, W, H, W * 4, 'bottom-up');
    expect([...dst]).toEqual([...TOP_DOWN[1], ...TOP_DOWN[0]]);
    expect([...dst]).not.toEqual(expected());
  });

  it('steps over the 256-byte row padding instead of through it', () => {
    const stride = Math.ceil((W * 4) / READBACK_ROW_ALIGNMENT) * READBACK_ROW_ALIGNMENT;
    const dst = new Uint8Array(W * H * 4);
    blitReadback(topDownPadded(stride), dst, W, H, stride, 'top-down');
    expect([...dst]).toEqual(expected());
    // Nothing from the padding leaked in. 0xEE appears nowhere in the picture.
    expect([...dst]).not.toContain(0xee);
  });

  it('THE OTHER MUTATION THAT WOULD SHIP: a tight stride over a padded buffer', () => {
    const stride = Math.ceil((W * 4) / READBACK_ROW_ALIGNMENT) * READBACK_ROW_ALIGNMENT;
    const dst = new Uint8Array(W * H * 4);
    blitReadback(topDownPadded(stride), dst, W, H, W * 4, 'top-down');
    // Row 1 comes out of the FIRST row's padding — the diagonal walk.
    expect([...dst.subarray(W * 4)]).toEqual(new Array(W * 4).fill(0xee));
  });

  it('writes into a Uint8ClampedArray, which is what ImageData.data is', () => {
    const dst = new Uint8ClampedArray(W * H * 4);
    blitReadback(bottomUpTight(), dst, W, H, W * 4, 'bottom-up');
    expect([...dst]).toEqual(expected());
  });

  it('refuses a destination that cannot hold the picture', () => {
    expect(() => blitReadback(bottomUpTight(), new Uint8Array(4), W, H, W * 4, 'bottom-up'))
      .toThrow(/destination holds/);
  });

  it('IS THE LOOP IT REPLACED, byte for byte, on the WebGL path', () => {
    /*
     * The hard constraint on this change: the shipping WebGL path must produce
     * identical bytes. Rather than read the two and agree they look the same,
     * run the expression that shipped — copied verbatim out of the pre-change
     * `CameoRenderer.render` — over a realistic supersampled cameo of random
     * pixels, and require equality.
     */
    const rtW = 74 * HUD_CAMEO.supersample;
    const rtH = 58 * HUD_CAMEO.supersample;
    const src = new Uint8Array(rtW * rtH * 4);
    for (let i = 0; i < src.length; i++) src[i] = (i * 37 + (i >> 8) * 11) & 0xff;

    // --- the code that shipped ------------------------------------------
    const was = new Uint8ClampedArray(rtW * rtH * 4);
    const stride = rtW * 4;
    for (let y = 0; y < rtH; y++) {
      const s = (rtH - 1 - y) * stride;
      was.set(src.subarray(s, s + stride), y * stride);
    }
    // --- the code that ships now ----------------------------------------
    const now = new Uint8ClampedArray(rtW * rtH * 4);
    blitReadback(src, now, rtW, rtH, readbackStride(rtW, rtH, src.byteLength), 'bottom-up');

    expect(now).toEqual(was);
  });
});

/* ==========================================================================
 * 3. THE RENDERER — a fake node backend, and every way a read goes stale
 *
 * `CameoRenderer` is the only consumer of any of the above, and the parts that
 * cannot be tested arithmetically are all about TIME: a readback resolves after
 * the frame that asked for it, and by then the cell may have been rebound, the
 * theatre swapped, the renderer disposed, or the device lost.
 *
 * Everything below is a fake for the reason `tests/gpu-device-loss.spec.ts`
 * gives: the signal is a promise, and a stub produces a promise exactly. There
 * is no GPU in this process and none is needed.
 * ========================================================================== */

/* -- the DOM, reduced to what a cameo touches ----------------------------- */

interface FakeImageData { data: Uint8ClampedArray; width: number; height: number }

/**
 * A 2D context that records the drawing calls and, crucially, KEEPS the last
 * `ImageData` it was given. `putImageData` is where the blitted pixels land, so
 * holding it is how a test asserts what was painted rather than merely that
 * something was.
 */
class FakeCtx {
  readonly ops: string[] = [];
  lastPut: FakeImageData | null = null;
  drawImages = 0;

  fillStyle: string | object = '#000';
  strokeStyle: string | object = '#000';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  filter = 'none';
  shadowBlur = 0;
  shadowColor = '';

  private grad(): { addColorStop(o: number, c: string): void } {
    return { addColorStop: () => { /* colours are not what this file measures */ } };
  }
  createLinearGradient(): { addColorStop(o: number, c: string): void } { return this.grad(); }
  createRadialGradient(): { addColorStop(o: number, c: string): void } { return this.grad(); }
  createConicGradient(): { addColorStop(o: number, c: string): void } { return this.grad(); }
  createPattern(): null { return null; }

  createImageData(w: number, h: number): FakeImageData {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(img: FakeImageData): void {
    this.ops.push('putImageData');
    this.lastPut = img;
  }
  drawImage(): void { this.ops.push('drawImage'); this.drawImages++; }

  fillRect(): void { this.ops.push('fillRect'); }
  strokeRect(): void { this.ops.push('strokeRect'); }
  clearRect(): void { this.ops.push('clearRect'); }
  beginPath(): void { this.ops.push('beginPath'); }
  closePath(): void { this.ops.push('closePath'); }
  moveTo(): void { this.ops.push('moveTo'); }
  lineTo(): void { this.ops.push('lineTo'); }
  quadraticCurveTo(): void { this.ops.push('quadraticCurveTo'); }
  bezierCurveTo(): void { this.ops.push('bezierCurveTo'); }
  arc(): void { this.ops.push('arc'); }
  arcTo(): void { this.ops.push('arcTo'); }
  ellipse(): void { this.ops.push('ellipse'); }
  rect(): void { this.ops.push('rect'); }
  roundRect(): void { this.ops.push('roundRect'); }
  fill(): void { this.ops.push('fill'); }
  stroke(): void { this.ops.push('stroke'); }
  clip(): void { this.ops.push('clip'); }
  save(): void { this.ops.push('save'); }
  restore(): void { this.ops.push('restore'); }
  translate(): void { this.ops.push('translate'); }
  rotate(): void { this.ops.push('rotate'); }
  scale(): void { this.ops.push('scale'); }
  setTransform(): void { this.ops.push('setTransform'); }
  fillText(): void { this.ops.push('fillText'); }
  strokeText(): void { this.ops.push('strokeText'); }
  measureText(): { width: number } { return { width: 10 }; }
  setLineDash(): void { this.ops.push('setLineDash'); }
}

class FakeCanvas {
  width = 0;
  height = 0;
  private readonly ctx = new FakeCtx();
  getContext(kind: string): FakeCtx | null {
    return kind === '2d' ? this.ctx : null;
  }
  get fake(): FakeCtx { return this.ctx; }
}

/* -- the node renderer, reduced to what a cameo drives -------------------- */

interface PendingRead {
  resolve(view: ArrayBufferView): void;
  reject(err: unknown): void;
  width: number;
  height: number;
  buffer?: ArrayBufferView;
}

/**
 * A `NodeRendererLike` whose readback is a promise this test settles by hand.
 *
 * `isWebGPURenderer` + `backend.isWebGPUBackend` are what `liveBackendOf`
 * actually probes, so a fake that omits them would be silently classified as
 * WebGL and take its different async signature — which would make every
 * assertion below pass while testing nothing. That is the shape of Stage F's
 * AO defect and it is worth naming here.
 */
class FakeNodeRenderer {
  readonly isWebGPURenderer = true as const;
  readonly backend = { isWebGPUBackend: true };
  toneMappingExposure = 1;
  renders = 0;
  clears = 0;
  /** The scissor and target state, so a test can prove they were restored. */
  scissorTest = true;
  target: THREE.RenderTarget | null = null;
  readonly reads: PendingRead[] = [];
  /** Set to throw synchronously out of the readback, the dead-device door. */
  throwOnRead: Error | null = null;

  getScissorTest(): boolean { return this.scissorTest; }
  setScissorTest(v: boolean): void { this.scissorTest = v; }
  getRenderTarget(): THREE.RenderTarget | null { return this.target; }
  setRenderTarget(t: THREE.RenderTarget | null): void { this.target = t; }
  clear(): void { this.clears++; }
  render(): void { this.renders++; }
  readRenderTargetPixelsAsync(
    _rt: THREE.RenderTarget, _x: number, _y: number, width: number, height: number,
  ): Promise<ArrayBufferView> {
    if (this.throwOnRead !== null) throw this.throwOnRead;
    return new Promise<ArrayBufferView>((resolve, reject) => {
      this.reads.push({ resolve, reject, width, height });
    });
  }

  /** Settle the oldest outstanding read with a padded, top-down picture. */
  deliver(index = 0): { stride: number; first: number[] } {
    const read = this.reads.splice(index, 1)[0];
    const { width, height } = read;
    const stride = Math.ceil((width * 4) / READBACK_ROW_ALIGNMENT) * READBACK_ROW_ALIGNMENT;
    const buf = new Uint8Array((height - 1) * stride + width * 4).fill(0xee);
    // Row 0 is the TOP row and gets a value nothing else uses, so the blit's
    // orientation is readable off `lastPut.data` alone.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = y * stride + x * 4;
        buf[o] = y & 0xff;
        buf[o + 1] = x & 0xff;
        buf[o + 2] = 7;
        buf[o + 3] = 255;
      }
    }
    read.resolve(buf);
    return { stride, first: [0, 0, 7, 255] };
  }
}

/** WebGL's async read takes a caller-owned tight buffer. */
class FakeWebGlRenderer {
  readonly isWebGLRenderer = true as const;
  toneMappingExposure = 1;
  renders = 0;
  scissorTest = true;
  target: THREE.WebGLRenderTarget | null = null;
  readonly reads: PendingRead[] = [];
  readonly seenBuffers: ArrayBufferView[] = [];
  syncReads = 0;

  getScissorTest(): boolean { return this.scissorTest; }
  setScissorTest(v: boolean): void { this.scissorTest = v; }
  getRenderTarget(): THREE.WebGLRenderTarget | null { return this.target; }
  setRenderTarget(t: THREE.WebGLRenderTarget | null): void { this.target = t; }
  clear(): void { /* counted nowhere; the test is about the read */ }
  render(): void { this.renders++; }
  readRenderTargetPixels(): void { this.syncReads++; }
  readRenderTargetPixelsAsync(
    _rt: THREE.WebGLRenderTarget,
    _x: number,
    _y: number,
    width: number,
    height: number,
    buffer: ArrayBufferView,
  ): Promise<ArrayBufferView> {
    this.seenBuffers.push(buffer);
    return new Promise<ArrayBufferView>((resolve, reject) => {
      this.reads.push({ resolve, reject, width, height, buffer });
    });
  }

  deliver(): void {
    const read = this.reads.shift();
    if (read === undefined || read.buffer === undefined) throw new Error('no WebGL read pending');
    read.resolve(read.buffer);
  }
}

/* -- harness -------------------------------------------------------------- */

/** Flush microtasks so a settled readback has actually run its `.then`. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let canvases: FakeCanvas[] = [];

beforeEach(() => {
  canvases = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      const c = new FakeCanvas();
      canvases.push(c);
      return c;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Imported lazily so the `document` stub is installed first — `Cameos.ts`
 * touches the DOM inside constructors, never at import, and this keeps that
 * true by construction.
 */
async function makeRenderer(renderer: FakeNodeRenderer | FakeWebGlRenderer): Promise<{
  cameos: InstanceType<typeof import('../src/ui/Cameos').CameoRenderer>;
  cell: FakeCanvas;
  /** The renderer's private blit canvas — where `putImageData` actually lands. */
  scratch: FakeCanvas;
}> {
  const { CameoRenderer } = await import('../src/ui/Cameos');
  const cameos = new CameoRenderer(renderer as unknown as THREE.WebGLRenderer);
  // The constructor makes three canvases — backdrop, contact-shadow blob, then
  // the scratch blitter — and the scratch is the last of them. The pixels go
  // there and reach the CELL through `drawImage`, so a test that reads the
  // cell's own context sees a draw count and no bytes.
  const scratch = canvases[canvases.length - 1];
  // A model that is definitely not null, so `render` reaches the readback.
  const model = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  cameos.setModelProvider(() => model);
  const cell = new FakeCanvas();
  cell.width = 74;
  cell.height = 58;
  return { cameos, cell, scratch };
}

function subjectFor(key: string): {
  key: string; name: string; faction: Faction; tab: BuildTab;
  isBuilding: boolean; footprintW: number; footprintH: number;
} {
  return {
    key, name: key, faction: Faction.Allies, tab: BuildTab.Vehicles,
    isBuilding: false, footprintW: 0, footprintH: 0,
  };
}

describe('CameoRenderer on the node path', () => {
  it('renders, defers the blit, and paints the model when the pixels land', async () => {
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));

    cameos.frame(0, 1 / 60);
    // The draw happened; the blit did not, because there are no pixels yet.
    expect(node.renders).toBe(1);
    expect(node.reads.length).toBe(1);
    expect(cell.fake.drawImages).toBe(0);
    expect(cameos.asyncReads).toBe(0);

    node.deliver();
    await settle();

    expect(cameos.asyncReads).toBe(1);
    expect(cameos.readFailures).toBe(0);
    expect(cell.fake.drawImages).toBe(1);
  });

  it('DOES NOT FLIP: the top row of the buffer is the top row of the picture', async () => {
    /*
     * THE ASSERTION THE WHOLE CHANGE TURNS ON. The fake writes the row index
     * into the red channel, so `data[0]` is the row that landed at the top of
     * the ImageData. WebGPU hands its rows back top-down, so that must be 0;
     * keeping the WebGL flip would put the LAST row (height - 1) there.
     */
    const node = new FakeNodeRenderer();
    const { cameos, cell, scratch } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    const height = node.reads[0].height;
    const width = node.reads[0].width;
    expect(height).toBe(58 * HUD_CAMEO.supersample);
    node.deliver();
    await settle();

    const put = scratch.fake.lastPut;
    expect(put).not.toBeNull();
    expect(put!.width).toBe(width);
    expect(put!.height).toBe(height);
    // Top-left texel: row 0, column 0.
    expect([...put!.data.subarray(0, 4)]).toEqual([0, 0, 7, 255]);
    // Bottom-left texel: the last row, column 0. A flip swaps these two.
    const last = (height - 1) * width * 4;
    expect([...put!.data.subarray(last, last + 4)]).toEqual([(height - 1) & 0xff, 0, 7, 255]);
    expect(put!.data[0]).not.toBe((height - 1) & 0xff);
  });

  it('steps over the padding: no 0xEE reaches the picture', async () => {
    const node = new FakeNodeRenderer();
    const { cameos, cell, scratch } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);
    // 74 * 2 = 148 px -> 592 bytes -> padded to 768. Nothing in the cameo grid
    // is a multiple of 64 px wide, so this is the ordinary case, not an edge.
    const { stride } = node.deliver();
    expect(stride).toBe(768);
    await settle();
    expect([...scratch.fake.lastPut!.data]).not.toContain(0xee);
  });

  it('shows the 2D glyph while the first read is in flight, and only then', async () => {
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));

    cameos.frame(0, 1 / 60);
    // The cell is not blank: the fallback painter ran, which is a pile of path
    // ops and no drawImage.
    expect(cell.fake.ops).toContain('fill');
    expect(cell.fake.drawImages).toBe(0);

    node.deliver();
    await settle();
    expect(cell.fake.drawImages).toBe(1);

    // A REPAINT OF AN ALREADY-RESOLVED CAMEO MUST NOT RE-PAINT THE GLYPH. A
    // hovered cameo re-renders at HUD_CAMEO.hoverHz; painting the glyph each
    // time would be a visible flicker between glyph and model.
    const before = cell.fake.ops.length;
    cameos.setHovered(cell as unknown as HTMLCanvasElement, true);
    cameos.frame(1, 1 / 60);
    const during = cell.fake.ops.slice(before);
    expect(during).not.toContain('fill');
    expect(node.reads.length).toBe(1);
  });

  it('restores the exposure, the scissor test and the render target', async () => {
    const node = new FakeNodeRenderer();
    node.toneMappingExposure = 0.8;
    node.scissorTest = true;
    const outer = new THREE.WebGLRenderTarget(4, 4);
    node.target = outer;

    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    // All three back where they were, on the same call — a missing
    // setScissorTest restore corrupts the MAIN frame, not just the cameo.
    expect(node.toneMappingExposure).toBeCloseTo(0.8, 12);
    expect(node.scissorTest).toBe(true);
    expect(node.target).toBe(outer);
    outer.dispose();
  });

  /* -- lifetime --------------------------------------------------------- */

  it('drops a read that lands after the cell was unbound', async () => {
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    cameos.unbind(cell as unknown as HTMLCanvasElement);
    node.deliver();
    await settle();

    expect(cell.fake.drawImages).toBe(0);
    expect(cameos.asyncReads).toBe(0);
  });

  it('drops a read that lands after the cell was rebound to another subject', async () => {
    /*
     * NOT COVERED BY AN IDENTITY CHECK. `bind()` REUSES the job object when the
     * canvas is already bound, so `jobs.get(canvas) === job` stays true across a
     * subject change and a fix written on object identity would paint a
     * Warden's pixels into a Sledge's slot. That is what `Job.epoch` is
     * for, and this is the test that fails without it.
     */
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('apocalypse'));
    node.deliver();
    await settle();

    expect(cell.fake.drawImages).toBe(0);
    expect(cameos.asyncReads).toBe(0);
  });

  it('drops a read that lands after invalidateAll', async () => {
    // The DPR change / theatre swap / provider swap case. The destination
    // canvas may have been resized under the read, and the picture is stale.
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    cameos.invalidateAll();
    node.deliver();
    await settle();

    expect(cell.fake.drawImages).toBe(0);
    expect(cameos.asyncReads).toBe(0);
  });

  it('drops a read that lands after dispose, and does not throw into the void', async () => {
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    cameos.dispose();
    node.deliver();
    await settle();

    expect(cell.fake.drawImages).toBe(0);
    expect(cameos.asyncReads).toBe(0);
  });

  it('survives a REJECTED read — a lost device — and keeps the glyph', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    node.reads.shift()!.reject(new Error('Device was destroyed.'));
    await settle();

    expect(cameos.readFailures).toBe(1);
    expect(cameos.asyncReads).toBe(0);
    expect(cell.fake.drawImages).toBe(0);
    expect(cameos.lastReadError).toContain('destroyed');
    // Logged ONCE per distinct message: a lost device rejects every read at
    // once and a per-read log would fill the console.
    node.reads.length = 0;
    cameos.frame(1, 1 / 60);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('survives a readback that THROWS synchronously', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
    const node = new FakeNodeRenderer();
    node.throwOnRead = new Error('device lost');
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));

    expect(() => cameos.frame(0, 1 / 60)).not.toThrow();
    expect(cameos.readFailures).toBe(1);
    expect(cell.fake.drawImages).toBe(0);
  });

  it('refuses a readback of the wrong element type instead of blitting it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
    const node = new FakeNodeRenderer();
    const { cameos, cell } = await makeRenderer(node);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));
    cameos.frame(0, 1 / 60);

    // A float render target would resolve a Float32Array, whose bytes mean
    // something entirely different. Refuse rather than paint noise.
    node.reads.shift()!.resolve(new Float32Array(16));
    await settle();

    expect(cameos.readFailures).toBe(1);
    expect(cell.fake.drawImages).toBe(0);
  });

  it('caps the reads it leaves in flight, and loses no cameo doing it', async () => {
    // A device that has stopped retiring work must not accumulate renders
    // nobody will see. The job stays dirty and is retried.
    const node = new FakeNodeRenderer();
    const { cameos } = await makeRenderer(node);
    const cells: FakeCanvas[] = [];
    for (let i = 0; i < 12; i++) {
      const c = new FakeCanvas();
      c.width = 74;
      c.height = 58;
      cells.push(c);
      cameos.bind(c as unknown as HTMLCanvasElement, subjectFor(`unit${i}`));
    }
    for (let f = 0; f < 20; f++) cameos.frame(f, 1 / 60);
    expect(node.reads.length).toBeLessThanOrEqual(8);

    // Retire them all and drain: every cell resolves, nothing was dropped.
    for (let f = 0; f < 40 && (node.reads.length > 0 || f < 20); f++) {
      while (node.reads.length > 0) node.deliver();
      await settle();
      cameos.frame(100 + f, 1 / 60);
    }
    while (node.reads.length > 0) node.deliver();
    await settle();
    for (const c of cells) expect(c.fake.drawImages).toBeGreaterThan(0);
  });
});

describe('CameoRenderer on the WebGL path', () => {
  it('defers readback instead of blocking the frame on gl.readPixels', async () => {
    const webgl = new FakeWebGlRenderer();
    const { cameos, cell } = await makeRenderer(webgl);
    cameos.bind(cell as unknown as HTMLCanvasElement, subjectFor('grizzly'));

    cameos.frame(0, 1 / 60);

    expect(webgl.renders).toBe(1);
    expect(webgl.syncReads).toBe(0);
    expect(webgl.reads).toHaveLength(1);
    expect(cell.fake.drawImages).toBe(0);

    webgl.deliver();
    await settle();

    expect(cameos.asyncReads).toBe(1);
    expect(cell.fake.drawImages).toBe(1);

    // Repainting the same-size target reuses its retired PBO destination. A
    // hovered portrait otherwise creates several megabytes of garbage a
    // second and trades the removed GPU stall for periodic GC stalls.
    cameos.invalidateAll();
    cameos.frame(1, 1 / 60);
    expect(webgl.seenBuffers).toHaveLength(2);
    expect(webgl.seenBuffers[1]).toBe(webgl.seenBuffers[0]);
  });
});
