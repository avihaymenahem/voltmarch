/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-thin-place.ts
 * ============================================================================
 * THE GROUND FOR `pact.07.thin-place`: two Soviet cutting heads sunk forty
 * metres apart over the thinnest crust on the coast, an eleven-house hamlet
 * standing between them on ground that has just stopped belonging to anybody,
 * and the Ninth's allocation office two thirds of the way to their opening.
 *
 * **THIS FILE OWNS EVERY NUMBER THE OPERATION HEADER ARGUES.** That header
 * quotes OUTPUTS — 40.00 m between the two collars, 21.26 and 18.87 m from the
 * terrace to them, 42.00 m from the parcel rim to the nearest head, 95.38 m of
 * axis clearance — and every one of them is a consequence of the eight
 * constants declared below. What follows is that premise.
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
 * 1. THE FRAME
 * ============================================================================
 * `simSeed` 3 733 draws the DIAGONAL pair, so the two openings are as far apart
 * as this game ever puts them:
 *
 *     home (Pact, seat 0)     108, 380
 *     foe  (Soviets, seat 1)  404, 132
 *     axis                    386.161 m
 *
 * Every point in this file is `at(n, p)`: `n` metres along the unit vector from
 * home to foe, `p` metres along its LEFT perpendicular. Positive `n` is toward
 * the enemy, so `ROAD_AHEAD` puts the drop point BEYOND the office and the
 * office's own pillbox — placed at `-n * 18` — faces back down the road toward
 * the player. `arid` has no `MAP_SEAS` row, so `islandSeats` hands back the raw
 * start spots and `foe = seats[1] ?? seats[0]` is the one-army guard; nothing
 * else in the file branches on the seat count.
 *
 * The ground: **13 034 of 16 384 cells are foot-passable (79.6%) and 3 350 are
 * closed**, and 13 034 + 3 350 = 16 384 — a census whose rows do not sum to
 * `MAP_CELL_COUNT` is wrong on its face, which `pact-concession.ts` records
 * paying for.
 *
 * ============================================================================
 * 2. THE PARCEL — `WORKS_ALONG` 0.62, `WORKS_OFFSET` 96
 * ============================================================================
 *     works requested   353.17, 299.83     placed centre   352, 300
 *
 *     parcel centre -> home   256.78 m straight   289.1 m of Track path
 *     parcel centre -> foe    175.86 m
 *     nearest rim point -> either head          42.00 m
 *
 * **0.62 AND 96 ARE BOTH BOUNDED, AND BY DIFFERENT THINGS.** The fraction puts
 * the parcel 81 m closer to the Ninth than to the player, which is the whole of
 * the raid pricing in `07-thin-place.ts`: a column sent onto the parcel is
 * making a 289 m journey each way past an enemy base at 176 m.
 *
 * **`WORKS_OFFSET` 96 IS PAIRED WITH `PARCEL.r` = 62 IN
 * `operations/pact/07-thin-place.ts`, AND THE TWO CONSTANTS LIVE IN DIFFERENT
 * FILES.** The placed centre sits **95.38 m** off the opening-to-opening axis
 * (measured as the perpendicular distance to the segment, nearest at t = 0.617),
 * so the rim clears the direct road between the two bases by **33.38 m** and
 * ordinary traffic can never fail the concession bonus. That is the deliberate
 * INVERSION of `pact.04.in-the-clear`, which pairs `TAP_OFFSET` 26 with
 * `LOT_R` 28 so that the axis CUTS its disc — because ITS bonus is about an
 * enemy column and must not be winnable by standing aside, while THIS one is
 * about the player's own hulls and must not be failable by driving straight.
 * `pact.05.open-count` made the same inversion for the same reason. **Change
 * either number and change both notes.**
 *
 * ============================================================================
 * 3. THE TWO HEADS — `HEAD_SPACING` 40
 * ============================================================================
 *     head A   placed 336, 312       head B   placed 368, 288
 *     separation                     40.000 m, requested and placed
 *
 * **40 IS DERIVED FROM THE BLAST, NOT CHOSEN.** A `civOreMine` is 700 hp of
 * `ArmorClass.Concrete` with `hitRadius` 5.6569, and `SUPERWEAPONS[SolarLance]`
 * delivers `1400 * falloff * 1.00 * 0.80`; solving
 * `0.22 + 0.78 * (1 - surface/24)^1.6 >= 700/1120` gives a kill out to
 * **13.724 m of centre distance**. Bisected against the real `DamageSystem` on
 * the built ground — a record pushed onto `channels.damage` and `damageTick`
 * resolving it — the engine's own answer is **13.7257 m** for both collars; the
 * two differ by 2 mm because `applySplash` counts the vertical gap between the
 * impact point and the hull, which the closed form above does not. So ONE blast
 * takes BOTH heads if and only if some point lies within 13.7257 m of each, i.e.
 * if and only if they stand **27.45 m apart or less**. At 40.00 the margin is
 * 12.55 m — 46% — and the operation's premise (two heads, two charges, nothing
 * spare) holds by construction rather than by hope.
 *
 * The upper bound is §4: the terrace has to sit inside the blast of BOTH heads
 * for the aim-off decision to exist, and it cannot be equidistant at 20 m from
 * two collars more than 40 m apart.
 *
 * ============================================================================
 * 4. THE HAMLET — `HAMLET_SPREAD` 18
 * ============================================================================
 *     terrace     civApartments   placed 352, 298   to heads 21.26 / 18.87
 *     well        civOilDerrick   placed 364, 312   to heads 28.00 / 24.33
 *     infirmary   civHospital     placed 342, 288   to heads 24.74 / 26.00
 *
 * The terrace goes on the parcel centre and the other two flank it at
 * `+/- HAMLET_SPREAD` across the axis, which is what produces the three
 * distances above — and those three distances ARE the operation's second
 * decision. Driven against the real `DamageSystem` on this ground:
 *
 *                      hp      blast on A   on B    both centred    both 10 m out
 *     terrace         800        460.0      547.9      1 007.9  DIES     267.5
 *     well            900        258.5      325.0        583.5           0.0
 *     infirmary     1 100        353.7      322.3        676.0           0.0
 *
 * **EXACTLY ONE HOLDING CAN DIE**, which is the property `HAMLET_SPREAD` is
 * tuned for: at a wider spread the terrace survives two centred blasts and the
 * primary stops asking anything; at a narrower one the first blast kills it and
 * the player is punished before being shown. 18 is where one centred shot leaves
 * the terrace at 340 or 252 of 800 — visible, alive — and the second kills it.
 * The well and the infirmary cannot die at all: two blasts can take at most
 * 583.5 of 900 and 676.0 of 1 100.
 *
 * **THIS BLOCK USED TO SAY "AND ONLY TO THE SECOND CENTRED SHOT", AND THAT IS
 * FALSE.** Eleven of sixty-four sampled aim pairs kill the terrace, including
 * three that use an offset the operation used to call safe; `07-thin-place.ts`
 * carries the whole measured matrix and the bisected lethal set. Two numbers
 * from it belong here because they are consequences of `HAMLET_SPREAD` rather
 * than of the trigger table:
 *
 *   - `nukeSplashFalloff` 0.22 is a FLOOR, not a taper, so the least a Concrete
 *     victim inside the ring can take is `1400 * 0.22 * 0.80` = **246.40** and
 *     one centimetre further out it takes **zero**. The edge is a cliff.
 *   - The terrace therefore leaves the blast entirely past **9.951 m** out on
 *     head A and past **12.343 m** on head B, both inside the 13.7257 m kill
 *     band — so a perfectly placed pair costs the hamlet nothing at all. The
 *     2.39 m of asymmetry between those two radii is exactly the 21.26 / 18.87
 *     split above, i.e. it is `HAMLET_SPREAD`'s doing, and the window it leaves
 *     on head B is **1.38 m** wide.
 *
 * **THEY ARE GAIA AND NOTHING IN THE MATCH WILL EVER AIM AT THEM**, which is the
 * sentence the whole operation rests on: `ScenarioBuilder.gaia` allies the
 * Neutral slot to everybody in both directions and `Targeting.isValidTarget`
 * refuses ALLIES, so no gun on either side is ever handed a holding as a target.
 * That is a statement about TARGETING and not about splash: the parcel is
 * forbidden ground rather than unreachable ground, and a player who pays the
 * concession to raid it does fire inside the hamlet. `07-thin-place.ts` carries
 * the veto (`captureProof`), that residual, and the four routes onto the parcel
 * the concession cannot forbid.
 *
 * Placement is tight — a 2x3 terrace with a 2x2 head 20 m away leaves 10 m of
 * gap on the axis — and it held: the five parcel structures placed **2.0, 1.1,
 * 2.2, 1.8 and 2.0 m** from the points this file asked for, which is at worst
 * half a cell of `spawnBuilding`'s own footprint snapping.
 *
 * ============================================================================
 * 5. THE OFFICE AND THE ROAD — `OFFICE_ALONG` 0.74, `ROAD_AHEAD` 18
 * ============================================================================
 *     office   placed 328, 196        ROAD   344.69, 189.52
 *
 *     office -> foe     99.36 m       office -> ROAD      17.90 m
 *     office -> home   286.80 m (312.4 walked)   office -> parcel   106.73 m
 *
 * 0.74 puts the office two thirds of the way to the Soviet opening, close
 * enough that taking it is a fight at the edge of their base and far enough that
 * it is not simply their base. It is 106.73 m from the parcel centre — **44.73 m
 * outside the rim** — so a player assaulting it is never within forty metres of
 * failing the concession, which is the reason it is not sited on the parcel side
 * of the axis.
 *
 * The office brings one `pillbox` 18 m back toward home, which `keyFor`
 * resolves on a Soviet seat to a **Sentry Gun** — placed 19.8 m from the office,
 * so its 22 m of `pillboxMg` covers the building the secondary is about — and
 * three `conscript` on `Stance.Defensive`, which is what keeps them holding the
 * office instead of walking the 312 m to the player on their own.
 *
 * **`ROAD` WAS SEARCHED, NOT CHOSEN, BECAUSE `ProductionService.spawnUnit`
 * WRITES THE RING POINT VERBATIM.** No `connectedGround`, no egress search: the
 * points that have to be standable are the ring points themselves. 999
 * candidates on a 2 m grid around the office were scored on whether EVERY ring
 * point of all four columns is open to that unit's own locomotor — (4, 14) and
 * (5, 18) on Track for the `rhino` halves, (5, 22) and (6, 26) on Foot for the
 * `conscript` halves, 20 distinct points carrying 34 drops — and **102 of the
 * 999 cleared it.** This is the nearest of the 102 to the office, which is what
 * makes a column read as coming out of the building rather than out of nowhere.
 *
 * ============================================================================
 * 6. `PLACE_RINGS` 7 — A FALLBACK WITH A 28 m BOUND
 * ============================================================================
 * `place` walks outward ring by ring for ground the footprint can legally stand
 * on, testing `footprintClear` AND `footprintBuildable`. Seven rings at `CELL` 4
 * is **28 m of silent displacement per structure** — and here that is not an
 * abstract worry, because 28 m is more than the 21.26 m the whole aim-off
 * decision is built on. A head that used the whole search would put the terrace
 * outside the blast and every number in §4 would be wrong with nothing failing.
 *
 * **NOTHING ON THIS SEED NEEDS IT.** Measured requested-to-placed displacement
 * for all six structures: 2.0, 1.1, 2.2, 1.8, 2.0 and 1.1 m — half a cell at
 * worst, most of which is `spawnBuilding`'s own footprint snapping rather than
 * the ring search.
 *
 * **THE FAILURE MODE IS A TAG THAT NEVER STAMPS.** If the rings find nothing,
 * `place` tries `findClearFootprint` and, failing that, returns the RAW point;
 * `spawnBuilding` then runs the SAME `findClearFootprint` from it and returns
 * `NONE` when that fails too. `LayoutContext.tag` silently ignores `NONE`, so
 * the structure is simply absent — and `entityDead` on an absent tag reads TRUE
 * from tick one, which would fail this operation's `hamlet` primary at t = 0
 * with no message. Two gates catch it: `tests/campaign-maps.spec.ts` builds
 * every operation headless and compares the declared tag list against what
 * actually landed, and `tests/campaign-roster-ground.spec.ts` does the same with
 * the roster installed, which is the path where `isBuildable` can refuse a def
 * outright.
 *
 * ============================================================================
 * 7. WHAT A RE-SEED HAS TO RE-CHECK, IN ORDER
 * ============================================================================
 *   - the head separation stays above 27.45 m, or one charge takes both;
 *   - the terrace stays 17 to 22 m from BOTH heads, or the aim-off decision
 *     becomes either free or unfair;
 *   - the two radii past which the terrace takes NOTHING — 9.951 m out on head A
 *     and 12.343 m on head B — both stay inside the 13.7257 m kill band, or a
 *     perfect line stops existing and the operation can only be won by paying;
 *   - the terrace's rim-floor fraction stays under `t.singed`'s `frac`. It is
 *     `(800 - 246.40) / 800` = 0.6920 against 0.70, and that threshold is
 *     DERIVED from it: change `civApartments`' hp or `nukeSplashFalloff` and the
 *     warning stops meaning "a blast reached the roofs";
 *   - the well and the infirmary stay past 24 m from both, or a centred pair
 *     kills something the player was never warned about;
 *   - `PARCEL.r` still exceeds `20 + 31.657`, so no 26 m gun reaches a head from
 *     legal ground;
 *   - no ore inside the rim — the nearest edge here is **83.6 m from the parcel
 *     centre, 21.6 m outside it**, and a harvester is an `EntityKind.Vehicle`,
 *     so a field inside the disc would fail the concession bonus on its own, in
 *     silence, at whatever minute the economy chose;
 *   - the ring points at `ROAD`, which `tests/campaign-spawn-ground.spec.ts`
 *     fails by name;
 *   - and the walked path lengths, which the operation header paces its four
 *     columns from and which nothing checks at all.
 *
 * The parcel as shipped holds **740 cells whose centre is inside 62 m of the
 * placed centre, 702 of them open — and the same 702 for Foot and Track, 703 for
 * Hover** — so "the parcel" is one number rather than three.
 *
 * `b.block` clearances — 16 on each head, 14 on the terrace, 12 on the other two
 * holdings, 22 on the office, 10 on its post — keep `b.scatter`'s 150 props out
 * of the blast arithmetic rather than out of the frame; the scatter box is the
 * four named points expanded by 80 m.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/**
 * The bought parcel, as a fraction of the opening-to-opening axis. 0.62 puts it
 * 256.78 m from the player and 175.86 m from the Ninth, which is what makes a
 * raid onto it a journey rather than a sortie. Header §2.
 */
const WORKS_ALONG = 0.62;
/**
 * Metres off that axis, on the left-hand perpendicular of home -> foe.
 *
 * PAIRED WITH `PARCEL.r` = 62 IN `operations/pact/07-thin-place.ts`: the placed
 * centre lands 95.38 m off the axis, so the rim clears the direct road between
 * the two bases by 33.38 m and ordinary traffic cannot fail the concession.
 * This is the deliberate inversion of `pact.04.in-the-clear`'s pairing. Change
 * one and change the other. Header §2.
 */
const WORKS_OFFSET = 96;
/**
 * Metres between the two cutting heads, along the axis.
 *
 * DERIVED: a Solar Lance kills a 700 hp `civOreMine` out to 13.724 m of centre
 * distance, so one blast takes both if and only if they stand 27.45 m apart or
 * less. 40 clears that by 12.55 m and is the largest spacing that still leaves
 * the terrace inside both blasts. Header §3.
 */
const HEAD_SPACING = 40;
/**
 * Metres the well and the infirmary stand either side of the terrace, across
 * the axis. TUNED: it is what puts the terrace 21.26 / 18.87 m from the two
 * collars — dead to two centred blasts, alive to one — and the other two past
 * 24 m, where a centred pair leaves them at a third and a shot ten metres out
 * leaves them untouched. It is also what sets the two radii past which the
 * terrace takes nothing at all (9.951 m on head A, 12.343 m on head B) and the
 * 2.39 m of asymmetry between them. Header §4.
 */
const HAMLET_SPREAD = 18;
/**
 * The Ninth's allocation office, as a fraction of the axis. 0.74 puts it 99.36 m
 * from their opening and 106.73 m from the parcel centre — 44.73 m outside the
 * rim, so the assault the second secondary asks for never approaches the
 * concession. Header §5.
 */
const OFFICE_ALONG = 0.74;
const OFFICE_OFFSET = 0;
/**
 * Metres beyond the office, toward the enemy, that every column forms up, and
 * metres across the axis from it. SEARCHED: 102 of 999 candidates on a 2 m grid
 * land all 34 drops of all four columns on ground their own locomotor can enter,
 * and this is the nearest of the 102 to the office, at 17.90 m. Header §5.
 */
const ROAD_AHEAD = 18;
const ROAD_ACROSS = 6;
/**
 * Cells searched outward for ground a footprint can legally stand on. Seven at
 * `CELL` 4 bounds silent displacement at 28 m per structure, which is MORE than
 * the 21.26 m the aim-off decision rests on; nothing on this seed moves more
 * than 2.2 m. Header §6.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-thin-place',

  tags: ['head', 'hamlet', 'terrace', 'well', 'infirmary', 'register', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    const pact: PlayerId = c.seat(0);
    const ninth: PlayerId = c.seat(1);
    const gaia: PlayerId = b.gaia;
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

    /* -- the two openings ------------------------------------------------- */
    buildBaseFor(b, pact, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, ninth, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the parcel ------------------------------------------------------- */
    const works = at(len * WORKS_ALONG, WORKS_OFFSET);
    const half = HEAD_SPACING * 0.5;

    raise(
      ninth, 'civOreMine',
      { x: works.x - nx * half, z: works.z - nz * half },
      ['head'], outward, 16,
    );
    raise(
      ninth, 'civOreMine',
      { x: works.x + nx * half, z: works.z + nz * half },
      ['head'], outward, 16,
    );

    raise(gaia, 'civApartments', works, ['hamlet', 'terrace'], inward, 14);
    raise(
      gaia, 'civOilDerrick',
      { x: works.x + px * HAMLET_SPREAD, z: works.z + pz * HAMLET_SPREAD },
      ['hamlet', 'well'], inward, 12,
    );
    raise(
      gaia, 'civHospital',
      { x: works.x - px * HAMLET_SPREAD, z: works.z - pz * HAMLET_SPREAD },
      ['hamlet', 'infirmary'], inward, 12,
    );

    /* -- the allocation office -------------------------------------------- */
    const office = raise(
      ninth, 'barracks', at(len * OFFICE_ALONG, OFFICE_OFFSET), ['register'], outward, 22,
    );
    raise(
      ninth, 'pillbox',
      { x: office.x - nx * 18, z: office.z - nz * 18 }, [], outward, 10,
    );
    for (let i = 0; i < 3; i++) {
      const q = {
        x: office.x - nx * (10 + i * 6) + px * (16 + (i % 2) * 6),
        z: office.z - nz * (10 + i * 6) + pz * (16 + (i % 2) * 6),
      };
      b.spawnUnit('conscript', ninth, q.x, q.z, { yawDeg: outward, stance: Stance.Defensive });
    }

    /* -- ore and dressing -------------------------------------------------- */
    addStartOre(b, spots, b.sea);

    /*
     * THE DROP POINT IS RESERVED BEFORE THE SCATTER RUNS, AND IT IS THE ONLY
     * REASON THESE TWO CONSTANTS LIVE IN THIS FILE.
     *
     * `07-thin-place.ts` hard-codes the measured `ROAD` the way `pact.04` and
     * `pact.05` hard-code theirs, so nothing here computes a point the operation
     * reads. What this does is keep `b.scatter`'s 150 props off the widest drop
     * ring (26 m), which is a legibility rather than a passability question — no
     * prop carries `EntityFlag.BlocksNav` and `terrain.isPassable` never sees
     * one, so a column would arrive anyway; it would arrive inside a thicket.
     */
    const road = at(len * OFFICE_ALONG + ROAD_AHEAD, OFFICE_OFFSET + ROAD_ACROSS);
    b.block(road.x, road.z, 28);

    const minX = Math.min(home.x, foe.x, works.x, office.x) - 80;
    const maxX = Math.max(home.x, foe.x, works.x, office.x) + 80;
    const minZ = Math.min(home.z, foe.z, works.z, office.z) - 80;
    const maxZ = Math.max(home.z, foe.z, works.z, office.z) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    b.setCameraFocus(home.x, home.z);
    void start;
  },
});
