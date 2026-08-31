/**
 * Presentation-only time-of-day profiles.
 *
 * The simulation never reads this module. A match records the authored mood
 * already, so the fixed night POC remains replay-safe while the renderer gets
 * one place to resolve the secondary presentation systems that a mood drives.
 * The live cycle samples from simulation seconds, never a wall clock, so pause,
 * game speed and replay all agree without putting presentation into checksums.
 */

export type TimeOfDayPhase = 'day' | 'dusk' | 'night' | 'dawn';

export interface TimeOfDayProfile {
  readonly phase: TimeOfDayPhase;
  /** Multiplier for the existing batched lamp-pool decals. */
  readonly localLightPoolGain: number;
  /** Bounded number of lamp stories admitted to the shared decal pool. */
  readonly localLightMaxAnchors: number;
  /** Optional authored water palette override. */
  readonly waterPalette?: string;
}

export interface TimeOfDayCycle {
  readonly durationSeconds: number;
  readonly phaseOffset: number;
}

export interface TimeOfDaySample extends TimeOfDayProfile {
  /** Normalized position in the complete repeating cycle. */
  readonly progress: number;
  readonly fromPhase: TimeOfDayPhase;
  readonly toPhase: TimeOfDayPhase;
  /** Smooth interpolation weight from `fromPhase` to `toPhase`. */
  readonly blend: number;
  /** 0 in daylight, 1 through the held night section. */
  readonly nightWeight: number;
}

const DAY: TimeOfDayProfile = Object.freeze({
  phase: 'day',
  localLightPoolGain: 0.12,
  localLightMaxAnchors: 24,
});

const DUSK: TimeOfDayProfile = Object.freeze({
  phase: 'dusk',
  localLightPoolGain: 0.72,
  localLightMaxAnchors: 32,
});

const NIGHT: TimeOfDayProfile = Object.freeze({
  phase: 'night',
  localLightPoolGain: 1.82,
  localLightMaxAnchors: 36,
  waterPalette: 'night',
});

const DAWN: TimeOfDayProfile = Object.freeze({
  phase: 'dawn',
  localLightPoolGain: 0.52,
  localLightMaxAnchors: 30,
});

const PROFILE_BY_PHASE: Readonly<Record<TimeOfDayPhase, TimeOfDayProfile>> = Object.freeze({
  day: DAY,
  dusk: DUSK,
  night: NIGHT,
  dawn: DAWN,
});

interface CycleKeyframe {
  readonly at: number;
  readonly phase: TimeOfDayPhase;
}

/**
 * Held plateaus keep most of a match visually stable; the short transition
 * bands are long enough that the 2 Hz uniform updates cannot read as steps.
 */
const CYCLE_KEYFRAMES: readonly CycleKeyframe[] = Object.freeze([
  { at: 0.00, phase: 'day' },
  { at: 0.34, phase: 'day' },
  { at: 0.46, phase: 'dusk' },
  { at: 0.56, phase: 'night' },
  { at: 0.80, phase: 'night' },
  { at: 0.91, phase: 'dawn' },
  { at: 1.00, phase: 'day' },
]);

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function wrap01(v: number): number {
  return ((v % 1) + 1) % 1;
}

/** Pure, allocation-light sample used by the render system and unit tests. */
export function sampleTimeOfDay(simSeconds: number, cycle: TimeOfDayCycle): TimeOfDaySample {
  const duration = Math.max(1, cycle.durationSeconds);
  const progress = wrap01(simSeconds / duration + cycle.phaseOffset);
  let from = CYCLE_KEYFRAMES[0];
  let to = CYCLE_KEYFRAMES[CYCLE_KEYFRAMES.length - 1];
  for (let i = 0; i < CYCLE_KEYFRAMES.length - 1; i++) {
    const a = CYCLE_KEYFRAMES[i];
    const b = CYCLE_KEYFRAMES[i + 1];
    if (progress < a.at || progress > b.at) continue;
    from = a;
    to = b;
    break;
  }
  const span = Math.max(1e-6, to.at - from.at);
  const blend = smooth01((progress - from.at) / span);
  const a = PROFILE_BY_PHASE[from.phase];
  const b = PROFILE_BY_PHASE[to.phase];
  const nightWeight = lerp(from.phase === 'night' ? 1 : 0, to.phase === 'night' ? 1 : 0, blend);
  const phase = from.phase === to.phase || blend < 0.5 ? from.phase : to.phase;
  return {
    phase,
    progress,
    fromPhase: from.phase,
    toPhase: to.phase,
    blend,
    nightWeight,
    localLightPoolGain: lerp(a.localLightPoolGain, b.localLightPoolGain, blend),
    localLightMaxAnchors: Math.round(lerp(a.localLightMaxAnchors, b.localLightMaxAnchors, blend)),
    waterPalette: nightWeight >= 0.5 ? 'night' : undefined,
  };
}

/** Scatter admits the complete bounded set once; one uniform fades it by phase. */
export function cycleLightAnchorCeiling(): number {
  return NIGHT.localLightMaxAnchors;
}

/** Resolve the authored skirmish cycle plus the bounded critic speed override. */
export function activeTimeOfDayCycle(
  authored: TimeOfDayCycle | undefined,
  scenarioName: string,
  dayCycleFlag: string | null,
  shotMode: boolean,
  titleBackdrop: boolean,
): TimeOfDayCycle | null {
  if (authored === undefined || scenarioName !== 'skirmish' || shotMode || titleBackdrop) return null;
  if (dayCycleFlag?.trim().toLowerCase() === 'off') return null;
  const requested = dayCycleFlag === null ? NaN : Number(dayCycleFlag);
  const durationSeconds = Number.isFinite(requested)
    ? Math.max(30, Math.min(3600, requested))
    : authored.durationSeconds;
  return { durationSeconds, phaseOffset: authored.phaseOffset };
}

/** Resolve existing art-mood names without making unknown moods dangerous. */
export function timeOfDayForMood(mood?: string | null): TimeOfDayProfile {
  switch (mood?.trim().toLowerCase()) {
    case 'night':
    case 'moonlit':
      return NIGHT;
    case 'dusk':
      return DUSK;
    case 'dawn':
      return DAWN;
    default:
      return DAY;
  }
}

/** An explicit critic override always wins over presentation inference. */
export function waterPaletteForTimeOfDay(
  explicit: string | null | undefined,
  biome: string,
  mood?: string | null,
): string {
  return explicit ?? timeOfDayForMood(mood).waterPalette ?? biome;
}
