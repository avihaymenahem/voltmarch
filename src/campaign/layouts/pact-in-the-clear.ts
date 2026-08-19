/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-in-the-clear.ts
 * ============================================================================
 * THE GROUND FOR `pact.04.in-the-clear`: a Pact drill head in the open, an
 * Allied survey mast on the rise beside it, two Pact posts in front of it and an
 * Allied forward camp two thirds of the way to the enemy opening.
 *
 * **THIS FILE OWNS EVERY NUMBER THE OPERATION HEADER ARGUES.** That header
 * quotes OUTPUTS — 80.00 m between the hole and the witness, 22.1 m to each
 * post, 26.1 m from the camp to the drop point, 139.31 m from the player's
 * opening to the collar — and all of them are consequences of nine constants
 * declared below. It shipped once with a three-line placeholder where this
 * argument should be, so a re-seed had outputs to compare against and no premise
 * to re-derive them from. What follows is that premise.
 *
 * Everything is measured on a headless build at `mapSeed` 41 602 /
 * `simSeed` 3 489 with the def tables BOUND and this operation's roster
 * INSTALLED — `tests/campaign-roster-ground.spec.ts`'s build, not
 * `tests/campaign-maps.spec.ts`'s, which passes no `defs` and installs no
 * roster. Ground truth is the real `Terrain`, the real `FlowFieldCache
 * .costGridFor`, and the entity store AFTER `spawnBuilding` snapped every
 * footprint. **RE-MEASURE, DO NOT RE-QUOTE**, if either seed moves.
 *
 * ============================================================================
 * 1. THE FRAME
 * ============================================================================
 * `simSeed` 3 489 draws the DIAGONAL pair, so the two openings are as far apart
 * as this game ever puts them:
 *
 *     home (Pact, seat 0)   404, 380
 *     foe  (Allies, seat 1) 108, 132
 *     axis                  386.161 m
 *
 * Every point in this file is `at(n, p)`: `n` metres along the unit vector from
 * home to foe, `p` metres along its LEFT perpendicular. Two consequences worth
 * knowing before changing anything. Positive `n` is toward the enemy, so
 * `GUN_BACK` puts the posts in FRONT of the head and `MAST_BACK` pulls the mast
 * back toward home. And `snow` has no `MAP_SEAS` row, so `islandSeats` hands
 * back the raw start spots; `foe = seats[1] ?? seats[0]` is the one-army guard
 * and nothing else in the file branches on the seat count.
 *
 * ============================================================================
 * 2. THE COLLAR — `TAP_ALONG` 0.34, `TAP_OFFSET` 26
 * ============================================================================
 *     anchor requested   320.06, 275.75      placed   316, 272   (moved 5.53 m)
 *
 *     home -> collar   139.31 m straight   159.8 m of Track path
 *     foe  -> collar   250.73 m straight   287.3 m of Track path
 *     ROAD -> collar    96.04 m straight   110.9 m of Track path
 *
 * **0.34 IS THE FRACTION THAT MAKES DEFENDING IT A DECISION.** The player's
 * base garrison walks 159.8 m to reach it — 21.0 s for a Solarch at 7.6 m/s,
 * 42.1 s for a Wayfarer at 3.8 — so the lot is not an extension of the base and
 * a commander who leaves it empty arrives late. From the other side it is
 * 287.3 m of path, which is why a column is an event rather than a constant: a
 * Warden crosses from `ROAD` in 16.8 s and would need 43.5 s from the Allied
 * opening, which is why the waves are dropped at `ROAD` at all.
 *
 * **`TAP_OFFSET` 26 IS PAIRED WITH `LOT_R` = 28 IN `04-in-the-clear.ts`, AND
 * THE TWO LIVE IN DIFFERENT FILES.** The collar stands 26 m off the
 * opening-to-opening axis and the hidden secondary's disc has radius 28, so the
 * axis CUTS the disc across a chord of `2 * sqrt(28^2 - 26^2)` = **20.78 m**.
 * Anything walking the straight line between the two bases is on the lot, which
 * is what stops `stand` being won by standing aside and waving a column
 * through. At `TAP_OFFSET` >= 28 the axis misses the disc entirely and the bonus
 * stops asking a question. **Change either constant and change both notes.**
 *
 * ============================================================================
 * 3. THE MAST — `MAST_SIDE` 78 IS DERIVED, `MAST_BACK` 14 IS A TRIM
 * ============================================================================
 *     mast requested   380.88, 224.95      placed   380, 224   (moved 1.30 m)
 *
 * The placed offsets from the collar are (64, -48) — a 3-4-5 triangle scaled by
 * sixteen — so the gap the whole operation turns on is **exactly 80.000 m**
 * against a requested `hypot(14, 78)` = 79.246.
 *
 * **THE FLOOR IS ARITHMETIC AND IT IS THE REASON 78 IS NOT 60.** A parked Pact
 * hull opens fire on a 2x2 structure at `range * 0.80 + 18 + 5.6569` of centre
 * distance, which for the 26 m `focusLance` is **44.4569 m** — the binding bar,
 * derived in the operation header. No cell of the lot may sit inside it, and the
 * lot reaches 28 m from the collar, so `tap -> mast` must be at least
 * `28 + 44.4569` = **72.457 m**, i.e. `MAST_SIDE >= sqrt(72.457^2 - 14^2)` =
 * **71.09**. Swept through the real frame:
 *
 *     MAST_SIDE   tap -> mast   rim -> mast   vs the 44.4569 m bar
 *        60          61.61         33.61      ACQUIRES — the player loses by
 *        65          66.49         38.49      ACQUIRES   parking on his own lot
 *        69.3        70.70         42.70      ACQUIRES
 *        71.1        72.47         44.47      clear by 0.01
 *        74          75.31         47.31      clear
 *        78          79.25         51.25      clear by 6.79   <- shipped
 *        88          89.11         61.11      clear
 *
 * On the REAL open cells the margin is larger than the rim figure, because the
 * nearest open cell toward the mast is 26.26 m from the collar rather than 28:
 * measured 53.74 m to the mast against the 44.4569 bar, **9.28 m of margin**,
 * with 0 of the 149 open lot cells inside it. Below 71.09 the operation hands
 * the player its own losing condition for standing where it told him to stand,
 * which is why the survey band in `04-in-the-clear.ts` starts at 74 rather than
 * at the floor.
 *
 * **THE UPPER END OF THE BAND IS A JUDGEMENT AND IS LABELLED AS ONE.** `radar`
 * carries `sight: 44`, so at 80.00 m the mast watches the approach and stops
 * 36.0 m short of the collar; past about 88 it is a building in another part of
 * the map, outside the 40 m reveal `t.open` spends on the rise. Nothing
 * measurable breaks there. It is legibility, not arithmetic.
 *
 * **`MAST_BACK` 14 CHANGES ALMOST NOTHING, AND SAYING SO IS THE HONEST
 * ARGUMENT.** Swept over the same frame with `MAST_SIDE` held at 78, measuring
 * from the PLACED collar to the REQUESTED mast (the table above is
 * requested-to-requested, `hypot(MAST_BACK, MAST_SIDE)`; these two columns are
 * not the same quantity and mixing them is how a header drifts):
 *
 *     MAST_BACK   collar -> mast   nearest point of the ROAD -> collar chord
 *       -14           78.19        the collar, 78.19 m at t = 1.00
 *         0           77.93        the collar, 77.93 m at t = 1.00
 *        14           80.14        the collar, 80.14 m at t = 1.00  <- shipped,
 *        28           84.65        the collar, 84.65 m at t = 1.00     80.000
 *        42           91.11        the collar, 91.11 m at t = 1.00     once placed
 *
 * The mast is off the enemy's approach at EVERY value — the nearest point of
 * that chord is the collar itself in all five cases — so `MAST_BACK` buys no
 * safety property. What it does is trim the requested gap onto 79.25 and the
 * placed gap onto 80.000. Anything in roughly [-14, +28] is legal and moves
 * nothing else; 14 is the value that lands the round number.
 *
 * **AND THE MAST IS A LONG WALK, WHICH IS THE THIRD THING KEEPING IT SAFE.**
 * The ground between drops to -7.0 m at 48 m out and comes back to +0.1 at 72,
 * and that basin is impassable: the mast is **164.7 m of Track path** from a
 * collar 80.00 m away in a straight line. A hull ordered onto the instrument
 * takes about twenty-two seconds to get there.
 *
 * ============================================================================
 * 4. THE GUN LINE — `GUN_BACK` 20, `GUN_SPREAD` 15
 * ============================================================================
 *     requested   295.09, 274.40   and   314.36, 251.41
 *     placed      294, 274 (moved 1.15)  314, 250 (moved 1.44)
 *
 * `keyFor` remaps `pillbox` on a Meridian seat to `mrdGlaive`, so these are
 * Glaive Posts — 24 m of `glaiveRepeater`, 17.0 dps against a Warden and 60.8
 * against infantry. Decomposed on the frame, each stands **15.6 m toward the
 * enemy and 15.6 m across**, 22.09 m from the placed collar. Two consequences,
 * both of which the operation header spends:
 *
 *   - their cover ends **39.6 m** in front of the head (15.6 + 24), which is the
 *     forward bound on where a player's line can usefully stand;
 *   - and they can never reach the mast. An emplacement's own bar is
 *     `24 * 1.08 + 5.657` = **31.58 m** (`Targeting.reachOf` returns 0 for
 *     something that cannot chase) and the NEARER post is **70.94 m** from the
 *     mast — clear by 39.4 m. **That is the safety property `GUN_BACK` and
 *     `GUN_SPREAD` exist to hold**, because a post is the one gun in the match
 *     the player never orders: it fires on whatever `Targeting` hands it.
 *
 * ============================================================================
 * 5. THE HOLDING FORCE — THE UNITS THE OPERATION'S dps TABLE IS ABOUT
 * ============================================================================
 * Three `mrdSolarch` at `anchor + n*10 + p*-14` (spacing 9, columns 3) and four
 * `mrdWayfarer` at `anchor - n*8 + p*-20` (spacing 5, columns 4). Measured from
 * the placed collar:
 *
 *     Solarchs    6.59   15.19   23.73        all three inside `LOT_R`
 *     Wayfarers  18.25   21.89   26.81  30.97  the fourth is 2.97 m outside it
 *
 * The fourth Wayfarer standing outside the disc costs nothing: `LOT_R` counts
 * ALLIED units, so a Pact hull is never on the wrong side of it. Against one
 * Warden this force plus the two posts delivers `3 x 30.0 + 4 x 10.5 +
 * 2 x 17.0` = **166.0 dps**, which is the breakdown the operation header argues
 * the fight from — and the reason the Wayfarer row of that table had to be
 * right. Nothing here is inside the mast's envelope: the nearest player HULL is
 * a Solarch at **85.92 m** against its own 44.46 bar, and the nearest player
 * asset of any kind is a Glaive Post at 70.94 m against 31.58.
 *
 * ============================================================================
 * 6. THE CAMP — `CAMP_ALONG` 0.66, `CAMP_OFFSET` 12
 * ============================================================================
 *     camp requested   216.35, 207.12      placed   220, 200   (moved 8.00 m)
 *
 *     camp -> ROAD    26.08 m      camp -> collar  120.00 m (129.8 walked)
 *     camp -> foe    131.03 m      camp -> mast    161.79 m
 *
 * 0.66 puts it two thirds of the way to the Allied opening, which is what makes
 * `ROAD` — the drop point every wave forms on, 26.08 m away — read as coming
 * OUT of the camp rather than out of nowhere. It is also what gives the 500
 * credit secondary teeth: levelling it deletes the fourth column, because
 * `t.fourth` is gated on `entityAlive 'camp'`.
 *
 * The camp brings an Allied Pillbox 20 m from it ON THE COLLAR SIDE — `-n` is
 * toward home, so the post faces the player rather than sitting behind the
 * camp — and three `gi` on `Stance.Defensive`, which is what keeps them holding
 * the camp instead of walking the 129.8 m to the collar on their own.
 * `keyFor` leaves `pillbox` alone on an Allied seat, so this one is the 22 m
 * Allied Pillbox rather than the Glaive Post the same key builds on seat 0.
 *
 * ============================================================================
 * 7. `PLACE_RINGS` 7 — A FALLBACK WITH A 28 m BOUND
 * ============================================================================
 * `place` walks outward ring by ring for ground the footprint can legally stand
 * on, testing `footprintClear` AND `footprintBuildable`. Seven rings at `CELL`
 * 4 is **28 m of silent displacement per structure** — numerically the same as
 * `LOT_R`, which is a coincidence and a useful one to hold in mind: a head that
 * used the whole search could end up a full lot radius from where the file put
 * it, and every distance in this header would be wrong with nothing failing.
 *
 * **NOTHING ON THIS SEED NEEDS IT.** Measured requested-to-placed displacement
 * for all five structures: collar 5.53 m, mast 1.30, camp 8.00, posts 1.15 and
 * 1.44 — two cells at worst, most of which is `spawnBuilding`'s own footprint
 * snapping rather than the ring search.
 *
 * **THE FAILURE MODE IS A TAG THAT NEVER STAMPS.** If the rings find nothing,
 * `place` tries `findClearFootprint` and, failing that, returns the RAW point;
 * `spawnBuilding` then runs the SAME `findClearFootprint` from it and returns
 * `NONE` when that fails too. `LayoutContext.tag` silently ignores `NONE`, so
 * the structure is simply absent — and `entityDead` on an absent tag reads TRUE
 * from tick one, which fails the player at t = 0 with no message. Two gates
 * catch it: `tests/campaign-maps.spec.ts` builds every operation headless and
 * compares the declared tag list against what actually landed, and
 * `tests/campaign-roster-ground.spec.ts` does the same with the roster
 * installed, which is the path where `isBuildable` can refuse a def outright.
 *
 * ============================================================================
 * 8. THE GROUND, AND WHAT IT COSTS TO RE-SEED
 * ============================================================================
 *     16 384 cells: 12 018 foot-passable, 4 366 closed, 27 water (0.16%),
 *     306 hover-passable and not foot-passable
 *     ONE Track region of 11 922 cells, containing every named point
 *     the lot: 156 cells whose centre is inside `LOT_R`, 149 of them open —
 *       and the same 149 for Foot, Track and Hover
 *     ore: three declared fields (r 30 at 418,335; r 30 at 94,177; the
 *       contested r 22 at 256,256) and the nearest edge is 12.10 m OUTSIDE the
 *       lot rim, so no harvester is ever parked on the collar
 *
 * `b.block` clearances — 18 on the collar, 16 on the mast, 10 on each post, 22
 * on the camp, 15 and 13 on the two formations — keep `b.scatter`'s 150 props
 * out of the fight rather than out of the frame; the scatter box is the four
 * named points expanded by 80 m.
 *
 * **WHAT A RE-SEED HAS TO RE-CHECK, IN ORDER.** The `MAST_SIDE` floor (is
 * `tap -> mast` still >= 72.457, and is every open lot cell still outside
 * 44.4569 of the mast); the chord (`TAP_OFFSET` < `LOT_R`); the ring points of
 * all four waves at `ROAD`, which `tests/campaign-spawn-ground.spec.ts` fails by
 * name; and the walked path lengths, which the operation header paces its four
 * waves from and which nothing checks at all.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/**
 * The tap lot. Fraction of the opening-to-opening line — 131.29 m of a 386.161 m
 * axis, which is 159.8 m of walked path from the player's opening and 287.3 m
 * from the enemy's. Header §2.
 */
const TAP_ALONG = 0.34;
/**
 * Metres off that axis, on the left-hand perpendicular of home -> foe.
 *
 * PAIRED WITH `LOT_R` = 28 IN `operations/pact/04-in-the-clear.ts`: 26 < 28, so
 * the axis cuts the lot across a 20.78 m chord and a column cannot avoid it by
 * marching straight. Change one and change the other. Header §2.
 */
const TAP_OFFSET = 26;

/**
 * Metres the Allied mast stands back toward home from the tap's station.
 *
 * A TRIM, NOT A LEVER — every value in [-14, +28] leaves the mast off the
 * enemy's approach and inside the survey band; 14 is what lands the placed gap
 * on exactly 80.000 m. Header §3.
 */
const MAST_BACK = 14;
/**
 * Metres further across the axis than the tap.
 *
 * DERIVED, AND THE FLOOR IS 71.09: below it a lot cell sits inside a parked
 * Solarch's 44.4569 m acquisition bar and the operation hands the player its own
 * losing condition for standing where it told him to. Header §3.
 */
const MAST_SIDE = 78;

/**
 * Metres the Pact gun line stands on the foe side of the tap. With `GUN_SPREAD`
 * it puts each post 15.6 m toward the enemy and 15.6 m across, 22.09 m from the
 * head: cover to 39.6 m in front of it, and 70.94 m from the mast against an
 * emplacement's own 31.58 m bar. Header §4.
 */
const GUN_BACK = 20;
/** Metres between the two posts, across the axis. See `GUN_BACK`. */
const GUN_SPREAD = 15;

/**
 * The Allied forward camp: two thirds of the way to their opening, 26.08 m from
 * the `ROAD` drop point every wave forms on, 120.00 m from the collar.
 * Header §6.
 */
const CAMP_ALONG = 0.66;
const CAMP_OFFSET = 12;

/**
 * Cells searched outward for ground a footprint can legally stand on. Seven at
 * `CELL` 4 bounds silent displacement at 28 m per structure; nothing on this
 * seed moves more than 8.00 m, and the failure mode past the search is a tag
 * that never stamps. Header §7.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-in-the-clear',

  tags: ['tap', 'mast', 'camp', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    const pact: PlayerId = c.seat(0);
    const allies: PlayerId = c.seat(1);
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    /* -- the frame -------------------------------------------------------- */
    const dx = foe.x - home.x;
    const dz = foe.z - home.z;
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    const nx = dx / len;
    const nz = dz / len;
    const px = -nz;
    const pz = nx;

    /** Metres along the axis, metres across it. */
    const at = (n: number, p: number): { x: number; z: number } => ({
      x: home.x + nx * n + px * p,
      z: home.z + nz * n + pz * p,
    });

    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));
    const outward = wrapDeg(inward + 180);

    const scratch = new Float32Array(2);
    const place = (
      owner: PlayerId, key: string, p: { x: number; z: number },
    ): { x: number; z: number } => {
      const f = b.footprintOf(b.keyFor(owner, key));
      for (let ring = 0; ring <= PLACE_RINGS; ring++) {
        for (let oz = -ring; oz <= ring; oz++) {
          for (let ox = -ring; ox <= ring; ox++) {
            if (ring > 0 && Math.abs(ox) !== ring && Math.abs(oz) !== ring) continue;
            const tx = p.x + ox * CELL;
            const tz = p.z + oz * CELL;
            if (!b.footprintClear(tx, tz, f.w, f.h)) continue;
            if (!b.footprintBuildable(tx, tz, f.w, f.h)) continue;
            return { x: tx, z: tz };
          }
        }
      }
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    const raise = (
      owner: PlayerId, key: string, p: { x: number; z: number },
      tag: string | null, yawDeg: number, clear: number,
    ): { id: EntityId; x: number; z: number } => {
      const where = place(owner, key, p);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    /* -- the two openings ------------------------------------------------- */
    buildBaseFor(b, pact, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, allies, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the lot ---------------------------------------------------------- */
    const anchor = at(len * TAP_ALONG, TAP_OFFSET);
    const tap = raise(pact, 'civOreMine', anchor, 'tap', outward, 18);

    raise(
      allies, 'radar',
      { x: anchor.x - nx * MAST_BACK + px * MAST_SIDE, z: anchor.z - nz * MAST_BACK + pz * MAST_SIDE },
      'mast', inward, 16,
    );

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      raise(
        pact, 'pillbox',
        {
          x: anchor.x + nx * GUN_BACK + px * (s * GUN_SPREAD),
          z: anchor.z + nz * GUN_BACK + pz * (s * GUN_SPREAD),
        },
        null, inward, 10,
      );
    }

    /* -- the holding force ------------------------------------------------ */
    const armour = { x: anchor.x + nx * 10 + px * -14, z: anchor.z + nz * 10 + pz * -14 };
    b.formation('mrdSolarch', pact, armour.x, armour.z, 3, {
      yawDeg: inward, spacing: 9, columns: 3, jitter: 0.5,
    });
    b.block(armour.x, armour.z, 15);
    const screen = { x: anchor.x - nx * 8 + px * -20, z: anchor.z - nz * 8 + pz * -20 };
    b.formation('mrdWayfarer', pact, screen.x, screen.z, 4, {
      yawDeg: inward, spacing: 5, columns: 4, jitter: 0.6,
    });
    b.block(screen.x, screen.z, 13);

    /* -- the Allied forward camp ------------------------------------------ */
    const camp = raise(
      allies, 'barracks', at(len * CAMP_ALONG, CAMP_OFFSET), 'camp', outward, 22,
    );
    raise(
      allies, 'pillbox',
      { x: camp.x - nx * 20, z: camp.z - nz * 20 }, null, outward, 10,
    );

    for (let i = 0; i < 3; i++) {
      const q = {
        x: camp.x - nx * (10 + i * 6) + px * (16 + (i % 2) * 6),
        z: camp.z - nz * (10 + i * 6) + pz * (16 + (i % 2) * 6),
      };
      b.spawnUnit('gi', allies, q.x, q.z, { yawDeg: outward, stance: Stance.Defensive });
    }

    /* -- ore and dressing -------------------------------------------------- */
    addStartOre(b, spots, b.sea);

    const minX = Math.min(home.x, foe.x, tap.x, camp.x) - 80;
    const maxX = Math.max(home.x, foe.x, tap.x, camp.x) + 80;
    const minZ = Math.min(home.z, foe.z, tap.z, camp.z) - 80;
    const maxZ = Math.max(home.z, foe.z, tap.z, camp.z) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    b.setCameraFocus(tap.x, tap.z);
    void start;
  },
});
