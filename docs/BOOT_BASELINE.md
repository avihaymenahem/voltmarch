# Boot baseline and phase telemetry

VOLTMARCH has one opt-in wall-clock recorder for the built browser game and the
packaged Electron flow. Normal play does not enable it, it does not print, and
no recorded value is read by simulation. Enable it only with
`?bootprofile=1`; the snapshot is available from the established diagnostics
seam as `window.__VM.hooks.bootReport()`.

## Repeatable browser baseline

Always compare the same built commit, fixture, viewport, backend, flags, and
cache policy. The harness builds once, launches separate pages in one fresh
browser process, reports its first page separately, and uses the remaining
fresh pages for explicitly named **cache-warm** medians.

```powershell
npm run profile:boot -- --runs 5 --shot 00-mcv-four-army --flags "gpu=webgpu" --out artifacts/perf/boot-webgpu.json
npm run profile:boot -- --runs 5 --shot 00-mcv-four-army --flags "gpu=webgl" --out artifacts/perf/boot-webgl.json
```

Use `--no-build` only when `apps/game/dist` is known to be the build under test.
Use `--calibrated` to preserve the graphics-calibration local-storage state and
`--linger 20000` when measuring deferred post-ready work. The JSON report is
schema 3 and retains every raw sample as well as `firstPage` and
`cacheWarmMedian` summaries. Pages two onward reuse the browser process and HTTP
cache; they do not reuse page-owned decoded assets, Three objects,
renderer/device state or VOLTMARCH pipeline maps. They are not engine-warm
boots. Phase totals for asset families are sums of spans and may overlap; they
are workload totals, not critical-path duration. With `--linger`, the exported
snapshot is taken after the linger so deferred asset spans are retained.
Use `--compact --out <tracked.json> --raw-out .turbo/<raw.json>` to retain a
small review artifact and a local full-fidelity capture from the same run.

## Current diagnostic-host baseline (2026-08-31)

Five runs per browser cell, 1280x720, calibrated settings. WebGL used ANGLE on
the AMD Radeon Graphics adapter; WebGPU used the NVIDIA Ampere adapter. `First`
is the first page in a new browser process. `Cache p50/p95` uses four later
fresh pages: browser/HTTP/driver-process caches may survive, but page-owned
engine resources do not. Times are seconds.

| Fixture | Backend | First | Cache p50 | Cache p95 | Systems p50 | Pipelines p50 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Two armies/base | WebGL | 32.320 | 14.376 | 18.395 | 11.975 | 0.075 |
| Four armies/MCV | WebGL | 21.588 | 15.053 | 15.851 | 13.626 | 0.044 |
| Two armies/base | WebGPU | 28.521 | 23.200 | 23.373 | 9.507 | 8.625 |
| Four armies/MCV | WebGPU | 30.671 | 29.937 | 34.832 | 19.916 | 7.358 |

The first-page rows were captured in separate commands and still share the host
filesystem/driver cache, so their ordering is not a causal two-versus-four-army
comparison. The within-command cache p50/p95 values are the regression baseline.
The dominant WebGPU split on this host is system/content initialisation plus
pipeline compilation, which is stronger evidence for the next ordered batches
than a speculative whole-engine WASM or worker move.

Compact evidence:

- `artifacts/perf/boot-baseline-two-army-webgl.json`
- `artifacts/perf/boot-baseline-four-army-webgl.json`
- `artifacts/perf/boot-baseline-two-army-webgpu.json`
- `artifacts/perf/boot-baseline-four-army-webgpu.json`

## Packaged desktop observation

The desktop allowlist accepts the same flag:

```powershell
npm run desktop -- --vm-bootprofile=1 --vm-skipmenu=1
```

After the battlefield appears, collect `window.__VM.hooks.bootReport()` from a
developer-tools session or a diagnostic driver. `app://` resource entries can
include `Server-Timing: vm_protocol_open`, which measures the custom protocol
handler through receipt of the underlying file response headers. The response
body remains streamed: this is not a full-file-read duration.

`npm run profile:boot:desktop` builds the current game renderer and desktop
shell, fingerprints the complete renderer output, and automates a production
`app://` capture. The fixture is pinned to WebGPU, Temperate Valley, sim seed 7,
map seed `0x7e44a1`, the pre-built-base opening, and the default Allies/Soviets
duel; the driver fails if the observed runtime context or URL drifts. Five fresh
Electron processes and fresh application profiles on the same NVIDIA Ampere
adapter measured 27.260 s renderer-relative first-stable-frame p50 and 27.663 s
p95. The separately-clocked process-launch-to-curtain-hidden values were 28.238
s p50 and 28.669 s p95. Median system initialisation was 10.068 s and median
pipeline compilation was 8.428 s.

The renderer value starts at navigation's `performance.timeOrigin`; the process
value starts immediately before Playwright launches Electron. They answer
different questions and must not be substituted for one another. Chromium
exposed no Resource Timing entries for the custom scheme in these runs, so
`vm_protocol_open` was unavailable; the report records that absence instead of
inventing file-read timing. Compact evidence is
`artifacts/perf/boot-baseline-electron-webgpu.json`; full raw reports remain
under ignored `.turbo/`.

## Definitions and interpretation

- `gltf.load-parse-decode` begins at `GLTFLoader.loadAsync` and ends when Three
  returns the GLTF. It includes request, GLB parsing, Meshopt decode, and scene
  creation. Resource Timing can show the request response boundary, but the
  difference is only an estimate of parse/decode because dependent images and
  concurrent work may overlap.
- `texture.ktx2-ready` ends when `KTX2Loader` returns the transcoded texture;
  `texture.image-source-ready` ends at the existing loader/image `load`
  callback. The latter is source/loader readiness, not a guaranteed raster
  decode or GPU upload fence. Neither proves that every mip reached the GPU.
- `gpu.renderer-prepare` covers backend selection/device preparation.
  `gpu.pipeline-compile` covers the awaited Three compile with latent branches
  exposed. The boot paint and first frames account for remaining upload/use.
- `registry.context-published` and `registry.systems-published` are marks;
  `registry.systems-init` and `registry.presentation-populate` are spans.
- `app.game.ready` is recorded after the synchronous boot paint.
  `app.first-stable-frame` is the existing two-`requestAnimationFrame` reveal
  boundary. It is a browser presentation boundary, not a GPU fence.
- Long Tasks are recorded from entry-module evaluation through snapshot time.
  Chromium supports the API; other browsers may report `supported: false`.
- Resource `transferSize` can be zero for cache hits, opaque entries, or custom
  schemes. Treat zero as unknown unless the cache mode is independently known.
- Every mark/span carries a page-local boot-run id. Run context records fresh
  page versus same-page rebootstrap, backend, GPU/adapter where exposed,
  scenario, seed and seated factions where the product shell owns them. Asset
  URLs retain paths only; query strings and credentials are not exported.

The headless browser baseline is suitable for regression comparisons, not for
claiming packaged-desktop absolute performance. Capture a separate desktop
baseline on target hardware because Electron version, GPU selection, driver,
custom protocol, shader cache, filesystem cache, and display resolution differ.
