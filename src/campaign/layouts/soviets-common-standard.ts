/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-common-standard.ts
 * ============================================================================
 * S2 — THE GROUND. One Allied base, one Soviet armour column with nothing
 * behind it, and a Works station standing on the seam exactly halfway between
 * them.
 *
 * **THIS IS THE FIRST LAYOUT THAT DOES NOT CALL `buildBaseFor` FOR THE
 * PLAYER.** `opening: 'force'` is honoured HERE and nowhere else — the field
 * travels as far as `PlannedOperation.opening`, `planScenario` resolves it to
 * the `StartCondition` `'base'` because `START_CONDITIONS` is deliberately not
 * widened, and the layout is the only thing that reads the operation's own
 * value. So "no base" is not a mode the engine has; it is a call this file does
 * not make.
 *
 * ============================================================================
 * THE OBJECTIVE GEOMETRY IS MAP-ABSOLUTE, AND IT HAS TO BE
 * ============================================================================
 * A trigger table is STATIC DATA. Its `Area`s and `Point`s are frozen at module
 * load, long before a `ScenarioBuilder` exists, so they cannot be derived from
 * the start spots the way S1 derives its tap — `startSpots` runs inside the
 * build, reads the terrain through `nudgeToBuildable`, and answers differently
 * with no heightfield under it.
 *
 * So the three places this operation cares about are exported from HERE, in
 * world coordinates, and the operation imports them. One definition, two
 * readers — the rule `seatedSlots` states about itself, applied to campaign
 * geometry. The alternative is the same four numbers typed into two files,
 * which is how a trigger comes to name a disc the layout stopped putting
 * anything in.
 *
 * **THE MAP CENTRE IS THE ONE FAIR POINT, AND THAT IS ARITHMETIC.** All four
 * authored slots sit at `(±START_SPREAD_X, ±START_SPREAD_Z)` = (±148, ±124)
 * from it, so every one of them is `hypot(148, 124)` = **193.1 m** from the
 * centre. Whichever pair `seatedSlots` draws and whichever way `rotateStarts`
 * seats it, both armies open exactly 193.1 m from Survey 40. No other point on
 * this map is equidistant from all four, which is why the depot below is the
 * one piece of geometry that is seed-specific and is quoted as such.
 *
 * ============================================================================
 * IT READS NO CLOCK, NO PROFILE AND NO DOM
 * ============================================================================
 * Same constraint as every layout: this runs inside the world build, which is
 * where the tick-zero desync lives. The campaign's answer to `isBuildable` is
 * the operation's authored roster, installed by `campaign-install.ts` before
 * the boot — and this operation's roster is empty on both sides, so nothing
 * placed below is at the mercy of a profile.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import {
  addStartOre, buildBaseFor, islandSeats, rotateStarts, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE PLACES THE TRIGGER TABLE NAMES
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * Survey 40 — the pad the column has to stand on.
 *
 * **THE RADIUS IS GENEROUS ON PURPOSE.** The win is a four-minute
 * `elapsedSinceArmed` hold over `unitsInArea`, and the hold DISARMS the moment
 * the count drops. A tight disc would make that timer measure parking accuracy;
 * at 46 m it measures survival, which is the only thing this operation is
 * about. 46 m also comfortably contains the Works station's own footprints, so
 * a hull shouldering round the survey hall never leaves the count.
 */
export const PAD: Area = { x: CENTRE, z: CENTRE, r: 46 };

/** The same point, for `orderTagged`. An `Area` is not a `Point`. */
export const PAD_POINT: Point = { x: CENTRE, z: CENTRE };

/**
 * The Works vehicle park — the secondary.
 *
 * **176 m BEHIND THE LINE, AND THE PRICE IS QUOTED RATHER THAN GUESSED.**
 * Re-deriving `startPairFor` and `startOffset` by hand for this operation's
 * `simSeed` gives pair [0, 2] with offset 0, i.e. the two slots at
 * (108, 380) and (404, 380) — an EDGE pair, both armies on the same side of
 * the valley, 296.0 m apart. Against that, the park at (256, 432) is
 * `hypot(148, 52)` = **156.9 m from BOTH openings**, nominal, before
 * `nudgeToBuildable` (which is a no-op on a reserved shelf).
 *
 * So the detour is 156.9 + 176 = 332.9 m of driving against 193.1 m straight to
 * the pad — **+139.8 m, about 26 seconds at a Rhino's 5.4 m/s** — plus whatever
 * the guard costs, and it is exactly as far inside the Allied half as the
 * Soviet one. That symmetry is the seed's doing and not a design choice; if the
 * seed ever moves, re-derive this number rather than carrying it forward.
 */
export const DEPOT: Area = { x: CENTRE, z: CENTRE + 176, r: 34 };

/**
 * Where the salvaged hulls appear. NOT the park's centre, and the difference is
 * a hull that cannot move.
 *
 * **`EffectSink.spawnUnits` DOES NOT SNAP TO STANDABLE GROUND.** Everything
 * this file places goes through `ScenarioBuilder.spawnUnit`, which calls
 * `connectedGround` and pulls the spot onto ground the locomotor can hold. The
 * Director's `spawnUnits` calls `ProductionService.spawnUnit` instead, which
 * clamps to the map, reads `heightAt` and allocates — it asks nothing. So a
 * drop point on a ridge is a Rhino standing on a ridge, permanently, counting
 * towards the `ownerCount` the loss threshold reads while being no use to
 * anybody.
 *
 * (256, 432) was exactly that, and the ground here is not flat the way the
 * distances above imply. Measured on this seed: the park's centre is a knoll at
 * `heightAt` **14.78** against 8.96 twelve metres north, and `connectedGround`
 * relocates Foot, Track, Wheel and Hover off it. `place()` had already carried
 * the shed clear — it landed at (264, 426) — so nothing in the build reported a
 * fault; the reward hulls simply had no equivalent, and the `spread: 11` ring
 * put one of the two at (245, 432), on the same knoll.
 *
 * (248, 420) is standable and unoccupied at its centre AND at both spread-11
 * ring points, 14.4 m from the park's centre so well inside `DEPOT`'s 34 m
 * disc, and on the PAD side of the shed — the new hulls appear already pointing
 * the way back. **Re-measure it if the seed moves**; this is the second piece
 * of geometry on this map that is seed-specific.
 */
export const DEPOT_DROP: Point = { x: CENTRE - 8, z: CENTRE + 164 };

/**
 * The valley road the Allied relief columns come up.
 *
 * **NOT THE ALLIED BASE, AND THAT IS THE SECOND AXIS.** A `spawnUnits` point is
 * static data and cannot know where a seed put the enemy yard; S1 solves that
 * by dropping its wave on the map centre, which here is the pad the player is
 * standing on. Putting the relief on the FAR side instead costs nothing, is
 * knowable at authoring time, and turns the hold into a pincer — the AI's own
 * army arrives from its base, these arrive from the opposite bearing, and the
 * player cannot face both with one line.
 *
 * 168 m from the pad: about 25 seconds of driving for a Grizzly, which is what
 * makes the warning line worth saying.
 */
export const RELIEF_ROAD: Point = { x: CENTRE, z: CENTRE - 168 };

/* ==========================================================================
 * 2. THE FORCE
 * ========================================================================== */

/**
 * Eight hulls, all of them the same hull.
 *
 * **HOMOGENEITY IS WHAT MAKES THE UNTAGGED COUNT HONEST.** The operation's win
 * and both its losses read `ownerCount(player 0, role: 'unit')` with no tag,
 * because under `opening: 'force'` the player owns exactly this column forever
 * — there is no production that could add a unit the count did not mean. Mix a
 * conscript in and "hulls left" stops being the same number as "units owned",
 * and the player starts hiding infantry at the back to hold a threshold that
 * was written about tanks.
 */
const COLUMN_HULLS = 8;

/** Allied tanks parked on the vehicle park. The secondary's price, in hulls. */
const DEPOT_GUARDS = 2;

/** Metres out from a nominal spot that `place` will search. Nearest first. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only — see the note on `place`. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

export default layout({
  id: 'soviets-common-standard',
  // `stock` and `relief` are stamped by `spawnUnits`, not by anything below —
  // `validateCampaign` and `campaign-maps.spec.ts` both know that and neither
  // requires this file to produce them. They are declared anyway, because a
  // reader asking "where do the salvaged hulls come from" should find the
  // answer in the file that owns the ground.
  tags: ['guard', 'stock', 'relief'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED DISCS ARE ABSOLUTE AND THIS BUILD IS SHELF-ANCHORED, SO THE
     * TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`, which is
     * `startLocations()[0]`, which `startPointsFor` puts at the map centre on
     * every continent. If that ever stops being true the trigger table is
     * naming ground this file never dressed — and it would be invisible,
     * because every tag would still land and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] soviets-common-standard built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the operation's objective discs are absolute and will `
        + 'not line up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);
    const owners: PlayerId[] = rotateStarts(spots.map((_, i) => b.armySlot(i)), b.seed);

    /*
     * FIND THE PLAYER'S SEAT, DO NOT ASSUME IT. `rotateStarts` is what varies
     * which CORNER the human opens in, so `seats[0]` is a corner rather than a
     * player. Getting this wrong on a symmetric two-base layout costs a camera
     * focus; here it would put the column in the Allied base and the Allied
     * base where the column should be, on half of all seeds.
     */
    const me = b.armySlot(0);
    const mine = Math.max(0, owners.indexOf(me));
    const home = seats[mine];

    /* -- the two seats ---------------------------------------------------- */
    for (let i = 0; i < seats.length; i++) {
      if (owners[i] === me) continue;
      buildBaseFor(b, owners[i], seats[i].x, seats[i].z, {
        facingDeg: wrapDeg(seats[i].facingDeg + 180),
      });
    }

    /*
     * THE COLUMN. No yard, no factory, no harvester, no bank — see the
     * operation's `credits: 0`. Two abreast and four deep so it reads as a
     * column on the road rather than a skirmish line, facing the way the orders
     * point.
     *
     * `formation` RESERVES NOTHING, which is the `START_CLEAR_RADIUS` finding:
     * `spawnUnit` does not call `block()`, so without the reservation below
     * `scatter` is free to drop 150 props into the one place the operation
     * cannot start without.
     */
    const placed = b.formation('rhino', me, home.x, home.z, COLUMN_HULLS, {
      yawDeg: home.facingDeg, columns: 2, spacing: 9, jitter: 0.6,
    });
    b.block(home.x, home.z, 30);
    if (placed < COLUMN_HULLS) {
      // LOUD, for the reason `campaign-install.ts` shouts about a short spawn
      // wave: the operation's loss condition is a hull COUNT, so a column that
      // quietly arrives one short is an operation the player starts one trade
      // from failing, with every test still green.
      console.error(
        `[campaign] soviets-common-standard placed ${placed}/${COLUMN_HULLS} hulls for the `
        + 'player — the loss threshold is authored against the full column.',
      );
    }

    /* -- placement helper -------------------------------------------------
     * A scenario spawn does not go through placement legality, so a structure
     * on ground `isBuildable` refuses appears anyway — half-buried in a grade,
     * and counted by `auditConnectivity` in a line nobody reads mid-match.
     *
     * **`findClearFootprint` ALONE IS NOT ENOUGH, AND THE BUILD SAID SO.** It
     * asks `footprintClear` (is anything already there) and `connectedGround`
     * (can an army reach it) and NOTHING about slope — which is the split
     * `footprintBuildable`'s own header draws, having been written after four
     * civilian derricks went down on a 0.45 grade. Placing the Works shed with
     * the clear-only search put it on refused ground on the first build:
     * `1 structure on ground isBuildable refuses (first: civApartments at
     * 252,430)`. So the rings below test BOTH, and fall back to the shipped
     * search only when no buildable spot exists at all.
     *
     * NO TRIGONOMETRY. The offsets are an exact integer table scaled by an
     * integer radius, so every candidate is bit-identical on any engine — the
     * same constraint the axis-aligned islands carry, one level up. A layout
     * runs independently on both machines of a lockstep match.
     */
    const scratch = new Float32Array(2);
    const place = (key: string, x: number, z: number): { x: number; z: number } => {
      const f = b.footprintOf(key);
      for (const r of PLACE_RINGS) {
        for (const [ox, oz] of r === 0 ? ORIGIN_ONLY : PLACE_BEARINGS) {
          const px = x + ox * r;
          const pz = z + oz * r;
          if (b.footprintBuildable(px, pz, f.w, f.h) && b.footprintClear(px, pz, f.w, f.h)) {
            return { x: px, z: pz };
          }
        }
      }
      if (b.findClearFootprint(x, z, f.w, f.h, scratch)) return { x: scratch[0], z: scratch[1] };
      return { x, z };
    };

    /* -- Survey 40 --------------------------------------------------------
     * A Works survey hall and two accommodation blocks, owned by GAIA.
     *
     * **GAIA, NOT A SEAT, AND IT IS THE DIFFERENCE BETWEEN A HOLD AND A COIN
     * FLIP.** Gaia is allied to everyone, so neither army will target the
     * station and the four-minute hold cannot be decided by whether the AI
     * happened to shell a building the player was never asked to protect. It is
     * also the fiction: the Works is neither administration's, and both sides
     * build to its standard.
     *
     * What the station DOES do is block navigation with its footprints, which
     * is the whole reason it is three buildings and not one. A pad with a solid
     * middle is ground that can be fought over — hulls have to commit to a side
     * of the hall — instead of an open circle where whoever has more guns wins.
     */
    const hall = place('civHospital', PAD.x, PAD.z);
    b.spawnBuilding('civHospital', b.gaia, hall.x, hall.z, { yawDeg: 90 });
    b.block(hall.x, hall.z, 22);
    for (let i = 0; i < 2; i++) {
      const at = place('civApartments', PAD.x + (i === 0 ? -30 : 30), PAD.z);
      const id = b.spawnBuilding('civApartments', b.gaia, at.x, at.z, { yawDeg: i * 180 });
      if (id !== NONE) b.block(at.x, at.z, 16);
    }

    /*
     * THE SEAM, PLACED EXPLICITLY. `addStartOre` does put a contested patch
     * down, but on the CENTROID OF THE OPENINGS — which is the map centre only
     * when the seed draws a diagonal pair. This seed draws the edge pair
     * [0, 2], whose centroid is (256, 380), so without this the ground the
     * operation is named after would carry no ore at all.
     *
     * It is not there for the player, who cannot mine it. It is there because
     * Allied harvesters will come to it, so holding the pad strangles the enemy
     * economy without a single trigger saying so.
     */
    b.addOre(PAD.x, PAD.z, 30);

    /* -- the Works vehicle park ------------------------------------------
     * A shed, two dead hulls for dressing, and two live Allied tanks sitting on
     * it. The guard is the secondary's PRICE and it is visible before the
     * player commits — `revealArea` shows it in the first minute — which is
     * what makes the detour a decision rather than a surprise.
     */
    const foe = owners[mine === 0 ? 1 : 0] ?? owners[0];

    const shed = place('civApartments', DEPOT.x, DEPOT.z);
    b.spawnBuilding('civApartments', b.gaia, shed.x, shed.z, { yawDeg: 270 });
    b.block(shed.x, shed.z, 16);
    // Allied wrecks, because the Allies hold the park — and burning is off, so
    // two permanent smoke columns do not sit on the map for fourteen minutes.
    b.spawnWreck(DEPOT.x - 20, DEPOT.z + 12, b.world.player(foe).faction, false);
    b.spawnWreck(DEPOT.x + 17, DEPOT.z + 15, b.world.player(foe).faction, false);

    for (let i = 0; i < DEPOT_GUARDS; i++) {
      const gx = DEPOT.x + (i === 0 ? -14 : 14);
      const gz = DEPOT.z - 16;
      c.tag('guard', b.spawnUnit('grizzly', foe, gx, gz, { yawDeg: 180 }));
      b.block(gx, gz, 8);
    }
    b.block(DEPOT.x, DEPOT.z, 24);

    /* -- dressing --------------------------------------------------------- */
    addStartOre(b, spots, b.sea);
    /*
     * `addCivilians` IS DELIBERATELY NOT CALLED, AND THE FIRST VERSION OF THIS
     * NOTE NAMED THE WRONG STRUCTURE.
     *
     * It said the hamlets land "within metres of Survey 40". They do not.
     * `addCivilians` works off the lane midpoint — (256, 380) on this seed, the
     * same point the `addStartOre` paragraph above quotes, and 124 m from the
     * pad — and seats its hamlets `CIVILIAN_HAMLET_OFFSET` (62 m) out along the
     * bisector, at (256, 318) and (256, 442). The second of those is 10 m from
     * the vehicle park, which is a real collision and not the one that was
     * claimed.
     *
     * What actually lands on the pad is the civilian ORE MINE. It walks
     * `MINE_BISECTOR_OFFSETS` = [128, 112, 96] out from the midpoint and takes
     * the first that fits, so it goes to (256, 252) — **4.0 m from Survey 40's
     * centre**, inside the hold disc, placed by something that knows nothing
     * about the station this file just stood there.
     *
     * So the reason to skip it holds and is stronger than it was written: two
     * independent placers competing for one clearing, with the winner deciding
     * how much of the pad is solid ground. The station IS this operation's
     * civilian dressing.
     */
    b.setCameraFocus(home.x, home.z);
    b.scatter({ minX: cx - 130, minZ: cz - 130, maxX: cx + 130, maxZ: cz + 130 }, 150);
    void start;
  },
});
