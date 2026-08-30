/**
 * ============================================================================
 * tests/ai-pacing.spec.ts
 * ============================================================================
 * "Even on eassy, enemies spawns too early and attack too harsh."
 *
 * They did, and the reason is that NOTHING GATED AN ATTACK ON TIME. The
 * military layer committed the moment `strikeCount >= waveThreshold()`, and on
 * Easy against a Rusher that threshold is `AI_SQUAD_MIN * 0.55 / 1.6 = 2.06`,
 * clamped up to the floor of 2. Two conscripts out of the barracks and the wave
 * rolled — at whatever minute of the match that happened to be.
 *
 * `DifficultyProfile.aggression` is documented as "0..1.3 — how readily it
 * commits to an attack". It was declared in `AI_DIFFICULTY`, copied into the
 * profile by `difficultyProfile()`, and READ BY NOTHING. The knob for this
 * report already existed; only the wiring was missing.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE LADDER IS MONOTONIC. Easy waits longest, Brutal shortest, at both
 *     gates. A table where two rows cross is a difficulty setting that lies.
 *   - EASY ACTUALLY GIVES YOU TIME. Six minutes forty before the first push,
 *     two minutes forty between them. Asserted in seconds against the clock,
 *     not as a ratio.
 *   - THE GRACE PERIOD IS NOT A TRUCE. Rushing the AI cancels it on the spot.
 *     An opponent that absorbs a six-minute rush without ever hitting back
 *     because a timer said so is not easy, it is inert.
 *   - DEFENCE IS NEVER GATED. The AI answers a raid during the grace period.
 *     This is the case that stops the fix turning "too aggressive" into
 *     "does not react at all".
 *   - LOSING DOES NOT UNDO THE DIFFICULTY. Wave escalation is capped by
 *     `waveSizeMul`, so beating an Easy AI four times cannot make it mass a
 *     bigger stack than a Brutal AI opens with.
 *
 * Headless: no GL, no DOM, no `ctx()`.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import { ArmorClass, EntityFlag, EntityKind, Faction } from '../src/core/types';
import type { EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import {
  AI_DIFFICULTY, AI_MILITARY, AI_SQUAD_MAX, AI_SQUAD_MIN, CELL, SIM_DT, SIM_HZ,
} from '../src/core/config';

import { AiBrain } from '../src/sim/AI';
import { BuildCatalog, difficultyProfile } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';

const P_HUMAN = 0 as PlayerId;
const P_AI = 1 as PlayerId;

const EASY = 0;
const NORMAL = 1;
const HARD = 2;
const BRUTAL = 3;

function syntheticBinding(): DefLookup {
  const catalog = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 0;
  let b = 0;
  for (const e of catalog.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { tables: null, unitId, buildingId };
}

interface Harness {
  world: World;
  channels: Channels;
  brain: AiBrain;
  tick: number;
  step(ticks: number): void;
  army(n: number): void;
}

/**
 * An AI with a base at (400,400) and a standing army — the state the report is
 * about. The economy is not simulated: these cases are about WHEN the brain
 * commits an army it already has, not about how it got one.
 */
function makeHarness(difficulty: number, personality = 0, seed = 4242): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P_AI);
  ai.aiDifficulty = difficulty;
  ai.aiPersonality = personality;
  ai.powerProduced = 400;
  ai.powerConsumed = 20;

  const st = world.store;
  const conyard = st.alloc(EntityKind.Building, -1, P_AI, Faction.Soviets, 400, 0, 400, 0);
  const ci = st.index(conyard);
  st.flags[ci] |= EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.BlocksNav;
  st.footprintW[ci] = 3; st.footprintH[ci] = 3;
  st.hp[ci] = 2000; st.maxHp[ci] = 2000;
  st.armorClass[ci] = ArmorClass.Concrete;
  st.buildProgress[ci] = 1;
  world.terrain.markOccupied(
    Math.floor(400 / CELL) - 1, Math.floor(400 / CELL) - 1, 3, 3, conyard,
  );

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, seed);
  brain.attach(channels.events);

  const rng: IRng = {
    next: () => 0.5, int: (n: number) => (n / 2) | 0,
    range: (a: number, b: number) => (a + b) * 0.5, chance: () => false,
  } as unknown as IRng;

  let tick = 0;
  let spawned = 0;
  const h: Harness = {
    world,
    channels,
    brain,
    get tick(): number { return tick; },
    set tick(v: number) { tick = v; },
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.spatial.rebuild();
        brain.tick(s);
        channels.commands.clear();
      }
    },
    army(n: number): void {
      for (let k = 0; k < n; k++) {
        const id = st.alloc(
          EntityKind.Vehicle, -1, P_AI, Faction.Soviets,
          400 + (spawned % 8) * 4, 0, 424 + Math.floor(spawned / 8) * 4, 0,
        );
        spawned++;
        const i = st.index(id);
        st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | EntityFlag.CanAttack;
        st.hp[i] = 300; st.maxHp[i] = 300; st.maxSpeed[i] = 6;
        st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
      }
    },
  };
  return h;
}

/** Ticks until the brain first enters the attacking posture, or -1. */
function ticksToFirstAttack(h: Harness, limit: number): number {
  for (let k = 0; k < limit; k++) {
    h.step(1);
    if (h.brain.intent().posture === 'attacking') return h.tick;
  }
  return -1;
}

/** The gate as the config declares it, in ticks. */
function expectedUnlock(difficulty: number): number {
  const agg = Math.max(0.1, AI_DIFFICULTY[difficulty]!.aggression);
  return Math.round((AI_MILITARY.firstStrikeSeconds * SIM_HZ) / agg);
}

/* ========================================================================== */

describe('aggression is wired to something', () => {
  it('is a real per-difficulty spread, not four copies of one number', () => {
    const seen = new Set(AI_DIFFICULTY.map((d) => d.aggression));
    expect(seen.size, 'four difficulties must not share one aggression').toBe(4);
  });

  it('falls monotonically from Brutal to Easy', () => {
    for (let i = 1; i < AI_DIFFICULTY.length; i++) {
      expect(AI_DIFFICULTY[i]!.aggression, `${AI_DIFFICULTY[i]!.name} vs ${AI_DIFFICULTY[i - 1]!.name}`)
        .toBeGreaterThan(AI_DIFFICULTY[i - 1]!.aggression);
    }
  });

  it('survives the trip through difficultyProfile()', () => {
    for (let i = 0; i < AI_DIFFICULTY.length; i++) {
      expect(difficultyProfile(i).aggression).toBe(AI_DIFFICULTY[i]!.aggression);
    }
  });

  it('keeps expert tactical execution off the beginner rung', () => {
    expect(difficultyProfile(EASY).advancedTactics).toBe(false);
    for (const d of [NORMAL, HARD, BRUTAL]) {
      expect(difficultyProfile(d).advancedTactics, AI_DIFFICULTY[d]!.name).toBe(true);
    }
  });
});

/* ========================================================================== */

describe('the first push waits for the clock, not just for the headcount', () => {
  it('holds an Easy AI for more than six minutes even with an army standing ready', () => {
    const h = makeHarness(EASY);
    h.army(AI_SQUAD_MAX * 3);   // far past any threshold, on tick zero

    const unlock = expectedUnlock(EASY);
    expect(unlock / SIM_HZ, 'Easy must give the player a long beginner runway').toBeCloseTo(400, 0);

    // One tick short of the gate: still massing, with a full army in hand.
    h.step(unlock - 1);
    expect(h.brain.intent().strike, 'the army must actually be assembled')
      .toBeGreaterThanOrEqual(AI_SQUAD_MIN);
    expect(h.brain.intent().posture, 'and it must not have gone yet').not.toBe('attacking');

    // Past it, it goes.
    expect(ticksToFirstAttack(h, SIM_HZ * 20), 'it must attack once the gate opens')
      .toBeGreaterThan(0);
  });

  it('orders the four difficulties correctly, measured on the clock', () => {
    const measured: number[] = [];
    for (const d of [EASY, NORMAL, HARD, BRUTAL]) {
      const h = makeHarness(d);
      h.army(AI_SQUAD_MAX * 3);
      const at = ticksToFirstAttack(h, expectedUnlock(EASY) + SIM_HZ * 60);
      expect(at, `${AI_DIFFICULTY[d]!.name} must eventually attack`).toBeGreaterThan(0);
      measured.push(at);
    }
    for (let i = 1; i < measured.length; i++) {
      expect(measured[i]!, `${AI_DIFFICULTY[i]!.name} must not wait longer than ${AI_DIFFICULTY[i - 1]!.name}`)
        .toBeLessThan(measured[i - 1]!);
    }
    // And the extremes are far apart in a way a player would notice — not a
    // ladder that technically sorts but spans eight seconds.
    expect(measured[EASY]! - measured[BRUTAL]!).toBeGreaterThan(SIM_HZ * 120);
  });

  it('does not gate an AI that has nothing to attack with anyway', () => {
    // The gate must be a CEILING on eagerness, never a floor under it: an AI
    // with no army must still be massing, not sitting in some third state.
    const h = makeHarness(EASY);
    h.step(SIM_HZ * 10);
    expect(h.brain.intent().posture).not.toBe('attacking');
    expect(h.brain.intent().strike).toBe(0);
  });
});

/* ========================================================================== */

describe('the grace period is a head start, not a truce', () => {
  it('cancels the moment the AI base is actually being hit', () => {
    const h = makeHarness(EASY);
    h.army(AI_SQUAD_MAX * 3);
    h.step(SIM_HZ * 5);
    expect(h.brain.intent().posture, 'not attacking yet — the gate is 400 s')
      .not.toBe('attacking');

    // A sustained raid. `basePressure` accumulates per reported hit and decays
    // at AI_MILITARY.pressureDecayPerSec, so several are needed to clear
    // `gracePressureCancel`.
    for (let k = 0; k < 12; k++) {
      h.channels.events.emit('combat:underAttack', { player: P_AI, x: 396, z: 396, isBuilding: true });
      h.step(2);
    }
    expect(h.brain.intent().basePressure).toBeGreaterThan(AI_MILITARY.gracePressureCancel);

    // It must now be capable of offence again well inside the original gate.
    const before = h.tick;
    const at = ticksToFirstAttack(h, SIM_HZ * 90);
    expect(at, 'a rushed Easy AI must be able to hit back').toBeGreaterThan(0);
    expect(at - before, 'and not wait out the rest of the 400 s')
      .toBeLessThan(expectedUnlock(EASY) - before);
  });

  it('still answers a raid DURING the grace period', () => {
    // The single most important case here: the fix must not have bought
    // "less aggressive" by making the AI unable to react at all.
    const h = makeHarness(EASY);
    h.army(8);
    h.step(SIM_HZ * 3);
    h.channels.events.emit('combat:underAttack', { player: P_AI, x: 360, z: 360, isBuilding: true });
    h.step(SIM_HZ * 5);   // past Easy's 2.4 s reaction delay
    expect(h.brain.intent().posture, 'defence is never gated on the clock')
      .toBe('defending');
  });
});

/* ========================================================================== */

describe('losing does not undo the difficulty setting', () => {
  it('caps wave escalation by waveSizeMul rather than a flat AI_SQUAD_MAX', () => {
    // The ceiling an Easy brain can escalate its threshold to must stay under
    // the wave a Brutal brain opens with. Before this it was a flat
    // AI_SQUAD_MAX for everybody, so four lost waves put Easy at 17.
    const easyCap = AI_SQUAD_MAX * AI_DIFFICULTY[EASY]!.waveSizeMul;
    const brutalOpening = AI_SQUAD_MIN * AI_DIFFICULTY[BRUTAL]!.waveSizeMul;
    expect(easyCap).toBeLessThan(AI_SQUAD_MAX);
    expect(easyCap, 'a beaten Easy AI must not out-mass a fresh Brutal one')
      .toBeLessThanOrEqual(brutalOpening + AI_SQUAD_MIN);
  });

  it('keeps the escalation ceiling ordered across the ladder', () => {
    for (let i = 1; i < AI_DIFFICULTY.length; i++) {
      expect(AI_SQUAD_MAX * AI_DIFFICULTY[i]!.waveSizeMul)
        .toBeGreaterThan(AI_SQUAD_MAX * AI_DIFFICULTY[i - 1]!.waveSizeMul);
    }
  });
});

/* ========================================================================== */

describe('the rearm gap between waves', () => {
  it('is ordered across the ladder and real on Easy', () => {
    const gap = (d: number): number =>
      Math.round((AI_MILITARY.rearmSeconds * SIM_HZ) / Math.max(0.1, AI_DIFFICULTY[d]!.aggression));
    expect(gap(EASY) / SIM_HZ, 'well over two minutes between Easy waves').toBeCloseTo(160, 0);
    for (const d of [NORMAL, HARD, BRUTAL]) expect(gap(d)).toBeLessThan(gap(d - 1));
  });
});
