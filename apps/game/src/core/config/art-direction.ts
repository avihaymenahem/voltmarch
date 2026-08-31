/**
 * Domain-owned config slice: renderer art direction, moods and surface language.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import type { ArtDirection, DeepPartial, FactionLook, SurfaceArchetype, SurfaceLook } from '../types';

/* ==========================================================================
 * 4. ART DIRECTION — SUN, SKY, ATMOSPHERE
 * ========================================================================== */

const SUN_NOON = {
  /** Compass degrees. Governs which side of every building is lit. */
  azimuthDeg: 312,
  /** Degrees above horizon. Low = long dramatic shadows; high = flat. */
  elevationDeg: 38,
  /** ~5200 K warm daylight. The single biggest driver of "what time is it". */
  color: '#FFE7C4',
  /**
   * Direct sun strength in the HDR buffer, pre-tonemap.
   *
   * V3 lowers the previous 3.4 key so white ceramic keeps its bevel and panel
   * response instead of flattening against the ACES shoulder. Direction and
   * colour still carry the warm daylight read; exposure no longer has to spend
   * the whole highlight range on the lightest faction.
   */
  intensity: 3.0,
  /*
   * `shadowColor: '#2A3550'` USED TO SIT HERE AND IT WAS WIRED TO NOTHING.
   * It was declared on `SunLook` and on `SunConfig`, written in three tables and
   * copied through `ArtBridge`, and read by no shader, material or pass — a
   * five-hop chain ending nowhere. Shadows ARE tinted, and the bible's §13 #7
   * per-channel lit/shadow ratio is still met; the tint comes from
   * `TONE_NOON.shadowTint` via `post.ts`'s `uShadowTint`, which applies to the
   * low end of the luminance range rather than to a light. Deleting this
   * changed no pixel — see `ATMOSPHERE_NOON.hemiSky` above, which says the same
   * thing from the other side.
   */
  /**
   * PCF radius in shadow texels. Higher = softer, mushier contact.
   *
   * 2.2 -> 1.0, AND IT COSTS NOTHING. three's `SHADOWMAP_TYPE_PCF` is a FIXED
   * five-tap Vogel disk with interleaved-gradient rotation
   * (`shadowmap_pars_fragment.glsl.js`), and `radius` only scales the offsets:
   * `radius * texelSize`. The tap count does not move with it. So this is a
   * pure quality knob with no frame cost attached in either direction, which is
   * unusual enough to be worth stating — it was being read as a
   * quality/performance trade and it is not one.
   *
   * 2.2 put every cast-shadow edge at roughly an 11 px smear at 1440p. The
   * bible's §3.3/§11 position is that "hardness is identity": RA3's shadows are
   * crisp, and a soft edge is the single most reliable way to make a stylised
   * frame read as a generic engine. At 1.0 the same edge lands near 5 px and
   * bevel-scale detail — roof stacks, track shadows, kerbs — starts resolving
   * instead of dissolving.
   *
   * STILL NOT INSIDE THE BIBLE'S 1.2-2.5 px BAND, and this note should not
   * pretend otherwise. At the shipped `medium` tier a shadow texel is ~2.5
   * screen px, so radius 1.0 is ~5 px however tight the radius goes; closing
   * the rest needs `mapSize` 1536 -> 2048, which moves the capture pipeline and
   * belongs in its own commit with its own re-baseline.
   *
   * `overcast` deliberately keeps 6.0. A flat, soft, desaturated mood is what
   * that preset is FOR — it is the "is the lighting carrying this?" control.
   */
  shadowSoftness: 1.0,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  /**
   * How much of the shadow term reaches the surface. Three r185's `getShadow`
   * ends `return mix(1.0, shadow, shadowIntensity)`, so anything below 1.0 adds
   * the KEY LIGHT back into shadow.
   *
   * THIS WAS 0.80, AND THE BIBLE BANS IT BY NAME. §3.3 line 165, verbatim:
   * "Never use a shadow-darkness multiplier — the hemisphere fill does it."
   * At 0.80 every shadowed pixel was getting 20% of the key handed back —
   * `0.2 x 3.4 x sin(38deg) = 0.42` of scene-linear radiance against a
   * hemisphere fill of 0.60, i.e. roughly a THIRD of everything a shadowed
   * surface received came from a light that is supposed to be blocked.
   *
   * Measured on the shipped captures before the change, shadow/lit per channel:
   *
   *     01-establishing-base   0.446  0.515  0.561   luminance 0.499
   *     03-terrain-closeup     0.406  0.481  0.592   luminance 0.464
   *     bible §3.3 / §13 #7    .20-.26 .29-.35 .46-.56  luminance 0.33
   *
   * R and G were 1.6-2.2x above band. Note what was NOT wrong: normalised to
   * blue we sat at (0.75, 0.86, 1.00) against a typical target of
   * (0.75, 0.80, 1.00), so the shadow HUE was already right and `shadowTint`
   * needed no rework. The failure was purely LEVEL, which is exactly the
   * signature of a multiplier lifting every channel together.
   *
   * The superseded note here read "eased from 0.92 ... at 0.92 the shadow term
   * was removing so much of the key that the ambient could not put the ratio
   * back inside the 0.20-0.26 band". That is the right diagnosis attached to
   * the wrong knob: if the shadow end is too dark the fix is the fill, which is
   * what the bible sentence above means, not a leak in the shadow itself.
   * `hemiSkyIntensity` below is the knob that sentence points at.
   *
   * WHY DID IT STAY AT 0.80? Because setting it to 1.0 ALONE was measurably
   * worse, and this was bisected rather than argued. One capture with only that
   * knob moved, everything else in the commit held constant:
   *
   *                        grade   weight-3 failures
   *     0.80 (this)        91.1%   1  (03 p99, owned by the Allied albedo)
   *     1.0                90.2%   2  (+ 09-placement scorecard #9)
   *
   * `09-placement` greenHueLeak goes 0.0123 -> 0.0640 against a 0.02 ceiling —
   * 3.2x over, on a weight-3 check. The mechanism is not mysterious. The key is
   * WARM; while it leaks into shadow it washes the grass toward yellow-olive.
   * Take it away and shadowed ground is lit by the fill alone, which is bluer,
   * and on a green albedo raising B toward R walks the hue straight up into
   * scorecard #9's 100-120 "amateur emerald" window. Measured shadowed ground
   * went (53,56,21) at hue 65 to a population centred on (42,58,39) at hue 110.
   *
   * And note the arithmetic that says this is OUR fill being too blue rather
   * than the metric being unfair: the bible's own typical shadow ratio
   * (0.75, 0.80, 1.00) applied to our grass '#666B44' lands at hue 91 — outside
   * the window with room to spare. A correct shadow does not trip #9. Ours is
   * bluer than the bible's, which is a statement about `hemiSky`/`hemiGround`
   * and the env probe, not about this line.
   *
   * RESOLVED 2026-08-21 AS THE PAIRED CHANGE the note required: the multiplier
   * is now 1.0 and `hemiSkyIntensity` below is 0.52. The first 0.48 bracket made
   * the combat fixture's near-black population jump from 7.3% to 13.2%; 0.52
   * restores readable undersides while keeping a true blocked key. This must
   * remain paired: weakening either half recreates the lifted olive shadow or
   * the unreadable blue-black hole documented above.
   */
  shadowIntensity: 1.00,
  /**
   * ONE shadow camera, fitted per frame to the visible ground quad and clamped
   * to this radius, texel-snapped so shadows do not crawl when the camera pans.
   *
   * `cascadeNear: 90` used to sit above this line. THERE IS NO CASCADE CHAIN to
   * be near of: `scene.ts` builds a single `DirectionalLight` with a single
   * orthographic shadow camera, and the ground bounce next to it sets
   * `castShadow = false`. Its one consumer wrote the shadow camera's INITIAL
   * left/right/top/bottom, which `fitShadow` overwrites on the first frame, so
   * the value never survived to be seen. Deleted rather than left looking
   * configurable.
   */
  cascadeFar: 320,
  cascadeResolution: 2048,
};

const ATMOSPHERE_NOON = {
  /**
   * Sky-coloured ambient from above. Fills the shadow side of everything.
   *
   * THIS VALUE WAS THE BLUE-GREY "MOULD" CAST, and the diagnosis is worth
   * keeping because two agents got it wrong before it was proved:
   *
   *   - It is NOT the GTAO denoiser. GTAO on vs off is pixel-identical.
   *   - It is NOT the post chain. `setPostEnabled(false)` keeps the blotches.
   *   - Setting `normalMap = null` scene-wide removes them completely.
   *
   * So the blotches are normal-map RESPONSE, and the amplifier is right here.
   * The old '#8FB6E8' is linear r0.27 : g0.46 : b0.80 — a 3x blue-over-red
   * fill. A HemisphereLight weights by `normal.y * 0.5 + 0.5`, so every texel
   * a normal map tilts away from straight up got a dose of saturated blue that
   * scaled with the tilt. On a surface whose height field is per-pixel noise
   * that paints a blue mould over the whole frame.
   *
   * The replacement is a warm near-neutral (linear r0.66 : g0.63 : b0.56).
   * Ambient fill now changes only the VALUE of a tilted texel, never its hue.
   *
   * The bible's blue shadow tint (§13 #7, lit/shadow per-channel ratio
   * 0.20-0.26 / 0.29-0.35 / 0.46-0.56) is NOT lost: it comes from the shadow
   * term instead — `TONE_NOON.shadowTint` is a luma-normalised '#16294A' and
   * applies to the low end of the luminance range, i.e. to pixels that are
   * actually in shadow, rather than to every tilted texel in the frame.
   */
  hemiSky: '#D6CFC0',
  /**
   * Paired with `shadowIntensity: 1.0` above. 0.52 is deliberately close to the
   * original fill strength: the blue-grey mould cast was the fill's COLOUR,
   * not its strength, while the removed 20% key leak supplies the missing
   * contrast.
   *
   * Cutting this to 0.26 alongside the recolour did make the frame contrastier
   * and it also broke the bible outright. Measured on `03-terrain-closeup`, the
   * shadowed grass came back at a 0.030 / 0.069 / 0.162 per-channel ratio of
   * the lit grass, against §13 #7's required 0.20-0.26 / 0.29-0.35 /
   * 0.46-0.56. Shadows that dark are not "contrasty", they are holes — the
   * exact failure the bible calls out for shadow colour in the first place, and
   * the reason RA3's own shadows stay fully readable.
   *
   * Contrast belongs to the grade (GRADE_PIVOT / GRADE_WHITE in post.ts), which
   * can widen the histogram without emptying the shadow end of it.
   */
  hemiSkyIntensity: 0.52,
  /** Warm bounce from the ground. Stops undersides going dead grey. */
  hemiGround: '#7A6248',
  hemiGroundIntensity: 0.34,
  /**
   * Procedural sky dome ramp. Deepened and saturated: the old pair was a
   * near-white '#C6D4DE' horizon (S 0.13) under a muddy zenith, which is both
   * the washed-out sky RA3 never has AND — via the env probe baked from this
   * very dome — a grey IBL smeared over every reflective surface in the game.
   */
  skyZenith: '#1F5FB4',
  skyHorizon: '#93BEE4',
  /**
   * The lower sky hemisphere is what the camera sees beyond the square terrain.
   * It is the out-of-map void, not a continuation of the biome. Keeping it
   * black gives the battlefield a clean hard boundary instead of the old beige
   * apron, while `hemiGround` above remains the independent material bounce.
   */
  skyGround: '#000000',
  /** Angular size of the sun disk in degrees. */
  sunDiskDeg: 0.6,
  /** Width of the bright haze band above the horizon, in degrees. */
  hazeWidthDeg: 8,
  /** Height fog colour. Only reachable when `fogDensity > 0` (see below). */
  fogColor: '#B8C6D6',
  /**
   * ZERO ON A DAYLIGHT MAP. Bible §1 standing rulings ban fog outright at noon,
   * and scorecard #12 (far-field saturation >= near-field minus 0.05) is the
   * automated form of that ban. Measured: with fog at 0.0075 the far field ran
   * 0.08-0.35 LESS saturated than the near field on 10 of 12 shots, because a
   * '#B8C6D6' haze lerped toward a near-white horizon is a desaturation ramp
   * painted over the back half of the map.
   *
   * `ArtBridge.fogEndFromDensity()` maps 0 to a 4000 m fog end, i.e. no
   * measurable extinction inside the 900 m far plane. Dusk and dust keep their
   * fog: those are not daylight maps and #12 is judged on the noon look.
   */
  fogDensity: 0.0,
  /** Fog thins with altitude at this rate per metre. */
  fogHeightFalloff: 0.045,
  /** Metres before fog starts accumulating. */
  fogStart: 140,
  /**
   * Blend of distant geometry toward sky colour. Zero for the same reason as
   * `fogDensity`: aerial perspective IS the desaturation #12 measures.
   */
  aerialPerspective: 0.0,
  /**
   * Image-based lighting strength, regenerated from the sky on art change.
   * Trimmed with the hemisphere — the env probe is the other omnidirectional
   * fill — but NOT below ~0.6, because the env probe is also where the
   * specular highlight on every hull comes from and scorecard #6 needs those.
   *
   * The second reason it came down: scorecard #12. With the fog gone, the
   * remaining far-minus-near saturation deficit is a GRAZING ANGLE effect, not
   * a haze. The camera pitch is fixed at 52 degrees but the frustum is 36
   * degrees tall, so the top of the frame views the ground at 34 degrees off
   * horizontal and the bottom at 70 — and the environment specular Fresnel at
   * 34 degrees is several times what it is at 70. Distant ground therefore gets
   * a sheet of sky reflection laid over it: measurably brighter (q0 luma 0.571
   * vs q3 0.447) and measurably less saturated. Every point of env intensity is
   * a point of that sheet.
   *
   * It is only trimmed, not cut: the probe is also half of what lights a
   * shadowed surface (see `hemiSkyIntensity`) and all of what puts a silhouette
   * rim on a hull (scorecard #23).
   */
  envIntensity: 0.64,
};

/* ==========================================================================
 * 5. TONEMAP AND GRADE
 *
 * ALL of this happens in GradePass, AFTER bloom. The renderer itself is set to
 * NoToneMapping. Bloom must threshold in HDR before tonemapping or the
 * threshold means nothing.
 * ========================================================================== */

const TONE_NOON = {
  /**
   * 'aces', not 'agx'.
   *
   * AgX is a beautiful curve and it is the wrong curve for this game. Its
   * entire design goal is to desaturate on the way up so that no channel ever
   * clips — which is precisely the two things the RA3 side-by-side fails on.
   * Measured against 14 real RA3 frames: mean HSV saturation 0.317 vs RA3's
   * 0.527, and p99 luminance 0.61-0.89 vs RA3's 0.96, on every single shot.
   *
   * ACES (Narkowicz fit) keeps chroma through the mids, reaches its shoulder
   * about 3 stops earlier, and is what the 2008-era RTS grade actually looks
   * like. Emissives still roll off; they just roll off hot instead of pastel.
   */
  mode: 'aces',
  /**
   * Master exposure. NOT the knob for "the image is muddy" — bible risk R5 is
   * explicitly about reaching for this one. It scales blacks, mids and
   * highlights by the same factor, so it can only move the whole histogram;
   * `contrast` below is what widens it.
   */
  exposure: 0.84,
  /**
   * GAMMA contrast about scene-linear 0.18 (see GRADE_PIVOT in post.ts). 1.0 is
   * a no-op, higher steepens. Because the pivot is a gamma and not an offset,
   * black stays black and mid-grey stays put — all of the extra range lands in
   * the highlights, where scorecard #6 needs it.
   */
  contrast: 1.18,
  /**
   * Chroma gain. This alone can never CREATE saturation (a neutral grey has no
   * hue to amplify) — the accent masses in §6 and §20 do that — but with ACES
   * carrying chroma through the mids there is now something here to amplify.
   */
  saturation: 0.96,
  /** Shadows desaturate slightly — a filmic trick that reads as "graded". */
  shadowSaturation: 0.92,
  /**
   * 3-way colour balance: cool shadows, cool mids, warm highlights.
   *
   * This line read "neutral mids" while `midTint` was #8C8578 — luma-normalised
   * (1.11, 0.99, 0.78), which is not neutral in either direction it could have
   * meant. It was inert at the time, so nothing contradicted it. Both halves
   * are true now: the mids really are tinted, and they really are cool.
   *
   * `shadowTint` now carries the WHOLE of the bible's blue shadow requirement
   * (§13 #7), because the hemisphere fill that used to smear blue over every
   * tilted texel is gone. It is luma-normalised in GradePass, so it re-tints
   * the dark end of the range without changing its brightness.
   */
  /*
   * '#16294A' was too blue and it failed twice over. Luma-normalised it is a
   * (0.29, 1.02, 2.85) multiplier — nearly 10x more blue than red — and the
   * grade applies it by LUMINANCE, so it lands on everything dark, not only on
   * things in shadow. Measured consequences:
   *
   *   - §13 #7 overshot in one direction and undershot in the other: the
   *     lit/shadow ratio came back 0.167 / 0.272 / 0.531 against the required
   *     0.20-0.26 / 0.29-0.35 / 0.46-0.56. Too blue AND too dark in red.
   *   - Scorecard #9. A 79-degree olive leaf, darkened into the shadow band and
   *     then multiplied by that tint, rotates past 100 degrees and lands in the
   *     "amateur emerald" window. 4-5% of the pixels in every tree-heavy shot
   *     were shadowed foliage that had been tinted into failing.
   *
   * '#203D5F' normalised to (0.32, 1.05, 2.54) — 8.1x blue over red instead of
   * 9.9x — and it was still nowhere near enough. Measured after that change,
   * `04-units-parade` still leaked 2.7% into the emerald window and
   * `07-soviet-base` 3.2%, with the leaking pixels sampled at (25,53,15):
   * source `#495018` is a 76-degree olive with R/G 0.81, and it arrived on
   * screen with R/G 0.47 at hue 104. No albedo hue is far enough from emerald
   * to survive a 0.32x multiplier on red — pushing the foliage source below 72
   * degrees would turn it brown before it stopped rotating. The tint was the
   * cause, not the palette.
   *
   * '#4F5667' normalises to (0.81, 1.01, 1.47): blue-over-red 1.8x. That is
   * still an unmistakably cool shadow — the bible's blue shadow is a HUE, not
   * an eight-fold channel imbalance — and it is what finally stops dark
   * saturated greens rotating into the 100-120 window. It also moves §13 #7's
   * lit/shadow ratio the way the previous note said it needed to go: the
   * complaint there was "too dark in RED", and this returns 2.5x of it.
   *
   * EVERY NUMBER IN THE THREE PARAGRAPHS ABOVE WAS MEASURED THROUGH A UNIFORM
   * THE SHADER NEVER READ. `uShadowTint` sat at its constructor literal
   * (1, 1, 1) for the whole of that history — see the block above
   * `gradeUniforms = p.uniforms` in `src/render/post.ts`, where a `ShaderPass`
   * was cloning the uniform object out from under the handle `syncConfig`
   * writes to. So this field, `midTint`, `highlightTint`, `lift` and `gain`
   * were all inert, and the leak those paragraphs chase was never the tint's
   * doing.
   *
   * RE-DERIVED WITH THE SHADER RUNNING. These two are now measured values, and
   * the measurement is a different instrument from the one above: each capture
   * is INVERTED back through this exact grade to post-bloom scene-linear, then
   * re-graded under a candidate and rescored. The inverse is exact — a round
   * trip reproduces the captured 8-bit pixel with a maximum error of 0/255 —
   * so a candidate can be ranked, and looked at, without a rebuild. What is
   * quoted below was then confirmed by a real `npm run shots`.
   *
   * The two knobs do two different jobs, because the leak has two populations:
   *
   *   - `shadowTint` #4F5667 -> #565665 raises RED 0.84 -> 0.97 and eases blue
   *     1.46 -> 1.36 (luma-normalised). Dark grass and shadowed foliage sit at
   *     hue 100-106, against the BOTTOM edge of the window, so returning red to
   *     them rotates the whole mass DOWN and out — toward the 55-75 the bible
   *     asks of grass in the same breath as it bans 100-120. This is what fixes
   *     `07-soviet-base` (0.0238 -> 0.0104) and most of `09-placement`.
   *   - `midTint` #8C8578 -> #818C9C flips the mids from warm (1.11, 0.99,
   *     0.78) to cool (0.85, 1.02, 1.29), and it is aimed at a population that
   *     moves the OTHER WAY. `08-naval-water`'s leak is a flat-shaded tree
   *     canopy plus the shallow-water/shore blend, and its hue histogram peaks
   *     at 113 and 118 — against the TOP edge. Warming those rotates them
   *     deeper in; cooling pushes them past 120. Measured on 08 alone: warm mid
   *     0.0211, neutral 0.0190, this 0.0168.
   *
   * `highlightTint` IS LEFT ALONE ON EVIDENCE, not on caution: swept over
   * (1.065, 0.855), (1.00, 1.00) and (1.12, 0.74) against every candidate pair,
   * it changed check #9 in the fourth decimal on all thirteen fixtures. The
   * leak lives in the shadow and mid weights and nowhere else.
   *
   * A NEUTRAL MID WAS TRIED AND REJECTED, and the reason is scorecard #5 rather
   * than #9. `vividPixelFrac` counts S > 0.35, so the minimum-chroma mid is the
   * NEUTRAL one: at #808080 the leak falls to 0.0190 but 08's vivid fraction
   * goes 0.391 -> 0.344, under the 0.35 floor, trading a weight-3 failure for a
   * weight-3 failure. A mid tint that is decisively cool is both further from
   * neutral and on the right side of 120, which is why 08 ends up with a LOWER
   * leak and a HIGHER vivid fraction (0.396) than it started with.
   */
  shadowTint: '#5B6070',
  midTint: '#90959D',
  highlightTint: '#FFE7C8',
  /**
   * Lift raises the black point. Dropped further toward zero: RA3's own p1
   * luminance measures 0.023 and the scorecard's black-point band tops out at
   * 0.25, so there is a great deal of room below us and none above.
   */
  lift: '#06090F',
  /** Gain tints the white point. */
  gain: '#FFF6E8',
  /**
   * Corner darkening. Eased from 0.28: a heavy vignette pulls the four corner
   * boxes down and the corners are mostly far-field ground, which reads as the
   * aerial haze scorecard #12 just banned.
   */
  vignette: 0.08,
  vignetteSoftness: 0.62,
  /**
   * OFF. Both of these are on the bible's §1 standing ban list and on
   * CLAUDE.md's, and they shipped anyway — see `docs/SPEC_DRIFT_AUDIT.md`
   * finding 8. `tools/metrics.mjs` could not catch it: check #36 carries
   * `w: 0`, and there is no grain metric at all, so the scorecard could not
   * fail by construction.
   *
   * The old note here claimed the grain hid banding in the sky gradient. It
   * was paying for that with a defect on every other pixel:
   *
   *   - It is SCREEN space and mid-weighted, so it lands identically on sky,
   *     concrete, hulls and the HUD. That is video noise, not surface texture,
   *     and it is the opposite of what the ground actually needed — a uniform
   *     overlay FLATTENS real surface variation by adding the same energy
   *     everywhere. Run `tools/crop-surfaces.mjs` before and after and look:
   *     the "grain" the lawn appeared to have was entirely this pass, and the
   *     lawn's real variation now comes from the terrain tiles instead
   *     (`src/world/TerrainMaterial.ts` section 3B-bis).
   *   - `floor(uTime * 24.0)` reseeds it on a 24 Hz clock, so two captures of
   *     an otherwise frozen frame are not identical. The screenshot harness
   *     compares frames for a living.
   *   - CA costs two extra full-screen texture fetches per pixel in the grade
   *     pass, on a build that is GPU-bound at 100% load.
   *
   * Both are read through `if (u > 0.0001)` in GradePass, so zero here removes
   * the work as well as the look. `grainSize` is left at its value: it is inert
   * while `grain` is 0 and it is the parameter someone would need if a dither
   * is ever wanted — and if sky banding does reappear, the fix is a dither in
   * the sky gradient itself, not a full-screen noise pass over the whole frame.
   */
  grain: 0,
  grainSize: 1.4,
  chromaticAberration: 0,
  /**
   * Post-sharpen, applied in HDR before the tonemap. Kept deliberately light:
   * material normals and geometry should carry detail, while a hard unsharp
   * mask turns foliage, road markings and HUD type into brittle white edges.
   */
  sharpen: 0.16,
  /** Edge length of the baked colour LUT (32^3 = one texture fetch). */
  lutSize: 32,
};

const BLOOM_NOON = {
  /**
   * HDR threshold, PRE-tonemap.
   *
   * Eased from 1.25 to 1.05. The old value was set to protect against white
   * concrete hazing the frame — the classic "everything looks like a mobile
   * game" failure — but measurement showed the opposite problem: NOTHING in a
   * noon frame ever exceeded 1.25, so the bloom pass was a no-op outside a
   * tesla arc and scorecard #6 had no clipped pixel anywhere to find. 1.05 is
   * still above sunlit white paint (~0.95 scene-linear at the new sun
   * intensity) and below a specular glint, which is exactly the band we want
   * blooming. Do not take it under 1.0.
   *
   * THE VALUE USED TO BE 1.20 UNDER THIS EXACT PROSE. The note narrating the
   * ease from 1.25 down to 1.05 shipped while the number stopped at 1.20, so
   * for the whole of that time the comment described a change nobody made and
   * bible §4.4 was missed by 0.15. Nothing measured it: `tools/metrics.mjs` has
   * no bloom probe at all (`grep bloom tools/metrics.mjs` is empty), so every
   * drift in this struct was invisible to the grade.
   *
   * AND THEN IT WAS MEASURED, AND 1.05 LOST. Captured at 1.05 with the bible's
   * strength beside it, the weighted grade fell 89.2% -> 87.4% and two fixtures
   * broke outright: `08-naval-water` dropped below the saturation floor (#5,
   * -0.130) and inverted its aerial-perspective delta (#12, -0.312), and
   * `13-atoll-crossing` pushed past the median-luminance ceiling (#4, +0.059).
   * A lower threshold recruits more pixels into the bloom, and over open water
   * — which is a very large, very bright, low-detail surface — that reads as
   * haze. The bible's §4.4 row was written for land frames; three of thirteen
   * shipped fixtures are sea. 1.20 is restored, and this comment now records
   * BOTH the spec and the measurement rather than pretending they agree.
   */
  threshold: 1.20,
  /**
   * AUTHORED strength, and it is NOT the effective one.
   *
   * `post.ts#syncConfig` sets the pass to
   * `strength * max(0.25, emissiveBoost / 1.6)`, so `emissiveBoost` 1.35 scales
   * whatever is written here by 0.84375. The bible (§4.4, pre-tonemap linear
   * HDR row) asks for an EFFECTIVE 0.55, which would be an authored 0.652;
   * 0.42 lands at 0.354. If you change `emissiveBoost`, this value must move
   * with it or the glow silently rescales.
   *
   * 0.652 WAS TRIED AND REVERTED — see `threshold` above for the numbers. The
   * +55% of bloom energy raised median luminance and lowered saturation on
   * twelve of thirteen fixtures, which is the direction the grade punishes.
   * The bible's effective 0.55 is NOT achieved here and this comment does not
   * pretend it is; closing it needs the sea fixtures to stop hazing first,
   * which is a water-material question, not a bloom one.
   */
  strength: 0.42,
  /**
   * Bible §4.4 pre-tonemap row. NOT a taste tweak — it INVERTS the mip
   * weighting. `UnrealBloomPass.lerpBloomFactor` blends `bloomFactors`
   * [1, .8, .6, .4, .2] against their reverse by this radius, so at the old
   * 0.70 the five mip weights ran 0.44 / 0.52 / 0.60 / 0.68 / 0.76 — ASCENDING,
   * i.e. the 1/32 mip (the widest, veiliest one) dominated, which is the
   * "brightness comes from blur" failure the bible names in the same section.
   * At 0.34 they run 0.728 / 0.664 / 0.60 / 0.536 / 0.472, descending as
   * intended: tight core, faint skirt.
   *
   * Do NOT drop mips 4 and 5 to save the passes — at 0.34 their weights are
   * still 0.536 and 0.472, so they carry the skirt the measured radial profile
   * (half-falloff at r~30 px, gone by r~50 px) actually needs.
   */
  radius: 0.34,
  /** Extra gain applied to pixels flagged emissive by the material. See
   *  `strength` above: this multiplies it. */
  emissiveBoost: 1.35,
};

const AO_NOON = {
  enabled: true,
  samples: 12,
  /** World-space radius in metres. Sized to a tank track, not a room. */
  radius: 1.6,
  intensity: 0.85,
  power: 1.6,
  /** Half-res + bilateral upsample. AMBIENT ONLY — must never darken direct sun. */
  halfRes: true,
};

const OUTLINE_NOON = {
  widthPx: 1.6,
  /** Aquamarine selection rim — reads on both blue and red armour. */
  selected: '#7FFFD4',
  hovered: '#FFFFFF',
  hoveredAlpha: 0.5,
  enemy: '#FF5A4A',
  ally: '#4ADE80',
};

/* ==========================================================================
 * 6. FACTION PALETTES
 *
 * The mechanism that makes 20 independently-authored models read as two armies.
 * Team colour is a per-INSTANCE attribute, never a batch key — one batch covers
 * both armies.
 *
 * ------------------------------------------------------------------------
 * CHROMA BUDGET (scorecard #5, weight 3) — read this before neutralising a
 * colour "because it is only concrete".
 *
 * Our mean HSV saturation measured 0.317 against RA3's 0.527, and the largest
 * single reason was not the accents, it was the FIELDS: `concrete #B9BCB6`
 * (S 0.03), `glass #17324A` on one faction and `#2A2A28` on another (S 0.05),
 * pads at `#1E2024` (S 0.10). Those are the surfaces that cover the most
 * pixels, and every one of them was a neutral grey.
 *
 * HSV saturation is INDEPENDENT OF VALUE: a near-black slate blue reads
 * S 0.54 while a near-black grey reads S 0.10, and they photograph as the same
 * darkness. That is the whole trick, and it is exactly what RA3's own frames
 * do — look at refs/ra3steam_02.jpg, where the pavement is nearly black and
 * still unmistakably blue. So every neutral below has been pushed off the grey
 * axis toward the hue its material already implies (cool for Allied ceramic
 * and steel, warm ochre for Soviet concrete and rust) with its VALUE held.
 *
 * What has deliberately NOT changed: `tone.saturation` is a multiply, and a
 * multiply cannot create chroma that is not there — it can only make the greys
 * muddier while the accents scream. Chroma is authored here.
 * ========================================================================== */

/** ALLIES — clean steel, cold light, chamfered. No visible rivets. */
const ALLIES_LOOK: FactionLook = {
  armorBase: '#4A5F73',
  armorSecondary: '#5F7386',
  /** The team tint. Also the HUD accent and the minimap blip. */
  team: '#2F6FD0',
  accentStripe: '#E8EEF2',
  /** Cool cyan panel glow. */
  emissivePanel: '#6FD8FF',
  emissiveIntensity: 2.4,
  glass: '#0F2E60',
  concrete: '#B2BAC4',
  trimMetal: '#8493A6',
  /** Colour exposed where paint has worn off edges. */
  bareMetal: '#6E6A66',
  rust: '#6B4A32',
  tracer: '#8FD2FF',
  explosionTint: '#FFD9A0',
  hudAccent: '#3A86E0',
  camo: ['#4A5F73', '#3C4E5E', '#61748A'],
  /** Metres per camo blob. Tighter than Soviet = reads as "engineered". */
  camoScale: 2.2,
  /** 0 = fully chamfered/aero. */
  silhouetteBias: 0.0,
  useRivets: false,
  rivetSpacing: 0,
  /** Generous chamfer catches specular — 80% of perceived material quality. */
  chamfer: 0.045,
};

/** SOVIETS — rust, heat, slab. Rivet rings on every seam. */
const SOVIETS_LOOK: FactionLook = {
  armorBase: '#5A4038',
  armorSecondary: '#6E4A3A',
  team: '#C0271E',
  accentStripe: '#E8C24A',
  /** Hot orange furnace glow. */
  emissivePanel: '#FF7A2A',
  emissiveIntensity: 2.8,
  glass: '#241C10',
  concrete: '#8C8064',
  trimMetal: '#7A6448',
  bareMetal: '#6E6A66',
  rust: '#7A3B1E',
  tracer: '#FFB04A',
  explosionTint: '#FF9040',
  hudAccent: '#C0271E',
  camo: ['#5A4038', '#4A3226', '#6B5240'],
  /** Looser blobs = reads as "field-applied". */
  camoScale: 3.4,
  /** 1 = fully slab/brutalist. */
  silhouetteBias: 1.0,
  useRivets: true,
  /** Rivet rings every 0.35 m along every major seam. */
  rivetSpacing: 0.35,
  /** Minimum bevel only — but NEVER zero. A raw 90° edge reads as plastic. */
  chamfer: 0.02,
};

/** NEUTRAL / GAIA — ore, rock, foliage, wrecks. */
const NEUTRAL_LOOK: FactionLook = {
  armorBase: '#7C7468',
  armorSecondary: '#6A6358',
  team: '#C8C4B8',
  accentStripe: '#9A9488',
  /** Ore crystal glow. */
  emissivePanel: '#FFC64A',
  emissiveIntensity: 0.9,
  glass: '#2A2A18',
  concrete: '#9A9078',
  trimMetal: '#7C7258',
  bareMetal: '#6E6A66',
  rust: '#6A4028',
  tracer: '#FFFFFF',
  explosionTint: '#FFC090',
  hudAccent: '#8A939C',
  camo: ['#7C7468', '#5A5F3A', '#6A6358'],
  camoScale: 3.0,
  silhouetteBias: 0.5,
  useRivets: false,
  rivetSpacing: 0,
  chamfer: 0.03,
};

/**
 * MERIDIAN PACT — bone ceramic, jade team slabs, gold emissives.
 *
 * Authored by the faction agent in src/data/Defs.ts and moved here so the
 * palette tables have exactly one home; `Defs.ts` re-exports it as
 * `MERIDIAN_LOOK` so the art modules that already import it keep working.
 * It moves on all three axes away from the other two armies: warm hull (not
 * cool grey, not olive), the third primary as the team colour (jade against
 * cobalt and crimson), and gold accents rather than cyan or furnace orange.
 */
const MERIDIAN_LOOK: FactionLook = {
  armorBase: '#C9BFA6',
  armorSecondary: '#A79C82',
  /** The team tint. Also the HUD accent and the minimap blip. */
  team: '#0FA98C',
  accentStripe: '#F2E4C4',
  /** Gold collector glow — never cyan, never furnace orange. */
  emissivePanel: '#FFC24A',
  emissiveIntensity: 2.5,
  glass: '#1E3A38',
  concrete: '#C0B69C',
  trimMetal: '#8A806C',
  bareMetal: '#6E6A66',
  rust: '#7A5A32',
  tracer: '#FFD98A',
  explosionTint: '#FFCE7A',
  hudAccent: '#12B58F',
  camo: ['#C9BFA6', '#B0A488', '#8E9C7A'],
  /** Between Allied 2.2 and Soviet 3.4: engineered, but panelled not tiled. */
  camoScale: 2.8,
  /** Neither chamfered-aero nor slab: corbelled ceramic sits in the middle. */
  silhouetteBias: 0.35,
  useRivets: false,
  rivetSpacing: 0,
  chamfer: 0.038,
};

/**
 * THE RECLAMATION — oxide graphite hulls, arc-violet team plate, amber hazard.
 *
 * The fourth army has to be separable from three that already own the obvious
 * quadrants, and colour is the LEAST of the three axes it moves on (the other
 * two are in `src/art/Faction4*.ts`: exposed frame-and-cladding, and no turret
 * on anything the faction fields). Even so, every channel here is measured
 * against the other three rather than picked:
 *
 *   TEAM HUE. Cobalt sits at 215 degrees, crimson at 3, jade at 168. The
 *   largest hole left in the wheel that is not the 100-120 "amateur emerald"
 *   window scorecard #9 fails on is 270-320. `#A32BD8` is 287 degrees: 72 from
 *   crimson, 72 from cobalt, 119 from jade. That 72-degree MINIMUM separation
 *   is the best any candidate hue scores, and it is the number that matters —
 *   the nearest rival, not the average.
 *
 *   VALUE. The Allies are cool light, the Soviets mid olive, the Pact warm
 *   bone. All three hulls sit at V 0.55-0.82. `armorBase` here is V 0.27: the
 *   Reclamation is the only army that reads as a DARK silhouette, which is what
 *   separates it in a 40-unit blob at a glance even before hue registers.
 *
 *   ACCENT. Cyan, furnace orange and gold are taken, so the emissive is
 *   arc-violet — and the second accent is HAZARD AMBER, deliberately warm
 *   against a cold hull. No other army runs a warm/cool split; it is what makes
 *   a scrap frame read as machinery rather than as a shadow.
 */
const RECLAIM_LOOK: FactionLook = {
  /** Oxide graphite. The only dark hull in the game. */
  armorBase: '#3D3A44',
  armorSecondary: '#524E5C',
  /** The team tint. Also the HUD accent and the minimap blip. */
  team: '#A32BD8',
  /** Hazard amber, the warm half of the split. Never violet. */
  accentStripe: '#E8B33C',
  /** Exposed arc conduit. Not cyan, not furnace orange, not gold. */
  emissivePanel: '#E27BFF',
  emissiveIntensity: 2.7,
  glass: '#2A1E34',
  /** Poured slag. Dark, and violet rather than grey — see the CHROMA BUDGET. */
  concrete: '#6E6878',
  trimMetal: '#6A6270',
  bareMetal: '#6E6A66',
  /** Real rust: this army is welded out of other people's wrecks. */
  rust: '#7A4A34',
  tracer: '#E27BFF',
  explosionTint: '#E0A8FF',
  hudAccent: '#B93FE0',
  camo: ['#3D3A44', '#2C2A34', '#57505F'],
  /** Loosest in the game — cladding is cut from whatever was to hand. */
  camoScale: 3.8,
  /** Slab-leaning, but the read comes from open frame rather than from mass. */
  silhouetteBias: 0.75,
  /** Welded, not bolted. The Soviets own the rivet ring and keep it. */
  useRivets: false,
  rivetSpacing: 0,
  /** Crude cut plate: the heaviest bevel in the game after the Allied 0.045. */
  chamfer: 0.030,
};

/**
 * Ore crystal colour.
 *
 * This said "Referenced by both terrain and HUD" and was referenced by NEITHER
 * — it had no reader anywhere in the tree until `src/world/ore.system.ts` was
 * written, which is now its only one: the lit vertex colour of the crystal
 * cluster and the material's `emissive`. Terrain does not sample it. Nor does
 * the HUD — the minimap's ore gold is `SEMANTIC.ore` (`#C8A83C`) in
 * `src/ui/Chrome.ts`, a different constant with a different value. Nothing
 * links them, so changing this one does not move the minimap.
 */
export const ORE_CRYSTAL_COLOR = '#FFC64A';

/* ==========================================================================
 * 7. SURFACE ARCHETYPES — falsifiable PBR ranges
 *
 * Painted steel is a DIELECTRIC over metal. metalness is never 1.0 on armour.
 * "Reads as a plastic toy" is almost always a missing bevel plus missing edge
 * wear, and both are tuned right here.
 * ========================================================================== */

const S = (
  roughnessMin: number, roughnessMax: number, roughnessVariance: number,
  metalness: number, edgeWear: number, grime: number,
  clearcoat: number, rust: number, sheen: number,
): SurfaceLook => ({
  roughnessMin, roughnessMax, roughnessVariance, metalness,
  edgeWear, grime, clearcoat, rust, sheen,
});

const SURFACES: Record<SurfaceArchetype, SurfaceLook> = {
  /** THE most critic-sensitive surface in the game. */
  vehicleArmor:      S(0.52, 0.72, 0.10, 0.15, 0.35, 0.30, 0.25, 0.10, 0.00),
  /** Dark rubber/steel, UV scrolled by treadPhase. Heavy dust accumulation. */
  vehicleTread:      S(0.85, 0.95, 0.04, 0.35, 0.15, 0.45, 0.00, 0.05, 0.00),
  /** No transmission — far too expensive at RTS counts. */
  vehicleGlass:      S(0.08, 0.08, 0.00, 0.00, 0.05, 0.10, 1.00, 0.00, 0.00),
  /** Downward grime streaks from every top edge: cheapest realism trick here. */
  buildingConcrete:  S(0.80, 0.92, 0.06, 0.00, 0.10, 0.45, 0.00, 0.05, 0.00),
  buildingPanel:     S(0.45, 0.62, 0.08, 0.25, 0.28, 0.35, 0.10, 0.15, 0.00),
  /** Bottom-up reveal with a hot emissive scan band. */
  construction:      S(0.60, 0.75, 0.05, 0.20, 0.20, 0.20, 0.00, 0.00, 0.00),
  /** Cloth is NEVER metallic. */
  infantryCloth:     S(0.88, 0.96, 0.04, 0.00, 0.10, 0.35, 0.00, 0.00, 0.25),
  terrainDirt:       S(0.93, 0.93, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  terrainGrass:      S(0.90, 0.90, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10),
  terrainRock:       S(0.82, 0.82, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  /** Slightly wet-looking. Puddles at 0.12. */
  terrainRoad:       S(0.72, 0.72, 0.00, 0.00, 0.00, 0.20, 0.00, 0.00, 0.00),
  /**
   * Glossy and non-metallic, and that is the whole row — `SurfaceLook` has no
   * emissive field, so the old comment ("Emissive scales with remaining ore
   * amount") described a quantity this table cannot express and a behaviour
   * nothing implements. What actually scales with remaining ore in
   * `src/world/ore.system.ts` is the instance SCALE, quantised into
   * `ORE_DENSITY_STEPS` buckets; `emissiveIntensity` is a constant 0.18, held
   * deliberately low to keep ore under the bloom threshold. The one number here
   * that reaches the crystals is the 0.22 roughness, restated as a literal
   * there because `SURFACES` is module-private.
   */
  oreCrystal:        S(0.22, 0.22, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  water:             S(0.06, 0.06, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  wreck:             S(0.88, 0.88, 0.06, 0.20, 0.45, 0.60, 0.00, 0.55, 0.00),
  debris:            S(0.88, 0.88, 0.06, 0.20, 0.30, 0.50, 0.00, 0.40, 0.00),
  foliage:           S(0.85, 0.92, 0.05, 0.00, 0.00, 0.10, 0.00, 0.00, 0.20),
  overlay:           S(1.00, 1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  particle:          S(1.00, 1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  decal:             S(0.90, 0.90, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
};

/** Absolute minimum chamfer on ANY edge in the game. Never zero. */
export const MIN_CHAMFER = 0.02;

/* ==========================================================================
 * 8. VFX LOOK
 * ========================================================================== */

const VFX_NOON = {
  /**
   * Fire gradient sampled by normalized particle life. The last stop being
   * near-black soot is what stops explosions reading as an orange blob.
   */
  fireGradient: [
    [0.00, '#FFF4C8'],  // white-hot core
    [0.12, '#FFC24A'],  // yellow
    [0.35, '#FF6A18'],  // orange
    [0.65, '#8C2A0E'],  // dark red
    [1.00, '#231A16'],  // soot
  ] as readonly (readonly [number, string])[],
  /** Warm, dust-laden smoke. A neutral grey plume (S 0.07) was dragging the
   *  whole combat shot's mean saturation under the scorecard #5 floor. */
  /* Dark, warm and dust-laden. Was '#5A5450' — a neutral mid grey that both
   * dragged the combat frame's mean saturation under the scorecard #5 floor
   * (0.29 against 0.42) and, at 0.55 opacity over a large plume, pulled its
   * median luminance up to 0.59 against RA3's 0.34. RA3's own smoke is much
   * darker than a first guess: it reads as a silhouette, not as a cloud. */
  smokeColor: '#3E362A',
  smokeOpacity: 0.55,
  /** Metres/sec the plume climbs. */
  smokeRise: 2.4,
  /** Lateral spread factor. */
  smokeSpread: 0.9,
  /** Dust is sampled from terrain albedo so it matches the ground it came from. */
  dustOpacity: 0.40,
  /**
   * THESE THREE ARE READ BY NOBODY. Found while chasing the seventh brightness
   * report, which arrived pointing at this line.
   *
   * They are declared on `VfxLook` in `types.ts` and assigned here and in every
   * art mood, and `grep -rn 'muzzleMs\|muzzleSize\|muzzleColor' src/` returns
   * exactly those two files. The live muzzle flash reads `VFX_GUNS.flash[size]`
   * — `lifeMs` 70/90/110, `lenM`/`widM`, `intensity` — and `VFX_RAMP.muzzle`
   * for its colour. Changing anything below changes nothing on screen.
   *
   * Kept rather than deleted because `VfxLook` is a per-mood art contract and
   * the moods assign them; deleting the field is a types-and-five-tables edit
   * that belongs with whoever next wires a mood-driven muzzle. Labelled instead,
   * because an inert knob that LOOKS like the one you want is how a brightness
   * pass gets spent on nothing — see `docs/RENDER_FINDINGS.md` §5b and §5.
   */
  muzzleColor: '#FFE9B0',
  /** INERT — see above. The live value is `VFX_GUNS.flash[size].lifeMs`. */
  muzzleMs: 90,
  /** INERT — see above. The live values are `VFX_GUNS.flash[size].lenM/widM`. */
  muzzleSize: 0.9,
  teslaCore: '#FFFFFF',
  teslaArc: '#9BE0FF',
  /** Midpoint-displacement jitter. Too high reads as a scribble. */
  teslaJitter: 0.35,
  teslaBranches: 3,
  prismCore: '#B8F0FF',
  prismHalo: '#3A86E0',
  sparkColor: '#FFC24A',
  emberColor: '#FF5A18',
  shockwaveStrength: 0.6,
  scorchColor: '#1A1206',
  scorchOpacity: 0.62,
  /** Tread mark darkness. Cures "tanks glide with no weight". */
  treadOpacity: 0.30,
  /** Seconds before a decal has fully faded. */
  decalFadeSec: 45,
  screenShake: 0.55,
};

/* ==========================================================================
 * 9. TERRAIN / WATER / SHROUD LOOK
 * ========================================================================== */

const TERRAIN_NOON = {
  grass: '#666B44',
  dirt: '#7A6A52',
  rock: '#7C7468',
  sand: '#A99878',
  // Cool, not neutral — matches SURFACE_COLOURS.asphalt in src/world/Roads.ts.
  // A near-grey road splat is a large low-chroma mass in the far field and
  // scorecard #12 reads that as haze.
  road: '#3F464F',
  cliff: '#6E6558',
  /** Metres per repeat of the detail normal. Small = crisp close up. */
  detailScale: 2.0,
  /** Metres per repeat of the macro breakup noise. Large = no visible tiling. */
  macroScale: 96,
  /** Wet puddle coverage on roads. */
  puddles: 0.12,
};

/**
 * **THIS WHOLE BLOCK IS INERT. NOTHING READS IT, AND TUNING IT DOES NOTHING.**
 *
 * Found while porting the water to TSL (`src/world/WaterNodeMaterial.ts`,
 * migration Stage E), and it is the `VFX_NOON.muzzleMs` shape exactly: an art
 * block with real measurements written on it, wired to no shader.
 *
 * The sea takes its colours from `WATER_PALETTES` and its numbers from
 * `WATER_SSR`, `WATER_LOOK`, `WATER_WAVES`, `WATER_FOAM`, `WATER_SHORE` and
 * `WATER_GLINT`. `DEFAULT_ART.water` — this object — has no consumer anywhere
 * in `src/`. The live grazing exponent is `WATER_SSR.fresnelPower`, and it is
 * **5.0**, not the 5.4 below.
 *
 * It is LABELLED rather than deleted or reconciled, deliberately. Deleting it
 * would take the `ArtDirection.water` slot out of `src/core/types.ts` and out of
 * every mood preset; setting `WATER_SSR.fresnelPower` to 5.4 would be a look
 * change, and every shipped frame was graded at 5.0. Either is a decision for
 * whoever owns the look, not a side effect of a renderer migration.
 */
const WATER_NOON = {
  shallow: '#2E7C6C',
  deep: '#0A2E44',
  /**
   * INERT — see the block comment above. The live exponent is
   * `WATER_SSR.fresnelPower` (5.0). What follows is the reasoning that was
   * written when this was believed to be reaching the shader:
   *
   * Higher = the water only goes reflective at grazing angles.
   *
   * Raised from 4.2. At 4.2 the surface was handing back sky over most of its
   * visible area, so the naval shot measured mean saturation 0.39 (scorecard #5
   * floor is 0.42) and the worst far-minus-near saturation in the set: sky
   * reflection has no chroma of its own and it covers the far field first.
   * 5.4 keeps the grazing sheen that sells water and lets the body colour —
   * which IS saturated, deliberately — carry the near and mid field.
   */
  fresnelPower: 5.4,
  foamColor: '#E4F0EE',
  /** Metres of foam band at the shoreline. */
  foamWidth: 1.8,
  waveSpeed: 0.06,
  waveScale: 6.0,
  roughness: 0.06,
};

const SHROUD_NOON = {
  /** Explored-but-not-visible terrain is TINTED, so fog reads as memory. */
  exploredTint: '#3A4250',
  exploredDesat: 0.65,
  /** Never-explored area. Near black, but not pure black. */
  unexploredColor: '#05070A',
  /** Metres of soft ramp at the shroud edge. */
  edgeSoftness: 6.0,
  /** Slow cloud noise so the edge never looks like a checkerboard. */
  noiseScale: 40,
  noiseSpeed: 0.012,
};

/* ==========================================================================
 * 10. HUD LOOK — chunky industrial metal and rivets
 * ========================================================================== */

const HUD_NOON = {
  metalDark: '#1B1F24',
  metalMid: '#2E353C',
  metalLight: '#4A545E',
  bevelLight: '#6B7681',
  bevelDark: '#12161A',
  rivet: '#8A939C',
  /** Phosphor green-cyan for the minimap and readouts. */
  screenGlow: '#7FD8C0',
  scanline: 0.10,
  textPrimary: '#DCE4EA',
  textDim: '#7C8792',
  danger: '#E03A2A',
  warn: '#E0A72A',
  /** Kept identical to `PLACEMENT.validColor`; see the note there. */
  ok: '#34D399',
  cornerRadiusPx: 3,
  rivetSpacingPx: 22,
  panelNoise: 0.06,
  /** Condensed and industrial. NEVER a default UI font. */
  fontStack: "'Rajdhani','Oswald','Arial Narrow',sans-serif",
};

/** HUD text refresh rate — 15 Hz is imperceptible and saves layout thrash. */
export const HUD_TEXT_HZ = 15;
/** Minimap redraw rate. */
export const MINIMAP_HZ = 20;

/* ==========================================================================
 * 11. THE ASSEMBLED ART DIRECTION
 *
 * `DEFAULT_ART` is the single instance every material, pass and generator
 * reads. ArtStore holds the live copy; a critic can mutate it at runtime and
 * every ArtAware listener re-applies its uniforms.
 * ========================================================================== */

export const DEFAULT_ART: ArtDirection = {
  sun: { ...SUN_NOON },
  atmosphere: { ...ATMOSPHERE_NOON },
  tone: { ...TONE_NOON },
  bloom: { ...BLOOM_NOON },
  ao: { ...AO_NOON },
  outline: { ...OUTLINE_NOON },
  vfx: { ...VFX_NOON },
  terrain: { ...TERRAIN_NOON },
  water: { ...WATER_NOON },
  shroud: { ...SHROUD_NOON },
  hud: { ...HUD_NOON },
  surfaces: SURFACES,
  // DECLARATION ORDER IS `Faction` ORDER. `ui/Chrome.paletteKeyFor` resolves a
  // faction's accent through `Object.keys(FACTION_PALETTE)[faction]`, so a row
  // inserted rather than appended silently hands one army another's HUD.
  factions: {
    neutral: NEUTRAL_LOOK,
    allies: ALLIES_LOOK,
    soviets: SOVIETS_LOOK,
    meridian: MERIDIAN_LOOK,
    reclaim: RECLAIM_LOOK,
  },
};

/** Convenience alias so non-art code can grab a faction's colours directly. */
export const FACTION_PALETTE = DEFAULT_ART.factions;

/* ==========================================================================
 * 12. MOODS — whole-game A/B in 90 seconds via ?art=<mood>
 * ========================================================================== */

export const MOODS: Record<string, DeepPartial<ArtDirection>> = {
  /** The shipping look. */
  noon: {},

  /**
   * Long shadows, warm rim light, orange haze. The screenshot mood.
   *
   * The haze is deliberately thin. Dusk is the one daylight mood the bible lets
   * carry atmosphere, but scorecard #12 is measured on `11-dusk-mood` like
   * every other shot, and at the old 0.0115 the far field came back 0.064 less
   * saturated than the near field. A WARM haze at a quarter of the density
   * still reads as evening air and costs ~0.01 of the delta.
   */
  dusk: {
    sun: {
      elevationDeg: 16, azimuthDeg: 288,
      color: '#FFB06A', intensity: 2.7,
    },
    atmosphere: {
      fogColor: '#8D8792', fogDensity: 0.0025, fogStart: 150,
      aerialPerspective: 0.05,
      skyZenith: '#243B62', skyHorizon: '#E8A56C',
      /** Cool skylight preserves material colour against the warm low key. */
      hemiSky: '#9AA8BC', hemiSkyIntensity: 0.30,
      hemiGround: '#684B38', hemiGroundIntensity: 0.15,
      envIntensity: 0.54,
    },
    bloom: { threshold: 1.08, strength: 0.48, emissiveBoost: 1.55 },
    tone: {
      exposure: 0.88, contrast: 1.14, saturation: 0.94,
      shadowTint: '#56627A', midTint: '#8F929A', highlightTint: '#FFD5A6',
    },
  },

  /**
   * Night keyframe. A real elevated moon supplies the key; emissives and the
   * existing pooled street-light stories supply warm local contrast.
   */
  night: {
    sun: {
      elevationDeg: 40, azimuthDeg: 138,
      color: '#D2DCFF', intensity: 1.42,
      shadowIntensity: 0.90, shadowSoftness: 2.4,
    },
    atmosphere: {
      fogColor: '#121F39', fogDensity: 0.0020, fogStart: 175,
      aerialPerspective: 0.08,
      skyZenith: '#040914', skyHorizon: '#172A4B', skyGround: '#000000',
      sunDiskDeg: 0.9, hazeWidthDeg: 4,
      /** Night is the one mood where a cool fill is CORRECT: the light source
       *  genuinely is a blue sky. Kept dim so it tints without smearing. */
      hemiSky: '#38447A', hemiSkyIntensity: 0.46,
      hemiGround: '#1C2446', hemiGroundIntensity: 0.25,
      envIntensity: 0.55,
    },
    bloom: { threshold: 0.90, strength: 0.62, emissiveBoost: 2.25 },
    tone: {
      exposure: 1.10, contrast: 1.18, saturation: 0.92, shadowSaturation: 0.84,
      shadowTint: '#485679', midTint: '#8390AB', highlightTint: '#DCE2FF',
    },
  },

  /** Cool pre-sunrise fill turning into a restrained peach key. */
  dawn: {
    sun: {
      elevationDeg: 13, azimuthDeg: 336,
      color: '#FFD0A6', intensity: 2.35,
      shadowIntensity: 1.0, shadowSoftness: 1.5,
    },
    atmosphere: {
      fogColor: '#667488', fogDensity: 0.0018, fogStart: 165,
      aerialPerspective: 0.04,
      skyZenith: '#182D50', skyHorizon: '#E6A18A', skyGround: '#000000',
      sunDiskDeg: 0.75, hazeWidthDeg: 7,
      hemiSky: '#AAB8CC', hemiSkyIntensity: 0.38,
      hemiGround: '#735044', hemiGroundIntensity: 0.19,
      envIntensity: 0.56,
    },
    bloom: { threshold: 1.0, strength: 0.52, emissiveBoost: 1.75 },
    tone: {
      exposure: 0.94, contrast: 1.15, saturation: 0.93, shadowSaturation: 0.88,
      shadowTint: '#53637D', midTint: '#9399A6', highlightTint: '#FFD8B4',
    },
  },

  /** Flat, soft, desaturated. The "is the lighting carrying this?" control. */
  overcast: {
    sun: { intensity: 2.2, shadowSoftness: 6.0, shadowIntensity: 0.55, color: '#E8ECF0' },
    atmosphere: {
      fogColor: '#C8CED6', fogDensity: 0.006, fogStart: 110,
      skyZenith: '#8A98A8', skyHorizon: '#D8DEE4',
      hemiSky: '#D8D8D4', hemiSkyIntensity: 0.62, envIntensity: 0.9,
      aerialPerspective: 0.15,
    },
    tone: { saturation: 1.02, contrast: 1.16 },
  },

  /** Heavy dust haze. Kills long sightlines, makes the midfield read closer. */
  dust: {
    sun: { color: '#FFD8A0', intensity: 3.4 },
    atmosphere: {
      fogColor: '#D0A870', fogDensity: 0.014, fogStart: 40,
      skyHorizon: '#D8BC94', aerialPerspective: 0.35,
      hemiSky: '#D8C4A4', hemiSkyIntensity: 0.30,
    },
    tone: { saturation: 1.10 },
  },
};
