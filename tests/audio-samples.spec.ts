/**
 * ============================================================================
 * tests/audio-samples.spec.ts — the recorded bank must match what ships
 * ============================================================================
 * `SAMPLE_MANIFEST` is a hand-maintained table of how many takes each sound
 * has on disk, because the bundle has no filesystem at runtime. A hand table
 * against a directory of 58 files is a drift defect waiting to happen, and the
 * failure is asymmetric and quiet in both directions:
 *
 *   manifest says MORE than exists  -> a 404 per missing take, absorbed by the
 *                                      loader, and the sound silently falls
 *                                      back to its synthesised recipe. Nothing
 *                                      breaks; the work just does not land.
 *   manifest says FEWER than exists -> the surplus files ship, are downloaded
 *                                      by every player, and are never decoded.
 *
 * So this checks both directions.
 *
 * THE THIRD CHECK IS THE ONE THAT ALREADY PAID.
 * `bakeOne` renders into a buffer of exactly `spec.seconds`, and the header on
 * `SoundSpec.seconds` says outright that anything past it is truncated. When
 * the recorded families first landed, EIGHT of seventeen were longer than the
 * seconds their spec allocated — `ui.tab` at 0.618 s against 0.12 s, so five
 * sixths of the file would have been cut off. It would have shipped as "the new
 * UI sounds are clipped", with nothing in the bank measurement pointing at the
 * cause, because a truncated buffer measures as a perfectly healthy short one.
 * Durations are re-derived from the actual Ogg files here so the next person to
 * swap in a longer take is told, rather than finding out by ear.
 * ============================================================================
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EVA_MANIFEST, SAMPLE_MANIFEST, VOICE_MANIFEST,
  evaPath, samplePath, variantDetune, voicePath,
} from '../src/audio/Samples';
import { EVA_LINES } from '../src/audio/Eva';
import { collectSfxBank } from '../src/audio/Weapons';

const PUBLIC = join(import.meta.dirname, '..', 'public');
const SFX_DIR = join(PUBLIC, 'audio', 'sfx');

/**
 * Duration of an Ogg stream, from the granule position of its last page.
 *
 * Vorbis granule position IS the sample count, so the final page's value over
 * the sample rate is the length. Parsing 27-byte page headers is far less code
 * than decoding Vorbis, and it needs no dependency and no browser — the point
 * is a number that `vitest` can assert against in Node.
 */
function oggDuration(buf: Buffer): number {
  let rate = 0;
  let last = 0n;
  let off = 0;
  const VORBIS_ID = Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
  while (off + 27 <= buf.length) {
    if (buf.toString('latin1', off, off + 4) !== 'OggS') break;
    const nseg = buf[off + 26];
    const segTable = off + 27;
    if (segTable + nseg > buf.length) break;
    let body = 0;
    for (let i = 0; i < nseg; i++) body += buf[segTable + i];
    const dataOff = segTable + nseg;
    last = buf.readBigUInt64LE(off + 6);
    if (rate === 0) {
      const idx = buf.indexOf(VORBIS_ID, dataOff);
      // The identification header is: magic(7) version(4) channels(1) rate(4).
      if (idx >= 0 && idx < dataOff + body) rate = buf.readUInt32LE(idx + 12);
    }
    off = dataOff + body;
  }
  return rate > 0 ? Number(last) / rate : 0;
}

const bank = collectSfxBank();
const manifestIds = Object.keys(SAMPLE_MANIFEST);

describe('the recorded sample bank', () => {
  it('ships every take the manifest promises', () => {
    const missing: string[] = [];
    for (const id of manifestIds) {
      for (let take = 0; take < SAMPLE_MANIFEST[id]; take++) {
        const p = join(PUBLIC, samplePath(id, take));
        if (!existsSync(p)) missing.push(samplePath(id, take));
      }
    }
    expect(
      missing,
      'the manifest promises takes that are not in public/ — each is a 404 at load '
      + 'and a silent fallback to the synthesised recipe',
    ).toEqual([]);
  });

  it('ships no take the manifest does not know about', () => {
    if (!existsSync(SFX_DIR)) return;
    const declared = new Set<string>();
    for (const id of manifestIds) {
      for (let take = 0; take < SAMPLE_MANIFEST[id]; take++) declared.add(`${id}.${take}.ogg`);
    }
    const orphans = readdirSync(SFX_DIR).filter((f) => f.endsWith('.ogg') && !declared.has(f));
    expect(
      orphans,
      'files in public/audio/sfx that no manifest entry names — every player downloads '
      + 'them and nothing ever decodes them',
    ).toEqual([]);
  });

  it('allocates enough seconds to hold the longest take, uncut', () => {
    // The defect this file was written for. See the header.
    const truncated: string[] = [];
    for (const spec of bank) {
      if (spec.sample === undefined) continue;
      const takes = SAMPLE_MANIFEST[spec.sample] ?? 0;
      let longest = 0;
      for (let t = 0; t < takes; t++) {
        const p = join(PUBLIC, samplePath(spec.sample, t));
        if (!existsSync(p)) continue;
        longest = Math.max(longest, oggDuration(readFileSync(p)));
      }
      if (longest > 0 && spec.seconds < longest) {
        truncated.push(`${spec.id}: seconds=${spec.seconds} < longest take ${longest.toFixed(3)}s`);
      }
    }
    expect(
      truncated,
      'a recorded take is longer than the buffer its spec bakes into, so it will be cut off',
    ).toEqual([]);
  });

  it('bakes enough variants to reach every take that ships', () => {
    // Fewer variants than takes means files ship that no bake ever reads —
    // the same dead weight as an orphan, just harder to see.
    const wasted: string[] = [];
    for (const spec of bank) {
      if (spec.sample === undefined) continue;
      const takes = SAMPLE_MANIFEST[spec.sample] ?? 0;
      if (spec.variants < takes) wasted.push(`${spec.id}: ${spec.variants} variants < ${takes} takes`);
    }
    expect(wasted, 'takes ship that no variant ever bakes').toEqual([]);
  });

  it('every spec that names a sample family names one that exists', () => {
    const unknown = bank
      .filter((s) => s.sample !== undefined && !(s.sample in SAMPLE_MANIFEST))
      .map((s) => `${s.id} -> ${s.sample!}`);
    expect(unknown, 'a spec points at a sample family the manifest does not define').toEqual([]);
  });

  it('keeps the synthesised recipe as a fallback on every sample-backed sound', () => {
    // The whole degradation story. A sound with samples but no recipe goes
    // SILENT when a file fails to load, and silence is the one failure mode
    // nobody notices in a playtest until it matters.
    for (const spec of bank) {
      if (spec.sample === undefined) continue;
      expect(typeof spec.render, `${spec.id} has samples but no fallback recipe`).toBe('function');
    }
  });
});

describe('the recorded voice bank', () => {
  const VOICE_DIR = join(PUBLIC, 'audio', 'voice');
  const voiceIds = Object.keys(VOICE_MANIFEST);

  it('ships every take the voice manifest promises', () => {
    const missing: string[] = [];
    for (const id of voiceIds) {
      for (let t = 0; t < VOICE_MANIFEST[id]; t++) {
        if (!existsSync(join(PUBLIC, voicePath(id, t)))) missing.push(voicePath(id, t));
      }
    }
    expect(missing, 'the voice manifest promises takes that are not in public/').toEqual([]);
  });

  it('ships no voice take the manifest does not know about', () => {
    if (!existsSync(VOICE_DIR)) return;
    const declared = new Set<string>();
    for (const id of voiceIds) {
      for (let t = 0; t < VOICE_MANIFEST[id]; t++) declared.add(`${id}.${t}.ogg`);
    }
    const orphans = readdirSync(VOICE_DIR).filter((f) => f.endsWith('.ogg') && !declared.has(f));
    expect(orphans, 'voice files nothing references').toEqual([]);
  });

  it('covers every bark category in both voices', () => {
    // A category missing from one voice means half the army silently falls
    // back to the formant synth for that order, which is exactly the sort of
    // partial migration that reads as "some units sound broken".
    const CATS = ['select', 'move', 'attack', 'deploy', 'capture', 'underFire', 'cargoFull'];
    const gaps: string[] = [];
    for (const v of ['m', 'f']) {
      for (const c of CATS) if (!(`${v}.${c}` in VOICE_MANIFEST)) gaps.push(`${v}.${c}`);
    }
    expect(gaps, 'a bark category has no recorded line in one of the voices').toEqual([]);
  });

  it('keeps every voice line short enough to fit between two orders', () => {
    // A bark holds the `speaking` latch for its whole duration and ducks the
    // music under it. Anything long stops the next order acknowledging.
    const tooLong: string[] = [];
    for (const id of voiceIds) {
      for (let t = 0; t < VOICE_MANIFEST[id]; t++) {
        const p = join(PUBLIC, voicePath(id, t));
        if (!existsSync(p)) continue;
        const d = oggDuration(readFileSync(p));
        if (d > 2.0) tooLong.push(`${id}.${t}: ${d.toFixed(2)}s`);
      }
    }
    expect(tooLong, 'a recorded bark runs longer than 2 s').toEqual([]);
  });
});

describe('the rendered EVA announcer', () => {
  const EVA_DIR = join(PUBLIC, 'audio', 'eva');
  const evaIds = Object.keys(EVA_MANIFEST);

  it('has a rendered line for every line the game can dispatch', () => {
    // THE defect this repo keeps hitting: two tables that must agree and
    // nothing checking that they do. `EVA_LINES` is what `say()` looks up;
    // EVA_MANIFEST is what actually got rendered. A key in the first and not
    // the second is a line that silently falls back to the formant synth.
    const missing = Object.keys(EVA_LINES).filter((k) => !(k in EVA_MANIFEST));
    expect(missing, 'EVA lines with no rendered audio').toEqual([]);
  });

  it('renders nothing the game cannot dispatch', () => {
    const orphans = evaIds.filter((k) => !(k in EVA_LINES));
    expect(orphans, 'rendered audio for a line that no longer exists').toEqual([]);
  });

  it('ships the file for every manifest entry', () => {
    const missing = evaIds.filter((id) => !existsSync(join(PUBLIC, evaPath(id, 0))));
    expect(missing, 'EVA manifest entries with no file in public/').toEqual([]);
  });

  it('ships no EVA file the manifest does not name', () => {
    if (!existsSync(EVA_DIR)) return;
    const declared = new Set(evaIds.map((id) => `${id}.ogg`));
    const orphans = readdirSync(EVA_DIR).filter((f) => f.endsWith('.ogg') && !declared.has(f));
    expect(orphans, 'EVA files nothing references').toEqual([]);
  });

  it('keeps every line inside the announcer duration band', () => {
    // `audio.spec.ts` already asserts the SYNTHESISED lines land in a
    // believable band. The rendered ones have to as well, or a line that runs
    // long holds the announcer latch through the event it was reporting.
    const bad: string[] = [];
    for (const id of evaIds) {
      const p = join(PUBLIC, evaPath(id, 0));
      if (!existsSync(p)) continue;
      const d = oggDuration(readFileSync(p));
      if (d < 0.4 || d > 3.0) bad.push(`${id}: ${d.toFixed(2)}s`);
    }
    expect(bad, 'a rendered EVA line is implausibly short or long').toEqual([]);
  });
});

describe('variant detune', () => {
  it('leaves real takes alone', () => {
    // A genuine second take always beats a pitch-shifted first one, so nothing
    // is shifted while unheard files remain.
    for (let v = 0; v < 6; v++) expect(variantDetune(v, 6), `variant ${v}`).toBe(0);
  });

  it('only shifts once the takes have run out, and never repeats a shift', () => {
    const seen = new Set<number>();
    for (let v = 3; v < 12; v++) {
      const d = variantDetune(v, 3);
      expect(d, `variant ${v} wrapped onto an earlier take and must be detuned`).not.toBe(0);
      // Two variants landing on the SAME take with the SAME detune are
      // bit-identical bakes, which is exactly the repeat this exists to avoid.
      const key = (v % 3) * 10_000 + d;
      expect(seen.has(key), `variant ${v} duplicates an earlier bake exactly`).toBe(false);
      seen.add(key);
    }
  });

  it('stays inside a semitone and a half, so a metal impact stays metal', () => {
    for (let v = 0; v < 40; v++) {
      expect(Math.abs(variantDetune(v, 4))).toBeLessThanOrEqual(150);
    }
  });

  it('is defined for a family with no takes', () => {
    expect(variantDetune(3, 0)).toBe(0);
  });
});
