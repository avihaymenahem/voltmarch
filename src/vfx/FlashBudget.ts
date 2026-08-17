/**
 * ============================================================================
 * VOLTMARCH — src/vfx/FlashBudget.ts
 * ============================================================================
 * HOW MUCH GLARE ONE PATCH OF GROUND — AND ONE SCREENFUL — MAY EMIT AT ONCE.
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
 * AND THEN IT WAS REPORTED A SEVENTH TIME, BECAUSE ONE RADIUS IS NOT ENOUGH
 * ------------------------------------------------------------------------
 * "flashes become huge again with 100% brightness, cant see nothing in fight".
 * Nothing had regressed — every constant in `VFX_GLARE`, `VFX_LIGHTS` and
 * `VFX_EXPLOSION` is byte-identical from v1.24.0 to v2.12.0, and rebuilding
 * with the pre-v2.11.0 `bloom.radius` 0.70 moves the failing case from 15.580%
 * to 16.003%, i.e. by nothing. The budget had simply never been measured on
 * the case that fails.
 *
 * `VFX_GLARE.radiusM` is 7 m. Every sweep `tools/flash-stack.mjs` has ever run
 * packs its emissions into a 4 m spiral — INSIDE that radius, and inside every
 * `mergeRadius` in the light pool as well. So six passes of measurement all
 * landed on the one configuration both mechanisms bound. A firefight is 30-40 m
 * across, which is one screenful at `CAMERA.defaultDistance`, and out there
 * every detonation got a private budget:
 *
 *   1280x720, DEFAULT 55 m dolly, frame area over L=0.95, baseline 2.430%
 *
 *     one death                    3.991%    +1.56pp
 *     twelve inside 4 m            5.442%    +3.01pp    <- the bounded case
 *     twelve across 18 m          15.580%   +13.15pp    <- what a battle is
 *     twelve across 18 m,
 *       every sprite layer hidden   3.379%    +0.95pp
 *
 * The last row is the load-bearing one: with the additive quads, the lit smoke,
 * the debris and the ribbons all hidden so that only the `LightPool` reaches the
 * frame, twelve spread deaths cost under a point. **The point lights are not the
 * offender and the merge is not brightening without bound.** It is the additive
 * sprite layer, spread over a screenful, exactly as at n=20 co-located.
 *
 * WHAT THIS DOES
 * --------------
 * It is a spatio-temporal budget, not a dimmer, and since the seventh report it
 * is TWO of them at two scales. An effect asks to emit, naming a COST in
 * unit-death-explosion equivalents; each tier answers with a gain multiplier,
 * the two multiply, and each tier charges itself what the effect actually got:
 *
 *     atten_t = max(FLOOR_t, 1 - (load_t / CEIL_t)^EXP_t)
 *     atten   = max(FLOOR, atten_local * atten_wide)
 *     load_t += cost * atten
 *
 * The tiers are `VFX_GLARE` itself (7 m, ceiling 2.4 — one patch of ground) and
 * `VFX_GLARE.wide` (34 m, ceiling 4.0 — one framed view). Neither replaces the
 * other: twelve deaths in 4 m is one fireball and twelve deaths across 34 m is
 * a battle, and a single radius can only give one answer to both.
 *
 * The first effect in an empty frame gets `atten` exactly 1.0 from both tiers —
 * both loads are 0, so both expressions are 1 by construction. **A lone
 * explosion, and every explosion far enough from another one, is bit-identical
 * to before this file existed.** That property is the whole design: the earlier
 * fixes failed because they paid for the crowd out of the soloist's budget.
 *
 * Because each charge is itself attenuated, the total emitted glare converges:
 * neither `load` can pass its `CEIL` except by the FLOOR trickle, so N effects
 * in one engagement emit roughly `CEIL` explosions' worth however big N gets.
 * That is "one bright flash", stated as arithmetic.
 *
 * WHY A FLOOR AT ALL
 * ------------------
 * A hard zero makes the 20th fireball invisible and then makes it POP back into
 * existence the moment the budget decays. A floor keeps every detonation on
 * screen as a dark ember-orange mass — which is what a fireball inside a bigger
 * fireball looks like — and costs a bounded trickle. The floor that is
 * guaranteed to the CALLER is `VFX_GLARE.floor`, applied to the product, so
 * adding the second tier did not quietly halve it.
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
 * `performance.now` anywhere in this file, and the state is a fixed number of
 * typed arrays allocated at module load. `GlareTier` is instantiated exactly
 * twice, at module load, and no method on it allocates.
 * ============================================================================
 */

import { VFX_GLARE } from '../core/config';

/* ==========================================================================
 * One tier of the budget
 * ========================================================================== */

/** The shape both `VFX_GLARE` and `VFX_GLARE.wide` satisfy. */
interface TierConfig {
  readonly radiusM: number;
  readonly ceiling: number;
  readonly exponent: number;
  readonly floor: number;
  readonly halfLifeMs: number;
  readonly retireLoad: number;
}

/**
 * A set of glare centres at ONE spatial scale.
 *
 * Two instances exist and they differ only in their config and their slot
 * count. Everything about the arithmetic — nearest-spot matching, the
 * saturating curve, the exponential decay, coldest-slot recycling — is
 * identical, which is the point: the seventh report's fix is the mechanism that
 * already worked, applied at the scale the complaint is actually about.
 */
class GlareTier {
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly load: Float32Array;
  /** 0 = free. A spot frees itself once its load has decayed to nothing. */
  private readonly used: Uint8Array;

  /** Spots currently carrying load. */
  live = 0;

  constructor(private readonly cfg: TierConfig, private readonly slots: number) {
    this.x = new Float32Array(slots);
    this.y = new Float32Array(slots);
    this.z = new Float32Array(slots);
    this.load = new Float32Array(slots);
    this.used = new Uint8Array(slots);
  }

  /**
   * Nearest live spot within `radiusM`, else a fresh one. NEAREST rather than
   * first-within-range on purpose: with first-match, a spot straddling two
   * clusters would swallow whichever cluster it happened to be tested against
   * first and the other one would get its own budget anyway.
   */
  claim(x: number, y: number, z: number): number {
    const r2 = this.cfg.radiusM * this.cfg.radiusM;
    let best = -1;
    let bestD2 = r2;
    let free = -1;
    let coldest = 0;
    let coldestLoad = Infinity;

    for (let i = 0; i < this.slots; i++) {
      if (this.used[i] === 0) { if (free < 0) free = i; continue; }
      const dx = x - this.x[i], dy = y - this.y[i], dz = z - this.z[i];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= bestD2) { bestD2 = d2; best = i; }
      if (this.load[i] < coldestLoad) { coldestLoad = this.load[i]; coldest = i; }
    }
    if (best >= 0) return best;

    const slot = free >= 0 ? free : coldest;
    if (this.used[slot] === 0) this.live++;
    this.used[slot] = 1;
    this.x[slot] = x; this.y[slot] = y; this.z[slot] = z;
    this.load[slot] = 0;
    return slot;
  }

  /**
   * The multiplier this spot's current load implies. Exactly 1 on an empty
   * spot, which is what makes a lone effect bit-identical to no budget at all.
   */
  atten(slot: number): number {
    const load = this.load[slot];
    if (!(load > 0)) return 1;
    const f = load / this.cfg.ceiling;
    // EXP > 1 keeps the curve flat near an empty budget — two tanks dying
    // together must not look like one tank dying and one tank fizzling — and
    // then falls off a cliff as the spot fills up.
    let a = 1 - Math.pow(f, this.cfg.exponent);
    if (a < this.cfg.floor) a = this.cfg.floor;
    else if (a > 1) a = 1;
    return a;
  }

  /**
   * Charge what was actually emitted, not what was asked for. This is what
   * makes the series converge instead of growing without bound — and it is why
   * the charge is the PRODUCT of both tiers' attenuations rather than this
   * tier's own: a fireball dimmed to a tenth by the frame-wide tier must not
   * cost the patch of ground under it a full detonation.
   */
  charge(slot: number, amount: number): void {
    this.load[slot] += amount;
  }

  /** The load at a point, without claiming or charging anything. */
  loadAt(x: number, y: number, z: number): number {
    const r2 = this.cfg.radiusM * this.cfg.radiusM;
    let best = 0;
    for (let i = 0; i < this.slots; i++) {
      if (this.used[i] === 0) continue;
      const dx = x - this.x[i], dy = y - this.y[i], dz = z - this.z[i];
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (this.load[i] > best) best = this.load[i];
    }
    return best;
  }

  step(dtMs: number): void {
    if (this.live === 0 || dtMs <= 0) return;
    // Exponential half-life. See the two `halfLifeMs` notes in config.ts: the
    // locality's is the fireball's own life, the engagement's is a volley.
    const k = Math.pow(0.5, dtMs / this.cfg.halfLifeMs);
    for (let i = 0; i < this.slots; i++) {
      if (this.used[i] === 0) continue;
      const load = this.load[i] * k;
      if (load < this.cfg.retireLoad) {
        this.used[i] = 0;
        this.load[i] = 0;
        this.live--;
      } else {
        this.load[i] = load;
      }
    }
  }

  clear(): void {
    this.used.fill(0);
    this.load.fill(0);
    this.live = 0;
  }
}

/* ==========================================================================
 * State — allocated once, at module load. Never grows.
 * ========================================================================== */

/**
 * Distinct glare centres tracked at once, per tier.
 *
 * 24 localities is chosen against the additive pool rather than by feel: 1200
 * sprites at ~58 per detonation is ~20 simultaneous detonations, so 24 centres
 * cannot be exhausted by explosions that are genuinely far enough apart to
 * deserve separate budgets. When it IS exhausted the coldest centre is
 * recycled, which costs that locality nothing it was still using.
 *
 * 8 ENGAGEMENTS, because a 34 m radius is a screenful and eight screenfuls is
 * most of a 512 m map. The recycle rule matters more here than it does above —
 * a recycled spot has its load reset, which is a hole in the bound — so this is
 * deliberately generous relative to how many separate battles can exist.
 */
const SPOTS = 24;
const WIDE_SPOTS = 8;

const local = new GlareTier(VFX_GLARE, SPOTS);
const wide = new GlareTier(VFX_GLARE.wide, WIDE_SPOTS);

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
 *             gain of the effect. Exactly 1 for the first effect in an
 *             otherwise quiet frame.
 */
export function admitGlare(x: number, y: number, z: number, cost: number): number {
  if (!(cost > 0)) return 1;
  const near = local.claim(x, y, z);
  const far = wide.claim(x, y, z);

  // BOTH tiers, multiplied. A patch of ground that is quiet inside a battle
  // that is not still pays the battle's price, and vice versa.
  let atten = local.atten(near) * wide.atten(far);
  // The floor the CALLER is promised is the single one in `VFX_GLARE`, applied
  // to the product. Multiplying two per-tier floors would have silently taken
  // the guaranteed minimum from 6% to 0.18%, i.e. to invisible, which is the
  // one thing the floor exists to prevent.
  if (atten < VFX_GLARE.floor) atten = VFX_GLARE.floor;

  const charged = cost * atten;
  local.charge(near, charged);
  wide.charge(far, charged);
  if (atten < 0.995) attenuated++;
  return atten;
}

/**
 * The LOCALITY load at a point, in explosion equivalents, without charging
 * anything. For tests and for the diagnostics readout.
 */
export function glareLoadAt(x: number, y: number, z: number): number {
  return local.loadAt(x, y, z);
}

/** The ENGAGEMENT load at a point. @see glareLoadAt */
export function glareWideLoadAt(x: number, y: number, z: number): number {
  return wide.loadAt(x, y, z);
}

/* ==========================================================================
 * Per-frame
 * ========================================================================== */

/**
 * Decay every spot's load, at both scales. Called once per RENDERED frame by
 * the VFX system, with the same clamped/scaled `dtMs` every other pool gets —
 * so the harness's `timeScale(0)` freezes the budget along with everything else
 * and a scripted capture is reproducible.
 */
export function stepFlashBudget(dtMs: number): void {
  local.step(dtMs);
  wide.step(dtMs);
}

/** Forget every locality and every engagement. Between matches, and on teardown. */
export function clearFlashBudget(): void {
  local.clear();
  wide.clear();
  attenuated = 0;
}

/** Localities (7 m) currently carrying load. */
export function glareSpotCount(): number {
  return local.live;
}

/** Engagements (34 m) currently carrying load. */
export function glareEngagementCount(): number {
  return wide.live;
}

/** Cumulative emissions that were dimmed because their locality was full. */
export function glareAttenuatedCount(): number {
  return attenuated;
}
