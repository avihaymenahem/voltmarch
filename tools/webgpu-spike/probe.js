/**
 * THROWAWAY SPIKE — Stage A of the WebGPU migration §5. NOT SHIPPED CODE.
 *
 * The three questions §4 says are the real risks, answered by experiment rather
 * than by reading release notes:
 *
 *   1. Does `WebGPURenderer` get a REAL WebGPU backend in the headless Chromium
 *      `tools/shoot.mjs` uses, or does it silently take its WebGL2 fallback?
 *      `WebGPURenderer`'s constructor installs `getFallback` and the only signal
 *      is a `warn()`, so "it initialised" is not evidence of anything.
 *
 *   2. What does `renderer.info` look like? `src/render/post.ts` derives
 *      `drawCallsByPass` from `renderer.info.render.calls` deltas and
 *      `src/render/debug.ts` reads `info.programs?.length`.
 *
 *   3. Is the `onBeforeCompile` / GLSL `#include` blocker real? §3 asserts it
 *      and costs the migration on it. One experiment settles it — and the
 *      version that matters is the SILENT one: an existing
 *      `MeshStandardMaterial` carrying `onBeforeCompile`, handed to
 *      `WebGPURenderer`, which converts it to a node material behind your back.
 */

import * as THREE from 'three/webgpu';
import { wgslFn, positionLocal, uniform, vec4, mix } from 'three/tsl';

const out = { steps: [] };
const note = (name, value) => out.steps.push({ name, value });

async function main() {
  const canvas = document.getElementById('c');

  // ---------------------------------------------------------------- Q1 ----
  out.navigatorGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  out.warnings = [];
  out.errors = [];
  const realWarn = console.warn;
  const realError = console.error;
  console.warn = (...a) => {
    out.warnings.push(a.map(String).join(' '));
    realWarn(...a);
  };
  /*
   * ERRORS ARE CAPTURED BECAUSE THIS PROBE ALREADY LIED ONCE.
   *
   * The first run reported `wgslFn: { worked: true, functionEmitted: true }`
   * while the console carried `ERROR: 0:225: 'fn' : syntax error` and
   * `useProgram: program not valid` — the WGSL had been emitted verbatim into a
   * GLSL shader that then failed to link. "The text I looked for is in the
   * string" is not "it compiled", and a probe whose success criterion cannot
   * see a failed link is the measured-correct/actually-wrong gap CLAUDE.md
   * writes up for the audio bank.
   */
  console.error = (...a) => {
    out.errors.push(a.map(String).join(' '));
    realError(...a);
  };
  const errorsAt = () => out.errors.length;
  const errorsSince = (n) => out.errors.slice(n);

  let rawAdapter = null;
  if (out.navigatorGpu) {
    try {
      const ad = await navigator.gpu.requestAdapter();
      rawAdapter = ad
        ? {
            info: ad.info
              ? {
                  vendor: ad.info.vendor,
                  architecture: ad.info.architecture,
                  device: ad.info.device,
                  description: ad.info.description,
                }
              : null,
            features: Array.from(ad.features || []).slice(0, 40),
            isFallbackAdapter: ad.isFallbackAdapter === true,
          }
        : null;
    } catch (e) {
      rawAdapter = { error: String(e) };
    }
  }
  out.rawAdapter = rawAdapter;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(640, 360, false);
  renderer.shadowMap.enabled = true;

  const b = renderer.backend;
  out.backend = {
    isWebGPUBackend: b.isWebGPUBackend === true,
    isWebGLBackend: b.isWebGLBackend === true,
    constructor: b.constructor && b.constructor.name,
    coordinateSystem: renderer.coordinateSystem,
  };
  out.liveBackend = b.isWebGPUBackend ? 'webgpu' : b.isWebGLBackend ? 'webgl2-fallback' : 'unknown';
  if (b.device) {
    const ai = b.device.adapterInfo || {};
    out.deviceAdapterInfo = {
      vendor: ai.vendor,
      architecture: ai.architecture,
      device: ai.device,
      description: ai.description,
    };
  }

  // A minimal scene so there is something to compile and render.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x4a4438, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 2);
  sun.castShadow = true;
  scene.add(sun);
  const geo = new THREE.SphereGeometry(1, 24, 16);

  // ---------------------------------------------------------------- Q3a ---
  // The SILENT case. A plain MeshStandardMaterial — one of the 24 sites in
  // src/ — handed straight to WebGPURenderer.
  let stdCalls = 0;
  let stdCacheKeyCalls = 0;
  const stdMat = new THREE.MeshStandardMaterial({ color: 0x88aa44 });
  stdMat.onBeforeCompile = (shader) => {
    stdCalls++;
    // What every one of our 24 sites does.
    if (shader && typeof shader.fragmentShader === 'string') {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb *= vec3(0.0, 1.0, 0.0);',
      );
    }
  };
  stdMat.customProgramCacheKey = () => {
    stdCacheKeyCalls++;
    return 'vm-spike-std';
  };
  const stdMesh = new THREE.Mesh(geo, stdMat);
  stdMesh.position.x = -1.4;
  stdMesh.castShadow = true;
  scene.add(stdMesh);

  // ---------------------------------------------------------------- Q3b ---
  // The EXPLICIT case: onBeforeCompile assigned to a node material.
  let nodeCalls = 0;
  const nodeMat = new THREE.MeshStandardNodeMaterial({ color: 0x4488aa });
  nodeMat.onBeforeCompile = () => {
    nodeCalls++;
  };
  const nodeMesh = new THREE.Mesh(geo, nodeMat);
  nodeMesh.position.x = 1.4;
  nodeMesh.castShadow = true;
  scene.add(nodeMesh);

  note('onBeforeCompile exists on Material.prototype', 'onBeforeCompile' in THREE.Material.prototype);
  note(
    'NodeMaterial declares its own customProgramCacheKey',
    typeof THREE.NodeMaterial.prototype.customProgramCacheKey === 'function',
  );

  renderer.render(scene, camera);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);

  out.onBeforeCompile = {
    plainStandardMaterialCalls: stdCalls,
    nodeMaterialCalls: nodeCalls,
    customProgramCacheKeyCalls: stdCacheKeyCalls,
    // What the plain material actually became once the renderer got hold of it.
    plainMaterialStillStandard: stdMesh.material === stdMat,
    plainMaterialClass: stdMesh.material.constructor.name,
  };

  // What the node builder ACTUALLY emitted. If `#include <map_fragment>` is not
  // in there, chunk replacement has nothing to replace.
  try {
    const shaders = await renderer.debug.getShaderAsync(scene, camera, stdMesh);
    const frag = shaders.fragmentShader || '';
    out.generatedShader = {
      language: /@fragment|fn main|var<uniform>/.test(frag) ? 'WGSL' : 'GLSL',
      length: frag.length,
      hasIncludeDirective: frag.includes('#include'),
      hasMapFragmentChunk: frag.includes('map_fragment'),
      carriesTheInjection: frag.includes('vec3(0.0, 1.0, 0.0)') || frag.includes('vec3( 0.0, 1.0, 0.0 )'),
      head: frag.slice(0, 420),
    };
  } catch (e) {
    out.generatedShader = { error: String(e) };
  }

  // Chunk library: does ShaderChunk even exist on the WebGPU entry point?
  out.shaderChunk = {
    exportedFromThreeWebgpu: typeof THREE.ShaderChunk !== 'undefined',
    mapFragmentPresent:
      typeof THREE.ShaderChunk !== 'undefined' && typeof THREE.ShaderChunk.map_fragment === 'string',
  };

  // ---------------------------------------------------------------- Q3c ---
  // Is there a SUPPORTED escape hatch? Two candidates, both exercised for real.
  const hatch = {};

  // (a) TSL slot nodes on a standard node material — the documented route.
  try {
    const tinted = new THREE.MeshStandardNodeMaterial({ color: 0xffffff });
    const k = uniform(0.375);
    tinted.colorNode = mix(vec4(1, 0, 0, 1), vec4(0, 0, 1, 1), k);
    tinted.positionNode = positionLocal;
    const m = new THREE.Mesh(geo, tinted);
    m.position.y = 1.8;
    scene.add(m);
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    const s = await renderer.debug.getShaderAsync(scene, camera, m);
    hatch.tslSlotNodes = {
      worked: true,
      slots: Object.keys(THREE.MeshStandardNodeMaterial.prototype)
        .filter((k2) => k2.endsWith('Node'))
        .slice(0, 40),
      fragmentLength: (s.fragmentShader || '').length,
    };
  } catch (e) {
    hatch.tslSlotNodes = { worked: false, error: String(e) };
  }

  // (b) wgslFn — raw WGSL wired in as a node. The nearest thing to writing a
  //     shader chunk by hand, and the only route that lets you keep hand-tuned
  //     shader code rather than re-expressing it as a node graph.
  //
  //     PORTABILITY IS THE WHOLE QUESTION HERE, not whether it compiles once.
  //     §4.5 says a migrated build still has to run on the WebGL2 fallback for
  //     browsers without WebGPU, and a `wgslFn` on that backend is emitted into
  //     a GLSL shader verbatim. Measured, not assumed: `errorsSince` below is
  //     what catches it.
  try {
    const before = errorsAt();
    const raw = wgslFn(`
      fn vmSpikeTint( t:f32 ) -> vec3<f32> {
        return vec3<f32>( t, 1.0 - t, 0.5 );
      }
    `);
    const rawMat = new THREE.MeshStandardNodeMaterial();
    rawMat.colorNode = vec4(raw({ t: 0.25 }), 1.0);
    const m = new THREE.Mesh(geo, rawMat);
    m.position.set(0, -1.8, 0);
    scene.add(m);
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    const s = await renderer.debug.getShaderAsync(scene, camera, m);
    const frag = s.fragmentShader || '';
    const errs = errorsSince(before);
    hatch.wgslFn = {
      threw: false,
      functionEmitted: frag.includes('vmSpikeTint'),
      shaderLanguage: /@fragment|var<uniform>|vec3<f32>\s*\(/.test(frag) ? 'WGSL' : 'GLSL',
      compileErrors: errs.length,
      firstError: errs[0] ? errs[0].slice(0, 300) : null,
      // The only honest success condition: emitted AND nothing complained.
      worked: frag.includes('vmSpikeTint') && errs.length === 0,
    };
  } catch (e) {
    hatch.wgslFn = { threw: true, worked: false, error: String(e) };
  }
  out.escapeHatches = hatch;

  // ---------------------------------------------------------------- Q2 ----
  // renderer.info, before and after a manual reset, plus what a frame does to
  // it. The game sets autoReset = false and resets once in beginFrame().
  const snap = (label) => ({
    label,
    calls: renderer.info.calls,
    render: { ...renderer.info.render },
    memoryPrograms: renderer.info.memory.programs,
    memoryGeometries: renderer.info.memory.geometries,
    memoryTextures: renderer.info.memory.textures,
    programsIsArray: Array.isArray(renderer.info.programs),
    programsProp: renderer.info.programs === undefined ? 'undefined' : typeof renderer.info.programs,
  });

  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.render(scene, camera);
  const a1 = snap('after reset + 1 render');
  renderer.render(scene, camera);
  const a2 = snap('after a 2nd render with NO reset');
  renderer.info.reset();
  const a3 = snap('after reset() with no render');

  out.info = {
    topLevelKeys: Object.keys(renderer.info),
    renderKeys: Object.keys(renderer.info.render),
    memoryKeys: Object.keys(renderer.info.memory),
    snapshots: [a1, a2, a3],
    // The exact expression src/render/debug.ts:669 evaluates.
    debugTsProgramsExpression: renderer.info.programs?.length ?? 0,
  };

  // The WebGL side of the same reads, for a like-for-like column.
  try {
    const gl = new THREE.WebGPURenderer({
      canvas: document.createElement('canvas'),
      forceWebGL: true,
    });
    await gl.init();
    out.nodeOverWebGL = {
      isWebGLBackend: gl.backend.isWebGLBackend === true,
      renderKeys: Object.keys(gl.info.render),
    };
    gl.dispose();
  } catch (e) {
    out.nodeOverWebGL = { error: String(e) };
  }

  console.warn = realWarn;
  console.error = realError;
  renderer.dispose();
  out.ok = true;
}

main()
  .catch((e) => {
    out.ok = false;
    out.error = String(e && e.stack ? e.stack : e);
  })
  .finally(() => {
    window.__PROBE = out;
    window.__PROBE_DONE = true;
  });
