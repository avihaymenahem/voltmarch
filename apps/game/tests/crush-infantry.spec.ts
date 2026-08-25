/**
 * ============================================================================
 * CRUSHING INFANTRY — the genre's most recognisable verb, which did not work.
 * ============================================================================
 * `src/sim/Crush.ts` shipped with `if (st.kind[j] !== EntityKind.Prop) continue`
 * as its whole victim test, so a tank flattened trees and drove harmlessly
 * through men. Every part of the rule was already authored and read by nothing:
 * `EntityFlag.Crushable` ("dies instantly under a Crusher with a higher
 * crushLevel") on every foot unit, `crushableBy: 1` beside it, `crushLevel:
 * 3..6` on the hulls, and `FxKind.CrushSquish` wired all the way to a real
 * `SFX.crush` sample.
 *
 * WHAT THESE TESTS PIN
 * --------------------
 *   THE GATE      — `crushLevel` vs `crushableBy`, and that 0 means UNCRUSHABLE
 *                   for a unit (the opposite of what it means for a prop).
 *   THE CHANNEL   — a crush is a KILL. It goes through `channels.damage`, so it
 *                   collects the armour matrix, kill credit, veterancy, the
 *                   `unitsLost`/`unitsKilled` ledger and `Damage.infantryDeath`
 *                   rather than quietly vanishing via `store.markDead`.
 *   NEVER YOUR OWN — allied infantry are shoved aside, not flattened, which is
 *                   how every other DIRECT harm in the sim behaves.
 *   THE APPROACH  — the half that is easy to forget. `Steering` used to lean the
 *                   hull around the man and inherit his walking pace as a queue
 *                   brake, and `Movement.relax` then held the two discs 3.02 m
 *                   apart against a crush test that needs 2.19 m. A measured
 *                   probe put a Warden's closest approach at 2.83 m with the
 *                   rifleman untouched. `a rolling hull reaches the man` is the
 *                   test that says those carve-outs are still there.
 *
 * Every unit is spawned from `FALLBACK_UNITS`, so these measure the SHIPPED
 * roster rather than numbers invented here. Headless — typed arrays and the
 * `ITerrain` port, no GL.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { DecalKind, EntityFlag, EntityKind, Faction, FxKind, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { CELL, SIM_DT, SQUISH_HALF_SIZE } from '../src/core/config';
import { Rng } from '../src/core/math';
import { FlowFieldCache, MoveClass, moveClassForLocomotor } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator, setMoveClass } from '../src/sim/Movement';
import { CrushResolver, CRUSH, crushesUnit } from '../src/sim/Crush';
import { DamageSystem } from '../src/sim/Damage';
import { FALLBACK_UNITS } from '../src/game/Scenarios';
import { UNITS } from '../src/data/Defs';

/** Cell index -> the world coordinate of its centre. */
const C = (c: number): number => (c + 0.5) * CELL;

interface Rig {
  world: World;
  channels: Channels;
  crush: CrushResolver;
  damage: DamageSystem;
  /** Two players, at war with each other. */
  red: PlayerId;
  blue: PlayerId;
  step(n?: number): void;
}

/**
 * The whole tick, in phase order.
 *
 * `crush` runs at Phase.Movement/970 — after the integrator, before
 * SpatialRebuild — and `damage` at 1200/1400, which is what makes a crush
 * resolve on the SAME tick it is queued. Getting that order wrong here would
 * make every one of these tests pass a tick late for the wrong reason.
 */
function makeRig(): Rig {
  const world = new World();
  const red = world.addPlayer(Faction.Allies, 'Red', true, true);
  const blue = world.addPlayer(Faction.Soviets, 'Blue', false, false);
  const channels = new Channels();
  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);
  const crush = new CrushResolver(world, channels);
  const damage = new DamageSystem(world, channels);
  let tick = 0;
  const rng = new Rng(20260808);
  return {
    world, channels, crush, damage, red, blue,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        tick++;
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.store.snapshotPrev();
        assigner.simTick(s);        // Phase.PathRequest  500
        steering.simTick(s);        // Phase.Steering     600
        movement.simTick(s);        // Phase.Movement     700
        crush.simTick(s);           // Phase.Movement     970
        world.spatial.rebuild();    // Phase.SpatialRebuild 800
        damage.damageTick(s);       // Phase.Damage      1200
        damage.cleanupTick(s);      // Phase.Cleanup     1400
      }
    },
  };
}

/**
 * Spawn a roster unit for `player`, exactly the way `ScenarioBuilder.spawnUnit`
 * does: every column out of `FALLBACK_UNITS`, nothing invented.
 */
function spawn(rig: Rig, key: string, player: PlayerId, x: number, z: number): number {
  const st = rig.world.store;
  const fb = FALLBACK_UNITS[key];
  expect(fb, `no FALLBACK_UNITS row for '${key}'`).toBeDefined();
  const faction = rig.world.player(player).faction;
  const id = st.alloc(fb.kind, -1, player, faction, x, 0, z, 0);
  const i = st.index(id);
  st.maxHp[i] = fb.maxHp; st.hp[i] = fb.maxHp;
  st.armorClass[i] = fb.armor;
  st.sight[i] = fb.sight;
  st.maxSpeed[i] = fb.maxSpeed;
  st.accel[i] = fb.accel;
  st.turnRate[i] = fb.turnRate;
  st.locomotor[i] = fb.locomotor;
  st.radius[i] = Math.max(fb.width, fb.length) * 0.45;
  st.crushLevel[i] = fb.crushLevel;
  st.crushableBy[i] = fb.crushableBy;
  st.flags[i] |= fb.flags;
  st.state[i] = UnitState.Idle;
  setMoveClass(st, id, moveClassForLocomotor(fb.locomotor));
  return i;
}

const handle = (rig: Rig, i: number): EntityId => rig.world.store.handleOf(i);

const alive = (rig: Rig, i: number): boolean =>
  (rig.world.store.flags[i] & EntityFlag.Alive) !== 0
  && (rig.world.store.flags[i] & EntityFlag.PendingDestroy) === 0;

/** Order `i` to (x,z) and run until it arrives or the clock runs out. */
function drive(rig: Rig, i: number, x: number, z: number, seconds = 20): void {
  const st = rig.world.store;
  st.orderX[i] = x;
  st.orderZ[i] = z;
  st.state[i] = UnitState.Moving;
  rig.step(Math.round(seconds / SIM_DT));
}

/** Closest the two ever got, in metres, while `i` drives to (x,z). */
function driveMeasured(rig: Rig, i: number, j: number, x: number, z: number): number {
  const st = rig.world.store;
  st.orderX[i] = x;
  st.orderZ[i] = z;
  st.state[i] = UnitState.Moving;
  let worst = Infinity;
  for (let k = 0; k < 600; k++) {
    rig.step(1);
    if (!alive(rig, j)) return 0;
    const d = Math.hypot(st.posX[i] - st.posX[j], st.posZ[i] - st.posZ[j]);
    if (d < worst) worst = d;
  }
  return worst;
}

function countFx(rig: Rig, kind: FxKind): number {
  let n = 0;
  for (let k = 0; k < rig.channels.fx.count; k++) if (rig.channels.fx.kind[k] === kind) n++;
  return n;
}

/* ==========================================================================
 * 1. THE VERB
 * ========================================================================== */

describe('a tank runs down the infantry in front of it', () => {
  it('flattens an enemy rifleman it drives over', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();

    // The authored pair this whole feature turns on.
    expect(rig.world.store.crushLevel[tank], 'grizzly crushLevel').toBe(3);
    expect(rig.world.store.crushableBy[man], 'conscript crushableBy').toBe(1);
    expect(alive(rig, man)).toBe(true);

    drive(rig, tank, C(62), C(50));

    // THE WHOLE BUG IN ONE ASSERTION. On the old one-line victim test
    // (`if (st.kind[j] !== EntityKind.Prop) continue`) the conscript finished
    // this drive at 100/100 HP with a Warden parked on the far side.
    expect(alive(rig, man)).toBe(false);
    expect(rig.crush.crushedUnits).toBe(1);
  });

  it('reaches the man at all — the steering and relax carve-outs', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();
    const st = rig.world.store;

    // What the kill test actually demands of the geometry.
    const reach = st.radius[tank] * CRUSH.hullFrac + st.radius[man];
    // What `Movement.relax` would hold them to if it still applied.
    const relaxWant = st.radius[tank] + st.radius[man];
    expect(reach, 'the crush disc must be tighter than the collision disc')
      .toBeLessThan(relaxWant);

    const closest = driveMeasured(rig, tank, man, C(62), C(50));

    // 0 means he died, which is the only outcome that proves the hull arrived.
    // Measured before the carve-outs: 2.83 m against a 2.19 m requirement, with
    // the man alive — a rule that was correct and unreachable.
    expect(closest, 'the hull never reached him').toBe(0);
    expect(alive(rig, man)).toBe(false);
  });

  it('crushes a whole squad standing in the lane', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'rhino', rig.red, C(36), C(50));
    const squad = [0, 1, 2, 3, 4].map((n) => spawn(rig, 'gi', rig.blue, C(44 + n * 3), C(50)));
    rig.world.spatial.rebuild();

    drive(rig, tank, C(66), C(50), 30);

    for (const m of squad) expect(alive(rig, m)).toBe(false);
    expect(rig.crush.crushedUnits).toBe(squad.length);
  });
});

/* ==========================================================================
 * 2. THE GATE — crushLevel vs crushableBy
 * ========================================================================== */

describe('the crushLevel / crushableBy pair decides', () => {
  it('spares a man whose crushableBy is above the hull crushLevel', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));   // crushLevel 3
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.store.crushableBy[man] = 4;                        // one above
    rig.world.spatial.rebuild();

    drive(rig, tank, C(62), C(50));

    expect(alive(rig, man)).toBe(true);
    expect(rig.crush.crushedUnits).toBe(0);
  });

  it('treats crushableBy 0 as UNCRUSHABLE, not as unset', () => {
    // The asymmetry that makes this rule easy to get wrong: for a PROP, whose
    // column no spawn path writes, 0 means "unset" and falls back to
    // `CRUSH.propDefaultLevel`. For a UNIT it means immune, and that is what
    // keeps a Sledge safe. Merging the two would delete the immunity.
    const rig = makeRig();
    const tank = spawn(rig, 'apocalypse', rig.red, C(40), C(50)); // crushLevel 6
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.store.crushableBy[man] = 0;
    rig.world.spatial.rebuild();

    expect(rig.world.store.crushLevel[tank]).toBe(6);
    drive(rig, tank, C(62), C(50));

    expect(alive(rig, man)).toBe(true);
    expect(CRUSH.propDefaultLevel, 'the prop default must not have leaked in').toBe(1);
  });

  it('does nothing for a hull without EntityFlag.Crusher', () => {
    const rig = makeRig();
    // The Refractor Tank carries `crushLevel: 2` in the def table and NOT the
    // Crusher flag. The flag is the switch; the level is only the threshold.
    const tank = spawn(rig, 'prismTank', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();

    expect((rig.world.store.flags[tank] & EntityFlag.Crusher), 'prismTank Crusher flag').toBe(0);
    drive(rig, tank, C(62), C(50));

    expect(alive(rig, man)).toBe(true);
  });

  it('does nothing for a man without EntityFlag.Crushable', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.store.flags[man] &= ~EntityFlag.Crushable;
    rig.world.spatial.rebuild();

    drive(rig, tank, C(62), C(50));

    expect(alive(rig, man)).toBe(true);
  });

  it('crushes nothing while parked', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(50), C(50));
    // Standing inside the hull disc, and a tank that is given no order.
    const man = spawn(rig, 'conscript', rig.blue, C(50) + 1.0, C(50));
    rig.world.spatial.rebuild();

    rig.step(200);

    expect(rig.world.store.speed[tank]).toBeLessThan(CRUSH.minSpeed);
    expect(alive(rig, man), 'a parked hull is not a weapon').toBe(true);
    // And the collision carve-out is speed-gated with it, so he is pushed out
    // of the hull rather than left standing inside it.
    const st = rig.world.store;
    const d = Math.hypot(st.posX[tank] - st.posX[man], st.posZ[tank] - st.posZ[man]);
    expect(d, 'a parked hull still separates').toBeGreaterThan(1.0);
  });
});

/* ==========================================================================
 * 3. VEHICLES ARE NOT VICTIMS
 * ========================================================================== */

describe('armour is not crushable, however heavy the hull that hits it', () => {
  it('never crushes a Sledge', () => {
    // True twice over, and that is deliberate: the Sledge carries
    // `crushableBy: 0`, AND no vehicle in the roster carries
    // `EntityFlag.Crushable` at all. Either alone would save it.
    const rig = makeRig();
    const hunter = spawn(rig, 'apocalypse', rig.red, C(40), C(50));  // crushLevel 6
    const prey = spawn(rig, 'apocalypse', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();

    expect(rig.world.store.crushableBy[prey]).toBe(0);
    drive(rig, hunter, C(62), C(50));

    expect(alive(rig, prey)).toBe(true);
    expect(rig.crush.crushedUnits).toBe(0);
  });

  it('refuses a vehicle even when it is flagged Crushable and outranked', () => {
    // The kind test is the guard that stops a stray roster flag from turning
    // the ram numbers on `crushableBy` into a tank-deleting mechanic nobody
    // authored. Forced here rather than waited for.
    const rig = makeRig();
    const tank = spawn(rig, 'apocalypse', rig.red, C(40), C(50));    // crushLevel 6
    const ifv = spawn(rig, 'ifv', rig.blue, C(50), C(50));           // crushableBy 4
    rig.world.store.flags[ifv] |= EntityFlag.Crushable;
    rig.world.spatial.rebuild();

    expect(rig.world.store.crushableBy[ifv]).toBe(4);
    expect(crushesUnit(rig.world, tank, ifv)).toBe(false);
    drive(rig, tank, C(62), C(50));
    expect(alive(rig, ifv)).toBe(true);
  });
});

/* ==========================================================================
 * 4. NEVER YOUR OWN
 * ========================================================================== */

describe('a hull does not run down its own side', () => {
  it('leaves allied infantry standing', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'gi', rig.red, C(50), C(50));
    rig.world.spatial.rebuild();

    expect(rig.world.areAllied(rig.red, rig.red)).toBe(true);
    drive(rig, tank, C(62), C(50));

    expect(alive(rig, man)).toBe(true);
    expect(rig.crush.crushedUnits).toBe(0);
    expect(rig.world.player(rig.red).stats.unitsLost).toBe(0);
  });

  it('goes round him — the steering and collision carve-outs are allegiance-gated', () => {
    const friendly = makeRig();
    const fTank = spawn(friendly, 'grizzly', friendly.red, C(40), C(50));
    const fMan = spawn(friendly, 'gi', friendly.red, C(50), C(50));
    friendly.world.spatial.rebuild();
    const reach = friendly.world.store.radius[fTank] * CRUSH.hullFrac
      + friendly.world.store.radius[fMan];
    const allyClosest = driveMeasured(friendly, fTank, fMan, C(62), C(50));

    const hostile = makeRig();
    const hTank = spawn(hostile, 'grizzly', hostile.red, C(40), C(50));
    const hMan = spawn(hostile, 'conscript', hostile.blue, C(50), C(50));
    hostile.world.spatial.rebuild();
    const foeClosest = driveMeasured(hostile, hTank, hMan, C(62), C(50));

    // Identical geometry, identical order, one bit of difference: whose man he
    // is. The friendly hull leans around him exactly as it always did and never
    // gets inside its own crush disc; the hostile one drives straight over him.
    expect(allyClosest, 'a friendly hull entered its own crush disc')
      .toBeGreaterThan(reach);
    expect(foeClosest, 'the hostile hull did not reach him').toBe(0);
    expect(alive(friendly, fMan)).toBe(true);
    expect(alive(hostile, hMan)).toBe(false);
  });

  it('matches how every other DIRECT harm in the sim treats an ally', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const friend = spawn(rig, 'gi', rig.red, C(48), C(50));
    const foe = spawn(rig, 'conscript', rig.blue, C(48), C(56));
    rig.world.spatial.rebuild();

    expect(crushesUnit(rig.world, tank, friend), 'ally').toBe(false);
    expect(crushesUnit(rig.world, tank, foe), 'enemy').toBe(true);
  });
});

/* ==========================================================================
 * 5. A CRUSH IS A KILL, NOT A CONVERSION
 *
 * The prop path uses `store.markDead`, which is right for a tree and wrong for
 * a man: it skips the armour matrix, `entity:damaged`, kill credit, veterancy
 * and the whole `Damage.onDeath` ceremony. These say the man goes through
 * `channels.damage` like everything else the game kills.
 * ========================================================================== */

describe('the death goes through the damage channel', () => {
  it('emits entity:killed with the tank as the killer', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();
    const tankId = handle(rig, tank);
    const manId = handle(rig, man);

    let killed = 0;
    let killer: EntityId | null = null;
    let killerPlayer = -1;
    let victimPlayer = -1;
    rig.channels.events.on('entity:killed', (p) => {
      if (p.id !== manId) return;
      killed++;
      killer = p.killer;
      killerPlayer = p.killerPlayer as number;
      victimPlayer = p.player as number;
    });

    drive(rig, tank, C(62), C(50));

    expect(killed, 'entity:killed fired exactly once').toBe(1);
    expect(killer).toBe(tankId);
    expect(killerPlayer).toBe(rig.red as number);
    expect(victimPlayer).toBe(rig.blue as number);
  });

  it('books it on both ledgers — unitsLost and unitsKilled', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();

    drive(rig, tank, C(62), C(50));

    expect(rig.world.player(rig.blue).stats.unitsLost).toBe(1);
    expect(rig.world.player(rig.red).stats.unitsKilled).toBe(1);
    expect(rig.damage.stats.kills).toBe(1);
  });

  it('credits the driver, so a crush counts toward veterancy', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(36), C(50));
    [0, 1, 2].map((n) => spawn(rig, 'conscript', rig.blue, C(45 + n * 4), C(50)));
    rig.world.spatial.rebuild();

    drive(rig, tank, C(66), C(50), 30);

    // The reason this file uses `channels.damage` rather than `store.markDead`:
    // kill credit and the promotion it feeds live inside `Damage.applyOne`, and
    // a corpse marked dead by hand collects neither.
    expect(rig.world.store.killCount[tank]).toBe(3);
  });

  it('deals exactly what it takes, and no more', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();
    const maxHp = rig.world.store.maxHp[man];
    const manId = handle(rig, man);

    let dealt = 0;
    rig.channels.events.on('entity:damaged', (p) => {
      if (p.id === manId) dealt += p.amount;
    });

    drive(rig, tank, C(62), C(50));

    // `audio.system.ts` sizes its combat-intensity heuristic off damage dealt
    // in the last four seconds, so an overkill "make sure" figure would make one
    // squashed conscript read as a firefight. The record is `hp` divided back
    // through the armour multiplier, plus one.
    expect(dealt).toBeGreaterThan(maxHp);
    expect(dealt).toBeLessThan(maxHp + 2);
  });

  it('gives him the same death puffs any other dead rifleman gets', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();

    drive(rig, tank, C(62), C(50));

    // From `Damage.infantryDeath`, free, because the kill went down the same
    // pipe as a bullet's.
    expect(countFx(rig, FxKind.UnitDeathInfantry)).toBeGreaterThan(0);
  });

  it('pushes the crunch that carries the sound', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();

    drive(rig, tank, C(62), C(50));

    // `audio/Weapons.ts` maps FxKind.CrushSquish -> SFX.crush, which is backed
    // by public/audio/sfx/crush.squish.*.ogg. No new asset; the sample was
    // shipped for a mechanic that until now never fired.
    expect(countFx(rig, FxKind.CrushSquish)).toBeGreaterThan(0);
    // And it must not be gated by the PROP size floor. A rifleman's collision
    // disc is 0.234 m — `max(0.52, 0.52) * 0.45` — which is under
    // `minSquishRadius`, so routing him through `squish()` would have made the
    // one mechanic with a shipped sample silent.
    expect(CRUSH.minSquishRadius,
      'the prop floor no longer excludes a rifleman; the direct push can go')
      .toBeGreaterThan(0.234);
  });

  it('leaves a mark on the ground, aligned with the track that made it', () => {
    /*
     * THE STAIN THAT NEVER DREW. `core/types.ts` has carried a `DecalKind.Squish`
     * since it was written; `world/Decals.ts` had no counterpart tile, so
     * `vfx.system.ts`'s `DECAL_PORT_MAP` dropped the kind and `Crush.ts` — quite
     * correctly, at the time — refused to push a decal it knew was swallowed.
     * The end state was a verb that killed a man, moved a counter, played a
     * sample and left the ground untouched.
     *
     * `world.vfx` is the RENDER port, a null object in this rig, so recording it
     * is the only way to see the call at all — and the fact that it IS the null
     * object here is also the reason this cannot perturb the sim.
     */
    const rig = makeRig();
    const decals: { kind: number; x: number; z: number; rot: number; size: number }[] = [];
    rig.world.vfx = {
      ...rig.world.vfx,
      decal: (kind, x, z, rot, size) => { decals.push({ kind, x, z, rot, size }); },
    };

    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.spatial.rebuild();
    const st = rig.world.store;
    const manX = st.posX[man];
    const manZ = st.posZ[man];

    drive(rig, tank, C(62), C(50));
    expect(alive(rig, man)).toBe(false);

    const squishes = decals.filter((d) => d.kind === (DecalKind.Squish as number));
    expect(squishes.length, 'no ground mark for a crushed man').toBe(1);
    const s = squishes[0];

    // Where he was, not where the tank ended up.
    expect(Math.hypot(s.x - manX, s.z - manZ)).toBeLessThan(1.5);
    // Sized off the TRACK. A Warden's disc is max(6.2, 3.1) * 0.45 = 2.79 m.
    expect(s.size).toBeCloseTo(2.79 * CRUSH.stainFrac, 2);
    expect(s.size).toBeGreaterThanOrEqual(SQUISH_HALF_SIZE);
    // Oriented to the CRUSHER's heading, so the print lands square with the
    // tread strips its own tracks are laying either side of it. Driving +X is
    // yaw = PI/2 under the engine's "yaw 0 faces +Z" convention.
    expect(Math.abs(s.rot - Math.PI / 2)).toBeLessThan(0.35);
  });

  it('does not mark the ground for a felled prop — that is splinters, not a print', () => {
    // `squish()` is the PROP path and stays FX-only. A track print pressed where
    // a hedge was is a claim about what happened that is not true.
    const crush = readFileSync(join(__dirname, '../src/sim/Crush.ts'), 'utf8');
    const propPath = crush.slice(crush.indexOf('private squish('));
    expect(propPath).not.toMatch(/vfx\.decal/);
  });

  it('never crushes a garrisoned man', () => {
    const rig = makeRig();
    const tank = spawn(rig, 'grizzly', rig.red, C(40), C(50));
    const man = spawn(rig, 'conscript', rig.blue, C(50), C(50));
    rig.world.store.flags[man] |= EntityFlag.Garrisoned | EntityFlag.Immobilized;
    rig.world.spatial.rebuild();

    drive(rig, tank, C(62), C(50));

    expect(alive(rig, man)).toBe(true);
  });
});

/* ==========================================================================
 * 6. DETERMINISM
 * ========================================================================== */

describe('determinism', () => {
  it('one seed, two runs, identical outcome', () => {
    const run = (): string => {
      const rig = makeRig();
      const tank = spawn(rig, 'rhino', rig.red, C(36), C(50));
      const squad = [0, 1, 2, 3].map((n) => spawn(rig, 'gi', rig.blue, C(44 + n * 4), C(50)));
      rig.world.spatial.rebuild();
      drive(rig, tank, C(66), C(50), 30);
      const st = rig.world.store;
      return JSON.stringify({
        x: st.posX[tank], z: st.posZ[tank],
        dead: squad.map((m) => alive(rig, m)),
        units: rig.crush.crushedUnits,
        kills: rig.damage.stats.kills,
      });
    };
    expect(run()).toBe(run());
  });
});

/* ==========================================================================
 * 7. THE ROSTER STILL SUPPORTS THE RULE
 *
 * The gate reads two authored columns. If a roster edit ever zeroes them the
 * mechanic goes quiet with no error, which is exactly how it came to be dead in
 * the first place — so the tables are asserted, not assumed.
 * ========================================================================== */

describe('the def tables', () => {
  it('gives every foot unit a crushableBy a tank can actually meet', () => {
    for (const u of UNITS) {
      if (u.kind !== EntityKind.Infantry) continue;
      expect(u.crushableBy, `${u.key} is uncrushable`).toBeGreaterThan(0);
      expect(u.crushableBy, `${u.key} is out of reach of every hull`).toBeLessThanOrEqual(6);
    }
  });

  it('keeps at least one Crusher able to reach the softest infantry', () => {
    let best = 0;
    for (const key of Object.keys(FALLBACK_UNITS)) {
      const fb = FALLBACK_UNITS[key];
      if ((fb.flags & EntityFlag.Crusher) === 0) continue;
      if (fb.crushLevel > best) best = fb.crushLevel;
    }
    expect(best, 'no fallback row carries EntityFlag.Crusher any more')
      .toBeGreaterThanOrEqual(1);
  });

  it('has no vehicle flagged Crushable, which is what makes the kind gate honest', () => {
    for (const key of Object.keys(FALLBACK_UNITS)) {
      const fb = FALLBACK_UNITS[key];
      if (fb.kind !== EntityKind.Vehicle) continue;
      expect(fb.flags & EntityFlag.Crushable, `${key} is flagged Crushable`).toBe(0);
    }
  });

  it('never lets a Foot unit be a Crusher', () => {
    // Not a rule the code enforces — a rule the roster has always kept, and
    // the day it stops, infantry start flattening each other.
    for (const key of Object.keys(FALLBACK_UNITS)) {
      const fb = FALLBACK_UNITS[key];
      if (fb.kind !== EntityKind.Infantry) continue;
      expect(fb.flags & EntityFlag.Crusher, `${key} is a Crusher`).toBe(0);
      expect(fb.crushLevel, `${key} has a crushLevel`).toBe(0);
    }
  });

  it('leaves MoveClass alone — a crusher is still a normal mover', () => {
    // Cheap guard on the two carve-outs: they key off the crush rule, never off
    // a move class, so nothing here may start depending on Track vs Wheel.
    expect(moveClassForLocomotor(FALLBACK_UNITS.rclScrapper.locomotor)).toBe(MoveClass.Wheel);
    expect((FALLBACK_UNITS.rclScrapper.flags & EntityFlag.Crusher) !== 0,
      'the Scrapjaw is a WHEELED crusher; locomotor must not be the gate').toBe(true);
  });
});
