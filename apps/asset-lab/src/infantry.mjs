import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  createInfantryPackGeometry,
  createInfantryWeaponGeometry,
} from '@voltmarch/assets/runtime/infantry-attachments.mjs';
import { bakeCpuAnimationFrames, INFANTRY_RUNTIME_LIMITS } from './infantry-shared-pose.mjs';
import { boundedPixelRatio, disableThreeWebGlFallback, installGpuFailureBoundary, withTimeout } from './webgpu-safety.mjs';
import alliedLod0Url from '../../../packages/assets/game/units/allies/infantry-poc/peacekeeper-lod0.glb?url';
import alliedRiggedUrl from '../../../packages/assets/game/units/allies/infantry-poc/peacekeeper-rigged-textured.glb?url';
import alliedWalkUrl from '../../../packages/assets/game/units/allies/infantry-poc/peacekeeper-walk.glb?url';
import alliedRunUrl from '../../../packages/assets/game/units/allies/infantry-poc/peacekeeper-run.glb?url';
import alliedRunShootUrl from '../../../packages/assets/game/units/allies/infantry-poc/peacekeeper-run-shoot.glb?url';
import alliedCommanderUrl from '../../../packages/assets/game/units/allies/commanders/field-marshal-lod0.glb?url';
import alliedCommanderWalkUrl from '../../../packages/assets/game/units/allies/commanders/field-marshal-walk.glb?url';
import alliedCommanderRunUrl from '../../../packages/assets/game/units/allies/commanders/field-marshal-run.glb?url';
import sovietLod0Url from '../../../packages/assets/game/units/soviets/infantry-poc/conscript-lod0.glb?url';
import sovietWalkUrl from '../../../packages/assets/game/units/soviets/infantry-poc/conscript-walk.glb?url';
import sovietRunUrl from '../../../packages/assets/game/units/soviets/infantry-poc/conscript-run.glb?url';
import sovietRunShootUrl from '../../../packages/assets/game/units/soviets/infantry-poc/conscript-run-shoot.glb?url';
import sovietCommanderUrl from '../../../packages/assets/game/units/soviets/commanders/war-commissar-lod0.glb?url';
import sovietCommanderWalkUrl from '../../../packages/assets/game/units/soviets/commanders/war-commissar-walk.glb?url';
import sovietCommanderRunUrl from '../../../packages/assets/game/units/soviets/commanders/war-commissar-run.glb?url';
import sovietAttackDogRiggedUrl from '../../../packages/assets/game/units/soviets/animation/attack-dog-rigged.glb?url';
import meridianLod0Url from '../../../packages/assets/game/units/meridian/infantry-poc/wayfarer-lod0.glb?url';
import meridianWalkUrl from '../../../packages/assets/game/units/meridian/infantry-poc/wayfarer-walk.glb?url';
import meridianRunUrl from '../../../packages/assets/game/units/meridian/infantry-poc/wayfarer-run.glb?url';
import meridianRunShootUrl from '../../../packages/assets/game/units/meridian/infantry-poc/wayfarer-run-shoot.glb?url';
import meridianCommanderUrl from '../../../packages/assets/game/units/meridian/commanders/hierarch-lod0.glb?url';
import meridianCommanderWalkUrl from '../../../packages/assets/game/units/meridian/commanders/hierarch-walk.glb?url';
import meridianCommanderRunUrl from '../../../packages/assets/game/units/meridian/commanders/hierarch-run.glb?url';
import reclamationLod0Url from '../../../packages/assets/game/units/reclamation/infantry-poc/scrap-picker-lod0.glb?url';
import reclamationWalkUrl from '../../../packages/assets/game/units/reclamation/infantry-poc/scrap-picker-walk.glb?url';
import reclamationRunUrl from '../../../packages/assets/game/units/reclamation/infantry-poc/scrap-picker-run.glb?url';
import reclamationRunShootUrl from '../../../packages/assets/game/units/reclamation/infantry-poc/scrap-picker-run-shoot.glb?url';
import reclamationCommanderUrl from '../../../packages/assets/game/units/reclamation/commanders/scrap-baron-lod0.glb?url';
import reclamationCommanderWalkUrl from '../../../packages/assets/game/units/reclamation/commanders/scrap-baron-walk.glb?url';
import reclamationCommanderRunUrl from '../../../packages/assets/game/units/reclamation/commanders/scrap-baron-run.glb?url';

const canvas = document.querySelector('#preview');
const statusEl = document.querySelector('#status');
const backendEl = document.querySelector('#backend');
const geometryEl = document.querySelector('#geometry');
const rigEl = document.querySelector('#rig');
const auditEl = document.querySelector('#audit');
const sourceEl = document.querySelector('#source');
const activeClipEl = document.querySelector('#active-clip');
const modeEl = document.querySelector('#mode');
const drawCallsEl = document.querySelector('#draw-calls');
const frameTimeEl = document.querySelector('#frame-time');
const speedInput = document.querySelector('#speed');
const speedValue = document.querySelector('#speed-value');
const skeletonInput = document.querySelector('#skeleton');
const soldierCountInput = document.querySelector('#soldier-count');
const countHelpEl = document.querySelector('#count-help');
const factionInput = document.querySelector('#faction');
const unitInput = document.querySelector('#unit');
const unitTitleEl = document.querySelector('#unit-title');
const unitDescriptionEl = document.querySelector('#unit-description');

const query = new URLSearchParams(location.search);
const reviewSource = query.get('model') === 'review';
const supportedFactions = new Set(['allies', 'soviets', 'meridian', 'reclamation']);
const requestedFaction = query.get('faction');
const faction = supportedFactions.has(requestedFaction) ? requestedFaction : 'allies';
const factionUnits = {
  allies: ['peacekeeper', 'javelin', 'engineer', 'field-marshal'],
  soviets: ['conscript', 'flak-trooper', 'combat-engineer', 'war-commissar', 'attack-dog'],
  meridian: ['wayfarer', 'sunlancer', 'artificer', 'hierarch'],
  reclamation: ['scrap-picker', 'slagger', 'tinker', 'scrap-baron'],
};
const commanderUnits = new Set(['field-marshal', 'war-commissar', 'hierarch', 'scrap-baron']);
const commanderRuntimeLimits = Object.freeze({
  ...INFANTRY_RUNTIME_LIMITS,
  maxVertices: 40_000,
  maxTriangles: 50_000,
  maxFormationCount: 4,
});
const requestedUnit = query.get('unit');
const unit = factionUnits[faction].includes(requestedUnit) ? requestedUnit : factionUnits[faction][0];
const requestedCount = Number(query.get('count') ?? '48');
const formationLimit = commanderUnits.has(unit)
  ? commanderRuntimeLimits.maxFormationCount
  : INFANTRY_RUNTIME_LIMITS.maxFormationCount;
const formationCount = Number.isFinite(requestedCount)
  ? THREE.MathUtils.clamp(Math.round(requestedCount), 1, formationLimit)
  : Math.min(48, formationLimit);
soldierCountInput.value = String(formationCount);
soldierCountInput.max = String(formationLimit);
countHelpEl.textContent = commanderUnits.has(unit)
  ? '1–4 commander review range · Apply reloads a clean WebGPU run.'
  : '1–512 stress range · Apply reloads a clean WebGPU run.';
const assetSets = {
  peacekeeper: {
    faction: 'allies',
    label: 'Peacekeeper',
    title: 'Allied Peacekeeper POC',
    description: 'Shared-pose Allied infantry proof. The temporary rifle validates the hand sockets; it is not final art.',
    source: reviewSource
      ? '23.7k review source · ?model=lod0 for shipping candidate'
      : '2.9k gameplay LOD0 · 0.58 MiB · ?model=review for dense source',
    rigged: reviewSource ? alliedRiggedUrl : alliedLod0Url,
    walk: alliedWalkUrl,
    run: alliedRunUrl,
    runShoot: alliedRunShootUrl,
    weapon: { kind: 'bullpup', color: 0x17313e, emissive: 0x062a34 },
  },
  javelin: {
    faction: 'allies',
    label: 'Javelin',
    title: 'Allied Javelin POC',
    description: 'The canonical Peacekeeper body with a lightweight launcher and missile-pack attachment.',
    source: 'Shared 2.9k Peacekeeper body and clips · modular specialist attachments',
    rigged: alliedLod0Url,
    walk: alliedWalkUrl,
    run: alliedRunUrl,
    runShoot: alliedRunShootUrl,
    weapon: { kind: 'launcher', color: 0x355f92, emissive: 0x0b2e4d },
    pack: { kind: 'missile-pack', color: 0x355f92, emissive: 0x0b2e4d },
  },
  engineer: {
    faction: 'allies',
    label: 'Engineer',
    title: 'Allied Engineer · Shared Body',
    description: 'The canonical Peacekeeper body with a compact toolcase and powered wrench attachment.',
    source: 'Shared 2.9k Peacekeeper body and clips · modular engineer attachments',
    rigged: alliedLod0Url,
    walk: alliedWalkUrl,
    run: alliedRunUrl,
    runShoot: alliedRunShootUrl,
    weapon: { kind: 'wrench', color: 0x355f92, emissive: 0x0b6a7d },
    pack: { kind: 'toolcase', color: 0x355f92, emissive: 0x0b6a7d },
    actionLabel: 'Run + work',
  },
  'field-marshal': {
    faction: 'allies',
    label: 'Field Marshal',
    title: 'Allied Field Marshal · Unique Commander',
    description: 'Faction-unique ceramic command armour and cape with its own 24-joint rig and PBR set.',
    source: '47,618 triangles · 6.05 MiB · unique walk/run clips · one commander maximum',
    rigged: alliedCommanderUrl,
    walk: alliedCommanderWalkUrl,
    run: alliedCommanderRunUrl,
    runShoot: alliedCommanderRunUrl,
    weapon: { kind: 'bullpup', color: 0x17313e, emissive: 0x062a34 },
    actionLabel: 'Run · commander',
  },
  conscript: {
    faction: 'soviets',
    label: 'Conscript',
    title: 'Soviet Conscript POC',
    description: 'Cheap greatcoat infantry LOD with matching rig, PBR faction materials, and shared CPU-baked poses.',
    source: '4.5k gameplay LOD0 · 1.56 MiB · animation-only clip files',
    rigged: sovietLod0Url,
    walk: sovietWalkUrl,
    run: sovietRunUrl,
    runShoot: sovietRunShootUrl,
    weapon: { kind: 'rifle', color: 0x332b25, emissive: 0x180b08 },
  },
  'flak-trooper': {
    faction: 'soviets',
    label: 'Flak Trooper',
    title: 'Soviet Flak Trooper POC',
    description: 'The canonical Conscript body with a cooling drum and separate drum-fed flak weapon.',
    source: 'Shared 4.5k Conscript body and clips · modular specialist attachments',
    rigged: sovietLod0Url,
    walk: sovietWalkUrl,
    run: sovietRunUrl,
    runShoot: sovietRunShootUrl,
    weapon: { kind: 'flak', color: 0x3b332b, emissive: 0x2c0806 },
    pack: { kind: 'drum', color: 0x3b332b, emissive: 0x2c0806 },
  },
  'combat-engineer': {
    faction: 'soviets',
    label: 'Combat Engineer',
    title: 'Soviet Combat Engineer · Shared Body',
    description: 'The canonical Conscript body with a horizontal gas bottle and cutting-torch attachment.',
    source: 'Shared 4.5k Conscript body and clips · modular engineer attachments',
    rigged: sovietLod0Url,
    walk: sovietWalkUrl,
    run: sovietRunUrl,
    runShoot: sovietRunShootUrl,
    weapon: { kind: 'cutter', color: 0x3b332b, emissive: 0x7a1808 },
    pack: { kind: 'gas-bottle', color: 0x3b332b, emissive: 0x7a1808 },
    actionLabel: 'Run + cut',
  },
  'war-commissar': {
    faction: 'soviets',
    label: 'War Commissar',
    title: 'Soviet War Commissar · Unique Commander',
    description: 'Faction-unique industrial greatcoat commander with its own 24-joint rig and PBR set.',
    source: '47,883 triangles · 5.22 MiB · unique walk/run clips · one commander maximum',
    rigged: sovietCommanderUrl,
    walk: sovietCommanderWalkUrl,
    run: sovietCommanderRunUrl,
    runShoot: sovietCommanderRunUrl,
    weapon: { kind: 'rifle', color: 0x332b25, emissive: 0x180b08 },
    actionLabel: 'Run · commander',
  },
  'attack-dog': {
    faction: 'soviets',
    label: 'Attack Dog',
    title: 'Soviet Attack Dog · Quadruped Rig',
    description: 'Eight-joint quadruped skin with shared Idle, Walk, Run, and Bite clips on the approved PBR model.',
    source: '5,987 triangles · 8 joints · one shared textured primitive · four embedded clips',
    rigged: sovietAttackDogRiggedUrl,
    embeddedClips: { tpose: 'Idle', walk: 'Walk', run: 'Run', runShoot: 'Bite' },
    targetHeight: 1.36,
    spacing: 1.9,
    actionLabel: 'Bite',
  },
  wayfarer: {
    faction: 'meridian',
    label: 'Wayfarer',
    title: 'Meridian Wayfarer POC',
    description: 'Ceremonial ceramic infantry with a compact humanoid rig, faction PBR materials, and shared CPU-baked poses.',
    source: '5.9k gameplay LOD0 · 0.96 MiB · animation-only clip files',
    rigged: meridianLod0Url,
    walk: meridianWalkUrl,
    run: meridianRunUrl,
    runShoot: meridianRunShootUrl,
    weapon: { kind: 'carbine', color: 0x8e7640, emissive: 0x174c44 },
  },
  sunlancer: {
    faction: 'meridian',
    label: 'Sunlancer',
    title: 'Meridian Sunlancer POC',
    description: 'The canonical Wayfarer body with a solar-cell pack and separate energy lance.',
    source: 'Shared 5.9k Wayfarer body and clips · modular specialist attachments',
    rigged: meridianLod0Url,
    walk: meridianWalkUrl,
    run: meridianRunUrl,
    runShoot: meridianRunShootUrl,
    weapon: { kind: 'lance', color: 0xaa914e, emissive: 0x5c4210 },
    pack: { kind: 'cells', color: 0xaa914e, emissive: 0x174c44 },
  },
  artificer: {
    faction: 'meridian',
    label: 'Artificer',
    title: 'Meridian Artificer · Shared Body',
    description: 'The canonical Wayfarer body with a precision kit and compact calibrator attachment.',
    source: 'Shared 5.9k Wayfarer body and clips · modular engineer attachments',
    rigged: meridianLod0Url,
    walk: meridianWalkUrl,
    run: meridianRunUrl,
    runShoot: meridianRunShootUrl,
    weapon: { kind: 'calibrator', color: 0xaa914e, emissive: 0x17685f },
    pack: { kind: 'instrument-case', color: 0xaa914e, emissive: 0x17685f },
    actionLabel: 'Run + calibrate',
  },
  hierarch: {
    faction: 'meridian',
    label: 'Hierarch',
    title: 'Meridian Hierarch · Unique Commander',
    description: 'Faction-unique bone, jade and gold command vestment with its own 24-joint rig and PBR set.',
    source: '47,225 triangles · 6.26 MiB · unique walk/run clips · one commander maximum',
    rigged: meridianCommanderUrl,
    walk: meridianCommanderWalkUrl,
    run: meridianCommanderRunUrl,
    runShoot: meridianCommanderRunUrl,
    weapon: { kind: 'lance', color: 0xaa914e, emissive: 0x174c44 },
    actionLabel: 'Run · commander',
  },
  'scrap-picker': {
    faction: 'reclamation',
    label: 'Scrap Picker',
    title: 'Reclamation Scrap Picker POC',
    description: 'Asymmetric salvaged infantry with a compact humanoid rig, faction PBR materials, and shared CPU-baked poses.',
    source: '8.5k gameplay LOD0 · 1.29 MiB · animation-only clip files',
    rigged: reclamationLod0Url,
    walk: reclamationWalkUrl,
    run: reclamationRunUrl,
    runShoot: reclamationRunShootUrl,
    weapon: { kind: 'prod', color: 0x3c3546, emissive: 0x35125f },
  },
  slagger: {
    faction: 'reclamation',
    label: 'Slagger',
    title: 'Reclamation Slagger POC',
    description: 'The canonical Scrap Picker body with a hopper pack and separate slag projector.',
    source: 'Shared 8.5k Scrap Picker body and clips · modular specialist attachments',
    rigged: reclamationLod0Url,
    walk: reclamationWalkUrl,
    run: reclamationRunUrl,
    runShoot: reclamationRunShootUrl,
    weapon: { kind: 'satchel', color: 0x4a3b51, emissive: 0x551060 },
    pack: { kind: 'hopper', color: 0x4a3b51, emissive: 0x551060 },
  },
  tinker: {
    faction: 'reclamation',
    label: 'Tinker',
    title: 'Reclamation Tinker · Shared Body',
    description: 'The canonical Scrap Picker body with a rolled tool pack and salvage-cutter attachment.',
    source: 'Shared 8.5k Scrap Picker body and clips · modular engineer attachments',
    rigged: reclamationLod0Url,
    walk: reclamationWalkUrl,
    run: reclamationRunUrl,
    runShoot: reclamationRunShootUrl,
    weapon: { kind: 'salvage-tool', color: 0x4a3b51, emissive: 0x551060 },
    pack: { kind: 'tool-roll', color: 0x4a3b51, emissive: 0x551060 },
    actionLabel: 'Run + repair',
  },
  'scrap-baron': {
    faction: 'reclamation',
    label: 'Scrap Baron',
    title: 'Reclamation Scrap Baron · Unique Commander',
    description: 'Faction-unique graphite and violet salvage boss with its own 24-joint rig and PBR set.',
    source: '47,655 triangles · 5.92 MiB · unique walk/run clips · one commander maximum',
    rigged: reclamationCommanderUrl,
    walk: reclamationCommanderWalkUrl,
    run: reclamationCommanderRunUrl,
    runShoot: reclamationCommanderRunUrl,
    weapon: { kind: 'prod', color: 0x3c3546, emissive: 0x35125f },
    actionLabel: 'Run · commander',
  },
};
const assetSet = assetSets[unit];
const paths = assetSet.embeddedClips
  ? { rigged: assetSet.rigged }
  : Object.fromEntries(['rigged', 'walk', 'run', 'runShoot'].map((key) => [key, assetSet[key]]));
factionInput.value = faction;
for (const unitKey of factionUnits[faction]) {
  unitInput.add(new Option(assetSets[unitKey].label, unitKey));
}
unitInput.value = unit;
unitTitleEl.textContent = assetSet.title;
unitDescriptionEl.textContent = assetSet.description;
document.querySelector('[data-clip="runShoot"]').textContent = assetSet.actionLabel ?? 'Run + shoot';
document.querySelector('[data-clip="tpose"]').textContent = assetSet.embeddedClips ? 'Idle / rig' : 'T-pose / rig';
document.querySelector('[data-mode="single"]').textContent = assetSet.embeddedClips ? 'Single dog' : 'Single soldier';
document.querySelector('label[for="soldier-count"]').textContent = assetSet.embeddedClips ? 'Dogs' : 'Soldiers';

let renderer;
let raf = 0;
let skeletonHelper = null;
let mixer = null;
let activeAction = null;
let currentClip = 'runShoot';
let currentMode = query.get('mode') === 'single' ? 'single' : 'army';
let disposed = false;
let fatalReported = false;

const reportRuntimeError = (error) => {
  if (fatalReported) return;
  fatalReported = true;
  disposed = true;
  cancelAnimationFrame(raf);
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(error);
  statusEl.textContent = message;
  statusEl.classList.add('error');
};
window.addEventListener('error', (event) => reportRuntimeError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportRuntimeError(event.reason));

try {
  await start();
} catch (error) {
  reportRuntimeError(error);
}

async function start() {
  const forceWebGl = query.get('gpu') === 'webgl';
  if (!forceWebGl && !navigator.gpu) {
    throw new Error('WebGPU is unavailable. This POC defaults to WebGPU; append ?gpu=webgl only for comparison.');
  }
  renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    forceWebGL: forceWebGl,
  });
  if (!forceWebGl) disableThreeWebGlFallback(renderer);
  try {
    await withTimeout(renderer.init(), 30_000, 'WebGPU infantry renderer initialisation');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      'WebGPU device creation failed before the infantry tool could start. ' +
      'This browser GPU process may still be recovering from the earlier driver reset. ' +
      `No WebGL fallback was attempted. Detail: ${detail}`,
      { cause: error },
    );
  }
  backendEl.textContent = forceWebGl ? 'WebGL2 node backend (explicit ?gpu=webgl)' : 'WebGPU';
  const gpuDevice = renderer.backend?.device;
  const gpuGuard = installGpuFailureBoundary(gpuDevice, reportRuntimeError);
  if (gpuDevice?.lost) {
    gpuDevice.lost.then((info) => {
      reportRuntimeError(`WebGPU device lost (${info.reason || 'unknown'}): ${info.message || 'no driver message'}`);
    });
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071019);
  const formationSpacing = assetSet.spacing ?? 1.36;
  const formationSpan = Math.sqrt(formationCount) * formationSpacing;
  scene.fog = new THREE.Fog(0x071019, Math.max(8, formationSpan * 0.8), Math.max(18, formationSpan * 2.2));

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.4;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI * 0.49;
  const resetCamera = () => {
    if (currentMode === 'army') {
      const closeHeroFormation = commanderUnits.has(unit);
      camera.position.set(
        Math.max(closeHeroFormation ? 4.8 : 10.5, formationSpan * 0.95),
        Math.max(closeHeroFormation ? 3.8 : 9.2, formationSpan * 0.84),
        Math.max(closeHeroFormation ? 6.2 : 13.5, formationSpan * 1.22),
      );
      controls.target.set(0, closeHeroFormation ? 1.05 : 0.8, 0);
    } else {
      const targetHeight = assetSet.targetHeight ?? 2.2;
      camera.position.set(4.2, Math.max(2.2, targetHeight * 1.6), 5.7);
      controls.target.set(0, targetHeight * 0.49, 0);
    }
    controls.update();
  };
  resetCamera();

  scene.add(new THREE.HemisphereLight(0x9ac7f5, 0x271a12, 1.55));
  const key = new THREE.DirectionalLight(0xffe5c4, 4.1);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const shadowExtent = Math.max(4, formationSpan * 0.7);
  key.shadow.camera.left = -shadowExtent;
  key.shadow.camera.right = shadowExtent;
  key.shadow.camera.top = shadowExtent;
  key.shadow.camera.bottom = -shadowExtent;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x32c8ff, 2.4);
  rim.position.set(-4, 3.5, -3);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(8, formationSpan * 0.82), 96),
    new THREE.MeshStandardMaterial({ color: 0x18232a, roughness: 0.92, metalness: 0.02 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.28, 1.31, 96),
    new THREE.MeshBasicMaterial({ color: 0x2bbfe9, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  scene.add(ring);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const rigged = await loader.loadAsync(paths.rigged);
  const [walking, running, shooting] = assetSet.embeddedClips
    ? [rigged, rigged, rigged]
    : await Promise.all([
      loader.loadAsync(paths.walk),
      loader.loadAsync(paths.run),
      loader.loadAsync(paths.runShoot),
    ]);

  const soldier = rigged.scene;
  normaliseSoldier(soldier, assetSet.targetHeight ?? 2.2);

  let triangles = 0;
  let skinnedMeshes = 0;
  soldier.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material?.map) material.map.colorSpace = THREE.SRGBColorSpace;
      if (material) material.envMapIntensity = 0.72;
    }
    const geometry = node.geometry;
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    if (node.isSkinnedMesh) skinnedMeshes += 1;
  });
  if (skinnedMeshes !== 1) {
    throw new Error(`Infantry source must contain exactly one SkinnedMesh; found ${skinnedMeshes}.`);
  }

  const bones = [];
  soldier.traverse((node) => { if (node.isBone) bones.push(node); });
  rigEl.textContent = `${bones.length} bones · ${skinnedMeshes} skinned mesh`;
  geometryEl.textContent = `${Math.round(triangles).toLocaleString()} triangles / soldier`;
  sourceEl.textContent = assetSet.source;

  skeletonHelper = new THREE.SkeletonHelper(soldier);
  skeletonHelper.visible = false;
  scene.add(skeletonHelper);

  mixer = new THREE.AnimationMixer(soldier);
  const clips = assetSet.embeddedClips
    ? Object.fromEntries(Object.entries(assetSet.embeddedClips).map(([key, clipName]) => [
      key,
      inPlace(requireNamedClip(rigged, clipName)),
    ]))
    : {
      tpose: requireClip(rigged, 'T-pose / rig'),
      walk: inPlace(requireClip(walking, 'walk')),
      run: inPlace(requireClip(running, 'run')),
      runShoot: inPlace(requireClip(shooting, 'run + shoot')),
    };

  const animation = bakeCpuAnimationFrames({
    soldier,
    sourceMesh: findSkinnedMesh(soldier),
    clips,
    fps: 30,
    formationCount,
    bucketCount: INFANTRY_RUNTIME_LIMITS.maxPoseBuckets,
    requireAttachmentSockets: assetSet.weapon !== undefined || assetSet.pack !== undefined,
    limits: commanderUnits.has(unit) ? commanderRuntimeLimits : INFANTRY_RUNTIME_LIMITS,
  });
  const formation = createArmyFormation({
    sourceMesh: findSkinnedMesh(soldier), animation, scene, count: formationCount,
    requestedBucketCount: 4, weapon: assetSet.weapon, pack: assetSet.pack, spacing: formationSpacing,
  });
  const singlePreview = createArmyFormation({
    sourceMesh: findSkinnedMesh(soldier), animation, scene, count: 1,
    requestedBucketCount: 1, weapon: assetSet.weapon, pack: assetSet.pack, spacing: formationSpacing,
  });
  const bakedMiB = animation.audit.bakedBytes / 1024 / 1024;
  rigEl.textContent += ` · ${bakedMiB.toFixed(1)} MiB bounded bake`;
  auditEl.textContent =
    `PASS · ${animation.audit.vertexCount.toLocaleString()} vertices · ` +
    `${animation.audit.boneCount} bounded joints · max weight drift ${animation.audit.maxWeightError.toExponential(1)}`;

  function setMode(mode, resetView = true) {
    currentMode = mode;
    const army = mode === 'army';
    formation.group.visible = army;
    if (formation.rifles) formation.rifles.visible = army && currentClip === 'runShoot';
    singlePreview.group.visible = !army;
    if (singlePreview.rifles) singlePreview.rifles.visible = !army && currentClip === 'runShoot';
    ring.visible = !army;
    skeletonHelper.visible = !army && skeletonInput.checked;
    modeEl.textContent = army
      ? `Army formation · ${formation.count} units · ${formation.bucketCount} shared pose buckets`
      : 'Single unit · authoring inspection';
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });
    if (resetView) resetCamera();
  }

  function playClip(name, fade = 0.18) {
    currentClip = name;
    if (formation.rifles) formation.rifles.visible = currentMode === 'army' && name === 'runShoot';
    if (singlePreview.rifles) singlePreview.rifles.visible = currentMode === 'single' && name === 'runShoot';
    formation.setClip(name);
    singlePreview.setClip(name);
    const labels = {
      tpose: assetSet.embeddedClips ? 'Idle / rig' : 'T-pose / rig',
      walk: 'Walk',
      run: 'Run',
      runShoot: assetSet.actionLabel ?? 'Run + shoot',
    };
    document.querySelectorAll('[data-clip]').forEach((button) => button.classList.toggle('active', button.dataset.clip === name));
    activeClipEl.textContent = labels[name];
    const next = mixer.clipAction(clips[name]);
    if (next === activeAction) return;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    activeAction?.fadeOut(fade);
    activeAction = next;
  }

  document.querySelectorAll('[data-clip]').forEach((button) => {
    button.addEventListener('click', () => playClip(button.dataset.clip));
  });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  speedInput.addEventListener('input', () => {
    speedValue.textContent = `${Number(speedInput.value).toFixed(2)}x`;
  });
  skeletonInput.addEventListener('change', () => {
    skeletonHelper.visible = currentMode === 'single' && skeletonInput.checked;
  });
  document.querySelector('#reset-camera').addEventListener('click', resetCamera);
  const applySoldierCount = () => {
    const value = Number(soldierCountInput.value);
    const count = Number.isFinite(value)
      ? THREE.MathUtils.clamp(Math.round(value), 1, INFANTRY_RUNTIME_LIMITS.maxFormationCount)
      : formationCount;
    soldierCountInput.value = String(count);
    const next = new URL(location.href);
    next.searchParams.set('count', String(count));
    statusEl.textContent = `Reloading a clean ${count}-soldier WebGPU stress run…`;
    location.assign(next.href);
  };
  document.querySelector('#apply-count').addEventListener('click', applySoldierCount);
  factionInput.addEventListener('change', () => {
    const next = new URL(location.href);
    next.searchParams.set('faction', factionInput.value);
    next.searchParams.set('unit', factionUnits[factionInput.value][0]);
    next.searchParams.delete('model');
    statusEl.textContent = `Loading ${factionInput.options[factionInput.selectedIndex].text} infantry…`;
    location.assign(next.href);
  });
  unitInput.addEventListener('change', () => {
    const next = new URL(location.href);
    next.searchParams.set('unit', unitInput.value);
    next.searchParams.delete('model');
    statusEl.textContent = `Loading ${unitInput.options[unitInput.selectedIndex].text}…`;
    location.assign(next.href);
  });
  soldierCountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applySoldierCount();
  });
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      speedInput.value = speedInput.value === '0' ? '1' : '0';
      speedInput.dispatchEvent(new Event('input'));
      return;
    }
    const clip = { Digit1: 'tpose', Digit2: 'walk', Digit3: 'run', Digit4: 'runShoot' }[event.code];
    if (clip) playClip(clip);
  });

  const resize = () => {
    const width = innerWidth;
    const height = innerHeight;
    renderer.setPixelRatio(boundedPixelRatio(width, height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  playClip('runShoot', 0);
  setMode(currentMode, false);
  resetCamera();
  statusEl.textContent = 'Ready';

  let lastFrame = performance.now();
  let smoothedFrameMs = 16.67;
  let lastFrameReadout = lastFrame;
  const frame = (now) => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const rawFrameMs = Math.max(0.01, now - lastFrame);
    const dt = Math.min(rawFrameMs / 1000, 0.05);
    lastFrame = now;
    smoothedFrameMs += (rawFrameMs - smoothedFrameMs) * 0.08;
    mixer.update(dt * Number(speedInput.value));
    formation.update(dt * Number(speedInput.value));
    singlePreview.update(dt * Number(speedInput.value));
    controls.update();
    renderer.info.reset();
    try {
      renderer.render(scene, camera);
      gpuGuard.settleFirstFrame();
    } catch (error) {
      reportRuntimeError(error);
      disposed = true;
      return;
    }
    const calls = renderer.info.render.drawCalls;
    const trianglesDrawn = renderer.info.render.triangles;
    drawCallsEl.textContent = `${calls} calls · ${Math.round(trianglesDrawn).toLocaleString()} drawn triangles`;
    if (now - lastFrameReadout >= 250) {
      const fps = 1000 / smoothedFrameMs;
      frameTimeEl.textContent = `${smoothedFrameMs.toFixed(1)} ms · ${fps.toFixed(0)} fps`;
      lastFrameReadout = now;
    }
    gpuGuard.heartbeat();
  };
  frame(performance.now());

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
    });
  }
}

function requireClip(gltf, label) {
  const clip = gltf.animations[0];
  if (!clip) throw new Error(`The ${label} GLB contains no animation clip.`);
  return clip;
}

function requireNamedClip(gltf, name) {
  const clip = gltf.animations.find((animation) => animation.name === name);
  if (!clip) throw new Error(`The rigged GLB contains no "${name}" animation clip.`);
  return clip;
}

function inPlace(source) {
  const clip = source.clone();
  for (const track of clip.tracks) {
    if (!(track instanceof THREE.VectorKeyframeTrack)) continue;
    if (!/Hips\.position$/i.test(track.name)) continue;
    const values = track.values;
    const x = values[0];
    const z = values[2];
    for (let i = 0; i < values.length; i += 3) {
      values[i] = x;
      values[i + 2] = z;
    }
  }
  clip.name = source.name;
  return clip;
}

function normaliseSoldier(soldier, targetHeight) {
  soldier.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(soldier);
  const height = box.max.y - box.min.y;
  const scale = targetHeight / Math.max(height, 0.001);
  soldier.scale.setScalar(scale);
  soldier.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(soldier);
  const centre = box.getCenter(new THREE.Vector3());
  soldier.position.set(-centre.x, -box.min.y, -centre.z);
  soldier.updateMatrixWorld(true);
}

function createArmyFormation({ sourceMesh, animation, scene, count, requestedBucketCount, weapon, pack, spacing }) {
  if (!sourceMesh) throw new Error('The infantry source contains no skinned mesh.');

  const fps = animation.fps;
  const offsets = new Float32Array(count * 3);
  const yaws = new Float32Array(count);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const columns = Math.min(count, Math.ceil(Math.sqrt(count * 1.25)));
  const rows = Math.ceil(count / columns);
  const bucketCount = Math.min(requestedBucketCount, count, INFANTRY_RUNTIME_LIMITS.maxPoseBuckets);

  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    offsets[index * 3] = (column - (columns - 1) * 0.5) * spacing + (row % 2) * 0.3;
    offsets[index * 3 + 1] = 0;
    offsets[index * 3 + 2] = (row - (rows - 1) * 0.5) * spacing;
    yaws[index] = ((index * 17) % 9 - 4) * 0.018;
    phases[index] = ((index * 37) % count) / count;
    speeds[index] = 0.94 + ((index * 13) % 11) * 0.012;
  }

  const sourceMaterial = Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material;
  const rifles = weapon ? createInstancedWeapons(count, weapon) : null;
  const group = new THREE.Group();
  group.name = 'PeacekeeperArmyFormation';
  const buckets = [];
  const identityScale = new THREE.Vector3(1, 1, 1);
  const instancePosition = new THREE.Vector3();
  const instanceRotation = new THREE.Quaternion();
  const instanceMatrix = new THREE.Matrix4();
  const attachments = pack ? createInstancedAttachments(count, pack) : null;
  if (attachments) group.add(attachments);

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const memberIndices = [];
    for (let index = bucket; index < count; index += bucketCount) memberIndices.push(index);
    const geometry = sourceMesh.geometry.clone();
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');
    geometry.setAttribute('position', new THREE.BufferAttribute(
      animation.records.runShoot.positionFrames[0].slice(),
      3,
    ).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(
      animation.records.runShoot.normalFrames[0].slice(),
      3,
    ).setUsage(THREE.DynamicDrawUsage));
    geometry.computeBoundingSphere();

    const body = new THREE.InstancedMesh(geometry, sourceMaterial, memberIndices.length);
    body.name = `PeacekeeperArmyPhaseBucket${bucket}`;
    body.castShadow = true;
    body.receiveShadow = true;
    body.frustumCulled = false;
    memberIndices.forEach((sourceIndex, instanceIndex) => {
      instancePosition.set(offsets[sourceIndex * 3], 0, offsets[sourceIndex * 3 + 2]);
      instanceRotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaws[sourceIndex]);
      instanceMatrix.compose(instancePosition, instanceRotation, identityScale);
      body.setMatrixAt(instanceIndex, instanceMatrix);
    });
    body.instanceMatrix.needsUpdate = true;
    buckets.push({ body, memberIndices, lastFrame: -1 });
    group.add(body);
  }

  if (rifles) group.add(rifles);
  scene.add(group);

  let currentRecord = animation.records.runShoot;
  let elapsed = 0;

  const setClip = (name) => {
    currentRecord = animation.records[name];
    for (const bucket of buckets) bucket.lastFrame = -1;
    if (rifles) rifles.count = name === 'runShoot' ? count : 0;
  };

  const localBarrel = new THREE.Vector3(0, 0, -1);
  const trigger = new THREE.Vector3();
  const support = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const position = new THREE.Vector3();
  const formationOffset = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const attachmentRootMatrix = new THREE.Matrix4();
  const attachmentDeltaMatrix = new THREE.Matrix4();
  const attachmentWorldMatrix = new THREE.Matrix4();

  const update = (dt) => {
    elapsed = (elapsed + (Number.isFinite(dt) ? dt : 0)) % 3600;
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
      const bucket = buckets[bucketIndex];
      const representative = bucket.memberIndices[0];
      const rawFrame = Math.floor(elapsed * fps * speeds[representative] + phases[representative] * currentRecord.count);
      const frame = ((rawFrame % currentRecord.count) + currentRecord.count) % currentRecord.count;
      if (frame === bucket.lastFrame) continue;
      bucket.body.geometry.getAttribute('position').array.set(currentRecord.positionFrames[frame]);
      bucket.body.geometry.getAttribute('normal').array.set(currentRecord.normalFrames[frame]);
      bucket.body.geometry.getAttribute('position').needsUpdate = true;
      bucket.body.geometry.getAttribute('normal').needsUpdate = true;
      bucket.lastFrame = frame;
    }
    for (let index = 0; index < count; index++) {
      const rawFrame = Math.floor(elapsed * fps * speeds[index] + phases[index] * currentRecord.count);
      const frame = ((rawFrame % currentRecord.count) + currentRecord.count) % currentRecord.count;
      formationOffset.set(offsets[index * 3], 0, offsets[index * 3 + 2]);

      if (attachments) {
        instanceRotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaws[index]);
        attachmentRootMatrix.compose(formationOffset, instanceRotation, identityScale);
        attachmentDeltaMatrix.fromArray(currentRecord.upperBackDeltas[frame]);
        attachmentWorldMatrix.multiplyMatrices(attachmentRootMatrix, attachmentDeltaMatrix);
        attachments.setMatrixAt(index, attachmentWorldMatrix);
      }

      if (!rifles || rifles.count === 0) continue;
      const rightHand = currentRecord.rightHands[frame];
      const leftHand = currentRecord.leftHands[frame];
      if (!rightHand || !leftHand) continue;
      trigger.copy(rightHand);
      support.copy(leftHand);
      rotateY(trigger, yaws[index]).add(formationOffset);
      rotateY(support, yaws[index]).add(formationOffset);
      aim.subVectors(support, trigger);
      if (aim.lengthSq() < 0.0001) continue;
      quaternion.setFromUnitVectors(localBarrel, aim.normalize());
      position.copy(trigger);
      matrix.compose(position, quaternion, scale);
      rifles.setMatrixAt(index, matrix);
    }
    if (attachments) attachments.instanceMatrix.needsUpdate = true;
    if (rifles && rifles.count > 0) rifles.instanceMatrix.needsUpdate = true;
  };

  setClip('runShoot');
  update(0);
  return { group, rifles, attachments, count, setClip, update, animation, bucketCount };
}

function findSkinnedMesh(root) {
  let result = null;
  root.traverse((node) => {
    if (!result && node.isSkinnedMesh) result = node;
  });
  return result;
}

function createInstancedWeapons(count, spec) {
  const geometry = createInfantryWeaponGeometry(spec.kind);
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    emissive: spec.emissive,
    emissiveIntensity: 0.45,
    roughness: 0.46,
    metalness: 0.62,
  });
  const rifles = new THREE.InstancedMesh(geometry, material, count);
  rifles.name = `InfantryArmyInstancedWeapon-${spec.kind}`;
  rifles.castShadow = true;
  rifles.frustumCulled = false;
  return rifles;
}

function createInstancedAttachments(count, spec) {
  const geometry = createInfantryPackGeometry(spec.kind);
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    emissive: spec.emissive,
    emissiveIntensity: 0.34,
    roughness: 0.58,
    metalness: 0.48,
  });
  const attachments = new THREE.InstancedMesh(geometry, material, count);
  attachments.name = `InfantryArmyInstancedAttachment-${spec.kind}`;
  attachments.castShadow = true;
  attachments.frustumCulled = false;
  return attachments;
}

function rotateY(vector, angle) {
  const x = vector.x;
  const z = vector.z;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  vector.x = x * cosine + z * sine;
  vector.z = z * cosine - x * sine;
  return vector;
}
