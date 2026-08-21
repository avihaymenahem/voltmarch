/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/allies-forced-closure.ts
 * ============================================================================
 * A5 — THE GROUND. Two buildings and three guns, all of them the Ninth's: the
 * Works computing hall that the schedule is produced on, the card store beside
 * it holding the series it is produced from, and a gun line that faces the way
 * the player is coming from and leaves exactly one wall of the hall uncovered.
 *
 * ============================================================================
 * MEASURED, ON THE WORLD THIS FILE ACTUALLY BUILDS
 * ============================================================================
 * Every figure below is read off `store.posX/posZ` after `spawnBuilding` snapped
 * each footprint to the placement grid, on a headless build at `mapSeed`
 * 20 260 935 / `simSeed` 7 042 with the def tables BOUND and this operation's
 * roster INSTALLED through `setCampaignRoster` — the only state in which either
 * is true. Unbound and unrostered the same build is a different game; the
 * control at the end of this header counts what the roster withholds.
 *
 *     thing        key             owner    landed        hp    footprint
 *     hall         civHospital     SOVIET   (202, 260)   1100     3x2
 *     store        civApartments   SOVIET   (162, 248)    800     2x3
 *     three guns   pillbox->sentryGun       (226, 246) (206, 286) (202, 234)
 *                                            480 each, `pillboxMg` at 22 m
 *
 * **FOUR OF THE FIVE LAND ON THEIR AUTHORED LITERALS AT RING ZERO**, and they
 * are written here as the coordinates the built world reports rather than as
 * nominal points the ring search then walks off — `soviets-short-allocation`
 * and `allies-misclosure` both record why, and it is the same trap: **`place`
 * returning a point is not the same as a structure standing on it**, because
 * `spawnBuilding` snaps the result to the footprint grid a second time. So the
 * search below is a CHECK on this ground rather than the mechanism that found
 * it.
 *
 * **THE CARD STORE IS THE ONE THAT DOES NOT.** It is authored at (160, 246) and
 * stands at (162, 248). This paragraph used to justify the literal by saying "a
 * 2-wide one [centres] on a cell boundary (160 = 40*4)", and that is exactly
 * the calculation `bb83ffb` invalidated: `spawnBuilding` now snaps on the FACED
 * footprint, so a 2x3 raised at a yaw that quantises to 90 is snapped on the
 * swapped 3-wide lattice, which centres on a cell CENTRE instead. The hall is a
 * 3x2 whose faced extent is 2x3 and it lands on its literal because both of its
 * axes happen to agree; the three guns are 1x1 and cannot move.
 *
 * The two openings, and they are NOT the Construction Yards:
 *
 *     start spots      (404, 132) and (108, 132)      296.00 m apart
 *     Construction     player (402, 134)              Soviet (114, 134)
 *     Yards                                           288.00 m apart
 *
 * **THIS IS THE CHAPTER'S FIRST EDGE PAIR.** `seatedSlots(2, 7042, null)` draws
 * **[1, 3]** — two corners of the same short side, 296.00 m apart — where A2 and
 * A3 draw [0, 1] and A1 and A4 draw [2, 3], and both of those are diagonals at
 * 386.16 m. Ninety metres of the approach are simply not there, and the whole
 * southern half of the map is empty ground nobody opens on. That is the shape an
 * assault wants and a defend does not: the operation's length has to come from
 * the works being hard rather than from the drive being long.
 *
 * The pair index read "[0, 2]" here and in the operation, which is not a pair
 * `dryPairs(null)` can draw at all. `seatedSlots` is pure — no terrain, no
 * profile — so the five chapter seeds were re-read straight out of it: 7014
 * [2, 3], 7021 [0, 1], 7028 [0, 1], 7035 [2, 3], 7042 **[1, 3]**. The SPOTS and
 * the 296.00 m were measured on the built world and were right all along, which
 * is why nothing downstream of the label moved.
 *
 * ============================================================================
 * THE HALL IS THEIRS, IT IS A CIVILIAN SILHOUETTE, AND BOTH DECIDE THE MATCH
 * ============================================================================
 * `civHospital` on the Soviet seat. Three consequences, and the first is the
 * operation:
 *
 *   - **`Capture.ts` RULE 2 APPLIES, SO IT CAN BE TAKEN AND THE PRICE IS
 *     EXACTLY DERIVABLE.** An enemy structure flips only at or below
 *     `CAPTURE.captureHpFrac` (0.5); above it the engineer is spent knocking
 *     `CAPTURE.softenFrac` (0.25 of max) off. **That soften is pushed through
 *     `channels.damage`**, so it lands through `ARMOR_MATRIX[HighExplosive]
 *     [Concrete]` (1.00) AND `COMBAT_DAMAGE.globalMul` (0.80) — 220 points of a
 *     1100-hp hall, 20% of max and not 25%. 1100 -> 880 -> 660 -> 440, and the
 *     FOURTH engineer captures: **2000 credits and not a shot fired.**
 *
 *     `allies-instrument-room` did that arithmetic first and used it as a reason
 *     to keep A2 OFF this path — *"a reason to keep this operation off that path
 *     rather than to build a premise on a number nothing pins"*. A5 is the
 *     operation that pays it on purpose, and the number is pinned by the same
 *     three constants read the same way.
 *   - **IT IS NOT REBUILDABLE AND IT IS NOT A PRODUCER.** `civHospital` carries
 *     no role flag (`Scenarios.ts#civilian` strips `Sellable` and composes the
 *     flag set explicitly so `GarrisonService` will not call it a production
 *     structure), so `AiBrain.census` files it under nothing, and no sidebar in
 *     the game offers one. A levelled hall is levelled for good, which is what
 *     makes "take it whole" a decision rather than a preference.
 *   - **THE NINTH WILL MEND IT, AND THE FIRST SOFTEN DOES NOT ARM THE WRENCH.**
 *     `AiBrain.repairBase` walks every building the seat owns with no proximity
 *     filter and takes the worst STRICTLY BELOW `AI_REPAIR.startFraction`
 *     (0.75). 880/1100 is 0.80 and is not a candidate; 660/1100 is 0.60 and is.
 *     At `REPAIR_RATE` 30 hp/s and `REPAIR_COST_PER_HP` 0.25, a hall left at 440
 *     is back to full in **22.0 seconds for 165 credits**. The engineers travel
 *     with the attack or they are 2000 credits of nothing —
 *     `reclamation-written-off` records the same finding about its sorting
 *     station, and nothing in the trigger table enforces it because the brain
 *     already does.
 *
 * **DECLARED, BECAUSE THIS IS THE FOURTH INSTANCE OF THE CAPTURE-CURSOR FAMILY
 * AND IT IS THE WORST-SHAPED ONE.** `pact.03.concession` records the Gaia
 * version — right-click a neutral structure with a `canCapture` unit selected
 * and the unit is consumed. There is no Gaia structure on this ground, and the
 * failure here is a different one:
 *
 *   - `CaptureService.isCapturable` (`src/sim/Capture.ts`) HAS NO HEALTH GATE.
 *     It checks kind, Alive, PendingDestroy, UnderConstruction, ownership and
 *     the veto list, and nothing else — the half-health rule lives in `resolve`,
 *     which the cursor never reaches.
 *   - `resolveContextOrder` (`src/input/Commands.ts`) paints `CursorKind.Capture`
 *     whenever `caps.canCapture` is true and `capturableNow(world, hover)` is
 *     true, and **`caps.canCapture` is an OR over the WHOLE selection**.
 *   - The player owns an engineer from t=0. Measured on this build with the
 *     roster armed, the opening army is 4 Wardens, 5 G.I.s, **1 engineer** and
 *     2 harvesters.
 *
 * So Ctrl+A and a right-click on a FULL-HEALTH 1100-hp hall shows the green
 * capture glyph — and the per-unit demotion in `Commands.ts` then rewrites every
 * non-engineer in that selection to `OrderKind.Attack` on the same building. The
 * glyph says "take it" and the order levels it: 4 x `lightCannon` at 16.13 plus
 * 5 x `rifle` at 7.55 is 102.28 dps on Concrete, so the medal is gone in 10.8
 * seconds and `t.win` fires inside the same window.
 *
 * **NOTHING IN THE LAYOUT CAN FIX IT** — a Gaia hall was already costed and cut
 * (one engineer would take it at any health and the whole fork evaporates), and
 * the vocabulary has no effect that touches a cursor. The operation answers it
 * where it can be answered, in prose: `t.cursor` at fifty-eight seconds names
 * the failure mode before the player has driven anywhere. `civHospital`'s
 * `Sellable`-stripped flag set is what makes the hall a pure capture target in
 * the first place, and it is the same property that leaves this exposed.
 *
 * **`civHospital` RATHER THAN THE OTHER THREE CIVILIAN SILHOUETTES.** It is the
 * widest of them — 12x8 m under a 10 m roofline — which is what a hall of
 * integrators and card frames reads as; `allies-instrument-room` spent
 * `civApartments` on a survey office and A4 spent it on a transmitter block, so
 * the store below is the third use of that silhouette in one chapter and the
 * hall is deliberately not a fourth.
 *
 * ============================================================================
 * THE GUN LINE IS ANTI-INFANTRY, AND THE WEST WALL IS THE DOOR
 * ============================================================================
 * Three `pillbox` keys, which `ScenarioBuilder.keyFor` turns into **Sentry
 * Guns** on a Soviet seat: 480 hp, `pillboxMg` at 22 m, `power: 0`, so they
 * cannot be browned out with the rest of the district. 1200 credits of concrete.
 *
 * **THEY ARE NOT THERE TO STOP THE TANKS AND COULD NOT.** Through the shipped
 * tables (`DEFAULT_WEAPONS`, `ARMOR_MATRIX`, `COMBAT_DAMAGE.globalMul` 0.80,
 * re-derive rather than re-quote after any retune) `pillboxMg` is 5x13 over a
 * (5-1)*0.06 + 0.55 = 0.79 s cycle = 82.28 raw:
 *
 *     vs Infantry  x1.00 -> 65.83 dps   a 90-hp engineer dies in  1.37 s
 *     vs Medium    x0.28 -> 18.43 dps   a 340-hp Warden lasts    18.4 s
 *
 * A Warden answers with `lightCannon` 55 AP / 1.5 s = 36.67 raw, and AP against
 * Concrete is 0.55, so it puts **16.13 dps** on a gun and needs 29.8 s to break
 * one alone or 7.4 s with four. So the line is a real cost to armour and an
 * absolute wall to an unarmed man, which is the whole point: the operation's
 * medal is walking a 90-hp engineer to the wall of the hall.
 *
 * **WHICH WALL, MEASURED — AND THE ENGINEER'S RADIUS IS 0.234, NOT 0.7.**
 * `CaptureService.withinReach` is a RECTANGLE test — `max(0, |dx| - halfW)`
 * against `CAPTURE.reachMetres` (2.2) plus the engineer's own `st.radius` — and
 * that radius is `hullRadius(U.infantry)` = `max(0.52, 0.52) * 0.45` =
 * **0.234**, so the reach is 2.434 m and for a 3x2 footprint the stands are
 * **8.434 m out in x and 6.434 m out in z**. This paragraph used 8.9 / 6.9,
 * i.e. an engineer three times its real size, and correcting it moved every
 * distance below by up to half a metre and in BOTH directions — the three
 * covered stands got further from their gun, the three western ones closer.
 * Nearest gun to each, read off the built world:
 *
 *     east    (210.43, 260.00)   20.94 m   COVERED
 *     north   (202.00, 253.57)   19.57 m   COVERED
 *     south   (202.00, 266.43)   19.97 m   COVERED
 *     west    (193.57, 260.00)   27.33 m   open
 *     west-NW (193.57, 256.00)   23.56 m   open, and see below
 *     west-SW (193.57, 264.00)   25.27 m   open
 *
 * COVERED means the gun can FIRE, and that threshold is `pillboxMg`'s 22 plus
 * the engineer's own 0.234 = **22.234 m**, by the same `flat - hitRadius(target)`
 * rule the tank paragraph below turns on. `Targeting` ACQUIRES further out —
 * `22 * COMBAT_TARGETING.acquireRangeMul` + 0.234 = **23.99 m** — so an engineer
 * on the west-NW stand at 23.56 m is inside the acquisition circle and outside
 * the firing one: the gun slews onto him and never pulls the trigger. That is
 * the one stand where the two circles disagree, and it is worth knowing before
 * anybody reads a turret tracking their engineer as a bug.
 *
 * All six are Foot-passable. **One face of four, and it is the one that turns
 * your back on the hall and looks at their yard** — the west stand is 149.02 m
 * from the Soviet Construction Yard, with the card store between them at
 * 123.69 m from that yard and 41.76 m from the hall.
 *
 * **AND THE SAME LINE IS A REAL TOLL ON A TANK — WHICH IS THE OPPOSITE OF WHAT
 * THIS PARAGRAPH USED TO SAY.** It read *"barely inconveniences a tank ...
 * 8.2 m, which is 1.2 s"*, and the ban radius under that figure was wrong.
 * `Combat.engage` fires when
 * `max(0, flat - hitRadius(footprintW, footprintH, radius)) <= w.range`, so a
 * gun does not stop at its own 22 m: it reaches 22 m PAST THE VICTIM'S HULL. A
 * Warden carries `radius = hullRadius(U.lightTank) = max(6.20, 3.10) * 0.45` =
 * **2.79** (`footprintW` is 0 for a unit, so `hitRadius` returns `radius`
 * unchanged), which puts the circle a Warden must stay out of at **24.79 m** —
 * not 22, and not the 24 this paragraph used to name. Acquisition is 22 x 1.08
 * + 2.79 = **26.55 m**.
 *
 * INSTRUMENT: 8-connected Dijkstra, octile step (4 m orthogonal, 5.657 m
 * diagonal), no corner cutting, source = the nearest open cell to the player's
 * Construction Yard at (402, 134), destination = any open cell inside a Warden's
 * standoff ring — `lightCannon` 24 m plus the hall's own `hitRadius`
 * `sqrt(6^2 + 4^2)` = 7.211 m, so 31.211 m from the centre, 173 such cells. Run
 * twice, on `Terrain.passGrid` for `Locomotor.Track` (terrain only) and on
 * `FlowFieldCache.costGridFor(MoveClass.Track)` (structures and the clearance
 * rule in): **identical to the decimetre both ways**, so occupancy is not the
 * confound.
 *
 *     ban radius                          arc-free   detour   at 6.6 m/s
 *     none                                 223.4 m        —            —
 *     22.00  the gun's printed range       234.0 m   +10.6 m       1.6 s
 *     24.00  this paragraph's old figure   236.3 m   +13.0 m       2.0 s
 *     24.79  THE ENGINE'S OWN TEST         291.8 m   +68.4 m      10.4 s
 *     26.55  acquisition                   298.1 m   +74.7 m      11.3 s
 *
 * **THE COST JUMPS 5.3x ACROSS FOUR TENTHS OF A METRE**, between 24.0 and 24.4,
 * which is exactly how reading the gun's printed range gave an answer eight
 * times too small. On that same ring 11 of 16 bearings sit inside 24.79 m of a
 * gun (10 inside 22.00, 13 inside 26.55), which is the one figure in this
 * paragraph the correction did NOT move.
 *
 * So a player who wants the hall in rubble and will not trade with the line pays
 * **68.4 m, ten and a half seconds** — or drives into the guns and trades. A
 * player who wants it whole still pays more, because the price there is not
 * metres: it is walking a 90-hp man to a wall.
 *
 * ============================================================================
 * `ROAD` AND `SPUR` ARE RINGS, NOT POINTS
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, and `ProductionService.spawnUnit` writes that position
 * VERBATIM — no `connectedGround`, no egress search of any kind, unlike
 * `ScenarioBuilder.spawnUnit`, which this file uses and which does search. So
 * what this file owes the trigger table is GROUND rather than a point, and on
 * `arid` — `cliffs` 0.55, the steepest cliff fraction of any preset — that is
 * not a formality:
 *
 *     ROAD   (150, 190)   66.57 m from the Soviet yard, 87.2 m straight and
 *                         85.5 m of Track route to the hall.
 *                         **709 of 709 two-metre samples within 30 m are
 *                         passable to Foot AND Track** on terrain alone; with
 *                         occupancy folded in it is 705 of 709.
 *     SPUR   (136, 240)   27.20 m from the store, 68.96 m straight and 74.6 m
 *                         of Track route to the hall, 108.26 m from their yard.
 *                         404 of 441 samples within 24 m passable; every point
 *                         of both authored rings (4 at 16 m, 2 at 11 m) clear.
 *     MUSTER (398, 198)   64.12 m behind the player's Construction Yard.
 *                         **317 of 317 samples within 20 m passable**, and the
 *                         Foot route from here to a capture stand is 212.9 m to
 *                         the nearest face and **231.2 m to the WEST one** —
 *                         68.0 s at an engineer's 3.4 m/s, and the west face is
 *                         the only one he can survive standing on.
 *
 * **EVERY ROUTE ABOVE ENDS AT THE NEAREST FREE CELL TO THE TARGET, AND THE
 * OFFSET IS PART OF THE FIGURE**: 6.00 m off the hall's centre, 2.05 m off a
 * west-side stand, 0.43 m off the north and south ones. Descent and
 * cheapest-predecessor chains agree on all of them, and `Terrain.passGrid` with
 * occupancy and `FlowFieldCache.costGridFor(Track)` return the same metres.
 *
 * **THREE OF THOSE FIGURES MOVED SINCE THEY WERE WRITTEN AND THE CAUSES ARE
 * DIFFERENT.** ROAD's 82.2 was quoted "to the hall's FOOTPRINT" while the other
 * two rows were quoted to a cell; on one convention for all three it is 85.5.
 * SPUR's 64.3 became 74.6 because the card store moved (+2, +2) into its
 * corridor. And 219.2 is what this same instrument returns for MUSTER to the
 * HALL's own nearest free cell, not to the west stand, which is 231.2 — the
 * two were transposed. The nearest-face figure, 212.9, reproduces exactly, and
 * so does MUSTER's 64.12 m off the yard; those two are the controls that give
 * the instrument standing to correct the other three.
 *
 * **THE FOUR ROUTE FIGURES ABOVE WERE RE-DERIVED, AND THREE OF THEM MOVED.**
 * They read 95.9 / 73.3 / 228.2 and were taken with an instrument this file
 * never named. On the one it names now — the octile Dijkstra specified in the
 * gun-line paragraph, run on `Terrain.passGrid` and on
 * `FlowFieldCache.costGridFor` with identical results — they are 85.5 / 74.6 /
 * 212.9. A fourth definition was tried and rejected as the possible source of
 * the old numbers: the METRIC LENGTH of the least-COST path, i.e. what a flow
 * field actually drives rather than what is shortest, which would legitimately
 * run longer over rough ground. It does not here — it returns 85.5 / 74.6 /
 * 212.9 as well, because this ground carries no road and almost no rough. Three
 * definitions agree with each other and none reproduces the old figures, which
 * also erred in BOTH directions (the tank route was quoted 8 m short while these
 * three were quoted 9 to 15 m long), so they are replaced rather than reconciled.
 *
 * **THE FIRST SPUR WAS AT (166, 278) AND IT WAS RUBBLE.** 25.2% of a 24 m disc
 * passable and FIVE of its six authored ring points on closed cells — all four
 * Conscripts and one of the two Anvils. It was chosen by reading the map — west
 * of the works, on the open side — which is exactly the mistake `types.ts`
 * records costing four operations eighteen drops.
 * The ground west of the hall is broken; the ground west of the STORE is not.
 * `tests/campaign-spawn-ground.spec.ts` is the gate, and it checks every point
 * of every wave against that wave's own locomotor.
 *
 * **`SPUR` IS A SECOND BEARING AND THAT IS ITS WHOLE JOB.** `AiBrain` sends its
 * own army out of its own yard, so a scripted column arriving from the same
 * place buys the operation nothing — `allies-instrument-room` says so about its
 * relief and `soviets-common-standard` about its valley road. This one comes off
 * the store, which is to say it comes through the one face the gun line does not
 * cover, at the moment the player commits to the works.
 *
 * ============================================================================
 * ECONOMY, AND WHY THERE IS NO AUTHORED FIELD
 * ============================================================================
 * `addStartOre` and nothing else. It lays one home field per opening and one
 * contested patch on the centroid of the two, which on this edge pair is a point
 * on the lane rather than the map centre:
 *
 *     (386,  88) r30    home, 46.0 m from the player's yard, 251.87 m from the hall
 *     (126, 176) r30    home, 45.6 m from the Soviet yard,   113.28 m from the hall
 *     (256, 132) r22    contested, on the lane, 138.92 m from the hall
 *
 * **THE PLAYER'S ORE IS 251.87 m FROM THE OBJECTIVE AND THE NINTH'S IS 113.28**,
 * and both numbers are load-bearing. The far one means an untagged
 * `unitsInArea` over the works cannot be tripped by a harvester — the operation
 * uses one, and `reclamation-written-off` records the same check for the same
 * reason. The near one means the Ninth's economy is on the way to the works, so
 * a player who drives at the hall is inside their harvest without any trigger
 * saying so.
 *
 * **NO `addCivilians`.** It hangs capturable derricks off the perpendicular
 * bisector and walks `MINE_BISECTOR_OFFSETS` out for an ore mine — four more
 * neutral structures in the middle of a map whose whole subject is which two
 * buildings matter, and one of them a capture target that is not the capture
 * target. `allies-misclosure`, `soviets-short-allocation` and
 * `allies-ground-truth` all skip it, and here it would actively mislead: the
 * operation's medal is a capture, and putting four other capturable things on
 * the map makes the engineer section a menu rather than an order.
 *
 * ============================================================================
 * WHAT THE EMPTY ROSTER ACTUALLY WITHHOLDS, MEASURED
 * ============================================================================
 * Two builds, identical except for `setCampaignRoster`:
 *
 *     seat            with the roster                cleared (the control)
 *     player          35 entities                    39
 *     Soviets         42 entities                    49
 *
 *     the player loses   2 Sabre IFVs, a Proving Ground and a Refractor Tower
 *     the Soviets lose   1 Sledge Tank, 2 Attack Dogs, a Proving Ground
 *                        and THREE Tesla Coils
 *
 * With the roster in force the openings are:
 *
 *     player     5 G.I., 4 Warden Tanks, 1 engineer, 2 harvesters
 *                24 structures — yard, refinery, war factory, barracks, radar,
 *                4 power plants, 2 silos, 3 Pillboxes, 10 wall segments
 *     Soviets    6 Conscripts, 5 Anvil Tanks, 2 harvesters
 *                24 structures of base — yard, refinery, war factory, barracks,
 *                radar, 6 power plants, 2 silos, 2 Flame Towers, 10 wall
 *                segments — plus the hall, the store and three Sentry Guns
 *
 * Power on the same build: the player at 400 produced against 170 consumed, the
 * Soviets at 600 against 210. **Nothing at the works draws any**, because
 * `sentryGun` and both civilian silhouettes are `power: 0` — so no brownout
 * anywhere in the district can silence the line the operation is priced against,
 * and no player action on their power plants is a shortcut to the hall.
 *
 * **THE SOVIET HALF OF THE ROSTER IS THE LOAD-BEARING ONE, AND IT IS ABOUT THE
 * DOOR.** `teslaCoil` is `struct.defence.specialist` and reaches 30 m. Every
 * structure at the works is theirs, and `Placement.withinBuildRadius` gives a
 * finished non-builder structure `PLACEMENT.adjacencyRadius` 20 m plus its own
 * radius — so the Ninth can found one within about 26 m of the hall, which is
 * every square metre of all four capture stands including the west one. Granted,
 * the brain could shut the door this operation is made of, on a decision no
 * author can see. Withheld, the longest structure weapon either army can put on
 * that ground is `pillboxMg` at 22 m, which is the three guns already standing.
 *
 * The player's half follows from the same allow-list rather than from
 * generosity, and it is the right shape here: a Refractor Tower needs a Proving
 * Ground first, which is two unlock ids, 2400 credits and -110 power spent on a
 * static gun inside an operation whose objective is 236.38 m away. It is also
 * SYMMETRIC and profile-independent, so the ground is the same on a finished
 * account as on a fresh one, which a deny-list could not promise.
 *
 * ============================================================================
 * NO TRIGONOMETRY, NO ROTATION, NO PROFILE, NO CLOCK
 * ============================================================================
 * Every authored point here is an integer literal and every search offset is an
 * integer. ECMA-262 pins `+ - * /` and `Math.sqrt` to bit precision and pins
 * `sin`/`cos`/`atan2` to nothing at all; a layout runs independently on both
 * machines of a lockstep match, so a table built by trig is a tick-zero desync
 * waiting for two engines to disagree in the last mantissa bit. `rotateStarts`
 * is not called either — an operation pins its seed, so the rotation is a moving
 * part with exactly one value.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `hall`   — the computing hall, SOVIET-owned. Read by `ownerCount` (the
 *            primary, which capture and demolition satisfy alike), by
 *            `structureCaptured` (the medal) and by `entityDead` and
 *            `entityHpBelow` (the two lines that mark the capture window).
 * `store`  — the card store, SOVIET-owned. Read by `ownerCount` only, which is
 *            why it is not a `protectedTag` and the works disc may sit 41.76 m
 *            from it — see `tests/campaign-zone-safety.spec.ts`.
 * `watch`, `col1`, `col2`, `col3` — the Ninth's four columns, and `section` —
 *            the player's four engineers. All five are produced by `spawnUnits`
 *            in the trigger table and never by this file. Declared anyway, so a
 *            reader asking where the pressure and the gift come from finds the
 *            answer in the file that owns the ground; `validateCampaign` and
 *            `tests/campaign-maps.spec.ts` both know a spawned tag is not the
 *            layout's to place.
 *
 * The three Sentry Guns are deliberately UNTAGGED. No trigger reads them, and a
 * tag nothing reads is a claim `tests/campaign-maps.spec.ts` would have to prove
 * for no purpose.
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
 * somewhere. This module owns them and `operations/allies/05-forced-closure.ts`
 * imports them; the dependency runs operation -> layout and never back. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a reveal framing empty ground, a column ordered at a
 * building that is not there — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The player's START SPOT at `mapSeed` 20 260 935 / `simSeed` 7 042.
 *
 * `seatedSlots(2, 7042, null)` draws the EDGE pair [1, 3] — 296.00 m, against
 * the 386.16 m diagonals every other operation in this chapter sits on. This is
 * a literal rather than a call to `startSpots` because the OPERATION has to name
 * world points in static data; `build` seats both bases from the real
 * `startSpots` and warns if the two ever stop describing one world. **It is not
 * the Construction Yard** — that lands at (402, 134) — and every distance in
 * this header is quoted against the yard, not against this.
 */
const HOME: Point = { x: 404, z: 132 };
/** The Soviet start spot at the same seeds. Their yard lands at (114, 134). */
const FOE: Point = { x: 108, z: 132 };

/**
 * The Works computing hall — the model. SOVIET-owned, 1100 hp, and the primary.
 * Lands on this literal at ring zero: 236.38 m from the player's Construction
 * Yard and 153.69 m from theirs.
 */
export const HALL: Point = { x: 202, z: 260 };

/**
 * The card store — eleven years of the eastern arc on punched card, which is
 * what the forced run is being run AGAINST. SOVIET-owned, 800 hp, standing at
 * (162, 248) rather than on this literal — see the header — 41.76 m from the
 * hall on the bearing their own yard is on, and 123.69 m from that yard.
 */
export const STORE: Point = { x: 160, z: 246 };

/**
 * Where the Ninth's timed columns form. 66.57 m off their own Construction Yard
 * and 85.5 m of Track route from the hall — 15.8 s at an Anvil's 5.4 m/s and
 * 24.2 s at a Conscript's 3.4, so a column arrives spread rather than as a fist.
 */
export const ROAD: Point = { x: 150, z: 190 };

/**
 * Where the works' own watch turns out, off the card store, 68.96 m from the
 * hall straight and 74.6 m of Track route. A SECOND BEARING — it comes through
 * the west face, which is the one the gun line does not cover and the one an
 * engineer has to use.
 */
export const SPUR: Point = { x: 136, z: 240 };

/**
 * Where the Works send the engineer section, 64.12 m behind the player's yard on
 * ground no column crosses. The Foot route from here to the WEST capture stand —
 * the only face of the hall an engineer can survive standing on — is 231.2 m,
 * which is 68.0 s of walking at 3.4 m/s before anything is shot at. The nearest
 * face is 212.9 m, and it is the one the gun line covers. (219.2 m, which this
 * comment used to carry, is the route to the HALL's own nearest free cell; see
 * the header.)
 */
export const MUSTER: Point = { x: 398, z: 198 };

/**
 * The briefing reveal over the works. **34 m, NOT 44**, and the four metres are
 * the point: it covers the hall and all three guns (the furthest is 27.78 m) and
 * stops short of the store at 41.76 m, so the second beat's reveal of the store
 * is a reveal rather than a no-op. `revealArea` is `Vision.exploreCircle` and is
 * PERMANENT; `soviets-demolition-order` records the same trap for its two feeder
 * plants.
 */
export const WORKS_AREA: Area = { x: HALL.x, z: HALL.z, r: 34 };

/** The store, revealed one beat later. 26 m covers its footprint and its yard. */
export const STORE_AREA: Area = { x: STORE.x, z: STORE.z, r: 26 };

/**
 * The disc the works' own watch answers to.
 *
 * **CENTRED ON THE HALL, WHICH IS WHAT MAKES IT LEGAL.**
 * `tests/campaign-zone-safety.spec.ts` refuses a player `unitsInArea` disc that
 * sits inside a player weapon's engagement envelope of a tag some trigger needs
 * ALIVE — and `hall` is such a tag, because `t.intactLost` fails a secondary on
 * `entityDead` for it. The exception that file names is a disc which CONTAINS
 * the entity, on the grounds that standing on the thing is what the objective
 * asked for. This one contains it at distance zero.
 *
 * 40 m so it holds the hall, all three guns and the ground a column would form
 * up on, and stops 4.27 m short of the store — the watch answers to the works,
 * not to a hull that wandered past the card sheds.
 */
export const WORKS: Area = { x: HALL.x, z: HALL.z, r: 40 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/**
 * The three guns, as plain world offsets from the hall.
 *
 * EAST, SOUTH AND NORTH — the three faces a player arriving from (402, 134) can
 * reach without crossing the works — and nothing on the west. The header carries
 * the measured stands; the short version is that the east, north and south
 * capture stands are 19.57 to 20.94 m from a gun and the three western ones are
 * 23.56 to 27.33 m from the nearest, against an engineer's firing circle of
 * 22.234 m.
 *
 * THREE RATHER THAN FOUR, AND THE REJECTION HAD TO BE RE-ARGUED FROM SCRATCH.
 * It used to read that a fourth gun on the south-east shoulder "took the
 * arc-free tracked route from +8.2 m to +63.7 m", i.e. that it priced out the
 * SHELLING route and was therefore a change to the wrong thing. Both halves of
 * that were wrong, because the baseline was taken against the wrong reach — see
 * the header. Re-measured on the instrument the header names, with the fourth
 * gun tried at three south-east shoulders, (226, 282), (222, 280) and
 * (228, 274), all three giving the same answer:
 *
 *     three guns   arc-free 291.8 m (+68.4)   standoff coverage 11 of 16
 *     four guns    arc-free 291.8 m (+68.4)   standoff coverage 12 of 16
 *
 * **A FOURTH GUN ON THAT SHOULDER BUYS ZERO METRES.** The three-gun detour
 * already runs the long way round the works, and the fourth sits on ground that
 * detour never touches — so it moves one bearing on a ring nobody has to stand
 * on, for 400 credits of concrete. It is cut because it does NOTHING, which is a
 * different reason from the one this comment used to give.
 *
 * THE GUN THAT WOULD DO SOMETHING IS A WEST ONE, and that is the real content of
 * "three". A fourth at (178, 260) or at (182, 246) covers **all six capture
 * stands** and leaves **no arc-free firing position at all** — the same Dijkstra
 * returns unreachable, because the ban circles close the last gap. One placement
 * shuts both doors: the medal and the shelling route together. Three guns is the
 * set that closes three of the four faces an engineer can use, leaves the west
 * one open, and prices the tanks at a detour rather than at a wall.
 */
type Offset = readonly [dx: number, dz: number];
const HALL_GUNS: readonly Offset[] = [[24, -14], [4, 26], [0, -26]];

/** Rings searched outward for a legal footprint, in metres. Nearest first. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/**
 * Metres reserved around the hall so `scatter` leaves every capture stand clear.
 *
 * 22 m, which is 13.6 m past the west stand at 8.434 m out — a boulder dropped
 * on the one face an engineer can use would delete the medal silently, and
 * `Scatter` knows nothing about capture geometry.
 */
const HALL_CLEAR = 22;
const STORE_CLEAR = 16;
const GUN_CLEAR = 10;

/* ==========================================================================
 * 3. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'allies-forced-closure',
  tags: ['hall', 'store', 'watch', 'col1', 'col2', 'col3', 'section'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which `startPointsFor` puts at the map centre on every continent. If that
     * ever stops being true, this file is dressing ground the trigger table is
     * not naming — and it would be invisible, because every tag would still land
     * and every gate would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] allies-forced-closure built on (${String(cx)}, ${String(cz)}), not the map `
        + `centre (${String(CENTRE)}, ${String(CENTRE)}) — the works is authored in absolute `
        + 'coordinates and will not line up with the openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);
    const home = spots[0];
    const foe = spots[1] ?? spots[0];

    /*
     * AND THE OTHER HALF OF THE SAME GUARD. `HOME` and `FOE` are literals
     * because the trigger table needs world points as static data; `build` seats
     * the bases from the real `startSpots`. A generator change that slid an
     * opening would move the BASES and leave the hall, the store and the guns
     * exactly where they are — and `MUSTER`, 64.12 m behind the yard, is the one
     * with the least room to absorb it. Four metres is one cell.
     */
    if (Math.abs(home.x - HOME.x) > 4 || Math.abs(home.z - HOME.z) > 4
      || Math.abs(foe.x - FOE.x) > 4 || Math.abs(foe.z - FOE.z) > 4) {
      console.warn(
        `[allies-forced-closure] openings moved: player (${String(home.x)}, ${String(home.z)}) and `
        + `foe (${String(foe.x)}, ${String(foe.z)}) against the authored (${String(HOME.x)}, `
        + `${String(HOME.z)}) and (${String(FOE.x)}, ${String(FOE.z)}). Every distance in this `
        + 'layout and every reveal in the operation is measured against the authored pair — '
        + 're-measure.',
      );
    }

    /* -- placement --------------------------------------------------------
     * Ground a footprint can legally stand on: `footprintBuildable` AND
     * `footprintClear`, searched in rings with a fixed traversal order so two
     * runs of one seed build the same world.
     *
     * `findClearFootprint` ALONE ANSWERS THE WRONG QUESTION — it tests occupancy
     * and connectivity and nothing about grade, which is how `soviets-first-tap`
     * came to ship seven structures on ground `isBuildable` refuses. It is kept
     * as the fallback and nothing on this ground reaches it: all five buildings
     * are accepted at ring zero.
     */
    const scratch = new Float32Array(2);
    const place = (owner: PlayerId, key: string, p: Point): Point => {
      const f = b.footprintOf(b.keyFor(owner, key));
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

    const raise = (
      owner: PlayerId, key: string, where: Point, tag: string | null, yawDeg: number, clear: number,
    ): EntityId => {
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      if (tag !== null) c.tag(tag, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return id;
    };

    /* -- the two openings -------------------------------------------------- */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the works --------------------------------------------------------
     * SOVIET-OWNED, both of them, and that is the operation rather than a
     * flavour choice: `ScenarioBuilder.gaia` allies the Neutral slot to
     * everybody in both directions, so a Gaia hall could be captured by one
     * engineer at any health (`Capture.ts` rule 1) and the whole take-or-break
     * decision would evaporate. On their seat it is rule 2 — four engineers, or
     * 550 points of shellfire and one.
     *
     * NO `unlockedBy` ON EITHER KEY, WHICH IS LOAD-BEARING UNDER AN EMPTY
     * ROSTER. `spawnBuilding` consults the progression gate, so a tagged key
     * here would return `NONE`, the tag would land on nothing, and
     * `ownerCount(max: 0)` — which is the primary — would read TRUE from tick
     * one and WIN the operation before the briefing finished. `civHospital`,
     * `civApartments` and `sentryGun` are all untagged, and
     * `tests/campaign-roster-ground.spec.ts` builds this operation with the
     * roster armed and the def tables bound, which is the only state that can
     * see the difference.
     */
    raise(them, 'civHospital', place(them, 'civHospital', HALL), 'hall', 0, HALL_CLEAR);
    raise(them, 'civApartments', place(them, 'civApartments', STORE), 'store', 90, STORE_CLEAR);

    /*
     * The gun line. EMPLACEMENTS RATHER THAN PARKED HULLS, and that is
     * structural: `AiBrain.census` files every untagged, non-harvester hull an
     * AI seat owns into `armyIds` and `regroupSquads` drives it to the rally
     * point on the next brain pass — measured on `soviets.02.common-standard` at
     * 116.6 m and 129.2 m off the post inside twenty seconds. A Sentry Gun
     * cannot be re-tasked, and `AiBrain` has no `issueSell` either, so the only
     * thing that takes one off the works is the player shooting it.
     */
    for (const [gx, gz] of HALL_GUNS) {
      const g = { x: HALL.x + gx, z: HALL.z + gz };
      raise(them, 'pillbox', place(them, 'pillbox', g), null, 0, GUN_CLEAR);
    }

    /* -- economy and dressing ---------------------------------------------- */
    addStartOre(b, spots, b.sea);

    /*
     * Open on the yard looking down the lane, biased 13% toward the map centre —
     * the same bias `allies-sounding-line` and `allies-misclosure` use — so the
     * first thing on screen is the ground the operation will be fought over
     * rather than the back wall of the player's own base.
     */
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
