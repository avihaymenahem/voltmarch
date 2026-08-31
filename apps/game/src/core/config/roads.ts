/**
 * Domain-owned config slice: roads, kerbs and ground decals.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 20. ROADS, KERBS AND GROUND DECALS      (appended by src/world/Roads.ts,
 *                                          src/world/Decals.ts)
 *
 * Bible §6.3 is unusually specific about roads because roads are the single
 * most recognisable "this is Red Alert 3" ground read after the grass hue.
 * Every number below is quoted from it; where I had to choose, the comment
 * says why. Metres and radians throughout, 1 unit = 1 metre.
 * ========================================================================== */

/** Lane width. Bible §6.3: 3.2-3.5 m. 2-lane = 6.8, 4-lane = 13.6. */
export const ROAD_LANE_WIDTH = 3.4;
/** Lanes on an arterial. 4 x 3.4 = 13.6 m carriageway. */
export const ROAD_ARTERIAL_LANES = 4;
/** Lanes on a side street. 2 x 3.4 = 6.8 m carriageway. */
export const ROAD_STREET_LANES = 2;

/**
 * Kerb vertical face height. Bible §6.2: 0.15-0.20 m, and it is REAL GEOMETRY
 * that casts a real shadow — scorecard #33 fails a painted stripe explicitly.
 */
export const ROAD_KERB_HEIGHT = 0.17;
/** Kerb top face width. Bible §6.2: 0.28 m. */
export const ROAD_KERB_TOP = 0.28;
/** Pavement (sidewalk) width outboard of the kerb top. */
export const ROAD_PAVEMENT_WIDTH = 3.2;
/** Metres of pavement outer edge that skirts down to meet the ground. */
export const ROAD_PAVEMENT_SKIRT = 0.45;

/**
 * Junction corner radius band. Scorecard #32 states 4-8 m and it is checked
 * from a screenshot, so the generator measures every arc it emits and warns
 * if one lands outside.
 */
export const ROAD_CORNER_RADIUS_MIN = 4.0;
export const ROAD_CORNER_RADIUS_MAX = 8.0;
/**
 * Radius band for a BEND in the open run of a road (as opposed to a junction
 * corner). Bible §6.3: "every road is a spline with 15-40 m radius bends".
 */
export const ROAD_BEND_RADIUS_MIN = 15;
export const ROAD_BEND_RADIUS_MAX = 40;
/**
 * Minimum degrees a road leg must sit off the world X and Z axes. Scorecard
 * #32's first clause is "no axis-aligned straight road" and a procedural grid
 * defaults to violating it in the most obvious possible way.
 */
export const ROAD_MIN_AXIS_DEGREES = 8;

/** Arc length between ribbon cross-sections. Drives tri count and smoothness. */
export const ROAD_SAMPLE_METRES = 2.0;
/**
 * Metres the road surface floats above the heightfield. 6 cm is invisible at a
 * 39-degree camera and clears the interpolation error of a road-surface mesh
 * whose spans are shorter than the 1 m terrain grid.
 *
 * THIS COMMENT USED TO END "roads only run on ground under ROAD_MAX_SLOPE, so
 * 6 cm clears the worst interpolation error with room to spare", AND THAT WAS
 * FALSE BY TWO ORDERS OF MAGNITUDE. The lift only ever had to cover the error
 * of the mesh that carries it, and that mesh was built edge-to-edge across a
 * 13.6 m carriageway: measured worst case 4.22 m of terrain standing above the
 * tarmac, with a sixth of the road surface underground. `ROAD_CONFORM_METRES`
 * is what makes the sentence true; see `RoadNetwork.conformSpans`.
 */
export const ROAD_SURFACE_LIFT = 0.06;
/**
 * Length of the physical taper at an interior road terminus.
 *
 * A generated arterial is allowed to end when hostile terrain prevents the
 * network from reaching another node. Ending the full-width asphalt, kerb and
 * pavement on one cross-section reads as a missing mesh. Over this distance
 * the whole section narrows and settles into the terrain instead. Border exits
 * and junction mouths never use the taper.
 */
export const ROAD_END_FADE_METRES = 16;
/**
 * Fastest a carriageway half-width may change between centreline samples,
 * metres of width per metre travelled. The raw concave-offset solution can
 * pinch by almost two metres over one 2 m sample; connecting those rows makes
 * a bow-tie quad and the asphalt reads as cracked shards. This rate only ever
 * narrows neighbouring rows, so it cannot violate the bend's safe offset.
 */
export const ROAD_WIDTH_CHANGE_PER_METRE = 0.42;
/**
 * Longest span, in metres, of any edge of a road-surface triangle — carriageway
 * ribbon, junction pad and pavement alike. Below the 1 m terrain grid, so a
 * span cannot chord over a whole heightfield cell.
 *
 * This is a QUALITY knob with a measured gate behind it
 * (`tests/roads-drape.spec.ts`), not a taste one. Raising it puts the road back
 * underground in proportion; the full argument is in `RoadNetwork.conformSpans`.
 */
export const ROAD_CONFORM_METRES = 1.2;
/**
 * Hard ceiling on sub-spans per edge, so a pathological width cannot explode
 * the vertex count. At 1.2 m this binds only above 19.2 m, and the widest thing
 * in the game is a 13.6 m arterial.
 */
export const ROAD_CONFORM_MAX_SPANS = 16;

/** Nodes per axis in the generator lattice. 4 => ~102 m blocks on a 512 m map. */
export const ROAD_LATTICE_N = 4;
/** Lattice jitter as a fraction of spacing. This is what kills the grid read. */
export const ROAD_LATTICE_JITTER = 0.30;
/** Probability a legal non-arterial lattice edge survives into the network. */
export const ROAD_STREET_KEEP = 0.84;
/** Steepest rise/run a road will follow. Above this the route is rejected. */
export const ROAD_MAX_SLOPE = 0.14;
/** Fraction of an edge's samples that may be illegal before it is rejected. */
export const ROAD_EDGE_TOLERANCE = 0.06;

/** Metres per road-mask texel. 2 m matches the terrain splat resolution. */
export const ROAD_MASK_METRES = 2;
/**
 * Movement cost written into `Terrain.costGrid` for a carriageway cell.
 * COST_UNIT is 100, so 72 is a 1.39x speed-up along roads — enough that the
 * flow field prefers them without making off-road travel feel broken.
 */
export const ROAD_MOVE_COST = 72;

/** Zebra crossing: metres from the junction mouth where the bars start. */
export const ROAD_CROSSWALK_START = 3.2;
/** Zebra crossing depth along the road. Bible: bars 0.45-0.60 wide + same gap. */
export const ROAD_CROSSWALK_DEPTH = 4.6;
/** Zebra bar period across the road (bar + gap). */
export const ROAD_CROSSWALK_PERIOD = 1.10;
/** Stop bar width. Bible §6.3: 0.3 m, 1.5 m before the crossing. */
export const ROAD_STOPBAR_WIDTH = 0.30;
export const ROAD_STOPBAR_GAP = 1.5;
/** Metres of kerb top carrying yellow dashes either side of a crossing. */
export const ROAD_KERB_YELLOW_RUN = 7.0;
/** Metres of tangent leg either side of a corner arc that also gets red paint. */
export const ROAD_KERB_RED_RUN = 2.5;

/** Manhole decals: bible §6.3 wants roughly one per 25 m of road. */
export const ROAD_MANHOLE_INTERVAL = 26;
/** Oil-stain decals dropped near junctions, per junction. */
export const ROAD_OIL_PER_JUNCTION = 2;

/**
 * RA3's road palette, authored from bible §6.1/§6.3 — NOT sampled off a
 * screenshot, because a sampled value already carries the sun and the ACES
 * shoulder and feeding it back through our own lighting double-counts.
 * White road paint is #D8D2C8 and never #FFFFFF (§6.1, last line).
 */
export const ROAD_COLORS = {
  asphalt:        '#46464A',
  asphaltShade:   '#33333A',
  asphaltAggr:    '#5A5A60',
  /** Wheel path, +18% L per bible §6.1. */
  wheelPath:      '#57575C',
  centreLine:     '#C9A227',
  laneLine:       '#D8D2C8',
  edgeLine:       '#D8D2C8',
  crosswalk:      '#D8D2C8',
  kerb:           '#C0BAB0',
  kerbShade:      '#8E8880',
  kerbRed:        '#B8382C',
  kerbYellow:     '#E0B12A',
  pavement:       '#9A968C',
  pavementShade:  '#7C786F',
  pavementJoint:  '#6B6058',
} as const;

/** Roughness per road part. Bible §6.1: asphalt 0.75, concrete/sidewalk 0.70. */
export const ROAD_ROUGHNESS = { asphalt: 0.75, kerb: 0.65, pavement: 0.70 } as const;

/**
 * Normal-map strength. Tarmac is FLAT — the relief here is aggregate at a
 * couple of millimetres, and anything stronger turns a 39-degree camera's
 * grazing highlights into a boiling mess.
 */
export const ROAD_NORMAL_SCALE = 0.32;
/** Sidewalk slab size, bible §6.1: 1.2 x 1.2 m with a 0.03 m joint. */
export const ROAD_SLAB_METRES = 1.2;
export const ROAD_SLAB_JOINT = 0.03;

/* ---------------------------------------------------------------- decals -- */

/**
 * Fixed decal pool. Every decal is a slot in ONE shared BufferGeometry, so
 * this is also the whole decal draw budget: 1 draw call, always.
 * At six quads per side the default 512-slot field is 36.9k triangles.
 */
export const DECAL_POOL = 512;
/**
 * Quads per side of a decal patch. 6 => 7x7 vertices => 72 triangles. Three
 * subdivisions let large rotated marks bridge several one-metre heightfield
 * faces and intermittently cross the terrain depth while the camera moved.
 * Six keeps those chords short without pushing either live pool past Uint16.
 */
export const DECAL_GRID = 6;
/**
 * Metres a decal floats above the heightfield.
 *
 * This must clear `ROAD_SURFACE_LIFT` as well as the terrain itself. At 3.5 cm
 * a rotated, terrain-conformed tread could intersect both the one-metre terrain
 * triangles and the 6 cm road ribbon between its sampled vertices. WebGPU then
 * alternated which surface won the depth test as the camera moved, making the
 * mark visibly jitter. Eight centimetres remains visually welded to the ground
 * while leaving a real depth gap on every supported ground surface.
 *
 * The height callback supplied by `roads.system` is the higher of gameplay's
 * bilinear heightfield and `Terrain.drawnHeightAt`. That second surface matters:
 * a half-resolution terrain chunk may differ by 15 cm, so lift alone could not
 * clear it without making every mark visibly hover above ordinary ground.
 */
export const DECAL_LIFT = 0.08;
/**
 * Raster-depth pull for every multiply-blended ground overlay.
 *
 * `polygonOffsetUnits: -3` was effectively no protection on WebGPU: the value
 * is passed directly to `GPUDepthStencilState.depthBias`, where one unit is one
 * integer step of the depth attachment. At the RTS camera distance, three steps
 * are much smaller than the depth delta between the terrain's triangles and a
 * rotated/conformed decal chord. The result was the grey/brown stipple seen on
 * dust, grime and tread patches as the camera moved.
 *
 * A 96-step constant bias plus a modest slope term keeps the overlay in front
 * of the terrain without changing its projected position or disabling depth
 * testing against units and structures. These values are shared by GLSL and
 * node materials so the desktop WebGPU path cannot silently drift.
 */
export const GROUND_OVERLAY_DEPTH_BIAS_FACTOR = -4;
export const GROUND_OVERLAY_DEPTH_BIAS_UNITS = -96;
/** Edge length of the procedural decal atlas (4x4 tiles). */
export const DECAL_ATLAS_SIZE = 512;
/** Slots swept per frame looking for expired decals to collapse. */
export const DECAL_SWEEP_PER_FRAME = 24;

/**
 * Tread marks. Still long-lived enough to describe a manoeuvre, but restrained
 * for dense armoured columns: the former 35 s / x0.72 pair compounded into
 * near-black ribbons wherever several vehicles shared a lane.
 */
export const TREAD_LIFE_SECONDS = 28;
export const TREAD_DARKEN = 0.79;
/** Metres of travel between successive tread stamps. */
export const TREAD_INTERVAL_METRES = 2.6;
/** Track gauge as a fraction of the unit's collision radius. */
export const TREAD_GAUGE_FRACTION = 1.15;
/** Half-length of one tread stamp along the direction of travel. */
export const TREAD_HALF_LENGTH = 1.5;
/** Half-width of one tread strip. Kept near the photographed 0.35 m band. */
export const TREAD_HALF_WIDTH = 0.36;
/** Wheeled units lay a fainter, narrower mark. */
export const TYRE_DARKEN = 0.89;
export const TYRE_HALF_WIDTH = 0.20;
/** On paving, bible §8.10 drops tread alpha to ~0.4 of the dirt value. */
export const TREAD_PAVING_FALLOFF = 0.45;

/**
 * FLOOR on how dark ONE ground decal may make the ground.
 *
 * The decal field is multiply-blended, so overlapping marks compound: five
 * tread stamps from a column running the same lane used to composite as
 * 0.72^5 = 0.19 and four scorches as 0.34^4 = 0.013. Clamping each decal's
 * emitted factor here bounds a single mark and, because the clamp is well
 * above the raw SCORCH_DARKEN of 0.34, it also lifts the exponent base for the
 * overlapping case: 0.45^4 is 0.041 rather than 0.013.
 *
 * Burnt ground in RA3 is dark BROWN, not a hole in the map.
 */
export const DECAL_DARKEN_FLOOR = 0.45;

/** Scorch. Bible §8.10: 1.6-2.4 TL major axis, 1.7:1 aspect, PERMANENT. */
export const SCORCH_HALF_SIZE = 7.0;
export const SCORCH_DARKEN = 0.34;
/** Craters read as a dark bowl with a brighter ejecta ring. */
export const CRATER_HALF_SIZE = 3.2;
export const CRATER_DARKEN = 0.42;
/** Oil stains: 2-5 m ellipses at alpha 0.35 near depots (bible §6.3). */
export const OIL_HALF_SIZE = 1.9;
export const OIL_DARKEN = 0.55;
/** Manhole covers, 0.7 m across. */
export const MANHOLE_HALF_SIZE = 0.42;
/**
 * The mark a track leaves where it flattened somebody (`src/sim/Crush.ts`).
 *
 * DARKER THAN A TREAD, LIGHTER THAN A SCORCH, and only just: 0.54 against
 * TREAD_DARKEN 0.72 and SCORCH_DARKEN 0.34. Ground that has been pressed into
 * is not ground that has been burnt, and `DECAL_DARKEN_FLOOR` is 0.45 — a
 * darker tint here would clamp at the floor across the whole mark and take the
 * cleat rhythm with it, which is the only thing that says "a track did this".
 *
 * SIZED OFF THE TRACK, NOT OFF THE MAN. `CRUSH.stainFrac` takes it from the
 * crusher's hull disc, so a Sledge leaves a wider print than a Warden;
 * this is the FLOOR under that, and it is what a track is wide. The tile's
 * pressed strip covers 0.54 of the patch across and 0.88 along, so a half-size
 * of 0.85 draws a mark ~0.9 m across and ~1.5 m long — one track, one body.
 */
export const SQUISH_HALF_SIZE = 0.85;
export const SQUISH_DARKEN = 0.54;
/** Seconds a crush mark takes to fade. Long, but not permanent like scorch. */
export const SQUISH_LIFE_SECONDS = 90;
/**
 * Street-lamp light pool: bible §6.3 wants a 6-8 m ellipse at alpha 0.25 even
 * in daylight. It is the one decal that BRIGHTENS, which the multiply pipeline
 * expresses as a tint above 1.0 (valid because the main pass is HDR).
 */
export const LIGHT_POOL_HALF_SIZE = 3.6;

/* ------------------------------------------------------- contact darkening -- */

/**
 * THE POOL EVERY UNIT AND STRUCTURE SITS IN. Bible §3.3, scorecard row 13.
 *
 * Not the cast shadow, and not a substitute for it: the bible measured a dark
 * pool present in EVERY reference frame, wider than the geometric shadow, and
 * present even when the unit is already standing inside a large shadow. Its own
 * words for what happens without it are "units without this float", and it
 * calls the layer "one of the highest-value cheap wins" — which is exactly what
 * it is here, at one extra draw call for the entire board.
 *
 * `src/art/UnitFactory.ts` and `src/art/BuildingFactory.ts` both already carry
 * what their headers call "the baked half" of this: a vertex-AO gradient that
 * darkens a hull toward its own skirt. That half stops at the silhouette. This
 * is the other half, on the GROUND, and neither one does the other's job.
 *
 * The colour is the bible's `#101418` verbatim — near-black with a blue lean,
 * so the pool sits in the same hue family as the hemisphere-filled shadows
 * rather than reading as a grey smudge, and `tools/metrics.mjs` scores hue
 * leakage. It is a MULTIPLY factor, not a paint: see `src/render/ContactShadows.ts`.
 */
export const CONTACT_DARKEN_COLOR = '#101418';
/** Bible §3.3: peak alpha 0.35 at the centre of the pool. */
export const CONTACT_DARKEN_PEAK_ALPHA = 0.35;
/**
 * Pool radius as a fraction of the entity's FOOTPRINT LONG AXIS (its full
 * width, not its half-width). Bible §3.3 gives the band 0.55-0.70; 0.65 sits
 * where the pool is unambiguously wider than the hull without reaching the
 * neighbouring unit in a packed formation.
 *
 * For a vehicle of collision radius 2.2 m the footprint is 4.4 m, so the pool
 * is 2.86 m of radius — 5.7 m across under a 4.4 m tank. That is the "wider
 * than its cast shadow" the scorecard checks for.
 */
export const CONTACT_DARKEN_RADIUS_SCALE = 0.65;
/**
 * Fraction of the radius held at full strength before the gradient starts.
 *
 * Same shape as the Scorch tile in `src/world/Decals.ts` (`1 - smoothstep(0.42,
 * 1.0, r)`) and for the same reason: a pool that ramps from the very centre
 * reads as a soft grey disc, and the darkest part of a real contact shadow is
 * the part the object is actually standing on.
 */
export const CONTACT_DARKEN_CORE = 0.34;
/**
 * Metres the pool floats above the heightfield.
 *
 * Kept on its own depth plane. Both layers multiply and multiplication
 * commutes, so whether a contact pool is physically above or below a tread does
 * not change the colour — only the separation matters, because neither writes
 * depth and two differently conformed overlays at one height would z-fight.
 */
export const CONTACT_DARKEN_LIFT = 0.055;
/**
 * Entities whose footprint long axis is under this get no pool at all.
 *
 * A 0.5 m disc is under two pixels at the RTS camera: it cannot read as contact
 * darkening, it can only read as a dirty texel. Same argument as
 * `PROP_SHADOW_MIN_RADIUS` in `src/render/RenderBridge.ts`, one order of
 * magnitude cheaper to enforce.
 */
export const CONTACT_DARKEN_MIN_FOOTPRINT = 1.0;
/** Instances the pool mesh starts with. Grows geometrically, never per spawn. */
export const CONTACT_DARKEN_CAPACITY = 256;
