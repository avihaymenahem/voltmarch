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
3. **Recorded audio** in `public/audio/` — 182 Ogg files, 6.9 MB, added 2026-08-09 at the user's
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
   apostrophe. The voice model is 109 MB and gitignored; only the ~420 kB of Ogg is committed.

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
npm test             # vitest, currently 2516 across 100 files
npm run build        # must exit 0
npm run server:test  # the relay's own 31, via node --test
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

**There is no known flake.** `perf-hud.spec.ts` "allocates nothing per frame" used to be one — it
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

## Hard rules

- **Determinism.** Inside `simTick`, `Math.random()`, `Date.now()` and `performance.now()` are
  banned — there is a test asserting this. Use `s.rng` and the tick counter. This is not
  hygiene any more: it is what makes multiplayer possible at all.
- **Performance.** 200+ units at 60fps, zero allocation in the frame loop, and a draw-call budget of
  130 — which is a TARGET, not a description. Measured on the twelve capture fixtures via
  `renderer.info.render.calls`, the real figure is **171–263** (that count includes the three CSM
  shadow cascades). This line read "under 130 draw calls" as a statement of fact while the counter
  disagreed by up to 2×; `MAX_DRAW_CALLS` in `config.ts` is the aspiration and `AdaptiveResolution`'s
  own header already records a profile at 203. Do not quote 130 as achieved, and do not spend draws
  freely on the grounds that the budget is fictional — closing that gap is real outstanding work.
  InstancedMesh for anything repeated, pools for anything spawned, caller-supplied output arrays in
  query paths.
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
`?tier=`, `?seed=`, `?fog=off`.

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
