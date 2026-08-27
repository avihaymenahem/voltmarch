/** Drives the shared WebGPU/WebGL post grade's screen-space rain uniforms. */

import { defineSystem } from '../core/loop';
import { RenderPhase, type RenderContext } from '../core/types';
import { ctx } from '../game/context';
import * as THREE from 'three';

import { weatherAt, lightningAt, type RainKind } from './Weather';

type WeatherMode = 'off' | 'dynamic' | 'light' | 'heavy';

let elapsed = 0;
let seed = 1;
let mode: WeatherMode = 'off';
let lastKind: RainKind = 'clear';
let lastLightning = 0;
let baseSunIntensity = 0;
let baseHemiIntensity = 0;
const baseSunColor = new THREE.Color();
const baseHemiColor = new THREE.Color();
const lightningColor = new THREE.Color(0.66, 0.78, 1.0);

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

export default defineSystem({
  id: 'world.weather',
  renderPhase: RenderPhase.Lighting,
  order: -100,

  init(): void {
    const q = query();
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
  },

  frame(rc: RenderContext): void {
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

    const { post, sceneRig } = ctx();
    post.setWeatherIntensity(frame.intensity);

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
    sceneRig.sun.intensity = baseSunIntensity * (1 + frame.lightning * 1.65);
    sceneRig.sun.color.copy(baseSunColor).lerp(lightningColor, frame.lightning * 0.72);
    sceneRig.hemi.intensity = baseHemiIntensity * (1 + frame.lightning * 0.85);
    sceneRig.hemi.color.copy(baseHemiColor).lerp(lightningColor, frame.lightning * 0.42);

    if (frame.lightning > 0.9 && lastLightning <= 0.9) console.info('[weather] lightning');
    lastLightning = frame.lightning;
    if (frame.kind !== lastKind) {
      lastKind = frame.kind;
      console.info(`[weather] ${frame.kind}`);
    }
  },

  dispose(): void {
    const { post, sceneRig } = ctx();
    post.setWeatherIntensity(0);
    sceneRig.sun.intensity = baseSunIntensity;
    sceneRig.sun.color.copy(baseSunColor);
    sceneRig.hemi.intensity = baseHemiIntensity;
    sceneRig.hemi.color.copy(baseHemiColor);
    elapsed = 0;
    lastKind = 'clear';
    lastLightning = 0;
  },
});
