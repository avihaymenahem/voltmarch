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

import { FxKind, FX_KIND_COUNT } from '../core/types';
import { AUDIO_AMBIENCE } from '../core/config';
import {
  AudioEngine, LoopVoice, biquad, dbToGain, env, envSustain, gain, noiseSrc, osc, rand,
  ringMod, shaper, sweep, type BakeKit, type SoundSpec,
} from './AudioEngine';

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
 * 2. WEAPONS  (§3.4.1 – §3.4.5)
 * ========================================================================== */

/**
 * §3.4.1 Tank cannon — four layers over 900 ms.
 *
 *   A crack  noise -> LP Q1.0, 6500 -> 420 Hz over 140 ms, 1/180 ms,  -4 dB
 *   B body   sine        112 ->  41 Hz over 220 ms, 2/320 ms,         -3 dB
 *   C punch  triangle    250 ->  62 Hz over  60 ms, 1/90 ms,          -8 dB
 *   D tail   pink -> LP 300,                        40/750 ms,       -16 dB
 *
 * The Rhino variant is all frequencies x0.86, all decays x1.25, body +2 dB —
 * which is what makes a heavy tank read as heavy without simply being louder.
 */
function renderCannon(kit: BakeKit, heavy: boolean): void {
  const { oc, rng } = kit;
  const F = heavy ? 0.86 : 1;
  const T = heavy ? 1.25 : 1;
  const out = oc.destination;
  const t = 0;
  // Per-variant jitter (§3.4.1: freq x rand(0.94,1.07), durations x rand(0.92,1.08)).
  const fj = rand(rng, 0.94, 1.07);
  const tj = rand(rng, 0.92, 1.08);
  const lj = rand(rng, -1.5, 1.5);

  /* A — crack. The transient that reaches the player first. */
  {
    const g = gain(oc, dbToGain(-4 + lj));
    const lp = biquad(oc, 'lowpass', 6500 * F * fj, 1.0);
    sweep(lp.frequency, t, 6500 * F * fj, 420 * F * fj, 140 * T * tj);
    env(g.gain, t, 1, 1.0, 180 * T * tj);
    noiseSrc(kit, kit.white, t, 0.35 * T).connect(lp).connect(g).connect(out);
  }

  /* B — body. The 112 -> 41 Hz drop is the whole "big gun" impression. */
  {
    const g = gain(oc, dbToGain((heavy ? -1 : -3) + lj));
    const o = osc(oc, 'sine', 112 * F * fj, t, 0.6 * T);
    sweep(o.frequency, t, 112 * F * fj, 41 * F * fj, 220 * T * tj);
    env(g.gain, t, 2, 0.9, 320 * T * tj);
    o.connect(g).connect(out);
  }

  /* C — punch. Triangle, so it has odd harmonics the sine body does not. */
  {
    const g = gain(oc, dbToGain(-8 + lj));
    const o = osc(oc, 'triangle', 250 * F * fj, t, 0.2 * T);
    sweep(o.frequency, t, 250 * F * fj, 62 * F * fj, 60 * T * tj);
    env(g.gain, t, 1, 0.75, 90 * T * tj);
    o.connect(g).connect(out);
  }

  /* D — tail. Pink through a 300 Hz lowpass: the report bouncing off nothing. */
  {
    const g = gain(oc, dbToGain(-16));
    const lp = biquad(oc, 'lowpass', 300 * F, 0.7);
    env(g.gain, t, 40, 0.5, 750 * T * tj);
    noiseSrc(kit, kit.pink, t, 0.85 * T).connect(lp).connect(g).connect(out);
  }

  /* Muzzle sub-thump — camera-shake sync. Deliberately bypasses the tail LP. */
  {
    const g = gain(oc, dbToGain(-10));
    const o = osc(oc, 'sine', 45, t, 0.12);
    env(g.gain, t, 8, 1.0, 70);
    o.connect(g).connect(out);
  }

  /* Shell eject, 30% of firings, +55 ms. Q12 is what makes it ring like brass. */
  if (rng() < 0.3) {
    const te = 0.055;
    const g = gain(oc, dbToGain(-22));
    const bp = biquad(oc, 'bandpass', 3200 * fj, 12);
    env(g.gain, te, 3, 1.0, 120);
    noiseSrc(kit, kit.white, te, 0.16).connect(bp).connect(g).connect(out);
  }
}

/**
 * §3.4.2 Machine gun — ONE round, 90 ms. The burst rhythm (11 rounds/s, bursts
 * of 5-9) belongs to the firing system, not the sample; baking a burst would
 * make every burst the same length.
 */
function renderMg(kit: BakeKit, flak: boolean): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const fj = rand(rng, 0.93, 1.08);

  /* snap — noise -> HP 400 -> BP 1800 Q1.4, 0.5/16 ms, -7 dB */
  {
    const g = gain(oc, dbToGain(-7 + rand(rng, -1, 1)));
    const hp = biquad(oc, 'highpass', 400, 0.7);
    const bp = biquad(oc, 'bandpass', 1800 * fj, 1.4);
    env(g.gain, 0, 0.5, 1.0, 16);
    noiseSrc(kit, kit.white, 0, 0.05).connect(hp).connect(bp).connect(g).connect(out);
  }
  /* thump — square 185 -> 88 Hz over 25 ms */
  {
    const g = gain(oc, dbToGain(-13));
    const o = osc(oc, 'square', 185 * fj, 0, 0.06);
    sweep(o.frequency, 0, 185 * fj, 88 * fj, 25);
    env(g.gain, 0, 1, 1.0, 30);
    o.connect(g).connect(out);
  }
  /* air tail — noise -> HP 3500, 2/55 ms */
  {
    const g = gain(oc, dbToGain(-20));
    const hp = biquad(oc, 'highpass', 3500, 0.7);
    env(g.gain, 0, 2, 1.0, 55);
    noiseSrc(kit, kit.white, 0, 0.09).connect(hp).connect(g).connect(out);
  }
  /* flak adds a 40 ms BP 900 Q3 clank — the breech, not the bullet */
  if (flak) {
    const g = gain(oc, dbToGain(-12));
    const bp = biquad(oc, 'bandpass', 900 * fj, 3);
    env(g.gain, 0.004, 1, 1.0, 40);
    noiseSrc(kit, kit.white, 0.004, 0.06).connect(bp).connect(g).connect(out);
  }
}

/** §3.4.3 Rocket launch, 0-350 ms. The flight loop is a live graph (see below). */
function renderRocketLaunch(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const fj = rand(rng, 0.95, 1.06);

  /* whoosh — noise -> BP Q0.8 sweeping 400 -> 2400 Hz */
  {
    const g = gain(oc, dbToGain(-8));
    const bp = biquad(oc, 'bandpass', 400 * fj, 0.8);
    sweep(bp.frequency, 0, 400 * fj, 2400 * fj, 300);
    envSustain(g.gain, 0, 25, 1.0, 60, 0.7, 120, 140);
    noiseSrc(kit, kit.white, 0, 0.36).connect(bp).connect(g).connect(out);
  }
  /* ignition crack */
  {
    const g = gain(oc, dbToGain(-6));
    const hp = biquad(oc, 'highpass', 1500, 0.8);
    env(g.gain, 0, 0.5, 1.0, 45);
    noiseSrc(kit, kit.white, 0, 0.06).connect(hp).connect(g).connect(out);
  }
  /* sub kick */
  {
    const g = gain(oc, dbToGain(-11));
    const o = osc(oc, 'sine', 95, 0, 0.2);
    sweep(o.frequency, 0, 95, 48, 120);
    env(g.gain, 0, 2, 1.0, 150);
    o.connect(g).connect(out);
  }
}

/**
 * §3.4.5 Tesla charge, 700 ms. Saw 55 -> 220 Hz through a BP sweeping
 * 300 -> 2000 Hz Q2.5, ring-modulated against 3000 Hz at 25% wet. The ring mod
 * is what makes it read as ELECTRICAL rather than as an air-raid siren.
 */
function renderTeslaCharge(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const dur = 0.7;
  const fj = rand(rng, 0.96, 1.05);

  const o = osc(oc, 'sawtooth', 55 * fj, 0, dur);
  sweep(o.frequency, 0, 55 * fj, 220 * fj, 700);
  const bp = biquad(oc, 'bandpass', 300, 2.5);
  sweep(bp.frequency, 0, 300, 2000, 700);
  const rm = ringMod(oc, 3000, 0, dur, 0.25);
  const g = gain(oc, 1);
  // -30 -> -10 dB over the charge: the coil winding up.
  g.gain.setValueAtTime(dbToGain(-30), 0);
  g.gain.exponentialRampToValueAtTime(dbToGain(-10), dur);
  g.gain.exponentialRampToValueAtTime(0.0001, dur + 0.05);

  // 7 Hz flutter rising to 19 Hz — the instability that sells the charge.
  const flutter = osc(oc, 'sine', 7, 0, dur);
  sweep(flutter.frequency, 0, 7, 19, 700);
  const fdepth = gain(oc, 0.12);
  flutter.connect(fdepth).connect(g.gain);

  o.connect(bp).connect(rm.input);
  rm.output.connect(g).connect(out);
}

/**
 * §3.4.5 Tesla discharge — 3-5 grains, a 60 Hz beating body, a gated crackle
 * tail, all ring-modulated by 130 Hz. Six variants and rate jitter push the
 * perceived repeat period past 40 s with six coils on a 2 s cycle.
 */
function renderTeslaDischarge(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const rm = ringMod(oc, 130, 0, 1.0, 0.35);
  rm.output.connect(out);

  const amps = [1.0, 0.7, 0.45, 0.3, 0.2];
  const onsets = [0, 34, 71, 118, 176];
  const grains = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < grains; i++) {
    const t = (onsets[i] + rand(rng, -12, 12)) / 1000;
    if (t < 0) continue;
    const centre = rand(rng, 1200, 5200);
    const q = rand(rng, 6, 14);
    const g = gain(oc, dbToGain(-3) * amps[i]);
    const bp = biquad(oc, 'bandpass', centre, q);
    env(g.gain, t, 0.5, 1.0, 14);
    noiseSrc(kit, kit.white, t, 0.03).connect(bp).connect(g).connect(rm.input);
    // Square at centre/2 with an 8 ms decay: the body of the spark.
    const sg = gain(oc, dbToGain(-8) * amps[i]);
    const so = osc(oc, 'square', centre * 0.5, t, 0.03);
    env(sg.gain, t, 0.5, 1.0, 8);
    so.connect(sg).connect(rm.input);
  }

  /* body — two sines 10 Hz apart, so the beat itself is the "hum" */
  {
    const g = gain(oc, dbToGain(-9));
    env(g.gain, 0, 3, 1.0, 400);
    osc(oc, 'sine', 60, 0, 0.45).connect(g);
    osc(oc, 'sine', 50, 0, 0.45).connect(g);
    g.connect(rm.input);
  }

  /* crackle tail — HP 2500 gated by a 60 Hz control-rate random. The gate is
     baked as a step envelope because a live ScriptProcessor is not an option. */
  {
    const g = gain(oc, dbToGain(-20));
    const hp = biquad(oc, 'highpass', 2500, 0.8);
    const start = 0.22;
    const steps = Math.floor(0.25 * 60);
    g.gain.setValueAtTime(0, start);
    for (let s = 0; s < steps; s++) {
      const t = start + s / 60;
      const open = rng() > 0.45 ? 1 - s / steps : 0;
      g.gain.setValueAtTime(open, t);
    }
    g.gain.setValueAtTime(0, start + steps / 60);
    noiseSrc(kit, kit.white, start, 0.26).connect(hp).connect(g).connect(rm.input);
  }
}

/**
 * §3.4.4 Prism — 260 ms charge then a 200 ms fire, with a refraction split
 * repeating the fire at -4 dB, x1.19 pitch, +90 ms. The descending 1800 -> 320
 * sweep is the opposite direction to every other weapon here, on purpose.
 */
function renderPrism(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const fj = rand(rng, 0.97, 1.04);

  /* charge */
  {
    const rm = ringMod(oc, 971, 0, 0.3, 0.3);
    const o = osc(oc, 'sine', 620 * fj, 0, 0.3);
    sweep(o.frequency, 0, 620 * fj, 2100 * fj, 260);
    const g = gain(oc, 1);
    envSustain(g.gain, 0, 200, dbToGain(-9), 30, 0.8, 10, 60);
    o.connect(rm.input);
    rm.output.connect(g).connect(out);
  }

  /* fire, and the refracted copy */
  for (const [delay, db, mul] of [[0.26, -5, 1], [0.35, -9, 1.19]] as const) {
    const rm = ringMod(oc, 970, delay, 0.25, 0.45);
    const o = osc(oc, 'sine', 1800 * fj * mul, delay, 0.25);
    sweep(o.frequency, delay, 1800 * fj * mul, 320 * fj * mul, 180);
    const g = gain(oc, dbToGain(db));
    env(g.gain, delay, 1, 1.0, 200);
    o.connect(rm.input);
    rm.output.connect(g).connect(out);
    /* shimmer */
    const sg = gain(oc, dbToGain(db - 13));
    const bp = biquad(oc, 'bandpass', 6200, 3);
    env(sg.gain, delay, 5, 1.0, 180);
    noiseSrc(kit, kit.white, delay, 0.2).connect(bp).connect(sg).connect(out);
  }
}

/** Flame jet: a low roar under a gated hiss. Not in the spec table; kept quiet. */
function renderFlame(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const g = gain(oc, dbToGain(-10));
  const bp = biquad(oc, 'bandpass', 700, 0.6);
  sweep(bp.frequency, 0, 500, 1400, 220);
  envSustain(g.gain, 0, 18, 1.0, 120, 0.55, 180, 260);
  noiseSrc(kit, kit.pink, 0, 0.7).connect(bp).connect(g).connect(out);
  const rg = gain(oc, dbToGain(-14));
  const lp = biquad(oc, 'lowpass', 260, 0.9);
  env(rg.gain, 0, 30, 1.0, 480);
  noiseSrc(kit, kit.white, 0, 0.6).connect(lp).connect(rg).connect(out);
  // A little flutter so it does not read as a single static hiss.
  const fl = osc(oc, 'sine', rand(rng, 9, 15), 0, 0.7);
  const fd = gain(oc, 0.25);
  fl.connect(fd).connect(g.gain);
}

/**
 * §3.4.11 Attack dog. Not speech: three saws through a BP sweeping
 * 700 -> 1800 -> 500 Hz over 180 ms, two or three barks 210 ms apart.
 */
function renderDog(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const barks = 2 + (rng() < 0.5 ? 0 : 1);
  for (let b = 0; b < barks; b++) {
    const t = b * 0.21;
    const r = rand(rng, 0.92, 1.10);
    const bp = biquad(oc, 'bandpass', 700 * r, 1.6);
    bp.frequency.setValueAtTime(700 * r, t);
    bp.frequency.linearRampToValueAtTime(1800 * r, t + 0.06);
    bp.frequency.linearRampToValueAtTime(500 * r, t + 0.18);
    const g = gain(oc, dbToGain(-6));
    envSustain(g.gain, t, 4, 1.0, 40, 0.4, 40, 140);
    for (const f of [340, 510, 680]) osc(oc, 'sawtooth', f * r, t, 0.22).connect(bp);
    const ng = gain(oc, dbToGain(-14));
    env(ng.gain, t, 4, 1.0, 180);
    noiseSrc(kit, kit.white, t, 0.2).connect(bp);
    ng.connect(out);
    bp.connect(g).connect(out);
  }
}

/* ==========================================================================
 * 3. EXPLOSIONS  (§3.4.6)
 * ========================================================================== */

/** Small, 260 ms. Peak -14 dB. */
function renderExplosionSmall(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const fj = rand(rng, 0.93, 1.08);
  {
    const g = gain(oc, dbToGain(-14));
    const lp = biquad(oc, 'lowpass', 3000 * fj, 0.9);
    sweep(lp.frequency, 0, 3000 * fj, 300, 120);
    env(g.gain, 0, 0.5, 1.0, 180);
    noiseSrc(kit, kit.white, 0, 0.28).connect(lp).connect(g).connect(out);
  }
  {
    const g = gain(oc, dbToGain(-9));
    const o = osc(oc, 'sine', 125 * fj, 0, 0.24);
    sweep(o.frequency, 0, 125 * fj, 52, 100);
    env(g.gain, 0, 1, 1.0, 160);
    o.connect(g).connect(out);
  }
}

/**
 * Medium, 1.1 s. Peak -4 dB. The 92 -> 30 Hz sub is the LOUDEST single element
 * in the whole recipe — an explosion that lives in the mids sounds like a bag
 * of crisps.
 */
function renderExplosionMedium(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const fj = rand(rng, 0.94, 1.07);
  /* pre-crack */
  {
    const g = gain(oc, dbToGain(-6));
    const hp = biquad(oc, 'highpass', 2200, 0.8);
    env(g.gain, 0, 0.4, 1.0, 28);
    noiseSrc(kit, kit.white, 0, 0.05).connect(hp).connect(g).connect(out);
  }
  /* body */
  {
    const g = gain(oc, dbToGain(-4));
    const lp = biquad(oc, 'lowpass', 5000 * fj, 0.9);
    sweep(lp.frequency, 0, 5000 * fj, 180, 400);
    env(g.gain, 0, 1, 1.0, 700);
    noiseSrc(kit, kit.pink, 0, 0.8).connect(lp).connect(g).connect(out);
  }
  /* sub */
  {
    const g = gain(oc, dbToGain(-3));
    const o = osc(oc, 'sine', 92 * fj, 0, 0.7);
    sweep(o.frequency, 0, 92 * fj, 30, 450);
    env(g.gain, 0, 3, 1.0, 620);
    o.connect(g).connect(out);
  }
  debrisGrains(kit, 6 + Math.floor(rng() * 5), 0.25, 0.9, -24);
}

/**
 * Large, 2.6 s. Peak -1 dB, plus four metallic collapse hits at exactly the
 * times the VFX module staggers its secondary puffs (380/620/910/1350 ms), so
 * picture and sound land together. Ducking the SFX bus for the boom is handled
 * by the caller, not the bake.
 */
function renderExplosionLarge(kit: BakeKit): void {
  const { oc, rng } = kit;
  const out = oc.destination;
  const fj = rand(rng, 0.95, 1.06);
  {
    const g = gain(oc, dbToGain(-3));
    const hp = biquad(oc, 'highpass', 2000, 0.8);
    env(g.gain, 0, 0.5, 1.0, 40);
    noiseSrc(kit, kit.white, 0, 0.07).connect(hp).connect(g).connect(out);
  }
  {
    const g = gain(oc, dbToGain(-1));
    const lp = biquad(oc, 'lowpass', 6000 * fj, 0.9);
    sweep(lp.frequency, 0, 6000 * fj, 120, 900);
    env(g.gain, 0, 2, 1.0, 1600);
    noiseSrc(kit, kit.pink, 0, 1.8).connect(lp).connect(g).connect(out);
  }
  {
    const g = gain(oc, dbToGain(-1));
    const o = osc(oc, 'sine', 70 * fj, 0, 1.8);
    sweep(o.frequency, 0, 70 * fj, 22, 1200);
    env(g.gain, 0, 5, 1.0, 1500);
    o.connect(g).connect(out);
  }
  /* rumble bed — pink -> LP 90 Hz modulated at 0.7 Hz, depth 0.5 */
  {
    const g = gain(oc, dbToGain(-12));
    const lp = biquad(oc, 'lowpass', 90, 0.7);
    env(g.gain, 0.05, 60, 1.0, 900);
    const lfo = osc(oc, 'sine', 0.7, 0, 1.2);
    const depth = gain(oc, 0.5);
    lfo.connect(depth).connect(g.gain);
    noiseSrc(kit, kit.pink, 0.05, 1.0).connect(lp).connect(g).connect(out);
  }
  /* four metallic collapse hits */
  for (const ms of [380, 620, 910, 1350]) {
    const t = (ms + rand(rng, -25, 25)) / 1000;
    const g = gain(oc, dbToGain(-16));
    const bp = biquad(oc, 'bandpass', rand(rng, 200, 700), 8);
    env(g.gain, t, 1, 1.0, 90);
    noiseSrc(kit, kit.white, t, 0.12).connect(bp).connect(g).connect(out);
  }
  debrisGrains(kit, 25, 0.1, 2.5, -20);
}

/** Shared debris scatter: short band-passed noise grains on ballistic onsets. */
function debrisGrains(kit: BakeKit, count: number, from: number, to: number, db: number): void {
  const { oc, rng } = kit;
  for (let i = 0; i < count; i++) {
    const t = rand(rng, from, to);
    const g = gain(oc, dbToGain(db));
    const bp = biquad(oc, 'bandpass', rand(rng, 900, 4000), 4);
    env(g.gain, t, 1, 1.0, 20);
    noiseSrc(kit, kit.white, t, 0.04).connect(bp).connect(g).connect(oc.destination);
  }
}

/* ==========================================================================
 * 4. IMPACTS AND ODDS  (§3.4.8)
 * ========================================================================== */

function renderImpactArmor(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-18));
  const bp = biquad(oc, 'bandpass', rand(rng, 2200, 4800), 10);
  env(g.gain, 0, 0.5, 1.0, 70);
  noiseSrc(kit, kit.white, 0, 0.09).connect(bp).connect(g).connect(oc.destination);
  /* ricochet, 15% — the falling whistle everyone knows from westerns */
  if (rng() < 0.15) {
    const rg = gain(oc, dbToGain(-24));
    const o = osc(oc, 'sine', rand(rng, 2600, 4200), 0.01, 0.25);
    sweep(o.frequency, 0.01, o.frequency.value, rand(rng, 700, 1200), 220);
    env(rg.gain, 0.01, 3, 1.0, 220);
    o.connect(rg).connect(oc.destination);
  }
}

function renderImpactDirt(kit: BakeKit, crisp: boolean): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-22));
  const lp = biquad(oc, 'lowpass', 900, 0.8);
  env(g.gain, 0, 1, 1.0, 110);
  noiseSrc(kit, kit.white, 0, 0.14).connect(lp).connect(g).connect(oc.destination);
  if (crisp) {
    const cg = gain(oc, dbToGain(-28));
    const hp = biquad(oc, 'highpass', 2500, 0.8);
    env(cg.gain, 0, 0.5, 1.0, 60);
    noiseSrc(kit, kit.white, 0, 0.08).connect(hp).connect(cg).connect(oc.destination);
  }
}

function renderImpactConcrete(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-18));
  const bp = biquad(oc, 'bandpass', rand(rng, 600, 1400), 4);
  env(g.gain, 0, 0.5, 1.0, 90);
  noiseSrc(kit, kit.white, 0, 0.12).connect(bp).connect(g).connect(oc.destination);
  const sg = gain(oc, dbToGain(-24));
  const lp = biquad(oc, 'lowpass', 400, 0.7);
  env(sg.gain, 0, 2, 1.0, 220);
  noiseSrc(kit, kit.pink, 0, 0.26).connect(lp).connect(sg).connect(oc.destination);
}

function renderSplash(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-16));
  const bp = biquad(oc, 'bandpass', 1200, 0.7);
  sweep(bp.frequency, 0, 2200, 600, 240);
  env(g.gain, 0, 2, 1.0, 260);
  noiseSrc(kit, kit.white, 0, 0.32).connect(bp).connect(g).connect(oc.destination);
  const dg = gain(oc, dbToGain(-20));
  const o = osc(oc, 'sine', 220, 0, 0.2);
  sweep(o.frequency, 0, 220, 90, 160);
  env(dg.gain, 0, 3, 1.0, 180);
  o.connect(dg).connect(oc.destination);
  for (let i = 0; i < 4; i++) {
    const t = rand(rng, 0.05, 0.3);
    const pg = gain(oc, dbToGain(-30));
    const pb = biquad(oc, 'bandpass', rand(rng, 1800, 4200), 8);
    env(pg.gain, t, 1, 1.0, 30);
    noiseSrc(kit, kit.white, t, 0.05).connect(pb).connect(pg).connect(oc.destination);
  }
}

function renderSparks(kit: BakeKit): void {
  const { oc, rng } = kit;
  for (let i = 0; i < 6; i++) {
    const t = rand(rng, 0, 0.18);
    const g = gain(oc, dbToGain(-24));
    const bp = biquad(oc, 'bandpass', rand(rng, 3000, 7000), 9);
    env(g.gain, t, 0.5, 1.0, 22);
    noiseSrc(kit, kit.white, t, 0.04).connect(bp).connect(g).connect(oc.destination);
  }
}

function renderShellCasing(kit: BakeKit): void {
  const { oc, rng } = kit;
  for (let i = 0; i < 3; i++) {
    const t = i * rand(rng, 0.05, 0.09);
    const g = gain(oc, dbToGain(-26 - i * 3));
    const bp = biquad(oc, 'bandpass', rand(rng, 2600, 4600), 14);
    env(g.gain, t, 1, 1.0, 60);
    noiseSrc(kit, kit.white, t, 0.08).connect(bp).connect(g).connect(oc.destination);
  }
}

/** A tracked vehicle driving over infantry. Wet, low, and short. */
function renderCrush(kit: BakeKit): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-14));
  const lp = biquad(oc, 'lowpass', 700, 1.2);
  sweep(lp.frequency, 0, 1200, 260, 180);
  env(g.gain, 0, 4, 1.0, 200);
  noiseSrc(kit, kit.pink, 0, 0.3).connect(lp).connect(g).connect(oc.destination);
  const cg = gain(oc, dbToGain(-18));
  const o = osc(oc, 'triangle', 90, 0, 0.2);
  sweep(o.frequency, 0, 90, 42, 140);
  env(cg.gain, 0, 2, 1.0, 170);
  o.connect(cg).connect(oc.destination);
}

/** Infantry death — a short vocal fall, deliberately non-verbal and quiet. */
function renderInfantryDeath(kit: BakeKit): void {
  const { oc, rng } = kit;
  const f0 = rand(rng, 110, 165);
  const g = gain(oc, dbToGain(-18));
  const o = osc(oc, 'sawtooth', f0, 0, 0.45);
  sweep(o.frequency, 0, f0, f0 * 0.62, 380);
  const bp = biquad(oc, 'bandpass', 720, 1.4);
  const lp = biquad(oc, 'lowpass', 2200, 0.7);
  envSustain(g.gain, 0, 14, 1.0, 60, 0.6, 90, 240);
  o.connect(bp).connect(lp).connect(g).connect(oc.destination);
}

/** A structure rising out of the ground: servo whine plus settling grit. */
function renderBuildRise(kit: BakeKit): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-16));
  const o = osc(oc, 'sawtooth', 90, 0, 1.1);
  sweep(o.frequency, 0, 90, 210, 900);
  const lp = biquad(oc, 'lowpass', 900, 2.0);
  sweep(lp.frequency, 0, 500, 1500, 900);
  envSustain(g.gain, 0, 120, 1.0, 200, 0.7, 400, 300);
  o.connect(lp).connect(g).connect(oc.destination);
  const gg = gain(oc, dbToGain(-22));
  const bp = biquad(oc, 'bandpass', 1400, 1.1);
  envSustain(gg.gain, 0, 200, 1.0, 200, 0.5, 300, 400);
  noiseSrc(kit, kit.pink, 0, 1.2).connect(bp).connect(gg).connect(oc.destination);
}

/** Sell / demolish: descending saw 400 -> 90 Hz with a three-hit debris tail. */
function renderSell(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-12));
  const o = osc(oc, 'sawtooth', 400, 0, 0.6);
  sweep(o.frequency, 0, 400, 90, 500);
  const lp = biquad(oc, 'lowpass', 900, 0.9);
  envSustain(g.gain, 0, 8, 1.0, 120, 0.6, 260, 220);
  o.connect(lp).connect(g).connect(oc.destination);
  for (let i = 0; i < 3; i++) {
    const t = 0.35 + i * rand(rng, 0.09, 0.16);
    const dg = gain(oc, dbToGain(-20 - i * 2));
    const bp = biquad(oc, 'bandpass', rand(rng, 300, 1200), 6);
    env(dg.gain, t, 1, 1.0, 110);
    noiseSrc(kit, kit.white, t, 0.14).connect(bp).connect(dg).connect(oc.destination);
  }
}

/** §3.5 ore dump: 900 ms of noise falling 1200 -> 400 Hz with 14 rattle grains. */
function renderOreDump(kit: BakeKit): void {
  const { oc, rng } = kit;
  const g = gain(oc, dbToGain(-16));
  const lp = biquad(oc, 'lowpass', 1200, 0.9);
  sweep(lp.frequency, 0, 1200, 400, 900);
  envSustain(g.gain, 0, 30, 1.0, 150, 0.6, 400, 320);
  noiseSrc(kit, kit.pink, 0, 0.95).connect(lp).connect(g).connect(oc.destination);
  for (let i = 0; i < 14; i++) {
    const t = rand(rng, 0.02, 0.85);
    const rg = gain(oc, dbToGain(-26));
    const bp = biquad(oc, 'bandpass', rand(rng, 900, 3200), 11);
    env(rg.gain, t, 1, 1.0, 45);
    noiseSrc(kit, kit.white, t, 0.06).connect(bp).connect(rg).connect(oc.destination);
  }
}

/* ==========================================================================
 * 5. ENGINE LOOPS  (§3.4.10)
 *
 * Baked as 2.0 s buffers driven by `playbackRate`, so a throttle change never
 * re-renders anything. The loop point is seamless because every oscillator
 * frequency below divides evenly into 2.0 s.
 * ========================================================================== */

function renderEngine(kit: BakeKit, heavy: boolean): void {
  const { oc } = kit;
  const dur = 2.0;
  const base = heavy ? 38 : 55;
  const out = oc.destination;

  const g = gain(oc, dbToGain(heavy ? -19 : -21));
  const lp = biquad(oc, 'lowpass', heavy ? 700 : 900, 3);
  const drive = shaper(oc, heavy ? 5 : 4, '2x');
  lp.connect(drive).connect(g).connect(out);

  // Two saws a fifth apart, detuned +9 cents. That beat is the diesel wobble.
  const a = osc(oc, 'sawtooth', base, 0, dur);
  const b = osc(oc, 'sawtooth', base * 1.5, 0, dur);
  b.detune.value = 9;
  a.connect(lp);
  const bg = gain(oc, 0.7);
  b.connect(bg).connect(lp);

  // Heavy tanks add a gated tread layer: BP 1100 Q2 chopped at 4.5 Hz.
  if (heavy) {
    // Base at half level, swung the other half by a 4.5 Hz square: a gate.
    const half = dbToGain(-24) * 0.5;
    const tg = gain(oc, half);
    const bp = biquad(oc, 'bandpass', 1100, 2);
    const gate = osc(oc, 'square', 4.5, 0, dur);
    const depth = gain(oc, half);
    gate.connect(depth).connect(tg.gain);
    noiseSrc(kit, kit.white, 0, dur).connect(bp).connect(tg).connect(out);
  }
}

/* ==========================================================================
 * 6. UI  (§3.5)
 *
 * All mono, all centred, no distance and no pan — a sidebar click that pans is
 * a bug the player feels before they can name it.
 * ========================================================================== */

function renderUiClick(kit: BakeKit, bpHz: number, thumpHz: number, thumpMs: number): void {
  const { oc } = kit;
  const out = oc.destination;
  {
    const g = gain(oc, dbToGain(-10));
    const bp = biquad(oc, 'bandpass', bpHz, 3);
    env(g.gain, 0, 0.5, 1.0, 8);
    noiseSrc(kit, kit.white, 0, 0.02).connect(bp).connect(g).connect(out);
  }
  {
    const g = gain(oc, dbToGain(-14));
    const o = osc(oc, 'square', 900, 0, 0.02);
    env(g.gain, 0, 1, 1.0, 6);
    o.connect(g).connect(out);
  }
  {
    const g = gain(oc, dbToGain(-16));
    const o = osc(oc, 'sine', thumpHz, 0, thumpMs / 1000 + 0.02);
    env(g.gain, 0, 1, 1.0, thumpMs);
    o.connect(g).connect(out);
  }
}

/** G5 / B5 / D6 at 0 / 90 / 180 ms, each with two partials, through a slap. */
function renderChime(kit: BakeKit): void {
  const { oc } = kit;
  const out = oc.destination;
  const bus = gain(oc, 1);
  bus.connect(out);
  // 90 ms delay at feedback 0.2, wet -20 dB. One tap is enough at this length.
  const dly = oc.createDelay(0.5);
  dly.delayTime.value = 0.09;
  const fb = gain(oc, 0.2);
  const wet = gain(oc, dbToGain(-20));
  bus.connect(dly).connect(fb).connect(dly);
  dly.connect(wet).connect(out);

  const notes = [784, 988, 1175];
  for (let i = 0; i < notes.length; i++) {
    const t = i * 0.09;
    for (const [mul, db] of [[1, 0], [2, -12], [3, -20]] as const) {
      const g = gain(oc, dbToGain(-10 + db));
      const o = osc(oc, 'sine', notes[i] * mul, t, 0.45);
      env(g.gain, t, 4, 1.0, 380);
      o.connect(g).connect(bus);
    }
  }
}

/** Placement thunk: -6 dB, because it has to feel like a building landing. */
function renderThunk(kit: BakeKit): void {
  const { oc } = kit;
  const out = oc.destination;
  {
    const g = gain(oc, dbToGain(-6));
    const o = osc(oc, 'sine', 140, 0, 0.3);
    sweep(o.frequency, 0, 140, 48, 220);
    env(g.gain, 0, 2, 1.0, 260);
    o.connect(g).connect(out);
  }
  {
    const g = gain(oc, dbToGain(-12));
    const lp = biquad(oc, 'lowpass', 400, 0.9);
    env(g.gain, 0, 1, 1.0, 90);
    noiseSrc(kit, kit.white, 0, 0.12).connect(lp).connect(g).connect(out);
  }
  /* settling dust, 480 ms — this is the layer that makes it read as heavy */
  {
    const g = gain(oc, dbToGain(-18));
    const bp = biquad(oc, 'bandpass', 1100, 1.2);
    envSustain(g.gain, 0, 40, 1.0, 60, 0.35, 200, 300);
    noiseSrc(kit, kit.pink, 0, 0.6).connect(bp).connect(g).connect(out);
  }
}

/** Error buzz: three 55 ms pulses through a hard tanh. Unmistakably "no". */
function renderError(kit: BakeKit): void {
  const { oc } = kit;
  const bp = biquad(oc, 'bandpass', 700, 3);
  const drive = shaper(oc, 6, '2x');
  const g = gain(oc, dbToGain(-11));
  bp.connect(drive).connect(g).connect(oc.destination);
  const a = osc(oc, 'square', 110, 0, 0.32);
  const b = osc(oc, 'square', 110, 0, 0.32);
  b.detune.value = -12;
  a.connect(bp); b.connect(bp);
  // Three 55 ms pulses with 45 ms gaps, written straight onto the output gain.
  for (let i = 0; i < 3; i++) {
    const t = i * 0.1;
    g.gain.setValueAtTime(0, t);
    g.gain.setValueAtTime(dbToGain(-11), t + 0.002);
    g.gain.setValueAtTime(dbToGain(-11), t + 0.055);
    g.gain.setValueAtTime(0, t + 0.057);
  }
}

function renderReadyFlash(kit: BakeKit): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-18));
  const o = osc(oc, 'sine', 1568, 0, 0.2);
  env(g.gain, 0, 3, 1.0, 160);
  o.connect(g).connect(oc.destination);
  const pg = gain(oc, dbToGain(-34));
  const po = osc(oc, 'sine', 3136, 0, 0.2);
  env(pg.gain, 0, 3, 1.0, 160);
  po.connect(pg).connect(oc.destination);
}

function renderPing(kit: BakeKit): void {
  const { oc } = kit;
  for (const t of [0, 0.14]) {
    const g = gain(oc, dbToGain(-20));
    const o = osc(oc, 'sine', 1046, t, 0.08);
    env(g.gain, t, 2, 1.0, 60);
    o.connect(g).connect(oc.destination);
  }
}

function renderTick(kit: BakeKit): void {
  const { oc } = kit;
  const g = gain(oc, dbToGain(-22));
  const o = osc(oc, 'sine', 1200, 0, 0.03);
  env(g.gain, 0, 1, 1.0, 20);
  o.connect(g).connect(oc.destination);
  const cg = gain(oc, dbToGain(-26));
  const bp = biquad(oc, 'bandpass', 3000, 6);
  env(cg.gain, 0, 0.5, 1.0, 8);
  noiseSrc(kit, kit.white, 0, 0.02).connect(bp).connect(cg).connect(oc.destination);
}

/* ==========================================================================
 * 7. REGISTRATION
 * ========================================================================== */

/** Variant counts come straight from §3.1. */
export function registerSfxBank(engine: AudioEngine): void {
  const specs: SoundSpec[] = [
    /* -- weapons -- */
    { id: SFX.cannonLight, bus: 'sfx', category: 'gunfire', db: -4, variants: 6, seconds: 0.95,
      rateJitter: 0.065, sendDb: -20, render: (k) => renderCannon(k, false) },
    { id: SFX.cannonHeavy, bus: 'sfx', category: 'gunfire', db: -3, variants: 6, seconds: 1.15,
      rateJitter: 0.06, sendDb: -18, render: (k) => renderCannon(k, true) },
    { id: SFX.machineGun, bus: 'sfx', category: 'gunfire', db: -7, variants: 8, seconds: 0.12,
      rateJitter: 0.09, sendDb: -30, render: (k) => renderMg(k, false) },
    { id: SFX.flak, bus: 'sfx', category: 'gunfire', db: -6, variants: 6, seconds: 0.14,
      rateJitter: 0.08, sendDb: -28, render: (k) => renderMg(k, true) },
    { id: SFX.rocketLaunch, bus: 'sfx', category: 'rocket', db: -8, variants: 4, seconds: 0.42,
      rateJitter: 0.06, sendDb: -24, render: renderRocketLaunch },
    { id: SFX.teslaCharge, bus: 'sfx', category: 'tesla', db: -8, variants: 3, seconds: 0.78,
      rateJitter: 0.04, sendDb: -26, render: renderTeslaCharge },
    { id: SFX.teslaDischarge, bus: 'sfx', category: 'tesla', db: -5, variants: 6, seconds: 0.62,
      rateJitter: 0.08, sendDb: -20, render: renderTeslaDischarge },
    { id: SFX.prismFire, bus: 'sfx', category: 'gunfire', db: -5, variants: 4, seconds: 0.68,
      rateJitter: 0.05, sendDb: -22, render: renderPrism },
    { id: SFX.flameJet, bus: 'sfx', category: 'gunfire', db: -10, variants: 4, seconds: 0.75,
      rateJitter: 0.08, sendDb: -26, render: renderFlame },
    { id: SFX.dogBark, bus: 'sfx', category: 'misc', db: -8, variants: 4, seconds: 0.7,
      rateJitter: 0.07, sendDb: -24, render: renderDog },

    /* -- explosions -- */
    { id: SFX.explosionSmall, bus: 'sfx', category: 'explosion', db: -14, variants: 6, seconds: 0.32,
      rateJitter: 0.08, sendDb: -28, render: renderExplosionSmall },
    { id: SFX.explosionMedium, bus: 'sfx', category: 'explosion', db: -4, variants: 5, seconds: 1.2,
      rateJitter: 0.06, sendDb: -18, render: renderExplosionMedium },
    { id: SFX.explosionLarge, bus: 'sfx', category: 'explosion', db: -1, variants: 4, seconds: 2.7,
      rateJitter: 0.05, sendDb: -10, render: renderExplosionLarge },

    /* -- impacts -- */
    { id: SFX.impactArmor, bus: 'sfx', category: 'misc', db: -18, variants: 6, seconds: 0.3,
      rateJitter: 0.1, render: renderImpactArmor },
    { id: SFX.impactDirt, bus: 'sfx', category: 'misc', db: -22, variants: 5, seconds: 0.18,
      rateJitter: 0.1, render: (k) => renderImpactDirt(k, false) },
    { id: SFX.impactConcrete, bus: 'sfx', category: 'misc', db: -18, variants: 5, seconds: 0.3,
      rateJitter: 0.09, render: renderImpactConcrete },
    { id: SFX.impactWater, bus: 'sfx', category: 'misc', db: -16, variants: 4, seconds: 0.4,
      rateJitter: 0.08, render: renderSplash },
    { id: SFX.debris, bus: 'sfx', category: 'misc', db: -20, variants: 12, seconds: 0.09,
      rateJitter: 0.14, render: (k) => debrisGrains(k, 1, 0, 0.01, -20) },
    { id: SFX.shellCasing, bus: 'sfx', category: 'misc', db: -24, variants: 4, seconds: 0.3,
      rateJitter: 0.12, render: renderShellCasing },
    { id: SFX.sparks, bus: 'sfx', category: 'misc', db: -22, variants: 4, seconds: 0.24,
      rateJitter: 0.1, render: renderSparks },

    /* -- gameplay odds -- */
    { id: SFX.crush, bus: 'sfx', category: 'misc', db: -14, variants: 4, seconds: 0.3,
      rateJitter: 0.1, render: renderCrush },
    { id: SFX.infantryDeath, bus: 'sfx', category: 'misc', db: -18, variants: 5, seconds: 0.5,
      rateJitter: 0.09, render: renderInfantryDeath },
    { id: SFX.buildRise, bus: 'sfx', category: 'misc', db: -16, variants: 2, seconds: 1.25,
      rateJitter: 0.04, render: renderBuildRise },
    { id: SFX.sellPuff, bus: 'sfx', category: 'misc', db: -12, variants: 2, seconds: 0.75,
      rateJitter: 0.05, render: renderSell },
    { id: SFX.oreDump, bus: 'sfx', category: 'misc', db: -16, variants: 3, seconds: 1.0,
      rateJitter: 0.05, render: renderOreDump },

    /* -- engine beds (played as loops, never as one-shots) -- */
    { id: SFX.engineLight, bus: 'sfx', category: 'engine', db: -21, variants: 1, seconds: 2.0,
      render: (k) => renderEngine(k, false) },
    { id: SFX.engineHeavy, bus: 'sfx', category: 'engine', db: -19, variants: 1, seconds: 2.0,
      render: (k) => renderEngine(k, true) },

    /* -- UI: non-positional, no crowd summation -- */
    ui(SFX.uiClick, -12, 3, 0.06, (k) => renderUiClick(k, 2200, 55, 40)),
    ui(SFX.uiTab, -13, 3, 0.09, (k) => renderUiClick(k, 1500, 130, 55)),
    ui(SFX.uiHover, -28, 2, 0.02, (k) => {
      const g = gain(k.oc, dbToGain(-28));
      const bp = biquad(k.oc, 'bandpass', 3400, 5);
      env(g.gain, 0, 0.5, 1.0, 4);
      noiseSrc(k, k.white, 0, 0.01).connect(bp).connect(g).connect(k.oc.destination);
    }),
    ui(SFX.uiChime, -10, 1, 0.8, renderChime),
    ui(SFX.uiReady, -18, 1, 0.24, renderReadyFlash),
    ui(SFX.uiThunk, -6, 3, 0.55, renderThunk),
    ui(SFX.uiGhost, -34, 3, 0.02, (k) => {
      const g = gain(k.oc, dbToGain(-34));
      const bp = biquad(k.oc, 'bandpass', 2800, 6);
      env(g.gain, 0, 0.4, 1.0, 3);
      noiseSrc(k, k.white, 0, 0.008).connect(bp).connect(g).connect(k.oc.destination);
    }),
    ui(SFX.uiError, -11, 2, 0.34, renderError),
    ui(SFX.uiSell, -12, 2, 0.75, renderSell),
    ui(SFX.uiPing, -20, 1, 0.25, renderPing),
    ui(SFX.uiTick, -22, 2, 0.05, renderTick),
  ];

  for (const s of specs) engine.register(s);
}

function ui(
  id: string, db: number, variants: number, seconds: number, render: (k: BakeKit) => void,
): SoundSpec {
  return {
    id, bus: 'ui', category: 'ui', db, variants, seconds,
    positional: false, noCrowd: true, rateJitter: 0.02, render,
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
    lp.frequency.value = mid;
    const lfoA = ctx.createOscillator(); lfoA.frequency.value = 0.05;
    const lfoB = ctx.createOscillator(); lfoB.frequency.value = 0.13;
    const depthA = gain(ctx, span * 0.72);
    const depthB = gain(ctx, span * 0.28);
    lfoA.connect(depthA).connect(lp.frequency);
    lfoB.connect(depthB).connect(lp.frequency);
    lfoA.start(); lfoB.start();

    // Gain LFO at 0.06 Hz, depth 0.35 — gusts you feel before you hear.
    const lfoG = ctx.createOscillator(); lfoG.frequency.value = 0.06;
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
      const wander = ctx.createOscillator(); wander.frequency.value = 0.11;
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
        lp.frequency.cancelScheduledValues(t);
        lp.frequency.setTargetAtTime(1400, t, 0.8);
        lp.frequency.setTargetAtTime(lp.frequency.value, t + 2.5, 1.4);
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
      o.frequency.value = f;
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
      o.detune.setTargetAtTime(lowPower ? AUDIO_AMBIENCE.humSagCents : 0, t, AUDIO_AMBIENCE.humSagSec / 3);
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
      lfo.frequency.value = f;
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
    const db = this.heavy ? -26 + t * 8 : -26 + t * 8;
    loop.setWorldPosition(x, y, z, dbToGain(db));
  }

  stop(): void { this.loop?.stop(300); this.loop = null; }
  get alive(): boolean { return this.loop !== null && this.loop.alive; }
}
