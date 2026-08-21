/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-right-of-entry.ts
 * ============================================================================
 * S7 — THE GROUND. The Ninth District's record, in two blocks: the part at a
 * freight halt out on the lane and the counterpart at the district office
 * behind it, each with two guns sited to cover its own doorway and nothing
 * else.
 *
 * Every figure below is read off a headless build with the def tables BOUND
 * (`buildScenario(..., { defs })`) and `setCampaignRoster` INSTALLED, which is
 * the only state in which this operation's allow-list is actually in force —
 * `soviets-demolition-order`'s header measures all four combinations and shows
 * that neither half alone does anything.
 *
 * ============================================================================
 * WHY THE RECORD IS TWO BLOCKS AND WHY THEY ARE `civApartments`
 * ============================================================================
 * TWO, BECAUSE THAT IS WHAT A COUNTERPART IS. A lease is executed in two parts
 * and each side signs one; the entry cannot be made from either half alone.
 * Mechanically it is what makes the primary a JOURNEY rather than a click: the
 * two stand **91.39 m** apart, at 187.24 m and 277.77 m from the player's
 * Construction Yard and at 114.77 m and 82.97 m from the Ninth's. So the halt
 * is a push the player can make early and the office is a raid onto their
 * doorstep — two targets, two prices, and `soviets.07.right-of-entry`'s hidden
 * secondary is about the interval between them.
 *
 * `civApartments`, OWNED BY SEAT 1, AND BOTH HALVES OF THAT ARE DELIBERATE:
 *
 *   - **A CIVILIAN SILHOUETTE**, for `soviets-first-tap`'s reason and with more
 *     riding on it: the player has to be able to tell the thing they must NOT
 *     destroy from the base they are shooting at, and at gameplay zoom the
 *     silhouette is the only thing carrying that. The `civ*` keys are also the
 *     only structures in the game no sidebar can build — they carry no row in
 *     `src/sim/Production.ts#CONTENT`, so `src/data/Civilians.ts` can say they
 *     "reach the world through `ScenarioBuilder.spawnBuilding` and no other
 *     door" — and nothing either army does can put a second one on the map to
 *     confuse the count.
 *   - **OWNED BY THE ENEMY, NOT BY GAIA**, which is the whole operation.
 *     `Capture.ts` rule 1 flips a NEUTRAL structure at any health, so a Gaia
 *     block would cost one engineer and no thought. Rule 2 flips an enemy
 *     structure only at or below `CAPTURE.captureHpFrac` (0.5), and an engineer
 *     that arrives above it is spent SOFTENING instead. That ladder is the
 *     operation; the arithmetic is in the operation file.
 *
 * `civApartments` is 2x3 cells — 8x12 m, the tallest civilian block in the
 * game at 15 m, so it reads from across the lane — **800 hp**, `ArmorClass`
 * `Concrete`, and its `hitRadius` is the footprint half-diagonal
 * `sqrt(4^2 + 6^2) = 7.211 m`.
 *
 * ============================================================================
 * THE GUNS COVER THE DOORWAY AND CANNOT REACH THE PAGE
 * ============================================================================
 * Two `pillbox` each, and they are STRUCTURES for the reason every other
 * campaign guard is: `AiBrain.regroupSquads` files every untagged hull the seat
 * owns into a squad on its next pass, and an emplacement cannot be re-filed.
 * `soviets-common-standard` measured what happens otherwise: two parked Wardens
 * were **116.6 m and 129.2 m** from the vehicle park they were placed on inside
 * twenty seconds, and died 127 m away having never stood on it.
 * (`soviets-demolition-order`'s layout credits that trace to
 * `soviets-company-town`. The operation it was taken on is
 * `soviets.02.common-standard`, which is where its own header and
 * `tests/campaign-maps.spec.ts` both put it.)
 *
 * `pillbox` is 400 credits, 500 hp, **power 0** (so a blackout does not silence
 * it — the same fact CLAUDE.md records about the three power-free
 * emplacements), range 22, and `pillboxMg` delivers **65.82 dps against
 * infantry** (5 x 13 on a 0.79 s cycle, `ARMOR_MATRIX[SmallArms][Infantry]`
 * 1.00, `COMBAT_DAMAGE.globalMul` 0.80). An engineer is 90 hp, so one pillbox
 * kills a man in the doorway in **1.37 s** and two do it in 0.68. The guns are
 * the reason the crew cannot simply be walked in.
 *
 * Measured where they land, and the distance that matters is to the block they
 * cover:
 *
 *     halt     pillbox (318, 330)   23.41 m from the register
 *              pillbox (286, 358)   22.36 m
 *     office   pillbox (362, 290)   21.63 m from the counterpart
 *              pillbox (394, 318)   21.26 m
 *
 * **THE NEAREST IS 21.26 m AND THE NUMBER IT HAS TO CLEAR IS 10.41 m, NOT THE
 * 9.31 THIS FILE SHIPPED.** `Damage.applySplash` accepts a victim at
 * `sqrt(planar) - hitRadius(victim) < radius`, so a blast centred on a gun
 * reaches the block it covers only inside `splashRadius + 7.211`. The bound was
 * taken over `WEAPONS` ROWS, which answers "which weapon is biggest" rather
 * than "which blast can a seat put on this ground". Re-enumerated instead over
 * every splash-carrying `Faction.Soviets` or `Faction.Neutral` def, each with
 * the reason `{ player: [], ai: [] }` does or does not leave it standing, read
 * off the bound tables of the rostered build itself:
 *
 *     flameJet      3.2   flameTower    600 cr, prereqs ['barracks'] — UNGATED
 *     twinCannon    2.2   apocalypse    `unit.specialist` — withheld (measured)
 *     heavyCannon   2.1   rhino         the largest a LAND HULL carries
 *     flakBurst     1.1   flakTrooper
 *     shipMissile   4.5   dreadnought   )
 *     torpedo       3.0   submarine     ) a shipyard hull, and this map has
 *     lightCannon   1.6   picketBoat    ) no water
 *
 * **`flameTower` CARRIES NO `UNLOCK_TAGS` ROW AND THAT TABLE'S OWN COMMENT SAYS
 * SO IN CAPITALS** — *"NOT `flameTower`. The Soviet cheap defence is
 * `sentryGun` and the flame tower is its 600-credit twin off the same prereq"* —
 * so no allow-list can withhold it, and the rostered build hands seat 0 **two of
 * them standing in its opening base**. 3.2 + 7.211 = **10.41 m** against
 * 21.26 m of clearance: **a margin of 10.85 m at the tightest gun on the map**,
 * where this file used to say 11.95. The conclusion survives; the figure
 * supporting it did not, and 11.95 m is now the margin for the largest blast a
 * HULL can drive up to a gun. `apocalypse`'s 2.2 is still MEASURED rather than
 * assumed — the unrostered control build hands the player one in its opening
 * force and the rostered build does not.
 *
 * ============================================================================
 * ONE BLAST DOES REACH A BLOCK FROM ITS OWN GUN, AND IT IS NOT A WEAPON ROW
 * ============================================================================
 * `commandPost` carries `prereqs: ['radar']` and **no `unlockedBy`**, the
 * player's opening base holds a `radar`, and CLAUDE.md lists the Command Posts
 * among the content that is deliberately ungated — so this operation's
 * allow-list structurally cannot refuse one and the Powers tab is reachable.
 * `power.airstrike` is 1500 credits on top of the Post's 1500, `chargeSeconds`
 * 150, radius **20**, `airstrikeDamage` 260 `HighExplosive`,
 * `airstrikeFalloff` 0.3 — and `CommanderPowers.applyAirstrike` pushes it down
 * the ordinary damage channel, so it resolves through the same `applySplash`
 * every figure above uses.
 *
 * At the tightest gun: surface = 21.26 - 7.211 = **14.05 m**, inside 20, so
 * `t = 1 - 14.05/20 = 0.2975`, `falloff = 0.3 + 0.7 x 0.2975^1.6 = 0.4006`,
 * dealt = 260 x 0.4006 x 1.00 x 0.80 = **83.33 hp, 10.42% of the block, per
 * press.** Its reach is 20 + 7.211 = 27.21 m, which is past every gun on this
 * map.
 *
 * **IT IS A PRICE RATHER THAN A LOSS, AND THAT IS ARITHMETIC RATHER THAN
 * HOPE.** Nine and a half presses level a block at 150 s of charge each:
 * **twenty-four minutes of charging against a nineteen-minute file**, and a
 * block the player already owns halves it again
 * (`COMBAT_DAMAGE.friendlyFireMul` 0.5, 41.67 hp). So the honest form of this
 * section's conclusion: **no gun the player can field reaches a block from the
 * gun that covers it, and the one blast that does cannot finish one inside the
 * operation's own deadline.**
 *
 * ============================================================================
 * WHAT DOES REACH IS ANYTHING STANDING AT THE WALL — HENCE THE TWO STAND POINTS
 * ============================================================================
 * **`surface` CLAMPS AT ZERO.** A shell landing anywhere inside 7.211 m of a
 * block's centre — i.e. against the wall of an 8x12 m footprint — has `falloff`
 * 1.0 and delivers exactly what force-firing the block delivers: one
 * `heavyCannon` shell is **34.32 hp**, and the five Anvils seat 0 opens with are
 * **85.80 dps**, an 800 hp block in **9.32 s**. So *"only shooting the block
 * can"* was false as written, and the trigger table used to make it false by
 * hand: all three block-bound `orderTagged` calls named `REGISTER` and
 * `COUNTERPART`, and the rostered build puts the blocks at **exactly (296.00,
 * 338.00) and (380.00, 302.00)** — those coordinates. The waves' DESIGNED end
 * state was the wall of the thing the operation is about.
 *
 * `HALT_STAND` and `OFFICE_STAND` are where they form up instead, and they were
 * searched for on the same lattice `ROAD_A` and `ROAD_B` were: every 2 m point
 * 18-28 m from its block whose bearing is within 41 degrees of the road the
 * wave comes off (`dot >= 0.75`), scored by clear radius — every 10-degree
 * sample at every 2 m step passable to Foot AND Track and unoccupied. **79
 * candidates at the halt and 52 at the office**; the best of each:
 *
 *     HALT_STAND    (302, 364)   clear 14 m   26.68 m off the register
 *     OFFICE_STAND  (404, 316)   clear  8 m   27.78 m off the counterpart
 *
 * That is `surface` 19.47 m and 20.57 m, so **16.27 m and 17.37 m of margin**
 * over the 3.2 m ceiling above: no gun-mounted weapon the player can field
 * touches a block while firing at a wave standing where the operation told it to
 * stand. Both sit inside their own reveal disc (`HALT_AREA` r 40, `OFFICE_AREA`
 * r 34) so the player watches the column arrive, and **36.06 m and 27.86 m**
 * from their spawn rings, so a wave still walks to its post.
 *
 * **THE RESIDUAL IS REAL AND IS NOT CLOSED BY THIS.** `Targeting` parks an
 * attacker at `range * APPROACH_STOP_FRAC` of whatever it acquires first, so a
 * wave hull that acquires an engineer at the door closes on the door, and the
 * player's own answering fire is then back at `surface` 0. What moving the
 * points buys is that the wall is no longer the DEFAULT — it is where a fight
 * the player chose to have at the block ends up, rather than where the operation
 * itself put six hulls at minute four. The price of being there is the 85.80 dps
 * above, and it is the arithmetic behind the brief's hold-fire order.
 *
 * ============================================================================
 * WHERE THE COLUMNS FORM, MEASURED THE WAY `spawnUnits` ACTUALLY PLACES
 * ============================================================================
 * `EffectSink.spawnUnits` lays a DETERMINISTIC RING: unit `i` of `count` at
 * `angle = i / count * 2pi`, radius `spread`, written verbatim by
 * `ProductionService.spawnUnit` with no egress search. The clear radius below
 * is the stronger reading — every 10-degree sample at every 2 m step out to it
 * is passable to Foot AND Track and unoccupied — so the wave counts may be
 * retuned without re-measuring as long as the spread stays inside it:
 *
 *     ROAD_A  (304, 400)   clear 32 m   99.64 m from the Ninth's yard,  62.51 m from the register
 *     ROAD_B  (430, 326)   clear 28 m   62.61 m from the Ninth's yard,  55.46 m from the counterpart
 *
 * They stand **146.12 m** apart, which is what makes the two schedules two
 * problems rather than one bigger one: a player holding the halt is not holding
 * the office road.
 *
 * Both sit past `BUILD_RADIUS` (56) from their yard: a column that has formed
 * up and is about to leave, rather than an army materialising inside a
 * defender's formation. **THE ORDER IS A HEADING, NOT A LEASH** —
 * `AiBrain.regroupSquads` files every untagged hull the seat owns into a squad
 * on its next pass, so the attack-move is the first thing these hulls do and
 * the brain owns them afterwards. What the waves buy is that the district is
 * stronger at 4:00, 8:00, 12:00 and 16:00 than it could have built itself;
 * `soviets-deep-sector` established that reading and `soviets.02.common-standard`
 * measured it.
 *
 * **THE TWO POINTS WERE SEARCHED FOR, NOT PICKED.** Every 2 m lattice point
 * between 58 and 100 m of the Ninth's yard was scored for clear radius; 654
 * cleared 24 m, and the best in each 45-degree bearing octant is
 * (414, 454) clear 38, (346, 464) clear 36, (304, 400) clear 32 and
 * (430, 326) clear 28. The two shipped are the two whose bearings put one wave
 * on the halt and the other on the office road. The first drafts — (356, 330)
 * and (340, 410) — cleared **2 m and 0 m**, and of the forty-eight ring points
 * probed across six candidate wave shapes on them, **seven** were closed to
 * both Foot and Track. **The spawn POINT was moved; the spread was not tuned**,
 * for the reason `types.ts` states in capitals.
 *
 * ============================================================================
 * NO TRIGONOMETRY IN THE PLACEMENT
 * ============================================================================
 * Every authored point is an integer literal and the search rings are integer
 * offsets. ECMA-262 pins `+ - * /` and `Math.sqrt` and pins neither `sin` nor
 * `cos`; a layout runs independently on both machines of a lockstep match, so a
 * table rotated by trig is a tick-zero desync waiting for two engines to
 * disagree in the last mantissa bit. `rotateStarts` is not called either, for
 * `soviets-demolition-order`'s reason: an operation pins its seed, so the
 * rotation is a moving part with exactly one value.
 *
 * **THE TWO BLOCK LITERALS ARE AUTHORED WHERE THEY LAND, NOT WHERE THEY WERE
 * AIMED.** `place` returning a point is not the same as a structure standing on
 * it — `spawnBuilding` snaps the result to the footprint grid a SECOND time,
 * and the first draft's (296, 336) and (378, 302) came back displaced by 2.00
 * and 2.00 m. The literals below are the built world's own coordinates, which
 * makes the ring search a CHECK rather than a mechanism: it finds both at ring
 * zero today and would report if the ground under one ever moved.
 *
 * `simSeed` **7324** draws the start pair **[0, 2]** for a two-army match — the
 * 296.00 m EAST-WEST lane, and neither of the two 386.16 m diagonals this
 * chapter has already used (`soviets-short-allocation` [0, 1],
 * `soviets-demolition-order` [2, 3]). The layout is handed spots (108, 380) and
 * (404, 380), 296.00 m apart; the CONSTRUCTION YARDS land at (114, 382) and
 * (402, 382), **288.00 m** apart, and every distance in this file and in the
 * operation is measured against those yards rather than against the spots.
 *
 * `mapSeed` **20260925** was chosen on a measured sweep of ten. Counting 4 m
 * cells through the real `Terrain.isPassable(Locomotor.Track)`: **76.61%** of
 * the whole map is track-passable and **92.98%** (1670 of 1796 cells) of the
 * corridor within 40 m of the segment joining the two start spots is — against
 * a band of 81.18% to 92.98% over the ten. **Change either seed and every
 * distance in this file is a different distance.**
 *
 * ============================================================================
 * THE OPENING, AND WHAT THE EMPTY ROSTER ACTUALLY TAKES OFF THE GROUND
 * ============================================================================
 * Built twice, bound both times, once with `setCampaignRoster` armed and once
 * without — which is the only pair of readings that says anything, because a
 * roster is inert unless BOTH halves are present and `campaign-maps.spec.ts`
 * has neither:
 *
 *                     rostered            control (no roster)
 *     seat 0          24 bld  13 units    28 bld  16 units
 *     seat 1          29 bld  12 units    31 bld  14 units
 *
 * The difference is the whole of what `{ player: [], ai: [] }` means here. The
 * player loses `battleLab` and **three `teslaCoil`s** from the line, an
 * `apocalypse` and two `attackDog`s from the opening force; the Ninth loses
 * `battleLab`, a `prismTower` and two `ifv`s. Six of the Ninth's twenty-nine
 * structures are this file's — two record blocks and four pillboxes — so base
 * for base the opening is **23 against 24**, and the asymmetry this operation
 * ships is a verb rather than a tier.
 *
 * ============================================================================
 * WHAT IS NOT HERE
 * ============================================================================
 * NO `addCivilians`, and here the reason is not merely the usual one. It hangs
 * capturable `civOilDerrick`s off the bisector and walks a `civOreMine` out
 * from the midpoint — a second and a third set of neutral civilian silhouettes,
 * on an operation whose primary is "capture that civilian block and not the
 * other one" and whose loss condition is destroying one. It is also two
 * structures the player could capture with one engineer each, which would teach
 * the wrong price for the verb the operation is about.
 * `soviets-company-town`, `soviets-short-allocation` and
 * `soviets-demolition-order` all skip it for the weaker version of the same
 * reason.
 *
 * NO GARRISON IS PLACED IN EITHER BLOCK. `civApartments` holds five men and
 * `GarrisonService` installs a capture VETO for an occupied structure — rule 4
 * in `Capture.ts`, which refuses without consuming the engineer — so a squad
 * standing in a block makes it uncapturable until it is emptied, and emptying a
 * block means shooting it. The Ninth cannot put one there itself: the only
 * `OrderKind.Enter` in `src/sim/AI.ts` is the amphibious boarding path, on a map
 * with a sea, which this is not. The player may garrison a block AFTER taking
 * it, which is a defence rather than a lock.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `books`        — both blocks. The primary is
 *                  `ownerCount(0, 'building', 'books', min: 2)` and the shown
 *                  secondary reads `entityHpBelow('books', …)`, which is the
 *                  weakest of the two.
 * `register`     — the halt block alone, so `entityDead` and
 *                  `structureCaptured` can name it.
 * `counterpart`  — the office block alone, for the same two reasons.
 * `screen` / `lane` / `press` / `last` — produced by `spawnUnits` in the trigger
 *                  table, never by this file, and declared anyway so a reader
 *                  asking where the pressure comes from finds the answer in the
 *                  file that owns the ground.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE } from '../../core/types';
import { addStartOre, buildBaseFor, startSpots, wrapDeg } from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE PLACES THE TRIGGER TABLE ALSO READS
 *
 * World metres, absolute, on a 512 m map. A trigger table is STATIC DATA frozen
 * at module load, so an `Area` or an order point cannot be derived from a start
 * spot the generator has not chosen yet — the coordinates have to be literals
 * somewhere. This module owns them and
 * `operations/soviets/07-right-of-entry.ts` imports them; the dependency runs
 * operation -> layout and never back. A number written in two files is a number
 * that will disagree the first time either is tuned, and the failure — a reveal
 * that frames empty ground, a column that lands somewhere nobody authored — is
 * invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/** The part. 187.24 m from the player's yard, 114.77 m from the Ninth's. */
export const REGISTER: Point = { x: 296, z: 338 };
/** The counterpart. 277.77 m from the player's yard, 82.97 m from the Ninth's. */
export const COUNTERPART: Point = { x: 380, z: 302 };

/**
 * The opening reveal: the halt and both its guns, and NOT the office.
 *
 * r = 40 covers the furthest halt gun (23.41 m) and stops **51.39 m short** of
 * the counterpart at 91.39 m. `revealArea` is `Vision.exploreCircle`, which is
 * PERMANENT, so a disc that already covered the office would make the
 * disclosure at minute three a no-op wearing the costume of a beat — the trap
 * `soviets-short-allocation` records for its third wave and
 * `soviets-demolition-order` sizes its own reveal against.
 */
export const HALT_AREA: Area = { x: REGISTER.x, z: REGISTER.z, r: 40 };
/** The office, revealed when Signals places it at minute three. */
export const OFFICE_AREA: Area = { x: COUNTERPART.x, z: COUNTERPART.z, r: 34 };

/** The lane road. 99.64 m from the Ninth's yard, 62.51 m from the register. */
export const ROAD_A: Point = { x: 304, z: 400 };
/** The office road, the other bearing. 62.61 m from their yard, 55.46 m from the counterpart. */
export const ROAD_B: Point = { x: 430, z: 326 };

/**
 * WHERE A COLUMN ORDERED AT THE HALT ACTUALLY STANDS. 26.68 m off the
 * register, on the lane bearing.
 *
 * The three block-bound `orderTagged` calls used to name `REGISTER` and
 * `COUNTERPART` themselves, and the rostered build puts the blocks at EXACTLY
 * those coordinates — so the waves' designed end state was the wall of the
 * thing the operation is about, where `Damage.applySplash` clamps `surface` to
 * zero and hands the block full damage. See the collateral section of the
 * header for the arithmetic and for how these two points were searched for.
 */
export const HALT_STAND: Point = { x: 302, z: 364 };
/** The same, for the office. 27.78 m off the counterpart, on the office road's bearing. */
export const OFFICE_STAND: Point = { x: 404, z: 316 };

/**
 * The heading the middle wave takes: the contested patch `addStartOre` lays on
 * the midpoint of the two openings, which for slots 0 and 2 is (256, 380) — the
 * ground a player pushing at the halt has to cross and then leave behind.
 */
export const PUSH: Point = { x: 256, z: 380 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/** Metres searched outward for a legal footprint. Nearest first, integer rings. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** The two guns on each block, as offsets from it. See the header for where they land. */
const GUNS: readonly (readonly Point[])[] = [
  [{ x: 20, z: -10 }, { x: -12, z: 18 }],
  [{ x: -18, z: -12 }, { x: 14, z: 16 }],
];

export default layout({
  id: 'soviets-right-of-entry',
  tags: ['books', 'register', 'counterpart', 'screen', 'lane', 'press', 'last'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which `startPointsFor` puts at the map centre on every continent. If that
     * ever stops being true this file is dressing ground the trigger table is
     * not naming — and it would be invisible, because every tag would still land
     * and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] soviets-right-of-entry built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the halt is authored in absolute coordinates and will not `
        + 'line up with the openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);

    /*
     * SLOT ORDER, NOT `rotateStarts`. See the header: the seed is a constant for
     * an operation, so the rotation has exactly one value and taking it would
     * make every measured coordinate in this file depend on `startOffset`.
     */
    for (let i = 0; i < spots.length; i++) {
      buildBaseFor(b, c.seat(i), spots[i].x, spots[i].z, {
        facingDeg: wrapDeg(spots[i].facingDeg + 180),
      });
    }

    // `c.seat` is `b.armySlot`, which CREATES a slot rather than returning
    // undefined, so this needs no fallback — and a `?? …` here would be a dead
    // branch that reads as a guard.
    const them: PlayerId = c.seat(1);
    const home = spots[0];

    /* -- placement helper -------------------------------------------------
     * `findClearFootprint` ALONE IS NOT ENOUGH and the build says so out loud.
     * It asks `footprintClear` (is anything already there) and `connectedGround`
     * (can an army reach it) and NOTHING about slope, so `spawnBuilding` will
     * plant a structure on a grade `isBuildable` refuses and report success —
     * the split `footprintBuildable`'s own header draws. `urban` is the FLATTEST
     * preset in `MAP_PRESETS` (relief 0.14 / cliffs 0.10), which is why both
     * blocks are found at ring zero; the search is the check that says so.
     */
    const scratch = new Float32Array(2);
    const place = (key: string, p: Point): Point => {
      const f = b.footprintOf(key);
      for (const r of PLACE_RINGS) {
        for (const [ox, oz] of r === 0 ? ORIGIN_ONLY : PLACE_BEARINGS) {
          const px = p.x + ox * r;
          const pz = p.z + oz * r;
          if (b.footprintBuildable(px, pz, f.w, f.h) && b.footprintClear(px, pz, f.w, f.h)) {
            return { x: px, z: pz };
          }
        }
      }
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    /* -- the two record blocks -------------------------------------------
     * ON SEAT 1, WHICH IS WHAT MAKES THE ENGINEER LADDER EXIST AT ALL —
     * `Capture.ts` rule 1 would flip a Gaia block at any health and the
     * operation would be two right-clicks. See the header.
     *
     * `civApartments` carries no `unlockedBy`, so this operation's allow-list
     * cannot refuse it and `tests/campaign-roster-ground.spec.ts` will not
     * report it either way. What that roster DOES withhold is measured in the
     * operation file.
     */
    const nominals: readonly Point[] = [REGISTER, COUNTERPART];
    const names: readonly string[] = ['register', 'counterpart'];
    for (let k = 0; k < nominals.length; k++) {
      const at = place('civApartments', nominals[k]);
      const id: EntityId = b.spawnBuilding('civApartments', them, at.x, at.z, { yawDeg: 20 });
      c.tag('books', id);
      c.tag(names[k], id);
      if (id !== NONE) b.block(at.x, at.z, 14);
      for (const g of GUNS[k]) {
        const gun = place('pillbox', { x: at.x + g.x, z: at.z + g.z });
        const gid = b.spawnBuilding('pillbox', them, gun.x, gun.z, { yawDeg: 200 });
        if (gid !== NONE) b.block(gun.x, gun.z, 8);
      }
    }

    /* -- economy and dressing --------------------------------------------
     * `addStartOre` lays one home field per opening plus one contested patch on
     * the midpoint of the two, which for slots 0 and 2 is (256, 380) — the point
     * `PUSH` names. No `addCivilians`; see the header, where the reason is
     * stronger than the usual one.
     */
    addStartOre(b, spots, b.sea);

    // The opening frame: the yard with the lane behind it. Biased 13% toward
    // the centre, the same bias `allies-sounding-line` uses, so the first thing
    // on screen is the direction the operation goes.
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
