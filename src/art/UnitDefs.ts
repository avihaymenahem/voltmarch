/**
 * ============================================================================
 * RED ALERT — src/art/UnitDefs.ts
 * ============================================================================
 * THE ROSTER, AS MASS LISTS.
 *
 * Eighteen units. Every one is data: no geometry code, no THREE, no magic
 * numbers that are not derived from the scale ladder in UNIT_LADDER.
 *
 * THE TEMPLATE THAT MOST OF THEM SHARE
 * ------------------------------------
 * Bible 5.3 in five numbers, and every helper below is written to hit them:
 *
 *   chassis       0 .. 0.42 H     a thin base (bible: 35-45%)
 *   superstructure 0.42 .. 1.0 H  the top 55-65%
 *   tracks        22% of H tall, protruding 11% of hull width per side
 *   turret        0.75-0.95 x hull width — deliberately too big
 *   dominant mass centred at 0.60-0.70 H, 35-50% of side-projected area
 *
 * That is why every tank here has a turret that looks oversized next to a real
 * MBT: a real Abrams turret is 0.55 of hull width and RA3's is 0.85. Copying
 * reality here is the fastest way to lose the identity.
 *
 * TEAM COLOUR (R12/R-T1) is never a hull tint. Each unit carries 3-5 discrete
 * `teamSlab` plates let into the hull, sized so the measured surface fraction
 * lands in 8-14% (vehicles) or 20-28% (infantry and walkers), plus exactly one
 * `insignia` plate. The validator measures real triangle area and rejects the
 * unit if it misses.
 * ============================================================================
 */

import { PartId } from '../core/types';
import { UNIT_LADDER } from '../core/config';
import { MassRole, type MassDef, type SocketSpec, type UnitMassList } from './MassList';

/* ==========================================================================
 * 1. SUB-ASSEMBLY HELPERS
 * ========================================================================== */

type V3 = readonly [number, number, number];

interface SlabOpts { turret?: boolean; mirrorX?: boolean; rot?: V3; }

/** A flat team-colour panel let into the hull. R-T2: a quad, never a gradient. */
function slab(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.TeamSlab, size, anchor,
    slot: 'teamSlab', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.mirrorX ? { mirrorX: true } : {}),
    ...(o.rot ? { rot: o.rot } : {}),
  };
}

/** THE one insignia decal (R-T4). 8-14% of hull width, top/outward facing. */
function insignia(size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name: 'insignia', primitive: 'box', role: MassRole.Insignia, size, anchor,
    slot: 'insignia', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.rot ? { rot: o.rot } : {}),
  };
}

/** A masked emissive panel. R-T5: 1-3% of surface, clean rounded rectangles. */
function glowPanel(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.Emissive, size, anchor,
    slot: 'emissive', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.mirrorX ? { mirrorX: true } : {}),
  };
}

/** A small detail object. 6-12 of these per unit, every one >= 3 px on screen. */
function greeble(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: MassDef['slot'], extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Greeble, size, anchor, slot, ...extra };
}

/** One of the 3-6 shapes a critic reads from across the map. */
function primary(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: MassDef['slot'], extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Primary, size, anchor, slot, ...extra };
}

/**
 * The proud track pair. Bible 5.3: protrudes 8-14% of hull width outboard each
 * side and stands 18-25% of unit height. Track links are near-black and the
 * road wheels are separate warm-grey rollers, which is what stops a tracked
 * vehicle reading as a box on a plinth.
 */
function tracks(hullWidth: number, trackHeight: number, length: number, wheels: number): MassDef[] {
  const h = trackHeight;
  const w = hullWidth * 0.26;
  const x = hullWidth * 0.5 + hullWidth * UNIT_GEOMETRY_TRACK_OUTBOARD - w * 0.5;
  const out: MassDef[] = [
    primary('track', 'box', [w, h, length], [x, h * 0.5, 0], 'tread', {
      mirrorX: true, chamfer: 0.05,
      faceSlots: { py: 'tread', ny: 'tread', px: 'tread', nx: 'tread', pz: 'tread', nz: 'tread' },
    }),
  ];
  const wheelR = h * 0.74;
  for (let i = 0; i < wheels; i++) {
    const z = -length * 0.42 + (length * 0.84 * i) / Math.max(1, wheels - 1);
    out.push(greeble(`roller${i}`, 'lathe', [wheelR, w * 0.55, wheelR], [x, h * 0.48, z], 'bareMetal', {
      // The road-wheel run is ONE readable greeble, so every roller shares a
      // group and the six of them cost one slot in the 6-12 detail budget.
      mirrorX: true, profile: 'disc', segments: 12, rot: [0, 0, Math.PI * 0.5], group: 'rollers',
    }));
  }
  return out;
}

/** Bible 5.3: tracks protrude 8-14% of hull width outboard each side. */
const UNIT_GEOMETRY_TRACK_OUTBOARD = 0.11;

/**
 * The greeble kit every vehicle carries: exhaust, stowage, headlamp cluster,
 * tow point, antenna. Six discrete objects, all >= 0.14 m so nothing is
 * sub-pixel at gameplay zoom.
 */
function vehicleGreebles(hullW: number, hullL: number, deckY: number): MassDef[] {
  return [
    greeble('exhaust', 'lathe', [0.26, 0.62, 0.26], [hullW * 0.34, deckY + 0.28, -hullL * 0.30], 'bareMetal', {
      mirrorX: true, profile: 'cyl', segments: 12,
    }),
    greeble('stowage', 'box', [hullW * 0.30, 0.26, hullL * 0.16], [-hullW * 0.30, deckY + 0.13, -hullL * 0.36], 'paintSmall', {
      mirrorX: true, group: 'stowage',
    }),
    greeble('headlamp', 'box', [0.30, 0.24, 0.18], [hullW * 0.32, deckY - 0.05, hullL * 0.44], 'paintTiny', {
      mirrorX: true, faceSlots: { pz: 'glass' },
    }),
    greeble('towHook', 'box', [0.20, 0.16, 0.34], [hullW * 0.22, deckY - 0.24, hullL * 0.48], 'bareMetal', { mirrorX: true }),
    greeble('deckGrille', 'box', [hullW * 0.46, 0.10, hullL * 0.20], [0, deckY + 0.05, -hullL * 0.26], 'paintTiny', {
      faceSlots: { py: 'grille' },
    }),
  ];
}

/* ==========================================================================
 * 2. INFANTRY
 *
 * R-S4: 0.30-0.38 x a 7 m MBT hull, so 2.1-2.7 m. The 1.75 m in the
 * foundation's UNIT_DIMENSIONS puts a soldier at 0.25 and reads as ants.
 * Team colour is 20-28% here, not 8-14% — infantry are read at a much smaller
 * pixel count and need the extra flag.
 * ========================================================================== */

interface InfantryOpts {
  key: string;
  name: string;
  faction: UnitMassList['faction'];
  hullNumber: number;
  /** 'rifle' | 'launcher' | 'tool' — changes the held object only. */
  weapon: 'rifle' | 'launcher' | 'tool';
  /** Backpack shape: engineers carry a toolbox, flak troopers a magazine drum. */
  pack: 'radio' | 'drum' | 'case';
}

function infantry(o: InfantryOpts): UnitMassList {
  const H = UNIT_LADDER.infantryHeightMeters;      // 2.2 m
  const W = UNIT_LADDER.infantryWidthMeters;       // 0.78 m shoulder span
  const legTop = H * 0.415;                        // 0.913
  const torsoH = H * 0.415;                        // 0.913
  const torsoY = legTop + torsoH * 0.5;            // 1.370 -> 0.623 H

  const masses: MassDef[] = [
    // Legs: one mirrored pair, tapering into the boot.
    primary('leg', 'box', [W * 0.34, legTop, W * 0.44], [W * 0.24, legTop * 0.5, 0], 'paintSmall', {
      mirrorX: true, taper: [1.25, 1.1, 0.02],
    }),
    // Torso: the dominant mass. Wider at the shoulders than at the waist,
    // which is the toy-soldier read and also puts the visual mass up high.
    primary('torso', 'box', [W * 0.86, torsoH, W * 0.86], [0, torsoY, 0], 'paintMed', {
      taper: [1.14, 1.06, -0.01],
    }),
    // Helmet: a low-segment dome, never a smooth sphere (scorecard #40).
    primary('helmet', 'lathe', [W * 0.56, H * 0.145, W * 0.60], [0, legTop + torsoH + H * 0.048, 0.01], 'paintSmall', {
      profile: 'dome', segments: 14,
    }),
    primary('arm', 'box', [W * 0.24, torsoH * 0.86, W * 0.28], [W * 0.52, torsoY + 0.02, 0.06], 'paintSmall', {
      mirrorX: true, rot: [0.12, 0, -0.06],
    }),
  ];

  // Weapon.
  if (o.weapon === 'launcher') {
    masses.push(greeble('launchTube', 'lathe', [0.20, 1.02, 0.20], [W * 0.50, torsoY + 0.20, 0.22], 'bareMetal', {
      profile: 'cyl', segments: 12, rot: [1.30, 0, 0.10],
    }));
    masses.push(greeble('launchMouth', 'lathe', [0.28, 0.18, 0.28], [W * 0.50, torsoY + 0.50, 0.52], 'bareMetal', {
      profile: 'cone', segments: 12, topRadius: 1.5, rot: [1.30, 0, 0.10],
    }));
  } else if (o.weapon === 'tool') {
    masses.push(greeble('toolArm', 'box', [0.16, 0.16, 0.72], [W * 0.52, torsoY - 0.10, 0.34], 'bareMetal'));
    masses.push(greeble('toolHead', 'box', [0.26, 0.22, 0.22], [W * 0.52, torsoY - 0.10, 0.74], 'paintTiny'));
  } else {
    masses.push(greeble('rifle', 'box', [0.10, 0.16, 0.98], [W * 0.44, torsoY - 0.04, 0.24], 'bareMetal', {
      rot: [0.18, 0.06, 0],
    }));
    masses.push(greeble('magazine', 'box', [0.08, 0.22, 0.12], [W * 0.44, torsoY - 0.20, 0.16], 'paintTiny'));
  }

  // Backpack.
  if (o.pack === 'drum') {
    masses.push(greeble('drum', 'lathe', [0.42, 0.40, 0.42], [0, torsoY + 0.12, -W * 0.44], 'bareMetal', {
      profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0],
    }));
  } else if (o.pack === 'case') {
    masses.push(greeble('toolcase', 'box', [W * 0.62, 0.42, 0.22], [0, torsoY + 0.06, -W * 0.42], 'paintSmall'));
  } else {
    masses.push(greeble('radio', 'box', [W * 0.52, 0.44, 0.22], [0, torsoY + 0.10, -W * 0.42], 'paintSmall'));
    masses.push(greeble('aerial', 'lathe', [0.05, 0.62, 0.05], [W * 0.20, torsoY + 0.52, -W * 0.42], 'bareMetal', {
      profile: 'cyl', segments: 8, rot: [-0.14, 0, 0],
    }));
  }

  masses.push(
    // Every variant tops out at exactly H, whatever it is carrying, so the
    // R-S4 height ratio does not swing with the backpack.
    greeble('helmetAerial', 'lathe', [0.05, H * 0.14, 0.05], [-W * 0.18, H - H * 0.07, -0.06], 'bareMetal', {
      profile: 'cyl', segments: 8,
    }),
    greeble('boot', 'box', [W * 0.40, 0.16, W * 0.62], [W * 0.24, 0.08, 0.06], 'paintTiny', { mirrorX: true }),
    greeble('webbing', 'box', [W * 0.90, 0.12, W * 0.66], [0, torsoY - torsoH * 0.34, 0], 'paintTiny'),
    greeble('collar', 'box', [W * 0.60, 0.11, W * 0.50], [0, legTop + torsoH - 0.03, 0], 'paintTiny'),
  );

  // Team colour: 20-28% of surface (R-T1). Chest, both shoulders, helmet band.
  masses.push(
    slab('chestPlate', [W * 0.72, torsoH * 0.66, 0.06], [0, torsoY + 0.04, W * 0.32]),
    slab('shoulderPad', [W * 0.34, 0.34, W * 0.44], [W * 0.44, torsoY + torsoH * 0.30, 0], { mirrorX: true }),
    slab('helmetBand', [W * 0.58, 0.12, W * 0.62], [0, legTop + torsoH + H * 0.030, 0.01]),
    slab('thighBand', [W * 0.42, 0.20, W * 0.50], [W * 0.24, legTop * 0.72, 0], { mirrorX: true }),
  );
  masses.push(insignia([0.26, 0.26, 0.05], [W * 0.30, torsoY + torsoH * 0.24, W * 0.33]));
  masses.push(
    glowPanel('visor', [W * 0.46, 0.14, 0.05], [0, legTop + torsoH + H * 0.030, W * 0.29]),
    glowPanel('packLamp', [W * 0.30, 0.16, 0.05], [0, torsoY + 0.24, -W * 0.53]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.MuzzleA, pos: [W * 0.44, torsoY + 0.02, 0.78] },
    { part: PartId.Emitter, pos: [0, torsoY, 0] },
  ];

  return {
    key: o.key,
    name: o.name,
    faction: o.faction,
    cls: 'infantry',
    hullLength: W,
    masses,
    sockets,
    hullNumber: o.hullNumber,
  };
}

/* ==========================================================================
 * 3. THE TRACKED-TANK TEMPLATE
 * ========================================================================== */

interface TankOpts {
  key: string;
  name: string;
  faction: UnitMassList['faction'];
  hullNumber: number;
  /** Hull long axis. MBT = 7.0 m and everything else is a ratio of it. */
  hullLength: number;
  hullWidth: number;
  /** Total silhouette height including the mast. */
  height: number;
  /** Soviet hulls use the octagonal brutalist plan; Allied hulls are chamfered boxes. */
  brutalist: boolean;
  /** Main armament. */
  gun: 'cannon' | 'twinCannon' | 'prism' | 'flak' | 'rocketRack';
  /** Extra turret-top mass, e.g. a Prism emitter or an AA mount. */
  wheels?: number;
}

function tank(o: TankOpts): UnitMassList {
  const H = o.height;
  const L = o.hullLength;
  const W = o.hullWidth;

  // Bible 5.3: chassis is a thin 35-45% base, superstructure is the top 55-65%.
  const trackH = H * UNIT_LADDER.chassisHeightFraction * 0.55;
  const hullH = H * 0.215;
  const hullY = trackH + hullH * 0.5;
  const turretH = H * 0.50;
  const turretY = H * 0.655;                        // -> dominantCentreY 0.655
  const turretW = W * UNIT_LADDER.turretWidthOverHull;
  const turretL = L * 0.74;
  const deckY = trackH + hullH;
  const turretRoof = turretY + turretH * 0.5;

  const masses: MassDef[] = [
    ...tracks(W, trackH, L * 0.94, o.wheels ?? 5),
    // Hull. The taper is the glacis: the top plate is shorter and set back, so
    // the front reads as a sloped plate instead of a brick.
    primary('hull', o.brutalist ? 'prism' : 'box', [W, hullH, L], [0, hullY, 0],
      'paintLarge', o.brutalist
        ? { plan: 'cutBox', cornerCut: 0.08, capSlot: 'paintLarge' }
        : { taper: [0.94, 0.86, -L * 0.05] }),
    // Turret. Deliberately oversized: 0.86 x hull width against a real MBT's
    // 0.55, and 74% of hull length.
    primary('turret', o.brutalist ? 'prism' : 'box', [turretW, turretH, turretL], [0, turretY, -L * 0.04],
      'paintLarge', o.brutalist
        ? { turret: true, plan: 'cutBox', cornerCut: 0.12, capSlot: 'paintLarge' }
        : { turret: true, taper: [0.80, 0.78, -turretL * 0.06] }),
  ];

  /* -- armament ---------------------------------------------------------- */
  const muzzleZ = turretL * 0.5 + L * 0.40;
  const gunY = turretY + turretH * 0.06;
  switch (o.gun) {
    case 'twinCannon':
      masses.push(
        primary('barrel', 'lathe', [0.30, L * 0.62, 0.30], [W * 0.16, gunY, turretL * 0.32], 'bareMetal', {
          turret: true, mirrorX: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.92,
        }),
        greeble('muzzleBrake', 'lathe', [0.40, 0.34, 0.40], [W * 0.16, gunY, turretL * 0.32 + L * 0.31], 'bareMetal', {
          turret: true, mirrorX: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0],
        }),
      );
      break;
    case 'prism':
      masses.push(
        primary('prismHousing', 'lathe', [W * 0.44, L * 0.46, W * 0.44], [0, gunY + 0.10, turretL * 0.30], 'paintMed', {
          turret: true, profile: 'cyl', segments: 14, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.74,
        }),
        greeble('prismCrystal', 'lathe', [W * 0.30, 0.42, W * 0.30], [0, gunY + 0.10, turretL * 0.30 + L * 0.23], 'emissive', {
          turret: true, profile: 'cone', segments: 8, topRadius: 0.25, rot: [Math.PI * 0.5, 0, 0],
        }),
      );
      break;
    case 'flak':
      masses.push(
        primary('flakBarrel', 'lathe', [0.20, L * 0.50, 0.20], [W * 0.13, gunY + 0.16, turretL * 0.22], 'bareMetal', {
          turret: true, mirrorX: true, profile: 'cyl', segments: 10, rot: [1.16, 0, 0],
        }),
        greeble('flakCradle', 'box', [W * 0.52, 0.26, turretL * 0.34], [0, gunY + 0.10, turretL * 0.16], 'paintSmall', { turret: true }),
      );
      break;
    case 'rocketRack':
      masses.push(
        primary('rocketRack', 'box', [W * 0.78, H * 0.26, L * 0.56], [0, gunY + 0.14, turretL * 0.06], 'paintMed', {
          turret: true, rot: [-0.30, 0, 0], faceSlots: { pz: 'grille', py: 'stripe' },
        }),
        greeble('railPair', 'box', [W * 0.16, 0.16, L * 0.58], [W * 0.26, gunY + 0.30, turretL * 0.10], 'bareMetal', {
          turret: true, mirrorX: true, rot: [-0.30, 0, 0],
        }),
      );
      break;
    default:
      masses.push(
        primary('barrel', 'lathe', [0.38, L * 0.66, 0.38], [0, gunY, turretL * 0.34], 'bareMetal', {
          turret: true, profile: 'cyl', segments: 14, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.86,
        }),
        greeble('muzzleBrake', 'lathe', [0.52, 0.40, 0.52], [0, gunY, turretL * 0.34 + L * 0.33], 'bareMetal', {
          turret: true, profile: 'cyl', segments: 14, rot: [Math.PI * 0.5, 0, 0],
        }),
      );
      break;
  }

  /* -- greebles ---------------------------------------------------------- */
  masses.push(
    ...vehicleGreebles(W, L, deckY),
    greeble('mantlet', 'box', [turretW * 0.44, turretH * 0.72, 0.30], [0, gunY, turretL * 0.48], 'bareMetal', { turret: true }),
    // Everything above the turret roof is sized so the silhouette tops out at
    // exactly H. An overshooting mast would push `bounds[1]` past the height the
    // top-heavy check divides by, and every tank would fail it.
    greeble('cupola', 'lathe', [turretW * 0.30, H * 0.09, turretW * 0.30], [-turretW * 0.22, turretRoof + H * 0.045, -turretL * 0.16], 'hatch', {
      turret: true, profile: 'cyl', segments: 12,
    }),
    greeble('aaMount', 'box', [0.14, 0.13, 0.72], [turretW * 0.26, turretRoof + H * 0.040, -turretL * 0.06], 'bareMetal', {
      turret: true, rot: [-0.10, 0.22, 0],
    }),
    greeble('turretBox', 'box', [turretW * 0.62, turretH * 0.34, turretL * 0.20], [0, turretY + turretH * 0.20, -turretL * 0.52], 'paintSmall', { turret: true }),
    greeble('mast', 'lathe', [0.07, H * 0.16, 0.07], [-turretW * 0.40, H - H * 0.08, -turretL * 0.34], 'bareMetal', {
      turret: true, profile: 'cyl', segments: 8,
    }),
  );

  /* -- team colour (R-T1: 8-14% of surface, flat slabs only) -------------- */
  masses.push(
    slab('turretCheek', [0.07, turretH * 0.56, turretL * 0.56], [turretW * 0.5, turretY + turretH * 0.04, -turretL * 0.04], { turret: true, mirrorX: true }),
    slab('hullFlank', [0.07, hullH * 0.62, L * 0.50], [W * 0.49, hullY, -L * 0.06], { mirrorX: true }),
    // Top-facing slabs are deliberately SMALL panel inserts. A turret-roof-sized
    // plate measures inside R-T1 and still reads as a repainted tank, because a
    // 39-degree camera weights a deck about 2.5x a flank.
    slab('turretCap', [turretW * 0.34, 0.07, turretL * 0.30], [-turretW * 0.16, turretRoof, -turretL * 0.02], { turret: true }),
    slab('glacisBand', [W * 0.42, 0.07, L * 0.09], [0, deckY, L * 0.40], {}),
  );
  masses.push(insignia([turretW * 0.30, 0.06, turretW * 0.30], [turretW * 0.20, turretRoof + 0.02, turretL * 0.18], { turret: true }));
  // R-T5 wants emissive at 1-3% of surface. The atlas masks 42% of each plate,
  // so the plates are sized against that, not against their own area.
  masses.push(
    glowPanel('rearLamp', [0.40, 0.28, 0.06], [W * 0.28, deckY - 0.08, -L * 0.5], { mirrorX: true }),
    glowPanel('deckStrip', [W * 0.62, 0.06, L * 0.17], [0, deckY + 0.02, -L * 0.40]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Turret, pos: [0, turretY, -L * 0.04] },
    { part: PartId.MuzzleA, pos: [o.gun === 'twinCannon' ? W * 0.16 : 0, gunY, muzzleZ], turret: true },
    { part: PartId.Exhaust, pos: [W * 0.34, deckY + 0.60, -L * 0.30] },
    { part: PartId.Antenna, pos: [-W * 0.40, H, -L * 0.30], turret: true },
  ];
  if (o.gun === 'twinCannon' || o.gun === 'flak') {
    sockets.push({ part: PartId.MuzzleB, pos: [-W * 0.16, gunY, muzzleZ], turret: true });
  }

  return {
    key: o.key,
    name: o.name,
    faction: o.faction,
    cls: 'vehicle',
    hullLength: L,
    turretPivot: [0, turretY, -L * 0.04],
    masses,
    sockets,
    hullNumber: o.hullNumber,
  };
}

/* ==========================================================================
 * 4. TURRETLESS SUPPORT VEHICLES — harvester and dozer
 *
 * These have no turret, so the dominant mass is the SUPERSTRUCTURE (the ore
 * hopper / the cab-and-crane block) and it still has to sit at 0.60-0.70 H.
 * ========================================================================== */

interface SupportOpts {
  key: string;
  name: string;
  faction: UnitMassList['faction'];
  hullNumber: number;
  hullLength: number;
  hullWidth: number;
  height: number;
  brutalist: boolean;
  role: 'harvester' | 'dozer';
}

function support(o: SupportOpts): UnitMassList {
  const H = o.height, L = o.hullLength, W = o.hullWidth;
  const trackH = H * 0.30;
  const chassisH = H * 0.16;
  const chassisY = trackH + chassisH * 0.5;
  const deckY = trackH + chassisH;
  const bodyH = H * 0.52;
  const bodyY = H * 0.645;

  const masses: MassDef[] = [
    ...tracks(W, trackH, L * 0.90, 6),
    primary('chassis', 'box', [W, chassisH, L], [0, chassisY, 0], 'paintLarge', { taper: [0.96, 0.92, 0] }),
    // The dominant mass: the ore hopper, or the dozer's engine-and-cab block.
    primary(o.role === 'harvester' ? 'hopper' : 'cabBlock',
      o.brutalist ? 'prism' : 'box',
      [W * 0.96, bodyH, L * 0.66], [0, bodyY, -L * 0.10], 'paintLarge',
      o.brutalist
        ? { plan: 'cutBox', cornerCut: 0.10, capSlot: 'paintLarge' }
        : { taper: [0.88, 0.92, -L * 0.03] }),
  ];

  if (o.role === 'harvester') {
    masses.push(
      // The scoop: the second read, and the thing that says "harvester".
      primary('scoop', 'box', [W * 1.02, H * 0.26, L * 0.24], [0, deckY + H * 0.02, L * 0.42], 'paintMed', {
        taper: [1.10, 1.0, L * 0.05], faceSlots: { pz: 'stripe', py: 'stripe' },
      }),
      greeble('scoopTeeth', 'box', [W * 0.98, 0.14, 0.22], [0, deckY - H * 0.06, L * 0.53], 'bareMetal'),
      greeble('scoopArm', 'box', [0.20, 0.22, L * 0.24], [W * 0.40, deckY + H * 0.10, L * 0.30], 'bareMetal', { mirrorX: true }),
      greeble('hopperLid', 'box', [W * 0.70, 0.14, L * 0.44], [0, bodyY + bodyH * 0.5, -L * 0.10], 'hatch'),
      greeble('conveyor', 'box', [W * 0.34, 0.18, L * 0.30], [0, bodyY + bodyH * 0.30, L * 0.22], 'grille', { rot: [-0.32, 0, 0] }),
    );
  } else {
    masses.push(
      primary('blade', 'box', [W * 1.16, H * 0.30, L * 0.14], [0, trackH * 0.62, L * 0.52], 'paintMed', {
        taper: [1.0, 1.0, -0.06], faceSlots: { pz: 'stripe', py: 'stripe' },
      }),
      greeble('bladeArm', 'box', [0.22, 0.22, L * 0.30], [W * 0.42, trackH * 0.80, L * 0.34], 'bareMetal', { mirrorX: true }),
      greeble('craneMast', 'lathe', [0.30, H * 0.16, 0.30], [-W * 0.26, H - H * 0.08, -L * 0.20], 'bareMetal', {
        profile: 'cyl', segments: 10,
      }),
      greeble('craneJib', 'box', [0.20, 0.18, L * 0.42], [-W * 0.26, H - H * 0.11, L * 0.02], 'bareMetal', { rot: [0.16, 0, 0] }),
      greeble('cabRoof', 'box', [W * 0.62, 0.14, L * 0.34], [0, bodyY + bodyH * 0.5, -L * 0.10], 'hatch'),
    );
  }

  masses.push(
    ...vehicleGreebles(W, L, deckY),
    greeble('cabGlass', 'box', [W * 0.52, bodyH * 0.34, 0.10], [0, bodyY + bodyH * 0.16, -L * 0.10 + L * 0.33], 'paintTiny', {
      faceSlots: { pz: 'glass' },
    }),
  );

  masses.push(
    slab('bodyFlank', [0.07, bodyH * 0.46, L * 0.46], [W * 0.47, bodyY, -L * 0.10], { mirrorX: true }),
    slab('bodyCap', [W * 0.38, 0.07, L * 0.24], [W * 0.10, bodyY + bodyH * 0.5, -L * 0.10]),
    slab('chassisBand', [0.07, chassisH * 0.56, L * 0.56], [W * 0.49, chassisY, 0], { mirrorX: true }),
    slab('rearPlate', [W * 0.56, bodyH * 0.34, 0.07], [0, bodyY, -L * 0.10 - L * 0.33]),
  );
  masses.push(insignia([W * 0.26, 0.06, W * 0.26], [W * 0.22, bodyY + bodyH * 0.5 + 0.02, -L * 0.24]));
  masses.push(
    glowPanel('beacon', [0.36, 0.26, 0.36], [-W * 0.30, bodyY + bodyH * 0.5 + 0.14, -L * 0.28]),
    glowPanel('sideLamp', [0.06, 0.52, 1.25], [W * 0.50, deckY + 0.30, L * 0.12], { mirrorX: true }),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Scoop, pos: [0, deckY, L * 0.52] },
    { part: PartId.Hopper, pos: [0, bodyY + bodyH * 0.5, -L * 0.10] },
    { part: PartId.Exhaust, pos: [W * 0.34, deckY + 0.60, -L * 0.30] },
    { part: PartId.DockEntry, pos: [0, deckY, -L * 0.5] },
  ];

  return {
    key: o.key, name: o.name, faction: o.faction, cls: 'vehicle',
    hullLength: L, masses, sockets, hullNumber: o.hullNumber,
  };
}

/* ==========================================================================
 * 5. THE SICKLE — a three-legged Soviet walker
 *
 * Walkers get the infantry team-colour band (20-28%) because the body is small
 * relative to the legs and 10% would vanish.
 * ========================================================================== */

function sickle(): UnitMassList {
  const H = UNIT_LADDER.walkerHeightMeters;   // 4.4 m
  const W = 3.0;
  const bodyH = H * 0.34;
  const bodyY = H * 0.655;
  const legTop = bodyY - bodyH * 0.5;

  const masses: MassDef[] = [
    // Three legs: two forward-splayed, one aft. Mirrored pair + a single.
    primary('legUpper', 'box', [0.42, legTop * 0.62, 0.52], [W * 0.30, legTop * 0.70, 0.55], 'paintMed', {
      mirrorX: true, rot: [-0.34, 0, 0.20], taper: [0.8, 0.8, 0],
    }),
    primary('legLower', 'box', [0.34, legTop * 0.58, 0.42], [W * 0.42, legTop * 0.26, 1.12], 'paintSmall', {
      mirrorX: true, rot: [0.46, 0, 0.10], taper: [0.7, 0.7, 0],
    }),
    // The body: bulbous, chamfered, oversized. The dominant mass.
    primary('body', 'prism', [W * 0.92, bodyH, W * 0.86], [0, bodyY, 0], 'paintLarge', {
      plan: 'cutBox', cornerCut: 0.14, capSlot: 'paintLarge',
    }),
    primary('cockpit', 'lathe', [W * 0.44, H * 0.16, W * 0.46], [0, bodyY + bodyH * 0.42, W * 0.20], 'paintMed', {
      profile: 'dome', segments: 14,
    }),
  ];

  masses.push(
    greeble('legRear', 'box', [0.42, legTop * 0.86, 0.52], [0, legTop * 0.46, -0.90], 'paintMed', {
      rot: [0.30, 0, 0], taper: [0.8, 0.8, 0],
    }),
    greeble('footPad', 'lathe', [0.62, 0.20, 0.62], [W * 0.48, 0.10, 1.55], 'bareMetal', { mirrorX: true, profile: 'disc', segments: 10 }),
    greeble('footRear', 'lathe', [0.62, 0.20, 0.62], [0, 0.10, -1.40], 'bareMetal', { profile: 'disc', segments: 10 }),
    greeble('hipRing', 'lathe', [W * 0.60, 0.26, W * 0.60], [0, legTop + 0.06, 0], 'bareMetal', { profile: 'cyl', segments: 12 }),
    greeble('gunPod', 'box', [0.34, 0.34, 1.30], [W * 0.36, bodyY - 0.06, 0.62], 'bareMetal', { mirrorX: true }),
    greeble('ammoDrum', 'lathe', [0.52, 0.44, 0.52], [W * 0.36, bodyY + 0.24, -0.10], 'paintSmall', {
      mirrorX: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0],
    }),
    greeble('exhaustStack', 'lathe', [0.24, 0.66, 0.24], [-W * 0.22, bodyY + bodyH * 0.5 + 0.30, -W * 0.24], 'bareMetal', {
      profile: 'cyl', segments: 10,
    }),
    greeble('backGrille', 'box', [W * 0.50, bodyH * 0.44, 0.12], [0, bodyY, -W * 0.44], 'grille'),
  );

  masses.push(
    slab('bodyBand', [0.08, bodyH * 0.62, W * 0.76], [W * 0.46, bodyY, 0], { mirrorX: true }),
    slab('shoulderCap', [W * 0.46, 0.08, W * 0.42], [0, bodyY + bodyH * 0.5, -W * 0.06]),
    slab('cockpitBrow', [W * 0.42, 0.20, 0.08], [0, bodyY + bodyH * 0.42, W * 0.42]),
    slab('hipBand', [0.50, 0.26, 0.62], [W * 0.30, legTop * 0.92, 0.48], { mirrorX: true }),
  );
  masses.push(insignia([0.42, 0.06, 0.42], [W * 0.16, bodyY + bodyH * 0.5 + 0.02, -W * 0.18]));
  masses.push(
    glowPanel('eye', [W * 0.34, 0.18, 0.06], [0, bodyY + bodyH * 0.30, W * 0.42]),
    glowPanel('ventGlow', [0.06, 0.30, W * 0.34], [W * 0.47, bodyY - bodyH * 0.26, -W * 0.10], { mirrorX: true }),
  );

  return {
    key: 'soviet_sickle',
    name: 'Sickle',
    faction: 'soviets',
    cls: 'walker',
    hullLength: 3.6,
    masses,
    sockets: [
      { part: PartId.MuzzleA, pos: [W * 0.36, bodyY - 0.06, 1.30] },
      { part: PartId.MuzzleB, pos: [-W * 0.36, bodyY - 0.06, 1.30] },
      { part: PartId.Exhaust, pos: [-W * 0.22, bodyY + bodyH * 0.5 + 0.60, -W * 0.24] },
    ],
    hullNumber: 8188,
  };
}

/* ==========================================================================
 * 6. NAVAL
 *
 * Hulls are long, so the superstructure has to do the top-heavy work: the
 * bridge block is the dominant mass and sits at 0.65 H.
 * ========================================================================== */

interface ShipOpts {
  key: string; name: string; faction: UnitMassList['faction']; hullNumber: number;
  length: number; beam: number; height: number; brutalist: boolean;
  armament: 'turret' | 'battery';
}

function ship(o: ShipOpts): UnitMassList {
  const L = o.length, W = o.beam, H = o.height;
  const hullH = H * 0.34;
  const hullY = hullH * 0.5;
  const superH = H * 0.42;
  const superY = H * 0.655;

  const masses: MassDef[] = [
    primary('hull', 'prism', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
      plan: 'wedge', capSlot: 'paintLarge',
    }),
    primary('deck', 'box', [W * 0.94, H * 0.10, L * 0.90], [0, hullH + H * 0.05, -L * 0.02], 'paintMed', {
      faceSlots: { py: 'paintLarge' },
    }),
    primary('superstructure', o.brutalist ? 'prism' : 'box', [W * 0.72, superH, L * 0.34],
      [0, superY, -L * 0.10], 'paintLarge',
      o.brutalist ? { plan: 'cutBox', cornerCut: 0.10, capSlot: 'paintLarge' } : { taper: [0.74, 0.80, -L * 0.02] }),
    // Sized so the funnel crown IS the top of the silhouette.
    primary('funnelMast', 'lathe', [W * 0.26, H * 0.20, W * 0.26], [0, H - H * 0.10, -L * 0.16], 'bareMetal', {
      profile: 'cyl', segments: 12, topRadius: 0.8,
    }),
  ];

  if (o.armament === 'turret') {
    masses.push(
      greeble('foreTurret', 'lathe', [W * 0.50, H * 0.20, W * 0.54], [0, hullH + H * 0.19, L * 0.28], 'paintMed', {
        profile: 'cyl', segments: 12,
      }),
      greeble('foreBarrel', 'lathe', [0.26, L * 0.20, 0.26], [0, hullH + H * 0.21, L * 0.42], 'bareMetal', {
        profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0],
      }),
    );
  } else {
    masses.push(
      greeble('missileCell', 'box', [W * 0.56, H * 0.16, L * 0.20], [0, hullH + H * 0.16, L * 0.26], 'grille'),
      greeble('cellLid', 'box', [W * 0.58, 0.10, L * 0.21], [0, hullH + H * 0.24, L * 0.26], 'stripe'),
    );
  }

  masses.push(
    greeble('bridgeGlass', 'box', [W * 0.56, superH * 0.30, 0.12], [0, superY + superH * 0.16, -L * 0.10 + L * 0.17], 'paintTiny', {
      faceSlots: { pz: 'glass' },
    }),
    greeble('radarDish', 'lathe', [W * 0.26, 0.16, W * 0.26], [0, H * 0.80, -L * 0.16], 'bareMetal', {
      profile: 'disc', segments: 12, rot: [-0.5, 0, 0],
    }),
    greeble('lifeboat', 'lathe', [0.42, 1.40, 0.42], [W * 0.40, hullH + H * 0.14, -L * 0.24], 'paintSmall', {
      mirrorX: true, profile: 'capsule', segments: 10, rot: [Math.PI * 0.5, 0, 0],
    }),
    greeble('railing', 'box', [W * 0.98, 0.16, L * 0.86], [0, hullH + H * 0.14, 0], 'grille'),
    greeble('aftGun', 'box', [W * 0.30, H * 0.12, L * 0.10], [0, hullH + H * 0.16, -L * 0.36], 'bareMetal'),
    greeble('bowRam', 'box', [W * 0.30, hullH * 0.60, L * 0.10], [0, hullY, L * 0.50], 'bareMetal', { taper: [0.5, 0.5, 0] }),
  );

  masses.push(
    slab('hullStripe', [0.08, hullH * 0.28, L * 0.70], [W * 0.48, hullH * 0.74, -L * 0.02], { mirrorX: true }),
    slab('superBand', [0.08, superH * 0.44, L * 0.26], [W * 0.35, superY, -L * 0.10], { mirrorX: true }),
    slab('superCap', [W * 0.34, 0.08, L * 0.18], [0, superY + superH * 0.5, -L * 0.10]),
    slab('deckPatch', [W * 0.52, 0.08, L * 0.16], [0, hullH + H * 0.10, L * 0.10]),
  );
  masses.push(insignia([W * 0.36, 0.06, W * 0.36], [0, hullH + H * 0.10, -L * 0.30]));
  masses.push(
    glowPanel('navLight', [0.34, 0.30, 0.06], [W * 0.40, hullH + H * 0.20, L * 0.34], { mirrorX: true }),
    glowPanel('bridgeGlow', [W * 0.62, 0.26, 0.06], [0, superY + superH * 0.30, -L * 0.10 + L * 0.17]),
    glowPanel('deckRunway', [W * 0.30, 0.05, L * 0.36], [0, hullH + H * 0.11, -L * 0.02]),
  );

  return {
    key: o.key, name: o.name, faction: o.faction, cls: 'naval',
    hullLength: L, masses, hullNumber: o.hullNumber,
    sockets: [
      { part: PartId.MuzzleA, pos: [0, hullH + H * 0.21, L * 0.46] },
      { part: PartId.Exhaust, pos: [0, superY + superH * 0.5 + H * 0.30, -L * 0.16] },
      { part: PartId.Dish, pos: [0, superY + superH * 0.5 + H * 0.30, -L * 0.16] },
    ],
  };
}

/* ==========================================================================
 * 7. AIRCRAFT
 * ========================================================================== */

interface PlaneOpts {
  key: string; name: string; faction: UnitMassList['faction']; hullNumber: number;
  length: number; span: number; height: number;
  /** Soviet MiG carries its engines in nacelles; the Vindicator is a blended body. */
  nacelles: boolean;
}

function plane(o: PlaneOpts): UnitMassList {
  const L = o.length, S = o.span, H = o.height;
  const fuseH = H * 0.42;
  const fuseY = H * 0.655;
  const wingY = fuseY - fuseH * 0.18;

  const masses: MassDef[] = [
    // Split forward/aft rather than one long tube: a single mass would be 73%
    // of the side silhouette, which is exactly the "3 plain boxes" half of R8.
    primary('forwardFuselage', 'box', [S * 0.20, fuseH, L * 0.56], [0, fuseY, L * 0.16], 'paintLarge', {
      taper: [0.70, 0.62, -L * 0.05],
    }),
    primary('aftBoom', 'box', [S * 0.16, fuseH * 0.78, L * 0.48], [0, fuseY - fuseH * 0.04, -L * 0.26], 'paintMed', {
      taper: [0.66, 0.60, -L * 0.05],
    }),
    primary('wing', 'box', [S * 0.42, H * 0.10, L * 0.32], [S * 0.26, wingY, -L * 0.06], 'paintLarge', {
      mirrorX: true, rot: [0, -0.28, 0.10], taper: [0.7, 0.62, 0],
    }),
    primary('tailFin', 'box', [0.14, H * 0.30, L * 0.20], [0, H - H * 0.15, -L * 0.40], 'paintMed', {
      taper: [0.7, 0.55, -L * 0.04],
    }),
    greeble('nose', 'lathe', [S * 0.18, L * 0.22, fuseH * 0.92], [0, fuseY, L * 0.56], 'paintMed', {
      profile: 'cone', segments: 12, topRadius: 0.22, rot: [-Math.PI * 0.5, 0, 0],
    }),
  ];

  masses.push(
    greeble('canopy', 'lathe', [S * 0.15, fuseH * 0.42, L * 0.24], [0, fuseY + fuseH * 0.42, L * 0.20], 'glass', {
      profile: 'dome', segments: 12,
    }),
    greeble('tailPlane', 'box', [S * 0.18, 0.10, L * 0.14], [S * 0.11, fuseY + fuseH * 0.10, -L * 0.44], 'paintSmall', {
      mirrorX: true, rot: [0, -0.16, 0.06],
    }),
    greeble('intake', 'box', [S * 0.10, fuseH * 0.42, L * 0.16], [S * 0.13, fuseY - fuseH * 0.10, L * 0.06], 'grille', { mirrorX: true }),
    greeble('gearPod', 'box', [S * 0.08, H * 0.12, L * 0.12], [S * 0.12, fuseY - fuseH * 0.5, -L * 0.02], 'paintTiny', { mirrorX: true }),
    greeble('pylon', 'box', [0.14, H * 0.10, L * 0.10], [S * 0.24, wingY - H * 0.07, -L * 0.04], 'bareMetal', { mirrorX: true }),
    greeble('ordnance', 'lathe', [0.26, L * 0.26, 0.26], [S * 0.24, wingY - H * 0.13, -L * 0.02], 'bareMetal', {
      mirrorX: true, profile: 'capsule', segments: 10, rot: [Math.PI * 0.5, 0, 0],
    }),
  );

  if (o.nacelles) {
    masses.push(
      greeble('nacelle', 'lathe', [S * 0.13, L * 0.34, S * 0.13], [S * 0.17, fuseY - fuseH * 0.16, -L * 0.26], 'bareMetal', {
        mirrorX: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0],
      }),
    );
  } else {
    masses.push(
      greeble('exhaustRing', 'lathe', [S * 0.14, 0.24, S * 0.14], [0, fuseY, -L * 0.52], 'bareMetal', {
        profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0],
      }),
    );
  }

  masses.push(
    slab('wingBand', [S * 0.22, 0.07, L * 0.11], [S * 0.28, wingY + H * 0.05, -L * 0.06], { mirrorX: true }),
    slab('finFlash', [0.07, H * 0.18, L * 0.10], [0.06, H - H * 0.16, -L * 0.40], { mirrorX: true }),
    slab('spine', [S * 0.08, 0.07, L * 0.24], [0, fuseY + fuseH * 0.5, -L * 0.06]),
  );
  masses.push(insignia([S * 0.13, 0.06, S * 0.13], [S * 0.28, wingY + H * 0.06, -L * 0.06]));
  masses.push(
    glowPanel('afterburner', [S * 0.13, 0.18, 0.06], [0, fuseY, -L * 0.56]),
    glowPanel('wingTipLight', [0.10, 0.22, L * 0.20], [S * 0.44, wingY + H * 0.02, -L * 0.06], { mirrorX: true }),
  );

  return {
    key: o.key, name: o.name, faction: o.faction, cls: 'air',
    hullLength: L, masses, hullNumber: o.hullNumber,
    sockets: [
      { part: PartId.MuzzleA, pos: [S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.MuzzleB, pos: [-S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.Exhaust, pos: [0, fuseY, -L * 0.56] },
    ],
  };
}

/* ==========================================================================
 * 8. THE ROSTER
 * ========================================================================== */

export const UNIT_MASS_LISTS: readonly UnitMassList[] = [
  /* -- Allies ----------------------------------------------------------- */
  infantry({ key: 'allied_rifle', name: 'Peacekeeper', faction: 'allies', hullNumber: 4172, weapon: 'rifle', pack: 'radio' }),
  infantry({ key: 'allied_engineer', name: 'Engineer', faction: 'allies', hullNumber: 4172, weapon: 'tool', pack: 'case' }),

  tank({
    key: 'allied_guardian', name: 'Guardian Tank', faction: 'allies', hullNumber: 4172,
    hullLength: 6.6, hullWidth: 3.2, height: 2.50, brutalist: false, gun: 'cannon', wheels: 5,
  }),
  tank({
    key: 'allied_ifv', name: 'Multigunner IFV', faction: 'allies', hullNumber: 4172,
    hullLength: 5.4, hullWidth: 2.9, height: 2.45, brutalist: false, gun: 'twinCannon', wheels: 4,
  }),
  tank({
    key: 'allied_prism', name: 'Prism Tank', faction: 'allies', hullNumber: 4172,
    hullLength: 6.4, hullWidth: 3.0, height: 2.60, brutalist: false, gun: 'prism', wheels: 5,
  }),
  support({
    key: 'allied_harvester', name: 'Chrono Miner', faction: 'allies', hullNumber: 4172,
    hullLength: 8.6, hullWidth: 4.0, height: 3.30, brutalist: false, role: 'harvester',
  }),
  support({
    key: 'allied_dozer', name: 'Construction Dozer', faction: 'allies', hullNumber: 4172,
    hullLength: 9.0, hullWidth: 4.4, height: 3.80, brutalist: false, role: 'dozer',
  }),
  ship({
    key: 'allied_destroyer', name: 'Assault Destroyer', faction: 'allies', hullNumber: 4172,
    length: 14.0, beam: 4.2, height: 4.4, brutalist: false, armament: 'turret',
  }),
  plane({
    key: 'allied_vindicator', name: 'Vindicator', faction: 'allies', hullNumber: 4172,
    length: 11.0, span: 12.0, height: 3.0, nacelles: false,
  }),

  /* -- Soviets ---------------------------------------------------------- */
  infantry({ key: 'soviet_conscript', name: 'Conscript', faction: 'soviets', hullNumber: 8188, weapon: 'rifle', pack: 'radio' }),
  infantry({ key: 'soviet_flak', name: 'Flak Trooper', faction: 'soviets', hullNumber: 8188, weapon: 'launcher', pack: 'drum' }),

  tank({
    key: 'soviet_rhino', name: 'Rhino Heavy Tank', faction: 'soviets', hullNumber: 8188,
    hullLength: 7.0, hullWidth: 3.4, height: 2.60, brutalist: true, gun: 'cannon', wheels: 6,
  }),
  sickle(),
  tank({
    key: 'soviet_v4', name: 'V4 Rocket Launcher', faction: 'soviets', hullNumber: 8188,
    hullLength: 7.4, hullWidth: 3.3, height: 2.90, brutalist: true, gun: 'rocketRack', wheels: 5,
  }),
  support({
    key: 'soviet_harvester', name: 'Ore Collector', faction: 'soviets', hullNumber: 8188,
    hullLength: 8.6, hullWidth: 4.0, height: 3.30, brutalist: true, role: 'harvester',
  }),
  support({
    key: 'soviet_dozer', name: 'Sputnik Dozer', faction: 'soviets', hullNumber: 8188,
    hullLength: 9.0, hullWidth: 4.4, height: 3.80, brutalist: true, role: 'dozer',
  }),
  ship({
    key: 'soviet_dreadnought', name: 'Dreadnought', faction: 'soviets', hullNumber: 8188,
    length: 16.0, beam: 4.8, height: 4.8, brutalist: true, armament: 'battery',
  }),
  plane({
    key: 'soviet_mig', name: 'MiG Fighter', faction: 'soviets', hullNumber: 8188,
    length: 10.0, span: 10.5, height: 2.9, nacelles: true,
  }),
];

/** key -> mass list, for the model registry. */
export const UNIT_MASS_BY_KEY: ReadonlyMap<string, UnitMassList> =
  new Map(UNIT_MASS_LISTS.map((u) => [u.key, u]));

/** Every faction that has at least one unit, in atlas-build order. */
export const UNIT_FACTIONS: readonly UnitMassList['faction'][] = ['allies', 'soviets'];
