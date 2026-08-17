# VISUAL GAP PLAN — closing the distance to the RA3 reference

**Written 2026-08-17 on `gfx-perf-sweep`.** Self-contained on purpose: everything needed to execute
is in this file, including the measurements, so no one has to re-derive them. Companion documents:
`docs/RENDER_FINDINGS.md` (answers that are already settled), `docs/RA3_LOOK_BIBLE.md` (the law),
`docs/SPEC_DRIFT_AUDIT.md` (claims that stopped being true).

---

## 0. THE DIAGNOSIS, IN ONE PARAGRAPH

We are not building a lower-detail RA3. We are building a **different kind of image** — one that
reads as stylised low-poly — and that is the gap. It is NOT polygon count, NOT draw calls, and NOT
missing systems. Every system is built. The specific failures are: nothing carries surface texture,
the ground is literally empty, foliage is convex faceted blobs, an entire faction renders in two
materials, and shadows leak a third of their light back. Building greebling is GOOD and is not the
problem — **do not spend a day adding panel lines.**

### Baselines to measure against (all current as of this file)

```
branch          gfx-perf-sweep
grade           92.0%, 13 failing checks — ALL of them #34 edgeCoverage
weight-3 fails  ZERO
draw calls      totals 105-157 | colour 51-77 | shadow 29-59 | ao 0 | post 21
                MAX_DRAW_CALLS budgets the COLOUR PASS = ~50 draws of headroom
triangles       0.47-0.80M per frame
gates           typecheck 0 · npm test 3611/139 files · build 0 · server:test 60/60
verify with     npm run build && npm run shots && node tools/metrics.mjs shots/*.png
A/B tool        tools/shot-compare.mjs (diffs two capture sets, ranks 96x96 blocks by delta)
```

**Every P0/P1 item below changes all 13 captures.** That is expected, not a regression. Re-baseline
and state it in the commit.

---

## P0 — FOUR FREE FIXES. Each is a measured defect against a written spec, not a taste call.

Zero draw calls, zero triangles, zero VRAM, four different files. **Fully parallelisable.**

### P0-1 · The splat classifier is off by 10x. `src/world/terrain-gen.ts:2179-2186`

**This is the single most valuable finding of the investigation, and it is a bug.**

```ts
const patch = fbm2(x * invDirt, z * invDirt, 3, 2.0, 0.5, s + 13) * 0.5 + 0.5;
const dEdge = 1 - b.dirtPatchAmount;                       // 0.78 for temperate
let dirt = smoothstep(dEdge - 0.07, dEdge + 0.07, patch);
```

`1 - amount` is a correct threshold only if `patch` is UNIFORM on [0,1]. It is not — a 3-octave
normalised simplex fbm is Gaussian. Measured over the real 256² splat grid:
**p05 0.268 · p50 0.499 · p95 0.733 · max 0.960 · σ≈0.141.** So the temperate dirt gate at 0.78 sits
**above the 96th percentile**, and sand at 0.90 past the 99.99th.

```
                  declared    ACTUAL mean weight   texels w>0.5
temperate dirt      22%          2.19-2.28%         1.74-1.88%
temperate sand      10%          0.05-0.07%         0.01-0.02%
urban     dirt      18%          0.78-0.81%         0.56-0.60%
snow      dirt      14%          0.21-0.24%         0.11-0.14%
desert    dirt      34%         14.94-15.55%       14.50-15.06%   <- only looks right by luck
```

Seed-stable to ±0.05 pp. Correct thresholds, measured, identical across all four biomes to ±0.001:

```
coverage   p66    p78    p82    p86    p90
threshold  0.565  0.621  0.642  0.665  0.690
```

**Fix:** do NOT hard-code those numbers. In `Terrain.buildSplat` (`terrain-gen.ts:2141`) add a
one-off histogram pass over the same 65 536 `patch` samples before the classification loop, and take
the `1 - amount` quantile from it — per biome, per seed, per wavelength. Two helpers,
`patchQuantile(inv, seedSalt, amount)` for dirt and for sand. Then `dirtPatchAmount` means what its
docstring at `Biomes.ts:241` says, forever, including for future biomes and any `?mapseed=`.

- **Cost:** one extra 65 536-sample fbm pass per biome build, ~1-2 ms, at boot, on the `world-warm`
  worker where `buildSplat` already runs. Zero runtime cost.
- **Determinism: SAFE.** `simplex2`/`fbm2` use only `+ - * /`, `Math.floor` and integer hashing — no
  `sin`/`cos`, no `Math.random`. A quantile over a fixed deterministic array is bit-identical on both
  lockstep clients.
- **Risk — gameplay, and it is real.** `PropDef.surfaces` masks test against `terrain.surfaceAt`
  (`Scatter.ts:637-638`). Going 2.2% → 22% dirt makes `SurfaceId.Dirt` common, which unblocks
  `containerStack` onto open ground and changes where `grassTuft` may go. Desirable, but it moves
  every prop placement, so every fixture diffs.
- **Grade:** dirt `#9C7B52` is ~28% brighter than grass `#6E6814` (127.1 vs 99.2 sRGB). Expect
  `medianLuminance` +≈0.015 on a frame that is 60-75% ground; `03` sits at 0.3758 against a ceiling
  of 0.4908, so there is 0.115 of headroom. `greenHueLeak` moves DOWN — a free win.
- **Tests:** nothing pins splat coverage. `roads.spec.ts:302` counts `Paving` only and `stampSurface`
  overwrites, so it is unaffected.
- **HONESTY:** this improves the LOOK far more than it improves `edgeCoverage`. At `03`'s 30 m
  camera one pixel is ~1.35 cm; `uSplatSharpen` 2.8 over a 2 m control texel spreads a boundary over
  ~52 px, so a 28-level colour step never trips a Sobel threshold of 25. **Do not chase #34 with
  this, and do not "fix" that by cranking `uSplatSharpen`** — above ~4 the control texture's own 2 m
  stair-stepping shows through the warp (`TerrainMaterial.ts:172-178` warns about exactly this).

### P0-2 · `shadowIntensity: 0.80` — `src/core/config.ts:592`

Three r185's `getShadow` ends `return mix(1.0, shadow, shadowIntensity)`. At 0.80 **every shadowed
pixel gets 20% of the key light added back**: `0.2 × 3.4 × sin(38°) = 0.42` of scene-linear radiance
against a hemisphere fill of 0.60. Roughly a third of everything a shadowed surface receives.

`RA3_LOOK_BIBLE.md` §3.3:165 — *"**Never use a shadow-darkness multiplier** — the hemisphere fill
does it."* This is that multiplier, by name.

```
                        R      G      B     luminance
01-establishing-base  0.446  0.515  0.561    0.499
03-terrain-closeup    0.406  0.481  0.592    0.464
bible §3.3 / §13 #7   .20-.26 .29-.35 .46-.56   0.33
```

R and G are **1.6-2.2x above band**. **The shadow HUE is already correct** — normalised to blue we
are (0.75, 0.86, 1.00) against a target (0.75, 0.80, 1.00) — so `shadowTint #565665` needs NO rework.
The failure is purely level. Set to 1.0.

- **Cost:** zero, everything.
- **Risk:** `tools/metrics.mjs` has **no shadow metric**, so this is judged by eye. `medianLuminance`
  is 0.3846/0.3758 against a floor of 0.134 and an RA3 reference of 0.342 — darkening moves us
  TOWARD the reference. Re-baseline required.
- **Optional second half:** removing the leak alone takes the ratio ~0.47 → ~0.40, not 0.33. The rest
  is `hemiSkyIntensity 0.60` (`config.ts:652`). Its "do not cut this" note quotes a measurement taken
  during the dead-uniform era (see `RENDER_FINDINGS.md` §5) and is not credible — **re-measure before
  trusting it.** A trim to ~0.48 with intensity 1.0 is the balanced move.

### P0-3 · Terrain `envMapIntensity` is never set — `src/world/TerrainMaterial.ts:722-729`

Grepped `src/render/`, `src/world/`, `ArtBridge.ts`, `config.ts`: the only live sites are
`PROP_MATERIAL` (0.55) and `UNIT` (0.80). **Terrain runs at three's default 1.0** against
`RA3_LOOK_BIBLE.md:1159` `TERRAIN: { envMapIntensity: 0.35 }`.

With `scene.environmentIntensity = 0.76` (`config.ts:713`), the ground receives **0.76 of PMREM
irradiance where 0.266 was specified — 2.86x**. On a roughness-0.95 dielectric that is almost pure
indirect diffuse: a flat fill light on the largest surface in the frame. CLAUDE.md bans
`AmbientLight` because "a flat ambient kills the shadow tint that the whole grade depends on" —
**this is that ambient, at 2.9x intended, admitted through the back door.**

Set it to 0.35. Zero cost.

### P0-4 · The building pad reads as a hole, not an apron

`src/art/BuildingDefs.ts:232-277`, material `BuildingFactory.ts:1039-1046`, palette
`RA3_ALLIED_PAD` `config.ts:5070`.

```
pad on screen        (15, 22, 40)/255   luminance 21
lit ground beside it (122,106, 30)      luminance 105
ground IN SHADOW     ( 53, 58, 17)      luminance 54
```

**The pad is 2.5x darker than a cast shadow and 5x darker than the ground.** It cannot read as
"occluded ground"; it reads as a hole cut in the map. RA3's aprons are CONCRETE — *lighter* than the
surrounding grass, with the darkening supplied by contact AO rather than by albedo.

Also uniform by construction: `BuildingFactory.build:1793-1816` keys the pad atlas and material as
`"${faction}.pad"` — **one 256 px atlas and one material shared by all 22+ structures of a faction**,
every slab sampling the same `paintSmall` tile. Only the SIZE varies.

**Fix:** repaint toward concrete (lighter than grass, low saturation, roughness ~0.90, clearcoat 0 —
`createPadMaterial` already correctly zeroes clearcoat). Consider per-structure tile variation as a
follow-up, not as part of this.

---

## P1 — cheap, large payoff

### P1-5 · Allied structure albedo is clipping, so its greebling is tone-mapped off

`RA3_ALLIED_STRUCTURE.base = '#BCC6D6'` (`config.ts:5018`), V = 0.84. Measured on a 448×448 crop of
the Allied Construction Yard:

```
                     clipped white (all ch >=250)   effective hue families (of 18)
Allied conyard crop            3.94%                        3.48
Soviet conyard crop            0.00%                        3.80
```

The atlas's whole detail language — cavity recess ×0.32, the +16% lip, the +22% V bevel — lands
**above the tone-curve shoulder** on every lit Allied facade. **The Soviet base is the in-repo A/B:**
same generator, same lighting, same fixtures, albedo V=0.44, and its panel work reads.
The greebling is not missing. It is being clipped. Lower the base value.

### P1-6 · Clearcoat is a material scalar, not a map — this is the "one plastic" read

`STRUCTURE_COATS` (`BuildingFactory.ts:1002-1009`) is four presets, one per faction, applied to the
WHOLE model — Allies glaze 0.42 @ roughness 0.26. There is no `clearcoatMap` or
`clearcoatRoughnessMap` anywhere in the tree. **A single uniform specular lobe sits over the grille,
the rivet plate, the vent louvres and the hazard stripe alike.** Clearcoat on concrete is wrong.

Minimum viable: zero clearcoat on non-paint tile classes. Proper: a `clearcoatMap` packed into the
existing atlas.

### P1-7 · `SURFACES` — a complete material-class table with ZERO readers

`src/core/config.ts:1248-1286` declares `Record<SurfaceArchetype, SurfaceLook>` with per-class
`roughnessMin/Max/variance, metalness, edgeWear, grime, clearcoat, rust, sheen` — including
`buildingConcrete` and `buildingPanel`. Typed at `types.ts:1892`, exposed as `ArtDirection.surfaces`.
`grep -rn "\.surfaces\b" src/` returns only `Scatter.ts:638,797,798`, an unrelated terrain bitmask.

`RA3_LOOK_BIBLE.md:1146-1162` defines **eighteen** classes (`CONCRETE_PAD` rough 0.90 clearcoat 0,
`DECK_STEEL` metal 0.55, `TRACK_RUBBER` 0.85, `GLASS_CANOPY`, `GLOW_AMBER`…).

**A fully-specified material system has never been wired to a pixel.** Wiring it is the single
highest-leverage material change available, and P1-6 falls out of it for free.

### P1-8 · Rust is banned by a rule that does not apply to buildings

`greeble-gen.ts:79-80` states *"ZERO GRIME. No streaks, no mud, no rust, no scratched edges
(scorecard #22)"*. Scorecard #22 (`bible:853`) actually reads *"Zero grime on **vehicles** … on any
**hull**"*. And `bible:340` says **"Rust exists only on buildings, confined to chimneys, pipes and
scaffolding: `#6A4528`/`#4D3A2E`"**.

**One generator serves units and architecture, and it applies the units-only rule to both.** That is
why there is no rust anywhere in the game. Split the rule by kind.

### P1-9 · Prop variety and density

- `SCATTER_LIMITS.maxTypes` **22** against ~31 defined archetypes. The harness logs *"8 prop type(s)
  trimmed"* on `03-terrain-closeup` — **our terrain hero shot runs 23 of 31** — while the colour pass
  has ~50 draws spare. Each prop type is ONE instanced draw. Raise to ~30: +8 colour, +8 shadow.
- **5 of 7 presets are under the bible's density**; up to **46%** of the count is grass tufts, so
  visible variety is worse than the raw number.
- `MAP_PRESETS.props` `preferred` lists contain **dead strings** — `'tree'`, `'pine'` where the real
  keys are `boulder`/`rockCluster`/`conifer` (`Scatter.ts:900` does `preferred.indexOf(def.key)`), so
  the preference has been silently doing nothing. Verify and fix.

### P1-10 · Terrain has no normal map and one scalar roughness

`TerrainMaterial.ts:722-729` is albedo + `uLayerRough` (`:190`, blended by splat weight at `:472`).
With ~96% of open ground on layer 0, **roughness is the constant 0.95 everywhere** — no specular
breakup anywhere on 60-75% of the frame.

`Roads.ts:1389-1408` by contrast does `map + normalMap + roughnessMap + aoMap` from
`materialTextureSet`. That is precisely what the road generator does that terrain does not, and it is
why the road measures 0.2100 edge coverage 200 px from ground measuring **0.0000** in the same frame.

Add a normal map + spatial roughness via the existing `surfaces.ts` packer. **Structure only** — see
the DO-NOT list.

---

## P2 — real work, still worth it

### P2-11 · Canopy: 4 convex ellipsoids → ~28 small lobes

`broadleaf()` `src/world/PropLibrary.ts:970-1015`; canopy is four `m.blob(...)` at `:1011-1012` with
`segs=10, rings=5`. `blob` is `:578-620`, a plain faceted ellipsoid.

At `01`'s 32.2 px/m, a facet is `2π·4.2/10 = 2.64 m` **≈ 85 px** — and ~170 px in `03`. The chord
sagitta gives ~6.6 px of dead-straight edge per segment: the hard polygonal rim. And four overlapping
ellipsoids are **convex by construction — they cannot produce a hole**, which is exactly what makes
RA3 canopies read organic.

Replace with 6-8 branch stubs, each ending in 3-5 small lobes at `blob(r≈0.6-1.1, 6, 3)`, jittered so
the union is non-convex. Keep `facetJitter` — at a 0.8 m lobe facets are ~16 px, still crisp and
still legal under the noise rule.

```
             shipped        proposed
trunk+roots  224 tri        224
branches     144            ~96
canopy       320 (4x80)     ~672 (28x24)
per tree     688            ~992  (+44%)
```

**0 extra draw calls** (same InstancedMesh, same material, same program). At 80-150 visible trees
that is +50k-90k triangles against 0.47-0.80M — **~+6-11% triangles, and triangles are not the
constraint.** `scatter.spec.ts:73,117` both pass with room.

### P2-12 · Team colour: the validator counts one surface out of four

`MassList.ts:1483-1490` counts `visible.teamSlab` and nothing else. `glass` and `insignia` are in the
`visibleArea` DENOMINATOR and in no numerator at all — and on Allies they are the same blue:

| surface | hex | hue | counted? |
|---|---|---|---|
| `teamSlab` | `#2A2ED0` | 238° | yes |
| `insignia` field | `#1C169A` | 244° | **no** |
| `glass` | `#0F2E60` | 216° | **no** |
| pad | `#172231` | 214° | **no** (separate material) |

Measured on an Allied tank crop: **52.2% of chromatic pixels at 220-240° plus 13.4% at 200-220°.**
The validator can read a green 13% while the camera sees a two-thirds blue vehicle. `UnitDefs.ts`
gives each hull **7 `glass` masses against 1 `teamSlab`**. Note the camera-pitch half of this is
recorded in `RENDER_FINDINGS.md` §3 and pitch is DECIDED — leave it alone; fix the accounting.

### P2-13 · Contact pools exclude the things that most need them

`ContactShadows.ts:117-122` admits Infantry/Vehicle/Building only, so **scatter props get nothing**
— and props were also measured and rejected for AO-prepass exclusion precisely because nothing else
grounds them (`RENDER_FINDINGS.md` §4).

---

## P3 — days of work, real risk. Do not start before P0-P2 are measured.

### P3-14 · Alpha-tested leaf cards
Blocked on plumbing that does not exist: `PropMesh.toGeometry()` (`PropLibrary.ts:705-721`) emits
`position, normal, color, aSway, aEmit, aGloss` and an index — **no `uv`**. `grep -rn "alphaTest"
src/` returns **nothing**; there is zero alpha-tested geometry in the project. Every primitive
(`box, cyl, disc, blob, cone, blade, tri, quad`) would need a UV, and `mergePropGeometries` requires
identical attribute sets so it is all-or-nothing. Plus `alphaTest` kills early-Z on the ANGLE/D3D11
path, on tall overlapping canopy quads with heavy overdraw. 1-2 days, and the overdraw risk is real.

### P3-15 · Per-unit texture individuality
One 512 px atlas per faction, 128 px per tile, ~33 models, tile chosen by **area bucket alone**.
Binding constraint is atlas VRAM, not the no-downloads rule.

---

## PARALLEL TRACKS

| track | items | files |
|---|---|---|
| **A · Terrain** | P0-1, P0-3, P1-10 | `terrain-gen.ts`, `TerrainMaterial.ts` |
| **B · Structures** | P1-5, P1-6, P1-7, P1-8 | `BuildingFactory.ts`, `greeble-gen.ts`, `BuildingDefs.ts` |
| **C · Props** | P1-9, P2-11, P2-13 | `PropLibrary.ts`, `Scatter.ts`, `ContactShadows.ts` |
| **D · Lighting/palette** | P0-2, P0-4 | `config.ts` |

> **⚠️ `src/core/config.ts` is touched by ALL FOUR tracks.** Serialize config edits, or partition by
> named block and forbid anyone from touching another track's block. This is the one guaranteed
> collision.

> **⚠️ Worktree agents branch from `main`, NOT current HEAD.** Every agent must
> `git merge gfx-perf-sweep` as step 0, then `npm install && npm ci --prefix server`. Verified the
> hard way this session.

---

## DO NOT

1. **Do not smooth foliage normals.** Measured negative result: props are flat-shaded by construction
   (`PropLibrary.ts:678-701`), `scatter.spec.ts:86-98` asserts it across every prop type, scorecard
   #40 asks for it deliberately, and sharing vertices deletes `facetJitter` — the only per-facet
   detail props have. A smooth-shaded 10×5 ellipsoid in one flat olive is a green balloon.
2. **Do not crank `uSplatSharpen`** past ~4 — the control texture's 2 m stair-stepping shows through.
3. **Do not add per-pixel noise anywhere.** The flatness is a deliberate defence against a build
   where "roads looked like TV static". Structure — soil patches, wear paths, gravel, ruts — never
   variance. Any proposal amounting to "turn the noise back up" is wrong.
4. **Do not add more panel lines to buildings.** The greebling is good; it is being CLIPPED (P1-5).
5. **Do not chase `edgeCoverage` #34 directly.** It is correctly reporting the ground, and the fix is
   P0-1/P1-10. See `RENDER_FINDINGS.md` §2 — the demotion on branch
   `metrics-edgecoverage-measurement-frame` is deliberately NOT merged.
6. **Do not touch camera pitch.** DECIDED: leave as is.
7. **Do not merge `terrain-halfres-lod` or `scatter-ao-occluder-ab`.** Both parked with reasons in
   `RENDER_FINDINGS.md` §4 and §6.
8. **Do not reintroduce grain, chromatic aberration, or the double sRGB conversion in
   `Placement.ts`.** All three were removed this session; the first two had been shipping LIVE.

---

## ALSO PARKED (raised, not yet scheduled)

- **A real per-frame `GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format and
  sampler type`**, reproduced identically on the baseline build so it predates all current work.
  Never chased. Deserves its own task.
- **`08-naval-water`'s green leak sits at 0.0171 against a 0.02 ceiling** — 15% margin, and its cause
  is content-specific (a tree canopy plus a shore gradient), so it is the value most likely to drift
  back.
- **The cleanup pass** the user asked for — dead code, unused files, doc accuracy, TODO consolidation,
  version bump, deploy — has been audited but NOT applied. Headline items: `QUALITY_PRESETS` has 11
  of 12 fields dead and its `resolutionScale` disagrees with the live table; `GOVERNOR_*` constants
  are a second dead table that also disagrees; `SHOT_WIDTH/HEIGHT` are dead AND wrong (1920×1080 vs
  the harness's 2560×1440); `ArtDirection` has 7 sub-blocks that reach nothing; `kindMeshFor` and the
  multiplayer `stallMs`/`sampleStall` pair are unwired; only `wedge.mjs` and `gpu-profile.mjs` are
  genuinely unreferenced in `tools/`.
