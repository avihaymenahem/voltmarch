import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tool = readFileSync(
  fileURLToPath(new URL('../../../tools/realism-baseline.mjs', import.meta.url)),
  'utf8',
);
const bootProfiler = readFileSync(
  fileURLToPath(new URL('../../../tools/boot-profile.mjs', import.meta.url)),
  'utf8',
);

describe('Phase 2-4 realism evidence contract', () => {
  it('measures the real Industrial Grid product setup at one deterministic tick', () => {
    expect(tool).toContain("map: 'industrial-grid'");
    expect(tool).toContain("preset: 'urban'");
    expect(tool).toContain("const PHASES = Object.freeze(['day', 'dusk', 'night'])");
    expect(tool).toContain("const TARGET_TICK = Number(value('tick', '120'))");
    expect(tool).toContain('vm.step(targetTick - before.tick)');
    expect(tool).toContain('prepared.checksum.tick !== TARGET_TICK');
  });

  it('uses only the existing critic phase override and changes no product feature flag', () => {
    expect(tool).toContain("tier: TIER, dayphase: phase, gpupasses: '1'");
    expect(tool).not.toContain("query.set('gi'");
    expect(tool).not.toContain("query.set('worldstories'");
    expect(tool).not.toContain("query.set('surfaceaging'");
  });

  it('proves camera movement cannot alter simulation and warms lazy programs first', () => {
    expect(tool).toContain('checksumsAfterCameraMotion');
    expect(tool).toContain("id: `${phase.phase}.simulation-invariance`");
    expect(tool).toContain('const warmPrograms = vm.stats().programs');
    expect(tool).toContain("id: `${phase.phase}.program-stability`");
  });

  it('records the renderer counters and GPU timings needed for every graphics batch', () => {
    for (const field of [
      'gpuPasses', 'drawCallsByPass', 'triangles', 'programs',
      'geometries', 'textures', 'textureMB',
    ]) expect(tool).toContain(field);
    expect(tool).toContain('cameraPanGpuP95RatioMax: 1.15');
    expect(tool).toContain('totalGpuRegressionPercentMax: 10');
    expect(tool).toContain('colourDrawCallsMax: 130');
    expect(tool).toContain('const GPU_SAMPLE_BLOCKS = 12');
    expect(tool).toContain('const GPU_SAMPLE_SPACING_FRAMES = 16');
  });

  it('charges the same fixture to boot time with a comparable profiler setup', () => {
    expect(bootProfiler).toContain("'14-industrial-grid-realism'");
    for (const line of [
      "map: 'industrial-grid'", "playerFaction: 'allies'", "aiFaction: 'soviets'",
      'startingCredits: 10_000', 'weather: false',
    ]) {
      expect(tool).toContain(line);
      expect(bootProfiler).toContain(line);
    }
    expect(tool).toContain("mark.name === 'first-stable-frame'");
    expect(tool).toContain('bootRegressionPercentMax: 10');
    expect(tool).toContain('bootRegressionFloorMs: 250');
  });
});
