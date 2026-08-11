/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/superweapons.spec.ts — THE PART THAT WAS MISSING
 * ============================================================================
 * `src/sim/Superweapons.ts` shipped complete and tested — charge timers,
 * faction ownership, a warned nuke, true invulnerability, a two-click
 * chronoshift, area denial — and NONE OF IT WAS REACHABLE IN PLAY. The service
 * charges a weapon only while its owner holds a finished, powered structure
 * whose content key it names, and no such key existed anywhere in the game.
 * There was nothing to build, so nothing ever charged, so nothing ever fired
 * except by typing into the developer console.
 *
 * `tests/features.spec.ts` was green throughout, because its fixtures built a
 * `battleLab` — the fallback the service carried precisely BECAUSE the real
 * structures were missing. Every case passed against a stand-in, which is the
 * exact shape of a test suite that proves nothing about the shipped game.
 *
 * So this file asserts the three things that were absent, and it deliberately
 * builds its catalog from `resolveDefBinding()` rather than an empty binding:
 * with `EMPTY_BINDING` the def table is never consulted and half of what is
 * below would pass by testing the fallback tables against themselves.
 *
 *   1. THE CONTENT EXISTS AND IS REACHABLE. Every army has a superweapon
 *      structure; it is in the catalog the sidebar reads; its prereq chain is
 *      real; it has a `FALLBACK_BUILDINGS` row (without one it builds, charges,
 *      completes and then never places, with nothing logged); and it has art.
 *   2. THE COUNTDOWN RUNS OFF IT, and off nothing else. A Battle Lab arms
 *      nothing now. Losing power stops the clock.
 *   3. FIRING GOES THROUGH THE BUS. `issueFire` puts an ordinary
 *      `CommandKind.Order` on `channels.commands`; `input/Commands.ts` applies
 *      it having refused anything the issuer does not own; the sim reads it
 *      back a phase later. Nothing about a superweapon reaches the simulation
 *      off a click handler — see the comment on `CommandKind.Relocate`.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  CommandKind, EntityFlag, EntityKind, Faction, NONE, OrderKind,
} from '../src/core/types';
import type { Command, EntityId, PlayerId, SimContext } from '../src/core/types';
import { HUD_SUPERWEAPON, SIM_DT } from '../src/core/config';

import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { OrderExecutor } from '../src/input/Commands';
import { PowerGrid } from '../src/sim/Power';
import {
  SUPERWEAPONS, SUPERWEAPON_COUNT, SuperweaponService,
} from '../src/sim/Superweapons';
import { resolveDefBinding } from '../src/game/Scenarios';
import { BUILDINGS, DEF_TABLES } from '../src/data/Defs';
import { CAMEO_BUILDING_MODELS } from '../src/ui/Cameos';

const ME = 0 as PlayerId;
const THEM = 1 as PlayerId;
const ROOT = join(__dirname, '..');

/** The army that fields each weapon, and the generator that lights its base. */
const GENERATOR: Readonly<Partial<Record<Faction, string>>> = {
  [Faction.Meridian]: 'mrdSolarArray',
  [Faction.Reclaim]: 'rclFurnace',
};

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  supers: SuperweaponService;
  orders: OrderExecutor;
  power: PowerGrid;
  rng: Rng;
  tick: number;
  /** One whole tick in phase order: Command, then Production. */
  step(steps?: number): void;
  building(key: string, owner: PlayerId, cx: number, cz: number): EntityId;
  unit(key: string, owner: PlayerId, x: number, z: number): EntityId;
}

async function makeRig(mine = Faction.Soviets, theirs = Faction.Allies): Promise<Rig> {
  const world = new World();
  world.addPlayer(mine, 'Commander', true, true);
  world.addPlayer(theirs, 'Opponent', false, false);

  const channels = new Channels();
  const catalog = new ProductionCatalog(await resolveDefBinding());
  // See the header: an unbound catalog makes most of this file vacuous.
  expect(catalog.bound, 'unbound catalog — nothing here would be exercised').toBe(true);

  const production = new ProductionService(world, channels, catalog);
  setProduction(production);
  const supers = new SuperweaponService(world, channels);

  const rig: Rig = {
    world, channels, production, supers,
    orders: new OrderExecutor(world, channels),
    power: new PowerGrid(world, channels),
    rng: new Rng(97), tick: 0,

    step(steps = 1): void {
      for (let i = 0; i < steps; i++) {
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        world.spatial.rebuild();
        // Phase.Command — the order lands on the structure here.
        rig.orders.tick();
        rig.power.simTick(world.time);
        // Phase.Production — and the service reads it back here.
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng: rig.rng };
        rig.supers.simTick(s);
      }
    },

    building(key, owner, cx, cz): EntityId {
      const entry = rig.production.catalog.byKey(key) as BuildEntry;
      expect(entry, `catalog is missing "${key}"`).not.toBeNull();
      const id = rig.production.spawnBuilding(world.players[owner as number], entry, cx, cz, 1);
      expect(id, `spawnBuilding refused "${key}"`).not.toBe(NONE);
      world.spatial.rebuild();
      return id;
    },

    unit(key, owner, x, z): EntityId {
      const entry = rig.production.catalog.byKey(key) as BuildEntry;
      expect(entry, `catalog is missing "${key}"`).not.toBeNull();
      return rig.production.spawnUnit(world.players[owner as number], entry, x, z, 0);
    },
  };
  return rig;
}

/**
 * Ticks to run before asking a question about availability.
 *
 * `Superweapons.rescanAvailability` runs on `tick % AVAILABILITY_INTERVAL`,
 * which is 15 — twice a second — and `PowerGrid` recomputes every 5. Anything
 * shorter than a full rescan asks the question before the service has looked,
 * and every case below would fail for a reason that has nothing to do with
 * what it is testing.
 */
const SETTLE = 20;

/** Enough generation to light a 150-power superweapon for one player. */
function powerUp(rig: Rig, owner: PlayerId, cx = 4): void {
  const p = rig.world.player(owner);
  const key = GENERATOR[p.faction] ?? 'powerPlant';
  // Four plants: the superweapon alone draws 150 and nothing else is standing.
  for (let i = 0; i < 4; i++) rig.building(key, owner, cx + i * 3, 2);
}

function isLit(rig: Rig, id: EntityId): boolean {
  const st = rig.world.store;
  const i = st.index(id);
  return (st.flags[i] & EntityFlag.NeedsPower) === 0 || (st.flags[i] & EntityFlag.Powered) !== 0;
}

/* ==========================================================================
 * 1. THE CONTENT EXISTS AND IS REACHABLE
 * ========================================================================== */

/** Every superweapon, its gating structure key and the army that fields it. */
const WEAPONS: ReadonlyArray<readonly [string, string, Faction]> = [
  ['nuke', 'nuclearSilo', Faction.Soviets],
  ['ironCurtain', 'ironCurtain', Faction.Soviets],
  ['chronosphere', 'chronosphere', Faction.Allies],
  ['lightningStorm', 'weatherControl', Faction.Allies],
  ['solarLance', 'mrdHeliograph', Faction.Meridian],
  ['arcStorm', 'rclStormworks', Faction.Reclaim],
];

describe('every superweapon has a structure, and every army has a superweapon', () => {
  it('names a real building def for every weapon, owned by the same army', () => {
    for (const def of SUPERWEAPONS) {
      expect(def.structureKeys.length, `${def.key} gates on nothing`).toBeGreaterThan(0);
      for (const key of def.structureKeys) {
        const index = DEF_TABLES.buildingByKey.get(key);
        expect(index, `${def.key} gates on "${key}", which is not a building`).toBeDefined();
        const building = BUILDINGS[index as number];
        // A weapon whose structure belongs to another army can never charge,
        // because `rescanAvailability` filters the structure by its OWNER's
        // faction before it ever looks at the key.
        expect(building.faction, `${key} is not a ${def.faction} structure`).toBe(def.faction);
      }
    }
  });

  it('gives all four playable armies exactly the weapons the table says', () => {
    const byFaction = new Map<Faction, string[]>();
    for (const d of SUPERWEAPONS) {
      const list = byFaction.get(d.faction) ?? [];
      list.push(d.key);
      byFaction.set(d.faction, list);
    }
    for (const f of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      expect((byFaction.get(f) ?? []).length, `faction ${f} has no superweapon`)
        .toBeGreaterThan(0);
    }
    expect(SUPERWEAPONS.length).toBe(SUPERWEAPON_COUNT);
    expect(WEAPONS.length).toBe(SUPERWEAPON_COUNT);
  });

  it('puts every one of them in the catalog the sidebar reads', async () => {
    const rig = await makeRig();
    for (const [, structure, faction] of WEAPONS) {
      const entry = rig.production.catalog.byKey(structure);
      expect(entry, `no catalog entry for "${structure}"`).not.toBeNull();
      expect(entry!.faction, structure).toBe(faction);
      expect(entry!.buildable, structure).toBe(true);
      expect(entry!.cost, structure).toBeGreaterThan(0);
      // A structure with no def id draws its army's default model — the
      // silent failure `buildings.system.ts` calls out in its own header.
      expect(entry!.defId, `${structure} bound to no def`).toBeGreaterThanOrEqual(0);
    }
  });

  it('offers it in the roster of the army that owns it, and no other', async () => {
    for (const [, structure, faction] of WEAPONS) {
      const rig = await makeRig(faction);
      const roster = rig.production.catalog.roster(faction, 0 /* BuildTab.Structures */);
      expect(roster.some((e) => e.key === structure), `${structure} missing from its own roster`)
        .toBe(true);
      for (const other of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
        if (other === faction) continue;
        expect(
          rig.production.catalog.roster(other, 0).some((e) => e.key === structure),
          `${structure} is offered to faction ${other}`,
        ).toBe(false);
      }
    }
  });

  it('places every one of them — the missing-fallback-row failure', async () => {
    // A def with no `FALLBACK_BUILDINGS` row completes construction, takes the
    // credits, and then `spawnBuilding` returns NONE before it ever looks at
    // the def. Nothing is logged. `rig.building` asserts on NONE.
    for (const [, structure, faction] of WEAPONS) {
      const rig = await makeRig(faction);
      powerUp(rig, ME);
      const id = rig.building(structure, ME, 30, 30);
      rig.step(SETTLE);
      expect(isLit(rig, id), `${structure} came up dark with four plants standing`).toBe(true);
    }
  });

  it('has a model bound for every one of them', () => {
    // Without a row here the cameo grid draws a flat glyph and the world draws
    // the army's default structure — two silent wrong pictures.
    for (const [, structure] of WEAPONS) {
      expect(CAMEO_BUILDING_MODELS[structure], `${structure} has no cameo model`).toBeDefined();
    }
  });
});

/* ==========================================================================
 * 2. THE COUNTDOWN RUNS OFF THE STRUCTURE
 * ========================================================================== */

describe('the countdown', () => {
  it('starts at nothing and runs only once the structure is up', async () => {
    const rig = await makeRig(Faction.Soviets);
    powerUp(rig, ME);
    rig.supers.rescanAvailability();
    expect(rig.supers.remainingFor(ME, 'nuke')).toBe(-1);

    rig.building('nuclearSilo', ME, 30, 30);
    rig.step(SETTLE);
    const t0 = rig.supers.remainingFor(ME, 'nuke');
    expect(t0).toBeGreaterThan(0);
    rig.step(30);
    expect(rig.supers.remainingFor(ME, 'nuke')).toBeLessThan(t0);
  });

  it('stops dead in a blackout and does not reset', async () => {
    // The real cost of the building is its -150 draw. A base that loses its
    // generation loses the clock, which is what makes bombing the power plants
    // a live answer to a silo.
    const rig = await makeRig(Faction.Soviets);
    powerUp(rig, ME);
    const silo = rig.building('nuclearSilo', ME, 30, 30);
    rig.step(SETTLE);
    const lit = rig.supers.remainingFor(ME, 'nuke');
    expect(lit).toBeGreaterThan(0);

    const st = rig.world.store;
    const list = st.byKind[EntityKind.Building];
    for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
      const i = list[a];
      if (st.powerDraw[i] > 0) { st.hp[i] = 0; st.flags[i] |= EntityFlag.PendingDestroy; }
    }
    rig.step(40);
    expect(isLit(rig, silo), 'the silo stayed lit with no generation').toBe(false);
    // Unavailable, and the charge it had banked is still banked.
    expect(rig.supers.remainingFor(ME, 'nuke')).toBe(-1);

    powerUp(rig, ME, 40);
    rig.step(SETTLE);
    expect(rig.supers.remainingFor(ME, 'nuke')).toBeLessThanOrEqual(lit);
    expect(rig.supers.remainingFor(ME, 'nuke')).toBeGreaterThan(0);
  });

  it('takes a partial charge back from a save, clamped to this build\'s own', async () => {
    // `SaveGame.ts` has written the seconds into every file it has ever
    // produced and duck-typed `SuperweaponChargeSetter` waiting for this
    // method. Without it a silo forty seconds from launch reloaded at three
    // hundred — a snapshot restoring a number other than the one that was there.
    const rig = await makeRig(Faction.Soviets);
    powerUp(rig, ME);
    rig.building('nuclearSilo', ME, 30, 30);
    rig.step(SETTLE);
    expect(rig.supers.remainingFor(ME, 'nuke')).toBeGreaterThan(0);
    const full = SUPERWEAPONS[rig.supers.indexOf('nuke')].chargeSeconds;

    expect(rig.supers.setRemaining(ME, 'nuke', 44.5)).toBe(true);
    expect(rig.supers.remainingFor(ME, 'nuke')).toBeCloseTo(44.5, 4);

    expect(rig.supers.setRemaining(ME, 'nuke', 0)).toBe(true);
    expect(rig.supers.isReady(ME, 'nuke')).toBe(true);

    // Over-full and under-zero are clamped; a stranger key and a bad slot are
    // refused rather than silently landing on a neighbour.
    expect(rig.supers.setRemaining(ME, 'nuke', 1e6)).toBe(true);
    expect(rig.supers.remainingFor(ME, 'nuke')).toBeLessThanOrEqual(full);
    expect(rig.supers.setRemaining(ME, 'nuke', -5)).toBe(true);
    expect(rig.supers.isReady(ME, 'nuke')).toBe(true);
    expect(rig.supers.setRemaining(ME, 'timeStop', 10)).toBe(false);
    expect(rig.supers.setRemaining(ME, 'nuke', Number.NaN)).toBe(false);

    // Availability is NOT written: it is re-derived from the standing
    // structures, so a save can never hand out a weapon whose silo is rubble.
    expect(rig.supers.remainingFor(THEM, 'nuke')).toBe(-1);
    expect(rig.supers.setRemaining(THEM, 'nuke', 0)).toBe(true);
    expect(rig.supers.remainingFor(THEM, 'nuke'), 'a save granted availability').toBe(-1);
  });

  it('is pushed to the HUD by key, and retired when the structure falls', async () => {
    // `Superweapons.pushHud` duck-types `globalThis.__vmHud`. The HUD's own
    // `setSuperweapon` / `clearSuperweapon` are the countdown's only route to
    // the screen, so a rename on either side is silent without this.
    const seen = new Map<string, number>();
    const cleared: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmHud = {
      setSuperweapon: (id: string, _label: string, remaining: number) => {
        seen.set(id, remaining);
      },
      clearSuperweapon: (id: string) => { cleared.push(id); },
    };
    try {
      const rig = await makeRig(Faction.Soviets);
      powerUp(rig, ME);
      const silo = rig.building('nuclearSilo', ME, 30, 30);
      rig.step(SETTLE);

      expect(seen.has('nuke'), 'the HUD was never told about the nuke').toBe(true);
      expect(seen.get('nuke')).toBeGreaterThan(0);
      // Only what this army can field. The Chronosphere is Allied.
      expect(cleared).toContain('chronosphere');

      cleared.length = 0;
      rig.world.store.markDead(silo);
      rig.world.store.flushDestroyed();
      rig.step(SETTLE);
      expect(cleared).toContain('nuke');
    } finally {
      delete g.__vmHud;
    }
  });
});

/* ==========================================================================
 * 3. FIRING GOES THROUGH THE BUS
 * ========================================================================== */

describe('firing is an ordinary command, not a service call', () => {
  let rig: Rig;
  let silo: EntityId;

  beforeEach(async () => {
    rig = await makeRig(Faction.Soviets);
    powerUp(rig, ME);
    silo = rig.building('nuclearSilo', ME, 30, 30);
    rig.step(SETTLE);
    rig.supers.grantReady(ME, 'nuke');
  });

  it('puts a real Order on the bus, addressed to the silo', () => {
    const drained: Command[] = [];
    expect(rig.supers.issueFire(ME, 'nuke', 200, 200)).toBe(true);
    rig.channels.commands.drain((c) => {
      drained.push({ ...c, entities: Int32Array.from(c.entities.subarray(0, c.entityCount)) });
    });

    expect(drained.length, 'nothing reached the bus').toBe(1);
    const cmd = drained[0];
    expect(cmd.kind).toBe(CommandKind.Order);
    expect(cmd.order).toBe(OrderKind.UseAbility);
    expect(cmd.player).toBe(ME);
    expect(cmd.entityCount).toBe(1);
    expect(cmd.entities[0]).toBe(silo as number);
    expect(cmd.x).toBeCloseTo(200, 3);
    expect(cmd.z).toBeCloseTo(200, 3);
  });

  it('refuses to address a command it has no structure for', () => {
    // Nothing to aim: no Chronosphere, and this player is not Allied anyway.
    expect(rig.supers.issueFire(ME, 'chronosphere', 200, 200)).toBe(false);
    expect(rig.channels.commands.pending).toBe(0);
  });

  it('fires, end to end, from the command alone', () => {
    expect(rig.supers.isReady(ME, 'nuke')).toBe(true);
    rig.supers.issueFire(ME, 'nuke', 200, 200);

    // ONE tick of the real phase order does the whole thing: the order
    // executor writes it onto the silo at Phase.Command and the service reads
    // it back at Phase.Production.
    rig.step(1);
    expect(rig.supers.isReady(ME, 'nuke'), 'the charge was never spent').toBe(false);
    expect(rig.supers.stats.fired[0]).toBe(1);

    // And the warhead lands after its warning, not before.
    expect(rig.channels.damage.count).toBe(0);
    rig.step(Math.ceil(3.5 / SIM_DT) + 2);
    expect(rig.supers.stats.strikesResolved).toBe(1);
  });

  it('clears the order off the structure, fired or not', () => {
    const st = rig.world.store;
    rig.supers.issueFire(ME, 'nuke', 200, 200);
    rig.step(1);
    expect(st.orderKind[st.index(silo)]).toBe(OrderKind.None);

    // And again with the charge spent, which is the case that would re-fire
    // forever if the order were left standing.
    rig.supers.issueFire(ME, 'nuke', 260, 260);
    rig.step(1);
    expect(st.orderKind[st.index(silo)]).toBe(OrderKind.None);
    expect(rig.supers.stats.fired[0]).toBe(1);
  });

  it('ignores a fire order forged against a silo somebody else owns', () => {
    // The bus stamps identity and `input/Commands.ts#applyOrder` refuses an
    // entity the issuer does not own, so a spoofed slot does nothing. This is
    // the one authority check the whole feature relies on.
    rig.supers.grantReady(THEM, 'nuke');
    rig.channels.commands.issueOrder(
      THEM, OrderKind.UseAbility, Int32Array.of(silo as number), 1, 200, 200,
    );
    rig.step(SETTLE);
    expect(rig.supers.stats.fired[0]).toBe(0);
    expect(rig.world.store.orderKind[rig.world.store.index(silo)]).toBe(OrderKind.None);
  });

  it('stages then fires a two-click weapon over the bus, and moves the units', async () => {
    // THE BUG THIS EXISTS FOR, found by clicking the real button in a real
    // match: staging used to alternate on the service's own `stagedSw`, and
    // the cursor reset it in `cancelArm()`. The second click issued its
    // command and cancelled the arm in the same statement, so `stagedSw` was
    // cleared BEFORE the command reached `simTick` — and the Chronosphere
    // re-staged on its destination instead of firing. Every click looked like
    // a first click and the weapon could never be fired at all.
    const allies = await makeRig(Faction.Allies, Faction.Soviets);
    powerUp(allies, ME);
    allies.building('chronosphere', ME, 30, 30);
    allies.step(SETTLE);
    allies.supers.grantReady(ME, 'chronosphere');

    const tank = allies.unit('grizzly', ME, 300, 300);
    const st = allies.world.store;
    const i = st.index(tank);

    // Click one: the source. `stage` true.
    expect(allies.supers.issueFire(ME, 'chronosphere', 300, 300, true)).toBe(true);
    allies.step(1);
    expect(allies.supers.stats.unitsTeleported).toBe(0);
    expect(allies.supers.isReady(ME, 'chronosphere'), 'the source click spent the charge').toBe(true);

    // Click two: the destination. `stage` false — and this is the one that
    // used to re-stage instead of firing.
    expect(allies.supers.issueFire(ME, 'chronosphere', 380, 380, false)).toBe(true);
    allies.step(2);

    expect(allies.supers.stats.unitsTeleported).toBe(1);
    expect(Math.hypot(st.posX[i] - 380, st.posZ[i] - 380)).toBeLessThan(20);
    expect(allies.supers.isReady(ME, 'chronosphere')).toBe(false);
  });

  it('never fires a two-click weapon off an abandoned source', async () => {
    // The other half of the same rule. `cancelArm()` no longer clears the
    // staged point — it must not touch sim state — so the guard has to be that
    // a fresh SOURCE click always re-stages, whatever is left over.
    const allies = await makeRig(Faction.Allies, Faction.Soviets);
    powerUp(allies, ME);
    allies.building('chronosphere', ME, 30, 30);
    allies.step(SETTLE);
    allies.supers.grantReady(ME, 'chronosphere');

    allies.supers.issueFire(ME, 'chronosphere', 300, 300, true);
    allies.step(1);
    // ... the player presses Escape here, which is cursor-only ...
    allies.supers.cancelArm();
    // ... and starts again somewhere else entirely.
    allies.supers.issueFire(ME, 'chronosphere', 500, 500, true);
    allies.step(1);
    expect(allies.supers.stats.unitsTeleported, 'the abandoned source fired').toBe(0);
    expect(allies.supers.isReady(ME, 'chronosphere')).toBe(true);
  });

  it('does not fire off an order aimed at some other structure', () => {
    const plant = rig.building('powerPlant', ME, 34, 34);
    rig.channels.commands.issueOrder(
      ME, OrderKind.UseAbility, Int32Array.of(plant as number), 1, 200, 200,
    );
    rig.step(SETTLE);
    expect(rig.supers.stats.fired[0]).toBe(0);
  });
});

/* ==========================================================================
 * 4. THE TWO ARMIES THAT ARRIVED AFTER THE SERVICE DID
 * ========================================================================== */

describe('the Pact and the Reclamation have working buttons too', () => {
  it('runs the Solar Lance as a warned single strike', async () => {
    const rig = await makeRig(Faction.Meridian);
    powerUp(rig, ME);
    rig.building('mrdHeliograph', ME, 30, 30);
    rig.step(SETTLE);
    rig.supers.grantReady(ME, 'solarLance');

    rig.supers.issueFire(ME, 'solarLance', 220, 220);
    rig.step(1);
    expect(rig.supers.stats.fired[4]).toBe(1);
    // Warned: nothing lands on the tick it is fired.
    expect(rig.channels.damage.count).toBe(0);
    rig.step(Math.ceil(3.5 / SIM_DT) + 2);
    expect(rig.supers.stats.strikesResolved).toBe(1);
    expect(rig.channels.damage.count).toBe(1);
    // Its OWN radius, not the nuke's — the effect is shared, the numbers are not.
    expect(rig.channels.damage.splashRadius[0]).toBeCloseTo(24, 3);
  });

  it('runs the Arc Storm as scattered bolts', async () => {
    const rig = await makeRig(Faction.Reclaim);
    powerUp(rig, ME);
    rig.building('rclStormworks', ME, 30, 30);
    rig.step(SETTLE);
    rig.supers.grantReady(ME, 'arcStorm');

    rig.supers.issueFire(ME, 'arcStorm', 300, 300);
    rig.step(Math.ceil((1.2 + 9) / SIM_DT) + 4);
    expect(rig.supers.stats.fired[5]).toBe(1);
    expect(rig.supers.stats.boltsThrown).toBeGreaterThan(10);
  });

  it('gives neither army the other three armies superweapons', async () => {
    const rig = await makeRig(Faction.Meridian);
    powerUp(rig, ME);
    rig.building('mrdHeliograph', ME, 30, 30);
    rig.step(SETTLE);
    for (const key of ['nuke', 'ironCurtain', 'chronosphere', 'lightningStorm', 'arcStorm']) {
      expect(rig.supers.remainingFor(ME, key), key).toBe(-1);
    }
    expect(rig.supers.remainingFor(ME, 'solarLance')).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 5. THE HUD SEAM
 *
 * `src/ui/**` runs under `environment: 'node'` in this suite, so there is no
 * DOM to instantiate a `Hud` against. What CAN be checked without one is the
 * part that actually rots: three duck-typed names spelled in two files each,
 * and four numbers spelled in a stylesheet that cannot import a constant.
 * ========================================================================== */

describe('the HUD seam is spelled the same on both sides of it', () => {
  const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

  it('gives the HUD the two methods the service duck-types for the countdown', () => {
    // `Superweapons.hudSink()` returns null unless BOTH of these are functions
    // on `globalThis.__vmHud`, and it does it silently — a rename on either
    // side is a countdown that simply never appears.
    const hud = read('src/ui/Hud.ts');
    expect(hud).toMatch(
      /setSuperweapon\(id: string, label: string, remaining: number, total: number\)/);
    expect(hud).toMatch(/clearSuperweapon\(id: string\)/);
    const sim = read('src/sim/Superweapons.ts');
    expect(sim).toContain('setSuperweapon');
    expect(sim).toContain('clearSuperweapon');
  });

  it('publishes the three members the HUD reads back off __vmSuperweapons', () => {
    const sys = read('src/sim/features.system.ts');
    expect(sys).toContain('g.__vmSuperweapons');
    for (const member of ['arm:', 'cancelArm:', 'armedKey']) {
      expect(sys, `__vmSuperweapons is missing ${member}`).toContain(member);
    }
    expect(read('src/ui/Hud.ts')).toContain('__vmSuperweapons');
  });

  it('never lets the HUD reach the sim except through that seam', () => {
    // The whole point of routing the shot through `channels.commands`: a HUD
    // that imported the service and called `fireAt` would be invisible to the
    // replay recorder and to the multiplayer link. Both halves are asserted,
    // because either one alone can be satisfied while the other regresses.
    const hud = read('src/ui/Hud.ts');
    expect(/from '\.\.\/sim\/Superweapons'/.test(hud), 'Hud.ts imports the sim module').toBe(false);
    // A CALL, not the word: the file names `fireAt` in prose explaining why it
    // does not call it, and a bare-word match would fail on its own comment.
    expect(/fireAt\s*\(/.test(hud), 'Hud.ts calls fireAt directly').toBe(false);
    expect(/issueFire\s*\(/.test(hud), 'Hud.ts issues the command itself').toBe(false);
  });

  it('states HUD_SUPERWEAPON row height, gap and clearance in the stylesheet', () => {
    // CSS cannot import a TS constant, so the numbers are literals in hud.css.
    // This is the check that keeps them the SAME literals.
    const css = read('src/ui/hud.css');
    expect(css).toContain('.vm-hud .vm-dock-super');
    expect(css).toMatch(
      new RegExp(`height:\\s*calc\\(${HUD_SUPERWEAPON.rowH} \\* var\\(--vm-u\\)\\)`));
    expect(css).toMatch(
      new RegExp(`gap:\\s*calc\\(${HUD_SUPERWEAPON.rowGap} \\* var\\(--vm-u\\)\\)`));
    // The rail is `--vm-rail-w` (240u) wide and sits 10u off the right edge,
    // so the dock's own offset is those two plus the clearance.
    expect(css).toContain(
      `right: calc((10 + 240 + ${HUD_SUPERWEAPON.sidebarClearance}) * var(--vm-u))`);
  });

  it('pools exactly HUD_SUPERWEAPON.maxRows rows, and that is enough for any army', () => {
    const bar = read('src/ui/Sidebar.ts');
    expect(bar).toContain('HUD_SUPERWEAPON.maxRows');
    expect(bar).toContain('vm-dock-super');
    // Six weapons exist and the bar pools four rows. No army fields more than
    // two — but if one ever does, a countdown would silently never render.
    const perFaction = new Map<Faction, number>();
    for (const d of SUPERWEAPONS) perFaction.set(d.faction, (perFaction.get(d.faction) ?? 0) + 1);
    for (const [faction, n] of perFaction) {
      expect(n, `faction ${faction} fields more weapons than the bar can show`)
        .toBeLessThanOrEqual(HUD_SUPERWEAPON.maxRows);
    }
  });
});
