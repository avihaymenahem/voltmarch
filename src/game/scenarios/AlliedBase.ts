/**
 * ============================================================================
 * RED ALERT — src/game/scenarios/AlliedBase.ts
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
 * FRAME BUDGET — the whole layout lives inside x ∈ [-32, +34], z ∈ [-22, +20],
 * which is the 33 x 21 m half-extent `layoutBudget(62, 24)` allows. The 8-10 m
 * gaps are not slack: a base packed edge to edge renders as one continuous
 * mass, and the negative space between buildings is what makes a screenshot
 * read as a base rather than as a wall.
 *
 * Every offset is on the 4 m cell grid.
 */
const ALLIED_CORE: readonly StructurePlacement[] = [
  // Front row, z ∈ [-8, +4]. 8 m lanes either side of the yard.
  { key: 'warFactory', dx: -20, dz: -2 },
  { key: 'conyard', dx: 0, dz: -2 },
  { key: 'refinery', dx: 20, dz: -2 },

  // Silos hard against the ore side, clear of the harvester approach lane.
  { key: 'oreSilo', dx: 29, dz: 3 },
  { key: 'oreSilo', dx: 29, dz: 9 },

  // Back row, z ∈ [+10, +18], on 11 m centres.
  { key: 'barracks', dx: -22, dz: 14 },
  { key: 'powerPlant', dx: -11, dz: 14 },
  { key: 'powerPlant', dx: 0, dz: 14, secondary: true },
  { key: 'radar', dx: 11, dz: 14, optional: true },
  { key: 'battleLab', dx: 22, dz: 14, optional: true },
];

/**
 * The defended face: a pillbox line with one prism tower as the hard point, and
 * a wall behind it with a 20 m gate so the armour can actually sortie.
 */
const ALLIED_DEFENCE: readonly StructurePlacement[] = [
  { key: 'pillbox', dx: -18, dz: -14 },
  { key: 'pillbox', dx: -6, dz: -16 },
  { key: 'prismTower', dx: 8, dz: -16 },
  { key: 'pillbox', dx: 20, dz: -14 },
];

/** Wall segment centres along the threat face, leaving a 20 m gate at x ≈ -2. */
const ALLIED_WALL_X: readonly number[] = [-28, -24, -20, -16, 8, 12, 16, 20, 24];
const ALLIED_WALL_Z = -20;

/* -------------------------------------------------------------------------- */

export interface BaseOptions {
  /**
   * Rotation of the whole layout, degrees. At 0 the local frame is the world
   * frame, so the defended face (local -Z) points at world -Z — the top of an
   * un-yawed shot. The threat axis therefore points at `facingDeg + 180`.
   */
  facingDeg?: number;
  /** Place radar/battle lab and the standing garrison. */
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
  const facing = (options.facingDeg ?? 0) * DEG2RAD;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const garrison = options.garrison !== false;
  const defended = options.defended !== false;
  const yawDeg = options.facingDeg ?? 0;

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
  const [ax, az] = toWorld(cx, cz, -2, -9, cos, sin);
  b.formation('grizzly', owner, ax, az, 4, {
    yawDeg: yawDeg + 180,
    columns: 4,
    spacing: 8.0,
    state: UnitState.Guarding,
    stance: Stance.Defensive,
    veterancy: 1,
  });

  const [ix, iz] = toWorld(cx, cz, 21, -9, cos, sin);
  b.formation('ifv', owner, ix, iz, 2, {
    yawDeg: yawDeg + 195,
    columns: 2,
    spacing: 6.5,
    state: UnitState.Guarding,
  });

  // Infantry: a squad loitering outside the barracks door, not in a neat grid.
  const [gx, gz] = toWorld(cx, cz, -26, 6, cos, sin);
  b.formation('gi', owner, gx, gz, 5, {
    yawDeg: yawDeg + 150,
    columns: 3,
    spacing: 2.6,
    jitter: 0.7,
    state: UnitState.Guarding,
  });

  const [ex, ez] = toWorld(cx, cz, -10, 7, cos, sin);
  b.spawnUnit('engineer', owner, ex, ez, { yawDeg: yawDeg + 40 });

  // Economy in motion: one harvester docked at the refinery unloading, one
  // rolling out toward the ore on the +X side.
  const [dx, dz] = toWorld(cx, cz, 20, 7, cos, sin);
  b.spawnUnit('harvester', owner, dx, dz, {
    yawDeg: yawDeg + 90,
    state: UnitState.Docked,
    cargoFrac: 0.85,
  });

  const [hx, hz] = toWorld(cx, cz, 36, -10, cos, sin);
  const [ox, oz] = toWorld(cx, cz, 56, -6, cos, sin);
  b.spawnUnit('harvester', owner, hx, hz, {
    yawDeg: yawDeg + 100,
    state: UnitState.SeekOre,
    cargoFrac: 0.2,
    order: { kind: OrderKind.Harvest, x: ox, z: oz },
  });

  // Wear: burnt-out hulks outside the wall say a wave already came through.
  const [wx, wz] = toWorld(cx, cz, 2, -25, cos, sin);
  b.spawnWreck(wx, wz, b.world.player(owner).faction, false);
  const [w2x, w2z] = toWorld(cx, cz, -14, -27, cos, sin);
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
  const facing = (options.facingDeg ?? 0) * DEG2RAD;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const yawDeg = options.facingDeg ?? 0;

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
  // Armour leads, IFVs on the flank, prism tanks and infantry behind — the
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
