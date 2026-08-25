/**
 * A narrow material-space silhouette lift for procedural units.
 *
 * It is injected after the stock physical-lighting output and before the
 * shroud/grade. `nonPerturbedNormal` is load-bearing: using the normal-mapped
 * `normal` makes every atlas seam and rivet flash at grazing angles, which is
 * surface noise rather than a silhouette cue.
 */
import type * as THREE from 'three';

import { UNIT_MATERIAL } from '../core/config';
import { hexToLinearRgb } from '../core/math';

export const UNIT_RIM_GLSL_MARKER = 'vmUnitSilhouetteRim';

const linear = hexToLinearRgb(UNIT_MATERIAL.rimColor, new Float32Array(3));
const rimColor = `vec3(${linear[0].toFixed(8)}, ${linear[1].toFixed(8)}, ${linear[2].toFixed(8)})`;

type ShaderHost = Pick<THREE.WebGLProgramParametersWithUniforms, 'fragmentShader'>;

export function applyUnitRim(shader: ShaderHost): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `#include <opaque_fragment>
  {
    // ${UNIT_RIM_GLSL_MARKER}: geometry-only, never the atlas normal map.
    float vmFacing = clamp(dot(normalize(nonPerturbedNormal), normalize(vViewPosition)), 0.0, 1.0);
    float vmRim = pow(1.0 - vmFacing, ${UNIT_MATERIAL.rimPower.toFixed(2)})
                * ${UNIT_MATERIAL.rimStrength.toFixed(4)};
    gl_FragColor.rgb += ${rimColor} * vmRim;
  }`,
  );
}
