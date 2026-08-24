# Asset optimization pipeline

VOLTMARCH derives LOD and shadow candidates from an approved LOD0. It never overwrites the source
asset and never spends Meshy credits for derived work.

## Run a family

```powershell
npm run asset:optimize-family -- --manifest tools/asset-families/soviet-buildings.json --write
```

Use `--only key_a,key_b` while tuning one or two assets. Omit `--write` for a destructive-free preflight.
When a full report already exists, a focused write merges the refreshed rows back into it. If a profile
change makes an old candidate fail, its disposable derived file is removed so stale geometry cannot be
mistaken for an approved output.

The family manifest owns class, LOD eligibility, simplification ratios and output ceilings. Generated
LOD files retain UVs and normals but contain no embedded textures; runtime integration must reuse the
already resident LOD0 material. Shadow files retain positions and indices only. This prevents one
approved PBR set from being decoded once per derivative.

The operation order is a correctness contract: simplify and prune while the source texture references
still make `TEXCOORD_0` reachable, then detach and dispose texture payloads without a second prune. Stripping
first lets the optimizer delete UVs; WebGL hides that defect behind a constant fallback sample while WebGPU
rejects the colour draw. Automated tests inspect every candidate primitive for both UV and normal channels.
Candidates then quantize positions to 14 bits, normals to 10 bits and UVs to 12 bits with
`KHR_mesh_quantization`. This reduces packaged bytes and vertex bandwidth without adding a decoder; Three's
GLTF loader supports the core Khronos extension in both renderer paths.
Runtime fitting promotes quantized position accessors to float before baking each GLTF node's dequantizing
world transform. Baking back into normalized Int16 would clamp expanded coordinates to `[-1, 1]` and shrink
the derived mesh; the UV accessor remains quantized because runtime fitting never writes it.
The 13 promoted Soviet colour LOD files total 4,421,272 bytes before HTTP compression and contain no image
payloads. This is the explicit startup/package trade for the far-zoom triangle reduction, not hidden texture
duplication.

Every output records triangle ratio, bounds drift and bytes in `optimization-report.json`. A candidate
is recorded as `blocked` and is not written when simplification stops above its ratio ceiling or moves
the fitted bounds by more than two percent. Shadow proxies may also pass an explicit absolute triangle
ceiling, which keeps small defence models useful when a ratio alone would be misleading. The rest of the family continues, so a UV-bound colour LOD
cannot prevent safe depth-only shadow proxies from being produced. Blocked colour LODs need real
retopology and texture reprojection.

## Texture compression gate

KTX2/Basis is live for the imported Soviet family. Run:

```powershell
$env:VM_BASISU_PATH = 'C:\path\to\basisu.exe'
npm run asset:compress-family -- --manifest tools/asset-families/soviet-buildings.json --write
```

`basisu` may instead be available on `PATH`. The tool never overwrites an approved source GLB. It writes
`compressed/*.glb`, validates every KTX2 payload with the encoder, reads every promoted GLB back through
glTF Transform, and records per-texture/file/GPU bytes in `texture-compression-report.json`.

The profile is semantic rather than one-size-fits-all:

- base colour and emissive: ETC1S quality 255, sRGB mip filtering;
- packed metallic/roughness/AO: ETC1S quality 255, linear mip filtering;
- tangent-space normals: UASTC level 2, RDO 0.50, renormalized linear mips;
- 2K landmark normals cap at 1K; small 1K defence/utility normals cap at 512.

The current 16-building family measures 52.14 -> 40.90 MiB of shipped GLBs (-21.5%). Conservative desktop
BC7 residency falls from 624 -> 104 MiB (-83.3%); ETC2/BC1-capable 4bpp targets may use about 52 MiB. Every
individual promoted GLB is smaller than its source, so a family total cannot hide a transfer regression.

Three 0.185 resolves its own matching transcoder JS/WASM through module URLs, so Vite hashes exactly one
copy into both web and Electron builds. Do not also stage `public/basis`: that duplicates about 585 KiB.
The shared runtime `KTX2Loader` detects either the initialized WebGL or WebGPU renderer, uses two workers,
and is disposed at match teardown. If a compressed asset still fails, the validated procedural model
remains the runtime fallback. Never publish `KHR_texture_basisu` assets without proving the transcoder is
present in every web and Electron build.

The five-building Meridian M1 family uses the same gate. Its corrected approved sources total 47.08 MiB;
required KTX2 containers total 20.33 MiB (-56.8%), while conservative decoded residency falls from
304 MiB to 56 MiB (-81.6%). Every structure has an approved LOD1 and an inset caster below 2,500
triangles; four also pass LOD2. The Chapterhouse LOD2 is explicitly blocked at 34.9% rather than promoted
past its manifest ceiling. The deterministic `?shot=meridian-base` fixture passes both WebGL and native
WebGPU with identical facade direction, intact PBR maps and visible structure shadows.

The five-building Meridian M2 support family extends that same renderer-neutral path. Its approved source
GLBs total 24.03 MiB and the promoted KTX2 payloads total 16.82 MiB (-30.0%); conservative decoded texture
residency falls from 240 MiB to 40 MiB (-83.3%). Pharos, Reliquary, Solar Infirmary and Slipway ship with
two colour LODs plus caster proxies. Oculus keeps its generated, textured `Body` and `Aperture` nodes at
LOD0 so the gameplay aperture can rotate without exposing a cut shell. The isolated
`?shot=meridian-support` fixture passes WebGL and native WebGPU with matching materials and shadows.

The Meridian M3 final wave promotes four of five attempted assets. Sun Vault, Helios Spire, Rampart and
Heliograph total 10.38 MiB before texture compression and 7.83 MiB after KTX2 promotion (-24.6% transfer);
conservative decoded texture residency falls from 84 MiB to 14 MiB (-83.3%). Sun Vault, Rampart and
Heliograph use 2,712/912/2,640-triangle caster proxies, while the articulated Helios keeps full
`Body`/`Head` shadows. The Heliograph also supplies 16,997 and 8,562-triangle colour LODs. Glaive was
rejected before texture spend because the generated connected shell violated its one-barrel contract; the
procedural fallback remains authoritative. The isolated `?shot=meridian-final` fixture covers this gate.

## Runtime promotion

Static imported Soviet buildings now promote their audited geometry-only caster proxies. The proxy stays
in ordinary scene traversal with a shared material that writes neither colour nor depth, while the custom
structure depth material renders it into the shadow pass. This is intentionally not camera-layer based:
WebGL tests the main camera layers during shadow traversal while WebGPU performs a shadow-camera render,
so a shadow-only layer is not a cross-backend contract. The approved LOD0 body stops casting only after its
proxy has loaded. The sentry remains on its full body/turret shadow because its runtime turret pivot cannot
be represented by one fused static proxy.

At the canonical 2560x1440, 62 m Soviet-base fixture, proxy promotion reduced submitted triangles from
1,847,459 to 1,622,364 (-225,095 / -12.2%). WebGL and WebGPU captures both retain visible structure
shadows; WebGPU reports 1,622,424 triangles, the expected 60-triangle backend delta. The trade is one cheap
vertex-only colour submission per visible imported model batch, still leaving the fixture's colour pass at
79 draws against the 130-draw budget.

The same-build 2560x1440 maximum-zoom A/B (`assetopt=off` versus default) submits 3,290,649 versus
2,871,198 triangles (-419,451 / -12.75%) and spends ten additional cheap colour submissions for the proxy
batches. With the camera held at the canonical 62 m and only `assetlod=140` forced, real WebGPU submits
1,639,158 instead of 1,814,282 triangles (-175,124), proving the colour LODs themselves render with intact
PBR textures and geometry on the node path.

Imported LOD0 models load through a bounded three-job pool, avoiding both serial startup and an unbounded
decode/upload spike.

Colour LODs are selected once per instanced model batch from the RTS camera dolly distance. Every LOD
geometry shares the batch's `aState` and `aTeamColor` attributes, so switching geometry preserves one draw
per model and performs no per-entity allocation or upload. A four-metre return hysteresis prevents zoom
damping from chattering across a threshold. LOD0 remains active for the canonical 62 m art
fixture. Validated far-distance candidates currently cover War Factory, Ore Refinery, Barracks, Radar,
Command Bunker, Naval Pen, Nuclear Silo, Ore Silo, Tesla Reactor and Flame Tower. Blocked candidates stay
recorded in `optimization-report.json` and are not written; they require real retopology rather than a
weaker simplifier gate.

Append `assetopt=off` to a local benchmark URL to disable both imported colour LODs and proxy casters for
a same-build A/B capture. The switch is deliberately opt-out: packaged builds and ordinary dev sessions
always take the optimized path unless the query is explicitly present.

Append `assetlod=140` to force the batch LOD selector to a chosen distance without moving the camera. This
is the visual-isolation gate for comparing LOD0 and far geometry at identical framing, especially on the
asynchronous WebGPU path where a page screenshot can otherwise observe the previous presented camera frame.
