# Batch 7 compression and pipeline gates

**Decision:** terrain KTX2 promoted; six-file Allied Meshopt arm retained for reproducibility but
rejected as the runtime default; pipeline attribution promoted as opt-in diagnostics only.

This report records same-host A/B evidence from 2026-08-31. Browser cells use seven fresh pages in
one browser process (one first page plus six cache-warm pages). Desktop cells use five fresh
Electron processes and application profiles. These measurements are regression evidence for this
host, not target-hardware promises. Phase-family sums can overlap and are not critical-path time.

## Terrain mask

The canonical `universal-terrain-mask-4k.png` is 4096x4096 RGB with identical grayscale channels.
`tools/promote-terrain-mask.mjs` deterministically produces a linear ETC1S KTX2 with 13 explicit
mips, validates it with Basis Universal, and records source/output hashes and decoded quality. The
runtime uses the existing shared, renderer-configured two-worker KTX2 loader; it does not create a
new pool. The PNG and a neutral one-pixel fallback remain selectable controls, while Vite emits
exactly one production arm.

| Metric | PNG/control | KTX2/default | Change |
| --- | ---: | ---: | ---: |
| Transfer bytes | 11,489,212 | 3,297,082 | -8,192,130 (-71.30%) |
| Full-mip GPU estimate | 89,478,484 RGBA8 | 11,184,824 BC1/ETC | -78,293,660 (-87.50%) |
| Production `dist` bytes | 587,579,012 | 579,386,928 | -8,192,084 (-7.81 MiB) |

The residency row applies when the adapter supports the selected BC1/ETC-class block-compression
target. Runtime transcode format is adapter-dependent; an uncompressed fallback may still occupy
the RGBA8 estimate.

Mip-0 ETC1 quality is MAE 2.8551, RMSE 3.7423, PSNR 36.668 dB, p95 error 8,
p99 error 11 and maximum channel error 36. Fixed-seed 2560x1440 noon close-up/dusk captures passed
WebGL and native WebGPU review: roads, splat boundaries and material scale remain intact, with the
expected low-amplitude smoothing and no blocking, banding or strength collapse. Close-up PSNR was
36.167 dB on WebGL and 36.715 dB on WebGPU; dusk PSNR was 43.230 and 43.977 dB respectively.
Both WebGPU dusk arms also report the same pre-existing foliage vertex-buffer-limit validation
errors. That does not distinguish the terrain formats and the terrain close-up captures are clean,
but the dusk fixture is not evidence that the whole scene is validation-error-free.

Terrain's local initialization span rises because runtime transcode is now measured: WebGL p50
83 -> 169 ms and WebGPU p50 96 -> 204 ms in the combined A/B. That work does not create a material
packaged-start regression:

| Fresh Electron/WebGPU, five processes | PNG/control | KTX2/default | Change |
| --- | ---: | ---: | ---: |
| Renderer ready p50 | 26.868 s | 26.617 s | -0.93% |
| Renderer ready p95 | 28.534 s | 28.507 s | -0.10% |
| Process to curtain hidden p50 | 28.073 s | 27.841 s | -0.83% |
| Process to curtain hidden p95 | 29.679 s | 29.690 s | +0.04% |

An attempted renderer-early prewarm was rejected: contending with the same bounded KTX2 worker pool
raised the terrain wait from roughly 160 ms to 1.3 s and WebGL systems initialization from 7.17 s to
8.56 s. The shipping path therefore starts the terrain load only at its owning initialization seam.

## Allied Meshopt experiment

`tools/promote-allied-meshopt.mjs` creates six byte-deterministic `EXT_meshopt_compression`
candidates and reads every result back with the decoder. The report binds exact hierarchy, mesh,
primitive, triangle, material, animation and KTX2 texture contracts. Across 587,639 compared
positions, maximum nearest drift is 0.000129831, RMS drift is 0.000060933, maximum relative bounds
drift is 0.0065%, and no positions are unmatched.

| Family | Source bytes | Meshopt bytes | Change |
| --- | ---: | ---: | ---: |
| Guardian | 5,778,044 | 2,859,984 | -50.50% |
| Sabre | 4,503,764 | 1,917,904 | -57.42% |
| Refractor | 5,570,240 | 2,806,116 | -49.62% |
| Construction Dozer | 2,992,824 | 2,231,676 | -25.43% |
| Petrel | 2,347,136 | 1,720,924 | -26.68% |
| Albatross | 4,713,076 | 3,140,168 | -33.37% |
| **Total** | **25,905,084** | **14,676,772** | **-11,228,312 (-43.34%)** |

The complete family-ready window is the earliest start through latest end of the six selected LOD0
`gltf.load-parse-decode` spans. It deliberately includes request, Meshopt decode and Three scene
construction but excludes separately delivered LOD/shadow assets.

| Cache-warm six-page family window | Source/control p50/p95 | Meshopt p50/p95 | Outcome |
| --- | ---: | ---: | --- |
| WebGL | 1.875 / 1.937 s | 1.805 / 2.010 s | p50 -3.73%; p95 +3.81% |
| Native WebGPU | 2.853 / 2.969 s | 2.857 / 3.067 s | p50 +0.17%; p95 +3.27% |

The acceptance gate required at least 10% family-ready p95 improvement with no more than 3%
end-to-end boot regression. The size and parity gates pass, but the latency gate fails. The source
files remain the default and the six candidates are not emitted into the default `dist`. The
experimental all-candidate bundle would be another 10.71 MiB smaller, but transfer size alone is not
promotion evidence.

## Pipeline attribution

Three r185 WebGPU `compileAsync()` is a mixed span: it serially includes TSL node construction,
cooperative scheduler yields, render-object traversal and asynchronous GPU pipeline promises. The
new `?pipelineprofile=1` observer wraps only the existing managers for one compile, restores the exact
function identities on completion/error, and does not alter shader code, scheduling or cache keys.
The ordinary runtime stays inert. A separate `gpu.first-paint-submit` span surrounds the synchronous
first render after compile; it is CPU submit wall time, not a GPU-completion fence.

The native WebGPU control fixture was stable across six cache-warm pages:

- compile p50 8.649 s;
- node-call lifetime sum p50 1.415 s;
- GPU-promise lifetime sum p50 6.869 s, with a 1.168 s median maximum individual promise;
- first-paint-submit p50 1.726 s;
- 69 node calls: 13 cache hits and 56 misses;
- 90 pipeline lookups, 74 new pipelines, 69 new vertex programs and 28 fragment programs;
- 53 asynchronous GPU pipeline promises.

The sums describe attributed work and can overlap; they must not be added as a new critical-path
total. WebGL compile remained about 45-51 ms, making this a WebGPU-specific optimization target.
No cache canonicalization or retention policy is promoted by this batch.

## Decision gates and next work

- Shipping default: terrain KTX2 plus the current source Allied GLBs.
- Rejected: early KTX2 prewarm and the six-file Meshopt runtime default.
- Next pipeline gate: exercise VFX, LOD, construction and weather after reveal and require zero
  unexpected new pipelines; run 10-20 same-process matches and require pipeline counts and renderer
  RSS to plateau.
- Next ordered roadmap batch: compute-driven WebGPU foliage visibility/LOD compaction with CPU
  placement, destruction, clearing and save identity retained as authoritative rollback behavior.

Full local raw profiles and screenshots are under ignored `.turbo/batch7-*`. The tracked deterministic
manifests beside the promoted/candidate assets preserve the portable byte, hash, quality and structure
evidence.

## Independent review

An anonymous read-only acceptance pass returned **ACCEPT** after independently recooking both
deliveries, recomputing the reported family windows, pipeline medians, Electron deltas and visual
metrics, inspecting the captures and checking both build arms. It found no shipping blocker. Two
remaining evidence caveats are explicit: Meshopt's detailed position-drift values are recorded and
bound to the deterministic output hashes rather than recomputed by the tracked tool, and the opt-in
pipeline promise wrappers add tiny diagnostic-only microtask overhead.
