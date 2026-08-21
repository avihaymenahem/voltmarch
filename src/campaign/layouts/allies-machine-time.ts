/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/allies-machine-time.ts
 * ============================================================================
 * A6 — THE GROUND. A tramway, and three things standing on it that belong to
 * three different people: the Works computing hall at the near end with the
 * reduction running in it, six feeder houses that belong to nobody, and the
 * Reclamation's load meter at the far end under a post.
 *
 * ============================================================================
 * MEASURED, ON THE WORLD THIS FILE ACTUALLY BUILDS
 * ============================================================================
 * Every figure below is read off `store.posX/posZ` after `spawnBuilding` snapped
 * each footprint to the placement grid, on a headless build at `mapSeed`
 * 20 260 942 / `simSeed` 7 049 with the def tables BOUND and this operation's
 * roster INSTALLED through `setCampaignRoster` — the only state in which either
 * is true. Unbound and unrostered the same build is a different game; the
 * control at the end of this header counts what the roster withholds.
 *
 *     thing        key             owner    landed        hp    footprint
 *     hall         civHospital     PLAYER   (162, 332)   1100     3x2
 *     house 1      civApartments   GAIA     (216, 290)    800     2x3
 *     house 2      civApartments   GAIA     (240, 266)    800     2x3
 *     house 3      civApartments   GAIA     (268, 246)    800     2x3
 *     house 4      civApartments   GAIA     (296, 222)    800     2x3
 *     house 5      civApartments   GAIA     (332, 194)    800     2x3
 *     house 6      civApartments   GAIA     (360, 170)    800     2x3
 *     meter        civOreMine      RECLAM   (376, 188)    700     2x2
 *     three posts  pillbox->rclSpitpost   (282, 206) (318, 178) (390, 198)
 *                                          520 each, `postCoil` at 20 m
 *
 * **ALL EIGHT LAND ON THEIR AUTHORED LITERALS AT RING ZERO**, and they are
 * written here as the coordinates the built world reports rather than as nominal
 * points the ring search then walks off — `soviets-short-allocation`,
 * `allies-misclosure` and `allies-forced-closure` all record why, and it is the
 * same trap: **`place` returning a point is not the same as a structure standing
 * on it**, because `spawnBuilding` snaps the result to the footprint grid a
 * second time. Every literal here is already on that grid — a 2-wide footprint
 * centres on a cell boundary (216 = 54*4) and a 3-high one on a cell centre
 * (290 = 72*4 + 2) — so the search below is a CHECK on this ground rather than
 * the mechanism that found it.
 *
 * The two openings, and they are NOT the yards:
 *
 *     start spots   (108, 380) and (404, 132)       386.16 m apart
 *     yards         player (114, 382) `conyard`
 *                   Reclamation (402, 134) `rclFoundry`
 *
 * **THE RECLAMATION'S CONSTRUCTION YARD IS `rclFoundry`, NOT `rclBreakerYard`.**
 * `Defs.ts` sets `conYardKey: 'rclFoundry'` for that army and the Breaker Yard's
 * own blurb reads "Builds every Reclamation hull" — it is the WAR FACTORY, and
 * it stands at (400, 158). This row named the war factory as the yard, and gave
 * it the coordinate (414, 148) that the war factory itself had before `bb83ffb`
 * rebuilt the procedural bases on the placement grid. Two defects on one line,
 * and every "from the Reclamation yard" figure in this file was measured to
 * that point. They are quoted to the FOUNDRY below, with the Breaker Yard's own
 * figure beside each, because a reader coming from the old text will be looking
 * for the second one.
 *
 * `seatedSlots(2, 7049, null)` draws **[0, 1]** — a DIAGONAL pair at 386.16 m,
 * the longest opening the two-army table offers, against
 * `allies-forced-closure`'s 296.00 m edge pair. That is the shape a capture-hold
 * wants and an assault does not: the operation's length has to come from the
 * LINE, and a long lane is what makes six houses at thirty-four to forty-six
 * metre spacing a line rather than a cluster.
 *
 * ============================================================================
 * THE LINE IS STRAIGHT AND THE GROUND IS WHAT MADE IT IRREGULAR
 * ============================================================================
 * The six houses project onto the lane at **140.6, 174.4, 208.7, 245.6, 291.2
 * and 328.0 m** from the player's opening, so the gaps are 33.8, 34.3, 36.9,
 * 45.6 and 36.8 — not a ruler. What IS regular is the offset: every house lies
 * within **2.61 m of one straight bearing** (house 2 is the worst at -2.61 m,
 * house 3 the best at +0.04), and the hall sits on the same bearing 72.2 m out
 * at -2.11. Six identical blocks strung on one line is what makes a tramway read
 * as a tramway; the spacing is whatever `Terrain.isBuildable` allowed.
 *
 * **THE IRREGULARITY IS TWO DEAD BANDS, MEASURED RATHER THAN GUESSED.** The
 * corridor was scanned every 5 m from 80 to 330 m out for a 2x3 footprint on the
 * `x % 4 == 0, z % 4 == 2` lattice within 8 m of the lane, requiring all four
 * capture stands Foot-passable as well. Two stretches carry NO legal site at
 * all:
 *
 *     110 m .. 125 m out     nothing fits
 *     260 m .. 280 m out     nothing fits
 *
 * Everything between 130 and 255 m is wide open, and that is not luck either: it
 * is the map-centre shelf `startPointsFor` reserves on every continent, so that
 * band is flat on every roll of this preset. The two ENDS are the parts that
 * move between seeds, which is exactly what the operation's own five-roll sweep
 * found — every structure that slid in it was the hall, house five, house six or
 * the meter, and never one of the middle three.
 *
 * ============================================================================
 * THE LINE IS A TUG OF WAR AND HOUSE TWO IS THE KNOT
 * ============================================================================
 * The same octile Dijkstra, run from both openings — Foot from the player's,
 * because engineers are what take a house, and Wheel from the Reclamation's,
 * because every ground hull that army fields is `Locomotor.Wheel`. **Both
 * columns end at the nearest cell that class can actually stand on**, which is
 * the house's own perimeter rather than its centre; that convention is stated
 * because without it a route can read SHORTER than the straight line to the
 * centre, which is what two figures in the first version of this header did:
 *
 *     house   Foot from the player   Wheel from the Reclamation
 *       1          199.2 m                   263.4 m
 *       2          233.1 m                   227.1 m
 *       3          264.7 m                   195.5 m
 *       4          302.7 m                   166.5 m
 *       5          366.0 m                   102.9 m
 *       6          403.9 m                    57.9 m
 *
 * **HOUSE TWO IS 233.1 AND 227.1 — the two openings are within six metres of
 * it**, and the crossover therefore falls between houses two and three, which is
 * the middle of six. That is not authored; it is what a straight tramway between
 * two openings on a diagonal pair produces, and it is why the primary's floor is
 * FOUR: three houses is the player's own half of the line and asks nothing, five
 * is most of the Reclamation's and asks too much.
 *
 * **THE OPERATION'S OWN COST TABLE USES A DIFFERENT SOURCE AND MUST.** These are
 * OPENING to OPENING, which is the only symmetric pair and the only fair way to
 * ask who owns which end. An engineer does not start at the opening: it comes
 * out of the BARRACKS DOOR, and the base is an obstacle. That costs tens of
 * metres on house one. `operations/allies/06-machine-time.ts` carries that
 * table — **and every metre in it is measured from a barracks and a free
 * engineer that have since moved**; see the banner over it.
 *
 * **THE TWO COLUMNS ARE NOT A RACE AND MUST NOT BE READ AS ONE.** They are
 * different move classes over different grids at different speeds — 3.4 m/s
 * against 5.8 — so the comparable quantity is the ORDER, not the ratio. What the
 * table says is which end of the line belongs to whom before anybody moves.
 *
 * ============================================================================
 * A GAIA HOUSE IS `Capture.ts` RULE 1, AND IT IS ALSO A GARRISON
 * ============================================================================
 * `civApartments` on the GAIA seat. Four consequences, and the first two are the
 * operation:
 *
 *   - **ONE ENGINEER, AT ANY HEALTH.** `Capture.resolve` tests
 *     `ownerFactionOf(target) === Faction.Neutral` BEFORE the health gate, so
 *     the four-engineer soften ladder `allies-forced-closure` paid for its hall
 *     does not apply here at all. Five hundred credits and a walk.
 *   - **OR FIVE RIFLEMEN, FOR AS LONG AS THEY LIVE.** `GarrisonService.enter`
 *     flips a neutral structure to the occupier through
 *     `CaptureService.captureBuilding`, and `civApartments` clears every gate in
 *     `refusalFor`: unarmed, none of the `IsBuilder | IsFactory | IsRefinery |
 *     IsRadar` bits, and a 2x3 footprint against `GARRISON.minFootprint` 2 on
 *     BOTH axes. `releaseEmptied` restores the ORIGINAL owner the moment the
 *     occupant count reaches zero, and it does not care whether the men walked
 *     out or were killed inside — so a garrisoned house is a house whose deed
 *     can be shot off you, and shooting it off you breaks the line and restarts
 *     the reduction. That is the cheap route and the fragile one.
 *
 *     **AND THE TWO ROUTES DO NOT COMPOSE.** `Capture.resolve` tests the
 *     FRIENDLY branch first, so an engineer sent at a house a squad is already
 *     holding is spent on a repair. Squad first then engineer is five hundred
 *     credits thrown away, and nothing anywhere says so at the time.
 *   - **A GAIA STRUCTURE CANNOT BE SHOT AND A CAPTURED ONE CAN.**
 *     `ScenarioBuilder.gaia` sets both directions of `allyMask` for the Neutral
 *     slot, so until the player takes a house it is scenery to everybody. The
 *     tick it changes hands it becomes a legal target for the post standing over
 *     it — see below, and that reversal is the whole reason the houses are Gaia
 *     rather than Reclamation-owned.
 *   - **THEY ARE NOT REBUILDABLE AND NOT SELLABLE.** No sidebar in the game
 *     offers a `civApartments`, and `Scenarios.ts#civilian` strips `Sellable`
 *     and composes the flag set explicitly so `GarrisonService` will not call it
 *     a production structure. A levelled house is levelled for the rest of the
 *     operation, which is what makes six of them against a floor of four a
 *     resource rather than a checklist.
 *
 * **THE HALL IS THE PLAYER'S, AND `civHospital` IS THE WIDEST CIVILIAN
 * SILHOUETTE** — 12x8 m under a 10 m roofline — which is what a hall of
 * integrators reads as, and it is the same body `allies-forced-closure` used for
 * the same room one operation ago. Continuity rather than economy: this is that
 * hall, on the ground the tramway feeds.
 *
 * ============================================================================
 * THE POSTS ARE AIMED AT THE HOUSES — AND AT THE ROAD TO TWO OF THEM
 * ============================================================================
 * Three `pillbox` keys, which `ScenarioBuilder.keyFor` turns into **Arcspitter
 * Posts** on a Reclamation seat: 520 hp, `postCoil` at 20 m, `power: 0`, so no
 * brownout in the district can silence them. 1 260 credits of concrete, all of
 * it past the middle of the line — houses one to three carry none. They are
 * numbered **#1 (282, 206)** over house four, **#2 (318, 178)** over house five
 * and **#3 (390, 198)** over the meter, in the order `PLANT_GUNS` places them,
 * and the operation header names them by those numbers.
 *
 * **A STAND TABLE IS NOT A WALK, AND THIS SECTION USED TO CLAIM IT WAS.** It
 * read *"against a man they leave a door open, deliberately"* and tabulated the
 * four capture stands of each house. `CaptureService.simTick` NEVER CHOOSES A
 * STAND: it re-aims at `st.posX/posZ` of the target every tick, `NavAssigner`
 * snaps that to `snapToReachable(centre)`, and `resolve` fires the tick
 * `withinReach` first holds — wherever on the route that happens to be. The
 * stand geometry is kept for what it honestly is, a fact about four points:
 *
 *     `CaptureService.withinReach` is a RECTANGLE test — `max(0, |dx| - halfW)`
 *     against `CAPTURE.reachMetres` (2.2) plus the engineer's own `st.radius`,
 *     `hullRadius(U.infantry)` = `max(0.52, 0.52) * 0.45` = **0.234** — so for a
 *     2x3 footprint the stands sit 6.434 m out in x and 8.434 m out in z. A post
 *     FIRES at `20 + 0.234` = **20.234 m** and ACQUIRES at
 *     `20 * COMBAT_TARGETING.acquireRangeMul + 0.234` = **21.834 m**:
 *
 *         house 4     W 17.70  N 15.91  COVERED    E 25.95  S 28.16  open
 *         house 5     W 17.70  N 15.91  COVERED    E 25.95  S 28.16  open
 *         the meter   E 12.54  S 14.45  COVERED    W 22.75  N 21.59  open
 *         house 6     E 22.95  N 26.24  open       W 34.58  S 33.07  open
 *         houses 1, 2 and 3                        nearest stand 34.53 m or more
 *
 *     **EVERY FIGURE IN THAT TABLE IS A GUN-CENTRE TO STAND-CENTRE DISTANCE**,
 *     which is the same quantity the 20.234 and 21.834 circles above are
 *     thresholds on. It used to hold the SURFACE distance instead — each entry
 *     was 0.234 m smaller, the engineer's own hull radius subtracted once — and
 *     was compared against circles that had that radius ADDED, so the two sides
 *     of every comparison disagreed by half a metre. No COVERED/open verdict
 *     changes either way; the arithmetic is now self-consistent.
 *
 *     **HOUSE SIX HAS ITS OWN ROW NOW AND USED TO BE FILED UNDER "34.30 m OR
 *     MORE".** `bb83ffb` moved the three `rclSpitpost` in the Reclamation's own
 *     base from (406, 154) / (394, 146) / (382, 126) to (386, 158) / (386, 142)
 *     / (386, 110), and the middle of those is 22.95 m from house six's east
 *     stand. Still outside both circles, and by 1.1 m rather than by 12.
 *
 *     The meter's north stand at 21.59 m is outside the firing circle and inside
 *     acquisition, so a post tracks a man there and never pulls the trigger —
 *     the same disagreement `allies-forced-closure` records for its
 *     west-north-west stand, and worth knowing before somebody reads a turret
 *     following their engineer as a bug. All twenty-four stands on the six
 *     houses are Foot-passable.
 *
 * **AND HERE IS THE WALK.** Metres of the engine's own route spent inside a
 * seat-1 firing circle before the capture resolves, minimised and maximised over
 * the shortest routes to the goal cell `snapToReachable` returns, from the
 * barracks door and from the free engineer's spawn. **BOTH OF THOSE STARTS
 * HAVE MOVED AND THESE METRES HAVE NOT BEEN RE-MEASURED** — see the banner in
 * `operations/allies/06-machine-time.ts`:
 *
 *     houses 1-3     0.0 m from either start
 *     house 4        0.0 m from the free engineer; 21.0 - 35.3 m from the door
 *     house 5        36.0 - 81.9 m from both          posts #1 and #2
 *     house 6        28.0 - 93.3 m from both          post #2
 *     the meter      45.7 - 97.3 m from both          posts #1, #2 and #3
 *
 * **THE EXCLUSION CONTROL IS THE INSTRUMENT** (CLAUDE.md trap 18), not the
 * distance: re-run the fill with all **434** cells within 20.234 m of a seat-1
 * gun impassable — the three line posts plus the three `rclSpitpost` that
 * `buildBaseFor` puts in the Reclamation's own base, because a control that
 * closes some guns and not others is measuring a third map — and compare the
 * cheapest capture cell. From the barracks door, houses one to four and the hall
 * cost **+0.0 m**, while house five costs **+61.5 m**, house six **+13.3 m** and
 * the meter **+19.9 m**.
 *
 * So the guns cover the two secondaries in the sense that MATTERS — there is no
 * safe way to them, only a longer one — and cover house four only in the sense
 * that the engine picks the wrong way round it. A completely safe approach to
 * house four exists and at **318.1 m** it is 9.0 m NEARER than the 327.1 the
 * engine's own route spends reaching its first capture cell, so the primary is
 * recoverable by hand for nothing and the secondaries are not. That pair of
 * deltas is the evidence, and a stand table could not have produced either.
 *
 * **AGAINST THE HOUSE THEY ARE A FORTY-ONE-SECOND CLOCK, AND THAT IS THE HALF
 * THE OPERATION IS BUILT ON.** `Combat.engage` fires when
 * `max(0, flat - hitRadius(target)) <= w.range`, and `hitRadius` for a 2x3
 * footprint is the half-diagonal `sqrt(4^2 + 6^2)` = **7.211 m**. Each of the
 * two line posts stands **21.260 m** from its house's centre, so the surface
 * distance is **14.049 m against a range of 20** — well inside. Through the
 * shipped tables (`postCoil` 1x34 on a 0.85 s cooldown = 40.00 raw,
 * `ARMOR_MATRIX[Tesla][Concrete]` 0.60, `COMBAT_DAMAGE.globalMul` 0.80) that is
 * **19.20 dps**, so an 800 hp house taken and left alone is rubble in
 * **41.7 seconds**, and the 700 hp meter in **36.5**.
 *
 * A post is 520 hp of `ArmorClass.Concrete` and a Warden's `lightCannon`
 * delivers 16.13 dps into it (36.67 raw x AP-against-Concrete 0.55 x 0.80), so
 * one Warden needs **32.2 s** and the opening four need **8.1 s**.
 *
 * This paragraph used to end *"the fourth house can be TAKEN for nothing and
 * cannot be HELD for less than that"*, and both halves needed correcting. It is
 * taken for nothing only if the engineer is HAND-ROUTED to the south face, which
 * the exclusion control above prices at +0.0 m; and it can be held for less,
 * because `RepairSell.setRepairing` refuses nothing about a captured civilian
 * structure and `REPAIR_RATE` 30 hp/s beats 19.20 — the operation header carries
 * that arithmetic, its 2 016-credit price and the reason it is still the worst
 * of the three routes.
 *
 * **AND THE SAME POST IS A WALL TO THE MEN WHO CANNOT AVOID IT.** `postCoil`
 * delivers **51.20 dps against `ArmorClass.Infantry`** and **27.20 against
 * Medium**, so a 90 hp engineer on a covered stand dies in **1.76 s** and a
 * 340 hp Warden lasts **12.5 s**. Discretely — which is what actually happens —
 * one pull is 34 x 1.60 x 0.80 = **43.52**, so it takes three, and the third
 * lands **1.70 s** after the first at an 0.85 s cooldown. The operation header
 * quotes the discrete figure because the walk is measured in metres of exposure
 * and a man has to be inside for whole trigger pulls, not for a fraction of a
 * dps-second. That is the same shape
 * `allies-forced-closure` measured for its Sentry Guns and it is NOT the same
 * numbers — a Sentry Gun is 65.82 against Infantry and 18.43 against Medium, so
 * the Reclamation's post is a third worse against a man and half again better
 * against armour. Re-derive rather than re-quote after any weapon retune.
 *
 * ============================================================================
 * `PLANT` AND `CUT` ARE RINGS, NOT POINTS
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, and `ProductionService.spawnUnit` writes that position
 * VERBATIM — no `connectedGround`, no egress search of any kind, unlike
 * `ScenarioBuilder.spawnUnit`, which this file uses and which does search. So
 * what this file owes the trigger table is GROUND rather than a point:
 *
 *     PLANT  (328, 150)   75.71 m from the Foundry (72.44 from the Breaker
 *                         Yard) and 115.2 m of
 *                         wheeled route to house three — 19.9 s at a Grinder's
 *                         5.8 m/s. Six rings authored on it (4 at 16 m, 2 at
 *                         10, 6 at 20, 2 at 11, 6 at 20, 3 at 12).
 *     CUT    (208, 204)   206.24 m from the Foundry (197.43 from the Breaker
 *                         Yard), 81.3 m of wheeled
 *                         route to house three and 215.8 m to the hall — the
 *                         FLANK of the line rather than either end. Four rings
 *                         authored on it (3 at 12 and 3 at 18, twice).
 *
 * **EVERY POINT OF ALL TEN RINGS IS PASSABLE TO THAT WAVE'S OWN MOVE CLASS**,
 * measured on the built world. `rclPicker` and `rclSlagger` are `Locomotor.Foot`
 * and `rclGrinder` is `Wheel`, and `passGrid` has a different bit for each, so
 * asking about the wrong one answers a different question in both directions.
 * `tests/campaign-spawn-ground.spec.ts` is the gate.
 *
 * **TWO OF THE RADII EXIST ONLY TO SEPARATE.** Two waves fired from one point
 * with the same `count` land on the SAME bearings — the ring is fixed, not a
 * scatter — so at `CUT` the Slaggers ride a 12 m ring and the Grinders behind
 * them an 18 m one. Where the counts already differ (six against two, six
 * against three) the bearings differ too and the radii only have to clear the
 * ground.
 *
 * **`CUT` IS A SECOND BEARING AND THAT IS ITS WHOLE JOB.** `AiBrain` sends its
 * own army out of its own yard, so a scripted column arriving from the plant
 * buys the operation nothing it was not already getting —
 * `allies-instrument-room` says so about its relief and
 * `soviets-common-standard` about its valley road. This one comes across the
 * middle of the tramway, which is what makes the twelve-minute turn at the hall
 * a genuine second front rather than a bigger copy of the first.
 *
 * ============================================================================
 * ECONOMY, AND THE PATCH THAT LANDED ON HOUSE THREE
 * ============================================================================
 * `addStartOre` and nothing else. It lays one home field per opening and one
 * contested patch on the CENTROID of the two:
 *
 *     (150, 402) r30   home, 41.2 m from the player's yard
 *     (362, 110) r30   home, 46.7 m from the Foundry (61.3 from the Breaker
 *                      Yard). `addStartOre` clamps rather than snaps, so the
 *                      true centres are (150.06, 402.17) and (361.94, 109.83);
 *                      the rounded pair above is what this table prints.
 *     (256, 256) r22   contested — and **15.62 m from house three**
 *
 * So the contested patch COVERS the middle of the tramway, and both economies
 * work the ground the operation is fought over for its whole length. That is a
 * consequence of the geometry rather than a decision, and it is a good one — it
 * is also a third reason the trigger table counts OWNERSHIP rather than bodies
 * in an area, because an untagged `unitsInArea` over this line would be tripped
 * by a harvester on its round trip.
 *
 * **NO `addCivilians`.** It hangs two capturable derricks off the perpendicular
 * bisector and walks `MINE_BISECTOR_OFFSETS` out for two ore mines — four more
 * neutral capturable structures on a map whose entire subject is which
 * capturable structures matter, and the two derricks would pay their holder 15
 * credits a second each on top of it. `allies-misclosure`,
 * `soviets-short-allocation` and `allies-forced-closure` all skip it; here it
 * would actively mislead.
 *
 * ============================================================================
 * WHAT THE EMPTY ROSTER ACTUALLY WITHHOLDS, MEASURED
 * ============================================================================
 * Two builds, identical except for `setCampaignRoster`:
 *
 *     seat            with the roster                cleared (the control)
 *     player          36 entities                    40
 *     Reclamation     39 entities                    43
 *
 *     the player loses      2 Sabre IFVs, a Refractor Tower and a Proving Ground
 *     the Reclamation       2 Arcspitters, an Arc Pylon and a Crucible
 *
 * With the roster in force the openings are:
 *
 *     player        5 G.I., 4 Warden Tanks, 1 engineer, 2 harvesters
 *                   24 structures — yard, refinery, war factory, barracks,
 *                   radar, 4 power plants, 2 silos, 3 Pillboxes, 9 wall
 *                   segments, and the hall
 *     Reclamation   5 Scrap Pickers, 4 Grinders, 2 Scrappers, 1 Tinker
 *                   27 structures — Breaker Yard, Sorter, Foundry, Rookery,
 *                   Spotter, 4 Furnaces, 2 Heaps, 9 barricades, 3 Arcspitter
 *                   Posts of their own, and the meter and three line posts
 *
 * **ONE ENGINEER, AND IT IS BOTH SIDES OF THE SAME MEASUREMENT.**
 * `buildAlliedBase` spawns exactly one `engineer`, which is what makes the
 * operation's "one free, three at five hundred" arithmetic true — and `keyFor`
 * resolves that same line to an **`rclTinker` on the Reclamation seat**, so seat
 * 1 opens holding a capture unit of its own. The brain can now issue
 * `OrderKind.Capture`; the operation's `ownerCount` conditions deliberately
 * remain correct when ownership changes.
 *
 * **THE RECLAMATION HALF OF THE ROSTER IS THE LOAD-BEARING ONE.** `rclPylon` is
 * `struct.defence.specialist`, reaches **28 m**, and one pull is `pylonArc` 94 x
 * `ARMOR_MATRIX[Tesla][Infantry]` 1.60 x `globalMul` 0.80 = **120.32** against
 * an engineer's 90 hp, with three chain links behind it.
 * `Placement.withinBuildRadius` gives a finished non-builder structure
 * `PLACEMENT.adjacencyRadius` 20 m plus its own radius, so the brain could found
 * one within about 26 m of any house it still stands near and close every
 * capture stand on it — including the two open ones this operation is walked
 * through. Withheld, the longest structure weapon either army can put on the
 * tramway is `postCoil` at 20 m, which is the three posts above.
 *
 * The player's half follows from the same allow-list rather than from
 * generosity, and it is SYMMETRIC and profile-independent, so the ground is the
 * same on a finished account as on a fresh one — which a deny-list could not
 * promise. `pillbox` is untagged and stays; the operation's header does the
 * arithmetic on why it is not the answer to holding 105.00 m of line.
 *
 * ============================================================================
 * NO TRIGONOMETRY, NO ROTATION, NO PROFILE, NO CLOCK
 * ============================================================================
 * Every authored point here is an integer literal and every search offset is an
 * integer. ECMA-262 pins `+ - * /` and `Math.sqrt` to bit precision and pins
 * `sin`/`cos`/`atan2` to nothing at all; a layout runs independently on both
 * machines of a lockstep match, so a table built by trig is a tick-zero desync
 * waiting for two engines to disagree in the last mantissa bit. The lane
 * projections quoted above were computed in the MEASUREMENT pass and none of
 * them is in this file. `rotateStarts` is not called either — an operation pins
 * its seed, so the rotation is a moving part with exactly one value.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `hall`   — the computing hall, PLAYER-owned. Read by `ownerCount` only, in the
 *            loss that covers demolition and capture with one clause.
 * `feeder` — all six houses, GAIA-owned, ONE tag between them. That is the whole
 *            mechanic: `ownerCount(player 0, 'building', 'feeder', min: 4)` is
 *            "four of the six are on the works", and it does not care which
 *            four.
 * `meter`  — the load meter, RECLAMATION-owned. Read by `ownerCount` only, which
 *            is why capture and demolition both satisfy the paying secondary.
 * `watch`, `col1`, `col2`, `col3`, `works` — the Reclamation's five columns, all
 *            produced by `spawnUnits` in the trigger table and never by this
 *            file. Declared anyway, so a reader asking where the pressure comes
 *            from finds the answer in the file that owns the ground;
 *            `validateCampaign` and `tests/campaign-maps.spec.ts` both know a
 *            spawned tag is not the layout's to place.
 *
 * The three posts are deliberately UNTAGGED. No trigger reads them, and a tag
 * nothing reads is a claim `tests/campaign-maps.spec.ts` would have to prove for
 * no purpose.
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
 * somewhere. This module owns them and `operations/allies/06-machine-time.ts`
 * imports them; the dependency runs operation -> layout and never back. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a column attack-moving at empty ground, a reveal
 * framing nothing — is invisible to every gate.
 * ========================================================================== */

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = MAP_SIZE * 0.5;

/**
 * The player's START SPOT at `mapSeed` 20 260 942 / `simSeed` 7 049.
 *
 * `seatedSlots(2, 7049, null)` draws the DIAGONAL pair [0, 1] — 386.16 m, the
 * longest the two-army table offers. A literal rather than a call to
 * `startSpots` because the OPERATION has to name world points in static data;
 * `build` seats both bases from the real `startSpots` and warns if the two ever
 * stop describing one world. **It is not the Construction Yard** — that lands at
 * (114, 382) — and every distance in this header is quoted against the yard.
 */
const HOME: Point = { x: 108, z: 380 };
/** The Reclamation start spot at the same seeds. `rclFoundry` lands at (402, 134). */
const FOE: Point = { x: 404, z: 132 };

/**
 * The Works computing hall — the apparatus, with the reduction running in it.
 * PLAYER-owned, 1100 hp, 72.2 m out along the lane and 76.6 m of Foot route from
 * the opening — 102.6 m from the barracks door, which is where every engineer
 * this operation buys actually starts. Outside `BUILD_RADIUS` 56 of the yard, so
 * fortifying it is a purchase rather than a free click; it does project
 * `PLACEMENT.adjacencyRadius` 20 + its own 6.00 = **26.00 m** of build room of
 * its own, which is the first link in the pillbox chain the operation header
 * prices.
 */
export const HALL: Point = { x: 162, z: 332 };

/**
 * The six feeder houses of the quarter tramway, near end first. GAIA-owned,
 * 800 hp each, one tag between them. Four of them carry the hall.
 *
 * Their lane projections are 140.6, 174.4, 208.7, 245.6, 291.2 and 328.0 m and
 * every one is within 2.61 m of a single straight bearing; the header carries
 * the corridor scan that says why the gaps are 33.8 to 45.6 rather than even.
 */
export const FEEDERS: readonly Point[] = [
  { x: 216, z: 290 },
  { x: 240, z: 266 },
  { x: 268, z: 246 },
  { x: 296, z: 222 },
  { x: 332, z: 194 },
  { x: 360, z: 170 },
];

/** The middle of the line, and where both flank columns are pointed. */
export const LINE_MID: Point = FEEDERS[2];

/**
 * The fourth house — the one the operation is about. 245.6 m out, 327.1 m of
 * Foot route from the barracks door, and 21.260 m from post #1, which takes it
 * back down in 41.7 s if it is still standing when the deed changes hands — and
 * which also covers 21.0 m of the route the engine draws to it from that door.
 * A hand-routed approach to the south face is 318.1 m and clean.
 */
export const LINE_FOURTH: Point = FEEDERS[3];

/**
 * The plant's load meter. RECLAMATION-owned `civOreMine`, 700 hp, and it pays
 * its holder 5 credits a second through `CIVILIAN_INCOME_SOURCES` — 300 a
 * minute, which `Civilians.ts` prices at 0.57 of a measured harvester. 59.93 m
 * from the Reclamation yard, and covered on two of its four capture stands.
 */
export const METER: Point = { x: 376, z: 188 };

/**
 * Where the Reclamation's tramway columns form. 75.71 m off their own Foundry and
 * 115.2 m of wheeled route to house three — 19.9 s at a Grinder's 5.8 m/s.
 */
export const PLANT: Point = { x: 328, z: 150 };

/**
 * Where the yard road crosses the quarter, on the line's flank. 81.3 m of
 * wheeled route to house three and 215.8 m to the hall — 37.2 s at a Grinder's
 * 5.8 m/s and 71.9 s at a Slagger's 3.0, which is the warning the player gets
 * when the twelve-minute column turns for the room.
 */
export const CUT: Point = { x: 208, z: 204 };

/**
 * The near half of the line, revealed on the second beat.
 *
 * Centred on house two, so 50 m covers houses one (33.94 m) and three (34.41 m)
 * and stops 21.2 m short of house FOUR at 71.22 m, which the next beat covers.
 * `revealArea` is `Vision.exploreCircle`
 * and is PERMANENT, so a disc that covered the whole tramway would make the
 * third beat's reveal a no-op — `soviets-demolition-order` records the same trap
 * for its two feeder plants.
 */
export const LINE_NEAR: Area = { x: FEEDERS[1].x, z: FEEDERS[1].z, r: 50 };

/**
 * The far half plus the meter, revealed on the third beat. Centred on house
 * five, so 52 m covers house four (45.61 m), house six (36.88 m) and the meter
 * (44.41 m) and reaches no further than the ground the operation asks about.
 */
export const LINE_FAR: Area = { x: FEEDERS[4].x, z: FEEDERS[4].z, r: 52 };

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

/**
 * The three Arcspitter posts, as absolute literals.
 *
 * TWO OF THEM STAND OVER THE HOUSES RATHER THAN OVER THE APPROACH, which is what
 * this file exists to record — AND THE APPROACH IS NOT THEREFORE CLEAR, which is
 * what it used to claim. Each of the line pair sits 21.260 m from its house's
 * centre, so the HOUSE is 14.049 m of surface inside a 20 m gun and the deed
 * starts burning at 19.20 dps the moment it changes hands. Two of the four
 * capture stands also clear both the firing circle (20.234 m) and the
 * acquisition circle (21.834 m) — and a stand is not where the engineer stops.
 * Measured on the engine's own route, the walk to house five spends 36.0 m and
 * the walk to house six 28.0 m inside a live `postCoil`; house four is 0.0 m
 * from the free engineer's spawn and 21.0 m from the barracks door. The header's
 * exclusion control carries the price of going round.
 *
 * THREE RATHER THAN FOUR OR FIVE, AND HOUSES ONE TO THREE CARRY NONE. The
 * primary asks for four houses and the ground gives three of them away; a post
 * over house three as well would price the primary twice and leave the `spare`
 * secondary with nothing left to be. The third post is on the meter instead,
 * which is the only structure on this map that pays its holder — so the concrete
 * is spent where the money is rather than spread evenly down a line.
 *
 * **A FOURTH POST OVER HOUSE SIX WAS CUT, AND IT IS SETTLED NOW RATHER THAN
 * ARGUED.** The rejection used to be a distance claim — house six is 328.0 m out
 * and 55.32 m from the Reclamation's Foundry, so a player who wants it is already
 * standing inside the brain's own army, and the nearest post to any of its four
 * STANDS is 35.58 m — which is the stand-table mistake this file has now been
 * corrected for twice. The exclusion control answers it properly: house six's
 * walk already spends **28.0 m** inside post #2 and a safe approach already
 * costs **+13.3 m**, so a fourth gun would be buying pressure the ground is
 * already applying. Cut, on a control rather than on an argument.
 *
 * THE ORDER OF THIS ARRAY IS THE NUMBERING BOTH HEADERS USE: #1 over house four,
 * #2 over house five, #3 over the meter. Reorder it and every "post #2" in the
 * operation file points at a different gun.
 */
const PLANT_GUNS: readonly Point[] = [
  { x: 282, z: 206 },
  { x: 318, z: 178 },
  { x: 390, z: 198 },
];

/** Rings searched outward for a legal footprint, in metres. Nearest first. */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/**
 * Metres reserved around each structure so `scatter` leaves the capture stands
 * clear.
 *
 * `scatter` can produce a `boulder` authored at 3.2 m and spawned at
 * `rng.range(0.8, 1.35)` — 4.32 m — and `isBlocked` tests its CENTRE, so a
 * reservation has to clear the furthest capture stand by more than that:
 *
 *     hall    3x2, stand 8.434 m out    22 m leaves 9.25 m
 *     house   2x3, stand 8.434 m out    20 m leaves 7.25 m
 *     meter   2x2, stand 6.434 m out    16 m leaves 5.25 m
 *
 * A prop dropped on the one face an engineer can use would delete a house from
 * the line silently, and `Scatter` knows nothing about capture geometry. The
 * posts get 10 m because nothing has to stand next to them.
 */
const HALL_CLEAR = 22;
const FEEDER_CLEAR = 20;
const METER_CLEAR = 16;
const GUN_CLEAR = 10;

/* ==========================================================================
 * 3. THE BUILD
 * ========================================================================== */

export default layout({
  id: 'allies-machine-time',
  tags: ['hall', 'feeder', 'meter', 'watch', 'col1', 'col2', 'col3', 'works'],

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
        `[campaign] allies-machine-time built on (${String(cx)}, ${String(cz)}), not the map `
        + `centre (${String(CENTRE)}, ${String(CENTRE)}) — the tramway is authored in absolute `
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
     * opening would move the BASES and leave the hall, the houses and the posts
     * exactly where they are — and the HALL, 72.2 m out with the base's own
     * footprints behind it, is the one with the least room to absorb it. Four
     * metres is one cell.
     */
    if (Math.abs(home.x - HOME.x) > 4 || Math.abs(home.z - HOME.z) > 4
      || Math.abs(foe.x - FOE.x) > 4 || Math.abs(foe.z - FOE.z) > 4) {
      console.warn(
        `[allies-machine-time] openings moved: player (${String(home.x)}, ${String(home.z)}) and `
        + `foe (${String(foe.x)}, ${String(foe.z)}) against the authored (${String(HOME.x)}, `
        + `${String(HOME.z)}) and (${String(FOE.x)}, ${String(FOE.z)}). Every distance in this `
        + 'layout and every order point in the operation is measured against the authored pair — '
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
     * as the fallback and nothing on this ground reaches it: all eight
     * structures are accepted at ring zero.
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

    /* -- the hall, and it is the PLAYER'S ---------------------------------
     * A5 ended with this room off the Ninth's books, so it opens on the Allied
     * seat. That is also what makes the operation's loss readable as an
     * ownership count rather than a death: `ownerCount(player 0, 'hall',
     * max: 0)` is true whether the hall was levelled or taken, and seat 1 opens
     * holding an `rclTinker`.
     *
     * NO `unlockedBy` ON ANY KEY IN THIS FILE, WHICH IS LOAD-BEARING UNDER AN
     * EMPTY ROSTER. `spawnBuilding` consults the progression gate, so a tagged
     * key here would return `NONE`, the tag would land on nothing, and
     * `ownerCount(player 0, 'hall', max: 0)` — a LOSS — would read TRUE from
     * tick one. `civHospital`, `civApartments`, `civOreMine` and `pillbox` are
     * all untagged, and `tests/campaign-roster-ground.spec.ts` builds this
     * operation with the roster armed and the def tables bound, which is the
     * only state that can see the difference.
     */
    raise(us, 'civHospital', place(us, 'civHospital', HALL), 'hall', 0, HALL_CLEAR);

    /* -- the line ---------------------------------------------------------
     * GAIA-OWNED, ALL SIX, AND THAT IS THE OPERATION RATHER THAN A FLAVOUR
     * CHOICE. `ScenarioBuilder.gaia` allies the Neutral slot to everybody in
     * both directions, so a house is scenery until somebody takes it: one
     * engineer at any health under `Capture.ts` rule 1, or five riflemen for as
     * long as they live under `Garrison.enter`. Reclamation-owned houses would
     * be rule 2 — four engineers each, or shot to half first — which is
     * `allies-forced-closure`'s operation, one week ago, and not this one.
     *
     * ONE TAG FOR ALL SIX. `ownerCount(player 0, 'building', 'feeder', min: 4)`
     * is the whole primary and it does not care which four.
     */
    for (const f of FEEDERS) {
      raise(b.gaia, 'civApartments', place(b.gaia, 'civApartments', f), 'feeder', 0, FEEDER_CLEAR);
    }

    /* -- the meter, and it is THEIRS --------------------------------------- */
    raise(them, 'civOreMine', place(them, 'civOreMine', METER), 'meter', 0, METER_CLEAR);

    /*
     * The posts. EMPLACEMENTS RATHER THAN PARKED HULLS, and that is structural:
     * `AiBrain.census` files every untagged, non-harvester hull an AI seat owns
     * into `armyIds` and `regroupSquads` drives it to the rally point on the
     * next brain pass — measured on `soviets.02.common-standard` at 116.6 m and
     * 129.2 m off the post inside twenty seconds. An Arcspitter Post cannot be
     * re-tasked, and `AiBrain` has no `issueSell` either, so the only thing that
     * takes one off the line is the player shooting it.
     */
    for (const g of PLANT_GUNS) {
      raise(them, 'pillbox', place(them, 'pillbox', g), null, 0, GUN_CLEAR);
    }

    /* -- economy and dressing ---------------------------------------------- */
    addStartOre(b, spots, b.sea);

    /*
     * Open on the yard looking down the lane, biased 13% toward the map centre —
     * the same bias `allies-sounding-line`, `allies-misclosure` and
     * `allies-forced-closure` use — so the first thing on screen is the hall and
     * the head of the tramway rather than the back wall of the player's own
     * base.
     */
    b.setCameraFocus(home.x + (cx - home.x) * 0.13, home.z + (cz - home.z) * 0.13);
    b.scatter({ minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 }, 150);
    void start;
  },
});
