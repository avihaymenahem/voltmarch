/**
 * ============================================================================
 * tests/campaign-spawn-ground.spec.ts — a scripted reinforcement may not be put
 * down on ground its own locomotor cannot cross
 * ============================================================================
 * `allies.03.ground-truth` justified its reinforcement point with *"8 of 12
 * samples on an 18 m ring around it are free, which is the number that
 * matters"*. The sample reproduced exactly and described nothing the engine
 * does: `EffectSink.spawnUnits` puts unit `i` of `count` at
 * `angle = i / count * 2pi`, radius `spread`, so that operation's four calls
 * used rings of 20, 14, 22 and 15 m at four, two, five and three FIXED
 * bearings — never 18 m and never twelve samples. Five of its fourteen drops
 * landed on a ridge no Meridian hull can enter.
 *
 * WHY THIS IS A TEST AND NOT A FIX
 * --------------------------------
 * The mistake is not arithmetic, it is that the ring is INVISIBLE from the
 * files an author writes. A layout exports a `Point`; an operation names it and
 * a `spread`; the ring that decides where fourteen hulls actually stand exists
 * only inside `runtime.ts`. Every author who has reasoned about a spawn point
 * has reasoned about a disc, a radius, or a sample — never about the four to
 * six bearings the code really uses. So the same defect is available to every
 * `spawnUnits` in the campaign, which is exactly the shape
 * `campaign-zone-safety.spec.ts` was written for: a general rule, derived from
 * the engine's own constants, that fails by name.
 *
 * IT IS NOT FATAL, AND THAT IS WHY NOTHING ELSE CATCHES IT
 * -------------------------------------------------------
 * `ProductionService.spawnUnit` writes the position verbatim — no
 * `connectedGround`, no `findEgressSpot`, no search of any kind — and then
 * `Movement` skips its wall slide when the cell a unit is STANDING IN is
 * already closed, naming *"a spawn lands on a cliff"* as the case it exists
 * for, with `Steering`'s pocket rescue as the nine-second backstop. So a
 * wedged wave walks out and every existing gate stays green while a third of a
 * relief force starts the fight unwedging itself. A silent tax on the clock is
 * precisely the failure a test has to catch, because playing it does not.
 *
 * THE RING IS READ OUT OF `runtime.ts`, NOT RE-DERIVED
 * ---------------------------------------------------
 * A test that re-implements a formula from memory pins the formula the test
 * author believed in, which is the defect above wearing the other hat. Case 0
 * below source-gates the three lines that place a spawn, so changing the ring
 * in `runtime.ts` fails HERE with a message saying to update the mirror rather
 * than silently leaving every operation measured against a ring the code no
 * longer uses.
 *
 * THE LOCOMOTOR IS THE WAVE'S OWN
 * -------------------------------
 * `spawnUnit` writes `def?.locomotor ?? fb.locomotor` and then DECLARES the
 * move class: `waterOnly` is `MoveClass.Naval`, `amphibious` is
 * `MoveClass.Hover` — an amphibious foot unit is NOT `MoveClass.Foot`, and
 * `passGrid` has a different bit for each. Asking the grid about the wrong one
 * answers a different question in both directions: a hover wave would fail on
 * water it can cross, and a foot wave would pass on water it cannot.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * It is a placement check, not a playthrough. It says nothing about whether the
 * wave can REACH anything — a fully passable ring inside a sealed pocket passes
 * this and is still wrong — and nothing about crowding, since `spawnUnit` does
 * not separate a wave either. It checks the one thing that is decidable from
 * the built world: every hull is put down on ground it is allowed to occupy.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { Faction, NONE } from '../src/core/types';
import type { EntityId, ITerrain, Locomotor } from '../src/core/types';
import { cellToWorld, clampWorld, isInMap, worldToCell } from '../src/core/math';
import {
  FALLBACK_UNITS, MAP_SEAS, buildScenario, clearScenario, resolveDefBinding, setCampaignLayout,
  setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import { ProductionCatalog } from '../src/sim/Production';
import {
  MOVE_CLASS_NAMES, MoveClass, locomotorForMoveClass, moveClassForLocomotor,
} from '../src/sim/Flowfield';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import type { OperationDef, Point } from '../src/campaign/types';

const ROOT = process.cwd();

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

/** Rings of cells searched when reporting how far the nearest free ground is. */
const SEARCH_RINGS = 24;

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
    // Only THREE resources; `passGrid`, `buildGrid` and `occupant` survive it,
    // which is what makes the questions below answerable after the build.
    terrain.dispose?.();
  }
  return { world, tags };
}

/**
 * THE MIRROR OF `EffectSink.spawnUnits`, AND CASE 0 IS WHAT KEEPS IT ONE.
 *
 * `clampWorld(_, 2)` is applied because `ProductionService.spawnUnit` applies
 * it before it writes the position — so on a wave authored near the map edge
 * the ring point and the landed point are different numbers, and the landed one
 * is the only one a unit ever stands on.
 */
function ringPoint(at: Point, count: number, spread: number, i: number): Point {
  const angle = (i / Math.max(1, count)) * Math.PI * 2;
  return {
    x: clampWorld(at.x + Math.cos(angle) * spread, 2),
    z: clampWorld(at.z + Math.sin(angle) * spread, 2),
  };
}

/**
 * The locomotor `passGrid` is asked about for one authored unit key, resolved
 * through the same three tables `spawnUnit` reads: the catalog for the entry,
 * the bound `DefTables` for the def, `FALLBACK_UNITS` for what the def leaves
 * unset.
 */
function locomotorOf(
  catalog: ProductionCatalog, units: readonly { locomotor: number }[], key: string,
): { loco: Locomotor; cls: MoveClass } | null {
  const entry = catalog.byKey(key);
  if (entry === null) return null;
  const fb = FALLBACK_UNITS[entry.key];
  if (fb === undefined) return null;
  const def = entry.defId >= 0 ? units[entry.defId] : undefined;
  const raw = def?.locomotor ?? fb.locomotor;
  // DECLARED, NOT DERIVED — `spawnUnit` calls `setMoveClass` for these two and
  // the grid bit follows the CLASS, not the def's own locomotor.
  const cls = entry.waterOnly
    ? MoveClass.Naval
    : entry.amphibious ? MoveClass.Hover : moveClassForLocomotor(raw);
  return { loco: locomotorForMoveClass(cls), cls };
}

/** Metres to the nearest cell this locomotor may enter. Infinity if none near. */
function nearestFree(terrain: ITerrain, x: number, z: number, loco: Locomotor): number {
  const cx0 = worldToCell(x);
  const cz0 = worldToCell(z);
  let best = Infinity;
  for (let ring = 1; ring <= SEARCH_RINGS; ring++) {
    for (let oz = -ring; oz <= ring; oz++) {
      for (let ox = -ring; ox <= ring; ox++) {
        if (Math.abs(ox) !== ring && Math.abs(oz) !== ring) continue;
        const cx = cx0 + ox;
        const cz = cz0 + oz;
        if (!isInMap(cx, cz)) continue;
        if (!terrain.isPassable(cx, cz, loco)) continue;
        const dx = cellToWorld(cx) - x;
        const dz = cellToWorld(cz) - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < best) best = d;
      }
    }
    // A Chebyshev ring is not a circle: the nearest cell by EUCLIDEAN distance
    // can sit one ring further out than the first hit. Scan one more, then stop.
    if (best < Infinity && ring > 1) break;
  }
  return best;
}

interface Wave {
  readonly trigger: string;
  readonly key: string;
  readonly player: number;
  readonly count: number;
  readonly at: Point;
  readonly spread: number;
}

function wavesOf(op: OperationDef): Wave[] {
  const out: Wave[] = [];
  for (const t of op.triggers) {
    for (const e of t.then) {
      if (e.do !== 'spawnUnits') continue;
      out.push({
        trigger: t.id,
        key: e.key,
        player: e.player,
        count: e.count,
        at: e.at,
        spread: e.spread ?? 0,
      });
    }
  }
  return out;
}

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);
const WITH_WAVES = ALL.filter((op) => wavesOf(op).length > 0);

/* ==========================================================================
 * 0. THE MIRROR IS THE CODE'S, OR THIS FILE MEASURES A RING NOBODY USES
 * ========================================================================== */

describe('the ring this file checks is the ring `EffectSink.spawnUnits` places on', () => {
  const src = readFileSync(join(ROOT, 'src/campaign/runtime.ts'), 'utf8');

  it('places unit `i` at `i / count * 2pi`, radius `spread`', () => {
    const note = ' — `ringPoint` in this file mirrors it, and a mirror nobody checks is how the '
      + 'A3 defect (a measured 18 m ring the code never used) shipped in the first place. '
      + 'Update `ringPoint` and this case together.';
    expect(src, `runtime.ts no longer takes the angle that way${note}`)
      .toMatch(/const angle = \(i \/ Math\.max\(1, count\)\) \* Math\.PI \* 2;/);
    expect(src, `runtime.ts no longer takes x off that angle${note}`)
      .toMatch(/const x = at\.x \+ Math\.cos\(angle\) \* spread;/);
    expect(src, `runtime.ts no longer takes z off that angle${note}`)
      .toMatch(/const z = at\.z \+ Math\.sin\(angle\) \* spread;/);
  });

  it('and hands that point to `spawnUnit` unsearched', () => {
    // The whole reason a bad ring costs anything: nothing between the formula
    // and the store looks at the ground. If a search is ever added, this file's
    // failures stop being real and the case below has to be re-argued.
    expect(
      src,
      'a `spawnUnits` that searched for standable ground would make this whole file moot',
    ).toMatch(/const id = svc\.spawnUnit\(p, entry, x, z, facingDeg\);/);
  });

  it('there is something to check, and it is not vacuous', () => {
    expect(ALL.length).toBeGreaterThan(0);
    expect(
      WITH_WAVES.length,
      'no operation calls `spawnUnits` — the rule below cannot fire',
    ).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 1. THE GROUND UNDER EVERY DROP
 * ========================================================================== */

describe('every scripted drop lands on ground its own locomotor can cross', () => {
  const bindingPromise = resolveDefBinding();

  for (const op of WITH_WAVES) {
    describe(op.id, () => {
      const built = buildOperation(op);

      it('no unit in any wave is put down on a closed cell', async () => {
        const binding = await bindingPromise;
        const catalog = new ProductionCatalog(binding);
        expect(catalog.bound, 'the catalog must be bound to the real def tables').toBe(true);
        // `DefBinding.tables` is nullable and a null one is the empty binding —
        // which would resolve every key off `FALLBACK_UNITS` alone and quietly
        // measure a different game. `catalog.bound` above is the same claim
        // from the catalog's side; this is the one the compiler can see.
        const units = binding.tables?.units ?? null;
        expect(units, 'no bound def tables — every locomotor below would be a fallback').not.toBeNull();
        if (units === null) return;
        const terrain = built.world.terrain;
        const faults: string[] = [];

        for (const w of wavesOf(op)) {
          const loc = locomotorOf(catalog, units, w.key);
          expect(
            loc,
            `${op.id}: '${w.trigger}' spawns '${w.key}', which resolves to no catalog entry or no `
            + 'fallback row — the wave arrives empty and `campaign-maps` is the file that says so',
          ).not.toBeNull();
          if (loc === null) continue;

          // A wave with no spread stacks every hull on one point, so one report
          // is the whole finding rather than `count` copies of it.
          const points = w.spread === 0 ? 1 : w.count;
          for (let i = 0; i < points; i++) {
            const p = ringPoint(w.at, w.count, w.spread, i);
            const cx = worldToCell(p.x);
            const cz = worldToCell(p.z);
            if (terrain.isPassable(cx, cz, loc.loco)) continue;
            const free = nearestFree(terrain, p.x, p.z, loc.loco);
            const why = terrain.isWater(cx, cz)
              ? 'water'
              : terrain.isOccupied(cx, cz) ? 'occupied by a structure' : 'rock — slope or relief';
            faults.push(
              `${w.trigger}: '${w.key}' x${String(w.count)} on seat ${String(w.player)}, ring `
              + `r=${w.spread.toFixed(0)} m about (${w.at.x.toFixed(1)}, ${w.at.z.toFixed(1)}), `
              + `unit ${String(i)} of ${String(w.count)} at bearing `
              + `${((i / Math.max(1, w.count)) * 360).toFixed(1)} deg lands on `
              + `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) = cell (${String(cx)}, ${String(cz)}), `
              + `which move class '${MOVE_CLASS_NAMES[loc.cls]}' cannot enter: ${why}. `
              + 'Nearest free cell '
              + `${Number.isFinite(free) ? `${free.toFixed(1)} m` : `>${String(SEARCH_RINGS * 4)} m`}`
              + ' away.',
            );
          }
        }

        expect(
          faults.join('\n  '),
          `${op.id}: ${String(faults.length)} scripted drop(s) land on ground the wave's own `
          + 'locomotor cannot enter. `ProductionService.spawnUnit` writes the position verbatim, '
          + 'so each of these hulls starts the fight inside a closed cell and has to be unwedged '
          + "by `Movement`'s cliff branch and `Steering`'s pocket rescue before it can move. Move "
          + 'the SPAWN POINT — the ring radii are authored to the wave sizes — and re-derive every '
          + 'distance the layout header quotes off it.\n  ',
        ).toBe('');
      });
    });
  }
});
