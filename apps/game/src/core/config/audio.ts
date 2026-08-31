/**
 * Domain-owned config slice: audio presentation and mix policy.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import { CELL } from './runtime';

/* ==========================================================================
 * 20. AUDIO  (owner: audio module — VISUAL_DNA.md §3)
 *
 * Everything here is fully synthesized in the browser: zero audio files, no
 * network fetch, no decodeAudioData. One-shots are BAKED into AudioBuffers at
 * load through OfflineAudioContext; loops stay as live graphs because they need
 * continuous modulation.
 *
 * The numbers below are the ones a mix critic touches. Recipe internals (filter
 * centres, envelope shapes, oscillator ratios) live next to the recipe in
 * src/audio/Weapons.ts — they are composition, not configuration.
 * ========================================================================== */

/** Spec §3.1. Filter frequencies are rate-independent, so another rate is fine. */
export const AUDIO_SAMPLE_RATE = 48_000;

/**
 * Master output gain AFTER the limiter and the soft clip. 0.891 = -1.0 dBFS,
 * the ceiling the whole mix is authored against (§3.7).
 */
export const AUDIO_MASTER_GAIN = 0.891;

/**
 * Bus trim in dB, applied to the FIRST gain of each strip. The five user
 * sliders multiply into the same node with `gain = (v/100)^2.2`.
 * Voice sits ABOVE unity on purpose: EVA has to win, always.
 */
export const AUDIO_BUS_DB = {
  /*
   * Raised from -9. With the default music volume of 65 and the 2.2 perceptual
   * curve, -9 put the score at 0.377 * 0.355 = 0.134 of full scale — about
   * -17.5 dB before a note was played, against an SFX bus sitting at 0. The
   * report was "idle music is too low". The original soundtrack delivery cues
   * are level-matched by `tools/prepare-music.py`; this remains the intentional
   * headroom between that programme and full-scale SFX.
   */
  music: -6,
  sfx: 0,
  voice: 2,
  ui: -4,
  ambience: -14,
} as const;

/** §3.7 master. Ratio 20 with a 0 knee is a limiter, not a compressor. */
export const AUDIO_LIMITER = {
  threshold: -6,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.25,
} as const;

/** `y = tanh(kx)/tanh(k)` soft clip after the limiter, 4096 pt, 4x oversample. */
export const AUDIO_SOFTCLIP_K = 1.6;
export const AUDIO_SOFTCLIP_POINTS = 4096;

/**
 * Hard voice budget (§3.1): 64 one-shots total, and a per-category cap so a
 * tank line cannot starve the explosion that kills it. When a category is full
 * the oldest lowest-gain instance is ramped out over AUDIO_STEAL_RAMP_MS.
 */
export const AUDIO_MAX_ONESHOTS = 64;
export const AUDIO_MAX_LOOPS = 24;
export const AUDIO_VOICE_CAPS = {
  gunfire: 16,
  explosion: 8,
  tesla: 6,
  rocket: 10,
  engine: 8,
  footstep: 6,
  ui: 4,
  voice: 2,
  misc: 10,
} as const;
export const AUDIO_STEAL_RAMP_MS = 12;

/** Pre-cull: never allocate a node whose computed final gain is below this. */
export const AUDIO_CULL_DB = -42;

/**
 * Crowd summation (§3.1). Six of the same id inside 90 ms collapse to one
 * louder, wider instance smeared over three taps — this is what stops 28 Kirovs
 * or 40 rifles turning the mix to mush.
 */
export const AUDIO_CROWD = {
  windowSec: 0.09,
  threshold: 6,
  /** gain x (1 + boost * ln n) */
  boost: 0.42,
  smearMs: [0, 18, 41] as readonly number[],
} as const;

/**
 * Distance model (§3.7). `d` is measured in TILES: one tile is one nav cell,
 * i.e. CELL metres. `z` is the zoom factor, 1.0 at the default camera dolly.
 */
export const AUDIO_DISTANCE = {
  /** Metres per audio "tile". Keeps the spec numbers usable verbatim. */
  tileMetres: CELL,
  /** g = 1 / (1 + (d*z / refTiles)^2)  ->  -6 dB at 18 tiles. */
  refTiles: 18,
  /** fc = clamp(18000 / (1 + d*z/lpRefTiles), lpMinHz, 18000). */
  lpRefTiles: 24,
  lpMinHz: 900,
  lpMaxHz: 18_000,
  /** fhp = clamp(20 + d*z*hpPerTile, 20, hpMaxHz). Thins distant events. */
  hpPerTile: 1.4,
  hpMinHz: 20,
  hpMaxHz: 220,
  /** Reverb send ramps from near to far over sendFarTiles. */
  sendNearDb: -24,
  sendFarDb: -10,
  sendFarTiles: 40,
  /** pan = clamp(screenOffset * panScale, -panClamp, +panClamp). Never +-1. */
  panScale: 0.85,
  panClamp: 0.95,
  /** Upper 30% of the playfield reads as "further away": +2 dB of send. */
  upperSendBoostDb: 2,
  upperFrac: 0.3,
  /** Moving sources are re-aimed at 20 Hz with a 50 ms smoothing constant. */
  updateHz: 20,
  smoothSec: 0.05,
  /** Wide shots feel atmospheric, not punchy. */
  wideZoom: 2.2,
  wideSfxTrimDb: -3,
  wideAmbBoostDb: 2,
} as const;

/** §3.7 reverb table. One convolver live at a time, crossfaded over 2 s. */
export const AUDIO_REVERB = {
  desert: { rt60: 1.10, preDelayMs: 12, taps: [9, 17, 31], dampHz: 5500, returnDb: -22 },
  temperate: { rt60: 1.25, preDelayMs: 13, taps: [10, 18, 33], dampHz: 6000, returnDb: -21 },
  snow: { rt60: 0.60, preDelayMs: 8, taps: [7, 13], dampHz: 3500, returnDb: -26 },
  urban: { rt60: 1.90, preDelayMs: 18, taps: [11, 19, 29, 41], dampHz: 7000, returnDb: -16 },
  water: { rt60: 1.40, preDelayMs: 14, taps: [13, 23, 37], dampHz: 6000, returnDb: -20 },
} as const;
export const AUDIO_REVERB_CROSSFADE_SEC = 2.0;

/**
 * Ducking (§3.7). All multiplicative and stacked: `duckGain = product(active)`,
 * computed in ONE reducer per bus. Two systems must never write competing ramps
 * to one AudioParam.
 */
export const AUDIO_DUCK = {
  evaMusicDb: -11, evaSfxDb: -5, evaAmbDb: -6,
  evaAttackMs: 60, evaReleaseMs: 450,
  barkMusicDb: -4, barkSfxDb: -2,
  barkAttackMs: 40, barkReleaseMs: 250,
  boomSfxDb: -9, boomMusicDb: -3,
  boomAttackMs: 12, boomHoldMs: 400, boomReleaseMs: 700,
  nukeDb: -14, nukeAttackMs: 30, nukeHoldMs: 2200, nukeReleaseMs: 1200,
  pauseMs: 200,
} as const;

/** §3.2 EVA. Tier B (procedural formant synth) is the default and the aesthetic. */
export const AUDIO_EVA = {
  /** Baseline F0 in Hz. Female mid-alto, near-monotone. */
  f0: 190,
  /** Terminal fall in Hz applied linearly over the last `terminalFallMs`. */
  terminalFallHz: 22,
  terminalFallMs: 180,
  /** Per-syllable jitter around the baseline. */
  syllableJitterHz: 4,
  /** Second glottal saw, +7 cents at -9 dB. Stops it reading as a bare synth. */
  detuneCents: 7,
  detuneDb: -9,
  /** Radio chain (shared with barks; barks override drive and band). */
  highpassHz: 380,
  lowpassHz: 2900,
  presenceHz: 1750, presenceDb: 6.5, presenceQ: 1.3,
  deboxHz: 620, deboxDb: -4, deboxQ: 1.0,
  drive: 7.5,
  compThreshold: -22, compKnee: 3, compRatio: 8, compAttack: 0.004, compRelease: 0.09,
  slapMs: 34, slapFeedback: 0.12, slapWetDb: -18,
  microVerbMs: 180, microVerbWetDb: -24,
  /** Squelch. */
  preRollMs: 130, postRollMs: 60,
  dropoutChance: 0.18,
  /** Per-phoneme envelope and inter-token gaps. */
  attackMs: 8, releaseMs: 12, wordGapMs: 70, commaGapMs: 180,
  /** Queue depth, excluding the line currently speaking. */
  queueDepth: 3,
  /** Minimum silence between two lines, whatever the priority. */
  floorMs: 350,
  /** Session dampening applied to P3/P4 cooldowns only. */
  dampenAfter: [5, 10] as readonly number[],
  dampenMul: [1.5, 2.2] as readonly number[],
  dampenCap: 3.0,
} as const;

/** §3.3 barks. Louder in the mids, tighter band, harder drive. */
export const AUDIO_BARK = {
  highpassHz: 420,
  lowpassHz: 2500,
  drive: 11,
  preRollMs: 60,
  /** Per-unit and global cooldowns. Only ONE bark voice ever exists. */
  unitCooldownSec: 0.9,
  globalCooldownSec: 0.4,
  reselectCooldownSec: 2.5,
} as const;

/** §3.6 music. */
export const AUDIO_MUSIC = {
  bpm: 122,
  stepsPerBar: 16,
  barsPerSection: 8,
  sections: 4,
  /** Lookahead scheduler: tick every `tickMs`, schedule `horizonSec` ahead. */
  tickMs: 25,
  horizonSec: 0.12,
  /** E natural minor, E1 root. */
  rootHz: 41.203,
  /** Layer thresholds on the smoothed heat H_s. */
  layerUp: [0.10, 0.28, 0.52, 0.78] as readonly number[],
  /** Hysteresis so a layer cannot chatter at a boundary. */
  layerHysteresis: 0.04,
  layerDb: [-16, -12, -10, -8, -7] as readonly number[],
  /** Equal-power crossfade length, in bars. */
  fadeBars: 1,
  /** Combat heat smoothing per 250 ms tick — fast up, slow down. */
  riseK: 0.12,
  fallK: 0.04,
  heatTickMs: 250,
  /** Heat inputs (§3.6). */
  damageRef: 900,
  damageWindowSec: 4,
  nearUnitRef: 12,
  nearUnitTiles: 30,
  firingRef: 10,
  weights: [0.55, 0.30, 0.15] as readonly number[],
} as const;

/** §3.5 ambience. */
export const AUDIO_AMBIENCE = {
  /** Voss-McCartney pink noise source length, in seconds. */
  pinkSeconds: 10,
  crossfadeMs: 400,
  wind: {
    desert: { db: -30, lpMinHz: 380, lpMaxHz: 900, gustSec: [18, 40] as readonly number[] },
    temperate: { db: -28, lpMinHz: 340, lpMaxHz: 820, gustSec: [16, 34] as readonly number[] },
    snow: { db: -24, lpMinHz: 300, lpMaxHz: 700, gustSec: [20, 45] as readonly number[] },
    urban: { db: -34, lpMinHz: 250, lpMaxHz: 550, gustSec: [24, 50] as readonly number[] },
  },
  /** Base hum level by powered-plant count; index 0 is one plant. */
  humDb: [-34, -31, -29, -27.5, -26.5, -26] as readonly number[],
  humSagCents: -80,
  humSagSec: 3,
  humFadeSec: 4,
  /** Metres from the nearest owned structure past which the hum fades out. */
  humRangeMetres: 160,
} as const;

/** Screenshot harness: `?shot=` must be dead silent, and must never resume. */
export const AUDIO_MUTE_IN_SHOT_MODE = true;
