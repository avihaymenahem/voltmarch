import { describe, expect, it } from 'vitest';

import { diagnosticSnapshot } from '../src/core/diagnostic-log';
import { Profiler } from '../src/core/loop';

describe('automatic hitch recorder', () => {
  it('keeps a rolling frame history and emits context only for long gaps', () => {
    const profiler = new Profiler();
    profiler.setHitchContextProvider((event) => ({
      render: { entities: 42, resolution: '1920x1080' },
      observedHistory: event.history.length,
    }));

    profiler.simMs = 0.75;
    profiler.recordFrame(8, 16.7, 10, 1);
    profiler.recordFrame(11, 49.9, 11, 2);
    expect(profiler.longFrameCount).toBe(0);

    profiler.recordFrame(13, 75, 12, 3);

    expect(profiler.longFrameCount).toBe(1);
    expect(profiler.lastLongFrameGapMs).toBe(75);
    expect(profiler.lastLongFrameCpuMs).toBe(13);
    expect(profiler.hitchHistory()).toEqual([
      { frame: 10, wallGapMs: 16.7, cpuMs: 8, simMs: 0.75, substeps: 1 },
      { frame: 11, wallGapMs: 49.9, cpuMs: 11, simMs: 0.75, substeps: 2 },
      { frame: 12, wallGapMs: 75, cpuMs: 13, simMs: 0.75, substeps: 3 },
    ]);

    const record = diagnosticSnapshot(1)[0];
    expect(record?.subsystem).toBe('performance');
    expect(record?.code).toBe('long-frame');
    const detail = record?.detail as {
      thresholdMs: number;
      hitch: { wallGapMs: number; cpuMs: number; history: readonly unknown[] };
      render: { entities: number };
      observedHistory: number;
    };
    expect(detail.thresholdMs).toBe(50);
    expect(detail.hitch.wallGapMs).toBe(75);
    expect(detail.hitch.cpuMs).toBe(13);
    expect(detail.hitch.history).toHaveLength(3);
    expect(detail.render.entities).toBe(42);
    expect(detail.observedHistory).toBe(3);
  });

  it('clears the rolling hitch history when the profiler is reset', () => {
    const profiler = new Profiler();
    profiler.recordFrame(10, 60, 1, 1);
    expect(profiler.hitchHistory()).toHaveLength(1);

    profiler.reset();

    expect(profiler.longFrameCount).toBe(0);
    expect(profiler.hitchHistory()).toHaveLength(0);
  });
});
