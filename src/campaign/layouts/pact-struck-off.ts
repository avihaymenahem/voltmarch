/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-struck-off.ts
 * ============================================================================
 * THE GROUND FOR `pact.08.struck-off`: `pact.07.thin-place`'s parcel nine days
 * later, with the two burned collars hauled away, the eleven-house pan still
 * standing on it, a replacement cutting head on a cradle on the works road well
 * outside the rim, and the Order's whole estate reduced to a dish and a solar
 * array on the near side of the crust.
 *
 * **THIS FILE OWNS EVERY NUMBER THE OPERATION HEADER ARGUES.** That header
 * quotes OUTPUTS — 116.00 m from the station to the parcel centre, 72.40 m of
 * rim clearance at the head, 83.3 / 93.7 / 69.0 m of walking inside the rim,
 * 102.7 m to an Arcspitter Post's own standoff, 28.6 m of rim clearance on the
 * enemy road — and every one of them is a consequence of the ten constants
 * declared below.
 *
 * Everything is measured on a headless build at `mapSeed` 20 130 /
 * `simSeed` 3 733 with the def tables BOUND and this operation's roster
 * INSTALLED — `tests/campaign-roster-ground.spec.ts`'s build, not
 * `tests/campaign-maps.spec.ts`'s, which passes no `defs` and installs no
 * roster. Ground truth is the real `Terrain`, the real
 * `FlowFieldCache.costGridFor`, and the entity store AFTER `spawnBuilding`
 * snapped every footprint. **RE-MEASURE, DO NOT RE-QUOTE**, if either seed
 * moves.
 *
 * ============================================================================
 * 1. THE FRAME, AND IT IS P7's FRAME EXACTLY
 * ============================================================================
 * `simSeed` 3 733 draws the DIAGONAL pair, so the two openings are as far apart
 * as this game ever puts them:
 *
 *     home (Pact, seat 0)          108, 380
 *     foe  (Reclamation, seat 1)   404, 132
 *     axis                         386.161 m
 *
 * Every point in this file is `at(n, p)`: `n` metres along the unit vector from
 * home to foe, `p` metres along its LEFT perpendicular. `arid` has no `MAP_SEAS`
 * row, so `islandSeats` hands back the raw start spots and
 * `foe = seats[1] ?? seats[0]` is the one-army guard; nothing else branches on
 * the seat count.
 *
 * **THE SEEDS ARE `pact-thin-place.ts`'s AND THAT IS THE POINT.** Terrain is a
 * function of `mapSeed` and the reserved shelves, and `startPointsFor(2, null,
 * 3 733)` is the same call in both files, so the heightfield, both openings and
 * the ore are identical to the metre — which is what lets the operation say
 * "the same pan, nine days later" about the pixels rather than only about the
 * prose. The three holdings below land on the same three points P7's header
 * publishes.
 *
 * The ground, on the real cost grid: **3 281 of 16 384 cells are `COST_BLOCKED`
 * for Foot, 3 360 for Wheel and 3 293 for Hover.** Three different numbers,
 * which is the control that the instrument can see walls at all — a Dijkstra
 * built on a mis-imported `COST_BLOCKED` walks through buildings and returns
 * plausible, uniformly slightly-short routes and a green test.
 *
 * ============================================================================
 * 2. THE PARCEL AND THE PAN — `WORKS_ALONG` 0.62, `WORKS_OFFSET` 96,
 *    `HAMLET_SPREAD` 18
 * ============================================================================
 * All three are P7's, unchanged, and they must stay that way for as long as
 * both files claim to be about one piece of ground:
 *
 *     works requested   353.17, 299.83     placed centre   352, 300
 *     terrace     civApartments   placed 352, 298
 *     well        civOilDerrick   placed 364, 312
 *     infirmary   civHospital     placed 342, 288
 *
 * `PARCEL.r` 62 lives in `operations/pact/08-struck-off.ts` and is likewise
 * P7's. The placed centre sits **95.38 m** off the opening-to-opening axis, so
 * the rim clears the direct road between the two bases by **33.38 m** — the same
 * inversion of `pact.04.in-the-clear`'s pairing that P5 and P7 make, and for the
 * same reason: this bonus is about the player's own hulls and must not be
 * failable by driving straight.
 *
 * **WHAT IS DIFFERENT FROM P7 IS WHAT IS NOT HERE.** Its two `civOreMine`
 * collars stood 40 m apart on this disc; the salvage house has bought them as
 * scrap and hauled them, which is the fiction's reason and is also why the
 * parcel measures **740 cells, 710 open** here against P7's 740 / 702 — and the
 * 710 is the same for Foot, Wheel and Hover, so "the parcel" is one number
 * rather than three.
 *
 * **THE THREE HOLDINGS ARE THE THREE LIFT POINTS.** `EffectSink.spawnUnits`
 * writes its ring point VERBATIM, so what has to be standable is the ring
 * itself: eleven drops on 16 m rings around these three, and every one is open
 * to `Locomotor.Foot`. Checked at 10, 12, 14, 16, 18, 20 and 22 m as well, and
 * all seven radii clear — so the authored 16 is comfortably inside a band rather
 * than the one value that happens to work.
 *
 * ============================================================================
 * 3. THE STATION — `STATION_ALONG` 0.39, `STATION_OFFSET` 20
 * ============================================================================
 *     mrdOculus    placed 236, 300      mrdSolarArray   placed 248, 312
 *     muster (authored in the operation) 226, 306
 *
 *     station -> parcel centre   116.00 m   (54.00 m outside the rim)
 *     muster  -> parcel centre   126.14 m   (64.14; the shelter disc is r 20,
 *                                            so its nearest point is 44.14 out)
 *     home -> station            150.94 straight, 180.6 walked
 *
 * **0.39 AND 20 WERE RETUNED ONCE, AND THE REASON IS THE ONLY THING IN THIS
 * FILE A CHORD WOULD HAVE GOT WRONG.** The first siting put the dish at
 * (0.38, 59) — 92.35 m from the parcel centre, on the far side of it from the
 * salvage house — and the Wheel route from their staging point to it passed
 * **42.4 m from the parcel centre, i.e. 19.6 m INSIDE the rim** (that figure is
 * about a siting that no longer exists and cannot be re-derived from the shipped
 * constants; it is kept as the reason for the move and nothing else). Their
 * columns would have crossed the pan on ground the Order may not follow them
 * onto, and the escort would have been a spectator sport. At (0.39, 20) the
 * route from `STAGE` to the muster passes **90.6 m — 28.6 m OUTSIDE** the rim.
 *
 * **THAT 90.6 IS THE NEAREST OF 263 CELLS ON THE COST-OPTIMAL SET, NOT THE
 * NEAREST POINT OF ONE RECONSTRUCTED CHAIN** — trap 18's rule — and it reads
 * the same on Wheel and on Foot, at (290, 234). **§3 PUBLISHED 82.0 AND 20.0
 * WHILE §5 BELOW PUBLISHED 90.6 AND 28.6 IN THE SAME FILE**, and §8's re-seed
 * checklist guarded the wrong one, so a re-seeder comparing against 20.0 would
 * have accepted an 8.6 m regression as clearance. 90.6 is the measured number.
 *
 * **AND THE STRAIGHT LINE WOULD STILL HAVE MISSED IT.** The chord from `STAGE`
 * to the muster passes 103.1 m from the parcel centre, 41.1 m clear; the route
 * the engine's own expander produces bends inward and passes 90.6. Twelve and a
 * half metres of clearance a chord credits and the ground does not — measure the
 * ROUTE, and measure it to the point the columns are ORDERED to. (The chord to
 * the STATION is 99.6 m; comparing that against a route to the MUSTER is how the
 * old "seventeen and a half metres" was arrived at, and it mixed two endpoints.)
 *
 * **THE SOLAR ARRAY IS NOT DRESSING.** `mrdOculus` draws **-40** and
 * `mrdSolarArray` produces **+160**, so seat 0's grid runs at **+120** and
 * `EvaLine.lowPower` never fires. Without it the announcer reports a deficit
 * every forty-five seconds for twenty minutes — a defect no trigger table can
 * see and a boot can. It is sited at `+ p * 16` rather than back down the axis
 * because the first placement landed 6.6 m from the muster point and the eleven
 * households would have pathed around it; at 23.3 m it is out of their way.
 *
 * ============================================================================
 * 4. THE HEAD AND ITS PICKET — `HEAD_ALONG` 0.65, `HEAD_OFFSET` -40,
 *    `PICKET_ACROSS` 20
 * ============================================================================
 *     civOreMine   placed 272, 192          700 hp, ArmorClass.Concrete, 2x2
 *     rclSpitpost  placed 282, 206          17.20 m from the head
 *     rclSpitpost  placed 258, 178          19.80 m from the head
 *     rclPicker    at 267.94, 207.51        16.03 m   85 hp, arcProd 14 m
 *     rclPicker    at 256.91, 203.70        19.09 m   Stance.Defensive
 *     rclPicker    at 245.89, 199.89        27.27 m
 *
 *     head -> parcel centre  134.40 m   (72.40 m outside the rim)
 *     head -> home           249.48 straight, 263.7 walked
 *     head -> muster         122.93 straight, 137.5 walked
 *     head -> foe            145.00 m
 *
 * **THE 72.40 m IS THE WHOLE REASON THE OBJECTIVE IS SITED HERE.** Nothing about
 * taking the head touches the concession, which is what makes *stopping a lawful
 * excavation from off the ground* a sentence about geometry rather than a figure
 * of speech.
 *
 * **THE PICKET IS FIVE THINGS AND THIS SECTION LISTED TWO.** The `for` loop
 * three lines under the two `pillbox` calls stands three `rclPicker` on the
 * collar, and they were absent from this header and from the operation's while
 * every exposure figure in both was measured against the posts alone. They are
 * the units that actually cover the standoff: against a `mrdSolarch`'s 2.79 m
 * hull radius a Picker reaches **16.79 m** (`arcProd` 14 plus the target's own
 * `hitRadius`, which is all `Combat.engage` subtracts) and a post reaches
 * **22.79 m**; against a 0.234 m infantry radius, 14.23 and 20.23. A single
 * "22.5 m" for both classes, which is what the first draft used, is right for
 * neither.
 *
 * **`PICKET_ACROSS` 20 PUTS THE POSTS ON THE OBJECTIVE, AND THE APPROACH IS
 * COVERED TOO — WHICH IS THE OPPOSITE OF WHAT THIS SECTION USED TO CLAIM.**
 * `Targeting.approach()` does not route to a chosen standoff cell: it writes the
 * TARGET's centre into `orderX/orderZ` and parks the tick surface distance first
 * reaches `range * APPROACH_STOP_FRAC` 0.80, so the hull walks the ordinary
 * route at the collar and stops on it. Measured over the cost-optimal
 * muster -> head route on the real Hover grid, the five reachable park cells sit
 * at bearings 85.6-114.4 degrees off the head with **-8.37 m to +0.53 m** of
 * margin against the near post's envelope and 6.0-9.3 m of surface distance to
 * the nearest Picker. The 26.457 m ring is **63.9% covered** by the posts alone
 * and the bearing from the head to the muster is **112.0 degrees, one degree
 * short of the free window**.
 *
 * The old instrument still reproduces and still means nothing: 38 open Hover
 * cells in the band, 13 outside 22.79 m of both posts (14 at 22.5), cheapest
 * route to one of them 102.9 m with 0.0 m exposed, and 11 of the 38 still
 * reachable with both discs shut. Nothing is ever sent to those cells.
 *
 * **WHAT THE SPACING DOES BUY IS THE POST-FIRST DOCTRINE, AND THAT ONE IS
 * ARITHMETIC.** A Solarch ordered at a POST parks at 20.8 + `hitRadius(1x1)`
 * 2.8284 = **23.6284 m** against `postCoil`'s reach of 20 + 2.79 = **22.7900** —
 * 0.8384 m of margin with no ground in it. Walked from the muster it holds:
 * park (261.83, 218.17) after 102.7 m, 20.77 m of surface distance, **0.0 m of
 * the approach inside either post**, far post 40.36 m away; the second post from
 * (237.83, 190.17) after 120.7 m, again 0.0 m exposed. `PICKET_ACROSS` 20 is
 * what keeps the two posts 36.88 m apart, which is what makes each of them a
 * separate problem instead of one overlapping one. Move either inward and they
 * start covering each other's standoff; move them outward and they stop covering
 * the objective at all.
 *
 * Driven onto the collar instead, the walk is 137.5 m with **32.0 m inside at
 * least one post's envelope** (29.2 m at an infantry radius), ending under both
 * posts and all three Pickers.
 *
 * ============================================================================
 * 5. THE STAGING POINT — `STAGE_ALONG` 0.842, `STAGE_OFFSET` -40.3
 * ============================================================================
 *     placed 331.35, 140.29    d(foe) 73.12   d(head) 78.72
 *                              d(parcel) 161.04   d(station) 186.01
 *
 * **SEARCHED, NOT CHOSEN.** `ProductionService.spawnUnit` writes the ring point
 * verbatim, so the four press rings the operation uses — (4, 14) and (5, 18) on
 * Wheel for the `rclGrinder` halves, (5, 22) and (6, 26) on Foot for the
 * `rclPicker` halves — all have to land on open ground. **84 of 961 candidates
 * on a 2 m grid in a 60 m box clear all four**, and these two constants place
 * the authored point exactly on one of them. The first guess, (0.80, -46), was
 * NOT one: three of the four rings had a drop on closed ground.
 *
 * The Wheel route from here to the muster is **207.1 m** (35.7 s at an
 * `rclGrinder`'s 5.8 m/s, 57.5 s at an `rclPicker`'s 3.6) and its closest
 * approach to the parcel centre — taken over all 263 cells of the cost-optimal
 * set rather than off one reconstructed chain — is **90.6 m, 28.6 m outside the
 * rim**, at (290, 234). §3 above and the operation header both used to publish
 * 82.0 / 20.0 against this same paragraph; 90.6 is the measurement.
 *
 * ============================================================================
 * 6. THE COLUMN — EIGHTEEN HULLS, ALL UNTAGGED DEFS, ON PURPOSE
 * ============================================================================
 *                               weapon      range  dps: Concrete / Infantry
 *     6 x mrdSolarch   330 hp   focusLance   26 m   16.500 / 10.50
 *     3 x mrdLancer    130 hp   sunLance     26 m   17.400 / 10.63
 *     6 x mrdWayfarer  110 hp   pulseCarbine 20 m    6.750 / 37.50
 *     3 x mrdArtificer  95 hp   unarmed, `canCapture`
 *
 * **THE SECOND COLUMN IS WHY THE CARBINES ARE NOT PADDING.** The three
 * `rclPicker` on the collar are 85 hp `ArmorClass.Infantry`, so a Wayfarer takes
 * one down in 2.27 s while a Solarch needs 8.10 — and a Solarch under an
 * explicit Attack order will not shoot at them at all, because
 * `Targeting.resolveTarget` returns the moment a live ordered target resolves.
 * The lances take the posts and the collar; the carbines take the guards.
 *
 * `buildBaseFor` is called for seat 1 and NOT for seat 0 — `opening: 'force'`
 * is honoured by that omission, which is why there is no third
 * `START_CONDITIONS` member and must not be.
 *
 * **EVERY KEY IN THE COLUMN CARRIES NO `unlockedBy`, AND THAT IS LOAD-BEARING
 * RATHER THAN INCIDENTAL.** `ScenarioBuilder.spawnUnit` asks `isBuildable` and
 * SKIPS a refused def with no throw and no log, so the operation's empty
 * `roster.player` would silently shorten a fixed force if any of these four
 * were tagged. `mrdZenith` (`unit.specialist`), `mrdSkiff` (`unit.raider`) and
 * `mrdKestrel` (`unit.air`) are the three Meridian hulls that would have done
 * it, and none of them is here.
 *
 * The three `mrdArtificer` are one short of what the soften ladder alone needs
 * (0.20 of max per spent man, so 700 -> 560 -> 420 -> 280 and the FOURTH
 * captures), which is deliberate and is argued in the operation's capture block:
 * the column can take the head only by shooting it under half first.
 *
 * ============================================================================
 * 7. `PLACE_RINGS` 7 — A FALLBACK WITH A 28 m BOUND
 * ============================================================================
 * `place` walks outward ring by ring for ground the footprint can legally stand
 * on, testing `footprintClear` AND `footprintBuildable` — the second of which
 * matters here, because `findClearFootprint` asks nothing about slope and the
 * band a road threads is frequently passable-and-not-buildable. Seven rings at
 * `CELL` 4 is **28 m of silent displacement per structure**, which is more than
 * the 20 m between a post and its head, so a picket that used the whole search
 * would stop covering the objective with nothing failing.
 *
 * **NOTHING ON THIS SEED NEEDS IT.** Every placement above landed within half a
 * cell of the point this file asked for, most of which is `spawnBuilding`'s own
 * footprint snapping rather than the ring search.
 *
 * **THE FAILURE MODE IS A TAG THAT NEVER STAMPS.** If the rings find nothing,
 * `place` tries `findClearFootprint` and, failing that, returns the RAW point;
 * `spawnBuilding` then runs the SAME `findClearFootprint` from it and returns
 * `NONE` when that fails too. `LayoutContext.tag` silently ignores `NONE`, so
 * the structure is simply absent — and `ownerCount(1, 'building', 'head',
 * max: 0)` on an absent tag reads TRUE from tick one, which would complete this
 * operation's `head` primary at t = 0 with no message. Two gates catch it:
 * `tests/campaign-maps.spec.ts` compares the declared tag list against what
 * landed, and `tests/campaign-roster-ground.spec.ts` does the same with the
 * roster installed, which is the path where `isBuildable` can refuse a def
 * outright.
 *
 * ============================================================================
 * 8. WHAT A RE-SEED HAS TO RE-CHECK, IN ORDER
 * ============================================================================
 *   - the three holdings stay inside the rim and their 16 m drop rings stay
 *     open to Foot, or a lift spawns on rock;
 *   - the worst in-rim walk stays under the operation's forty-five second
 *     grace and over its eighteen second warning — 27.6 s and 20.3 s today, at
 *     an `engineer`'s 3.4 m/s;
 *   - the Wheel route from `STAGE` to the muster stays OUTSIDE the rim at its
 *     closest approach — **28.6 m today, measured over the cost-optimal set**,
 *     and this line said 20.0 while §5 said 28.6, so a re-seeder would have
 *     accepted an 8.6 m regression as clearance;
 *   - the head stays clear of the rim (72.40 m today), or taking it starts
 *     costing the concession;
 *   - both posts stay inside `postCoil`'s 20 m of the head, so the objective is
 *     covered, AND a Solarch's own standoff against a POST stays outside
 *     `postCoil`'s reach of it — 23.6284 against 22.7900 today, which is
 *     arithmetic and moves only if `focusLance`, `postCoil`,
 *     `APPROACH_STOP_FRAC` or the hull radius does — and the walked approach to
 *     each post's standoff stays at 0.0 m exposed;
 *   - the three `rclPicker` stay where a re-seed leaves them relative to the
 *     collar, and their 16.79 m envelope against a Solarch is re-derived rather
 *     than re-quoted;
 *   - the four press rings at `STAGE`, which
 *     `tests/campaign-spawn-ground.spec.ts` fails by name;
 *   - and the walked route lengths, which the operation paces its lifts and its
 *     columns from and which nothing checks at all.
 *
 * `b.block` clearances — 14 on the terrace, 12 on the other two holdings, 20 on
 * the dish, 12 on the array, 16 on the head, 10 on each post and 30 on the drop
 * point — keep `b.scatter`'s 150 props out of the arithmetic rather than out of
 * the frame; no prop carries `EntityFlag.BlocksNav` and `terrain.isPassable`
 * never sees one, so a column would arrive anyway. It would arrive in a thicket.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/**
 * The parcel, as a fraction of the opening-to-opening axis, and the metres off
 * it on the left-hand perpendicular.
 *
 * BOTH ARE `pact-thin-place.ts`'s AND MUST STAY THAT WAY while two operations
 * claim to be about one piece of ground. Together they place the centre at
 * 352, 300 — 95.38 m off the axis, so a 62 m rim clears the direct road between
 * the two bases by 33.38 m. Header §2.
 */
const WORKS_ALONG = 0.62;
const WORKS_OFFSET = 96;
/**
 * Metres the well and the infirmary stand either side of the terrace, across
 * the axis. P7's, unchanged: it is what puts the three holdings on 352, 298 /
 * 364, 312 / 342, 288, which are the three lift points. Header §2.
 */
const HAMLET_SPREAD = 18;
/**
 * The Order's reading station and muster.
 *
 * RETUNED FROM (0.38, 59), WHICH SAT ON THE FAR SIDE OF THE PARCEL FROM THE
 * SALVAGE HOUSE and made their Wheel route to it pass 19.6 m INSIDE the rim —
 * ground the Order may not follow them onto. At (0.39, 20) the route from
 * `STAGE` to the muster passes 28.6 m outside it, measured over the whole
 * cost-optimal set. Header §3.
 */
const STATION_ALONG = 0.39;
const STATION_OFFSET = 20;
/**
 * The replacement head on its cradle. 0.65 and -40 put it at 272, 192: 134.40 m
 * from the parcel centre, so **72.40 m outside the rim**, which is what makes
 * the primary reachable without spending the concession. Header §4.
 */
const HEAD_ALONG = 0.65;
const HEAD_OFFSET = -40;
/**
 * Metres each Arcspitter Post stands off the head, across the axis.
 *
 * TUNED SO EACH POST COVERS THE OBJECTIVE AND NEITHER COVERS THE OTHER'S
 * STANDOFF. `postCoil` is 20 m, so 20 m off the head keeps both on it; 20 either
 * side puts them 36.88 m apart, against a Solarch's 23.6284 m standoff on a post
 * and that post's 22.7900 m reach on the Solarch, so a hull taking one is
 * 40.36 m from the other. **It does NOT keep the picket off the approach to the
 * HEAD** — `approach()` parks on the ordinary route rather than at a chosen
 * cell, and 63.9% of the head's standoff ring is covered. Header §4.
 */
const PICKET_ACROSS = 20;
/**
 * Where every Reclamation column forms up.
 *
 * SEARCHED, NOT CHOSEN. 84 of 961 candidates on a 2 m grid land all four press
 * rings on ground their own locomotor can enter and these two constants pick one
 * of them; the first guess, (0.80, -46), was not one. Header §5.
 */
const STAGE_ALONG = 0.842;
const STAGE_OFFSET = -40.3;
/**
 * Cells searched outward for ground a footprint can legally stand on. Seven at
 * `CELL` 4 bounds silent displacement at 28 m per structure, which is MORE than
 * the 20 m between a post and the head it guards; nothing on this seed moves
 * more than half a cell. Header §7.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-struck-off',

  tags: ['station', 'head', 'terrace', 'well', 'infirmary', 'household', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    const order: PlayerId = c.seat(0);
    const house: PlayerId = c.seat(1);
    const gaia: PlayerId = b.gaia;
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    const dx = foe.x - home.x;
    const dz = foe.z - home.z;
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    const nx = dx / len;
    const nz = dz / len;
    const px = -nz;
    const pz = nx;

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
      tags: readonly string[], yawDeg: number, clear: number,
    ): { id: EntityId; x: number; z: number } => {
      const where = place(owner, key, p);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      for (const t of tags) c.tag(t, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    /* -- the salvage house's opening. The Order builds nothing. ------------ */
    buildBaseFor(b, house, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the parcel and the pan -------------------------------------------- */
    const works = at(len * WORKS_ALONG, WORKS_OFFSET);
    raise(gaia, 'civApartments', works, ['terrace'], inward, 14);
    raise(
      gaia, 'civOilDerrick',
      { x: works.x + px * HAMLET_SPREAD, z: works.z + pz * HAMLET_SPREAD },
      ['well'], inward, 12,
    );
    raise(
      gaia, 'civHospital',
      { x: works.x - px * HAMLET_SPREAD, z: works.z - pz * HAMLET_SPREAD },
      ['infirmary'], inward, 12,
    );

    /* -- the Order's reading station, off the crust ------------------------ */
    const station = raise(
      order, 'mrdOculus', at(len * STATION_ALONG, STATION_OFFSET), ['station'], inward, 20,
    );
    raise(
      order, 'powerPlant',
      { x: station.x + px * 16, z: station.z + pz * 16 }, [], inward, 12,
    );

    /* -- the head on its cradle, on the road ------------------------------- */
    const head = raise(
      house, 'civOreMine', at(len * HEAD_ALONG, HEAD_OFFSET), ['head'], outward, 16,
    );
    raise(
      house, 'pillbox',
      { x: head.x + px * PICKET_ACROSS, z: head.z + pz * PICKET_ACROSS }, [], outward, 10,
    );
    raise(
      house, 'pillbox',
      { x: head.x - px * PICKET_ACROSS, z: head.z - pz * PICKET_ACROSS }, [], outward, 10,
    );
    /*
     * THE THIRD LAYER OF THE PICKET, AND IT WENT UNDOCUMENTED IN BOTH HEADERS
     * WHILE EVERY EXPOSURE FIGURE IN THEM WAS MEASURED AGAINST THE POSTS ALONE.
     * Three `rclPicker` land at 16.03, 19.09 and 27.27 m of the collar, on the
     * muster side of it — 85 hp, `arcProd` 14 m, which is 16.79 m of reach
     * against a `mrdSolarch`'s 2.79 m hull radius and 14.23 against infantry.
     * They are what actually covers the head's standoff ring: two of the three
     * reach every park cell `approach()` can leave a hull on. Header §4 measures
     * it; `tests/campaign-emplacement-reach.spec.ts` §1 does not see them,
     * because that roster pins EMPLACEMENTS and these are units.
     */
    for (let i = 0; i < 3; i++) {
      const q = {
        x: head.x - nx * (12 + i * 6) + px * (10 - i * 10),
        z: head.z - nz * (12 + i * 6) + pz * (10 - i * 10),
      };
      b.spawnUnit('rclPicker', house, q.x, q.z, { yawDeg: outward, stance: Stance.Defensive });
    }

    /* -- the Order's column ------------------------------------------------ */
    const COLUMN: readonly { key: string; n: number; p: number }[] = [
      { key: 'mrdSolarch', n: 34, p: -18 },
      { key: 'mrdSolarch', n: 34, p: -6 },
      { key: 'mrdSolarch', n: 34, p: 6 },
      { key: 'mrdSolarch', n: 34, p: 18 },
      { key: 'mrdSolarch', n: 24, p: -12 },
      { key: 'mrdSolarch', n: 24, p: 12 },
      { key: 'mrdLancer', n: 24, p: -24 },
      { key: 'mrdLancer', n: 24, p: 0 },
      { key: 'mrdLancer', n: 24, p: 24 },
      { key: 'mrdWayfarer', n: 14, p: -18 },
      { key: 'mrdWayfarer', n: 14, p: -6 },
      { key: 'mrdWayfarer', n: 14, p: 6 },
      { key: 'mrdWayfarer', n: 14, p: 18 },
      { key: 'mrdWayfarer', n: 6, p: -12 },
      { key: 'mrdWayfarer', n: 6, p: 12 },
      { key: 'mrdArtificer', n: 6, p: -24 },
      { key: 'mrdArtificer', n: 6, p: 0 },
      { key: 'mrdArtificer', n: 6, p: 24 },
    ];
    for (const row of COLUMN) {
      const q = at(row.n, row.p);
      b.spawnUnit(row.key, order, q.x, q.z, { yawDeg: home.facingDeg, stance: Stance.Defensive });
    }

    /* -- ore and dressing --------------------------------------------------- */
    addStartOre(b, spots, b.sea);

    const stage = at(len * STAGE_ALONG, STAGE_OFFSET);
    b.block(stage.x, stage.z, 30);

    const minX = Math.min(home.x, foe.x, works.x, head.x, station.x) - 80;
    const maxX = Math.max(home.x, foe.x, works.x, head.x, station.x) + 80;
    const minZ = Math.min(home.z, foe.z, works.z, head.z, station.z) - 80;
    const maxZ = Math.max(home.z, foe.z, works.z, head.z, station.z) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    b.setCameraFocus(home.x, home.z);
    void start;
  },
});
