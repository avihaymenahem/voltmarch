/**
 * THROWAWAY SPIKE — Stage A of the WebGPU migration §5. NOT SHIPPED CODE.
 *
 * The measurement harness. Exposes `window.__BENCH` for tools/webgpu-spike/run.mjs
 * to drive. Nothing here imports from `src/`, and nothing in `src/` imports this.
 *
 * THREE ARMS, because §4.5 says there are two backends and not one:
 *
 *   webgl     WebGLRenderer + MeshStandardMaterial          — what ships today
 *   webgpu    WebGPURenderer + MeshStandardNodeMaterial      — the migration target
 *   nodegl    WebGPURenderer{forceWebGL:true} + node material — what a browser
 *             without WebGPU would get AFTER the migration, which is a third
 *             renderer nobody has costed and the reason §4.5 says "two grade
 *             baselines".
 *
 * WHAT IS MEASURED, AND WHY EACH ONE:
 *
 *   cpuMs       wall time inside `renderer.render()`. This is the quantity
 *               WebGPU actually changes — command encoding and state binding on
 *               the CPU. It excludes GPU execution, which is the point.
 *   frameMs     rAF timestamp delta. What a player experiences, and vsync-capped,
 *               so a flat 16.67 here means "there is headroom", not "they tie".
 *   uncappedFps renders driven back-to-back off a MessageChannel with no rAF
 *               throttle, for a fixed wall-clock budget. Includes GPU
 *               backpressure once the driver's queue saturates. This is the
 *               throughput number.
 *
 * HONESTY NOTES, since a benchmark that flatters a conclusion is worse than none:
 *  - Warmup is untimed and includes `compileAsync`, so no arm pays first-frame
 *    pipeline compilation inside a measured window.
 *  - Medians and 10th/90th percentiles are reported, never a best case.
 *  - `render()` returning does not mean the GPU finished, on EITHER arm. That is
 *    why `uncappedFps` exists alongside `cpuMs` rather than instead of it.
 */

import { buildScene } from './scene.js';

const RAF_FRAMES = 420;
const WARMUP_FRAMES = 90;
const UNCAPPED_MS = 2000;

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

function summarise(samples) {
  const s = Array.from(samples).sort((a, b) => a - b);
  return {
    p10: +pct(s, 0.1).toFixed(4),
    p50: +pct(s, 0.5).toFixed(4),
    p90: +pct(s, 0.9).toFixed(4),
    mean: +(s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(4),
    n: s.length,
  };
}

/** rAF as a promise, so the phases read as straight-line code. */
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/** A macrotask with no clamp — setTimeout(0) is clamped to 4 ms once nested. */
function tick() {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

/**
 * The per-frame draw counter, which is NOT the same property on the two arms.
 * See the report — this asymmetry is finding #2 and it is silent.
 */
function frameDraws(renderer, isNode) {
  const r = renderer.info.render;
  return isNode ? r.drawCalls : r.calls;
}

/**
 * THIS MACHINE HAS TWO GPUs — an RTX 3080 Laptop and the 5900HX's Radeon iGPU —
 * and `requestAdapter()` with no preference picks the low-power one. Both arms
 * landed on the SAME iGPU, so the default comparison is matched and fair, but
 * "matched" had to be checked rather than assumed: a run where WebGL took the
 * discrete card and WebGPU took the integrated one would be a GPU benchmark
 * wearing a renderer benchmark's label. Every row records the adapter it ran on.
 */
async function makeRenderer(kind, canvas, width, height, powerPreference) {
  if (kind === 'webgl') {
    const THREE = await import('three');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false; // as src/render/renderer.ts does
    return { THREE, renderer, MaterialClass: THREE.MeshStandardMaterial, isNode: false };
  }

  const THREE = await import('three/webgpu');
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference,
    forceWebGL: kind === 'nodegl',
  });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  return { THREE, renderer, MaterialClass: THREE.MeshStandardNodeMaterial, isNode: true };
}

/**
 * WHICH BACKEND IS ACTUALLY LIVE. Read, never inferred — `WebGPURenderer`
 * constructs a `getFallback` that hands back a `WebGLBackend` behind nothing
 * louder than a `warn()`, which is the SwiftShader defect in a new costume.
 */
async function backendIdentity(renderer, isNode) {
  const out = { navigatorGpu: typeof navigator !== 'undefined' && !!navigator.gpu };
  if (!isNode) {
    const gl = renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    out.kind = 'WebGLRenderer';
    out.live = 'webgl2';
    out.adapter = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
    return out;
  }
  const b = renderer.backend;
  out.kind = 'WebGPURenderer';
  out.isWebGPUBackend = b.isWebGPUBackend === true;
  out.isWebGLBackend = b.isWebGLBackend === true;
  out.live = out.isWebGPUBackend ? 'webgpu' : out.isWebGLBackend ? 'webgl2-fallback' : 'unknown';
  if (out.isWebGPUBackend && b.device) {
    const ai = b.device.adapterInfo || {};
    out.adapter = [ai.vendor, ai.architecture, ai.device, ai.description]
      .filter(Boolean)
      .join(' / ') || '(adapterInfo empty)';
    out.features = Array.from(b.device.features || []).slice(0, 40);
  } else if (out.isWebGLBackend) {
    const gl = b.gl;
    const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
    out.adapter = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
  }
  return out;
}

/** A structural snapshot of `renderer.info` — finding #2's raw evidence. */
function infoShape(renderer) {
  const info = renderer.info;
  const shape = (o) =>
    o && typeof o === 'object'
      ? Object.fromEntries(
          Object.keys(o)
            .filter((k) => typeof o[k] === 'number' || typeof o[k] === 'boolean')
            .map((k) => [k, o[k]]),
        )
      : String(typeof o);
  return {
    topLevelKeys: Object.keys(info),
    autoReset: info.autoReset,
    render: shape(info.render),
    memory: shape(info.memory),
    compute: info.compute ? shape(info.compute) : null,
    // The one the game reads as `info.programs?.length ?? 0`.
    programsIsArray: Array.isArray(info.programs),
    programsLength: Array.isArray(info.programs) ? info.programs.length : null,
    memoryPrograms: info.memory && typeof info.memory.programs === 'number' ? info.memory.programs : null,
  };
}

/**
 * Draws attributable to the colour pass vs the shadow pass, measured the only
 * way that does not need to reach inside the renderer: render once with the
 * shadow map off, once with it on, and difference them. Cheap, and it runs
 * outside every timed window.
 */
function characteriseDraws(renderer, scene, camera, isNode) {
  renderer.info.reset();
  renderer.shadowMap.enabled = false;
  renderer.render(scene, camera);
  const colour = frameDraws(renderer, isNode);
  const tris = renderer.info.render.triangles;

  renderer.info.reset();
  renderer.shadowMap.enabled = true;
  renderer.render(scene, camera);
  const total = frameDraws(renderer, isNode);

  return { colour, shadow: Math.max(0, total - colour), total, triangles: tris };
}

async function gpuSync(renderer, isNode) {
  try {
    if (isNode) {
      const dev = renderer.backend && renderer.backend.device;
      if (dev && dev.queue && dev.queue.onSubmittedWorkDone) {
        await dev.queue.onSubmittedWorkDone();
        return 'queue.onSubmittedWorkDone';
      }
      const gl = renderer.backend && renderer.backend.gl;
      if (gl) {
        gl.finish();
        return 'gl.finish';
      }
    } else {
      renderer.getContext().finish();
      return 'gl.finish';
    }
  } catch (e) {
    return 'sync-failed: ' + e.message;
  }
  return 'none';
}

/**
 * THE SEAM ASSERTS ITS BACKEND AND REFUSES TO PROCEED.
 *
 * Silently measuring WebGL2 and labelling the column "webgpu" is the whole
 * failure this spike exists to avoid — and it is what the first run of it did,
 * for an hour, because `WebGPURenderer` constructed fine and rendered fine. A
 * benchmark that cannot tell which renderer produced its numbers is not a
 * benchmark. Nothing downstream of here is allowed to see a mislabelled row.
 */
const EXPECTED_BACKEND = { webgl: 'webgl2', webgpu: 'webgpu', nodegl: 'webgl2-fallback' };

async function runOne(cfg) {
  const { backend, draws, width, height, powerPreference } = cfg;
  const canvas = document.getElementById('c');

  const t0 = performance.now();
  const { THREE, renderer, MaterialClass, isNode } = await makeRenderer(
    backend, canvas, width, height, powerPreference,
  );
  const identity = await backendIdentity(renderer, isNode);

  const want = EXPECTED_BACKEND[backend];
  if (identity.live !== want) {
    throw new Error(
      `BACKEND MISMATCH: arm '${backend}' wanted '${want}' and got '${identity.live}'. ` +
        `navigator.gpu=${identity.navigatorGpu}. Refusing to report a number under a ` +
        `renderer nobody asked for — see the dxil.dll finding in channel-probe.mjs.`,
    );
  }

  const built = buildScene(THREE, MaterialClass, draws);
  const { scene, camera } = built;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const initMs = performance.now() - t0;

  // ---- warmup. Untimed on purpose: pipeline/program creation is a one-off
  // cost and charging it to one arm's median would be dishonest. -----------
  const compileT0 = performance.now();
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  else if (renderer.compile) renderer.compile(scene, camera);
  const compileMs = performance.now() - compileT0;

  for (let i = 0; i < WARMUP_FRAMES; i++) {
    renderer.info.reset();
    renderer.render(scene, camera);
    await nextFrame();
  }
  await gpuSync(renderer, isNode);

  const characterisation = characteriseDraws(renderer, scene, camera, isNode);
  const info = infoShape(renderer);

  // ---- phase 1: rAF-paced. cpuMs + wall clock. ---------------------------
  const cpu = new Float64Array(RAF_FRAMES);
  const dt = new Float64Array(RAF_FRAMES - 1);
  const drawSeen = new Float64Array(RAF_FRAMES);
  let prev = await nextFrame();
  for (let i = 0; i < RAF_FRAMES; i++) {
    renderer.info.reset();
    const a = performance.now();
    renderer.render(scene, camera);
    cpu[i] = performance.now() - a;
    drawSeen[i] = frameDraws(renderer, isNode);
    const now = await nextFrame();
    if (i > 0) dt[i - 1] = now - prev;
    prev = now;
  }

  // ---- phase 2: uncapped throughput. -------------------------------------
  await gpuSync(renderer, isNode);
  let frames = 0;
  const uStart = performance.now();
  let uCpu = 0;
  while (performance.now() - uStart < UNCAPPED_MS) {
    renderer.info.reset();
    const a = performance.now();
    renderer.render(scene, camera);
    uCpu += performance.now() - a;
    frames++;
    await tick();
  }
  const syncMethod = await gpuSync(renderer, isNode);
  const uElapsed = performance.now() - uStart;

  const cpuS = summarise(cpu);
  const dtS = summarise(dt);
  const drawsMedian = summarise(drawSeen).p50;

  renderer.dispose();

  return {
    cfg,
    ok: true,
    identity,
    initMs: +initMs.toFixed(1),
    compileMs: +compileMs.toFixed(1),
    scene: built.spec,
    draws: characterisation,
    drawsDuringMeasure: drawsMedian,
    info,
    cpuMs: cpuS,
    frameMs: dtS,
    rafFps: dtS.p50 > 0 ? +(1000 / dtS.p50).toFixed(1) : null,
    uncapped: {
      frames,
      elapsedMs: +uElapsed.toFixed(1),
      fps: +((frames / uElapsed) * 1000).toFixed(1),
      cpuSharePct: +((uCpu / uElapsed) * 100).toFixed(1),
      syncMethod,
    },
  };
}

window.__BENCH = {
  async run(cfg) {
    try {
      return await runOne(cfg);
    } catch (e) {
      return { cfg, ok: false, error: String(e && e.stack ? e.stack : e) };
    }
  },
};
window.__BENCH_READY = true;
