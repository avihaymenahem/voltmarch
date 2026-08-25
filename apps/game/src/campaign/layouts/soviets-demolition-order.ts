/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-demolition-order.ts
 * ============================================================================
 * S6 — THE GROUND. One Allied forecast works pushed out onto the seam, in
 * three buildings, with a civilian infirmary parked 40 m from the middle of it.
 *
 * ============================================================================
 * THE WORKS IS THREE BUILDINGS BECAUSE THE WARHEAD IS ONE
 * ============================================================================
 * `SUPERWEAPONS[SuperweaponId.Nuke]` is `radius: 26` and `Damage.applySplash`
 * accepts a victim at `sqrt(planar) - hitRadius(victim) < radius` — a SURFACE
 * distance, not a centre distance. So the question "can one warhead take two of
 * these" is arithmetic over measured coordinates, and this layout is authored to
 * make the answer no.
 *
 * Every figure below is read off a headless build with the def tables BOUND
 * (`buildScenario(..., { defs })`) and `setCampaignRoster` INSTALLED, which is
 * the only state in which this operation's allow-list is actually in force —
 * unbound it reads 28 / 31 buildings and is measuring a different game.
 *
 * **BOTH HALVES ARE LOAD-BEARING AND NEITHER ALONE DOES ANYTHING.** That is the
 * part a reader would not guess, so it is measured in all four combinations
 * rather than asserted: bound with no roster reads 28 / 31, and UNBOUND WITH THE
 * ROSTER INSTALLED reads 28 / 31 as well — the fallback tables carry no
 * `unlockedBy`, so the allow-list is handed an untagged def and permits it. Only
 * bound-and-rostered reads 25 / 31, and only there does the player's opening lose
 * its coil line.
 *
 *     DEVICE      weatherControl   (170, 254)   1000 hp   hitRadius 8.485
 *     STACK_NEAR  powerPlant       (120, 224)    800 hp   hitRadius 5.657
 *     STACK_FAR   powerPlant       (220, 284)    800 hp   hitRadius 5.657
 *     INFIRMARY   civHospital      (130, 256)   1100 hp   hitRadius 7.211  (Gaia)
 *
 *     DEVICE -> STACK_NEAR  58.31 m     DEVICE -> STACK_FAR  58.31 m
 *     STACK_NEAR -> STACK_FAR       116.62 m
 *
 * **THE SURFACE SEPARATION IS NOT ONE NUMBER, AND THIS BLOCK QUOTED IT AS ONE.**
 * It read "a warhead centred on any one of the three reaches the next at 52.65 m
 * of surface — more than double", which is true of the DEVICE and false of both
 * plants. The surface test subtracts the VICTIM's `hitRadius` and the three do
 * not share one, so the figure depends on which end you click. Measured on the
 * built world through the real arithmetic:
 *
 *     click DEVICE       -> either plant        52.65 m   (58.31 - 5.657)
 *     click either plant -> DEVICE              49.82 m   (58.31 - 8.485)
 *     click either plant -> the other plant    110.96 m
 *
 * So the tightest surface separation anywhere on the works is **49.82 m against
 * a 26 m radius — 1.92x, not "more than double"** — and the conclusion is
 * untouched, because 1.92x is still nowhere near one blast. The primary
 * therefore costs at least two of something whatever the player spends, and the
 * silo's `chargeSeconds` is 420, so it costs at least two of something inside an
 * eighteen-minute deadline.
 *
 * **THE THREE ARE NOT AUTHORED ON A LINE.** They sit at 132.42 m, 90.20 m and
 * 183.67 m from the Ninth's Construction Yard and at 264.97 m, 323.25 m and
 * 206.71 m from the player's — measured to the YARDS, not to the start spots,
 * which are two different points (the yards land at (402, 382) and (114, 134),
 * 380.06 m apart, while the spots the layout is handed are (404, 380) and
 * (108, 132), 386.16 m apart). So the near plant is a raid into their ground,
 * the far plant is out on the seam where the player can reach it early, and the device is
 * between them behind its own guns. Three targets, three different prices.
 *
 * ============================================================================
 * THE INFIRMARY IS 38.21 m FROM THE DEVICE AND THAT NUMBER IS THE OPERATION
 * ============================================================================
 * `civHospital` is Gaia-owned, 1100 hp, and its 3x2 footprint gives it
 * `hitRadius` **7.211**. A blast reaches it when the click lands within
 * `26 + 7.211 = 33.211 m` of its centre. Measured on the built world:
 *
 *     click on DEVICE      -> infirmary surface 31.00 m   CLEAR, aim margin 5.00 m
 *     click on STACK_NEAR  -> infirmary surface 28.84 m   CLEAR, aim margin 2.84 m
 *     click on STACK_FAR   -> infirmary surface 84.55 m   CLEAR, aim margin 58.55 m
 *
 * So a warhead put on the device spares the infirmary by **5.00 m of aiming
 * margin**, and a warhead put on the NEAR PLANT clears it by **2.84 m** — which
 * is still not a margin so much as an accident of where the block landed.
 *
 * **THE INFIRMARY IS AT (132, 258), NOT AT ITS AUTHORED (130, 256).**
 * `civHospital` is a 3x2 footprint at a yaw that quantises to 90, and
 * `ScenarioBuilder.spawnBuilding` snaps on the FACED footprint, so a non-square
 * block at that yaw snaps on the swapped lattice and moves 2.83 m. That is
 * where the 32.84 / 26.32 / 87.04 this block used to quote went, and with them
 * the 0.32 m near-plant margin that the drift table below was keyed to.
 *
 * **WHAT THAT COINCIDENCE COSTS IS A FIFTH OF THE BUILDING, NOT THE BUILDING,
 * AND THIS BLOCK SAID OTHERWISE.** It read "a click one metre long on that plant
 * puts an 1100-hp civilian block inside a 1400-damage blast", which is true
 * about the DISC and wrong about the damage — 1400 is the epicentre figure and
 * the EDGE of the disc delivers `SUPERWEAPON_FX.nukeSplashFalloff`, which is
 * 0.22. Through `applyOne`'s own terms (`ARMOR_MATRIX[HighExplosive][Concrete]`
 * 1.00, `COMBAT_DAMAGE.globalMul` 0.80, and no friendly-fire halving because
 * `detonateNuke` pushes its record with `attacker: NONE` and `applySplash` skips
 * that branch at `attackerPlayer < 0`) the rim is `1400 x 0.22 x 0.80 = 246`.
 * Drifting the near-plant click straight at the infirmary, measured:
 *
 *     drift  2.84 m   surface 26.00    246 dmg   22.4% of 1100
 *     drift  3.50 m   surface 25.34    249 dmg   22.6%
 *     drift 10.00 m   surface 18.84    357 dmg   32.5%   (plant still dies)
 *     drift 28.84 m   surface  0.00   1120 dmg   DEAD    (plant survives on 529/800)
 *
 * So the 2.84 m is the threshold at which the hospital starts paying, not the
 * threshold at which it falls: LOSING the secondary to the warhead needs the
 * click essentially centred on the hospital, 28.47 m off the plant, by which
 * point the plant is not dying either — it takes 271 of its 800. The argument
 * for not spending the warhead on a 300-credit power plant survives and is
 * worth restating in the form the
 * arithmetic actually supports — you will hurt a civilian block for nothing,
 * not level one — because "stated in centimetres rather than in prose" is only
 * an improvement while the centimetres are what they claim to be.
 *
 * **IT IS NOT CLAIMED THAT THE WARHEAD IS THE ONLY THREAT TO IT.** The
 * infirmary sits between the device and the near plant, which is where the
 * ground fight goes; garrisoning it (`GarrisonService.enter` allows an allied
 * owner and Gaia is allied to everybody) puts it under fire deliberately. The
 * secondary is a restraint objective in the shape `soviets.01.first-tap` used
 * for the town's derricks, and this is the chapter picking that thread back up.
 *
 * ============================================================================
 * THE TWO PLANTS ARE THE NINTH'S DEFENCE BUDGET, AND THAT IS MEASURED
 * ============================================================================
 * `powerPlant` makes +100 each. On the built world the Ninth's grid reads
 * **produced 600 / consumed 480**, nothing shed, `defencesOnline` true. Kill
 * both plants and `PowerGrid.recompute` reads **400 / 480, deficit 80,
 * shedCount 2, shedDraw 100, `defencesOnline` false** — and the two structures
 * that go dark are exactly the two Refractor Towers, one in their base at
 * (114, 150) and **one standing on the works itself at (198, 258), 28.28 m from
 * the device**.
 *
 * **THE DEVICE DOES NOT GO DARK AND THIS FILE WILL NOT PRETEND IT DOES.**
 * `shedPriority` returns `POWER_SHED_ORDER.defence` (0) for anything carrying
 * `EntityFlag.CanAttack` and `POWER_SHED_ORDER.tech` (2) for a superweapon, and
 * the walk stops as soon as `covered >= deficit`. Two towers at −50 cover 100
 * against a deficit of 80, so the shed list never reaches the radar, let alone
 * the −150 device. Taking the plants buys the player a dark tower over the
 * objective, not a stopped clock, and the operation's hidden secondary is
 * written for what actually happens.
 *
 * All five of the Ninth's pillboxes — three in their base, two on the works —
 * are `power: 0` and keep firing through any deficit, which is the same fact
 * CLAUDE.md records about `pillbox`, `sentryGun` and `rclSpitpost` under the
 * blackout rules. Taking the plants opens the works, it does not disarm it.
 *
 * ============================================================================
 * THE PLAYER'S OPENING IS SHORT A COIL LINE AND THAT IS WHERE THE SILO'S
 * POWER COMES FROM
 * ============================================================================
 * `roster.player` withholds `struct.defence.specialist`, so `spawnBuilding`
 * refuses the three `teslaCoil`s `SovietBase.ts` would otherwise put on the
 * line. Measured, the player opens at **produced 600 / consumed 270 — +330 of
 * headroom** against `SovietBase.ts`'s own documented +105 for the full layout.
 * The difference is 225, which is exactly 3 x 75, and a `nuclearSilo` draws
 * **−150**. The coil line's power IS the silo's power, with 180 to spare, and
 * the player builds no extra reactor to arm one.
 *
 *     seat 0  the player   25 buildings   13 units   +330 net power
 *     seat 1  the Ninth    31 buildings   12 units   +120 net power
 *     Gaia                  1 building     0 units   <- the infirmary
 *
 * Six of the Ninth's thirty-one are this file's (device, two plants, two
 * pillboxes, one Refractor Tower), so base for base the opening is **25 against
 * 25**. The asymmetry this operation ships is the BUTTON and the coil line, not
 * the size of the opening.
 *
 * ============================================================================
 * WHERE THE COLUMNS FORM, MEASURED THE WAY `spawnUnits` ACTUALLY PLACES
 * ============================================================================
 * `EffectSink.spawnUnits` lays a DETERMINISTIC RING: unit `i` of `count` at
 * `angle = i / count * 2pi`, radius `spread`, written verbatim by
 * `ProductionService.spawnUnit` with no egress search. Every authored ring point
 * of every wave in `06-demolition-order.ts` was checked against that wave's own
 * move class on the built world and **all of them are passable** — and the
 * clear radius below is a second, stronger reading (every 2 m sample within it
 * is passable to Foot AND Track), so the counts may be retuned without
 * re-measuring as long as the spread stays inside it:
 *
 *     ROAD_A   (150, 188)   clearR 26   64.90 m from the Ninth's yard,  68.96 m from the device
 *     ROAD_B   ( 52, 110)   clearR 30   66.48 m from the Ninth's yard, 186.17 m from the device
 *     MUSTER   (326, 336)   clearR 28   88.84 m from the player's yard
 *
 * Both Allied points sit past `BUILD_RADIUS` (56) from their yard: a column that
 * has formed up and is about to leave, which is a schedule the opponent gets
 * stronger on rather than an army materialising inside a defender's formation.
 * **THE ORDER IS A HEADING, NOT A LEASH** — `AiBrain.regroupSquads` files every
 * untagged hull the seat owns into a squad on its next pass, so the attack-move
 * is the first thing these hulls do and the brain owns them afterwards. What
 * the waves buy is the district being stronger at 4:00, 10:00 and 14:00 than it
 * could have built itself. `soviets-short-allocation` states the same rule and
 * `soviets-company-town` measured it: two parked hulls were 116-129 m away
 * inside twenty seconds.
 *
 * The first ROAD_B draft was at the map's west edge and the first ROAD_A was at
 * (160, 176), where two ring points of four waves landed on rock. **The spawn
 * POINT was moved; the spread was not tuned** — `tests/campaign-spawn-ground.spec.ts`
 * is the gate and `types.ts` says why in capitals.
 *
 * ============================================================================
 * NO TRIGONOMETRY IN THE PLACEMENT
 * ============================================================================
 * Every authored point is an integer literal and the search rings are integer
 * offsets. ECMA-262 pins `+ - * /` and `Math.sqrt` and pins neither `sin` nor
 * `cos`; a layout runs independently on both machines of a lockstep match, so a
 * table rotated by trig is a tick-zero desync waiting for two engines to
 * disagree in the last mantissa bit. `rotateStarts` is not called either, for
 * `reclamation-held-paper`'s reason: an operation pins its seed, so the rotation
 * is a moving part with exactly one value.
 *
 * **THE FOUR POINTS ARE AUTHORED WHERE THEY LAND, NOT WHERE THEY WERE AIMED.**
 * `place` returning a point is not the same as a structure standing on it —
 * `spawnBuilding` snaps the result to the footprint grid a SECOND time, and the
 * first draft of this file (168, 254) / (120, 222) / (218, 282) / (130, 254)
 * came back displaced on all four, by 2.00, 2.00, 2.83 and 2.00 m. The literals
 * below are the built world's own coordinates, which makes the ring search a
 * CHECK rather than a mechanism: it finds all four at ring zero today and would
 * report if the ground under one ever moved.
 *
 * `simSeed` **6614** draws the start pair **[2, 3]** for a two-army match — the
 * diagonal `soviets-short-allocation` does not use — and `mapSeed` **20260918**
 * was chosen over nine others on a measured sweep of the lane corridor.
 *
 * **THE TWO HEADLINE FIGURES ARE RESTATED WITH THEIR DEFINITION, BECAUSE THE
 * FIRST VERSION CARRIED NEITHER AND DOES NOT REPRODUCE.** It read "92.3% of a
 * 80 m-wide lane corridor open to a tracked hull, against 78.6-91.4% for the
 * rest, and 75.2% of the whole map track-passable". Re-measured on the bare
 * heightfield at this seed, counting 4 m cells through the real
 * `Terrain.isPassable(Locomotor.Track)`: the whole map is **12473 of 16384 =
 * 76.13%** (identical for Foot and Wheel; Hover reads 77.86%), and the corridor
 * within 40 m of the segment joining the two start SPOTS is **1812 of 1930 =
 * 93.89%**. Ten readings of "80 m-wide corridor" were tried — spots or yards as
 * endpoints, +/-40 m or +/-80 m, cell-centre or world-space sampling at 1 / 2 /
 * 4 / 8 m — and they span 90.29% to 93.96%; none of them lands on 92.3%. The
 * comparison band for the other nine cannot be checked in either direction,
 * because this file never named the nine. **Change either seed and every
 * distance in this file is a different distance.**
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `works`     — the device AND both plants, three entities on seat 1. The
 *               primary is `ownerCount(1, 'building', 'works', max: 0)`, so a
 *               plant CAPTURED by an engineer counts as removed exactly as one
 *               levelled does. That is deliberate and the objective title says
 *               "off the seam" rather than "destroy".
 * `stack`     — the two plants alone, so the hidden secondary can name them
 *               without naming the device.
 * `device`    — the `weatherControl` alone, so `entityAlive` can ask whether
 *               the emitter is still standing while the feed comes down.
 * `infirmary` — the Gaia `civHospital`. Gaia is exempt from
 *               `campaign-maps.spec.ts`'s "a tag an entity condition reads on
 *               an AI seat must be a building" rule, and it is a building
 *               anyway.
 * `waveA` / `waveB` / `waveC` / `column` — produced by `spawnUnits` in the
 *               trigger table, never by this file, and declared anyway so a
 *               reader asking where the pressure comes from finds the answer in
 *               the file that owns the ground.
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
 * `operations/soviets/06-demolition-order.ts` imports them; the dependency runs
 * operation -> layout and never back. A number written in two files is a number
 * that will disagree the first time either is tuned, and the failure — a reveal
 * that frames empty ground, a column that lands somewhere nobody authored — is
 * invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/** The Weather Control Device. 134.16 m from the Ninth's yard. */
export const DEVICE: Point = { x: 170, z: 254 };
/** The plant on the spur back toward their base. 90.55 m from their yard. */
export const STACK_NEAR: Point = { x: 120, z: 224 };
/** The plant out on the seam. 204.84 m from the player's yard — the reachable one. */
export const STACK_FAR: Point = { x: 220, z: 284 };
/** The district infirmary. Gaia, 1100 hp, 40.05 m from the device. */
const INFIRMARY: Point = { x: 130, z: 256 };

/**
 * The opening reveal: the device and its three guns, and NOT the plants.
 *
 * r = 46 covers the furthest gun (the Refractor Tower, 28.28 m) and stops
 * **12.31 m short** of either plant at 58.31 m. `revealArea` is
 * `Vision.exploreCircle`, which is PERMANENT, so a disc that already covered
 * the plants would make `t.disclose`'s reveal a no-op wearing the costume of a
 * beat — the mistake `soviets-short-allocation` records avoiding for its third
 * wave.
 */
export const WORKS_AREA: Area = { x: DEVICE.x, z: DEVICE.z, r: 46 };
/** The two plants, revealed when the hidden secondary is disclosed. */
export const STACK_NEAR_AREA: Area = { x: STACK_NEAR.x, z: STACK_NEAR.z, r: 34 };
export const STACK_FAR_AREA: Area = { x: STACK_FAR.x, z: STACK_FAR.z, r: 34 };

/** The spur road. 64.90 m from the Ninth's yard, 68.96 m from the device. */
export const ROAD_A: Point = { x: 150, z: 188 };
/** Their own rear. 66.48 m from the yard, on the far side from the works. */
export const ROAD_B: Point = { x: 52, z: 110 };
/** Where the yards put the player's one column down. 88.84 m from their yard. */
export const MUSTER: Point = { x: 326, z: 336 };
/**
 * The heading the middle wave takes: the contested patch `addStartOre` lays on
 * the midpoint of the two openings, which is the ground the player has to cross
 * to reach the works at all.
 */
export const PUSH: Point = { x: 256, z: 256 };

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

/**
 * The guns on the works, as offsets from the device, and they are STRUCTURES
 * for the reason every other campaign guard is: `AiBrain.regroupSquads` files
 * every untagged hull the seat owns into a squad on its next pass, and an
 * emplacement cannot be re-filed. Measured where they land:
 *
 *     pillbox     (186, 246)   17.89 m from the device   range 22, power 0
 *     pillbox     (178, 270)   17.89 m                   range 22, power 0
 *     prismTower  (198, 258)   28.28 m                   range 34, power −50
 *
 * The Refractor Tower is the longest-reaching structure weapon either army can
 * field under this roster, and it is the one that goes dark when the plants do.
 * The two pillboxes draw nothing and do not.
 */
const WORKS_GUNS: readonly { readonly key: string; readonly x: number; readonly z: number }[] = [
  { key: 'pillbox', x: 16, z: -8 },
  { key: 'pillbox', x: 8, z: 16 },
  { key: 'prismTower', x: 28, z: 4 },
];

export default layout({
  id: 'soviets-demolition-order',
  tags: ['works', 'stack', 'device', 'infirmary', 'waveA', 'waveB', 'waveC', 'column'],

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
        `[campaign] soviets-demolition-order built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the works is authored in absolute coordinates and will not `
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
     * the split `footprintBuildable`'s own header draws. `snow` carries the
     * HIGHEST `relief` in `MAP_PRESETS` at 0.50 on `cliffs` 0.40 — not the
     * steepest overall, since `arid` is `cliffs` 0.55 — which is why both
     * questions are asked and the shipped search is only the fallback.
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

    /* -- the device -------------------------------------------------------
     * ON SEAT 1, WHICH IS WHAT MAKES IT A LIVE SUPERWEAPON RATHER THAN A PROP.
     * `SuperweaponService.rescanAvailability` skips a structure whose owner's
     * faction is `Faction.Neutral`, so a Gaia-owned device would never charge
     * and this operation's whole premise would be scenery. It also skips
     * anything not `EntityFlag.Powered` — see the header on why the Ninth's
     * grid is authored positive at t=0.
     *
     * `weatherControl` carries `struct.superweapon.siege`, so the operation's
     * `roster.ai` MUST name it or `spawnBuilding` returns NONE, the `works` and
     * `device` tags land on two entities instead of three, and
     * `ownerCount(max: 0)` becomes an objective the player finishes without ever
     * touching the device. (This said "cannot finish", which is backwards: two
     * tagged entities instead of three make the primary EASIER, not impossible.)
     *
     * **THE MECHANISM IS MEASURED, AND IT IS GATED NOW.** Built headless with
     * the roster installed and the id removed from `roster.ai`,
     * `weatherControl` really does come back 0, `works` drops to two and
     * `device` lands on nothing.
     *
     * `campaign-maps.spec.ts` STILL CANNOT SEE THAT, and the reason is worth
     * keeping: its `buildOperation` installs the plan and the layout and
     * nothing else — no `setCampaignRoster`, and no `defs` either, so
     * `spawnBuilding` hands `isBuildable` an `undefined` def that no roster can
     * refuse. Both halves have to be present or the allow-list is inert. What
     * that file really checks in both directions is the TAG DECLARATION
     * (declared -> landed, and trigger-named -> declared), which would catch
     * this only once the build had actually dropped the device.
     *
     * `tests/campaign-roster-ground.spec.ts` is the gate that closes it: every
     * operation, bound tables, its own roster installed, plus an unrostered
     * CONTROL build so the failure names the def key and the missing roster id
     * rather than saying "tag missing". Deleting `struct.superweapon.siege`
     * from `roster.ai` fails three of its cases by name.
     */
    {
      const at = place('weatherControl', DEVICE);
      const id: EntityId = b.spawnBuilding('weatherControl', them, at.x, at.z, { yawDeg: 230 });
      c.tag('works', id);
      c.tag('device', id);
      if (id !== NONE) b.block(at.x, at.z, 18);
      for (const g of WORKS_GUNS) {
        const gun = place(g.key, { x: at.x + g.x, z: at.z + g.z });
        const gid = b.spawnBuilding(g.key, them, gun.x, gun.z, { yawDeg: 50 });
        if (gid !== NONE) b.block(gun.x, gun.z, 8);
      }
    }

    /* -- the two plants ---------------------------------------------------
     * ORDINARY `powerPlant`s, +100 each, and the objective calls them what they
     * are. They are part of `works` — the primary counts all three — and part of
     * `stack` on their own, which is how the hidden secondary names the feed
     * without naming the emitter.
     */
    for (const nominal of [STACK_NEAR, STACK_FAR]) {
      const at = place('powerPlant', nominal);
      const id: EntityId = b.spawnBuilding('powerPlant', them, at.x, at.z, { yawDeg: 230 });
      c.tag('works', id);
      c.tag('stack', id);
      if (id !== NONE) b.block(at.x, at.z, 12);
    }

    /* -- the infirmary ----------------------------------------------------
     * Gaia, so both armies are allied to it and neither has to shoot it to use
     * it. A squad inside holds it while it stands there and hands it back the
     * moment the last man leaves — see `src/data/Civilians.ts` — so it is a
     * firing position rather than a possession, and putting one inside it is the
     * player's own decision to put the thing they are protecting under fire.
     *
     * **AN ENGINEER IS NOT THE SAME BARGAIN, AND THIS BLOCK USED TO IMPLY IT
     * WAS.** "Hands it back the moment the last man leaves" is true of a
     * garrison and false of a capture: `CaptureService` writes `owner` and
     * `faction` once and nothing ever writes them back, so one click strips
     * Gaia's universal alliance permanently and leaves the shown secondary's
     * subject standing 40.05 m from the device as a legal Allied target. The
     * operation declares `captureProof: ['infirmary']` for that reason; the
     * argument is next to the field in `operations/soviets/06-demolition-order.ts`.
     */
    {
      const at = place('civHospital', INFIRMARY);
      const id = b.spawnBuilding('civHospital', b.gaia, at.x, at.z, { yawDeg: 50 });
      c.tag('infirmary', id);
      if (id !== NONE) b.block(at.x, at.z, 12);
    }

    /* -- economy and dressing ---------------------------------------------
     * `addStartOre` lays one home field per opening plus one contested patch on
     * the midpoint of the two, which for slots 2 and 3 is the map centre
     * (256, 256) exactly — the point `PUSH` names, and the ground a player has
     * to cross to reach the works.
     *
     * NO `addCivilians`: it hangs capturable `civOilDerrick`s off the bisector
     * and walks a `civOreMine` out from the midpoint, which is a second set of
     * neutral silhouettes competing with the one civilian building this
     * operation's secondary is about. `soviets-company-town`,
     * `soviets-short-allocation` and `allies-sounding-line` skip it for the same
     * reason.
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
