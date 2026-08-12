/**
 * ============================================================================
 * src/ui/icons.ts — THE ICON SET
 * ============================================================================
 * One crisp inline-SVG vocabulary for the whole interface. These replace the
 * painted cameo miniatures: a modern command interface is read at a glance, and
 * a glance is a silhouette, not a diorama.
 *
 * THE RULES, enforced by construction rather than by review
 * --------------------------------------------------------
 * 1. **24 x 24 grid.** Every path is authored inside `0 0 24 24`. Nothing is
 *    authored at a display size, so an icon is identical at 16 px in a build
 *    slot and at 40 px in a selection card.
 * 2. **1.7 px stroke, round caps and joins.** One weight for the entire set.
 *    A set with mixed weights reads as clip-art no matter how good the shapes
 *    are. Solids exist only where a shape MUST read as mass (a bolt, a chevron,
 *    a blip) and are marked `fill: true`.
 * 3. **`currentColor` only.** No icon carries a colour. The slot, the card or
 *    the toast sets `color:` and the icon follows — that is what lets one set
 *    serve the accent, the amber and the red semantics without a second copy.
 * 4. **No detail below ~1.5 units.** At 16 px an icon is drawn at 0.66 device
 *    px per unit; anything finer than that turns to grey mush.
 *
 * WHAT IS HERE
 * ------------
 * Every structure archetype, every unit class, the four build tabs, the
 * stances, the economy readouts, the unit stat row, the alert severities and
 * the handful of verbs (repair, sell, cancel, primary). `iconForBuildable` and
 * `iconForUnitKey` resolve a content key onto one of them, so a def table that
 * lands later gets sensible icons with no edit here.
 * ============================================================================
 */

import { BuildTab, EntityKind } from '../core/types';

/* ==========================================================================
 * 1. SHAPE MODEL
 * ========================================================================== */

/** One sub-path of an icon. Stroked unless `fill` is set. */
export interface IconPath {
  readonly d: string;
  /** Filled with currentColor instead of stroked. */
  readonly fill?: boolean;
  /** Override the set weight. Use sparingly — a second weight is a smell. */
  readonly width?: number;
}

export interface IconDef {
  readonly paths: readonly IconPath[];
}

/** The stroke weight of the whole set, in grid units. */
export const ICON_STROKE = 1.7;
/** The authoring grid. Everything is in `0 0 24 24`. */
export const ICON_GRID = 24;

export type IconName =
  /* -- structures ------------------------------------------------------- */
  | 'conyard' | 'power' | 'refinery' | 'barracks' | 'warfactory' | 'radar'
  | 'lab' | 'silo' | 'airfield' | 'navalyard' | 'depot' | 'superweapon'
  /* -- defences --------------------------------------------------------- */
  | 'wall' | 'turret' | 'antiair' | 'tesla' | 'prism'
  /* -- unit classes ----------------------------------------------------- */
  | 'infantry' | 'rocketInfantry' | 'engineer' | 'dog'
  | 'tank' | 'heavyTank' | 'artillery' | 'harvester' | 'mcv' | 'apc'
  | 'aircraft' | 'helicopter' | 'ship'
  /* -- build tabs ------------------------------------------------------- */
  | 'tabStructures' | 'tabDefense' | 'tabInfantry' | 'tabVehicles'
  /* -- economy / readouts ----------------------------------------------- */
  | 'credits' | 'bolt' | 'clock' | 'storage'
  /* -- status telltales -------------------------------------------------- */
  | 'army' | 'base' | 'trend' | 'timer' | 'lock' | 'queue'
  /* -- unit stat row ---------------------------------------------------- */
  | 'armour' | 'damage' | 'range' | 'speed' | 'veterancy'
  /* -- stances ---------------------------------------------------------- */
  | 'stanceAggressive' | 'stanceDefensive' | 'stanceHoldFire' | 'stanceHoldGround'
  /* -- verbs ------------------------------------------------------------ */
  | 'repair' | 'sell' | 'primary' | 'cancel' | 'deploy' | 'stop' | 'scatter'
  | 'waypoint' | 'guard'
  /* -- alerts ----------------------------------------------------------- */
  | 'alert' | 'warning' | 'info' | 'ready'
  /* -- identity ---------------------------------------------------------- */
  | 'crest';

/* ==========================================================================
 * 2. THE SET
 *
 * Read these as engineering drawings, not doodles: a structure is a plan
 * elevation, a unit is a three-quarter plan, a verb is a pictogram. Keeping the
 * three families visually distinct is what makes a 24-slot build grid scannable
 * without reading a single label.
 * ========================================================================== */

export const ICONS: Readonly<Record<IconName, IconDef>> = {
  /* ---------------------------------------------------------------- */
  /* STRUCTURES — plan elevations, always seated on a ground line      */
  /* ---------------------------------------------------------------- */

  /** Construction Yard: a shed under a jib crane. */
  conyard: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M5 21v-9h7v9' },
      { d: 'M8.5 12V4.5h11' },
      { d: 'M19.5 4.5v4.5' },
      { d: 'M17.5 9h4v3h-4z' },
    ],
  },

  /** Power Plant: a cooling stack with a bolt cut through it. */
  power: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M5 21V9.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3V21' },
      { d: 'M12.8 9.5 9.2 14.6h2.6L11 19l3.9-5.4h-2.7z', fill: true },
    ],
  },

  /** Ore Refinery: a hopper feeding a tank, with ore falling in. */
  refinery: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M4 8h8l-2.2 4H6.2z' },
      { d: 'M6.5 12v9' },
      { d: 'M9.5 12v9' },
      { d: 'M13.5 21v-7a3 3 0 0 1 3-3h.5a3 3 0 0 1 3 3v7' },
      { d: 'M6 4.5h1.6M9.2 3.2h1.6', width: 2.1 },
    ],
  },

  /** Barracks: a long hut with a door and a flag mast. */
  barracks: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M4 21v-8l8-4 8 4v8' },
      { d: 'M10 21v-5h4v5' },
      { d: 'M12 9V4.5' },
      { d: 'M12 4.5h4l-1.4 1.6L16 7.7h-4z', fill: true },
    ],
  },

  /** War Factory: a sawtooth roof over a roller door. */
  warfactory: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M3.5 21v-8l4-3v3l4-3v3l4-3v11' },
      { d: 'M17 21v-6h4v6' },
      { d: 'M5.5 21v-4h4v4' },
    ],
  },

  /** Radar Dome: a dish on a mast, with a sweep arc. */
  radar: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M12 21v-7' },
      { d: 'M7.5 21h9' },
      { d: 'M4.6 12.4a8 8 0 0 1 9.6-8.9' },
      { d: 'M4.6 12.4 12 14' },
      { d: 'M17.6 6.4a4.5 4.5 0 0 1 1.2 4.4' },
    ],
  },

  /** Battle Lab: a flask with a rising bubble. */
  lab: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M10 3.5v6L5.8 17.5A2 2 0 0 0 7.6 20.5h8.8a2 2 0 0 0 1.8-3L14 9.5v-6' },
      { d: 'M8.8 3.5h6.4' },
      { d: 'M8.4 14.5h7.2' },
    ],
  },

  /** Ore Silo: a capped cylinder. */
  silo: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M6.5 8.5v10.2c0 1 2.5 1.8 5.5 1.8s5.5-.8 5.5-1.8V8.5' },
      { d: 'M6.5 8.5c0-1 2.5-1.8 5.5-1.8s5.5.8 5.5 1.8-2.5 1.8-5.5 1.8-5.5-.8-5.5-1.8z' },
      { d: 'M12 6.7V3.5' },
    ],
  },

  /** Airfield: a control tower beside a runway threshold. */
  airfield: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M5 21V9l3-2.5L11 9v12' },
      { d: 'M4 9h8' },
      { d: 'M14.5 21 20 12' },
      { d: 'M16.4 18.5h4M18 15.6h3.4' },
    ],
  },

  /** Naval Yard: an anchor over a waterline. */
  navalyard: {
    paths: [
      { d: 'M12 6.5v11' },
      { d: 'M12 3.2a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z' },
      { d: 'M8.4 9.2h7.2' },
      { d: 'M5.6 12.6a6.6 6.6 0 0 0 12.8 0' },
      { d: 'M2.5 20.5c2.4 0 2.4-1.6 4.8-1.6s2.4 1.6 4.8 1.6 2.4-1.6 4.8-1.6 2.4 1.6 4.6 1.6' },
    ],
  },

  /** Service Depot: a gear over a repair bay. */
  depot: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M3.5 21v-7h17v7' },
      { d: 'M12 4.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z' },
      { d: 'M12 2.6v1.6M12 11v1.6M8.5 4.6l1.1 1.1M14.4 9.5l1.1 1.1M6.9 7.6h1.6M15.5 7.6h1.6M8.5 10.6l1.1-1.1M14.4 5.7l1.1-1.1' },
    ],
  },

  /** Superweapon: a warhead in an open silo. */
  superweapon: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M6 21v-9h12v9' },
      { d: 'M12 3 9.6 8.2h4.8z', fill: true },
      { d: 'M9.6 8.2v4h4.8v-4' },
      { d: 'M8.4 12h7.2' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* DEFENCES                                                         */
  /* ---------------------------------------------------------------- */

  /** Wall: a coursed block run. */
  wall: {
    paths: [
      { d: 'M3 8h18v9H3z' },
      { d: 'M3 12.5h18' },
      { d: 'M9 8v4.5M15 8v4.5M6 12.5V17M12 12.5V17M18 12.5V17' },
    ],
  },

  /** Pillbox / gun turret: a dome with an embrasure and a barrel. */
  turret: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M5 21v-4.5a7 7 0 0 1 14 0V21' },
      { d: 'M9 15.5h6' },
      { d: 'M12 10.5V4.5' },
      { d: 'M10.4 4.5h3.2' },
    ],
  },

  /** Anti-air: paired barrels elevated off a mount. */
  antiair: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M6.5 21v-3.5h11V21' },
      { d: 'M9 17.5 16 6.5' },
      { d: 'M12 17.5 19 6.5' },
      { d: 'M15.4 5.6 17 8M18.4 5.6 20 8' },
    ],
  },

  /** Tesla Coil: a mast, a toroid and two arcs. */
  tesla: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M8.5 21h7l-1.5-8h-4z' },
      { d: 'M12 13V8' },
      { d: 'M8.4 6.6h7.2' },
      { d: 'M12 8a2.6 1.4 0 1 1 0-2.8 2.6 1.4 0 0 1 0 2.8z' },
      { d: 'M12.9 2 11 5.4h2.1L11.9 8.4l3-3.7h-2z', fill: true },
    ],
  },

  /** Prism Tower: a faceted crystal firing a beam. */
  prism: {
    paths: [
      { d: 'M2.5 21h19' },
      { d: 'M8 21h8l-1.4-6H9.4z' },
      { d: 'M12 15 8.6 9.5 12 3.5l3.4 6z' },
      { d: 'M12 3.5v11.5' },
      { d: 'M8.6 9.5h6.8' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* UNIT CLASSES — three-quarter plans, never seated on a ground line */
  /* ---------------------------------------------------------------- */

  /** Rifle infantry: helmet, torso, stride. */
  infantry: {
    paths: [
      { d: 'M12 2.8a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z' },
      { d: 'M12 7.4v7' },
      { d: 'M8 10.4l4-1.4 4 1.4' },
      { d: 'M12 14.4 9 21M12 14.4 15 21' },
    ],
  },

  /** Rocket infantry: the same figure shouldering a tube. */
  rocketInfantry: {
    paths: [
      { d: 'M10.5 2.8a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z' },
      { d: 'M10.5 7.4v7' },
      { d: 'M10.5 14.4 8 21M10.5 14.4 13.2 21' },
      { d: 'M6 12.6 18.5 8.2' },
      { d: 'M18.5 8.2 21.5 7.1l-1 2.9z', fill: true },
    ],
  },

  /** Engineer: a figure with a hard hat and a case. */
  engineer: {
    paths: [
      { d: 'M10 3.4a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z' },
      { d: 'M6.8 3.6h6.4' },
      { d: 'M10 7.8v6.4' },
      { d: 'M10 14.2 7.6 21M10 14.2 12.4 21' },
      { d: 'M14.5 12.4h5.5v5h-5.5z' },
      { d: 'M16.2 12.4v-1.6h2.1v1.6' },
    ],
  },

  /** Attack dog: a low quadruped silhouette. */
  dog: {
    paths: [
      { d: 'M4 16.5V13a2.4 2.4 0 0 1 2.4-2.4h7.4l2.6-2.8h2.4v3.2l-1.6 1.4v3.6' },
      { d: 'M18.6 8.5V6.2l-1.8 1.7' },
      { d: 'M6 16.5V21M9.6 16.5V21M14.4 16.5V21M17.2 16.5V21' },
      { d: 'M4 13 1.8 10.4' },
    ],
  },

  /** Main battle tank: hull, treads, turret, gun. */
  tank: {
    paths: [
      { d: 'M2.6 14h18.8v5H2.6z' },
      { d: 'M2.6 16.5h18.8' },
      { d: 'M6.5 14v-3.4h11V14' },
      { d: 'M12 10.6V4.4' },
      { d: 'M10.2 4.4h3.6' },
    ],
  },

  /** Heavy tank: wider hull, twin barrels, sloped glacis. */
  heavyTank: {
    paths: [
      { d: 'M1.8 14.5h20.4v5.2H1.8z' },
      { d: 'M1.8 17.2h20.4' },
      { d: 'M5 14.5v-3.2l2.4-1.8h9.2l2.4 1.8v3.2' },
      { d: 'M10 9.5V3.6M14 9.5V3.6' },
      { d: 'M8.6 3.6h2.8M12.6 3.6h2.8' },
    ],
  },

  /** Artillery: a long tube at elevation over a braced carriage. */
  artillery: {
    paths: [
      { d: 'M2.6 15.5h13.4v4.2H2.6z' },
      { d: 'M2.6 17.6h13.4' },
      { d: 'M6.4 15.5v-2.6h6v2.6' },
      { d: 'M8.4 13.4 20.6 4.6' },
      { d: 'M20.6 4.6l1.9-1.4-.5 2.3z', fill: true },
      { d: 'M9.8 15.5 7 12.6' },
    ],
  },

  /** Ore harvester: a big hopper on treads with an intake scoop. */
  harvester: {
    paths: [
      { d: 'M2.6 15.6h18.8v4.4H2.6z' },
      { d: 'M2.6 17.8h18.8' },
      { d: 'M5.6 15.6V9.4h10V15.6' },
      { d: 'M5.6 12h10' },
      { d: 'M15.6 11 20.4 8v5.2' },
    ],
  },

  /** MCV / dozer: a boxy hull with deploy arrows. */
  mcv: {
    paths: [
      { d: 'M2.6 15.6h18.8v4.4H2.6z' },
      { d: 'M2.6 17.8h18.8' },
      { d: 'M5.4 15.6V8.6h13.2v7' },
      { d: 'M12 5.6 9.4 8.6h5.2z', fill: true },
      { d: 'M8.4 11.4h7.2M8.4 13.6h7.2' },
    ],
  },

  /** APC / IFV: a wheeled hull with a cupola. */
  apc: {
    paths: [
      { d: 'M3 12.4h15.2l2.8 3.4v2.6H3z' },
      { d: 'M6.4 18.4a2 2 0 1 0 0 .1zM17 18.4a2 2 0 1 0 0 .1z' },
      { d: 'M6.4 16.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM17 16.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z' },
      { d: 'M9.4 12.4V9.2h4.4v3.2' },
      { d: 'M11.6 9.2V6' },
    ],
  },

  /** Fixed-wing aircraft: a swept planform seen from above. */
  aircraft: {
    paths: [
      { d: 'M12 2.6 13.6 9l7.4 4.6v2.2l-7.4-2.2-.6 4.2 2.6 2v1.2L12 20l-3.6.9v-1.2l2.6-2-.6-4.2L3 15.8v-2.2L10.4 9z' },
    ],
  },

  /** Helicopter: fuselage, rotor disc, tail boom. */
  helicopter: {
    paths: [
      { d: 'M3.4 6.6h13.2' },
      { d: 'M10 6.6v2.4' },
      { d: 'M5 12.4a4.4 3.4 0 0 1 4.4-3.4h2.2a4.4 3.4 0 0 1 4.4 3.4v1.6H5z' },
      { d: 'M16 12.8h5.2' },
      { d: 'M20.2 10.6v4.4' },
      { d: 'M7 14v2.4M14 14v2.4' },
      { d: 'M5.4 16.6h10.4' },
    ],
  },

  /** Warship: hull, superstructure, waterline. */
  ship: {
    paths: [
      { d: 'M2.4 13.4h19.2l-2.6 4.6H5z' },
      { d: 'M8 13.4V9.4h6.4v4' },
      { d: 'M11 9.4V4.6' },
      { d: 'M11 4.6h4.4' },
      { d: 'M2.6 20.6c2.2 0 2.2-1.4 4.4-1.4s2.2 1.4 4.4 1.4 2.2-1.4 4.4-1.4 2.2 1.4 4.2 1.4' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* BUILD TABS — deliberately blunter than the roster icons, because  */
  /* they are read at 15 px inside a strip and never beside a label.   */
  /* ---------------------------------------------------------------- */

  tabStructures: {
    paths: [
      { d: 'M3 21h18' },
      { d: 'M4.5 21V9.5l7.5-4.5 7.5 4.5V21' },
      { d: 'M10 21v-5.5h4V21' },
    ],
  },

  tabDefense: {
    paths: [
      { d: 'M12 2.8 20 6v6.4c0 5-3.6 8.2-8 9.6-4.4-1.4-8-4.6-8-9.6V6z' },
      { d: 'M12 8.4v7' },
    ],
  },

  tabInfantry: {
    paths: [
      { d: 'M12 2.8a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z' },
      { d: 'M12 7.6v6.8' },
      { d: 'M7.6 10.6 12 9l4.4 1.6' },
      { d: 'M12 14.4 8.8 21M12 14.4 15.2 21' },
    ],
  },

  tabVehicles: {
    paths: [
      { d: 'M2.6 14.6h18.8v5H2.6z' },
      { d: 'M2.6 17.1h18.8' },
      { d: 'M6.6 14.6v-3.4h10.8v3.4' },
      { d: 'M12 11.2V5.6' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* ECONOMY AND READOUTS                                             */
  /* ---------------------------------------------------------------- */

  /** Credits: a struck coin. */
  credits: {
    paths: [
      { d: 'M12 3.2a8.8 8.8 0 1 1 0 17.6 8.8 8.8 0 0 1 0-17.6z' },
      { d: 'M12 6.4v11.2' },
      { d: 'M15 9.2c0-1.5-1.3-2.4-3-2.4s-3 .9-3 2.5 1.4 2.2 3 2.7 3 1 3 2.6-1.3 2.4-3 2.4-3-.9-3-2.4' },
    ],
  },

  /** Power: a bolt. The one solid in the readout family. */
  bolt: {
    paths: [{ d: 'M13.6 2.4 6.2 13.4h4.6L9.6 21.6l8.2-11.6h-5z', fill: true }],
  },

  /** Match clock. */
  clock: {
    paths: [
      { d: 'M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2z' },
      { d: 'M12 7.4V12l3.4 2.2' },
    ],
  },

  /** Ore storage: a stacked bin. */
  storage: {
    paths: [
      { d: 'M3.6 8.6h16.8v11.8H3.6z' },
      { d: 'M3.6 8.6 12 3.6l8.4 5' },
      { d: 'M7.4 20.4v-5.6h9.2v5.6' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* STATUS TELLTALES                                                 */
  /*                                                                  */
  /* Read at 10-11 px beside a two-digit number, so these are the     */
  /* bluntest shapes in the file. `army` and `base` are deliberately   */
  /* map-symbol abstractions rather than miniatures: a 10 px soldier   */
  /* is a smudge, a 10 px crossed box is unmistakable.                 */
  /* ---------------------------------------------------------------- */

  /** Field army: the NATO infantry box. */
  army: {
    paths: [
      { d: 'M3.2 6.8h17.6v10.4H3.2z' },
      { d: 'M3.2 6.8 20.8 17.2M20.8 6.8 3.2 17.2' },
    ],
  },

  /** Structures owned: a roofline cluster. */
  base: {
    paths: [
      { d: 'M2.5 20.6h19' },
      { d: 'M4 20.6v-7.2l5-3.4 5 3.4v7.2' },
      { d: 'M15.4 20.6V11l4.6-2.8v12.4' },
      { d: 'M7.4 20.6v-4h3.2v4' },
    ],
  },

  /** Income rate: a rising trace with a head arrow. */
  trend: {
    paths: [
      { d: 'M3 18.4 9.6 11.8l3.8 3.8L21 8.2' },
      { d: 'M15.4 8.2H21v5.6' },
    ],
  },

  /** Build-time countdown: an hourglass. */
  timer: {
    paths: [
      { d: 'M6.6 3.4h10.8M6.6 20.6h10.8' },
      { d: 'M8.2 3.4v3.2L12 11l-3.8 4.4v5.2' },
      { d: 'M15.8 3.4v3.2L12 11l3.8 4.4v5.2' },
    ],
  },

  /** Locked by the tech tree. */
  lock: {
    paths: [
      { d: 'M5.4 10.6h13.2v10H5.4z' },
      { d: 'M8.4 10.6V7.8a3.6 3.6 0 0 1 7.2 0v2.8' },
      { d: 'M12 14v3.2' },
    ],
  },

  /** Items waiting in a queue: stacked plates. */
  queue: {
    paths: [
      { d: 'M4 5.4h16v3.2H4zM4 10.4h16v3.2H4zM4 15.4h16v3.2H4z' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* UNIT STAT ROW                                                    */
  /* ---------------------------------------------------------------- */

  /** Armour class. */
  armour: {
    paths: [
      { d: 'M12 2.8 19.6 6v6.2c0 4.8-3.4 7.8-7.6 9.2-4.2-1.4-7.6-4.4-7.6-9.2V6z' },
      { d: 'M8.6 11.6l2.4 2.4 4.4-4.6' },
    ],
  },

  /** Damage: an impact burst. */
  damage: {
    paths: [
      { d: 'M12 2.6 14 8l5.6-2-2.6 5.2 4.4 3.4-5.4 1.2.6 5.6-4.6-3.2-4.6 3.2.6-5.6L3 14.6l4.4-3.4L4.8 6 10.4 8z' },
    ],
  },

  /** Range: a span between two stops. */
  range: {
    paths: [
      { d: 'M4 5.4v13.2M20 5.4v13.2' },
      { d: 'M6.4 12h11.2' },
      { d: 'M8.8 9.4 6.2 12l2.6 2.6M15.2 9.4l2.6 2.6-2.6 2.6' },
    ],
  },

  /** Speed: a needle on a dial. */
  speed: {
    paths: [
      { d: 'M3.6 18.4a9 9 0 1 1 16.8 0' },
      { d: 'M12 17.4 16.4 9.6' },
      { d: 'M12 15.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z' },
    ],
  },

  /** One veterancy chevron, solid so it survives a 10 px card badge. */
  veterancy: {
    paths: [{ d: 'M12 5.4 20 16h-3.6L12 10.2 7.6 16H4z', fill: true }],
  },

  /* ---------------------------------------------------------------- */
  /* STANCES                                                          */
  /* ---------------------------------------------------------------- */

  /** Aggressive: a crosshair with a pursuit arrow. */
  stanceAggressive: {
    paths: [
      { d: 'M11 12.6a5.4 5.4 0 1 1 0-.1z' },
      { d: 'M11 4.8a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6z' },
      { d: 'M11 9.4a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z' },
      { d: 'M15.8 7.8 21.4 2.6M17.2 2.6h4.4v4.4' },
    ],
  },

  /** Defensive: a shield with a firing arc. */
  stanceDefensive: {
    paths: [
      { d: 'M12 2.8 19.4 6v6.2c0 4.8-3.3 7.8-7.4 9.2-4.1-1.4-7.4-4.4-7.4-9.2V6z' },
      { d: 'M8.2 12.4a3.8 3.8 0 0 0 7.6 0' },
    ],
  },

  /** Hold fire: a barred muzzle. */
  stanceHoldFire: {
    paths: [
      { d: 'M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z' },
      { d: 'M6.1 17.9 17.9 6.1' },
    ],
  },

  /** Hold ground: a planted pin. */
  stanceHoldGround: {
    paths: [
      { d: 'M12 3.4a5 5 0 0 1 5 5c0 3.6-5 10-5 10s-5-6.4-5-10a5 5 0 0 1 5-5z' },
      { d: 'M12 6.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z' },
      { d: 'M4.6 21h14.8' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* VERBS                                                            */
  /* ---------------------------------------------------------------- */

  /** Repair: an open-end wrench, canted off vertical. */
  repair: {
    paths: [
      { d: 'M15.6 3.4a5.4 5.4 0 0 0-6.2 7.2L3.4 16.6a2.2 2.2 0 0 0 3.1 3.1l6-6a5.4 5.4 0 0 0 7.2-6.2l-3 3-3.1-3.1z' },
    ],
  },

  /** Sell: a tagged banknote leaving. */
  sell: {
    paths: [
      { d: 'M3 6.6h13.4v8.8H3z' },
      { d: 'M9.7 8.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z' },
      { d: 'M15.6 19.4h5.8v-5.8' },
      { d: 'M21.4 19.4 16 14' },
    ],
  },

  /** Primary factory: a star. */
  primary: {
    paths: [{ d: 'M12 2.6 14.9 9l6.9.7-5.2 4.7 1.5 6.8L12 17.6l-6.1 3.6 1.5-6.8L2.2 9.7 9.1 9z', fill: true }],
  },

  /** Cancel. */
  cancel: {
    paths: [{ d: 'M5.6 5.6 18.4 18.4M18.4 5.6 5.6 18.4' }],
  },

  /** Deploy: unfolding corners. */
  deploy: {
    paths: [
      { d: 'M8.6 8.6h6.8v6.8H8.6z' },
      { d: 'M3.4 8.6V3.4h5.2M15.4 3.4h5.2v5.2M20.6 15.4v5.2h-5.2M8.6 20.6H3.4v-5.2' },
    ],
  },

  /** Stop. */
  stop: {
    paths: [{ d: 'M6.4 6.4h11.2v11.2H6.4z' }],
  },

  /** Scatter: four arrows radiating. */
  scatter: {
    paths: [
      { d: 'M12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z', fill: true },
      { d: 'M12 8.4V3.2M12 15.6v5.2M8.4 12H3.2M15.6 12h5.2' },
      { d: 'M9.8 5.4 12 3.2l2.2 2.2M9.8 18.6 12 20.8l2.2-2.2M5.4 9.8 3.2 12l2.2 2.2M18.6 9.8 20.8 12l-2.2 2.2' },
    ],
  },

  /** Waypoint: a dotted route with a flag. */
  waypoint: {
    paths: [
      { d: 'M3.4 19.4h5.4l4.4-8h5' },
      { d: 'M3.4 17.6a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z', fill: true },
      { d: 'M18.6 3.4v8' },
      { d: 'M18.6 3.4h4.2l-1.4 2 1.4 2h-4.2z', fill: true },
    ],
  },

  /** Guard: a shield with a sweep. */
  guard: {
    paths: [
      { d: 'M12 2.8 19.6 6v6.2c0 4.8-3.4 7.8-7.6 9.2-4.2-1.4-7.6-4.4-7.6-9.2V6z' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* ALERTS — these are the only icons ever tinted off the accent      */
  /* ---------------------------------------------------------------- */

  /** Base under attack. */
  alert: {
    paths: [
      { d: 'M12 3 1.8 20.6h20.4z' },
      { d: 'M12 9.4v5.2' },
      { d: 'M12 17a1 1 0 1 1 0 2 1 1 0 0 1 0-2z', fill: true },
    ],
  },

  /** Low power / warning. */
  warning: {
    paths: [
      { d: 'M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z' },
      { d: 'M12 7.6v5.4' },
      { d: 'M12 15.6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z', fill: true },
    ],
  },

  /** Informational. */
  info: {
    paths: [
      { d: 'M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z' },
      { d: 'M12 11.2v5.2' },
      { d: 'M12 6.8a1 1 0 1 1 0 2 1 1 0 0 1 0-2z', fill: true },
    ],
  },

  /** Construction complete. */
  ready: {
    paths: [
      { d: 'M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z' },
      { d: 'M7.8 12.2l2.9 2.9 5.5-5.8' },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* IDENTITY — the one icon whose job is not information              */
  /* ---------------------------------------------------------------- */

  /**
   * The army crest: a chamfered shield carrying a double chevron.
   *
   * It anchors the left end of the resource strip, which is where the
   * reference puts its faction crest. Deliberately FACTION-NEUTRAL in shape —
   * it is recoloured by `--vm-accent-hi` and nothing in `icons.ts` may know a
   * faction exists. The shield's own corners are cut at 45 degrees, so the one
   * ornament in the interface is drawn to the same rule as every panel in it.
   */
  crest: {
    paths: [
      { d: 'M12 2.4 20.4 5.2v5.1c0 4.9-3.5 8.4-8.4 11.3-4.9-2.9-8.4-6.4-8.4-11.3V5.2z' },
      { d: 'M6.9 9.5 12 12.1l5.1-2.6' },
      { d: 'M6.9 13.4 12 16l5.1-2.6' },
    ],
  },
};

/* ==========================================================================
 * 3. DOM
 * ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build an `<svg>` for one icon. Cold path only — every icon in the HUD is
 * created once at mount and then re-pointed with `setIcon`, so the frame loop
 * never touches `createElementNS`.
 */
export function makeIcon(name: IconName, className = 'vm-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ICON_GRID} ${ICON_GRID}`);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.icon = name;
  paintIcon(svg, name);
  return svg;
}

/**
 * Re-point an existing icon at a different glyph. No-op when it already shows
 * that glyph, which is what makes it safe to call from a per-frame sync pass.
 */
export function setIcon(svg: SVGSVGElement, name: IconName): void {
  if (svg.dataset.icon === name) return;
  svg.dataset.icon = name;
  while (svg.firstChild !== null) svg.removeChild(svg.firstChild);
  paintIcon(svg, name);
}

function paintIcon(svg: SVGSVGElement, name: IconName): void {
  const def = ICONS[name];
  for (const shape of def.paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', shape.d);
    if (shape.fill === true) {
      p.setAttribute('fill', 'currentColor');
      p.setAttribute('stroke', 'none');
    } else {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', String(shape.width ?? ICON_STROKE));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(p);
  }
}

/* ==========================================================================
 * 4. RESOLUTION
 *
 * Content keys are owned by src/data and src/game/Scenarios; they change
 * without warning. So resolution is by SUBSTRING against a normalised key,
 * ordered most-specific-first, with a per-tab fallback that is always a real
 * icon. A def table that lands tomorrow gets sensible icons with no edit here.
 * ========================================================================== */

/** Lower-case, alphanumerics only. `Ore Refinery` -> `orerefinery`. */
function normalise(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Structure keyword table, most specific first. */
const STRUCTURE_RULES: ReadonlyArray<readonly [string, IconName]> = [
  // MERIDIAN PACT, first because its names share no vocabulary with the other
  // two armies — "Conclave" is a construction yard, "Cistern" is a refinery —
  // and without these every Pact slot fell through to the tab's last resort,
  // so the whole grid drew one repeated depot glyph.
  ['conclave', 'conyard'], ['solararray', 'power'], ['cistern', 'refinery'],
  ['chapterhouse', 'barracks'], ['forgeyard', 'warfactory'], ['oculus', 'radar'],
  ['vault', 'silo'], ['slipway', 'navalyard'], ['reliquary', 'lab'],
  ['rampart', 'wall'], ['glaive', 'turret'], ['helios', 'prism'],

  ['conyard', 'conyard'], ['constructionyard', 'conyard'], ['construction', 'conyard'],
  // THE SUPERWEAPONS, and they must all precede the `silo` and `helios` rules
  // below: `nuclearsilo` contains `silo`, so without `nuclear` here the most
  // recognisable structure in the game would draw an ore drum.
  ['nuke', 'superweapon'], ['missilesilo', 'superweapon'], ['nuclear', 'superweapon'],
  ['chronosphere', 'superweapon'], ['weathercontrol', 'superweapon'],
  ['ironcurtain', 'superweapon'], ['heliograph', 'superweapon'],
  ['stormworks', 'superweapon'], ['superweapon', 'superweapon'],
  ['tesla', 'tesla'], ['prism', 'prism'],
  ['flak', 'antiair'], ['patriot', 'antiair'], ['sam', 'antiair'], ['aa', 'antiair'],
  ['wall', 'wall'], ['gate', 'wall'],
  ['pillbox', 'turret'], ['sentry', 'turret'], ['bunker', 'turret'], ['turret', 'turret'],
  ['gun', 'turret'], ['cannon', 'turret'], ['defen', 'turret'],
  ['refinery', 'refinery'], ['proc', 'refinery'],
  ['powerplant', 'power'], ['reactor', 'power'], ['power', 'power'], ['generator', 'power'],
  ['barrack', 'barracks'], ['tent', 'barracks'], ['clonevat', 'barracks'],
  ['warfactory', 'warfactory'], ['factory', 'warfactory'], ['weap', 'warfactory'],
  ['radar', 'radar'], ['dome', 'radar'], ['outpost', 'radar'], ['spy', 'radar'],
  ['lab', 'lab'], ['tech', 'lab'], ['research', 'lab'],
  ['silo', 'silo'], ['storage', 'silo'],
  ['airfield', 'airfield'], ['airforce', 'airfield'], ['helipad', 'airfield'], ['air', 'airfield'],
  ['navalyard', 'navalyard'], ['shipyard', 'navalyard'], ['subpen', 'navalyard'], ['naval', 'navalyard'],
  ['depot', 'depot'], ['repair', 'depot'], ['service', 'depot'], ['hospital', 'depot'],
];

/** Unit keyword table, most specific first. */
const UNIT_RULES: ReadonlyArray<readonly [string, IconName]> = [
  // MERIDIAN PACT. Same reason as STRUCTURE_RULES: none of these words appear
  // in the shared vocabulary. 'suncollector' must precede the generic 'ore'
  // rule and 'sunlancer' must precede 'lance', so both sit here.
  ['wayfarer', 'infantry'], ['sunlancer', 'rocketInfantry'], ['artificer', 'engineer'],
  ['suncollector', 'harvester'], ['sandskiff', 'apc'], ['solarch', 'tank'],
  ['zenith', 'artillery'], ['carryall', 'mcv'], ['kestrel', 'helicopter'],
  ['corvette', 'ship'], ['sunmonitor', 'ship'],

  // THE THIRTEEN ROWS THAT FINISHED THE NAVAL LINE. Same reason again: not one
  // of these words is in the shared vocabulary, so without them a recon hull, a
  // landing ship and a swimmer would all take their tab's last resort — a tank,
  // a tank and a rifleman. That is `iconForBuildable` working as documented
  // rather than failing, which is exactly why nothing goes red when it happens.
  //
  // THE LIFTS TAKE `apc`, NOT `ship`, and that is a decision rather than an
  // oversight. `transport` has mapped to `apc` since this table was written,
  // and the thing a player needs off a glyph in a grid of warships is "this one
  // carries your army" — which a hull silhouette does not say and the troop box
  // does. The two eight-slot heavies take it for the same reason.
  //
  // `picketBoat` and `navalInfantry` are deliberately absent: `boat` and
  // `infantry` below already answer them, and a rule that restates a rule is a
  // rule that can disagree with it later.
  ['hydrofoil', 'ship'], ['cutter', 'ship'], ['skimmer', 'ship'],
  ['landingcraft', 'apc'], ['barge', 'apc'], ['lighter', 'apc'],
  ['argosy', 'apc'], ['hauler', 'apc'],
  ['frogman', 'infantry'], ['tidewalker', 'infantry'], ['dredger', 'infantry'],

  ['dog', 'dog'], ['hound', 'dog'], ['bear', 'dog'],
  ['engineer', 'engineer'], ['mechanic', 'engineer'], ['spy', 'engineer'], ['saboteur', 'engineer'],
  ['rocket', 'rocketInfantry'], ['missile', 'rocketInfantry'], ['bazooka', 'rocketInfantry'],
  ['flaktroop', 'rocketInfantry'], ['grenad', 'rocketInfantry'],
  ['harvest', 'harvester'], ['miner', 'harvester'], ['collector', 'harvester'], ['ore', 'harvester'],
  ['mcv', 'mcv'], ['dozer', 'mcv'], ['deploy', 'mcv'], ['sputnik', 'mcv'],
  ['apoc', 'heavyTank'], ['mammoth', 'heavyTank'], ['rhino', 'heavyTank'], ['heavy', 'heavyTank'],
  ['siege', 'artillery'], ['artiller', 'artillery'], ['v3', 'artillery'], ['v4', 'artillery'],
  ['catapult', 'artillery'], ['howitzer', 'artillery'], ['launcher', 'artillery'],
  ['ifv', 'apc'], ['apc', 'apc'], ['multigunner', 'apc'], ['transport', 'apc'],
  ['jeep', 'apc'], ['ranger', 'apc'], ['scout', 'apc'], ['bike', 'apc'],
  ['heli', 'helicopter'], ['copter', 'helicopter'], ['twinblade', 'helicopter'],
  ['chopper', 'helicopter'], ['hind', 'helicopter'],
  ['mig', 'aircraft'], ['jet', 'aircraft'], ['bomber', 'aircraft'], ['fighter', 'aircraft'],
  ['harrier', 'aircraft'], ['vindicator', 'aircraft'], ['apollo', 'aircraft'], ['plane', 'aircraft'],
  ['destroyer', 'ship'], ['dreadnought', 'ship'], ['cruiser', 'ship'], ['submarine', 'ship'],
  ['sub', 'ship'], ['gunboat', 'ship'], ['carrier', 'ship'], ['ship', 'ship'], ['boat', 'ship'],
  ['tank', 'tank'], ['grizzly', 'tank'], ['guardian', 'tank'], ['sickle', 'tank'],
  ['conscript', 'infantry'], ['rifle', 'infantry'], ['peacekeeper', 'infantry'],
  ['soldier', 'infantry'], ['trooper', 'infantry'], ['sniper', 'infantry'], ['infantry', 'infantry'],
];

/** Per-tab last resort. Always a real icon, never a placeholder box. */
const TAB_FALLBACK: Readonly<Record<number, IconName>> = {
  [BuildTab.Structures]: 'depot',
  [BuildTab.Defense]: 'turret',
  [BuildTab.Infantry]: 'infantry',
  [BuildTab.Vehicles]: 'tank',
  // A commander power has no hardware to draw, so the last resort is the
  // superweapon glyph — the one icon in the set that already means "a thing the
  // player calls down rather than builds". In practice `iconForCameo` in
  // Sidebar.ts resolves all five to their own silhouette before reaching here.
  [BuildTab.Powers]: 'superweapon',
};

/**
 * The icon for one build slot. `isBuilding` decides which keyword table is
 * consulted, so "Naval Yard" and "Destroyer" — which share a keyword — never
 * collide.
 */
export function iconForBuildable(key: string, name: string, tab: BuildTab, isBuilding: boolean): IconName {
  const hay = `${normalise(key)} ${normalise(name)}`;
  const rules = isBuilding ? STRUCTURE_RULES : UNIT_RULES;
  for (const [needle, icon] of rules) {
    if (hay.includes(needle)) return icon;
  }
  return TAB_FALLBACK[tab as number] ?? 'depot';
}

/**
 * The icon for a live entity in the selection panel. `kind` disambiguates when
 * the key is empty, which is the honest state before def tables land.
 */
export function iconForUnitKey(key: string, name: string, kind: EntityKind): IconName {
  const isBuilding = kind === EntityKind.Building;
  const tab = isBuilding
    ? BuildTab.Structures
    : kind === EntityKind.Infantry
      ? BuildTab.Infantry
      : BuildTab.Vehicles;
  if (key === '' && name === '') return TAB_FALLBACK[tab as number] ?? 'tank';
  return iconForBuildable(key, name, tab, isBuilding);
}

/**
 * The tab icons, in `BuildTab` order.
 *
 * NOT DRAWN BY THE SIDEBAR any more — the icon-over-label stack was removed to
 * give the band back its height, and the strip carries words. The array is kept
 * because `tests/hud.spec.ts` uses it as the check that every tab has an
 * identity in the icon set, so a tab added with no glyph is caught here rather
 * than the day something starts drawing them again. The Powers tab borrows the
 * superweapon glyph, which is the one that already means "called down, not
 * built".
 */
export const TAB_ICONS: readonly IconName[] = [
  'tabStructures', 'tabDefense', 'tabInfantry', 'tabVehicles', 'superweapon',
];
