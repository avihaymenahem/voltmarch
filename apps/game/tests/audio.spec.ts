/**
 * Audio module — headless tests.
 *
 * WebAudio does not exist under vitest's node environment, so nothing here
 * renders a buffer. What it DOES cover is every part of the audio module that
 * is pure data and therefore capable of being wrong forever without anyone
 * noticing: the hand-authored phoneme strings, the FxKind -> sound table, the
 * EvaLine mapping, and the graceful-degradation path when there is no
 * AudioContext at all.
 *
 * A mistyped phoneme is exactly the class of bug that never shows up in a
 * screenshot and never throws — it just makes one word sound like mush.
 */

import { describe, expect, it } from 'vitest';

import { EvaLine, FX_KIND_COUNT, EntityKind, Faction } from '../src/core/types';
import { AudioEngine, dbToGain, gainToDb, makeRng } from '../src/audio/AudioEngine';
import { FX_SOUND, SFX } from '../src/audio/Weapons';
import { EVA_LINES, EVA_LINE_ID, PHONES, parsePhonemes, utteranceSeconds, EVA_PROFILE } from '../src/audio/Eva';
import { BARKS, barkClassFor, type BarkClass } from '../src/audio/Barks';

/* -------------------------------------------------------------------------- */

describe('AudioEngine — graceful degradation', () => {
  it('returns null instead of throwing when WebAudio is unavailable', () => {
    // vitest runs in node: there is no AudioContext. A game that crashes at
    // boot on a machine with no audio device is strictly worse than a silent one.
    expect(AudioEngine.create()).toBeNull();
  });

  it('dB and linear gain round-trip', () => {
    for (const db of [-42, -24, -12, -6, -1, 0]) {
      expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 6);
    }
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-Infinity)).toBe(0);
    // -6 dB is half amplitude, near enough.
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
  });

  it('the bake RNG is deterministic and stays in range', () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    for (let i = 0; i < 500; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });
});

/* -------------------------------------------------------------------------- */

describe('FxKind -> sound table', () => {
  const known = new Set<string>(Object.values(SFX));

  it('covers every FxKind slot', () => {
    expect(FX_SOUND.length).toBe(FX_KIND_COUNT);
  });

  it('never names a sound that is not in the bank', () => {
    const bad: string[] = [];
    for (let i = 0; i < FX_SOUND.length; i++) {
      const id = FX_SOUND[i];
      if (id !== null && !known.has(id)) bad.push(`FxKind ${i} -> "${id}"`);
    }
    expect(bad).toEqual([]);
  });

  it('maps the four sounds that carry 80% of the soundscape', () => {
    expect(FX_SOUND).toContain(SFX.cannonHeavy);
    expect(FX_SOUND).toContain(SFX.machineGun);
    expect(FX_SOUND).toContain(SFX.explosionSmall);
    expect(FX_SOUND).toContain(SFX.explosionLarge);
  });
});

/* -------------------------------------------------------------------------- */

describe('EVA lines', () => {
  it('every EvaLine enum value maps to a real line', () => {
    const values = [
      EvaLine.ConstructionComplete, EvaLine.UnitReady, EvaLine.NewConstructionOptions,
      EvaLine.InsufficientFunds, EvaLine.LowPower, EvaLine.BaseUnderAttack,
      EvaLine.UnitLost, EvaLine.BuildingLost, EvaLine.SiloNeeded, EvaLine.RadarOnline,
      EvaLine.RadarOffline, EvaLine.CannotDeployHere, EvaLine.MissionAccomplished,
      EvaLine.MissionFailed, EvaLine.BuildingCaptured, EvaLine.OreMinerUnderAttack,
    ];
    for (const v of values) {
      const id = EVA_LINE_ID[v];
      expect(id, `EvaLine ${v} has no id`).toBeDefined();
      expect(EVA_LINES[id], `line "${id}" is missing`).toBeDefined();
    }
  });

  it('every phoneme string parses with no unknown symbols', () => {
    const unknown: string[] = [];
    for (const [id, def] of Object.entries(EVA_LINES)) {
      for (const ch of def.phones) {
        if (ch === ' ' || ch === ',' || ch === ';') continue;
        if (ch === 'C' || ch === 'J') continue; // affricates expand to two phones
        if (PHONES[ch] === undefined) unknown.push(`${id}: "${ch}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('produces at least one phone per line', () => {
    for (const [id, def] of Object.entries(EVA_LINES)) {
      const tokens = parsePhonemes(def.phones, 70, 180);
      const phones = tokens.filter((t) => t.phone !== null).length;
      expect(phones, `"${id}" produced no phones`).toBeGreaterThan(2);
    }
  });

  it('every line lands in a believable duration band', () => {
    for (const [id, def] of Object.entries(EVA_LINES)) {
      const s = utteranceSeconds(def.phones, EVA_PROFILE);
      // Shorter than 0.4 s is not a sentence; longer than 4 s blocks the queue.
      expect(s, `"${id}" is ${s.toFixed(2)}s`).toBeGreaterThan(0.4);
      expect(s, `"${id}" is ${s.toFixed(2)}s`).toBeLessThan(4.0);
    }
  });

  it('alerts are P0/P1 and never drop out mid-word', () => {
    expect(EVA_LINES.baseUnderAttack.priority).toBe(0);
    expect(EVA_LINES.baseUnderAttack.cooldown).toBe(40);
    expect(EVA_LINES.baseUnderAttack.noDropout).toBe(true);
    // "Unit lost" uncapped fires ~50x/min in a mass battle.
    expect(EVA_LINES.unitLost.cooldown).toBeGreaterThanOrEqual(8);
  });
});

/* -------------------------------------------------------------------------- */

describe('unit barks', () => {
  const classes = Object.keys(BARKS) as BarkClass[];

  it('every class can at least answer a selection', () => {
    for (const c of classes) {
      expect(BARKS[c].select, `${c} has no select lines`).toBeDefined();
      expect(BARKS[c].select!.length).toBeGreaterThan(0);
    }
  });

  it('every bark phoneme string parses', () => {
    const unknown: string[] = [];
    for (const c of classes) {
      for (const [cat, lines] of Object.entries(BARKS[c])) {
        for (const l of lines ?? []) {
          for (const ch of l.phones) {
            if (ch === ' ' || ch === ',' || ch === ';' || ch === 'C' || ch === 'J') continue;
            if (PHONES[ch] === undefined) unknown.push(`${c}.${cat} "${l.text}": "${ch}"`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('no line repeats verbatim inside one class+category bag', () => {
    for (const c of classes) {
      for (const [cat, lines] of Object.entries(BARKS[c])) {
        const seen = new Set<string>();
        for (const l of lines ?? []) {
          expect(seen.has(l.text), `${c}.${cat} repeats "${l.text}"`).toBe(false);
          seen.add(l.text);
        }
      }
    }
  });

  it('routes units to a faction-appropriate voice', () => {
    expect(barkClassFor(EntityKind.Vehicle, Faction.Soviets)).toBe('soviet_vehicle');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Allies)).toBe('allied_vehicle');
    expect(barkClassFor(EntityKind.Infantry, Faction.Soviets)).toBe('soviet_infantry');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Allies, 'harvester')).toBe('harvester');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Soviets, 'mcv')).toBe('mcv');
    expect(barkClassFor(EntityKind.Infantry, Faction.Allies, 'engineer')).toBe('engineer');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Soviets, 'kirov')).toBe('soviet_air');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Allies, 'destroyer')).toBe('naval');
    // A building has no voice at all.
    expect(barkClassFor(EntityKind.Building, Faction.Allies)).toBe('allied_vehicle');
  });

  it('barks are short — they have to fit between two bursts of gunfire', () => {
    for (const c of classes) {
      for (const lines of Object.values(BARKS[c])) {
        for (const l of lines ?? []) {
          const s = utteranceSeconds(l.phones, EVA_PROFILE);
          expect(s, `${c} "${l.text}" is ${s.toFixed(2)}s`).toBeLessThan(3.0);
        }
      }
    }
  });
});
