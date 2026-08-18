# CLAUDE.md

Working notes for Claude Code in this repository. Read this before changing anything.

## What this project is

VOLTMARCH — an original browser RTS in Three.js. Four playable factions, ore economy, base
building, AI opponent, fog of war. **All art is generated from code**: no downloaded models and no downloaded
textures.

That claim is about the GAME WORLD, and it is exactly true there: every mesh, material, texture,
cameo and in-game icon is built from Three.js geometry, custom shaders and procedural canvas
generators. **Four shipped assets are not generated**, all deliberate, all in `public/`:

1. **Rajdhani** (OFL-1.1) in `public/fonts/` — the UI text face, Latin subset, four weights, 60 kB.
   Added 2026-08-05 at the user's request. The stack had named Rajdhani since it was written and
   nothing ever shipped it, so every menu and HUD rendered in the fourth fallback — Franklin Gothic
   Medium — and the face the UI was designed around was never on screen.
2. **The brand lockup** in `public/brand/` — seven PNGs derived by `tools/brand.mjs` from a
   `logo.png` the user supplied, which is kept as `tools/brand-source/logo-source.png`.
   `logo-full.png` is the main-menu title; `logo-720.png` is the curtain's fallback wordmark;
   `mark-*.png` are the favicons and app icons. See `public/brand/README.md`. This said "eight
   PNGs derived by" while one of the eight was the underived SOURCE, sitting in the shipped
   directory and being published unused. It also credited `logo-full.png` as the loading curtain,
   which the markup has never used.
3. **The loading screen key art** in `public/brand/` — `splash-1600.webp` and `splash-640.webp`,
   derived by `tools/splash.mjs` from a `load.png` the user supplied on 2026-08-18, kept as
   `tools/brand-source/splash-source.png`. It is the boot curtain's full-bleed backdrop.

   **THE ARTWORK CARRIES ITS OWN WORDMARK, AND THAT IS THE WHOLE DESIGN PROBLEM.** Drawing the
   DOM lockup on top of it gives two VOLTMARCHes stacked down the page — which is exactly what a
   screenshot at 569x595 showed on the first attempt, because the threshold for hiding it had been
   REASONED ("a portrait crop clips the painted one early") rather than measured. It does not. The
   painted lockup occupies x 0.310..0.687, y 0.030..0.346 of the frame, measured by cropping to
   those bounds and confirming it whole; from that, a centred `cover` crop keeps it down to
   viewport aspect **0.676**, not the 1.33 that was assumed. `tests/boot-splash.spec.ts` holds
   those four numbers and re-derives both the media-query threshold and the `object-position`
   anchor from them. **Replace the artwork and you must re-measure the box.**

   Two other things not to undo. The file is **WebP, alone in a directory of PNGs**, because it is
   a photographic illustration rather than a logo — 2.83 MB of source becomes 265 kB — and it is
   the one asset that blocks a first paint, so the spec holds a ceiling over it. And every art
   rule keys off a `.has-art` class the boot script sets only after a real decode
   (`naturalWidth > 0`, with `complete` tested FIRST because the script runs after the `<img>` and
   a warm cache has already fired `load`), so a 404 degrades to precisely the curtain that shipped
   before this existed, wordmark included, rather than to a black rectangle with a progress bar.

   **`npm run shots` cannot see any of this.** The curtain is dismissed before a fixture is posed.
4. **Recorded audio** in `public/audio/` — 184 Ogg files, 6.9 MB, added 2026-08-09 at the user's
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

5. **The README key art** in `docs/hero.png` — an illustration the user supplied on 2026-08-12,
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
npm test             # vitest, currently 4562 across 183 files (+2 opt-in probes)
                     #   6 of those are gated on `distIsCurrent()` — freshness, not mere
                     #   existence — across BOTH `manual` and `webgpu-bundle-isolation`,
                     #   so a tree with no current `dist/` reports 4556 and skips 8.
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

**`wiki/` IS A BUILD INPUT NOW.** The 17 player-wiki pages are the in-game manual
(Options → Manual), reached through one lazy `import.meta.glob`, so editing a wiki page
changes the bundle. `tests/manual.spec.ts` gates the two properties that matter: the corpus
is NOT in the entry chunk (it is its own ~320 kB chunk fetched on first open, and the entry
grew by **10 bytes**), and every page still renders — word-for-word, so a table divider the
parser stops recognising fails rather than quietly becoming a paragraph. The dist-freshness
`runIf` includes `wiki/**` for that reason. `tests/wiki-numbers.spec.ts` is the other half:
every numeric claim on those pages is re-derived from `WEAPONS`/`UNITS`/`BUILDINGS`/
`ARMOR_MATRIX`, because the moment they ship inside the game they stop being documentation
and become claims the product makes.

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
shipped seed, and no land route between any two of them. Seven battlefields ship now
(`MAPS` in `src/shell/settings-store.ts`); three carry a real sea.

**It was ten, and the cut cost three missions.** `saltpan-reach`, `foundry-line` and `glacier-shelf`
each reused an existing `MAP_PRESET` verbatim, so all seven balance numbers matched a map already in
the roster and the lobby was selling a reroll of a battlefield as a reward. Each was also the SOLE
payload of one mission — Armour Column, Continental Yield and Hostile Takeover — and those three are
RETIRED rather than repaid, because the def catalogue has nothing left that a new `UNLOCK_TAGS` group
could legally cover: what is still ungated is either the opening path, naval, non-mirrored (`gate`,
`flameTower`), or the deliberately-open Command Posts. The survey is written out inside `UNLOCKS` in
`src/data/Missions.ts` so nobody pays to run it twice. **Do not "fix" this by paying them cosmetics
or credits** — both are declared gaps in `tests/reward-wiring.spec.ts` and paying into one is the
original defect with a different noun.

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
  amphibious Board/Cross/Land cycle. `npm test` deliberately does not run that proof:
  `tests/amphibious-landing.spec.ts` is the one opt-in file, skipped unless `VM_LANDING_PROBE` is
  set, because it drives a real 24-minute four-army match and a landing count is a fact about one
  seed rather than an invariant.

  **Re-measured rather than carried forward.** This read "landings went 0 → 12" and the 12 did not
  reproduce on a later build. Seed 4242, four brains, 24 minutes:

  ```
                    before          after
      naval yards   0 / 1 / 0 / 0   1 / 1 / 1 / 1
      transports    0 / 2 / 0 / 0   2 / 2 / 2 / 0
      landings      0 / 9 / 0 / 0   5 / 5 / 1 / 0
  ```

  THREE OF FOUR, NOT FOUR, and the fourth has a named cause: the Reclamation brain founds its dock
  at minute five, orders a hauler, and jams its Vehicles queue behind a finished unit that cannot
  egress from a base holding 104 units — banking 23 000 credits while it tries. Present identically
  BEFORE the change, and the same shape as wall 3 in `ai-naval-yard.spec.ts`. Do not quote "all four
  armies land".

## Spawns vary by seed now, and the water decides how much

Reported as *"Our spawns are weird, we always spawn few meteres away from enemy, even thought maps
are huge, we dont take advantage of that, also, its almost always the same spawns.. we need to
define at least 4 possible spawns in each map"*. Three complaints, three different answers.

- **"A few metres away" was true and measured.** All four starts sat inside 148x124 m — **7.0% of a
  512 m map**, with a 182 m margin nobody ever used. `START_SPREAD_X`/`_Z` are **148/124**, exactly
  x2. The opening goes 193.1 m -> 386.2 m and the closest four-army pair 124.0 -> 248.0, which also
  retired a latent defect: those adjacent pairs were **under `START_MIN_SEPARATION` 150**.

  **x2 EXACTLY IS LOAD-BEARING.** `START_BISECTOR`'s normal places the sea on every coastal map via
  `seaOffMapCentre`, and `tests/naval-maps.spec.ts` pins it to digits. A power of two is bit-exact
  through `x*x`, a sum and a `sqrt` under IEEE-754, so the normal survives by `===`. Any other
  factor moves the water.

- **"Almost always the same spawns" was NOT the rotation, and that is why it looked fixed.**
  `rotateStarts` has varied the OWNER of each spot from the seed for a long time. With two armies on
  a four-slot table it swaps two players between slots 0 and 1 and never touches 2 or 3. **The
  positions never varied at all.** `seatedSlots(armies, seed, sea)` is the missing half: it chooses
  WHICH slots a match uses, and it is the ONE derivation both `startPointsFor` (which reserves the
  terrain shelves) and `startSpots` (which places the bases) call. They must agree or an army stands
  on unlevelled ground.

- **`startPairFor` IS SALTED, AND THE UNSALTED VERSION SHIPPED A TEST THAT PASSED.**
  `startOffset(seed, 2)` reads `hashU32(seed)` too, and `floor(u*4) >> 1 === floor(u*2)` for every
  seed — 0 disagreements over 20 000. So the pair and the rotation were one random variable wearing
  two names. Local-player corner occupancy over 20 000 seeds:

  ```
  unsalted   slot0 ~5015   slot1 =    0   slot2 ~9975   slot3 ~5010
  salted     slot0  4922   slot1   5027   slot2  5002   slot3  5049
  ```

  One corner **unreachable** and one at even money, from the feature whose whole purpose is to stop
  the player seeing the same corner. The first spec checked the PAIR histogram, which was uniform
  (106/90/110/94) throughout. **Pin the corner the player lands in, never the pair** —
  `tests/spawn-variety.spec.ts` does, and removing the salt kills it with `corner 1 drawn 0 times`.

- **A COASTAL MAP GETS TWO LAYOUTS, NOT FOUR, AND THAT IS PHYSICS RATHER THAN A CHOICE.** Slots 0
  and 1 *define* `START_BISECTOR`, so they project to exactly 0.0 along every shoreline placed by
  `seaOffMapCentre` and are dry by construction. Slots 2 and 3 are the other corners of the same
  rectangle and sit at **+/-190.10 m across that normal**, so exactly one of them is out to sea:

  ```
  coast     budget 98   slot0 112.00  slot1 112.00  slot2  302.10  slot3  -78.10
  tropical  budget 94   slot0 100.00  slot1 100.00  slot2  -90.10  slot3  290.10
  ```

  `dryPairs` filters the table against the sea the generator will actually use, so `coast` keeps
  [0,1] and [0,2] and `tropical` keeps [0,1] and [1,3]. **Do not "fix" this by pushing the sea
  out** — every slot is dry only past |offset| 288.1 m (coast) / 284.1 m (tropical) against the
  shipped 112 and 100, and `MAP_SEAS.tropical`'s own header records that merely 116 m costs 28
  buildable dock sites against 81. It trades the navy for spawn variety.

  **`NAVAL_SEA` IS THE EXCEPTION AND THE FALLBACK IS FOR IT.** Its normal is hand-authored
  (`-SQRT1_2, -SQRT1_2`) rather than derived from the start table, so three of its four slots are
  wet and NO pair survives the filter. `dryPairs` returns [0,1] there, which is the layout that
  `?shot=` fixture has always been photographed with. It has one reader and is not a playable match.

- **THE SEED IS KNOWABLE IN THE PLAN, and a first attempt at this asserted it was not.**
  `ScenarioPlanSummary` carries `readonly seed`, resolved from `?seed=` in the same memo and at the
  same moment as `armies` and `sea` — both of which `plannedStartPoints` already reads off that
  object. Reserving all four shelves *because* the seed was believed unknowable is what drowned a
  start on both coastal maps.

- **THE SEED PARAMETER IS REQUIRED, WITH NO DEFAULT, ON PURPOSE.** A `seed = DEFAULT_SEED` default
  silently relabelled eight existing call sites from one layout to another and only one of them
  failed; the other seven went on measuring an undeclared layout. Making it required had the
  compiler name all 36 sites instead.

- **A TEST THAT PASSES `null` FOR `sea` WHILE BUILDING WITH A SEA CANNOT SEE A `sea` GUARD.**
  `tests/naval-maps.spec.ts` derived its starts with `sea = null` and generated terrain with
  `MAP_SEAS[preset]`, under a header claiming to be "exactly what `plannedTerrainInput` hands the
  generator". Harmless while `startPointsFor` read nothing off `sea` but `.islands`; the moment the
  seated slots depended on the water it made a `sea === null` scoping fix **invisible** — six
  failures untouched, and a seventh test broken. Both channels take the preset now.

- **WHAT IS NOT DONE.** Every landlocked map shares ONE offset table, so maps differ only in which
  layouts their water permits. Genuinely per-map geometry needs a `StartTable` keyed like
  `MAP_SEAS` and `seaOffMapCentre` taking the normal as a parameter. **It must not be authored by
  rotating the table** — `sin`/`cos` are not pinned to bit precision by ECMA-262, terrain generates
  independently on both machines of a lockstep match, and that is a tick-zero desync. Permutation
  and power-of-two scaling are exact; angles are not.

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
  checksum. `GarrisonService` has the sibling column `store.garrisonId`, saved and hashed
  the same way — TWO columns, so "in a building or in a hull, never both" is true by
  construction rather than by scan order. The fix actually lands in
  `GarrisonService.recover`, whose no-host branch is the one neither service had.
- **`structuralHash()` does NOT cover the column list**, and a commit on this branch said
  it did. It hashes `MAX_ENTITIES`, the cell and enum counts and three flag bits, on
  purpose, because the entity chunk is self-describing: `restoreEntities` finds no column
  and leaves the default. So adding a column does NOT refuse an older save — `BUILD_TAB_COUNT`
  is in there, which is why the Powers tab did — and a pre-column save comes back with the
  ids at 0 and the `Garrisoned` bit intact off the `flags` column. That is exactly the
  state the recovery branches exist to catch, on the first load after this ships.
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

## Three rules that came out of one afternoon of bug reports

Reported as *"Ore harvester just keep ignoring my commands!!"*, *"lets remove boulders and rocks as
barriers, our logic is screwed up"* and *"trying to command my army to move to a certain point after
a long game, and nothing, they just not respond"*. Eight defects, three rules.

- **A FLOW-FIELD REF MUST COME BACK ON EVERY EXIT PATH.** `FLOWFIELD_CACHE_SIZE` is **24**, a slot is
  reusable only at `refs` zero, and `release` is the only decrement. Every caller of it lives inside
  `NavAssigner`, behind an `isMover` test that refuses `PendingDestroy` and `Garrisoned` — so dying
  in transit, garrisoning and boarding a transport each leaked a slot **permanently**, and
  `flushDestroyed`'s generation bump then erased `navField` so the ref became unreachable. At 24
  leaked slots `requestFieldClass` returns -1, `NavAssigner` calls `finishOrder`, and **every move
  order is cancelled on the tick it is issued, in silence, with the marker still on the ground**. An
  IDLE selection is the worst case — idle units hold no field, so the whole group parks at once.
  Fixed in TWO places and both are needed: the assigner's non-mover branch (garrison, boarding) and
  `Damage.cleanupTick`'s `onFree` hook (deaths — a kill at Phase.Damage is flushed at Phase.Cleanup
  in the same tick, *after* the assigner ran at PathRequest, so the assigner can never see one).
  `tests/navfield-leak.spec.ts` fails on round 24 without it. `INav`'s own contract already said
  "You MUST call `release` when the order ends"; dying is an order ending.
- **NO PROP CARRIES `EntityFlag.BlocksNav`, and none may.** `rock` and `boulder` were the last two.
  A `BlocksNav` prop was solid in `Movement.relax` ONLY — a physical constraint the PLANNER could not
  see — and `config.ts` had already measured what that costs: a 2 m rock sealing a one-cell corridor
  and parking a hull for 2100 ticks on a route the flow field thought was open. They are not
  `Crushable` either: entity and scatter props share geometry, `CRUSHABLE_FAMILIES` excludes the rock
  family, and the Meridian Pact carries `crushLevel: 0` on every hull by doctrine, so crushable rocks
  would give exactly one army no way to clear one. `tests/crush.spec.ts` pins both flags off.
  **`PropLibrary`'s own `blocksNav` boolean is a different field** — a scatter placement heuristic,
  test-only otherwise — and stays as it is.
- **A HARVESTER IGNORES ATTACK AND GUARD, AND `Stop` PARKS IT.** `write` in `input/Commands.ts`
  refuses both outright, because both states are terminal for an unarmed unit (`Targeting` returns at
  its `CanAttack` filter, so `settle` never runs; `finishOrder` demotes only
  Moving/Fleeing/AttackMoving). Ctrl+A plus one right-click on an enemy used to send every miner into
  the enemy base for good — the second route to the "they just suicide and going to enemy camp"
  report already quoted in `sim/Harvesting.ts`. Stop leaves **`OrderKind.Stop` standing in the
  column**, which is the park marker: `UnitState.Idle` means "player parked me" for every other unit
  and "I have no work" to this FSM. `None` cannot carry it — `Transport.place`, `Garrison.recover`,
  Chronoshift and `EntityStore.alloc` all write `None`+`Idle`, so a miner would freeze on unload.
  And `guardX/guardZ` is a harvester's ORE ANCHOR: `Steering` has two stamp sites that skip
  harvesters, `RepairSell.applyStance` was a third that did not.

## Ore is drawn in the world now, and the harness cannot see it

Reported as *"We have ore scattered around the map, but i cant see it, how do i know where to place
my harvesters?"* — and the answer was that ore had **no world-space representation at all**.
`OreField` published `densityAt` / `densityAtWorld` / `drainDirty` / `pendingDirty` / `getOreField()`
with **zero production callers**, and nine prose sites across five files described a "crystal
instancer" in the present tense that had never been written. `src/world/ore.system.ts` is that
module. `docs/SPEC_DRIFT_AUDIT.md` #62 is the entry.

- **One `InstancedMesh`, one draw call, `castShadow = false`.** Updated only from `drainDirty` —
  never a 16 384-cell rescan — and shroud-tinted, because a renderer without `applyShroudTint` is a
  map hack that shows every field through unexplored fog.
- **`init()` CANNOT SEE THE ORE.** Fields are seeded by the scenario at `Phase.Cleanup`; this module
  inits far earlier, so enumerating cells in `init` yields an empty set and the mesh silently never
  appears. It allocates at capacity with `count = 0` and fills from `frame()`. `builtForFields` is
  reset in `dispose()` — without that, the second match of a session renders no ore whenever the new
  scenario seeds the same NUMBER of fields as the last.
- **Placement is clumps, not a grid.** One cluster per 4 m cell reads as a plantation however hard
  each is jittered, so 62% of cells draw nothing on a stable hash and the survivors scale up. The
  cluster is SUNK 16% of its height because its base is a flat disc and terrain is never flat —
  un-sunk, it visibly floats, which was the first thing anyone said about it.
- **Ore is excluded from the road CARRIAGEWAY at seeding**, not in the renderer: skipping the draw
  would recreate the original defect, minable-but-invisible ore. `isCarriageway`, never `isRoad` —
  `isRoad` includes pavement and kerb and cut seeded cells 363 → 208 on the stock temperate layout,
  a 43% economy change hidden behind a visual fix.
- **`npm run shots` CANNOT REGRESS THIS.** `?shot=` boots paused, ore is seeded from `simTick`, and
  nine of the thirteen fixtures declare `settleTicks: 0` — five of those nine call `addOre` and never
  seed it. **`06-economy` is the only frame in the capture set where a crystal can appear.** Do not
  read an unchanged look-bible grade as evidence this renderer is fine.

## Explosion brightness has been reported SEVEN times, and six of them measured the wrong case

Latest: *"flashes become huge again with 100% brightness, cant see nothing in fight"*. **There is no
regression.** Every constant in `VFX_GLARE`, `VFX_LIGHTS` and `VFX_EXPLOSION` is byte-identical from
v1.24.0 to v2.12.0, and the one render change in that window that could touch a flash —
`bloom.radius` 0.70 → 0.34 — moves the failing case from 16.003% to 15.580% of frame over L=0.95,
i.e. by nothing. Do not go looking for the commit; there isn't one.

- **`VFX_GLARE.radiusM` was 7 m and the complaint is about the SCREEN.** `src/vfx/FlashBudget.ts`
  bounds how much additive glare one PATCH OF GROUND may emit, and it does that correctly. Nothing
  bounded the frame. At `CAMERA.defaultDistance` 55 m the focus plane is 35.7 m tall, so a firefight
  spread over 30-40 m is one screenful of detonations each holding a private budget and a private
  PointLight.
- **`tools/flash-stack.mjs` packed every sweep it ever ran into a 4 m spiral** — inside `radiusM` and
  inside every `mergeRadius`. Six passes of measurement therefore all landed on the configuration
  that IS bounded, and all six reported the bound working. It sweeps `SPREADS = [4, 18]` now; **do
  not delete that axis to save renders.** At 1280x720 on the 55 m dolly, twelve unit deaths against a
  2.430% baseline: 5.442% blown inside 4 m, **15.580% across 18 m**.
- **The fix is a second tier of the same budget, at the scale of the frame** — `VFX_GLARE.wide`,
  34 m / ceiling 4.0 / exponent 3.0, multiplied into the locality tier. Twenty deaths across 18 m go
  36.200% -> 14.314% blown; ONE death is bit-identical (4.253% either side), which is the property
  the whole file rests on and which every previous fix broke.
- **The point lights are NOT the offender.** Ablated (`material.visible = false` on `VfxAdditive`,
  `VfxLitSmoke`, `VfxDebris`, `VfxBeamOverlay`, `VfxRibbonDepth` — never `mesh.visible`, which the
  pools reassign on upload), twelve spread deaths cost +0.95pp against +13.15pp with the sprites
  drawn, and `VFX_LIGHT_MERGE_CEIL` saturates exactly as advertised. An older note calling the light
  pile the largest lever was taken through a mask that never worked.
- **`VFX_NOON.muzzleMs`, `muzzleSize` and `muzzleColor` are read by nobody.** The live muzzle numbers
  are `VFX_GUNS.flash[size]`. They are labelled INERT in `config.ts` now; tuning them does nothing.

The measurements, the rejected hypotheses and what not to re-run are in
[`docs/RENDER_FINDINGS.md`](docs/RENDER_FINDINGS.md) §5b.
## The AI mends and rebuilds, and one third of that report was never the AI

Reported as *"our entire AI logic is crap. when im starting a game from scratch, enemy already has
its building set up, no progress. also when they are being attacked, and for example their buildings
destroyed, they are not rebuilding, not healing"*. Three symptoms, two defects, one misreading.

- **THE PREBUILT BASE IS NOT AN AI AFFORDANCE AND THERE IS NO ASYMMETRY TO DELETE.** `Scenarios.ts`
  seeds every seat in ONE loop with no `isHuman`, no difficulty and no slot test;
  `START_CONDITION_DEFAULT` is **`'mcv'`**, both lobby blurbs read "Both sides start with…", and
  `tests/match-start.spec.ts` already asserts both slots symmetrically under both openings, and
  `tests/opening-default.spec.ts` now asserts the DEFAULT rather than passing `{ start: 'mcv' }`
  explicitly the way every case in the older file does. Do not "fix" the scenario.

  **THE HEAD START IS -0.83 SECONDS, AND THIS BLOCK USED TO BLAME THE WRONG THING.** It said a
  player sees "the AI's construction vehicle unfolding at t≈0 while they are still driving theirs".
  The deploy layer is real and does fire at t≈0 — but measured on seed 7 through
  `__VM.pause()`/`step()`, the AI's yard finishes at t+2.43 s and a human who presses Deploy on
  tick 0 finishes at **t+1.60 s**. The player is AHEAD. The perceived head start was their own
  orient-and-drive time, and the sentence sent two investigations at a deploy layer that was
  innocent.

  **WHAT A PLAYER IS ACTUALLY LOOKING AT IS THE 10 000-CREDIT OPENING BANK.** Nobody touching the
  controls, seed 7, Normal:

  ```
  t+30s    1 bld   6 un   cr 9746      conyard    t+2.4s     refinery    t+90.4s
  t+60s    4 bld   6 un   cr 8900      power      t+37.4s    warFactory  t+130.9s
  t+90s    7 bld  11 un   cr 4852      barracks   t+61.4s
  t+240s  16 bld  27 un   cr    0      flameTower t+74.9s
  ```

  By 90 seconds the AI has a seven-building base with a defence tower and eleven troops **and has
  not mined a single ore to get there** — its first refinery completes at that exact moment. It is
  spending the same bank the player is holding and not opening with. Reported twice as "the AI has
  a ready base"; both times the scenario was innocent. `defaultSetup().startingCredits` is the
  lever, `CREDIT_OPTIONS` already offers 5000 and 2000, and `MCV_MIN_CREDITS` 5000 is documented as
  the smallest bank that can reach a refinery — so 5000 is the FLOOR, not a safe midpoint.

  The two REAL asymmetries are both documented and neither is a structure:
  `AI_DIFFICULTY[].resourceBonus` (0.8 / 1.0 / 1.15 / 1.35 on harvested income) and
  `aiMirrorsUnlocks`, which is on by default and, when a player turns it off, genuinely does give a
  prebuilt AI base the gated tech the human's is missing.
- **`CommandKind.RepairToggle` HAD NO CALLER IN `src/sim/AI.ts`**, so an AI base never healed —
  measured at 0.35 mean HP unchanged to four decimals over ten sim-minutes while the brain spent
  34 000 credits on infantry. `AiBrain.repairBase` is the fix and it is the PLAYER'S OWN WRENCH:
  same command `input.system.ts` sends, same `REPAIR_COST_PER_HP` out of the same bank, same
  cancel-when-broke. It cost 3116 credits in the probe, which is what makes it a decision rather
  than a handout.

  **A toggle is a toggle.** `RepairSell.tickRepairs` clears the flag at full HP and on going broke,
  so the brain only ever needs to switch one ON — and re-sending it to a structure already mending
  switches that repair OFF. `isRepairing` is therefore consulted per candidate, not counted once.
  This is not theoretical: the first probe run read **954 toggles against `hpRestored: 0`**, because
  a parked-and-reissued command passes `CommandBus.drain` TWICE and the harness applied both.
- **A LOST CONSTRUCTION YARD WAS PERMANENT.** `census` refills `roleCount` every pass, so a bombed
  refinery or war factory is already re-proposed by the adaptive scorer — that half of the report
  was wrong. But `conyard` carries `producesTab: BuildTab.Structures`, so with it gone NO structure
  can be built by anyone, and the only route back is an MCV off a surviving war factory. Nothing
  ever called `forRole(BuildRole.Mcv, ...)`; the yard-less branch spent the whole bank on units, so
  the 3000 was never reached even with a live economy. `mcv` carries no unlock tag precisely so a
  fresh profile can replace one — its own def says so.

  **`AI_REBUILD.bankFraction` is the half that makes it work.** Ordering the vehicle is the obvious
  line; holding its price back from `buildUnits` is the one without which the brain converts the
  money into riflemen 200 credits at a time and never buys anything.
- **Kill the war factory AND the yard and the position is unrecoverable BY DESIGN** — the
  `OreCrisis` dead end in another costume. A probe that bombs a base flat measures the rules, not
  the brain; `tests/ai-rebuild-repair.spec.ts` deliberately leaves one refinery and the factory
  standing, and says why.
- **`AI_SKILL[].maxRepairs` is a concurrency cap, not a switch.** Every rung mends, because a base
  that never heals is a broken opponent rather than a gentle one. Easy patches one building while
  the next two burn; Brutal answers the salvo.
## Six balance reports, and three of them were the opposite of what they said

One afternoon, six reports. Every number below is measured; where a report turned out to be
false, the measurement is kept rather than the report.

### Time-to-kill is one knob, and it is invariant on trades

Reported as *"In general, killing and dying feels too fast in game"*. `COMBAT_DAMAGE.globalMul`
is 0.80, applied **once**, in `Damage.applyOne` — the only function in the game that writes `hp`.

```
main battle tanks   8.62 - 10.77 s  ->  10.8 - 13.5 s
line infantry        2.00 -  2.35 s  ->   2.5 -  2.9 s
```

**IT CANNOT DOUBLE-COUNT WITH A WEAPON RETUNE, AND THAT IS PROVABLE.** A squad assaulting an
emplacement lands `36 x r x HP/D`; scaling attacker `r` and defender `D` by the same factor
cancels. So this stretches the clock and moves no balance relationship at all. **Tune this for
PACE and a weapon row for BALANCE** — they are different questions and this is the only knob for
the first. Structures slow by the same factor (single-attacker 20-99 s -> 25-124 s); that is the
number to revisit first if base-cracking drags.

Not HP and not the armour matrix: `tests/data.spec.ts` pins every `def.maxHp` field-for-field
against `Scenarios.FALLBACK_UNITS`, and `armorMultiplier(SmallArms, Infantry)` is pinned to
exactly 1 because it is the counter-triangle's reference cell.

### The gunner stations: the trigger pull, not the dps

Reported as *"Gunner stations should be a less powerfull, one can destroy a full army in a
second"*, and it was literal. The two CHEAPEST emplacements were the two highest-dps rows in the
whole 42-row armoury. Five rounds left in 0.24 s, so one pull was 100-105 damage — at or above the
full health of three of the four line infantrymen. **A burst was a man, 1.45 times a second.**

```
pillboxMg       5 x 20 / 0.69 s = 144.9 dps  ->  5 x 13 / 0.79 s = 82.3   (362 -> 206 per 1000 cr)
glaiveRepeater  5 x 21 / 0.69 s = 152.2 dps  ->  5 x 12 / 0.79 s = 75.9   (338 -> 169 per 1000 cr)
```

**The target is DERIVED.** Eight G.I.s vs a 400-credit Pillbox: the post kills sequentially so its
dps is flat while the squad's decays, and the squad landed 282 of 500 hp before dying — 1600
credits of infantry, box keeps 44%. Break-even is 81.5 dps. `tests/emplacement-band.spec.ts` pins
a price-normalised band (210 anti-infantry dps per 1000 credits) plus a one-shot rate floor, with
a **now-empty** `OVER_BAND` exception table that fails in BOTH directions — a new exceeder fails,
and fixing a declared one also fails, so nobody can land half of a pair and walk away.

**`pillboxMg` is `DEFAULT_WEAPONS[11]` in `src/sim/Combat.ts`, not in `Defs.ts`** — `Defs.ts`
borrows that table verbatim as its prefix and does not own it. Retune in place; re-pointing the
two defs at an appended `REBALANCE_WEAPONS` row orphans row 11 and throws at import.

### Ore already regrew. The gate was unreachable.

Reported as *"Ore fields should regenerate over time"* — and they always did.
`src/sim/Economy.ts` was correct and running the whole time. The defect was a **ratio between two
constants 260 lines apart in `config.ts` that had never been read together**: a harvester claims a
cell at `ORE_MIN_CLAIM` (25) and mines it to zero, so ~25 is the ceiling a worked cell sits at,
while at `ORE_REGROW_SPREAD = 0.3` the wave needed 138-160 ore in that cell before the one behind
it could grow. Five to six times over the bar, so on any field anyone was mining the wave never
advanced past the source: **19 consecutive sim-minutes at 0.1% of a 22 381-ore field.**

`ORE_REGROW_SPREAD` is **0.025**, and the constraint is arithmetic rather than taste:
`ORE_CELL_MAX * spread` must stay under `ORE_MIN_CLAIM`, so the guarantee holds for the RICHEST
cell the generator can make. **0.05 is wrong** — it gives a gate of 23-27 against a claim floor of
25, which straddles, so the stall would survive on exactly the best fields.

**Ore is not infinite, because throughput is self-limiting** — it peaks partway through recovery
and collapses as cells cap out:

```
stripped r26:   1m 4.1%   2m 20.2%   5m 57.6%   10m 86.2%   20m 99.1%
throughput      2m 60.3 ore/s (~2.8 harvesters)   10m 12.6 (~0.6)   20m 1.2 (~0.05)
```

So a field carries about three hulls while partly worked and fewer as it fills; expansion still
buys economy. **If ore feels too plentiful the lever is `ORE_REGROW_RATE`, never the spread gate**
— the gate sets the SHAPE of recovery, the rate sets how much there is.

Three tests had encoded the stall and were rewritten around the measurement, not nudged green:
one asserted a stripped field regrows at exactly the source rate (true only while the wave could
not leave the source); one required the AI to abandon its home field, which became WRONG once two
harvesters sat inside what a field sustains — its rig is six hulls now, past the ceiling; and the
tripwire that deliberately pointed at the defect now pins the invariant.

### A captured refinery pays the captor, and almost nothing needed a hook

Reported as *"Occupying an enemy ore building should give me his income"*. Ownership transfer
already worked: storage cap, power, prereqs, `AiBrain.roleCount` and `OreCrisis` are all
**rescans over `store.owner`**, not running totals. The defect was two lines in
`src/sim/Harvesting.ts` (`§DEED`): the dock guard required hauler and refinery to be allied, and
the deposit was keyed on **the hauler's** owner rather than the refinery's. Measured on the old
code, a full hopper docking at the instant of capture paid **victim +700, captor +0**.

That miskeying was *unfalsifiable* rather than wrong — `allyMask` is only ever self plus Gaia and
no Gaia structure is a refinery, so both names meant one player in every reachable state.

Two deliberate limits: only a hull **already docked** is grandfathered (one still hauling
re-points, because a harvester driving into an enemy base is the `§ANCHOR` defect), and the
victim's harvesters do **not** transfer — `dockTarget` is a per-haul binding, so the set would be
arbitrary. Capture cannot farm the `OreCrisis` free harvester: it satisfies the standing-refinery
clause at a higher price than building one, and capturing adds the refund to the pot, which biases
the survey toward `SellOut`. `PlayerState.buildingCount` is the one running total and now follows
a capture — it is indexed by `entry.defId`, NOT the `publicId` the event carries.

### A blackout has teeth now, and the literal request was refused

Reported as *"If no electrcity left, buildings shouldnt be able to shoot / generate troops"*. The
firing gate existed but was triple-conditional and only 4 weapon rows carry `needsPower`, so 6 of
10 armed structures fired happily on a dead grid. It is two tiers now: **universal** — any
structure that DRAWS power and is dark cannot fire — plus `WeaponDef.needsPower` kept as a
stricter tier for electric guns during any deficit. 4/10 silent -> 7/10.

**THE THREE THAT STILL FIRE DRAW ZERO POWER, AND THAT IS THE POINT.** `pillbox`, `sentryGun` and
`rclSpitpost` are `power: 0`, so "no electricity" does not reach them — and `rclSpitpost`'s
shipped blurb says *"Fires through a blackout"*, which `tests/content-truthful.spec.ts`
independently enforces. The request as literally stated is therefore NOT what shipped.

Production halts on the unit tabs only. `census` skips a dark structure for every tab except
`Structures` and `Defense`; `BuildQueue.advanceTab` already stalls at `factoryCount <= 0`,
charges nothing and auto-resumes, so no new machinery. **The anti-soft-lock is deliberately
redundant** — `PowerGrid.shedPriority` returns `never` for `EntityFlag.IsBuilder` AND `census`
exempts those two tabs by name. Do not simplify it to one.

One real cost: the Reclamation's Arc Pylon (-90, the heaviest single load in the game) loses its
grid-independence, and `Defs.ts`'s doctrine block was rewritten rather than worked around.

### The AI does not cheat, and could not buy capability

Reported as *"AI building capabilities should be according to his money"*. The plain reading is
**false and measured**: Brutal at 16 sim-minutes had `oreMined` 56 010 + 10 000 opening against
`creditsSpent` 66 010 and 0 banked. Credits are conserved to the credit; the AI pays through the
same drip a player does. There is no credit cheat.

The true reading is the opposite — build capability did not respond to the bank in EITHER
direction, two defects in `AiBrain.chooseBuild`:

- **An unaffordable candidate was dropped, not saved for.** `consider` ran one test for two
  refusals — "tab full" (look elsewhere) and "cannot pay yet" (save up) — then fell through to
  `buildUnits`, which buys the cheapest thing that scores. So the highest-return purchase lost
  every pass to a rifleman, 1400 against 200, forever: **93 riflemen and 3 harvesters**, fleet
  7 -> 1, `oreMined` frozen for the last three minutes with 574 banked. The reserve already
  existed twice elsewhere and this file calls it "the half that makes it work" both times.
- **Production throughput was a constant.** A second Barracks makes the one queue 35% faster to a
  2.0 cap, but a producer was proposed only at `roleCount === 0`. Of **925 passes with >=5000
  banked, 903 were refused because both unit tabs were already full.**

**DO NOT DEEPEN `AI_SKILL[].queueDepth` TO MAKE THE AI SPEND FASTER** — `BuildQueue.advanceTab`
only ever advances `items[0]`, so depth changes no rate. Only more factories do. And
`AI_PRODUCERS.maxUseful` must stay DERIVED from `FACTORY_SPEED_BONUS`/`CAP`, never a literal.

### The AI bought a Command Post and then bought nothing

Reported as *"0 strategy, 0 skills, not using powers"*. Powers were the real bug:

```
              Command Post    powers bought / CALLED      after
  Easy          never              0 / 0                  0 / 0     (mask 0, by design)
  Normal        minute 8           0 / 0                  2 / 4
  Hard          minute 8           3 / 1                  3 / 17
  Brutal        minute 4           2 / 4                  4 / 20
```

Normal paid 1500 credits and 80 power for a Post and bought **nothing for sixteen minutes**. Two
defects in `considerPowers`: the plan order was inverted by price (every power scored identically
so `POWER_PLAN`'s order was meant to decide, but the loop also skipped anything the near-zero bank
could not cover, so only the CHEAPEST — Orbital Scan, fourth in the plan — ever cleared), and
**Orbital Scan can never be fired once bought** (`tryScan` returns at `memCount > 0`; a Post
cannot exist before minute 4-8; scouting answers that in the first two). A power whose call-gate
is permanently shut is no longer bought.

**"0 strategy" is FALSE as stated** — there is a five-state posture machine, a scout with a
waypoint route, a decaying threat grid, composition counter-play scaled per rung, expansion, an
upgrade plan and a naval survey. **"0 skills" is TRUE for combat micro**: `flee=0` at every sample
of every rung — only the harvester layer ever sets `UnitState.Fleeing`. The AI retreats ARMIES
(`shouldRetreat`, gated by `discipline`), never units. What repeats, and is the honest cause of
"boring", is the OBJECTIVE: one target for sixteen consecutive minutes, no harassment, no second
front. That is a strategy-layer addition and it is not done.

**`powerAskedTick` IS ZERO-INITIALISED**, so `powerSettled` treats every power as "asked at tick
0" and refuses any ask before tick 1800. Harmless in a match; it costs an hour in a harness.

### The opening bank built the AI's base, and the fix is per-CANDIDATE

Reported twice as *"AI has ready base and troops when game barely started"*. The scenario was
innocent both times — see the block above — and so was the deploy layer. **The cause is the
10 000-credit opening bank**, which the brain spent into a seven-building base with a defence
tower and eleven troops by t+90 s while its first refinery completed at t+90.4 s. It had mined
nothing. It was spending the same bank the player is holding and has not spent yet.

Offered the choice between cutting the default bank and pacing the brain, the author chose to keep
10 000 and slow the AI. So this is a **THIRD deliberate AI asymmetry**, alongside
`AI_DIFFICULTY[].resourceBonus` and `aiMirrorsUnlocks`, and it is deliberate rather than
accidental — do not delete it as a bug.

**IT LIVES IN THE BRAIN, NOT IN THE SIMULATION, AND THAT IS WHAT MAKES IT SAFE.** It only lowers
the brain's own willingness to issue `ProductionStart`. A rule about what credits can BUY would be
a sim rule, would bind the human, and would be wrong; a rule about when the AI chooses to spend
binds nobody and cannot desync a lockstep match.

**THE FIRST SHAPE WAS WRONG AND THE FAILURE IS THE REUSABLE PART.** A governor that caps
`spendable` caps ONE number that every purchase reads — so it caps the economy too, including the
refinery that retires it. Easy deadlocked outright:

```
             allowance  − creditFloor  = effective    refinery 2000
  Easy   0.75   2500       1400           1100        DEADLOCK — 3 bld, 9400 cr,
  Normal 0.60   4000        600           3400        ok        0 ore, frozen 240 s
```

And the obvious repair made it worse: flooring the allowance at the refinery's price is 80% of
Easy's whole budget, so the floor became general spending room and Easy raised a defence tower at
t+50.1 s against a refinery at t+78.6 s — the exact thing the feature exists to prevent.

`AiBrain.governOpening` / `budgetFor` compute **two** budgets instead. `consider`, both interrupts,
the scripted opening and `buildUnits` all route through `budgetFor(entry)`: economy and production
roles see the ungoverned `spendable`, army and defence see the governed `discretionary`. **The
refinery is never measured against the governed budget, so the governor structurally cannot block
its own exit** — no floor, no deadlock, no tuning required to avoid one. It latches off at
`oreMined > 0`, after which `discretionary === spendable` exactly and every later decision is
bit-identical to a brain that never had one.

```
             first defence      first ore       units t+240    bld/units @ t+90
  Easy    50.1s -> 107.6s    88.1 -> 96.8s      29 -> 10       9/14 -> 6/7
  Normal  76.1s ->  88.6s    54.9 -> 77.9s      21 -> 18       8/12 -> 7/9
  Hard    76.1s ->  76.1s    80.5 -> 76.9s      22 -> 19       8/12 -> 8/12
  Brutal  76.1s ->  76.1s    77.7 -> 76.8s      17 -> 22       8/12 -> 8/12
```

Easy and Normal now raise their first defence AFTER their first ore lands; Hard and Brutal still
beat it by 0.7-0.8 s, which is what the rungs are for. Two effects nobody predicted: Normal's
**refinery moved 41 seconds EARLIER**, because governing discretionary spending pushes the economy
to the front of the queue rather than merely delaying things — this is not only a brake. And the
unit ladder **was not monotonic before** — Easy fielded the most units of any rung, 29 — and is now
10 / 18 / 19 / 22.

**`creditFloor` STACKS WITH ANY NEW SPENDING RESTRAINT, and Easy has the largest one**, so Easy is
where a new constraint turns into a deadlock. It no longer can here, because `creditFloor` applies
to the ungoverned budget the refinery uses. `tests/ai-opening-governor.spec.ts` pins that
relationship, so changing either number reports rather than deadlocks.

**TWO HARNESS TRAPS, both of which cost a cycle.** `DeployService` will not unfold a
scenario-spawned MCV headlessly — the brain reports "deploying the construction yard" forever and
the match never starts, which reads exactly like a broken feature. Hand the AI its yard at t=0
instead; that is within 2.4 s of the real opening. And **the governor reads
`p.stats.creditsSpent`, which only moves when `BuildQueue`'s drip actually charges** — a fast
harness that echoes `production:started` without charging lets the brain spend against a counter
that never rises, measured at 39 600 credits of army against a 3000 allowance.

### The AI can name a target now, and `sw=0/0` was never the brain

Reported as *"I just want the AI to feel like im against a human player, that can use everything i
can"*. That reframes the question as CAPABILITY PARITY, which is measurable, because the AI issues
commands through the same bus a player does. Audited against every verb:

```
uses:   Move  AttackMove  Deploy  Harvest  Enter  Unload  UseAbility
        issueOrder  issuePlaceBuilding  issueProductionStart
        issueRepairToggle  issueSetStance  issueUsePower

NEVER:  Attack  ForceAttack  Stop  Guard  Capture  Repair  Scatter  Patrol
        issueSell  issueSetRally  issueSetPrimary  issueRelocate
        issueProductionCancel  issueProductionPause  issueSelfDestruct
```

**`OrderKind.Attack` was the headline and it is fixed.** The brain had never issued an explicit
attack order — every engagement was `AttackMove`, which hands target choice to `Targeting`'s
automatic acquisition. With no explicit target the AI cannot focus fire, cannot snipe a refinery,
cannot hunt harvesters and cannot decide to kill the Construction Yard first, so "0 skills" and
"one objective forever" were the same defect wearing two hats.

`AiBrain.focusFire` / `pickFocusTarget`, doctrine in `AI_FOCUS`. Targets score by class (harvester
1.7 > defence 1.4 > producer 1.2 > unit 1.0 > other 0.5) times `1 + (1 - hpFrac)`, so a unit at 20%
outscores a healthy producer — that is what makes it CONCENTRATION rather than a preference for
whatever is biggest. Three load-bearing details: it runs **in front of** the attack-move, because
both write the same order column and issuing both silently erases the first; the search radius is
**34 m** so focus never becomes a chase, since an explicit attack order drives the unit to its
target; and a dead target is dropped promptly, because `Targeting` falls back to acquisition but
the unit "stops where it stands", so a group pointed at a corpse just idles.

Laddered on the EXISTING `AI_SKILL[].discipline` rather than a new column — its declared meaning is
already "how well it fights". Explicit attack orders over 20 minutes: **Easy 0 / Normal 69 / Hard
147 / Brutal 47**. The gate is the first statement so Easy does not even consume an RNG draw, and
the whole Easy trace is byte-identical with the feature off. Brutal under Hard is not an inversion,
it is how much combat that seed produced.

**A MIRROR-MATCH A/B IS NOT EVIDENCE OF STRENGTH, and this is the trap to avoid when measuring any
future AI change.** Both brains get the change, so `kills` tracks `enemyLost` in every row (Normal
302/314, Hard 334/343, Brutal 259/268) and the exchange is zero-sum BY CONSTRUCTION. The behaviour
above is verified correct and laddered; whether it makes the AI WIN more is unmeasured and needs an
unchanged opponent.

**`sw=0/0` IS WHAT A LOCKED PROFILE LOOKS LIKE, NOT A BROKEN BRAIN.** Three separate investigations
concluded the AI never builds a superweapon. It does. The probes installed
`new UnlockGate(() => [], …)` — a profile owning nothing — and superweapons are progression-gated
(`struct.superweapon.strategic` / `.siege` / `.chronosphere`). With unlocks granted, Brutal builds
BOTH allowed superweapons and fires two by minute 24, reaching them through the saving reserve. The
same empty gate silently removes repair depots, prism tanks and the commander from the AI's reach,
and the traces had been printing `blocked: repairDepot: Locked — complete a mission` for two tasks
before anyone read it. **Any AI harness that stubs `UnlockGate` is measuring a different game.**

On a fresh profile the AI genuinely cannot build one — and neither can the player, because
`UnlockGate.mirrorAI` resolves the AI against the human's profile. Symmetric and deliberate.

**A WOUNDED HULL WITHDRAWS NOW — AND `flee=0` WAS A VACUOUS METRIC.** Three separate reports
cited "no combat unit ever enters `UnitState.Fleeing`" as evidence the AI had no retreat. That
state is READ by three sites and **WRITTEN BY NONE**, anywhere in the codebase, so the number could
never have been anything but zero and was evidence of nothing. A retreat is a plain `Move`, which
is how the harvester layer has always done it. Check that a metric CAN move before citing it.

`AiBrain.withdrawWounded` / `GROUP_WITHDRAW`, doctrine in `AI_RETREAT`: one hull per squad pass,
worst-hurt first, below 30% health AND hit within the last 3 s, walks to the rally and returns at
75%. It runs **before** `regroupSquads`, because the tag is what hides the hull from the re-file —
tag it afterwards and it stays in `strikeIds` for one more pass and `pressAttack` attack-moves it
straight back into the fight it just left. The release path is equally load-bearing: a tag with no
clearing branch is a unit permanently deleted from the army.

```
  rung      withdrawals    own losses      Easy is byte-identical over the
  Easy           0          121 -> 121     full trace — the discipline gate is
  Normal        31          132 ->  66     the first statement, ahead of the
  Hard         177          158 -> 125     RNG roll, so Easy does not even
  Brutal       183          159 -> 144     consume a draw.
```

Losses fall at every retreating rung, and **strength is still not claimed** — mirror match, both
sides get the change, `enemyLost` moved in both directions.

**WHAT IS STILL MISSING, and the audit is a MAP, NOT A CHECKLIST.** `SelfDestruct`,
`ProductionPause`, `ProductionCancel` and `Relocate` are deliberately skipped: a human almost never
uses them and an AI cancelling and re-queueing production reads as indecision rather than skill.
The three that are real gaps:

- **The AI owns no engineer, so `Capture` is unreachable.** The def exists but its weight is 0 and
  `buildUnits` filters `weight <= 0`, and nothing references `BuildRole.Support` for it. Giving the
  brain the verb alone would hand it to a unit that never exists. Buying one, escorting it and
  choosing a building is a FEATURE, not a verb.
- **Per-unit retreat.** `flee=0` at every sample of every rung — only the harvester layer ever sets
  `UnitState.Fleeing`. Group retreat (`shouldRetreat`) is real and should stay.
- **`issueSell`.** `OreCrisis`'s `SellOut` branch is a documented route out of a dead economy that
  the AI structurally cannot take.

## The roads were underground, and one number was doing four kinds of damage

Reported as *"Look at the roads, all broken, 0 logic"* over a screenshot of a city map, with five
named symptoms. Three of them were ONE defect: **the road surface was built edge-to-edge across a
13.6 m carriageway, over a 1 m heightfield, with 6 cm of lift.** The mesh chorded straight over any
ground that bulged in between. Measured on the shipped geometry, sampling every triangle:

```
                  carriageway buried   worst    centreline buried
industrial-grid         16.86%         4.22 m   27.7%, 32 m unbroken
temperate-valley        16.81%         3.51 m   27.8%, 46 m unbroken
frozen-sector           28.66%         4.53 m   37.4%, 36 m unbroken
```

A sixth of the road replaced by the terrain splat is *"pale blotches punched through the asphalt"*;
the same thing over 32-46 m is *"the road ends abruptly in mid-air"*; on `road.pavement` (worst
5.92 m) it is *"the pavement breaks, floats and re-starts"*. `ROAD_CONFORM_METRES` (1.2 m, under the
terrain grid) makes every road surface DRAPE instead, and `RoadNetwork.conformSpans` carries the
argument for why draping rather than grading the heightfield.

- **THIS WAS NEVER A REGRESSION AND `Roads.ts` HAD NOT BEEN TOUCHED.** It shipped from the day the
  module was written. The reason is in the next bullet, and it is the more important finding.
- **`npm run shots` CANNOT SEE A ROAD DEFECT.** All thirteen fixtures frame one short, straight,
  nearly-flat run, so the geometry has nowhere to go wrong in them. A full A/B — pre-fix control
  against fixed, 13 fixtures each — moved the weighted grade by **0.0 points, 92.0% and 13 failures
  on both sides**, while the change is unmissable on any real map at gameplay zoom. The generator's
  own suites work in the XZ plane (arc radii, off-axis degrees, kerb overlap, winding) and the whole
  failure was in Y. `tests/roads-drape.spec.ts` is the gate that closes both gaps; do not read a
  green scorecard as evidence about roads.
- **NO SCATTER PROP MAY STAND ON THE CARRIAGEWAY**, and `Scatter.legal` is where that is enforced —
  `isCarriageway`, NEVER `isRoad`, the same distinction and the same reason as ore seeding. `isRoad`
  covers the kerb and pavement, which is exactly where `traceKerbs` and `placeAlongLine` are designed
  to put lamps, benches and railings. Measured before: 186 / 207 / 105 props in the road on the three
  maps above. The file's header had claimed "street furniture spawns BESIDE roads, never on them"
  since it was written, naming a mechanism — the `def.surfaces` mask — that cannot express it, because
  roads stamp `SurfaceId.Paving` and the mask cannot tell a traffic lane from a plaza.
- **The density gates in `tests/scatter.spec.ts` build no RoadNetwork**, so they cannot see that
  exclusion at all. A refused candidate is a spent attempt, not a relocated prop, so an exclusion over
  a tenth of the map thins the WHOLE map: foundry-line went 162.4 -> 122.6 props/ha against a floor of
  95. That is pinned in `roads-drape.spec.ts`, not in the file whose job it looks like.
- **A CROSSWALK MEANS THERE IS A JUNCTION.** `junctionA`/`junctionB` is the only input to `dEnd`, and
  `dEnd` places the zebra, the stop bar, the lane arrows and the yellow kerb dashes. It was set in
  `buildChains` from `degree(node) >= 3` — a claim about the LATTICE — and never revisited, while
  `mergeArms` goes on to empty the arm list of any node whose roads turn out to be collinear, and
  `trimChains` merges a second time. Result: 12 phantom mouths against 6 real junctions on
  temperate-valley, painting full junction approaches onto open road. That is *"crosswalks mid-block,
  arrows pointing into kerbs"* — and the arrows name the cause, because a two-lane street draws the
  TURN arrow, which turns toward the kerb when there is no side road to turn into.
  `markJunctionMouths` now derives the flag from the pad that actually exists, immediately before
  `buildMeshes` reads it.
- **What was deliberately NOT fixed, and why.** `pruneDeadEnds` refuses to cut an arterial edge, so an
  arterial that could not reach the far border stops in open country — 2 on frozen-sector, 1 on
  contested-strait, **0 on either urban map**, so it is not what the report saw. Its own comment
  records that removing that guard produced maps with no roads at all on a third of seeds. Bounded by
  a test instead of changed. Likewise the residual burial (0.3-1.5%, worst 3.9 m) is a terrace FACE
  crossing the corridor, which no span size can drape over; the honest fix is routing — `classifyCells`
  erodes by ONE cell and guarantees flat ground only +/-6 m out, against a 10.28 m arterial corridor.

## There are two renderers now, and a WebGL player downloads exactly one of them

`?gpu=webgpu` used to throw. It boots the real game since v3.0.0-dev: every shader in the project
exists twice, once as GLSL and once as a TSL node graph, and `src/render/gpu-path.ts` is the seam
that picks. **The default is still WebGL** and nothing in the product selects the other one.

- **`gpu-path.ts` IMPORTS NO THREE AT ALL, and that is the constraint the whole design is built
  around.** `three/webgpu` is the entire node system — both backends, both builders, the node
  material library, ~758 kB emitted. It reaches the bundle through exactly ONE dynamic
  `import('./gpu-path-install')`, inside `prepareGpuPath()`, behind `requestedBackend()`. Rollup
  emits that as its own chunk and a WebGL boot never fetches it: `WGSLNodeBuilder`,
  `GLSLNodeBuilder`, `RenderPipeline`, `MeshPhysicalNodeMaterial`, `MeshStandardNodeMaterial` and
  `castShadowPositionNode` are **0 occurrences in the entry chunk**.
  `tests/webgpu-bundle-isolation.spec.ts` pins it and fails when a static import is added on
  purpose. **Never `import ... from 'three/webgpu'` outside a `*Node*.ts` / `*-nodes.ts` file.**
- **Every material site is one branch, taken once at construction:**
  `const np = nodePath(); np !== null ? np.createX(...) : createX(...)`. Never in the frame loop.
- **`RendererHandle.renderer` IS GONE. It is `webgl` and `node`, and one of them is null.** The two
  renderer families share no base type, and almost everything the consumers reached for is genuinely
  WebGL-only — `getContext()` for the timer query, `capabilities.getMaxAnisotropy()`,
  `readRenderTargetPixels`, `PMREMGenerator`'s constructor. Anything that works on both reads
  `frameInfo()`, `size`, `capabilities` or `backend`. **`window.__VM.renderer` is null under
  `?gpu=webgpu`** and `__VM.rendererHandle` is the backend-agnostic one.
- **NEVER READ `renderer.info` DIRECTLY.** Under the node renderer `info.render.calls` is a
  MONOTONIC COUNT OF `render()` INVOCATIONS since page load that `reset()` does not clear, and
  `info.programs` is `undefined`. `handle.frameInfo()` / `normaliseInfo()` is the only safe read.
- **`prepareRenderer(canvas)` must be awaited BEFORE `bootstrap()`.** `WebGPURenderer.render()`
  throws until `await renderer.init()` resolves and `bootstrap()` is synchronous by design. On the
  WebGL path it is a no-op that imports nothing.
- **`ShaderMaterial` is NOT in `StandardNodeLibrary`.** It does not degrade under `WebGPURenderer` —
  it fails `Material "ShaderMaterial" is not compatible` and draws through a bare `NodeMaterial`.
  Adding one without a node twin is a black surface, not a slightly wrong one.
- **`drawCallsByPass` IS WEBGL-ONLY.** The node `Renderer` has no seam between the shadow pass and
  the colour pass to meter, so it reports zeros with a true total and `MAX_DRAW_CALLS` cannot be
  checked there. Do not invent a split.
- **`npm run shots` has two arms and they may never share a directory.** `shots/` and
  `node tools/shoot.mjs --gpu=webgpu` -> `shots-webgpu/`. The node arm launches REAL Chrome
  (`channel: 'chrome'`) because Playwright's bundled Chromium cannot get a WebGPU device here, and
  it asserts `rendererHandle.backend` per shot — a `webgl2-fallback` fails the capture rather than
  being labelled `webgpu`.
- **A CANVAS HOLDS ONE CONTEXT TYPE FOR LIFE, AND THREE'S OWN FALLBACK DOES NOT KNOW THAT.**
  Reported as a driver reset that killed the page with
  `TypeError: … null (reading 'getSupportedExtensions') at WebGLBackend.init`.
  `WebGPURenderer`'s constructor installs a `getFallback` that builds a `WebGLBackend` on
  `renderer.domElement`; `Renderer.init()` calls it on ANY throw out of `WebGPUBackend.init`; and
  that backend then asks the canvas WebGPU already claimed for a `webgl2` context, gets `null`, and
  dereferences it. `index.html` ships one canvas, so this is unavoidable — and `assertBackend` could
  not fire, because it reads the object `init()` RESOLVES with and here `init()` REJECTS.
  `gpu-path-install.ts#disableThreeFallback` nulls `_getFallback` BEFORE `init()` (guarded by an
  `in` check, so a three upgrade warns rather than silently re-arming it), and `prepareRenderer`
  catches the rejection. **Do not restore three's fallback and do not build any renderer on a canvas
  a `WebGPURenderer` has touched** — `liveCanvas()` in `renderer.ts` mints a fresh one, and it is
  identity on every WebGL boot.
- **`?gpu=webgpu` REFUSES when the device cannot be had. It does not substitute, loudly or
  quietly.** A visible panel names the failure and the GPU and carries a one-click *Continue on
  WebGL* that reloads without the flag. The argument is above `raiseGpuFailure` in `renderer.ts`:
  a notice-plus-fallback is the same lie `assertBackend` exists to forbid — every downstream number
  would go on being produced about WebGL while the address bar said WebGPU, which is Stage A's
  defect exactly — and a lost device takes every GPU resource with it, so "recover onto WebGL" is a
  full re-boot either way.
- **`device.lost` IS A PROMISE THAT RESOLVES, and it is watched.** `device-loss.ts#watchDeviceLoss`,
  filtering `reason === 'destroyed'` (that is our own `device.destroy()`, i.e. teardown). A loss
  sets `isContextLost()` — which `post.render()` already early-outs on — and never clears, because a
  lost WebGPU device does not come back. `tests/gpu-device-loss.spec.ts` drives all of it from
  stubs; **no part of the recovery has been observed on real hardware** and `RENDER_FINDINGS.md`
  §7g says exactly which four claims that leaves unverified.
- **`powerPreference: 'high-performance'` IS A HINT AND WINDOWS IGNORES IT.** Stage A asked for it
  and its probe observed an integrated `amd`/`gcn-5` adapter on a box that also holds an RTX 3080.
  The live adapter is read off `device.adapterInfo` through `backend.ts#normaliseAdapterInfo` and
  published on `capabilities.adapter` and `__VM.gpuInfo()`. **The WebGL debug string is not a
  substitute** — it names whichever chip *WebGL* got. And do not read `GPUAdapterInfo` with a
  spread: its fields are on the prototype, so `{...info}` is `{}` on every real adapter.
- **The speed verdict was overturned and the old one is still quoted in places.** Stage A's
  synthetic sweep said WebGPU was at best neutral; on the REAL game it is **1.74-1.89x faster**
  across a 9x pixel range, because §9 had already established the frame is fill-rate bound and the
  sweep measured per-draw CPU cost. `docs/RENDER_FINDINGS.md` §7f is the measurement; §7b now
  carries the correction at its head.

## There is a desktop build now, and the web build did not move an inch

`desktop/` is an Electron shell around the UNMODIFIED `dist/`. Read
[`desktop/README.md`](desktop/README.md) and [`docs/ELECTRON_PLAN.md`](docs/ELECTRON_PLAN.md)
before touching it. The constraint was *"they should be able to live side by side. github pages
deployment continue as is, and the desktop version wont run in ci for now"*, and it is satisfied
**structurally, not by discipline**.

- **`desktop/` HAS ITS OWN `package.json`, exactly like `server/`.** The `electron` package's
  postinstall downloads a **144 MB** binary; in root devDependencies that lands on every Pages CI
  run. Here, root `npm ci` never sees it and **`deploy.yml` needs zero edits**. The build proves it:
  the entry chunk after all of this is `index-BoivCkEI.js`, the same hash as before.
- **`npm run desktop:typecheck` IS A FIFTH INVOCATION AND IT IS DELIBERATELY NOT IN THE GATE.**
  Appending it to `npm run typecheck` fails Pages CI on `TS2307: Cannot find module 'electron'`
  unless `deploy.yml` also gains `npm ci --prefix desktop` — the file that must not change. Fold it
  in on the same commit that puts desktop in CI. This is the `server/node_modules` trap again.
- **THE GPU SWITCH WORKS, AND IT IS MEASURED TWICE.** `RENDER_FINDINGS.md` §7j. On the RTX 3080
  laptop, both spellings work *alone*, and one switch moves **both** renderers:

  ```
  default          0x10de:0x249c   NVIDIA GeForce RTX 3080 Laptop GPU
  --vm-safe-mode   0x1002:0x1638   AMD Radeon (integrated)
  ```

  `powerPreference: 'high-performance'` still cannot do this — that hint is ignored on Windows, which
  is what §7g measured. Switches MUST be appended before `app.whenReady()`; the GPU process launches
  after `ready` with the command line it had at launch, and a late append is a silent no-op. The
  effect site is also conjoined with `&& system_device_id_high_perf`, so **read the adapter back**
  rather than trusting that the switch was appended. `main.ts` logs it every boot.
- **"EVERY FLAG ON BY DEFAULT" IS THE WRONG DEFAULT AND `flags.ts` SAYS WHY.** Three ship.
  `--disable-frame-rate-limit` is opt-in because it removes the vsync-flat case *by construction*,
  which breaks `HardwareCalibration`'s `not-fill-rate-bound` guard — the property CLAUDE.md already
  calls "what makes it safe to ship on hardware nobody here owns" — and `graphics.calibrated` is
  sticky, so the damage persists. `--enable-zero-copy` is not a Chromium switch at all.
- **`app://`, NEVER `file://`, and `standard: true` is what keeps saves alive.** Electron disables
  web storage for non-standard schemes. Without it `SaveStore.detectBackend()` hands back an
  `IndexedDbBackend` that throws at WRITE time — `indexedDbOrNull()` only tests that the global
  exists, it never calls `open()` — while `detectIndexStorage()` has no IndexedDB tier and falls to
  `MemoryIndex`. Signature: saves error on write and the list is empty next launch. `secure: true` is
  equally load-bearing: `navigator.gpu` is `[SecureContext]`-gated, so without it `?gpu=webgpu` is
  permanently unreachable and the faster renderer is dead on desktop.
- **A DENY-ALL `will-navigate` HANDLER BREAKS STARTING A MATCH.** `Shell.hardLaunch` calls
  `location.assign`, and the GPU-failure panel's two buttons call `location.replace`. All three are
  renderer-initiated, so they DO fire the event. And never compare `.origin` — Node's URL parser
  returns the string `'null'` for `app://voltmarch/x`, because it knows nothing about a
  privileged-scheme registration.
- **THE DESKTOP TARGET IS OUTSIDE CI, SO EVERY DECISION LIVES OUTSIDE `main.ts`.**
  `desktop/src/{flags,app-url,paths,display}.ts` import no electron and are tested by
  `tests/desktop-shell.spec.ts` in the ordinary gate, including the path-traversal guard and an
  import-boundary check that fails if the shell ever reaches into `src/`. Only the wiring needs a
  binary, and that is `npm run desktop:smoke`.

  **`desktop/build.mjs` resolved its entry points against the CALLER'S CWD**, and the repo root has
  a `src/main.ts` of its own — the game's. So `node desktop/build.mjs` from the root pointed esbuild
  at the wrong entry and began bundling the whole game into the Electron main process, announcing
  itself only as a wall of `import.meta is not available with the "cjs" output format` warnings.
  `npm run desktop:build` set the cwd correctly, which is why it stayed invisible. Paths resolve
  from the file now, exactly as `tools/brand.mjs` documents having fixed for the same reason.
- **THERE IS A DESKTOP-ONLY DISPLAY SECTION, and `src/platform/desktop.ts` is the seam.**
  Window mode, window size, monitor, graphics processor, unlock frame rate, and a button to the
  save folder — top of Options → Graphics, absent in a browser because the accessor returns null
  there. **That file must import NOTHING**, which a test asserts: the game may not reach into
  `desktop/`, so the IPC shapes are declared on both sides and `tests/desktop-shell.spec.ts`
  compares the two declarations rather than letting an import paper over the boundary.

  **`bridge` is a VERSION and the check is EQUALITY** — it went 1 → 2 with these methods. A bump on
  one side only makes the game fall silently back to web behaviour: no Display section, no error,
  nothing in the console. Correct at runtime, awful to debug, so the two literals are checked
  against each other in the gate. The accessor the preload's own header had been describing since
  the day it was written **did not exist** until this landed, and nothing in the renderer read the
  bridge at all — seven methods exposed to nobody.

  **TWO WINDOW MODES, NOT THREE, and that is a platform fact.** Chromium has no mode-setting path,
  so `setFullScreen(true)` is a borderless window sized to the monitor; shipping both "Fullscreen"
  and "Borderless Windowed" would be two labels for one behaviour. The row says so instead. And
  window mode/size/monitor apply immediately while the GPU and frame-rate rows **cannot** — those
  are switches, appended before `app.whenReady()` — so they set `relaunchPending`, compared against
  what the process actually launched with rather than against defaults.
- **WHAT IS STILL WEB-ONLY PROSE.** `README.md`, `package.json`, `index.html` and two wiki pages
  describe this as a browser game; they are INCOMPLETE rather than false, and were deliberately left
  until the desktop build is actually distributed. Two claims will need real care at that point:
  `server/README.md:98` and `wiki/Multiplayer.md:58` say a browser refuses a plaintext socket from a
  secure page, and that is the stated reason the relay needs no transport check of its own —
  `pageIsPlaintext()` tests `location.protocol !== 'https:'`, which an `app:` origin passes. See
  `ELECTRON_PLAN.md` §8.

## Hard rules

- **Determinism.** Inside `simTick`, `Math.random()`, `Date.now()` and `performance.now()` are
  banned — there is a test asserting this. Use `s.rng` and the tick counter. This is not
  hygiene any more: it is what makes multiplayer possible at all.
- **Performance.** 200+ units at 60fps, zero allocation in the frame loop, and a draw-call budget of
  130.

  **`frame.drawCalls` AND `MAX_DRAW_CALLS` MEASURE DIFFERENT QUANTITIES, AND THIS BLOCK COMPARED
  THEM FOR THREE RELEASES.** `renderer.info.autoReset` is `false` (`renderer.ts`) and the reset
  happens once per frame in `beginFrame()`, so the number in `shots/_report.json` is a SUM OVER
  EVERY SCENE SUBMISSION, not the colour pass. `MAX_DRAW_CALLS` budgets the COLOUR PASS.
  `stats()` emits `drawCallsByPass` and `shots/_report.json` carries `frame.drawCallsByPass`, where
  `shadow + colour + ao + post === total` by construction. **Quote `frame.drawCallsByPass.colour`
  against `MAX_DRAW_CALLS`; quote `frame.drawCalls` only as the content fingerprint it is.**

  **THERE ARE TWO SCENE SUBMISSIONS NOW, NOT THREE.** `GTAOPass` used to build its normal G-buffer
  by drawing the whole scene a second time with `MeshNormalMaterial` — 39-57 draws per fixture,
  26.8-29.4% of every frame. `installAoDepthGBuffer` in `src/render/post.ts` hands the pass the
  depth the colour pass already wrote and reconstructs the normals with one full-screen quad, so
  `_renderGBuffer` is false and that submission is gone. Measured over all thirteen fixtures:

  ```
  before   total 143–213   ao 39–57   colour 51–77
  after    total 105–157   ao      0  colour 51–77      (01-establishing-base: 207 -> 151)
  v2.12.0  total 105–157   ao      0  colour 54–77      (prop type cap 22 -> 30)
  v2.16.0  total 108–159   ao      0  colour 56–79      (re-measured, not carried forward)
  ```

  So **the budget is met** — the colour pass is 51–77 against 130, and it did not move — and the
  previous instruction here ("do not spend draws freely on the grounds that the budget is
  fictional") was chasing a gap that does not exist. **A non-zero `ao` now means the depth
  G-buffer failed to install and the prepass came back**; it is kept as a real fallback for a three
  upgrade that moves the internals that wiring reaches into.

  **Requote both figures from a real `_report.json` rather than carrying them forward** — the old
  range drifted three times, twice upward, and a range nobody re-measures is exactly how the
  comparison above came to be believed.

  **The AO scorecard is not sensitive to AO.** Deleting the prepass moved the weighted grade by
  0.000000 (0.892308, 16 failures, before and after) while changing 17-32% of every frame's pixels,
  and turning AO OFF entirely moves it barely more. `tools/metrics.mjs` is a frame-wide statistic;
  use `tools/shot-compare.mjs` and an AO-disabled control capture before believing any AO change.

  **There is no CSM.** `src/render/scene.ts` builds ONE `DirectionalLight` with ONE orthographic
  shadow camera, and the only other shadow-capable light — the ground bounce — sets
  `castShadow = false`. `QualitySettings.shadowCascades` used to be written and read by nobody; it
  is deleted now, along with `shadowResolution`, `lodBias`, `lodDistances`, `cascadeNear`,
  `shadowColor`, `bloom.mips` and `lensDirt`.

  **THERE IS ONE LOD, AND IT IS TERRAIN-ONLY.** This said "there is still no LOD system" until the
  `terrain-halfres-lod` branch landed. `buildTerrainChunks` now emits a SECOND index over the same
  vertices for chunks with no relief worth drawing at 1 m, bounded by `TERRAIN_LOD_MAX_ERROR`
  (0.15 m). It is not a distance LOD and there is still no `lodDistances` — a chunk is decimated on
  its own FLATNESS, once, at generation, and never switches at runtime. Do not write code that
  assumes a general LOD system, a distance ladder, or per-frame selection.

  Its one real risk is a T-junction crack, and it is excluded structurally rather than looked for:
  every boundary edge of a coarse chunk spans exactly one grid step, so it draws the same polyline
  a fine neighbour draws, vertex for vertex, against ANY neighbour. `tools/metrics.mjs` could never
  have caught the alternative — a two-pixel seam moves no frame-wide statistic — which is why
  `tests/terrain-lod.spec.ts` proves the geometry instead of scoring pixels.

  **THE SAVING IS SMALL AND THE COUNTS ARE PINNED FOR A REASON.** Four to sixteen of sixty-four
  chunks qualify depending on the map; on the landlocked roll ten of the thirteen capture fixtures
  stand on, it is four, which is ~1.5% of the terrain and less of a frame. The counts are pinned
  per-map so that any generator change announces itself — and it has already fired once, when the
  start-spread widening pulled the four start shelves apart and cost three maps their fused central
  flat blob. Read the header of that spec before re-baselining it: two of the five fixtures cannot
  be reached by a start-point change at all, and if THOSE move, the generator is broken.

  InstancedMesh for anything repeated, pools for anything spawned, caller-supplied output arrays in
  query paths.
- **The AI issues the same commands the player does**, through `channels.command`. It must never
  reach into entity state directly.
- **No `AmbientLight` anywhere.** `HemisphereLight` only — a flat ambient kills the shadow tint that
  the whole grade depends on.

## Before you research the renderer, read what was already measured

[`docs/RENDER_FINDINGS.md`](docs/RENDER_FINDINGS.md) holds the ANSWERS to questions that have
already been paid for — with the instrument, the number and the date. It exists because several
expensive investigations were re-run from scratch by people who had no way to know they were
settled. Read it before opening a renderer question. The four that change what you would otherwise
do:

- **The draw-call budget is not being missed.** `frame.drawCalls` sums THREE scene submissions;
  `MAX_DRAW_CALLS` budgets the colour pass alone, which runs 51–77 against 130. There are ~50 colour
  draws of headroom and several systems are capped "for the budget" against a budget that is half
  empty.
- **Reading `config.ts` is not the same as knowing what the shader did.** The grade pass ran on its
  constructor literals for its entire life — `ShaderPass` deep-copies a plain shader description —
  so grain and chromatic aberration shipped LIVE while config said 0 and a test that scanned config
  passed. When it matters, read the uniform off a booted page.
- **The AAA gap is under-tuning, not missing systems, and not the procedural constraint.** The road
  generator hits the bible's detail band from pure code while terrain delivers a quarter of it.
- **`edgeCoverage` failing 13/13 is real** and must not be demoted: subject crops are in band, the
  ground is ~4× under, and the frame is 60–75% ground.

**The ACTION PLAN that comes out of all this is [`docs/VISUAL_GAP_PLAN.md`](docs/VISUAL_GAP_PLAN.md)**
— a prioritised, costed, parallelisable list of what to change to close the distance to the RA3
reference, with the measurements inline so nobody re-derives them. Start there. Its P0 is four
free fixes, the first of which is a 10x threshold bug in the terrain splat classifier.

`docs/SPEC_DRIFT_AUDIT.md` catalogues claims that stopped being true; `RENDER_FINDINGS.md` is the
opposite — things that are true and cost a lot to establish. Overturn an entry by rewriting it, not
by appending a contradiction.

## Graphics are MEASURED ONCE at first run, and adaptive resolution is off

Reported as *"i want the adaptive resolution to be off by default. instead, set the graphic options
that match the best for user for the first time and thats it"*. `AdaptiveResolution` is not deleted
— it is a good controller, its one-way ratchet is fixed, and it stays a toggle. What changed is the
default and what fills the gap: `src/render/HardwareCalibration.ts` plus `calibration.system.ts`.

- **THE FRAME IS A STRAIGHT LINE AND THE ANSWER CAN BE SOLVED.** `docs/RENDER_FINDINGS.md` §9 fitted
  `GPU ms = 5.86 + 6.40 x Mpx` at r² 0.995, with 79-90% of GPU time pixel-proportional. So the
  calibration renders two probe windows at two known pixel counts (probe A from the adapter prior,
  probe B at 70% of it — 49% of the pixels), fits that line, and solves for the scale that meets
  16.7 ms. 110 frames: ~1.8 s at 60 fps, ~4.7 s on the 23.6 fps machine §9 measured.
  `tests/hardware-calibration.spec.ts` feeds it §9's own machine and requires it to recover 5.86 and
  6.40 exactly, then reproduces §9's published 0.694 — which is at a 17.22 ms target, not 16.7.
- **THE ADAPTER IS A PRIOR AND CANNOT CHANGE THE ANSWER.** `capabilities.adapter` (§7g),
  `classifyGpu` and the backend (§7f: WebGPU 1.74-1.89x faster) decide only where probing STARTS.
  Two different priors on one machine produce one result, and that is a test.
- **IT REFUSES TO CUT WHEN THE FRAME IS NOT FILL-RATE BOUND.** A fitted slope under 1.0 ms/Mpx means
  a vsync-capped display with headroom or a CPU-bound frame, and blurring buys nothing in either
  case. This is the property that makes it safe to ship on hardware nobody here owns.
- **IT MUST NEVER RUN UNDER `?shot=`, AND THE STRUCTURAL GUARD IS THE ONE THAT MATTERS.**
  `armCalibration` has exactly ONE caller, `src/shell/Shell.ts`, and `main.ts#bootHarness` never
  imports the shell — pinned by a test that enumerates `src/**/*.ts`. Two runtime guards back it up
  (`loop.captureClock`, read LIVE in both places, and `handle.isFixedSize`). **A fourth, `rc.dt > 0`,
  is deliberately NOT called a guard**: it survived mutation because `sample()`'s own `frameMs > 0`
  filter already refuses a zero interval, and a line labelled "guard" that cannot be made to fail is
  exactly the assertion this project has shipped believing. It would not have sufficed anyway —
  `GameLoop.advanceTicks` renders at a synthetic 33.3 ms.
- **`graphics.calibrated` is the whole protocol, and its default depends on whether a blob exists.**
  A profile with NO stored settings gets `false`; a blob written by an older build has no such key
  and `normalizeSettings` defaults it to `true`, because raising a setting somebody lowered is the
  one failure this feature has to avoid. Any change to a picture-affecting graphics row retires it —
  enforced in `SettingsStore.patch`, not in the options screen, so the next row added inherits it.
  The exempt list (`panelBlur`, `perfOverlay`, `fov`, the zooms, `fpsCap`) is the only escape and
  everything off it retires by default. Reset Graphics and "Calibrate Now" are the two routes back.
- **v3 of the settings schema takes adaptive resolution off a pre-v3 profile that has `true`.** Same
  shape and same honest limit as `migrateBindings`: nothing distinguishes the old default from a
  deliberate choice, so somebody who liked it flips one toggle once.
- **WHAT IT ACTUALLY SETS, AND WHAT IS DEAD.** `resolutionScale` (the lever — 79-90% of the frame),
  and, only when the fit says the 0.55 floor still misses 60 fps, `ao` off (16.9%, 4.97 ms) and
  `shadowQuality` low (~2%). **It does NOT touch the quality tier**, because the tier is the one
  setting that moves `maxPixelRatio` and therefore the pixel count the calibration just solved for —
  a feedback loop the measurement cannot see. It never turns MSAA on. Three things are worth knowing
  before wiring anything else to a "tier": `applySettings` re-asserts `ao`/`bloom`/`smaa`/
  `shadowQuality`/`resolutionScale` ON TOP of the tier, so all the tier uniquely still owns is
  `maxPixelRatio`, `ao.samples`, `ao.halfRes`, `bloom.radius` and the art `textureSize`;
  **`graphics.fpsCap` has ZERO readers** (persisted, clamped, no UI row, no consumer); and **`?tier=`
  never reaches the product path** — `main.ts` parses it and does not hand it to `Shell`, so it is
  harness-only while this file's boot-flag list implies otherwise.

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

**THE STANDING GRADE IS 91.1%, 14 FAILING CHECKS OVER 13 IMAGES, WITH ONE FATAL** —
`01-establishing-base #12 far-minus-near saturation` at -0.0735 against a -0.05 floor. Measured
2026-08-18 on the shipping WebGL path. The two other figures quoted further down (92.0%/13 for the
roads A/B, 0.892308/16 for the AO ablation) are HISTORICAL A/B controls and should not be read as
the current score.

**AND THE FATAL IS PRE-EXISTING, WHICH IS ONLY KNOWABLE FROM A CONTROL CAPTURE.** The spawn work
moved every start shelf twice, so the honest question was whether it caused that failure. Captured
at the commit before it and byte-compared:

```
6 of 13 fixtures BYTE-IDENTICAL      01-establishing-base  08-naval-water  09-placement
                                     11-dusk-mood  12-blob-readability  13-atoll-crossing
7 changed                            02 03 04 05 06 07 10
grade                                91.1% / 14 failures / same single FATAL, both sides
```

`01-establishing-base` is byte-identical, so the FATAL sits on a frame the change never touched.
Two of the others are load-bearing confirmations rather than luck: **`08-naval-water` is identical
because `NAVAL_SEA` has no dry pair and `dryPairs` falls back to [0,1]**, which is exactly what that
function's comment promises, and **`13-atoll-crossing` is identical because an island layout cannot
be reached by a slot change**. A change that had really broken start placement could not have left
those two alone.

**Do not read an unchanged weighted grade as "nothing moved".** More than half these frames changed
while the grade did not move at all — it is a frame-wide statistic, and `tools/shot-compare.mjs`
plus a control capture is the only thing that answers "did this fixture change".

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
nothing else. **`?tier=` is HARNESS-ONLY** and this line implied otherwise for its whole life:
`main.ts` parses it into `options.tier`, hands `options` to `bootstrap()` on the `?shot=` path, and
does NOT pass it to `Shell` — which takes its tier from `settings.graphics.tier` instead. All four
tiers boot identically on the product path.

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
