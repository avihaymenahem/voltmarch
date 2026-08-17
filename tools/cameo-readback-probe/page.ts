/**
 * ============================================================================
 * VOLTMARCH — tools/cameo-readback-probe/page.ts
 * ============================================================================
 * THE PAGE HALF of the cameo readback orientation proof. Driven by
 * `tools/cameo-readback-probe.mjs`; see that file's header for why it exists.
 *
 * It renders an image that is DIFFERENT IN ALL FOUR CORNERS into a render
 * target built exactly as `CameoRenderer.ensureTarget` builds one, reads it
 * back through each renderer's own readback, and runs the SHIPPED blitter
 * (`src/render/backend.ts`) over the result. So the thing under test is the
 * code that ships, not a re-derivation of it.
 *
 * The WebGL arm is the CONTROL and it is not optional: `RENDER_FINDINGS.md` §6c
 * records two investigations wrecked by an instrument that read zero on
 * everything including its own control. If the WebGL arm does not come back
 * bottom-up, tight and sRGB, the WebGPU arm's answer means nothing.
 * ============================================================================
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

import {
  blitReadback,
  liveBackendOf,
  readbackRowOrder,
  readbackStride,
  type ReadbackRowOrder,
} from '../../src/render/backend';

/**
 * The REAL cameo target size: a 74x58 build slot at `HUD_CAMEO.supersample` 2.
 *
 * 148 * 4 = 592 bytes of pixels per row, which is NOT a multiple of 256. That
 * is the ordinary case and the whole reason the stride question exists; a size
 * chosen for roundness would have hidden it.
 */
const W = 148;
const H = 116;

/** Four corners, four colours, so a Y flip and an X mirror are both visible. */
const TOP_LEFT = 0xff2020;
const TOP_RIGHT = 0x20ff20;
const BOTTOM_LEFT = 0x2020ff;
const BOTTOM_RIGHT = 0xffff20;
/** Mid sRGB grey. Read back as ~128 it is sRGB; as ~55 it is linear. */
const CENTRE = 0x808080;

interface Sample { readonly r: number; readonly g: number; readonly b: number }

interface ArmResult {
  readonly arm: string;
  readonly live: string;
  readonly ok: boolean;
  readonly error: string | null;
  /** What the readback handed over, before anything interpreted it. */
  readonly raw: {
    readonly constructor: string;
    readonly byteLength: number;
    readonly tightLength: number;
    readonly alignedLength: number;
    readonly firstTexel: number[];
  } | null;
  /** What `backend.ts` concluded from it. */
  readonly derived: { readonly stride: number; readonly rowOrder: ReadbackRowOrder } | null;
  /** The blitted picture, sampled top-down. */
  readonly samples: Record<string, Sample> | null;
  /** The same picture blitted with the OPPOSITE row order, for contrast. */
  readonly wrongWay: Record<string, Sample> | null;
}

function buildScene(
  corners: readonly [number, number, number, number] = [TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT],
): { scene: THREE.Scene; camera: THREE.OrthographicCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);

  const quad = (x: number, y: number, z: number, size: number, colour: number): void => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      // `toneMapped: false` and a basic material: the picture must be the
      // colour that was asked for, so any difference in the readback is the
      // readback and not a shading model.
      new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }),
    );
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  // In three's world +Y is up, so these names are about the PICTURE.
  quad(-0.5, 0.5, 0, 0.9, corners[0]);
  quad(0.5, 0.5, 0, 0.9, corners[1]);
  quad(-0.5, -0.5, 0, 0.9, corners[2]);
  quad(0.5, -0.5, 0, 0.9, corners[3]);
  quad(0, 0, 1, 0.24, CENTRE);
  return { scene, camera };
}

/** The render target `CameoRenderer.ensureTarget` builds, verbatim. */
function makeTarget(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(W, H, {
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  return rt;
}

/** Read one texel out of a tight, top-down RGBA8 image. */
function texel(img: Uint8Array, x: number, y: number): Sample {
  const o = (y * W + x) * 4;
  return { r: img[o], g: img[o + 1], b: img[o + 2] };
}

const POINTS: ReadonlyArray<readonly [string, number, number]> = [
  ['topLeft', Math.floor(W * 0.25), Math.floor(H * 0.25)],
  ['topRight', Math.floor(W * 0.75), Math.floor(H * 0.25)],
  ['bottomLeft', Math.floor(W * 0.25), Math.floor(H * 0.75)],
  ['bottomRight', Math.floor(W * 0.75), Math.floor(H * 0.75)],
  ['centre', Math.floor(W * 0.5), Math.floor(H * 0.5)],
];

function sampleAll(img: Uint8Array): Record<string, Sample> {
  const out: Record<string, Sample> = {};
  for (const [name, x, y] of POINTS) out[name] = texel(img, x, y);
  return out;
}

/** Interpret one readback with the shipped helpers, then also the wrong way. */
function interpret(arm: string, live: string, buf: Uint8Array, rowOrder: ReadbackRowOrder): ArmResult {
  const tightLength = W * H * 4;
  const stride = Math.ceil((W * 4) / 256) * 256;
  const alignedLength = (H - 1) * stride + W * 4;
  const raw = {
    constructor: buf.constructor.name,
    byteLength: buf.byteLength,
    tightLength,
    alignedLength,
    firstTexel: [buf[0], buf[1], buf[2], buf[3]],
  };
  let derivedStride: number;
  try {
    derivedStride = readbackStride(W, H, buf.byteLength);
  } catch (err) {
    return {
      arm, live, ok: false, error: String(err), raw, derived: null, samples: null, wrongWay: null,
    };
  }
  const img = new Uint8Array(tightLength);
  blitReadback(buf, img, W, H, derivedStride, rowOrder);
  const other = new Uint8Array(tightLength);
  blitReadback(buf, other, W, H, derivedStride, rowOrder === 'bottom-up' ? 'top-down' : 'bottom-up');
  return {
    arm,
    live,
    ok: true,
    error: null,
    raw,
    derived: { stride: derivedStride, rowOrder },
    samples: sampleAll(img),
    wrongWay: sampleAll(other),
  };
}

async function webglArm(): Promise<ArmResult> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  const { scene, camera } = buildScene();
  const rt = makeTarget();
  const buf = new Uint8Array(W * H * 4);
  renderer.setRenderTarget(rt);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.setRenderTarget(null);

  const live = liveBackendOf(renderer);
  return interpret('webgl', live, buf, readbackRowOrder(live));
}

async function webgpuArm(): Promise<ArmResult> {
  const canvas = document.getElementById('gpu') as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  await renderer.init();
  const live = liveBackendOf(renderer);
  if (live !== 'webgpu') {
    // The §7c lie. Reported, never worked around: a WebGL2 fallback measured
    // under a column labelled webgpu is the defect this whole seam exists for.
    return {
      arm: 'webgpu', live, ok: false,
      error: `renderer is live as '${live}' — WebGPU device unavailable`,
      raw: null, derived: null, samples: null, wrongWay: null,
    };
  }
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  const { scene, camera } = buildScene();
  const rt = makeTarget();
  renderer.setRenderTarget(rt);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  const view = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
  renderer.setRenderTarget(null);

  const buf = view instanceof Uint8Array
    ? view
    : new Uint8Array((view as ArrayBufferView).buffer as ArrayBuffer);
  return interpret('webgpu', live, buf, readbackRowOrder(live));
}

/**
 * TWO CAMEOS, ONE RENDER TARGET, TWO OVERLAPPING READS.
 *
 * `HUD_CAMEO.perFrameBudget` is 2 and `CameoRenderer` owns ONE render target,
 * so on the node path a frame routinely renders cameo A, issues its read,
 * renders cameo B over the top and issues a second read — with A's read still
 * outstanding. If those copies were not ordered against the renders, cameo A's
 * slot would show cameo B's picture: the wrong unit in the wrong slot, which is
 * exactly the silently-wrong-picture class this whole probe exists for.
 *
 * The argument from three's source is that both submits are SYNCHRONOUS —
 * `Renderer.render` ends in `backend.finishRender` -> `queue.submit`, and
 * `copyTextureToBuffer` submits its encoder before its first `await` — so the
 * queue sees render A, copy A, render B, copy B and executes them in that order.
 * This measures it instead of believing it.
 */
async function interleaveArm(): Promise<{ ok: boolean; error: string | null; first: Sample | null; second: Sample | null }> {
  // ITS OWN CANVAS. The `#gpu` one already holds a configured WebGPU context
  // from the arm above, and reconfiguring it with a second device is a
  // different experiment from this one. See §7g.
  const canvas = document.getElementById('gpu-interleave') as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  await renderer.init();
  const live = liveBackendOf(renderer);
  if (live !== 'webgpu') {
    return { ok: false, error: `not on a WebGPU device (live: ${live})`, first: null, second: null };
  }
  const rowOrder = readbackRowOrder(live);
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 1);

  // Two pictures whose top-left corners are unmistakably different.
  const a = buildScene([TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT]);
  const b = buildScene([BOTTOM_RIGHT, BOTTOM_LEFT, TOP_RIGHT, TOP_LEFT]);
  const rt = makeTarget();

  renderer.setRenderTarget(rt);
  renderer.clear(true, true, false);
  renderer.render(a.scene, a.camera);
  const readA = renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
  // NOT awaited: this is the interleave. B lands on the same target while A's
  // copy is still in flight.
  renderer.clear(true, true, false);
  renderer.render(b.scene, b.camera);
  const readB = renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
  renderer.setRenderTarget(null);

  const [bufA, bufB] = await Promise.all([readA, readB]);
  const stride = readbackStride(W, H, (bufA as Uint8Array).byteLength);
  const imgA = new Uint8Array(W * H * 4);
  const imgB = new Uint8Array(W * H * 4);
  blitReadback(bufA as Uint8Array, imgA, W, H, stride, rowOrder);
  blitReadback(bufB as Uint8Array, imgB, W, H, stride, rowOrder);
  const x = Math.floor(W * 0.25);
  const y = Math.floor(H * 0.25);
  return { ok: true, error: null, first: texel(imgA, x, y), second: texel(imgB, x, y) };
}

interface ProbeResult {
  readonly width: number;
  readonly height: number;
  readonly expected: Record<string, number>;
  readonly arms: ArmResult[];
  /** The interleave check: A's read must hold A's picture, not B's. */
  readonly interleave: {
    readonly ok: boolean;
    readonly error: string | null;
    readonly first: Sample | null;
    readonly second: Sample | null;
    readonly wantFirst: number;
    readonly wantSecond: number;
  };
}

declare global {
  interface Window { __probe?: ProbeResult; __probeError?: string }
}

async function main(): Promise<void> {
  const arms: ArmResult[] = [];
  for (const run of [webglArm, webgpuArm]) {
    try {
      arms.push(await run());
    } catch (err) {
      arms.push({
        arm: run === webglArm ? 'webgl' : 'webgpu',
        live: 'unknown', ok: false, error: String(err),
        raw: null, derived: null, samples: null, wrongWay: null,
      });
    }
  }
  let interleave: ProbeResult['interleave'];
  try {
    interleave = { ...(await interleaveArm()), wantFirst: TOP_LEFT, wantSecond: BOTTOM_RIGHT };
  } catch (err) {
    interleave = {
      ok: false, error: String(err), first: null, second: null,
      wantFirst: TOP_LEFT, wantSecond: BOTTOM_RIGHT,
    };
  }
  const result: ProbeResult = {
    width: W,
    height: H,
    expected: {
      topLeft: TOP_LEFT,
      topRight: TOP_RIGHT,
      bottomLeft: BOTTOM_LEFT,
      bottomRight: BOTTOM_RIGHT,
      centre: CENTRE,
    },
    arms,
    interleave,
  };
  window.__probe = result;
  const log = document.getElementById('log');
  if (log !== null) log.textContent = JSON.stringify(result, null, 2);
}

main().catch((err: unknown) => {
  window.__probeError = String(err);
  const log = document.getElementById('log');
  if (log !== null) log.textContent = String(err);
});
