/**
 * ============================================================================
 * tests/blackout-gating.spec.ts — WHAT A DEAD GRID COSTS YOU
 * ============================================================================
 * Reported as *"If no electrcity left, buildings shouldnt be able to shoot /
 * generate troops"*. Both halves were true of the shipped build:
 *
 *   - `Combat.engage` gated firing on THREE conditions, and the first was the
 *     weapon's own `needsPower` bit. Four rows out of forty-two carry it, so six
 *     of the ten armed structures in the game kept firing on a grid producing
 *     nothing — and three of those six were DRAWING power while they did it: the
 *     Flame Tower (-20), the Multigunner AA (-30) and the Arc Pylon (-90). The
 *     measured coverage went 4/10 silent to 7/10; the three still firing are the
 *     three with a draw of zero.
 *   - `Production.census` gated exactly one tab (`Powers`) on `EntityFlag.
 *     Powered`. A War Factory on a dead grid built tanks at POWER_BLACKOUT_MUL,
 *     i.e. three quarters speed, which is what the report calls no consequence.
 *
 * AND THE THING THAT MUST NOT BREAK WHILE FIXING IT. `Production.census` has
 * carried a NOTE since it was written: gating construction on power soft-locks a
 * player whose only route out of a blackout is the Power Plant they are now
 * forbidden from building. Half this file is about that route staying open, and
 * the last section pins the two independent reasons it does.
 *
 * Every assertion here fails on the previous build in a direct way: the tower
 * fires, the queue advances, or the reason string names the wrong problem.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, BuildTab, EntityFlag, EntityKind, Faction, Locomotor, Stance, UnitState,
} from '../src/core/types';
import type {
  AvailabilityResult, EntityId, PlayerId, SimContext,
} from '../src/core/types';
import {
  ARMOR_MATRIX, POWER_BLACKOUT_MUL, POWER_FULL_MUL, SIM_DT,
} from '../src/core/config';

import { DamageSystem, setArmorMatrix } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import {
  WeaponSystem, setContentWeaponMap, setWeaponKeyResolver, weaponAt, weaponIndexOf,
} from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { ProductionCatalog, ProductionService } from '../src/sim/Production';
import { PowerGrid } from '../src/sim/Power';
import { clearScenario } from '../src/game/Scenarios';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

beforeEach(() => { clearScenario(); });

/* ==========================================================================
 * 1. THE GUN
 *
 * A bare combat rig: no content bindings, every entity gets an explicit
 * `weaponIndex`, so nothing here is about the resolution heuristic.
 * ========================================================================== */

interface CombatRig {
  world: World;
  channels: Channels;
  projectiles: ProjectileSystem;
  weapons: WeaponSystem;
  targeting: TargetingSystem;
  damage: DamageSystem;
  tick: number;
  step(n?: number): void;
}

function makeCombatRig(): CombatRig {
  setContentWeaponMap({});
  setWeaponKeyResolver(null);
  setArmorMatrix(ARMOR_MATRIX);

  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);

  const projectiles = new ProjectileSystem(world, channels);
  const damage = new DamageSystem(world, channels);
  const weapons = new WeaponSystem(world, channels, projectiles);
  const targeting = new TargetingSystem(world, channels, weapons);
  const rng = new Rng(7);

  const rig: CombatRig = {
    world, channels, projectiles, weapons, targeting, damage,
    tick: 0,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        rig.tick++;
        world.store.snapshotPrev();
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
        world.spatial.rebuild();
        targeting.tick(s);
        weapons.tick(s);
        projectiles.tick(s);
        damage.damageTick(s);
        damage.cleanupTick(s);
        channels.damage.clear();
        channels.fx.clear();
      }
    },
  };
  return rig;
}

/**
 * An emplacement, facing +Z, with a target placed straight down that axis so
 * `aimYaw` is 0 and the traverse gate is satisfied on the first tick. This file
 * measures the TRIGGER, not the turret.
 */
function tower(
  rig: CombatRig, x: number, z: number, weapon: number,
  o: { draw?: number; powered?: boolean } = {},
): EntityId {
  const st = rig.world.store;
  const draw = o.draw ?? -20;
  const h = st.alloc(EntityKind.Building, -1, P0, Faction.Allies, x, 0, z, 0);
  const i = st.index(h);
  st.maxHp[i] = 600;
  st.hp[i] = 600;
  st.armorClass[i] = ArmorClass.Concrete;
  st.radius[i] = 4;
  st.footprintW[i] = 2;
  st.footprintH[i] = 2;
  st.sight[i] = 34;
  st.weaponIndex[i] = weapon;
  st.powerDraw[i] = draw;
  st.buildProgress[i] = 1;
  st.locomotor[i] = Locomotor.Static;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack | EntityFlag.HasTurret
    // Exactly what `Scenarios.building()` derives: a negative draw is what puts
    // a structure on the grid, and `STRUCTURE` ships `Powered` set.
    | (draw < 0 ? EntityFlag.NeedsPower : 0)
    | ((o.powered ?? true) ? EntityFlag.Powered : 0);
  return h;
}

function victim(rig: CombatRig, x: number, z: number): EntityId {
  const st = rig.world.store;
  const h = st.alloc(EntityKind.Vehicle, -1, P1, Faction.Soviets, x, 0, z, 0);
  const i = st.index(h);
  st.maxHp[i] = 5000;
  st.hp[i] = 5000;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2;
  st.sight[i] = 30;
  st.weaponIndex[i] = -1;
  st.locomotor[i] = Locomotor.Track;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision;
  return h;
}

function aimAt(rig: CombatRig, shooter: EntityId, target: EntityId): void {
  rig.world.store.targetId[rig.world.store.index(shooter)] = target as number;
}

/**
 * Trigger pulls over `n` ticks.
 *
 * `WeaponStats.shots` is incremented in `fire()` and reset at the top of every
 * `WeaponSystem.tick`, so it is accumulated here. Counting SHOTS rather than
 * damage is deliberate: this file is about the trigger, and a projectile that
 * misses (a tall emplacement firing down a shallow slope will) would read as a
 * gate that fired when it did not.
 */
function shotsOver(rig: CombatRig, shooter: EntityId, target: EntityId, n: number): number {
  let shots = 0;
  for (let k = 0; k < n; k++) {
    aimAt(rig, shooter, target);
    rig.step(1);
    shots += rig.weapons.stats.shots;
  }
  return shots;
}

/** `pillboxMg`: NO `needsPower`. Six armed structures shared this shape. */
const W_MG = weaponIndexOf('pillboxMg');
/** `teslaBolt`: the only `needsPower` row in the base armoury with a structure. */
const W_TESLA = weaponIndexOf('teslaBolt');

describe('a building with no power cannot shoot', () => {
  let rig: CombatRig;
  beforeEach(() => { rig = makeCombatRig(); });

  it('is set up so the gun really would fire — the control', () => {
    // Without this the three assertions below all pass on a rig that never
    // fires for some unrelated reason (out of range, still slewing, no target).
    const post = tower(rig, 100, 100, W_MG);
    const foe = victim(rig, 100, 112);
    expect(shotsOver(rig, post, foe, 30)).toBeGreaterThan(0);
  });

  it('silences a gun whose weapon never opted in, which is the whole report', () => {
    // `pillboxMg` has `needsPower: false` and always has. Under the old triple
    // condition this tower fired through a total blackout; that is the Flame
    // Tower, the Multigunner AA and the Arc Pylon, verbatim.
    expect(weaponAt(W_MG)!.needsPower).toBe(false);
    const post = tower(rig, 100, 100, W_MG, { draw: -20, powered: false });
    const foe = victim(rig, 100, 112);
    expect(shotsOver(rig, post, foe, 30)).toBe(0);
  });

  it('lets the same tower fire the moment the lights come back', () => {
    const post = tower(rig, 100, 100, W_MG, { draw: -20, powered: false });
    const foe = victim(rig, 100, 112);
    expect(shotsOver(rig, post, foe, 20)).toBe(0);
    rig.world.store.flags[rig.world.store.index(post)] |= EntityFlag.Powered;
    expect(shotsOver(rig, post, foe, 20)).toBeGreaterThan(0);
  });

  it('leaves a draw-ZERO emplacement firing, which is what keeps a blackout survivable', () => {
    // `pillbox`, `sentryGun` and `rclSpitpost` are all `power: 0`, so they never
    // carry `NeedsPower` and `PowerGrid` never sheds them. Three of the four
    // armies therefore keep one cheap gun on a dead grid — and `rclSpitpost`'s
    // blurb ("Fires through a blackout") stays true, which
    // `tests/content-truthful.spec.ts` independently requires.
    const post = tower(rig, 100, 100, W_MG, { draw: 0, powered: false });
    const foe = victim(rig, 100, 112);
    expect(shotsOver(rig, post, foe, 30)).toBeGreaterThan(0);
  });

  it('does not touch the mobile army, which has no Powered bit to lose', () => {
    // THE BIT THAT MAKES THE GATE SAFE. `PowerGrid.recompute` walks
    // `byKind[EntityKind.Building]` and nothing else, so a tank never carries
    // `Powered`. Testing that flag alone would silence every unit in the game.
    const st = rig.world.store;
    const h = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 100, 0, 100, 0);
    const i = st.index(h);
    st.maxHp[i] = 400; st.hp[i] = 400; st.radius[i] = 2; st.sight[i] = 34;
    st.weaponIndex[i] = W_MG; st.locomotor[i] = Locomotor.Track;
    st.state[i] = UnitState.Idle; st.stance[i] = Stance.Aggressive;
    st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack | EntityFlag.HasTurret;
    expect(st.flags[i] & EntityFlag.Powered).toBe(0);

    const foe = victim(rig, 100, 112);
    expect(shotsOver(rig, h as EntityId, foe, 30)).toBeGreaterThan(0);
  });
});

describe('an ELECTRIC gun refuses across the whole deficit, not just the shed', () => {
  let rig: CombatRig;
  beforeEach(() => { rig = makeCombatRig(); });

  it('holds fire on a LIT tower while its owner is in deficit', () => {
    // `PowerGrid.shed` covers the shortfall and stops, biggest draw first, so a
    // small deficit takes one tower and leaves the rest of the belt lit. Two
    // files describe the opposite as fact — `AIStrategy.ts` calls a Pact
    // brownout "a disarm", `Defs.ts` says four Sandskiffs "silence a whole
    // defensive belt" — and this second tier is what makes that true.
    expect(weaponAt(W_TESLA)!.needsPower).toBe(true);
    const coil = tower(rig, 100, 100, W_TESLA, { draw: -75, powered: true });
    const foe = victim(rig, 100, 112);
    // 90 ticks a phase, because `teslaBolt`'s cooldown is 2.4 s = 72 ticks. A
    // 20-tick window measures the cooldown rather than the gate, which is how
    // the first draft of this assertion managed to fail on working code.
    const PHASE = 90;
    expect(shotsOver(rig, coil, foe, PHASE)).toBeGreaterThan(0);

    rig.world.players[0].buildSpeedMul = POWER_BLACKOUT_MUL;
    expect(shotsOver(rig, coil, foe, PHASE)).toBe(0);

    rig.world.players[0].buildSpeedMul = POWER_FULL_MUL;
    expect(shotsOver(rig, coil, foe, PHASE)).toBeGreaterThan(0);
  });

  it('does not reach infantry sharing the row — the War Commissar still fires', () => {
    // He carries `teslaBolt`, which is the Tesla COIL's row. Both tiers require
    // `EntityFlag.NeedsPower` on the ENTITY and a man never has it.
    const st = rig.world.store;
    const h = st.alloc(EntityKind.Infantry, -1, P0, Faction.Allies, 100, 0, 100, 0);
    const i = st.index(h);
    st.maxHp[i] = 520; st.hp[i] = 520; st.radius[i] = 0.5; st.sight[i] = 34;
    st.armorClass[i] = ArmorClass.Infantry;
    st.weaponIndex[i] = W_TESLA; st.locomotor[i] = Locomotor.Foot;
    st.state[i] = UnitState.Idle; st.stance[i] = Stance.Aggressive;
    st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack | EntityFlag.HasTurret;

    const foe = victim(rig, 100, 112);
    rig.world.players[0].buildSpeedMul = POWER_BLACKOUT_MUL;
    expect(shotsOver(rig, h as EntityId, foe, 20)).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 2. THE FACTORY
 *
 * A real `ProductionService` over the real catalog, plus a real `PowerGrid`, so
 * the two halves are joined by the flag rather than by a test fixture.
 * ========================================================================== */

interface ProdRig {
  world: World;
  channels: Channels;
  catalog: ProductionCatalog;
  service: ProductionService;
  power: PowerGrid;
  tick: number;
  step(n?: number): void;
}

function makeProdRig(): ProdRig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(EMPTY_BINDING);
  const service = new ProductionService(world, channels, catalog);
  const power = new PowerGrid(world, channels);
  const rng = new Rng(11);

  const rig: ProdRig = {
    world, channels, catalog, service, power,
    tick: 0,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        // Power first, exactly as `economy.system.ts` argues: the `Powered` bits
        // and `buildSpeedMul` it writes are what production reads.
        power.simTick(world.time);
        service.tick({ dt: SIM_DT, tick: rig.tick, time: world.time, rng } as SimContext);
        world.spatial.rebuild();
      }
    },
  };
  return rig;
}

/** Plant a finished structure through the real spawn path. */
function plant(rig: ProdRig, key: string, cx: number, cz: number): number {
  const p = rig.world.player(P0);
  const entry = rig.catalog.byKey(key)!;
  const id = rig.service.spawnBuilding(p, entry, cx, cz, 1);
  rig.power.markDirty();
  return rig.world.store.index(id);
}

/**
 * The opening build order, complete and on a HEALTHY grid.
 *
 * TWO PLANTS, AND THAT IS THE REAL TECH TREE RATHER THAN padding: conyard -20,
 * refinery -30, barracks -20, war factory -40 is 110 against a Power Plant's
 * 100. One plant is a 10-point deficit, `shed` takes the biggest factory-class
 * draw to cover it, and the War Factory is dark before the match has started.
 * Getting this wrong is how the first draft of this file "proved" the gate.
 */
function base(rig: ProdRig): Record<string, number> {
  const slots: Record<string, number> = {};
  slots.conyard = plant(rig, 'conyard', 10, 10);
  slots.plantA = plant(rig, 'powerPlant', 16, 10);
  slots.plantB = plant(rig, 'powerPlant', 16, 16);
  slots.refinery = plant(rig, 'refinery', 22, 10);
  slots.barracks = plant(rig, 'barracks', 28, 10);
  slots.warFactory = plant(rig, 'warFactory', 34, 10);
  rig.world.player(P0).credits = 30_000;
  rig.step(3);
  return slots;
}

/** Bomb a structure the way `Damage` does: it stops supplying on the next scan. */
function bomb(rig: ProdRig, slot: number): void {
  rig.world.store.flags[slot] |= EntityFlag.PendingDestroy;
  rig.power.markDirty();
}

/** Both plants: produced 0 against a consumed 110, so everything sheddable goes. */
function blackout(rig: ProdRig, slots: Record<string, number>): void {
  bomb(rig, slots.plantA);
  bomb(rig, slots.plantB);
}

function progressOf(rig: ProdRig, tab: BuildTab): number {
  const q = rig.world.player(P0).queues[tab as number];
  return q.items.length > 0 ? q.items[0].progress : -1;
}

describe('a base with no power builds no troops', () => {
  const out: AvailabilityResult = { ok: false, reason: '', capped: false };

  it('is set up so the queue really would advance — the control', () => {
    const rig = makeProdRig();
    base(rig);
    const grizzly = rig.catalog.byKey('grizzly')!;
    rig.channels.commands.issueProductionStart(P0, BuildTab.Vehicles, grizzly.publicId, 1);
    rig.step(10);
    expect(progressOf(rig, BuildTab.Vehicles)).toBeGreaterThan(0);
  });

  it('stalls a half-built tank when the plant dies, and resumes where it stopped', () => {
    const rig = makeProdRig();
    const slots = base(rig);
    const grizzly = rig.catalog.byKey('grizzly')!;
    rig.channels.commands.issueProductionStart(P0, BuildTab.Vehicles, grizzly.publicId, 1);
    rig.step(10);
    const started = progressOf(rig, BuildTab.Vehicles);
    expect(started).toBeGreaterThan(0);

    blackout(rig, slots);
    rig.step(2);
    // The grid really did darken the factory. If this fails the rest of the test
    // is measuring nothing.
    expect(rig.world.store.flags[slots.warFactory] & EntityFlag.Powered).toBe(0);
    const stalled = progressOf(rig, BuildTab.Vehicles);

    const creditsAtStall = rig.world.player(P0).credits;
    rig.step(40);
    // Frozen, and not being charged for the privilege: `BuildQueue.advanceTab`
    // returns at `factoryCount <= 0` before it reaches `charge`.
    expect(progressOf(rig, BuildTab.Vehicles)).toBe(stalled);
    expect(rig.world.player(P0).credits).toBe(creditsAtStall);
    expect(stalled).toBeCloseTo(started, 2);

    // And the lights coming back resume it. No refund, no restart.
    rig.world.store.flags[slots.plantA] &= ~EntityFlag.PendingDestroy;
    rig.world.store.flags[slots.plantB] &= ~EntityFlag.PendingDestroy;
    rig.power.markDirty();
    rig.step(10);
    expect(progressOf(rig, BuildTab.Vehicles)).toBeGreaterThan(stalled);
  });

  it('stops the infantry queue too, and says why on the cameo', () => {
    const rig = makeProdRig();
    const slots = base(rig);
    blackout(rig, slots);
    rig.step(3);
    expect(rig.world.store.flags[slots.barracks] & EntityFlag.Powered).toBe(0);

    const gi = rig.catalog.byKey('gi')!;
    const r = rig.service.availabilityOf(P0, gi, out);
    expect(r.ok).toBe(false);
    // NOT 'Requires a production structure'. The barracks is standing, finished
    // and paid for; telling the player to build another one is the wrong answer
    // to the right refusal.
    expect(r.reason).toBe('Needs power');
  });

  it('tells a dark producer apart from a MISSING one, which is the whole point of the string', () => {
    // The Powers tab is where both states are reachable — a commander power
    // names no prereq, so the factory test is the first refusal it meets, and
    // `tests/command-post.spec.ts` already pins the missing case from the other
    // side. A vehicle cannot reach it at all: `grizzly` names `warFactory` as a
    // prereq, so with no factory the prereq loop answers first.
    const rig = makeProdRig();
    const slots = base(rig);
    const airstrike = rig.catalog.byKey('power.airstrike')!;
    expect(rig.service.availabilityOf(P0, airstrike, out).reason)
      .toBe('Requires a production structure');

    const post = plant(rig, 'commandPost', 40, 10);
    rig.step(3);
    expect(rig.service.availabilityOf(P0, airstrike, out).ok).toBe(true);

    // Bomb one plant: 100 produced against 190 drawn (the base's 110 plus the
    // post's 80). The Command Post carries no role flag, so `shedPriority`
    // files it under `tech` — ahead of both factories — and it goes out first.
    bomb(rig, slots.plantB);
    rig.step(3);
    expect(rig.world.store.flags[post] & EntityFlag.Powered).toBe(0);
    expect(rig.service.availabilityOf(P0, airstrike, out).reason).toBe('Needs power');
  });

  it('leaves a dark factory satisfying a PREREQUISITE, which is not the same question', () => {
    // `builtCount` is deliberately incremented for a dark structure. A brownout
    // must not retract the tech tree — that is the soft-lock the NOTE in
    // `census` is about — so a dark War Factory still unlocks everything that
    // names it, it simply cannot build.
    const rig = makeProdRig();
    const slots = base(rig);
    blackout(rig, slots);
    rig.step(3);
    expect(rig.world.store.flags[slots.warFactory] & EntityFlag.Powered).toBe(0);
    expect(rig.service.hasStructure(P0, 'warFactory')).toBe(true);
  });
});

/* ==========================================================================
 * 3. THE ROUTE OUT — the property that makes all of the above shippable
 * ========================================================================== */

describe('a player with no power can always build a power plant', () => {
  const out: AvailabilityResult = { ok: false, reason: '', capped: false };

  it('keeps the Construction Yard lit however deep the deficit', () => {
    // FIRST OF TWO INDEPENDENT REASONS. `PowerGrid.shedPriority` returns `never`
    // for `EntityFlag.IsBuilder`, and the yard is the only publisher of
    // `BuildTab.Structures` in the game.
    const rig = makeProdRig();
    const slots = base(rig);
    blackout(rig, slots);
    rig.step(3);

    const st = rig.world.store;
    expect(st.flags[slots.conyard] & EntityFlag.IsBuilder).not.toBe(0);
    expect(st.flags[slots.conyard] & EntityFlag.Powered).not.toBe(0);
    // Everything else on the grid is out. A total blackout sheds the lot.
    expect(st.flags[slots.refinery] & EntityFlag.Powered).toBe(0);
    expect(st.flags[slots.barracks] & EntityFlag.Powered).toBe(0);
    expect(st.flags[slots.warFactory] & EntityFlag.Powered).toBe(0);
  });

  it('exempts the Structures and Defense tabs by name as well', () => {
    // SECOND REASON, and it is deliberately redundant: `census` names the two
    // tabs rather than relying on a fact that lives in another file. Darken the
    // yard by hand — something the grid will not do — and the answer must not
    // change.
    const rig = makeProdRig();
    const slots = base(rig);
    blackout(rig, slots);
    rig.world.store.flags[slots.conyard] &= ~EntityFlag.Powered;
    rig.step(3);

    const plantEntry = rig.catalog.byKey('powerPlant')!;
    expect(rig.service.availabilityOf(P0, plantEntry, out).ok).toBe(true);
    const pillbox = rig.catalog.byKey('pillbox')!;
    expect(rig.service.availabilityOf(P0, pillbox, out).ok).toBe(true);
  });

  it('actually builds the plant on a dead grid, and the grid comes back', () => {
    // The whole loop, end to end: blackout, order a plant from the one tab that
    // still works, wait, and watch the factory relight. If any link is missing
    // the position is unrecoverable and this feature must not ship.
    const rig = makeProdRig();
    const slots = base(rig);
    blackout(rig, slots);
    rig.step(3);
    expect(rig.world.store.flags[slots.warFactory] & EntityFlag.Powered).toBe(0);
    expect(rig.world.store.flags[slots.barracks] & EntityFlag.Powered).toBe(0);

    const plantEntry = rig.catalog.byKey('powerPlant')!;
    rig.channels.commands.issueProductionStart(P0, BuildTab.Structures, plantEntry.publicId, 1);
    // POWER_BLACKOUT_MUL is 0.25, so the 8 s build takes 32 s of sim. That is
    // the punishment, and it is the only one the route out is allowed to carry.
    rig.step(Math.ceil((plantEntry.buildTime / POWER_BLACKOUT_MUL) / SIM_DT) + 20);
    const q = rig.world.player(P0).queues[BuildTab.Structures as number];
    expect(q.items.length).toBe(1);
    expect(q.items[0].ready).toBe(true);

    // `awaitingPlacement` hands it to the player. Plant it: 100 against a base
    // drawing 110 is still a 10-point deficit, so `shed` takes the single
    // biggest factory-class draw and the INFANTRY come back before the tanks.
    // That is the shed order doing exactly what it advertises, and it is why
    // the recovery is a build ORDER rather than one button.
    rig.service.spawnBuilding(rig.world.player(P0), plantEntry, 44, 10, 1);
    rig.power.markDirty();
    rig.step(3);
    expect(rig.world.store.flags[slots.barracks] & EntityFlag.Powered).not.toBe(0);
    expect(rig.world.store.flags[slots.warFactory] & EntityFlag.Powered).toBe(0);

    rig.service.spawnBuilding(rig.world.player(P0), plantEntry, 44, 16, 1);
    rig.power.markDirty();
    rig.step(3);
    expect(rig.world.store.flags[slots.warFactory] & EntityFlag.Powered).not.toBe(0);

    const grizzly = rig.catalog.byKey('grizzly')!;
    expect(rig.service.availabilityOf(P0, grizzly, out).ok).toBe(true);
  });
});
