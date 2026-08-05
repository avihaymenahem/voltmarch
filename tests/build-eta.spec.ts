/**
 * The build countdown must reflect the rate a build is ACTUALLY moving at.
 *
 * Reported: "the timer shows for example 5s, but takes twice and more".
 *
 * The old readout was `buildTime * (1 - progress)` — the time a build takes at
 * its nominal rate. Three things move the real rate and it knew about none of
 * them: `buildSpeedMul` (a continuous function of the power supply ratio),
 * `factorySpeed(factoryCount)`, and affordability, where `BuildQueue` charges
 * per tick and advances only the slice it managed to pay for. Two of the three
 * make a build take LONGER than advertised.
 *
 * These tests drive `estimateBuildEta` with a synthetic clock, so they assert
 * the arithmetic rather than a rendering.
 */

import { describe, expect, it } from 'vitest';

import { estimateBuildEta, type EtaSampler } from '../src/ui/Sidebar';

function sampler(): EtaSampler {
  return { lastProgress: -1, lastAt: 0, rate: 0 };
}

/**
 * Feed `steps` samples advancing `perSecond` of progress each second, and
 * return the final reported ETA.
 */
function run(
  s: EtaSampler, buildTime: number, perSecond: number, steps: number, startAt = 0,
): { eta: number; progress: number } {
  let progress = 0;
  let t = 1000;
  let eta = estimateBuildEta(s, startAt, false, buildTime, 0);
  progress = startAt;
  for (let i = 0; i < steps; i++) {
    progress = Math.min(0.999, progress + perSecond);
    eta = estimateBuildEta(s, progress, false, buildTime, t);
    t += 1000;
  }
  return { eta, progress };
}

describe('build countdown', () => {
  it('falls back to the nominal time before it has a sample', () => {
    // The first frame after queueing has nothing to measure, and the nominal
    // figure is right whenever nothing is throttling the build.
    const s = sampler();
    expect(estimateBuildEta(s, 0.5, false, 10, 0)).toBe(5);
  });

  it('reports the nominal time when the build runs at the nominal rate', () => {
    // 10 s build advancing 0.1/s is exactly on schedule.
    const s = sampler();
    const { eta, progress } = run(s, 10, 0.1, 5);
    expect(progress).toBeCloseTo(0.5, 5);
    expect(eta).toBeGreaterThanOrEqual(4);
    expect(eta).toBeLessThanOrEqual(6);
  });

  it('REPORTS DOUBLE when the build is actually running at half speed', () => {
    // THE BUG. A 10 s build crawling at 0.05/s takes 20 s. The old formula said
    // `10 * (1 - progress)` regardless — at the halfway mark it promised 5 s
    // while 10 s of work remained.
    const s = sampler();
    // Ten seconds in, halfway through a build the readout claimed was 10 s.
    const { eta, progress } = run(s, 10, 0.05, 10);
    const trueRemaining = (1 - progress) / 0.05;
    const nominalWouldSay = 10 * (1 - progress);

    expect(eta).toBeGreaterThan(nominalWouldSay * 1.5);
    expect(Math.abs(eta - trueRemaining)).toBeLessThan(trueRemaining * 0.25);
  });

  it('reports LESS than nominal when extra factories speed the build up', () => {
    // The error runs both ways: `factorySpeed()` makes builds faster, and a
    // nominal countdown is then pessimistic.
    const s = sampler();
    const { eta, progress } = run(s, 20, 0.2, 4);
    expect(eta).toBeLessThan(20 * (1 - progress));
  });

  it('shows nothing while a build is stalled rather than a frozen number', () => {
    // A build paying nothing is already announced by ON HOLD and EVA. A
    // countdown sitting at "5s" while nothing moves is the reported bug.
    const s = sampler();
    run(s, 10, 0.1, 5);
    let eta = 0;
    let t = 10_000;
    // Progress frozen: every sample repeats the same value.
    for (let i = 0; i < 400; i++) {
      eta = estimateBuildEta(s, 0.5, false, 10, t);
      t += 1000;
    }
    expect(eta).toBe(0);
  });

  it('does not carry one item\'s rate onto the next', () => {
    // `progress` going DOWN means the head of the queue changed. Keeping the
    // old rate would describe a different build entirely.
    const s = sampler();
    run(s, 10, 0.02, 20);
    const slowRate = s.rate;
    expect(slowRate).toBeGreaterThan(0);

    // A new, much faster item appears in the same slot.
    estimateBuildEta(s, 0.05, false, 4, 30_000);
    expect(s.rate).toBe(0);
  });

  it('reports nothing when ready, complete, or not started', () => {
    const s = sampler();
    expect(estimateBuildEta(s, 0.5, true, 10, 0)).toBe(0);
    expect(estimateBuildEta(s, 0, false, 10, 0)).toBe(0);
    expect(estimateBuildEta(s, 1, false, 10, 0)).toBe(0);
  });

  it('ignores a sample taken across a long frame gap', () => {
    // A tab switch or a stall drops frames; the delta across that gap is not a
    // rate. It must reseed, not record a spuriously slow reading.
    const s = sampler();
    run(s, 10, 0.1, 5);
    const before = s.rate;
    estimateBuildEta(s, 0.55, false, 10, 60_000); // 50 s later
    expect(s.rate).toBe(before);
  });

  it('suppresses an absurd figure rather than printing it', () => {
    const s = sampler();
    let t = 1000;
    let p = 0.001;
    let eta = 0;
    for (let i = 0; i < 40; i++) {
      p += 0.000_01;
      eta = estimateBuildEta(s, p, false, 10, t);
      t += 1000;
    }
    expect(eta).toBe(0);
  });
});
