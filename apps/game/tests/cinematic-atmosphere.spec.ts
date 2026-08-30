import { describe, expect, it } from 'vitest';

import {
  buildCloudNoiseData,
  normaliseAtmosphereConfig,
} from '../src/render/nodes/atmosphere-node';
import { ambientDustRateForTier, ambientDustSample } from '../src/vfx/AmbientDust';
import { RENDER_CONFIG } from '../src/render/renderer';

describe('cinematic cloud coverage', () => {
  it('is deterministic, non-flat and RGBA-sized', () => {
    const first = buildCloudNoiseData(32, 0x1234);
    const second = buildCloudNoiseData(32, 0x1234);
    const changed = buildCloudNoiseData(32, 0x5678);
    expect(first).toEqual(second);
    expect(first).not.toEqual(changed);
    expect(first.byteLength).toBe(32 * 32 * 4);
    expect(new Set(first.filter((_value, index) => index % 4 === 0)).size).toBeGreaterThan(24);
    for (let i = 3; i < first.length; i += 4) expect(first[i]).toBe(255);
  });

  it('keeps authored strength inside the restrained cinematic envelope', () => {
    const cfg = normaliseAtmosphereConfig({
      ...RENDER_CONFIG.post.atmosphere,
      cloudShadowStrength: 4,
      cloudScale: 2,
      hazeStrength: 1,
      hazeStart: 80,
      hazeEnd: 40,
    });
    expect(cfg.cloudShadowStrength).toBe(0.35);
    expect(cfg.cloudScale).toBe(48);
    expect(cfg.hazeStrength).toBe(0.2);
    expect(cfg.hazeEnd).toBeGreaterThan(cfg.hazeStart);
  });

  it('ships readable cloud contrast without a zoom-out white veil', () => {
    expect(RENDER_CONFIG.post.atmosphere.cloudShadowStrength).toBeGreaterThanOrEqual(0.32);
    expect(RENDER_CONFIG.post.atmosphere.cloudScale).toBeLessThanOrEqual(150);
    expect(RENDER_CONFIG.post.atmosphere.hazeStrength).toBeLessThanOrEqual(0.05);
    expect(RENDER_CONFIG.post.atmosphere.hazeStart).toBeGreaterThanOrEqual(80);
  });
});

describe('ambient airborne dust', () => {
  it('is disabled on low and yields almost completely to rain', () => {
    expect(ambientDustRateForTier(0)).toBe(0);
    expect(ambientDustRateForTier(3, 1)).toBeCloseTo(1.44, 10);
    expect(ambientDustRateForTier(3, 1)).toBeLessThan(ambientDustRateForTier(2, 0));
  });

  it('uses deterministic bounded samples without simulation RNG', () => {
    expect(ambientDustSample(17)).toEqual(ambientDustSample(17));
    expect(ambientDustSample(17)).not.toEqual(ambientDustSample(18));
    for (let i = 0; i < 128; i++) {
      const sample = ambientDustSample(i);
      expect(sample.radius).toBeGreaterThanOrEqual(7);
      expect(sample.radius).toBeLessThanOrEqual(45);
      expect(sample.height).toBeGreaterThanOrEqual(0.75);
      expect(sample.height).toBeLessThanOrEqual(5.15);
      expect(sample.size0).toBeGreaterThanOrEqual(0.24);
      expect(sample.size1).toBeLessThanOrEqual(0.85);
      expect(sample.alpha).toBeGreaterThanOrEqual(0.22);
      expect(sample.alpha).toBeLessThanOrEqual(0.4);
    }
  });
});
