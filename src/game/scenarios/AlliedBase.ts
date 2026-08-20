/**
 * ============================================================================
 * VOLTMARCH — src/game/scenarios/AlliedBase.ts
 * ============================================================================
 * THE ALLIED BASE LAYOUT.
 *
 * A base is not a pile of buildings. Every RA screenshot that reads as a real
 * base obeys the same four rules, and this file is those rules made concrete:
 *
 *   1. The Construction Yard is the anchor and sits roughly central; everything
 *      else is inside its build radius.
 *   2. The Refinery faces the ore field and has a clear approach lane, because
 *      the harvester round trip is the thing the player watches most.
 *   3. The War Factory has open ground in front of its door. A factory boxed in
 *      by power plants is the single most common "this was placed by a script"
 *      tell.
 *   4. Defences sit on the THREAT AXIS in a line, not scattered — and there is
 *      a deliberate gate in the wall so the army can sortie.
 *
 * LOCAL COORDINATES
 * -----------------
 * Layouts are authored in a local frame where **-Z is the threat direction**
 * and +X is the ore side, then rotated by `facingDeg` and translated onto the
 * world. That is why one table can serve the wide base shot, the skirmish start
 * position and the placement fixture without any of them special-casing angles.
 *
 * ALLIED CHARACTER (bible §5.7)
 * -----------------------------
 * Chamfered, engineered, orthogonal. The Allied base reads as a laid-out
 * airfield: aligned rows, generous spacing, everything square to everything
 * else. The Soviets get the opposite treatment in SovietBase.ts.
 * ============================================================================
 */

import { OrderKind, Stance, UnitState } from '../../core/types';
import type { EntityId, PlayerId } from '../../core/types';
import { DEG2RAD } from '../../core/math';
import { AUTO_BASE_APRON_RADIUS } from '../../core/config';
import type { ScenarioBuilder } from '../Scenarios';

/* -------------------------------------------------------------------------- */
/* Layout tables                                                              */
/* -------------------------------------------------------------------------- */

/** One entry in a structure layout. `dx`/`dz` are local metres. */
export interface StructurePlacement {
  key: string;
  dx: number;
  dz: number;
  /** Extra facing on top of the base's own, degrees. */
  yawDeg?: number;
  /** Skip unless the caller asked for the full dressed base. */
  optional?: boolean;
  /** Do not claim PrimaryFactory (the second plant of a pair). */
  secondary?: boolean;
}

/**
 * The core: two rows with a lane between them. Production on the open -X side,
 * economy on the ore side (+X), the yard in the middle of the front row, power
 * and tech in the back row where nothing shoots at them.
 *
 * APRON BUDGET — the structural grid lives inside x ∈ [-40, +40],
 * z ∈ [-30, +24], including footprint half-extents. Its farthest corner is
 * inside `AUTO_BASE_APRON_RADIUS` (52 m), the exact clearing the road router
 * protects. The gaps are not slack: a base packed edge to edge renders as one
 * continuous mass, and the negative space is what makes it read as a base.
 *
 * Every row uses 12 or 24 m centres. That is deliberate footprint arithmetic:
 * a 3-cell production building gets 12 m of clear apron before the next one,
 * while a 2-cell support building gets 4 m. Older 9-11 m centres left model
 * pads almost touching and made a generated base read as one tangled mesh.
 */
const ALLIED_CORE: readonly StructurePlacement[] = [
  // Front row: three 12 m-wide anchors with a full 12 m apron between them.
  { key: 'warFactory', dx: -24, dz: -4 },
  { key: 'conyard', dx: 0, dz: -4 },
  { key: 'refinery', dx: 24, dz: -4 },

  // Silos hard against the ore side, clear of the harvester approach lane.
  { key: 'oreSilo', dx: 36, dz: 4 },
  { key: 'oreSilo', dx: 36, dz: 12 },

  /*
   * THE POWER COLUMN, and it is not decoration.
   *
   * The layout below draws −280 and the two back-row plants make +200, so a
   * skirmish used to START at −80: permanent brownout, radar offline, prism
   * tower dark, and a "LOW POWER" toast on the first frame of every match.
   * These two put the base at +120, which is the margin a player needs to add
   * one more building before they have to think about power.
   *
   * Mirrors the silo column on the far side, inside the apron budget above.
   */
  { key: 'powerPlant', dx: -36, dz: 4, secondary: true },
  { key: 'powerPlant', dx: -36, dz: 16, secondary: true },

  // Back row: 2x2 buildings on 12 m centres, leaving one whole cell between.
  { key: 'barracks', dx: -24, dz: 20 },
  { key: 'powerPlant', dx: -12, dz: 20 },
  { key: 'powerPlant', dx: 0, dz: 20, secondary: true },
  { key: 'radar', dx: 12, dz: 20, optional: true },
  { key: 'battleLab', dx: 24, dz: 20, optional: true },
];

/**
 * The defended face: a pillbox line with one refractor tower as the hard point, and
 * a wall behind it with a 20 m gate so the armour can actually sortie.
 */
const ALLIED_DEFENCE: readonly StructurePlacement[] = [
  { key: 'pillbox', dx: -24, dz: -20 },
  { key: 'pillbox', dx: -8, dz: -20 },
  { key: 'prismTower', dx: 8, dz: -20 },
  { key: 'pillbox', dx: 24, dz: -20 },
];

/** Wall segment centres along the threat face, leaving a 20 m gate at x ≈ -2. */
const ALLIED_WALL_X: readonly number[] = [-32, -28, -24, -20, 12, 16, 20, 24, 28, 32];
const ALLIED_WALL_Z = -28;

/* -------------------------------------------------------------------------- */

export interface BaseOptions {
  /**
   * Rotation of the whole layout, degrees. At 0 the local frame is the world
   * frame, so the defended face (local -Z) points at world -Z — the top of an
   * un-yawed shot. The threat axis therefore points at `facingDeg + 180`.
   */
  facingDeg?: number;
  /** Place radar/proving ground and the standing garrison. */
  garrison?: boolean;
  /** Include the wall + defence line. Default true. */
  defended?: boolean;
  /** Owner override. Defaults to the Allied player. */
  owner?: PlayerId;
}

/** Rotate a local offset into world space and hand back [x, z]. */
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
 * Snap an authored threat bearing to the same four facings the placement UI
 * supports. The occupancy grid stores axis-aligned rectangles; rotating a 3x2
 * factory to an arbitrary 37 degrees while keeping a rectangular claim is a
 * visual overlap waiting to happen. A generated base therefore chooses the
 * nearest legal quarter turn once and rotates its whole local grid as a unit.
 */
export function cardinalBaseFacing(facingDeg: number): number {
  const quarter = Math.round(facingDeg / 90);
  return ((quarter % 4) + 4) % 4 * 90;
}

/**
 * Build a full Allied base centred on (cx, cz).
 *
 * Returns the Construction Yard handle so a caller can hang a build radius, a
 * rally point or a placement ghost off it.
 */
export function buildAlliedBase(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  options: BaseOptions = {},
): EntityId {
  const owner = options.owner ?? b.allies;
  const yawDeg = cardinalBaseFacing(options.facingDeg ?? 0);
  const facing = yawDeg * DEG2RAD;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const garrison = options.garrison !== false;
  const defended = options.defended !== false;

  // Reserve the COMPOUND, not just each footprint. Scenario scatter otherwise
  // fills the legal negative space with trees and rocks and visually destroys
  // the grid this layout just established.
  b.block(cx, cz, AUTO_BASE_APRON_RADIUS);

  let conyard: EntityId = 0 as EntityId;

  for (const p of ALLIED_CORE) {
    if (p.optional === true && !garrison) continue;
    const [x, z] = toWorld(cx, cz, p.dx, p.dz, cos, sin);
    const id = b.spawnBuilding(p.key, owner, x, z, {
      yawDeg: yawDeg + (p.yawDeg ?? 0),
      secondary: p.secondary,
    });
    if (p.key === 'conyard') conyard = id;
  }

  if (defended) {
    for (const p of ALLIED_DEFENCE) {
      const [x, z] = toWorld(cx, cz, p.dx, p.dz, cos, sin);
      b.spawnBuilding(p.key, owner, x, z, { yawDeg });
    }
    for (const wx of ALLIED_WALL_X) {
      const [x, z] = toWorld(cx, cz, wx, ALLIED_WALL_Z, cos, sin);
      b.spawnBuilding('wall', owner, x, z, { yawDeg });
    }
  }

  if (garrison) buildAlliedGarrison(b, cx, cz, cos, sin, yawDeg, owner);

  // A base that has been running for ten minutes has spent money and taken a
  // few hits. A pristine full-HP base at exactly START_CREDITS reads as a test
  // fixture, which is precisely what we are trying not to look like.
  b.setCredits(owner, b.rng.range(3200, 6400));
  return conyard;
}

/**
 * The standing garrison: armour parked behind the defence line facing the
 * threat, infantry loitering by the barracks, a harvester working the field.
 */
function buildAlliedGarrison(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  cos: number,
  sin: number,
  yawDeg: number,
  owner: PlayerId,
): void {
  // Armour: a loose line in the muster ground between the yard and the wall,
  // guns pointing at the threat, sitting on the gate so the sortie reads.
  const [ax, az] = toWorld(cx, cz, -2, -36, cos, sin);
  b.formation('grizzly', owner, ax, az, 4, {
    yawDeg: yawDeg + 180,
    columns: 4,
    spacing: 8.0,
    state: UnitState.Guarding,
    stance: Stance.Defensive,
    veterancy: 1,
  });

  const [ix, iz] = toWorld(cx, cz, 20, -36, cos, sin);
  b.formation('ifv', owner, ix, iz, 2, {
    yawDeg: yawDeg + 195,
    columns: 2,
    spacing: 6.5,
    state: UnitState.Guarding,
  });

  // Infantry: a squad loitering outside the barracks door, not in a neat grid.
  const [gx, gz] = toWorld(cx, cz, -32, 10, cos, sin);
  b.formation('gi', owner, gx, gz, 5, {
    yawDeg: yawDeg + 150,
    columns: 3,
    spacing: 2.6,
    jitter: 0.7,
    state: UnitState.Guarding,
  });

  const [ex, ez] = toWorld(cx, cz, -18, 10, cos, sin);
  b.spawnUnit('engineer', owner, ex, ez, { yawDeg: yawDeg + 40 });

  // Economy in motion: one harvester docked at the refinery unloading, one
  // rolling out toward the ore on the +X side.
  const [dx, dz] = toWorld(cx, cz, 24, 7, cos, sin);
  b.spawnUnit('harvester', owner, dx, dz, {
    yawDeg: yawDeg + 90,
    state: UnitState.Docked,
    cargoFrac: 0.85,
  });

  const [hx, hz] = toWorld(cx, cz, 42, -10, cos, sin);
  const [ox, oz] = toWorld(cx, cz, 62, -6, cos, sin);
  b.spawnUnit('harvester', owner, hx, hz, {
    yawDeg: yawDeg + 100,
    state: UnitState.SeekOre,
    cargoFrac: 0.2,
    order: { kind: OrderKind.Harvest, x: ox, z: oz },
  });

  // Wear: burnt-out hulks outside the wall say a wave already came through.
  const [wx, wz] = toWorld(cx, cz, 4, -46, cos, sin);
  b.spawnWreck(wx, wz, b.world.player(owner).faction, false);
  const [w2x, w2z] = toWorld(cx, cz, -16, -48, cos, sin);
  b.spawnWreck(w2x, w2z, b.world.player(owner).faction, true);
}

/**
 * A compact Allied economy outpost — yard, one power plant, a refinery and its
 * silos. Used by the `economy` and `placement` fixtures, which need a credible
 * base without the 20 structures of a full one eating the frame.
 */
export function buildAlliedOutpost(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  options: BaseOptions = {},
): EntityId {
  const owner = options.owner ?? b.allies;
  const yawDeg = cardinalBaseFacing(options.facingDeg ?? 0);
  const facing = yawDeg * DEG2RAD;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);

  // Kept inside x ∈ [-18, +18], z ∈ [-11, +15] so it still reads whole at the
  // 36 m dolly the placement shot uses.
  const layout: readonly StructurePlacement[] = [
    { key: 'conyard', dx: -12, dz: 2 },
    { key: 'refinery', dx: 6, dz: 0 },
    { key: 'powerPlant', dx: -12, dz: 13 },
    { key: 'oreSilo', dx: 14, dz: 10 },
    { key: 'oreSilo', dx: 14, dz: 4 },
    { key: 'pillbox', dx: -2, dz: -10 },
  ];

  let conyard: EntityId = 0 as EntityId;
  for (const p of layout) {
    const [x, z] = toWorld(cx, cz, p.dx, p.dz, cos, sin);
    const id = b.spawnBuilding(p.key, owner, x, z, { yawDeg: yawDeg + (p.yawDeg ?? 0) });
    if (p.key === 'conyard') conyard = id;
  }
  return conyard;
}

/**
 * A mixed Allied battlegroup: the standard 12-unit push a player actually
 * sends. Used by `battle` and `blob`.
 *
 * `advanceDeg` is the direction the group is HEADING (0 = +Z, toward +X). The
 * local frame is rotated by `advanceDeg + 180` so that local -Z — where the
 * armour sits — comes out at the front of the advance. Getting that 180 wrong
 * puts the infantry between the tanks and the enemy, which is the single most
 * obvious "a script arranged this" tell in a combat screenshot.
 */
export function buildAlliedArmy(
  b: ScenarioBuilder,
  cx: number,
  cz: number,
  advanceDeg: number,
  scale = 1,
  options: { state?: UnitState; order?: { kind: OrderKind; x: number; z: number } } = {},
): number {
  const owner = b.allies;
  const common = {
    yawDeg: advanceDeg,
    state: options.state ?? UnitState.Idle,
    stance: Stance.Aggressive,
    order: options.order,
  };
  const rad = (advanceDeg + 180) * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (dx: number, dz: number): [number, number] => toWorld(cx, cz, dx, dz, cos, sin);

  let n = 0;
  // Armour leads, IFVs on the flank, refractor tanks and infantry behind — the
  // shape a real push has, and the shape that keeps 40 units readable because
  // the silhouette classes are grouped rather than shuffled.
  const [fx, fz] = at(0, -6);
  n += b.formation('grizzly', owner, fx, fz, Math.round(6 * scale), {
    ...common, columns: 4, spacing: 8.0, veterancy: 1,
  });
  const [lx, lz] = at(-18, 2);
  n += b.formation('ifv', owner, lx, lz, Math.round(3 * scale), {
    ...common, columns: 3, spacing: 7.0,
  });
  const [px, pz] = at(14, 5);
  n += b.formation('prismTank', owner, px, pz, Math.round(2 * scale), {
    ...common, columns: 2, spacing: 8,
  });
  const [gx, gz] = at(-2, 8);
  n += b.formation('gi', owner, gx, gz, Math.round(8 * scale), {
    ...common, columns: 4, spacing: 2.8, jitter: 0.6,
  });
  return n;
}
