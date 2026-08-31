# Batch 11: shared GLTF runtime package

Status: implemented, measured and independently approved on local `main`
Date: 2026-08-31
Baseline commit: `1c7be578`

This report records the roadmap's eleventh bounded pass: extracting the real GLTF/Meshopt/KTX2
runtime seam shared by Game and Asset Lab. It is an architecture and deployment-cleanliness
improvement. It is performance-neutral at runtime; the evidence does not support a boot-speed
claim.

## Executive result

- New `@voltmarch/gltf-runtime/gltf` and `@voltmarch/gltf-runtime/ktx2` subpaths own loader
  construction and KTX2 worker-pool lifecycle. They do not own game content, caches, fallbacks,
  readiness policy, materials or scene publication.
- Game retains its telemetry facades. Asset Lab shares the same loader factories, while its infantry
  entry imports only `/gltf` and therefore does not pull KTX2 into that entry's source graph.
- One exact Three `0.185.1` peer remains deduplicated. GLTF loaders receive Three's matching
  Meshopt decoder. KTX2 uses one reference-counted, two-worker loader, detects renderer support on
  first acquisition and tears the workers down after the final release.
- Asset Lab production now uses Vite's single hashed Basis JS/WASM pair. Removing the redundant
  copied `basis/` directory cuts the complete deployment by **585,853 bytes (0.04735%)**.
- Runtime request counts are unchanged. Game output adds only 187 gzip bytes; Asset Lab's index and
  infantry critical transfers add 177 and 23 bytes. KTX2 request count and transfer are exact parity.
- The fixed Game world checksum remains `64 chunks / 783737b1 / fc273753`.

## Industry transfer decision

| Production practice | What transfers to VOLTMARCH | What does not transfer now |
| --- | --- | --- |
| Unreal Asset Manager and async handles | A narrow owner for loader configuration and resource lifetime; explicit acquisition/release; application-owned readiness and publication. | A global asset registry, Primary Asset taxonomy or engine-wide streaming policy without equivalent authored metadata and consumers. |
| Unreal modules | One-way, named interfaces with a small public surface and implementation hidden behind package boundaries. | Generic `core` or `engine` packages that merely rename the current cycles. |
| Unity Addressables | Measure build layout, duplication, dependency shape and full readiness; release shared resources only after all users are finished. | Retrofitting catalogs, labels, bundles and reference counting across all content for one loader seam. |
| Three loader composition | Compose `GLTFLoader`, `MeshoptDecoder`, `KTX2Loader` and renderer capability detection exactly as the active renderer requires. | A global mutable GLTF scene cache: the audited 270 static URLs contain no duplicate URL that would justify one, and cloned scene ownership is application-specific. |
| AAA worker use | Bound expensive byte transcoding in a reusable pool and keep worker count explicit. | Per-entity workers, scene-graph mutation in workers or a new decoder protocol when Three already provides the worker boundary. |

Primary references:

- Unreal asset management: <https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-management-in-unreal-engine>
- Unreal asynchronous asset loading: <https://dev.epicgames.com/documentation/en-us/unreal-engine/asynchronous-asset-loading-in-unreal-engine>
- Unreal modules: <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-modules>
- Unity Addressables overview: <https://docs.unity3d.com/6000.0/Documentation/Manual/com.unity.addressables.html>
- Unity Addressables memory lifecycle: <https://docs.unity3d.com/Packages/com.unity.addressables@1.21/manual/MemoryManagement.html>
- Unity Addressables build-layout report: <https://docs.unity3d.com/Packages/com.unity.addressables@1.21/manual/BuildLayoutReport.html>
- Three GLTFLoader: <https://threejs.org/docs/pages/GLTFLoader.html>
- Three KTX2Loader: <https://threejs.org/docs/pages/KTX2Loader.html>
- Three LoadingManager: <https://threejs.org/docs/pages/LoadingManager.html>
- Meshoptimizer JavaScript integration: <https://github.com/zeux/meshoptimizer/blob/master/js/README.md>

## Scope and dependency shape

The package intentionally exposes two subpaths rather than a barrel:

```text
@voltmarch/gltf-runtime/gltf
  createGltfLoader({ manager?, ktx2Loader? })

@voltmarch/gltf-runtime/ktx2
  createKtx2LoaderPool({ transcoderPath?, workerLimit })
    acquire(renderer)
    release()
    dispose()
```

`createGltfLoader` returns a fresh loader, installs the exact Meshopt decoder shipped with the
workspace's Three version and optionally attaches the caller's KTX2 loader. The package does not
cache parsed scenes or decide when a model is ready for gameplay.

The KTX2 pool creates one loader lazily, applies the caller's worker limit and optional transcoder
path, and calls `detectSupport` only after a renderer exists. Acquisitions share that loader until
the final release, including the valid stale-world/replacement-world overlap where two renderer
objects temporarily hold leases. A failed support detection disposes and rolls back the acquisition;
over-release is harmless; a later acquisition after complete disposal creates and detects a fresh
loader. Callers must complete disposal before changing backend/device class.

Game's `RuntimeGLTFLoader` and `RuntimeKTX2Loader` remain compatibility facades so boot spans and
asset labels stay application-owned. Procedural fallbacks, asset generations and publication rules
remain in their existing callers. Asset Lab acquires KTX2 only after renderer initialization and
disposes the pool during HMR. Production omits an explicit transcoder path, allowing Vite to emit
and reference one content-hashed transcoder pair; development retains the existing `/@fs` path.

The workspace graph moves from eight to nine acyclic workspaces. The audit found 1,320 allowed
cross-layer imports, 1,852 runtime imports plus 434 type imports, five known file-level strongly
connected components and no new cycle. Ownership validation covers 2,405 sources with no sibling-app
import or duplicate-source violation.

## Deterministic output evidence

All byte comparisons use production output built from the stated source, not a stale intermediate
artifact.

| Surface | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Game JS chunks | 16 | 16 | 0 |
| Game raw JS | 5,689,315 B | 5,689,696 B | +381 B (+0.00670%) |
| Game gzip JS | 1,741,469 B | 1,741,656 B | +187 B (+0.01074%) |
| Game Brotli JS | 1,430,876 B | 1,431,438 B | +562 B (+0.03928%) |
| Asset Lab JS chunks | 656 | 656 | 0 |
| Asset Lab raw JS | 1,258,107 B | 1,258,504 B | +397 B (+0.03156%) |
| Asset Lab gzip JS | 394,432 B | 394,590 B | +158 B (+0.04006%) |
| Asset Lab Brotli JS | 326,915 B | 327,184 B | +269 B (+0.08228%) |
| Asset Lab deployment files | 1,313 | 1,310 | -3 |
| Asset Lab deployment bytes | 1,237,340,547 B | 1,236,754,694 B | **-585,853 B (-0.04735%)** |

The removed copied Basis directory contained 586,250 bytes of JS, WASM and README material. The
397-byte net JS increase accounts for the corresponding full-deployment difference.

Critical entry closures remain stable:

| Entry | Requests before/after | Transfer before | Transfer after | Delta | Decoded delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Asset Lab index | 4 / 4 | 902,908 B | 903,085 B | +177 B (+0.01960%) | +432 B (+0.02525%) |
| Asset Lab infantry | 36 / 36 | 3,268,302 B | 3,268,325 B | +23 B (+0.00070%) | +84 B (+0.00213%) |
| Foundry Runtime KTX2 | 4 / 4 | 8,128,676 B | 8,128,676 B | 0 | 0 |

The index eager JS closure changes by +0.03909% raw, +0.06155% gzip and +0.13917% Brotli. The
infantry closure changes by +0.00880%, +0.00938% and +0.06361%. Both WebGL and WebGPU request only
the hashed `basis_transcoder-o4Hde_L7.js` and `basis_transcoder-VXdx5NbI.wasm`; no `/basis/*`
request remains.

## Readiness timing: observational only

Timing used six pages per arm: one cold page followed by five warm pages. It is included for
transparency, but the contradictory cold/warm cells and repeat-to-repeat host variance are much
larger than the sub-0.14% deterministic closure changes. No timing improvement or regression is
attributed to the extraction.

### Asset Lab warm median/p95

| Backend/page | Before | After | Observed delta |
| --- | ---: | ---: | ---: |
| WebGL index | 324.2 / 335.1 ms | 239.8 / 243.6 ms | -26.03% / -27.31% |
| WebGL infantry | 1,640.4 / 1,709.0 ms | 1,246.9 / 1,262.5 ms | -23.99% / -26.13% |
| WebGL Foundry KTX2 | 248.7 / 261.2 ms | 197.0 / 217.6 ms | -20.79% / -16.69% |
| Native WebGPU index | 465.4 / 511.8 ms | 366.6 / 393.7 ms | -21.23% / -23.08% |
| Native WebGPU infantry | 2,348.4 / 2,691.2 ms | 1,873.5 / 1,919.2 ms | -20.22% / -28.69% |
| Native WebGPU Foundry KTX2 | 236.6 / 403.6 ms | 206.7 / 222.3 ms | -12.64% / -44.92% |

The cold native-WebGPU index and infantry pages moved in the opposite direction, +11.19% and
+22.47%. Two corrected post repetitions also varied materially. These warm improvements are host,
browser, GPU and cache observations, not causal package results.

### Game boot

The fixed two-army seed-7 fixture used `--calibrated --linger 5000`; all arms produced the exact
`64 chunks / 783737b1 / fc273753` world checksum.

| Backend | Metric | Before | After | Observed delta |
| --- | --- | ---: | ---: | ---: |
| WebGL | cold page | 13,033.9 ms | 13,048.2 ms | +0.11% |
| WebGL | warm median | 7,863.3 ms | 9,162.1 ms | +16.52% |
| WebGL | warm p95 | 8,459.7 ms | 9,327.0 ms | +10.25% |
| Native WebGPU | cold page | 24,654.0 ms | 28,107.4 ms | +14.00% |
| Native WebGPU | warm median | 22,459.4 ms | 22,221.5 ms | -1.06% |
| Native WebGPU | warm p95 | 24,138.9 ms | 22,289.8 ms | -7.66% |

The WebGL post pages were `7,640.9, 7,736.2, 9,162.1, 9,327.0, 9,270.1 ms`, showing an abrupt
same-run host-state shift. An immediately preceding nearly identical post artifact measured
8,555.6/8,815.4 ms median/p95, a 7.09%/5.80% repeat difference. Systems, GLTF and KTX2 totals rose
together despite unchanged requests. The strict 3% timing gate is therefore inconclusive on this
time-separated cell; an adjacent same-build/control experiment is required before a causal claim.

## Validation and independent review

- Package: 7 tests plus typecheck.
- Game integration: 11 focused tests, then the complete Game suite.
- Asset Lab: 16 tests.
- Complete repository gate: 23/23 tasks; 319 passed and 4 skipped Game test files; 7,099 passed and
  4 skipped tests.
- Fresh isolated Electron/WebGPU render smoke on the final source: NVIDIA Ampere backend remained
  live, the imported Meridian set compiled, the presented frame changed after a camera move and no
  validation/pipeline error was recorded.
- One physical Three `0.185.1` installation under `npm ls three --all`.
- Dependency graph: nine acyclic workspaces, no new file cycle.
- Exact fixed-world checksum parity and exact KTX2 request/byte parity.

The anonymous review found two blocking issues before approval. First, the initial renderer-identity
guard rejected a legitimate overlap between stale and replacement world leases; the pool now keeps
one loader alive through overlapping renderer objects and has a regression test. Second, the new
telemetry test omitted KTX2's required `onLoad`; it now supplies the callback and Game typecheck
passes. The final verdict is **PASS**, with no unresolved P0-P2 finding.

During finalization, a desktop-dev window that had remained open across the package/dependency/HMR
edits reported `meridian_solararray.meshy.pbr` with an undefined WebGPU depth-stencil format. Three's
path proves that message requires a non-null depth texture whose backend record no longer has a
format; the named material is only the first queued pipeline to observe it. The likely dev-only race
is teardown disposing a post/world depth target while Three r185's yielding `compileAsync()` still
holds that render context. A fresh isolated Electron process against the same live Vite server
compiled the imported Meridian family and passed the render smoke with zero fatal message. The
incident is therefore classified P3 dev-session contamination, not a Batch 11 source regression.
Restart desktop dev after dependency or renderer-topology edits. The retained-renderer regression
gate now calls for a fresh Meridian boot, dispose/reboot, and development teardown during compile;
if the third arm reproduces, cancel queued compile publication or defer target disposal rather than
hard-coding a depth format. Three has a separate r185 `compileAsync()` state leak fixed for r186,
reinforcing the lifecycle caution: <https://github.com/mrdoob/three.js/issues/33898>.

## Decision and next action

Promote the package extraction and removal of the redundant Asset Lab Basis copy. Describe the
result as architecture/deployment cleanliness and runtime parity. Do not claim a boot improvement.

Batch 12 should extract only the justified `@voltmarch/audio-runtime` seam shared by Game and the
browser audio probe. First break the `AudioEngine`/`Samples` cycle; package WebAudio lifecycle,
buses and buffer utilities; keep recipes, EVA, barks, music policy, positional integration and
`audio.system.ts` in Game. Record graph, production closure, audio-readiness and first-use-event
evidence before promotion. After that, `@voltmarch/procedural-kernels` remains conditional on a
profiled top-cost flat-array kernel and a byte-exact JS fallback suitable for a future coarse WASM
ABI.
