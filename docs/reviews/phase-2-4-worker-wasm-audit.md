# Phase 2-4 worker and WebAssembly audit

**Scope:** indirect lighting, environmental composition, contextual materials
**Product policy:** these systems are default-on WebGPU game presentation. WebGPU is the normal no-query
renderer; legacy WebGL parity and testing are out of scope. Existing `dayphase`, explicit backend comparison,
and `bootprofile` controls remain critic-only evidence inputs.

## Existing parallel runtime

| Runtime | Current owner | Correct use in phases 2-4 |
| --- | --- | --- |
| Shared two-worker Basis/Emscripten pool | `@voltmarch/gltf-runtime/ktx2` through `RuntimeKTX2Loader` | Keep for imported PBR texture transcode. Reuse the pool; never create one per material or asset family. |
| Meshopt WebAssembly decoder | `@voltmarch/gltf-runtime/gltf` through `RuntimeGLTFLoader` | Keep installed for compatible assets. Do not expand the one-asset proof merely to reduce bytes: the six-asset trial regressed complete family-ready p95 on both renderers. |
| Two-worker procedural pool | `core/workers/TexturePool` and the single `textureWorker` entry | Reuse for terrain, water, procedural texture and greeble typed-array jobs. Results remain transfer-owned with the byte-exact main-thread fallback. |
| WebGPU node/compute path | renderer-owned TSL and post chain | Use for sampling/rendering irradiance, contact light and material response. GPU-owned pixel work must not be copied to CPU or WebAssembly. |

The current irradiance field follows the cheapest valid boundary: it is generated inside the existing
terrain worker job while that worker already owns height, slope and surface arrays. The extra result is
one small transferable field. A second worker job would resend megabytes of terrain; a new WebAssembly
module would add fetch, compile, instantiation and JS/linear-memory transfer to the boot curtain.

## Decisions by phase

### Phase 2 — stable indirect light

- **Worker:** generate the low-frequency map-aligned irradiance field in the existing terrain job.
  Keep a pure TypeScript fallback and byte-equality tests. Do not create a new worker or pool.
- **TSL/WebGPU:** sample and combine the field in the renderer. Screen-space contact bounce and any
  later temporal history also stay GPU-owned.
- **Not WebAssembly:** the present field is only thousands of probes and shares resident worker input.
  Porting it adds a boot dependency before it removes a measured bottleneck.
- **Not a worker:** GPU timestamps, camera-pan stability and shader/material mutation are renderer
  concerns. Moving orchestration off-thread cannot reduce the GPU pass.

### Phase 3 — authored environmental composition

- Keep the semantic descriptor planner pure, deterministic and allocation-bounded.
- Terrain-only broad masks may join the existing world job only when they can be computed from arrays
  already owned there and transferred once.
- Depot, civilian, resource, shoreline and destruction stories depend on the resolved scenario,
  entity footprints, clearance and decal-pool reserve. Those lists are small and become known after
  scenario construction; keep admission on the main thread. Starting a worker and cloning live world
  descriptors would extend boot for a job that is not yet a measured hotspot.
- The retained context-light planner is capped at 18 late semantic anchors and composition normally
  touches only hundreds of 8 m texels once. It records a dirty rectangle and performs one 32 KiB retained
  GPU reupload. A worker or WebAssembly module would add a message/synchronization or startup boundary to
  less work than the transferred result.
- Authoring/cooking remains offline Node tooling. Runtime must load cooked shared atlases and geometry,
  not synthesize unique materials at reveal.

### Phase 4 — contextual material and grounding

- Weather, dampness, dust, snow and contact state are bounded uniform/node updates. Keep them in TSL or
  the existing renderer-neutral material adapters; do not send per-object callbacks across a worker or
  WebAssembly boundary.
- New procedural response atlases belong in the existing procedural worker job and cache. Imported
  atlases continue through the shared KTX2 WebAssembly transcoder pool.
- Material sampling and blending stay on GPU. CPU/WebAssembly should prepare coarse typed arrays only;
  it must never read rendered buffers back for a material decision.

## Boot-cost rules

1. No new worker pool, WebAssembly binary, runtime PMREM bake, per-instance material, or boot-blocking
   asset family is accepted for these phases without a before/after Industrial Grid boot report.
2. Reuse already-resident input and append work to an existing coarse job before considering another
   message boundary. Transfer result buffers; never structured-clone large terrain or texture arrays.
3. Main-thread reveal must keep an immediate fallback. Truly optional detail may promote after the first
   stable frame without changing placement or the simulation checksum. Authored default foliage instead
   settles before the one intentional WebGPU pipeline compile: measured overlap between its buffer rebuilds
   and Dawn's shader workers made both spans slower, while post-reveal settlement created first-use compile
   risk. Scheduling is decided by end-to-end readiness and hitch evidence, not by kernel timing alone.
4. A WebAssembly proof graduates only if the complete job, including module fetch/compile, memory copies
   and publication, improves the relevant cache-warm p95 by at least 10% and does not regress first-page
   readiness. A faster kernel microbenchmark is not sufficient.
5. Worker parallelism is evaluated on 2-, 4- and 8-core targets. More simultaneous jobs are rejected when
   contention increases first-stable-frame time or main-thread long tasks.

## Evidence and thresholds

```powershell
npm run profile:boot -- --runs 5 --shot 14-industrial-grid-realism --compact --out artifacts/perf/industrial-grid-realism.json --raw-out .turbo/industrial-grid-realism-raw.json
node tools/realism-baseline.mjs --no-build
node tools/realism-baseline.mjs --no-build --baseline=<previous-report.json>
```

The realism harness fixes Industrial Grid to seed 7 and simulation tick 120, captures day/dusk/night
centre and pan views, reads GPU pass timestamps and render counters, and requires one simulation hash
across every presentation state. Acceptance limits are:

- colour pass at or below the existing 130-draw budget;
- zero program growth after centre and pan poses have been prewarmed;
- zero simulation-hash changes from mood or camera motion;
- camera-pan GPU p95 no more than 1.15x the centred p95;
- total GPU p95 regression no more than 10% against the checked baseline;
- first-stable-frame regression no more than the larger of 10% or 250 ms.

Unavailable timestamp queries are **inconclusive**, never a performance pass. The desktop dev server is
not reused or stopped by either evidence tool; each tool proves and tears down its own preview server.
