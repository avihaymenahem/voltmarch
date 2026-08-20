/**
 * ============================================================================
 * VOLTMARCH — src/art/BuildingDefs.ts
 * ============================================================================
 * EVERY STRUCTURE IN THE GAME, as declarative mass lists.
 *
 * Bible 5.7 gives each faction seven numbered architectural rules and this file
 * is those rules turned into geometry. They are implemented as SHELL
 * GENERATORS — `alliedShell()` and `sovietShell()` — so the faction language is
 * written once and every structure inherits all of it, then adds the masses
 * that make it identifiable. That is deliberate: RA3's buildings read as a
 * family first and as a Barracks second, and hand-authoring 22 lists would
 * drift the family apart within three structures.
 *
 *   ALLIED (bible 5.7 ALLIED 1-6)
 *     1 splayed skirt, base 1.30x wider than the top
 *     2 open-topped hex crown at 0.50x base width, 0.30x height
 *     3 PAIRED modules — two identical halves sharing an edge, never a monolith
 *     4 corner radius 6-10% of the smallest dimension
 *     5 3-5 horizontal banding strips of alternating depth
 *     6 flat near-black charcoal pad, 10% beyond the footprint
 *
 *   SOVIET (bible 5.7 SOVIET 1-7)
 *     1 heavy slab with 45-degree chamfers on every vertical corner (7.5%)
 *     2 fat capsule corner rails at 12% of wall height, flat disc caps
 *     3 2-3 tapered stacks, 45% of building height above the roof, two red bands
 *     4 bulbous pressure vessels at 0.24x width with glowing amber caps
 *     5 exposed yellow lattice scaffolding and railed catwalks
 *     6 rivets on every chamfer and seam (carried by the atlas, spec.rivets)
 *     7 raised grated steel deck plus a concrete apron with a red star
 *
 * COORDINATES. 1 unit = 1 metre, Y up, model origin is the GROUND-PLANE CENTRE
 * of the footprint, +Z is the facade / vehicle exit. `anchor` is the mass
 * CENTRE, so a 6 m tall block resting on the ground has anchor.y = 3.
 *
 * SLOT DISCIPLINE. `paintMed` means "auto by face area" (the factory downgrades
 * small faces to paintSmall/paintTiny); `paintLarge` is never authored — see
 * the note in BuildingFactory. `teamSlab` is the ONLY way a faction colour
 * reaches a surface (R12), and it goes on top-facing and outward-facing
 * geometry only (R-T3).
 * ============================================================================
 */

import {
  BUILDING_DIMENSIONS, BUILDING_FOOTPRINTS, BUILDING_GEOMETRY, BUILDING_PAD, CELL,
  NAVAL_BUILDING_DIMENSIONS,
} from '../core/config';
import { PartId } from '../core/types';
import { CIVILIAN_DIMENSIONS } from '../data/Civilians';
import { MassRole, taperOutline } from './MassList';
import {
  Feature,
  type StructureFaction,
  type StructureMass,
  type StructureMassList,
  type StructureSocket,
} from './BuildingFactory';
import type { SlotName } from './Greeble';

type M = StructureMass;
type V3 = readonly [number, number, number];
type V2 = readonly [number, number];

const HALF_PI = Math.PI * 0.5;

/* ==========================================================================
 * 1. MASS CONSTRUCTORS
 *
 * The first three are the original vocabulary and every existing structure
 * still uses them for its small hardware, where a chamfered box IS the right
 * answer. The rest are the `Shapes.ts` primitives, and they are what the BODY
 * masses are built from now.
 *
 * WHY THE BODIES CHANGED. The verdict was "too rectangular, like old-school 3D
 * models", and a structure's body is the largest flat surface a player ever
 * sees. `box` + `taper` already canted the walls, but the Soviet `prism`/cutBox
 * slab did not: an octagonal plan is still eight VERTICAL planes, four of them
 * square-on to the camera, and `MassList.boxiness()` scores that ~0.80. The
 * `planPrism` spelling below adds a BATTER — the wall leans, brutalist concrete
 * always does — and a leaning wall is not a flat rectangle any more.
 *
 * Every new primitive here degrades to a chamfered box of its own `size`, in
 * its own place, with its own slot, on a factory that has not yet been taught to
 * build it. Nothing is authored as a `plates:`/`greebles:` CHILD, because a
 * child that is not expanded disappears entirely and takes its surface area —
 * and with it the measured team-colour fraction — with it.
 * ========================================================================== */

function box(name: string, role: MassRole, size: V3, anchor: V3, slot: SlotName, o?: Partial<M>): M {
  return { name, primitive: 'box', role, size, anchor, slot, ...o };
}
function cyl(name: string, role: MassRole, size: V3, anchor: V3, slot: SlotName, o?: Partial<M>): M {
  return { name, primitive: 'lathe', role, size, anchor, slot, profile: 'cyl', ...o };
}
function pri(name: string, role: MassRole, size: V3, anchor: V3, slot: SlotName, o?: Partial<M>): M {
  return { name, primitive: 'prism', role, size, anchor, slot, ...o };
}

/** A chamfered, tapered, optionally sheared and corner-cut block. */
function tbox(
  name: string, role: MassRole, size: V3, anchor: V3, slot: SlotName,
  shape: NonNullable<M['shape']>, o?: Partial<M>,
): M {
  return { name, primitive: 'taperedBox', role, size, anchor, slot, shape, ...o };
}

/** An arbitrary plan extruded with a real batter. The Soviet slab, upgraded. */
function pplan(
  name: string, role: MassRole, size: V3, anchor: V3, slot: SlotName,
  shape: NonNullable<M['shape']>, o?: Partial<M>,
): M {
  return { name, primitive: 'planPrism', role, size, anchor, slot, shape, ...o };
}

/** A revolved normalised profile, 12-16 facets. */
function rev(
  name: string, role: MassRole, size: V3, anchor: V3, slot: SlotName,
  profile: readonly V2[], segments: number, o?: Partial<M>,
): M {
  return { name, primitive: 'revolve', role, size, anchor, slot, shape: { profile, segments }, ...o };
}

/** XZ extents of an outline: a plate's local width and length. */
function outlineSize(outline: readonly V2[]): [number, number] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of outline) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return [Math.max(1e-3, maxX - minX), Math.max(1e-3, maxZ - minZ)];
}

/**
 * A layered plate. Thickness runs along the plate's own +Y and the outline lies
 * in its local XZ, so `size` is always `[outlineW, thickness, outlineD]` and the
 * mass is then ROTATED into place — `massBounds` turns that back into the right
 * world AABB. Banding strips, glazing, canopies, catwalk decks, team panels.
 */
function plate(
  name: string, role: MassRole, outline: readonly V2[], thickness: number,
  anchor: V3, rot: V3 | undefined, slot: SlotName, o?: Partial<M>,
): M {
  const [w, d] = outlineSize(outline);
  return {
    name, primitive: 'plate', role, size: [w, thickness, d], anchor, slot, capSlot: slot,
    ...(rot !== undefined ? { rot } : {}),
    shape: { outline, thickness, fit: 'none' },
    ...o,
  };
}

/**
 * A deterministic run of louvre stacks, bolt pairs, junction boxes and pipe
 * collars. Seeded, byte-identical between runs, and ONE readable object — every
 * polygon carries the same `group`, so a 4 m service run costs one slot in the
 * greeble budget rather than eleven.
 */
function greebleRun(
  name: string, length: number, width: number, height: number,
  anchor: V3, seed: number, o?: Partial<M>,
): M {
  return {
    name, primitive: 'greebleStrip', role: MassRole.Greeble,
    size: [width, height, length], anchor, slot: 'bareMetal', group: name,
    shape: { density: 2.2, seed: seed >>> 0, fit: 'none' },
    ...o,
  };
}

/** A centred rectangle outline in metres. */
function rect(w: number, d: number): V2[] {
  const a = w * 0.5, b = d * 0.5;
  return [[a, -b], [a, b], [-a, b], [-a, -b]];
}

/** A regular n-gon plan in metres. `phase` rotates it. */
function ngon(rx: number, rz: number, sides: number, phase = 0): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * rx, Math.sin(a) * rz]);
  }
  return out;
}

/** An octagonal plan in metres — SOVIET-1's 45-degree vertical corner cuts. */
function cutBoxPlan(w: number, d: number, cutFraction: number): V2[] {
  const cx = w * 0.5, cz = d * 0.5;
  const c = Math.min(cx, cz) * Math.min(0.48, Math.max(0.03, cutFraction));
  return [
    [cx, -cz + c], [cx, cz - c], [cx - c, cz], [-cx + c, cz],
    [-cx, cz - c], [-cx, -cz + c], [-cx + c, -cz], [cx - c, -cz],
  ];
}

/** A drum: chamfered rim, straight body, chamfered crown. Normalised. */
const DRUM: readonly V2[] = [
  [0, 0], [0.42, 0], [0.50, 0.09], [0.50, 0.91], [0.42, 1.0], [0, 1.0],
];
/** A faceted dome. Normalised. */
const DOME: readonly V2[] = [
  [0, 0], [0.50, 0], [0.48, 0.26], [0.42, 0.52], [0.31, 0.76], [0.17, 0.93], [0, 1.0],
];
/** A tapered cooling drum / stack. Normalised. */
const TAPER_DRUM: readonly V2[] = [
  [0, 0], [0.44, 0], [0.50, 0.08], [0.44, 0.62], [0.38, 0.92], [0.32, 1.0], [0, 1.0],
];
/** A hexagonal duct section for extruded jibs and rails. */
function ductSection(r: number): V2[] {
  return [
    [0.50 * r, 0], [0.25 * r, 0.43 * r], [-0.25 * r, 0.43 * r],
    [-0.50 * r, 0], [-0.25 * r, -0.43 * r], [0.25 * r, -0.43 * r],
  ];
}

/* ==========================================================================
 * 2. SHARED FEATURES
 * ========================================================================== */

/**
 * THE FOUNDATION PAD (ALLIED-6 / SOVIET-7).
 *
 * Real geometry with its own material, not a decal. One mass carries both the
 * visible slab and the buried skirt: the top face sits at `BUILDING_PAD.lift`
 * and the box runs down past the origin by `skirtDepth`, so the joint is under
 * the heightfield on every cell `Terrain.isBuildable` will accept. A decal
 * would z-fight, and a re-meshed-per-site pad would cost one batch per
 * instance.
 */
function foundationPad(faction: StructureFaction, fw: number, fh: number, height: number): M[] {
  const soviet = faction === 'soviets';
  const over = soviet ? BUILDING_PAD.sovietOverhang : BUILDING_PAD.alliedOverhang;
  const thick = Math.max(0.18, height * (soviet ? BUILDING_PAD.sovietThickness : BUILDING_PAD.alliedThickness));
  const w = fw * CELL * (1 + over * 2);
  const d = fh * CELL * (1 + over * 2);
  const total = thick + BUILDING_PAD.skirtDepth;
  const cy = BUILDING_PAD.lift - total * 0.5;

  const out: M[] = [
    // A chamfered octagonal plan with a slight batter, not a raw box: SOVIET-7
    // asks for a bevelled lip and ALLIED-6 for chamfered corners, and a pad that
    // widens toward the ground is what a poured slab actually looks like.
    pplan('pad.slab', MassRole.Greeble, [w, total, d], [0, cy, 0], 'paintMed', {
      plan: cutBoxPlan(w, d, 0.07),
      topScaleX: 0.985, topScaleZ: 0.985,
      chamferTop: Math.min(0.22, thick * 0.5), chamferBottom: 0.05,
    }, {
      capSlot: soviet ? 'grille' : 'paintSmall',
      target: 'pad', feature: Feature.Static, group: 'pad',
      chamfer: Math.min(0.22, thick * 0.5),
    }),
  ];

  if (soviet) {
    // SOVIET-7: a concrete apron fronting the vehicle exit, with a red star.
    const aw = Math.min(w * 0.72, fw * CELL);
    out.push(
      box('pad.apron', MassRole.Greeble, [aw, total * 0.86, d * 0.30], [0, cy + total * 0.07, d * 0.5 + d * 0.13], 'paintSmall', {
        target: 'pad', feature: Feature.Static, group: 'apron', chamfer: 0.10,
      }),
      box('pad.star', MassRole.Greeble, [aw * 0.42, 0.06, aw * 0.42], [0, BUILDING_PAD.lift + 0.02, d * 0.5 + d * 0.10], 'insignia', {
        target: 'pad', feature: Feature.Static, group: 'apron', chamfer: 0.02,
      }),
    );
  } else {
    // ALLIED-6: a light kerb line inset from the slab edge. The pad is nearly
    // black by design, so this is the only thing that keeps its shape legible.
    for (const sgn of [1, -1]) {
      out.push(box('pad.kerb', MassRole.Greeble, [w * 0.94, 0.10, 0.34], [0, BUILDING_PAD.lift + 0.03, sgn * (d * 0.5 - 0.34)], 'stripe', {
        target: 'pad', feature: Feature.Static, group: 'kerb', chamfer: 0.03,
      }));
    }
  }
  return out;
}

/**
 * ALLIED-5: 3-5 horizontal banding strips of alternating depth (+/-3%).
 *
 * Authored as LAYERED PLATES rather than as thin boxes. That is not cosmetic:
 * a plate is a rimmed panel sitting proud of the wall it lies on, which is the
 * hi-tech read the bible is describing, and it costs 28 triangles against a
 * box's 44.
 */
function alliedBands(w: number, d: number, y0: number, y1: number): M[] {
  const n = BUILDING_GEOMETRY.alliedBandCount;
  const out: M[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const y = y0 + (y1 - y0) * t;
    // The taper means the body is narrower higher up; follow it.
    const shrink = 1 - (1 - 1 / BUILDING_GEOMETRY.alliedSkirtFlare) * t;
    const proud = i % 2 === 0 ? 1 + BUILDING_GEOMETRY.alliedBandDepth : 1 - BUILDING_GEOMETRY.alliedBandDepth;
    out.push(plate(`band${i}`, MassRole.Greeble,
      // Chamfered in plan as well as in section, so the band follows the body's
      // own corner radius (ALLIED-4) instead of squaring it back off.
      cutBoxPlan(w * shrink * proud, d * shrink * proud, 0.09), 0.26,
      [0, y, 0], undefined, 'paintSmall', { group: 'bands', chamfer: 0.07 }));
  }
  return out;
}

/**
 * ALLIED-2: a low aerospace shoulder and a narrow command keel.
 *
 * The old crown was a half-width hexagonal room stacked on top of every
 * building. From the game camera that made the whole roster read as wedding
 * cakes made from boxes. This replacement spends its volume horizontally: a
 * broad swept ceramic shoulder carries the roof line while a thin, tapered
 * keel alone reaches the authored height. The same bounds and socket budget
 * survive, but the silhouette is now wing + fin rather than box + smaller box.
 */
function alliedCrown(baseW: number, totalH: number, roofY: number): M[] {
  const shoulderW = baseW * 0.82;
  const shoulderD = baseW * 0.38;
  const rise = Math.max(0.8, totalH - roofY);
  const shoulderH = Math.min(totalH * 0.11, rise * 0.42);
  const keelW = baseW * 0.17;
  const keelD = baseW * 0.24;
  return [
    plate('crown.shoulder', MassRole.Primary,
      [[-shoulderW * 0.50, -shoulderD * 0.34], [-shoulderW * 0.36, -shoulderD * 0.50],
        [shoulderW * 0.36, -shoulderD * 0.50], [shoulderW * 0.50, -shoulderD * 0.34],
        [shoulderW * 0.42, shoulderD * 0.50], [-shoulderW * 0.42, shoulderD * 0.50]],
      shoulderH, [0, roofY + shoulderH * 0.52, 0], [-0.025, 0, 0], 'paintMed', {
        capSlot: 'paintSmall', chamfer: 0.10,
      }),
    tbox('crown.keel', MassRole.Primary, [keelW, rise, keelD],
      [0, roofY + rise * 0.5, -shoulderD * 0.08], 'paintMed', {
        topScaleX: 0.42, topScaleZ: 0.52, shear: -shoulderD * 0.16, cornerCut: 0.18,
      }, { capSlot: 'glass', chamfer: 0.09 }),
    box('crown.light', MassRole.Emissive, [keelW * 0.26, rise * 0.46, 0.10],
      [0, roofY + rise * 0.48, keelD * 0.51], 'emissive', {
        group: 'crown', feature: Feature.Window, chamfer: 0.03,
      }),
  ];
}

/** SOVIET-2: fat capsule corner rails, full height, flat disc caps. */
function sovietRails(w: number, d: number, h: number): M[] {
  const dia = Math.max(0.5, h * BUILDING_GEOMETRY.sovietRailDiameter);
  const x = w * 0.5 - dia * 0.34;
  const z = d * 0.5 - dia * 0.34;
  const out: M[] = [];
  for (const sz of [1, -1]) {
    out.push(cyl(`rail${sz > 0 ? 'F' : 'B'}`, MassRole.Greeble, [dia, h, dia], [x, h * 0.5, sz * z], 'bareMetal', {
      mirrorX: true, segments: BUILDING_GEOMETRY.railSegments, group: 'rails', capSlot: 'hatch',
    }));
  }
  return out;
}

/** SOVIET-3: a tapered smoke stack with two red bands and a cap ring. */
function sovietStack(x: number, z: number, dia: number, baseY: number, top: number, tag: string): M[] {
  const h = top - baseY;
  return [
    cyl(`${tag}.stack`, MassRole.Primary, [dia, h, dia], [x, baseY + h * 0.5, z], 'rivetPlate', {
      topRadius: BUILDING_GEOMETRY.sovietStackTaper, group: tag, capSlot: 'grille',
    }),
    cyl(`${tag}.bandA`, MassRole.TeamSlab, [dia * 1.06, h * 0.050, dia * 1.06], [x, baseY + h * 0.62, z], 'teamSlab', {
      group: tag, chamfer: 0.04,
    }),
    cyl(`${tag}.bandB`, MassRole.TeamSlab, [dia * 1.05, h * 0.042, dia * 1.05], [x, baseY + h * 0.78, z], 'teamSlab', {
      group: tag, chamfer: 0.04,
    }),
    cyl(`${tag}.cap`, MassRole.Greeble, [dia * 1.16, h * 0.06, dia * 1.16], [x, top - h * 0.03, z], 'bareMetal', {
      group: tag, chamfer: 0.05, capSlot: 'grille',
    }),
  ];
}

/** SOVIET-4: a bulbous pressure vessel with a glowing amber cap. */
function sovietVessel(x: number, z: number, r: number, y: number, tag: string): M[] {
  return [
    { name: `${tag}.vessel`, primitive: 'lathe', role: MassRole.Primary, profile: 'capsule',
      size: [r * 2, r * 2.9, r * 2], anchor: [x, y + r * 1.45, z], slot: 'rivetPlate', group: tag },
    cyl(`${tag}.collar`, MassRole.Greeble, [r * 2.2, r * 0.3, r * 2.2], [x, y + r * 0.5, z], 'bareMetal', {
      group: tag, chamfer: 0.05, capSlot: 'grille',
    }),
    cyl(`${tag}.glow`, MassRole.Emissive, [r * 1.1, r * 0.34, r * 1.1], [x, y + r * 2.95, z], 'emissive', {
      group: tag, chamfer: 0.04, capSlot: 'emissive',
    }),
  ];
}

/**
 * SOVIET-5: exposed yellow lattice. X-braced squares on a `latticePitch` grid
 * between two posts. The atlas `stripe` tile is hazard yellow over near-black,
 * which is exactly what a sunlit construction gantry reads as at RTS distance.
 */
function lattice(x: number, z: number, w: number, h: number, tag: string, alongZ = false): M[] {
  const t = BUILDING_GEOMETRY.latticeTube;
  const bays = Math.max(1, Math.round(h / BUILDING_GEOMETRY.latticePitch));
  const bayH = h / bays;
  const out: M[] = [];
  const span: V3 = alongZ ? [t, h, t] : [t, h, t];
  for (const s of [-1, 1]) {
    out.push(box(`${tag}.post${s}`, MassRole.Greeble, span,
      alongZ ? [x, h * 0.5, z + s * w * 0.5] : [x + s * w * 0.5, h * 0.5, z],
      'stripe', { group: tag, chamfer: 0.03 }));
  }
  const diag = Math.hypot(w, bayH);
  const ang = Math.atan2(bayH, w);
  for (let i = 0; i < bays; i++) {
    const y = (i + 0.5) * bayH;
    for (const s of [-1, 1]) {
      out.push(box(`${tag}.brace${i}${s}`, MassRole.Greeble, [t * 0.8, diag, t * 0.8],
        [x, y, z], 'stripe', {
          rot: alongZ ? [s * (Math.PI * 0.5 - ang), 0, 0] : [0, 0, s * (Math.PI * 0.5 - ang)],
          group: tag, chamfer: 0.03,
        }));
    }
    out.push(box(`${tag}.rung${i}`, MassRole.Greeble,
      alongZ ? [t * 0.8, t * 0.8, w] : [w, t * 0.8, t * 0.8],
      [x, (i + 1) * bayH, z], 'stripe', { group: tag, chamfer: 0.03 }));
  }
  return out;
}

/** SOVIET-5: a railed catwalk. Three horizontal rails plus posts, per the bible. */
function catwalk(w: number, d: number, y: number, tag: string): M[] {
  const out: M[] = [
    plate(`${tag}.deck`, MassRole.Greeble, taperOutline(w, d, 0.94), 0.18, [0, y, 0], undefined, 'grille',
      { group: tag, chamfer: 0.04 }),
  ];
  for (let r = 0; r < BUILDING_GEOMETRY.railingRails; r++) {
    const ry = y + 0.28 + r * 0.32;
    for (const s of [1, -1]) {
      out.push(box(`${tag}.rail${r}${s}`, MassRole.Greeble, [w, 0.09, 0.09], [0, ry, s * d * 0.5], 'bareMetal', {
        group: tag, chamfer: 0.02,
      }));
    }
  }
  for (let i = -1; i <= 1; i++) {
    out.push(box(`${tag}.post${i}`, MassRole.Greeble, [0.11, 1.0, 0.11], [i * w * 0.36, y + 0.5, d * 0.5], 'bareMetal', {
      mirrorX: false, group: tag, chamfer: 0.02,
    }));
  }
  return out;
}

/**
 * Lit window strips. R-T5: emissives are 1-3% of surface as clean rounded
 * rectangles, cyan for the Allies and orange furnace for the Soviets. Tagged
 * `Feature.Window` so interior fire shows through them when the structure is
 * burning (bible 8.8).
 */
function windows(
  w: number, y: number, z: number, count: number, cellW: number, cellH: number, tag: string,
): M[] {
  const out: M[] = [];
  const pitch = w / count;
  for (let i = 0; i < count; i++) {
    const x = -w * 0.5 + (i + 0.5) * pitch;
    out.push(box(`${tag}${i}`, MassRole.Emissive, [cellW, cellH, 0.10], [x, y, z], 'emissive', {
      group: tag, feature: Feature.Window, chamfer: 0.03,
    }));
  }
  return out;
}

/**
 * A structure's whole lit-window budget: a row on each long facade plus a roof
 * light bar.
 *
 * R-T5 wants 1-3% of surface emissive, and one facade of five small plates
 * measures 0.15% -- invisible. The roof bar does most of the work: at a
 * 39-degree camera a horizontal face contributes 0.63 of its area to the frame
 * against 0.25 for a flank, so it buys 2.5x the read per square metre, which is
 * also exactly why R-T3 says top-facing surfaces.
 */
function windowSet(
  w: number, d: number, bodyH: number, count: number, cellW: number, cellH: number,
): M[] {
  const out: M[] = [];
  for (const sgn of [1, -1]) {
    out.push(...windows(w * 0.66, bodyH * 0.34, sgn * (d * 0.5 + 0.04), count,
      w * cellW, bodyH * cellH, `win${sgn > 0 ? 'F' : 'B'}`));
  }
  // Clean rounded rectangles only (R-T5), never a glow blob.
  out.push(box('win.roof', MassRole.Emissive, [w * 0.34, 0.14, d * 0.11], [0, bodyH + 0.05, d * 0.16], 'emissive', {
    group: 'roofLights', feature: Feature.Window, chamfer: 0.04,
  }));
  return out;
}

/** A flat team-colour panel insert (R-T2). Never a tint, never a gradient. */
function teamPanel(name: string, size: V3, anchor: V3, o?: Partial<M>): M {
  return box(name, MassRole.TeamSlab, size, anchor, 'teamSlab', { chamfer: 0.045, ...o });
}

/** The single insignia plate (R-T4). */
function insignia(size: number, anchor: V3, o?: Partial<M>): M {
  return box('insignia', MassRole.Insignia, [size, size, 0.14], anchor, 'insignia', {
    chamfer: 0.04, ...o,
  });
}

/* ==========================================================================
 * 3. THE SHELLS — bible 5.7, once, for every structure of a faction
 * ========================================================================== */

interface ShellOpts {
  key: string;
  /** Fraction of the footprint the body occupies. Leaves a pad margin. */
  inset?: number;
  /** Fraction of the roofline the massive body occupies. */
  bodyFraction?: number;
  /** ALLIED-3: emit two mirrored modules instead of one block. */
  paired?: boolean;
  /** Team panel scale. Tuned per structure to land R-T1's 5-8%. */
  team?: number;
  /** Windows per facade. */
  windowCount?: number;
}

interface Shell {
  masses: M[];
  /** Metres: body width, depth, roof height. */
  w: number;
  d: number;
  roofY: number;
}

/**
 * ALLIED SHELL — rounded, splayed, paired, banded, crowned.
 */
function alliedShell(fw: number, fh: number, height: number, o: ShellOpts): Shell {
  const inset = o.inset ?? 0.94;
  const w = fw * CELL * inset;
  const d = fh * CELL * inset;
  const bodyH = height * (o.bodyFraction ?? 0.56);
  const flare = BUILDING_GEOMETRY.alliedSkirtFlare;
  const top = 1 / flare;
  const team = o.team ?? 1;
  const masses: M[] = [...foundationPad('allies', fw, fh, height)];

  // ALLIED-4 wants a 6-10% corner radius. A vertical corner CUT is the faceted
  // form of a radius and it is what turns a square plan into an octagonal one
  // from above — the single cheapest way to stop a body reading as a brick.
  const cut = Math.min(w, d) * 0.085;

  if (o.paired === true) {
    // ALLIED-3: two identical modules sharing an edge. Mirror, never monolith.
    const mw = w * 0.5;
    masses.push(tbox('module', MassRole.Primary, [mw - 0.18, bodyH, d], [mw * 0.5, bodyH * 0.5, 0], 'paintMed', {
      topScaleX: top, topScaleZ: top, cornerCut: cut * 0.7,
    }, { mirrorX: true }));
    // The shared spine that ties the pair together and hides the seam.
    masses.push(tbox('spine', MassRole.Primary, [w * 0.20, bodyH * 1.12, d * 0.62], [0, bodyH * 0.56, 0], 'paintMed', {
      topScaleX: top, topScaleZ: top, cornerCut: cut * 0.5,
    }));
  } else {
    masses.push(tbox('body', MassRole.Primary, [w, bodyH, d], [0, bodyH * 0.5, 0], 'paintMed', {
      topScaleX: top, topScaleZ: top, cornerCut: cut,
    }));
  }

  masses.push(...alliedBands(w, d, bodyH * 0.18, bodyH * 0.92));
  masses.push(...alliedCrown(w, height, bodyH));

  // ALLIED: real glass, not a painted window. A glazed band across the facade
  // and both flanks is the faction's single loudest cue.
  //
  // Authored as three thin PANELS rather than one glass volume on purpose. A
  // glass box spanning the plan contributes its enormous top face to the
  // surface budget, and the glass tile measures only 22% Sobel, so a solid
  // glass mass drags the whole structure two to three points below scorecard
  // #34's band for a surface the camera never sees from above anyway.
  const glassY = bodyH * 0.62;
  const gs = 1 - (1 - top) * (glassY / bodyH);
  // Raked to follow the skirt, so the glazing lies ON the wall instead of
  // hovering a hand's width off it.
  const rake = Math.atan2((1 - top) * Math.min(w, d) * 0.5, bodyH);
  masses.push(plate('glass.front', MassRole.Greeble,
    taperOutline(w * gs * 0.74, bodyH * 0.20, 0.94), 0.22,
    [0, glassY, d * gs * 0.5], [HALF_PI - rake, 0, 0], 'glass',
    { group: 'glass', chamfer: 0.06, tint: 0.92 }));
  masses.push(plate('glass.flank', MassRole.Greeble,
    taperOutline(d * gs * 0.66, bodyH * 0.20, 0.94), 0.22,
    [w * gs * 0.5, glassY, 0], [0, HALF_PI, HALF_PI - rake], 'glass',
    { mirrorX: true, group: 'glass', chamfer: 0.06, tint: 0.92 }));

  // R-T3: top-facing and outward-facing only. A roof chevron carries 2.5x the
  // screen area of the same panel on a flank at a 39-degree pitch.
  masses.push(teamPanel('team.roof', [w * 0.52 * team, 0.16, d * 0.30 * team], [0, bodyH + 0.06, 0]));
  for (const s of [1, -1]) {
    masses.push(teamPanel('team.flank', [0.16, bodyH * 0.34 * team, d * 0.44 * team],
      [s * (w * 0.5 - 0.10), bodyH * 0.44, 0]));
  }
  masses.push(teamPanel('team.facade', [w * 0.40 * team, bodyH * 0.16 * team, 0.16], [0, bodyH * 0.30, d * 0.5 - 0.02]));

  masses.push(insignia(Math.min(w, d) * 0.20, [w * 0.24, bodyH * 0.66, d * 0.5 + 0.02]));
  masses.push(...windowSet(w, d, bodyH, o.windowCount ?? 6, 0.085, 0.26));
  // Roof plant. This used to be two shallow boxes, which read as crates rather
  // than machinery from the game camera. The nacelle is now a transverse
  // aerospace turbine with a real round intake and a raised collar. It is broad
  // enough to cut the roof silhouette without competing with the command keel.
  // Broader than the old HVAC-sized barrel: this is the Allied signature
  // machine at game distance, paired with a clean low-volume vapour cycle.
  const turbineD = Math.min(w, d) * 0.15;
  masses.push(
    cyl('roof.turbine', MassRole.Greeble, [turbineD, w * 0.23, turbineD],
      [-w * 0.24, bodyH + turbineD * 0.34, -d * 0.22], 'vent', {
        rot: [0, 0, HALF_PI], segments: 12, topRadius: 0.88,
        capSlot: 'grille', group: 'roofPlant', chamfer: 0.06,
      }),
    cyl('roof.turbineCollar', MassRole.Greeble, [turbineD * 1.10, w * 0.045, turbineD * 1.10],
      [-w * 0.24, bodyH + turbineD * 0.34, -d * 0.22], 'bareMetal', {
        rot: [0, 0, HALF_PI], segments: 12, topRadius: 0.96,
        capSlot: 'grille', group: 'roofPlant', chamfer: 0.05,
      }),
    // Intake banks up both flanks. Real Allied plant, and the honest way to
    // buy back the scorecard #34 points the glass band and the flat team slabs
    // cost: the grille tile is the highest-frequency surface in the atlas.
    box('intake', MassRole.Greeble, [0.34, bodyH * 0.44, d * 0.44], [w * 0.44, bodyH * 0.30, -d * 0.10], 'grille', {
      mirrorX: true, group: 'intakes', chamfer: 0.05,
    }),
    box('service', MassRole.Greeble, [w * 0.20, bodyH * 0.22, 0.26], [-w * 0.28, bodyH * 0.20, d * 0.5 - 0.04], 'stencil', {
      group: 'service', chamfer: 0.05,
    }),
  );

  return { masses, w, d, roofY: bodyH };
}

/**
 * SOVIET SHELL — chamfered slab, corner rails, stacks, vessels, lattice, deck.
 */
function sovietShell(fw: number, fh: number, height: number, o: ShellOpts): Shell {
  const inset = o.inset ?? 0.94;
  const w = fw * CELL * inset;
  const d = fh * CELL * inset;
  const bodyH = height * (o.bodyFraction ?? 0.50);
  const team = o.team ?? 1;
  const masses: M[] = [...foundationPad('soviets', fw, fh, height)];

  // SOVIET-1: a slab with 45-degree chamfers on every vertical corner, reading
  // as octagonal in plan. Height:width ~0.75:1.
  //
  // Plus a BATTER. The old spelling was a `prism` with vertical walls and it
  // measured ~0.80 axis-aligned surface — the single worst number in the whole
  // roster, and exactly the "old-school 3D" read the user objected to. Poured
  // concrete of this mass never has a plumb face; leaning the wall 2% turns
  // eight vertical planes into eight canted ones and the flat-wall share goes
  // to zero without changing the silhouette a player recognises.
  masses.push(pplan('slab', MassRole.Primary, [w, bodyH, d], [0, bodyH * 0.5, 0], 'paintMed', {
    plan: cutBoxPlan(w, d, BUILDING_GEOMETRY.sovietCornerCut),
    topScaleX: 0.965, topScaleZ: 0.965, bottomScaleX: 1.015, bottomScaleZ: 1.015,
  }, { capSlot: 'paintMed' }));
  // The old second storey was another smaller box. It preserved the authored
  // height but made every Soviet building a stepped cube. A transverse cast
  // pressure spine preserves that height as a large rounded industrial mass,
  // with enough facets to remain smooth in a close camera without becoming a
  // glossy sci-fi cylinder.
  masses.push(
    cyl('pressure.spine', MassRole.Primary, [bodyH * 0.48, w * 0.72, bodyH * 0.48],
      [0, bodyH * 1.18, -d * 0.05], 'rivetPlate', {
        rot: [0, 0, HALF_PI], segments: 20, topRadius: 0.94, capSlot: 'paintMed',
      }),
    cyl('pressure.band', MassRole.Greeble, [bodyH * 0.52, w * 0.11, bodyH * 0.52],
      [w * 0.18, bodyH * 1.18, -d * 0.05], 'bareMetal', {
        rot: [0, 0, HALF_PI], segments: 20, topRadius: 1.0, group: 'pressureSpine',
      }),
  );
  // A raked buttress down each long flank. Layered plates on a battered slab is
  // the whole brutalist surface read, and each one costs 28 triangles.
  masses.push(plate('slab.buttress', MassRole.Greeble,
    taperOutline(d * 0.62, bodyH * 0.78, 0.72), 0.16,
    [w * 0.46, bodyH * 0.44, 0], [0, HALF_PI, HALF_PI - 0.06], 'rivetPlate',
    { mirrorX: true, group: 'buttresses' }));

  masses.push(...sovietRails(w, d, bodyH));

  // SOVIET-5: a lattice mast up one flank, tied to the upper slab.
  masses.push(...lattice(-w * 0.5 + 0.5, -d * 0.30, 1.5, bodyH * 1.55, 'gantry'));

  // R-T3: top-facing and outward-facing only, and NEVER as a volume. A "belt"
  // authored as a box spanning the plan hands its whole roof face to the team
  // budget and lands the structure at 17% -- twice R-T1's ceiling -- for a band
  // that is hidden under the upper slab anyway. Thin panels instead.
  masses.push(teamPanel('team.roof', [w * 0.44 * team, 0.18, d * 0.18 * team], [0, bodyH + 0.07, -d * 0.16]));
  masses.push(teamPanel('team.flank', [0.18, bodyH * 0.16 * team, d * 0.40 * team], [w * 0.5 - 0.06, bodyH * 0.70, 0], { mirrorX: true }));
  masses.push(teamPanel('team.facade', [w * 0.32 * team, bodyH * 0.18 * team, 0.18], [0, bodyH * 0.32, d * 0.5 - 0.02]));

  masses.push(insignia(Math.min(w, d) * 0.24, [-w * 0.24, bodyH * 0.62, d * 0.5 + 0.02]));
  masses.push(...windowSet(w, d, bodyH, o.windowCount ?? 5, 0.085, 0.28));
  // Twin cast exhausts replace the old roof crates. Their paired vertical
  // silhouette and oversized collars belong to the Soviet pressure-vessel
  // language; the Allied roof now reads horizontal while this one reads up.
  const exhaustD = Math.min(w, d) * 0.105;
  masses.push(
    cyl('roof.exhaust', MassRole.Greeble, [exhaustD, bodyH * 0.34, exhaustD],
      [w * 0.24, bodyH + bodyH * 0.13, -d * 0.24], 'rivetPlate', {
        mirrorX: true, segments: 10, topRadius: 0.70,
        capSlot: 'grille', group: 'roofPlant', chamfer: 0.06,
      }),
    cyl('roof.exhaustCollar', MassRole.Greeble, [exhaustD * 1.22, bodyH * 0.055, exhaustD * 1.22],
      [w * 0.24, bodyH + bodyH * 0.29, -d * 0.24], 'bareMetal', {
        mirrorX: true, segments: 10, topRadius: 0.90,
        capSlot: 'grille', group: 'roofPlant', feature: Feature.Piston, anim: 0.11, chamfer: 0.05,
      }),
  );

  return { masses, w, d, roofY: bodyH };
}

/* ==========================================================================
 * 4. STRUCTURES
 * ========================================================================== */

/**
 * Frozen dimensions for a structure key.
 *
 * `BUILDING_FOOTPRINTS` is the art module's own table and it is short of four
 * keys that `src/data/Defs.ts` already ships buildings for — `navalYard`,
 * `subPen`, `prismTower` and `flameTower`. Rather than invent numbers, fall
 * through to the two tables the DEFS use, so the art and the sim agree on
 * footprint and roofline by construction.
 *
 * FOR THE INTEGRATOR: the clean fix is one merge in `core/config.ts` —
 * `BUILDING_FOOTPRINTS` should be `{ ...BUILDING_DIMENSIONS, ...NAVAL_BUILDING_DIMENSIONS }`
 * with `techCentre`/`sentryGun`/`aaTurret` kept as the art-only aliases they
 * are. That file is owned elsewhere this round, so the fallback lives here.
 */
const EXTRA_DIMENSIONS: Readonly<Record<string, { w: number; h: number; height: number }>> = {
  ...BUILDING_DIMENSIONS,
  ...NAVAL_BUILDING_DIMENSIONS,
  // The neutral map furniture. Read from `src/data/Civilians.ts` rather than
  // re-typed here, because the def rows and the fallback table read the same
  // constant: a mass list built on a footprint the def does not share is a
  // building whose pad is the wrong size for its own occupancy rectangle, and
  // NOTHING in the suite compares those two numbers.
  ...CIVILIAN_DIMENSIONS,
};

function fp(key: string): { w: number; h: number; height: number } {
  const f = BUILDING_FOOTPRINTS[key] ?? EXTRA_DIMENSIONS[key];
  if (f === undefined) throw new Error(`[buildings] no footprint for "${key}"`);
  return f;
}

function list(
  key: string, name: string, faction: StructureFaction, dimKey: string,
  masses: M[], sockets: StructureSocket[], extra?: Partial<StructureMassList>,
): StructureMassList {
  const f = fp(dimKey);
  return {
    key, name, faction,
    footprintW: f.w, footprintH: f.h, height: f.height,
    masses, sockets, ...extra,
  };
}

/** Smoke, exit and dock anchors every production structure publishes. */
function baseSockets(d: number, stackTop: number, stackX: number, stackZ: number): StructureSocket[] {
  return [
    { part: PartId.Stack, pos: [stackX, stackTop, stackZ] },
    { part: PartId.ExitPoint, pos: [0, 0.2, d * 0.5 + 3.0] },
  ];
}

/* -- ALLIED --------------------------------------------------------------- */

function alliedConYard(): StructureMassList {
  const f = fp('conYard');
  const s = alliedShell(f.w, f.h, f.height, { key: 'conYard', paired: true, team: 1.15, windowCount: 6, bodyFraction: 0.52 });
  const roof = s.roofY;
  // The crane is the Construction Yard's whole silhouette read: a mast up one
  // corner and a jib across the roof. It also gives the structure its roofline.
  const mastTop = f.height;
  s.masses.push(
    tbox('crane.mast', MassRole.Primary, [0.9, mastTop - roof, 0.9], [-s.w * 0.34, (mastTop + roof) * 0.5, -s.d * 0.30], 'bareMetal', {
      topScaleX: 0.72, topScaleZ: 0.72, bottomScaleX: 1.18, bottomScaleZ: 1.18,
    }, { chamfer: 0.09 }),
    {
      name: 'crane.jib', primitive: 'extrude', role: MassRole.Primary,
      size: [0.62, 0.62, s.d * 0.94], anchor: [-s.w * 0.34, mastTop - 0.9, s.d * 0.02], slot: 'bareMetal',
      shape: {
        profile: ductSection(0.62),
        path: [[0, 0, -s.d * 0.47], [0, 0, -s.d * 0.10], [0, 0, s.d * 0.20], [0, 0, s.d * 0.47]],
        scale: [1.0, 0.94, 0.80, 0.66], capStart: true, capEnd: true,
      },
    },
    box('crane.hook', MassRole.Greeble, [0.30, 1.5, 0.30], [-s.w * 0.34, mastTop - 2.4, s.d * 0.42], 'bareMetal', { group: 'crane', chamfer: 0.05 }),
    box('crane.house', MassRole.Greeble, [1.5, 1.2, 1.7], [-s.w * 0.34, roof + 0.6, -s.d * 0.30], 'hatch', { group: 'crane' }),
    // The dozer bay: a leaf that retracts into the floor when the yard works.
    box('bay.lintel', MassRole.Greeble, [s.w * 0.36, 0.5, 0.5], [0, roof * 0.60, s.d * 0.5 + 0.06], 'stripe', { group: 'bay', chamfer: 0.06 }),
    box('bay.door', MassRole.Greeble, [s.w * 0.32, roof * 0.56, 0.34], [0, roof * 0.28, s.d * 0.5 + 0.02], 'hatch', {
      group: 'bay', feature: Feature.Door, anim: roof * 0.60, chamfer: 0.05,
    }),
  );
  return list('allied_conyard', 'Construction Yard', 'allies', 'conYard', s.masses, [
    ...baseSockets(s.d, f.height, -s.w * 0.34, -s.d * 0.30),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
    { part: PartId.Crane, pos: [-s.w * 0.34, f.height - 2.4, s.d * 0.52] },
    { part: PartId.FlagPole, pos: [s.w * 0.40, s.roofY, -s.d * 0.36] },
  ]);
}

function alliedPower(): StructureMassList {
  const f = fp('powerPlant');
  const s = alliedShell(f.w, f.h, f.height, { key: 'powerPlant', paired: true, team: 1.12, windowCount: 4, bodyFraction: 0.48 });
  const roof = s.roofY;
  // Twin cooling towers. ALLIED architecture is clean tech, so they are
  // waisted ceramic drums with a chrome collar, not brick chimneys.
  for (const sgn of [1, -1]) {
    s.masses.push(
      cyl(`tower${sgn}`, MassRole.Primary, [s.w * 0.30, f.height - roof, s.w * 0.30], [sgn * s.w * 0.26, (f.height + roof) * 0.5, -s.d * 0.16], 'paintMed', {
        topRadius: 1.22, group: `tower${sgn}`, capSlot: 'grille',
      }),
      cyl(`tower${sgn}.collar`, MassRole.Greeble, [s.w * 0.34, 0.34, s.w * 0.34], [sgn * s.w * 0.26, roof + 0.5, -s.d * 0.16], 'bareMetal', {
        group: `tower${sgn}`, chamfer: 0.05, capSlot: 'grille',
      }),
      cyl(`tower${sgn}.glow`, MassRole.Emissive, [s.w * 0.30, 0.30, s.w * 0.30], [sgn * s.w * 0.26, f.height - 0.22, -s.d * 0.16], 'emissive', {
        group: `tower${sgn}`, chamfer: 0.04, capSlot: 'emissive', feature: Feature.Window,
      }),
    );
  }
  s.masses.push(
    box('transformer', MassRole.Greeble, [s.w * 0.24, roof * 0.44, s.d * 0.20], [0, roof * 0.22, s.d * 0.40], 'grille', { group: 'transformer' }),
    box('conduit', MassRole.Greeble, [s.w * 0.62, 0.26, 0.26], [0, roof + 0.9, -s.d * 0.16], 'bareMetal', { group: 'transformer', chamfer: 0.05 }),
  );
  return list('allied_power', 'Power Plant', 'allies', 'powerPlant', s.masses,
    baseSockets(s.d, f.height, s.w * 0.26, -s.d * 0.16));
}

function alliedBarracks(): StructureMassList {
  const f = fp('barracks');
  const s = alliedShell(f.w, f.h, f.height, { key: 'barracks', paired: true, team: 1.25, windowCount: 6, bodyFraction: 0.62 });
  const roof = s.roofY;
  s.masses.push(
    // A canted entrance canopy over the muster door.
    box('canopy', MassRole.Primary, [s.w * 0.52, 0.34, s.d * 0.24], [0, roof * 0.74, s.d * 0.34], 'paintMed', {
      rot: [-0.20, 0, 0], chamfer: 0.08,
    }),
    box('canopy.post', MassRole.Greeble, [0.20, roof * 0.72, 0.20], [s.w * 0.22, roof * 0.36, s.d * 0.42], 'bareMetal', {
      mirrorX: true, group: 'canopy', chamfer: 0.04,
    }),
    box('door', MassRole.Greeble, [s.w * 0.24, roof * 0.56, 0.30], [0, roof * 0.28, s.d * 0.5 + 0.02], 'hatch', {
      group: 'door', feature: Feature.Door, anim: roof * 0.60, chamfer: 0.05,
    }),
    box('vent', MassRole.Greeble, [s.w * 0.30, 0.9, s.d * 0.22], [-s.w * 0.22, roof + 0.45, -s.d * 0.24], 'vent', { group: 'vent' }),
    box('mast', MassRole.Greeble, [0.16, f.height - roof - 1.2, 0.16], [s.w * 0.36, (f.height + roof) * 0.5 - 0.6, -s.d * 0.34], 'bareMetal', {
      group: 'mast', chamfer: 0.04,
    }),
  );
  return list('allied_barracks', 'Barracks', 'allies', 'barracks', s.masses, [
    ...baseSockets(s.d, roof + 1.0, -s.w * 0.22, -s.d * 0.24),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
  ]);
}

function alliedRefinery(): StructureMassList {
  const f = fp('refinery');
  const s = alliedShell(f.w, f.h, f.height, { key: 'refinery', team: 1.16, windowCount: 5, bodyFraction: 0.50 });
  const roof = s.roofY;
  s.masses.push(
    // The silo drum, and the dock canopy a harvester unloads under.
    cyl('silo', MassRole.Primary, [s.w * 0.34, f.height - roof - 0.6, s.w * 0.34], [-s.w * 0.26, (f.height + roof) * 0.5 - 0.3, -s.d * 0.12], 'paintMed', {
      group: 'silo', capSlot: 'grille',
    }),
    cyl('silo.cap', MassRole.Greeble, [s.w * 0.38, 0.42, s.w * 0.38], [-s.w * 0.26, f.height - 0.5, -s.d * 0.12], 'bareMetal', {
      group: 'silo', chamfer: 0.06, capSlot: 'grille',
    }),
    box('dock.canopy', MassRole.Primary, [s.w * 0.46, 0.42, s.d * 0.46], [s.w * 0.24, roof * 0.92, s.d * 0.20], 'paintMed', { chamfer: 0.08 }),
    box('dock.leg', MassRole.Greeble, [0.26, roof * 0.90, 0.26], [s.w * 0.42, roof * 0.45, s.d * 0.38], 'bareMetal', {
      group: 'dock', chamfer: 0.05,
    }),
    box('conveyor', MassRole.Greeble, [s.w * 0.20, 0.34, s.d * 0.52], [s.w * 0.10, roof * 0.34, s.d * 0.20], 'tread', {
      group: 'conveyor', rot: [-0.12, 0, 0], chamfer: 0.05,
    }),
    box('pipe', MassRole.Greeble, [s.w * 0.44, 0.28, 0.28], [-s.w * 0.04, roof + 0.7, -s.d * 0.12], 'bareMetal', {
      group: 'pipes', chamfer: 0.05,
    }),
  );
  return list('allied_refinery', 'Ore Refinery', 'allies', 'refinery', s.masses, [
    ...baseSockets(s.d, f.height, -s.w * 0.26, -s.d * 0.12),
    { part: PartId.DockEntry, pos: [s.w * 0.24, 0.2, s.d * 0.5 + 2.4] },
    { part: PartId.Conveyor, pos: [s.w * 0.10, s.roofY * 0.5, s.d * 0.5] },
  ]);
}

function alliedWarFactory(): StructureMassList {
  const f = fp('warFactory');
  const w = f.w * CELL * 0.94;
  const d = f.h * CELL * 0.94;
  const bodyH = f.height * 0.40;
  const finH = f.height - bodyH;
  const masses: M[] = [...foundationPad('allies', f.w, f.h, f.height)];
  masses.push(
    // A single low chined hangar hull. It occupies the footprint but not the
    // skyline, and its hard-swept bow makes the production exit the building's
    // dominant face rather than another windowed wall.
    tbox('hangar.hull', MassRole.Primary, [w, bodyH, d * 0.88], [0, bodyH * 0.5, -d * 0.04], 'paintMed', {
      topScaleX: 0.78, topScaleZ: 0.86, shear: -d * 0.08, cornerCut: 0.20,
    }, { capSlot: 'paintSmall', chamfer: 0.12 }),
    // Twin load-bearing ceramic wings. These are deliberately enormous primary
    // surfaces: the old model spent the same area on four decorative bands.
    plate('hangar.wing', MassRole.Primary,
      [[-w * 0.17, -d * 0.39], [w * 0.18, -d * 0.29], [w * 0.14, d * 0.38], [-w * 0.10, d * 0.30]],
      0.42, [w * 0.25, bodyH + 0.24, -d * 0.02], [-0.045, 0, -0.09], 'paintMed', {
        mirrorX: true, group: 'hangarWings', capSlot: 'paintSmall', chamfer: 0.10,
      }),
    // Rear tail fins carry the frozen height as two razor silhouettes, with
    // air between them. Nothing here resembles a second storey.
    tbox('hangar.fin', MassRole.Primary, [w * 0.09, finH, d * 0.18],
      [w * 0.27, bodyH + finH * 0.5, -d * 0.30], 'paintMed', {
        topScaleX: 0.28, topScaleZ: 0.42, shear: -d * 0.05, cornerCut: 0.16,
      }, { mirrorX: true, capSlot: 'glass', chamfer: 0.08 }),
    tbox('hangar.bridge', MassRole.Primary, [w * 0.30, bodyH * 0.40, d * 0.30],
      [0, bodyH + bodyH * 0.22, -d * 0.25], 'paintSmall', {
        topScaleX: 0.62, topScaleZ: 0.58, shear: -d * 0.035, cornerCut: 0.20,
      }, { capSlot: 'glass', chamfer: 0.10 }),
    box('hangar.glass', MassRole.Greeble, [w * 0.22, bodyH * 0.15, 0.14],
      [0, bodyH * 1.18, -d * 0.405], 'glass', { group: 'bridge', chamfer: 0.05 }),
    // The bay is a dark opening cut into a pale bow, framed by one cobalt arch.
    box('bay.door', MassRole.Greeble, [w * 0.50, bodyH * 0.63, 0.26],
      [0, bodyH * 0.315, d * 0.405], 'hatch', {
        group: 'bay', feature: Feature.Door, anim: bodyH * 0.66, chamfer: 0.08,
      }),
    tbox('bay.brow', MassRole.TeamSlab, [w * 0.62, bodyH * 0.17, 0.44],
      [0, bodyH * 0.76, d * 0.415], 'teamSlab', {
        topScaleX: 0.82, topScaleZ: 0.62, cornerCut: 0.14,
      }, { chamfer: 0.08 }),
    box('wing.team', MassRole.TeamSlab, [w * 0.13, 0.12, d * 0.50],
      [w * 0.25, bodyH + 0.47, -d * 0.02], 'teamSlab', {
        mirrorX: true, group: 'wingMarkings', chamfer: 0.04,
      }),
    box('wing.light', MassRole.Emissive, [0.20, 0.14, d * 0.66],
      [w * 0.17, bodyH + 0.48, 0], 'emissive', {
        mirrorX: true, group: 'runwayLights', feature: Feature.Window, chamfer: 0.03,
      }),
    box('service.intake', MassRole.Greeble, [0.24, bodyH * 0.28, d * 0.22],
      [w * 0.45, bodyH * 0.34, -d * 0.18], 'vent', {
        mirrorX: true, group: 'serviceIntakes', chamfer: 0.05,
      }),
    box('service.hatch', MassRole.Greeble, [w * 0.16, 0.14, d * 0.12],
      [w * 0.30, bodyH + 0.18, -d * 0.27], 'hatch', {
        mirrorX: true, group: 'serviceHatches', chamfer: 0.04,
      }),
    tbox('wing.root', MassRole.Greeble, [w * 0.14, 0.34, d * 0.30],
      [w * 0.18, bodyH + 0.18, -d * 0.12], 'paintSmall', {
        topScaleX: 0.58, topScaleZ: 0.74, shear: -d * 0.025, cornerCut: 0.18,
      }, { mirrorX: true, group: 'wingRoots', chamfer: 0.07 }),
    box('bridge.sensor', MassRole.Greeble, [w * 0.18, 0.16, 0.20],
      [0, bodyH * 1.46, -d * 0.25], 'bareMetal', {
        group: 'bridge', faceSlots: { pz: 'glass' }, chamfer: 0.05,
      }),
    tbox('bay.cheek', MassRole.Greeble, [w * 0.10, bodyH * 0.30, 0.34],
      [w * 0.32, bodyH * 0.37, d * 0.42], 'paintSmall', {
        topScaleX: 0.64, topScaleZ: 0.78, cornerCut: 0.12,
      }, { mirrorX: true, group: 'bayCheeks', chamfer: 0.05 }),
    insignia(w * 0.13, [w * 0.33, bodyH * 0.58, d * 0.405]),
  );
  return list('allied_warfactory', 'War Factory', 'allies', 'warFactory', masses, [
    ...baseSockets(d, f.height, -w * 0.27, -d * 0.30),
    { part: PartId.Door, pos: [0, 0.2, d * 0.5 + 0.4] },
    { part: PartId.Crane, pos: [0, bodyH + 0.8, -d * 0.12] },
  ]);
}

/**
 * ALLIED REPAIR DEPOT — a vehicle service pad, not a garage.
 *
 * The frozen roofline is 6.5 m — only the Ore Silo (5.0) and the Barracks
 * (6.4) sit lower — and that is a gameplay number rather than a style one: at the fixed
 * 38-degree camera a shed tall enough to enclose a tank would hide the tank
 * that is being serviced under it. So the silhouette is AN OPEN GANTRY OVER A
 * LOW DECK. The shell is asked for a small body — `inset` 0.72 and
 * `bodyFraction` 0.32 put its crown at 4.2 m — and everything above that is
 * steel and air, which is also what keeps rule 8 satisfiable: the cross-head
 * carries the last 2.3 m of the model on its own.
 */
function alliedDepot(): StructureMassList {
  const f = fp('repairDepot');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'repairDepot', inset: 0.72, bodyFraction: 0.32, team: 1.10, windowCount: 3,
  });
  const roof = s.roofY;
  // The portal: a cross-head at the roofline on two legs standing OUTSIDE the
  // body, so the span between them stays open all the way to the pad.
  const headH = 0.58;
  const headY = f.height - headH * 0.5;
  const legH = f.height - headH;
  const legX = s.w * 0.58;
  s.masses.push(
    // Tapered in both plan axes on purpose: this is the widest mass in the
    // model and a plain beam here would hand the boxiness gate a flat 7 m wall
    // at eye level, which is the one place it is most visible.
    tbox('gantry.head', MassRole.Primary, [legX * 2 + 0.5, headH, 1.15], [0, headY, -0.60], 'bareMetal', {
      topScaleX: 0.86, topScaleZ: 0.64, cornerCut: 0.18,
    }, { chamfer: 0.07 }),
    cyl('gantry.leg', MassRole.Greeble, [0.44, legH, 0.44], [legX, legH * 0.5, -0.60], 'bareMetal', {
      mirrorX: true, topRadius: 0.70, segments: 12, group: 'gantry', capSlot: 'grille',
    }),
    // THE SIGNATURE: a chromed hoist rail hung under the head and cantilevered
    // forward past the body, so the arm reaches over the deck rather than
    // roofing it. Swept hex section — an extrude scores zero axis-aligned wall.
    {
      name: 'hoist.rail', primitive: 'extrude', role: MassRole.Primary,
      size: [0.54, 0.54, 6.5], anchor: [0, legH - 0.27, 0.85], slot: 'bareMetal',
      shape: {
        profile: ductSection(0.54),
        path: [[0, 0, -3.25], [0, 0, -1.05], [0, 0, 1.35], [0, 0, 3.25]],
        scale: [1.0, 0.95, 0.82, 0.66], capStart: true, capEnd: true,
      },
    },
    // The trolley is parked at the FAR end of the rail, clear of the canopy
    // below it, and each of these three hangs off the underside of the one
    // above with no air in between — a hoist that floats reads as a bug.
    box('hoist.trolley', MassRole.Greeble, [0.78, 0.66, 0.94], [0, legH - 0.87, 3.50], 'hatch', {
      group: 'hoist', chamfer: 0.06,
    }),
    cyl('hoist.hook', MassRole.Greeble, [0.24, 1.6, 0.24], [0, legH - 2.00, 3.50], 'bareMetal', {
      group: 'hoist', segments: 8, chamfer: 0.03, capSlot: 'grille',
    }),
    // A tie rod from the head down to the rail's nose. The rail cantilevers
    // 4.2 m off a single portal and without this it reads as floating.
    box('gantry.stay', MassRole.Greeble, [0.12, 0.12, 4.23], [0, 6.16, 1.80], 'bareMetal', {
      rot: [0.114, 0, 0], group: 'gantry', chamfer: 0.03,
    }),
    // The canted service canopy, tucked into the crown's front face and
    // stopping short of the hoist. A raked plate rather than a box: it is the
    // Allied read (clean tech, everything angled) and a rotated plate is all
    // rim, so it buys silhouette without buying flat wall.
    plate('canopy', MassRole.Primary, taperOutline(s.w * 0.96, 1.9, 0.76), 0.30,
      [0, roof * 1.44, 2.05], [-0.32, 0, 0], 'paintMed',
      { chamfer: 0.06, capSlot: 'paintSmall' }),
    // Only the middle of that canopy lands on the crown; its outer wings need
    // a foot, exactly as the Barracks canopy does.
    box('canopy.post', MassRole.Greeble, [0.20, 0.98, 0.20], [2.10, 2.57, 2.72], 'bareMetal', {
      mirrorX: true, group: 'canopy', chamfer: 0.04,
    }),
    // The deck the vehicle noses onto, in tread plate, and set FORWARD of the
    // body: a deck plate under the body would be buried in it, and the whole
    // point of a 6.5 m roofline is that this surface stays on screen.
    plate('deck', MassRole.Greeble, taperOutline(s.w * 1.14, 2.4, 0.88), 0.22,
      [0, 0.13, 3.35], undefined, 'tread', { group: 'deck', chamfer: 0.04 }),
    cyl('compressor', MassRole.Greeble, [1.05, 1.15, 1.05], [-s.w * 0.50, 0.58, -1.55], 'grille', {
      group: 'plant', segments: 12, capSlot: 'hatch',
    }),
    greebleRun('hose.run', 2.6, 0.24, 0.20, [s.w * 0.50, 0.62, -0.20], 0x4D07),
    // Work lamps on the cross-head, aimed down at the deck. R-T5's floor is
    // 0.6% and the shell's three-window facade lands exactly on it on a body
    // this short, so these are the margin as much as they are the lighting.
    box('lamp', MassRole.Emissive, [0.54, 0.18, 0.40], [legX * 0.54, legH - 0.09, -0.60], 'emissive', {
      mirrorX: true, group: 'lamps', feature: Feature.Window, chamfer: 0.04,
    }),
  );
  return list('allied_depot', 'Repair Depot', 'allies', 'repairDepot', s.masses, [
    ...baseSockets(s.d, roof + 0.9, -s.w * 0.26, -s.d * 0.22),
    // The service point is under the hoist, not at a door: nothing is produced
    // here, so `Crane` is the arm the repair VFX hangs off.
    { part: PartId.Crane, pos: [0, legH - 2.80, 3.50] },
  ]);
}

function alliedRadar(): StructureMassList {
  const f = fp('radar');
  const s = alliedShell(f.w, f.h, f.height, { key: 'radar', team: 1.1, windowCount: 4, bodyFraction: 0.42 });
  const roof = s.roofY;
  // The tower and the sweeping dish. The dish spins about the model Y axis, so
  // its mast is authored on the centre line — see the shader note.
  const towerTop = f.height - 3.8;
  s.masses.push(
    cyl('tower', MassRole.Primary, [s.w * 0.34, towerTop - roof, s.w * 0.34], [0, (towerTop + roof) * 0.5, 0], 'paintMed', {
      topRadius: 0.86, capSlot: 'paintSmall',
    }),
    cyl('tower.ring', MassRole.Greeble, [s.w * 0.42, 0.30, s.w * 0.42], [0, towerTop - 0.2, 0], 'bareMetal', {
      group: 'tower', chamfer: 0.05, capSlot: 'grille',
    }),
    cyl('dish.hub', MassRole.Primary, [1.3, 0.9, 1.3], [0, towerTop + 0.6, 0], 'bareMetal', {
      feature: Feature.Spinner, anim: BUILDING_GEOMETRY.railSegments * 0, capSlot: 'hatch',
    }),
    // The dish itself: a canted disc offset from the axis, so the sweep reads.
    { name: 'dish', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [4.4, 1.6, 4.4], anchor: [0.85, towerTop + 1.5, 0], slot: 'paintMed',
      rot: [-0.50, 0, 0.28], capSlot: 'grille', feature: Feature.Spinner },
    box('dish.arm', MassRole.Greeble, [1.9, 0.20, 0.20], [0.5, towerTop + 1.0, 0], 'bareMetal', {
      group: 'dish', feature: Feature.Spinner, chamfer: 0.04,
    }),
    box('dish.feed', MassRole.Emissive, [0.5, 0.5, 0.5], [1.5, towerTop + 2.2, 0], 'emissive', {
      group: 'dish', feature: Feature.Spinner, chamfer: 0.05,
    }),
  );
  // The spin rate has to reach the shader through `anim`, and only spinner
  // masses read it. Set it on every one of them.
  for (const m of s.masses) {
    if (m.feature === Feature.Spinner) (m as { anim?: number }).anim = BUILDING_GEOMETRY.cylSegments * 0 + 0.55;
  }
  return list('allied_radar', 'Radar Dome', 'allies', 'radar', s.masses, [
    ...baseSockets(s.d, roof + 1.0, -s.w * 0.30, -s.d * 0.30),
    { part: PartId.Dish, pos: [0, towerTop + 1.6, 0] },
    { part: PartId.Antenna, pos: [0, f.height, 0] },
  ]);
}

function alliedTech(): StructureMassList {
  const f = fp('techCentre');
  const s = alliedShell(f.w, f.h, f.height, { key: 'techCentre', paired: true, team: 1.1, windowCount: 6, bodyFraction: 0.54 });
  const roof = s.roofY;
  s.masses.push(
    // A glass laboratory drum with a chrome coil ring: clean tech, visible work.
    cyl('lab', MassRole.Primary, [s.w * 0.44, f.height - roof - 1.0, s.w * 0.44], [0, (f.height + roof) * 0.5 - 0.5, s.d * 0.06], 'glass', {
      group: 'lab', capSlot: 'paintSmall', tint: 0.95,
    }),
    cyl('lab.ring', MassRole.Greeble, [s.w * 0.50, 0.34, s.w * 0.50], [0, roof + 0.4, s.d * 0.06], 'bareMetal', {
      group: 'lab', chamfer: 0.05, capSlot: 'grille',
    }),
    cyl('lab.core', MassRole.Emissive, [s.w * 0.20, f.height - roof - 2.2, s.w * 0.20], [0, (f.height + roof) * 0.5 - 0.6, s.d * 0.06], 'emissive', {
      group: 'lab', chamfer: 0.05, capSlot: 'emissive', feature: Feature.Window,
    }),
    cyl('lab.cap', MassRole.Primary, [s.w * 0.46, 0.9, s.w * 0.46], [0, f.height - 0.45, s.d * 0.06], 'paintMed', {
      topRadius: 0.72, capSlot: 'grille',
    }),
    box('coolant', MassRole.Greeble, [s.w * 0.18, roof * 0.5, s.d * 0.18], [s.w * 0.34, roof * 0.25, -s.d * 0.32], 'grille', {
      mirrorX: true, group: 'coolant',
    }),
  );
  return list('allied_tech', 'Tech Centre', 'allies', 'techCentre', s.masses,
    baseSockets(s.d, roof + 0.8, s.w * 0.34, -s.d * 0.32));
}

/**
 * THE COMMAND POST (Allied). The structure the Powers tab hangs off.
 *
 * THE BUILDING IS AN AERIAL, and that is the whole silhouette brief: it sells
 * nothing you can see on the ground, so the only thing an opponent can read
 * from across the map is what it is REACHING FOR. `commandPost` is 10.5 m
 * against the Tech Centre's 8.0 on the same 2x2 plan, and every one of those
 * two and a half metres belongs to the mast — a raked whip on a guyed collar,
 * a beacon under its cap, and a horizontal yagi across the top that reads as an
 * antenna from any angle.
 *
 * `bodyFraction` 0.40 rather than the Tech Centre's 0.54. The shell tops out at
 * 4.2 m, which leaves 6.3 m of clear air for the mast to occupy: a taller body
 * would put the aerial's base above the camera's read of the roofline and the
 * structure would look like a lab with a stick on it. The height gate's
 * tolerance is +/-12%, so the mast is load-bearing in the validator's sense as
 * well as the architect's.
 *
 * NOT A SECOND RADAR DOME. The Radar Dome's cue is a SWEEPING dish — a lathe on
 * a `Feature.Spinner` — and this deliberately has none: nothing here rotates.
 * A commander power is called, not scanned for, and two structures with the
 * same moving part would be two structures a player has to read the label of.
 */
function alliedCommandPost(): StructureMassList {
  const f = fp('commandPost');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'commandPost', paired: true, team: 1.16, windowCount: 5, bodyFraction: 0.40,
  });
  const roof = s.roofY;
  const collarY = roof + 0.9;
  const mastTop = f.height - 0.9;
  const mastH = mastTop - collarY;
  s.masses.push(
    // The collar the whip stands in: a squat tapered drum, wider than the mast
    // by enough that the join reads as engineering rather than as a seam.
    cyl('mast.collar', MassRole.Primary, [s.w * 0.30, 1.8, s.w * 0.30], [0, collarY, s.d * 0.04], 'paintMed', {
      topRadius: 0.62, capSlot: 'grille', segments: 12,
    }),
    // The whip. Tapered to a quarter of its base and RAKED, so the tallest line
    // in the model is not a vertical one — a plumb pole against the sky is the
    // one shape on this structure that could still read as a box edge.
    cyl('mast', MassRole.Primary, [0.82, mastH, 0.82], [0, collarY + mastH * 0.5, s.d * 0.04], 'bareMetal', {
      topRadius: 0.26, rot: [0.06, 0, -0.05], capSlot: 'grille', segments: 10,
    }),
    // The yagi: three elements on the whip, longest at the bottom. Boxes, and
    // correctly so — an antenna element IS a bar — and they cost the boxiness
    // gate nothing because their projected wall area is a rounding error.
    box('yagi.lo', MassRole.Greeble, [3.10, 0.16, 0.16], [0, mastTop - 1.55, s.d * 0.04], 'bareMetal', {
      group: 'yagi', chamfer: 0.04,
    }),
    box('yagi.mid', MassRole.Greeble, [2.40, 0.15, 0.15], [0, mastTop - 0.95, s.d * 0.04], 'bareMetal', {
      group: 'yagi', chamfer: 0.04,
    }),
    box('yagi.hi', MassRole.Greeble, [1.70, 0.14, 0.14], [0, mastTop - 0.42, s.d * 0.04], 'bareMetal', {
      group: 'yagi', chamfer: 0.04,
    }),
    // The beacon. One small emissive at the very top: an aerial's obstruction
    // light, and the only thing on the structure that is lit from outside.
    cyl('beacon', MassRole.Emissive, [0.44, 0.50, 0.44], [0, mastTop + 0.30, s.d * 0.04], 'emissive', {
      capSlot: 'emissive', feature: Feature.Window, segments: 8, chamfer: 0.05,
    }),
    // Guy stays down to the roof, mirrored. Running gear for the mast, which is
    // what the mirror exemption is for.
    cyl('guy', MassRole.Greeble, [0.16, 3.0, 0.16], [s.w * 0.26, collarY + 1.1, -s.d * 0.20], 'bareMetal', {
      mirrorX: true, group: 'guys', rot: [0.10, 0, 0.32], segments: 6,
    }),
    // The signals cabin against one flank: the room the requisition is sent
    // from, and the mass that stops the roof reading as a bare deck.
    tbox('cabin', MassRole.Primary, [s.w * 0.34, 1.5, s.d * 0.40], [-s.w * 0.28, roof + 0.75, s.d * 0.18], 'paintMed', {
      topScaleX: 0.78, topScaleZ: 0.78, cornerCut: 0.22,
    }),
    box('cabin.duct', MassRole.Greeble, [s.w * 0.14, 0.9, 0.28], [-s.w * 0.28, roof + 0.45, s.d * 0.40], 'vent', {
      group: 'cabinDuct', chamfer: 0.05,
    }),
  );
  return list('allied_commandpost', 'Command Post', 'allies', 'commandPost', s.masses, [
    ...baseSockets(s.d, roof + 0.8, s.w * 0.34, -s.d * 0.32),
    { part: PartId.Antenna, pos: [0, f.height, 0] },
  ]);
}

function alliedPillbox(): StructureMassList {
  const f = fp('pillbox');
  const w = f.w * CELL * 0.80;
  const h = f.height;
  const masses: M[] = [
    ...foundationPad('allies', f.w, f.h, h),
    // A splayed hexagonal casemate. Turretless: the embrasure IS the weapon.
    pplan('casemate', MassRole.Primary, [w, h * 0.72, w], [0, h * 0.36, 0], 'paintMed', {
      plan: ngon(w * 0.5, w * 0.5, 6, HALF_PI / 3),
      topScaleX: 0.82, topScaleZ: 0.82, bottomScaleX: 1.06, bottomScaleZ: 1.06,
    }, { capSlot: 'paintSmall' }),
    pplan('cap', MassRole.Primary, [w * 0.80, h * 0.30, w * 0.80], [0, h * 0.84, 0], 'paintMed', {
      plan: ngon(w * 0.40, w * 0.40, 6, HALF_PI / 3), topScaleX: 0.88, topScaleZ: 0.88,
    }, { capSlot: 'grille' }),
    box('embrasure', MassRole.Primary, [w * 0.52, h * 0.24, 0.30], [0, h * 0.48, w * 0.42], 'grille', { chamfer: 0.04 }),
    cyl('barrel', MassRole.Greeble, [0.24, 1.5, 0.24], [0, h * 0.48, w * 0.52], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], group: 'gun', chamfer: 0.03, capSlot: 'grille',
    }),
    box('sandbag', MassRole.Greeble, [w * 0.30, h * 0.24, w * 0.18], [w * 0.42, h * 0.12, w * 0.30], 'paintSmall', {
      mirrorX: true, group: 'sandbags', chamfer: 0.10,
    }),
    box('periscope', MassRole.Greeble, [0.22, 0.46, 0.22], [-w * 0.20, h * 0.90, -w * 0.14], 'bareMetal', {
      group: 'optics', chamfer: 0.04,
    }),
    box('vent', MassRole.Greeble, [w * 0.22, 0.20, w * 0.22], [w * 0.20, h * 0.94, -w * 0.16], 'vent', { group: 'optics' }),
    // Three more readable objects: BUILDING_VALIDATION wants 5-26 on a defence
    // and this casemate shipped with three.
    plate('deflector', MassRole.Greeble, taperOutline(w * 0.62, h * 0.22, 0.72), 0.10,
      [0, h * 0.66, w * 0.36], [HALF_PI - 0.34, 0, 0], 'bareMetal', { group: 'deflector' }),
    greebleRun('cable.run', w * 0.52, 0.20, 0.16, [-w * 0.34, h * 0.16, -w * 0.20], 0x4B01),
    cyl('ammo.hatch', MassRole.Greeble, [w * 0.24, 0.22, w * 0.24], [-w * 0.26, h * 0.92, w * 0.12], 'hatch', {
      group: 'hatches', segments: 10, capSlot: 'grille',
    }),
    teamPanel('team.cap', [w * 0.44, 0.12, w * 0.30], [0, h * 0.96, 0]),
    teamPanel('team.chevron', [0.14, h * 0.26, w * 0.34], [w * 0.40, h * 0.42, 0], { mirrorX: true }),
    ...windows(w * 0.38, h * 0.80, w * 0.40, 2, 0.26, 0.16, 'lamp'),
  ];
  return list('allied_pillbox', 'Pillbox', 'allies', 'pillbox', masses, [
    { part: PartId.MuzzleA, pos: [0, h * 0.48, w * 0.62] },
  ], { cls: 'defence' });
}

function alliedAaTurret(): StructureMassList {
  const f = fp('aaTurret');
  const w = f.w * CELL * 0.78;
  const h = f.height;
  const ringY = h * 0.52;
  const masses: M[] = [
    ...foundationPad('allies', f.w, f.h, h),
    pplan('base', MassRole.Primary, [w, ringY * 0.86, w], [0, ringY * 0.43, 0], 'paintMed', {
      plan: ngon(w * 0.5, w * 0.5, 6, HALF_PI / 3),
      topScaleX: 0.78, topScaleZ: 0.78, bottomScaleX: 1.10, bottomScaleZ: 1.10,
    }, { capSlot: 'paintSmall' }),
    cyl('ring', MassRole.Primary, [w * 0.62, ringY * 0.20, w * 0.62], [0, ringY * 0.93, 0], 'bareMetal', {
      capSlot: 'grille',
    }),
    box('cable', MassRole.Greeble, [0.18, ringY * 0.70, 0.18], [w * 0.36, ringY * 0.35, -w * 0.30], 'bareMetal', {
      group: 'cables', chamfer: 0.03,
    }),
    box('genset', MassRole.Greeble, [w * 0.32, ringY * 0.34, w * 0.26], [-w * 0.28, ringY * 0.17, -w * 0.26], 'grille', { group: 'genset' }),
    teamPanel('team.skirt', [0.14, ringY * 0.44, w * 0.40], [w * 0.42, ringY * 0.40, 0], { mirrorX: true }),
    ...windows(w * 0.30, ringY * 0.62, w * 0.40, 2, 0.24, 0.16, 'lamp'),

    /* -- the slewing head, rebased onto the ring by the factory ------------ */
    pplan('head', MassRole.Primary, [w * 0.66, h * 0.26, w * 0.72], [0, ringY + h * 0.13, 0], 'paintMed', {
      plan: cutBoxPlan(w * 0.66, w * 0.72, 0.14),
      topScaleX: 0.84, topScaleZ: 0.88, shear: -w * 0.04,
    }, { capSlot: 'paintSmall', target: 'turret' }),
    cyl('tube', MassRole.Primary, [0.30, h * 0.44, 0.30], [w * 0.16, ringY + h * 0.30, w * 0.10], 'bareMetal', {
      mirrorX: true, rot: [-1.16, 0, 0], target: 'turret', group: 'tubes', capSlot: 'grille',
    }),
    box('radar.fin', MassRole.Greeble, [w * 0.36, h * 0.16, 0.14], [0, ringY + h * 0.30, -w * 0.30], 'grille', {
      target: 'turret', group: 'fin', chamfer: 0.04,
    }),
    cyl('ammo.drum', MassRole.Greeble, [w * 0.26, h * 0.14, w * 0.26], [w * 0.28, ringY + h * 0.10, -w * 0.22], 'hatch', {
      target: 'turret', group: 'ammo', segments: 12, capSlot: 'grille',
    }),
    greebleRun('base.run', w * 0.60, 0.22, 0.18, [-w * 0.34, ringY * 0.24, w * 0.10], 0x4A0C),
    cyl('optic.pod', MassRole.Greeble, [0.30, h * 0.10, 0.30], [-w * 0.24, ringY + h * 0.24, w * 0.16], 'bareMetal', {
      target: 'turret', group: 'optics', segments: 10, capSlot: 'glass',
    }),
    teamPanel('team.head', [w * 0.40, 0.12, w * 0.26], [0, ringY + h * 0.26, 0], { target: 'turret' }),
  ];
  return list('allied_aa', 'AA Battery', 'allies', 'aaTurret', masses, [
    { part: PartId.MuzzleA, pos: [w * 0.16, ringY + h * 0.52, w * 0.42], pitch: 1.16, turret: true },
    { part: PartId.MuzzleB, pos: [-w * 0.16, ringY + h * 0.52, w * 0.42], pitch: 1.16, turret: true },
  ], { cls: 'defence', turretPivot: [0, ringY, 0] });
}

/* -- SOVIET --------------------------------------------------------------- */

function sovietConYard(): StructureMassList {
  const f = fp('conYard');
  const s = sovietShell(f.w, f.h, f.height, { key: 'conYard', team: 1.0, windowCount: 5, bodyFraction: 0.46 });
  const roof = s.roofY;
  s.masses.push(
    ...sovietStack(s.w * 0.30, -s.d * 0.30, s.w * 0.11, roof * 1.4, f.height, 'stackA'),
    ...catwalk(s.w * 0.72, s.d * 0.22, roof * 1.42, 'walk'),
    {
      name: 'crane.jib', primitive: 'extrude', role: MassRole.Primary,
      size: [0.7, 0.7, s.d * 0.92], anchor: [-s.w * 0.5 + 0.5, roof * 1.55 + 0.5, s.d * 0.02], slot: 'bareMetal',
      shape: {
        profile: ductSection(0.70),
        path: [[0, 0, -s.d * 0.46], [0, 0, -s.d * 0.08], [0, 0, s.d * 0.22], [0, 0, s.d * 0.46]],
        scale: [1.0, 0.92, 0.78, 0.62], capStart: true, capEnd: true,
      },
    },
    box('crane.hook', MassRole.Greeble, [0.34, 1.7, 0.34], [-s.w * 0.5 + 0.5, roof * 1.55 - 0.6, s.d * 0.40], 'bareMetal', { group: 'crane', chamfer: 0.05 }),
    box('bay.lintel', MassRole.Greeble, [s.w * 0.40, 0.56, 0.56], [0, roof * 0.62, s.d * 0.5 + 0.08], 'stripe', { group: 'bay', chamfer: 0.06 }),
    box('bay.door', MassRole.Greeble, [s.w * 0.36, roof * 0.58, 0.34], [0, roof * 0.29, s.d * 0.5 + 0.02], 'hatch', {
      group: 'bay', feature: Feature.Door, anim: roof * 0.62, chamfer: 0.05,
    }),
  );
  return list('soviet_conyard', 'Construction Yard', 'soviets', 'conYard', s.masses, [
    ...baseSockets(s.d, f.height, s.w * 0.30, -s.d * 0.30),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
    { part: PartId.Crane, pos: [-s.w * 0.5 + 0.5, roof * 1.55 - 1.6, s.d * 0.50] },
    { part: PartId.FlagPole, pos: [s.w * 0.40, roof, -s.d * 0.38] },
  ]);
}

function sovietPower(): StructureMassList {
  const f = fp('powerPlant');
  const s = sovietShell(f.w, f.h, f.height, { key: 'powerPlant', team: 0.95, windowCount: 4, bodyFraction: 0.42 });
  const roof = s.roofY;
  s.masses.push(
    ...sovietStack(-s.w * 0.26, -s.d * 0.20, s.w * 0.13, roof * 1.42, f.height, 'stackA'),
    ...sovietVessel(s.w * 0.26, s.d * 0.14, s.w * BUILDING_GEOMETRY.sovietVesselRadius * 0.5, roof * 0.42, 'vesselA'),
    box('duct', MassRole.Greeble, [s.w * 0.52, 0.44, 0.44], [0, roof * 1.30, -s.d * 0.20], 'bareMetal', {
      group: 'ducts', chamfer: 0.06,
    }),
    box('duct.riser', MassRole.Greeble, [0.40, roof * 0.62, 0.40], [s.w * 0.26, roof * 1.00, -s.d * 0.20], 'bareMetal', {
      group: 'ducts', chamfer: 0.05,
    }),
    box('furnace', MassRole.Emissive, [s.w * 0.30, roof * 0.20, 0.16], [0, roof * 0.20, s.d * 0.5 + 0.04], 'emissive', {
      group: 'furnace', feature: Feature.Window, chamfer: 0.04,
    }),
    greebleRun('bus.run', s.d * 0.48, 0.28, 0.22, [-s.w * 0.40, roof * 0.62, s.d * 0.06], 0x50B1),
    cyl('switchgear', MassRole.Greeble, [s.w * 0.16, roof * 0.30, s.d * 0.16], [s.w * 0.34, roof * 0.15, -s.d * 0.34], 'grille', {
      group: 'switchgear', segments: 12, capSlot: 'grille',
    }),
  );
  return list('soviet_power', 'Tesla Reactor', 'soviets', 'powerPlant', s.masses,
    baseSockets(s.d, f.height, -s.w * 0.26, -s.d * 0.20));
}

function sovietBarracks(): StructureMassList {
  const f = fp('barracks');
  const s = sovietShell(f.w, f.h, f.height, { key: 'barracks', team: 1.15, windowCount: 5, bodyFraction: 0.56 });
  const roof = s.roofY;
  s.masses.push(
    ...sovietStack(-s.w * 0.30, -s.d * 0.28, s.w * 0.10, roof * 1.25, f.height, 'stackA'),
    box('portico', MassRole.Primary, [s.w * 0.56, 0.44, s.d * 0.22], [0, roof * 0.80, s.d * 0.36], 'rivetPlate', { chamfer: 0.07 }),
    cyl('portico.col', MassRole.Greeble, [0.46, roof * 0.78, 0.46], [s.w * 0.22, roof * 0.39, s.d * 0.40], 'paintMed', {
      mirrorX: true, group: 'columns', capSlot: 'grille',
    }),
    box('door', MassRole.Greeble, [s.w * 0.26, roof * 0.56, 0.32], [0, roof * 0.28, s.d * 0.5 + 0.02], 'hatch', {
      group: 'door', feature: Feature.Door, anim: roof * 0.60, chamfer: 0.05,
    }),
    box('banner', MassRole.TeamSlab, [s.w * 0.10, roof * 0.62, 0.10], [s.w * 0.34, roof * 0.55, s.d * 0.5 + 0.04], 'teamSlab', {
      mirrorX: true, group: 'banners', chamfer: 0.03,
    }),
    box('vent', MassRole.Greeble, [s.w * 0.26, 0.8, s.d * 0.20], [s.w * 0.26, roof + 0.4, -s.d * 0.24], 'vent', { group: 'vent' }),
  );
  return list('soviet_barracks', 'Barracks', 'soviets', 'barracks', s.masses, [
    ...baseSockets(s.d, f.height, -s.w * 0.30, -s.d * 0.28),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
  ]);
}

function sovietRefinery(): StructureMassList {
  const f = fp('refinery');
  const s = sovietShell(f.w, f.h, f.height, { key: 'refinery', team: 1.06, windowCount: 4, bodyFraction: 0.44 });
  const roof = s.roofY;
  s.masses.push(
    ...sovietVessel(-s.w * 0.28, -s.d * 0.10, s.w * 0.13, roof * 0.30, 'retort'),
    ...sovietStack(s.w * 0.34, -s.d * 0.26, s.w * 0.09, roof * 1.20, f.height, 'stackA'),
    box('dock.canopy', MassRole.Primary, [s.w * 0.44, 0.46, s.d * 0.46], [s.w * 0.22, roof * 0.94, s.d * 0.20], 'rivetPlate', { chamfer: 0.08 }),
    box('dock.leg', MassRole.Greeble, [0.30, roof * 0.92, 0.30], [s.w * 0.40, roof * 0.46, s.d * 0.36], 'bareMetal', {
      group: 'dock', chamfer: 0.05,
    }),
    box('conveyor', MassRole.Greeble, [s.w * 0.18, 0.36, s.d * 0.52], [s.w * 0.06, roof * 0.36, s.d * 0.18], 'tread', {
      group: 'conveyor', rot: [-0.14, 0, 0], chamfer: 0.05,
    }),
    box('pipe.run', MassRole.Greeble, [s.w * 0.50, 0.30, 0.30], [-s.w * 0.04, roof * 1.08, -s.d * 0.16], 'bareMetal', {
      group: 'pipes', chamfer: 0.05,
    }),
  );
  return list('soviet_refinery', 'Ore Refinery', 'soviets', 'refinery', s.masses, [
    ...baseSockets(s.d, f.height, s.w * 0.34, -s.d * 0.26),
    { part: PartId.DockEntry, pos: [s.w * 0.22, 0.2, s.d * 0.5 + 2.4] },
    { part: PartId.Conveyor, pos: [s.w * 0.06, roof * 0.5, s.d * 0.5] },
  ]);
}

function sovietWarFactory(): StructureMassList {
  const f = fp('warFactory');
  const w = f.w * CELL * 0.94;
  const d = f.h * CELL * 0.94;
  const bunkerH = f.height * 0.34;
  const drumDia = f.height * 0.43;
  const drumY = bunkerH + drumDia * 0.43;
  const masses: M[] = [...foundationPad('soviets', f.w, f.h, f.height)];
  masses.push(
    // A low battered casting bunker. The skyline belongs to the machinery,
    // not to another habitable box stacked above it.
    pplan('foundry.bunker', MassRole.Primary, [w, bunkerH, d * 0.90],
      [0, bunkerH * 0.5, -d * 0.02], 'paintMed', {
        plan: cutBoxPlan(w, d * 0.90, 0.14),
        topScaleX: 0.94, topScaleZ: 0.92, bottomScaleX: 1.02, bottomScaleZ: 1.02,
      }, { capSlot: 'rivetPlate' }),
    // Twin longitudinal casting drums replace the old upper floor completely.
    // Their axes point toward the vehicle bay, giving the camera two enormous
    // curved forms and a deep slot between them.
    cyl('foundry.drum', MassRole.Primary, [drumDia, d * 0.70, drumDia],
      [w * 0.27, drumY, -d * 0.10], 'rivetPlate', {
        mirrorX: true, rot: [HALF_PI, 0, 0], segments: 22, topRadius: 0.92,
        capSlot: 'grille', group: 'castingDrums',
      }),
    cyl('foundry.band', MassRole.TeamSlab, [drumDia * 1.05, d * 0.025, drumDia * 1.05],
      [w * 0.27, drumY, d * 0.02], 'teamSlab', {
        mirrorX: true, rot: [HALF_PI, 0, 0], segments: 22, topRadius: 1.0,
        group: 'castingDrums',
      }),
    // One bridge and one offset derrick: heavy industry, not symmetry for its
    // own sake. The girder also carries the exact frozen roofline.
    tbox('foundry.bridge', MassRole.Primary, [w * 0.88, 0.92, 1.30],
      [w * 0.02, f.height - 0.46, -d * 0.08], 'rivetPlate', {
        topScaleX: 0.92, topScaleZ: 0.60, shear: 0.24, cornerCut: 0.14,
      }, { capSlot: 'grille', chamfer: 0.09 }),
    ...lattice(w * 0.34, d * 0.05, 2.0, f.height - 0.92, 'derrick'),
    box('foundry.hoist', MassRole.Greeble, [1.15, 0.76, 1.10],
      [w * 0.34, f.height - 1.25, d * 0.05], 'hatch', { group: 'derrick', chamfer: 0.07 }),
    // A broad maw in the bunker, under the slot between the two drums.
    box('bay.door', MassRole.Greeble, [w * 0.52, bunkerH * 0.70, 0.30],
      [0, bunkerH * 0.35, d * 0.435], 'hatch', {
        group: 'bay', feature: Feature.Door, anim: bunkerH * 0.74, chamfer: 0.07,
      }),
    box('bay.lintel', MassRole.TeamSlab, [w * 0.42, bunkerH * 0.12, 0.48],
      [0, bunkerH * 0.79, d * 0.44], 'teamSlab', { chamfer: 0.07 }),
    box('foundry.hot', MassRole.Emissive, [w * 0.68, 0.34, 0.22],
      [0, bunkerH * 0.90, d * 0.455], 'emissive', {
        group: 'castingDrums', feature: Feature.Window, chamfer: 0.03,
      }),
    cyl('foundry.pipe', MassRole.Greeble, [0.34, d * 0.34, 0.34],
      [-w * 0.18, bunkerH * 0.88, -d * 0.12], 'bareMetal', {
        rot: [HALF_PI, 0, 0], segments: 16, topRadius: 0.92, group: 'pressurePipe',
      }),
    box('foundry.manifold', MassRole.Greeble, [w * 0.26, 0.32, 0.58],
      [-w * 0.18, bunkerH * 0.98, d * 0.05], 'grille', {
        group: 'pressureManifold', chamfer: 0.07,
      }),
    tbox('bay.cheek', MassRole.Greeble, [w * 0.12, bunkerH * 0.34, 0.36],
      [w * 0.34, bunkerH * 0.34, d * 0.44], 'rivetPlate', {
        topScaleX: 0.72, topScaleZ: 0.82, cornerCut: 0.10,
      }, { mirrorX: true, group: 'bayCheeks', chamfer: 0.05 }),
    ...sovietStack(-w * 0.39, -d * 0.30, w * 0.085, bunkerH, f.height * 0.92, 'stackA'),
    insignia(w * 0.14, [-w * 0.34, bunkerH * 0.54, d * 0.44]),
  );
  return list('soviet_warfactory', 'War Factory', 'soviets', 'warFactory', masses, [
    ...baseSockets(d, f.height * 0.92, -w * 0.39, -d * 0.30),
    { part: PartId.Door, pos: [0, 0.2, d * 0.5 + 0.4] },
    { part: PartId.Crane, pos: [w * 0.34, f.height - 1.25, d * 0.05] },
  ]);
}

/**
 * SOVIET REPAIR DEPOT — the same job as the Allied one, deliberately not the
 * same silhouette.
 *
 * Where the Allies hang a chromed rail off a portal, the Pact drops a riveted
 * lattice derrick beside the deck, cantilevers a box-girder jib off the top of
 * it and hangs a counterweight off the tail. Same 6.5 m roofline, same open
 * deck underneath — see `alliedDepot` for why the roofline is frozen this low —
 * but the mass is on the ground and the working end is a hook on a chain.
 */
function sovietDepot(): StructureMassList {
  const f = fp('repairDepot');
  const s = sovietShell(f.w, f.h, f.height, {
    key: 'repairDepot', inset: 0.72, bodyFraction: 0.32, team: 1.00, windowCount: 3,
  });
  const roof = s.roofY;
  // The derrick stands off the body's left flank and the jib runs down its
  // centre line, so nothing on the +X half of the deck is roofed over.
  const mastX = -s.w * 0.26;
  const jibH = 0.66;
  const mastTop = f.height - jibH;
  s.masses.push(
    ...lattice(mastX, -s.d * 0.06, 2.0, mastTop, 'derrick'),
    // The jib. A riveted box girder, swept and tapered toward the hook end, so
    // the longest mass in the model contributes no flat wall at all.
    {
      name: 'jib', primitive: 'extrude', role: MassRole.Primary,
      size: [0.68, jibH, 6.6], anchor: [mastX, mastTop + jibH * 0.5, 0.55], slot: 'rivetPlate',
      shape: {
        profile: ductSection(0.68),
        path: [[0, 0, -3.30], [0, 0, -1.10], [0, 0, 1.35], [0, 0, 3.30]],
        scale: [0.86, 1.0, 0.86, 0.62], capStart: true, capEnd: true,
      },
    },
    // SOVIET-1 in miniature: the counterweight is a battered, sheared block,
    // not a brick, and it balances the jib's reach in the silhouette too.
    tbox('counterweight', MassRole.Primary, [1.55, 1.30, 1.35], [mastX, mastTop - 0.45, -2.30], 'rivetPlate', {
      topScaleX: 0.78, topScaleZ: 0.72, shear: -0.22, cornerCut: 0.16,
    }, { chamfer: 0.07 }),
    // Block and chain, each hung flush off the underside of the piece above it.
    cyl('hook.block', MassRole.Greeble, [0.62, 0.90, 0.62], [mastX, mastTop - 0.45, 3.45], 'bareMetal', {
      group: 'hook', segments: 10, capSlot: 'hatch',
    }),
    cyl('hook.chain', MassRole.Greeble, [0.18, 1.35, 0.18], [mastX, mastTop - 1.58, 3.45], 'bareMetal', {
      group: 'hook', segments: 8, chamfer: 0.03, capSlot: 'grille',
    }),
    // The winch drum, lying on its side on the machine deck. On the ROOF and
    // not at the derrick's foot: the slab fills its own footprint down there,
    // so a ground-level drum would be sealed inside it.
    cyl('winch', MassRole.Greeble, [1.15, 0.85, 1.15], [-0.85, roof + 0.58, -2.35], 'grille', {
      group: 'winch', rot: [0, 0, HALF_PI], segments: 12, capSlot: 'rivetPlate',
    }),
    // SOVIET-5's exposed hardware, at ground level for once: the running rails
    // and the grating in front of the bay. Both sit FORWARD of the slab for the
    // same reason the winch sits above it.
    box('deck.rail', MassRole.Greeble, [0.34, 0.22, 2.5], [1.55, 0.15, 3.35], 'bareMetal', {
      mirrorX: true, group: 'deckRails', chamfer: 0.04,
    }),
    plate('deck.grate', MassRole.Greeble, taperOutline(s.w * 1.10, 2.4, 0.90), 0.20,
      [0, 0.12, 3.30], undefined, 'grille', { group: 'deck', chamfer: 0.04 }),
    // A short flue over the welding bay. Every Pact structure carries one, and
    // this is the cheapest place to put the family cue on a building whose own
    // roof is only 2 m off the ground.
    ...sovietStack(s.w * 0.34, -s.d * 0.30, s.w * 0.11, roof, f.height - 1.15, 'stackA'),
  );
  return list('soviet_depot', 'Repair Depot', 'soviets', 'repairDepot', s.masses, [
    ...baseSockets(s.d, f.height - 1.15, s.w * 0.34, -s.d * 0.30),
    // No door and nothing is produced here; `Crane` is the hook the repair VFX
    // hangs off, exactly as on the Allied depot.
    { part: PartId.Crane, pos: [mastX, mastTop - 2.30, 3.45] },
  ]);
}

function sovietRadar(): StructureMassList {
  const f = fp('radar');
  const s = sovietShell(f.w, f.h, f.height, { key: 'radar', team: 1.16, windowCount: 4, bodyFraction: 0.34 });
  const roof = s.roofY;
  const towerTop = f.height - 2.8;
  s.masses.push(
    // The Kremlin cue: a drum tower under an onion cupola, then the sweep gear.
    cyl('tower', MassRole.Primary, [s.w * 0.40, towerTop - roof * 1.4, s.w * 0.40], [0, (towerTop + roof * 1.4) * 0.5, 0], 'rivetPlate', {
      capSlot: 'grille',
    }),
    { name: 'cupola', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [s.w * 0.46, s.w * 0.26, s.w * 0.46], anchor: [0, towerTop + s.w * 0.13, 0],
      slot: 'paintMed', capSlot: 'grille' },
    cyl('mast', MassRole.Greeble, [0.30, 2.4, 0.30], [0, f.height - 1.2, 0], 'bareMetal', {
      group: 'mast', feature: Feature.Spinner, anim: 0.55, capSlot: 'grille',
    }),
    { name: 'dish', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [4.2, 1.5, 4.2], anchor: [0.8, f.height - 1.5, 0], slot: 'rivetPlate',
      rot: [-0.58, 0, 0.30], capSlot: 'grille', feature: Feature.Spinner, anim: 0.55 },
    box('dish.arm', MassRole.Greeble, [1.7, 0.20, 0.20], [0.45, f.height - 2.1, 0], 'bareMetal', {
      group: 'dish', feature: Feature.Spinner, anim: 0.55, chamfer: 0.04,
    }),
    box('dish.feed', MassRole.Emissive, [0.46, 0.46, 0.46], [1.4, f.height - 0.7, 0], 'emissive', {
      group: 'dish', feature: Feature.Spinner, anim: 0.55, chamfer: 0.05,
    }),
    ...catwalk(s.w * 0.70, s.d * 0.20, roof * 1.30, 'walk'),
    greebleRun('tower.run', s.d * 0.44, 0.26, 0.20, [-s.w * 0.36, roof * 0.60, s.d * 0.04], 0x50A2),
    cyl('waveguide', MassRole.Greeble, [0.26, towerTop - roof * 1.4, 0.26], [s.w * 0.20, (towerTop + roof * 1.4) * 0.5, s.d * 0.16], 'bareMetal', {
      group: 'waveguide', segments: 10, capSlot: 'grille',
    }),
  );
  return list('soviet_radar', 'Radar Tower', 'soviets', 'radar', s.masses, [
    ...baseSockets(s.d, roof * 1.4, -s.w * 0.32, -s.d * 0.30),
    { part: PartId.Dish, pos: [0, f.height - 1.5, 0] },
    { part: PartId.Antenna, pos: [0, f.height, 0] },
  ]);
}

function sovietTech(): StructureMassList {
  const f = fp('techCentre');
  const s = sovietShell(f.w, f.h, f.height, { key: 'techCentre', team: 1.05, windowCount: 4, bodyFraction: 0.46 });
  const roof = s.roofY;
  s.masses.push(
    ...sovietVessel(-s.w * 0.24, s.d * 0.06, s.w * 0.14, roof * 1.28, 'reactor'),
    ...sovietStack(s.w * 0.30, -s.d * 0.24, s.w * 0.085, roof * 1.28, f.height, 'stackA'),
    // A tesla test rig: coil rings on a short mast, the faction's loudest cue.
    cyl('coil.mast', MassRole.Primary, [0.6, roof * 0.9, 0.6], [s.w * 0.02, roof * 1.72, s.d * 0.22], 'bareMetal', { capSlot: 'grille' }),
    cyl('coil.ringA', MassRole.Greeble, [2.0, 0.24, 2.0], [s.w * 0.02, roof * 1.90, s.d * 0.22], 'bareMetal', {
      group: 'coils', chamfer: 0.05, capSlot: 'grille',
    }),
    cyl('coil.ringB', MassRole.Greeble, [1.5, 0.22, 1.5], [s.w * 0.02, roof * 2.06, s.d * 0.22], 'bareMetal', {
      group: 'coils', chamfer: 0.05, capSlot: 'grille',
    }),
    cyl('coil.tip', MassRole.Emissive, [0.8, 0.34, 0.8], [s.w * 0.02, roof * 2.18, s.d * 0.22], 'emissive', {
      group: 'coils', chamfer: 0.04, capSlot: 'emissive',
    }),
    ...lattice(-s.w * 0.42, -s.d * 0.18, 1.4, roof * 1.5, 'frame'),
  );
  return list('soviet_tech', 'Proving Ground', 'soviets', 'techCentre', s.masses, [
    ...baseSockets(s.d, f.height, s.w * 0.30, -s.d * 0.24),
    { part: PartId.CoilTip, pos: [s.w * 0.02, roof * 2.30, s.d * 0.22] },
  ]);
}

/**
 * THE COMMAND BUNKER (Soviet). The same building, argued from the other side.
 *
 * The Allied answer to "where do orders come from" is an aerial. The Soviet
 * answer is a BUNKER WITH A WIRE OUT OF IT: a heavy low slab, a lattice tower
 * bolted to one corner rather than standing on the centre line, and a
 * horizontal dipole across the top of it. Same 10.5 m roofline, reached by a
 * girder frame instead of a machined whip, which is the whole difference
 * between the two armies stated in one piece of hardware.
 *
 * `lattice()` is the faction's own frame primitive and it does two jobs here:
 * it carries `bounds[1]` from the shell's own roofline to the frozen one, and
 * it is the highest-frequency surface in the Soviet atlas, which is what pays
 * for the flat rivet-plate slab underneath it on scorecard #34.
 */
function sovietCommandPost(): StructureMassList {
  const f = fp('commandPost');
  const s = sovietShell(f.w, f.h, f.height, {
    key: 'commandPost', team: 1.10, windowCount: 4, bodyFraction: 0.34,
  });
  const roof = s.roofY;
  const towerX = -s.w * 0.30;
  const towerZ = -s.d * 0.24;
  const towerTop = f.height - 1.1;
  s.masses.push(
    // The frame, off-centre. A tower on the axis would be a Radar Tower; a
    // tower on a corner is a mast bolted to a bunker.
    ...lattice(towerX, towerZ, 1.7, towerTop, 'frame'),
    // The head: a tapered drum the dipole hangs off, so the frame ends in
    // something rather than stopping.
    cyl('head', MassRole.Primary, [1.35, 1.30, 1.35], [towerX, towerTop + 0.45, towerZ], 'rivetPlate', {
      topRadius: 0.70, capSlot: 'grille', segments: 10,
    }),
    box('dipole', MassRole.Greeble, [3.40, 0.18, 0.18], [towerX, towerTop + 1.20, towerZ], 'bareMetal', {
      group: 'dipole', chamfer: 0.04,
    }),
    box('dipole.stub', MassRole.Greeble, [0.18, 0.18, 1.60], [towerX, towerTop + 1.20, towerZ], 'bareMetal', {
      group: 'dipole', chamfer: 0.04,
    }),
    cyl('beacon', MassRole.Emissive, [0.40, 0.46, 0.40], [towerX, towerTop + 1.62, towerZ], 'emissive', {
      capSlot: 'emissive', feature: Feature.Window, segments: 8, chamfer: 0.05,
    }),
    // The transformer vessel that feeds it, and a bus bar across the roof. Both
    // are Soviet stock hardware; both are what makes the roof read as plant.
    ...sovietVessel(s.w * 0.26, s.d * 0.10, s.w * 0.15, roof * 1.10, 'transformer'),
    box('bus', MassRole.Greeble, [s.w * 0.52, 0.24, 0.24], [0, roof + 0.55, -s.d * 0.24], 'bareMetal', {
      group: 'bus', chamfer: 0.05,
    }),
    // The sunk map room: a hexagonal drum, low and wide, the one machined shape
    // on an otherwise welded building.
    pri('mapRoom', MassRole.Primary, [s.w * 0.52, 1.25, s.d * 0.46], [s.w * 0.10, roof + 0.62, s.d * 0.22], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall', chamfer: 0.08,
    }),
    greebleRun('roof.run', s.d * 0.40, 0.24, 0.18, [s.w * 0.34, roof + 0.30, -s.d * 0.02], 0x50C7),
    // NO CATWALK, and it is a budget decision stated rather than an omission.
    // `catwalk()` is eight small boxes and it took this structure to 4392
    // triangles against a roster mean of ~2500; the lattice already gives the
    // frame its climbable read, and `tests/building-shape.spec.ts` holds the
    // mean as a hard ceiling precisely so that four new structures cannot buy
    // slack for the sixty-five already shipped.
  );
  return list('soviet_commandpost', 'Command Bunker', 'soviets', 'commandPost', s.masses, [
    ...baseSockets(s.d, roof * 1.30, s.w * 0.30, -s.d * 0.24),
    { part: PartId.Antenna, pos: [towerX, f.height, towerZ] },
  ]);
}

function sovietSentry(): StructureMassList {
  const f = fp('sentryGun');
  const w = f.w * CELL * 0.76;
  const h = f.height;
  const ringY = h * 0.58;
  const masses: M[] = [
    ...foundationPad('soviets', f.w, f.h, h),
    // The squat concrete drum every Soviet reference frame is full of.
    cyl('drum', MassRole.Primary, [w, ringY * 0.92, w], [0, ringY * 0.46, 0], 'rivetPlate', {
      capSlot: 'grille', topRadius: 0.90,
    }),
    cyl('collar', MassRole.Primary, [w * 0.70, ringY * 0.22, w * 0.70], [0, ringY * 0.98, 0], 'bareMetal', { capSlot: 'grille' }),
    box('skirt', MassRole.Greeble, [w * 1.06, ringY * 0.20, w * 1.06], [0, ringY * 0.10, 0], 'paintSmall', {
      group: 'skirt', chamfer: 0.08,
    }),
    box('ammo', MassRole.Greeble, [w * 0.26, ringY * 0.34, w * 0.22], [-w * 0.46, ringY * 0.22, -w * 0.24], 'hatch', { group: 'ammo' }),
    teamPanel('team.band', [w * 1.02, ringY * 0.16, w * 0.34], [0, ringY * 0.66, 0]),
    ...windows(w * 0.28, ringY * 0.70, w * 0.44, 2, 0.22, 0.14, 'lamp'),

    /* -- the slewing head -------------------------------------------------- */
    { name: 'head', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [w * 0.78, h * 0.30, w * 0.86], anchor: [0, ringY, 0], slot: 'paintMed',
      capSlot: 'grille', target: 'turret' },
    cyl('barrel', MassRole.Primary, [0.36, w * 1.20, 0.36], [0, ringY + h * 0.14, w * 0.60], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], target: 'turret', capSlot: 'grille',
    }),
    cyl('mantlet', MassRole.Greeble, [0.62, 0.5, 0.62], [0, ringY + h * 0.14, w * 0.28], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], target: 'turret', group: 'mantlet', capSlot: 'grille',
    }),
    teamPanel('team.head', [w * 0.34, 0.12, w * 0.24], [0, ringY + h * 0.24, -w * 0.10], { target: 'turret' }),
    // The sight mast is what carries the sentry to its frozen roofline: a
    // 3.4 m drum with a dome on top tops out at 2.6 on its own.
    cyl('sight.mast', MassRole.Greeble, [0.16, h * 0.34, 0.16], [-w * 0.16, ringY + h * 0.30, -w * 0.12], 'bareMetal', {
      target: 'turret', group: 'sight', capSlot: 'grille',
    }),
    box('sight.head', MassRole.Greeble, [0.34, 0.28, 0.40], [-w * 0.16, ringY + h * 0.48, -w * 0.12], 'hatch', {
      target: 'turret', group: 'sight', chamfer: 0.04,
    }),
    greebleRun('drum.run', w * 0.56, 0.22, 0.18, [0, ringY * 0.40, -w * 0.46], 0x50C4, { rot: [0, HALF_PI, 0] }),
    cyl('cable.spool', MassRole.Greeble, [w * 0.24, ringY * 0.22, w * 0.24], [w * 0.42, ringY * 0.14, w * 0.24], 'bareMetal', {
      group: 'spools', segments: 10, capSlot: 'grille',
    }),
  ];
  return list('soviet_sentry', 'Sentry Gun', 'soviets', 'sentryGun', masses, [
    { part: PartId.MuzzleA, pos: [0, ringY + h * 0.14, w * 1.22], turret: true },
  ], { cls: 'defence', turretPivot: [0, ringY, 0] });
}

function sovietTeslaCoil(): StructureMassList {
  const f = fp('teslaCoil');
  const w = f.w * CELL * 0.72;
  const h = f.height;
  const masses: M[] = [
    ...foundationPad('soviets', f.w, f.h, h),
    pplan('base', MassRole.Primary, [w, h * 0.22, w], [0, h * 0.11, 0], 'rivetPlate', {
      plan: cutBoxPlan(w, w, 0.10), topScaleX: 0.88, topScaleZ: 0.88, bottomScaleX: 1.04, bottomScaleZ: 1.04,
    }, { capSlot: 'grille' }),
    // The mast. RA3's coil is a tapered pylon, not a lattice tower.
    cyl('mast', MassRole.Primary, [w * 0.34, h * 0.56, w * 0.34], [0, h * 0.50, 0], 'rivetPlate', {
      topRadius: 0.62, capSlot: 'grille',
    }),
    cyl('ringA', MassRole.Primary, [w * 0.82, h * 0.045, w * 0.82], [0, h * 0.72, 0], 'bareMetal', { capSlot: 'grille' }),
    cyl('ringB', MassRole.Primary, [w * 0.66, h * 0.040, w * 0.66], [0, h * 0.83, 0], 'bareMetal', { capSlot: 'grille' }),
    cyl('ringC', MassRole.Greeble, [w * 0.50, h * 0.036, w * 0.50], [0, h * 0.92, 0], 'bareMetal', { group: 'rings', capSlot: 'grille' }),
    { name: 'electrode', primitive: 'lathe', role: MassRole.Emissive, profile: 'sphere',
      size: [w * 0.30, w * 0.30, w * 0.30], anchor: [0, h - w * 0.14, 0], slot: 'emissive', capSlot: 'emissive' },
    cyl('insulator', MassRole.Greeble, [w * 0.14, h * 0.10, w * 0.14], [0, h * 0.97, 0], 'glass', {
      group: 'insulators', capSlot: 'glass',
    }),
    box('cable', MassRole.Greeble, [0.16, h * 0.30, 0.16], [w * 0.30, h * 0.24, w * 0.24], 'bareMetal', {
      mirrorX: true, group: 'cables', chamfer: 0.03,
    }),
    box('capacitor', MassRole.Greeble, [w * 0.24, h * 0.16, w * 0.20], [-w * 0.34, h * 0.30, -w * 0.24], 'grille', { group: 'capacitors' }),
    greebleRun('base.run', w * 0.62, 0.22, 0.18, [0, h * 0.26, w * 0.40], 0x50E1, { rot: [0, HALF_PI, 0] }),
    cyl('earth.spike', MassRole.Greeble, [0.22, h * 0.18, 0.22], [-w * 0.40, h * 0.09, w * 0.30], 'bareMetal', {
      mirrorX: true, group: 'earthing', segments: 8, capSlot: 'grille',
    }),
    teamPanel('team.base', [w * 0.94, h * 0.05, w * 0.34], [0, h * 0.23, 0]),
    teamPanel('team.fin', [0.14, h * 0.20, w * 0.30], [w * 0.32, h * 0.14, 0], { mirrorX: true }),
    ...windows(w * 0.30, h * 0.15, w * 0.44, 2, 0.22, 0.14, 'lamp'),
  ];
  return list('soviet_tesla', 'Tesla Coil', 'soviets', 'teslaCoil', masses, [
    { part: PartId.CoilTip, pos: [0, h, 0] },
    { part: PartId.Emitter, pos: [0, h - w * 0.14, 0] },
  ], { cls: 'defence' });
}

/* ==========================================================================
 * 4b. THE MISSING STRUCTURES
 *
 * Four buildings that `src/data/Defs.ts` has always shipped and this module has
 * never had art for. Until now:
 *
 *   navalYard    drew the ALLIED CONSTRUCTION YARD — a second, identical
 *                landmark building appearing on the shoreline
 *   subPen       drew the SOVIET CONSTRUCTION YARD, likewise
 *   flameTower   drew the Sentry Gun, cannon and all — and because
 *                `Defs.flameTower` leaves `hasTurret` false, that cannon never
 *                slewed. A flamethrower emplacement with a welded gun barrel.
 *   prismTower   drew the AA Battery turret: an anti-air mount firing a
 *                ground beam.
 *
 * The two defences are built to the def they actually have. The Flame Tower is
 * authored TURRETLESS with four radial nozzles, so nothing on it needs to slew;
 * the Refractor Tower has `hasTurret: true` in the defs and gets a real rotating
 * crystal head on `target: 'turret'`.
 * ========================================================================== */

/**
 * ALLIED NAVAL YARD. 3x3, 7.5 m.
 *
 * The Allied shell plus the two things that make a shipyard read as a shipyard
 * from the RTS camera: a flooded SLIPWAY cut into the seaward face, and a
 * travelling PORTAL GANTRY straddling it. The gantry also gives the structure
 * its roofline, which is why the shell body is set unusually low.
 */
function alliedNavalYard(): StructureMassList {
  const f = fp('navalYard');
  const s = alliedShell(f.w, f.h, f.height, { key: 'navalYard', team: 1.25, windowCount: 5, bodyFraction: 0.40 });
  const roof = s.roofY;
  const beamY = f.height - 0.45;
  s.masses.push(
    // The slipway: a trough let into the seaward third, with a ramp floor that
    // runs down under the waterline.
    plate('slip.floor', MassRole.Primary, taperOutline(s.w * 0.44, s.d * 0.44, 1.22), 0.30,
      [0, roof * 0.16, s.d * 0.26], [-0.16, 0, 0], 'grille', { chamfer: 0.06 }),
    tbox('slip.wall', MassRole.Primary, [s.w * 0.16, roof * 0.62, s.d * 0.44], [s.w * 0.31, roof * 0.31, s.d * 0.26], 'paintMed', {
      topScaleX: 0.68, topScaleZ: 0.94, bottomScaleX: 1.12, bottomScaleZ: 1.0, cornerCut: 0.30,
    }, { mirrorX: true }),
    // The portal gantry. Two raking legs and a swept box beam across the slip.
    tbox('gantry.leg', MassRole.Primary, [0.72, beamY - roof * 0.10, 0.72], [s.w * 0.36, (beamY + roof * 0.10) * 0.5, s.d * 0.30], 'bareMetal', {
      topScaleX: 0.66, topScaleZ: 0.72, bottomScaleX: 1.30, bottomScaleZ: 1.24,
    }, { mirrorX: true }),
    {
      name: 'gantry.beam', primitive: 'extrude', role: MassRole.Primary,
      // Authored along +Z and turned across the slip: `size` is always the
      // PRE-rotation extent, and `massBounds` applies the rotation.
      size: [0.90, 0.90, s.w * 0.90], anchor: [0, beamY, s.d * 0.30], slot: 'bareMetal',
      rot: [0, HALF_PI, 0],
      shape: {
        profile: ductSection(0.90),
        path: [[0, 0, -s.w * 0.45], [0, 0, -s.w * 0.14], [0, 0, s.w * 0.14], [0, 0, s.w * 0.45]],
        scale: [0.74, 1.0, 1.0, 0.74], capStart: true, capEnd: true,
      },
    },
    // Hull cradles: a keel block run down the middle of the slip.
    greebleRun('slip.cradle', s.d * 0.38, 0.44, 0.36, [0, roof * 0.22, s.d * 0.24], 0x4A17),
    box('gantry.hoist', MassRole.Greeble, [1.3, 1.0, 1.3], [-s.w * 0.14, beamY - 1.0, s.d * 0.30], 'hatch', { group: 'gantry gear' }),
    cyl('bollard', MassRole.Greeble, [0.34, 0.52, 0.34], [s.w * 0.44, roof * 0.10, s.d * 0.10], 'bareMetal', {
      mirrorX: true, group: 'bollards', segments: 10, capSlot: 'grille',
    }),
    box('quay.kerb', MassRole.Greeble, [s.w * 0.94, 0.24, 0.44], [0, roof * 0.06, s.d * 0.5 - 0.30], 'stripe', {
      group: 'quay', chamfer: 0.05,
    }),
    box('fitting.shed', MassRole.Greeble, [s.w * 0.24, roof * 0.44, s.d * 0.22], [-s.w * 0.34, roof * 0.22 + roof, -s.d * 0.24], 'vent', { group: 'shed' }),
  );
  return list('allied_navalyard', 'Naval Yard', 'allies', 'navalYard', s.masses, [
    ...baseSockets(s.d, roof + 1.0, -s.w * 0.34, -s.d * 0.24),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
    { part: PartId.DockEntry, pos: [0, 0.2, s.d * 0.5 + 3.2] },
    { part: PartId.Crane, pos: [-s.w * 0.14, beamY - 1.6, s.d * 0.30] },
  ]);
}

/**
 * SOVIET NAVAL PEN. 3x3, 6.0 m.
 *
 * A submarine pen is a bunker with a hole in it: the read is the BARREL-VAULT
 * ROOF over a water channel, and the blast doors at its mouth. The vault is an
 * extruded half-round swept along the channel, which is the one place in this
 * file where `extrude` is doing what it exists for.
 */
function sovietSubPen(): StructureMassList {
  const f = fp('subPen');
  const s = sovietShell(f.w, f.h, f.height, { key: 'subPen', team: 1.22, windowCount: 4, bodyFraction: 0.34 });
  const roof = s.roofY;
  // A half-round section, flat along the bottom: the pen vault.
  const vault: V2[] = (() => {
    const out: V2[] = [[s.w * 0.30, 0]];
    for (let i = 1; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      out.push([Math.cos(a) * s.w * 0.30, Math.sin(a) * s.w * 0.30]);
    }
    out.push([-s.w * 0.30, 0]);
    return out;
  })();
  s.masses.push(
    {
      name: 'pen.vault', primitive: 'extrude', role: MassRole.Primary,
      // The section is a half-round standing on the water line, so the mass
      // centre is half its own rise — not the roof height.
      size: [s.w * 0.60, s.w * 0.30, s.d * 0.62], anchor: [0, s.w * 0.15, s.d * 0.18], slot: 'rivetPlate',
      shape: {
        profile: vault,
        path: [[0, 0, -s.d * 0.31], [0, 0, -s.d * 0.08], [0, 0, s.d * 0.14], [0, 0, s.d * 0.31]],
        scale: [0.88, 1.0, 1.0, 0.96], capStart: true, capEnd: false,
      },
    },
    // The channel the boats lie in, and the blast door across its mouth.
    plate('pen.channel', MassRole.Primary, taperOutline(s.w * 0.42, s.d * 0.56, 1.10), 0.28,
      [0, roof * 0.06, s.d * 0.20], undefined, 'grille', { chamfer: 0.06 }),
    box('pen.door', MassRole.Greeble, [s.w * 0.50, roof * 0.62, 0.40], [0, roof * 0.31, s.d * 0.5 + 0.02], 'hatch', {
      group: 'blast door', feature: Feature.Door, anim: roof * 0.66, chamfer: 0.06,
    }),
    box('pen.lintel', MassRole.Greeble, [s.w * 0.62, 0.62, 0.62], [0, roof * 0.70, s.d * 0.5 + 0.08], 'stripe', {
      group: 'blast door', chamfer: 0.07,
    }),
    ...sovietStack(-s.w * 0.34, -s.d * 0.28, s.w * 0.095, roof * 1.30, f.height, 'stackA'),
    ...catwalk(s.w * 0.66, s.d * 0.18, roof * 1.34, 'walk'),
    ...lattice(s.w * 0.40, s.d * 0.06, 1.8, roof * 1.45, 'derrick'),
    greebleRun('quay.run', s.d * 0.54, 0.34, 0.28, [s.w * 0.40, roof * 0.14, s.d * 0.18], 0x5B0A, { mirrorX: true }),
    cyl('bollard', MassRole.Greeble, [0.36, 0.54, 0.36], [s.w * 0.42, roof * 0.12, -s.d * 0.06], 'bareMetal', {
      mirrorX: true, group: 'bollards', segments: 10, capSlot: 'grille',
    }),
  );
  return list('soviet_subpen', 'Naval Pen', 'soviets', 'subPen', s.masses, [
    ...baseSockets(s.d, f.height, -s.w * 0.34, -s.d * 0.28),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
    { part: PartId.DockEntry, pos: [0, 0.2, s.d * 0.5 + 3.2] },
    { part: PartId.Crane, pos: [s.w * 0.40, roof * 1.40, s.d * 0.06] },
  ]);
}

/**
 * SOVIET FLAME TOWER. 1x1, 5.5 m. A defence, and TURRETLESS BY DESIGN.
 *
 * `Defs.flameTower` does not set `hasTurret`, so `EntityFlag.HasTurret` is never
 * raised, `Combat.ts` never slews `turretYaw` and `world.ts` leaves it at spawn
 * yaw. Giving this thing a directional gun — which is what borrowing the Sentry
 * Gun's mesh did — produces an emplacement whose barrel points at one fixed
 * compass bearing forever.
 *
 * So it has no barrel. It is a pressure vessel under a flared burner mouth with
 * FOUR RADIAL NOZZLES, and it is correct at any yaw.
 */
function sovietFlameTower(): StructureMassList {
  const f = fp('flameTower');
  const w = f.w * CELL * 0.76;
  const h = f.height;
  const baseTop = h * 0.16;
  const drumTop = h * 0.58;
  const headTop = h * 0.80;
  const nozzleY = h * 0.66;

  const nozzle = (name: string, rotY: number, mirror: boolean): M => ({
    name, primitive: 'extrude', role: MassRole.Greeble,
    size: [0.30, 0.30, w * 0.52], anchor: [0, nozzleY, 0], slot: 'bareMetal',
    rot: [-0.22, rotY, 0], group: 'nozzles',
    ...(mirror ? { mirrorX: true } : {}),
    shape: {
      profile: ductSection(0.30),
      path: [[0, 0, w * 0.16], [0, 0, w * 0.34], [0, 0, w * 0.46], [0, 0, w * 0.56]],
      scale: [1.0, 0.86, 1.28, 1.06], capStart: true, capEnd: true,
    },
  });

  const masses: M[] = [
    ...foundationPad('soviets', f.w, f.h, h),
    // A battered octagonal plinth. SOVIET-1 at defence scale.
    pplan('base', MassRole.Primary, [w, baseTop, w], [0, baseTop * 0.5, 0], 'rivetPlate', {
      plan: cutBoxPlan(w, w, 0.10), topScaleX: 0.88, topScaleZ: 0.88, bottomScaleX: 1.08, bottomScaleZ: 1.08,
    }, { capSlot: 'grille' }),
    // The fuel drum: the dominant mass and the thing that says "this burns".
    rev('drum', MassRole.Primary, [w * 0.82, drumTop - baseTop, w * 0.82], [0, (drumTop + baseTop) * 0.5, 0],
      'rivetPlate', DRUM, 14, { capSlot: 'grille' }),
    // Two pressure vessels strapped to the drum (SOVIET-4).
    rev('vessel', MassRole.Primary, [w * 0.30, h * 0.34, w * 0.30], [w * 0.44, h * 0.30, -w * 0.10],
      'rivetPlate', CAPSULE_PROFILE, 12, { mirrorX: true, capSlot: 'grille' }),
    // The burner head and its flared mouth. The mouth IS the roofline.
    rev('head', MassRole.Primary, [w * 0.70, headTop - drumTop, w * 0.70], [0, (headTop + drumTop) * 0.5, 0],
      'bareMetal', TAPER_DRUM, 14, { capSlot: 'grille' }),
    rev('mouth', MassRole.Primary, [w * 0.66, h - headTop, w * 0.66], [0, (h + headTop) * 0.5, 0],
      'rivetPlate', FLARE_PROFILE, 14, { capSlot: 'grille' }),

    nozzle('nozzle.x', 0, true),
    nozzle('nozzle.zF', 0, false),
    nozzle('nozzle.zB', Math.PI, false),

    cyl('collar', MassRole.Greeble, [w * 0.90, h * 0.045, w * 0.90], [0, drumTop, 0], 'bareMetal', {
      group: 'collars', chamfer: 0.05, capSlot: 'grille',
    }),
    box('fuelLine', MassRole.Greeble, [0.20, h * 0.34, 0.20], [-w * 0.40, h * 0.28, w * 0.24], 'bareMetal', {
      mirrorX: true, group: 'pipework', chamfer: 0.04,
    }),
    box('valve.block', MassRole.Greeble, [w * 0.26, h * 0.12, w * 0.20], [-w * 0.34, h * 0.12, -w * 0.28], 'grille', { group: 'pipework' }),
    box('ladder', MassRole.Greeble, [0.32, h * 0.44, 0.10], [0, h * 0.34, w * 0.44], 'stripe', { group: 'ladder', chamfer: 0.03 }),
    box('gauge', MassRole.Greeble, [w * 0.22, h * 0.09, 0.14], [w * 0.20, h * 0.44, w * 0.42], 'stencil', { group: 'gauges', chamfer: 0.04 }),
    greebleRun('drum.strapRun', h * 0.30, 0.20, 0.16, [-w * 0.14, h * 0.40, -w * 0.44], 0x5F1A),

    // A defence carries NO insignia (R-T4) and a wide 6-18% team band.
    teamPanel('team.drum', [w * 0.86, h * 0.055, w * 0.30], [0, h * 0.44, 0]),
    teamPanel('team.chevron', [0.14, h * 0.16, w * 0.28], [w * 0.36, h * 0.24, 0], { mirrorX: true }),
    teamPanel('team.mouth', [w * 0.34, 0.12, w * 0.24], [0, h * 0.99, 0]),

    // The pilot flame, and the sight lamps under the mouth.
    cyl('pilot', MassRole.Emissive, [w * 0.34, h * 0.045, w * 0.34], [0, h * 0.97, 0], 'emissive', {
      group: 'pilot', chamfer: 0.03, capSlot: 'emissive', feature: Feature.Window,
    }),
    ...windows(w * 0.30, h * 0.62, w * 0.40, 2, 0.22, 0.13, 'lamp'),
  ];

  return list('soviet_flametower', 'Flame Tower', 'soviets', 'flameTower', masses, [
    { part: PartId.MuzzleA, pos: [0, nozzleY, w * 0.62] },
    { part: PartId.MuzzleB, pos: [w * 0.62, nozzleY, 0] },
    { part: PartId.Emitter, pos: [0, h * 0.95, 0] },
  ], { cls: 'defence' });
}

/**
 * ALLIED REFRACTOR TOWER. 1x1, 8.0 m. A defence WITH a real turret.
 *
 * `Defs.prismTower` sets `hasTurret: true`, so unlike the Flame Tower this one
 * genuinely slews — the crystal head is on `target: 'turret'` and the rest is
 * the fixed pylon it stands on.
 *
 * The whole silhouette is one idea: a splayed hexagonal foot drawn up into a
 * narrow faceted pylon, and a faceted crystal on top that is nearly all
 * emissive. No barrel anywhere on it, because a prism does not have one.
 */
function alliedPrismTower(): StructureMassList {
  const f = fp('prismTower');
  const w = f.w * CELL * 0.74;
  const h = f.height;
  const baseTop = h * 0.17;
  const pylonTop = h * 0.62;
  const ringY = pylonTop;
  const hexPhase = HALF_PI / 3;

  const masses: M[] = [
    ...foundationPad('allies', f.w, f.h, h),
    // ALLIED-1 at defence scale: the foot flares 1.3x wider than the shoulder.
    pplan('foot', MassRole.Primary, [w, baseTop, w], [0, baseTop * 0.5, 0], 'paintMed', {
      plan: ngon(w * 0.5, w * 0.5, 6, hexPhase),
      topScaleX: 0.72, topScaleZ: 0.72, bottomScaleX: 1.06, bottomScaleZ: 1.06,
    }, { capSlot: 'paintSmall' }),
    // The pylon: hexagonal, drawn in hard toward the collar.
    pplan('pylon', MassRole.Primary, [w * 0.72, pylonTop - baseTop, w * 0.72], [0, (pylonTop + baseTop) * 0.5, 0], 'paintMed', {
      plan: ngon(w * 0.36, w * 0.36, 6, hexPhase),
      topScaleX: 0.56, topScaleZ: 0.56, bottomScaleX: 1.10, bottomScaleZ: 1.10,
    }, { capSlot: 'paintSmall' }),
    cyl('collar', MassRole.Primary, [w * 0.50, h * 0.045, w * 0.50], [0, ringY, 0], 'bareMetal', {
      segments: BUILDING_GEOMETRY.railSegments, capSlot: 'grille',
    }),

    /* -- the slewing head, rebased onto the collar by the factory ---------- */
    pplan('head', MassRole.Primary, [w * 0.60, h * 0.15, w * 0.64], [0, ringY + h * 0.085, 0], 'paintMed', {
      plan: ngon(w * 0.30, w * 0.32, 6, hexPhase),
      topScaleX: 0.80, topScaleZ: 0.84, shear: -w * 0.03,
    }, { capSlot: 'paintSmall', target: 'turret' }),
    // The crystal: a faceted, almost entirely emissive spire, and the roofline.
    // R-T5 caps a defence at 3% emissive and an all-emissive spire measured
    // 3.4%, so the crystal is slimmer than it wants to be. It is still the
    // roofline; it is just no longer the whole roof.
    rev('crystal', MassRole.Primary, [w * 0.32, h - (ringY + h * 0.16), w * 0.32], [0, (h + ringY + h * 0.16) * 0.5, 0],
      'emissive', CRYSTAL_PROFILE, 8, { capSlot: 'emissive', target: 'turret', feature: Feature.Window }),

    /* -- greebles ---------------------------------------------------------- */
    plate('focus.vane', MassRole.Greeble, taperOutline(w * 0.30, h * 0.16, 0.34), 0.10,
      [w * 0.26, ringY + h * 0.12, 0], [0, HALF_PI, HALF_PI - 0.30], 'bareMetal',
      { mirrorX: true, group: 'vanes', target: 'turret' }),
    box('capacitor', MassRole.Greeble, [w * 0.24, h * 0.13, w * 0.20], [-w * 0.32, h * 0.12, -w * 0.26], 'grille', { group: 'plant' }),
    box('conduit', MassRole.Greeble, [0.18, h * 0.44, 0.18], [w * 0.30, h * 0.30, w * 0.22], 'bareMetal', {
      mirrorX: true, group: 'conduits', chamfer: 0.03,
    }),
    cyl('conduit.head', MassRole.Greeble, [0.34, 0.26, 0.34], [w * 0.30, h * 0.53, w * 0.22], 'hatch', {
      mirrorX: true, group: 'conduits', segments: 10, capSlot: 'grille',
    }),
    box('service.hatch', MassRole.Greeble, [w * 0.26, h * 0.10, 0.20], [0, h * 0.12, w * 0.34], 'hatch', { group: 'service', chamfer: 0.04 }),
    greebleRun('pylon.run', h * 0.34, 0.22, 0.18, [-w * 0.24, h * 0.34, w * 0.20], 0x41F0),
    box('vent', MassRole.Greeble, [w * 0.22, h * 0.08, w * 0.20], [w * 0.24, h * 0.20, -w * 0.28], 'vent', { group: 'plant' }),

    teamPanel('team.foot', [w * 0.80, 0.14, w * 0.28], [0, baseTop + 0.05, 0]),
    teamPanel('team.pylon', [0.14, h * 0.20, w * 0.24], [w * 0.28, h * 0.40, 0], { mirrorX: true }),
    teamPanel('team.head', [w * 0.34, 0.12, w * 0.22], [0, ringY + h * 0.16, 0], { target: 'turret' }),
    ...windows(w * 0.30, h * 0.22, w * 0.36, 2, 0.24, 0.14, 'lamp'),
  ];

  return list('allied_prismtower', 'Refractor Tower', 'allies', 'prismTower', masses, [
    { part: PartId.MuzzleA, pos: [0, h * 0.90, 0], turret: true },
    { part: PartId.Emitter, pos: [0, h * 0.90, 0] },
  ], { cls: 'defence', turretPivot: [0, ringY, 0] });
}

/** A burner mouth: a throat that flares open toward the sky. */
const FLARE_PROFILE: readonly V2[] = [
  [0, 0], [0.32, 0], [0.34, 0.16], [0.40, 0.52], [0.50, 0.86], [0.46, 1.0], [0, 1.0],
];

/** A faceted crystal spire: a waisted shaft rising to a point. */
const CRYSTAL_PROFILE: readonly V2[] = [
  [0, 0], [0.44, 0.06], [0.50, 0.20], [0.42, 0.52], [0.26, 0.80], [0.10, 0.94], [0, 1.0],
];

/** A capsule: hemisphere, straight body, hemisphere. Normalised. */
const CAPSULE_PROFILE: readonly V2[] = [
  [0, 0], [0.28, 0.06], [0.42, 0.16], [0.50, 0.30],
  [0.50, 0.70], [0.42, 0.84], [0.28, 0.94], [0, 1.0],
];

/* -- WALLS AND GATES ------------------------------------------------------ */

/**
 * A wall segment. No pad: a wall follows terrain and a foundation slab under
 * every 4 m section would tile the whole perimeter in concrete.
 */
function wallSegment(faction: StructureFaction): StructureMassList {
  const f = fp('wall');
  const w = f.w * CELL;
  const h = f.height;
  const soviet = faction === 'soviets';
  const masses: M[] = soviet
    ? [
      // A battered concrete wall: the face leans back 4% over its height, which
      // is both how a real revetment is poured and why this panel no longer
      // measures as a flat rectangle when it is repeated eighty times.
      pplan('wall', MassRole.Primary, [w, h * 0.86, w * 0.42], [0, h * 0.43, 0], 'rivetPlate', {
        plan: cutBoxPlan(w, w * 0.42, 0.06),
        topScaleX: 0.97, topScaleZ: 0.88, bottomScaleX: 1.01, bottomScaleZ: 1.08,
      }, { capSlot: 'rivetPlate' }),
      // SOVIET-2 at wall scale: the capsule rails ARE the pilasters, and every
      // reference frame of the Kremlin wall is built out of them.
      cyl('rail', MassRole.Primary, [w * 0.22, h, w * 0.22], [w * 0.5 - w * 0.11, h * 0.5, 0], 'rivetPlate', {
        mirrorX: true, segments: BUILDING_GEOMETRY.railSegments, capSlot: 'paintSmall',
      }),
      box('coping', MassRole.Primary, [w, h * 0.14, w * 0.50], [0, h * 0.93, 0], 'paintSmall', { chamfer: 0.05 }),
      box('merlon', MassRole.Greeble, [w * 0.16, h * 0.16, w * 0.44], [w * 0.24, h * 0.98, 0], 'rivetPlate', {
        mirrorX: true, group: 'merlons', chamfer: 0.04,
      }),
      teamPanel('team.band', [w * 0.30, h * 0.30, 0.12], [0, h * 0.52, w * 0.22]),
    ]
    : [
      tbox('wall', MassRole.Primary, [w, h * 0.82, w * 0.36], [0, h * 0.41, 0], 'paintMed', {
        topScaleX: 0.86, topScaleZ: 0.80, bottomScaleX: 1.02, bottomScaleZ: 1.10, cornerCut: w * 0.05,
      }),
      tbox('post', MassRole.Primary, [w * 0.18, h, w * 0.44], [w * 0.5 - w * 0.09, h * 0.5, 0], 'paintMed', {
        topScaleX: 0.78, topScaleZ: 0.86, bottomScaleX: 1.08, bottomScaleZ: 1.04,
      }, { mirrorX: true }),
      plate('coping', MassRole.Primary, taperOutline(w, w * 0.44, 0.86), h * 0.12,
        [0, h * 0.92, 0], undefined, 'paintSmall', { chamfer: 0.045 }),
      box('rail', MassRole.Greeble, [w, 0.10, 0.10], [0, h * 1.02, w * 0.16], 'bareMetal', {
        mirrorX: false, group: 'rails', chamfer: 0.02,
      }),
      teamPanel('team.band', [w * 0.34, h * 0.24, 0.12], [0, h * 0.50, w * 0.20]),
    ];
  masses.push(
    box('kick', MassRole.Greeble, [w * 0.98, h * 0.14, w * 0.52], [0, h * 0.07, 0], 'paintSmall', { group: 'kick', chamfer: 0.05 }),
    box('lamp', MassRole.Emissive, [0.24, 0.20, 0.10], [w * 0.30, h * 0.72, w * 0.22], 'emissive', {
      group: 'lamps', feature: Feature.Window, chamfer: 0.03,
    }),
    box('bolt', MassRole.Greeble, [w * 0.10, h * 0.10, 0.10], [-w * 0.28, h * 0.30, w * 0.20], 'hatch', {
      group: 'bolts', chamfer: 0.02,
    }),
  );
  return list(`${faction === 'allies' ? 'allied' : 'soviet'}_wall`, 'Wall', faction, 'wall',
    masses, [], { cls: 'wall' });
}

/** A gate: the wall language plus two leaves that sink into the roadway. */
function gateSegment(faction: StructureFaction): StructureMassList {
  const f = fp('gate');
  const w = f.w * CELL;
  const h = f.height;
  const soviet = faction === 'soviets';
  const masses: M[] = [
    ...foundationPad(faction, f.w, f.h, h),
    tbox('tower', MassRole.Primary, [w * 0.24, h, w * 0.52], [w * 0.5 - w * 0.12, h * 0.5, 0],
      soviet ? 'rivetPlate' : 'paintMed',
      soviet
        ? { topScaleX: 0.92, topScaleZ: 0.94, bottomScaleX: 1.06, bottomScaleZ: 1.04, cornerCut: w * 0.04 }
        : { topScaleX: 0.82, topScaleZ: 0.88, bottomScaleX: 1.06, bottomScaleZ: 1.02, cornerCut: w * 0.05 },
      { mirrorX: true }),
    tbox('lintel', MassRole.Primary, [w, h * 0.20, w * 0.46], [0, h * 0.90, 0], soviet ? 'rivetPlate' : 'paintMed', {
      topScaleX: 0.94, topScaleZ: 0.84, cornerCut: w * 0.05,
    }, { chamfer: 0.06 }),
    plate('hazard', MassRole.Primary, taperOutline(w * 0.76, w * 0.50, 0.90), h * 0.10,
      [0, h * 0.78, 0], undefined, 'stripe', { chamfer: 0.04 }),
    // Two leaves, each retracting straight down into the roadway.
    box('leaf', MassRole.Greeble, [w * 0.38, h * 0.70, 0.24], [w * 0.19, h * 0.35, 0], 'grille', {
      mirrorX: true, group: 'leaves', feature: Feature.Door, anim: h * 0.74, chamfer: 0.04,
    }),
    cyl('hinge', MassRole.Greeble, [0.30, h * 0.80, 0.30], [w * 0.5 - w * 0.12, h * 0.40, w * 0.14], 'bareMetal', {
      mirrorX: true, group: 'hinges', capSlot: 'grille',
    }),
    box('lamp', MassRole.Emissive, [0.28, 0.22, 0.12], [w * 0.30, h * 0.72, w * 0.24], 'emissive', {
      mirrorX: true, group: 'lamps', feature: Feature.Window, chamfer: 0.03,
    }),
    box('bollard', MassRole.Greeble, [w * 0.10, h * 0.22, w * 0.10], [w * 0.40, h * 0.11, w * 0.34], 'stripe', {
      mirrorX: true, group: 'bollards', chamfer: 0.03,
    }),
    teamPanel('team.lintel', [w * 0.60, h * 0.08, w * 0.30], [0, h * 1.01, 0]),
  ];
  return list(`${faction === 'allies' ? 'allied' : 'soviet'}_gate`, 'Gate', faction, 'gate',
    masses, [
      { part: PartId.Door, pos: [0, 0.2, 0] },
    ], { cls: 'wall' });
}


/**
 * ORE SILO. One cell, five metres, and it has to read as storage rather than
 * as a small barracks — so it is a drum in both armies, and the faction
 * language lands in how the drum is capped, banded and served.
 */
function oreSilo(faction: StructureFaction): StructureMassList {
  const f = fp('oreSilo');
  const w = f.w * CELL * 0.80;
  const h = f.height;
  const soviet = faction === 'soviets';
  const wall: SlotName = soviet ? 'rivetPlate' : 'paintMed';
  const masses: M[] = [
    ...foundationPad(faction, f.w, f.h, h),
    cyl('drum', MassRole.Primary, [w, h * 0.68, w], [0, h * 0.34, 0], wall, {
      capSlot: 'paintSmall', topRadius: soviet ? 1.0 : 0.94,
    }),
    soviet
      // SOVIET: a riveted cone cap with a flat disc collar.
      ? cyl('cap', MassRole.Primary, [w * 1.02, h * 0.22, w * 1.02], [0, h * 0.79, 0], 'rivetPlate', {
        topRadius: 0.44, capSlot: 'grille',
      })
      // ALLIED-2 at silo scale: an open-topped crown instead of a cone.
      : pplan('cap', MassRole.Primary, [w * 0.86, h * 0.24, w * 0.86], [0, h * 0.80, 0], 'paintMed', {
        plan: ngon(w * 0.43, w * 0.43, 6, HALF_PI / 3), topScaleX: 0.86, topScaleZ: 0.86,
      }, { capSlot: 'grille' }),
    cyl('collar', MassRole.Primary, [w * 1.06, h * 0.06, w * 1.06], [0, h * 0.66, 0], 'bareMetal', {
      chamfer: 0.05, capSlot: 'grille',
    }),
    // The service kit. A silo is a drum plus its plumbing, and the plumbing is
    // what stops one cell of storage reading as an untextured cylinder.
    box('ladder', MassRole.Greeble, [0.30, h * 0.72, 0.10], [0, h * 0.36, w * 0.52], 'stripe', {
      group: 'ladder', chamfer: 0.03,
    }),
    cyl('valve', MassRole.Greeble, [0.44, 0.34, 0.44], [-w * 0.34, h * 0.20, w * 0.34], 'bareMetal', {
      group: 'valves', chamfer: 0.04, capSlot: 'hatch',
    }),
    box('feedpipe', MassRole.Greeble, [0.26, h * 0.46, 0.26], [w * 0.40, h * 0.44, -w * 0.30], 'bareMetal', {
      group: 'pipes', chamfer: 0.04,
    }),
    box('feedhead', MassRole.Greeble, [0.60, 0.32, 0.60], [w * 0.40, h * 0.70, -w * 0.30], 'hatch', { group: 'pipes' }),
    box('gauge', MassRole.Greeble, [w * 0.26, h * 0.16, 0.14], [0, h * 0.44, -w * 0.50], 'stencil', {
      group: 'gauges', chamfer: 0.04,
    }),
    box('skirt.vent', MassRole.Greeble, [w * 0.34, h * 0.14, 0.16], [-w * 0.22, h * 0.12, w * 0.46], 'vent', { group: 'vents' }),
    box('hatch', MassRole.Greeble, [w * 0.30, 0.20, w * 0.30], [w * 0.16, h * 0.92, 0], 'hatch', { group: 'hatches', chamfer: 0.04 }),
    box('plate', MassRole.Greeble, [w * 0.28, h * 0.12, 0.12], [w * 0.24, h * 0.24, w * 0.46], 'stencil', {
      group: 'plates', chamfer: 0.03,
    }),
    greebleRun('drum.run', h * 0.34, 0.20, 0.16, [-w * 0.30, h * 0.40, -w * 0.38], 0x5170, { rot: [0, 0.9, 0] }),
    teamPanel('team.band', [w * 1.02, h * 0.045, w * 0.26], [0, h * 0.52, 0]),
    teamPanel('team.cap', [w * 0.30, 0.10, w * 0.18], [0, h * 0.93, 0]),
    insignia(w * 0.34, [0, h * 0.34, w * 0.50]),
    ...windows(w * 0.44, h * 0.14, w * 0.50, 2, w * 0.16, h * 0.07, 'lamp'),
    box('win.roof', MassRole.Emissive, [w * 0.30, 0.12, w * 0.22], [-w * 0.16, h * 0.93, 0], 'emissive', {
      group: 'roofLights', feature: Feature.Window, chamfer: 0.03,
    }),
  ];
  return list(`${soviet ? 'soviet' : 'allied'}_silo`, 'Ore Silo', faction, 'oreSilo', masses, [
    { part: PartId.Hopper, pos: [0, h * 0.70, -w * 0.30] },
    { part: PartId.DockEntry, pos: [0, 0.2, w * 0.5 + 2.2] },
  ]);
}

/* ==========================================================================
 * 4b. THE SUPERWEAPONS
 *
 * Four structures on one 3x3, 13 m pad (`BUILDING_DIMENSIONS.superweapon`) —
 * the biggest plan and the tallest roofline in the game, because an opponent
 * has to be able to read that one of these exists from across the map before
 * the countdown finishes. `src/sim/Superweapons.ts` has charged, warned and
 * fired all four of these since it was written; until now none of them had a
 * building to charge FROM.
 *
 * Each one says what it does from the silhouette alone, which is the whole
 * design brief: a launch tube with the blast doors open, two emitters facing
 * each other across a gap, a sphere hung in a gantry, a mast throwing arcs.
 * ========================================================================== */

/**
 * THE DISPLACEMENT RING. Two raking pylons carrying a glass sphere in the gap
 * between them — the one Allied structure whose readable volume is not a
 * module but a void with something floating in it.
 */
function alliedChronosphere(): StructureMassList {
  const f = fp('superweapon');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'superweapon', paired: true, team: 1.14, windowCount: 6, bodyFraction: 0.34,
  });
  const roof = s.roofY;
  const coreY = roof + (f.height - roof) * 0.60;
  const r = s.w * 0.20;
  s.masses.push(
    // The pylons. Raked in — a splayed pair reads as a cradle rather than as
    // two chimneys, and the taper is what carries the eye up to the sphere.
    tbox('pylon', MassRole.Primary, [1.9, f.height - roof, 2.2], [s.w * 0.31, (f.height + roof) * 0.5, 0], 'paintMed', {
      topScaleX: 0.46, topScaleZ: 0.58, bottomScaleX: 1.22, bottomScaleZ: 1.16, cornerCut: 0.18,
    }, { mirrorX: true, chamfer: 0.09 }),
    // The sphere: two domes back to back. There is no sphere primitive and
    // there should not be — the pair reads better anyway, because the seam
    // gives the equator a hard specular line under the fixed camera.
    { name: 'core.hi', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [r * 2, r * 1.05, r * 2], anchor: [0, coreY, 0], slot: 'glass',
      capSlot: 'paintSmall', tint: 0.94 },
    { name: 'core.lo', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [r * 2, r * 1.05, r * 2], anchor: [0, coreY, 0], slot: 'glass',
      rot: [Math.PI, 0, 0], capSlot: 'paintSmall', tint: 0.94 },
    cyl('core.band', MassRole.Greeble, [r * 2.16, 0.26, r * 2.16], [0, coreY, 0], 'bareMetal', {
      group: 'core', chamfer: 0.05, capSlot: 'grille', segments: 12,
    }),
    cyl('core.lamp', MassRole.Emissive, [r * 0.90, r * 0.90, r * 0.90], [0, coreY, 0], 'emissive', {
      group: 'core', feature: Feature.Window, capSlot: 'emissive', segments: 10,
    }),
    // The feed: a conduit up each pylon into the sphere's collar.
    box('feed', MassRole.Greeble, [s.w * 0.24, 0.30, 0.30], [s.w * 0.16, coreY, 0], 'bareMetal', {
      mirrorX: true, group: 'feeds', chamfer: 0.05,
    }),
    cyl('capacitor', MassRole.Greeble, [1.10, roof * 0.62, 1.10], [-s.w * 0.30, roof * 0.31, s.d * 0.26], 'bareMetal', {
      group: 'capacitors', topRadius: 0.88, capSlot: 'hatch', segments: 10, chamfer: 0.06,
    }),
    box('bus.hood', MassRole.Greeble, [s.w * 0.20, 0.30, s.d * 0.16], [-s.w * 0.12, roof + 0.22, s.d * 0.28], 'vent', { group: 'bus' }),
  );
  return list('allied_chrono', 'Displacement Ring', 'allies', 'superweapon', s.masses, [
    ...baseSockets(s.d, roof + 1.0, -s.w * 0.30, -s.d * 0.30),
    { part: PartId.Emitter, pos: [0, coreY, 0] },
    { part: PartId.Antenna, pos: [0, f.height, 0] },
  ]);
}

/* ==========================================================================
 * 4b. THE CIVILIAN BLOCK
 *
 * Three neutral structures, so `src/sim/Capture.ts` and `src/sim/Garrison.ts`
 * have something on the map to act on. See `src/data/Civilians.ts`.
 *
 * WHY THEY WEAR ALLIED ARCHITECTURE, and it is a cost decision rather than a
 * fiction. `StructureFaction` is `'allies' | 'soviets'` and each one costs TWO
 * generated atlases plus a material; `src/art/buildings.system.ts` already made
 * this call in prose — "Neutral structures borrow Allied architecture. A third
 * atlas for civilian paint would cost 4 textures and a material for buildings
 * nobody fights over" — and these are the first buildings that make the
 * sentence about something real. Glazed bands and a light ceramic skirt read
 * perfectly well as a modern hospital or an apartment tower; what makes them
 * civilian rather than military is the SILHOUETTE each one adds on top of the
 * shell, which is the half that costs nothing.
 *
 * THE TEAM PANELS STAY, AND THEY DO NOT REPAINT ON CAPTURE. Both halves of
 * that were checked on screen rather than assumed, because the obvious
 * assumption is wrong: `applyStructureShader` reads the per-instance
 * `aTeamColor` for the SELECTION PULSE ONLY, and a structure's `teamSlab`
 * texels come out of the greeble atlas, which is generated once per
 * `StructureFaction`. Two derricks photographed side by side — one Gaia, one
 * just taken by the Allies — are the same colour. R-T1 still requires 4-10% of
 * the surface to be team slab and `validateStructure` still enforces it, so the
 * panels are not optional; they are simply not the ownership tell.
 *
 * What IS the tell, each one watched happen in a running match: the minimap
 * blip goes from neutral grey to the holder's accent (`src/ui/Minimap.ts` —
 * which needed a fix of its own, because Gaia is allied to everyone and the
 * blip was already drawing in your colour), the structure starts feeding its
 * new owner's vision, `Capture.captureBuilding` fires a `BuildComplete` burst
 * and a spark plume on the spot, and — for the derrick — the credits start
 * arriving. Repainting the slabs would mean multiplying `aTeamColor` into the
 * teamSlab texels for all 59 structures in the roster: a grade-wide change to
 * `BuildingFactory`, and not one the civilian block gets to decide.
 * ========================================================================== */

/**
 * OIL DERRICK. The one that pays, so it has to be the one you can see.
 *
 * A short pumphouse under a heavily raked lattice mast: the mast is 63% of the
 * silhouette and is a four-sided plan tapering to under a third of its base, so
 * this is the least axis-aligned thing in the roster by construction rather
 * than by decoration. The walking beam and its counterweight are what say
 * "pump" rather than "radio tower" at RTS distance.
 */
function civDerrick(): StructureMassList {
  const f = fp('civOilDerrick');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'civOilDerrick', team: 1.30, windowCount: 3, bodyFraction: 0.30,
  });
  const roof = s.roofY;
  const mastH = f.height - roof - 0.6;
  s.masses.push(
    // THE MAST IS A CORE PLUS AN OPEN FRAME, and the split is the whole read.
    //
    // It was one solid tapered prism at 72% of the footprint and it
    // photographed as a MONUMENT: a white pyramid with a cap, which is a fine
    // silhouette and the wrong noun. A derrick is a thing you can see through.
    // So the tapered mass is now a slender core at 34%, and the volume the
    // player actually reads is two `lattice()` frames standing off it —
    // X-braced bays that are 90% air.
    pplan('mast', MassRole.Primary, [s.w * 0.34, mastH, s.d * 0.34], [0, roof + mastH * 0.5, -s.d * 0.06], 'bareMetal', {
      plan: ngon(s.w * 0.17, s.d * 0.17, 4, HALF_PI * 0.5),
      topScaleX: 0.34, topScaleZ: 0.34, bottomScaleX: 1.10, bottomScaleZ: 1.10,
    }, { capSlot: 'grille' }),
    ...lattice(0, -s.d * 0.26, s.w * 0.62, mastH * 0.94, 'rig.front').map(
      (m) => ({ ...m, anchor: [m.anchor[0], m.anchor[1] + roof, m.anchor[2]] as V3 })),
    ...lattice(0, s.d * 0.16, s.w * 0.62, mastH * 0.94, 'rig.back').map(
      (m) => ({ ...m, anchor: [m.anchor[0], m.anchor[1] + roof, m.anchor[2]] as V3 })),
    cyl('crownblock', MassRole.Greeble, [1.1, 0.55, 1.1], [0, f.height - 0.3, -s.d * 0.06], 'bareMetal', {
      group: 'crownblock', chamfer: 0.05, capSlot: 'hatch',
    }),
    // The walking beam, canted the way a beam pump rests when it is down.
    box('beam', MassRole.Greeble, [0.42, 0.36, s.d * 0.70], [s.w * 0.30, roof * 0.92, s.d * 0.12], 'bareMetal', {
      rot: [0.22, 0, 0], group: 'pump', chamfer: 0.05,
    }),
    cyl('beam.weight', MassRole.Greeble, [1.0, 0.42, 1.0], [s.w * 0.30, roof * 0.72, -s.d * 0.22], 'hatch', {
      rot: [0, 0, HALF_PI], group: 'pump', chamfer: 0.05, capSlot: 'stencil',
    }),
    // The tank the thing fills. A lathe, so it never reads as a crate.
    rev('tank', MassRole.Primary, [s.w * 0.34, roof * 1.05, s.w * 0.34], [-s.w * 0.30, roof * 0.52, s.d * 0.24], 'paintMed',
      DRUM, BUILDING_GEOMETRY.cylSegments, { capSlot: 'paintSmall', group: 'tank' }),
    box('tank.pipe', MassRole.Greeble, [s.w * 0.30, 0.24, 0.24], [-s.w * 0.14, roof * 0.66, s.d * 0.24], 'bareMetal', {
      group: 'plumbing', chamfer: 0.05,
    }),
  );
  return list('civ_derrick', 'Oil Derrick', 'allies', 'civOilDerrick', s.masses, [
    { part: PartId.Stack, pos: [0, f.height, -s.d * 0.06] },
  ]);
}

/**
 * THE WEATHER CONTROL DEVICE. A stepped mast under a wide collector saucer,
 * with the discharge horns standing off the rim. Reads as a thing pointed AT
 * the sky, which is the one cue that separates it from the Radar Dome.
 */
function alliedWeatherControl(): StructureMassList {
  const f = fp('superweapon');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'superweapon', paired: true, team: 1.14, windowCount: 6, bodyFraction: 0.36,
  });
  const roof = s.roofY;
  const mastTop = f.height - 2.3;
  s.masses.push(
    cyl('mast', MassRole.Primary, [s.w * 0.30, mastTop - roof, s.w * 0.30], [0, (mastTop + roof) * 0.5, 0], 'paintMed', {
      topRadius: 0.62, capSlot: 'paintSmall', segments: 14,
    }),
    // The saucer. Inverted, because it is collecting rather than transmitting.
    { name: 'saucer', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [s.w * 0.72, 2.0, s.w * 0.72], anchor: [0, mastTop + 1.0, 0], slot: 'paintMed',
      rot: [Math.PI, 0, 0], capSlot: 'grille' },
    cyl('saucer.rim', MassRole.Greeble, [s.w * 0.78, 0.34, s.w * 0.78], [0, mastTop + 0.1, 0], 'bareMetal', {
      group: 'saucer', chamfer: 0.05, capSlot: 'grille', segments: 12,
    }),
    // The discharge spike down the axis of the dish, and its lit tip.
    cyl('spike', MassRole.Primary, [0.62, 3.2, 0.62], [0, f.height - 1.2, 0], 'bareMetal', {
      topRadius: 0.24, capSlot: 'grille', segments: 10,
    }),
    box('spike.tip', MassRole.Emissive, [0.44, 0.60, 0.44], [0, f.height + 0.25, 0], 'emissive', {
      group: 'spike', feature: Feature.Window, chamfer: 0.05,
    }),
    // Three horns standing off the rim. Authored as one greeble group so the
    // whole ring costs one object in the clutter budget.
    box('horn', MassRole.Greeble, [0.28, 1.5, 0.28], [s.w * 0.34, mastTop + 0.9, 0], 'bareMetal', {
      mirrorX: true, group: 'horns', chamfer: 0.04,
    }),
    box('horn.rear', MassRole.Greeble, [0.28, 1.5, 0.28], [0, mastTop + 0.9, -s.d * 0.34], 'bareMetal', {
      group: 'horns', chamfer: 0.04,
    }),
    cyl('coolant', MassRole.Greeble, [1.05, roof * 0.66, 1.05], [-s.w * 0.32, roof * 0.33, s.d * 0.24], 'bareMetal', {
      group: 'coolant', topRadius: 0.88, capSlot: 'hatch', segments: 10, chamfer: 0.06,
    }),
    box('plant.hood', MassRole.Greeble, [s.w * 0.20, 0.32, s.d * 0.16], [s.w * 0.14, roof + 0.24, s.d * 0.26], 'vent', { group: 'plant' }),
  );
  return list('allied_weather', 'Weather Control Device', 'allies', 'superweapon', s.masses, [
    ...baseSockets(s.d, roof + 1.0, -s.w * 0.32, -s.d * 0.30),
    { part: PartId.Dish, pos: [0, mastTop + 1.0, 0] },
    { part: PartId.Antenna, pos: [0, f.height + 0.5, 0] },
  ]);
}

/**
 * THE NUCLEAR MISSILE SILO. A battered concrete slab with the launch tube let
 * INTO it rather than standing on it, blast doors thrown back on the deck, and
 * the warhead nose showing at the lip. Nothing else in the game is a hole.
 */
function sovietNuclearSilo(): StructureMassList {
  const f = fp('superweapon');
  const s = sovietShell(f.w, f.h, f.height, {
    key: 'superweapon', team: 1.0, windowCount: 5, bodyFraction: 0.36,
  });
  const roof = s.roofY;
  const tubeTop = f.height - 3.0;
  const tx = s.w * 0.06, tz = -s.d * 0.04;
  s.masses.push(
    // The tube. Wide, short and dead vertical on purpose: a launch tube is the
    // one thing on a battlefield that IS a cylinder, and the batter lives in
    // the slab underneath it.
    cyl('tube', MassRole.Primary, [s.w * 0.44, tubeTop - roof * 0.9, s.w * 0.44], [tx, (tubeTop + roof * 0.9) * 0.5, tz], 'rivetPlate', {
      topRadius: 0.94, capSlot: 'grille', segments: 12,
    }),
    cyl('tube.collar', MassRole.Greeble, [s.w * 0.52, 0.42, s.w * 0.52], [tx, tubeTop - 0.2, tz], 'bareMetal', {
      group: 'tube', chamfer: 0.06, capSlot: 'grille', segments: 10,
    }),
    // The warhead, sitting proud of the lip.
    { name: 'warhead', primitive: 'lathe', role: MassRole.Primary, profile: 'dome',
      size: [s.w * 0.30, 2.6, s.w * 0.30], anchor: [tx, tubeTop + 1.3, tz], slot: 'paintMed',
      capSlot: 'grille' },
    box('warhead.band', MassRole.Emissive, [s.w * 0.26, 0.22, s.w * 0.26], [tx, tubeTop + 0.55, tz], 'emissive', {
      group: 'warhead', feature: Feature.Window, chamfer: 0.04,
    }),
    // The blast doors, thrown back flat on the deck. `Feature.Door` drops them
    // when the silo works, which is the same animation a War Factory's roller
    // uses and costs nothing extra.
    box('door', MassRole.Greeble, [s.w * 0.30, 0.34, s.d * 0.46], [s.w * 0.36, roof * 0.92, tz], 'tread', {
      mirrorX: true, group: 'doors', feature: Feature.Door, anim: 0.7, chamfer: 0.05,
    }),
    ...sovietVessel(-s.w * 0.30, s.d * 0.24, s.w * 0.13, roof * 1.10, 'coolant'),
    ...sovietStack(s.w * 0.34, -s.d * 0.28, s.w * 0.075, roof * 1.05, f.height - 3.6, 'stackA'),
    // NO SECOND LATTICE AND NO CATWALK. `sovietShell` already puts a lattice
    // mast up the -X flank, and `lattice()` emits five masses per bay — a
    // second one plus a railed catwalk was 700 triangles of scaffolding on the
    // biggest footprint in the game, for hardware the camera reads as noise at
    // this scale. The tube is the silhouette; the scaffolding is not.
  );
  return list('soviet_nuke', 'Nuclear Missile Silo', 'soviets', 'superweapon', s.masses, [
    ...baseSockets(s.d, f.height - 3.6, s.w * 0.34, -s.d * 0.28),
    { part: PartId.Emitter, pos: [tx, tubeTop + 1.3, tz] },
    { part: PartId.Antenna, pos: [tx, f.height, tz] },
  ]);
}

/**
 * CIVILIAN HOSPITAL. The widest of the three, and the one a squad wants.
 *
 * Paired, because ALLIED-3's two mirrored modules sharing a spine is exactly
 * how a real hospital wing reads. What makes it a hospital and not a barracks
 * is the ambulance canopy across the whole front and the rooftop helipad —
 * both of them horizontal surfaces, which a 39-degree camera weights at 0.63
 * of their area against 0.25 for a flank.
 */
function civHospital(): StructureMassList {
  const f = fp('civHospital');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'civHospital', paired: true, team: 1.05, windowCount: 7, bodyFraction: 0.60,
  });
  const roof = s.roofY;
  s.masses.push(
    // The ambulance canopy: a raked slab on two posts over the whole entrance.
    // Sized and anchored so the canopy's raked far edge lands INSIDE the
    // structure's own cells: `validateStructure` warns on a body that
    // overhangs its footprint, and a 3x2 hospital that spills into the next
    // cell is a hospital an adjacent structure can interpenetrate.
    plate('portico', MassRole.Primary, taperOutline(s.w * 0.72, s.d * 0.28, 0.86), 0.36,
      [0, roof * 0.80, s.d * 0.36], [-0.14, 0, 0], 'paintMed', { chamfer: 0.07 }),
    box('portico.post', MassRole.Greeble, [0.26, roof * 0.78, 0.26], [s.w * 0.28, roof * 0.46, s.d * 0.46], 'bareMetal', {
      mirrorX: true, group: 'portico', chamfer: 0.05,
    }),
    box('doors', MassRole.Greeble, [s.w * 0.22, roof * 0.46, 0.28], [0, roof * 0.23, s.d * 0.5 + 0.02], 'glass', {
      group: 'doors', feature: Feature.Door, anim: roof * 0.50, chamfer: 0.05, tint: 0.93,
    }),
    // The helipad. A disc, its rim, and the lamp ring that makes it read at night.
    cyl('helipad', MassRole.Greeble, [s.d * 0.66, 0.22, s.d * 0.66], [-s.w * 0.10, roof + 0.14, -s.d * 0.14], 'stripe', {
      group: 'helipad', chamfer: 0.05, capSlot: 'stripe',
    }),
    cyl('helipad.rim', MassRole.Emissive, [s.d * 0.70, 0.10, s.d * 0.70], [-s.w * 0.10, roof + 0.06, -s.d * 0.14], 'emissive', {
      group: 'helipad', feature: Feature.Window, chamfer: 0.03, capSlot: 'emissive',
    }),
    // The plant room, which is what gives the roofline its second step.
    tbox('plantroom', MassRole.Primary, [s.w * 0.24, f.height - roof - 0.4, s.d * 0.30], [s.w * 0.32, (f.height + roof) * 0.5 - 0.2, s.d * 0.16], 'paintMed', {
      topScaleX: 0.84, topScaleZ: 0.84, cornerCut: 0.30,
    }, { capSlot: 'grille' }),
    box('plantroom.duct', MassRole.Greeble, [s.w * 0.16, 0.6, s.d * 0.18], [s.w * 0.32, f.height - 0.1, s.d * 0.16], 'vent', {
      group: 'ducts',
    }),
  );
  return list('civ_hospital', 'Civilian Hospital', 'allies', 'civHospital', s.masses, [
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.4] },
    { part: PartId.Stack, pos: [s.w * 0.32, f.height, s.d * 0.16] },
  ]);
}

/**
 * THE IRONCLAD FIELD. Two emitter drums on cantilevered arms facing each
 * other across a lit gap. The gap IS the building: it is the only structure in
 * the game whose most important feature is empty space, and the arms exist to
 * hold that space open at a height the camera can see into.
 */
function sovietIronCurtain(): StructureMassList {
  const f = fp('superweapon');
  const s = sovietShell(f.w, f.h, f.height, {
    key: 'superweapon', team: 1.0, windowCount: 5, bodyFraction: 0.34,
  });
  const roof = s.roofY;
  const gapY = f.height - 3.4;
  const arm = s.w * 0.30;
  s.masses.push(
    // The two arms, raked in so the emitters overhang the deck.
    tbox('arm', MassRole.Primary, [1.7, gapY - roof * 0.9, 2.0], [s.w * 0.34, (gapY + roof * 0.9) * 0.5, 0], 'rivetPlate', {
      topScaleX: 0.52, topScaleZ: 0.64, bottomScaleX: 1.18, bottomScaleZ: 1.12, cornerCut: 0.16, shear: -s.w * 0.06,
    }, { mirrorX: true, chamfer: 0.08 }),
    // The emitter heads, pointed at each other.
    cyl('emitter', MassRole.Primary, [2.3, 2.0, 2.3], [arm, gapY, 0], 'bareMetal', {
      rot: [0, 0, Math.PI * 0.5], mirrorX: true, topRadius: 0.58, capSlot: 'grille', segments: 10,
    }),
    // THE GAP. Everything above is here to frame it.
    cyl('gap', MassRole.Emissive, [1.05, arm * 1.55, 1.05], [0, gapY, 0], 'emissive', {
      rot: [0, 0, Math.PI * 0.5], feature: Feature.Window, capSlot: 'emissive', segments: 10, chamfer: 0.05,
    }),
    // The discharge mast standing between the arms. It is what carries the
    // structure to its frozen 13 m roofline — the SOVIET-3 stack normally does
    // that job and this building has no stack (see below) — and it is also the
    // reason the pair of coils reads as one machine rather than two towers.
    cyl('spire', MassRole.Primary, [1.0, f.height - gapY, 1.0], [0, (f.height + gapY) * 0.5, -s.d * 0.04], 'bareMetal', {
      topRadius: 0.34, capSlot: 'grille', segments: 10,
    }),
    box('spire.tip', MassRole.Emissive, [0.36, 0.44, 0.36], [0, f.height - 0.18, -s.d * 0.04], 'emissive', {
      group: 'spireTip', feature: Feature.Window, chamfer: 0.04,
    }),
    box('arm.tie', MassRole.Greeble, [s.w * 0.60, 0.30, 0.34], [0, gapY - 2.1, -s.d * 0.10], 'bareMetal', {
      group: 'ties', chamfer: 0.05,
    }),
    // Two chargers and NO STACK, which is the one place this structure departs
    // from SOVIET-3. Nothing is burned here — the Field is a capacitor bank
    // discharged through two coils — and a smoking chimney on it would be the
    // faction language overruling what the building actually does.
    ...sovietVessel(-s.w * 0.28, s.d * 0.26, s.w * 0.14, roof * 1.08, 'charger'),
    ...sovietVessel(-s.w * 0.10, -s.d * 0.34, s.w * 0.11, roof * 1.04, 'chargerB'),
    // See the Nuclear Silo: `sovietShell` already carries a lattice mast, and
    // a second one is 400 triangles of scaffolding behind the arms.
    greebleRun('bus.run', s.d * 0.46, 0.24, 0.20, [-s.w * 0.40, roof * 0.52, s.d * 0.06], 0x4943),
  );
  return list('soviet_curtain', 'Ironclad Field', 'soviets', 'superweapon', s.masses, [
    ...baseSockets(s.d, roof * 1.30, -s.w * 0.10, -s.d * 0.34),
    { part: PartId.Emitter, pos: [0, gapY, 0] },
    { part: PartId.CoilTip, pos: [0, f.height, -s.d * 0.04] },
  ]);
}

/**
 * APARTMENT BLOCK. The tallest thing on the map that nobody built.
 *
 * Two towers on a shared spine at 15 m, which is where the height comes from:
 * this is the only civilian structure a player can see over their own base
 * from, so holding one is worth the walk. Balcony decks up both flanks are
 * layered plates — 28 triangles each against a box's 44 — and they are what
 * makes a residential tower read as residential rather than as a silo.
 */
function civApartments(): StructureMassList {
  const f = fp('civApartments');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'civApartments', paired: true, team: 1.02, windowCount: 8, bodyFraction: 0.62,
  });
  const roof = s.roofY;
  s.masses.push(
    // Balcony decks. Two courses up each flank, following the skirt's rake.
    // A balcony projects, but not past the block's own cells — the deck is
    // 1.1 m of it, so the anchor has to leave that much room inside `w/2` or
    // `validateStructure` reports a body overhanging its footprint.
    plate('balcony.lo', MassRole.Greeble, taperOutline(s.d * 0.62, 1.10, 0.90), 0.20,
      [s.w * 0.42, roof * 0.36, 0], [0, HALF_PI, 0], 'stripe',
      { mirrorX: true, group: 'balconies', chamfer: 0.05 }),
    plate('balcony.hi', MassRole.Greeble, taperOutline(s.d * 0.56, 1.00, 0.90), 0.20,
      [s.w * 0.38, roof * 0.68, 0], [0, HALF_PI, 0], 'stripe',
      { mirrorX: true, group: 'balconies', chamfer: 0.05 }),
    // The stair core: the step in the roofline, and the one mass that reaches
    // the frozen 15 m.
    tbox('stairhead', MassRole.Primary, [s.w * 0.30, f.height - roof - 0.5, s.d * 0.26], [-s.w * 0.26, (f.height + roof) * 0.5 - 0.25, -s.d * 0.12], 'paintMed', {
      topScaleX: 0.88, topScaleZ: 0.88, cornerCut: 0.26,
    }, { capSlot: 'paintSmall' }),
    // The roof tank every block of flats in the world has on it.
    rev('watertank', MassRole.Greeble, [s.w * 0.30, 1.5, s.w * 0.30], [s.w * 0.24, roof + 1.35, s.d * 0.14], 'bareMetal',
      TAPER_DRUM, BUILDING_GEOMETRY.cylSegments, { group: 'watertank', capSlot: 'grille' }),
    box('watertank.leg', MassRole.Greeble, [0.18, 0.66, 0.18], [s.w * 0.36, roof + 0.33, s.d * 0.14], 'bareMetal', {
      mirrorX: true, group: 'watertank', chamfer: 0.03,
    }),
    box('lobby', MassRole.Greeble, [s.w * 0.30, roof * 0.22, 0.34], [0, roof * 0.11, s.d * 0.5 + 0.04], 'glass', {
      group: 'lobby', feature: Feature.Door, anim: roof * 0.24, chamfer: 0.05, tint: 0.93,
    }),
  );
  return list('civ_apartments', 'Apartment Block', 'allies', 'civApartments', s.masses, [
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.4] },
  ]);
}

/**
 * ORE MINE. The second structure that pays its holder, and the one that has to
 * NOT look like the first.
 *
 * Both are 2x2, both are neutral, both are a tall thing over a low shed, and at
 * RTS distance that is a recipe for two objectives a player cannot tell apart on
 * the minimap edge of their screen. Three cues separate them, in the order the
 * camera reads them:
 *
 *   THE SHEAVE WHEELS. A disc on a HORIZONTAL axis, and nothing else in the
 *   roster of 60 structures has one — every other wheel-like mass in the game
 *   (radar dish, weather saucer, helipad) is either vertical-axis or a dish.
 *   Two of them, at different heights on the same frame, because one reads as a
 *   fan and two read as winding gear.
 *   THE SPOIL HEAP. A faceted cone, which is the other thing no structure here
 *   has: every roof in the game is flat or stepped, so a pile is unambiguous. It
 *   is also the only mass that says what the building produces.
 *   THE HEADFRAME LEANS. The derrick's mast is a symmetric taper about its own
 *   axis; this frame is offset to -Z and braced back to the shed, so its
 *   silhouette is an A rather than a spike.
 *
 * The lattice does the same job it does on the derrick — a headframe is a thing
 * you see through — and for the same measured reason recorded there: a solid
 * tapered prism at this size photographs as a monument.
 */
function civMine(): StructureMassList {
  const f = fp('civOreMine');
  const s = alliedShell(f.w, f.h, f.height, {
    key: 'civOreMine', team: 1.22, windowCount: 3, bodyFraction: 0.34,
  });
  const roof = s.roofY;
  const frameH = f.height - roof - 1.2;
  const frameZ = -s.d * 0.18;
  const headY = roof + frameH;
  s.masses.push(
    // The frame core: a six-sided plan closing to a fifth of its base. Six and
    // not four so the braces catch a different highlight from the shed's own
    // octagonal skirt, which is what stops the two masses reading as one prism.
    pplan('frame', MassRole.Primary, [s.w * 0.30, frameH, s.d * 0.30], [0, roof + frameH * 0.5, frameZ], 'bareMetal', {
      plan: ngon(s.w * 0.15, s.d * 0.15, 6, HALF_PI * 0.5),
      topScaleX: 0.22, topScaleZ: 0.22, bottomScaleX: 1.24, bottomScaleZ: 1.24,
    }, { capSlot: 'grille' }),
    ...lattice(0, frameZ - s.d * 0.14, s.w * 0.58, frameH * 0.92, 'frame.front').map(
      (m) => ({ ...m, anchor: [m.anchor[0], m.anchor[1] + roof, m.anchor[2]] as V3 })),
    ...lattice(0, frameZ + s.d * 0.14, s.w * 0.58, frameH * 0.92, 'frame.back').map(
      (m) => ({ ...m, anchor: [m.anchor[0], m.anchor[1] + roof, m.anchor[2]] as V3 })),
    // THE WINDING GEAR. Horizontal axis, so `rot` puts the lathe on its side.
    cyl('sheave.high', MassRole.Primary, [1.55, 0.34, 1.55], [0, headY - 0.35, frameZ], 'bareMetal', {
      rot: [0, 0, HALF_PI], group: 'sheave', chamfer: 0.05, capSlot: 'grille', segments: 12,
    }),
    /* THE SECOND SHEAVE AND THE SKIP WERE CUT, AND THE REASON IS THE BUDGET.
     *
     * `tests/building-shape.spec.ts` holds `MAX_MEAN_TRIANGLES` at 2500 and its
     * own note records that the Command Post block left "two triangles per
     * structure of headroom ... stated here so the next person does not spend
     * it by accident", and that the Command Bunker's roof catwalk was cut for
     * exactly this reason. Adding the Ore Mine at 2760 pushed the roster mean to
     * 2502. The precedent in that note is to CUT, not to rebase the guard — a
     * mean raised to fit the model it was measuring is not a guard — so this
     * follows it.
     *
     * Both cuts are `MassRole.Greeble`, which is the right tier to spend: a
     * second pulley 1.85 m under the first and an ore skip parked on a rail are
     * both under two pixels of separation at the shot camera's 30-62 m. The
     * silhouette masses — the headframe, the winding sheave, the A-brace and
     * the spoil heap — are untouched, and they are what says "mine" at RTS
     * range.
     */
    // The hoist rope's brace, tying the head back to the shed roof. This is the
    // mass that makes the silhouette an A instead of a T.
    box('brace', MassRole.Greeble, [0.30, 0.30, s.d * 0.66], [0, roof + frameH * 0.62, s.d * 0.10], 'bareMetal', {
      rot: [-0.62, 0, 0], group: 'brace', chamfer: 0.05,
    }),
    // The chute off the frame, raked down to the heap.
    box('chute', MassRole.Greeble, [0.62, 0.34, s.d * 0.52], [-s.w * 0.24, roof * 0.94, -s.d * 0.02], 'tread', {
      rot: [0.44, 0, 0.30], group: 'chute', chamfer: 0.05,
    }),
    // THE SPOIL HEAP: a seven-sided cone closing to almost nothing. `pplan`
    // rather than a lathe so it faces the same number of ways the frame does
    // and the two share a highlight direction.
    pplan('spoil', MassRole.Primary, [s.w * 0.44, roof * 0.62, s.d * 0.44], [-s.w * 0.28, roof * 0.31, s.d * 0.28], 'paintMed', {
      plan: ngon(s.w * 0.22, s.d * 0.22, 7, 0),
      topScaleX: 0.10, topScaleZ: 0.10, bottomScaleX: 1.0, bottomScaleZ: 1.0,
    }, { capSlot: 'paintSmall', group: 'spoil' }),
  );
  return list('civ_mine', 'Ore Mine', 'allies', 'civOreMine', s.masses, [
    { part: PartId.Stack, pos: [0, f.height, frameZ] },
  ]);
}

/* ==========================================================================
 * 5. THE ROSTER
 * ========================================================================== */

export const STRUCTURE_MASS_LISTS: readonly StructureMassList[] = [
  alliedConYard(),
  alliedPower(),
  alliedBarracks(),
  alliedRefinery(),
  alliedWarFactory(),
  alliedDepot(),
  alliedRadar(),
  alliedTech(),
  alliedCommandPost(),
  oreSilo('allies'),
  alliedNavalYard(),
  alliedPillbox(),
  alliedAaTurret(),
  alliedPrismTower(),
  alliedChronosphere(),
  alliedWeatherControl(),
  wallSegment('allies'),
  gateSegment('allies'),

  sovietConYard(),
  sovietPower(),
  sovietBarracks(),
  sovietRefinery(),
  sovietWarFactory(),
  sovietDepot(),
  sovietRadar(),
  sovietTech(),
  sovietCommandPost(),
  oreSilo('soviets'),
  sovietSubPen(),
  sovietSentry(),
  sovietTeslaCoil(),
  sovietFlameTower(),
  sovietNuclearSilo(),
  sovietIronCurtain(),
  wallSegment('soviets'),
  gateSegment('soviets'),

  // The neutral map furniture. Declared `'allies'` because that is the atlas
  // they sample, NOT because they belong to that army — `buildings.system.ts`
  // registers all three at FACTION_ANY so a captured one keeps its own
  // architecture and only its team panels change colour.
  civDerrick(),
  civHospital(),
  civApartments(),
  civMine(),
];

export const STRUCTURE_BY_KEY: ReadonlyMap<string, StructureMassList> =
  new Map(STRUCTURE_MASS_LISTS.map((l) => [l.key, l]));

/** Which faction owns each structure key. */
export const STRUCTURE_FACTIONS: Readonly<Record<string, StructureFaction>> =
  Object.fromEntries(STRUCTURE_MASS_LISTS.map((l) => [l.key, l.faction]));
