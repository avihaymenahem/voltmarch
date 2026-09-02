# Imported-geometry placement POC

Tools-only Electron/WebGPU experiment. **Not imported by the game, desktop shell,
or release build.** It never writes canonical assets, profile data belonging to
the game, or runtime defaults. Requires installed repository dependencies.

```powershell
node --test tools/asset-prep-poc/poc.test.mjs
node tools/asset-prep-poc/run.mjs --rounds 6 --jobs 3
node tools/asset-prep-poc/summarize.mjs .turbo/asset-prep-poc/run-REPLACE/report.json artifacts/perf/asset-preparation-offload-poc.json
```

Each run makes an isolated directory under `.turbo/asset-prep-poc/`. The harness
opens its own 1280x720 Electron window and quits it at the end of each cell; it
does not drive the existing development browser. Run without other GPU tests or
builds. Six rounds cover all six orderings of the three arms; three jobs per
cell give one fresh helper/process and two reused-helper samples. The canonical
compact Chrono Miner LOD0/LOD1/LOD2/shadow family is loaded afresh for every job.

## Compared paths

- `main`: real GLTF load followed by the production geometry conditioning block
  on the renderer thread, with no worker-only snapshot/reconstruction overhead.
- `worker`: same load, copied compact geometry snapshot, transferred buffers to
  a Web Worker, same conditioning block, transferred results, renderer hydration.
- `utility`: same work in an Electron utility process. Native MessagePort
  endpoints support port transfer, **not ArrayBuffer transfer**: typed arrays
  are structured-cloned in both directions. This is JavaScript in a separate
  native-capable process, not a C++/Rust speed test.

The kernel is extracted from current production TypeScript using AST boundaries,
not maintained as a separate implementation. Inputs, live source paths/fit/LOD
contract, built bundles, harness source, lockfile, loader and Basis bytes are
fingerprinted. No rejected pre-expanded runtime-cook output is consumed.

## What the measurements mean

- `conditioningMs` includes snapshot, dispatch, computation, return and hydration.
- `geometryReadyMs` includes helper startup (first job), full parallel family load,
  KTX2 work, GLTF scene creation and conditioning.
- `firstRenderMs` adds one isolated LOD0 render and a GPU completion fence. It
  uses the original GLTF material, **not** the production shroud/physical material,
  scene assembly or battlefield. Renderer/device initialization is already done.
- rAF gaps, 4 ms timer gaps and Long Tasks observe the complete request-to-render
  span. Watchers are armed before the work and allowed to settle after it.
- Per-job max gaps and >50/>100 ms counts expose isolated stalls; pooled frame
  percentiles weight longer samples more. At six cold/twelve reused samples per
  arm, nearest-rank p95 is just the largest observed value.
- Summed process working sets sampled every 50 ms can double-count shared pages
  and miss short peaks. Post-dispose samples may retain JavaScript references;
  they do **not** establish a leak-free memory plateau.

Every cell has a fresh Electron profile/process. OS file and GPU driver caches
are uncontrolled; these are not disk-cold launches. Within a cell the renderer,
pipeline caches and helper remain warm; each job has freshly parsed assets and
a fresh two-worker KTX2 pool. The game normally shares its KTX2 pool. The same
choice applies to all arms, but this limits extrapolation to game boot.

## Correctness and containment

All output attribute bytes/types/normalization, groups, bounds, draw range and
triangle counts must match across every job/arm. All four family screenshots
must match exact RGBA pixels on the same adapter. Proxy captures use a plain
material because the production proxy has no UVs. Transfer-only echo and exact
malformed-request rejection are checked outside timed spans; six offline tests
cover extraction, contract, ownership, interleaving, transform and refusal.

The fixture explicitly excludes multi-primitive, skinned, morphed, turret and
gait families. There is no shipping queue, cancellation/retry/fallback or crash
recovery implementation. Timeouts terminate the POC instead of pretending to
recover. A one-Hull result cannot authorize a general rollout. The helper has a
small message surface and filtered environment, but its Node capabilities are
**not a sandbox**; the renderer remains sandboxed/context-isolated. Files served
to the owned renderer are allowlisted; there is no network service or listener.

Before production adoption, measure the shared-pool full-game path and actual
post-ready asset streaming, test representative moving/multi-material families,
add bounded job ownership/cancellation/failure recovery, and run a longer
memory/disposal soak. No shipping dependency or native addon is added here.
