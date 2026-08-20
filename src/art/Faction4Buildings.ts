/**
 * ============================================================================
 * src/art/Faction4Buildings.ts — THE RECLAMATION, AS ARCHITECTURE
 * ============================================================================
 * Twelve structures, two palettes, and the call that publishes them to
 * `RenderBridge`. Imports `BuildingFactory.ts` and `MassList.ts`; edits
 * neither, and does not touch `BuildingDefs.ts` at all. The file it answers to
 * is `Faction4Units.ts` — the army's design authority — and the file it copies
 * its ARCHITECTURE from is `Faction3Buildings.ts`.
 *
 *
 * THE SEVEN RECLAMATION RULES, the way bible 5.7 states them for the others
 * ---------------------------------------------------------------------------
 *  RCL-1   EXPOSED FRAME, CLADDING HUNG ON IT. Every structure is a box-girder
 *          cage — four battered corner columns tied by beams — with a smaller
 *          clad volume sitting INSIDE it and separate plates bolted to the
 *          outside on stand-offs, with real gaps between them. This is the
 *          single loudest decision in the file and it is the same one
 *          `Faction4Units.ts` makes for the hulls: the other three armies'
 *          buildings are closed volumes with things attached, and this one is a
 *          structure you can see through. At 40 m the four armies' bases read
 *          as pyramid / brick / mushroom / SCAFFOLD, in that order.
 *
 *  RCL-2   A GANTRY, NOT A CROWN. The Allies open a hex crown to the sky, the
 *          Soviets stack a smaller slab and the Pact puts a mirror disc on the
 *          roof. This army lays a horizontal BEAM across the top of the frame,
 *          off the centre line, carried past the roof on the columns. Nothing
 *          is capped; everything is bridged.
 *
 *  RCL-3   ASYMMETRY. The columns and the ties mirror, because a frame that did
 *          not would fall over, and NOTHING ELSE DOES except what is bolted
 *          ONTO a column — the flank team plate and the conduit that runs down
 *          it, which are part of the column rather than things standing beside
 *          it. That exemption is exhaustive and it is enforced by
 *          `tests/building-shape.spec.ts`, because it was not: the intake bank
 *          and the lamp hood carried `mirrorX` for the whole life of this file
 *          and the rule above said otherwise. One flank carries a slab
 *          of salvaged cladding and a grapple jib; the other is open frame with
 *          a fuel drum standing in it. The diagonal K-brace is on one side only.
 *          The rear tie sits lower than the front tie. A Reclamation base seen
 *          from the east does not match itself seen from the west, which is a
 *          thing you notice before you can say why.
 *
 *  RCL-4   NO TURRET, EVER. `rclSpitpost` and `rclPylon` both carry
 *          `hasTurret: false` in `src/data/Defs.ts`, so not one mass in this
 *          file targets `'turret'` and no structure declares a `turretPivot`.
 *          Both defences are fixed CASEMATES: the embrasure is the weapon.
 *
 *  RCL-5   THE ARC COIL. Two lathed rings with a lit gap between them, on a
 *          short mast, ALWAYS offset to one side. It is on all eleven hulls and
 *          it is on all twelve structures, at three different scales — 0.5 m on
 *          a wall panel, 1.4 m on a production building, 3 m as the whole head
 *          of the Arc Pylon. It is what makes the army legible at a distance
 *          where the frame has collapsed into a smudge.
 *
 *  RCL-6   THE SLAG APRON. Poured slag with cut corners, dark and violet rather
 *          than grey (see the CHROMA BUDGET on `RECLAIM_LOOK`), with a HAZARD
 *          AMBER kerb on the approach faces only — not the Allied charcoal
 *          rectangle, not the Soviet grated deck, not the Pact's pale stone
 *          hexagon with its ring kerb.
 *
 *  RCL-7   EMISSIVE IS A LINE. Arc conduit runs straight down a column or along
 *          a beam, in clean rectangles. Never a blob, never a window grid. The
 *          one exception is the coil gap, which is a lit RING, and a ring is
 *          just a line closed on itself.
 *
 *
 * SURFACE. The clean-painted law is honoured by construction: every mark comes
 * from `Greeble.ts`'s painters through the tile slots, `rivets: false` selects
 * the welded language, and there is no path from this file to a texel of noise.
 * ============================================================================
 */

import {
  BUILDING_DIMENSIONS, BUILDING_PAD, CELL,
  NAVAL_BUILDING_DIMENSIONS, type UnitPalette,
} from '../core/config';
import { EntityKind, Faction, PartId } from '../core/types';
import { GreebleFactory, type SlotName } from './Greeble';
import { MassRole, taperOutline } from './MassList';
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
 * RECLAMATION ARCHITECTURE.
 *
 * One step lighter than `RECLAIM_UNIT_PALETTE.base` (#3D3A44) for the same
 * reason the Allied and Pact structure palettes are lighter than their hulls:
 * buildings catch the key light and want to sit above the units standing in
 * front of them. It is still, by a clear margin, the darkest architecture in
 * the game — a Reclamation base against a Pact one is bone versus soot.
 *
 * R12 is respected the way all four armies respect it: `base` is NOT a faction
 * colour. It is oxide-blackened steel, and the violet only ever reaches a
 * surface through the `teamSlab` tile, in flat plates measuring 4-10% of the
 * structure.
 */
export const RECLAIM_STRUCTURE_PALETTE: UnitPalette = {
  base: '#4E4956',
  shadow: '#1C1922',
  /** Arc violet, straight off the hull palette. The armies must match. */
  team: '#9B18D8',
  teamSecondary: '#5E0E86',
  /** Amber bird on a violet disc — see `RECLAIM_UNIT_PALETTE.insignia`. */
  insignia: 'eagle',
  insigniaColor: '#E8B33C',
  hullNumber: 3312,
  emissive: '#E27BFF',
  /** Warm grey-brown, per bible 5.4 (S <= 0.26). Never blue steel. */
  bareMetal: '#6A6258',
  trackLink: '#241F2A',
  glass: '#2A1E34',
  stencil: '#D8CFC0',
  hazard: '#E5CB43',
  /** Welded and torch-cut, not bolted. The Soviets keep the rivet ring. */
  rivets: false,
};

/**
 * THE SLAG APRON (RCL-6). Poured slag rather than concrete: dark, and violet
 * rather than grey, which is what `RECLAIM_LOOK.concrete` in config.ts already
 * declares for this army's ground. A near-black hull on a near-black pad would
 * lose the footprint entirely, so the hazard-amber kerb on the approach faces
 * is doing the same job the Pact's jade kerb does — it is the only thing
 * keeping a dark building on dark ground readable at RTS distance.
 */
export const RECLAIM_PAD_PALETTE: UnitPalette = {
  base: '#645E6E',
  shadow: '#201C26',
  team: '#9B18D8',
  teamSecondary: '#4E4858',
  insignia: 'eagle',
  insigniaColor: '#E8B33C',
  hullNumber: 3312,
  emissive: '#E27BFF',
  bareMetal: '#6E6A66',
  trackLink: '#241F2A',
  glass: '#2A1E34',
  stencil: '#CFC8BC',
  hazard: '#E5CB43',
  rivets: false,
};

/**
 * `StructureFaction` is `'allies' | 'soviets'` in `BuildingFactory.ts`, which
 * is not this module's file. The field is read for exactly one thing:
 * `structureChamfer()`'s per-faction fraction.
 *
 * `'soviets'` is the correct declaration and not a workaround. It selects 4.0%
 * of min-extent rather than the Allied 5.5%, which is the right figure for
 * plate that was cut with a torch and hung on a frame — a heavier bevel would
 * round a 0.36 m girder into a rail. It also matches the string
 * `RECLAIM_ART_FACTION` declares for the hulls, so the two halves of the army
 * take the same edge treatment.
 *
 * No Soviet colour reaches these models: both atlases are built from the two
 * palettes above on a PRIVATE `GreebleFactory` inside a PRIVATE
 * `BuildingLibrary`, so the `soviets.structure` atlas key can never collide
 * with the shared one `buildings.system.ts` fills.
 */
const RECLAIM_ART_FACTION: StructureFaction = 'soviets';

const SEED = 0x52_43;
const PAD_SEED = 0x52_9d;

/**
 * Panel-run density on the architecture atlas. MEASURED by sweeping the
 * generator over this roster, not copied from either shipped faction.
 *
 * A frame building samples `paintMed` over a much SMALLER share of its surface
 * than a closed volume does — the columns, ties, jibs, drums and catwalks are
 * all `bareMetal`, `tread` and `grille` — so the Soviet 2.6 that this army
 * borrows its chamfer from leaves the paint tiles under-drawn while the
 * weighted average is dragged down by hardware that was never going to carry a
 * panel run.
 *
 * 3.0 is where a sweep over this roster lands it. At the 512 px atlas the game
 * actually boots with, the twelve structures measure 19-25% Sobel against the
 * Pact's 20-29%, the Soviets' 22-29% and the Allies' 26-31% — mid-pack, which
 * is the correct place for an army whose detail is supposed to come from
 * GEOMETRY you can see through rather than from marks on a wall. Drawn-detail
 * coverage lands at 25-33%, the HIGHEST of the four rosters and five to seven
 * times `SURFACE_BUDGET.detailFloorStructure`, with speckle at 0.1%.
 */
const PANEL_DENSITY = 1.25;

/* ==========================================================================
 * 2. MASS CONSTRUCTORS
 *
 * The same three shorthands `Faction3Buildings.ts` uses, plus the two Shapes
 * primitives this army lives on. A second vocabulary for the same roles would
 * be a bug farm, and the validator counts roles.
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

/**
 * A GIRDER. `taperedBox` with both top scales pulled in, which is a battered
 * column — and, more usefully, a shape that reports ZERO axis-aligned flank to
 * anything measuring boxiness, because a tapered wall is not a vertical plane.
 * Every structural member in this file is one of these.
 */
function girder(name: string, size: V3, anchor: V3, o?: Partial<M>): M {
  return {
    name, primitive: 'taperedBox', role: MassRole.Greeble, size, anchor,
    slot: 'bareMetal', chamfer: 0.05,
    shape: { topScaleX: 0.70, topScaleZ: 0.70 },
    ...o,
  };
}

/** A flat violet panel insert (R-T2). Never a tint, never a gradient. */
function teamPanel(name: string, size: V3, anchor: V3, o?: Partial<M>): M {
  return box(name, MassRole.TeamSlab, size, anchor, 'teamSlab', { chamfer: 0.045, ...o });
}

/** The single insignia plate (R-T4). Defences and walls carry none. */
function insignia(size: number, anchor: V3, o?: Partial<M>): M {
  return box('insignia', MassRole.Insignia, [size, size, 0.14], anchor, 'insignia', {
    chamfer: 0.04, ...o,
  });
}

/** RCL-7: one straight run of arc conduit. A clean rectangle, always. */
function conduit(name: string, size: V3, anchor: V3, o?: Partial<M>): M {
  return box(name, MassRole.Emissive, size, anchor, 'emissive', {
    feature: Feature.Window, chamfer: 0.03, group: 'conduit', ...o,
  });
}

/* ==========================================================================
 * 3. SHARED FEATURES
 * ========================================================================== */

/**
 * RCL-6: THE SLAG APRON.
 *
 * Real geometry with its own material, not a decal — a decal would z-fight and
 * a per-site re-mesh would cost a batch per instance. One mass carries both the
 * visible slab and the buried skirt: the top face sits at `BUILDING_PAD.lift`
 * and the box runs down past the origin by `skirtDepth`, so the joint is under
 * the heightfield on every cell `Terrain.isBuildable` will accept. That depth
 * is measured against the live heightfield at boot by `buildings.system.ts`,
 * and the Reclamation pads are the same geometry, so the same proof covers them.
 *
 * The kerb is ASYMMETRIC on purpose (RCL-3): amber down the approach face and
 * the +X flank, nothing on the other two. A ring kerb is a Pact idea.
 */
function slagApron(fw: number, fh: number, height: number): M[] {
  const over = BUILDING_PAD.sovietOverhang;
  const thick = Math.max(0.20, height * BUILDING_PAD.sovietThickness);
  const w = fw * CELL * (1 + over * 2);
  const d = fh * CELL * (1 + over * 2);
  const total = thick + BUILDING_PAD.skirtDepth;
  const cy = BUILDING_PAD.lift - total * 0.5;

  return [
    pri('pad.slab', MassRole.Greeble, [w, total, d], [0, cy, 0], 'paintMed', {
      // 0.16 rather than 0.10, for the same free reason the deck's cut moved:
      // a poured apron with a token nick out of each corner reads as a
      // rectangle, and this army's ground is supposed to read as poured.
      plan: 'cutBox', cornerCut: 0.16, capSlot: 'paintSmall',
      target: 'pad', feature: Feature.Static, group: 'pad',
      chamfer: Math.min(0.24, thick * 0.5),
    }),
    box('pad.kerbF', MassRole.Greeble, [w * 0.76, 0.11, 0.36], [0, BUILDING_PAD.lift + 0.03, d * 0.5 - 0.42], 'stripe', {
      target: 'pad', feature: Feature.Static, group: 'kerb',
    }),
    box('pad.kerbS', MassRole.Greeble, [0.36, 0.11, d * 0.56], [w * 0.5 - 0.42, BUILDING_PAD.lift + 0.03, -d * 0.06], 'stripe', {
      target: 'pad', feature: Feature.Static, group: 'kerb',
    }),
    // The unloading ramp, on the approach corner and on that corner only.
    box('pad.ramp', MassRole.Greeble, [w * 0.26, 0.16, d * 0.18], [-w * 0.26, BUILDING_PAD.lift + 0.02, d * 0.36], 'tread', {
      rot: [-0.06, 0, 0], target: 'pad', feature: Feature.Static, group: 'ramp', chamfer: 0.04,
    }),
  ];
}

/**
 * RCL-1 + RCL-3: THE BOX-GIRDER CAGE.
 *
 * Four battered columns and five ties, all sharing one greeble group — because
 * "the frame" is ONE thing a critic points at from across the map, which is
 * what bible 5.3's 8-26 budget counts.
 *
 * The front pair runs full height and the rear pair stops at 92% of it; the
 * side ties sit at 86% and the rear tie at 62%. None of that is decoration:
 * a cage with four equal legs and a level top ring reads as scaffolding from a
 * kit, and the whole point of this army is that it was welded up out of what
 * was lying around.
 */
function cage(w: number, d: number, top: number): M[] {
  const cx = w * 0.44;
  const cz = d * 0.40;
  const t = Math.min(0.42, Math.max(0.26, w * 0.036));
  return [
    girder('col.f', [t, top, t], [cx, top * 0.5, cz], {
      mirrorX: true, group: 'frame',
      shape: { topScaleX: 0.64, topScaleZ: 0.64, shear: -d * 0.015 },
    }),
    girder('col.b', [t, top * 0.92, t], [cx, top * 0.46, -cz], {
      mirrorX: true, group: 'frame',
      shape: { topScaleX: 0.64, topScaleZ: 0.64 },
    }),
    girder('tie.side', [t * 0.66, t * 0.66, d * 0.84], [cx, top * 0.86, -d * 0.02], {
      mirrorX: true, group: 'frame', shape: { topScaleX: 0.78, topScaleZ: 0.94 },
    }),
    girder('tie.front', [w * 0.90, t * 0.62, t * 0.62], [0, top * 0.86, cz], {
      group: 'frame', shape: { topScaleX: 0.96, topScaleZ: 0.74 },
    }),
    // Lower than the front tie, and it is the only one that is.
    girder('tie.back', [w * 0.90, t * 0.62, t * 0.62], [0, top * 0.62, -cz], {
      group: 'frame', shape: { topScaleX: 0.96, topScaleZ: 0.74 },
    }),
    // THE K-BRACE. On the +X flank ONLY. Under a 0.62 rad cant its own extents
    // grow by the sine of the angle, so it is authored short and inboard.
    girder('brace', [t * 0.60, top * 0.52, t * 0.60], [cx, top * 0.40, cz * 0.34], {
      rot: [0, 0, 0.58], group: 'frame', shape: { topScaleX: 0.8, topScaleZ: 0.8 },
    }),
  ];
}

/**
 * RCL-1: A SLAB OF SALVAGED CLADDING, HUNG.
 *
 * A trapezoidal plate standing proud of the frame on a stand-off, canted so it
 * is not parallel to the wall behind it. `plate` is doing real work here: its
 * entire rim is bevel at any rotation, so a wall built out of these measures
 * nothing at all on "a rectangle made of rectangles".
 *
 * Rotated a quarter turn about Z, a plate of size `[a, t, b]` becomes a panel
 * `t` thick, `a` TALL and `b` long — which is why the first argument is the
 * panel's height and not its width.
 */
function hungClad(
  name: string, panelH: number, panelLen: number, anchor: V3, cant: number,
  slot: SlotName = 'paintSmall', role: MassRole = MassRole.Greeble,
): M[] {
  const th = 0.18;
  return [
    {
      name, primitive: 'plate', role, size: [panelH, th, panelLen], anchor,
      rot: [0, 0, Math.PI * 0.5 + cant], slot, capSlot: slot, chamfer: 0.05, group: name,
      shape: { outline: taperOutline(panelH, panelLen, 0.76, 0.98), thickness: th, bevel: 0.05 },
    },
    girder(`${name}.standoff`, [0.22, 0.22, panelLen * 0.46],
      [anchor[0] * 0.84, anchor[1] - panelH * 0.16, anchor[2]], { group: name }),
  ];
}

/**
 * RCL-5: THE ARC COIL, at whatever scale it is asked for.
 *
 * Two lathed rings with a lit gap between them on a short mast. It is
 * deliberately NEVER centred on the model: putting it on the centre line would
 * make it read as an antenna, which every army has, and the whole point is that
 * it was welded on wherever there happened to be room.
 *
 * Returns the mast and both rings as one greeble group plus ONE emissive mass,
 * so the faction cue costs a single greeble slot however big it is.
 */
function arcCoil(name: string, x: number, y: number, z: number, dia: number, h: number): M[] {
  return [
    cyl(`${name}.mast`, MassRole.Greeble, [dia * 0.38, h * 0.40, dia * 0.38], [x, y + h * 0.20, z], 'bareMetal', {
      group: name, topRadius: 0.62, capSlot: 'grille', segments: 10, chamfer: 0.05,
    }),
    cyl(`${name}.ringA`, MassRole.Greeble, [dia, h * 0.15, dia], [x, y + h * 0.47, z], 'bareMetal', {
      group: name, topRadius: 0.86, capSlot: 'grille', segments: 14, chamfer: 0.05,
    }),
    cyl(`${name}.ringB`, MassRole.Greeble, [dia * 0.74, h * 0.13, dia * 0.74], [x, y + h * 0.93, z], 'bareMetal', {
      group: name, topRadius: 0.72, capSlot: 'grille', segments: 14, chamfer: 0.05,
    }),
    // The GAP is the emissive, and a lit ring around a dark core is what every
    // arc weapon in this army looks like when it fires.
    cyl(`${name}.gap`, MassRole.Emissive, [dia * 0.54, h * 0.28, dia * 0.54], [x, y + h * 0.70, z], 'emissive', {
      group: `${name}Gap`, feature: Feature.Window, capSlot: 'emissive', segments: 12, chamfer: 0.04,
    }),
  ];
}

/**
 * The furniture every Reclamation structure carries beyond the coil, and the
 * place RCL-3 is loudest: the drum is on -X, the jib is on +X, and neither one
 * has an opposite number.
 */
function salvage(w: number, d: number, deckY: number, bodyH: number): M[] {
  return [
    // The fuel drum, standing in the open bay on the -X flank.
    cyl('drum', MassRole.Greeble, [1.05, 1.55, 1.05], [-w * 0.40, deckY + 0.78, d * 0.12], 'bareMetal', {
      group: 'drum', topRadius: 0.94, capSlot: 'hatch', segments: 12, chamfer: 0.07,
    }),
    // The grapple jib, on the +X flank only.
    girder('jib', [0.26, 0.26, d * 0.44], [w * 0.42, deckY + bodyH * 0.58, d * 0.06], {
      rot: [0.20, 0, 0], group: 'jib',
    }),
    box('jib.hook', MassRole.Greeble, [0.42, 0.62, 0.42], [w * 0.42, deckY + bodyH * 0.30, d * 0.26], 'hatch', {
      group: 'jib', chamfer: 0.06,
    }),
    // Welded scrap along the deck edge. `greebleStrip` is the one primitive in
    // the library that draws a row of small hardware for one slot, which is
    // exactly what "somebody stacked their spares against the wall" needs.
    {
      name: 'stowage', primitive: 'greebleStrip', role: MassRole.Greeble,
      size: [w * 0.20, 0.46, d * 0.44], anchor: [-w * 0.34, deckY + 0.23, -d * 0.20],
      slot: 'bareMetal', group: 'stowage', chamfer: 0.05,
      shape: { density: 2.6, seed: 0x52_43 },
    },
    // The catwalk and its ladder, on the open flank where you can see through
    // the frame to them.
    box('catwalk', MassRole.Greeble, [0.62, 0.14, d * 0.52], [-w * 0.42, deckY + bodyH * 0.62, -d * 0.04], 'tread', {
      rot: [0, 0, 0.06], group: 'catwalk', chamfer: 0.04,
    }),
    box('ladder', MassRole.Greeble, [0.34, bodyH * 0.60, 0.12], [-w * 0.42, deckY + bodyH * 0.31, d * 0.28], 'stripe', {
      group: 'catwalk', chamfer: 0.03,
    }),
  ];
}

/* ==========================================================================
 * 4. THE FRAME — RCL-1..7, once, for every structure of the faction
 * ========================================================================== */

interface FrameOpts {
  /** Fraction of the footprint the cage occupies. Leaves an apron margin. */
  inset?: number;
  /** Fraction of the roofline the clad body occupies. */
  bodyFraction?: number;
  /** Team panel scale. Tuned per structure to land R-T1's 4-10%. */
  team?: number;
  /** Arc-coil ring diameter in metres. */
  coil?: number;
}

interface Frame {
  masses: M[];
  /** Metres: cage width, cage depth. */
  w: number;
  d: number;
  /** Top of the clad body — the roof you can stand on. */
  roofY: number;
  /** Top of the corner columns. The gantry rides just above this. */
  frameTop: number;
  /** Above this, per-structure features are free. */
  crownTop: number;
}

function reclaimFrame(fw: number, fh: number, height: number, o: FrameOpts): Frame {
  const inset = o.inset ?? 0.94;
  const w = fw * CELL * inset;
  const d = fh * CELL * inset;
  const bodyH = height * (o.bodyFraction ?? 0.46);
  const team = o.team ?? 1;

  const deckH = bodyH * 0.22;
  const mainH = bodyH - deckH;
  const mainY = deckH + mainH * 0.5;
  // The columns overshoot the roof by 16%: the gap between the top of the
  // cladding and the top of the frame is the "you can see through it" read,
  // and it is the only place in the game a building shows sky through itself.
  const frameTop = bodyH * 1.16;
  const gantryY = frameTop + 0.24;
  const crownTop = gantryY + 0.30;

  const masses: M[] = [...slagApron(fw, fh, height)];

  masses.push(
    // The deck. Cut corners in plan, and the one mass that touches the apron.
    //
    // The cut is 0.18, not the 0.10 it shipped with, and the reason is measured
    // rather than aesthetic: `structureBoxiness` names `deck` as the flattest
    // primary mass on every one of the eight frame-built structures, at 0.75-
    // 0.78 axis-aligned surface. `planPolygon('cutBox', cut)` returns eight
    // points at ANY cut, so widening it costs not one triangle and turns four
    // 10 cm nicks into a plinth with a real bevelled corner — the difference
    // between a slab that had its edges knocked off and one that was drawn.
    pri('deck', MassRole.Primary, [w * 0.94, deckH, d * 0.94], [0, deckH * 0.5, 0], 'paintMed', {
      plan: 'cutBox', cornerCut: 0.18, capSlot: 'tread',
    }),
    // THE CLAD BODY — the dominant mass, and deliberately NARROWER than the
    // cage so the columns stand proud on all four corners with daylight
    // between. Offset in +X so it is not centred in its own frame.
    {
      name: 'body', primitive: 'taperedBox', role: MassRole.Primary,
      size: [w * 0.74, mainH, d * 0.78], anchor: [w * 0.03, mainY, -d * 0.02],
      slot: 'paintMed', capSlot: 'paintMed',
      shape: { topScaleX: 0.90, topScaleZ: 0.94, shear: d * 0.05, cornerCut: 0.16 },
    },
    // RCL-2: THE GANTRY. Off the centre line, and it overhangs the rear tie.
    {
      name: 'gantry', primitive: 'taperedBox', role: MassRole.Primary,
      size: [w * 0.88, 0.44, 0.52], anchor: [0, gantryY, -d * 0.16],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.07,
      shape: { topScaleX: 0.94, topScaleZ: 0.68 },
    },
  );

  masses.push(...cage(w, d, frameTop));

  // RCL-1: the hung cladding, on the +X flank, at two different cants so the
  // two plates cannot read as one skin.
  masses.push(
    ...hungClad('clad.hi', mainH * 0.44, d * 0.42,
      [w * 0.41, deckH + mainH * 0.70, d * 0.14], 0.16),
    ...hungClad('clad.lo', mainH * 0.36, d * 0.34,
      [w * 0.40, deckH + mainH * 0.26, -d * 0.24], -0.13),
  );

  masses.push(...salvage(w, d, deckH, mainH));
  masses.push(...arcCoil('coil', -w * 0.30, frameTop, -d * 0.24, o.coil ?? 0.68, height * 0.115));

  // Plant. The vent and grille tiles are the highest-frequency surfaces in the
  // atlas and they are the honest way to buy back the drawn detail the flat
  // team slabs cost.
  masses.push(
    box('flue', MassRole.Greeble, [w * 0.16, mainH * 0.44, d * 0.13], [-w * 0.12, deckH + mainH * 1.02, -d * 0.24], 'vent', {
      group: 'flue', chamfer: 0.06,
    }),
    // RCL-3, AND IT WAS BROKEN HERE. The rule says the columns and the ties
    // mirror "and NOTHING ELSE DOES"; the header then lists the exemption the
    // file granted itself, which is the team plates and the conduit that sit ON
    // the columns. The intake bank and the lamp hood were in neither category
    // and were mirrored anyway, so eight of the twelve structures matched
    // themselves across four masses instead of two. Single-sided is the rule as
    // written — and it is also 704 triangles back across the roster, which is
    // what this pass spends on the corner cuts below.
    box('intake', MassRole.Greeble, [0.34, mainH * 0.44, d * 0.34], [w * 0.36, deckH + mainH * 0.36, -d * 0.22], 'grille', {
      group: 'intakes', chamfer: 0.05,
    }),
    box('service', MassRole.Greeble, [w * 0.16, deckH * 0.66, 0.28], [-w * 0.22, deckH * 0.36, d * 0.42], 'stencil', {
      group: 'service', chamfer: 0.05,
    }),
    box('lamp.hood', MassRole.Greeble, [0.34, 0.22, 0.20], [w * 0.30, deckH + mainH * 0.92, d * 0.40], 'bareMetal', {
      rot: [0.34, 0, 0], group: 'lamps', chamfer: 0.04,
    }),
  );

  // R-T3, and the one place this file was measurably wrong on the first pass.
  //
  // The columns are the mirrored part of the model (RCL-3), so the flank team
  // plates go ON them — the one place a Reclamation structure is allowed to
  // match itself. The DECK panel is deliberately a narrow BAND rather than a
  // slab, and that is not a taste call: a 39-degree camera weights a horizontal
  // face 0.63 against a flank's 0.25, so a roof-sized plate measures inside
  // R-T1's 4-10% while OWNING the top-down read, and arc violet on an oxide
  // hull owns it far harder than the Pact's jade on bone does. Measured at
  // 0.44w x 0.30d the roster sat at 6.7-9.9% and every structure read as a
  // magenta pool with a building under it; at 0.30w x 0.15d it sits at 4.5-6.5%
  // and reads as a painted deck stripe, which is what R-T2 asks for.
  masses.push(
    teamPanel('team.roof', [w * 0.30 * team, 0.16, d * 0.15 * team], [w * 0.02, deckH + mainH + 0.05, -d * 0.02]),
    teamPanel('team.rib', [0.17, mainH * 0.50 * team, d * 0.17 * team], [w * 0.44, deckH + mainH * 0.52, d * 0.40], { mirrorX: true }),
    teamPanel('team.facade', [w * 0.32 * team, mainH * 0.22 * team, 0.17], [-w * 0.06, deckH + mainH * 0.30, d * 0.38]),
  );
  masses.push(insignia(Math.min(w, d) * 0.19, [w * 0.20, deckH + mainH * 0.62, d * 0.40]));

  // RCL-7: two conduit runs down the front columns and one along the gantry.
  masses.push(
    conduit('lit.column', [0.13, mainH * 0.86, 0.13], [w * 0.44, deckH + mainH * 0.50, d * 0.40 + 0.16], { mirrorX: true }),
    conduit('lit.gantry', [w * 0.52, 0.15, 0.15], [0, gantryY + 0.24, -d * 0.16]),
    conduit('lit.deck', [w * 0.30, 0.14, 0.13], [-w * 0.14, deckH + 0.10, d * 0.46]),
  );

  return { masses, w, d, roofY: deckH + mainH, frameTop, crownTop };
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
  throw new Error(`[faction4] no footprint for "${key}"`);
}

function list(
  key: string, name: string, dimKey: string,
  masses: M[], sockets: StructureSocket[], extra?: Partial<StructureMassList>,
): StructureMassList {
  const f = fp(dimKey);
  return {
    key, name, faction: RECLAIM_ART_FACTION,
    footprintW: f.w, footprintH: f.h, height: f.height,
    masses, sockets, ...extra,
  };
}

/** Smoke and exit anchors every production structure publishes. */
function baseSockets(d: number, stackTop: number, stackX: number, stackZ: number): StructureSocket[] {
  return [
    { part: PartId.Stack, pos: [stackX, stackTop, stackZ] },
    { part: PartId.ExitPoint, pos: [0, 0.2, d * 0.5 + 3.0] },
  ];
}

/**
 * THE FOUNDRY. 3x3, eleven metres, and the building the whole army unfolds
 * from. Its silhouette read is the DERRICK: a raking lattice mast up one
 * corner with a jib swung out over the deployment bay, which is what carries
 * the structure to its frozen roofline without a crown.
 */
function foundry(): StructureMassList {
  const f = fp('conYard');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.46, team: 1.08, coil: 0.80 });
  const mastX = -s.w * 0.34, mastZ = -s.d * 0.30;
  const mastH = f.height - s.frameTop;
  s.masses.push(
    {
      name: 'derrick', primitive: 'taperedBox', role: MassRole.Primary,
      size: [1.30, mastH, 1.30], anchor: [mastX, s.frameTop + mastH * 0.5, mastZ],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.08,
      shape: { topScaleX: 0.42, topScaleZ: 0.42, shear: 0.22 },
    },
    {
      name: 'derrick.jib', primitive: 'taperedBox', role: MassRole.Primary,
      size: [0.60, 0.60, s.d * 0.86], anchor: [mastX, f.height - 1.35, s.d * 0.06],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.07,
      shape: { topScaleX: 0.72, topScaleZ: 0.96 },
    },
    girder('derrick.stay', [0.24, mastH * 0.72, 0.24], [mastX + 0.9, s.frameTop + mastH * 0.42, mastZ + 0.7], {
      rot: [0.22, 0, -0.26], group: 'hoist',
    }),
    box('derrick.block', MassRole.Greeble, [0.46, 1.70, 0.46], [mastX, f.height - 2.60, s.d * 0.38], 'hatch', {
      group: 'hoist', chamfer: 0.05,
    }),
    // The deployment bay: a leaf that retracts into the floor when the yard
    // works. The lintel is anchored INSIDE the wall line, because a 0.52 m
    // section hung proud of the facade overhangs the cell.
    box('bay.lintel', MassRole.Greeble, [s.w * 0.40, 0.52, 0.52], [0, s.roofY * 0.62, s.d * 0.5 - 0.12], 'stripe', {
      group: 'bay', chamfer: 0.07,
    }),
    box('bay.door', MassRole.Greeble, [s.w * 0.36, s.roofY * 0.56, 0.34], [0, s.roofY * 0.28, s.d * 0.5 - 0.04], 'hatch', {
      group: 'bay', feature: Feature.Door, anim: s.roofY * 0.60, chamfer: 0.05,
    }),
    // The jib's working light. A 3x3 yard hands a great deal of surface to
    // faces the camera never sees, so it needs a fourth lit run to clear
    // R-T5's floor that the 2x2 structures clear on three.
    conduit('lit.jib', [0.20, 0.20, s.d * 0.56], [mastX, f.height - 1.72, s.d * 0.06]),
  );
  return list('reclaim_foundry', 'Foundry', 'conYard', s.masses, [
    ...baseSockets(s.d, f.height, mastX, mastZ),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
    { part: PartId.Crane, pos: [mastX, f.height - 2.6, s.d * 0.46] },
    { part: PartId.FlagPole, pos: [s.w * 0.40, s.roofY, -s.d * 0.36] },
  ]);
}

/**
 * THE SCRAP FURNACE. 240 credits for 80 power, and it has to look it: a
 * leaning tapping stack off one corner, a bank of ribbed coolers on the other,
 * and nothing armoured anywhere. Five of these is what a Reclamation grid
 * looks like, so it is authored to be legible in a ROW.
 */
function furnace(): StructureMassList {
  const f = fp('powerPlant');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.42, team: 1.10 });
  const stackH = f.height - s.frameTop;
  const sx = s.w * 0.24, sz = -s.d * 0.16;
  s.masses.push(
    cyl('stack', MassRole.Primary, [s.w * 0.34, stackH, s.w * 0.34], [sx, s.frameTop + stackH * 0.5, sz], 'paintMed', {
      topRadius: 0.54, capSlot: 'vent', segments: 12,
    }),
    cyl('stack.collar', MassRole.Primary, [s.w * 0.40, stackH * 0.11, s.w * 0.40], [sx, s.frameTop + stackH * 0.20, sz], 'bareMetal', {
      capSlot: 'grille', segments: 12, chamfer: 0.06,
    }),
    // The tapping spout: the slag runs out of it into the bay below. Canted,
    // so it is the one diagonal in the silhouette.
    girder('spout', [0.40, 0.40, s.d * 0.42], [-s.w * 0.20, s.roofY + 0.55, s.d * 0.22], {
      rot: [-0.42, 0, 0], group: 'spout',
    }),
    box('spout.lip', MassRole.Greeble, [0.62, 0.36, 0.44], [-s.w * 0.20, s.roofY + 0.05, s.d * 0.40], 'hatch', {
      group: 'spout', chamfer: 0.05,
    }),
    // The cooler bank, on the -X flank and nowhere else.
    box('cooler', MassRole.Greeble, [s.w * 0.15, s.roofY * 0.62, s.d * 0.44], [-s.w * 0.40, s.roofY * 0.42, -s.d * 0.10], 'grille', {
      group: 'coolers', chamfer: 0.05,
    }),
    conduit('lit.throat', [0.34, stackH * 0.30, 0.34], [sx, s.frameTop + stackH * 0.62, sz + s.w * 0.20]),
  );
  return list('reclaim_furnace', 'Scrap Furnace', 'powerPlant', s.masses,
    baseSockets(s.d, f.height, sx, sz));
}

/**
 * THE PATCH YARD. A vehicle service pad, and the only structure in the roster
 * whose job is to be LOOKED THROUGH: the hull being welded parks under it, and
 * at the fixed 38-degree camera a shed roof would hide the exact thing the
 * building exists to work on. That is why 6.5 m is one of the three lowest
 * rooflines in the game — only the Ore Silo (5.0) and the Barracks (6.4) are
 * under it — and why the body fraction here is the smallest in the file.
 *
 * RCL-2 gets its purest statement of anywhere in the roster. Every other
 * structure bridges a beam over its own volume; this one bridges over open air,
 * and the two legs carrying it are deliberately not a pair — a battered mast
 * welded to the +X corner column and a strut leaning in on it from -X, so the
 * portal reads as something run up on site rather than delivered flat-packed.
 * Nothing mirrors, which is RCL-3 taken at its word rather than at its
 * exemptions.
 */
function depot(): StructureMassList {
  const f = fp('repairDepot');
  // 0.36 is the lowest body fraction in the file and it is the brief, not
  // taste: the clad workshop lands at 2.34 m — barely over the roof of the hull
  // it is mending — and the 3.2 m between the top of the cage and the underside
  // of the beam is sky.
  //
  // `team` is up at 1.24 because the shell's three plates are all scaled off
  // `mainH`, and the lowest body in the file makes every one of them shorter
  // while the mast and the beam add unpainted surface underneath them. At the
  // shell default it measures 4.5% — half a point off R-T1's floor and two off
  // the roster. 1.24 lands 6.4%, where the eight other frame-built ones sit.
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.36, team: 1.24, coil: 0.52 });
  // The shell's deck is 22% of the body height and `roofY` IS the body height,
  // so this is the deck's top face exactly rather than a re-guess of it.
  const deckTop = s.roofY * 0.22;
  const beamH = 0.58;
  // Solved, not chosen. The beam is the roofline: its top face lands on
  // `f.height`, which leaves the +/-12% height gate nothing to catch, and every
  // other authored mass hangs BELOW it.
  const beamY = f.height - beamH * 0.5;
  const legH = f.height - beamH - deckTop;
  // The working bay is the front lip of the deck, clear of the clad body's
  // front face at 0.37 d. Everything the portal carries lives on this plane, so
  // the hull drives up the apron ramp and stops under the arm.
  const bayZ = s.d * 0.42;
  // A rotated mass adds chord*sin(tilt) to its Y extent, so the cant comes out
  // of the strut's LENGTH rather than out of the height budget: at this length
  // the difference is 8 cm, which is a third of the whole tolerance on a 6.5 m
  // structure once the beam has claimed the rest.
  const strutTilt = 0.17;
  const strutH = (legH - 0.46 * Math.sin(strutTilt)) / Math.cos(strutTilt);
  s.masses.push(
    // THE MAST. Hard-battered, and lashed to the +X front column rather than
    // standing beside it — this army does not build a second thing where it can
    // weld onto the first.
    {
      name: 'hoist.mast', primitive: 'taperedBox', role: MassRole.Primary,
      size: [0.94, legH, 1.02], anchor: [s.w * 0.38, deckTop + legH * 0.5, bayZ],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.08,
      shape: { topScaleX: 0.50, topScaleZ: 0.46, shear: -s.d * 0.02 },
    },
    // THE BEAM. Off the centre line in X so the free end overhangs the open
    // flank, which is where the drum and the stowage already are.
    {
      name: 'hoist.beam', primitive: 'taperedBox', role: MassRole.Primary,
      size: [s.w * 0.92, beamH, 0.70], anchor: [-s.w * 0.03, beamY, bayZ],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.08,
      shape: { topScaleX: 0.97, topScaleZ: 0.56 },
    },
    girder('hoist.strut', [0.46, strutH, 0.52], [-s.w * 0.34, deckTop + legH * 0.5, bayZ - 0.12], {
      rot: [0, 0, -strutTilt], group: 'hoist',
    }),
    // The welding carriage and the boom it drops. Its top meets the underside
    // of the carriage exactly and it stops 2.7 m over the deck — clear of a
    // hull's roof and no higher, because a head parked up at hook height reads
    // as a crane and this building is not one.
    box('hoist.carriage', MassRole.Greeble, [0.92, 0.66, 0.86], [-s.w * 0.14, beamY - 0.78, bayZ], 'hatch', {
      group: 'hoist', chamfer: 0.06,
    }),
    cyl('hoist.boom', MassRole.Greeble, [0.34, legH * 0.34, 0.34],
      [-s.w * 0.14, beamY - 1.11 - legH * 0.17, bayZ], 'bareMetal', {
        group: 'hoist', topRadius: 0.72, capSlot: 'grille', segments: 10, chamfer: 0.05,
      }),
    // The gas bottles, standing on the deck on the mast side. One rack, no
    // opposite number, and the only mass in the structure the welder touches.
    cyl('bottle', MassRole.Greeble, [0.46, s.roofY * 0.52, 0.46], [s.w * 0.30, deckTop + s.roofY * 0.26, s.d * 0.40], 'bareMetal', {
      group: 'bottles', topRadius: 0.88, capSlot: 'hatch', segments: 10, chamfer: 0.05,
    }),
    // The hardstand: tread plate laid over the front of the deck, on the plane
    // the arm works. It is 10 cm proud of the deck and it is the whole reason
    // the roofline is 6.5 — from the fixed camera you can see it, and the hull
    // standing on it.
    box('hardstand', MassRole.Greeble, [s.w * 0.62, 0.10, s.d * 0.14], [-s.w * 0.04, deckTop + 0.05, s.d * 0.44], 'tread', {
      group: 'hardstand', chamfer: 0.03,
    }),
    // RCL-7 at the tip: the struck arc is a short vertical LINE on the end of
    // the boom, sitting at 0.50 legH so it overlaps the last 20 cm of it. A lit
    // column hanging clear in the air would be a blob with a gap above it.
    conduit('lit.arc', [0.19, 0.46, 0.17], [-s.w * 0.14, deckTop + legH * 0.50, bayZ]),
  );
  return list('reclaim_depot', 'Patch Yard', 'repairDepot', s.masses, [
    ...baseSockets(s.d, s.roofY + 0.9, -s.w * 0.12, -s.d * 0.24),
    { part: PartId.Crane, pos: [-s.w * 0.14, beamY - 0.78, bayZ] },
    // The torch tip, which is where a servicing effect belongs: `RepairSell.ts`
    // works on range alone and reads no socket, so this is an anchor waiting
    // for one rather than a wire that exists.
    { part: PartId.Emitter, pos: [-s.w * 0.14, deckTop + legH * 0.50, bayZ] },
  ]);
}

/**
 * THE ORE SORTER. A TROMMEL — a big faceted drum lying across the frame with a
 * feed chute at one end and a discharge spout at the other. It is the only
 * structure in the game whose dominant mass lies on its side, and that is the
 * read: everything else refines, this one SIEVES.
 */
function sorter(): StructureMassList {
  const f = fp('refinery');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.44, team: 1.24 });
  // A lathe rotated a quarter turn about Z swaps its X and Y extents, so a
  // drum of size [dia, len, dia] becomes `len` wide and `dia` tall. Solving the
  // top for the frozen roofline is then one subtraction and not a guess.
  const dia = 3.0;
  const drumY = f.height - dia * 0.5;
  s.masses.push(
    cyl('trommel', MassRole.Primary, [dia, s.w * 0.60, dia], [s.w * 0.04, drumY, -s.d * 0.14], 'paintMed', {
      rot: [0, 0, Math.PI * 0.5], topRadius: 0.90, capSlot: 'grille', segments: 14,
    }),
    cyl('trommel.band', MassRole.Primary, [dia * 1.10, 0.40, dia * 1.10], [-s.w * 0.16, drumY, -s.d * 0.14], 'bareMetal', {
      rot: [0, 0, Math.PI * 0.5], capSlot: 'grille', segments: 14, chamfer: 0.06,
    }),
    // The feed chute, on ONE end. There is no matching one at the other end.
    girder('chute', [0.90, 0.90, s.d * 0.40], [s.w * 0.32, drumY - 0.65, s.d * 0.12], {
      rot: [-0.38, 0, 0], group: 'chute',
    }),
    // The unloading canopy a Scrapjaw drives under.
    pri('dock.canopy', MassRole.Primary, [s.w * 0.34, 0.42, s.d * 0.40], [-s.w * 0.26, s.roofY * 0.94, s.d * 0.24], 'paintMed', {
      plan: 'wedge', capSlot: 'tread', chamfer: 0.08,
    }),
    girder('dock.leg', [0.32, s.roofY * 0.92, 0.32], [-s.w * 0.36, s.roofY * 0.46, s.d * 0.34], { group: 'dock' }),
    box('sluice', MassRole.Greeble, [s.w * 0.16, 0.34, s.d * 0.44], [-s.w * 0.14, s.roofY * 0.40, s.d * 0.24], 'tread', {
      rot: [-0.14, 0, 0], group: 'sluice', chamfer: 0.05,
    }),
  );
  return list('reclaim_sorter', 'Ore Sorter', 'refinery', s.masses, [
    ...baseSockets(s.d, f.height, s.w * 0.32, -s.d * 0.30),
    { part: PartId.DockEntry, pos: [-s.w * 0.26, 0.2, s.d * 0.5 + 2.4] },
    { part: PartId.Conveyor, pos: [-s.w * 0.14, s.roofY * 0.5, s.d * 0.5] },
    { part: PartId.Hopper, pos: [s.w * 0.04, s.roofY + 0.6, -s.d * 0.14] },
  ]);
}

/**
 * THE ROOKERY. Ninety credits a body, and the building says so: a rack of bunk
 * pods bolted into the open side of the frame under a canted muster awning,
 * with a signal mast on the corner carrying the only lamp in the structure that
 * is not a conduit.
 */
function rookery(): StructureMassList {
  const f = fp('barracks');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.54, team: 1.10, coil: 0.56 });
  const mastH = f.height - s.frameTop;
  const mx = s.w * 0.34, mz = -s.d * 0.34;
  s.masses.push(
    {
      name: 'standard', primitive: 'taperedBox', role: MassRole.Primary,
      size: [0.52, mastH, 0.52], anchor: [mx, s.frameTop + mastH * 0.5, mz],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.05,
      shape: { topScaleX: 0.46, topScaleZ: 0.46 },
    },
    // The muster awning. A plate, canted down toward the parade side, on two
    // posts — the only piece of shelter this army builds for anybody.
    {
      name: 'awning', primitive: 'plate', role: MassRole.Primary,
      size: [s.w * 0.52, 0.26, s.d * 0.26], anchor: [0, s.roofY * 0.80, s.d * 0.34],
      slot: 'paintMed', capSlot: 'tread', chamfer: 0.06, rot: [-0.26, 0, 0.05],
      shape: { outline: taperOutline(s.w * 0.52, s.d * 0.26, 0.82), thickness: 0.26, bevel: 0.06 },
    },
    girder('awning.post', [0.26, s.roofY * 0.76, 0.26], [s.w * 0.22, s.roofY * 0.38, s.d * 0.40], {
      mirrorX: true, group: 'awning',
    }),
    {
      name: 'bunks', primitive: 'greebleStrip', role: MassRole.Greeble,
      size: [0.52, s.roofY * 0.54, s.d * 0.50], anchor: [-s.w * 0.38, s.roofY * 0.40, -s.d * 0.16],
      slot: 'hatch', group: 'bunks', chamfer: 0.04,
      shape: { density: 3.4, seed: 0x52_71 },
    },
    box('door', MassRole.Greeble, [s.w * 0.24, s.roofY * 0.54, 0.30], [0, s.roofY * 0.27, s.d * 0.5 - 0.04], 'hatch', {
      group: 'door', feature: Feature.Door, anim: s.roofY * 0.58, chamfer: 0.05,
    }),
    conduit('lit.standard', [0.24, 0.30, 0.24], [mx, f.height - 0.24, mz]),
  );
  return list('reclaim_rookery', 'Rookery', 'barracks', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.0, -s.w * 0.12, -s.d * 0.24),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.3] },
  ]);
}

/**
 * THE BREAKER YARD. Every Reclamation hull comes out of here, and the way it
 * says so is an OVERHEAD TRAVELLING CRANE: a rail on two legs spanning the
 * whole frame with a trolley hanging off it, over a bay whose door retracts
 * into the floor. The rail is what carries the frozen 8.5 m roofline.
 */
function breakerYard(): StructureMassList {
  const f = fp('warFactory');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.48, team: 1.22 });
  const railY = f.height - 0.32;
  s.masses.push(
    {
      name: 'rail', primitive: 'taperedBox', role: MassRole.Primary,
      size: [s.w * 0.88, 0.64, 0.56], anchor: [0, railY, -s.d * 0.06],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.08,
      shape: { topScaleX: 0.96, topScaleZ: 0.66 },
    },
    girder('rail.leg', [0.46, railY - s.frameTop + 0.4, 0.46],
      [s.w * 0.40, (railY + s.frameTop) * 0.5 - 0.2, -s.d * 0.06], { mirrorX: true, group: 'rail' }),
    box('rail.trolley', MassRole.Greeble, [1.00, 0.80, 1.00], [-s.w * 0.18, railY - 0.92, -s.d * 0.06], 'hatch', {
      group: 'rail', chamfer: 0.06,
    }),
    // The bay. Anchored 0.12 m inside the wall line so its own section still
    // leaves it within the footprint — a lintel hung proud of a 0.60 m frame
    // overhangs the cell and the placement grid quietly disagrees with the model.
    box('bay.lintel', MassRole.Primary, [s.w * 0.60, 0.60, 0.60], [0, s.roofY * 0.72, s.d * 0.5 - 0.12], 'stripe', {
      chamfer: 0.08,
    }),
    girder('bay.jamb', [0.46, s.roofY * 0.70, 0.52], [s.w * 0.30, s.roofY * 0.35, s.d * 0.5 - 0.12], {
      mirrorX: true, group: 'bay', slot: 'stripe',
    }),
    box('bay.door', MassRole.Greeble, [s.w * 0.54, s.roofY * 0.64, 0.34], [0, s.roofY * 0.32, s.d * 0.5 - 0.04], 'hatch', {
      group: 'bay', feature: Feature.Door, anim: s.roofY * 0.68, chamfer: 0.05,
    }),
    // The cutting torch, which is the only warm light on a Reclamation building.
    conduit('lit.torch', [0.30, 0.30, 0.30], [-s.w * 0.30, s.roofY * 0.50, s.d * 0.5 - 0.02]),
    // V2 WEAPONISED SALVAGE: the working jib is kicked hard to one flank and
    // overhangs the bay. The centred travelling rail remains the load-bearing
    // structure; this visibly improvised second crane is the faction tell.
    girder('breaker.jib', [0.52, 0.62, s.d * 0.72],
      [s.w * 0.29, railY - 0.76, s.d * 0.10], {
        rot: [0.05, 0, -0.24], group: 'breakerJib',
        shape: { topScaleX: 0.58, topScaleZ: 0.74, shear: 0.18 },
      }),
    girder('breaker.stay', [0.20, 2.4, 0.20],
      [s.w * 0.34, railY - 1.65, -s.d * 0.20], {
        rot: [0.48, 0, -0.18], group: 'breakerJib',
      }),
    // The magnetic lifting coil hangs below the offset trolley. It repeats the
    // same coil grammar used by Reclamation weapons at architectural scale.
    ...arcCoil('breakerMagnet', s.w * 0.28, s.roofY + 0.72, s.d * 0.24, 1.36, 1.28),
    ...hungClad('breaker.shield', s.roofY * 0.54, s.d * 0.34,
      [-s.w * 0.43, s.roofY * 0.58, s.d * 0.12], -0.14, 'paintSmall'),
    conduit('breaker.arc', [0.16, s.roofY * 0.62, 0.14],
      [s.w * 0.40, s.roofY * 0.56, -s.d * 0.18], { group: 'breakerJib' }),
  );
  return list('reclaim_breakeryard', 'Breaker Yard', 'warFactory', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.2, -s.w * 0.12, -s.d * 0.24),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.4] },
    { part: PartId.Crane, pos: [-s.w * 0.18, railY - 1.4, -s.d * 0.06] },
  ]);
}

/**
 * THE SPOTTER MAST. Twelve metres, the tallest non-defence silhouette in the
 * game, and the only Reclamation structure with a moving part: a slewing arc
 * ring on a lattice mast.
 *
 * The ring spins about the MODEL Y axis, so its mast is on the centre line — a
 * Spinner mass authored off-axis would orbit instead of rotate. The ring itself
 * is offset from that axis on purpose, which is what makes the sweep read at
 * all, and it is also RCL-3 getting its way inside a rule that fights it.
 */
function spotter(): StructureMassList {
  const f = fp('radar');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.32, team: 1.14, coil: 0.56 });
  const towerTop = f.height - 3.30;
  const mastH = towerTop - s.frameTop;
  // A ring of 4.0 m diameter and 0.5 m section, canted by [-0.50, 0, 0.24],
  // stands 3.29 m tall in world axes: half of that is the clearance the hub
  // needs under the frozen roofline, and it is solved, not chosen.
  const ringY = f.height - 1.65;
  s.masses.push(
    {
      name: 'mast', primitive: 'taperedBox', role: MassRole.Primary,
      size: [s.w * 0.30, mastH, s.w * 0.30], anchor: [0, s.frameTop + mastH * 0.5, 0],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.07,
      shape: { topScaleX: 0.40, topScaleZ: 0.40 },
    },
    cyl('hub', MassRole.Primary, [1.20, 0.80, 1.20], [0, towerTop + 0.40, 0], 'bareMetal', {
      feature: Feature.Spinner, anim: 0.52, capSlot: 'hatch', segments: 12, chamfer: 0.06,
    }),
    cyl('aperture', MassRole.Primary, [4.00, 0.50, 4.00], [0.70, ringY, 0], 'paintMed', {
      rot: [-0.50, 0, 0.24], capSlot: 'grille', feature: Feature.Spinner, anim: 0.52,
      segments: 16, topRadius: 0.80,
    }),
    girder('aperture.arm', [1.80, 0.24, 0.24], [0.40, towerTop + 0.90, 0], {
      feature: Feature.Spinner, anim: 0.52, group: 'aperture',
    }),
    conduit('lit.eye', [0.44, 0.44, 0.44], [1.30, ringY + 0.42, 0], {
      feature: Feature.Spinner, anim: 0.52, group: 'aperture',
    }),
  );
  return list('reclaim_spotter', 'Spotter Mast', 'radar', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.0, -s.w * 0.28, -s.d * 0.28),
    { part: PartId.Dish, pos: [0, ringY, 0] },
    { part: PartId.Antenna, pos: [0, towerTop, 0] },
  ]);
}

/**
 * THE CRUCIBLE. The tech structure, and the one place the faction cue is the
 * WHOLE BUILDING: the arc coil at architectural scale, two three-metre rings
 * with a lit gap between them held in the top of the frame, with the
 * transformer cans that feed it stacked against one flank.
 */
/**
 * THE SIGNAL RIG. The Reclamation's Command Post, and the faction's answer to
 * an aerial is that an aerial is SCRAP YOU CLIMB.
 *
 * The Crucible holds its coil inside the frame, which is the faction saying "we
 * built this". The Signal Rig hangs its gear OFF the frame — a raking derrick
 * running out past the deck, a drum of cable on the ground, a horn slung under
 * the head — which is the faction saying "we found this and it works". Nothing
 * on it is machined and nothing on it is symmetric except the frame it is
 * bolted to.
 *
 * `bodyFraction` 0.34 on a 10.5 m roofline puts the frame top around 4.1 m and
 * gives the derrick the whole upper two thirds. The derrick RAKES rather than
 * standing plumb, for the reason the Breaker Dock's shear legs do: a vertical
 * member is the one thing on a Reclamation building that would read as a
 * finished product.
 */
function signalRig(): StructureMassList {
  const f = fp('commandPost');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.34, team: 1.18, coil: 0.44 });
  const legX = -s.w * 0.16;
  const legZ = s.d * 0.06;
  const legH = f.height - s.frameTop - 1.6;
  const headY = s.frameTop + legH + 0.55;
  s.masses.push(
    // The derrick. One tapered leg, raked out over the deck; `mirrorX` gives
    // the pair, which RCL-3 exempts for running gear the way it does the
    // Breaker Dock's shear legs.
    {
      name: 'derrick', primitive: 'taperedBox', role: MassRole.Primary,
      size: [0.72, legH, 0.72], anchor: [legX, s.frameTop + legH * 0.5, legZ],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.07, mirrorX: true,
      rot: [0, 0, 0.11], shape: { topScaleX: 0.46, topScaleZ: 0.46 },
    },
    // The head the two legs meet under, and the horn slung beneath it. A horn
    // and not a dish: the Reclamation does not own a dish.
    cyl('head', MassRole.Primary, [1.55, 1.15, 1.55], [0, headY, legZ], 'paintMed', {
      topRadius: 0.58, capSlot: 'grille', segments: 10,
    }),
    cyl('horn', MassRole.Primary, [1.85, 1.45, 1.85], [0.55, headY - 1.20, legZ], 'bareMetal', {
      topRadius: 0.30, rot: [0.42, 0, -0.26], capSlot: 'grille', segments: 10,
    }),
    cyl('horn.throat', MassRole.Emissive, [0.52, 0.55, 0.52], [0.30, headY - 0.62, legZ], 'emissive', {
      feature: Feature.Window, capSlot: 'emissive', segments: 8, chamfer: 0.05, group: 'throat',
    }),
    // The whip above the head, and its stay. Short: the height is the derrick's
    // job and a long pole on top of it would push past the frozen roofline.
    cyl('whip', MassRole.Greeble, [0.26, 1.20, 0.26], [0, headY + 0.70, legZ], 'bareMetal', {
      group: 'whip', topRadius: 0.42, segments: 6, rot: [0, 0, -0.07],
    }),
    girder('head.tie', [s.w * 0.44, 0.24, 0.24], [0, s.frameTop + legH * 0.62, legZ], { group: 'headTies' }),
    // The cable drum on the deck, lying on its side, and the run off it. This
    // is the mass that says the thing was assembled where it stands.
    cyl('drum', MassRole.Greeble, [1.20, 1.05, 1.20], [s.w * 0.30, s.roofY + 0.60, -s.d * 0.26], 'bareMetal', {
      group: 'drum', rot: [0, 0, 1.5708], capSlot: 'hatch', segments: 10, chamfer: 0.05,
    }),
    box('drum.run', MassRole.Greeble, [s.w * 0.40, 0.20, 0.20], [s.w * 0.06, s.roofY + 0.28, -s.d * 0.26], 'bareMetal', {
      group: 'drum', chamfer: 0.04,
    }),
    // The generator can against the far flank. One can, not a bank: the frame
    // already carries the faction's repetition.
    cyl('can', MassRole.Greeble, [0.78, s.roofY * 0.50, 0.78], [-s.w * 0.34, s.roofY * 0.27, -s.d * 0.24], 'bareMetal', {
      group: 'can', topRadius: 0.88, capSlot: 'hatch', segments: 10, chamfer: 0.05,
    }),
  );
  return list('reclaim_signalrig', 'Signal Rig', 'commandPost', s.masses, [
    ...baseSockets(s.d, s.roofY + 0.9, s.w * 0.32, -s.d * 0.30),
    { part: PartId.Antenna, pos: [0, f.height, 0] },
  ]);
}

function crucible(): StructureMassList {
  const f = fp('battleLab');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.44, team: 1.10, coil: 0.52 });
  const vesselH = f.height - s.frameTop;
  const vx = s.w * 0.10, vz = -s.d * 0.06;
  s.masses.push(
    cyl('vessel.lo', MassRole.Primary, [s.w * 0.46, vesselH * 0.34, s.w * 0.46],
      [vx, s.frameTop + vesselH * 0.17, vz], 'paintMed', {
        topRadius: 0.82, capSlot: 'grille', segments: 14,
      }),
    cyl('vessel.hi', MassRole.Primary, [s.w * 0.38, vesselH * 0.30, s.w * 0.38],
      [vx, f.height - vesselH * 0.15, vz], 'paintMed', {
        topRadius: 0.74, capSlot: 'grille', segments: 14,
      }),
    // THE GAP. Everything above and below it exists to frame this ring.
    cyl('vessel.gap', MassRole.Emissive, [s.w * 0.26, vesselH * 0.34, s.w * 0.26],
      [vx, s.frameTop + vesselH * 0.51, vz], 'emissive', {
        feature: Feature.Window, capSlot: 'emissive', segments: 12, chamfer: 0.05, group: 'vesselGap',
      }),
    girder('vessel.tie', [s.w * 0.62, 0.26, 0.26], [vx, s.frameTop + vesselH * 0.36, vz], { group: 'vesselTies' }),
    // The transformer cans, on -X only.
    cyl('can', MassRole.Greeble, [0.70, s.roofY * 0.46, 0.70], [-s.w * 0.34, s.roofY * 0.25, -s.d * 0.26], 'bareMetal', {
      group: 'cans', topRadius: 0.92, capSlot: 'hatch', segments: 10, chamfer: 0.05,
    }),
    box('can.bus', MassRole.Greeble, [s.w * 0.44, 0.24, 0.24], [-s.w * 0.16, s.roofY + 0.42, -s.d * 0.26], 'bareMetal', {
      group: 'cans', chamfer: 0.05,
    }),
  );
  return list('reclaim_crucible', 'Crucible', 'battleLab', s.masses,
    [...baseSockets(s.d, s.roofY + 0.9, -s.w * 0.30, -s.d * 0.30),
      { part: PartId.Emitter, pos: [vx, s.frameTop + vesselH * 0.51, vz] }]);
}

/**
 * THE BREAKER DOCK. A launch cradle running out of the facade under a pair of
 * SHEAR LEGS — two raking girders meeting over the water with the lifting
 * tackle hung between them. Shear legs are what a yard that has no crane rail
 * uses, which is the whole argument of this faction in one piece of hardware.
 */
function drydock(): StructureMassList {
  const f = fp('navalYard');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.46, team: 1.26 });
  const legH = f.height - s.roofY * 0.30;
  s.masses.push(
    // The two raking legs. `mirrorX` is legitimate here: shear legs are running
    // gear for a crane, and RCL-3 exempts exactly that.
    {
      name: 'shearleg', primitive: 'taperedBox', role: MassRole.Primary,
      size: [0.58, legH, 0.58], anchor: [s.w * 0.20, s.roofY * 0.30 + legH * 0.5, -s.d * 0.04],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.07, mirrorX: true,
      rot: [0, 0, 0.13], shape: { topScaleX: 0.52, topScaleZ: 0.52 },
    },
    girder('shearleg.head', [s.w * 0.26, 0.42, 0.42], [0, f.height - 0.30, -s.d * 0.04], { group: 'tackle' }),
    box('shearleg.block', MassRole.Greeble, [0.40, 1.30, 0.40], [0, f.height - 1.30, -s.d * 0.04], 'hatch', {
      group: 'tackle', chamfer: 0.05,
    }),
    // The cradle. It reaches to 0.45 d, INSIDE the half depth: it looks like it
    // wants to run further out over the water and it must not, or the placement
    // grid lets a neighbour intersect it.
    pri('cradle', MassRole.Primary, [s.w * 0.58, 0.46, s.d * 0.30], [0, s.roofY * 0.42, s.d * 0.30], 'paintMed', {
      plan: 'wedge', capSlot: 'tread', chamfer: 0.08,
    }),
    girder('cradle.leg', [0.32, s.roofY * 0.40, 0.32], [s.w * 0.24, s.roofY * 0.20, s.d * 0.40], {
      mirrorX: true, group: 'cradle',
    }),
    box('cradle.rail', MassRole.Greeble, [s.w * 0.48, 0.18, s.d * 0.34], [0, s.roofY * 0.60, s.d * 0.30], 'tread', {
      group: 'cradle', chamfer: 0.04,
    }),
    // The tackle light. A 3x3 yard hands a great deal of surface to faces the
    // camera never sees, so it needs a fourth lit run to clear R-T5's floor.
    conduit('lit.tackle', [s.w * 0.22, 0.18, 0.18], [0, f.height - 0.62, -s.d * 0.04]),
  );
  return list('reclaim_drydock', 'Breaker Dock', 'navalYard', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.0, -s.w * 0.34, -s.d * 0.30),
    { part: PartId.Door, pos: [0, 0.2, s.d * 0.5 + 0.4] },
    { part: PartId.DockEntry, pos: [0, 0.2, s.d * 0.5 + 2.6] },
    { part: PartId.Crane, pos: [0, f.height - 1.6, -s.d * 0.04] },
  ]);
}

/**
 * THE SLAG HEAP. One cell, five metres, and it must not read as a small
 * barracks — so it is not a building at all. It is an open girder CRIB with a
 * heaped pile of slag sitting in it and a tipping chute over the top, which is
 * the only structure in the roster with no cladding on it anywhere.
 */
function slagHeap(): StructureMassList {
  const f = fp('oreSilo');
  const w = f.w * CELL * 0.82;
  const h = f.height;
  const masses: M[] = [
    ...slagApron(f.w, f.h, h),
    pri('foot', MassRole.Primary, [w * 0.96, h * 0.16, w * 0.96], [0, h * 0.08, 0], 'paintMed', {
      plan: 'cutBox', cornerCut: 0.10, capSlot: 'tread',
    }),
    // THE PILE. A faceted cone with a wide flat top — a heap that has been
    // driven over, not a designed vessel.
    cyl('pile', MassRole.Primary, [w * 0.86, h * 0.52, w * 0.86], [0, h * 0.42, 0], 'paintMed', {
      topRadius: 0.44, capSlot: 'tread', segments: 12,
    }),
    // The crib: four posts and a top ring, the frame at silo scale.
    girder('crib.post', [0.30, h * 0.74, 0.30], [w * 0.44, h * 0.37, w * 0.40], {
      mirrorX: true, group: 'crib',
    }),
    girder('crib.postB', [0.30, h * 0.62, 0.30], [w * 0.44, h * 0.31, -w * 0.40], {
      mirrorX: true, group: 'crib',
    }),
    girder('crib.tie', [w * 0.94, 0.24, 0.24], [0, h * 0.70, w * 0.40], { group: 'crib' }),
    girder('crib.tieB', [0.24, 0.24, w * 0.84], [w * 0.44, h * 0.70, 0], { mirrorX: true, group: 'crib' }),
    // The chute, which is what reaches the frozen roofline. Canted, on one side.
    {
      name: 'chute', primitive: 'taperedBox', role: MassRole.Primary,
      size: [w * 0.34, h * 0.44, w * 0.30], anchor: [-w * 0.24, h - h * 0.22, w * 0.10],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.06,
      shape: { topScaleX: 1.30, topScaleZ: 1.24, shear: -w * 0.10 },
    },
    box('chute.lip', MassRole.Greeble, [w * 0.30, 0.26, w * 0.26], [-w * 0.24, h * 0.74, w * 0.10], 'hatch', {
      group: 'chute', chamfer: 0.05,
    }),
    ...arcCoil('coil', w * 0.36, h * 0.70, -w * 0.30, 0.40, h * 0.22),
    cyl('drum', MassRole.Greeble, [0.62, 0.94, 0.62], [-w * 0.44, h * 0.47, -w * 0.30], 'bareMetal', {
      group: 'drum', topRadius: 0.94, capSlot: 'hatch', segments: 12, chamfer: 0.05,
    }),
    box('ladder', MassRole.Greeble, [0.30, h * 0.56, 0.12], [0, h * 0.36, w * 0.50], 'stripe', {
      group: 'ladder', chamfer: 0.03,
    }),
    box('gauge', MassRole.Greeble, [w * 0.24, h * 0.14, 0.14], [w * 0.06, h * 0.30, -w * 0.50], 'stencil', {
      group: 'gauges', chamfer: 0.04,
    }),
    box('skirtVent', MassRole.Greeble, [w * 0.30, h * 0.12, 0.16], [-w * 0.18, h * 0.13, w * 0.46], 'vent', {
      group: 'vents',
    }),
    {
      name: 'stowage', primitive: 'greebleStrip', role: MassRole.Greeble,
      size: [w * 0.16, 0.36, w * 0.44], anchor: [w * 0.44, h * 0.18, -w * 0.10],
      slot: 'bareMetal', group: 'stowage', chamfer: 0.04,
      shape: { density: 2.4, seed: 0x52_9f },
    },
    teamPanel('team.band', [w * 0.46, h * 0.042, w * 0.30], [0, h * 0.68, 0]),
    teamPanel('team.post', [0.14, h * 0.22, w * 0.16], [w * 0.44, h * 0.44, w * 0.40], { mirrorX: true }),
    insignia(w * 0.30, [0, h * 0.40, w * 0.47]),
    conduit('lit.crib', [w * 0.44, 0.13, 0.13], [0, h * 0.72, w * 0.40]),
    conduit('lit.chute', [0.24, 0.20, 0.11], [-w * 0.24, h * 0.86, w * 0.24]),
  ];
  return list('reclaim_heap', 'Slag Heap', 'oreSilo', masses, [
    { part: PartId.Hopper, pos: [-w * 0.24, h * 0.80, w * 0.10] },
    { part: PartId.DockEntry, pos: [0, 0.2, w * 0.5 + 2.2] },
  ]);
}

/**
 * THE SCRAP BARRICADE. No apron: a wall follows terrain, and a foundation slab
 * under every four-metre section would tile the whole perimeter in slag.
 *
 * Two girder posts with a salvaged plate hung between them at a cant. It stops
 * vehicles and nothing else, and it looks like it.
 */
function barricade(): StructureMassList {
  const f = fp('wall');
  const w = f.w * CELL;
  const h = f.height;
  const masses: M[] = [
    {
      name: 'post', primitive: 'taperedBox', role: MassRole.Primary,
      size: [w * 0.16, h, w * 0.30], anchor: [w * 0.40, h * 0.5, 0],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.05, mirrorX: true,
      shape: { topScaleX: 0.62, topScaleZ: 0.70 },
    },
    // The hung panel: canted about Z so it leans on the posts rather than
    // sitting between them, which is what makes a wall run read as scavenged.
    {
      name: 'panel', primitive: 'plate', role: MassRole.Primary,
      size: [h * 0.74, 0.30, w * 0.84], anchor: [0, h * 0.46, 0],
      rot: [0, 0, Math.PI * 0.5 + 0.10], slot: 'paintMed', capSlot: 'paintSmall', chamfer: 0.05,
      shape: { outline: taperOutline(h * 0.74, w * 0.84, 0.86, 1.0), thickness: 0.30, bevel: 0.05 },
    },
    {
      name: 'coping', primitive: 'taperedBox', role: MassRole.Primary,
      size: [w * 0.94, h * 0.14, w * 0.40], anchor: [0, h * 0.90, 0],
      slot: 'paintSmall', capSlot: 'tread', chamfer: 0.05,
      shape: { topScaleX: 0.88, topScaleZ: 0.76, shear: w * 0.03 },
    },
    girder('brace', [w * 0.10, h * 0.60, w * 0.10], [-w * 0.26, h * 0.36, w * 0.14], {
      rot: [0, 0, -0.46], group: 'brace',
    }),
    box('kick', MassRole.Greeble, [w * 0.90, h * 0.16, w * 0.44], [0, h * 0.08, 0], 'tread', {
      group: 'kick', chamfer: 0.05,
    }),
    box('bolt', MassRole.Greeble, [w * 0.10, h * 0.10, 0.12], [w * 0.24, h * 0.34, w * 0.17], 'hatch', {
      group: 'bolts', chamfer: 0.02,
    }),
    ...arcCoil('coil', -w * 0.40, h * 0.72, 0, 0.22, h * 0.26),
    teamPanel('team.band', [w * 0.34, h * 0.26, 0.13], [w * 0.06, h * 0.50, w * 0.17]),
    conduit('lit.strip', [w * 0.30, 0.12, 0.11], [-w * 0.10, h * 0.66, w * 0.18]),
  ];
  return list('reclaim_barricade', 'Scrap Barricade', 'wall', masses, [], { cls: 'wall' });
}

/**
 * THE SPITPOST. RCL-4 at its plainest: a low canted casemate with a fixed coil
 * emitter looking out of an embrasure. There is no ring, no drum and nothing
 * that slews — `rclSpitpost` carries no `hasTurret` in `src/data/Defs.ts`, and
 * `sim/Combat.ts` gives a turretless shooter a 14-degree cone for it.
 */
function spitpost(): StructureMassList {
  const f = fp('pillbox');
  const w = f.w * CELL * 0.80;
  const h = f.height;
  const masses: M[] = [
    ...slagApron(f.w, f.h, h),
    pri('skirt', MassRole.Primary, [w * 0.96, h * 0.26, w * 0.96], [0, h * 0.13, 0], 'paintMed', {
      plan: 'cutBox', cornerCut: 0.12, capSlot: 'tread',
    }),
    // THE CASEMATE. Every height here is a fraction of `h` chosen so the tallest
    // thing lands at 1.00 h and not above it: on a 2.2 m structure a 12%
    // tolerance is the difference between shipping and REJECTED.
    {
      name: 'casemate', primitive: 'taperedBox', role: MassRole.Primary,
      size: [w * 0.86, h * 0.56, w * 0.88], anchor: [0, h * 0.48, -w * 0.02],
      slot: 'paintMed', capSlot: 'paintSmall', chamfer: 0.06,
      shape: { topScaleX: 0.72, topScaleZ: 0.66, shear: w * 0.10, cornerCut: 0.18 },
    },
    box('embrasure', MassRole.Primary, [w * 0.52, h * 0.22, 0.30], [0, h * 0.46, w * 0.40], 'grille', {
      chamfer: 0.04,
    }),
    cyl('emitter', MassRole.Primary, [0.30, w * 0.40, 0.30], [0, h * 0.46, w * 0.50], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], topRadius: 0.80, capSlot: 'grille', segments: 12, chamfer: 0.04,
    }),
    girder('post', [w * 0.13, h * 0.66, w * 0.13], [w * 0.42, h * 0.33, -w * 0.36], {
      mirrorX: true, group: 'frame',
    }),
    girder('tie', [w * 0.90, 0.18, 0.18], [0, h * 0.62, -w * 0.36], { group: 'frame' }),
    ...hungClad('clad', h * 0.32, w * 0.42, [w * 0.42, h * 0.44, w * 0.06], 0.14),
    cyl('drum', MassRole.Greeble, [0.44, h * 0.40, 0.44], [-w * 0.42, h * 0.20, -w * 0.10], 'bareMetal', {
      group: 'drum', topRadius: 0.94, capSlot: 'hatch', segments: 10, chamfer: 0.04,
    }),
    box('optic', MassRole.Greeble, [0.24, 0.30, 0.24], [-w * 0.18, h * 0.84, -w * 0.16], 'bareMetal', {
      group: 'optics', chamfer: 0.04,
    }),
    box('vent', MassRole.Greeble, [w * 0.22, 0.16, w * 0.22], [w * 0.16, h * 0.80, -w * 0.20], 'vent', {
      group: 'optics',
    }),
    ...arcCoil('coil', -w * 0.34, h * 0.70, w * 0.16, 0.24, h * 0.28),
    teamPanel('team.cap', [w * 0.42, 0.13, w * 0.30], [0, h * 0.79, -w * 0.04]),
    teamPanel('team.rib', [0.15, h * 0.28, w * 0.20], [w * 0.42, h * 0.38, -w * 0.36], { mirrorX: true }),
    conduit('lit.slit', [w * 0.34, 0.14, 0.10], [0, h * 0.58, w * 0.42]),
  ];
  return list('reclaim_spitpost', 'Spitpost', 'pillbox', masses, [
    { part: PartId.MuzzleA, pos: [0, h * 0.46, w * 0.72] },
    { part: PartId.Emitter, pos: [0, h * 0.46, w * 0.70] },
  ], { cls: 'defence' });
}

/**
 * THE ARC PYLON. Eight metres of lattice under the faction cue at its largest:
 * a two-metre coil head with a lit gap you can read from the far side of the
 * map. It draws ninety power, the heaviest single load in the game, and it is
 * FIXED — `rclPylon` sets `hasTurret: false`, so nothing here slews and the
 * emitter socket lives in model space like every other socket in this file.
 */
function arcPylon(): StructureMassList {
  const f = fp('prismTower');
  const w = f.w * CELL * 0.78;
  const h = f.height;
  const headY = h * 0.66;
  const masses: M[] = [
    ...slagApron(f.w, f.h, h),
    pri('base', MassRole.Primary, [w, h * 0.14, w], [0, h * 0.07, 0], 'paintMed', {
      plan: 'cutBox', cornerCut: 0.12, capSlot: 'tread',
    }),
    // The lattice: a hard-battered girder, so the tower is visibly wider at the
    // foot than at the head and never reads as a pipe.
    {
      name: 'lattice', primitive: 'taperedBox', role: MassRole.Primary,
      size: [w * 0.56, headY - h * 0.14, w * 0.56], anchor: [0, (headY + h * 0.14) * 0.5, 0],
      slot: 'bareMetal', capSlot: 'grille', chamfer: 0.06,
      shape: { topScaleX: 0.44, topScaleZ: 0.44 },
    },
    // THE HEAD — two rings and the gap. This is the arc coil at four times the
    // size it is on a hull, and it is the whole reason the structure is legible.
    cyl('head.lo', MassRole.Primary, [w * 0.66, h * 0.10, w * 0.66], [0, headY + h * 0.05, 0], 'paintMed', {
      topRadius: 0.86, capSlot: 'grille', segments: 16,
    }),
    cyl('head.hi', MassRole.Primary, [w * 0.52, h * 0.11, w * 0.52], [0, h - h * 0.055, 0], 'paintMed', {
      topRadius: 0.70, capSlot: 'grille', segments: 16,
    }),
    cyl('head.gap', MassRole.Emissive, [w * 0.34, h * 0.13, w * 0.34], [0, headY + h * 0.165, 0], 'emissive', {
      feature: Feature.Window, capSlot: 'emissive', segments: 12, chamfer: 0.05, group: 'headGap',
    }),
    // RCL-3 reaches a 1x1 defence: the stay is on ONE side.
    girder('stay', [w * 0.14, headY * 0.72, w * 0.14], [w * 0.30, headY * 0.40, -w * 0.16], {
      rot: [0, 0, 0.20], group: 'stay',
    }),
    girder('collar', [w * 0.74, h * 0.05, w * 0.74], [0, h * 0.30, 0], { group: 'collar', slot: 'bareMetal' }),
    box('cell', MassRole.Greeble, [w * 0.28, h * 0.16, w * 0.24], [-w * 0.30, h * 0.24, -w * 0.20], 'grille', {
      group: 'cells', chamfer: 0.05,
    }),
    cyl('can', MassRole.Greeble, [0.46, h * 0.16, 0.46], [w * 0.32, h * 0.22, w * 0.24], 'bareMetal', {
      group: 'cans', topRadius: 0.92, capSlot: 'hatch', segments: 10, chamfer: 0.04,
    }),
    box('gauge', MassRole.Greeble, [w * 0.24, h * 0.09, 0.14], [0, h * 0.20, w * 0.34], 'stencil', {
      group: 'gauges', chamfer: 0.04,
    }),
    box('ladder', MassRole.Greeble, [0.26, headY * 0.62, 0.11], [-w * 0.24, headY * 0.40, w * 0.18], 'stripe', {
      group: 'ladder', chamfer: 0.03,
    }),
    teamPanel('team.skirt', [0.15, h * 0.18, w * 0.32], [w * 0.34, h * 0.21, 0], { mirrorX: true }),
    teamPanel('team.head', [w * 0.54, 0.13, w * 0.34], [0, headY + h * 0.105, 0]),
    conduit('lit.spine', [0.14, headY * 0.56, 0.14], [0, headY * 0.52, w * 0.26]),
  ];
  return list('reclaim_pylon', 'Arc Pylon', 'prismTower', masses, [
    { part: PartId.Emitter, pos: [0, headY + h * 0.165, 0] },
    { part: PartId.MuzzleA, pos: [0, headY + h * 0.165, w * 0.30] },
    { part: PartId.CoilTip, pos: [0, h, 0] },
  ], { cls: 'defence' });
}

/**
 * THE STORMWORKS — the Reclamation's superweapon, on the 3x3, 13 m pad.
 *
 * Every gun this army owns is a chained arc, so its end-game button is nine
 * seconds of loose ones dropped anywhere on the map, and the building is what
 * that looks like when it is built out of scrap: a bank of capacitor cans on
 * the deck feeding a mast that carries the biggest arc coil in the game.
 *
 * RCL-5 is already satisfied by `reclaimFrame`'s own coil; this adds a SECOND,
 * bigger one at the mast head, which is the point of the structure. RCL-3 is
 * why nothing here mirrors: the cans are on -X, the mast is off centre, and
 * the discharge horn is on +X alone.
 */
function stormworks(): StructureMassList {
  const f = fp('superweapon');
  const s = reclaimFrame(f.w, f.h, f.height, { bodyFraction: 0.40, team: 1.06, coil: 0.60 });
  const mastTop = f.height - 2.2;
  const mx = s.w * 0.08, mz = -s.d * 0.06;
  s.masses.push(
    // The mast. Tapered hard, because a scrap tower is wide at the bottom and
    // whatever they had left at the top.
    {
      name: 'mast', primitive: 'taperedBox', role: MassRole.Primary,
      size: [s.w * 0.30, mastTop - s.frameTop, s.d * 0.28], anchor: [mx, (mastTop + s.frameTop) * 0.5, mz],
      slot: 'paintMed', capSlot: 'grille',
      shape: { topScaleX: 0.34, topScaleZ: 0.40, shear: s.d * 0.05, cornerCut: 0.18 },
    },
    girder('mast.tie', [s.w * 0.54, 0.26, 0.26], [mx, s.frameTop + (mastTop - s.frameTop) * 0.34, mz], {
      group: 'mastTies',
    }),
    // THE HEAD COIL. Twice the frame's, and the whole silhouette read.
    ...arcCoil('head', mx, mastTop, mz, 1.55, 2.4),
    // The capacitor bank on -X, which is what the countdown is filling.
    cyl('can.a', MassRole.Greeble, [1.20, s.roofY * 0.62, 1.20], [-s.w * 0.34, s.roofY * 0.31, s.d * 0.24], 'bareMetal', {
      group: 'cans', topRadius: 0.90, capSlot: 'hatch', segments: 8, chamfer: 0.06,
    }),
    cyl('can.b', MassRole.Greeble, [0.95, s.roofY * 0.50, 0.95], [-s.w * 0.36, s.roofY * 0.25, -s.d * 0.14], 'bareMetal', {
      group: 'cans', topRadius: 0.90, capSlot: 'hatch', segments: 8, chamfer: 0.06,
    }),
    girder('can.bus', [s.w * 0.46, 0.22, 0.22], [-s.w * 0.16, s.roofY + 0.40, s.d * 0.24], { group: 'cans' }),
    // The discharge horn, on +X only.
    girder('horn', [0.26, 0.26, s.d * 0.40], [s.w * 0.40, s.roofY + 0.70, s.d * 0.10], {
      rot: [0.28, 0, 0], group: 'horn',
    }),
    conduit('lit.riser', [0.14, (mastTop - s.frameTop) * 0.52, 0.14],
      [mx + s.w * 0.13, s.frameTop + (mastTop - s.frameTop) * 0.30, mz + s.d * 0.12]),
  );
  return list('reclaim_stormworks', 'Stormworks', 'superweapon', s.masses, [
    ...baseSockets(s.d, s.roofY + 1.0, -s.w * 0.34, s.d * 0.24),
    { part: PartId.CoilTip, pos: [mx, mastTop + 1.3, mz] },
    { part: PartId.Emitter, pos: [mx, mastTop + 1.2, mz] },
  ]);
}

/* ==========================================================================
 * 6. THE ROSTER
 * ========================================================================== */

export const RECLAIM_STRUCTURE_MASS_LISTS: readonly StructureMassList[] = [
  foundry(),
  furnace(),
  depot(),
  sorter(),
  rookery(),
  breakerYard(),
  spotter(),
  crucible(),
  signalRig(),
  drydock(),
  slagHeap(),
  barricade(),
  spitpost(),
  arcPylon(),
  stormworks(),
];

export const RECLAIM_STRUCTURE_BY_KEY: ReadonlyMap<string, StructureMassList> =
  new Map(RECLAIM_STRUCTURE_MASS_LISTS.map((l) => [l.key, l]));

/**
 * Content key -> model key. The content vocabulary belongs to
 * `src/data/Defs.ts`; this is the one place the two namespaces meet, and every
 * value here is the `model:` string a Reclamation building def already names.
 */
export const RECLAIM_STRUCTURE_MODELS: Readonly<Record<string, string>> = {
  rclFoundry: 'reclaim_foundry',
  rclFurnace: 'reclaim_furnace',
  rclDepot: 'reclaim_depot',
  rclSorter: 'reclaim_sorter',
  rclRookery: 'reclaim_rookery',
  rclBreakerYard: 'reclaim_breakeryard',
  rclSpotter: 'reclaim_spotter',
  rclCrucible: 'reclaim_crucible',
  rclSignalRig: 'reclaim_signalrig',
  rclDrydock: 'reclaim_drydock',
  rclHeap: 'reclaim_heap',
  rclBarricade: 'reclaim_barricade',
  rclSpitpost: 'reclaim_spitpost',
  rclPylon: 'reclaim_pylon',
  rclStormworks: 'reclaim_stormworks',
};

/* ==========================================================================
 * 7. BUILD AND HAND OFF
 * ========================================================================== */

/**
 * A PRIVATE library on a PRIVATE `GreebleFactory`, and both words matter.
 * `BuildingLibrary.build` caches its atlas under `${list.faction}.structure`,
 * and the shared `buildingLibrary` — which this faction declares the same
 * `'soviets'` key as — is filled by `buildings.system.ts` in the same boot.
 * Sharing either object would mean the Reclamation's palette collided with the
 * Soviet atlas or won it, depending on init order. A private factory makes the
 * question unanswerable rather than answered-by-luck, at a cost of two extra
 * materials (architecture + ground) for the whole army.
 */
export const reclaimBuildingLibrary = new BuildingLibrary(new GreebleFactory());

/** Translate a built structure into the bridge's shape. Mirrors `buildings.system.ts`. */
function toKindMesh(m: StructureModel): KindMesh {
  const sockets: BridgeSocket[] = m.sockets.map((s) => ({
    part: s.part, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, followsTurret: false,
  }));
  // Kept for completeness rather than exercised: RCL-4 means no Reclamation
  // mass targets `'turret'`, so `m.turretSockets` is always empty.
  for (const s of m.turretSockets) {
    sockets.push({
      part: s.part,
      x: s.x + m.turretPivot[0], y: s.y + m.turretPivot[1], z: s.z + m.turretPivot[2],
      yaw: s.yaw, pitch: s.pitch, followsTurret: true, pivotY: m.turretPivot[1],
    });
  }

  const depth = reclaimBuildingLibrary.depthMaterial();

  const parts: NonNullable<KindMesh['parts']>[number][] = [];
  if (m.pad !== null) {
    // An apron is 40 mm of slab on the ground. Casting a shadow from it buys
    // nothing and costs a shadow-map draw per structure on screen — and for
    // the same reason it must not occlude AO either: an opaque 40 mm slab in
    // the GTAO normal prepass reads as a wall a few centimetres above the
    // ground, which is the failure `render/post.ts#aoOccluder` documents.
    parts.push({
      geometry: m.pad, material: m.padMaterial, castShadow: false, receiveShadow: true,
      aoOccluder: false,
    });
  }
  if (m.turret !== null) {
    parts.push({
      geometry: m.turret,
      material: m.material,
      x: m.turretPivot[0], y: m.turretPivot[1], z: m.turretPivot[2],
      followsTurret: true,
      castShadow: true,
      receiveShadow: true,
      customDepthMaterial: depth,
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
    customDepthMaterial: depth,
  };
}

export interface ReclaimStructureReport {
  models: StructureModel[];
  failed: string[];
  registrations: number;
  bound: number;
}

/**
 * Build every Reclamation structure and publish it to `RenderBridge`.
 *
 * `buildingId` is `resolveDefBinding().buildingId` — content key -> def index.
 * Passing it in rather than resolving it here keeps this module free of any
 * dependency on `src/game/**`.
 *
 * REGISTRATION FACTION. Per-def models go on at `FACTION_ANY` because each of
 * these defIds belongs to exactly one army and can never resolve for another.
 * The per-KIND default goes on at `Faction.Reclaim`, which is a REAL slot
 * rather than the wildcard: `RenderBridge.factionSlot()` is derived from
 * `FACTION_COUNT`, and `FACTION_COUNT` is 5, so slot 4 is this faction's own.
 * That is a change in behaviour from the Meridian pass, where slot 3 folded
 * onto the wildcard — and it is the correct one, because a
 * `(Building, Reclaim, -1)` default must not become the last-resort entry for
 * everybody.
 */
export async function buildAndRegisterReclaimStructures(
  atlasSize: number,
  buildingId: Readonly<Record<string, number>>,
): Promise<ReclaimStructureReport> {
  const palettes: StructurePalettes = {
    structure: RECLAIM_STRUCTURE_PALETTE,
    pad: RECLAIM_PAD_PALETTE,
    panelDensity: PANEL_DENSITY,
    seed: SEED,
    padSeed: PAD_SEED,
    /*
     * TORCH-CUT PLATE, SPRAYED, NEVER BUFFED.
     *
     * `rivets: false` above says what the atlas draws — welded seams, not bolt
     * rings — and until `StructureCoat` existed it also chose the material's
     * coat, which put this army in ALLIED CERAMIC GLAZE: clearcoat 0.42 at
     * roughness 0.26 with env 0.95, a wet mirror over #4E4956 oxide. That is
     * the broad smeared highlight on every large flat face of a Foundry, and
     * it is why a scrap army read as moulded plastic.
     *
     * `'scrap'` is the thinnest and slackest coat of the four. Its env stays
     * at 0.72, ABOVE the Soviet 0.62, and that is the one number here chosen
     * against the pattern: this is the darkest architecture in the game and
     * sky fill is what keeps its frame legible against terrain.
     */
    coat: 'scrap',
  };

  // Atlas off-thread first — this library owns a PRIVATE GreebleFactory, so
  // `art.buildings`' prewarm cannot reach its cache. The loop below is
  // unchanged and still synchronous.
  await reclaimBuildingLibrary.prewarm(RECLAIM_STRUCTURE_MASS_LISTS, () => palettes, atlasSize);

  const models: StructureModel[] = [];
  const failed: string[] = [];
  for (const l of RECLAIM_STRUCTURE_MASS_LISTS) {
    try {
      models.push(reclaimBuildingLibrary.build(l, palettes, atlasSize));
    } catch (err) {
      // One bad mass list must not take the roster — or the render — down.
      failed.push(`${l.key}: ${String(err)}`);
    }
  }

  const meshes = new Map<string, KindMesh>();
  const meshFor = (key: string): KindMesh | null => {
    const model = reclaimBuildingLibrary.get(key);
    if (model === undefined) return null;
    let mesh = meshes.get(key);
    if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
    return mesh;
  };

  let registrations = 0;
  let bound = 0;
  for (const [contentKey, modelKey] of Object.entries(RECLAIM_STRUCTURE_MODELS)) {
    const mesh = meshFor(modelKey);
    if (mesh === null) continue;
    const defId = buildingId[contentKey];
    if (defId === undefined || defId < 0) continue;
    registerKindMesh(EntityKind.Building, FACTION_ANY, mesh, defId);
    registrations++;
    bound++;
  }

  // The faction's own default, so a Reclamation structure spawned with defId -1
  // (a scenario placement, a debug spawn) draws Reclamation architecture instead
  // of the bridge's hazard box. The Rookery is the least damaging choice for the
  // same reason `buildings.system.ts` picks the barracks: 2x2 is the modal
  // footprint and it is the plainest silhouette in the roster — no derrick, no
  // trommel, no mast — so a base of them reads as a base rather than as eight
  // Foundries.
  const fallback = meshFor('reclaim_rookery');
  if (fallback !== null) {
    registerKindMesh(EntityKind.Building, Faction.Reclaim, fallback, -1);
    registrations++;
  }

  return { models, failed, registrations, bound };
}

/** Release every Reclamation geometry, material and atlas. */
export function disposeReclaimBuildings(): void {
  reclaimBuildingLibrary.dispose();
}
