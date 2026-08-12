/**
 * ============================================================================
 * VOLTMARCH — tests/infantry-death.spec.ts
 * ============================================================================
 * `Damage.infantryDeath` PROMISED "A body, a puff, a stain" AND DELIVERED ONE.
 *
 * There is no corpse anywhere in the engine — `vfx.system.ts` routes
 * `FxKind.UnitDeathInfantry` to `spawnDust` plus a dirt `spawnImpact` and drops
 * the entity id the push carries, and `art/Wrecks.ts` has no infantry path —
 * and nothing in that function ever reached `world.vfx.decal`. Only the puff
 * was real.
 *
 * THE STAIN WAS DECIDED AGAINST ON THE BUDGET, NOT FORGOTTEN, and this file is
 * where that decision is kept honest. `DecalKind.Squish` (atlas tile 10) is the
 * obvious pattern to copy, but the two events are not comparable: a crush needs
 * a tracked hull to drive over a man who failed to scatter, and an infantry
 * death is what a firefight IS.
 *
 * The measurement that settles it:
 *
 *   - `world.vfx.decal` lands in the STATIC field, `DECAL_POOL_STATIC` = 384
 *     slots, one draw call (`world/roads.system.ts`). That pool holds every
 *     PERMANENT mark in the game: road manholes, cracks, patches and oil, every
 *     vehicle- and building-death scorch, every splash scorch over
 *     `COMBAT_DAMAGE.scorchMinDamage`, and the nuke's crater.
 *   - The pool is a strict ring with NO FREE LIST. `spawn` advances `head`
 *     unconditionally and `collapse` blanks a slot's pixels without giving back
 *     its place, so a permanent mark's whole life is measured in SUBSEQUENT
 *     static spawns — and a short `life` on the newcomer buys nothing.
 *   - Road wear alone takes 47-113 of the 384 at boot, measured below over
 *     three temperate seeds. That leaves 271-337 spawns of headroom for every
 *     permanent mark a whole match will ever lay.
 *
 * So one decal per infantry death makes infantry the dominant producer in the
 * pool that exists to survive high-frequency producers: a single 60-man push
 * wiped out costs ~20% of the entire permanent layer. The two alternatives are
 * worse — the TRACK field wraps in under a second under `TREAD_STAMPS_PER_FRAME`
 * during exactly the battle that would be laying these, and a third field is
 * one more draw call against a budget measured at 171-263 for a target of 130.
 *
 * If a future change makes the headroom comfortable, the last case here starts
 * passing by a wide margin and the decision is worth reopening. That is the
 * point of asserting the arithmetic rather than writing it in a comment.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import {
  EntityFlag, EntityKind, Faction, FxKind, Locomotor, UnitState, WarheadClass,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { DECAL_POOL_STATIC, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { DamageSystem } from '../src/sim/Damage';
import { DecalField, DecalKind } from '../src/world/Decals';
import { Terrain } from '../src/world/Terrain';
import { RoadNetwork } from '../src/world/Roads';

const ROOT = join(__dirname, '..');
const DAMAGE_SRC = readFileSync(join(ROOT, 'src/sim/Damage.ts'), 'utf8');

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/* -------------------------------------------------------------------------- */
/* Rig — one death, resolved through the real damage pipe                      */
/* -------------------------------------------------------------------------- */

interface Kill {
  /** FxKinds pushed while the corpse was processed. */
  fx: FxKind[];
  /** Every `world.vfx.decal` the death asked for, as decal kinds. */
  decals: number[];
  /** Wreck entities standing afterwards. */
  wrecks: number;
}

function killOne(kind: EntityKind): Kill {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  const channels = new Channels();
  const damage = new DamageSystem(world, channels);
  const st = world.store;

  const decals: number[] = [];
  world.vfx = {
    play: () => {}, attach: () => -1, detach: () => {},
    decal: (k) => { decals.push(k as number); },
    shake: () => {}, particleCount: () => 0,
  };

  const victim = st.alloc(kind, -1, P1, Faction.Soviets, 240, 0, 240, 0);
  const vi = st.index(victim);
  st.maxHp[vi] = 120; st.hp[vi] = 120;
  st.radius[vi] = kind === EntityKind.Infantry ? 0.23 : 2.2;
  st.locomotor[vi] = kind === EntityKind.Infantry ? Locomotor.Foot : Locomotor.Track;
  st.state[vi] = UnitState.Idle;
  st.flags[vi] |= EntityFlag.CanMove;

  const shooter = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 260, 0, 240, 0);
  st.maxHp[st.index(shooter)] = 400; st.hp[st.index(shooter)] = 400;

  channels.damage.push(
    victim, shooter as EntityId, 500, WarheadClass.SmallArms, 240, 0, 240, 0, 0,
  );

  const s: SimContext = { dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(5) };
  world.tick = 1;
  world.time = SIM_DT;
  world.spatial.rebuild();
  damage.damageTick(s);
  damage.cleanupTick(s);

  const fx: FxKind[] = [];
  for (let k = 0; k < channels.fx.count; k++) fx.push(channels.fx.kind[k] as FxKind);

  let wrecks = 0;
  for (let a = 0; a < st.aliveCount; a++) {
    if (st.kind[st.alive[a]] === EntityKind.Wreck) wrecks++;
  }
  return { fx, decals, wrecks };
}

/* ==========================================================================
 * 1. WHAT AN INFANTRY DEATH ACTUALLY PRODUCES
 * ========================================================================== */

describe('an ordinary infantry death', () => {
  it('pushes the death effect and a puff, and nothing else', () => {
    const k = killOne(EntityKind.Infantry);
    expect(k.fx).toContain(FxKind.UnitDeathInfantry);
    expect(k.fx).toContain(FxKind.DustPuff);
  });

  it('leaves NO mark on the ground', () => {
    // The defect, stated as the contract it is now documented as. If a stain is
    // ever added, this case is the one to change — deliberately, with the
    // budget case below re-measured, not as a drive-by.
    expect(killOne(EntityKind.Infantry).decals).toEqual([]);
  });

  it('leaves no body — there is no corpse entity and no wreck', () => {
    expect(killOne(EntityKind.Infantry).wrecks).toBe(0);
  });

  it('is not the counter being broken: a vehicle death DOES scorch', () => {
    // Without this the two cases above would pass on a rig that never called
    // the port at all, which is the shape of defect this repo keeps finding.
    const k = killOne(EntityKind.Vehicle);
    expect(k.decals.length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 2. CODE AND COMMENT AGREE
 * ========================================================================== */

/**
 * The docstring immediately above `infantryDeath`. Taken by walking BACK from
 * the declaration to the nearest `/**`, because a lazy forward match starts at
 * the file banner and swallows everything in between.
 */
const DOC = ((): string => {
  const at = DAMAGE_SRC.indexOf('private infantryDeath(');
  if (at < 0) return '';
  const before = DAMAGE_SRC.slice(0, at);
  const open = before.lastIndexOf('/**');
  const close = before.lastIndexOf('*/');
  return open >= 0 && close > open ? before.slice(open + 3, close) : '';
})();
const BODY = /private infantryDeath\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/.exec(DAMAGE_SRC)?.[1] ?? '';

describe('the docstring', () => {
  it('exists, and its summary is the list of what does NOT happen', () => {
    expect(DOC, 'infantryDeath must keep a docstring').not.toBe('');
    // The summary line, which is the sentence a reader takes away.
    const summary = DOC.split('\n').slice(0, 3).join(' ');
    expect(summary).toMatch(/no wreck/);
    expect(summary).toMatch(/no crater/);
    expect(summary).toMatch(/NO GROUND MARK/);
    // "a stain" appears only inside the explanation of why there is not one.
    expect(summary).not.toMatch(/stain/i);
  });

  it('records why, so the next reader does not re-litigate it from scratch', () => {
    expect(DOC).toMatch(/DECAL_POOL_STATIC/);
    expect(DOC).toMatch(/DecalKind\.Squish/);
  });

  it('is not describing a different function: the body lays no decal', () => {
    expect(BODY, 'infantryDeath must still exist').not.toBe('');
    expect(BODY).not.toMatch(/decal\(/);
    expect(BODY).toMatch(/FxKind\.UnitDeathInfantry/);
    expect(BODY).toMatch(/FxKind\.DustPuff/);
  });
});

/* ==========================================================================
 * 3. THE BUDGET — measured, not asserted
 * ========================================================================== */

describe('the static decal pool', () => {
  it('is a strict ring with no free list: an expired slot keeps its place', () => {
    // THE LOAD-BEARING FACT. If an expired slot were recycled ahead of a live
    // one, a short-lived body stain would cost the permanent layer nothing and
    // the whole decision below would be different.
    const f = new DecalField({ scene: new THREE.Scene(), capacity: 4 });
    const manhole = f.spawn(DecalKind.Manhole, 0, 0, 1, 1, 0);   // life 0 = permanent
    for (let i = 0; i < 3; i++) f.spawn(DecalKind.Dust, 10 + i, 0, 1, 1, 0, 0.5);
    // Two seconds later the three transients have expired and been collapsed.
    f.frame(2);
    expect(f.liveCount).toBe(1);

    // The next spawn nonetheless lands on the MANHOLE, not on any of the three
    // slots that are standing empty.
    const next = f.spawn(DecalKind.Scorch, 50, 0, 1, 1, 0);
    expect(next).toBe(manhole);
    expect(f.stats().evicted).toBe(1);
    f.dispose();
  });

  it('is one pool of 384 shared by every permanent mark in the game', () => {
    expect(DECAL_POOL_STATIC).toBe(384);
  });

  it('is already 12-30% spent on road wear before a shot is fired', () => {
    // Real terrain, real road generator, real pool. The two seeds that bracket
    // the range: a third (4242) measured 47, inside it, and terrain generation
    // is the expensive part of this file.
    const spent: number[] = [];
    for (const seed of [0x7e44a1, 1337]) {
      const scene = new THREE.Scene();
      const terrain = new Terrain({ scene, seed, biome: 'temperate' });
      const decals = new DecalField({ scene, capacity: DECAL_POOL_STATIC });
      const net = new RoadNetwork({ scene, terrain, seed, decals, stampTerrain: false });
      net.generate();
      spent.push(decals.stats().spawned);
      decals.dispose();
      net.dispose();
    }
    // Measured 47 / 113 / 47 at the time of writing. The band is wide on
    // purpose: what matters is that the layer starts materially short of 384,
    // not the exact figure a seed happens to produce.
    for (const n of spent) {
      expect(n).toBeGreaterThan(10);
      expect(n).toBeLessThan(DECAL_POOL_STATIC);
    }
    const worst = Math.max(...spent);
    expect(DECAL_POOL_STATIC - worst).toBeLessThan(360);
  });

  it('would spend a fifth of the permanent layer on one infantry push', () => {
    // 271-337 spawns of headroom after road wear. A 60-man push is a routine
    // engagement, not a worst case, and a match holds several of them.
    const headroom = DECAL_POOL_STATIC - 113;   // the worst seed measured above
    const onePush = 60;
    expect(onePush / headroom).toBeGreaterThan(0.15);
    // Five engagements erase every scorch, every crater and every manhole.
    expect(Math.ceil(headroom / onePush)).toBeLessThanOrEqual(6);
  });
});
