/**
 * ============================================================================
 * tests/ai-air-withdraw.spec.ts — AN AIRCRAFT LEAVES EARLIER THAN A TANK
 * ============================================================================
 * `AiBrain.withdrawWounded` walks one hull out of a fight per pass, worst
 * health first, at `AI_RETREAT.hpFraction` 0.3. That number was derived for a
 * TANK and it is the wrong number for an airframe:
 *
 *   - the window under thirty percent is about TWO SECONDS — 2.07 measured
 *     against eight G.I.s, 2.47 against eight conscripts — on a 190 hp hull
 *     that cost a thousand credits;
 *   - the layer polls at `AI_SQUAD_HZ` 5, i.e. every 0.2 s, and rolls
 *     `rng.chance(discipline)` each time, so on any rung below Brutal that
 *     window is a coin flip;
 *   - and the ONE hull per pass is chosen by worst health, so an aircraft at
 *     45% loses every pass to a tank at 25% — precisely the pass it had two
 *     seconds to win.
 *
 * The change under test is three things: `AI_RETREAT.airHpFraction` 0.5, a
 * SECOND best-so-far slot (`worstAir`) so an aircraft never competes with the
 * ground line for the single slot, and an air pass that runs first and skips
 * the rout cap. A fourth landed with this file, because writing §8 found it:
 * the cap exemption held only for the pass that ISSUES the order, so an
 * airframe parked at the rally went on spending one of the ground line's slots
 * for as long as it stayed there.
 *
 * WHAT IS PINNED HERE, AND WHY EACH ONE IS TAKEN FALSIFIER-FIRST
 * -------------------------------------------------------------
 * Every positive case in this file is preceded by the same case at a fraction
 * where it must NOT fire. A "the aircraft withdrew" assertion passes just as
 * happily against a branch that withdraws everything, and a "the tank did not"
 * assertion passes against a branch that never fires at all. Only the pair
 * says the THRESHOLD is what decided.
 *
 *   §1  an aircraft between the two thresholds leaves; at 0.60 it does not.
 *   §2  a GROUND hull at the same 0.45 does NOT — the falsifier that says the
 *       new threshold fired rather than the old one. Paired with the same hull
 *       at 0.25, which does, so §2 cannot pass by nothing happening.
 *   §3  the rout cap is a GROUND rule. With the cap saturated, one more tank
 *       is refused and the aircraft still leaves.
 *   §4  the ground slot is not consumed. One aircraft at 0.45 and one tank at
 *       0.25 in the same pass: BOTH leave. Its control makes the aircraft a
 *       ground hull at 0.45 and shows only the tank leaves — which is exactly
 *       the pre-change behaviour, measured rather than asserted from memory.
 *       Its third case is the falsifier for the `continue`: an aircraft under
 *       the GROUND threshold must not be ordered home twice.
 *   §5  `rejoinHpFraction` 0.75 is untouched and still releases an aircraft.
 *   §6  Easy is excluded before the roll and issues nothing.
 *   §7  A MATCH WITH NO AIRCRAFT DRAWS THE RNG SEQUENCE IT ALWAYS DREW. The
 *       whole safety argument for the change rests on this: the extra
 *       `rng.chance` is reached only when `worstAir` is set, so every existing
 *       AI trace is bit-identical. Read that section's header for what is
 *       gated here and what was measured against a reverted build instead.
 *   §8  the cap exemption survives past the issuing pass.
 *
 * WHAT THIS FILE DOES NOT ANSWER. Whether the rule is ever REACHED in a real
 * match — a rule that is correct and unreachable is inert.
 * `tests/ai-air-withdraw-probe.spec.ts` is that instrument, opt-in behind
 * `VM_AIR_PROBE`, and it is where the per-rung counts live.
 *
 * THE HARNESS IS `tests/ai-focus-fire.spec.ts`'s, with three changes that
 * matter. Hulls sit ~90 m from the rally point and in `UnitState.Attacking`,
 * so `gather`'s `gatherIdle` finds nothing to send and the ONLY orders in the
 * stream are withdrawals. The brain is warmed for 60 ticks before any hull is
 * wounded, because the APM budget accrues at `apmCap / (60 * SIM_HZ)` — 0.144
 * a tick on Brutal, i.e. 0.87 per squad pass — and §4 needs two actions in ONE
 * pass. And every positive case runs on Brutal, whose `discipline` is exactly
 * 1.00: `chance(1)` is `next() < 1`, which is true for every value the
 * generator can produce, so the roll is deterministic and no case here can
 * flake on a draw. It still CONSUMES a draw, which is what makes §7 meaningful.
 *
 * THE FIRST TWO HULLS SPAWNED ARE THE RESERVE. `regroupSquads` fills the
 * reserve from the HEAD of `armyIds`, so a subject spawned first is never a
 * withdrawal candidate and every case built that way passes for the wrong
 * reason. Cases that need a candidate spawn it LAST; cases that need the cap to
 * saturate spawn two throwaways first.
 *
 * Headless: no GL, no DOM, no terrain, no economy.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, CommandKind, EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind, UnitState,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import { AI_SKILL, CELL, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import { AI_RETREAT, BuildCatalog } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';

const P_AI = 1 as PlayerId;

const EASY = 0;
const NORMAL = 1;
const HARD = 2;
const BRUTAL = 3;

/** The AI's base. The rally point is derived from it and sits ~24 m nearer the mirror. */
const BASE_X = 400;
const BASE_Z = 400;
/**
 * Where the army stands: ~90 m from the rally point, which is what keeps
 * `gatherIdle` quiet. Inside `AI_MILITARY.arriveRadius` (16 m) a withdrawing
 * hull is also "home" on the very next pass and is released again immediately,
 * so this distance is load-bearing twice.
 */
const FRONT_X = 440;
const FRONT_Z = 440;

const HULL_HP = 400;

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
  brain: AiBrain;
  commands: Command[];
  /** Advance the sim by `n` ticks, driving only the brain. */
  step(n: number): void;
  /** Spawn one army hull. `air` sets `Locomotor.Air`; everything else is identical. */
  hull(air: boolean): EntityId;
  /** Wound a hull and stamp it as hit THIS instant, so it counts as in the fight. */
  wound(id: EntityId, hpFrac: number): void;
  /** Mend a hull WITHOUT stamping it — the rejoin is a health test, not a fire test. */
  heal(id: EntityId, hpFrac: number): void;
  /** Re-stamp `lastHitTime` on every army hull — `underFireSeconds` is only 3 s. */
  keepUnderFire(): void;
  /** Single-entity `Move` orders naming this hull. A withdrawal is the only one. */
  pullouts(id: EntityId): Command[];
  /** A compact, order-preserving fingerprint of every command the brain issued. */
  trace(): string[];
}

function makeHarness(difficulty: number, seed = 4242): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P_AI);
  ai.aiDifficulty = difficulty;
  // Rusher: `defense` 0.5 keeps `regroupSquads`' reserve at its floor of 2, so
  // nearly the whole army is in the strike group and the rout cap in §3 is a
  // number this file can predict rather than discover.
  ai.aiPersonality = 1;
  ai.powerProduced = 400;
  ai.powerConsumed = 20;

  const st = world.store;
  const conyard = st.alloc(EntityKind.Building, -1, P_AI, Faction.Soviets, BASE_X, 0, BASE_Z, 0);
  const ci = st.index(conyard);
  st.flags[ci] |= EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.BlocksNav;
  st.footprintW[ci] = 3; st.footprintH[ci] = 3;
  st.hp[ci] = 2000; st.maxHp[ci] = 2000;
  st.armorClass[ci] = ArmorClass.Concrete;
  st.buildProgress[ci] = 1;
  world.terrain.markOccupied(
    Math.floor(BASE_X / CELL) - 1, Math.floor(BASE_Z / CELL) - 1, 3, 3, conyard,
  );

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, seed);
  brain.attach(channels.events);

  const commands: Command[] = [];
  channels.commands.observe((c) => {
    commands.push({ ...c, entities: c.entities.slice() } as Command);
  });

  const rng: IRng = new Rng(7);
  let tick = 0;
  let spawned = 0;
  const army: EntityId[] = [];

  const h: Harness = {
    world,
    brain,
    commands,
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.spatial.rebuild();
        brain.tick(s);
        channels.commands.drain(() => {});
      }
    },
    hull(air: boolean): EntityId {
      const id = st.alloc(
        EntityKind.Vehicle, -1, P_AI, Faction.Soviets,
        FRONT_X + (spawned % 8) * 4, 0, FRONT_Z + Math.floor(spawned / 8) * 4, 0,
      );
      spawned++;
      const i = st.index(id);
      st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | EntityFlag.CanAttack;
      st.maxHp[i] = HULL_HP; st.hp[i] = HULL_HP;
      st.maxSpeed[i] = 6; st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
      st.locomotor[i] = air ? Locomotor.Air : Locomotor.Track;
      // NOT `Idle`: an idle hull away from the rally is exactly what
      // `gatherIdle` exists to collect, and one group Move per pass would both
      // pollute the stream and eat the action this file is measuring.
      st.state[i] = UnitState.Attacking;
      st.lastHitTime[i] = world.time;
      army.push(id);
      return id;
    },
    wound(id: EntityId, hpFrac: number): void {
      const i = st.index(id);
      st.hp[i] = HULL_HP * hpFrac;
      st.lastHitTime[i] = world.time;
    },
    heal(id: EntityId, hpFrac: number): void {
      st.hp[st.index(id)] = HULL_HP * hpFrac;
    },
    keepUnderFire(): void {
      for (const id of army) {
        const i = st.index(id);
        if (i >= 0) st.lastHitTime[i] = world.time;
      }
    },
    pullouts(id: EntityId): Command[] {
      return commands.filter(
        (c) => c.kind === CommandKind.Order
          && c.order === (OrderKind.Move as number)
          && c.entityCount === 1
          && c.entities[0] === (id as number),
      );
    },
    trace(): string[] {
      return commands.map(
        (c) => `${c.tick}|${c.kind}|${c.order}|${c.entityCount}|${
          Array.from(c.entities.slice(0, c.entityCount)).join(',')
        }|${c.x.toFixed(4)}|${c.z.toFixed(4)}|${c.target}|${c.defId}|${c.tab}|${c.stance}|${c.arg}`,
      );
    },
  };
  return h;
}

/** One squad pass is `SIM_HZ / AI_SQUAD_HZ` = 6 ticks. */
const PASS = 6;

/** Warm the APM budget to its `ACTION_BURST_CAP` of 8 before anything is wounded. */
const WARMUP = 60;

/* ========================================================================== */

describe('the doctrine is one threshold, and it sits between the other two', () => {
  it('is higher than the ground threshold — that is the whole change', () => {
    expect(AI_RETREAT.airHpFraction).toBeGreaterThan(AI_RETREAT.hpFraction);
  });

  it('stays clear of the rejoin threshold, or a healed hull oscillates', () => {
    // `rejoinHpFraction` is what releases a withdrawn hull. Equal thresholds
    // give a hull that leaves at 0.5, is released at 0.5 and leaves again on
    // the next graze — the exact failure the ground gap exists to prevent.
    expect(AI_RETREAT.airHpFraction).toBeLessThan(AI_RETREAT.rejoinHpFraction);
    expect(AI_RETREAT.rejoinHpFraction - AI_RETREAT.airHpFraction).toBeGreaterThanOrEqual(0.2);
  });

  it('excludes exactly Easy, unchanged', () => {
    expect(AI_SKILL[EASY].discipline).toBeLessThan(AI_RETREAT.minDiscipline);
    for (const rung of [NORMAL, HARD, BRUTAL]) {
      expect(AI_SKILL[rung].discipline).toBeGreaterThanOrEqual(AI_RETREAT.minDiscipline);
    }
  });
});


/* ==========================================================================
 * §1 / §2 — THE THRESHOLD, TAKEN FALSIFIER FIRST
 *
 * Four cases over one shape: the subject is spawned LAST so `regroupSquads`
 * cannot put it in the reserve (the reserve is filled from the head of the
 * army), the army is held under fire, six squad passes. The pair that matters
 * is `air 0.60` against `air 0.45`; the pair that says WHICH threshold fired is
 * `air 0.45` against `ground 0.45`.
 * ========================================================================== */

interface SubjectRun {
  pulls: number;
  withdrawals: number;
  strike: number;
  h: Harness;
  subject: EntityId;
}

/** Spawn `fill` healthy ground hulls, then one subject, and run `passes` passes. */
function runSubject(
  difficulty: number, air: boolean, hpFrac: number, passes = 6, fill = 13,
): SubjectRun {
  const h = makeHarness(difficulty);
  for (let k = 0; k < fill; k++) h.hull(false);
  const subject = h.hull(air);
  h.step(WARMUP);
  for (let p = 0; p < passes; p++) {
    h.keepUnderFire();
    h.wound(subject, hpFrac);
    h.step(PASS);
  }
  return {
    pulls: h.pullouts(subject).length,
    withdrawals: h.brain.withdrawalCount,
    strike: h.brain.strikeSize,
    h,
    subject,
  };
}

describe('an aircraft leaves at a fraction that leaves a tank in the line', () => {
  it('does NOT pull an aircraft out above the air threshold', () => {
    // FIRST, because "the aircraft withdrew" is equally true of a branch that
    // withdraws every aircraft it can see.
    const r = runSubject(BRUTAL, true, 0.60);
    expect(r.pulls, 'an aircraft at 60% is not in trouble').toBe(0);
    expect(r.withdrawals).toBe(0);
  });

  it('pulls an aircraft out between the two thresholds', () => {
    const r = runSubject(BRUTAL, true, 0.45);
    expect(AI_RETREAT.hpFraction).toBeLessThan(0.45);
    expect(AI_RETREAT.airHpFraction).toBeGreaterThan(0.45);
    expect(r.pulls, 'the aircraft was left in the fight').toBe(1);
    expect(r.withdrawals).toBe(1);
    // The command is the player's own verb: one hull, aimed at the rally point.
    const cmd = r.h.pullouts(r.subject)[0];
    expect(cmd.kind).toBe(CommandKind.Order);
    expect(cmd.order).toBe(OrderKind.Move as number);
    expect(cmd.entityCount).toBe(1);
    expect(cmd.target, 'a withdrawal names a place, never a target').toBe(NONE);
    // The `GROUP_WITHDRAW` tag is private; this is what it DOES. `squad` calls
    // `regroupSquads` immediately after, and the tag is what makes the hull
    // invisible to the re-file — so the strike group is one smaller on the same
    // pass, and stays that way while the hull is out.
    const healthy = runSubject(BRUTAL, true, 0.60);
    expect(r.strike, 'untagged, and `pressAttack` sends it straight back')
      .toBe(healthy.strike - 1);
  });

  it('leaves a GROUND hull at the same fraction exactly where it is', () => {
    // THE FALSIFIER FOR THE WHOLE CHANGE. If this withdraws, the number that
    // fired was not `airHpFraction` and every case above proves nothing.
    const r = runSubject(BRUTAL, false, 0.45);
    expect(r.pulls).toBe(0);
    expect(r.withdrawals).toBe(0);
  });

  it('and pulls that same ground hull out at the GROUND threshold', () => {
    // ...so the case above cannot be passing because nothing works at all.
    const r = runSubject(BRUTAL, false, 0.25);
    expect(r.pulls).toBe(1);
    expect(r.withdrawals).toBe(1);
  });

  it('is not a Brutal-only feature — Normal and Hard pull an aircraft out too', () => {
    // `discipline` decides how OFTEN, not whether. Brutal's 1.00 makes `chance`
    // deterministic, which is why every other case here uses it; these two roll
    // for real, so they are given twenty passes to land one.
    for (const rung of [NORMAL, HARD]) {
      const r = runSubject(rung, true, 0.45, 20);
      expect(r.pulls, `rung ${rung} never withdrew the aircraft`).toBeGreaterThan(0);
    }
  });
});

/* ==========================================================================
 * §3 — THE ROUT CAP IS A GROUND RULE
 * ========================================================================== */

describe('the rout cap does not reach the aircraft', () => {
  it('refuses a further tank and still lets the aircraft go', () => {
    const h = makeHarness(BRUTAL);
    // Two hulls for the reserve, which `regroupSquads` fills from the head of
    // the army — without them the first two wounded tanks are never candidates
    // and this case measures the reserve rather than the cap.
    h.hull(false); h.hull(false);
    const ground: EntityId[] = [];
    for (let k = 0; k < 11; k++) ground.push(h.hull(false));
    const air = h.hull(true);
    h.step(WARMUP);

    // Six wounded tanks against a cap of `floor(striking * maxFraction)`.
    for (let k = 0; k < 6; k++) h.wound(ground[k], 0.25);
    for (let p = 0; p < 12; p++) { h.keepUnderFire(); h.step(PASS); }

    const out = ground.filter((g) => h.pullouts(g).length > 0).length;
    expect(out, 'the cap never saturated — this case is not testing anything')
      .toBeLessThan(6);
    expect(out).toBeGreaterThan(0);

    // FALSIFIER: with the cap saturated, one more wounded tank is refused.
    const stuck = h.brain.withdrawalCount;
    h.keepUnderFire();
    h.wound(ground[6], 0.10);
    h.step(PASS * 3);
    expect(h.pullouts(ground[6]).length, 'the cap is not actually holding').toBe(0);
    expect(h.brain.withdrawalCount).toBe(stuck);

    // ...and the aircraft leaves through that same saturated cap.
    h.keepUnderFire();
    h.wound(air, 0.45);
    h.step(PASS);
    expect(h.pullouts(air).length, 'the rout cap swallowed the aircraft').toBe(1);
    expect(h.brain.withdrawalCount).toBe(stuck + 1);
  });
});

/* ==========================================================================
 * §4 — THE GROUND SLOT IS NOT CONSUMED
 * ========================================================================== */

describe('an aircraft and a tank both leave on the same pass', () => {
  it('withdraws both, in one pass, with the aircraft ordered first', () => {
    const h = makeHarness(BRUTAL);
    for (let k = 0; k < 12; k++) h.hull(false);
    const air = h.hull(true);
    const tank = h.hull(false);
    h.step(WARMUP);
    h.keepUnderFire();
    h.wound(air, 0.45);
    h.wound(tank, 0.25);   // strictly worse off than the aircraft
    h.step(PASS);

    expect(h.pullouts(air).length, 'the tank took the only slot').toBe(1);
    expect(h.pullouts(tank).length).toBe(1);
    expect(h.brain.withdrawalCount).toBe(2);
    // ONE PASS, not two: same tick, air first.
    const both = h.commands.filter((c) => c.entityCount === 1);
    expect(both.length).toBe(2);
    expect(both[0].tick).toBe(both[1].tick);
    expect(both[0].entities[0]).toBe(air as number);
    expect(both[1].entities[0]).toBe(tank as number);
  });

  it('an aircraft under the GROUND threshold still only takes the air slot', () => {
    // THE FALSIFIER FOR THE `continue`. Below `hpFraction` an aircraft is a
    // legal candidate for the ground comparison too, so without it the same
    // hull is both `worstAir` and `worst`: it is ordered home TWICE in one pass
    // — two actions off the APM budget for one hull — and the tank that should
    // have had the ground slot is left in the fight.
    const h = makeHarness(BRUTAL);
    for (let k = 0; k < 12; k++) h.hull(false);
    const air = h.hull(true);
    const tank = h.hull(false);
    h.step(WARMUP);
    h.keepUnderFire();
    h.wound(air, 0.10);    // worse off than the tank, on the ground scale too
    h.wound(tank, 0.20);
    h.step(PASS);

    expect(h.pullouts(air).length, 'the aircraft was ordered home twice').toBe(1);
    expect(h.pullouts(tank).length, 'the aircraft ate the ground slot').toBe(1);
    expect(h.brain.withdrawalCount).toBe(2);
  });

  it('CONTROL: make the aircraft a ground hull and only the tank leaves', () => {
    // This is the pre-change behaviour, measured on this build rather than
    // remembered: one slot, taken by worst health, and 0.45 loses to 0.25.
    const h = makeHarness(BRUTAL);
    for (let k = 0; k < 12; k++) h.hull(false);
    const notAir = h.hull(false);
    const tank = h.hull(false);
    h.step(WARMUP);
    h.keepUnderFire();
    h.wound(notAir, 0.45);
    h.wound(tank, 0.25);
    h.step(PASS);

    expect(h.pullouts(notAir).length).toBe(0);
    expect(h.pullouts(tank).length).toBe(1);
    expect(h.brain.withdrawalCount).toBe(1);
  });
});

/* ==========================================================================
 * §5 — THE REJOIN IS UNTOUCHED
 * ========================================================================== */

describe('a healed aircraft comes back', () => {
  it('stays out below the rejoin threshold', () => {
    // FIRST. "It came back" is also what a missing tag looks like.
    const h = makeHarness(BRUTAL);
    for (let k = 0; k < 13; k++) h.hull(false);
    const air = h.hull(true);
    h.step(WARMUP);
    h.keepUnderFire();
    h.wound(air, 0.45);
    h.step(PASS);
    expect(h.pullouts(air).length).toBe(1);
    const outStrike = h.brain.strikeSize;

    // Healed, but short of `rejoinHpFraction` 0.75.
    h.heal(air, 0.60);
    for (let p = 0; p < 4; p++) { h.keepUnderFire(); h.step(PASS); }
    expect(h.brain.strikeSize, 'released below the rejoin threshold').toBe(outStrike);
  });

  it('is released to GROUP_NONE past it, and is withdrawable again', () => {
    const h = makeHarness(BRUTAL);
    for (let k = 0; k < 13; k++) h.hull(false);
    const air = h.hull(true);
    h.step(WARMUP);
    h.keepUnderFire();
    h.wound(air, 0.45);
    h.step(PASS);
    const outStrike = h.brain.strikeSize;

    h.heal(air, 0.80);
    h.keepUnderFire();
    h.step(PASS);
    expect(AI_RETREAT.rejoinHpFraction).toBeLessThan(0.80);
    expect(h.brain.strikeSize, 'never came back — the army shrinks by one per fight')
      .toBe(outStrike + 1);

    // GROUP_NONE and re-filed, not merely untagged: wound it again and the whole
    // rule fires a second time on the same hull.
    h.keepUnderFire();
    h.wound(air, 0.45);
    h.step(PASS);
    expect(h.pullouts(air).length).toBe(2);
  });
});

/* ==========================================================================
 * §6 — EASY IS UNTOUCHED
 * ========================================================================== */

/** `withdrawWounded`'s body with every comment removed. */
function withdrawSource(): string {
  const src = readFileSync(new URL('../src/sim/AI.ts', import.meta.url), 'utf8');
  const start = src.indexOf('private withdrawWounded(s: SimContext): void {');
  expect(start, 'withdrawWounded was renamed').toBeGreaterThan(0);
  // `\r?\n`, because this repo checks out CRLF on Windows and a literal
  // '\n  }' silently finds nothing — which reads exactly like a rename.
  const end = src.slice(start).search(/\r?\n {2}\}\r?\n/);
  expect(end, 'the end of withdrawWounded was not found').toBeGreaterThan(0);
  return src.slice(start, start + end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('Easy gains nothing, and does not even roll for it', () => {
  it('issues nothing for an aircraft at ten percent', () => {
    const r = runSubject(EASY, true, 0.10, 30);
    expect(r.pulls).toBe(0);
    expect(r.withdrawals).toBe(0);
    // Nothing else in the stream either: no Move order at all on that rung.
    const moves = r.h.commands.filter(
      (c) => c.kind === CommandKind.Order && c.order === (OrderKind.Move as number),
    );
    expect(moves).toEqual([]);
  });

  it('and a Brutal brain in the same rig does, so the case is not vacuous', () => {
    const r = runSubject(BRUTAL, true, 0.10, 30);
    expect(r.pulls).toBe(1);
  });

  it('gates on discipline BEFORE any draw — Easy consumes no RNG', () => {
    // COMMENTS STRIPPED FIRST. The block introducing `worstAir` contains both
    // the word `rng` and the word `discipline`, so a scan of the raw source
    // answers yes to this whichever way the code is written.
    const body = withdrawSource();
    const gate = body.indexOf('AI_RETREAT.minDiscipline');
    const firstRoll = body.indexOf('this.rng');
    expect(gate, 'the discipline gate is gone').toBeGreaterThan(0);
    expect(firstRoll, 'nothing rolls — this check has nothing to guard').toBeGreaterThan(0);
    expect(gate, 'a draw happens before the rung is excluded').toBeLessThan(firstRoll);
    // And it is the FIRST statement, not merely an early one: anything ahead of
    // it that touched the RNG or the store would also run on Easy.
    const firstStatement = body.slice(body.indexOf('{') + 1).trim().split('\n')[0];
    expect(firstStatement).toContain('AI_RETREAT.minDiscipline');
  });
});

/* ==========================================================================
 * §7 — A MATCH WITH NO AIRCRAFT DRAWS THE SEQUENCE IT ALWAYS DREW
 *
 * The safety argument for the whole change: the extra `rng.chance` sits behind
 * `worstAir !== NONE`, so a brain that never sees a wounded aircraft issues the
 * byte-identical command stream it issued before the change existed. If that is
 * false the change is an unmeasurable perturbation of every AI match at once.
 *
 * MEASURED AGAINST A REVERTED BUILD, 2026-08-19, and recorded here because the
 * control cannot survive in the tree. `src/sim/AI.ts` and `src/sim/AIStrategy.ts`
 * were copied aside; the HEAD versions were written over them from
 * `git show HEAD:` (NOT `git stash`, which is banned here — it is one ref per
 * REPOSITORY and has twice eaten a parallel worktree's work); the churning rig
 * below was captured on that pristine build with no aircraft in it; and the
 * working copies were restored and re-verified by SHA-256. Twelve ground-only
 * streams — four rungs x three subject health fractions — came back
 * BYTE-IDENTICAL, 12 of 12, at 1 / 62 / 111 / 180 commands for Easy / Normal /
 * Hard / Brutal over 200 squad passes. Easy's one command is the scout's
 * `SetStance`, which is what that rung issuing nothing looks like.
 *
 * WHAT IS GATED HERE IS THE PROPERTY, NOT THAT MEASUREMENT. Pinning the golden
 * stream as a literal would be un-retakeable the moment the reverted build is
 * gone, and the only way to fix a red one would be to copy whatever the new
 * build produced — a pin that cannot fail honestly. Instead: swapping ONE
 * full-health hull's locomotor to `Air` must not change one byte. That hull is
 * spawned in the same order, at the same position, with the same health, so
 * `locomotor` is the only input that differs, and it is read by the strike-group
 * loop on every pass. If the roll ever escapes its guard, this goes red.
 * ========================================================================== */

/**
 * A long CHURNING run, so the ground roll is drawn on nearly every pass.
 *
 * The obvious rig — wound four tanks and run — draws almost nothing: the rout
 * cap saturates within three passes and the cap test `return`s AHEAD of
 * `rng.chance`, so the whole 40-pass run consumed four draws and four commands.
 * That is a weak thing to call an RNG-identity proof. Healing everybody to full
 * each pass releases the withdrawn hulls (`rejoinHpFraction`), `regroupSquads`
 * re-files them, and the fresh wound below gives the next pass a candidate — so
 * the cap never saturates and a draw happens nearly every pass.
 */
function identityTrace(difficulty: number, subjectIsAir: boolean, subjectFrac: number): string {
  const h = makeHarness(difficulty);
  h.hull(false); h.hull(false);
  const ground: EntityId[] = [];
  for (let k = 0; k < 10; k++) ground.push(h.hull(false));
  const subject = h.hull(subjectIsAir);
  h.step(WARMUP);
  for (let p = 0; p < 200; p++) {
    h.keepUnderFire();
    for (const g of ground) h.heal(g, 1.0);
    h.wound(ground[p % ground.length], 0.25);
    h.wound(ground[(p + 3) % ground.length], 0.20);
    h.heal(subject, subjectFrac);
    h.step(PASS);
  }
  return h.trace().join('\n');
}

describe('the extra draw is reached only when there is a wounded aircraft', () => {
  it('is byte-identical when the only aircraft is at full health', () => {
    for (const rung of [NORMAL, HARD, BRUTAL]) {
      const ground = identityTrace(rung, false, 1.0);
      const air = identityTrace(rung, true, 1.0);
      expect(ground.length, `rung ${rung} issued nothing — nothing to compare`)
        .toBeGreaterThan(0);
      expect(air, `rung ${rung}: a healthy aircraft moved the trace`).toBe(ground);
    }
  });

  it('FALSIFIER: the same swap on a WOUNDED hull does change the trace', () => {
    // Without this, the case above passes against an instrument that cannot see
    // `locomotor` at all.
    const ground = identityTrace(NORMAL, false, 0.45);
    const air = identityTrace(NORMAL, true, 0.45);
    expect(air).not.toBe(ground);
  });

  it('and the full-health trace is the trace a 45% TANK produces', () => {
    // 0.45 is above `hpFraction`, so a ground hull at 0.45 is not a candidate
    // either — the two rigs must agree, which is what makes the falsifier above
    // attributable to the AIR branch rather than to the wound.
    expect(identityTrace(NORMAL, false, 0.45)).toBe(identityTrace(NORMAL, false, 1.0));
  });
});

/* ==========================================================================
 * §8 — A WITHDRAWN AIRCRAFT DOES NOT SPEND THE GROUND LINE'S SLOT
 *
 * The exemption in `AI_RETREAT.maxFraction` is worthless if it holds only for
 * the pass that issues the order. `withdrawing` is recounted from the tags
 * every pass, so an airframe sitting at the rally occupied one of the ground
 * line's slots for as long as it stayed there — measured at exactly one lost
 * ground withdrawal at every strike-group size tried, which is why the release
 * branch skips `Locomotor.Air`.
 * ========================================================================== */

describe('the aircraft is exempt from the cap for as long as it is away', () => {
  it('costs the ground line nothing, at four strike-group sizes', () => {
    for (const n of [14, 20, 30, 40]) {
      const out: number[] = [];
      for (const airFrac of [1.0, 0.45]) {
        const h = makeHarness(BRUTAL);
        h.hull(false); h.hull(false);
        const ground: EntityId[] = [];
        for (let k = 0; k < n; k++) ground.push(h.hull(false));
        const air = h.hull(true);
        h.step(WARMUP);
        h.wound(air, airFrac);
        for (let k = 0; k < n; k++) h.wound(ground[k], 0.25);
        for (let p = 0; p < 60; p++) { h.keepUnderFire(); h.step(PASS); }
        expect(h.pullouts(air).length, `n=${n}: the aircraft did not do its half`)
          .toBe(airFrac < AI_RETREAT.airHpFraction ? 1 : 0);
        out.push(ground.filter((g) => h.pullouts(g).length > 0).length);
      }
      expect(out[0], `n=${n}: the cap let nobody out`).toBeGreaterThan(0);
      expect(out[1], `n=${n}: the withdrawn aircraft spent a ground slot`).toBe(out[0]);
    }
  });
});
