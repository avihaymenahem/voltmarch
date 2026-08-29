/**
 * ============================================================================
 * tests/commander.spec.ts — the hero unit: one alive, rebuildable, one verb
 * ============================================================================
 * Four things this file exists to stop, all of which fail SILENTLY:
 *
 *   1. THE CAP NOT BEING CONNECTED. `maxAlive` is authored on the def, copied
 *      into `BuildEntry` by `resolveEntry`, and read by `availabilityOf`. Break
 *      any link in that chain and the game does not error — you simply get as
 *      many commanders as you can pay for, which reads as a balance decision.
 *      This is the same shape of defect as the unlock gate's, and it is why
 *      every catalog below is built from `resolveDefBinding()`: with the
 *      `EMPTY_BINDING` rig the other production tests use, `maxAlive` resolves
 *      to 0 for everything and the whole file would pass vacuously.
 *
 *   2. THE QUEUED HALF BEING FORGOTTEN. A cap that counts only living units
 *      lets a player queue five while the first is still building. All five
 *      then walk out, one at a time, and the cap looks like it works right up
 *      until it does not.
 *
 *   3. A COMMANDER THAT CANNOT BE REBUILT. The whole design is "you get another
 *      when this one dies". If the census does not notice the death, the slot
 *      never frees and the player has permanently lost the unit.
 *
 *   4. AN ABILITY BOUND TO NOTHING. `UnitDef.ability` is a number; a typo makes
 *      it a number that indexes nothing, and the button renders blank rather
 *      than throwing.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ABILITIES, ABILITY_FX, AbilityId, CELL, SIM_DT } from '../src/core/config';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { EntityFlag, EntityKind, Faction, OrderKind, UnitState } from '../src/core/types';
import type { AvailabilityResult, EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';
import { PerEntityObj, World } from '../src/core/world';
import { UNITS } from '../src/data/Defs';
import { ScenarioBuilder, clearScenario, resolveDefBinding } from '../src/game/Scenarios';
import { AbilityService } from '../src/sim/Abilities';
import { ProductionCatalog, ProductionService } from '../src/sim/Production';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/** Content key -> the army that fields it. The four rows this file is about. */
const COMMANDERS: ReadonlyArray<readonly [string, Faction, AbilityId]> = [
  ['fieldMarshal', Faction.Allies, AbilityId.ChronoRally],
  ['commissar', Faction.Soviets, AbilityId.IronWill],
  ['mrdHierarch', Faction.Meridian, AbilityId.PrismFocus],
  ['rclBaron', Faction.Reclaim, AbilityId.SalvageCall],
];

const SCRATCH: AvailabilityResult = { ok: false, reason: '', capped: false };

let simTick = 0;
beforeEach(() => { simTick = 0; clearScenario(); });

async function boundCatalog(): Promise<ProductionCatalog> {
  const catalog = new ProductionCatalog(await resolveDefBinding());
  expect(
    catalog.bound,
    'the def tables must bind or `maxAlive` is 0 everywhere and this file tests nothing',
  ).toBe(true);
  return catalog;
}

interface Rig {
  world: World;
  channels: Channels;
  service: ProductionService;
}

async function makeRig(faction: Faction): Promise<Rig> {
  const world = new World();
  world.addPlayer(faction, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const service = new ProductionService(world, channels, await boundCatalog());
  return { world, channels, service };
}

function step(rig: Rig, steps = 1): void {
  const rng = new Rng(11);
  for (let i = 0; i < steps; i++) {
    simTick++;
    rig.world.tick = simTick;
    rig.world.time = simTick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: simTick, time: rig.world.time, rng };
    rig.service.tick(s);
    rig.world.spatial.rebuild();
  }
}

/** Why `key` is unavailable, or '' when it IS available. */
function refusal(rig: Rig, key: string): string {
  const entry = rig.service.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  const r = rig.service.availabilityOf(0 as PlayerId, entry!, SCRATCH);
  return r.ok ? '' : r.reason;
}

/** Stand a finished commander on the field, the way production would. */
function spawnCommander(rig: Rig, key: string, x = 100, z = 100): EntityId {
  const entry = rig.service.catalog.byKey(key)!;
  const p = rig.world.player(0 as PlayerId);
  return rig.service.spawnUnit(p, entry, x, z, 0);
}

/* ==========================================================================
 * 1. THE CONTENT
 * ========================================================================== */

describe('the commander defs', () => {
  it('caps exactly four units at one alive, and nothing else at all', () => {
    const capped = UNITS.filter((u) => u.maxAlive > 0).map((u) => u.key).sort();
    expect(capped).toEqual(COMMANDERS.map(([k]) => k).sort());
    for (const u of UNITS) {
      if (u.maxAlive === 0) continue;
      expect(u.maxAlive, `${u.key} is capped at something other than one`).toBe(1);
    }
  });

  it('gives each army a DIFFERENT ability, and every other unit none', () => {
    const seen = new Set<number>();
    for (const [key, faction, ability] of COMMANDERS) {
      const def = UNITS.find((u) => u.key === key);
      expect(def, `no def for "${key}"`).toBeDefined();
      expect(def!.faction, `${key} belongs to the wrong army`).toBe(faction);
      expect(def!.ability, `${key} carries the wrong ability`).toBe(ability);
      expect(seen.has(ability), `${key} shares an ability with another army`).toBe(false);
      seen.add(ability);
    }
    const withAbility = UNITS.filter((u) => u.ability !== AbilityId.None).map((u) => u.key).sort();
    expect(withAbility).toEqual(COMMANDERS.map(([k]) => k).sort());
  });

  it('names an ability that ABILITIES actually defines', () => {
    // The failure this catches: a typo makes `ability` a number that indexes
    // nothing, `ABILITIES[n]` is undefined, and the HUD renders a nameless
    // button rather than throwing.
    for (const [key, , ability] of COMMANDERS) {
      const spec = ABILITIES[ability];
      expect(spec, `${key} names ability ${ability}, which has no row`).toBeDefined();
      expect(spec.label.length, `ability ${ability} has no label`).toBeGreaterThan(0);
      expect(spec.hint.length, `ability ${ability} has no hint`).toBeGreaterThan(0);
      expect(spec.radius).toBeGreaterThan(0);
      expect(spec.cooldownSeconds).toBeGreaterThan(0);
    }
  });

  it('carries maxAlive out of the def table and into the catalog', async () => {
    // LINK 2 of the chain in this file's header, and the one with no symptom:
    // `resolveEntry` had no such field before this feature, so a regression
    // here reads as "the cap does nothing" and nothing logs.
    const catalog = await boundCatalog();
    for (const [key] of COMMANDERS) {
      const entry = catalog.byKey(key);
      expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
      expect(entry!.maxAlive, `${key} lost its cap between the def and the catalog`).toBe(1);
    }
    expect(catalog.byKey('gi')!.maxAlive).toBe(0);
  });
});

/* ==========================================================================
 * 2. THE CAP
 * ========================================================================== */

describe('one commander at a time', () => {
  it('offers the commander when the tech is there and none is alive', async () => {
    const rig = await makeRig(Faction.Allies);
    buildBase(rig, ['conyard', 'powerPlant', 'refinery', 'barracks', 'radar']);
    step(rig, 2);
    expect(refusal(rig, 'fieldMarshal')).toBe('');
  });

  it('refuses a second one while the first is alive', async () => {
    const rig = await makeRig(Faction.Allies);
    buildBase(rig, ['conyard', 'powerPlant', 'refinery', 'barracks', 'radar']);
    step(rig, 2);

    spawnCommander(rig, 'fieldMarshal');
    step(rig, 1);

    // The wording matters: a player who is refused has to be told they already
    // own one, not that they are missing a prerequisite they in fact have.
    expect(refusal(rig, 'fieldMarshal')).toBe('You already have a Field Marshal');
  });

  it('refuses a second one while the first is still ON THE LINE', async () => {
    // The queued half of the cap. Without it, `availabilityOf` says yes five
    // times before the first commander ever exists.
    const rig = await makeRig(Faction.Allies);
    buildBase(rig, ['conyard', 'powerPlant', 'refinery', 'barracks', 'radar']);
    step(rig, 2);

    const entry = rig.service.catalog.byKey('fieldMarshal')!;
    rig.service.enqueue(0 as PlayerId, entry.publicId, 1, false);
    step(rig, 1);

    const p = rig.world.player(0 as PlayerId);
    expect(
      rig.service.queues.countOf(p, entry.tab, entry.publicId, false),
      'the first one did not make it onto the line, so the next assertion proves nothing',
    ).toBe(1);
    expect(refusal(rig, 'fieldMarshal')).toBe('You already have a Field Marshal');
  });

  it('clamps a shift-click that asks for five', async () => {
    // `availabilityOf` answers "you may have ONE more", never "five more", so
    // the count has to be clamped at the enqueue as well as gated before it.
    const rig = await makeRig(Faction.Allies);
    buildBase(rig, ['conyard', 'powerPlant', 'refinery', 'barracks', 'radar']);
    step(rig, 2);

    const entry = rig.service.catalog.byKey('fieldMarshal')!;
    rig.service.enqueue(0 as PlayerId, entry.publicId, 5, false);
    step(rig, 1);

    const p = rig.world.player(0 as PlayerId);
    expect(rig.service.queues.countOf(p, entry.tab, entry.publicId, false)).toBe(1);
  });

  it('frees the slot the moment the commander dies', async () => {
    const rig = await makeRig(Faction.Allies);
    buildBase(rig, ['conyard', 'powerPlant', 'refinery', 'barracks', 'radar']);
    step(rig, 2);

    const id = spawnCommander(rig, 'fieldMarshal');
    step(rig, 1);
    expect(refusal(rig, 'fieldMarshal')).not.toBe('');

    rig.world.store.markDead(id);
    rig.world.store.flushDestroyed();
    step(rig, 1);

    expect(
      refusal(rig, 'fieldMarshal'),
      'the whole design is that you get another one — the census did not notice the death',
    ).toBe('');
  });

  it('caps each player separately, so an AI cannot field a squad of them', async () => {
    // The bug this exists for is specific and was live in the first draft: the
    // census bucketed by def id ONLY, so it described whichever player was
    // asked about last. The human's cap worked and every AI's did not.
    const world = new World();
    world.addPlayer(Faction.Allies, 'Human', true, true);
    world.addPlayer(Faction.Allies, 'AI', false, false);
    const rig: Rig = {
      world,
      channels: new Channels(),
      service: new ProductionService(world, new Channels(), await boundCatalog()),
    };
    buildBase(rig, ['conyard', 'powerPlant', 'refinery', 'barracks', 'radar']);
    step(rig, 2);

    spawnCommander(rig, 'fieldMarshal');
    step(rig, 1);

    const entry = rig.service.catalog.byKey('fieldMarshal')!;
    expect(rig.service.aliveOf(0 as PlayerId, entry.defId)).toBe(1);
    expect(
      rig.service.aliveOf(1 as PlayerId, entry.defId),
      'player 1 owns no commander and must not be charged for player 0’s',
    ).toBe(0);
  });
});

/** Stand a finished, powered base up for player 0. */
function buildBase(rig: Rig, keys: readonly string[]): void {
  const p = rig.world.player(0 as PlayerId);
  let cx = 20;
  for (const key of keys) {
    const entry = rig.service.catalog.byKey(key)!;
    rig.service.spawnBuilding(p, entry, cx, 20, 1);
    cx += 8;
  }
}

/* ==========================================================================
 * 3. THE ABILITIES
 * ========================================================================== */

interface AbilityRig extends Rig {
  service: ProductionService;
  abilities: AbilityService;
}

async function makeAbilityRig(faction: Faction): Promise<AbilityRig> {
  const base = await makeRig(faction);
  const abilities = new AbilityService(base.world, base.channels);
  abilities.bindTables((await resolveDefBinding()).tables?.units ?? null);
  return { ...base, abilities };
}

function abilityStep(rig: AbilityRig, steps = 1): void {
  const rng = new Rng(13);
  for (let i = 0; i < steps; i++) {
    simTick++;
    rig.world.tick = simTick;
    rig.world.time = simTick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: simTick, time: rig.world.time, rng };
    rig.abilities.tick(s);
    rig.world.spatial.rebuild();
  }
}

/** A plain friendly rifleman at (x, z), owned by player 0. */
function spawnFriendly(rig: AbilityRig, key: string, x: number, z: number): EntityId {
  const entry = rig.service.catalog.byKey(key)!;
  return rig.service.spawnUnit(rig.world.player(0 as PlayerId), entry, x, z, 0);
}

describe('AbilityService', () => {
  it('reports the ability and readiness of a commander, and nothing for a rifleman', async () => {
    const rig = await makeAbilityRig(Faction.Allies);
    const hero = spawnCommander(rig, 'fieldMarshal', 100, 100);
    const gi = spawnFriendly(rig, 'gi', 110, 100);
    rig.world.spatial.rebuild();

    expect(rig.abilities.abilityOf(hero)).toBe(AbilityId.ChronoRally);
    expect(rig.abilities.isReady(hero)).toBe(true);
    expect(rig.abilities.abilityOf(gi)).toBe(AbilityId.None);
    expect(rig.abilities.isReady(gi), 'a unit with no ability is never "ready"').toBe(false);
  });

  it('starts the cooldown on use and refuses a second use until it expires', async () => {
    const rig = await makeAbilityRig(Faction.Allies);
    const hero = spawnCommander(rig, 'fieldMarshal', 100, 100);
    rig.world.spatial.rebuild();

    expect(rig.abilities.fireAt(hero)).toBe(true);
    const spec = ABILITIES[AbilityId.ChronoRally];
    expect(rig.abilities.cooldownSecondsOf(hero)).toBeGreaterThan(spec.cooldownSeconds - 1);
    expect(rig.abilities.isReady(hero)).toBe(false);
    expect(rig.abilities.fireAt(hero), 'fired twice with no wait').toBe(false);
    expect(rig.abilities.stats.refusedCooling).toBe(1);

    // Run it out. Ticks, not seconds — the service counts in integers and this
    // asserts the conversion agrees in both directions.
    abilityStep(rig, Math.ceil(spec.cooldownSeconds / SIM_DT) + 1);
    expect(rig.abilities.cooldownSecondsOf(hero)).toBe(0);
    expect(rig.abilities.isReady(hero)).toBe(true);
  });

  it('consumes an OrderKind.UseAbility and clears it the same tick', async () => {
    const rig = await makeAbilityRig(Faction.Allies);
    const hero = spawnCommander(rig, 'fieldMarshal', 100, 100);
    rig.world.spatial.rebuild();
    const i = rig.world.store.index(hero);
    rig.world.store.orderKind[i] = OrderKind.UseAbility;

    abilityStep(rig, 1);

    expect(
      rig.world.store.orderKind[i],
      'a standing UseAbility would re-fire the instant the cooldown expired',
    ).toBe(OrderKind.None);
    expect(rig.abilities.stats.fired[AbilityId.ChronoRally]).toBe(1);
  });

  it('ALLIES — Chrono Rally pulls friendlies in and syncs their prev position', async () => {
    const rig = await makeAbilityRig(Faction.Allies);
    const hero = spawnCommander(rig, 'fieldMarshal', 100, 100);
    const far = spawnFriendly(rig, 'gi', 120, 100);
    rig.world.spatial.rebuild();

    const st = rig.world.store;
    const j = st.index(far);
    const before = Math.hypot(st.posX[j] - 100, st.posZ[j] - 100);
    expect(before).toBeGreaterThan(15);

    expect(rig.abilities.fireAt(hero)).toBe(true);

    const after = Math.hypot(st.posX[j] - 100, st.posZ[j] - 100);
    expect(after, 'the rifleman was not recalled').toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(ABILITY_FX.chronoSpacing * 3);
    // prev* MUST follow, or the renderer interpolates across the map for one
    // frame and draws a streak through everything in between.
    expect(st.prevX[j]).toBe(st.posX[j]);
    expect(st.prevZ[j]).toBe(st.posZ[j]);
    expect(st.state[j]).toBe(UnitState.Idle);
    expect(rig.abilities.stats.unitsRecalled).toBe(1);
  });

  it('ALLIES — Chrono Rally does not recall a ground unit into water', async () => {
    const rig = await makeAbilityRig(Faction.Allies);
    const hero = spawnCommander(rig, 'fieldMarshal', 100, 100);
    // Fill the first dry ring so `far` is offered ring two, whose first slot
    // is across the cell-aligned shoreline below.
    for (let i = 0; i < 6; i++) spawnFriendly(rig, 'gi', 108 + i, 100);
    const far = spawnFriendly(rig, 'gi', 120, 100);
    rig.world.spatial.rebuild();

    const base = rig.world.terrain;
    rig.world.terrain = {
      heightAt: (x: number, z: number) => base.heightAt(x, z),
      normalAt: base.normalAt.bind(base),
      slopeAt: base.slopeAt.bind(base),
      isPassable: (_cx: number, cz: number) => cz * CELL < 104,
      isBuildable: base.isBuildable.bind(base),
      isOccupied: base.isOccupied.bind(base),
      markOccupied: base.markOccupied.bind(base),
      clearOccupied: base.clearOccupied.bind(base),
      occupancyVersion: base.occupancyVersion.bind(base),
      isWater: (_cx: number, cz: number) => cz * CELL >= 104,
      raycastGround: base.raycastGround.bind(base),
    } as ITerrain;

    const st = rig.world.store;
    const j = st.index(far);
    expect(rig.abilities.fireAt(hero)).toBe(true);

    expect(st.posX[j], 'Chrono Rally moved the rifleman into water').toBe(120);
    expect(st.posZ[j], 'Chrono Rally moved the rifleman into water').toBe(100);
    expect(rig.abilities.stats.unitsRecalled).toBe(6);
  });

  it('SOVIETS — Iron Will makes friendlies untouchable, then gives their hp back', async () => {
    const rig = await makeAbilityRig(Faction.Soviets);
    const hero = spawnCommander(rig, 'commissar', 100, 100);
    const ally = spawnFriendly(rig, 'conscript', 104, 100);
    rig.world.spatial.rebuild();

    const st = rig.world.store;
    const j = st.index(ally);
    const maxHp = st.maxHp[j];
    st.hp[j] = maxHp * 0.5;
    const wounded = st.hp[j];

    expect(rig.abilities.fireAt(hero)).toBe(true);
    expect(st.maxHp[j], 'not protected').toBeGreaterThan(maxHp * 100);
    expect(rig.abilities.stats.unitsProtected).toBeGreaterThan(0);

    abilityStep(rig, Math.ceil(ABILITY_FX.ironWillSeconds / SIM_DT) + 2);

    expect(st.maxHp[j]).toBeCloseTo(maxHp, 3);
    // Invulnerability, NOT a heal: it comes back at the hp it went in with.
    expect(st.hp[j]).toBeCloseTo(wounded, 3);
  });

  it('MERIDIAN — Prism Focus queues one splash record aimed at the commander', async () => {
    const rig = await makeAbilityRig(Faction.Meridian);
    const hero = spawnCommander(rig, 'mrdHierarch', 100, 100);
    rig.world.spatial.rebuild();

    rig.channels.damage.count = 0;
    expect(rig.abilities.fireAt(hero)).toBe(true);

    const dmg = rig.channels.damage;
    expect(dmg.count, 'exactly one record — N records would re-resolve the circle N times').toBe(1);
    expect(dmg.amount[0]).toBe(ABILITY_FX.prismDamage);
    expect(dmg.splashRadius[0]).toBe(ABILITIES[AbilityId.PrismFocus].radius);
    expect(dmg.x[0]).toBeCloseTo(100, 3);
    expect(dmg.z[0]).toBeCloseTo(100, 3);
    // Attributed to the commander, so the kill and the bounty land on the
    // right player rather than on nobody.
    expect(dmg.attacker[0]).toBe(hero as number);
  });

  it('RECLAMATION — Salvage Call eats wrecks and patches the wounded', async () => {
    const rig = await makeAbilityRig(Faction.Reclaim);
    const hero = spawnCommander(rig, 'rclBaron', 100, 100);
    const ally = spawnFriendly(rig, 'rclPicker', 104, 100);
    const st = rig.world.store;

    // A wreck in reach. `alloc` is what `Damage.ts` uses to leave one behind.
    const wreck = st.alloc(EntityKind.Wreck, -1, 0 as PlayerId, Faction.Reclaim, 106, 0, 100, 0);
    expect(wreck).not.toBe(0);
    rig.world.spatial.rebuild();

    const j = st.index(ally);
    st.hp[j] = st.maxHp[j] * 0.4;
    const before = st.hp[j];

    expect(rig.abilities.fireAt(hero)).toBe(true);

    expect(rig.abilities.stats.wrecksSalvaged).toBe(1);
    expect(rig.abilities.stats.creditsSalvaged).toBe(ABILITY_FX.salvagePerWreck);
    expect(
      (st.flags[st.index(wreck)] & EntityFlag.PendingDestroy) !== 0,
      'the wreck was cashed in but is still standing',
    ).toBe(true);
    expect(st.hp[j], 'the wounded ally was not patched').toBeGreaterThan(before);
    expect(st.hp[j]).toBeLessThanOrEqual(st.maxHp[j]);
  });

  it('refuses a unit that has no ability rather than firing a blank one', async () => {
    const rig = await makeAbilityRig(Faction.Allies);
    const gi = spawnFriendly(rig, 'gi', 100, 100);
    rig.world.spatial.rebuild();
    expect(rig.abilities.fireAt(gi)).toBe(false);
    expect(rig.abilities.stats.refusedNoAbility).toBe(1);
  });

  it('gives a rebuilt commander a FRESH cooldown, not the dead one’s', async () => {
    // The generation-stamped side array earning its keep: a hero dies with 50
    // seconds left and the replacement lands in the recycled slot. Reading the
    // raw array would hand the new one the old one's cooldown.
    const rig = await makeAbilityRig(Faction.Allies);
    const first = spawnCommander(rig, 'fieldMarshal', 100, 100);
    rig.world.spatial.rebuild();
    expect(rig.abilities.fireAt(first)).toBe(true);
    expect(rig.abilities.cooldownSecondsOf(first)).toBeGreaterThan(1);

    rig.world.store.markDead(first);
    rig.world.store.flushDestroyed();

    const second = spawnCommander(rig, 'fieldMarshal', 100, 100);
    rig.world.spatial.rebuild();
    expect(rig.abilities.cooldownSecondsOf(second)).toBe(0);
    expect(rig.abilities.isReady(second)).toBe(true);
  });
});

/* ==========================================================================
 * 4. THE FALLBACK ROW
 * ========================================================================== */

describe('the commanders can actually leave the barracks', () => {
  it('has a FALLBACK_UNITS row for every commander', async () => {
    // `ProductionService.spawnUnit` returns NONE when the fallback row is
    // missing, BEFORE it looks at the def table. A commander with a perfect def
    // and no fallback row builds, charges the player, reaches 100% and then
    // never comes out — silently, forever.
    const rig = await makeRig(Faction.Allies);
    for (const [key, faction] of COMMANDERS) {
      const world = new World();
      world.addPlayer(faction, 'Commander', true, true);
      const service = new ProductionService(world, new Channels(), rig.service.catalog);
      const entry = service.catalog.byKey(key)!;
      const id = service.spawnUnit(world.player(0 as PlayerId), entry, 100, 100, 0);
      expect(id, `${key} has no FALLBACK_UNITS row and can never be produced`).not.toBe(0);
      expect(world.store.kind[world.store.index(id)]).toBe(EntityKind.Infantry);
    }
  });

  it('is produced by its army’s barracks', async () => {
    // Otherwise the cameo appears in a tab the player has no building for.
    const binding = await resolveDefBinding();
    const buildings = binding.tables?.buildings ?? [];
    for (const [key] of COMMANDERS) {
      const factory = buildings.find((b) => b.produces.includes(key));
      expect(factory, `${key} is buildable by nothing`).toBeDefined();
      const def = UNITS.find((u) => u.key === key)!;
      expect(def.prereqs, key).toContain(factory!.key);
    }
  });
});

/* ==========================================================================
 * 5. THE SCENARIO SEAM
 * ========================================================================== */

describe('scenarios can ask for "commander" and get the right army’s', () => {
  it('resolves per faction rather than handing everyone the Allied one', async () => {
    // `keyFor` is what turns a layout's generic key into the asking army's own.
    // Without a `commander` row in FACTION_KEY_MAP it returns the key unchanged
    // and every army gets nothing, because "commander" is not a def.
    const binding = await resolveDefBinding();
    for (const [key, faction] of COMMANDERS) {
      const world = new World();
      world.addPlayer(faction, 'Commander', true, true);
      const builder = new ScenarioBuilder(
        world, binding, new PerEntityObj<string>(world.store), 5, 'temperate',
      );
      expect(builder.keyFor(0 as PlayerId, 'commander'), `${faction}`).toBe(key);
    }
  });
});
