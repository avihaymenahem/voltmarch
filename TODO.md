# TODO

**Rewritten 2026-08-07 at v1.25.0.** Everything the previous version of this file listed has
shipped. It opened "Requested work, not yet started" and named seven items — a beginner tutorial,
a HUD overhaul, a buildings art pass, overlapping pavements, props not cleared on placement, an
objectives cap, and a success popup. All seven are in the game
(`src/shell/Tutorial.ts`, the v1.12.0 HUD, `src/world/Roads.ts` junction pads,
`src/world/scatter-clear.system.ts`, the three-state panel in `src/ui/Objectives.ts`,
`src/ui/ObjectiveBanner.ts`). The file was written once and never touched again through twenty-plus
releases, so it spent most of its life being the most misleading document in the repository.

What follows replaces it: the output of a repo-wide sweep run on 2026-08-07, in which six
independent finders produced 130-odd candidates and an adversarial pass — whose default was to
REFUTE — killed the ones that were already fixed, already called, or merely matters of taste. **68
survived; they dedupe to the 13 items below.**

Read the honest summary first, because the list is longer than the work:

> Nothing here crashes, breaks the build, or blocks play. The genuinely player-facing defects are
> three small ones plus a dev-tool view. Everything larger is *unbuilt feature*, not breakage: the
> simulation halves are finished and correct and simply have no surface. The rest is roughly a day
> of deletion and comment-fixing that buys no player anything, but stops the next person losing an
> afternoon to a declaration that lies.

Effort is S / M / L. "Visible" means a player could notice.

---

## Tier 1 — player-visible defects, small and sharp

### 1. The Reclamation is missing from two lookup tables — S, visible

`src/sim/Crates.ts:97` — `FREE_UNITS` has keys `allies/soviets/meridian/neutral` and no `reclaim`,
so `factionKey(Faction.Reclaim)` misses and falls to `?? FREE_UNITS.neutral`: **a Reclamation
player who opens a Unit crate is handed an Allied G.I. or a Soviet Conscript.**

`src/sim/RepairSell.ts:59` — `SURVIVOR_KEY = ['gi', 'gi', 'conscript', 'mrdWayfarer']` is four
entries against `FACTION_COUNT = 5`, so index 4 is `undefined`: **a Reclamation building sale
spawns Allied G.I.s.**

The rows to add exist — `rclPicker` (`Defs.ts:935`), `rclSpitter`, `rclGrinder`. Both read sites
have `??` fallbacks, which is precisely why `tsc` never caught either: a
`Readonly<Record<string, …>>` hides a missing key. Consider whether the type should be keyed on the
faction enum instead, so the compiler catches the fifth faction next time.

### 2. Film grain and chromatic aberration ship ON, against an explicit ban — S/M, visible

`CLAUDE.md` bans both by name. `src/core/config.ts:768-770` sets `grain: 0` and
`chromaticAberration: 0` deliberately, with a comment about GPU cost. The settings layer then
overwrites both: `src/shell/settings-store.ts:419` defaults `filmGrain: true`, and
`src/shell/Shell.ts:1434` calls `applySettings(this.settings.get(), game)` with no `changed`
argument, so `all = true` and the block at `src/shell/Settings.ts:140-154` runs unconditionally,
writing `grade: { grain: 0.018, vignette: 0.28, chromaticAberration: 0.0012 }`.

The fix is one narrowed condition. The judgement call is which layer should own the value. **No
test asserts the zeros** — whatever the answer, one should.

### 3. The Options screen is full of controls that never reach the engine — M total, visible

Six separate things behind one screen. Each is S on its own.

- **Four dead toggles.** `tooltips`, `damageNumbers`, `subtitles`, `screenShake` are typed,
  defaulted, normalised, persisted and drawn (`settings-store.ts:147-151/449-452/590-593`,
  `Settings.ts:626-635`) and read by nothing. The excuse at `Settings.ts:24` — "the HUD and VFX
  modules that will read them are being written in parallel" — is stale; those modules shipped.
  `screenShake` is the cruellest: `CameraRig.addShake` genuinely fires, driven by
  `config.ts:5164 shakePerTL`, so the slider sits beside a working effect it cannot touch. Same
  defect from the art side — `VFX_LOOK.screenShake` (`config.ts:1150`) has zero readers, so an art
  pass would reach for the wrong knob.
- **Two rebindable keys that can never fire.** `sys.speed` and `sys.screenshot`
  (`ActionCatalogue.ts:962-980`) both say `Reserved. The binding is stored, but nothing in the
  engine reads it yet` — and are still `binding: 'rebindable'`. Both capabilities exist
  (`GameLoop.setTimeScale`, `__VM.screenshot`); only the keystroke path is missing.
- **The perf overlay has no shortcut.** `src/ui/perf.system.ts:44`. The catalogue row is written
  out verbatim at `:49-61` with `defaultChord: chord('F4')` and was never pasted in. The PerfHud is
  reachable only through the Graphics tab. Note `sys.perf` (F3) is a *different* overlay.
- **`shadowQuality` is the one setting not re-asserted after a tier change.** `Settings.ts:134` is
  a bare `if (want(…))` while every neighbour includes `touched(changed, 'graphics.tier')`, so boot
  forces 2048 on a machine auto-detected as `low`.
- **Dynamic resolution cannot be turned off.** `setAdaptiveResolution`,
  `adaptiveResolutionEnabled`, `adaptiveChanges`, `adaptiveMedianMs`
  (`src/render/adaptive-res.system.ts:46-65`) have zero callers. The doc at `:51-56` — "a disabled
  feature must not keep having an effect" — describes a switch with no wire.
- **H is double-bound.** `camera.ts:1281` handles `KeyH` on a capture-phase window listener *and*
  `ActionCatalogue.ts:374` gives `cam.home` the same chord. `setHome()` is never called in the
  product, so the rig glides to the constructor seed (default 256,256) while the action path glides
  to your actual conyard. `getHome()` is dead. `tutorial.system.ts:141` duplicates ~20 lines of the
  correct logic and closes with "the fix that removes this copy is one line in `centreOnHome`".

### 4. `?parade` renders every building sunk underground — S

`src/art/buildings.system.ts:275` — `m.prototype()` mints a plain `THREE.Mesh` with no `aState`
attribute. `aState` is instance-only (`InstanceBatcher.ts:84`), so it defaults to (0,0,0,1), the
shader's `bp` is 0, and `transformed.y -= raSink` sinks each mass by its full rise height. The fix
is already exported and unused: `primeCameoPrototype` (`src/ui/Cameos.ts:218`).
`tools/sobel.mjs:330` documents the trap verbatim and works around it by hand.

Units are **not** affected — `UnitFactory.ts` has no `raSink` — though unit prototypes do lose
damage tint and team colour, which is a smaller separate thing.

---

## Tier 2 — features built to ~90% and never given a surface

### 5. Superweapons: a complete subsystem reachable only from the browser console — L, visible

The largest item, found independently by four of the six sweeps. Four weapons are fully
implemented, charge every tick, and no player can see or fire one.

- `hudSink()` (`Superweapons.ts:953-958`) requires `setSuperweapon` and `clearSuperweapon` on
  `globalThis.__vmHud`. `src/ui/Hud.ts` — which **is** that object — contains zero occurrences of
  "superweapon", so `pushHud` is a permanent no-op.
- `HUD_SUPERWEAPON` (`config.ts:3332`) has exactly one occurrence repo-wide: its declaration.
  `Chrome.formatClock` (`:294`), which `tests/hud.spec.ts:351` labels "the superweapon clock", has
  zero `src/ui` callers. `docs/VISUAL_DNA.md:838` specifies the readout as shipped.
- **Two of four playable factions can never have one.** `Superweapons.ts:514` rejects any def whose
  faction is not the player's, and all four rows are Allies or Soviets. Worse: `Missions.ts:511`
  already grants a Meridian player `superSolarLance` as a reward no row can honour.
- **Fire bypasses the command bus.** `arm()` installs its own `pointerdown` listener and
  `handlePointer` calls `fireAt` straight from the browser event, spending the charge at
  `Superweapons.ts:452` outside any tick, never touching `channels.commands` — the replay
  recorder's only tap. Inert today only because nothing can fire. **This must be routed in the same
  change that adds the UI, or wiring the HUD ships a desync.**
- `SaveGame.ts:2116` calls `setRemaining`, which `SuperweaponService` never grew, so a partially
  charged superweapon reloads as fully discharged.

### 6. Four content blurbs the simulation does not honour — L, visible

- **Transport loading is a lie.** `Commands.ts:498` resolves IFV/transport as seated targets and
  issues `OrderKind.Enter` with `CursorKind.Enter`; the only sim consumer, `Garrison.ts:248`, drops
  any non-`Building` target on the tick it arrives. There is no passenger system. The 900-credit
  Hover Transport is `weapons: UNARMED` with the blurb "Carries a squad across water."
- **The Gate blocks its owner.** `Defs.ts:1588`: "A way through your own wall. Friendlies only."
  `building()` unconditionally ORs in `BlocksNav`, and `Flowfield.ts:1022` blocks via
  `port.isOccupied(cx, cz)` — which takes no owner argument, so there is no seam through which
  friendliness *could* be honoured.
- **Garrison shipped without its content.** Every neutral branch exists and is unreachable: no
  `spawnBuilding` call anywhere passes a neutral owner, so the mechanic runs on your own Power
  Plant and nothing else. The CONTENT NOTE at `Garrison.ts:31-35` defers to a report for def rows
  that were never written.
- **Meridian and Reclamation have walls but no gate.** `Production.ts:733` is the only gate row,
  `Faction.Neutral` with `prereqs: ['barracks']`, and neither newer faction is in the Neutral pool.
  Both their walls carry `EntityFlag.NotSelectable`, so they cannot even be sold to reopen a run.

### 7. Mission rewards are granted, announced, and consumed by nothing — L

`src/data/Missions.ts:142` — five commander powers and fourteen cosmetics are paid out by real
missions. Grepping the five power ids returns only their declarations and their use sites *inside
Missions.ts*. The two readers (`ObjectiveBanner.ts:160`, `shell/Missions.ts:210`) are pure text
formatters; there is no `isUnlocked('power.*')` anywhere. `docs/MISSIONS_DESIGN.md:99` promises
"every unlock gets an end-screen reveal, a 'NEW' badge on its cameo".

### 8. Replay records but cannot play back — L (the doc half is S)

`ReplayPlayer.issueFor` (`Replay.ts:320`) has only test callers; `lastTick` has zero references
anywhere. `installGlobal()` publishes save/stats/download/verify/stopVerify, and `verify` refuses
unless you have already booted the same seed. There is no way to *watch* a recording, which is what
the request quoted in commit `45cbb48` asked for. v1.25.0 finished the recording side honestly;
this is the other half.

---

## Tier 3 — half-wired machinery that will bite whoever builds on it

### 9. The model-identity layer: three dead selectors, five orphan models, two render bugs — M

Art is resolved solely by `CONTENT_TO_MODEL` / `CAMEO_UNIT_MODELS`. Everything else that *claims*
to select a model is dead.

- `BuildableDef.model` (`types.ts:636`, "ModelRegistry key") has zero functional readers and **five
  rows are already wrong**: `attackDog → 'soviet_conscript'`, `apocalypse → 'soviet_rhino'`,
  `submarine → 'soviet_dreadnought'`, `gunboat → 'allied_destroyer'`,
  `transport → 'allied_harvester'`.
- `store.modelId` (`world.ts:80`, "ModelRegistry id, cached at spawn") — there is no ModelRegistry.
  A `MAX_ENTITIES` `Uint16Array` of zeros inside frozen infrastructure, serialised into every save
  at `SaveGame.ts:498`. Removal is not free: `SaveGame.ts:491` says column ids are FROZEN, so the
  loader must first tolerate an absent column.
- `ModelBuild.lodDistances` (`types.ts:1823`) is written once at `UnitFactory.ts:813` with the
  comment "the bridge decides whether to use it". It does not. The whole struct is inert.
- **Five finished, validated unit models are built and atlas-packed every boot with no content key
  that can reach them**: `soviet_sickle`, `soviet_v4`, `soviet_flak`, `soviet_mig`,
  `allied_vindicator` (`UnitDefs.ts:1756-1794`). `combat.system.ts:62-67` even maps weapons for
  content keys that do not exist. `tests/cameos-coverage.spec.ts` checks def→binding and
  binding→def, never model→def, so this whole class is invisible to the suite.
- **Placeholder buildings are double-rotated** — `RenderBridge.ts:1005` scales by the already
  yaw-swapped world footprint, then `composeBasis(partYaw, …)` rotates again. Latent: every faction
  has a catch-all art registration, so it only shows if a default mass list throws.
- **`BUILDING_FOOTPRINTS` never got its one-line merge.** `BuildingDefs.ts:671-684` spells the fix
  out; until then the `EXTRA_DIMENSIONS` fallback stays load-bearing for navalYard, subPen,
  prismTower and flameTower, and `config.ts:4214`'s docstring claims a role its only reader
  contradicts.

### 10. The debug and telemetry surface reports wrong or zero — S/M

- The F3 overlay's batch row reads `counters.batches` (`debug.ts:652`), which **nothing writes** —
  the real value goes to `counters.instBatches`. `DebugCounters` has an index signature, so the
  typo compiles and the row is permanently 0.
- `endFrame()` returns early on `if (!visible) return;` (`debug.ts:1019`) before `updateOverlay()`,
  the only place `heapMB` / `heapBase` / `cachedTexMB` are assigned. So `__VM.stats()` reports
  `textureMB: 0, heapMB: 0, heapGrowthMB: 0` unless a human has the overlay open — and that is the
  documented headless profiling surface. A zero heap-growth reads as a green allocation canary.
- `readChannelStats` / `CHANNEL_STATS` (`events.ts:748`) were built "for the F3 debug overlay" and
  are never called. `droppedCommands`, `damage.dropped` and `fx.dropped` have no other reader, so a
  command-ring overflow in a large battle is genuinely unobservable.

### 11. A quality governor and a live-art pipeline, both documented in the present tense, neither of which exists — S/M

`GOVERNOR_DROP_MS`, `GOVERNOR_RAISE_MS`, `GOVERNOR_WINDOW`, `MIN_RESOLUTION_SCALE` and `TARGET_FPS`
each have exactly one occurrence repo-wide: their declaration. `Profiler.avgFrameMs` is computed
"for the quality governor" and read nowhere. The prose is live and wrong — `config.ts:1362` "The
governor drops resolutionScale BEFORE it drops particles", `renderer.ts:107` "The quality governor
drives this." What shipped is `AdaptiveResolution.ts`, with a different table and a different floor
(`minScale: 0.55` against the dead `0.6`): two owners for one quantity, one of them fictional.

Separately, `'quality:changed'` and `'art:changed'` are the only two of 25 bus events with zero
emitters **and** zero subscribers, and `ArtAware` / `applyArt` (`types.ts:1777`) — declared as the
live-art-edit contract — has zero implementers, because `ArtStore` never landed and exists only in
comments. `config.ts:1252`'s present-tense claim that a runtime art edit re-applies uniforms is
false, and a visual-tuning pass that trusted it would be misled.

### 12. Sim state that is declared, hashed and persisted but never set — S each

- `PlayerState.defeated` is written in exactly two places: the `false` initialiser and the save
  restore. `AI.ts:493` is its only reader, so `AiPosture.Defeated` is unreachable and **an
  eliminated AI keeps running a full brain tick forever** in a 3+ player match. Elimination is
  actually decided by `Viability.ts` via `outcome.system.ts`, which never touches the flag. It is
  also hashed into the sim checksum as a constant-false column.
- `setMatchPhase` (`Production.ts:1385`) has one occurrence, its own definition. Four of six
  `MatchPhase` members are unreferenced and `HudSnapshot.matchPhase` is written twice and read
  never. Its declaring comment names a phantom owner: `grep MatchModule` returns only the comment.
- `dockOffsetX/Z` ("where a harvester parks to unload", `Defs.ts:1197`) is computed for every
  building def and read nowhere, while its sibling `exitOffsetX/Z` **is** read at
  `Production.ts:995`. The real apron is recomputed from yaw and footprint at `Harvesting.ts:485`,
  so authoring a dock offset silently does nothing.
- `assertWritePhase` (`loop.ts:453`) has zero call sites. The feeding machinery is complete and
  correct, so the normative phase table at the top of `loop.ts` is unenforced purely for want of
  the calls.

### 13. The instruments that were supposed to catch all of this — M

- `tests/roads.spec.ts:186` — the title says "15-40 m band" and only the 40 is asserted; the test
  also `return`s early when there are no bends, so it can pass having checked nothing. `:181`
  asserts a 3 m floor under a title claiming 4-8 m. There are **three disagreeing corner floors for
  one declared band**: the bible says 4.0, `roads.system.ts:188` warns below 3.5, `Roads.ts:2360`
  rejects below 3.0 — so corners in [3.0, 4.0) really do ship, and `Roads.ts:2357` says otherwise.
  Reconcile the floors; do not just bump the literal.
- `tests/foundation.spec.ts:205` — the determinism gate is the suite's only banned-call scanner. It
  wraps `readdirSync` in `catch { return out; }` and never asserts `files.length > 0`, so renaming
  `src/sim` turns it into `expect([]).toEqual([])`. Three `simTick` implementations live outside
  its scope (`replay.system.ts:106`, `save.system.ts:378`, `input.system.ts:1254`); none violates
  today, and any fix must scope to `simTick` bodies or it false-positives.
- The perf-hud zero-allocation gate's *sensitivity* was only ever verified under
  `--max-semi-space-size=4`, and that flag appears only in prose — `package.json` is a bare
  `vitest run` and `vite.config.ts` has no `poolOptions`. One `execArgv` line pins it.
- `tools/metrics.mjs` — **partly done 2026-08-17.** The header's baseline-rebased list is corrected
  and `edgeCoverage` no longer carries `baselineKey` at all: it is `w: 0`, informational, because
  the rebased band was measured to be unreachable by authoring (factor 1.264 ± 0.039 into the
  reference frame, 0 of 13 in band after normalising, remainder = per-pixel noise at σ = 8/255).
  See `docs/SPEC_DRIFT_AUDIT.md` finding 17 and that file's own #34 block. `shots/_metrics.json`
  now persists `sampleCount` / `expectedCount` / `partial` / `imageSizes` / `informational`.
  **Still open:** `medianLuminance` is the one remaining `baselineKey`, and it still silently
  widens the flagship luminance check from [0.26, 0.40] to roughly [0.134, 0.491] — safe in
  principle (luminance is scale-invariant) but nobody has argued the widening itself is right.
  Scorecard #6 gates `p1Luminance` at [0.00, 0.25] against the bible's 0.06 ceiling and a measured
  max of 0.077, so it can never fail. Scorecard #20 compares only the first and last populated
  bucket, never tests the top band, and auto-passes any frame with fewer than three populated
  buckets — a blown or near-black frame takes a weight-2 pass.

  **Weight the metrics half low.** The RA3 reference frames were abandoned; the scorecard is a
  regression detector now, not a quality score. The exception is #20, which tests the ACES
  shoulder — a property of the tone chain that stays meaningful whatever the targets are.

---

---

## Cleanup: the calls that were left for a human

A second sweep on the same day audited the repo for leftovers — unreferenced files, dead assets,
broken paths — and 21 of 78 candidates survived an adversarial proof pass. The unambiguous ones
were done in this commit. These five were not, because each is a decision rather than a grep.

### C1. `src/art/Wrecks.ts` — 743 lines, 13 exports, completely unreachable — decide, don't sweep

Unreachability is proven exhaustively: every one of the 13 exports greps to zero hits outside the
file, no `import.meta.glob` pattern reaches `src/art/`, there is no barrel and no `index.ts`, and
no test enumerates the directory. But it is a **finished implementation of an open audit finding**
(`docs/SPEC_DRIFT_AUDIT.md:234`, "a destroyed structure never leaves rubble"), and its intended
consumer still runs a private one-carcass stub at `src/world/entity-props.system.ts:108`.

Wire it up or drop it on purpose. Deleting 743 lines of working feature under a "cleanup" label is
how the feature gets rewritten from scratch in six months.

### C2. `docs/surface-refs/ours-*.png` — 4 files, 4.6 MB, tracked and unreferenced

The pre-overhaul half of a texture before/after. The `after-*` half is now untracked and
regenerable (`npm run shots` then `tools/crop-surfaces.mjs`); `ours-*` is **not** regenerable —
the pipeline that produced it is gone. Kept for now on that basis. Worth a decision now that the
RA3 reference frames are abandoned. If they go, `tools/crop-surfaces.mjs:7` needs a note recording
where its crop geometry came from, or it becomes the next dangling reference.

### C3. `tools/_*.mjs` — 8 files, 109 kB, untracked and therefore unbacked-up

By the convention in `.gitignore`, a throwaway probe is deleted once its question is answered, and
all eight map to closed tasks. Untracked means **git cannot restore them.** Either confirm they are
finished and delete, or promote the ones worth keeping to real names and commit them.

### C4. The selection-card portrait API — `kindMeshFor`, `kindMeshVersion`, `HUD_PORTRAIT`

`RenderBridge.ts:369/382` and `config.ts:3185` are the entire remains of a feature whose module was
written and deleted the same day; all three have zero callers. The kind-mesh registry itself is
live (about eight writers in `src/art/`), so these two accessors are its only exported *reader*.

The question is upstream: should `src/ui/Cameos.ts` read the registry instead of rebuilding meshes?
If yes, this is the API it should use. If no, all three go together.

### C5. Dead exports — 177 of them, each individually proven

37 in `src/core/math.ts`, 140 across the rest of `src/**`; every name greps to exactly one hit, its
own declaration, across all file types including `.md`, `.mjs` and `vite.config.ts`. Two carve-outs
that were checked and must be respected:

- `src/core/math.ts`'s **live** exports (`Rng`, `clamp`, `lerp`, `hexToLinearRgb` — 79 importers)
  carry the determinism gate and must not be disturbed.
- In `src/art/Shapes.ts` only 3 of 80 exports are genuinely unreached; roughly 53 are used *inside*
  the file, so there the `export` keyword is redundant but the code is live. Deleting those symbols
  would be wrong.

For the 23 living in `src/core/config.ts` and `src/core/types.ts`, `CLAUDE.md` calls `src/core`
frozen infrastructure and some are deliberate placeholders — decide per symbol between deletion and
an explicit marker.

### C6. `vite.config.ts`'s `worker: { format: 'es' }`

There is no worker in the project and never has been; the comment above it is corrected in this
commit and the block kept. If the block itself is ever removed, `tools/sobel.mjs:453` must change
in the same commit — it emits the same line into a generated config and its header calls it one of
"the four things `vite.config.ts` sets that the game will not boot without". Two files, one claim.

---

## Carried over, and still true

- **Unverified on the reporter's hardware:** the macOS Chrome black-flash fixes, and whether the
  rebuilt audio synthesis actually sounds good. Both need someone on that machine.
- **Opening base placement is terrain-dependent** and one live Reclamation match on
  `temperate-valley` generated with no refinery, no defences and 6 of 9 walls. Not reproduced
  headlessly across six seeds, because the lobby threads `MapChoice.mapSeed` into terrain and the
  probe did not. v1.21.0 and v1.23.0 both touched this area; re-check before spending time on it.

One carried-over item was dropped as stale: the visual-critic-loop script (`scratchpad/` does not
exist and never made it into the repo).

**The scorecard sentence that used to sit here was itself stale, and is corrected rather than
deleted.** It read "the grade is 90.0% and every current failure is `edgeCoverage` against the
abandoned RA3 targets". Measured at v2.3.0, and again after the material-worker change, on all
twelve fixtures: **89.0% weighted, 15 failing checks, and three of them FATAL** — check #9,
emerald-green, on `07-soviet-base`, `08-naval-water` and `09-placement` (0.0227 / 0.0208 / 0.0225).
So the number was 1.0 point optimistic and the "no fatals" claim was false.

**Re-measured 2026-08-17 on all thirteen: 97.0% weighted, 3 failing checks, all three FATAL** —
still check #9 on the same three fixtures (0.0227 / 0.0264 / 0.0383). **The jump from 89.2% is the
scale changing, not the art**: `edgeCoverage` went `w: 2` → `w: 0` and stopped contributing 13
failures it could never have passed (see finding 17). Comparing a post-2026-08-17 grade to any
earlier one compares two different denominators — `metrics.mjs` now prints the informational list
under the score so that is visible at the point of quoting. The real outstanding art defect on this
set is emerald-green leakage, and it got worse on `09-placement` (0.0225 → 0.0383) while nobody was
reading past the edgeCoverage wall of red.

This is the defect class this file exists to catalogue, committed in the file that catalogues it: a
claim that quietly stopped being true, in the document a reader would trust to tell them what is
broken. Requote it only from a fresh `node tools/metrics.mjs shots/*.png`, and see the note on the
capture harness's nondeterminism before trusting a single run of it.
