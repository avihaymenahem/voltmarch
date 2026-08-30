/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/pact-vacant-possession.ts
 * ============================================================================
 * P9 — THE GROUND. The Conclave's own precinct, held by the Sept, with the
 * Order's household camped outside its own wall.
 *
 * **THIS FILE OWNS EVERY COORDINATE THE OPERATION ARGUES.**
 * `operations/pact/09-vacant-possession.ts` imports the points and the two
 * `Area`s and restates none of them; the dependency runs operation -> layout and
 * never back. A number written in both files is a number that will disagree the
 * first time either is tuned, and the failure — a reveal that frames empty
 * ground, a column ordered at a point nobody authored — is invisible to every
 * gate.
 *
 * Everything below is read off a headless build at `mapSeed` 60 101 /
 * `simSeed` 4 019 with the def tables BOUND (`buildScenario(..., { defs })`) and
 * `setCampaignRoster` INSTALLED, which is the only state in which this
 * operation's allow-list is actually in force — `tests/campaign-maps.spec.ts`
 * does neither, so a build there is measuring a different game.
 * **RE-MEASURE, DO NOT RE-QUOTE**, if either seed moves.
 *
 * ============================================================================
 * 1. THE FRAME
 * ============================================================================
 * `simSeed` 4 019 draws the DIAGONAL pair, so the two openings are as far apart
 * as this game ever puts them:
 *
 *     home (the Order, seat 0)   404, 380
 *     foe  (the Sept,  seat 1)   108, 132
 *     axis                       386.161 m
 *
 * `snow` has no `MAP_SEAS` row, so the raw start spots are the seated slots and
 * nothing in this file branches on the seat count. The bare heightfield is
 * **12 350 of 16 384 cells foot-passable (75.38%)**.
 *
 * **EVERY AUTHORED POINT IS AN ABSOLUTE INTEGER LITERAL AND EVERY ONE OF THEM
 * LANDS WHERE IT IS WRITTEN.** There is no `at(n, p)` axis parameterisation
 * here and no trigonometry of any kind: ECMA-262 pins `+ - * /` and
 * `Math.sqrt` to bit precision and pins `sin`, `cos` and `atan2` to nothing at
 * all, and a layout runs independently on both machines of a lockstep match, so
 * a table built by trig is a tick-zero desync waiting for two engines to
 * disagree in the last mantissa bit. The two yaws are literals for the same
 * reason. `rotateStarts` is not called either — an operation pins its seed, so
 * the rotation is a moving part with exactly one value.
 *
 * The literals below are the BUILT WORLD's own coordinates, which makes the ring
 * search in `place()` a CHECK rather than a mechanism: it finds every structure
 * at ring zero today and would report if the ground under one ever moved.
 * `spawnBuilding` snaps a second time, to the footprint grid — a 2x2 to
 * coordinates congruent to 0 (mod `CELL`) and a 1x1 to 2 (mod `CELL`) — and the
 * literals are chosen to satisfy that, so nothing is displaced by so much as a
 * metre. An earlier draft authored the floor two metres off and it moved.
 *
 * ============================================================================
 * 2. THE PRECINCT — THE TWO RADII ARE ONE SUBTRACTION
 * ============================================================================
 *     FLOOR         mrdOculus   (296, 192)   650 hp   2x2   hitRadius 5.6569
 *                   GAIA'S, not the Sept's — see 3b. Everything else here is.
 *     GATE_A        mrdGlaive   (310, 206)   480 hp   1x1   19.799 m from it
 *     GATE_B        mrdGlaive   (282, 178)   480 hp   1x1   19.799 m
 *     PRECINCT_R    40      FLOOR_R    14      difference 26
 *
 * **26 IS `focusLance`'s RANGE AND `sunLance`'s, READ OFF THE BOUND WEAPON
 * TABLE.** A `mrdSolarch` or an `mrdLancer` standing on the precinct rim — the
 * closest legal place an Order gun can be at the hour — bears on the nearest
 * point of the reading floor and on nothing one metre further in.
 * `pulseCarbine` is 20, so the Wayfarers do not reach the floor from the rim at
 * all. The operation's whole win clause is that subtraction and the operation
 * header argues it; this file is where the two numbers live.
 *
 * THE GROUND IS ALMOST PERFECT AND THAT IS THE POINT OF A PRECINCT. Measured on
 * the bare heightfield at two-metre samples:
 *
 *     FLOOR_AREA    r 14    149 / 149 passable, 149 / 149 buildable
 *     PRECINCT_AREA r 40   1255 / 1257 passable (99.84%), 1247 / 1257 buildable
 *
 * and after the build the ONLY closed cells inside `FLOOR_AREA` are the Oculus's
 * own four — cells (73,47), (74,47), (73,48), (74,48), which is exactly
 * x in [292, 300) by z in [188, 196). Seven cells of the whole precinct are
 * closed: those four, the two gate posts, and one of terrain. **Nobody loses
 * this operation to a rock.** It was chosen that way on a measured sweep of ten
 * map seeds: six of the ten offered no site at all whose reading floor was
 * wholly passable AND wholly buildable, and of the four that did, 60 101's
 * precinct is 99.84% open against 88.1%, 92.2% and 78.0%.
 *
 * The precinct centre sits **74.7 m off the opening-to-opening axis** (nearest
 * at t = 0.53), so the rim clears the direct road between the two armies by
 * 34.7 m and ordinary traffic can never fail the withdrawal clause by driving
 * straight. That is the same pairing `pact.07.thin-place` makes between
 * `WORKS_OFFSET` and `PARCEL.r` and the deliberate INVERSION of
 * `pact.04.in-the-clear`, whose axis CUTS its disc because its bonus is about an
 * ENEMY column and must not be winnable by standing aside. **Change either
 * number and change both notes.**
 *
 * `addStartOre` lays a home field per opening plus one contested patch on the
 * centroid, and the nearest ore RIM is **53.5 m from the floor — 13.5 m outside
 * the precinct**, so no harvester any player can ever own has business on the
 * reading ground. That is checked rather than assumed because
 * `runtime.ts#unitsInArea` counts UNITS and asks nothing about what they are
 * for; `allies.02.instrument-room` moved all three of its ore fields for exactly
 * this reason.
 *
 * ============================================================================
 * 3. THE GATE POSTS COVER THE FLOOR, AND THE FLOOR IS SAFE FROM WHAT BREAKS
 * THEM
 * ============================================================================
 * `glaiveRepeater` is range 24 and the posts stand 19.799 m from the floor's
 * centre, one either side on the diagonal. Measured centre to centre, the pair
 * covers every point of the floor within
 * `sqrt(24^2 - 19.799^2)` = **13.563 m** of the middle, across the post axis —
 * against `FLOOR_R` 14, which leaves two uncovered crescents 0.437 m deep.
 * **Through the gate that actually decides** — `Combat.engage`'s
 * `surfaceDist = max(0, flat - hitRadius(target))`, and an `mrdArtificer`'s
 * radius is 0.234 — the real reach is 24.234 m, the covered half-width is
 * **13.973 m**, and the crescents are **under three centimetres**. There is no
 * standing on the reading floor while a post is up.
 *
 * **NO BLAST AIMED AT A POST CAN REACH THE FLOOR.** A blast centred on a
 * gate post is 19.799 m from the floor's centre and the Oculus's `hitRadius` is
 * `hypot(4, 4)` = 5.6569, so the surface separation is **14.14 m** — against the
 * widest splash the Order's column carries, `sunLance`'s 2 m. That is 7.07x.
 *
 * ============================================================================
 * 3b. AND THE SPLASH WAS THE WRONG MECHANISM. THE PLAYER'S OWN COLUMN DELETED
 * THE INSTRUMENT BY ORDINARY ACQUISITION, IN FIVE SECONDS, ON THE MAIN LINE
 * ============================================================================
 * Section 3 above used to end *"nothing aimed at the two guns that must be
 * broken can reach the thing being given away"* and conclude the case closed.
 * The splash arithmetic is right and it was an answer to a question nobody was
 * asking. `Targeting.isValidTarget` refuses only ALLIES; an unarmed enemy
 * building scores `COMBAT_TARGETING.softBuilding` 0.55 and is a perfectly legal
 * DIRECT target; and `stanceAllowsAcquire` refuses only `Stance.HoldFire`.
 *
 * Measured in a real engine rig — `World` + `ProductionService` with the def
 * tables bound, `setWeaponTable(binding.tables.weapons)`, and the shipped
 * `Targeting` / `Weapons` / `Projectiles` / `Damage` stepped at `SIM_DT` — with
 * the Oculus on this file's own (296, 192) and the Sept holding it:
 *
 *     the Order's opening column (7 mrdSolarch + 4 mrdLancer), Defensive,
 *     ringed at 22 m with no other target        floor dead in 4.37 s
 *     the same column at 12 / 16 / 20 / 26 / 30 / 33 m
 *                                                3.00 / 3.03 / 4.33 / 3.20 /
 *                                                3.30 / 8.03 s
 *     one mrdSolarch alone, swept 20 -> 40 m     kills out to 33 m; 34 m and
 *                                                beyond it never fires at all
 *
 * **AND THE MAIN LINE IS THE WORST CASE, NOT AN EDGE ONE.** `Targeting.approach`
 * parks an attacker at `range * APPROACH_STOP_FRAC` = 20.8 m of its target along
 * its CURRENT bearing, and `GATE_B` is on the far side of the floor from
 * `MUSTER`: the stop point for an `OrderKind.Attack` on `GATE_B` issued from the
 * camp is **(293.84, 195.10), 3.78 m from the floor's centre and 1.88 m INSIDE
 * the Oculus's own hit disc**. In the rig, with the near post already broken,
 * that column killed the FLOOR in **5.07 s and never scratched GATE_B at all** —
 * the instrument outscores a post twenty metres further off. With both posts
 * standing it took GATE_A at 7.23 s and the floor at 9.87 s, and still never
 * reached the post it was pointed at.
 *
 * **THE FIX IS THE OWNER, BECAUSE NO GEOMETRY CAN SEPARATE THE TWO.** A post
 * that covers a 14 m floor has to stand within `sqrt(24.234^2 - 14^2)` of it, so
 * at most ~19.8 m; a hull that may shoot that post stands 20.8 m from it, hence
 * as little as 1 m and never more than 40.6 m from the instrument; and the
 * instrument's own lethal radius is 33 m. There is no arrangement that satisfies
 * both, and moving the Oculus out to 53.8 m to satisfy the second breaks the
 * first and puts it outside the precinct. **So the Oculus is GAIA's.**
 * `ScenarioBuilder.gaia` allies the Neutral slot to everybody in BOTH directions
 * and `isValidTarget` refuses allies, so neither army can acquire it. The same
 * column, the same ring, the same rig:
 *
 *     floor owned by the Sept   dead in 4.37 s
 *     floor owned by GAIA       650 / 650 after 120 s
 *
 * **`t.floorLost` IS STILL REACHABLE AND IS NOW WHAT ITS OWN COMMENT SAYS IT
 * IS.** `Damage.applySplash` has no ally filter — it halves an allied victim by
 * `COMBAT_DAMAGE.friendlyFireMul` 0.5 and nothing more — so a shell aimed at a
 * reader standing against the instrument still lands on the instrument. One
 * Sept `mrdLancer` at its own standoff, firing `sunLance` into an `mrdArtificer`
 * pressed to the Oculus's west face, cost it **58.30 hp in 30 s** (650 ->
 * 591.70), i.e. 1.94 hp/s and 5 min 35 s for the whole 650. That is a hazard
 * with a clock on it rather than a five-second accident, and section 3's 7.07x
 * margin is what keeps the two GATE POSTS off that list.
 *
 * **ONE SIDE EFFECT, NAMED RATHER THAN LEFT TO BE FOUND.** `mrdOculus` draws
 * `power: -40`, and that load leaves the Sept's ledger with it. Nothing in this
 * file or the operation's balance argument reads the Sept's power headroom, and
 * the only place it could bite is `glaiveRepeater`, which carries
 * `needsPower: true` — so the direction is that the two gate posts are forty
 * points FURTHER from going dark than they were, which is the safe direction for
 * a section that assumes they fire. Gaia has no grid, so the instrument itself
 * is unpowered; it is unarmed and `IsRadar`, so the only consumer of that is a
 * minimap nobody owns.
 *
 * ============================================================================
 * 4. THE SEPT'S FORWARD CHAPTERHOUSE
 * ============================================================================
 *     HOUSE       mrdChapterhouse   (236, 196)   750 hp   2x2
 *     HOUSE_GUN   mrdGlaive         (222, 190)   480 hp   1x1
 *
 * 60.13 m from the floor — 20.13 m outside the rim — and 143.11 m from the
 * Sept's own opening. `mrdChapterhouse` is the prereq structure for every
 * Meridian infantry row (`mrdWayfarer`, `mrdLancer` and `mrdArtificer` all list
 * it) and publishes `BuildTab.Infantry`, so a second one makes the Sept's
 * Infantry queue **`FACTORY_SPEED_BONUS` 35% faster, to a `FACTORY_SPEED_CAP` of
 * 2.0** — which is what taking it off them actually buys, and it is the shown
 * secondary.
 *
 * **IT IS A RATE AND A FOOTHOLD, NOT A SPAWN POINT, AND THE OBVIOUS READING IS
 * WRONG.** A draft of this block said "every man the Sept trains there starts
 * 60 m from the objective". `ProductionService.tryEgress` launches a finished
 * hull from `primaryFactory[seat][tab]` — ONE designated building per tab, with
 * a naval override that does not apply to infantry — so which chapterhouse the
 * Sept's men walk out of is a designation this file does not set and does not
 * measure. What the forward house indisputably is, is 750 hp of the Sept's
 * standing twenty metres outside the wall on the approach, and 35% of their
 * infantry rate.
 *
 * **ITS GUN FACES AWAY FROM THE PRECINCT, AND THAT IS THE WHOLE OF WHY IT IS
 * WHERE IT IS.** At (222, 190) it stands 74.03 m from the floor and reaches to
 * 50.03 m — **10.03 m outside the rim**. Sixteen metres the other way and it
 * would have covered ground the readers cross. It defends the house; it does not
 * defend the precinct.
 *
 * ============================================================================
 * 5. THE COLUMN, AND WHAT `opening: 'force'` MEANS HERE
 * ============================================================================
 * `buildBaseFor` is called for seat 1 and NOT for seat 0. The Order opens with
 * twenty-five hulls and nothing else — no Conclave, no Forgeyard, no collector,
 * and `credits: 0` on top, so there is no bank to look at either.
 *
 *     4 mrdArtificer   2 000 credits   the readers. Unarmed, `canCapture`, and
 *                                      the only thing on this map that can walk
 *                                      into a building.
 *     10 mrdWayfarer   1 750           range 20, so they cannot reach the floor
 *                                      from the rim and are not the answer at
 *                                      the hour.
 *     4 mrdLancer      1 800           range 26, `sunLance`, 17.40 dps on
 *                                      Concrete.
 *     7 mrdSolarch     5 600           range 26, 330 hp, the only thing that can
 *                                      stand in front of a post.
 *                     11 150 total
 *
 * **THE FOUR READERS ARE PLACED ONE MAN AT A TIME RATHER THAN BY `formation`**,
 * because `formation` returns a COUNT and the trigger table needs them TAGGED:
 * the primary is `unitsInArea(..., tag: 'readers')` and a count cannot be
 * tagged. The twenty-one armed hulls carry `arms` for the same reason and it is
 * the tag that makes the withdrawal clause mean what it says — the readers are
 * seat 0's units too, and they are standing in the middle of the disc the rule
 * excludes.
 *
 * `b.block(MUSTER, 30)` reserves the muster ground. `spawnUnit` does not call
 * `block()` itself — the `START_CLEAR_RADIUS` finding `soviets-common-standard`
 * records — so without it `scatter` is free to drop props into the one place the
 * operation cannot start without. **613 of 613 two-metre samples within 28 m of
 * `MUSTER` are clear to Foot AND Hover**, and every one of the twenty-five hulls
 * lands on the grid point it was authored on.
 *
 * ============================================================================
 * 6. `ROAD` AND `RELIEF` ARE RINGS, NOT POINTS
 * ============================================================================
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, and `ProductionService.spawnUnit` writes that position
 * VERBATIM — no `connectedGround`, no egress search of any kind, unlike
 * `ScenarioBuilder.spawnUnit`, which this file uses and which does search. So
 * what this file owes the trigger table is GROUND rather than a point:
 *
 *     ROAD   (214, 190)   82.02 m from the floor, 120.83 m from the Sept's
 *                         opening. **509 of 529 samples within 26 m clear to
 *                         BOTH Foot and Hover**, and all twenty-six drop points
 *                         of the five scripted troops are clear.
 *     RELIEF (294, 254)   62.03 m from the floor. **317 of 317 samples within
 *                         20 m clear**, and the nearest point of its sixteen-
 *                         metre ring is 46.04 m from the floor — **6.04 m
 *                         outside the precinct rim**, so the five hulls that
 *                         come over at minute thirteen do not arrive already in
 *                         breach of the rule they are bound by.
 *
 * `tests/campaign-spawn-ground.spec.ts` is the gate and it checks every point of
 * every wave against that wave's own locomotor — `MoveClass.Foot` for
 * `mrdWayfarer` and `mrdLancer`, `MoveClass.Track` for `mrdSolarch`.
 *
 * **THE ORDER IS A HEADING, NOT A LEASH.** `AiBrain.regroupSquads` files every
 * untagged hull the seat owns into a squad on its next pass, so the attack-move
 * is the first thing a wave does and the brain owns it afterwards. What the
 * waves buy is the Sept being stronger at a known minute than it could have
 * built itself.
 *
 * ============================================================================
 * 7. THE ROUTES, ON A NAMED INSTRUMENT
 * ============================================================================
 * 8-connected Dijkstra over the real `FlowFieldCache.costGridFor`, destination-
 * cell weight, diagonals at `(nc * DIAG) | 0`, corner-cutting refused, run on the
 * BUILT world with the def tables bound and the roster in force.
 * `COST_BLOCKED` is imported from `src/world/terrain-gen.ts`
 * and the grid refuses **4 104 of 16 384 cells** to Foot, which is asserted
 * rather than assumed: imported from `core/config.ts` the constant is
 * `undefined`, every `nc >= undefined` is false, the walk goes straight through
 * buildings, and the answer is a plausible slightly-too-short number with a green
 * test behind it. Two more controls back it: the Oculus's own four cells
 * (73,47) (74,47) (73,48) (74,48) all read 255 on the Foot AND Hover cost grids
 * — so the walk really does see this file's own buildings, and the Foot HARD
 * grid refuses the same 4 104 — and sealing cell rows z = 64..66 makes
 * MUSTER -> the floor UNREACHABLE rather than merely dearer.
 *
 * **BOTH ENDS ARE SNAPPED TO THE NEAREST OPEN CELL CENTRE, AND SAYING SO IS
 * WHAT MAKES THE TABLE CHECKABLE.** The floor's own cell is inside the Oculus's
 * footprint and therefore closed, so "the floor" as a DESTINATION is the nearest
 * standable cell to (296, 192), which is **6.32 m out** — four of them, at
 * (302, 190), (302, 194), (294, 198) and (298, 198). That is why the RELIEF row
 * below is legitimately SHORTER than the point-to-point straight line printed
 * beside it, and it is the one convention under which a route number here can
 * read under its own Euclidean bound. The first draft of this table published
 * five figures that no convention reproduces, three of them under their own
 * straight line; the `straight` column exists so that never happens silently
 * again. Metres are GEOMETRIC — `CELL` per cardinal step, `CELL * sqrt(2)` per
 * diagonal, along the cost-optimal path — with the weighted figure
 * (`cost / COST_UNIT * CELL`) in brackets. A cell depth is not a distance and
 * none of these is one:
 *
 *                                              route    weighted   straight
 *     Foot    MUSTER -> the floor              204.6 m   (205.8)    170.29
 *     Hover   MUSTER -> the floor              204.6     (205.8)    170.29
 *     Foot    ROAD -> the floor                 86.6     ( 89.4)     82.02
 *     Hover   the Sept's opening -> the floor  216.2     (221.1)    197.34
 *     Foot    RELIEF -> the floor               56.0     ( 57.4)     62.03
 *     Hover   MUSTER -> the chapterhouse       225.4     (226.4)    206.78
 *     Foot    the floor -> outside the rim   30.6-36.0   (identical)
 *
 *     56.8 s at a reader's 3.6      26.9 s at a Solarch's 7.6 (MUSTER)
 *     22.8 s at a Wayfarer's 3.8    28.4 s at a Solarch's 7.6 (their gate)
 *     14.7 s at a Wayfarer's 3.8    29.7 s at a Solarch's 7.6 (the house)
 *
 * **THE LAST ROW IS THE OPERATION'S CLOCK AND IT IS A RANGE OVER THE WHOLE
 * FLOOR, NOT A FIGURE.** Swept from EVERY open cell within `FLOOR_R` of the
 * centre — 28 of them, the other four being the Oculus — to the cheapest cell
 * whose centre is more than `PRECINCT_R` out: **best 30.6 m from (290, 182),
 * worst 36.0 m from (294, 186)**, and the weighted, unit-cost, Foot and Hover
 * answers are all four identical, which is what 99.84% open ground looks like.
 * That is **9.6 to 11.3 s for an `mrdLancer` at 3.2 m/s** — the slowest thing
 * the player has to walk out — 8.1 to 9.5 s for a Wayfarer at 3.8 and 4.0 to
 * 4.7 s for a Solarch at 7.6. The beat at minute twenty says so in words,
 * because `ObjectiveRow` has no description field and a rule with a cost the
 * player cannot see is a rule they will get wrong once.
 *
 * **THE FIRST DRAFT PUBLISHED 65.2 m HERE AND IT WAS NOT MERELY WRONG, IT WAS
 * IMPOSSIBLE.** A unit at distance d <= `FLOOR_R` from the centre is at most
 * `PRECINCT_R` - d <= 40 m of STRAIGHT LINE from the nearest ground outside a
 * 40 m rim, so 65.2 needed a 63% detour across ground this same file measures at
 * 99.84% open. The check costs one subtraction and it was never done; every
 * number derived from it — the seconds, the "seven times what the manoeuvre
 * costs" in the operation's `t.nudge` comment, and `t.nudge`'s own
 * player-facing line — inherited it.
 *
 * ============================================================================
 * 8. WHAT THE EMPTY ROSTER ACTUALLY WITHHOLDS, MEASURED
 * ============================================================================
 * Two builds, identical except for `setCampaignRoster`:
 *
 *     seat                with the roster              cleared (the control)
 *     the Order (0)       25 units, 0 structures       25 units, 0 structures
 *     the Sept (1)        12 units, 27 structures      14 units, 29 structures
 *     Gaia (2)             0 units,  1 structure        0 units,  1 structure
 *
 *     the Order loses   NOTHING. There is no base to withhold from and every key
 *                       in the column carries no `unlockedBy`.
 *     the Sept loses    two `mrdSkiff` (`unit.raider`), one `mrdReliquary`
 *                       (`struct.tech`) and one `mrdHelios`
 *                       (`struct.defence.specialist`).
 *
 * **THE SPIRE IS THE LOAD-BEARING ONE.** `heliosLance` is range **33**, and a
 * finished non-builder structure projects `PLACEMENT.adjacencyRadius` (20) plus
 * its own radius, so the Sept's brain could found one about 26 m from its
 * forward chapterhouse — 34 m from the floor — where 33 m of reach covers the
 * near half of the reading ground from OUTSIDE the precinct, which is ground the
 * operation never asks the player to take. Whether the brain's placement search
 * would actually go there is NOT measured; the roster removes the question.
 * Withheld, the longest structure weapon either army can put anywhere near this
 * precinct is `glaiveRepeater` at 24, which is the two posts this file already
 * placed and section 3 stays true.
 *
 * The Order's half withholds nothing, and that is not the `REMOVES_NOTHING` case
 * `tests/campaign-roster-ground.spec.ts` names — that check reads the
 * OPERATION's whole build, and this one loses four entities on seat 1.
 * `allies.07.fair-copy` records the identical position for the identical reason.
 *
 * ============================================================================
 * 9. TAGS
 * ============================================================================
 * `floor`        — GAIA's `mrdOculus`, the reading floor. Read by `entityDead`
 *                  (the operation ends if it is levelled) and named by
 *                  `captureProof`, which on a NEUTRAL owner is the stronger
 *                  refusal: `Capture.resolve` takes a neutral structure OUTRIGHT
 *                  AT ANY HEALTH, so without the veto one reader puts the
 *                  Conclave's instrument back in Pact hands for nothing. A
 *                  BUILDING, which `tests/campaign-maps.spec.ts` requires of any
 *                  tag an `entity*` condition reads on an AI seat — and that
 *                  same check exempts `Faction.Neutral` by name, because Gaia
 *                  has no brain to march it off.
 * `gate`         — the two Glaive Posts. Read by `ownerCount(max: 0)`, so
 *                  destroying them and taking them both satisfy it.
 * `chapterhouse` — the forward barracks. Read by `ownerCount(max: 0)` for the
 *                  same reason, which is why the objective says "take off them"
 *                  rather than "destroy".
 * `readers`      — the four `mrdArtificer`. A PLAYER-owned tagged unit is exempt
 *                  from the mobile-hull rule above, because nothing re-tasks it.
 * `arms`         — the twenty-one armed hulls, and the five that come over at
 *                  minute thirteen through `spawnUnits`.
 * `sept1`..`sept5` — produced by `spawnUnits` in the trigger table and never by
 *                  this file. Declared anyway, so a reader asking where the
 *                  pressure comes from finds the answer in the file that owns the
 *                  ground; `validateCampaign` and `tests/campaign-maps.spec.ts`
 *                  both know a spawned tag is not the layout's to place.
 *
 * The Sept's own three base posts and the chapterhouse's gun are deliberately
 * UNTAGGED: no trigger reads them, and a tag nothing reads is a claim
 * `tests/campaign-maps.spec.ts` would have to prove for no purpose.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` asks `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot.
 * ========================================================================== */

import { NONE, Stance } from '../../core/types';
import { CELL } from '../../core/config';
import {
  addStartOre, buildBaseFor, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/** The map centre. `startPointsFor` reserves a shelf here first, on a continent. */
const CENTRE = 256;

/**
 * The reading floor — the Conclave's own instrument, held by the Sept.
 * 216.8 m from the Order's opening and 197.3 m from theirs.
 */
export const FLOOR: Point = { x: 296, z: 192 };

/**
 * The precinct wall, as a disc, and the reading ground inside it.
 *
 * **THE DIFFERENCE IS 26, WHICH IS `focusLance`'s RANGE AND `sunLance`'s.** A
 * hull on the rim bears on the nearest point of the floor and on nothing further
 * in. See header §2; the operation's win clause is this subtraction and its
 * header argues it. Change either and both files are wrong.
 */
export const PRECINCT_R = 40;
export const FLOOR_R = 14;
export const PRECINCT_AREA: Area = { x: FLOOR.x, z: FLOOR.z, r: PRECINCT_R };
export const FLOOR_AREA: Area = { x: FLOOR.x, z: FLOOR.z, r: FLOOR_R };

/** The Sept's two posts on the Order's own gate. 19.799 m from the floor each. */
const GATE_A: Point = { x: 310, z: 206 };
const GATE_B: Point = { x: 282, z: 178 };

/** The Sept's forward chapterhouse. 60.13 m from the floor, 20.13 m outside the rim. */
export const HOUSE: Point = { x: 236, z: 196 };
/** Its own gun, sited AWAY from the precinct — it reaches to 50.03 m of the floor. */
const HOUSE_GUN: Point = { x: 222, z: 190 };

/** Where the Sept's five troops form. 82.02 m from the floor, 120.83 m from their gate. */
export const ROAD: Point = { x: 214, z: 190 };
/** Where the Sept's own section grounds its arms. Its ring stays 6.04 m clear of the rim. */
export const RELIEF: Point = { x: 294, z: 254 };
/** The Order's camp, outside its own wall. 48.1 m from the opening. */
export const MUSTER: Point = { x: 390, z: 334 };

/** Facing the precinct, and away from it. Literals, because trig is not bit-pinned. */
const INWARD = 230;
const OUTWARD = 50;

/**
 * Cells searched outward for a legal footprint, nearest first.
 *
 * `findClearFootprint` ALONE IS NOT ENOUGH and the build says so out loud: it
 * asks `footprintClear` and `connectedGround` and NOTHING about slope, so
 * `spawnBuilding` will plant a structure on a grade `isBuildable` refuses and
 * report success. `snow` carries the highest `relief` in `MAP_PRESETS` at 0.50,
 * which is why both questions are asked and the shipped search is only the
 * fallback. Every structure here is found at ring zero.
 */
const PLACE_RINGS = 7;

export default layout({
  id: 'pact-vacant-possession',

  tags: ['floor', 'gate', 'chapterhouse', 'readers', 'arms',
    'sept1', 'sept2', 'sept3', 'sept4', 'sept5'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THE START SPOTS ARE DERIVED FROM
     * (cx, cz), SO THE TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`,
     * which `startPointsFor` puts at the map centre on every continent. If that
     * ever stops being true this file is dressing ground the trigger table is not
     * naming — and it would be invisible, because every tag would still land and
     * every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] pact-vacant-possession built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — the precinct is authored in absolute coordinates and will `
        + 'not line up with the openings this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const order: PlayerId = c.seat(0);
    const sept: PlayerId = c.seat(1);
    const home = spots[0];
    const foe = spots[1] ?? spots[0];

    const scratch = new Float32Array(2);
    const place = (owner: PlayerId, key: string, p: Point): Point => {
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

    const raise = (
      owner: PlayerId, key: string, p: Point, tags: readonly string[],
      yawDeg: number, clear: number,
    ): Point => {
      const where = place(owner, key, p);
      const id = b.spawnBuilding(key, owner, where.x, where.z, { yawDeg });
      for (const t of tags) c.tag(t, id);
      if (id !== NONE) b.block(where.x, where.z, clear);
      return where;
    };

    /* -- the openings -----------------------------------------------------
     * ONE SEAT GETS A BASE AND THE OTHER DOES NOT. `c.opening` is `'force'`,
     * which the campaign honours by this file simply not calling `buildBaseFor`
     * for seat 0 — there is no third `START_CONDITIONS` member and there must not
     * be, because it would appear in the SKIRMISH lobby where nothing calls
     * `buildBaseFor` at all.
     */
    buildBaseFor(b, sept, foe.x, foe.z, { facingDeg: wrapDeg(foe.facingDeg + 180) });

    /* -- the precinct ------------------------------------------------------
     * THE INSTRUMENT IS GAIA'S AND THE GATE IS THE SEPT'S, AND THAT SPLIT IS
     * WHAT MAKES THE OPERATION PLAYABLE. See header §3b: while the Oculus was
     * the Sept's, the player's own column deleted it in 5.07 s on the main line
     * and `t.floorLost` ended the match. `ScenarioBuilder.gaia` allies the
     * Neutral slot to everybody in BOTH directions, and
     * `Targeting.isValidTarget` refuses only ALLIES, so no gun on this map —
     * the Order's or the Sept's — can acquire it. Splash still can, halved by
     * `COMBAT_DAMAGE.friendlyFireMul` 0.5, which is the hazard `t.floorLost`
     * exists for and which §3 measures.
     *
     * `mrdOculus` carries `IsRadar`, so `GarrisonService.refusalFor` answers
     * "production structure" and no rifleman is walking into it. It is not a
     * FACTION_KEY_MAP key either — the map is keyed by the GENERIC roles, and
     * `radar` is the row that resolves TO this def — so `keyFor` passes it
     * through unchanged on a Neutral owner rather than remapping it.
     *
     * `captureProof: ['floor']` is what it is because of this line and not in
     * spite of it: `Capture.resolve` takes a NEUTRAL structure OUTRIGHT AT ANY
     * HEALTH, so without the veto one reader puts the Conclave's own instrument
     * back in Pact hands for nothing, which is the exact move the operation
     * exists to refuse.
     */
    raise(b.gaia, 'mrdOculus', FLOOR, ['floor'], INWARD, 14);
    raise(sept, 'mrdGlaive', GATE_A, ['gate'], OUTWARD, 8);
    raise(sept, 'mrdGlaive', GATE_B, ['gate'], OUTWARD, 8);

    /* -- the Sept's forward chapterhouse ----------------------------------
     * A SECOND INFANTRY PRODUCER, WHICH IS A RATE RATHER THAN A SPAWN POINT —
     * see header §4 — AND ITS GUN FACES THE OTHER WAY. At (222, 190) the post
     * reaches to 50.03 m of the floor, ten metres outside the rim, so it defends
     * the house and not the precinct.
     */
    raise(sept, 'mrdChapterhouse', HOUSE, ['chapterhouse'], OUTWARD, 20);
    raise(sept, 'mrdGlaive', HOUSE_GUN, [], OUTWARD, 8);

    /* -- the Order's household ---------------------------------------------
     * Twenty-five hulls, one at a time, because the trigger table needs them
     * TAGGED and `formation` returns a count. `Stance.Defensive` so nothing
     * wanders off the muster before the player has looked at the map.
     */
    b.block(MUSTER.x, MUSTER.z, 30);
    const file = (key: string, xs: readonly number[], dz: number, tag: string): void => {
      for (const dx of xs) {
        const id = b.spawnUnit(key, order, MUSTER.x + dx, MUSTER.z + dz, {
          yawDeg: INWARD, stance: Stance.Defensive,
        });
        if (id !== NONE) c.tag(tag, id);
      }
    };
    file('mrdArtificer', [-12, -4, 4, 12], -14, 'readers');
    file('mrdWayfarer', [-14, -7, 0, 7, 14], -7, 'arms');
    file('mrdWayfarer', [-14, -7, 0, 7, 14], 0, 'arms');
    file('mrdLancer', [-12, -4, 4, 12], 7, 'arms');
    file('mrdSolarch', [-14, -7, 0, 7, 14], 14, 'arms');
    file('mrdSolarch', [-4, 4], 21, 'arms');

    /* -- ore and dressing --------------------------------------------------
     * `addStartOre` and nothing else. The Order cannot mine any of it — no
     * Cistern, no collector, no bank — so its home field is thirty metres of ore
     * nobody will ever lift, and it is left there because it is the SEPT's
     * collectors that decide whether the middle of this map is trafficked.
     *
     * NO `addCivilians`: it hangs capturable derricks off the perpendicular
     * bisector, and this operation's four unarmed men are its primary. Four more
     * one-click doors on the route would turn the readers into a menu.
     *
     * The two drop rings are reserved before the scatter runs. That is
     * legibility rather than passability — no prop carries `EntityFlag.BlocksNav`
     * and `terrain.isPassable` never sees one — but a wave that arrives inside a
     * thicket reads as a bug.
     */
    addStartOre(b, spots, b.sea);
    b.block(ROAD.x, ROAD.z, 26);
    b.block(RELIEF.x, RELIEF.z, 20);

    b.scatter({
      minX: Math.min(home.x, foe.x) - 70,
      minZ: Math.min(home.z, foe.z) - 70,
      maxX: Math.max(home.x, foe.x) + 70,
      maxZ: Math.max(home.z, foe.z) + 70,
    }, 150);

    // The opening frame: the camp, with the precinct's bearing behind it.
    b.setCameraFocus(MUSTER.x, MUSTER.z);
    void start;
  },
});
