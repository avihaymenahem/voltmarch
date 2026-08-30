import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BootTelemetryRecorder } from '../src/core/boot-telemetry';

function fakePerformance() {
  let clock = 10;
  const entries = new Map<string, PerformanceEntry[]>();
  return {
    perf: {
      timeOrigin: 1_000,
      now: () => clock,
      getEntriesByType: (type: string) => entries.get(type) ?? [],
      setResourceTimingBufferSize: () => undefined,
    },
    advance(ms: number) { clock += ms; },
    entries,
  };
}

describe('boot telemetry recorder', () => {
  it('is a true no-op when the profile flag is absent', () => {
    const fake = fakePerformance();
    const recorder = new BootTelemetryRecorder(false, fake.perf);
    recorder.mark('app', 'ignored');
    const finish = recorder.beginSpan('gpu', 'ignored');
    fake.advance(25);
    finish();
    recorder.recordLongTask({ startTime: 4, duration: 55 });

    expect(recorder.report()).toMatchObject({
      enabled: false,
      runs: [],
      marks: [],
      spans: [],
      resources: [],
      longTasks: { supported: false, entries: [] },
    });
  });

  it('records bounded marks and idempotent wall-clock spans without driving work', () => {
    const fake = fakePerformance();
    const recorder = new BootTelemetryRecorder(true, fake.perf);
    recorder.beginRun({ scenario: 'unit-test' });
    recorder.mark('registry', 'systems-published', { registered: 42 });
    const finish = recorder.beginSpan('gpu', 'pipeline-compile', { backend: 'webgpu' });
    fake.advance(17.5);
    finish('ok', { reused: false });
    fake.advance(100);
    finish('error');

    const report = recorder.report();
    expect(report.marks[0]).toEqual({
      runId: 1,
      category: 'registry',
      name: 'systems-published',
      atMs: 10,
      detail: { registered: 42 },
    });
    expect(report.spans).toEqual([{
      runId: 1,
      category: 'gpu',
      name: 'pipeline-compile',
      atMs: 10,
      durationMs: 17.5,
      status: 'ok',
      detail: { backend: 'webgpu', reused: false },
    }]);
  });

  it('sanitises resource URLs while retaining network and desktop protocol evidence', () => {
    const fake = fakePerformance();
    fake.entries.set('resource', [{
      name: 'app://user:secret@voltmarch/assets/tank.glb?rev=7',
      entryType: 'resource',
      startTime: 12,
      duration: 30,
      initiatorType: 'fetch',
      fetchStart: 12,
      requestStart: 13,
      responseStart: 20,
      responseEnd: 42,
      transferSize: 1_024,
      encodedBodySize: 900,
      decodedBodySize: 1_800,
      serverTiming: [{ name: 'vm_protocol_open', duration: 4.25 }],
      toJSON: () => ({}),
    } as unknown as PerformanceResourceTiming]);
    const recorder = new BootTelemetryRecorder(true, fake.perf, 'app://voltmarch/');

    expect(recorder.report().resources[0]).toMatchObject({
      path: '/assets/tank.glb',
      protocol: 'app',
      transferSize: 1_024,
      serverTiming: [{ name: 'vm_protocol_open', durationMs: 4.25 }],
    });
    expect(JSON.stringify(recorder.report())).not.toContain('secret');
  });
});

describe('boot telemetry wiring', () => {
  const repo = path.resolve(__dirname, '..', '..', '..');
  const read = (file: string): string => readFileSync(path.join(repo, file), 'utf8');
  const main = read('apps/game/src/main.ts');
  const bootstrap = read('apps/game/src/game/Bootstrap.ts');
  const profiler = read('tools/boot-profile.mjs');
  const desktop = read('apps/desktop/src/main.ts');
  const terrainMask = read('apps/game/src/world/terrain-detail-mask.ts');

  it('publishes readiness only after the boot paint and stable presented frames', () => {
    const paint = bootstrap.indexOf('renderOnce(shotMode ? 0 : 1 / 60)');
    const gameReady = bootstrap.indexOf("markBootPhase('app', 'game.ready'");
    expect(paint).toBeGreaterThanOrEqual(0);
    expect(gameReady).toBeGreaterThan(paint);

    const frame = main.indexOf('await nextPresentedFrame();');
    const stable = main.indexOf("markBootPhase('app', 'first-stable-frame'", frame);
    expect(stable).toBeGreaterThan(frame);
  });

  it('profiles built-browser boot through the existing debug hook', () => {
    expect(bootstrap).toContain('bootReport: bootTelemetryReport');
    expect(profiler).toContain("qs.set('bootprofile', '1')");
    expect(profiler).toContain('hooks?.bootReport?.()');
    expect(profiler).toContain('cacheWarmMedianSpanTotalsMs');
  });

  it('exposes streamed custom-protocol open timing without buffering response bodies', () => {
    expect(desktop).toContain('vm_protocol_open;dur=');
    expect(desktop).toContain('new Response(res.body');
    expect(desktop).not.toContain('await res.arrayBuffer()');
  });

  it('records the boot-critical decoded terrain image at its existing readiness barrier', () => {
    const begin = terrainMask.indexOf("beginBootSpan('texture', 'image-source-ready'");
    const ready = terrainMask.indexOf('finish();', begin);
    const resolve = terrainMask.indexOf('resolve(mask);', ready);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(begin);
    expect(resolve).toBeGreaterThan(ready);
  });
});
