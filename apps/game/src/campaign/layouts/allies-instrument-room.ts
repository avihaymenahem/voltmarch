/**
 * ============================================================================
 * A2 — THE GROUND
 * ============================================================================
 * A Works survey office standing in a district the Soviets took at the Split,
 * a cordon of guns across the two streets they think anybody would come down,
 * and nothing at all watching the yard side.
 *
 * The operation is an infiltration and there is no stealth in this game, so
 * EVERY PART OF THE WORD IS BUILT HERE RATHER THAN SCRIPTED. What the trigger
 * table can say is "five of your units are standing inside this disc" and
 * "somebody has shot that gun". What makes those two sentences mean *seen* is
 * this file: where the guns are, how far round the player has to walk to get
 * past them, and the fact that the office itself stands outside every arc so an
 * unarmed man can reach it.
 *
 * ============================================================================
 * THE CORDON IS FIVE ARCS AND A MEASURED WAY ROUND
 * ============================================================================
 * Five `pillbox`-role emplacements — `sentryGun` on a Soviet seat, `pillbox` on
 * an Allied one, both firing `DEFAULT_WEAPONS[11]` `pillboxMg` at **range 22**
 * whichever army holds the ground. A1's layout established that and it is the
 * reason a role key is safe here: `keyFor` changes the silhouette and not the
 * number.
 *
 * They are authored as a shallow bow of `(u, v)` offsets in the office's own
 * frame — see `GUNS` below — and what that construction actually produced on
 * the ground is measured in the operation file's header rather than restated
 * here, because two copies of a measurement are how one of them goes stale.
 * The one figure this file needs is that the nearest gun landed **44.9 m** from
 * the office against a 22 m weapon, which is property 1.
 *
 * Three properties are authored rather than hoped for, and all three were
 * checked on a built world before this file was finished:
 *
 *   1. **THE OFFICE IS OUTSIDE EVERY ARC.** The nearest gun is 44.9 m from it.
 *      A cordon that could shoot its own objective is a cordon no unarmed man
 *      can ever walk into, which deletes the quiet route and with it the whole
 *      operation.
 *   2. **THE DIRECT LINE IS NOT.** The straight run from the player's yard to
 *      the office passes **2.28 m** from the middle gun, 193.3 m along a
 *      238.2 m line — so a column that marches at the objective is inside a
 *      22 m arc for about forty-four metres of it, and no other gun is within
 *      22 m of that line at all. One gun, deliberately, because the point is
 *      that going round is a decision rather than a flourish.
 *   3. **THERE IS A WAY ROUND AND IT COSTS REAL METRES.** The bow does not
 *      wrap; the yard side and the rear are open. The detour is measured, not
 *      asserted — see the operation header.
 *
 * **THE GUNS ARE CONCRETE AND THERE ARE NO HULLS ON POST.** `soviets.02`
 * measured what happens to a parked guard: `AiBrain.census` files every
 * AI-owned mobile hull into `armyIds`, `regroupSquads` files it into a squad,
 * and both of that operation's Wardens were 117 and 129 m from the ground they
 * were placed to hold within twenty seconds. There is no way for a layout to
 * opt out. So the cordon is emplacements, which cannot be re-tasked, and the
 * district's men arrive as a scripted wave when the player gives them a reason.
 *
 * ============================================================================
 * WHY THE OFFICE IS NEUTRAL, WHICH IS A MECHANICAL CHOICE AND NOT A FLAVOUR ONE
 * ============================================================================
 * `Capture.ts` rule 1: a structure owned by a `Faction.Neutral` player changes
 * hands outright, at any health, for one engineer. Rule 2: an ENEMY structure
 * flips only at or below `CAPTURE.captureHpFrac` (0.5), and an engineer sent at
 * a healthier one is spent knocking `CAPTURE.softenFrac` (0.25 of max) off it.
 *
 * A Soviet-owned office would therefore have to be SHOT to half before it could
 * be taken, which is the opposite of recovering it, and the engineer arithmetic
 * is worse than the file headers claim: `resolve` pushes the soften through
 * `channels.damage`, so it lands through `ARMOR_MATRIX[HighExplosive][Concrete]`
 * (1.00) **and `COMBAT_DAMAGE.globalMul` (0.80)** — 20% of max per engineer, not
 * 25%. 1.00 -> 0.80 -> 0.60 -> 0.40, so a full-health enemy structure costs
 * FOUR engineers and not the three `Capture.ts`'s own header states. That is a
 * reason to keep this operation off that path rather than to build a premise on
 * a number nothing pins.
 *
 * Neutral also decides who can kill it, and the answer is the player. Gaia is
 * allied to everyone (`ScenarioBuilder.gaia` sets both directions of
 * `allyMask`), so no Soviet gun will ever fire at the office while it is still
 * the Works'. The only way to lose it before it is taken is the player's own
 * splash — and the moment it changes hands it becomes an enemy building in the
 * middle of an enemy district, which is the whole of the second half.
 *
 * ============================================================================
 * THE DERRICK IS INSIDE THE CORDON, AND THAT IS THE DIFFERENCE FROM A1
 * ============================================================================
 * `allies-sounding-line` puts a neutral derrick 60 m past its optional
 * objective and argues for it: *"An operation whose ground offers exactly what
 * its objectives ask for and nothing else is a corridor with scenery."* The
 * same argument holds and the placement is deliberately not the same. This one
 * stands INSIDE the counted disc, so taking it is not a detour — it is one of
 * the four bodies the player is allowed to bring, spent on income instead of on
 * a rifle. `civilian.system.ts` pays whoever holds it for the rest of the
 * match, and no trigger requires it.
 *
 * ============================================================================
 * ORE IS PLACED BY HAND, AND `addStartOre` IS DELIBERATELY NOT CALLED
 * ============================================================================
 * `addStartOre` lays a contested patch on the MIDPOINT of the two starts. The
 * office sits 0.60 of the way along that same line and 72 m off it, so on this
 * seed the midpoint lands 81.7 m from the office — INSIDE the 96 m disc the
 * operation counts units in.
 *
 * `WorldQuery.unitsInArea` counts every `IS_UNIT` entity the player owns and
 * asks nothing about what it is for. A harvester working the contested patch is
 * a unit inside the cordon. The player would have failed the secondary at
 * minute two, from an economic decision, with no line of dialogue that could
 * honestly explain it. So all three fields are placed here and every one of
 * them is on the far side of the lane from the district.
 *
 * ============================================================================
 * NO TRIGONOMETRY IN THE GEOMETRY, WHICH IS STRICTER THAN THE SHIPPED LAYOUTS
 * ============================================================================
 * ECMA-262 pins `+ - * /` and `Math.sqrt` to bit precision and pins `sin`/`cos`
 * to nothing. A layout runs inside the world build, which happens INDEPENDENTLY
 * on both machines of a lockstep match — the same exposure the terrain
 * generator has, and the reason `terrain-gen.ts`'s islands are axis-aligned.
 *
 * Every position in this file is a literal `(u, v)` pair in a frame whose two
 * unit vectors come from a subtraction and one `Math.sqrt`. No angle is ever
 * rotated. The one `Math.atan2` is `outward`, which feeds `yawDeg` only — a
 * facing is drawn, never measured, and `spawnBuilding` seats a footprint on the
 * placement grid without consulting it.
 *
 * (`buildBaseFor` still uses `cos`/`sin` internally for its own layout, as it
 * does in every scenario in the game. That is not this file's to fix and it is
 * noted so the claim above is read as scoped rather than absolute.)
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `office`  — the Works survey office. Neutral until an engineer walks in.
 * `derrick` — the district derrick, also neutral, also inside the disc.
 * `cordon`  — the five emplacements. Read by `entityHpBelow` at 0.99, which is
 *             the cheapest available spelling of "somebody has taken a shot".
 * `watch`   — the district's own men. Produced by a `spawnUnits` in the trigger
 *             table, never by this file, and declared anyway for the reason
 *             `reclamation-held-paper` gives: a reader asking where the
 *             counter-attack comes from should find the answer in the file that
 *             owns the ground.
 * `column`  — the relief. Same, twice over: both waves carry this tag.
 * ========================================================================== */

import { Faction } from '../../core/types';
import { CELL } from '../../core/config';
import {
  buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/* ==========================================================================
 * THE CONSTRUCTION
 *
 * Everything is a fraction along the two starts plus an offset across them,
 * exactly as `reclamation-held-paper` does it, because a fixed world
 * coordinate is only safe where the generator promises flat ground and the map
 * centre is the only such place. The operation file carries the world points
 * this construction actually produced at the pinned seeds.
 * ========================================================================== */

/** Fraction of the way from the player's opening to the Soviet one. */
const OFFICE_ALONG = 0.60;
/** Metres across that line, on the side away from the empty corner's lane. */
const OFFICE_OFFSET = 72;

/**
 * The five emplacements, as `(u, v)` metres in the office's own frame: `u`
 * runs back toward the player's opening, `v` runs across it.
 *
 * A SHALLOW BOW, NOT A STRAIGHT LINE, and not a ring. A ring would seal the
 * objective and delete the quiet route; a straight line reads as a fence. The
 * bow is what a cordon on two streets looks like from above, and the ends stop
 * because the streets do.
 */
const GUNS: readonly (readonly [number, number])[] = [
  [52, -64], [46, -32], [44, 0], [46, 32], [52, 64],
];

/** The district derrick, inside the counted disc and off the gun line. */
const DERRICK_UV: readonly [number, number] = [-8, -46];

/** Metres reserved around the office so `scatter` leaves the yard walkable. */
const OFFICE_CLEAR = 30;
/** Metres reserved around each emplacement. */
const GUN_CLEAR = 12;

/**
 * Cells searched outward for buildable ground under a placement. Six is 24 m —
 * wider than anything moves at these seeds, and narrower than the 32 m gap
 * between two adjacent guns, so a search can never walk one gun into the next.
 */
const PLACE_RINGS = 6;

export default layout({
  id: 'allies-instrument-room',
  tags: ['office', 'derrick', 'cordon', 'watch', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    /*
     * NO `rotateStarts`, AND THE TWO SHIPPED LAYOUTS DISAGREE ABOUT THIS ON
     * PURPOSE.
     *
     * `allies-sounding-line` rotates and then hunts for the player's id;
     * `reclamation-held-paper` does not rotate at all. Both are correct and the
     * difference is what the operation needs from the roll. Rotation buys
     * VARIETY, which an authored operation does not want: it has one seed, so
     * the rotation has exactly one value, and taking it would make every
     * measured coordinate in the operation file depend on `startOffset` for no
     * gain at all. The player opens at `seats[0]` here, always.
     */
    const player: PlayerId = c.seat(0);
    const district: PlayerId = c.seat(1);
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    /* -- the frame -------------------------------------------------------- */
    const dx = foe.x - home.x;
    const dz = foe.z - home.z;
    // `Math.sqrt`, never `Math.hypot`: the first is pinned to bit precision by
    // ECMA-262 and the second is not. Every downstream position is this number.
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    const nx = dx / len;
    const nz = dz / len;
    const px = -nz;
    const pz = nx;

    /* -- placement -------------------------------------------------------- */
    const scratch = new Float32Array(2);
    /**
     * Ground a footprint can legally stand on: clear AND `footprintBuildable`,
     * searched in rings with a fixed traversal order so two runs of one seed
     * build the same district.
     *
     * `findClearFootprint` alone answers the WRONG QUESTION — it tests
     * occupancy and connectivity and nothing about grade, so it will happily
     * plant a structure on a slope and report success — `soviets-first-tap`
     * shipped structures that way. This is `reclamation-held-paper`'s repair,
     * copied deliberately rather than re-derived.
     */
    const place = (
      owner: PlayerId, key: string, x: number, z: number,
    ): { x: number; z: number } => {
      const f = b.footprintOf(b.keyFor(owner, key));
      for (let ring = 0; ring <= PLACE_RINGS; ring++) {
        for (let oz = -ring; oz <= ring; oz++) {
          for (let ox = -ring; ox <= ring; ox++) {
            if (ring > 0 && Math.abs(ox) !== ring && Math.abs(oz) !== ring) continue;
            const tx = x + ox * CELL;
            const tz = z + oz * CELL;
            if (!b.footprintClear(tx, tz, f.w, f.h)) continue;
            if (!b.footprintBuildable(tx, tz, f.w, f.h)) continue;
            return { x: tx, z: tz };
          }
        }
      }
      if (b.findClearFootprint(x, z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return { x, z };
    };

    const raise = (
      owner: PlayerId, key: string, x: number, z: number,
      tag: string | null, yawDeg: number, clear: number,
    ): { id: EntityId; x: number; z: number } => {
      const where = place(owner, key, x, z);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    /* ==================================================================
     * 1. THE TWO OPENINGS
     *
     * Both garrisoned, which is the difference from `reclamation-held-paper`
     * and is the right call here: this operation wants a live opponent with
     * an economy and an army, because the scripted waves are a floor on the
     * pressure and not the whole of it. The player's own garrison is what
     * they choose FROM — eleven combat units against a rule that lets four of
     * them past the checkpoint. Section 5 carries the count and how it was
     * taken.
     * ================================================================== */
    buildBaseFor(b, player, home.x, home.z, {
      facingDeg: wrapDeg(home.facingDeg + 180),
    });
    buildBaseFor(b, district, foe.x, foe.z, {
      facingDeg: wrapDeg(foe.facingDeg + 180),
    });

    /* ==================================================================
     * 2. THE OFFICE
     * ================================================================== */
    const officeNominal = {
      x: home.x + nx * len * OFFICE_ALONG + px * OFFICE_OFFSET,
      z: home.z + nz * len * OFFICE_ALONG + pz * OFFICE_OFFSET,
    };

    /*
     * `civApartments` — 8 x 12 m under a 15 m roofline, the tallest thing in
     * the civilian block and the only one whose silhouette is a building
     * somebody WORKS in. The derrick is a rig, the mine is a headframe and the
     * hospital wears an ambulance canopy and a helipad; a survey office is an
     * office, and this is the only one of the four that reads as one.
     *
     * Neutral, by construction rather than by choice — `civilian()` in
     * `Scenarios.ts` builds every one of these on the `Faction.Neutral` row —
     * which is exactly what rule 1 of `Capture.ts` wants. See the header.
     */
    const office = raise(
      b.gaia, 'civApartments', officeNominal.x, officeNominal.z,
      'office', 0, OFFICE_CLEAR,
    );

    /*
     * THE APPROACH FRAME, TAKEN FROM WHERE THE OFFICE ACTUALLY WENT.
     *
     * `t` is the unit vector from the office back toward the player's opening
     * and `q` is its left perpendicular, so `spot(u, v)` is `u` metres toward
     * home and `v` metres across. Derived AFTER the placement search rather
     * than from the nominal point, because a gun line laid out around a
     * building that moved 12 m to find flat ground is a gun line with a hole
     * in it that nobody authored.
     */
    const bx = home.x - office.x;
    const bz = home.z - office.z;
    const blen = Math.max(1e-3, Math.sqrt(bx * bx + bz * bz));
    const tx = bx / blen;
    const tz = bz / blen;
    const qx = -tz;
    const qz = tx;
    const spot = (u: number, v: number): { x: number; z: number } => ({
      x: office.x + tx * u + qx * v,
      z: office.z + tz * u + qz * v,
    });

    // Bearing from the district toward the player, so every gun faces the
    // street it was put there to watch. `atan2` feeds a yaw and nothing else —
    // see the trigonometry note in the header.
    const outward = wrapDeg(Math.atan2(tx, tz) * (180 / Math.PI));

    /* ==================================================================
     * 3. THE CORDON
     *
     * `pillbox` is the ROLE key. `keyFor` resolves it to the seated army's
     * cheap emplacement — `sentryGun` for the Soviets this operation names —
     * and both candidates fire `pillboxMg`, so the silhouette changes and the
     * 22 m does not. It is untagged in `UNLOCK_TAGS`, so the operation's
     * allow-list roster cannot refuse one: a refused `spawnBuilding` returns
     * NONE, the tag lands on nothing, and `entityHpBelow` would then read a
     * cordon that is not there.
     * ================================================================== */
    for (const [u, v] of GUNS) {
      const p = spot(u, v);
      raise(district, 'pillbox', p.x, p.z, 'cordon', outward, GUN_CLEAR);
    }

    /*
     * A short run of wall across the middle of the approach, 24 m of frontage
     * on a 1x1-cell segment. It seals nothing and it is not meant to: it is
     * where the district thinks its front is, which is the one piece of
     * information this whole operation turns on, and it says so at the exact
     * place the direct line crosses.
     *
     * **CENTRED ON THE AXIS RATHER THAN LAID ALONG A FLANK, AND THAT IS THE
     * FIX RATHER THAN THE TASTE.** A draft ran it from v = -78 to v = -58,
     * which is the -v end of the bow — i.e. straight across one of the two
     * ways round. `spawnBuilding` marks the cells occupied, so that is a real
     * nav barrier and it would have narrowed the seam the operation's whole
     * detour measurement is taken on, silently, in a file that never mentions
     * walls. Centred, it touches neither end: the segments land at u 56.0 to
     * 60.6 and v -6.7 to +11.1 once the placement search has nudged each one
     * onto buildable ground — a ragged run rather than a straight fence, which
     * is what a wall built by a district looks like — and the operation's
     * 350.7 m arc-free route is measured WITH them standing.
     */
    const wallKey = b.keyFor(district, 'wall');
    const wallStep = Math.max(1, b.footprintOf(wallKey).w) * CELL;
    for (let i = 0; i < 6; i++) {
      const v = (i - 2.5) * wallStep;
      const p = spot(58, v);
      const w = place(district, 'wall', p.x, p.z);
      b.spawnBuilding('wall', district, w.x, w.z, { yawDeg: outward });
      b.block(w.x, w.z, 2.5);
    }

    /* ==================================================================
     * 4. THE DERRICK
     *
     * Neutral, inside the disc, named by exactly one trigger and required by
     * none. See the header for why it is INSIDE rather than past the
     * objective the way A1's is.
     * ================================================================== */
    const dp = spot(DERRICK_UV[0], DERRICK_UV[1]);
    raise(b.gaia, 'civOilDerrick', dp.x, dp.z, 'derrick', outward, 18);

    /*
     * The Works mast, beside its own office. `civOreMine` is the key
     * `allies-sounding-line` established as Works hardware one operation ago —
     * a headframe the Works sank before the Split — and it is here for the
     * same reason it is there: the silhouette is what tells a player that this
     * particular block is the one the briefing is about. Untagged and named by
     * nothing; it is a landmark, not a mechanism.
     */
    const mast = place(b.gaia, 'civOreMine', spot(-24, 22).x, spot(-24, 22).z);
    b.spawnBuilding('civOreMine', b.gaia, mast.x, mast.z, { yawDeg: wrapDeg(outward + 40) });
    b.block(mast.x, mast.z, 14);

    /* ==================================================================
     * 5. NO PICKET, AND THE CUT IS MEASURED RATHER THAN TIDY
     *
     * A rifle section stood behind the wall in a draft of this file. It is
     * gone, for two reasons that point the same way.
     *
     * IT WOULD NOT HAVE BEEN THERE. `AiBrain.census` files every idle hull an
     * AI seat owns into `armyIds` and `regroupSquads` files that into a squad
     * within a minute or two; `soviets.02.common-standard` measured its two
     * parked Wardens 117 and 129 m from the ground they were placed to hold
     * after twenty seconds. A section posed as district presence is a section
     * that has left before the player can see it, and the guns are the
     * presence that cannot leave.
     *
     * AND IT MOVED A COUNT THAT MATTERS. Built with the def tables BOUND and
     * this operation's roster IN FORCE — the only state in which either is
     * true — the two openings are **11 combat units against 11**: four Wardens,
     * two Sabre IFVs and five G.I.s for the player against five Anvils and six
     * Conscripts for the district, with the Attack Dogs and the Sledge Tank
     * refused by `ai: []` and the IFVs kept by `player: ['unit.raider']`. Four
     * more Conscripts made it 11 against 15 and turned an even fight behind a
     * gun line into one the player cannot take at all — which would delete the
     * loud route rather than pricing it. `allies-sounding-line` records the
     * same trap from the other side: counting your own content as the
     * opponent's inheritance is how a handout acquires an argument.
     * ================================================================== */

    /* ==================================================================
     * 6. ORE
     *
     * Three fields, all on the far side of the lane from the district, for
     * the reason in the header: a harvester inside the cordon is a unit
     * inside the cordon.
     * ================================================================== */
    b.addOre(home.x - px * 48 + nx * 26, home.z - pz * 48 + nz * 26, 30);
    b.addOre(foe.x - px * 48 - nx * 26, foe.z - pz * 48 - nz * 26, 30);
    b.addOre(
      home.x + nx * len * 0.5 - px * 78,
      home.z + nz * len * 0.5 - pz * 78,
      24,
    );

    /* ==================================================================
     * 7. DRESSING AND THE OPENING FRAME
     * ================================================================== */
    // Two cold hulks on the approach, where the district's front would have
    // been argued about once already. Not burning: the Split was weeks ago.
    for (const sign of [1, -1]) {
      const w = spot(96, 40 * sign);
      b.spawnWreck(w.x, w.z, sign > 0 ? Faction.Soviets : Faction.Allies, false);
    }

    b.scatter({
      minX: Math.min(home.x, foe.x, office.x) - 90,
      minZ: Math.min(home.z, foe.z, office.z) - 90,
      maxX: Math.max(home.x, foe.x, office.x) + 90,
      maxZ: Math.max(home.z, foe.z, office.z) + 90,
    }, 165);

    // Biased toward the district, so the opening frame holds the base and the
    // direction the operation is in rather than the back of the yard.
    b.setCameraFocus(
      home.x + (office.x - home.x) * 0.16,
      home.z + (office.z - home.z) * 0.16,
    );
    void start;
  },
});
