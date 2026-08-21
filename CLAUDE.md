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
npm test             # vitest, currently 6126 across 244 files (+4 opt-in probes)
                     #   11 of those are gated on `distIsCurrent()` — freshness, not mere
                     #   existence — across `manual`, `webgpu-bundle-isolation` and
                     #   `campaign-bundle-isolation`, so a tree with no current `dist/`
                     #   reports 6115 and skips 15. Re-measure BOTH numbers rather than
                     #   adjusting them by hand — run it once, `npm run build`, run it
                     #   again. The gated set has held at 11 across eight re-measures;
                     #   the OPT-IN set is what keeps growing (3 -> 4 on 2026-08-20).
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
- **Its `dispose()` calls `detachPlayback`, not `preparePlayback(null)`.** `startReplay` arms the file and then
  boots, and booting disposes the previous engine — clearing the armed file there meant the viewer
  silently got an ordinary AI-less skirmish on the recording's seed. Same split as `net.system.ts`.
- **`npm run replay-probe` is the proof**, and its second phase is the load-bearing one: it deletes
  one command and requires the playback to diverge. A matching hash alone would also be produced by a
  playback that fed the world nothing, because the AI is deterministic from the same seed.
- **`buildVersion` warns and does not refuse.** It is a correlation, not a cause — most releases here
  touch art the sim cannot observe — and the real question is measured every 30 ticks by the
  checkpoint compare, which the bar puts on screen. See `Replay.buildWarning`.

## `beginMatch` HAS TWO CALLERS, and the shell's carve-out could only ever see one

**Watching a replay of a win banked `matchesPlayed`, `wins`, `currentStreak` and every
kill/build/earn chain, in every shipped build since replays existed.** `Shell.startMatch` refused to
open the mission board for a replay under a nine-line comment saying exactly why — *"Watching a
recording is not playing a match: it must not count towards 'play 10 skirmishes'…"* — and that
refusal did nothing, because `MissionTracker.attach` subscribes to `match:started` and opens a match
ITSELF whenever none is open. `outcome.system.ts` emits that event edge-triggered on the shell
entering `'playing'`, with no replay, campaign or tutorial exclusion anywhere on the path. The shell
skipped its call; the bus made the same call one frame later.

- **`suppressProgression` in `src/progression/suppress.ts` is the fix, and WHERE it is read is the
  whole design.** It is read inside `MissionTracker.beginMatch` and `.endMatch` themselves, so it is
  honoured no matter who calls them. It imports nothing and is a module-level boolean — deliberately
  the twin of `UnlockGate`'s `suppressed`, which exists for the same reason on the same boot path.
- **A GUARD THAT LIVES AT A CALL SITE CANNOT SEE A SECOND CALL SITE.** That is the general lesson
  and it is why `tests/progression-suppress.spec.ts` emits `match:started` on a real `Channels` and
  asks `inMatch()`, never whether the shell skipped a call. A test in the caller-checking shape
  passes against the broken build — that is precisely how this shipped. The spec fails 5 of 8
  against the old behaviour, and the 3 that pass either way are its falsifiers.
- **Whoever sets it clears it.** `Shell.startReplay` sets, `clearReplay` clears, and `startMatch`
  clears on the same guarded line that restores the unlock gate — `suppressUnlockGate` leaked
  exactly once and left every later skirmish ungated, and this is written against the same predicate
  so the two cannot drift apart.
- **`endMatch` is gated in its own right**, not merely by `beginMatch` refusing. A latch set
  mid-match must not let the lifetime record out on the way past, and `won`/`currentStreak` are
  exactly what a replayed victory would otherwise bank.
- **`advance()` reads the latch too**, so "the profile is deaf" covers the COUNTER CHAINS and not
  only the lifecycle. `attach()` subscribes to nine events and every one lands in `advance`, which
  writes profile-scope rows and grants unlocks. `beginMatch` only ever reset the MATCH-scope rows.

**AND THEN THE FIX'S OWN CLEARING CONDITION UNDID IT ONE LINE LATER.** `Shell.startOperation` sets
the latch and calls `startMatch`, whose ordinary-launch restore read
`if (this.pvp === null && this.replay === null)` — both null for a campaign, so it cleared the latch
immediately. A scripted operation then counted its AUTHORED kills and ore onto the profile and the
end screen showed a Rewards Earned panel with four unlocks in it.

Three things worth keeping from how that was found and fixed:

- **It was found by LOOKING AT THE SCREEN**, on a real boot, after every test was green. The screen
  also showed the match named "Temperate Valley" while being fought on arid ground, because
  `bootGame`'s query override fixes what the GENERATOR builds and `setup.map` is what every LABEL
  reads. Two defects, one screenshot, neither reachable from a unit test.
- **`inMatch() === false` PROVES NOTHING**, and it is what the first diagnosis leaned on. It reads
  false after `endMatch` whether the match was suppressed or merely finished, so it agreed with the
  broken build. Read the profile, not the flag.
- **The first regression test was VACUOUS IN BOTH DIRECTIONS.** It suppressed, then emitted kills
  and credits — but `entity:killed` and `economy:credits` both early-return when no match is open,
  so with the lifecycle already gated the events never reached the counter path at all. It passed
  with the gate on and with the gate deleted. It opens the match honestly and latches afterwards
  now, which is the only ordering that reaches the rule.

## There is a campaign now, and it is a SECOND CONSUMER of the engine

**IT IS COMPLETE AS OF 2026-08-21: 37 operations, 9 / 9 / 9 / 10, 637 minutes of authored par.**
`tests/campaign-length.spec.ts` was built to arm itself at the 37th row and become a hard ten-hour
floor with no edit required; it did, and the table clears it by 2 220 s (38 220 against 36 000). The
margin is 37 minutes, which is longer than the longest single row — so no ONE retune or deletion
can break it and two of the long rows can. **Every par except S1's is an author's estimate**: exactly
one operation has ever been played end to end by a person, and that is the standing debt, not a
defect. Do not read "the campaign is done" as "the campaign is timed".

`src/campaign/` is a story mode of authored operations: a declarative trigger table per operation,
evaluated by a pure director inside `simTick`. **It is not a widening of the mission system and it
shares no rule language with `MissionRule`** — `RULE_KINDS` evaluates counters over the EVENT STREAM
outside `simTick`, an operation needs state predicates over the WORLD inside it, and those are two
languages on opposite sides of the determinism boundary. `tutorial-steps.ts` refused the same merge
first, for weaker reasons. Read `src/campaign/types.ts`'s header before proposing a third way.

- **THE VOCABULARY IS FROZEN: 12 conditions, 3 combinators, 11 effects.** Adding one after content
  authoring begins is a schema change across every operation file. Two were considered and CUT with
  the reasons written into `types.ts` so nobody re-derives them — `spawnBuildings` (no runtime
  equivalent exists, and every premise that looked like it needed one is a structure the LAYOUT
  places and a trigger reveals, repairs or captures) and `setInvulnerable` (an escort whose subject
  cannot die is not an escort; what a designer wants from it is bought by not spawning the threat
  until the first checkpoint).
- **`campaign.system.ts` IS `Phase.Cleanup` ORDER 9000 AND THAT NUMBER IS WHAT MAKES REPLAY WORK.**
  An order issued there lands on the bus AFTER the Command-phase drain and applies on tick N+1.
  Recording: recorded at N+1, applied at N+1. Playback: the Director re-derives the same order at
  Cleanup of tick N and `playback.system.ts` (Phase.Command order 1) HARVESTS the bus at the start
  of N+1, throwing the copy away, before feeding the recorded one. Exactly once, same tick, either
  way. **Move it ahead of the drain and every scripted order applies twice under playback** — trap 2
  in `Replay.ts`, avoided by a phase number rather than a flag. One `order` serves both phases and
  9000 is right on both sides; if they ever need to diverge, SPLIT THE MODULE.
- **AN OPERATION DECLARES ITS OWN ENEMY — `OperationDef.foe`, REQUIRED, NO DEFAULT.** Until it
  existed, `Shell.startOperation` authored the PLAYER's army from `op.faction` and took the ENEMY's
  from `this.setup.aiFaction` — the skirmish lobby. So `soviets.02.common-standard`, whose dialogue
  names the enemy "Allied" four times, was fought against the Reclamation if that is what the lobby
  happened to hold. Required rather than defaulted for `startPointsFor`'s reason: every available
  default is wrong for three of the four armies, and `tsc` naming all five operation files beats a
  silent relabelling.

  **SETTING `opponents` ALONE FIXES NOTHING, AND A TEST READING IT WOULD AGREE IT DID.**
  `applySetupToWorld` seats through `effectiveOpponents`, which re-asserts the SINGULAR `aiFaction`
  onto entry 0 — its own comment says "when they disagree the SINGULAR fields win". Every shipped
  operation is two armies, so seat 1 goes on taking the lobby's faction while the array says
  otherwise. `aiFaction` moves with `op.foe`; `difficulty` deliberately does not.

  **A SCRIPTED `spawnUnits` KEY STAYS LITERAL AND IS VALIDATED, NEVER REMAPPED.** `EffectSink`
  resolves through `catalog.byKey` with no `keyFor`, unlike `ScenarioBuilder.spawnUnit`. That is not
  a bug to close by remapping: an authored operation naming a hull means THAT hull, and
  `FACTION_KEY_MAP` covers ~30 ROLE keys only, so `rclGrinder` on an Allied seat remaps to itself
  and the disagreement survives the "fix". `validateCampaign` refuses a key whose declared army is
  neither Neutral nor the seat's, reading the row's own faction so it covers every key.

- **THE BUNDLE BOUNDARY IS THE FIRST CONSTRAINT, NOT A CLEANUP.** `src/game/Systems.ts` globs
  `*.system.ts` with `eager: true` FROM THE ENTRY CHUNK, so `campaign.system.ts` imports
  `campaign/{session,policy,types}.ts` and nothing else. The Director, the operation table, the
  layouts and the prose arrive through ONE `await import('../campaign/campaign-install')` in
  `Shell.startOperation`. Measured at the time: entry +3.31 kB, campaign chunk 23.1 kB, Shell chunk +7.5 kB. **The
  chunk figure is a snapshot of ONE operation, not a budget** — it is 406 kB at thirty-seven, and it
  is meant to grow. The entry delta is the number that must not move, and
  `campaign-bundle-isolation.spec.ts` is what holds it.
  **Never `import` anything under `src/campaign/` from a `*.system.ts` except those three.**
- **NO NEW `CommandKind`, AND `src/net/protocol.ts` IS NOT TOUCHED.** `spawnUnits` calls
  `ProductionService.spawnUnit` directly inside `simTick`. A wire-legal spawn command would travel
  to the relay, whose contract is *"stamps identity; the simulation enforces authority"* — and the
  sim has no authority test that would refuse a PvP client conjuring an army.
- **`elapsedSinceArmed` IS A HOLD TIMER AND THE DIRECTOR EVALUATES EVERY TRIGGER TWICE FOR IT.**
  Pass one forces it true to decide whether the trigger's OTHER conditions hold, which sets or
  clears the arm tick; pass two compares against that tick. Losing a derrick at minute five of a
  six-minute hold therefore RESTARTS the clock. The other way round hands the player a win for
  holding nothing, which is a failure in their favour and the direction nobody reports.
- **`entityDead` IS TRUE BEFORE THE TAG HAS EVER EXISTED.** A mistyped `protect` fails the player on
  tick one, silently. The same is true of `ownerCount(..., max: N)` and of `playerBeaten`, and
  `soviets.06`'s `SETTLE` block is the pattern for guarding all three.

  **BUT A CORRECTLY SPELLED TAG IS NEVER EMPTY WHEN THE DIRECTOR FIRST RUNS, AND TWO SEPARATE
  INVESTIGATIONS HAVE NOW HAD TO DERIVE THAT.** `campaign.system.ts` is `Phase.Cleanup` order 9000
  and `scenarios.system.ts` is order 10 000, which looks like the Director evaluating an empty
  world on tick one — and it is not, because `game.scenario` builds the world inside `async init()`
  and `SystemRegistry.init` awaits every module's init IN SEQUENCE before `initialised` is set. So
  the settle guards are defence against a layout that placed NOTHING, which is reachable and which
  `campaign-roster-ground.spec.ts` exists for. They are not a fix for a failure anyone has
  observed. Say which when you write one. That is why a layout DECLARES its tags and `validateCampaign` refuses a
  trigger naming one no layout produces — and why `campaign-maps.spec.ts` builds every operation
  headless and checks the declaration against what actually landed, in both directions.
- **THE AUTHORING CONTRACT WAS AUDITED CLAIM BY CLAIM: 124 CHECKED, 24 FALSE.** `types.ts`,
  `runtime.ts` and `validate.ts` are what every operation author reasons from, and one stale
  sentence in the first of them had just cost four operations and eighteen defects. A 19% falsehood
  rate is the number to keep — **the campaign's prose is not more reliable than its code, and it has
  no gate**. Among them: `campaign.system.ts` does not import `types.ts` at all; `UNLOCK_TAGS` is 33
  defs across THIRTEEN tags, not ten; `validate.ts` refuses a missing win path and a missing lose
  path INDEPENDENTLY, so its own header, `policy.ts` and this file all understated it; §9's Director
  signature had wrong parameters, a wrong return and an `rng` argument that never existed; and three
  citations named specs that do not exist.

  **THE FOUR REAL DEFECTS IT SHOOK OUT ARE THE REASON PROSE AUDITS ARE NOT TIDYING.**

  - **`tests/campaign-data.spec.ts` DID NOT EXIST**, and `UnlockGate.ts` cites it as the mechanism
    catching the roster hazard this file calls *"not fixable by changing the default"*. It exists
    now: 33 defs across 13 tags pinned BY VALUE, failing in both directions, naming every operation
    whose roster a new tag just narrowed.
  - **`facts.unlockIds` was `Object.values(UNLOCKS)`** — including `cosmetic.*` and `map.*` — while
    the fault it feeds says *"is not an UNLOCK_TAGS id"*. A roster naming `map.coral-shore`
    validated clean and restricted nothing. **A well-spelled no-op is worse than a typo**, because
    the typo was refused.
  - **`ownerCount`'s TAGGED branch did not skip `UnderConstruction`** while its untagged branch did,
    under a comment giving the reason — and tagging is the spelling the guidance recommends.
  - **`PresentationEvent` is declared twice** and the duplication is forced by the bundle boundary,
    but an OPTIONAL field added to one copy is assignable in both directions, so tsc could never
    have caught the drift. Gated by text comparison, which is the only thing that sees it.
- **`spawnUnits` IS A FIXED RING AND `spread` IS ITS RADIUS — THE TYPE SAID "SCATTER … DRAWN FROM
  `s.rng`" AND THAT ONE SENTENCE COST FOUR OPERATIONS.** Unit `i` of `count` lands at exactly
  `angle = i / count * 2π`, so a wave of four uses the four CARDINAL bearings every time, and
  `ProductionService.spawnUnit` writes the point VERBATIM — no `connectedGround`, no egress search.
  Believing the type, three separate layout headers justified their spawn points by SAMPLING a ring
  (*"8 of 12 samples on an 18 m ring"*, *"7 of 8 samples of the spawn ring"*), which measures a
  distribution the engine never draws from; all three passed their own sample and failed the real
  bearings. 18 drops on closed ground across four operations, each one a hull that starts the fight
  wedged and waits on `Movement`'s cliff branch and `Steering`'s pocket rescue.

  **`reclamation.01.held-paper` IS THE CASE THAT PROVES `spread` IS NOT THE KNOB.** Its mercy column
  ringed the Foundry, which backs onto relief no wheeled hull can cross: of the four bearings a wave
  of four uses, only the westward one is open, **at every radius from 8 m to 44 m**. Move the SPAWN
  POINT. `tests/campaign-spawn-ground.spec.ts` checks every point of every scripted wave against
  that wave's own locomotor — resolved through the same three tables `spawnUnit` reads, honouring
  `waterOnly → Naval` and `amphibious → Hover`, because `mrdSolarch` is hover and asking `passGrid`
  the wrong bit answers a different question in both directions. **The ring formula is source-gated
  against `runtime.ts` rather than re-derived**, since a re-implemented formula nobody checks is the
  same defect wearing the other hat.
- **AN AUTHORED LITERAL IS A REQUEST, AND FOR A NON-SQUARE FOOTPRINT AT YAW 90/270 IT IS NOT WHERE
  THE STRUCTURE LANDS.** `ScenarioBuilder.spawnBuilding` snaps on the **FACED** footprint
  (`facedFootprintW/H`), so a 3x2 or 2x3 at a yaw quantising to 90 or 270 snaps on the SWAPPED
  lattice — and the two lattices have opposite parity in both axes, so the structure moves by
  exactly **(+/-2, +/-2) = 2.83 m**. Not "may move": it always moves. Measured across the built
  campaign, **173 of 2121 buildings, in every one of the 37 operations**. Square footprints and
  yaw 0/180 are unaffected, which is why the control in any such measurement is the other
  structures in the same layout landing exactly on their literals.

  So a layout header saying *"all five land on their authored literals at ring zero"* is a claim
  that has to be MEASURED off `store.posX/posZ`, not read off the source — three shipped headers
  said it and were wrong about one structure each. Where a constant is BOTH a record of a landed
  position and an input to something else, it is the landed value that is correct:
  `reclamation.01.held-paper`'s `SORTER` feeds an `orderTagged` move destination and was pointing
  2.83 m off the building it names.
- **THE CONSTRUCTION YARD OFFSET IS FOUR CONSTANTS KEYED ON THE CARDINAL YAW, AND THE ANCHOR IS NOT
  `startSpots`.** `buildBaseFor` puts the yard at local `{ dx: 0, dz: -4 }` in both base tables,
  `cardinalBaseFacing` quantises the yaw to 0/90/180/270 BEFORE `cos`/`sin`, and every continental
  seat anchor is a multiple of 4 — so `Math.round` is always handed an exact `k + 0.5` and the
  snap adds exactly +2 on both axes, every time:

  ```
  yaw   0 : yard = anchor + ( +2, -2 )      yaw 180 : yard = anchor + ( +2, +6 )
  yaw  90 : yard = anchor + ( -2, +2 )      yaw 270 : yard = anchor + ( +6, +2 )
  ```

  **The correct anchor is `islandSeats(startSpots(cx, cz, armies, sea, seed), sea)[i]`**, not raw
  `startSpots`: identity on all 36 continental operations and wrong by 16-25 m on the atoll, whose
  seats come back `clampWorld(s.x - outward.z * ISLAND_SEAT_OFFSET, 4)` and are NOT lattice-aligned.
  Anchoring on the raw spots gives 3 predictor misses; anchoring correctly gives **1 of 70**, and
  that one is `reclamation.01.held-paper`, whose Foundry is layout-authored and never goes through
  `buildBaseFor` at all.

  **QUOTE THE TABLE AS A FALSIFIER, NEVER AS A SUBSTITUTE FOR MEASURING.** It holds only while the
  anchor is on the 4 m lattice, the yard came from `buildBaseFor`, and neither `connectedGround`
  nor `footprintClear` fired. None of those fires on the shipped 37 — but that is a property of
  this ground, not a guarantee. Also: **6 of 37 operations have ONE yard for two armies**
  (`soviets.02`, `allies.07`, `pact.08`, `pact.09`, `reclamation.04`, `reclamation.07`).
- **`tests/campaign-anchor-drift.spec.ts` PINS THE ANCHORS BECAUSE THE DERIVED FIGURES CANNOT BE
  PINNED.** On 2026-08-20 a base-geometry commit moved every structure in every generated base and
  introduced the faced-footprint snap above. Nothing failed. **147 measured claims across 38
  campaign headers silently became wrong**, including three distances a character speaks out loud,
  and it took a fourteen-agent sweep to find them.

  A gate over the prose is not achievable — a header says "a hundred and forty metres" in one
  place and "141.8 m" in another. What is achievable is pinning the ANCHORS every one of those
  figures derives from: each seat's start spot and each seat's landed yard, by value, per
  operation. **The failure message names the layout and operation files whose headers quote
  yard-anchored distances**, so the next drift arrives as "these headers are now suspect" rather
  than as silence. Same shape as `tests/terrain-lod.spec.ts` pinning chunk counts per map.
- **`Shell.playCampaignBeat` IS THE ONLY CONSUMER OF `PresentationEvent`, AND IT HANDLED ONE OF THE
  THREE KINDS THAT ARE PRODUCED.** `EffectSink` pushes `dialogue`, `eva` and `camera`;
  `campaign.system.ts` drains all three every frame and hands every one to that method, whose body
  was a single `if` on `dialogue` under a doc comment reading *"Dialogue and EVA for now"*. **Every
  scripted announcer line and every scripted `cameraMove` in all thirteen shipped operations was
  authored, validated, evaluated, buffered, drained and dropped on that line.**

  **NOTHING IN THE TREE COULD HAVE NOTICED, AND THAT IS THE GENERAL LESSON.** The producing half is
  correct and tested. `validateCampaign` refuses an `eva` naming a line outside `EVA_LINES` on the
  stated grounds that *"the announcer would say nothing"* — a guard on the NAME, sitting upstream of
  a consumer that ignored the name. Both effects are silent by nature, so a dropped beat leaves no
  exception, no console line and no pixel; and `npm run shots` never boots an operation. A guard on
  a value cannot see a consumer that never reads the value.

  It is a `switch` with a deliberately non-throwing `default` now — a future producer must not crash
  a match mid-operation — and `tests/campaign-presentation.spec.ts` compares the kinds the real sink
  EMITS against the kinds the switch NAMES, in both directions. **Its third section exists because
  the first draft was vacuous:** commenting out the one line that reaches the announcer left the
  suite 9/9 green, because `// sayEva(event.line);` still contains the token being matched. Every
  structural read in that file strips comments first. Verify a spec CAN fail before believing it.

  **ASKING THE SAME QUESTION ONCE MORE FOUND TWO MORE.** *Does the rest of the campaign's authored
  output reach a screen?* — `Shell.publishCampaignObjectives` stored the objective rows in a private
  field read by nobody, while `campaign.system.ts` concatenated a fingerprint string PER FRAME to
  decide whether to feed it; and `PauseMenu.currentObjectives()` read `__vmProgression`, so pressing
  Escape during an operation listed the player's SKIRMISH mission chain under "Objectives" — from a
  profile that is deaf for the duration. The panel was always right, because
  `ui/objectives.system.ts` reads `campaignSession()` directly. **One provider, polled, is the
  shape**; the dead channel is deleted and the pause menu reads the same view.
- **A PRESET IS NOT A BIOME, AND `OperationMap.biome` WAS TYPED `string` UNTIL AN OPERATION SHIPPED
  ON THE WRONG GROUND.** The two vocabularies overlap on three names — `temperate`, `snow`, `urban`
  — and disagree on exactly one: the `MAP_PRESETS` key is **`arid`**, the `BiomeName` is
  **`desert`**. `reclamation.03.sold-twice` was authored, measured and adversarially verified with
  `biome: 'arid'`, and `getBiome` answers an unknown name with a `console.warn` and TEMPERATE — so
  every number in its two headers is a number about temperate ground, and the operation whose
  dialogue calls the ground "the pan" nine times rendered as grass. It reached the PRODUCT, not
  merely the harness: `Shell.applyCampaignQuery` copies the string straight into `?biome=`.

  **A biome is the LANDFORM, not a palette** — `tierCount`, `stepHeight`, `plateauMetres`,
  `basinDepth` and every surface layer — so the fallback moved placements up to 32 m and put a
  scripted hull on ground no tracked unit can stand on. `biome` is `BiomeName` now and tsc names the
  file and the line. **`preset` stays a validated string because there is nothing to type it as** —
  `MAP_PRESETS` is a `Record<string, MapPreset>`, so `validate.ts` checks it against
  `facts.mapPresets` instead. That asymmetry is the reason the defect existed: of the two map-identity
  strings, the guarded one was the one whose typo would have been harmless.
- **AN ARMED OPERATION SELECTS THE SCENARIO.** `?shot=` is the only other thing that can name one
  and the shell deletes it from every match query on purpose. `bootScenarioName` answers
  `'campaign'` when `plannedOperation()` is non-null; there is no third flag, because a second
  signal that has to agree with the first is how two of them come to disagree. Both start-forcing
  sites in `Scenarios.ts` carry the campaign exception, and `'campaign'` with nothing armed still
  resolves to `'base'` so the router is total.
- **THE ROSTER IS AN ALLOW-LIST, WHICH INVERTS `UnlockGate`'s CENTRAL DEFAULT.** Tagged-and-unlisted
  means REFUSED — the only way an operation can say "you do not have Tesla Coils yet" without a
  deny-list. The cost is that adding an `UNLOCK_TAGS` entry to a def that had none retroactively
  withdraws it from both sides of every shipped operation, silently. Not fixable by changing the
  default without deleting the feature; caught instead by `index.ts` refusing a tag no `UNLOCKS` row
  produces. `setCampaignRoster` is consulted AHEAD of the PvP `suppressed` flag, because the
  operation's authored intent outranks a hammer an earlier match left set.

  **A ROSTER TYPO WAS SILENT IN EVERY OPERATION UNTIL 2026-08-19, AND TESTING IT NEEDS TWO THINGS,
  NOT ONE.** `ScenarioBuilder.spawnBuilding` asks `isBuildable` and SKIPS a refused def — no throw,
  no log — so the structure never lands, the layout's tag never stamps, and `entityDead` on it reads
  TRUE from tick one: an objective the player fails without seeing, or wins against a target that
  does not exist. `campaign-maps.spec.ts` cannot see it, because it builds UNROSTERED. **And arming
  `setCampaignRoster` there would not have been enough**: that file passes no `defs` either,
  `spawnBuilding` hands `isBuildable` the RESOLVED def, and `rosterAllows` answers TRUE for an
  `undefined` one — so the roster would have been inert and the test vacuous. Bind the tables AND
  install the roster, or you are measuring a different game in a way that looks like a pass.
  `tests/campaign-roster-ground.spec.ts` does both, builds every operation TWICE so a missing tag
  can be attributed to the roster rather than to placement, and pins the guard case that catches its
  own vacuity. 36 of 37 rosters measurably withhold content; the thirty-seventh (`reclamation.01.held-paper`,
  which opens `'force'` and seeds no base) is declared by name with its reason, so a new permissive
  operation fails rather than quietly joining it.
- **NEITHER SHIPPED OUTCOME RULE MAY END AN OPERATION BY DEFAULT.** `Shell.pollOutcome` and
  `outcome.system.ts` both read `campaign/policy.ts`. Four reachable failures against a scripted
  match, all in shipped code: an eight-minute hold won at minute three; a seat whose forces arrive
  at t+3 min handing an instant victory at t+10 s; a commando insertion defeated at t+10 s for
  having no base; a defecting militia counted hostile forever. `validateCampaign` refuses an
  operation with no authored win path AND no authored lose path AND no opt-in — that is a match
  which cannot end, and it must be a build error.
- **THE PROFILE IS DEAF FOR THE DURATION, AND THAT COST TWO FIXES TO ACTUALLY ACHIEVE.** See the
  `beginMatch` section above: gating the lifecycle was not enough, and then the fix's own clearing
  condition in `startMatch` undid it one line later. Ten hours of campaign advances no skirmish
  unlock and no profile counter — verified by playing an operation to a win on a cleared profile and
  finding `unlocked: []` with localStorage never written.
- **THE REPLAY CLAIM IS MEASURED, NOT REASONED — `npm run replay-probe` HAS SIX PHASES NOW.** D
  records a real operation, E replays it, F deletes one command and requires divergence. Run
  2026-08-19 on `soviets.01.first-tap`: 299 commands over 5:04 of sim, header naming the operation,
  and **every sampled tick identical between the recording and the playback — 200, 1800, 5400, 8940
  and 9120**, the last two straddling the minute-five relief wave (alive +7 across it). F removed
  the command at tick 9002 and the bar read `Diverged` at 9030.

  **PHASE F IS THE ONE THAT MATTERS AND IT IS NOT OPTIONAL.** A matching hash alone is also produced
  by a playback that fed the world nothing — the Director is deterministic from the same seed, so
  it would re-derive an identical world with the command stream ignored entirely. Only the negative
  control separates "the recording drives the match" from "the re-derivation happens to agree".
- **`npm run shots` CANNOT SEE ANY OF THIS.** There is a `SCENARIO_PITCH_DEG.campaign` row so an
  unknown-name warning does not fire on every campaign boot, and it binds under `?shot=campaign`
  alone. No operation is photographed. Do not read an unchanged look-bible grade as evidence about
  the campaign.

## Tips are a table of PAIRS, they ride in the entry chunk on purpose, and the mute is permanent

`src/sim/tips.system.ts` is the director (`Phase.Economy` order 950, `orecrisis.system.ts`'s shape);
`src/sim/tip-rows.ts` is seven authored rows. Read both headers before adding a row.

- **A ROW IS TWO PREDICATES AND THE SECOND IS THE EXPENSIVE HALF.** `situation` says the player is in
  this state; `answered` says they have not already dealt with it. The brownout tip fires on a player
  who is *already holding a finished Power Plant*, because `BuildQueue.advanceTab` divides `buildTime`
  by a `buildSpeedMul` the deficit itself drove down — the shortage that caused the brownout is what
  slows the cure. **Where the cure has no latency the pair COLLAPSES** and the row is wrong content:
  "a stopped harvester stays stopped" stops being true on the click, so there is nothing to detect.
  Four candidates were cut on that test and are named in `tip-rows.ts`'s header. `answered` also
  treats a MISSING SERVICE as a refusal, never a pass.
- **THE ROWS LOAD EAGERLY AND `tests/tips-corpus-weight.spec.ts` IS THE PRICE.** `postTip` runs inside
  `simTick`, where a dynamic `import()` cannot be awaited, so a lazily chunked corpus arrives after
  the tip was decided and "the corpus had not arrived" is a SILENT NO-TIP. The caps are 1024 bytes of
  authored copy (ships 477) and 10 240 of comment-stripped module (ships 6 777); both bite at about
  fifteen rows, and the failure message names the lazy route. **Trip a cap and MOVE the corpus; do not
  raise the number.** `src/shell/tutorial-steps.ts` is the declared leak not to repeat — 17 162 bytes
  of stripped code carrying 5 511 of prose, in `index-*.js` today. (Its often-quoted "33 kB of prose"
  is the RAW FILE SIZE; comments do not survive the bundler.)
- **THE CHIP HOLDS 26 CHARACTERS OF TITLE AND 44 OF DETAIL, measured in Chromium, not derived.** The
  title inherits `text-transform: uppercase`, weight 600 and 0.18em of tracking; the detail is as
  authored. Reasoning from the box width gives ONE budget for both and ships a clipped title past a
  green test. All seven rows fit, which is why the chip was not widened; the costed next option is an
  `is-tip` variant letting the detail WRAP, never a card — a card is a fourth claimant on a HUD
  frame-share budget already at 15.83% against §38's 12-16%, and **no `?shot=` fixture can photograph
  a tip at all**, because `simTick` does not run under `advanceFrames`.
- **A TIP YIELDS TO AN ALERT, AND THE STACK PUBLISHES FACTS WHILE `postTip` HOLDS THE POLICY.**
  `ToastStack.alerts()` and `.crowded()` through `Hud.toastAlerts` / `.toastCrowded`. Crowding is a
  refusal because `push` RETIRES THE OLDEST CHIP at `TOAST_MAX` — a tip arriving at capacity deletes
  somebody's "Base under attack" rather than queuing behind it. Both reads are optional on the seam
  and their ABSENCE means "this sink is not a stack", which is the opposite polarity to the settings
  read and deliberately so.
- **EVERY GATE LIVES INSIDE `postTip`. There are six** — consent, scripted content, mute, spacing,
  host, arbiter — and none at a call site, for the `beginMatch` reason. It is still the only seam any
  later surface comes through.
- **`PROFILE_VERSION` IS 4: `Profile.tipsSeen` is a permanent per-row mute.** AUTOMATIC on first
  SHOWING, because `.vm-toasts` is `pointer-events: none` — a chip cannot be clicked, so "dismiss" is
  not an act the player can perform and a mute waiting for one would never fire. Marked AFTER the
  chip is raised, so a row any gate refused has not been spent. The only route back is `resetProfile`.
- **Tips stay ON in PvP** (`TIPS_BUILD_SPEC.md` §4) and the module writes NOTHING to the world, which
  is what makes that safe. Suppression is three predicates — campaign, replay, tutorial — not four.

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

## Ore per army falls with seat count, and that is the contested patch working

Asked as: is the 1.5 -> 1.25 fields-per-army drop from two armies to four intended tightening or an
accident of the formula? **It is correct by construction, nothing changed, and the ratio overstates
it.** Measured 2026-08-19 through the real generator, real `OreField.seedField` and the real terrain
predicate, `mapSeed 0x5e1ec7` / `simSeed 90210`, in CREDITS rather than field counts:

```
                2 armies      3 armies      4 armies     4-army vs 2
  temperate     37 142        35 277        33 153         0.893
  urban         30 625        28 341        27 319         0.892
  arid          43 472        39 694        38 824         0.893
  snow          39 384        36 667        34 616         0.879
  atoll         42 246        42 652        42 416         1.004
```

- **The real erosion is ~11%, not the ~17% the field ratio implies**, and it is tightly clustered
  across all four continental presets. `Scenarios.ts` gives each seat a home field of radius 30 and
  lays ONE contested patch of radius 22 on the centroid, so the shared patch is worth ~55% of a
  home field, not 100%.
- **EACH ARMY'S OWN ORE IS CONSTANT.** Per-army is `H + C/N`: `H` is one home field (28-35 k) and
  never moves, and only the shared patch's per-capita share falls 1/2 -> 1/4. A contested patch
  whose per-head value drops as more heads contest it is the patch doing its job. **Do not "fix"
  this by scaling the home field with seat count** — that would make the contest free.
- **THE ARCHIPELAGO HAS NO EROSION AT ALL AND THAT IS ALSO RIGHT.** `addIslandOre` gives every
  island a home field *and* an expansion, two per army at every seat count. It reads as an
  inconsistency and is not one: on Sunder Atoll no two armies share a land route, so there is no
  reachable contested patch to dilute, and the private expansion is the equivalent provision. The
  two layouts agree in intent even though they disagree in shape. Neither is argued in the source,
  which is why it is argued here.

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

**A THREE- OR FOUR-ARMY SAVE RESTORED ONTO TWO-ARMY GROUND, AND NO GUARD COULD CATCH IT.** FIXED —
`SaveContext.armies` now carries the seat count and `Shell.loadGame` rebuilds `opponents` from it.
The defect is recorded because the ARGUMENT that produced it was half right, which is the part
worth not repeating.

`Shell.bootGame` calls `setPlannedArmies(armyCount(this.setup))`, so the generator reserves one
levelled shelf per army in the setup that booted — and `loadGame` deliberately booted with
`opponents: [{ faction: c.aiFaction, … }]`, ONE entry, on the argument that `restoreSnapshot`
re-seats the whole player table anyway. **That argument is sound for the PLAYER TABLE and unsound
for the GROUND**: terrain, roads and scatter are regenerated rather than stored (`SaveGame.ts`,
above `RestoreOptions`), so a four-way save came back with its bases on a heightfield levelled for
two. `requireMatchingWorld` compares scenario, map and seed, and all three match. Before the
army-count wire landed this was masked, because every boot planned two and the capture and the
restore agreed by accident.

- **`extraOf` DID NOT fall back field by field, and this file said it did.** That was true of
  `kind` and `thumbnail` and false of `context`, which was one `??` over the whole object — and a
  row on disk HAS a context object, so the `??` never fires for it. A newly-required field would
  therefore have read `undefined` at runtime on every existing save while typechecking as present,
  and `armies - 1` on `undefined` plans `NaN` seats. `contextOf` is per-field now, which is what
  the doc comment on `SaveSlotInfo.extra` always promised, and every future field inherits it.
- **A legacy row reads 2, and that is not a guess at the truth.** `SaveMeta` carries no seat count
  and the blob is not open when the boot is planned, so there is nothing better to infer. 2 is the
  behaviour that row already had, chosen so nothing regresses.
- **The `loadGame` comment claiming growing `SaveContext` "would invalidate every slot already on
  disk" was stronger than the code required, and it is the reason this went unfixed.** Corrected in
  place. No `SAVE_SCHEMA_VERSION` bump; `structuralHash()` is untouched.
- **The replay path was always the model** — `Shell.startReplay` rebuilds `opponents` from every
  non-Neutral slot in the header before it boots, precisely so `armyCount` answers the recording's
  number. `tests/save-army-count.spec.ts` pins that it still does, because `loadGame`'s fix is a
  copy of it and two paths that must agree should fail together.

**THE TWO SEA MAPS ARE `players: 2` BY ARITHMETIC, NOT BY JUDGEMENT, AND THE NUMBER IS NOT
REVISABLE BY PLAYTEST.** `MAP_SEAS.coast` and `.tropical` are half-planes whose waterline is
offset along `START_BISECTOR` — the perpendicular bisector of slots 0 and 1 — because that is the
one bearing on which both openings project to the same distance from the water. Slots 2 and 3 are
the other two corners of the same rectangle and they lie ACROSS that bisector. At the shipped
`START_SPREAD_X/Z` of 148/124 they project to ±190.1 m, against a waterline at −112 m on coast and
+100 m on tropical: **slot 3 on Contested Strait is 78 m out to sea and slot 2 on Coral Shore is
90 m out to sea**, before `resolveStarts` slides anything.

Measured on the pre-doubling table (74/62, projections ±95.05 m) the same seats were 16.95 m and
4.95 m of dry land from the waterline, and a genuinely built four-army `contested-strait` put slot
3 on 29.9% buildable ground with 31.8% of its build disc under water, one of five ore fields in
the sea, and an 81 m shelf push the army never saw — `startSpots` deliberately does not read the
reserved shelf list back, and `Scenarios.ts` records the v1.21.0 regression that came from reading
it back. Doubling the spread made this two times worse, not better. A four-corner layout is
incompatible with a bisector-aligned half-plane sea; giving either map four seats needs a
different sea, not a different number. (`frozen-sector`'s 2 is the opposite case — measured at
83-89% buildable and zero shelf push at all four starts, so its number IS an authored judgement
about how it plays and is revisable.)

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
uses:   Move  Attack  AttackMove  Capture  Deploy  Harvest  Enter  Unload  UseAbility
        issueOrder  issuePlaceBuilding  issueProductionStart
        issueRepairToggle  issueSetStance  issueUsePower

NEVER:  ForceAttack  Stop  Guard  Repair  Scatter  Patrol
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
same empty gate silently removes repair depots, refractor tanks and the commander from the AI's reach,
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

**AN AIRCRAFT GETS ITS OWN SLOT AND ITS OWN THRESHOLD, AND BOTH NUMBERS ARE MEASURED.** An aircraft
parked over a defended ground target is under thirty percent for **2.07 seconds** (eight G.I.s;
2.47 against conscripts) before it dies — against a poll every 0.2 s that moves ONE hull, picks it
by worst health, and rolls against discipline. On a 1000-credit 190 hp hull that is a coin flip,
and an aircraft at 45% loses the shared slot to any tank at 25%. So `AI_RETREAT.airHpFraction` is
**0.5**, `worstAir` is tracked separately, and the air pass skips the rout cap.

- **THE CAP IS EXEMPT IN THE NUMERATOR AND NOT IN THE DENOMINATOR, AND THE SYMMETRIC VERSION WAS
  TRIED AND REVERTED.** `withdrawing` skips air (a parked airframe otherwise spends a ground slot
  for as long as it sits there — exactly one ground withdrawal lost at every army size from 14 to
  40 tanks). `striking` does NOT skip it: taking airframes out of the denominator lets an aircraft
  that is merely PRESENT, at full health, move the ground line's cap, which breaks the identity
  property below.
- **A MATCH WITH NO AIRCRAFT DRAWS THE SEQUENCE IT ALWAYS DREW**, verified 12 ways against the
  reverted build — 4 rungs x 3 health fractions, byte-identical command streams.
  `tests/ai-air-withdraw.spec.ts` gates the PROPERTY rather than a golden stream, because once the
  old build is gone the only way to fix a red literal is to copy whatever the new one produced.
- **It fires, and it is rare.** 30 sim minutes, four armies, unlocks GRANTED — an empty
  `UnlockGate` builds no aircraft and would measure zero, which is the `sw=0/0` mistake: Normal 3,
  Brutal 3, Easy 0 of five aircraft owned, against 1-6 airframes per brain, i.e. 1.0-1.4% of all
  withdrawals. **`npm run typecheck`-gated probe is opt-in behind `VM_AIR_PROBE`.**
- **Both withdrawn Brutal aircraft died anyway**, at minutes three and five. Whether 0.5 is early
  enough for a 190 hp hull to cross the ground home is UNMEASURED, and a match A/B cannot answer it
  — the two matches diverge completely from the first differing withdrawal. It needs a staged
  engagement.

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
The two that remain real gaps:

- **Per-unit retreat.** `flee=0` at every sample of every rung — only the harvester layer ever sets
  `UnitState.Fleeing`. Group retreat (`shouldRetreat`) is real and should stay.
- **`issueSell`.** `OreCrisis`'s `SellOut` branch is a documented route out of a dead economy that
  the AI structurally cannot take.

**ENGINEER CAPTURE IS NOW A REAL AI OPERATION, NOT A FREE VERB.** Each faction's engineer has the
dedicated `BuildRole.Engineer`. A disciplined AI buys at most one when it has current vision of a
legal capturable building, four available escorts and no serious base pressure. It issues the same
`Capture` command a player uses, sends the escort with `AttackMove`, keeps that group out of ordinary
regrouping, and abandons the operation when vision, legality, pressure or either endpoint changes.
Hidden and service-vetoed targets are deliberately ignored.

### Aircraft, and the four rifles holding the whole air layer up

Extracted from `docs/AERIAL_PLAN.md`, which was a PLAN and has been DELETED. These are the
measurements inside it that outlive it.

**THE REWORK LANDED 2026-08-19 AND THE BLOCKS BELOW DESCRIBE SHIPPED BEHAVIOUR.** This note used to
read *"the rework itself is not done — do not read any of this as describing shipped behaviour"*,
and everything under it was a diagnosis. `WeaponDef.airMultiplier` is 0.25 on the four line-infantry
rifles and 1 on all 38 other rows. Aircraft produced by a factory now start Defensive, so a short
move-away order is not immediately undone by an Aggressive auto-chase. An explicit attack still
closes and parks as ordered.

### A rifleman out-shoots a flak battery, and that is one inversion

Reported as *"Redecide who can shoot drones and planes, they are being destroyed in nano seconds"*.
**True in the massed case, false in the single-shooter case, and the gap between them is the whole
finding.** Measured 2026-08-18 by bundling the shipped `Defs.ts`, `Combat.ts` and `config.ts` with
esbuild and reading the tables. The convention is the one `Defs.ts` already uses — `cycle =
burstCount > 1 ? (burstCount-1)*burstDelay + cooldown : cooldown`, `raw = burstCount*damage/cycle`,
`vsAir = raw * ARMOR_MATRIX[warhead][ArmorClass.Light] * COMBAT_DAMAGE.globalMul` — so the table
regenerates in twenty lines and must be re-derived rather than re-quoted after any weapon retune.
Every `seconds` below is through `globalMul` 0.80; **no `dps/1000cr` ratio is, because a global
scalar cancels out of a ratio.**

```
                                                     seconds to kill an aircraft
  one AA turret (800 cr, purpose-built)                     1.81 - 2.41
  one Flak Trooper (300 cr, the Soviet AA infantryman)      6.95 - 9.27
  EIGHT CONSCRIPTS (800 cr, the cheapest unit in the game)  0.98 - 1.36
  TWELVE CONSCRIPTS (1200 cr)                               0.65 - 0.91
```

**NOTHING SINGLE IS A NANOSECOND.** The worst case in the whole 21-row sweep is 1.81 s, and that is
an 800-credit purpose-built AA turret against a 900-credit aircraft, which is what an AA turret is
for. What is a nanosecond is the infantry screen a player already owns without ever deciding to.
Per credit, against `ArmorClass.Light`, inside each army's own roster:

```
army       LINE infantryman         its best DEDICATED answer      inversion   AFTER
Allies     gi            115.3      aaTurret        124.4            0.927x    0.232x
Meridian   mrdWayfarer   117.9      mrdSkiff         99.5            1.184x    0.296x
Soviets    conscript     220.0      flakTrooper      86.3            2.550x    0.637x
Reclaim    rclPicker     209.1      rclSkimmer       60.0            3.485x    0.871x
```

**RE-DERIVED 2026-08-19, AFTER THE TWELVE UNIT RENAMES AND EVERY WEAPON RETUNE SINCE: the left half
of that table is UNCHANGED to three decimals.** Two corrections to the figures themselves, both of
which the previous version of this block got wrong. The `dps/1000cr` columns DO run through
`globalMul` — the sentence above says "no `dps/1000cr` ratio is", which is true of the INVERSION
ratio (a global scalar cancels) and false of the absolute per-credit numbers beside it, which are
delivered dps. And the raw-dps band is **47-52**, not the 46-52 quoted below.

**THE MECHANISM IS THE RAW DPS, NOT THE MULTIPLIER, WHICH IS WHY THE AA ROWS ARE INNOCENT.** A rifle
is balanced to kill infantry (SmallArms 1.00 vs Infantry) and therefore carries 46-52 raw dps; 55%
of that is still 20-23. `flakBurst` is balanced as an infantryman and carries 32.4 raw at 100%. The
purpose-built weapon's 1.6x multiplier and its 1.6x raw deficit **cancel exactly**. So the problem is
not that 21 live rows carry `canTargetAir`; it is four of them — `rifle` (0), `conscriptRifle` (1),
`pulseCarbine` (18), `arcProd` (28) — riding the unit each army has the most of. Cutting the
dedicated rows would deepen the inversion, not fix it.

The trade is one-sided in both directions: an aircraft flown at eight line infantry returns **22 to
104 credits** of damage on a 900-1200 credit hull before dying. An Interceptor at eight Conscripts loses 935
credits and kills two thirds of one man. Aircraft are also the thinnest hulls in the game at 180-240
hp on 900-1200 credits, and that is deliberate and pinned (`air-layer.spec.ts` caps `maxHp < 300`) —
contributory, not causal.

### The fix is one number on four rows, and the number came out of a window

**`WeaponDef.airMultiplier` is 0.25 on `rifle`, `conscriptRifle`, `pulseCarbine` and `arcProd`, and
1 on every other row in the 42-row armoury.** It multiplies the armour matrix inside
`Damage.applyOne` — the only function in the game that writes `hp` — and ONLY when the victim's
`locomotor` is `Air`, so ground combat and every unmodified weapon are bit-identical. The derivation
lives above `rifle` in `src/sim/Combat.ts`; the band is `tests/air-multiplier.spec.ts`.

**IT TRAVELS ON THE DAMAGE RECORD RATHER THAN BEING FOLDED INTO `amount` AT FIRE TIME**, and that is
per-VICTIM correctness rather than tidiness. `arcProd` is a chaining tesla bolt: one trigger pull
writes up to four records, and a gunship and the two riflemen the arc hops to next need two
different answers. Splash has the same shape. `DamageQueue.airMul` and `ProjectileSystem.airMul` are
the two columns that carry it — a round in flight knows only `damage`, `warhead` and its splash
numbers, so without the second one a rifle round fired at a gunship and clipping a passing tank
would hand the tank the gunship's answer.

**THE NUMBER IS A WINDOW WITH A CHOICE INSIDE IT.** Three bounds, every one computed from the
shipped defs, all stated over EIGHT MEN — one Barracks tab-full, the screen a player already owns
without ever deciding to, and the same squad `emplacement-band.spec.ts` derives its ceiling from:

```
                      ceiling A       ceiling B         floor
                       one pass    counter parity    8 men / 10 s
  Allies                 0.416          1.078            0.130   <- the floor binds here
  Meridian               0.382          0.844            0.127
  Soviets                0.428          0.392            0.108
  Reclaim                0.469          0.287            0.120
                                        ^ the ceiling binds here
```

Ceiling A is `8 q T < hp`, where `T = 2R/v` is one attack pass across the SHOOTER's disc — measured
per hull at 3.13 / 3.33 / 2.52 / 2.55 s. An aircraft that cannot survive one pass over a screen it
did not choose to fight is not a unit class. Ceiling B is 1/the inversion column. The floor is the
anti-hang floor made quantitative: a floor that takes a minute is not a floor. **Window
[0.130, 0.287], shipped 0.25** — 13% under the tightest ceiling, 92% over the tightest floor,
sitting high in it on purpose, because the floor is the property that must never be lost and the
ceilings are the ones the report is about.

**TRAP 1 IS REAL AND THIS IS THE ANSWER TO IT.** A per-credit anchor always flatters the cheapest
unit, and ceiling B's binding value IS set by the 90-credit Scrap Picker — whose ABSOLUTE air output
is the LOWEST of the four (18.8 delivered dps against a G.I.'s 23.1). It does not set the constant:
the window is bracketed at the top by the Reclamation and at the bottom by the ALLIES, and 0.25
satisfies all four armies' own bounds at once. Four per-row values were considered and rejected
because the four windows overlap — four numbers would encode a precision the arithmetic does not
support. The FIELD is per-weapon so they can diverge later; the VALUE is one because the evidence
says one.

**MEASURED IN THE ENGINE, NOT ONLY ON PAPER.** `aircraft-killer-probe.spec.ts` §3, eight men against
three Interceptors at 14 m, sim-seconds to clear all three; and §6, a 5800-credit Allied position
against three Interceptors:

```
                  before    after          §6 damage dealt to the flight
  gi x8            3.10     12.60            aaTurret  338.7 -> 430.1
  conscript x8     3.93     15.63            ifv        88.0 -> 104.0
  mrdWayfarer x8   3.77     14.63            gi        140.9 ->  34.8   (0.247x)
  rclPicker x8     7.77     28.23            still 3/3 down
```

The right-hand column is the whole point in one line: **the answer you bought on purpose now does
the work.**

Both columns are A/B CONTROLS taken on this tree with the constant forced to 1 and then to 0.25, not
figures carried forward — which matters, because §6's own header quotes a 6100-credit position and
the renames have made it 5800. The control reproduced the previously published 338.7 / 140.9 / 88.0
to the digit, so the two halves really are comparable.

**THE FIRST RUN OF THAT PROBE REPORTED THE TABLE UNCHANGED, AND WAS GREEN.** `makeRig` shadows the
private `applyOne` with a POSITIONAL re-declaration to attribute each hit to a path, and the
wrapper simply did not forward the new seventh argument — so the real method read its default and
thirteen tests measured the behaviour the change had just removed. A harness that re-declares a
signature silently discards anything added to it; the wrapper carries a note saying so now.

**TRAP 2, AND IT IS DELIBERATELY NOT ACTED ON HERE.** The AA Battery becomes the dominant answer
after this and must be re-measured in a SEPARATE commit. Re-measured 2026-08-19: **nothing about
`aaCannon` moved** — 3x34 / 0.82 s, 99.5 delivered dps vs air, 1.81-2.41 s per airframe, and
187 / 202 / 205 / 261% of an aircraft's health on one 26 m pass, reproducing the figures this file
already carried. What moved is everything around it. Against 800 credits of that army's line
infantry it went from **1.7-1.8x SLOWER in the two cheap-infantry armies and a bare 1.06-1.08x
faster in the other two**, to **2.3-4.3x faster in all four**:

```
             800 cr of line infantry      one AA Battery
             before      after
  Allies      2.60 s     10.40 s              2.41 s
  Meridian    2.23 s      8.91 s              2.11 s
  Soviets     1.08 s      4.32 s              1.91 s
  Reclaim     1.08 s      4.30 s              1.81 s
```

Whether that is now TOO dominant is the open question this change hands forward, and it is a
question about the Battery's price and tier rather than about its row.
`tests/air-multiplier.spec.ts` deliberately asserts no ceiling on it.

**DO NOT REVERT THIS BY DELETING `canTargetAir`.** The floor rule below is the same argument from
the other side, and §1 of `air-multiplier.spec.ts` goes red by name if anyone tries.

### The anti-hang floor is four rifles, and it is the reason never to delete `canTargetAir`

`WeaponDef.canTargetAir` defaults FALSE by design, so **an enemy reduced to nothing but aircraft is
unkillable by a ground-only army and the match hangs forever.** `outcome.system.ts`'s header names
that and deliberately refuses to fix it there, and the refusal is right: making `Viability.isBeaten`
ask whether an opponent can be HURT puts a content question inside a deliberately structural survey,
and gives the sell guard and the outcome poll two different copies of one rule — the exact failure
`Viability`'s own header exists to prevent. It is a content question, and this is the content answer.

Swept 2026-08-18 over the shipped `UNITS`, `BUILDINGS`, `UNLOCK_TAGS` and the transitive prereq
closure of every air-capable entry, from a bare Construction Yard:

> **EVERY STATIC AA EMPLACEMENT IN THE GAME IS PROGRESSION-GATED** — `aaTurret` behind
> `struct.defence.aa`, and `teslaCoil` / `mrdHelios` / `rclPylon` behind
> `struct.defence.specialist`. A fresh profile has **zero** static anti-air in all four armies. The
> complete ungated non-naval AA roster is three infantry each for the Allies, Soviets and Pact, and
> **two for the Reclamation — `rclPicker` and `rclDredger`, which both fire `arcProd`, its line
> rifle.** That army has no other ungated answer to an aircraft of any kind.

**The only thing keeping that from hanging matches today is an ORDERING ACCIDENT.**
`struct.defence.aa` is paid by `combat.armour.1` ("destroy 60 enemy vehicles", difficulty 1, no
`requires`) while `unit.air` is paid by `construction.armour.2` ("build 400 vehicles", difficulty 3,
requires `construction.armour.1`), so static AA arrives long before anyone can fly. That is a
property of the mission curve, not of the design, and **`aiMirrorsUnlocks: false` removes it** — the
AI is then ungated against whatever the human happens to have earned.

> **THE FLOOR: from every reachable tech state, every army must be able to produce something whose
> weapon carries `canTargetAir`, with no progression gate and no map dependency.** Today the floor is
> held up entirely by the four line-infantry rifles. Deleting `canTargetAir` from them is the
> cleanest-looking answer to "too many things shoot planes" and it removes the floor in all four
> armies at once. **Nerf them with a MULTIPLIER instead** — a weapon that still kills an aircraft
> slowly keeps the floor by construction.

**THAT IS WHAT SHIPPED, AND THE FLOOR IS MEASURED NOW RATHER THAN ARGUED.** At 0.25, eight men take
4.13 / 5.53 / 4.77 / 13.10 sim-seconds to bring an Interceptor down in the real engine
(`aircraft-killer-probe.spec.ts` §5, whose assertion is unchanged: the aircraft must DIE), one
rifleman alone still manages it in 34-42 s, and twenty Scrap Pickers in 1.9 — the "about two
seconds" this paragraph used to project at 0.30. `air-multiplier.spec.ts` fails in BOTH directions:
above 0.287 the inversion returns, below 0.130 the floor stops being reachable, and at 0 the
`canTargetAir` assertion goes red by name.

The residual state this does NOT close: no Construction Yard, no barracks-equivalent, and no
surviving air-capable unit. With a yard you rebuild the barracks; with a war factory you build the
ungated `mcv` and get the yard back. Lose both and the route is gone and you are still not `beaten`,
because aircraft are `EntityKind.Vehicle` and `Viability.UNIT_KINDS` counts them. That is the
`OreCrisis` dead end in another costume, it is reachable in principle and there is **no evidence it
occurs in play** — so if it ever matters, the honest fix is `OreCrisis`'s shape (a narrow multi-clause
predicate with a standing structure redeeming a promise), enumerated exhaustively over the real
catalog FIRST, and not a change to `isBeaten`.

**ALTITUDE BUYS AN AIRCRAFT NO RANGE COVER.** `Combat.engage` computes
`flat = Math.sqrt(dx*dx + dz*dz)` and `surfaceDist = max(0, flat - hitRadius(target))`; **`dy` is not
in the range test.** So 22 m of vertical separation costs a ground shooter exactly zero range, and a
rifleman directly beneath an aircraft is at `flat = 0`. Direct fire that crosses the air layer now
follows its actual vertical bearing, so that in-range shot can connect.

An explicit attack closes to `range * APPROACH_STOP_FRAC` (0.80) and **parks** there
(`APPROACH_PARKED`). A plain move order breaks that engagement, and new aircraft start Defensive so
a short retreat is not reclaimed by Aggressive auto-chase.

**Do not "fix" it by forcing an attack run.** Measured at today's damage, one 19 m pass (`2R / v`,
2.8-3.5 s) is worth 6-14% of a Power Plant and 17-41% of a main battle tank — a Petrel Bomber's entire
attack run takes **14% off a Power Plant**. An aircraft that cannot stop is not a unit class. The
loiter is a problem because it is the ONLY behaviour, not because loitering is wrong: the fix is a
way OUT that the player and the AI can both issue, never a rule forbidding staying.

**THE AIR MULTIPLIER AND BEHAVIOUR FIXES SOLVE DIFFERENT FAILURES.** The multiplier gives an aircraft
roughly four times as long against massed line rifles. Defensive spawn stance makes the natural
short-retreat gesture hold. Cross-layer direct fire uses the actual pitch and closes the old overhead
blind cone without changing authored ground-mount limits or ballistic shell arcs.

**FIVE ANSWERS TO "AIRCRAFT DIE TOO FAST" THAT WERE COSTED AND REJECTED**, recorded so nobody
re-derives them. Overturn one by rewriting it with an argument, not by trying it.

- **A seventh `ArmorClass` for aircraft.** `ARMOR_CLASS_COUNT` is 6, the matrix is 7x6,
  `setArmorMatrix` hard-refuses any other shape, and `ARMOR_CLASS_COUNT` is **in
  `structuralHash`** — so it refuses every save on disk, exactly as a new `BuildTab` does. It also
  costs seven authored cells that every future warhead must fill. `Defs.ts` and `air-layer.spec.ts`
  both already state the rule: the air/ground distinction is a TARGETING gate, never a seventh
  armour row.
- **A distinct `EntityKind.Aircraft`.** `ENTITY_KIND_COUNT` is in `structuralHash` too, `UnitDef.kind`
  is typed `Infantry | Vehicle`, and the change would silently move `Viability.UNIT_KINDS`, the
  Repair Depot's `byKind` walk and every `st.byKind[EntityKind.Vehicle]` loop in the tree.
- **Moving `ARMOR_MATRIX[SmallArms][Light]` off 0.55.** That single cell also governs riflemen
  against the IFV, Sandskiff, Spitter, Refractor Tank, Zenith, Solarch, Slaghurler, Hydrofoil, Skimmer,
  transports and every landing ship. `armorMultiplier(SmallArms, Infantry)` is pinned to exactly 1
  as the counter-triangle's reference cell; **the Light cell is pinned by nothing, which is precisely
  why it must not move** — a dozen ground relationships would shift silently. Use a gate that only
  sees the air case.
- **Raising aircraft HP.** They sit at 180-240 hp on 900-1200 credits, bottom of the whole vehicle
  roster, and `air-layer.spec.ts` caps `maxHp < 300` on purpose. Making eight G.I.s need 3.7 s to
  kill a Petrel Bomber by HP alone needs **685 hp** — 2.9x, three times a Warden's hp-per-credit — and
  it takes the AA turret from 2.41 s to 6.9 s. It fixes the symptom by deleting the counter.
- **A dedicated `BuildTab.Aircraft`.** All four armies field exactly one aircraft (pinned), so the
  tab holds ONE cameo per army while Vehicles drops 12 → 11 against a 14-slot cap — a container for
  a decision between several things, with nothing to decide between. `BUILD_TAB_COUNT` is in
  `structuralHash`, so every save on disk is refused; and `src/net/protocol.ts`'s `TABS` is an
  ALLOWLIST, so omitting one line there makes `validateCommand` reject every aircraft order, which
  the server FILTERS and the client **TRIPWIRES** — "I queued a plane" becomes "the match ended for
  both of us". A prerequisite structure buys the same permission (*only this building can produce
  planes* is a statement about permission, and permission is what `prereqs` is) for none of it.
  **Revisit only when some army's air roster reaches three or more airframes AND its Vehicles tab is
  within one slot of `BUILD_COLUMNS * BUILD_ROWS`** — Vehicles is at 12/14 for the Allies and the
  Pact today.

**THE HARD-CODED FIVES ARE SIXTEEN DECLARATIONS, AND A GREP CANNOT FIND THEM.** Enumerated by hand
2026-08-18: `BUILD_TAB_ORDER` in `core/config.ts` (the only one a test guards — `command-post.spec.ts`
asserts it against `BUILD_TAB_COUNT`), the `TABS` allowlist in `net/protocol.ts`, then
`cameoPool` / `cameoEntries` / `cameos` / `tabAlert` / `tabVisible` in `sim/Production.ts`,
`localPool` / `gridRows` / `cameos` / `tabAlert` / `tabVisible` in `ui/Hud.ts`,
`TAB_LABELS` / `TAB_SHORT` / `tabVisible` in `ui/Sidebar.ts`, and `BUILD_TAB_HOTKEYS` in
`input/ActionCatalogue.ts`.

**The silent one is `Sidebar.ts`'s `tabVisible`.** A sixth tab reads `undefined` there, which is
falsy, so the tab is never drawn — no error, no log, and a full queue behind it. That is the
`BuildTab.Powers` failure verbatim, re-armed and waiting.

**The audit has to be manual and it is easy to get wrong.** Any regex tight enough to catch all
sixteen also catches `sim/AIStrategy.ts`'s `NO_ANSWER = [0, 0, 0, 0, 0]`, which is a five-element
**ThreatClass** array with nothing to do with tabs. And a careful first pass over this exact list
found *fourteen* and missed two `tabVisible` declarations sitting within eight lines of entries it
had already recorded.

### A tank stopped killing aircraft, and measuring it moved two other numbers

Reported as *"i still think we have unbalanced fights... 3 airplanes destroyed by 1 tank in a
second... something is weird"*. `tests/aircraft-killer-probe.spec.ts` holds every figure below;
re-run it rather than re-quoting it. (This block used to open "**This one is SHIPPED behaviour,
unlike the rest of this section**", which stopped being a distinction when the air multiplier and
the two behavior follow-ups landed.)

- **`Damage.applySplash` WAS PURELY HORIZONTAL.** `y` was a parameter of that function read by
  nothing but the crater decal, and the victim loop filters on Alive, PendingDestroy and Garrisoned
  and asks nothing else. So every splash weapon in the game hit aircraft at FULL effect at cruise
  altitude, including the three main battle tank cannons — 1.6 / 2.1 / 2.2 m of splash, none of
  them carrying `canTargetAir`. `Combat.ts` gates TARGETING on that flag and this path never went
  through targeting at all, which is exactly why the sweep above could not see it.
- **THE FIX IS DISTANCE, NOT A `canTargetAir` GATE, AND THEY DIFFER WHERE IT MATTERS.** A gate
  deletes incidental air damage outright, and the anti-hang floor is held up entirely by four
  line-infantry rifles. Real distance — the vertical gap beyond the hull's own extent,
  `|dy| - estimatedHeight * 0.5` — keeps that floor BY CONSTRUCTION: a weapon that can elevate puts
  its blast AT the aircraft. Measured, `aaCannon`'s impact `y` lands within **2.36 m** of a plane
  at 22 m, against an Interceptor half-extent of 2.0655 — so `gap` is **+0.296 m** and does NOT clamp to
  zero, costing 3.63 m of reach against 3.62. A near miss, not a clamp, and the distinction is
  worth the words because the clamp is the floor's only structural defence. `estimatedHeight` must
  be called with `footprintW = 0` for a unit, or it takes its BUILDING branch and answers 4.60
  instead of 4.131 — which is how one draft of this paragraph came to quote a gap of 0.06. And all
  four ungated line infantries still take an Interceptor down with eight men (gi 0.97 s,
  mrdWayfarer 1.60 s, conscript 1.67 s, rclPicker 3.50 s).
- **THE STAGED INCIDENT, BEFORE AND AFTER.** An Anvil shelling a Warden with three Interceptors parked over
  the victim: **7 blasts under the flight, 0.0 damage, 3/3 still flying**. The falsifier that makes
  that 0 a reading rather than a constant is the same rig with the flight at 5 m — **570 damage,
  one blast touching all three, 0/3 still flying**. And end to end, 5800 credits of Allied position
  against three Interceptors kills all three with **no tank contributing a single point**: aaTurret 2 kills
  / 338.7 damage / 100% via splash, gi 1 kill / 140.9 / 0% via splash, ifv 88.0.

**THE OLD OVERHEAD BLIND CONE IS CLOSED WITHOUT MOVING THE GROUND-MOUNT CONSTANTS.** The historical
failure came from clamping every direct-fire launch to `COMBAT_WEAPONS.maxElevationDeg` (62): at 7 m
a rifle round passed under an aircraft, while 8 m happened to connect with its hit disc. `Combat`
now exempts direct fire when exactly one endpoint is airborne and follows the actual bearing. Ground
versus ground still uses the authored elevation limits; ballistic shells still use their clamped
arc. The regression control now requires both the 7 m and 8 m shots to deal damage.

**EVERY `seconds` IN THE SWEEP ABOVE IS A SINGLE-TARGET FIGURE, AND A FLIGHT DIES FASTER THAN IT
SAYS.** That table is `raw * ARMOR_MATRIX[warhead][Light] * globalMul`, i.e. a PER-TARGET dps — but
every row carrying both `canTargetAir` and a `splashRadius` delivers it to every aircraft inside the
blast, and `movesShareSpace` lets aircraft share a point. Measured per aircraft rather than per
engagement, **a flight of three dies in the same wall-clock as a single aircraft** — measured
identical `secondsToAll` for all three shooters tried (flakTrooper x1 11.10 s, flakTrooper x8
0.93 s, aaTurret x1 3.20 s, each unchanged by adding two more planes). Massing aircraft against
splash AA buys them nothing at all.

**DO NOT QUOTE THE "3.00x PER AIRCRAFT" FORM OF THAT.** The probe divides the flight's clock by
three, so a ratio of exactly 3.00 is what the arithmetic must produce whenever the wall-clock is
unchanged — it would read 4.00 for a flight of four. The per-aircraft figure is a restatement of
the sentence above and not a second finding, and an earlier draft of this block cited it as one.
That is the vacuous-metric trap this file warns about twice elsewhere, walked into a third time.

**THE AA BATTERY RE-MEASUREMENT CAME BACK CONFIRMING THE FLAG.** The "187-261% of an aircraft's
health on ONE 26 m pass" figure this file demanded be re-derived reproduces to the digit, from the
shipped `aaCannon` row (3x34 / 0.82 s, range 26, splash 1.2, 99.5 dps vs air): vindicator 187%,
mig 202%, mrdKestrel 205%, rclHornet 261%. Seconds-to-kill 1.81-2.41. Nothing to change; the claim
was true and is now behind a test that fails if the row is retuned.

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
- **THE PAINT FRAME READS THE ROW'S OWN TWO HALF-WIDTHS, NOT THE NOMINAL ONE.** `resolveChainEdges`
  clamps each side of a cross-section INDEPENDENTLY through `maxSafeOffset` (0.85 of the local
  radius), so on a tight bend the emitted row spans `wl + wr` and the centreline sits at `wl` from
  the left edge rather than half way. `buildChainRibbon` wrote `aRoad.x` as `w - 2*w*t`, which puts
  u = 0 at the row's MIDPOINT — off the spline by `(wl - wr) / 2`. Over the seven shipped
  battlefields at seeds 0..9, 82 of 51 056 rows (0.161%) are clamped, and the worst threw the
  double-yellow **2.015 m** — most of a lane — off centre on coral-shore. `aRoad.z` deliberately
  stays the NOMINAL half-width: the shader derives `lanes` from it, and a per-row width would drop
  a four-lane arterial to two lanes for three rows through a bend, moving the divider and the wheel
  paths with it.
- **`ROAD_BEND_RADIUS_MIN` READS 15, CANNOT BIND, AND A FLOOR THERE IS UNIMPLEMENTABLE.**
  `filletPolyline` assigns `r` twice — `clamp((rMin + rMax) / 2, rMin, rMax)`, which is 27.5 for the
  shipped 15/40 and never touches either end, and `t / tanHalfTurn` in the tMax branch. So every
  radius is either exactly 27.5 or forced by `0.45 * min(l1, l2)`, and raising one back to `rMin`
  requires precisely the cusp that 0.45 exists to prevent. Measured `bendRadiusMin` 4.05 m on
  coral-shore against a 6.8 m arterial half-width. Widening such a bend is a ROUTING change, and the
  route already survived `routeLegal` — the legs are short because the ground refused longer.
- **A TIGHT BEND PINCHES THE RIBBON; IT DOES NOT TEAR IT OPEN.** Worst emitted row 9.57 m against a
  13.60 m nominal (70.4%). Some ribbon quads DO wind backwards: over all seven maps at seeds 0..9,
  **27 inverted triangles of 100 836** (0.027%), confined to temperate-valley and coral-shore but
  present at **10 of 10 seeds on both**, so it is a standing property rather than a seed accident.
  The worst is **-29.08 m2 with a +49.63 m2 partner** — the row order crosses over itself, so it is
  a BOWTIE, not the thin sliver a single-map reading suggests. Inside the 0.2% budget
  `makeRoadMaterial` records, and the reason that material is `DoubleSide`. **Pinned rather than
  zeroed**: the honest fix rate-limits how fast `wl`/`wr` may move between rows, in
  `resolveChainEdges`, on a hot path, for a 0.03% artefact `DoubleSide` already covers. Two earlier
  drafts got this wrong in opposite directions — one claimed ZERO, by measuring the offset CURVE
  and then making a claim about the STRIP; the next quoted two quads and doubled their areas, by
  reading a three-case pin as a roster figure and a cross product as an area.

## There are two renderers now, and a WebGL player downloads exactly one of them

`?gpu=webgpu` used to throw. It boots the real game (shipped in v3.0.0): every shader in the project
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
  WebGL-only — `getContext()` for the WebGL timer query, `capabilities.getMaxAnisotropy()`,
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
- **GPU TIME IS REAL ON BOTH BACKENDS.** WebGL uses
  `EXT_disjoint_timer_query_webgl2`; WebGPU requests Three's `timestamp-query` tracking at renderer
  construction, disables timestamp writes while the overlay is hidden, and resolves the latest
  completed frame asynchronously while visible. An adapter without the feature reports `n/a · no
  timestamp-query`; frame time is never substituted for GPU time.
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

**NO SIMULATION OR WORLD-GENERATION WORK MAY MOVE TO A COMPUTE SHADER.** Compute is WebGPU's
second headline win and it is the one this project cannot spend. GPU floating point is not
bit-identical across vendors or drivers; terrain generates independently on both machines of a
lockstep match and `s.rng` feeds every scenario decision, so a generation or sim pass moved onto
the GPU is a tick-zero desync waiting for an NVIDIA machine and an AMD machine to meet. It is the
axis-aligned-ellipse constraint one level down: ECMA-262 at least pins `+ - * /` and `Math.sqrt`,
and nothing pins WGSL at all. Compute is confined to render-only work — particles, VFX, culling —
where a per-machine difference is a pixel rather than a divergence.

**"STAGE A".."STAGE F" IN ~35 SOURCE COMMENTS REFER TO A PLAN THAT NO LONGER EXISTS, AND THIS
SECTION IS WHAT THEY POINT AT NOW.** `docs/WEBGPU_MIGRATION_PLAN.md` was deleted once the migration
shipped; its measurements are in `RENDER_FINDINGS.md` §7 and §11, and its rules are here. The stage
labels were left in place deliberately — they are accurate provenance for which pass ported which
shader, and rewriting 35 comments to erase that would lose real information to gain tidiness.

## There is a desktop build now, and the web build did not move an inch

`desktop/` is an Electron shell around the UNMODIFIED `dist/`. Read
[`desktop/README.md`](desktop/README.md)
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
- **`app://`, NEVER `file://`; persistence itself is native as of bridge v5.** `standard: true`
  remains for normal origin semantics and one-time migration from older desktop builds, but active
  desktop state is `userData/storage/state.json` and save snapshots are `.vms` files under
  `userData/storage/saves/`. `SaveStore` selects `filesystem` before it probes IndexedDB or
  localStorage; those are web fallbacks only. `secure: true` is still load-bearing:
  `navigator.gpu` is `[SecureContext]`-gated, so without it `?gpu=webgpu` is permanently unreachable
  and the faster renderer is dead on desktop.
- **A DENY-ALL `will-navigate` HANDLER BREAKS STARTING A MATCH.** `Shell.hardLaunch` calls
  `location.assign`, and the GPU-failure panel's two buttons call `location.replace`. All three are
  renderer-initiated, so they DO fire the event. And never compare `.origin` — Node's URL parser
  returns the string `'null'` for `app://voltmarch/x`, because it knows nothing about a
  privileged-scheme registration.
- **THE DESKTOP TARGET IS OUTSIDE CI, SO EVERY DECISION LIVES OUTSIDE `main.ts`.**
  `desktop/src/{flags,app-url,paths,display,storage}.ts` import no electron and are tested by
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

  **`bridge` is a VERSION and the check is EQUALITY** — v5 added native key/value and binary-save
  capabilities. A bump on
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
  the Electron plan §8.

-  **WHAT THE WRAPPER DOES NOT BUY, so nobody re-derives it.** Electron 43 is Chromium M150 — the
  same V8, the same ANGLE, the same Dawn — so there is no "native performance" here and **adapter
  selection is the only real speed lever**. `performance.now()` is clamped to 100 µs in BOTH
  targets. There is no exclusive fullscreen to get. Native userData storage now removes Chromium
  quota/eviction semantics from the desktop target and gives saves a folder the player can open;
  it is a reliability win, not a render-performance one. Shader-cache warming is real but small,
  because `Bootstrap.ts` already
  front-loads compilation with `.compile()` — **do not put a number on it in any doc until
  somebody times boot-to-curtain-drop with the cache deleted against warm.** And one risk runs the
  other way: **Electron's Chromium lags Chrome by two to three majors even when fully current**,
  so the desktop `?gpu=webgpu` path runs an OLDER Dawn than the player's own browser does. That is
  the first thing to check when a TSL defect arrives from a desktop build and not from the web
  one.

-  **`displayFrequency` AND `graphics.fpsCap` HAVE READERS NOW — AND THE OBVIOUS WIRING WAS
  BACKWARDS.** Both were persisted, plumbed and consumed by nobody, and the obvious reading was
  that a 144 Hz desktop player is calibrated against a 60 Hz target while the one capability that
  could fix it is already delivered. **That reading is measured false.** Feeding §9's own fitted
  line (`5.86 + 6.40 x Mpx`) through the real `solveScale` at a 1440p buffer:

  ```
    target      solved scale   outcome
    16.7  60Hz  0.625          fill-rate — a sharp, honest answer
    11.1  90Hz  0.435          FLOOR: 0.55 + AO OFF + shadows LOW
     8.3 120Hz  0.299          FLOOR: 0.55 + AO OFF + shadows LOW
     6.9 144Hz  0.198          FLOOR: 0.55 + AO OFF + shadows LOW
  ```

  **The cause is the INTERCEPT, not the slope.** That machine spends 5.86 ms before a single pixel
  is drawn — 84% of a 144 Hz budget, 70% of a 120 Hz one — so no resolution scale delivers those
  rates and the calibration would spend every quality setting it owns discovering that. And on a
  machine fast enough to reach 144 (`1.50 + 1.20 x Mpx`) the answer clamps to the ceiling and is
  IDENTICAL to 60's. **Inert where it would help, destructive where it would not.**

  So the target is OPT-IN: `fpsCap` drives it (`targetMsForCap`, 0 → 60), `Shell.maybeCalibrate`
  passes it, and `displayFrequency` only ANNOTATES the row — it names your panel and marks options
  above it. `tests/frame-rate-target.spec.ts` holds every number above.

  **THE LOAD-BEARING HALF IS THE EXEMPT LIST.** `graphics.fpsCap` was on `CALIBRATION_EXEMPT`
  under an argument that was TRUE when written — *"it has ZERO readers... it cannot affect
  anything, including the frame"* — and giving it a reader expired that argument silently. Left
  there, choosing 120 fps would retire nothing, the calibration solved for 60 would stand, and the
  row would appear to do nothing. `hardware-calibration.spec.ts` was PINNING that behaviour and
  the entry is moved rather than deleted. **An exemption argued from "nothing reads it" carries an
  expiry date no mechanism can notice passing.**

  **IT IS NOT A FRAME LIMITER AND THE ROW SAYS SO.** There is none in this project — the render
  loop is `src/core/`, frozen infrastructure, and a capped frame time is a FLAT frame time, which
  is exactly what `CALIBRATION.flatSlopeMs` reads as "not fill-rate bound". A limiter left on
  during a probe would poison the fit that measures it. Still open: `displayFrequency` answers for
  the PRIMARY monitor, so a window on a second screen is annotated with the first one's rate;
  fixing that means putting `hz` on each `DesktopDisplayInfo`, which is a bridge-version bump.

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
  v2.15.1  total 108–159   ao      0  colour 56–79      (re-measured, not carried forward)
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

**The prioritised action plan that came out of all this has been executed and deleted.** Six of
its eight scheduled items shipped in v2.12.0 and each wrote its measurement into the file it
changed — the splat classifier's Gaussian-threshold bug in `terrain-gen.ts#patchQuantile`, the
Allied pad and facade albedo in `config.ts`, the rust rule split in `greeble-gen.ts`, the
prop-type cap in `config.ts`, the lobe canopy in `PropLibrary.ts`. The two that did not are
`RENDER_FINDINGS.md` §6b (`shadowIntensity` is banned by the bible and still cannot be raised on
its own) and §6c (terrain `envMapIntensity` is inert). **What is still open is in
`RENDER_FINDINGS.md` §3 and §4**. The terrain response array and the architecture readers for
`ArtDirection.surfaces` have since landed; §12 records their exact packing and cost. The remaining
item from that short list is the team-colour validator counting one surface out of four. Read §2
before touching `edgeCoverage` and §4 before retrying anything on it.

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

**`?campaign=` IS `?tier=`'S LESSON APPLIED, TWICE.** It is parsed in `main.ts` and handed to
`Shell`, never to `bootstrap()` — a flag put on `options` and not handed to the shell is
harness-only forever, which is exactly what happened above. And it is deliberately NOT in
`MANAGED_FLAGS`: `buildMatchQuery` deletes every managed key on every boot, so a flag listed there
would erase itself on the first `history.replaceState` and the operation would vanish one frame
after it loaded. It also **SELECTS THE SCENARIO** — `?shot=` is the only other thing that can name
one, and the shell deletes `?shot=` from every match query on purpose. There is no third signal:
`bootScenarioName` answers `'campaign'` when an operation is armed, because arming one IS the
selection, and a second flag that has to agree with the first is how two of them come to disagree.

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
`?tier=`, `?seed=`, `?mapseed=`, `?biome=`, `?fog=off`, `?relay=`, `?unlockall`,
`?campaign=<chapter>.<NN>.<slug>`. **`?seed=` and
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
