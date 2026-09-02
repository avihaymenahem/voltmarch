import * as THREE from 'three';
import { prepareFamily } from 'poc:kernel';
export { prepareFamily };

export const spec = {
  key: 'allied_harvester', label: 'Allied Chrono Miner', hullName: 'Hull',
  url: 'app://vm-poc/asset/lod0', target: [4, 3.3, 8.6], yawDeg: 90,
  lods: [{ url: 'app://vm-poc/asset/lod1', minDistance: 46 }, { url: 'app://vm-poc/asset/lod2', minDistance: 76 }],
  shadowUrl: 'app://vm-poc/asset/shadow',
};
export const model = { turretPivot: [0, 0, 0] };

export function packGeometry(geometry, copy = false) {
  const arrays = new Map();
  const copyArray = (array) => {
    if (!copy) return array;
    if (!arrays.has(array)) arrays.set(array, array.slice());
    return arrays.get(array);
  };
  const attribute = (a) => a.isInterleavedBufferAttribute
    ? { array: copyArray(a.data.array), itemSize: a.itemSize, normalized: a.normalized, stride: a.data.stride, offset: a.offset }
    : { array: copyArray(a.array), itemSize: a.itemSize, normalized: a.normalized };
  return {
    name: geometry.name,
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, a]) => [name, attribute(a)])),
    index: geometry.index ? attribute(geometry.index) : null,
    groups: geometry.groups.map(g => ({ ...g })),
    drawRange: { ...geometry.drawRange },
    box: geometry.boundingBox ? [geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray()] : null,
    sphere: geometry.boundingSphere ? [geometry.boundingSphere.center.toArray(), geometry.boundingSphere.radius] : null,
  };
}

export function unpackGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  const buffers = new Map();
  const attribute = (a) => {
    if (a.stride !== undefined) {
      if (!buffers.has(a.array)) buffers.set(a.array, new THREE.InterleavedBuffer(a.array, a.stride));
      return new THREE.InterleavedBufferAttribute(buffers.get(a.array), a.itemSize, a.offset, a.normalized);
    }
    return new THREE.BufferAttribute(a.array, a.itemSize, a.normalized);
  };
  for (const [name, a] of Object.entries(data.attributes)) geometry.setAttribute(name, attribute(a));
  if (data.index) geometry.setIndex(attribute(data.index));
  geometry.name = data.name;
  geometry.groups = data.groups.map(g => ({ ...g }));
  geometry.drawRange = { ...data.drawRange };
  if (data.box) geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...data.box[0]), new THREE.Vector3(...data.box[1]));
  if (data.sphere) geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...data.sphere[0]), data.sphere[1]);
  return geometry;
}

export function packLoaded(loaded) {
  return loaded.map(({ scene }, i) => {
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse(object => { if (object.isMesh) meshes.push(object); });
    if (meshes.length !== 1 || (i < 3 && meshes[0].name !== 'Hull')) {
      throw new Error('POC scope requires exactly one Hull primitive (plus one shadow primitive).');
    }
    const mesh = meshes[0];
    if (Array.isArray(mesh.material) || mesh.isSkinnedMesh || Object.keys(mesh.geometry.morphAttributes).length) {
      throw new Error('POC excludes material arrays, skinning and morphs.');
    }
    return { geometry: packGeometry(mesh.geometry, true), name: mesh.name, material: mesh.material.name, matrix: mesh.matrixWorld.toArray() };
  });
}

export function unpackLoaded(payload) {
  if (!Array.isArray(payload) || payload.length !== 4 || bufferBytes(payload) > 32 * 1024 * 1024) {
    throw new Error('Invalid/oversized POC family payload.');
  }
  return payload.map(data => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    material.name = data.material;
    const mesh = new THREE.Mesh(unpackGeometry(data.geometry), material);
    mesh.name = data.name;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(data.matrix);
    scene.add(mesh);
    return { scene };
  });
}

export function buffersOf(value) {
  const buffers = new Set();
  const visit = (v) => {
    if (ArrayBuffer.isView(v)) buffers.add(v.buffer);
    else if (v instanceof ArrayBuffer) buffers.add(v);
    else if (v && typeof v === 'object') for (const child of Object.values(v)) visit(child);
  };
  visit(value);
  return [...buffers];
}
export const bufferBytes = (v) => buffersOf(v).reduce((sum, b) => sum + b.byteLength, 0);

export async function runJob(payload) {
  const start = performance.now();
  const loaded = unpackLoaded(payload);
  const unpackMs = performance.now() - start;
  try {
    const t = performance.now();
    const result = await prepareFamily(loaded, spec, model);
    const computeMs = performance.now() - t;
    const packed = result.map(g => packGeometry(g));
    result.forEach(g => g.dispose());
    return { packed, unpackMs, computeMs, workerTotalMs: performance.now() - start };
  } finally {
    for (const { scene } of loaded) scene.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
  }
}
