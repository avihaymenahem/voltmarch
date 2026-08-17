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
`frame.drawCalls` in `shots/_report.json` is a **SUM OVER THREE SCENE SUBMISSIONS**: colour pass,
shadow pass, and `GTAOPass`'s normal prepass. `MAX_DRAW_CALLS` (130) budgets the COLOUR PASS ALONE.

Instrumented live against `renderBufferDirect`, reproducing `_report.json` exactly:

```
01-establishing-base:  219 total = 78 colour + 54 shadow + 67 AO prepass + 20 post quads
```

`stats()` and `_report.json` now carry `drawCallsByPass` = `{shadow, colour, ao, post, total}`,
reconciling exactly on all 13 fixtures. **Current colour pass is 51–77 against 130.**

> **There are roughly 50 colour draws of headroom and the project should be SPENDING them.** Several
> systems below are capped "for the draw budget" against a budget that is half empty.

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
   present (2 and 4 call sites), so this is not a missing feature — something in this material's
   custom-program path is not taking the uniform. `material.roughness` is inert on terrain for a
   known and deliberate reason (`onBeforeCompile` replaces `<roughnessmap_fragment>` with the
   splat-driven `raRough`); `envMapIntensity` has no such explanation yet.

**So the line was NOT shipped.** Adding an authoritative-looking constant that reaches no pixel is
precisely the `SURFACES` defect (§3, and `config.ts`'s own dead material table) and precisely the trap
§5 and §7 describe. If the bible's 0.35 is wanted for the ground specifically, it must be scaled
inside `TerrainMaterial.ts`'s own injected GLSL, with `customProgramCacheKey` bumped past
`'ra-terrain-v3'` — and then MEASURED, because §6b is a fresh reminder that a change which is
bible-correct in isolation can still cost grade points.

**Do not re-attempt this as a one-line config edit.** It has now been tried and disproved once.

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

## 8. Unverified — do not quote these as fact

- **`GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format and sampler type` is
  REAL and PRE-EXISTING.** Upgraded from "unverified": it was reproduced on the baseline build as
  well as the changed one, so it belongs to neither. It is a live per-frame GL error nobody has
  chased and it deserves its own task. (`shots/_report.json` stores no console message TEXT, which
  is why the artefacts alone could not settle it — that is worth fixing in the harness.)
- `[roads] junction corner radii 3.1–6.0 m are outside scorecard #33's 4–8 m band` — self-reported by
  the harness, not independently checked.
