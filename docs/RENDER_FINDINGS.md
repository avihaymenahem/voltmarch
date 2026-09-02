# RENDER FINDINGS — questions that are ANSWERED, so nobody pays for them twice

**Original sweep measured 2026-08-17, on `gfx-perf-sweep` at `22b123c`.** This file also contains later amended findings; each later section identifies its own measurement date. Every number here came out of an
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

and the AO prepass in it is gone: `installAoDepthGBuffer` in `apps/game/src/render/post.ts` hands `GTAOPass`
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
through `normaliseInfo()` / `handle.frameInfo()` in `apps/game/src/render/backend.ts`, never `renderer.info`
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

**CONCLUSION: keep the check, but do not transfer its mixed-resolution RA3 band onto current
captures.** The subject/ground split remains useful art-direction evidence. The shipping regression
gate now compares each canonical scene with its reviewed 2560×1440 counterpart in
`docs/grade-current-1440p.json`; the RA3 corpus remains context, not a scene-paired oracle. The branch
`metrics-edgecoverage-measurement-frame` holds a demotion and is **deliberately unmerged**.

**What IS settled about the instrument, and is worth keeping:**

- The old runtime band (`[0.5996, 0.8547]`) was NOT the bible's asserted `[0.20, 0.46]`. It was
  rebased from `docs/grade-baseline.json` because the metric carries `baselineKey: true`. At the
  canonical 2560×1440 geometry, `tools/metrics.mjs` now uses a per-scene 0.80–1.30 ratio around the
  reviewed current-renderer value instead.
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
**read by nothing in `apps/game/src/render/` or `apps/game/src/art/`.** Tank tracks are frozen textures. Confirmed by
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
> re-deriving all 13 shot poses and `apps/game/tests/shot-camera.spec.ts`. Do not "fix" it unilaterally.

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
2. **Grain (0.016) and chromatic aberration (0.0016) were LIVE**, both banned by name at the time, both
   correctly `0` in config, and config reached nothing.
3. The unsharp mask sampled a 1920×1080 texel grid at 1440p.
4. `uTime` never advanced — **the only reason the shot harness never caught the grain.** A frozen
   hash is byte-identical run to run, so the harness certified stability over an effect banned for
   being unstable.

`apps/game/tests/banned-effects.spec.ts` passed throughout, because it scans config source literals and those
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

- **The naval readability pass darkens the body, not the palette identity, and
  makes foam translucent instead of deleting it.** On 2026-08-29 the live
  screenshot showed pale ships merging into a lifted sea whose crest filigree
  read as opaque chalk. `WATER_LOOK.outputGain` moved 1.40 -> 1.28 and the same
  4-8% calm foam field now composites at 0.74 optical density on both WebGPU
  and WebGL. It does not change shoreline coverage, wave geometry, wake masks,
  the no-reflection ruling or the reverted beyond-map edge experiment.

  A fresh genuine-WebGPU `08-naval-water` capture on NVIDIA Ampere passed all
  eleven frame checks: median luminance 0.3967, mean HSV saturation 0.4381,
  p1/p99 luminance 0.0510/0.9297 and weighted grade 100% for that one fixture.
  The WebGL/ANGLE capture passed visually with the same water/foam balance.
  `probeOpenWaterLuminance` includes the 0.74 blend, so scorecard #25 grades
  the material that is actually drawn instead of an opaque-foam approximation.

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
- **Terrain LOD: built, parked on 2026-08-17, then MERGED on 2026-08-18** (commit `077f5fb`), which
  OVERTURNS the "deliberately not merged" decision this entry recorded. The reasoning for parking it
  stands and is kept below, because it is still true and still the reason not to expect much from it.
  It was integrated anyway for a reason the measurement does not cover: it was the one branch
  carrying unmerged work, and the merge cost nothing.

  **THE MERGE IS THE ARGUMENT FOR `apps/game/tests/terrain-lod.spec.ts` EXISTING.** Its pinned per-map chunk
  counts fired immediately, twice. Under the start-spread widening three of five moved
  (temperate-valley 7 -> 4, frozen-sector 5 -> 3, contested-strait 16 -> 14); under the seed-picked
  start pair one more moved (frozen-sector 3 -> **4**, which is the value pinned today). Both times
  the two fixtures a start change CANNOT reach — `sunder-atoll`, whose layout is its island list, and
  `shot-default`, which passes no `starts` at all — did not move, and that is what made each one a
  re-baseline rather than a regression waved through. Do not accept new numbers here without that
  discriminator.

  `TERRAIN_LOD_MAX_ERROR` is 0.15 m and a chunk is decimated on its own FLATNESS, once, at
  generation. Nothing switches at runtime and there is still no `lodDistances`.

  The original 2026-08-17 entry follows. Branch
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
  further. `apps/game/tests/terrain-lod.spec.ts` pins the counts, so if a future generator pass makes maps
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
the visual gap plan P0 that did not land clean, and it was deferred deliberately rather than
bundled with the albedo and environment-response fixes, which did.

Note also what this does NOT license: **there is no test pinning `shadowIntensity`.** Asserting 1.0
would fail and asserting 0.80 would pin a defect, so `apps/game/tests/lighting-law.spec.ts` carries a comment
where the assertion should be. That is intentional — a green suite must not become evidence for the
wrong thing.

---

## 6c. Terrain `envMapIntensity` is INERT — the visual gap plan P0-3 names the wrong lever

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

### The ablation table is now an always-on asynchronous instrument

`apps/game/src/render/gpu-pass-timings.ts` and `PerfHud` now retain real GPU milliseconds for scene,
shadows, AO, bloom, grade and SMAA on both renderers. WebGL rotates one
`EXT_disjoint_timer_query_webgl2` category per frame and can additionally sum tagged water and
particle draws at `renderBufferDirect`. WebGPU reads Three's native timestamp-query render-context
map; water and particles are still part of its scene context and therefore remain `n/a` rather than
being fabricated. UI is outside either graphics command stream, so the panel reports its profiled
CPU system cost separately and leaves browser-compositor GPU cost unclaimed.

The adaptive governor consumes the same live snapshot. Timestamp writes stop when both it and the
performance panel are off. Shadow pressure reduces shadow-map size,
AO pressure reduces AO samples, and only scene/full-screen pressure falls through to resolution.
When GPU time is materially below wall-frame time it records a CPU bottleneck and does not damage
image quality. All query results are polled asynchronously; there is no `gl.finish`, blocking map,
or same-frame readback in the game loop.

Three consequences that change what work is worth doing:

1. **Resolution scale is the frame-rate lever**, not draw calls, not triangles, not the sim. See §1's
   revised note. `AdaptiveResolution`'s floor is 0.55, so the controller can reach 60 fps on this
   hardware — once its one-way-ratchet bug is fixed (it required a median below 13.69 ms to restore,
   which a 60 Hz display can never produce).

   **THIS FIT IS NOW SHIPPED PRODUCT, not just a finding.** `apps/game/src/render/HardwareCalibration.ts`
   re-derives the same line on the player's own machine — two probe windows at two known pixel
   counts, ordinary least squares, solve for the target — and writes the answer into
   `graphics.resolutionScale` once, on the first battle, never again. Adaptive resolution is off by
   default as of v2.14.0 and is a toggle. The numbers above are the test fixture:
   `apps/game/tests/hardware-calibration.spec.ts` feeds the solver 5.86 + 6.40/Mpx and requires it back
   exactly. **Note that this entry's 0.694 is against a ~17.22 ms target, not 16.7** — the same
   line at 16.7 gives 0.678, and the spec pins both so the two never get quoted for each other.

   **The one case where the model must NOT be applied** is a flat fitted slope. A vsync-capped
   display with headroom reports the monitor's interval at every resolution, and a CPU-bound frame
   reports the same number for a different reason; in both, cutting pixels costs sharpness and buys
   nothing. The calibration returns the ceiling under 1.0 ms/Mpx rather than solving.
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

## 7b. WebGPU on a SYNTHETIC scene — Stage A of the WebGPU migration, 2026-08-17

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
`apps/game/src/render/post.ts` derives `drawCallsByPass` from deltas of `renderer.info.render.calls` and
`apps/game/src/render/debug.ts` reads `info.programs?.length ?? 0`. Under `three/webgpu`:

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
`WebGLRenderer`** and through **`apps/game/src/render/nodes/grade-node.ts` on `WebGPURenderer`**, at exactly
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

### The AO scene submission is shared without MSAA; WebGPU depth rules require one with MSAA

the WebGPU migration §3 said the `installAoDepthGBuffer` saving "has no direct equivalent and
would be redone from scratch". Half right, and the half that is wrong is the expensive half:

- **The second scene submission is gone by construction in the normal single-sample path.** `GTAONode` owns no scene and no prepass —
  it is a full-screen quad over a depth node, and `pass(scene, camera).getTextureNode('depth')` is
  the depth the colour pass already wrote. There is nothing to delete because the node pipeline
  never had it. The seventy lines of `installAoDepthGBuffer` reaching into six private members of
  `GTAOPass` have no counterpart.
- **That statement stops being true when the colour pass uses MSAA.** WebGPU can resolve
  multisampled colour but has no depth/stencil resolve operation. Three exposes the attachment as
  `texture_depth_multisampled_2d`; `getNormalFromDepth` then emits
  `textureDimensions(depth, 0)`, which has no legal WGSL overload for that texture type. A live RTX
  3080 boot produced the device validation error while the frame continued without AO. The fixed
  graph retains MSAA colour and supplies AO from a single-sample **depth-only** pass. That extra
  geometry submission exists only for AO + MSAA; either feature off returns to the shared-depth
  path. `apps/game/tests/post-nodes.spec.ts` pins the topology, and only a real device proves the
  generated pipeline is accepted.
- **The naive port is nevertheless a real regression, and it is the trap §1 already names.** Both
  `GTAONode` and `DenoiseNode` accept a null `normalNode` and reconstruct the view normal from depth
  in the shader. `GTAONode` hoists that above its direction loop and pays for one.
  **`DenoiseNode` calls `sampleNormal` for the centre tap AND inside its 16-sample loop — 17
  reconstructions per denoised pixel**, each nine `textureLoad`s and three inverse-projection
  transforms. Identical arithmetic to `PoissonDenoiseShader`, identical conclusion: reconstruct ONCE
  into a texture and hand it to both. `apps/game/src/render/nodes/ao-node.ts` does that with one `RTTNode` at
  the AO resolution.

### Three defects the node port would have inherited, found by reading three's source

None of these would have failed a build, and two are invisible until a capture disagrees with itself.

1. **`DenoiseNode.generateDefaultNoise()` calls `new SimplexNoise()`, whose default RNG is `Math`.**
   Byte-for-byte the same defect `post.ts#seedAoDenoiseNoise` fixes on the WebGL side, arrived at
   independently in three's node port. Unseeded, two boots of one build cannot produce the same
   image. Both chains now seed from `AO_NOISE_SEED` in `apps/game/src/render/ao-params.ts`.
2. **`DenoiseNode` ships `lumaPhi`/`depthPhi`/`normalPhi` at 5/5/5 and `GTAOPass`'s constructor
   overwrites them with 10/2/3.** The WebGL chain inherits the latter silently by never setting
   them, so a node port that also never sets them denoises with a *different filter* from the same
   config. Pinned in `apps/game/tests/post-nodes.spec.ts` by reading `GTAOPass.js` itself.
3. **`DenoiseNode` builds its Poisson disc with radius exponent 1; `GTAOPass.pdRadiusExponent` is
   2.** Same 16 taps over the same 2 rings, spread evenly along the radius instead of clustered.
   Same cost, different filter, nothing to catch it.

### What the WebGL bundle actually cost, measured rather than asserted

**+100 bytes.** `vite build` at `1c7cc0c` (the branch point) emits `index-*.js` at **2 673.60 kB**;
with Stage B it is **2 673.70 kB**. That is the shared modules `post.ts` now imports — the tone-mode
table, the pass order, and the two AO parameter helpers — after tree-shaking drops everything in
them the WebGL chain does not use.

`three/webgpu` is **absent from the bundle entirely** (`grep -c WGSLNodeBuilder dist/assets/index-*.js`
= 0), because nothing in `apps/game/src/main.ts`'s graph imports the node chain yet. That is the load-bearing
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
  `apps/game/tests/post-nodes.spec.ts` puts it through `GLSLNodeBuilder` as well, so neither can silently stop
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
position exactly. `apps/game/src/render/cast-shadow-nodes.ts`; structures and props call it with the function
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
buffer that is already resident, never a second copy. Pinned in `apps/game/tests/stage-d-node-materials.spec.ts`
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
  0.900** (WebGL: 0.9744 on the same fixture), and frame-wide the pixels at luminance >= 250 go
  3.400% -> 2.539% on `01-establishing-base`.

  **THIS ENTRY USED TO CALL THAT "A SYSTEMATICALLY WEAKER BLOOM HALO" AND SAY THE CAUSE WAS THE HDR
  REACHING THE PASS. THE BLOOM PASS IS NOT INVOLVED AND NEITHER READING SURVIVED MEASUREMENT** —
  see §7g, which decomposes the failure pass by pass. `BloomNode`'s parameters were compared field
  by field against `UnrealBloomPass` and are identical, which was correct and is still worth
  knowing; what was wrong was the inference that a weaker-looking halo therefore had to be an input
  problem. Handed the same scene, the two arms' p99 luminance and blown-pixel fraction agree **to
  four decimal places** with bloom on and everything else off. Do not re-open `bloom-node.ts`, and
  do not re-open the HDR either.
- **`02-hud-full` CANNOT BE CAPTURED ON THE NODE ARM.** It is the only fixture that re-dollies away
  from its scenario's declared distance (55 m against `allied-base`'s 62), and on the node path the
  rig reports 62 at the shutter — the pose is applied and then reverts. Pitch reverts with it, so
  this is the scenario's authored camera being re-applied, not a rendering difference. One of
  thirteen fixtures is therefore unscored on that arm and the 91.0% is over twelve.

### The WebGL path is preserved, and that was CAPTURED rather than reasoned about

`vite build` + `npm run shots` on the pre-cutover tree (`56547ff`), then the same on the merged one,
byte-compared:

```
12 / 13 fixtures BYTE-IDENTICAL
02-hud-full        354 subpixels, ONE ROW y = 91, x 754..1141, max delta 2/255
```

That row is the documented Chromium envelope — the bottom edge of `.vm-panel::after`, a
`linear-gradient` behind a `drop-shadow` inside a `backdrop-filter` parent, rasterised once per page
— and it is the only thing that moved. **`09-placement` and `10-selection` also show the HUD and
came back byte-identical**, which is the coin landing the other way and is why this is evidence
rather than a coincidence. A capture set that matched on nine and differed on four would have meant
something else entirely.

### Three defects that a green `npm test` could not see, and one it should have

1. **`renderer.getDrawingBufferSize()` takes a `Vector2`, not a duck.** It calls `target.set(w, h)`.
   `post-nodes.ts` passed `{ width: 1, height: 1 }` and the game died in `createPostChain` before a
   frame. `buildPostGraph` needs no renderer, so no spec reached the function.
2. **`DenoiseNode.noiseNode` is a NODE, not a texture.** `ao-node.ts` assigned the reseeded
   `DataTexture` directly; the body calls `this.noiseNode.sample( uv )`, which threw inside
   `THREE.TSL`'s own catch — three console errors, no boot failure, and an AO term that darkened
   the whole frame by roughly one sRGB decode. **`apps/game/tests/post-nodes.spec.ts` asserted the wrong shape
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
- **Bundle isolation held, and what a WebGL player pays was MEASURED rather than asserted.**
  `WGSLNodeBuilder`, `GLSLNodeBuilder`, `RenderPipeline`, `MeshPhysicalNodeMaterial`,
  `MeshStandardNodeMaterial` and `castShadowPositionNode` are **0 occurrences in the entry chunk**
  and all present in a separate `gpu-path-install-*.js` a WebGL boot never fetches.
  `apps/game/tests/webgpu-bundle-isolation.spec.ts` pins both halves and fails when a static import is added
  on purpose. `vite build` on the pre-cutover tree (`56547ff`) against this one:

  ```
  entry chunk       2 678.86 kB  ->  2 687.83 kB     +8.97 kB   (+0.335%)
  node chunk                  —  ->    776.39 kB     never fetched on the WebGL path
  ```

  The +9 kB is the router and the one branch at each material site. Stage B's "+100 bytes" figure
  was for a stage that wired nothing in; this is the real cost of the seam and it is the number to
  quote.

## 7g. A CANVAS HOLDS ONE CONTEXT TYPE FOR LIFE, so three's WebGL fallback cannot work here

Reported by a player, 2026-08-17: their GPU driver reset while the game was on the WebGPU path, and
the page died with

```
TypeError: Cannot read properties of null (reading 'getSupportedExtensions')
    at new WebGLExtensions (chunk-….js)
    at WebGLBackend.init (chunk-….js)
```

**The mechanism is three's, it is structural, and it is not a bug in our wiring.** Traced through
three 0.185's own source rather than inferred:

1. `WebGPURenderer`'s constructor sets `parameters.getFallback = () => new WebGLBackend(parameters)`
   — unconditionally, for every construction that is not `forceWebGL`, with no option to decline.
2. `Renderer.init()` catches **any** throw out of `WebGPUBackend.init` and calls it. Both
   `requestAdapter()` returning null and `requestDevice()` rejecting on a dead driver land here.
3. `WebGLBackend.init` then runs `renderer.domElement.getContext('webgl2', …)` — the **same**
   canvas — and `new WebGLExtensions(this)` on the result one line later.

`index.html` ships ONE canvas (`#gl`). `WebGPUBackend` has already called `getContext('webgpu')` on
it (from `updateSize()`, on `init`'s last line), and the HTML spec gives a canvas exactly one
context type for its whole life — there is no release, no reset, no attribute that undoes it. So
step 3 returns `null` by specification and step 3's next line dereferences it. **Three's fallback is
unavailable to any application that puts its canvas in its HTML**, which is most of them.

**`assertBackend` could not fire, and that is a real limit on the guard rather than an oversight.**
It reads the object `init()` RESOLVES with. Here `init()` REJECTS, so nothing downstream of the
throw ever ran. §7c's tripwire covers "a renderer was built and it is the wrong one"; it never
covered "no renderer was built at all".

### What changed

- **Three's fallback is removed before `init()`** — `gpu-path-install.ts#disableThreeFallback`
  writes `renderer._getFallback = null`, guarded by an `in` check so a three upgrade that renames
  the field warns instead of silently re-arming the crash. On this canvas the fallback's only two
  outcomes were that TypeError or a `webgl2-fallback` renderer `assertBackend` refuses anyway, so
  removing it costs nothing and makes `init()` reject with the REAL cause.
- **The rejection is caught** in `prepareRenderer` and becomes a `GpuUnavailableError`.
- **`device.lost` is watched** (`device-loss.ts#watchDeviceLoss`), filtering `reason === 'destroyed'`
  because that is our own `device.destroy()`. A loss sets `isContextLost()`, which `post.render()`
  already early-outs on, so the last good frame stays on screen instead of an undefined buffer.
- **A failed or lost canvas is QUARANTINED** and any later renderer gets a freshly minted element
  carrying its id, class, style and size. This is the half that makes a WebGL recovery possible at
  all; without it we would simply reproduce three's crash under our own name.
- **The adapter is published** — `backend.ts#normaliseAdapterInfo` off `device.adapterInfo`, on
  `capabilities.adapter` and `__VM.gpuInfo()`. `powerPreference: 'high-performance'` is a HINT:
  Stage A asked for it and observed an integrated `amd`/`gcn-5` adapter on a box holding an RTX
  3080, and until now the running page could not say which GPU a crash was on. Note the WebGL debug
  string is NOT a substitute — it names whichever chip *WebGL* got, which on a hybrid laptop need
  not be the one the WebGPU device came from.

### What it cost the bundle, and what it cost the WebGL path

`vite build`, against §7f's Stage F figures:

```
entry chunk       2 687.83 kB  ->  2 693.69 kB     +5.86 kB   (+0.218%)
node chunk          776.39 kB  ->    776.74 kB     never fetched on the WebGL path
```

`device-loss.ts` is in the entry chunk on purpose: the failure it reports can happen before the node
chunk has finished loading, so a recovery path that lives inside the thing that failed to load is no
recovery path. `apps/game/tests/webgpu-bundle-isolation.spec.ts` still reports 0 node symbols in the entry.

**The WebGL construction path takes exactly three touches and all three are inert there**, which is
argued from the diff rather than measured — `npm run shots` was not run, because the host machine
had already crashed its GPU driver twice on this work:

1. `canvas = liveCanvas(canvas)` — one `WeakSet.has` returning false, handing back its argument. The
   quarantine is empty unless a WebGPU device actually failed.
2. `adapter: null` added to the WebGL `capabilities` literal — a data field no render path reads.
3. `isContextLost()` gains `|| (nodeRenderer !== null && deviceLost !== null)`, which short-circuits
   on `nodeRenderer === null` — every WebGL boot.

No shader, material, pass, size, clear or tone-mapping call changed. Anyone who wants the pixel
proof should capture it; the claim here is structural.

### The policy: `?gpu=webgpu` REFUSES, visibly, with a one-click route to WebGL

Argued at length above `raiseGpuFailure` in `renderer.ts`. Short form: an automatic fallback behind
a banner is the same substitution `assertBackend` exists to forbid — every downstream number would
keep being produced, correctly formatted, about WebGL, while the address bar said WebGPU, which is
Stage A's defect exactly. A lost device also takes every texture, buffer and pipeline with it, so
"recover onto WebGL" is a full re-boot either way; doing it as an explicit page reload is simpler
and more honest than an in-place substitution twenty modules have to get right. Refusing at boot
costs a player nothing, because no frame has been drawn.

### What is NOT verified, and cannot be from here

`apps/game/tests/gpu-device-loss.spec.ts` drives a rejected `init()`, a resolved `device.lost`, and an
`adapterInfo` whose fields sit on the prototype — the three signals this code reacts to, reproduced
exactly, and every assertion in it was mutation-tested red. It does **not** establish that a real
Chrome resolves `device.lost` on a real driver reset rather than only killing the GPU process, that
the panel is legible, that its buttons reload as intended, or that `GPUDevice.adapterInfo` is
populated on the reporter's configuration. The host machine crashed its GPU driver twice on this
path, so none of those four was attempted. **Do not quote the suite as evidence that recovery has
been observed on hardware.**
## 7h. THE HALO WAS NEVER THE BLOOM. SMAA WAS DEAD ON WEBGL AND AO IS TWICE AS STRONG ON THE NODE PATH

**Measured 2026-08-17 with `tools/bloom-hdr-ab.mjs`, `03-terrain-closeup`, 1280x720, both arms in
one run, on the machine's NVIDIA adapter** (`{vendor: nvidia, architecture: ampere}` — every earlier
WebGPU number in this file was taken on the integrated AMD part, and the defect reproduces
unchanged, so it is not adapter-dependent).

### The instrument, because the answer depends on it

Seven captures per arm, and the design rule is that **every rung ends in the grade**.
`EffectComposer` gives the last enabled pass `renderToScreen = true`, and two of this chain's passes
behave differently when they are the one that writes the canvas — `UnrealBloomPass` blits the read
buffer through a tone-mapped `MeshBasicMaterial` and then adds its LINEAR composite on top of that
already-encoded frame, and `GTAOPass` composites straight to the default framebuffer. The node graph
has no such notion. An `ao`-last rung measured before this was understood came back **99.999% of
pixels changed at a mean of +50.9/255**, which is not an AO difference; it is two different
composites. With the grade last on both arms the tail is identical and a difference between two
rungs is a difference in the pass that was added.

At the time of this measurement `setPostEnabled(false)` was unusable for the same reason and worse.
That bypass is now fixed; the closure is recorded at the end of this section.

### The decomposition. p99 luminance, and it is additive

```
rung          webgl     webgpu    what it adds
grade-only    0.9176    0.9176    <- the scene and the grade AGREE, exactly
bloom-grade   0.9098    0.9098    <- BLOOM AGREES, exactly. blown px 0.439% / 0.441%
ao-grade      0.9020    0.8863    <- AO: -0.0156 vs -0.0313
grade-smaa    0.9137    0.8941    <- SMAA: -0.0039 vs -0.0235   (before the fix)
nobloom       0.8980    0.8627    <- and the two deficits sum to the whole gap
```

**`scene` (post emptied to the render pass alone) is identical too: p99 0.7412 on both, and 0.3765
on both again at a quarter exposure** — the second rung exists because AgX is compressive at the
top, so equal bytes at normal exposure would not have proved equal HDR. The HDR reaching the bloom
was never the problem.

### Defect 1: `demoteSmaaTargets` made SMAA a no-op that still cost three full-screen passes

`SMAAPass` binds two of its three materials ONCE, in its constructor —
`_uniformsWeights.tDiffuse = _edgesRT.texture` and `_uniformsBlend.tDiffuse = _weightsRT.texture` —
and `render()` rebinds only `_uniformsEdges.tDiffuse` and `_uniformsBlend.tColor`.
`post.ts#demoteSmaaTargets` **replaced both render targets** with 8-bit ones and disposed the
originals, so the weights pass and the blend pass sampled dead textures, every blend weight came
back zero, and `SMAABlendShader` returns its input unchanged at zero weight.

Read off a booted page rather than deduced: `_uniformsWeights.tDiffuse.value.name` was
`SMAAPass.edges` while the pass rendered into `SMAA.edges`.

`tools/bloom-hdr-ab/profile.mjs` bins the pass's effect by the pre-pass |laplacian|, and **that is
the instrument that can tell a pass that ran from a pass that returned its input**, which a
whole-frame mean cannot:

```
mean |dY| per bin      0..2   2..5   5..10  10..20  20..40  40..inf
webgl BEFORE the fix   1.50   1.06   1.02   1.00    1.00    0.99     <- flat: the dither floor
webgl AFTER            1.62   1.30   1.58   1.94    2.41    9.37
webgpu (always worked) 1.53   1.09   1.09   1.25    1.73   10.35
```

Whole-frame mean |laplacian| through SMAA: **26.24 -> 26.17 before (0.3%), 26.24 -> 20.09 after
(23%), against the node path's 26.54 -> 20.01.** The node twin,
`post-nodes.ts#demoteSmaaMaskTargets`, mutates `texture.type` in place and therefore always worked;
`post.ts` does the same now.

**THE WEBGL PATH IS NO LONGER BYTE-IDENTICAL TO THE PRE-CUTOVER BUILD, DELIBERATELY, AND THE
SCORECARD HAS NOT BEEN RE-RUN.** Every WebGL capture in this project — including the
`12 / 13 byte-identical` result in §7f and the reference set behind
`docs/grade-baseline.json` — was taken with SMAA inert. `npm run shots` plus `tools/metrics.mjs`
must be re-run at 1440p before this is released; it was not run here because the host had reset its
GPU driver twice that day and 13 captures at 2560x1440 is the load that did it. What IS known, at
720p on `03-terrain-closeup`: p99 0.9176 -> 0.8824 and blown pixels 0.445% -> 0.306% on the WebGL
arm with everything on. Scorecard #34 (edgeCoverage) will move — SMAA removes edge energy, and #34
already fails 13/13 for being too LOW, so this pushes the wrong way. That is a real cost and it does
not make the dead pass worth keeping.

`apps/game/tests/perf-budget.spec.ts` builds a real `SMAAPass`, runs the exported `demoteSmaaTargets` over it
and asserts the two reference identities. Every source-scanning assertion in that file passed
throughout the defect's life, because the text really did say `UnsignedByteType` on two mask
targets; what was false was a reference identity, and the only way to see one is to build the object
and look. Mutation-tested both ways: restoring the swap reddens it, deleting the type writes reddens
it.

### Defect 2: CLOSED — the node path's newer GTAO integral needed an explicit energy calibration

Same fixture, `ao-grade` minus `grade-only`, binned by pre-pass |laplacian|:

```
mean |dY| per bin   0..2   2..5   5..10  10..20  20..40  40..inf
webgl               2.11   1.99   3.40   4.82    5.18    6.25
webgpu              3.83   3.88   6.41   8.92    9.83    11.15
ratio               1.82   1.96   1.89   1.85    1.90    1.78
```

**A near-constant multiplier on the darkening across every bin, with the same shape and the same
per-channel signature** (webgl dR/dG/dB -4.20/-2.74/-1.95, webgpu -6.84/-5.38/-3.90). A different
normal reconstruction, a different march radius or a different denoise would change the SHAPE. A
flat ratio says the occlusion TERM is scaled differently.

Already ruled out, by reading: the march and denoise parameters are shared through
`apps/game/src/render/ao-params.ts` and both sides apply `pow(ao, scale)`; `GTAOPass.updateGtaoMaterial`
really does assign each of them (it is not silently dropping the object into a `try/catch`);
`blendIntensity` and the node's `mix(1, ao, intensity)` both read `cfg.ao.intensity`; and neither AO
installer has the stale-binding bug SMAA had — `installAoDepthGBuffer`'s wrapper rebinds `tDepth` on
all three materials every frame.

The cause is upstream implementation drift, not a missing shared parameter. In three 0.185,
`GTAONode` uses the newer foreshortening-weighted Activision slice integral; `GTAOShader`, used by
`GTAOPass`, still uses the older simplified integral. The two algorithms accept the same radius,
thickness, samples, power and denoise settings but do not produce the same term. Replacing either
implementation would increase maintenance and discard the newer node shape, so
`AO_NODE_INTENSITY_SCALE` calibrates only the node path's final mix.

**Re-measured 2026-08-21**, same fixture/size/adapter with the shipped graph. At 0.475 the displayed
AO effect (`ao-grade - grade-only`) is 0.0062 mean luma on WebGL and 0.0065 on WebGPU. Per-channel
signed darkening is WebGL -1.831/-1.578/-0.860 and WebGPU -1.929/-1.663/-0.859 levels: within
5.4% / 5.4% / 0.1%, while retaining the newer integral's local shape.

### The two other open items are closed in the same measured pass

- **Post disable is a true bypass now.** The node-backed chain retains the current scene and camera
  and calls `nodeRenderer.render(scene, camera)` when disabled. The graph does not run, and restoring
  renderer AgX therefore cannot double-tone-map a still-live grade. `apps/game/tests/compositing.spec.ts`
  pins the branch.
- **Bloom now samples a materialised HDR input.** `PostBloomInput` is a full-resolution RGBA16F RTT,
  matching the composer's buffer before `UnrealBloomPass` performs its half-resolution high pass.
  The old expression path evaluated at half resolution and therefore changed the sampling
  footprint. Re-measured without AO, `bloom-grade - grade-only` is 0.1543/255 over 1.524% of pixels
  on WebGL and 0.1603/255 over 1.532% on WebGPU, a 3.9% energy difference with essentially the same
  support and peak (+131.8 / +132.1), down from the former ~13% mismatch.

---

## 7i. THE TWO READBACKS DISAGREE ABOUT ROW ORDER AND ROW STRIDE — measured 2026-08-17

Reported under `?gpu=webgpu`: *"The 3D models in side menu not showing"*. Every build slot fell back
to a flat glyph, so a player could not tell what they were building. The cause was one line —
`CameoRenderer` read its target back with `readRenderTargetPixels`, which is synchronous and exists
only on `WebGLRenderer` — and the fix is an async path beside it. The interesting part is not the
fix; it is the two facts a "looks about right" fix would have shipped wrong, both silent.

**MEASURED ON A REAL WEBGPU DEVICE, NOT REASONED ABOUT.** `node tools/cameo-readback-probe.mjs`
renders a picture that is a different colour in all four corners into a render target built exactly
as `CameoRenderer.ensureTarget` builds one — 148x116, i.e. a 74x58 build slot at
`HUD_CAMEO.supersample` 2 — reads it back through each renderer's own readback, and runs the
SHIPPED `apps/game/src/render/backend.ts` helpers over the bytes. Real Chrome, `channel: 'chrome'`, both arms
in one page on two canvases (§7g: one context type per canvas, for life).

```
                       buffer          derived stride   rows        centre grey
  webgl                68 672 B        592 B (tight)    bottom-up   128,128,128
  webgpu               88 912 B        768 B (aligned)  top-down    128,128,128
```

- **Row order is OPPOSITE.** `gl.readPixels(0, 0, …)` starts at the framebuffer's BOTTOM-left;
  WebGPU's `copyTextureToBuffer` takes a texel origin and a WebGPU texture's origin is its TOP-left,
  and three passes our `y` straight through as `origin.y`. Keeping the existing flip on the node
  path renders every cameo upside down. The probe prints the corners under BOTH row orders side by
  side, and they differ in all four — so this is a discrimination, not an agreement by symmetry.
- **Every node-path row is PADDED.** `WebGPUTextureUtils.copyTextureToBuffer` rounds `bytesPerRow`
  up to 256 bytes because `GPUCommandEncoder.copyTextureToBuffer` requires it, and sizes the buffer
  `(height - 1) * bytesPerRow + width * bytesPerTexel` — the last row is not padded
  (mrdoob/three.js#31658). 148 px is 592 B of pixels in a 768 B row, and nothing in the cameo grid
  is a multiple of 64 px wide, so this is the ordinary case rather than an edge. A blit that assumes
  tight rows walks diagonally through the image. `readbackStride` therefore DERIVES the stride from
  the buffer length and throws on a length matching no known layout, so a three upgrade that changes
  the packing fails loudly instead of shearing twenty portraits.
- **Pixel format and colour space are the SAME on both**, which is the one thing that did not need a
  workaround. `RGBAFormat` + `UnsignedByteType` + `SRGBColorSpace` becomes `rgba8unorm-srgb` on
  WebGPU and `SRGB8_ALPHA8` on WebGL; both encode on store, both hand back `Uint8Array`, and a mid
  sRGB grey reads 128 on both. `createImageData`/`putImageData` needs no conversion either way. A
  linear readback would have read 55.
- **TWO OVERLAPPING READS OF ONE RENDER TARGET DO NOT CROSS**, measured because they happen every
  frame: `HUD_CAMEO.perFrameBudget` is 2 and `CameoRenderer` owns ONE target, so a frame renders
  cameo A, issues its read, renders cameo B over the top and issues a second read with A's still
  outstanding. If the copies were not ordered against the renders, A's slot would show B's picture —
  the wrong unit in the wrong slot, silently. The probe's third arm renders two DIFFERENT pictures
  into one target with both reads in flight and requires each to hold its own; it does. The reason
  is that both submits are synchronous: `Renderer.render` ends in `backend.finishRender` ->
  `queue.submit`, and `copyTextureToBuffer` submits its encoder before its first `await`, so the
  queue sees render A, copy A, render B, copy B. The same fact is why disposing a render target
  cannot corrupt a read already issued against it.
- **`toneMappingExposure * 1.42` in `CameoRenderer.render` is INERT, and has been on the WebGL path
  since it was written.** Neither renderer tone-maps into a user render target:
  `WebGLPrograms.getParameters` sets `toneMapping = NoToneMapping` unless the current target is null
  or XR, and the node `Renderer`'s `currentToneMapping` getter does the same through
  `isOutputTarget`. It is kept — identically on both paths — because removing it changes the WebGL
  path's uniform writes and that is a separate question. Do not "fix" the cameo exposure by tuning
  this number; it does nothing.

`apps/game/tests/cameo-readback.spec.ts` pins the arithmetic without a GPU (31 assertions, 20 deliberate
breaks each red on exactly the tests naming them), including that the shipped blitter is
byte-for-byte the loop it replaced when handed WebGL's layout. **It cannot establish the two facts
in the table above** — only the probe can, and its verdict is here.

## 7j. THE ADAPTER CAN BE FORCED, ONE SWITCH MOVES BOTH RENDERERS — measured 2026-08-17

**`powerPreference` is a hint Windows ignores (§7g), but `--force-high-performance-gpu` is not, and it
moves WebGL and WebGPU together.** Gate zero of the Electron plan §1, on the RTX
3080 laptop that produced the §7g observation:

```
arm            WebGPU adapter     WebGL unmasked renderer
control        amd / gcn-5        AMD Radeon(TM) Graphics      <- reproduced twice, identical
hyphen         nvidia / ampere    NVIDIA GeForce RTX 3080 Laptop GPU
underscore     nvidia / ampere    NVIDIA GeForce RTX 3080 Laptop GPU
both           nvidia / ampere    NVIDIA GeForce RTX 3080 Laptop GPU
```

Four things this settles, and one it does not.

- **§7g's `amd`/`gcn-5` observation is CONFIRMED, not an artefact.** It reproduces on a browser
  launched fresh, twice, and it is the unforced default on this hardware.
- **The measurement is clean of the registry.** `HKCU\SOFTWARE\Microsoft\DirectX\UserGpuPreferences`
  is keyed by EXECUTABLE PATH and holds `chrome.exe => GpuPreference=2;` on this machine — the user's
  manual Windows Settings fix. **So Chrome cannot be a control here.** The probe therefore runs
  **Edge**, which has no entry. Nothing was written to the registry to obtain this result, and nobody
  needs to write to it to reproduce one.
- **Both spellings work, and each works ALONE.** `--force-high-performance-gpu` is the browser-process
  switch (`gpu/config/gpu_switches.cc`); `--force_high_performance_gpu` is the GPU driver-bug-workaround
  name (`gpu_workaround_list.txt`). The browser process translates the first into the second and also
  copies workaround switches through, which is why either suffices. Pass both; it costs nothing.
- **One switch covers BOTH of this project's renderers.** This was the open question — `gpu_preferences.h`
  defines a *separate* `WebGPUPowerPreference::kForceHighPerformance`, which suggested Dawn might not
  follow the ANGLE/EGL effect site. On this hardware it follows. `--use-webgpu-power-preference` and
  `--use-webgpu-adapter` remain the fallbacks if a machine is ever found where it does not.
- **WHAT THIS DOES NOT ESTABLISH: that Electron passes the switch through.** This is Edge, i.e. plain
  Chromium. `app.commandLine.appendSwitch` before `app.whenReady()` is a different call path and is
  still unmeasured. It is a 30-minute test against a bare `main.js` and it should be done before any
  enforcement ships.

The effect site is `gpu/ipc/service/gpu_init.cc#SetupGLDisplayManagerEGL`, guarded
`#if BUILDFLAG(IS_WIN) || BUILDFLAG(IS_MAC)`, and it is conjoined with `&& system_device_id_high_perf`
— so on a machine where GPU-info collection finds no high-performance adapter it is a **silent** no-op
with no log line. Verify by reading the adapter, never by observing that the switch was appended.

Reproduce: `scratchpad/run-probe.mjs` (a ~50-line Playwright harness serving a page that reads
`WEBGL_debug_renderer_info` and `GPUAdapter.info` side by side). Read `GPUAdapterInfo` field by field —
its properties are on the prototype, so `{...info}` is `{}` on every real adapter.

## 8. Unverified — do not quote these as fact

- `[roads] junction corner radii 3.1–6.0 m are outside scorecard #33's 4–8 m band` — self-reported by
  the harness, not independently checked.

### Resolved: the WebGL shadow sampler mismatch

The warning was a genuine first-frame renderer defect, not a material texture. `createPostChain()`
warms the scene before the first `RendererHandle.beginFrame()`. With `shadowMap.autoUpdate = false`
and `needsUpdate` initially false, Three r185.1 bound its non-comparison fallback depth texture to
the `directionalShadowMap[]` comparison-sampler array. The array setter does not apply the fallback
texture's compare function, so the first draw failed with `GL_INVALID_OPERATION`.

`apps/game/src/render/renderer.ts` now arms one shadow update immediately after disabling automatic updates.
The warm-up therefore creates the real comparison shadow texture; `beginFrame()` continues to arm
the normal once-per-frame update. A fresh, self-closing 13/13 capture at 2560×1440 reports zero
texture/sampler mismatch warnings, and `apps/game/tests/perf-budget.spec.ts` pins both the initial and per-frame
arms.


---

## 10. Four armies — what the extra seats cost, and the one axis that is closed

Extracted 2026-08-18 from `docs/N_ARMIES_PLAN.md` before that plan was deleted. These are the
measurements inside it that outlive it.

### Per-slot team colour in the 3D world: the hue axis is closed, and the cheap version does not exist

**PER-SLOT TEAM COLOUR IN THE WORLD IS A GRADE-WIDE CHANGE, AND A PER-SEAT HUE OFFSET IS
ARITHMETICALLY IMPOSSIBLE.** There is exactly one site that writes the instance colour —
`RenderBridge.ts` `batch.writeTeam(slot, TEAM_RGB[fi], …)` with `fi = s.faction[i] * 3` — and
`s.owner[i]` is in the same struct-of-arrays, so swapping faction for owner really is one line. It
would recolour the placeholder box, the building selection pulse and cameos, and NOTHING ELSE ON
SCREEN: `createUnitMaterial` installs three hooks and touches `aTeamColor` in none of them,
because a hull's colour is baked atlas texels (`specForPalette` feeds
`teamColor`/`teamSecondary`/`insignia` to the greeble generator and the spec hash is the atlas
cache key — one atlas per faction). Structures are the same, which is why a captured derrick does
not repaint. Real per-slot identity means writing the team slab as a MASK the fragment shader
multiplies `vRaTeam` into, which touches `greeble-gen.ts`, `UnitFactory.createUnitMaterial`,
`BuildingFactory.applyStructureShader`, both atlas cache keys and `Cameos.ts`. One atlas per SLOT
is the alternative and it multiplies texture memory and boot time by the army count and forks
every batch.

**Do not reach for a per-seat hue offset as the cheap version.** The four faction team hues —
crimson 3°, jade 168°, cobalt 215°, arc-violet 287° — were chosen for a **72° minimum pairwise
separation** with the 100-120° 'amateur emerald' window struck out by scorecard #9, and
`config.ts` records that 72° is the best any fourth candidate scores. Four seats across four
factions is sixteen hues on the same wheel, which cannot clear about 21°. If per-slot identity is
wanted, move value or saturation, or add a non-colour marker (chevron or pennant count). And
recolour SLABS only: `RA3_LOOK_BIBLE.md` risk R12 forbids team colour as a hull tint, `config.ts`
enforces it, and a hull tint fails scorecard #10 as well.

### No four-army frame has ever been captured, and 13-atoll-crossing is not one

**THE FOUR-ARMY DRAW-CALL QUESTION IS STILL OPEN, AND `13-atoll-crossing` DOES NOT ANSWER IT.**
That fixture declares `armies: SKIRMISH_ARMIES_MAX` on its scenario plan and reports 60 colour
draws (114 total) in `shots/_report.json`, which reads exactly like a four-army frame comfortably
inside the 130 budget. It is not one: the `armies` field exists so the generator reserves four
island shelves, and `buildAtoll` composes **two owners**, `b.allies` and `b.soviets`. Quoting 60
as the four-army figure would be quoting a duel.

The concern it leaves open is structural. `RenderBridge` keys batching by `packKey(kind, faction,
defId)`, so a batch is per-faction, and `withArmyCount` fills new armies from the factions nobody
has taken — the natural four-way is four DIFFERENT factions, i.e. up to twice a duel's distinct
batches. There is still no `?armies=` boot flag, so `tools/shoot.mjs`, `tools/metrics.mjs`,
`tools/desync-probe.mjs` and `tools/replay-probe.mjs` cannot produce the number. Answering it
needs either that flag or a fixture that composes four owners; until then the honest statement is
that a four-army frame has never been photographed.

### What four armies cost the sim — Vision is the per-army cost, the AI is not

**FOUR ARMIES COST TWICE THE ARMY ENTITIES AND +67% OF VISION; THE AI IS NOT THE PROBLEM.**
`temperate-valley`, seed 4242, `start: 'base'`, tick 0. `Vision.update()` timed over 200 calls
after 20 warm-up, `AiDirector.tick()` over 600 ticks after 30:

```
                              2 armies    4 armies
  army entities                    83         171     +106%
  total alive (incl. Gaia)        232         316      +36%
  ore fields                        3           5
  Vision.update()  median     1.4035 ms   2.3471 ms    +67%
  AiDirector.tick() over 600     4.9 ms      6.0 ms    +22%   (1 brain vs 3)
  AI commands over 600 ticks       13          39       x3
```

The world grows only 36% because Gaia dominates the opening census and does not scale; the ARMIES
grow 106%, and armies are the half that grows during a match. Three brains cost 22% more IN TOTAL
than one because every brain is slow-ticked and phase-offset, at ~0.01 ms against a 33.3 ms budget
— so the AI layer is not a player-count risk. **Vision is**: 4.2% -> 7.0% of a 30 Hz tick, and it
is the per-player stamp loop rather than allocation, since `Vision` already allocates
`MAX_PLAYERS` grids of `MAP_CELL_COUNT`. This is a STATIC OPENING CENSUS — nothing moving, no
combat, no projectiles — so the absolutes are a floor and the shape is what should be carried
forward. Movement, steering, pathfinding, targeting and damage were never timed at four armies at
all.


---

## 11. From the WebGPU migration plan, before it was deleted

Extracted 2026-08-18. The migration shipped (stages A-F); these are the measurements inside
the plan that outlive it.


## 7d2. THE SHADER PORTS, MEASURED AGAINST A CONTROL AND A FLOOR — Stages C and D, 2026-08-17

`tools/terrain-node-compare.mjs` and `tools/stage-d-node-compare.mjs`, real Chrome,
`backend.isWebGPUBackend` asserted true per arm, 640x480, **dither off on both sides** — the
ordered dither is a deliberate +/-0.5/255 and the two paths derive its grid from `gl_FragCoord`
and from `screenCoordinate`, so with it on most of the frame reports as changed at max delta 1
whether or not the shaders agree.

**Stage C, terrain.** `tsl-webgl2` against the shipping `glsl-webgl` is **4.547% of pixels at max
delta 11**, against a stock-material lighting floor of **4.191% at max 1** — the translation sits
on the floor. The WebGPU arm's much larger residual (57.775% at max 31) is the BACKEND and not the
shader: the identical graph across the two backends agrees within 1/255 on 99.9% of pixels.

**Stage D, structures / units / props.**

```
                              changed   over 8/255   max    mean
  tsl-webgpu   vs glsl-webgl    6.838%      0.799%     77   0.347
  tsl-webgl2   vs glsl-webgl    5.595%      0.726%     77   0.318
  glsl-webgpu  vs glsl-webgl   18.190%     17.682%    238  11.650   <- CONTROL
  stock-webgpu vs stock-webgl   0.638%      0.000%      1   0.006   <- FLOOR
```

**THE CONTROL AND THE FLOOR ARE WHAT MAKE THE PORT'S NUMBER MEAN ANYTHING; A PORT A/B WITH NEITHER
IS UNREADABLE.** The control is the shipping GLSL materials handed to the node renderer, where
`onBeforeCompile` is silently dead — it differs VISIBLY on 17.682% of pixels against the port's
0.799%, a factor of 22, and that is the frame-level measurement of a fact §7b established only by
counting calls. The floor is two stock physical materials, one per renderer, at 0.638% and max
delta **1**: unlike Stage C's terrain scene there is effectively no lighting-model gap to hide in,
so Stage D's residual is the port's own. It is concentrated on silhouettes and normal-mapped
curvature rather than on any of the ported branches — check that before calling a new residual a
regression.

**EVERY NUMBER IN THIS SECTION WAS TAKEN ON THE INTEGRATED RADEON, AND THAT IS THE ONE CAVEAT ON
THE VERDICT.** A discrete GPU cuts the GPU side and leaves the CPU side where it is, so the 8.4x
narrows — but 8.4x is an enormous margin to close, and the SLOPE (r2 0.995-1.000 against pixel
count) is a property of what this frame draws rather than of the device that drew it. A
discrete-GPU re-run is worth having before any large spend and is not worth waiting for before
believing this. It is also cheap now: §7h took a WebGPU arm on this machine's NVIDIA part in real
Chrome, and §7j moves both renderers onto it in the desktop shell, so the re-run is the same
`tools/gpu-profile.mjs` command on the other adapter rather than on another machine.

**THE STAGE E VFX PORT COULD NOT HAVE MOVED THESE NUMBERS, AND IT WAS MEASURED ANYWAY.**
`apps/game/src/vfx/FlashBudget.ts` is CPU arithmetic — `admitGlare` returns a multiplier, the emitters fold
it into `EmitDesc`'s intensity envelope, and it reaches both material sets as the same `aTint.x`
instance attribute. No shader reads it and no shader can change it. Measured regardless, one
machine and one session, `before` = the pre-Stage-E `apps/game/src/vfx/` against `after` = HEAD:
`tools/flash-stack.mjs`'s entire `cases` array is **byte-identical between the two arms**. Do not
re-run it to clear a VFX MATERIAL change; do re-run it the moment anything touches the emitter
gain path, which is the only thing that can move those numbers.


---

## 12. From the visual gap plan, before it was deleted

Extracted 2026-08-18. Six of the plan’s eight scheduled items shipped in v2.12.0 and wrote
their measurements into the files they changed; these are the findings that had no other home.

### P1-10 — CLOSED: terrain now carries a structural material-response array

The diagnosed gap was a texture set, and the fix keeps that shape without spending six ordinary
normal maps. `terrain-texture-gen.ts#buildLayerResponseArrayBytes` packs six slices of normal XY,
roughness delta and cavity into one linear `DataArrayTexture`; `TerrainMaterial.ts` and its node
twin splat that beside the existing six-layer albedo array. Field response is derived only from
the already band-limited 1.5-4 m drift and patch fields, then passed through
`packNormalStructural`, so the old 5-texel sandpaper cannot re-enter through the normal channel.
A 14 m world-space roughness term breaks the response repeat at range. Cost: one sampler binding,
six compact response fetches, zero materials and zero draw calls. Worker generation, transfer,
adoption, biome swaps and both render backends share the same bytes and are pinned by the terrain
and worker specs.

### P2-12 — CLOSED: faction colour and player identity are measured separately

The old validator measured only explicit `teamSlab` area while `glass`, `insignia` and building-pad
paint remained in the denominator. On the Allies all four live in the same broad blue family:

```
  teamSlab        #2A2ED0   hue 238   counted
  insignia field  #1C169A   hue 244   NOT counted
  glass           #0F2E60   hue 216   NOT counted
  pad             #172231   hue 214   NOT counted (separate material)
```

Measured on an Allied tank crop: **52.2% of chromatic pixels at 220-240 degrees, plus 13.4% at
200-220.** The missing accounting was real, but `ART_DIRECTION_V2.md` now makes an important
distinction the old proposal did not: faction readability and player/team identity are different
channels. Reclassifying every cobalt glass or foundation texel as player ownership would "fix" the
number by violating that law.

The architecture atlas now records `factionColourTileCover` per slot by measuring saturated texels
within 26 degrees of the faction's primary or secondary hue. `validateUnit` and
`validateStructure` area-weight that coverage across visible surfaces; structures include the
separate foundation atlas through `padSurfaceSlot`. `teamFraction` deliberately remains the strict
explicit-identity metric used by R-T1, while `factionColourFraction` reports the wider palette read.
This counts glass, insignia and authored pad paint without pretending bare Allied blue-grey metal is
a team slab. `apps/game/tests/faction-colour-coverage.spec.ts` pins the classification and
`apps/game/tests/vertical-slice-art.spec.ts` proves all four faction leaders expose more faction colour than
explicit team colour.

### P1-6 — CLOSED: clearcoat is masked per procedural atlas class

The four faction coats remain the authored top-level finish, but they no longer cover every texel.
`greeble-gen.ts#applyMaterialSurfaceClasses` writes a normalized coat factor into the unused
alpha channel of the existing ORM atlas: painted panels keep the faction coat, while concrete,
bare metal, treads, vents, grilles and emissive machinery remove it. `BuildingFactory.ts` consumes
that channel inside `PhysicalMaterial.clearcoat`; `StructureNodeMaterial.ts` consumes the same byte
through `clearcoatNode`. This is a real per-texel mask with no fifth atlas texture, no material
split and no draw call. Pads remain fully matte by class rather than by accident.

### P1-7 — PARTLY CLOSED: architecture now consumes SURFACES

`ArtDirection.surfaces.buildingPanel`, `buildingConcrete`, `vehicleGlass` and `vehicleTread` now
drive the procedural architecture atlas. Painted walls and concrete pads are constrained to their
declared roughness bands, and the class clearcoat values author the ORM-alpha mask described above.
This closes the building-material request and overturns the old "no readers" claim. The 2026-08-21
follow-up also gives `vehicleArmor` a hull reader, confines `edgeWear` to the atlas patch sampled by
real chamfer geometry, and applies architecture grime as three broad downward
albedo/roughness/AO bands. It never modifies height or normals and never puts grime on live
vehicles, preserving the no-sandpaper and clean-unit laws. The wider table is still not declared
globally complete: several non-architecture archetypes retain dedicated implementations.

### P0-2 — how the 0.47 shadow/lit ratio splits between the multiplier and the hemisphere

**How the 0.47 splits, which is what makes the pairing plannable.** Removing the leak alone takes
the shadow/lit ratio from ~0.47 to ~0.40, against the bible's 0.33. So `shadowIntensity` owns
roughly a third of the excess and `LIGHTING.hemiSkyIntensity` (0.60) owns the rest; a trim toward
~0.48 alongside `shadowIntensity: 1.0` was the balanced first thing to measure. **The bracket on
the low side is already measured and is not far away:** cutting `hemiSkyIntensity` to 0.26 put
shadowed grass at 0.030 / 0.069 / 0.162 of lit, against §13 #7's required 0.20-0.26 / 0.29-0.35 /
0.46-0.56 — shadows that dark are not contrasty, they are holes. That capture is why the note at
`config.ts:705` was rewritten, and an older claim that the note quotes a dead-uniform-era
measurement is no longer true. Any paired change lands between those two bounds, and scorecard
#9's emerald window has to be re-read in the same pass.

**Closed 2026-08-21.** The paired production values are `shadowIntensity: 1.0` and hemisphere fill
`0.52`. The first 0.48 capture made the combat fixture's pixels below luma 0.08 rise from 7.3% to
13.2%, so the fill was eased upward without restoring any blocked key light. On the reviewed 13-shot
2560x1440 set, median luminance spans 0.151 (intentional dusk) to 0.408, p1 spans 0.013-0.039, all
thirteen green-leak checks remain under the 0.02 hard ceiling, and the recalibrated regression grade
is 99.4%. The one remaining failure is dusk's pre-existing exact saturation-curve check, not a
permission to weaken shadows.

### P0-4 follow-up — varied pads, still one atlas and one material per faction

**Closed 2026-08-21.** `BuildingFactory.padSurfaceSlot` hashes the stable structure content key and
selects one of the three authored slab plans for foundation paint. Stripe, emissive, insignia and
other identity slots are never remapped. Every faction still owns exactly one 256 px pad atlas, one
material and one draw class; the variation is only a different UV rectangle inside already-merged
geometry, so it adds no texture, material, batch or draw call.

### Procedural wreck decision — SHIPPED, not abandoned

The formerly unreachable `apps/game/src/art/Wrecks.ts` is now the runtime death-art source. The integration
registers five factions x five vehicle classes plus five factions x three building-rubble sizes:
40 deterministic geometries, with stable Wreck-kind-only ids in `apps/game/src/core/wrecks.ts`. Dead vehicles
select a hulk from their authored radius. Dead structures leave low, non-blocking faction rubble
that burns briefly and then persists until salvaged or covered by a replacement foundation.
Meridian ruins retain shattered aperture/journal forms; Reclamation ruins retain welded rails,
coil and hazard plate; Allied and Soviet palettes keep their existing silhouette languages.

The whole set is prepared at boot but `RenderBridge` creates batches lazily, so an untouched match
pays zero wreck draw calls. Wrecks now share the prop material path, which finally consumes their
authored emissive ember and gloss attributes; `aSway` remains zero. This closes Visual DNA's
persistent-rubble requirement without adding downloaded models or a second material program.

### P3-14 — alpha-tested leaf cards were costed and refused on plumbing, not on look

**Alpha-tested leaf cards: refused on plumbing, not on look.** `PropMesh.toGeometry()`
(`PropLibrary.ts:779`) emits `position, normal, color, aSway, aEmit, aGloss` and an index — **no
`uv`** — and `grep -rn "alphaTest" apps/game/src/` finds no alpha-tested geometry anywhere in the project.
Every primitive (`box, cyl, disc, blob, cone, blade, tri, quad`) would need a UV, and
`mergePropGeometries` requires identical attribute sets, so it is all-or-nothing across the whole
prop library. On top of that, `alphaTest` kills early-Z on the ANGLE/D3D11 path, and the geometry
it would apply to is tall overlapping canopy quads with heavy overdraw — the worst case for that
loss. Costed at 1-2 days with a real overdraw risk. §3 lists tree canopies as one of only two
honest costs of the no-downloads rule; this is why the obvious way to pay it is not obviously
worth paying. **The non-convex lobe canopy shipped instead** — 6-8 branch stubs each ending in 3-5
`blob(r 0.6-1.1, 6, 3)` lobes, 26-32 lobes per tree, ~+44% triangles against a frame where
triangles are not the constraint, 0 extra draw calls — and took enclosed sky from 0.0% to
3.1-18.8% on every seed.

### The weighted grade did not move for a correct eight-item art pass

**A correct eight-item art pass moved the weighted grade by 0.0 points.** v2.11.0 to v2.12.0
landed the splat quantile fix, the Allied pad, the facade albedo, the rust split, the prop-type
cap and the lobe canopies; the grade stayed 92.0% with the same 13 failing checks, all #34, zero
weight-3. The instruments that measure what actually changed did move — `edgeCoverage` improved on
all 13 fixtures (`03-terrain` 0.1760 -> 0.1965, +11.6%) and `greenHueLeak` on 12 of 13, taking
`08-naval-water` from 0.0171 to 0.0074 against a 0.02 ceiling. That is the third time a real
visual change has scored 0.000000 on the weighted grade, alongside the AO prepass deletion. **The
weighted grade is not the instrument for judging an art change**; `tools/shot-compare.mjs` and the
individual metric rows are.

### Experimental WebGPU SSGI — viable at half resolution, not a Lumen replacement

**Measured 2026-08-26; opt-in only.** The WebGPU post chain now has a guarded experiment based on
Three's official `SSGINode`. Enable it with `?gpu=webgpu&gi=ssgi`; `medium` and `high` are explicit
comparison presets. The default remains the shipped GTAO path. The experiment requires a perspective
camera and the adapter's `rg11b10ufloat-renderable` feature, and falls back to GTAO when either is
missing or graph construction fails.

The important cost rule is structural: SSGI's own AO replaces GTAO rather than stacking on top of it.
The conservative preset traces 2 slices x 6 steps at 50% drawing-buffer resolution, denoises only
the bounced RGB, disables temporal accumulation, and composites that bounce before bloom and grading.
The performance HUD records the work as a separate `gi` pass on adapters that expose
`timestamp-query`; `?gpupasses` forces those diagnostic rows on in development. An adapter without
timestamp queries reports the pass as unavailable rather than inventing a number.

On the same Allied-base fixture at the same 1152x648 output and identical 145-draw / 2,029,817-triangle
scene fingerprint, the warmed frame moved from roughly 18.1 ms with GTAO to roughly 19.7 ms with the
low SSGI preset: about +1.6 ms on the tested AMD WebGPU adapter. At a 2304x1296 drawing buffer the
experiment was roughly 8 ms slower in fresh samples, but the renderer-info fingerprints differed, so
that figure is a warning about fill-rate pressure rather than a clean A/B benchmark. The reviewed
captures showed useful contact bounce without obvious leaks after reducing horizon darkening, but the
effect is deliberately subtle and screen-space: it cannot recover off-screen light, maintain a world
radiance cache, or behave like Lumen through occlusion.

**Decision:** keep `low` as an engineering/art-development switch; do not make it a quality-tier
default yet. The next honest step toward Lumen-like lighting is a sparse probe or radiance-cache layer
for stable off-screen low-frequency bounce, with this SSGI pass reserved for local contact detail.
That work should be accepted only against the existing 1440p scorecard and a timestamp-capable GPU.

### Camera-aware instance culling — shipped with dense slot compaction

**Measured 2026-08-29; enabled by default.** `RenderBridge` now rejects entity spheres outside the
camera frustum plus a 40 m shadow-safe margin. That margin retains an aircraft whose off-screen sun
shadow can still land in the viewport. It applies only to entity instance batches; terrain, roads,
water, VFX and HUD keep their existing culling/lifetime rules. `?rendercull=off` is the development
A/B escape hatch.

This needed a batching change as well as a frustum test. `InstancedMesh.count` draws one prefix, so
freeing an off-screen slot in the middle of a high-water allocation would otherwise save bridge CPU
but submit the same vertices. `InstanceBatch.free` now moves the live tail into the hole, copies all
matrix/state/team channels, and returns the moved entity owner so the bridge updates its binding.
The result is a dense `[0, liveCount)` prefix and a draw count that really falls. The visibility audit
classifies camera-culled entities separately instead of reporting them as invisible failures.

The fixed 300-second four-army WebGPU match at 1920x1080, seed 7, submitted the same 497-entity world
in both arms:

| WebGPU metric | culling off | culling on | reduction |
|---|---:|---:|---:|
| total triangles | 1,731,800 | 1,213,129 | 29.9% |
| shadow triangles | 921,302 | 577,164 | 37.4% |
| colour triangles | 810,469 | 635,936 | 21.5% |
| draw calls | 571 | 523 | 8.4% |

Raw captures are `artifacts/perf/render-cull-off.json` and `render-cull-on.json`. The frame-time
figures originally published here (4.3% median / 10.8% best-block improvement) were withdrawn on
2026-08-29: the harness called `advanceFrames(n)`, whose contract advances all n presentation
steps but deliberately draws only the last one, then divided that single draw and readback by n.
The structural triangle/pass split above remains exact WebGPU node-path accounting; timing must be
re-run with the corrected one-present-per-call harness before attaching a CPU/GPU percentage to
camera culling. The broad affected check passed render (973), assets (532),
contracts (296), UI and build/typecheck work; one concurrent terrain reachability test hit its
120-second timeout and passed alone (4/4) in 71 seconds.

### Shadow proxies are shadow-pass objects, not low-detail colour models

**Measured 2026-08-29; enabled on WebGL and WebGPU.** Imported unit and structure shadow proxies
used to remain ordinary visible scene objects. Their depth material made them useful in the shadow
map, but the colour renderer still submitted them after the reviewed model, paying a second draw for
an object whose colour contribution was intentionally invisible. Model metadata now marks these
parts `vmShadowOnly`; each renderer filters them outside its shadow pass, and batch growth preserves
the tag when it replaces a WebGPU `InstancedMesh`. `?shadowproxy=legacy` is the A/B escape hatch.

On the fixed 1920x1080 Soviet-base WebGPU fixture, filtering removed 12 colour/total draws,
38,880 colour triangles and 26 compiled programs. Shadow draws and shadow triangles were identical.
Raw captures are `artifacts/perf/shadow-proxy-legacy.json` and `shadow-proxy-filtered.json`.

### WebGPU scatter uses typed hardware instancing, not BatchedMesh

**Measured 2026-08-29; enabled by default.** Three r185's WebGPU `BatchedMesh` is not one hardware
draw for a heterogeneous prop carpet: `WebGPUBackend` loops `_multiDrawCount` and calls
`drawIndexed` once per visible instance. The Soviet-base fixture's apparently single
`prop.batch.shadow` object therefore issued 343 colour draws and 343 shadow draws for 3,682 resident
props. Scatter now shares the typed `InstancedMesh` path with WebGL: one submission per visible prop
type, with the same chunk culling, transforms, colour, wind phase and shadow rules. The old path is
retained only behind `?scatterbatch=legacy` so future Three upgrades can be measured honestly.

At 1920x1080 the same scene fell from 811 to 153 total draws: shadow 382 -> 53 and colour 400 -> 71,
an 81.1% submission reduction. Total, shadow and colour triangle counts were bit-identical; this is
not hidden geometry or reduced prop density. Compiled programs rose from 219 to 297 because Three
keys node pipelines by `InstancedMesh` identity, which is the explicit cold-boot/memory trade for
removing 658 recurring submissions. Do not coerce those UUIDs or monkey-patch the cache key:
Three's cached node-builder state also owns the instance-buffer bindings, so apparent program reuse
can make one prop type read another type's transforms. Raw paired captures are
`artifacts/perf/scatter-legacy-paired.json` and `scatter-instanced-paired.json`.

### Stable-camera shadows run at 30 Hz; camera motion remains full-rate

**Measured 2026-08-29; enabled by default on WebGPU and WebGL.** A static RTS camera does not need
to rebuild a 2048 px directional shadow map at every 60 Hz presentation. `ShadowCadence` now targets
30 shadow updates per second while the camera and projection matrices are unchanged. Pan, orbit,
zoom, aspect changes, camera shake, explicit captures and shadow-setting changes force the current
frame to rebuild. At 30 fps or below every frame updates, so the scheduler never compounds an
already-slow presentation with visible 15 Hz shadow motion.

There are two backend switches and both must remain manual. WebGL consults
`renderer.shadowMap.autoUpdate/needsUpdate`; Three r185's WebGPU `ShadowNode` ignores that cadence
and consults `DirectionalLight.shadow.autoUpdate/needsUpdate`. `RendererHandle.beginFrame` returns
one cross-backend decision and Bootstrap writes it to the sun's `LightShadow`. A dedicated latch
also avoids treating WebGPU's persistent renderer-level `needsUpdate` value as a new request every
frame. `?shadowcadence=legacy` restores full-rate shadows; `?shadowcadence=half` is the deterministic
alternating A/B mode and intentionally overrides camera forcing for measurement only.

The A/B also fixed `tools/gpu-frame-ab.mjs`: timing now calls `advanceFrames(1)` once per submitted
frame instead of timing `advanceFrames(n)`'s single final draw and dividing by n. On the fixed
Soviet-base WebGPU fixture at 1920x1080, seven blocks of 180 real submitted frames produced exactly
180 scheduled shadow updates per legacy block and 90 per alternating block. Median uncapped
wall/submit fell from 1.229 ms to 1.153 ms (6.2%); the best blocks were effectively tied at
1.085 vs 1.078 ms. The equal screenshot readback in every block makes this a conservative
CPU+submission result, not a promise of 6.2% more player-visible FPS. The default adaptive mode
uses this saving only on stable high-refresh frames; movement keeps the existing visual response.
An organic 60 Hz WebGPU boot (not the deterministic harness) then scheduled 74 shadow rebuilds
across 121 presented frames over two seconds—39% fewer—while 31 camera/projection changes correctly
forced immediate updates; the browser reported no page exceptions.

### Small ground cover uses explicit shadow policy and silhouette-matched casters

**Updated 2026-09-01; enabled by default on WebGPU and WebGL.** Scatter definitions author whether a
prop type casts. Live overhead review rejected the 2026-08-29 decision to opt both grass-tuft types
out: neighbouring clumps visibly alternated between present and missing shadows. Both grass
identities now submit narrow 1.55 by 0.38 m, 24-triangle closed casters. Bush keeps its 48-triangle
budget but uses three compact overlapping masses instead of a broad octagon or two-lobe pill. Only
the 0.8 m flower bed opts out; trees, shrubs, grass, rocks, debris, street furniture and every
unit/structure retain shadows. This remains an explicit authoring flag rather than a height heuristic
because a bench, drum or low rock needs contact shadow to read as a solid object.

The fixed Soviet-base result below is retained as a historical measurement of the superseded
three-type filter, not as a performance claim for the current one-type policy. At that time,
`?scattershadow=legacy` restored all three types for a same-build A/B. The current switch restores
the flower bed only and therefore cannot reproduce that old comparison.

On the fixed Soviet-base WebGPU fixture at 1920x1080, five blocks of 120 actually submitted frames
reduced total/shadow draws from 153/54 to 150/51, shadow triangles from 710,028 to 673,692
(-36,336, 5.1%), and compiled programs from 297 to 291. Colour draws and colour triangles were
identical. Median uncapped wall/submit fell from 1.413 ms to 1.322 ms (6.4%); best blocks fell from
1.358 ms to 1.227 ms (9.7%). These are small-scene submission measurements, not a promise of the
same player-visible FPS percentage in a live match.

The final acceptance pair used real Chrome/WebGPU, the same scene/seed/camera/presentation clock,
and resident terrain-detail artwork. The filtered and legacy screenshots were byte-identical:
0 changed pixels out of 921,600. An earlier cold first-process pair was rejected because the 4K
terrain-detail image was still the neutral placeholder in one arm; `gpu-frame-ab.mjs --capture`
now gives that asynchronous decode a real-time completion window before its final frame.

The accepted 2026-09-01 allied-base seed-7 WebGPU review at 1040x720 is a visual/content proof, not
an A/B benchmark: 144 total draws (50 shadow), 1,439,867 total triangles (345,692 shadow), 368
foliage instances, and 14 colour plus 13 shadow foliage draws. The foliage shadow pass submitted
55,702 triangles. Grass casters are present and narrow; bush, field-tent and barrel shadows remain
attached to their visible component silhouettes without changing the family-level draw count.

### Ground decals follow the terrain triangles that are actually drawn

**Fixed 2026-08-30; WebGL and WebGPU.** Track, scorch and environmental decals used gameplay's
bilinear `Terrain.heightAt`, while flat terrain chunks may submit a half-resolution triangle index
whose colour surface differs by as much as 0.15 m. The decal's 0.08 m physical lift and polygon
offset therefore could not prevent the optimized terrain from passing through a mark as camera depth
changed. Raising every decal above the full error budget would have made ordinary marks visibly float.

`drawnTerrainHeightAt` now mirrors both emitted terrain index topologies, including the stitched fan
around a decimated chunk boundary. `Terrain.drawnHeightAt` selects that topology from the same chunk
LOD mask used during mesh publication, and the decal fields conform to the higher of the authoritative
gameplay surface and the drawn colour surface. The existing 0.08 m lift then clears both that support
surface and the 0.06 m road ribbon. A geometry test compares fractional samples against the emitted
fine and decimated triangles; the canonical terrain close-up passes in both renderer capture paths.

### Imported unit families decode through a bounded outer pool

**Measured 2026-08-30; enabled by default.** Imported vehicles already loaded each model's LOD and
shadow files together, but the unit art systems awaited the models themselves one at a time. That
serialized independent fetch, parse and KTX2 work across the shared Allied/Soviet roster and both
private faction rosters. The three unit paths now use `mapConcurrent` with an outer limit of two on
smaller clients and three on clients exposing at least eight logical cores. The limit is deliberately
narrower than the structure pool: one unit task can fan out into LOD0, multiple colour LODs and a
shadow proxy, while the shared KTX2 loader remains capped at two transcoder workers.

On the same built `08-naval-water` all-faction cold fixture, the visible-curtain boot moved from
roughly 23.8 s to 22.1 s (-1.7 s, about 7%). `art.units` moved from 4,324 ms to 3,390 ms (-22%),
`art.faction3` from 3,765 ms to 3,394 ms (-10%), and `art.faction4` from 3,968 ms to 3,533 ms
(-11%). Terrain and water checksums remained `83d6389e` / `594a489b`; all imported-load failures
still retain their procedural fallback, result order remains deterministic, and private-faction MCVs
are still applied before registry publication. The post-change three-run warm visible-ready median
was 17,033 ms. Raw post-change output is `artifacts/perf/boot-unit-concurrency.json`.

### Runtime imported-catalogue streaming is diagnostic-only

**Measured 2026-08-30; eager preparation is the default.** Deferring non-opening GLTF catalogues
made an MCV match reveal several seconds sooner, but GLTF parsing, Three geometry construction and
material publication contain non-preemptible main-thread sections. `requestIdleCallback`, serial
catalogues and yields between every model reduced rather than removed the damage: a 30-second live
window still recorded 49 frames over 50 ms and a 217 ms worst frame. The original concurrent
stream recorded 86 frames over 50 ms, 77 Long Tasks and a 268 ms worst frame. An RTS camera that
freezes for one beat while claiming 60 fps is a worse result than a longer loading screen.

Normal play therefore prepares every seated faction's reviewed authored imports under the loading
curtain and compiles the populated scene before reveal. `?liveassetstream=on` retains the serial,
idle-sliced promotion path as an explicit A/B and future worker/offline-conditioning harness; it is
not a shipping fast path. The four-army headless cold fixture pays roughly 25 seconds before reveal
on the test machine, versus 12-14 seconds for the unsafe stream. The long-term way to recover those
seconds is an offline-conditioned runtime format or a GLTF parse worker, not main-thread work hidden
behind a timer.

The same investigation found two independent sources of false 60-fps confidence. The performance
HUD used a rolling percentile that cannot show one dropped frame, and background audio deliberately
allowed 90 ms between yields while decoding the whole recorded manifest together. The HUD now keeps
a persistent hitch count, last wall/CPU gap and worst gap; render presentation is separately
attributed. Sample decoding is bounded to six concurrent jobs and bank baking yields after 12 ms.
Finally, boot compilation temporarily exposes hidden effect pools, alternate LODs, construction
overlays and shadow proxies so their first visible use cannot compile a pipeline in the match.

After those changes, the full-audio, already-calibrated 10-second live probe recorded zero Long
Tasks; its busiest audio frame was 5.1 ms, VFX 9.5 ms, pathing 14.7 ms. Two raw rAF gaps remained in
headless Chromium (100/67 ms) without an accompanying main-thread task, so native WebGPU pacing is
still the final authority. The raw progression is in
`artifacts/perf/boot-private-streaming-idle.json`, `boot-private-streaming-sliced.json`,
`boot-no-live-asset-stream-clean.json`, and `boot-full-audio-hitch-fix.json`.

### Desktop WebGPU atmosphere is fused, depth-aware and shroud-safe

**Implemented 2026-08-30; Medium-Ultra WebGPU.** A scene-wide fog retry was rejected because the
previous noon fog path washed every material and compiled fog work into the whole scene. The shipped
slice instead reconstructs world position once in the existing HDR post expression, reads a 64 KiB
seamless cloud field twice, preserves emissive HDR peaks, and adds at most a few percent of
height-aware aerial perspective beyond the immediate combat range. Sky depth and black shroud pixels
are excluded. This adds no render target, pass or draw.

Airborne dust shares the existing lit particle batch. It is deterministic render-side state, samples
only live-vision land cells around the camera, stops before combat-particle pressure, scales by quality
and nearly disappears in rain. The real RTX WebGPU smoke completed with 147 draws and no page/pipeline
error; `artifacts/perf/cinematic-atmosphere-smoke.json` records the correctness run. Visual tuning
still requires a player-resolution moving-camera review rather than treating that smoke as an image
quality or frame-time result.

### Saved WebGPU MSAA was displayed as enabled while the live target stayed single-sampled

**Fixed 2026-08-30; desktop WebGPU.** The shell constructs the renderer before it applies the saved
Graphics profile. A profile with Edge Antialiasing enabled therefore changes `msaaSamples` from 0
to 4 after the initial node graph exists. `PassNode` bakes its sample count into the scene render
target at graph construction, but `postGraphSignature` did not include that count, so
`NodePostChain.syncConfig` took its uniform-only path and never rebuilt. Settings truthfully stored
and displayed 4x MSAA while the live colour target remained 0x for the whole match. At RTS scale,
thin roof rails and panel seams then broke into black dashed crawl; SMAA cannot reconstruct geometry
coverage that was never rasterised.

The graph signature now includes the effective integer sample count. The node-chain test proves a
0x/4x change produces different signatures and that the constructed scene target itself reports
four samples; development diagnostics label the live graph `msaa4x` rather than repeating config.
A native 1920x1080 Frozen Sector review on the saved Ultra/100%/adaptive-off profile showed stable
blended coverage on the reported Allied unit and barricade line. This is intentionally not a new
default or a performance claim: it makes the existing player choice take effect.


---

## 13. From the Electron plan, before it was deleted

Replace §7j's final bullet ("WHAT THIS DOES NOT ESTABLISH: that Electron passes the switch
through… still unmeasured") with:

-  **ELECTRON PASSES IT THROUGH — measured 2026-08-17, on the same laptop, inside the shipped
  shell.** Gate zero was Edge, i.e. plain Chromium on the command line, and
  `app.commandLine.appendSwitch` before `app.whenReady()` is a different call path. It reaches the
  GPU process:

  ```
                   active adapter, read from the MAIN process via app.getGPUInfo('complete')
  default          0x10de:0x249c   NVIDIA GeForce RTX 3080 Laptop GPU
  --vm-safe-mode   0x1002:0x1638   AMD Radeon (integrated)
  ```

  Two independent reads agree, which is the standard: under `--webgpu` the renderer's own
  `GPUAdapter.info` reports `nvidia`/`ampere` with `backend: 'webgpu'` while the main process
  reports the NVIDIA device id. `apps/desktop/src/main.ts` logs the active adapter on **every** boot
  for exactly that reason — the effect site can no-op with no log line of its own, so the switch
  having been appended is never the evidence.

And at §7j's provenance line, replace "Gate zero of the Electron plan §1, on
the RTX 3080 laptop that produced the §7g observation:" with "Measured on the RTX 3080 laptop that
produced the §7g observation, with a ~50-line Playwright probe:".

This is a rewrite rather than an append because §7j's own rule says so, and because CLAUDE.md
already cites §7j as the proof that the switch works — leaving "still unmeasured" standing there
points the next reader at an entry that contradicts the sentence that sent them to it.
