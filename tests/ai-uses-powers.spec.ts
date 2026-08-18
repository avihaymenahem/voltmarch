/**
 * ============================================================================
 * tests/ai-uses-powers.spec.ts — THE AI OWNS THE POWERS IT CAN USE
 * ============================================================================
 * Reported as *"not using powers"*, and it was true. Measured over 24
 * sim-minutes, two brains, temperate, seed 90210, with `CommanderPowerService`
 * AND `setCommanderPowerSeam` installed the way `commander-powers.system.ts`
 * installs them:
 *
 *                       Command Post   powers bought   powers CALLED
 *      Easy                never             0               0
 *      Normal              minute 8          0               0
 *      Hard                minute 8          3               1
 *      Brutal              minute 4          2               4
 *
 * Normal paid 1500 credits and 80 power for a building that then bought
 * NOTHING for the remaining sixteen minutes. Hard's FIRST purchase was Orbital
 * Scan and it fired zero times, because `AiBrain.tryScan` only fires while the
 * brain does not know where the enemy lives and the scouting layer had answered
 * that eight minutes before a Command Post could exist; its other two arrived
 * at minute 20 only because its army had been wiped out and the bank filled up.
 * Charges are 90-180 seconds, so a 24-minute match allows roughly eight to
 * sixteen calls per owned power.
 *
 * TWO DEFECTS, both in `considerPowers`, and the second one caused the first.
 *
 *   THE PLAN ORDER WAS INVERTED BY PRICE. The loop offered every unsettled
 *   power to `consider` at the identical score — `consider` breaks a tie in
 *   favour of the first candidate, so `POWER_PLAN`'s order was meant to
 *   decide — but it ALSO walked past any power the bank could not cover at
 *   `AI_POWER_BUY.bankMultiple`. The brain's bank sits near zero by design, so
 *   the only threshold ever cleared belonged to the CHEAPEST power. Orbital
 *   Scan is 800 against 1200-2500 for the rest, and it is FOURTH in the plan.
 *
 *   A POWER THAT CAN NEVER BE CALLED WAS STILL BOUGHT. Orbital Scan is the one
 *   power whose window shuts permanently, and it shuts before the purchase is
 *   even possible.
 *
 * The fix is the reserve this brain already has: the first power in the plan a
 * rung still wants is committed to by SAVING for it, at the `bankMultiple`
 * threshold it will actually be bought at, rather than being walked past.
 *
 * AFTER, same seed, same 24 minutes:
 *
 *                       powers bought                         calls
 *      Easy                0 (mask 0, no Command Post)          0
 *      Normal              2  repair, oreBoost                  4
 *      Hard                3  repair, airstrike, oreBoost      17
 *      Brutal              4  + chronoshift                    20
 *
 * Reproduced at Hard on seed 1337 over 20 minutes: 3 bought, 12 called.
 *
 * Orbital Scan is now bought by nobody, which is correct: it is the only entry
 * in the table that cannot be fired by the time it can be afforded.
 *
 * Fast and seed-free. The numbers above come from a real match and are facts
 * about one seed; what lives here is what must not regress silently.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, BuildTab, CommandKind, EntityFlag, EntityKind, Faction, UnitState,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import { AI_CADENCE, AI_SKILL, CELL, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import {
  AI_POWER_BUY, BuildCatalog, difficultyProfile, powerPlanFor,
} from '../src/sim/AIStrategy';
import type { CatalogEntry, DefLookup } from '../src/sim/AIStrategy';
import { CommanderPowerId, powerByContentKey } from '../src/progression/powers';

const P_AI = 1 as PlayerId;

const EASY = 0;
const NORMAL = 1;
const BRUTAL = 3;

/**
 * PAST `AI_POWER_BUY.reaskTicks`, and that is not slack.
 *
 * `powerAskedTick` is a zero-initialised `Int32Array`, so `powerSettled` reads
 * every power as "asked at tick 0" and refuses to re-ask for the first 1800
 * ticks of any match. Harmless in a real one — a Command Post cannot exist
 * before minute four — but a harness that settles inside that window measures
 * the backoff and nothing else.
 */
const ENOUGH_TICKS = AI_CADENCE.build * 80;

const REFERENCE = new BuildCatalog();

function entryOf(key: string): CatalogEntry {
  const e = REFERENCE.get(key);
  if (e === undefined) throw new Error(`no catalog entry ${key}`);
  return e;
}

/** Ids for every catalog key, so `entryForBuilding`/`get` resolve. */
function syntheticBinding(): { lookup: DefLookup; buildingId: Record<string, number> } {
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

const BINDING = syntheticBinding();

/**
 * A building the brain will classify by its DEF, not by its flags.
 *
 * `AiBrain.roleOfBuilding` asks `catalog.entryForBuilding(store.defId[i])`
 * first and only falls back to flags and footprint. The fallback has no branch
 * for a Command Post — nothing about a Post is expressible in flags — so these
 * cases spawn with the real synthetic def id and the role comes back exact.
 */
function spawnByKey(
  world: World, owner: PlayerId, key: string, x: number, z: number, flags = 0, w = 2,
): EntityId {
  const st = world.store;
  const defId = BINDING.buildingId[key] ?? -1;
  const id = st.alloc(EntityKind.Building, defId, owner, Faction.Soviets, x, 0, z, 0);
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

/**
 * A harvester that is already MINING.
 *
 * Load-bearing rather than scenery: `wantHarvesters` outranks every power in
 * `chooseBuild` (1.6 x economy against `AI_POWER_BUY.score` 1.25 x tech), so a
 * brain short of trucks banks for a truck and these cases would measure the
 * economy scorer. `UnitState.Harvesting` keeps `AiBrain.economy` from steering
 * an idle truck at an ore field this harness does not have.
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
  settle(): void;
  setCredits(n: number): void;
  step(ticks: number): void;
  /** ProductionStart commands on the Powers tab, by catalog key. */
  powerStarts(): string[];
}

interface Spec {
  difficulty?: number;
  personality?: number;
  credits?: number;
  /** Powers already owned, as `CommanderPowerId`s. */
  owned?: number[];
  /** Put an enemy structure on the map, which closes the Orbital Scan window. */
  enemyBase?: boolean;
  commandPost?: boolean;
}

function makeHarness(spec: Spec = {}): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const p = world.player(P_AI);
  p.aiDifficulty = spec.difficulty ?? BRUTAL;
  p.aiPersonality = spec.personality ?? 1;
  p.credits = spec.credits ?? 20_000;
  p.storageMax = 100_000;
  p.powerProduced = 900;
  p.powerConsumed = 20;
  for (const id of spec.owned ?? []) p.commanderPowerMask |= 1 << id;
  /*
   * EVERY UPGRADE ALREADY BOUGHT, and the base one refinery short of the rung's
   * cap. Both are here to clear the Structures slot rather than to be realistic:
   * `considerUpgrades` scores 1.45 x tech and `considerSuperweapon` 1.6 x tech,
   * so either one outranks `AI_POWER_BUY.score` and these cases would measure
   * the tech ladder's turn order instead of the power rule. A brain below
   * `maxRefineries` never reaches the superweapon branch at all — that gate is
   * "the economy must be FINISHED" — while `AI_POWER_BUY.minRefineries` is 2,
   * so the powers layer is still fully live.
   */
  p.upgradeMask = ~0 >>> 0;

  spawnByKey(world, P_AI, 'conyard', 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory, 3);
  const plant = spawnByKey(world, P_AI, 'powerPlant', 400, 360);
  world.store.powerDraw[world.store.index(plant)] = 100;
  spawnByKey(world, P_AI, 'radar', 460, 400, EntityFlag.IsRadar);
  spawnByKey(world, P_AI, 'refinery', 340, 400, EntityFlag.IsRefinery);
  spawnByKey(world, P_AI, 'refinery', 316, 400, EntityFlag.IsRefinery);
  spawnByKey(world, P_AI, 'battleLab', 268, 400);
  spawnByKey(world, P_AI, 'barracks', 340, 440, EntityFlag.IsFactory, 2);
  spawnByKey(world, P_AI, 'warFactory', 340, 480, EntityFlag.IsFactory, 3);
  if (spec.commandPost !== false) spawnByKey(world, P_AI, 'commandPost', 460, 440);
  for (let k = 0; k < AI_SKILL[spec.difficulty ?? BRUTAL].maxHarvesters; k++) {
    spawnHarvester(world, P_AI, 420 + k * 6, 420);
  }
  // An enemy structure the brain will remember. `World.vision` defaults to
  // `OpenVision`, so `observe` records it on the next census.
  if (spec.enemyBase === true) {
    spawnByKey(world, 0 as PlayerId, 'conyard', 900, 900, EntityFlag.IsBuilder, 3);
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
    world,
    brain,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        brain.tick(s);
        // Nothing BUILDS: these cases are about what the brain ASKS for. The
        // one echo is `production:started`, which is what clears `inFlight` —
        // swallowing it makes every case a test of `requestTimeoutTicks`.
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
    /** Run the scripted opening out and forget what it asked for. */
    settle(): void {
      this.step(AI_CADENCE.build * 80);
      commands.length = 0;
    },
    setCredits(n: number): void { world.player(P_AI).credits = n; },
    powerStarts(): string[] {
      return commands
        .filter((c) => c.kind === CommandKind.ProductionStart
          && c.tab === (BuildTab.Powers as number))
        .map(keyOf);
    },
  };
}

/* ========================================================================== */

describe('the plan is ordered by value and the prices run the other way', () => {
  it('does not lead with its cheapest entry — which is why price could invert it', () => {
    const plan = powerPlanFor().map(entryOf);
    let cheapest = 0;
    for (let k = 1; k < plan.length; k++) if (plan[k].cost < plan[cheapest].cost) cheapest = k;
    // If the cheapest ever became the first entry this whole failure mode would
    // vanish and so would the reason for the ordering rule below.
    expect(cheapest, 'the cheapest power is first, so nothing can leapfrog').toBeGreaterThan(0);
    expect(plan[cheapest].key).toBe('power.orbitalScan');
  });

  it('gates the purchase above the price, so banking has to aim past the cost', () => {
    expect(AI_POWER_BUY.bankMultiple).toBeGreaterThan(1);
  });
});

describe('a bank that covers only the cheapest power does not buy the cheapest power', () => {
  const repair = entryOf('power.emergencyRepair');
  const scan = entryOf('power.orbitalScan');

  /** Past Orbital Scan's threshold, short of Emergency Repair's. */
  const BETWEEN = Math.round(scan.cost * AI_POWER_BUY.bankMultiple) + 100;

  it('commits to the first power in the plan and banks for it', () => {
    expect(BETWEEN).toBeLessThan(repair.cost * AI_POWER_BUY.bankMultiple);
    const h = makeHarness({ difficulty: BRUTAL });
    h.settle();
    h.setCredits(AI_SKILL[BRUTAL].creditFloor + BETWEEN);
    h.step(ENOUGH_TICKS);

    // THE DEFECT: this bought Orbital Scan, every time.
    expect(h.powerStarts(), 'a cheaper, later power took the pass').toEqual([]);
    expect(h.brain.savedPassCount).toBeGreaterThan(0);
    expect(h.brain.intent().economy).toContain('power.emergencyRepair');
  });

  it('banks toward the gate rather than the price, or it stops one threshold short', () => {
    const h = makeHarness({ difficulty: BRUTAL });
    h.settle();
    h.setCredits(AI_SKILL[BRUTAL].creditFloor + BETWEEN);
    h.step(ENOUGH_TICKS);

    const goal = h.brain.intent().economy;
    expect(goal).toContain(String(Math.round(repair.cost * AI_POWER_BUY.bankMultiple)));
  });

  it('buys it outright once the bank clears the gate', () => {
    const h = makeHarness({ difficulty: BRUTAL });
    h.settle();
    h.setCredits(AI_SKILL[BRUTAL].creditFloor
      + Math.round(repair.cost * AI_POWER_BUY.bankMultiple) + 100);
    h.step(ENOUGH_TICKS);

    expect(h.powerStarts()).toContain('power.emergencyRepair');
  });
});

describe('a power that can never be called is never bought', () => {
  /** Everything ahead of Orbital Scan in the plan, already owned. */
  const AHEAD = [
    CommanderPowerId.EmergencyRepair as number,
    CommanderPowerId.Airstrike as number,
    CommanderPowerId.OreBoost as number,
  ];

  it('buys the scan while the brain has not found the enemy', () => {
    const h = makeHarness({ difficulty: BRUTAL, owned: AHEAD });
    h.settle();
    h.step(ENOUGH_TICKS);

    expect(h.powerStarts(), 'the scan is worth owning while the AI is lost')
      .toContain('power.orbitalScan');
  });

  it('refuses it once an enemy structure is remembered', () => {
    // `tryScan` returns at `memCount > 0`, so from here the charge can never be
    // spent. Buying it would be 800 credits and a Powers-tab slot for nothing.
    const h = makeHarness({ difficulty: BRUTAL, owned: AHEAD, enemyBase: true });
    h.settle();
    h.step(ENOUGH_TICKS);

    expect(h.brain.memorySize, 'the harness did not give the brain a memory')
      .toBeGreaterThan(0);
    expect(h.powerStarts()).not.toContain('power.orbitalScan');
  });

  it('leaves the other four alone — only the scan has a window that shuts', () => {
    const plan = powerPlanFor();
    for (const key of plan) {
      if (key === 'power.orbitalScan') continue;
      const h = makeHarness({
        difficulty: BRUTAL,
        enemyBase: true,
        owned: plan.filter((k) => k !== key).map((k) => {
          const spec = powerByContentKey(k);
          if (spec === undefined) throw new Error(`no power ${k}`);
          return spec.id as number;
        }),
      });
      h.settle();
      h.step(ENOUGH_TICKS);
      expect(h.powerStarts(), `${key} was refused with the enemy known`).toContain(key);
    }
  });
});

describe('the ladder is untouched at the bottom', () => {
  it('Easy has no power mask and asks for nothing', () => {
    expect(AI_SKILL[EASY]).toBeDefined();
    const h = makeHarness({ difficulty: EASY });
    h.settle();
    h.step(ENOUGH_TICKS);

    expect(h.powerStarts()).toEqual([]);
  });

  it('Normal buys only what its mask allows', () => {
    const h = makeHarness({ difficulty: NORMAL });
    h.settle();
    h.step(ENOUGH_TICKS * 4);

    for (const key of h.powerStarts()) {
      const spec = powerByContentKey(key);
      expect(spec, `unknown power ${key}`).toBeDefined();
      const bit = 1 << (spec?.id as number);
      // The same bit `callPower` checks — a power it may not call must never be
      // one it paid for.
      expect(difficultyProfile(NORMAL).powerMask & bit, `${key} is outside Normal's mask`)
        .not.toBe(0);
    }
  });

  it('buys nothing at all without a Command Post', () => {
    const h = makeHarness({ difficulty: BRUTAL, commandPost: false });
    h.settle();
    h.step(ENOUGH_TICKS);

    expect(h.powerStarts()).toEqual([]);
  });
});
