/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-long-count.ts
 * ============================================================================
 * P2 — THE GROUND. A temperate valley, two openings 386.2 m apart, a Soviet
 * pump sunk on the seam two thirds of the way across, and a Pact reading post
 * standing **32.25 m behind it** that has to be intact when the pump is gone.
 *
 * ============================================================================
 * THE ONE NUMBER THIS FILE EXISTS TO PRODUCE
 * ============================================================================
 * `D` — the gap between the pump and the reading post — is the operation. Not
 * because splash reaches across it (nothing in the Pact's day-one land roster
 * has a blast bigger than 2.0 m; see the operation header) but because
 * `Targeting` acquires on SURFACE distance out to
 *
 *     envelope = max(range * APPROACH_STOP_FRAC + GUARD_LEASH, range * 1.08)
 *              = range * 0.80 + 18        for every gun under 64.3 m of reach
 *
 * and a hull that has finished the pump goes `Idle`, scans, and takes whatever
 * is in that circle. The reading post is Soviet-owned, so it is in it.
 *
 * **THE BAND IS DERIVED, AND `siteCount` REFUSES TO LEAVE IT.** Both the pump
 * and the post are 2x2 footprints, so both carry `hitRadius` `hypot(4, 4)` =
 * **5.6569 m**, and `approach` and `isValidTarget` BOTH work in surface
 * distance — the two radii cancel out of the lower bound entirely.
 *
 *   LOWER BOUND — the natural standoff must be safe. `Targeting.approach` parks
 *   a hull where its SURFACE distance to the pump is `0.80R`, i.e. at centre
 *   distance `0.80R + 5.6569`. From there its surface distance to the post is
 *   `D + 0.80R`, so it acquires when `D + 0.80R <= 0.80R + 18`, i.e. when
 *   **`D <= 18.000`**. Nothing about the gun survives the cancellation: **the
 *   safety of the standoff does not depend on what you brought.**
 *
 *   UPPER BOUND — the overrun must bite. A hull driven onto the pump cannot sit
 *   closer to it than `5.6569 + its own radius`, which puts it at
 *   `D + 5.6569 + r - 5.6569` = `D + r` of surface from the post; that has to
 *   stay INSIDE its envelope. Per hull: **`D <= 36.01`** for a Solarch
 *   (r 2.79, envelope 38.80) and **`D <= 33.77`** for infantry (r 0.234,
 *   envelope 34.00), which is the binding one.
 *
 * So the window is `(18.000, 33.77]` if the overrun is required to bite for
 * INFANTRY as well as armour, and `(18.000, 36.01]` if only armour has to feel
 * it. `COUNT_GAP_MIN/MAX` are 26 and 34 — clear of the lower bound by 8 m and
 * sitting on the infantry bound at the very top, which is a RANGE the ground
 * can be searched over rather than a point it may not offer. `COUNT_GAP_WANT`
 * is 32 and the shipped seeds return **32.249 m**, which satisfies every one of
 * those bounds: 14.25 m of standoff margin, and the overrun bites by 3.76 m for
 * a Solarch and 1.52 m for a rifleman.
 *
 * **AN EARLIER DRAFT OF THIS BLOCK PUT THE LOWER BOUND AT 23.657** by measuring
 * the park distance centre-to-centre instead of surface-to-surface. It reached
 * the same band and the same shipped gap, which is exactly why it survived a
 * reading: a wrong derivation that happens to agree with the right one at the
 * value you chose. `Targeting.approach` states the quantity in its own comment.
 *
 * ============================================================================
 * WHY THE POST IS SITED BY SEARCH AND NOT BY AN OFFSET
 * ============================================================================
 * `spawnBuilding` SNAPS a footprint to the placement grid, and `place()` below
 * walks a widening ring when the snapped cell is occupied or unbuildable. Both
 * move a structure by whole cells. An authored `tap + n * 32` therefore lands
 * wherever the ground allows and `D` comes out at whatever it comes out at —
 * measured across ten seed pairs before this function existed, it ranged
 * **31.24 to 48.17 m**, and 48.17 is outside the band in the direction that
 * silently deletes the operation's whole mechanic.
 *
 * So `siteCount` enumerates candidates, SNAPS each one the way `spawnBuilding`
 * will, computes the gap that snap actually produces, discards anything outside
 * the band, and scores the survivors on `|gap - 32|` with the across-axis offset
 * as a tiebreak. The band is then a property of the placement rather than of
 * the seed. If no candidate is clear AND buildable it says so on the console
 * and falls back — that is a re-roll, not a ship.
 *
 * ============================================================================
 * WHAT LANDS, AT `mapSeed` 33 017 / `simSeed` 3 203
 * ============================================================================
 * Read off a headless build — the same one `tests/campaign-maps.spec.ts`
 * performs — after `spawnBuilding` snapped every footprint:
 *
 *     home    108, 380        foe   404, 132        len 386.161
 *     pump    316, 268   700 hp      post  344, 252   900 hp     D 32.249
 *     staging 184, 208   800 hp      seated slots [0, 1]
 *
 *     home -> pump 236.2    home -> post 268.5    home -> staging 188.0
 *     foe  -> pump 162.0    foe  -> post 134.2    foe  -> staging 232.8
 *     pump -> staging 145.0                       post -> staging 165.9
 *
 * **THE `foe` ROW USED TO READ (384.0, 166.6) AND len 348.9, AND THAT POINT IS
 * NOT ON THIS MAP.** It is `nudgeToBuildable`'s ring-40, bearing-4-of-12
 * candidate off (404, 132) — `cos(120deg) * 40 = -20`, `sin(120deg) * 40 =
 * +34.641` — i.e. a real `startSpots` output from a world whose slot-1 shelf
 * was missing. On this seed nothing displaces it: `buildableFraction(404, 132,
 * 30)` is 1.0000 against `START_CORE_MIN` 0.7 and `nudgeToBuildable` moves it
 * 0.000 m. The whole `foe ->` column was computed from that phantom and is
 * replaced above; the `home ->` column reproduces exactly and is the control
 * that isolates it. The block was also self-contradictory — its own pump,
 * post and staging coordinates fall out of the UN-nudged frame at ring zero,
 * while the nudged frame would put the pump nominal at (301.7, 288.4).
 *
 * The Soviet CONSTRUCTION YARD is a third point again, at (402, 134): 159.2 m
 * from the pump, 131.5 m from the post and 230.2 m from the staging. Say which
 * of the three a figure is measured to.
 *
 * **16 of 16 384 cells on this map are water**, which is 0.098% and no coast:
 * `MAP_SEAS` carries no `temperate` row, so there is nothing for a Slipway to
 * stand on and the two Pact guns with real splash (`mirrorGun` 3.4 m,
 * `monitorLance` 4.2 m) cannot be fielded here at all. That is load-bearing for
 * the operation header's splash audit and it is a property of the PRESET, so it
 * survives a seed change.
 *
 * **RE-MEASURE IF `mapSeed`, `simSeed` OR THE FRACTIONS BELOW MOVE.** `D` is
 * held inside the band by construction; nothing else here is. Nothing fails
 * loudly if the rest drifts — the reveal disc simply stops lining up with the
 * road and the relief column lands on ground it cannot leave.
 *
 * ============================================================================
 * EVERY TAG THIS STAMPS IS DECLARED ABOVE `build`
 * ============================================================================
 * `validateCampaign` refuses an operation whose triggers name a tag no layout
 * produces, because `entityDead` reads TRUE before a tag has ever existed — and
 * this operation LOSES on `entityDead: 'count'`, so a mistyped tag would defeat
 * the player on tick one, silently, before a shot was fired.
 *
 * All three placed tags are on BUILDINGS, which is a rule rather than a
 * preference: `campaign-maps.spec.ts` refuses a tag an `entity*` condition reads
 * on an AI seat unless it is a structure, because `AiBrain.regroupSquads` files
 * every hull the AI owns into a squad on the first brain pass and drives it to
 * the rally point. Two Wardens parked as a guard were measured 127 m from the
 * thing they were placed to guard, dead, having never stood on it.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning and that answers from the LOCAL profile unless an operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot,
 * and this operation's roster is empty on both sides, so nothing below is at
 * the mercy of one.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import { snapFootprintToGrid } from '../../core/math';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/* ==========================================================================
 * THE COMPOSITION, IN THE FRAME THE OPENINGS DEFINE
 *
 * `n` runs from the player's opening toward the Soviet one and is authored as a
 * FRACTION of the distance between them, because that distance is a property of
 * `START_SPREAD_X/_Z` and has already doubled once. `p` is the LEFT-hand
 * perpendicular and is authored in METRES.
 *
 * THERE IS NO WATER PROBE ON THE PERPENDICULAR, unlike `pact-shallow-road`.
 * `MAP_SEAS` has no `temperate` row, so `b.sea` is null and neither side of the
 * axis is sea; the sign is a composition choice and `place()` is what answers
 * for the ground.
 * ========================================================================== */

/** The seam compound. Fraction of the opening-to-opening line. */
const SEAM_ALONG = 0.60;
/** Metres off that axis, on the left-hand perpendicular of home -> foe. */
const SEAM_OFFSET = 46;

/** The reading post's content key. Named once — three sites read it. */
const COUNT_KEY = 'civOilDerrick';
/** Metres from the pump to the reading post. See the band derivation above. */
const COUNT_GAP_WANT = 32;
const COUNT_GAP_MIN = 26;
const COUNT_GAP_MAX = 34;
/** Across-axis offsets the search may spend to find ground. Nearest first. */
const COUNT_LATERALS: readonly number[] = [0, -4, 4, -8, 8, -12, 12];

/** Metres the gun line stands on the player's side of the pump. */
const GUN_BACK = 18;
/** Metres between the two guns, across the axis. */
const GUN_SPREAD = 13;

/** The staging post, on the far side of the road from the seam. */
const STAGING_ALONG = 0.44;
const STAGING_OFFSET = -74;

/**
 * Cells searched outward for ground a footprint can legally stand on.
 * Seven is 28 m — wider than any lot moves at this operation's seeds, narrower
 * than the gap between any two of them.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-long-count',

  /*
   * `column` is stamped by a `spawnUnits` effect rather than by this file, and
   * it is declared here for the reason `pact-shallow-road` declares its own:
   * somebody looking for "where does this come from" should find the answer in
   * the file that owns the ground. `campaign-maps.spec.ts` knows the difference
   * and does not require this one to have landed at build time.
   */
  tags: ['tap', 'count', 'staging', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    // NO `rotateStarts`. An operation's `simSeed` is a constant, so the
    // rotation has exactly one value — a moving part with no motion — while
    // making every measured coordinate in the operation file depend on
    // `startOffset`. `reclamation-held-paper` argues this at length.
    const pact: PlayerId = c.seat(0);
    const soviets: PlayerId = c.seat(1);
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

    // Bearing from the player's opening toward the Soviet one, so a structure
    // faces the road rather than a compass direction.
    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));
    const outward = wrapDeg(inward + 180);

    /**
     * Put a structure on ground its footprint can legally stand on.
     *
     * `findClearFootprint` tests OCCUPANCY and connectivity and nothing about
     * grade, so it reports success for a lot half-buried in a slope;
     * `soviets-first-tap` uses it directly and its build log printed
     * "7 structures on ground isBuildable refuses". This searches for a
     * footprint that is clear AND `footprintBuildable`, in rings, in a fixed
     * traversal order so two runs of one seed place the same valley, and falls
     * back the way that file does — a pump that fails to appear is an operation
     * nobody can finish, and one on a slope is only ugly.
     */
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

    /**
     * Place one structure, tag it, reserve the ground, and return where it
     * ACTUALLY went rather than where it was asked for. Every distance the
     * operation file quotes is read off a built world, not off these points.
     */
    const raise = (
      owner: PlayerId, key: string, p: { x: number; z: number },
      tag: string | null, yawDeg: number, clear: number, snapped = false,
    ): { id: EntityId; x: number; z: number } => {
      const where = snapped ? p : place(owner, key, p);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      // Block AFTER placing, so the next ring search cannot land on top of this
      // one and so `scatter` leaves the lot walkable.
      if (id !== NONE) b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    /**
     * Site the reading post by the number the OPERATION is written against.
     *
     * Candidates are pre-snapped with the same `snapFootprintToGrid` call
     * `spawnBuilding` makes, so the gap scored here is the gap that ships. See
     * the header for why a plain offset is not good enough.
     */
    const snap = new Float32Array(2);
    const siteCount = (t: { x: number; z: number }): { x: number; z: number } | null => {
      const f = b.footprintOf(b.keyFor(soviets, COUNT_KEY));
      let bestX = 0;
      let bestZ = 0;
      let bestScore = Infinity;
      for (let li = 0; li < COUNT_LATERALS.length; li++) {
        const l = COUNT_LATERALS[li];
        for (let g = COUNT_GAP_MIN; g <= COUNT_GAP_MAX; g++) {
          snapFootprintToGrid(t.x + nx * g + px * l, t.z + nz * g + pz * l, f.w, f.h, snap);
          const dqx = snap[0] - t.x;
          const dqz = snap[1] - t.z;
          const gap = Math.sqrt(dqx * dqx + dqz * dqz);
          if (gap < COUNT_GAP_MIN || gap > COUNT_GAP_MAX) continue;
          // The gap decides; the across-axis offset is a tiebreak only, so the
          // post stays as nearly behind the pump as the ground allows.
          const score = Math.abs(gap - COUNT_GAP_WANT) * 100 + Math.abs(l);
          if (score >= bestScore) continue;
          if (!b.footprintClear(snap[0], snap[1], f.w, f.h)) continue;
          if (!b.footprintBuildable(snap[0], snap[1], f.w, f.h)) continue;
          bestScore = score;
          bestX = snap[0];
          bestZ = snap[1];
        }
      }
      return bestScore === Infinity ? null : { x: bestX, z: bestZ };
    };

    /* ==================================================================
     * 1. THE TWO OPENINGS
     *
     * The ordinary two-army opening on both seats, which is the position a
     * player already understands. `garrison` is left at its default on both,
     * so the Pact opens with the 14 units and 25 structures a skirmish
     * would give it and nothing has to be bought before the operation's
     * question can be asked.
     * ================================================================== */
    buildBaseFor(b, pact, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, soviets, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* ==================================================================
     * 2. THE SEAM
     *
     * The pump on the road side, the reading post 32.25 m DEEPER, and the
     * gun line nominally 18 m in front of the pump (19.0 m and 22.1 m as
     * placed).
     *
     * THE ORDER IS THE COMPOSITION. A player advancing from their own
     * opening meets the guns, then the pump, then the post; the post is the
     * only thing on this lot they are not meant to reach. Putting it on the
     * far side is what makes "stop where your gun stops" a complete
     * instruction — see the operation header's three routes.
     * ================================================================== */
    const tap = raise(soviets, 'civOreMine', at(len * SEAM_ALONG, SEAM_OFFSET), 'tap', outward, 18);

    const sited = siteCount(tap);
    if (sited === null) {
      // LOUD, because nothing else would be. The band IS the operation, and a
      // post outside it leaves an operation that still builds, still validates
      // and no longer asks its question.
      console.error(
        '[campaign] pact-long-count found no site for the reading post inside '
        + `${COUNT_GAP_MIN}..${COUNT_GAP_MAX} m of the pump — re-roll mapSeed rather `
        + 'than shipping this. The gap is the whole operation.',
      );
    }
    raise(
      soviets, COUNT_KEY,
      sited ?? { x: tap.x + nx * COUNT_GAP_WANT, z: tap.z + nz * COUNT_GAP_WANT },
      'count', outward, 18, sited !== null,
    );

    /*
     * THE GUN LINE. Two Sentry Guns — `keyFor` maps `pillbox` to the Soviet
     * column — facing the road, nominally 18 m in front of the pump and 13 m
     * either side of the axis; 19.0 m and 22.1 m from it as actually placed.
     *
     * `sentryGun` IS CHOSEN FOR WHAT IT CANNOT DO. `pillboxMg` carries NO
     * splash radius at all and `power: 0`, so this emplacement can neither
     * scratch the reading post standing 48.1 m and 53.1 m behind it nor be
     * silenced by a brownout in a base 204 m away. The two gated alternatives both fail one
     * of those: `flameTower` is a 3.2 m blast and `teslaCoil` needs the grid,
     * and `roster.ai` is empty so `isBuildable` refuses both anyway.
     *
     * They are IN FRONT rather than around the lot for `soviets-common-standard`'s
     * reason: `pillboxMg` reaches 22 m, so posts inside ~20 m of each other both
     * bear on a column at the pump. Spread round the perimeter they would be
     * killed one at a time, each out of the other's reach.
     */
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      raise(
        soviets, 'pillbox',
        {
          x: tap.x - nx * GUN_BACK + px * (s * GUN_SPREAD),
          z: tap.z - nz * GUN_BACK + pz * (s * GUN_SPREAD),
        },
        null, outward, 10,
      );
    }

    /* ==================================================================
     * 3. THE STAGING POST
     *
     * A Soviet Barracks and one Sentry Gun, 145.0 m off the seam on the far
     * side of the road.
     *
     * IT IS A REAL PRODUCER AND NOT A TRIGGER PROP. It sits on the AI's
     * seat, so `AiBrain.census` counts it as a Barracks role and
     * `BuildQueue` runs infantry out of it — a second producer is worth up
     * to 35% on the one queue (`FACTORY_SPEED_BONUS`), so levelling it costs
     * the Soviets throughput as well as retiring the scripted column. The
     * trigger table only has to author the column; the rest is the
     * simulation the operation is already made of.
     * ================================================================== */
    const staging = raise(
      soviets, 'barracks', at(len * STAGING_ALONG, STAGING_OFFSET), 'staging', outward, 22,
    );
    raise(
      soviets, 'pillbox',
      { x: staging.x - nx * 20, z: staging.z - nz * 20 }, null, outward, 10,
    );

    /* ==================================================================
     * 4. THE CREW, AND WHY NOTHING DEPENDS ON THEM
     *
     * Three Conscripts on the road face of the pump. `Stance.Defensive` is
     * "fire at anything in range, never leave position to start a fight",
     * which is the only stance that reads as on-post — and
     * `AiBrain.regroupSquads` will march them off it on the first brain pass
     * whatever this file says. That is exactly why they carry NO TAG and no
     * trigger depends on where they are. They are the reason the seam is not
     * empty on the first frame, and nothing more than that.
     *
     * Measured on the built world they land 18.9 m to 27.2 m from the pump on
     * the HOME side, which puts the nearest of them **42.7 m from the reading
     * post**: nothing the player shoots at here can put a blast within the
     * 7.66 m a `sunLance` would need to mark it.
     * ================================================================== */
    for (let i = 0; i < 3; i++) {
      const q = {
        x: tap.x - nx * (10 + i * 6) + px * (18 + (i % 2) * 6),
        z: tap.z - nz * (10 + i * 6) + pz * (18 + (i % 2) * 6),
      };
      b.spawnUnit('conscript', soviets, q.x, q.z, { yawDeg: outward, stance: Stance.Defensive });
    }

    /* ==================================================================
     * 5. ORE AND DRESSING
     * ================================================================== */
    // The standard two-army economy: one field per opening and a contested
    // patch on the centroid. It takes `b.sea`, which is null here.
    addStartOre(b, spots, b.sea);

    /*
     * `addCivilians` IS DELIBERATELY NOT CALLED. It walks
     * `MINE_BISECTOR_OFFSETS` out from the lane midpoint and plants civilian
     * ORE MINES — the same `civOreMine` key this layout uses for the pump. A
     * second, identical, untagged headframe within a hundred metres of the
     * objective is a player shooting the wrong building, and the operation
     * loses on shooting the wrong building. `soviets-common-standard` skips it
     * for the neighbouring reason: two independent placers competing for one
     * clearing.
     */

    // Dressed over the corridor the composition occupies rather than a square
    // on the map centre, which on this layout is nobody's ground.
    const minX = Math.min(home.x, foe.x, tap.x, staging.x) - 80;
    const maxX = Math.max(home.x, foe.x, tap.x, staging.x) + 80;
    const minZ = Math.min(home.z, foe.z, tap.z, staging.z) - 80;
    const maxZ = Math.max(home.z, foe.z, tap.z, staging.z) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    // The opening frame: the player's yard, looking down the road.
    b.setCameraFocus(home.x + nx * 14, home.z + nz * 14);
    void start;
  },
});
