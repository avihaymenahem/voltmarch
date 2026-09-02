import * as THREE from 'three/webgpu';
import { createGltfLoader } from '../../packages/gltf-runtime/src/gltf.ts';
import { createKtx2LoaderPool } from '../../packages/gltf-runtime/src/ktx2.ts';
import { packLoaded, unpackGeometry, packGeometry, buffersOf, bufferBytes, prepareFamily, spec, model } from './geometry.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function deadline(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}
let rpcId = 0;
function connect(endpoint, transferable) {
  const pending = new Map();
  let markReady, rejectReady;
  const ready = new Promise((resolve, reject) => { markReady = resolve; rejectReady = reject; });
  const fail = error => {
    rejectReady(error);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
  };
  endpoint.onerror = event => fail(new Error(event.message || 'Helper error'));
  endpoint.onmessageerror = () => fail(new Error('Helper deserialization failed'));
  endpoint.onmessage = ({ data }) => {
    if (data?.fatal) {
      fail(new Error(data.fatal));
      return;
    }
    if (!data) { fail(new Error('Empty helper message')); return; }
    if (data.ready) { markReady(); return; }
    const p = pending.get(data.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data);
  };
  endpoint.start?.();
  return {
    ready,
    call(op, payload) {
      return new Promise((resolve, reject) => {
        const id = ++rpcId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Helper deadline exceeded')); }, 15_000);
        pending.set(id, { resolve, reject, timer });
        // Electron's native MessagePort endpoint cannot accept transferred ArrayBuffers.
        try {
          if (transferable) endpoint.postMessage({ id, op, payload }, buffersOf(payload));
          else endpoint.postMessage({ id, op, payload });
        } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close() { fail(new Error('Helper closed')); endpoint.terminate?.(); endpoint.close?.(); },
  };
}

async function startHelper(arm) {
  if (arm === 'main') return null;
  let endpoint;
  if (arm === 'worker') endpoint = new Worker(new URL('/worker.js', location.href), { type: 'module' });
  else {
    const port = new Promise(resolve => {
      const listener = event => {
        if (event.source !== window || event.data?.type !== 'poc:port' || event.ports.length !== 1) return;
        window.removeEventListener('message', listener);
        resolve(event.ports[0]);
      };
      window.addEventListener('message', listener);
    });
    await window.poc.startUtility();
    endpoint = await deadline(port, 'Utility port');
  }
  const client = connect(endpoint, arm === 'worker');
  try { await deadline(client.ready, 'Helper startup'); }
  catch (error) { client.close(); throw error; }
  return client;
}

function watchScheduling() {
  const tasks = [];
  const gaps = [];
  const timerGaps = [];
  const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
  observer.observe({ type: 'longtask' });
  let lastFrame;
  let lastTimer = performance.now();
  let raf;
  const tick = t => { if (lastFrame !== undefined) gaps.push({ start: lastFrame, end: t, ms: t - lastFrame }); lastFrame = t; raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  const timer = setInterval(() => { const t = performance.now(); timerGaps.push({ start: lastTimer, end: t, ms: t - lastTimer }); lastTimer = t; }, 4);
  return {
    stop(start, end) {
      clearInterval(timer); cancelAnimationFrame(raf);
      tasks.push(...observer.takeRecords().map(e => ({ start: e.startTime, duration: e.duration })));
      observer.disconnect();
      return {
        frameGaps: gaps.filter(g => g.end > start && g.start < end).map(g => g.ms),
        timerGaps: timerGaps.filter(g => g.end > start && g.start < end).map(g => g.ms),
        longTasks: tasks.filter(t => t.start < end && t.start + t.duration > start),
      };
    },
  };
}

async function fingerprints(geometries) {
  const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
  return Promise.all(geometries.map(async geometry => {
    const data = packGeometry(geometry);
    const attrs = {};
    for (const [name, a] of Object.entries({ ...data.attributes, ...(data.index ? { index: data.index } : {}) })) {
      attrs[name] = { type: a.array.constructor.name, count: a.array.length, itemSize: a.itemSize, normalized: a.normalized, stride: a.stride, offset: a.offset, sha256: hex(await crypto.subtle.digest('SHA-256', a.array)) };
    }
    return { name: data.name, attributes: attrs, groups: data.groups, box: data.box, sphere: data.sphere, drawRange: { start: data.drawRange.start, count: Number.isFinite(data.drawRange.count) ? data.drawRange.count : 'Infinity' }, triangles: (geometry.index?.count ?? geometry.attributes.position.count) / 3, bytes: bufferBytes(data) };
  }));
}

function disposeLoaded(loaded) {
  const textures = new Set();
  const materials = new Set();
  const geometries = new Set();
  for (const { scene } of loaded) scene.traverse(o => {
    if (!o.isMesh) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
}

async function main() {
  const { arm, jobs } = await window.poc.config();
  console.log(`[poc] starting ${arm}`);
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(1); renderer.setSize(1280, 720);
  renderer._getFallback = null;
  await renderer.init();
  console.log('[poc] renderer initialized');
  if (!renderer.backend.isWebGPUBackend) throw new Error('Native WebGPU required; no fallback accepted.');
  const device = renderer.backend.device;
  const gpuErrors = [];
  device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
  device.lost.then(info => { if (info.reason !== 'destroyed') gpuErrors.push(`Device lost: ${info.message}`); });
  const info = device.adapterInfo;
  const adapter = info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080d13);
  scene.add(new THREE.HemisphereLight(0xc8e7ff, 0x333022, 2));
  const sun = new THREE.DirectionalLight(0xffecd2, 3); sun.position.set(8, 12, 6); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1280 / 720, 0.1, 100);
  camera.position.set(11, 9, 15); camera.lookAt(0, 1.4, 0);
  renderer.render(scene, camera);
  await device.queue.onSubmittedWorkDone();
  console.log('[poc] initial GPU fence completed');
  const samples = [];
  let helper = null;
  let baselineFingerprint;
  for (let job = 0; job < jobs; job++) {
    const pool = createKtx2LoaderPool({ workerLimit: 2, transcoderPath: 'app://vm-poc/basis/' });
    const loader = createGltfLoader({ ktx2Loader: pool.acquire(renderer) });
    globalThis.gc?.();
    await pause(100);
    const memoryBefore = await window.poc.memory();
    console.log(`[poc] ${arm} job ${job} preparing`);
    const observer = watchScheduling();
    await frame(); await frame();
    const start = performance.now();
    const startupStart = performance.now();
    if (!helper) helper = await startHelper(arm);
    const helperStartupMs = performance.now() - startupStart;
    const loadStart = performance.now();
    const loaded = await Promise.all([spec.url, ...spec.lods.map(l => l.url), spec.shadowUrl].map(url => loader.loadAsync(url)));
    const loadMs = performance.now() - loadStart;
    const conditioningStart = performance.now();
    let geometries;
    let inputBytes = 0;
    let snapshotMs = 0;
    let roundTripMs = 0;
    let hydrateMs = 0;
    let computeMs = 0;
    let workerUnpackMs = 0;
    let workerTotalMs = 0;
    let auxiliaryMemory = null;
    if (arm === 'main') {
      const t = performance.now();
      geometries = await prepareFamily(loaded, spec, model);
      computeMs = performance.now() - t;
    } else {
      const t = performance.now();
      const payload = packLoaded(loaded);
      snapshotMs = performance.now() - t;
      inputBytes = bufferBytes(payload);
      const dispatched = performance.now();
      const result = await helper.call('prepare', payload);
      roundTripMs = performance.now() - dispatched;
      computeMs = result.computeMs; workerUnpackMs = result.unpackMs; workerTotalMs = result.workerTotalMs;
      auxiliaryMemory = result.memory ?? null;
      const hydrateStart = performance.now();
      geometries = result.packed.map(unpackGeometry);
      hydrateMs = performance.now() - hydrateStart;
    }
    const conditioningMs = performance.now() - conditioningStart;
    const geometryReadyMs = performance.now() - start;
    let sourceMaterial;
    loaded[0].scene.traverse(o => { if (o.isMesh) sourceMaterial = o.material; });
    const mesh = new THREE.Mesh(geometries[0], sourceMaterial);
    scene.add(mesh);
    const renderStart = performance.now();
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    await device.queue.onSubmittedWorkDone();
    const renderMs = performance.now() - renderStart;
    const end = performance.now();
    // Let timer/rAF/LongTask observers actually see the blocked synchronous task.
    await frame(); await pause(80);
    const scheduling = observer.stop(start, end);
    const memoryAfter = await window.poc.memory();
    const fingerprint = await fingerprints(geometries);
    if (baselineFingerprint && JSON.stringify(baselineFingerprint) !== JSON.stringify(fingerprint)) throw new Error('Geometry drift across jobs.');
    baselineFingerprint = fingerprint;
    if (job === 0) {
      const proxyMaterial = new THREE.MeshBasicMaterial({ color: 0x8899aa });
      for (const [index, name] of ['lod0', 'lod1', 'lod2', 'shadow'].entries()) {
        mesh.geometry = geometries[index];
        // The production shadow proxy has no UVs and never uses the visible PBR material.
        mesh.material = index === 3 ? proxyMaterial : sourceMaterial;
        renderer.render(scene, camera);
        await device.queue.onSubmittedWorkDone();
        await frame();
        await window.poc.screenshot(name);
      }
      proxyMaterial.dispose();
    }
    // Negative controls are deliberately outside all timed spans.
    let echoMs = null;
    let rejectsMalformed = null;
    if (helper) {
      const payload = packLoaded(loaded);
      const expected = bufferBytes(payload);
      const echoStart = performance.now();
      const echo = await helper.call('echo', payload);
      echoMs = performance.now() - echoStart;
      if (bufferBytes(echo.echo) !== expected) throw new Error('Transfer-only control lost buffers');
      try { await helper.call('prepare', []); rejectsMalformed = false; }
      catch (error) {
        if (error.message !== 'Invalid/oversized POC family payload.') throw error;
        rejectsMalformed = true;
      }
      if (!rejectsMalformed) throw new Error('Malformed payload was accepted');
    }
    scene.remove(mesh);
    geometries.forEach(g => g.dispose());
    disposeLoaded(loaded); pool.dispose();
    renderer.render(scene, camera);
    await device.queue.onSubmittedWorkDone();
    globalThis.gc?.();
    await pause(100);
    const memoryDisposed = await window.poc.memory();
    const sample = { job, state: job === 0 ? 'fresh-helper-and-process' : 'reused-helper-fresh-assets', helperStartupMs, loadMs, snapshotMs, computeMs, workerUnpackMs, workerTotalMs, roundTripMs, hydrateMs, conditioningMs, geometryReadyMs, renderMs, firstRenderMs: end - start, inputBytes, outputBytes: fingerprint.reduce((sum, g) => sum + g.bytes, 0), echoMs, rejectsMalformed, scheduling, memoryBefore, memoryAfter, memoryDisposed, auxiliaryMemory, fingerprint };
    samples.push(sample);
    console.log(`[poc] ${arm} job ${job}: ready ${geometryReadyMs.toFixed(1)} ms; conditioning ${conditioningMs.toFixed(1)} ms; first render ${sample.firstRenderMs.toFixed(1)} ms`);
  }
  helper?.close();
  renderer.dispose();
  if (gpuErrors.length) throw new Error(gpuErrors.join('\n'));
  await window.poc.complete({ arm, samples, adapter, backend: 'WebGPU', viewport: [1280, 720], gcAvailable: typeof globalThis.gc === 'function', gpuErrors });
}
main().catch(error => window.poc.complete({ error: error.stack ?? String(error) }));
