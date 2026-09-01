/**
 * Shared presentation-only surface weather state.
 *
 * One mutable object is retained for the match. `stepSurfaceEnvironment`
 * changes its scalar fields in place and returns the same identity, so the
 * lighting system can publish it every frame without allocating an event,
 * tuple or replacement state. Terrain and roads copy the scalars into uniform
 * slots that were created with their materials before reveal.
 *
 * This is deliberately not simulation state: it never enters checksums,
 * pathing, placement, saves or replays. Weather and biome are causes; materials
 * decide how strongly their authored surfaces respond.
 */

export type SurfacePrecipitation = 'none' | 'rain' | 'snow';

/**
 * Explicit presentation causes selected once from the authored map identity.
 * These are envelopes, not spatial masks: a material must still multiply shore
 * effects by its local beach/shoreline mask and snow contamination by its local
 * snow coverage. That distinction prevents a coastal map from salting inland
 * concrete or a snow map from whitening painted roofs indiscriminately.
 */
export interface SurfaceEnvironmentCause {
  /** Persistent tidal/spray dampness available to locally masked shore surfaces. */
  readonly shoreDampness: number;
  /** Long-term marine salt exposure available to locally masked shore surfaces. */
  readonly saltExposure: number;
  /** Persistent authored snow cover available to local snow material masks. */
  readonly snowGround: number;
}

const INLAND_CAUSE: SurfaceEnvironmentCause = Object.freeze({
  shoreDampness: 0,
  saltExposure: 0,
  snowGround: 0,
});

export const SURFACE_ENVIRONMENT_CAUSES: Readonly<Record<
  'inland' | 'coast' | 'tropical' | 'atoll' | 'snow',
  SurfaceEnvironmentCause
>> = Object.freeze({
  inland: INLAND_CAUSE,
  // Temperate coast: spray is intermittent and evaporation restrained.
  coast: Object.freeze({ shoreDampness: 0.44, saltExposure: 0.54, snowGround: 0 }),
  // Warm coast: persistent humidity plus faster salt deposition.
  tropical: Object.freeze({ shoreDampness: 0.58, saltExposure: 0.72, snowGround: 0 }),
  // Atoll: every land mass is shore-dominated, but local masks still own pixels.
  atoll: Object.freeze({ shoreDampness: 0.72, saltExposure: 0.88, snowGround: 0 }),
  snow: Object.freeze({ shoreDampness: 0, saltExposure: 0, snowGround: 1 }),
});

/** Allocation-free lookup; unknown maps deliberately resolve to inland. */
export function surfaceEnvironmentCauseForMap(
  map: string | null | undefined,
): SurfaceEnvironmentCause {
  switch (map?.trim().toLowerCase()) {
    case 'coast': return SURFACE_ENVIRONMENT_CAUSES.coast;
    case 'tropical': return SURFACE_ENVIRONMENT_CAUSES.tropical;
    case 'atoll': return SURFACE_ENVIRONMENT_CAUSES.atoll;
    case 'snow': return SURFACE_ENVIRONMENT_CAUSES.snow;
    default: return INLAND_CAUSE;
  }
}

export interface SurfaceEnvironmentState {
  /** Normalized position through the authored day/night cycle. */
  readonly dayPhase: number;
  /** Accumulated liquid moisture, 0 dry .. 1 saturated. */
  readonly wetness: number;
  /** Accumulated fresh snowfall presentation, 0 clear .. 1 heavy cover. */
  readonly snow: number;
  /** Biome dust load after rain wash-off, 0 clean .. 1 dusty. */
  readonly dust: number;
  /** Persistent local shoreline dampness envelope; materials apply a shore mask. */
  readonly shoreWetness: number;
  /** Marine salt residue envelope; materials apply a shore mask. */
  readonly salt: number;
  /** Dirt/grit visible through authored snow cover; materials apply a snow mask. */
  readonly snowContamination: number;
  /** Restrained ground-contact contamination strength derived from wetness/dust. */
  readonly contact: number;
}

interface MutableSurfaceEnvironmentState {
  dayPhase: number;
  wetness: number;
  snow: number;
  dust: number;
  shoreWetness: number;
  salt: number;
  snowContamination: number;
  contact: number;
}

const state: MutableSurfaceEnvironmentState = {
  dayPhase: 0,
  wetness: 0,
  snow: 0,
  dust: 0.24,
  shoreWetness: 0,
  salt: 0,
  snowContamination: 0,
  contact: 0.04,
};

let shoreDampnessCause = 0;
let saltExposureCause = 0;
let snowGroundCause = 0;

export const surfaceEnvironmentState: SurfaceEnvironmentState = state;

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function dustLoadForBiome(biome: string | null | undefined): number {
  switch (biome?.trim().toLowerCase()) {
    case 'desert': return 0.62;
    case 'snow': return 0.05;
    case 'urban': return 0.20;
    default: return 0.26;
  }
}

function approach(current: number, target: number, dt: number, tau: number): number {
  const alpha = 1 - Math.exp(-dt / Math.max(1e-3, tau));
  return current + (target - current) * alpha;
}

/** Reset in place for a new terrain/match. */
export function resetSurfaceEnvironment(
  biome: string | null | undefined = 'temperate',
  dayPhase = 0,
  cause: SurfaceEnvironmentCause = INLAND_CAUSE,
): SurfaceEnvironmentState {
  shoreDampnessCause = clamp01(Number.isFinite(cause.shoreDampness) ? cause.shoreDampness : 0);
  saltExposureCause = clamp01(Number.isFinite(cause.saltExposure) ? cause.saltExposure : 0);
  snowGroundCause = clamp01(Number.isFinite(cause.snowGround) ? cause.snowGround : 0);
  state.dayPhase = clamp01(Number.isFinite(dayPhase) ? dayPhase : 0);
  state.wetness = 0;
  state.snow = 0;
  state.dust = dustLoadForBiome(biome);
  // A map does not begin geologically new. Seed restrained equilibrium values
  // so a clear-weather coast/snow field still carries its authored history.
  state.shoreWetness = shoreDampnessCause;
  state.salt = saltExposureCause * 0.55;
  state.snowContamination = snowGroundCause * 0.10;
  state.contact = state.dust * 0.16;
  return state;
}

/**
 * Advance weather accumulation without allocating.
 *
 * Wetting is deliberately quicker than drying, while dust washes off quicker
 * than it returns. Capping dt prevents focus-return hitches from jumping a dry
 * battlefield straight to saturated or vice versa.
 */
export function stepSurfaceEnvironment(
  dtSeconds: number,
  precipitation: SurfacePrecipitation,
  intensity: number,
  biome: string | null | undefined,
  dayPhase: number,
): SurfaceEnvironmentState {
  const dt = Math.max(0, Math.min(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0.25));
  const amount = clamp01(Number.isFinite(intensity) ? intensity : 0);
  state.dayPhase = clamp01(Number.isFinite(dayPhase) ? dayPhase : state.dayPhase);

  const wetTarget = precipitation === 'rain' ? amount : 0;
  const snowTarget = precipitation === 'snow' ? amount : 0;
  state.wetness = approach(state.wetness, wetTarget, dt, wetTarget > state.wetness ? 5.5 : 42);
  state.snow = approach(state.snow, snowTarget, dt, snowTarget > state.snow ? 9 : 70);

  const climateDust = dustLoadForBiome(biome);
  const dustTarget = climateDust
    * (1 - state.wetness * 0.88)
    * (1 - state.snow * 0.82);
  state.dust = approach(state.dust, dustTarget, dt, dustTarget < state.dust ? 4.5 : 48);

  // Contact contamination is strongest while wet, with a small dry/dust tail.
  const contactTarget = clamp01(state.wetness * 0.74 + state.dust * 0.16);
  state.contact = approach(state.contact, contactTarget, dt, 3.5);

  // Shore wetting is a persistent authored cause, not a rain synonym. Rain can
  // saturate the band further; after it stops, the band returns to tidal/spray
  // equilibrium rather than drying like inland ground.
  const shoreTarget = clamp01(shoreDampnessCause + state.wetness * (1 - shoreDampnessCause) * 0.72);
  state.shoreWetness = approach(
    state.shoreWetness,
    shoreTarget,
    dt,
    shoreTarget > state.shoreWetness ? 2.8 : 24,
  );

  // Marine residue builds slowly in clear weather and washes quickly under
  // rain/fresh snow. Zero explicit exposure remains exactly zero on inland and
  // snow maps, regardless of precipitation.
  const saltTarget = saltExposureCause
    * (1 - state.wetness * 0.78)
    * (1 - state.snow * 0.90);
  state.salt = approach(state.salt, saltTarget, dt, saltTarget < state.salt ? 6 : 58);

  // Fresh snowfall buries grit. Once it stops, contact traffic, dust and thaw
  // reveal a restrained dirty-snow tail, but only on explicitly snowy ground.
  const contaminationTarget = snowGroundCause
    * clamp01(0.10 + state.contact * 0.58 + state.dust * 0.24 + state.wetness * 0.18)
    * (1 - state.snow * 0.92);
  state.snowContamination = approach(
    state.snowContamination,
    contaminationTarget,
    dt,
    contaminationTarget < state.snowContamination ? 7 : 34,
  );
  return state;
}
