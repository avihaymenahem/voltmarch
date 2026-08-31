# Batches 9-10: frame graph and visual depth

Status: implemented and measured on local `main`
Date: 2026-08-31
Baseline commit: `299f04fb70c34b0301423cc6f7e8354acf1e24ec`

This report is the durable delivery record for the roadmap's ninth and tenth bounded passes. Raw
benchmark JSON and captures are under ignored `.turbo/batch9-evidence/`, `.turbo/batch10-visual/`
and `.turbo/batch10-*.json`; the commands, browser version, requested arm, scene, seed, source status,
tracked-plus-untracked source SHA-256 and built JS/CSS SHA-256 are embedded in newly generated reports.

## Executive result

- Batch 9 removes a redundant full-resolution HDR/AO dependency evaluation on native WebGPU by
  reusing the already materialised bloom input for grade composition. At 1080p/1440p/4K, median GPU
  time improves 6.96%/8.25%/13.57%. Four AO-accounted draws disappear, no program or render target
  is added, and `?postreuse=legacy` restores the old graph in the same build.
- Batch 10 replaces generic random base grime with deterministic building-role, biome, service-side
  and egress-aware wear. It uses the existing static decal draw/material/atlas, caps contextual wear
  at 48 marks and never consumes the decal pool's protected final 128 static slots. The measured
  Allied fixture accepts 14 contextual marks instead of 41 legacy marks, leaving 318 rather than
  291 slots.
- Both changes follow transferable AAA production practice—explicit render-resource reuse and
  deterministic attribute-driven environment tools—without attempting to transplant Unreal's
  renderer scheduler, DBuffer decals or PCG runtime into Three.js.

## Industry transfer decision

| AAA practice | What transfers | What does not |
| --- | --- | --- |
| Unreal Render Dependency Graph | Declare the resource dependency, reuse the materialised HDR texture, retain graph inspection and same-build isolation. | RDG pass scheduling, transient aliasing, barriers and async command recording belong to Unreal's RHI, not Three's public WebGPU layer. |
| Three RenderPipeline / RTTNode | One output graph, explicit RTT materialisation, `NodeUpdateType.FRAME` when one texture must be produced once for all consumers in a frame. | Patching Three internals or inventing a second frame-graph abstraction before the public graph proves insufficient. |
| Unreal PCG / AAA environment tools | Stable seeds, point transforms/bounds, source attributes and deterministic filtering produce controlled variation. | A general runtime PCG graph, new DBuffer pass or per-building materials would be larger, slower and less deterministic than the existing decal pool. |
| Authored environmental storytelling | Marks answer how the structure is used: egress, service, runoff or perimeter. | Uniform global dirt/noise and unrelated random decals are rejected even when they add detail. |

Primary references:

- Unreal Render Dependency Graph: <https://dev.epicgames.com/documentation/en-us/unreal-engine/render-dependency-graph-in-unreal-engine>
- Three RenderPipeline: <https://threejs.org/docs/pages/RenderPipeline.html>
- Three RTTNode and its default per-render cadence: <https://threejs.org/docs/pages/RTTNode.html>
- Three NodeFrame update-cadence contract: <https://threejs.org/docs/pages/NodeFrame.html>
- Unreal PCG point attributes, bounds and seeds: <https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-overview>

## Batch 9 implementation

The legacy node graph constructed the lit HDR expression twice:

```text
lit = scene * AO + atmosphere
PostBloomInput = RTT(lit)
bloom = Bloom(PostBloomInput)
PostGradeInput = RTT(lit + bloom)
```

The grade-side `lit` evaluation recursively caused a second AO/depth-normal dependency traversal.
The new graph evaluates `PostBloomInput` once per frame, then samples that existing full-resolution
RGBA16F texture when adding bloom for grade:

```text
PostBloomInput = RTT(scene * AO + atmosphere), cadence FRAME
bloom = Bloom(PostBloomInput)
PostGradeInput = RTT(PostBloomInput + bloom)
```

Implementation and controls:

- `apps/game/src/render/post-nodes.ts` owns the resource reuse and rebuild-stable selection.
- `?postreuse=legacy` restores the prior expression graph. Default/`on` selects reuse.
- `apps/game/tests/post-nodes.spec.ts` freezes the query selection, FRAME/RENDER cadence and the
  compiled two-sample candidate versus five-sample legacy grade composite.
- `tools/gpu-frame-ab.mjs --gpu-passes --post-reuse on|legacy` separates wall blocks from timestamp
  instrumentation, primes and discards the cold timestamp group, then requires five fresh timer
  revisions.
- `tools/image-diff.mjs` reports mean RGB plus per-pixel max-channel percentiles for exact-size PNGs.

### Performance

Negative delta is faster. All GPU cells are native WebGPU on Chrome/Dawn 151 and NVIDIA Ampere.
1080p aggregates two fresh processes per arm; 1440p and 4K are one corrected pair per arm with five
primed GPU samples. Wall time is a block of fully submitted frames plus one amortised readback.

| Render buffer | Candidate vs legacy GPU median | GPU p95 | Wall median | Wall p95 |
| --- | ---: | ---: | ---: | ---: |
| 1920x1080 | 3.5062 vs 3.7683 ms, **-6.96%** | 3.6045 vs 3.9322 ms, **-8.33%** | 1.8808 vs 2.0133 ms, **-6.58%** | 2.0900 vs 2.1967 ms, **-4.86%** |
| 2560x1440 | 5.8327 vs 6.3570 ms, **-8.25%** | 6.0293 vs 6.5536 ms, **-8.00%** | 2.1933 vs 2.1783 ms, **+0.69%** | 2.2833 vs 2.2733 ms, **+0.44%** |
| 3840x2160 | 11.2722 vs 13.0417 ms, **-13.57%** | 11.4688 vs 13.2383 ms, **-13.37%** | 5.5400 vs 5.4400 ms, **+1.84%** | 5.8467 vs 6.1778 ms, **-5.36%** |

Structural counters are resolution-independent:

| Counter | Legacy | Reuse | Delta |
| --- | ---: | ---: | ---: |
| Total draws | 149 | 145 | -4 (-2.68%) |
| AO-accounted draws | 8 | 4 | -4 (-50.0%) |
| Programs | 307 | 307 | 0 |
| Triangles | control | control - 4 | four removed full-screen triangles; scene geometry unchanged |

Per-pass labels remain approximate because nested/unnamed Three contexts can land in a neighbouring
bucket and some grade samples are null. Total timestamp, structural draw count and wall results—not
an asserted grade-bucket saving—control the decision.

### Visual and temporal gate

The first image artifact was correctly rejected as native-resolution evidence: it presented a
1440p render through a 1280x720 CSS viewport. The harness now uses one CSS pixel per requested render
pixel when capturing.

On the dynamic `battle` fixture at native 2560x1440:

- two fresh candidate processes are byte-identical: every delta is zero;
- candidate versus legacy mean RGB delta is 0.00173/255;
- p99 max-channel delta is 0;
- two pixels exceed 8/255 (`0.000054%` of 3,686,400 pixels), with maximum 18;
- changed pixels are 0.5063%, primarily half-float materialisation/rounding around high-frequency
  content; there is no structured hot region or observed one-frame bloom lag in the dynamic frame.

The mean/p99/structure gate passes and the result is visually indistinguishable at player scale. A
literal maximum-delta <=2 gate does not pass because of those two isolated pixels. The optimization
therefore ships with its legacy rollback retained and a cross-device/native-Electron follow-up; the
report does not claim representative-device closure.

### Independent review

The required fresh reviewer returned **approve with caveats**. It confirmed the structural graph,
draw reduction and corrected GPU numbers, found the invalid 720p presentation label, requested the
native same-arm/dynamic repeat above, and limited the current claim to one Chrome/Dawn/NVIDIA device.
AMD, Intel/iGPU and packaged Electron WebGPU remain open validation cells.

## Batch 10 implementation

`apps/game/src/world/structure-wear.ts` is a renderer-free pure planner. Each live structure is
described by stable identity, key, pose, footprint, exit offset and definition semantics. The planner:

1. classifies economy, production, command, power, defence and utility roles;
2. derives a stable source-local seed, independent of entity enumeration order;
3. places primary causes round-robin before any structure receives secondary dressing;
4. aligns production/economy marks with local +Z exits, maintenance marks with structure sides,
   runoff with power structures and weathering with defensive perimeters;
5. selects restrained dust/grime/rust/oil response by biome;
6. emits one descriptor list and fingerprint consumed identically by WebGL and WebGPU.

`scatter.system.ts` clamps the descriptors to the map and conservatively rejects every water, cliff
or occupied terrain cell intersecting each oriented rectangle, not only the mark centre. Planner
clearance also keeps each full rectangle beyond its source footprint.
It does not change the placement fingerprint, entity store, save schema or authoritative simulation.
All marks use the existing static `DecalField`, so no draw, material, texture, shader program or
render target is introduced. `?basewear=legacy|off` provides exact old-recipe and disabled controls;
context is the default.

The runtime cap is:

```text
min(48, max(0, 384 static slots - 128 combat reserve - existing live marks))
```

### Measured scene impact

The fixed Allied-base seed-7 fixture reports:

| Counter | Legacy | Context | Delta |
| --- | ---: | ---: | ---: |
| Live structure-wear marks | 41 | 14 | -27 (-65.85%) |
| Maximum recipe budget | 112 | 48 | -64 (-57.14%) |
| Static decal slots remaining after boot composition | 291 | 318 | +27 (+9.28%) |
| Total draws | 145 | 145 | 0 |
| Programs | 307 | 307 | 0 |
| Submitted triangles | 1,343,733 | 1,343,733 | 0 |
| WebGL/WebGPU accepted-mark fingerprint | n/a | 3011252098 / 3011252098 | exact parity |

The fixed decal mesh submits its bounded index range in either arm; fewer legal marks primarily
reduce covered/shaded pixels and pool pressure rather than renderer triangle counters.

The final same-source, same-build 1920x1080 pair used five primed native-WebGPU samples and five wall
blocks per arm:

| Metric | Legacy | Context | Delta |
| --- | ---: | ---: | ---: |
| GPU median | 3.407872 ms | 3.407872 ms | 0.00% |
| GPU p95 | 3.604480 ms | 3.604480 ms | 0.00% |
| Wall median | 2.040000 ms | 2.040000 ms | 0.00% |
| Highest wall block | 2.088889 ms | 2.120000 ms | +0.031111 ms (+1.49%) |

An earlier pre-fix exploratory ABBA run had contradictory wall and timestamp directions and was
discarded after review required the command-role and full-footprint legality corrections. The final
pair, identical renderer counters and exact GPU medians support **runtime parity**, not a frame-time
improvement claim. Representative-device and packaged-Electron cells remain part of the next
validation round.

The final native 1920x1080 context/legacy image A/B intentionally changes composition: 17.6302% of
pixels move, 2.1451% exceed 8/255, mean RGB delta is 0.6117/255, p95 is 5, p99 is 13 and maximum is
70. Manual review accepts the restrained result: exits and service sides read as used ground while
isolated generic blotches are removed, with no visible footprint/water/cliff overlap. This is an art
comparison, not an equivalence test, and still covers only one Allied temperate daytime composition.

This batch is deliberately initial-base dressing. It runs once during scatter initialization;
post-start player construction is not persisted or regenerated as contextual wear in this slice.

### Independent review

The first anonymous pass rejected promotion because real command yards were classified as production,
evidence did not fingerprint dirty source/built output, and only decal centres were terrain-checked.
Those findings produced the command-before-production semantic rule, real conyard/Conclave/Foundry
tests, reproducible source/build hashes, conservative full-rectangle footprint clearance and oriented
cell legality. Fresh performance, backend-parity and native visual evidence was then returned for a
second pass. The final verdict is **approve with documented caveats**. The reviewer independently
confirmed 14/36 accepted descriptors, fingerprint 3011252098, 318 free slots, exact WebGL/WebGPU
parity, exact paired GPU/wall medians and restrained legal placement.

The accepted scope is visual depth and pool headroom, not frame-time optimization. It covers one
Chrome/Dawn/NVIDIA performance cell and one Allied temperate daytime visual composition. Other
factions, biomes, lighting, AMD, Intel/iGPU and packaged Electron remain follow-up QA. A future
dynamic rollout would also need a policy for legal retry positions: conservative validation rejects
22 of 36 planned descriptors in this fixture.

## Verification

- Focused Vitest: 71/71 passing (`post-nodes` plus `structure-wear`).
- Game TypeScript: all source, Node-tool and test configurations pass.
- Fresh production game build: passes.
- Native WebGPU runtime: default and rollback graphs compile and render at 1080p, 1440p and 4K.
- WebGL/WebGPU contextual descriptor fingerprint: exact match.
- Full repository gate: 20/20 tasks successful; 318 test files passed and four skipped; 7,094 tests
  passed and seven skipped.

## Next actions, in priority order

1. **Close representative-device validation.** Repeat Batch 9 native 1440p dynamic visual and
   timestamp cells on AMD and Intel/iGPU plus packaged Electron WebGPU. Keep `?postreuse=legacy`
   until this matrix is stable; investigate the two isolated >8/255 pixels only if they reproduce.
2. **Start Batch 11 with `@voltmarch/gltf-runtime`.** The Game and Asset Lab are real consumers.
   Extract only renderer-injected GLTF/Meshopt/KTX2 lifecycle seams, keep one exact Three peer, and
   record pre/post production chunk count, byte shape, asset readiness and fallback equality.
3. **Run the WebGPU pipeline retention soak.** Exercise VFX, LOD, construction and weather through
   10-20 same-process matches/settings transitions; require zero unexpected post-reveal pipelines
   and plateauing renderer RSS before changing cache retention.
4. **Continue visual depth with cause-linked templates.** Depot clutter, wreck/scorch/debris and
   resource gravel/shards may reuse this deterministic planner pattern only when each stays batched
   and measured. Do not add another global noise layer.
5. **Retain current rejections.** GPU foliage compaction, Meshopt default rollout and temporal
   reconstruction remain lab-only until their existing whole-frame/readability gates pass.
