/**
 * Batch 8's rollback and ownership contract. Live GPU parity is exercised by
 * tools/gpu-frame-ab.mjs --foliage-compute-audit; these node tests keep the
 * policy and the no-readback frame seam from drifting on machines without GPU.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  isFoliageComputePilotKey,
  resolveFoliageComputeMode,
} from '../src/world/Scatter';

describe('WebGPU foliage compute pilot policy', () => {
  it('is impossible on either WebGL backend', () => {
    expect(resolveFoliageComputeMode('webgl', '?foliagecompute=gpu')).toBe('cpu');
    expect(resolveFoliageComputeMode('webgl2-fallback', '?foliagecompute=gpu')).toBe('cpu');
    expect(resolveFoliageComputeMode(undefined, '?foliagecompute=gpu')).toBe('cpu');
  });

  it('has an immediate same-build CPU rollback', () => {
    expect(resolveFoliageComputeMode('webgpu', '')).toBe('cpu');
    expect(resolveFoliageComputeMode('webgpu', '?foliagecompute=cpu')).toBe('cpu');
    expect(resolveFoliageComputeMode('webgpu', '?foliagecompute=off')).toBe('cpu');
    expect(resolveFoliageComputeMode('webgpu', '?foliagecompute=gpu')).toBe('gpu');
  });

  it('keeps atomic append away from temporal accumulation modes', () => {
    expect(resolveFoliageComputeMode('webgpu', '?foliagecompute=gpu&aa=traa')).toBe('cpu');
    expect(resolveFoliageComputeMode('webgpu', '?foliagecompute=gpu&aa=taau')).toBe('cpu');
  });

  it('proves only one canopy and one shrub family in this batch', () => {
    expect(isFoliageComputePilotKey('tree')).toBe(true);
    expect(isFoliageComputePilotKey('bush')).toBe(true);
    for (const key of ['treeAutumn', 'conifer', 'palm', 'hedge', 'grassTuft']) {
      expect(isFoliageComputePilotKey(key), key).toBe(false);
    }
  });
});

describe('foliage compute frame/readback boundary', () => {
  const source = readFileSync(fileURLToPath(
    new URL('../src/render/FoliageComputeNodeController.ts', import.meta.url),
  ), 'utf8');

  it('does no GPU readback from update()', () => {
    const update = source.slice(source.indexOf('    update(camera'), source.indexOf('    setLive('));
    expect(update).not.toContain('getArrayBufferAsync');
  });

  it('contains readback only in the explicitly async audit seam', () => {
    const audit = source.slice(source.indexOf('    async audit()'), source.indexOf('    dispose()'));
    expect(audit).toContain('getArrayBufferAsync(indirectAttr)');
    expect(audit).toContain('getArrayBufferAsync(outputIdAttr)');
  });

  it('keeps the pilot under a hard four-MiB storage ceiling', () => {
    expect(source).toContain('const MAX_STORAGE_BYTES = 4 * 1024 * 1024');
    expect(source).toContain('storageBytes > MAX_STORAGE_BYTES');
  });

  it('gates non-zero firstInstance before installing indirect draws', () => {
    expect(source).toContain("renderer.hasFeature('indirect-first-instance')");
  });
});

describe('foliage compute device-request isolation', () => {
  const install = readFileSync(fileURLToPath(
    new URL('../src/render/gpu-path-install.ts', import.meta.url),
  ), 'utf8');

  it('requests the elevated storage limit only for the explicit non-temporal lab', () => {
    expect(install).toContain('const foliageComputeRequested =');
    expect(install).toContain('...(foliageComputeRequested');
    expect(install).toContain('maxStorageBuffersPerShaderStage: 16');
    expect(install).toContain("params.get('scatterbatch')?.toLowerCase() !== 'legacy'");
  });
});
