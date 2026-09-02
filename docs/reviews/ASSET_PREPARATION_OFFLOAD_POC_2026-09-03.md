# Imported asset preparation: worker vs native-capable process

## Decision

**A Web Worker is a promising next production-path experiment. An Electron
utility-process migration is not justified by this fixture. Neither is shipped.**

For the compact four-file Chrono Miner family, a reused worker improved complete
request-to-conditioned-geometry time by **19.8–24.1% in every matched round** and
removed the observed roughly 300 ms renderer stalls. The utility process also
removed those stalls, but added startup/copy/memory cost: its cold readiness was
worse than the renderer-thread control in all six rounds. No native addon was
tested; the utility arm ran the same JavaScript with Node capabilities.

This is evidence for off-thread geometry conditioning, not for replacing web
technology indiscriminately, moving Three.js rendering out of the renderer, or
porting the whole loader to native code. Whole-game boot, battle FPS, actual
post-ready streaming and crash-recovery benefits remain unproven.

## Scope and method

- Owner approved a bounded POC for the first proposed native-workload candidate.
- Parent implemented/ran the POC; one read-only performance specialist reviewed
  extraction fidelity, timing fairness, transport and interpretation. No children
  edited files or ran GPU work. Independent review found no remaining blocker for
  this bounded experiment after two fixes: precise negative-control errors and
  complete measured-build fingerprints.
- Performance questions before implementation: WASM already handles Basis/KTX2;
  keep the geometry algorithm unchanged here to isolate placement. A worker can
  keep CPU conditioning off the renderer thread. GPU compute is not selected:
  this experiment requires CPU-owned Three geometry and exact parity. No
  authoritative simulation or lockstep code changes.
- Tools-only harness in `tools/asset-prep-poc/`; no shipping import, dependency,
  asset bytes, simulation, material, game defaults or desktop IPC changes.
  Consequently the shipping boot/frame-time impact of the POC itself is zero.
- Same original compact Meshopt/KTX2 family: LOD0, LOD1, LOD2, shadow. Total input
  file bytes **3,651,320**. Existing cook manifest supplies input hashes/contract
  only; rejected expanded runtime-cook outputs are never loaded.
- Exact current production conditioning statements are extracted with TypeScript
  AST boundaries. The renderer control executes them directly. Helpers receive
  owned compact snapshots, perform the same work, and return renderer-hydrated
  geometry. Every dispatch/copy/reconstruction is included in conditioning time.
- Six rounds cover all six arm orderings. Each arm has a fresh Electron process
  and profile, with three sequential jobs: one fresh helper/process and two reused
  helper jobs. **54 loads, 18 cells, no concurrent GPU benchmark.**
- All four files load in parallel through the real shared loader implementation.
  Each job uses fresh assets and a fresh two-worker KTX2 pool in every arm; the
  actual game shares its pool. The renderer/device is initialized before timing.
  OS/driver caches are uncontrolled, so “fresh” does not mean disk-cold.
- One isolated source-material LOD0 render is fenced on WebGPU. It is not the
  production physical/shroud material or full scene-readiness path.
- Host: Windows `10.0.26200`, Ryzen 9 5900HX, 16 logical CPUs, NVIDIA Ampere WebGPU,
  1280x720 at pixel ratio 1; Electron 43.4.1, Chromium 150.0.7871.224. Adapter API
  did not expose a precise device name. Exact game source HEAD and dependency
  versions are recorded in the JSON artifact. The measured worktree was dirty
  with pre-existing UI/studio work.

## Measurements

Times are milliseconds, **p50 / observed p95**. Nearest-rank p95 equals the maximum
with six fresh and twelve reused samples per arm; it is not a population-tail
estimate. “Ready” includes helper startup, family loading, decode/scene creation,
and all conditioning traffic. “First render” adds the isolated GPU fence.

| State / arm | Conditioning | Family ready | First render |
| --- | ---: | ---: | ---: |
| Fresh renderer control | 310.2 / 329.5 | 484.5 / 511.5 | 590.5 / 614.7 |
| Fresh Web Worker | 223.2 / 224.7 | 415.2 / 462.4 | 514.2 / 562.0 |
| Fresh utility process | 227.9 / 238.7 | 520.5 / 578.1 | 623.3 / 678.4 |
| Reused renderer control | 290.4 / 322.9 | 456.1 / 498.4 | 480.0 / 526.4 |
| Reused Web Worker | 187.3 / 198.7 | 354.5 / 374.7 | 377.6 / 399.4 |
| Reused utility process | 218.0 / 229.0 | 379.3 / 401.9 | 405.5 / 427.9 |

Matched round comparisons are stronger than the ratio of pooled medians:

- Worker fresh readiness improved **2.5–20.2%**, reused readiness **19.8–24.1%**.
- Utility fresh readiness regressed **1.3–21.9%**; reused readiness improved
  **13.6–22.3%** over renderer control. It did not beat the worker on matched
  per-round readiness in either state.
- Reused worker isolated first-render time improved **18.9–22.9%** by round.

Scheduling observers are armed before work and drained after it. These are rAF
callback gaps and timer/Long Task observations in the isolated renderer, **not
measured battlefield GPU frame times**.

| Arm | Reused per-job max rAF gap p50 / p95 | Jobs with >100 ms rAF gap, all 18 | Long Tasks, all 18 |
| --- | ---: | ---: | ---: |
| Renderer control | 283.3 / 316.7 | 18 | 18 |
| Web Worker | 16.8 / 17.5 | 0 | 0 |
| Utility process | 16.8 / 17.6 | 0 | 0 |

No >50 ms rAF gap was observed in either off-thread arm. Reused per-job maximum
4 ms timer-gap p95 was 338.8 ms control, 20.3 ms worker and 29.3 ms utility.

## Transfer and memory cost

Each helper request snapshots **2,972,094 bytes** of decoded compact geometry and
returns **7,920,480 bytes** of conditioned geometry. The original renderer-owned
source remains intact. The worker transfers ArrayBuffers both ways; Electron's
native MessagePort endpoint clones typed arrays both ways. Native port transfer
does not imply transferable geometry buffers.

The untimed same-input echo averaged 0.41 ms for the worker and 10.81 ms for the
utility. That control measures input-sized traffic, not the larger conditioned
return. The actual timed RPC includes the larger output in every real job.

Median sampled peak summed process working sets were:

| State | Renderer control | Web Worker | Utility process |
| --- | ---: | ---: | ---: |
| Fresh | 907 MiB | 928 MiB | 1,032 MiB |
| Reused | 976 MiB | 995 MiB | 1,140 MiB |

These are 50 ms working-set samples, can double-count shared pages, and can miss
short peaks. Post-dispose observations still have possible live JS references
and uncontrolled helper collection. They do **not** prove retained-memory cost,
leak freedom or a long-session plateau. Utility self-reported RSS ranged about
124–163 MiB during the run.

## Correctness and checks

- All 54 output geometry fingerprints match exactly: attribute bytes/types,
  normalization/interleaving, groups, bounds, sphere, draw range and triangles.
- LOD triangle counts: **49,825 / 22,416 / 8,968**; shadow **1,728**. No reduction,
  material simplification, or output-file expansion used to obtain the win.
- All **72 captures** match exact RGBA pixels across arms/rounds, separately for
  each LOD/proxy. The parent inspected the LOD0 reference visually. Source textures
  are present; the UV-less shadow proxy uses a neutral untextured capture material.
- Across the two helpers, all 36 echo checks and all 36 precise malformed-request
  rejections pass outside timed spans. Timeouts/crashes cannot count as validation.
- Zero collected renderer/GPU/process errors. All 18 owned Electron cells exited.
- `node --test tools/asset-prep-poc/poc.test.mjs`: **6/6 pass**.
- `npm run check:ownership`: pass, 2,455 source files.
- `npm run check:dependencies`: pass, 9 acyclic workspaces, no new cycle.
- `git diff --check`: pass. Production build/full game tests were not run for
  this tools-only change; no claim of production integration acceptance is made.

## Limits and next gate

The test fixture has one static Hull primitive. Turrets, gaits, skinning, morphs,
multi-primitive/material families and sockets are not validated. No shipping
queue, cancellation, stale-result disposal, retry/fallback or crash recovery was
implemented. Native capability is not a security sandbox; utility privileges
would be a cost to justify, not a free benefit.

If approved next, prototype a **bounded worker in the actual imported-asset
path**, preserving renderer-owned materials/textures, with representative moving
and multi-material families, real shared KTX2 pool, bounded queue and ownership,
cancel/dispose/error recovery, long-session memory tests, and full WebGPU boot
plus post-ready streaming captures. Do not promote based on this one-family lab
result alone. No automatic rollout or new outstanding task is created here.

## Evidence and reproduction

- Harness and detailed definitions: `tools/asset-prep-poc/README.md`.
- Retained sample/provenance artifact:
  `artifacts/perf/asset-preparation-offload-poc.json` (54 sample rows, 24 matched
  comparisons, build/source/input fingerprints and pixel hashes).
- Full local raw report and 72 PNGs:
  `.turbo/asset-prep-poc/run-eiOMMd/` (ignored, not a release asset).
- Representative capture:
  `.turbo/asset-prep-poc/run-eiOMMd/0-main/main-lod0.png`.
- Command: `node tools/asset-prep-poc/run.mjs --rounds 6 --jobs 3`.
- Earlier smoke directories under `.turbo/asset-prep-poc/` contain harness
  bring-up failures and are excluded from the final result. The final six-round
  run was not cherry-picked from those single-sample pilots.
