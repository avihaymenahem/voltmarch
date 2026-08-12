/**
 * ============================================================================
 * VOLTMARCH — src/audio/Eva.ts
 * ============================================================================
 * THE ANNOUNCER. A procedural formant synthesiser, a radio-comms chain, and the
 * priority queue that stops "Our base is under attack" firing twelve times in
 * four seconds.
 *
 * WHY A FORMANT SYNTH AND NOT SpeechSynthesis (VISUAL_DNA §3.2)
 * -------------------------------------------------------------
 * `SpeechSynthesisUtterance` output does not route through `AudioContext` in
 * any shipping browser. It cannot be bandpassed, cannot be ducked from an
 * analyser, and cannot be positioned — which means it cannot be made to sound
 * like a radio, and the radio is the entire character. So Tier B (this file's
 * `renderUtterance`) is the DEFAULT and the aesthetic choice.
 *
 * Tier A (the system voice) is still implemented, because it is the
 * intelligibility option and some players need it: `?eva=system` swaps to it,
 * plays a synthesized squelch bed in sync so it still reads as a transmission,
 * and drives the music duck from `onstart`/`onend` rather than from the graph.
 *
 * PHONEME STRINGS ARE HAND-AUTHORED
 * ---------------------------------
 * There is no text-to-phoneme engine here and there must not be one: forty
 * lines of hand-tuned ASCII phonemes is a few kilobytes and always right, while
 * a G2P engine is thousands of lines and mispronounces "Chronosphere" forever.
 *
 * SEPARATORS. A space merely separates two phones INSIDE a word and costs no
 * time — phonemes in running speech are contiguous, and inserting 70 ms between
 * every one of them turns a sentence into a robot spelling it out. A comma is
 * the word gap (70 ms); a semicolon is a phrase pause (180 ms).
 *
 * The ASCII alphabet (one char per phone):
 *   VOWELS  i ɪ ɛ æ ɑ ɔ ʊ u ʌ ɝ ə   ->  i I E a A O U u V R @
 *   DIPHTH  eɪ oʊ aɪ ɔɪ aʊ           ->  e o Y W Q
 *   SONOR   l r w j                  ->  l r w j
 *   NASAL   n m ŋ                    ->  n m N
 *   FRIC    s z ʃ ʒ f v θ ð h        ->  s z S Z f v T D h
 *   PLOSIVE p b t d k g              ->  p b t d k g
 *   AFFRIC  tʃ dʒ                    ->  C J
 * ============================================================================
 */

import { AUDIO_DUCK, AUDIO_EVA } from '../core/config';
import { EvaLine } from '../core/types';
import {
  AudioEngine, LoopVoice, biquad, dbToGain, gain, makeRng, normalizeBuffer, rand, shaper,
  type Rng01,
} from './AudioEngine';
import { EVA_MANIFEST, SampleBank, evaPath } from './Samples';

/* ==========================================================================
 * 1. THE PHONEME TABLE  (§3.2)
 * ========================================================================== */

const enum PhoneKind {
  /** Formant-filtered glottal source. Vowels, sonorants. */
  Voiced = 0,
  /** Band-passed noise. Fricatives; `voiceBar` adds a buzz underneath. */
  Fricative = 1,
  /** Silence, then a click. `voiceBarMs` makes it a /b/ instead of a /p/. */
  Plosive = 2,
  /** Glottal source through LP 900 + a notch at 1400. */
  Nasal = 3,
}

interface Phone {
  kind: PhoneKind;
  ms: number;
  /** Level relative to the utterance, in dB. */
  db: number;
  /** Formant targets. `*b` is the glide end; -1 means "no glide". */
  f1: number; f2: number; f3: number;
  f1b: number; f2b: number; f3b: number;
  /** Fricative / plosive band. */
  bpHz: number;
  bpQ: number;
  /** Plosive closure before the burst. */
  silenceMs: number;
  /** Voiced plosive / voiced fricative buzz length. */
  voiceBarMs: number;
}

function vowel(f1: number, f2: number, f3: number, ms: number, f1b = -1, f2b = -1, f3b = -1): Phone {
  return {
    kind: PhoneKind.Voiced, ms, db: 0,
    f1, f2, f3, f1b, f2b, f3b,
    bpHz: 0, bpQ: 1, silenceMs: 0, voiceBarMs: 0,
  };
}

function fric(bpHz: number, bpQ: number, ms: number, db: number, voiceBarMs = 0): Phone {
  return {
    kind: PhoneKind.Fricative, ms, db,
    f1: 0, f2: 0, f3: 0, f1b: -1, f2b: -1, f3b: -1,
    bpHz, bpQ, silenceMs: 0, voiceBarMs,
  };
}

function stop(bpHz: number, bpQ: number, ms: number, db: number, silenceMs: number, voiceBarMs = 0): Phone {
  return {
    kind: PhoneKind.Plosive, ms, db,
    f1: 0, f2: 0, f3: 0, f1b: -1, f2b: -1, f3b: -1,
    bpHz, bpQ, silenceMs, voiceBarMs,
  };
}

function nasal(ms: number): Phone {
  return {
    kind: PhoneKind.Nasal, ms, db: -7,
    f1: 900, f2: 1400, f3: 0, f1b: -1, f2b: -1, f3b: -1,
    bpHz: 0, bpQ: 1, silenceMs: 0, voiceBarMs: 0,
  };
}

/** The complete inventory. Every value below is straight from the §3.2 tables. */
export const PHONES: Readonly<Record<string, Phone>> = {
  /* monophthongs */
  i: vowel(300, 2700, 3300, 95),
  I: vowel(400, 2000, 2550, 70),
  E: vowel(550, 1900, 2500, 80),
  a: vowel(700, 1700, 2400, 105),
  A: vowel(800, 1150, 2800, 110),
  O: vowel(570, 840, 2400, 105),
  U: vowel(450, 1100, 2350, 70),
  u: vowel(320, 900, 2200, 100),
  V: vowel(650, 1200, 2500, 75),
  R: vowel(490, 1350, 1700, 110),
  '@': vowel(500, 1500, 2500, 55),
  /* diphthongs — the glide is the whole identity of these */
  e: vowel(500, 1800, 2550, 140, 330, 2500, 2550),
  o: vowel(550, 1000, 2400, 140, 380, 850, 2400),
  Y: vowel(780, 1150, 2600, 150, 350, 2200, 2600),
  W: vowel(570, 840, 2400, 150, 400, 2000, 2400),
  Q: vowel(780, 1150, 2500, 150, 450, 900, 2500),
  /* sonorants */
  l: vowel(380, 1050, 2700, 65),
  r: vowel(350, 1050, 1600, 65),
  w: vowel(320, 800, 2200, 70, 550, 1400, 2200),
  j: vowel(300, 2500, 2900, 65, 450, 1800, 2900),
  /* nasals */
  n: nasal(65),
  m: nasal(65),
  N: nasal(75),
  /* fricatives */
  s: fric(5800, 1.8, 95, -6),
  z: fric(5200, 1.6, 80, -10, 60),
  S: fric(2500, 1.5, 105, -5),
  Z: fric(2200, 1.5, 90, -9, 60),
  f: fric(6800, 0.9, 80, -13),
  v: fric(6000, 0.9, 70, -15, 50),
  T: fric(7200, 0.9, 75, -15),
  D: fric(5000, 0.9, 60, -16, 45),
  h: fric(1800, 0.8, 60, -16),
  /* plosives */
  t: stop(3600, 2.5, 32, -4, 4),
  d: stop(2600, 2.5, 55, -6, 4, 28),
  k: stop(1900, 2.0, 38, -5, 6),
  g: stop(1600, 2.0, 55, -7, 6, 28),
  p: stop(750, 1.6, 28, -8, 5),
  b: stop(750, 1.6, 55, -9, 5, 30),
};

/** Affricates expand to two phones — they ARE a stop plus a fricative. */
const AFFRICATES: Readonly<Record<string, string>> = { C: 'tS', J: 'dZ' };

/** One scheduled item: a phone, or a silence. */
export interface Token { phone: Phone | null; gapMs: number }

/**
 * Parse a phoneme string into scheduled tokens.
 * Unknown characters are skipped with a warning rather than silently dropped —
 * a typo in a line should be loud at boot, not a missing syllable in combat.
 */
export function parsePhonemes(s: string, wordGapMs: number, commaGapMs: number): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    // A space is only a legibility separator between two phones of one word.
    if (c === ' ') continue;
    if (c === ',') { out.push({ phone: null, gapMs: wordGapMs }); continue; }
    if (c === ';') { out.push({ phone: null, gapMs: commaGapMs }); continue; }
    const expanded = AFFRICATES[c];
    if (expanded !== undefined) {
      for (const e of expanded) out.push({ phone: PHONES[e], gapMs: 0 });
      continue;
    }
    const p = PHONES[c];
    if (p === undefined) {
      console.warn(`[eva] unknown phoneme "${c}" in "${s}"`);
      continue;
    }
    out.push({ phone: p, gapMs: 0 });
  }
  return out;
}

/* ==========================================================================
 * 2. VOICE PROFILES  (§3.2 EVA, §3.3 barks)
 * ========================================================================== */

export interface VoiceProfile {
  /** Baseline F0 in Hz. */
  f0: number;
  /** Multiplies every phone's duration. <1 is faster and more clipped. */
  rate: number;
  highpassHz: number;
  lowpassHz: number;
  /** tanh drive in the radio chain. EVA 7.5, barks 11. */
  drive: number;
  preRollMs: number;
  /** Optional extra resonance: [hz, db, q]. Chest for a conscript, presence for a pilot. */
  peak?: readonly [number, number, number];
  /** Saw engine bleed under a vehicle crew, in dB. 0 = none. */
  engineBleedDb?: number;
  engineBleedHz?: number;
  /** Extra carrier hiss, 0..1, added to the squelch bed. Pilots get more. */
  noiseFloor?: number;
  /** Allow the 9 ms mid-line dropout. Alerts turn this off — clarity wins. */
  allowDropout?: boolean;
}

export const EVA_PROFILE: VoiceProfile = {
  f0: AUDIO_EVA.f0,
  rate: 1.0,
  highpassHz: AUDIO_EVA.highpassHz,
  lowpassHz: AUDIO_EVA.lowpassHz,
  drive: AUDIO_EVA.drive,
  preRollMs: AUDIO_EVA.preRollMs,
  allowDropout: true,
};

/** §3.3 unit-class voices. Keys are the bark class ids used by Barks.ts. */
export const BARK_PROFILES: Readonly<Record<string, VoiceProfile>> = {
  allied_infantry: { f0: 118, rate: 1.00, highpassHz: 420, lowpassHz: 2500, drive: 11, preRollMs: 60 },
  allied_infantry_f: { f0: 196, rate: 1.02, highpassHz: 420, lowpassHz: 2500, drive: 11, preRollMs: 60 },
  soviet_infantry: {
    f0: 104, rate: 0.94, highpassHz: 420, lowpassHz: 2500, drive: 11, preRollMs: 60,
    peak: [300, 2, 1.4],
  },
  engineer: { f0: 132, rate: 1.10, highpassHz: 420, lowpassHz: 3100, drive: 11, preRollMs: 60 },
  allied_vehicle: {
    f0: 126, rate: 1.06, highpassHz: 420, lowpassHz: 2500, drive: 11, preRollMs: 60,
    engineBleedDb: -26, engineBleedHz: 90,
  },
  soviet_vehicle: {
    f0: 96, rate: 0.92, highpassHz: 420, lowpassHz: 2100, drive: 11, preRollMs: 60,
    engineBleedDb: -20, engineBleedHz: 84,
  },
  air: {
    f0: 140, rate: 1.14, highpassHz: 520, lowpassHz: 2400, drive: 11, preRollMs: 60,
    peak: [2000, 8, 1.2], noiseFloor: 0.18,
  },
  naval: {
    f0: 110, rate: 0.98, highpassHz: 420, lowpassHz: 2500, drive: 11, preRollMs: 60,
    peak: [250, 6, 1.2],
  },
};

/* ==========================================================================
 * 3. THE RADIO CHAIN  (§3.2, nine stages, in this exact order)
 *
 * Baked into each line rather than applied live: a line's chain never changes,
 * so paying for nine nodes on every playback is pure waste. Runtime playback of
 * a finished line is BufferSource -> gain -> voice bus.
 * ========================================================================== */

export interface Chain { input: AudioNode; output: AudioNode }

/**
 * A real communications channel is a STEEP band, not a tone control.
 *
 * `AUDIO_EVA.highpassHz` is 380 Hz, but a single biquad highpass is 12 dB/oct,
 * so at the 190 Hz glottal fundamental it attenuates by only 12 dB — and the
 * fundamental is 20 dB hotter than anything else in a voiced phone. Measured
 * result: 57-71% of the announcer's energy sat in 80-400 Hz, i.e. in exactly
 * the band a radio does not pass, and almost none of it in the 1-3 kHz where
 * intelligibility and the "transmission" character both live.
 *
 * Three cascaded poles is 36 dB/oct, which puts the fundamental 40 dB down and
 * leaves the harmonics that carry the words.
 */
const COMMS_HP_STAGES = 3;
/** Two poles at the top: enough to sound band-limited without sounding muffled. */
const COMMS_LP_STAGES = 2;

/**
 * Widen the top of the band to a real 3.4 kHz channel. The configured 2.9 kHz
 * with two poles puts /s/ and /t/ 20 dB down, and a radio operator you cannot
 * tell "structure lost" from "structure sold" is a worse radio operator than
 * one who is slightly less band-limited.
 */
const COMMS_TOP = 1.15;

/**
 * Relative level of F1 / F2 / F3.
 *
 * Textbook formant synthesis weights these 1.0 / 0.55 / 0.22, which is roughly
 * how a mouth radiates — but a mouth is not what is being simulated here, a
 * radio link carrying a mouth is. The channel high-passes away everything under
 * ~300 Hz and its AGC then lifts what survives, which lands F2 and F3 far
 * closer to F1 than they started. With the textbook weights the announcer
 * measured 57-68% of its energy in 80-400 Hz — a voice down a pipe, and one
 * whose consonants were inaudible over gunfire.
 */
const FORMANT_LEVELS = [0.62, 0.9, 0.5] as const;

/**
 * Formant transition time. 45 ms is the measured order of a real articulator
 * move; shorter reads as a splice, longer smears two vowels into one.
 * Not in config.ts because it is not a mix knob — it is part of the synthesiser.
 */
const GLIDE_MS = 45;

/**
 * A little amplitude modulation at 62 Hz, 7% depth. Not enough to hear as a
 * pitch, more than enough to hear as a channel — this is the artefact a
 * companded FM link leaves on a voice, and it is most of what separates
 * "someone on a radio" from "someone in the room".
 */
const VOCODE_HZ = 62;
const VOCODE_DEPTH = 0.07;

export function buildRadioChain(ac: BaseAudioContext, p: VoiceProfile): Chain {
  const input = gain(ac, 1);

  // Cascaded band, slightly staggered so the corner is a knee and not a notch.
  let head: AudioNode = input;
  for (let i = 0; i < COMMS_HP_STAGES; i++) {
    const hp = biquad(ac, 'highpass', p.highpassHz * (1 - i * 0.08), 0.62);
    head.connect(hp);
    head = hp;
  }
  for (let i = 0; i < COMMS_LP_STAGES; i++) {
    const lp = biquad(ac, 'lowpass', p.lowpassHz * COMMS_TOP * (1 + i * 0.1), 0.66);
    head.connect(lp);
    head = lp;
  }

  const presence = biquad(ac, 'peaking', AUDIO_EVA.presenceHz, AUDIO_EVA.presenceQ, AUDIO_EVA.presenceDb + 3);
  const debox = biquad(ac, 'peaking', AUDIO_EVA.deboxHz, AUDIO_EVA.deboxQ, AUDIO_EVA.deboxDb);
  const drive = shaper(ac, p.drive, '2x', 2048);

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = AUDIO_EVA.compThreshold;
  comp.knee.value = AUDIO_EVA.compKnee;
  comp.ratio.value = AUDIO_EVA.compRatio;
  comp.attack.value = AUDIO_EVA.compAttack;
  comp.release.value = AUDIO_EVA.compRelease;

  // The carrier artefact, in front of the drive so the shaper works on it too.
  const vocode = gain(ac, 1 - VOCODE_DEPTH);
  const carrier = ac.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = VOCODE_HZ;
  const depth = gain(ac, VOCODE_DEPTH);
  carrier.connect(depth).connect(vocode.gain);
  carrier.start(0);

  head.connect(presence).connect(debox).connect(vocode).connect(drive).connect(comp);

  // Optional per-class resonance (chest, presence).
  let tail: AudioNode = comp;
  if (p.peak) {
    const pk = biquad(ac, 'peaking', p.peak[0], p.peak[2], p.peak[1]);
    tail.connect(pk);
    tail = pk;
  }

  const output = gain(ac, 1);
  tail.connect(output);

  /* 7 — parallel slap delay. Short, quiet, and the reason it sounds "sent". */
  const dly = ac.createDelay(0.5);
  dly.delayTime.value = AUDIO_EVA.slapMs / 1000;
  const fb = gain(ac, AUDIO_EVA.slapFeedback);
  const slapWet = gain(ac, dbToGain(AUDIO_EVA.slapWetDb));
  tail.connect(dly);
  dly.connect(fb).connect(dly);
  dly.connect(slapWet).connect(output);

  /* 8 — parallel micro-convolver: a 180 ms room with three discrete taps. */
  const conv = ac.createConvolver();
  conv.normalize = false;
  conv.buffer = makeMicroIr(ac);
  const convWet = gain(ac, dbToGain(AUDIO_EVA.microVerbWetDb));
  tail.connect(conv).connect(convWet).connect(output);

  return { input, output };
}

/** `ir[i] = noise * exp(-6i/N)` with taps at 7 / 13 / 23 ms. */
function makeMicroIr(ac: BaseAudioContext): AudioBuffer {
  const n = Math.max(64, Math.floor((AUDIO_EVA.microVerbMs / 1000) * ac.sampleRate));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  const rng = makeRng(0x5eed_1a7e);
  for (let i = 0; i < n; i++) d[i] = (rng() * 2 - 1) * Math.exp((-6 * i) / n);
  const taps: Array<[number, number]> = [[7, 0.6], [13, 0.4], [23, 0.3]];
  for (const [ms, g] of taps) {
    const i = Math.floor((ms / 1000) * ac.sampleRate);
    if (i < n) d[i] += g;
  }
  return buf;
}

/* ==========================================================================
 * 4. UTTERANCE RENDERING
 * ========================================================================== */

/** Total time an utterance occupies, before the chain's tail. */
export function utteranceSeconds(phonemes: string, p: VoiceProfile): number {
  const tokens = parsePhonemes(phonemes, AUDIO_EVA.wordGapMs, AUDIO_EVA.commaGapMs);
  let ms = p.preRollMs + AUDIO_EVA.postRollMs + 120;
  for (const t of tokens) {
    ms += t.phone === null ? t.gapMs : (t.phone.silenceMs + t.phone.ms) * p.rate;
  }
  return ms / 1000;
}

/**
 * Render one line into `oc.destination`, through the radio chain and with the
 * squelch bed. The result is a finished, playable buffer.
 *
 * The glottal source is built ONCE for the whole utterance and gated per phone
 * by the formant bank. That is both cheaper and more correct than restarting an
 * oscillator per phoneme: restarting resets the phase, which produces an
 * audible click at every syllable boundary.
 */
export function renderUtterance(
  oc: OfflineAudioContext, phonemes: string, p: VoiceProfile, rng: Rng01, allowDropout: boolean,
): void {
  const chain = buildRadioChain(oc, p);
  chain.output.connect(oc.destination);

  // Master utterance gain, which the dropout writes into.
  const master = gain(oc, 1);
  master.connect(chain.input);

  const tokens = parsePhonemes(phonemes, AUDIO_EVA.wordGapMs, AUDIO_EVA.commaGapMs);
  const speechStart = p.preRollMs / 1000;

  /* -- total speech length, needed for the terminal F0 fall ---------------- */
  let bodyMs = 0;
  for (const t of tokens) bodyMs += t.phone === null ? t.gapMs : (t.phone.silenceMs + t.phone.ms) * p.rate;
  const speechEnd = speechStart + bodyMs / 1000;
  const totalDur = speechEnd + AUDIO_EVA.postRollMs / 1000 + 0.12;

  /* -- glottal source ------------------------------------------------------ */
  const glottal = gain(oc, 1);
  const saw1 = oc.createOscillator();
  saw1.type = 'sawtooth';
  const saw2 = oc.createOscillator();
  saw2.type = 'sawtooth';
  saw2.detune.value = AUDIO_EVA.detuneCents;
  const saw2g = gain(oc, dbToGain(AUDIO_EVA.detuneDb));
  saw1.connect(glottal);
  saw2.connect(saw2g).connect(glottal);
  saw1.start(0); saw2.start(0);
  saw1.stop(totalDur + 0.05); saw2.stop(totalDur + 0.05);

  // F0 contour: baseline, +-4 Hz per voiced phone, then a linear terminal fall.
  const fallStart = Math.max(speechStart, speechEnd - AUDIO_EVA.terminalFallMs / 1000);
  saw1.frequency.setValueAtTime(p.f0, 0);
  saw2.frequency.setValueAtTime(p.f0, 0);

  const shape = biquad(oc, 'lowpass', 2600, 0.5);
  const glottalDrive = shaper(oc, 3, '2x', 1024);
  const voiced = gain(oc, 1);
  glottal.connect(shape).connect(glottalDrive).connect(voiced);

  /* -- optional engine bleed under a vehicle crew -------------------------- */
  if (p.engineBleedDb && p.engineBleedDb > -60) {
    const bg = gain(oc, dbToGain(p.engineBleedDb));
    const bo = oc.createOscillator();
    bo.type = 'sawtooth';
    bo.frequency.value = p.engineBleedHz ?? 90;
    const blp = biquad(oc, 'lowpass', 700, 1.2);
    bo.connect(blp).connect(bg).connect(master);
    bo.start(0); bo.stop(totalDur + 0.02);
  }

  /* -- squelch pre-roll (§3.2) --------------------------------------------- */
  {
    const burstAt = Math.max(0, speechStart - AUDIO_EVA.preRollMs / 1000);
    const bg = gain(oc, dbToGain(-20));
    const bp = biquad(oc, 'bandpass', 1400, 4);
    bg.gain.setValueAtTime(0.0001, burstAt);
    bg.gain.linearRampToValueAtTime(dbToGain(-20), burstAt + 0.001);
    bg.gain.exponentialRampToValueAtTime(0.0001, burstAt + 0.021);
    noiseInto(oc, burstAt, 0.024, rng).connect(bp);
    bp.connect(bg).connect(master);

    // Carrier hiss: 110 ms of it, and it keeps running under the whole line.
    const hg = gain(oc, dbToGain(-34) * (1 + (p.noiseFloor ?? 0)));
    const hbp = biquad(oc, 'bandpass', 1600, 0.7);
    noiseInto(oc, burstAt, totalDur - burstAt, rng).connect(hbp);
    hbp.connect(hg).connect(master);
  }

  /* -- squelch post-roll ---------------------------------------------------- */
  {
    const t = speechEnd + AUDIO_EVA.postRollMs / 1000;
    const bg = gain(oc, dbToGain(-22));
    const bp = biquad(oc, 'bandpass', 1100, 3);
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(dbToGain(-22), t + 0.001);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.034);
    // 45 ms exponential hiss tail after the key-up.
    bg.gain.setValueAtTime(dbToGain(-30), t + 0.034);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.079);
    noiseInto(oc, t, 0.085, rng).connect(bp);
    bp.connect(bg).connect(master);
  }

  /* -- the phones ---------------------------------------------------------- */
  // The articulator positions the PREVIOUS phone left behind. Vowels glide out
  // of these; see `formant` for why that matters more than the targets do.
  let prev1 = -1, prev2 = -1, prev3 = -1;
  const setLocus = (f1: number, f2: number, f3: number): void => {
    prev1 = f1; prev2 = f2; prev3 = f3;
  };

  let cursor = speechStart;
  for (const tok of tokens) {
    if (tok.phone === null) {
      cursor += tok.gapMs / 1000;
      // A word gap resets the mouth to rest. A phrase pause resets it fully.
      if (tok.gapMs >= AUDIO_EVA.commaGapMs) setLocus(-1, -1, -1);
      continue;
    }
    const ph = tok.phone;
    const dur = (ph.ms * p.rate) / 1000;
    const at = cursor + (ph.silenceMs * p.rate) / 1000;

    switch (ph.kind) {
      case PhoneKind.Voiced: {
        // Per-syllable F0 jitter, deterministic per line.
        const f = p.f0 + rand(rng, -AUDIO_EVA.syllableJitterHz, AUDIO_EVA.syllableJitterHz);
        setF0(saw1, saw2, f, at, dur, p, fallStart, speechEnd);
        const seg = gain(oc, 1);
        phoneEnv(seg.gain, at, dur, dbToGain(ph.db), p);
        // Three parallel bandpasses at 1.0 / 0.55 / 0.22, bandwidth 70/110/160.
        const glide = Math.min(GLIDE_MS, ph.ms * p.rate * 0.45);
        formant(oc, voiced, seg, prev1, ph.f1, ph.f1b, 70, FORMANT_LEVELS[0], at, dur, glide);
        formant(oc, voiced, seg, prev2, ph.f2, ph.f2b, 110, FORMANT_LEVELS[1], at, dur, glide);
        formant(oc, voiced, seg, prev3, ph.f3, ph.f3b, 160, FORMANT_LEVELS[2], at, dur, glide);
        seg.connect(master);
        // A diphthong leaves the mouth wherever its glide ended.
        setLocus(ph.f1b > 0 ? ph.f1b : ph.f1, ph.f2b > 0 ? ph.f2b : ph.f2,
          ph.f3b > 0 ? ph.f3b : ph.f3);
        break;
      }
      case PhoneKind.Nasal: {
        const f = p.f0;
        setF0(saw1, saw2, f, at, dur, p, fallStart, speechEnd);
        const seg = gain(oc, 1);
        phoneEnv(seg.gain, at, dur, dbToGain(ph.db), p);
        const lp = biquad(oc, 'lowpass', ph.f1, 1.0);
        const notch = biquad(oc, 'notch', ph.f2, 3.0);
        voiced.connect(lp).connect(notch).connect(seg).connect(master);
        // A nasal murmur leaves the tongue low and central.
        setLocus(400, 1300, 2500);
        break;
      }
      case PhoneKind.Fricative: {
        const seg = gain(oc, 1);
        phoneEnv(seg.gain, at, dur, dbToGain(ph.db), p);
        const bp = biquad(oc, 'bandpass', ph.bpHz, ph.bpQ);
        noiseInto(oc, at, dur + 0.03, rng).connect(bp);
        bp.connect(seg).connect(master);
        setLocus(-1, Math.max(600, Math.min(2600, ph.bpHz * 0.42)), -1);
        if (ph.voiceBarMs > 0) {
          const vg = gain(oc, 1);
          phoneEnv(vg.gain, at, (ph.voiceBarMs * p.rate) / 1000, dbToGain(ph.db - 6), p);
          const vlp = biquad(oc, 'lowpass', 500, 1.0);
          voiced.connect(vlp).connect(vg).connect(master);
        }
        break;
      }
      case PhoneKind.Plosive: {
        // The closure is real silence; that gap is what makes a /t/ a /t/.
        const seg = gain(oc, 1);
        phoneEnv(seg.gain, at, dur, dbToGain(ph.db), p);
        const bp = biquad(oc, 'bandpass', ph.bpHz, ph.bpQ);
        noiseInto(oc, at, dur + 0.02, rng).connect(bp);
        bp.connect(seg).connect(master);
        // Locus theory: the burst band IS the place of articulation, so the
        // following vowel's F2 sweeps out of it. /t/ from ~1500, /p/ from ~310.
        setLocus(-1, Math.max(300, Math.min(2400, ph.bpHz * 0.42)), -1);
        if (ph.voiceBarMs > 0) {
          const vg = gain(oc, 1);
          const vAt = at + 0.004;
          phoneEnv(vg.gain, vAt, (ph.voiceBarMs * p.rate) / 1000, dbToGain(ph.db - 4), p);
          const vlp = biquad(oc, 'lowpass', 420, 1.0);
          voiced.connect(vlp).connect(vg).connect(master);
        }
        break;
      }
      default:
        break;
    }
    cursor = at + dur;
  }

  /* -- dropout: 18% of lines lose 9 ms in the middle third ------------------ */
  if (allowDropout && rng() < AUDIO_EVA.dropoutChance) {
    const lo = speechStart + (speechEnd - speechStart) / 3;
    const hi = speechStart + (2 * (speechEnd - speechStart)) / 3;
    const t = rand(rng, lo, Math.max(lo + 0.01, hi));
    master.gain.setValueAtTime(1, t);
    master.gain.linearRampToValueAtTime(0, t + 0.002);
    master.gain.setValueAtTime(0, t + 0.011);
    master.gain.linearRampToValueAtTime(1, t + 0.013);
  }
}

/** Schedule the F0 for one voiced phone, including the terminal fall. */
function setF0(
  a: OscillatorNode, b: OscillatorNode, f: number, at: number, dur: number,
  p: VoiceProfile, fallStart: number, speechEnd: number,
): void {
  const end = at + dur;
  // Inside the terminal window the contour is a straight fall to f0 - 22 Hz.
  const targetAt = (t: number): number => {
    if (t <= fallStart) return f;
    const k = Math.min(1, (t - fallStart) / Math.max(1e-4, speechEnd - fallStart));
    return f - AUDIO_EVA.terminalFallHz * k;
  };
  a.frequency.setValueAtTime(targetAt(at), at);
  a.frequency.linearRampToValueAtTime(targetAt(end), end);
  b.frequency.setValueAtTime(targetAt(at), at);
  b.frequency.linearRampToValueAtTime(targetAt(end), end);
}

/**
 * One formant: a bandpass that GLIDES IN from the previous phone's target,
 * holds at `hz`, and optionally glides on to `hzB` for a diphthong.
 *
 * The glide-in is coarticulation, and it is the difference between a formant
 * synthesiser that can be understood and one that cannot. Human articulators
 * have mass: the tongue does not teleport from the /i/ position to the /A/
 * position, it sweeps, and the ear reads that sweep as the transition between
 * two specific sounds. Stepping the filters instantly — which is what this did
 * — produces a sequence of correct but disconnected vowels, which is why
 * hand-tuned formant speech so often comes out as recognisable-but-mush.
 *
 * For a vowel after a consonant, `hzFrom` is the consonant's LOCUS (its
 * characteristic band, which is exactly what the phone table's `bpHz` already
 * holds), so /t/-to-/a/ sweeps down from 1800 Hz and /b/-to-/a/ sweeps up from
 * 750 Hz. Those two transitions are most of how a listener tells a /t/ from a
 * /b/ at all — the burst itself is nearly the same noise.
 */
function formant(
  oc: BaseAudioContext, src: AudioNode, dst: AudioNode,
  hzFrom: number, hz: number, hzB: number,
  bandwidthHz: number, level: number, at: number, dur: number, glideMs: number,
): void {
  if (hz <= 0) return;
  const q = Math.max(0.4, hz / bandwidthHz);
  const glide = Math.min(glideMs / 1000, dur * 0.5);
  const moving = hzFrom > 0 && Math.abs(hzFrom - hz) > 25;
  const f = biquad(oc, 'bandpass', moving ? hzFrom : hz, q);
  if (moving) {
    f.frequency.setValueAtTime(hzFrom, at);
    f.frequency.linearRampToValueAtTime(hz, at + glide);
  } else {
    f.frequency.setValueAtTime(hz, at);
  }
  if (hzB > 0) f.frequency.linearRampToValueAtTime(hzB, at + dur);
  const g = gain(oc, level);
  src.connect(f).connect(g).connect(dst);
}

/** 8 ms attack, sustain, 12 ms release — §3.2, and the gaps are the diction. */
function phoneEnv(param: AudioParam, at: number, dur: number, peak: number, p: VoiceProfile): void {
  const a = (AUDIO_EVA.attackMs * p.rate) / 1000;
  const r = (AUDIO_EVA.releaseMs * p.rate) / 1000;
  const hold = Math.max(0.002, dur - a - r);
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(peak, at + a);
  param.setValueAtTime(peak, at + a + hold);
  param.linearRampToValueAtTime(0, at + a + hold + r);
}

/**
 * A looping white-noise source local to this offline context. Each call gets a
 * fresh 250 ms bed at a fresh seed, so two /s/ in one word are not identical.
 */
function noiseInto(
  oc: OfflineAudioContext, at: number, dur: number, rng: Rng01,
): AudioBufferSourceNode {
  const n = Math.max(256, Math.floor(0.25 * oc.sampleRate));
  const buf = oc.createBuffer(1, n, oc.sampleRate);
  const d = buf.getChannelData(0);
  const seed = Math.floor(rng() * 0xffffffff);
  const r = makeRng(seed);
  for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  const s = oc.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(at, 0, dur);
  s.stop(at + dur + 0.005);
  return s;
}

/* ==========================================================================
 * 5. THE LINE INVENTORY  (§3.2)
 * ========================================================================== */

export interface EvaLineDef {
  /** Subtitle text — every line emits one (§3.7 accessibility). */
  readonly text: string;
  /** Hand-authored phonemes. See the header for the alphabet. */
  readonly phones: string;
  /** 0 highest. P0 preempts P2+ and is never suppressed. */
  readonly priority: number;
  /** Wall-clock seconds between two firings of THIS id, checked at enqueue. */
  readonly cooldown: number;
  /** True for lines that may fire exactly once per match. */
  readonly once?: boolean;
  /** Alerts turn the squelch dropout off — clarity beats character. */
  readonly noDropout?: boolean;
}

export const EVA_LINES: Readonly<Record<string, EvaLineDef>> = {
  battleControlOnline: {
    text: 'Battle control online.',
    phones: 'b a t @ l , k @ n t r o l , A n l Y n',
    priority: 2, cooldown: 0, once: true,
  },
  constructionComplete: {
    text: 'Construction complete.',
    phones: 'k @ n s t r V k S @ n , k @ m p l i t',
    priority: 2, cooldown: 2.5,
  },
  unitReady: {
    text: 'Unit ready.',
    phones: 'j u n I t , r E d i',
    priority: 3, cooldown: 4.0,
  },
  trainingComplete: {
    text: 'Training complete.',
    phones: 't r e n I N , k @ m p l i t',
    priority: 3, cooldown: 4.0,
  },
  newConstructionOptions: {
    text: 'New construction options.',
    phones: 'n u , k @ n s t r V k S @ n , A p S @ n z',
    priority: 2, cooldown: 6.0,
  },
  insufficientFunds: {
    text: 'Insufficient funds.',
    phones: 'I n s @ f I S @ n t , f V n d z',
    priority: 3, cooldown: 6.0,
  },
  cannotBuildHere: {
    text: 'Cannot build here.',
    phones: 'k a n A t , b I l d , h i r',
    priority: 3, cooldown: 2.0,
  },
  cannotDeployHere: {
    text: 'Cannot deploy here.',
    phones: 'k a n A t , d I p l W , h i r',
    priority: 3, cooldown: 2.0,
  },
  baseUnderAttack: {
    text: 'Our base is under attack.',
    phones: 'Q r , b e s , I z , V n d R , @ t a k',
    priority: 0, cooldown: 40, noDropout: true,
  },
  forcesUnderAttack: {
    text: 'Our forces are under attack.',
    phones: 'Q r , f O r s @ z , A r , V n d R , @ t a k',
    priority: 1, cooldown: 30, noDropout: true,
  },
  allyUnderAttack: {
    text: "Warning: our ally's base is under attack.",
    phones: 'w O r n I N ; Q r , a l Y z , b e s , I z , V n d R , @ t a k',
    priority: 1, cooldown: 60, noDropout: true,
  },
  lowPower: {
    text: 'Low power.',
    phones: 'l o , p Q R',
    priority: 1, cooldown: 45,
  },
  silosNeeded: {
    text: 'Silos needed.',
    phones: 's Y l o z , n i d @ d',
    priority: 2, cooldown: 60,
  },
  structureLost: {
    text: 'Structure lost.',
    phones: 's t r V k C R , l O s t',
    priority: 1, cooldown: 5,
  },
  unitLost: {
    text: 'Unit lost.',
    phones: 'j u n I t , l O s t',
    priority: 3, cooldown: 8,
  },
  radarOnline: {
    text: 'Radar online.',
    phones: 'r e d A r , A n l Y n',
    priority: 2, cooldown: 10,
  },
  radarOffline: {
    text: 'Radar offline.',
    phones: 'r e d A r , O f l Y n',
    priority: 2, cooldown: 10,
  },
  missionAccomplished: {
    text: 'Mission accomplished.',
    phones: 'm I S @ n , @ k A m p l I S t',
    priority: 0, cooldown: 0, once: true, noDropout: true,
  },
  missionFailed: {
    text: 'Mission failed.',
    phones: 'm I S @ n , f e l d',
    priority: 0, cooldown: 0, once: true, noDropout: true,
  },
  battleControlTerminated: {
    text: 'Battle control terminated.',
    phones: 'b a t @ l , k @ n t r o l , t R m @ n e t @ d',
    priority: 2, cooldown: 0, once: true,
  },
  buildingCaptured: {
    text: 'Building captured.',
    phones: 'b I l d I N , k a p C R d',
    priority: 1, cooldown: 5,
  },
  oreMinerUnderAttack: {
    text: 'Ore miner under attack.',
    phones: 'O r , m Y n R , V n d R , @ t a k',
    priority: 2, cooldown: 30,
  },
  /**
   * THE ONLY LINE IN THE TABLE THAT TELLS THE PLAYER WHAT BUTTON TO PRESS.
   *
   * Every other line reports. This one instructs, because the state it
   * announces — no ore miner and no money for one — is the one state where
   * reporting is useless: the player can already SEE that the bank is empty,
   * and what they cannot see is that the sidebar's sell tool is the way out.
   * See `src/sim/OreCrisis.ts`. The vocabulary is `oreMinerUnderAttack`'s, not
   * the catalog's "Ore Harvester", because the announcer already calls it a
   * miner and one voice should use one word.
   *
   * P1 and `noDropout`, matching `lowPower`: an economy that has stopped is at
   * least as urgent as a brownout, and an instruction is the last thing that
   * should be squelched.
   */
  noOreMiner: {
    text: 'No ore miner. Sell a structure to rebuild.',
    phones: 'n o , O r , m Y n R ; s E l , @ , s t r V k C R , t u , r i b I l d',
    priority: 1, cooldown: 45, noDropout: true,
  },
  harvesterIdle: {
    // Cooldown matched to `oreMinerUnderAttack` because it is the same subject
    // and the same urgency: a harvester needs the player, now-ish, and 30 s is
    // long enough that a field draining in stages cannot chatter. It is the
    // third layer of coalescing under `Harvesting.announceDry`'s per-field
    // record and the toast stack's six-second merge.
    text: 'Harvester idle.',
    phones: 'h A r v @ s t R , Y d @ l',
    priority: 2, cooldown: 30,
  },
  building: {
    text: 'Building.',
    phones: 'b I l d I N',
    priority: 4, cooldown: 1.5,
  },
  repairing: {
    text: 'Repairing.',
    phones: 'r I p E r I N',
    priority: 4, cooldown: 3,
  },
  primaryBuildingSelected: {
    text: 'Primary building selected.',
    phones: 'p r Y m E r i , b I l d I N , s @ l E k t @ d',
    priority: 4, cooldown: 2,
  },
  newRallyPoint: {
    text: 'New rally point established.',
    phones: 'n u , r a l i , p W n t , I s t a b l I S t',
    priority: 4, cooldown: 2,
  },
  structureSold: {
    text: 'Structure sold.',
    phones: 's t r V k C R , s o l d',
    priority: 3, cooldown: 2,
  },
  reinforcements: {
    text: 'Reinforcements have arrived.',
    phones: 'r i I n f O r s m @ n t s , h a v , @ r Y v d',
    priority: 1, cooldown: 10,
  },
  superweaponReady: {
    text: 'Superweapon ready.',
    phones: 's u p R w E p @ n , r E d i',
    priority: 0, cooldown: 0, noDropout: true,
  },
  nuclearMissileLaunched: {
    text: 'Nuclear missile launched.',
    phones: 'n u k l i R , m I s @ l , l O n C t',
    priority: 0, cooldown: 0, noDropout: true,
  },
  incomingMissile: {
    text: 'Warning: incoming missile.',
    phones: 'w O r n I N ; I n k V m I N , m I s @ l',
    priority: 0, cooldown: 0, noDropout: true,
  },
};

/** `EvaLine` (core/types.ts) -> a line id in EVA_LINES. */
export const EVA_LINE_ID: Readonly<Record<number, string>> = {
  [EvaLine.ConstructionComplete]: 'constructionComplete',
  [EvaLine.UnitReady]: 'unitReady',
  [EvaLine.NewConstructionOptions]: 'newConstructionOptions',
  [EvaLine.InsufficientFunds]: 'insufficientFunds',
  [EvaLine.LowPower]: 'lowPower',
  [EvaLine.BaseUnderAttack]: 'baseUnderAttack',
  [EvaLine.UnitLost]: 'unitLost',
  [EvaLine.BuildingLost]: 'structureLost',
  [EvaLine.SiloNeeded]: 'silosNeeded',
  [EvaLine.RadarOnline]: 'radarOnline',
  [EvaLine.RadarOffline]: 'radarOffline',
  [EvaLine.CannotDeployHere]: 'cannotDeployHere',
  [EvaLine.MissionAccomplished]: 'missionAccomplished',
  [EvaLine.MissionFailed]: 'missionFailed',
  [EvaLine.BuildingCaptured]: 'buildingCaptured',
  [EvaLine.OreMinerUnderAttack]: 'oreMinerUnderAttack',
  [EvaLine.NoOreMiner]: 'noOreMiner',
  // `reinforcements` was in this table's LINE inventory from the start and had
  // no `EvaLine` to dispatch it — a recorded, mastered take that no sim code
  // could reach. The ore-crisis rescue is the first caller.
  [EvaLine.Reinforcements]: 'reinforcements',
  [EvaLine.HarvesterIdle]: 'harvesterIdle',
};

/* ==========================================================================
 * 6. THE ANNOUNCER
 * ========================================================================== */

/**
 * Peak level of a normalised EVA line at the voice bus input. The voice bus is
 * already +2 dB, and the announcer must never be the thing that trips the
 * master limiter — it has to stay intelligible while everything else ducks.
 */
export const EVA_PEAK_DB = -6;

export type EvaMode = 'synth' | 'system' | 'off';

export interface EvaOptions {
  mode?: EvaMode;
  /** Every line emits its text for the subtitle layer. */
  onSubtitle?: (text: string, dwellSec: number) => void;
}

interface QueueItem { id: string; priority: number; at: number }

export class EvaAnnouncer {
  /**
   * The rendered announcer. Falls back to the formant synth below when a line
   * fails to load, which is why `renderUtterance` and the whole phoneme table
   * are still here rather than deleted — an offline player gets a robot voice,
   * not silence, and silence on "Our base is under attack" loses the match.
   */
  private readonly recorded = new SampleBank(EVA_MANIFEST, evaPath);
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly baking = new Set<string>();
  private readonly lastFired = new Map<string, number>();
  private readonly fireCount = new Map<string, number>();
  private readonly queue: QueueItem[] = [];

  private speaking = false;
  private lastEnd = -Infinity;
  private current: { source: AudioBufferSourceNode; id: string } | null = null;
  private ducks: Array<{ release(): void }> = [];
  /** Tier A only: the carrier-hiss loop that runs under a system utterance. */
  private bed: LoopVoice | null = null;

  mode: EvaMode;
  private readonly onSubtitle: ((text: string, dwellSec: number) => void) | null;

  constructor(private readonly engine: AudioEngine, options: EvaOptions = {}) {
    this.mode = options.mode ?? 'synth';
    this.onSubtitle = options.onSubtitle ?? null;
  }

  /** Wall-clock seconds. Cooldowns are wall-clock, not sim time, by design:
   *  a paused game must not accumulate a backlog of "unit lost". */
  private clock(): number {
    return this.engine.now();
  }

  /**
   * Bake every line. ~30 lines at ~1.4 s each renders far faster than realtime;
   * this is awaited at boot so the first "Battle control online" is instant.
   */
  async bakeAll(): Promise<void> {
    if (this.mode === 'off') return;
    for (const id of Object.keys(EVA_LINES)) await this.ensure(id);
  }

  private async ensure(id: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id);
    if (have !== undefined) return have;
    const def = EVA_LINES[id];
    if (def === undefined) return null;

    // RENDERED LINE FIRST. `load` is idempotent and returns immediately after
    // the first call. The result is cached in the same map the synth uses, so
    // the radio-comms chain downstream neither knows nor cares which it got.
    await this.recorded.load(this.engine.ctx);
    const spoken = this.recorded.get(id, 0);
    if (spoken !== null) {
      this.buffers.set(id, spoken);
      return spoken;
    }

    if (this.baking.has(id)) return null;
    this.baking.add(id);
    const OC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null;
    if (OC === null) { this.baking.delete(id); return null; }
    const rate = this.engine.ctx.sampleRate;
    // + the radio chain's slap and micro-verb tail.
    const seconds = utteranceSeconds(def.phones, EVA_PROFILE) + 0.45;
    try {
      const oc = new OC(1, Math.ceil(seconds * rate), rate);
      renderUtterance(oc, def.phones, EVA_PROFILE, makeRng(hash(id)), def.noDropout !== true);
      const buf = await oc.startRendering();
      // One announcer level, whatever the line happens to say.
      normalizeBuffer(buf);
      this.buffers.set(id, buf);
      return buf;
    } catch (err) {
      console.warn(`[eva] failed to bake "${id}"`, err);
      return null;
    } finally {
      this.baking.delete(id);
    }
  }

  /**
   * Enqueue a line. Cooldowns and dampening are checked HERE, at enqueue, so a
   * suppressed line never occupies a queue slot.
   */
  say(id: string): boolean {
    if (this.mode === 'off') return false;
    const def = EVA_LINES[id];
    if (def === undefined) {
      console.warn(`[eva] unknown line "${id}"`);
      return false;
    }
    const t = this.clock();
    const fired = this.fireCount.get(id) ?? 0;
    if (def.once === true && fired > 0) return false;

    const last = this.lastFired.get(id);
    if (last !== undefined && def.cooldown > 0) {
      let cd = def.cooldown;
      // Session dampening: P3/P4 only. A 40-minute match must not end up
      // narrating every rifleman's death at the same rate it did at minute two.
      if (def.priority >= 3) {
        const [a, b] = AUDIO_EVA.dampenAfter;
        const [ma, mb] = AUDIO_EVA.dampenMul;
        if (fired >= b) cd *= Math.min(AUDIO_EVA.dampenCap, mb);
        else if (fired >= a) cd *= ma;
      }
      if (t - last < cd) return false;
    }

    // Duplicates in the queue are dropped rather than stacked.
    for (const q of this.queue) if (q.id === id) return false;

    /* -- P0 preemption ---------------------------------------------------- */
    if (def.priority === 0) {
      // Clear everything at P>=2 and cut the current line short (unless it is
      // itself P0 — a nuke warning never interrupts a nuke warning).
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].priority >= 2) this.queue.splice(i, 1);
      }
      const cur = this.current;
      if (cur !== null && (EVA_LINES[cur.id]?.priority ?? 4) > 0) this.cut(60);
    }

    if (this.queue.length >= AUDIO_EVA.queueDepth) {
      // Drop the lowest priority; ties go to the oldest.
      let worst = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const w = this.queue[worst], c = this.queue[i];
        if (c.priority > w.priority || (c.priority === w.priority && c.at < w.at)) worst = i;
      }
      if (this.queue[worst].priority <= def.priority) return false;
      this.queue.splice(worst, 1);
    }

    this.queue.push({ id, priority: def.priority, at: t });
    this.lastFired.set(id, t);
    this.fireCount.set(id, fired + 1);
    void this.ensure(id);
    return true;
  }

  /** Pump the queue. Call once per rendered frame. */
  update(): void {
    if (this.speaking || this.queue.length === 0 || this.mode === 'off') return;
    const t = this.clock();
    // Global floor: 350 ms of silence between lines, whatever the priority.
    if (t - this.lastEnd < AUDIO_EVA.floorMs / 1000) return;

    // Highest priority (lowest number) first; ties by age.
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const b = this.queue[best], c = this.queue[i];
      if (c.priority < b.priority || (c.priority === b.priority && c.at < b.at)) best = i;
    }
    const item = this.queue.splice(best, 1)[0];
    void this.start(item.id);
  }

  private async start(id: string): Promise<void> {
    const def = EVA_LINES[id];
    if (def === undefined) return;
    this.speaking = true;
    this.onSubtitle?.(def.text, 3.5);

    if (this.mode === 'system') { this.speakSystem(def); return; }

    const buf = await this.ensure(id);
    if (buf === null) { this.finish(); return; }
    const played = this.engine.playBuffer(buf, 'voice', 'voice', EVA_PEAK_DB);
    if (played === null) { this.finish(); return; }
    this.current = { source: played.source, id };
    this.applyDucks();
    played.source.onended = () => {
      if (this.current?.source === played.source) this.current = null;
      this.finish();
    };
  }

  /**
   * Tier A. The utterance is outside the graph, so the radio character comes
   * from a synchronized squelch bed and the duck is driven by the events.
   */
  private speakSystem(def: EvaLineDef): void {
    if (typeof speechSynthesis === 'undefined') { this.finish(); return; }
    const u = new SpeechSynthesisUtterance(def.text);
    const voices = speechSynthesis.getVoices();
    const preferred = /zira|samantha|google us english|karen|moira|female/i;
    u.voice = voices.find((v) => preferred.test(v.name))
      ?? voices.find((v) => v.lang === 'en-US')
      ?? voices[0] ?? null;
    u.rate = 1.08;
    u.pitch = 1.14;
    u.volume = 0.92;
    u.onstart = () => { this.applyDucks(); this.openBed(); };
    u.onend = () => { this.closeBed(); this.finish(); };
    u.onerror = () => { this.closeBed(); this.finish(); };
    speechSynthesis.speak(u);
  }

  /**
   * Tier A radio bed. The utterance is outside the graph, so the transmission
   * character has to be built AROUND it: a key-up squelch, carrier hiss for the
   * duration, and a key-down burst. Without this, the system voice reads as a
   * screen reader talking over a game rather than as a comms channel.
   */
  private openBed(): void {
    if (this.bed !== null) return;
    const e = this.engine;
    const loop = e.openLoop('voice', 0, false);
    if (loop === null) return;
    const ctx = e.ctx;
    const bp = biquad(ctx, 'bandpass', 1600, 0.7);
    const src = ctx.createBufferSource();
    src.buffer = e.white;
    src.loop = true;
    src.connect(bp).connect(loop.input);
    src.start();
    e.attachLoopSource(loop, src);
    this.bed = loop;
    loop.setGain(dbToGain(-34), 40);
    this.burst(1400, 4, -20, 0.022);
  }

  private closeBed(): void {
    this.burst(1100, 3, -22, 0.034);
    this.bed?.stop(90);
    this.bed = null;
  }

  /** One mic-key click, live. Three nodes, ~30 ms, gone. */
  private burst(hz: number, q: number, db: number, dur: number): void {
    const e = this.engine;
    const ctx = e.ctx;
    const t = e.now();
    const src = ctx.createBufferSource();
    src.buffer = e.white;
    const bp = biquad(ctx, 'bandpass', hz, q);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(dbToGain(db), t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(e.busInput('voice'));
    src.start(t, 0, dur + 0.01);
    src.stop(t + dur + 0.02);
    src.onended = () => { try { g.disconnect(); bp.disconnect(); } catch { /* gone */ } };
  }

  /**
   * EVA ducks music -11 dB, SFX -5 dB and ambience -6 dB for the length of the
   * line. It never ducks itself, and it never writes a duck param directly —
   * the engine reduces every active duck into one ramp per bus.
   */
  private applyDucks(): void {
    this.releaseDucks();
    const e = this.engine;
    const D = AUDIO_DUCK;
    this.ducks = [
      e.duck('eva', 'music', D.evaMusicDb, D.evaAttackMs, D.evaReleaseMs),
      e.duck('eva', 'sfx', D.evaSfxDb, D.evaAttackMs, 350),
      e.duck('eva', 'ambience', D.evaAmbDb, 80, 500),
    ];
  }

  private releaseDucks(): void {
    for (const d of this.ducks) d.release();
    this.ducks.length = 0;
  }

  /** Ramp the current line out over `ms` — the P0 preemption path. */
  private cut(ms: number): void {
    const cur = this.current;
    if (cur === null) return;
    try { cur.source.stop(this.engine.now() + ms / 1000); } catch { /* already done */ }
    this.current = null;
    this.finish();
  }

  private finish(): void {
    this.speaking = false;
    this.lastEnd = this.clock();
    this.releaseDucks();
  }

  /** True while a line is on air, so the HUD can hold a subtitle. */
  get busy(): boolean { return this.speaking; }

  /** Between matches: forget cooldowns and once-per-match flags, keep bakes. */
  resetMatch(): void {
    this.lastFired.clear();
    this.fireCount.clear();
    this.queue.length = 0;
  }

  dispose(): void {
    this.queue.length = 0;
    this.releaseDucks();
    this.bed?.stop(20);
    this.bed = null;
    if (this.mode === 'system' && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.buffers.clear();
  }
}

/** Stable per-line bake seed, so the same line dropouts the same way forever. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
