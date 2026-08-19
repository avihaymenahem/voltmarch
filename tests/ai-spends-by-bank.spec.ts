/**
 * ============================================================================
 * tests/ai-spends-by-bank.spec.ts — THE AI BUYS WHAT ITS MONEY IS FOR
 * ============================================================================
 * Reported as *"AI building capabilities should be according to his money"*.
 * Two defects, both in `AiBrain.chooseBuild`, both about the relationship
 * between the bank and what gets ordered.
 *
 *   1. A CANDIDATE THE BANK COULD NOT YET COVER WAS DROPPED, not saved for.
 *      `consider` ran one test for two different refusals — "the tab is full"
 *      and "I cannot pay for this yet" — and the caller then fell through to
 *      `buildUnits`, which buys the cheapest thing that scores well. So the
 *      highest-return purchase in the game lost every single pass to a
 *      rifleman: 1400 against 200, forever. Measured on a 16 sim-minute Normal
 *      match, the brain's own `wantHarvesters` sat at 8 while it bought 93
 *      riflemen and 3 harvesters, its fleet fell 7 -> 1, and `oreMined` FROZE
 *      for the last three minutes. The reserve already existed twice — the
 *      scripted opening holds its next step's price, `AI_REBUILD.bankFraction`
 *      holds an MCV's — and CLAUDE.md calls it "the half that makes it work"
 *      both times. It was missing from the layer that spends the whole match.
 *
 *   2. PRODUCTION THROUGHPUT WAS A CONSTANT. `src/sim/BuildQueue.ts` gives the
 *      queue to the PLAYER, so a second Barracks does not open a second queue —
 *      it makes the one queue `FACTORY_SPEED_BONUS` faster, compounding to
 *      `FACTORY_SPEED_CAP`. That is the game's money-for-tempo trade and both
 *      sides have it. `chooseBuild` proposed a barracks or a war factory ONLY
 *      while it owned none, so an AI holding 60 000 credits ran the identical
 *      production line as one holding 600. Measured on a 14 sim-minute Brutal
 *      match opened with 60 000: of 925 build passes taken with 5000+ banked,
 *      903 were refused because BOTH unit tabs were already full.
 *
 * WHAT IS PINNED HERE, and why each one is the case that would rot:
 *
 *   - the reserve fires at all, and is GRADUATED rather than a switch — total
 *     when the brain is far short, a trickle as it closes the gap. A total hold
 *     would stop army production outright every time the brain wanted a
 *     refinery, which is the failure the scripted opening's comment is about;
 *   - it cannot deadlock. A price above `storageMax - creditFloor` can never
 *     become affordable, so it is not a saving target;
 *   - EASY DOES NOT BUY EXTRA PRODUCERS. That rung's whole design is that it
 *     leaves gaps in its queue (`AI_SKILL`'s own note), and the first version
 *     of this change had an Easy brain buying a second barracks off its opening
 *     bank — exactly the flat ladder that table exists to stop;
 *   - the economy is finished FIRST, and the ceiling is the game's own
 *     saturation point rather than a number somebody typed.
 *
 * Fast and seed-free, on the `tests/ai-rebuild.spec.ts` harness: no terrain, no
 * production service, no GL. The end-to-end numbers quoted above come from a
 * real match and are facts about one seed; what lives here is what must never
 * regress silently.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, BuildTab, CommandKind, EntityFlag, EntityKind, Faction, UnitState,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import {
  AI_CADENCE, AI_SKILL, CELL, FACTORY_SPEED_BONUS, FACTORY_SPEED_CAP, SIM_DT,
} from '../src/core/config';
import { factorySpeed } from '../src/sim/BuildQueue';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import {
  AI_PRODUCERS, AI_SAVING, BuildCatalog, BuildRole, EXTRA_PRODUCERS,
} from '../src/sim/AIStrategy';
import type { CatalogEntry, DefLookup } from '../src/sim/AIStrategy';

const P_AI = 1 as PlayerId;

const EASY = 0;
const NORMAL = 1;
const BRUTAL = 3;

/** Enough build passes for the layer to have run many times. */
const ENOUGH_TICKS = AI_CADENCE.build * 20;

/** Ids for every catalog key, so `entryForBuilding`/`forRole` resolve. */
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

const REFERENCE = new BuildCatalog();

function entryFor(role: BuildRole): CatalogEntry {
  const e = REFERENCE.forRole(role, Faction.Soviets);
  if (e === undefined) throw new Error(`no catalog entry for role ${role}`);
  return e;
}

/**
 * `w` defaults to 2 and the WAR FACTORY MUST PASS 3 — `AiBrain.roleOfBuilding`
 * separates the two `IsFactory` structures by width, so a 2-wide factory counts
 * as a barracks. Same rule and same reason as `tests/ai-rebuild.spec.ts`.
 */
function spawnBuilding(
  world: World, owner: PlayerId, x: number, z: number, flags: number, w = 2,
): EntityId {
  const st = world.store;
  const id = st.alloc(EntityKind.Building, -1, owner, Faction.Soviets, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= flags;
  st.footprintW[i] = w;
  st.footprintH[i] = 2;
  st.powerDraw[i] = -20;
  st.maxHp[i] = 1000;
  st.hp[i] = 1000;
  st.armorClass[i] = ArmorClass.Concrete;
  st.buildProgress[i] = 1;
  world.terrain.markOccupied(
    Math.floor(x / CELL) - ((w / 2) | 0), Math.floor(z / CELL) - 1, w, 2, id,
  );
  return id;
}

/** `powerDraw > 0` is what `roleOfBuilding` reads as a generator. */
function spawnPowerPlant(world: World, owner: PlayerId, x: number, z: number): EntityId {
  const id = spawnBuilding(world, owner, x, z, 0);
  world.store.powerDraw[world.store.index(id)] = 100;
  return id;
}

/**
 * A harvester that is already MINING.
 *
 * The state matters: `AiBrain.economy` walks every harvester it owns and points
 * an IDLE one at the nearest ore, and this harness has no ore field to find.
 * A busy truck is skipped, which is what keeps these cases about the build
 * layer rather than about `EmptyOreField`.
 */
function spawnHarvester(world: World, owner: PlayerId, x: number, z: number): EntityId {
  const st = world.store;
  const id = st.alloc(EntityKind.Vehicle, -1, owner, Faction.Soviets, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove | EntityFlag.IsHarvester;
  st.hp[i] = 400;
  st.maxHp[i] = 400;
  st.maxSpeed[i] = 5;
  st.radius[i] = 2;
  st.state[i] = UnitState.Harvesting;
  return id;
}

interface Harness {
  world: World;
  brain: AiBrain;
  commands: Command[];
  step(ticks: number): void;
  /**
   * Run the SCRIPTED OPENING out, then forget everything it asked for.
   *
   * `chooseBuild` step 3 walks `openingFor(faction, personality)` and returns
   * whatever comes next, without ever asking whether the base already owns one
   * — the script assumes a fresh yard, which is correct in a match and is
   * exactly wrong for a harness that hands the brain a finished base. Without
   * this every case below measures the opening: a barracks it ordered from the
   * script is indistinguishable from one `considerExtraProducers` bought.
   */
  settle(): void;
  setCredits(n: number): void;
  /** Fill a tab's queue to this rung's cap, so `queueSaturated` is true. */
  saturate(tab: BuildTab, difficulty: number): void;
  starts(key: string): number;
  unitStarts(): number;
}

interface BaseSpec {
  difficulty?: number;
  /** Index into `AI_PERSONALITY`. 1 is the Rusher — see `richBase`. */
  personality?: number;
  credits?: number;
  storageMax?: number;
  refineries?: number;
  harvesters?: number;
  barracks?: number;
  warFactories?: number;
}

function makeHarness(spec: BaseSpec = {}): Harness {
  const difficulty = spec.difficulty ?? NORMAL;
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const p = world.player(P_AI);
  p.aiDifficulty = difficulty;
  p.aiPersonality = spec.personality ?? 0;
  p.credits = spec.credits ?? 20_000;
  // The real cap rises to cover the opening bank (`Economy.capFloor`), so a
  // match never sits at `BASE_STORAGE`. A bare `World` does, which would put
  // every price above `savingCeiling()` and quietly disable the reserve.
  p.storageMax = spec.storageMax ?? 100_000;
  p.powerProduced = 800;
  p.powerConsumed = 20;

  /*
   * THE FURNITURE EVERY CASE NEEDS, and each piece closes a branch that would
   * otherwise take the one Structures slot and make these cases about
   * something else:
   *
   *   the Construction Yard, or `build()` takes the crippled path and never
   *   reaches the adaptive scorer at all;
   *   a power plant, because a second barracks names `powerPlant` as a prereq;
   *   a radar, because the tech branch scores 1.0 x tech and would win every
   *   pass until one exists.
   */
  spawnBuilding(world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
  spawnPowerPlant(world, P_AI, 400, 360);
  spawnBuilding(world, P_AI, 460, 400, EntityFlag.IsRadar);
  for (let k = 0; k < (spec.refineries ?? 0); k++) {
    spawnBuilding(world, P_AI, 340 + k * 24, 400, EntityFlag.IsRefinery);
  }
  for (let k = 0; k < (spec.barracks ?? 0); k++) {
    spawnBuilding(world, P_AI, 340 + k * 24, 440, EntityFlag.IsFactory, 2);
  }
  for (let k = 0; k < (spec.warFactories ?? 0); k++) {
    spawnBuilding(world, P_AI, 340 + k * 24, 480, EntityFlag.IsFactory, 3);
  }
  for (let k = 0; k < (spec.harvesters ?? 0); k++) {
    spawnHarvester(world, P_AI, 420 + k * 6, 420);
  }

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, 12345);
  brain.attach(channels.events);

  const commands: Command[] = [];
  channels.commands.observe((c) => {
    commands.push({ ...c, entities: c.entities.slice() } as Command);
  });

  const rng: IRng = new Rng(7);
  let tick = 0;
  const keyOf = (c: Command): string => {
    const e = catalog.all.find(
      (x) => x.defId === c.defId && (x.tab as number) === c.tab,
    );
    return e === undefined ? '' : e.key;
  };
  return {
    world,
    brain,
    commands,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        brain.tick(s);
        // Nothing BUILDS on purpose: these cases are about what the brain ASKS
        // for. `drain` is what fires the observer tap.
        //
        // The one thing that is echoed back is `production:started`, because
        // `AiBrain.inFlight` is only cleared by that event or by a 300-tick
        // timeout. Swallowing it would let one order block its whole tab for
        // ten seconds of harness time and turn every case here into a test of
        // `AI_BUILD.requestTimeoutTicks`.
        channels.commands.drain((c) => {
          if (c.kind !== CommandKind.ProductionStart) return;
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
    settle(): void {
      this.step(AI_CADENCE.build * 80);
      commands.length = 0;
    },
    setCredits(n: number): void {
      world.player(P_AI).credits = n;
    },
    saturate(tab: BuildTab, diff: number): void {
      const q = world.player(P_AI).queues[tab as number];
      const cap = AI_SKILL[diff].queueDepth;
      while (q.items.length < cap) {
        q.items.push({
          defId: -1, isBuilding: false, progress: 0.1, spent: 0, cost: 100,
          ready: false, onHold: false,
        });
      }
    },
    starts(key: string): number {
      return commands.filter(
        (c) => c.kind === CommandKind.ProductionStart && keyOf(c) === key,
      ).length;
    },
    unitStarts(): number {
      return commands.filter(
        (c) => c.kind === CommandKind.ProductionStart
          && (c.tab === (BuildTab.Infantry as number) || c.tab === (BuildTab.Vehicles as number)),
      ).length;
    },
  };
}

/* ========================================================================== */

describe('the ceiling on extra producers is the game\'s own, not a typed number', () => {
  it('is the count at which the factory-speed bonus saturates', () => {
    expect(factorySpeed(AI_PRODUCERS.maxUseful)).toBe(FACTORY_SPEED_CAP);
    expect(factorySpeed(AI_PRODUCERS.maxUseful - 1)).toBeLessThan(FACTORY_SPEED_CAP);
  });

  it('moves with the two constants that decide it', () => {
    // Not a tautology: it fails the moment somebody writes a literal here.
    expect(AI_PRODUCERS.maxUseful)
      .toBe(1 + Math.ceil((FACTORY_SPEED_CAP - 1) / FACTORY_SPEED_BONUS));
  });

  it('names only producers that exist for every army, each with the tab it speeds', () => {
    const armies = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim];
    for (const row of EXTRA_PRODUCERS) {
      for (const f of armies) {
        const e = REFERENCE.forRole(row.role, f);
        // `BuildRole` is a const enum, so its reverse map is illegal under
        // `isolatedModules` — the `TS2476` that shipped a red CI once already.
        expect(e, `no producer for role ${row.role as number} faction ${f as number}`)
          .toBeDefined();
        expect(e?.isBuilding).toBe(true);
        // The tab it SERVICES is a unit tab, and never the tab it is built from.
        expect(row.tab === BuildTab.Infantry || row.tab === BuildTab.Vehicles).toBe(true);
        expect(e?.tab).not.toBe(row.tab);
      }
    }
  });
});

describe('a candidate the bank cannot cover yet is saved for, not dropped', () => {
  /**
   * ONE REFINERY, NO TRUCKS. `wantHarvesters` is then non-zero and the
   * harvester is the top-scoring candidate in the pass (1.6 x economy, against
   * 1.05 for a second refinery and 0.4 for defence), so what the brain does
   * with a bank below its price is the whole experiment.
   */
  const harvester = entryFor(BuildRole.Harvester);

  /*
   * THE RUSHER AGAIN, and for the same reason as `richBase`: `pers.defense` 0.5
   * puts a pillbox (0.4 + pressure, x defense) under the 0.35 banking floor, so
   * the harvester is genuinely the only candidate in the pass. With the Turtle's
   * 1.6 the brain buys an affordable pillbox every pass instead, `bestEntry` is
   * never null, and the reserve is never reached — which measures the defence
   * scorer rather than this rule.
   */

  /**
   * A bank short by MORE than the held fraction, so the leftover is negative
   * and the hold is total. Shared with the ceiling case below, which changes
   * nothing but `storageMax` — that pair is the whole argument that the guard
   * is a guard and not a second way of refusing to save.
   */
  const SHORT_BANK = AI_SKILL[NORMAL].creditFloor
    + Math.round(harvester.cost * AI_SAVING.holdFraction) - 500;

  it('buys nothing at all while it is a long way short', () => {
    const credits = SHORT_BANK;
    const h = makeHarness({ difficulty: NORMAL, personality: 1, refineries: 1, barracks: 1, warFactories: 1 });
    h.settle();
    h.setCredits(credits);
    h.step(ENOUGH_TICKS);

    // The defect: this bank used to become riflemen, 200 credits at a time.
    expect(h.unitStarts(), 'the bank was spent on army instead of held').toBe(0);
    expect(h.brain.savedPassCount).toBeGreaterThan(0);
    expect(h.brain.intent().economy).toContain(harvester.key);
  });

  it('keeps a trickle of army going once it is nearly there', () => {
    const floor = AI_SKILL[NORMAL].creditFloor;
    // Short of the price, but comfortably past the held fraction of it.
    const credits = floor + harvester.cost - 100;
    const h = makeHarness({ difficulty: NORMAL, personality: 1, refineries: 1, barracks: 1, warFactories: 1 });
    h.settle();
    h.setCredits(credits);
    h.step(ENOUGH_TICKS);

    expect(h.brain.savedPassCount, 'the reserve did not fire').toBeGreaterThan(0);
    // GRADUATED, NOT A SWITCH. A total hold here would stop the ramp dead.
    expect(h.unitStarts(), 'army production stopped entirely').toBeGreaterThan(0);
    expect(h.starts(harvester.key), 'it bought the thing it could not afford').toBe(0);
  });

  it('buys it outright the moment the bank covers it', () => {
    const floor = AI_SKILL[NORMAL].creditFloor;
    const h = makeHarness({ difficulty: NORMAL, personality: 1, refineries: 1, barracks: 1, warFactories: 1 });
    h.settle();
    h.setCredits(floor + harvester.cost + 10);
    h.step(ENOUGH_TICKS);

    expect(h.starts(harvester.key)).toBeGreaterThan(0);
  });

  it('never holds a price the bank could not physically reach', () => {
    /*
     * `Economy.grant` clamps at `storageMax`, so a price above
     * `storageMax - creditFloor` can NEVER become affordable. Holding it back
     * would stop army production for the rest of the match — the one way this
     * reserve could deadlock rather than merely take a while.
     */
    // THE SAME BANK as "buys nothing at all while it is a long way short", and
    // the only difference is the ceiling. That case buys no units; this one
    // must, or the brain is stalled on a purchase it can never make.
    //
    // The ceiling sits under the harvester's price and the bank sits under
    // `AI_ECONOMY.siloFillFraction` of the ceiling — otherwise the brain
    // correctly decides its problem is STORAGE and buys a silo every pass,
    // which would make this a test of that branch.
    const storageMax = AI_SKILL[NORMAL].creditFloor + harvester.cost - 100;
    const h = makeHarness({
      difficulty: NORMAL, personality: 1,
      storageMax,
      refineries: 1, barracks: 1, warFactories: 1,
    });
    expect(SHORT_BANK).toBeLessThan(storageMax * 0.85);
    h.settle();
    h.setCredits(SHORT_BANK);
    h.step(ENOUGH_TICKS);

    expect(h.brain.intent().economy).not.toContain(harvester.key);
    expect(h.unitStarts(), 'it stalled on a purchase it can never make').toBeGreaterThan(0);
  });
});

describe('a bank running ahead of the line buys another door', () => {
  /** Economy finished, both unit tabs full, money to burn. */
  function richBase(difficulty: number, extra: Partial<BaseSpec> = {}): Harness {
    const skill = AI_SKILL[difficulty];
    const h = makeHarness({
      difficulty,
      // THE RUSHER, and it is load-bearing rather than flavour. `pers.tech` 0.6
      // puts the Proving Ground (0.9 x tech x techBias) and the Command Post
      // (`AI_POWER_BUY.score` 1.25 x tech) below `AI_PRODUCERS.score`, so the
      // one Structures slot is genuinely free and these cases measure the
      // producer rule rather than the tech ladder's turn order.
      personality: 1,
      credits: 40_000,
      refineries: skill.maxRefineries,
      harvesters: skill.maxHarvesters,
      barracks: 1,
      warFactories: 1,
      ...extra,
    });
    // The scripted opening first, and forgotten — it orders a barracks off the
    // script whatever the base already owns, which would be indistinguishable
    // from the purchase these cases are about.
    h.settle();
    h.saturate(BuildTab.Infantry, difficulty);
    h.saturate(BuildTab.Vehicles, difficulty);
    return h;
  }

  it('orders a second barracks and a second war factory', () => {
    const h = richBase(BRUTAL);
    h.step(ENOUGH_TICKS);

    const total = h.starts(entryFor(BuildRole.Barracks).key)
      + h.starts(entryFor(BuildRole.WarFactory).key);
    expect(total, 'a rich brain with full queues bought no extra producer').toBeGreaterThan(0);
  });

  it('will not, on the rung that does not keep one queue full', () => {
    // Easy's `queueDepth` is 1, so `queueSaturated` is satisfied by a single
    // item — the saturation gate means nothing there. Measured without this
    // guard: an Easy AI bought a second barracks off its opening bank.
    expect(AI_SKILL[EASY].queueDepth).toBe(1);
    const h = richBase(EASY);
    h.step(ENOUGH_TICKS);

    expect(h.starts(entryFor(BuildRole.Barracks).key)).toBe(0);
    expect(h.starts(entryFor(BuildRole.WarFactory).key)).toBe(0);
  });

  it('will not while a harvester is still wanted', () => {
    const h = richBase(BRUTAL, { harvesters: 0 });
    h.step(ENOUGH_TICKS);

    expect(h.starts(entryFor(BuildRole.Barracks).key)).toBe(0);
    expect(h.starts(entryFor(BuildRole.WarFactory).key)).toBe(0);
  });

  it('will not while a refinery is still wanted', () => {
    const h = richBase(BRUTAL, { refineries: AI_SKILL[BRUTAL].maxRefineries - 1 });
    h.step(ENOUGH_TICKS);

    expect(h.starts(entryFor(BuildRole.WarFactory).key)).toBe(0);
  });

  it('will not while the queues are idle — an empty tab wants a reason, not a door', () => {
    const skill = AI_SKILL[BRUTAL];
    const h = makeHarness({
      difficulty: BRUTAL, credits: 40_000,
      personality: 1,
      refineries: skill.maxRefineries, harvesters: skill.maxHarvesters,
      barracks: 1, warFactories: 1,
    });
    h.settle();
    h.step(ENOUGH_TICKS);

    expect(h.starts(entryFor(BuildRole.Barracks).key)).toBe(0);
    expect(h.starts(entryFor(BuildRole.WarFactory).key)).toBe(0);
  });

  it('will not once the speed bonus has saturated', () => {
    const h = richBase(BRUTAL, {
      barracks: AI_PRODUCERS.maxUseful, warFactories: AI_PRODUCERS.maxUseful,
    });
    h.step(ENOUGH_TICKS);

    expect(h.starts(entryFor(BuildRole.Barracks).key)).toBe(0);
    expect(h.starts(entryFor(BuildRole.WarFactory).key)).toBe(0);
  });

  it('will not on a bank that merely covers the price', () => {
    // `bankMultiple` is what keeps this a surplus purchase rather than a
    // mortgage: a second factory is worth the units that go through it.
    const barracks = entryFor(BuildRole.Barracks);
    const h = richBase(BRUTAL, {
      credits: AI_SKILL[BRUTAL].creditFloor + barracks.cost + 10,
    });
    h.step(ENOUGH_TICKS);

    expect(AI_PRODUCERS.bankMultiple).toBeGreaterThan(1);
    expect(h.starts(barracks.key)).toBe(0);
  });
});

describe('the extra producer never outranks the things a base actually needs', () => {
  it('scores below every first-of-kind producer and every economy candidate', () => {
    // The literals are the scores in `chooseBuild`; if one of them moves this
    // fails, which is the point — the ordering is what stops a second factory
    // being bought over a refinery the brain does not own.
    const barracksFirst = 1.5;
    const warFactoryFirst = 1.8;
    const harvesterScore = 1.6;
    const refineryFirst = 1.4;
    for (const above of [barracksFirst, warFactoryFirst, harvesterScore, refineryFirst]) {
      expect(AI_PRODUCERS.score).toBeLessThan(above);
    }
    // ... and above the banking floor, or it could never win a pass at all.
    expect(AI_PRODUCERS.score).toBeGreaterThan(0.35);
  });

  it('holds strictly less than the whole price, or the ramp stops', () => {
    expect(AI_SAVING.holdFraction).toBeGreaterThan(0);
    expect(AI_SAVING.holdFraction).toBeLessThan(1);
  });
});
