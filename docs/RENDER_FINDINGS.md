# RENDER FINDINGS — questions that are ANSWERED, so nobody pays for them twice

**Measured 2026-08-17, on `gfx-perf-sweep` at `22b123c`.** Every number here came out of an
instrument, not an argument. Re-measure before quoting any of it in a release note — but do NOT
re-derive it from scratch, which is what this file exists to prevent.

`docs/SPEC_DRIFT_AUDIT.md` catalogues claims that stopped being true. This file is the opposite:
things that were expensive to find out and are now settled. When an entry here is overturned by a
later measurement, **rewrite the entry and say what overturned it** — do not append a contradiction
and leave both standing.

---

## 1. The draw-call budget was never being missed

`renderer.info.autoReset` is `false` and the reset happens once per frame in `beginFrame()`, so
`frame.drawCalls` in `shots/_report.json` is a **SUM OVER EVERY SCENE SUBMISSION**, while
`MAX_DRAW_CALLS` (130) budgets the COLOUR PASS ALONE. Quote `frame.drawCallsByPass.colour` against
the budget; quote `frame.drawCalls` only as the content fingerprint it is.

**THIS ENTRY SAID "THREE SCENE SUBMISSIONS" AND IT IS TWO.** The original measurement was

```
01-establishing-base:  219 total = 78 colour + 54 shadow + 67 AO prepass + 20 post quads
```

and the AO prepass in it is gone: `installAoDepthGBuffer` in `src/render/post.ts` hands `GTAOPass`
the depth the colour pass already wrote and reconstructs normals with one full-screen quad, so
`_renderGBuffer` is false and `ao` is **0 on all thirteen fixtures**. A non-zero `ao` now means that
wiring failed and the prepass came back.

`stats()` and `_report.json` carry `drawCallsByPass` = `{shadow, colour, ao, post, total}`,
reconciling exactly on all 13. **Current measured range: colour 54–77, shadow 29–59, ao 0, post 21,
total 105–157.**

> **THE ORIGINAL GUIDANCE HERE — "there are ~50 colour draws of headroom and the project should be
> SPENDING them" — IS NOT WRONG BUT IT IS NOT THE LEVER, AND §9 IS WHY.** Draw submission is not what
> costs us: profiled at 194 units and 2560x1440, the CPU is idle 88% of the frame and 79–90% of GPU
> time is proportional to PIXEL COUNT. Extra draws are close to free; extra *shaded pixels* are the
> whole cost. Spend the headroom on content that adds silhouette and edge density, not on anything
> that adds overdraw or another full-screen pass.

**WEBGPU CHANGES THIS INSTRUMENT AND DOES NOT SAY SO.** Measured on a genuine WebGPU device:
`info.render.calls` is per-frame draws on WebGL but a **monotonic lifetime count of `render()`
invocations** under WebGPU, which `reset()` never clears — per-frame lives in `render.drawCalls`.
`info.programs` is `undefined`, so `debug.ts`'s `?? 0` reports 0 forever. Nothing throws. Read
through `normaliseInfo()` / `handle.frameInfo()` in `src/render/backend.ts`, never `renderer.info`
directly, or every draw-call number in this project silently becomes fiction on the node path.

---

## 2. `edgeCoverage` (#34) — TWO agents reached opposite conclusions; here is the resolution

This is the most important entry in this file. Do not act on either half alone.

**The conflict.** One investigation concluded the check is unpassable by legitimate authoring and
should be demoted to informational. Another concluded that failing 13/13 is CORRECT and is detecting
a real defect. Both were measured competently. They disagree because **they measured different
things**:

| what was measured | result |
|---|---|
| SUBJECT crops (units, buildings) — what bible §34 actually specifies | **in band**: 03's subject blocks 0.4021, inside the 0.40–0.46 building band |
| GROUND / terrain surface | **~4x under**: 0.96–1.59% Laplacian against the bible's ±3–6% |
| WHOLE FRAME (what `tools/metrics.mjs` scores) | fails 13/13 |

The frame is **60–75% ground**. So the whole-frame metric fails *because the terrain is genuinely
under-detailed*, while the units and buildings it also averages over are fine.

**CONCLUSION: do not demote the check.** Doing so would silence the one metric correctly reporting
the single largest visual problem in the project. The branch
`metrics-edgecoverage-measurement-frame` holds that demotion and is **deliberately unmerged**.

**What IS settled about the instrument, and is worth keeping:**

- The band shown at runtime (`[0.5996, 0.8547]`) is NOT the bible's asserted `[0.20, 0.46]`. It is
  rebased from `docs/grade-baseline.json` because the metric carries `baselineKey: true`.
- **The reference geometry was recorded all along** — `SPEC_DRIFT_AUDIT.md` finding 17: ten
  1440×1080 and four 1024×768 JPEGs. Nobody needs to guess it again. Note the corpus mixes two
  geometries 40% apart in linear scale, so part of the band's width is pure geometry mixing.
- The resolution transfer factor, measured over all 13 captures resampled to that geometry, is
  **1.264 ± 0.039** (CV 3.1%) — but it is **not a clean multiplier**: r = −0.78 against native
  coverage, a saturation effect, so no single rescale is correct.
- Even fully normalised, **0 of 13 reach the floor**; resolution explains only ~29% of the gap.
  Closing the rest with *noise* would need gaussian luma at σ≈8/255, which CLAUDE.md bans. Closing
  it with *structure* is the open route — see §3.

---

## 3. The AAA gap is UNDER-TUNING, not missing systems, and not the procedural constraint

The systems are all built: greeble generator (1,667 lines, panel lines, rivets, cavity darkening,
vector insignia), `MeshPhysicalMaterial` with clearcoat, normal + ORM maps, baked vertex AO, PMREM
procedural env cube, contact shadows, extruded kerb geometry, per-instance hue/value jitter,
authored terraces. **Then almost every one was individually de-tuned toward its noise floor, each
with a written justification, and nobody measured the product.**

**The argument that settles "is it because the art is procedural?" is internal to this repo: the
ROAD generator hits the bible's detail band (3.80% measured) from pure code, today, while the
TERRAIN generator delivers 0.96–1.59% against the same ±3–6% requirement.** Same constraint,
different tuning. Procedural generation is not what is holding the look back.

Honest residual that the no-downloaded-assets rule *does* cost: **tree canopies** and **per-unit
texture individuality**. Nothing else on the list. (And the second is bound by atlas VRAM, not by
the rule.)

### Measured caps, all against a budget that is half empty

| system | shipped | spec | where |
|---|---|---|---|
| explosion light peak | **5** | 28 | `config.ts:5523` |
| muzzle flash light | **3** | 12 | `config.ts:5526` |
| tesla impact light | **1.4** | 14 | `config.ts:5531` |
| flash disc / fireball size | — | — | 2.6–3.3× undersized |
| ground albedo drift cap | 0.06 | — | `terrain-texture-gen.ts:149` |
| splat mask warp | ±0.275 m | ±0.6 m *per its own header* | `TerrainMaterial.ts:44` vs `:178` |
| scatter prop types | **22** | ~31 defined | `config.ts:7804` |

**The VFX re-tune's blocking precondition is already satisfied and written down.** `config.ts:5462`
says to re-derive these against a fixed grade of ACES @ 0.92; the grade **is** ACES @ 0.90 now. Every
cut above was measured against an AgX frame sitting 1.5–2× too bright.

**Three config comments contradict the code directly beneath them** (`config.ts:5469-5471`,
`:5479-5492`, `:6365-6366`), including one claiming the values "stay at the bible's authored
numbers." **Fix those before any re-tune or it starts from fiction.**

### Verified dead: `treadPhase`

Allocated in `core/world.ts`, written every tick by `sim/Movement.ts` and `sim/Harvesting.ts`, saved
to disk by `SaveGame.ts`, documented at `config.ts:1211` as *"UV scrolled by treadPhase"* — and
**read by nothing in `src/render/` or `src/art/`.** Tank tracks are frozen textures. Confirmed by
grep, not inferred.

### Camera: three different pitches are documented in three places, none of them the bible's 39°

- `config.ts:349` — `pitchDeg: 52`, an orphan.
- `renderer.ts:422-423` — the LIVE rig, ramping 46° → 58° with zoom. The bible requires pitch
  **constant** at all zoom levels.
- a `BUILDING_DIMENSIONS` comment reasons about *"a fixed 38-degree camera"* while sizing rooflines.

Yaw measures **12–34°** across the 13 fixtures against the bible's 45° and a reference cluster of
45–53°. Consequence: you are looking at roofs and top decks, which is where the team-colour slabs
live (R-T3), so tanks read ~40% blue while `MassList.ts:1483-1501` correctly asserts 8–14% of
surface area. **The validator is right and the camera is defeating it.**

> This one is a PRODUCT DECISION, not a bug. 52° was chosen so a tall shed would not hide the
> vehicle parked under it. Flattening trades base legibility for silhouette, and requires
> re-deriving all 13 shot poses and `tests/shot-camera.spec.ts`. Do not "fix" it unilaterally.

---

## 4. Things that were tried, measured, and REJECTED — do not retry without new information

**Scatter → `BatchedMesh`.** Looks like the largest available win (66 → 3 draws) and is a trap:
`BatchedMesh` emits one multi-draw entry **per instance**, not per geometry, so it trades 22
hardware-instanced draws for ~1000 sub-draws, three times a frame, on an ANGLE/D3D11 context where
`WEBGL_multi_draw` is a validated CPU-side loop. `info.render.calls` falls while real submissions
rise ~30×. Scatter is the textbook case *for* `InstancedMesh`.

**Excluding scatter props from the GTAO G-buffer.** Saves 14–22 draws/frame (267 over the set) and
moves the scorecard by **0.000000**. Rejected on look: an excluded mesh's pixels sample whatever
depth is BEHIND it — nearly exact for a 40 mm pad, wrong by the whole height for anything standing
proud, measured at **max delta 171/255** as a dark fringe on a cafe umbrella's top edge. Props also
have no other grounding: `ContactShadows.ts:117-122` reads the ENTITY store and scatter props are
not entities. The honest route is to give them a contact decal FIRST, then exclude. Diff and crops
preserved on branch `scatter-ao-occluder-ab`. **The general rule is now in `post.ts#aoOccluder`:
exclusion is free for near-ground geometry and wrong for anything proud of the surface behind it.**

**The bible's bloom threshold/strength pair.** Captured at threshold 1.05 / effective strength 0.55
and it cost **1.8 points of grade** (89.2% → 87.4%), breaking `08-naval-water`'s saturation floor and
inverting its aerial-perspective delta. Reverted to 1.20 / 0.42. **`radius` 0.34 was KEPT** — that
one is structural, not an energy knob: at 0.70 the five mip weights run *ascending* (0.44 → 0.76) so
the widest, veiliest mip dominates.

**Lowering shadow `radius` to reach the bible's penumbra band.** Already done in an earlier release;
the live value is `shadowSoftness` 1.0. `renderer.ts:374-384` is a DEAD fallback table that
`ArtBridge` overwrites at boot — four separate findings once cited it by mistake. Check which table
is live before quoting a shadow number.

**Lifting a banned effect.** A dedicated search for a case to argue found **none**. `farNearSatDelta`
is positive on 11 of 13 fixtures, which is the bible's own signature holding. Grain and chromatic
aberration were in fact live for the project's entire life (see §5) and nobody liked the result.
The bans are correct.

---

## 5. Reading `config.ts` is NOT the same as knowing what the shader did

`ShaderPass`, handed a plain shader **description**, does `UniformsUtils.clone(shader.uniforms)` — a
deep copy. It aliases only when handed a real `ShaderMaterial`. The grade pass was built the first
way, so `gradeUniforms` was a detached object and **every write to it went nowhere for the pass's
entire life**: `syncConfig`, the `uTexel` write in `setSize`, and the per-frame `uTime`.

Fixed in `22b123c`. What it had been hiding:

1. The whole 3-way colour balance was inert — `shadowTint`, `midTint`, `highlightTint`, `lift`,
   `gain`. An entire measurement campaign in `config.ts`'s shadowTint block moved a uniform the
   shader never saw.
2. **Grain (0.016) and chromatic aberration (0.0016) were LIVE**, both banned by name, both
   correctly `0` in config, and config reached nothing.
3. The unsharp mask sampled a 1920×1080 texel grid at 1440p.
4. `uTime` never advanced — **the only reason the shot harness never caught the grain.** A frozen
   hash is byte-identical run to run, so the harness certified stability over an effect banned for
   being unstable.

`tests/banned-effects.spec.ts` passed throughout, because it scans config source literals and those
were right.

**Two lessons, both general:**

- A test that reads the CONFIG proves nothing about the SHADER. When it matters, read the uniform
  off a booted page.
- **Every value in `TONE_NOON` is now unverified.** It was tuned by people watching a screen that
  could not respond to them. Treat those numbers as folklore until re-tuned.

Related, same commit: `Placement.ts` chained `.convertSRGBToLinear()` onto `setHex()` in five places
— the only five such calls in the codebase — but with `ColorManagement.enabled = true`, `setHex`
already converts. `#4ADE80`, a soft mint, reached the screen as `rgb(17,186,55)`, a pure emerald.
**Fixing it made scorecard #9 WORSE** (09-placement 0.0383 → 0.0516), which is expected: the authored
hex was chosen to look right through a bug.

---

## 5b. The flash "regression" is not one — the budget was LOCAL and the screen is not

**Measured 2026-08-17 for the SEVENTH brightness report** ("flashes become huge again with 100%
brightness, cant see nothing in fight"). Three answers, each of which cost a run, and the first two
are the ones that will otherwise be re-derived.

**1. Nothing regressed. There is no commit to point at.** Every constant in `VFX_GLARE`,
`VFX_LIGHTS` and `VFX_EXPLOSION` is byte-identical from v1.24.0 (`bb3022a`, the last flash pass)
through v2.12.0 — compared field by field across five release commits. `exposure`, `contrast`,
bloom `threshold` and bloom `strength` are unchanged too. The only render change in that window that
could plausibly touch a flash is `bloom.radius` 0.70 → 0.34 at v2.11.0, and **it is not the cause**:
rebuilt with 0.70, the failing case measures 16.003% of frame over L=0.95 against 15.580% at the
shipped 0.34, which is inside the presentation-RNG spread. Do not re-run that A/B.

**2. `tools/flash-stack.mjs` had measured the bounded case six times in a row.** Every sweep it has
ever run packs its emissions into a **4 m spiral** — inside `VFX_GLARE.radiusM` (7 m) and inside
every `mergeRadius` in `VFX_LIGHTS` (4–9 m). So both stacking bounds fired on every measurement ever
taken with it, and both were duly reported working. A firefight is 30–40 m across; at
`CAMERA.defaultDistance` 55 m the focus plane is 35.7 m tall, so that is one screenful. Measured at
1280×720 on the 55 m dolly, twelve unit deaths, frame area over L=0.95 against a 2.430% baseline:

```
one death                      3.991%   (+1.56pp)
twelve inside 4 m              5.442%   (+3.01pp)   <- the only case the tool could see
twelve across 18 m            15.580%  (+13.15pp)   <- what the report is about
```

The tool now sweeps `SPREADS = [4, 18]`. **Do not delete that axis to save renders.**

**3. The point-light pool is NOT the offender and `VFX_LIGHT_MERGE_CEIL` is not leaking.** With
every VFX sprite and ribbon material hidden (`VfxAdditive`, `VfxLitSmoke`, `VfxDebris`,
`VfxBeamOverlay`, `VfxRibbonDepth`, via `material.visible` — never `mesh.visible`, which the pools
reassign on upload), twelve spread deaths cost **+0.95pp**, against +13.15pp with them drawn. The
merge saturates at 1.9× `basePeak` exactly as `LightPool`'s own header claims. This overturns the
older note in `config.ts` that called the light pile the largest single lever; that note was taken
through the mask that never worked, and `VFX_EXPLOSION.outputGain`'s block already records the
correction.

The fix is a second glare tier at the scale of the frame (`VFX_GLARE.wide`, 34 m / ceiling 4.0 /
exponent 3.0). After it, twenty deaths across 18 m go **36.200% → 14.314%** blown (frame mean
0.7172 → 0.5440), while one death is bit-identical (4.253% either side) and twenty inside 4 m barely
move (12.739% → 12.290%). Weighted grade unchanged at 92.0%, 13 failures, all #34.

**Dead knobs found on the way**: `VFX_NOON.muzzleMs`, `muzzleSize` and `muzzleColor` are declared on
`VfxLook` in `types.ts`, set in `config.ts`, and **read by nobody**. The live muzzle numbers are
`VFX_GUNS.flash[].lifeMs` and `VFX_GUNS.flash[].widM/lenM`. Tuning the `VFX_NOON` trio changes
nothing on screen.

---

## 6. Smaller settled facts

- **GTAO's prepass is DELETED — done, shipped, `ao` is 0 on all 13 fixtures.** Totals fell 38–56 per
  fixture (−639 summed); the colour pass is byte-for-byte unchanged and the grade is unchanged to
  four decimals (0.892308 / 16 failures either side).

  **Do NOT "simplify" it to `setGBuffer(depth)` alone.** That form sets `normalVectorType = 0` and
  reconstructs normals in-shader, and it is a false economy here: `GTAOShader` calls `getViewNormal`
  once per pixel, but **`PoissonDenoiseShader` calls it 17 times per pixel**
  (`PoissonDenoiseShader.js:152`). Depth-only would trade 39–57 *measurable* draw calls for ~150
  depth fetches and ~50 `mat4*vec4` per denoised pixel — a cost the shot harness cannot see. The
  shipped form reconstructs the normal ONCE with a single quad into a target `GTAOPass` already
  allocates. An earlier note in this file recommended the depth-only route; it was wrong.

  **The predicted water regression was real in mechanism and BACKWARDS in sign.** The fear was that
  feeding composer depth would make the sea an occluder and delete seabed AO. Measured as mean
  |delta| against an AO-disabled capture of the same build — i.e. how much AO the frame actually
  receives — the naval fixtures **GAINED**:

  ```
                         prepass   depth G-buffer
    08-naval-water        2.1427       2.4826
    13-atoll-crossing     1.7485       2.1786
    01-establishing-base  3.5431       3.5204
  ```

  Because water was EXCLUDED from the old prepass, every water pixel had been sampling the depth
  behind it — the seabed, metres below — so the ocean was wearing the seabed's occlusion. That is
  the umbrella defect (§4) at map scale. On screen the gain is a contact shadow at each hull's
  waterline: a warship used to sit *on* the sea rather than in it. No prepass, stencil or mask was
  needed. `installAoOccluderFilter` is kept as the fallback path for the old prepass, and a non-zero
  `ao` in `_report.json` is the signal that it fired.
- **Terrain LOD: built, correct, and DELIBERATELY NOT MERGED (decided 2026-08-17).** Branch
  `terrain-halfres-lod`. A second index over the same vertices gives a flat chunk 2424 triangles
  instead of 8192 (−70.4%); the boundary ring stays at full resolution so every chunk-edge sample is
  still a triangle corner, which makes cracks *arithmetically impossible* rather than merely
  unlikely and removes the need for any neighbour-agreement pass. Gate is `cliffTris === 0` (reusing
  the existing relief metric, so LOD cannot disagree with `castShadow`) plus a measured
  `lodError ≤ 0.15 m`, which is under every hull's ride height — load-bearing, because units and
  props are placed from `heightAt`, not from the drawn mesh.

  **Why it is parked, and do not re-propose it without new information:** it qualifies **4 of 64
  chunks** on the seed ten of thirteen fixtures use (7 / 5 / 6 / 16 on the other maps), ~1.5% of
  terrain. And it is pointed the wrong way — triangles are not the constraint (draw calls are, and
  the colour pass has ~50 spare), while the headline visual finding is that the ground has too
  LITTLE detail (§3). Adding the ground structure §3 calls for would reduce the qualifying count
  further. `tests/terrain-lod.spec.ts` pins the counts, so if a future generator pass makes maps
  flatter this becomes worth having and the test will say so. Merge is one command away.
- **The scatter shadow-radius gate saves nothing today.** All 31 shipped `PROP_DEFS` clear 0.70 m
  (smallest is `bench` at 1.182). It is an enforced invariant for the next small prop, not a win.
- **WASM would not help the frame.** The bottleneck is GPU, and the JS here is already in the shape
  WASM wins against (SoA typed arrays, caller-supplied outputs, pooled spawns, zero-allocation
  loops). The two honest cases are (a) **determinism** — ECMA-262 pins only `+ - * /` and `sqrt`, so
  shipping your own libm would make `sin`/`cos` bit-identical across engines and remove the
  axis-aligned-ellipse constraint — and (b) **boot-time procedural generation**, where SIMD has no
  JS equivalent. Do not port the live sim on a hunch; it runs at 30 Hz and the lockstep gate stalls
  on the network, not on compute.

---

## 6b. `shadowIntensity` is a BANNED knob that still cannot be removed on its own

**Measured 2026-08-17 by bisect, one knob moved per capture, everything else held constant.**

`RA3_LOOK_BIBLE.md` §3.3:165 bans it by name — *"Never use a shadow-darkness multiplier — the
hemisphere fill does it."* — and `LIGHTING.shadowIntensity` is 0.80, i.e. 20% of the key handed back
to every shadowed pixel. That is real: `0.2 x 3.4 x sin(38deg) = 0.42` of scene-linear radiance
against a hemisphere fill of 0.60. Measured shadow/lit per channel before any change:

```
01-establishing-base   0.446  0.515  0.561   luminance 0.499
03-terrain-closeup     0.406  0.481  0.592   luminance 0.464
bible §3.3 / §13 #7    .20-.26 .29-.35 .46-.56  luminance 0.33
```

R and G are 1.6-2.2x above band. **The HUE was already right** — normalised to blue, (0.75, 0.86,
1.00) against a typical target of (0.75, 0.80, 1.00) — so `shadowTint` needs no rework and the
failure is purely level. Everything above says "set it to 1.0".

**Setting it to 1.0 alone makes the grade worse, and that is the finding:**

```
                     grade   weight-3 failures
0.80 (shipped)       91.1%   1   (03 p99, owned by the Allied structure albedo)
1.0                  90.2%   2   (+ 09-placement scorecard #9: 0.0123 -> 0.0640, ceiling 0.02)
```

The mechanism is not subtle once seen. The key is WARM, and while it leaks into shadow it washes
shadowed grass toward yellow-olive. Remove the leak and shadowed ground is lit by the fill alone,
which is bluer; on a green albedo, raising B toward R walks the hue up into scorecard #9's 100-120
"amateur emerald" window. Measured shadowed ground moved from (53,56,21) at hue 65 to a population
centred on (42,58,39) at **hue 110**.

**And this is our fill being too blue, not the metric being unfair.** The bible's own typical shadow
ratio (0.75, 0.80, 1.00) applied to our grass `#666B44` computes to **hue 91** — outside the window
with room to spare. A correctly-tinted shadow does not trip #9. Ours is bluer than the bible's,
which is a statement about `hemiSky` / `hemiGround` / the env probe.

**So: it is a PAIRED change.** Go to 1.0 and re-balance the hemisphere in the same commit, then
re-measure #9 and the shadow/lit ratio together. Do not raise it on the strength of the bible quote
alone — the capture above is exactly what that costs. This is the one item from
`VISUAL_GAP_PLAN.md` P0 that did not land clean, and it was deferred deliberately rather than
bundled with the albedo and environment-response fixes, which did.

Note also what this does NOT license: **there is no test pinning `shadowIntensity`.** Asserting 1.0
would fail and asserting 0.80 would pin a defect, so `tests/lighting-law.spec.ts` carries a comment
where the assertion should be. That is intentional — a green suite must not become evidence for the
wrong thing.

---

## 6c. Terrain `envMapIntensity` is INERT — `VISUAL_GAP_PLAN.md` P0-3 names the wrong lever

**Measured 2026-08-17 on a booted page, whole-frame per-pixel diff, with `needsUpdate` forced so the
uniform really was pushed.**

P0-3 asked for `envMapIntensity: 0.35` (bible line 1159) on `TerrainMaterial.ts`'s
`MeshStandardMaterial`, reasoning that the unset three default of 1.0 was admitting a flat ambient at
2.86x the specified level over 60-75% of the frame. **The premise is half right and the lever does
not work.**

```
material.envMapIntensity   0.0 -> 8.0     0 pixels changed        max delta 0
scene.environmentIntensity 0.0 -> 6.0     110 525 / 110 526 terrain px   max delta 254
CONTROL: terrain.color -> green           30.78% of frame         max delta 234
```

The control is the load-bearing row — it proves the instrument reads that material's pixels through
the identical code path, so "0 changed" is a fact about the knob and not about the probe. (Two
earlier runs of this were WRONG and are worth knowing about: one sampled a 128x128 centre crop where
terrain was a small minority and reported a mean that could not have resolved the effect, and one
omitted `needsUpdate`, so three never pushed the uniform at all. Only the version with both a max-delta
statistic and a working control is quotable.)

**What this means:**

1. **Terrain is strongly environment-lit** — scaling the scene probe moves essentially every terrain
   pixel to saturation. So the plan's underlying worry, that the ground carries a large flat indirect
   term, is REAL and still unaddressed.
2. **The only live control is global**: `LIGHTING.envIntensity` -> `scene.environmentIntensity`, set
   in `scene.ts`. There is no per-material dial for the ground today.
3. `USE_ENVMAP` IS defined in the terrain program and `getIBLIrradiance` / `getIBLRadiance` are
   present (2 and 4 call sites), so this is not a missing feature.

### THE CAUSE, FOUND 2026-08-17 DURING THE TSL PORT. It is not this material.

The paragraph above used to end "something in this material's custom-program path is not taking the
uniform", and that guess sent the fix in the wrong direction — into the injected GLSL and a
`customProgramCacheKey` bump. **The custom-program path has nothing to do with it.** three overwrites
the uniform every frame, for every standard material in the game that has no `envMap` of its own:

```js
// three/src/renderers/WebGLRenderer.js:2693
if ( ( material.isMeshStandardMaterial || material.isMeshLambertMaterial
       || material.isMeshPhongMaterial )
     && material.envMap === null && scene.environment !== null ) {
  m_uniforms.envMapIntensity.value = scene.environmentIntensity;
}
```

`scene.environment` is set in `scene.ts` and terrain carries no `envMap`, so both conditions hold and
the assignment lands after every `refreshMaterialUniforms`. Writing `material.envMapIntensity` cannot
survive to a draw. **That is the whole of it**, and it explains the measurement exactly — including
why the control worked.

**THE NODE PATH IMPLEMENTS THE SAME RULE ON PURPOSE, so the migration does not close this for free:**

```js
// three/src/nodes/accessors/MaterialProperties.js:21
materialEnvIntensity = uniform( 1 ).onObjectUpdate( ( { material, scene } ) =>
  material.envMap ? material.envMapIntensity : scene.environmentIntensity );
```

Re-measured on `WebGPURenderer`'s real WebGPU backend with `tools/terrain-node-compare.mjs`
(`TerrainNodeMaterial`, 640x480, `scene.environmentNode`):

```
sun 2.4 -> 0        CONTROL ON THE CONTROL      99.756% of px    max delta 61
material.envMapIntensity 0 -> 8, no own envMap   0.000% of px    max delta 0
scene.environmentIntensity 0 -> 6   CONTROL     99.792% of px    max delta 211
```

Identical behaviour, on a material that has no custom-program path at all. Two probe defects were hit
getting there and both are worth knowing: measuring the WebGPU canvas in-page via `drawImage` into a
2D context returns a blank buffer, so EVERY row including the control read zero; and
`scene.environment` set to a raw equirect `DataTexture` contributes nothing on the node path, because
`EnvironmentNode` reaches it through `pmremTexture()`. `PMREMGenerator` cannot pre-filter it either —
it draws with a raw `ShaderMaterial`, which the node renderer refuses out loud. The sun row exists
because two successive dead instruments is enough.

### THE EXIT IS ONE LINE, AND IT WORKS ON BOTH RENDERERS

Both rules key off the same thing: **give the material its own `envMap` and `envMapIntensity` becomes
live.** `material.envMap = scene.environment` satisfies the WebGL guard and the node accessor at
once. `TerrainNodeMaterial.setEnvironment(env, intensity)` is that, and it is INERT until called, so
nothing changes until someone asks.

**Land it at `scene.environmentIntensity`, not at the bible's 0.35.** That reproduces today's
appearance exactly — `materialEnvIntensity` resolves to the same number either way — and makes the
knob editable without moving a pixel. Changing the ground's brightness is a separate decision, and
§6b is a fresh reminder that a change which is bible-correct in isolation can still cost grade
points, so it must be captured and scored on its own.

**Do not re-attempt this as a one-line config edit on `envMapIntensity` alone.** That has now been
tried and disproved twice, on two renderers, and the reason is written above.

---

## 9. WHERE THE FRAME ACTUALLY GOES — we are fill-rate bound, and it was never measured before

**Measured 2026-08-17 with `tools/gpu-profile.mjs`. `EXT_disjoint_timer_query_webgl2` IS available
on this machine (ANGLE/D3D11, AMD Radeon integrated `0x00001638`), so these are real GPU timings and
not a `gl.finish()` estimate** — which matters, because that tool's own header records `gl.finish()`
reporting 4.2 ms for a frame the timer query measured at 67.5.

194 drawn units, 2560x1440, four-army Sunder Atoll, seed 7, adaptive resolution verified inert:

```
frameMs  free-running   42.45 ms  -> 23.6 fps      p95 50.60
gpuMs                   29.83 ms
cpuMs    whole frame     3.55 ms                   <- CPU idle 88% of the frame
simMs    one tick        1.00 ms                   p95  2.10
```

**GPU exceeds CPU by 8.4x.** Per-pass, by ablation, every bucket verified to respond:

| pass | ms | share | disabling saves |
|---|---|---|---|
| colour | 21.47 | **55.2%** | — |
| GTAO | 6.57 | 16.9% | 4.97 |
| bloom | 4.86 | 12.5% | 3.32 |
| SMAA | 3.65 | 9.4% | 2.78 |
| grade | 2.34 | 6.0% | 0.54 (flagged as suspect by the instrument) |
| shadow | 0.99 | ~2% | 0.69 |

**The fit is the finding:** `GPU ms = 5.86 + 6.40 x Mpx`, **r² 0.995**, and a second run at 70 units
gave r² 1.000 with 89.7% of GPU time pixel-proportional. **60 fps lands at render scale 0.694.**

Three consequences that change what work is worth doing:

1. **Resolution scale is the frame-rate lever**, not draw calls, not triangles, not the sim. See §1's
   revised note. `AdaptiveResolution`'s floor is 0.55, so the controller can reach 60 fps on this
   hardware — once its one-way-ratchet bug is fixed (it required a median below 13.69 ms to restore,
   which a 60 Hz display can never produce).
2. **Map choice is irrelevant to cost** — all four-army land maps sit within 7% of each other
   (11.35–12.13 ms at 720p). Pixels are what vary. Note also that only four-army Sunder Atoll
   reaches 200+ units (215 and rising, because no land route means armies accumulate); every land
   map peaked near 114 and fell back to ~70 by minute 25.
3. **Full-res AO would cost +11.48 ms**, so the shipped half-res AO is already the post chain's
   single biggest saving. Shadows at 2% are not worth optimising.

**`stats().cpuMs` UNDER-REPORTS CPU BY 24%** and is the instrument §1 names. `GameLoop.renderPass`
calls `registry.runFrame()` *before* `hooks.render`, where `debug.beginFrame()` starts the
stopwatch — so RenderBridge uploads, VFX, the ore instancer, fog and the HUD all fall outside the
counter. Paired per frame: 2.70 reported against 3.55 actual. Not yet fixed.

---

## 7. Traps that cost someone an hour

**A DEV SERVER IS A MACHINE-WIDE PORT TOO, AND `preview_start` WILL SILENTLY REUSE SOMEONE ELSE'S.**
Found 2026-08-17 by an agent working in a `git worktree`: it called `preview_start`, got a "reused"
server on 5173 — and that server's `cwd` was the MAIN CHECKOUT, not its worktree. Every page it
booted would have measured somebody else's tree while reporting success. It noticed, ran its own on
5231, and verified there.

This is the SAME DEFECT the shot harness had on port 4317, described at length in CLAUDE.md, in a
place nobody had thought to look for it. The harness was fixed by walking to a free port and
byte-comparing the served `index.html` against the local `dist/`; `preview_start` has no such guard,
and its "reused" is a success message. **Check `cwd` in `preview_list` before trusting any page you
did not start yourself**, and prefer an explicit unused port when a worktree is involved.



**`AO_NOON` in `config.ts` is the ART block and disabling it disables NOTHING.** The live switch is
`RENDER_CONFIG.post.ao.enabled` in `renderer.ts`, plus the quality tier (`medium` for the harness).
An agent building an AO-disabled control edited the art block, got byte-identical captures, and
correctly-but-wrongly concluded its change had deleted AO entirely — a no-op control and a total
regression look exactly alike. Whenever you build a control capture, **prove the control actually
moved something** before trusting what it tells you about the treatment.

This is the same shape as §5: the config block that reads authoritative is not always the one wired
to the thing.

## 7b. WebGPU on a SYNTHETIC scene — Stage A of `WEBGPU_MIGRATION_PLAN.md`, 2026-08-17

> **THIS ENTRY'S VERDICT IS OVERTURNED FOR THE REAL GAME. READ §7f FIRST.**
> Everything below is correct about the thing it measured — a stock-material
> scene with no post chain, timed inside `renderer.render()` — and that thing
> turned out not to predict the shipped frame. On the REAL game, with the real
> post chain, at three resolutions across a 9x pixel range, **WebGPU is 1.74-1.89x
> FASTER**. The measurements here are not withdrawn; the inference from them to
> the product is. §7f says why the two are not in conflict.

Stage A said "answers 'is the win real for us' for a few days' cost". It cost a day and the answer
it gave was **no**. Instruments: `tools/webgpu-spike/` on branch
`worktree-agent-a2eb23cacd5ec7ab4` — a throwaway that is not to be merged; the numbers below are the
deliverable, not the code.

**A synthetic scene shaped like our real frame** (50–4000 opaque draws, triangles pinned at
0.62–0.70M across the whole sweep so it isolates per-DRAW cost, 70 distinct materials, ≤30
InstancedMesh batches, one 2048 directional shadow map, stock `MeshStandardMaterial` vs
`MeshStandardNodeMaterial`, no post chain). Median ms inside `renderer.render()` over 420 rAF frames
after 90 untimed warmup frames plus `compileAsync`. Both arms in one browser session, both on the
same `amd/gcn-5` iGPU — checked, because this box also has an RTX 3080 and `requestAdapter()` with no
preference takes the low-power one.

```
draws    ---------- 2560x1440 ----------      ---------- 1280x720 -----------
         webgl   webgpu  ratio  nodegl        webgl   webgpu  ratio  nodegl
   50     1.60    1.70   1.06    2.60          1.90    2.50   1.32    5.90
   64     2.20    1.70   0.77    2.50          4.80    3.50   0.73    3.10
  200     3.00    3.10   1.03    5.30          3.60    4.30   1.19    5.20
 1000     6.60   11.40   1.73   13.50          6.00    9.90   1.65   12.30
 4000    18.50   35.50   1.92   42.00         15.20   32.30   2.13   62.20
```

- **THE TWO SUB-1.00 CELLS ARE NOISE. Do not quote them.** Within-run spread `(p90-p10)/p50` is
  **29–73%** at and below 200 draws, so no low-end difference is resolvable. The 0.73 comes from a
  WebGL point whose own spread is 73% (p10 3.80, p90 7.30) and which is non-monotonic against its
  50- and 200-draw neighbours. Above 1000 draws the spread tightens to 10–23% and the gap is
  1.65–2.13×, far outside it.
- **The curves never cross — they diverge in WebGL's favour.** WebGPU's advertised win is lower CPU
  per draw; at 54–76 colour draws the two are indistinguishable, and every step up makes WebGPU
  relatively worse. **The sweep answers the headroom question in the negative: there is no draw count
  at which switching starts to pay, at least up to 4000, which is 50× our load.** Uncapped throughput
  agrees (WebGPU lower at 9 of 10 points).
- **`nodegl` — node materials over `WebGPURenderer`'s WebGL2 fallback — is the WORST arm nearly
  everywhere**, 1.3–4.1× the shipping renderer. That is §4.5's "two backends" cost, measured: after a
  migration, every player without WebGPU gets a renderer slower than today's.
- **This measures `three@0.185.1`'s `WebGPURenderer`, not the WebGPU API.** That is the right subject
  — the migration is to three's node system — but it means the finding could be overturned by a
  future three release, and should be re-measured rather than assumed permanent.

**The `onBeforeCompile` blocker in §3 of the plan is REAL, and it is silent.** Under a genuine WebGPU
backend, with a plain `MeshStandardMaterial` carrying `onBeforeCompile` — i.e. one of our 24 sites —
handed straight to `WebGPURenderer`:

```
onBeforeCompile calls, plain MeshStandardMaterial   0
onBeforeCompile calls, MeshStandardNodeMaterial     0
customProgramCacheKey calls                         1     <- still invoked
mesh.material is still the MeshStandardMaterial     true  <- no visible signal
generated fragment shader                           WGSL, no #include, no map_fragment
```

Nothing throws, nothing warns, and the mesh's `material` is still the object you assigned — the
conversion happens inside `RenderObject`. **`customProgramCacheKey` is the dangerous half**: it keeps
being called, so a hand-managed cache key (`TerrainMaterial` has one) goes on keying variants whose
injected code no longer exists. Escape hatches that DO work: TSL slot nodes (`colorNode`,
`positionNode`, …) and `wgslFn`. **`wgslFn` is NOT portable** — on the WebGL2 fallback the WGSL is
emitted verbatim into a GLSL shader and the program fails to link (`ERROR: 'fn' : syntax error`,
then `useProgram: program not valid`). With two backends to support, TSL node graphs are the only
route.

**`renderer.info` is NOT the same object under WebGPU, and the difference is silent.**
`src/render/post.ts` derives `drawCallsByPass` from deltas of `renderer.info.render.calls` and
`src/render/debug.ts` reads `info.programs?.length ?? 0`. Under `three/webgpu`:

| our code reads | WebGL means | WebGPU means |
|---|---|---|
| `info.render.calls` | draws this frame | **`render()` invocations since page load** — monotonic, and `reset()` does not clear it |
| — | — | `info.render.drawCalls` is the per-frame draw count |
| `info.programs.length` | programs in flight | **`info.programs` is `undefined`** → `?? 0` reports 0 forever |
| `info.autoReset = false` | reset inside `render()` | reset lives in `setAnimationLoop`'s callback only, so a custom loop that leaves `autoReset` true never resets at all |

None of these throw. A naive port keeps a green build and reports a draw-call count that climbs
forever, a program count of 0, and a `drawCallsByPass` computed from differences of a counter that
counts the wrong thing.

## 7c. The shot harness cannot photograph WebGPU, and the reason is one DLL

**Playwright's BUNDLED Chromium cannot create a WebGPU device on this machine when headless.** It is
not flags, not the GPU, not a headless limitation:

```
requestAdapter()  -> real, non-fallback amd/gcn-5, full feature list incl. timestamp-query
requestDevice()   -> OperationError: DynamicLib.Open: dxil.dll Windows Error: 87
                       at EnsureDXCLibraries (third_party/dawn/.../PlatformFunctionsD3D12.cpp:212)
THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend.
```

`dxil.dll` and `dxcompiler.dll` are both PRESENT in that Chromium's own directory, so nothing is
missing — error 87 is `ERROR_INVALID_PARAMETER`, what a bare-name `LoadLibrary` returns once
Chromium has restricted its default DLL directories. Measured per binary, over `http://127.0.0.1`:

```
playwright chromium  headless   adapter only, device FAILED
playwright chromium  headed     REAL WEBGPU, work submitted
chrome               headless   REAL WEBGPU, work submitted
chrome               headed     REAL WEBGPU, work submitted
msedge               headless   REAL WEBGPU, work submitted
msedge               headed     REAL WEBGPU, work submitted
```

**So a real hardware WebGPU backend IS obtainable here, headless included, and the fix for
`tools/shoot.mjs` is `channel: 'chrome'` rather than the bundled build.** The only flag that helps
the bundled binary is `--use-webgpu-adapter=swiftshader`, which buys a SOFTWARE device — the exact
trap CLAUDE.md records at 76.5% of pixels changed while the harness printed `ok`.

Three traps worth carrying forward:

- **WebGPU needs a SECURE CONTEXT.** The first version of the device probe ran off a `data:` URL and
  confidently reported "no `navigator.gpu`" for all eight flag sets. `http://127.0.0.1` is fine.
- **`navigator.gpu` existing, and even a real adapter enumerating, is NOT evidence the renderer is on
  WebGPU.** Both were true throughout the failing case. The only reliable read is
  `renderer.backend.isWebGPUBackend === true`.
- **`WebGPURenderer` falls back behind a single `warn()`.** Anything that reports a WebGPU number
  must assert its live backend and refuse, not infer. The first hour of this spike measured
  WebGL2-vs-WebGL2 and labelled one column "webgpu".

## 7d. The post chain in TSL — Stage B, measured 2026-08-17

Two questions were open when Stage B started. Both are now answered with an instrument.

### The grade port is numerically the same shader

`tools/grade-ab/run.mjs` renders one fixed scene-linear HDR chart through **`GRADE_FRAG` on
`WebGLRenderer`** and through **`src/render/nodes/grade-node.ts` on `WebGPURenderer`**, at exactly
the texture's resolution with `NearestFilter` so no filtering difference can enter, with both arms
taking their uniforms from the same `gradeUniformValuesFor()`. Live backend asserted
`isWebGPUBackend === true` — the run REFUSES to report a number under the WebGL2 fallback.

```
chart (0 -> 0.18 -> 1.0 -> 8.0 neutral ramps + saturated hues at 1.4, 256x64)
    max |delta|            1 / 255
    mean |delta|           0.0000407      (2 subpixels of 49 152 differ, by 1 each)
    subpixels over 1/255   0
```

**That is the whole grade** — unsharp mask, exposure, AgX, the 3-way tint, lift/gain, the gamma
contrast about 0.18, the declared white point, shadow saturation, the paper-white fold, the vignette
and the sRGB encode — agreeing to within a single least-significant bit across shadows, mids, HDR to
8x, and saturated primaries. Bit-equality was never the bar (two languages, two compilers); one LSB
on two subpixels is.

**`screenUV` and `vUv` agree about which way is up.** This was the predicted failure and it did not
happen. Measured deliberately with a Y-varying ramp so the test could actually see a flip:

```
                straight        flipped
    max         1               216
    mean        0.00012         56.38
```

The flipped comparison being catastrophic is what makes the straight one meaningful — do not delete
that arm to save a render.

### The AO scene submission does NOT have to be rebuilt, but the shader cost does

`WEBGPU_MIGRATION_PLAN.md` §3 said the `installAoDepthGBuffer` saving "has no direct equivalent and
would be redone from scratch". Half right, and the half that is wrong is the expensive half:

- **The second scene submission is gone by construction.** `GTAONode` owns no scene and no prepass —
  it is a full-screen quad over a depth node, and `pass(scene, camera).getTextureNode('depth')` is
  the depth the colour pass already wrote. There is nothing to delete because the node pipeline
  never had it. The seventy lines of `installAoDepthGBuffer` reaching into six private members of
  `GTAOPass` have no counterpart.
- **The naive port is nevertheless a real regression, and it is the trap §1 already names.** Both
  `GTAONode` and `DenoiseNode` accept a null `normalNode` and reconstruct the view normal from depth
  in the shader. `GTAONode` hoists that above its direction loop and pays for one.
  **`DenoiseNode` calls `sampleNormal` for the centre tap AND inside its 16-sample loop — 17
  reconstructions per denoised pixel**, each nine `textureLoad`s and three inverse-projection
  transforms. Identical arithmetic to `PoissonDenoiseShader`, identical conclusion: reconstruct ONCE
  into a texture and hand it to both. `src/render/nodes/ao-node.ts` does that with one `RTTNode` at
  the AO resolution.

### Three defects the node port would have inherited, found by reading three's source

None of these would have failed a build, and two are invisible until a capture disagrees with itself.

1. **`DenoiseNode.generateDefaultNoise()` calls `new SimplexNoise()`, whose default RNG is `Math`.**
   Byte-for-byte the same defect `post.ts#seedAoDenoiseNoise` fixes on the WebGL side, arrived at
   independently in three's node port. Unseeded, two boots of one build cannot produce the same
   image. Both chains now seed from `AO_NOISE_SEED` in `src/render/ao-params.ts`.
2. **`DenoiseNode` ships `lumaPhi`/`depthPhi`/`normalPhi` at 5/5/5 and `GTAOPass`'s constructor
   overwrites them with 10/2/3.** The WebGL chain inherits the latter silently by never setting
   them, so a node port that also never sets them denoises with a *different filter* from the same
   config. Pinned in `tests/post-nodes.spec.ts` by reading `GTAOPass.js` itself.
3. **`DenoiseNode` builds its Poisson disc with radius exponent 1; `GTAOPass.pdRadiusExponent` is
   2.** Same 16 taps over the same 2 rings, spread evenly along the radius instead of clustered.
   Same cost, different filter, nothing to catch it.

### What the WebGL bundle actually cost, measured rather than asserted

**+100 bytes.** `vite build` at `1c7cc0c` (the branch point) emits `index-*.js` at **2 673.60 kB**;
with Stage B it is **2 673.70 kB**. That is the shared modules `post.ts` now imports — the tone-mode
table, the pass order, and the two AO parameter helpers — after tree-shaking drops everything in
them the WebGL chain does not use.

`three/webgpu` is **absent from the bundle entirely** (`grep -c WGSLNodeBuilder dist/assets/index-*.js`
= 0), because nothing in `src/main.ts`'s graph imports the node chain yet. That is the load-bearing
half: the node passes cannot affect a shipped frame until something wires them in.

The first commit message for this work said the bundle was "byte-for-byte the size it was", which is
the kind of claim `docs/SPEC_DRIFT_AUDIT.md` exists to catalogue. It was not measured when it was
written. It is now.

### What Stage B did NOT establish

- **No frame time, and no claim to one.** §7b's verdict stands and is not disturbed by any of this.
- **Bloom and AO are verified structurally and by parameter, not numerically.** `BloomNode` was
  compared field by field against `UnrealBloomPass` (5 mips, kernels 6/10/14/18/22, factors
  1/.8/.6/.4/.2, half-res first mip, `lerpBloomFactor` identical) and the settled energy pair travels
  through one shared function — but no pixel of either has been diffed on a device. AO needs a real
  scene with depth to A/B at all. Both belong to the Stage F dual-backend verification.
- **The A/B is WGSL only.** The graph is COMPILED for both backends —
  `tests/post-nodes.spec.ts` puts it through `GLSLNodeBuilder` as well, so neither can silently stop
  building — but the 1/255 number was taken on a WebGPU device. `WebGPURenderer`'s WebGL2 backend is
  a third renderer, and what it renders from the same graph is unmeasured. Two backends means two
  grade baselines.

## 7e. The node path's shadow gap: CLOSED by `castShadowPositionNode`, and `allowOverride = false` is INVALID

**Measured 2026-08-17, Stages D2 and D3, `tools/shadow-override-probe.mjs`, real Chrome, real
WebGPU. Six arms, one run.**

```
arm                        backend    devErrs   darker vs the shipping reference
glsl-webgl (REFERENCE)     webgl            0   —
glsl-webgl-nodepth         webgl            0   3.040%    <- the defect, on WebGL
tsl-override               webgpu           0   3.040%    <- the same defect
tsl-nooverride             webgpu           2   89.312%   <- BLANK FRAME
tsl-nooverride-noreceive   webgpu           0   0.470%    <- correct, unusable
tsl-castshadow             webgpu           0   0.460%    <- correct, and shipped
```

`tsl-castshadow` against `tsl-nooverride-noreceive` is **0.024% of pixels changed and 0.000%
darker** — the two agree about the shadow and differ only where the diagnostic arm's casters stop
receiving one. The three phantom black slabs thrown by structures that are entirely below the ground
cut are gone.

**THE ROUTE, IN ONE PARAGRAPH.** `castShadowPositionNode` is harvested onto the override material's
`positionNode`, and `NodeMaterial.setupPosition` assigns `positionNode` AFTER
`instancedMesh( object )` and REPLACES `positionLocal` with it. So a node that ignores the instanced
value, resets `positionLocal` to `positionGeometry`, runs the same model-space edit the colour pass
runs, and re-applies three's own `instancedMesh( builder.object )` reproduces the colour pass's
position exactly. `src/render/cast-shadow-nodes.ts`; structures and props call it with the function
they already had, so there is still ONE declaration of each displacement.

**IT UPLOADS NOTHING.** The instance transform is reached through `builder.object` — a bare `Fn`
receives the live `NodeBuilder` and `RenderObjects` keys its chain map on the object, so the body
runs once per caster with that caster's mesh in hand. No new attribute, no new uniform, no byte
added to `InstanceBatcher` or `Scatter`, nothing in the frame loop. The alternative that was costed
against it — publishing a per-instance 3x3 basis so the displacement could be rotated
post-instancing — is 36 bytes an instance a frame through the renderer's two hottest writers.

**WHAT IT DOES COST, exactly.** `instancedMesh( object )` runs twice in the shadow pass, so the
shadow vertex stage carries **one extra mat4**: four more `nodeAttributeN` slots (13 of a guaranteed
16 on the probe's structure geometry, 14 on the real one, which carries `uv` for the atlas alpha)
where the matrices arrive as an interleaved attribute, and a second uniform buffer of `count * 64`
bytes over the same array where they arrive as a uniform buffer — three picks between those on
`count * 64 <= maxUniformBufferBindingSize`, i.e. 1024 instances. Both are a second BINDING of a
buffer that is already resident, never a second copy. Pinned in `tests/stage-d-node-materials.spec.ts`
§3b, including the attribute-limit headroom, because blowing 16 lands in a player's browser and in
no other gate.

**THE UNIT MATERIAL DELIBERATELY DOES NOT CALL IT.** `createUnitMaterial` has no
`customDepthMaterial` — the only two in the game are `createStructureDepthMaterial` and
`PropLibrary`'s — so a marching rifleman's shadow is the rest pose on the shipping renderer and has
always been. Wiring the walk cycle here is one line and would make the node path better than the
renderer it has to stay byte-comparable with, on the most numerous caster in the game, for the least
visible of the five displacements. The honest route is to give the GLSL material a depth material
first so both paths gain it together.

### The route that is closed, and why it is closed on CORRECTNESS rather than cost

`object.customDepthMaterial` is read in exactly one file in three 0.185 — `WebGLShadowMap.js`. The
node renderer instead sets `scene.overrideMaterial` to a shared depth material and harvests four
fields off the object's own material (`Renderer._getShadowNodes`): `castShadowPositionNode ??
positionNode`, `colorNode`, `depthNode`, `maskShadowNode ?? maskNode`. **`setupPosition` is not one
of them**, so every model-space vertex displacement in this project — the construction sink, the bay
door, the radar spin, the walk cycle, the wind sway — is invisible to the shadow pass.

`StructureNodeMaterial.STAGE_D_TSL_GAPS` #1 named two routes out and said to measure the cheap one
first because it is one line. **It was measured, and it does not work.**

```
! tsl-nooverride: GPUValidationError: [Texture "ShadowDepthTexture"] usage
  (TextureBinding|RenderAttachment) includes writable usage and another usage in
  the same synchronization scope.
```

- **The cause is structural, not a three bug.** A lit material that RECEIVES shadows samples the
  shadow map. Drawn into the shadow pass with `allowOverride = false`, it samples the very texture
  that pass is writing, which WebGPU forbids inside one synchronization scope. The validation error
  invalidates the whole command buffer, so the frame draws NOTHING — **the 89.312% is a blank
  canvas, not a shader difference.** An arm that raised a device error must never be read as "very
  different"; the probe prints the error count beside every diff for exactly that reason.
- **The flag DOES reach `setupPosition`.** The fifth arm is the proof of the diagnosis: with
  `receiveShadow = false` on the casters the sampler disappears, the frame is valid, and the shadow
  comes out at 0.470% against the reference versus the defect's 3.040%. So the mechanism is right
  and only the shadow-map read makes it unusable — and every caster in this game receives shadows.
  A building that cannot be shadowed by the building beside it is not a rendering the bible accepts.
- **`tsl-override` reproduced the defect to three decimal places** (3.040% darker, identical to the
  WebGL control that IS the defect). That equality is what says the instrument is measuring the
  shadow and nothing else.
- **What the probe could NOT measure.** The node `Renderer` has no `info.programs`, so "the shadow
  pass now compiles the full physical shader as well as the depth one" stayed unquantified. It is
  moot: the route is closed on correctness before cost.

### The prediction that was wrong, and it is the reusable half of this entry

This section used to end: *"What still needs a per-instance upload is the DISPLACEMENT, because a
model-space offset must be rotated and scaled by the instance basis before it can be added to an
instanced position."* **True of the offset and false of the conclusion.** The premise assumes the
expression must ADD to the instanced position. It does not have to: `setupPosition` ASSIGNS
`positionNode` over `positionLocal`, so the expression is free to discard the instanced value, go
back to `positionGeometry`, and re-run the instancing itself — at which point the basis is three's
own matrix node and needs no basis of ours.

**The general lesson: `positionNode` is a replacement, not a contribution.** An hour of design went
into how to encode a 3x3 basis in as few per-instance floats as possible, against a question that
evaporates once that one word is read correctly. It cost the same hour twice, since Stage D2 wrote
the sentence and Stage D3 believed it before checking `NodeMaterial.js`.

**What the probe still could NOT measure.** The node `Renderer` has no `info.programs`, so "the
shadow pass compiles a second program" stayed unquantified across all six arms.

## 7f. THE REAL GAME ON BOTH RENDERERS — Stage F, measured 2026-08-17

**`?gpu=webgpu` boots and draws the shipped game.** Everything below was taken on the merged
Stage A..F tree, in **real Chrome** (`channel: 'chrome'`), with `renderer.backend.isWebGPUBackend`
asserted true per page — Playwright's bundled Chromium still cannot create a device here (§7c).

### The frame is FASTER on WebGPU, and §7b did not predict it

`tools/gpu-frame-ab.mjs`. Both arms in one run, one browser at a time, the game's own rAF loop
stopped, `N` frames driven by `__VM.advanceFrames` with **one `canvas.toDataURL()` GPU flush per
block**, min of per-block medians, size pinned by `__VM.setSize`. `allied-base`, seed 7, 151
entities, 149/158 draws, 865k triangles — the same content on both, verified by the triangle count
agreeing to 0.006%.

```
                    webgl      webgpu    ratio      Mpx
1280x720            2.03 ms    1.17 ms   0.576     0.92
2560x1440           6.32 ms    3.44 ms   0.546     3.69
3840x2160          17.19 ms    9.10 ms   0.529     8.29
battle @1440p       5.80 ms    3.18 ms   0.549     3.69
stats().cpuMs       1.10 ms    0.25 ms   0.227
```

- **BOTH ARMS SCALE WITH PIXELS, and that is what makes the flush trustworthy.** WebGL runs
  ~1.95 ms/Mpx and WebGPU ~1.06 ms/Mpx over a 9x range. If `toDataURL()` were failing to
  synchronise on the node path, its wall time would be CPU-only and would barely move with
  resolution. It moves by 7.8x across 9x the pixels. That check is the one that turns this from a
  plausible number into a measurement — **do not delete the resolution axis.**
- **This is NOT comparable with §9's 42.45 ms**, and neither number is wrong. §9 is a live
  four-army Sunder Atoll match at 194 units, bounded by a per-frame 1-pixel `readPixels` and timed
  with a GPU timer query. This is a posed fixture at 151 entities with no VFX, timed by wall clock
  over a block. Different scene, different bound, different clock. Do not divide one by the other.
- **Why §7b's sweep pointed the other way.** It measured PER-DRAW CPU cost on a stock-material scene
  with no post chain, at draw counts from 50 to 4000, timed inside `renderer.render()`. §9 then
  established that this project is FILL-RATE bound — 79-90% of GPU time proportional to pixel count,
  CPU idle 88% of the frame — so per-draw CPU cost is close to the least relevant axis there is
  here. A synthetic scene shaped like our draw count was not shaped like our frame.
- **`stats().cpuMs` is 4.4x lower on the node path**, which is the advertised win showing up where
  §7b looked for it. It is not where the frame time came from.

### The scorecard: two baselines, and one weight-3 failure that is NOT closed

`npm run shots` and `node tools/shoot.mjs --gpu=webgpu`, then `tools/metrics.mjs` over each set.

```
                grade    failures
webgl           92.0%    13   all #34 edgeCoverage        13/13 captured
webgpu          91.0%    13   12x #34 + ONE weight-3      12/13 captured
```

- **#34 failing on every fixture on both arms is correct and must not be demoted.** See §2.
- **THE WEIGHT-3 FAILURE IS REAL: `03-terrain-closeup` #6 p99 luminance 0.8851 against a floor of
  0.900** (WebGL: 0.9744 on the same fixture). The visible cause is a **systematically weaker bloom
  halo** on the node path — measured frame-wide, pixels at luminance >= 250 go 3.400% -> 2.539% on
  `01-establishing-base` and 0.915% -> 0.666% on `11-dusk-mood`. Side by side at 4x, the emissive
  strips on an Allied power plant are the same brightness on both and only the WebGL one has a glow
  bleeding onto the surrounding armour.

  **It is not `BloomNode`'s parameters.** They were compared field by field against
  `UnrealBloomPass` in the same build of three: 5 mips, kernels 6/10/14/18/22, factors
  1/.8/.6/.4/.2, `lerpBloomFactor` identical, `luminosityHighPass` identical to
  `LuminosityHighPassShader`, half-res first mip, `HalfFloatType` on every intermediate, and the
  composite ends `sum.mul( strength )` on both. **So the difference is in the HDR reaching it, and
  that is where it was left.** Do not start by re-reading `bloom-node.ts`.
- **`02-hud-full` CANNOT BE CAPTURED ON THE NODE ARM.** It is the only fixture that re-dollies away
  from its scenario's declared distance (55 m against `allied-base`'s 62), and on the node path the
  rig reports 62 at the shutter — the pose is applied and then reverts. Pitch reverts with it, so
  this is the scenario's authored camera being re-applied, not a rendering difference. One of
  thirteen fixtures is therefore unscored on that arm and the 91.0% is over twelve.

### Three defects that a green `npm test` could not see, and one it should have

1. **`renderer.getDrawingBufferSize()` takes a `Vector2`, not a duck.** It calls `target.set(w, h)`.
   `post-nodes.ts` passed `{ width: 1, height: 1 }` and the game died in `createPostChain` before a
   frame. `buildPostGraph` needs no renderer, so no spec reached the function.
2. **`DenoiseNode.noiseNode` is a NODE, not a texture.** `ao-node.ts` assigned the reseeded
   `DataTexture` directly; the body calls `this.noiseNode.sample( uv )`, which threw inside
   `THREE.TSL`'s own catch — three console errors, no boot failure, and an AO term that darkened
   the whole frame by roughly one sRGB decode. **`tests/post-nodes.spec.ts` asserted the wrong shape
   and passed**, because it read `noiseNode.image.data` and a `DataTexture` has `.image.data`. It
   reads through `.value` and asserts `isTextureNode` now.
3. **`ShaderMaterial` IS NOT IN `StandardNodeLibrary`.** Basic/Lambert/Phong/Standard/Physical/Toon/
   Normal/Matcap/Line*/Points/Sprite/Shadow are; `ShaderMaterial` is not, so under `WebGPURenderer`
   it does not degrade — it fails `NodeBuilder: Material "ShaderMaterial" is not compatible` and
   draws through a bare `NodeMaterial`. Stages B..E counted `onBeforeCompile` sites and the raw
   `ShaderMaterial`s carrying LIT shading, and missed three that carry neither: the **sky dome**, the
   **contact-shadow pool** and the **decal field**. That is the entire background, a black square
   under every unit and every scorch painted solid black over a `DstColor` blend.
   `render/sky-nodes.ts` and `render/ground-overlay-nodes.ts` are the twins.

### What Stage F did NOT close

- **`drawCallsByPass` IS WEBGL-ONLY NOW, and that is a property of the renderer rather than a gap
  nobody filled.** The WebGL split comes from wrapping `WebGLRenderer.shadowMap.render` and reading
  `info.render.calls` on either side of it — a seam that exists because the shadow pass is a
  distinct method call there. The node `Renderer` draws shadows inside `_renderScene`, and `Info`
  publishes `render.drawCalls` as a per-frame TOTAL and nothing else. On the node path
  `stats().drawCallsByPass` reports zeros with a true total, the F3 overlay prints
  `(no per-pass split)` rather than `0 col`, and **`MAX_DRAW_CALLS` cannot be checked**. Faking a
  split would produce a number that looks like the WebGL one and means something else.
- **The sidebar cameos fall back to flat glyphs.** `Cameos` renders each portrait into a target and
  calls `renderer.readRenderTargetPixels` — synchronous, and WebGL-only. The node `Renderer`
  publishes `readRenderTargetPixelsAsync` and nothing synchronous, so the generator would have to
  become async end to end. `Hud` passes `handle.webgl`, which is null there.
- **`aGait` is missing on some geometry under the node path** — five `THREE.AttributeNode: Vertex
  attribute "aGait" not found on geometry` warnings per boot. On the GLSL path a missing attribute
  reads as 0 and nothing says so. Not investigated; it is a warning, and the walk cycle looks right
  in the captures.
- **Bundle isolation held.** `WGSLNodeBuilder`, `GLSLNodeBuilder`, `RenderPipeline`,
  `MeshPhysicalNodeMaterial`, `MeshStandardNodeMaterial` and `castShadowPositionNode` are **0
  occurrences in the entry chunk** and all present in a separate 758 kB `gpu-path-install-*.js` that
  a WebGL boot never fetches. `tests/webgpu-bundle-isolation.spec.ts` pins both halves and fails
  when a static import is added on purpose.

## 8. Unverified — do not quote these as fact

- **`GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format and sampler type` is
  REAL and PRE-EXISTING.** Upgraded from "unverified": it was reproduced on the baseline build as
  well as the changed one, so it belongs to neither. It is a live per-frame GL error nobody has
  chased and it deserves its own task. (`shots/_report.json` stores no console message TEXT, which
  is why the artefacts alone could not settle it — that is worth fixing in the harness.)
- `[roads] junction corner radii 3.1–6.0 m are outside scorecard #33's 4–8 m band` — self-reported by
  the harness, not independently checked.
