/**
 * One WebGPU/TSL view of the presentation-only surface environment.
 *
 * Every node material shares these exact uniform nodes. `onFrameUpdate` is
 * frame-deduplicated by Three for a shared node, so growing the material roster
 * does not grow weather callbacks or allocate per-material state. Terrain and
 * roads retain their explicit setters because they also own non-node twins;
 * units, structures and props are WebGPU graph consumers only here.
 */

import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { surfaceEnvironmentState } from './surface-environment';

/** x wetness, y dust, z snow, w causal shoreline salt exposure. */
export const surfaceClimateNode = uniform(new THREE.Vector4(0, 0, 0, 0));
surfaceClimateNode.onFrameUpdate(() => {
  (surfaceClimateNode.value as THREE.Vector4).set(
    surfaceEnvironmentState.wetness,
    surfaceEnvironmentState.dust,
    surfaceEnvironmentState.snow,
    surfaceEnvironmentState.salt,
  );
});

/** Restrained ground-contact contamination, kept separate from climate. */
export const surfaceContactNode = uniform(0);
surfaceContactNode.onFrameUpdate(() => {
  surfaceContactNode.value = surfaceEnvironmentState.contact;
});
