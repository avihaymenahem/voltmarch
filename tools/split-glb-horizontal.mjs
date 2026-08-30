#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const inputArg = value('--input');
const outputArg = value('--output');
const threshold = Number(value('--threshold'));
const bodyName = value('--body-name') ?? 'body';
const turretName = value('--turret-name') ?? 'turret';
const seal = args.includes('--seal');
const minimalSeal = args.includes('--minimal-seal');
const keepAllTurretComponents = args.includes('--keep-all-turret-components');
const sealAllLoops = args.includes('--seal-all-loops');
const generatedUvArg = value('--generated-uv');
const generatedUv = generatedUvArg === undefined
  ? [0, 0]
  : generatedUvArg.split(',').map(Number);

if (generatedUv.length !== 2 || generatedUv.some((component) => !Number.isFinite(component)
  || component < 0 || component > 1)) {
  throw new Error('--generated-uv must be two normalized coordinates: u,v');
}

if (!inputArg || !outputArg || !Number.isFinite(threshold)) {
  throw new Error(
    'usage: node tools/split-glb-horizontal.mjs --input <source.glb> --output <split.glb> '
    + '--threshold <source-y> [--body-name body] [--turret-name turret] '
    + '[--seal] [--minimal-seal] [--keep-all-turret-components] [--seal-all-loops] '
    + '[--generated-uv u,v]',
  );
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (!fs.existsSync(input)) throw new Error(`input does not exist: ${input}`);
if (input === output) throw new Error('input and output must differ');

async function locateGltfTransformPackage(packageName) {
  const npxRoot = path.join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
  const entries = await fsp.readdir(npxRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(npxRoot, entry.name, 'node_modules', ...packageName.split('/'));
    if (fs.existsSync(path.join(packageRoot, 'package.json'))) return packageRoot;
  }
  throw new Error(
    `${packageName} was not found in the npx cache. Run the asset preparation pipeline once first.`,
  );
}

const coreRoot = await locateGltfTransformPackage('@gltf-transform/core');
const functionsRoot = await locateGltfTransformPackage('@gltf-transform/functions');
const { Accessor, NodeIO } = await import(pathToFileURL(path.join(coreRoot, 'dist', 'index.js')));
const { prune } = await import(pathToFileURL(path.join(functionsRoot, 'dist', 'index.js')));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Earcut } = await import(pathToFileURL(
  path.join(repositoryRoot, 'node_modules', 'three', 'src', 'extras', 'Earcut.js'),
));

const io = new NodeIO();
const document = await io.read(input);
const root = document.getRoot();
const sourceNodes = root.listNodes().filter((node) => node.getMesh());
if (sourceNodes.length !== 1) {
  throw new Error(`expected one source mesh node, found ${sourceNodes.length}`);
}

const sourceNode = sourceNodes[0];
const sourceMesh = sourceNode.getMesh();
const primitives = sourceMesh.listPrimitives();
if (primitives.length !== 1) {
  throw new Error(`expected one source primitive, found ${primitives.length}`);
}

const sourcePrimitive = primitives[0];
const position = sourcePrimitive.getAttribute('POSITION');
const sourceIndices = sourcePrimitive.getIndices();
if (!position || !sourceIndices) throw new Error('source primitive must contain POSITION and indices');

const positionArray = position.getArray();
const indexArray = sourceIndices.getArray();
if (!positionArray || !indexArray || indexArray.length % 3 !== 0) {
  throw new Error('source primitive does not contain an indexed triangle list');
}

const semantics = sourcePrimitive.listSemantics();
const attributes = new Map(semantics.map((semantic) => {
  const accessor = sourcePrimitive.getAttribute(semantic);
  return [semantic, {
    accessor,
    array: accessor.getArray(),
    size: accessor.getElementSize(),
  }];
}));

function sourceVertex(index) {
  const values = new Map();
  for (const [semantic, attribute] of attributes) {
    const start = index * attribute.size;
    values.set(semantic, Array.from(attribute.array.subarray(start, start + attribute.size)));
  }
  return values;
}

function interpolateVertex(a, b, t) {
  const result = new Map();
  for (const semantic of semantics) {
    const av = a.get(semantic);
    const bv = b.get(semantic);
    const values = av.map((component, index) => component + (bv[index] - component) * t);
    if (semantic === 'NORMAL') {
      const length = Math.hypot(...values) || 1;
      for (let index = 0; index < values.length; index++) values[index] /= length;
    }
    result.set(semantic, values);
  }
  return result;
}

function vertexY(vertex) {
  return vertex.get('POSITION')[1];
}

function intersection(a, b) {
  const ay = vertexY(a);
  const by = vertexY(b);
  const denominator = by - ay;
  const t = Math.abs(denominator) < 1e-12 ? 0.5 : (threshold - ay) / denominator;
  const result = interpolateVertex(a, b, Math.max(0, Math.min(1, t)));
  result.get('POSITION')[1] = threshold;
  return result;
}

function clipPolygon(vertices, keepBelow) {
  const output = [];
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index];
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const currentInside = keepBelow ? vertexY(current) <= threshold : vertexY(current) >= threshold;
    const previousInside = keepBelow ? vertexY(previous) <= threshold : vertexY(previous) >= threshold;
    if (currentInside !== previousInside) output.push(intersection(previous, current));
    if (currentInside) output.push(current);
  }
  return output;
}

function createBuilder(name) {
  const arrays = new Map(semantics.map((semantic) => [semantic, []]));
  const indices = [];
  const polygons = [];
  const addVertex = (vertex) => {
    const index = arrays.get('POSITION').length / attributes.get('POSITION').size;
    for (const semantic of semantics) arrays.get(semantic).push(...vertex.get(semantic));
    return index;
  };
  const addPolygon = (polygon) => {
    if (polygon.length >= 3) polygons.push(polygon);
  };
  const materialize = () => {
    for (const polygon of polygons) {
    const local = polygon.map(addVertex);
    for (let index = 1; index + 1 < local.length; index++) {
      indices.push(local[0], local[index], local[index + 1]);
    }
    }
  };
  return { name, arrays, indices, polygons, addPolygon, addVertex, materialize };
}

const body = createBuilder(bodyName);
const turret = createBuilder(turretName);
const cutSegments = [];
for (let index = 0; index < indexArray.length; index += 3) {
  const triangle = [
    sourceVertex(indexArray[index]),
    sourceVertex(indexArray[index + 1]),
    sourceVertex(indexArray[index + 2]),
  ];
  body.addPolygon(clipPolygon(triangle, true));
  turret.addPolygon(clipPolygon(triangle, false));

  const crossings = [];
  for (let edge = 0; edge < 3; edge++) {
    const a = triangle[edge];
    const b = triangle[(edge + 1) % 3];
    if ((vertexY(a) < threshold && vertexY(b) > threshold)
      || (vertexY(a) > threshold && vertexY(b) < threshold)) {
      crossings.push(intersection(a, b).get('POSITION'));
    }
  }
  if (crossings.length === 2) cutSegments.push(crossings);
}

function quantizedKey(point) {
  const epsilon = 1e-5;
  return `${Math.round(point[0] / epsilon)},${Math.round(point[2] / epsilon)}`;
}

function boundaryLoops(segments) {
  const points = new Map();
  const adjacency = new Map();
  const add = (point) => {
    const key = quantizedKey(point);
    if (!points.has(key)) points.set(key, point);
    if (!adjacency.has(key)) adjacency.set(key, new Set());
    return key;
  };
  for (const [a, b] of segments) {
    const ak = add(a);
    const bk = add(b);
    if (ak === bk) continue;
    adjacency.get(ak).add(bk);
    adjacency.get(bk).add(ak);
  }

  const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const used = new Set();
  const loops = [];
  for (const [start, neighbours] of adjacency) {
    for (const first of neighbours) {
      if (used.has(edgeKey(start, first))) continue;
      const loop = [start];
      let previous = start;
      let current = first;
      used.add(edgeKey(start, first));
      for (let guard = 0; guard < adjacency.size * 2; guard++) {
        loop.push(current);
        if (current === start) break;
        const next = [...(adjacency.get(current) ?? [])]
          .find((candidate) => candidate !== previous && !used.has(edgeKey(current, candidate)));
        if (next === undefined) break;
        used.add(edgeKey(current, next));
        previous = current;
        current = next;
      }
      if (loop.length >= 4 && loop.at(-1) === start) {
        loop.pop();
        loops.push(loop.map((key) => points.get(key)));
      }
    }
  }
  return loops;
}

function signedArea(loop) {
  let area = 0;
  for (let index = 0; index < loop.length; index++) {
    const a = loop[index];
    const b = loop[(index + 1) % loop.length];
    area += a[0] * b[2] - b[0] * a[2];
  }
  return area * 0.5;
}

function keepPrimaryTurretComponent() {
  const parent = turret.polygons.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a, b) => {
    const ar = find(a);
    const br = find(b);
    if (ar !== br) parent[br] = ar;
  };
  const owners = new Map();
  const positionKey = (vertex) => {
    const point = vertex.get('POSITION');
    const epsilon = 1e-5;
    return `${Math.round(point[0] / epsilon)},${Math.round(point[1] / epsilon)},${Math.round(point[2] / epsilon)}`;
  };
  turret.polygons.forEach((polygon, polygonIndex) => {
    for (const vertex of polygon) {
      const key = positionKey(vertex);
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, polygonIndex);
      else union(owner, polygonIndex);
    }
  });

  const groups = new Map();
  turret.polygons.forEach((polygon, polygonIndex) => {
    const rootIndex = find(polygonIndex);
    const group = groups.get(rootIndex) ?? { polygons: [], cutVertices: new Set() };
    group.polygons.push(polygon);
    for (const vertex of polygon) {
      if (Math.abs(vertexY(vertex) - threshold) <= 1e-5) group.cutVertices.add(positionKey(vertex));
    }
    groups.set(rootIndex, group);
  });
  const ranked = [...groups.values()].sort((a, b) => {
    if (b.cutVertices.size !== a.cutVertices.size) return b.cutVertices.size - a.cutVertices.size;
    return b.polygons.length - a.polygons.length;
  });
  if (ranked.length === 0) throw new Error(`threshold ${threshold} produced no turret components`);
  const primary = ranked[0];
  const rejected = ranked.slice(1).flatMap((group) => group.polygons);
  turret.polygons.length = 0;
  turret.polygons.push(...primary.polygons);
  body.polygons.push(...rejected);
  return {
    componentCount: ranked.length,
    primaryPolygons: primary.polygons.length,
    primaryCutVertices: primary.cutVertices.size,
    rejectedPolygons: rejected.length,
  };
}

function duplicateCentralDeckShell(builder, loop, minY, maxY) {
  const paddingX = 0.16;
  const paddingZ = 0.13;
  const minX = Math.min(...loop.map((point) => point[0])) - paddingX;
  const maxX = Math.max(...loop.map((point) => point[0])) + paddingX;
  const minZ = Math.min(...loop.map((point) => point[2])) - paddingZ;
  const maxZ = Math.max(...loop.map((point) => point[2])) + paddingZ;
  const sourcePolygons = [...builder.polygons];
  let triangles = 0;
  for (const polygon of sourcePolygons) {
    const centre = polygon.reduce((sum, vertex) => {
      const point = vertex.get('POSITION');
      return [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]];
    }, [0, 0, 0]).map((component) => component / polygon.length);
    if (centre[0] < minX || centre[0] > maxX || centre[2] < minZ || centre[2] > maxZ
      || centre[1] < minY || centre[1] > maxY) continue;
    const reversed = [...polygon].reverse().map((vertex) => {
      const clone = new Map([...vertex].map(([semantic, values]) => [semantic, [...values]]));
      const normal = clone.get('NORMAL');
      if (normal !== undefined) {
        normal[0] *= -1;
        normal[1] *= -1;
        normal[2] *= -1;
      }
      return clone;
    });
    builder.polygons.push(reversed);
    triangles += Math.max(0, reversed.length - 2);
  }
  return { minX, maxX, minZ, maxZ, minY, maxY, triangles };
}

function generatedVertex(point, normal) {
  const vertex = new Map();
  for (const semantic of semantics) {
    const size = attributes.get(semantic).size;
    const values = new Array(size).fill(0);
    if (semantic === 'POSITION') values.splice(0, 3, point[0], point[1] ?? threshold, point[2]);
    if (semantic === 'NORMAL') values.splice(0, 3, normal[0], normal[1], normal[2]);
    if (semantic === 'TANGENT') values.splice(0, 4, 1, 0, 0, 1);
    if (semantic === 'TEXCOORD_0') values.splice(0, 2, generatedUv[0], generatedUv[1]);
    vertex.set(semantic, values);
  }
  return vertex;
}

function capVertex(point, normalY) {
  return generatedVertex(point, [0, normalY, 0]);
}

function addSealedTriangle(builder, a, b, c) {
  builder.indices.push(a, b, c);
  // Raw generations sometimes have inconsistent winding around a torn cut,
  // so the defensive mode keeps a geometric backface. The minimal path is for
  // validated topology: body and turret receive correctly opposed caps, and
  // duplicating them only wastes triangles and creates z-fighting.
  if (!minimalSeal) builder.indices.push(a, c, b);
}

function addEllipticCollarCap(builder, loop, normalY, y, padding = 0.035) {
  const minX = Math.min(...loop.map((point) => point[0]));
  const maxX = Math.max(...loop.map((point) => point[0]));
  const minZ = Math.min(...loop.map((point) => point[2]));
  const maxZ = Math.max(...loop.map((point) => point[2]));
  const centreX = (minX + maxX) * 0.5;
  const centreZ = (minZ + maxZ) * 0.5;
  const radiusX = (maxX - minX) * 0.5 + padding;
  const radiusZ = (maxZ - minZ) * 0.5 + padding;
  const segments = 24;
  const centreIndex = builder.addVertex(capVertex([centreX, y, centreZ], normalY));
  const ring = [];
  for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2;
    ring.push(builder.addVertex(capVertex([
      centreX + Math.cos(angle) * radiusX,
      y,
      centreZ + Math.sin(angle) * radiusZ,
    ], normalY)));
  }
  for (let index = 0; index < segments; index++) {
    const next = ring[(index + 1) % segments];
    if (normalY > 0) addSealedTriangle(builder, centreIndex, next, ring[index]);
    else addSealedTriangle(builder, centreIndex, ring[index], next);
  }
  return { centreX, centreZ, radiusX, radiusZ, segments };
}

function addEllipticCollarWall(builder, collar, bottomY, topY) {
  const bottom = [];
  const top = [];
  for (let index = 0; index < collar.segments; index++) {
    const angle = index / collar.segments * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const normalLength = Math.hypot(cosine / collar.radiusX, sine / collar.radiusZ) || 1;
    const normal = [
      cosine / collar.radiusX / normalLength,
      0,
      sine / collar.radiusZ / normalLength,
    ];
    const x = collar.centreX + cosine * collar.radiusX;
    const z = collar.centreZ + sine * collar.radiusZ;
    bottom.push(builder.addVertex(generatedVertex([x, bottomY, z], normal)));
    top.push(builder.addVertex(generatedVertex([x, topY, z], normal)));
  }
  for (let index = 0; index < collar.segments; index++) {
    const next = (index + 1) % collar.segments;
    addSealedTriangle(builder, bottom[index], bottom[next], top[index]);
    addSealedTriangle(builder, bottom[next], top[next], top[index]);
  }
  return { bottomY, topY, triangles: collar.segments * 2 };
}

function addArmoredDeckPlate(builder, loop, y) {
  const paddingX = 0.16;
  const paddingZ = 0.13;
  const minX = Math.min(...loop.map((point) => point[0])) - paddingX;
  const maxX = Math.max(...loop.map((point) => point[0])) + paddingX;
  const minZ = Math.min(...loop.map((point) => point[2])) - paddingZ;
  const maxZ = Math.max(...loop.map((point) => point[2])) + paddingZ;
  const vertices = [
    [minX, y, minZ],
    [maxX, y, minZ],
    [maxX, y, maxZ],
    [minX, y, maxZ],
  ].map((point) => builder.addVertex(generatedVertex(point, [0, 1, 0])));
  addSealedTriangle(builder, vertices[0], vertices[1], vertices[2]);
  addSealedTriangle(builder, vertices[0], vertices[2], vertices[3]);
  return { minX, maxX, minZ, maxZ, y, triangles: 2 };
}

function addCap(builder, loop, normalY) {
  const ordered = signedArea(loop) < 0 ? [...loop].reverse() : loop;
  const ring = ordered.map((point) => builder.addVertex(capVertex(point, normalY)));
  const faces = Earcut.triangulate(ordered.flatMap((point) => [point[0], point[2]]), null, 2);
  for (let index = 0; index < faces.length; index += 3) {
    const a = ordered[faces[index]];
    const b = ordered[faces[index + 1]];
    const c = ordered[faces[index + 2]];
    const crossY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const ia = ring[faces[index]];
    const ib = ring[faces[index + 1]];
    const ic = ring[faces[index + 2]];
    if (Math.sign(crossY) === Math.sign(normalY)) addSealedTriangle(builder, ia, ib, ic);
    else addSealedTriangle(builder, ia, ic, ib);
  }
}

// Some approved moving assemblies intentionally contain detached gun tubes,
// vanes, optics, or antenna hardware above the articulation plane. Preserve
// every above-plane component for those assets instead of incorrectly moving
// the detached pieces back into the static body.
const componentSelection = keepAllTurretComponents
  ? {
      componentCount: null,
      primaryPolygons: turret.polygons.length,
      primaryCutVertices: null,
      rejectedPolygons: 0,
      mode: 'all-above-threshold',
    }
  : keepPrimaryTurretComponent();
const loops = seal ? boundaryLoops(cutSegments) : [];
if (seal && loops.length === 0) throw new Error(`threshold ${threshold} produced no closed cut loops`);
const rankedLoops = [...loops].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
const loopsToSeal = seal ? (sealAllLoops ? rankedLoops : rankedLoops.slice(0, 1)) : [];
// The broad defensive shell and rectangular deck plate are useful for raw
// generations whose lower turret is full of holes. Retextured/retopologized
// assets already have a coherent deck; duplicating that broad footprint makes
// a visible "wing" when the turret rotates. Minimal sealing keeps only the
// exact cut cap and a tight hidden collar around the ring.
const duplicatedDeckShell = loopsToSeal.length === 1 && !minimalSeal ? {
  body: duplicateCentralDeckShell(body, loopsToSeal[0], threshold - 0.055, threshold + 0.075),
  turret: duplicateCentralDeckShell(turret, loopsToSeal[0], threshold, threshold + 0.12),
} : null;
body.materialize();
turret.materialize();
for (const loop of loopsToSeal) {
  addCap(body, loop, 1);
  addCap(turret, loop, -1);
}
// Multi-prong energy heads can cross the articulation plane in several closed
// loops. Cap each opening, then span their combined footprint with one hidden
// collar so rotation never reveals daylight between the moving prongs.
const collarLoop = loopsToSeal.length === 0 ? null : loopsToSeal.flat();
const collar = collarLoop !== null ? {
  body: addEllipticCollarCap(body, collarLoop, 1, threshold + 0.001, minimalSeal ? 0.012 : 0.035),
  turret: addEllipticCollarCap(turret, collarLoop, -1, threshold + 0.003, minimalSeal ? 0.012 : 0.035),
} : null;
if (collar !== null) {
  collar.wall = addEllipticCollarWall(turret, collar.turret, threshold + 0.001, threshold + 0.055);
  collar.deckPlate = minimalSeal ? null : addArmoredDeckPlate(body, loopsToSeal[0], threshold + 0.006);
}

function buildPrimitive(builder) {
  if (builder.indices.length === 0) throw new Error(`${builder.name} contains no triangles`);
  const primitive = document.createPrimitive().setMode(sourcePrimitive.getMode());
  const material = sourcePrimitive.getMaterial();
  if (material) {
    material.setDoubleSided(false);
    primitive.setMaterial(material);
  }
  for (const semantic of semantics) {
    const source = attributes.get(semantic).accessor;
    primitive.setAttribute(semantic, document.createAccessor(`${builder.name}_${semantic.toLowerCase()}`)
      .setType(source.getType())
      .setNormalized(false)
      .setArray(new Float32Array(builder.arrays.get(semantic)))
      .setBuffer(root.listBuffers()[0]));
  }
  const vertexCount = builder.arrays.get('POSITION').length / attributes.get('POSITION').size;
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  primitive.setIndices(document.createAccessor(`${builder.name}_indices`)
    .setType(Accessor.Type.SCALAR)
    .setArray(new IndexArray(builder.indices))
    .setBuffer(root.listBuffers()[0]));
  return primitive;
}

const bodyPrimitive = buildPrimitive(body);
const turretPrimitive = buildPrimitive(turret);
const bodyMesh = document.createMesh(bodyName).addPrimitive(bodyPrimitive);
const turretMesh = document.createMesh(turretName).addPrimitive(turretPrimitive);
const bodyNode = document.createNode(bodyName).setMesh(bodyMesh).setMatrix(sourceNode.getMatrix());
const turretNode = document.createNode(turretName).setMesh(turretMesh).setMatrix(sourceNode.getMatrix());

for (const scene of root.listScenes()) {
  if (scene.listChildren().includes(sourceNode)) {
    scene.removeChild(sourceNode).addChild(bodyNode).addChild(turretNode);
  }
}

await document.transform(prune());
await fsp.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);

console.log(JSON.stringify({
  input,
  output,
  sourceMatrix: sourceNode.getMatrix(),
  threshold,
  sealed: seal,
  sealAllLoops,
  minimalSeal,
  generatedUv,
  sealedLoops: loops.length,
  sealedPrimaryLoops: loopsToSeal.length,
  duplicatedDeckShell,
  collar,
  componentSelection,
  sealedLoopBounds: loops.map((loop) => ({
    minX: Math.min(...loop.map((point) => point[0])),
    maxX: Math.max(...loop.map((point) => point[0])),
    minZ: Math.min(...loop.map((point) => point[2])),
    maxZ: Math.max(...loop.map((point) => point[2])),
    centreX: loop.reduce((sum, point) => sum + point[0], 0) / loop.length,
    centreZ: loop.reduce((sum, point) => sum + point[2], 0) / loop.length,
    vertices: loop.length,
  })),
  cutSegments: cutSegments.length,
  bodyTriangles: body.indices.length / 3,
  turretTriangles: turret.indices.length / 3,
  totalTriangles: (body.indices.length + turret.indices.length) / 3,
}, null, 2));
