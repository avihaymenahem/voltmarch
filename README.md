<p align="center">
  <img src="public/brand/logo-360.png" alt="VOLTMARCH" width="360" />
</p>

# VOLTMARCH

An original real-time strategy game that runs in the browser. Two factions (Allies / Soviets),
an ore economy, base building, massed tank battles, fog of war, and a right-hand sidebar HUD.

VOLTMARCH is not a port or a clone of any existing game. It is a new title in the tradition of
1990s and 2000s base-building RTS — the genre conventions it adopts (sidebar production, harvester
economy, tech tiers) are the shared vocabulary of that genre. Its art direction takes its cue from
the era's high-contrast, saturated, readable look; `docs/` cites specific reference frames so the
renderer has a measurable target to be scored against.

**All art is generated from code.** No downloaded models, no downloaded textures, no webfonts.
Every unit, building, material and texture is built from Three.js geometry, custom shaders and
procedural canvas/worker generators, so the entire look can be iterated on by editing values.

## Stack

Vite · TypeScript · Three.js `0.185.1` (pinned exact). No React, no game engine.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

| script | what it does |
| --- | --- |
| `npm run dev` | dev server on port 5173 (strict) |
| `npm run build` | production bundle into `dist/` |
| `npm run preview` | serve the built bundle on port 4317 |
| `npm run typecheck` | `tsc --noEmit` over all three programs — a **separate lint gate**, never part of the build |
| `npm test` | vitest unit + determinism suites |
| `npm run soak` | 20-minute AI-vs-AI determinism soak |
| `npm run shots` | build, serve, and capture the critic screenshot set into `shots/` |

`npm run build` intentionally does **not** run `tsc`. esbuild strips types, so a type error in
one of ~15 parallel modules must never be able to stop the game from running. Type errors are
caught by `npm run typecheck` instead.

`npm run shots` additionally needs Playwright with a Chromium browser:

```bash
npm i -D playwright && npx playwright install chromium
```

## Boot flags

Appended to the URL, e.g. `http://localhost:5173/?art=dusk&seed=1234`.

| flag | effect |
| --- | --- |
| `?shot=<id>` | freeze the sim and pose the camera for a diffable screenshot |
| `?map=<preset>` | map preset (`ridge-basin`, `ore-delta`, `fortress-pass`) |
| `?art=<mood>` | lighting/grade mood (`noon`, `dusk`, `night`, `overcast`, `dust`) |
| `?tier=<tier>` | quality override (`low`, `medium`, `high`, `ultra`) |
| `?seed=<int>` | deterministic RNG seed |

## Layout

Landed (the foundation):

```
index.html               page shell, mount points, loading curtain
src/main.ts              entry point: boot flags -> Bootstrap, resize, error surface
src/core/                sim spine: types, config, EntityStore/World, buses, loop, math, assets
src/core/config.ts       ArtDirection + world scale — THE values file a critic edits
src/render/              renderer, scene, camera, post chain, __VM debug handle
src/game/Bootstrap.ts    the only file that wires sim + render together
src/game/ArtBridge.ts    core/config.ts (hex strings, degrees) -> RENDER_CONFIG (ints, three enums)
src/game/PlaceholderScene.ts  gray-box scaffolding; deleted when terrain + models land
tests/                   foundation seam tests + the src/sim determinism grep gate
tools/shoot.mjs          screenshot harness for the visual critique loop
tools/metrics.mjs        numeric scorecard over the captured PNGs
docs/                    look bible + visual DNA
refs/                    reference screenshots of shipped RTS games, for visual scoring only
```

Planned (parallel phase — these directories do not exist yet):

```
src/data/    frozen unit/building/weapon/armor tables
src/sim/     simulation systems (nav, combat, economy, build, ai)
src/art/     procedural models: vehicles, infantry, buildings
src/vfx/     particles, decals, tread tracks, emitters
src/ui/      sidebar HUD
src/world/   terrain generation, fog of war
```

The architecture manifest names `src/config/ArtDirection.ts`; the foundation put those values in
`src/core/config.ts` instead. `src/game/ArtBridge.ts` is the single translation point between that
file and the render layer — nothing else may map one onto the other.
