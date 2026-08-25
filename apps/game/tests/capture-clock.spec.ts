/**
 * ============================================================================
 * THE CAPTURE CLOCK AND THE LOCKSTEP ADVANCE
 * ============================================================================
 * `tools/shoot.mjs` produces the twelve images the whole visual critique is
 * argued from. Two captures of one build used to differ in ALL TWELVE — worst
 * graded-metric drift 0.0146, which is larger than most real art changes — and
 * the reason was that the harness bought time from the wall clock while the
 * presentation aged per RENDERED FRAME.
 *
 * Four mechanisms in `core/loop.ts` fix that, and this file is what stops them
 * quietly regressing. None of them can be covered by the screenshot harness
 * itself: a harness that has stopped being deterministic still produces twelve
 * confident PNGs.
 *
 *   captureClock    an organic frame is worth EXACTLY zero time
 *   advanceFrames   n complete system frames at exactly SIM_DT, sim untouched
 *   advanceTicks    n sim steps, each with its own frame, in lockstep
 *   captureFrame    one COMPLETE frame — systems included — for screenshot()
 *
 * The last one is the one with a scar: the debug hook used to be a bare
 * present, so `__VM.screenshot()` returned the frame before any work queued for
 * the next system frame had run, and an investigation concluded from that image
 * that an explosion was absent.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { GameLoop, Profiler, SystemRegistry } from '../src/core/loop';
import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import { SIM_DT } from '../src/core/config';
import type { RenderContext, SystemModule } from '../src/core/types';

interface FrameRecord {
  dt: number;
  time: number;
  frame: number;
  alpha: number;
}

interface Harness {
  loop: GameLoop;
  /** One entry per frame the registry ran, in order. */
  frames: FrameRecord[];
  /** One entry per sim tick. */
  ticks: number[];
  /** Frames that went all the way to a draw. */
  presented: { n: number };
  /** Frames that ran the host work but did not draw. */
  hosted: { n: number };
}

function harness(): Harness {
  const world = new World();
  const channels = new Channels();
  const registry = new SystemRegistry(new Profiler());

  const frames: FrameRecord[] = [];
  const ticks: number[] = [];
  const presented = { n: 0 };
  const hosted = { n: 0 };

  const mod: SystemModule = {
    id: 'test.captureClock',
    simTick(ctx) {
      ticks.push(ctx.tick);
    },
    frame(ctx: RenderContext) {
      frames.push({ dt: ctx.dt, time: ctx.time, frame: ctx.frame, alpha: ctx.alpha });
    },
  };
  registry.add(mod);

  const loop = new GameLoop(world, channels, registry, {
    render: () => { presented.n++; },
    hostFrame: () => { hosted.n++; },
  }, 7);

  return { loop, frames, ticks, presented, hosted };
}

describe('GameLoop.captureFrame — a screenshot runs the SYSTEMS, not just the draw', () => {
  it('runs every frame system before presenting', () => {
    const h = harness();
    expect(h.frames).toHaveLength(0);

    h.loop.captureFrame();

    // The defect: this used to be zero, because the capture hook presented the
    // scene without ever calling registry.runFrame. Anything queued for the
    // next system frame had therefore not run when the pixels were read.
    expect(h.frames).toHaveLength(1);
    expect(h.presented.n).toBe(1);
  });

  it('ages nothing by itself — dt defaults to zero', () => {
    const h = harness();
    h.loop.captureFrame();
    expect(h.frames[0].dt).toBe(0);
    expect(h.loop.wallTime).toBe(0);
  });

  it('does not step the simulation', () => {
    const h = harness();
    h.loop.captureFrame();
    expect(h.ticks).toHaveLength(0);
    expect(h.loop.tick).toBe(0);
  });
});

describe('GameLoop.advanceFrames — presentation time, exactly', () => {
  it('runs exactly n frames, each of exactly SIM_DT', () => {
    const h = harness();
    h.loop.advanceFrames(90);

    expect(h.frames).toHaveLength(90);
    for (const f of h.frames) expect(f.dt).toBe(SIM_DT);
    // The render clock advances by the frames, and by nothing else.
    expect(h.loop.wallTime).toBeCloseTo(90 * SIM_DT, 10);
    expect(h.frames[89].time).toBeCloseTo(90 * SIM_DT, 10);
  });

  it('leaves the simulation exactly where it was', () => {
    const h = harness();
    h.loop.runHeadless(120);
    const tickAfterSettle = h.loop.tick;

    h.loop.advanceFrames(300);

    expect(h.loop.tick).toBe(tickAfterSettle);
    expect(h.ticks).toHaveLength(120);
  });

  it('presents once, on the last frame, and hosts the rest', () => {
    const h = harness();
    h.loop.advanceFrames(10);
    // Presenting all ten would be ten full draws for one image; skipping the
    // host work would leave camera damping and shake frozen mid-decay.
    expect(h.presented.n).toBe(1);
    expect(h.hosted.n).toBe(9);
  });

  it('is a no-op for zero or negative counts', () => {
    const h = harness();
    h.loop.advanceFrames(0);
    h.loop.advanceFrames(-5);
    expect(h.frames).toHaveLength(0);
    expect(h.presented.n).toBe(0);
  });

  it('produces the same frame sequence every run — no clock, no scheduler', () => {
    const a = harness();
    const b = harness();
    a.loop.advanceFrames(45);
    b.loop.advanceFrames(45);
    expect(a.frames).toEqual(b.frames);
  });
});

describe('GameLoop.advanceTicks — simulation and presentation in lockstep', () => {
  it('pairs every tick with exactly one frame', () => {
    const h = harness();
    h.loop.advanceTicks(60);

    expect(h.ticks).toHaveLength(60);
    expect(h.frames).toHaveLength(60);
    expect(h.loop.tick).toBe(60);
    for (const f of h.frames) expect(f.dt).toBe(SIM_DT);
  });

  it('renders ON the tick, never between two', () => {
    const h = harness();
    h.loop.advanceTicks(5);
    // alpha 1 means "fully at the current tick". A fixed step never lands
    // between two, so interpolating would smear the frame the harness declared.
    for (const f of h.frames) expect(f.alpha).toBe(1);
  });

  it('keeps the render clock in step with simulated time', () => {
    const h = harness();
    h.loop.advanceTicks(30);
    expect(h.loop.simTime).toBeCloseTo(30 * SIM_DT, 10);
    expect(h.loop.wallTime).toBeCloseTo(30 * SIM_DT, 10);
  });

  it('is reproducible across two fresh loops', () => {
    const a = harness();
    const b = harness();
    a.loop.advanceTicks(37);
    b.loop.advanceTicks(37);
    expect(a.ticks).toEqual(b.ticks);
    expect(a.frames).toEqual(b.frames);
  });
});

describe('GameLoop.captureClock — an organic frame is worth zero time', () => {
  /** Let the loop's own scheduler drive real frames for a moment. */
  const spin = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

  it('defaults off, so live play is untouched', () => {
    expect(harness().loop.captureClock).toBe(false);
  });

  it('a running loop accumulates NO render time while it is on', async () => {
    const h = harness();
    h.loop.captureClock = true;
    h.loop.start();
    await spin(200);
    h.loop.stop();

    // Frames happened — this is not a vacuous pass.
    expect(h.loop.frame).toBeGreaterThan(0);
    expect(h.frames.length).toBeGreaterThan(0);
    // ...and every one of them was worth exactly nothing. That is what makes a
    // capture independent of how many frames the boot happened to take.
    expect(h.loop.wallTime).toBe(0);
    for (const f of h.frames) expect(f.dt).toBe(0);
    // The simulation does not tick either, and that is the point rather than a
    // side effect: with the implicit clock silenced the ONLY way time moves is
    // an explicit `advanceFrames`/`advanceTicks`. `?shot=` also boots paused,
    // so this is belt and braces, but it is the belt that makes the capture a
    // function of the tick count and nothing else.
    expect(h.loop.tick).toBe(0);
  });

  it('the same loop with the flag off does accumulate real time', async () => {
    const h = harness();
    h.loop.start();
    await spin(200);
    h.loop.stop();

    expect(h.loop.frame).toBeGreaterThan(0);
    expect(h.loop.wallTime).toBeGreaterThan(0);
  });

  it('does not change what an explicit advance is worth', () => {
    const h = harness();
    h.loop.captureClock = true;
    h.loop.advanceFrames(10);
    for (const f of h.frames) expect(f.dt).toBe(SIM_DT);
    expect(h.loop.wallTime).toBeCloseTo(10 * SIM_DT, 10);
  });
});
