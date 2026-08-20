/**
 * Procedural opening bases must be layouts on the build grid, not photographs
 * approximated in metres. These checks own the two regressions visible in the
 * title backdrop: rectangular buildings retaining an unrotated claim, and
 * dense authored rows spilling beyond the apron reserved from the road router.
 */

import { describe, expect, it } from 'vitest';

import { ScenarioBuilder } from '../src/game/Scenarios';
import { buildAlliedBase } from '../src/game/scenarios/AlliedBase';
import { buildSovietBase } from '../src/game/scenarios/SovietBase';
import {
  AUTO_BASE_APRON_RADIUS, CELL, PLACEMENT, placementPadWeight,
} from '../src/core/config';
import { footprintOriginCell } from '../src/core/math';
import { EntityKind, Faction } from '../src/core/types';
import { PerEntityObj, World } from '../src/core/world';

const NO_DEFS = { tables: null, unitId: {}, buildingId: {} } as const;

function rig(faction: Faction): { world: World; b: ScenarioBuilder; keys: PerEntityObj<string> } {
  const world = new World();
  world.addPlayer(faction, 'Commander', true, true);
  world.addPlayer(faction === Faction.Soviets ? Faction.Allies : Faction.Soviets, 'Opponent', false, false);
  const keys = new PerEntityObj<string>(world.store);
  return { world, keys, b: new ScenarioBuilder(world, NO_DEFS, keys, 77, 'temperate') };
}

function buildingSlots(world: World): number[] {
  const st = world.store;
  const out: number[] = [];
  for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) out.push(st.byKind[EntityKind.Building][a]);
  return out;
}

function expectGridHonest(world: World, anchorX: number, anchorZ: number): void {
  const st = world.store;
  const origin = new Int32Array(2);
  const claimed = new Set<string>();
  for (const i of buildingSlots(world)) {
    const w = st.footprintW[i];
    const h = st.footprintH[i];
    footprintOriginCell(st.posX[i], st.posZ[i], w, h, origin);
    expect(st.posX[i]).toBeCloseTo((origin[0] + w * 0.5) * CELL, 6);
    expect(st.posZ[i]).toBeCloseTo((origin[1] + h * 0.5) * CELL, 6);
    // Base builders may only emit the four facings the occupancy grid can
    // represent. This catches the former +/-3..8 degree Soviet scatter.
    expect(st.yaw[i] / (Math.PI * 0.5)).toBeCloseTo(Math.round(st.yaw[i] / (Math.PI * 0.5)), 6);

    for (let z = origin[1]; z < origin[1] + h; z++) {
      for (let x = origin[0]; x < origin[0] + w; x++) {
        const key = `${x},${z}`;
        expect(claimed.has(key), `two buildings claim build cell ${key}`).toBe(false);
        claimed.add(key);
      }
    }

    // Test the footprint's farthest world-space corner, not just its centre.
    const farX = Math.abs(st.posX[i] - anchorX) + w * CELL * 0.5;
    const farZ = Math.abs(st.posZ[i] - anchorZ) + h * CELL * 0.5;
    expect(Math.hypot(farX, farZ)).toBeLessThanOrEqual(AUTO_BASE_APRON_RADIUS + 0.01);
  }
}

describe('procedural base grid', () => {
  it('cardinalises and spaces the Allied campus inside its road-free apron', () => {
    const { world, b } = rig(Faction.Allies);
    buildAlliedBase(b, 256, 256, { owner: b.allies, facingDeg: 37, garrison: false });
    expectGridHonest(world, 256, 256);
    expect(b.scatter({ minX: 190, minZ: 190, maxX: 322, maxZ: 322 }, 80, ['tree']))
      .toBeGreaterThan(0);
    const st = world.store;
    for (let a = 0; a < st.byKindCount[EntityKind.Prop]; a++) {
      const i = st.byKind[EntityKind.Prop][a];
      expect(Math.hypot(st.posX[i] - 256, st.posZ[i] - 256)).toBeGreaterThan(AUTO_BASE_APRON_RADIUS);
    }
  });

  it('keeps the Soviet industrial identity without breaking the grid', () => {
    const { world, b } = rig(Faction.Soviets);
    buildSovietBase(b, 256, 256, { owner: b.allies, facingDeg: 121, garrison: false });
    expectGridHonest(world, 256, 256);
  });

  it('swaps rectangular scenario footprints at a quarter turn', () => {
    const { world, b, keys } = rig(Faction.Allies);
    buildAlliedBase(b, 256, 256, { owner: b.allies, facingDeg: 90, garrison: false, defended: false });
    const st = world.store;
    const rectangular = buildingSlots(world).filter((i) => {
      const k = keys.get(st.handleOf(i));
      return k === 'warFactory' || k === 'refinery';
    });
    expect(rectangular.length).toBe(2);
    for (const i of rectangular) expect([st.footprintW[i], st.footprintH[i]]).toEqual([2, 3]);
  });

  it('batches the same concrete foundations used by player placement', () => {
    const { world, b, keys } = rig(Faction.Allies);
    const stamps: Array<[number, number, number, number]> = [];
    let commits = 0;
    const terrain = world.terrain as unknown as {
      stampSurface(cx: number, cz: number, layer: number, weight: number): void;
      commitSplat(): void;
    };
    terrain.stampSurface = (cx, cz, layer, weight): void => { stamps.push([cx, cz, layer, weight]); };
    terrain.commitSplat = (): void => { commits++; };

    buildAlliedBase(b, 256, 256, {
      owner: b.allies, facingDeg: 90, garrison: false, defended: false,
    });
    expect(stamps.length).toBeGreaterThan(0);
    expect(commits, 'the layout must not upload once per building').toBe(0);
    b.commitSurfaceStamps();
    expect(commits).toBe(1);
    b.commitSurfaceStamps();
    expect(commits, 'a clean batch is a no-op').toBe(1);

    const st = world.store;
    const factory = buildingSlots(world).find((i) => keys.get(st.handleOf(i)) === 'warFactory');
    expect(factory).toBeDefined();
    const origin = new Int32Array(2);
    footprintOriginCell(
      st.posX[factory!], st.posZ[factory!], st.footprintW[factory!], st.footprintH[factory!], origin,
    );
    expect(stamps).toContainEqual([origin[0], origin[1], PLACEMENT.padSurface, PLACEMENT.padWeight]);
    expect(stamps).toContainEqual([
      origin[0] - PLACEMENT.padMarginCells,
      origin[1],
      PLACEMENT.padSurface,
      placementPadWeight(
        origin[0] - PLACEMENT.padMarginCells, origin[1],
        origin[0], origin[1], st.footprintW[factory!], st.footprintH[factory!],
      ),
    ]);
    expect(placementPadWeight(
      origin[0] - PLACEMENT.padMarginCells,
      origin[1] - PLACEMENT.padMarginCells,
      origin[0], origin[1], st.footprintW[factory!], st.footprintH[factory!],
    ), 'pad corners must remain natural ground').toBe(0);
  });
});
