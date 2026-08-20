/** Node-renderer twin of `structure-rim.ts`. */
import type { Node } from 'three/webgpu';
import {
  clamp, dot, normalViewGeometry, positionViewDirection, pow, vec3, vec4,
} from 'three/tsl';

import { STRUCTURE_MATERIAL } from '../core/config';
import { hexToLinearRgb } from '../core/math';

type Vec4N = Node<'vec4'>;

export const STRUCTURE_RIM_NODE_MARKER = 'vmStructureSilhouetteRim';

const linear = hexToLinearRgb(STRUCTURE_MATERIAL.rimColor, new Float32Array(3));
const color = vec3(linear[0], linear[1], linear[2]);

export function structureRim(out: Vec4N): Vec4N {
  const facing = clamp(dot(normalViewGeometry, positionViewDirection), 0.0, 1.0);
  const rim = pow(facing.oneMinus(), STRUCTURE_MATERIAL.rimPower)
    .mul(STRUCTURE_MATERIAL.rimStrength)
    .toVar(STRUCTURE_RIM_NODE_MARKER);
  return vec4(out.rgb.add(color.mul(rim)), out.a);
}
