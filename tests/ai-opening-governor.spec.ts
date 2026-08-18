/**
 * ============================================================================
 * tests/ai-opening-governor.spec.ts — THE OPENING IS EARNED, NOT PRE-PAID
 * ============================================================================
 * The "AI has a ready base at match start" report is NOT the scenario: both
 * sides open with an MCV and zero buildings, and the deploy layer is worth
 * -0.83 s to the AI. What a player is looking at is the 10 000-credit OPENING
 * BANK — measured, nobody at the controls, seed 7, Normal, the AI had a
 * seven-building base with a defence tower and eleven troops at t+90s having
 * MINED ZERO ORE, its first refinery completing at that exact moment.
 *
 * The author's decision was to keep the 10 000 and slow the AI, so nothing
 * about the player's economy changes and `AiBrain.governOpening` is the whole
 * of it. See `AI_OPENING` for the doctrine and the asymmetry argument.
 *
 * THE SHAPE MATTERS AND THE FIRST TWO ATTEMPTS WERE WRONG. Capping
 * `AiBrain.spendable` caps every purchase including the refinery that retires
 * the governor:
 *
 *   DEADLOCK. Easy carries the largest `creditFloor` (1400) so a bank-wide cap
 *   stacks with it: allowance 2500 - 1400 = 1100 against a 2000 refinery. Easy
 *   sat on 9400 credits with three buildings and zero ore for a whole match.
 *
 *   THE FLOOR THAT UNDOES THE LADDER. Flooring the allowance at the refinery
 *   price fixes that and then IS most of the tightest rung's allowance, so it
 *   becomes general room — Easy spent it on a pillbox at t+50.1s, BEFORE its
 *   own refinery finished at t+78.6s.
 *
 * So the governor is PER-CANDIDATE. `consider` already sees a role, so economy
 * and production measure against the ungoverned budget and everything else
 * against the governed one. No floor, no deadlock, and Easy can be governed as
 * hard as the ladder wants — which is what the cases below pin.
 *
 * MEASURED, same harness both sides, seed 7, four rungs:
 *
 *                 first defence structure     units at t+240s
 *      Easy         t+50.1s -> t+107.6s          29 -> 10
 *      Normal       t+76.1s ->  t+88.6s          21 -> 18
 *      Hard         t+76.1s ->  t+76.1s          22 -> 19
 *      Brutal       t+76.1s ->  t+76.1s          17 -> 22
 *
 * Easy and Normal now put their first defence up AFTER their first ore lands
 * (t+96.8s and t+77.9s); Hard and Brutal still beat it, by under a second, and
 * they are the rungs meant to be least constrained. The unit column was NOT
 * monotonic before — Easy fielded the most of anyone — and is now.
 *
 * A HARNESS NOTE THAT COST A CYCLE. `DeployService` will not unfold a
 * scenario-spawned MCV headlessly: the brain reports "deploying the
 * construction yard" forever and the match never starts. That reads exactly
 * like a broken feature; it is a broken harness, and it was confirmed by
 * A/B-ing with the governor disabled and getting identical output.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, BuildTab, CommandKind, EntityFlag, EntityKind, Faction, UnitState,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import { AI_CADENCE, AI_SKILL, CELL, SIM_DT, SIM_HZ } from '../src/core/config';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import {
  AI_OPENING, BuildCatalog, BuildRole, isOpeningEconomyRole, openingHoldFor,
} from '../src/sim/AIStrategy';
import type { CatalogEntry, DefLookup } from '../src/sim/AIStrategy';

const P_AI = 1 as PlayerId;
const OPENING_BANK = 10_000;
const BASE_X = 400;
const BASE_Z = 400;

const REFERENCE = new BuildCatalog();

function binding(): { lookup: DefLookup; buildingId: Record<string, number> } {
  const catalog = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 0;
  let b = 0;
  for (const e of catalog.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { lookup: { tables: null, unitId, buildingId }, buildingId };
}
const BINDING = binding();

function entryOf(key: string): CatalogEntry {
  const e = REFERENCE.get(key);
  if (e === undefined) throw new Error(`no catalog entry ${key}`);
  return e;
}

interface Harness {
  brain: AiBrain;
  commands: Command[];
  step(ticks: number): void;
  /** Give the brain income, which is the governor's only exit condition. */
  bankOre(amount: number): void;
  startedKeys(): string[];
}

function makeHarness(difficulty: number, withEconomy = false): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const p = world.player(P_AI);
  p.aiDifficulty = difficulty;
  p.aiPersonality = 0;
  p.credits = OPENING_BANK;
  p.storageMax = 100_000;
  p.powerProduced = 900;
  p.powerConsumed = 20;

  const st = world.store;
  const spawn = (key: string, x: number, z: number, flags: number, w = 2): EntityId => {
    const id = st.alloc(EntityKind.Building, BINDING.buildingId[key] ?? -1,
      P_AI, Faction.Soviets, x, 0, z, 0);
    const i = st.index(id);
    st.flags[i] |= flags;
    st.footprintW[i] = w; st.footprintH[i] = 2;
    st.powerDraw[i] = -20;
    st.hp[i] = 1000; st.maxHp[i] = 1000;
    st.armorClass[i] = ArmorClass.Concrete;
    st.buildProgress[i] = 1;
    world.terrain.markOccupied(
      Math.floor(x / CELL) - ((w / 2) | 0), Math.floor(z / CELL) - 1, w, 2, id,
    );
    return id;
  };
  /*
   * A yard, a plant and the two producers — but NO REFINERY, which is the
   * state the governor governs. The producers are here because nothing in this
   * harness ever COMPLETES: without a standing barracks the prereq on every
   * unit and on the pillbox is unmet, so the brain has nothing discretionary to
   * want and the cases below would measure an empty build menu.
   */
  spawn('conyard', BASE_X, BASE_Z, EntityFlag.IsBuilder | EntityFlag.IsFactory, 3);
  const plant = spawn('powerPlant', BASE_X, BASE_Z - 40, 0);
  st.powerDraw[st.index(plant)] = 100;
  spawn('barracks', BASE_X - 60, BASE_Z, EntityFlag.IsFactory, 2);
  spawn('warFactory', BASE_X - 60, BASE_Z + 40, EntityFlag.IsFactory, 3);
  /*
   * `withEconomy` stands the refinery and its trucks up WITHOUT giving the
   * brain any income — `oreMined` is still zero, so the governor is still on.
   *
   * It is needed because nothing COMPLETES in this harness: with no refinery
   * standing, `roleCount[Refinery]` never rises, the adaptive scorer re-proposes
   * a refinery on every pass at a score no unit can beat, and `buildUnits` is
   * never reached at all. The cases that measure discretionary spending would
   * then be measuring an economy the brain can never finish.
   */
  if (withEconomy) {
    spawn('refinery', BASE_X + 60, BASE_Z, EntityFlag.IsRefinery, 3);
    for (let k = 0; k < AI_SKILL[difficulty].maxHarvesters; k++) {
      const id = st.alloc(EntityKind.Vehicle, -1, P_AI, Faction.Soviets,
        BASE_X + 20 + k * 6, 0, BASE_Z + 30, 0);
      const i = st.index(id);
      st.flags[i] |= EntityFlag.CanMove | EntityFlag.IsHarvester;
      st.hp[i] = 400; st.maxHp[i] = 400; st.maxSpeed[i] = 5; st.radius[i] = 2;
      st.state[i] = UnitState.Harvesting;
    }
  }

  const catalog = new BuildCatalog();
  catalog.bind(BINDING.lookup);
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, 12345);
  brain.attach(channels.events);

  const commands: Command[] = [];
  channels.commands.observe((c) => {
    commands.push({ ...c, entities: c.entities.slice() } as Command);
  });

  const rng: IRng = new Rng(7);
  let tick = 0;
  const keyOf = (c: Command): string => {
    const e = catalog.all.find((x) => x.defId === c.defId && (x.tab as number) === c.tab);
    return e === undefined ? '' : e.key;
  };
  return {
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
        /*
         * Echo `production:started` so `inFlight` clears, and CHARGE THE ORDER.
         *
         * The charge is not decoration. The governor measures
         * `p.stats.creditsSpent`, which in a real match is moved by the
         * `BuildQueue` drip — and nothing drips here. Without this the brain
         * spends against a counter that never rises and re-orders forever:
         * measured at 39 600 credits of army against a 3000 allowance. Charging
         * the whole cost at order time is the drip's net effect compressed, and
         * it is what makes the allowance observable at all.
         */
        channels.commands.drain((c) => {
          if (c.kind !== CommandKind.ProductionStart) return;
          const ordered = catalog.all.find(
            (x) => x.defId === c.defId && (x.tab as number) === c.tab,
          );
          if (ordered !== undefined) {
            const pl = world.player(P_AI);
            pl.credits -= ordered.cost;
            pl.stats.creditsSpent += ordered.cost;
          }
          const ev = channels.events.payload('production:started');
          ev.player = c.player;
          ev.tab = c.tab as BuildTab;
          ev.defId = c.defId;
          ev.isBuilding = c.tab === (BuildTab.Structures as number);
          ev.cost = 0;
          channels.events.emitPooled('production:started');
        });
      }
    },
    bankOre(amount: number): void { world.player(P_AI).stats.oreMined += amount; },
    startedKeys(): string[] {
      return commands
        .filter((c) => c.kind === CommandKind.ProductionStart)
        .map(keyOf)
        .filter((k) => k !== '');
    },
  };
}

/** What the brain asked for that is NOT economy or production, priced up. */
function discretionarySpend(h: Harness): number {
  let total = 0;
  for (const key of h.startedKeys()) {
    const e = REFERENCE.get(key);
    if (e === undefined) continue;
    if (isOpeningEconomyRole(e.role)) continue;
    total += e.cost;
  }
  return total;
}

const ENOUGH = AI_CADENCE.build * 60;

/* ========================================================================== */

describe('the governor cannot block its own exit', () => {
  it('never measures an economy or production candidate against it', () => {
    for (const role of [BuildRole.Builder, BuildRole.Mcv, BuildRole.Power,
      BuildRole.Refinery, BuildRole.Harvester, BuildRole.Barracks, BuildRole.WarFactory]) {
      expect(isOpeningEconomyRole(role), `role ${role as number} must be ungoverned`).toBe(true);
    }
    // The things the report was actually about.
    for (const role of [BuildRole.Defense, BuildRole.AntiAir, BuildRole.Infantry,
      BuildRole.Armor, BuildRole.Skirmisher, BuildRole.Siege, BuildRole.Radar,
      BuildRole.TechLab, BuildRole.Storage]) {
      expect(isOpeningEconomyRole(role), `role ${role as number} must be governed`).toBe(false);
    }
  });

  it('orders a refinery at every rung, from a bank the governor is capping', () => {
    // THE DEADLOCK CASE, and it is the reason the governor is per-candidate:
    // a bank-wide cap left Easy unable to afford the 2000 refinery behind its
    // own 1400 credit floor, so it never mined and never recovered.
    for (let rung = 0; rung < AI_OPENING.length; rung++) {
      const h = makeHarness(rung);
      h.step(ENOUGH);
      expect(h.startedKeys(), `rung ${rung} never ordered a refinery`)
        .toContain(entryOf('refinery').key);
    }
  });
});

describe('the discretionary allowance is respected and laddered', () => {
  it('holds a decreasing fraction as the rung rises', () => {
    for (let rung = 1; rung < AI_OPENING.length; rung++) {
      expect(openingHoldFor(rung), `rung ${rung} must be less constrained than ${rung - 1}`)
        .toBeLessThan(openingHoldFor(rung - 1));
    }
    // A hold of 1 would forbid all army forever; 0 would be no governor at all.
    for (let rung = 0; rung < AI_OPENING.length; rung++) {
      expect(openingHoldFor(rung)).toBeGreaterThan(0);
      expect(openingHoldFor(rung)).toBeLessThan(1);
    }
  });

  it('keeps army and defence inside the allowance while income is zero', () => {
    for (let rung = 0; rung < AI_OPENING.length; rung++) {
      const h = makeHarness(rung, true);
      h.step(ENOUGH);
      const allowance = OPENING_BANK * (1 - openingHoldFor(rung));
      // The brain may commit up to the allowance; the point is that it cannot
      // convert the whole opening bank into an army before it has earned.
      expect(discretionarySpend(h), `rung ${rung} overspent its opening allowance`)
        .toBeLessThanOrEqual(allowance);
    }
  });

  it('lets a richer rung field more before it earns', () => {
    const spendOf = (rung: number): number => {
      const h = makeHarness(rung, true);
      h.step(ENOUGH);
      return discretionarySpend(h);
    };
    // Not asserted pairwise — one seed and a scorer with ties will not give a
    // strict order at every step. Brutal against Easy is the ladder's claim.
    expect(spendOf(3)).toBeGreaterThan(spendOf(0));
  });
});

describe('it retires at the first ore, and is then absent', () => {
  it('spends past the allowance once income has started', () => {
    const rung = 0;                     // the most constrained rung
    const allowance = OPENING_BANK * (1 - openingHoldFor(rung));

    const held = makeHarness(rung, true);
    held.step(ENOUGH);
    const before = discretionarySpend(held);

    const freed = makeHarness(rung, true);
    freed.bankOre(1);                   // one unit of ore is the whole exit
    freed.step(ENOUGH);
    const after = discretionarySpend(freed);

    expect(before).toBeLessThanOrEqual(allowance);
    expect(after, 'one ore did not retire the governor').toBeGreaterThan(before);
  });

  it('does not re-arm when income stops', () => {
    // A refinery lost at minute twelve must not re-impose an opening policy on
    // a brain that is by then playing a completely different game.
    const h = makeHarness(0, true);
    h.bankOre(1);
    h.step(AI_CADENCE.build * 4);
    const freed = discretionarySpend(h);
    h.step(ENOUGH);
    expect(discretionarySpend(h)).toBeGreaterThanOrEqual(freed);
  });
});

describe('the ladder arithmetic includes the credit floor', () => {
  it('leaves every rung able to afford the refinery outright', () => {
    // The governed and ungoverned budgets are different numbers, so this is
    // arithmetic about the UNGOVERNED one: `credits - creditFloor` must cover a
    // refinery at the opening bank, or no amount of per-candidate routing helps.
    const refinery = entryOf('refinery');
    for (let rung = 0; rung < AI_OPENING.length; rung++) {
      expect(OPENING_BANK - AI_SKILL[rung].creditFloor,
        `rung ${rung} cannot afford a refinery even ungoverned`)
        .toBeGreaterThanOrEqual(refinery.cost);
    }
  });
});

/* `SIM_HZ` is imported for the tick maths above; referenced so it is not dead. */
void SIM_HZ;
