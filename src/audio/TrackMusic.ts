/**
 * ============================================================================
 * VOLTMARCH — src/audio/TrackMusic.ts
 * ============================================================================
 * RECORDED SCORE. Three CC0 tracks, crossfaded by combat heat, replacing the
 * procedural sequencer as the default while keeping it as the fallback.
 *
 * WHY STREAMS AND NOT THE SAMPLE BANK
 * -----------------------------------
 * Every other recording in this game is decoded into an `AudioBuffer` by
 * `SampleBank`. Music cannot be: decoded PCM is 4 bytes per sample per channel,
 * so one 72-second stereo track is
 *
 *     72 s x 48000 Hz x 4 bytes x 2 channels = 27.6 MB
 *
 * and three of them is 83 MB of resident memory for the soundtrack alone,
 * against a 28 MB budget for the ENTIRE sound-effect bank. So the tracks are
 * `HTMLAudioElement`s routed through `createMediaElementSource`, which streams
 * from the network layer and costs kilobytes of buffer rather than megabytes of
 * Float32. They still land in the same WebAudio graph, so the music bus, the
 * user's music slider and every duck continue to work untouched.
 *
 * HOW THE ADAPTIVE PART SURVIVES
 * ------------------------------
 * The procedural score had five layers that switched on a bar boundary — it
 * could do that because every layer was the same composition. Three unrelated
 * tracks cannot be bar-aligned to each other at all, so the equivalent is an
 * equal-power crossfade over a couple of seconds. All three streams run from
 * the start at whatever gain their band calls for, which is what makes a
 * transition instant instead of a load-then-play stutter.
 *
 * `sin/cos` rather than a linear pair: two uncorrelated tracks at 0.5 linear
 * gain sum to roughly -3 dB of perceived level, so a linear crossfade dips
 * audibly in the middle. Equal-power holds the sum constant, which is the whole
 * reason the curve exists.
 * ============================================================================
 */

import { AUDIO_MUSIC } from '../core/config';
import { dbToGain, type AudioEngine } from './AudioEngine';
import { MusicDirector } from './Music';

/** Track per intensity band, in ascending order. */
const TRACKS = ['idle', 'mid', 'combat'] as const;

/**
 * Heat at which each band takes over, plus the hysteresis that stops a fight
 * hovering on a boundary from crossfading back and forth every two seconds.
 * Deliberately coarser than the sequencer's five bands: with three tracks a
 * change is a change of MUSIC, not a stem appearing, so it wants to happen
 * rarely and mean something.
 */
const BAND_UP = [0.18, 0.55] as const;
const BAND_HYST = 0.07;

/** Seconds of equal-power crossfade when the band changes. */
const CROSSFADE_SEC = 2.4;

/** Where the files live. `vite.config.ts` sets `base: './'`. */
const MUSIC_DIR = 'audio/music';

export function musicPath(name: string): string {
  return `${MUSIC_DIR}/${name}.ogg`;
}

interface Stream {
  el: HTMLAudioElement;
  gain: GainNode;
}

export class TrackMusic {
  private readonly streams: Stream[] = [];
  private readonly engine: AudioEngine;

  /** Set when the streams could not be used and the sequencer took over. */
  private fallback: MusicDirector | null = null;

  private started = false;
  private disposed = false;
  private band = 0;
  private heatRaw = 0;
  private heatSmoothed = 0;
  private heatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  start(): void {
    if (this.started || this.disposed || this.engine.muted) return;
    this.started = true;

    if (typeof Audio === 'undefined' || typeof this.engine.ctx.createMediaElementSource !== 'function') {
      this.useFallback('no HTMLAudioElement or MediaElementSource on this platform');
      return;
    }

    try {
      for (const name of TRACKS) {
        const el = new Audio(musicPath(name));
        el.loop = true;
        el.preload = 'auto';
        // NO `crossOrigin`. Setting it AFTER `src` invalidates the load the
        // constructor just kicked off, and the element then sits there having
        // fetched nothing — measured: zero network requests for all three
        // tracks while every other symptom looked healthy. These are
        // same-origin, so the attribute buys nothing even set correctly.
        // A stream that 404s must not take the other two down with it, and it
        // must not leave the score silent — one failure means the sequencer.
        el.addEventListener('error', () => this.useFallback(`track "${name}" failed to load`));
        const src = this.engine.ctx.createMediaElementSource(el);
        const gain = this.engine.ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.engine.musicOut());
        this.streams.push({ el, gain });
      }
    } catch (err) {
      this.useFallback(`could not build the stream graph: ${String(err)}`);
      return;
    }

    // Autoplay policy: the engine only resumes on a user gesture, and calling
    // play() before that rejects. It is retried from `applyBand`, which runs on
    // the heat tick, so the score starts the moment the context is running.
    this.applyBand(0, true);
    this.heatTimer = setInterval(() => this.tickHeat(), AUDIO_MUSIC.heatTickMs);
  }

  private useFallback(why: string): void {
    if (this.fallback !== null || this.disposed) return;
    console.warn(`[music] recorded score unavailable — ${why}; using the procedural sequencer`);
    for (const s of this.streams) {
      try { s.el.pause(); s.gain.disconnect(); } catch { /* already gone */ }
    }
    this.streams.length = 0;
    if (this.heatTimer !== null) { clearInterval(this.heatTimer); this.heatTimer = null; }
    this.fallback = new MusicDirector(this.engine);
    this.fallback.start();
    this.fallback.primeHeat(this.heatRaw);
  }

  stop(fadeSec = 1.5): void {
    if (this.fallback !== null) { this.fallback.stop(fadeSec); return; }
    const t = this.engine.now();
    for (const s of this.streams) {
      s.gain.gain.cancelScheduledValues(t);
      s.gain.gain.setValueAtTime(Math.max(0.0001, s.gain.gain.value), t);
      s.gain.gain.linearRampToValueAtTime(0, t + fadeSec);
    }
    setTimeout(() => {
      for (const s of this.streams) { try { s.el.pause(); } catch { /* gone */ } }
    }, fadeSec * 1000 + 60);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.heatTimer !== null) { clearInterval(this.heatTimer); this.heatTimer = null; }
    this.fallback?.dispose();
    for (const s of this.streams) {
      try { s.el.pause(); s.el.src = ''; s.gain.disconnect(); } catch { /* gone */ }
    }
    this.streams.length = 0;
  }

  /* ---------------------------------------------------------------------- */
  /* Heat                                                                   */
  /* ---------------------------------------------------------------------- */

  setCombatHeat(h: number): void {
    this.heatRaw = h < 0 ? 0 : h > 1 ? 1 : h;
    this.fallback?.setCombatHeat(this.heatRaw);
  }

  primeHeat(h: number): void {
    this.heatRaw = h;
    this.heatSmoothed = h;
    this.fallback?.primeHeat(h);
  }

  /** Same asymmetric smoothing the sequencer uses: fast up, slow down. */
  private tickHeat(): void {
    if (this.disposed || this.streams.length === 0) return;
    const k = this.heatRaw > this.heatSmoothed ? AUDIO_MUSIC.riseK : AUDIO_MUSIC.fallK;
    this.heatSmoothed += (this.heatRaw - this.heatSmoothed) * k;

    let want = this.band;
    // Hysteresis is applied against the band we are ALREADY in, so the
    // threshold to climb is higher than the threshold to fall back.
    if (this.band < 2 && this.heatSmoothed > BAND_UP[this.band] + BAND_HYST) want = this.band + 1;
    else if (this.band > 0 && this.heatSmoothed < BAND_UP[this.band - 1] - BAND_HYST) want = this.band - 1;

    if (want !== this.band) this.applyBand(want, false);
    else this.ensurePlaying();
  }

  private applyBand(band: number, immediate: boolean): void {
    this.band = band;
    const t = this.engine.now();
    const fade = immediate ? 0.05 : CROSSFADE_SEC;
    for (let i = 0; i < this.streams.length; i++) {
      const g = this.streams[i].gain.gain;
      // Equal power: the incoming track rises as cos, the outgoing falls as
      // sin of the same angle, so their squares sum to one throughout.
      //
      // The active band ramps to its TRIM, not to 1. A hardcoded 1 assumes the
      // three files are level-matched, and they are three independently
      // mastered pieces that differ by 10.7 dB — see `AUDIO_MUSIC.trackTrimDb`
      // for the measurements and for why the trim lives in config rather than
      // being baked into the CC-BY audio.
      const target = i === band ? dbToGain(AUDIO_MUSIC.trackTrimDb[i] ?? 0) : 0;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(target, t, Math.max(0.01, fade / 3));
    }
    this.ensurePlaying();
  }

  /**
   * Every stream runs continuously so a band change is instant rather than a
   * load-then-play stutter. `play()` rejects until the context has been
   * unlocked by a gesture, so this is retried on every heat tick rather than
   * called once at start.
   */
  private ensurePlaying(): void {
    if (!this.engine.running) return;
    for (const s of this.streams) {
      if (s.el.paused) void s.el.play().catch(() => { /* still locked; retry next tick */ });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Match outcome                                                          */
  /* ---------------------------------------------------------------------- */

  win(): void { if (this.fallback !== null) this.fallback.win(); else this.stop(3.0); }
  loss(): void { if (this.fallback !== null) this.fallback.loss(); else this.stop(3.0); }

  /* ---------------------------------------------------------------------- */
  /* Diagnostics — the F3 overlay reads these                               */
  /* ---------------------------------------------------------------------- */

  get intensity(): number { return this.fallback?.intensity ?? this.heatSmoothed; }
  get rawHeat(): number { return this.fallback?.rawHeat ?? this.heatRaw; }
  get currentLayer(): number { return this.fallback?.currentLayer ?? this.band; }
  get running(): boolean {
    if (this.fallback !== null) return this.fallback.running;
    return this.started && this.streams.some((s) => !s.el.paused);
  }

  /**
   * The sequencer counts scheduled 16ths here, which is how the overlay tells
   * a dead timer from a quiet passage. A stream has no steps, so it reports
   * the played position of the active track instead — same purpose, and a
   * frozen number still means the same thing.
   */
  get scheduledSteps(): number {
    if (this.fallback !== null) return this.fallback.scheduledSteps;
    const a = this.streams[this.band];
    return a === undefined ? -1 : Math.round(a.el.currentTime * 10);
  }

  /** True when the recorded score is what is actually playing. */
  get recorded(): boolean { return this.fallback === null && this.streams.length > 0; }
}
