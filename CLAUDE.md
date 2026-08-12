# CLAUDE.md

Working notes for Claude Code in this repository. Read this before changing anything.

## What this project is

VOLTMARCH — an original browser RTS in Three.js. Four playable factions, ore economy, base
building, AI opponent, fog of war. **All art is generated from code**: no downloaded models and no downloaded
textures.

That claim is about the GAME WORLD, and it is exactly true there: every mesh, material, texture,
cameo and in-game icon is built from Three.js geometry, custom shaders and procedural canvas
generators. **Three shipped assets are not generated**, all deliberate, all in `public/`:

1. **Rajdhani** (OFL-1.1) in `public/fonts/` — the UI text face, Latin subset, four weights, 60 kB.
   Added 2026-08-05 at the user's request. The stack had named Rajdhani since it was written and
   nothing ever shipped it, so every menu and HUD rendered in the fourth fallback — Franklin Gothic
   Medium — and the face the UI was designed around was never on screen.
2. **The brand lockup** in `public/brand/` — seven PNGs derived by `tools/brand.mjs` from a
   `logo.png` the user supplied, which is kept as `tools/brand-source/logo-source.png`.
   `logo-full.png` is the main-menu title and the loading curtain; `mark-*.png` are the favicons
   and app icons. See `public/brand/README.md`. This said "eight PNGs derived by" while one of the
   eight was the underived SOURCE, sitting in the shipped directory and being published unused.
3. **Recorded audio** in `public/audio/` — 184 Ogg files, 6.9 MB, added 2026-08-09 at the user's
   request. `sfx/` covers **all 39 sound-effect families** (CC0), `voice/` gives the unit barks two
   real voices (Kenney, CC0), and `eva/` is the announcer, **rendered speech** rather than found
   audio. Sources: Kenney, several CC0 libraries via
   [CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds), Warfork
   by Team Forbidden, and Piper for EVA. `music/` is a three-tier adaptive score by Kevin MacLeod,
   **CC-BY 4.0** — the only attribution OBLIGATION in the product, and the reason `public/audio/`
   is no longer CC0-only. See `public/audio/README.md`. Only ambience is still synthesised.

   **EVA is re-renderable**: `py tools/render-eva.py <scratch-dir>` reads the line texts straight
   out of `EVA_LINES` and writes `public/audio/eva/`. It refuses to run if it parses fewer lines
   than the table declares — a guard added because the first version matched only single-quoted
   strings and silently skipped `allyUnderAttack`, whose text is double-quoted for containing an
   apostrophe. The voice model is 109 MB and gitignored; only the ~405 kB of Ogg is committed.

   **The voice was chosen on its licence chain, not its sound.** `en_GB-cori-high` is LibriVox
   (public domain) data, trained from scratch, so it avoids the research-only Blizzard/Lessac terms
   that encumber most of Piper's English catalogue — including `hfc_female`, which every "best
   Piper voice" guide recommends. Never cite the `rhasspy/piper-voices` repo tag: it says
   `license: mit` while containing voices whose real terms are non-sublicensable research-only.

   **This was not a bug fix.** `tools/audio-measure.mjs` scored the synthesised bank at 8–24 dB
   crest with spectra in band, i.e. correct by every number the harness reports, and it still read
   as a synth patch. That gap — measured-correct and audibly wrong — is the honest reason for the
   change, and it is why the recordings go through the SAME bake: same saturation, same peak
   normalisation, same variant set, same `BufferSource -> gain -> panner -> bus` at runtime. Only
   the source of the buffer differs. Every sample-backed spec keeps its recipe as a fallback, so a
   404 degrades to the old bank and never to silence.

   **The measurement is a proxy; the ear is not.** An intermediate pass reverted twelve families
   to their recipes because the takes scored worse on centroid or attack time. On hearing the
   result the user's verdict was that the synthesised sound was the problem in every one of those
   cases, and that is the correct authority — `tools/audio-measure.mjs` scores a spectrum, and a
   spectrum is a proxy for "does this sound like the thing". Where the two disagree, believe the
   ear. **Do not revert a family to its recipe on a measurement argument.**

   What the harness is still the right tool for is the failures nobody can hear until too late: a
   take longer than the buffer it bakes into (eight families would have shipped truncated), a
   transient that never arrives, a level that clips the bus. Those checks live in
   `tests/audio-samples.spec.ts` and should stay.

   **Two things that must not be undone.** Takes are trimmed on an Ogg PAGE boundary, which lands
   mid-waveform, so `sampleInto` fades the last 20 ms unconditionally — remove it and the whole
   bank clicks. And `engine.light`/`engine.heavy` are looped rather than fired, so they were
   deliberately not trimmed; cutting them puts a seam in the loop that repeats forever.

   **When a listing page and a bundled licence disagree, the bundled file wins.** A gunshot pack
   listed as CC0 on OpenGameArt shipped a `creativecommons.txt` reading CC-BY 3.0, under a
   different author's name than the page credited. It was rejected rather than shipped mislabelled.

4. **The README key art** in `docs/hero.png` — an illustration the user supplied on 2026-08-12,
   784 kB, downsampled to 1600px. It is the ONLY entry in this list that is **not shipped**: it
   lives in `docs/`, not `public/`, so it is in no bundle, reaches no player, and is deliberately
   NOT in the credits screen — `tests/credits-truthful.spec.ts` checks that screen against
   `public/`, and adding a line for a file the game never loads would make the credits less true,
   not more. It is listed here because the rule below is about assets nobody generated, and the
   next person to audit this list should not have to rediscover why the README opens with a
   painting. The README labels it as key art and keeps the in-engine capture directly beneath it,
   because a photoreal illustration sitting above the sentence "all art is generated from code" is
   exactly the quiet falsehood `docs/SPEC_DRIFT_AUDIT.md` catalogues.

This paragraph previously said "cameos, icons and the wordmark are still all generated", which was
false on two counts the moment the brand assets landed — the wordmark on the title screen and every
favicon are those PNGs. It said so directly under an instruction to update it in the same commit as
any new asset, and that did not happen. `tests/credits-truthful.spec.ts` now checks the credits
screen against what is actually in `public/`, because the reason this rotted is that nobody was
looking, and a reviewer noticing is not a mechanism.

**If you add another non-generated asset, update this list, `README.md`, and the credits screen in
`src/shell/MainMenu.ts` in the same commit** — a claim that quietly stops being true is the exact
defect `docs/SPEC_DRIFT_AUDIT.md` catalogues.

## The gates

Every change must leave these green. Run them; do not assume.

```bash
npm run typecheck    # must exit 0 — real fixes, never `any` or @ts-ignore
npm test             # vitest, currently 3318 across 129 files (+1 opt-in probe)
npm run build        # must exit 0
npm run server:test  # the relay's own 60, via node --test
```

**The fourth typecheck invocation needs `server/node_modules`, and a root `npm install`
does not create it.** On a fresh clone — and in EVERY `git worktree`, since worktrees do
not copy `node_modules` — `tsc -p server/tsconfig.json` dies on
`TS2307: Cannot find module 'ws'`. That is a missing prerequisite, not a defect in your
change; three parallel agents each independently reported it as a failing gate. CI does
not hit it because `.github/workflows/deploy.yml` runs `npm ci --prefix server`. Do the
same locally before believing a red fourth invocation:

```bash
npm ci --prefix server
```

**The first line said `npx tsc --noEmit` and that is NOT the gate.** `npm run typecheck`
is now FOUR invocations — `tsc --noEmit`, then `-p tsconfig.node.json`, then
`-p tsconfig.test.json`, then `-p server/tsconfig.json` — because the root config's
`include` is `src/**/*.ts` only. `tests/**` and `vite.config.ts` are checked by the
next two, deliberately: test files need `process` and `node:fs`, which game code must
never see. The fourth is the multiplayer relay, whose own `include` is the security
boundary described in `server/README.md` — it can see four files and importing `three`
or `src/sim/**` is a build error rather than a review note.

So the documented command typechecks the game and silently skips every spec file, and
CI runs `npm run typecheck`. That gap shipped a v1.31.0 deploy that failed on five
`TS2476` errors in two new spec files after a local run had reported success — the
reverse map of a `const enum` (`Faction[f]`, `UnitState[n]`) is illegal under
`isolatedModules`, and nothing local was looking. Run the npm script, not the binary.

**`npm test` has no known flake.** That sentence used to read "There is no known flake", full stop,
and it was quoted as covering the whole project — including `npm run shots`, which is the only
mechanism enforcing `docs/RA3_LOOK_BIBLE.md`. It never covered it, and the visual pipeline had
three defects that each produce a confident wrong image. See **The look is measured, not judged**
below and the header of `tools/shoot.mjs`; the short version is that the harness could photograph
ANOTHER WORKTREE'S BUILD and report `12/12 captured`, which is what "the shot harness is
nondeterministic" turned out to be. The residual after the fix is bounded and characterised: the
fixtures that do not show the HUD are byte-identical run to run, and the three that do vary on
exactly one row by at most 2/255.

The one flake `npm test` ever had was `perf-hud.spec.ts` "allocates nothing per frame" — it
compared GC counts with a tolerance of 2 and occasionally reported 3 in a full run. It was TWO bugs
in the test, neither of them in `PerfHud`:

1. The harness allocated. Its injected clock was a closure-captured `let`, and a captured double
   lives in a V8 context slot with no in-place mutation, so `clock += VSYNC_60` boxed a fresh
   HeapNumber every iteration — megabytes of young-generation garbage over the million frames the
   test drives. It is a `Float64Array(1)` now, which is raw storage and boxes nothing.
2. The counter counted the wrong things. It took EVERY gc entry — `major` and `incremental`
   included, which are the collector's own background schedule — and its 30 ms delivery wait was
   inside the counting window. It now filters to `NODE_PERFORMANCE_GC_MINOR` and to entries whose
   `startTime` falls between the two `performance.now()` marks around `run`.

The assertion is `toBe(0)`, exactly, and both halves are load-bearing: restoring either one fails
the test under `--max-semi-space-size=4`. The count tracked V8's new-space size rather than the
code, which is why it moved with machine load. **Do not reintroduce a tolerance** — a non-zero
`sampled` now means the sample path really did allocate.

`npm run build` deliberately does **not** typecheck. esbuild strips types, so a type error must never
stop the game from running. That is what `npm run typecheck` is for. Do not "helpfully" wire tsc into
the build.

## Architecture in one page

- **`src/core/`** is frozen infrastructure: `types.ts` (every shared type, `SystemModule` is the
  plugin contract), `config.ts` (all tunables and the art direction), `world.ts` (`EntityStore`, a
  fixed-capacity SoA of parallel typed arrays with generation-stamped handles), `loop.ts`
  (fixed 30 Hz sim decoupled from render, plus `SystemRegistry`), `events.ts`, `math.ts` (seeded
  RNG), `assets.ts` (procedural texture factory).
- **A module joins the game by existing.** Drop a `*.system.ts` anywhere under `src/` that
  default-exports a `SystemModule`; `src/game/Systems.ts` discovers it by glob and logs what
  registered. Never edit `Bootstrap.ts` or `Systems.ts` to register something.
- **Reach the world through `ctx()`** from `src/game/context.ts`. It is valid from `init()` onward
  and throws at module top level — build meshes inside `init`, not at import time.
- **Phases** are the numeric enum in `types.ts`: Command 100, Production 200, Economy 300, AI 400,
  PathRequest 500, Steering 600, Movement 700, SpatialRebuild 800, Targeting 900, Weapons 1000,
  Projectiles 1100, Damage 1200, Vision 1300, Cleanup 1400.

## Multiplayer is deterministic lockstep, and the server never simulates

`src/net/` is the client half, `server/` is a relay that forwards turn frames and runs no
game code. Read `server/README.md` before touching either.

- **The relay stamps identity; the simulation enforces authority.** Every inbound command
  has `player` overwritten with the slot of the socket it came from, and the sim already
  refuses anything a slot does not own. So a spoofed slot does nothing.
- **`validateCommand` in `src/net/protocol.ts` is ONE pure function with TWO callers**, and
  they do different things with a rejection. The server FILTERS (before broadcast, so it is
  consistent for everyone). A client TRIPWIRES — it ends the match rather than dropping the
  command, because dropping it on one client and not the other is a desync with no findable
  cause. Do not "helpfully" make the client skip a bad command.
- **`CommandBus.harvest` is not `drain`.** Harvest skips the recording tap, because a
  multiplayer command crosses the bus twice — once when clicked, once when its turn comes
  up. Using `drain` for the harvest logs everything twice; that is trap 2 in
  `src/game/Replay.ts`, rediscovered by a different route.
- **`net.system.ts` is `Phase.Command` order 0** and that number is the whole design: it is
  the only point at which a local command can be taken off the bus before a consumer
  applies it. It is inert until `attachSession()`, so single player is unchanged.
- **The step gate stalls, it never skips.** Wall-clock divergence between two machines is
  irrelevant to lockstep — tick N is tick N whenever each one gets there. Executing a turn
  without a peer's commands is permanent divergence.
- **`tools/desync-probe.mjs` is the cross-engine check** and its baseline
  (`tools/desync-reference.json`) is committed so one engine at a time, on one machine at a
  time, still adds up to a comparison. It refuses to overwrite a divergence it found — an
  instrument that erases its own finding is worse than none.

## Replays are the same mechanism, pointed backwards

Every match records itself unconditionally (`src/game/replay.system.ts`), and since v1.32.0 the
product can open one: **Replays** on the title screen, `src/shell/Replays.ts` for the screen and the
in-match strip, `src/game/Playback.ts` + `playback.system.ts` for the feeding.

- **A replay is a header plus a command stream, and the header is the boot.** `mapSeed` is the
  TERRAIN roll (`?mapseed=`); `simSeed` is `?seed=`, which drives the scenario layout and every draw
  of `s.rng`. v1 stored only the first and called it "the seed", so a v1 file could reproduce the
  hills and nothing else. It also missed the map preset, the biome, the opening and the starting
  bank. `REPLAY_FORMAT_VERSION` is 2 and a v1 file is REFUSED — it describes a match this build
  cannot rebuild.
- **The header is taken in two parts.** `init()` sees the URL but not the lobby: the shell writes
  the chosen factions after `bootstrap()` returns and the bank after `await game.ready`, and the
  scenario (which adds Gaia) has not run. `ReplayRecorder.captureStart` takes the rest on the first
  sim tick — the earliest moment all of it is true and the latest moment none of it has changed.
- **The unlock gate is the tick-zero desync, again.** `Scenarios.ts` asks `isBuildable` while
  spawning the STARTING ARMY and it answers from the LOCAL PROFILE, so a veteran's recording watched
  on a fresh account starts with a different army. Playback calls `suppressUnlockGate(true)`, exactly
  as PvP does, and `Shell.startMatch` now clears it for any ordinary launch — which also closes the
  leak where one PvP match left every later skirmish ungated.
- **Every seated slot is `isHuman`**, which is the whole AI shutdown. The recording ALREADY holds
  the AI's commands, because the brain issues them through the same bus a player does.
- **`playback.system.ts` is `Phase.Command` order 1** — before the drain at 9000, or every command
  applies one tick late forever. It harvests the bus first, which is the input lock: a viewer's slot
  IS the recorded player's slot, so their right-click would otherwise be accepted.
- **Its `dispose()` calls `detachPlayback`, not `endPlayback`.** `startReplay` arms the file and then
  boots, and booting disposes the previous engine — clearing the armed file there meant the viewer
  silently got an ordinary AI-less skirmish on the recording's seed. Same split as `net.system.ts`.
- **`npm run replay-probe` is the proof**, and its second phase is the load-bearing one: it deletes
  one command and requires the playback to diverge. A matching hash alone would also be produced by a
  playback that fed the world nothing, because the AI is deterministic from the same seed.
- **`buildVersion` warns and does not refuse.** It is a correlation, not a cause — most releases here
  touch art the sim cannot observe — and the real question is measured every 30 ticks by the
  checkpoint compare, which the bar puts on screen. See `Replay.buildWarning`.

## An economy can stop dead, and one rule exists to unstick it

Reported as *"if my ore harvester being smashed and i dont have any money left.. how can i make a
progress?"*. `Viability` asks whether a player can still PLAY and says yes for a base full of
producers with an empty bank; nothing asked whether they could still EARN. `src/sim/OreCrisis.ts`
is that second question and `orecrisis.system.ts` is its two consequences.

**The dead end is real and it was measured, not argued.** Selling refunds `SELL_REFUND` = 0.5, so
both routes out are self-blocking: buying a miner needs the refinery AND the vehicle factory
standing (they are its prereqs, and they are the two most valuable things you own), and rebuilding
the refinery for its free miner costs 2000 against the 1000 the old one pays. Enumerated
exhaustively over the real bound catalog in `tests/ore-crisis.spec.ts`, **Construction Yard + power
+ refinery — the ordinary second-building state — is unrecoverable for all four armies**, as is
refinery + factory + power with the yard bombed.

So the predicate is three-valued. `SellOut` (selling genuinely covers it) gets a chip and
`EvaLine.NoOreMiner` naming the sell tool, and nothing else. `Stranded` gets a standing refinery
redeeming its `shipsWith` promise after ten seconds. **That is a free harvester and this file will
not pretend otherwise**; what makes it defensible is that all four gate clauses must hold together
and the fourth is A FINISHED REFINERY STANDING — so killing the refinery, which is the economic
target in every game in this genre, still starves the opponent out. It binds the AI identically,
because it moves entities and a rule that bound only the human would desync a lockstep match.

Two things to leave alone. The chip's detail line is one nowrap line of ~45 characters and the
first version put the instruction past the ellipsis — lead with the verb, and screenshot it if it
grows. And do not "simplify" the predicate to "no miner and no money": two refineries refund
exactly 2000, which buys a fresh refinery, which ships a miner, and that player must NOT be handed
one.

## Commander powers are BOUGHT, and that is the shape of the whole feature

Five player-level support powers — Airstrike, Orbital Scan, Emergency Repair, Ore Boost,
Chronoshift. Until v2.6.0 they were a MISSION reward: five missions wrote `power.airstrike` and
friends onto the local profile, `powersOwnedBy` read localStorage, and `src/sim/CommanderPowers.ts`
carried forty lines explaining why the SIMULATION was forbidden to ask whether you owned one — a
profile-based refusal lands on one machine only, mid-match, at the exact tick a player presses a
button, with no checksum that catches it earlier.

They are earned inside the match now. **A building is world state**, and that single sentence is
the reason this was worth doing: same on both clients, visible to the AI, in the checksum, in the
save, in the replay. The tightrope is gone and `use()` may finally refuse.

- **The Command Post is the gate.** `commandPost` (Allies + Soviets), `mrdPharos`, `rclSignalRig` —
  the `battleLab`/`mrdReliquary`/`rclCrucible` shape, three defs and four mass lists. 1500 credits,
  20 s, **-80 power**, off the radar tier. It is the ONLY thing in the game that declares
  `producesTabs: [BuildTab.Powers]`, and `tests/command-post.spec.ts` pins that.
- **`BuildTab.Powers = 4`, `BUILD_TAB_COUNT = 5`.** Appended, never inserted: the enum indexes
  `PlayerState.queues`, `HudSnapshot.cameos`, every flat `(player, tab)` array, and it travels on
  `Command.tab` across the wire and into replays. **Grep for hard-coded fours before you touch
  anything tab-shaped** — `AI.canQueue` tested `tab > 3` and `AI.inFlight` was `Int32Array(4)`, so a
  Brutal brain built its Command Post, banked thirty thousand credits and bought nothing. Nothing
  threw, nothing logged, and the whole suite was green. It took booting a match to find, and two
  test fakes had the same literal.
- **`BuildKind.Power = 3` is `BuildKind.Upgrade`'s twin.** Same queue, same drip payment, same
  cameo grid, same `availabilityOf`; it leaves a bit in `PlayerState.commanderPowerMask` instead of
  `upgradeMask`. `POWER_PUBLIC_ID_BASE` is **3072**, splitting the old 2048..4095 upgrade window in
  half — both halves stay under `WIRE_LIMITS.maxDefId` 4095, and `resolve()` tests the NARROWER
  range first so every existing upgrade id still resolves to the entry it always did.
- **The tab needs the lights on, and that is the one place buildability is gated on power.**
  `census` skips a Powers-tab publisher that is not `EntityFlag.Powered`. The standing note that a
  brownout must never revoke a prerequisite is about the ROUTE OUT of a blackout — build a plant,
  from the Structures tab, which is not gated and never will be. Nothing in the Powers tab is a
  route out of anything, so this cannot soft-lock.
- **A Command Post is not a producer.** It carries neither `IsBuilder` nor `IsFactory`, and
  `Viability.defaultIsProducer` skips the Powers tab explicitly. A tab that makes nothing cannot
  tell a stranded player they can still play — the Refinery's problem, in that function's own
  header. It also keeps the structure in the power grid's FIRST shed class, which is what closes the
  tab in a brownout.
- **The AI earns them the same way.** `BuildRole.CommandPost` / `BuildRole.CommanderPower`,
  `considerCommandPost` and `considerPowers` in `AI.ts` (the `considerUpgrades` twin, ask-tick and
  all), gated by the SAME `powerMask` that already decided whether the rung may CALL one. Easy has
  mask 0 and builds no Post at all.
- **The five missions that used to pay the powers pay real content now.** `unit.commander` (the four
  heroes), `struct.support` (the three repair depots) and three new battlefields. The `power`
  `Reward` variant is deleted rather than left as a schema nothing produces — see the block in
  `src/data/Missions.ts`.

## Four armies, four islands, and a road made of water

**Sunder Atoll** is the map the navy exists for: four islands, one army each, **53.80% water** on the
shipped seed, and no land route between any two of them. Ten battlefields ship now
(`MAPS` in `src/shell/settings-store.ts`); three carry a real sea.

- **The 54% is a ceiling, not a taste.** A start shelf needs 96 m of dry ground in EVERY direction
  (`TERRAIN_START_FLAT_RADIUS` 58 + `TERRAIN_START_EDGE_WOBBLE` 14 + band 6 + waviness 8 +
  `TERRAIN_SEA_START_CLEARANCE` 10), so four islands cost 4·π·98² = 120 700 m² of a 262 144 m² map.
  Wetter means shrinking a global promise or seating fewer armies. See the block above
  `ARCHIPELAGO_SEA` in `src/game/Scenarios.ts`.
- **The islands are AXIS-ALIGNED ellipses and must stay that way.** Rotating one needs `sin`/`cos`,
  and **ECMA-262 does not pin those to bit precision** — only `+ - * /` and `Math.sqrt` are exact.
  Terrain generates independently on both machines of a lockstep match, so a rotated island is a
  tick-zero desync waiting for two engines to disagree in the last mantissa bit. `ellipseDistance`
  in `src/world/terrain-gen.ts` uses the first-order (Sampson) distance for the same reason: the
  exact ellipse distance has no closed form, and a Newton iteration whose count depends on a
  convergence test is a determinism liability.
- **`mapSupportsNaval` and `mapLandLinked` are different questions and neither substitutes.**
  `src/sim/NavalWater.ts` asks whether there is enough open water for a navy to be a thing;
  `src/sim/LandRoutes.ts` asks whether the ground is one piece. `mapForcesSeaCrossing` is the AND —
  water present *and* ground split — and it is true on the atoll alone.
- **The map-capability gate:** no navigable water means no naval content is offered at all. Verified
  over all ten shipped maps in `tests/sea-crossing-gate.spec.ts`, which is the only test that loops
  the whole roster.
- **THE NAVY IS NOT PROGRESSION-GATED, ANYWHERE, AND THAT IS DELIBERATE.** `struct.naval`,
  `unit.naval` and `unit.naval.capital` are deleted — from `UNLOCK_TAGS` and from `UNLOCKS`, not
  merely unreferenced. The exemption they needed (`isSeaMobility` + `mobilityExempt`) is deleted
  with them. Do not reintroduce any of it.

  The old rule was *content required to reach the enemy is never progression-gated*, and it fired
  only where `mapForcesSeaCrossing` — water present AND ground split — which is Sunder Atoll and
  nowhere else. So on Contested Strait and Coral Shore, the two battlefields the lobby sells as
  naval, a partially progressed profile got no dock, no lift and no warship; `UnlockGate.mirrorAI`
  resolves the AI against the human's profile, so BOTH sides were dead and the water was scenery.
  The maps also arrive long before their content — Contested Strait is paid by one win under
  fifteen minutes, `struct.naval` wanted ten wins on an independent chain — and its own lobby blurb
  reads "Naval yards earn their cost here."

  The in-match gates are untouched and they are the right ones: a dock needs a real coast, every
  hull needs a dock, and the four capital ships need the army's tech structure.
  `tests/sea-crossing-gate.spec.ts` now pins the RULE — no sea-bound entry may name an unlock id —
  so the next hull added behind one fails there rather than in a player's match.
- **`waterOnly` and `warship` are two fields because they are two questions.** This was one bit
  named `naval`: `spawnUnit` read it as "water-only" and `isSeaMobility` read it as "warship",
  defining the exemption as the flag's ABSENCE. The line was drawn at "does it carry passengers", to
  protect the unarmed Hover Transport's ability to beach — and two hulls have a hold AND a gun.
  `mrdSkiff` is intended (a Pact land raider gated on a land structure; the whole army hovers).
  `rclScow` was not: a dock-built, naval-sortOrder hull with a 68-damage HE bow gun that could drive
  inland and shell a base. `tests/naval-shore.spec.ts` asserted that roster verbatim under the name
  "marks exactly the gunned hulls as warships" while excluding two gunned hulls, so the test pinned
  the defect rather than catching it.

  **The rule now: a hull a SHIPYARD builds never touches dry land, carrier or not.** A carrier does
  not need to beach — `Transport.place` walks a widening ring for a cell the PASSENGER can stand on
  and puts the squad on the sand from open water, which is how the AI has landed all along. A land
  unit that swims is a different thing and keeps `waterOnly: false`.
- **Naval hulls carry `MoveClass.Naval`**, yards require a coast, and the beach profile is piecewise
  so a dock can actually be placed: coastal buildable ground went 16.4% → 57.4% on contested-strait,
  and coral-shore had **zero** legal dock sites before.
- **The AI got a navy** — sea survey, a dock on a shore it walks to, warships holding a lane, and an
  amphibious Board/Cross/Land cycle. Landings on the atoll went 0 → 12. `npm test` deliberately does
  not run that proof: `tests/amphibious-landing.spec.ts` is the one opt-in file, skipped unless
  `VM_LANDING_PROBE` is set, because it drives a real 24-minute four-army match and "the brain lands
  twelve times" is a fact about one seed rather than an invariant.

## Cargo is SLOTS, and a carrier is not a bench

Reported as *"limited to 1 type of ship only that carries 4 troops each"*. Exactly true:
`cargoSlots > 0` was set on three defs in the whole game, one per army — and the carrier took
INFANTRY ONLY, so on Sunder Atoll, where no two armies share a land route, the entire vehicle
roster was unusable against three of your four opponents.

- **Infantry cost one slot, a vehicle costs two** (`SLOT_COST_BY_KIND` in `src/sim/Transport.ts`).
  Eight slots is four tanks, or eight riflemen, or any mix. `UnitDef.passengers` is `cargoSlots`.
- **`refusalFor` refuses a carrier as cargo**, and it is the only thing that does. `capacityAt`
  answers for any non-Building, nothing detects a cycle, and two hulls each holding the other would
  copy each other's position forever. Nesting used to be prevented as a side effect of the
  infantry-only rule; removing that rule without this line reopens it.
- **`store.carrierId` is a real column** — saved through `REF_COLUMNS`, hashed by
  `Checksum.hashEntities`. It was a service-private `PerEntityU32`, which was two live bugs: a load
  bumps every `store.gen[i]`, so the stamp check returned 0, `ride` skipped at `held === 0`, `strand`
  was unreachable, and **every passenger in every saved game came back `Alive | Garrisoned |
  Immobilized` with no host** — unrenderable, unselectable, untargetable, unmovable, permanently.
  And two lockstep clients that disagreed about WHICH hull a man was in produced an identical
  checksum. `GarrisonService` still keeps occupancy in a side array and still has the first half.
- **`UnitState.Drowned` exists to sit on the far side of `Damage.cleanupTick`'s early return for
  `Selling`.** A sunk transport's squad and a levelled garrison's occupants reached neither
  scoreboard while comments in both services promised they did.
- **A carrier comes to the shore when you load it.** `TransportService.callHullIn`, off the same
  `OrderKind.Enter` a right-click produces. Water is impassable to `MoveClass.Foot`, so
  `Flowfield.snapToReachable` pulled the squad's goal back to the last dry cell and they stood on
  the sand while `board` re-stamped the order every tick — 0 aboard, forever. The AI had worked
  around this privately by steering its own hull onto a LAND cell; that is deleted, because carriers
  are `waterOnly` now and the destination was unreachable.
- **The swimmers are `Locomotor.Foot` plus an `amphibious` def bit → `MoveClass.Hover`.** NOT a new
  `Locomotor` member: `passGrid` sets bits 0-3 only and `findEgressSpot` asks
  `isPassable(cx, cz, loco)`, so a locomotor with no bit is impassable on every cell of the map and
  the finished man would sit `ready: true` at the head of the Infantry queue forever, silently, with
  the player already charged, blocking every rifleman behind him. That is the aircraft egress bug.
- **`movesShareSpace` replaced `(jc === Naval) !== (cls === Naval)`** in `Steering` and
  `Movement.relax`. The old test is right for a world of ships and tanks and wrong the moment
  anything amphibious exists: a destroyer drove straight through the Pact's entire hover army with
  no separation and no hard relaxation. Silent interpenetration, not a collision.

## Hard rules

- **Determinism.** Inside `simTick`, `Math.random()`, `Date.now()` and `performance.now()` are
  banned — there is a test asserting this. Use `s.rng` and the tick counter. This is not
  hygiene any more: it is what makes multiplayer possible at all.
- **Performance.** 200+ units at 60fps, zero allocation in the frame loop, and a draw-call budget of
  130 — which is a TARGET, not a description. Measured on the thirteen capture fixtures via
  `renderer.info.render.calls` and reported per shot in `shots/_report.json` as `frame.drawCalls`,
  the real figure is **174–273** (that count includes the three CSM shadow cascades): `08-naval-water`
  is the cheapest at 174, `01-establishing-base` the dearest at 273. This line read "under 130 draw
  calls" as a statement of fact while the counter disagreed by more than 2×; `MAX_DRAW_CALLS` in
  `config.ts` is the aspiration and `AdaptiveResolution`'s own header already records a profile at
  203. Do not quote 130 as achieved, and do not spend draws freely on the grounds that the budget is
  fictional — closing that gap is real outstanding work. **Requote this range from a real
  `_report.json` rather than carrying it forward**; it has drifted upward twice, and the top of it
  moved 263 → 273 while nobody was looking. InstancedMesh for anything repeated, pools for anything
  spawned, caller-supplied output arrays in query paths.
- **The AI issues the same commands the player does**, through `channels.command`. It must never
  reach into entity state directly.
- **No `AmbientLight` anywhere.** `HemisphereLight` only — a flat ambient kills the shadow tint that
  the whole grade depends on.

## The look is measured, not judged

[`docs/RA3_LOOK_BIBLE.md`](docs/RA3_LOOK_BIBLE.md) is the visual law: camera, lighting, palette,
materials, prop density, and a weighted scorecard with explicit pass conditions. It wins over
instinct and over Three.js defaults.

Before claiming a visual change worked:

```bash
npm run shots                        # capture the scenario set at 1440p
node tools/metrics.mjs shots/*.png   # score it
```

`tools/metrics.mjs` reports median luminance, saturation, black/highlight percentiles, hue leakage,
edge density and aerial-perspective delta against measured targets. **Luminance is quoted in sRGB,
not linear** — the bible's numbers are perceptual, and mixing the two frames makes the scene look 3×
darker than it is. This bit me once already.

Things that are explicitly banned because they read as "generic engine" and lose points: fog on
daylight maps, chromatic aberration, film grain, depth of field, motion blur, and reflective water.
If a change would add one of those, it is wrong even if it looks fine in isolation.

### What the harness guarantees, and the one thing it does not

There are **thirteen** fixtures — `01`..`12` plus `13-atoll-crossing`, the only one not posed on the
map centre, because on Sunder Atoll the map centre is the lagoon. Ten of the thirteen do not show
the HUD.

Two captures of one build are BYTE-IDENTICAL for the fixtures that do not show the HUD — measured
over 6 idle runs, 5 runs under 14 saturated CPU threads, and 6 runs after the fix below, on the nine
such fixtures that existed at the time. "The pixels did not change" is therefore a real statement
about those nine, and any diff in them is a real change. `13-atoll-crossing` was added afterwards
and has **two** runs behind it, both identical — the same claim, on far less evidence, and worth
saying so rather than quietly widening "nine" to "ten".

The three HUD fixtures — `02-hud-full`, `09-placement`, `10-selection` — each have at least three
states, and the entire difference is **one row, y = 91, at most 2/255**, inside x 744..1141. That is
the bottom edge of `.vm-panel::after` (the lit inner bevel: a `linear-gradient` behind a
`drop-shadow`, inside a parent carrying `backdrop-filter`), and it is a Chromium rasterisation
decision taken ONCE PER PAGE — four screenshots of one page are byte-identical, two pages of one
build disagree. Layout is not involved: four boots report the panel and all ~60 of its descendants
at identical geometry to four decimals. It cannot be fixed from the harness and a retry cannot
converge on a value. **Do not add a pixel tolerance to `tools/metrics.mjs` to paper over it** — a
tolerance there hides exactly the regressions the harness exists to catch.

Because that decision is per page rather than per run, two runs CAN agree by chance and one pair of
matching HUD captures proves nothing. A recent pair came back 13/13 identical, HUD fixtures
included; that is consistent with a coin landing the same way twice and is not evidence the
variance is gone.

**The harness used to photograph other people's builds, and said `12/12 captured`.** It served the
bundle on a fixed port 4317 and guarded it with a `fetch` probe that aborts after 1500 ms — a
time-of-check/time-of-use test that a busy machine defeats on its own. When the probe timed out
against a LIVE neighbour, its own `vite preview --strictPort` died on the bound port, nothing looked
at that exit, and `waitForServer` was satisfied by the neighbour. A TCP port is machine-wide and
every `git worktree` here runs the same tool, so the neighbour is normally a different build — and
possibly a half-written one, because its owner is rebuilding it. Reproduced deliberately:
`12-blob-readability` came back differing from the reference in **12.4% of its pixels at max delta
255**, with a console-message count that did not match, and the harness printed `ok`.

Two more silent assumptions went with it: the GL backend was read on the first page and assumed for
the other eleven (Chromium falls back to SwiftShader after a GPU-process crash, and that frame
differs from the hardware one in **76.5%** of its pixels), and `webglcontextlost` was recorded in the
report and then photographed anyway.

All three now fail the shot, and a failed shot is retried in a fresh page before the run goes red.
The origin comes from our own child's stdout, the port walks to a free one when 4317 is taken (so two
worktrees can capture at once), and the served `index.html` is byte-compared against the `dist/` on
this disk. `_report.json` now carries `origin`, a per-shot `webgl`, `attempts`, and a `frame` block
of draw calls / triangles / programs / geometries / textures — a content fingerprint, so "was that
the same scene?" is answerable without re-running anything.

## Textures: structure, never noise

The procedural generators once emitted full-contrast per-pixel noise, and roads looked like TV
static. The rule now: **if per-pixel noise is visible at gameplay zoom, it is wrong.** Detail comes
from geometry and from crisp drawn shapes — panel lines as real lines, insignia as vector paths,
paving as real slabs with joints. Large flat areas of a single colour are correct and desirable.

## Models: boxes are a bug

`src/art/Shapes.ts` provides chamfered and tapered boxes, lathes, extrusions along paths, faceted
cylinders, convex hulls, layered plates and track assemblies. `MassList` default-chamfers everything
and rejects any model whose silhouette is more than ~85% axis-aligned rectangle. Author through the
primitives; do not reach for a plain box.

## Debugging

`window.__VM` is the live handle. It exposes the renderer, scene, camera rig, post chain, `ready()`,
`focusOn()`, `setUiVisible()`, `waitFrames()`, `screenshot()`, `stats()` and config mutators.
`tools/shoot.mjs` and `tools/metrics.mjs` drive the game through it, so **changing that surface
breaks the entire visual-critique pipeline** — update both consumers.

Boot flags: `?shot=<id>` (skips the menu, freezes the sim, poses the camera), `?map=`, `?art=`,
`?tier=`, `?seed=`, `?mapseed=`, `?biome=`, `?fog=off`, `?relay=`, `?unlockall`. **`?seed=` and
`?mapseed=` are different seeds** — the first drives the scenario layout and every draw of `s.rng`,
the second is the terrain roll. Confusing them is what made a v1 replay reproduce the hills and
nothing else.

## Things that have gone wrong before

Worth knowing, because each cost real time:

- **A green build proving nothing.** `npm run build` once succeeded while `main.ts` imported neither
  core nor render — a 3.2 kB bundle. Verify by running the thing, not by the exit code.
- **NaN propagating into a black frame.** A faction index past the end of a typed array produced
  `undefined` → `NaN` in an instance colour attribute → the bloom pass spread it through its whole
  mip chain → every pixel dead, while stats cheerfully reported 285 draws.
- **Silent registration failure.** A glob pattern that matched only one file per directory meant
  systems quietly never registered. Discovery now logs every id; read that line.
- **A shape library that drew boxes.** Both factories ended their mass loop at `default: buildBox`,
  so all eleven new primitives rendered as cubes. The abstraction existed; nothing used it.
- **`git stash` is a SHARED ref, and it ate another worktree's work.** `refs/stash` is one ref per
  REPOSITORY, not per worktree. With parallel agents in `git worktree`s, a bare `git stash pop`
  takes whatever is on top — which twice meant another agent's uncommitted work landing in a tree
  that knew nothing about it. Both were recovered, by SHA and by `git fsck --unreachable`, and only
  because the agents noticed. **Do not use `git stash` in this repo.** Set work aside with a commit
  on your own branch; amend or squash later.
- **Wiki links must be absolute — `/avihaymenahem/voltmarch/wiki/<Page>`.** GitHub's wiki renderer
  rewrites a bare `[x](Economy)` into a RELATIVE href computed as though the front page lived at
  `/wiki`. At `/wiki/Home` that resolves to `/wiki/wiki/Economy`, which does not 404 — it silently
  re-serves the front page, so every link on the front page looked inert rather than broken. The
  `.md` suffix does not fix it and breaks working links; that was tested, not assumed.
  `tests/wiki-links.spec.ts` is the gate.
