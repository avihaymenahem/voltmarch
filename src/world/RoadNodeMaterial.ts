/**
 * ============================================================================
 * VOLTMARCH — src/world/RoadNodeMaterial.ts
 * ============================================================================
 * THE ROAD MARKING SHADERS, AS TSL NODE GRAPHS. Stage D2 of
 * `docs/WEBGPU_MIGRATION_PLAN.md` — the generator Stage D's recount found
 * assigned to no stage at all.
 *
 * `Roads.ts`'s `patchMaterial` is the shipping WebGL injection: three
 * `MeshStandardMaterial`s over `map + normalMap + roughnessMap + aoMap`, each
 * with one `onBeforeCompile` that publishes a vec4 attribute as `vRoad` and
 * edits TWO chunks — `<map_fragment>` for the paint and
 * `<roughnessmap_fragment>` for the gloss the paint has and the tarmac does
 * not. This file is that shader, block for block, and the two are meant to be
 * read side by side.
 *
 * WHY THIS ONE IS THE LEAST AFFORDABLE TO DEGRADE. `docs/RENDER_FINDINGS.md`
 * measures the road generator at 3.80% edge density against terrain's
 * 0.96-1.59% — it is the ONE surface in the project already inside the look
 * bible's detail band, and it gets there from pure code. Every scrap of that
 * detail is in the two shaders below, because the SURFACES are deliberately
 * near-flat colour fields (`Roads.ts` §THE SURFACE LAW). Lose the markings and
 * the road becomes the largest untextured plane in the frame.
 *
 * EVERY NUMBER COMES FROM `./road-markings.ts`, which both shaders read. None is
 * typed out twice.
 *
 * THE THREE INJECTIONS, AND WHERE EACH ONE LANDS HERE
 * ---------------------------------------------------
 *   aRoad/aKerb/aPave -> `vRoad`             `setupPosition`, before `super`
 *   `<map_fragment>`  -> paint over albedo   `colorNode`
 *   `<roughnessmap_fragment>` -> paint gloss `roughnessNode`
 *   `dithering: true` -> ordered dither      `setupOutput`, after `super`
 *
 * ONE `Fn` FEEDS TWO NODES, AND THE ORDER IS LOAD-BEARING
 * ------------------------------------------------------
 * The GLSL declares `roadPaintAmt` as a LOCAL in the `<map_fragment>` snippet
 * and reads it again at `<roughnessmap_fragment>`, which works because both
 * injections land in one function body in that order. The node path has the
 * same property for the same reason and it is worth stating rather than
 * assuming: `NodeMaterial.setup` calls `setupDiffuseColor` (which resolves
 * `colorNode`) BEFORE `setupVariants` (which resolves `roughnessNode`), so a
 * value shared between the two is assigned before it is read. Each surface
 * therefore returns ONE `vec4( paintedRgb, paintAmount )` — the same shape
 * `TerrainNodeMaterial` uses for `raSurface` — and the material splits it.
 *
 * `tests/road-node-material.spec.ts` §4 asserts that ordering against the
 * EMITTED SOURCE rather than against this comment, because Stage E's worst
 * defect was exactly an assignment that resolved after its reader and compiled
 * clean on both backends.
 *
 * NO `customProgramCacheKey`. `patchMaterial` sets one (`road:${attrName}`) and
 * it must not come with the port: `customProgramCacheKey` STILL FIRES on node
 * materials while `onBeforeCompile` is silently dead
 * (`TerrainNodeMaterial.TSL_GAPS` #6), so a key carried over could only ever be
 * stale — and a stale key hands back the previous program with nothing thrown
 * and nothing logged.
 *
 * NO SHROUD SELF-TINT, and that is deliberate rather than forgotten. Roads are
 * the GROUND PLANE, six centimetres above terrain and under the depth-tested
 * fog carpet that owns it; `TerrainMaterial` does not call `applyShroudTint`
 * either, and neither does `patchMaterial`. See `FogOfWar.ts` §1b.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
import {
  Fn, If, abs, attribute, clamp, float, floor, fwidth, materialColor, materialRoughness, max, mix,
  mod, select, smoothstep, step, texture, uniform, varyingProperty, vec2, vec4,
} from 'three/tsl';
import {
  ROAD_CROSSWALK_DEPTH, ROAD_CROSSWALK_PERIOD, ROAD_CROSSWALK_START, ROAD_KERB_HEIGHT,
  ROAD_LANE_WIDTH, ROAD_NORMAL_SCALE, ROAD_STOPBAR_GAP, ROAD_STOPBAR_WIDTH,
} from '../core/config';
import { ditherOutput } from '../render/dither-nodes';
import {
  ROAD_ARROW, ROAD_ATTRIBUTE_NAMES, ROAD_MARKS, ROAD_MARK_LINEAR, ROAD_MATERIAL_NAMES,
  ROAD_SURFACE_KINDS, arrowMask, roadSurfaceTextures, type RoadSurfaceKind,
} from './road-markings';

type FloatN = Node<'float'>;
type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. THE ATTRIBUTE AND THE VARYING
 * ========================================================================== */

/**
 * The three vec4 channels, one per surface. Packed as the GLSL packs them:
 *
 *   aRoad  (u, v, halfWidth, dEnd)   signed metres across / along / half-width /
 *                                    metres to the nearest junction mouth,
 *                                    NEGATIVE inside a pad
 *   aKerb  (along, paint, profile, -) profile is 0 at the road-side foot,
 *                                    ROAD_KERB_HEIGHT at the top edge
 *   aPave  (across, along, outerFrac, -)
 *
 * Built lazily and cached, so a material constructed twice reuses one node and a
 * material never constructed costs nothing. `attribute()` WARNS AND SUBSTITUTES
 * when the geometry lacks the name, which would silently compile a different
 * shader from the one the game runs — the geometry names are
 * `road-markings.ts`'s and `MeshBuf.toGeometry` writes exactly those.
 */
const attributeCache = new Map<RoadSurfaceKind, Vec4N>();

function roadAttribute(kind: RoadSurfaceKind): Vec4N {
  let node = attributeCache.get(kind);
  if (node === undefined) {
    node = attribute<'vec4'>(ROAD_ATTRIBUTE_NAMES[kind], 'vec4');
    attributeCache.set(kind, node);
  }
  return node;
}

/**
 * The interpolated road channel, named to match the GLSL so the two shaders read
 * side by side.
 *
 * ONE VARYING FOR THREE ATTRIBUTES, exactly as `patchMaterial` does it — the
 * three fragment snippets are written against a single declaration and each
 * material feeds it from its own attribute. Sharing the node across materials is
 * safe because each builds its own program; sharing the NAME is what makes the
 * three snippets transcribable one for one.
 */
const vRoad = varyingProperty('vec4', 'vRoad');

/* ==========================================================================
 * 2. THE UNIFORMS
 * ========================================================================== */

/**
 * `makeRoadUniforms`, node for node — one block shared by all three materials,
 * so a critic can retune the whole network at once.
 *
 * `texture()` CANNOT HOLD NULL (`TerrainNodeMaterial.TSL_GAPS` #4): a texture
 * node reads its sampler type off the value it was constructed with, so the two
 * arrow masks are built here rather than assigned later. They are cached by the
 * texture factory, so this costs one map lookup per road network.
 */
function createUniforms() {
  const lin = ROAD_MARK_LINEAR;
  return {
    uLaneWidth: uniform(ROAD_LANE_WIDTH),
    uCentre: uniform(new THREE.Vector3(...lin.centre)),
    uPaint: uniform(new THREE.Vector3(...lin.paint)),
    uWheelPath: uniform(new THREE.Vector3(...lin.wheelPath)),
    uKerbRed: uniform(new THREE.Vector3(...lin.kerbRed)),
    uKerbYellow: uniform(new THREE.Vector3(...lin.kerbYellow)),
    uArrowStraight: texture(arrowMask('arrowStraight')),
    uArrowTurn: texture(arrowMask('arrowTurn')),
  };
}

export type RoadNodeUniforms = ReturnType<typeof createUniforms>;

/* ==========================================================================
 * 3. THE CARRIAGEWAY — `ROAD_MARKING_GLSL`
 * ========================================================================== */

/**
 * Every stripe is anti-aliased with `fwidth()`, and both widths are taken
 * OUTSIDE the branch. That is not a tidy-up: a derivative in non-uniform control
 * flow is undefined in GLSL and a uniformity violation in WGSL, and the two
 * arrow samples below are hoisted for the same reason the GLSL hoists them —
 * `texture2D`'s implicit derivatives are undefined in non-uniform control flow,
 * so the box gate does the selecting rather than a branch.
 *
 * EVERY `smoothstep` HERE IS ASCENDING, and every one of them already was: the
 * shipping GLSL writes `1.0 - smoothstep( lo, hi, v )` rather than reversing the
 * edges. A descending `smoothstep` is UNDEFINED in WGSL where GLSL merely left
 * it unspecified (`TSL_GAPS` #3, hit twice already in this migration), so the
 * defensive style paid for itself again and there was nothing to rewrite.
 *
 * `mod` TRANSLATES DIRECTLY, AND IT WAS READ OUT OF THE EMITTED SOURCE RATHER
 * THAN ASSUMED. TSL's `mod` is the `%` operator in the graph, and `%` on floats
 * in WGSL is a TRUNCATED remainder, which disagrees with GLSL's floored `mod`
 * for a negative dividend — and the zebra's `u` is signed. three never emits
 * `%`: `WGSLNodeBuilder.js:83` declares
 * `fn tsl_mod_float( x, y ) { return x - y * floor( x / y ); }` and the
 * generated WGSL calls that helper, so both backends compute GLSL's `mod`. The
 * `ROAD_MARKS.crosswalkBias` term is therefore doing its original job and not a
 * portability one; `road-markings.ts` carries the correction beside it.
 */
const carriagewayPaint = Fn(([base, U]: [Vec3N, RoadNodeUniforms]) => {
  const M = ROAD_MARKS;

  const ru = vRoad.x.toVar('roadU');
  const rv = vRoad.y.toVar('roadV');
  const rw = vRoad.z.toVar('roadW');
  const dEnd = vRoad.w.toVar('roadDEnd');
  const lanes = floor(rw.mul(2.0).div(U.uLaneWidth).add(0.5)).toVar('roadLanes');

  const aaU = fwidth(ru).mul(M.aaGain).add(M.aaFloor).toVar('roadAaU');
  const aaV = fwidth(rv).mul(M.aaGain).add(M.aaFloor).toVar('roadAaV');

  /*
   * The arrow box is anchored on (distance from the centre line, distance to the
   * junction mouth), and both decal paths are authored tip-toward-v=0 and
   * head-toward-+u — so an arrow automatically points AT the nearest mouth and a
   * turn arrow automatically turns TOWARD the kerb, at either end of a chain and
   * whichever way the chain was walked.
   */
  const arrowLane = floor(abs(ru).div(U.uLaneWidth)).toVar('roadArrowLane');
  const arrowCentre = arrowLane.add(0.5).mul(U.uLaneWidth).toVar('roadArrowCentre');
  const arrowU = abs(ru).sub(arrowCentre).div(ROAD_ARROW.width).add(0.5).toVar('roadArrowU');
  const arrowV = dEnd.sub(ROAD_ARROW.near).div(ROAD_ARROW.span).toVar('roadArrowV');
  const arrowUv = vec2(arrowU, arrowV).toVar('roadArrowUv');
  const straightA = U.uArrowStraight.sample(arrowUv).a.toVar('roadArrowStraightA');
  const turnA = U.uArrowTurn.sample(arrowUv).a.toVar('roadArrowTurnA');

  const rgb = base.toVar('roadRgb');
  const mark = float(0.0).toVar('roadMark');
  const markCol = U.uPaint.toVar('roadMarkCol');

  If(dEnd.greaterThanEqual(0.0), () => {
    // --- wheel paths: two 0.8 m bands per lane, +18% L (bible §6.1) --------
    const laneIdx = floor(abs(ru).div(U.uLaneWidth)).toVar('roadLaneIdx');
    const inLane = abs(ru).sub(laneIdx.mul(U.uLaneWidth)).toVar('roadInLane');
    const wheel = smoothstep(M.wheelLo, M.wheelHi, abs(inLane.sub(M.wheelInner))).oneMinus()
      .add(smoothstep(M.wheelLo, M.wheelHi, abs(inLane.sub(M.wheelOuter))).oneMinus())
      .toVar('roadWheel');
    rgb.assign(mix(rgb, U.uWheelPath, clamp(wheel, 0.0, 1.0).mul(M.wheelMix)));

    // --- centre line: double solid yellow, 0.12 stripe / 0.12 gap ----------
    const c = smoothstep(
      float(M.lineHalf).sub(aaU), float(M.lineHalf).add(aaU),
      abs(abs(ru).sub(M.centreOffset)),
    ).oneMinus().toVar('roadCentreC');
    /*
     * THE COLOUR IS TAKEN INSIDE THE TEST, NOT AT THE MAXIMUM. `markCol` is
     * written only here, so a fragment that lands on the centre line paints
     * yellow even if a later stripe scores higher — which is the GLSL's own
     * behaviour and is harmless because no other marking overlaps the centre.
     * Transcribed rather than tidied: `max` over the amount and last-write-wins
     * over the colour are two different rules and collapsing them would repaint
     * every zebra bar at a junction mouth.
     */
    If(c.greaterThan(0.0), () => {
      mark.assign(max(mark, c));
      markCol.assign(U.uCentre);
    });

    // --- lane dividers: white dashes 3.0 m on / 2.8 m off ------------------
    If(lanes.greaterThanEqual(M.dividerLanes), () => {
      const dash = step(mod(rv, M.dashPeriod), M.dashOn).toVar('roadDash');
      const d = smoothstep(
        float(M.lineHalf).sub(aaU), float(M.lineHalf).add(aaU),
        abs(abs(ru).sub(U.uLaneWidth)),
      ).oneMinus().toVar('roadDivider');
      mark.assign(max(mark, d.mul(dash)));
    });

    // --- edge line: solid white 0.15 m, inset 0.25 m from the kerb ---------
    const e = smoothstep(
      float(M.edgeHalf).sub(aaU), float(M.edgeHalf).add(aaU),
      abs(abs(ru).sub(rw.sub(M.edgeInset))),
    ).oneMinus().toVar('roadEdge');
    mark.assign(max(mark, e));

    // --- crosswalk zebra at every junction mouth ---------------------------
    const zA = ROAD_CROSSWALK_START;
    const zB = zA + ROAD_CROSSWALK_DEPTH;
    If(dEnd.greaterThan(zA - M.crosswalkGate).and(dEnd.lessThan(zB + M.crosswalkGate)), () => {
      const band = smoothstep(float(zA).sub(aaV), float(zA).add(aaV), dEnd)
        .mul(smoothstep(float(zB).sub(aaV), float(zB).add(aaV), dEnd).oneMinus())
        .toVar('roadZebraBand');
      const halfP = ROAD_CROSSWALK_PERIOD * 0.5;
      const bar = mod(ru.add(M.crosswalkBias), ROAD_CROSSWALK_PERIOD).toVar('roadZebraBar');
      const stripe = smoothstep(
        float(halfP * 0.5).sub(aaU), float(halfP * 0.5).add(aaU), abs(bar.sub(halfP * 0.5)),
      ).oneMinus().toVar('roadZebraStripe');
      const inset = smoothstep(rw.sub(M.zebraInsetLo), rw.sub(M.zebraInsetHi), abs(ru))
        .oneMinus().toVar('roadZebraInset');
      mark.assign(max(mark, band.mul(stripe).mul(inset)));
    });

    // --- stop bar ----------------------------------------------------------
    const sA = zB + ROAD_STOPBAR_GAP;
    const sB = sA + ROAD_STOPBAR_WIDTH;
    const stop = smoothstep(float(sA).sub(aaV), float(sA).add(aaV), dEnd)
      .mul(smoothstep(float(sB).sub(aaV), float(sB).add(aaV), dEnd).oneMinus())
      .toVar('roadStop');
    mark.assign(max(mark, stop.mul(
      smoothstep(rw.sub(M.stopInsetLo), rw.sub(M.stopInsetHi), abs(ru)).oneMinus(),
    )));

    /*
     * --- lane arrow --------------------------------------------------------
     * Hard box gate. The masks are ClampToEdge, and the turn arrow's shaft runs
     * to v = 0.97, so without this the clamp would smear its tail into an
     * endless stripe down the middle of the lane.
     *
     * A two-lane street's single lane does everything, so it gets the turn arrow
     * (which is what the RA3 city-road reference shows). On a four-lane arterial
     * the inner lane runs straight on and the kerb lane turns off.
     */
    const inArrow = step(0.0, arrowU).mul(step(arrowU, 1.0))
      .mul(step(0.0, arrowV)).mul(step(arrowV, 1.0)).toVar('roadInArrow');
    const wantTurn = select(
      lanes.lessThan(M.dividerLanes), float(1.0), step(0.5, arrowLane),
    ).toVar('roadWantTurn');
    mark.assign(max(mark, mix(straightA, turnA, wantTurn).mul(inArrow)));
  });

  const amount = clamp(mark, 0.0, 1.0).toVar('roadPaintAmt');
  return vec4(mix(rgb, markCol, amount.mul(M.markMix)), amount);
});
/* NO LAYOUT: the body reads `vRoad`, a module-scope varying, and a WGSL function
 * may only see its parameters — `.setLayout()` would emit a function referring to
 * a name outside its scope, which generates cleanly offline and is refused by
 * Chrome. `render/shroud-nodes.ts` carries the finding;
 * `StructureNodeMaterial.STAGE_D_TSL_GAPS` #6 is the entry. Passing the uniform
 * block as a parameter does NOT rescue it: `U` is a plain JS object read at graph
 * BUILD time, not a shader value, so the emitted function still names the
 * uniforms directly. */

/* ==========================================================================
 * 4. THE KERB — `KERB_PAINT_GLSL`
 * ========================================================================== */

/**
 * Bible §6.3: red paint covers the vertical face PLUS 0.08 m of the top, and
 * runs 6-12 m along a corner arc. Yellow dashes (0.9 m on / 0.45 m off) sit on
 * the TOP face only, at crossings.
 *
 * `If( red ).ElseIf( yellow )` is the GLSL's `if / else if`, and the two are
 * genuinely exclusive — `paint` is the code 0 / 1 / 2 written per kerb point.
 * The bevel highlight afterwards is unconditional and applies to all three.
 */
const kerbPaint = Fn(([base, U]: [Vec3N, RoadNodeUniforms]) => {
  const M = ROAD_MARKS;
  const kAlong = vRoad.x.toVar('kerbAlong');
  const kPaint = vRoad.y.toVar('kerbPaintCode');
  const kProf = vRoad.z.toVar('kerbProfile');
  const kTop = ROAD_KERB_HEIGHT;

  const rgb = base.toVar('kerbRgb');
  const amount = float(0.0).toVar('kerbPaintAmt');

  If(kPaint.greaterThan(0.5).and(kPaint.lessThan(1.5)), () => {
    // Red: whole vertical face + the first 0.08 m of the top face.
    const m = smoothstep(kTop + M.kerbRedLo, kTop + M.kerbRedHi, kProf).oneMinus().toVar('kerbRedM');
    amount.assign(m);
    rgb.assign(mix(rgb, U.uKerbRed, m.mul(M.kerbRedMix)));
  }).ElseIf(kPaint.greaterThan(1.5), () => {
    // Yellow dashes on the top face: 0.9 m on, 0.45 m off.
    const dash = step(mod(kAlong, M.kerbDashPeriod), M.kerbDashOn).toVar('kerbDash');
    const onTop = step(kTop + M.kerbTopEps, kProf).toVar('kerbOnTop');
    amount.assign(dash.mul(onTop));
    rgb.assign(mix(rgb, U.uKerbYellow, amount.mul(M.kerbYellowMix)));
  });

  // The convex top edge carries a bevel highlight. Scorecard #11 grades this on
  // units, but a razor-sharp kerb edge is the same tell at half the size.
  const bevel = smoothstep(0.0, M.kerbBevel, abs(kProf.sub(kTop))).oneMinus().toVar('kerbBevel');
  rgb.mulAssign(float(1.0).add(bevel.mul(M.kerbBevelGain)));

  return vec4(rgb, amount);
});
/* NO LAYOUT — reads `vRoad`. See the note under `carriagewayPaint`. */

/* ==========================================================================
 * 5. THE PAVEMENT — `PAVEMENT_GLSL`
 * ========================================================================== */

/**
 * The one feature that cannot live in a tiling texture, because it is keyed to
 * the pavement's own width rather than to the tile: bible §6.2(a)'s 0.3 m
 * soldier course, 12% darker, along the outer edge.
 *
 * The paint amount is ZERO throughout, and that is not an omission — the GLSL
 * declares `roadPaintAmt = 0.0` and never raises it, so the roughness lerp at
 * `<roughnessmap_fragment>` is the identity and pavement keeps the roughness its
 * ORM map gives it. Returned as a vec4 anyway so all three surfaces have one
 * shape and the material below has one wiring.
 */
const pavementPaint = Fn(([base]: [Vec3N]) => {
  const M = ROAD_MARKS;
  const soldier = smoothstep(M.soldierLo, M.soldierHi, vRoad.z).toVar('paveSoldier');
  return vec4(base.mul(float(1.0).sub(soldier.mul(M.soldierDarken))), float(0.0));
});
/* NO LAYOUT — reads `vRoad`. See the note under `carriagewayPaint`. */

/* ==========================================================================
 * 6. THE MATERIAL
 * ========================================================================== */

/**
 * `MeshStandardNodeMaterial` plus the dithering three forgot to port, and the
 * one vertex edit `patchMaterial` makes.
 *
 * STANDARD RATHER THAN PHYSICAL ON PURPOSE, exactly as the GLSL twin is: bible
 * ruling #3 (base 0.52 + clearcoat) is about PAINTED UNIT HULLS. Asphalt and
 * concrete have no clear coat, and paying for one on 17k triangles of ground
 * buys nothing.
 */
class RoadStandardNodeMaterial extends MeshStandardNodeMaterial {
  constructor(private readonly attributeNode: Vec4N) {
    super();
  }

  /**
   * Publish the road channel.
   *
   * BEFORE `super`, matching the GLSL's `vRoad = aRoad;` immediately after
   * `<begin_vertex>` — and unlike the shroud UV, which must come after because it
   * depends on the moved position. Nothing here moves anything: the attribute is
   * a pure per-vertex pass-through, so the value is identical either side. It is
   * written first anyway, so this file has one convention rather than two.
   */
  override setupPosition(builder: NodeBuilder): Vec3N {
    vRoad.assign(this.attributeNode);
    return super.setupPosition(builder) as Vec3N;
  }

  /**
   * `material.dithering` reaches NOTHING in three's node system — it is
   * implemented in `dithering_pars_fragment.glsl.js` and nowhere else, and
   * setting the flag on a node material silently does nothing. All three road
   * materials set it and mean it: a carriageway is a large, near-flat, single-hue
   * plane running through the far field, which is the third place in this game
   * where an 8-bit gradient bands.
   *
   * AFTER `super`, because the GLSL chunk order runs `<dithering_fragment>` after
   * `<fog_fragment>` and `<premultiplied_alpha_fragment>` and `super.setupOutput`
   * is precisely those two.
   */
  override setupOutput(builder: NodeBuilder, outputNode: Vec4N): Vec4N {
    const out = super.setupOutput(builder, outputNode) as Vec4N;
    return this.dithering === true ? ditherOutput(out) : out;
  }
}

/** Which paint function each surface wears. */
function paintFor(kind: RoadSurfaceKind, base: Vec3N, uniforms: RoadNodeUniforms): Vec4N {
  switch (kind) {
    case 'carriageway': return carriagewayPaint(base, uniforms) as Vec4N;
    case 'kerb': return kerbPaint(base, uniforms) as Vec4N;
    case 'pavement': return pavementPaint(base) as Vec4N;
  }
}

export interface RoadNodeMaterialSet {
  readonly materials: Readonly<Record<RoadSurfaceKind, MeshStandardNodeMaterial>>;
  /** Live uniform nodes, shared by all three. Mutate `.value`, never replace. */
  readonly uniforms: RoadNodeUniforms;
  dispose(): void;
}

/**
 * THE NODE-PATH TWIN OF `makeMaterial` + `patchMaterial`, for one surface.
 *
 * @param anisotropy Pushed in, so this file never touches the GL context —
 *                   the same contract `RoadNetworkOptions.anisotropy` has.
 */
export function createRoadNodeMaterial(
  kind: RoadSurfaceKind, anisotropy: number, uniforms: RoadNodeUniforms,
): MeshStandardNodeMaterial {
  const { map, normalMap, ormMap } = roadSurfaceTextures(kind, anisotropy);

  const mat = new RoadStandardNodeMaterial(roadAttribute(kind));
  mat.name = ROAD_MATERIAL_NAMES[kind];
  mat.map = map;
  mat.normalMap = normalMap;
  mat.roughnessMap = ormMap;
  mat.aoMap = ormMap;
  /*
   * The clean generators write a FLAT height field (asphalt and kerb are exactly
   * 0.5; paving only cuts its joints), so this scale has almost nothing left to
   * amplify — which is the point. The old concrete normal map was a Sobel of
   * 14x-frequency Worley noise and made tarmac glitter like crumpled foil.
   */
  mat.normalScale = new THREE.Vector2(ROAD_NORMAL_SCALE, ROAD_NORMAL_SCALE);
  /*
   * `roughness` is the value `materialRoughness` starts from and the ORM map
   * still drives the per-pixel term, so 1.0 leaves the map in charge — exactly as
   * the GLSL material does. The paint lerp below moves it and nothing else does.
   */
  mat.roughness = 1.0;
  mat.metalness = 0.0;
  /* Read by `RoadStandardNodeMaterial.setupOutput` above and by NOTHING in
   * three's node system. The shipping GLSL material carries the same flag and
   * means the same thing by it. */
  mat.dithering = true;
  /*
   * Ribbon and pavement offsets are guarded against fold-through by
   * `maxSafeOffset`, which removes about 75% of the inverted triangles a curved
   * network produces. The residual ~0.2% are slivers at junction corners, and the
   * cheapest correct answer for FLAT ground geometry is to draw both faces: an
   * inverted sliver then fills its pixels with slightly wrong lighting instead of
   * leaving a hole with bare terrain showing through.
   */
  mat.side = THREE.DoubleSide;

  /*
   * ONE CALL, TWO CONSUMERS. `materialColor` is `color * map` — exactly what
   * `diffuseColor` holds when the GLSL's paint injection runs, immediately after
   * `<map_fragment>`. `.rgb` is correct whether the node is the vec3 the types
   * declare or the vec4 it actually is once a map is attached (see the block in
   * `StructureNodeMaterial.createStructureNodeMaterial`).
   *
   * The alpha is written as a literal 1.0 rather than carried through, and that
   * is exact rather than approximate: these materials are opaque, carry no
   * `alphaMap` and no `alphaTest`, and `NodeMaterial.setupDiffuseColor` assigns
   * `diffuseColor.a = 1.0` unconditionally for an opaque build anyway.
   */
  /*
   * `.rgb` IS THE ONE ACCESSOR THAT IS RIGHT UNDER BOTH READINGS OF THIS NODE.
   * `@types/three` declares `materialColor` as `Node<'vec3'>`, and it IS a vec4
   * at runtime the moment a map is bound (`MaterialNode` builds it as
   * `color.mul( texture( 'map' ) )`, and vec3 * vec4 widens). `.rgb` types as
   * vec3 and generates as vec3 either way; anything that touched `.a` would
   * typecheck against the declaration and fail against the value, which is the
   * `vec4()` arity error recorded in `StructureNodeMaterial`.
   */
  const painted = paintFor(kind, materialColor.rgb, uniforms);
  mat.colorNode = vec4(painted.xyz, float(1.0));
  mat.roughnessNode = mix(materialRoughness, ROAD_MARKS.paintRoughness, painted.w);

  return mat;
}

/**
 * All three road materials plus the block of uniforms they share.
 *
 * The GLSL path builds these inside `RoadNetwork.buildMeshes` and pushes them
 * onto `this.materials`; this is the same set, built the same way, for a renderer
 * that cannot compile the injection.
 */
export function createRoadNodeMaterials(anisotropy: number): RoadNodeMaterialSet {
  const uniforms = createUniforms();
  const materials = {
    carriageway: createRoadNodeMaterial('carriageway', anisotropy, uniforms),
    kerb: createRoadNodeMaterial('kerb', anisotropy, uniforms),
    pavement: createRoadNodeMaterial('pavement', anisotropy, uniforms),
  } as const;

  return {
    materials,
    uniforms,
    dispose(): void {
      for (const kind of ROAD_SURFACE_KINDS) materials[kind].dispose();
    },
  };
}

/* ==========================================================================
 * 7. WHAT THIS PORT COULD NOT EXPRESS, AND WHAT IT COSTS
 *
 * Nothing. Every construct in the three shipping snippets — `fwidth`, a hoisted
 * texture sample, `mod`, `step`, nested branches, a last-write-wins colour and a
 * value shared between two chunk injections — translated directly, and the two
 * places that LOOK like gaps are documented above rather than listed here: the
 * `%`-versus-`mod` sign question (unreachable by construction, §3) and the
 * missing layouts (`STAGE_D_TSL_GAPS` #6, which is a general rule and not a road
 * finding).
 *
 * That is worth stating positively, because every earlier stage in this
 * migration added an entry to a gap list and a reader could reasonably assume
 * this one forgot to. It did not. The road shaders are pure fragment arithmetic
 * over one varying, which is the shape TSL handles best; the migration-blocking
 * gap in this stage belongs to the SHADOW pass and is recorded where it lives,
 * in `StructureNodeMaterial.STAGE_D_TSL_GAPS` #1.
 * ========================================================================== */
