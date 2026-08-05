/**
 * ============================================================================
 * VOLTMARCH — src/vfx/FlashBudget.ts
 * ============================================================================
 * HOW MUCH GLARE ONE PATCH OF GROUND IS ALLOWED TO EMIT AT ONCE.
 *
 * THE BUG THIS EXISTS TO FIX, AND WHY IT WAS REPORTED FOUR TIMES
 * -------------------------------------------------------------
 * Every previous pass at "explosions are too bright" tuned a SINGLE sprite:
 * `flashIntensity` 7.0 -> 3.5, `billowIntensity` 4.2 -> 2.1, the muzzle core
 * 9.0 -> 4.0, the halo curve in `ADDITIVE_FRAG`. Each of those was correct and
 * each one measured correctly, because each was measured on ONE explosion.
 *
 * The additive layer SUMS. Nothing anywhere bounded the sum. Measured on this
 * renderer (`tools/flash-stack.mjs`, AMD Renoir, 1280x720, unit-parade at the
 * 48 m combat framing), 20 unit-death explosions inside a 4 m radius against
 * the same frame with none:
 *
 *              frame mean L    frame area over L=0.95
 *   baseline       0.395             5.8 %
 *   1 explosion    0.555            14.5 %
 *   20             0.911            65.9 %
 *
 * and with the two summing layers ablated one at a time at n=20:
 *
 *   additive quads only   0.891 mean, 62.6 % blown   (x8.9 the 1-flash area)
 *   point lights only     0.545 mean, 11.4 % blown   (x3.0 the 1-flash area)
 *
 * So two thirds of the frame goes to white paste, the additive quad pile is
 * about three times the offender the light pile is, and the user's own
 * diagnosis — "multiple flash layers on top of each other, and then they cast
 * HUGEEEE FLASH instead of unified one" — is exactly right.
 *
 * WHAT THIS DOES
 * --------------
 * It is a spatio-temporal budget, not a dimmer. An effect asks to emit, naming
 * a COST in unit-death-explosion equivalents; the budget answers with a gain
 * multiplier and charges itself what the effect actually got:
 *
 *     atten = max(FLOOR, 1 - (load / CEIL)^EXP)
 *     load += cost * atten
 *
 * The first effect in a locality always gets `atten` exactly 1.0 — `load` is 0,
 * so the expression is 1 by construction. **A lone explosion, and every
 * explosion that is more than `radiusM` from another one, is bit-identical to
 * before this file existed.** That property is the whole design: the previous
 * fixes failed because they paid for the crowd out of the soloist's budget.
 *
 * Because the charge is itself attenuated, the total emitted glare converges:
 * `load` cannot pass `CEIL` except by the FLOOR trickle, so N co-located
 * explosions emit roughly `CEIL` explosions' worth of light no matter how big N
 * gets. That is "one bright flash", stated as arithmetic.
 *
 * WHY A FLOOR AT ALL
 * ------------------
 * A hard zero makes the 20th fireball invisible and then makes it POP back into
 * existence the moment the budget decays. A 10% floor keeps every detonation on
 * screen as a dark ember-orange mass — which is what a fireball inside a bigger
 * fireball looks like — and costs a bounded trickle.
 *
 * WHAT IS DELIBERATELY *NOT* ATTENUATED
 * -------------------------------------
 * Smoke, dust, debris, scorch and the shockwave's geometry. Those are
 * NORMAL-blended or opaque: they composite towards their own colour instead of
 * summing, so twenty of them cannot exceed the brightness of one (the lit
 * shader's own ceiling, `LIT_FX_MAX`, already pins that) and they are what
 * still reads as "twenty things just died here" when the glare is spent.
 *
 * DETERMINISM AND ALLOCATION
 * --------------------------
 * Render-side only, like everything in src/vfx: `step()` is driven by the VFX
 * system's frame clock, there is no `Math.random`, `Date.now` or
 * `performance.now` anywhere in this file, and the state is four fixed typed
 * arrays allocated at module load.
 * ============================================================================
 */

import { VFX_GLARE } from '../core/config';

/* ==========================================================================
 * State — allocated once, at module load. Never grows.
 * ========================================================================== */

/**
 * Distinct glare centres tracked at once.
 *
 * 24 is chosen against the additive pool rather than by feel: 1200 sprites at
 * ~58 per detonation is ~20 simultaneous detonations, so 24 centres cannot be
 * exhausted by explosions that are genuinely far enough apart to deserve
 * separate budgets. When it IS exhausted the coldest centre is recycled, which
 * costs that locality nothing it was still using.
 */
const SPOTS = 24;

const spotX = new Float32Array(SPOTS);
const spotY = new Float32Array(SPOTS);
const spotZ = new Float32Array(SPOTS);
const spotLoad = new Float32Array(SPOTS);
/** 0 = free. A spot frees itself once its load has decayed to nothing. */
const spotUsed = new Uint8Array(SPOTS);

/** Diagnostics, surfaced through `__vmVfx.stats()` and `__VM.counters`. */
let liveSpots = 0;
/** Cumulative count of emissions that were attenuated (atten < 0.995). */
let attenuated = 0;

/* ==========================================================================
 * The one call every emitter makes
 * ========================================================================== */

/**
 * Ask for permission to add glare at a point, and be told how much of it you
 * may have.
 *
 * @param cost How much glare this emission would add if unattenuated, in
 *             unit-death-explosion equivalents. See `VFX_GLARE.cost`.
 * @returns    A multiplier in `[VFX_GLARE.floor, 1]` to apply to every ADDITIVE
 *             gain of the effect. Exactly 1 for the first effect in a locality.
 */
export function admitGlare(x: number, y: number, z: number, cost: number): number {
  if (!(cost > 0)) return 1;
  const slot = findOrClaimSpot(x, y, z);
  if (slot < 0) return 1;

  const load = spotLoad[slot];
  let atten = 1;
  if (load > 0) {
    const f = load / VFX_GLARE.ceiling;
    // EXP > 1 keeps the curve flat near an empty budget — two tanks dying
    // together must not look like one tank dying and one tank fizzling — and
    // then falls off a cliff as the locality fills up.
    atten = 1 - Math.pow(f, VFX_GLARE.exponent);
    if (atten < VFX_GLARE.floor) atten = VFX_GLARE.floor;
    else if (atten > 1) atten = 1;
  }

  // Charge what was actually emitted, not what was asked for. This is what
  // makes the series converge instead of growing without bound.
  spotLoad[slot] = load + cost * atten;
  if (atten < 0.995) attenuated++;
  return atten;
}

/**
 * The load at a point, in explosion equivalents, without charging anything.
 * For tests and for the diagnostics readout.
 */
export function glareLoadAt(x: number, y: number, z: number): number {
  const r2 = VFX_GLARE.radiusM * VFX_GLARE.radiusM;
  let best = 0;
  for (let i = 0; i < SPOTS; i++) {
    if (spotUsed[i] === 0) continue;
    const dx = x - spotX[i], dy = y - spotY[i], dz = z - spotZ[i];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (spotLoad[i] > best) best = spotLoad[i];
  }
  return best;
}

/**
 * Nearest live spot within `radiusM`, else a fresh one. NEAREST rather than
 * first-within-range on purpose: with first-match, a spot straddling two
 * clusters would swallow whichever cluster it happened to be tested against
 * first and the other one would get its own budget anyway.
 */
function findOrClaimSpot(x: number, y: number, z: number): number {
  const r2 = VFX_GLARE.radiusM * VFX_GLARE.radiusM;
  let best = -1;
  let bestD2 = r2;
  let free = -1;
  let coldest = 0;
  let coldestLoad = Infinity;

  for (let i = 0; i < SPOTS; i++) {
    if (spotUsed[i] === 0) { if (free < 0) free = i; continue; }
    const dx = x - spotX[i], dy = y - spotY[i], dz = z - spotZ[i];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= bestD2) { bestD2 = d2; best = i; }
    if (spotLoad[i] < coldestLoad) { coldestLoad = spotLoad[i]; coldest = i; }
  }
  if (best >= 0) return best;

  const slot = free >= 0 ? free : coldest;
  if (spotUsed[slot] === 0) liveSpots++;
  spotUsed[slot] = 1;
  spotX[slot] = x; spotY[slot] = y; spotZ[slot] = z;
  spotLoad[slot] = 0;
  return slot;
}

/* ==========================================================================
 * Per-frame
 * ========================================================================== */

/**
 * Decay every locality's load. Called once per RENDERED frame by the VFX
 * system, with the same clamped/scaled `dtMs` every other pool gets — so the
 * harness's `timeScale(0)` freezes the budget along with everything else and a
 * scripted capture is reproducible.
 */
export function stepFlashBudget(dtMs: number): void {
  if (liveSpots === 0 || dtMs <= 0) return;
  // Exponential half-life. `halfLifeMs` is set to the fireball's own life, so a
  // locality's budget comes back at the rate the fires in it actually burn out.
  const k = Math.pow(0.5, dtMs / VFX_GLARE.halfLifeMs);
  for (let i = 0; i < SPOTS; i++) {
    if (spotUsed[i] === 0) continue;
    const load = spotLoad[i] * k;
    if (load < VFX_GLARE.retireLoad) {
      spotUsed[i] = 0;
      spotLoad[i] = 0;
      liveSpots--;
    } else {
      spotLoad[i] = load;
    }
  }
}

/** Forget every locality. Between matches, and on teardown. */
export function clearFlashBudget(): void {
  spotUsed.fill(0);
  spotLoad.fill(0);
  liveSpots = 0;
  attenuated = 0;
}

/** Localities currently carrying load. */
export function glareSpotCount(): number {
  return liveSpots;
}

/** Cumulative emissions that were dimmed because their locality was full. */
export function glareAttenuatedCount(): number {
  return attenuated;
}
