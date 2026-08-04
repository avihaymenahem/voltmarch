/**
 * ============================================================================
 * VOLTMARCH — src/game/scenarios/SovietBase.ts
 * ============================================================================
 * THE SOVIET BASE LAYOUT.
 *
 * Same four base-composition rules as the Allied layout (yard anchors, refinery
 * faces the ore, factory has egress, defences on the threat axis) — deliberately
 * expressed with the opposite personality, because the faction read has to
 * survive even when both sides are drawn as grey placeholder boxes:
 *
 *   - **Denser.** Structures sit 3-4 m closer together. A Soviet base looks
 *     crammed; an Allied base looks laid out.
 *   - **Deeper defence.** Three tesla coils on the line plus two flame towers
 *     behind them, rather than one hard point.
 *   - **Off-axis.** Every structure carries a few degrees of its own rotation.
 *     Allied buildings are square to each other; Soviet ones are not.
 *   - **More power.** Three reactors, because tesla coils are the most
 *     power-hungry thing either side fields, and the extra stacks are half the
 *     Soviet skyline.
 *
 * Local frame is identical to AlliedBase.ts: **-Z is the threat direction**,
 * +X is the ore side, rotated by `facingDeg` onto the world.
 * ============================================================================
 */

import { NONE, OrderKind, Stance, UnitState } from '../../core/types';
import type { EntityId, PlayerId } from '../../core/types';
import { DEG2RAD } from '../../core/math';
import type { ScenarioBuilder } from '../Scenarios';
import type { BaseOptions, StructurePlacement } from './AlliedBase';

/* -------------------------------------------------------------------------- */

/**
 * Ore on the -X side this time, so a Soviet base mirrored against an Allied one
 * across the map still has both refineries facing the contested middle.
 */
const SOVIET_CORE: readonly StructurePlacement[] = [
  // Front row. Ore is on -X so a mirrored pair of bases both face the middle.
  { key: 'refinery', dx: -20, dz: -2, yawDeg: 2 },
  { key: 'conyard', dx: 0, dz: -2, yawDeg: -3 },
  { key: 'warFactory', dx: 20, dz: -2, yawDeg: 4 },

  { key: 'oreSilo', dx: -29, dz: 3 },
  { key: 'oreSilo', dx: -29, dz: 9 },

  /*
   * THE REACTOR COLUMN. The Soviet layout is the expensive one — three Tesla
   * Coils alone are −225 — and the whole base drew −495 against the three
   * back-row reactors' +300. A Soviet skirmish started at −195: every Tesla
   * Coil dark, radar offline, on the first frame. Three more reactors put it
   * at +105. Symmetric with the silo column on −X, inside the same budget.
   */
  { key: 'powerPlant', dx: 29, dz: 3, secondary: true, yawDeg: -5 },
  { key: 'powerPlant', dx: 29, dz: 9, secondary: true, yawDeg: 4 },
  { key: 'powerPlant', dx: 29, dz: 15, secondary: true, yawDeg: -3 },

  // Back row — 9 m centres instead of the Allied 11, and three reactors
  // because the tesla line is expensive. The extra stacks ARE the skyline.
  { key: 'barracks', dx: 22, dz: 13, yawDeg: -6 },
  { key: 'powerPlant', dx: 12, dz: 14, yawDeg: 5 },
  { key: 'powerPlant', dx: 3, dz: 13, secondary: true, yawDeg: -4 },
  { key: 'powerPlant', dx: -6, dz: 14, secondary: true, yawDeg: 7 },
  { key: 'radar', dx: -16, dz: 13, optional: true, yawDeg: -8 },
  { key: 'battleLab', dx: -25, dz: 14, optional: true, yawDeg: 6 },
];

/** Tesla on the line, flame towers as the second layer behind the gate. */
const SOVIET_DEFENCE: readonly StructurePlacement[] = [
  { key: 'teslaCoil', dx: -16, dz: -14 },
  { key: 'teslaCoil', dx: 0, dz: -16 },
  { key: 'teslaCoil', dx: 18, dz: -14 },
  { key: 'flameTower', dx: -8, dz: -9 },
  { key: 'flameTower', dx: 10, dz: -9 },
];

const SOVIET_WALL_X: readonly number[] = [-28, -24, -20, -16, 8, 12, 16, 20, 24];
const SOVIET_WALL_Z = -20;

/* -------------------------------------------------------------------------- */

function toWorld(
  cx: number,
  cz: number,
  dx: number,
  dz: number,
  cos: number,
  sin: number,
): [number, number] {
  return [cx + dx * cos + dz * sin, cz - dx * sin + dz * cos];
}

/**
 * Build a full Soviet base centred on (cx, cz). Returns the Construction Yard.
 */
export function buildSovietBase(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  options: BaseOptions = {},
): EntityId {
  const owner = options.owner ?? b.soviets;
  const facing = (options.facingDeg ?? 0) * DEG2RAD;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const garrison = options.garrison !== false;
  const defended = options.defended !== false;
  const yawDeg = options.facingDeg ?? 0;

  let conyard: EntityId = NONE;

  for (const p of SOVIET_CORE) {
    if (p.optional === true && !garrison) continue;
    const [x, z] = toWorld(cx, cz, p.dx, p.dz, cos, sin);
    const id = b.spawnBuilding(p.key, owner, x, z, {
      yawDeg: yawDeg + (p.yawDeg ?? 0),
      secondary: p.secondary,
    });
    if (p.key === 'conyard') conyard = id;
  }

  if (defended) {
    for (const p of SOVIET_DEFENCE) {
      const [x, z] = toWorld(cx, cz, p.dx, p.dz, cos, sin);
      b.spawnBuilding(p.key, owner, x, z, { yawDeg });
    }
    for (const wx of SOVIET_WALL_X) {
      const [x, z] = toWorld(cx, cz, wx, SOVIET_WALL_Z, cos, sin);
      b.spawnBuilding('wall', owner, x, z, { yawDeg });
    }
  }

  if (garrison) buildSovietGarrison(b, cx, cz, cos, sin, yawDeg, owner);

  b.setCredits(owner, b.rng.range(2800, 5800));
  return conyard;
}

/**
 * Soviet doctrine parks its armour in a block, not a line: massed, close,
 * pointed at the threat, with conscripts filling the gaps and dogs on the flank.
 */
function buildSovietGarrison(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  cos: number,
  sin: number,
  yawDeg: number,
  owner: PlayerId,
): void {
  const [rx, rz] = toWorld(cx, cz, 0, -9, cos, sin);
  b.formation('rhino', owner, rx, rz, 5, {
    yawDeg: yawDeg + 180,
    columns: 3,
    spacing: 7.5,
    state: UnitState.Guarding,
    stance: Stance.Defensive,
    veterancy: 1,
  });

  const [ax, az] = toWorld(cx, cz, 19, -9, cos, sin);
  b.spawnUnit('apocalypse', owner, ax, az, {
    yawDeg: yawDeg + 172,
    state: UnitState.Guarding,
    stance: Stance.Defensive,
    veterancy: 2,
  });

  const [c1x, c1z] = toWorld(cx, cz, 28, 6, cos, sin);
  b.formation('conscript', owner, c1x, c1z, 6, {
    yawDeg: yawDeg + 200,
    columns: 3,
    spacing: 2.4,
    jitter: 0.6,
    state: UnitState.Guarding,
  });

  const [dgx, dgz] = toWorld(cx, cz, -12, -9, cos, sin);
  b.formation('attackDog', owner, dgx, dgz, 2, {
    yawDeg: yawDeg + 165,
    columns: 2,
    spacing: 3.2,
    state: UnitState.Guarding,
  });

  // Economy: one harvester docked, one out on the ore run to -X.
  const [dx, dz] = toWorld(cx, cz, -20, 7, cos, sin);
  b.spawnUnit('harvester', owner, dx, dz, {
    yawDeg: yawDeg - 90,
    state: UnitState.Docked,
    cargoFrac: 0.7,
  });

  const [hx, hz] = toWorld(cx, cz, -36, -10, cos, sin);
  const [ox, oz] = toWorld(cx, cz, -56, -6, cos, sin);
  b.spawnUnit('harvester', owner, hx, hz, {
    yawDeg: yawDeg - 100,
    state: UnitState.ReturnToRefinery,
    cargoFrac: 1.0,
    order: { kind: OrderKind.Harvest, x: ox, z: oz },
  });

  const [wx, wz] = toWorld(cx, cz, -4, -26, cos, sin);
  b.spawnWreck(wx, wz, b.world.player(owner).faction, true);
}

/**
 * A compact Soviet forward position — yard, reactor, refinery, two coils.
 * The counterpart to `buildAlliedOutpost`.
 */
export function buildSovietOutpost(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  options: BaseOptions = {},
): EntityId {
  const owner = options.owner ?? b.soviets;
  const facing = (options.facingDeg ?? 0) * DEG2RAD;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const yawDeg = options.facingDeg ?? 0;

  const layout: readonly StructurePlacement[] = [
    { key: 'conyard', dx: 12, dz: 2, yawDeg: -4 },
    { key: 'refinery', dx: -6, dz: 0, yawDeg: 3 },
    { key: 'powerPlant', dx: 12, dz: 13, yawDeg: 5 },
    { key: 'oreSilo', dx: -14, dz: 9 },
    { key: 'teslaCoil', dx: 2, dz: -10 },
  ];

  let conyard: EntityId = NONE;
  for (const p of layout) {
    const [x, z] = toWorld(cx, cz, p.dx, p.dz, cos, sin);
    const id = b.spawnBuilding(p.key, owner, x, z, { yawDeg: yawDeg + (p.yawDeg ?? 0) });
    if (p.key === 'conyard') conyard = id;
  }
  return conyard;
}

/**
 * A mixed Soviet battlegroup. Heavier and shorter-ranged than the Allied one,
 * so in `battle` the two forces close rather than trade at range.
 */
export function buildSovietArmy(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  advanceDeg: number,
  scale = 1,
  options: { state?: UnitState; order?: { kind: OrderKind; x: number; z: number } } = {},
): number {
  const owner = b.soviets;
  const common = {
    yawDeg: advanceDeg,
    state: options.state ?? UnitState.Idle,
    stance: Stance.Aggressive,
    order: options.order,
  };
  // Same +180 convention as buildAlliedArmy: local -Z is the head of the column.
  const rad = (advanceDeg + 180) * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (dx: number, dz: number): [number, number] => toWorld(cx, cz, dx, dz, cos, sin);

  let n = 0;
  const [fx, fz] = at(0, -5);
  n += b.formation('rhino', owner, fx, fz, Math.round(6 * scale), {
    ...common, columns: 3, spacing: 7.5, veterancy: 1,
  });
  const [apx, apz] = at(13, 3);
  n += b.formation('apocalypse', owner, apx, apz, Math.max(1, Math.round(2 * scale)), {
    ...common, columns: 2, spacing: 10, veterancy: 2,
  });
  const [cx2, cz2] = at(-14, 6);
  n += b.formation('conscript', owner, cx2, cz2, Math.round(9 * scale), {
    ...common, columns: 5, spacing: 2.5, jitter: 0.6,
  });
  const [dx2, dz2] = at(-20, -2);
  n += b.formation('attackDog', owner, dx2, dz2, Math.round(2 * scale), {
    ...common, columns: 2, spacing: 3.4,
  });
  return n;
}
