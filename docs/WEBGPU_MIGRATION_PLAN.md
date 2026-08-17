# WEBGPU MIGRATION PLAN

**Written 2026-08-17, at v2.12.0+.** Requested directly: *"Start working on a plan migrating to
WebGPU, i want these performance stats raised immediately."*

This document does both halves of that. **§1-§2 are the immediate performance work and do not
involve WebGPU at all.** §3 onward is the migration, staged and costed. They are separated because
they are different projects on different timescales, and conflating them is how a renderer rewrite
gets sold as a frame-rate fix.

---

## 0. THE HONEST VERDICT, UP FRONT

**A WebGPU migration will not raise the performance numbers this project currently reports, and it
cannot be immediate.** Both halves of that sentence are measured, not asserted:

```
colour pass draws     54-76      against MAX_DRAW_CALLS 130      <- ~42% headroom unused
total submissions    105-157     (colour + shadow + post; ao is 0)
triangles           0.44M-1.03M
shader programs        66-76
```

WebGPU's headline win is **lower CPU cost per draw call**. That is decisive when an engine is
submitting thousands of draws. We submit **fewer than 80 in the colour pass**, with 42% of the
budget unspent even after raising the prop-type cap from 22 to 30. There is no draw-submission
bottleneck to relieve.

Its second win is **compute shaders**, and for this project they are mostly unusable. The simulation
is deterministic lockstep and terrain generates independently on both clients; CLAUDE.md's own
constraint is that ECMA-262 pins only `+ - * /` and `Math.sqrt` to bit precision, which is why the
Sunder Atoll islands are axis-aligned ellipses rather than rotated ones. **GPU floating-point results
are not bit-identical across vendors or drivers.** Any generation or simulation work moved to compute
is a tick-zero desync waiting for an NVIDIA machine and an AMD machine to meet. Compute is therefore
confined to render-only work — particles, VFX, culling — which is real but is not what a migration is
justified by.

**None of this means "never".** It means the justification has to be something other than the
numbers above, and the sequencing has to start with a measurement nobody has taken yet.

---

## 1. PHASE 0 — FIND OUT WHERE THE FRAME ACTUALLY GOES. Hours, not weeks. Do this first.

**We do not currently know whether we are CPU-bound or GPU-bound, and that single fact decides
whether WebGPU is worth anything at all.** WebGPU helps a CPU-bound submission path. It does close
to nothing for a fill-rate- or shader-bound frame — and a 2560x1440 frame running GTAO, bloom and a
grade pass over 60-75% ground coverage has every reason to be the latter.

The instruments already exist and have never been pointed at this question:

- **CPU side is already there.** `src/render/debug.ts` reports `frameMs`, `frameMsAvg`, `frameMsMax`
  and `cpuMs` through `stats()`, and `AdaptiveResolution.sample(frameMs, dtSec)` already consumes
  wall-clock frame time.
- **GPU side is already there too.** `src/ui/PerfHud.ts:44` and `:454` use
  `EXT_disjoint_timer_query_webgl2` "where the browser offers it, and silence" otherwise. Chrome
  disables that extension on many configurations, so **the first thing to establish is whether it
  reports at all on the target machine** — if it does not, use per-pass wall-clock deltas with
  `gl.finish()` in a throwaway profiling build, which is inaccurate in absolute terms but fine for
  apportionment.

**Deliverable:** a table of `cpuMs` vs `gpuMs` at 200+ units on the heaviest map, plus a per-pass GPU
breakdown (shadow / colour / GTAO / bloom / grade). Roughly a day's work, most of it already built.

**The decision rule:**

| finding | what it means |
|---|---|
| `cpuMs` ≈ `frameMs`, GPU idle | CPU-bound. WebGPU's draw-submission win is real — but so is §2, and §2 is free. |
| GPU ≫ CPU, post chain dominant | **Fill-rate bound. WebGPU changes nothing.** Fix resolution scale, pass count, and overdraw. |
| GPU ≫ CPU, colour pass dominant | Shader/overdraw bound. WebGPU changes nothing. Fix materials and overdraw. |
| Neither dominates; frame is fine | There is no performance problem to solve, and the migration is a maintenance decision. |

**Do not start §3 before this table exists.** Three of the four outcomes above say the migration
does not help.

---

## 2. WHAT RAISES FRAME RATE NOW, WITHOUT CHANGING RENDERER

Ordered by (measured or expected win) / (cost). These are the "immediately" answer.

1. **Adaptive resolution is already built** (`src/render/AdaptiveResolution.ts`) and takes `frameMs`.
   Confirm it is enabled, tuned and actually engaging under load. A resolution-scale controller that
   never fires is the single most common way a shipped game leaves frame rate on the table.
2. **There is still no LOD system.** CLAUDE.md is explicit: `lodDistances` was DELETED rather than
   wired, "so do not write code that assumes one exists." At 200+ units every hull draws every
   triangle at every distance. Triangles run 0.44M-1.03M and the canopy work just added ~3.3%. A
   two-tier impostor/LOD for units and props is the largest structural win available and it is
   renderer-independent.
3. **Terrain half-res LOD is parked on a branch** (`terrain-halfres-lod`), rejected earlier because
   it only reached 4 of 64 chunks. Worth re-measuring now that terrain has changed.
4. **Shadow pass is 29-59 draws — a third to a half of the colour pass.** One directional light, one
   ortho camera. Check the `castShadow` radius gate is culling as intended and that the shadow camera
   is not being fitted wider than the visible ground.
5. **Post chain cost is unmeasured.** GTAO + bloom + grade at 1440p is 21 draws but potentially a
   large share of GPU time. Phase 0 will say. If it dominates, half-res AO and a cheaper bloom mip
   chain are cheap wins.
6. **Overdraw is unmeasured.** Foliage and VFX sprites are the usual offenders; the flash work just
   demonstrated the sprite layer was responsible for +13.15pp of blown pixels against the light
   layer's +0.95pp, which means the sprites are covering a lot of screen.

**Every one of these is available today, none of them risks the determinism model, and none of them
requires rewriting 62 shader injection sites.**

---

## 3. THE MIGRATION COST, INVENTORIED

Measured on the tree at v2.12.0:

```
onBeforeCompile sites        24   across 12 files
GLSL #include replacements   62
shader programs in flight    66-76
```

`WebGPURenderer` (`three/webgpu`) uses **TSL node materials** compiling to WGSL. `onBeforeCompile`
and `#include <map_fragment>`-style chunk injection **do not exist on node materials**. Every one of
those 62 replacements is a rewrite, not a port. The heaviest single item is
`src/world/TerrainMaterial.ts`, whose splat shader replaces `<common>`, `<map_fragment>`,
`<roughnessmap_fragment>` and `<normal_fragment_begin>` and carries a hand-managed
`customProgramCacheKey`.

The post chain is a second front. `ShaderPass`, `UnrealBloomPass` and `GTAOPass` are the WebGL
`EffectComposer` stack; `three/webgpu` has its own node-based `PostProcessing`. **The GTAO
depth-G-buffer work that deleted an entire scene submission this month —
`installAoDepthGBuffer` / `setGBuffer` in `src/render/post.ts` — has no direct equivalent and would
be redone from scratch.** That was a 39-57 draws-per-frame saving; losing it during migration and
rebuilding it is a real, temporary regression.

**It is not incremental.** You cannot run half the scene on `WebGLRenderer` and half on
`WebGPURenderer`. The cutover is atomic per-scene.

---

## 4. PROJECT-SPECIFIC RISKS THAT A GENERIC MIGRATION GUIDE WILL NOT MENTION

1. **The shot harness is load-bearing and its failure modes are documented at length.** `npm run
   shots` drives headless Chromium through `window.__VM`, and CLAUDE.md records that a GPU-process
   crash silently drops it to SwiftShader, changing **76.5%** of pixels while reporting success. The
   harness now fails a shot on a backend change — but that guard was written for WebGL. **Verify the
   backend check still discriminates under WebGPU before trusting a single capture**, or the entire
   visual-regression process becomes decorative during exactly the change most likely to break it.
2. **`window.__VM` is the whole tooling contract.** `tools/shoot.mjs` and `tools/metrics.mjs` drive
   the game through it. CLAUDE.md: "changing that surface breaks the entire visual-critique pipeline
   — update both consumers." A renderer swap touches `renderer`, `scene`, the post chain and
   `stats()`.
3. **`renderer.info` is the draw-call instrument.** `autoReset = false`, reset once per frame in
   `beginFrame()`, and `drawCallsByPass` is derived from it. WebGPU's statistics surface differs;
   `MAX_DRAW_CALLS`, `shots/_report.json` and `tools/shot-compare.mjs draws` all depend on it.
4. **Determinism is unaffected only if compute stays out of the sim.** Write that down and gate it,
   because the temptation of a migration is to "finally" move generation to the GPU. See §0.
5. **Reach.** `WebGPURenderer` does have a **WebGL2 backend fallback**, so this is weaker than it
   first appears — you do not strictly lose browsers without WebGPU. But then those users get the
   node-material path over WebGL2, which is a *different* renderer from the one shipping today and
   needs its own visual verification. **Two backends means two grade baselines.**

---

## 5. STAGED PLAN — only if Phase 0 justifies it

Each stage ends green on all four gates and on `npm run shots` at 92.0% with zero weight-3 failures.

- **Stage A — spike, throwaway.** `WebGPURenderer` with a *stock* `MeshStandardNodeMaterial` scene,
  no custom shaders, measuring draw submission and frame time against the WebGL build on the same
  content. Answers "is the win real for us" for a few days' cost. **Delete the branch afterward.**
- **Stage B — the post chain.** Rebuild bloom, GTAO and the grade as TSL nodes, verified against the
  existing scorecard. Doing this first means the hardest measured surface is proven before any
  material work.
- **Stage C — terrain.** The single biggest shader. Port the splat classifier and warp to TSL. Its
  outputs are already pinned by `terrain-*.spec.ts` and the splat quantile work.
- **Stage D — structures, units, props.** 24 injection sites, mostly greeble/atlas materials.
- **Stage E — water, shroud, VFX.** `WaterMaterial` is a raw `ShaderMaterial`; VFX is additive
  sprites and the flash budget.
- **Stage F — cutover, dual-backend verification, two grade baselines.**

**Rough order of magnitude: weeks, not days.** Stage A alone answers the question that matters.

---

## 6. WHAT I RECOMMEND

Run **Phase 0** (§1) and the top two items of **§2** first. They are days of work, they carry no
architectural risk, and they will either produce the frame-rate rise directly or tell us precisely
which of WebGPU's advantages we would actually be buying. **Stage A** then costs a few days and
settles the migration question with a number instead of an argument.

If the answer comes back "CPU-bound on draw submission", the migration is justified and this plan is
ready to execute. If it comes back "fill-rate bound" — which the frame's composition makes more
likely — then the migration would have cost weeks and raised nothing, and §2 is the whole answer.
