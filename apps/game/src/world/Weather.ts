/** Deterministic presentation-only precipitation scheduling. No simulation RNG is consumed. */

export type RainKind = 'clear' | 'light' | 'heavy';
export type Precipitation = 'none' | 'rain' | 'snow';

export interface WeatherFrame {
  readonly kind: RainKind;
  /** Post-effect strength, 0..1. */
  readonly intensity: number;
  /** Brief directional-light boost, 0..1. Only non-zero while raining. */
  readonly lightning: number;
}

const CYCLE_SECONDS = 160;

/** Small 32-bit integer mixer. Stable across JS engines. */
function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function unit(seed: number, channel: number): number {
  return mix32((seed ^ Math.imul(channel, 0x9e3779b9)) >>> 0) / 0x100000000;
}

function smooth01(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

/**
 * A sparse, deterministic double flash. Light rain averages roughly one strike
 * every minute; heavy rain roughly one every twenty seconds. The first edge is
 * intentionally instantaneous, while both pulses decay smoothly.
 */
export function lightningAt(seed: number, seconds: number, kind: Exclude<RainKind, 'clear'>): number {
  const safeTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const slotSeconds = kind === 'heavy' ? 17 : 29;
  const slot = Math.floor(safeTime / slotSeconds);
  const slotSeed = mix32((seed ^ Math.imul(slot + 1, 0x85ebca6b)) >>> 0);
  const chance = kind === 'heavy' ? 0.72 : 0.42;
  if (unit(slotSeed, 5) >= chance) return 0;

  const strike = slot * slotSeconds + 3 + unit(slotSeed, 6) * (slotSeconds - 7);
  const age = safeTime - strike;
  if (age < 0 || age >= 0.62) return 0;

  const primary = age < 0.20 ? 1 - smooth01(age / 0.20) : 0;
  const echoAge = age - 0.31;
  const echo = echoAge >= 0 && echoAge < 0.22
    ? (1 - smooth01(echoAge / 0.22)) * 0.48
    : 0;
  return Math.max(primary, echo);
}

/**
 * Weather at a match-local presentation time.
 *
 * Each 160-second window independently chooses whether rain arrives, when it
 * arrives, how long it lasts, and whether it is light or heavy. Transitions are
 * eased so neither the colour grade nor the streak density pops between frames.
 */
export function weatherAt(seed: number, seconds: number): WeatherFrame {
  const safeTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const cycle = Math.floor(safeTime / CYCLE_SECONDS);
  const local = safeTime - cycle * CYCLE_SECONDS;
  const cycleSeed = mix32((seed + Math.imul(cycle + 1, 0x6d2b79f5)) >>> 0);

  // One of the first two windows is always a heavy event, selected from the
  // match seed. This keeps storms uncommon without allowing an ordinary match
  // to run for ten minutes and never expose the heavy presentation path.
  const forcedHeavySlot = mix32(seed) & 1;
  const forcedHeavy = cycle % 3 === forcedHeavySlot;

  // Non-forced windows retain dry variety rather than turning weather into an
  // always-on overlay with occasional intensity changes.
  if (!forcedHeavy && unit(cycleSeed, 1) < 0.25) {
    return { kind: 'clear', intensity: 0, lightning: 0 };
  }

  const start = 12 + unit(cycleSeed, 2) * 16;
  const duration = 84 + unit(cycleSeed, 3) * 30;
  const end = Math.min(CYCLE_SECONDS - 8, start + duration);
  if (local < start || local >= end) return { kind: 'clear', intensity: 0, lightning: 0 };

  const kind: RainKind = forcedHeavy || unit(cycleSeed, 4) < 0.38 ? 'heavy' : 'light';
  const fade = kind === 'heavy' ? 6 : 4;
  const envelope = Math.min(
    smooth01((local - start) / fade),
    smooth01((end - local) / fade),
  );
  return {
    kind,
    intensity: envelope * (kind === 'heavy' ? 1 : 0.38),
    lightning: envelope > 0.35 ? lightningAt(cycleSeed, local, kind) : 0,
  };
}

/** Snow biomes reuse the same bounded scheduler but never receive rain. */
export function precipitationForBiome(kind: RainKind, biome: string | null): Precipitation {
  if (kind === 'clear') return 'none';
  return biome === 'snow' ? 'snow' : 'rain';
}
