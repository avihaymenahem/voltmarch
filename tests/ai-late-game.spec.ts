/**
 * THE AI's LATE GAME — superweapons, commander powers and in-match upgrades.
 *
 * All three shipped in v2.2.0 fully player-usable and the opponent asked for
 * none of them. Each reaches the simulation through a verb the brain already
 * said, so the risk in wiring them up was never "does the command work" — it is
 * that a force multiplier handed to every difficulty rung undoes the ladder,
 * and that a purchase which produces no ENTITY is invisible to every feedback
 * loop this AI has.
 *
 * The two assertions here that are worth more than the rest:
 *
 *   § "an upgrade is asked for once" — an upgrade produces a BIT, not a thing.
 *     Nothing in the census can see it, so without an explicit memory the
 *     scorer re-proposes the same purchase on every build pass forever and
 *     starves everything ranked below it. That is not a hypothetical: it is
 *     what happened, and `ai-economy-handicap.spec.ts` caught it as a Brutal
 *     brain that could no longer reach its own refinery cap.
 *
 *   § "no cheating vision" — a superweapon is aimed across the map at a point
 *     the AI cannot see from where its units are standing. Every target here
 *     comes from the remembered-structure table or the threat grid, both of
 *     which are filled only through `vision.canSee`, and a blind brain must
 *     therefore never fire.
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, CommandKind, EntityFlag, EntityKind, Faction, OrderKind, UpgradeScope, VisionLevel,
} from '../src/core/types';
import { NONE } from '../src/core/types';
import type { Command, EntityId, IRng, IVision, PlayerId, SimContext } from '../src/core/types';
import { AI_SKILL, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';

import { AiBrain } from '../src/sim/AI';
import {
  AI_SUPERWEAPON, AI_UPGRADE, BuildCatalog, BuildRole, FALLBACK_CATALOG,
  UpgradeAudience, difficultyProfile, superweaponPlanFor, upgradePlanFor,
} from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';
import { UPGRADES } from '../src/sim/Upgrades';
import { SUPERWEAPONS, setSuperweaponService, superweapons } from '../src/sim/Superweapons';
import type { SuperweaponService } from '../src/sim/Superweapons';
import { commanderPowers, setCommanderPowerService } from '../src/sim/CommanderPowers';
import type { CommanderPowerService } from '../src/sim/CommanderPowers';
import { CommanderPowerId } from '../src/progression/powers';

const P_HUMAN = 0 as PlayerId;
const P_AI = 1 as PlayerId;
const EASY = 0;
const NORMAL = 1;
const HARD = 2;
const BRUTAL = 3;

/* ========================================================================== */
/* Harness                                                                    */
/* ========================================================================== */

/**
 * A def binding whose UNIT ids start at 1000.
 *
 * The version in `ai.spec.ts` numbers buildings and units from 0 in two
 * independent spaces, which is fine for what that file asserts and quietly
 * ruinous here: `Command.defId` carries no "is this a building" bit, so a
 * Structures-tab upgrade (a non-building) and an ordinary structure can be
 * handed the SAME id, and "did the AI buy an upgrade" then answers yes every
 * time it built a power plant. Every failing expectation in the first run of
 * this file was that collision and not the AI.
 */
function syntheticBinding(): DefLookup {
  const catalog = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 1000;
  let b = 0;
  for (const e of catalog.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { tables: null, unitId, buildingId };
}

function simCtx(tick: number, rng: IRng): SimContext {
  return { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
}

function spawnBuilding(
  world: World, owner: PlayerId, x: number, z: number,
  w: number, h: number, flags: number, power: number,
): EntityId {
  const st = world.store;
  const id = st.alloc(EntityKind.Building, -1, owner, Faction.Soviets, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= flags;
  st.footprintW[i] = w;
  st.footprintH[i] = h;
  st.powerDraw[i] = power;
  st.hp[i] = 2000;
  st.maxHp[i] = 2000;
  st.armorClass[i] = ArmorClass.Concrete;
  st.buildProgress[i] = 1;
  return id;
}

function spawnUnit(
  world: World, owner: PlayerId, x: number, z: number,
  flags: number, kind = EntityKind.Vehicle,
): EntityId {
  const st = world.store;
  const id = st.alloc(kind, -1, owner, Faction.Soviets, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | flags;
  st.hp[i] = 300;
  st.maxHp[i] = 300;
  st.maxSpeed[i] = 6;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2;
  return id;
}

interface Options {
  difficulty?: number;
  /** Refineries the AI owns. The superweapon gate is `maxRefineries`. */
  refineries?: number;
  /** A Proving Ground, which every superweapon and one upgrade names as a prereq. */
  techLab?: boolean;
  infantry?: number;
  vehicles?: number;
  harvesters?: number;
  credits?: number;
  power?: number;
  /** Replace the vision port. Used by the no-cheating-vision case. */
  vision?: IVision;
}

/**
 * Ticks to let the scripted opening run itself out.
 *
 * There is no production module in this rig, so nothing the AI queues ever
 * completes and each opening step has to time out on
 * `AI_BUILD.requestTimeoutTicks` (300) before the script advances. Seven steps
 * is a little over 2000 ticks, and only past the end of the script does
 * `chooseBuild` reach the adaptive layer where the late game is scored.
 */
const PAST_OPENING = 4000;

interface Harness {
  world: World;
  channels: Channels;
  brain: AiBrain;
  log: Command[];
  step(ticks: number): void;
  /** Remember an enemy structure by letting the brain observe one. */
  enemyBuilding(x: number, z: number, flags: number, power: number): EntityId;
}

/**
 * A Soviet AI at (400, 400) with a complete tech base, an infinite-ish bank and
 * as much power as the caller asks for. Deliberately NOT a from-scratch opening
 * — everything under test here happens after the opening has run, and building
 * up to it through the scripted script would make every case a timing test.
 */
function makeHarness(options: Options = {}): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P_AI);
  ai.aiDifficulty = options.difficulty ?? BRUTAL;
  ai.aiPersonality = 0;
  ai.credits = options.credits ?? 20000;
  ai.storageMax = 40000;
  ai.powerProduced = options.power ?? 800;
  ai.powerConsumed = 0;

  // The tech base. `roleOfBuilding`'s flag heuristic classifies each of these:
  // IsBuilder -> Builder, IsRefinery -> Refinery, IsRadar -> Radar, a positive
  // powerDraw -> Power, IsFactory at width >= 3 -> WarFactory and below that
  // -> Barracks, and a 2x2 that merely draws power -> TechLab.
  spawnBuilding(world, P_AI, 400, 400, 3, 3, EntityFlag.IsBuilder | EntityFlag.IsFactory, -20);
  spawnBuilding(world, P_AI, 380, 400, 2, 2, 0, 100);
  spawnBuilding(world, P_AI, 424, 388, 2, 2, EntityFlag.IsFactory, -20);
  spawnBuilding(world, P_AI, 424, 412, 3, 2, EntityFlag.IsFactory, -40);
  spawnBuilding(world, P_AI, 440, 400, 2, 2, EntityFlag.IsRadar, -40);
  if (options.techLab !== false) spawnBuilding(world, P_AI, 360, 380, 2, 2, 0, -60);
  for (let r = 0; r < (options.refineries ?? 3); r++) {
    spawnBuilding(world, P_AI, 376 - r * 24, 424, 3, 2, EntityFlag.IsRefinery, -30);
  }
  for (let h = 0; h < (options.harvesters ?? 6); h++) {
    spawnUnit(world, P_AI, 410 + h * 3, 430, EntityFlag.IsHarvester);
  }
  for (let n = 0; n < (options.infantry ?? 0); n++) {
    spawnUnit(world, P_AI, 404 + n * 2, 418, EntityFlag.CanAttack, EntityKind.Infantry);
  }
  for (let n = 0; n < (options.vehicles ?? 0); n++) {
    spawnUnit(world, P_AI, 396 + n * 3, 418, EntityFlag.CanAttack);
  }
  if (options.vision !== undefined) world.vision = options.vision;

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, 4242);
  brain.attach(channels.events);

  const log: Command[] = [];
  const rng = new Rng(7);
  let tick = 0;

  return {
    world,
    channels,
    brain,
    log,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        world.spatial.rebuild();
        brain.tick(simCtx(tick, rng));
        channels.commands.drain((c) => {
          log.push({
            ...c,
            entities: c.entities.slice(0, c.entityCount),
            entityCount: c.entityCount,
          });
        });
      }
    },
    enemyBuilding(x, z, flags, power): EntityId {
      const st = world.store;
      const id = st.alloc(EntityKind.Building, -1, P_HUMAN, Faction.Allies, x, 0, z, 0);
      const i = st.index(id);
      st.flags[i] |= flags;
      st.footprintW[i] = 3;
      st.footprintH[i] = 2;
      st.powerDraw[i] = power;
      st.hp[i] = 2000;
      st.maxHp[i] = 2000;
      st.armorClass[i] = ArmorClass.Concrete;
      st.buildProgress[i] = 1;
      return id;
    },
  };
}

/*
 * Both `arm*` helpers RESTORE WHAT WAS THERE rather than setting null.
 *
 * These are process-wide module singletons that `tests/superweapons.spec.ts`
 * and `tests/commander-powers.spec.ts` also install. Vitest isolates the module
 * registry per spec FILE, so today nothing here can reach those — but "today"
 * is doing a lot of work in that sentence, and a teardown that clears a slot it
 * did not own is the kind of order-dependent failure that shows up once in a
 * hundred runs and is then impossible to attribute. Saving and restoring costs
 * one line and removes the whole class.
 */

/** Install a superweapon service that reports one weapon charged and ready. */
function armSuperweapon(structure: EntityId, key: string): () => void {
  const previous = superweapons();
  const stub = {
    isReady: (_p: PlayerId, k: string): boolean => k === key,
    structureFor: (_p: PlayerId, k: string): EntityId => (k === key ? structure : NONE),
  };
  setSuperweaponService(stub as unknown as SuperweaponService);
  return () => setSuperweaponService(previous);
}

/** Install a commander-power service that reports every power ready. */
function armPowers(): () => void {
  const previous = commanderPowers();
  const stub = { isReady: (): boolean => true };
  setCommanderPowerService(stub as unknown as CommanderPowerService);
  return () => setCommanderPowerService(previous);
}

/** Sees nothing, ever. Same shape as the blind port in `ai.spec.ts`. */
const blindVision: IVision = {
  isVisibleAt: () => false,
  isExplored: () => false,
  canSee: () => false,
  hasRadar: () => false,
  gridFor: () => new Uint8Array(1),
  visibilityOf: () => VisionLevel.Hidden,
};

function powerCommands(log: Command[]): Command[] {
  return log.filter((c) => c.kind === CommandKind.UsePower);
}

function abilityOrders(log: Command[]): Command[] {
  return log.filter((c) => c.kind === CommandKind.Order && c.order === OrderKind.UseAbility);
}

/* ========================================================================== */
/* 1. Doctrine — pure tables, no world                                        */
/* ========================================================================== */

describe('the late-game doctrine tables', () => {
  const PLAYABLE = [Faction.Allies, Faction.Soviets, 3 as Faction, 4 as Faction];

  it('gives every army exactly the three upgrades it owns', () => {
    for (const faction of PLAYABLE) {
      const plan = upgradePlanFor(faction);
      expect(plan.length, `faction ${faction}`).toBe(3);
      const owned = UPGRADES.filter((u) => (u.faction as number) === (faction as number));
      expect(plan.map((s) => s.key).sort()).toEqual(owned.map((u) => u.key).sort());
    }
  });

  it('buys the economy multiplier first, because it is the one that repays itself', () => {
    for (const faction of PLAYABLE) {
      const plan = upgradePlanFor(faction);
      // Allies (BuildSpeed), Soviets and Reclamation (Yield) all lead with an
      // income lever. The Pact's `All`-scope row is Cooldown, which is a combat
      // lever and correctly classifies as Army rather than Economy — so the
      // assertion is that the FIRST step is never a single-class one.
      expect(
        plan[0].audience === UpgradeAudience.Economy || plan[0].audience === UpgradeAudience.Army,
        `faction ${faction} leads with ${plan[0].key}`,
      ).toBe(true);
      // ...and the two single-class levers are always behind it, vehicle first.
      const vehicle = plan.findIndex((s) => s.audience === UpgradeAudience.Vehicle);
      const infantry = plan.findIndex((s) => s.audience === UpgradeAudience.Infantry);
      expect(vehicle).toBeGreaterThan(0);
      expect(infantry).toBeGreaterThan(vehicle);
    }
  });

  it('names an offensive superweapon first in every army that has a choice', () => {
    // `forRole` would hand the Allies a Displacement Ring purely because of table
    // order, and a Displacement Ring is worth what your plan for nine teleported
    // tanks is worth. The plan overrides that.
    expect(superweaponPlanFor(Faction.Allies)[0]).toBe('weatherControl');
    expect(superweaponPlanFor(Faction.Soviets)[0]).toBe('nuclearSilo');
    const catalog = new BuildCatalog();
    for (const faction of PLAYABLE) {
      const plan = superweaponPlanFor(faction);
      expect(plan.length, `faction ${faction}`).toBeGreaterThan(0);
      for (const key of plan) {
        const entry = catalog.get(key);
        expect(entry, key).toBeDefined();
        expect(entry!.role, key).toBe(BuildRole.Superweapon);
        expect(entry!.faction as number, key).toBe(faction as number);
        // The service finds the structure by CONTENT KEY, so a plan naming
        // something `SUPERWEAPONS` does not gate would build a 2500-credit
        // building that charges nothing.
        expect(
          SUPERWEAPONS.some((d) => d.structureKeys.indexOf(key) >= 0),
          `${key} gates no superweapon`,
        ).toBe(true);
      }
    }
  });

  it('carries every upgrade in the catalog, or the AI cannot name one', () => {
    // `bindOracle` walks FALLBACK_CATALOG and asks about each key. A row that is
    // not here is a purchase the AI can never make, which is exactly the state
    // this whole change existed to fix — so a thirteenth upgrade added to
    // `Upgrades.ts` has to fail here rather than silently never be bought.
    const rows = FALLBACK_CATALOG.filter((e) => e.role === BuildRole.Upgrade);
    expect(rows.length).toBe(UPGRADES.length);
    for (const u of UPGRADES) {
      const row = rows.find((e) => e.key === u.key);
      expect(row, `${u.key} missing from FALLBACK_CATALOG`).toBeDefined();
      expect(row!.faction as number, u.key).toBe(u.faction as number);
      expect(row!.isBuilding, u.key).toBe(false);
      // Weight 0 keeps it out of the composition roll — an upgrade must never
      // win a "what do I attack with" decision.
      expect(row!.weight, u.key).toBe(0);
      // The tab is the gate. Infantry needs a barracks servicing that queue.
      const wantTab = u.scope === UpgradeScope.Infantry ? 2
        : u.scope === UpgradeScope.Vehicle ? 3 : 0;
      expect(row!.tab as number, u.key).toBe(wantTab);
    }
  });

  it('resolves upgrade rows through the ordinary def binding', () => {
    // `ai.spec.ts` asserts `resolvedCount === all.length` after `bind()`. The
    // twelve new rows have to travel that path like everything else.
    const catalog = new BuildCatalog();
    catalog.bind(syntheticBinding());
    for (const u of UPGRADES) expect(catalog.resolved(u.key), u.key).toBe(true);
  });
});

describe('the late-game difficulty ladder', () => {
  const rungs = [EASY, NORMAL, HARD, BRUTAL].map(difficultyProfile);

  it('gives Easy none of it', () => {
    // Every system here is a force multiplier and the bottom rung is where the
    // ladder should be gentlest. An Easy brain also cannot pay: creditFloor is
    // 1400 and it runs two refineries.
    expect(rungs[EASY].maxSuperweapons).toBe(0);
    expect(rungs[EASY].maxUpgrades).toBe(0);
    expect(rungs[EASY].powerMask).toBe(0);
  });

  it('never takes something away as the difficulty rises', () => {
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i].maxSuperweapons, rungs[i].name)
        .toBeGreaterThanOrEqual(rungs[i - 1].maxSuperweapons);
      expect(rungs[i].maxUpgrades, rungs[i].name)
        .toBeGreaterThanOrEqual(rungs[i - 1].maxUpgrades);
      // A strict superset: a rung may add a power, never swap one out.
      expect(rungs[i].powerMask & rungs[i - 1].powerMask, rungs[i].name)
        .toBe(rungs[i - 1].powerMask);
    }
    expect(rungs[BRUTAL].maxSuperweapons).toBeGreaterThan(rungs[EASY].maxSuperweapons);
    expect(rungs[BRUTAL].powerMask).toBeGreaterThan(rungs[NORMAL].powerMask);
  });

  it('gives Normal the two powers that do not attack, and Hard the two that do', () => {
    const has = (mask: number, p: CommanderPowerId): boolean => (mask & (1 << p)) !== 0;
    expect(has(rungs[NORMAL].powerMask, CommanderPowerId.OreBoost)).toBe(true);
    expect(has(rungs[NORMAL].powerMask, CommanderPowerId.EmergencyRepair)).toBe(true);
    expect(has(rungs[NORMAL].powerMask, CommanderPowerId.Airstrike)).toBe(false);
    expect(has(rungs[HARD].powerMask, CommanderPowerId.Airstrike)).toBe(true);
    expect(has(rungs[HARD].powerMask, CommanderPowerId.Chronoshift)).toBe(false);
    expect(has(rungs[BRUTAL].powerMask, CommanderPowerId.Chronoshift)).toBe(true);
  });

  it('keeps the profile shape identical across rungs', () => {
    // `ai.spec.ts` asserts this too; repeated here because the three fields
    // added for the late game are the ones most likely to be given to one rung
    // and forgotten on another.
    for (const r of rungs) {
      expect(Object.keys(r).join(',')).toBe(Object.keys(rungs[0]).join(','));
    }
  });
});

/* ========================================================================== */
/* 2. Upgrades                                                                */
/* ========================================================================== */

function upgradeStarts(log: Command[]): Command[] {
  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const ids = new Set(
    UPGRADES.map((u) => catalog.get(u.key)?.defId).filter((d): d is number => d !== undefined),
  );
  return log.filter((c) => c.kind === CommandKind.ProductionStart && ids.has(c.defId));
}

describe('the AI buys in-match upgrades', () => {
  it('does not, on Easy', () => {
    const h = makeHarness({ difficulty: EASY, vehicles: 12, infantry: 12 });
    h.step(600);
    expect(upgradeStarts(h.log).length).toBe(0);
    expect(h.brain.upgradeRequestCount).toBe(0);
  });

  it('buys them on Brutal, economy multiplier first', () => {
    const h = makeHarness({ difficulty: BRUTAL, vehicles: 12, infantry: 12 });
    h.step(900);
    const bought = upgradeStarts(h.log);
    expect(bought.length).toBeGreaterThan(0);

    const catalog = new BuildCatalog();
    catalog.bind(syntheticBinding());
    const keyOf = (defId: number): string =>
      UPGRADES.find((u) => catalog.get(u.key)?.defId === defId)?.key ?? '?';
    // The Soviet economy lever is Slurry Reclaimers, +20% on every ore load.
    expect(keyOf(bought[0].defId)).toBe('upgSovietSlurry');
    expect(h.brain.upgradeRequestCount).toBeGreaterThan(0);
  });

  it('takes only the front of the plan on Normal', () => {
    const h = makeHarness({ difficulty: NORMAL, vehicles: 12, infantry: 12 });
    h.step(3000);
    const keys = new Set(upgradeStarts(h.log).map((c) => c.defId));
    expect(keys.size).toBeLessThanOrEqual(difficultyProfile(NORMAL).maxUpgrades);
  });

  it('will not buy a combat multiplier over an army that does not exist', () => {
    // The vehicle lever is 1200 credits for 25% more damage on every hull. Over
    // one hull that is a disaster; the gate is `AI_UPGRADE.minVehicles`.
    //
    // `harvesters: 0` is load-bearing and is not the test dodging the gate. A
    // harvester IS an `EntityKind.Vehicle` and `PlayerState.upgradeMul` is
    // indexed by kind, so a vehicle-scope multiplier genuinely covers the ore
    // trucks — Composite Armour really does take 18% off a 1400-credit hull.
    // The census counts them for exactly that reason, so a rig that left the
    // default six trucks standing would clear `minVehicles` on trucks alone and
    // prove nothing about the army gate.
    const bare = makeHarness({ difficulty: BRUTAL, vehicles: 1, infantry: 1, harvesters: 0 });
    bare.step(PAST_OPENING);
    const catalog = new BuildCatalog();
    catalog.bind(syntheticBinding());
    const uranium = catalog.get('upgSovietUranium')!.defId;
    const armour = catalog.get('upgSovietBodyArmour')!.defId;
    expect(bare.log.some((c) => c.defId === uranium)).toBe(false);
    expect(bare.log.some((c) => c.defId === armour)).toBe(false);

    const full = makeHarness({
      difficulty: BRUTAL,
      vehicles: AI_UPGRADE.minVehicles + 2,
      infantry: AI_UPGRADE.minInfantry + 2,
    });
    full.step(3000);
    expect(full.log.some((c) => c.defId === uranium)).toBe(true);
  });

  it('asks for each upgrade ONCE, not on every build pass', () => {
    // THE REGRESSION. An upgrade produces no entity, so nothing in the census
    // can tell the scorer it landed. Without `upgradeSettled` the same 1000-
    // credit purchase is re-proposed twice a second for the rest of the match
    // and starves the third refinery behind it — which is how this was found.
    const h = makeHarness({ difficulty: BRUTAL, vehicles: 12, infantry: 12 });
    h.step(3000);
    const bought = upgradeStarts(h.log);
    const perDef = new Map<number, number>();
    for (const c of bought) perDef.set(c.defId, (perDef.get(c.defId) ?? 0) + 1);
    for (const [defId, n] of perDef) {
      expect(n, `defId ${defId} requested ${n} times in 100 seconds`).toBeLessThanOrEqual(2);
    }
    expect(bought.length).toBeLessThanOrEqual(UPGRADES.length);
  });
});

/* ========================================================================== */
/* 3. Superweapons — building one                                             */
/* ========================================================================== */

describe('the AI builds a superweapon', () => {
  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const siloId = catalog.get('nuclearSilo')!.defId;
  const curtainId = catalog.get('ironCurtain')!.defId;
  const plantId = catalog.get('powerPlant')!.defId;

  it('never on Easy, even with the tech and the bank for one', () => {
    const h = makeHarness({ difficulty: EASY, refineries: 3, power: 2000 });
    h.step(PAST_OPENING);
    expect(h.log.some((c) => c.defId === siloId || c.defId === curtainId)).toBe(false);
    expect(h.brain.superweaponCount).toBe(0);
  });

  it('on Brutal, once the economy is finished and the power is there', () => {
    const h = makeHarness({ difficulty: BRUTAL, refineries: 3, power: 2000 });
    h.step(PAST_OPENING);
    expect(h.log.some((c) => c.defId === siloId)).toBe(true);
  });

  it('not before the economy is finished', () => {
    // A superweapon is bought OUT OF a working economy, never INSTEAD OF one.
    // Scored on its own merits it beats a third refinery, because the refinery
    // term decays with every one already owned — so this has to be a gate.
    const h = makeHarness({ difficulty: BRUTAL, refineries: 1, power: 2000 });
    h.step(PAST_OPENING);
    expect(h.log.some((c) => c.defId === siloId)).toBe(false);
  });

  it('builds the POWER for it rather than stalling forever', () => {
    // A silo in a brownout charges NOTHING — `rescanAvailability` skips any
    // unpowered structure — so the AI must not build one it cannot run. But
    // nothing else supplies that power: `powerUrgent` fires at a surplus of 40
    // and a working base sits comfortably above it, so the brain parked at a
    // surplus that was fine for everything it owned and 150 short of the one
    // thing it wanted. Watching a real match is what found this.
    const h = makeHarness({ difficulty: BRUTAL, refineries: 3, power: 120 });
    h.step(PAST_OPENING);
    expect(h.log.some((c) => c.defId === siloId), 'must not build an unpowerable silo').toBe(false);
    expect(h.log.some((c) => c.defId === plantId), 'must build power for it').toBe(true);
  });

  it('builds the second one only after the first, and never a duplicate', () => {
    const h = makeHarness({ difficulty: BRUTAL, refineries: 3, power: 4000 });
    h.step(PAST_OPENING);
    const first = h.log.filter((c) => c.kind === CommandKind.ProductionStart
      && (c.defId === siloId || c.defId === curtainId));
    // The plan is [nuclearSilo, ironCurtain] and only the first unbuilt entry
    // is ever offered to the scorer, so nothing can queue the Field while the
    // Silo is still outstanding.
    for (const c of first) expect(c.defId).toBe(siloId);
  });
});

/* ========================================================================== */
/* 4. Superweapons — firing one                                               */
/* ========================================================================== */

describe('the AI fires a superweapon', () => {
  /** A base for the AI to have seen, plus a lone outbuilding far from it. */
  function withEnemyBase(h: Harness): void {
    // A tight cluster: refinery, war factory, power. `strikeValue` scores the
    // economy highest, and `bestCluster` sums over the blast radius.
    h.enemyBuilding(120, 120, EntityFlag.IsRefinery, -30);
    h.enemyBuilding(132, 120, EntityFlag.IsFactory, -40);
    h.enemyBuilding(120, 132, 0, 100);
    // ...and one isolated structure on the far side of the map.
    h.enemyBuilding(300, 460, 0, 100);
  }

  it('puts an ordinary UseAbility order on the gating structure', () => {
    const h = makeHarness({ difficulty: BRUTAL, refineries: 3, power: 2000 });
    const silo = spawnBuilding(h.world, P_AI, 368, 416, 3, 3, 0, -150);
    withEnemyBase(h);
    const disarm = armSuperweapon(silo, 'nuke');
    try {
      h.step(600);
    } finally {
      disarm();
    }

    const fired = abilityOrders(h.log);
    expect(fired.length, 'the AI must fire the charged nuke').toBeGreaterThan(0);
    // Addressed to the STRUCTURE, exactly as `SuperweaponService.issueFire`
    // builds it for a human's reticle — `consumeOrders` reads it off a building.
    expect(fired[0].entities[0]).toBe(silo as number);
    expect(fired[0].player as number).toBe(P_AI as number);
    expect(h.brain.superweaponFireCount).toBeGreaterThan(0);
  });

  it('aims at the cluster, not at the nearest lone building', () => {
    const h = makeHarness({ difficulty: BRUTAL, refineries: 3, power: 2000 });
    const silo = spawnBuilding(h.world, P_AI, 368, 416, 3, 3, 0, -150);
    withEnemyBase(h);
    const disarm = armSuperweapon(silo, 'nuke');
    try {
      h.step(600);
    } finally {
      disarm();
    }

    const fired = abilityOrders(h.log);
    expect(fired.length).toBeGreaterThan(0);
    const { x, z } = fired[0];
    // The three-building knot is at ~(124, 124); the lone one at (300, 460) is
    // both closer to the AI's base and worth far less. A warhead does not have
    // to walk there, so distance is not a discount — value is the whole score.
    expect(Math.hypot(x - 124, z - 124), `fired at ${x},${z}`).toBeLessThan(24);
  });

  it('does not fire at a base it has never seen', () => {
    // THE VISION DISCIPLINE. Every aim point comes from the remembered-structure
    // table or the threat grid, and both are filled only through `canSee`.
    const h = makeHarness({
      difficulty: BRUTAL, refineries: 3, power: 2000, vision: blindVision,
    });
    const silo = spawnBuilding(h.world, P_AI, 368, 416, 3, 3, 0, -150);
    withEnemyBase(h);
    const disarm = armSuperweapon(silo, 'nuke');
    try {
      h.step(900);
    } finally {
      disarm();
    }
    expect(abilityOrders(h.log).length).toBe(0);
    expect(h.brain.superweaponFireCount).toBe(0);
  });

  it('does not fire at all on Easy, even holding a charged one', () => {
    // The fire layer reads the same `maxSuperweapons` the build layer does, so
    // a scenario that hands an Easy brain a silo still never presses the button.
    const h = makeHarness({ difficulty: EASY, refineries: 3, power: 2000 });
    const silo = spawnBuilding(h.world, P_AI, 368, 416, 3, 3, 0, -150);
    withEnemyBase(h);
    const disarm = armSuperweapon(silo, 'nuke');
    try {
      h.step(900);
    } finally {
      disarm();
    }
    expect(abilityOrders(h.log).length).toBe(0);
  });

  it('holds an Ironclad Field until its own group is actually in contact', () => {
    // Twenty seconds of invulnerability is worth nothing in an empty field.
    const quiet = makeHarness({
      difficulty: BRUTAL, refineries: 3, power: 2000, vehicles: 8,
    });
    const device = spawnBuilding(quiet.world, P_AI, 368, 416, 3, 3, 0, -150);
    const disarm = armSuperweapon(device, 'ironCurtain');
    try {
      quiet.step(900);
    } finally {
      disarm();
    }
    expect(abilityOrders(quiet.log).length, 'no enemy near the group').toBe(0);
  });
});

/* ========================================================================== */
/* 5. Commander powers                                                        */
/* ========================================================================== */

describe('the AI calls commander powers', () => {
  it('never on Easy', () => {
    const h = makeHarness({ difficulty: EASY, credits: 1000 });
    const disarm = armPowers();
    try {
      h.step(900);
    } finally {
      disarm();
    }
    expect(powerCommands(h.log).length).toBe(0);
    expect(h.brain.commanderPowerCount).toBe(0);
  });

  it('takes the free money on Normal when the bank has room for it', () => {
    // 2500 credits paid into a full bank is 2500 credits on the floor —
    // `Economy.grant` clamps at `storageMax`.
    const h = makeHarness({ difficulty: NORMAL, credits: 1000 });
    const disarm = armPowers();
    try {
      h.step(300);
    } finally {
      disarm();
    }
    const called = powerCommands(h.log);
    expect(called.length).toBeGreaterThan(0);
    expect(called[0].arg).toBe(CommanderPowerId.OreBoost as number);
    expect(h.brain.commanderPowerCount).toBeGreaterThan(0);
  });

  it('does not call an Ore Boost into a bank that is already full', () => {
    const h = makeHarness({ difficulty: NORMAL, credits: 39000 });
    const disarm = armPowers();
    try {
      h.step(600);
    } finally {
      disarm();
    }
    const boosts = powerCommands(h.log)
      .filter((c) => c.arg === (CommanderPowerId.OreBoost as number));
    expect(boosts.length).toBe(0);
  });

  it('never calls a power its difficulty is not given', () => {
    const h = makeHarness({ difficulty: NORMAL, credits: 1000 });
    const disarm = armPowers();
    try {
      h.step(3000);
    } finally {
      disarm();
    }
    const mask = difficultyProfile(NORMAL).powerMask;
    for (const c of powerCommands(h.log)) {
      expect((mask & (1 << c.arg)) !== 0, `power ${c.arg} is not on the Normal rung`).toBe(true);
    }
  });

  it('scans for the enemy only while it has no idea where they are', () => {
    const lost = makeHarness({ difficulty: BRUTAL, credits: 1000 });
    let disarm = armPowers();
    try {
      lost.step(300);
    } finally {
      disarm();
    }
    const scans = powerCommands(lost.log)
      .filter((c) => c.arg === (CommanderPowerId.OrbitalScan as number));
    expect(scans.length, 'a lost brain should chart the far start position').toBeGreaterThan(0);

    // Measured from AFTER the first census, deliberately. The late layer runs
    // on a faster clock than the census, so on tick 8 of a match the brain has
    // genuinely not looked at anything yet and charting the far corner is the
    // right call. What must not happen is a SECOND scan once the base is known.
    const found = makeHarness({ difficulty: BRUTAL, credits: 1000 });
    found.enemyBuilding(120, 120, EntityFlag.IsRefinery, -30);
    disarm = armPowers();
    try {
      found.step(120);
      expect(found.brain.memorySize, 'the census must have seen the base').toBeGreaterThan(0);
      const settled = powerCommands(found.log)
        .filter((c) => c.arg === (CommanderPowerId.OrbitalScan as number)).length;
      found.step(600);
      const after = powerCommands(found.log)
        .filter((c) => c.arg === (CommanderPowerId.OrbitalScan as number)).length;
      expect(after - settled, 'a second circle over a known base buys nothing').toBe(0);
    } finally {
      disarm();
    }
  });

  it('spends an action from the APM budget for every power', () => {
    // A power costs no credits, but it costs an ACTION. A rung that got its
    // powers for free would be spending an APM it does not have.
    const h = makeHarness({ difficulty: NORMAL, credits: 1000 });
    const before = h.brain.issuedCount;
    const disarm = armPowers();
    try {
      h.step(300);
    } finally {
      disarm();
    }
    expect(h.brain.issuedCount - before).toBeGreaterThanOrEqual(h.brain.commanderPowerCount);
  });
});

/* ========================================================================== */
/* 6. Transports — not confusing the existing logic                           */
/* ========================================================================== */

describe('passengers do not inflate the army', () => {
  it('leaves a garrisoned unit out of the census', () => {
    // `ORDERABLE_REJECT` has masked `Garrisoned` since it was written, so a man
    // riding in a hull is skipped by every order path — but he was still
    // COUNTED, and `armyCount` is what the wave threshold divides up. An AI that
    // reaches its attack threshold on bodies it cannot send masses forever,
    // permanently short of a strike group it is unable to assemble. Reachable
    // today through `GarrisonService` alone; the three passenger-carrying hulls
    // that landed in v2.2.0 are a second road to the same place.
    const h = makeHarness({ difficulty: BRUTAL, infantry: 6 });
    h.step(60);
    const loose = h.brain.armySize;
    expect(loose).toBeGreaterThanOrEqual(6);

    const st = h.world.store;
    let boarded = 0;
    for (let a = 0; a < st.aliveCount && boarded < 3; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== (P_AI as number) || st.kind[i] !== EntityKind.Infantry) continue;
      st.flags[i] |= EntityFlag.Garrisoned;
      boarded++;
    }
    expect(boarded).toBe(3);

    h.step(60);
    expect(h.brain.armySize, 'three passengers must leave the roster').toBe(loose - 3);
  });
});

/* ========================================================================== */
/* 7. Determinism                                                             */
/* ========================================================================== */

describe('the late game is deterministic', () => {
  it('produces an identical command stream from the same seed', () => {
    // Nothing added for the late layer draws from the RNG at all — every choice
    // is a scan of remembered structures, the threat grid and the census.
    function run(): string[] {
      const h = makeHarness({ difficulty: BRUTAL, refineries: 3, power: 2000, vehicles: 10 });
      const silo = spawnBuilding(h.world, P_AI, 368, 416, 3, 3, 0, -150);
      h.enemyBuilding(120, 120, EntityFlag.IsRefinery, -30);
      h.enemyBuilding(132, 120, EntityFlag.IsFactory, -40);
      const disarm = armSuperweapon(silo, 'nuke');
      const restore = armPowers();
      try {
        h.step(900);
      } finally {
        disarm();
        restore();
      }
      return h.log.map((c) => [
        c.kind, c.order, c.defId, c.arg, Math.round(c.x), Math.round(c.z),
      ].join('|'));
    }
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});

/* ========================================================================== */
/* 8. The tunables mean what the code assumes                                 */
/* ========================================================================== */

describe('the late-game constants stay coherent', () => {
  it('keeps the superweapon below the producers it must never displace', () => {
    // 1.8 is "need a war factory" and 2.2 is "expanding to a new ore field".
    expect(AI_SUPERWEAPON.score).toBeLessThan(1.8);
    expect(AI_UPGRADE.score).toBeLessThan(1.8);
    // ...and above the 0.35 floor below which banking beats building.
    expect(AI_UPGRADE.score).toBeGreaterThan(0.35);
  });

  it('asks for enough power headroom that a silo actually charges', () => {
    // The gate is `surplus + entry.power >= powerHeadroom` and every
    // superweapon draws 150, so a positive headroom is what keeps the structure
    // lit. `rescanAvailability` skips an unpowered one entirely.
    expect(AI_SUPERWEAPON.powerHeadroom).toBeGreaterThan(0);
    const silo = new BuildCatalog().get('nuclearSilo')!;
    expect(silo.power).toBeLessThan(0);
  });

  it('never lets the superweapon gate undercut the difficulty refinery cap', () => {
    for (const rung of [NORMAL, HARD, BRUTAL].map(difficultyProfile)) {
      if (rung.maxSuperweapons === 0) continue;
      const gate = Math.max(AI_SUPERWEAPON.minRefineries, rung.maxRefineries);
      expect(gate, rung.name).toBeGreaterThanOrEqual(AI_SKILL[rung.index]!.maxRefineries);
    }
  });

  it('re-asks for an upgrade far less often than a build pass', () => {
    // `AI_CADENCE.build` is 15 ticks. The backoff has to be orders of magnitude
    // longer or it is not a backoff.
    expect(AI_UPGRADE.reaskTicks).toBeGreaterThan(600);
  });

  it('keeps the chronosphere commit inside its own staging window', () => {
    // The source and destination commands are one late-layer pass apart (15
    // ticks). If the commit window were shorter than that the AI would re-stage
    // forever and the weapon would never fire.
    expect(AI_SUPERWEAPON.chronoCommitTicks).toBeGreaterThan(15);
    expect(AI_SUPERWEAPON.chronoDropStandoff).toBeLessThan(AI_SUPERWEAPON.chronoMinTravel);
  });
});
