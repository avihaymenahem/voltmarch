/**
 * A restrained geometry-normal silhouette lift for procedural buildings.
 *
 * This is intentionally separate from the unit rim: a building occupies far
 * more pixels and needs less lift, while its foundation pad is ground and must
 * remain exempt. The unperturbed normal keeps atlas seams and rivets from
 * turning into emissive noise at grazing angles.
 */
import type * as THREE from 'three';

import { STRUCTURE_MATERIAL } from '../core/config';
import { hexToLinearRgb } from '../core/math';

export const STRUCTURE_RIM_GLSL_MARKER = 'vmStructureSilhouetteRim';

const linear = hexToLinearRgb(STRUCTURE_MATERIAL.rimColor, new Float32Array(3));
const rimColor = `vec3(${linear[0].toFixed(8)}, ${linear[1].toFixed(8)}, ${linear[2].toFixed(8)})`;

type ShaderHost = Pick<THREE.WebGLProgramParametersWithUniforms, 'fragmentShader'>;

export function applyStructureRim(shader: ShaderHost): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `#include <opaque_fragment>
  {
    // ${STRUCTURE_RIM_GLSL_MARKER}: geometry-only, never the atlas normal map.
    float vmFacing = clamp(dot(normalize(nonPerturbedNormal), normalize(vViewPosition)), 0.0, 1.0);
    float vmRim = pow(1.0 - vmFacing, ${STRUCTURE_MATERIAL.rimPower.toFixed(2)})
                * ${STRUCTURE_MATERIAL.rimStrength.toFixed(4)};
    gl_FragColor.rgb += ${rimColor} * vmRim;
  }`,
  );
}
