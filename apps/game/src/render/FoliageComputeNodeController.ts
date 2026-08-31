/**
 * WebGPU-only render presentation for the bounded tree/bush foliage pilot.
 *
 * This module is reachable only through `gpu-path-install.ts`. The main/WebGL
 * graph sees structural interfaces in `gpu-path.ts`, never `three/webgpu` or
 * `three/tsl`.
 *
 * CPU Scatter placement, clearing and save identity remain authoritative. The
 * GPU receives immutable chunk-sorted source columns once; a clear changes one
 * uint live flag. Two ordered dispatches reset indexed-indirect counts and then
 * compact visible colour/shadow streams. There is no steady-state readback.
 */

import * as THREE from 'three';
import {
  IndirectStorageBufferAttribute,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from 'three/webgpu';
import {
  Fn, If, Loop, and, atomicAdd, atomicStore, dot, float,
  instanceIndex, storage, struct, uint, uniform,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

import { SHADOW_ONLY_TAG } from './shadow-only';

/*
 * Keep this node-bundle leaf structurally typed. Importing even types from
 * gpu-path.ts adds the controller to the renderer's frozen dependency SCC in
 * the repository architecture scan; gpu-path-install.ts checks the public
 * NodePath assignment against the matching exported interfaces.
 */
type FoliageComputePass = 'lod0' | 'lod1' | 'lod2' | 'shadow';

interface FoliageComputeDeliverySpec {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly triangles: number;
}

interface FoliageComputeBatchSpec {
  readonly key: string;
  readonly matrices: Float32Array;
  readonly colours: Float32Array;
  readonly phases: Float32Array;
  readonly stableIds: Uint32Array;
  readonly live: Uint32Array;
  readonly chunkRanges: Uint32Array;
  readonly colour: readonly FoliageComputeDeliverySpec[];
  readonly shadow: FoliageComputeDeliverySpec | null;
}

interface FoliageComputeSpec {
  readonly batches: readonly FoliageComputeBatchSpec[];
  readonly chunkMins: Float32Array;
  readonly chunkMaxs: Float32Array;
  readonly chunkCount: number;
  readonly lod1Metres: number;
  readonly lod2Metres: number;
  readonly transitionBandMetres: number;
  readonly windPhaseAttribute: string;
}

interface FoliageComputeAuditCommand {
  readonly key: string;
  readonly pass: FoliageComputePass;
  readonly indexCount: number;
  readonly instanceCount: number;
  readonly firstIndex: number;
  readonly baseVertex: number;
  readonly firstInstance: number;
  readonly capacity: number;
  readonly triangles: number;
  readonly stableIds: readonly number[];
}

interface FoliageComputeAudit {
  readonly commands: readonly FoliageComputeAuditCommand[];
  readonly visibleInstances: number;
  readonly visibleLod0: number;
  readonly visibleLod1: number;
  readonly visibleLod2: number;
  readonly visibleTriangles: number;
  readonly visibleShadowTriangles: number;
}

interface FoliageComputeControllerLike {
  readonly objects: readonly THREE.Object3D[];
  readonly colourDraws: number;
  readonly shadowDraws: number;
  readonly initialUploadBytes: number;
  readonly storageBytes: number;
  readonly dispatchesPerUpdate: number;
  readonly sourceInstances: number;
  readonly lastSubmitMs: number;
  readonly lastCpuUploadBytes: number;
  readonly dispatches: number;
  update(camera: THREE.Camera, dirty: boolean, visibleChunks?: Uint8Array): void;
  setLive(key: string, sourceIndex: number, live: boolean): void;
  audit(): Promise<FoliageComputeAudit>;
  dispose(): void;
}

interface FoliageComputeRendererLike {
  hasFeature(name: string): boolean;
  compute(computeNodes: unknown | readonly unknown[], dispatchSize?: unknown): void;
  getArrayBufferAsync(
    attribute: THREE.BufferAttribute,
    target?: null,
    offset?: number,
    count?: number,
  ): Promise<ArrayBuffer>;
}

const UINT_NONE = 0xffff_ffff;
const INDIRECT_WORDS = 5;
const INDIRECT_BYTES = INDIRECT_WORDS * Uint32Array.BYTES_PER_ELEMENT;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;

type ComputeNodeLike = Node & { compute(count: number): ComputeNodeLike; dispose(): void };

interface CommandRecord {
  readonly key: string;
  readonly pass: FoliageComputePass;
  readonly capacity: number;
  readonly triangles: number;
  readonly indexCount: number;
  readonly commandIndex: number;
  readonly firstInstance: number;
  readonly mesh: THREE.InstancedMesh;
}

interface AttributeManagerLike {
  delete(attribute: THREE.BufferAttribute): unknown;
}

interface RendererInternals {
  readonly _attributes?: AttributeManagerLike;
}

function byteLength(...arrays: readonly ArrayBufferView[]): number {
  let bytes = 0;
  for (const array of arrays) bytes += array.byteLength;
  return bytes;
}

function copyBatchSources(spec: FoliageComputeSpec): {
  matrices: Float32Array;
  positions: Float32Array;
  colours: Float32Array;
  phases: Float32Array;
  stableIds: Uint32Array;
  live: Uint32Array;
  chunkRanges: Uint32Array;
  typeCommands: Uint32Array;
  sourceBases: ReadonlyMap<string, number>;
  sourceCounts: ReadonlyMap<string, number>;
  commands: Array<{
    key: string;
    pass: FoliageComputePass;
    capacity: number;
    triangles: number;
    indexCount: number;
    firstInstance: number;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }>;
} {
  let sourceCount = 0;
  let outputCount = 0;
  let commandCount = 0;
  for (const batch of spec.batches) {
    const count = batch.stableIds.length;
    sourceCount += count;
    commandCount += batch.colour.length + (batch.shadow === null ? 0 : 1);
    outputCount += count * (batch.colour.length + (batch.shadow === null ? 0 : 1));
  }

  const matrices = new Float32Array(sourceCount * 16);
  const positions = new Float32Array(sourceCount * 4);
  const colours = new Float32Array(sourceCount * 4);
  const phases = new Float32Array(sourceCount);
  const stableIds = new Uint32Array(sourceCount);
  const live = new Uint32Array(sourceCount);
  const chunkRanges = new Uint32Array(spec.batches.length * spec.chunkCount * 2);
  const typeCommands = new Uint32Array(spec.batches.length * 4);
  const sourceBases = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const commands: Array<{
    key: string;
    pass: FoliageComputePass;
    capacity: number;
    triangles: number;
    indexCount: number;
    firstInstance: number;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }> = [];

  let sourceBase = 0;
  let outputBase = 0;
  for (let typeIndex = 0; typeIndex < spec.batches.length; typeIndex++) {
    const batch = spec.batches[typeIndex];
    const count = batch.stableIds.length;
    if (batch.matrices.length !== count * 16 || batch.colours.length !== count * 4
      || batch.phases.length !== count || batch.live.length !== count
      || batch.chunkRanges.length !== spec.chunkCount * 2) {
      throw new Error(`[foliage.compute] invalid source column lengths for ${batch.key}`);
    }
    if (batch.colour.length !== 1 && batch.colour.length !== 3) {
      throw new Error(`[foliage.compute] ${batch.key} must expose one or three colour deliveries`);
    }
    if (sourceBases.has(batch.key)) {
      throw new Error(`[foliage.compute] duplicate pilot key ${batch.key}`);
    }

    sourceBases.set(batch.key, sourceBase);
    sourceCounts.set(batch.key, count);
    matrices.set(batch.matrices, sourceBase * 16);
    for (let i = 0; i < count; i++) {
      const matrixOffset = i * 16;
      const positionOffset = (sourceBase + i) * 4;
      positions[positionOffset] = batch.matrices[matrixOffset + 12];
      positions[positionOffset + 1] = batch.matrices[matrixOffset + 13];
      positions[positionOffset + 2] = batch.matrices[matrixOffset + 14];
      positions[positionOffset + 3] = 1;
    }
    colours.set(batch.colours, sourceBase * 4);
    phases.set(batch.phases, sourceBase);
    stableIds.set(batch.stableIds, sourceBase);
    live.set(batch.live, sourceBase);
    for (let chunk = 0; chunk < spec.chunkCount; chunk++) {
      const src = chunk * 2;
      const dst = (typeIndex * spec.chunkCount + chunk) * 2;
      chunkRanges[dst] = sourceBase + batch.chunkRanges[src];
      chunkRanges[dst + 1] = sourceBase + batch.chunkRanges[src + 1];
    }

    const colourCommands: number[] = [];
    for (let lod = 0; lod < batch.colour.length; lod++) {
      const delivery = batch.colour[lod];
      const index = delivery.geometry.getIndex();
      if (index === null) throw new Error(`[foliage.compute] ${batch.key}.lod${lod} is not indexed`);
      const commandIndex = commands.length;
      colourCommands.push(commandIndex);
      commands.push({
        key: batch.key,
        pass: `lod${lod}` as FoliageComputePass,
        capacity: count,
        triangles: delivery.triangles,
        indexCount: index.count,
        firstInstance: outputBase,
        geometry: delivery.geometry,
        material: delivery.material,
      });
      outputBase += count;
    }
    const lod0 = colourCommands[0];
    typeCommands[typeIndex * 4] = lod0;
    typeCommands[typeIndex * 4 + 1] = colourCommands[1] ?? lod0;
    typeCommands[typeIndex * 4 + 2] = colourCommands[2] ?? lod0;

    if (batch.shadow === null) {
      typeCommands[typeIndex * 4 + 3] = UINT_NONE;
    } else {
      const index = batch.shadow.geometry.getIndex();
      if (index === null) throw new Error(`[foliage.compute] ${batch.key}.shadow is not indexed`);
      typeCommands[typeIndex * 4 + 3] = commands.length;
      commands.push({
        key: batch.key,
        pass: 'shadow',
        capacity: count,
        triangles: batch.shadow.triangles,
        indexCount: index.count,
        firstInstance: outputBase,
        geometry: batch.shadow.geometry,
        material: batch.shadow.material,
      });
      outputBase += count;
    }
    sourceBase += count;
  }

  if (commands.length !== commandCount || outputBase !== outputCount) {
    throw new Error('[foliage.compute] internal command capacity mismatch');
  }
  return {
    matrices, positions, colours, phases, stableIds, live, chunkRanges, typeCommands,
    sourceBases, sourceCounts, commands,
  };
}

/** Create the WebGPU controller. Called only by the dynamically loaded node bundle. */
export function createFoliageComputeController(
  renderer: FoliageComputeRendererLike,
  spec: FoliageComputeSpec,
): FoliageComputeControllerLike {
  if (!renderer.hasFeature('indirect-first-instance')) {
    throw new Error('[foliage.compute] indirect-first-instance is unavailable');
  }
  if (spec.batches.length === 0) throw new Error('[foliage.compute] no pilot batches');
  if (spec.chunkCount <= 0) throw new Error('[foliage.compute] invalid chunk count');
  if (spec.chunkMins.length !== spec.chunkCount * 4
    || spec.chunkMaxs.length !== spec.chunkCount * 4) {
    throw new Error('[foliage.compute] invalid chunk bounds');
  }

  const packed = copyBatchSources(spec);
  const sourceCount = packed.stableIds.length;
  let outputCount = 0;
  for (const command of packed.commands) outputCount += command.capacity;

  const sourceMatrixAttr = new StorageBufferAttribute(packed.matrices, 16);
  const sourcePositionAttr = new StorageBufferAttribute(packed.positions, 4);
  const sourceColourAttr = new StorageBufferAttribute(packed.colours, 4);
  const sourcePhaseAttr = new StorageBufferAttribute(packed.phases, 1);
  const sourceIdAttr = new StorageBufferAttribute(packed.stableIds, 1);
  const liveAttr = new StorageBufferAttribute(packed.live, 1);
  const rangeAttr = new StorageBufferAttribute(packed.chunkRanges, 2);
  const chunkMinAttr = new StorageBufferAttribute(spec.chunkMins, 4);
  const chunkMaxAttr = new StorageBufferAttribute(spec.chunkMaxs, 4);
  const chunkVisibleAttr = new StorageBufferAttribute(new Uint32Array(spec.chunkCount), 1);
  const typeCommandAttr = new StorageBufferAttribute(packed.typeCommands, 4);

  sourceMatrixAttr.name = 'foliage.compute.source.matrix';
  sourcePositionAttr.name = 'foliage.compute.source.position';
  sourceColourAttr.name = 'foliage.compute.source.colour';
  sourcePhaseAttr.name = 'foliage.compute.source.phase';
  sourceIdAttr.name = 'foliage.compute.source.id';
  liveAttr.name = 'foliage.compute.source.live';
  rangeAttr.name = 'foliage.compute.chunk.ranges';
  chunkMinAttr.name = 'foliage.compute.chunk.min';
  chunkMaxAttr.name = 'foliage.compute.chunk.max';
  chunkVisibleAttr.name = 'foliage.compute.chunk.visible';
  typeCommandAttr.name = 'foliage.compute.type.commands';

  const outputMatrixAttr = new StorageInstancedBufferAttribute(outputCount, 16);
  const outputColourAttr = new StorageInstancedBufferAttribute(outputCount, 4);
  const outputPhaseAttr = new StorageInstancedBufferAttribute(outputCount, 1);
  const outputIdAttr = new StorageBufferAttribute(new Uint32Array(outputCount), 1);
  outputMatrixAttr.name = 'foliage.compute.output.matrix';
  outputColourAttr.name = 'foliage.compute.output.colour';
  outputPhaseAttr.name = 'foliage.compute.output.phase';
  outputIdAttr.name = 'foliage.compute.output.id';

  const indirectValues = new Uint32Array(packed.commands.length * INDIRECT_WORDS);
  for (let i = 0; i < packed.commands.length; i++) {
    const command = packed.commands[i];
    const offset = i * INDIRECT_WORDS;
    indirectValues[offset] = command.indexCount;
    indirectValues[offset + 1] = 0;
    indirectValues[offset + 2] = 0;
    indirectValues[offset + 3] = 0;
    indirectValues[offset + 4] = command.firstInstance;
  }
  const indirectAttr = new IndirectStorageBufferAttribute(indirectValues, INDIRECT_WORDS);
  indirectAttr.name = 'foliage.compute.indirect';

  const initialUploadBytes = byteLength(
    packed.matrices, packed.positions, packed.colours, packed.phases, packed.stableIds, packed.live,
    packed.chunkRanges, spec.chunkMins, spec.chunkMaxs, packed.typeCommands, indirectValues,
  );
  const storageBytes = initialUploadBytes + byteLength(
    outputMatrixAttr.array, outputColourAttr.array, outputPhaseAttr.array, outputIdAttr.array,
    chunkVisibleAttr.array,
  );
  if (storageBytes > MAX_STORAGE_BYTES) {
    throw new Error(
      `[foliage.compute] ${storageBytes} storage bytes exceed the ${MAX_STORAGE_BYTES} byte gate`,
    );
  }

  const DrawIndexedCommand = struct({
    indexCount: 'uint',
    instanceCount: { type: 'uint', atomic: true },
    firstIndex: 'uint',
    baseVertex: 'int',
    firstInstance: 'uint',
  }, 'VoltmarchFoliageDrawIndexedCommand');

  const sourceMatrices = storage(sourceMatrixAttr, 'mat4', sourceCount).toReadOnly();
  const sourcePositions = storage(sourcePositionAttr, 'vec4', sourceCount).toReadOnly();
  const sourceColours = storage(sourceColourAttr, 'vec4', sourceCount).toReadOnly();
  const sourcePhases = storage(sourcePhaseAttr, 'float', sourceCount).toReadOnly();
  const sourceIds = storage(sourceIdAttr, 'uint', sourceCount).toReadOnly();
  const live = storage(liveAttr, 'uint', sourceCount).toReadOnly();
  const chunkRanges = storage(
    rangeAttr, 'uvec2', spec.batches.length * spec.chunkCount,
  ).toReadOnly();
  const chunkMins = storage(chunkMinAttr, 'vec4', spec.chunkCount).toReadOnly();
  const chunkMaxs = storage(chunkMaxAttr, 'vec4', spec.chunkCount).toReadOnly();
  const chunkVisibility = storage(chunkVisibleAttr, 'uint', spec.chunkCount).toReadOnly();
  const typeCommands = storage(typeCommandAttr, 'uvec4', spec.batches.length).toReadOnly();
  const outputMatrices = storage(outputMatrixAttr, 'mat4', outputCount);
  const outputColours = storage(outputColourAttr, 'vec4', outputCount);
  const outputPhases = storage(outputPhaseAttr, 'float', outputCount);
  const outputIds = storage(outputIdAttr, 'uint', outputCount);
  const drawCommands = storage(indirectAttr, DrawIndexedCommand, packed.commands.length);

  const cameraPosition = uniform(new THREE.Vector3());

  const resetNode = Fn(() => {
    for (let i = 0; i < packed.commands.length; i++) {
      atomicStore(drawCommands.element(uint(i)).get('instanceCount'), uint(0));
    }
  })().compute(1) as ComputeNodeLike;
  resetNode.name = 'foliage.compute.reset-indirect';

  const compactNode = Fn(() => {
    const range = chunkRanges.element(instanceIndex);
    const begin = range.x;
    const end = range.y;
    const chunkIndex = instanceIndex.mod(uint(spec.chunkCount));
    const typeIndex = instanceIndex.div(uint(spec.chunkCount));
    const minBounds = chunkMins.element(chunkIndex);
    const maxBounds = chunkMaxs.element(chunkIndex);
    // Broad phase deliberately remains the proven 256-AABB CPU test in this
    // pilot. The GPU owns the expensive per-instance LOD/stream compaction.
    // Bounds stay part of the immutable source contract and guard malformed
    // chunks; a later measured batch may move the six plane tests here.
    const visible = and(
      chunkVisibility.element(chunkIndex).greaterThan(uint(0)),
      and(maxBounds.x.greaterThanEqual(minBounds.x), maxBounds.z.greaterThanEqual(minBounds.z)),
    );

    If(and(visible, begin.lessThan(end)), () => {
      const commands = typeCommands.element(typeIndex);
      Loop({ start: begin, end, type: 'uint', condition: '<' }, ({ i }) => {
        If(live.element(i).greaterThan(uint(0)), () => {
          const matrix = sourceMatrices.element(i);
          const translation = sourcePositions.element(i).xyz;
          const delta = translation.sub(cameraPosition);
          const distanceSquared = dot(delta, delta);
          const hash = sourceIds.element(i).bitXor(uint(0x7f4a7c15))
            .mul(uint(0x9e3779b1)).toVar('stableHash');
          hash.assign(hash.bitXor(hash.shiftRight(uint(16))));
          const signed = float(hash.bitAnd(uint(0xffff))).div(0xffff).mul(2).sub(1);
          const lod1 = float(spec.lod1Metres)
            .add(signed.mul(spec.transitionBandMetres * 0.5));
          const lod2 = float(spec.lod2Metres)
            .add(signed.mul(spec.transitionBandMetres * 0.5));
          const colourCommand = commands.x.toVar('colourCommand');
          If(distanceSquared.greaterThanEqual(lod2.mul(lod2)), () => {
            colourCommand.assign(commands.z);
          }).ElseIf(distanceSquared.greaterThanEqual(lod1.mul(lod1)), () => {
            colourCommand.assign(commands.y);
          });

          const colourDraw = drawCommands.element(colourCommand);
          const colourSlot = (atomicAdd(
            colourDraw.get('instanceCount'), uint(1),
          ) as unknown as Node<'uint'>).toVar('colourSlot');
          const colourOutput = (colourDraw.get('firstInstance') as unknown as Node<'uint'>)
            .add(colourSlot);
          outputMatrices.element(colourOutput).assign(matrix);
          outputColours.element(colourOutput).assign(sourceColours.element(i));
          outputPhases.element(colourOutput).assign(sourcePhases.element(i));
          outputIds.element(colourOutput).assign(sourceIds.element(i));

          If(commands.w.notEqual(uint(UINT_NONE)), () => {
            const shadowDraw = drawCommands.element(commands.w);
            const shadowSlot = (atomicAdd(
              shadowDraw.get('instanceCount'), uint(1),
            ) as unknown as Node<'uint'>).toVar('shadowSlot');
            const shadowOutput = (shadowDraw.get('firstInstance') as unknown as Node<'uint'>)
              .add(shadowSlot);
            outputMatrices.element(shadowOutput).assign(matrix);
            outputColours.element(shadowOutput).assign(sourceColours.element(i));
            outputPhases.element(shadowOutput).assign(sourcePhases.element(i));
            outputIds.element(shadowOutput).assign(sourceIds.element(i));
          });
        });
      });
    });
  })().compute(spec.batches.length * spec.chunkCount) as ComputeNodeLike;
  compactNode.name = 'foliage.compute.compact-visible';

  const objects: THREE.Object3D[] = [];
  const commandRecords: CommandRecord[] = [];
  let colourDraws = 0;
  let shadowDraws = 0;
  for (let commandIndex = 0; commandIndex < packed.commands.length; commandIndex++) {
    const command = packed.commands[commandIndex];
    const geometry = command.geometry.clone();
    geometry.name = `${command.geometry.name}.compute.${command.pass}`;
    geometry.setAttribute(spec.windPhaseAttribute, outputPhaseAttr);
    geometry.setIndirect(indirectAttr, commandIndex * INDIRECT_BYTES);
    const mesh = new THREE.InstancedMesh(geometry, command.material, outputCount);
    mesh.instanceMatrix = outputMatrixAttr;
    mesh.instanceColor = outputColourAttr;
    mesh.count = Math.max(1, command.capacity);
    mesh.name = `prop.${command.key}.compute.${command.pass}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    if (command.pass === 'shadow') {
      mesh.userData[SHADOW_ONLY_TAG] = true;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      shadowDraws++;
    } else {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      colourDraws++;
    }
    objects.push(mesh);
    commandRecords.push({
      key: command.key,
      pass: command.pass,
      capacity: command.capacity,
      triangles: command.triangles,
      indexCount: command.indexCount,
      commandIndex,
      firstInstance: command.firstInstance,
      mesh,
    });
  }

  let disposed = false;
  let liveDirty = true;
  let pendingLiveUploadBytes = 0;
  let lastSubmitMs = 0;
  let lastCpuUploadBytes = 0;
  let dispatches = 0;

  const allAttributes: THREE.BufferAttribute[] = [
    sourceMatrixAttr, sourcePositionAttr, sourceColourAttr, sourcePhaseAttr, sourceIdAttr, liveAttr,
    rangeAttr, chunkMinAttr, chunkMaxAttr, typeCommandAttr, outputMatrixAttr,
    chunkVisibleAttr, outputColourAttr, outputPhaseAttr, outputIdAttr, indirectAttr,
  ];

  return {
    objects,
    colourDraws,
    shadowDraws,
    initialUploadBytes,
    storageBytes,
    dispatchesPerUpdate: 2,
    sourceInstances: sourceCount,
    get lastSubmitMs() { return lastSubmitMs; },
    get lastCpuUploadBytes() { return lastCpuUploadBytes; },
    get dispatches() { return dispatches; },

    update(camera, dirty, visibleChunks): void {
      if (disposed || (!dirty && !liveDirty)) {
        lastSubmitMs = 0;
        lastCpuUploadBytes = 0;
        return;
      }
      if (visibleChunks === undefined || visibleChunks.length !== spec.chunkCount) {
        throw new Error('[foliage.compute] CPU broad-phase flags unavailable');
      }
      const visibleArray = chunkVisibleAttr.array as Uint32Array;
      for (let i = 0; i < spec.chunkCount; i++) visibleArray[i] = visibleChunks[i];
      chunkVisibleAttr.clearUpdateRanges();
      chunkVisibleAttr.addUpdateRange(0, spec.chunkCount);
      chunkVisibleAttr.needsUpdate = true;
      lastCpuUploadBytes = spec.chunkCount * Uint32Array.BYTES_PER_ELEMENT
        + pendingLiveUploadBytes;
      (cameraPosition.value as THREE.Vector3).copy(camera.position);
      const started = typeof performance === 'undefined' ? 0 : performance.now();
      renderer.compute([resetNode, compactNode]);
      lastSubmitMs = typeof performance === 'undefined' ? 0 : performance.now() - started;
      dispatches += 2;
      liveDirty = false;
      pendingLiveUploadBytes = 0;
    },

    setLive(key, sourceIndex, isLive): void {
      if (disposed) return;
      const base = packed.sourceBases.get(key);
      const count = packed.sourceCounts.get(key);
      if (base === undefined || count === undefined || sourceIndex < 0 || sourceIndex >= count) {
        throw new Error(`[foliage.compute] invalid live slot ${key}[${sourceIndex}]`);
      }
      const index = base + sourceIndex;
      const value = isLive ? 1 : 0;
      if ((liveAttr.array as Uint32Array)[index] === value) return;
      (liveAttr.array as Uint32Array)[index] = value;
      liveAttr.addUpdateRange(index, 1);
      liveAttr.needsUpdate = true;
      liveDirty = true;
      pendingLiveUploadBytes += Uint32Array.BYTES_PER_ELEMENT;
    },

    async audit(): Promise<FoliageComputeAudit> {
      if (disposed) throw new Error('[foliage.compute] cannot audit a disposed controller');
      const [indirectBuffer, idBuffer] = await Promise.all([
        renderer.getArrayBufferAsync(indirectAttr),
        renderer.getArrayBufferAsync(outputIdAttr),
      ]);
      const indirect = new Uint32Array(indirectBuffer);
      const ids = new Uint32Array(idBuffer);
      const commands: FoliageComputeAuditCommand[] = [];
      let visibleInstances = 0;
      let visibleLod0 = 0;
      let visibleLod1 = 0;
      let visibleLod2 = 0;
      let visibleTriangles = 0;
      let visibleShadowTriangles = 0;
      for (const command of commandRecords) {
        const offset = command.commandIndex * INDIRECT_WORDS;
        const instanceCount = indirect[offset + 1];
        if (instanceCount > command.capacity) {
          throw new Error(
            `[foliage.compute] ${command.key}.${command.pass} count ${instanceCount} exceeds ${command.capacity}`,
          );
        }
        const firstInstance = indirect[offset + 4];
        const stableIds = Array.from(ids.subarray(firstInstance, firstInstance + instanceCount));
        commands.push({
          key: command.key,
          pass: command.pass,
          indexCount: indirect[offset],
          instanceCount,
          firstIndex: indirect[offset + 2],
          baseVertex: new Int32Array(indirect.buffer, offset * 4 + 12, 1)[0],
          firstInstance,
          capacity: command.capacity,
          triangles: command.triangles,
          stableIds,
        });
        if (command.pass === 'shadow') {
          visibleShadowTriangles += instanceCount * command.triangles;
        } else {
          visibleInstances += instanceCount;
          visibleTriangles += instanceCount * command.triangles;
          if (command.pass === 'lod0') visibleLod0 += instanceCount;
          else if (command.pass === 'lod1') visibleLod1 += instanceCount;
          else visibleLod2 += instanceCount;
        }
      }
      return {
        commands, visibleInstances, visibleLod0, visibleLod1, visibleLod2,
        visibleTriangles, visibleShadowTriangles,
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      resetNode.dispose();
      compactNode.dispose();
      for (const command of commandRecords) {
        command.mesh.removeFromParent();
        command.mesh.geometry.dispose();
        command.mesh.dispose();
      }
      // r185 compute-node disposal releases pipelines and bindings but not the
      // storage attributes behind them. Keep the reach into the renderer's
      // attribute manager isolated and guarded, as gpu-path-install already does
      // for Three's fallback hook.
      const attributes = (renderer as unknown as RendererInternals)._attributes;
      if (attributes === undefined || typeof attributes.delete !== 'function') {
        console.warn('[foliage.compute] Three attribute cleanup hook unavailable; renderer teardown owns buffers');
      } else {
        for (const attribute of allAttributes) attributes.delete(attribute);
      }
    },
  };
}
