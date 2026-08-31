/**
 * Domain-owned config slice: unit palettes, geometry and validation.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 20. UNIT ART — RA3 CONFORMANCE BLOCK              (appended by src/art/**)
 *
 * Sections 1-19 above are the foundation's numbers and are never reordered or
 * edited. This block is APPENDED and holds the numbers that RA3_LOOK_BIBLE.md
 * makes normative for UNIT MODELS specifically. Where a value here disagrees
 * with a section above, the bible wins for units and only for units:
 *
 *   - SOVIETS_LOOK.armorBase is '#5A4038' (a brown). The bible's ruling
 *     "Soviets are olive-green #646B33, not grey" is scorecard item #10 at
 *     weight 3, and RA3_SOVIET below carries the olive. Buildings and VFX may
 *     keep using FACTION_PALETTE; unit hulls use this.
 *   - UNIT_DIMENSIONS.infantry.h is 1.75 m. Bible R-S4 puts infantry at
 *     0.30-0.38 x a 7 m MBT hull, i.e. 2.1-2.7 m. UNIT_LADDER uses 2.2 m.
 *     A 1.75 m soldier next to a 7 m tank is 0.25 and reads as ants.
 * ========================================================================== */

/**
 * The RA3 unit palette. One entry per faction-class of hull.
 *
 * `base` is the NON-TEAM paint and must never be a faction colour: R12 says
 * `material.color = factionColour` is the failure mode that blurs the armies,
 * and the fix is 8-14% flat team slabs over an olive/grey/white base.
 */
export interface UnitPalette {
  /** Hull paint. Never a team colour. */
  base: string;
  /** Colour a recess is driven toward. */
  shadow: string;
  /** The flat slab colour. Reachable ONLY through the teamSlab surface. */
  team: string;
  /** Insignia field (the disc behind the glyph). */
  teamSecondary: string;
  /** Which glyph the single insignia decal carries (R-T4). */
  insignia: 'star' | 'eagle' | 'none';
  /** Insignia glyph colour. */
  insigniaColor: string;
  /** Deterministic hull-number stencil. Shared by the faction's whole atlas. */
  hullNumber: number;
  /** Emissive accents: cyan for everyone but the Soviets (bible R-T5). */
  emissive: string;
  /** Warm grey-brown. S <= 0.26. Never blue steel. */
  bareMetal: string;
  trackLink: string;
  glass: string;
  /** Stencil paint. Never pure white. */
  stencil: string;
  hazard: string;
  /** Soviets rivet every seam; Allies never do (bible 5.7). */
  rivets: boolean;
}

/**
 * ALLIES — cool grey-white hull, electric blue slabs, white eagle.
 *
 * `base` and `shadow` were '#B9BCC4' / '#33363E', both S 0.04-0.18, i.e. grey
 * with a rumour of blue. They are the largest field on the model. Pushed onto
 * a real cool axis (S 0.14 / 0.38) at the same value, which is what makes the
 * hull read as painted white-blue ceramic instead of primer. See the CHROMA
 * BUDGET note in §6.
 */
export const RA3_ALLIES: UnitPalette = {
  // Leave real headroom for the atlas's +22% bevel patch and the warm noon
  // key. The previous near-white base reached 99.6% value in albedo before it
  // was lit, flattening layered armour into one white mass.
  base: '#B3BDC9',
  shadow: '#222A36',
  team: '#315FEA',
  teamSecondary: '#17316F',
  insignia: 'eagle',
  insigniaColor: '#F2F5FA',
  hullNumber: 4172,
  emissive: '#48D7FF',
  bareMetal: '#343B45',
  trackLink: '#141920',
  /** Deep cobalt canopy — a named RA3 accent mass, not a dark grey. */
  glass: '#102B4B',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: false,
};

/**
 * SOVIETS — OLIVE hull (scorecard #10), red slabs, gold star on red.
 *
 * `base` moved '#646B33' -> '#67702C'. Same colour to the eye — still the
 * bible's olive-green, still scorecard #10 — but two measured problems fixed:
 *
 *   1. HUE. '#646B33' sits at 95 degrees. Scorecard #9 fails any frame with
 *      more than 2% of pixels in the 100-120 "amateur emerald" window, and a
 *      95-degree olive under a cool ambient walks straight into it: the Soviet
 *      base shot measured 8.8% leak. '#67702C' is 86 degrees — the same
 *      distance from emerald that the temperate grass layer deliberately keeps.
 *   2. CHROMA. S 0.52 -> 0.61, on the single biggest field on a Soviet hull.
 */
export const RA3_SOVIETS: UnitPalette = {
  base: '#5B6132',
  shadow: '#242615',
  team: '#C93336',
  teamSecondary: '#681B1D',
  insignia: 'star',
  insigniaColor: '#E4C300',
  hullNumber: 8188,
  /** The one faction whose accents are orange furnace, not cyan. */
  emissive: '#FF8A32',
  bareMetal: '#484238',
  trackLink: '#1D1B18',
  glass: '#241C10',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: true,
};

/** NEUTRAL / civilian — warm off-white, no team colour, no insignia. */
export const RA3_NEUTRAL: UnitPalette = {
  base: '#9A9074',
  shadow: '#332E22',
  team: '#C8C4B8',
  teamSecondary: '#8A8478',
  insignia: 'none',
  insigniaColor: '#D8D2C8',
  hullNumber: 1063,
  emissive: '#FFC64A',
  bareMetal: '#61503A',
  trackLink: '#281A11',
  glass: '#2A2A28',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: false,
};

export const RA3_UNIT_PALETTE = {
  neutral: RA3_NEUTRAL,
  allies: RA3_ALLIES,
  soviets: RA3_SOVIETS,
} as const;

/**
 * RULING #3 — the single most important material decision in the project.
 * A broad diffuse lobe under a weak tight clear coat is what makes RA3 armour
 * read as painted plastic rather than as matte plastic or as car paint.
 * R10: these are consumed ONLY through the factory in src/art/UnitFactory.ts.
 * `envMapIntensity` is never 0 — that kills the silhouette rim (scorecard #23).
 */
/**
 * THE INFANTRY WALK CYCLE. Read `src/render/Gait.ts` before touching these.
 *
 * "Troops walking animation doesnt exist at all" — and the machinery to say so
 * had been in the engine since the foundation commit: `RenderPhase.UnitAnim`,
 * the `animClip` / `animTime` columns, a write-ownership row assigning them to
 * "unit-art", and a save-game column. Nothing wrote them and nothing registered
 * at that phase.
 *
 * The swing is a vertex-shader rotation about a baked per-vertex pivot, because
 * infantry are one merged instanced mesh and must stay that way — 200 units at
 * 60 fps under 130 draw calls does not survive a joint hierarchy per soldier.
 */
export const UNIT_GAIT = {
  /**
   * Peak limb swing, radians. 0.42 rad is 24 degrees.
   *
   * A real walking stride swings the thigh about 30 degrees, but a rifleman is
   * 37 px tall at the default camera and the leg is a third of that: past ~25
   * degrees the foot leaves the ground plane by more than a pixel and the model
   * reads as marching through the air. This is the largest value that still
   * looks planted at `CAMERA.defaultDistance`.
   */
  swingRadians: 0.42,
  /**
   * Metres of ground covered per FULL cycle (two steps).
   *
   * Not a free parameter — it is what stops the feet skating. At `gi`'s 3.2 m/s
   * this gives 1.52 cycles/s, a brisk march, and because the phase is driven by
   * actual speed rather than by a timer a unit slowed by terrain or crowding
   * takes visibly shorter steps instead of moonwalking.
   */
  strideMetres: 2.1,
  /**
   * Below this speed the unit is standing, m/s.
   *
   * Deliberately well above zero: steering jitter leaves a "stopped" unit with
   * a few cm/s of residual velocity forever, and a soldier twitching his legs
   * in place is worse than one standing still.
   */
  idleSpeed: 0.35,
  /**
   * Cycles per second the phase unwinds toward neutral once stopped.
   *
   * `sin` is zero at phase 0 and 0.5, so both are legs-together; the settle
   * runs to whichever is nearer. Without this a unit freezes mid-stride with
   * one leg out in front, which is the single most obviously-broken thing a
   * walk cycle can do and is what "animation" usually looks like when someone
   * wires the phase and forgets the exit.
   */
  settleRate: 2.4,
} as const;

export const UNIT_MATERIAL = {
  /** Painted hull. 60-75% of a unit's surface. */
  paintRoughness: 0.58,
  paintMetalness: 0.0,
  clearcoat: 0.14,
  clearcoatRoughness: 0.38,
  envMapIntensity: 0.58,
  /**
   * A narrow sky-coloured Fresnel lift on the GEOMETRIC silhouette. This is
   * deliberately separate from the environment specular: it survives on dark
   * hulls and in crowded battles, but uses the unperturbed normal so panel and
   * rivet normals never turn into glowing texture noise.
   */
  rimColor: '#A9CBE4',
  rimStrength: 0.18,
  rimPower: 3.5,
  /** Barrels, tracks, rollers. 12-20% of surface. */
  bareMetalRoughness: 0.38,
  bareMetalMetalness: 0.72,
  bareMetalEnv: 0.82,
  /** Canopies. 1-3% of surface. */
  glassRoughness: 0.10,
  glassClearcoat: 0.60,
  glassEnv: 1.00,
  /** Emissive gain. Small MASKED panels only — 2.6 over a whole surface veils
   *  the frame to white, which is the failure the foundation warns about. */
  emissiveIntensity: 1.55,
  /**
   * Normal map XY gain.
   *
   * Halved from 0.85. That number was tuned when the greeble height field was
   * largely per-pixel noise and the gain was doing the work of making the noise
   * visible. The height field is now structural — panel seams, rivet rings,
   * grilles — and at 0.85 those read as embossed rubber: every seam throws a
   * lit lip and a dark trough two or three times deeper than the 1-2 mm of real
   * relief they stand for. 0.36 keeps the seam, loses the puffiness, and still
   * gives the rebuilt panels more light response than the previous 0.28.
   */
  normalScale: 0.36,
} as const;

/** Canvas-greeble tuning. Every number here changes pixels in the atlas. */
export const UNIT_GREEBLE = {
  /** Atlas edge in px at High/Ultra. Low/Medium halve it. */
  atlasSize: 512,
  /** UV inset per tile, as a fraction of the tile edge. Stops mip bleed. */
  tileInsetFraction: 0.0625,
  /** The clean square each tile reserves for chamfer strips to sample. */
  bevelPatchFraction: 0.10,
  /** Panel-line width as a fraction of the tile edge (~2 px at 128). */
  panelLineWidthFraction: 0.016,
  /** Rivet pitch in atlas px. Bible: 10-14 px at reference scale. */
  rivetPitchPx: 12,
  /** Height relief passed to normalFromHeight. */
  normalRelief: 2.6,
  /** Cavity neighbourhood radius in px. */
  cavityRadiusPx: 3,
  /** Recess albedo multiplier. Bible 5.5: 0.28-0.38, the ONLY wear allowed. */
  cavityMultiplier: 0.32,
  /** Painted bevel highlight: +22% value, -15% saturation (bible 5.5). */
  bevelValueGain: 0.22,
  bevelSaturationLoss: 0.15,
  /** Vertex-colour darkening on undersides and mass seams. */
  cavityVertexTint: 0.74,
  /**
   * Major silhouette volumes sit behind their full-value applied armour.
   * This is a vertex tint, not a second material or a grime layer: it creates
   * the broad 5-7 colour-block hierarchy that survives at gameplay zoom.
   */
  primaryMassTint: 0.86,
} as const;

/**
 * GEOMETRY LANGUAGE. Bible 5.5: "Every convex edge gets a chamfer of 1.5-3% of
 * the part's smallest dimension." A hard BoxGeometry edge is scorecard #11, an
 * automatic fail. `MIN_CHAMFER` above (0.02 m) is the absolute floor.
 */
export const UNIT_GEOMETRY = {
  /**
   * Chamfer as a fraction of a part's smallest dimension.
   *
   * The bible states this twice and the two statements disagree: 5.5 says
   * "1.5-3% of the part's smallest dimension" AND "2-4 px on screen". At the
   * default zoom a 7 m tank is 207 px wide (bible 2), i.e. 29.6 px/m, so 2-4 px
   * is 0.068-0.135 m. A 0.95 m thick hull plate at 3% would give 0.028 m =
   * 0.8 px, which is invisible and fails scorecard #11. The PIXEL figure is the
   * one a critic can actually see, so these fractions are solved from it and
   * the floor/cap keep small greebles and huge plates sane.
   */
  chamferFractionAllies: 0.100,
  chamferFractionSoviets: 0.075,
  /** Absolute floor in metres — 1 px on an infantryman. Never zero. */
  chamferMinMeters: 0.035,
  /** Hard clamp so a chamfer can never round the part into a pill. */
  chamferMaxFractionOfMin: 0.30,
  /** V3 buys smooth primary forms; 20-24 remains cheap beside world geometry. */
  cylSegments: 20,
  sphereSegments: 24,
  sphereRings: 16,
  /** Tracks protrude 8-14% of hull width outboard, 18-25% of unit height. */
  trackOutboardFraction: 0.11,
  trackHeightFraction: 0.22,

  /**
   * HOW THE RUNNING GEAR DIVIDES ITS X FOOTPRINT, inboard -> outboard. The four
   * fractions sum to exactly 1, and `Shapes.trackAssemblyMesh` lays the assembly
   * out so its built AABB is exactly the `MassDef.size` box it was given —
   * `fitMesh` then scales X by 1.000 instead of squashing it.
   *
   * THIS IS THE FIX FOR A REAL DEFECT. The road wheels used to be authored
   * INBOARD of the band ("road wheels proud of the inboard face"), which put
   * them at worldX [1.032, 1.297] behind a band at [1.345, 1.855] on the
   * Guardian — enclosed by the band outboard, the hull above and the far track
   * inboard, so their visible area was ZERO on every Allied/Soviet tracked unit.
   * VISUAL_DNA S5 and scorecard C16 (x2) both require "a 3-4 px dark band along
   * the lower edge with 5-7 bright road-wheel dots"; the roster shipped none.
   *
   * So every hub — road wheels, drive sprocket, idler and return rollers — now
   * shares one plane `trackHubProudFraction` OUTBOARD of the band's outer face,
   * and the skirt clears that plane by `trackSkirtGapFraction`. The wheel discs
   * are `capSlot` ('bareMetal') caps facing straight out at the camera, standing
   * on a `slot` ('tread') band. That is the dot row, in geometry.
   */
  trackBandFraction: 0.750,
  trackHubProudFraction: 0.075,
  trackSkirtGapFraction: 0.025,
  trackSkirtFraction: 0.150,
  /**
   * The band alone, as a fraction of hull width per side. A real MBT runs
   * ~0.6 m of track on a ~3.7 m hull, i.e. 0.16, and that is what the roster
   * measured before the layout above existed (Guardian 0.510 m on 3.2 m =
   * 0.159). `UnitDefs.runningGear` divides by `trackBandFraction` to get the
   * mass's full X size, so the band width survives the relayout unchanged.
   */
  trackBandFractionOfHull: 0.16,
} as const;

/**
 * R8 — REJECT AT BUILD TIME, NOT IN REVIEW.
 *
 * Note on `dominantCentreY`: the bible pairs "the dominant feature is 35-50% of
 * projected area" with "centre of visual mass at 60-70% of unit height". Those
 * are one rule — it is the DOMINANT MASS whose centre must sit at 0.60-0.70.
 * (An area-weighted centroid over every mass cannot exceed ~0.5 for anything
 * that touches the ground; a uniform box scores exactly 0.50.) The area-
 * weighted centroid is still measured and reported as `centroidY`.
 */
export const UNIT_VALIDATION = {
  primaryMassMin: 3,
  primaryMassMax: 6,
  greebleMin: 6,
  greebleMax: 12,
  dominantFractionMin: 0.35,
  dominantFractionMax: 0.50,
  dominantCentreMin: 0.60,
  dominantCentreMax: 0.70,
  turretWidthMin: 0.75,
  /** Broad modern casemates may reach the hull shoulders; never overhang them. */
  turretWidthMax: 1.00,
  /** R-T1: team colour as a fraction of surface area. */
  teamFractionVehicle: [0.08, 0.14] as readonly [number, number],
  teamFractionInfantry: [0.20, 0.28] as readonly [number, number],
  /** R-T4: exactly one insignia decal per unit. */
  insigniaCount: 1,
  /**
   * R-T5: emissive accents occupy 1-3% of surface.
   *
   * Measured against TOTAL triangle area, which includes faces that are never
   * visible (a slab's back, a box's underside, the inboard wall of a track), so
   * the same unit reads roughly 1.6x higher against visible area alone. The
   * floor is set at 0.5% for that reason. Under-shooting is the safe direction:
   * an unmasked emissive at 2.6 veils the whole frame to white.
   */
  emissiveFraction: [0.005, 0.03] as readonly [number, number],
  /** Scorecard #34: below this the unit reads as an untextured primitive. */
  sobelFloor: 0.22,
  sobelTarget: [0.28, 0.36] as readonly [number, number],
  /** Bible 5.4 surface shares, measured in SCREEN-PROJECTED area. */
  paintFraction: [0.50, 0.80] as readonly [number, number],
  /** Barrels, tracks, rollers, intake grilles. Bible 5.4 says 12-20%; the band
   *  is widened at the bottom because infantry legitimately carry almost none. */
  bareMetalFraction: [0.05, 0.34] as readonly [number, number],
} as const;

/**
 * THE SCALE LADDER (bible 5.2). 1 unit = 1 m and MBT hull = 7 m is law; every
 * number here is derived from it. Units are DELIBERATELY oversized — a tank
 * hull is >= 0.45x a production structure's footprint long axis (a War Factory
 * is 3 cells = 12 m, so 7/12 = 0.58).
 */
export const UNIT_LADDER = {
  /** The reference length. Everything else is a ratio of this. */
  mbtHullMeters: 7.0,
  /** R-S4: infantry stand 0.30-0.38x the MBT hull. 2.2 / 7.0 = 0.314. */
  infantryHeightMeters: 2.2,
  infantryWidthMeters: 0.78,
  /** Walkers stand taller than infantry but below a tank's length. */
  walkerHeightMeters: 4.4,
  /** Vehicle silhouette height as a fraction of hull length. */
  vehicleHeightFraction: 0.36,
  /** Superstructure occupies the TOP 55-65%; chassis is a thin 35-45% base. */
  chassisHeightFraction: 0.40,
  /** Turret ring diameter over hull width (bible: build turrets too big). */
  /** Measured against the OVER-TRACKS width, which is what a critic sees.
   *  1.02 of the hull box lands at ~0.84 over tracks — the RA3 read where a
   *  Hammer's turret is visually as wide as its hull. */
  turretWidthOverHull: 1.02,
} as const;
