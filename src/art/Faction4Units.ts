/**
 * ============================================================================
 * src/art/Faction4Units.ts — THE RECLAMATION, AS UNIT ART
 * ============================================================================
 * The fourth army's eleven hulls, its unit palette, and the two calls that put
 * them on screen. Nothing here edits `MassList.ts`, `UnitFactory.ts`,
 * `Greeble.ts`, `Shapes.ts` or `UnitDefs.ts` — it imports them and adds beside
 * them, exactly as `Faction3Units.ts` does.
 *
 *
 * WHY THE RECLAMATION DOES NOT LOOK LIKE ANY OF THE OTHER THREE
 * -------------------------------------------------------------
 * Three armies already own three material languages: the Allies are a welded
 * ceramic monocoque on proud tracks, the Soviets are bolted plate on proud
 * tracks, and the Pact is a panelled octagonal shell on a hover plenum. All
 * three are CLOSED VOLUMES — a solid body with things attached to it. A fourth
 * closed volume, however it is faceted, lands between them and reads as "one of
 * the other ones from behind".
 *
 * So this faction is not a closed volume at all:
 *
 *   FRAME       Every hull is an EXPOSED BOX-GIRDER SPINE with cladding HUNG on
 *               it. The armour is a set of separate plates bolted to a visible
 *               chassis, not a skin, and there are real gaps between them. At
 *               40 m the other three read as objects and this one reads as a
 *               STRUCTURE — you can see through it.
 *
 *   STANCE      Nothing rides on tracks and nothing rides on a skirt. Paired
 *               road wheels hang OUTBOARD on canted swing arms, so there is
 *               daylight under every hull and the running gear is the widest
 *               thing in plan. The Allies and the Soviets stand on a shadow of
 *               track; the Pact stands on a shadow of skirt; this army stands
 *               on legs and casts almost none.
 *
 *   ASYMMETRY   THE loudest cue, and the one no other faction uses at all. The
 *               shared templates mirror everything (`mirrorX`); here the running
 *               gear and the structural ribs mirror and NOTHING ELSE DOES. One
 *               flank carries a slab of salvaged cladding and a grapple jib; the
 *               other is open frame with a fuel drum in it. A Reclamation column
 *               seen from the side does not match itself seen from the other
 *               side, which is a thing you notice before you can say why.
 *
 *   NO TURRET   Not one hull in the roster has a turret ring, because not one
 *               unit in `src/data/Defs.ts` has `hasTurret: true`. Every gun is
 *               a fixed CASEMATE in the front face of the superstructure. That
 *               is a mechanical decision first (`sim/Combat.ts` gives a
 *               turretless shooter a 14-degree cone instead of a turret's 5, and
 *               pins its `turretYaw` to its hull yaw), and the silhouette
 *               follows it for free: a wedge with a barrel through it, never a
 *               drum on a ring.
 *
 *   ARC COIL    The faction cue, on all eleven: a stack of two lathed rings with
 *               a lit gap between them, always offset to one side. It is the
 *               visible half of the arc armoury — every Reclamation gun is a
 *               chaining Tesla bolt — and it is what makes the army legible at
 *               a distance where the frame has collapsed into a smudge.
 *
 *   PALETTE     Oxide graphite hull (the only DARK army), arc-violet team plate,
 *               hazard amber stripes. See `RECLAIM_LOOK` in `core/config.ts` for
 *               the hue arithmetic against the other three.
 *
 *
 * SURFACE DISCIPLINE
 * ------------------
 * The clean-painted law is honoured by construction: every mark comes from
 * `Greeble.ts`'s painters through the tile slots, `rivets: false` selects the
 * welded language, and there is no path from this file to a texel of noise.
 *
 *
 * PRIMITIVES
 * ----------
 * Authored almost entirely in the `Shapes.ts` set — `taperedBox`, `plate`,
 * `cylinder`, `cone`, `hull`, `greebleStrip` — which `UnitFactory.buildUnit`
 * now dispatches through `shapeSpecFor`. That is not decoration: `taperedBox`
 * and `plate` both report ZERO axis-aligned flank surface to the boxiness gate
 * (a tapered wall is no longer a vertical plane and a plate's flank is all
 * bevel), so a frame-and-cladding army measures near the bottom of the roster
 * on the metric that exists to catch "a rectangle made of rectangles".
 * ============================================================================
 */

import { UNIT_LADDER, type UnitPalette } from '../core/config';
import { EntityKind, Faction, PartId } from '../core/types';
import { GreebleFactory } from './Greeble';
import {
  MassRole, taperOutline,
  type MassDef, type SocketSpec, type UnitMassList,
} from './MassList';
import { UnitLibrary, type UnitModel } from './UnitFactory';
import {
  FACTION_ANY, registerKindMesh, type KindMesh, type SocketSpec as BridgeSocket,
} from '../render/RenderBridge';

/* ==========================================================================
 * 1. THE PALETTE
 * ========================================================================== */

/**
 * THE RECLAMATION HULL PALETTE. Same shape as `RA3_ALLIES` / `RA3_SOVIETS` in
 * config.ts, and authored here for the same reason `MERIDIAN_UNIT_PALETTE` is:
 * `RA3_UNIT_PALETTE` is a closed three-member record in a file whose other
 * consumers index it by a narrow union.
 *
 * R12 is respected the way all four armies respect it: `base` is NOT a faction
 * colour. It is oxide-blackened steel, and the violet only ever reaches a
 * surface through the `teamSlab` tile, in flat plates measuring 8-14% of the
 * hull.
 */
export const RECLAIM_UNIT_PALETTE: UnitPalette = {
  /** Oxide graphite. Darker than any other hull in the game by a clear margin. */
  base: '#3D3A44',
  shadow: '#17151C',
  /** Arc violet. 72 degrees clear of cobalt AND of crimson — see RECLAIM_LOOK. */
  team: '#9B18D8',
  teamSecondary: '#5E0E86',
  /**
   * The eagle, in hazard amber rather than Allied white. `Greeble.ts` offers two
   * glyphs and both are spoken for, so the separation has to come from COLOUR
   * and from the field behind it: an amber bird on a violet disc cannot be
   * confused with a white one on cobalt at any distance the game is played at.
   */
  insignia: 'eagle',
  insigniaColor: '#E8B33C',
  hullNumber: 3312,
  /** Arc conduit. Not cyan, not furnace orange, not gold. */
  emissive: '#E27BFF',
  /** Warm grey-brown, per bible 5.4 (S <= 0.26). Never blue steel. */
  bareMetal: '#5A544C',
  /** Reads as the shadow inside the open frame rather than as track links. */
  trackLink: '#1E1A22',
  glass: '#2A1E34',
  stencil: '#D8CFC0',
  hazard: '#E5CB43',
  /** Welded, not bolted. The Soviets keep the rivet ring. */
  rivets: false,
};

/**
 * WHICH SURFACE LANGUAGE THE MASS LISTS DECLARE.
 *
 * `UnitMassList.faction` is the union `'allies' | 'soviets' | 'neutral'` in
 * `MassList.ts`, which is not this module's file. The field is read for exactly
 * two things: `defaultChamfer()`'s per-faction fraction, and `validateUnit()`'s
 * "skip the team-colour and insignia checks when neutral".
 *
 * `'soviets'` is the correct declaration and not a workaround:
 *   - it selects the 7.5% chamfer fraction rather than the Allied 10%, which is
 *     the right figure for plate that was cut with a torch and hung on a frame
 *     (the Pact, being fired ceramic, correctly takes the Allied number), and
 *   - it keeps R-T1 and R-T4 ENFORCED, which `'neutral'` would silently switch
 *     off — the worst thing that could happen to a brand new roster.
 *
 * No Soviet colour reaches these models: the atlas is built from
 * `RECLAIM_UNIT_PALETTE` on a PRIVATE `GreebleFactory`, so the Reclamation's
 * textures are its own regardless of what this string says.
 */
export const RECLAIM_ART_FACTION: UnitMassList['faction'] = 'soviets';

/** Deterministic, so the atlas is diffable between runs. */
const RECLAIM_ATLAS_SEED = 0x5243;

/** Four-digit stencil, shared by the whole army. */
const HULL_NUMBER = RECLAIM_UNIT_PALETTE.hullNumber;

/* ==========================================================================
 * 2. MASS CONSTRUCTORS
 *
 * The same five shorthands the shipped rosters use, because the validator
 * counts roles and a second vocabulary for the same five roles would be a bug
 * farm.
 * ========================================================================== */

type V3 = readonly [number, number, number];

interface SlabOpts { mirrorX?: boolean; rot?: V3; }

/** A flat violet panel bolted to the frame. R-T2: a quad, never a gradient. */
function slab(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.TeamSlab, size, anchor,
    slot: 'teamSlab', chamfer: 0.02,
    ...(o.mirrorX ? { mirrorX: true } : {}),
    ...(o.rot ? { rot: o.rot } : {}),
  };
}

/** THE one insignia decal (R-T4). Exactly one per unit or the build is rejected. */
function insignia(size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name: 'insignia', primitive: 'box', role: MassRole.Insignia, size, anchor,
    slot: 'insignia', chamfer: 0.02,
    ...(o.rot ? { rot: o.rot } : {}),
  };
}

/** A masked emissive panel. R-T5: 0.5-3% of surface, clean rectangles only. */
function glow(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.Emissive, size, anchor,
    slot: 'emissive', chamfer: 0.02,
    ...(o.mirrorX ? { mirrorX: true } : {}),
  };
}

function greeble(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: MassDef['slot'], extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Greeble, size, anchor, slot, ...extra };
}

function primary(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: MassDef['slot'], extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Primary, size, anchor, slot, ...extra };
}

/* ==========================================================================
 * 3. THE THREE SUB-ASSEMBLIES THAT MAKE THE ARMY
 * ========================================================================== */

/**
 * RECLAIM-2: THE OUTRIGGER GEAR.
 *
 * Bible 5.3 wants a ground vehicle's base to protrude outboard and to stand
 * 18-25% of unit height. The Allies and the Soviets answer with a track pair,
 * the Pact with a plenum skirt, and all three are SOLID — they read as a dark
 * band under the hull. This answers with paired road wheels on canted swing
 * arms hung outside the frame, so the same 20% of height is mostly EMPTY and
 * the ground shows through it.
 *
 * The swing arms are the one piece of the running gear that is allowed to be a
 * plain leaning box: they are 0.2 m thick, they are almost entirely rim at any
 * gameplay distance, and their rotation takes their walls off the world axes
 * anyway.
 */
function outriggerGear(hullW: number, gearH: number, length: number, wheels: number): MassDef[] {
  const out: MassDef[] = [];
  const r = gearH * 0.92;
  const armX = hullW * 0.50;
  const wheelX = hullW * 0.62;
  for (let i = 0; i < wheels; i++) {
    const t = wheels === 1 ? 0.5 : i / (wheels - 1);
    const z = -length * 0.36 + length * 0.72 * t;
    // Alternate the arm rake fore and aft so the run reads as suspension
    // rather than as a comb.
    const rake = i % 2 === 0 ? 0.42 : -0.42;
    out.push(
      greeble(`swing${i}`, 'taperedBox', [0.20, gearH * 0.66, length * 0.13],
        [armX, gearH * 0.86, z], 'bareMetal', {
          mirrorX: true, rot: [rake, 0, 0], group: 'swingArms',
          shape: { topScaleZ: 0.55, topScaleX: 0.70 },
        }),
      greeble(`wheel${i}`, 'cylinder', [r, 0.34, r], [wheelX, r * 0.52, z], 'tread', {
        mirrorX: true, rot: [0, 0, Math.PI * 0.5], group: 'roadWheels',
        shape: { segments: 12, rTop: 1, capChamfer: 0.05 },
      }),
    );
  }
  // The transverse tie beam: the one piece that makes the gear read as a
  // chassis rather than as loose wheels. It shares the swing arms' group
  // because it IS the same object to the eye, and because bible 5.3's 6-12
  // budget counts things a critic can point at, not masses.
  out.push(greeble('tieBeam', 'taperedBox', [hullW * 1.18, 0.20, 0.26],
    [0, gearH * 1.05, -length * 0.30], 'bareMetal', {
      group: 'swingArms', shape: { topScaleZ: 0.62 },
    }));
  return out;
}

/**
 * RECLAIM-1 + RECLAIM-3: THE HUNG CLADDING.
 *
 * A trapezoidal plate standing proud of the frame on two stand-offs, canted
 * about Z so it is not parallel to anything. Returned as a PAIR of masses (the
 * plate and its bracket) sharing a group, so it costs one greeble slot.
 *
 * The plate primitive is doing real work for the boxiness gate: `massFlankSurface`
 * reports a plate's entire flank as rim bevel, i.e. zero axis-aligned wall, at
 * any rotation.
 */
function cladding(
  name: string, w: number, h: number, anchor: V3, tilt: number,
  slot: MassDef['slot'] = 'paintMed', role: MassRole = MassRole.Greeble,
): MassDef[] {
  return [
    {
      name, primitive: 'plate', role, size: [w, 0.14, h], anchor,
      rot: [0.05, 0, tilt], slot, capSlot: slot, chamfer: 0.04,
      group: name,
      shape: { outline: taperOutline(w, h, 0.72, 0.94), thickness: 0.14, bevel: 0.04 },
    },
    greeble(`${name}.standoff`, 'taperedBox', [0.16, 0.16, h * 0.62],
      [anchor[0] * 0.82, anchor[1] - h * 0.10, anchor[2]], 'bareMetal', {
        rot: [0, 0, tilt], group: name, shape: { topScaleX: 0.6, topScaleZ: 0.6 },
      }),
  ];
}

/**
 * THE ARC COIL — the faction cue, on all eleven hulls.
 *
 * Two lathed rings with a lit gap between them on a short mast. It is
 * deliberately NEVER centred: putting it on the model centre line would make it
 * read as an antenna, which every army has, and the whole point is that this one
 * is off to one side because it was welded on where there happened to be room.
 */
function arcCoil(name: string, x: number, y: number, z: number, dia: number, h: number): MassDef[] {
  return [
    greeble(`${name}.mast`, 'cone', [dia * 0.34, h * 0.42, dia * 0.34], [x, y + h * 0.21, z], 'bareMetal', {
      group: name, shape: { segments: 10, rTop: 0.55 },
    }),
    greeble(`${name}.ringA`, 'cylinder', [dia, h * 0.12, dia], [x, y + h * 0.48, z], 'bareMetal', {
      group: name, shape: { segments: 12, rTop: 0.86, capChamfer: 0.03 },
    }),
    greeble(`${name}.ringB`, 'cylinder', [dia * 0.74, h * 0.10, dia * 0.74], [x, y + h * 0.86, z], 'bareMetal', {
      group: name, shape: { segments: 12, rTop: 0.70, capChamfer: 0.03 },
    }),
    // The gap IS the emissive. A lit ring around a dark core is what the arc
    // weapons look like, and it is a clean rectangle in the atlas either way.
    {
      name: `${name}.gap`, primitive: 'cylinder', role: MassRole.Emissive,
      size: [dia * 0.52, h * 0.22, dia * 0.52], anchor: [x, y + h * 0.68, z],
      slot: 'emissive', capSlot: 'emissive', chamfer: 0.02,
      shape: { segments: 10, rTop: 1 },
    },
  ];
}

/**
 * The furniture every Reclamation hull carries beyond the coil. Five discrete
 * objects, all >= 0.16 m so nothing is sub-pixel at gameplay zoom, and only ONE
 * of them mirrors — the rest are the asymmetry.
 */
function scrapGreebles(hullW: number, hullL: number, deckY: number): MassDef[] {
  return [
    // The fuel drum, in the open bay on the -X flank.
    greeble('drum', 'cylinder', [0.62, 0.90, 0.62], [-hullW * 0.42, deckY + 0.42, -hullL * 0.16], 'bareMetal', {
      group: 'drum', shape: { segments: 12, rTop: 0.94, capChamfer: 0.05 },
    }),
    // The grapple jib, on the +X flank only.
    greeble('jib', 'taperedBox', [0.16, 0.16, hullL * 0.34], [hullW * 0.40, deckY + 0.30, hullL * 0.10], 'bareMetal', {
      rot: [0.22, 0.18, 0], group: 'jib', shape: { topScaleX: 0.6, topScaleZ: 0.6 },
    }),
    greeble('grapple', 'hull', [0.34, 0.36, 0.34], [hullW * 0.46, deckY + 0.06, hullL * 0.30], 'bareMetal', {
      group: 'jib',
      shape: {
        points: [
          [0, 0.18, 0], [0.16, -0.14, 0.10], [-0.16, -0.14, 0.10],
          [0.14, -0.12, -0.14], [-0.14, -0.12, -0.14], [0, 0.04, 0.18],
        ],
      },
    }),
    // A run of welded scrap along the spine. `greebleStrip` is the one primitive
    // in the library that draws a row of small hardware for one slot, which is
    // exactly what "somebody bolted their spares to the roof" needs.
    greeble('stowage', 'greebleStrip', [hullW * 0.30, 0.20, hullL * 0.40],
      [-hullW * 0.16, deckY + 0.12, -hullL * 0.26], 'bareMetal', {
        group: 'stowage', shape: { density: 3.0, seed: 0x5243 },
      }),
    // Headlamp cluster. The only mirrored greeble on the deck.
    greeble('lamp', 'taperedBox', [0.26, 0.20, 0.16], [hullW * 0.30, deckY - 0.08, hullL * 0.44], 'paintTiny', {
      mirrorX: true, faceSlots: { pz: 'glass' }, group: 'lamps',
      shape: { topScaleX: 0.7, topScaleZ: 0.7 },
    }),
  ];
}

/* ==========================================================================
 * 4. INFANTRY
 *
 * R-S4: 0.30-0.38 x a 7 m MBT hull. The Reclamation silhouette differs from the
 * other three at 20 px by three things and only three: a FLAT WELDER'S VISOR
 * where the others wear a dome or a cone, ONE oversized shoulder pauldron
 * instead of a matched pair, and the coil on the pack. Below the waist is
 * deliberately identical to everyone else's, because legs at that pixel count
 * are two smudges whatever you do to them.
 * ========================================================================== */

interface ScrapInfantryOpts {
  key: string;
  name: string;
  /** 'prod' arc pike | 'satchel' slag charge | 'tool' tinker's cutter. */
  weapon: 'prod' | 'satchel' | 'tool';
  /** 'coil' battery coil | 'hopper' slag hopper | 'roll' tool roll. */
  pack: 'coil' | 'hopper' | 'roll';
}

function scrapInfantry(o: ScrapInfantryOpts): UnitMassList {
  const H = UNIT_LADDER.infantryHeightMeters;      // 2.2 m
  const W = UNIT_LADDER.infantryWidthMeters;       // 0.78 m shoulder span
  const legTop = H * 0.415;
  const torsoH = H * 0.415;
  const torsoY = legTop + torsoH * 0.5;            // 0.623 H — the dominant mass

  const masses: MassDef[] = [
    primary('leg', 'taperedBox', [W * 0.34, legTop, W * 0.44], [W * 0.24, legTop * 0.5, 0], 'paintSmall', {
      mirrorX: true, shape: { topScaleX: 1.18, topScaleZ: 1.06, shear: 0.02 },
    }),
    // The torso is a forward-leaning wedge: this army carries its weight on its
    // shoulders, which reads as hunched at any distance.
    primary('torso', 'taperedBox', [W * 0.84, torsoH, W * 0.72], [0, torsoY, 0], 'paintMed', {
      shape: { topScaleX: 1.10, topScaleZ: 0.86, shear: W * 0.10, cornerCut: 0.06 },
    }),
    // The helmet is a plain squat drum; the READ is the visor plate hung on the
    // front of it, which is the next mass down.
    primary('helmet', 'cylinder', [W * 0.54, H * 0.115, W * 0.56], [0, legTop + torsoH + H * 0.040, -0.01], 'paintSmall', {
      shape: { segments: 12, rTop: 0.86, capChamfer: 0.03 },
    }),
    primary('arm', 'taperedBox', [W * 0.24, torsoH * 0.84, W * 0.28], [W * 0.50, torsoY + 0.02, 0.06], 'paintSmall', {
      mirrorX: true, rot: [0.16, 0, -0.08], shape: { topScaleX: 0.8, topScaleZ: 0.86 },
    }),
  ];

  // THE VISOR. A canted plate across the face, and the single thing that
  // separates this army's infantry from everyone else's at 20 px.
  masses.push({
    name: 'visor', primitive: 'plate', role: MassRole.Greeble,
    size: [W * 0.50, 0.06, H * 0.10], anchor: [0, legTop + torsoH + H * 0.036, W * 0.24],
    rot: [1.32, 0, 0.10], slot: 'glass', capSlot: 'glass', chamfer: 0.02, group: 'visor',
    shape: { outline: taperOutline(W * 0.50, H * 0.10, 0.78), thickness: 0.06, bevel: 0.02 },
  });

  if (o.weapon === 'satchel') {
    masses.push(greeble('tube', 'cone', [0.20, 0.70, 0.20], [W * 0.48, torsoY + 0.12, 0.22], 'bareMetal', {
      rot: [1.24, 0, 0.10], group: 'weapon', shape: { segments: 10, rTop: 0.62 },
    }));
    masses.push(greeble('charge', 'cylinder', [0.24, 0.20, 0.24], [W * 0.48, torsoY + 0.34, 0.44], 'hatch', {
      rot: [1.24, 0, 0.10], group: 'weapon', shape: { segments: 10, rTop: 0.92 },
    }));
  } else if (o.weapon === 'tool') {
    masses.push(greeble('cutter', 'taperedBox', [0.14, 0.16, 0.72], [W * 0.50, torsoY - 0.08, 0.30], 'bareMetal', {
      rot: [0.14, 0.10, 0], group: 'weapon', shape: { topScaleZ: 0.5, shear: 0.06 },
    }));
    masses.push(greeble('cutterHead', 'cone', [0.20, 0.22, 0.20], [W * 0.50, torsoY - 0.06, 0.68], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], group: 'weapon', shape: { segments: 8, rTop: 0.18 },
    }));
  } else {
    // The arc prod: a long thin pike with a ring emitter on the end. It is the
    // gun and it is also the reason the silhouette has a diagonal in it.
    masses.push(greeble('prod', 'taperedBox', [0.10, 0.12, 1.02], [W * 0.44, torsoY - 0.02, 0.26], 'bareMetal', {
      rot: [0.20, 0.06, 0], group: 'weapon', shape: { topScaleX: 0.5, topScaleZ: 0.7 },
    }));
    masses.push(greeble('prodRing', 'cylinder', [0.20, 0.10, 0.20], [W * 0.44, torsoY + 0.14, 0.76], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], group: 'weapon', shape: { segments: 10, rTop: 0.80 },
    }));
  }

  if (o.pack === 'hopper') {
    // Deliberately small in the Z-Y plane: the torso has to stay the dominant
    // mass at 35-50% of the silhouette, and a deep backpack is measured as
    // silhouette that the torso then does not own.
    masses.push(greeble('hopper', 'taperedBox', [W * 0.54, 0.34, 0.20], [0, torsoY + 0.08, -W * 0.38], 'paintSmall', {
      group: 'pack', shape: { topScaleX: 1.16, topScaleZ: 1.20 },
    }));
  } else if (o.pack === 'roll') {
    masses.push(greeble('roll', 'cylinder', [0.26, W * 0.60, 0.26], [0, torsoY + 0.08, -W * 0.40], 'tread', {
      rot: [0, 0, Math.PI * 0.5], group: 'pack', shape: { segments: 10, rTop: 1 },
    }));
  } else {
    masses.push(greeble('battery', 'cylinder', [0.30, 0.46, 0.30], [0, torsoY + 0.08, -W * 0.40], 'bareMetal', {
      group: 'pack', shape: { segments: 10, rTop: 0.90, capChamfer: 0.04 },
    }));
  }

  // The faction cue at infantry scale, and off-centre like every other one.
  masses.push(...arcCoil('coil', -W * 0.20, torsoY + torsoH * 0.42, -W * 0.34, 0.20, 0.42));

  masses.push(
    // THE PAULDRON — one shoulder, never two. The asymmetry rule reaches all the
    // way down to a 2 m figure, and this is where it is most visible: a
    // man-shaped silhouette is the one the eye checks for symmetry hardest.
    greeble('pauldron', 'plate', [W * 0.40, 0.10, W * 0.46], [W * 0.44, torsoY + torsoH * 0.30, 0], 'paintSmall', {
      rot: [0, 0, -0.42], group: 'pauldron',
      shape: { outline: taperOutline(W * 0.40, W * 0.46, 0.70), thickness: 0.10, bevel: 0.03 },
    }),
    greeble('boot', 'taperedBox', [W * 0.40, 0.16, W * 0.60], [W * 0.24, 0.08, 0.06], 'paintTiny', {
      mirrorX: true, group: 'boots', shape: { topScaleZ: 0.82, shear: -0.04 },
    }),
    greeble('belt', 'taperedBox', [W * 0.88, 0.12, W * 0.62], [0, torsoY - torsoH * 0.34, 0], 'paintTiny', {
      group: 'belt', shape: { topScaleX: 0.94 },
    }),
    greeble('collar', 'taperedBox', [W * 0.58, 0.11, W * 0.48], [0, legTop + torsoH - 0.03, 0], 'paintTiny', {
      group: 'collar', shape: { topScaleX: 0.82, topScaleZ: 0.82 },
    }),
  );

  // R-T1 for infantry is 20-28% of surface: chest, the one pauldron face, the
  // helmet band and the thigh wraps.
  masses.push(
    slab('chestPlate', [W * 0.70, torsoH * 0.62, 0.06], [0, torsoY + 0.06, W * 0.30]),
    slab('pauldronFace', [W * 0.36, 0.28, W * 0.42], [W * 0.46, torsoY + torsoH * 0.32, 0], { rot: [0, 0, -0.42] }),
    slab('helmBand', [W * 0.56, 0.12, W * 0.58], [0, legTop + torsoH + H * 0.022, -0.01]),
    slab('thighWrap', [W * 0.40, 0.20, W * 0.48], [W * 0.24, legTop * 0.70, 0], { mirrorX: true }),
  );
  masses.push(insignia([0.24, 0.24, 0.05], [-W * 0.26, torsoY + torsoH * 0.22, W * 0.31]));
  masses.push(
    glow('lens', [W * 0.34, 0.10, 0.05], [0, legTop + torsoH + H * 0.030, W * 0.27]),
    // R-T5's floor is measured against TOTAL triangle area including faces the
    // camera never sees, and a 2 m figure has a lot of those, so one visor strip
    // lands at 0.49% — just under. The pack tell-tale is the second run.
    glow('packLamp', [W * 0.26, 0.14, 0.05], [0, torsoY + 0.20, -W * 0.50]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.MuzzleA, pos: [W * 0.44, torsoY + 0.14, 0.82] },
    { part: PartId.Emitter, pos: [-W * 0.20, torsoY + torsoH * 0.60, -W * 0.34] },
  ];

  return {
    key: o.key,
    name: o.name,
    faction: RECLAIM_ART_FACTION,
    cls: 'infantry',
    hullLength: W,
    masses,
    sockets,
    hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 5. THE CASEMATE-HULL TEMPLATE
 *
 * The proportions are the shipped tank template's to the digit — running gear in
 * the bottom 22%, spine at 0.33 H, dominant mass centred at 0.655 H — because
 * those are the numbers R8 measures and they are proven to land inside every
 * band. What changes is every SHAPE that carries them, and the fact that the
 * dominant mass is a fixed gun house rather than a turret.
 * ========================================================================== */

interface ScrapHullOpts {
  key: string;
  name: string;
  hullLength: number;
  hullWidth: number;
  /** Total silhouette height including the coil. */
  height: number;
  /** 'arc' single coil gun | 'spit' light twin coil | 'mortar' siege tube. */
  gun: 'arc' | 'spit' | 'mortar';
  wheels?: number;
}

function scrapHull(o: ScrapHullOpts): UnitMassList {
  const H = o.height;
  const L = o.hullLength;
  const W = o.hullWidth;

  const gearH = H * 0.22;
  const spineH = H * 0.215;
  const spineY = gearH + spineH * 0.5;
  const houseH = H * 0.50;
  const houseY = H * 0.655;
  const deckY = gearH + spineH;
  const houseRoof = houseY + houseH * 0.5;

  const masses: MassDef[] = [
    ...outriggerGear(W, gearH, L * 0.92, o.wheels ?? 3),

    // THE SPINE. A tapered box-girder with a sheared glacis: not one of its four
    // walls is a vertical plane, which is what takes the boxiness metric to the
    // floor without a single lathe on the chassis.
    primary('spine', 'taperedBox', [W * 0.80, spineH, L], [0, spineY, 0], 'paintLarge', {
      shape: { topScaleX: 0.86, topScaleZ: 0.94, shear: L * 0.07, cornerCut: 0.22 },
    }),

    // THE GUN HOUSE — the dominant mass, and a fixed casemate rather than a
    // turret. Its front face is raked hard back, so the barrel comes out of a
    // sloped plate instead of out of a mantlet ring.
    primary('house', 'taperedBox', [W * 0.86, houseH, L * 0.62], [W * 0.05, houseY, -L * 0.06], 'paintLarge', {
      shape: { topScaleX: 0.74, topScaleZ: 0.66, shear: L * 0.10, cornerCut: 0.20 },
      // RECLAIM-1: the cladding is HUNG, so the house carries three separate
      // plates at three different angles rather than wearing a skin. One of them
      // is a team panel, which is where most of the R-T1 budget lands.
      plates: [
        {
          name: 'house.cheek',
          outline: taperOutline(L * 0.52, houseH * 0.68, 0.66, 0.92),
          thickness: 0.12,
          offset: [W * 0.44, 0, 0], rot: [0, Math.PI * 0.5, 1.44],
          slot: 'paintMed', group: 'houseClad',
        },
        {
          name: 'house.brow',
          outline: taperOutline(W * 0.60, L * 0.22, 0.74),
          thickness: 0.12,
          offset: [-W * 0.02, houseH * 0.30, L * 0.20], rot: [-0.42, 0, 0.06],
          slot: 'paintMed', group: 'houseClad',
        },
        {
          name: 'house.team',
          outline: taperOutline(L * 0.34, houseH * 0.44, 0.70, 0.96),
          thickness: 0.10,
          offset: [-W * 0.44, 0.02, -L * 0.04], rot: [0, Math.PI * 0.5, -1.50],
          slot: 'teamSlab', role: MassRole.TeamSlab, group: 'houseTeam',
        },
      ],
    }),
  ];

  /* -- armament ---------------------------------------------------------- */
  const muzzleZ = L * 0.56;
  const gunY = houseY - houseH * 0.06;
  switch (o.gun) {
    case 'spit':
      masses.push(
        primary('barrel', 'cylinder', [0.20, L * 0.44, 0.20], [W * 0.13, gunY, L * 0.30], 'bareMetal', {
          mirrorX: true, rot: [Math.PI * 0.5, 0, 0],
          shape: { segments: 10, rTop: 0.82, capChamfer: 0.03 },
        }),
        greeble('coilShroud', 'cone', [0.30, 0.26, 0.30], [W * 0.13, gunY, L * 0.48], 'bareMetal', {
          mirrorX: true, rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
          shape: { segments: 10, rTop: 0.60 },
        }),
      );
      break;
    case 'mortar':
      // A stubby high-elevation tube, canted up. It is the only gun in the army
      // that is not pointed flat at the horizon and the only one that can hurt a
      // building.
      //
      // EVERY NUMBER HERE IS SOLVED FROM THE HEIGHT, not chosen. A rotated
      // cone's vertical extent is `len*cos(t) + dia*sin(t)`, and `bounds[1]` is
      // the divisor in the top-heavy check — so a tube that overshoots H does
      // not just look tall, it drags the gun house's measured centre from 65%
      // down to 58% and REJECTS the hull. At 0.30π and L*0.34 the crown lands
      // at 0.99 H with the coil, which is where it has to be.
      masses.push(
        primary('tube', 'cone', [W * 0.34, L * 0.34, W * 0.34], [0, gunY - 0.12, L * 0.20], 'bareMetal', {
          rot: [Math.PI * 0.30, 0, 0], shape: { segments: 12, rTop: 0.70 },
        }),
        greeble('recoil', 'cylinder', [0.24, L * 0.24, 0.24], [W * 0.22, gunY - 0.06, L * 0.10], 'bareMetal', {
          mirrorX: true, rot: [Math.PI * 0.42, 0, 0], group: 'recoil',
          shape: { segments: 8, rTop: 0.90 },
        }),
      );
      break;
    default:
      masses.push(
        primary('barrel', 'cone', [0.30, L * 0.54, 0.30], [W * 0.05, gunY, L * 0.28], 'bareMetal', {
          rot: [Math.PI * 0.5, 0, 0], shape: { segments: 12, rTop: 0.78 },
        }),
        greeble('emitterRing', 'cylinder', [0.44, 0.20, 0.44], [W * 0.05, gunY, L * 0.50], 'bareMetal', {
          rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
          shape: { segments: 12, rTop: 0.84, capChamfer: 0.04 },
        }),
      );
      break;
  }

  /* -- greebles ---------------------------------------------------------- */
  masses.push(
    ...scrapGreebles(W, L, deckY),
    // RECLAIM-3: the big salvaged slab, on the -X flank ONLY. This is the
    // asymmetry the whole army is built on and it is worth one greeble slot.
    ...cladding('flankSlab', L * 0.44, H * 0.34, [-W * 0.54, spineY + spineH * 0.24, -L * 0.04], 0.22),
    // Sized so the silhouette tops out at exactly H: an overshooting coil would
    // push `bounds[1]` past the height the top-heavy check divides by, and every
    // hull in the roster would fail it at once.
    ...arcCoil('coil', -W * 0.30, houseRoof, -L * 0.16, W * 0.20, H - houseRoof),
    greeble('exhaust', 'cylinder', [0.26, H * 0.16, 0.26], [W * 0.34, houseRoof - H * 0.04, -L * 0.24], 'vent', {
      group: 'exhaust', shape: { segments: 10, rTop: 0.76, capChamfer: 0.04 },
    }),
  );

  /* -- team colour (R-T1: 8-14% of visible surface, flat slabs only) ------ */
  masses.push(
    slab('spineFlank', [0.07, spineH * 0.60, L * 0.46], [W * 0.42, spineY, -L * 0.04], { mirrorX: true }),
    // Top-facing slabs stay SMALL inserts: a 39-degree camera weights a deck
    // about 2.5x a flank, so a roof-sized plate measures inside R-T1 and still
    // reads as a repainted tank.
    slab('houseCap', [W * 0.32, 0.07, L * 0.24], [-W * 0.10, houseRoof, -L * 0.02]),
    slab('prowBand', [W * 0.40, 0.07, L * 0.08], [0, deckY, L * 0.42]),
  );
  masses.push(insignia([W * 0.24, 0.06, W * 0.24], [W * 0.16, houseRoof + 0.02, L * 0.10]));
  masses.push(
    // The arc conduit: one long thin lit line down the spine. RECLAIM-6 — the
    // emissive is always a LINE, never a blob.
    glow('conduit', [0.07, 0.08, L * 0.56], [W * 0.30, deckY + 0.06, -L * 0.06]),
    glow('sternLamp', [0.30, 0.20, 0.06], [-W * 0.22, deckY + 0.10, -L * 0.48]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.MuzzleA, pos: [o.gun === 'spit' ? W * 0.13 : W * 0.05, gunY, muzzleZ] },
    { part: PartId.Exhaust, pos: [W * 0.34, houseRoof + 0.20, -L * 0.24] },
    { part: PartId.Emitter, pos: [-W * 0.30, H, -L * 0.16] },
    { part: PartId.Antenna, pos: [-W * 0.30, H, -L * 0.16] },
  ];
  if (o.gun === 'spit') sockets.push({ part: PartId.MuzzleB, pos: [-W * 0.13, gunY, muzzleZ] });

  return {
    key: o.key,
    name: o.name,
    faction: RECLAIM_ART_FACTION,
    cls: 'vehicle',
    hullLength: L,
    masses,
    sockets,
    hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 6. TURRETLESS SUPPORT — the Scrapjaw and the Yardcrawler
 *
 * No gun house, so the dominant mass is the superstructure and it still has to
 * sit at 0.60-0.70 H. On the Scrapjaw that is the ore hopper; on the Yardcrawler
 * it is the folded Foundry package it turns into.
 * ========================================================================== */

interface ScrapSupportOpts {
  key: string;
  name: string;
  hullLength: number;
  hullWidth: number;
  height: number;
  role: 'scrapper' | 'crawler';
}

function scrapSupport(o: ScrapSupportOpts): UnitMassList {
  const H = o.height, L = o.hullLength, W = o.hullWidth;
  const gearH = H * 0.24;
  const chassisH = H * 0.17;
  const chassisY = gearH + chassisH * 0.5;
  const deckY = gearH + chassisH;
  const bodyH = H * 0.50;
  const bodyY = H * 0.645;

  const masses: MassDef[] = [
    ...outriggerGear(W, gearH, L * 0.88, 4),
    primary('chassis', 'taperedBox', [W * 0.82, chassisH, L], [0, chassisY, 0], 'paintLarge', {
      shape: { topScaleX: 0.90, topScaleZ: 0.96, shear: L * 0.05, cornerCut: 0.24 },
    }),
    // The dominant mass: an ore hopper, or the folded structure package.
    primary(o.role === 'scrapper' ? 'hopper' : 'package', 'taperedBox',
      [W * 0.92, bodyH, L * 0.62], [-W * 0.03, bodyY, -L * 0.10], 'paintLarge', {
        shape: { topScaleX: 1.14, topScaleZ: 1.06, shear: -L * 0.05, cornerCut: 0.18 },
        plates: [
          {
            name: 'body.clad',
            outline: taperOutline(L * 0.48, bodyH * 0.64, 0.70, 0.92),
            thickness: 0.13,
            offset: [W * 0.47, 0, 0], rot: [0, Math.PI * 0.5, 1.42],
            slot: 'paintMed', group: 'bodyClad',
          },
          {
            name: 'body.team',
            outline: taperOutline(L * 0.36, bodyH * 0.42, 0.72, 0.96),
            thickness: 0.10,
            offset: [-W * 0.47, 0.02, 0], rot: [0, Math.PI * 0.5, -1.50],
            slot: 'teamSlab', role: MassRole.TeamSlab, group: 'bodyTeam',
          },
        ],
      }),
  ];

  if (o.role === 'scrapper') {
    masses.push(
      // The crusher jaw. It is the second read, it says "harvester", and it is
      // the reason this unit carries `crushLevel: 5` in the def table.
      primary('jaw', 'hull', [W * 1.00, H * 0.28, L * 0.26], [0, deckY - H * 0.02, L * 0.42], 'bareMetal', {
        shape: {
          points: [
            [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.42, 0.16, 0.5], [-0.42, 0.16, 0.5],
            [-0.36, -0.5, 0.24], [0.36, -0.5, 0.24], [-0.44, -0.5, -0.5], [0.44, -0.5, -0.5],
          ],
        },
      }),
      greeble('teeth', 'greebleStrip', [0.22, 0.20, W * 0.92], [0, deckY - H * 0.12, L * 0.50], 'bareMetal', {
        rot: [0, Math.PI * 0.5, 0], group: 'teeth', shape: { density: 4.0, seed: 0x5c1a },
      }),
      greeble('lift', 'cylinder', [0.22, L * 0.26, 0.22], [W * 0.40, deckY + H * 0.08, L * 0.26], 'bareMetal', {
        rot: [Math.PI * 0.42, 0, 0], group: 'lifts',
        shape: { segments: 10, rTop: 0.90 },
      }),
      greeble('hopperLid', 'plate', [W * 0.62, 0.14, L * 0.40], [-W * 0.03, bodyY + bodyH * 0.50, -L * 0.10], 'hatch', {
        rot: [-0.14, 0, 0.08], group: 'lid',
        shape: { outline: taperOutline(W * 0.62, L * 0.40, 0.80), thickness: 0.14, bevel: 0.04 },
      }),
    );
  } else {
    masses.push(
      primary('ramp', 'hull', [W * 1.02, H * 0.26, L * 0.20], [0, gearH * 0.86, L * 0.46], 'paintMed', {
        shape: {
          points: [
            [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.34, -0.34, 0.5], [-0.34, -0.34, 0.5],
            [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5],
          ],
        },
      }),
      greeble('derrick', 'taperedBox', [0.22, H * 0.30, 0.22], [W * 0.34, H - H * 0.15, -L * 0.22], 'bareMetal', {
        rot: [0, 0, -0.10], group: 'derrick', shape: { topScaleX: 0.5, topScaleZ: 0.5 },
      }),
      greeble('derrickJib', 'taperedBox', [0.18, 0.16, L * 0.40], [W * 0.34, H - H * 0.20, L * 0.02], 'bareMetal', {
        rot: [0.18, 0, 0], group: 'derrick', shape: { topScaleZ: 0.6 },
      }),
      greeble('packLid', 'plate', [W * 0.58, 0.14, L * 0.34], [-W * 0.03, bodyY + bodyH * 0.50, -L * 0.10], 'hatch', {
        rot: [-0.12, 0, -0.08], group: 'lid',
        shape: { outline: taperOutline(W * 0.58, L * 0.34, 0.78), thickness: 0.14, bevel: 0.04 },
      }),
    );
  }

  masses.push(
    ...scrapGreebles(W, L, deckY),
    ...arcCoil('coil', W * 0.30, bodyY + bodyH * 0.50, -L * 0.30, W * 0.16, H - (bodyY + bodyH * 0.50)),
    greeble('cabGlass', 'plate', [W * 0.48, 0.10, bodyH * 0.34],
      [-W * 0.03, bodyY + bodyH * 0.14, -L * 0.10 + L * 0.31], 'glass', {
        rot: [1.28, 0, 0], group: 'cab',
        shape: { outline: taperOutline(W * 0.48, bodyH * 0.34, 0.80), thickness: 0.10, bevel: 0.03 },
      }),
  );

  masses.push(
    slab('chassisBand', [0.07, chassisH * 0.54, L * 0.52], [W * 0.44, chassisY, 0], { mirrorX: true }),
    slab('bodyCap', [W * 0.34, 0.07, L * 0.22], [W * 0.12, bodyY + bodyH * 0.50, -L * 0.10]),
    slab('sternPlate', [W * 0.50, bodyH * 0.30, 0.07], [-W * 0.03, bodyY, -L * 0.10 - L * 0.32]),
  );
  masses.push(insignia([W * 0.24, 0.06, W * 0.24], [-W * 0.20, bodyY + bodyH * 0.50 + 0.02, -L * 0.24]));
  masses.push(
    // A turretless hull hands a lot of surface to faces the camera never sees,
    // so the support chassis needs a third lit run to clear R-T5's 0.5% floor
    // that the gun hulls clear on two.
    glow('conduit', [0.07, 0.08, L * 0.50], [W * 0.32, deckY + 0.06, -L * 0.04]),
    glow('beacon', [0.34, 0.26, 0.34], [W * 0.24, bodyY + bodyH * 0.50 + 0.14, L * 0.06]),
    glow('sideLamp', [0.06, 0.54, 1.50], [-W * 0.46, deckY + 0.28, L * 0.10]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Scoop, pos: [0, deckY, L * 0.52] },
    { part: PartId.Hopper, pos: [-W * 0.03, bodyY + bodyH * 0.5, -L * 0.10] },
    { part: PartId.Exhaust, pos: [W * 0.34, deckY + 0.55, -L * 0.30] },
    { part: PartId.DockEntry, pos: [0, deckY, -L * 0.5] },
  ];

  return {
    key: o.key, name: o.name, faction: RECLAIM_ART_FACTION, cls: 'vehicle',
    hullLength: L, masses, sockets, hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 7. NAVAL
 *
 * `air` and `naval` are exempt from the top-heavy check (a ship's dominant mass
 * is its hull, at the waterline) and held to everything else. The Reclamation's
 * ships are the same argument as its tanks: a barge frame with cladding hung on
 * it, a fixed bow gun, and the coil off to one side of the bridge.
 * ========================================================================== */

interface ScrapShipOpts {
  key: string; name: string;
  length: number; beam: number; height: number;
  armament: 'bowGun' | 'battery';
}

function scrapShip(o: ScrapShipOpts): UnitMassList {
  const L = o.length, W = o.beam, H = o.height;
  const hullH = H * 0.34;
  const hullY = hullH * 0.5;
  const superH = H * 0.40;
  const superY = H * 0.640;

  const masses: MassDef[] = [
    primary('hull', 'taperedBox', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
      shape: { topScaleX: 1.10, topScaleZ: 0.96, shear: L * 0.05, cornerCut: 0.26 },
    }),
    primary('deck', 'plate', [W * 0.98, H * 0.08, L * 0.92], [0, hullH + H * 0.04, -L * 0.02], 'paintMed', {
      shape: { outline: taperOutline(W * 0.98, L * 0.92, 0.42, 0.86), thickness: H * 0.08, bevel: 0.05 },
    }),
    primary('bridge', 'taperedBox', [W * 0.66, superH, L * 0.30], [-W * 0.06, superY, -L * 0.12], 'paintLarge', {
      shape: { topScaleX: 0.72, topScaleZ: 0.70, shear: L * 0.05, cornerCut: 0.20 },
      plates: [
        {
          name: 'bridge.clad',
          outline: taperOutline(L * 0.26, superH * 0.62, 0.68, 0.92),
          thickness: 0.12,
          offset: [W * 0.34, 0, 0], rot: [0, Math.PI * 0.5, 1.44],
          slot: 'paintMed', group: 'bridgeClad',
        },
        {
          name: 'bridge.team',
          outline: taperOutline(L * 0.24, superH * 0.46, 0.70, 0.96),
          thickness: 0.10,
          offset: [-W * 0.34, 0.02, 0], rot: [0, Math.PI * 0.5, -1.50],
          slot: 'teamSlab', role: MassRole.TeamSlab, group: 'bridgeTeam',
        },
      ],
    }),
    // Sized so the derrick crown IS the top of the silhouette.
    primary('derrick', 'cone', [W * 0.22, H * 0.22, W * 0.22], [W * 0.20, H - H * 0.11, -L * 0.20], 'bareMetal', {
      shape: { segments: 10, rTop: 0.28 },
    }),
  ];

  if (o.armament === 'bowGun') {
    masses.push(
      // Grille, not paint: a barge hull is one enormous painted surface and
      // bible 5.4 caps painted area at 80%, so the bow shield has to be plant.
      greeble('bowMount', 'taperedBox', [W * 0.48, H * 0.16, L * 0.14], [0, hullH + H * 0.10, L * 0.30], 'grille', {
        group: 'bowGun', shape: { topScaleX: 0.72, topScaleZ: 0.70, shear: L * 0.02 },
      }),
      greeble('bowBarrel', 'cone', [0.26, L * 0.22, 0.26], [0, hullH + H * 0.15, L * 0.44], 'bareMetal', {
        rot: [Math.PI * 0.46, 0, 0], group: 'bowGun', shape: { segments: 10, rTop: 0.74 },
      }),
    );
  } else {
    masses.push(
      greeble('cells', 'greebleStrip', [W * 0.52, H * 0.14, L * 0.28], [0, hullH + H * 0.12, L * 0.26], 'grille', {
        group: 'cells', shape: { density: 2.6, seed: 0x48c2 },
      }),
      greeble('cellBarrel', 'cone', [0.30, L * 0.20, 0.30], [W * 0.14, hullH + H * 0.18, L * 0.40], 'bareMetal', {
        mirrorX: true, rot: [Math.PI * 0.44, 0, 0], group: 'cells', shape: { segments: 10, rTop: 0.72 },
      }),
    );
  }

  masses.push(
    ...arcCoil('coil', -W * 0.28, superY + superH * 0.5, -L * 0.12, W * 0.16, H - (superY + superH * 0.5)),
    ...cladding('hullSlab', L * 0.36, H * 0.26, [-W * 0.52, hullH * 0.66, L * 0.06], 0.20),
    greeble('bridgeGlass', 'plate', [W * 0.50, 0.10, superH * 0.30],
      [-W * 0.06, superY + superH * 0.14, -L * 0.12 + L * 0.15], 'glass', {
        rot: [1.30, 0, 0], group: 'bridgeGlass',
        shape: { outline: taperOutline(W * 0.50, superH * 0.30, 0.80), thickness: 0.10, bevel: 0.03 },
      }),
    // Bare metal, not paint: a barge is 80% painted hull by area and bible 5.4
    // caps that at 80%, so the deck plant has to carry real metal.
    greeble('tender', 'cylinder', [0.40, 1.30, 0.40], [W * 0.36, hullH + H * 0.12, -L * 0.26], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], group: 'tender', shape: { segments: 10, rTop: 0.86 },
    }),
    greeble('rail', 'greebleStrip', [0.16, 0.22, L * 0.72], [W * 0.44, hullH + H * 0.12, 0], 'bareMetal', {
      mirrorX: true, group: 'rails', shape: { density: 2.2, seed: 0x7a11 },
    }),
    greeble('sternWinch', 'cylinder', [0.46, W * 0.34, 0.46], [-W * 0.14, hullH + H * 0.14, -L * 0.38], 'bareMetal', {
      rot: [0, 0, Math.PI * 0.5], group: 'winch', shape: { segments: 10, rTop: 1 },
    }),
    greeble('ram', 'hull', [W * 0.34, hullH * 0.62, L * 0.10], [0, hullY, L * 0.50], 'bareMetal', {
      group: 'ram',
      shape: {
        points: [
          [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0, 0.10, 0.5],
          [-0.34, -0.5, -0.5], [0.34, -0.5, -0.5], [0, -0.26, 0.34],
        ],
      },
    }),
  );

  masses.push(
    slab('hullStripe', [0.08, hullH * 0.26, L * 0.66], [W * 0.48, hullH * 0.72, -L * 0.02], { mirrorX: true }),
    slab('bridgeCap', [W * 0.30, 0.08, L * 0.16], [-W * 0.06, superY + superH * 0.5, -L * 0.12]),
    slab('deckPatch', [W * 0.46, 0.08, L * 0.14], [0, hullH + H * 0.09, L * 0.08]),
  );
  masses.push(insignia([W * 0.32, 0.06, W * 0.32], [0, hullH + H * 0.09, -L * 0.30]));
  masses.push(
    glow('conduit', [0.07, 0.10, L * 0.52], [W * 0.30, hullH + H * 0.10, -L * 0.04]),
    glow('bridgeGlow', [W * 0.54, 0.24, 0.06], [-W * 0.06, superY + superH * 0.28, -L * 0.12 + L * 0.15]),
    glow('navLight', [0.30, 0.26, 0.06], [W * 0.36, hullH + H * 0.18, L * 0.32], { mirrorX: true }),
  );

  return {
    key: o.key, name: o.name, faction: RECLAIM_ART_FACTION, cls: 'naval',
    hullLength: L, masses, hullNumber: HULL_NUMBER,
    sockets: [
      { part: PartId.MuzzleA, pos: [0, hullH + H * 0.18, L * 0.50] },
      { part: PartId.Exhaust, pos: [W * 0.20, H, -L * 0.20] },
      { part: PartId.Emitter, pos: [-W * 0.28, H, -L * 0.12] },
    ],
  };
}

/* ==========================================================================
 * 8. THE SWARMHORNET — the Reclamation flyer
 *
 * A lifting body with the wings hung on external pylons rather than faired into
 * the fuselage, so the frame-and-cladding language survives at 11 m span. Both
 * wings mirror (a flyer with one wing is not asymmetric, it is falling); the
 * ASYMMETRY lives in the coil and the salvage pod under the port wing.
 * ========================================================================== */

function scrapFlyer(key: string, name: string, L: number, S: number, H: number): UnitMassList {
  const fuseH = H * 0.42;
  const fuseY = H * 0.640;
  const wingY = fuseY - fuseH * 0.16;

  const masses: MassDef[] = [
    primary('foreBody', 'taperedBox', [S * 0.20, fuseH, L * 0.54], [0, fuseY, L * 0.16], 'paintLarge', {
      shape: { topScaleX: 0.78, topScaleZ: 0.70, shear: L * 0.08, cornerCut: 0.10 },
    }),
    primary('aftBoom', 'taperedBox', [S * 0.15, fuseH * 0.74, L * 0.46], [0, fuseY - fuseH * 0.04, -L * 0.26], 'paintMed', {
      shape: { topScaleX: 0.60, topScaleZ: 0.56, shear: -L * 0.06 },
    }),
    // Swept trapezoidal wing, hung on a pylon. The rotation is what makes it a
    // wing and not a plank, and it also takes its axis-aligned surface to zero.
    primary('wing', 'plate', [S * 0.42, H * 0.09, L * 0.34], [S * 0.26, wingY, -L * 0.04], 'paintLarge', {
      mirrorX: true, rot: [0, -0.32, 0.14],
      shape: { outline: taperOutline(S * 0.42, L * 0.34, 0.44, 0.94), thickness: H * 0.09, bevel: 0.04 },
    }),
    primary('fin', 'plate', [0.14, H * 0.28, L * 0.20], [S * 0.15, H - H * 0.15, -L * 0.40], 'paintMed', {
      mirrorX: true, rot: [0, 0, 1.28],
      shape: { outline: taperOutline(H * 0.28, L * 0.20, 0.40, 0.88), thickness: 0.14, bevel: 0.03 },
    }),
  ];

  masses.push(
    greeble('nose', 'cone', [S * 0.17, L * 0.20, S * 0.17], [0, fuseY, L * 0.52], 'paintMed', {
      rot: [-Math.PI * 0.5, 0, 0], group: 'nose', shape: { segments: 12, rTop: 0.16 },
    }),
    greeble('canopy', 'plate', [S * 0.15, 0.09, L * 0.22], [0, fuseY + fuseH * 0.44, L * 0.18], 'glass', {
      rot: [-0.28, 0, 0], group: 'canopy',
      shape: { outline: taperOutline(S * 0.15, L * 0.22, 0.46), thickness: 0.09, bevel: 0.03 },
    }),
    ...arcCoil('coil', -S * 0.09, fuseY + fuseH * 0.46, -L * 0.12, S * 0.07, H - (fuseY + fuseH * 0.46)),
    greeble('intake', 'greebleStrip', [S * 0.09, fuseH * 0.34, L * 0.16], [S * 0.12, fuseY - fuseH * 0.12, L * 0.04], 'grille', {
      mirrorX: true, group: 'intakes', shape: { density: 3.2, seed: 0x1f0d },
    }),
    greeble('pylon', 'taperedBox', [0.14, H * 0.10, L * 0.10], [S * 0.24, wingY - H * 0.07, -L * 0.03], 'bareMetal', {
      mirrorX: true, group: 'pylons', shape: { topScaleX: 0.6 },
    }),
    // The salvage pod hangs under the PORT wing only.
    greeble('pod', 'cylinder', [0.26, L * 0.24, 0.26], [-S * 0.24, wingY - H * 0.13, -L * 0.02], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], group: 'pod', shape: { segments: 10, rTop: 0.82 },
    }),
    greeble('skid', 'taperedBox', [S * 0.06, H * 0.11, L * 0.11], [S * 0.11, fuseY - fuseH * 0.52, -L * 0.02], 'paintTiny', {
      mirrorX: true, group: 'skids', shape: { topScaleZ: 0.7 },
    }),
    greeble('thruster', 'cylinder', [S * 0.13, 0.24, S * 0.13], [0, fuseY, -L * 0.50], 'bareMetal', {
      rot: [Math.PI * 0.5, 0, 0], group: 'thruster', shape: { segments: 12, rTop: 0.80, capChamfer: 0.03 },
    }),
  );

  masses.push(
    slab('wingBand', [S * 0.20, 0.07, L * 0.10], [S * 0.28, wingY + H * 0.05, -L * 0.04], { mirrorX: true }),
    slab('finFlash', [0.07, H * 0.16, L * 0.09], [S * 0.18, H - H * 0.16, -L * 0.40], { mirrorX: true }),
    slab('spine', [S * 0.08, 0.07, L * 0.22], [0, fuseY + fuseH * 0.5, -L * 0.05]),
  );
  masses.push(insignia([S * 0.12, 0.06, S * 0.12], [S * 0.28, wingY + H * 0.06, -L * 0.04]));
  masses.push(
    glow('afterglow', [S * 0.12, 0.16, 0.06], [0, fuseY, -L * 0.54]),
    glow('tipLight', [0.09, 0.20, L * 0.18], [S * 0.44, wingY + H * 0.02, -L * 0.04], { mirrorX: true }),
  );

  return {
    key, name, faction: RECLAIM_ART_FACTION, cls: 'air',
    hullLength: L, masses, hullNumber: HULL_NUMBER,
    sockets: [
      { part: PartId.MuzzleA, pos: [S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.MuzzleB, pos: [-S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.Exhaust, pos: [0, fuseY, -L * 0.54] },
    ],
  };
}

/* ==========================================================================
 * 9. THE ROSTER
 *
 * Dimensions come off the same scale ladder the shipped rosters use. The
 * Grinder is a 6.2 m hull against the Grizzly's 6.6, the Rhino's 7.0 and the
 * Solarch's 6.4 — the smallest main line in the game, which is the "cheap and
 * frail" read the stat block promises.
 * ========================================================================== */

export const RECLAIM_UNIT_MASS_LISTS: readonly UnitMassList[] = [
  scrapInfantry({ key: 'reclaim_picker', name: 'Scrap Picker', weapon: 'prod', pack: 'coil' }),
  scrapInfantry({ key: 'reclaim_slagger', name: 'Slagger', weapon: 'satchel', pack: 'hopper' }),
  scrapInfantry({ key: 'reclaim_tinker', name: 'Tinker', weapon: 'tool', pack: 'roll' }),

  scrapHull({
    key: 'reclaim_grinder', name: 'Grinder',
    hullLength: 6.2, hullWidth: 3.2, height: 2.55, gun: 'arc', wheels: 3,
  }),
  scrapHull({
    key: 'reclaim_spitter', name: 'Arcspitter',
    hullLength: 5.4, hullWidth: 2.8, height: 2.30, gun: 'spit', wheels: 2,
  }),
  scrapHull({
    key: 'reclaim_slaghurler', name: 'Slaghurler',
    hullLength: 6.4, hullWidth: 3.1, height: 2.70, gun: 'mortar', wheels: 3,
  }),
  scrapSupport({
    key: 'reclaim_scrapper', name: 'Scrapjaw',
    hullLength: 8.6, hullWidth: 4.0, height: 3.35, role: 'scrapper',
  }),
  scrapSupport({
    key: 'reclaim_crawler', name: 'Yardcrawler',
    hullLength: 9.0, hullWidth: 4.4, height: 3.85, role: 'crawler',
  }),

  scrapShip({ key: 'reclaim_scow', name: 'Slag Scow', length: 10.0, beam: 3.8, height: 3.0, armament: 'bowGun' }),
  scrapShip({ key: 'reclaim_hulk', name: 'Reclaimed Hulk', length: 15.0, beam: 4.8, height: 4.4, armament: 'battery' }),

  scrapFlyer('reclaim_hornet', 'Swarmhornet', 10.0, 10.6, 2.9),
];

/** key -> mass list, for anything that wants the geometry rather than the model. */
export const RECLAIM_UNIT_MASS_BY_KEY: ReadonlyMap<string, UnitMassList> =
  new Map(RECLAIM_UNIT_MASS_LISTS.map((u) => [u.key, u]));

/**
 * Content key -> model key. The content vocabulary belongs to
 * `src/data/Defs.ts`; this is the one place the two namespaces meet, exactly as
 * `CONTENT_TO_MODEL` does it in `units.system.ts`.
 */
export const RECLAIM_UNIT_MODELS: Readonly<Record<string, string>> = {
  rclPicker: 'reclaim_picker',
  rclSlagger: 'reclaim_slagger',
  rclTinker: 'reclaim_tinker',
  rclScrapper: 'reclaim_scrapper',
  rclSpitter: 'reclaim_spitter',
  rclGrinder: 'reclaim_grinder',
  rclSlaghurler: 'reclaim_slaghurler',
  rclCrawler: 'reclaim_crawler',
  rclHornet: 'reclaim_hornet',
  rclScow: 'reclaim_scow',
  rclHulk: 'reclaim_hulk',
};

/* ==========================================================================
 * 10. BUILD AND HAND OFF
 *
 * A PRIVATE library on a PRIVATE `GreebleFactory`, and both words matter.
 * `UnitLibrary.build` derives its atlas key from `list.faction`, and both the
 * shared `unitLibrary` (filled by `units.system.ts`) and the Pact's private one
 * are alive in the same boot. Sharing a factory would mean this palette either
 * collided with the Soviet atlas or won it, depending on init order. A private
 * factory makes the question unanswerable rather than answered-by-luck, at a
 * cost of one extra material for the whole army.
 * ========================================================================== */

export const reclaimUnitLibrary = new UnitLibrary(new GreebleFactory());

/** Translate a built model into the bridge's shape. Mirrors `units.system.ts`. */
function toKindMesh(m: UnitModel): KindMesh {
  const sockets: BridgeSocket[] = m.sockets.map((s) => ({
    part: s.part, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, followsTurret: false,
  }));
  // Kept for completeness rather than exercised: no Reclamation mass list sets
  // `turret: true`, so `m.turretSockets` is always empty and `m.turret` is null.
  for (const s of m.turretSockets) {
    sockets.push({
      part: s.part,
      x: s.x + m.turretPivot[0], y: s.y + m.turretPivot[1], z: s.z + m.turretPivot[2],
      yaw: s.yaw, pitch: s.pitch, followsTurret: true, pivotY: m.turretPivot[1],
    });
  }
  return {
    geometry: m.hull,
    material: m.material,
    parts: m.turret === null ? undefined : [{
      geometry: m.turret,
      material: m.material,
      x: m.turretPivot[0], y: m.turretPivot[1], z: m.turretPivot[2],
      followsTurret: true,
      part: PartId.Turret,
      castShadow: true,
      receiveShadow: true,
    }],
    sockets,
    turretPivotY: m.turretPivot[1],
    castShadow: true,
    receiveShadow: true,
  };
}

export interface ReclaimBuildReport {
  models: UnitModel[];
  failed: string[];
  registrations: number;
  bound: number;
}

/**
 * Build every Reclamation hull and publish it to `RenderBridge`.
 *
 * `unitId` is `resolveDefBinding().unitId` — content key -> def index. Passing
 * it in rather than resolving it here keeps this module free of any dependency
 * on `src/game/**`, which is the same discipline `sim/AIStrategy.ts` follows
 * with `DefLookup`.
 *
 * REGISTRATION FACTION. Per-def models go on at `FACTION_ANY` because each of
 * these defIds belongs to exactly one army and can never resolve for another.
 * The per-KIND defaults go on at `Faction.Reclaim`, which is now a REAL slot
 * rather than the wildcard: `RenderBridge.factionSlot()` is derived from
 * `FACTION_COUNT`, and `FACTION_COUNT` went 4 -> 5 with this faction, so slot 4
 * is its own. That is a change in behaviour from the Meridian pass, where slot
 * 3 folded onto the wildcard — and it is the correct one, because a
 * `(kind, Reclaim, -1)` default must not become the last-resort entry for
 * everybody.
 */
export function buildAndRegisterReclaimUnits(
  atlasSize: number,
  unitId: Readonly<Record<string, number>>,
): ReclaimBuildReport {
  const models: UnitModel[] = [];
  const failed: string[] = [];

  for (const list of RECLAIM_UNIT_MASS_LISTS) {
    try {
      models.push(reclaimUnitLibrary.build(list, RECLAIM_UNIT_PALETTE, atlasSize, RECLAIM_ATLAS_SEED));
    } catch (err) {
      // One bad mass list must not take the roster — or the render — down.
      failed.push(`${list.key}: ${String(err)}`);
    }
  }

  const meshes = new Map<string, KindMesh>();
  const meshFor = (key: string): KindMesh | null => {
    const model = reclaimUnitLibrary.get(key);
    if (model === undefined) return null;
    let mesh = meshes.get(key);
    if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
    return mesh;
  };

  let registrations = 0;
  let bound = 0;
  for (const [contentKey, modelKey] of Object.entries(RECLAIM_UNIT_MODELS)) {
    const mesh = meshFor(modelKey);
    const model = reclaimUnitLibrary.get(modelKey);
    if (mesh === null || model === undefined) continue;
    const kind = model.cls === 'infantry' ? EntityKind.Infantry : EntityKind.Vehicle;
    const defId = unitId[contentKey];
    if (defId !== undefined && defId >= 0) {
      registerKindMesh(kind, FACTION_ANY, mesh, defId);
      registrations++;
      bound++;
    }
  }

  // Per-kind defaults, so a Reclamation entity spawned with defId -1 (a scenario
  // placement, a debug spawn) draws Reclamation art instead of the bridge's
  // hazard box.
  const picker = meshFor('reclaim_picker');
  const grinder = meshFor('reclaim_grinder');
  if (picker !== null) {
    registerKindMesh(EntityKind.Infantry, Faction.Reclaim, picker, -1);
    registrations++;
  }
  if (grinder !== null) {
    registerKindMesh(EntityKind.Vehicle, Faction.Reclaim, grinder, -1);
    registrations++;
  }

  return { models, failed, registrations, bound };
}

/** Release every Reclamation geometry, material and atlas. */
export function disposeReclaimUnits(): void {
  reclaimUnitLibrary.dispose();
}
