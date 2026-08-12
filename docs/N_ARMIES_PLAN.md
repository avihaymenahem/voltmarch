# N ARMIES — the plan

**Goal:** N armies in a match, maximum 4 including the human player.

**Base:** `b0dfa1d` ("one predicate for 'has water', and two gates that caught the new navy").

**Status of the goal at that commit:** the substrate is built and the lobby offers it, and **the feature does
not work**. One function that the design depends on has no caller, and every army past the second opens
the match with nothing. That is measured below, not inferred.

This document separates three things and labels them everywhere:

- **MEASURED** — a number produced by running code in this worktree. Probes were written, run, and
  deleted; the numbers are reproducible from the descriptions given.
- **READ** — a claim taken from the source, with a file and line, not executed.
- **PROPOSED** — a design decision that has not been made yet. Nobody has agreed to any of it.

---

## 0. The one-paragraph answer

Almost all of the four-army work landed across two commits, `eddf096` ("four armies — the lobby, the
seating and the radar stop assuming a duel") and `fdb9bd8` ("the start table learns to count to four").
The first taught the lobby, the shell and the radar to count past two. The second taught the start table
and the terrain planner to count past two. **The call that connects them was never written.**
`setPlannedArmies()` is exported from `src/game/Scenarios.ts:3791`, documented over sixteen lines as
"Called by the skirmish lobby", and called by nothing in `src/`, `tests/`, `tools/` or `server/`. So the
lobby's Sides row changes `MatchSetup.opponents`, the shell seats four players, and the terrain and the
scenario continue to build a duel.

Everything else in this document is downstream of that, and most of it is smaller than it looks.

---

## 1. What already landed — do not re-plan this

Verified present and correct. Listed so the reader stops thinking about it.

| Thing | Where | Note |
|---|---|---|
| `MatchSetup.opponents: OpponentSetup[]` is the truth | `src/shell/settings-store.ts:753-802` | singular `aiFaction`/`difficulty`/`personality` are a documented mirror of `opponents[0]` for the save index, load screen, end screen and `?ai=` |
| `armyCount`, `effectiveOpponents`, `cloneSetup`, `withArmyCount` | `settings-store.ts:805-884` | `effectiveOpponents` is the mandated read path when a setup may not have come from `normalizeSetup` |
| Lobby Armies → Sides row, bounded by the map | `src/shell/SkirmishSetup.ts:336-352`, `:423-428`, `:447-459` | row is hidden entirely when the map offers one answer |
| `normalizeSetup` clamps the army list to `mapById(map).players` | `settings-store.ts:933-943` | a stored four-way on a two-army map comes back as a two-army match |
| `Shell.applySetupToWorld` seats N armies | `src/shell/Shell.ts:2023-2077` | numbers the AI names when there is more than one; backdrop is deliberately always a duel |
| Opening bank goes to every army | `Shell.applySimPostBoot` | — |
| `MAX_PLAYERS = 8`; every `MAX_PLAYERS`-sized sim array is that wide | `src/core/config.ts:68` | the engine was never the cap |
| `AiDirector.rebuild` builds one brain per non-human player | `src/sim/AI.ts:4305` | re-checked whenever the player count changes, so "add an AI mid-match" works |
| `ScenarioBuilder.armySlot(i)` walks the table by index and creates players the world is short of | `src/game/Scenarios.ts:2207-2221` | resolves by SLOT, not by faction — which is what made mirror matches legal |
| `PlayerState.allyMask` defaults to self-only | `src/core/world.ts:969` | free-for-all needs no code |
| `outcome.system.ts` `winnerOf` prefers a hostile that can still play; victory waits for the last opponent | `src/game/outcome.system.ts:279-294`, `:357-371`, `:412-435` | already skips allies via `areAllied` |
| Hostiles coloured BY SEAT in the UI | `src/ui/Chrome.ts:743-782` (`hostileColor`, `HOSTILE_COLORS`), consumed by `Minimap.ts:474-495`, `Sidebar.ts:3112-3156`, `Hud.ts:1071-1077` | one shared helper, not duplicated; four seat colours; wraps past four |
| `startPointsFor(armies, sea)` is the single start derivation | `Scenarios.ts:465-480` | `SKIRMISH_START_OFFSETS` has four entries; slots 0-1 are byte-identical to the old two literals |
| `tests/archipelago.spec.ts` proves four bases on four islands | 770 lines, three seeds | the only real four-army map test in the repo |
| `ReplayHeader.players: ReplaySlot[]` already stores every slot | `src/game/Replay.ts:87-104`, `:122-150`, `:233-244` | **the task brief guessed this was singular; it is not.** `captureStart` does `world.players.map(...)` |
| `Shell.seatReplayPlayers` grows the world to the header | `Shell.ts:2166-2197` | stops at Gaia; restores the recorded bank per slot |
| Save blob stores all N players, fog planes, superweapons, commander powers | `src/game/SaveGame.ts:957-959`, `:1214`, `:1403`, `:1418`, `:1836-1843` | `restoreSnapshot` calls `world.reset()` and re-seats the whole table |
| `MatchStartInfo` carries `localPlayer` and `faction`; missions track only the local player | `src/progression/types.ts:302-311`; `MissionTracker.ts:216-240`, `:604-606` | no cross-player aggregation anywhere |
| End screen names EVERY hostile | `Shell.ts:2541-2544`; `EndScreen.ts:75-86` | `world.players[1]?.name` was fixed already |
| The relay's merge layer is generic over N | `src/net/TurnRelay.ts:103-108`, `:193`, `:200-203`; `server/src/Match.ts:60-91` | `TurnRelay(slots)`; the gate is `slot.reported < this.slots` |
| `validateCommand` bounds slots by `WIRE_LIMITS.maxPlayers` (8) | `src/net/protocol.ts:372-374` | needs no change for 3-4 |

---

## 2. THE BLOCKER — the army count never reaches the terrain or the scenario

**MEASURED.** A probe replicated the production call chain exactly: no `setPlannedArmies` call (as the
shipping lobby does), `plannedTerrainInput()` for the terrain, four players seated as
`Shell.applySetupToWorld` seats them, then `buildScenario(world, 'skirmish', seed, {})` — which is
`scenarios.system.ts:294` with its real argument list.

```
plannedArmyOverride()          = null
plannedScenario().armies       = 2
plannedStartPoints()           = 3 shelves :: (256,256) (182,318) (330,194)
plannedTerrainInput().starts   = 3 shelves
seated players                 = 4
ore fields = 3, entities = 159
  p0 "Commander"    faction=1  assets=6
  p1 "Opponent"     faction=2  assets=7
  p2 "Soviet AI 2"  faction=3  assets=0
  p3 "Soviet AI 3"  faction=4  assets=0
  p4 "Gaia"         faction=0  assets=146
ARMIES THAT OPENED WITH NOTHING: 2 -> p2,p3
```

The chain, each link **READ**:

1. `setPlannedArmies` (`Scenarios.ts:3791`) is never called, so `armiesOverride` stays `null`.
2. `planScenario` (`:3869`) — `armies: name === 'skirmish' ? clampArmies(armiesOverride) : ...` —
   `clampArmies(null)` returns `SKIRMISH_ARMIES_DEFAULT`, which is 2 (`:437`, `:442-445`).
3. `plannedStartPoints()` (`:3808-3811`) → `startPointsFor(2, sea)` → **3 shelves**, so the generator
   levels ground for two armies plus the map centre.
4. `scenarios.system.ts:294` passes no `armies`, so `buildScenario` (`:4054-4056`) also resolves 2, and
   the skirmish layout calls `startSpots(cx, cz, 2, sea)` → **2 openings**.
5. `Shell.verifyArmies` (`Shell.ts:1278-1293`) exists precisely for this and logs
   `[shell] 2 seated army/armies opened with no units and no buildings — ...`. It warns; it does not
   refuse.
6. The outcome poll reads an assetless army as beaten after `OUTCOME.beatenGraceSeconds` = 8.

So selecting **3-Way** or **4-Way** today yields a match that resolves in an unearned victory a few
seconds in, with one `console.error` nobody sees. The tripwire that predicted this is in the tree and
firing; nothing gates on it.

**Two things make this bigger than a one-line fix**, and both must be in the same change:

- **The terrain is decided at module-import time.** `world-warm.system.ts` calls `plannedTerrainInput()`
  at module scope to hand generation to a worker; both it and `terrain.system.ts` must see the same
  answer or the prewarmed fields are for a different map, silently (`terrain-plan.ts:5-25`). Both
  `plannedScenario()` and `plannedTerrainInput()` are memoised, and `Shell.bootGame` drops both memos
  (`Shell.ts:1945-1946`) immediately before `bootstrap(boot)` (`:1960`). **The army count must be set
  before that line.** Setting it in `SkirmishSetup` at Start Battle also works, because
  `resetScenarioPlan()` deliberately does not clear `armiesOverride` (`:3778-3782`).
- **Turning on four shelves changes the heightfield of every map that gets four armies**, including all
  twelve `?shot=` fixtures if the override ever leaks into a posed capture. `planScenario` already pins
  non-`skirmish` scenarios to 2 (`:3869`), which is the guard — but it is the only guard, and a
  four-army skirmish on `temperate-valley` genuinely is a different heightfield than a duel on the same
  seed. **PROPOSED:** re-shoot and re-grade after this lands, and treat the fixtures' invariance as a
  test rather than a hope.

**PROPOSED fix, smallest correct version:**

1. Call `setPlannedArmies(armyCount(this.setup))` from `SkirmishSetup` at launch, beside the existing
   `setPlannedStart` call — the two have the same lifetime and the same reason for it.
2. Clear it (`setPlannedArmies(null)`) on every non-skirmish launch path — tutorial, mission, backdrop,
   PvP, replay — for the same reason `Shell.startMatch` now clears the unlock-gate suppression: one
   four-way must not leave every later boot on five shelves.
3. Add `?armies=` to `buildMatchQuery` (`settings-store.ts:998-1021`) and to the boot flags. There is no
   such flag today, which is why nothing outside the lobby can produce a four-army match — see §4.
4. Make `verifyArmies` fail the launch in dev builds (`__DEV__`) rather than only logging. The tripwire
   was right and was ignored for two commits.

---

## 3. Maps — which can seat four, and why

**READ.** `MAPS` (`settings-store.ts:687-718`), six entries, all 512 × 512 m (`MAP_SIZE`/`MAP_CELLS` are
global; there is no per-map size).

| id | `players` | preset | sea | reason for its number |
|---|---|---|---|---|
| `temperate-valley` | **4** | temperate | none | open ground, no strong axis |
| `airbase-flats` | **4** | arid | none | open ground |
| `industrial-grid` | **4** | urban | none | almost no relief |
| `frozen-sector` | **2** | snow | none | authored judgement: "cliffs channel every push" |
| `contested-strait` | **2** | coast | `MAP_SEAS.coast` | shoreline through the middle |
| `coral-shore` | **2** | tropical | `MAP_SEAS.tropical` | shoreline through the middle |

`MAX_ARMIES` is derived, not declared — `MAPS.reduce((n, m) => Math.max(n, m.players), 2)` = 4
(`settings-store.ts:734`). The clamp is real and lives in three places (`SkirmishSetup.ts:423-428`,
`:447-459`, `settings-store.ts:933-943`). Below the shell nothing consults `players`.

### 3.1 The two `players: 2` values mean different things — measured

This is the finding worth acting on. A probe built the real terrain for each map at 2 and 4 armies and
measured buildable fraction and wetness inside `BUILD_RADIUS` at every spot, plus the shelf push.

**`frozen-sector` forced to four is geometrically fine. MEASURED:**

```
armies=4  max shelf push 0.00 m   startReport: all zero
  spot0 (210,302) buildable=88.7% wet=0.0%
  spot1 (350,229) buildable=87.6% wet=0.0%
  spot2 (330,318) buildable=88.1% wet=0.0%
  spot3 (182,154) buildable=83.2% wet=0.0%
  ore fields in water: 0/5
```

Compare its own two-army numbers, 88.2% and 85.5%. Nothing degrades. Its `players: 2` is a **design
judgement about how the map plays**, not a statement that the ground cannot hold four. It may well be
the right judgement — but it is revisable by playtest, and it costs nothing to revisit.

**`contested-strait` forced to four is broken, and the failure is exactly the one the naval tests exist
to prevent. MEASURED:**

```
armies=4
requested shelves: (256,256) (182,318) (330,194) (330,318) (182,194)
reserved shelves : (256,256) (182,318) (330,194) (330,318) (234,256)
max shelf push   : 81.05 m
  spot3 (182,194) buildable=29.9% wet=31.8%
  ore fields in water: 1/5
```

Two independent failures on one seat. The generator could not reserve a dry shelf at `(182,194)` and slid
it 81 m inland to `(234,256)` — essentially the map centre — while `startSpots` puts the army at the raw
offset and never reads the shelf list back (deliberately; `Scenarios.ts:844-864` records the regression
that came from reading it back). So **the ground is guaranteed 81 m from where the army lands**, and
where it lands is 29.9% buildable with 31.8% of its build disc under water. One of five ore fields spawns
in the sea.

The cause is structural, not a tuning miss. `START_BISECTOR` is the perpendicular bisector of slots 0
and 1, and both naval seas are half-planes offset along it. Slots 2 and 3 are the two corners that lie
*across* that bisector — projections ±95.05 m — so on `coast` (offset −112 m, budget 98 m) slot 3 ends
up 16.95 m of dry land from the waterline, and on `tropical` (offset +100 m, budget 94 m) slot 2 ends up
4.95 m from it. **A four-corner layout is incompatible with a bisector-aligned half-plane sea.** The two
water maps' `players: 2` is arithmetic.

### 3.2 The archipelago is built, tested, and unreachable

**READ.** `ARCHIPELAGO_SEA` (`Scenarios.ts:3471-3503`) — four islands, three shoals — is the only
geometry in the repo *proven* to seat four armies with a real base each: `tests/archipelago.spec.ts`
measures 100% buildable inside `BUILD_RADIUS` at all four starts, 828-891 buildable cells per island
against the 616 a build disc covers, zero shelf push, one amphibious world, 8 ore fields none of them
wet. Its own doc comment says it is "**ready for a preset to name**", and no preset names it. It is not
in `MAP_SEAS` and no `MapChoice` selects it.

**PROPOSED.** Adding one `MAPS` row pointing at a preset wired to `ARCHIPELAGO_SEA` is the cheapest way
to ship a four-army battlefield whose four-army-ness is already proven by a test. It is a strictly better
first map than forcing four onto a continent, because the continent case has the open questions in §3.3
and this one has none.

### 3.3 What is still unmeasured about a four-army continent

- **`START_MIN_SEPARATION` is 150 m** (`Scenarios.ts:716`), derived from the two-army opening of 193 m
  ("78% of 193"). **MEASURED:** the four-army layout's pairwise distances are 193.1, 148.0 and 124.0 m —
  two of the three are *below* the constant. In `nudgeToBuildable` the `crowds()` predicate rejects any
  candidate within 150 m of a settled spot, so for slots 2 and 3 nearly the whole search annulus is
  rejected before being scored. It degrades rather than crashes (the authored point is returned
  unchanged when nothing better is found), but **the rescue that took "seeds under 60% buildable" from
  65/192 to 15/192 is effectively off for slots 2 and 3.** This constant needs re-deriving.
- **The opening collapses.** MEASURED post-nudge minimum pair: 201 m at two armies, **111 m** on
  `temperate-valley` and **92 m** on `frozen-sector` at four. Whether a 92 m opening is a four-way or a
  knife fight is a playtest question, not a code question, but it is a balance change and should be
  named as one.
- **Shelf seams at 124 m and 148 m are unmeasured.** `tests/start-shelves.spec.ts` measures the seam step
  across the two seated slots only (`SEATED = SKIRMISH_START_OFFSETS.slice(0, 2)`); the discs at 124 m
  still overlap (flat radius 58, so 58+58 > 124) and nothing looks at them.
- **A four-way ships with no civilians.** `addCivilians` (`Scenarios.ts:3112`) begins
  `if (spots.length !== 2 || b.archipelago) return;`. MEASURED: neutral buildings go from 6 at two armies
  to **0** at four. No capturable derricks, no garrisonable blocks. That composition has to be authored.

---

## 4. Performance — measured, and the binding constraint is not where it was expected

**The headline caveat first: a four-army match cannot currently be booted by any harness.** There is no
`?armies=` flag (grep: none), `setPlannedArmies` has no caller, and `?shot=` fixtures are pinned to two
armies by `planScenario`. So `tools/shoot.mjs`, `tools/metrics.mjs`, `tools/desync-probe.mjs --sim` and
`tools/replay-probe.mjs` are **all blind to four armies**, and draw calls and end-to-end frame time are
not merely unmeasured — they are unmeasurable until §2 lands. That is a strong argument for the work
order in §10.

### 4.1 Entity counts — MEASURED

`temperate-valley`, seed 4242, `start: 'base'`, at tick 0:

| | 2 armies | 4 armies | delta |
|---|---|---|---|
| players (incl. Gaia) | 3 | 5 | |
| army buildings | 53 | 109 | **+106%** |
| army units | 30 | 62 | **+107%** |
| army entities | 83 | 171 | **+106%** |
| neutral (Gaia) entities | 149 | 145 | −3% (the 6 civilian buildings are gone, §3.3) |
| **total alive** | **232** | **316** | **+36%** |
| ore fields | 3 | 5 | +67% |

Read this carefully: the *world* grows 36% because Gaia dominates the opening census and does not scale.
The *armies* grow 106%, and armies are the half that grows during a match. At steady state the ratio
approaches 2×, which is what the brief predicted.

Note also the ore: fields are `armies + 1` on a continent (one each plus a contested centroid patch), so
ore per army falls from 1.5 to 1.25. **PROPOSED:** decide whether that is intended tightening or an
accident of the formula before balancing anything else.

### 4.2 Sim cost — MEASURED

Same fixture. `Vision.update()` timed over 200 calls after 20 warm-up; `AiDirector.tick()` over 600 ticks
after 30.

| | 2 armies | 4 armies | delta |
|---|---|---|---|
| `Vision.update()` median | 1.4035 ms | 2.3471 ms | **+67%** |
| `Vision.update()` mean | 1.6526 ms | 2.5575 ms | +55% |
| `AiDirector.brains` | 1 | 3 | |
| `AiDirector.tick()` median | 0.0009 ms | 0.0043 ms | |
| `AiDirector.tick()` total over 600 ticks | 4.9 ms | 6.0 ms | **+22%** |
| AI commands issued over 600 ticks | 13 | 39 | ×3 exactly |

**The AI is not the problem.** Three brains cost 22% more *in total* than one, because every brain is
internally slow-ticked and phase-offset — `ai.system.ts:218` says "eight opponents never all run their
census on the same tick" and the measurement agrees. Absolute cost is ~0.01 ms per tick against a 33.3 ms
budget at 30 Hz. This is the reassuring result of the whole audit.

**Vision is the measured per-army sim cost.** It goes from 4.2% to 7.0% of a 30 Hz tick. That is not
fatal and it is the largest player-scaled number found. `Vision` allocates `MAX_PLAYERS` grids of
`MAP_CELL_COUNT` already (`Vision.ts:193-196`), so there is no allocation cliff — it is the per-player
stamp loop (`stampCircle`, `:518-535`) that costs.

**Honesty about this measurement:** it is a static opening census — a pre-built base, no units moving, no
combat, no projectiles. Real four-army cost is higher than these numbers and the *shape* (AI cheap,
vision linear-ish in players) is what should be carried forward, not the absolute values.

### 4.3 Draw calls — UNMEASURED, and the likely binding constraint

**READ, and this is the concern the brief was right to raise.** `RenderBridge` keys model resolution and
batching by `packKey(kind, faction, defId)` (`RenderBridge.ts:209-211`), so a batch is per-faction.
`withArmyCount` fills new armies **from the factions nobody has taken yet** (`settings-store.ts:865-884`)
— so the natural four-way is four *different* factions, which is the worst case for batching: up to
twice the distinct `(kind, faction, defId)` batches of a duel.

Against a `MAX_DRAW_CALLS` of 130 (`config.ts:1477`) and a measured real figure of **171-263** already,
doubling the batch count is the single most likely way this feature misses its budget. **It has not been
measured and cannot be until §2 lands.**

**PROPOSED:** the first thing done after the plumbing fix is `npm run shots` on a four-army fixture and
`renderer.info.render.calls` read off it. If the number is what the structure suggests, the mitigations
are (a) cap the default four-way at two factions rather than four — which conflicts with the current
"different faction = different colour" trick and is therefore coupled to §5 — or (b) merge batches across
factions, which is coupled to §5 as well. **Do not decide §5 before this number exists.**

---

## 5. In-world identity — the atlas is baked per faction, so the one-line fix is not a fix

The brief says `RenderBridge.ts` tints the 3D world by `Faction` rather than owner slot, and that fixing
it means threading a per-slot colour into `TEAM_RGB`. **That is true and it is not sufficient**, and the
difference is large enough to change the plan.

**READ.** There is exactly one site that writes the instance colour —
`RenderBridge.ts:992-993`, `batch.writeTeam(slot, TEAM_RGB[fi], ...)` with `fi = s.faction[i] * 3`.
`s.owner[i]` is in the same struct-of-arrays (`world.ts:73-76`), so the swap is mechanically one line.

**But almost nothing reads that attribute.** `aTeamColor` is consumed by three materials only: the
placeholder material (`RenderBridge.ts:480`, `:490`), the building **selection pulse**
(`BuildingFactory.ts:844-848`), and cameos (`Cameos.ts:529-533`). `createUnitMaterial`
(`UnitFactory.ts:538-611`) installs three hooks and **none of them touches `aTeamColor` at all**.

A tank's blue comes from **baked atlas texels**, one atlas per faction — `specForPalette`
(`UnitFactory.ts:874-903`) passes `teamColor`/`teamSecondary`/`insignia` into the greeble generator,
which paints them (`greeble-gen.ts:979`, `:996`, `:1546`), and the spec hash is the atlas cache key.
Buildings are the same, and the codebase says so twice having checked it on screen
(`buildings.system.ts:125-132`, `BuildingDefs.ts:2033-2051`: "Two derricks photographed side by side —
one Gaia, one just taken by the Allies — are the same colour").

So changing line 992 from `faction` to `owner` would recolour the placeholder box and the building
selection pulse, **and nothing else on screen**.

Real per-slot in-world identity requires one of:

- **PROPOSED A — a team-slab mask channel.** Write the slab texels as a mask (or a known key colour) that
  the fragment shader multiplies `vRaTeam` into, instead of pre-painting them. Touches `greeble-gen.ts`,
  `UnitFactory.createUnitMaterial`, `BuildingFactory.applyStructureShader`, the atlas cache keys in
  `UnitLibrary`/`BuildingLibrary`, and `Cameos.ts`. `BuildingDefs.ts:2049-2051` already predicts this is
  "a grade-wide change to `BuildingFactory`". Largest change in this document.
- **PROPOSED B — one atlas per slot.** Multiplies texture memory and boot time by army count and forks
  the batches, collapsing the shared-atlas argument at `UnitFactory.ts:875-878`. Also makes §4.3 worse.
  Probably wrong.
- **PROPOSED C — do nothing in-world; make the default four-way four different factions and accept that
  a same-faction four-way is only distinguishable on the radar.** This is today's behaviour, stated as a
  decision rather than an accident. It is free and it conflicts directly with §4.3's mitigation (a).

**Look-bible constraints on any of these — READ.** `docs/RA3_LOOK_BIBLE.md:344-367` fixes team colour at
8-14% of a vehicle's surface as **flat slabs**, exactly one insignia, top/outward faces only; risk R12
(`:956-960`) forbids applying team colour as a hull tint and says "the base paint slot cannot accept a
faction colour at all", which `config.ts:2293-2299` enforces. **Recolouring the slabs is compliant;
recolouring the hull is a direct R12 violation and also fails scorecard #10.** Hue is the constrained
axis: the four faction team hues were chosen for a 72° minimum pairwise separation (`config.ts:1001-1006`)
and hue 100-120° is forbidden outright (scorecard #9, checked by `tools/metrics.mjs`). A per-seat hue
offset will land inside somebody's reservation by arithmetic. **PROPOSED:** if per-slot identity is
wanted, vary value/saturation or add a secondary marker (chevron/pennant count) rather than hue.

**Uncertain:** the cost of adding a mask channel to the greeble atlas. No existing mask channel was found
and no spare-texture-slot analysis exists. This is the biggest sizing unknown in the document and should
be scoped before committing to A.

---

## 6. Teams and alliances — much closer than it looks

**READ, and this was the pleasant surprise.** `allyMask` is not a stub. Thirty-plus call sites already
route through `world.areAllied` / `enemyMask` / `allyMask`, and they are the right ones:

- **Shared vision already works.** `Vision.ts:432` reads the owner's `allyMask` and `stampCircle`
  (`:518-535`) stamps every player in it; `:637` returns `VisionLevel.Live` for an allied owner.
- **Friendly fire already has a policy.** `Damage.ts:306` scales by `COMBAT_DAMAGE.friendlyFireMul` when
  allied, `:407` and `:474` gate retaliation and scoring, `Crush.ts:319` refuses to crush an ally,
  `Projectiles.ts:352` and `Combat.ts:756` skip allies in splash and target selection.
- **Victory already respects it.** `outcome.system.ts:287`, `:365`, `:416` all `continue` on an ally, so
  a team wins when every *hostile* is beaten. No change needed.
- **The AI already respects it.** `AI.ts:914` skips allied entities when censusing enemies.
- **It is already checksummed** (`Checksum.ts:193`) and **already saved** (`SaveGame.ts:651`, `:1152`,
  `:2037`).
- **Selection, capture, garrison, transport, crates, commander powers, superweapons, repair** all consult
  it (`Selection.ts:699`, `Capture.ts:380`, `Garrison.ts:239`, `Transport.ts:267`, `Crates.ts:297`,
  `CommanderPowers.ts:400`/`:473`, `Superweapons.ts:911`/`:1002`, `Harvesting.ts:1079`).
- **The minimap already colours allies with your own accent** (`Minimap.ts:474-495`).
- `Scenarios.ts:2257-2258` already sets reciprocal ally bits (for Gaia), so the write pattern exists.

**What is actually missing is a way to SET it, and the places that assume one local army.**

**PROPOSED, in order:**

1. **A `teams` axis on `MatchSetup`.** Smallest shape that expresses 2v2, 1v3 and FFA: a per-army team
   index, `team: number` on `OpponentSetup` plus a `playerTeam` on `MatchSetup`, with "every army its own
   team" as the FFA default. Equal team indices imply alliance. This normalises and clamps exactly like
   `opponents` does and needs the same migration story (absent field ⇒ FFA).
2. **One writer.** After `Shell.applySetupToWorld` seats the armies, set every `allyMask` from the team
   indices, reciprocally, in one loop. Nothing else may write `allyMask` for a skirmish. Guard: a player
   is always allied to itself (`1 << id`), which is what `createPlayerState` already does.
3. **Lobby UI.** A team chip per army block in `SkirmishSetup`. Bounded by the map's `players` exactly as
   the Sides row is.
4. **Decisions that are genuinely open** (do not guess these):
   - *Can allies damage each other?* `COMBAT_DAMAGE.friendlyFireMul` exists and is applied. Whether it is
     0, or non-zero for splash only, is a design call the code is already shaped for.
   - *Shared control / shared bank?* Neither exists. Both are out of scope for a first pass; say so.
   - *What does the AI do about an ally?* This is the real work. `AI.ts` skips allied entities when
     censusing enemies, which stops it shooting its friend — but it has no notion of coordinating,
     defending an ally's base, or not walking through it. A 2v2 with two AIs on a team will play as two
     independent AIs that happen not to shoot each other. **PROPOSED:** ship that, name it as a known
     limitation, and do not attempt AI cooperation in the same change.
5. **The end screen and outcome copy** assume "every hostile force" — already correct for teams — but
   `EndScreen` shows one difficulty for N armies (§9).

**Uncertain:** whether shared vision at team scale has a performance cost worth measuring.
`stampCircle` loops `np` players per stamped cell (`Vision.ts:533`), so an ally mask with more bits set
does not add iterations — the loop already runs over every player. I did not measure a teamed match.

---

## 7. Multiplayer — the merge layer is ready, the lobby and the drop rules are not

**READ throughout.** `server/README.md` describes a relay for 1v1 that runs no game code.

### 7.1 Already generic over N

`TurnRelay` takes `slots` as a constructor parameter (`TurnRelay.ts:103-108`); the gate is
`if (slot.reported < this.slots) return ...` (`:193`); the merge walks `0..slots-1` (`:200-203`);
departed slots are pre-filled rather than awaited (`:147-152`); `retire` sticky-retires a slot
(`:245-268`). `Match` is parameterised by `peers.length` (`server/src/Match.ts:60-91`) and `slotOf` is
`peers.indexOf` (`:212-214`). `validateCommand` bounds slots at 8 (`protocol.ts:372-374`).
`compareChecks` (`TurnRelay.ts:221-235`) is O(N) against the first non-null check, which is correct for
set-equality at any N, and it already emits a full per-slot `hashes` array. `Checksum.ts` iterates
`world.players` whatever its length.

**Host = 0 / guest = 1 is emergent from an array literal, not encoded.** Push a third peer in and it gets
slot 2.

### 7.2 The hard twos

1. **`Lobby.begin` is called with 2-element literals** — `server/src/Lobby.ts:269` and `:298`. `begin`
   itself takes arrays and is generic. These two lines are the server-side cap.
2. **A room is consumed on first join** (`Lobby.ts:267`, `dropRoom(room)`), asserted deliberate by
   `server/test/relay.spec.ts:232`. A 3-4 player room needs a room that *stays open and accumulates
   joiners* plus an explicit start trigger — a new lifecycle, not a parameter.
3. **The quick-match queue is one slot** (`Lobby.ts:88`).
4. **`RoomSummary` carries no occupancy or capacity** (`protocol.ts:222-231`), so "2/4" cannot be
   rendered. `start.factions[]` is already per-slot (`:527-537`); there is no `slots` field.
5. **`MultiplayerSetup.ts` has no army-count control at all** and never reads `MAX_ARMIES` or
   `MAPS[].players`.
6. **`Shell.seatPvpPlayers` silently clamps to two.** `Shell.ts:2113` —
   `const seats = Math.min(world.players.length, pvp.info.factions.length);` — and `world.players.length`
   is 2 from `Bootstrap.ts:167-168`. **The comment immediately above it
   (`Shell.ts:2105-2112`) claims it is "BOUNDED BY THE RELAY'S OWN SLOT LIST, not by a literal 2" and is
   currently wrong.** The fix pattern is ten lines below in `seatReplayPlayers` (`:2174-2178`), which
   grows the world to fit. Ship a 4-slot relay without this and slots 2-3 exist on the wire, their
   commands apply against players that do not exist, **both clients do it identically, and the checksum
   agrees the whole way down**. Silent.

### 7.3 The drop rules are written for two, and this is the real design work

- **One grace deadline for the whole match**, not one per slot (`Match.ts:54-55`, overwritten at `:149`).
- **`Match.ts:181-187`: grace expiry ends the entire match and awards it to `firstLiveSlot`** — the
  lowest-indexed survivor. With four players, one person's wifi ejects three others mid-fight and hands
  the win to whoever is seated earliest. This is the most disruptive two-player assumption in the stack.
- **The silence detector stops after the first casualty** — `if (this.graceDeadline === 0)` wraps the
  scan (`Match.ts:172-179`), so a second hang is invisible until the first grace expires.
- **`peerLost` carries no slot number** (`protocol.ts:541`), so a client cannot say *who* dropped.
- Copy is binary throughout: `'opponent-left': 'Your opponent disconnected. The match is yours.'`
  (`Session.ts:99`), `desync: 'The two games fell out of step...'` (`:101`), `'1v1 online'`
  (`MainMenu.ts:96`).
- **Desync ends the match for everyone** (`Match.ts:111-121`). With four players a 3-vs-1 split is the
  common case and the majority is almost certainly right; `compareChecks` cannot express "drop slot 2,
  continue".

**PROPOSED, and each is a real decision:**

- Per-slot grace deadlines; match ends when ≤1 live peer remains. Small change, obvious.
- A drop policy. The cheapest correct one is **drop ⇒ army defeated, match continues** — `TurnRelay.retire`
  already exists and `PlayerState.defeated` is already hashed. **The missing piece is a *deterministic*
  "slot N is out" signal**: retirement is currently a server-side scheduling fact, not a simulation
  event, and every client must mark the player defeated on the identical tick or it is an instant desync.
  No such channel exists. AI takeover has the same requirement and is explicitly out of scope at
  `Match.ts:183`. Reconnect is refused by design (`Transport.ts:22-27`).
- Majority-vote desync. Small change to `compareChecks`, but it needs the same deterministic removal
  mechanism, so it is downstream of the drop policy.
- Add `slots` to `start` and occupancy to `RoomSummary`. Additive, but `Session.describeBadStart` is a
  strict tripwire (`Session.ts:388`), so changing `start`'s existing fields means bumping
  `PROTOCOL_VERSION` (currently 1, `protocol.ts:70`, refuses rather than negotiates).

### 7.4 Cost, stated honestly

The turn gate is an AND over all slots and it **stalls, never skips** — so a third player is a third
stall source and expected stall time grows with N. `TURN_LOOKAHEAD` is 4 (`protocol.ts:105`) and was
chosen against one peer. **Whether 4 turns absorbs the worst of three peers is not measured anywhere in
this repo; there is no jitter or latency model.** Uncertain.

**No test anywhere constructs a 3- or 4-slot relay or match.** Every `new Match([...])` in
`server/test/relay.spec.ts` is the two-peer helper at `:52-60`; every `new TurnRelay(` in
`tests/net-lockstep.spec.ts` is 1 or 2. `TurnRelay.ts:88-96` records that the `gone` bug "survived being
written, reviewed and commented" and was caught only by that suite — which is the argument for writing
3-slot relay tests **before** trusting the genericity, not after.

**PROPOSED verdict: 3-4 player PvP is a separate project from 3-4 player skirmish, and should not be in
the same milestone.** The merge layer is free; the room lifecycle, the drop policy and the deterministic
removal signal are not.

---

## 8. Replays, saves, progression

Mostly good news, with one trap that only appears *after* §2 is fixed.

### 8.1 Replays

**READ.** `ReplayHeader.players` is already `ReplaySlot[]`, captured with `world.players.map(...)`
(`Replay.ts:233-244`), and `seatReplayPlayers` already grows the world to the header
(`Shell.ts:2166-2197`). `parseReplay` has no player-count ceiling (`:357-375`).
`REPLAY_FORMAT_VERSION` is 2 (`:82`) and a mismatch is refused with `!==` (`:396-401`).

**A format bump is not required for N armies** — the array grows rows, not fields. There is one argument
*for* bumping, and it should be recorded as a decision rather than skipped: a v2 file recorded with four
armies, opened by a build predating the grow-to-fit loop, would seat two, feed armies 3-4's commands to
nobody, and diverge. Because the check is `!==`, bumping would turn that into a refusal with a sentence.
**Uncertain** whether any such build is deployed.

**The trap:** `ReplayHeader` has **no explicit `armies` field**, and nothing calls `setPlannedArmies` on
the replay path either. Once §2 lands, a four-army replay will boot on **two-shelf terrain** — a
different heightfield from the one it was recorded on — which is a guaranteed checkpoint divergence.
**PROPOSED:** `Shell.startReplay` must derive the count
(`header.players.filter(p => p.faction !== Neutral).length`) and call `setPlannedArmies` before
`bootstrap()`, or the header gains an explicit `armies` field. Prefer the explicit field: deriving it
means the count is a function of a filter that could change.

**Unrelated but worth recording:** replays store `defId` as a **raw array index** (`Replay.ts:293`) —
into `DefTables.buildings`, or `DefTables.units` + `UNIT_PUBLIC_ID_BASE` (4096), or upgrades + 2048
(`Production.ts:144`, `:157`). Appending a def row is safe; **inserting or removing one shifts every
index past it** and a replay silently builds a different unit. Saves guard exactly this by storing a def
**key string** with the raw id as fallback (`SaveGame.ts:104-129`, `:608-610`); replays have no
equivalent. This is orthogonal to army count and is a pre-existing replay-rot risk. Army count does not
affect `defId` at all — confirmed, the catalog is faction-independent.

### 8.2 Saves

**READ.** The blob is fully N-correct — players, fog planes, superweapons, commander powers all loop the
real count, and `restoreSnapshot` calls `world.reset()` and re-seats the whole table. `SAVE_SCHEMA_VERSION`
1 needs no bump; `structuralHash` folds `MAX_PLAYERS`, which is already 8.

**The gap is the boot, and it is currently masked by the §2 bug.** `Shell.loadGame` (`Shell.ts:1673-1689`)
deliberately boots as a duel — `opponents: [{ faction: c.aiFaction, ... }]` — on the argument that the
blob re-seats everything. That argument is sound for the *player table* and **unsound for the terrain**:
the generator reserves one levelled shelf per army from `plannedStartPoints()`, so a four-army save booted
as a duel would restore its buildings onto a two-army heightfield. Today both the capture boot and the
restore boot always plan 2 armies, so they match by accident. **The moment §2 lands, this breaks.**

**PROPOSED:** `ServiceContext` (`save.system.ts:525-532`) gains an army count (or the full opponent list).
This is cheap and additive — `SaveSlotInfo.extra` is explicitly opaque (`SaveStore.ts:105-119`) and
`extraOf` already falls back field by field, so old rows degrade rather than break. The "would invalidate
every slot already on disk" claim in the `loadGame` comment is stronger than the code requires and should
be corrected in the same change.

Secondary: the load screen shows **no** opponent information at all (`LoadGame.ts:589-602`), so a
four-way save is indistinguishable from a duel in the list. UX gap, not correctness.

### 8.3 Progression

**READ.** Correct as-is. `MatchStartInfo` carries `localPlayer` and `faction`, filled from the world after
boot (`Shell.ts:1235-1240`). Every mission rule filters to the local slot before advancing
(`MissionTracker.ts:216-240`, `:604-606`), so an AI killing another AI advances nothing. `winsByFaction`
is keyed on the **local** faction and increments once per match (`:421-434`).

Two warts: `MatchStartInfo.difficulty` is the `opponents[0]` mirror and is **dead** — stored at
`MissionTracker.ts:379` and never read, despite the field comment claiming it is recorded on profile
stats. And `EvMatchStarted.playerCount` is `world.players.length` **including Gaia**, documented as not
an army count (`outcome.system.ts:246-253`); no subscriber reads it yet, and any N-army consumer must not
treat it as one.

---

## 9. Smaller gaps, each cheap

1. **`ai.system.ts` publishes `brains[0]` only.** `ai.system.ts:259-281` — `c.aiBrains` and `c.aiCommands`
   are totals, everything else (`aiPosture`, `aiArmy`, `aiStrike`, `aiWave`, `aiPressure`,
   `aiSuperweapons`, …) is brain zero. With three AIs the overlay shows one.
   **PROPOSED:** suffix the counters per brain (`aiArmy0/1/2`) or publish the local player's *nearest*
   threat rather than seat 1. Counters are numeric-only, so a per-brain suffix is the mechanical answer.
   `__VM.hooks.ai()` already returns the full snapshot, so the console is fine.
2. **`normalizeSetup` un-mirrors only the first opponent** (`settings-store.ts:912-915`), asserted by
   `tests/shell.spec.ts:260-264`. Opponents 1..n get no anti-mirror check, so a four-way of four Allies
   silently becomes Allies/Soviets/Allies/Allies.
   **PROPOSED: delete lines 912-915 rather than extend them.** The rule enforces a constraint the engine
   no longer has — `ScenarioBuilder` resolves bases by SLOT and remaps content to the owner's army
   (`Scenarios.ts:2180-2193`), and `SkirmishSetup.ts:30-39` already states "Mirror matches are legal" and
   names this as the one surviving caveat. Extending an obsolete rule to three more armies is the wrong
   direction. Update the test to assert mirrors are *allowed*.
3. **`EndScreen` shows one difficulty for N armies** (`Shell.ts:2546`, `EndScreen.ts:217-224`) — the chip
   reads "Soviet AI 1 · Meridian AI 2 · Reclaim AI 3 · Brutal". Either drop the difficulty when armies
   disagree or list per-army.
4. **Minimap pings are binary hostile/own** (`Minimap.ts:711`, all hostile pings `BLIP_ENEMY`) while blips
   are per-seat. Cheap inconsistency to close.
5. **`hostileColor` wraps past four** (`Chrome.ts:774`). Unreachable at N=4 (three hostiles max) and
   deliberate. Leave it; note it if N ever exceeds 4.
6. **Dead net code worth reviving, not deleting:** `stallMs()` / `sampleStall()`
   (`net.system.ts:152`, `:158`) are exported and called by nothing. With N peers a "waiting on slot K"
   indicator becomes considerably more valuable.
7. **`server/README.md:14` claims 31 server tests**; there are 60. Stale.

---

## 10. Work order, by dependency

Each step is gated on the one before it. The ordering is not preference — it is what the measurements
force.

**Step 0 — the wire (§2). Everything else is blocked on this.**
Call `setPlannedArmies` from the lobby; clear it on every non-skirmish path; add `?armies=`; make
`verifyArmies` fail loudly in dev. Add a test that a four-way lobby setup produces four openings — the
gap that shipped this bug is that `tests/archipelago.spec.ts` passes `armies: 4` **explicitly**, so it is
the only caller in the repo that does and it bypasses the missing wire entirely.
*Exit criterion: a four-army skirmish boots and four armies have bases.*

**Step 1 — measure what step 0 unblocked (§4.3).**
`npm run shots` on a four-army fixture; read `renderer.info.render.calls`; run `node tools/metrics.mjs`.
This is the number that decides §5 and possibly decides whether four *different* factions is the right
default. Do not skip it and do not decide §5 first.
*Exit criterion: a real draw-call figure for a four-army frame.*

**Step 2 — maps (§3).**
Ship the archipelago as a `MAPS` row (its four-army-ness is already proven by test). Re-derive
`START_MIN_SEPARATION` for a four-corner layout. Extend `tests/start-shelves.spec.ts` to the 124 m and
148 m seams. Author a four-army civilian composition or accept and document its absence. Re-shoot and
re-grade the fixtures.
*Exit criterion: at least one shipped four-army battlefield with measured buildability at all four starts.*

**Step 3 — the cheap correctness gaps (§9).**
Per-brain AI counters, delete the obsolete anti-mirror, end-screen difficulty, minimap pings. Independent
of each other; can be done in parallel with step 2.

**Step 4 — saves and replays (§8).**
`ServiceContext` gains the army count; `startReplay` sets the planned armies (or the header gains an
`armies` field). **This is not optional after step 0** — both paths regress the moment the terrain starts
reading the count. Add the first >2-army replay and save round-trip tests; there are none today.

**Step 5 — teams (§6).**
`team` on the setup, one `allyMask` writer, lobby chips. Ship AI allies as "will not shoot each other"
and name the absence of cooperation. Everything downstream already consults `areAllied`.

**Step 6 — per-slot in-world identity (§5).**
Only if step 1's draw-call number permits, and only after deciding A/B/C. This is the largest change in
the document and the only one that touches the grade.

**Step 7 — 3-4 player PvP (§7).**
A separate milestone. Room lifecycle, per-slot grace, drop policy, deterministic removal signal, 3-slot
relay tests. Fix `seatPvpPlayers`' silent `Math.min` clamp and its wrong comment regardless of whether
this milestone is scheduled — it is a live trap.

---

## 11. What I did NOT verify

Stated plainly, because a plan that hides its gaps is worse than one that admits them.

- **I never ran the game.** No browser, no WebGL, no frame. Every render and shader claim in §5 is read
  from source; the two "checked on screen" claims about buildings not repainting are the codebase's own
  testimony (`buildings.system.ts:128`, `BuildingDefs.ts:2035`), not mine.
- **Draw calls at four armies are unmeasured** and, as §4 explains, currently unmeasurable. The batching
  argument in §4.3 is a structural inference from `packKey`, not a measurement.
- **Full sim tick time is unmeasured.** I measured `Vision.update()` and `AiDirector.tick()` in isolation
  on a static opening census. Movement, steering, pathfinding, targeting, projectiles and damage were not
  timed at all, and several of those are superlinear in entity count. The +106% army-entity figure is the
  input to that question, not the answer.
- **No four-army match was ever simulated past tick 0** except the 600 AI ticks in §4.2, which ran against
  a world where nothing moved.
- **`frozen-sector`'s "cliffs channel every push"** is an authored judgement. I measured that its ground
  holds four bases; I did not and cannot measure whether it *plays* as a four-way.
- **`coral-shore`'s numbers are computed, not built.** I built and measured `contested-strait` at four
  armies; `coral-shore`'s 4.95 m figure comes from applying `resolveStarts`' own arithmetic to the shipped
  constants. The method reproduces the documented 14 m / 6 m clearances for slots 0-1 on both maps, which
  is why I trust it, but it is arithmetic rather than a generated heightfield.
- **`TERRAIN_SEA_BEACH_GRADE` disagrees with itself.** `config.ts:2142` reads 0.12;
  `tests/archipelago.spec.ts:480-484` quotes 0.26 in a comment. One is stale. I did not resolve which and
  it does not change any conclusion here.
- **PvP latency.** Whether `TURN_LOOKAHEAD = 4` survives an AND-gate over three peers is unmeasured and
  there is no model in the repo to reason from.
- **Whether any deployed build predates `seatReplayPlayers`' grow loop**, which is the only real argument
  for a replay format bump.
- **The cost of a team-slab mask channel** in the greeble atlas — the biggest sizing unknown in §5.
- **`deploy/nginx.conf` and `voltmarch-relay.service`** were not read. Nothing suggested a player-count
  coupling, but I did not look.

---

## 12. One thing to keep

The reason this feature is in the state it is: **two commits each did their half correctly and neither
one owned the join.** `eddf096` taught the lobby to count to four. `fdb9bd8` taught the start table to
count to four. `setPlannedArmies` was written, documented at length as the channel between them, and
never called — and the tripwire that catches exactly this (`Shell.verifyArmies`) was written in the same
period, fires correctly, and logs to a console nobody reads.

That is the same defect `docs/SPEC_DRIFT_AUDIT.md` catalogues, in a new place: a claim that is true of
each part and false of the whole. **A `console.error` is not a mechanism.** Step 0 makes it one.
