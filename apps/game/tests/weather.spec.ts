import { describe, expect, it } from 'vitest';

import { lightningAt, weatherAt } from '../src/world/Weather';

describe('deterministic dynamic weather', () => {
  it('is byte-stable for the same seed and time', () => {
    for (let t = 0; t < 300; t += 0.25) {
      expect(weatherAt(0x12345678, t)).toEqual(weatherAt(0x12345678, t));
    }
  });

  it('produces clear, light and heavy periods across seeded matches', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      for (let t = 0; t < 360; t += 1) seen.add(weatherAt(seed, t).kind);
    }
    expect(seen).toEqual(new Set(['clear', 'light', 'heavy']));
  });

  it('keeps intensity bounded and light rain below heavy rain', () => {
    let lightPeak = 0;
    let heavyPeak = 0;
    for (let seed = 1; seed <= 32; seed++) {
      for (let t = 0; t < 360; t += 0.25) {
        const frame = weatherAt(seed, t);
        expect(frame.intensity).toBeGreaterThanOrEqual(0);
        expect(frame.intensity).toBeLessThanOrEqual(1);
        if (frame.kind === 'light') lightPeak = Math.max(lightPeak, frame.intensity);
        if (frame.kind === 'heavy') heavyPeak = Math.max(heavyPeak, frame.intensity);
      }
    }
    expect(lightPeak).toBeCloseTo(0.38, 2);
    expect(heavyPeak).toBeCloseTo(1, 2);
  });

  it('eases into rain instead of popping directly to full strength', () => {
    let transitionFound = false;
    for (let seed = 1; seed <= 32 && !transitionFound; seed++) {
      for (let t = 0; t < 160; t += 0.1) {
        const intensity = weatherAt(seed, t).intensity;
        if (intensity > 0 && intensity < 0.3) {
          transitionFound = true;
          break;
        }
      }
    }
    expect(transitionFound).toBe(true);
  });

  it('keeps storms substantially longer than the old rapid weather cycle', () => {
    let longestRain = 0;
    for (let seed = 1; seed <= 24; seed++) {
      let run = 0;
      for (let t = 0; t < 480; t += 1) {
        if (weatherAt(seed, t).kind === 'clear') run = 0;
        else longestRain = Math.max(longestRain, ++run);
      }
    }
    expect(longestRain).toBeGreaterThanOrEqual(84);
  });

  it('keeps lightning sparse, bounded, deterministic and rain-only', () => {
    let flashes = 0;
    let minimum = 1;
    let peak = 0;
    let clearLeak = false;
    for (let seed = 1; seed <= 24; seed++) {
      let previouslyLit = false;
      for (let t = 0; t < 480; t += 0.02) {
        const frame = weatherAt(seed, t);
        minimum = Math.min(minimum, frame.lightning);
        if (frame.kind === 'clear' && frame.lightning !== 0) clearLeak = true;
        const lit = frame.lightning > 0.9;
        if (lit && !previouslyLit) flashes++;
        previouslyLit = lit;
        peak = Math.max(peak, frame.lightning);
      }
    }
    expect(minimum).toBeGreaterThanOrEqual(0);
    expect(peak).toBeLessThanOrEqual(1);
    expect(clearLeak).toBe(false);
    expect(flashes).toBeGreaterThan(0);
    expect(flashes).toBeLessThan(300);
    expect(peak).toBeGreaterThan(0.95);
    expect(lightningAt(123, 45.6, 'heavy')).toBe(lightningAt(123, 45.6, 'heavy'));
  });
});
