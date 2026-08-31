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

import { describe, expect, it, vi } from 'vitest';

import { EvaLine, FX_KIND_COUNT, EntityKind, Faction } from '../src/core/types';
import { AudioEngine, dbToGain, gainToDb, makeRng } from '../src/audio/AudioEngine';
import { collectSfxBank, FX_SOUND, SFX } from '../src/audio/Weapons';
import { EVA_LINES, EVA_LINE_ID, PHONES, parsePhonemes, utteranceSeconds, EVA_PROFILE } from '../src/audio/Eva';
import { BARKS, barkClassFor, recordedVoiceKeyFor, type BarkClass } from '../src/audio/Barks';

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

  it('accepts a registered first-use event while its sound is still baking', () => {
    const spec = collectSfxBank()[0];
    const ensureBaked = vi.fn(() => new Promise<boolean>(() => {}));
    const fake = Object.assign(Object.create(AudioEngine.prototype) as object, {
      muted: false,
      disposed: false,
      ctx: { state: 'running', currentTime: 10 },
      sounds: new Map(),
      registered: new Map([[spec.id, spec]]),
      deferredPlays: new Map(),
      deferredPlayCount: 0,
      ensureBaked,
      stats: { deferredAccepted: 0, deferredOverflow: 0 },
    }) as unknown as AudioEngine;

    expect(fake.play(spec.id, 4, 0, 8, { gain: 0.5, delay: 0.2 })).toBe(true);

    const state = fake as unknown as {
      deferredPlayCount: number;
      deferredPlays: Map<string, Array<{ dueAt: number; options?: { gain?: number } }>>;
    };
    expect(state.deferredPlayCount).toBe(1);
    expect(state.deferredPlays.get(spec.id)?.[0]).toEqual(expect.objectContaining({ dueAt: 10.2 }));
    expect(state.deferredPlays.get(spec.id)?.[0]?.options?.gain).toBe(0.5);
    expect(ensureBaked).toHaveBeenCalledTimes(1);
  });

  it('keeps registration idempotent while a background bake is in flight', () => {
    const spec = collectSfxBank()[0];
    const fake = Object.assign(Object.create(AudioEngine.prototype) as object, {
      sounds: new Map(), registered: new Map(), pending: [],
    }) as unknown as AudioEngine;

    fake.register(spec);
    fake.register(spec);

    const state = fake as unknown as {
      registered: Map<string, unknown>;
      pending: unknown[];
    };
    expect(state.registered.size).toBe(1);
    expect(state.pending).toHaveLength(1);
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
      EvaLine.NoOreMiner, EvaLine.Reinforcements, EvaLine.HarvesterIdle,
      EvaLine.Building, EvaLine.Repairing, EvaLine.PrimaryBuildingSelected,
      EvaLine.NewRallyPoint, EvaLine.SuperweaponReady, EvaLine.NuclearMissileLaunched,
      EvaLine.BattleControlTerminated, EvaLine.AllyUnderAttack,
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
    expect(barkClassFor(EntityKind.Infantry, Faction.Soviets, 'flakTrooper')).toBe('soviet_infantry_f');
    expect(barkClassFor(EntityKind.Infantry, Faction.Soviets, 'navalInfantry')).toBe('soviet_infantry_f');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Allies, 'harvester')).toBe('allied_harvester');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Soviets, 'harvester')).toBe('soviet_harvester');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Meridian, 'sunCollector')).toBe('meridian_harvester');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Soviets, 'mcv')).toBe('soviet_builder');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Allies, 'mcv')).toBe('allied_builder');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Meridian, 'dozer')).toBe('meridian_builder');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Reclaim, 'constructionCrawler')).toBe('reclaim_builder');
    expect(barkClassFor(EntityKind.Infantry, Faction.Allies, 'engineer')).toBe('allied_specialist');
    expect(barkClassFor(EntityKind.Infantry, Faction.Soviets, 'engineer')).toBe('soviet_specialist');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Soviets, 'kirov')).toBe('soviet_air');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Allies, 'destroyer')).toBe('naval');
    expect(barkClassFor(EntityKind.Infantry, Faction.Meridian, 'mrdVotary')).toBe('meridian_infantry');
    expect(barkClassFor(EntityKind.Infantry, Faction.Meridian, 'mrdSunlancer')).toBe('meridian_infantry_f');
    expect(barkClassFor(EntityKind.Infantry, Faction.Meridian, 'mrdTidewalker')).toBe('meridian_infantry_f');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Meridian, 'mrdKestrel')).toBe('meridian_air');
    expect(barkClassFor(EntityKind.Infantry, Faction.Meridian, 'mrdArtificer')).toBe('meridian_specialist');
    expect(barkClassFor(EntityKind.Infantry, Faction.Reclaim, 'rclTinker')).toBe('reclaim_specialist');
    expect(barkClassFor(EntityKind.Infantry, Faction.Reclaim, 'rclPicker')).toBe('reclaim_infantry');
    expect(barkClassFor(EntityKind.Infantry, Faction.Reclaim, 'rclSlagger')).toBe('reclaim_infantry_f');
    expect(barkClassFor(EntityKind.Infantry, Faction.Reclaim, 'rclDredger')).toBe('reclaim_infantry_f');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Reclaim, 'rclScrapper')).toBe('reclaim_harvester');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Reclaim, 'rclHornet')).toBe('reclaim_air');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Allies, 'landingCraft')).toBe('allied_transport');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Soviets, 'assaultBarge')).toBe('soviet_transport');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Meridian, 'mrdArgosy')).toBe('meridian_transport');
    expect(barkClassFor(EntityKind.Vehicle, Faction.Reclaim, 'rclSlagHauler')).toBe('reclaim_transport');
    expect(barkClassFor(EntityKind.Infantry, Faction.Soviets, 'commissar')).toBe('commander');
    // A building has no voice at all.
    expect(barkClassFor(EntityKind.Building, Faction.Allies)).toBe('allied_vehicle');
  });

  it('routes Allied armour to its exact faction pack without stealing logistics voices', () => {
    expect(recordedVoiceKeyFor('allied_infantry', 'select')).toBe('al-inf-a.select');
    expect(recordedVoiceKeyFor('allied_infantry', 'deploy')).toBe('al-inf-a.deploy');
    expect(recordedVoiceKeyFor('allied_infantry', 'capture')).toBe('m.capture');
    expect(recordedVoiceKeyFor('allied_infantry_f', 'select')).toBe('al-inf-b.select');
    expect(recordedVoiceKeyFor('allied_infantry_f', 'deploy')).toBe('al-inf-b.deploy');
    expect(recordedVoiceKeyFor('allied_vehicle', 'select')).toBe('al-arm.select');
    expect(recordedVoiceKeyFor('allied_vehicle', 'underFire')).toBe('al-arm.underFire');
    expect(recordedVoiceKeyFor('allied_vehicle', 'deploy')).toBe('m.deploy');
    expect(recordedVoiceKeyFor('harvester', 'select')).toBe('f.select');
    expect(recordedVoiceKeyFor('allied_harvester', 'select')).toBe('al-harv.select');
    expect(recordedVoiceKeyFor('soviet_harvester', 'select')).toBe('sv-harv.select');
    expect(recordedVoiceKeyFor('soviet_harvester', 'harvest')).toBe('sv-harv.harvest');
    expect(recordedVoiceKeyFor('meridian_harvester', 'select')).toBe('mr-harv.select');
    expect(recordedVoiceKeyFor('meridian_harvester', 'harvest')).toBe('mr-harv.harvest');
    expect(recordedVoiceKeyFor('reclaim_harvester', 'select')).toBe('rc-harv.select');
    expect(recordedVoiceKeyFor('reclaim_harvester', 'harvest')).toBe('rc-harv.harvest');
    expect(recordedVoiceKeyFor('allied_builder', 'select')).toBe('al-build.select');
    expect(recordedVoiceKeyFor('allied_builder', 'deploy')).toBe('al-build.deploy');
    expect(recordedVoiceKeyFor('soviet_builder', 'select')).toBe('sv-build.select');
    expect(recordedVoiceKeyFor('soviet_builder', 'deploy')).toBe('sv-build.deploy');
    expect(recordedVoiceKeyFor('meridian_builder', 'select')).toBe('mr-build.select');
    expect(recordedVoiceKeyFor('meridian_builder', 'deploy')).toBe('mr-build.deploy');
    expect(recordedVoiceKeyFor('reclaim_builder', 'select')).toBe('rc-build.select');
    expect(recordedVoiceKeyFor('reclaim_builder', 'deploy')).toBe('rc-build.deploy');
    expect(recordedVoiceKeyFor('allied_specialist', 'capture')).toBe('al-spec.capture');
    expect(recordedVoiceKeyFor('soviet_specialist', 'repair')).toBe('sv-spec.repair');
    expect(recordedVoiceKeyFor('meridian_specialist', 'select')).toBe('mr-spec.select');
    expect(recordedVoiceKeyFor('reclaim_specialist', 'stop')).toBe('rc-spec.stop');
    expect(recordedVoiceKeyFor('allied_transport', 'unload')).toBe('al-trans.unload');
    expect(recordedVoiceKeyFor('soviet_transport', 'guard')).toBe('sv-trans.guard');
    expect(recordedVoiceKeyFor('meridian_transport', 'patrol')).toBe('mr-trans.patrol');
    expect(recordedVoiceKeyFor('reclaim_transport', 'attack')).toBe('rc-trans.attack');
    expect(BARKS.allied_vehicle.select?.map((line) => line.text)).toEqual([
      'Armour crew online.', 'Armour ready.', 'Systems green.',
    ]);
    expect(recordedVoiceKeyFor('soviet_vehicle', 'select')).toBe('sv-arm.select');
    expect(recordedVoiceKeyFor('soviet_vehicle', 'underFire')).toBe('sv-arm.underFire');
    expect(recordedVoiceKeyFor('soviet_vehicle', 'deploy')).toBe('m.deploy');
    expect(BARKS.soviet_vehicle.select?.map((line) => line.text)).toEqual([
      'Heavy armour ready.', 'Steel standing by.', 'Engines awake.',
    ]);
    expect(recordedVoiceKeyFor('meridian_vehicle', 'select')).toBe('mr-arm.select');
    expect(recordedVoiceKeyFor('meridian_vehicle', 'underFire')).toBe('mr-arm.underFire');
    expect(recordedVoiceKeyFor('meridian_vehicle', 'deploy')).toBe('f.deploy');
    expect(BARKS.meridian_vehicle.select?.map((line) => line.text)).toEqual([
      'Pact hull aligned.', 'Hull in balance.', 'Weapon array ready.',
    ]);
    expect(recordedVoiceKeyFor('reclaim_vehicle', 'select')).toBe('rc-arm.select');
    expect(recordedVoiceKeyFor('reclaim_vehicle', 'underFire')).toBe('rc-arm.underFire');
    expect(recordedVoiceKeyFor('reclaim_vehicle', 'deploy')).toBe('m.deploy');
    expect(BARKS.reclaim_vehicle.select?.map((line) => line.text)).toEqual([
      'Line rig fired up.', 'Crew and weapon ready.', 'Point us at the work.',
    ]);
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
