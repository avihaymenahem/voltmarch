/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-held-paper.ts
 * ============================================================================
 * R1 — THE GROUND. A city, a garrison that owns it on the map, and four
 * working yards strung through it that belong to somebody else.
 *
 * **THE PLAYER GETS NO BASE, AND THAT IS THE WHOLE OPERATION.** `opening` is
 * `'force'`, so this layout never calls `buildBaseFor` for seat 0. It places
 * FOUR LOTS instead — one structure each, one FUNCTION each, none of them
 * within sight of another — and every one of them projects its own build space
 * (`PLACEMENT.adjacencyRadius` 20 m, or `BUILD_RADIUS` 56 m at the Foundry).
 * So the player opens able to build in four places at once and to defend none
 * of them, which is a position no skirmish can produce and the only honest way
 * to say "you already hold this district" in world state rather than in prose.
 *
 * THE FOUR LOTS ARE A SUPPLY CHAIN POINTING AT THE ENEMY, and the order is
 * authored rather than incidental: power nearest home, then the builder, then
 * the money, then the crew hall — so the deeper into the city a lot sits, the
 * more the player needs what it makes. The offsets alternate sign, so walking
 * your own chain crosses the district's main road three times. That is the only
 * lever this file has over the street layout and it is stated as such: a layout
 * cannot query `RoadNetwork` (it does not exist yet when `PLANS.campaign.build`
 * runs), so nothing here CLAIMS to place anything relative to a carriageway.
 * What it does is put the composition on both sides of the corridor the
 * generator will pave.
 *
 * **EVERY TAG THIS STAMPS IS DECLARED ABOVE `build`.** `validateCampaign`
 * refuses an operation whose triggers name a tag no layout produces, because
 * `entityDead` reads TRUE before a tag has ever existed — a mistyped `protect`
 * fails the player on tick one, silently. `tests/campaign-maps.spec.ts` builds
 * this headlessly and checks the declaration against what actually landed, in
 * both directions.
 *
 * ============================================================================
 * THREE THINGS THIS FILE DOES DIFFERENTLY FROM `soviets-first-tap`, ON PURPOSE
 * ============================================================================
 *
 * **1. IT DOES NOT ROTATE THE STARTS, AND `home` IS RESOLVED BY OWNER.**
 * `rotateStarts` exists so a SKIRMISH player does not see the same corner every
 * match. An operation's `mapSeed` and `simSeed` are constants, so the rotation
 * here can only ever resolve to one value — a moving part with no motion —
 * while making every authored coordinate depend on `startOffset(seed, n)`.
 * Worse, `soviets-first-tap` takes `home = seats[0]` AFTER rotating, and
 * `rotateStarts` puts the AI in spot 0 on half of all seeds; its tap is
 * therefore 0.66 of the way from whichever base happens to sit there. Nothing
 * here can be off by a whole map: seat 0 owns spot 0 because this file never
 * shuffles the owners.
 *
 * **2. THE ENEMY BASE IS BUILT `garrison: false`.** That drops the standing
 * eleven-unit army `buildAlliedGarrison` normally parks behind the wall — and
 * with it the two harvesters, which are replaced below, because an opponent
 * with no income never grows and "nobody has noticed" would become "nobody is
 * playing". Every enemy unit standing at t = 0 is therefore placed HERE, at the
 * district office, where the operation wants it: a watch detachment facing
 * outward at a threat from outside the city, with the player's yards behind it.
 *
 * **3. IT PLACES ITS OWN ORE INSTEAD OF CALLING `addStartOre`.** That helper
 * hangs a patch off each START SPOT at `+18` forward and `+44` perpendicular —
 * derived for a layout where each start has a base and a refinery on it. Seat 0
 * has neither; its refinery is 135 m up the road at the Sorter lot, and the
 * perpendicular `addStartOre` uses is the same one this file uses, so its patch
 * would have landed underneath the Furnace lot. Three explicit fields instead:
 * one at the Sorter, one at the garrison, one contested on the midline.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless an operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot,
 * so this gets the same world on every machine by construction.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/* ==========================================================================
 * THE COMPOSITION, AS FRACTIONS OF THE START-TO-START LINE
 *
 * DERIVED FROM THE START SPOTS RATHER THAN HARD-CODED, because the spots
 * themselves move with the seed — `seatedSlots` chooses WHICH slots a match
 * uses and the generator levels a shelf under each. A literal would put a lot
 * inside somebody's base the first time either moves.
 *
 * On the two-army landlocked table the opening is 386.2 m, so `along` 0.01 is
 * 3.9 m and `offset` is already in metres. The alternating sign is the point:
 * consecutive lots sit on opposite sides of the corridor between the armies.
 * ========================================================================== */

interface Lot {
  /** Fraction of the way from the player's start toward the garrison's. */
  readonly along: number;
  /** Metres off that line. Sign alternates so the chain zig-zags. */
  readonly offset: number;
}

/** Power. 80 produced against 70 drawn — see the block above `build`. */
const FURNACE: Lot = { along: 0.07, offset: -44 };
/** The only builder the player owns, and the only 56 m build radius. */
const FOUNDRY: Lot = { along: 0.19, offset: 40 };
/** Money. The Sorter, its Scrapjaw and the field it works. */
const SORTER: Lot = { along: 0.35, offset: -58 };
/** Crews. The deepest lot, and the one that makes the answer to a wall. */
const ROOKERY: Lot = { along: 0.49, offset: 46 };
/** The objective. On the midline, two thirds of the way in. */
const OFFICE: Lot = { along: 0.67, offset: -16 };

/**
 * Cells searched outward for buildable ground under a lot. Seven is 28 m —
 * wider than any lot moves at this operation's seeds, and narrower than the
 * gap between two lots, so a search can never walk one lot into the next.
 */
const PLACE_RINGS = 7;
/** Metres from a lot's structure that `scatter` may not drop a prop. */
const LOT_CLEAR = 26;
/**
 * Metres reserved around the district office so `scatter` leaves the compound
 * alone. Wider than `WALL_STANDOFF` plus a wall segment, or the run would come
 * back dressed in barrels.
 */
const OFFICE_CLEAR = 52;

/** Segments across the office's approach face, and how far out they stand. */
const WALL_SEGMENTS = 15;
const WALL_STANDOFF = 34;

export default layout({
  id: 'reclamation-held-paper',

  /*
   * `column` is stamped by a `spawnUnits` effect rather than by this file, and
   * `validateCampaign` still requires it here — the effect's own tag is deleted
   * from the used set only when the spawn is written BEFORE the `orderTagged`
   * that names it, and relying on the order of two lines in another file is not
   * a contract. Declared for the same reason `soviets-first-tap` declares
   * `relief`: somebody looking for "where does this come from" should find the
   * answer in the file that owns the ground.
   */
  tags: ['yard', 'office', 'transformer', 'watch', 'column'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    // NO `rotateStarts`. See the header — the seed is a constant here, so the
    // rotation has exactly one value, and taking it would make every measured
    // coordinate in the operation file depend on `startOffset`.
    const player: PlayerId = c.seat(0);
    const garrison: PlayerId = c.seat(1);
    const home = seats[0];
    const foe = seats[1] ?? seats[0];

    /* -- the frame ------------------------------------------------------- */
    const dx = foe.x - home.x;
    const dz = foe.z - home.z;
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    const nx = dx / len;
    const nz = dz / len;
    // Left-hand perpendicular. Every `offset` below is measured along this.
    const px = -nz;
    const pz = nx;

    const at = (lot: Lot): { x: number; z: number } => ({
      x: home.x + nx * len * lot.along + px * lot.offset,
      z: home.z + nz * len * lot.along + pz * lot.offset,
    });

    /**
     * Put a structure on ground its footprint can legally stand on.
     *
     * **`findClearFootprint` ANSWERS THE WRONG QUESTION FOR A LOT THE PLAYER HAS
     * TO BUILD OUT OF.** It tests `footprintClear` — occupancy — and
     * connectivity, and nothing about grade; `spawnBuilding` calls it for
     * overlap and then plants the structure on whatever slope is underneath,
     * counting the result in `auditConnectivity().unbuildableGround` and
     * reporting success. `soviets-first-tap` uses it directly and ships five
     * structures on ground `isBuildable` refuses. That is survivable for a
     * civilian derrick nobody extends; it is not survivable for a Foundry,
     * because the 56 m build radius the whole operation depends on is projected
     * from a structure standing in a hole.
     *
     * So this searches for a footprint that is clear AND `footprintBuildable`
     * first, in rings, with a fixed traversal order so two runs of one seed
     * place the same city. It falls back to `findClearFootprint` and then to the
     * nominal point, because a Foundry that fails to appear is an operation with
     * no build radius anywhere and a Foundry on a slope is only ugly.
     *
     * Measured at this operation's seeds: 3 unbuildable placements before, 0
     * after, with every lot moving less than one search ring.
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
     * **IT RETURNS WHERE THE STRUCTURE ACTUALLY WENT, not where it was asked
     * for**, and every crew, hauler and ore field below is anchored to that
     * rather than to the nominal lot point. The Foundry moves 14.5 m at this
     * operation's seeds; a crew posed off the nominal point would be standing
     * inside its own building, and `spawnUnit`'s `connectedGround` would shove
     * them somewhere neither the layout nor the composition chose.
     *
     * `search` is off for wall segments only: a run laid on the perpendicular is
     * a CONTINUOUS BARRIER, and a segment that relocates two cells to find
     * flatter ground opens a gap an infantry squad walks through. `spawnBuilding`
     * still de-overlaps them internally, which is the only thing they need.
     */
    const raise = (
      owner: PlayerId, key: string, p: { x: number; z: number },
      tag: string | null, yawDeg: number, clear: number, search = true,
    ): { id: EntityId; x: number; z: number } => {
      const where = search ? place(owner, key, p) : p;
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      // Block AFTER placing, so the next search cannot land on top of this one
      // and so `scatter` leaves the lot walkable.
      if (id !== NONE) b.block(where.x, where.z, clear);
      return { id, x: where.x, z: where.z };
    };

    // Bearing from a lot toward the garrison, so a structure faces the city
    // rather than a compass direction.
    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));

    /* ==================================================================
     * 1. THE GARRISON'S BASE
     *
     * A real opponent with a real economy, at its own start spot, 386 m up
     * the road. `garrison: false` for the reason in the header; the two
     * harvesters it would have brought are replaced immediately below,
     * because `buildAlliedGarrison` is the only thing in `buildBaseFor`
     * that puts a hauler on the map and an opponent that never mines never
     * grows.
     * ================================================================== */
    buildBaseFor(b, garrison, foe.x, foe.z, {
      facingDeg: wrapDeg(foe.facingDeg + 180),
      garrison: false,
    });
    // Role key, so this is a Scrapjaw / Collector / Harvester according to
    // whichever army the lobby seated as the opponent — `keyFor` resolves it
    // and this file never learns the answer.
    for (let i = 0; i < 2; i++) {
      b.spawnUnit('harvester', garrison, foe.x - px * 26 + nx * (i * 12 - 6),
        foe.z - pz * 26 + nz * (i * 12 - 6), { yawDeg: wrapDeg(foe.facingDeg + 180) });
    }

    /* ==================================================================
     * 2. THE FOUR YARDS
     *
     * ONE STRUCTURE PER LOT, AND THE POWER BUDGET IS WHY IT IS FOUR AND NOT
     * FIVE. `rclFurnace` produces 80; Foundry 20 + Sorter 30 + Rookery 20
     * draws 70. Adding a Breaker Yard (40) would put the player in a
     * brownout on tick one — which closes every unit tab (`census` skips a
     * dark producer) and reads as a broken build rather than as a design.
     * So the player opens with NO vehicle factory at all, 1900 credits
     * short of one against a 3000 bank, and that is the operation's first
     * real decision: hulls, or seven Slaggers out of a Rookery you already
     * hold.
     *
     * Every one of these four is untagged in `UNLOCK_TAGS`, so the
     * operation's roster allow-list cannot refuse one. That matters more
     * here than anywhere else in the layout: a refused `spawnBuilding`
     * returns NONE, the tag lands on nothing, and `ownerCount` would read
     * three yards standing from tick one.
     * ================================================================== */
    const furnaceAt = at(FURNACE);
    const foundryAt = at(FOUNDRY);
    const sorterAt = at(SORTER);
    const rookeryAt = at(ROOKERY);

    raise(player, 'rclFurnace', furnaceAt, 'yard', inward, LOT_CLEAR);
    const foundry = raise(player, 'rclFoundry', foundryAt, 'yard', inward, LOT_CLEAR);
    const sorter = raise(player, 'rclSorter', sorterAt, 'yard', inward, LOT_CLEAR);
    const rookery = raise(player, 'rclRookery', rookeryAt, 'yard', inward, LOT_CLEAR);

    // The Sorter's own hauler. `shipsWith` pays a free Scrapjaw when a refinery
    // FINISHES BUILDING, and a scenario-placed structure never finishes — it
    // arrives complete — so without this the player owns a refinery and nothing
    // to feed it. Cargo part full, because a yard that has been running all
    // morning has a hauler in the middle of a haul.
    if (sorter.id !== NONE) {
      b.spawnUnit('rclScrapper', player, sorter.x + px * 16, sorter.z + pz * 16, {
        yawDeg: inward, cargoFrac: 0.35,
      });
    }

    // The crews. Three Pickers per working lot, standing where the work is —
    // they are what makes an empty industrial lot read as a STAFFED one, and
    // they are the only thing the player can shoot with at t = 0.
    for (const lot of [foundry, sorter, rookery]) {
      b.formation('rclPicker', player, lot.x - nx * 15, lot.z - nz * 15, 3, {
        yawDeg: inward, spacing: 4.5, columns: 3, stance: Stance.Defensive,
      });
    }

    /* ==================================================================
     * 3. THE DISTRICT OFFICE
     *
     * The objective, and the reason the operation is an assault rather than
     * a hold. A mast, the transformer that feeds it, two power-drawing
     * towers, two that draw nothing, a watch detachment, and a wall across
     * the face the player will arrive at.
     *
     * THE TRANSFORMER IS A REAL MECHANISM AND NOT A PROP. Any structure
     * that DRAWS power and is dark cannot fire (`src/sim/Combat.ts`, the
     * universal tier), so killing the power plant silences the two
     * specialist towers outright. The two `pillbox`-role emplacements are
     * `power: 0` in every army's column and fire through a blackout, which
     * is what keeps the cut an ADVANTAGE rather than an I-win button — the
     * compound still has teeth, it just stops having the good ones.
     *
     * ROLE KEYS THROUGHOUT. The lobby's `aiFaction` decides who the
     * garrison is and an operation cannot override it (`Shell.startOperation`
     * fills `opponents` from `this.setup.aiFaction`), so nothing here may
     * name an army's own def. `keyFor` turns `prismTower` into the seated
     * faction's specialist tower and `radar` into its mast.
     * ================================================================== */
    const officeAt = at(OFFICE);
    // Facing back down the road at the player. Every structure in the compound
    // wears it, because a compound faces the direction it was built to watch.
    const outward = wrapDeg(inward + 180);

    /*
     * THE COMPOUND IS LAID OUT IN ITS OWN FRAME, and doing it any other way is
     * how the first draft put both concrete emplacements OUTSIDE their own
     * wall. `u` runs toward the player — the approach — and `v` runs across it.
     * Every offset below is metres in that frame and every separation was
     * checked against the two footprints it sits between.
     */
    const spot = (u: number, v: number): { x: number; z: number } => ({
      x: officeAt.x - nx * u + px * v,
      z: officeAt.z - nz * u + pz * v,
    });

    raise(garrison, 'radar', spot(0, 0), 'office', outward, 20);
    // Behind the mast, on the garrison's own side, where a district would put
    // the thing it does not expect to be shot at.
    raise(garrison, 'powerPlant', spot(-24, 10), 'transformer', outward, 18);

    // The two that go dark. `prismTower` is `struct.defence.specialist`, which
    // is TAGGED — the operation's `roster.ai` names it, and if that line is ever
    // removed `spawnBuilding` refuses these two and they silently do not exist.
    // They sit on the flanks rather than on the axis, so the ends of the wall
    // are what they cover.
    raise(garrison, 'prismTower', spot(16, 20), null, outward, 14);
    raise(garrison, 'prismTower', spot(16, -20), null, outward, 14);

    // The two that do not. Untagged content, so no roster can withhold them,
    // and `power: 0` in every army's column so no blackout can quiet them.
    // On the axis, behind the wall, covering the ground a breach opens onto.
    raise(garrison, 'pillbox', spot(24, 7), null, outward, 12);
    raise(garrison, 'pillbox', spot(24, -7), null, outward, 12);

    /*
     * THE WALL. Fifteen segments across the approach face, 34 m out.
     *
     * **IT DOES NOT SEAL THE COMPOUND AND IS NOT MEANT TO.** Sixty metres of
     * frontage against an open flank is not a barrier, it is a PRICE: a hull
     * column that goes round the end arrives 14 m from a tower, at the range
     * those towers are for, with no way to back out of it. Going through costs
     * Slaggers, whose own blurb is "the only thing that hurts a wall" and who
     * come out of the Rookery the player already holds. Both answers are
     * ungated and affordable and neither is free, which is the whole of what
     * an authored obstacle is supposed to buy.
     *
     * `spawnBuilding` marks the cells occupied, so this is a real nav barrier
     * to anything on foot or wheels and not a decal.
     */
    const wallKey = b.keyFor(garrison, 'wall');
    const wallStep = Math.max(1, b.footprintOf(wallKey).w) * CELL;
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const v = (i - (WALL_SEGMENTS - 1) * 0.5) * wallStep;
      raise(garrison, 'wall', spot(WALL_STANDOFF, v), null, outward, 2.5, false);
    }

    /*
     * THE WATCH. Standing INSIDE the compound, `Stance.Defensive` — "fire at
     * anything in range, never leave position to start a fight" — which is the
     * only stance that means "on post". They are tagged so the trigger table can
     * walk them off that post the moment the district is told there is a
     * problem, and that is the single most important image in the operation:
     * the men guarding the office turn round and go for the yards.
     *
     * SPAWNED ONE AT A TIME RATHER THAN THROUGH `formation`, because
     * `ScenarioBuilder.formation` returns a COUNT and this needs the HANDLES.
     * Recovering them from `store.alive` afterwards would work today and would
     * be wrong the first time anything else allocates in between; a loop that
     * holds each id is exact by construction.
     *
     * Both files sit clear of every footprint above: the infantry rank at
     * v = -26..-16 is 6.8 m off the near tower, the two hulls at v = +26 and
     * +34 are 11.7 m off the far one.
     */
    for (let i = 0; i < 6; i++) {
      const p = spot(6 + (i / 3 | 0) * 5, -26 + (i % 3) * 5);
      c.tag('watch', b.spawnUnit('gi', garrison, p.x, p.z, {
        yawDeg: outward, stance: Stance.Defensive,
      }));
    }
    for (let i = 0; i < 2; i++) {
      const p = spot(6, 26 + i * 8);
      c.tag('watch', b.spawnUnit('grizzly', garrison, p.x, p.z, {
        yawDeg: outward, stance: Stance.Defensive,
      }));
    }
    b.block(officeAt.x, officeAt.z, OFFICE_CLEAR);

    /* ==================================================================
     * 4. ORE, DRESSING AND THE OPENING FRAME
     * ================================================================== */
    // The player's field, hard against the Sorter so the haul is short and the
    // lot reads as a working one rather than a decorative refinery.
    b.addOre(sorter.x - px * 34, sorter.z - pz * 34, 30);
    // The garrison's, beside its own refinery face.
    b.addOre(foe.x - px * 44 + nx * 18, foe.z - pz * 44 + nz * 18, 30);
    // The contested patch, on the midline between the Rookery and the office —
    // i.e. exactly where the player has to stand to stage the assault anyway.
    b.addOre(home.x + nx * len * 0.5, home.z + nz * len * 0.5, 22);

    // Dressed over the corridor the composition actually occupies rather than a
    // square around the map centre, which on this layout is nobody's ground.
    const boxMinX = Math.min(home.x, officeAt.x) - 90;
    const boxMaxX = Math.max(home.x, officeAt.x) + 90;
    const boxMinZ = Math.min(home.z, officeAt.z) - 90;
    const boxMaxZ = Math.max(home.z, officeAt.z) + 90;
    b.scatter({ minX: boxMinX, minZ: boxMinZ, maxX: boxMaxX, maxZ: boxMaxZ }, 150);

    // The opening frame: the Foundry, with the road into the city behind it.
    // `Shell.applyCameraPostBoot` re-poses on `findHome`, which finds the same
    // structure — this is what the headless and `?shot=` paths read.
    b.setCameraFocus(foundry.x + nx * 16, foundry.z + nz * 16);
    void start;
  },
});
