import { describe, expect, it } from 'vitest';

import { classifyNodeRenderPass } from '../src/render/node-pass-accounting';
import { isShadowOnlyObject, shouldSkipShadowOnlyObject } from '../src/render/shadow-only';

describe('WebGPU node pass accounting', () => {
  const liveScene: { overrideMaterial: object | null } = { overrideMaterial: null };
  const child = { parent: liveScene };

  it('classifies the live scene colour submission', () => {
    expect(classifyNodeRenderPass(child, liveScene, liveScene, { shadowPass: false })).toBe('colour');
  });

  it('classifies shadows before considering the scene override', () => {
    liveScene.overrideMaterial = {};
    expect(classifyNodeRenderPass(child, liveScene, liveScene, { shadowPass: true })).toBe('shadow');
    liveScene.overrideMaterial = null;
  });

  it('classifies the live-scene depth override as AO', () => {
    expect(classifyNodeRenderPass(
      child,
      liveScene,
      liveScene,
      { shadowPass: false },
      { texture: { name: 'AoDepthPrepass' } },
    )).toBe('ao');
  });

  it.each(['AoNormalFromDepth', 'GTAONode.AO', 'AoDenoised'])(
    'classifies the %s fullscreen target as AO',
    (name) => {
      expect(classifyNodeRenderPass(
        { parent: null },
        { overrideMaterial: null },
        liveScene,
        null,
        { texture: { name } },
      )).toBe('ao');
    },
  );

  it.each(['ShadowMap', 'PointShadowMap', 'VSMVertical', 'VSMHorizontal'])(
    'classifies the %s target as shadow work',
    (name) => {
      expect(classifyNodeRenderPass(
        { parent: null },
        { overrideMaterial: null },
        liveScene,
        null,
        { texture: { name } },
      )).toBe('shadow');
    },
  );

  it('recognises a shadow override even before clipping state is available', () => {
    expect(classifyNodeRenderPass(
      child,
      { overrideMaterial: { isShadowPassMaterial: true } },
      liveScene,
      null,
    )).toBe('shadow');
  });

  it('classifies internal graph scenes as post work', () => {
    expect(classifyNodeRenderPass({ parent: null }, { overrideMaterial: null }, liveScene, null)).toBe('post');
  });
});

describe('shadow-only object contract', () => {
  it('opts in strictly so ordinary empty userData stays visible', () => {
    expect(isShadowOnlyObject({ userData: { vmShadowOnly: true } })).toBe(true);
    expect(isShadowOnlyObject({ userData: { vmShadowOnly: false } })).toBe(false);
    expect(isShadowOnlyObject({ userData: {} })).toBe(false);
    expect(isShadowOnlyObject({})).toBe(false);
  });

  it('skips an opted-in proxy outside shadows only', () => {
    const proxy = { userData: { vmShadowOnly: true } };
    expect(shouldSkipShadowOnlyObject(proxy, false)).toBe(true);
    expect(shouldSkipShadowOnlyObject(proxy, true)).toBe(false);
    expect(shouldSkipShadowOnlyObject({ userData: {} }, false)).toBe(false);
  });
});
