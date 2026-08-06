/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/repair-depot.spec.ts
 * ============================================================================
 * The Repair Depot: a pad you drive onto, not a button you press.
 *
 * WHY EVERY CATALOG HERE IS BUILT FROM `resolveDefBinding()`
 * ---------------------------------------------------------
 * `RepairSellService.resolveDepots` refuses to cache while `catalog.bound` is
 * false, and answers "no depots" the whole time. So a rig built on
 * `EMPTY_BINDING` — which is what most of this repo's sim tests use — would
 * make every case in this file pass by servicing nothing at all. Each rig
 * therefore asserts `catalog.bound` before it does anything else, and the file
 * is worthless the moment that assertion is dropped.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE PAD IS POSITIONAL AND NOTHING ELSE. No order, no flag on the unit,
 *     no state machine. Park inside the radius and you are serviced; drive out
 *     and you are not. That is the whole contract, so it is the first test.
 *   - IT SERVICES YOURS ONLY. An enemy hull sitting on your pad, and infantry
 *     standing on it, must both be refused — the first is a gift to the
 *     opponent and the second is a mechanic nobody designed.
 *   - IT IS PAID FOR. A depot that heals for free is a balance bug that shows
 *     up three weeks later in a complaint, which is exactly what the wrench's
 *     own comment says about structures.
 *   - THE RATE IS A FRACTION OF MAX HP. A scout and a siege hull take the same
 *     time. A flat hp/s would quietly make the building an armour perk.
 *   - `BeingRepaired` IS CLEARED. This is the `EntityFlag.Burning` failure
 *     shape (buildings burned forever because a one-way OR sat under a comment
 *     describing a recompute). The flag now has a HUD reader, so a hull that
 *     kept it would read REPAIRING at full health for the rest of the match.
 *     Two cases cover it: healed to full, and driven off the pad.
 *   - AN UNFINISHED DEPOT SERVICES NOTHING.
 *   - AND THE THING THAT MAKES ALL OF THE ABOVE REACHABLE: every army has a
 *     depot, it is in the fallback table, and `keyFor` resolves it. A def with
 *     no `FALLBACK_BUILDINGS` row builds, charges, reaches 100% and then never
 *     places, with nothing logged.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { EntityFlag, EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import {
  CELL, POWER_RECOMPUTE_INTERVAL, REPAIR_COST_PER_HP, REPAIR_DEPOT, SIM_DT,
} from '../src/core/config';

import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import { RepairSellService, setRepairSellService } from '../src/sim/RepairSell';
import { setActiveEconomy } from '../src/sim/Economy';
import { PowerGrid } from '../src/sim/Power';
import { resolveDefBinding } from '../src/game/Scenarios';

/* ==========================================================================
 * Fixtures
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  repair: RepairSellService;
  /**
   * Real, and ticked. The depot draws 30 power and refuses to work while dark,
   * so a rig without a grid would leave every depot unpowered and pass every
   * case below by servicing nothing — the same vacuity trap as an unbound
   * catalog. `plant` asserts the pad came up lit for exactly that reason.
   */
  power: PowerGrid;
  tick: number;
}

/** The three depot content keys, and the army each belongs to. */
const DEPOTS: ReadonlyArray<readonly [string, Faction]> = [
  ['repairDepot', Faction.Allies],
  ['mrdDepot', Faction.Meridian],
  ['rclDepot', Faction.Reclaim],
];

async function makeRig(faction = Faction.Allies, credits = 20000): Promise<Rig> {
  const world = new World();
  world.addPlayer(faction, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);

  const channels = new Channels();
  const catalog = new ProductionCatalog(await resolveDefBinding());
  // See the header. Without this the whole file is vacuous.
  expect(catalog.bound, 'unbound catalog — nothing here would be exercised').toBe(true);

  const production = new ProductionService(world, channels, catalog);
  setProduction(production);

  // No Economy service: `RepairSellService.spendDirect` is the documented
  // fallback and it is the path a headless rig should be testing anyway —
  // it is the one that runs before Economy comes up.
  setActiveEconomy(null);

  const repair = new RepairSellService(world, channels);
  setRepairSellService(repair);

  world.player(0 as PlayerId).credits = credits;
  world.player(1 as PlayerId).credits = credits;

  return { world, channels, production, repair, power: new PowerGrid(world, channels), tick: 0 };
}

/** Advance the two phases a depot depends on, in tick order. */
function step(rig: Rig, steps = 1): void {
  const rng = new Rng(4242);
  for (let n = 0; n < steps; n++) {
    rig.tick++;
    rig.world.tick = rig.tick;
    rig.world.time = rig.tick * SIM_DT;
    rig.power.simTick(rig.world.time);
    rig.repair.simTick({ dt: SIM_DT, tick: rig.tick, time: rig.world.time, rng });
  }
}

/**
 * Plant a finished structure the way a scenario would. `cx`/`cz` are CELLS.
 *
 * Settles the grid afterwards so the caller gets a LIT building: `PowerGrid`
 * rescans only when it is dirty or every `POWER_RECOMPUTE_INTERVAL` calls, and
 * several cases below step fewer ticks than that. Without the settle, a depot
 * planted and then stepped once would still be dark.
 */
function plant(rig: Rig, key: string, cx: number, cz: number, player = 0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  const id = rig.production.spawnBuilding(rig.world.player(player as PlayerId), entry!, cx, cz, 1);
  expect(id, `spawnBuilding refused "${key}"`).not.toBe(NONE);
  rig.world.spatial.rebuild();
  for (let n = 0; n <= POWER_RECOMPUTE_INTERVAL; n++) rig.power.simTick(rig.world.time);
  return id;
}

/** The generator each army builds. Every depot in this file needs one. */
const GENERATOR: Readonly<Partial<Record<Faction, string>>> = {
  [Faction.Meridian]: 'mrdSolarArray',
  [Faction.Reclaim]: 'rclFurnace',
};

/** Enough generation to light anything this file plants, for both players. */
function powerUp(rig: Rig): void {
  for (const player of [0, 1] as const) {
    const p = rig.world.player(player as PlayerId);
    // Far from the pads, so a generator never lands inside a service radius.
    plant(rig, GENERATOR[p.faction] ?? 'powerPlant', 2 + player * 4, 2, player);
  }
}

/** True while the structure is lit. */
function isLit(rig: Rig, id: EntityId): boolean {
  const st = rig.world.store;
  const i = st.index(id);
  return (st.flags[i] & EntityFlag.NeedsPower) === 0
    || (st.flags[i] & EntityFlag.Powered) !== 0;
}

/** Put a unit on the map at world METRES and hurt it to `hpFrac` of max. */
function park(rig: Rig, key: string, x: number, z: number, hpFrac: number, player = 0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  const id = rig.production.spawnUnit(rig.world.player(player as PlayerId), entry!, x, z, 0);
  expect(id, `spawnUnit refused "${key}"`).not.toBe(NONE);
  const st = rig.world.store;
  const i = st.index(id);
  st.hp[i] = st.maxHp[i] * hpFrac;
  return id;
}

function hp(rig: Rig, id: EntityId): number {
  return rig.world.store.hp[rig.world.store.index(id)];
}

function hpFrac(rig: Rig, id: EntityId): number {
  const st = rig.world.store;
  const i = st.index(id);
  return st.hp[i] / st.maxHp[i];
}

function isTagged(rig: Rig, id: EntityId): boolean {
  const st = rig.world.store;
  return (st.flags[st.index(id)] & EntityFlag.BeingRepaired) !== 0;
}

function moveTo(rig: Rig, id: EntityId, x: number, z: number): void {
  const st = rig.world.store;
  const i = st.index(id);
  st.posX[i] = x;
  st.posZ[i] = z;
}

/** World-metre centre of a 2x2 structure whose origin cell is (cx, cz). */
function centreOf(cx: number, cz: number): readonly [number, number] {
  return [(cx + 1) * CELL, (cz + 1) * CELL];
}

/* ==========================================================================
 * 1. THE CONTENT EXISTS AND IS REACHABLE
 * ========================================================================== */

describe('every army owns a Repair Depot, and it can actually be placed', () => {
  it('gives all four factions a depot in the build catalog', async () => {
    const rig = await makeRig();
    for (const [key] of DEPOTS) {
      const entry = rig.production.catalog.byKey(key);
      expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
      expect(entry!.name.length, key).toBeGreaterThan(0);
      expect(entry!.blurb.length, key).toBeGreaterThan(0);
    }
  });

  it('places every one of them — the missing-fallback-row failure', async () => {
    // A def with no `FALLBACK_BUILDINGS` row completes construction, takes the
    // credits, and then `spawnBuilding` returns NONE before it ever looks at
    // the def. Nothing is logged. `plant` asserts on NONE, so this catches it.
    for (const [key, faction] of DEPOTS) {
      const rig = await makeRig(faction);
      powerUp(rig);
      const depot = plant(rig, key, 30, 30);
      expect(isLit(rig, depot), `${key} came up dark`).toBe(true);
    }
  });

  it('shares one def between the two original armies', async () => {
    // `Faction.Neutral` on a building means "Allies and Soviets", the way
    // `radar` and `battleLab` already do it. Three defs, four armies.
    const rig = await makeRig();
    const entry = rig.production.catalog.byKey('repairDepot');
    expect(entry!.faction).toBe(Faction.Neutral);
    expect(DEPOTS.length).toBe(3);
  });

  it('resolves the depot to the asking army through keyFor', async () => {
    // A layout authored once as pure geometry has to hand every army its own
    // building. A short FACTION_KEY_MAP row does not throw — it quietly gives
    // a Reclamation player an Allied key, the fallback table refuses it on the
    // faction check, and nothing spawns at all.
    const { ScenarioBuilder } = await import('../src/game/Scenarios');
    const { PerEntityObj } = await import('../src/core/world');
    const binding = await resolveDefBinding();

    const want: ReadonlyArray<readonly [Faction, string]> = [
      [Faction.Allies, 'repairDepot'],
      [Faction.Soviets, 'repairDepot'],
      [Faction.Meridian, 'mrdDepot'],
      [Faction.Reclaim, 'rclDepot'],
    ];
    for (const [faction, key] of want) {
      const world = new World();
      world.addPlayer(faction, 'P', true, true);
      const b = new ScenarioBuilder(
        world, binding, new PerEntityObj<string>(world.store), 1, 'temperate',
      );
      expect(b.keyFor(0 as PlayerId, 'repairDepot'), `faction ${faction}`).toBe(key);
    }
  });
});

/* ==========================================================================
 * 2. THE PAD
 * ========================================================================== */

describe('the pad services what is standing on it', () => {
  let rig: Rig;
  let depot: EntityId;
  let cx: number;
  let cz: number;

  beforeEach(async () => {
    rig = await makeRig();
    powerUp(rig);
    cx = 30; cz = 30;
    depot = plant(rig, 'repairDepot', cx, cz);
    expect(depot).not.toBe(NONE);
    expect(isLit(rig, depot), 'the pad came up dark — every case below would be vacuous')
      .toBe(true);
  });

  it('mends a damaged friendly vehicle parked on it', async () => {
    const [x, z] = centreOf(cx, cz);
    const tank = park(rig, 'grizzly', x + 4, z, 0.4);
    const before = hp(rig, tank);
    step(rig, 15);
    expect(hp(rig, tank)).toBeGreaterThan(before);
    expect(rig.repair.stats.depotHpRestored).toBeGreaterThan(0);
  });

  it('leaves a vehicle outside the radius alone', async () => {
    const [x, z] = centreOf(cx, cz);
    // Comfortably past REPAIR_DEPOT.radius on the X axis.
    const tank = park(rig, 'grizzly', x + REPAIR_DEPOT.radius + 12, z, 0.4);
    const before = hp(rig, tank);
    step(rig, 30);
    expect(hp(rig, tank)).toBe(before);
    expect(isTagged(rig, tank)).toBe(false);
  });

  it('refuses the enemy hull parked on it', async () => {
    const [x, z] = centreOf(cx, cz);
    const theirs = park(rig, 'grizzly', x + 2, z, 0.4, 1);
    const before = hp(rig, theirs);
    step(rig, 30);
    expect(hp(rig, theirs)).toBe(before);
  });

  it('refuses infantry — this is a vehicle bay', async () => {
    const [x, z] = centreOf(cx, cz);
    const gi = park(rig, 'gi', x + 2, z, 0.4);
    expect(rig.world.store.kind[rig.world.store.index(gi)]).toBe(EntityKind.Infantry);
    const before = hp(rig, gi);
    step(rig, 30);
    expect(hp(rig, gi)).toBe(before);
  });

  it('does nothing while the depot is still going up', async () => {
    const rig2 = await makeRig();
    powerUp(rig2);
    const entry = rig2.production.catalog.byKey('repairDepot')!;
    // buildProgress 0 = it rises, so it carries UnderConstruction.
    const site = rig2.production.spawnBuilding(rig2.world.player(0 as PlayerId), entry, 40, 40, 0);
    expect(site).not.toBe(NONE);
    const st = rig2.world.store;
    expect(st.flags[st.index(site)] & EntityFlag.UnderConstruction).not.toBe(0);

    const [x, z] = centreOf(40, 40);
    const tank = park(rig2, 'grizzly', x + 2, z, 0.4);
    const before = hp(rig2, tank);
    step(rig2, 30);
    expect(hp(rig2, tank)).toBe(before);
  });

  it('services nothing while the base is blacked out', async () => {
    // The depot draws 30 power. A building that kept working through a
    // blackout while the tesla coils went dark would be the only one in the
    // game that did — so it takes the same `Powered` test `Superweapons.ts`
    // and `Combat.ts` apply, and losing the grid is a real cost.
    const [x, z] = centreOf(cx, cz);
    const tank = park(rig, 'grizzly', x + 2, z, 0.4);
    step(rig, 5);
    expect(hp(rig, tank), 'the pad was not working before the blackout either')
      .toBeGreaterThan(rig.world.store.maxHp[rig.world.store.index(tank)] * 0.4);

    // Kill the grid the way an air raid would.
    const st = rig.world.store;
    const list = st.byKind[EntityKind.Building];
    for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
      const i = list[a];
      if (st.powerDraw[i] > 0) st.hp[i] = 0, st.flags[i] |= EntityFlag.PendingDestroy;
    }
    for (let n = 0; n <= POWER_RECOMPUTE_INTERVAL; n++) rig.power.simTick(rig.world.time);
    expect(isLit(rig, depot), 'the pad stayed lit with no generation').toBe(false);

    const dark = hp(rig, tank);
    step(rig, 20);
    expect(hp(rig, tank)).toBe(dark);
    expect(isTagged(rig, tank)).toBe(false);
  });

  it('stops the moment the hull drives off the pad', async () => {
    const [x, z] = centreOf(cx, cz);
    const tank = park(rig, 'grizzly', x + 2, z, 0.3);
    step(rig, 5);
    expect(isTagged(rig, tank)).toBe(true);
    const away = hp(rig, tank);

    moveTo(rig, tank, x + REPAIR_DEPOT.radius + 20, z);
    step(rig, 10);
    expect(hp(rig, tank)).toBe(away);
    // The flag must come off with the service, or the panel reads REPAIRING
    // on a hull nobody is touching. This is the `Burning` failure shape.
    expect(isTagged(rig, tank)).toBe(false);
  });
});

/* ==========================================================================
 * 3. IT IS PAID FOR
 * ========================================================================== */

describe('the depot charges for what it mends', () => {
  it('bills REPAIR_COST_PER_HP for every point put back', async () => {
    const rig = await makeRig();
    powerUp(rig);
    plant(rig, 'repairDepot', 30, 30);
    const [x, z] = centreOf(30, 30);
    const tank = park(rig, 'grizzly', x + 2, z, 0.5);

    const before = rig.world.player(0 as PlayerId).credits;
    const hpBefore = hp(rig, tank);
    step(rig, 20);
    const restored = hp(rig, tank) - hpBefore;
    const spent = before - rig.world.player(0 as PlayerId).credits;

    expect(restored).toBeGreaterThan(0);
    // One price for one hit point, wherever it is repaired — the depot
    // deliberately does NOT introduce a second rate.
    expect(spent).toBeCloseTo(restored * REPAIR_COST_PER_HP, 4);
  });

  it('stops rather than healing for free when the owner is broke', async () => {
    const rig = await makeRig(Faction.Allies, 0);
    powerUp(rig);
    plant(rig, 'repairDepot', 30, 30);
    const [x, z] = centreOf(30, 30);
    const tank = park(rig, 'grizzly', x + 2, z, 0.4);

    const before = hp(rig, tank);
    step(rig, 30);
    expect(hp(rig, tank)).toBe(before);
    expect(rig.repair.stats.depotBrokeCancels).toBeGreaterThan(0);
    expect(isTagged(rig, tank)).toBe(false);
    expect(rig.world.player(0 as PlayerId).credits).toBe(0);
  });
});

/* ==========================================================================
 * 4. THE RATE
 * ========================================================================== */

describe('the rate is a fraction of the hull, not a number of hit points', () => {
  it('takes a light and a heavy hull the same time from empty', async () => {
    const rig = await makeRig();
    powerUp(rig);
    plant(rig, 'repairDepot', 30, 30);
    const [x, z] = centreOf(30, 30);

    // Two hulls with materially different maxHp, both at 10%, both on the pad.
    const light = park(rig, 'ifv', x + 2, z + 2, 0.1);
    const heavy = park(rig, 'grizzly', x - 2, z - 2, 0.1);
    const st = rig.world.store;
    const lightMax = st.maxHp[st.index(light)];
    const heavyMax = st.maxHp[st.index(heavy)];
    expect(Math.abs(heavyMax - lightMax), 'pick two hulls of different size').toBeGreaterThan(100);

    step(rig, 30);
    // Same FRACTION restored, to within a tick of rounding.
    expect(hpFrac(rig, light)).toBeCloseTo(hpFrac(rig, heavy), 3);
  });

  it('fills an empty hull in about the advertised time', async () => {
    const rig = await makeRig();
    powerUp(rig);
    plant(rig, 'repairDepot', 30, 30);
    const [x, z] = centreOf(30, 30);
    const tank = park(rig, 'grizzly', x + 2, z, 0.0001);

    const seconds = 1 / REPAIR_DEPOT.fractionPerSec;
    step(rig, Math.ceil(seconds / SIM_DT) + 2);
    expect(hpFrac(rig, tank)).toBe(1);
  });

  it('clears the tag the moment the hull is full, and never overheals', async () => {
    const rig = await makeRig();
    powerUp(rig);
    plant(rig, 'repairDepot', 30, 30);
    const [x, z] = centreOf(30, 30);
    const tank = park(rig, 'grizzly', x + 2, z, 0.9);
    const st = rig.world.store;
    const max = st.maxHp[st.index(tank)];

    step(rig, 60);
    expect(hp(rig, tank)).toBe(max);
    expect(isTagged(rig, tank)).toBe(false);

    // And it must stay off. A one-way OR here is exactly how buildings burned
    // forever; the panel would read REPAIRING at full health all match.
    step(rig, 60);
    expect(isTagged(rig, tank)).toBe(false);
    expect(hp(rig, tank)).toBe(max);
  });

  it('services no more hulls at once than the cap allows', async () => {
    const rig = await makeRig();
    powerUp(rig);
    plant(rig, 'repairDepot', 30, 30);
    const [x, z] = centreOf(30, 30);
    const n = REPAIR_DEPOT.maxConcurrent + 4;
    for (let k = 0; k < n; k++) {
      // A ring well inside the radius, so every one of them is a candidate.
      const a = (k / n) * Math.PI * 2;
      park(rig, 'grizzly', x + Math.cos(a) * 3, z + Math.sin(a) * 3, 0.5);
    }
    step(rig, 1);
    expect(rig.repair.stats.vehiclesServiced).toBe(REPAIR_DEPOT.maxConcurrent);
  });
});

/* ==========================================================================
 * 5. THE FLAG HAS A NEW READER, SO ITS OLD ABUSES MATTER NOW
 * ========================================================================== */

describe('the AI files the depot as a depot, not as its Battle Lab', () => {
  it('gives every army a Repair-role catalog entry', async () => {
    const { BuildCatalog, BuildRole } = await import('../src/sim/AIStrategy');
    const binding = await resolveDefBinding();
    for (const faction of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      const catalog = new BuildCatalog();
      catalog.bind(binding);
      const entry = catalog.forRole(BuildRole.Repair, faction);
      expect(entry, `faction ${faction} has no depot in the AI catalog`).toBeDefined();
      expect(entry!.isBuilding).toBe(true);
    }
  });

  it('never classifies a depot as a TechLab', async () => {
    // `roleOfBuilding`'s flag fallback ends with "2x2 and draws power" =>
    // TechLab, because nothing else in the game matched that until now. A
    // depot does, exactly — and `roleCount[TechLab] > 0` is the gate on every
    // top-tier unit, so an AI that made this mistake would stop building the
    // real lab and quietly never field a Prism Tank again.
    const { BuildCatalog, BuildRole } = await import('../src/sim/AIStrategy');
    const binding = await resolveDefBinding();
    const catalog = new BuildCatalog();
    catalog.bind(binding);

    for (const key of ['repairDepot', 'mrdDepot', 'rclDepot']) {
      const defId = binding.buildingId[key];
      expect(defId, `no bound def id for "${key}"`).toBeGreaterThanOrEqual(0);
      const entry = catalog.entryForBuilding(defId);
      expect(entry, `AI catalog has no row for "${key}" — it would fall through to the
        flag heuristic and be filed as a TechLab`).toBeDefined();
      expect(entry!.role, key).toBe(BuildRole.Repair);
    }
  });
});

describe('BeingRepaired is never left set by something instantaneous', () => {
  it('does not tag a structure an engineer repaired in one step', async () => {
    // `Capture.resolve` used to `|=` the flag on a repair that completes in a
    // single statement, and NOTHING cleared it for a building that was not
    // also in RepairSell's drip list. Inert while the flag had no readers;
    // a permanent REPAIRING tag the moment the HUD started reading it.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/sim/Capture.ts', 'utf8'));
    expect(
      /flags\[t\]\s*\|=\s*EntityFlag\.BeingRepaired/.test(src),
      'Capture.ts sets BeingRepaired on an instantaneous repair and never clears it',
    ).toBe(false);
  });
});
