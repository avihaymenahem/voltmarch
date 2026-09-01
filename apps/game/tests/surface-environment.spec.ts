import { describe, expect, it } from 'vitest';

import { BIOMES } from '../src/world/Biomes';
import { createRoadNodeMaterials } from '../src/world/RoadNodeMaterial';
import { createTerrainNodeMaterials } from '../src/world/TerrainNodeMaterial';
import {
  resetSurfaceEnvironment,
  SURFACE_ENVIRONMENT_CAUSES,
  surfaceEnvironmentCauseForMap,
  stepSurfaceEnvironment,
  surfaceEnvironmentState,
} from '../src/world/surface-environment';

describe('shared surface environment', () => {
  it('resolves explicit map causes without allocating or inferring unknown maps', () => {
    for (const map of ['coast', 'tropical', 'atoll', 'snow'] as const) {
      expect(surfaceEnvironmentCauseForMap(map)).toBe(SURFACE_ENVIRONMENT_CAUSES[map]);
      expect(surfaceEnvironmentCauseForMap(map)).toBe(surfaceEnvironmentCauseForMap(map));
      expect(Object.isFrozen(surfaceEnvironmentCauseForMap(map))).toBe(true);
    }
    expect(surfaceEnvironmentCauseForMap('temperate')).toBe(SURFACE_ENVIRONMENT_CAUSES.inland);
    expect(surfaceEnvironmentCauseForMap('urban')).toBe(SURFACE_ENVIRONMENT_CAUSES.inland);
    expect(surfaceEnvironmentCauseForMap('unknown-coast-name')).toBe(SURFACE_ENVIRONMENT_CAUSES.inland);
    expect(surfaceEnvironmentCauseForMap(null)).toBe(SURFACE_ENVIRONMENT_CAUSES.inland);
  });

  it('authors ordered coast/tropical/atoll exposure and snow-only contamination', () => {
    const identity = resetSurfaceEnvironment(
      'temperate', 0.2, surfaceEnvironmentCauseForMap('coast'),
    );
    const coast = { shore: identity.shoreWetness, salt: identity.salt };
    expect(identity.snowContamination).toBe(0);

    expect(resetSurfaceEnvironment(
      'desert', 0.2, surfaceEnvironmentCauseForMap('tropical'),
    )).toBe(identity);
    const tropical = { shore: identity.shoreWetness, salt: identity.salt };
    expect(tropical.shore).toBeGreaterThan(coast.shore);
    expect(tropical.salt).toBeGreaterThan(coast.salt);

    resetSurfaceEnvironment('desert', 0.2, surfaceEnvironmentCauseForMap('atoll'));
    expect(identity.shoreWetness).toBeGreaterThan(tropical.shore);
    expect(identity.salt).toBeGreaterThan(tropical.salt);
    expect(identity.snowContamination).toBe(0);

    resetSurfaceEnvironment('snow', 0.2, surfaceEnvironmentCauseForMap('snow'));
    expect(identity.shoreWetness).toBe(0);
    expect(identity.salt).toBe(0);
    expect(identity.snowContamination).toBeCloseTo(0.10);
  });

  it('retains one allocation-free identity and reacts only to weather causes', () => {
    const identity = resetSurfaceEnvironment('desert', 0.2);
    expect(identity).toBe(surfaceEnvironmentState);
    expect(identity.dust).toBeCloseTo(0.62);

    const wetBefore = identity.wetness;
    const dustBefore = identity.dust;
    for (let i = 0; i < 80; i++) stepSurfaceEnvironment(0.25, 'rain', 0.8, 'desert', 0.3);
    expect(surfaceEnvironmentState).toBe(identity);
    expect(identity.wetness).toBeGreaterThan(wetBefore);
    expect(identity.dust).toBeLessThan(dustBefore);
    expect(identity.salt).toBe(0);

    const rainWetness = identity.wetness;
    for (let i = 0; i < 20; i++) stepSurfaceEnvironment(0.25, 'none', 0, 'desert', 0.4);
    expect(identity.wetness).toBeLessThan(rainWetness);
    expect(identity.wetness).toBeGreaterThan(0);
  });

  it('keeps tidal dampness, washes marine salt, then restores clear-weather residue', () => {
    const cause = surfaceEnvironmentCauseForMap('tropical');
    const identity = resetSurfaceEnvironment('desert', 0.1, cause);
    const initialShore = identity.shoreWetness;
    const initialSalt = identity.salt;
    for (let i = 0; i < 240; i++) stepSurfaceEnvironment(0.25, 'none', 0, 'desert', 0.2);
    const drySalt = identity.salt;
    expect(identity).toBe(surfaceEnvironmentState);
    expect(identity.shoreWetness).toBeCloseTo(initialShore, 5);
    expect(drySalt).toBeGreaterThan(initialSalt);

    for (let i = 0; i < 160; i++) stepSurfaceEnvironment(0.25, 'rain', 1, 'desert', 0.3);
    const washedSalt = identity.salt;
    expect(identity.shoreWetness).toBeGreaterThan(initialShore);
    expect(washedSalt).toBeLessThan(drySalt * 0.5);

    for (let i = 0; i < 320; i++) stepSurfaceEnvironment(0.25, 'none', 0, 'desert', 0.4);
    expect(identity.salt).toBeGreaterThan(washedSalt);
    expect(identity.shoreWetness).toBeGreaterThanOrEqual(initialShore);
  });

  it('buries dirty snow under fresh accumulation and never contaminates non-snow maps', () => {
    const identity = resetSurfaceEnvironment(
      'snow', 0, surfaceEnvironmentCauseForMap('snow'),
    );
    for (let i = 0; i < 240; i++) stepSurfaceEnvironment(0.25, 'none', 0, 'snow', 0.1);
    const exposed = identity.snowContamination;
    expect(exposed).toBeGreaterThan(0.10);

    for (let i = 0; i < 240; i++) stepSurfaceEnvironment(0.25, 'snow', 1, 'snow', 0.2);
    expect(identity.snow).toBeGreaterThan(0.95);
    expect(identity.snowContamination).toBeLessThan(exposed * 0.5);

    resetSurfaceEnvironment('temperate', 0, surfaceEnvironmentCauseForMap('coast'));
    for (let i = 0; i < 240; i++) stepSurfaceEnvironment(0.25, 'snow', 1, 'temperate', 0.2);
    expect(identity.snow).toBeGreaterThan(0.95);
    expect(identity.snowContamination).toBe(0);
  });

  it('clamps malformed external cause values during reset', () => {
    const identity = resetSurfaceEnvironment('temperate', Number.NaN, {
      shoreDampness: 99,
      saltExposure: Number.NaN,
      snowGround: -4,
    });
    expect(identity.dayPhase).toBe(0);
    expect(identity.shoreWetness).toBe(1);
    expect(identity.salt).toBe(0);
    expect(identity.snowContamination).toBe(0);
  });

  it('copies into retained WebGPU terrain and road uniforms without replacing them', () => {
    const terrain = createTerrainNodeMaterials({
      biome: BIOMES.temperate,
      layerTextureSize: 8,
      seed: 1234,
    });
    const roads = createRoadNodeMaterials(4);
    const terrainUniform = terrain.uniforms.uSurfaceEnvironment.value;
    const roadUniform = roads.uniforms.uSurfaceEnvironment.value;
    const state = resetSurfaceEnvironment('urban', 0.1);
    for (let i = 0; i < 24; i++) stepSurfaceEnvironment(0.25, 'rain', 0.7, 'urban', 0.2);

    terrain.setSurfaceEnvironment(state);
    roads.setSurfaceEnvironment(state);
    expect(terrain.uniforms.uSurfaceEnvironment.value).toBe(terrainUniform);
    expect(roads.uniforms.uSurfaceEnvironment.value).toBe(roadUniform);
    expect(terrainUniform.toArray()).toEqual([
      state.wetness, state.dust, state.snow, state.contact,
    ]);
    expect(roadUniform.toArray()).toEqual(terrainUniform.toArray());

    terrain.dispose();
    roads.dispose();
  });
});
