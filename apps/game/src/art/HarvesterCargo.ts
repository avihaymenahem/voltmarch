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
import { ORE_CRYSTAL_COLOR } from '../core/config';
import { PropMesh } from '../world/PropLibrary';

/** Final fitted model-space placement, beneath the collector's 3.3 m hopper rim. */
export const SOVIET_HARVESTER_CARGO_PLACEMENT = {
  x: 0,
  y: 2.36,
  z: -0.82,
} as const;

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
