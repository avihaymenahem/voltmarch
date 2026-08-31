/**
 * Domain-owned config slice: particles, beams, explosions and scene-light injection.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 22. VFX — PARTICLES, BEAMS, EXPLOSIONS, SCENE-LIGHT INJECTION
 *
 * Transcribed from RA3_LOOK_BIBLE §8 and §14 R6. Two conventions run through
 * the whole block and are worth stating once:
 *
 *  - TL = 1 tank length = 7 m. Sizes the bible quotes in TL are stored in
 *    METRES here, already multiplied out, so no consumer has to remember.
 *  - PIXEL figures are quoted at 2560x1440 and are stored UNSCALED. The beam
 *    shader converts them with `2*tan(fov/2)/1440 * viewDepth`, which is
 *    independent of the actual render height — so a "3 px core" is exactly
 *    3 px when the critic screenshots at 1440p, and holds its apparent size
 *    at any other resolution instead of shrinking.
 * ========================================================================== */

/** Reference frame height every px figure in this section is quoted at. */
export const VFX_PX_REFERENCE_HEIGHT = 1440;

/* ---- pools -------------------------------------------------------------- */

/**
 * PointLights permanently resident in the scene (bible §8.9 wants 8–12).
 * They are added ONCE at boot and animated to intensity 0 when idle: adding or
 * removing a light changes `numPointLights` and recompiles every shader in the
 * scene, which is a 200 ms hitch in the middle of a firefight.
 */
export const VFX_LIGHT_POOL = 12;

/**
 * PointLight falloff exponent. Physically correct is 2.0, but RA3's measured
 * wash is far wider than inverse-square — pavement 300 px from a beam still
 * reads `#4560A3`. 1.35 reproduces that reach without a 10x intensity that
 * would blow the core out. Scorecard #28 is scored against this number.
 */
export const VFX_LIGHT_DECAY = 1.28;

/**
 * Global multiplier on every VFX light. **Measured, not guessed, and it is the
 * one number to retune when the grade lands.**
 *
 * Driven at the bible's authored candela this renderer injects NO wash at all:
 * a bare `THREE.PointLight(0xffb05a, 28, 49, 1.28)` four metres above a blast
 * moves the surrounding ground by a MEDIAN OF ZERO luminance units. Two
 * measured sweeps at 1052x595 on a real GPU decided this number.
 *
 * (a) Scorecard #28 — median dL over the 100-200 px (1440p-equivalent) annulus
 *     around ONE 2.2 TL explosion, and (b) the whole-frame mean luminance with
 *     TWO explosions up at once, against a base frame mean of 84.8:
 *
 *       scale    #28 dL      2-blast frame mean    clipped px
 *        x3       37.0            110.2               0%
 *        x4       40.0            116.0               0%
 *        x5   ->  ~40             ~118                0%
 *        x8       41.7            129.5               0%
 *        x12      45.5            148.4               0.01%
 *        x24      64.6            185.1               1.50%   <- whiteout
 *
 * x24 passes #28 with the most margin and is WRONG: two explosions more than
 * double the frame mean and the image goes to white paste, which is bible §14
 * R5 ("someone fixed the darkness") arriving from the other direction. x5
 * clears the >=35 L bar with room and keeps a two-blast frame at +39%, which
 * reads as a violent flash instead of a blown exposure.
 *
 * The response is this non-linear because AgX at exposure 1.05 compresses the
 * highlights hard, and the frame currently sits ~1.5-2x above the bible's
 * median-0.317 target (independently reported by the terrain module). Fix the
 * grade to ACES @ 0.92 and re-derive this against the SAME two measurements
 * rather than by eye — the light will do more work on a darker frame, so this
 * number should come down, not up.
 *
 * The shared scale is intentionally conservative because the grade now
 * preserves more highlight contrast. Per-source ratios still carry hierarchy.
 */
export const VFX_LIGHT_INTENSITY_SCALE = 3.2;

/**
 * Bible §8.9, verbatim except where noted. `range` in metres (the bible's
 * TL x 7).
 *
 * THE EXPLOSION ROW IS THE ONE DEVIATION, and it is deliberate. The bible's
 * 28 cd / 49 m, through `VFX_LIGHT_INTENSITY_SCALE`, is 140 effective candela
 * reaching 49 metres — and the combat fixture frames about 60 metres of ground,
 * so a single tank death relit the ENTIRE visible world. Measured against an
 * identical explosion-free frame, one 2.2 TL death lifted the median of every
 * pixel it did not set on fire by +11.5 L and pushed 58% of the frame over a
 * +12 L threshold. That wash is the effect doing its job (scorecard #28 exists
 * precisely so effects light the world) but its REACH was the whole shot, which
 * is the "the flash blocks the screen" complaint arriving by a second route.
 *
 * 20 cd / 40 m keeps the near-field wash the scorecard measures — that annulus
 * is 3-6 m from the blast, where the falloff has barely started — and pulls the
 * far field in so the corners of the frame stop flaring. Re-measure both
 * numbers together if this is ever retuned; peak alone will not do it.
 */
/**
 * How far a ONE-SHOT light's claim may be merged into an existing light of the
 * same kind, and how much brighter the merged result may get. See
 * `LightPool.spawn`.
 *
 * THE MEASUREMENT. `claimSlot` took the first free slot with no notion of
 * locality, so twelve muzzle flashes inside a squad's footprint became twelve
 * resident PointLights at the same place and three's light loop SUMMED them.
 * Measured at n=20 co-located unit deaths (`tools/flash-stack.mjs`), the light
 * pile on its own took the frame area over L=0.95 from 12.4% to 62.6% — x3.0 —
 * on top of what the additive quads were doing. It is bounded only by the pool
 * size, which is not a brightness policy, it is an accident.
 *
 * Merging rather than dropping is what makes this "one bright flash" instead of
 * "the 13th flash does not light anything": the incumbent is brightened towards
 * a ceiling and its envelope refreshed, so a squad's ground wash is ONE wash
 * that stays lit while they fire.
 *
 * It also frees slots, which the GPU pass measured at 2.57 ms per resident light
 * per frame at 1440p — so fewer, merged lights is the same direction as
 * `VFX_LIGHT_POOL_BY_TIER`, not a trade against it.
 */
export const VFX_LIGHT_MERGE_CEIL = 1.9;

export const VFX_LIGHTS = {
  // 20 -> 5. Removing this row entirely was the only intervention in the whole
  // flash-stack sweep that measurably reduced blown area (23.957% -> 20.361% of
  // frame over 0.95 at n=20), which contradicts the claim below that ~100
  // effective candela sits under the AgX knee and injects no visible wash.
  explosion:   { color: '#FFB05A', peak: 5, range: 40.0, riseMs:  40, holdMs:  60, fallMs: 400, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 7.0 },
  // Cut with the rest of the table so the ordering invariant at
  // tests/vfx.spec.ts:1190 (explosion must out-light muzzle) still holds.
  muzzle:      { color: '#FFD28A', peak: 2.0, range: 12.0, riseMs:  10, holdMs:  10, fallMs:  70, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 7.0 },
  // peak 3.5 -> 1.4, range 24.5 -> 13. The impact's own light was measured at
  // 1.09pp of the 1.78pp the whole starburst contributes at four hits — the
  // largest single piece of it. Same reasoning as `teslaArc`: peak is how
  // bright the wash is, RANGE is how big it is, and the complaint is about size.
  teslaImpact: { color: '#5A82FF', peak: 1.4, range: 13.0, riseMs:  30, holdMs:  40, fallMs: 130, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 5.0 },
  beam:        { color: '#6FA8FF', peak:  9, range: 42.0, riseMs:  60, holdMs:   0, fallMs: 180, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 0 },
  /**
   * The sustained light a TESLA ARC carries while it is up.
   *
   * The bible's table has no row for this: "beam midpoint 9" describes a
   * continuous prism/laser beam and "tesla impact 14" describes the hit, but a
   * live arc is a third thing and is the brightest object in any RA3 frame
   * containing one. It is set in the EXPLOSION's energy class, not the beam's,
   * for two reasons: an arc is on screen for a second rather than 100 ms, and
   * measured on this renderer everything below ~500 effective candela sits
   * under the AgX knee and injects no visible wash at all (peak 12 measured a
   * median dL of +0.8 over the scorecard's annulus; 26 measures +30 and change).
   * `prism` is raised for the same reason and by the same measurement.
   *
   * The small flicker is the arc re-rolling its own path every 50 ms, carried
   * into the light so the ground wash crackles with it instead of sitting flat.
   */
  /*
   * PEAK 26 -> 6.5 AND RANGE 46 -> 30, 2026-08-06, on a user screenshot.
   *
   * This row was the whiteout, and every earlier pass missed it because they
   * were all looking at the explosion FLASH. The screenshot settled it in one
   * look: the glare is BLUE (#6FA8FF) with a soft radial falloff over roughly
   * 40% of the frame. `VFX_LIGHTS.explosion` is orange #FFB05A, and a sprite
   * disc has a hard edge — so it was neither.
   *
   * At peak 26 with a 46 m range against the 48 m framed view, ONE arc lit the
   * entire visible battlefield, and the comment above says it is sustained for
   * about a second rather than 100 ms. The note admitting "26 measures +30 and
   * change" was recording the defect, not justifying it.
   *
   * `tools/flash-stack.mjs` never caught this because it only ever calls
   * `V.explode()` — it has no tesla or prism case at all, so the brightest row
   * in this table has never been measured by the instrument built to police it.
   */
  /*
   * RANGE 30 -> 17, sixth report. Every previous pass cut PEAK (26 -> 6.5) and
   * left range alone, which is backwards for a complaint whose actual words are
   * "still tooooo huge". Peak is how bright the wash is; RANGE IS HOW BIG IT
   * IS, and 30 m against the 48 m framed view is a soft blue disc covering most
   * of the screen no matter how gently it starts.
   *
   * `mergeRadius: 0` is also load-bearing here and stays: arcs do NOT merge, so
   * four coils firing put four full washes on the frame. The stacking half of
   * that is now answered by charging them to `VFX_GLARE` (see Beams.ts), which
   * the light pool does not participate in.
   */
  // peak 6.5 -> 2.6 and range 17 -> 11, third report. The ribbons came down
  // twice and the LIGHT is now the larger half of what is left: measured at
  // 1.06pp of the arc's 4.50pp blue delta at four arcs, against 2.98pp for the
  // ribbons that have since been cut again.
  teslaArc:    { color: '#6FA8FF', peak: 2.6, range: 11.0, riseMs:  50, holdMs:   0, fallMs: 200, flickerHz: 13, flickerAmp: 0.16, mergeRadius: 0 },
  /**
   * `mergeRadius` 9 is wider than the others on purpose: burning wrecks are a
   * CLUSTER by nature — a destroyed formation is six hulls inside ten metres,
   * each re-claiming a light every ~650 ms — and this row is the one that pins
   * the whole pool if it is left alone. One flickering ember wash over the
   * wreckage is also what the reference frames show.
   */
  burning:     { color: '#FF7A28', peak:  4, range: 17.5, riseMs: 200, holdMs:   0, fallMs: 600, flickerHz: 7,  flickerAmp: 0.30, mergeRadius: 9.0 },
  // Cut with teslaArc and for the same reason — 22/42 is the same blue wash one
  // notch down, and the comment above says prism "is raised for the same reason
  // and by the same measurement", so it inherits the same correction.
  // Cut with teslaArc and by the same measurement. The report named the Tesla
  // Coil, but the Refractor Tower measured WORSE than it (+4.13pp against +3.40pp
  // blue at four) once the arc had been cut twice, and shipping the Allied
  // equivalent brighter than the Soviet one the player complained about would
  // just be the next report.
  prism:       { color: '#A7F5F9', peak: 2.4, range: 11.0, riseMs:  60, holdMs:   0, fallMs: 180, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 0 },
  impact:      { color: '#FFE0A0', peak: 3.5, range: 8.5, riseMs:  10, holdMs:  10, fallMs:  90, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 4.0 },
} as const;

/**
 * THE GLARE BUDGET — how much ADDITIVE light one patch of ground may emit at
 * once. Consumed by `src/vfx/FlashBudget.ts`; read its header for the
 * measurement and the arithmetic.
 *
 * WHY IT IS HERE AND NOT A DIMMER ON A SPRITE. Explosion and muzzle-flash
 * brightness has been reported four times. Every previous pass lowered a single
 * sprite's gain — `flashIntensity` 7.0 -> 3.5, `billowIntensity` 4.2 -> 2.1, the
 * muzzle core 9.0 -> 4.0 — and every one of those measured correctly, because
 * each was measured on ONE effect. The additive layer SUMS and nothing bounded
 * the sum: measured at 1280x720 on the 48 m combat framing, 20 unit deaths
 * inside a 4 m radius put 65.9% of the frame over L=0.95 against 14.5% for one,
 * and ablation attributes x8.9 of that growth to the additive quads and x3.0 to
 * the point-light pile.
 *
 * The first effect in a locality is charged nothing and therefore attenuated
 * not at all, so a single explosion is unchanged. Only the crowd pays.
 *
 * ==========================================================================
 * SEVENTH REPORT — "flashes become huge again with 100% brightness, cant see
 * nothing in fight". THERE IS NO REGRESSION AND THIS WAS NEVER FIXED.
 * ==========================================================================
 *
 * Every constant in this block, in `VFX_LIGHTS`, and in `VFX_EXPLOSION` is
 * BYTE-IDENTICAL from v1.24.0 (bb3022a, the last flash pass) through v2.12.0 —
 * checked field by field across five releases. The one render change in that
 * window that could plausibly touch a flash is `bloom.radius` 0.70 -> 0.34 at
 * v2.11.0, and rebuilding with 0.70 moves the failing case by NOTHING:
 * 16.003% of frame over L=0.95 against 15.580% at the shipped 0.34, which is
 * inside the run-to-run spread of the presentation RNG. So "again" is an
 * accurate description of the experience and there is no commit to point at.
 *
 * WHAT WAS ACTUALLY WRONG: THE BUDGET IS LOCAL AND THE SCREEN IS NOT.
 *
 * `radiusM` is 7 m and every `mergeRadius` in `VFX_LIGHTS` is 4-9 m, so both
 * bounding mechanisms only ever fire on effects that are nearly on top of each
 * other. `tools/flash-stack.mjs` packs EVERY sweep it has ever run into a 4 m
 * spiral — inside both — so six passes of measurement have all been taken on
 * the one configuration that is bounded. A firefight is not 4 m across. It is
 * 30-40 m across, which is one screenful at `CAMERA.defaultDistance`, and out
 * there every detonation gets a private budget and a private PointLight and
 * the frame is the sum of all of them with nothing capping it.
 *
 * Measured at 1280x720 on the DEFAULT 55 m dolly (`.flash-stack/spread`),
 * twelve unit deaths, frame area over L=0.95 against a 2.430% baseline:
 *
 *                              area>0.95     vs baseline     frame mean
 *     baseline, no effects        2.430%            —           0.368
 *     one death                   3.991%        +1.56pp         0.402
 *     twelve inside 4 m           5.442%        +3.01pp         0.425   <- bounded
 *     twelve across 18 m         15.580%       +13.15pp         0.551   <- not
 *
 * and with every VFX sprite and ribbon layer hidden so only the point lights
 * reach the frame, the same twelve across 18 m read +0.95pp. **The light pool
 * is not the offender and the merge is not brightening without bound** — it
 * saturates at `VFX_LIGHT_MERGE_CEIL` exactly as its own comment claims. The
 * additive sprite layer, spread across a screenful, is the whole of it.
 *
 * SO THE BUDGET GETS A SECOND TIER, AT THE SCALE OF THE COMPLAINT. See `wide`
 * below. The mechanism is unchanged — the same load / ceiling / exponent /
 * floor / half-life, the same "charge what was actually emitted so the series
 * converges" — applied a second time over a radius the size of the framed
 * view, and the two attenuations multiply. A lone explosion still gets exactly
 * 1.0 from both tiers, so the property this whole file rests on is intact.
 */
export const VFX_GLARE = {
  /**
   * Radius in metres inside which two effects share one budget.
   *
   * 7.0 is a unit-death fireball's own visible radius (the billow shell plus a
   * billow's `billowSize1TL`), which is the distance at which two detonations
   * genuinely overlap on screen rather than merely being near each other. Wider
   * than this and explosions that read as separate events start dimming each
   * other; much narrower and a squad's flashes each get a private budget, which
   * is the bug.
   */
  radiusM: 7.0,
  /**
   * Ceiling on a locality's load, in unit-death-explosion equivalents.
   *
   * This is the answer to "how many simultaneous explosions may a single patch
   * of ground look like". 2.4 reads as one violent event with real depth; the
   * 20th detonation in the same spot therefore emits about a tenth of what the
   * first did instead of a full second copy.
   */
  ceiling: 2.4,
  /**
   * Curve shape. >1 keeps the response flat while the budget is nearly empty —
   * two tanks dying together must not read as one death and one fizzle — and
   * then collapses as the locality fills. At 2.0 the second unit death emits
   * 83% and the fourth 12%.
   */
  exponent: 2.0,
  /**
   * Floor on the multiplier, and therefore the MARGINAL cost of one more
   * detonation once a locality is saturated: 6% of what the first one cost,
   * instead of 100%.
   *
   * It is not zero, so no detonation is ever emitted as literally nothing and no
   * downstream consumer has to cope with a zero gain. It is small, because the
   * total load past the ceiling grows as `ceiling + floor x N` — the one part of
   * this that is linear in N rather than bounded, so it is the number that
   * decides how the extreme tail behaves. At 0.06, twenty co-located deaths
   * emit ~3.3 deaths' worth and a hundred emit ~8, against 20 and 100 before.
   */
  floor: 0.06,
  /**
   * Half-life of a locality's load.
   *
   * 750 ms is `VFX_EXPLOSION.billowLifeMs` exactly, and that is the point: the
   * budget comes back at the rate the fire that spent it actually burns out. A
   * shorter constant lets a sustained firefight re-blow the frame between
   * volleys; a longer one keeps suppressing after the ground has gone dark.
   */
  halfLifeMs: 750,
  /** Below this the locality is retired and its slot recycled. */
  retireLoad: 0.02,
  /**
   * THE SECOND TIER — how much glare one ENGAGEMENT may emit at once, as
   * opposed to one patch of ground. The seventh report's fix; see the block
   * above this struct for the measurement that says why it had to exist.
   *
   * Every field means exactly what its namesake above means and the code path
   * is the same one, run twice. The two attenuations MULTIPLY, and each tier is
   * charged what was actually emitted (`cost x the product`), so both series
   * converge for the same reason the single one did.
   */
  wide: {
    /**
     * 34 m, and it is a statement about the CAMERA rather than about fire.
     *
     * At `CAMERA.defaultDistance` 55 m through the 36-degree vertical FOV the
     * focus plane is `2 x 55 x tan(18deg)` = 35.7 m tall and about 63 m wide, so
     * a 34 m radius is very nearly "everything you can see at once". That is
     * the right scale because the complaint is about the SCREEN: two
     * detonations 30 m apart do not overlap on the ground and would be wrong to
     * dim each other on that basis, but they are both in the frame, they are
     * both additive, and the frame is what goes white.
     *
     * It does NOT make the locality tier redundant and must not replace it.
     * Twelve deaths in 4 m and twelve deaths across 34 m need different
     * answers — the first is one fireball, the second is a battle — and a
     * single tier can only give one.
     */
    radiusM: 34.0,
    /**
     * Ceiling on an engagement's load, in unit-death equivalents, and
     * therefore the answer to "how violent may one screenful get".
     *
     * Deliberately well above the locality's 2.4: a battle is allowed to be
     * bigger than a single fireball. What it is not allowed to be is
     * PROPORTIONAL to the body count, which is what it was.
     */
    ceiling: 4.0,
    /**
     * 3.0, not the locality tier's 2.0, and the higher exponent is the whole
     * reason this can be added without making ordinary combat look limp.
     *
     * The curve is `1 - (load/ceiling)^exp`, so a bigger exponent stays flatter
     * for longer and then falls off a cliff. At 3.0 against ceiling 4.0 the
     * SECOND death in a screenful emits 98.4% and the third 91.4% — i.e. a duel
     * between two tanks is indistinguishable from today — while the seventh is
     * at 14% and the twelfth is at the floor. Twelve deaths across a screenful
     * then emit about 4.5 deaths' worth between them instead of twelve.
     *
     * At the locality tier's 2.0 the second death in the frame would already be
     * down to 93.8% and a pair reads measurably dimmer than it does now, which
     * is the "someone fixed the brightness" failure arriving from the other
     * side.
     */
    exponent: 3.0,
    /**
     * Marginal cost of one more detonation once the whole screen is saturated.
     *
     * Lower than the locality's 0.06 because this tier's tail is the one that
     * decides the extreme case: a base going up is thirty deaths inside one
     * screenful, and at 0.06 the linear part of `ceiling + floor x N` alone
     * would be another 1.8 deaths' worth on top of the ceiling. The PRODUCT of
     * the two tiers is clamped up to `VFX_GLARE.floor` in `admitGlare`, so no
     * emission is ever emitted as literally nothing however saturated both
     * tiers are — that guarantee is unchanged and is asserted in the tests.
     */
    floor: 0.03,
    /**
     * 1000 ms, longer than the locality's 750.
     *
     * 750 is `billowLifeMs` because a patch of ground is free again when the
     * fire on it has burned out. An ENGAGEMENT is not one fireball: a wave
     * breaking on a base arrives over one to three seconds, and at a 750 ms
     * half-life the budget is 60% back between two volleys 800 ms apart, which
     * lets the frame re-blow on every one of them. A second is long enough to
     * hold the lid across a volley and short enough that the screen is fully
     * open again about two seconds after the shooting stops.
     */
    halfLifeMs: 1000,
    /** Below this the engagement is retired and its slot recycled. */
    retireLoad: 0.02,
  },
  /**
   * Cost per effect, in unit-death-explosion equivalents. An explosion's cost is
   * additionally multiplied by k^2 (its size relative to a unit death), because
   * the same billow count spread over a k-times-wider fireball covers k^2 the
   * pixels — the same reason `billowIntensityFalloff` exists.
   *
   * The ratios are not guesses, they are the effects' additive gain x quad area,
   * normalised: a heavy muzzle flash's star and core come to roughly a fortieth
   * of a unit-death fireball's total emitted energy, but its energy lands on a
   * few square metres rather than thirty-five, so what matters for blowing a
   * pixel out is its SURFACE brightness — hence 0.50 rather than 0.02. Twenty
   * guns firing into one locality then emit about five flashes' worth of glare
   * instead of twenty, while a squad in sustained fire settles at ~0.6 gain
   * (charge 8/s against a 750 ms half-life) rather than being switched off.
   */
  cost: {
    explosion: 1.00,
    muzzle: 0.50,
    impact: 0.22,
    spark: 0.22,
    /**
     * A LIVE ARC AND A LIVE BEAM, added after the sixth brightness report.
     *
     * `src/vfx/Beams.ts` did not import `admitGlare` at all, so the two
     * brightest additive emitters in the game were the only ones never charged
     * — while the comment above this table was busy explaining that "the
     * additive layer SUMS and nothing bounded the sum".
     *
     * 0.85 rather than an explosion's 1.00 for a reason that runs the other
     * way from every other row here: an arc is DIMMER per pixel than a
     * fireball but is up for a second rather than 100 ms and covers a long thin
     * corridor rather than a disc. Measured by `tools/flash-stack.mjs --ablate`
     * once its arc sweep existed, four co-located arcs put 4.59pp of the frame
     * into blue-dominant glare from the ribbons alone against 1.20pp for one —
     * a factor of 3.8, where the point lights only managed 1.3 because they
     * merge. 0.85 puts the fourth arc at roughly a third of the first, which is
     * a bank of coils reading as a bank of coils rather than as a blue wall.
     */
    arc: 0.85,
    beam: 0.85,
    /**
     * The tesla IMPACT starburst, which was charged nothing at all.
     *
     * `Beams.teslaImpact` never called `admitGlare`, so four coils firing into
     * one spot produced four full-strength starbursts — the same uncapped
     * stacking that `arc` and `beam` were given a cost for in v1.17.0, missed
     * because the probe could not reach this effect and nobody looked.
     *
     * 0.55 rather than the arc's 0.85: an impact is brief (180 ms against a
     * second) and covers a disc rather than a corridor, so it deserves a
     * smaller share of a locality's budget while still being bounded by it.
     */
    teslaImpact: 0.55,
  },
} as const;

/**
 * Live particle budget. Bible §8.10 asks for ~2500 at a 20-unit battle; these
 * three pools sum to 2720 and are allocated once, at boot, as flat typed
 * arrays. Overflow DROPS the newest emission rather than growing.
 */
export const VFX_MAX_ADDITIVE = 1200;
export const VFX_MAX_LIT = 1300;
export const VFX_MAX_DEBRIS = 220;

/**
 * The lit layer gets the LARGER share, which is counter-intuitive until you
 * count a real battle: additive effects are violent and SHORT (a fireball is
 * gone in 750 ms, a muzzle flash in 90), while smoke and dust are slow and
 * long. Thirty moving vehicles laying two tread puffs every 150 ms at a 2.8 s
 * lifetime is ~1100 live dust sprites on its own — measured in-engine at a
 * 106-entity battle, where the original 700-slot lit pool dropped 16 000
 * emissions in under a minute while the additive pool sat nearly empty.
 */

/**
 * Above this fill fraction the lit pool stops accepting the LOW-VALUE
 * emissions — tread dust and damage wisps — so an explosion's plume can still
 * get slots during a big fight. Without it the cheapest, most frequent effect
 * in the game starves the most important one.
 */
export const VFX_LIT_PRESSURE_CUTOFF = 0.82;

/** Simultaneous tesla bolts, continuous beams and in-flight tracers. */
export const VFX_MAX_BOLTS = 24;
export const VFX_MAX_BEAMS = 24;
export const VFX_MAX_TRACERS = 320;

/**
 * Vertex ceiling of the shared screen-width ribbon buffer (tesla + beams +
 * tracers all draw out of it). A tesla bolt costs ~450 verts, a beam ~24,
 * a tracer 4.
 */
export const VFX_RIBBON_VERTS = 32768;

/** Sprite atlas: 4x4 tiles. 512 gives 128 px tiles, plenty at RTS scale. */
export const VFX_ATLAS_SIZE = 512;
export const VFX_ATLAS_COLS = 4;
/** Colour-ramp LUT: one 128-texel row per ramp. */
export const VFX_RAMP_WIDTH = 128;

/* ---- the ramps (bible §8.2 / §8.3 / §8.4 / §8.5 / §8.6 / §8.7) ---------- */

/** One ramp stop: [position 0..1, sRGB hex, alpha 0..1]. */
export type VfxRampStop = readonly [number, string, number];

/**
 * Row order IS the shader's ramp index — append only, never reorder.
 *
 * V3 keeps a genuinely white ignition point but moves into yellow, orange and
 * soot quickly. A half-radius white core was technically bright and visually
 * flat: overlapping billows merged into one plate and erased the object that
 * exploded. Colour separation now carries volume while the centre still clips.
 */
export const VFX_RAMPS: readonly { readonly name: string; readonly stops: readonly VfxRampStop[] }[] = [
  { name: 'fireball', stops: [
    [0.00, '#FFF8EE', 1.00], [0.14, '#FFF0B0', 1.00], [0.32, '#FFD05A', 0.98],
    [0.50, '#FF9A34', 0.95], [0.68, '#F06A24', 0.86], [0.82, '#B74418', 0.68],
    [0.92, '#6F2A14', 0.42], [1.00, '#241612', 0.00],
  ] },
  { name: 'flash', stops: [
    [0.00, '#FFFFFF', 1.00], [0.18, '#FFF1B8', 0.94], [0.52, '#FFC34A', 0.68], [1.00, '#E87218', 0.00],
  ] },
  { name: 'smokeDark', stops: [
    [0.00, '#1A1A1A', 0.90], [0.30, '#2A2622', 0.80], [0.70, '#3A3632', 0.45], [1.00, '#4A4A4A', 0.00],
  ] },
  { name: 'dust', stops: [
    [0.00, '#C6C6C0', 0.55], [0.35, '#CFCFC9', 0.42], [0.75, '#D8D8D2', 0.16], [1.00, '#D8D8D2', 0.00],
  ] },
  { name: 'ember', stops: [
    [0.00, '#FFF4C8', 1.00], [0.28, '#FFC24A', 1.00], [0.62, '#FF6A18', 0.80], [1.00, '#8C2A0E', 0.00],
  ] },
  { name: 'spark', stops: [
    [0.00, '#FFF8D8', 1.00], [0.45, '#F6E9B0', 0.85], [0.80, '#D8B860', 0.40], [1.00, '#8C6A20', 0.00],
  ] },
  { name: 'tesla', stops: [
    [0.00, '#FFFFFF', 1.00], [0.08, '#E8F0FF', 1.00], [0.18, '#A8C4FF', 0.95],
    [0.32, '#6E8CFF', 0.82], [0.55, '#3F5FE8', 0.55], [0.80, '#1326B3', 0.22], [1.00, '#0A1450', 0.00],
  ] },
  { name: 'prism', stops: [
    [0.00, '#FFFFFF', 1.00], [0.10, '#F1FEF5', 1.00], [0.26, '#A7F5F9', 0.92],
    [0.44, '#A2D2FF', 0.72], [0.62, '#81B3FC', 0.48], [0.82, '#6597DE', 0.22], [1.00, '#547BC0', 0.00],
  ] },
  { name: 'shockwave', stops: [
    [0.00, '#FFE8C0', 1.00], [0.55, '#FFD49A', 0.75], [1.00, '#FFB060', 0.00],
  ] },
  { name: 'vapour', stops: [
    [0.00, '#E4E8EC', 0.85], [0.55, '#D2D7DC', 0.55], [1.00, '#C0C6CC', 0.00],
  ] },
  { name: 'rocketFlame', stops: [
    [0.00, '#FFE9B0', 1.00], [0.22, '#FFAE3A', 1.00], [0.70, '#FF7C10', 0.60], [1.00, '#8C3208', 0.00],
  ] },
  { name: 'rocketSmoke', stops: [
    [0.00, '#6A6560', 0.70], [0.45, '#7A756E', 0.48], [1.00, '#8A857E', 0.00],
  ] },
  { name: 'muzzle', stops: [
    [0.00, '#FFFFFF', 1.00], [0.10, '#FFF0B0', 1.00], [0.42, '#FFC13A', 0.82], [1.00, '#D96514', 0.00],
  ] },
  { name: 'tracerWarm', stops: [
    [0.00, '#FFFFFF', 1.00], [0.16, '#FFD26A', 1.00], [0.55, '#FF9A2E', 0.80], [1.00, '#E8781C', 0.00],
  ] },
  { name: 'tracerCold', stops: [
    [0.00, '#FFFFFF', 1.00], [0.22, '#C8E4FF', 1.00], [0.62, '#6FA8FF', 0.75], [1.00, '#3F6FD8', 0.00],
  ] },
  { name: 'splash', stops: [
    [0.00, '#FFFFFF', 0.95], [0.25, '#E4F0EE', 0.80], [0.70, '#9FC0BC', 0.40], [1.00, '#5E8A86', 0.00],
  ] },
] as const;

/** Ramp row indices — import these, never a literal. */
export const VFX_RAMP = {
  fireball: 0, flash: 1, smokeDark: 2, dust: 3, ember: 4, spark: 5,
  tesla: 6, prism: 7, shockwave: 8, vapour: 9, rocketFlame: 10, rocketSmoke: 11,
  muzzle: 12, tracerWarm: 13, tracerCold: 14, splash: 15,
} as const;

/** Sprite atlas tile indices (row-major in a 4x4 grid). */
export const VFX_TILE = {
  soft: 0, billow: 1, streak: 2, ring: 3,
  star: 4, filigree: 5, core: 6, chunk: 7,
  spark: 8, lobe: 9, bead: 10, shock: 11,
  emberDot: 12, kite: 13, flare: 14, puffAlt: 15,
} as const;

/* ---- explosions (bible §8.2) -------------------------------------------- */

/**
 * ============================================================================
 * THE DETONATION BLOOM BUDGET — read this before raising any number below.
 * ============================================================================
 *
 * "The flashes when something explodes are HUGE, completely block the screen."
 * Reported TWICE. The first pass shrank the flash disc and left every gain
 * untouched, which is why it came back. What follows is the second pass, and
 * the multiplier block that used to shadow this one (`GLOW` at the top of
 * src/vfx/Explosions.ts) is now folded in here — one place for these knobs.
 *
 * WHAT WAS MEASURED. One 2.2 TL unit death, 47.8 m from the camera, captured
 * at 2560x1440 through the `?shot=battle` fixture with the VFX clock frozen and
 * differenced against the identical frame with no explosion in it:
 *
 *                            blown-white core        area of the WHOLE frame
 *                            (equiv. circle, %W)     at sRGB L>245
 *      unit death   @ 90 ms        26.9 %                 10.1 %
 *      structure    @ 60 ms        42.3 %                 25.0 %
 *
 * A quarter of the frame is a featureless white plate for a building, a tenth
 * for a tank. That is not a flash with a halo, and the user is describing it
 * accurately.
 *
 * THE MECHANISM, AND WHY SIZE ALONE NEVER FIXED IT. The bloom pass haloes
 * whatever it is handed above its 0.85 threshold. A 7.0-linear source is ~8x
 * over that threshold, so the above-threshold region is not the sprite's bright
 * middle — it is essentially the sprite's whole visible disc, and 8-14 of them
 * blend ADDITIVELY on top of each other. Shrinking the quads while leaving the
 * gain at 7.0 just makes a slightly smaller solid plate. **The area above the
 * bloom threshold is the quantity that matters, and it is driven by gain at
 * least as much as by size.**
 *
 * SO BOTH LEVERS MOVED, ROUGHLY BY HALF, WHICH IS WHAT WAS ASKED FOR. The
 * numbers below are the bible's authored figures times the correction, baked in
 * rather than multiplied at the call site; each one carries its bible value in
 * the comment so nothing is lost.
 *
 * WHAT MUST NOT BE LOST — SCORECARD #14. "The brightest 40% of a fireball is
 * L>245, channel spread <30." Halving a 7.0-linear source still leaves it ~4x
 * over the tonemapper's clip point, so the white-hot core survives; it was
 * re-measured after the change, not assumed. What shrinks is the AREA above
 * threshold, never the peak. If you ever need to make an explosion read hotter,
 * raise the ramp, not these gains.
 * ============================================================================
 */
export const VFX_EXPLOSION = {
  /** Fireball diameter in metres per "size 1.0". Unit death is 2.2 TL. */
  unitDeathTL: 2.2,
  structureDeathTL: 5.0,
  smallTL: 1.2,

  /* -- the flash disc ---------------------------------------------------- */

  /**
   * Flash disc diameter in TL, start -> end. Peak 40 ms, gone by 140 ms.
   *
   * Bible §8.2 authors 1.8 -> 3.2 TL. 3.2 TL is 22.4 m, which at a normal RTS
   * zoom is over a third of the frame's width — as a flat additive plate that
   * is a bloom source the size of the shot. The first pass took it to 1.9 TL
   * and it was still reported as screen-filling; halving again lands at 0.96 TL
   * (6.7 m), which is a bright point ON the fireball rather than a lid over it.
   * The start size is held near the same ratio so the disc still SNAPS open —
   * the 40 ms onset is the whole character of the effect.
   */
  /*
   * DO NOT TUNE THESE FOR THE "SCREEN-FILLING WHITE" REPORT. MEASURED 2026-08-06,
   * on the fifth report of it, with `tools/flash-stack.mjs`:
   *
   *   flashSize1TL 0.96 -> 0.48 (disc AREA quartered), everything else equal
   *     n=1 explosion, frame area over 0.95:  14.528%  ->  14.211%
   *     n=1 mean:                              0.5616  ->   0.5551
   *     n=20 area over 0.95:                  26.057%  ->  26.057%  (identical)
   *
   * Quartering the disc moves the blown-out area by three tenths of a point and
   * does not move the n=20 case at all. THE FLASH DISC IS NOT WHAT WHITES OUT
   * THE FRAME. Four previous passes tuned this family of numbers; that is why
   * there have been five reports.
   *
   * The cause is still unattributed — see #60. What is known: the baseline
   * frame already has 5.98% of pixels over 0.95 with no explosion at all, and
   * the per-layer ablation is not yet trustworthy (hiding bright layers makes
   * the frame BRIGHTER, which nothing has explained). Find the cause before
   * changing anything here.
   */
  flashSize0TL: 0.70, flashSize1TL: 0.96, flashLifeMs: 140,
  /**
   * HDR gain of the flash core, in scene-linear.
   *
   * **This is the number the first pass missed.** 7.0 against a 0.85 bloom
   * threshold puts the disc ~8x over it across its entire surface. 3.5 is still
   * ~4x over — the core clips to pure white exactly as before (scorecard #14 is
   * re-measured, not assumed) — but the skirt now falls under threshold within
   * a fraction of the radius instead of feeding the mip chain as a solid disc.
   *
   * LEFT AT 3.5 BY THE FIFTH REPORT, on purpose. Two lower values were tried
   * and both are wrong: 0.875 (a literal 75% cut) falls UNDER the 0.85 bloom
   * threshold and the flash stops being a flash, and 1.75 drops it below
   * `billowIntensity` 2.1 so the highlight becomes a dark spot on its own
   * fireball — `tests/vfx.spec.ts:575` catches that one immediately, because it
   * identifies flash discs by being the brightest thing in the frame and
   * matched 818 sprites instead of 20.
   */
  flashIntensity: 3.5,
  /**
   * ONE GAIN OVER THE WHOLE EXPLOSION. THE FIFTH REPORT'S ACTUAL FIX.
   *
   * Folded into `glare` in `Explosions.ts#spawnExplosion`, so it reaches the
   * flash disc, the structure flash, the billows, the shockwave and the embers
   * together and CANNOT BE MISSED BY A NEW EMITTER.
   *
   * WHY A SINGLE GAIN AND NOT ANOTHER SPRITE TWEAK. Explosion brightness was
   * reported five times. Every previous pass lowered one sprite — flashIntensity
   * 7.0 -> 3.5, billowIntensity 4.2 -> 2.1, the muzzle core 9.0 -> 4.0 — and
   * every one measured correctly, because each was measured on the sprite it
   * changed. The ablation that finally worked (see below) shows the layer is
   * the unit of the problem, not any sprite in it.
   *
   * THE MEASUREMENT, `tools/flash-stack.mjs --ablate`, frame area over sRGB
   * 0.95 against a 5.983% baseline:
   *
   *                        all-on      additive layer hidden
   *      one explosion    +5.753pp          +0.332pp     (94% of it)
   *      twenty           +17.400pp         +0.451pp     (97% of it)
   *
   * and `everything-off` lands at -0.085pp, i.e. exactly baseline, so the
   * measurement is complete and nothing is unaccounted for.
   *
   * That result CONTRADICTS four passes of accumulated notes, including the
   * claim in this file that the point lights were the largest single lever.
   * Those notes were taken through a mask that never worked: the arms set
   * `mesh.visible = false`, and `ParticleSystem` reassigns `mesh.visible` on
   * every upload (Particles.ts:994, :1174) while `screenshot()` renders through
   * the system registry. The probe now reports a `STILL DREW` column per arm
   * and masks via `material.visible`, which nothing in the vfx system touches.
   *
   * WHY IT SCALES THE LIT BILLOWS TOO, even though hiding them does not help.
   * The RATIOS are the art direction (see the note above this block), and
   * `tests/vfx.spec.ts` identifies a flash disc as the brightest sprite in the
   * frame. Scaling additive alone would drop `flashIntensity` under
   * `billowIntensity` and turn the highlight into a dark spot on its own
   * fireball — the exact failure the `flashIntensity` note records from an
   * earlier attempt, which matched 818 sprites instead of 20.
   */
  outputGain: 0.30,
  /**
   * How far the flash ramp is stretched across the disc's RADIUS.
   *
   * The disc is emitted with `radial = 1`, so the ramp sweeps across the sprite
   * rather than across its lifetime: a hot centre with a fast falloff instead
   * of a uniform plate. Above 1.0 for the same reason `billowRadialSpan` is —
   * the core tile's alpha is already fading at the quad edge, so a 1.0 span
   * parks the ramp's transparent tail in invisible pixels and the disc reads as
   * a flat white plate again.
   */
  flashRadialSpan: 1.12,

  /**
   * The SEPARATE flash a structure death gets on top of its fireball, in TL.
   *
   * Bible §8.2 asks for 8 TL. That is 56 metres of flat white — wider than the
   * visible ground in the combat fixture. Same halving as the unit flash leaves
   * 2.24 TL (15.7 m), which still reads as "something much bigger just died"
   * next to the unit death's 0.96 TL.
   */
  // ABSOLUTE, not a multiple of the unit flash — they do not inherit changes to
  // it. Left alone by the fifth report for the reason recorded at
  // `flashSize0TL`: the flash disc is measurably not the whiteout.
  structureFlashSize0TL: 0.84, structureFlashSize1TL: 2.24,
  /** The structure flash runs a little longer and a little softer than the unit one. */
  structureFlashLifeMul: 1.30, structureFlashIntensityMul: 0.80,

  /**
   * How far the radial fire ramp is stretched across small flash/impact quads.
   *
   * `radial = 1` sweeps the ramp from t=0 at the sprite centre to t=`this` at
   * the quad's edge. It must be >1, and the reason is easy to miss: the billow
   * TILE only covers about 86% of its quad and its alpha is already fading by
   * then, so a 1.0 span parks the ramp's saturated `#B5501C` fringe in fully
   * transparent pixels. The fireball then renders as an all-white haze with no
   * orange in it at all — the exact opposite failure to the one scorecard #14
   * guards against, and it looks like fog.
   *
   * 1.18 keeps the dark orange/soot tail inside the visible portion of the
   * billow tile. Full death fireballs now use life-driven lobes; this remains
   * the shared radial span for impact flashes and short flame effects.
   */
  billowRadialSpan: 1.18,

  /* -- the fireball ------------------------------------------------------ */

  /** Fireball: 8-14 billows, dead at 750 ms, rotating +/-35 deg/s. */
  billowMin: 8, billowMax: 14,
  /**
   * Diameter of ONE billow in TL, start -> end.
   *
   * Bible §8.2 gives 0.9 -> 2.6 TL, but 2.6 TL is its figure for the WHOLE
   * fireball of a unit death (2.2 TL) with headroom — it was being applied to
   * every one of the 8-14 billows individually. Work the ensemble out: the
   * billows are born on a `billowShellTL` shell and drift ~2 m outward against
   * drag 2.6 over their 750 ms life, so at 1.0 TL each the envelope comes out
   * at about 2.5 TL, which is the bible's fireball plus its sparse outliers.
   * The compact ignition flash remains independently sized, while these lobes
   * carry the irregular orange mass around it.
   */
  billowSize0TL: 0.34, billowSize1TL: 1.00, billowLifeMs: 750,
  /** Maximum per-lobe ignition stagger; breaks the simultaneous bubble wall. */
  billowStaggerMs: 95,
  billowSpinDegPerSec: 35,
  /**
   * HDR gain of one billow, in scene-linear — halved from the authored 4.2.
   *
   * 8-14 of these blend ADDITIVELY, so the gain that matters where they overlap
   * is several times this. At 4.2 the sum in the middle of the fireball was so
   * far over the 0.85 bloom threshold that every billow's ENTIRE disc was above
   * it and the ensemble read as one solid white plate — 10% of the whole frame
   * for a single tank. At 2.1 the core still clips to white (that is what the
   * compact flash still clips to white while the life-driven lobe bodies retain
   * saturated yellow/orange separation.
   */
  billowIntensity: 2.1,
  /**
   * Exponent by which the per-billow gain is walked BACK as the fireball grows.
   * Applied as `gain * k^-this` for `k > 1` only, where `k` is the fireball's
   * size relative to a unit death.
   *
   * This is not a fudge, it is compensation for a real property of additive
   * blending. The same 8-14 billows are spread over a fireball that is `k`
   * times wider, so a view ray through the middle of it crosses roughly the
   * same number of sprites but each one covers `k^2` the pixels — the fireball
   * gets brighter per pixel as it gets bigger, on top of getting bigger. That
   * is why the 5.0 TL structure death stayed a featureless white plate (channel
   * spread 0.0 across its whole disc, measured) at a gain that left the 2.2 TL
   * unit death reading correctly.
   *
   * 0.5 takes the structure death's k=2.27 to a 0.66 multiplier. Small
   * explosions (cook-offs, k<1) are deliberately NOT boosted the other way:
   * they have fewer layers to stack and pushing their gain up would walk
   * straight back into the budget this pass exists to hold.
   */
  billowIntensityFalloff: 0.5,
  /** Outward speed of the billow shell, metres/sec at size 1. */
  billowSpread: 8.5,
  /**
   * Radius in TL of the shell the billows are born on, at size 1.0.
   *
   * ADDITIVE BLENDING IS WHY THIS EXISTS. Twelve billows born within half a
   * metre of each other are twelve sprites stacked on the same pixels: they sum
   * to something the tonemapper returns pure white for, and the fireball
   * renders as a featureless pale haze with no billow structure and no orange
   * anywhere. Measured, twice. Spread them onto a real shell and each one reads
   * as its own irregular cooling mass instead of a pile of identical circles.
   *
   * IT IS AN ABSOLUTE LENGTH ON PURPOSE. It used to be a fraction of
   * `billowSize0TL`, which coupled it to the billow's own size — so shrinking
   * the billows collapsed the shell too and re-stacked them at the origin,
   * undoing the fix while looking like a size change. 0.50 TL preserves the
   * 3.5 m shell the fraction produced against the bible's original 0.9 TL.
   */
  billowShellTL: 0.50,

  /* -- shockwave, plume, debris, embers ---------------------------------- */

  /** Shockwave: 0.4 -> 4.5 TL, starts at 30 ms, dead at 420 ms, scaleY 0.12. */
  shockSize0TL: 0.4, shockSize1TL: 4.5, shockDelayMs: 30, shockLifeMs: 420,
  shockFlatten: 0.12,
  /**
   * Shockwave ring gain. Halved with everything else: this is a 4.5 TL (31 m)
   * ring lying flat on the ground, so at 3.0 linear it was a second full-width
   * bloom source arriving 30 ms after the flash.
   */
  shockIntensity: 1.7,

  /* -- radial destruction ejecta --------------------------------------- */

  /**
   * Long hot spokes thrown out of a vehicle/building detonation. These are
   * deliberately sparse and readable, not the 30-45 hairline sparks used for
   * routine armour impacts: a death needs a visible radial silhouette.
   */
  ejectaRayMin: 12, ejectaRayMax: 18,
  /** Buildings throw a denser, longer fan without changing the flash size. */
  structureEjectaCountMul: 1.55, structureEjectaLengthMul: 1.35,
  /** World speed in TL/s and visible streak length in TL. */
  ejectaSpeedTL: [3.8, 7.2] as const,
  ejectaLengthTL: [0.55, 1.25] as const,
  /** Screen-stable line width, quick hot phase, and restrained HDR gain. */
  ejectaWidthPx: 1.35, ejectaLifeMs: 620, ejectaIntensity: 3.4,
  /** Every other ray carries this many staggered smoke beads behind it. */
  ejectaSmokeBeads: 2, ejectaSmokeLifeMs: 1050,

  /** Smoke plume: 14-22 puffs, onset 120 ms, dead at 5.5 s. */
  puffMin: 14, puffMax: 22,
  /**
   * Diameter of ONE puff in TL, start -> end.
   *
   * Same error as the billows, and the reason `05-combat` was a white sheet
   * even after the shading was fixed: `plumeEnvelopeTL` (the bible's figure for
   * the whole column) was being applied to each of 14-22 puffs, giving 28-metre
   * near-opaque smoke balls. The combat fixture frames from 48 m, where the
   * visible ground is about 31 m tall — ONE puff covered the frame and one
   * death emits twenty of them. With the puffs' own spread and rise, 2.0 TL
   * each still builds a plume whose envelope is the authored 4 TL.
   */
  puffSize0TL: 0.27, puffSize1TL: 2.00, puffLifeMs: 5500, puffDelayMs: 120,
  /** Bible §8.7's figure for the WHOLE plume. Documentation and the test's reference. */
  plumeEnvelopeTL: 4.0,
  puffRise: 2.4,
  /**
   * Plume opacity, base -> top, replacing a flat 0.92.
   *
   * Bible §8.7 runs a column from 0.85 at the base to 0.15 at the top and the
   * plume already computes that fraction — it just was not using it. Twenty
   * stacked puffs at an effective 0.83 alpha are a solid wall: the wreck that
   * produced the plume is not visible through its own smoke, which is not what
   * an RA3 frame does.
   */
  puffAlphaBase: 0.72, puffAlphaTop: 0.20,

  /** Debris: 12-20 chunks, 0.05-0.14 TL, 55 deg cone, 5-9 TL/s, g 22 TL/s^2. */
  debrisMin: 12, debrisMax: 20,
  debrisSize0TL: 0.05, debrisSize1TL: 0.14,
  debrisConeDeg: 55, debrisSpeedTL: [5, 9] as const,
  debrisGravityTL: 22, debrisTumbleDegPerSec: 720, debrisLifeMs: 1600,

  /**
   * Embers: 30-60, 0.02-0.04 TL, 1.9 s, additive, flicker 18 Hz.
   *
   * These are pinpricks, so their own area above the bloom threshold is
   * negligible — but sixty of them at 3.4 linear is sixty little bloom seeds
   * scattered through the frame right where the eye is already recovering from
   * the flash. 2.4 keeps them clearly incandescent.
   */
  emberMin: 30, emberMax: 60,
  emberSize0TL: 0.02, emberSize1TL: 0.04, emberLifeMs: 1900,
  emberFlickerHz: 18, emberSpeedTL: [2.5, 6.5] as const, emberIntensity: 2.4,

  /** Scorch decal: 1.6-2.4 TL major axis, 1.7:1 aspect, permanent. */
  scorchMinTL: 1.6, scorchMaxTL: 2.4, scorchAspect: 1.7,

  /**
   * The brief hot flash on a ground/concrete impact — even a dirt hit is a
   * detonation. Diameters in metres at `scale = 1`, gain in scene-linear.
   *
   * A firefight lands dozens of these per second, so the impact sits at the
   * bloom threshold rather than sharing the death flash's emissive class.
   */
  impactFlashSize0M: 0.8, impactFlashSize1M: 1.5,
  impactFlashIntensity: 1.2, impactFlashLifeMs: 90,

  /** Structure death: the separate flash above, then 3-6 cook-offs at 250 ms. */
  cookOffMin: 3, cookOffMax: 6, cookOffIntervalMs: 250, cookOffTL: 1.2,

  /** Camera trauma pushed into CameraRig.addShake per TL of fireball. */
  shakePerTL: 0.10,
} as const;

/* ---- tesla (bible §8.3) ------------------------------------------------- */

export const VFX_TESLA = {
  /** Path: 8-14 segments, lateral jitter +/-(0.06 * length), 3 displacement levels. */
  segMin: 8, segMax: 14,
  jitterFrac: 0.06, displaceLevels: 3, roughness: 0.55,

  /** 3-5 overlapping independently jittered copies of the main path. */
  strokeMin: 3, strokeMax: 5,

  /** Branching. Scorecard #30 wants >=4 branches AND >=1 closed loop per bolt. */
  branchMin: 4, branchMax: 8,
  branchChance: 0.35, branchLenFrac: [0.25, 0.50] as const,
  branchRejoinChance: 0.30,
  branchPoints: 4,

  /**
   * Widths in px at 1440p. Core <=3 px at L>=248 is scorecard #30.
   *
   * GLOW 46 -> 26, SHEATH 11 -> 9, sixth brightness report. "The Blue explosion
   * still tooooo huge" — and it was: a 46 px soft blue halo running the entire
   * length of a 9 m arc, over a frame 1440 px tall. The core is untouched at
   * 2.6, because the core is what makes a bolt read as a bolt and is the one
   * number scorecard #30 actually measures.
   *
   * Four passes cut the LIGHT (`VFX_LIGHTS.teslaArc` 26 -> 6.5) and none of
   * them touched this, because until the arc sweep landed in
   * `tools/flash-stack.mjs` nothing could tell the two apart. The measurement
   * says the ribbons are 2.5x the light pool at four arcs.
   */
  coreWidthPx: 2.6, sheathWidthPx: 4.0, glowWidthPx: 9.0,
  /** Cross-section falloff exponents: near-flat core, soft glow. */
  coreFalloff: 0.35, sheathFalloff: 1.05, glowFalloff: 2.1,
  /**
   * Where each layer samples the tesla ramp (0 = white core, 1 = #0A1450).
   *
   * The sheath sits at 0.42, not the 0.24 a naive reading of the ramp suggests.
   * #A8C4FF at 0.18 is only 0.40 red in linear, and multiplying it by an HDR
   * gain to make it glow pushes red past 1.0 too — so the "blue sheath" tone
   * maps to WHITE and the whole bolt comes out as a plain white scribble.
   * Measured in-engine and corrected: sampling at 0.42 keeps red near 0.09
   * while blue stays at 0.85, which is what actually reads as the saturated
   * `#1326B3`-class sheath the bible asks for within 8 px of the core.
   */
  coreRampT: 0.02, sheathRampT: 0.42, glowRampT: 0.66,
  /**
   * HDR gain. The core must clip to pure white through the tonemapper.
   *
   * GLOW 3.0 -> 1.5 AND SHEATH 2.4 -> 1.7, with the core untouched at 5.6.
   *
   * Narrowing the halo (46 -> 26 px, above) took a third off the blown area at
   * four arcs and only 13% off the BLUE area, because a soft-falloff halo's
   * bright middle survives being made narrower — the pixels that clear the
   * threshold are the ones near the axis, and those are a function of gain, not
   * of width. Width and gain had to come down together, which is the same
   * lesson the DETONATION BLOOM BUDGET block records for the fireball: "the
   * area above the bloom threshold [...] is driven by gain at least as much as
   * by size."
   */
  coreIntensity: 5.6, sheathIntensity: 0.6, glowIntensity: 0.40,
  /**
   * How much of its authored SHEATH each extra jittered trunk copy draws.
   * The extra copies deliberately carry NO core: five 2.6 px white filaments
   * scattered over the jitter radius merge into one ~10 px white bar, and
   * scorecard #30 measures "core <=3 px at L>=248". One filament, many sheaths.
   *
   * Bible §8.3 wants 3-5 overlapping paths, but additive blending means five
   * copies of a 5.6-gain core sum to 28 and the entire bolt clips to a fat
   * white bar. The extra copies exist to vary the silhouette, not to multiply
   * the brightness, so they draw dim and only the primary path is authored at
   * full strength.
   */
  copyDim: 0.42,

  /** Re-roll the whole path every 50 ms; total beam 0.9-1.4 s. */
  rerollMs: 50, defaultDurationMs: 1100,

  /**
   * IMPACT STARBURST — cut hard on the third report of "tesla tower flash is
   * HUGE HUGE HUGE".
   *
   * WHAT IT USED TO BE, in pixels at 1440p: a ball of radius 35-45 grown to
   * 1.25x, i.e. a disc up to 112 px ACROSS, plus 14-20 spikes of 60-140 px with
   * four of them at DOUBLE length — 280 px, a fifth of the frame height, each.
   * Sized in pixels rather than metres, so the whole thing claims the same
   * share of a 720p frame as of a 1440p one and reads far larger on the smaller
   * screen.
   *
   * MEASURED FIRST, and the measurement corrected the guess. The starburst was
   * the leading hypothesis for this report and it is NOT the dominant term:
   * `flash-stack --ablate` puts it at +1.78pp of blue frame area at four
   * impacts against the ARC's +4.50pp. It is a fifth of the problem, not the
   * whole of it, and both are cut here rather than only the one that was
   * suspected.
   *
   *   ball radius   35-45 -> 18-24 px      intensity 5.5 -> 2.0
   *   spike length  60-140 -> 34-78 px     long multiplier 2.0 -> 1.5
   *
   * `spikeIntensity` is NEW and is not a new knob — it is a magic 4.2 that was
   * sitting inline in `Beams.teslaImpact`, the only additive gain in the whole
   * VFX system that lived outside this table. That is the same defect shape as
   * the water foam's hard-coded lighting: a number nobody could find when they
   * came looking for it.
   */
  burstRadiusPx: [18, 24] as const, burstLifeMs: 180, burstIntensity: 2.0,
  spikeMin: 14, spikeMax: 20,
  spikeWidthPx: [2, 4] as const, spikeLenPx: [34, 78] as const,
  spikeLifeMs: 220, spikeLongCount: 4, spikeLongMul: 1.5,
  /** Additive gain of one spike. Was an inline 4.2 in Beams.teslaImpact. */
  spikeIntensity: 1.6,
} as const;

/* ---- beams (bible §8.4) ------------------------------------------------- */

export const VFX_BEAM = {
  prism: {
    /**
     * OUTER 64 -> 34 AND INNER 33 -> 22, sixth brightness report, same
     * measurement as `VFX_TESLA.glowWidthPx`. A 64 px halo down the full length
     * of a beam is most of the blue the player was complaining about, and the
     * 3.5 px core — the part that reads as a beam — is untouched.
     */
    corePx: 3.5, innerPx: 14, outerPx: 20,
    coreT: 0.01, innerT: 0.26, outerT: 0.62,
    // inner 2.4 -> 1.5, outer 0.85 -> 0.55. Core held at 6.0: it is 3.5 px and
    // it is the entire reason a prism beam reads as a beam.
    coreI: 6.0, innerI: 0.85, outerI: 0.30,
    coreFall: 0.30, innerFall: 1.2, outerFall: 2.3,
    openMs: 60, closeMs: 180, defaultMs: 1500,
    /** Width breathing +/-8% at 11 Hz, taper 100% -> 88% along the beam. */
    breatheAmp: 0.08, breatheHz: 11, taper: 0.88,
    ramp: 7,
  },
  cryo: {
    corePx: 6.0, innerPx: 14, outerPx: 28,
    coreT: 0.03, innerT: 0.30, outerT: 0.70,
    coreI: 4.5, innerI: 2.0, outerI: 0.8,
    coreFall: 0.35, innerFall: 1.3, outerFall: 2.4,
    openMs: 90, closeMs: 220, defaultMs: 1500,
    breatheAmp: 0.0, breatheHz: 0, taper: 1.0,
    ramp: 7,
  },
  designator: {
    corePx: 3.0, innerPx: 10, outerPx: 22,
    coreT: 0.00, innerT: 0.20, outerT: 0.55,
    coreI: 3.6, innerI: 1.6, outerI: 0.7,
    coreFall: 0.30, innerFall: 1.2, outerFall: 2.2,
    openMs: 80, closeMs: 200, defaultMs: 2000,
    breatheAmp: 0.05, breatheHz: 6, taper: 1.0,
    ramp: 7,
  },
} as const;

/* ---- guns (bible §8.5) -------------------------------------------------- */

/**
 * Muzzle-flash sizes in METRES, not the bible's px. Scorecard #29 asks for
 * ">= 4x barrel diameter"; a 0.30 m MBT barrel therefore needs >= 1.2 m and the
 * measured RA3 frames put a heavy flash at roughly 40-50% of a 7 m hull, which
 * is where these land. Deliberately huge — "do not shrink the muzzle flashes".
 */
export const VFX_GUNS = {
  /**
   * Muzzle flashes, small / medium / heavy.
   *
   * Length keeps the calibre read and the >=4x-barrel contract. Width, lifetime
   * and gain are restrained by weapon class: small and medium shots live below
   * noon bloom, while heavy shots are allowed a compact halo.
   */
  flash: [
    { lenM: 1.20, widM: 0.50, lifeMs: 50, intensity: 0.95, tile: 4 }, // small: 4-point star
    { lenM: 2.00, widM: 1.00, lifeMs: 65, intensity: 1.10, tile: 13 }, // medium: kite
    { lenM: 3.00, widM: 1.30, lifeMs: 80, intensity: 1.45, tile: 4 },  // heavy: big star
  ] as const,
  /** Scale curve: 0 -> 1.0 at 15 ms -> 0.85 -> 0. */
  flashPeakMs: 15, flashSustain: 0.85,
  /**
   * White-hot core disc riding inside the flash, as a fraction of its length.
   *
   * Heavy guns alone add this second core. Routine weapons already carry a
   * white ignition point in the muzzle ramp and must not double their additive
   * layer in formation combat.
   */
  flashCoreFrac: 0.18, flashCoreIntensity: 1.8,
  /** Barrel smoke ribbon: #8A8078 at alpha 0.25 for the first 30% of flight. */
  barrelSmokeAlpha: 0.25,

  /**
   * MG tracer: a slim tapered lozenge. Its gain remains below noon bloom because
   * hundreds can be live at once; motion and colour provide the read.
   */
  tracerLenPx: [20, 50] as const, tracerWidthPx: [1.8, 3.0] as const,
  tracerHeadWidthMul: 1.12, tracerIntensity: 1.05,
  /** Cannon tracer: longer and wider than MG fire, tapering over the last 40%. */
  cannonLenPx: [72, 105] as const, cannonWidthPx: [5, 7] as const,
  cannonIntensity: 1.35,
  /** Travel speed in metres/sec (bible: ~14 TL/s for the main gun). */
  tracerSpeed: 190, cannonSpeed: 98,
  /** About one in six MG rounds is visible in a dense engagement. */
  tracerVisibleFrac: 0.16,
  /**
   * Maximum simultaneous MG/cannon streaks drawn by the ribbon batch. The
   * simulation may keep more rounds alive; this is a presentation budget that
   * prevents two firing lines from turning into a white wireframe cage.
   */
  tracerDrawBudget: 28,

  /** Armour impact: 20-32 straight streaks, 140 deg upward-biased fan. */
  sparkMin: 20, sparkMax: 32,
  sparkLenPx: [45, 130] as const, sparkWidthPx: 1.6,
  sparkFanDeg: 140, sparkLifeMs: 420, sparkSpeed: [9, 26] as const,
  sparkGravity: 14, sparkIntensity: 1.1,
  /**
   * Plus a compact radial flash. It stays beneath bloom so repeated armour hits
   * read as contact points rather than a chain of white discs.
   */
  sparkFlashPx: 12, sparkFlashMs: 45, sparkFlashIntensity: 1.15,
} as const;

/* ---- trails (bible §8.6) ------------------------------------------------ */

/**
 * BEAD CHAINS, never ribbons. Scorecard #31 scans a trail and demands >= 6
 * luminance oscillations of >= 25 L, which only discrete puffs produce.
 * Spacings are in METRES (the bible's "every 14-20 px of travel" at the
 * measured 0.036 m/px of a default-zoom 1440p frame).
 */
export const VFX_TRAIL = {
  coldSpacingM: 0.62, coldSize0: 0.20, coldSize1: 0.52, coldLifeMs: 2600, coldAlpha: 0.85,
  hotSpacingM: 0.52,
  hotFlameSize0: 0.36, hotFlameSize1: 0.95, hotFlameLifeMs: 380, hotFlameIntensity: 3.2,
  hotSmokeSize0: 0.50, hotSmokeSize1: 1.75, hotSmokeLifeMs: 3200, hotSmokeAlpha: 0.62,
  /** Cap on beads laid by one call, so a teleporting projectile cannot spam. */
  maxBeadsPerCall: 12,
} as const;

/* ---- smoke and damage states (bible §8.7 / §8.8) ------------------------ */

export const VFX_SMOKE = {
  /** Bible §8.7 shading pair. Lit smoke = mix(dark, lit, dot(N,L)*0.5+0.5). */
  shadeDark: '#14120F', shadeLit: '#8A857E', rimLit: '#B8B2A6',
  tintGain: 0.62, shadeGain: 0.82, rimGain: 0.30,

  /** A column is 8-14 discrete lobes rising 1.9-2.7 TL, widening >= 3x. */
  lobeMin: 8, lobeMax: 14,
  columnRiseTL: [1.9, 2.7] as const,
  /** Base radius -> top radius. The >= 3x widening is an acceptance test. */
  baseRadiusM: 0.75, topRadiusM: 2.65,
  opacityBase: 0.85, opacityTop: 0.15,
  lobeLifeMs: 4200,

  /** Damage states. Health fraction -> puff interval in ms. */
  wispThreshold: 0.65, wispIntervalMs: 600, wispAlpha: 0.35, wispRiseTL: 0.9,
  burnThreshold: 0.32, burnIntervalMs: 220,
  /** 2-4 flame tongues on the hull, 0.21-0.37 TL tall, flicker 12 Hz. */
  tongueMin: 2, tongueMax: 4, tongueTL: [0.21, 0.37] as const, tongueFlickerHz: 12,
  /** Entities re-scanned per frame for damage FX (round-robin slice). */
  damageScanSlice: 6,
} as const;

/**
 * Low-frequency life around COMPLETE, HEALTHY structures. These are single
 * puffs and tiny process sparks, never damage columns: the purpose is to make
 * a base feel occupied without turning every roof into a wreck or consuming a
 * meaningful share of the particle budget.
 */
export const VFX_BUILDING_LIFE = {
  minHpFraction: 0.82,
  /** Base milliseconds between emissions; per-entity seed adds +/-25%. */
  alliedIntervalMs: 3600,
  sovietIntervalMs: 2100,
  meridianIntervalMs: 2600,
  reclaimIntervalMs: 1700,
  /** Roof socket approximation from the authored footprint. */
  roofBaseM: 3.2,
  roofPerCellM: 1.1,
  steamLifeMs: 1900,
  steamRiseMps: 1.15,
} as const;

/* ---- ground FX (bible §8.10) -------------------------------------------- */

export const VFX_GROUND = {
  dustColor: '#C6C6C0', dustDry: '#B8A484', dustSnow: '#E8ECF0',
  dustAlpha: [0.40, 0.55] as const,
  dustSize0: 0.36, dustSize1: 1.15, dustLifeMs: 2800,
  /** One puff per track every 0.15 s while moving. */
  treadIntervalMs: 150,
  /** On paving: alpha 0.18 and 60% radius. */
  pavingAlphaMul: 0.42, pavingRadiusMul: 0.60,
} as const;
