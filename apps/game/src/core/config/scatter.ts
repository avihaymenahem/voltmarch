/**
 * Domain-owned config slice: prop scatter and environment presentation.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 20. PROP SCATTER — THE ANTI-EMPTINESS BLOCK        (appended by src/world/**)
 *
 * Bible §14 R3 is rated FATAL and it is exactly this file's numbers:
 *
 *   "Terrain is a big empty plane. Prop scatter is always the last system
 *    written and the first cut. RA3's city reference carries 106 discrete props
 *    on 1.3 hectares; a procedural remake ships 8 rocks."
 *
 * RULING #9 sets the targets: city >= 75/ha, wilderness >= 260/ha. Bible §6.6
 * refines the city figure to >= 105/ha for a plaza and adds the ship-blocking
 * rule (scorecard #15, weight 3): no contiguous walkable region larger than
 * 25 m x 25 m may carry zero props, zero decals and zero texture variation.
 * `Scatter.validateCoverage()` is the automated gate for that rule.
 * ========================================================================== */

/**
 * Culling granularity. Props are bucketed into 32 m chunks and the visible set
 * is recomputed only when the camera's chunk footprint actually changes, so a
 * static camera costs zero per frame and a panning one costs one memcpy of the
 * visible instances. One InstancedMesh per prop type spans the whole 512 m map,
 * so without this every frame would upload ~7000 instances to draw ~200.
 */
export const SCATTER_CHUNK_METRES = 32;

/** Default scatter seed. `?scatterseed=` overrides; the scenario seed wins over both. */
export const SCATTER_SEED = 0x5ca77e;

/**
 * Density targets, props per hectare of ADORNABLE ground (water, cliff, road
 * and base footprints are excluded from the denominator as well as from the
 * placement). Bible §6.6's table, at our targets rather than RA3's measurements.
 */
export const SCATTER_DENSITY = {
  /** Bible §6.6 "City / plaza" — RA3 measured ~80/ha, our target 105/ha. */
  cityPerHectare: 105,
  /** Bible §6.6 "Wilderness / island" — RA3 ~230/ha, ruling #9 target 260/ha. */
  wildernessPerHectare: 260,
  /**
   * The floor `MapPreset.scatter` may not scale below. RULING #9 states the
   * minimum as "city >= 75/ha" and it is a RULING, not a suggestion — a preset
   * asking for scatter 0.6 on an urban map is asking for a mood, not for
   * permission to ship an empty plane.
   */
  hardFloorPerHectare: 95,
  /**
   * Grass tufts are the cheapest possible adornment and they are what actually
   * carries a wilderness map to 260/ha. Capped as a fraction of the total so a
   * map can never be "dense" purely by hiding under a lawn.
   */
  maxGrassFraction: 0.76,
  /**
   * Final wilderness composition target after coverage fill. Reaching this may
   * add more of the existing 8-triangle instances than the normal density
   * budget requested, but never beyond maxProps or the cap above.
   */
  targetGrassFraction: 0.70,
  /** City/plaza endpoint; hard surfaces need street, civic and yard reads instead. */
  urbanGrassFraction: 0.24,
  /**
   * Relative grass weight throughout structured placement and fixed-budget
   * top-up. The two grass families are already-active 8-triangle instanced
   * cards, so this preference trades heavier props for visible ground cover
   * without increasing the type, material or draw-call ceilings.
   */
  grassWeight: 24.0,
  /** Fraction of the budget spent on clustered vegetation vs. scattered singles. */
  clusterFraction: 0.72,
} as const;

/**
 * Per-instance jitter. Bible §6.5 makes this MANDATORY and scorecard #39 checks
 * it: "without hue/value jitter a forest reads as a repeated stamp".
 */
export const SCATTER_JITTER = {
  scaleMin: 0.80,
  scaleMax: 1.25,
  /** Degrees of hue rotation, +/-. */
  hueDeg: 8,
  /** Fractional value spread, +/-. */
  value: 0.18,
  /** Fractional saturation spread, +/-. */
  saturation: 0.12,
  /** Degrees of tilt off vertical, +/-. Yaw is always free 0..360. */
  tiltDeg: 4,
} as const;

/**
 * Clustering. Bible §6.5: "3-9 trees per clump, 4-8 m spacing inside, 20-50 m
 * between clumps. Street rows are regular at 8-12 m pitch, 1.5-2.5 m off the
 * kerb, +/-0.4 m jitter." A uniform Poisson disc is the instant prototype tell.
 */
export const SCATTER_CLUSTER = {
  /** Metres between two clump centres of the same family. */
  betweenClumpsMin: 20,
  betweenClumpsMax: 50,
  /**
   * Low ground cover forms connected islands at a much smaller landscape
   * scale than tree copses. Keeping this separate avoids turning the global
   * canopy rule into a grass-policing number.
   */
  grassBetweenClumpsMin: 11,
  grassBetweenClumpsMax: 22,
  /** >1 biases grass members into a dense core with a loose irregular edge. */
  grassRadialExponent: 1.55,
  /** Street-furniture pitch along a kerb, metres. */
  streetPitchMin: 8,
  streetPitchMax: 12,
  /** Metres a street prop stands back from the kerb line. */
  kerbOffsetMin: 1.5,
  kerbOffsetMax: 2.5,
  /** Positional jitter applied to a street prop, metres. */
  streetJitter: 0.4,
  /** Rejection attempts per member before a clump gives up. */
  attemptsPerMember: 8,
} as const;

/**
 * The 25x25 m ship-blocking rule (bible §6.6, scorecard #15) as an automated
 * gate. `Scatter.validateCoverage()` rasterises adornment at `gridMetres` and
 * reports every fully-unadorned walkable square of `patchMetres`.
 */
export const SCATTER_COVERAGE = {
  /** The rule's own number. A patch strictly larger than this fails. */
  patchMetres: 25,
  /** Rasterisation cell. 2 m over a 512 m map is a 256^2 grid — 64 KB. */
  gridMetres: 2,
  /** Bible §6.6: "target >= 55% of visible ground adorned". */
  targetAdorned: 0.58,
  /**
   * Fill passes generate() runs to close offending patches.
   *
   * Raised from 6. The texture overhaul removed the per-pixel noise that used
   * to count as "texture variation" on bare ground (measured flat-area std-dev
   * on roads fell 5.36 -> 1.77), so ground that was always empty is now VISIBLY
   * empty and `07-soviet-base` started tripping the 25x25 m ship-blocking rule.
   * Six passes were not enough to close the last patch; ten are, with the
   * per-patch count raised too so a single pass can actually fill a 625 m^2
   * square rather than dropping three props in a corner of it.
   */
  fillPasses: 10,
  /** Props placed per offending patch during a fill pass. */
  fillPerPatch: 5,
} as const;

/**
 * Vertex-animated foliage. Bible §6.5: "canopy vertex-shader sine on world XZ,
 * amplitude 0.15 m at 0.25 Hz, per-instance phase; grass tufts 0.06 m at
 * 0.6 Hz. Near-zero cost and its absence reads instantly as static."
 *
 * ONE frequency drives both bands (the amplitude is per-vertex, the frequency
 * is a uniform) because a second frequency would need a second attribute and a
 * second program, and 0.25 vs 0.6 Hz is not a scorecard item.
 */
export const SCATTER_WIND = {
  hz: 0.25,
  canopyAmplitude: 0.15,
  grassAmplitude: 0.06,
} as const;

/** Hard budgets. These exist so scatter can never be the reason a frame drops. */
export const SCATTER_LIMITS = {
  /** Absolute prop ceiling for the whole map. 26.2 ha x 260/ha = ~6800. */
  maxProps: 9000,
  /**
   * Maximum simultaneously-live prop types, i.e. InstancedMeshes. Types past
   * this cap are dropped lowest-count first (`Scatter.trimTypes`).
   *
   * THE COST IS 2N, AND THIS BLOCK SAID 3N. It read "THE ARITHMETIC HERE SAID
   * 2 DRAWS PER TYPE AND IT IS 3", on the grounds that a scatter mesh is opaque
   * on the DEFAULT layer and was therefore also submitted in `GTAOPass`'s
   * normal prepass. That prepass no longer exists: `installAoDepthGBuffer` in
   * `src/render/post.ts` hands GTAO the depth the colour pass already wrote and
   * reconstructs the normals with one full-screen quad, so `_renderGBuffer` is
   * false. Measured, not assumed — `frame.drawCallsByPass.ao` is **0** on all
   * thirteen fixtures in `shots/_report.json`.
   *
   * So it is one colour draw plus one shadow draw per type, and the shadow term
   * is the only one that shrinks: a `castShadow` radius gate drops the shadow
   * draw for props too small to throw anything readable. Never more than 2N.
   *
   * `MAX_DRAW_CALLS` (130) budgets the COLOUR pass alone, which is N of that
   * 2N; `shots/_report.json`'s `frame.drawCalls` is the sum over every scene
   * submission. Quote `frame.drawCallsByPass.colour`, never `frame.drawCalls`.
   *
   * RAISED 22 -> 30, AND THE GAIN IS ONE TYPE TODAY, NOT EIGHT.
   * the visual gap plan P1-9 says the harness logs "8 prop type(s)
   * trimmed" on `03-terrain-closeup` and that raising the cap costs +8 colour
   * draws. Both halves are stale. The eight is the PRE-REORDER figure quoted in
   * `tests/scatter-trim-order.spec.ts`'s header, from when `trimTypes` ran
   * AFTER `fillToTarget` and therefore ranked a set the fill had inflated. With
   * the trim in its current position the same fixture trims ONE type
   * (`roadSignDisc`), measured by replaying its real inputs — scenario
   * `terrain-showcase`, map preset `urban`, biome `temperate`, `?seed=3`, focus
   * box and scenario exclusions included.
   *
   * The cap is not what limits prop variety. Measured over all seven presets,
   * 17-22 archetypes of the 31 defined ever place a single instance, and the
   * ones that never do are hard-surface street furniture on wilderness maps
   * (correct — a parked sedan does not belong in a forest) and slope-gated
   * civic solos. Raising the cap to 31 changes nothing that raising it to 30
   * does not.
   *
   * WHAT IT BUYS IS HEADROOM FOR THE SPLAT FIX. `03-terrain-closeup` currently
   * lands exactly ON 22, and P0-1 takes `SurfaceId.Dirt` from ~2% to ~22% of
   * temperate ground, which makes `containerStack` and both grass tufts legal
   * over far more of the map. That fixture is the one frame in the set that has
   * ever saturated this number, and it is about to saturate it harder.
   *
   * PROJECTION AGAINST THE BUDGET. `03-terrain-closeup` runs the LOWEST colour
   * pass of the thirteen — 51 of 130 — so its worst case at this cap is 51 + 8
   * = 59. The frames that run the highest colour pass (`01`, `02`, `11` at 77)
   * are `allied-base` on a preset that lights 18 types and never trims, so they
   * do not move at all. Even a hypothetical map lighting all 30 lands at ~90.
   */
  maxTypes: 30,
  /**
   * Metres the visible chunk box is grown by, so a prop just outside the
   * frustum still casts its shadow into it. Bible §3.2 puts the sun at 33
   * degrees elevation, so the tallest prop in the roster — a 12.3 m water
   * tower — throws about 19 m. 20 m covers the roster with nothing to spare,
   * which is the point: this margin is multiplied by the whole chunk grid.
   */
  shadowMarginMetres: 20,
} as const;

/**
 * Prop surfaces. Vegetation and stone are NOT painted armour: bible §5.4
 * reserves clearcoat 0.30 for hulls, and a waxy leaf reads as plastic. What
 * props do keep is a live `envMapIntensity` — scorecard #23's silhouette rim is
 * as important on a lamp post as it is on a tank.
 */
export const PROP_MATERIAL = {
  roughness: 0.86,
  metalness: 0.0,
  clearcoat: 0.06,
  clearcoatRoughness: 0.55,
  envMapIntensity: 0.55,
  /** Painted bevel highlight, bible 5.5: base albedo +22% V, -15% S. */
  bevelValueGain: 0.22,
  bevelSaturationLoss: 0.15,
} as const;


/**
 * Emissive gain for lamp heads and signal lenses. Lower than UNIT_MATERIAL's
 * 2.2 because a street lamp is a 0.3 m^2 panel repeated 40 times across a
 * frame, and bible §4.4's bloom threshold is 0.82 — 40 blown lamps would veil
 * the whole plaza, which is the exact failure R5 warns about.
 */
export const PROP_EMISSIVE_GAIN = 1.6;

/**
 * Runtime life encoded in the prop geometry's existing aSurface.x channel.
 * Values <= 1 remain the old steady scalar. Integer bands above that are tiny
 * animated fixtures and cost no extra material or draw call.
 */
export const PROP_LIGHT_ANIM = {
  faultCapableCode: 2,
  signalRedCode: 3,
  signalAmberCode: 4,
  signalGreenCode: 5,
  /** Share of lamp instances whose ballast is faulty. */
  faultyFraction: 0.18,
  faultHashFrequency: 12.9898,
  faultHashScale: 43758.5453,
  /** Two incommensurate rates make short drop-outs instead of a clean pulse. */
  flickerFastRadians: 17.4,
  flickerSlowRadians: 2.3,
  flickerFastPhase: 2.1,
  flickerSlowPhase: 4.7,
  flickerFastThreshold: -0.72,
  flickerSlowThreshold: -0.93,
  faultyFloor: 0.05,
  /** Traffic signals complete one readable phase cycle at this interval. */
  signalCycleSeconds: 10,
  signalRedEnd: 0.42,
  signalAmberEnd: 0.49,
  signalGreenEnd: 0.94,
  signalIdleGain: 0.045,
} as const;

/**
 * The decal pool is split in two so a tank charge cannot evict the road's
 * manholes and the battlefield's scorch marks. Two fields, two draw calls,
 * two eviction policies: the static field holds permanent marks laid once,
 * the track field is a fast ring the treads churn through.
 */
export const DECAL_POOL_STATIC = 384;
export const DECAL_POOL_TRACKS = 640;

/**
 * Road routing. Terrain is authored as discrete terraces (bible §6.4), so a
 * 100 m straight run between two lattice nodes crosses a cliff face far more
 * often than not — the first version of the road generator rejected 21 of 24
 * candidate edges and produced an empty map. Roads are routed with A* over the
 * build grid instead, and these are its knobs.
 */
/**
 * Metres of legal ground kept between a road and the map rim.
 *
 * MUST clear `TERRAIN_BORDER_CELLS * CELL` (8 m) with a cell to spare: terrain
 * makes the outermost two cells impassable, so a border node at 4 m sits on
 * ground no road can legally occupy — which silently killed every arterial and
 * left a third of all seeds with no roads at all.
 */
export const ROAD_MAP_MARGIN = 14;
/**
 * Douglas-Peucker tolerance applied to the A* cell path, in metres. Large on
 * purpose: the point is to collapse the grid's 45/90-degree staircase back
 * into the two or three real turns it stands for, because feeding a staircase
 * into the ribbon builds exactly the axis-aligned road scorecard #32 fails.
 */
export const ROAD_ROUTE_SIMPLIFY = 9;
/** Shortest leg that gets a decorative bend inserted into it, in metres. */
export const ROAD_BEND_MIN_LEG = 14;
/**
 * A straight run at least this long counts as "a straight road" for scorecard
 * #32. Shorter segments are pieces of an arc and pass through every heading.
 */
export const ROAD_STRAIGHT_RUN_METRES = 14;

/**
 * Minimum spacing between road waypoints before the fillet pass, in metres.
 * A fillet radius is capped by the shorter of its two legs, so waypoints
 * closer than this can only host a kink.
 */
export const ROAD_WAYPOINT_SPACING = 13;

/**
 * VFX PointLights per quality tier [Low, Medium, High, Ultra].
 *
 * `QUALITY_PRESETS[t].maxDynamicLights` is the hard renderer budget. Bible
 * §8.9 asks for a pool of 8–12 and scorecard #28 (the ground wash) is judged at
 * High, so High and Ultra both use the bottom of that visual band. The priority
 * and locality-merge policy still chooses the eight most useful simultaneous
 * washes; a larger resident pool made every lit fragment pay for idle slots.
 *
 * Every light in the pool is resident in the scene for the whole match, so this
 * number is baked into `NUM_POINT_LIGHTS` in every shader. Changing it at
 * runtime would recompile the world.
 *
 * WHAT A RESIDENT POINT LIGHT ACTUALLY COSTS
 * ------------------------------------------
 * Measured, in a live match at a fixed 2560x1440 drawing buffer on the
 * reporter's AMD Renoir iGPU, with GPU timer queries and the post chain off so
 * the number is the scene pass alone:
 *
 *     4 resident point lights   29.5 ms
 *     2 resident point lights   25.0 ms
 *     0 resident point lights   19.2 ms
 *
 * **2.57 ms per light per frame at 1440p, whether or not it is emitting.**
 * Three of the four in that capture had intensity exactly 0. The whole scene
 * pass with every light removed is 13.9 ms and with a `MeshBasicMaterial`
 * override it is 2.3 ms — so the frame is not geometry, not draw calls and not
 * overdraw, it is the per-fragment light loop, and each pool slot is 15% of a
 * 60 fps budget on this class of GPU.
 *
 * The residency itself is still right (see above: toggling recompiles), and
 * §8.9's 8–12 band still governs High and Ultra, but twelve resident slots on
 * Ultra contradicted the preset's explicit maximum of eight. One explosion
 * still claims a light at every tier, so scorecard #28 — the ground wash around
 * a SINGLE blast — is unchanged; crowded combat now evicts or merges the ninth
 * claim instead of compiling four permanently resident idle lights into every
 * lit material.
 */
export const VFX_LIGHT_POOL_BY_TIER: readonly number[] = [1, 2, 8, 8];

/**
 * Two junction arms closer than this in heading are treated as ONE.
 *
 * A* routes two different lattice edges through the same terrain gap often
 * enough that a junction ends up with two arms pointing the same way; their
 * mouths overlap, the pad boundary stops being monotonic about the node, and
 * the triangle fan emits inverted faces that render as holes.
 */
export const ROAD_ARM_MERGE_RADIANS = 0.32;
