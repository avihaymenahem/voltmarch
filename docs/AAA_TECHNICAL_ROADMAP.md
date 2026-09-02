# AAA technical roadmap

Status: active implementation plan
Baseline: `origin/main` at `902020e6`
Research completed: 2026-08-30
Next active seam: Batch 12 — narrow audio runtime extraction
Implementation branch: local `main` (the temporary roadmap worktree has been retired)

This document turns the performance, graphics, worker/WASM and package-boundary audit into one
dependency-ordered delivery plan. Every workstream was checked against the current code and public
primary material from Unreal, Unity, Khronos, Web standards, GPU vendors and published studio talks.
Each audit then received one independent challenge review for validity and likely impact.

The central conclusion is that VOLTMARCH should adopt AAA production disciplines, not attempt to
copy native AAA features wholesale. The high-return path is measured startup, cooked and
dependency-addressable content, complete LOD/fallback contracts, render-only GPU-driven work and
narrow one-way module boundaries. Nanite, Lumen, virtual shadow maps, DirectStorage, an engine-wide
native job system and an authoritative GPU simulation do not fit the current Three/WebGPU/Electron
stack.

## Evidence that controls the order

- The image-first menu and engine dynamic boundary are already successful. Menu interactivity has
  measured roughly 0.35-0.60 seconds on the primary desktop; package moves alone will not improve it.
- The former decorative title battlefield was scheduled after a 12-second quiet period. Once its
  boot began, a real match had to wait for it. That put player intent behind disposable work and is
  removed by Batch 2.
- Imported GLTF parse/publication after reveal produced 150-270 ms visible freezes. The diagnostic
  streamed path is not a safe shipping shortcut.
- Runtime import still applies invariant transformations such as matrix baking, attribute promotion,
  normal/bounds work and delivery conditioning. Removing this work through an offline cook is more
  valuable than moving only byte decode to another thread.
- The current renderer is commonly pixel/fill-rate bound. One integrated-GPU sweep fit GPU time to
  rendered megapixels with `r^2 = 0.995`; CPU and simulation did not own that frame.
- Foliage loads and validates LOD0/1/2/shadow deliveries, but ordinary runtime resolution still
  selects LOD0. CPU camera-band selection is the required reference before compute compaction.
- Project workers already use coarse typed-array jobs, transfer-owned output and deterministic
  fallback. The shared KTX2 loader already owns a bounded two-worker transcoder pool.
- Four-army vision has measured about 2.35 ms at 30 Hz, roughly 7% of one simulation tick. That is
  not evidence for a full simulation-worker redesign.
- Workspace packages are ownership and build boundaries. They change boot only when the import
  graph, side effects or lazy chunks also change.

## Acceptance matrix

All performance claims use the same matrix unless a narrower experiment is explicitly recorded:

| Axis | Required cases |
| --- | --- |
| Runtime | browser WebGPU, browser WebGL fallback, packaged Electron WebGPU |
| Match | fixed two-army and four-army fixtures |
| Process state | five genuinely cold launches and five named warm-state launches |
| Resolution | 1920x1080, 2560x1440 and 3840x2160 where the adapter supports them |
| Boot | navigation, menu interactive, curtain start/end, `game.ready`, first stable submitted frame |
| CPU | phase durations, p50/p95, maximum long task, first-playable main-thread slices |
| GPU | pass timestamps, pipeline/program counts, upload/compile intervals, adapter and renderer |
| Memory | fetched bytes, decoded estimates, renderer counters, process RSS where available |
| Visual | noon and dusk/night; close, normal RTS and far; stationary and moving camera |

`Cold` means a fresh process/profile/cache. A warm report must name which of HTTP cache, decoded
assets, process-owned Three resources and WebGPU pipeline state survived. Headless Chromium is a
development signal, not final authority for Electron WebGPU.

## Ordered batches

```text
Baseline and phase telemetry
|- cold title-boot correction
|- cooked asset proof -> generated dependency closure -> safe deferred loading
|- CPU foliage LOD -> WebGPU compute compaction -> temporal reconstruction
|- GPU pass attribution -> post/shadow/environment decisions
`- internal dependency rules -> narrow packages -> possible WASM ABI
```

| Order | Batch | Acceptance |
| ---: | --- | --- |
| 1 | Current baseline and phase instrumentation | Repeatable matrix and machine-readable phase/long-task evidence exist. |
| 2 | Cold title battlefield policy | A cold process stays key-art-first and a real match cannot wait for or race disposable scene boot. |
| 3 | Cooked runtime asset-family proof | One complete family demonstrates lower publication work with exact delivery and fallback parity. |
| 4 | Foliage Gate 3/4 | Camera-band LOD, wind/depth parity, KTX2 family atlas and dense/save acceptance pass. |
| 5 | Dependency architecture Stage 0 | Internal layer/cycle rules and domain config slices preserve bundles and determinism. |
| 6 | Generated content dependency closure | All immediately reachable match content is ready before reveal; misses trip in development. |
| 7 | Compression and pipeline gates | Terrain-mask format, Meshopt family and pipeline-variant experiments have packaged evidence. |
| 8 | GPU-driven foliage pilot | Correctness/rollback infrastructure retained; promotion rejected after dense-frame regressions. |
| 9 | GPU/frame-graph optimization | Timestamp-led pass changes retain image quality and readability. |
| 10 | AAA visual-depth pass | Environment states, contextual composition, material consistency, then measured shadow/temporal pilots. |
| 11 | Narrow package extraction | Shared GLTF, audio and generation boundaries have real consumers and preserve lazy chunks. |
| 12 | Conditional WASM/simulation work | A specific kernel is a top bottleneck and beats startup/marshalling end to end. |

### AAA practice mapped to this stack

| Native-engine discipline | What the industry gets from it | VOLTMARCH adaptation |
| --- | --- | --- |
| Asset Manager / addressable dependency closure | A loading screen knows the complete content set before play and can stream lower-priority content later. | Generate the reachable match closure from faction, scenario, replay and effect registries; reject post-reveal misses in development. Do not treat a Vite chunk name as an asset contract. |
| Authored LOD/HLOD and independent caster meshes | Stable silhouettes spend geometry by screen value while shadows use cheaper topology. | Keep CPU chunk culling and stable camera-band buckets as the WebGL/reference policy; use a separate shadow-only proxy and later make WebGPU compaction reproduce the same decision. |
| Cooked texture/mesh delivery | Offline, versioned work replaces repeated runtime conditioning and provides deterministic size/quality gates. | Promote only deterministic KTX2/Meshopt/cooked outputs that improve total readiness, retain source hashes and keep a tested fallback. The rejected Chrono Miner cook remains the counterexample. |
| PSO/shader precaching | Expected material variants compile behind a controlled loading boundary instead of hitching on first use. | Continue awaited renderer preparation under the curtain, measure actual variants, and canonicalize only proven duplicates. Browser caches are evidence axes, not assumptions. |
| Job systems with explicit ownership | Coarse jobs run over stable data layouts without ad-hoc shared mutation. | Retain typed-array worker protocols, transfer-owned results and deterministic JS fallback. Add permits only after simultaneous worker pressure is measured on 2/4/8-core targets. |
| Engine modules / assembly definitions | One-way ownership and constrained public APIs keep iteration and build graphs reviewable. | Freeze today’s honest app graph first, shrink its SCCs, then extract only seams with two real consumers. Do not create generic `core` or `engine` packages around existing cycles. |
| GPU-driven visibility and indirect submission | Render-owned instance selection avoids CPU submission scaling in dense scenes. | Batch 8 may upload immutable prop data once and compact visibility/LOD on WebGPU with no readback. Placement, destruction and save identity remain CPU authoritative. |
| Virtualized geometry, Lumen and virtual shadow maps | Native engines combine platform-specific streaming, residency, temporal reconstruction and renderer integration. | Do not clone them in Three.js. Use bounded LODs, measured contact/SSGI, stable fitted shadows and later temporal pilots with motion/reactive masks. |

## Implementation checkpoint - 2026-08-31

The first eleven batches have completed their bounded implementation/decision pass on local `main`:

1. **Baseline and telemetry: complete.** `?bootprofile=1` now exports bounded marks, spans,
   Resource/Navigation Timing, Long Tasks and browser/custom-protocol evidence through
   `window.__VM.hooks.bootReport()`. `npm run profile:boot` writes schema-3 raw samples plus an
   explicitly named first-page/cache-warm summary. Five-run two-/four-army WebGL and native-WebGPU
   browser cells plus five fresh Electron/WebGPU processes are recorded. Browser WebGPU cache-warm
   ready p50 was 23.20 s (two armies) and 29.94 s (four). The pinned fresh-process Electron
   fixture measured 27.26 s renderer-relative and 28.24 s process-to-curtain-hidden p50.
   These are diagnostic-host baselines, not target-hardware promises. See `docs/BOOT_BASELINE.md`.
2. **Title policy: complete.** Every title visit is key-art-first and performs only a one-second,
   read-only module prefetch. No title path calls decorative `Bootstrap`, cold or warm, so a real
   launch cannot wait for or race a throwaway world. A future live backdrop requires a dedicated
   lightweight scene that never owns simulation context.
3. **Cooked family proof: complete and rejected for promotion.** The Chrono Miner cook passed its
   deterministic structural checks and removed
   about 263 ms of warm conditioning but grew the family by 2,593,352 bytes (71.03%) and worsened
   the complete request window by 226.20 ms. The runtime route and shipping outputs were rolled
   back; source/control/procedural fallbacks remain. Its current decision is recorded in
   `docs/PROJECT_STATE.md`.
4. **Foliage Gate 3/4: complete for the broadleaf CPU pilot; catalogue rollout remains gated.** World reveal no longer awaits the
   imported catalogue: deterministic procedural geometry is placed immediately and the same
   placement/felling mask is promoted after the renderer-configured shared KTX2/GLTF load. Missing
   LODs alias the nearest valid packaged rung; a missing visible family keeps the procedural
   presentation. Broadleaf colour uses three stable camera-band buckets, while one independent
   proxy owns shadows. WebGL and WebGPU colour/depth wind share the authored deformation contract.
   At the normal 1920x1080 seed-7 fixture, 368 visible props are identical while colour triangles
   fall 449,980 -> 94,076 (-79.1%) and shadow triangles 400,904 -> 51,498 (-87.2%); colour draws
   rise by exactly two and shadow draws do not change. A final 20 x 60-frame dense bracket improves
   flushed within-backend wall medians 34.61 -> 32.85 ms on WebGL and 1.625 -> 1.580 ms on WebGPU;
   deterministic bootstrap 95% upper bounds are -4.82% and +0.05%, below the +3% regression limit.
   The deterministic KTX2 atlas is 517,476 bytes versus 585,055 source
   bytes and reduces the conservative mip-residency estimate 8,388,604 -> 2,097,151 bytes. Exact
   measurements, raw reports and 12 tree-focused noon/dusk cross-backend captures are stored with
   the asset review. They also expose far-range card groupings and dusk-readability defects in other
   families; completion here does not approve the remaining catalogue.
5. **Dependency architecture Stage 0: complete.** Eight workspace packages are cycle-free. The
   app scanner resolves static imports, type imports, dynamic imports and Vite eager/lazy globs;
   its honest baseline currently contains 1,305 cross-layer edges, 1,824 runtime edges, 430
   type-only edges and five known file SCCs. SCCs may shrink or disappear but cannot gain members or
   merge. The former 8,513-line `core/config.ts` is now a 31-line compatibility facade over 24
   acyclic domain slices. Tests freeze all 534 TypeScript exports (523 values, 11 types), runtime
   referential identity and SHA-256 of the canonical value graph. An isolated production-build A/B
   retained 16 JS chunks and every logical boundary; gzip rose 1,703 bytes (0.0998%). The tracked
   control is `docs/reviews/config-stage0-bundle-shape.json`.
6. **Generated content dependency closure: complete.** The shell now derives semantic match roots
   from the resolved scenario, occupied faction union, map/naval policy, replay header and every
   armed campaign trigger branch. Art providers publish only after complete procedural roster or
   geometry registration succeeds; authored LOD0 promotion cannot overstate LOD/shadow/construction
   readiness. The pre-reveal RenderBridge pass turns any missing positive-def binding into an exact
   critical miss even when a generic faction mesh remains available for rendering, and each art
   provider proves its complete promised definition/faction set. Any later undeclared/not-ready
   request throws in development while packaged fallbacks remain available in production. Campaign
   and replay parsing have explicit validation latches that are republished only after Bootstrap
   opens the fresh runtime epoch, stale asynchronous completions are epoch-guarded, and
   registered-but-unbaked SFX now
   share one bake and preserve accepted first-use events. A production four-army MCV fixture proved
   565 semantic deliveries with zero misses before `game.ready`. Focused closure/audio tests,
   typecheck, production build and the cross-cutting monorepo gate (7,003 passing game tests) cover
   the implementation.
7. **Compression and pipeline gates: complete; one promotion and one measured rejection.** The
   universal 4096x4096 linear terrain mask now ships as a deterministic 13-mip ETC1S KTX2 through
   the existing shared two-worker transcoder. Transfer falls 11,489,212 -> 3,297,082 bytes
   (-71.30%); full-mip BC1/ETC target residency is 11,184,824 bytes instead of an 89,478,484-byte
   RGBA8 allocation (-87.50%) when adapter block compression is available. Five fresh Electron
   processes measured renderer-ready p50/p95
   26.617/28.507 s versus 26.868/28.534 s for PNG, and process-to-curtain p50/p95
   27.841/29.690 s versus 28.073/29.679 s: no material packaged boot regression. A deterministic
   six-file Allied Meshopt arm saves 11,228,312 bytes (-43.34%) and preserves hierarchy, materials,
   triangles, textures and all 587,639 compared positions within the recorded quantization bound,
   but family-ready p95 regressed 3.81% on WebGL and 3.27% on WebGPU instead of improving by the
   required 10%; the source GLBs remain the default. Opt-in `?pipelineprofile=1` attribution shows
   that the WebGPU compile span mixes node building and GPU pipeline promises: the stable fixture
   observed 69 node calls (56 misses), 90 pipeline lookups, 74 new pipelines and 53 GPU promises.
   A separate first-paint-submit span captures the substantial work after compile without claiming
   a GPU-completion fence. See `docs/reviews/batch7-compression-pipeline-gates.md`.
8. **GPU-driven foliage pilot: implemented, validated and rejected as the default.** A dynamically
   loaded native-WebGPU controller uploads 1,648 tree/bush records with immutable render columns and
   mutable live flags, then uses one indirect-
   count reset and one per-type/per-chunk compaction dispatch to write six colour/LOD/shadow streams.
   CPU placement, 256 broad-phase chunk AABB tests, clearing, crushing, saves and felled masks remain
   authoritative; there is no steady readback, and WebGL/temporal modes retain CPU compaction. Five
   approach/recede samples match CPU stable IDs and LODs exactly, with zero duplicates/invalid IDs;
   a live clear preserves fingerprint/storage and parity. The 0.560 MiB pilot cuts CPU upload p95
   110,628 -> 61,036 bytes (-44.83%), but corrected all-family event p95 regresses 0.20 -> 0.30 ms
   (+50%). It also fails the whole-frame gate decisively: static wall/frame is +27.27% and moving
   wall/frame +11.42%, with both 95% intervals entirely above zero. CPU remains default; the bounded
   path survives only behind
   `?gpu=webgpu&foliagecompute=gpu`. See
   `docs/reviews/batch8-webgpu-foliage-compute.md`.
9. **GPU/frame-graph optimization: implemented and promoted with rollback.** Native WebGPU now
   materialises the full-resolution HDR bloom input once per frame and reuses it for grade
   composition instead of recursively evaluating scene/AO/atmosphere twice. Draws fall 149 -> 145
   and AO-accounted draws 8 -> 4 with no new program or render target. Median GPU time improves
   6.96% at 1080p, 8.25% at 1440p and 13.57% at 4K on the measured NVIDIA Ampere cell. A native
   2560x1440 dynamic comparison is byte-stable across repeated candidate processes and has
   0.00173/255 mean candidate/control delta; two isolated pixels reach delta 18, so AMD, Intel and
   packaged-Electron validation remains open. `?postreuse=legacy` restores the old graph.
10. **AAA visual-depth pass: implemented for contextual structure wear.** Generic random building
    grime is replaced by deterministic biome/role/exit-aligned service, egress, runoff and perimeter
    descriptors consumed identically by WebGL and WebGPU. The measured fixture accepts 14 marks
    instead of 41, leaves 318 rather than 291 static-decal slots, and changes no draw, program or
    submitted-triangle counter. Final same-source native-WebGPU and wall medians are exact ties;
    this is runtime parity, not a speed claim. The path adds no material or texture, never consumes
    the protected final 128 of 384 static slots, and retains
    `?basewear=legacy|off`. Exact evidence is in
    `docs/reviews/batch9-10-framegraph-visual-depth.md`.
11. **Shared GLTF runtime seam: extracted with runtime parity.** Game and Asset Lab now consume the
    narrow `@voltmarch/gltf-runtime/gltf` and `/ktx2` subpaths while Game keeps telemetry and content
    policy local. One exact Three 0.185.1 peer, matching Meshopt decoder, renderer-first KTX2 support
    detection and a reference-counted two-worker pool are enforced by package and integration tests.
    Game and Asset Lab JS chunk counts are unchanged; compressed JS changes are +187 and +158 gzip
    bytes. Removing Asset Lab's redundant copied Basis directory cuts the deployment by 585,853
    bytes, while index/infantry critical transfer changes only +177/+23 bytes and KTX2 traffic is
    exact parity. Mixed timing cells are observational and support no boot-speed claim. See
    `docs/reviews/batch11-gltf-runtime-package.md`.

The next move is Batch 12's narrow `@voltmarch/audio-runtime` extraction shared by Game and the
browser audio probe, beginning by breaking the `AudioEngine`/`Samples` cycle. In parallel, close
Batch 9's AMD, Intel/iGPU and packaged-Electron validation cells. Batch 8 must not expand to neutral
props unless a redesigned or denser-scene arm wins whole-frame, and conditional WASM work remains
behind a measured top-kernel gate.

## Batch 1 - current baseline and phase instrumentation

Instrument the actual path rather than relying on decoder microbenchmarks. The first pass attributes
the seams exposed without patching Three or browser internals:

1. module and match boot;
2. Resource Timing or desktop custom-protocol response-open timing where observable;
3. aggregate GLTF request/parse/Meshopt/Three-scene readiness;
4. aggregate KTX2 loader/transcode and ordinary image-source readiness;
5. VOLTMARCH geometry/material conditioning;
6. registry publication and initialisation;
7. renderer/device preparation and awaited pipeline compilation;
8. curtain dismissal, `game.ready`, first stable submitted frame and post-reveal Long Tasks.

This does not claim distinct GLB JSON, Meshopt, Three-object, KTX2-worker-start or GPU-upload fences.
Those require upstream hooks or backend timestamp/upload instrumentation and remain later attribution
work if the aggregate phase becomes a measured limiter.

Required qualities:

- instrumentation is allocation-light and development/diagnostic oriented;
- boot logging remains compatible with Electron forwarding;
- observations carry run identity, renderer, adapter, process state, scenario and seated factions;
- measurements can be exported as machine-readable JSON without DevTools;
- the harness cannot divide one submitted frame by an arbitrary sample count;
- instrumentation cannot enter authoritative simulation or change tick order.

## Batch 2 - cold title battlefield policy

The static key art is the complete title experience. Engine module prefetch may remain cheap and
non-mutating, but a title path must not create a gameplay battlefield. Industry title scenes are
purpose-built, bounded presentations; they are not hidden full matches sharing global engine state.

Acceptance:

- fresh and returning title visits cannot start decorative `Bootstrap` work;
- the one-second read-only module prefetch remains cancellable and generation-guarded;
- opening a real match cancels queued prefetch and cannot await decorative boot;
- no title generation can publish or mutate global game context;
- return-to-menu disposal, music, loading curtain, browser and desktop behavior remain intact;
- focused source-contract tests lock the title/Bootstrap boundary, timer cancellation and
  generation guards; a later DOM-level fake-timer test should exercise repeated menu transitions.

## Batch 3 - cooked runtime asset-family proof

Select one representative imported family already approved on the baseline. Keep its canonical
source/control GLB and procedural fallback. Produce a deterministic, versioned runtime delivery that
precomputes only invariant work:

- coordinate and node transforms where gameplay articulation does not require the source hierarchy;
- indexed geometry and safe vertex consolidation;
- required float runtime attributes for WebGPU;
- reviewed normals/tangents;
- bounds, fit, sockets, articulation and part metadata;
- LOD and shadow-delivery metadata;
- material roles and KTX2/Meshopt requirements;
- source hash, cook version and measured budgets.

Runtime still owns material instances that depend on faction/biome/team state, GPU resources,
articulation transforms and registry publication.

Proof gate:

- deterministic re-cook produces byte-identical delivery and manifest;
- p95 main-thread publication is at least 50% lower on the proof family;
- end-to-end family readiness improves at least 10%, unless the report honestly rejects the runtime
  format as non-beneficial;
- no structural node, articulation, socket, bounds, material role, triangle, LOD, shadow-delivery or
  KTX2-contract drift; WebGL/WebGPU visual parity is required only if the transfer gate passes;
- source/control and procedural fallback remain selectable;
- no new paid generation or source overwrite occurs.

If the format cannot clear the gate, the batch still completes by recording the rejected proof and
keeping the original runtime path. A microbenchmark alone is not a promotion.

## Later performance and loading work

### Generated dependency closure - complete

Extend the existing occupied-faction boot plan. Include opening units/buildings, campaign and replay
triggers, reinforcements, construction states, wrecks, neutral props, effect pools, audio, LODs and
shadow proxies. Add a development miss tripwire and conservative packaged fallback. A manifest does
not itself remove parse cost and must be paired with cooked delivery before post-reveal loading can
return.

Implemented contract:

- semantic keys only; no Vite filename or chunk identity enters the plan;
- exact opening/transitive/campaign/replay roots wait on explicit providers and validation latches;
- procedural fallback state is published only after its runtime model/geometry registration exists;
- generic faction meshes remain packaged visual fallbacks but cannot satisfy a positive definition;
  every art-provider latch proves its full planned definition/faction binding set;
- authored promotion conservatively upgrades LOD0 only unless another part is independently proven;
- the first hazard fallback during the existing under-curtain render is a reveal failure, while a
  post-reveal development miss throws at the central RenderBridge lookup;
- background SFX preparation accepts registered first-use events, deduplicates concurrent bakes and
  flushes with the original deadline rather than silently dropping the sound;
- late asset/audio completion from a disposed battlefield cannot satisfy the next boot's closure.

This does not make the current runtime-import path cooked or cheap. Batch 7 proved that smaller
transport alone is insufficient: further Meshopt rollout requires a complete family-ready win.

### Texture and geometry compression

- The universal terrain mask is grayscale-identical across its three source channels and now ships
  as deterministic linear ETC1S KTX2 with 13 explicit mips. The PNG remains the canonical source and
  build-time control; exactly one arm enters a production bundle.
- Six Allied land/air Meshopt candidates are retained as deterministic lab assets, but source GLBs
  remain the shipping arm because complete family-ready p95 regressed on both renderers. Any revisit
  must measure the whole family and may test upstream worker decode without adding a second pool.

### WebGPU pipelines and frame graph

Keep under-curtain compilation. The opt-in observer now attributes node cache use, program/pipeline
creation and GPU pipeline promises by material family, while first-paint submission is timed
separately. The next pipeline decision requires a 10-20 same-process match/settings soak with zero
unexpected post-reveal pipelines and plateauing RSS. Do not add arbitrary eviction before Three
reference and GPU-completion behavior is understood.

Use per-pass timestamps at shipping resolutions. AO, bloom, grade materialization and antialiasing
are strong candidates because pixel scaling is proven, but draw/shadow/instancing submission still
matters in dense RTS scenes. Optimize the measured limiter, not a generic counter.

## Graphics toward AAA quality

1. Finish visible geometry and LOD correctness before buying more effects.
2. Complete foliage camera-band LOD, authored colour/depth wind parity, shared compressed atlas,
   dense-copse timings and clearing/save restoration.
3. Extend deterministic environmental composition with a few cause-linked templates: depot clutter,
   wreck/scorch/debris and resource gravel/shards. Avoid another global noise/decal layer.
4. Consolidate physical parameters and textures only inside compatible shader families. Do not merge
   opaque props, vehicles and alpha-tested wind foliage into one mega-material.
5. Provide bounded pre-baked noon/dusk/night/storm environment states. Runtime PMREM rebaking is
   forbidden after a measured roughly 90 ms hitch. Spatial probe volumes are a later experiment.
6. Treat improved shadows as a measured pilot. The current fitted, quantized, texel-snapped map is
   already stable; a second cascade may double caster submissions.
7. Graduate temporal reconstruction only after wind/pose/particle/water/construction motion,
   camera-cut reset, disocclusion and reactive handling pass moving-camera readability. Keep SMAA
   rollback.
8. Use environment lighting plus limited short-range SSGI/contact bounce. A Lumen clone is outside
   this roadmap.

## WebGPU compute, workers and WASM

The first compute candidate is render-only foliage visibility/LOD/indirect compaction. CPU owns
placement, destruction, clearing and save identity; upload immutable data once and never read
visibility back. The CPU Gate 3/4 path is the reference policy, not a second unrelated LOD system.

Keep current coarse typed-array workers, transfer-owned results, deterministic fallback, shared KTX2
pool and boot-worker teardown. Instrument simultaneous worker activity on 2/4/8-core targets before
adding a global permit system.

Reject for the active roadmap:

- authoritative GPU compute;
- a full simulation worker;
- SharedArrayBuffer/WASM pthreads as the browser/desktop baseline;
- renderer ownership in an OffscreenCanvas worker;
- custom audio decoder workers;
- per-entity WASM calls.

A SIMD WASM proof is justified only when a flat-array kernel is a measured top cost. Keep one coarse
call, module reuse, byte-exact JS fallback and end-to-end critical-path evidence. Vision remains
same-thread until it materially threatens the fixed-tick budget; if it does, same-thread batched WASM
is safer than wall-clock-dependent worker publication.

## Package extraction

Packages are not performance work unless they alter the emitted graph. Every proposed package needs
named consumers, one-way dependencies, explicit subpath exports, package-local tests, compatibility
facades and pre/post production chunk evidence.

### Stage 0

- Add package-cycle detection and an allowed internal game-layer graph.
- Split the 8,500-line `core/config.ts` into domain-owned app modules behind compatibility exports.
- Keep persisted literals, save/replay/protocol identity and bundle fingerprints unchanged.

### First justified packages

1. **Complete:** `@voltmarch/gltf-runtime` now owns the shared GLTF/Meshopt/KTX2 lifecycle for Game
   and Asset Lab behind explicit `/gltf` and `/ktx2` exports. It injects renderer, transcoder URL and
   worker limit, retains one exact Three peer and leaves geometry/content policy with callers. The
   extraction preserves runtime traffic and removes 585,853 deployed Asset Lab bytes; see
   `docs/reviews/batch11-gltf-runtime-package.md`.
2. **Next:** `@voltmarch/audio-runtime`: WebAudio lifecycle, buses and buffer utilities shared by
   the game and browser audio probe. First break the `AudioEngine`/`Samples` cycle. Keep game recipes,
   EVA, barks, music policy, positional adapter and `audio.system.ts` local. The pre-extraction
   runtime hardening is complete: one `AudioParamGuard` now owns every parameter value/automation
   write, repairs non-finite values/times before Web Audio can throw, and is enforced by a
   source-boundary test. Move that seam rather than duplicating it during extraction.
3. `@voltmarch/procedural-kernels`: pure surface, terrain and water typed-array kernels plus data
   protocol, shared by the worker, main-thread fallback and benchmark/visual tools. This is the
   natural future WASM ABI host.

### Conditional packages

- `campaign-contracts` only when an editor/tool becomes a real consumer;
- narrow render lifecycle/capability primitives after port inversion;
- a game-specific runtime package only when a headless validator, worker host, replay verifier or
  server becomes a second runtime consumer;
- simulation last, with complete checksum/replay/desync gates.

Do not create a generic `@voltmarch/core` or `@voltmarch/engine` from the current folders. That would
formalize cycles, invite an unbounded API and provide no inherent boot or FPS improvement.

## Primary industry references

- Unreal asset management and async loading:
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-management-in-unreal-engine>
- Unreal PSO precaching:
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/pso-precaching-for-unreal-engine>
- Unreal HLOD:
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/hierarchical-level-of-detail-in-unreal-engine>
- Unreal temporal super resolution:
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine>
- Unreal modules:
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-modules>
- Unity Job System:
  <https://docs.unity.cn/Manual/JobSystemOverview.html>
- Unity assembly definitions:
  <https://docs.unity3d.com/Manual/assembly-definitions-intro.html>
- Khronos KTX 2.0:
  <https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html>
- Khronos glTF Meshopt compression:
  <https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md>
- Web Audio:
  <https://www.w3.org/TR/webaudio-1.0/>

## Universal change gates

Every completed slice must run proportional focused tests, typecheck and a fresh production build.
Cross-cutting architecture changes run the full monorepo/release-equivalent gate. Asset work also
records before/after draw calls, triangles, transfer bytes, decoded texture memory, load/publication
time and WebGL/WebGPU visual evidence while retaining its validated procedural fallback.
