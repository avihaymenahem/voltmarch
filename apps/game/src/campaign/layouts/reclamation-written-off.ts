/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-written-off.ts
 * ============================================================================
 * R2 — THE GROUND. Two bases standing on worked-out dirt, one field between
 * them, and everything either army earns for the next fourteen minutes coming
 * off that one patch.
 *
 * **THE HOME PATCHES ARE DELIBERATELY TOO SMALL TO LIVE ON, AND THE RATIO IS
 * ARITHMETIC RATHER THAN TASTE.** `addStartOre` gives every start a radius-30
 * field 44 m off its own shelf; this file gives each one radius 14 at the same
 * bearing, which is `(14/30)^2` = **21.8% of the area** — a trickle a single
 * crusher can work and nothing else. The field at the map centre is r30 with
 * two r16 pockets either side of it, so the middle of the map holds
 * `(30^2 + 2*16^2) / 14^2` = **7.2 times** what either home patch does. There
 * is no version of this operation where a player stays at home, and there is no
 * trigger enforcing that: the ground does it.
 *
 * ============================================================================
 * THE MAP CENTRE IS THE ONE FAIR POINT, AND THAT IS ARITHMETIC TOO
 * ============================================================================
 * Same derivation `soviets-common-standard` writes out, and it is the reason
 * the objective geometry here is ABSOLUTE while `reclamation-held-paper`'s is
 * measured per seed. All four authored slots sit at
 * `(+/-START_SPREAD_X, +/-START_SPREAD_Z)` = (+/-148, +/-124) from the centre,
 * so every one of them is `hypot(148, 124)` = **193.08 m** from it. Whichever
 * pair `seatedSlots` draws, both armies open exactly that far from the field,
 * and `FIELD` below can be a module constant the trigger table imports rather
 * than four numbers typed into two files.
 *
 * `startPointsFor` also reserves the centre shelf FIRST on every continent, so
 * the ground the field sits on is graded: a forward Ore Sorter is placeable
 * there by construction rather than by luck. That is load-bearing — see the
 * operation header, where paying 2000 credits for a refinery on the field is
 * one of the three ways to run this economy.
 *
 * ============================================================================
 * WHAT IS ON THE FIELD, AND WHY EACH PIECE IS THE PIECE IT IS
 * ============================================================================
 * **THREE CAPPED MINE HEADS (`civOreMine`, Gaia).** 5 credits a second to
 * whoever holds the deed — `src/data/Civilians.ts` derives that number against
 * a measured harvester and calls it 0.57 of one. Gaia-owned means `Capture.ts`
 * rule 1 applies: a NEUTRAL structure flips at any health, so one Tinker takes
 * one outright, and the 2x2 footprint clears `GARRISON.minFootprint` so a squad
 * standing in the doorway rents it instead. Two verbs, two prices, both
 * shipped, neither invented here.
 *
 * **A SOVIET SORTING STATION (`refinery`, seat 1).** The thing they left
 * standing when they wrote the field off. It is a WORKING refinery on an enemy
 * seat with two crushers beside it, which does three jobs at once: it is why
 * Soviet harvesters are on the field at all, it is a forward dock the player
 * does not have, and it is capturable at or below half health — the other
 * `Capture.ts` rule, and the one worth teaching.
 *
 * **NO GAIA REFINERY ANYWHERE, AND THAT IS A HARD RULE RATHER THAN A CHOICE.**
 * The obvious way to author "an abandoned sorting station" is a neutral one the
 * player can walk into. `Harvesting.ts` §DEED forbids it in as many words:
 * `isUsableRefinery` requires `areAllied`, the only alliance in this game is
 * self plus Gaia, and the note's own reason for the old hauler-keyed deposit
 * being unfalsifiable is that **"no Gaia structure carries
 * `EntityFlag.IsRefinery`"**. Place one and `pickRefinery` ranks it first for
 * being nearest, the player's crushers dock at it, and `tickDock` pays
 * `store.owner[ri]` — Gaia. Every load the player lifts would vanish into the
 * scenery with no error anywhere. The station is therefore SOVIET, and the only
 * neutral structures on this map are the mine heads, which carry no such flag.
 *
 * **NOTHING MOBILE GUARDS ANYTHING.** The station's two emplacements are
 * concrete for the reason `soviets-common-standard` measured in a headless
 * boot: `AiBrain.census` files every AI-owned mobile hull into `armyIds` and
 * `regroupSquads` marches it to the rally point inside four seconds, and a
 * layout cannot opt out. The two Soviet crushers beside the station are the
 * exception that proves it — `census` files harvesters into the economy, not
 * into `armyIds`, so they stay on the field because that is where the ore is.
 *
 * **EVERY TAG THIS STAMPS IS DECLARED ABOVE `build`.** `validateCampaign`
 * refuses an operation whose triggers name a tag no layout produces, because
 * `entityDead` reads TRUE before a tag has ever existed.
 * `tests/campaign-maps.spec.ts` builds this headlessly and checks the
 * declaration against what actually landed, in both directions.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless an operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot.
 * ========================================================================== */

import { CELL, MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import {
  buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE PLACES THE TRIGGER TABLE NAMES
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The field: the r30 middle pocket, the two r16 wings and all three mine heads.
 *
 * **68 m IS SIZED OFF THE COMPOSITION, NOT OFF A FEELING.** The wing pockets
 * sit at 52 m across the centre line and the two far mine heads at
 * `hypot(52, 20)` = 55.7 m, so the disc has to clear 56 m before it means "on
 * the field" at all; the ore of a wing pocket reaches 68 m. Every reader is a
 * PRESENCE test — the reveal, the arrival line, the raid's aim point — and none
 * of them is a hold, so there is no timer here for a tight radius to turn into
 * a parking exercise.
 *
 * It is also comfortably short of either opening at 193.08 m, which is what
 * stops `unitsInArea` reading true on tick one.
 */
export const FIELD: Area = { x: CENTRE, z: CENTRE, r: 68 };

/** The same point, for `orderTagged`. An `Area` is not a `Point`. */
export const FIELD_POINT: Point = { x: CENTRE, z: CENTRE };

/* ==========================================================================
 * 2. THE COMPOSITION, IN METRES FROM THE CENTRE
 *
 * Every offset below is measured in a frame built from the CENTRE toward the
 * Soviet start, not along the start-to-start line. The two are the same thing
 * only when the seed draws a DIAGONAL pair: `seatedSlots` can draw an edge
 * pair, whose midpoint is 124 m off the centre — `soviets-common-standard`
 * quotes exactly that case — while both openings stay 193.08 m from it. A frame
 * hung off the centre is right for either draw.
 *
 * NO TRIGONOMETRY IN ANY POSITION. The forward vector is a difference divided
 * by a `Math.sqrt`, and the across vector is its exact perpendicular
 * (`px = -nz, pz = nx`); ECMA-262 pins `+ - * /` and `Math.sqrt` and pins
 * neither `sin` nor `cos`, and a layout runs independently on both machines of
 * a lockstep match. Yaw is the one exception and it is cosmetic — the same
 * `atan2` bearing `reclamation-held-paper` takes, for the same reason.
 * ========================================================================== */

/** Ore. The middle of the field, and a wing either side of it. */
const POCKET_R = 30;
const WING_ACROSS = 52;
const WING_R = 16;
/** Each home patch: 21.8% of the area `addStartOre` would have given it. */
const HOME_R = 14;

/** Mine head A — the near one, on the player's side of the middle pocket. */
const HEAD_NEAR = { fwd: -40, across: 0 };
/** Mine heads B and C — beside the wings, one step onto the Soviet half. */
const HEAD_WING_FWD = 20;
const HEAD_WING_ACROSS = 52;

/**
 * The station, and the two emplacements that are the price of taking it.
 *
 * **52 IS MEASURED AGAINST THE GROUND, NOT CHOSEN.** The first draft asked for
 * 68 and `place`'s ring search carried the station to (318, 200) — 83.5 m from
 * the centre, 15.8 m off the point it was authored at, and further from the ore
 * than a forward dock has any business being. On the centre line at this seed a
 * 3x2 refinery footprint is REFUSED the whole way from fwd 60 to fwd 80, which
 * is why the search had to go outward to find one. At 52 it lands at (296, 222)
 * — 52.5 m out, 0.4 m off the axis, where it was asked to stand and just over
 * 20 m clear of the middle pocket's ore. That short haul is what makes taking
 * it worth 500 credits and a fight.
 */
const STATION_FWD = 52;
const GUARD_FWD = 40;
const GUARD_ACROSS = 15;

/**
 * Cells searched outward for buildable ground under a structure. Seven rings is
 * 28 m — wider than anything here moves, and narrower than the gap between any
 * two pieces of the composition, so a search can never walk one onto another.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'reclamation-written-off',
  /*
   * `raid` is stamped by a `spawnUnits` effect rather than by anything below,
   * and `validateCampaign` does not require this file to produce it. Declared
   * anyway, for the reason `soviets-first-tap` declares `relief`: somebody
   * looking for "where does the Soviet column come from" should find the answer
   * in the file that owns the ground.
   */
  tags: ['mine', 'station', 'raid'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED DISC IS ABSOLUTE AND THIS BUILD IS SHELF-ANCHORED, SO THE
     * TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`, which is
     * `startLocations()[0]`, which `startPointsFor` puts at the map centre on
     * every continent. If that ever stops being true, the trigger table is
     * naming ground this file never dressed — and it would be invisible,
     * because every tag would still land and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] reclamation-written-off built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the operation's field disc is absolute and will not line `
        + 'up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    /*
     * NO `rotateStarts`, AND THE ARGUMENT IS `reclamation-held-paper`'s. The
     * rotation exists so a SKIRMISH player does not open in the same corner
     * every match; an operation's `mapSeed` and `simSeed` are constants, so
     * here it is a moving part with exactly one value. Seat 0 owns spot 0
     * because this file never shuffles the owners, which is also what makes the
     * one measured constant in the operation file mean the same thing on every
     * boot.
     */
    const player: PlayerId = c.seat(0);
    const soviets: PlayerId = c.seat(1);
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    /* -- the frame ------------------------------------------------------- */
    const dx = foe.x - cx;
    const dz = foe.z - cz;
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    // Toward the Soviet opening, from the centre of the map.
    const nx = dx / len;
    const nz = dz / len;
    // Its left-hand perpendicular. Exact, and no angle is ever taken.
    const px = -nz;
    const pz = nx;

    /** A point in the field's own frame: `fwd` toward the Soviets, `across` right. */
    const at = (fwd: number, across: number): { x: number; z: number } => ({
      x: cx + nx * fwd + px * across,
      z: cz + nz * fwd + pz * across,
    });

    // Bearing from the field toward the Soviet start, so everything the
    // Soviets left standing faces the way they went.
    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));
    const outward = wrapDeg(inward + 180);

    /**
     * Put a structure on ground its footprint can legally stand on.
     *
     * `findClearFootprint` ANSWERS THE WRONG QUESTION ON ITS OWN. It tests
     * `footprintClear` (occupancy) and connectivity and nothing about grade, so
     * `spawnBuilding` plants the structure on whatever slope is underneath and
     * reports success while `auditConnectivity().unbuildableGround` counts it.
     * `soviets-first-tap` uses it directly and ships structures on ground
     * `isBuildable` refuses. This searches for a footprint that is clear AND
     * `footprintBuildable`, in rings, in a fixed traversal order so two runs of
     * one seed place the same field, and falls back to the shipped search and
     * then to the nominal point — a station that fails to appear is an
     * operation with a dead secondary, and a station on a slope is only ugly.
     */
    const scratch = new Float32Array(2);
    const place = (
      owner: PlayerId, key: string, p: { x: number; z: number },
    ): { x: number; z: number } => {
      const f = b.footprintOf(b.keyFor(owner, key));
      for (let ring = 0; ring <= PLACE_RINGS; ring++) {
        for (let oz = -ring; oz <= ring; oz++) {
          for (let ox = -ring; ox <= ring; ox++) {
            // Perimeter only; the interior was covered by a smaller ring.
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
     * Place one structure, tag it, and reserve the ground around it.
     *
     * RETURNS WHERE IT ACTUALLY WENT, not where it was asked for, so the
     * crushers and the dressing below hang off the real position rather than
     * the nominal one.
     */
    const raise = (
      owner: PlayerId, key: string, p: { x: number; z: number },
      tag: string | null, yawDeg: number, clear: number,
    ): { id: EntityId; x: number; z: number } => {
      const where = place(owner, key, p);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      // Block AFTER placing, so the next search cannot land on top of this one
      // and so `scatter` leaves the ground around it walkable.
      if (id !== NONE) b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    /* ==================================================================
     * 1. THE TWO BASES
     *
     * `garrison: true` on both, which is the ordinary two-army opening and
     * is doing one specific job on seat 0: `buildAlliedGarrison` spawns one
     * `engineer`, and `keyFor` turns that into an **rclTinker**. The player
     * therefore opens holding exactly one deed-taker, free, and the first
     * decision of the operation is where to spend it — a mine head now, or
     * the station later, which cannot be taken until somebody has shot it
     * to half health. See the operation header.
     *
     * It also hands each side two crushers and, on seat 1, the standing
     * army that makes the Soviets a real opponent rather than a base.
     * ================================================================== */
    buildBaseFor(b, player, home.x, home.z, {
      facingDeg: wrapDeg(home.facingDeg + 180),
    });
    buildBaseFor(b, soviets, foe.x, foe.z, {
      facingDeg: wrapDeg(foe.facingDeg + 180),
    });

    /* ==================================================================
     * 2. THE HOME PATCHES — a trickle each, and the same bearing
     * `addStartOre` uses.
     *
     * That helper takes its bearing from `StartSpot.facingDeg` through
     * `Math.sin`/`Math.cos`; this takes the same direction as a normalised
     * difference toward the centre, which is exact under IEEE-754 and lands
     * in the same place for the same reason — a start faces the middle of
     * the map. `+18` along it and `44` across it, exactly as the helper
     * does, so the patch sits beside the base rather than on the lane both
     * armies are about to fight over.
     * ================================================================== */
    for (const s of seats) {
      const hx = cx - s.x;
      const hz = cz - s.z;
      const hlen = Math.max(1e-3, Math.sqrt(hx * hx + hz * hz));
      const ux = hx / hlen;
      const uz = hz / hlen;
      b.addOre(s.x + ux * 18 - uz * 44, s.z + uz * 18 + ux * 44, HOME_R);
    }

    /* ==================================================================
     * 3. THE FIELD
     *
     * One pocket on the centre shelf and a wing either side of it. Three
     * pockets rather than one disc because `HarvesterController` claims
     * cells (`ORE_MIN_CLAIM`) and four to six crushers on one face queue.
     * The three pocket centres span 104 m and their ore spans 136 m, which
     * is what lets both economies run on one field at once — the premise.
     * ================================================================== */
    b.addOre(cx, cz, POCKET_R);
    b.addOre(at(0, WING_ACROSS).x, at(0, WING_ACROSS).z, WING_R);
    b.addOre(at(0, -WING_ACROSS).x, at(0, -WING_ACROSS).z, WING_R);

    /* ==================================================================
     * 4. THE THREE MINE HEADS
     *
     * Gaia, so `Capture.ts` rule 1 applies and a single Tinker takes one at
     * any health — and so neither army's targeting ever considers one an
     * enemy until somebody takes the deed. The moment the player holds one
     * it becomes a player-owned building on the middle of the map, which is
     * the operation's whole second half.
     *
     * NOT EQUALLY PRICED, ON PURPOSE. The near head is 40 m on the player's
     * side of the middle pocket; the two wing heads are 20 m onto the
     * Soviet half at 55.7 m from the centre. Taking the first is a walk,
     * taking all three is a commitment, and the secondary asks for all
     * three.
     * ================================================================== */
    const heads: { x: number; z: number }[] = [
      at(HEAD_NEAR.fwd, HEAD_NEAR.across),
      at(HEAD_WING_FWD, HEAD_WING_ACROSS),
      at(HEAD_WING_FWD, -HEAD_WING_ACROSS),
    ];
    for (let i = 0; i < heads.length; i++) {
      raise(b.gaia, 'civOreMine', heads[i], 'mine', i === 0 ? outward : inward, 16);
    }

    /* ==================================================================
     * 5. THE SORTING STATION
     *
     * A Soviet refinery 52 m onto their half of the field — measured at
     * (296, 222), 52.5 m from the centre — its two emplacements, and the two
     * crushers that are the reason the Soviets are on this field at all.
     *
     * THE EMPLACEMENTS ARE `pillbox` BY ROLE — `keyFor` gives the Soviets
     * `sentryGun` — and the role key is what keeps the composition legible
     * if `op.foe` ever changes. They carry `power: 0` in every army's
     * column except the Pact's, so no brownout in the Soviet base can
     * silence the price of the secondary; a Meridian foe would put a
     * `needsPower` Glaive Post here instead, which is a reason to re-read
     * this block before changing `foe` rather than a reason to name a def.
     *
     * They are also, and mainly, NOT HULLS. Two parked Wardens is what
     * `soviets-common-standard` shipped first and measured being marched
     * 117 m off station inside twenty seconds.
     * ================================================================== */
    const station = raise(soviets, 'refinery', at(STATION_FWD, 0), 'station', outward, 24);
    raise(soviets, 'pillbox', at(GUARD_FWD, GUARD_ACROSS), null, outward, 10);
    raise(soviets, 'pillbox', at(GUARD_FWD, -GUARD_ACROSS), null, outward, 10);

    /*
     * THE TWO CRUSHERS. `shipsWith` pays a free harvester when a refinery
     * FINISHES BUILDING and a scenario-placed structure never finishes — it
     * arrives complete — so without this the Soviets own a forward dock and
     * nothing to feed it. One part-full, because a station that has been
     * running since week two has a hopper in the middle of a haul.
     *
     * A ROLE KEY, so this is whatever the seated foe's army actually
     * fields. `census` files a harvester into the economy rather than into
     * `armyIds`, so unlike every other mobile thing on an AI seat these two
     * stay where the ore is.
     */
    if (station.id !== NONE) {
      for (let i = 0; i < 2; i++) {
        b.spawnUnit(
          'harvester', soviets,
          station.x - nx * 22 + px * (i * 18 - 9),
          station.z - nz * 22 + pz * (i * 18 - 9),
          { yawDeg: outward, cargoFrac: i === 0 ? 0.4 : 0 },
        );
      }
      // Wear. They pulled the crews out in week two and left the wreck of
      // whatever made them do it. Not burning: this is eleven months cold.
      b.spawnWreck(
        station.x + px * 30, station.z + pz * 30,
        b.world.player(soviets).faction, false,
      );
    }

    /* ==================================================================
     * 6. DRESSING AND THE OPENING FRAME
     * ================================================================== */
    // Dressed over the corridor the composition actually occupies rather
    // than a square on the map centre, which on this layout is the objective.
    const boxMinX = Math.min(home.x, foe.x, cx) - 100;
    const boxMaxX = Math.max(home.x, foe.x, cx) + 100;
    const boxMinZ = Math.min(home.z, foe.z, cz) - 100;
    const boxMaxZ = Math.max(home.z, foe.z, cz) + 100;
    b.scatter({ minX: boxMinX, minZ: boxMinZ, maxX: boxMaxX, maxZ: boxMaxZ }, 150);

    // The opening frame: the player's own yard, with the field beyond it.
    // `Shell.applyCameraPostBoot` re-poses on `findHome`, which finds the same
    // structure — this is what the headless and `?shot=` paths read.
    b.setCameraFocus(home.x, home.z);
    void start;
  },
});
