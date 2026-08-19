/**
 * ============================================================================
 * tests/campaign-zone-safety.spec.ts — a `unitsInArea` disc may not sit inside
 * a player weapon's reach of something another objective needs ALIVE
 * ============================================================================
 * `pact.01.shallow-road` shipped two secondaries in direct conflict. `bore`
 * pays 500 credits for capturing the bore head and FAILS on `entityDead`;
 * `wade` — hidden, so it arrives with no warning — pays 400 for putting three
 * units in a 24 m disc sited 36.9 m off that same head. Measured on a real
 * headless build, the nearest hover-passable cell in that disc was **14.1 m**
 * from the head and **73 of its 112** passable cells were inside a parked
 * Solarch's engagement envelope. Doing the hidden bonus destroyed the paying
 * one.
 *
 * THE HEADER ASSERTED THE OPPOSITE, AND THE ARITHMETIC IS THE POINT
 * ----------------------------------------------------------------
 * It read *"36.9 m is also outside `focusLance`, so parking three Solarchs on
 * the objective does not put them in range of the head they are supposed to
 * leave standing."* That measures the disc's CENTRE and leaves the RADIUS out.
 * It was the second time that exact mistake was made in that one operation —
 * the layout records catching it once already between the mast and the head, at
 * 18 m — which is what makes this a class of defect rather than an instance,
 * and therefore a test rather than a fix.
 *
 * THE ENVELOPE IS NOT THE WEAPON RANGE
 * ------------------------------------
 * `Targeting.isValidTarget` compares a SURFACE distance — centre to centre less
 * the target's `hitRadius`, which for a 2x2 footprint is 5.66 m — against
 * `max(reachOf, range * COMBAT_TARGETING.acquireRangeMul)`. For an Idle or
 * Guarding hull that can drive, `reachOf` is
 * `range * APPROACH_STOP_FRAC + STANCE_CHASE_METRES[stance]`, and every unit in
 * the game spawns Aggressive (`world.alloc`, `ProductionService`, and
 * `ScenarioBuilder.spawnUnit`'s default all write it). So the reach of a 26 m
 * gun on a structure is 38.8 m of surface, not 26 — and a hull that acquires
 * does not merely fire, it DRIVES, so it leaves the zone as well as killing the
 * thing. Both halves fail the objective.
 *
 * THE RULE, AND THE ONE EXCEPTION THAT MAKES IT HONEST
 * ---------------------------------------------------
 * For every player-seat `unitsInArea` disc and every tag some trigger needs
 * alive: the tagged entity must be further from the disc's centre than
 * `r + envelope + hitRadius(entity)`.
 *
 * **UNLESS THE DISC CONTAINS IT.** That exception is not a fudge, it is the
 * discriminator, and without it this check is useless: three of the nine
 * shipped operations centre a disc ON the protected structure on purpose —
 * `allies.02`'s `t.seen` (r 96) and `t.win` (r 26) on the instrument office,
 * `reclamation.01`'s `t.scouted` (r 74) on its office, and `pact.01`'s own
 * `t.cut` (r 56) on the gap the two `gun` emplacements stand in. Standing on a
 * thing is what those objectives ASKED for, and by the time they resolve the
 * structure is usually the player's own. A disc that does NOT contain the
 * entity is somewhere else, and reaching it is an accident nobody authored.
 * Measured with the exception removed: 4 false positives to 1 true one.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * It is a geometry check, not a playthrough. It says nothing about whether a
 * player WILL bring a hull, about line of sight, or about the AI. And it reads
 * the whole army's longest range rather than what the operation's roster
 * permits — deliberately, because `OperationRoster` is an allow-list over
 * UNLOCK-TAGGED defs only, so an untagged long-range hull is buildable in every
 * operation and a roster-aware bar would be narrower than the truth.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, setCampaignLayout,
  setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import { hitRadius } from '../src/sim/Damage';
import { UNITS, WEAPONS } from '../src/data/Defs';
import { GUARD_LEASH } from '../src/core/config';
import type { Area, Condition, OperationDef } from '../src/campaign/types';

/**
 * `APPROACH_STOP_FRAC` is module-private to `sim/Targeting.ts`. Repeated here
 * with its value rather than exported, because exporting a constant so that a
 * test can read it is how a private tuning number becomes an API — and the
 * assertion below is deliberately conservative in the same direction as any
 * drift, since raising it would only widen the envelope this file demands.
 */
const APPROACH_STOP_FRAC = 0.80;

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

interface Built {
  world: World;
  tags: Map<string, EntityId[]>;
}

/** Same build the rest of the campaign specs perform: plan, layout, world. */
function buildOperation(op: OperationDef): Built {
  const sea = MAP_SEAS[op.map.preset] ?? null;
  const terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: op.map.mapSeed,
    biome: op.map.biome as never,
    anisotropy: 1,
    starts: startPointsFor(op.map.armies, sea, op.map.simSeed).map((p) => ({ x: p.x, z: p.z })),
    sea,
  });
  setActiveTerrain(terrain);

  const world = new World();
  world.addPlayer(FACTION_OF[op.chapter], 'Commander', true, true);
  for (let seat = 1; seat < op.map.armies; seat++) {
    world.addPlayer(op.foe, 'Opponent', false, false);
  }
  world.terrain = terrain;

  const tags = new Map<string, EntityId[]>();
  const l = LAYOUTS.get(op.layout);
  expect(l, `operation ${op.id} names layout '${op.layout}'`).toBeDefined();

  setPlannedOperation({
    id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
  });
  setCampaignLayout((b, cx, cz, start) => {
    l!.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (name, id) => {
        if (id === NONE) return;
        const list = tags.get(name);
        if (list === undefined) tags.set(name, [id]);
        else list.push(id);
      },
      seat: (i) => b.armySlot(i),
    });
  });

  try {
    buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies });
  } finally {
    setCampaignLayout(null);
    setPlannedOperation(null);
    clearScenario();
    terrain.dispose?.();
  }
  return { world, tags };
}

/** The longest-reaching gun the player's army can put next to a structure. */
function longestReach(faction: Faction): { key: string; range: number } {
  let best = { key: '(unarmed army)', range: 0 };
  for (const u of UNITS) {
    if (u.faction !== faction) continue;
    if (u.kind !== EntityKind.Infantry && u.kind !== EntityKind.Vehicle) continue;
    for (const wi of u.weapons) {
      const w = WEAPONS[wi];
      if (w !== undefined && w.range > best.range) best = { key: u.key, range: w.range };
    }
  }
  return best;
}

/** Every `unitsInArea` disc the table asks the PLAYER's seat to occupy. */
function playerZones(op: OperationDef): { trigger: string; area: Area }[] {
  const out: { trigger: string; area: Area }[] = [];
  const walk = (c: Condition, id: string): void => {
    if (c.on === 'unitsInArea') {
      if (c.player === 0) out.push({ trigger: id, area: c.area });
    } else if (c.on === 'all' || c.on === 'any') {
      for (const sub of c.of) walk(sub, id);
    } else if (c.on === 'not') {
      walk(c.of, id);
    }
  };
  for (const t of op.triggers) walk(t.when, t.id);
  return out;
}

/**
 * Tags the trigger table rewards the player for keeping alive: either killing
 * it fails an objective, or it has to be alive for one to complete.
 *
 * `entityAlive` in a trigger that FAILS an objective is deliberately not this —
 * that is a deadline ("the mast is still standing"), and it means the opposite.
 */
function protectedTags(op: OperationDef): Map<string, string> {
  const out = new Map<string, string>();
  const collect = (c: Condition, want: 'entityDead' | 'entityAlive', into: Set<string>): void => {
    if (c.on === want) into.add(c.tag);
    else if (c.on === 'all' || c.on === 'any') { for (const sub of c.of) collect(sub, want, into); }
    else if (c.on === 'not') collect(c.of, want, into);
  };
  for (const t of op.triggers) {
    if (t.then.some((e) => e.do === 'failObjective')) {
      const dead = new Set<string>();
      collect(t.when, 'entityDead', dead);
      for (const tag of dead) out.set(tag, `${t.id} fails an objective when '${tag}' dies`);
    }
    if (t.then.some((e) => e.do === 'completeObjective')) {
      const alive = new Set<string>();
      collect(t.when, 'entityAlive', alive);
      for (const tag of alive) out.set(tag, `${t.id} needs '${tag}' alive to complete an objective`);
    }
  }
  return out;
}

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);

describe('an objective zone cannot be a trap for another objective', () => {
  it('there is something to check, and it is not vacuous', () => {
    // Without this the file passes the day `unitsInArea` stops being used or a
    // walker stops matching — the failure `Systems.ts` records shipping once.
    expect(ALL.length).toBeGreaterThan(0);
    const zoned = ALL.filter((op) => playerZones(op).length > 0 && protectedTags(op).size > 0);
    expect(
      zoned.length,
      'no operation has both a player zone and a protected tag — the rule below cannot fire',
    ).toBeGreaterThan(0);
  });

  for (const op of ALL) {
    const zones = playerZones(op);
    const prot = protectedTags(op);
    if (zones.length === 0 || prot.size === 0) continue;

    describe(op.id, () => {
      const built = buildOperation(op);
      const gun = longestReach(op.faction);
      // Surface metres a parked, Aggressive hull will reach out and engage.
      const envelope = gun.range * APPROACH_STOP_FRAC + GUARD_LEASH;

      it(`no player zone reaches a protected tag (${gun.key} ${String(gun.range)} m -> `
        + `${envelope.toFixed(1)} m of surface)`, () => {
        const st = built.world.store;
        for (const z of zones) {
          for (const [tag, why] of prot) {
            for (const eid of built.tags.get(tag) ?? []) {
              const i = st.index(eid);
              if (i < 0) continue;
              // You cannot shoot your own, and Gaia is allied to everybody —
              // `allyMask` is self plus Gaia and nothing else.
              if (st.owner[i] === 0) continue;
              if (st.faction[i] === Faction.Neutral) continue;

              const d = Math.hypot(st.posX[i] - z.area.x, st.posZ[i] - z.area.z);
              // THE EXCEPTION. A disc that covers the thing is an arrival or a
              // hold ON it, which is what the objective asked for. See header.
              if (d <= z.area.r) continue;

              const hit = hitRadius(st.footprintW[i], st.footprintH[i], st.radius[i]);
              const need = z.area.r + envelope + hit;
              expect(
                d,
                `${op.id}: '${z.trigger}' asks the player to hold a disc of r=${String(z.area.r)} `
                + `whose centre is ${d.toFixed(1)} m from '${tag}', and ${why}. A unit at the near `
                + `edge is ${(d - z.area.r).toFixed(1)} m from it, ${(d - z.area.r - hit).toFixed(1)} m `
                + `of surface, against a ${envelope.toFixed(1)} m engagement envelope — so a hull `
                + 'parked on one objective auto-acquires the other, drives out of the zone to do '
                + `it, and the player loses a reward for collecting a reward. Move the disc to `
                + `>= ${need.toFixed(1)} m, or put the disc over the tag if standing on it is the `
                + 'point.',
              ).toBeGreaterThanOrEqual(need);
            }
          }
        }
      });
    });
  }
});
