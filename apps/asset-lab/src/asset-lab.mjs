import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildAssetCatalog, catalogSummary } from './catalog.mjs';
import { boundedPixelRatio, disableThreeWebGlFallback, installGpuFailureBoundary, withTimeout } from './webgpu-safety.mjs';

const modelUrls = import.meta.glob('../../../packages/assets/game/**/*.glb', {
  query: '?url',
  import: 'default',
});
const catalog = buildAssetCatalog(modelUrls);
const summary = catalogSummary(catalog);
const query = new URLSearchParams(location.search);

const ui = Object.fromEntries([
  'preview', 'backend', 'family-total', 'file-total', 'visible-total', 'search', 'faction-filters',
  'category-filters', 'asset-list', 'status', 'loading', 'asset-faction', 'asset-title', 'badges',
  'variant-select', 'metric-triangles', 'metric-vertices', 'metric-parts', 'metric-materials',
  'metric-textures', 'metric-rig', 'metric-animations', 'metric-bounds', 'metric-bytes', 'metric-frame',
  'source-path', 'reset-camera', 'auto-rotate', 'wireframe', 'previous-asset', 'next-asset',
  'toggle-grid', 'toggle-shadows', 'exposure', 'exposure-value', 'light-angle', 'light-value',
  'infantry-tools', 'open-infantry-lab',
].map((id) => [id, document.getElementById(id)]));

ui['family-total'].textContent = summary.families.toLocaleString();
ui['file-total'].textContent = summary.files.toLocaleString();

let renderer;
let ktx2Loader;
let scene;
let camera;
let controls;
let keyLight;
let displayRoot;
let currentFamily = null;
let currentFile = null;
let currentMetrics = null;
let filteredCatalog = [];
let factionFilter = 'all';
let categoryFilter = 'all';
let autoRotate = false;
let wireframe = false;
let showGrid = true;
let showShadows = true;
let fatalStopped = false;
let raf = 0;
let loadGeneration = 0;
let lastFrame = performance.now();
let smoothedFrameMs = 16.7;

const factionOrder = ['all', 'allies', 'soviets', 'meridian', 'reclamation', 'civilian', 'neutral'];
const factionLabels = {
  all: 'All factions', allies: 'Allied Forces', soviets: 'Soviet Union', meridian: 'Meridian Conclave',
  reclamation: 'Reclamation Pact', civilian: 'Civilian', neutral: 'Neutral',
};

window.addEventListener('error', (event) => reportFatal(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportFatal(event.reason));

try {
  await start();
} catch (error) {
  reportFatal(error);
}

async function start() {
  if (catalog.length === 0) throw new Error('No checked-in GLB assets were discovered.');
  const forceWebGl = query.get('gpu') === 'webgl';
  if (!forceWebGl && !navigator.gpu) {
    throw new Error('WebGPU is unavailable. Asset Lab is WebGPU-first; append ?gpu=webgl only for explicit comparison.');
  }
  renderer = new WebGPURenderer({ canvas: ui.preview, antialias: true, powerPreference: 'high-performance', forceWebGL: forceWebGl });
  if (!forceWebGl) disableThreeWebGlFallback(renderer);
  await withTimeout(renderer.init(), 30_000, 'WebGPU renderer initialisation');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = Number(ui.exposure.value);
  renderer.shadowMap.enabled = true;
  renderer.info.autoReset = false;
  ui.backend.textContent = forceWebGl ? 'WEBGL2 · EXPLICIT COMPARISON' : 'WEBGPU · PRIMARY';
  ktx2Loader = new KTX2Loader().setWorkerLimit(2);
  ktx2Loader.setTranscoderPath(__ASSET_LAB_BASIS_PATH__);
  ktx2Loader.detectSupport(renderer);

  const gpuDevice = renderer.backend?.device;
  const gpuGuard = installGpuFailureBoundary(gpuDevice, reportFatal);
  if (gpuDevice?.lost) gpuDevice.lost.then((info) => reportFatal(new Error(`WebGPU device lost (${info.reason || 'unknown'}): ${info.message || 'no driver message'}`)));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071019);
  camera = new THREE.PerspectiveCamera(36, 1, 0.01, 500);
  controls = new OrbitControls(camera, ui.preview);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 1.2;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI * 0.495;

  scene.add(new THREE.HemisphereLight(0xaed8ff, 0x2c1b14, 1.8));
  keyLight = new THREE.DirectionalLight(0xffe5c4, 4.2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.00035;
  scene.add(keyLight);
  const rim = new THREE.DirectionalLight(0x39caff, 2.8);
  rim.position.set(-6, 5, -7);
  scene.add(rim);
  updateKeyLight();

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8.7, 128),
    new THREE.MeshStandardMaterial({ color: 0x172129, roughness: 0.94, metalness: 0.02 }),
  );
  ground.name = 'AssetLabGround';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(17, 34, 0x3a7c8e, 0x253741);
  grid.name = 'AssetLabGrid';
  grid.position.y = 0.008;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  buildFilters();
  bindUi();
  applyFilters();
  resize();
  window.addEventListener('resize', resize);

  const requested = query.get('asset');
  const initial = catalog.find((asset) => asset.id === requested)
    ?? catalog.find((asset) => asset.slug === 'peacekeeper')
    ?? catalog[0];
  await selectFamily(initial, query.get('variant'));

  ui.loading.hidden = true;
  frame(performance.now(), gpuGuard);
}

function buildFilters() {
  for (const faction of factionOrder) {
    if (faction !== 'all' && !catalog.some((asset) => asset.faction === faction)) continue;
    const count = faction === 'all' ? catalog.length : catalog.filter((asset) => asset.faction === faction).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.faction = faction;
    button.textContent = `${factionLabels[faction]} · ${count}`;
    button.classList.toggle('active', faction === factionFilter);
    button.addEventListener('click', () => {
      factionFilter = faction;
      ui['faction-filters'].querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      applyFilters();
    });
    ui['faction-filters'].append(button);
  }
  const categories = ['all', ...new Set(catalog.map((asset) => asset.category))];
  for (const category of categories) {
    const count = category === 'all' ? catalog.length : catalog.filter((asset) => asset.category === category).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.category = category;
    button.textContent = `${category === 'all' ? 'All categories' : category} · ${count}`;
    button.classList.toggle('active', category === categoryFilter);
    button.addEventListener('click', () => {
      categoryFilter = category;
      ui['category-filters'].querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      applyFilters();
    });
    ui['category-filters'].append(button);
  }
}

function applyFilters() {
  const search = ui.search.value.trim().toLowerCase();
  filteredCatalog = catalog.filter((asset) =>
    (factionFilter === 'all' || asset.faction === factionFilter) &&
    (categoryFilter === 'all' || asset.category === categoryFilter) &&
    (!search || asset.search.includes(search)));
  ui['visible-total'].textContent = filteredCatalog.length.toLocaleString();
  renderAssetList();
}

function renderAssetList() {
  ui['asset-list'].replaceChildren();
  if (filteredCatalog.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No model families match these filters.';
    ui['asset-list'].append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const asset of filteredCatalog) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'asset-card';
    card.dataset.assetId = asset.id;
    card.classList.toggle('active', asset === currentFamily);
    const name = document.createElement('span');
    name.className = 'asset-name';
    name.textContent = asset.name;
    const count = document.createElement('span');
    count.className = 'asset-count';
    count.textContent = `${asset.variantCount}×`;
    const meta = document.createElement('span');
    meta.className = 'asset-meta';
    meta.textContent = `${asset.factionLabel} · ${asset.category}`;
    card.append(name, count, meta);
    card.addEventListener('click', () => void selectFamily(asset));
    fragment.append(card);
  }
  ui['asset-list'].append(fragment);
}

async function selectFamily(family, requestedVariant = null) {
  currentFamily = family;
  renderAssetList();
  const activeCard = ui['asset-list'].querySelector(`[data-asset-id="${CSS.escape(family.id)}"]`);
  activeCard?.scrollIntoView({ block: 'nearest' });
  ui['asset-faction'].textContent = `${family.factionLabel} / ${family.category}`;
  ui['asset-title'].textContent = family.name;
  ui.badges.replaceChildren(
    badge(family.kind, true),
    badge(`${family.variantCount} ${family.variantCount === 1 ? 'delivery' : 'deliveries'}`),
    ...(family.hasLods ? [badge('LOD family')] : []),
    ...(family.hasShadow ? [badge('Shadow proxy')] : []),
    ...(family.hasAnimations ? [badge('Rig + clips')] : []),
  );
  ui['variant-select'].replaceChildren(...family.files.map((file) => {
    const option = document.createElement('option');
    option.value = file.sourcePath;
    option.textContent = `${file.variant} — ${file.filename}`;
    return option;
  }));
  const requestedFile = requestedVariant ? family.files.find((file) => file.variant === requestedVariant || file.filename === requestedVariant) : null;
  await loadFile(requestedFile ?? family.primary);
}

async function loadFile(file) {
  const generation = ++loadGeneration;
  currentFile = file;
  ui.loading.hidden = false;
  ui.loading.textContent = `LOADING ${currentFamily.name.toUpperCase()}`;
  setStatus(`Fetching ${file.variant}…`);
  ui['variant-select'].value = file.sourcePath;
  ui['source-path'].textContent = file.relativePath;
  clearMetrics();
  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set('asset', currentFamily.id);
  nextUrl.searchParams.set('variant', file.filename);
  history.replaceState(null, '', nextUrl);

  try {
    const assetUrl = typeof file.url === 'function' ? await file.url() : file.url;
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`Asset fetch failed (${response.status} ${response.statusText}).`);
    const bytes = await response.arrayBuffer();
    if (generation !== loadGeneration) return;
    const loader = createLoader();
    const basePath = assetUrl.slice(0, assetUrl.lastIndexOf('/') + 1);
    const gltf = await loader.parseAsync(bytes, basePath);
    if (generation !== loadGeneration) {
      disposeScene(gltf.scene);
      return;
    }
    showGltf(gltf, bytes.byteLength);
    setStatus(`Ready · ${currentFamily.name} · ${file.variant}`);
  } catch (error) {
    if (generation !== loadGeneration) return;
    console.error('[asset-lab] model load failed', file.relativePath, error);
    setStatus(`Could not display ${file.variant}: ${error instanceof Error ? error.message : error}`, true);
  } finally {
    if (generation === loadGeneration) ui.loading.hidden = true;
  }
}

function createLoader() {
  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader);
  return loader;
}

function showGltf(gltf, byteLength) {
  if (displayRoot) {
    scene.remove(displayRoot);
    disposeScene(displayRoot);
  }
  gltf.scene.updateMatrixWorld(true);
  const metrics = auditGltf(gltf, byteLength);
  displayRoot = flattenForSafePreview(gltf.scene);
  displayRoot.name = `AssetLabDisplay_${currentFamily.slug}`;
  scene.add(displayRoot);
  normaliseDisplay(displayRoot, metrics.sourceBounds);
  setWireframe(wireframe);
  applyShadowState();
  currentMetrics = metrics;
  renderMetrics(metrics);
  ui['infantry-tools'].hidden = currentFamily.category !== 'Infantry';
  resetCamera();
}

function auditGltf(gltf, byteLength) {
  let triangles = 0;
  let vertices = 0;
  let parts = 0;
  let skinned = 0;
  const materials = new Set();
  const textures = new Set();
  const bones = new Set();
  gltf.scene.traverse((node) => {
    if (node.isBone) bones.add(node);
    if (!node.isMesh) return;
    parts++;
    if (node.isSkinnedMesh) skinned++;
    const geometry = node.geometry;
    const position = geometry?.getAttribute('position');
    vertices += position?.count ?? 0;
    triangles += geometry?.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3;
    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of nodeMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  const sourceBounds = new THREE.Box3().setFromObject(gltf.scene);
  return { triangles, vertices, parts, skinned, materials, textures, bones, animations: gltf.animations ?? [], byteLength, sourceBounds };
}

function flattenForSafePreview(source) {
  const safe = new THREE.Group();
  source.updateMatrixWorld(true);
  source.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry.clone();
    if (node.isSkinnedMesh) bakeBindPose(node, geometry);
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');
    const mesh = new THREE.Mesh(geometry, node.material);
    mesh.name = node.name || 'PreviewMesh';
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(node.matrixWorld);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    safe.add(mesh);
  });
  return safe;
}

function bakeBindPose(source, geometry) {
  source.skeleton?.pose();
  source.updateMatrixWorld(true);
  const positions = geometry.getAttribute('position');
  if (!positions) return;
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index);
    source.applyBoneTransform(index, point);
    positions.setXYZ(index, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function normaliseDisplay(root, sourceBounds) {
  const size = sourceBounds.getSize(new THREE.Vector3());
  const centre = sourceBounds.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.001);
  const scale = 5.4 / largest;
  root.scale.setScalar(scale);
  root.position.set(-centre.x * scale, -sourceBounds.min.y * scale, -centre.z * scale);
  root.updateMatrixWorld(true);
}

function resetCamera() {
  camera.position.set(8.4, 6.3, 9.8);
  controls.target.set(0, 2, 0);
  controls.update();
}

function renderMetrics(metrics) {
  const size = metrics.sourceBounds.getSize(new THREE.Vector3());
  ui['metric-triangles'].textContent = Math.round(metrics.triangles).toLocaleString();
  ui['metric-vertices'].textContent = metrics.vertices.toLocaleString();
  ui['metric-parts'].textContent = metrics.parts.toLocaleString();
  ui['metric-materials'].textContent = metrics.materials.size.toLocaleString();
  ui['metric-textures'].textContent = metrics.textures.size.toLocaleString();
  ui['metric-rig'].textContent = metrics.skinned ? `${metrics.skinned} skinned · ${metrics.bones.size} bones · static-safe preview` : 'Static mesh';
  ui['metric-animations'].textContent = metrics.animations.length
    ? metrics.animations.map((clip) => clip.name || 'Unnamed clip').join(', ')
    : (currentFamily.hasAnimations ? 'Separate clip deliveries available' : 'None');
  ui['metric-bounds'].textContent = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
  ui['metric-bytes'].textContent = formatBytes(metrics.byteLength);
}

function clearMetrics() {
  for (const id of ['metric-triangles','metric-vertices','metric-parts','metric-materials','metric-textures','metric-rig','metric-animations','metric-bounds','metric-bytes']) ui[id].textContent = '—';
}

function bindUi() {
  ui.search.addEventListener('input', applyFilters);
  ui['variant-select'].addEventListener('change', () => {
    const file = currentFamily.files.find((candidate) => candidate.sourcePath === ui['variant-select'].value);
    if (file) void loadFile(file);
  });
  ui['reset-camera'].addEventListener('click', resetCamera);
  ui['auto-rotate'].addEventListener('click', () => {
    autoRotate = !autoRotate;
    ui['auto-rotate'].classList.toggle('active', autoRotate);
  });
  ui.wireframe.addEventListener('click', () => {
    wireframe = !wireframe;
    ui.wireframe.classList.toggle('active', wireframe);
    setWireframe(wireframe);
  });
  ui['toggle-grid'].addEventListener('click', () => {
    showGrid = !showGrid;
    ui['toggle-grid'].classList.toggle('active', showGrid);
    scene.getObjectByName('AssetLabGround').visible = showGrid;
    scene.getObjectByName('AssetLabGrid').visible = showGrid;
  });
  ui['toggle-shadows'].addEventListener('click', () => {
    showShadows = !showShadows;
    ui['toggle-shadows'].classList.toggle('active', showShadows);
    renderer.shadowMap.enabled = showShadows;
    applyShadowState();
  });
  ui.exposure.addEventListener('input', () => {
    renderer.toneMappingExposure = Number(ui.exposure.value);
    ui['exposure-value'].textContent = Number(ui.exposure.value).toFixed(2);
  });
  ui['light-angle'].addEventListener('input', updateKeyLight);
  ui['previous-asset'].addEventListener('click', () => stepAsset(-1));
  ui['next-asset'].addEventListener('click', () => stepAsset(1));
  ui['open-infantry-lab'].addEventListener('click', () => {
    const isCommander = currentFamily.files.some((file) => file.directories.includes('commanders'));
    const params = new URLSearchParams({
      faction: currentFamily.faction,
      unit: currentFamily.slug,
      count: isCommander ? '1' : '48',
      mode: isCommander ? 'single' : 'army',
    });
    location.href = `./infantry.html?${params}`;
  });
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowLeft') stepAsset(-1);
    if (event.key === 'ArrowRight') stepAsset(1);
    if (event.key.toLowerCase() === 'f') resetCamera();
  });
}

function stepAsset(delta) {
  if (!filteredCatalog.length) return;
  const index = Math.max(0, filteredCatalog.indexOf(currentFamily));
  void selectFamily(filteredCatalog[(index + delta + filteredCatalog.length) % filteredCatalog.length]);
}

function updateKeyLight() {
  const degrees = Number(ui['light-angle'].value);
  const angle = THREE.MathUtils.degToRad(degrees);
  keyLight?.position.set(Math.sin(angle) * 8, 9, Math.cos(angle) * 8);
  if (ui['light-value']) ui['light-value'].textContent = `${degrees}°`;
}

function setWireframe(value) {
  displayRoot?.traverse((node) => {
    if (!node.isMesh) return;
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) if (material) material.wireframe = value;
  });
}

function applyShadowState() {
  displayRoot?.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = showShadows;
    node.receiveShadow = showShadows;
  });
}

function resize() {
  const width = ui.preview.clientWidth;
  const height = ui.preview.clientHeight;
  renderer.setPixelRatio(boundedPixelRatio(width, height));
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function frame(now, gpuGuard) {
  if (fatalStopped) return;
  raf = requestAnimationFrame((time) => frame(time, gpuGuard));
  const raw = Math.max(0.01, now - lastFrame);
  lastFrame = now;
  smoothedFrameMs += (raw - smoothedFrameMs) * 0.08;
  if (autoRotate && displayRoot) displayRoot.rotation.y += Math.min(raw / 1000, 0.05) * 0.55;
  controls.update();
  renderer.info.reset();
  try {
    renderer.render(scene, camera);
    gpuGuard.settleFirstFrame();
  } catch (error) {
    reportFatal(error);
    return;
  }
  ui['metric-frame'].textContent = `${smoothedFrameMs.toFixed(1)} ms · ${(1000 / smoothedFrameMs).toFixed(0)} fps · ${renderer.info.render.drawCalls} calls`;
  gpuGuard.heartbeat();
}

function reportFatal(error) {
  if (fatalStopped) return;
  fatalStopped = true;
  cancelAnimationFrame(raf);
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('[asset-lab] fatal boundary', error);
  setStatus(message, true);
  ui.loading.hidden = true;
}

function setStatus(message, error = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', error);
}

function badge(text, cyan = false) {
  const item = document.createElement('span');
  item.className = `badge${cyan ? ' cyan' : ''}`;
  item.textContent = text;
  return item;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}

function disposeScene(root) {
  const materials = new Set();
  root?.traverse((node) => {
    node.geometry?.dispose?.();
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
    material.dispose?.();
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(raf);
  controls?.dispose();
  ktx2Loader?.dispose();
  renderer?.dispose();
  disposeScene(displayRoot);
});
