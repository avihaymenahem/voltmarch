import { describe, expect, it } from 'vitest';

import { UNIT_MATERIAL } from '../src/core/config';
import { applyUnitRim, UNIT_RIM_GLSL_MARKER } from '../src/art/unit-rim';

describe('shipping unit silhouette rim', () => {
  it('uses the unperturbed geometry normal and stays ahead of tonemapping', () => {
    const shader = {
      fragmentShader: `void main() {
        #include <opaque_fragment>
        #include <tonemapping_fragment>
      }`,
    };
    applyUnitRim(shader as never);
    expect(shader.fragmentShader).toContain(UNIT_RIM_GLSL_MARKER);
    expect(shader.fragmentShader).toContain('nonPerturbedNormal');
    expect(shader.fragmentShader).toContain('vViewPosition');
    expect(shader.fragmentShader.indexOf(UNIT_RIM_GLSL_MARKER))
      .toBeLessThan(shader.fragmentShader.indexOf('#include <tonemapping_fragment>'));
    expect(shader.fragmentShader).toContain(UNIT_MATERIAL.rimStrength.toFixed(4));
  });
});
