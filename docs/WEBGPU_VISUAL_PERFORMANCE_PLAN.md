# WebGPU visual performance plan

**Status:** active desktop direction, 2026-08-30.

VOLTMARCH desktop now treats WebGPU as the product renderer. New visual systems are designed and
accepted on the WebGPU desktop path first; WebGL compatibility work is maintenance for local
diagnostics, not a gate on the modern desktop image.

## What WebAssembly is for

WASM is a CPU tool. It can shorten loading and enlarge deterministic CPU budgets, but it cannot make
a fragment shader cheaper or replace WebGPU compute without copying GPU-owned data back through CPU
memory. The project should use it for coarse, typed-array-heavy jobs with few JS/WASM crossings.

1. **Already shipping — Basis/KTX2 transcode.** Imported texture decode runs through a bounded
   two-worker Emscripten/WASM pool. Keep this shared rather than starting a pool per asset family.
2. **Measured gate — Meshopt geometry decode.** The live Chrono Miner remains the one-asset proof.
   A deterministic six-file Allied land/air arm reduced 25,905,084 to 14,676,772 bytes (-43.34%)
   while retaining exact hierarchy, material, triangle, animation and KTX2 contracts. Complete
   family-ready p95 nevertheless regressed 3.81% on WebGL and 3.27% on native WebGPU instead of
   improving by the required 10%. Those six source GLBs remain the default and the candidates stay
   reproducible lab assets. A later rollout must beat the whole request/decode/scene-construction
   window; a decoder microbenchmark or byte saving is insufficient.
3. **Candidate — boot-time procedural kernels.** Terrain, water and procedural texture generation
   already run in workers and operate on typed arrays. A SIMD WASM port is worthwhile only after a
   measured kernel beats the current worker including module compile, copies and startup. Current
   boot evidence puts the world worker around 0.64 s while full readiness is roughly 8 s with private
   asset streaming, so geometry/texture I/O remains the larger first target.
4. **Later scale valve — authoritative vision.** Four-army `Vision.update()` measured about 2.35 ms
   at 30 Hz. Its age/stamp/compose loops fit SIMD, but it is only about 7% of one simulation tick and
   does not own frame time. Revisit when unit caps or visibility fidelity grow; keep one batched call
   over shared linear memory rather than calling WASM once per entity.
5. **Deterministic math.** A small WASM math kernel can provide bit-identical transcendental results
   if lockstep ever needs richer `sin`/`cos` terrain or simulation rules. This is a correctness tool,
   not a graphics feature.

Do not port UI, Three.js scene traversal, small object-oriented systems, or per-entity callbacks.
Boundary traffic and duplicate memory would erase the gain. Do not move authoritative simulation or
world generation onto GPU compute: cross-vendor floating point differences can desynchronise a
lockstep match.

## What belongs on WebGPU compute instead

Render-only parallel work should stay in GPU memory:

- foliage visibility, LOD selection, wind state and compacted instance lists;
- particles, debris, weather and decal lifecycle;
- temporal history rejection, exposure histograms and future upscaling support;
- render-only terrain masks, distant surface detail and optional Ultra-tier GI probes.

These are allowed to differ by a pixel across devices because they never feed gameplay state.

## Visual implementation order

1. **Temporal stability and reconstruction.** Add motion vectors and a conservative TAA/upscaling
   experiment behind an Ultra flag. This attacks foliage shimmer, subpixel troops, thin geometry and
   resolution cost together. Keep a sharpness/readability control and retain SMAA as rollback.
2. **GPU-driven foliage.** Move render-only culling/LOD compaction to compute, then spend the saved
   submission and overdraw budget on denser authored canopies, better wind hierarchy and longer
   transitions.
3. **Material and atmosphere upgrade.** Use restrained aerial perspective, physically coherent
   roughness/normal response, contact darkening and weather continuity. Do not hide weak assets under
   bloom or saturation.
4. **Lighting depth.** Keep the accepted High/Ultra SSGI defaults inside WebGPU timestamp and colour gates,
   then graduate SSR separately; favour stable indirect light and reflections before adding more direct lights.

### SSGI acceptance checkpoint

The first bounded candidate was rejected after live tactical review exposed reduced-resolution horizontal
rows, sampled ground colour contaminating faction materials, and long-range AO dulling the whole scene. The
corrected candidate is accepted for normal WebGPU play: High defaults to low SSGI and Ultra to medium SSGI.
It runs at 0.5 resolution with deterministic non-temporal denoise; incident radiance is multiplied by the
receiving scene colour to preserve faction hue, and long-range SSGI AO is blended at 0.18 of configured AO so
it reads as contact rather than a global grey wash. Low/medium/high `giIntensity` is 3.4/3.8/4.2. The retained
64×64 world-space irradiance field remains the stable off-screen indirect-light foundation.

On the same local NVIDIA Ampere WebGPU adapter at 2560×1440 D62, GTAO measured luma 0.34349849 and
saturation 0.45379077. Final SSGI measured luma 0.33946900 (-1.17%) and saturation 0.45375932 (-0.007%,
effectively identical). The final paired wall median moved from 4.336667 to 4.536667 ms (+4.61%, under the
10% gate). Direct GI measured 1.048576 ms against 0.589824 ms for GTAO AO, a +0.458752 ms marginal lighting
cost. Non-paired total GPU timestamps are clock-sensitive; the direct replaced-pass and paired wall deltas
are the acceptance evidence.

No worker or WASM path was added: ray marching and denoising are GPU-owned, and a CPU round trip would
increase copies and boot work. The earlier rejected candidate remains useful failure history, but its visual
decision and timing numbers are not the accepted product baseline.

### Temporal reconstruction checkpoint

The first real-device TRAA slice is available behind `?gpu=webgpu&aa=traa`; normal desktop boots
still use SMAA. It supplies per-object and per-instance motion through a dedicated velocity pass,
temporally rotates GTAO/SSGI samples, and resolves HDR before bloom and grading. A combined beauty
MRT was rejected because custom fragment and shadow materials do not all emit a velocity target;
the isolated override pass is valid on the NVIDIA Ampere WebGPU device and keeps those pipelines
independent.

At 1280×720 on the fixed Allied-base capture, three 30-frame blocks submitted 217 draws and about
2.78 million triangles with TRAA versus 147 draws and about 1.60 million with SMAA. Minimum observed
wall time rose from 1.867 ms to 2.063 ms while the medians were effectively tied at 2.177 ms and
2.163 ms; that short run is enough to expose the submission cost, not to claim a frame-time win.
The static TRAA capture is also visibly softer. Do not promote this configuration as the shipped
default.

The second lab arm, `?gpu=webgpu&aa=taau&taauScale=.75`, now renders scene colour, depth, velocity
and the pre-resolve HDR composite at the same reduced size, then resolves at the native drawing
buffer. It also reuses the grade's luma-only unsharp mask rather than adding another RGB sharpen
pass. The real-device gate passes. Against a fresh SMAA control at 1280×720, its three 30-frame
blocks measured 1.797 ms best / 1.910 ms median versus 2.020 ms best / 2.027 ms median for SMAA.
That is a promising 5.8–11.1% wall-time saving in this short run, despite the velocity submission,
but not enough samples to promote as a performance claim.

Image quality still fails the gate: 75% loses too much infantry and panel-line definition, and 85%
with scale-aware luma sharpening remains visibly softer than SMAA in the fixed Allied-base capture.
Both temporal modes therefore remain URL-gated lab paths. A production temporal mode needs a better
edge-aware reconstruction/sharpen stage and moving-camera ghosting scorecard; do not trade RTS
readability for a small frame-time gain.

### Cinematic atmosphere checkpoint

The first material/atmosphere slice now ships on Medium through Ultra desktop WebGPU. Depth is
reconstructed inside the existing HDR composite to apply slow world-locked cloud cover and a capped,
height-aware far-field haze. The cloud field is one deterministic 128x128 RGBA texture (64 KiB), uses
exactly two filtered reads, preserves HDR emissive peaks, excludes the sky depth, and refuses to lift
the black fog-of-war shroud. It creates no pass, render target or draw call; Low disables it.

Sparse airborne dust reuses the existing lit-particle draw and deterministic render-only sampling.
It emits only over currently visible, non-water cells around the camera focus, yields when the combat
smoke pool reaches 62%, is almost completely scrubbed by rain, and is disabled on Low and the legacy
renderer. At Ultra the steady-state budget is roughly 50-75 motes rather than a screen-space overlay.
This is deliberately depth/motion atmosphere, not a bloom or saturation disguise for weak assets.

The production build and a real NVIDIA Ampere WebGPU boot compiled and presented the default graph at
640x360 with 147 total draws; the atmosphere remained fused into the existing post accounting. That
short smoke run is a correctness gate, not a performance claim. Fixed-seed visual review at player
resolution remains the acceptance step for tuning cloud strength and haze distance.

### Compute-driven foliage checkpoint

Batch 8 implements and rejects default promotion of the bounded tree/bush compute pilot. The
dynamically loaded WebGPU controller uploads 1,648 chunk-sorted source records with immutable render
columns and mutable live flags, compacts
tree LOD0/1/2/shadow plus bush colour/shadow into storage-instanced streams, and writes six indexed-
indirect instance counts with a reset plus compaction dispatch. CPU placement, 256 chunk AABB tests,
clearing, crushing, save identity and felled masks remain authoritative; one 256-word broad-phase
visibility table and stable live-flag changes are the only event uploads into the pilot. There is no
steady-state readback. `foliageComputeAudit()` is an explicit harness-only readback seam.

Correctness passes at 24 -> 62 -> 116 -> 62 -> 24 m: all five GPU stable-ID/LOD sets match the CPU
reference exactly with zero duplicates or invalid/dead IDs. Clearing one visible pilot prop preserves
the placement fingerprint, storage allocation and immutable upload total and again matches the CPU.
Storage is 587,624 bytes (0.560 MiB) against a hard 4 MiB ceiling.

Performance does not pass promotion. Across two fresh CPU and two fresh compute processes in ABBA
order (40 x 60-frame blocks per arm, after 120 warmup frames), static wall/frame moves 2.038 ->
2.594 ms (+27.27%, bootstrap 95% interval [+9.27%, +67.65%]) and the deterministic moving-camera
fixture moves 1.730 -> 1.928 ms (+11.42%, [+4.22%, +19.22%]). After independent review corrected
the event scope to include the candidate's residual non-pilot CPU work, compaction-event p95 moves
0.20 -> 0.30 ms (+50%). CPU upload p95 still falls 110,628 -> 61,036 bytes (-44.83%), but lower
traffic does not repay dispatch/storage/fixed-command cost. Compute GPU timestamps were unavailable
on this Chrome/device cell, so no combined GPU-time claim is made.

CPU compaction is therefore the default. The pilot is retained only behind
`?gpu=webgpu&foliagecompute=gpu`; WebGL, WebGPU fallback, TRAA/TAAU and legacy scatter batching force
CPU. Do not expand to neutral props until a redesigned or denser-scene arm produces a material
whole-frame win. Exact evidence and the industry mapping are in
`docs/reviews/batch8-webgpu-foliage-compute.md`.

### Frame-graph and contextual-depth checkpoint

Batch 9 follows timestamp evidence instead of adding another post effect. Native WebGPU's existing
full-resolution half-float bloom input is now produced once per frame and reused when composing the
grade input. This removes the second recursive scene/AO dependency traversal: total draws move
149 -> 145, AO-accounted draws 8 -> 4 and programs remain 307. Median total GPU time improves
6.96% at 1080p, 8.25% at 1440p and 13.57% at 4K on the measured NVIDIA Ampere device. Native
2560x1440 dynamic captures are byte-stable between fresh candidate processes; candidate/control
mean RGB delta is 0.00173/255 and p99 is zero, with two isolated pixels at a maximum delta of 18.
The optimization is default-on with `?postreuse=legacy`; AMD, Intel/iGPU and packaged-Electron
validation remain required before removing that rollback.

Batch 10 spends no new pass or material on visual depth. A pure deterministic planner maps live
building definition attributes and local exits to economy/production/command/power/defence/utility
wear recipes, then both renderers consume the same descriptor fingerprint through the existing
static decal field. In the fixed Allied fixture, contextual wear accepts 14 legal marks versus 41
legacy marks, leaves 318 versus 291 pool slots and preserves all draw/program/submitted-triangle
counters. The final corrected fixture actually accepts 14 of 36 planned descriptors; full-rectangle
terrain legality rejects the remainder. Same-source timestamp and wall medians tie exactly, so the
batch claims runtime parity rather than a frame-time improvement. `?basewear=legacy|off` is retained.
Exact commands, captures, caveats and industry mapping are in
`docs/reviews/batch9-10-framegraph-visual-depth.md`.

Batch 11 extracts Game and Asset Lab's shared GLTF/Meshopt/KTX2 lifecycle into narrow package
subpaths without changing the visual graph. Game and Asset Lab chunk counts are unchanged, KTX2
traffic is exact parity and Asset Lab deployment falls 585,853 bytes after removing a redundant
Basis copy. Mixed readiness timings are observational, not a boot-speed claim. Exact architecture,
bundle and review evidence is in `docs/reviews/batch11-gltf-runtime-package.md`.

The next mainline slice is Batch 12's narrow Game/audio-probe runtime extraction, while the
representative-device frame-graph matrix closes in parallel.

### Pipeline attribution checkpoint

The opt-in `?pipelineprofile=1` diagnostic establishes that Three r185 WebGPU `compileAsync()` is
not one driver fence. In the fixed two-army fixture, six cache-warm pages consistently observed 69
node calls (56 misses), 90 pipeline lookups, 74 new pipelines, 69/28 new vertex/fragment programs and
53 asynchronous GPU pipeline promises. Median compile wall time was 8.649 s; summed node-call
lifetimes were 1.415 s and summed promise lifetimes were 6.869 s. The first synchronous render after
compile cost another 1.726 s median submit wall time. These attributed sums can overlap and the
first-paint span is not a GPU-completion fence.

Do not canonicalize cache keys or retain pipelines merely from these counts. First require zero
unexpected post-reveal pipeline creation through a scripted VFX/LOD/construction/weather exercise,
then a 10-20 same-process match soak with stable cache counts and renderer RSS.

## Acceptance gates

- WebGPU is asserted; a fallback capture cannot be labelled as a desktop result.
- POC load time includes WASM initialization and decode, not just smaller file bytes.
- No tracked asset changes appearance, bounds, hierarchy, sockets, triangle count or texture roles.
- GPU timestamp results decide graphics work; CPU/WASM results use wall-clock worker and main-thread
  measurements.
- Meaningful visual milestones get fixed-seed screenshots and live desktop review.
