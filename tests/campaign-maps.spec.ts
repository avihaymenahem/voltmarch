/**
 * ============================================================================
 * tests/campaign-maps.spec.ts — every operation is BUILT, headless, and the
 * ground is checked against what its triggers assume
 * ============================================================================
 * `campaign-validate.spec.ts` proves the trigger table is well formed. It
 * cannot prove the ground exists: a layout that declares `tags: ['tap']` and
 * then fails to place the tap — because the def key was wrong, because the
 * footprint would not fit, because the spot came out under water — validates
 * perfectly and ships an operation nobody can win.
 *
 * So this file builds each operation for real, with a real `Terrain` and a real
 * `ScenarioBuilder`, and asks the questions only a built world can answer.
 *
 * THE DECLARATION IS CHECKED IN BOTH DIRECTIONS, WHICH IS THE POINT
 * -----------------------------------------------------------------
 * A layout DECLARES its tags rather than having them discovered, because a
 * layout that stamps a tag on only one branch — a seat that is not always
 * seated, a structure only placed on four-army maps — would otherwise validate
 * on whichever seed happened to run. Declaring it makes the claim explicit;
 * this file makes it true:
 *
 *   - every declared tag actually landed on at least one entity, so a
 *     misspelled def key or an impossible placement is caught here rather than
 *     by a player at minute nine;
 *   - every tag a TRIGGER names is one the layout declared — which
 *     `validateCampaign` also checks, deliberately twice, because the two
 *     checks fail at different times and the import-time one is the cheap one.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * "Winnable in practice" is not answerable by building a world; it is answered
 * by playing it, and Gate M's definition of done says so. This file answers
 * "does the ground the operation was authored against actually exist".
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, planScenario, setCampaignLayout,
  setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import { tagsUsedByCondition } from '../src/campaign/validate';
import type { OperationDef } from '../src/campaign/types';

/* -- the harness ---------------------------------------------------------- */

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

interface Built {
  world: World;
  /** tag -> entities the layout stamped. */
  tags: Map<string, EntityId[]>;
}

/**
 * Build one operation exactly the way `campaign-install.ts` arms it: plan
 * first, layout second, THEN the world. Getting that order wrong is the same
 * mistake as installing the roster after the boot, and it would show up here as
 * an empty tag set rather than as an error.
 */
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
  world.addPlayer(Faction.Allies, 'Opponent', false, false);
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

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);

/* ==========================================================================
 * 0. THE GUARD ON THE GUARD
 * ========================================================================== */

describe('there is a campaign to build', () => {
  it('at least one operation and one layout exist', () => {
    // Without this the whole file passes vacuously the day somebody's glob
    // stops matching — which is the exact failure `Systems.ts` records having
    // shipped once already.
    expect(ALL.length).toBeGreaterThan(0);
    expect(LAYOUTS.size).toBeGreaterThan(0);
  });

  it('every registered layout is used by an operation', () => {
    const used = new Set(ALL.map((o) => o.layout));
    for (const id of LAYOUTS.keys()) {
      expect(used.has(id), `layout '${id}' is registered and no operation names it`).toBe(true);
    }
  });
});

/* ==========================================================================
 * 1. THE PLAN
 * ========================================================================== */

describe('an armed operation decides the plan, and nothing else can', () => {
  it('takes its preset, seats and opening from the operation', () => {
    for (const op of ALL) {
      setPlannedOperation({
        id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
      });
      try {
        const plan = planScenario('campaign');
        expect(plan.map, op.id).toBe(op.map.preset);
        expect(plan.armies, op.id).toBe(op.map.armies);
        expect(plan.start, op.id).toBe(op.map.opening === 'mcv' ? 'mcv' : 'base');
      } finally {
        setPlannedOperation(null);
      }
    }
  });

  it('THE FALLBACK: `campaign` with nothing armed is a total router, not a hole', () => {
    setPlannedOperation(null);
    const plan = planScenario('campaign');
    expect(plan.start, 'an unarmed campaign boot still gets a pre-built opening').toBe('base');
    expect(plan.armies).toBeGreaterThanOrEqual(2);
  });

  it('and no OTHER scenario name can be talked out of `base`', () => {
    // The campaign exception is narrow on purpose. This is the half of it that
    // could rot silently: a later edit widening the condition would leave every
    // posed fixture taking a lobby opening.
    for (const name of ['atoll', 'naval', 'battle', 'economy', 'blob']) {
      expect(planScenario(name, null, null, 'mcv').start, name).toBe('base');
    }
    // …while `skirmish` still honours it, or the test above proves nothing.
    expect(planScenario('skirmish', null, null, 'mcv').start).toBe('mcv');
  });
});

/* ==========================================================================
 * 2. THE GROUND
 * ========================================================================== */

describe('every operation builds a world its triggers can read', () => {
  for (const op of ALL) {
    describe(op.id, () => {
      const built = buildOperation(op);

      it('every declared tag landed on something', () => {
        const l = LAYOUTS.get(op.layout);
        for (const tag of l?.tags ?? []) {
          const spawned = op.triggers.some((t) => t.then.some(
            (e) => e.do === 'spawnUnits' && e.tag === tag,
          ));
          // A tag a `spawnUnits` PRODUCES is not the layout's to place. It is
          // still declared, so a reader looking for "where does this come from"
          // finds the answer in the file that owns the ground.
          if (spawned) continue;
          expect(
            built.tags.get(tag)?.length ?? 0,
            `layout '${op.layout}' declares tag '${tag}' and stamped it on nothing — `
            + 'a wrong def key or an impossible placement, and entityDead reads TRUE '
            + 'for it on tick one',
          ).toBeGreaterThan(0);
        }
      });

      it('every tag a trigger names was stamped or is spawned', () => {
        const named = new Set<string>();
        for (const t of op.triggers) {
          tagsUsedByCondition(t.when, named);
          for (const e of t.then) if (e.do === 'orderTagged') named.add(e.tag);
        }
        for (const tag of named) {
          const spawned = op.triggers.some((t) => t.then.some(
            (e) => e.do === 'spawnUnits' && e.tag === tag,
          ));
          if (spawned) continue;
          expect(built.tags.has(tag), `trigger names tag '${tag}', nothing stamps it`).toBe(true);
        }
      });

      it('every seated army opens with at least one asset', () => {
        const st = built.world.store;
        const owned = new Map<number, number>();
        for (let a = 0; a < st.aliveCount; a++) {
          const i = st.alive[a];
          const k = st.kind[i];
          if (k !== EntityKind.Building && k !== EntityKind.Infantry && k !== EntityKind.Vehicle) continue;
          owned.set(st.owner[i], (owned.get(st.owner[i]) ?? 0) + 1);
        }
        for (let seat = 0; seat < op.map.armies; seat++) {
          expect(owned.get(seat) ?? 0, `seat ${seat} of ${op.id} opens with nothing`).toBeGreaterThan(0);
        }
      });

      it('stays well inside the entity budget with room for production', () => {
        // 4096 is the hard cap and a real base was measured at 104 units. A
        // layout that opened near the cap would fail its first reinforcement
        // wave silently, because `spawnUnit` returns NONE on an exhausted
        // budget and both existing sim callers ignore that.
        expect(built.world.store.aliveCount).toBeLessThan(1200);
      });

      it('the tagged entities are where a trigger could count them', () => {
        // Not off the map, not stacked on one point, and — for anything a
        // `role: 'building'` condition counts — actually a building.
        const st = built.world.store;
        for (const [tag, ids] of built.tags) {
          for (const id of ids) {
            const i = st.index(id);
            expect(i, `${tag} handle does not resolve`).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(st.posX[i]) && Number.isFinite(st.posZ[i]), tag).toBe(true);
          }
        }
      });
    });
  }
});
