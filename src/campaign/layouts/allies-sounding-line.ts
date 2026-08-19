/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/allies-sounding-line.ts
 * ============================================================================
 * A1 — THE GROUND. A seam of ore laid across the middle of the valley, two
 * sounding heads on it ninety-two metres apart, and an enemy post already dug
 * in on one of them.
 *
 * The operation is an escort with one destination and a long stand at the end
 * of it, so almost everything that makes it a mission is HERE rather than in
 * the trigger table: where the seam runs, which head is defended, how far the
 * detour costs, and what else is out there worth the walk.
 *
 * ============================================================================
 * WHY THIS FILE OWNS THE TWO DISCS AND THE OPERATION IMPORTS THEM
 * ============================================================================
 * A trigger table is static data, so an `Area` cannot be derived from a start
 * spot the generator has not chosen yet — the coordinates have to be literals
 * somewhere. Putting them in the OPERATION and the masts in the LAYOUT gives
 * two sets of numbers that agree today; a trigger naming a disc this file never
 * dug is the same class of mistake as a trigger naming a tag no layout stamps,
 * and `validateCampaign` catches the second one only because there is one list
 * rather than two. So the ground exports its geometry and the table imports it.
 *
 * ============================================================================
 * WHY THE SEAM IS ANCHORED TO THE MAP CENTRE
 * ============================================================================
 * `startPointsFor` puts `(256, 256)` FIRST in the list of shelves the terrain
 * generator must reserve on any landlocked preset, ahead of the seated slots —
 * so the map centre is flat, dry, buildable and joined to the main passable
 * region on every seed, guaranteed inside `TERRAIN_START_FLAT_RADIUS` (58 m).
 * Both heads sit 46.1 m out from it, comfortably inside that promise, and that
 * is the only reason a fixed coordinate is safe here at all: `seatedSlots`
 * chooses WHICH of the four corner slots a two-army match uses and
 * `rotateStarts` chooses who sits in them, so an objective authored as a
 * fraction of anybody's start axis lands somewhere different on every roll.
 *
 * The axis was picked as the perpendicular bisector of slots 0 and 1 — slot 0
 * to slot 1 is `(296, -248)`, length 386.16, so the unit normal is
 * `(0.64222, 0.76652)` and the heads are the centre plus and minus 46 along it:
 *
 *     control head   (226, 221)      46.1 m from the map centre
 *     deep head      (286, 291)      92.2 m apart from each other
 *
 * ============================================================================
 * WHAT THE SHIPPED SEED ACTUALLY DID WITH THAT, MEASURED
 * ============================================================================
 * `seatedSlots(2, 7014, null)` returns **[2, 3]**, not [0, 1] — and slots 2 and
 * 3 lie 9.9 degrees off the axis above. So on this seed the seam does not run
 * ACROSS the opening lane, it runs very nearly ALONG it, and the operation is
 * shaped by that rather than by the intent. Built for real and measured:
 *
 *     yard seat 0   (402, 378)     -> control 235.8 m   -> deep 145.0 m
 *     yard seat 1   (110, 134)     -> control 145.0 m   -> deep 235.8 m
 *     party         (431, 410)     -> control 278.8 m   -> deep 187.6 m
 *
 * One head in each half, at exactly the same distances reversed. That is a
 * property of the CONSTRUCTION and not of the roll: the heads are symmetric
 * about the map centre and so is any antipodal slot pair, so the mirror is
 * exact for [0,1] and [2,3] alike.
 *
 * **IT IS NOT EXACT FOR AN EDGE PAIR.** `START_PAIRS` also holds [0,2] and
 * [1,3], which are two corners of one side and are not centre-symmetric; on
 * those the two heads land 198/199 m and 239/148 m from the two yards and the
 * whole near/far reading of this operation collapses. `simSeed` is what decides
 * which, so **changing it means re-measuring this block, not re-reading it.**
 *
 * ============================================================================
 * `addCivilians` IS DELIBERATELY NOT CALLED
 * ============================================================================
 * It hangs two hamlets — a derrick, two garrisonable blocks and a mine — off
 * the perpendicular bisector of the lane at `CIVILIAN_HAMLET_OFFSET` = 62 m and
 * `MINE_BISECTOR_OFFSETS` = 128/112/96. The heads hang off a perpendicular
 * bisector too. Two placements built from the same construction are not
 * independent, and how close they come is decided by which pair the seed seats.
 * Nearest civilian structure to either head, computed over the whole table:
 *
 *     [0,1]  15.9 m   INSIDE the 20 m disc
 *     [0,2]  30.8 m   [1,3]  30.8 m
 *     [2,3]  70.9 m   <- the shipped seed, and its real nudged spots agree
 *
 * So there is no collision on seed 7014, and the reason to leave it out is that
 * one seed change puts a capturable wall in the middle of the ground three
 * unarmed men have to stand on for ninety seconds. Every civilian structure is
 * neutral, every neutral structure is captured outright at any health
 * (`Capture.ts` rule 1), and the capture CONSUMES the engineer — so a
 * right-click that lands on a hamlet instead of the earth beside it silently
 * spends a surveyor. The two masts this file places are the same hazard handled
 * rather than inherited: 34 m out from their head, 14 m clear of the disc, so
 * the natural click target inside the reading ground is bare earth.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `party` — the three surveyors. Stamped here.
 * `sortie` — the post's relief. Produced by a `spawnUnits` in the trigger
 *   table, never by this file, and declared anyway: `validateCampaign` walks a
 *   trigger's effects in order, so an `orderTagged` written after the
 *   `spawnUnits` that produces the tag puts it back into the required set. It
 *   also belongs in this list on its own merits — a reader asking "where does
 *   the counter-attack come from" should find the answer in the file that owns
 *   the ground.
 * ========================================================================== */

import { Faction } from '../../core/types';
import {
  addStartOre, buildBaseFor, islandSeats, rotateStarts, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { PlayerId } from '../../core/types';
import { layout } from '../layout';
import type { Area } from '../types';

/* ==========================================================================
 * THE GEOMETRY, EXPORTED
 * ========================================================================== */

/**
 * Known ground, and the enemy is already dug in on it — 145.0 m from THEIR
 * yard and 235.8 m from the player's on the shipped seed.
 *
 * `r` is 20 rather than the 12 a marker would want. The condition counts UNITS
 * INSIDE, and three men walking as a group spread further than that the moment
 * `Movement.relax` separates them; a disc a squad cannot all fit in is a hold
 * that restarts on its own.
 */
export const CONTROL_HEAD: Area = { x: 226, z: 221, r: 20 };

/**
 * The deep sounding, and the primary. 145.0 m from the player's yard, bare ore,
 * nothing placed on it — see `build` for why that emptiness is authored.
 */
export const DEEP_HEAD: Area = { x: 286, z: 291, r: 20 };

/**
 * Unit vector along the opening lane, `(slot1 - slot0) / 386.16`.
 *
 * Everything this file places off a head is offset along THIS rather than along
 * the seam, so the masts, the guns and the derrick spread ACROSS the survey
 * line instead of stringing out along it and reading as one long queue.
 */
const LANE_X = 0.766526;
const LANE_Z = -0.642272;
/** The seam itself — the perpendicular bisector normal. */
const SEAM_X = -LANE_Z;
const SEAM_Z = LANE_X;

/** Metres from a head to its Works mast. 14 m clear of the disc; see the header. */
const MAST_OFFSET = 34;
/** Metres from the control head to each of the two guns dug in beside it. */
const GUN_OFFSET = 20;
/** Metres past the control head to the derrick, along the lane axis. */
const DERRICK_OFFSET = 60;

/** Metres of surveyor formation behind the player's own start spot. */
const PARTY_SETBACK = 40;

export default layout({
  id: 'allies-sounding-line',
  tags: ['party', 'sortie'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);
    const owners: PlayerId[] = rotateStarts(spots.map((_, i) => b.armySlot(i)), b.seed);

    for (let i = 0; i < seats.length; i++) {
      buildBaseFor(b, owners[i], seats[i].x, seats[i].z, {
        facingDeg: wrapDeg(seats[i].facingDeg + 180),
      });
    }

    /**
     * THE PLAYER'S CORNER IS FOUND BY LOOKING FOR THEIR ID, NOT BY TAKING
     * `seats[0]`.
     *
     * `rotateStarts` rotates the OWNER LIST against the spot list, so
     * `owners[0]` is `armySlot(0)` only on the rolls where the offset came out
     * zero — with two armies that is half of them. Reading `seats[0]` as "home"
     * therefore puts the survey party in the enemy's base on half the seeds,
     * silently, and the party is the one thing in this operation that cannot be
     * in the wrong place.
     */
    const player = c.seat(0);
    const homeIndex = Math.max(0, owners.indexOf(player));
    const home = seats[homeIndex];
    const foe = c.seat(1);

    /* -- the survey party ------------------------------------------------
     * Three engineers, and the choice of unit is the operation. They are
     * unarmed, 90 hp, and slower than everything that will be shooting at
     * them, so the player cannot solve the escort by driving fast — and
     * `entityDead` needs ALL THREE gone, so attrition is a cost the mission
     * charges rather than an instant failure.
     *
     * `spawnUnit` runs `isBuildable` against the operation's roster; `engineer`
     * carries no `UNLOCK_TAGS` entry, so it is ungated and this cannot come
     * back empty on a fresh profile. `keyFor` maps it per army, which matters
     * for nothing today (seat 0 is Allied) and matters the day a chapter reuses
     * this shape.
     *
     * SET BACK 40 m FROM THE START SPOT, on the side away from the opening.
     * The base garrison forms up between the yard and the enemy; putting the
     * party in with it would have them walk out of the first exchange of the
     * match, which is precisely the loss the trigger table is written to make
     * impossible before the player has had a chance to decide anything.
     */
    const rad = home.facingDeg * (Math.PI / 180);
    const fx = Math.sin(rad);
    const fz = Math.cos(rad);
    /** A point `setback` behind the start spot and `lateral` across it. */
    const behind = (setback: number, lateral: number): { x: number; z: number } => ({
      x: home.x - fx * setback - fz * lateral,
      z: home.z - fz * setback + fx * lateral,
    });

    const partyAt = behind(PARTY_SETBACK, 0);
    for (let i = 0; i < 3; i++) {
      const p = behind(PARTY_SETBACK, (i - 1) * 5);
      const id = b.spawnUnit('engineer', player, p.x, p.z, { yawDeg: home.facingDeg });
      c.tag('party', id);
    }
    // Units reserve nothing for themselves, so `scatter` below is otherwise
    // free to drop a pine into the middle of the party. Same reason
    // `buildMcvStartFor` blocks around its escort.
    b.block(partyAt.x, partyAt.z, 14);

    /* -- the escort, authored rather than inherited -----------------------
     * THE BASE GARRISON IS NOT AN ESCORT AND THE TWO ARMIES' BASES ARE NOT THE
     * SAME SIZE. Built and counted: `buildAlliedBase` lays down 4 Grizzlies, 2
     * IFVs and 5 G.I.s, while the Soviet layout the opposing seat takes lays
     * down 5 Rhinos, 9 Conscripts, 2 Attack Dogs and an Apocalypse. This
     * operation asks the player to LEAVE that base and cross 279 m into the
     * other one's half on a clock, so inheriting the smaller of two openings
     * would be an authored disadvantage nobody authored.
     *
     * Three more hulls and four more riflemen, formed line abreast with the
     * party so the opening frame reads as a column about to march rather than
     * as a base with three engineers loitering behind it.
     *
     * ONLY UNGATED KEYS, AND THIS IS THE RULE RATHER THAN THE PREFERENCE.
     * `roster: { player: [], ai: [] }` makes `isBuildable` an ALLOW-LIST, so
     * anything carrying an `UNLOCK_TAGS` id is REFUSED for both seats and
     * `spawnUnit` returns NONE without a word. `grizzly` and `gi` carry no tag;
     * `ifv` carries `unit.raider`, which is why the base's two are not part of
     * the escort this file counts on and must not be added to it.
     */
    const armour = behind(PARTY_SETBACK, 30);
    b.formation('grizzly', player, armour.x, armour.z, 3, {
      yawDeg: home.facingDeg, spacing: 8, columns: 3, jitter: 0.5,
    });
    b.block(armour.x, armour.z, 14);
    const screen = behind(PARTY_SETBACK, -28);
    b.formation('gi', player, screen.x, screen.z, 4, {
      yawDeg: home.facingDeg, spacing: 5, columns: 4, jitter: 0.6,
    });
    b.block(screen.x, screen.z, 13);

    /* -- placement helper -------------------------------------------------
     * Widening-ring search for a legal footprint, then the nominal point as a
     * fallback. A mast on a slope is ugly; a mast that never appears is a
     * landmark the briefing refers to and the player cannot find.
     */
    const scratch = new Float32Array(2);
    const place = (key: string, x: number, z: number): { x: number; z: number } => {
      const f = b.footprintOf(key);
      if (b.findClearFootprint(x, z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return { x, z };
    };

    /* -- the two Works masts ---------------------------------------------
     * `civOreMine` — the Continental Works sank both of these before the Split
     * and the engineering standard on the plate is the one both sides still
     * build to. Neutral, so neither army fights over them and neither army's
     * team colour claims them; the silhouette is what tells the player which
     * patch of ore is a survey head and which is just ore.
     *
     * 34 m out along the seam, AWAY from the centre, so the two heads read as
     * the ends of one baseline rather than as two unrelated places.
     */
    for (const [head, sign] of [[CONTROL_HEAD, -1], [DEEP_HEAD, 1]] as const) {
      const p = place(
        'civOreMine',
        head.x + SEAM_X * MAST_OFFSET * sign,
        head.z + SEAM_Z * MAST_OFFSET * sign,
      );
      b.spawnBuilding('civOreMine', b.gaia, p.x, p.z, { yawDeg: sign > 0 ? 40 : 220 });
    }

    /* -- the picket ------------------------------------------------------
     * Two guns dug in either side of the control head, plus a section of
     * infantry. `pillbox` is the cheap-gun ROLE key — `keyFor` resolves it to
     * whatever the seat's army actually fields — and it is ungated, so the post
     * exists on a fresh profile exactly as it does on a finished one.
     *
     * THE COVERAGE IS PARTIAL ON PURPOSE, AND IT WAS MEASURED ON A BUILT WORLD
     * RATHER THAN INTENDED. The two guns land at (238, 206) and (206, 230) —
     * 19.2 m and 21.9 m out from the head after `findClearFootprint` snapped
     * them — against a 20 m disc and a 20-22 m weapon range. Between them they
     * cover the lobe of the reading ground nearest each gun and leave a band
     * across the perpendicular: the two extremes of that band sit 24.0 m and
     * 31.0 m from the NEARER gun, outside a 22 m Pillbox and further outside a
     * 20 m Sentry Gun. A player who reads a coverage ring can stand two
     * surveyors there and take the control reading without breaking the post.
     *
     * That is the reward for looking, and it is why this is two guns and not
     * three: a head nobody can stand on is a head nobody attempts, and the
     * secondary is supposed to be tempting.
     *
     * The infantry are NOT a garrison in any mechanical sense. `AiBrain` forms
     * squads out of every idle unit it owns, so the section will be absorbed
     * into the enemy's army within a minute or two and fight wherever the brain
     * decides. That is correct — the post's men belong to the opponent, not to
     * the script — and it is the reason the guns carry the authored threat.
     */
    for (const sign of [1, -1]) {
      const p = place(
        'pillbox',
        CONTROL_HEAD.x + LANE_X * GUN_OFFSET * sign,
        CONTROL_HEAD.z + LANE_Z * GUN_OFFSET * sign,
      );
      b.spawnBuilding('pillbox', foe, p.x, p.z, { yawDeg: wrapDeg(sign > 0 ? 250 : 70) });
    }
    b.formation('gi', foe, CONTROL_HEAD.x, CONTROL_HEAD.z, 3, {
      yawDeg: 200, spacing: 6, columns: 3, jitter: 0.6,
    });

    /* -- the derrick, which is not an objective --------------------------
     * 60 m past the control head, so it is only worth the walk to somebody who
     * was already going north for the control reading. Neutral, so one engineer
     * takes it outright and `civilian.system.ts` starts paying whoever holds
     * it — and the base ships an engineer of its own, which is what stops this
     * from competing with the survey party for the same three men.
     *
     * Nothing in the trigger table names it. An operation whose ground offers
     * exactly what its objectives ask for and nothing else is a corridor with
     * scenery; this is the reason to look at the other flank.
     */
    const derrick = place(
      'civOilDerrick',
      CONTROL_HEAD.x - LANE_X * DERRICK_OFFSET,
      CONTROL_HEAD.z - LANE_Z * DERRICK_OFFSET,
    );
    b.spawnBuilding('civOilDerrick', b.gaia, derrick.x, derrick.z, { yawDeg: 120 });

    /* -- the last party --------------------------------------------------
     * Two cold hulks either side of the deep head. The briefing says the Works
     * have had no number since the Split; this is what that sentence looks like
     * on the ground. Not burning — nine days is a long time.
     */
    for (const sign of [1, -1]) {
      b.spawnWreck(
        DEEP_HEAD.x + LANE_X * 26 * sign,
        DEEP_HEAD.z + LANE_Z * 26 * sign,
        Faction.Allies, false,
      );
    }

    /* -- the seam --------------------------------------------------------
     * THE ORE IS THE OBJECTIVE MARKER, and that is the whole reason the heads
     * are worth putting on an ore body rather than beside one.
     * `src/world/ore.system.ts` draws crystal clusters wherever a field seeds,
     * shroud-tinted, so a revealed head is visibly a head from the far side of
     * the map — with no structure standing on the ground the surveyors must
     * occupy and therefore nothing inside the disc for a right-click to catch.
     *
     * It also puts the player's economy and the player's escort in the same
     * argument. A harvester sent to the richest ore on the map is a harvester
     * parked 20 m from an enemy gun, and the escort that could cover it is the
     * escort the party needs. `addStartOre` still lays the two home fields, so
     * this is a pull rather than a gate.
     */
    b.addOre(CONTROL_HEAD.x, CONTROL_HEAD.z, 26);
    b.addOre(DEEP_HEAD.x, DEEP_HEAD.z, 26);
    b.addOre(cx, cz, 30);
    addStartOre(b, spots, b.sea);

    /* -- keep the reading ground clear -----------------------------------
     * Blocked LAST, so the guns and masts above could still find their own
     * footprints, and 24 m rather than 20 so `scatter`'s centre test cannot
     * drop a 4 m pine whose canopy overhangs the disc.
     */
    b.block(CONTROL_HEAD.x, CONTROL_HEAD.z, 24);
    b.block(DEEP_HEAD.x, DEEP_HEAD.z, 24);

    // Biased 25 m toward the centre, so the opening frame holds the party and
    // the direction they are going rather than the back of the yard.
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 150, minZ: cz - 150, maxX: cx + 150, maxZ: cz + 150 }, 160);
    void start;
  },
});
