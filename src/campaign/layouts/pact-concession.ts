/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-concession.ts
 * ============================================================================
 * P3 — THE GROUND. A terraced desert, two openings **386.2 m** apart, a Pact
 * reading station on a shelf two thirds of the way across with a Reclamation
 * breaking crew standing on it, and four unarmed bearers who have to walk there
 * and back.
 *
 * ============================================================================
 * THE ONE THING THIS FILE EXISTS TO PRODUCE
 * ============================================================================
 * **A ROAD WORTH WALKING.** Everything else here — the station, the shed, the
 * two coil posts — is dressing on an assault that any layout could stage. What
 * makes this an escort is that the ground between the station and the player's
 * opening is 246.7 m of straight line and **281.4 m of actual road**, and that
 * the road is a property of the terraces rather than of anything authored.
 * (246.7 is measured to the START SPOT, which is what `t.win`'s disc is drawn
 * on; the Conclave itself sits 2.83 m off it, at 244.2. Both figures moved by
 * ~2.5 m when the derrick came off the shelf's doorway — see the pocket
 * section — and the road figure is instrument-dependent besides. The operation
 * header names the instrument and carries the control-versus-fixed pair.)
 *
 * Measured on a headless build at `mapSeed` 33 310 / `simSeed` 3 393, with the
 * def tables BOUND and the operation's roster INSTALLED, which is the only
 * state in which the roster's refusals below are actually in force:
 *
 *     foot-passable cells   11 788 of 16 384   (72%)
 *     closed (cliff/border)  4 596             (28%)
 *     water                      0
 *     rough                    268             (2.3% of the passable ones)
 *
 * **THAT IS NOT THE BUILD `tests/campaign-maps.spec.ts` PERFORMS, AND THIS
 * PARAGRAPH USED TO CLAIM IT WAS.** `buildOperation` there passes no `defs` and
 * never calls `setCampaignRoster`, so `buildScenario` takes `EMPTY_BINDING`,
 * `spawnUnit` sees `def === undefined`, and `isBuildable(undefined)` is true —
 * every refusal counted below is INERT in that harness, which returns 250
 * alive, 25 units on seat 0 and 17 on seat 1. The figures here come from the
 * same build plus `defs: await resolveDefBinding()` and
 * `setCampaignRoster(op.roster)`. Anyone re-deriving them from that spec alone
 * will conclude the roster does nothing, and will be measuring a different game.
 *
 * **AND THE CLOSED ROW READ 4 353, WHICH DOES NOT COMPLETE THE MAP.** 11 788 +
 * 4 353 = 16 141, short by 243 — exactly the count of cells a hover can enter
 * and a man cannot, so the wrong figure was `16 384 - hoverPassable` printed
 * under a foot label. Three independent counts (`costGrid >= 255`, the
 * `passGrid` foot bit clear, and the subtraction) all give 4 596. A census
 * whose rows do not sum to `MAP_CELL_COUNT` is wrong on its face.
 *
 * The closed quarter is the terrace faces, and they are why the road bends.
 * **The 2.3% is why it is the SAME road for both halves of this army**:
 * `NAV_COST_ROUGH` is 1.25 for Foot and 1.0 for Hover, so on genuinely broken
 * ground the Pact's hulls would route straight where its people detour — and
 * there is not enough broken ground here for that to be worth anything.
 * Compared CORRIDOR to corridor — every cell on some least-cost path, the only
 * tie-break-free way to ask — the two answer the same total cost (7204.5 either
 * way), the foot corridor is a strict SUBSET of the hover one (236 cells inside
 * 240), and the hover corridor reaches **4.0 m** — ONE cell — past it at its
 * widest. **THAT NUMBER READ 8.0 AND THE CONTROL SAYS IT IS 4.0 ON THIS GROUND
 * TOO.** Re-measured 2026-08-19 on both builds with one instrument, the
 * derrick's move changed the corridor from 237 cells to 236 and left the
 * overhang at 4.0 m in BOTH, so 8.0 came from a third instrument rather than
 * from the ground this file describes. Name the instrument before calling
 * either figure false. The operation header carries the full note, including the one cost
 * column that WOULD separate them and that no headless build has
 * (`NAV_COST_ROAD` is 0.88 Foot / 1.0 Hover, and `roads.system.ts` builds the
 * network in `init()` during `bootstrap()`, not inside `buildScenario`). It is
 * recorded in both files because it is the first thing anybody authoring for
 * this army will try to build a route out of.
 *
 * ============================================================================
 * WHAT LANDS, AT `mapSeed` 33 310 / `simSeed` 3 393
 * ============================================================================
 * Read off the built world AFTER `spawnBuilding` snapped every footprint —
 * `place()` below returns a point and the snap moves it again, so nothing here
 * is recomputed from the fractions.
 *
 *     home spot 108, 380     Conclave 110, 378     foe spot 404, 132
 *     anchor    343.4, 300.2 (nominal)
 *     station   340, 296  (Gaia, 900 hp)           shed 370, 300 (1250 hp)
 *     posts     318, 310  and  338, 322  (520 hp each)
 *     bearers   73,400  76,404  79,408  82,411   (5.00 m apart, consecutive)
 *
 *     home -> station 246.7      foe -> station 176.1     station -> shed 30.3
 *     station -> posts 26.1 and 26.1       post -> post 23.3
 *     bearers -> home spot 40.7 / 40.1 / 40.1 / 40.7
 *     bearers -> station 287 / 285 / 284 / 283
 *     nearest Reclamation asset to the bearers at t = 0: 256.7 m
 *
 * **THE STATION ROW MOVED AND NOTHING ELSE DID.** It read 344, 300 until the
 * derrick came off the shelf's doorway; the shed, both posts, the bearers and
 * both openings are byte-identical before and after, which is the property the
 * anchor split above exists to buy. The four rows that moved are the four that
 * are measured FROM the derrick.
 *
 * **TWO OF THOSE ROWS WERE WRONG AND BOTH ARE THE SAME KIND OF WRONG.** The
 * Conclave read 98, 364: the 1900 hp 3x3 `mrdConclave` is at **110, 378**,
 * 2.83 m from the start spot, and the 1150 hp 3x2 at 98, 364 is a Forgeyard or
 * a Cistern — identified by hp off the built world rather than by eye. And the
 * nearest-asset row read 261.4, which is the FIRST bearer's distance and the
 * LARGEST of the four; per bearer it runs 261.4 / 259.8 / 258.2 / 256.7, and
 * the operation header states it as a guarantee, so it has to be the minimum.
 * Both figures are quoted a second time in the operation file, which is how a
 * single misreading becomes two files agreeing with each other.
 *
 * ============================================================================
 * THE SHELF WAS A SEALED POCKET AND THE DERRICK WAS THE PLUG — FIXED
 * ============================================================================
 * **REAL DEFECT, MEASURED ON THE BUILT WORLD, CLOSED BY MOVING ONE BUILDING
 * ONE CELL.** The terrain under the station was always fine: flooded
 * 4-connected over the raw `passGrid`, the map is **ONE region of 11 788
 * cells** and the station cell is in it. Adding this layout's own structure
 * occupancy used to make it **THREE regions — 11 633 / 24 / 1** — and the
 * 24-cell one was the shelf the station, the shed and the two posts stand on,
 * unreachable from the player's opening by any ground move class, permanently,
 * because the derrick is Gaia and unshootable.
 *
 * The seal was the derrick's OWN 2x2 footprint. Cells (85..86, 74..75) are the
 * shelf's only 4-connected doorway — main ground at (84,74)/(84,75) on one
 * side, shelf at (87,74)/(87,75) on the other, terrace face above and below —
 * and freeing just those four cells merged the shelf back (11 661). So the
 * objective's own building closed the ground the objective stands on.
 *
 * `STATION_MOUTH_CLEAR` is the fix and its own doc carries the arithmetic: the
 * derrick alone moves **5.66 m**, one diagonal cell, onto (84..85, 73..74), and
 * the doorway opens. Measured both ways on the built world — `FlowFieldCache
 * .regionOf(MoveClass.Foot)` and an independent flood over `passGrid` plus
 * occupancy, which agree cell for cell:
 *
 *     before   3 regions   11 633 / 24 / 1     station cell in NO region
 *     after    2 regions   11 657 / 1          station cell in the MAIN region
 *
 * The surviving `1` is one cell at (94,74) behind the shed. It is in the
 * BEFORE reading too, no unit can enter it and nothing stands on it.
 *
 * Three consequences, all re-measured after the move:
 *
 *   - `t.lift`'s `r = 22` disc held 39 foot-passable cells of which **only 26
 *     were connected to the map**; it now holds **40, and all 40 are
 *     connected** — 640 m2 against 416, nearest usable cell 6.32 m from the
 *     station centre and farthest 20.59 m. The operation header's coverage
 *     block is re-derived off the new denominator.
 *   - The Breaker Yard's only adjacent open ground WAS the pocket: nearest open
 *     cell 6.0 m, nearest MAIN-region cell **22.0 m**, across the terrace. Both
 *     read **6.0 m** now. `ProductionService.findEgressSpot` is a ring scan
 *     over `isPassable` and occupancy and **tests no connectivity at all**, so
 *     anything the shed produced would have been born stranded on 384 m2. It
 *     was latent only because egress runs from `primaryFactory[Vehicles]`,
 *     which is the AI's home yard — allocated first, in `buildBaseFor`, before
 *     this shelf exists. Level the home yard, the rescan promotes the shed, and
 *     from that moment every Reclamation vehicle would have spawned into a
 *     sealed shelf. A defect in the player's favour, which is why nobody would
 *     have reported it.
 *   - **NOTHING IN THE GATE COULD SEE IT, AND NOTHING IN THE GATE CAN SEE IT
 *     COME BACK.** `buildScenario`'s own connectivity diagnostic runs BEFORE
 *     occupancy and prints one region at 100% either way.
 *     `campaign-spawn-ground.spec.ts` asks `terrain.isPassable`, which is a
 *     placement question and says so in its own header (*"a fully passable ring
 *     inside a sealed pocket passes this and is still wrong"*).
 *     `campaign-zone-safety.spec.ts` is geometry. So this fix is held up by
 *     `STATION_MOUTH_CLEAR`'s measured band and by nothing else: **re-measure
 *     the regions on the built world after any change to the seeds, the anchor
 *     or the shelf, with `FlowFieldCache.regionOf`, never with a flood over the
 *     raw grid** — the raw grid is what said the ground was fine.
 *
 * **THE OPENINGS, COUNTED RATHER THAN ASSUMED**, and the interesting half is
 * what the roster took away:
 *
 *     seat 0  Meridian    23 units   23 buildings
 *             5 mrdArtificer (FOUR tagged; the fifth ships with the garrison),
 *             9 mrdWayfarer, 7 mrdSolarch, 2 mrdCollector
 *     seat 1  Reclamation 15 units   26 buildings
 *             8 rclPicker (five garrison, three placed here), 4 rclGrinder,
 *             2 rclScrapper, 1 rclTinker
 *     242 entities alive in total
 *
 * `buildAlliedBase` runs for BOTH seats — `buildBaseFor` only forks on
 * `Faction.Soviets` — and its garrison ships two IFVs, which `keyFor` maps to
 * `mrdSkiff` on seat 0 and `rclSpitter` on seat 1. **Both carry `unit.raider`
 * and both are refused**, because the operation's roster is an allow-list and
 * names nothing. That is not incidental: the Sandskiff has `cargoSlots: 2` and
 * two of them would carry the whole column home at 9.2 m/s, so the refusal is
 * what makes this an escort at all — see the roster block in the operation
 * file. It costs the Reclamation two Arcspitters in exchange, which is the
 * symmetry that makes it a rule rather than a handicap.
 *
 * **THE FIFTH ARTIFICER IS REAL AND IS NOT A BEARER.** The garrison ships one,
 * it stands with the base rather than with the column 40 m behind it, and no
 * trigger can see it: every condition that reads the column passes
 * `tag: 'bearers'`, and `TagRegistry` holds only what this file stamped. Losing
 * it costs nothing. It is named here because "there are five men in that army
 * who look identical and four of them are the mission" is exactly the sort of
 * thing a player notices and a header does not say.
 *
 * ============================================================================
 * WHY THE STATION IS GAIA AND WHY `addCivilians` IS NOT CALLED
 * ============================================================================
 * The station is a `civOilDerrick` on `b.gaia`. `ScenarioBuilder.gaia` sets
 * both directions of `allyMask` for the Neutral slot, so `isValidTarget`
 * refuses it to every gun in the match — **the landmark this operation is named
 * after cannot be shot by anybody**, which deletes the entire class of failure
 * `pact.02.long-count` is built out of. No trigger names it; the lift is a disc
 * on the ground, not a structure that has to survive.
 *
 * **THAT SENTENCE IS TRUE AT t = 0 AND FOR EXACTLY AS LONG AS THE DERRICK STAYS
 * GAIA, AND THIS IS A LIVE HAZARD RATHER THAN A FIXED ONE.** `mrdArtificer` is
 * `canCapture: true` and a Gaia building is neither `hoverOwn` nor
 * `hoverEnemy`, so a right-click on the station with a bearer selected produces
 * `OrderKind.Capture` with a CAPTURE cursor — which captures the derrick,
 * writes the captor's faction onto it, and CONSUMES the bearer. **Nothing in
 * either of this operation's two files closes that and nothing here tries to**;
 * it is engine behaviour that binds every operation with a Gaia structure and a
 * capture-capable player unit, so the rule belongs where it can be stated once.
 * The operation header carries the full trace under "the third way a bearer
 * dies".
 *
 * **THE ONE THING THE DERRICK'S MOVE CHANGED IS THE SECOND-ORDER HALF, AND IT
 * MOVED IN THE PLAYER'S FAVOUR BY 42 cm.** This used to read *"a Meridian
 * derrick 22.80 m from the Spitpost below is 17.14 m of surface against 20 m of
 * `postCoil`, so it also starts taking fire"*. Both posts now stand **26.08 m**
 * from the derrick, and its `hitRadius` is the half-diagonal of a 2x2 —
 * `hypot(4, 4)` = **5.657** — so the surface distance is **20.42 m against 20**
 * and a captured derrick is just OUTSIDE both posts' reach. That is a margin of
 * 0.42 m on a structure nobody may move without re-deriving it, not a
 * guarantee; the bearer is consumed either way, which is the part that matters.
 *
 * `addCivilians` is deliberately not called, and here the reason is sharper
 * than `pact.02`'s. Its hamlet puts `CIVILIAN_KEYS[0]` — which IS
 * `civOilDerrick` — on the crossroads of each arm of the lane bisector, so
 * calling it would plant two more Gaia derricks with the same silhouette as the
 * objective, inside the corridor the column walks. A player who cannot tell
 * which derrick is the reading station is a player who walks four unarmed men
 * to the wrong one.
 *
 * ============================================================================
 * THE WORKS, AND WHAT EACH PIECE OF IT IS FOR
 * ============================================================================
 * **The shed** is `warFactory`, which `keyFor` resolves to the Breaker Yard on
 * seat 1 — a REAL vehicle producer on the AI's seat, so `AiBrain.census` counts
 * it and a second producer is worth up to 35% on the one queue
 * (`FACTORY_SPEED_BONUS`). Levelling it costs the Reclamation throughput rather
 * than scenery. No trigger reads it and this file does not tag it: a tag
 * nothing names is a claim nothing checks.
 *
 * **NOTHING COMES OUT OF IT, THOUGH, AND THIS SAID `BuildQueue` RAN GRINDERS
 * OUT OF IT.** `BuildQueue` advances ONE queue per tab per player and
 * `ProductionService` egresses the finished hull from `primaryFactory[Vehicles]`
 * — the AI's home Breaker Yard, allocated first. The throughput bonus is real
 * and is the whole of what this structure buys; the spawn point is not. See the
 * pocket block above for what happens the day the home yard dies and the rescan
 * promotes this one.
 *
 * **The two posts** are `pillbox`, which `keyFor` resolves to the Spitpost —
 * 520 hp, `postCoil` at 20 m, `power: 0`, so a brownout in a base 176 m away
 * cannot silence them. They stand on the side the column arrives from, **26.1
 * and 26.1 m out** (27.9 and 22.8 before the derrick moved; the posts did not
 * move at all — they are measured from the anchor, and it is the derrick that
 * walked into the middle between them), and the operation header has the
 * arithmetic that matters: a
 * Solarch parks **0.84 m** outside their reach and kills them for nothing,
 * while a bearer inside the lift disc has no standoff at all. The guns tax the
 * lift, not the assault. (0.84 rather than 0.80 because a 1x1 emplacement's
 * `hitRadius` is hypot(2, 2) = 2.8284 against a Solarch's 2.790, and the two do
 * not cancel when one side is a structure — see the operation header, which
 * also records the condition on it: `Targeting.approach` is reached through
 * `managesGoal`, which returns false for anything but `UnitState.Attacking` or
 * `Guarding`, so the 0.84 m is what a right-click ON a post buys and not what
 * an attack-move gives.)
 *
 * **The three Scrap Pickers** carry NO TAG and nothing depends on where they
 * are. `Stance.Defensive` reads as on-post and `AiBrain.regroupSquads` will
 * march them off it on the first brain pass whatever this file says — which is
 * exactly why no trigger may depend on a hull the AI owns, and why
 * `campaign-maps.spec.ts` refuses one. **THE SAME RULE BINDS THE OPERATION'S
 * OWN `orderTagged` WAVES**, which the operation header did not say; a
 * `spawnUnits` onto seat 1 is re-filed by the same pass six ticks later.
 *
 * They are here so the shelf is not EMPTY, and that is a statement about the
 * world rather than about the screen. `t.open`'s `revealArea` calls
 * `exploreCircle`, and `Vision.levelAt` returns `Remembered` on an explored
 * cell only for `isStaticKind` — Building, Prop, Wreck. Infantry is none of
 * those, so the reveal shows the derrick, the two posts and the shed and does
 * NOT show these three. A player sees them when something of theirs gets close
 * enough to look, which is the correct behaviour and not what "on the first
 * frame" describes.
 *
 * ============================================================================
 * EVERY TAG THIS STAMPS IS DECLARED ABOVE `build`
 * ============================================================================
 * `validateCampaign` refuses an operation whose triggers name a tag no layout
 * produces, because `entityDead` reads TRUE before a tag has ever existed — and
 * this operation LOSES on `entityDead: 'bearers'`, so a mistyped tag would
 * defeat the player on tick one, silently, before a shot was fired. An escort
 * is built entirely out of that one tag, which makes it the highest-value typo
 * in the file.
 *
 * `bearers` is the only tag this file stamps and it is on PLAYER-OWNED units,
 * which is legal and is the exception `campaign-maps.spec.ts` names: nothing
 * re-tasks a human seat's hulls, so the tag goes on describing what the player
 * is holding. `crew` and `cutoff` are produced by `spawnUnits` in the trigger
 * table and are declared here so that a reader asking "where does the wave come
 * from" finds the answer in the file that owns the ground.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning and that answers from the LOCAL profile unless an operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot,
 * and this operation's roster is empty on both sides — which is precisely why
 * the two refused IFV pairs counted above are the same on every machine.
 *
 * **RE-MEASURE IF `mapSeed`, `simSeed` OR THE FRACTIONS BELOW MOVE.** Nothing
 * fails loudly if they drift: the lift disc stops lining up with the station,
 * the hidden secondary never reveals, and the operation is still winnable, so
 * no test and no player reports it. The one exception is
 * `tests/campaign-spawn-ground.spec.ts`, which re-derives every ring point of
 * both scripted waves and fails by name if a drop lands on closed ground.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  addStartOre, buildBaseFor, islandSeats, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import { layout } from '../layout';

/* ==========================================================================
 * THE COMPOSITION, IN THE FRAME THE OPENINGS DEFINE
 *
 * `n` runs from the player's opening toward the Reclamation one and is authored
 * as a FRACTION of the distance between them, because that distance is a
 * property of `START_SPREAD_X/_Z` and has already doubled once. `p` is the
 * LEFT-hand perpendicular and is authored in METRES.
 *
 * THERE IS NO WATER PROBE ON THE PERPENDICULAR, unlike `pact-shallow-road`.
 * `MAP_SEAS` has no `arid` row, so `b.sea` is null and the built world carries
 * ZERO water cells; the sign of the offset is a composition choice and `place()`
 * is what answers for the ground.
 *
 * THE OFFSET IS 90 m AND IT IS NOT DECORATION. Put on the axis, a station 0.60
 * of the way along would sit 154 m from the Reclamation opening — close enough
 * that the AI's whole standing army is on top of a sixty-second hold. Ninety
 * metres across the axis buys 176.1 m of separation without shortening the walk
 * home, because it lengthens both legs of the triangle at once. (178.4 before
 * `STATION_MOUTH_CLEAR` took the derrick one cell back toward the axis; the
 * OFFSET is still 90 and it is still what buys the separation.)
 * ========================================================================== */

/**
 * THE SHELF ANCHOR. Fraction of the opening-to-opening line.
 *
 * IT IS THE ANCHOR AND NO LONGER THE STATION, AND THAT SPLIT IS THE FIX FOR
 * THE SEALED POCKET. The shed, the two coil posts and the three Scrap Pickers
 * are all measured from this point; only the derrick is measured from
 * `STATION_MOUTH_CLEAR` below it. They used to hang off the derrick's PLACED
 * position, so moving the derrick one cell dragged four other lots with it and
 * the ring searches threw one post 35.4 m from the station. See the pocket
 * section in the header.
 */
const STATION_ALONG = 0.60;
/** Metres off that axis, on the left-hand perpendicular of home -> foe. */
const STATION_OFFSET = 90;
/**
 * Metres the DERRICK alone is set back from the anchor, across the axis.
 *
 * **THIS IS THE SEALED-POCKET FIX AND IT IS WORTH THE WHOLE COMMENT.** At 0 the
 * derrick's 2x2 lands on cells (85..86, 74..75), which is the shelf's ONLY
 * 4-connected doorway — main-region ground at (84,74)/(84,75) on one side, the
 * shelf at (87,74)/(87,75) on the other, terrace face above and below. So the
 * objective's own building sealed the ground the objective stands on, and the
 * shelf became a 24-cell island nothing could walk to.
 *
 * At -6 the derrick lands on (84..85, 73..74) instead — one diagonal cell,
 * **5.66 m** — which frees (86,74), (86,75) and (85,75) and opens the doorway.
 * Measured on the built world with `FlowFieldCache.regionOf(MoveClass.Foot)`
 * and with an independent flood over `passGrid` + occupancy, which agree:
 *
 *     0    3 regions   11 633 / 24 / 1     station cell in NO region
 *     -6   2 regions   11 657 / 1          station cell in the main one
 *
 * **THE BAND IS [-3, -8] AND BOTH EDGES RE-SEAL.** -2 does not move the
 * derrick off the doorway at all (3 regions, the same 24-cell pocket) and -9
 * pushes it a second cell and closes a DIFFERENT one (3 regions, 11 622 / 35 /
 * 1). -6 is the middle of the window, three metres from each failure. It is
 * therefore not a number to nudge for taste: re-measure the regions or leave
 * it alone.
 *
 * The residual `1` is a single cell at (94,74), boxed in by the shed's east
 * wall and the terrace. It predates this change — it is in the 3-region
 * reading above as well — it holds nothing, no unit can enter it, and closing
 * it would mean moving the shed. It is reported rather than chased.
 */
const STATION_MOUTH_CLEAR = -6;

/** Metres past the station, away from home, to the breaking shed. */
const SHED_BACK = 32;
/** Metres across the axis from the station to the shed. */
const SHED_SIDE = 18;

/** Metres the gun line stands on the player's side of the station. */
const GUN_BACK = 18;
/** Metres between the two guns, across the axis. */
const GUN_SPREAD = 14;

/** Metres of bearer formation behind the player's own start spot. */
const BEARER_SETBACK = 40;
/**
 * How many bearers carry the count.
 *
 * FOUR, AND THE NUMBER IS AN ATTRITION LADDER RATHER THAN A CROWD. `t.lost`
 * needs ALL of them dead, `t.lift` needs two standing, and the hidden secondary
 * needs four home. One bearer would make a single pair of `grinderArc` bolts
 * the whole operation.
 *
 * **THE LADDER USED TO BE ARGUED HERE WITH A RUNG MISSING, AND THE RUNG WAS A
 * REAL DEFECT.** It read *"the first loss costs a reward, the second costs the
 * ability to lift at all, and only the fourth ends the match"* — and the middle
 * clause is off by one as well as incomplete. `t.lift` asks for TWO standing,
 * so it is the THIRD loss that costs the lift, and between the third and the
 * fourth — exactly one bearer alive, the lift not yet taken — `t.lift` could
 * never fire again, `t.lost` (`aliveWithTag === 0`) could not fire yet, and
 * this operation switches both shipped outcome rules off. **No trigger in the
 * table could end the match.** Replacements did not help: `mrdArtificer` is
 * ungated and buildable, but every condition that reads the column passes
 * `tag: 'bearers'` and `TagRegistry` holds only what this file stamped.
 *
 * `validateCampaign` could not see it — an authored win path and an authored
 * lose path both exist — and neither could any gate in the suite.
 *
 * **CLOSED BY `t.stranded` IN THE OPERATION'S TRIGGER TABLE**, which loses on
 * `ownerCount { role: 'unit', tag: 'bearers', min: 1, max: 1 }` under
 * `not objectiveComplete 'lift'`. The ladder the number is argued for survives
 * intact: first loss costs the hidden bonus, second leaves the column on
 * exactly the lifting minimum, third ends it if the plates are still on the
 * wall, fourth ends it whatever happened. The `min: 1` half is what keeps it
 * off tick one — a bare `max: 1` reads TRUE at zero, which is `entityDead`'s
 * trap wearing a different condition. See the trigger's own comment.
 */
const BEARERS = 4;

/**
 * Cells searched outward for ground a footprint can legally stand on.
 *
 * Seven is 28 m, and only the FIRST half of the justification this carried is
 * true: it is wider than any lot moves at this operation's seeds — measured
 * nominal-to-placed, station 0.61 m, shed 11.54 m, post A 9.36 m, post B
 * 0.76 m — so the search never runs out before it finds ground. (Those four
 * read 0.61 / 12.14 / 9.72 / 1.23 when the shed and the posts hung off the
 * derrick's PLACED point rather than off the anchor; the anchor is 0.61 m from
 * where the derrick used to land, which is the whole of the difference.)
 *
 * **IT IS NOT "NARROWER THAN THE GAP BETWEEN ANY TWO OF THEM".** Every
 * centre-to-centre gap on the shelf is UNDER 28 m: post to post 23.3, station
 * to post A and to post B 26.1 each, station to shed 30.3 — that last one is
 * the single gap that is now OVER 28, which strengthens the point rather than
 * weakening it: seven rings would not have kept those two apart either. That claim
 * would have made a radius of 7 structurally unable to walk one lot onto
 * another's ground, and it cannot; what actually prevents it is `raise()`
 * calling `b.block` immediately after `spawnBuilding` so the next `place()`
 * sees the reservation, plus `footprintClear` refusing an occupied cell. The
 * ring count is a BUDGET, not a separation guarantee, and reading it as one is
 * how somebody later raises it to 12 believing that is free.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-concession',

  tags: ['bearers', 'crew', 'cutoff'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);

    // NO `rotateStarts`. An operation's `simSeed` is a constant, so the
    // rotation has exactly one value — a moving part with no motion — while
    // making every measured coordinate in the operation file depend on
    // `startOffset`. `reclamation-held-paper` argues this at length.
    const pact: PlayerId = c.seat(0);
    const reclaim: PlayerId = c.seat(1);
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

    // Bearing from the player's opening toward the Reclamation one, so a
    // structure faces the road rather than a compass direction.
    const inward = wrapDeg(Math.atan2(nx, nz) * (180 / Math.PI));
    const outward = wrapDeg(inward + 180);

    /**
     * Put a structure on ground its footprint can legally stand on.
     *
     * `findClearFootprint` tests OCCUPANCY and connectivity and nothing about
     * grade, so it reports success for a lot half-buried in a slope; on a
     * preset whose `cliffs` knob is 0.55 — the highest in the game — that is
     * not a theoretical risk, it is a quarter of the map. This searches for a
     * footprint that is clear AND `footprintBuildable`, in rings, in a fixed
     * traversal order so two runs of one seed place the same shelf, and falls
     * back the way `soviets-first-tap` does: a station that fails to appear is
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
     * Place one structure, reserve the ground, and return where it ACTUALLY
     * went rather than where it was asked for. Every distance the operation
     * file quotes is read off a built world, not off these points.
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
     * player already understands. `garrison` is left at its default on both,
     * so the escort this operation is written about is the base's own army
     * plus the column below, and nothing has to be bought before the
     * operation's question can be asked.
     * ================================================================== */
    buildBaseFor(b, pact, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, reclaim, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* ==================================================================
     * 2. THE SHELF
     *
     * The station on the Gaia slot, the breaking shed 30.3 m behind it, and
     * two coil posts 26.1 m in front of it each, as placed. Everything but the
     * derrick is measured from `anchor` — the NOMINAL shelf point — so
     * `STATION_MOUTH_CLEAR` moves one building and not four.
     *
     * THE ORDER IS THE COMPOSITION. A player advancing from their own
     * opening meets the posts, then the station, then the shed — so the
     * thing they came for is behind the guns and in front of the factory,
     * and the lift happens with the yard's own production line still
     * standing over their shoulder unless they spend the time to level it.
     * ================================================================== */
    const anchor = at(len * STATION_ALONG, STATION_OFFSET);
    const station = raise(
      b.gaia, 'civOilDerrick',
      { x: anchor.x + px * STATION_MOUTH_CLEAR, z: anchor.z + pz * STATION_MOUTH_CLEAR },
      null, outward, 16,
    );

    raise(
      reclaim, 'warFactory',
      {
        x: anchor.x + nx * SHED_BACK + px * SHED_SIDE,
        z: anchor.z + nz * SHED_BACK + pz * SHED_SIDE,
      },
      null, outward, 24,
    );

    /*
     * THE GUN LINE. `pillbox` maps to the Spitpost on this seat. It is chosen
     * for `power: 0`, so it cannot be silenced from a base 176 m away, and for
     * being the SHORT emplacement: 20 m against `rclPylon`'s 28. The gated
     * alternative fails both — `rclPylon` is `struct.defence.specialist` and
     * draws 90 power — and `roster.ai` is empty so `isBuildable` refuses it.
     *
     * **THE OTHER HALF OF THIS JUSTIFICATION WAS BACKWARDS.** It read *"it is
     * chosen for what it CANNOT do: `postCoil` carries no `splashRadius`, so an
     * emplacement cannot clip a second bearer with a bolt aimed at the first"*.
     * The splash half is true and it is the wrong field. `postCoil` is
     * `chainCount: 1` and `Combat.resolveTesla` pushes a separate damage record
     * per link, hopping to the nearest un-hit hostile within
     * `COMBAT_WEAPONS.teslaChainRange` = 9.0 m **of the previous victim** — and
     * the bearers below are spawned 5.00 m apart. So one post bolt reaches two
     * of them, and the def's own shipped blurb says so: **"Cheap chained
     * coil."** Every ungated Reclamation gun on this road chains; the operation
     * header carries the corrected audit and the per-bolt arithmetic.
     *
     * They are IN FRONT rather than around the lot for
     * `soviets-common-standard`'s reason: `postCoil` reaches 20 m, so two posts
     * 23.3 m apart both bear on a column at the station. Spread round the
     * perimeter they would be killed one at a time, each out of the other's
     * reach.
     *
     * **MEASURED, BECAUSE THE DERRICK'S MOVE COULD HAVE COST THAT.** Of the 40
     * reachable cells inside `t.lift`'s r = 22, post A covers 10 and post B
     * covers 6, with 4 under both — so 12 of 40 are covered and both posts are
     * genuinely on the lot rather than one of them being scenery. It was 9 / 9
     * with 5 overlapping over the 26 reachable cells the sealed pocket left,
     * i.e. HALF the usable lot; it is 30% now, on twice the ground.
     */
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      raise(
        reclaim, 'pillbox',
        {
          x: anchor.x - nx * GUN_BACK + px * (s * GUN_SPREAD),
          z: anchor.z - nz * GUN_BACK + pz * (s * GUN_SPREAD),
        },
        null, outward, 10,
      );
    }

    /* -- the crew, and why nothing depends on them ------------------------ */
    for (let i = 0; i < 3; i++) {
      const q = {
        x: anchor.x - nx * (12 + i * 6) + px * (20 + (i % 2) * 6),
        z: anchor.z - nz * (12 + i * 6) + pz * (20 + (i % 2) * 6),
      };
      b.spawnUnit('rclPicker', reclaim, q.x, q.z, { yawDeg: outward, stance: Stance.Defensive });
    }

    /* ==================================================================
     * 3. THE BEARERS
     *
     * Four Artificers, and the choice of unit is the operation. They are
     * unarmed, 95 hp, `Locomotor.Foot` at 3.6 m/s — slower than every hull
     * that will shoot at them and slower than the Grinder that will drive at
     * them — so the player cannot solve the escort by moving fast; and
     * `entityDead` needs all four gone, so attrition is a price the mission
     * charges rather than an instant failure.
     *
     * `spawnUnit` runs `isBuildable` against the operation's roster;
     * `mrdArtificer` carries no `UNLOCK_TAGS` entry, so it is ungated and
     * this cannot come back empty on a fresh profile. It is spelled
     * `engineer` because `keyFor` maps the role per army — the same reason
     * `allies-sounding-line` spells its own party that way — and on this seat
     * it resolves to the Artificer.
     *
     * SET BACK 40 m FROM THE START SPOT, on the side away from the opening.
     * The base garrison forms up between the yard and the enemy; putting the
     * bearers in with it would have them walk out of the first exchange of
     * the match, which is precisely the loss the trigger table is written to
     * make impossible before the player has decided anything. It also puts
     * all four OUTSIDE `t.win`'s 30 m disc at t = 0 — measured at 40.1 to
     * 40.7 m — so the win cannot be satisfied by the column standing where it
     * was left.
     * ================================================================== */
    const rad = home.facingDeg * (Math.PI / 180);
    const fx = Math.sin(rad);
    const fz = Math.cos(rad);
    /** A point `setback` behind the start spot and `lateral` across it. */
    const behind = (setback: number, lateral: number): { x: number; z: number } => ({
      x: home.x - fx * setback - fz * lateral,
      z: home.z - fz * setback + fx * lateral,
    });

    const bearersAt = behind(BEARER_SETBACK, 0);
    for (let i = 0; i < BEARERS; i++) {
      const p = behind(BEARER_SETBACK, (i - (BEARERS - 1) * 0.5) * 5);
      c.tag('bearers', b.spawnUnit('engineer', pact, p.x, p.z, { yawDeg: home.facingDeg }));
    }
    // Units reserve nothing for themselves, so `scatter` below is otherwise
    // free to drop a boulder into the middle of the column. Same reason
    // `buildMcvStartFor` blocks around its escort.
    b.block(bearersAt.x, bearersAt.z, 14);

    /* -- the escort, authored rather than inherited -----------------------
     * Three Solarchs and four Wayfarers, formed line abreast with the bearers
     * so the opening frame reads as a column about to march rather than as a
     * base with four labourers loitering behind it.
     *
     * IT IS A REAL THUMB ON THE SCALE AND SHOULD BE READ AS ONE. Counted on
     * the built world it takes the Meridian opening to 23 units against the
     * Reclamation's 15 — and the operation asks the player to cross 249 m into
     * the other half of the map twice, at 3.6 m/s, with four men who cannot
     * shoot back.
     *
     * ONLY UNGATED KEYS, AND THIS IS THE RULE RATHER THAN THE PREFERENCE.
     * `roster: { player: [], ai: [] }` makes `isBuildable` an ALLOW-LIST, so
     * anything carrying an `UNLOCK_TAGS` id is refused for both seats and
     * `spawnUnit` returns NONE without a word — which is exactly what happens
     * to the two `mrdSkiff` the garrison would otherwise ship. `mrdSolarch`
     * and `mrdWayfarer` carry no tag; do not add a Skiff here to "help the
     * escort", because the Skiff IS the thing this operation withholds.
     */
    const armour = behind(BEARER_SETBACK, 30);
    b.formation('mrdSolarch', pact, armour.x, armour.z, 3, {
      yawDeg: home.facingDeg, spacing: 9, columns: 3, jitter: 0.5,
    });
    b.block(armour.x, armour.z, 15);
    const screen = behind(BEARER_SETBACK, -28);
    b.formation('mrdWayfarer', pact, screen.x, screen.z, 4, {
      yawDeg: home.facingDeg, spacing: 5, columns: 4, jitter: 0.6,
    });
    b.block(screen.x, screen.z, 13);

    /* ==================================================================
     * 4. ORE AND DRESSING
     * ================================================================== */
    // The standard two-army economy: one field per opening and a contested
    // patch on the centroid. It takes `b.sea`, which is null here.
    addStartOre(b, spots, b.sea);

    /*
     * `addCivilians` IS DELIBERATELY NOT CALLED, and the reason is sharper
     * here than in `pact-long-count`. `CIVILIAN_KEYS[0]` is `civOilDerrick` —
     * the SAME key this layout uses for the reading station — and the hamlet
     * puts one on the crossroads of each arm of the lane bisector, inside the
     * corridor the column walks. Two more derricks with the objective's
     * silhouette is a player walking four unarmed men to the wrong building.
     */

    // Dressed over the corridor the composition occupies rather than a square
    // on the map centre, which on this layout is nobody's ground.
    const minX = Math.min(home.x, foe.x, station.x) - 80;
    const maxX = Math.max(home.x, foe.x, station.x) + 80;
    const minZ = Math.min(home.z, foe.z, station.z) - 80;
    const maxZ = Math.max(home.z, foe.z, station.z) + 80;
    b.scatter({ minX, minZ, maxX, maxZ }, 150);

    // The opening frame: the player's yard, looking down the road the column
    // is about to walk.
    b.setCameraFocus(home.x + nx * 14, home.z + nz * 14);
    void start;
  },
});
