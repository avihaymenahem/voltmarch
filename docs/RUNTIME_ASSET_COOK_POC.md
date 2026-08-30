# Runtime asset cook proof

Status: rejected for runtime promotion; retained as a reproducible offline experiment
Family: Allied Chrono Miner (`allied_harvester`)
Measured: 2026-08-31

The first runtime-cooked family proved that VOLTMARCH can remove invariant GLTF conditioning from
match boot while passing structural delivery checks. It did **not** complete WebGL/WebGPU visual,
depth or shadow parity, and it did **not** prove that the result is a better shipping format.

The cook flattens the static hull transform, rebuilds the existing 30-degree crease normals,
promotes required attributes to Float32, drops stale tangents, applies the reviewed gameplay fit,
reindexes bit-identical vertices and emits lossless `EXT_meshopt_compression`. It retains the
authoring source, live Meshopt control, KTX2 PBR material, LOD distances, shadow proxy, procedural
sockets and procedural model fallback. The v1 schema deliberately rejects articulated families.

## Result

| Metric | Retained control | Cooked proof | Delta |
| --- | ---: | ---: | ---: |
| Warm conditioning median | 263.65 ms | 0.70 ms | -262.95 ms |
| Warm complete request window | 249.55 ms | 475.75 ms | +226.20 ms |
| Complete family bytes | 3,651,320 | 6,244,672 | +2,593,352 (+71.03%) |
| Warm whole-boot median | 28,217 ms | 25,158 ms | noisy; not attributable |

The cooked cold run was 1.825 seconds slower. The measurement used three runs per arm in the built
game under headless Chromium/WebGL-SwiftShader. It did not cover packaged Electron or native WebGPU,
and the whole-boot sample is too small and variable to claim the apparent warm difference.
The runtime A/B adapter was deliberately removed with the rejected route, so these six samples are
historical evidence rather than a replayable benchmark in the final tree. Their raw arithmetic,
input/output hashes and cook are retained; reproducing the runtime A/B would require temporarily
reapplying a quarantined measurement adapter.

The proof therefore failed the family-ready/transfer gate. Removing the main-thread transform work
is valuable, but expanding glTF accessors to Float32 before transport gives too much of that win back
to I/O and decode. The runtime URLs and generated shipping binaries were removed. The approved
Meshopt family remains the only imported path.

Exact measurements, parity facts and generated hashes are preserved in
`tools/asset-cooks/chrono-miner.rejected-proof.json`. Reproduce ignored local outputs with:

```powershell
npm run asset:cook-runtime -- --manifest tools/asset-cooks/chrono-miner.runtime.json
node tools/cook-runtime-asset-family.mjs --manifest tools/asset-cooks/chrono-miner.runtime.json
```

The second command verifies that a prior local generation is byte-identical.

## Structural checks that passed

- Triangles: 49,825 / 22,416 / 8,968 / 1,728 for LOD0/LOD1/LOD2/shadow.
- LOD0 bounds: `[-2, 0, -4.3]` to `[2, 3.3, 4.3]`.
- Material: `Allied Chrono Miner PBR`, three KTX2 images.
- Float position/normal/UV, no stale tangent, identity cooked node transform.
- Source authority, control GLB, LOD thresholds, caster, sockets and procedural fallback preserved.

Backend image/depth/shadow comparison was not completed because the transfer/request gate already
rejected the format. The cook CLI freezes every source hash, refuses input drift, rejects
input/output overlap and permits writes only below ignored `.turbo/runtime-cooks`.

## Next viable hypothesis

Do not repeat the same Float32-glTF delivery across another family. A later proof must retain compact
transport accessors while eliminating repeated runtime conditioning, or use a compact worker-decoded
typed-array delivery whose output transfers directly to bounded main-thread publication. It must beat
the complete request window and packaged family-ready time before gaining a runtime URL.
