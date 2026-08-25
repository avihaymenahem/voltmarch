import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CurrentGradeBaseline {
  version: number;
  capture: { width: number; height: number; tier: string; sceneCount: number };
  files: string[];
  scenes: Record<string, Record<string, number>>;
}

const root = resolve(import.meta.dirname, '..', '..', '..');
const tool = readFileSync(resolve(root, 'tools/metrics.mjs'), 'utf8');
const baseline = JSON.parse(
  readFileSync(resolve(root, 'docs/grade-current-1440p.json'), 'utf8'),
) as CurrentGradeBaseline;

describe('the current-renderer screenshot grade', () => {
  it('is a complete, scene-paired 2560x1440 medium-tier calibration', () => {
    expect(baseline.version).toBe(1);
    expect(baseline.capture).toEqual({
      width: 2560,
      height: 1440,
      tier: 'medium',
      sceneCount: 13,
    });
    expect(baseline.files).toHaveLength(13);
    expect(Object.keys(baseline.scenes)).toHaveLength(13);
    for (let i = 1; i <= 13; i++) {
      const prefix = `${String(i).padStart(2, '0')}-`;
      const file = baseline.files.find((name) => name.startsWith(prefix));
      expect(file, `missing canonical scene ${prefix}`).toBeDefined();
      expect(Object.keys(baseline.scenes[file!])).toEqual([
        'medianLuminance', 'meanSaturation', 'vividPixelFrac',
        'p1Luminance', 'p99Luminance', 'greenHueLeak',
        'farNearSatDelta', 'edgeCoverage', 'satLumMonotonic',
      ]);
    }
  });

  it('refuses to transfer the resolution-sensitive calibration to another geometry', () => {
    expect(tool).toContain("args[0] === '--calibrate-current'");
    expect(tool).toContain("!sizes.has('2560x1440')");
    expect(tool).toContain('currentGeometry === `${r.width}x${r.height}`');
    expect(tool).toContain("const source = calibrated === null ? ' global' : ' current-1440p'");
  });

  it('keeps lifted blacks behind an absolute safety rail', () => {
    expect(tool).toContain("p1Luminance:     { kind: 'ceiling'");
    expect(tool).toContain('return [hardLo, hardHi]');
  });
});
