import { describe, expect, it } from 'vitest';

import { MAP_PRESETS, MOODS } from '../src/core/config';
import { MAPS } from '../src/shell/settings-store';
import {
  activeTimeOfDayCycle, sampleTimeOfDay, timeOfDayForMood,
  waterPaletteForTimeOfDay,
} from '../src/world/time-of-day';

describe('time-of-day presentation', () => {
  it('promotes Industrial Grid from the fixed-night POC to an authored cycle', () => {
    expect(MAP_PRESETS.urban?.mood).toBe('night');
    expect(MAP_PRESETS.urban?.timeOfDayCycle).toEqual({
      durationSeconds: 480,
      phaseOffset: 0.57,
    });
    const shellMap = MAPS.find((map) => map.id === 'industrial-grid');
    expect(shellMap?.mood).toBe('night');
    expect(shellMap?.blurb).toContain('day/night');
  });

  it('uses an elevated moon rather than a below-horizon directional light', () => {
    expect(MOODS.night?.sun?.elevationDeg).toBeGreaterThan(0);
    expect(MOODS.night?.sun?.intensity).toBeGreaterThan(0);
    expect(MOODS.night?.sun?.intensity).toBeLessThanOrEqual(1.5);
    expect(MOODS.night?.atmosphere?.hemiSkyIntensity).toBeLessThanOrEqual(0.5);
    expect(MOODS.dawn?.sun?.elevationDeg).toBeGreaterThan(0);
  });

  it('raises bounded local-light presentation at night', () => {
    const day = timeOfDayForMood('noon');
    const night = timeOfDayForMood('night');
    expect(night.phase).toBe('night');
    expect(night.localLightPoolGain).toBeGreaterThan(day.localLightPoolGain);
    expect(night.localLightMaxAnchors).toBeGreaterThan(day.localLightMaxAnchors);
    expect(night.localLightMaxAnchors).toBeLessThanOrEqual(40);
  });

  it('selects night water unless a critic explicitly overrides it', () => {
    expect(waterPaletteForTimeOfDay(null, 'temperate', 'night')).toBe('night');
    expect(waterPaletteForTimeOfDay(null, 'temperate', 'noon')).toBe('temperate');
    expect(waterPaletteForTimeOfDay('arctic', 'temperate', 'night')).toBe('arctic');
  });

  it('samples a smooth repeating cycle from simulation seconds', () => {
    const cycle = { durationSeconds: 100, phaseOffset: 0 };
    const day = sampleTimeOfDay(10, cycle);
    const duskTransition = sampleTimeOfDay(40, cycle);
    const night = sampleTimeOfDay(68, cycle);
    const wrapped = sampleTimeOfDay(110, cycle);

    expect(day.phase).toBe('day');
    expect(duskTransition.fromPhase).toBe('day');
    expect(duskTransition.toPhase).toBe('dusk');
    expect(duskTransition.blend).toBeGreaterThan(0);
    expect(duskTransition.blend).toBeLessThan(1);
    expect(night.phase).toBe('night');
    expect(night.nightWeight).toBe(1);
    expect(night.localLightPoolGain).toBeGreaterThan(duskTransition.localLightPoolGain);
    expect(wrapped.progress).toBeCloseTo(day.progress, 8);
  });

  it('keeps fixtures and title backdrops fixed while bounding critic speed overrides', () => {
    const authored = { durationSeconds: 480, phaseOffset: 0.57 };
    expect(activeTimeOfDayCycle(authored, 'skirmish', null, false, false)).toEqual(authored);
    expect(activeTimeOfDayCycle(authored, 'skirmish', '12', false, false)?.durationSeconds).toBe(30);
    expect(activeTimeOfDayCycle(authored, 'skirmish', 'off', false, false)).toBeNull();
    expect(activeTimeOfDayCycle(authored, 'skirmish', null, true, false)).toBeNull();
    expect(activeTimeOfDayCycle(authored, 'skirmish', null, false, true)).toBeNull();
    expect(activeTimeOfDayCycle(authored, 'campaign', null, false, false)).toBeNull();
  });
});
