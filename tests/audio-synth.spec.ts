/**
 * Audio synthesis — headless invariants.
 *
 * There is no WebAudio under vitest, so nothing here renders a buffer; the
 * spectra are measured separately by `tools/audio-measure.mjs` in headless
 * Chromium. What this file locks down is the class of bug that measurement
 * caught the hard way and that would silently come back: envelope helpers that
 * ignore the level they were given, a saturation curve with a DC offset, and a
 * bank that quietly grows past its memory budget.
 *
 * Each of these was a REAL defect found while overhauling the bank, not a
 * hypothetical. The `env` one in particular had been shipping since the module
 * was written and made every per-layer dB trim in every recipe dead code.
 */

import { describe, expect, it } from 'vitest';

import {
  dbToGain, env, envSustain, makeSatCurve, makeShaperCurve,
} from '../src/audio/AudioEngine';
import { SFX, collectSfxBank } from '../src/audio/Weapons';

/* -------------------------------------------------------------------------- */
/* A minimal AudioParam stand-in                                              */
/* -------------------------------------------------------------------------- */

interface Event { kind: string; value: number; time: number }

/**
 * Just enough of `AudioParam` for the envelope helpers, plus a record of every
 * scheduled point. `value` behaves like the real thing: it is the construction
 * value until something writes it.
 */
function fakeParam(initial: number): AudioParam & { events: Event[] } {
  const events: Event[] = [];
  const p = {
    value: initial,
    events,
    setValueAtTime(v: number, t: number) { events.push({ kind: 'set', value: v, time: t }); return p; },
    linearRampToValueAtTime(v: number, t: number) {
      events.push({ kind: 'lin', value: v, time: t }); return p;
    },
    exponentialRampToValueAtTime(v: number, t: number) {
      events.push({ kind: 'exp', value: v, time: t }); return p;
    },
    setTargetAtTime() { return p; },
    setValueCurveAtTime() { return p; },
    cancelScheduledValues() { return p; },
    cancelAndHoldAtTime() { return p; },
    automationRate: 'a-rate' as AutomationRate,
    defaultValue: initial,
    maxValue: 3.4e38,
    minValue: -3.4e38,
  };
  return p as unknown as AudioParam & { events: Event[] };
}

const peakOf = (p: { events: Event[] }): number => Math.max(...p.events.map((e) => e.value));

/* -------------------------------------------------------------------------- */

describe('envelope helpers respect the level they were built with', () => {
  it('env scales its peak by the param value, not over it', () => {
    // A layer written as `gain(oc, dbToGain(-20))` then `env(g.gain, 0, 1, 1, 100)`
    // must peak at -20 dB. It used to peak at 0 dB, which meant every recipe's
    // documented layer balance was fiction and every sound was a flat sum.
    const quiet = fakeParam(dbToGain(-20));
    env(quiet, 0, 1, 1.0, 100);
    expect(peakOf(quiet)).toBeCloseTo(dbToGain(-20), 6);

    const unity = fakeParam(1);
    env(unity, 0, 1, 1.0, 100);
    expect(peakOf(unity)).toBeCloseTo(1, 6);
  });

  it('env still honours an explicit relative peak', () => {
    const p = fakeParam(dbToGain(-6));
    env(p, 0, 1, 0.5, 100);
    expect(peakOf(p)).toBeCloseTo(dbToGain(-6) * 0.5, 6);
  });

  it('envSustain scales both the peak and the sustain shelf', () => {
    const p = fakeParam(dbToGain(-12));
    envSustain(p, 0, 10, 1.0, 50, 0.5, 100, 200);
    expect(peakOf(p)).toBeCloseTo(dbToGain(-12), 6);
    const shelf = p.events.filter((e) => e.kind === 'exp')[0];
    expect(shelf.value).toBeCloseTo(dbToGain(-12) * 0.5, 6);
  });

  it('never schedules an exponential ramp to zero', () => {
    // The Web Audio spec throws on a zero target, and a throw inside a bake is
    // a silently missing sound rather than a crash anyone would notice.
    const p = fakeParam(dbToGain(-40));
    env(p, 0, 1, 1.0, 100);
    envSustain(p, 1, 10, 1.0, 50, 0.4, 100, 200);
    for (const e of p.events) {
      if (e.kind === 'exp') expect(e.value).toBeGreaterThan(0);
    }
  });

  it('schedules in non-decreasing time order', () => {
    const p = fakeParam(1);
    envSustain(p, 0.25, 10, 1.0, 50, 0.5, 100, 200);
    for (let i = 1; i < p.events.length; i++) {
      expect(p.events[i].time).toBeGreaterThanOrEqual(p.events[i - 1].time);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('saturation curve', () => {
  const K = 2.6;
  const ASYM = 0.15;
  const curve = makeSatCurve(K, ASYM, 2049);
  const at = (x: number): number => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

  it('passes through the origin', () => {
    // Centring the curve on the midpoint of its own range instead put silence
    // at +0.16, so every baked buffer carried a DC step that the peak
    // normaliser then scaled the real sound against.
    expect(at(0)).toBeCloseTo(0, 6);
  });

  it('stays inside [-1, 1] and reaches the rail on one side', () => {
    let max = 0;
    for (const v of curve) {
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
      max = Math.max(max, Math.abs(v));
    }
    expect(max).toBeCloseTo(1, 4);
  });

  it('is monotonic, so it is a saturator and not a folder', () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });

  it('actually compresses — small signals gain, large signals do not', () => {
    const smallSlope = (at(0.02) - at(-0.02)) / 0.04;
    const largeSlope = (at(1) - at(0.9)) / 0.1;
    expect(smallSlope).toBeGreaterThan(largeSlope * 2);
  });

  it('is asymmetric, which is where the even harmonics come from', () => {
    // A symmetric transfer function produces odd harmonics only and reads as
    // fuzz rather than as loudness.
    expect(Math.abs(at(0.7) + at(-0.7))).toBeGreaterThan(0.02);
  });

  it('the symmetric tanh curve is still symmetric', () => {
    const sym = makeShaperCurve(4, 2049);
    const mid = (sym.length - 1) / 2;
    expect(sym[mid]).toBeCloseTo(0, 6);
    expect(sym[0]).toBeCloseTo(-sym[sym.length - 1], 6);
  });
});

/* -------------------------------------------------------------------------- */

describe('the baked bank', () => {
  const bank = collectSfxBank();

  it('registers every id in the SFX vocabulary exactly once', () => {
    const ids = bank.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.values(SFX)) expect(ids).toContain(id);
  });

  it('every spec is renderable', () => {
    for (const s of bank) {
      expect(s.seconds, s.id).toBeGreaterThan(0);
      expect(s.variants, s.id).toBeGreaterThanOrEqual(1);
      expect(typeof s.render, s.id).toBe('function');
      expect(s.db, s.id).toBeLessThanOrEqual(0);
    }
  });

  it('drive is a sane saturation amount wherever it is set', () => {
    for (const s of bank) {
      if (s.drive === undefined) continue;
      expect(s.drive, s.id).toBeGreaterThan(0);
      // Past ~5 the curve is a hard clip and the sound is fizz whatever it was.
      expect(s.drive, s.id).toBeLessThanOrEqual(5);
      if (s.driveAsym !== undefined) expect(Math.abs(s.driveAsym), s.id).toBeLessThan(0.4);
    }
  });

  it('engine loops carry no bake-time saturation', () => {
    // The saturator's DC-blocking highpass rings at the buffer edges, and a
    // seamless loop is nothing but buffer edges.
    for (const id of [SFX.engineLight, SFX.engineHeavy]) {
      const spec = bank.find((s) => s.id === id)!;
      expect(spec.drive ?? 0, id).toBe(0);
    }
  });

  it('only the biggest sources use the wide room', () => {
    const wide = bank.filter((s) => s.reverb === 'wide').map((s) => s.id);
    expect(wide).toContain(SFX.explosionLarge);
    expect(wide).toContain(SFX.artillery);
    // A rifle in a cathedral is the classic mistake.
    expect(wide).not.toContain(SFX.machineGun);
    expect(wide).not.toContain(SFX.uiClick);
  });

  it('stays inside the resident-memory budget', () => {
    // Every second of every variant is 192 kB of Float32 that lives for the
    // whole session. Measured at boot: 142 buffers, 18.0 MB.
    let seconds = 0;
    for (const s of bank) seconds += s.seconds * s.variants * (s.channels ?? 1);
    const mb = (seconds * 48_000 * 4) / 1048576;
    expect(mb).toBeLessThan(28);
  });

  it('gives repeated sounds enough variants to hide the repeat', () => {
    // A firefight plays these hundreds of times a minute; one baked sample is
    // the single most obvious tell in an RTS soundscape.
    for (const id of [SFX.machineGun, SFX.cannonLight, SFX.cannonHeavy, SFX.impactArmor]) {
      const spec = bank.find((s) => s.id === id)!;
      expect(spec.variants, id).toBeGreaterThanOrEqual(5);
      expect(spec.rateJitter ?? 0, id).toBeGreaterThan(0);
    }
  });

  it('UI sounds are non-positional and never crowd-summed', () => {
    for (const s of bank) {
      if (s.bus !== 'ui') continue;
      expect(s.positional, s.id).toBe(false);
      expect(s.noCrowd, s.id).toBe(true);
    }
  });
});
