/**
 * ============================================================================
 * VOLTMARCH — tools/audio-probe.ts
 * ============================================================================
 * The browser half of the audio measurement harness.
 *
 * esbuild bundles this into an IIFE, `tools/audio-measure.mjs` injects it into a
 * headless Chromium page, and everything below then runs where
 * `OfflineAudioContext` actually exists. Node cannot render WebAudio at all, so
 * there is no way to measure the bank from vitest — this is the only honest
 * loop available, and it is the one the audio work is judged by.
 *
 * Nothing here ships. It imports the real recipes, never a copy of them.
 * ============================================================================
 */

import {
  dbToGain, hashId, makeBakeBus, makePinkNoise, makeRng, makeWhiteNoise, normalizeBuffer, rewrap,
  type BakeKit, type SoundSpec,
} from '../src/audio/AudioEngine';
import { SampleBank, sampleInto, variantDetune } from '../src/audio/Samples';
import { collectSfxBank } from '../src/audio/Weapons';
import {
  EVA_LINES, EVA_PROFILE, renderUtterance, utteranceSeconds,
} from '../src/audio/Eva';
import { BARKS, barkProfileFor, type BarkClass } from '../src/audio/Barks';
import { renderMusicOffline } from '../src/audio/Music';

const RATE = 48_000;

export interface Rendered {
  id: string;
  group: string;
  /** Peak of the RAW render, before the bake's peak-normalisation. */
  rawPeak: number;
  /** dBFS the spec claims at the bus input. */
  specDb: number;
  channels: number;
  sampleRate: number;
  /** Base64 of the interleaved Float32 samples at bus-input level. */
  pcm: string;
}

function toBase64(f: Float32Array): string {
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as number[]);
  }
  return btoa(s);
}

function interleave(buf: AudioBuffer): Float32Array {
  const ch = buf.numberOfChannels;
  if (ch === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length * ch);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) out[i * ch + c] = d[i];
  }
  return out;
}

function peakOf(buf: AudioBuffer): number {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  }
  return p;
}

function scale(buf: AudioBuffer, k: number): void {
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

/**
 * The recorded takes, decoded once for the whole run.
 *
 * WITHOUT THIS the probe measured only the synthesised recipes while the game
 * played recordings, and said nothing about it — every number in the table was
 * real, and none of them described what shipped. That is the worst failure a
 * measurement tool has, because it is indistinguishable from working.
 */
const samples = new SampleBank();

async function ensureSamples(): Promise<void> {
  if (samples.ready) return;
  // Any BaseAudioContext can decode; a one-frame offline context is the
  // cheapest one that exists.
  await samples.load(new OfflineAudioContext(1, 128, RATE));
}

/** Render one SoundSpec variant exactly the way AudioEngine.bakeOne would. */
async function renderSpec(spec: SoundSpec, variant: number): Promise<AudioBuffer> {
  const channels = spec.channels ?? 1;
  const length = Math.max(128, Math.ceil(spec.seconds * RATE));
  const oc = new OfflineAudioContext(channels, length, RATE);
  const kit: BakeKit = {
    oc,
    white: makeWhiteNoise(oc, 2, 0x51ed_c0de),
    pink: makePinkNoise(oc, 10, 0x9e37_79b9),
    out: makeBakeBus(oc, spec),
    rng: makeRng(hashId(spec.id) ^ ((variant + 1) * 0x9e3779b9)),
    variant,
  };
  // Mirrors `bakeOne`: resolved per spec, never per variant, and falling back
  // to the recipe when the family did not load.
  const takes = spec.sample !== undefined ? samples.count(spec.sample) : 0;
  const take = takes > 0 ? samples.get(spec.sample!, variant) : null;
  if (take !== null) {
    sampleInto(kit, rewrap(oc, take), spec.sampleDb ?? 0, variantDetune(variant, takes));
  } else {
    spec.render(kit);
  }
  return await oc.startRendering();
}

/** The whole one-shot bank, at the level each sound actually hits its bus. */
export async function probeBank(variant = 0): Promise<Rendered[]> {
  await ensureSamples();
  const out: Rendered[] = [];
  for (const spec of collectSfxBank()) {
    const buf = await renderSpec(spec, variant);
    const rawPeak = peakOf(buf);
    if (spec.normalize !== false) normalizeBuffer(buf, 1);
    scale(buf, dbToGain(spec.db));
    out.push({
      id: spec.id,
      group: spec.bus === 'ui' ? 'ui' : spec.category,
      rawPeak,
      specDb: spec.db,
      channels: buf.numberOfChannels,
      sampleRate: buf.sampleRate,
      pcm: toBase64(interleave(buf)),
    });
  }
  return out;
}

/** EVA lines, normalised and trimmed to the announcer's peak level. */
export async function probeEva(ids: readonly string[], peakDb: number): Promise<Rendered[]> {
  const out: Rendered[] = [];
  for (const id of ids) {
    const def = EVA_LINES[id];
    if (def === undefined) continue;
    const seconds = utteranceSeconds(def.phones, EVA_PROFILE) + 0.45;
    const oc = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
    renderUtterance(oc, def.phones, EVA_PROFILE, makeRng(hashId(id)), def.noDropout !== true);
    const buf = await oc.startRendering();
    const rawPeak = peakOf(buf);
    normalizeBuffer(buf, 1);
    scale(buf, dbToGain(peakDb));
    out.push({
      id: `eva.${id}`, group: 'eva', rawPeak, specDb: peakDb,
      channels: 1, sampleRate: RATE, pcm: toBase64(interleave(buf)),
    });
  }
  return out;
}

/** One bark per requested class, so the class voices can be compared. */
export async function probeBarks(classes: readonly string[], peakDb: number): Promise<Rendered[]> {
  const out: Rendered[] = [];
  for (const c of classes) {
    const cls = c as BarkClass;
    const l = BARKS[cls]?.select?.[0];
    if (l === undefined) continue;
    const profile = barkProfileFor(cls);
    const seconds = utteranceSeconds(l.phones, profile) + 0.4;
    const oc = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
    renderUtterance(oc, l.phones, profile, makeRng(hashId(`${cls}|${l.phones}`)), true);
    const buf = await oc.startRendering();
    const rawPeak = peakOf(buf);
    normalizeBuffer(buf, 1);
    scale(buf, dbToGain(peakDb));
    out.push({
      id: `bark.${cls}`, group: 'bark', rawPeak, specDb: peakDb,
      channels: 1, sampleRate: RATE, pcm: toBase64(interleave(buf)),
    });
  }
  return out;
}

/** The music bed, driven by the real scheduler against a virtual clock. */
export async function probeMusic(
  entries: ReadonlyArray<{ id: string; heat: number; seconds: number }>,
): Promise<Rendered[]> {
  const out: Rendered[] = [];
  for (const e of entries) {
    const oc = new OfflineAudioContext(2, Math.ceil(e.seconds * RATE), RATE);
    await renderMusicOffline(oc, e.seconds, e.heat);
    const buf = await oc.startRendering();
    out.push({
      id: `music.${e.id}`, group: 'music', rawPeak: peakOf(buf), specDb: 0,
      channels: 2, sampleRate: RATE, pcm: toBase64(interleave(buf)),
    });
  }
  return out;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmAudioProbe: {
    bank: typeof probeBank;
    eva: typeof probeEva;
    barks: typeof probeBarks;
    music: typeof probeMusic;
  };
}

globalThis.__vmAudioProbe = {
  bank: probeBank, eva: probeEva, barks: probeBarks, music: probeMusic,
};
