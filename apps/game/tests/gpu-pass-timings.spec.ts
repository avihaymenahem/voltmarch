import { describe, expect, it } from 'vitest';
import {
  GPU_PASS_COUNT,
  gpuPassIndex,
  classifyGpuBottleneck,
  type GpuPassId,
  type GpuPassSnapshot,
} from '../src/render/gpu-pass-timings';
import { chooseAdaptiveLever } from '../src/render/adaptive-res.system';

function snapshot(total: number, values: Partial<Record<GpuPassId, number>>): GpuPassSnapshot {
  const out: Array<number | null> = Array<number | null>(GPU_PASS_COUNT).fill(null);
  out[gpuPassIndex('total')] = total;
  for (const [id, value] of Object.entries(values)) out[gpuPassIndex(id as GpuPassId)] = value ?? null;
  return { revision: 1, values: out };
}

describe('GPU pass bottleneck classification', () => {
  it('refuses to steer from an unavailable or partial clock', () => {
    expect(classifyGpuBottleneck(null)).toBe('unknown');
    expect(classifyGpuBottleneck({ revision: 0, values: Array(GPU_PASS_COUNT).fill(null) })).toBe('unknown');
    expect(classifyGpuBottleneck(snapshot(10, {}))).toBe('unknown');
    expect(snapshot(10, {}).values[gpuPassIndex('ui')]).toBeNull();
  });

  it('selects targeted shadow and AO levers before resolution', () => {
    expect(classifyGpuBottleneck(snapshot(10, { shadow: 3.1, scene: 4 }))).toBe('shadow');
    expect(classifyGpuBottleneck(snapshot(10, { ao: 2.3, scene: 4 }))).toBe('ao');
  });

  it('identifies scene subsystems and full-screen fill pressure', () => {
    expect(classifyGpuBottleneck(snapshot(10, { water: 2.4, scene: 5 }))).toBe('water');
    expect(classifyGpuBottleneck(snapshot(10, { particles: 2.4, scene: 5 }))).toBe('particles');
    expect(classifyGpuBottleneck(snapshot(10, { bloom: 1.5, grade: 1, smaa: 0.6 }))).toBe('fill-rate');
    expect(classifyGpuBottleneck(snapshot(10, { scene: 4.6 }))).toBe('scene');
  });

  it('accounts for experimental GI separately and scales resolution when it dominates', () => {
    expect(gpuPassIndex('gi')).toBeGreaterThan(gpuPassIndex('ao'));
    expect(classifyGpuBottleneck(snapshot(10, { gi: 2.4, scene: 4 }))).toBe('fill-rate');
  });

  it('maps measured pressure to a targeted lever and leaves CPU stalls alone', () => {
    expect(chooseAdaptiveLever('shadow', 18, 22, true)).toBe('shadow');
    expect(chooseAdaptiveLever('ao', 18, 22, true)).toBe('ao');
    expect(chooseAdaptiveLever('fill-rate', 18, 22, true)).toBe('resolution');
    expect(chooseAdaptiveLever('scene', 7, 22, true)).toBe('cpu');
    expect(chooseAdaptiveLever('shadow', 8, 12, false)).toBe('restore');
  });
});
