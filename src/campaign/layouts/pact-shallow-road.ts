/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-shallow-road.ts
 * ============================================================================
 * P1 — THE GROUND. A coast, two openings a hundred metres inland of it, an
 * Allied bore on the sand, and a fortified cut run from the surf to the road so
 * that nothing WALKS past it.
 *
 * ============================================================================
 * THE ONE THING THIS FILE EXISTS TO BUILD
 * ============================================================================
 * The Meridian Pact's whole vehicle roster is `Locomotor.Hover` and its whole
 * infantry is `Locomotor.Foot`. That is not flavour and it is not a stat line —
 * it is two different answers out of `Flowfield.rebuildCost`, which blocks
 * every ground class on a wet cell EXCEPT `MoveClass.Hover`:
 *
 *     Solarch / Sandskiff / Collector / Zenith / Carryall   Hover   crosses water
 *     Wayfarer / Sunlancer / ARTIFICER                      Foot    does not
 *     Tidewalker                                            Foot + `amphibious`
 *
 * So the sea is a road for the hulls and a wall for the men, by construction,
 * on every machine, with nothing in this file or the trigger table asserting
 * it. What the layout has to supply is a REASON to use it.
 *
 * `MAP_SEAS.tropical` is a HALF-PLANE whose normal is `START_BISECTOR` — the
 * perpendicular bisector of slots 0 and 1 — so both openings project to the
 * same distance from the waterline and the water is a lane running PARALLEL to
 * the axis of advance rather than an obstacle across it. Measured at this
 * operation's seeds, the waterline sits at +98..+104 m off that axis along its
 * whole length. **The sea can therefore never be a short cut here**: every
 * point either army starts from is on the same side of it, so a straight line
 * between any two of them stays dry. It can only ever be a way ROUND
 * something, and that something has to be built.
 *
 * That is what THE CUT is. A wall run from the last dry cell at the surf
 * straight inland to 60 m past the road, with its only gap at the landward end
 * and a Refractor Tower sited on that gap. It does not seal the map — no wall
 * on open ground can, and `reclamation-held-paper` already says so about its
 * own — but it does seal the BEACH, which is the only part of the map the sea
 * is beside. Everything on foot goes round the landward end, in front of the
 * tower. Everything that hovers has a second option.
 *
 * ============================================================================
 * WHY THE CUT IS WALKED OUT CELL BY CELL RATHER THAN AUTHORED AS A COUNT
 * ============================================================================
 * A wall is a nav barrier because `spawnBuilding` calls `markOccupied`, and
 * `Flowfield.rebuildCost` blocks an occupied cell for every class that touches
 * the ground — hover included. It is a barrier only where it is CONTINUOUS.
 *
 * Two things break it and both are silent. A run authored as "N segments at
 * 4 m" on a bearing 40 degrees off the axes lands two segments in one cell
 * about a third of the time; `spawnBuilding` then finds that cell occupied and
 * hands the second one to `findClearFootprint`, which walks a WIDENING RING and
 * puts it somewhere the line does not go. And a run that does not stop at the
 * surf plants concrete IN THE SEA — `connectedGround` is called with
 * `strandedOnly` and leaves an impassable cell alone — which blocks hover as
 * well as foot and seals the one lane the operation exists to leave open.
 *
 * So `runCut` steps 1.5 m — well under one 4 m cell — keys each step by the
 * cell it lands in, refuses a cell it has already used, and STOPS at the first
 * wet cell. One wall per cell, in order, ending exactly at the water. The
 * seaward end therefore cannot be walked round: the next cell is the sea, and
 * `MoveClass.Foot` is blocked there. The staircase the bearing produces is a
 * seal in its own right — `Flowfield` refuses to cut a corner between two
 * blocked cells (its own comment: "a tank may not squeeze between two building
 * corners that touch only diagonally"), which is why a diagonal run is a
 * barrier and not a sieve.
 *
 * ============================================================================
 * EVERY TAG THIS STAMPS IS DECLARED ABOVE `build`
 * ============================================================================
 * `validateCampaign` refuses an operation whose triggers name a tag no layout
 * produces, because `entityDead` reads TRUE before a tag has ever existed — a
 * mistyped `protect` fails the player on tick one, silently.
 * `tests/campaign-maps.spec.ts` builds this headlessly and checks the
 * declaration against what actually landed, in both directions.
 *
 * All three placed tags are on BUILDINGS and that is a rule rather than a
 * preference: `campaign-maps.spec.ts` refuses a tag an `entity*` condition
 * reads on an AI seat unless it is a structure, because `AiBrain.regroupSquads`
 * files every hull the AI owns into a squad on the first brain pass and drives
 * it to the rally point. Two Wardens parked as a guard were measured 127 m from
 * the thing they were placed to guard, dead, having never stood on it.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning and that answers from the LOCAL profile unless an operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import { worldToCell } from '../../core/math';
import {
  addCivilians, addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/* ==========================================================================
 * THE COMPOSITION, IN THE FRAME THE OPENINGS DEFINE
 *
 * `n` runs from the player's opening toward the Allied one and is authored as a
 * FRACTION of the distance between them, because that distance is a property of
 * `START_SPREAD_X/_Z` and has already doubled once. `p` runs seaward and is
 * authored in METRES, because the waterline sits at a fixed offset off that
 * axis whatever the openings do — `seaOffMapCentre` places it from the same two
 * slots the axis is derived from.
 *
 * THE SIGN OF `p` IS MEASURED, NOT ASSUMED. `p = (-nz, nx)` is the LEFT-hand
 * perpendicular of the home-to-foe bearing, and on this operation's seeded pair
 * that is exactly `START_BISECTOR`, i.e. seaward. `build` checks it against
 * `b.isWater` rather than trusting the arithmetic, and flips to the other
 * perpendicular if a future `seatedSlots` change ever swaps the pair — a
 * composition built on the inland side would be an operation with no sea in it,
 * and nothing anywhere would say so.
 * ========================================================================== */

/** Where the Allies cut the beach. Fraction of the opening-to-opening line. */
const CUT_ALONG = 0.62;
/** Metres INLAND of the opening axis that the cut's landward end reaches. */
const CUT_INLAND = -60;
/** The bore compound. Far enough past the cut that going round it is a choice. */
const COMPOUND_ALONG = 0.78;
/** Metres seaward. The waterline is at ~+100, so this is a beach lot. */
const COMPOUND_OFFSET = 76;

/** Metres stepped along the cut. Under one CELL, so no cell can be skipped. */
const CUT_STEP = 1.5;
/** Hard bound on segments, so a bad frame cannot walk a wall off the map. */
const CUT_MAX_SEGMENTS = 64;
/** Seaward ceiling for the cut's search. `runCut` finds the real surf itself. */
const CUT_SEAWARD_LIMIT = 140;

/**
 * Cells searched outward for ground a lot's footprint can legally stand on.
 * Seven is 28 m — wider than any lot moves at this operation's seeds, narrower
 * than the gap between any two of them.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-shallow-road',

  /*
   * `column` is stamped by a `spawnUnits` effect rather than by this file, and
   * it is declared here for the same reason `reclamation-held-paper` declares
   * its own: somebody looking for "where does this come from" should find the
   * answer in the file that owns the ground. `campaign-maps.spec.ts` knows the
   * difference and does not require this one to have landed at build time.
   */
  tags: ['mast', 'bore', 'gun', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    // NO `rotateStarts`. An operation's `simSeed` is a constant, so the
    // rotation has exactly one value — a moving part with no motion — while
    // making every measured coordinate in the operation file depend on
    // `startOffset`. `reclamation-held-paper` argues this at length.
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
    /**
     * IS THIS WORLD POINT UNDER WATER — ASKED OF THE TERRAIN, NOT OF THE
     * BUILDER.
     *
     * **`ScenarioBuilder.isWater` IS NOT THIS QUESTION AND USING IT COST A
     * BUILD.** It reads `this.shore`, which is the `ShoreSpec` a layout
     * DECLARED through `setShore` — a posed fixture's composition line, not the
     * heightfield. A layout that never calls `setShore` gets `shore === null`
     * and the method answers `false` for every point on the map, including the
     * middle of the sea. The first build of this file used it, the seaward
     * probe below therefore mirrored the whole composition inland, and the cut
     * walked 64 segments into open ground and 15 into the water. Nothing threw.
     *
     * `ITerrain.isWater` takes CELL coordinates and is the grid every
     * passability answer is derived from, which is the same grid that decides
     * whether a Wayfarer may stand somewhere.
     */
    const wet = (x: number, z: number): boolean =>
      b.world.terrain.isWater(worldToCell(x), worldToCell(z));

    // Left-hand perpendicular, corrected below against the water itself.
    let px = -nz;
    let pz = nx;
    {
      // 130 m clears the +98..+104 waterline with margin on either side of the
      // coastal wander. If the left-hand perpendicular is dry there, the sea is
      // on the other one and the whole composition mirrors with it.
      const probeX = home.x + nx * len * 0.5 + px * 130;
      const probeZ = home.z + nz * len * 0.5 + pz * 130;
      if (!wet(probeX, probeZ)) { px = -px; pz = -pz; }
    }

    /** Metres along the axis, metres seaward. */
    const at = (n: number, p: number): { x: number; z: number } => ({
      x: home.x + nx * n + px * p,
      z: home.z + nz * n + pz * p,
    });

    // Bearing from the player's opening toward the Allied one, so a structure
    // faces the road rather than a compass direction.
    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));
    const outward = wrapDeg(inward + 180);

    /**
     * Put a structure on ground its footprint can legally stand on.
     *
     * `findClearFootprint` tests OCCUPANCY and connectivity and nothing about
     * grade, so it will report success for a lot half-buried in a slope;
     * `soviets-first-tap` uses it directly and its build log printed
     * "7 structures on ground isBuildable refuses". This searches for a
     * footprint that is clear AND `footprintBuildable`, in rings, in a fixed
     * traversal order so two runs of one seed place the same coast, and falls
     * back the way that file does — because a bore head that fails to appear is
     * an operation nobody can finish, and one on a slope is only ugly.
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
      tag: string | null, yawDeg: number, clear: number,
    ): { id: EntityId; x: number; z: number } => {
      const where = place(owner, key, p);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      // Block AFTER placing, so the next ring search cannot land on top of this
      // one and so `scatter` leaves the lot walkable.
      if (id !== NONE) b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    /* ==================================================================
     * 1. THE TWO OPENINGS
     *
     * The ordinary two-army opening on both seats, which is the position a
     * player already understands — an operation whose first minute is
     * unfamiliar spends that minute teaching the sidebar instead of the
     * coast. `garrison` is left at its default on BOTH seats, and on the
     * player's it is what makes the split legible on the first frame: the
     * escort contains four Solarchs that can swim and one Artificer who
     * cannot.
     * ================================================================== */
    buildBaseFor(b, pact, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, allies, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* ==================================================================
     * 2. THE CUT
     *
     * From the surf inland to `CUT_INLAND`, one wall per cell, stopping at
     * the first wet cell. See the header for why it is walked rather than
     * counted.
     *
     * The SEAWARD half runs first, deliberately: it is the half that has to
     * reach the water, and running it first means no later ring search can
     * have taken a cell out of it.
     *
     * IT LANDS 68 SEGMENTS AT THIS OPERATION'S SEEDS, spanning p = -58.2 to
     * +98.0 — 156 m of frontage, so the staircase enters a new cell every
     * 2.3 m rather than every 4, because the run is 40 degrees off the axes.
     * (This said 50 segments, p = -58.0 to +98.2, and "a new cell every
     * ~2.8 m". Re-counted on the built world 2026-08-19: only the 156 m of
     * frontage survived.)
     *
     * **SEVEN OF THEM STAND ON GROUND `isBuildable` REFUSES AND THAT IS
     * EXPECTED, NOT A DEFECT.** They are the last segments before the surf: the
     * beach cone is deliberately not `buildGrid` ground on any roll of any
     * seed, and a run that stopped at the last BUILDABLE cell instead of the
     * last DRY one would leave a gap somebody could walk through.
     * `spawnBuilding` counts the condition and plants the structure anyway,
     * which is the behaviour its own header argues for — "a scenario is
     * authored content rather than a player's click".
     *
     * **THE BUILD LOG SAYS NINE, AND TWO OF THOSE NINE ARE NOT THIS RUN.** The
     * connectivity line counts the whole world, and `addCivilians` puts
     * `civApartments` at 296,326 and `civOilDerrick` at 216,208 on ground the
     * placement rule also refuses, nowhere near the beach. Both this file and
     * the operation's header used to read the log's nine as "all nine are wall
     * segments"; the COUNT was right and the ATTRIBUTION was invented.
     * ================================================================== */
    const cutN = len * CUT_ALONG;
    const wallKey = b.keyFor(allies, 'wall');
    const wallFoot = b.footprintOf(wallKey);

    /** Walk a wall along the cut from `p0` toward `p1`, one segment per cell. */
    const runCut = (p0: number, p1: number): number => {
      const used = new Set<number>();
      const dir = p1 >= p0 ? 1 : -1;
      let placed = 0;
      for (let p = p0; dir > 0 ? p <= p1 : p >= p1; p += CUT_STEP * dir) {
        if (placed >= CUT_MAX_SEGMENTS) break;
        const q = at(cutN, p);
        // Key by the CELL the point falls in, so two steps inside one cell are
        // one segment and `spawnBuilding` never has to relocate.
        const key = Math.floor(q.z / CELL) * 4096 + Math.floor(q.x / CELL);
        if (used.has(key)) continue;
        used.add(key);
        /*
         * STOP AT THE WATER, AND THE REASON IS THE OPPOSITE OF THE OBVIOUS ONE.
         *
         * `spawnBuilding` will NOT refuse a wet cell and will not move the
         * segment: `connectedGround` is called with `strandedOnly`, and its
         * first test is `regionAt(cx, cz) === 0` — an impassable cell is left
         * exactly where the layout put it. So a run that steps past the surf
         * plants concrete in the sea, `markOccupied` blocks those cells for
         * EVERY class that touches the ground, hover included, and the cut ends
         * up sealing the one lane the whole operation exists to leave open.
         */
        if (wet(q.x, q.z)) break;
        if (!b.footprintClear(q.x, q.z, wallFoot.w, wallFoot.h)) continue;
        if (b.spawnBuilding(wallKey, allies, q.x, q.z, { yawDeg: outward }) !== NONE) placed++;
      }
      return placed;
    };

    runCut(0, CUT_SEAWARD_LIMIT);
    runCut(-CUT_STEP, CUT_INLAND);

    /*
     * THE GAP, AND THE TWO GUNS ON IT.
     *
     * Both are tagged `gun`, and that tag is what the hidden secondary reads:
     * coming round the cut WHILE THE CUT STILL STANDS is the objective, so
     * breaking it retires the objective rather than completing it.
     *
     * The Refractor Tower is the whole price of the road. `prismTowerBeam`
     * reaches 34 m; the Pact's `focusLance` reaches 26 and its `arcRepeater`
     * 23, so a Solarch that comes through the gap gives away eight metres
     * before it can answer. It is `struct.defence.specialist` on the
     * operation's `roster.ai` and on nothing else — remove that line and
     * `spawnBuilding` refuses this tower and the cut has no teeth at all.
     *
     * The Pillbox is `power: 0` and fires through a blackout; the tower is
     * -50 and does not. Both sit on the Allied side of the wall, so the gap
     * is covered rather than flanked.
     */
    raise(allies, 'prismTower', at(cutN + 14, CUT_INLAND + 10), 'gun', outward, 14);
    raise(allies, 'pillbox', at(cutN + 12, CUT_INLAND - 14), 'gun', outward, 12);

    /* ==================================================================
     * 3. THE BORE COMPOUND
     *
     * On the sand, past the cut, with its back to open water. A local frame:
     * `u` runs toward the player's opening — the road side, where every gun
     * is sited — and `v` runs seaward, where none are.
     *
     * THE BORE HEAD IS A `civOreMine` AND THAT IS THE OPERATION. It is a
     * Building on an enemy seat, so `CaptureService.isCapturable` says yes
     * to an Artificer and no to every hull in the game — no vehicle in any
     * army carries `canCapture`. The Pact's position is that cutting the
     * March is what makes it spread, so the head has to be TAKEN and capped
     * rather than broken, and the only thing in the army that can take it
     * walks.
     *
     * The mast is an Allied `radar`: the instrument, and the primary. The
     * plant is not decoration — the compound's Pillbox is free but the two
     * `gun` towers at the cut are not, and the Allied base's own margin is
     * +120 before this compound draws anything. A dark tower is a gun line
     * that does not exist, and that is a defect nothing but a match shows.
     * ================================================================== */
    const compound = at(len * COMPOUND_ALONG, COMPOUND_OFFSET);
    const spot = (u: number, v: number): { x: number; z: number } => ({
      x: compound.x - nx * u + px * v,
      z: compound.z - nz * u + pz * v,
    });

    /*
     * THE MAST IS INLAND OF THE HEAD AND THAT IS THE COMPOSITION, NOT DRESSING.
     *
     * The road arrives on the landward face and the water arrives on the
     * seaward one, so putting the primary inland and the secondary on the sand
     * means the ROAD reaches the thing the hulls came to break first, and the
     * WATER reaches the thing only a man can take first. The operation's two
     * halves are laid out in the order each route meets them.
     *
     * The 34 m between them is derived rather than chosen. The first draft had
     * them 18 m apart, measured, which is inside `focusLance`'s own 26 m of
     * reach — so a hull that stopped to kill the mast auto-acquired the head
     * the instant the mast fell, and the secondary failed for doing the
     * primary. Separated past that reach, they are two targets and a choice.
     *
     * **AND THE SAME ERROR WAS THEN MADE A SECOND TIME, ONE OBJECTIVE ALONG.**
     * `wade`'s `unitsInArea` disc was sited 36.9 m off the head and declared
     * clear of `focusLance` on that number — which measures the CENTRE of a
     * 24 m disc and leaves the radius out. Its nearest passable cell was
     * 14.1 m from the head, and 73 of its 112 passable cells were inside a
     * parked Solarch's reach. Fixing one instance of a mis-measurement is not
     * fixing the class of it, so the class is a test now:
     * `tests/campaign-zone-safety.spec.ts`.
     *
     * **AND 26 m IS NOT THE RIGHT BAR HERE EITHER, WHICH THIS BLOCK STILL
     * IMPLIES.** Acquisition compares SURFACE distance — centre to centre less
     * the target's `hitRadius`, 5.66 m for a 2x2 — against
     * `max(range * 1.08, range * APPROACH_STOP_FRAC + STANCE_CHASE_METRES)`,
     * and every unit spawns Aggressive, so a Solarch's real reach is 38.8 m of
     * surface. 34 m of separation does NOT put the head outside that for a hull
     * that came at the mast from the SEAWARD side; it does for one that came up
     * the road, which is the approach the composition is laid out for
     * (26.5 m short of the mast on the inland face is 60.9 m from the head,
     * 55.2 m of surface).
     *
     * **THAT RESIDUAL IS DELIBERATE AND THE `wade` ONE WAS NOT, AND THE
     * DIFFERENCE IS WHO CHOSE THE SPOT.** Where a hull parks to shoot the mast
     * is the player's decision, and the operation's header argues at length
     * that losing the head to your own carelessness on that beach is a failure
     * this operation wants to be able to have. `wade` is the opposite: the
     * operation NAMES the ground, pays for standing on it, and hides the
     * objective until it is revealed — so a zone that costs the player another
     * objective is the operation setting the trap itself.
     */
    raise(allies, 'civOreMine', spot(0, 0), 'bore', outward, 20);
    raise(allies, 'radar', spot(2, -34), 'mast', outward, 18);
    raise(allies, 'powerPlant', spot(-26, -30), null, outward, 16);
    // The compound's own gun, on the road face. UNTAGGED, on purpose: the
    // hidden secondary asks whether the CUT still stands, and a third `gun`
    // sitting here would let a player who had already broken the cut satisfy
    // it from the road.
    raise(allies, 'pillbox', spot(28, -18), null, outward, 12);

    /*
     * THE POST. Four riflemen and a hull, standing in the compound.
     *
     * `Stance.Defensive` is "fire at anything in range, never leave position to
     * start a fight", which is the only stance that reads as on-post — and
     * `AiBrain.regroupSquads` will march them off it on the first brain pass
     * whatever this file says. That is exactly why NO TAG and no trigger
     * depends on where they are. They are the reason the beach is not empty on
     * the first frame, and nothing more than that.
     */
    for (let i = 0; i < 4; i++) {
      const q = spot(14 + (i % 2) * 6, 8 - (i >> 1) * 12);
      b.spawnUnit('gi', allies, q.x, q.z, { yawDeg: outward, stance: Stance.Defensive });
    }
    const hull = spot(8, 18);
    b.spawnUnit('grizzly', allies, hull.x, hull.z, { yawDeg: outward, stance: Stance.Defensive });

    /* ==================================================================
     * 4. ORE, DRESSING AND THE OPENING FRAME
     * ================================================================== */
    // The standard two-army economy: one field per opening and a contested
    // patch on the midline. It takes `b.sea`, so it already knows not to seed
    // into the water.
    addStartOre(b, spots, b.sea);
    addCivilians(b, spots);

    /*
     * NO FOURTH ORE FIELD, AND THE ONE THAT WAS HERE WAS A FALSE CLAIM.
     *
     * A patch was authored on the beach past the cut under the note "one patch
     * the Pact can work and the Allies cannot" — a Collector hovers and the
     * shared harvester does not. Measured on the built world, that is simply
     * untrue: the cut is a line from the surf to 60 m inland, so the beach
     * BEYOND it is on the same side as the Allied opening and their harvesters
     * walk to it without crossing anything. There is no water-only ore on a
     * half-plane sea, because there is no land the water encloses.
     *
     * Deleted rather than left with a corrected comment. It was authored for a
     * reason that turned out not to exist, and a contested patch inside the
     * enemy position that nothing in the operation asks for is content nobody
     * would ever have a reason to take.
     */

    // Dressed over the corridor the composition occupies rather than a square
    // on the map centre, which on this layout is nobody's ground.
    const minX = Math.min(home.x, foe.x, compound.x) - 80;
    const maxX = Math.max(home.x, foe.x, compound.x) + 80;
    const minZ = Math.min(home.z, foe.z, compound.z) - 80;
    const maxZ = Math.max(home.z, foe.z, compound.z) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    // The opening frame: the player's yard with the coast behind it.
    b.setCameraFocus(home.x + px * 14, home.z + pz * 14);
    void start;
  },
});
