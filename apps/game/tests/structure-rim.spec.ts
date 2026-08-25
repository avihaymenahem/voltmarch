import { describe, expect, it } from 'vitest';

import { applyStructureRim, STRUCTURE_RIM_GLSL_MARKER } from '../src/art/structure-rim';
import { STRUCTURE_MATERIAL } from '../src/core/config';

describe('shipping structure silhouette rim', () => {
  it('uses the geometry normal and stays in scene-linear space', () => {
    const shader = {
      fragmentShader: `void main() {
        #include <opaque_fragment>
        #include <tonemapping_fragment>
      }`,
    };
    applyStructureRim(shader as never);
    expect(shader.fragmentShader).toContain(STRUCTURE_RIM_GLSL_MARKER);
    expect(shader.fragmentShader).toContain('nonPerturbedNormal');
    expect(shader.fragmentShader).toContain('vViewPosition');
    expect(shader.fragmentShader.indexOf(STRUCTURE_RIM_GLSL_MARKER))
      .toBeLessThan(shader.fragmentShader.indexOf('#include <tonemapping_fragment>'));
    expect(shader.fragmentShader).toContain(STRUCTURE_MATERIAL.rimStrength.toFixed(4));
  });
});
