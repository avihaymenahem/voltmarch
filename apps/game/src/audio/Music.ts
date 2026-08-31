/**
 * ============================================================================
 * VOLTMARCH — src/audio/Music.ts
 * ============================================================================
 * PROCEDURAL INDUSTRIAL MILITARY ROCK. Generated at runtime, note by note.
 *
 * ORIGINAL COMPOSITION. Nothing here transcribes or reproduces any copyrighted
 * riff, melody or sample. What is reproduced is the GENRE: 122 BPM, E natural
 * minor with a Phrygian flat-2 in the tension bars, a driving 16th-note bass
 * ostinato, four-on-the-floor kick with a snare backbeat, brass stabs, and an
 * anvil. That combination is a style, and style is not ownable.
 *
 * THE SCHEDULER (VISUAL_DNA §3.6)
 * -------------------------------
 * `setInterval(25 ms)` that schedules everything falling in
 * `[now, now + 0.12 s]` against `ctx.currentTime`. Scheduling notes from
 * `setTimeout` alone drifts 10-40 ms, which is inaudible on whole notes and
 * completely destroys 16ths — the ostinato is the engine of the track, and a
 * wobbling ostinato reads as a broken game, not as a groove.
 *
 * DYNAMIC INTENSITY
 * -----------------
 * Five layers, L0 idle through L4 full. The smoothed combat heat rises in ~2 s
 * and falls in ~6 s, and layer changes only ever land on a BAR BOUNDARY.
 * Crossfading mid-bar sounds like a bug, every time.
 * ============================================================================
 */

import {
  cancelAudioParamScheduledValues,
  exponentialRampAudioParamToValueAtTime,
  finiteAudioNumber,
  linearRampAudioParamToValueAtTime,
  setAudioParamTargetAtTime,
  setAudioParamValue,
  setAudioParamValueAtTime,
} from './AudioParamGuard';
import { AUDIO_BUS_DB, AUDIO_MUSIC } from '../core/config';
import {
  biquad, dbToGain, gain, makeRng, makeWhiteNoise, shaper, type Rng01,
} from './AudioEngine';

/**
 * Everything the sequencer needs from the outside world.
 *
 * `AudioEngine` satisfies this structurally, and so does the tiny offline shim
 * at the bottom of this file — which is the whole point: a track nobody can
 * render headlessly is a track nobody can measure, and this module was written
 * blind for exactly that reason.
 */
export interface MusicHost {
  readonly ctx: BaseAudioContext;
  /** The shared white-noise bed. Drums draw every grain from it. */
  readonly white: AudioBuffer;
  /** True under `?shot=`: build the graph, never start the clock. */
  readonly muted: boolean;
  /** False while the context is suspended — scheduling then would stack notes. */
  readonly running: boolean;
  /** Context time. Never `Date.now()` — a suspended context freezes this. */
  now(): number;
  /** Where the finished bed lands. */
  musicOut(): AudioNode;
}

/* ==========================================================================
 * 1. THE SCORE
 * ========================================================================== */

/** Semitone offsets from E. Only the degrees the score actually uses. */
const E = 0, F = 1, FS = 2, G = 3, AB = 4, A = 5, B = 7, C = 8, D = 10;

/**
 * Root per bar for each 8-bar section (§3.6).
 *   A: E E E E E E G F#   (the F# collapses to a Phrygian F on the last beat)
 *   B: E E G G A A B B
 *   C: E E E G A Ab G E
 *   D: E E C C B B E E
 */
const SECTION_ROOTS: readonly (readonly number[])[] = [
  [E, E, E, E, E, E, G, FS],
  [E, E, G, G, A, A, B, B],
  [E, E, E, G, A, AB, G, E],
  [E, E, C, C, B, B, E, E],
];

/** Accent multipliers across the 16 steps of a bar. The gaps are the chug. */
const BASS_ACCENT: readonly number[] = [
  1.00, 0.62, 0.72, 0.62, 0.94, 0.62, 0.72, 0.66,
  1.00, 0.62, 0.72, 0.62, 0.90, 0.68, 0.80, 0.74,
];

const KICK_BASE: readonly number[] = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
const KICK_DOUBLE: readonly number[] = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];

/** Brass chord shapes as semitone offsets from the chord root. Minor triad. */
const MINOR_TRIAD: readonly number[] = [0, 3, 7];
const MAJOR_TRIAD: readonly number[] = [0, 4, 7];

/** Semitones -> Hz against a root. */
function hz(rootHz: number, semitones: number, octaves = 0): number {
  return rootHz * Math.pow(2, semitones / 12 + octaves);
}

/* ==========================================================================
 * 2. NODE POOLING  (§3.6 node hygiene)
 *
 * Oscillators can only be started once, so they are allocated per note and
 * stopped 50 ms after release. The gain+filter pair around them is NOT — those
 * are pooled per stem, because churning two nodes 8 times a second for a whole
 * match is exactly the allocation pattern that produces an audible GC click.
 * ========================================================================== */

interface Chain { amp: GainNode; filter: BiquadFilterNode; freeAt: number }

class ChainPool {
  private readonly items: Chain[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    size: number,
    filterType: BiquadFilterType,
    filterHz: number,
    filterQ: number,
  ) {
    for (let i = 0; i < size; i++) {
      const filter = biquad(ctx, filterType, filterHz, filterQ);
      const amp = gain(ctx, 0);
      filter.connect(amp).connect(dest);
      this.items.push({ amp, filter, freeAt: -1 });
    }
  }

  /**
   * Claim a chain that will be free at `when` and hold it until `until`.
   * Returns null when the pool is exhausted — the note is simply dropped, which
   * is inaudible on a 16th and far better than an unbounded allocation.
   */
  acquire(when: number, until: number): Chain | null {
    for (const it of this.items) {
      if (it.freeAt <= when) {
        it.freeAt = until;
        cancelAudioParamScheduledValues(it.amp.gain, when);
        setAudioParamValueAtTime(it.amp.gain, 0, when);
        cancelAudioParamScheduledValues(it.filter.frequency, when);
        return it;
      }
    }
    return null;
  }

  dispose(): void {
    for (const it of this.items) {
      try { it.filter.disconnect(); it.amp.disconnect(); } catch { /* gone */ }
    }
    this.items.length = 0;
  }
}

/* ==========================================================================
 * 3. STEMS
 * ========================================================================== */

type StemName = 'pad' | 'bass' | 'kick' | 'hat' | 'snare' | 'guitar' | 'anvil' | 'brass' | 'siren';

/** Which layer each stem switches on at. §3.6 table, one row per stem. */
const STEM_LAYER: Readonly<Record<StemName, number>> = {
  pad: 0,
  kick: 0,
  bass: 1,
  hat: 1,
  snare: 2,
  guitar: 2,
  anvil: 2,
  brass: 3,
  siren: 4,
};

/** Stems the kick ducks. Percussion is deliberately absent. */
const DUCKED_STEMS = new Set<StemName>(['pad', 'bass', 'guitar', 'brass', 'siren']);

/** Sidechain shape: depth, hold, release. Deep and short, so it pumps. */
const PUMP = { depthDb: -9, holdMs: 22, releaseMs: 150 } as const;

interface Stem {
  /** Everything in the stem feeds this; the layer crossfade writes its gain. */
  readonly bus: GainNode;
  /** 0 or 1 — where the crossfade is heading. */
  target: number;
  active: boolean;
}

/* ==========================================================================
 * 4. THE DIRECTOR
 * ========================================================================== */

export type MusicMode = 'combat' | 'win' | 'loss' | 'stopped';

export class MusicDirector {
  private readonly stems = new Map<StemName, Stem>();
  private readonly bus: GainNode;
  private readonly reverbIn: GainNode;
  /**
   * SIDECHAIN. Every pitched stem passes through here and the kick pulls it
   * down for 150 ms on each hit.
   *
   * This is not an effect, it is how the genre breathes: a 16th-note bass
   * ostinato and a four-on-the-floor kick occupy the same octave, so without
   * ducking they mask each other into one continuous low-frequency smear and
   * the track has no pulse at all. With it, the kick punches a hole and the
   * bass rushes back in behind it, which is the entire groove.
   */
  private readonly sidechain: GainNode;
  private readonly rng: Rng01 = makeRng(0x11a5_1c00);

  private bassPool: ChainPool | null = null;
  private kickPool: ChainPool | null = null;
  private snarePool: ChainPool | null = null;
  private hatPool: ChainPool | null = null;
  /** Persistent guitar cabinet + Haas double-track. Built once at start(). */
  private guitarRig: { input: AudioNode; amp: GainNode } | null = null;

  private noise: AudioBuffer | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Absolute ctx time of the next unscheduled 16th. */
  private nextStepTime = 0;
  /** Global 16th counter since the loop began. */
  private step = 0;
  private bpm: number = AUDIO_MUSIC.bpm;

  /** Raw heat pushed in by the game, and the smoothed value the mix uses. */
  private heat = 0;
  private heatSmoothed = 0;
  /** Context time of the last smoothing pass. -1 until the first tick. */
  private lastHeatAt = -1;

  private layer = 0;
  private pendingLayer = 0;
  /** Bars the smoothed heat has wanted a LOWER layer. Down-shifts wait 2 bars. */
  private downBars = 0;

  private consecutiveC = 0;
  private mode: MusicMode = 'stopped';
  private detuneCents = 0;
  private started = false;
  private paused = false;

  constructor(private readonly host: MusicHost) {
    const ctx = host.ctx;
    this.bus = gain(ctx, 0);
    // Nothing under 30 Hz survives: it is inaudible on every speaker a browser
    // game is played through, and it was measured taking 71% of the bed's
    // energy budget at mid intensity. Headroom spent on nothing.
    const sub = biquad(ctx, 'highpass', 30, 0.7);
    this.bus.connect(sub).connect(host.musicOut());
    this.sidechain = gain(ctx, 1);
    this.sidechain.connect(this.bus);
    // A short send so the snare plate and the pad tail have somewhere to go.
    this.reverbIn = gain(ctx, dbToGain(-20));
    this.reverbIn.connect(this.bus);

    const names: StemName[] = ['pad', 'bass', 'kick', 'hat', 'snare', 'guitar', 'anvil', 'brass', 'siren'];
    for (const n of names) {
      const g = gain(ctx, 0);
      // Percussion bypasses the pump. A kick that ducked itself would be a kick
      // with a hole in it, and gating the snare against it kills the backbeat.
      g.connect(DUCKED_STEMS.has(n) ? this.sidechain : this.bus);
      this.stems.set(n, { bus: g, target: 0, active: false });
    }
  }

  /* ---------------------------------------------------------------------- */

  /** Seconds per 16th at the current tempo. */
  private get stepSec(): number { return 60 / this.bpm / 4; }
  private get barSec(): number { return this.stepSec * AUDIO_MUSIC.stepsPerBar; }

  /**
   * @param manual  Skip the interval timer and let the caller drive `pump()`.
   *                The offline renderer needs this; the game never does.
   */
  start(manual = false): void {
    if (this.started || this.host.muted) return;
    this.started = true;
    this.mode = 'combat';
    const ctx = this.host.ctx;
    this.noise = this.host.white;

    this.bassPool = new ChainPool(ctx, this.stems.get('bass')!.bus, 12, 'lowpass', 1600, 4);
    this.kickPool = new ChainPool(ctx, this.stems.get('kick')!.bus, 6, 'lowpass', 12000, 0.7);
    this.snarePool = new ChainPool(ctx, this.stems.get('snare')!.bus, 8, 'highpass', 120, 0.7);
    this.hatPool = new ChainPool(ctx, this.stems.get('hat')!.bus, 8, 'highpass', 7000, 0.7);
    this.guitarRig = this.buildGuitarRig();

    this.step = 0;
    this.lastHeatAt = -1;
    this.nextStepTime = this.host.now() + 0.1;
    this.applyLayer(0, true);

    if (!manual) this.timer = setInterval(() => this.tick(), AUDIO_MUSIC.tickMs);
  }

  /** One scheduler pass. Public only so an offline render can drive the clock. */
  pump(): void { this.tick(); }

  stop(fadeSec = 1.5): void {
    if (!this.started) return;
    this.started = false;
    this.paused = false;
    this.mode = 'stopped';
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    const t = this.host.now();
    cancelAudioParamScheduledValues(this.bus.gain, t);
    setAudioParamValueAtTime(this.bus.gain, Math.max(0.0001, this.bus.gain.value), t);
    exponentialRampAudioParamToValueAtTime(this.bus.gain, 0.0001, t + fadeSec);
    setAudioParamValueAtTime(this.bus.gain, 0, t + fadeSec);
  }

  pause(): void {
    if (!this.started || this.paused) return;
    this.paused = true;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    const t = this.host.now();
    cancelAudioParamScheduledValues(this.bus.gain, t);
    setAudioParamTargetAtTime(this.bus.gain, 0.0001, t, 0.035);
  }

  resume(): void {
    if (!this.started || !this.paused) return;
    this.paused = false;
    this.nextStepTime = this.host.now() + 0.1;
    this.applyLayer(this.layer, true);
    this.timer = setInterval(() => this.tick(), AUDIO_MUSIC.tickMs);
  }

  dispose(): void {
    this.stop(0.2);
    this.bassPool?.dispose();
    this.kickPool?.dispose();
    this.snarePool?.dispose();
    this.hatPool?.dispose();
    if (this.guitarRig !== null) {
      try { this.guitarRig.input.disconnect(); this.guitarRig.amp.disconnect(); } catch { /* gone */ }
      this.guitarRig = null;
    }
    try { this.bus.disconnect(); this.reverbIn.disconnect(); } catch { /* gone */ }
  }

  /* ---------------------------------------------------------------------- */
  /* Intensity                                                              */
  /* ---------------------------------------------------------------------- */

  /** Raw combat heat, 0..1. Smoothing and the layer decision live here. */
  setCombatHeat(h: number): void {
    const safe = finiteAudioNumber(h, 0);
    this.heat = safe < 0 ? 0 : safe > 1 ? 1 : safe;
  }

  /**
   * Jump the smoothed heat and the layer straight to `h`, skipping the ramp.
   * Offline rendering and the debug console only — in a match the ramp IS the
   * feature, and snapping the arrangement mid-bar sounds like a bug.
   */
  primeHeat(h: number): void {
    const safe = finiteAudioNumber(h, 0);
    const v = safe < 0 ? 0 : safe > 1 ? 1 : safe;
    this.heat = v;
    this.heatSmoothed = v;
    const up = AUDIO_MUSIC.layerUp;
    let want = 0;
    for (let i = 0; i < up.length; i++) if (v >= up[i]) want = i + 1;
    this.applyLayer(want, true);
  }

  /** The smoothed value, for the debug overlay. */
  get intensity(): number { return this.heatSmoothed; }
  /** Raw heat as last pushed, before smoothing. Diagnostics. */
  get rawHeat(): number { return this.heat; }
  /** 16ths scheduled since the loop began. Zero here means the timer is dead. */
  get scheduledSteps(): number { return this.step; }
  get running(): boolean { return this.started && !this.paused; }
  get currentLayer(): number { return this.layer; }

  /** Match won: crossfade to an E major, 108 BPM, brass-led variant over 1.5 s. */
  win(): void {
    if (!this.started) return;
    this.mode = 'win';
    this.bpm = 108;
    this.setStem('siren', false);
    this.setStem('guitar', false);
    this.setStem('bass', true);
    this.setStem('brass', true);
    this.setStem('pad', true);
    this.setStem('snare', true);
    this.setStem('kick', true);
  }

  /** Match lost: detune everything -700 cents over 2.5 s, gone by t+3. */
  loss(): void {
    if (!this.started) return;
    this.mode = 'loss';
    const t0 = this.host.now();
    const dur = 2.5;
    // Applied to every note scheduled from here on. The 120 ms horizon means
    // "from here on" is effectively "now".
    const start = t0;
    const iv = setInterval(() => {
      const k = Math.min(1, (this.host.now() - start) / dur);
      this.detuneCents = -700 * k;
      if (k >= 1) clearInterval(iv);
    }, 40);
    const t = this.host.now();
    cancelAudioParamScheduledValues(this.bus.gain, t);
    setAudioParamValueAtTime(this.bus.gain, Math.max(0.0001, this.bus.gain.value), t);
    exponentialRampAudioParamToValueAtTime(this.bus.gain, 0.0001, t + 3);
    setTimeout(() => this.stop(0.1), 3100);
  }

  /* ---------------------------------------------------------------------- */
  /* The scheduler                                                          */
  /* ---------------------------------------------------------------------- */

  private tick(): void {
    const now = this.host.now();

    // A suspended context freezes currentTime. Scheduling against it would
    // stack an unbounded pile of notes that all detonate on the first click.
    // Idle here and re-anchor; the track starts when the player does.
    if (!this.host.running) { this.nextStepTime = now + 0.1; return; }

    /* -- heat smoothing, on MEASURED time --------------------------------- */
    // Never assume the interval fired on schedule. Browsers throttle timers to
    // roughly 1 Hz in a background or headless page, and a smoother that counts
    // `tickMs` per call then simply stops advancing — measured: raw heat 0.8,
    // smoothed heat 0.0, layer stuck at L0 for the whole session.
    const heatStep = AUDIO_MUSIC.heatTickMs / 1000;
    if (this.lastHeatAt < 0) this.lastHeatAt = now;
    let elapsed = now - this.lastHeatAt;
    if (elapsed >= heatStep) {
      // Cap the catch-up so a 30 s background stint does not snap the layer.
      let passes = Math.min(8, Math.floor(elapsed / heatStep));
      this.lastHeatAt = now;
      while (passes-- > 0) {
        const k = this.heat > this.heatSmoothed ? AUDIO_MUSIC.riseK : AUDIO_MUSIC.fallK;
        this.heatSmoothed += (this.heat - this.heatSmoothed) * k;
      }
    }


    /* -- schedule everything inside the horizon --------------------------- */
    // Re-anchor BEFORE scheduling, never after: a throttled tick can leave
    // nextStepTime seconds in the past, and every step scheduled at a past time
    // fires the instant it is created. Doing this afterwards still emits one
    // burst of 64 notes at once — which is what a throttled tab actually did.
    if (this.nextStepTime < now - 0.25) this.nextStepTime = now + 0.02;

    const horizon = now + AUDIO_MUSIC.horizonSec;
    let guard = 0;
    while (this.nextStepTime < horizon && guard++ < 64) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.step++;
      this.nextStepTime += this.stepSec;
    }
  }

  private scheduleStep(step: number, when: number): void {
    const S = AUDIO_MUSIC.stepsPerBar;
    const stepInBar = step % S;
    const bar = Math.floor(step / S);
    const barInSection = bar % AUDIO_MUSIC.barsPerSection;

    /* -- section order A->B->C->D, with the C-repeat rule ----------------- */
    let section = Math.floor(bar / AUDIO_MUSIC.barsPerSection) % AUDIO_MUSIC.sections;
    if (this.mode === 'win') section = 1;
    if (section === 3 && this.heatSmoothed > 0.6 && this.consecutiveC < 3) {
      // Do not let the peak deflate mid-battle: repeat C instead of dropping to D.
      section = 2;
    }
    if (stepInBar === 0) {
      this.consecutiveC = section === 2 ? this.consecutiveC + 1 : 0;
    }

    /* -- layer decision, only ever at a bar boundary ---------------------- */
    if (stepInBar === 0) this.evaluateLayer();

    const roots = SECTION_ROOTS[section];
    let root = roots[barInSection];
    // §3.6: the F# in the last bar of A collapses to a Phrygian F on beat 4.
    if (section === 0 && barInSection === 7 && stepInBar >= 12) root = F;

    const L = this.layer;
    const major = this.mode === 'win';

    if (L >= STEM_LAYER.bass) this.bass(when, stepInBar, root, section);
    if (L >= STEM_LAYER.kick) this.kick(when, stepInBar, L, section);
    if (L >= STEM_LAYER.hat) this.hat(when, stepInBar, section, L);
    if (L >= STEM_LAYER.snare) this.snare(when, stepInBar, barInSection, L, section);
    if (L >= STEM_LAYER.guitar) this.guitar(when, stepInBar, root, section, L);
    if (L >= STEM_LAYER.anvil) this.anvil(when, stepInBar, barInSection);
    if (L >= STEM_LAYER.brass) this.brass(when, stepInBar, barInSection, section, major);
    if (L >= STEM_LAYER.siren) this.siren(when, stepInBar, barInSection);
    this.pad(when, stepInBar, barInSection, root, section, major);
  }

  /**
   * Layer changes land on a bar boundary; going DOWN waits two bars, so a lull
   * between two volleys does not drop the drums out and bring them straight
   * back — which is the thing that makes dynamic music sound broken.
   */
  private evaluateLayer(): void {
    const up = AUDIO_MUSIC.layerUp;
    const hys = AUDIO_MUSIC.layerHysteresis;
    let want = 0;
    for (let i = 0; i < up.length; i++) {
      const thresh = this.layer > i ? up[i] - hys : up[i];
      if (this.heatSmoothed >= thresh) want = i + 1;
    }
    if (want > this.layer) {
      this.downBars = 0;
      this.applyLayer(want, false);
    } else if (want < this.layer) {
      this.downBars++;
      if (this.downBars >= 2) { this.downBars = 0; this.applyLayer(want, false); }
    } else {
      this.downBars = 0;
    }
    this.pendingLayer = want;
  }

  private applyLayer(layer: number, immediate: boolean): void {
    this.layer = layer;
    const names: StemName[] = ['pad', 'bass', 'kick', 'hat', 'snare', 'guitar', 'anvil', 'brass', 'siren'];
    for (const n of names) this.setStem(n, layer >= STEM_LAYER[n], immediate);
    // Bus level per layer, plus the L4 low shelf.
    const db = AUDIO_MUSIC.layerDb[Math.min(AUDIO_MUSIC.layerDb.length - 1, layer)];
    const t = this.host.now();
    // The music STRIP gain belongs to the user's slider; the layer level is ours.
    cancelAudioParamScheduledValues(this.bus.gain, t);
    setAudioParamTargetAtTime(this.bus.gain, dbToGain(db - AUDIO_BUS_DB.music), t, immediate ? 0.05 : this.barSec / 3);
  }

  /** Equal-power crossfade of one stem over a bar. */
  private setStem(name: StemName, on: boolean, immediate = false): void {
    const s = this.stems.get(name);
    if (s === undefined || s.target === (on ? 1 : 0)) return;
    s.target = on ? 1 : 0;
    s.active = on;
    const t = this.host.now();
    const dur = immediate ? 0.05 : this.barSec * AUDIO_MUSIC.fadeBars;
    cancelAudioParamScheduledValues(s.bus.gain, t);
    setAudioParamValueAtTime(s.bus.gain, s.bus.gain.value, t);
    // Equal power: sqrt of the linear ramp, approximated with a 4-point curve.
    const steps = 8;
    const from = s.bus.gain.value;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const v = Math.sqrt(from * from * (1 - k) + s.target * s.target * k);
      linearRampAudioParamToValueAtTime(s.bus.gain, v, t + dur * k);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Instruments                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * The bass ostinato — straight 16ths, palm-muted. Saw + square (-8 dB) + sine
   * sub (-4 dB) through a per-note filter envelope 1600 -> 380 Hz over 55 ms.
   * The note is 105 ms with an 18 ms gap; that gap is the entire chug.
   */
  private bass(when: number, stepInBar: number, root: number, section: number): void {
    const pool = this.bassPool;
    if (pool === null) return;
    // Section D leaves the first four bars bare, so the return has somewhere to go.
    if (section === 3 && this.layer < 3 && stepInBar % 4 !== 0) return;

    const chain = pool.acquire(when - 0.001, when + 0.16);
    if (chain === null) return;
    const ctx = this.host.ctx;
    // The ostinato plays at E2, an octave above the notional E1 root. At E1 the
    // fundamental is 41 Hz and carries ~60% of a sawtooth's power, so the whole
    // riff lived under 80 Hz: measured, 62-71% of the bed's energy, inaudible
    // on a laptop and eating the headroom the kick needs. The E1 weight is
    // added back as one quiet sine below.
    const f = hz(AUDIO_MUSIC.rootHz, root, 1);
    const accent = BASS_ACCENT[stepInBar];
    const peak = dbToGain(-8) * accent;

    setAudioParamValueAtTime(chain.filter.frequency, 1600, when);
    exponentialRampAudioParamToValueAtTime(chain.filter.frequency, 380, when + 0.055);
    setAudioParamValueAtTime(chain.amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(chain.amp.gain, peak, when + 0.002);
    setAudioParamValueAtTime(chain.amp.gain, peak, when + 0.097);
    linearRampAudioParamToValueAtTime(chain.amp.gain, 0.0001, when + 0.105);
    setAudioParamValueAtTime(chain.amp.gain, 0, when + 0.106);

    const drive = shaper(ctx, 5, '2x', 1024);
    drive.connect(chain.filter);
    this.osc('sawtooth', f, when, 0.12, drive, 1);
    this.osc('square', f, when, 0.12, drive, dbToGain(-8));
    // Reinforce the FUNDAMENTAL; do not add an octave under it. At an E1 root
    // the old `f * 0.5` sine sang at 20.6 Hz, below the reproduction floor of
    // every laptop, phone and pair of earbuds, and 4 dB louder than the note.
    // The OCTAVE UP, not the fundamental. At an E1 root the fundamental is
    // 41 Hz, which is already the sub band; doubling down on it put 65% of the
    // bed's energy under 80 Hz and left the ostinato inaudible on a laptop. The
    // saw and square below carry the fundamental on their own.
    this.osc('sine', f, when, 0.12, drive, dbToGain(-7));
    // One octave down, quiet: the weight, not the note.
    this.osc('sine', f * 0.5, when, 0.12, drive, dbToGain(-13));
    // The shaper is per note; it is a single node and disconnects with the oscs.
    setTimeout(() => { try { drive.disconnect(); } catch { /* gone */ } }, 400);
  }

  /** Sine 120 -> 45 Hz over 45 ms, plus a 6 ms beater click. */
  private kick(when: number, stepInBar: number, layer: number, section: number): void {
    const pool = this.kickPool;
    if (pool === null) return;
    const pattern = (layer >= 3 || section === 2) ? KICK_DOUBLE : KICK_BASE;
    // L0 is a half-tempo pulse on beats 1 and 3. One hit per BAR, which is what
    // this was, is a clock ticking rather than an idle groove.
    const hit = layer === 0 ? (stepInBar === 0 || stepInBar === 8 ? 1 : 0) : pattern[stepInBar];
    if (!hit) return;

    const chain = pool.acquire(when - 0.001, when + 0.3);
    if (chain === null) return;
    const peak = dbToGain(-5);
    setAudioParamValueAtTime(chain.amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(chain.amp.gain, peak, when + 0.001);
    exponentialRampAudioParamToValueAtTime(chain.amp.gain, 0.0001, when + 0.22);
    setAudioParamValueAtTime(chain.amp.gain, 0, when + 0.225);

    // 165 -> 48 Hz in 38 ms. The steeper and faster that sweep, the more the
    // ear reads an IMPACT rather than a pitch: a kick that glides slowly is a
    // tom, and one that does not glide at all is a sine beep.
    const o = this.host.ctx.createOscillator();
    o.type = 'sine';
    setAudioParamValueAtTime(o.frequency, 165, when);
    exponentialRampAudioParamToValueAtTime(o.frequency, 48, when + 0.038);
    setAudioParamValue(o.detune, this.detuneCents);
    o.connect(chain.filter);
    o.start(when);
    o.stop(when + 0.28);
    o.onended = () => { try { o.disconnect(); } catch { /* gone */ } };

    // The beater: 4 ms of hard treble, plus a 220 Hz shell knock. These are the
    // layers that survive on a laptop speaker, where the sub above does not
    // reproduce at all.
    this.noiseHit(when, 0.004, 'highpass', 3500, 0.7, dbToGain(-9), chain.filter);
    this.noiseHit(when, 0.03, 'bandpass', 220, 1.2, dbToGain(-16), chain.filter);

    this.duckPump(when);
  }

  /**
   * Schedule one sidechain dip. Written as an absolute schedule rather than
   * `setTargetAtTime` so two kicks 246 ms apart cannot leave the pump stuck
   * partway down: every hit restores unity before it dips.
   */
  private duckPump(when: number): void {
    const g = this.sidechain.gain;
    const d = dbToGain(PUMP.depthDb);
    const hold = PUMP.holdMs / 1000;
    const rel = PUMP.releaseMs / 1000;
    cancelAudioParamScheduledValues(g, when);
    setAudioParamValueAtTime(g, 1, when);
    linearRampAudioParamToValueAtTime(g, d, when + 0.004);
    setAudioParamValueAtTime(g, d, when + hold);
    linearRampAudioParamToValueAtTime(g, 1, when + hold + rel);
  }

  /** Closed hat on every off-8th, but only in sections B and C. */
  private hat(when: number, stepInBar: number, section: number, layer: number): void {
    // Off-8ths in B and C; at L3+ the hat runs everywhere, and on straight
    // 8ths, because a peak-intensity bar with no treble motion above 2 kHz
    // measured at 4% of its energy in the top three octaves and read as muddy.
    const everywhere = layer >= 3;
    if (!everywhere && section !== 1 && section !== 2) return;
    if (everywhere ? stepInBar % 2 !== 0 : stepInBar % 4 !== 2) return;
    const pool = this.hatPool;
    if (pool === null) return;
    const chain = pool.acquire(when - 0.001, when + 0.06);
    if (chain === null) return;
    // Accent the downbeats: an unaccented hat is a metronome.
    const peak = dbToGain(stepInBar % 4 === 0 ? -15 : -19);
    setAudioParamValueAtTime(chain.amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(chain.amp.gain, peak, when + 0.001);
    exponentialRampAudioParamToValueAtTime(chain.amp.gain, 0.0001, when + 0.026);
    setAudioParamValueAtTime(chain.amp.gain, 0, when + 0.028);
    this.noiseHit(when, 0.028, 'bandpass', 9500, 2, 1, chain.filter);
    this.noiseHit(when, 0.028, 'highpass', 6000, 0.7, dbToGain(-6), chain.filter);
  }

  /**
   * Backbeat on steps 4 and 12 always; ghosts on 7/11/15 in section C at L3+;
   * a 16th roll on 12-15 in the last bar of every eight at L4.
   */
  private snare(
    when: number, stepInBar: number, barInSection: number, layer: number, section: number,
  ): void {
    const pool = this.snarePool;
    if (pool === null) return;
    let level = 0;
    if (stepInBar === 4 || stepInBar === 12) level = dbToGain(-8);
    else if (layer >= 3 && section === 2 && (stepInBar === 7 || stepInBar === 11 || stepInBar === 15)) {
      level = dbToGain(-16);
    }
    if (layer >= 4 && barInSection === 7 && stepInBar >= 12) {
      const rollGain = [0.5, 0.65, 0.8, 1.0][stepInBar - 12];
      level = Math.max(level, dbToGain(-8) * rollGain);
    }
    if (level <= 0) return;

    const chain = pool.acquire(when - 0.001, when + 0.16);
    if (chain === null) return;
    setAudioParamValueAtTime(chain.amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(chain.amp.gain, level, when + 0.001);
    exponentialRampAudioParamToValueAtTime(chain.amp.gain, 0.0001, when + 0.11);
    setAudioParamValueAtTime(chain.amp.gain, 0, when + 0.115);

    // Body: a 190 Hz triangle. Wires: BP 900 + HP 4200 summed. Rim: a 4 ms crack.
    this.osc('triangle', 190, when, 0.09, chain.filter, 0.8);
    this.noiseHit(when, 0.11, 'bandpass', 900, 0.7, 0.9, chain.filter);
    this.noiseHit(when, 0.11, 'highpass', 4200, 0.7, 0.7, chain.filter);
    this.noiseHit(when, 0.004, 'bandpass', 2800, 6, dbToGain(-8), chain.filter);
    // Plate send.
    this.noiseHit(when, 0.11, 'bandpass', 1200, 0.8, dbToGain(-20), this.reverbIn);
  }

  /**
   * Two saws detuned +-11 cents through a hard tanh and a cabinet EQ, Haas
   * double-tracked. 8ths in B and C, sustained power chords in A, silent
   * through D's first four bars.
   */
  private guitar(when: number, stepInBar: number, root: number, section: number, layer: number): void {
    const rig = this.guitarRig;
    if (rig === null) return;
    let dur = 0;
    if (section === 1 || section === 2) {
      if (stepInBar % 2 !== 0) return;
      dur = 0.22;
    } else if (section === 0) {
      if (stepInBar !== 0) return;
      dur = this.barSec * 0.95;
    } else {
      return; // section D: silent
    }

    // The cabinet is persistent — twelve nodes rebuilt four times a second for
    // a whole match is exactly the churn §3.6 warns about. Only the note's own
    // amp envelope and its oscillators are per-note.
    const peak = 0.9;
    const amp = rig.amp;
    cancelAudioParamScheduledValues(amp.gain, when);
    setAudioParamValueAtTime(amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(amp.gain, peak, when + 0.004);
    setAudioParamValueAtTime(amp.gain, peak, when + dur * 0.8);
    exponentialRampAudioParamToValueAtTime(amp.gain, 0.0001, when + dur);
    setAudioParamValueAtTime(amp.gain, 0, when + dur + 0.005);

    const f = hz(AUDIO_MUSIC.rootHz, root, 1);
    this.osc('sawtooth', f, when, dur + 0.02, rig.input, 1, -11);
    this.osc('sawtooth', f, when, dur + 0.02, rig.input, 1, 11);
    // L4 adds the octave.
    if (layer >= 4) this.osc('sawtooth', f * 2, when, dur + 0.02, rig.input, dbToGain(-9), 4);
  }

  /**
   * The guitar cabinet, built once: tanh drive 12 (4x oversample) into
   * HP 90 -> BP 1600 -> LP 4500 -> +4 dB @ 2400 -> -5 dB @ 400, then Haas
   * double-tracked at -0.55 / +0.55 with the right side delayed 11 ms.
   */
  private buildGuitarRig(): { input: AudioNode; amp: GainNode } {
    const ctx = this.host.ctx;
    const stem = this.stems.get('guitar')!;
    const drive = shaper(ctx, 12, '4x', 2048);
    const hp = biquad(ctx, 'highpass', 90, 0.7);
    const cab = biquad(ctx, 'bandpass', 1600, 0.7);
    const lp = biquad(ctx, 'lowpass', 4500, 0.9);
    const pres = biquad(ctx, 'peaking', 2400, 2, 4);
    const scoop = biquad(ctx, 'peaking', 400, 1.4, -5);
    const amp = gain(ctx, 0);
    drive.connect(hp).connect(cab).connect(lp).connect(pres).connect(scoop).connect(amp);

    const left = ctx.createStereoPanner(); setAudioParamValue(left.pan, -0.55);
    const right = ctx.createStereoPanner(); setAudioParamValue(right.pan, 0.55);
    const dly = ctx.createDelay(0.05); setAudioParamValue(dly.delayTime, 0.011);
    const lg = gain(ctx, dbToGain(-11));
    const rg = gain(ctx, dbToGain(-11));
    amp.connect(left).connect(lg).connect(stem.bus);
    amp.connect(dly).connect(right).connect(rg).connect(stem.bus);

    return { input: drive, amp };
  }

  /**
   * The industrial signature: noise through three parallel bandpasses at
   * 1873 / 2790 / 4310 Hz, Q 22 each. Three filters is what makes it an anvil
   * rather than a snare — the pitch comes from the resonances, not a note.
   */
  private anvil(when: number, stepInBar: number, barInSection: number): void {
    if (stepInBar !== 8) return;
    if (barInSection !== 3 && barInSection !== 7) return;
    const ctx = this.host.ctx;
    const stem = this.stems.get('anvil')!;
    const pan = ctx.createStereoPanner();
    setAudioParamValue(pan.pan, barInSection === 3 ? -0.3 : 0.3);
    const amp = gain(ctx, 0);
    amp.connect(pan).connect(stem.bus);
    const peak = dbToGain(-14);
    setAudioParamValueAtTime(amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(amp.gain, peak, when + 0.001);
    exponentialRampAudioParamToValueAtTime(amp.gain, 0.0001, when + 0.62);
    setAudioParamValueAtTime(amp.gain, 0, when + 0.63);
    for (const f of [1873, 2790, 4310]) this.noiseHit(when, 0.64, 'bandpass', f, 22, 0.5, amp);
    amp.connect(this.reverbIn);
    setTimeout(() => { try { amp.disconnect(); pan.disconnect(); } catch { /* gone */ } }, 1200);
  }

  /**
   * Five saws — root, octave, minor third, fifth and a +1900 cent top — each
   * detuned a few cents apart. Bar 1 and bar 5 of section B; steps 0/6/10 of
   * every bar in section C.
   */
  private brass(
    when: number, stepInBar: number, barInSection: number, section: number, major: boolean,
  ): void {
    let fire = false;
    if (section === 1) fire = (barInSection === 0 || barInSection === 4) && stepInBar === 0;
    else if (section === 2) fire = stepInBar === 0 || stepInBar === 6 || stepInBar === 10;
    else if (major) fire = stepInBar === 0 || stepInBar === 8;
    if (!fire) return;

    const ctx = this.host.ctx;
    const stem = this.stems.get('brass')!;
    // Chords Em / C / D / Em, one per two bars.
    const chordRoots = major ? [E, A, B, E] : [E, C, D, E];
    const chordRoot = chordRoots[Math.floor(barInSection / 2) % 4];
    const triad = major ? MAJOR_TRIAD : MINOR_TRIAD;

    const lp = biquad(ctx, 'lowpass', 400, 2);
    const amp = gain(ctx, 0);
    lp.connect(amp);
    // Widened with a 15 ms L/R delay.
    const left = ctx.createStereoPanner(); setAudioParamValue(left.pan, -0.4);
    const right = ctx.createStereoPanner(); setAudioParamValue(right.pan, 0.4);
    const dly = ctx.createDelay(0.05); setAudioParamValue(dly.delayTime, 0.015);
    amp.connect(left).connect(stem.bus);
    amp.connect(dly).connect(right).connect(stem.bus);
    amp.connect(this.reverbIn);

    setAudioParamValueAtTime(lp.frequency, 400, when);
    exponentialRampAudioParamToValueAtTime(lp.frequency, 3200, when + 0.03);
    exponentialRampAudioParamToValueAtTime(lp.frequency, 1400, when + 0.26);

    const peak = dbToGain(-13);
    setAudioParamValueAtTime(amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(amp.gain, peak, when + 0.012);
    exponentialRampAudioParamToValueAtTime(amp.gain, peak * 0.7, when + 0.052);
    exponentialRampAudioParamToValueAtTime(amp.gain, 0.0001, when + 0.28);
    setAudioParamValueAtTime(amp.gain, 0, when + 0.29);

    const base = hz(AUDIO_MUSIC.rootHz, chordRoot, 2);
    const cents = [0, 6, -5, 8, -7];
    const ratios = [1, 2, Math.pow(2, triad[1] / 12), Math.pow(2, triad[2] / 12), Math.pow(2, 19 / 12)];
    for (let i = 0; i < 5; i++) this.osc('sawtooth', base * ratios[i], when, 0.3, lp, 0.35, cents[i]);
    setTimeout(() => {
      for (const n of [lp, amp, left, right, dly]) { try { n.disconnect(); } catch { /* gone */ } }
    }, 900);
  }

  /**
   * Section C only: a saw through a lowpass swept by a 0.5 Hz triangle between
   * 500 and 4500 Hz at Q 8. Sustained E4 / B3, alternating every two bars.
   */
  private siren(when: number, stepInBar: number, barInSection: number): void {
    if (stepInBar !== 0 || barInSection % 2 !== 0) return;
    const ctx = this.host.ctx;
    const stem = this.stems.get('siren')!;
    const dur = this.barSec * 2;

    const lp = biquad(ctx, 'lowpass', 500, 8);
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    setAudioParamValue(lfo.frequency, 0.5);
    const depth = gain(ctx, 2000);
    setAudioParamValue(lp.frequency, 2500);
    lfo.connect(depth).connect(lp.frequency);
    lfo.start(when);
    lfo.stop(when + dur + 0.1);

    const amp = gain(ctx, 0);
    lp.connect(amp).connect(stem.bus);
    const peak = dbToGain(-17);
    setAudioParamValueAtTime(amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(amp.gain, peak, when + 0.4);
    setAudioParamValueAtTime(amp.gain, peak, when + dur - 0.3);
    exponentialRampAudioParamToValueAtTime(amp.gain, 0.0001, when + dur);
    setAudioParamValueAtTime(amp.gain, 0, when + dur + 0.01);

    const note = (barInSection / 2) % 2 === 0 ? hz(AUDIO_MUSIC.rootHz, E, 3) : hz(AUDIO_MUSIC.rootHz, B, 2);
    this.osc('sawtooth', note, when, dur + 0.05, lp, 1);
    setTimeout(() => {
      for (const n of [lp, amp, depth]) { try { n.disconnect(); } catch { /* gone */ } }
    }, (dur + 0.6) * 1000);
  }

  /**
   * Choir pad in sections A and D. Three saws per note through a lowpass plus a
   * formant pair (BP 620 + BP 1100) to fake vowels — that pair is the whole
   * difference between "choir" and "string patch".
   */
  private pad(
    when: number, stepInBar: number, barInSection: number, root: number,
    section: number, major: boolean,
  ): void {
    if (stepInBar !== 0 || barInSection % 2 !== 0) return;
    if (!(section === 0 || section === 3 || major)) return;
    const ctx = this.host.ctx;
    const stem = this.stems.get('pad')!;
    const dur = this.barSec * 2;

    const lp = biquad(ctx, 'lowpass', 900, 0.8);
    const f1 = biquad(ctx, 'bandpass', 620, 5);
    const f2 = biquad(ctx, 'bandpass', 1100, 5);
    const amp = gain(ctx, 0);
    lp.connect(amp);
    lp.connect(f1).connect(amp);
    lp.connect(f2).connect(amp);
    amp.connect(stem.bus);
    amp.connect(this.reverbIn);

    // -13 dB, and up to full in 0.9 s rather than 2.5. Two bars at 122 BPM is
    // 3.9 s, so a 2.5 s attack meant the pad spent most of every note getting
    // there: the idle bed measured -44.7 dB RMS against a -21.6 dB peak, i.e.
    // inaudible, and the menu and every lull in a match were effectively silent.
    const peak = dbToGain(-13);
    setAudioParamValueAtTime(amp.gain, 0.0001, when);
    linearRampAudioParamToValueAtTime(amp.gain, peak, when + 0.9);
    setAudioParamValueAtTime(amp.gain, peak, when + Math.max(1.0, dur - 0.6));
    exponentialRampAudioParamToValueAtTime(amp.gain, 0.0001, when + dur + 0.5);
    setAudioParamValueAtTime(amp.gain, 0, when + dur + 0.55);

    const triad = major ? MAJOR_TRIAD : MINOR_TRIAD;
    for (const s of triad) {
      const f = hz(AUDIO_MUSIC.rootHz, root + s, 2);
      this.osc('sawtooth', f, when, dur + 0.6, lp, 0.33, this.rng() * 8 - 4);
    }
    setTimeout(() => {
      for (const n of [lp, f1, f2, amp]) { try { n.disconnect(); } catch { /* gone */ } }
    }, (dur + 1.4) * 1000);
  }

  /* ---------------------------------------------------------------------- */
  /* Note primitives                                                        */
  /* ---------------------------------------------------------------------- */

  /** One oscillator, started, stopped, and disconnected on end. */
  private osc(
    type: OscillatorType, freq: number, when: number, dur: number,
    dest: AudioNode, level: number, detune = 0,
  ): void {
    const ctx = this.host.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    setAudioParamValue(o.frequency, freq);
    setAudioParamValue(o.detune, detune + this.detuneCents);
    let out: AudioNode = o;
    if (level !== 1) {
      const g = gain(ctx, level);
      o.connect(g);
      out = g;
    }
    out.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.05);
    o.onended = () => { try { o.disconnect(); out.disconnect(); } catch { /* gone */ } };
  }

  /** A short band-limited noise burst from the shared white bed. */
  private noiseHit(
    when: number, dur: number, type: BiquadFilterType, hz2: number, q: number,
    level: number, dest: AudioNode,
  ): void {
    const buf = this.noise;
    if (buf === null) return;
    const ctx = this.host.ctx;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const f = biquad(ctx, type, hz2, q);
    const g = gain(ctx, level);
    s.connect(f).connect(g).connect(dest);
    const offset = this.rng() * Math.max(0.01, buf.duration - dur - 0.05);
    s.start(when, offset, dur + 0.02);
    s.stop(when + dur + 0.03);
    s.onended = () => {
      try { s.disconnect(); f.disconnect(); g.disconnect(); } catch { /* gone */ }
    };
  }
}

/* ==========================================================================
 * 6. OFFLINE RENDER
 *
 * The track is the one part of the audio module with no natural test surface:
 * it has no buffers to inspect and it only exists while a clock is running.
 * This drives the real sequencer against a virtual clock inside an
 * `OfflineAudioContext`, so `tools/audio-measure.mjs` scores the actual
 * arrangement rather than a reimplementation of it.
 * ========================================================================== */

class OfflineMusicHost implements MusicHost {
  readonly muted = false;
  readonly running = true;
  readonly white: AudioBuffer;
  /** Virtual transport position, advanced by the render loop. */
  clock = 0;

  constructor(readonly ctx: OfflineAudioContext, private readonly dest: AudioNode) {
    this.white = makeWhiteNoise(ctx, 2, 0x51ed_c0de);
  }

  now(): number { return this.clock; }
  musicOut(): AudioNode { return this.dest; }
}

/**
 * Render `seconds` of the bed at a fixed combat heat into `oc`. The caller owns
 * `oc.startRendering()`; this only builds the graph.
 *
 * The heat is pushed BEFORE the first pump and the smoother is stepped forward
 * far enough to settle, so `heat: 0.95` renders the L4 arrangement from bar one
 * instead of eight bars of the idle layer.
 */
export async function renderMusicOffline(
  oc: OfflineAudioContext, seconds: number, heat: number,
): Promise<MusicDirector> {
  const trim = oc.createGain();
  // The music strip's own -9 dB trim, so the offline level matches the game's.
  setAudioParamValue(trim.gain, dbToGain(AUDIO_BUS_DB.music));
  trim.connect(oc.destination);

  const host = new OfflineMusicHost(oc, trim);
  const director = new MusicDirector(host);
  director.start(true);
  // Jump the smoother straight to the target rather than pumping it there:
  // pumping would also SCHEDULE thirty seconds of notes into the buffer, and
  // what would be measured is the ramp rather than the arrangement.
  director.primeHeat(heat);
  const dt = AUDIO_MUSIC.tickMs / 1000;
  while (host.clock < seconds) {
    director.pump();
    host.clock += dt;
  }
  return director;
}
