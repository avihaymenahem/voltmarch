# CLAUDE.md

Working notes for Claude Code in this repository. Read this before changing anything.

## What this project is

VOLTMARCH — an original browser RTS in Three.js. Three factions, ore economy, base building, AI
opponent, fog of war. **All art is generated from code**: no downloaded models and no downloaded
textures.

That claim is about the GAME WORLD, and it is exactly true there: every mesh, material, texture,
cameo and in-game icon is built from Three.js geometry, custom shaders and procedural canvas
generators. **Two shipped assets are not generated**, both deliberate, both in `public/`:

1. **Rajdhani** (OFL-1.1) in `public/fonts/` — the UI text face, Latin subset, four weights, 60 kB.
   Added 2026-08-05 at the user's request. The stack had named Rajdhani since it was written and
   nothing ever shipped it, so every menu and HUD rendered in the fourth fallback — Franklin Gothic
   Medium — and the face the UI was designed around was never on screen.
2. **The brand lockup** in `public/brand/` — eight PNGs derived by `tools/brand.mjs` from a
   `logo.png` the user supplied. `logo-full.png` is the main-menu title and the loading curtain;
   `mark-*.png` are the favicons and app icons. See `public/brand/README.md`.

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
npx tsc --noEmit     # must exit 0 — real fixes, never `any` or @ts-ignore
npm test             # vitest, currently 1846 passing across 74 files
npm run build        # must exit 0
```

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

## Hard rules

- **Determinism.** Inside `simTick`, `Math.random()`, `Date.now()` and `performance.now()` are
  banned — there is a test asserting this. Use `s.rng` and the tick counter.
- **Performance.** 200+ units at 60fps, under 130 draw calls, zero allocation in the frame loop.
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
