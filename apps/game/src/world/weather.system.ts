/** Drives precipitation, lightning, and the deterministic battlefield day/night cycle. */

import { SIM_HZ } from '../core/config';
import { defineSystem } from '../core/loop';
import type { ArtDirection } from '../core/types';
import { RenderPhase, type RenderContext } from '../core/types';
import { pushArtBlend, resolveArt } from '../game/ArtBridge';
import { plannedScenario } from '../game/Scenarios';
import { ctx } from '../game/context';
import * as THREE from 'three';

import { groundDecals } from './Decals';
import { getRoads } from './Roads';
import { getTerrain } from './Terrain';
import { getWater } from './Water';
import {
  weatherAt, lightningAt, precipitationForBiome,
  type Precipitation, type RainKind,
} from './Weather';
import {
  activeTimeOfDayCycle, sampleTimeOfDay, type TimeOfDayCycle,
  type TimeOfDayPhase, type TimeOfDaySample,
} from './time-of-day';
import {
  resetSurfaceEnvironment,
  surfaceEnvironmentCauseForMap,
  stepSurfaceEnvironment,
  type SurfaceEnvironmentState,
} from './surface-environment';

type WeatherMode = 'off' | 'dynamic' | 'light' | 'heavy';

export interface WeatherHudState {
  kind: RainKind;
  precipitation: Precipitation;
  intensity: number;
}

export interface TimeOfDayHudState {
  phase: TimeOfDayPhase;
  nextPhase: TimeOfDayPhase;
  progress: number;
  cycleSeconds: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmWeatherHud: WeatherHudState | undefined;
  // eslint-disable-next-line no-var
  var __vmTimeOfDayHud: TimeOfDayHudState | undefined;
}

const TIME_OF_DAY_UPDATE_TICKS = Math.max(1, Math.round(SIM_HZ * 0.5));
let elapsed = 0;
let seed = 1;
let mode: WeatherMode = 'off';
let lastKind: RainKind = 'clear';
let lastLightning = 0;
const weatherHudState: WeatherHudState = { kind: 'clear', precipitation: 'none', intensity: 0 };
let baseSunIntensity = 0;
let baseHemiIntensity = 0;
const baseSunColor = new THREE.Color();
const baseHemiColor = new THREE.Color();
const lightningColor = new THREE.Color(0.66, 0.78, 1.0);
let timeOfDayCycle: TimeOfDayCycle | null = null;
let timeOfDayArt: Record<TimeOfDayPhase, ArtDirection> | null = null;
let lastTimeOfDayTick = -TIME_OF_DAY_UPDATE_TICKS;
let lastReportedTimeOfDayPhase: TimeOfDayPhase | null = null;
let surfaceDayPhase = 0;
const timeOfDayHudState: TimeOfDayHudState = {
  phase: 'day', nextPhase: 'day', progress: 0, cycleSeconds: 0,
};

function query(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
}

function readMode(q: URLSearchParams): WeatherMode {
  const value = q.get('weather')?.toLowerCase();
  if (value === 'light' || value === 'heavy') return value;
  return value === 'on' ? 'dynamic' : 'off';
}

function querySeed(q: URLSearchParams): number {
  const sim = Number(q.get('seed')) >>> 0;
  const map = Number(q.get('mapseed')) >>> 0;
  return (sim ^ Math.imul(map || 1, 0x9e3779b9)) >>> 0;
}

function phaseOffsetOverride(value: string | null): number | null {
  if (value === null) return null;
  const named: Readonly<Record<string, number>> = {
    day: 0.10,
    dusk: 0.46,
    night: 0.68,
    dawn: 0.91,
  };
  const normalized = value.trim().toLowerCase();
  if (named[normalized] !== undefined) return named[normalized];
  const n = Number(normalized);
  return Number.isFinite(n) ? ((n % 1) + 1) % 1 : null;
}

function irradianceMoodValue(
  phase: TimeOfDayPhase,
  channel: 'gain' | 'red' | 'green' | 'blue',
): number {
  switch (phase) {
    case 'dusk':
      return channel === 'gain' ? 0.64 : channel === 'green' ? 0.78 : channel === 'blue' ? 0.60 : 1.0;
    case 'night':
      return channel === 'gain' ? 0.18 : channel === 'red' ? 0.38 : channel === 'green' ? 0.52 : 0.80;
    case 'dawn':
      return channel === 'gain' ? 0.84 : channel === 'red' ? 0.88 : channel === 'green' ? 0.90 : 1.0;
    case 'day':
      return 1.0;
  }
}

function moodBlend(sample: TimeOfDaySample, channel: 'gain' | 'red' | 'green' | 'blue'): number {
  const from = irradianceMoodValue(sample.fromPhase, channel);
  return from + (irradianceMoodValue(sample.toPhase, channel) - from) * sample.blend;
}

function applyTimeOfDaySample(sample: TimeOfDaySample): void {
  if (timeOfDayArt === null) return;
  const { debug, post } = ctx();
  pushArtBlend(timeOfDayArt[sample.fromPhase], timeOfDayArt[sample.toPhase], sample.blend);
  groundDecals()?.setLightPoolGain(sample.localLightPoolGain);
  surfaceDayPhase = sample.progress;
  post.setIrradianceMood(
    moodBlend(sample, 'gain'), moodBlend(sample, 'red'),
    moodBlend(sample, 'green'), moodBlend(sample, 'blue'),
  );

  // Water palette uniforms are live and allocation-free. Keeping this here
  // makes the cycle seam correct for the next map without rebaking PMREM.
  if (query().get('water') === null) {
    const water = getWater();
    const terrain = getTerrain();
    if (water !== null && terrain !== null) {
      water.setPalette(sample.waterPalette ?? terrain.biomeKey);
    }
  }

  timeOfDayHudState.phase = sample.phase;
  timeOfDayHudState.nextPhase = sample.toPhase;
  timeOfDayHudState.progress = sample.progress;
  timeOfDayHudState.cycleSeconds = timeOfDayCycle?.durationSeconds ?? 0;
  debug.setCounter('dayCyclePermille', Math.round(sample.progress * 1000));
  if (sample.phase !== lastReportedTimeOfDayPhase) {
    lastReportedTimeOfDayPhase = sample.phase;
    console.info(`[time-of-day] ${sample.phase} -> ${sample.toPhase}`);
  }
}

/** Uniform writes only; terrain/road materials and their programs already exist. */
function publishSurfaceEnvironment(state: SurfaceEnvironmentState): void {
  getTerrain()?.materials.setSurfaceEnvironment(state);
  getRoads()?.setSurfaceEnvironment(state);
}

function initializeTimeOfDay(q: URLSearchParams): void {
  const plan = plannedScenario();
  const resolved = activeTimeOfDayCycle(
    plan.preset.timeOfDayCycle,
    plan.name,
    q.get('daycycle'),
    q.get('shot') !== null,
    q.get('backdrop') === '1',
  );
  if (resolved === null) return;

  const offset = phaseOffsetOverride(q.get('dayphase'));
  timeOfDayCycle = offset === null ? resolved : { ...resolved, phaseOffset: offset };
  timeOfDayArt = {
    day: resolveArt('noon'),
    dusk: resolveArt('dusk'),
    night: resolveArt('night'),
    dawn: resolveArt('dawn'),
  };
  lastTimeOfDayTick = -TIME_OF_DAY_UPDATE_TICKS;
  lastReportedTimeOfDayPhase = null;
  globalThis.__vmTimeOfDayHud = timeOfDayHudState;
  applyTimeOfDaySample(sampleTimeOfDay(0, timeOfDayCycle));
  console.info(
    `[time-of-day] ${plan.preset.name} cycle ${timeOfDayCycle.durationSeconds}s `
    + `(offset ${timeOfDayCycle.phaseOffset.toFixed(2)}, update ${SIM_HZ / TIME_OF_DAY_UPDATE_TICKS} Hz)`,
  );
}

function updateTimeOfDay(): void {
  if (timeOfDayCycle === null) return;
  const tick = ctx().loop.tick;
  if (tick - lastTimeOfDayTick < TIME_OF_DAY_UPDATE_TICKS) return;
  lastTimeOfDayTick = tick;
  applyTimeOfDaySample(sampleTimeOfDay(tick / SIM_HZ, timeOfDayCycle));
}

function disposeTimeOfDay(): void {
  timeOfDayCycle = null;
  timeOfDayArt = null;
  lastTimeOfDayTick = -TIME_OF_DAY_UPDATE_TICKS;
  lastReportedTimeOfDayPhase = null;
  globalThis.__vmTimeOfDayHud = undefined;
}

export default defineSystem({
  id: 'world.weather',
  renderPhase: RenderPhase.Lighting,
  order: -100,

  init(): void {
    const q = query();
    surfaceDayPhase = 0;
    // Reset first; an active cycle immediately replaces this with its sampled
    // mood below. Doing it afterward would flatten a dusk/night boot to noon.
    ctx().post.setIrradianceMood(1, 1, 1, 1);
    initializeTimeOfDay(q);
    elapsed = 0;
    seed = querySeed(q) || 1;
    mode = readMode(q);
    lastKind = 'clear';
    lastLightning = 0;
    const { post, sceneRig } = ctx();
    baseSunIntensity = sceneRig.sun.intensity;
    baseHemiIntensity = sceneRig.hemi.intensity;
    baseSunColor.copy(sceneRig.sun.color);
    baseHemiColor.copy(sceneRig.hemi.color);
    post.setWeatherIntensity(0);
    publishSurfaceEnvironment(resetSurfaceEnvironment(
      getTerrain()?.biomeKey,
      surfaceDayPhase,
      surfaceEnvironmentCauseForMap(plannedScenario().map),
    ));
    weatherHudState.kind = 'clear';
    weatherHudState.precipitation = 'none';
    weatherHudState.intensity = 0;
    globalThis.__vmWeatherHud = weatherHudState;
  },

  frame(rc: RenderContext): void {
    // Keep the prior two-system ordering: time-of-day updates the authored
    // lighting baseline first, then weather layers lightning over that state.
    updateTimeOfDay();
    // Cap focus-return hitches: weather is a presentation clock and should not
    // jump from clear to the tail of a storm because the window was suspended.
    elapsed += Math.max(0, Math.min(rc.dt, 0.25));
    const frame = mode === 'off'
      ? { kind: 'clear' as const, intensity: 0, lightning: 0 }
      : mode === 'light'
        ? { kind: 'light' as const, intensity: 0.38, lightning: lightningAt(seed, elapsed, 'light') }
        : mode === 'heavy'
          ? { kind: 'heavy' as const, intensity: 1, lightning: lightningAt(seed, elapsed, 'heavy') }
          : weatherAt(seed, elapsed);

    const precipitation = precipitationForBiome(frame.kind, getTerrain()?.biomeKey ?? null);
    const lightning = precipitation === 'snow' ? 0 : frame.lightning;
    const { post, sceneRig } = ctx();
    // The post seam encodes snow as a negative value so both renderers retain
    // one allocation-free scalar setter and no graph/pass rebuild is required.
    post.setWeatherIntensity(precipitation === 'snow' ? -frame.intensity : frame.intensity);
    publishSurfaceEnvironment(stepSurfaceEnvironment(
      rc.dt,
      precipitation,
      frame.intensity,
      getTerrain()?.biomeKey,
      surfaceDayPhase,
    ));
    weatherHudState.kind = frame.kind;
    weatherHudState.precipitation = precipitation;
    weatherHudState.intensity = frame.intensity;

    // Pick up a live art-mood/config change while the sky is not already under
    // our flash. During a pulse the stored values remain the unmodified base.
    if (lastLightning <= 0) {
      baseSunIntensity = sceneRig.sun.intensity;
      baseHemiIntensity = sceneRig.hemi.intensity;
      baseSunColor.copy(sceneRig.sun.color);
      baseHemiColor.copy(sceneRig.hemi.color);
    }

    // Reuse the existing shadow-casting sun so a strike illuminates geometry
    // and retains real directional shadows without adding another light or
    // shadow render. The hemisphere lift keeps the flash sky-wide rather than
    // looking like a spotlight aimed from the noon sun.
    sceneRig.sun.intensity = baseSunIntensity * (1 + lightning * 1.65);
    sceneRig.sun.color.copy(baseSunColor).lerp(lightningColor, lightning * 0.72);
    sceneRig.hemi.intensity = baseHemiIntensity * (1 + lightning * 0.85);
    sceneRig.hemi.color.copy(baseHemiColor).lerp(lightningColor, lightning * 0.42);

    if (lightning > 0.9 && lastLightning <= 0.9) console.info('[weather] lightning');
    lastLightning = lightning;
    if (frame.kind !== lastKind) {
      lastKind = frame.kind;
      console.info(`[weather] ${precipitation === 'none' ? 'clear' : `${frame.kind} ${precipitation}`}`);
    }
  },

  dispose(): void {
    const { post, sceneRig } = ctx();
    post.setWeatherIntensity(0);
    post.setIrradianceMood(1, 1, 1, 1);
    surfaceDayPhase = 0;
    publishSurfaceEnvironment(resetSurfaceEnvironment(
      getTerrain()?.biomeKey,
      surfaceDayPhase,
      surfaceEnvironmentCauseForMap(plannedScenario().map),
    ));
    sceneRig.sun.intensity = baseSunIntensity;
    sceneRig.sun.color.copy(baseSunColor);
    sceneRig.hemi.intensity = baseHemiIntensity;
    sceneRig.hemi.color.copy(baseHemiColor);
    elapsed = 0;
    lastKind = 'clear';
    lastLightning = 0;
    weatherHudState.precipitation = 'none';
    globalThis.__vmWeatherHud = undefined;
    disposeTimeOfDay();
  },
});
