/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-deep-sector.ts
 * ============================================================================
 * S3 — THE GROUND, AND ON THIS OPERATION THE GROUND IS THE OPERATION.
 *
 * A race whose trigger table is "reach X before minute N" is a walk with a
 * stopwatch. What makes this one an operation is that there are TWO ways to
 * beat the clock and they point in different directions, so the fork is
 * geometry rather than script:
 *
 *   - the DEEP TAP, 332 m out and 129 m from the Allied base — take it and
 *     hold it and the operation is over, whatever the survey says;
 *   - the SURVEY CAMP, 228 m out on the near flank, three masts inside a
 *     walled perimeter with one gate — break it and the filing waits six more
 *     minutes.
 *
 * The camp sits **111 m off the straight line from the player's opening to the
 * tap** — but the column does not start at the opening, it starts at the
 * staging post, and **that is the line the claim has to be measured against**.
 * From `STAGE` the gate is only **49.4 m** off the direct route to the tap and
 * the nearer of the two gate guns is **45.0 m** off it. The conclusion holds —
 * 45 is comfortably outside `pillboxMg`'s 22 m, so a column driving for the tap
 * never has to fight — but it holds by 23 m rather than by 89, and the 111 was
 * the wrong origin. Near enough that turning aside costs a minute rather than a
 * detour; far enough that it costs something. That is the decision, and it is
 * made in minute three, against a rail column that lands at minute three.
 *
 * ============================================================================
 * THE WORLD POINTS ARE EXPORTED CONSTANTS, AND THE OPERATION IMPORTS THEM
 * ============================================================================
 * S1's layout derives its objective from the start spots, and its own header
 * gives the reason: a literal would put the tap inside somebody's base on half
 * the rolls. That reasoning is right for a layout whose objective is only ever
 * a structure the layout itself places. It CANNOT work here, because this
 * operation's win condition is a `unitsInArea` disc and a disc is authored in
 * the TRIGGER TABLE, which is static data and can derive nothing.
 *
 * So the ground and the table have to agree about one point, and **a number
 * written in two files is a number that will disagree**. This module owns the
 * geometry and exports it; `operations/soviets/03-deep-sector.ts` imports it.
 * The dependency runs operation -> layout and never back, so nothing is
 * circular and `index.ts` globs both eagerly into the same campaign chunk.
 *
 * ============================================================================
 * `simSeed` IS NOT DECORATION HERE — IT PICKS THE CORNERS
 * ============================================================================
 * `seatedSlots` chooses WHICH of the four authored slots a two-army match sits
 * in, from `startPairFor(seed)`. At `simSeed` **5309** that is the pair
 * **[2, 3]**, so the player opens at **(404, 380)** and the Allies at
 * **(108, 132)** on the 386.2 m diagonal — the widest of the four layouts. The
 * points below are measured against that. **Change `simSeed` and every
 * distance in this file is a different distance.**
 *
 * The margins are deliberately loose enough that the generator cannot break
 * them. Measured from the two openings: TAP 332.0 / 129.1, CAMP 228.1 / 288.7,
 * GATE 194.1 / 295.0, STAGE 120.0 / 322.5, APPROACH 363.6 / **71.6**. Four of
 * the five are over 100 m from either opening; **`APPROACH` is the deliberate
 * exception** and its own declaration says so — a shoulder the Allied column
 * comes round is meant to be near the Allied opening. Even that is 13.6 m clear
 * of a `TERRAIN_START_FLAT_RADIUS` of 58, against a `nudgeToBuildable` that is
 * a no-op on a reserved shelf. A slid start moves the bases, not the operation.
 *
 * (This paragraph read "every authored point is over 100 m from either
 * opening" and contradicted line 166 of this same file, which states
 * `APPROACH`'s 71.6 m and defends it. The prose was wrong; the layout is not.)
 *
 * ============================================================================
 * ONLY STRUCTURES DEFEND THE ALLIED POSITIONS, AND THAT IS NOT A STYLE CHOICE
 * ============================================================================
 * `AiBrain.regroupSquads` files EVERY untagged unit the seat owns into the
 * strike group or the reserve, every pass. So a squad this layout parks at the
 * camp is in the AI's next attack wave and the camp is undefended by minute
 * two — a garrison that walks away is worse than no garrison, because the
 * designer measured the fight with it standing there. Emplacements cannot be
 * re-ordered, so the camp and the tap are held by pillboxes, concrete and
 * civilian mass, and every mobile Allied force in this operation arrives from
 * the trigger table at the moment it is meant to.
 *
 * **EVERY TAG THIS STAMPS IS DECLARED ABOVE `build`.** A zero threshold reads
 * TRUE before a tag has ever existed — `entityDead` does, and so does the
 * `ownerCount(1, ..., 'mast', max: 0)` the operation counts masts with now — so
 * a mast that fails to place is an operation whose secondary completes early
 * and whose nine-minute fuse never lights. `tests/campaign-maps.spec.ts` builds
 * this headlessly and checks the declaration against what actually landed, in
 * both directions; the operation's own `SETTLE` is the guard that stops the
 * symptom landing on tick one.
 * ========================================================================== */

import { CELL } from '../../core/config';
import { NONE } from '../../core/types';
import { addStartOre, buildBaseFor, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE GEOMETRY THE TRIGGER TABLE ALSO READS
 *
 * World metres, absolute, on a 512 m map. See the header for why these are
 * literals and why the seed is what makes them legal.
 * ========================================================================== */

/**
 * The deep tap: the Works bore-head the Allies are reading, and the ground the
 * operation is fought for.
 *
 * 129 m from the Allied opening — outside `BUILD_RADIUS` (56) and outside
 * anything they can emplace on turn one, inside the distance their army covers
 * in twenty seconds. A player who rushes it is not sneaking past a base, they
 * are standing on its doorstep for as long as the hold takes.
 */
export const TAP: Point = { x: 232, z: 96 };

/**
 * The hold, and the two numbers are bounded against each other.
 *
 * 48 m is wide enough that a fight can happen inside it rather than a queue
 * forming at its rim, and it keeps the far edge 48 m off the map border.
 * FOUR units, not one, because a scout parked on a disc is not holding
 * anything — and not eight, because the column that gets here has taken
 * losses by definition.
 */
export const TAP_HOLD: Area = { x: TAP.x, z: TAP.z, r: 48 };

/**
 * The survey camp. Three masts, a wall with one gate, four emplacements.
 *
 * 228 m from the player and 289 m from the Allies: it is in no-man's-land and
 * it is NEARER TO YOU THAN TO THEM, which is the whole reason it is walled.
 * Nothing reinforces it — the Allied army is a base-width away and busy — so
 * the camp assault is a fight against concrete and guns, on your clock.
 */
export const CAMP: Point = { x: 396, z: 152 };

/**
 * The one opening in the camp's wall, 34 m out from the camp centre on the
 * face the player approaches from.
 *
 * THE GATE IS THE FASTEST WAY IN AND IT IS THE ONE COVERED BY BOTH GUNS. Going
 * round an end costs 60 m each way; making a new hole costs standing still in
 * front of a `pillboxMg` at 22 m. The operation never says any of that — the
 * wall does.
 */
export const GATE: Point = { x: 398, z: 186 };

/**
 * Where a trigger notices the player has come up to the wall.
 *
 * **40 m, AND IT HAS A CEILING RATHER THAN A TASTE.** The nearest man in the
 * forward column stands **60.00 m** from the gate at t=0 — read off a built
 * world, not off the rank arithmetic, which gives 57.5 and is what an earlier
 * draft of this comment quoted: `spawnUnit` clamps and settles every hull, so
 * the authored offsets are not where anybody ends up. A disc any wider fires
 * the line on tick one, before anybody has driven anywhere, and a beat that
 * fires before the player acts is a beat that teaches them the operation is not
 * watching.
 */
export const GATE_WATCH: Area = { x: GATE.x, z: GATE.z, r: 40 };

/**
 * The staging post: where the forward column is already parked when the
 * operation opens.
 *
 * 120 m from the player's opening, 74 m from the camp gate and 238 m from the
 * tap — so at t=0 the column is a real distance from home and BOTH objectives
 * are live options from where it stands. That is the starting force doing the
 * work the trigger table is not allowed to do.
 */
export const STAGE: Point = { x: 404, z: 260 };

/**
 * The shoulder the Allies come round to reach the tap: **56.6 m short of it,
 * 71.6 m out from their own START SPOT** (108, 132) — which is the opening, not
 * the yard, and the two are different points.
 *
 * Reinforcements land HERE and not on the tap itself. Spawning them on the
 * disc would materialise a section inside a holding player's formation, which
 * reads as a cheat however correct the fiction is; fifty-odd metres short reads
 * as a column arriving.
 *
 * **IT WAS AT (184, 110), WHICH IS ON A RIDGE, AND THE SPAWN IS A RING RATHER
 * THAN A POINT.** `EffectSink.spawnUnits` puts unit `i` of `count` at
 * `angle = i / count * 2pi` and radius `spread`, and `ProductionService.spawnUnit`
 * writes that position verbatim — no egress search. So what has to be legal is
 * four rings of fixed bearings, not one point: `t.dig` 5 G.I.s at 22 m and 2
 * Grizzlies at 14 m, `t.contest` 6 at 24 m and 3 at 15 m. At the old point
 * three of those sixteen drops were closed — two on a structure 12 m east, one
 * on the ridge itself. Measured here through `ITerrain.isPassable` with each
 * wave's own move class, **all sixteen are passable and the tightest has 5.59 m
 * of clear ground**. `tests/campaign-spawn-ground.spec.ts` is the gate; the two
 * distances above are prose and have none, so re-derive them if this moves.
 */
export const APPROACH: Point = { x: 172, z: 100 };

/**
 * The seam itself — a rich field between the camp and the tap.
 *
 * ORE, BECAUSE THE MARCH IS WHAT THE SECTOR IS. It is centred 88 m off `TAP`
 * so its 34 m rim clears the 48 m hold disc: a harvester counts as a unit to
 * `unitsInArea` and there is no role filter on that condition, so the win must
 * not be reachable by parking miners on it.
 */
const SEAM: Point = { x: 320, z: 104 };
const SEAM_RADIUS = 34;

/* ==========================================================================
 * 2. THE PERIMETER
 * ========================================================================== */

/** Half-length of the wall, metres. 120 m of concrete across one approach. */
const WALL_HALF = 60;
/**
 * Half-width of the gate.
 *
 * **20 m NOMINAL IS 12 m REAL, AND THE REAL NUMBER IS THE ONE THAT MATTERS.**
 * A segment is skipped only while `|t| < GATE_HALF`, so the two inner segments
 * sit AT +/-10 m and each claims the whole 4 m cell it lands in. Read off the
 * built world's occupancy grid, the opening is cells `98,46` `99,46` `100,46` —
 * **three clear cells, 12 m**. That is still a corridor rather than a slot:
 * `NAV_MIN_CORRIDOR_CELLS` is 2 for a tracked hull, and the free run across the
 * gate is 3, so the planner routes through it instead of demoting it and
 * walking the column 60 m round an end. Raising this to buy a fourth cell also
 * moves the opening's edges out from under the two guns, which is the trade
 * rather than a free improvement.
 */
const GATE_HALF = 10;
/**
 * The gate's two guns: `GATE_GUN_OFFSET` along the wall and `GATE_GUN_DEPTH`
 * behind it, which puts each one 16.6 m from the centre of the opening —
 * inside `pillboxMg`'s 22 m, with the wall between it and the return fire.
 */
const GATE_GUN_OFFSET = 14;
const GATE_GUN_DEPTH = 9;

/** Masts, relative to `CAMP`. Plain offsets rather than a trig ring: three is not a circle. */
const MAST_OFFSETS: readonly Point[] = [
  { x: 0, z: -24 }, { x: -22, z: 14 }, { x: 22, z: 14 },
];

/**
 * The camp's back guns, relative to `CAMP`.
 *
 * **THEY DO NOT MAKE GOING ROUND AN END COST ANYTHING, WHICH IS WHAT THIS
 * COMMENT USED TO CLAIM.** Measured against `pillboxMg`'s 22 m: the west wall
 * end is 76 m from the nearer of them, and the two masts an outflanker reaches
 * first are 30.6 m and 47 m away. They cover the NORTHERN approach — the face
 * the Allies would relieve the camp from — and nothing else. What actually
 * punishes a flank is the pair at the gate: the west mast sits 18.1 m from gate
 * gun 1, inside its 22, so the interior is covered even when the wall is not.
 */
const CAMP_REAR_GUNS: readonly Point[] = [
  { x: -34, z: -34 }, { x: 34, z: -34 },
];

/** Emplacements ringing the bore-head, relative to `TAP`. */
const TAP_GUNS: readonly Point[] = [
  { x: 0, z: -32 }, { x: -30, z: 18 }, { x: 30, z: 18 },
];

/* ==========================================================================
 * 3. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'soviets-deep-sector',
  tags: ['tap', 'mast', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);

    /*
     * SLOT ORDER, NOT `rotateStarts`, AND THAT IS A DECISION RATHER THAN AN
     * OMISSION.
     *
     * The rotation exists to answer "why the game dont drop me in random
     * locations?" and it reads `hashU32(seed)`. An operation PINS its seed, so
     * here the rotation is not variety at all — it is a coin that would be
     * flipped once, at authoring time, deciding whether the whole composition
     * sits on the player's side of the map or the enemy's. Taking it out makes
     * seat 0 the player's corner by construction, which is what every distance
     * in this file's header is measured against.
     */
    for (let i = 0; i < spots.length; i++) {
      buildBaseFor(b, c.seat(i), spots[i].x, spots[i].z, {
        facingDeg: wrapDeg(spots[i].facingDeg + 180),
      });
    }

    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);

    /**
     * Put a structure down on ground it can legally stand on — S1's helper,
     * for S1's reason. A scenario spawn does not go through placement
     * legality, so without this a mast appears half-buried in a slope and the
     * call reports success. The fallback is the nominal point: a mast that
     * fails to appear is a secondary that completes on tick one, and a mast on
     * a slope is only ugly.
     */
    const scratch = new Float32Array(2);
    const place = (key: string, p: Point): Point => {
      const f = b.footprintOf(key);
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    const offset = (base: Point, d: Point): Point => ({ x: base.x + d.x, z: base.z + d.z });

    const gun = (p: Point): void => {
      // `pillbox` goes through `keyFor`, so this is a Sentry Gun for a Soviet
      // seat and a Glaive for the Pact. The emplacement is a role here, not a
      // model.
      const at = place('pillbox', p);
      const id = b.spawnBuilding('pillbox', them, at.x, at.z);
      if (id !== NONE) b.block(at.x, at.z, 10);
    };

    /* -- the camp's wall --------------------------------------------------
     * Walked in HALF-CELL steps with a dedupe on the grid cell, and both
     * halves of that are load-bearing. A 4 m step along a diagonal bearing
     * snaps two segments onto one cell, and `spawnBuilding` then relocates the
     * second by a widening ring — a lone wall standing beside its own line.
     * A step of `CELL / 2` cannot jump a cell boundary on any bearing, so the
     * run has no holes; the dedupe means no cell is asked for twice.
     *
     * **THE WALL DELIBERATELY DOES NOT GO THROUGH `place`, AND THE BUILD SAYS
     * SO OUT LOUD.** `auditConnectivity` prints "16 structures on ground
     * isBuildable refuses (first: wall at 426,182)" on this layout, which is
     * the exact line S1's header records having FIXED with `place`. It is
     * correct here and it must not be "fixed": `findClearFootprint` walks a
     * widening ring, so a segment on a slope would be relocated off the line
     * and the run would stop being a run. A wall bedded into a snow bank is
     * ugly; a wall with a hole in it is a different operation. The 28 segments
     * were counted off the built world and the run is continuous either side of
     * the gate.
     */
    {
      const ax = STAGE.x - CAMP.x;
      const az = STAGE.z - CAMP.z;
      const al = Math.max(1e-3, Math.sqrt(ax * ax + az * az));
      // Along the wall: the left-hand perpendicular of camp -> staging post.
      const wx = -(az / al);
      const wz = ax / al;
      const steps = Math.round(WALL_HALF / (CELL * 0.5));
      let lastCx = Number.NaN;
      let lastCz = Number.NaN;
      for (let k = -steps; k <= steps; k++) {
        const t = k * CELL * 0.5;
        if (Math.abs(t) < GATE_HALF) continue;
        const x = GATE.x + wx * t;
        const z = GATE.z + wz * t;
        const gx = Math.floor(x / CELL);
        const gz = Math.floor(z / CELL);
        if (gx === lastCx && gz === lastCz) continue;
        lastCx = gx;
        lastCz = gz;
        b.spawnBuilding('wall', them, x, z);
      }

      // The two guns that make the gate a decision. Set BEHIND the wall by
      // `GATE_GUN_DEPTH` so they are 17 m from the gate's centre line, inside
      // `pillboxMg`'s 22 m: the opening is covered end to end and the wall is
      // between them and whatever is shooting back.
      const dx = -(ax / al);
      const dz = -(az / al);
      gun({
        x: GATE.x + wx * GATE_GUN_OFFSET + dx * GATE_GUN_DEPTH,
        z: GATE.z + wz * GATE_GUN_OFFSET + dz * GATE_GUN_DEPTH,
      });
      gun({
        x: GATE.x - wx * GATE_GUN_OFFSET + dx * GATE_GUN_DEPTH,
        z: GATE.z - wz * GATE_GUN_OFFSET + dz * GATE_GUN_DEPTH,
      });
    }

    /* -- the masts --------------------------------------------------------
     * `civOilDerrick` and not `radar`, for the silhouette: a 13 m lattice
     * tower is what a survey mast looks like from gameplay dolly, and it is
     * Continental Works plant the Allies re-tasked, which is what the fiction
     * says they are. Blocked after each placement so the next mast's search
     * cannot land on top of it — `findClearFootprint` reads terrain occupancy,
     * and `block` is what keeps 150 props off them as well.
     *
     * **THE SILHOUETTE WAS THE ONLY REASON RECORDED AND IT IS NOT THE ONLY
     * CONSEQUENCE.** `civOilDerrick` is a `CIVILIAN_INCOME_SOURCES` row, and
     * `civilian.system.ts#payHolders` pays whoever holds the deed provided the
     * owner is not Gaia — so these three, on seat 1, bank the Allies 15 cr/s
     * each, 2700 credits a minute, from tick one of an 8000-credit operation.
     * They are also ENEMY buildings rather than Gaia ones, so an engineer can
     * take one at or below half health and turn that income around. The
     * operation's thresholds count DEEDS for exactly this reason; a change of
     * def key here changes what "break the survey" is worth in both directions.
     */
    for (let i = 0; i < MAST_OFFSETS.length; i++) {
      const at = place('civOilDerrick', offset(CAMP, MAST_OFFSETS[i]));
      const id: EntityId = b.spawnBuilding('civOilDerrick', them, at.x, at.z, {
        yawDeg: (i * 120) % 360,
      });
      c.tag('mast', id);
      if (id !== NONE) b.block(at.x, at.z, 16);
    }

    // The camp's own mass, so three towers in snow read as an installation.
    {
      const at = place('civApartments', { x: CAMP.x - 34, z: CAMP.z + 2 });
      const id = b.spawnBuilding('civApartments', them, at.x, at.z, { yawDeg: 90 });
      if (id !== NONE) b.block(at.x, at.z, 14);
    }
    for (const d of CAMP_REAR_GUNS) gun(offset(CAMP, d));
    b.block(CAMP.x, CAMP.z, 30);

    /* -- the deep tap -----------------------------------------------------
     * Allied-owned rather than Gaia-owned for the same mechanical reason S1
     * gives: `ownerCount` names a SEAT and the Gaia slot sits outside the two
     * an operation declares. The fiction survives it — the Works sank the
     * bore-head and the Allies are sitting on it, which is the sentence the
     * briefing opens with.
     */
    const tapAt = place('civOreMine', TAP);
    const tap = b.spawnBuilding('civOreMine', them, tapAt.x, tapAt.z, { yawDeg: 40 });
    c.tag('tap', tap);
    if (tap !== NONE) b.block(tapAt.x, tapAt.z, 20);
    for (const d of TAP_GUNS) gun(offset(TAP, d));
    {
      const at = place('civApartments', { x: TAP.x + 32, z: TAP.z - 22 });
      const id = b.spawnBuilding('civApartments', them, at.x, at.z, { yawDeg: 20 });
      if (id !== NONE) b.block(at.x, at.z, 14);
    }

    /* -- the forward column -----------------------------------------------
     * SPAWNED ONE AT A TIME RATHER THAN THROUGH `b.formation`, because
     * `formation` returns a COUNT and `c.tag` needs a handle. The trigger
     * table reads this tag, so the column has to be tagged, so the convenience
     * helper cannot be used. Ranks are laid on the perpendicular of the bearing
     * to the tap — the column is parked pointing at the thing it was sent for.
     *
     * ROLE KEYS, DELIBERATELY. `ScenarioBuilder.spawnUnit` runs every key
     * through `keyFor`, so 'grizzly' is an Anvil for this Soviet seat. The
     * OPERATION file cannot do this: `EffectSink.spawnUnits` goes through
     * `ProductionCatalog.byKey` and remaps nothing, so its waves name literal
     * keys. Two spawn paths, two vocabularies, and the difference is silent.
     */
    {
      const dx = TAP.x - STAGE.x;
      const dz = TAP.z - STAGE.z;
      const dl = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const fx = dx / dl;
      const fz = dz / dl;
      const yawDeg = wrapDeg((Math.atan2(fx, fz) * 180) / Math.PI);
      // Right-hand perpendicular of the facing: the rank forms across the axis
      // of advance rather than down it.
      const rx = -fz;
      const rz = fx;

      const rank = (key: string, count: number, ahead: number, spacing: number): void => {
        for (let i = 0; i < count; i++) {
          const across = (i - (count - 1) * 0.5) * spacing;
          const id = b.spawnUnit(
            key, us,
            STAGE.x + fx * ahead + rx * across,
            STAGE.z + fz * ahead + rz * across,
            { yawDeg },
          );
          c.tag('column', id);
        }
      };

      // Infantry ahead of the armour, which is where a screen goes and which
      // is the reading a player expects when the camera finds them.
      rank('gi', 4, 16, 5.0);
      rank('grizzly', 5, 0, 9.0);
      // Units reserve nothing for themselves — see `START_CLEAR_RADIUS` — and
      // `b.scatter` below honours the reservation list, so without this the
      // column is parked in a boulder field.
      b.block(STAGE.x, STAGE.z, 22);
    }

    /* -- economy and dressing --------------------------------------------- */

    addStartOre(b, spots, b.sea);
    b.addOre(SEAM.x, SEAM.z, SEAM_RADIUS);

    /*
     * NO `addCivilians`, AND THE REASON IS THE MASTS.
     *
     * It hangs capturable `civOilDerrick`s off the perpendicular bisector of
     * the two openings — the same silhouette this operation has already spent
     * on the survey masts, dropped in the middle of the map where the secondary
     * objective is not. A player who has been told to bring down three
     * derricks and can see five is a player the layout has lied to.
     */

    // Open on the base. The first thing a race asks is how much base to build,
    // and that is not a decision anybody can make looking somewhere else.
    b.setCameraFocus(spots[0].x, spots[0].z - 8);
    b.scatter({ minX: cx - 150, minZ: cz - 150, maxX: cx + 150, maxZ: cz + 150 }, 150);
    void start;
  },
});
