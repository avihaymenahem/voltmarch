/**
 * Domain-owned config slice: faction architecture and building presentation.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import type { UnitPalette } from './unit-art';

/* ===========================================================================
 * 21. FACTION ARCHITECTURE  (src/art/Building*.ts)
 *
 * APPENDED, never reordered. Bible 5.7 is the law this section encodes:
 * ALLIED = rounded, splayed, cool grey-white ceramic + electric blue, glass,
 * chrome; SOVIET = brutalist chamfered slab, OLIVE #646B33 (scorecard #10,
 * weight 3), riveted plate, capsule corner rails, tapered stacks, bulbous
 * pressure vessels, yellow lattice.
 *
 * Buildings carry ~1.4x a unit's detail density (bible 5.3: units 28-36%,
 * buildings 40-46% Sobel), 5-8% team colour instead of a vehicle's 8-14%
 * (R-T1), and a REAL foundation pad rather than a decal.
 * ========================================================================== */

/**
 * Structure paint. Same shape as `UnitPalette` so one greeble factory serves
 * both, but the values are architectural, not vehicular.
 */
export const RA3_ALLIED_STRUCTURE: UnitPalette = {
  /**
   * White ceramic tile. Lighter than a hull: buildings catch the key.
   *
   * WAS '#BCC6D6' (V 0.839), AND AT THAT VALUE THE GREEBLING WAS BEING
   * TONE-MAPPED OFF. The atlas's whole detail language is multiplicative on
   * this base — cavity recess x0.32, the +16% lip, the +22% V bevel — so the
   * bevel highlight alone lands at `0.839 x 1.22 = 1.024`. That is above 1.0 in
   * ALBEDO, before a single photon: the brightest half of the detail was
   * unrepresentable no matter what the renderer did with it.
   *
   * Measured on the shipped captures, whole frame, pixels with every channel
   * >= 250:
   *
   *     01-establishing-base (Allied)   2.37% clipped white
   *     07-soviet-base       (Soviet)   0.00% clipped white
   *
   * Same generator, same lighting, same fixtures, same atlas code. The only
   * difference is that `RA3_SOVIET_STRUCTURE.base` is '#67702C' at V 0.439 and
   * its panel work reads. **The greebling is not missing — it is clipped**, so
   * the fix is here and NOT in `greeble-gen.ts`. Do not answer a flat-looking
   * Allied facade by adding more panel lines to it.
   *
   * V 0.780 is the SURGICAL value and 0.729 was an over-correction — measured,
   * not guessed. The defect is precisely that `base x 1.22 > 1.0`, so the cure
   * is to get back under 1.0 with headroom, not to go as dark as the Soviets.
   * At 0.780 the bevel lands at 0.951: representable, with real separation from
   * the base instead of a clamp. Dropping to 0.729 instead took the whole top
   * end of the frame with it and pushed `03-terrain-closeup` BELOW scorecard
   * #6's p99 floor — 0.8990 against 0.9000, with `10-selection` -0.021 and
   * `11-dusk-mood` -0.040 alongside it. Highlights have to still reach.
   *
   * The scale factor is applied to all three channels equally, so hue (217) and
   * saturation (0.121) are bit-for-bit what the palette was designed around.
   * This is still the palest army in the game and still unmistakably ceramic
   * rather than Soviet olive.
   */
  base: '#B8BDC6',
  shadow: '#222A36',
  /** Cobalt trim. R-T2: flat slab inserts, never a tint. */
  team: '#315FEA',
  teamSecondary: '#17316F',
  insignia: 'eagle',
  insigniaColor: '#F2F5FA',
  hullNumber: 1949,
  emissive: '#48D7FF',
  /** Chrome, read as a warm grey so it never goes blue steel (bible 5.4). */
  bareMetal: '#39414B',
  trackLink: '#171C24',
  glass: '#102B4B',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  /** Allied architecture is welded and tiled. No rivets, ever. */
  rivets: false,
};

/** SOVIET structures. Olive over concrete, riveted, industrial. */
export const RA3_SOVIET_STRUCTURE: UnitPalette = {
  base: '#5B6132',
  shadow: '#242615',
  team: '#C93336',
  teamSecondary: '#681B1D',
  insignia: 'star',
  insigniaColor: '#E4C300',
  hullNumber: 1917,
  /** The one faction whose accents are orange furnace, not cyan (R-T5). */
  emissive: '#FF8A32',
  bareMetal: '#484238',
  trackLink: '#1D1B18',
  glass: '#241C10',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: true,
};

/**
 * FOUNDATION PADS. Bible 5.7 ALLIED-6 ("flat near-black charcoal slab") and
 * SOVIET-7 ("raised grated steel deck plus a concrete apron with a red star").
 * A separate atlas because the pad is a separate material: ground is roughness
 * 0.88 / env 0.35 with NO clearcoat, and painted armour is 0.52 + clearcoat.
 *
 * The pads are the cheapest chroma in the whole game and were being wasted.
 * Every structure sits on one, so they cover a large, contiguous share of any
 * base shot — and they were pure neutral ('#1E2024' at S 0.10, '#8A867A' at
 * S 0.09). The hue axis is right and stays: Allied slate blue, Soviet warm
 * ochre steel.
 *
 * THE VALUE WAS NOT RIGHT, AND THE SENTENCE THAT USED TO END THIS BLOCK —
 * "Value is unchanged: the Allied slab is still near-black" — was describing
 * the defect as though it were the design. Measured off the shipped captures,
 * as a share of frame and as sRGB luminance:
 *
 *                             01-establishing-base   07-soviet-base
 *     Allied pad, on screen        23  (12.3%)           18
 *     ground IN CAST SHADOW        53                    57
 *     lit ground beside it        106                   103
 *
 * The pad was **2.3x darker than a cast shadow** and 4.6x darker than the
 * ground, over a TWELFTH of the frame. Nothing that dark can read as "occluded
 * ground"; it reads as a hole cut in the map, and that is what it looks like.
 * RA3's aprons are concrete — lighter than the grass around them, with the
 * darkening supplied by CONTACT AO rather than by albedo, which is also what
 * bible §3.3's contact-pool paragraph asks for.
 *
 * The superseded note cited refs/ra3steam_02.jpg. That directory is gitignored
 * and is not on every machine, so this argument deliberately rests on two
 * things that are checkable in-repo instead. The first is the table above. The
 * second is that THREE OF THE FOUR ARMIES ALREADY DISAGREED WITH THE ALLIED
 * VALUE — Soviet '#8A8060' (V 0.54), Meridian '#8E8672' (V 0.56, in
 * Faction3Buildings.ts), Reclamation '#645E6E' (V 0.44, Faction4Buildings.ts)
 * — and the Pact's own comment states the principle outright: "a bone building
 * on a near-black pad reads as a model on a plinth; a bone building on a warm
 * stone pad reads as a building on ground." The Allied pad at V 0.19 was the
 * lone outlier, and it was the one under the whitest buildings in the game.
 *
 * So: base to poured concrete at V 0.66, S 0.20 — pale enough to sit at about
 * the lit ground's luminance, saturated enough to stay unmistakably the blue
 * army's pavement. Every other entry moves with it, because they were all
 * ratios of a near-black base: `bareMetal` and `trackLink` had gone DARKER than
 * concrete would be, and `insigniaColor` has to come down rather than up to
 * keep the stencil readable against a pale slab.
 */
export const RA3_ALLIED_PAD: UnitPalette = {
  base: '#8794A8',
  shadow: '#303845',
  team: '#2A2ED0',
  teamSecondary: '#636F82',
  insignia: 'eagle',
  insigniaColor: '#4A5666',
  hullNumber: 1949,
  emissive: '#8DD9CD',
  bareMetal: '#A9B3BF',
  trackLink: '#5B6573',
  /** Deep cobalt canopy — a named RA3 accent mass, not a dark grey. */
  glass: '#0F2E60',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: false,
};

export const RA3_SOVIET_PAD: UnitPalette = {
  /** Grated steel deck. */
  base: '#8A8060',
  shadow: '#2E2A18',
  team: '#D02E1C',
  /** The apron the star decal is painted onto. */
  teamSecondary: '#B4A87E',
  insignia: 'star',
  /** Bible SOVIET-7 names this colour explicitly. */
  insigniaColor: '#D02E1C',
  hullNumber: 1917,
  emissive: '#FF7A1E',
  bareMetal: '#807656',
  trackLink: '#2A2414',
  glass: '#1E1A16',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: true,
};

export const RA3_STRUCTURE_PALETTE = {
  allies: RA3_ALLIED_STRUCTURE,
  soviets: RA3_SOVIET_STRUCTURE,
} as const;

export const RA3_PAD_PALETTE = {
  allies: RA3_ALLIED_PAD,
  soviets: RA3_SOVIET_PAD,
} as const;

/**
 * Greeble tuning for STRUCTURES.
 *
 * `panelDensity` multiplies the greeble factory's panel-run count. Units ship
 * at 1.0 and measure 29-32% Sobel; scorecard #34 wants 40-46% on buildings,
 * i.e. ~1.4x the edge energy. These two numbers are the measured solution --
 * the Allied figure is higher because Allied architecture carries no rivets
 * and has to reach the band on panel lines and banding strips alone.
 */
export const BUILDING_GREEBLE = {
  /** Structure atlas edge in px at High/Ultra. */
  atlasSize: 512,
  /** The pad atlas is half-size: it is four tiles of flat concrete. */
  padAtlasSize: 256,
  /**
   * MEASURED, not guessed. Sweeping the greeble factory over 1.0..5.0 and
   * running its own Sobel probe gives, on the paintMed tile a wall actually
   * samples: allies 31.1% at 1.0 -> 41.5% at 3.4; soviets 35.9% at 1.0 ->
   * 45.3% at 2.6. Both land inside scorecard #34's 40-46%. Allies need the
   * higher figure because Allied architecture carries no rivets and has to
   * reach the band on panel lines and banding strips alone.
   */
  panelDensityAllies: 1.35,
  panelDensitySoviets: 1.20,
  /** Concrete is jointed, not panelled: a slab tile wants far fewer runs. */
  padPanelDensity: 1.0,
  /**
   * Recess the large architectural volumes behind full-value trim, armour and
   * faction slabs. Pads are ground and explicitly do not receive this tint.
   */
  primaryMassTint: 0.90,
  /** Rivet pitch in atlas px. Bible SOVIET-6: 10-14 px at reference scale. */
  rivetPitchPx: 11,
  /** Deck bolts are sparser than hull rivets. */
  padRivetPitchPx: 14,
  /** Deterministic per-faction generator seeds. Atlases stay diffable. */
  seedAllies: 0x41_2b,
  seedSoviets: 0x50_2b,
  seedPadAllies: 0x41_9d,
  seedPadSoviets: 0x50_9d,
} as const;

/**
 * Scene-light response that belongs to the assembled structure rather than to
 * its generated atlas. Buildings use a quieter, tighter silhouette lift than
 * units: their larger screen footprint already carries readable planes, while
 * the lift only needs to keep a dark roofline from merging into trees or a
 * neighbouring structure. Foundation pads deliberately do not use it.
 */
export const STRUCTURE_MATERIAL = {
  rimColor: '#A9CBE4',
  rimStrength: 0.10,
  rimPower: 4.0,
} as const;

/**
 * GEOMETRY LANGUAGE for structures. Every number is bible 5.7.
 */
export const BUILDING_GEOMETRY = {
  /**
   * Chamfer as a fraction of a mass's smallest dimension. Buildings are ~4x a
   * unit's size, so the unit fractions (10% / 7.5%) would round a 6 m slab into
   * a pillow. These land the same 2-4 px on-screen band scorecard #11 measures.
   */
  chamferFractionAllies: 0.055,
  chamferFractionSoviets: 0.040,
  /** Absolute floor in metres. Never zero -- a razor edge is an automatic fail. */
  chamferMinMeters: 0.06,
  chamferMaxFractionOfMin: 0.28,
  /** V3 spends geometry on primary curvature: smooth at close gameplay zoom. */
  cylSegments: 20,
  /** Corner rails and vessels are silhouette masses, not faceted greebles. */
  railSegments: 20,
  sphereRings: 16,

  /* -- ALLIED 1..6 -------------------------------------------------------- */
  /** Base flares 1.25-1.4x wider than the top. */
  alliedSkirtFlare: 1.30,
  /** Open-topped crown: 0.45-0.55x base width, 0.30x total height. */
  alliedCrownWidth: 0.50,
  alliedCrownHeight: 0.30,
  /** Two broad seams beat four noisy stripes at the game camera. */
  alliedBandCount: 2,
  alliedBandDepth: 0.03,

  /* -- SOVIET 1..7 -------------------------------------------------------- */
  /** 45-degree chamfers on every vertical corner at 6-9% of box width. */
  sovietCornerCut: 0.075,
  /** Fat capsule corner rails, 10-14% of wall height. */
  sovietRailDiameter: 0.12,
  /** Stacks: 8-12% of building width, 35-55% of height above the roof. */
  sovietStackDiameter: 0.10,
  sovietStackRise: 0.45,
  /** Top radius 0.85x base, two red bands. */
  sovietStackTaper: 0.85,
  /** Bulbous pressure vessels, 0.20-0.30x building width. */
  sovietVesselRadius: 0.24,
  /** Yellow lattice: X-braced squares, tube diameter and brace pitch, metres. */
  latticeTube: 0.22,
  latticePitch: 1.9,
  /** Catwalk railings carry three horizontal rails. */
  railingRails: 3,
} as const;

/** Bible 5.7 ground-contact rules, in fractions of the building footprint. */
export const BUILDING_PAD = {
  /** ALLIED-6: extends 8-12% beyond the footprint. */
  alliedOverhang: 0.10,
  /** ALLIED-6: thickness 2-3% of building height. */
  alliedThickness: 0.025,
  /** SOVIET-7: 10-15% beyond, 4-6% of height thick. */
  sovietOverhang: 0.13,
  sovietThickness: 0.05,
  /**
   * How far the pad skirt is extruded DOWN below the model origin, in metres.
   *
   * The bridge instances one shared geometry at the entity position, so a pad
   * cannot be re-meshed per site. A skirt instead guarantees contact: terrain's
   * `isBuildable` only passes cells inside TERRAIN_BUILD_FLATNESS, and the
   * playable swell is +/-0.4-0.8 m over 15-30 m (bible 6.4), so 1.5 m of skirt
   * buries the joint on every legal site with margin. Verified at boot against
   * the live heightfield -- see buildings.system.ts.
   */
  skirtDepth: 1.5,
  /** Metres the pad top sits above the model origin, so it never z-fights. */
  lift: 0.04,
} as const;

/**
 * R8 FOR STRUCTURES. Same idea as UNIT_VALIDATION, different bands, and split
 * three ways because a Construction Yard, a Tesla Coil and a 4 m wall panel
 * are not the same kind of object.
 *
 * ON `dominantFraction`. The unit band (35-50% of the silhouette) is
 * UNSATISFIABLE for architecture and measurement says so: the main slab of
 * every structure in the roster measures 62-96% of its own side elevation,
 * because that is what a building IS. Brutalism is a dominant slab. What R8 is
 * really guarding against here is "three plain boxes", so the check that
 * carries meaning is that SOMETHING other than the biggest block owns a
 * readable slice of the outline — hence a ceiling, not a window. Walls are
 * exempt outright: a wall panel is one slab and pretending otherwise would
 * force decoration onto a piece that is repeated eighty times down a perimeter.
 */
export const BUILDING_VALIDATION = {
  primaryMassMin: 3,
  primaryMassMax: 9,
  /** Discrete readable greeble OBJECTS, by class. A wall panel repeated eighty
   *  times down a perimeter does not want a production structure's clutter. */
  greebleMin: { structure: 8, defence: 5, wall: 3 },
  greebleMax: 26,
  dominantFraction: {
    structure: [0.20, 0.88] as readonly [number, number],
    defence: [0.20, 0.94] as readonly [number, number],
    /** A wall panel is a slab by definition. Not measured. */
    wall: null,
  },
  /**
   * R-T1: team colour as a fraction of SCREEN-PROJECTED surface.
   *
   * 4-10% brackets the bible's 5-8% for a real building. Defences get the
   * wider band deliberately: R-T1's figure is written about a 12 m production
   * structure, and 6% of a 4 m sentry drum is a panel the size of a dinner
   * plate that vanishes at RTS distance. Every RA3 reference frame shows
   * defences banded far more strongly than the base behind them.
   */
  teamFraction: {
    structure: [0.04, 0.10] as readonly [number, number],
    defence: [0.06, 0.18] as readonly [number, number],
    wall: [0.015, 0.10] as readonly [number, number],
  },
  /** R-T4: one insignia per structure. Defences and walls carry none. */
  insigniaCount: 1,
  /**
   * R-T5: emissive windows. Buildings run hotter than units because they have
   * lit interiors. A defence has no interior to light — a sentry drum carries
   * two lamps and correctly measures 0.2% — so it gets its own floor rather
   * than being decorated up to a band written about office blocks.
   */
  emissiveFraction: {
    structure: [0.006, 0.045] as readonly [number, number],
    defence: [0.001, 0.030] as readonly [number, number],
    wall: [0.0005, 0.020] as readonly [number, number],
  },
  /** Scorecard #34: 40-46% on buildings; below the floor it reads untextured. */
  sobelFloor: 0.30,
  sobelTarget: [0.38, 0.47] as readonly [number, number],
  /** Silhouette height must land within this of BUILDING_DIMENSIONS.height. */
  heightTolerance: 0.12,
} as const;

/**
 * ANIMATION. Every one of these is driven per-instance in the vertex/fragment
 * shader off `aState` (hpFrac, buildProgress, selected, seed) plus one shared
 * `uTime` uniform, so an animated base still costs one draw call per part.
 */
export const BUILDING_ANIM = {
  /** Extra metres a structure sinks below its pad at buildProgress 0. */
  riseMargin: 0.6,
  /** Emissive colour of the scan band at the construction cut line. */
  riseBandColor: '#9DFEF5',
  /** Metres of the glowing band that rides the ground cut while building. */
  riseBandMeters: 0.55,
  /** Seconds for one production-bay door cycle. */
  doorPeriodSeconds: 9.0,
  /** Fraction of the cycle the door spends fully open. */
  doorOpenFraction: 0.30,
  /** Radians/second a radar dish sweeps. RA3 dishes are slow and deliberate. */
  dishRadiansPerSecond: 0.55,
  /** Health below which the structure starts sooting. */
  damageOnset: 0.66,
  /** Health below which interior fire shows through the windows. */
  burnOnset: 0.33,
  /** Bible 8.8: damaged structures glow #FFB01E through their windows. */
  burnColor: '#FFB01E',
  /** Flicker rate of that interior fire, Hz. */
  burnFlickerHz: 11,
  /** Soot multiplier applied to albedo at zero health. */
  sootMultiplier: 0.44,
  /** Emissive gain the selection pulse adds, in team colour. */
  selectEmissive: 0.35,
  /** Selection pulse rate, Hz. */
  selectPulseHz: 1.4,
} as const;

/**
 * FROZEN STRUCTURE FOOTPRINTS in cells, exposed so placement can validate
 * without importing geometry. Everything here that also appears in
 * BUILDING_DIMENSIONS agrees with it exactly; the rest are new defences.
 */
export const BUILDING_FOOTPRINTS: Readonly<Record<string, { w: number; h: number; height: number }>> = {
  conYard: { w: 3, h: 3, height: 11.0 },
  powerPlant: { w: 2, h: 2, height: 9.0 },
  barracks: { w: 2, h: 2, height: 6.4 },
  refinery: { w: 3, h: 2, height: 9.0 },
  warFactory: { w: 3, h: 2, height: 8.5 },
  radar: { w: 2, h: 2, height: 12.0 },
  techCentre: { w: 2, h: 2, height: 8.0 },
  /** MUST MATCH `BUILDING_DIMENSIONS.commandPost`. See the note there. */
  commandPost: { w: 2, h: 2, height: 10.5 },
  // MUST MATCH `BUILDING_DIMENSIONS.repairDepot` EXACTLY — same reason the
  // `gate` row states it: `fp()` in the art reads THIS table first while the
  // def's `dim:` reads the other one, so a disagreement gives the sim one
  // footprint and the model another.
  repairDepot: { w: 2, h: 2, height: 6.5 },
  oreSilo: { w: 1, h: 1, height: 5.0 },
  pillbox: { w: 1, h: 1, height: 2.2 },
  aaTurret: { w: 1, h: 1, height: 7.0 },
  sentryGun: { w: 1, h: 1, height: 3.4 },
  teslaCoil: { w: 1, h: 1, height: 9.0 },
  wall: { w: 1, h: 1, height: 2.0 },
  gate: { w: 1, h: 1, height: 3.6 },
};
