import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  audioParamGuardStats,
  cancelAudioParamScheduledValues,
  exponentialRampAudioParamToValueAtTime,
  finiteAudioNumber,
  linearRampAudioParamToValueAtTime,
  resetAudioParamGuardForTest,
  setAudioParamTargetAtTime,
  setAudioParamValue,
  setAudioParamValueAtTime,
} from '../src/audio/AudioParamGuard';

interface ParamCall {
  readonly kind: string;
  readonly value?: number;
  readonly time: number;
  readonly timeConstant?: number;
}

function fakeAudioParam(initial = 1, min = -10, max = 10): AudioParam & { calls: ParamCall[] } {
  let current = initial;
  const calls: ParamCall[] = [];
  const finite = (value: number): void => {
    if (!Number.isFinite(value)) throw new TypeError('fake AudioParam received a non-finite number');
  };
  const param = {
    automationRate: 'a-rate' as AutomationRate,
    calls,
    defaultValue: initial,
    minValue: min,
    maxValue: max,
    setValueAtTime(value: number, time: number) {
      finite(value); finite(time); current = value;
      calls.push({ kind: 'set', value, time });
      return param;
    },
    linearRampToValueAtTime(value: number, time: number) {
      finite(value); finite(time); current = value;
      calls.push({ kind: 'linear', value, time });
      return param;
    },
    exponentialRampToValueAtTime(value: number, time: number) {
      finite(value); finite(time);
      if (value <= 0) throw new RangeError('fake exponential ramp target must be positive');
      current = value;
      calls.push({ kind: 'exponential', value, time });
      return param;
    },
    setTargetAtTime(value: number, time: number, timeConstant: number) {
      finite(value); finite(time); finite(timeConstant);
      if (timeConstant <= 0) throw new RangeError('fake time constant must be positive');
      current = value;
      calls.push({ kind: 'target', value, time, timeConstant });
      return param;
    },
    setValueCurveAtTime() { return param; },
    cancelScheduledValues(time: number) {
      finite(time); calls.push({ kind: 'cancel', time }); return param;
    },
    cancelAndHoldAtTime() { return param; },
  };
  Object.defineProperty(param, 'value', {
    enumerable: true,
    get: () => current,
    set: (value: number) => { finite(value); current = value; },
  });
  return param as unknown as AudioParam & { calls: ParamCall[] };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetAudioParamGuardForTest();
});

describe('AudioParam finite-number boundary', () => {
  it('repairs NaN and both infinities before direct and scheduled writes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = fakeAudioParam(0.75);

    expect(() => setAudioParamValue(p, Number.NaN)).not.toThrow();
    expect(p.value).toBe(0.75);
    expect(() => setAudioParamValue(p, Number.POSITIVE_INFINITY, 0)).not.toThrow();
    expect(p.value).toBe(0);
    expect(() => setAudioParamValueAtTime(p, Number.NEGATIVE_INFINITY, Number.NaN)).not.toThrow();
    expect(() => linearRampAudioParamToValueAtTime(p, Number.NaN, Number.POSITIVE_INFINITY)).not.toThrow();
    expect(() => exponentialRampAudioParamToValueAtTime(p, 0, Number.NEGATIVE_INFINITY)).not.toThrow();
    expect(() => setAudioParamTargetAtTime(p, Number.NaN, Number.NaN, Number.NaN)).not.toThrow();
    expect(() => cancelAudioParamScheduledValues(p, Number.POSITIVE_INFINITY)).not.toThrow();

    for (const call of p.calls) {
      expect(Number.isFinite(call.time), call.kind).toBe(true);
      if (call.value !== undefined) expect(Number.isFinite(call.value), call.kind).toBe(true);
      if (call.timeConstant !== undefined) {
        expect(Number.isFinite(call.timeConstant), call.kind).toBe(true);
        expect(call.timeConstant, call.kind).toBeGreaterThan(0);
      }
      if (call.kind === 'exponential') expect(call.value).toBeGreaterThan(0);
    }
    expect(audioParamGuardStats.repairedValues).toBeGreaterThanOrEqual(4);
    expect(audioParamGuardStats.repairedTimes).toBeGreaterThanOrEqual(5);
    expect(audioParamGuardStats.repairedTimeConstants).toBe(1);
  });

  it('clamps finite out-of-range values and preserves valid values exactly', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = fakeAudioParam(1, -2, 2);
    setAudioParamValue(p, 1.25);
    expect(p.value).toBe(1.25);
    setAudioParamValue(p, 99);
    expect(p.value).toBe(2);
    setAudioParamValue(p, -99);
    expect(p.value).toBe(-2);
    expect(finiteAudioNumber(Number.NaN, 0.5)).toBe(0.5);
  });

  it('caps exceptional warnings while retaining every repair counter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = fakeAudioParam();
    for (let i = 0; i < 10; i++) setAudioParamValue(p, Number.NaN);
    expect(audioParamGuardStats.repairedValues).toBe(10);
    expect(warn).toHaveBeenCalledTimes(4);
  });
});

describe('audio source boundary', () => {
  it('allows raw AudioParam writes only inside the guard', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'audio');
    const forbidden = /\.value\s*=|\.(?:setValueAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|setTargetAtTime|cancelScheduledValues)\s*\(/g;
    const violations: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name === 'AudioParamGuard.ts') continue;
      const source = readFileSync(join(dir, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const match of source.matchAll(forbidden)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${name}:${line} ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
