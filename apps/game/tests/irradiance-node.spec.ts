import { describe, expect, it } from 'vitest';
import {
  DataTexture,
  DataUtils,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  PerspectiveCamera,
  RGBAFormat,
} from 'three/webgpu';
import { texture } from 'three/tsl';

import {
  IRRADIANCE_FIELD_FLOATS,
  IRRADIANCE_FIELD_SIZE,
  type IrradianceFieldUpdate,
} from '../src/core/irradiance-field';
import {
  IRRADIANCE_MAX_PACKED_ALPHA,
  IRRADIANCE_MAX_RADIANCE,
  copyIrradianceToHalf,
  createIrradianceNodes,
} from '../src/render/nodes/irradiance-node';
import { compileFragmentNode } from './helpers/node-compile';

function colourTexture(): DataTexture {
  const data = new Uint16Array(4 * 4 * 4);
  const tex = new DataTexture(data, 4, 4, RGBAFormat, HalfFloatType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function field(rgba = new Float32Array(IRRADIANCE_FIELD_FLOATS)): IrradianceFieldUpdate {
  return {
    width: IRRADIANCE_FIELD_SIZE,
    height: IRRADIANCE_FIELD_SIZE,
    rgba,
    minX: -32,
    minZ: 16,
    maxX: 480,
    maxZ: 528,
  };
}

function nodes() {
  const beauty = colourTexture();
  const normals = colourTexture();
  const depth = new DepthTexture(4, 4);
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const result = createIrradianceNodes({
    input: texture(beauty) as never,
    depthNode: texture(depth) as never,
    normalNode: texture(normals) as never,
    camera,
  });
  return { result, beauty, normals, depth };
}

describe('world irradiance node', () => {
  it('starts with neutral zero radiance and opaque metadata before worker adoption', () => {
    const { result, beauty, normals, depth } = nodes();
    expect(result.uniforms.active.value).toBe(0);
    for (let i = 0; i < result.uploadData.length; i += 4) {
      expect(result.uploadData[i]).toBe(0);
      expect(result.uploadData[i + 1]).toBe(0);
      expect(result.uploadData[i + 2]).toBe(0);
      expect(DataUtils.fromHalfFloat(result.uploadData[i + 3])).toBe(1);
    }
    result.dispose();
    beauty.dispose(); normals.dispose(); depth.dispose();
  });

  it('mutates and reuploads one retained texture without rebuilding the graph', () => {
    const { result, beauty, normals, depth } = nodes();
    const textureIdentity = result.texture;
    const storageIdentity = result.uploadData;
    const version = result.texture.version;
    const rgba = new Float32Array(IRRADIANCE_FIELD_FLOATS);
    rgba.fill(0.08);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 0.72;

    expect(result.setField(field(rgba))).toBe(true);
    expect(result.texture).toBe(textureIdentity);
    expect(result.uploadData).toBe(storageIdentity);
    expect(result.texture.version).toBe(version + 1);
    expect(result.uniforms.active.value).toBe(1);
    expect(result.uniforms.worldToUv.value.toArray()).toEqual([-32, 16, 1 / 512, 1 / 512]);
    expect(DataUtils.fromHalfFloat(result.uploadData[0])).toBeCloseTo(0.08, 3);
    expect(DataUtils.fromHalfFloat(result.uploadData[3])).toBeCloseTo(0.72, 3);

    const secondVersion = result.texture.version;
    rgba[0] = 0.04;
    expect(result.setField(field(rgba))).toBe(true);
    expect(result.texture).toBe(textureIdentity);
    expect(result.uploadData).toBe(storageIdentity);
    expect(result.texture.version).toBe(secondVersion + 1);

    expect(result.setField(null)).toBe(true);
    expect(result.uniforms.active.value).toBe(0);
    result.dispose();
    beauty.dispose(); normals.dispose(); depth.dispose();
  });

  it('moods the static field through retained uniforms without texture upload or graph change', () => {
    const { result, beauty, normals, depth } = nodes();
    const tint = result.uniforms.moodTint.value;
    const version = result.texture.version;
    result.setMood(0.18, 0.38, 0.52, 0.80);
    expect(result.uniforms.moodGain.value).toBe(0.18);
    expect(result.uniforms.moodTint.value).toBe(tint);
    expect(tint.toArray()).toEqual([0.38, 0.52, 0.80]);
    expect(result.texture.version).toBe(version);
    result.dispose();
    beauty.dispose(); normals.dispose(); depth.dispose();
  });

  it('rejects malformed bounds/dimensions without destroying the last valid field', () => {
    const { result, beauty, normals, depth } = nodes();
    const rgba = new Float32Array(IRRADIANCE_FIELD_FLOATS);
    rgba[0] = 0.06;
    expect(result.setField(field(rgba))).toBe(true);
    const first = result.uploadData[0];
    const bad = { ...field(rgba), width: 32, maxX: -32 };
    expect(result.setField(bad)).toBe(false);
    expect(result.uniforms.active.value).toBe(1);
    expect(result.uploadData[0]).toBe(first);
    result.dispose();
    beauty.dispose(); normals.dispose(); depth.dispose();
  });

  it('clamps invalid HDR input before half-float conversion', () => {
    const source = new Float32Array(IRRADIANCE_FIELD_FLOATS);
    const destination = new Uint16Array(IRRADIANCE_FIELD_FLOATS);
    source[0] = Number.NaN;
    source[1] = -2;
    source[2] = 99;
    source[3] = 4;
    copyIrradianceToHalf(source, destination);
    expect(DataUtils.fromHalfFloat(destination[0])).toBe(0);
    expect(DataUtils.fromHalfFloat(destination[1])).toBe(0);
    expect(DataUtils.fromHalfFloat(destination[2])).toBeCloseTo(IRRADIANCE_MAX_RADIANCE, 3);
    expect(DataUtils.fromHalfFloat(destination[3])).toBe(IRRADIANCE_MAX_PACKED_ALPHA);
  });

  it('compiles world reconstruction, normal reuse and the fused field sample', () => {
    const { result, beauty, normals, depth } = nodes();
    const source = compileFragmentNode(result.node).fragment;
    expect(source.match(/textureSample\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('0.9992');
    expect(source).toContain(IRRADIANCE_MAX_RADIANCE.toString());
    expect(source).toContain('irradianceLocalMask');
    expect(source).toContain('irradianceLocalGain');
    expect(source).toContain('irradianceSafeDepth');
    expect(source).toContain('irradianceSafeNormalInvLength');
    expect(source).toContain('1e-8');
    expect(source).not.toMatch(/normalize\(\s*irradianceRawViewNormal\s*\)/);
    // The active uniform stays in the generated expression, proving field
    // arrival is a uniform/upload change rather than a graph-shape switch.
    expect(source).toMatch(/object\.nodeUniform\d+\s*\*\s*irradianceGeometry/);
    result.dispose();
    beauty.dispose(); normals.dispose(); depth.dispose();
  });
});
