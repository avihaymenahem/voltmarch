/**
 * ============================================================================
 * VOLTMARCH — src/audio/Samples.ts
 * ============================================================================
 * THE SAMPLE BANK. Recorded CC0 audio, decoded once at load and fed into the
 * SAME bake path the procedural recipes use.
 *
 * WHY THIS EXISTS
 * ---------------
 * `AudioEngine.ts` opens with "ZERO AUDIO FILES", and for the first year that
 * was the whole aesthetic. It was also the ceiling. A synthesised report can be
 * measured correct — `tools/audio-measure.mjs` scored the bank at 8-24 dB crest
 * with spectra in band — and still read as a synth patch, because what a real
 * recording carries is chaotic micro-detail that an oscillator plus a filtered
 * noise burst does not reproduce at any parameter setting. Measurement said the
 * recipes were not broken; the ear said the approach was out of headroom. Both
 * were right.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT a second playback path. A sample lands in the identical place a
 * recipe's output does — through `kit.out`, so it gets the same bake-time
 * saturation, the same peak normalisation, the same variant set — and at
 * runtime it is the same `BufferSource -> gain -> panner -> bus`. The mixer,
 * the two reverb rooms, crowd summation, the voice budget and the distance
 * model are untouched. Only the SOURCE of the buffer changed.
 *
 * THE FALLBACK IS LOAD-BEARING
 * ----------------------------
 * Every sample-backed spec KEEPS its `render` recipe. If a file 404s, if the
 * player is offline, if `decodeAudioData` rejects a container the browser
 * dislikes — the recipe runs and the game has sound. A missing sample must
 * degrade to the old bank, never to silence. `bakeOne` implements exactly that,
 * and `SampleBank.stats` reports what actually loaded so a failure is visible
 * in the F3 overlay rather than mysterious.
 *
 * VARIANTS
 * --------
 * A recipe's variants come from a seeded RNG, so six bakes are six genuinely
 * different renders. A sample family's variants come from DIFFERENT TAKES, and
 * there are only as many takes as files on disk. When a spec asks for more
 * variants than the family has files, the surplus wrap around to the same file
 * and would be bit-identical — so they are detuned by a deterministic per-
 * variant amount instead. That keeps the repeat period long, which is the one
 * property a firefight actually tests.
 *
 * PROVENANCE. See `public/audio/README.md`. Everything here is CC0.
 * ============================================================================
 */

// TYPE-ONLY, deliberately. `AudioEngine.ts` imports this module to bake, so a
// runtime import back would close a cycle; the two helpers it would buy are
// four lines, and four lines is cheaper than a load-order hazard.
import type { BakeKit } from './AudioEngine';

/* ==========================================================================
 * 1. THE MANIFEST
 *
 * id -> how many takes exist on disk as `audio/sfx/<id>.<n>.ogg`.
 *
 * This is a hand-maintained table rather than a directory listing because the
 * build has no filesystem at runtime and a wrong count is a 404, which the
 * loader reports. `tests/audio-samples.spec.ts` checks every entry against what
 * is actually in `public/`, so the table cannot drift from the files.
 * ========================================================================== */

export const SAMPLE_MANIFEST: Readonly<Record<string, number>> = {
  /* -- interface: Kenney "Interface Sounds" (CC0) -- */
  'ui.click': 3,
  'ui.tab': 3,
  'ui.hover': 2,
  'ui.chime': 2,
  'ui.ready': 2,
  'ui.ghost': 2,
  'ui.error': 3,
  'ui.ping': 2,
  'ui.tick': 2,
  'ui.thunk': 3,
  'ui.sell': 2,

  /* -- weapons: CC0 bang set, Warfork (Team Forbidden), CC0 sci-fi set -- */
  'cannon.light': 3,
  'cannon.heavy': 2,
  'mg.round': 3,
  'flak.round': 3,
  'artillery.fire': 3,
  'rocket.launch': 2,
  'tesla.charge': 3,
  'tesla.discharge': 4,
  'prism.fire': 3,
  'flame.jet': 3,

  /* -- explosions -- */
  'explosion.small': 3,
  'explosion.medium': 5,
  'explosion.large': 3,

  /* -- impacts and debris -- */
  'impact.armor': 2,
  'impact.dirt': 3,
  'impact.concrete': 5,
  'impact.water': 4,
  'debris.grain': 8,
  'shell.casing': 4,
  'spark.repair': 4,

  /* -- gameplay -- */
  'dog.bark': 4,
  'crush.squish': 2,
  'death.infantry': 3,
  'build.rise': 2,
  'sell.puff': 2,
  'ore.dump': 3,

  /* -- engine beds. The ONLY entries played as loops: the loop voice sets
   * `loop = true` on the baked buffer, so these must be seamlessly-looping
   * recordings and must never be trimmed the way the one-shots are. -- */
  'engine.light': 1,
  'engine.heavy': 1,
};

/**
 * EVERY SFX FAMILY IS RECORDED. There is no longer a sound in the bank that
 * plays a synthesised recipe by default.
 *
 * The recipes are all still there, and they still run whenever a take fails to
 * load — that fallback is the reason `render` stays required on every spec. But
 * nothing reaches a player's ears from an oscillator any more.
 *
 * WHY THIS OVERRODE THE MEASUREMENT. An earlier pass reverted twelve families
 * to their recipes because the takes scored worse on centroid or attack time,
 * and the user's verdict on hearing the result was that the synthesised sounds
 * were the problem in every case. That is the correct authority: the harness
 * scores a spectrum, and a spectrum is a proxy for "does this sound like the
 * thing". Where the two disagree, the ear is not the approximation.
 *
 * What the measurement is still good for is catching the failures nobody can
 * hear until it is too late — a take longer than the buffer it bakes into, a
 * transient that never arrives, a level that clips the bus. Those checks stayed
 * and are what `tests/audio-samples.spec.ts` enforces.
 *
 * TWO THINGS THAT MUST NOT BE UNDONE:
 *
 *  - Takes are trimmed to length on an Ogg PAGE boundary, which lands
 *    mid-waveform. `sampleInto` fades the last 20 ms unconditionally for
 *    exactly this reason. Remove the fade and the whole bank clicks.
 *  - `engine.light` and `engine.heavy` are looped, not fired. They are designed
 *    loops and were deliberately NOT trimmed; cutting them puts a seam in the
 *    loop that repeats forever while a vehicle is on screen.
 */

/**
 * Recorded unit voices, keyed `<voice>.<barkCategory>`.
 *
 * Keyed by VOICE and not by unit class on purpose. There are twelve bark
 * classes and two recorded voices, so a per-class layout would ship the same
 * two takes twelve times over — 400 files to say twenty things. The class ->
 * voice mapping lives in `Barks.ts`, where the classes are defined.
 *
 * Kenney's Voiceover Pack, CC0, male and female.
 */
export const VOICE_MANIFEST: Readonly<Record<string, number>> = {
  'm.select': 3, 'm.move': 2, 'm.attack': 3, 'm.deploy': 2,
  'm.capture': 2, 'm.underFire': 3, 'm.cargoFull': 2,
  'f.select': 3, 'f.move': 2, 'f.attack': 3, 'f.deploy': 2,
  'f.capture': 2, 'f.underFire': 3, 'f.cargoFull': 2,
};

/**
 * The EVA announcer, one take per line, keyed by the same string `EVA_LINES`
 * uses. Rendered offline by `tools/render-eva.py` with Piper and the
 * `en_GB-cori-high` voice — LibriVox source audio, public domain, model trained
 * from scratch. See `public/audio/README.md` for why that specific voice and
 * not one of the popular ones.
 *
 * These are the only lines in the game that had to be MADE rather than found:
 * no CC0 pack contains "Insufficient funds."
 */
export const EVA_MANIFEST: Readonly<Record<string, number>> = {
  allyUnderAttack: 1,
  baseUnderAttack: 1, battleControlOnline: 1, battleControlTerminated: 1,
  building: 1, buildingCaptured: 1, cannotBuildHere: 1, cannotDeployHere: 1,
  constructionComplete: 1, forcesUnderAttack: 1, incomingMissile: 1,
  insufficientFunds: 1, lowPower: 1, missionAccomplished: 1, missionFailed: 1,
  newConstructionOptions: 1, newRallyPoint: 1, nuclearMissileLaunched: 1,
  oreMinerUnderAttack: 1, primaryBuildingSelected: 1, radarOffline: 1,
  radarOnline: 1, reinforcements: 1, repairing: 1, silosNeeded: 1,
  structureLost: 1, structureSold: 1, superweaponReady: 1, trainingComplete: 1,
  unitLost: 1, unitReady: 1,
};

/** Where the files live, relative to the document. `vite.config.ts` sets `base: './'`. */
const SAMPLE_DIR = 'audio/sfx';
const VOICE_DIR = 'audio/voice';
const EVA_DIR = 'audio/eva';

/** Path for one take. Exported so the spec can check the files exist. */
export function samplePath(id: string, take: number): string {
  return `${SAMPLE_DIR}/${id}.${take}.ogg`;
}

/** Path for one recorded voice take. */
export function voicePath(id: string, take: number): string {
  return `${VOICE_DIR}/${id}.${take}.ogg`;
}

/**
 * Path for one EVA line. The take index is ignored: there is exactly one
 * rendering of each line, because a variant of "Silos needed" is not a thing
 * anyone wants. Kept in the same shape so `SampleBank` can load it unchanged.
 */
export function evaPath(id: string, _take: number): string {
  return `${EVA_DIR}/${id}.ogg`;
}

/**
 * Cents of detune applied to variant `v` of a family with `takes` files.
 *
 * Zero while there are still unheard takes — a real second take is always
 * better than a pitch-shifted first one. Past that, alternate slightly sharp
 * and flat in widening steps, which is enough to stop the wrap-around from
 * being audible as a loop without making a metal impact sound like a different
 * material.
 */
export function variantDetune(v: number, takes: number): number {
  if (takes <= 0 || v < takes) return 0;
  const lap = Math.floor(v / takes);
  const dir = v % 2 === 0 ? 1 : -1;
  return dir * (22 + lap * 14);
}

/* ==========================================================================
 * 2. THE BANK
 * ========================================================================== */

export interface SampleStats {
  /** Files the manifest asked for. */
  requested: number;
  /** Files decoded into a usable buffer. */
  loaded: number;
  /** Families with at least one usable take. */
  families: number;
  /** Total decoded PCM held resident, in bytes. */
  bytes: number;
  /** Wall-clock spent fetching and decoding, in ms. */
  ms: number;
  /** ids that asked for samples and got none — these fall back to a recipe. */
  missing: string[];
}

export class SampleBank {
  /** id -> decoded takes, in manifest order. Short by one on a partial failure. */
  private readonly takes = new Map<string, AudioBuffer[]>();

  /**
   * Parameterised over its manifest and its path builder so the recorded unit
   * voices reuse this loader instead of copying it. Everything below — the
   * per-file failure absorption, the index-preserving slotting, the stats —
   * is identical for both banks, and a second copy would be a second place for
   * the ordering guarantee to rot.
   */
  constructor(
    private readonly manifest: Readonly<Record<string, number>> = SAMPLE_MANIFEST,
    private readonly pathOf: (id: string, take: number) => string = samplePath,
  ) {}

  readonly stats: SampleStats = {
    requested: 0, loaded: 0, families: 0, bytes: 0, ms: 0, missing: [],
  };

  /** True once `load` has run, whatever the outcome. */
  private done = false;

  get ready(): boolean { return this.done; }

  /** How many usable takes exist for `id`. 0 means "use the recipe". */
  count(id: string): number {
    return this.takes.get(id)?.length ?? 0;
  }

  has(id: string): boolean { return this.count(id) > 0; }

  /** Take `i` of `id`, wrapping. Null when the family failed to load. */
  get(id: string, i: number): AudioBuffer | null {
    const list = this.takes.get(id);
    if (list === undefined || list.length === 0) return null;
    return list[((i % list.length) + list.length) % list.length];
  }

  /**
   * Fetch and decode the whole manifest.
   *
   * Every file is independent, so they go out at once and a rejection is
   * absorbed per-file rather than failing the batch — one bad container must
   * not cost the other 57 sounds. Resolves when the last one has settled;
   * `bakeAll` runs after, so the bake sees a complete bank or a partial one,
   * never a racing one.
   *
   * `baseUrl` exists for the measurement harness, which serves `public/` from a
   * temporary origin. In the game it is left at the document-relative default.
   */
  async load(ctx: BaseAudioContext, baseUrl = ''): Promise<void> {
    if (this.done) return;
    this.done = true;
    if (typeof fetch !== 'function') return;

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const ids = Object.keys(this.manifest);

    const jobs: Array<Promise<{ id: string; take: number; buf: AudioBuffer | null }>> = [];
    for (const id of ids) {
      const n = this.manifest[id];
      this.stats.requested += n;
      for (let take = 0; take < n; take++) {
        jobs.push(this.loadOne(ctx, baseUrl + this.pathOf(id, take), id, take));
      }
    }

    // Order matters: take 0 must stay take 0 so a bake is reproducible across
    // reloads. `Promise.all` preserves it; the results are then slotted by
    // index rather than pushed in completion order.
    const slots = new Map<string, Array<AudioBuffer | null>>();
    for (const id of ids) slots.set(id, new Array<AudioBuffer | null>(this.manifest[id]).fill(null));
    for (const r of await Promise.all(jobs)) {
      if (r.buf !== null) slots.get(r.id)![r.take] = r.buf;
    }

    for (const id of ids) {
      const usable = slots.get(id)!.filter((b): b is AudioBuffer => b !== null);
      if (usable.length === 0) { this.stats.missing.push(id); continue; }
      this.takes.set(id, usable);
      this.stats.families++;
      this.stats.loaded += usable.length;
      for (const b of usable) this.stats.bytes += b.length * b.numberOfChannels * 4;
    }

    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.stats.ms = t1 - t0;
    if (this.stats.missing.length > 0) {
      console.warn(
        `[audio] ${this.stats.missing.length} sample famil(y/ies) unavailable, `
        + `falling back to the synthesised recipe: ${this.stats.missing.join(', ')}`,
      );
    }
  }

  private async loadOne(
    ctx: BaseAudioContext, url: string, id: string, take: number,
  ): Promise<{ id: string; take: number; buf: AudioBuffer | null }> {
    try {
      const res = await fetch(url);
      if (!res.ok) return { id, take, buf: null };
      const bytes = await res.arrayBuffer();
      // `decodeAudioData` resamples to the context rate, so every take arrives
      // at `ctx.sampleRate` and `rewrap`'s fast path applies in the bake.
      const buf = await ctx.decodeAudioData(bytes);
      return { id, take, buf };
    } catch {
      return { id, take, buf: null };
    }
  }
}

/* ==========================================================================
 * 3. THE BAKE-SIDE HELPER
 * ========================================================================== */

/**
 * Play a decoded take into the recipe bus, so a sample is just another layer.
 *
 * `db` trims the take before the shared saturator. It exists because the packs
 * are internally consistent but not consistent WITH each other — Kenney's
 * interface set sits noticeably hotter than the impact set — and the bake's
 * peak normalisation runs after the saturator, so an untrimmed hot take drives
 * the curve harder and comes out a different shape, not just louder.
 */
export function sampleInto(
  kit: BakeKit, buf: AudioBuffer, db = 0, detuneCents = 0,
): void {
  const src = kit.oc.createBufferSource();
  src.buffer = buf;
  if (detuneCents !== 0) {
    // `detune` is not implemented on AudioBufferSourceNode everywhere; the
    // equivalent rate change always is.
    src.playbackRate.value = Math.pow(2, detuneCents / 1200);
  }
  const g = kit.oc.createGain();
  const level = db <= -200 ? 0 : Math.pow(10, db / 20);
  g.gain.value = level;

  /*
   * ALWAYS fade the last few milliseconds.
   *
   * Takes are trimmed to length on an Ogg page boundary, which lands wherever
   * the encoder happened to close a page — usually mid-waveform. Playing that
   * buffer means stepping from full amplitude to zero in one sample, and a step
   * discontinuity is a click with energy across the entire spectrum. It is the
   * single most audible artefact available and it survives every downstream
   * stage: the saturator hardens it, and the reverb send smears a copy of it
   * into the room.
   *
   * On a take with a natural decay this ramp does nothing, because the signal
   * is already near zero there. It costs one gain node and removes a whole
   * class of defect, so it is unconditional rather than a flag someone has to
   * remember to set.
   */
  const end = buf.duration / (src.playbackRate.value || 1);
  const fade = Math.min(0.02, end * 0.25);
  if (end > fade * 2) {
    g.gain.setValueAtTime(level, end - fade);
    g.gain.linearRampToValueAtTime(0, end);
  }

  src.connect(g).connect(kit.out);
  src.start(0);
}
