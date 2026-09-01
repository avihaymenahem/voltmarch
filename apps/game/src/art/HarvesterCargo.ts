/**
 * Soviet Ore Collector cargo experiment.
 *
 * The approved GLB is one fused mesh, so its scoop and hopper cannot be
 * articulated without cutting and re-exporting the source asset.  The open
 * hopper can still tell the economic truth: this one small instanced part reads
 * the harvester's existing cargo fraction from `aState.w`, rises while mining
 * and sinks while the refinery drains it.
 *
 * WebGPU only.  There is no texture fetch, animation mixer, per-entity object,
 * worker message or extra instance attribute.  Every Soviet collector shares
 * one geometry, one node material and the RenderBridge batch it already owns.
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
import {
  attribute, clamp, mix, positionLocal, smoothstep, vec3,
} from 'three/tsl';

import { ORE_CRYSTAL_COLOR } from '../core/config';
import { PartId } from '../core/types';
import type { KindMeshPart } from '../render/RenderBridge';
import { shroudTint, shroudVertexUv } from '../render/shroud-nodes';
import { PropMesh } from '../world/PropLibrary';

type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/** Final fitted model-space placement, beneath the collector's 3.3 m hopper rim. */
export const SOVIET_HARVESTER_CARGO_PLACEMENT = {
  x: 0,
  y: 2.36,
  z: -0.82,
} as const;

/**
 * Apply the fill animation before Three applies the instance matrix.
 *
 * Empty cargo collapses toward the centre and sinks 34 cm below the hopper
 * floor.  The first few percent stay hidden by the steel bed; after that the
 * footprint spreads and the top rises continuously to just below the rim.
 */
function applyCargoFill(): void {
  const fill = clamp(attribute<'vec4'>('aState', 'vec4').w, 0.0, 1.0)
    .toVar('vmCargoFill');
  const footprint = smoothstep(0.02, 0.16, fill).toVar('vmCargoFootprint');
  const height = mix(0.08, 1.0, fill).toVar('vmCargoHeight');
  const sink = fill.oneMinus().mul(0.34).toVar('vmCargoSink');
  positionLocal.assign(vec3(
    positionLocal.x.mul(footprint),
    positionLocal.y.mul(height).sub(sink),
    positionLocal.z.mul(footprint),
  ));
}

class HarvesterCargoNodeMaterial extends MeshStandardNodeMaterial {
  override setupPosition(builder: NodeBuilder): Vec3N {
    applyCargoFill();
    const position = super.setupPosition(builder) as Vec3N;
    shroudVertexUv();
    return position;
  }

  override setupOutput(builder: NodeBuilder, outputNode: Vec4N): Vec4N {
    return super.setupOutput(builder, shroudTint(outputNode)) as Vec4N;
  }
}

/** A broad, irregular heap rather than field-scale upright crystal spires. */
export function buildSovietHarvesterCargoGeometry(): THREE.BufferGeometry {
  const m = new PropMesh();
  const amber = '#D88A22';
  const pale = '#FFD77A';
  const deep = '#7D4B17';
  const earth = '#49351C';

  // A dark mineral bed prevents gaps between the brighter chunks as it rises.
  m.ao(0.48, 0, 0.68).color(earth).bevel(deep);
  m.blob(0, 0.16, 0, 1.14, 0.22, 1.18, 8, 3, 0.82, 0.18);

  // Overlapping low-poly lumps break the top silhouette and catch the key.
  m.color(deep).bevel(amber);
  m.blob(-0.46, 0.27, -0.38, 0.66, 0.27, 0.62, 7, 3, 0.72, 0.46);
  m.color(amber).bevel(ORE_CRYSTAL_COLOR);
  m.blob(0.43, 0.29, -0.31, 0.68, 0.29, 0.64, 7, 3, 0.70, 0.12);
  m.color(ORE_CRYSTAL_COLOR).bevel(pale);
  m.blob(-0.25, 0.34, 0.38, 0.62, 0.33, 0.58, 7, 3, 0.68, 0.30);
  m.color(amber).bevel(pale);
  m.blob(0.48, 0.25, 0.45, 0.54, 0.25, 0.51, 6, 3, 0.74, 0.62);
  m.color(pale).bevel('#FFE6A6');
  m.blob(0.02, 0.43, 0.04, 0.48, 0.27, 0.46, 6, 3, 0.64, 0.08);

  return m.toGeometry('soviet_harvester.cargo');
}

export function createSovietHarvesterCargoMaterial(): MeshStandardNodeMaterial {
  const material = new HarvesterCargoNodeMaterial();
  material.name = 'SovietHarvesterCargoMaterial';
  material.color = new THREE.Color(0xffffff);
  material.vertexColors = true;
  material.roughness = 0.40;
  material.metalness = 0.03;
  material.envMapIntensity = 0.56;
  // A restrained mineral glint; the heap must not become a second beacon.
  material.emissive = new THREE.Color(ORE_CRYSTAL_COLOR);
  material.emissiveIntensity = 0.035;
  return material;
}

export function createSovietHarvesterCargoPart(): KindMeshPart {
  return {
    geometry: buildSovietHarvesterCargoGeometry(),
    material: createSovietHarvesterCargoMaterial(),
    ...SOVIET_HARVESTER_CARGO_PLACEMENT,
    part: PartId.Hopper,
    // One colour submission only: the hull's authored proxy remains the
    // shadow caster and the tiny heap does not warrant an AO-normal draw.
    castShadow: false,
    receiveShadow: true,
    aoOccluder: false,
  };
}
