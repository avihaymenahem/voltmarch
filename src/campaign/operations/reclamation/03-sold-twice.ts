/**
 * ============================================================================
 * R3 — SOLD TWICE
 * ============================================================================
 * Survey 26-511 is a salt pan with six Works taps standing on it, capped since
 * the Split and written down as recovered plant. Cregg sold the pan to Allied
 * Depot Four on the Tuesday and to Allied Depot Nine on the Thursday. Both
 * invoices say "all standing plant". Both were paid. Both collections are
 * scheduled for this week, and neither depot will raise a shortfall against the
 * other, because the schedule does not have a line for one.
 *
 * A delivery is logged against whoever holds the deed when the collection
 * party arrives. So the order is not to defend the pan. It is to be the
 * registered holder at BOTH ENDS OF IT AT ONCE, for as long as the notes take
 * to cut, and to let two offices of one administration go home each believing
 * they took delivery.
 *
 * ============================================================================
 * THREE SEATS, AND WHAT THAT CAN AND CANNOT DELIVER — READ THIS FIRST
 * ============================================================================
 * `Shell.startOperation` fills `opponents` with `op.map.armies - 1` entries and
 * takes EVERY one of them from `op.foe`, which is a single `Faction`;
 * `applySetupToWorld` then seats through `effectiveOpponents`, which re-asserts
 * the singular `aiFaction` onto entry 0. **So both hostile seats are the same
 * army. There is no second enemy faction and there cannot be one without a
 * schema change.** `soviets.04.company-town` is the other three-seat operation
 * and it reports exactly this.
 *
 * **THE PREMISE IS BUILT ON THAT CONSTRAINT RATHER THAN AROUND IT, AND HERE IS
 * THE PLAIN VERSION.** "Playing two buyers off each other" cannot mean two
 * ARMIES here. It means two OFFICES OF ONE ARMY, and the fiction has to make
 * that the point instead of a compromise: Depot Four and Depot Nine are both
 * Allied materiel depots on the same timetable, they hold two invoices for one
 * lot, and the reason nobody has caught it is that they report upward and never
 * sideways. That is a statement about a filing system, and a filing system is
 * exactly the kind of enemy the Reclamation has.
 *
 * What the seating DOES deliver, mechanically and checkably:
 *
 *   - **The two depots are hostile to each other as well as to the player.**
 *     `PlayerState.allyMask` defaults to self-only, nothing in the campaign
 *     path allies two opponent seats, and `Shell.applySetupToWorld` says of
 *     itself that a free-for-all needs no code. So this is a three-way.
 *   - **Two independent schedules.** Two brains, two bases, two collection
 *     columns keyed to different minutes, arriving at different ends of one
 *     pan. That is a two-front problem the player genuinely cannot answer with
 *     one army, and it needs no faction difference to be true.
 *
 * **WHAT IS NOT CLAIMED, AND NO LINE OF DIALOGUE CLAIMS IT.** That the two
 * depots fight each other, or spend more on each other than on the player.
 * Mutual hostility is structural and measurable; how two `AiBrain`s divide
 * their attention is neither, it has not been observed here, and CLAUDE.md's
 * standing warning about reading behaviour off a symmetric setup applies.
 * Cregg says they do not talk to each other, which is true of the ally mask and
 * of the fiction. He does not promise they will shoot each other.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS: WHICH END YOU CAN AFFORD TO BE WRONG ABOUT
 * ============================================================================
 * The primary is a CONJUNCTION ACROSS TWO PLACES, which is what makes it a
 * different capture-hold from the one already authored. `soviets.04` is one
 * ring of five with a threshold of three — a question about how many. This is
 * `ownerCount(lotFour) >= 2` AND `ownerCount(lotNine) >= 2` AND
 * `elapsedSinceArmed`, and the question is WHERE. Holding four taps at one end
 * is worth nothing. Holding two at each end is the operation.
 *
 * And the two ends are not the same price, by arithmetic rather than by
 * authoring. The three slots sit at `(±148, ±124)` from the map centre, so
 * Depot Four (404, 132) and Depot Nine (404, 380) are exact reflections of each
 * other in z about the line z = 256 — and **the player's opening (108, 380) is
 * on Depot Nine's side of that mirror, at the same z.** Every distance below
 * falls out of that and out of nothing else:
 *
 *     end of the pan          its own depot   the player   the other depot
 *     Four's  (258, 194)        158.62 m       238.95 m       236.46 m
 *     Nine's  (258, 318)        158.62 m       162.31 m       236.46 m
 *
 * So the south end is a fair fight — **162.31 m from your yard against 158.62 m
 * from the depot that bought it, a difference of 3.69 m** — and the north end
 * is not: you are **80.33 m further out than Depot Four is**. Both ends are
 * 236.46 m from the depot that did not buy them, which is why neither depot's
 * army is ever in two places at once and yours has to be.
 *
 * **AND THE SAME THING MEASURED OFF THE STRUCTURES RATHER THAN THE CENTRES**,
 * which is the reading that decides engagements. Every one of the six taps, on
 * the built world, against the two openings that could contest it:
 *
 *     Four's end   (284, 196)   depot 136.00 m   player 254.62 m
 *                  (244, 216)   depot 180.71 m   player 213.05 m
 *                  (244, 172)   depot 164.92 m   player 248.52 m
 *
 *     Nine's end   (284, 320)   depot 134.16 m   player 185.95 m
 *                  (244, 328)   depot 168.24 m   player 145.60 m
 *                  (244, 296)   depot 180.71 m   player 159.85 m
 *
 * **EVERY TAP AT FOUR'S END IS NEARER DEPOT FOUR THAN IT IS TO YOU. TWO OF THE
 * THREE AT NINE'S END ARE NEARER YOU.** That is the whole operation in six
 * numbers, and it is a property of where the three shelves sit rather than of
 * anything the layout chose.
 *
 * The fork the player actually faces:
 *
 *   - **South first.** 80.56 m of walk from the nearer staged Tinker to the
 *     closest tap and a second one 32.00 m past it — two deeds inside 32.2 s of
 *     movement, on the two caps that are nearer your yard than Depot Nine's. It
 *     also arms nothing on its own: the clock does not start until the north
 *     end is holding too.
 *   - **North first.** 148.14 m to the closest tap at Four's end, into ground
 *     where all three caps are nearer the depot than they are to you and where
 *     a lost one is 213 m from a replacement. Doing it first means doing it
 *     while both depots are still building.
 *   - **Or spend the shortfall.** THE CREW IS THREE AND THE PRIMARY NEEDS FOUR
 *     DEEDS. The layout stages two Tinkers and `buildAlliedBase`'s garrison
 *     hands over one more — the built world reports `rclTinker` x3 on seat 0 —
 *     and a fourth is 500 credits and ten seconds out of the Rookery the
 *     opening base already has, plus the walk. Against an opening bank of 4000
 *     that is 12.5% of everything you have, before a single hull.
 *
 * ============================================================================
 * WHY A DEED AND NOT A DISC, AND WHY THE POSTS ARE HERE AT ALL
 * ============================================================================
 * `ownerCount` over a tag, never `unitsInArea`. The question is who the pan
 * pays, not who is standing on it — a disc would let a player hold it with five
 * harvesters (there is no role filter on `unitsInArea`, which
 * `soviets-deep-sector` had to move an ore field to avoid) and would let them
 * lose it by walking out of ground they still own.
 *
 * **THE HOLD RESTARTS, AND ON A CONJUNCTION THAT BITES TWICE AS OFTEN.**
 * `elapsedSinceArmed` disarms the instant EITHER end drops to one tap, so a
 * single tap lost at Four's end at minute nine of a five-minute hold puts the
 * clock back to zero even with all three of Nine's still turning. Cregg says
 * so on the tick the hold first arms: a rule the player can only learn by
 * losing it is a rule badly told.
 *
 * **THE RECEIVING POSTS ARE `soviets.04`'s ARGUMENT INVERTED, DELIBERATELY.**
 * That operation puts nothing on its town and says why at length: two districts
 * both FILED for it and neither MOVED IN, so a concrete gun would assert the
 * opposite of the premise. Here both depots PAID. Each has a man on the end it
 * thinks it bought, so each end carries one `pillbox`-role emplacement owned by
 * that depot, 119.23 m from the yard that posted it — an exact mirror, because
 * the two lots and the two depots are.
 *
 * **EACH POST COVERS EXACTLY ONE CAP, AND THE READING THAT DECIDES THAT IS
 * SURFACE DISTANCE, NOT CENTRE DISTANCE.** `Combat.engage` gates firing on
 * `max(0, flat - hitRadius(target))`, and a tap is a 2x2 footprint, so its
 * `hitRadius` is the half-diagonal `hypot(4, 4)` = **5.66 m**. `pillboxMg`'s
 * 22 m range therefore reaches a tap whose CENTRE is within **27.66 m**.
 * Measured on the built world:
 *
 *     post          nearest tap                second nearest
 *     Four (294,178)   20.59 m -> 14.93 surf     50.36 m -> 44.70 surf
 *     Nine (294,334)   17.20 m -> 11.55 surf     50.36 m -> 44.70 surf
 *
 * So each post is inside its cap by 7 m of surface reach and outside the next
 * one by 23, and neither reaches across the pan at all. **This block used to
 * compare 20.59 and 17.20 directly against 22**, which happened to give the
 * right answer for the wrong reason and would have hidden a post sitting
 * between 22 and 27.66 m out. It is also how the first desert build was read as
 * "post Four is 8 m past its reach" when it was in fact 2.4 m past.
 *
 * An emplacement rather than a hull because `AiBrain.census` files every
 * AI-owned mobile hull into `armyIds` and `regroupSquads` marches it off inside
 * four seconds; `campaign-maps.spec.ts` pins that rule and concrete is the only
 * thing a layout can reach that survives it.
 *
 * **NEITHER DEPOT CAN TAKE A TAP, BY EITHER VERB, AND THE REASON IS THE VERB
 * RATHER THAN THE UNIT.** Two things flip a neutral structure — an engineer
 * takes the deed permanently, a squad holds it while it stands inside — and a
 * brain can do neither. Worth stating precisely, because `buildAlliedGarrison`
 * hands each depot ONE engineer at t=0 (the built world reports it), so the
 * shorthand "the AI owns no engineer" is false on this map. What is true is
 * that **`AiBrain` never issues `OrderKind.Capture` at all** — it is on
 * CLAUDE.md's list of verbs with no call site, `buildUnits` filters the
 * weight-0 row so it never buys another, and the only `OrderKind.Enter` in
 * `AI.ts` is the amphibious boarding path on a map with a sea, which this is
 * not. `GarrisonService.enter` also refuses a structure whose owner it is not
 * allied to. What they CAN do is knock one down, and a levelled tap is gone for
 * the match — which is why the layout puts THREE at each end for a primary that
 * asks for two. Each end can absorb one loss. Neither can absorb two.
 *
 * **AND THE VOCABULARY CANNOT EXPRESS "FEWER THAN TWO LEFT STANDING AT THAT
 * END".** `entityAlive` is a threshold-free `> 0`; `ownerCount` names a SEAT,
 * and Gaia is not one — `validateCampaign`'s `checkSeat` refuses any player
 * index outside the three this operation seats. So there is no condition that
 * detects the state in which the primary has become unreachable. That is the
 * frozen vocabulary working rather than a gap to route around, and the answer
 * is the one `soviets-deep-sector` and `soviets-company-town` both take: a hard
 * deadline that ends the match whatever happened to the ground.
 *
 * ============================================================================
 * THE DEADLINE IS EXACTLY `parSec`, AND THE BUDGET IS WRITTEN OUT
 * ============================================================================
 * `t.close` ends the week at minute fifteen, and fifteen minutes is `parSec`
 * 900 to the second. The authored par IS the deadline rather than a description
 * of one, which is the only way that field is falsifiable from inside the
 * operation — `soviets.03` sets the same relationship at 900 and `soviets.04`
 * at 960.
 *
 * The clock, against the ground the layout actually lays. Every distance is
 * read off a built world; every SECOND is arithmetic on top of it at a Tinker's
 * `maxSpeed` 3.5 m/s:
 *
 *     crew -> nearest tap, Nine's end      80.56 m   ->  23.0 s
 *     second deed at Nine's end            32.00 m   ->   9.1 s
 *     crew -> nearest tap, Four's end     148.14 m   ->  42.3 s
 *     second deed at Four's end            44.00 m   ->  12.6 s
 *     four deeds, the longer arm          192.14 m   ->  54.9 s
 *     the visible secondary's bar          240 s     <-  4.4x that
 *     five-minute hold                     armed at t+2:30 wins at t+7:30
 *     slack to the deadline                7.5 min — one full restart of the
 *                                          hold and the walk back to re-arm it
 *
 * So the operation is winnable with the hold lost and retaken once, and is not
 * winnable with it lost twice late. That is the margin the deadline is chosen
 * for. **THE DISTANCES ARE MEASURED AND THE PACING IS NOT** — nothing has
 * played this, 3.5 m/s is a def field rather than an observed rate, and the
 * pathing overhead between "54.9 s of walking" and "the fourth deed lands" is
 * unmeasured in both directions. `CAPTURE.reachMetres` is 2.2 m past the
 * footprint edge and `Capture.ts` steers the man there over several ticks.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because razing two depot bases is not the order, and with
 * three seats it is the rule most likely to fire on somebody else's war:
 * `Shell.pollOutcome` declares victory when every non-allied seat holds zero
 * assets, and one depot finishing the other off is a state this table has no
 * opinion about. `assetLossDefeat` because a broker whose yard is gone while
 * four taps are still paying him 3600 a minute is the most interesting last act
 * this operation has, and `pollOutcome` would end it at 2 Hz instead. The
 * authored loss is `playerBeaten`, which is `Viability.isBeaten` — nothing to
 * build with and nothing to fight with — and that is the honest threshold.
 *
 * ============================================================================
 * THE MEASURED POINTS
 * ============================================================================
 * `LOT_FOUR`, `LOT_NINE`, their reveal discs and both collection roads are
 * IMPORTED from the layout and are absolute. A number written in two files is a
 * number that will disagree the first time either is tuned, and the failure — a
 * reveal that frames empty ground, a column that lands somewhere nobody
 * authored — is invisible to every gate.
 *
 * Built headless at `mapSeed` 26 511 / `simSeed` 4 027 on `biome: 'desert'`,
 * the same build `tests/campaign-maps.spec.ts` performs, with the roster
 * installed and the def tables bound, reading `store.posX/posZ` AFTER
 * `spawnBuilding` snapped each footprint to the placement grid:
 *
 *     Four's end   taps (284, 196) (244, 216) (244, 172)   post (294, 178)
 *     Nine's end   taps (284, 320) (244, 328) (244, 296)   post (294, 334)
 *     crew         (159.5, 341) and (164.5, 341)
 *
 *     seat 0  the player   24 buildings   23 units   power +60
 *     seat 1  Depot Four   24 buildings   14 units   power +230
 *     seat 2  Depot Nine   24 buildings   14 units   power +230
 *     Gaia                  6 buildings    0 units
 *
 * `auditConnectivity` on that build: one passable region holding 12 596 of
 * 12 596 cells (100.0%), 0 placements relocated, 0 entities stranded, 0
 * structures on ground `isBuildable` refuses.
 *
 * **THE MOVE TO DESERT COST FIVE FIGURES IN THIS FILE AND NOTHING ELSE, WHICH
 * IS WHY 26 511 WAS TAKEN RATHER THAN THE NEXT CLEAN ROLL AFTER IT.** Against
 * the temperate ground this operation was authored and measured on, the
 * complete list of what changed is:
 *
 *     the passable cell count      12 224   -> 12 596
 *     Four's third tap          (240, 172)  -> (244, 172)   4/4 buildable now,
 *     …its distances           168.81/246.35 -> 164.92/248.52   so no search
 *     the second deed at Four's end  44.18 m -> 44.00 m
 *     the four-deed longer arm      192.32 m -> 192.14 m
 *
 * The census, the power split, the crew, both posts, both post readings and
 * every other distance the clock is written against are unchanged to the
 * centimetre, and the four-deed walk is still 54.9 s.
 *
 * **`EffectSink.spawnUnits` DOES NOT SNAP TO STANDABLE GROUND**, and it lays a
 * wave on an exact RING of radius `spread` rather than scattering inside one —
 * `ProductionService.spawnUnit` clamps to the map, reads `heightAt` and
 * allocates, and asks nothing. `soviets-common-standard` shipped a reward hull
 * standing on a knoll that way. All four rings the table below uses (20x5 and
 * 14x2 at `ROAD_FOUR`, 22x6 and 15x3 at `ROAD_NINE`) were spawned FOR REAL
 * through `makeEffectSink` on the built world with all three bases standing,
 * and every one of the sixteen hulls is standing on a cell `terrain.isPassable`
 * accepts for BOTH locomotors — Foot for the G.I.s and Track for the Wardens —
 * as are the two road centres and the staging point. **That is what this seed
 * was chosen for**: it is the only roll of the 200 swept that cleared all four
 * rings together with every other property, and 188 of those 200 put at least
 * one hull on a closed cell. On the old 26 450, desert ground put the second
 * Warden of `t.four` at (326, 159), a cell no tracked hull can stand on.
 * **Re-check all four if a count or a spread changes**, and re-measure
 * everything above if `mapSeed`, `simSeed`, the biome or the layout's offsets
 * move. `tests/campaign-spawn-ground.spec.ts` is the standing gate on the
 * rings; everything else here is measured by hand.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';
import {
  LOT_FOUR, LOT_FOUR_AREA, LOT_NINE, LOT_NINE_AREA, ROAD_FOUR, ROAD_NINE,
} from '../../layouts/reclamation-sold-twice';

/**
 * How long the notes take to cut.
 *
 * FIVE MINUTES, AND IT IS A CONJUNCTION RATHER THAN A THRESHOLD, WHICH MAKES IT
 * A DIFFERENT TIMER FROM `soviets.04`'s SIX. That one disarms when one number
 * out of five falls below three. This one disarms when EITHER of two numbers
 * falls below two, so there are two independent ways to lose the clock and the
 * player has to garrison both of them. Five rather than six because the arming
 * walk is longer here — the two ends are 124.0 m apart — and because both
 * collection columns land inside a five-minute hold armed at any sensible
 * moment.
 */
const NOTES = minutes(5);

/**
 * When the first collection party leaves its gate, and therefore when clearing
 * the posts stops being worth anything.
 *
 * ONE CONSTANT FOR TWO JOBS, ON PURPOSE. The visible secondary's window and
 * Depot Four's arrival are the same tick because the objective's own wording is
 * "before the collections arrive" — two numbers that had to agree would
 * disagree the first time either was tuned. 240 s against 54.9 s of measured
 * pure movement is 4.4x, which is deliberate slop rather than generosity: what
 * is NOT measured is the pathing overhead, the formation settle, and how long
 * three Grinders take over two 500 hp emplacements with a depot's yard
 * 119.23 m up the road.
 */
const COLLECTION = minutes(4);

const op: OperationDef = {
  id: 'reclamation.03.sold-twice',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * ALLIES, AND THE PROSE IS WHAT PICKS IT.
   *
   * "Depot Four holds the invoice and so does Depot Nine" names two ALLIED
   * materiel depots on one timetable — the Allied chapter is called *The
   * Timetable* and is about a schedule every refinery on the continent was
   * sited from, which is precisely the kind of system that cannot report a
   * shortfall sideways. `t.four` and `t.nine` both spawn literal Allied
   * `gi`/`grizzly`, which `validateCampaign` checks against the seat's army.
   *
   * It is also the operation that earns `reclamation.04`, whose premise is that
   * the Allies want Tallow's yard. They want it because of this week.
   *
   * `reclamation.02.written-off` names the Soviets and this one does not, which
   * is the chapter working rather than a drift: R2 is a field the Soviets wrote
   * off, R3 is a lot the Allies bought twice, and the Reclamation's whole
   * position is that every faction is a customer.
   */
  foe: Faction.Allies,
  index: 3,
  title: 'Sold Twice',
  beat: 'One lot, two invoices, both paid. Both collections are this week.',
  primaryType: 'capture-hold',
  // BESPOKE. Objectives, spawns, orders, reveals, dialogue and an outcome — the
  // definition in `types.ts` is "multiple effect kinds", and this is six.
  archetype: 'bespoke',
  parSec: 900,
  requires: ['reclamation.02.written-off'],

  map: {
    /*
     * ARID, AND IT CARRIES THE HIGHEST `cliffs` IN THE WHOLE PRESET ROSTER
     * (0.55, against `relief` 0.28). That is why the layout asks
     * `footprintBuildable` AND `footprintClear` on every one of its eight
     * structures rather than trusting `findClearFootprint`, which tests
     * occupancy and connectivity and nothing about grade.
     *
     * **THAT HELPER EARNS ITS KEEP ON THE SHIPPED ROLL, MEASURED.** Nine's
     * second tap is authored at (244, 340) and that footprint is **0 of 4
     * cells buildable** — a grade, not an obstruction, so `findClearFootprint`
     * would have planted it there and reported success. `place` walks it to
     * (244, 328) instead. See the layout header.
     */
    preset: 'arid',
    /**
     * The survey designation. 26-511 is the number on both invoices, which is
     * the joke: one number, two files.
     *
     * **IT WAS 26-450 AND IT MOVED WITH THE BIOME, NOT ON ITS OWN.** The
     * designation is not decoration a re-seed can leave behind — the file
     * header, Cregg's opening line and Ardle's intercept all say it out loud,
     * so the constant and the prose are one fact written in four places and
     * they move together or the file starts lying. See the `biome` block below
     * for the survey that chose this roll.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint. A
     * generator change that re-rolls this ground moves the eight measured
     * placements in the header.
     */
    mapSeed: 26_511,
    /*
     * **IT DOES NOT CHOOSE THE CORNERS HERE, AND THAT IS THE ONE THING TO KNOW
     * ABOUT A THREE-SEAT OPERATION.** `seatedSlots` draws a pair out of
     * `START_PAIRS` for TWO armies only — `if (n !== 2) return [0..n-1]` — so a
     * three-army match sits in slots 0, 1 and 2 at every seed. Every distance
     * in this file and in the layout is therefore seed-independent, unlike
     * `reclamation.02.written-off`, whose header carries the opposite warning.
     * What this seed still buys is the draws of `s.rng`: scatter, ore cells,
     * formation jitter.
     */
    simSeed: 4_027,
    armies: 3,
    /*
     * **THE PAN IS SAND NOW, AND FOR MOST OF THIS FILE'S LIFE IT WAS GRASS.**
     *
     * This field shipped as `'arid'`, which is a `MAP_PRESETS` key and not a
     * biome: `BiomeName` is `temperate | desert | snow | urban`. The preset
     * above really is `arid` and the two vocabularies disagree on exactly that
     * one name, so `getBiome` answered with a `console.warn` and TEMPERATE.
     * Every boot printed `[terrain] unknown biome "arid"` and then built
     * temperate ground — in the product and not only in the harness, because
     * `Shell.applyCampaignQuery` copies this string into `?biome=`. So an
     * operation whose prose says "salt pan" nine times, whose primary reads
     * *hold two taps at each end of the pan* and whose objective id is `pans`
     * rendered on grass. `OperationMap.biome` is typed `BiomeName` now, so
     * that spelling is a `tsc` error rather than a warning nobody reads.
     *
     * **`'desert'` IS THE PAIRING THE PRODUCT ALREADY MAKES**, not a taste:
     * `MAPS`' `airbase-flats` row in `settings-store.ts` is
     * `biome: 'desert', preset: 'arid'`, and `soviets.01.first-tap` is the same
     * pair. R3 was the only place the two disagreed.
     *
     * **IT IS A DIFFERENT HEIGHTFIELD, SO IT COST A NEW `mapSeed`.** A biome
     * is not a repaint: hold 26 450 fixed and change only this field, and the
     * map goes from 12 224 passable cells to 12 458, three of the six taps
     * move up to 32 m, and two properties this operation is built on break —
     * post Four lands 24.41 m of SURFACE distance from its nearest tap against
     * `pillboxMg`'s 22 m, so the north post covers nothing at all, and the
     * second scripted Warden of `t.four` lands at (326, 159), a cell no
     * tracked hull can stand on.
     *
     * **THE SURVEY THAT CHOSE 26 511.** Rolls were walked upward one at a time
     * from the shipped 26 450, built headless with the def tables bound and
     * this operation's roster installed, and scored on every property the two
     * headers claim. **The 62nd roll, 26 511, is the first that clears them
     * all**, and it is the only clean roll in the 200 walked (26 450..26 649).
     * What each of the other 199 failed on, a roll counted once per property:
     *
     *     scripted spawn rings on unstandable ground   188   <- the binding one
     *     placements relocated by `connectedGround`    137
     *     a post that covers no tap at all              64
     *     terrain split into more than one region       16
     *     Nine's end not 2-of-3 nearer the player       14
     *     a tap or post outside its 52 m reveal disc    11
     *     tap spacing inside one splash radius           1
     *     a post covering two taps                       1
     *
     * **THE BINDING PROPERTY IS THE SPAWN RINGS AND THIS BLOCK USED TO NAME
     * THE WRONG ONE.** The old header made `unbuildableGround === 0` the
     * scarce thing and blamed `arid`'s `cliffs` 0.55. Measured: over all 200
     * desert rolls AND a 40-roll temperate control, `unbuildableGround` and
     * `strandedEntities` were **0 on every single roll** — the layout's own
     * `place` helper asks `footprintBuildable` before it plants anything, which
     * is what that helper is for. What is actually scarce is a roll on which
     * all sixteen points of the four scripted `spawnUnits` rings are standable,
     * and 94% of rolls fail it.
     */
    biome: 'desert',
    /*
     * `base`. The operation asks for Tinkers, and `rclTinker`'s prereqs are
     * `rclRookery` and `rclSorter` — an `mcv` opening would spend the first
     * three minutes of a fifteen-minute week unable to replace a single deed,
     * and the primary needs one more deed than the crew can pay for.
     */
    opening: 'base',
    /*
     * 4000, AND IT BINDS ALL THREE SEATS — `Shell.applySimPostBoot` writes
     * `startingCredits` into every non-Neutral slot, so this is a statement
     * about the operation's tempo rather than a handicap.
     *
     * Deliberately short of the skirmish 10 000, because the fourth Tinker is
     * meant to cost something: 500 credits is 12.5% of the opening bank. Four
     * taps pay 3600 a minute (`CIVILIAN_INCOME` is 15/s, against a MEASURED
     * harvester's 525/min) and six pay 5400, so the pan is the economy this
     * operation is about and the bank is the down payment on it. It also holds
     * BOTH depots to the pace CLAUDE.md names as the single cause of "the AI
     * has a ready base" — a 10 000 opening built a seven-building base with
     * eleven troops by t+90 s having mined nothing, and there are two of them
     * here.
     */
    credits: 4_000,
  },
  layout: 'reclamation-sold-twice',

  // NEITHER SHIPPED RULE MAY END THIS. See the header — with three seats
  // `annihilationWin` is also the rule most likely to fire on somebody else's
  // war, and `assetLossDefeat` would end the operation's best last act.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * ASYMMETRIC, AND THE TWO HALVES ANSWER DIFFERENT QUESTIONS — which is what
   * `types.ts` means by "asymmetry is the point".
   *
   * The player gets the thing that HOLDS GROUND and the depots get the thing
   * that GOES ROUND IT.
   */
  roster: {
    /*
     * The Arcspitter, carried forward from R2, and the Arc Pylon.
     *
     * `struct.defence.specialist` is the new one and it is the answer to a hold
     * on ground 238.95 m from your own yard: `rclPylon` is 1450 credits and
     * **-90 power**, the heaviest single load in the game, so putting one at
     * either end of the pan is a decision about the grid rather than a purchase.
     *
     * IT ALSO CHANGES THE OPENING BASE, AND THAT COST IS PAID AT t=0.
     * `ALLIED_DEFENCE` carries one `prismTower`, which `keyFor` turns into a
     * Pylon; measured on the built world the player's yard opens at **+60
     * power against each depot's +230**, and 90 of that 170-point gap is this
     * one structure. (The other 80 is not the roster at all — `rclFurnace`
     * makes 80 where a `powerPlant` makes 100, four times over.) Since a
     * Furnace makes 80, a SECOND Pylon anywhere on the map is a brownout until
     * another Furnace is up, which is exactly the decision the grant is for.
     *
     * `struct.tech` and `unit.specialist` are withheld, as in R2: between them
     * they are a double lock on the Slaghurler, whose own blurb is "The only
     * thing in the army that can break a base." Nothing in this operation asks
     * anybody to break a base.
     */
    player: ['unit.raider', 'struct.defence.specialist'],
    /*
     * The Sabre IFV, and nothing else.
     *
     * Fast light armour is exactly what punishes a player stretched across two
     * ends 124.0 m apart, and it is the right thing for a depot to own: these
     * are supply establishments with a collection schedule, not fortresses.
     * Withholding `struct.defence.specialist` from them is what keeps that
     * true on the ground — `ALLIED_DEFENCE`'s `prismTower` is refused, so the
     * built world reports each depot holding three `pillbox` on its own defence
     * line, nine wall segments, and no specialist tower at all. The two
     * receiving posts out on the pan are untagged `pillbox`-role emplacements,
     * so no roster can withhold them and none is needed to keep them — which is
     * why the depots' `pillbox` count reads four rather than three.
     */
    ai: ['unit.raider'],
  },

  objectives: [
    {
      id: 'pans',
      kind: 'primary',
      title: 'Hold two taps at each end of the pan for five minutes',
    },
    {
      id: 'posts',
      kind: 'secondary',
      title: 'Clear both receiving posts before the collections arrive',
      /*
       * 500 IS ONE TINKER'S WAGE, AND THAT IS THE POINT OF THE NUMBER. The crew
       * is one short of the primary; this pays for the one you are short. It is
       * paid the moment the second post falls rather than at the end, so it
       * goes back into the run that earned it. Cregg refunds; he does not tip.
       */
      credits: 500,
    },
    {
      id: 'whole',
      kind: 'secondary',
      hidden: true,
      title: "Work all three taps at Depot Four's end",
      /*
       * 700, AND IT IS THE HARD HALF OF THE MAP. The far end is 80.33 m deeper
       * than its own depot's approach; a third deed there is a tap the operation
       * does not need, on the ground where losing one costs the most.
       *
       * HIDDEN, AND REVEALED AT THE MOMENT IT BECOMES A REAL CHOICE rather than
       * a line in a briefing. `briefingObjectives` filters hidden rows out of
       * the briefing, so a player who never goes north never learns it existed —
       * which is the correct reading of a reward for over-delivering.
       *
       * NOTHING FAILS IT, DELIBERATELY. A levelled tap is gone for the match, so
       * a player who takes one and loses it can never reach three, and the
       * objective simply never completes. `ownerCount` cannot tell "not taken
       * yet" from "taken and lost" — both read low — so an authored
       * `failObjective` would have to guess, and guessing wrong fails a player
       * who has done nothing wrong. The same honest reading
       * `reclamation.02.written-off` takes for `heads`.
       */
      credits: 700,
    },
  ],

  triggers: [
    /* -- the brief --------------------------------------------------------
     * Two beats rather than four lines at once: the shell renders dialogue as
     * toasts and a stack of four is a stack nobody reads. The reveals are not
     * decoration — both ends of the pan are 162 m and 239 m away under
     * unexplored shroud, and every objective in the file is on them.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Survey 26-511. Six capped Works taps on a salt pan, sold as recovered plant '
            + 'to Allied Depot Four on the Tuesday and to Allied Depot Nine on the Thursday. '
            + 'Same lot number on both invoices. Both paid.',
        },
        { do: 'revealArea', player: 0, area: LOT_FOUR_AREA },
        { do: 'revealArea', player: 0, area: LOT_NINE_AREA },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'A delivery is logged against whoever holds the deed when the party arrives. '
            + 'Two taps at each end, held for five minutes, and both notes are cut. A capped '
            + 'tap flips at any health and it costs you the Tinker who walks in.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'You have three Tinkers and the order wants four deeds. The Rookery makes more '
            + 'at five hundred a head. Both parties are inside the week — anything not on our '
            + 'books at fifteen minutes is a refund I am not issuing.',
        },
      ],
    },

    /* -- the far end, and the reward for going there ----------------------
     * R1's rule: a hidden objective whose method the player has to guess is a
     * quiz. This one reveals on the FIRST deed at Four's end, which is the tick
     * the player has committed to the hard half of the map, and names what the
     * third tap there is worth.
     */
    {
      id: 't.north',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'lotFour', min: 1 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'That is Four\'s end on our books. Every cap up there is nearer their gate '
            + 'than ours and it stays that way — take the third one while you are standing '
            + 'on it and there is nothing on that end for them to collect at all.',
        },
        { do: 'setObjective', id: 'whole' },
      ],
    },

    /* -- the hold arms ----------------------------------------------------
     * The one beat this operation cannot do without. `elapsedSinceArmed`
     * restarts, and on a conjunction it restarts from EITHER end.
     * `allies-sounding-line`'s header states the rule this borrows: a rule the
     * player can only learn by losing it is a rule badly told.
     */
    {
      id: 't.armed',
      when: {
        on: 'all',
        of: [
          { on: 'ownerCount', player: 0, role: 'building', tag: 'lotFour', min: 2 },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'lotNine', min: 2 },
        ],
      },
      then: [
        { do: 'eva', line: 'buildingCaptured' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Both ends on our books. The five minutes runs while you hold two at each end '
            + 'and it goes back to zero the moment either end drops to one. Losing a tap at '
            + 'Four\'s end costs you the clock at Nine\'s.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Neither of them has a way to take a deed off you. They can only knock the cap '
            + 'down, and a knocked-down cap does not come back. Three at each end, two needed '
            + '— that is one spare a side and no more.',
        },
      ],
    },

    /* -- the visible secondary, both directions ---------------------------
     * The pair `allies-sounding-line` uses for its control reading, and for the
     * same reason: an objective that expires needs a trigger that says so, or
     * the player finds out by reading a list.
     *
     * `elapsed(seconds(30))` IS THE GUARD, NOT A DELAY. `entityDead` reads TRUE
     * before its tag has ever existed, so a layout that failed to place the two
     * posts would complete this on tick one and hand out 500 credits for
     * nothing. The floor makes the trigger honest at a cost of nothing a player
     * can reach — the nearer post is 129.69 m from the staged crew, and the
     * fastest thing they own does not cross that and kill a 500 hp emplacement
     * inside thirty seconds.
     *
     * `not(elapsed)` is legal and `not(elapsedSinceArmed)` is not —
     * `validateCampaign` refuses the second because it reads true during the
     * arming pass, so the negation reads false and the trigger can never fire.
     */
    {
      id: 't.posts',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: seconds(30) },
          { on: 'entityDead', tag: 'post' },
          { on: 'not', of: { on: 'elapsed', ticks: COLLECTION } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'posts' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Both posts off the pan before either party left its gate. Four will assume '
            + 'Nine cleared it and Nine will assume Four did. That is the argument we want '
            + 'them having, and it cost us two emplacements neither of them will bill for.',
        },
      ],
    },
    {
      id: 't.late',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: COLLECTION },
          { on: 'not', of: { on: 'objectiveComplete', id: 'posts' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'posts' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Too late to be tidy. Their men on the pan will see ours on the pan. Take the '
            + 'deeds anyway — a signed note beats a witness.',
        },
      ],
    },

    /* -- the crew is finite ------------------------------------------------
     * True whether they were spent or killed, which is why the line names the
     * price rather than the cause. `elapsed` is conjoined so a layout that
     * failed to place the crew cannot fire this on tick one — the shape
     * `soviets-common-standard` uses its `min: 1` for, in the one spelling that
     * works when the threshold IS zero.
     */
    {
      id: 't.crew',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: seconds(30) },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'crew', max: 0 },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'That is the staged crew gone. The Rookery makes more — five hundred credits, '
            + 'ten seconds, and a long walk to whichever end you are short at.',
        },
      ],
    },

    /* -- Depot Four collects -----------------------------------------------
     * Minute four, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps regardless
     * reads as an opponent.
     *
     * IT FORMS AT THE DEPOT'S OWN GATE AND THE ORDER IS A HEADING, NOT A LEASH.
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these seven
     * do and the brain owns them after that. What the wave really buys is that
     * Depot Four's army is 69.46 m from its own gate and pointed at the north
     * end of the pan at a known minute — read it as the depot collecting faster
     * than it could, which is what `soviets-deep-sector`'s header established
     * about scripted waves on an AI seat.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against
     * the army of the seat it lands on, so a Reclamation key here is a build
     * error.
     */
    {
      id: 't.four',
      when: { on: 'elapsed', ticks: COLLECTION },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle, intercepted',
          text: 'Depot Four collection party, Survey 26-511, all standing plant. The lot is on '
            + 'our books and there are Reclamation crews on it. Clear them and log the '
            + 'delivery on time.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_FOUR.x, z: ROAD_FOUR.z, r: 40 } },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_FOUR, spread: 20, tag: 'partyFour',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_FOUR, spread: 14, tag: 'partyFour',
        },
        { do: 'orderTagged', tag: 'partyFour', order: 'attackMove', at: LOT_FOUR },
      ],
    },

    /* -- Depot Nine collects -----------------------------------------------
     * Minute six, and one hull heavier, onto the end the player can actually
     * reinforce — 162.31 m from their yard against 158.62 m from Nine's.
     *
     * A SECOND TAG RATHER THAN A SHARED ONE, AND IT HAS TO BE.
     * `EffectSink.orderTagged` issues ONE command per owner and skips every
     * unit of any other owner, because `Command.player` is a single seat and
     * the simulation refuses what a seat does not own. A tag spanning both
     * depots would silently order half of it.
     */
    {
      id: 't.nine',
      when: { on: 'elapsed', ticks: minutes(6) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Sennet, intercepted',
          text: 'Depot Nine, same lot number, same week. Four has a party on the north end of '
            + 'my pan and I have not been told why. Take the south end first and we will '
            + 'reconcile the paperwork afterwards.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_NINE.x, z: ROAD_NINE.z, r: 40 } },
        {
          do: 'spawnUnits', player: 2, key: 'gi', count: 6, at: ROAD_NINE, spread: 22, tag: 'partyNine',
        },
        {
          do: 'spawnUnits', player: 2, key: 'grizzly', count: 3, at: ROAD_NINE, spread: 15, tag: 'partyNine',
        },
        { do: 'orderTagged', tag: 'partyNine', order: 'attackMove', at: LOT_NINE },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Both of them on the same pan and neither of them will write the other a '
            + 'letter about it. Keep two turning at each end and let them reconcile.',
        },
      ],
    },

    /* -- the week closing, telegraphed ------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(13) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Two minutes on the week. Whatever is not on our books at fifteen goes down as '
            + 'a shortfall, and a shortfall is the one line that makes two depots talk to each '
            + 'other.',
        },
      ],
    },

    /* -- the hidden secondary ----------------------------------------------
     * ABOVE `t.win`, deliberately: `runDirector` returns early once an outcome
     * is set, so a third deed at Four's end that lands on the winning tick has
     * to resolve before the operation ends or the medal does not count it. Same
     * ordering rule `soviets-deep-sector` states for `t.mastsDown`.
     */
    {
      id: 't.whole',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'lotFour', min: 3 },
      then: [
        { do: 'completeObjective', id: 'whole' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'All three at Four\'s end. When their party gets there the lot they paid for '
            + 'is a Reclamation holding with our name on every cap. They will bill Nine for '
            + 'the shortfall before they think to bill us.',
        },
      ],
    },

    /* -- the win -----------------------------------------------------------
     * The arming pass is what makes this a HOLD: with `elapsedSinceArmed` forced
     * true the tree reduces to "does the player own two taps at each end", so
     * the arm tick is set the moment the fourth deed lands and DELETED the
     * moment either count falls to one. Five minutes, from zero, again.
     *
     * ABOVE `t.close`, so a hold that completes on the tick the week ends is a
     * win. The ground beats the paperwork; that is the whole chapter.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'ownerCount', player: 0, role: 'building', tag: 'lotFour', min: 2 },
          { on: 'ownerCount', player: 0, role: 'building', tag: 'lotNine', min: 2 },
          { on: 'elapsedSinceArmed', ticks: NOTES },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'pans' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Both notes cut, both signed, both filed upward. Four delivered and Nine '
            + 'delivered, and the only office holding a copy of each is this one. Send them '
            + 'the invoice for the recovery work.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the week closes ----------------------------------------------------
     * The one loss the vocabulary can express for the state where the primary
     * has become unreachable — see the header. It is also the ordinary loss for
     * a player who never held both ends, and it names the primary either way.
     */
    {
      id: 't.close',
      when: { on: 'elapsed', ticks: minutes(15) },
      then: [
        { do: 'failObjective', id: 'pans' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Week is closed and the pan is short. Two depots are about to compare invoices '
            + 'and there is exactly one name on both of them.',
        },
        { do: 'endOperation', result: 'loss', reason: 'pans' },
      ],
    },

    /* -- the ordinary loss --------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". A broker whose yard is gone
     * while four taps are still paying him is not beaten, and this operation
     * would like that to be a position somebody can play from.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'failObjective', id: 'pans' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Nothing answering at the yard. The pan goes to whichever of them gets a party '
            + 'onto it first, and they can argue about the other invoice without us.',
        },
        { do: 'endOperation', result: 'loss', reason: 'pans' },
      ],
    },
  ],
};

export default op;
