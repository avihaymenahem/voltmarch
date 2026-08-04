/**
 * ============================================================================
 * src/art/Faction3Units.ts — THE MERIDIAN PACT, AS UNIT ART
 * ============================================================================
 * The third army's eleven hulls, its unit palette, and the two calls that put
 * them on screen. Nothing here edits `MassList.ts`, `UnitFactory.ts`,
 * `Greeble.ts` or `UnitDefs.ts` — it imports all four and adds beside them.
 *
 *
 * WHY THE PACT DOES NOT LOOK LIKE EITHER EXISTING ARMY
 * ----------------------------------------------------
 * Bible 5.7 separates the Allies and the Soviets on ONE axis — welded ceramic
 * monocoque against bolted plate — and RA3 gets away with that because there
 * are only two of them. A third army placed on the same axis lands in the
 * middle and reads as "the other one". So the Pact is separated on axes the
 * other two do not use at all:
 *
 *   SILHOUETTE   Nothing the Pact fields touches the ground. Every hull rides
 *                a wide OCTAGONAL PLENUM SKIRT that is broader than the body
 *                above it, so the family reads bottom-heavy in plan and
 *                top-heavy in elevation. The Allies stand on proud tracks and
 *                the Soviets on proud tracks; the Pact stands on a shadow.
 *
 *   PLAN         Every load-bearing volume is a HEXAGONAL or OCTAGONAL prism
 *                or a LATHED DRUM. There is not one axis-aligned rectangular
 *                primary mass in the roster, which is the de-boxify gate's
 *                whole point and is why the measured `axisFraction` on these
 *                lists is near zero rather than near the Soviet 0.80.
 *
 *   FURNITURE    Where an Allied hull carries stowage and an aerial and a
 *                Soviet hull carries an exhaust stack and a bolt ring, a Pact
 *                hull carries a CANTED MIRROR VANE. It is on all eleven of
 *                them, it is the thing that makes the army legible at 40 m,
 *                and it is the visual half of the faction's mechanical
 *                signature (see the power argument in src/data/Defs.ts §6).
 *
 *   PALETTE      Warm bone ceramic, JADE team slabs, GOLD emissive. The other
 *                two armies own cool-grey/cobalt/cyan and olive/crimson/orange
 *                respectively; every one of those three channels moves here.
 *
 *
 * SURFACE DISCIPLINE
 * ------------------
 * The texture overhaul is honoured exactly: large flat colour areas, crisp
 * geometric panel lines, vector insignia, ZERO noise. That is not a choice this
 * file gets to make — it is carried by `Greeble.ts`'s painters, and everything
 * here does is choose `plating: 'welded'` (via `rivets: false`) and a gloss
 * that suits fired ceramic. No speckle is reachable from this file.
 *
 *
 * PRIMITIVES
 * ----------
 * Authored in the three primitives `UnitFactory.buildUnit` actually dispatches
 * on today — `box`, `lathe`, `prism`. `Shapes.ts`'s eight new primitives are
 * deliberately NOT used yet: `buildUnit`'s mass loop still ends in
 * `default: buildBox(...)`, so a `revolve` or a `tracks` mass would VALIDATE
 * against its real shape and RENDER as a plain box — strictly worse than
 * authoring the lathe outright. The moment §6.1 of the shape-language brief
 * lands in `UnitFactory.ts`, every `prism` here becomes a `planPrism` and every
 * `lathe` a `revolve` with no other change; the measured boxiness will fall
 * further, not rise.
 * ============================================================================
 */

import { UNIT_LADDER, type UnitPalette } from '../core/config';
import { EntityKind, Faction, PartId } from '../core/types';
import { GreebleFactory } from './Greeble';
import { MassRole, type MassDef, type SocketSpec, type UnitMassList } from './MassList';
import { UnitLibrary, type UnitModel } from './UnitFactory';
import {
  FACTION_ANY, registerKindMesh, type KindMesh, type SocketSpec as BridgeSocket,
} from '../render/RenderBridge';

/* ==========================================================================
 * 1. THE PALETTE
 * ========================================================================== */

/**
 * THE PACT HULL PALETTE. Same shape as `RA3_ALLIES` / `RA3_SOVIETS` in
 * config.ts, and authored here only because `RA3_UNIT_PALETTE` is a
 * three-member record in a file this module does not own. When
 * `RA3_UNIT_PALETTE.meridian` lands, this constant moves across verbatim.
 *
 * R12 is respected the same way the other two are: `base` is NOT a faction
 * colour. It is fired bone ceramic, and the jade only ever reaches a surface
 * through the `teamSlab` tile, in flat plates measuring 8-14% of the hull.
 */
export const MERIDIAN_UNIT_PALETTE: UnitPalette = {
  /** Fired bone ceramic. Warmer and lighter than Allied grey, far off olive. */
  base: '#C9BFA6',
  shadow: '#3A3226',
  /** Jade. The third primary — neither cobalt nor crimson. */
  team: '#0FA98C',
  teamSecondary: '#0A6E5C',
  /** A radiant rosette rather than an eagle or a star. `Greeble.ts` offers two
   *  glyphs; the star reads as a sun disc under the Pact's gold, which is the
   *  right answer until a third glyph exists. */
  insignia: 'star',
  insigniaColor: '#F2C544',
  hullNumber: 6151,
  /** Gold collector glow. Allied cyan and Soviet furnace orange are both taken. */
  emissive: '#FFC24A',
  bareMetal: '#5D5045',
  /** Read as the plenum skirt's shadow gap rather than as track links. */
  trackLink: '#241C14',
  glass: '#1E3A38',
  stencil: '#E4DCC8',
  hazard: '#E5CB43',
  /** Welded ceramic monocoque, like the Allies. The Pact is not a bolt culture. */
  rivets: false,
};

/**
 * WHICH SURFACE LANGUAGE THE MASS LISTS DECLARE.
 *
 * `UnitMassList.faction` is the union `'allies' | 'soviets' | 'neutral'` in
 * `MassList.ts`, which is not this module's file. The field is read for exactly
 * two things: `defaultChamfer()`'s per-faction fraction, and `validateUnit()`'s
 * "skip team-colour and insignia checks when neutral".
 *
 * `'allies'` is therefore the correct declaration and not a workaround:
 *   - it selects the 10.0% chamfer fraction, which is the welded-ceramic
 *     language the Pact shares with the Allies (the Soviet 7.5% is a bolted
 *     plate figure), and
 *   - it keeps the team-colour band and the one-insignia rule ENFORCED, which
 *     `'neutral'` would silently switch off — the single worst thing that could
 *     happen to a brand new roster.
 *
 * It does not leak Allied colour anywhere: the atlas is built from
 * `MERIDIAN_UNIT_PALETTE` on a private `GreebleFactory`, so the Pact's textures
 * are its own regardless of what this string says.
 */
export const MERIDIAN_ART_FACTION: UnitMassList['faction'] = 'allies';

/** Deterministic, so the atlas is diffable between runs. */
const MERIDIAN_ATLAS_SEED = 0x4d_52;

/** Four-digit stencil, shared by the whole army. */
const HULL_NUMBER = MERIDIAN_UNIT_PALETTE.hullNumber;

/* ==========================================================================
 * 2. MASS CONSTRUCTORS
 *
 * Same five shorthands `UnitDefs.ts` uses, because the validator counts roles
 * and a second vocabulary for the same five roles would be a bug farm.
 * ========================================================================== */

type V3 = readonly [number, number, number];

interface SlabOpts { turret?: boolean; mirrorX?: boolean; rot?: V3; }

/** A flat jade panel let into the hull. R-T2: a quad, never a gradient. */
function slab(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.TeamSlab, size, anchor,
    slot: 'teamSlab', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.mirrorX ? { mirrorX: true } : {}),
    ...(o.rot ? { rot: o.rot } : {}),
  };
}

/** THE one insignia decal (R-T4). Exactly one per unit or the build is rejected. */
function insignia(size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name: 'insignia', primitive: 'box', role: MassRole.Insignia, size, anchor,
    slot: 'insignia', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.rot ? { rot: o.rot } : {}),
  };
}

/** A masked emissive panel. R-T5: 0.5-3% of surface, clean rectangles only. */
function glow(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.Emissive, size, anchor,
    slot: 'emissive', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
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
 * 3. THE TWO SUB-ASSEMBLIES THAT MAKE THE ARMY
 * ========================================================================== */

/**
 * THE PLENUM SKIRT — the Pact's answer to the proud track pair.
 *
 * Bible 5.3 asks a ground vehicle for a base that protrudes outboard and stands
 * 18-25% of unit height; the Allies and Soviets both answer with tracks. The
 * Pact answers with one OCTAGONAL prism wider than the hull above it, its walls
 * slotted as `grille` so the intake plenum reads as dark plant against the bone
 * body — the same tonal job the near-black track links do, with none of the
 * same shape. Two lift-fan discs sit inboard of it so the skirt reads as
 * machinery rather than as a plinth.
 *
 * `outboard` is the skirt half-width over the hull half-width. 1.22 puts the
 * turret/hull width ratio at 1.02/1.22 = 0.84, dead centre of R8's 0.75-0.95.
 */
function plenumSkirt(hullWidth: number, skirtHeight: number, length: number, fans: number): MassDef[] {
  const w = hullWidth * 1.22;
  const out: MassDef[] = [
    primary('skirt', 'prism', [w, skirtHeight, length], [0, skirtHeight * 0.5, 0], 'grille', {
      plan: 'octagon', capSlot: 'paintSmall', chamfer: 0.06,
    }),
  ];
  const r = skirtHeight * 1.30;
  for (let i = 0; i < fans; i++) {
    const z = -length * 0.34 + (length * 0.68 * i) / Math.max(1, fans - 1);
    out.push(greeble(`fan${i}`, 'lathe', [r, skirtHeight * 0.42, r], [hullWidth * 0.36, skirtHeight * 0.30, z], 'bareMetal', {
      // The fan run is ONE readable object, so all of them share a group and
      // cost a single slot against bible 5.3's 6-12 detail budget.
      mirrorX: true, profile: 'disc', segments: 12, group: 'liftFans',
    }));
  }
  return out;
}

/**
 * THE MIRROR VANE — the faction cue, on all eleven hulls.
 *
 * A canted collector panel with a gold strip along its leading edge. Rotated on
 * two axes on purpose: a vane that lay flat would read as a hatch, and the
 * whole point is that the Pact's hardware is visibly harvesting light.
 */
function mirrorVane(
  name: string, span: number, chord: number, anchor: V3, tilt: number, o: Partial<MassDef> = {},
): MassDef[] {
  return [
    greeble(name, 'box', [span, 0.10, chord], anchor, 'stripe', {
      rot: [tilt, 0, 0.16], group: name, faceSlots: { py: 'glass' }, chamfer: 0.03, ...o,
    }),
    greeble(`${name}.spar`, 'box', [0.11, 0.11, chord * 0.92], [anchor[0], anchor[1] - 0.16, anchor[2]], 'bareMetal', {
      rot: [tilt, 0, 0.16], group: name, chamfer: 0.02, ...o,
    }),
  ];
}

/**
 * The furniture every Pact hull carries. Five discrete objects, all >= 0.14 m
 * so nothing is sub-pixel at gameplay zoom.
 */
function pactGreebles(hullW: number, hullL: number, deckY: number): MassDef[] {
  return [
    greeble('radiator', 'box', [hullW * 0.30, 0.24, hullL * 0.18], [-hullW * 0.30, deckY + 0.12, -hullL * 0.34], 'vent', {
      mirrorX: true, group: 'radiators',
    }),
    greeble('capacitor', 'lathe', [0.30, 0.58, 0.30], [hullW * 0.32, deckY + 0.29, -hullL * 0.30], 'bareMetal', {
      mirrorX: true, profile: 'capsule', segments: 12, group: 'capacitors',
    }),
    greeble('lamp', 'box', [0.28, 0.22, 0.16], [hullW * 0.30, deckY - 0.06, hullL * 0.44], 'paintTiny', {
      mirrorX: true, faceSlots: { pz: 'glass' }, group: 'lamps',
    }),
    greeble('towEye', 'lathe', [0.22, 0.30, 0.22], [hullW * 0.20, deckY - 0.24, hullL * 0.47], 'bareMetal', {
      mirrorX: true, profile: 'disc', segments: 10, rot: [0, 0, Math.PI * 0.5], group: 'towEyes',
    }),
    greeble('deckLouvre', 'box', [hullW * 0.44, 0.10, hullL * 0.18], [0, deckY + 0.05, -hullL * 0.20], 'paintTiny', {
      faceSlots: { py: 'grille' }, group: 'louvres',
    }),
  ];
}

/* ==========================================================================
 * 4. INFANTRY
 *
 * R-S4: 0.30-0.38 x a 7 m MBT hull. The Pact silhouette differs from a
 * Conscript's at 20 px by three things and only three: a CONICAL helmet where
 * the other two armies wear domes, a hard SHOULDER MANTLE plate, and the vane
 * on the pack. Everything below the waist is deliberately identical, because
 * legs at that pixel count are two smudges whatever you do to them.
 * ========================================================================== */

interface PactInfantryOpts {
  key: string;
  name: string;
  /** 'carbine' | 'lance' | 'tool' — the held object and nothing else. */
  weapon: 'carbine' | 'lance' | 'tool';
  /** 'vane' collector pack | 'cells' battery stack | 'kit' artificer's case. */
  pack: 'vane' | 'cells' | 'kit';
}

function pactInfantry(o: PactInfantryOpts): UnitMassList {
  const H = UNIT_LADDER.infantryHeightMeters;      // 2.2 m
  const W = UNIT_LADDER.infantryWidthMeters;       // 0.78 m shoulder span
  const legTop = H * 0.415;
  const torsoH = H * 0.415;
  const torsoY = legTop + torsoH * 0.5;            // 0.623 H — the dominant mass

  const masses: MassDef[] = [
    primary('leg', 'box', [W * 0.34, legTop, W * 0.44], [W * 0.24, legTop * 0.5, 0], 'paintSmall', {
      mirrorX: true, taper: [1.22, 1.08, 0.02],
    }),
    // Hexagonal torso: the Pact's plan language reaches all the way down to a
    // 2 m figure, and it is what stops the silhouette reading as a Conscript.
    primary('torso', 'prism', [W * 0.86, torsoH, W * 0.86], [0, torsoY, 0], 'paintMed', {
      plan: 'hexagon', capSlot: 'paintSmall',
    }),
    // Conical helmet, not a dome. One shape, read at any distance.
    primary('helmet', 'lathe', [W * 0.58, H * 0.150, W * 0.60], [0, legTop + torsoH + H * 0.050, 0.01], 'paintSmall', {
      profile: 'cone', segments: 12, topRadius: 0.34,
    }),
    primary('arm', 'box', [W * 0.24, torsoH * 0.86, W * 0.28], [W * 0.52, torsoY + 0.02, 0.06], 'paintSmall', {
      mirrorX: true, rot: [0.12, 0, -0.06],
    }),
  ];

  if (o.weapon === 'lance') {
    masses.push(greeble('lanceTube', 'lathe', [0.19, 1.06, 0.19], [W * 0.50, torsoY + 0.20, 0.22], 'bareMetal', {
      profile: 'cyl', segments: 12, topRadius: 0.84, rot: [1.30, 0, 0.10], group: 'lance',
    }));
    masses.push(greeble('lanceRing', 'lathe', [0.30, 0.16, 0.30], [W * 0.50, torsoY + 0.52, 0.54], 'bareMetal', {
      profile: 'disc', segments: 12, rot: [1.30, 0, 0.10], group: 'lance',
    }));
  } else if (o.weapon === 'tool') {
    masses.push(greeble('toolArm', 'lathe', [0.15, 0.74, 0.15], [W * 0.52, torsoY - 0.10, 0.34], 'bareMetal', {
      profile: 'cyl', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'tool',
    }));
    masses.push(greeble('toolHead', 'prism', [0.26, 0.22, 0.22], [W * 0.52, torsoY - 0.10, 0.74], 'paintTiny', {
      plan: 'hexagon', capSlot: 'paintTiny', group: 'tool',
    }));
  } else {
    masses.push(greeble('carbine', 'box', [0.10, 0.16, 0.94], [W * 0.44, torsoY - 0.04, 0.24], 'bareMetal', {
      rot: [0.18, 0.06, 0], group: 'carbine',
    }));
    masses.push(greeble('cell', 'box', [0.09, 0.20, 0.13], [W * 0.44, torsoY - 0.20, 0.16], 'paintTiny', { group: 'carbine' }));
  }

  if (o.pack === 'cells') {
    masses.push(greeble('cellStack', 'prism', [W * 0.56, 0.44, 0.24], [0, torsoY + 0.10, -W * 0.42], 'paintSmall', {
      plan: 'hexagon', capSlot: 'paintTiny', group: 'pack',
    }));
  } else if (o.pack === 'kit') {
    masses.push(greeble('kit', 'box', [W * 0.62, 0.42, 0.22], [0, torsoY + 0.06, -W * 0.42], 'paintSmall', {
      group: 'pack', chamfer: 0.05,
    }));
  } else {
    masses.push(greeble('collector', 'box', [W * 0.52, 0.40, 0.20], [0, torsoY + 0.10, -W * 0.42], 'paintSmall', { group: 'pack' }));
  }
  // The faction cue, at infantry scale: a folded vane over the shoulder.
  masses.push(...mirrorVane('vane', W * 0.66, 0.34, [0, torsoY + 0.44, -W * 0.30], -0.55));

  masses.push(
    // Sized so every variant tops out at exactly H whatever it carries, so the
    // R-S4 height ratio cannot swing with the backpack.
    greeble('crest', 'lathe', [0.06, H * 0.13, 0.06], [-W * 0.16, H - H * 0.065, -0.05], 'bareMetal', {
      profile: 'cyl', segments: 8, group: 'crest',
    }),
    greeble('boot', 'box', [W * 0.40, 0.16, W * 0.62], [W * 0.24, 0.08, 0.06], 'paintTiny', { mirrorX: true, group: 'boots' }),
    greeble('belt', 'box', [W * 0.90, 0.12, W * 0.66], [0, torsoY - torsoH * 0.34, 0], 'paintTiny', { group: 'belt' }),
    greeble('gorget', 'box', [W * 0.60, 0.11, W * 0.50], [0, legTop + torsoH - 0.03, 0], 'paintTiny', { group: 'gorget' }),
  );

  // R-T1 for infantry is 20-28% of surface: chest, both mantles, helmet band,
  // thigh bands. Sizes are the proven ones from the shipped roster.
  masses.push(
    slab('chestPlate', [W * 0.72, torsoH * 0.66, 0.06], [0, torsoY + 0.04, W * 0.32]),
    slab('mantle', [W * 0.34, 0.34, W * 0.44], [W * 0.44, torsoY + torsoH * 0.30, 0], { mirrorX: true }),
    slab('helmBand', [W * 0.58, 0.12, W * 0.62], [0, legTop + torsoH + H * 0.030, 0.01]),
    slab('thighBand', [W * 0.42, 0.20, W * 0.50], [W * 0.24, legTop * 0.72, 0], { mirrorX: true }),
  );
  masses.push(insignia([0.26, 0.26, 0.05], [W * 0.30, torsoY + torsoH * 0.24, W * 0.33]));
  masses.push(
    glow('visor', [W * 0.46, 0.14, 0.05], [0, legTop + torsoH + H * 0.030, W * 0.29]),
    glow('packLamp', [W * 0.30, 0.16, 0.05], [0, torsoY + 0.24, -W * 0.53]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.MuzzleA, pos: [W * 0.44, torsoY + 0.02, 0.78] },
    { part: PartId.Emitter, pos: [0, torsoY, 0] },
  ];

  return {
    key: o.key,
    name: o.name,
    faction: MERIDIAN_ART_FACTION,
    cls: 'infantry',
    hullLength: W,
    masses,
    sockets,
    hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 5. THE HOVER-TANK TEMPLATE
 *
 * The proportions are the shipped tank template's to the digit — chassis in the
 * bottom 42%, dominant mass centred at 0.655 H, turret at 1.02x the hull box —
 * because those numbers are what R8 measures and they are already proven to
 * land inside every band. What changes is every SHAPE that carries them.
 * ========================================================================== */

interface PactTankOpts {
  key: string;
  name: string;
  hullLength: number;
  hullWidth: number;
  /** Total silhouette height including the mast. */
  height: number;
  /** 'lance' single barrel | 'repeater' twin | 'emitter' beam head. */
  gun: 'lance' | 'repeater' | 'emitter';
  fans?: number;
}

function pactTank(o: PactTankOpts): UnitMassList {
  const H = o.height;
  const L = o.hullLength;
  const W = o.hullWidth;

  const skirtH = H * UNIT_LADDER.chassisHeightFraction * 0.55;
  const hullH = H * 0.215;
  const hullY = skirtH + hullH * 0.5;
  const turretH = H * 0.50;
  const turretY = H * 0.655;
  const turretW = W * UNIT_LADDER.turretWidthOverHull;
  const turretL = L * 0.74;
  const deckY = skirtH + hullH;
  const turretRoof = turretY + turretH * 0.5;

  const masses: MassDef[] = [
    ...plenumSkirt(W, skirtH, L * 0.94, o.fans ?? 4),
    // Hexagonal hull: a pointed prow and a pointed transom in plan, so the
    // flanks are four angled walls rather than two flat ones. This is the mass
    // the boxiness gate scores hardest and it has no axis-aligned wall at all.
    primary('hull', 'prism', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
      plan: 'hexagon', capSlot: 'paintLarge',
    }),
    // Lathed drum turret, tapering to a smaller crown. Deliberately oversized
    // at 1.02x the hull box (bible 5.3 — a real MBT is 0.55 and RA3 is not real).
    primary('turret', 'lathe', [turretW, turretH, turretL], [0, turretY, -L * 0.04], 'paintLarge', {
      turret: true, profile: 'cyl', segments: 14, topRadius: 0.76, capSlot: 'paintMed',
    }),
  ];

  /* -- armament ---------------------------------------------------------- */
  const muzzleZ = turretL * 0.5 + L * 0.40;
  const gunY = turretY + turretH * 0.04;
  switch (o.gun) {
    case 'repeater':
      masses.push(
        primary('barrel', 'lathe', [0.24, L * 0.58, 0.24], [W * 0.15, gunY, turretL * 0.32], 'bareMetal', {
          turret: true, mirrorX: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.88,
        }),
        greeble('muzzleRing', 'lathe', [0.34, 0.26, 0.34], [W * 0.15, gunY, turretL * 0.32 + L * 0.29], 'bareMetal', {
          turret: true, mirrorX: true, profile: 'disc', segments: 12, rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
        }),
      );
      break;
    case 'emitter':
      masses.push(
        primary('emitterHousing', 'lathe', [W * 0.46, L * 0.46, W * 0.46], [0, gunY + 0.10, turretL * 0.30], 'paintMed', {
          turret: true, profile: 'cyl', segments: 14, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.70,
        }),
        greeble('emitterCrystal', 'lathe', [W * 0.28, 0.44, W * 0.28], [0, gunY + 0.10, turretL * 0.30 + L * 0.23], 'emissive', {
          turret: true, profile: 'cone', segments: 8, topRadius: 0.22, rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
        }),
      );
      break;
    default:
      masses.push(
        primary('lance', 'lathe', [0.34, L * 0.66, 0.34], [0, gunY, turretL * 0.34], 'bareMetal', {
          turret: true, profile: 'cyl', segments: 14, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.80,
        }),
        greeble('lanceCollar', 'lathe', [0.48, 0.34, 0.48], [0, gunY, turretL * 0.34 + L * 0.30], 'bareMetal', {
          turret: true, profile: 'cyl', segments: 14, topRadius: 0.78, rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
        }),
      );
      break;
  }

  /* -- greebles ---------------------------------------------------------- */
  masses.push(
    ...pactGreebles(W, L, deckY),
    // The vane sits on the REAR DECK, not the turret roof. A rotated plate's
    // axis-aligned extent is `2*(|sx.z|*hz + ...)`, so a 1.2 m chord tilted 35
    // degrees adds 0.36 m to `bounds[1]` — and `bounds[1]` is the divisor in the
    // top-heavy check, so a vane on the roof pushes the dominant mass centre
    // out of R8's 0.60-0.70 band and rejects the whole hull.
    ...mirrorVane('vane', W * 0.46, L * 0.16, [-W * 0.20, deckY + 0.34, -L * 0.32], -0.55),
    greeble('mantlet', 'lathe', [turretW * 0.42, turretH * 0.66, turretW * 0.42], [0, gunY, turretL * 0.46], 'bareMetal', {
      turret: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0], group: 'mantlet',
    }),
    // Everything above the turret roof is sized so the silhouette tops out at
    // exactly H: an overshooting mast would push `bounds[1]` past the height
    // the top-heavy check divides by, and every hull would fail it.
    greeble('cupola', 'lathe', [turretW * 0.30, H * 0.085, turretW * 0.30], [turretW * 0.24, turretRoof + H * 0.042, -turretL * 0.10], 'hatch', {
      turret: true, profile: 'dome', segments: 12, group: 'cupola',
    }),
    greeble('sensorMast', 'lathe', [0.07, H * 0.155, 0.07], [-turretW * 0.38, H - H * 0.078, -turretL * 0.36], 'bareMetal', {
      turret: true, profile: 'cyl', segments: 8, group: 'mast',
    }),
  );

  /* -- team colour (R-T1: 8-14% of visible surface, flat slabs only) ------ */
  masses.push(
    slab('turretCheek', [0.07, turretH * 0.56, turretL * 0.52], [turretW * 0.42, turretY + turretH * 0.04, -turretL * 0.04], { turret: true, mirrorX: true }),
    slab('hullFlank', [0.07, hullH * 0.62, L * 0.50], [W * 0.46, hullY, -L * 0.06], { mirrorX: true }),
    // Top-facing slabs stay SMALL panel inserts. A turret-roof-sized plate
    // measures inside R-T1 and still reads as a repainted tank, because a
    // 39-degree camera weights a deck about 2.5x a flank.
    slab('turretCap', [turretW * 0.34, 0.07, turretL * 0.30], [-turretW * 0.14, turretRoof, -turretL * 0.02], { turret: true }),
    slab('prowBand', [W * 0.42, 0.07, L * 0.09], [0, deckY, L * 0.40], {}),
  );
  masses.push(insignia([turretW * 0.28, 0.06, turretW * 0.28], [turretW * 0.18, turretRoof + 0.02, turretL * 0.18], { turret: true }));
  masses.push(
    glow('sternLamp', [0.38, 0.26, 0.06], [W * 0.26, deckY - 0.08, -L * 0.48], { mirrorX: true }),
    glow('deckStrip', [W * 0.60, 0.06, L * 0.16], [0, deckY + 0.02, -L * 0.38]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Turret, pos: [0, turretY, -L * 0.04] },
    { part: PartId.MuzzleA, pos: [o.gun === 'repeater' ? W * 0.15 : 0, gunY, muzzleZ], turret: true },
    { part: PartId.Exhaust, pos: [W * 0.32, deckY + 0.55, -L * 0.30] },
    { part: PartId.Antenna, pos: [-turretW * 0.38, H, -turretL * 0.36], turret: true },
  ];
  if (o.gun === 'repeater') {
    sockets.push({ part: PartId.MuzzleB, pos: [-W * 0.15, gunY, muzzleZ], turret: true });
  }

  return {
    key: o.key,
    name: o.name,
    faction: MERIDIAN_ART_FACTION,
    cls: 'vehicle',
    hullLength: L,
    turretPivot: [0, turretY, -L * 0.04],
    masses,
    sockets,
    hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 6. TURRETLESS SUPPORT — the Sun Collector and the Carryall
 *
 * No turret, so the dominant mass is the superstructure and it still has to sit
 * at 0.60-0.70 H. On the Collector that is the ore drum; on the Carryall it is
 * the folded Conclave package it turns into.
 * ========================================================================== */

interface PactSupportOpts {
  key: string;
  name: string;
  hullLength: number;
  hullWidth: number;
  height: number;
  role: 'collector' | 'carryall';
}

function pactSupport(o: PactSupportOpts): UnitMassList {
  const H = o.height, L = o.hullLength, W = o.hullWidth;
  const skirtH = H * 0.30;
  const chassisH = H * 0.16;
  const chassisY = skirtH + chassisH * 0.5;
  const deckY = skirtH + chassisH;
  const bodyH = H * 0.52;
  const bodyY = H * 0.645;

  const masses: MassDef[] = [
    ...plenumSkirt(W, skirtH, L * 0.90, 5),
    primary('chassis', 'prism', [W, chassisH, L], [0, chassisY, 0], 'paintLarge', {
      plan: 'octagon', capSlot: 'paintLarge',
    }),
    // The dominant mass: an ore drum, or the folded structure package.
    primary(o.role === 'collector' ? 'drum' : 'package', 'prism',
      [W * 0.96, bodyH, L * 0.66], [0, bodyY, -L * 0.10], 'paintLarge', {
        plan: 'hexagon', capSlot: 'paintLarge',
      }),
  ];

  if (o.role === 'collector') {
    masses.push(
      // The intake throat: the second read, and the thing that says "harvester".
      primary('throat', 'prism', [W * 1.00, H * 0.26, L * 0.24], [0, deckY + H * 0.02, L * 0.42], 'paintMed', {
        plan: 'wedge', capSlot: 'stripe',
      }),
      greeble('throatTeeth', 'box', [W * 0.96, 0.14, 0.22], [0, deckY - H * 0.06, L * 0.52], 'bareMetal', { group: 'teeth' }),
      greeble('throatArm', 'lathe', [0.20, L * 0.24, 0.20], [W * 0.38, deckY + H * 0.10, L * 0.30], 'bareMetal', {
        mirrorX: true, profile: 'cyl', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'throatArms',
      }),
      greeble('drumLid', 'lathe', [W * 0.60, 0.20, L * 0.36], [0, bodyY + bodyH * 0.5, -L * 0.10], 'hatch', {
        profile: 'disc', segments: 12, group: 'lid',
      }),
      greeble('riser', 'box', [W * 0.30, 0.18, L * 0.30], [0, bodyY + bodyH * 0.28, L * 0.22], 'grille', {
        rot: [-0.32, 0, 0], group: 'riser',
      }),
    );
  } else {
    masses.push(
      primary('foreRamp', 'prism', [W * 1.06, H * 0.28, L * 0.16], [0, skirtH * 0.68, L * 0.50], 'paintMed', {
        plan: 'wedge', capSlot: 'stripe',
      }),
      greeble('rampArm', 'lathe', [0.22, L * 0.28, 0.22], [W * 0.40, skirtH * 0.86, L * 0.34], 'bareMetal', {
        mirrorX: true, profile: 'cyl', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'rampArms',
      }),
      greeble('pylon', 'lathe', [0.32, H * 0.17, 0.32], [-W * 0.26, H - H * 0.085, -L * 0.20], 'bareMetal', {
        profile: 'cone', segments: 10, topRadius: 0.40, group: 'pylon',
      }),
      greeble('jib', 'box', [0.20, 0.18, L * 0.40], [-W * 0.26, H - H * 0.115, L * 0.02], 'bareMetal', {
        rot: [0.16, 0, 0], group: 'pylon',
      }),
      greeble('packLid', 'lathe', [W * 0.56, 0.16, L * 0.32], [0, bodyY + bodyH * 0.5, -L * 0.10], 'hatch', {
        profile: 'disc', segments: 12, group: 'lid',
      }),
    );
  }

  masses.push(
    ...pactGreebles(W, L, deckY),
    // On the deck, not on the roof — same reason as the tank template's.
    ...mirrorVane('vane', W * 0.40, L * 0.14, [-W * 0.30, deckY + 0.40, -L * 0.34], -0.50),
    greeble('cabGlass', 'box', [W * 0.52, bodyH * 0.34, 0.10], [0, bodyY + bodyH * 0.16, -L * 0.10 + L * 0.33], 'paintTiny', {
      faceSlots: { pz: 'glass' }, group: 'cab',
    }),
  );

  masses.push(
    slab('bodyFlank', [0.07, bodyH * 0.46, L * 0.46], [W * 0.45, bodyY, -L * 0.10], { mirrorX: true }),
    slab('bodyCap', [W * 0.38, 0.07, L * 0.24], [W * 0.10, bodyY + bodyH * 0.5, -L * 0.10]),
    slab('chassisBand', [0.07, chassisH * 0.56, L * 0.56], [W * 0.47, chassisY, 0], { mirrorX: true }),
    slab('sternPlate', [W * 0.56, bodyH * 0.34, 0.07], [0, bodyY, -L * 0.10 - L * 0.33]),
  );
  masses.push(insignia([W * 0.26, 0.06, W * 0.26], [W * 0.22, bodyY + bodyH * 0.5 + 0.02, -L * 0.24]));
  masses.push(
    // R-T5 is measured against TOTAL triangle area including faces the camera
    // never sees, and a turretless hull has a lot of those, so the support
    // chassis needs a third strip to clear the 0.5% floor the tanks clear on two.
    glow('beacon', [0.40, 0.30, 0.40], [-W * 0.30, bodyY + bodyH * 0.5 + 0.16, -L * 0.28]),
    glow('sideLamp', [0.06, 0.62, 1.70], [W * 0.48, deckY + 0.30, L * 0.12], { mirrorX: true }),
    glow('deckStrip', [W * 0.50, 0.06, L * 0.14], [0, deckY + 0.02, -L * 0.42]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Scoop, pos: [0, deckY, L * 0.52] },
    { part: PartId.Hopper, pos: [0, bodyY + bodyH * 0.5, -L * 0.10] },
    { part: PartId.Exhaust, pos: [W * 0.32, deckY + 0.55, -L * 0.30] },
    { part: PartId.DockEntry, pos: [0, deckY, -L * 0.5] },
  ];

  return {
    key: o.key, name: o.name, faction: MERIDIAN_ART_FACTION, cls: 'vehicle',
    hullLength: L, masses, sockets, hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 7. NAVAL
 *
 * `air` and `naval` are exempt from the top-heavy check (a ship's dominant mass
 * is its hull, at the waterline) and held to everything else.
 * ========================================================================== */

interface PactShipOpts {
  key: string; name: string;
  length: number; beam: number; height: number;
  armament: 'battery' | 'lances';
}

function pactShip(o: PactShipOpts): UnitMassList {
  const L = o.length, W = o.beam, H = o.height;
  const hullH = H * 0.34;
  const hullY = hullH * 0.5;
  const superH = H * 0.42;
  const superY = H * 0.655;

  const masses: MassDef[] = [
    primary('hull', 'prism', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
      plan: 'wedge', capSlot: 'paintLarge',
    }),
    primary('deck', 'prism', [W * 0.94, H * 0.10, L * 0.90], [0, hullH + H * 0.05, -L * 0.02], 'paintMed', {
      plan: 'octagon', capSlot: 'paintLarge',
    }),
    primary('bridge', 'prism', [W * 0.72, superH, L * 0.34], [0, superY, -L * 0.10], 'paintLarge', {
      plan: 'hexagon', capSlot: 'paintLarge',
    }),
    // Sized so the mast crown IS the top of the silhouette.
    primary('mast', 'lathe', [W * 0.26, H * 0.20, W * 0.26], [0, H - H * 0.10, -L * 0.16], 'bareMetal', {
      profile: 'cone', segments: 12, topRadius: 0.36,
    }),
  ];

  if (o.armament === 'battery') {
    masses.push(
      greeble('foreMount', 'lathe', [W * 0.50, H * 0.20, W * 0.54], [0, hullH + H * 0.19, L * 0.28], 'paintMed', {
        profile: 'cyl', segments: 12, topRadius: 0.80, group: 'foreGun',
      }),
      greeble('foreBarrel', 'lathe', [0.26, L * 0.20, 0.26], [0, hullH + H * 0.21, L * 0.42], 'bareMetal', {
        profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0], group: 'foreGun',
      }),
    );
  } else {
    masses.push(
      greeble('lanceCell', 'prism', [W * 0.56, H * 0.16, L * 0.20], [0, hullH + H * 0.16, L * 0.26], 'grille', {
        plan: 'hexagon', capSlot: 'grille', group: 'cells',
      }),
      greeble('cellLid', 'box', [W * 0.58, 0.10, L * 0.21], [0, hullH + H * 0.24, L * 0.26], 'stripe', { group: 'cells' }),
    );
  }

  masses.push(
    ...mirrorVane('vane', W * 0.62, L * 0.10, [0, superY + superH * 0.5 + 0.22, -L * 0.10], -0.50),
    greeble('bridgeGlass', 'box', [W * 0.56, superH * 0.30, 0.12], [0, superY + superH * 0.16, -L * 0.10 + L * 0.17], 'paintTiny', {
      faceSlots: { pz: 'glass' }, group: 'bridgeGlass',
    }),
    greeble('dish', 'lathe', [W * 0.26, 0.16, W * 0.26], [0, H * 0.80, -L * 0.16], 'bareMetal', {
      profile: 'disc', segments: 12, rot: [-0.5, 0, 0], group: 'dish',
    }),
    greeble('tender', 'lathe', [0.42, 1.40, 0.42], [W * 0.40, hullH + H * 0.14, -L * 0.24], 'paintSmall', {
      mirrorX: true, profile: 'capsule', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'tenders',
    }),
    greeble('rail', 'box', [W * 0.98, 0.16, L * 0.86], [0, hullH + H * 0.14, 0], 'grille', { group: 'rails' }),
    greeble('sternMount', 'prism', [W * 0.30, H * 0.12, L * 0.10], [0, hullH + H * 0.16, -L * 0.36], 'bareMetal', {
      plan: 'hexagon', capSlot: 'grille', group: 'sternGun',
    }),
    greeble('ram', 'prism', [W * 0.30, hullH * 0.60, L * 0.10], [0, hullY, L * 0.50], 'bareMetal', {
      plan: 'triangle', capSlot: 'bareMetal', group: 'ram',
    }),
  );

  masses.push(
    slab('hullStripe', [0.08, hullH * 0.28, L * 0.70], [W * 0.46, hullH * 0.74, -L * 0.02], { mirrorX: true }),
    slab('bridgeBand', [0.08, superH * 0.44, L * 0.26], [W * 0.33, superY, -L * 0.10], { mirrorX: true }),
    slab('bridgeCap', [W * 0.34, 0.08, L * 0.18], [0, superY + superH * 0.5, -L * 0.10]),
    slab('deckPatch', [W * 0.52, 0.08, L * 0.16], [0, hullH + H * 0.10, L * 0.10]),
  );
  masses.push(insignia([W * 0.36, 0.06, W * 0.36], [0, hullH + H * 0.10, -L * 0.30]));
  masses.push(
    glow('navLight', [0.34, 0.30, 0.06], [W * 0.38, hullH + H * 0.20, L * 0.34], { mirrorX: true }),
    glow('bridgeGlow', [W * 0.62, 0.26, 0.06], [0, superY + superH * 0.30, -L * 0.10 + L * 0.17]),
    glow('deckRun', [W * 0.30, 0.05, L * 0.36], [0, hullH + H * 0.11, -L * 0.02]),
  );

  return {
    key: o.key, name: o.name, faction: MERIDIAN_ART_FACTION, cls: 'naval',
    hullLength: L, masses, hullNumber: HULL_NUMBER,
    sockets: [
      { part: PartId.MuzzleA, pos: [0, hullH + H * 0.21, L * 0.46] },
      { part: PartId.Exhaust, pos: [0, superY + superH * 0.5 + H * 0.30, -L * 0.16] },
      { part: PartId.Dish, pos: [0, superY + superH * 0.5 + H * 0.30, -L * 0.16] },
    ],
  };
}

/* ==========================================================================
 * 8. THE KESTREL — the Pact flyer
 *
 * A blended lifting body rather than a tube-and-wing: the fuselage is split
 * fore and aft (a single long tube would be ~73% of the side silhouette, which
 * is exactly the "three plain boxes" half of R8) and both halves taper.
 * ========================================================================== */

function pactFlyer(key: string, name: string, L: number, S: number, H: number): UnitMassList {
  const fuseH = H * 0.42;
  const fuseY = H * 0.655;
  const wingY = fuseY - fuseH * 0.18;

  const masses: MassDef[] = [
    primary('foreBody', 'prism', [S * 0.20, fuseH, L * 0.56], [0, fuseY, L * 0.16], 'paintLarge', {
      plan: 'hexagon', capSlot: 'paintMed',
    }),
    primary('aftBoom', 'box', [S * 0.16, fuseH * 0.78, L * 0.48], [0, fuseY - fuseH * 0.04, -L * 0.26], 'paintMed', {
      taper: [0.62, 0.58, -L * 0.06],
    }),
    // Swept trapezoidal wing. The rotation is what makes it a wing and not a
    // plank, and it is also what takes its axis-aligned surface fraction to 0.
    primary('wing', 'box', [S * 0.42, H * 0.10, L * 0.32], [S * 0.26, wingY, -L * 0.06], 'paintLarge', {
      mirrorX: true, rot: [0, -0.30, 0.12], taper: [0.66, 0.58, 0],
    }),
    primary('fin', 'box', [0.14, H * 0.30, L * 0.20], [S * 0.16, H - H * 0.15, -L * 0.40], 'paintMed', {
      mirrorX: true, rot: [0, 0, 0.28], taper: [0.66, 0.52, -L * 0.04],
    }),
  ];

  masses.push(
    greeble('nose', 'lathe', [S * 0.18, L * 0.22, fuseH * 0.90], [0, fuseY, L * 0.56], 'paintMed', {
      profile: 'cone', segments: 12, topRadius: 0.20, rot: [-Math.PI * 0.5, 0, 0], group: 'nose',
    }),
    greeble('canopy', 'lathe', [S * 0.15, fuseH * 0.42, L * 0.24], [0, fuseY + fuseH * 0.42, L * 0.20], 'glass', {
      profile: 'dome', segments: 12, group: 'canopy',
    }),
    ...mirrorVane('vane', S * 0.24, L * 0.14, [0, fuseY + fuseH * 0.52, -L * 0.10], -0.42),
    greeble('intake', 'prism', [S * 0.10, fuseH * 0.42, L * 0.16], [S * 0.13, fuseY - fuseH * 0.10, L * 0.06], 'grille', {
      mirrorX: true, plan: 'hexagon', capSlot: 'grille', group: 'intakes',
    }),
    greeble('skid', 'box', [S * 0.07, H * 0.12, L * 0.12], [S * 0.12, fuseY - fuseH * 0.5, -L * 0.02], 'paintTiny', {
      mirrorX: true, group: 'skids',
    }),
    greeble('pylon', 'box', [0.14, H * 0.10, L * 0.10], [S * 0.24, wingY - H * 0.07, -L * 0.04], 'bareMetal', {
      mirrorX: true, group: 'pylons',
    }),
    greeble('pod', 'lathe', [0.26, L * 0.26, 0.26], [S * 0.24, wingY - H * 0.13, -L * 0.02], 'bareMetal', {
      mirrorX: true, profile: 'capsule', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'pods',
    }),
    greeble('thruster', 'lathe', [S * 0.14, 0.26, S * 0.14], [0, fuseY, -L * 0.52], 'bareMetal', {
      profile: 'cyl', segments: 12, topRadius: 0.82, rot: [Math.PI * 0.5, 0, 0], group: 'thruster',
    }),
  );

  masses.push(
    slab('wingBand', [S * 0.22, 0.07, L * 0.11], [S * 0.28, wingY + H * 0.05, -L * 0.06], { mirrorX: true }),
    slab('finFlash', [0.07, H * 0.18, L * 0.10], [S * 0.19, H - H * 0.16, -L * 0.40], { mirrorX: true }),
    slab('spine', [S * 0.08, 0.07, L * 0.24], [0, fuseY + fuseH * 0.5, -L * 0.06]),
  );
  masses.push(insignia([S * 0.13, 0.06, S * 0.13], [S * 0.28, wingY + H * 0.06, -L * 0.06]));
  masses.push(
    glow('afterglow', [S * 0.13, 0.18, 0.06], [0, fuseY, -L * 0.56]),
    glow('tipLight', [0.10, 0.22, L * 0.20], [S * 0.44, wingY + H * 0.02, -L * 0.06], { mirrorX: true }),
  );

  return {
    key, name, faction: MERIDIAN_ART_FACTION, cls: 'air',
    hullLength: L, masses, hullNumber: HULL_NUMBER,
    sockets: [
      { part: PartId.MuzzleA, pos: [S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.MuzzleB, pos: [-S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.Exhaust, pos: [0, fuseY, -L * 0.56] },
    ],
  };
}

/* ==========================================================================
 * 9. THE ROSTER
 *
 * Dimensions come off the same scale ladder the shipped roster uses: the
 * Solarch is a 6.4 m hull against the Grizzly's 6.6 and the Rhino's 7.0, which
 * is the "lighter than both, not smaller than either" read the stats promise.
 * ========================================================================== */

export const MERIDIAN_UNIT_MASS_LISTS: readonly UnitMassList[] = [
  pactInfantry({ key: 'meridian_wayfarer', name: 'Wayfarer', weapon: 'carbine', pack: 'vane' }),
  pactInfantry({ key: 'meridian_lancer', name: 'Sunlancer', weapon: 'lance', pack: 'cells' }),
  pactInfantry({ key: 'meridian_artificer', name: 'Artificer', weapon: 'tool', pack: 'kit' }),

  pactTank({
    key: 'meridian_solarch', name: 'Solarch',
    hullLength: 6.4, hullWidth: 3.1, height: 2.50, gun: 'lance', fans: 4,
  }),
  pactTank({
    key: 'meridian_skiff', name: 'Sandskiff',
    hullLength: 5.4, hullWidth: 2.8, height: 2.35, gun: 'repeater', fans: 3,
  }),
  pactTank({
    key: 'meridian_zenith', name: 'Zenith Emitter',
    hullLength: 6.6, hullWidth: 3.0, height: 2.65, gun: 'emitter', fans: 4,
  }),
  pactSupport({
    key: 'meridian_collector', name: 'Sun Collector',
    hullLength: 8.4, hullWidth: 3.9, height: 3.25, role: 'collector',
  }),
  pactSupport({
    key: 'meridian_carryall', name: 'Pactworks Carryall',
    hullLength: 9.0, hullWidth: 4.4, height: 3.80, role: 'carryall',
  }),

  pactShip({ key: 'meridian_corvette', name: 'Kite Corvette', length: 10.0, beam: 3.6, height: 3.0, armament: 'battery' }),
  pactShip({ key: 'meridian_monitor', name: 'Sunmonitor', length: 15.0, beam: 4.6, height: 4.4, armament: 'lances' }),

  pactFlyer('meridian_kestrel', 'Kestrel Gunship', 10.5, 11.0, 2.9),
];

/** key -> mass list, for anything that wants the geometry rather than the model. */
export const MERIDIAN_UNIT_MASS_BY_KEY: ReadonlyMap<string, UnitMassList> =
  new Map(MERIDIAN_UNIT_MASS_LISTS.map((u) => [u.key, u]));

/**
 * Content key -> model key. The content vocabulary belongs to
 * `src/data/Defs.ts`; this is the one place the two namespaces meet, exactly as
 * `CONTENT_TO_MODEL` does it in `units.system.ts`.
 */
export const MERIDIAN_UNIT_MODELS: Readonly<Record<string, string>> = {
  mrdWayfarer: 'meridian_wayfarer',
  mrdLancer: 'meridian_lancer',
  mrdArtificer: 'meridian_artificer',
  mrdCollector: 'meridian_collector',
  mrdSkiff: 'meridian_skiff',
  mrdSolarch: 'meridian_solarch',
  mrdZenith: 'meridian_zenith',
  mrdCarryall: 'meridian_carryall',
  mrdKestrel: 'meridian_kestrel',
  mrdCorvette: 'meridian_corvette',
  mrdMonitor: 'meridian_monitor',
};

/* ==========================================================================
 * 10. BUILD AND HAND OFF
 *
 * A PRIVATE library on a PRIVATE `GreebleFactory`, and both words matter.
 * `UnitLibrary.build` derives its atlas key from `list.faction`, and the shared
 * `unitLibrary` is filled by `units.system.ts` in the same boot — sharing it
 * would mean the Pact's palette either collided with the Allied atlas or won
 * it, depending on init order. A private factory makes the question
 * unanswerable instead of answered-by-luck, at a cost of one extra material.
 * ========================================================================== */

export const meridianUnitLibrary = new UnitLibrary(new GreebleFactory());

/** Translate a built model into the bridge's shape. Mirrors `units.system.ts`. */
function toKindMesh(m: UnitModel): KindMesh {
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

export interface MeridianBuildReport {
  models: UnitModel[];
  failed: string[];
  registrations: number;
  bound: number;
}

/**
 * Build every Pact hull and publish it to `RenderBridge`.
 *
 * `unitId` is `resolveDefBinding().unitId` — content key -> def index. Passing
 * it in rather than resolving it here keeps this module free of any dependency
 * on `src/game/**`, which is the same discipline `sim/AIStrategy.ts` follows
 * with `DefLookup`.
 *
 * REGISTRATION FACTION. Every model goes on at `FACTION_ANY`, not at
 * `Faction.Meridian`, and that is correct rather than a shortcut:
 * `RenderBridge.factionSlot()` packs 0..2 and folds everything else onto the
 * wildcard slot, so a faction-3 registration IS a FACTION_ANY registration —
 * and it is also the honest description, because each of these defIds belongs
 * to exactly one army and can never be resolved for another.
 */
export function buildAndRegisterMeridianUnits(
  atlasSize: number,
  unitId: Readonly<Record<string, number>>,
): MeridianBuildReport {
  const models: UnitModel[] = [];
  const failed: string[] = [];

  for (const list of MERIDIAN_UNIT_MASS_LISTS) {
    try {
      models.push(meridianUnitLibrary.build(list, MERIDIAN_UNIT_PALETTE, atlasSize, MERIDIAN_ATLAS_SEED));
    } catch (err) {
      // One bad mass list must not take the roster — or the render — down.
      failed.push(`${list.key}: ${String(err)}`);
    }
  }

  const meshes = new Map<string, KindMesh>();
  const meshFor = (key: string): KindMesh | null => {
    const model = meridianUnitLibrary.get(key);
    if (model === undefined) return null;
    let mesh = meshes.get(key);
    if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
    return mesh;
  };

  let registrations = 0;
  let bound = 0;
  for (const [contentKey, modelKey] of Object.entries(MERIDIAN_UNIT_MODELS)) {
    const mesh = meshFor(modelKey);
    const model = meridianUnitLibrary.get(modelKey);
    if (mesh === null || model === undefined) continue;
    const kind = model.cls === 'infantry' ? EntityKind.Infantry : EntityKind.Vehicle;
    const defId = unitId[contentKey];
    if (defId !== undefined && defId >= 0) {
      registerKindMesh(kind, FACTION_ANY, mesh, defId);
      registrations++;
      bound++;
    }
  }

  // Per-kind defaults for the Pact, so a Meridian entity spawned with defId -1
  // (a scenario placement, a debug spawn) draws Pact art instead of the
  // bridge's hazard box.
  //
  // These land on the WILDCARD slot, because `factionSlot()` folds 3 onto it —
  // i.e. they become the bridge's LAST-RESORT entry for the kind. That is the
  // right place for them and it takes nothing away from the other two armies:
  // resolution tries (kind, faction, defId), then (kind, ANY, defId), then
  // (kind, faction, -1) — and `units.system.ts` registers a (kind, faction, -1)
  // default for Allies, Soviets AND Neutral, so all three are answered before
  // the chain ever reaches here.
  const wayfarer = meshFor('meridian_wayfarer');
  const solarch = meshFor('meridian_solarch');
  if (wayfarer !== null) {
    registerKindMesh(EntityKind.Infantry, 3 as Faction, wayfarer, -1);
    registrations++;
  }
  if (solarch !== null) {
    registerKindMesh(EntityKind.Vehicle, 3 as Faction, solarch, -1);
    registrations++;
  }

  return { models, failed, registrations, bound };
}

/** Release every Pact geometry, material and atlas. */
export function disposeMeridianUnits(): void {
  meridianUnitLibrary.dispose();
}
