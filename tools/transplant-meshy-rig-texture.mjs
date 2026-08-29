#!/usr/bin/env node

import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [texturedPath, ...pairs] = process.argv.slice(2);

if (!texturedPath || pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error('Usage: node tools/transplant-meshy-rig-texture.mjs <textured.glb> <rigged-in.glb> <rigged-out.glb> [...]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const textured = await io.read(texturedPath);
const texturedPrimitive = singlePrimitive(textured, 'textured Meshy result');
const texturedMaterial = texturedPrimitive.getMaterial();

if (!texturedMaterial?.getBaseColorTexture() || !texturedMaterial.getNormalTexture()) {
  throw new Error('Textured source must contain at least base-color and normal textures.');
}

for (let i = 0; i < pairs.length; i += 2) {
  const inputPath = pairs[i];
  const outputPath = pairs[i + 1];
  const rigged = await io.read(inputPath);
  const riggedPrimitive = singlePrimitive(rigged, path.basename(inputPath));

  if (rigged.getRoot().listSkins().length !== 1 || rigged.getRoot().listAnimations().length < 1) {
    throw new Error(`${inputPath} is missing its skin or animation.`);
  }

  transplantGeometry(rigged, riggedPrimitive, texturedPrimitive);
  riggedPrimitive.setMaterial(copyMaterial(rigged, texturedMaterial));
  await io.write(outputPath, rigged);

  const output = await io.read(outputPath);
  const outputPrimitive = singlePrimitive(output, path.basename(outputPath));
  const skinCount = output.getRoot().listSkins().length;
  const animationCount = output.getRoot().listAnimations().length;
  const textureCount = output.getRoot().listTextures().length;
  if (skinCount !== 1 || animationCount < 1 || textureCount < 3) {
    throw new Error(`Post-write validation failed for ${outputPath}: ${skinCount} skin, ${animationCount} animation, ${textureCount} textures.`);
  }

  console.log(JSON.stringify({
    input: inputPath,
    output: outputPath,
    vertices: outputPrimitive.getAttribute('POSITION').getCount(),
    triangles: outputPrimitive.getIndices().getCount() / 3,
    skins: skinCount,
    animations: animationCount,
    textures: textureCount,
  }));
}

function singlePrimitive(document, label) {
  const meshes = document.getRoot().listMeshes();
  if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) {
    throw new Error(`${label} must contain exactly one mesh primitive.`);
  }
  return meshes[0].listPrimitives()[0];
}

function transplantGeometry(document, riggedPrimitive, texturedPrimitive) {
  const riggedPosition = requiredAttribute(riggedPrimitive, 'POSITION');
  const texturedPosition = requiredAttribute(texturedPrimitive, 'POSITION');
  const riggedJoints = requiredAttribute(riggedPrimitive, 'JOINTS_0');
  const riggedWeights = requiredAttribute(riggedPrimitive, 'WEIGHTS_0');
  const texturedIndices = texturedPrimitive.getIndices();
  if (!texturedIndices) throw new Error('Textured primitive is not indexed.');

  const sourceMin = riggedPosition.getMin([]);
  const sourceMax = riggedPosition.getMax([]);
  const targetMin = texturedPosition.getMin([]);
  const targetMax = texturedPosition.getMax([]);
  const sourceCenter = sourceMin.map((value, axis) => (value + sourceMax[axis]) / 2);
  const targetCenter = targetMin.map((value, axis) => (value + targetMax[axis]) / 2);
  const scale = (sourceMax[1] - sourceMin[1]) / (targetMax[1] - targetMin[1]);

  const sourcePositions = riggedPosition.getArray();
  const targetPositions = texturedPosition.getArray();
  const mappedPositions = new Float32Array(targetPositions.length);
  for (let vertex = 0; vertex < targetPositions.length / 3; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      mappedPositions[vertex * 3 + axis] =
        (targetPositions[vertex * 3 + axis] - targetCenter[axis]) * scale + sourceCenter[axis];
    }
  }

  const nearest = mapNearestVertices(sourcePositions, mappedPositions);
  const sourceJoints = riggedJoints.getArray();
  const sourceWeights = riggedWeights.getArray();
  const joints = new sourceJoints.constructor(nearest.length * riggedJoints.getElementSize());
  const weights = new sourceWeights.constructor(nearest.length * riggedWeights.getElementSize());
  for (let vertex = 0; vertex < nearest.length; vertex += 1) {
    const sourceVertex = nearest[vertex];
    for (let component = 0; component < 4; component += 1) {
      joints[vertex * 4 + component] = sourceJoints[sourceVertex * 4 + component];
      weights[vertex * 4 + component] = sourceWeights[sourceVertex * 4 + component];
    }
  }

  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer('buffer');
  const createAccessor = (name, source, array) => document
    .createAccessor(name)
    .setType(source.getType())
    .setArray(array)
    .setBuffer(buffer);

  riggedPrimitive
    .setAttribute('POSITION', createAccessor('textured_position', texturedPosition, mappedPositions))
    .setAttribute('NORMAL', createAccessor('textured_normal', requiredAttribute(texturedPrimitive, 'NORMAL'), cloneArray(requiredAttribute(texturedPrimitive, 'NORMAL').getArray())))
    .setAttribute('TANGENT', createAccessor('textured_tangent', requiredAttribute(texturedPrimitive, 'TANGENT'), cloneArray(requiredAttribute(texturedPrimitive, 'TANGENT').getArray())))
    .setAttribute('TEXCOORD_0', createAccessor('textured_uv', requiredAttribute(texturedPrimitive, 'TEXCOORD_0'), cloneArray(requiredAttribute(texturedPrimitive, 'TEXCOORD_0').getArray())))
    .setAttribute('JOINTS_0', createAccessor('mapped_joints', riggedJoints, joints))
    .setAttribute('WEIGHTS_0', createAccessor('mapped_weights', riggedWeights, weights))
    .setIndices(createAccessor('textured_indices', texturedIndices, cloneArray(texturedIndices.getArray())));
}

function mapNearestVertices(sourcePositions, targetPositions) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let offset = 1; offset < sourcePositions.length; offset += 3) {
    minY = Math.min(minY, sourcePositions[offset]);
    maxY = Math.max(maxY, sourcePositions[offset]);
  }
  const sourceHeight = Math.max(maxY - minY, 0.001);
  // Retexture may rebuild the UV seam topology and move its sampled surface by
  // a few millimetres. Keep the lookup proportional to the character instead
  // of assuming the micron-identical topology returned by older Meshy jobs.
  // The hard 0.5% height ceiling remains fail-closed and is reported below.
  // It permits a deliberately cheap remesh to borrow the matching production
  // skeleton while rejecting materially different topology.
  const maxDistance = sourceHeight * 0.005;
  const cellSize = maxDistance;
  const cells = new Map();
  const cellKey = (x, y, z) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;

  for (let vertex = 0; vertex < sourcePositions.length / 3; vertex += 1) {
    const offset = vertex * 3;
    const key = cellKey(sourcePositions[offset], sourcePositions[offset + 1], sourcePositions[offset + 2]);
    const list = cells.get(key) ?? [];
    list.push(vertex);
    cells.set(key, list);
  }

  const mapping = new Uint32Array(targetPositions.length / 3);
  let greatestDistance = 0;
  for (let vertex = 0; vertex < mapping.length; vertex += 1) {
    const offset = vertex * 3;
    const x = targetPositions[offset];
    const y = targetPositions[offset + 1];
    const z = targetPositions[offset + 2];
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const cellZ = Math.floor(z / cellSize);
    let closestVertex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const candidate of cells.get(`${cellX + dx},${cellY + dy},${cellZ + dz}`) ?? []) {
            const candidateOffset = candidate * 3;
            const distance = Math.hypot(
              x - sourcePositions[candidateOffset],
              y - sourcePositions[candidateOffset + 1],
              z - sourcePositions[candidateOffset + 2],
            );
            if (distance < closestDistance) {
              closestDistance = distance;
              closestVertex = candidate;
            }
          }
        }
      }
    }

    if (closestVertex < 0 || closestDistance > maxDistance) {
      throw new Error(
        `Texture geometry changed at vertex ${vertex}; nearest rig vertex is ${closestDistance}m away `
        + `(limit ${maxDistance}m).`,
      );
    }
    mapping[vertex] = closestVertex;
    greatestDistance = Math.max(greatestDistance, closestDistance);
  }

  console.log(`Validated ${mapping.length} textured vertices against the original rig (max delta ${greatestDistance.toExponential(3)}m).`);
  return mapping;
}

function copyMaterial(document, source) {
  const copiedTextures = new Map();
  const copyTexture = (texture) => {
    if (!texture) return null;
    if (copiedTextures.has(texture)) return copiedTextures.get(texture);
    const copy = document
      .createTexture(texture.getName())
      .setImage(texture.getImage())
      .setMimeType(texture.getMimeType());
    copiedTextures.set(texture, copy);
    return copy;
  };

  return document
    .createMaterial('VOLTMARCH Infantry PBR')
    .setBaseColorFactor(source.getBaseColorFactor())
    .setBaseColorTexture(copyTexture(source.getBaseColorTexture()))
    .setMetallicFactor(source.getMetallicFactor())
    .setRoughnessFactor(source.getRoughnessFactor())
    .setMetallicRoughnessTexture(copyTexture(source.getMetallicRoughnessTexture()))
    .setNormalTexture(copyTexture(source.getNormalTexture()))
    .setNormalScale(source.getNormalScale())
    .setDoubleSided(source.getDoubleSided())
    .setAlphaMode(source.getAlphaMode())
    .setAlphaCutoff(source.getAlphaCutoff());
}

function requiredAttribute(primitive, semantic) {
  const attribute = primitive.getAttribute(semantic);
  if (!attribute) throw new Error(`Primitive is missing ${semantic}.`);
  return attribute;
}

function cloneArray(array) {
  return new array.constructor(array);
}
