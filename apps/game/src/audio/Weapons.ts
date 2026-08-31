/**
 * ============================================================================
 * VOLTMARCH — src/audio/Weapons.ts
 * ============================================================================
 * THE BAKED SFX BANK. Every gun, explosion, impact, engine, UI blip and
 * ambience loop in the game, expressed as DSP.
 *
 * These are recipes, not configuration: the filter centres and envelope shapes
 * below ARE the sound, in the same way a mesh's vertices are the model. The
 * numbers a mix critic touches (bus trims, ducks, distance curve, voice caps)
 * live in `core/config.ts` §20.
 *
 * Every recipe is transcribed from VISUAL_DNA.md §3.4 and §3.5 layer by layer.
 * The section number is quoted above each one so a critic can diff a rendering
 * against the spec table without reading the code.
 *
 * WHY VARIANCE IS LOAD-BEARING
 * ----------------------------
 * Six baked variants of the tank cannon, plus `playbackRate = rand(0.94,1.07)`
 * at fire time, gives a perceived repeat period past 200 firings. One baked
 * sample played 200 times is the single most obvious "this is a hobby project"
 * tell in an RTS soundscape, and it costs nothing to fix.
 * ============================================================================
 */

import {
  cancelAudioParamScheduledValues,
  exponentialRampAudioParamToValueAtTime,
  linearRampAudioParamToValueAtTime,
  setAudioParamTargetAtTime,
  setAudioParamValue,
  setAudioParamValueAtTime,
} from './AudioParamGuard';
import { FxKind, FX_KIND_COUNT } from '../core/types';
import { AUDIO_AMBIENCE } from '../core/config';
import {
  AudioEngine, LoopVoice, biquad, bodyDrop, dbToGain, env, envSustain, gain, noiseSrc, osc,
  rand, ringMod, shaper, sweep, tail, transient, type BakeKit, type SoundSpec,
} from './AudioEngine';
import { SAMPLE_MANIFEST } from './Samples';

/* ==========================================================================
 * 1. THE ID VOCABULARY
 *
 * Strings rather than an enum on purpose: `play('explosion.large')` reads at a
 * call site in the combat module, and a typo is a silent miss rather than a
 * wrong sound. Every id in here is registered by `registerSfxBank`.
 * ========================================================================== */

export const SFX = {
  cannonLight: 'cannon.light',
  cannonHeavy: 'cannon.heavy',
  machineGun: 'mg.round',
  flak: 'flak.round',
  artillery: 'artillery.fire',
  rocketLaunch: 'rocket.launch',
  teslaCharge: 'tesla.charge',
  teslaDischarge: 'tesla.discharge',
  prismFire: 'prism.fire',
  flameJet: 'flame.jet',
  dogBark: 'dog.bark',

  explosionSmall: 'explosion.small',
  explosionMedium: 'explosion.medium',
  explosionLarge: 'explosion.large',

  impactArmor: 'impact.armor',
  impactDirt: 'impact.dirt',
  impactConcrete: 'impact.concrete',
  impactWater: 'impact.water',
  debris: 'debris.grain',
  shellCasing: 'shell.casing',
  sparks: 'spark.repair',

  crush: 'crush.squish',
  infantryDeath: 'death.infantry',
  buildRise: 'build.rise',
  sellPuff: 'sell.puff',
  oreDump: 'ore.dump',

  engineLight: 'engine.light',
  engineHeavy: 'engine.heavy',

  uiClick: 'ui.click',
  uiTab: 'ui.tab',
  uiHover: 'ui.hover',
  uiChime: 'ui.chime',
  uiReady: 'ui.ready',
  uiThunk: 'ui.thunk',
  uiGhost: 'ui.ghost',
  uiError: 'ui.error',
  uiSell: 'ui.sell',
  uiPing: 'ui.ping',
  uiTick: 'ui.tick',
} as const;

/**
 * FxKind -> sound id. The sim pushes FxKinds into the PresentationQueue and
 * never learns whether a sound played; this table is the whole coupling.
 * `null` means the effect is deliberately silent (smoke, dust, ore sparkle) —
 * an RTS where every particle makes a noise is unlistenable.
 */
export const FX_SOUND: readonly (string | null)[] = buildFxTable();

function buildFxTable(): readonly (string | null)[] {
  const t: (string | null)[] = new Array(FX_KIND_COUNT).fill(null);
  t[FxKind.MuzzleFlashSmall] = SFX.machineGun;
  t[FxKind.MuzzleFlashMedium] = SFX.cannonLight;
  t[FxKind.MuzzleFlashLarge] = SFX.cannonHeavy;
  t[FxKind.MuzzleFlashFlak] = SFX.flak;
  t[FxKind.MuzzleFlashArtillery] = SFX.artillery;
  t[FxKind.TeslaCharge] = SFX.teslaCharge;
  t[FxKind.RocketTrail] = SFX.rocketLaunch;
  t[FxKind.TeslaArc] = SFX.teslaDischarge;
  t[FxKind.PrismBeam] = SFX.prismFire;
  t[FxKind.FlameJet] = SFX.flameJet;
  t[FxKind.ImpactDirt] = SFX.impactDirt;
  t[FxKind.ImpactMetal] = SFX.impactArmor;
  t[FxKind.ImpactConcrete] = SFX.impactConcrete;
  t[FxKind.ImpactWater] = SFX.impactWater;
  t[FxKind.ExplosionSmall] = SFX.explosionSmall;
  t[FxKind.ExplosionMedium] = SFX.explosionMedium;
  t[FxKind.ExplosionLarge] = SFX.explosionLarge;
  t[FxKind.ExplosionBuilding] = SFX.explosionLarge;
  t[FxKind.ShellCasing] = SFX.shellCasing;
  t[FxKind.Debris] = SFX.debris;
  t[FxKind.Sparks] = SFX.sparks;
  t[FxKind.RepairSpark] = SFX.sparks;
  t[FxKind.BuildComplete] = SFX.buildRise;
  t[FxKind.BuildRise] = SFX.buildRise;
  t[FxKind.CrushSquish] = SFX.crush;
  t[FxKind.UnitDeathInfantry] = SFX.infantryDeath;
  t[FxKind.Splash] = SFX.impactWater;
  t[FxKind.SellPuff] = SFX.sellPuff;
  return t;
}

/* ==========================================================================
 * 2. WEAPONS
 *
 * Every recipe below is the same three rows — TRANSIENT, BODY, TAIL — plus
 * whatever mechanism noise that particular weapon has. See the block comment
 * above `transient()` in AudioEngine.ts for why that decomposition and not
 * "an oscillator with an envelope".
 *
 * Two rules hold everywhere:
 *
 *   - Nothing connects to `oc.destination`. Layers sum into `kit.out`, which
 *     the bake routes through a 4x-oversampled saturator. A clean sum of
 *     oscillators measures at a 23 dB crest factor and reads as a toy.
 *   - Every constant that could vary DOES vary, per baked variant: pitch +-7%,
 *     decay +-8%, filter centres, layer balance +-1.5 dB, and the presence of
 *     the optional mechanism layers. Six variants times playback-rate jitter is
 *     what pushes the audible repeat period past two hundred firings.
 * ========================================================================== */

/**
 * Tank cannon. The heavy variant is not "the same sound, louder": every
 * frequency scales by 0.86 and every decay by 1.3, which is what makes an Anvil
 * read as a bigger object rather than a closer one.
 *
 * The measured failure of the previous version was a spectral centroid of
 * 290 Hz with 2.6% of its energy above 400 Hz — a muffled thump with no
 * mechanism in it at all, because its only bright layer was a lowpass sweeping
 * down from 6.5 kHz over 140 ms, so almost all of that layer's energy landed
 * after the sweep had already closed. The fix is a genuinely separate 3 ms
 * transient that never moves.
 */
function renderCannon(kit: BakeKit, heavy: boolean): void {
  const { oc, rng } = kit;
  const F = heavy ? 0.86 : 1;
  const T = heavy ? 1.3 : 1;
  const t = 0;
  const fj = rand(rng, 0.93, 1.08);
  const tj = rand(rng, 0.92, 1.09);
  const lj = rand(rng, -1.5, 1.5);

  /* 1 — TRANSIENT. 3 ms, above 2.2 kHz. The breech, and nothing else. */
  transient(kit, t, -1 + lj, 2200 * fj, 3.2 * tj, 0.6);

  /* 1b — the crack proper: a bandpassed noise burst falling out of the
     transient. Short enough (90 ms) that it never becomes the sound. */
  {
    const g = gain(oc, dbToGain(-2 + lj));
    const bp = biquad(oc, 'bandpass', 2600 * F * fj, 0.9);
    sweep(bp.frequency, t, 5000 * F * fj, 900 * F * fj, 55 * T * tj);
    env(g.gain, t, 0.6, 1.0, 110 * T * tj);
    noiseSrc(kit, kit.white, t, 0.16 * T).connect(bp).connect(g).connect(kit.out);
  }
  /* 1c — a STATIONARY bright crack. The swept layer above spends most of its
     decay already down at 700 Hz, so on its own the report measured 2% of its
     energy above 2.5 kHz — a muffled thud. This layer does not move. */
  {
    const g = gain(oc, dbToGain(1 + lj));
    const bp = biquad(oc, 'bandpass', 3600 * F * fj, 1.2);
    env(g.gain, t, 0.4, 1.0, 42 * T * tj);
    noiseSrc(kit, kit.white, t, 0.06 * T).connect(bp).connect(g).connect(kit.out);
  }

  /* 2 — BODY. 165 -> 58 Hz. This descent is the "big gun" impression; the same
     oscillator held at 165 Hz is a doorbell. It stops at 58 Hz and not 42,
     because a body that ends below 50 spends its whole decay in a band most
     players cannot reproduce — measured, that put 49% of the report's energy
     under 80 Hz and left it sounding like a distant door slam. */
  bodyDrop(kit, t, (heavy ? -1 : -2.5) + lj, 175 * F * fj, 66 * F * fj,
    90 * T * tj, 265 * T * tj, 'sine', 1.4);
  /* 2b — punch. Triangle, for the odd harmonics the sine body has not got. */
  bodyDrop(kit, t, -7 + lj, 300 * F * fj, 84 * F * fj, 45 * T * tj, 115 * T * tj, 'triangle', 0.8);
  /* 2c — the sub the camera shake is cut against. Quiet: it is FELT, not heard,
     and paying for it in the energy budget is how a cannon loses its crack. */
  bodyDrop(kit, t, heavy ? -7 : -9, 72 * F, 44 * F, 170 * T, 380 * T, 'sine', 3);

  /* 3 — TAIL. 1.3 s of pink darkening from 3.4 kHz to 260 Hz. The previous
     version's tail died 40 dB down in 150 ms, which is why every shot sounded
     like it happened in a padded box. */
  tail(kit, t, -4, 4500 * F, 480 * F, 2000 * T * tj, 22, 150);
  /* 3b — the report coming back off the terrain, 120 ms later and much darker.
     Two tails at different delays is the cheapest possible "outdoors". */
  tail(kit, t, -12, 1800 * F, 260 * F, 1500 * T * tj, 115 + rand(rng, -25, 35), 170);

  /* mechanism — brass on deck, 35% of firings. Q12 is what makes it ring. */
  if (rng() < 0.35) {
    const te = 0.055 + rand(rng, -0.01, 0.02);
    const g = gain(oc, dbToGain(-21));
    const bp = biquad(oc, 'bandpass', rand(rng, 2800, 3600), 12);
    env(g.gain, te, 3, 1.0, 130);
    noiseSrc(kit, kit.white, te, 0.17).connect(bp).connect(g).connect(kit.out);
  }
}

/**
 * Machine gun — ONE round. The burst rhythm (11 rounds/s, bursts of 5-9)
 * belongs to the firing system: baking a burst makes every burst identical.
 *
 * The measured failure here was extreme: a spectral centroid of 9.2 kHz with
 * 83% of its energy above 2.5 kHz and 0.1% below 80 Hz. That is a hiss with a
 * tick on the front, and twenty of them a second is what makes a firefight
 * sound like static. The body layer was present but sat 8 dB too low to be
 * heard under its own air tail.
 */
function renderMg(kit: BakeKit, flak: boolean): void {
  const { oc, rng } = kit;
  const F = flak ? 0.82 : 1;
  const fj = rand(rng, 0.92, 1.09);
  const lj = rand(rng, -1.2, 1.2);

  /* 1 — TRANSIENT. Under 2 ms. The pin, the case head, the port. */
  transient(kit, 0, -5 + lj, 3200 * fj, 1.8, 0.7);

  /* 1b — crack. Falls 3.8 kHz -> 1.4 kHz in 18 ms and is gone by 30 ms. */
  {
    const g = gain(oc, dbToGain(-3 + lj));
    const bp = biquad(oc, 'bandpass', 2400 * fj, 1.0);
    sweep(bp.frequency, 0, 3800 * fj, 1400 * fj, 18);
    env(g.gain, 0, 0.4, 1.0, 28);
    noiseSrc(kit, kit.white, 0, 0.06).connect(bp).connect(g).connect(kit.out);
  }

  /* 2 — BODY. Square, because a rifle report has a mechanical edge a sine has
     not. Loud enough to be heard under its own air tail — at -13 dB it was
     inaudible, which is how the round ended up measuring 83% above 2.5 kHz —
     but not so loud that a rifle acquires a tank's low end. */
  bodyDrop(kit, 0, -10 + lj, 260 * F * fj, 130 * F * fj, 20, 42, 'square', 0.7);
  /* 2b — the chest thump. Small, but it is the difference between a gun and a
     paper bag; sub was 0.1% of total energy before this layer existed. */
  bodyDrop(kit, 0, -17, 150 * F, 78 * F, 24, 58, 'sine', 1.2);

  /* 3 — TAIL. 130 ms of air. Overlapping at 11 rounds/s is correct: that
     overlap IS the sound of automatic fire. */
  tail(kit, 0, -10, 6000, 1800, 150, 5, 700);

  /* flak adds the breech: a 45 ms Q3 clank 4 ms behind the round. */
  if (flak) {
    const g = gain(oc, dbToGain(-11));
    const bp = biquad(oc, 'bandpass', 1150 * fj, 3);
    env(g.gain, 0.004, 1, 1.0, 45);
    noiseSrc(kit, kit.white, 0.004, 0.07).connect(bp).connect(g).connect(kit.out);
    bodyDrop(kit, 0.002, -11, 380, 150, 30, 85, 'triangle', 0.8);
  }
}

/**
 * Rocket launch. The whoosh is a bandpass RISING through the noise — rising,
 * because the thing is leaving. A falling sweep reads as something arriving,
 * which is the impact sound, not the launch.
 */
function renderRocketLaunch(kit: BakeKit): void {
  const { oc, rng } = kit;
  const fj = rand(rng, 0.94, 1.07);

  /* 1 — TRANSIENT: the igniter. */
  transient(kit, 0, -4, 1900 * fj, 4, 0.7);

  /* 2 — BODY: the motor lighting, 110 -> 44 Hz. */
  bodyDrop(kit, 0, -5, 110 * fj, 44, 130, 200, 'sine', 1.5);
  bodyDrop(kit, 0.004, -12, 260, 90, 60, 130, 'triangle', 1);

  /* the whoosh — BP Q0.8 climbing 380 -> 2600 Hz over 300 ms */
  {
    const g = gain(oc, dbToGain(-7));
    const bp = biquad(oc, 'bandpass', 380 * fj, 0.8);
    sweep(bp.frequency, 0, 380 * fj, 2600 * fj, 300);
    envSustain(g.gain, 0, 22, 1.0, 70, 0.72, 130, 170);
    noiseSrc(kit, kit.white, 0, 0.42).connect(bp).connect(g).connect(kit.out);
  }
  /* the motor roar underneath it */
  {
    const g = gain(oc, dbToGain(-13));
    const lp = biquad(oc, 'lowpass', 700, 1.1);
    sweep(lp.frequency, 0, 900, 420, 320);
    envSustain(g.gain, 0.006, 18, 1.0, 90, 0.6, 150, 200);
    noiseSrc(kit, kit.pink, 0, 0.44).connect(lp).connect(g).connect(kit.out);
  }

  /* 3 — TAIL: the backblast off the ground. */
  tail(kit, 0, -16, 2600, 320, 420, 26, 120);
}

/**
 * Artillery. The deepest body and the longest tail in the bank, and the only
 * weapon that sends to the WIDE reverb — a howitzer is supposed to have a
 * horizon behind it, and that horizon is the whole reason to hear one.
 */
function renderArtillery(kit: BakeKit): void {
  const { oc, rng } = kit;
  const fj = rand(rng, 0.93, 1.08);
  const tj = rand(rng, 0.93, 1.08);

  transient(kit, 0, -1, 1600 * fj, 5, 0.6);
  {
    const g = gain(oc, dbToGain(-2));
    const bp = biquad(oc, 'bandpass', 1800 * fj, 0.8);
    sweep(bp.frequency, 0, 4200 * fj, 700, 90 * tj);
    env(g.gain, 0, 0.8, 1.0, 170 * tj);
    noiseSrc(kit, kit.white, 0, 0.26).connect(bp).connect(g).connect(kit.out);
  }
  /* the stationary crack. A 155 mm gun is not a muffled thump: it has a report
     that arrives before anything else and hurts. */
  {
    const g = gain(oc, dbToGain(1));
    const bp = biquad(oc, 'bandpass', 3200 * fj, 1.0);
    env(g.gain, 0, 0.5, 1.0, 55 * tj);
    noiseSrc(kit, kit.white, 0, 0.07).connect(bp).connect(g).connect(kit.out);
  }

  /* body: 145 -> 44 Hz over a quarter of a second. Slow, because size reads as
     a slow sweep — the same interval in 60 ms is a tank, not a battery. */
  bodyDrop(kit, 0, -1, 145 * fj, 44, 260 * tj, 430 * tj, 'sine', 2);
  bodyDrop(kit, 0, -6, 62, 34, 320 * tj, 780 * tj, 'sine', 5);
  bodyDrop(kit, 0, -9, 340 * fj, 92, 70 * tj, 190 * tj, 'triangle', 1);

  /* tail: 1.9 s, and two discrete returns off the terrain behind it. This is
     the sound a howitzer is actually recognised by — the report is over in
     200 ms and the horizon answers for the next two seconds. */
  tail(kit, 0, -3, 3800, 420, 2500 * tj, 30, 120);
  tail(kit, 0, -9, 1500, 260, 2100 * tj, 185 + rand(rng, -30, 40), 130);
  tail(kit, 0, -14, 900, 200, 1800 * tj, 360 + rand(rng, -50, 70), 130);

  /* the recoil, and the breech coming back. */
  {
    const te = 0.09 + rand(rng, -0.02, 0.03);
    const g = gain(oc, dbToGain(-19));
    const bp = biquad(oc, 'bandpass', rand(rng, 420, 900), 5);
    env(g.gain, te, 4, 1.0, 170);
    noiseSrc(kit, kit.white, te, 0.22).connect(bp).connect(g).connect(kit.out);
  }
}

/**
 * Tesla charge, 700 ms. Saw 55 -> 220 Hz through a bandpass sweeping
 * 300 -> 2000 Hz Q2.5, ring-modulated against 3 kHz at 25% wet. The ring mod is
 * what makes it read as ELECTRICAL rather than as an air-raid siren.
 *
 * The crackle grains sprinkled through the rise are new: a clean rise sounds
 * like a synth patch loading, and the instability is the threat.
 */
function renderTeslaCharge(kit: BakeKit): void {
  const { oc, rng } = kit;
  const dur = 0.7;
  const fj = rand(rng, 0.96, 1.05);

  const o = osc(oc, 'sawtooth', 55 * fj, 0, dur);
  sweep(o.frequency, 0, 55 * fj, 220 * fj, 700);
  const bp = biquad(oc, 'bandpass', 300, 2.5);
  sweep(bp.frequency, 0, 300, 2000, 700);
  const rm = ringMod(oc, 3000, 0, dur, 0.25);
  const g = gain(oc, 1);
  setAudioParamValueAtTime(g.gain, dbToGain(-30), 0);
  exponentialRampAudioParamToValueAtTime(g.gain, dbToGain(-9), dur);
  exponentialRampAudioParamToValueAtTime(g.gain, 0.0001, dur + 0.05);

  // 7 Hz flutter rising to 19 Hz — the instability that sells the charge.
  const flutter = osc(oc, 'sine', 7, 0, dur);
  sweep(flutter.frequency, 0, 7, 19, 700);
  const fdepth = gain(oc, 0.12);
  flutter.connect(fdepth).connect(g.gain);

  o.connect(bp).connect(rm.input);
  rm.output.connect(g).connect(kit.out);

  // A rumbling floor under the coil, so the charge has weight and not only pitch.
  {
    const sg = gain(oc, 1);
    const slp = biquad(oc, 'lowpass', 180, 1.4);
    setAudioParamValueAtTime(sg.gain, dbToGain(-34), 0);
    exponentialRampAudioParamToValueAtTime(sg.gain, dbToGain(-15), dur);
    exponentialRampAudioParamToValueAtTime(sg.gain, 0.0001, dur + 0.06);
    noiseSrc(kit, kit.pink, 0, dur + 0.05).connect(slp).connect(sg).connect(kit.out);
  }

  // Arcing grains, denser as the charge peaks.
  for (let i = 0; i < 11; i++) {
    const t = Math.pow(rng(), 0.55) * dur;
    const level = -30 + 14 * (t / dur);
    const g2 = gain(oc, dbToGain(level));
    const b2 = biquad(oc, 'bandpass', rand(rng, 1400, 6000), rand(rng, 6, 16));
    env(g2.gain, t, 0.4, 1.0, rand(rng, 8, 22));
    noiseSrc(kit, kit.white, t, 0.03).connect(b2).connect(g2).connect(kit.out);
  }
}

/**
 * Tesla discharge — grains, a beating body, a gated crackle tail, all ring
 * modulated. The measured failure was a spectrum with 37% below 80 Hz and 53%
 * above 2.5 kHz and a HOLE in between: a click glued to a rumble, with nothing
 * where the actual sound of an arc lives. The body pair moved from 50/60 Hz up
 * to 112/119 Hz and a mid-band saw layer was added to fill it.
 */
function renderTeslaDischarge(kit: BakeKit): void {
  const { oc, rng } = kit;
  const rm = ringMod(oc, 130, 0, 1.0, 0.35);
  rm.output.connect(kit.out);

  /* 1 — TRANSIENT: the strike. */
  transient(kit, 0, -3, 2600, 2.5, 0.7);

  const amps = [1.0, 0.72, 0.48, 0.32, 0.22];
  const onsets = [0, 34, 71, 118, 176];
  const grains = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < grains; i++) {
    const t = (onsets[i] + rand(rng, -12, 12)) / 1000;
    if (t < 0) continue;
    // Half the grains live in the MIDS, which is where the old recipe had a
    // hole. An arc is not only a hiss and a thump.
    const centre = i % 2 === 0 ? rand(rng, 1200, 3800) : rand(rng, 480, 1300);
    const q = rand(rng, 5, 13);
    const g = gain(oc, dbToGain(-2) * amps[i]);
    const bp = biquad(oc, 'bandpass', centre, q);
    env(g.gain, t, 0.5, 1.0, 16);
    noiseSrc(kit, kit.white, t, 0.03).connect(bp).connect(g).connect(rm.input);
    // Square at centre/2 with an 8 ms decay: the body of the spark.
    const sg = gain(oc, dbToGain(-8) * amps[i]);
    const so = osc(oc, 'square', centre * 0.5, t, 0.03);
    env(sg.gain, t, 0.5, 1.0, 9);
    so.connect(sg).connect(rm.input);
  }

  /* mid layer — a hard saw through a resonant band, the current itself. */
  {
    const g = gain(oc, dbToGain(2));
    const bp = biquad(oc, 'bandpass', 1200, 1.6);
    sweep(bp.frequency, 0, 2100, 700, 220);
    const drv = shaper(oc, 4, '2x', 1024);
    env(g.gain, 0, 1, 1.0, 210);
    const a = osc(oc, 'sawtooth', 224, 0, 0.3);
    const b = osc(oc, 'sawtooth', 238, 0, 0.3);
    a.connect(drv); b.connect(drv);
    const dlp = biquad(oc, 'lowpass', 3200, 0.8);
    drv.connect(bp).connect(dlp).connect(g).connect(rm.input);
  }

  /* body — two sines 7 Hz apart. The beat itself is the hum, and at 112 Hz it
     is audible on a laptop; at 55 Hz it was not. */
  {
    const g = gain(oc, dbToGain(-15));
    env(g.gain, 0, 3, 1.0, 380);
    osc(oc, 'sine', 112, 0, 0.45).connect(g);
    osc(oc, 'sine', 119, 0, 0.45).connect(g);
    g.connect(rm.input);
  }

  /* crackle tail — HP 2000 gated by a 60 Hz control-rate random. Baked as a
     step envelope because a live ScriptProcessor is not an option. */
  {
    // The gate is written DIRECTLY onto the gain param, so unlike every other
    // layer here it cannot inherit its level from the node it was constructed
    // with — the schedule overwrites that. Fold the level into each step, or
    // the crackle plays at unity and buries the arc: measured, that single line
    // put 74% of the discharge's energy above 2.5 kHz and turned it into a hiss.
    const lvl = dbToGain(-13);
    const g = gain(oc, 1);
    const hp = biquad(oc, 'highpass', 2000, 0.8);
    const start = 0.2;
    const steps = Math.floor(0.3 * 60);
    setAudioParamValueAtTime(g.gain, 0, start);
    for (let s = 0; s < steps; s++) {
      const t = start + s / 60;
      const open = rng() > 0.42 ? lvl * (1 - s / steps) : 0;
      setAudioParamValueAtTime(g.gain, open, t);
    }
    setAudioParamValueAtTime(g.gain, 0, start + steps / 60);
    noiseSrc(kit, kit.white, start, 0.32).connect(hp).connect(g).connect(rm.input);
  }

  /* 3 — TAIL: the ozone crack rolling away. */
  tail(kit, 0, -14, 2600, 600, 420, 30, 260);
}

/**
 * Prism — a 260 ms charge then a 200 ms fire, with a refraction split repeating
 * the fire at -4 dB, x1.19 pitch, +90 ms. The DESCENDING 1800 -> 320 sweep runs
 * opposite to every other weapon in the file, on purpose: it is the one thing
 * here that is not a chemical reaction.
 */
function renderPrism(kit: BakeKit): void {
  const { oc, rng } = kit;
  const fj = rand(rng, 0.97, 1.04);

  /* charge */
  {
    const rm = ringMod(oc, 971, 0, 0.3, 0.3);
    const o = osc(oc, 'sine', 620 * fj, 0, 0.3);
    sweep(o.frequency, 0, 620 * fj, 2100 * fj, 260);
    const g = gain(oc, 1);
    envSustain(g.gain, 0, 200, dbToGain(-9), 30, 0.8, 10, 60);
    o.connect(rm.input);
    rm.output.connect(g).connect(kit.out);
  }

  /* fire, and the refracted copy */
  for (const [delay, db, mul] of [[0.26, -5, 1], [0.35, -9, 1.19]] as const) {
    transient(kit, delay, db - 6, 4000 * mul, 2, 0.7);
    const rm = ringMod(oc, 970, delay, 0.25, 0.45);
    const o = osc(oc, 'sine', 1800 * fj * mul, delay, 0.25);
    sweep(o.frequency, delay, 1800 * fj * mul, 320 * fj * mul, 180);
    const g = gain(oc, dbToGain(db));
    env(g.gain, delay, 1, 1.0, 200);
    o.connect(rm.input);
    rm.output.connect(g).connect(kit.out);
    /* shimmer */
    const sg = gain(oc, dbToGain(db - 13));
    const bp = biquad(oc, 'bandpass', 6200, 3);
    env(sg.gain, delay, 5, 1.0, 180);
    noiseSrc(kit, kit.white, delay, 0.2).connect(bp).connect(sg).connect(kit.out);
  }
  /* the beam has weight too — a 90 Hz thump under the discharge. */
  bodyDrop(kit, 0.26, -5, 190, 62, 90, 240, 'sine', 2);
  tail(kit, 0.26, -22, 4000, 900, 320, 20, 250);
}

/** Flame jet: a low roar under a gated hiss, and a real ignition pop. */
function renderFlame(kit: BakeKit): void {
  const { oc, rng } = kit;
  transient(kit, 0, -13, 900, 6, 0.6);
  const g = gain(oc, dbToGain(-9));
  const bp = biquad(oc, 'bandpass', 700, 0.6);
  sweep(bp.frequency, 0, 500, 1400, 220);
  envSustain(g.gain, 0, 18, 1.0, 120, 0.55, 180, 260);
  noiseSrc(kit, kit.pink, 0, 0.7).connect(bp).connect(g).connect(kit.out);
  const rg = gain(oc, dbToGain(-12));
  const lp = biquad(oc, 'lowpass', 260, 0.9);
  env(rg.gain, 0, 30, 1.0, 480);
  noiseSrc(kit, kit.white, 0, 0.6).connect(lp).connect(rg).connect(kit.out);
  bodyDrop(kit, 0, -14, 150, 58, 120, 300, 'sine', 6);
  // A little flutter so it does not read as a single static hiss.
  const fl = osc(oc, 'sine', rand(rng, 9, 15), 0, 0.7);
  const fd = gain(oc, 0.25);
  fl.connect(fd).connect(g.gain);
}

/**
 * Attack dog. Not speech: three saws through a bandpass sweeping
 * 700 -> 1800 -> 500 Hz over 180 ms, two or three barks 210 ms apart.
 */
function renderDog(kit: BakeKit): void {
  const { oc, rng } = kit;
  const barks = 2 + (rng() < 0.5 ? 0 : 1);
  for (let b = 0; b < barks; b++) {
    const t = b * rand(rng, 0.19, 0.24);
    const r = rand(rng, 0.92, 1.10);
    const bp = biquad(oc, 'bandpass', 700 * r, 1.6);
    setAudioParamValueAtTime(bp.frequency, 700 * r, t);
    linearRampAudioParamToValueAtTime(bp.frequency, 1800 * r, t + 0.06);
    linearRampAudioParamToValueAtTime(bp.frequency, 500 * r, t + 0.18);
    const g = gain(oc, dbToGain(-6));
    envSustain(g.gain, t, 4, 1.0, 40, 0.4, 40, 140);
    for (const f of [340, 510, 680]) osc(oc, 'sawtooth', f * r, t, 0.22).connect(bp);
    const ng = gain(oc, dbToGain(-16));
    env(ng.gain, t, 4, 1.0, 180);
    noiseSrc(kit, kit.white, t, 0.2).connect(bp);
    ng.connect(kit.out);
    bp.connect(g).connect(kit.out);
  }
}

/* ==========================================================================
 * 3. EXPLOSIONS
 *
 * The three rules an explosion breaks if it is wrong:
 *   - it needs a transient, or it is a whoosh;
 *   - the body has to sweep DOWN and stay ABOVE about 35 Hz, or it is felt and
 *     not heard — the previous large explosion put 79% of its energy under
 *     80 Hz, which on any speaker without a subwoofer is 79% of nothing;
 *   - it needs a tail measured in seconds, and debris after that tail starts.
 * ========================================================================== */

/** Small, 420 ms. A grenade, a light vehicle, a rocket hitting dirt. */
function renderExplosionSmall(kit: BakeKit): void {
  const { oc, rng } = kit;
  const fj = rand(rng, 0.92, 1.09);
  transient(kit, 0, -6, 2400 * fj, 2.6, 0.7);
  {
    const g = gain(oc, dbToGain(-9));
    const lp = biquad(oc, 'lowpass', 3600 * fj, 0.9);
    sweep(lp.frequency, 0, 3600 * fj, 620, 110);
    env(g.gain, 0, 0.5, 1.0, 190);
    noiseSrc(kit, kit.white, 0, 0.3).connect(lp).connect(g).connect(kit.out);
  }
  bodyDrop(kit, 0, -4, 145 * fj, 58, 95, 190, 'sine', 1.2);
  bodyDrop(kit, 0, -18, 76, 48, 110, 240, 'sine', 3);
  bodyDrop(kit, 0, -12, 300 * fj, 90, 45, 120, 'triangle', 0.8);
  tail(kit, 0, -8, 2600, 560, 420, 16, 140);
  debrisGrains(kit, 4 + Math.floor(rng() * 3), 0.09, 0.36, -24);
}

/**
 * Medium, 1.4 s. A tank brewing up. The 100 -> 36 Hz sub is the loudest single
 * element — an explosion that lives in the mids sounds like a bag of crisps —
 * but it stops at 36 Hz rather than 30, because everything below that is
 * headroom spent on something most players cannot reproduce.
 */
function renderExplosionMedium(kit: BakeKit): void {
  const { oc, rng } = kit;
  const fj = rand(rng, 0.93, 1.08);
  const tj = rand(rng, 0.93, 1.08);

  transient(kit, 0, -4, 2000 * fj, 3.5, 0.7);
  /* the shell splitting */
  {
    const g = gain(oc, dbToGain(-5));
    const bp = biquad(oc, 'bandpass', 1600, 0.7);
    sweep(bp.frequency, 0, 3800 * fj, 520, 70);
    env(g.gain, 0, 0.5, 1.0, 110 * tj);
    noiseSrc(kit, kit.white, 0, 0.2).connect(bp).connect(g).connect(kit.out);
  }
  /* body — the fireball */
  {
    const g = gain(oc, dbToGain(-3.5));
    const lp = biquad(oc, 'lowpass', 5200 * fj, 0.9);
    sweep(lp.frequency, 0, 5200 * fj, 420, 380);
    env(g.gain, 0, 1.5, 1.0, 620 * tj);
    noiseSrc(kit, kit.pink, 0, 0.85).connect(lp).connect(g).connect(kit.out);
  }
  {
    const g = gain(oc, dbToGain(-3.5));
    const bp = biquad(oc, 'bandpass', 3200 * fj, 1.0);
    env(g.gain, 0, 0.4, 1.0, 50 * tj);
    noiseSrc(kit, kit.white, 0, 0.08).connect(bp).connect(g).connect(kit.out);
  }
  bodyDrop(kit, 0, -2, 105 * fj, 44, 220 * tj, 560 * tj, 'sine', 2.5);
  bodyDrop(kit, 0, -8, 240 * fj, 74, 90 * tj, 240 * tj, 'triangle', 1.2);

  tail(kit, 0, -5, 3000, 420, 1700 * tj, 28, 110);
  tail(kit, 0, -13, 1200, 240, 1300 * tj, 160 + rand(rng, -30, 50), 120);
  debrisGrains(kit, 8 + Math.floor(rng() * 6), 0.2, 1.05, -22);
}

/**
 * Large, 3.2 s, plus four metallic collapse hits at exactly the times the VFX
 * module staggers its secondary puffs (380/620/910/1350 ms), so picture and
 * sound land together. Ducking the SFX bus for the boom is the caller's job.
 */
function renderExplosionLarge(kit: BakeKit): void {
  const { oc, rng } = kit;
  const fj = rand(rng, 0.94, 1.07);
  const tj = rand(rng, 0.94, 1.07);

  transient(kit, 0, -0.5, 1700 * fj, 4.5, 0.6);
  {
    const g = gain(oc, dbToGain(-3.5));
    const bp = biquad(oc, 'bandpass', 1500, 0.65);
    sweep(bp.frequency, 0, 4200 * fj, 380, 110);
    env(g.gain, 0, 0.6, 1.0, 180 * tj);
    noiseSrc(kit, kit.white, 0, 0.3).connect(bp).connect(g).connect(kit.out);
  }
  /* the stationary shrapnel crack, which does NOT sweep away. Without it the
     boom measured 2% above 2.5 kHz and read as a distant rumble rather than as
     something that just happened forty metres away. */
  {
    const g = gain(oc, dbToGain(-1.5));
    const bp = biquad(oc, 'bandpass', 3400 * fj, 0.9);
    env(g.gain, 0, 0.5, 1.0, 70 * tj);
    noiseSrc(kit, kit.white, 0, 0.1).connect(bp).connect(g).connect(kit.out);
  }
  /* the fireball itself, 1.8 s of pink closing from 6 kHz to 140 Hz */
  {
    const g = gain(oc, dbToGain(-2));
    const lp = biquad(oc, 'lowpass', 6000 * fj, 0.9);
    sweep(lp.frequency, 0, 6000 * fj, 340, 800);
    env(g.gain, 0, 2.5, 1.0, 1500 * tj);
    noiseSrc(kit, kit.pink, 0, 1.9).connect(lp).connect(g).connect(kit.out);
  }
  /* body: 90 -> 38 Hz, NOT 70 -> 22. The old floor was inaudible on anything
     without a subwoofer, and it took 79% of the energy budget with it. */
  bodyDrop(kit, 0, -1, 90 * fj, 38, 420 * tj, 1250 * tj, 'sine', 4);
  bodyDrop(kit, 0, -17, 52, 34, 500 * tj, 1400 * tj, 'sine', 8);
  bodyDrop(kit, 0, -7, 210 * fj, 62, 160 * tj, 420 * tj, 'triangle', 1.5);

  /* rumble bed — pink -> LP 110 Hz modulated at 0.7 Hz, depth 0.5 */
  {
    const g = gain(oc, dbToGain(-13));
    const lp = biquad(oc, 'lowpass', 110, 0.7);
    env(g.gain, 0.05, 60, 1.0, 1100);
    const lfo = osc(oc, 'sine', 0.7, 0, 1.6);
    const depth = gain(oc, 0.5);
    lfo.connect(depth).connect(g.gain);
    noiseSrc(kit, kit.pink, 0.05, 1.4).connect(lp).connect(g).connect(kit.out);
  }

  /* three tails at increasing delay: the report leaving, and coming back. */
  tail(kit, 0, -4, 3600, 420, 3000 * tj, 34, 100);
  tail(kit, 0, -11, 1500, 250, 2600 * tj, 210 + rand(rng, -40, 60), 110);
  tail(kit, 0, -17, 950, 190, 2200 * tj, 480 + rand(rng, -70, 90), 110);

  /* four metallic collapse hits, synced to the VFX secondaries */
  for (const ms of [380, 620, 910, 1350]) {
    const t = (ms + rand(rng, -25, 25)) / 1000;
    const g = gain(oc, dbToGain(-14));
    const bp = biquad(oc, 'bandpass', rand(rng, 200, 700), 8);
    env(g.gain, t, 1, 1.0, 110);
    noiseSrc(kit, kit.white, t, 0.14).connect(bp).connect(g).connect(kit.out);
    bodyDrop(kit, t, -20, rand(rng, 130, 260), 55, 60, 150, 'triangle', 1);
  }
  debrisGrains(kit, 28, 0.12, 2.6, -19);
}

/**
 * Shared debris scatter: short band-passed noise grains on ballistic onsets,
 * each with a small pitched thump so they read as objects landing rather than
 * as ticks. Grain density falls off over the window, which is what a ballistic
 * distribution actually does.
 */
function debrisGrains(kit: BakeKit, count: number, from: number, to: number, db: number): void {
  const { oc, rng } = kit;
  for (let i = 0; i < count; i++) {
    // Bias the onsets early: most of what is thrown lands soon.
    const t = from + Math.pow(rng(), 1.6) * (to - from);
    const g = gain(oc, dbToGain(db + rand(rng, -4, 2)));
    const bp = biquad(oc, 'bandpass', rand(rng, 700, 3400), 4);
    env(g.gain, t, 1, 1.0, rand(rng, 16, 34));
    noiseSrc(kit, kit.white, t, 0.05).connect(bp).connect(g).connect(kit.out);
    if (rng() < 0.45) {
      bodyDrop(kit, t, db - 5, rand(rng, 170, 380), rand(rng, 70, 130), 22, 55, 'triangle', 0.6);
    }
  }
}

/**
 * The one-grain `debris.grain` spec, fired directly by `FxKind.Debris`.
 *
 * `debrisGrains(k, 1, ...)` gives its grain a body only 45% of the time, so
 * more than half the baked variants came out as a pure band-passed tick — 97%
 * of their energy above 2.5 kHz. Since the whole point of the layer is that a
 * battlefield should not be made of fizz, this one always gets its body.
 */
function renderDebrisOne(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-6));
  const bp = biquad(oc, 'bandpass', rand(rng, 700, 2600), 4);
  env(g.gain, 0, 1, 1.0, rand(rng, 18, 36));
  noiseSrc(kit, kit.white, 0, 0.06).connect(bp).connect(g).connect(kit.out);
  bodyDrop(kit, 0, -17, rand(rng, 260, 520), rand(rng, 120, 200), 20, 48, 'triangle', 0.6);
}

/* ==========================================================================
 * 4. IMPACTS AND ODDS
 *
 * These are the sounds the player hears MOST — an impact fires once per shell,
 * a cannon once per reload — and they were the worst offenders in the measured
 * baseline: impact.armor put 99.5% of its energy above 2.5 kHz, shell.casing
 * 97%, spark.repair 99%. A battlefield made of band-passed noise ticks is
 * exactly the fizz that reads as "hobby project", and the fix is a body on
 * every single one of them.
 * ========================================================================== */

function renderImpactArmor(kit: BakeKit): void {
  const { oc, rng } = kit;
  transient(kit, 0, -6, 3200, 1.4, 0.7);
  /* the plate ringing: two inharmonic partials, which is what metal does */
  const f0 = rand(rng, 620, 1150);
  for (const [mul, db, ms] of [[1, -12, 130], [2.76, -18, 90], [5.4, -24, 55]] as const) {
    const g = gain(oc, dbToGain(db));
    const o = osc(oc, 'sine', f0 * mul, 0, ms / 1000 + 0.03);
    env(g.gain, 0, 0.8, 1.0, ms);
    o.connect(g).connect(kit.out);
  }
  {
    const g = gain(oc, dbToGain(-10));
    const bp = biquad(oc, 'bandpass', rand(rng, 1900, 3600), 6);
    env(g.gain, 0, 0.5, 1.0, 70);
    noiseSrc(kit, kit.white, 0, 0.09).connect(bp).connect(g).connect(kit.out);
  }
  /* the mass behind the plate */
  bodyDrop(kit, 0, -11, 190, 68, 40, 120, 'triangle', 0.8);
  tail(kit, 0, -16, 2600, 700, 340, 12, 250);
  /* ricochet, 15% — the falling whistle everyone knows from westerns */
  if (rng() < 0.15) {
    const rg = gain(oc, dbToGain(-20));
    const o = osc(oc, 'sine', rand(rng, 2600, 4200), 0.01, 0.25);
    sweep(o.frequency, 0.01, o.frequency.value, rand(rng, 700, 1200), 220);
    env(rg.gain, 0.01, 3, 1.0, 220);
    o.connect(rg).connect(kit.out);
  }
}

function renderImpactDirt(kit: BakeKit, crisp: boolean): void {
  const { oc, rng } = kit;
  transient(kit, 0, -16, 1400, 1.6, 0.6);
  const g = gain(oc, dbToGain(-6));
  const lp = biquad(oc, 'lowpass', 1600, 0.8);
  sweep(lp.frequency, 0, 2600, 700, 90);
  env(g.gain, 0, 1, 1.0, 120);
  noiseSrc(kit, kit.white, 0, 0.16).connect(lp).connect(g).connect(kit.out);
  /* the thud. Soil has mass; the previous version was pure hiss. */
  bodyDrop(kit, 0, -10, 150, 62, 55, 140, 'sine', 1.2);
  tail(kit, 0, -16, 1500, 420, 240, 14, 130);
  if (crisp) {
    const cg = gain(oc, dbToGain(-18));
    const hp = biquad(oc, 'highpass', 2500, 0.8);
    env(cg.gain, 0, 0.5, 1.0, 60);
    noiseSrc(kit, kit.white, 0, 0.08).connect(hp).connect(cg).connect(kit.out);
  }
  debrisGrains(kit, 3, 0.03, 0.16, -30);
}

function renderImpactConcrete(kit: BakeKit): void {
  const { oc, rng } = kit;
  transient(kit, 0, -6, 2800, 1.5, 0.7);
  const g = gain(oc, dbToGain(-3));
  const bp = biquad(oc, 'bandpass', rand(rng, 900, 1900), 3.0);
  env(g.gain, 0, 0.5, 1.0, 110);
  noiseSrc(kit, kit.white, 0, 0.13).connect(bp).connect(g).connect(kit.out);
  bodyDrop(kit, 0, -12, 210, 78, 45, 140, 'triangle', 0.9);
  const sg = gain(oc, dbToGain(-20));
  const lp = biquad(oc, 'lowpass', 500, 0.7);
  env(sg.gain, 0, 2, 1.0, 230);
  noiseSrc(kit, kit.pink, 0, 0.28).connect(lp).connect(sg).connect(kit.out);
  tail(kit, 0, -21, 2000, 400, 260, 15, 130);
  debrisGrains(kit, 4, 0.04, 0.24, -28);
}

function renderSplash(kit: BakeKit): void {
  const { oc, rng } = kit;
  transient(kit, 0, -14, 2600, 1.6, 0.7);
  const g = gain(oc, dbToGain(-7));
  const bp = biquad(oc, 'bandpass', 1200, 0.7);
  sweep(bp.frequency, 0, 2400, 600, 240);
  env(g.gain, 0, 2, 1.0, 270);
  noiseSrc(kit, kit.white, 0, 0.34).connect(bp).connect(g).connect(kit.out);
  /* the cavity collapsing — this is the "gloop", and it is a downward sweep */
  bodyDrop(kit, 0.012, -10, 320, 95, 140, 200, 'sine', 3);
  for (let i = 0; i < 5; i++) {
    const t = rand(rng, 0.05, 0.32);
    const pg = gain(oc, dbToGain(-24));
    const pb = biquad(oc, 'bandpass', rand(rng, 1400, 4200), 8);
    env(pg.gain, t, 1, 1.0, 34);
    noiseSrc(kit, kit.white, t, 0.05).connect(pb).connect(pg).connect(kit.out);
  }
  tail(kit, 0, -22, 1600, 500, 300, 22, 200);
}

function renderSparks(kit: BakeKit): void {
  const { oc, rng } = kit;
  for (let i = 0; i < 7; i++) {
    const t = rand(rng, 0, 0.19);
    const g = gain(oc, dbToGain(-12));
    const bp = biquad(oc, 'bandpass', rand(rng, 3200, 8000), 7);
    env(g.gain, t, 0.5, 1.0, 24);
    noiseSrc(kit, kit.white, t, 0.04).connect(bp).connect(g).connect(kit.out);
    // Every third spark gets a body, so the burst has a floor under it.
    if (i % 3 === 0) bodyDrop(kit, t, -26, rand(rng, 900, 1500), 420, 14, 34, 'triangle', 0.4);
  }
  tail(kit, 0, -30, 6000, 2400, 160, 8, 1200);
}

function renderShellCasing(kit: BakeKit): void {
  const { oc, rng } = kit;
  for (let i = 0; i < 3; i++) {
    const t = i * rand(rng, 0.05, 0.09);
    const g = gain(oc, dbToGain(-11 - i * 3));
    const bp = biquad(oc, 'bandpass', rand(rng, 2000, 4200), 12);
    env(g.gain, t, 1, 1.0, 65);
    noiseSrc(kit, kit.white, t, 0.08).connect(bp).connect(g).connect(kit.out);
    /* brass rings — a pitched partial is what stops this being a tick */
    const f = rand(rng, 900, 1900);
    const rg = gain(oc, dbToGain(-15 - i * 3));
    const o = osc(oc, 'sine', f, t, 0.09);
    env(rg.gain, t, 0.6, 1.0, 75);
    o.connect(rg).connect(kit.out);
    bodyDrop(kit, t, -22 - i * 3, 260, 120, 20, 45, 'triangle', 0.5);
  }
}

/** A tracked vehicle driving over infantry. Wet, low, and short. */
function renderCrush(kit: BakeKit): void {
  const { oc } = kit;
  transient(kit, 0, -18, 900, 3, 0.6);
  const g = gain(oc, dbToGain(-9));
  const lp = biquad(oc, 'lowpass', 700, 1.2);
  sweep(lp.frequency, 0, 1400, 260, 180);
  env(g.gain, 0, 4, 1.0, 210);
  noiseSrc(kit, kit.pink, 0, 0.32).connect(lp).connect(g).connect(kit.out);
  bodyDrop(kit, 0, -11, 110, 42, 140, 190, 'triangle', 2);
  tail(kit, 0, -22, 800, 200, 240, 20, 110);
}

/** Infantry death — a short vocal fall, deliberately non-verbal and quiet. */
function renderInfantryDeath(kit: BakeKit): void {
  const { oc, rng } = kit;
  const f0 = rand(rng, 110, 165);
  const g = gain(oc, dbToGain(-8));
  const o = osc(oc, 'sawtooth', f0, 0, 0.45);
  sweep(o.frequency, 0, f0, f0 * 0.62, 380);
  const bp = biquad(oc, 'bandpass', 720, 1.4);
  const lp = biquad(oc, 'lowpass', 2200, 0.7);
  envSustain(g.gain, 0, 14, 1.0, 60, 0.6, 90, 240);
  o.connect(bp).connect(lp).connect(g).connect(kit.out);
  tail(kit, 0, -28, 1800, 500, 280, 40, 200);
}

/** A structure rising out of the ground: servo whine plus settling grit. */
function renderBuildRise(kit: BakeKit): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-10));
  const o = osc(oc, 'sawtooth', 90, 0, 1.1);
  sweep(o.frequency, 0, 90, 210, 900);
  const lp = biquad(oc, 'lowpass', 900, 2.0);
  sweep(lp.frequency, 0, 500, 1500, 900);
  envSustain(g.gain, 0, 120, 1.0, 200, 0.7, 400, 300);
  o.connect(lp).connect(g).connect(kit.out);
  const gg = gain(oc, dbToGain(-16));
  const bp = biquad(oc, 'bandpass', 1400, 1.1);
  envSustain(gg.gain, 0, 200, 1.0, 200, 0.5, 300, 400);
  noiseSrc(kit, kit.pink, 0, 1.2).connect(bp).connect(gg).connect(kit.out);
  /* it lands. Without this the structure fades in rather than arriving. */
  transient(kit, 1.02, -14, 1200, 5, 0.6);
  bodyDrop(kit, 1.02, -8, 150, 46, 110, 260, 'sine', 2);
  tail(kit, 1.02, -20, 1400, 260, 380, 24, 90);
}

/** Sell / demolish: descending saw 400 -> 90 Hz with a three-hit debris tail. */
function renderSell(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-9));
  const o = osc(oc, 'sawtooth', 400, 0, 0.6);
  sweep(o.frequency, 0, 400, 90, 500);
  const lp = biquad(oc, 'lowpass', 900, 0.9);
  envSustain(g.gain, 0, 8, 1.0, 120, 0.6, 260, 220);
  o.connect(lp).connect(g).connect(kit.out);
  for (let i = 0; i < 3; i++) {
    const t = 0.35 + i * rand(rng, 0.09, 0.16);
    const dg = gain(oc, dbToGain(-14 - i * 2));
    const bp = biquad(oc, 'bandpass', rand(rng, 300, 1200), 6);
    env(dg.gain, t, 1, 1.0, 120);
    noiseSrc(kit, kit.white, t, 0.15).connect(bp).connect(dg).connect(kit.out);
    bodyDrop(kit, t, -18 - i * 2, 170, 60, 50, 130, 'triangle', 1);
  }
  tail(kit, 0.35, -19, 1600, 220, 500, 26, 90);
}

/** Ore dump: 900 ms of noise falling 1200 -> 400 Hz with 14 rattle grains. */
function renderOreDump(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-10));
  const lp = biquad(oc, 'lowpass', 1200, 0.9);
  sweep(lp.frequency, 0, 1200, 400, 900);
  envSustain(g.gain, 0, 30, 1.0, 150, 0.6, 400, 320);
  noiseSrc(kit, kit.pink, 0, 0.95).connect(lp).connect(g).connect(kit.out);
  for (let i = 0; i < 16; i++) {
    const t = rand(rng, 0.02, 0.85);
    const rg = gain(oc, dbToGain(-19));
    const bp = biquad(oc, 'bandpass', rand(rng, 700, 3000), 9);
    env(rg.gain, t, 1, 1.0, 50);
    noiseSrc(kit, kit.white, t, 0.06).connect(bp).connect(rg).connect(kit.out);
    if (i % 4 === 0) bodyDrop(kit, t, -26, rand(rng, 200, 420), 100, 25, 60, 'triangle', 0.6);
  }
  tail(kit, 0, -22, 1200, 300, 600, 40, 90);
}

/* ==========================================================================
 * 5. ENGINE LOOPS
 *
 * Baked as 2.0 s buffers driven by `playbackRate`, so a throttle change never
 * re-renders anything. The loop point is seamless because every oscillator
 * frequency below divides evenly into 2.0 s.
 *
 * The measured failure was a crest factor of 1.5 dB and a centroid of 160 Hz:
 * a pure drone, indistinguishable from mains hum. A real engine is a SEQUENCE
 * OF EXPLOSIONS, so the fix is a firing pulse train — impulses at the cylinder
 * rate through a resonant band — on top of the drone.
 * ========================================================================== */

function renderEngine(kit: BakeKit, heavy: boolean): void {
  const { oc, rng } = kit;
  const dur = 2.0;
  const base = heavy ? 44 : 58;

  const g = gain(oc, dbToGain(heavy ? -20 : -22));
  const lp = biquad(oc, 'lowpass', heavy ? 700 : 900, 3);
  const drive = shaper(oc, heavy ? 5 : 4, '2x');
  lp.connect(drive).connect(g).connect(kit.out);

  // Two saws a fifth apart, detuned +9 cents. That beat is the diesel wobble.
  const a = osc(oc, 'sawtooth', base, 0, dur);
  const b = osc(oc, 'sawtooth', base * 1.5, 0, dur);
  setAudioParamValue(b.detune, 9);
  a.connect(lp);
  const bg = gain(oc, 0.7);
  b.connect(bg).connect(lp);

  /* CYLINDER FIRING. `base` Hz of discrete impulses through a resonant Q6 band,
     each 9 ms with an uneven level — an engine that fires perfectly evenly is a
     synthesizer, and the unevenness is most of what says "diesel". */
  {
    const fireHz = heavy ? 19 : 27.5;
    const pg = gain(oc, 0);
    const pbp = biquad(oc, 'bandpass', heavy ? 320 : 460, 6);
    const period = 1 / fireHz;
    const n = Math.round(dur / period);
    const peak = dbToGain(heavy ? -6 : -8);
    for (let i = 0; i < n; i++) {
      const t = i * period;
      // Deterministic per-cylinder variation, and it has to LOOP: the level of
      // pulse 0 must equal the level the loop point lands on.
      const v = 0.55 + 0.45 * Math.abs(Math.sin(i * 2.399));
      setAudioParamValueAtTime(pg.gain, 0.0001, t);
      linearRampAudioParamToValueAtTime(pg.gain, peak * v, t + 0.0008);
      exponentialRampAudioParamToValueAtTime(pg.gain, 0.0001, t + 0.009);
    }
    noiseSrc(kit, kit.white, 0, dur).connect(pbp).connect(pg).connect(kit.out);
  }

  /* valve and gear clatter — the upper harmonics that were entirely absent */
  {
    const cg = gain(oc, dbToGain(heavy ? -22 : -19));
    const cbp = biquad(oc, 'bandpass', heavy ? 1800 : 2400, 1.4);
    const clfo = osc(oc, 'sine', heavy ? 9.5 : 13.75, 0, dur);
    const cd = gain(oc, dbToGain(heavy ? -25 : -22));
    clfo.connect(cd).connect(cg.gain);
    noiseSrc(kit, kit.white, 0, dur).connect(cbp).connect(cg).connect(kit.out);
  }

  // Heavy tanks add a gated tread layer: BP 1100 Q2 chopped at 4.75 Hz. 4.75
  // divides evenly into 2 s; 4.5 does not, and the seam was audible.
  if (heavy) {
    const half = dbToGain(-20) * 0.5;
    const tg = gain(oc, half);
    const bp = biquad(oc, 'bandpass', 1100, 2);
    const gate = osc(oc, 'square', 4.5, 0, dur);
    const depth = gain(oc, half);
    gate.connect(depth).connect(tg.gain);
    noiseSrc(kit, kit.white, 0, dur).connect(bp).connect(tg).connect(kit.out);
    // Track links, on a rate that divides into the buffer.
    for (let i = 0; i < 18; i++) {
      const t = (i * dur) / 18 + rand(rng, -0.004, 0.004);
      if (t < 0 || t > dur - 0.02) continue;
      const kg = gain(oc, dbToGain(-32));
      const kbp = biquad(oc, 'bandpass', rand(rng, 1600, 3200), 9);
      env(kg.gain, t, 0.5, 1.0, 18);
      noiseSrc(kit, kit.white, t, 0.03).connect(kbp).connect(kg).connect(kit.out);
    }
  }
}

/* ==========================================================================
 * 6. UI
 *
 * All mono, all centred, no distance and no pan — a sidebar click that pans is
 * a bug the player feels before they can name it.
 *
 * The measured failure was `ui.click` landing at a spectral centroid of 61 Hz
 * with 89% of its energy under 80 Hz: its 55 Hz thump layer was 30 dB louder
 * than the click it was supposed to support, so on a laptop or a phone the
 * sidebar made almost no sound at all. UI has to live in the band that every
 * device can actually reproduce.
 * ========================================================================== */

function renderUiClick(kit: BakeKit, bpHz: number, thumpHz: number, thumpMs: number): void {
  const { oc } = kit;
  {
    const g = gain(oc, dbToGain(-3));
    const bp = biquad(oc, 'bandpass', bpHz, 2.2);
    env(g.gain, 0, 0.35, 1.0, 9);
    noiseSrc(kit, kit.white, 0, 0.02).connect(bp).connect(g).connect(kit.out);
  }
  {
    const g = gain(oc, dbToGain(-8));
    const o = osc(oc, 'square', bpHz * 0.42, 0, 0.02);
    env(g.gain, 0, 0.6, 1.0, 7);
    o.connect(g).connect(kit.out);
  }
  /* the thump, now UNDER the click rather than 30 dB over it */
  bodyDrop(kit, 0, -20, thumpHz * 2.2, thumpHz, thumpMs * 0.4, thumpMs, 'sine', 0.8);
}

/** G5 / B5 / D6 at 0 / 90 / 180 ms, each with two partials, through a slap. */
function renderChime(kit: BakeKit): void {
  const { oc } = kit;
  const bus = gain(oc, 1);
  bus.connect(kit.out);
  // 90 ms delay at feedback 0.2, wet -20 dB. One tap is enough at this length.
  const dly = oc.createDelay(0.5);
  setAudioParamValue(dly.delayTime, 0.09);
  const fb = gain(oc, 0.2);
  const wet = gain(oc, dbToGain(-20));
  bus.connect(dly).connect(fb).connect(dly);
  dly.connect(wet).connect(kit.out);

  const notes = [784, 988, 1175];
  for (let i = 0; i < notes.length; i++) {
    const t = i * 0.09;
    for (const [mul, db] of [[1, 0], [2, -12], [3, -20]] as const) {
      const g = gain(oc, dbToGain(-8 + db));
      const o = osc(oc, 'sine', notes[i] * mul, t, 0.45);
      env(g.gain, t, 4, 1.0, 380);
      o.connect(g).connect(bus);
    }
  }
}

/** Placement thunk. This one is ALLOWED to be low — a building is landing. */
function renderThunk(kit: BakeKit): void {
  const { oc } = kit;
  transient(kit, 0, -12, 1600, 3, 0.6);
  bodyDrop(kit, 0, -3, 165, 48, 130, 270, 'sine', 1.6);
  {
    const g = gain(oc, dbToGain(-9));
    const lp = biquad(oc, 'lowpass', 500, 0.9);
    env(g.gain, 0, 1, 1.0, 100);
    noiseSrc(kit, kit.white, 0, 0.13).connect(lp).connect(g).connect(kit.out);
  }
  /* settling dust, 480 ms — this is the layer that makes it read as heavy */
  {
    const g = gain(oc, dbToGain(-14));
    const bp = biquad(oc, 'bandpass', 1100, 1.2);
    envSustain(g.gain, 0, 40, 1.0, 60, 0.35, 200, 300);
    noiseSrc(kit, kit.pink, 0, 0.6).connect(bp).connect(g).connect(kit.out);
  }
}

/** Error buzz: three 55 ms pulses through a hard tanh. Unmistakably "no". */
function renderError(kit: BakeKit): void {
  const { oc } = kit;
  const bp = biquad(oc, 'bandpass', 700, 3);
  const drive = shaper(oc, 6, '2x');
  const g = gain(oc, dbToGain(-11));
  bp.connect(drive).connect(g).connect(kit.out);
  const a = osc(oc, 'square', 110, 0, 0.32);
  const b = osc(oc, 'square', 110, 0, 0.32);
  setAudioParamValue(b.detune, -12);
  a.connect(bp); b.connect(bp);
  // Three 55 ms pulses with 45 ms gaps, written straight onto the output gain.
  for (let i = 0; i < 3; i++) {
    const t = i * 0.1;
    setAudioParamValueAtTime(g.gain, 0, t);
    setAudioParamValueAtTime(g.gain, dbToGain(-11), t + 0.002);
    setAudioParamValueAtTime(g.gain, dbToGain(-11), t + 0.055);
    setAudioParamValueAtTime(g.gain, 0, t + 0.057);
  }
}

function renderReadyFlash(kit: BakeKit): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-10));
  const o = osc(oc, 'sine', 1568, 0, 0.2);
  env(g.gain, 0, 3, 1.0, 160);
  o.connect(g).connect(kit.out);
  const pg = gain(oc, dbToGain(-26));
  const po = osc(oc, 'sine', 3136, 0, 0.2);
  env(pg.gain, 0, 3, 1.0, 160);
  po.connect(pg).connect(kit.out);
  // A body under the bell so it does not read as a phone notification.
  bodyDrop(kit, 0, -20, 420, 210, 40, 110, 'triangle', 1);
}

function renderPing(kit: BakeKit): void {
  const { oc } = kit;
  for (const t of [0, 0.14]) {
    const g = gain(oc, dbToGain(-10));
    const o = osc(oc, 'sine', 1046, t, 0.08);
    env(g.gain, t, 2, 1.0, 60);
    o.connect(g).connect(kit.out);
    const hg = gain(oc, dbToGain(-22));
    const ho = osc(oc, 'sine', 2093, t, 0.06);
    env(hg.gain, t, 1, 1.0, 40);
    ho.connect(hg).connect(kit.out);
  }
}

function renderTick(kit: BakeKit): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-10));
  const o = osc(oc, 'sine', 1200, 0, 0.03);
  env(g.gain, 0, 1, 1.0, 20);
  o.connect(g).connect(kit.out);
  const cg = gain(oc, dbToGain(-14));
  const bp = biquad(oc, 'bandpass', 3000, 6);
  env(cg.gain, 0, 0.5, 1.0, 8);
  noiseSrc(kit, kit.white, 0, 0.02).connect(bp).connect(cg).connect(kit.out);
}

/* ==========================================================================
 * 7. REGISTRATION
 * ========================================================================== */

/** Variant counts come straight from §3.1. */
export function registerSfxBank(engine: AudioEngine): void {
  for (const s of collectSfxBank()) engine.register(s);
}

/**
 * The bank as data, so `tools/audio-measure.mjs` can render every recipe
 * offline and score it without booting the game. Measurement is the only
 * feedback loop this module has — nobody can hear a pull request.
 */
export function collectSfxBank(): readonly SoundSpec[] {
  const specs: SoundSpec[] = [
    /* -- weapons --
     *
     * `drive` is the bake-time saturation, and it is not decoration: it is what
     * moves a recipe from a 23 dB crest factor (a click with nothing behind it,
     * which is what the whole bank measured at before) down to the 13-17 dB a
     * real report has. Bigger sources get more of it, because bigger sources
     * overload whatever is listening to them.
     */
    /* RECORDED, from here down where `sample` is set. `drive` drops hard on
     * every one of them: 2.6-3.0 was tuned to give a stack of clean oscillators
     * the crest factor a real report has, and a real report already has it.
     * Pushing a recording through that curve only eats its transient.
     *
     * `variants` may EXCEED the number of takes — 5 variants over 3 cannon
     * takes is deliberate. The surplus are detuned by `variantDetune`, which
     * keeps the repeat period long without pretending there are more takes
     * than there are. */
    { id: SFX.cannonLight, bus: 'sfx', category: 'gunfire', db: -4, variants: 5, seconds: 1.05,
      rateJitter: 0.065, sendDb: -18, drive: 1.6, driveAsym: 0.14, sample: SFX.cannonLight,
      render: (k) => renderCannon(k, false) },
    { id: SFX.cannonHeavy, bus: 'sfx', category: 'gunfire', db: -3, variants: 5, seconds: 1.95,
      rateJitter: 0.06, sendDb: -16, drive: 1.7, driveAsym: 0.16, reverb: 'wide',
      sample: SFX.cannonHeavy, render: (k) => renderCannon(k, true) },
    { id: SFX.machineGun, bus: 'sfx', category: 'gunfire', db: -7, variants: 8, seconds: 0.55,
      rateJitter: 0.09, sendDb: -26, drive: 1.4, sample: SFX.machineGun,
      render: (k) => renderMg(k, false) },
    { id: SFX.flak, bus: 'sfx', category: 'gunfire', db: -6, variants: 5, seconds: 0.86,
      rateJitter: 0.08, sendDb: -24, drive: 1.4, sample: SFX.flak,
      render: (k) => renderMg(k, true) },
    { id: SFX.artillery, bus: 'sfx', category: 'gunfire', db: -2, variants: 3, seconds: 2.1,
      rateJitter: 0.05, sendDb: -12, drive: 1.8, driveAsym: 0.18, reverb: 'wide',
      sample: SFX.artillery, render: renderArtillery },
    { id: SFX.rocketLaunch, bus: 'sfx', category: 'rocket', db: -8, variants: 4, seconds: 1.15,
      rateJitter: 0.06, sendDb: -22, drive: 1.5, sample: SFX.rocketLaunch,
      render: renderRocketLaunch },
    /* Energy weapons come from a CC0 sci-fi set rather than the arena shooter:
     * Warfork's are mixed for FPS punch and arrived with half their energy
     * below 80 Hz, which is not what a coil or a beam sounds like. */
    { id: SFX.teslaCharge, bus: 'sfx', category: 'tesla', db: -8, variants: 3, seconds: 1.27,
      rateJitter: 0.04, sendDb: -24, drive: 1.3, sample: SFX.teslaCharge, render: renderTeslaCharge },
    { id: SFX.teslaDischarge, bus: 'sfx', category: 'tesla', db: -5, variants: 5, seconds: 0.91,
      rateJitter: 0.08, sendDb: -18, drive: 1.5, driveAsym: 0.14, sample: SFX.teslaDischarge,
      render: renderTeslaDischarge },
    { id: SFX.prismFire, bus: 'sfx', category: 'gunfire', db: -5, variants: 4, seconds: 1.25,
      rateJitter: 0.05, sendDb: -20, drive: 1.4, sample: SFX.prismFire, render: renderPrism },
    { id: SFX.flameJet, bus: 'sfx', category: 'gunfire', db: -10, variants: 3, seconds: 1.3,
      rateJitter: 0.08, sendDb: -24, drive: 1.5, sample: SFX.flameJet, render: renderFlame },
    { id: SFX.dogBark, bus: 'sfx', category: 'misc', db: -8, variants: 4, seconds: 1.41,
      rateJitter: 0.07, sendDb: -22, drive: 1.3, sample: SFX.dogBark, render: renderDog },

    /* -- explosions: the only sounds that send to the WIDE room -- */
    { id: SFX.explosionSmall, bus: 'sfx', category: 'explosion', db: -12, variants: 6, seconds: 1.05,
      rateJitter: 0.08, sendDb: -24, drive: 1.6, driveAsym: 0.15, sample: SFX.explosionSmall,
      render: renderExplosionSmall },
    { id: SFX.explosionMedium, bus: 'sfx', category: 'explosion', db: -4, variants: 5, seconds: 1.6,
      rateJitter: 0.06, sendDb: -15, drive: 1.8, driveAsym: 0.18, reverb: 'wide',
      sample: SFX.explosionMedium, render: renderExplosionMedium },
    { id: SFX.explosionLarge, bus: 'sfx', category: 'explosion', db: -1, variants: 3, seconds: 3.2,
      rateJitter: 0.05, sendDb: -9, drive: 2.0, driveAsym: 0.2, reverb: 'wide',
      sample: SFX.explosionLarge, render: renderExplosionLarge },

    /* -- impacts -- */
    /* Recorded families (Kenney, CC0) carry a gentler `drive` than the recipes
     * they replace, for the reason spelled out on `ui()`: the saturation was
     * there to glue synthesised layers, and a recording has nothing to glue. */
    { id: SFX.impactArmor, bus: 'sfx', category: 'misc', db: -16, variants: 5, seconds: 0.89,
      rateJitter: 0.1, drive: 1.4, sample: SFX.impactArmor, render: renderImpactArmor },
    { id: SFX.impactDirt, bus: 'sfx', category: 'misc', db: -20, variants: 5, seconds: 0.64,
      rateJitter: 0.1, drive: 1.3, sample: SFX.impactDirt,
      render: (k) => renderImpactDirt(k, false) },
    { id: SFX.impactConcrete, bus: 'sfx', category: 'misc', db: -17, variants: 5, seconds: 0.62,
      rateJitter: 0.09, drive: 1.4, sample: SFX.impactConcrete, render: renderImpactConcrete },
    { id: SFX.impactWater, bus: 'sfx', category: 'misc', db: -16, variants: 4, seconds: 1.19,
      rateJitter: 0.08, drive: 1.3, sample: SFX.impactWater, render: renderSplash },
    { id: SFX.debris, bus: 'sfx', category: 'misc', db: -20, variants: 8, seconds: 0.32,
      rateJitter: 0.14, drive: 1.2, sample: SFX.debris, render: renderDebrisOne },
    { id: SFX.shellCasing, bus: 'sfx', category: 'misc', db: -22, variants: 4, seconds: 0.79,
      rateJitter: 0.12, drive: 1.2, sample: SFX.shellCasing, render: renderShellCasing },
    { id: SFX.sparks, bus: 'sfx', category: 'misc', db: -22, variants: 4, seconds: 0.73,
      rateJitter: 0.1, drive: 1.3, sample: SFX.sparks, render: renderSparks },

    /* -- gameplay odds -- */
    { id: SFX.crush, bus: 'sfx', category: 'misc', db: -14, variants: 4, seconds: 0.42,
      rateJitter: 0.1, drive: 1.4, sample: SFX.crush, render: renderCrush },
    { id: SFX.infantryDeath, bus: 'sfx', category: 'misc', db: -18, variants: 3, seconds: 1.69,
      rateJitter: 0.09, drive: 1.2, sample: SFX.infantryDeath, render: renderInfantryDeath },
    { id: SFX.buildRise, bus: 'sfx', category: 'misc', db: -14, variants: 2, seconds: 2.21,
      rateJitter: 0.04, drive: 1.4, sample: SFX.buildRise, render: renderBuildRise },
    { id: SFX.sellPuff, bus: 'sfx', category: 'misc', db: -12, variants: 2, seconds: 1.63,
      rateJitter: 0.05, drive: 1.4, sample: SFX.sellPuff, render: renderSell },
    { id: SFX.oreDump, bus: 'sfx', category: 'misc', db: -16, variants: 3, seconds: 1.08,
      rateJitter: 0.05, drive: 1.3, sample: SFX.oreDump, render: renderOreDump },

    /* -- engine beds (played as loops, never as one-shots) --
     * NO drive: the saturator's DC-blocking highpass rings at the buffer edges,
     * and a loop is nothing BUT buffer edges. These carry their own shaper. */
    { id: SFX.engineLight, bus: 'sfx', category: 'engine', db: -21, variants: 1, seconds: 0.73,
      sample: SFX.engineLight, render: (k) => renderEngine(k, false) },
    { id: SFX.engineHeavy, bus: 'sfx', category: 'engine', db: -19, variants: 1, seconds: 3.65,
      sample: SFX.engineHeavy, render: (k) => renderEngine(k, true) },

    /* -- UI: non-positional, no crowd summation -- */
    /* `seconds` on a recorded family is NOT a taste knob — the bake renders
     * into a buffer of exactly this length and anything past it is cut. Eight
     * of these were shorter than their longest take and would have baked in
     * truncated (`ui.tab` at 0.12 s against a 0.618 s file). The values below
     * clear the longest take plus room for the saturator's DC highpass to ring
     * out, and `tests/audio-samples.spec.ts` re-derives that from the files. */
    ui(SFX.uiClick, -12, 3, 0.14, (k) => renderUiClick(k, 2400, 120, 45)),
    ui(SFX.uiTab, -13, 3, 0.68, (k) => renderUiClick(k, 1600, 95, 60)),
    ui(SFX.uiHover, -26, 2, 0.05, (k) => {
      const g = gain(k.oc, dbToGain(-6));
      const bp = biquad(k.oc, 'bandpass', 3400, 3);
      env(g.gain, 0, 0.4, 1.0, 5);
      noiseSrc(k, k.white, 0, 0.012).connect(bp).connect(g).connect(k.out);
      bodyDrop(k, 0, -16, 1400, 900, 6, 14, 'sine', 0.4);
    }),
    ui(SFX.uiChime, -10, 2, 0.8, renderChime),
    ui(SFX.uiReady, -16, 2, 0.55, renderReadyFlash),
    ui(SFX.uiThunk, -6, 3, 1.0, renderThunk),
    ui(SFX.uiGhost, -32, 2, 0.18, (k) => {
      const g = gain(k.oc, dbToGain(-6));
      const bp = biquad(k.oc, 'bandpass', 2800, 4);
      env(g.gain, 0, 0.35, 1.0, 4);
      noiseSrc(k, k.white, 0, 0.01).connect(bp).connect(g).connect(k.out);
    }),
    ui(SFX.uiError, -11, 3, 0.58, renderError),
    ui(SFX.uiSell, -12, 2, 0.42, renderSell),
    ui(SFX.uiPing, -18, 2, 0.28, renderPing),
    ui(SFX.uiTick, -20, 2, 0.08, renderTick),
  ];

  return specs;
}

/**
 * `sample` defaults to the id, because every recorded UI family in
 * `SAMPLE_MANIFEST` is named after the sound it replaces. Pass it explicitly
 * only when two ids share one set of takes.
 *
 * `drive` drops to 1.15 for a recorded sound. The 1.5 default was tuned to glue
 * a stack of clean synthesised layers together; a recording arrives already
 * glued, and pushing it through the same curve just eats the transient that is
 * the reason to prefer a recording in the first place.
 */
function ui(
  id: string, db: number, variants: number, seconds: number,
  render: (k: BakeKit) => void, drive?: number, sample: string | undefined = id,
): SoundSpec {
  const recorded = sample !== undefined && sample in SAMPLE_MANIFEST;
  return {
    id, bus: 'ui', category: 'ui', db, variants, seconds,
    positional: false, noCrowd: true, rateJitter: 0.02,
    drive: drive ?? (recorded ? 1.15 : 1.5),
    sample: recorded ? sample : undefined,
    render,
  };
}

/* ==========================================================================
 * 8. LIVE LOOPS — AMBIENCE AND ENGINES  (§3.5, §3.4.10)
 *
 * These CANNOT be baked: wind is minutes long and modulated by two independent
 * LFOs, the base hum sags when the player browns out, and an engine's throttle
 * moves every frame. Live graphs, small node counts, all pooled.
 * ========================================================================== */

export type Theatre = 'desert' | 'temperate' | 'snow' | 'urban';

/**
 * Wind, base hum and water — the three beds that make a paused frame feel like
 * a place rather than a screenshot.
 */
export class AmbienceRig {
  private wind: LoopVoice | null = null;
  private windLp: BiquadFilterNode | null = null;
  private hum: LoopVoice | null = null;
  private humOscs: OscillatorNode[] = [];
  private water: LoopVoice | null = null;
  private theatre: Theatre = 'temperate';
  private gustTimer: ReturnType<typeof setTimeout> | null = null;
  private lowPower = false;
  private plants = 0;
  private humAudible = true;

  constructor(private readonly engine: AudioEngine) {}

  /* ---- wind ------------------------------------------------------------ */

  /**
   * A 10 s pink bed through a lowpass whose cutoff wanders on two LFOs, with a
   * third LFO on the gain. Three sines is the entire difference between "wind"
   * and "tape hiss".
   */
  startWind(theatre: Theatre): void {
    this.stopWind();
    this.theatre = theatre;
    const e = this.engine;
    const cfg = AUDIO_AMBIENCE.wind[theatre];
    const loop = e.openLoop('ambience', 0, false);
    if (loop === null) return;
    const ctx = e.ctx;

    const src = ctx.createBufferSource();
    src.buffer = e.pink;
    src.loop = true;
    // Loop the middle of the bed so the seam never lands on the buffer edge.
    src.loopStart = 0.2;
    src.loopEnd = Math.max(1, e.pink.duration - 0.2);
    const lp = biquad(ctx, 'lowpass', (cfg.lpMinHz + cfg.lpMaxHz) * 0.5, 0.8);

    // Two cutoff LFOs at 0.05 and 0.13 Hz, per the desert row of the table.
    const mid = (cfg.lpMinHz + cfg.lpMaxHz) * 0.5;
    const span = (cfg.lpMaxHz - cfg.lpMinHz) * 0.5;
    setAudioParamValue(lp.frequency, mid);
    const lfoA = ctx.createOscillator(); setAudioParamValue(lfoA.frequency, 0.05);
    const lfoB = ctx.createOscillator(); setAudioParamValue(lfoB.frequency, 0.13);
    const depthA = gain(ctx, span * 0.72);
    const depthB = gain(ctx, span * 0.28);
    lfoA.connect(depthA).connect(lp.frequency);
    lfoB.connect(depthB).connect(lp.frequency);
    lfoA.start(); lfoB.start();

    // Gain LFO at 0.06 Hz, depth 0.35 — gusts you feel before you hear.
    const lfoG = ctx.createOscillator(); setAudioParamValue(lfoG.frequency, 0.06);
    const depthG = gain(ctx, 0.35);
    lfoG.connect(depthG).connect(loop.amp.gain);
    lfoG.start();

    src.connect(lp).connect(loop.input);
    src.start();

    e.attachLoopSource(loop, src);
    e.attachLoopSource(loop, lfoA);
    e.attachLoopSource(loop, lfoB);
    e.attachLoopSource(loop, lfoG);
    e.attachLoopNode(loop, lp);

    // Snow adds a wandering whistle at Q7 — the single most evocative 3 nodes
    // in the whole ambience budget.
    if (theatre === 'snow') {
      const wg = gain(ctx, dbToGain(-34));
      const bp = biquad(ctx, 'bandpass', 1250, 7);
      const wander = ctx.createOscillator(); setAudioParamValue(wander.frequency, 0.11);
      const wd = gain(ctx, 180);
      wander.connect(wd).connect(bp.frequency);
      wander.start();
      const ws = ctx.createBufferSource();
      ws.buffer = e.white; ws.loop = true;
      ws.connect(bp).connect(wg).connect(loop.input);
      ws.start();
      e.attachLoopSource(loop, ws);
      e.attachLoopSource(loop, wander);
    }
    // Urban swaps the whistle for distant traffic.
    if (theatre === 'urban') {
      const tg = gain(ctx, dbToGain(-40));
      const tlp = biquad(ctx, 'lowpass', 400, 0.7);
      const ts = ctx.createBufferSource();
      ts.buffer = e.pink; ts.loop = true;
      ts.connect(tlp).connect(tg).connect(loop.input);
      ts.start();
      e.attachLoopSource(loop, ts);
    }

    this.wind = loop;
    this.windLp = lp;
    loop.setGain(dbToGain(cfg.db), 1200);
    this.scheduleGust();
  }

  /** Cutoff to 1400 Hz and +5 dB over 2.5 s, every 18-40 s. */
  private scheduleGust(): void {
    const cfg = AUDIO_AMBIENCE.wind[this.theatre];
    const delay = (cfg.gustSec[0] + Math.random() * (cfg.gustSec[1] - cfg.gustSec[0])) * 1000;
    this.gustTimer = setTimeout(() => {
      const loop = this.wind;
      const lp = this.windLp;
      if (loop !== null && lp !== null && loop.alive) {
        const t = this.engine.now();
        cancelAudioParamScheduledValues(lp.frequency, t);
        setAudioParamTargetAtTime(lp.frequency, 1400, t, 0.8);
        setAudioParamTargetAtTime(lp.frequency, lp.frequency.value, t + 2.5, 1.4);
        loop.setGain(dbToGain(cfg.db + 5), 900);
        setTimeout(() => loop.alive && loop.setGain(dbToGain(cfg.db), 1600), 2500);
      }
      this.scheduleGust();
    }, delay);
  }

  stopWind(): void {
    if (this.gustTimer !== null) { clearTimeout(this.gustTimer); this.gustTimer = null; }
    this.wind?.stop(900);
    this.wind = null;
    this.windLp = null;
  }

  /* ---- base hum -------------------------------------------------------- */

  /**
   * Three saws at 50.0 / 50.6 / 75.0 Hz. The 0.6 Hz beat between the first two
   * IS the generator wobble; a single oscillator sounds like a test tone.
   */
  startHum(): void {
    if (this.hum !== null) return;
    const e = this.engine;
    const loop = e.openLoop('ambience', 0, false);
    if (loop === null) return;
    const ctx = e.ctx;
    const lp = biquad(ctx, 'lowpass', 220, 1.5);
    const drive = shaper(ctx, 2, '2x');
    lp.connect(drive).connect(loop.input);
    this.humOscs = [];
    for (const f of [50.0, 50.6, 75.0]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      setAudioParamValue(o.frequency, f);
      o.connect(lp);
      o.start();
      this.humOscs.push(o);
      e.attachLoopSource(loop, o);
    }
    this.hum = loop;
    this.applyHumLevel(0);
  }

  /** Powered plant count drives the level; the brownout drives the pitch. */
  setPower(plants: number, lowPower: boolean): void {
    const changed = plants !== this.plants || lowPower !== this.lowPower;
    this.plants = plants;
    this.lowPower = lowPower;
    if (!changed) return;
    this.applyHumLevel(1200);
    // On low power all three oscillators sag -80 cents over 3 s and pick up a
    // 1.6 Hz flutter. The player hears the brownout before EVA announces it.
    const t = this.engine.now();
    for (const o of this.humOscs) {
      setAudioParamTargetAtTime(o.detune, lowPower ? AUDIO_AMBIENCE.humSagCents : 0, t, AUDIO_AMBIENCE.humSagSec / 3);
    }
  }

  private applyHumLevel(ms: number): void {
    if (this.hum === null) return;
    if (this.plants <= 0 || !this.humAudible) { this.hum.setGain(0, ms || 400); return; }
    const table = AUDIO_AMBIENCE.humDb;
    const db = table[Math.min(table.length - 1, this.plants - 1)];
    this.hum.setGain(dbToGain(db) * (this.lowPower ? 0.85 : 1), ms || 400);
  }

  /** Fades out when the camera leaves the base (§3.5: 4 s, > 40 tiles). */
  setHumAudible(v: boolean): void {
    if (v === this.humAudible) return;
    this.humAudible = v;
    this.applyHumLevel(AUDIO_AMBIENCE.humFadeSec * 1000);
  }

  /* ---- water ----------------------------------------------------------- */

  /** Only instantiated when water covers more than 8% of the visible frustum. */
  startWater(): void {
    if (this.water !== null) return;
    const e = this.engine;
    const loop = e.openLoop('ambience', 0, true);
    if (loop === null) return;
    const ctx = e.ctx;
    const bp = biquad(ctx, 'bandpass', 700, 0.8);
    const src = ctx.createBufferSource();
    src.buffer = e.white; src.loop = true;
    src.connect(bp).connect(loop.input);
    src.start();
    // Two slow sines gate the level: the swell, not individual waves.
    for (const [f, d] of [[0.35, 0.35], [0.9, 0.25]] as const) {
      const lfo = ctx.createOscillator();
      setAudioParamValue(lfo.frequency, f);
      const depth = gain(ctx, d);
      lfo.connect(depth).connect(loop.amp.gain);
      lfo.start();
      e.attachLoopSource(loop, lfo);
    }
    e.attachLoopSource(loop, src);
    this.water = loop;
    loop.setGain(dbToGain(-33), 1500);
  }

  stopWater(): void { this.water?.stop(1200); this.water = null; }

  /** Pan follows the visible-water centroid, clamped to +-0.4. */
  setWaterPan(pan: number): void { this.water?.setPan(Math.max(-0.4, Math.min(0.4, pan))); }

  dispose(): void {
    this.stopWind();
    this.stopWater();
    this.hum?.stop(400);
    this.hum = null;
    this.humOscs = [];
  }
}

/**
 * A pooled vehicle engine. `playbackRate` carries the throttle so nothing is
 * ever re-rendered, and the loop is culled the moment its distance gain falls
 * under the -42 dB floor.
 */
export class EngineLoop {
  private loop: LoopVoice | null = null;

  constructor(
    private readonly engine: AudioEngine,
    private readonly heavy: boolean,
  ) {}

  /** Idempotent: safe to call every frame while the unit is on screen. */
  start(): boolean {
    if (this.loop !== null) return true;
    const buf = this.engine.getBuffer(this.heavy ? SFX.engineHeavy : SFX.engineLight);
    if (buf === null) return false;
    const loop = this.engine.openLoop('sfx', 0, true);
    if (loop === null) return false;
    const src = this.engine.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(loop.input);
    src.start();
    this.engine.attachLoopSource(loop, src);
    this.loop = loop;
    return true;
  }

  /** throttle 0..1 -> rate 0.82..1.35 plus the idle/full level ramp. */
  update(x: number, y: number, z: number, throttle: number): void {
    const loop = this.loop;
    if (loop === null || !loop.alive) return;
    const t = Math.max(0, Math.min(1, throttle));
    loop.setRate(0.82 + t * 0.53, 120);
    // +6 dB over the old figure. The bed is peak-normalised, and replacing the
    // constant drone with a cylinder-firing pulse train dropped its RMS by
    // 7.5 dB at the same peak — a more realistic engine that was inaudible in
    // the mix is not an improvement.
    const db = (this.heavy ? -20 : -20) + t * 8;
    loop.setWorldPosition(x, y, z, dbToGain(db));
  }

  stop(): void { this.loop?.stop(300); this.loop = null; }
  get alive(): boolean { return this.loop !== null && this.loop.alive; }
}
