import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { settleEnvironmentAtlas } from '../src/world/EnvironmentAssetLoader';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const materialDir = resolve(
  root, 'packages/assets/game/environment/extended-foliage/material',
);
const report = JSON.parse(readFileSync(
  resolve(materialDir, 'extended-foliage-v1.ktx2-report.json'), 'utf8',
)) as {
  sourceBytes: number;
  outputBytes: number;
  transferRatio: number;
  rows: Array<{
    source: string; sourceBytes: number; sourceSha256: string;
    output: string; outputBytes: number; outputSha256: string;
  }>;
};

describe('extended foliage KTX2 promotion', () => {
  const texture = (): THREE.CompressedTexture => new THREE.CompressedTexture(
    [], 1, 1, THREE.RGBA_S3TC_DXT5_Format,
  );

  it('ships validated KTX2 bytes matching the frozen cook report', () => {
    let total = 0;
    for (const row of report.rows) {
      const source = readFileSync(resolve(materialDir, row.source));
      const bytes = readFileSync(resolve(materialDir, row.output));
      expect(source.byteLength).toBe(row.sourceBytes);
      expect(crypto.createHash('sha256').update(source).digest('hex')).toBe(row.sourceSha256);
      expect(bytes.subarray(0, 12).toString('hex')).toBe('ab4b5458203230bb0d0a1a0a');
      expect(bytes.byteLength).toBe(row.outputBytes);
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(row.outputSha256);
      total += bytes.byteLength;
    }
    expect(total).toBe(report.outputBytes);
    expect(report.outputBytes).toBeLessThan(report.sourceBytes);
    expect(report.transferRatio).toBeLessThan(0.9);
  });

  it('recooks byte-identically with the repository encoder', () => {
    execFileSync(process.execPath, [resolve(root, 'tools/promote-environment-atlas.mjs')], {
      cwd: root,
      stdio: 'pipe',
      timeout: 60_000,
    });
  }, 70_000);

  it('retires every fulfilled texture when one atlas map rejects', async () => {
    const base = texture();
    const normal = texture();
    const baseDispose = vi.spyOn(base, 'dispose');
    const normalDispose = vi.spyOn(normal, 'dispose');
    const failure = new Error('transcode failed');

    await expect(settleEnvironmentAtlas([
      Promise.resolve(base), Promise.reject(failure), Promise.resolve(normal),
    ])).rejects.toBe(failure);
    expect(baseDispose).toHaveBeenCalledOnce();
    expect(normalDispose).toHaveBeenCalledOnce();
  });

  it('publishes the complete atlas without disposing successful maps', async () => {
    const textures = [
      texture(), texture(), texture(),
    ];
    const disposals = textures.map((texture) => vi.spyOn(texture, 'dispose'));
    await expect(settleEnvironmentAtlas(textures.map(async (texture) => texture)))
      .resolves.toEqual(textures);
    for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();
  });
});
