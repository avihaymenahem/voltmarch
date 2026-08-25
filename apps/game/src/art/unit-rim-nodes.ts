/** Node-renderer twin of `unit-rim.ts`. Keep the constants in UNIT_MATERIAL. */
import type { Node } from 'three/webgpu';
import {
  clamp, dot, normalViewGeometry, positionViewDirection, pow, vec3, vec4,
} from 'three/tsl';

import { UNIT_MATERIAL } from '../core/config';
import { hexToLinearRgb } from '../core/math';

type Vec4N = Node<'vec4'>;

export const UNIT_RIM_NODE_MARKER = 'vmUnitSilhouetteRim';

const linear = hexToLinearRgb(UNIT_MATERIAL.rimColor, new Float32Array(3));
const color = vec3(linear[0], linear[1], linear[2]);

/** Add the same geometry-normal Fresnel lift as the shipping GLSL material. */
export function unitRim(out: Vec4N): Vec4N {
  const facing = clamp(dot(normalViewGeometry, positionViewDirection), 0.0, 1.0);
  const rim = pow(facing.oneMinus(), UNIT_MATERIAL.rimPower)
    .mul(UNIT_MATERIAL.rimStrength)
    .toVar(UNIT_RIM_NODE_MARKER);
  return vec4(out.rgb.add(color.mul(rim)), out.a);
}
