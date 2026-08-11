/**
 * ============================================================================
 * src/art/Faction3Buildings.ts — THE MERIDIAN PACT, AS ARCHITECTURE
 * ============================================================================
 * Twelve structures, two palettes, and the call that publishes them to
 * `RenderBridge`. Imports `BuildingFactory.ts` and `MassList.ts`; edits
 * neither, and does not touch `BuildingDefs.ts` at all.
 *
 *
 * THE SEVEN PACT RULES, the way bible 5.7 states them for the other two armies
 * ---------------------------------------------------------------------------
 *  PACT-1  CORBELLED, NOT SPLAYED. Every body is a narrow octagonal plinth
 *          carrying a WIDER octagonal main volume — the mass grows as it rises
 *          and overhangs its own base. This is the single loudest silhouette
 *          decision in the file, and it is chosen because it is the exact
 *          inverse of ALLIED-1's splayed skirt and orthogonal to SOVIET-1's
 *          constant-section slab. At 40 m the three armies' bases read as
 *          pyramid / mushroom / brick, in that order.
 *
 *  PACT-2  A COLLECTOR RING crowns every structure: a lathed disc wider than
 *          the roof, carrying a short drum. Where the Allies open a hex crown
 *          to the sky and the Soviets stack a smaller slab, the Pact puts a
 *          mirror on the roof.
 *
 *  PACT-3  VERTICAL FLUTING. Six pilasters up each long facade, alternating
 *          proud and recessed. ALLIED-5's banding is horizontal; this is the
 *          same trick rotated 90 degrees and it changes the read completely.
 *
 *  PACT-4  A CANTED BROW VISOR of glass across the facade, tilted down toward
 *          the camera, rather than the Allied vertical glazed band.
 *
 *  PACT-5  TAPERED OBELISK MASTS — cones, never cylinders, never lattice.
 *
 *  PACT-6  A HEXAGONAL FOUNDATION PAD in pale poured stone, with a jade kerb
 *          ring inset from its edge. Not the Allied near-black charcoal slab
 *          and not the Soviet grated deck.
 *
 *  PACT-7  GOLD, IN A LINE. Emissives are always straight strips or rings,
 *          never blobs, and always gold.
 *
 *
 * SURFACE. The clean-painted overhaul is honoured by construction: every mark
 * on these buildings comes from `Greeble.ts`'s painters through the tile slots,
 * `rivets: false` selects the welded language, and nothing in this file can
 * introduce a texel of noise even if it wanted to.
 * ============================================================================
 */

import {
  BUILDING_DIMENSIONS, BUILDING_PAD, CELL,
  NAVAL_BUILDING_DIMENSIONS, type UnitPalette,
} from '../core/config';
import { EntityKind, Faction, PartId } from '../core/types';
import { GreebleFactory, type SlotName } from './Greeble';
import { MassRole } from './MassList';
import {
  BuildingLibrary, Feature,
  type StructureFaction, type StructureMass, type StructureMassList,
  type StructureModel, type StructurePalettes, type StructureSocket,
} from './BuildingFactory';
import {
  FACTION_ANY, registerKindMesh, type KindMesh, type SocketSpec as BridgeSocket,
} from '../render/RenderBridge';

type M = StructureMass;
type V3 = readonly [number, number, number];

/* ==========================================================================
 * 1. PALETTES
 * ========================================================================== */

/**
 * PACT ARCHITECTURE. Same shape as `RA3_ALLIED_STRUCTURE`, and lighter than the
 * Pact's own hull paint for the same reason the Allied one is: buildings catch
 * the key light and want to sit a step brighter than the units in front of them.
 */
export const MERIDIAN_STRUCTURE_PALETTE: UnitPalette = {
  base: '#D2C8AE',
  shadow: '#3A3226',
  team: '#0FA98C',
  teamSecondary: '#0A6E5C',
  insignia: 'star',
  insigniaColor: '#F2C544',
  hullNumber: 1601,
  emissive: '#FFC24A',
  /** Warm grey brass. Never blue steel (bible 5.4, S <= 0.26). */
  bareMetal: '#7C7264',
  trackLink: '#2A2620',
  glass: '#1E3A38',
  stencil: '#E4DCC8',
  hazard: '#E5CB43',
  /** Welded and tiled, like the Allies. The Pact is not a bolt culture. */
  rivets: false,
};

/**
 * THE PACT PAD (PACT-6). Pale poured stone rather than the Allied charcoal
 * slab, because a bone building on a near-black pad reads as a model on a
 * plinth; a bone building on a warm stone pad reads as a building on ground.
 * The jade kerb is what keeps the outline legible at that low contrast.
 */
export const MERIDIAN_PAD_PALETTE: UnitPalette = {
  base: '#8E8672',
  shadow: '#2C2820',
  team: '#0FA98C',
  teamSecondary: '#6E6858',
  insignia: 'star',
  insigniaColor: '#0FA98C',
  hullNumber: 1601,
  emissive: '#FFC24A',
  bareMetal: '#7E7A6E',
  trackLink: '#2A2620',
  glass: '#1E3A38',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: false,
};

/**
 * `StructureFaction` is `'allies' | 'soviets'` in `BuildingFactory.ts`, which is
 * not this module's file. The field selects the per-faction chamfer fraction in
 * `structureChamfer()` and the pad language in code this file does not call.
 * `'allies'` gives 5.5% rather than 4.0%, which is the welded-ceramic figure and
 * the one the Pact wants. No Allied colour reaches these models: the atlases are
 * built from the two palettes above on a private `GreebleFactory`.
 */
const PACT_ART_FACTION: StructureFaction = 'allies';

const SEED = 0x4d_2b;
const PAD_SEED = 0x4d_9d;

/**
 * Panel-run density on the architecture atlas. MEASURED by sweeping the
 * generator over this roster, not copied from either shipped faction.
 *
 * The Allied figure of 3.4 lands Pact walls at 48-51% Sobel — above bible 5.3's
 * "a surface that busy reads as noise however it was drawn" ceiling — because
 * the corbelled shell samples `paintMed` over a much larger share of its
 * surface than a splayed one does, and the pilasters add their own edge energy
 * on top. 1.6 undershoots at 40.8%; 2.4 lands the whole twelve-structure roster
 * at 29-41%, inside `BUILDING_VALIDATION.sobelTarget` (38-47%) for every
 * production structure, with drawn-detail coverage 5-8x the 4.5% R1 floor.
 */
const PANEL_DENSITY = 2.4;

/* ==========================================================================
 * 2. MASS CONSTRUCTORS
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

/** A flat jade panel insert (R-T2). Never a tint, never a gradient. */
function teamPanel(name: string, size: V3, anchor: V3, o?: Partial<M>): M {
  return box(name, MassRole.TeamSlab, size, anchor, 'teamSlab', { chamfer: 0.045, ...o });
}

/** The single insignia plate (R-T4). Structures carry one; defences carry none. */
function insignia(size: number, anchor: V3, o?: Partial<M>): M {
  return box('insignia', MassRole.Insignia, [size, size, 0.14], anchor, 'insignia', {
    chamfer: 0.04, ...o,
  });
}

/* ==========================================================================
 * 3. SHARED FEATURES
 * ========================================================================== */

/**
 * PACT-6: THE HEXAGONAL FOUNDATION PAD.
 *
 * Real geometry with its own material, not a decal — a decal would z-fight and
 * a per-site re-mesh would cost a batch per instance. One mass carries both the
 * visible slab and the buried skirt: the top face sits at `BUILDING_PAD.lift`
 * and the box runs down past the origin by `skirtDepth`, so the joint is under
 * the heightfield on every cell `Terrain.isBuildable` will accept.
 */
function pactPad(fw: number, fh: number, height: number): M[] {
  const over = BUILDING_PAD.alliedOverhang;
  const thick = Math.max(0.18, height * BUILDING_PAD.alliedThickness);
  const w = fw * CELL * (1 + over * 2);
  const d = fh * CELL * (1 + over * 2);
  const total = thick + BUILDING_PAD.skirtDepth;
  const cy = BUILDING_PAD.lift - total * 0.5;

  return [
    pri('pad.slab', MassRole.Greeble, [w, total, d], [0, cy, 0], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall',
      target: 'pad', feature: Feature.Static, group: 'pad',
      chamfer: Math.min(0.22, thick * 0.5),
    }),
    // The kerb ring. The pad is deliberately low-contrast against a bone
    // building, so this is the thing that keeps the footprint readable.
    box('pad.kerbF', MassRole.Greeble, [w * 0.80, 0.10, 0.34], [0, BUILDING_PAD.lift + 0.03, d * 0.5 - 0.40], 'stripe', {
      target: 'pad', feature: Feature.Static, group: 'kerb',
    }),
    box('pad.kerbB', MassRole.Greeble, [w * 0.80, 0.10, 0.34], [0, BUILDING_PAD.lift + 0.03, -(d * 0.5 - 0.40)], 'stripe', {
      target: 'pad', feature: Feature.Static, group: 'kerb',
    }),
    box('pad.kerbS', MassRole.Greeble, [0.34, 0.10, d * 0.62], [w * 0.5 - 0.40, BUILDING_PAD.lift + 0.03, 0], 'stripe', {
      mirrorX: true, target: 'pad', feature: Feature.Static, group: 'kerb',
    }),
  ];
}

/** PACT-3: six vertical flutes up each long facade, alternating proud/recessed. */
function pilasters(w: number, d: number, bodyY0: number, bodyH: number): M[] {
  const n = 6;
  const out: M[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = (t - 0.5) * w * 0.88;
    const proud = i % 2 === 0;
    const depth = proud ? 0.22 : 0.12;
    const tint = proud ? 1 : 0.88;
    for (const sgn of [1, -1]) {
      out.push(box(`flute${i}${sgn > 0 ? 'F' : 'B'}`, MassRole.Greeble,
        [w * 0.055, bodyH * 0.88, depth],
        [x, bodyY0 + bodyH * 0.46, sgn * (d * 0.5 + depth * 0.28)],
        proud ? 'paintSmall' : 'vent',
        { group: 'flutes', tint, chamfer: 0.05 }));
    }
  }
  return out;
}

/**
 * PACT-2: the collector ring — a disc wider than the roof, carrying a drum.
 *
 * Sized off `min(w, d)`, NOT off `w`. A 3x2 structure is 11.3 x 7.5 m, and a
 * ring at 0.86 of the WIDTH would be 9.7 m deep on a 8 m footprint — the whole
 * roof furniture hanging over the neighbouring cells. This is the one place a
 * non-square footprint bites, and it bites silently: the model looks fine and
 * the placement grid disagrees with it.
 */
function collectorRing(w: number, d: number, roofY: number, crownH: number): M[] {
  const r = Math.min(w, d);
  return [
    cyl('ring', MassRole.Primary, [r * 0.86, crownH * 0.26, r * 0.86], [0, roofY + crownH * 0.13, 0], 'paintMed', {
      segments: 16, capSlot: 'paintSmall', topRadius: 0.88,
    }),
    pri('crown', MassRole.Primary, [r * 0.50, crownH * 0.74, r * 0.50], [0, roofY + crownH * 0.63, 0], 'paintMed', {
      plan: 'octagon', capSlot: 'grille',
    }),
    // The mirror well: a shallow recessed disc inside the crown rim. Louvres,
    // not grille — the grille tile is #2A2C30 and a lid of it reads as a black
    // hole from the RTS camera, the exact opposite of a collector.
    cyl('crown.well', MassRole.Greeble, [r * 0.36, crownH * 0.14, r * 0.36], [0, roofY + crownH * 0.94, 0], 'vent', {
      segments: 16, capSlot: 'vent', tint: 0.84, group: 'crown', chamfer: 0.05,
    }),
    cyl('crown.rim', MassRole.Greeble, [r * 0.54, crownH * 0.09, r * 0.54], [0, roofY + crownH * 0.99, 0], 'bareMetal', {
      segments: 16, capSlot: 'grille', group: 'crown', chamfer: 0.04,
    }),
  ];
}

/** PACT-5: a tapered obelisk mast. Cone, never cylinder, never lattice. */
function obelisk(x: number, z: number, dia: number, baseY: number, top: number, tag: string): M[] {
  const h = top - baseY;
  return [
    cyl(`${tag}.shaft`, MassRole.Primary, [dia, h, dia], [x, baseY + h * 0.5, z], 'paintMed', {
      topRadius: 0.32, capSlot: 'grille', group: tag, segments: 12,
    }),
    cyl(`${tag}.collar`, MassRole.Greeble, [dia * 1.20, h * 0.06, dia * 1.20], [x, baseY + h * 0.22, z], 'bareMetal', {
      group: tag, chamfer: 0.05, capSlot: 'grille', segments: 12,
    }),
    box(`${tag}.tip`, MassRole.Emissive, [dia * 0.26, h * 0.05, dia * 0.26], [x, top - h * 0.02, z], 'emissive', {
      group: tag, feature: Feature.Window, chamfer: 0.03,
    }),
  ];
}

/** PACT-7: gold strips. Clean rectangles in a straight line, never a blob. */
function lightRow(
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
 * A structure's whole lit budget: a row on each long facade plus a roof bar.
 * The roof bar does most of the work — at a 39-degree camera a horizontal face
 * contributes 0.63 of its area to the frame against 0.25 for a flank.
 */
function lightSet(w: number, d: number, bodyH: number, count: number, cellW: number, cellH: number): M[] {
  const out: M[] = [];
  for (const sgn of [1, -1]) {
    out.push(...lightRow(w * 0.66, bodyH * 0.36, sgn * (d * 0.5 + 0.05), count,
      w * cellW, bodyH * cellH, `lit${sgn > 0 ? 'F' : 'B'}`));
  }
  out.push(box('lit.roof', MassRole.Emissive, [w * 0.34, 0.14, d * 0.11], [0, bodyH + 0.05, d * 0.16], 'emissive', {
    group: 'roofLights', feature: Feature.Window, chamfer: 0.04,
  }));
  return out;
}

/* ==========================================================================
 * 4. THE SHELL — PACT-1..7, once, for every structure of the faction
 * ========================================================================== */

interface ShellOpts {
  /** Fraction of the footprint the body occupies. Leaves a pad margin. */
  inset?: number;
  /** Fraction of the roofline the massive body occupies. */
  bodyFraction?: number;
  /** Team panel scale. Tuned per structure to land R-T1's 4-10%. */
  team?: number;
  /** Lit cells per facade. */
  lightCount?: number;
}

interface Shell {
  masses: M[];
  /** Metres: body width, depth, roof height (top of the main volume). */
  w: number;
  d: number;
  roofY: number;
  /** Top of the collector ring. Per-structure features start above this. */
  crownTop: number;
}

function pactShell(fw: number, fh: number, height: number, o: ShellOpts): Shell {
  const inset = o.inset ?? 0.94;
  const w = fw * CELL * inset;
  const d = fh * CELL * inset;
  const bodyH = height * (o.bodyFraction ?? 0.52);
  const team = o.team ?? 1;

  // PACT-1: a narrow plinth carrying a wider main volume. The main mass
  // overhangs the plinth by 11% of the footprint per side, which is the whole
  // corbelled read and is what puts a hard shadow line under every Pact wall.
  const plinthH = bodyH * 0.32;
  const plinthW = w * 0.78;
  const plinthD = d * 0.78;
  const mainH = bodyH - plinthH;
  const mainY = plinthH + mainH * 0.5;
  const crownH = height * 0.24;

  const masses: M[] = [...pactPad(fw, fh, height)];

  masses.push(
    pri('plinth', MassRole.Primary, [plinthW, plinthH, plinthD], [0, plinthH * 0.5, 0], 'paintMed', {
      plan: 'octagon', capSlot: 'paintMed',
    }),
    pri('body', MassRole.Primary, [w, mainH, d], [0, mainY, 0], 'paintMed', {
      plan: 'octagon', capSlot: 'paintMed',
    }),
  );

  masses.push(...pilasters(w, d, plinthH, mainH));
  masses.push(...collectorRing(w, d, bodyH, crownH));

  // PACT-4: the canted brow visor. Authored as thin PANELS rather than a glass
  // volume: a glass box spanning the plan hands its enormous top face to the
  // surface budget for a surface the camera never sees from above anyway.
  const browY = plinthH + mainH * 0.74;
  masses.push(
    box('visor.front', MassRole.Greeble, [w * 0.72, mainH * 0.20, 0.30], [0, browY, d * 0.5 + 0.06], 'glass', {
      rot: [-0.34, 0, 0], group: 'visor', chamfer: 0.06, tint: 0.92,
    }),
    // Anchored INSIDE the wall line, not proud of it: a canted 0.30 m panel
    // measures ~0.43 m across once its rotation is projected onto X, and the
    // footprint check is unforgiving — a structure that overhangs its own cells
    // is one the placement grid will happily let a neighbour intersect.
    box('visor.flank', MassRole.Greeble, [0.30, mainH * 0.18, d * 0.52], [w * 0.5 - 0.06, browY, 0], 'glass', {
      mirrorX: true, rot: [0, 0, 0.30], group: 'visor', chamfer: 0.06, tint: 0.92,
    }),
  );

  // R-T3: top-facing and outward-facing only. A roof chevron carries 2.5x the
  // screen area of the same panel on a flank at a 39-degree pitch.
  masses.push(teamPanel('team.roof', [w * 0.50 * team, 0.16, d * 0.28 * team], [0, bodyH + 0.06, 0]));
  for (const s of [1, -1]) {
    masses.push(teamPanel('team.flank', [0.16, mainH * 0.32 * team, d * 0.42 * team],
      [s * (w * 0.5 - 0.10), plinthH + mainH * 0.44, 0]));
  }
  masses.push(teamPanel('team.facade', [w * 0.38 * team, mainH * 0.15 * team, 0.16], [0, plinthH + mainH * 0.26, d * 0.5 - 0.02]));

  masses.push(insignia(Math.min(w, d) * 0.20, [w * 0.24, plinthH + mainH * 0.56, d * 0.5 + 0.02]));
  masses.push(...lightSet(w, d, bodyH, o.lightCount ?? 6, 0.085, 0.24));

  // Roof and flank plant. The vent and grille tiles are the highest-frequency
  // surfaces in the atlas, and they are the honest way to buy back the drawn-
  // detail the flat team slabs and the glass visor cost.
  masses.push(
    box('roof.vent', MassRole.Greeble, [w * 0.20, 0.52, d * 0.16], [-w * 0.30, bodyH + 0.26, -d * 0.26], 'vent', { group: 'roofPlant' }),
    box('roof.hatch', MassRole.Greeble, [w * 0.15, 0.24, d * 0.15], [w * 0.30, bodyH + 0.12, -d * 0.26], 'hatch', { group: 'roofPlant', chamfer: 0.05 }),
    box('intake', MassRole.Greeble, [0.32, mainH * 0.42, d * 0.40], [w * 0.46, plinthH + mainH * 0.30, -d * 0.10], 'grille', {
      mirrorX: true, group: 'intakes', chamfer: 0.05,
    }),
    box('service', MassRole.Greeble, [w * 0.18, plinthH * 0.62, 0.26], [-w * 0.26, plinthH * 0.31, d * 0.5 - 0.04], 'stencil', {
      group: 'service', chamfer: 0.05,
    }),
    // The faction cue at architectural scale: a canted mirror vane on the roof.
    box('vane', MassRole.Greeble, [w * 0.30, 0.12, d * 0.20], [w * 0.10, bodyH + 0.34, d * 0.24], 'stripe', {
      rot: [-0.52, 0, 0.14], group: 'vane', faceSlots: { py: 'glass' }, chamfer: 0.04,
    }),
  );

  return { masses, w, d, roofY: bodyH, crownTop: bodyH + crownH };
}

/* ==========================================================================
 * 5. STRUCTURES
 * ========================================================================== */

/** Footprint + frozen roofline. Naval keys live in their own table. */
function fp(key: string): { w: number; h: number; height: number } {
  const b = (BUILDING_DIMENSIONS as Record<string, { w: number; h: number; height: number }>)[key];
  if (b !== undefined) return b;
  const n = (NAVAL_BUILDING_DIMENSIONS as Record<string, { w: number; h: number; height: number }>)[key];
  if (n !== undefined) return n;
  throw new Error(`[faction3] no footprint for "${key}"`);
}

function list(
  key: string, name: string, dimKey: string,
  masses: M[], sockets: StructureSocket[], extra?: Partial<StructureMassList>,
): StructureMassList {
  const f = fp(dimKey);
  return {
    key, name, faction: PACT_ART_FACTION,
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

function conclave(): StructureMassList {
  const f = fp('conYard');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.50, team: 1.15, lightCount: 6 });
  // The assembly gantry is the Conclave's whole silhouette read, and it is what
  // carries the structure to its frozen 11 m roofline: an obelisk up one corner
  // with a jib swung across the roof.
  s.masses.push(
    ...obelisk(-s.w * 0.32, -s.d * 0.28, 1.30, s.roofY, f.height, 'pylon'),
    box('jib', MassRole.Primary, [0.58, 0.58, s.d * 0.92], [-s.w * 0.32, f.height - 1.30, s.d * 0.04], 'bareMetal', { chamfer: 0.07 }),
    box('jib.hoist', MassRole.Greeble, [0.28, 1.50, 0.28], [-s.w * 0.32, f.height - 2.70, s.d * 0.40], 'bareMetal', { group: 'hoist', chamfer: 0.05 }),
    box('jib.house', MassRole.Greeble, [1.40, 1.10, 1.60], [-s.w * 0.32, s.roofY + 0.55, -s.d * 0.28], 'hatch', { group: 'hoist' }),
    // The deployment bay: a leaf that retracts into the floor when the yard works.
    box('bay.lintel', MassRole.Greeble, [s.w * 0.36, 0.50, 0.50], [0, s.roofY * 0.60, s.d * 0.5 + 0.06], 'stripe', { group: 'bay', chamfer: 0.06 }),
    box('bay.door', MassRole.Greeble, [s.w * 0.32, s.roofY * 0.54, 0.34], [0, s.roofY * 0.27, s.d * 0.5 + 0.02], 'hatch', {
      group: 'bay', feature: Feature.Door, anim: s.roofY * 0.58, chamfer: 0.05,
    }),
  );
  return list('meridian_conclave', 'Conclave', 'conYard', s.masses, [
    ...baseSockets(s.d, f.height, -s.w * 0.32, -s.d * 0.28),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
    { part: PartId.Crane, pos: [-s.w * 0.32, f.height - 2.7, s.d * 0.52] },
    { part: PartId.FlagPole, pos: [s.w * 0.40, s.roofY, -s.d * 0.36] },
  ]);
}

function solarArray(): StructureMassList {
  const f = fp('powerPlant');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.42, team: 1.0, lightCount: 4 });
  // TWIN HELIOSTAT TOWERS. The Pact's power structure has to read as "fragile
  // and generous" from across the map — it is the faction's whole risk profile
  // in one building — so it is two tall thin masts carrying big canted mirrors,
  // with nothing armoured about it anywhere.
  for (const sgn of [1, -1]) {
    const x = sgn * s.w * 0.28;
    s.masses.push(
      cyl(`mast${sgn}`, MassRole.Primary, [s.w * 0.13, f.height - s.roofY - 1.1, s.w * 0.13],
        [x, (f.height + s.roofY) * 0.5 - 0.55, -s.d * 0.12], 'paintMed', {
          topRadius: 0.60, group: `mast${sgn}`, capSlot: 'grille', segments: 12,
        }),
      box(`mirror${sgn}`, MassRole.Primary, [s.w * 0.46, 0.24, s.w * 0.46],
        [x, f.height - 0.55, -s.d * 0.12], 'stripe', {
          rot: [-0.62, 0, sgn * 0.14], group: `mast${sgn}`, faceSlots: { py: 'glass' }, chamfer: 0.05,
        }),
      box(`mirror${sgn}.strut`, MassRole.Greeble, [s.w * 0.10, 0.90, 0.14],
        [x, f.height - 1.10, -s.d * 0.12], 'bareMetal', { group: `mast${sgn}`, chamfer: 0.03 }),
    );
  }
  s.masses.push(
    box('inverter', MassRole.Greeble, [s.w * 0.24, s.roofY * 0.44, s.d * 0.20], [0, s.roofY * 0.22, s.d * 0.40], 'grille', { group: 'inverter' }),
    box('busbar', MassRole.Greeble, [s.w * 0.60, 0.24, 0.24], [0, s.roofY + 0.85, -s.d * 0.12], 'bareMetal', { group: 'inverter', chamfer: 0.05 }),
  );
  return list('meridian_solararray', 'Solar Array', 'powerPlant', s.masses,
    baseSockets(s.d, f.height, s.w * 0.28, -s.d * 0.12));
}

function chapterhouse(): StructureMassList {
  const f = fp('barracks');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.60, team: 1.25, lightCount: 6 });
  s.masses.push(
    // A canted muster canopy over the door, carried on two cone posts.
    pri('canopy', MassRole.Primary, [s.w * 0.54, 0.34, s.d * 0.24], [0, s.roofY * 0.74, s.d * 0.34], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall', rot: [-0.20, 0, 0], chamfer: 0.08,
    }),
    cyl('canopy.post', MassRole.Greeble, [0.24, s.roofY * 0.72, 0.24], [s.w * 0.22, s.roofY * 0.36, s.d * 0.42], 'bareMetal', {
      mirrorX: true, group: 'canopy', chamfer: 0.04, capSlot: 'grille', topRadius: 0.70, segments: 10,
    }),
    box('door', MassRole.Greeble, [s.w * 0.24, s.roofY * 0.56, 0.30], [0, s.roofY * 0.28, s.d * 0.5 + 0.02], 'hatch', {
      group: 'door', feature: Feature.Door, anim: s.roofY * 0.60, chamfer: 0.05,
    }),
    ...obelisk(s.w * 0.34, -s.d * 0.32, 0.52, s.crownTop - 0.6, f.height, 'standard'),
  );
  return list('meridian_chapterhouse', 'Chapterhouse', 'barracks', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.0, -s.w * 0.24, -s.d * 0.26),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
  ]);
}

function cistern(): StructureMassList {
  const f = fp('refinery');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.48, team: 1.05, lightCount: 5 });
  s.masses.push(
    // The cistern drum and the canopy a collector unloads under.
    cyl('cistern', MassRole.Primary, [s.w * 0.32, f.height - s.roofY - 0.6, s.w * 0.32],
      [-s.w * 0.26, (f.height + s.roofY) * 0.5 - 0.3, -s.d * 0.12], 'paintMed', {
        group: 'cistern', capSlot: 'grille', topRadius: 1.14, segments: 14,
      }),
    cyl('cistern.cap', MassRole.Greeble, [s.w * 0.40, 0.40, s.w * 0.40], [-s.w * 0.26, f.height - 0.5, -s.d * 0.12], 'bareMetal', {
      group: 'cistern', chamfer: 0.06, capSlot: 'grille', segments: 14,
    }),
    pri('dock.canopy', MassRole.Primary, [s.w * 0.46, 0.42, s.d * 0.46], [s.w * 0.24, s.roofY * 0.92, s.d * 0.20], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall', chamfer: 0.08,
    }),
    cyl('dock.leg', MassRole.Greeble, [0.26, s.roofY * 0.90, 0.26], [s.w * 0.42, s.roofY * 0.45, s.d * 0.38], 'bareMetal', {
      group: 'dock', chamfer: 0.05, capSlot: 'grille', segments: 10,
    }),
    box('sluice', MassRole.Greeble, [s.w * 0.20, 0.34, s.d * 0.52], [s.w * 0.10, s.roofY * 0.34, s.d * 0.20], 'tread', {
      group: 'sluice', rot: [-0.12, 0, 0], chamfer: 0.05,
    }),
    box('main', MassRole.Greeble, [s.w * 0.44, 0.26, 0.26], [-s.w * 0.04, s.roofY + 0.68, -s.d * 0.12], 'bareMetal', {
      group: 'mains', chamfer: 0.05,
    }),
  );
  return list('meridian_cistern', 'Ore Cistern', 'refinery', s.masses, [
    ...baseSockets(s.d, f.height, -s.w * 0.26, -s.d * 0.12),
    { part: PartId.DockEntry, pos: [s.w * 0.24, 0.2, s.d * 0.5 + 2.4] },
    { part: PartId.Conveyor, pos: [s.w * 0.10, s.roofY * 0.5, s.d * 0.5] },
  ]);
}

function forgeyard(): StructureMassList {
  const f = fp('warFactory');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.56, team: 1.0, lightCount: 4 });
  s.masses.push(
    // The bay frame is anchored 0.10 m INSIDE the wall line so its own depth
    // still leaves it inside the footprint. A lintel hung 0.10 m proud of a
    // 0.58 m section overhangs the cell by 0.19 m and trips the footprint check.
    box('bay.lintel', MassRole.Primary, [s.w * 0.62, 0.58, 0.58], [0, s.roofY * 0.70, s.d * 0.5 - 0.10], 'stripe', { chamfer: 0.08 }),
    box('bay.jamb', MassRole.Greeble, [0.42, s.roofY * 0.68, 0.50], [s.w * 0.29, s.roofY * 0.34, s.d * 0.5 - 0.10], 'stripe', {
      mirrorX: true, group: 'bay', chamfer: 0.06,
    }),
    box('bay.door', MassRole.Greeble, [s.w * 0.56, s.roofY * 0.64, 0.32], [0, s.roofY * 0.32, s.d * 0.5 - 0.02], 'hatch', {
      group: 'bay', feature: Feature.Door, anim: s.roofY * 0.68, chamfer: 0.05,
    }),
    // The overhead assembly rail carries the roofline.
    box('rail', MassRole.Primary, [s.w * 0.86, 0.42, 0.42], [0, f.height - 0.85, -s.d * 0.10], 'bareMetal', { chamfer: 0.07 }),
    cyl('rail.leg', MassRole.Greeble, [0.34, f.height - s.crownTop + 0.4, 0.34],
      [s.w * 0.40, (f.height + s.crownTop) * 0.5 - 0.2, -s.d * 0.10], 'bareMetal', {
        mirrorX: true, group: 'rail', chamfer: 0.05, capSlot: 'grille', topRadius: 0.80, segments: 10,
      }),
    box('rail.trolley', MassRole.Greeble, [0.85, 0.65, 0.85], [-s.w * 0.16, f.height - 1.45, -s.d * 0.10], 'hatch', { group: 'rail' }),
    box('flue', MassRole.Greeble, [s.w * 0.15, 1.05, s.d * 0.18], [-s.w * 0.34, s.roofY + 0.52, -s.d * 0.28], 'vent', { group: 'flue' }),
  );
  return list('meridian_forgeyard', 'Forgeyard', 'warFactory', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.1, -s.w * 0.34, -s.d * 0.28),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.4] },
    { part: PartId.Crane, pos: [-s.w * 0.16, f.height - 1.9, -s.d * 0.10] },
  ]);
}

function oculus(): StructureMassList {
  const f = fp('radar');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.38, team: 1.10, lightCount: 4 });
  // The Oculus is a 12 m silhouette: an obelisk carrying a slewing aperture
  // ring. The ring spins about the model Y axis, so its mast is on the centre
  // line — a Spinner mass authored off-axis would orbit instead of rotate.
  const towerTop = f.height - 3.4;
  s.masses.push(
    ...obelisk(0, 0, s.w * 0.34, s.crownTop - 0.4, towerTop, 'tower'),
    cyl('hub', MassRole.Primary, [1.30, 0.85, 1.30], [0, towerTop + 0.55, 0], 'bareMetal', {
      feature: Feature.Spinner, anim: 0.55, capSlot: 'hatch', segments: 12,
    }),
    // The aperture: a canted ring offset from the axis, so the sweep reads.
    cyl('aperture', MassRole.Primary, [4.20, 0.55, 4.20], [0.80, towerTop + 1.55, 0], 'paintMed', {
      rot: [-0.52, 0, 0.28], capSlot: 'grille', feature: Feature.Spinner, anim: 0.55, segments: 16, topRadius: 0.78,
    }),
    box('aperture.arm', MassRole.Greeble, [1.85, 0.20, 0.20], [0.45, towerTop + 1.00, 0], 'bareMetal', {
      group: 'aperture', feature: Feature.Spinner, anim: 0.55, chamfer: 0.04,
    }),
    box('aperture.eye', MassRole.Emissive, [0.50, 0.50, 0.50], [1.45, towerTop + 2.20, 0], 'emissive', {
      group: 'aperture', feature: Feature.Spinner, anim: 0.55, chamfer: 0.05,
    }),
  );
  return list('meridian_oculus', 'Oculus', 'radar', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.0, -s.w * 0.30, -s.d * 0.30),
    { part: PartId.Dish, pos: [0, towerTop + 1.6, 0] },
    { part: PartId.Antenna, pos: [0, f.height, 0] },
  ]);
}

function reliquary(): StructureMassList {
  const f = fp('battleLab');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.50, team: 1.10, lightCount: 6 });
  s.masses.push(
    // A focusing lens stack: a glass drum with a gold core and a brass rim.
    cyl('lens', MassRole.Primary, [s.w * 0.44, f.height - s.crownTop + 0.2, s.w * 0.44],
      [0, (f.height + s.crownTop) * 0.5 - 0.6, s.d * 0.06], 'glass', {
        group: 'lens', capSlot: 'paintSmall', tint: 0.95, segments: 14,
      }),
    cyl('lens.rim', MassRole.Greeble, [s.w * 0.50, 0.32, s.w * 0.50], [0, s.crownTop - 0.30, s.d * 0.06], 'bareMetal', {
      group: 'lens', chamfer: 0.05, capSlot: 'grille', segments: 14,
    }),
    cyl('lens.core', MassRole.Emissive, [s.w * 0.18, f.height - s.crownTop - 1.0, s.w * 0.18],
      [0, (f.height + s.crownTop) * 0.5 - 0.7, s.d * 0.06], 'emissive', {
        group: 'lens', chamfer: 0.05, capSlot: 'emissive', feature: Feature.Window, segments: 12,
      }),
    cyl('lens.cap', MassRole.Primary, [s.w * 0.46, 0.85, s.w * 0.46], [0, f.height - 0.42, s.d * 0.06], 'paintMed', {
      topRadius: 0.62, capSlot: 'grille', segments: 14,
    }),
    box('coolant', MassRole.Greeble, [s.w * 0.17, s.roofY * 0.48, s.d * 0.17], [s.w * 0.34, s.roofY * 0.24, -s.d * 0.32], 'grille', {
      mirrorX: true, group: 'coolant',
    }),
  );
  return list('meridian_reliquary', 'Reliquary', 'battleLab', s.masses,
    baseSockets(s.d, s.roofY + 0.8, s.w * 0.34, -s.d * 0.32));
}

/**
 * THE SOLAR INFIRMARY. The army mends with light, so its service pad is an
 * OPEN GANTRY over a deck rather than the shed a depot wants to be.
 *
 * The frozen roofline is 6.5 m and it is deliberately low: a hull parked here
 * has to stay visible at the fixed 38-degree camera, and a full-footprint
 * volume at that height would sit on top of it. Two shell options follow from
 * that, and nothing else in this function matters as much as either:
 *
 *   `inset` 0.72 rather than the default 0.94, which puts a 5.76 m corbelled
 *   core on an 8 m footprint and leaves 1.1 m of open deck all the way round
 *   it. The core is the plant; the deck is the building.
 *
 *   `bodyFraction` 0.34, which tops the whole shell out at 3.82 m — every
 *   metre above that belongs to two obelisk masts standing OUTSIDE the core
 *   with an open yoke between them, so the only thing crossing the deck is a
 *   1.5 m boom and the emitter hung under its nose.
 *
 * Which makes the masts load-bearing in the validator's sense as well as the
 * architect's: they alone carry `bounds[1]` from that 3.82 m to the 6.50 m the
 * height gate wants, and the tolerance is +/-0.78 m.
 *
 * `team` 1.3 is the other measured number. The panels are the shell's, scaled
 * per structure, and their area goes as the SQUARE of this: a small core under
 * a lot of unpainted gantry started at 14.0% of projected surface against an
 * R-T1 ceiling of 10%, and 1.3 lands it at 7.7%.
 */
function depot(): StructureMassList {
  const f = fp('repairDepot');
  const s = pactShell(f.w, f.h, f.height, { inset: 0.72, bodyFraction: 0.34, team: 1.3, lightCount: 4 });

  // The core wall stands at 2.88 m; the masts at 3.30 with a 1.0 m base reach
  // 3.80, which is clear of it and inside the 4.01 m half-footprint. Standing
  // them any closer would read as buttressing the core instead of framing the
  // deck, and any further out overhangs a neighbour's cells.
  const mastX = 3.30, mastZ = -1.00, mastFoot = 0.06;
  const mastH = f.height - mastFoot;
  const yokeY = f.height - 0.78;
  const boomY = yokeY - 0.46;

  s.masses.push(
    // PACT-5: cones. One mass, mirrored — the boxiness gate counts a mirrored
    // pair twice, and a lathe contributes zero axis-aligned wall either way.
    cyl('mast', MassRole.Primary, [1.00, mastH, 1.00], [mastX, mastFoot + mastH * 0.5, mastZ], 'paintMed', {
      mirrorX: true, topRadius: 0.28, capSlot: 'grille', segments: 12,
    }),
    pri('yoke', MassRole.Primary, [mastX * 2 + 0.40, 0.55, 0.90], [0, yokeY, mastZ], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall', chamfer: 0.08,
    }),
    // The boom cantilevers forward over the parking spot. A wedge, nose at +Z:
    // it is the one mass the camera sees against the sky above a parked hull,
    // and a constant-section beam there is the whole "generic engine" read.
    pri('boom', MassRole.Primary, [1.50, 0.52, 4.80], [0, boomY, mastZ + 2.40], 'paintMed', {
      plan: 'wedge', capSlot: 'stripe', chamfer: 0.07,
    }),
    // The emitter widens UPWARD, so the light it throws reads as aimed at the
    // deck. `topRadius` scales the mesh but not `massExtents`, so the real top
    // is 2.34 m across at z 2.60 — 3.77, still inside the footprint. Anything
    // wider here passes the validator and overhangs the cell anyway.
    cyl('emitter', MassRole.Primary, [1.80, 1.00, 1.80], [0, 4.55, 2.60], 'paintMed', {
      topRadius: 1.30, capSlot: 'grille', segments: 12,
    }),

    /* -- the hardware a hull is actually serviced by --------------------- */
    cyl('mast.collar', MassRole.Greeble, [1.24, 0.34, 1.24], [mastX, 1.55, mastZ], 'bareMetal', {
      mirrorX: true, group: 'collars', chamfer: 0.05, capSlot: 'grille', segments: 10,
    }),
    // A canted brace off the collector crown into each mast, which is what
    // stops the pylons reading as two poles parked beside an unrelated block.
    box('brace', MassRole.Greeble, [2.00, 0.20, 0.22], [mastX - 1.00, s.crownTop - 0.42, mastZ], 'bareMetal', {
      mirrorX: true, rot: [0, 0, 0.22], group: 'braces', chamfer: 0.04,
    }),
    box('cradle', MassRole.Greeble, [1.30, 0.26, 0.90], [1.45, 0.13, 3.30], 'tread', {
      mirrorX: true, group: 'cradle', chamfer: 0.05,
    }),
    box('sill', MassRole.Greeble, [3.20, 0.22, 0.42], [0, 0.11, 2.98], 'stripe', { group: 'sill', chamfer: 0.05 }),
    box('pump', MassRole.Greeble, [0.72, 1.05, 1.10], [-2.55, 0.53, 2.05], 'grille', { group: 'pump' }),
    cyl('reel', MassRole.Greeble, [0.62, 0.46, 0.62], [-2.30, 1.32, 2.20], 'bareMetal', {
      rot: [0, 0, Math.PI * 0.5], group: 'reel', chamfer: 0.04, capSlot: 'hatch', segments: 10,
    }),

    /* -- PACT-7: gold, in rings and in lines, never in blobs ------------- */
    cyl('emitter.ring', MassRole.Emissive, [1.44, 0.22, 1.44], [0, 4.00, 2.60], 'emissive', {
      group: 'emitterRing', feature: Feature.Window, capSlot: 'emissive', chamfer: 0.05, segments: 12,
    }),
    box('deck.guide', MassRole.Emissive, [0.30, 0.10, 2.60], [1.98, 0.09, 2.30], 'emissive', {
      mirrorX: true, group: 'deckGuide', feature: Feature.Window, chamfer: 0.03,
    }),
  );

  return list('meridian_depot', 'Solar Infirmary', 'repairDepot', s.masses, [
    ...baseSockets(s.d, s.roofY + 0.9, -s.w * 0.28, -s.d * 0.28),
    // The emitter mouth, so a servicing effect hangs off the thing that emits.
    { part: PartId.Emitter, pos: [0, 3.90, 2.60] },
    { part: PartId.DockEntry, pos: [0, 0.2, s.d * 0.5 + 1.6] },
  ]);
}

function slipway(): StructureMassList {
  const f = fp('navalYard');
  const s = pactShell(f.w, f.h, f.height, { bodyFraction: 0.52, team: 1.0, lightCount: 5 });
  s.masses.push(
    // A launch cradle running out of the facade, on two cone legs.
    // The cradle reaches forward to `0.30 d + 0.15 d = 0.45 d`, inside the half
    // depth. It looks like it wants to run further out over the water; it must
    // not, for the same footprint reason the visor is anchored inboard.
    pri('cradle', MassRole.Primary, [s.w * 0.60, 0.44, s.d * 0.30], [0, s.roofY * 0.44, s.d * 0.30], 'paintMed', {
      plan: 'wedge', capSlot: 'stripe', chamfer: 0.08,
    }),
    cyl('cradle.leg', MassRole.Greeble, [0.30, s.roofY * 0.42, 0.30], [s.w * 0.26, s.roofY * 0.21, s.d * 0.40], 'bareMetal', {
      mirrorX: true, group: 'cradle', chamfer: 0.05, capSlot: 'grille', topRadius: 0.72, segments: 10,
    }),
    box('cradle.rail', MassRole.Greeble, [s.w * 0.50, 0.16, s.d * 0.34], [0, s.roofY * 0.62, s.d * 0.30], 'tread', {
      group: 'cradle', chamfer: 0.04,
    }),
    ...obelisk(-s.w * 0.32, -s.d * 0.26, 0.90, s.crownTop - 0.5, f.height, 'derrick'),
    box('derrick.jib', MassRole.Greeble, [0.34, 0.30, s.d * 0.52], [-s.w * 0.32, f.height - 1.10, s.d * 0.02], 'bareMetal', {
      group: 'derrick', rot: [0.14, 0, 0], chamfer: 0.05,
    }),
  );
  return list('meridian_slipway', 'Slipway', 'navalYard', s.masses, [
    ...baseSockets(s.d, f.height, -s.w * 0.32, -s.d * 0.26),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.4] },
  ]);
}

/**
 * THE SUN VAULT. One cell, five metres, and it has to read as storage rather
 * than as a small barracks — so it is a corbelled drum with a mirror lid, and
 * the plumbing around it is what stops one cell of storage reading as an
 * untextured cylinder.
 */
function sunVault(): StructureMassList {
  const f = fp('oreSilo');
  const w = f.w * CELL * 0.80;
  const h = f.height;
  const masses: M[] = [
    ...pactPad(f.w, f.h, h),
    cyl('foot', MassRole.Primary, [w * 0.74, h * 0.18, w * 0.74], [0, h * 0.09, 0], 'paintMed', {
      capSlot: 'paintSmall', topRadius: 1.16, segments: 14,
    }),
    cyl('drum', MassRole.Primary, [w, h * 0.50, w], [0, h * 0.43, 0], 'paintMed', {
      capSlot: 'paintSmall', topRadius: 1.02, segments: 14,
    }),
    pri('cap', MassRole.Primary, [w * 0.94, h * 0.22, w * 0.94], [0, h * 0.79, 0], 'paintMed', {
      plan: 'octagon', capSlot: 'grille',
    }),
    cyl('collar', MassRole.Primary, [w * 1.08, h * 0.06, w * 1.08], [0, h * 0.68, 0], 'bareMetal', {
      chamfer: 0.05, capSlot: 'grille', segments: 14,
    }),
    box('mirrorLid', MassRole.Greeble, [w * 0.62, 0.12, w * 0.62], [0, h * 0.94, 0], 'stripe', {
      rot: [-0.24, 0, 0.10], group: 'lid', faceSlots: { py: 'glass' }, chamfer: 0.04,
    }),
    box('ladder', MassRole.Greeble, [0.30, h * 0.62, 0.10], [0, h * 0.38, w * 0.52], 'stripe', { group: 'ladder', chamfer: 0.03 }),
    cyl('valve', MassRole.Greeble, [0.44, 0.34, 0.44], [-w * 0.34, h * 0.22, w * 0.34], 'bareMetal', {
      group: 'valves', chamfer: 0.04, capSlot: 'hatch', segments: 10,
    }),
    cyl('feedpipe', MassRole.Greeble, [0.26, h * 0.44, 0.26], [w * 0.40, h * 0.46, -w * 0.30], 'bareMetal', {
      group: 'pipes', chamfer: 0.04, capSlot: 'grille', segments: 10,
    }),
    box('feedhead', MassRole.Greeble, [0.58, 0.30, 0.58], [w * 0.40, h * 0.70, -w * 0.30], 'hatch', { group: 'pipes' }),
    box('gauge', MassRole.Greeble, [w * 0.26, h * 0.16, 0.14], [0, h * 0.46, -w * 0.50], 'stencil', { group: 'gauges', chamfer: 0.04 }),
    box('skirtVent', MassRole.Greeble, [w * 0.34, h * 0.13, 0.16], [-w * 0.22, h * 0.14, w * 0.46], 'vent', { group: 'vents' }),
    box('hatch', MassRole.Greeble, [w * 0.28, 0.20, w * 0.28], [w * 0.18, h * 0.91, 0], 'hatch', { group: 'hatches', chamfer: 0.04 }),
    teamPanel('team.band', [w * 1.02, h * 0.045, w * 0.26], [0, h * 0.55, 0]),
    teamPanel('team.cap', [w * 0.30, 0.10, w * 0.18], [0, h * 0.91, 0]),
    insignia(w * 0.34, [0, h * 0.38, w * 0.50]),
    ...lightRow(w * 0.44, h * 0.16, w * 0.50, 2, w * 0.16, h * 0.07, 'lamp'),
    box('lit.roof', MassRole.Emissive, [w * 0.28, 0.12, w * 0.20], [-w * 0.18, h * 0.91, 0], 'emissive', {
      group: 'roofLights', feature: Feature.Window, chamfer: 0.03,
    }),
  ];
  return list('meridian_vault', 'Sun Vault', 'oreSilo', masses, [
    { part: PartId.Hopper, pos: [0, h * 0.70, -w * 0.30] },
    { part: PartId.DockEntry, pos: [0, 0.2, w * 0.5 + 2.2] },
  ]);
}

/**
 * THE GLAIVE POST. A turretless hexagonal casemate: the embrasure IS the
 * weapon, which is what keeps a 2.2 m defence readable at RTS distance without
 * a slewing head to look at.
 */
function glavePost(): StructureMassList {
  const f = fp('pillbox');
  const w = f.w * CELL * 0.80;
  const h = f.height;
  const masses: M[] = [
    ...pactPad(f.w, f.h, h),
    // PACT-1 at defence scale: the cap OVERHANGS the casemate below it.
    //
    // EVERY height here is a fraction of `h` chosen so the tallest thing —
    // the canted vane — lands at 1.02 h, not above it. A rotated plate's
    // vertical extent is `chord * sin(tilt)`, which on a 2.2 m structure with a
    // 12% tolerance is the difference between shipping and REJECTED.
    pri('casemate', MassRole.Primary, [w * 0.82, h * 0.56, w * 0.82], [0, h * 0.28, 0], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall',
    }),
    pri('cap', MassRole.Primary, [w, h * 0.30, w], [0, h * 0.72, 0], 'paintMed', {
      plan: 'hexagon', capSlot: 'grille',
    }),
    box('embrasure', MassRole.Primary, [w * 0.50, h * 0.22, 0.30], [0, h * 0.42, w * 0.42], 'grille', { chamfer: 0.04 }),
    cyl('barrel', MassRole.Greeble, [0.22, 1.40, 0.22], [0, h * 0.42, w * 0.52], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], group: 'gun', chamfer: 0.03, capSlot: 'grille', segments: 10,
    }),
    box('buttress', MassRole.Greeble, [w * 0.24, h * 0.30, w * 0.20], [w * 0.42, h * 0.15, w * 0.28], 'paintSmall', {
      mirrorX: true, rot: [0, 0, 0.18], group: 'buttresses', chamfer: 0.06,
    }),
    box('optic', MassRole.Greeble, [0.22, 0.34, 0.22], [-w * 0.20, h * 0.86, -w * 0.14], 'bareMetal', { group: 'optics', chamfer: 0.04 }),
    box('vent', MassRole.Greeble, [w * 0.22, 0.16, w * 0.22], [w * 0.20, h * 0.84, -w * 0.16], 'vent', { group: 'optics' }),
    box('vane', MassRole.Greeble, [w * 0.40, 0.10, w * 0.22], [0, h * 0.92, -w * 0.06], 'stripe', {
      rot: [-0.38, 0, 0.12], group: 'vane', faceSlots: { py: 'glass' }, chamfer: 0.03,
    }),
    teamPanel('team.cap', [w * 0.46, 0.12, w * 0.32], [0, h * 0.87, 0]),
    teamPanel('team.chevron', [0.14, h * 0.24, w * 0.34], [w * 0.40, h * 0.36, 0], { mirrorX: true }),
    ...lightRow(w * 0.38, h * 0.72, w * 0.40, 2, 0.26, 0.16, 'lamp'),
  ];
  return list('meridian_glaive', 'Glaive Post', 'pillbox', masses, [
    { part: PartId.MuzzleA, pos: [0, h * 0.44, w * 0.62] },
  ], { cls: 'defence' });
}

/**
 * THE HELIOS SPIRE. Eight metres of tapered obelisk under a slewing mirror
 * head. The turret target is what makes it track, and `needsPower` on its
 * weapon is what makes it the faction's risk.
 */
function heliosSpire(): StructureMassList {
  const f = fp('prismTower');
  const w = f.w * CELL * 0.78;
  const h = f.height;
  const ringY = h * 0.62;
  const masses: M[] = [
    ...pactPad(f.w, f.h, h),
    pri('base', MassRole.Primary, [w, h * 0.16, w], [0, h * 0.08, 0], 'paintMed', {
      plan: 'octagon', capSlot: 'paintSmall',
    }),
    // The shaft: a cone, per PACT-5, widening again into the ring above it.
    cyl('shaft', MassRole.Primary, [w * 0.52, ringY - h * 0.16, w * 0.52], [0, (ringY + h * 0.16) * 0.5, 0], 'paintMed', {
      topRadius: 0.66, capSlot: 'grille', segments: 12,
    }),
    cyl('ring', MassRole.Primary, [w * 0.78, h * 0.06, w * 0.78], [0, ringY - h * 0.02, 0], 'bareMetal', {
      capSlot: 'grille', segments: 16,
    }),
    cyl('conduit', MassRole.Greeble, [0.16, ringY * 0.70, 0.16], [w * 0.30, ringY * 0.38, -w * 0.26], 'bareMetal', {
      mirrorX: true, group: 'conduits', chamfer: 0.03, capSlot: 'grille', segments: 8,
    }),
    box('cell', MassRole.Greeble, [w * 0.30, h * 0.14, w * 0.24], [-w * 0.30, h * 0.24, -w * 0.24], 'grille', { group: 'cells' }),
    box('buttress', MassRole.Greeble, [w * 0.18, h * 0.30, w * 0.16], [w * 0.34, h * 0.20, w * 0.22], 'paintSmall', {
      mirrorX: true, rot: [0, 0, 0.20], group: 'buttresses', chamfer: 0.05,
    }),
    teamPanel('team.skirt', [0.14, h * 0.20, w * 0.36], [w * 0.40, h * 0.22, 0], { mirrorX: true }),
    teamPanel('team.ring', [w * 0.62, 0.12, w * 0.24], [0, ringY + h * 0.02, 0]),
    ...lightRow(w * 0.30, h * 0.34, w * 0.42, 2, 0.24, 0.16, 'lamp'),

    /* -- the slewing mirror head, rebased onto the ring by the factory ----- */
    pri('head', MassRole.Primary, [w * 0.68, h * 0.20, w * 0.74], [0, ringY + h * 0.10, 0], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall', target: 'turret',
    }),
    box('head.mirror', MassRole.Primary, [w * 0.62, 0.18, w * 0.52], [0, ringY + h * 0.24, w * 0.10], 'stripe', {
      rot: [-0.70, 0, 0], target: 'turret', faceSlots: { py: 'glass' }, chamfer: 0.05,
    }),
    cyl('head.focus', MassRole.Greeble, [0.34, h * 0.16, 0.34], [0, ringY + h * 0.20, w * 0.34], 'bareMetal', {
      rot: [-1.20, 0, 0], target: 'turret', group: 'focus', capSlot: 'grille', topRadius: 0.60, segments: 10,
    }),
    box('head.fin', MassRole.Greeble, [w * 0.34, h * 0.14, 0.14], [0, ringY + h * 0.22, -w * 0.32], 'grille', {
      target: 'turret', group: 'fin', chamfer: 0.04,
    }),
    box('head.lamp', MassRole.Emissive, [w * 0.26, 0.16, 0.10], [0, ringY + h * 0.14, w * 0.36], 'emissive', {
      target: 'turret', group: 'headLamp', feature: Feature.Window, chamfer: 0.03,
    }),
    teamPanel('team.head', [w * 0.38, 0.12, w * 0.24], [0, ringY + h * 0.20, -w * 0.16], { target: 'turret' }),
  ];
  return list('meridian_helios', 'Helios Spire', 'prismTower', masses, [
    { part: PartId.Emitter, pos: [0, ringY + h * 0.26, w * 0.44], turret: true },
    { part: PartId.MuzzleA, pos: [0, ringY + h * 0.26, w * 0.46], turret: true },
  ], { cls: 'defence', turretPivot: [0, ringY, 0] });
}

/**
 * THE RAMPART. No pad: a wall follows terrain, and a foundation slab under
 * every 4 m section would tile the whole perimeter in stone.
 */
function rampart(): StructureMassList {
  const f = fp('wall');
  const w = f.w * CELL;
  const h = f.height;
  const masses: M[] = [
    pri('wall', MassRole.Primary, [w, h * 0.80, w * 0.36], [0, h * 0.40, 0], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall',
    }),
    // PACT-5 at wall scale: the cone posts ARE the pilasters.
    cyl('post', MassRole.Primary, [w * 0.20, h, w * 0.20], [w * 0.5 - w * 0.10, h * 0.5, 0], 'paintMed', {
      mirrorX: true, topRadius: 0.62, capSlot: 'paintSmall', segments: 10,
    }),
    box('coping', MassRole.Primary, [w, h * 0.13, w * 0.46], [0, h * 0.90, 0], 'paintSmall', { chamfer: 0.045 }),
    // At 0.92 h, not 1.00 h: the cone posts already reach the frozen 2.0 m
    // roofline, and a canted vane on top of them adds its chord's sine to
    // `bounds[1]` and takes the panel straight through the 12% tolerance.
    box('vane', MassRole.Greeble, [w * 0.34, 0.09, w * 0.20], [0, h * 0.92, 0], 'stripe', {
      rot: [-0.38, 0, 0], group: 'vane', faceSlots: { py: 'glass' }, chamfer: 0.03,
    }),
    box('kick', MassRole.Greeble, [w * 0.96, h * 0.14, w * 0.50], [0, h * 0.07, 0], 'paintSmall', { group: 'kick', chamfer: 0.05 }),
    box('bolt', MassRole.Greeble, [w * 0.10, h * 0.10, 0.10], [-w * 0.28, h * 0.32, w * 0.19], 'hatch', { group: 'bolts', chamfer: 0.02 }),
    teamPanel('team.band', [w * 0.32, h * 0.24, 0.12], [0, h * 0.50, w * 0.19]),
    box('lamp', MassRole.Emissive, [0.24, 0.20, 0.10], [w * 0.30, h * 0.70, w * 0.20], 'emissive', {
      group: 'lamps', feature: Feature.Window, chamfer: 0.03,
    }),
  ];
  return list('meridian_rampart', 'Rampart', 'wall', masses, [], { cls: 'wall' });
}

/* ==========================================================================
 * 6. THE ROSTER
 * ========================================================================== */

export const MERIDIAN_STRUCTURE_MASS_LISTS: readonly StructureMassList[] = [
  conclave(),
  solarArray(),
  chapterhouse(),
  cistern(),
  forgeyard(),
  oculus(),
  reliquary(),
  depot(),
  slipway(),
  sunVault(),
  glavePost(),
  heliosSpire(),
  rampart(),
];

export const MERIDIAN_STRUCTURE_BY_KEY: ReadonlyMap<string, StructureMassList> =
  new Map(MERIDIAN_STRUCTURE_MASS_LISTS.map((l) => [l.key, l]));

/**
 * Content key -> model key. The content vocabulary belongs to
 * `src/data/Defs.ts`; this is the one place the two namespaces meet.
 */
export const MERIDIAN_STRUCTURE_MODELS: Readonly<Record<string, string>> = {
  mrdConclave: 'meridian_conclave',
  mrdSolarArray: 'meridian_solararray',
  mrdChapterhouse: 'meridian_chapterhouse',
  mrdCistern: 'meridian_cistern',
  mrdForgeyard: 'meridian_forgeyard',
  mrdOculus: 'meridian_oculus',
  mrdReliquary: 'meridian_reliquary',
  mrdDepot: 'meridian_depot',
  mrdSlipway: 'meridian_slipway',
  mrdVault: 'meridian_vault',
  mrdGlaive: 'meridian_glaive',
  mrdHelios: 'meridian_helios',
  mrdRampart: 'meridian_rampart',
};

/* ==========================================================================
 * 7. BUILD AND HAND OFF
 * ========================================================================== */

/**
 * A PRIVATE library on a PRIVATE `GreebleFactory`, and both words matter.
 * `BuildingLibrary.build` caches its atlas under `${list.faction}.structure`,
 * and the shared `buildingLibrary` is filled by `buildings.system.ts` in the
 * same boot — sharing it would mean the Pact's palette either collided with the
 * Allied atlas or won it, depending on init order. A private factory makes the
 * question unanswerable rather than answered-by-luck, at a cost of two extra
 * materials (architecture + ground) for the whole army.
 */
export const meridianBuildingLibrary = new BuildingLibrary(new GreebleFactory());

/** Translate a built structure into the bridge's shape. Mirrors `buildings.system.ts`. */
function toKindMesh(m: StructureModel): KindMesh {
  const sockets: BridgeSocket[] = m.sockets.map((s) => ({
    part: s.part, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, followsTurret: false,
  }));
  for (const s of m.turretSockets) {
    sockets.push({
      part: s.part,
      x: s.x + m.turretPivot[0], y: s.y + m.turretPivot[1], z: s.z + m.turretPivot[2],
      yaw: s.yaw, pitch: s.pitch, followsTurret: true, pivotY: m.turretPivot[1],
    });
  }

  const parts: NonNullable<KindMesh['parts']>[number][] = [];
  if (m.pad !== null) {
    // A pad is 40 mm of slab on the ground. Casting a shadow from it buys
    // nothing and costs a shadow-map draw per structure on screen.
    parts.push({ geometry: m.pad, material: m.padMaterial, castShadow: false, receiveShadow: true });
  }
  if (m.turret !== null) {
    parts.push({
      geometry: m.turret,
      material: m.material,
      x: m.turretPivot[0], y: m.turretPivot[1], z: m.turretPivot[2],
      followsTurret: true,
      castShadow: true,
      receiveShadow: true,
    });
  }

  return {
    geometry: m.body,
    material: m.material,
    parts: parts.length > 0 ? parts : undefined,
    sockets,
    turretPivotY: m.turretPivot[1],
    castShadow: true,
    receiveShadow: true,
  };
}

export interface MeridianStructureReport {
  models: StructureModel[];
  failed: string[];
  registrations: number;
  bound: number;
}

/**
 * Build every Pact structure and publish it to `RenderBridge`.
 *
 * `buildingId` is `resolveDefBinding().buildingId` — content key -> def index.
 * Passing it in keeps this module free of any dependency on `src/game/**`.
 *
 * Everything registers at `FACTION_ANY` for the same reason the units do:
 * `RenderBridge.factionSlot()` folds any faction above 2 onto the wildcard
 * slot, and each of these defIds belongs to exactly one army anyway.
 */
export async function buildAndRegisterMeridianStructures(
  atlasSize: number,
  buildingId: Readonly<Record<string, number>>,
): Promise<MeridianStructureReport> {
  const palettes: StructurePalettes = {
    structure: MERIDIAN_STRUCTURE_PALETTE,
    pad: MERIDIAN_PAD_PALETTE,
    panelDensity: PANEL_DENSITY,
    seed: SEED,
    padSeed: PAD_SEED,
    /*
     * CUT STONE, NOT ALLIED CERAMIC.
     *
     * This army declares `rivets: false` because its atlas draws welded straps
     * rather than bolt rows, and until `StructureCoat` existed that one boolean
     * ALSO chose the coat — so the Pact shipped wearing the Allied glaze
     * (clearcoat 0.42 at roughness 0.26, env 0.95), a wet mirror finish on
     * masonry. `'stone'` keeps the ceremonial polish this faction wants and
     * takes the mirror off it: half the coat, nearly double the roughness.
     */
    coat: 'stone',
  };

  // Atlas off-thread first — private GreebleFactory, see the note above.
  await meridianBuildingLibrary.prewarm(MERIDIAN_STRUCTURE_MASS_LISTS, () => palettes, atlasSize);

  const models: StructureModel[] = [];
  const failed: string[] = [];
  for (const l of MERIDIAN_STRUCTURE_MASS_LISTS) {
    try {
      models.push(meridianBuildingLibrary.build(l, palettes, atlasSize));
    } catch (err) {
      // One bad mass list must not take the roster — or the render — down.
      failed.push(`${l.key}: ${String(err)}`);
    }
  }

  const meshes = new Map<string, KindMesh>();
  const meshFor = (key: string): KindMesh | null => {
    const model = meridianBuildingLibrary.get(key);
    if (model === undefined) return null;
    let mesh = meshes.get(key);
    if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
    return mesh;
  };

  let registrations = 0;
  let bound = 0;
  for (const [contentKey, modelKey] of Object.entries(MERIDIAN_STRUCTURE_MODELS)) {
    const mesh = meshFor(modelKey);
    if (mesh === null) continue;
    const defId = buildingId[contentKey];
    if (defId === undefined || defId < 0) continue;
    registerKindMesh(EntityKind.Building, FACTION_ANY, mesh, defId);
    registrations++;
    bound++;
  }

  // The Pact's own default, so a Meridian structure spawned with defId -1 draws
  // Pact architecture instead of the bridge's hazard box. The Chapterhouse is
  // the least damaging choice for the same reason `buildings.system.ts` picks
  // the barracks: 2x2 is the modal footprint and it is the plainest silhouette
  // in the roster, so a base of them reads as a base rather than as eight
  // Conclaves. It lands on the wildcard slot (`factionSlot()` folds 3 onto it)
  // and is therefore the LAST-RESORT entry — the Allied, Soviet and Neutral
  // (kind, faction, -1) defaults are all resolved before the chain reaches it.
  const fallback = meshFor('meridian_chapterhouse');
  if (fallback !== null) {
    registerKindMesh(EntityKind.Building, 3 as Faction, fallback, -1);
    registrations++;
  }

  return { models, failed, registrations, bound };
}

/** Release every Pact geometry, material and atlas. */
export function disposeMeridianBuildings(): void {
  meridianBuildingLibrary.dispose();
}
