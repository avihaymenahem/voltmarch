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

> **UPDATE 2026-08-17 — that measurement has now been taken, and it agrees.** At 194 drawn units on
> a four-army map at 2560x1440: GPU 29.83 ms against CPU 3.55 ms, a ratio of **8.4x**, with 79-90%
> of GPU time proportional to pixel count (r2 0.995-1.000). The CPU is idle for 88% of the frame.
> **There is no CPU bottleneck for WebGPU to relieve** — not "a small one", none. See §1, which is
> now a set of results rather than a plan.

---

## 1. PHASE 0 — WHERE THE FRAME ACTUALLY GOES. **MEASURED 2026-08-17. ANSWERED.**

**The question was whether we are CPU-bound or GPU-bound, because that single fact decides whether
WebGPU is worth anything at all.** It is answered, with an instrument, on the heaviest content this
game can produce.

> **VERDICT: GPU ≫ CPU by 8.4x, colour pass dominant, and 79-90% of GPU time is proportional to
> pixel count. Row 3 of the table below. The migration raises nothing.**

Reproduce with:

```bash
node tools/gpu-profile.mjs --match --armies 4 --map sunder-atoll --ai 3 --aip 2 \
  --credits 50000 --sim 900 --units 210 --size 2560x1440 --sweep --json shots/_phase0.json
```

**`EXT_disjoint_timer_query_webgl2` IS available here** — ANGLE / D3D11 on an AMD Radeon iGPU
(`0x00001638`, Renoir/Cezanne class). The `gl.finish()` fallback this section anticipated was not
needed, and would have been useless anyway: `tools/gpu-profile.mjs`'s own header records
`gl.finish()` reporting 4.2 ms for a frame the timer query measured at 67.5.

### 1.1 The three clocks, at 194 drawn units, 2560x1440

Four-army Sunder Atoll, Brutal + Boomer, 50 000 credits, seed 7. 449 entities, 150 buildings,
1518 particles, 132 draws (68 colour + 43 shadow + 21 post), 1.01 M triangles.

| clock | median | p95 | what it is |
|---|---|---|---|
| `frameMs` | **42.45 ms** | 50.60 | free-running rAF, sim live — **23.6 fps** |
| `gpuMs` | **29.83 ms** | — | `EXT_disjoint_timer_query_webgl2` |
| `cpuMs` (whole frame) | **3.55 ms** | — | all of `captureFrame`, nothing waiting on the GPU |
| `cpuMs` (`stats()`) | 2.70 ms | 4.20 | the engine's own counter — see §1.5 |
| `simMs` | 1.00 ms | 2.10 | one 30 Hz tick |

`cpuMs` and `gpuMs` overlap in a pipelined frame and are not summed. **The CPU is idle 88% of the
frame.** There is no draw-submission bottleneck to relieve, because there is no CPU bottleneck at
all.

### 1.2 The per-pass breakdown

Shares come from a timer query around each pass; absolutes come from the ablation, because a query
per pass fences every boundary and inflates the sum (38.90 ms of passes against a 29.83 ms frame,
30% high). **Every bucket was checked against turning that pass off** — `RENDER_FINDINGS.md` §7 is
about exactly the failure where a control does nothing and looks like a total regression.

| pass | query ms | share | disabling it saves |
|---|---|---|---|
| **colour (`render`)** | **21.47** | **55.2%** | — (`post-off` leaves 19.71 ms) |
| GTAO | 6.57 | 16.9% | 4.97 |
| bloom | 4.86 | 12.5% | 3.32 |
| SMAA | 3.65 | 9.4% | 2.78 |
| grade | 2.34 | 6.0% | **0.54 — the one to distrust** |
| *shadow map (inside `render`)* | *0.99* | — | *0.69* |

Read the ablation, which has no fencing artefact: **colour pass ~19.7 ms (66%), whole post chain
10.12 ms (34%), shadow map 0.7 ms (2%).**

**The shadow pass is not the problem and §2 item 4 should be closed.** It is 29-59 draw calls, and
it costs under one millisecond of the thirty.

**Half-res AO is already the largest single saving in the chain.** `ao-fullres` costs **+11.48 ms** —
more than bloom, SMAA and the grade combined. Do not raise it.

### 1.3 The resolution sweep — the arm that needs no extension

| scale | pixels | GPU ms | fps |
|---|---|---|---|
| 1.00 | 2560x1440 | 29.84 | 33.5 |
| 0.90 | 2304x1296 | 25.02 | 40.0 |
| 0.80 | 2048x1152 | 20.48 | 48.8 |
| 0.70 | 1792x1008 | 16.82 | 59.4 |
| 0.60 | 1536x864 | 14.50 | 69.0 |
| 0.55 | 1408x792 | 13.58 | 73.7 |

```
GPU ms = 5.86 + 6.40 x Mpx    r2 0.995     79.1% pixel-proportional
```

A second run on `glacier-shelf` at 70 units gave `3.37 + 7.93 x Mpx`, **r2 1.000**, 89.7%
pixel-proportional. **A frame whose cost is that linear in pixel count is fill-rate bound**, and
that conclusion needed no timer query at all.

**60 fps arrives at render scale 0.694 (1776x999).** Resolution scale is the lever. Draw submission
is not.

### 1.4 CPU does scale with units. It is still nowhere near mattering.

| content | drawn units | size | `cpuMs` | `gpuMs` |
|---|---|---|---|---|
| `?shot=allied-base` | 14 | 1280x720 | 1.90 | 12.65 |
| industrial-grid, 4 armies | 91 | 1280x720 | 2.60 | 11.35 |
| temperate-valley, 4 armies | 86 | 1280x720 | 2.90 | 12.00 |
| glacier-shelf, 4 armies | 113 | 1280x720 | 4.60 | 12.13 |
| glacier-shelf, 4 armies | 70 | 2560x1440 | 3.30 | 32.06 |
| **sunder-atoll, 4 armies** | **194** | **2560x1440** | **3.55** | **29.83** |

**A 14x change in unit count moved CPU by 1.7 ms. A 4x change in pixel count moved GPU by 17 ms.**
That is the whole argument, in two numbers.

Note also that GPU time is flat to within 7% across every four-army land map at a fixed resolution —
**map choice does not move this verdict**, and the heaviest frame is a function of pixels, not of
which battlefield it is.

### 1.5 Two things found while measuring, which are defects rather than results

- **`stats().cpuMs` under-reports CPU by every render-side system.** `GameLoop.renderPass` calls
  `registry.runFrame(rc)` **before** `hooks.render`, and `hooks.render` is where
  `debug.beginFrame()` starts the stopwatch. So the RenderBridge instance uploads, VFX, the ore
  instancer, the fog blit and the HUD all run outside the engine's own CPU window. Measured paired
  per frame: 2.70 ms reported against 3.55 ms actual, i.e. **24% of render CPU is invisible to the
  counter this section named as the CPU instrument**. It does not change the verdict — the true
  figure is still an eighth of the GPU — but nothing should be quoted off `stats().cpuMs` until it
  brackets the whole of `renderPass`.
- **Three silent defects in `tools/gpu-profile.mjs` itself**, all fixed, all documented in that
  file's header: minified pass names made the per-pass table unmappable in the only build it runs
  against; the shadow probe reported exactly 0.00 ms because `WebGLShadowMap.render` is entered 22
  times per frame and 21 of those early-out on an empty `shadowsArray`; and the readiness gate
  (`drawCalls > 8`) was satisfied by an empty world, which draws 23.

### 1.6 The decision rule, resolved

| finding | what it means | |
|---|---|---|
| `cpuMs` ≈ `frameMs`, GPU idle | CPU-bound. WebGPU's draw-submission win is real. | ✗ |
| GPU ≫ CPU, post chain dominant | Fill-rate bound. WebGPU changes nothing. | ✗ (post is 34%) |
| **GPU ≫ CPU, colour pass dominant** | **Shader/overdraw bound. WebGPU changes nothing.** | **✓ 8.4x, colour 66%** |
| Neither dominates; frame is fine | No performance problem; migration is a maintenance call. | ✗ |

The colour pass dominates AND its cost is pixel-proportional, so rows 2 and 3 are not really
alternatives here: the ground shader is expensive **per pixel**, over 60-75% of the frame. Both rows
reach the same instruction, which is the instruction in §2.

**THE ONE CAVEAT, STATED PLAINLY.** This is an integrated Radeon. A discrete GPU would cut the GPU
side and leave the CPU side where it is, narrowing the ratio — but 8.4x is an enormous margin to
close, and the *slope* (r2 0.995-1.000 against pixel count) is a property of what this frame draws,
not of the device it drew on. A discrete-GPU re-run is worth having before a large spend; it is not
worth waiting for before believing this.

**§3 onward is not justified by performance.** Three of the four rows said the migration does not
help, and the measurement landed on one of them.

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
4. ~~**Shadow pass is 29-59 draws — a third to a half of the colour pass.**~~ **CLOSED BY §1.**
   Draw calls are not what it costs: the shadow map measures **0.99 ms of a 29.83 ms frame**, and
   disabling shadows entirely saves **0.69 ms** while removing 43 draws. It is 2% of the GPU. There
   is nothing here worth the risk of touching the `castShadow` gate.
5. ~~**Post chain cost is unmeasured.**~~ **MEASURED: 10.12 ms, 34% of the frame** (`post-off`
   ablation). Ordered: GTAO 4.97, bloom 3.32, SMAA 2.78, grade 0.54. **Half-res AO is already
   shipped and is already the biggest saving in the chain** — running AO at full resolution costs
   **+11.48 ms**, more than bloom, SMAA and the grade put together. The remaining cheap win is the
   bloom mip chain; the expensive-but-real one is the colour pass, which is the other 66%.
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

## 6. WHAT I RECOMMEND — **PHASE 0 IS DONE; THIS IS NOW THE ANSWER, NOT THE PLAN**

This section used to say: run Phase 0, and if it comes back "fill-rate bound" the migration would
cost weeks and raise nothing. **It came back fill-rate bound.** GPU 29.83 ms against CPU 3.55 ms at
194 units and 1440p, 79-90% of it proportional to pixel count.

So, in order:

1. **Do not start §3.** There is no draw-submission cost to remove. The colour pass draws 68 times
   and takes 19.7 ms doing it; that is 290 microseconds of GPU per draw call, which is a statement
   about the shader, not about submission overhead.
2. **The frame rate lever is resolution, and it is already built.** 60 fps arrives at render scale
   **0.694** on this machine. §2 item 1 — confirm `AdaptiveResolution` is enabled, tuned, and
   actually engaging — is now the single highest-value item in this document, and it is free.
3. **Then the colour pass**, which is 66% of the frame and is expensive *per pixel* over the 60-75%
   of the screen that is ground. That is `TerrainMaterial.ts`, and it is the same file
   `RENDER_FINDINGS.md` §3 identifies as the largest visual gap. Cost and look point at one shader.
4. **§2 item 2 (no LOD system) is worth re-costing downward.** Triangles are not what is expensive
   here: 1.01 M triangles at 194 units cost 3.55 ms of CPU and a GPU time that barely moves with
   content. An impostor system would save vertex work the frame is not spending.
5. **Stage A remains worth a few days if and only if the justification changes.** A discrete-GPU
   re-run is the one measurement that could move this, and it is cheap: same command, other machine.

If the migration happens, let it be for maintenance, for TSL, or for a platform reason — and say so
out loud. **It must not be sold as a frame-rate fix**, because the frame rate has now been measured
and this is not where it went.
