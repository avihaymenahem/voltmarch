/**
 * ============================================================================
 * src/ui/Hud.ts — THE HUD OWNER
 * ============================================================================
 * Assembles the bottom bar, the tactical map, the world overlay and the toast
 * stack; sources the `HudSnapshot`; builds the selection view; and turns every
 * click into a `Command` on the bus.
 *
 * WHAT THIS FILE IS CAREFUL ABOUT
 * ------------------------------
 * 1. **No hard dependency on any sibling module.** Production, the def tables,
 *    terrain and placement are all reached through `import()` inside `init()`,
 *    each in its own try/catch. If production never lands, the build grid runs
 *    off a built-in roster; if terrain never lands, the map paints a flat
 *    field. Nothing in here can take the interface down.
 * 2. **It writes no state another module owns.** Production state is read from
 *    `ProductionService.snapshot`; selection belongs to input, so a click on a
 *    unit card CENTRES THE CAMERA rather than mutating the selection.
 * 3. **Zero allocation per frame.** The fallback snapshot, its four cameo
 *    arrays and the selection view (including its cards) are pooled and mutated
 *    in place.
 *
 * PUBLIC HOOKS FOR OTHER MODULES
 * ------------------------------
 *   hud.overlay.setMarquee(x0,y0,x1,y1) / clearMarquee()   input: drag select
 *   hud.overlay.setRallyArmed(on)                          input: rally cursor
 *   hud.sidebar.setArmed(mode) / hud.armedMode             input: repair & sell
 *   hud.waypointMode / hud.formationMove                   input: order modifiers
 *   hud.overlay.floater(x,y,z,text,color)                  anyone
 *   hud.overlay.orderMarker(x,y,z,kind)                    anyone
 *   hud.toast(kind,key,title,detail)                       anyone
 *   hud.onPlaceRequest = (defId, key) => {}                 placement
 *   hud.setSoundHook(fn)                                    audio
 * Also published as `globalThis.__vmHud` for the console and the harness.
 * ============================================================================
 */

import {
  BUILD_TAB_COUNT,
  BuildTab,
  ArmorClass,
  EntityFlag,
  EntityKind,
  EvaLine,
  Faction,
  MatchPhase,
  OrderKind,
  Stance,
  type DefTables,
  type EntityId,
  type HudCameo,
  type HudSnapshot,
  type PlayerId,
  type PlayerState,
  type UnitDef,
  type WeaponDef,
} from '../core/types';
// `ABILITIES` is content, and content lives in core/config — so reading it here
// is not the sim dependency the seam below exists to avoid. The HUD needs the
// label, the hint and the full cooldown; the SERVICE owns which unit has which
// and how much of the cooldown is left.
import { ABILITIES, HUD_SUPERWEAPON, MAX_SELECTION } from '../core/config';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import type { CameraRig } from '../render/camera';
import type { RendererHandle } from '../render/renderer';
// One statement of the self-repair rule, shared with the overlay. See the note
// on the import in `src/ui/Overlay.ts`.
import { UNIT_PUBLIC_ID_BASE } from '../sim/Production';
import { isRegenerating } from '../sim/Regen';

import {
  SEMANTIC,
  ToastStack,
  applyTheme,
  computeUiScale,
  el,
  formatClock,
  formatCost,
  formatStat,
  type ToastKind,
} from './Chrome';
import { Minimap, type TerrainSampler } from './Minimap';
import { Overlay } from './Overlay';
// `src/progression/powers.ts` imports NOTHING — not the engine, not `three`,
// not `src/sim/**` — and says so in its header, so this is a hard import for
// the same reason `ABILITIES` above is one: it is the CONTENT half (label,
// hint, charge, radius) and the content half is not what the seams exist to
// keep out. The SERVICE half — how much charge is left, and whether it may be
// called — is `commanderPowerSeam()` below and is duck-typed like the rest.
import {
  COMMANDER_POWERS, powersOwnedBy, type CommanderPowerDef,
} from '../progression/powers';

import {
  COMMANDER_POWER_ROWS,
  POWER_ICONS,
  SELF_DESTRUCT_CONFIRM_SECONDS,
  SLOT_HOTKEY_CODES,
  Sidebar,
  TAB_HOTKEY_CODES,
  powerStateOf,
  type AbilityAction,
  type AdviceKind,
  type ArmedMode,
  type BuildExtras,
  type CargoAction,
  type CommanderPowerRow,
  type CommanderPowerView,
  type GarrisonAction,
  type HudSoundCue,
  type HudTelemetry,
  type SelectionCard,
  type SelectionView,
  type SuperweaponRow,
  type SuperweaponView,
} from './Sidebar';
import { readProgression } from './Objectives';
// THE ONE STATIC EDGE FROM src/ui INTO src/data, and it is safe for the reason
// rule 1 in this file's header cares about: `Descriptions.ts` imports NOTHING.
// It is a frozen `Record<string, string>` and a lookup, so there is no module
// here that can fail to arrive and take the interface down with it — which is
// what the `import()` seams around production, terrain and the def tables are
// defending against. Reaching it lazily would only mean the strip printed the
// short blurb for the first few frames of every match.
import { describeBuildable } from '../data/Descriptions';
import { iconForUnitKey, makeIcon, type IconName } from './icons';
import { buildHotkeyBlockedBy, type StoredBindings } from '../input/ActionCatalogue';

import './hud.css';

/* ==========================================================================
 * SECTION 0 — THE LIVE BINDING TABLE
 *
 * Read for one purpose: to find out whether a rebind has taken one of the build
 * letters. Duck-typed off `window.__vmSettings` exactly as
 * `src/input/input.system.ts` does, and for the same reason — the settings store
 * is in the lazily loaded shell chunk, and a `?shot=` boot never loads the shell
 * at all. An import would drag it in and the HUD would stop rendering the moment
 * the shell failed.
 *
 * Undefined is the correct answer when the shell is absent: no rebinds exist, so
 * every build letter is free, which is the stock scheme.
 * ========================================================================== */

interface SettingsBridge {
  get(): { controls?: { bindings?: StoredBindings } };
}

function liveBindings(): StoredBindings | undefined {
  const g = globalThis as unknown as { __vmSettings?: SettingsBridge };
  const s = g.__vmSettings;
  if (s === undefined || typeof s.get !== 'function') return undefined;
  try {
    return s.get().controls?.bindings;
  } catch {
    return undefined;
  }
}

/* ==========================================================================
 * SECTION 1 — THE FALLBACK ROSTER
 *
 * Used ONLY when no production module is registered. It exists so the build
 * grid is never an empty box waiting on another agent, and so the layout can be
 * critiqued from a screenshot before the sim is wired. The moment
 * `ProductionService` exists, every row here is ignored.
 * ========================================================================== */

interface RosterRow {
  key: string;
  name: string;
  blurb: string;
  cost: number;
  buildTime: number;
  power: number;
  tab: BuildTab;
  isBuilding: boolean;
  prereqs: readonly string[];
  faction: Faction;
}

function rb(
  key: string, name: string, blurb: string, cost: number, buildTime: number, power: number,
  tab: BuildTab, prereqs: readonly string[], faction: Faction,
): RosterRow {
  return { key, name, blurb, cost, buildTime, power, tab, isBuilding: true, prereqs, faction };
}

function ru(
  key: string, name: string, blurb: string, cost: number, buildTime: number,
  tab: BuildTab, prereqs: readonly string[], faction: Faction,
): RosterRow {
  return { key, name, blurb, cost, buildTime, power: 0, tab, isBuilding: false, prereqs, faction };
}

const FALLBACK_ROSTER: readonly RosterRow[] = [
  /* -- Allied ---------------------------------------------------------- */
  rb('conyard', 'Construction Yard', 'Unpacks from an MCV. Everything starts here.', 2500, 20, 0, BuildTab.Structures, [], Faction.Allies),
  rb('power', 'Power Plant', 'Supplies the base. Build these before you need them.', 800, 8, 100, BuildTab.Structures, ['conyard'], Faction.Allies),
  rb('refinery', 'Ore Refinery', 'Processes ore and ships with a free miner.', 2000, 18, -30, BuildTab.Structures, ['power'], Faction.Allies),
  rb('barracks', 'Barracks', 'Trains infantry.', 500, 7, -20, BuildTab.Structures, ['power'], Faction.Allies),
  rb('warfactory', 'War Factory', 'Builds vehicles.', 2000, 16, -30, BuildTab.Structures, ['refinery'], Faction.Allies),
  rb('radar', 'Radar Dome', 'Brings the tactical map online.', 1000, 10, -50, BuildTab.Structures, ['refinery'], Faction.Allies),
  rb('silo', 'Ore Silo', 'Stores 1500 credits of unprocessed ore.', 150, 4, -10, BuildTab.Structures, ['refinery'], Faction.Allies),
  rb('lab', 'Battle Lab', 'Unlocks the top of the tech tree.', 2000, 20, -100, BuildTab.Structures, ['radar'], Faction.Allies),
  rb('wall', 'Fortress Wall', 'Cheap. Blocks vehicles, not shells.', 100, 2, 0, BuildTab.Defense, ['conyard'], Faction.Allies),
  rb('pillbox', 'Pillbox', 'Anti-infantry emplacement.', 400, 5, -10, BuildTab.Defense, ['barracks'], Faction.Allies),
  rb('patriot', 'Patriot Missiles', 'Anti-air battery.', 1000, 9, -50, BuildTab.Defense, ['radar'], Faction.Allies),
  rb('prismtower', 'Prism Tower', 'Refracting beam tower.', 1500, 12, -75, BuildTab.Defense, ['lab'], Faction.Allies),
  ru('allied_rifle', 'Peacekeeper', 'Line infantry. Cheap, numerous, crushable.', 200, 4, BuildTab.Infantry, ['barracks'], Faction.Allies),
  ru('allied_javelin', 'Javelin', 'Shoulder launcher. Kills armour and aircraft.', 500, 7, BuildTab.Infantry, ['barracks', 'radar'], Faction.Allies),
  ru('allied_engineer', 'Engineer', 'Captures structures and mends damage.', 500, 6, BuildTab.Infantry, ['barracks'], Faction.Allies),
  ru('allied_harvester', 'Chrono Miner', 'Mines ore. The economy is this unit.', 1400, 12, BuildTab.Vehicles, ['refinery'], Faction.Allies),
  ru('allied_guardian', 'Guardian Tank', 'Main battle tank. Fast, thin armour.', 700, 8, BuildTab.Vehicles, ['warfactory'], Faction.Allies),
  ru('allied_ifv', 'Multigunner IFV', 'Weapon changes with its passenger.', 600, 7, BuildTab.Vehicles, ['warfactory'], Faction.Allies),
  ru('allied_prism', 'Prism Tank', 'Long-range beam armour. Fragile.', 1200, 13, BuildTab.Vehicles, ['lab'], Faction.Allies),

  /* -- Soviet ---------------------------------------------------------- */
  rb('conyard', 'Construction Yard', 'Unpacks from an MCV. Everything starts here.', 2500, 20, 0, BuildTab.Structures, [], Faction.Soviets),
  rb('power', 'Tesla Reactor', 'Supplies the base.', 600, 7, 150, BuildTab.Structures, ['conyard'], Faction.Soviets),
  rb('refinery', 'Ore Refinery', 'Processes ore and ships with a free collector.', 2000, 18, -30, BuildTab.Structures, ['power'], Faction.Soviets),
  rb('barracks', 'Barracks', 'Trains infantry.', 500, 7, -20, BuildTab.Structures, ['power'], Faction.Soviets),
  rb('warfactory', 'War Factory', 'Builds vehicles.', 2000, 16, -30, BuildTab.Structures, ['refinery'], Faction.Soviets),
  rb('radar', 'Radar Dome', 'Brings the tactical map online.', 1000, 10, -50, BuildTab.Structures, ['refinery'], Faction.Soviets),
  rb('silo', 'Ore Silo', 'Stores 1500 credits of unprocessed ore.', 150, 4, -10, BuildTab.Structures, ['refinery'], Faction.Soviets),
  rb('lab', 'Battle Lab', 'Unlocks the top of the tech tree.', 2000, 20, -100, BuildTab.Structures, ['radar'], Faction.Soviets),
  rb('wall', 'Concrete Wall', 'Cheap. Blocks vehicles.', 100, 2, 0, BuildTab.Defense, ['conyard'], Faction.Soviets),
  rb('sentry', 'Sentry Gun', 'Anti-infantry emplacement.', 500, 5, -20, BuildTab.Defense, ['barracks'], Faction.Soviets),
  rb('flak', 'Flak Cannon', 'Anti-air battery.', 1000, 9, -50, BuildTab.Defense, ['radar'], Faction.Soviets),
  rb('tesla', 'Tesla Coil', 'Needs power. Deletes infantry.', 1500, 12, -100, BuildTab.Defense, ['lab'], Faction.Soviets),
  ru('soviet_conscript', 'Conscript', 'Line infantry. Very cheap.', 100, 3, BuildTab.Infantry, ['barracks'], Faction.Soviets),
  // Cost, gate and blurb transcribed from `flakTrooper` in `src/data/Defs.ts`.
  // This row promised a Flak Trooper for as long as the roster has existed,
  // while no def, no fallback and no content->model binding could produce one.
  ru('soviet_flak', 'Flak Trooper', 'Drum-fed autocannon. Hates anything light.', 300, 6, BuildTab.Infantry, ['barracks', 'radar'], Faction.Soviets),
  ru('soviet_harvester', 'Ore Collector', 'Mines ore. The economy is this unit.', 1400, 12, BuildTab.Vehicles, ['refinery'], Faction.Soviets),
  ru('soviet_rhino', 'Rhino Heavy Tank', 'Slow, heavy, and it wins the trade.', 900, 10, BuildTab.Vehicles, ['warfactory'], Faction.Soviets),
  ru('soviet_sickle', 'Sickle', 'Legged scout. Hops over obstacles.', 700, 8, BuildTab.Vehicles, ['warfactory'], Faction.Soviets),
  ru('soviet_v4', 'V4 Rocket Launcher', 'Siege artillery. Cannot defend itself.', 1400, 14, BuildTab.Vehicles, ['radar'], Faction.Soviets),
];

/** Armour class -> the word the stat row shows. */
const ARMOUR_NAMES: readonly string[] = [
  'Infantry', 'Light', 'Medium', 'Heavy', 'Concrete', 'Wood',
];

/** What counts toward the ARMY telltale. `EntityKind` has no air or naval row. */
const MOBILE_KINDS: readonly EntityKind[] = [EntityKind.Infantry, EntityKind.Vehicle];

/** Weight of a fresh one-second income sample against the running average. */
const INCOME_SMOOTHING = 0.35;
/** Seconds the "under attack" advice stays up after the last hit. */
const ATTACK_ADVICE_SECONDS = 10;

/**
 * EVA line -> a toast. Anything not listed here stays audio-only.
 *
 * `ConstructionComplete` is deliberately ABSENT. It is the one line that has a
 * specific, actionable chip of its own — see the `production:ready` handler,
 * which names the structure and says what to do with it. Keeping the generic
 * row as well would post two chips for one event, and the vaguer one first.
 */
const EVA_TOASTS: Readonly<Record<number, readonly [ToastKind, string]>> = {
  [EvaLine.UnitReady]: ['info', 'Unit ready'],
  [EvaLine.NewConstructionOptions]: ['info', 'New construction options'],
  [EvaLine.InsufficientFunds]: ['warn', 'Insufficient funds'],
  [EvaLine.LowPower]: ['warn', 'Low power'],
  [EvaLine.BaseUnderAttack]: ['alert', 'Base under attack'],
  [EvaLine.UnitLost]: ['warn', 'Unit lost'],
  [EvaLine.BuildingLost]: ['alert', 'Structure lost'],
  [EvaLine.SiloNeeded]: ['warn', 'Silos needed'],
  [EvaLine.RadarOnline]: ['good', 'Radar online'],
  [EvaLine.RadarOffline]: ['warn', 'Radar offline'],
  [EvaLine.CannotDeployHere]: ['warn', 'Cannot deploy here'],
  [EvaLine.MissionAccomplished]: ['good', 'Mission accomplished'],
  [EvaLine.MissionFailed]: ['alert', 'Mission failed'],
  [EvaLine.BuildingCaptured]: ['info', 'Structure captured'],
  [EvaLine.OreMinerUnderAttack]: ['warn', 'Miner under attack'],
  // A harvester whose patch is exhausted, waiting for orders. It IS a toast and
  // not audio-only, because the whole point of the alert is that the player has
  // to do something about it — see §ANCHOR in `sim/Harvesting.ts`, where a human
  // player's harvester deliberately does not re-anchor itself.
  [EvaLine.HarvesterIdle]: ['warn', 'Harvester idle — no ore in range'],
};

/*
 * `EvaLine.NoOreMiner` and `EvaLine.Reinforcements` are deliberately ABSENT
 * above, for the same reason `ConstructionComplete` is: `orecrisis.system.ts`
 * posts its own chip for both, and that chip names the shortfall in credits
 * and the tool to press. The generic row would post a second, vaguer chip for
 * the same event — and, because `eva:line` is handled before the system's own
 * toast lands, it would post it FIRST.
 */

/** Toast severity -> its leading icon. */
const TOAST_ICONS: Readonly<Record<ToastKind, IconName>> = {
  info: 'info',
  good: 'ready',
  warn: 'warning',
  alert: 'alert',
};

/* ==========================================================================
 * SECTION 2 — THE PRODUCTION SEAM
 *
 * Structural, not nominal: the HUD needs exactly these members off
 * `ProductionService`, and describing them here rather than importing the class
 * keeps `src/ui` compilable with the sim module absent.
 * ========================================================================== */

interface CatalogEntrySeam {
  readonly publicId: number;
  readonly key: string;
  readonly name: string;
  readonly cost: number;
  /** `BuildKind`: 0 building, 1 unit. Compared numerically to avoid the import. */
  readonly kind: number;
  readonly prereqs: readonly string[];
}

interface CatalogSeam {
  byKey(key: string): {
    buildTime: number;
    power: number;
    blurb: string;
    prereqs?: readonly string[];
  } | null;
  /**
   * Optional because it is only needed for the cold-start path below. When it
   * is present the HUD can build a CORRECT grid — real names, real costs, real
   * `publicId`s — before production has ticked even once.
   */
  roster?(faction: Faction, tab: BuildTab): readonly CatalogEntrySeam[];
}

interface ProductionSeam {
  readonly snapshot: HudSnapshot;
  setActiveTab(tab: BuildTab): void;
  clearTabAlert(tab: BuildTab): void;
  entryOf(id: EntityId): {
    key: string; name: string; blurb: string; buildTime: number; power: number;
    /**
     * Local-space door and local (UNFACED) depth, metres and cells, +Z forward.
     * The overlay anchors the rally tether off these; anchored at the footprint
     * centre it is painted straight across the structure's own body.
     */
    exitX: number; exitZ: number; footprintH: number;
  } | null;
  catalog: CatalogSeam;
}

/** One cell of the locally-built grid. Sourced from the catalog when it can be. */
interface GridRow {
  defId: number;
  key: string;
  name: string;
  cost: number;
  isBuilding: boolean;
  prereqs: readonly string[];
}

/**
 * The placement controller, reached the same way `src/input` reaches it.
 *
 * `beginRelocate` is the whole of the relocation gesture as far as this file is
 * concerned: hand it a live structure and the ordinary placement ghost picks it
 * up. Everything after that — the hologram, the green/red carpet, the commit
 * click, Escape to cancel — is `src/sim/Placement.ts` doing what it already did
 * for a freshly built structure. `relocating` is the id it is currently
 * carrying, or 0 (`NONE`), which is what lights the button up.
 */
interface PlacementSeam {
  readonly active: boolean;
  readonly relocating: number;
  /* Read-only, and every one OPTIONAL: they are what the overlay needs to
     caption the rotate keys under the ghost, and a controller that predates
     them must still light the relocate button. `report.w`/`h` are the
     WORLD-SPACE footprint, already swapped for the facing, so the caption sits
     under a turned 3x2 as correctly as under a square one. */
  readonly cx?: number;
  readonly cz?: number;
  readonly facing?: number;
  readonly report?: { readonly w: number; readonly h: number; readonly ok: boolean };
  begin(defId: number): boolean;
  beginRelocate(building: number): boolean;
}

/**
 * The relocation service, duck-typed off `globalThis.__vmRelocate`.
 *
 * Duck-typed rather than imported for the reason at the top of this file: the
 * HUD must not hold a hard dependency on a sim module. With `sim.relocate`
 * absent the button is simply never offered and every other row still renders.
 *
 * `inspect` returns a POOLED report — read it in the same statement, never keep
 * it. That is the sim's contract, not a convention this file invented.
 */
interface RelocateSeamRead {
  inspect(player: PlayerId, building: EntityId): {
    readonly ok: boolean;
    readonly reason: string;
    readonly cost: number;
  };
}

function placementSeam(): PlacementSeam | null {
  const g = globalThis as unknown as { __vmPlacement?: PlacementSeam };
  const p = g.__vmPlacement;
  return p !== undefined && typeof p.beginRelocate === 'function' ? p : null;
}

function relocateSeam(): RelocateSeamRead | null {
  const g = globalThis as unknown as { __vmRelocate?: RelocateSeamRead };
  const r = g.__vmRelocate;
  return r !== undefined && typeof r.inspect === 'function' ? r : null;
}

/**
 * The commander-ability service, duck-typed off `globalThis.__vmAbilities`.
 *
 * Duck-typed rather than imported for the reason at the top of this file: the
 * HUD must not hold a hard dependency on a sim module. With `sim.abilities`
 * absent the row is simply never offered — which is also exactly what happens
 * on a boot with no content module, where there are no commanders anyway.
 *
 * `abilityOf` returns an `AbilityId`; 0 is `None`. The numeric spelling is
 * deliberate — importing the enum would reintroduce the dependency the seam
 * exists to avoid, and the only thing this file does with the value is index
 * `ABILITY_LABELS`.
 */
interface AbilitySeamRead {
  abilityOf(id: EntityId): number;
  cooldownSecondsOf(id: EntityId): number;
  isReady(id: EntityId): boolean;
}

function abilitySeam(): AbilitySeamRead | null {
  const g = globalThis as unknown as { __vmAbilities?: AbilitySeamRead };
  const a = g.__vmAbilities;
  return a !== undefined && typeof a.abilityOf === 'function' ? a : null;
}

/**
 * The transport service, duck-typed off `globalThis.__vmFeatures.transport`.
 *
 * Same bargain as the two seams above: no hard import of a sim module, and the
 * row is simply never offered when `sim.features` is absent. It hangs off
 * `__vmFeatures` rather than a handle of its own because that is where
 * `sim/features.system.ts` already publishes its five siblings.
 *
 * Occupancy is a QUERY, not a subscription. `capacity` is O(1) off the def and
 * `passengerCount` walks the infantry list, which is why every caller here asks
 * the cheap one first and the expensive one only for a hull that has seats —
 * see `computeCargoAction`.
 */
export interface TransportSeamRead {
  capacity(hull: EntityId): number;
  passengerCount(hull: EntityId): number;
  /**
   * SLOTS CONSUMED, which is not a head count and is what the readout needs.
   * Infantry cost one slot and a vehicle costs two, so an eight-slot hull
   * holding four tanks is completely full while `passengerCount` says 4 — the
   * row would have read "4 / 8" on a hull that can take nothing more.
   */
  usedSlots(hull: EntityId): number;
}

function transportSeam(): TransportSeamRead | null {
  const g = globalThis as unknown as { __vmFeatures?: { transport?: TransportSeamRead } };
  const t = g.__vmFeatures?.transport;
  return t !== undefined && typeof t.capacity === 'function' ? t : null;
}

/**
 * The superweapon service, duck-typed off `globalThis.__vmSuperweapons`.
 *
 * Same rule as the two seams above, and here it matters more than anywhere
 * else: `src/sim/Superweapons.ts` pulls in the production catalog, the spatial
 * index and the damage channel, and a `?shot=` boot that never registers the
 * sim would take the whole HUD down with a hard import.
 *
 * THE TRAFFIC RUNS BOTH WAYS AND ONLY ONE OF THEM IS THIS SEAM. The COUNTDOWN
 * is pushed AT us — the service calls `setSuperweapon` / `clearSuperweapon` on
 * `globalThis.__vmHud`, so the HUD needs no polling and no reference at all to
 * read a timer. This seam is only the click: `arm` puts the targeting cursor
 * up, and the shot itself then goes through `channels.commands` from inside the
 * service. The HUD never fires anything.
 */
interface SuperweaponSeamRead {
  arm(key: string): boolean;
  cancelArm(): void;
  readonly armedKey: string | null;
}

function superweaponSeam(): SuperweaponSeamRead | null {
  const g = globalThis as unknown as { __vmSuperweapons?: SuperweaponSeamRead };
  const s = g.__vmSuperweapons;
  return s !== undefined && typeof s.arm === 'function' ? s : null;
}

/**
 * The garrison service, duck-typed off `globalThis.__vmFeatures.garrison`.
 *
 * Exactly the transport seam's bargain, one entity kind over, and published on
 * the same handle by the same module (`sim/features.system.ts`). Occupancy is a
 * QUERY here too — `occupantCount` walks the infantry list — and it is asked
 * only of a selected BUILDING, which is the cheap gate this row has instead of
 * the transport row's `capacity`. See `computeGarrisonAction`.
 *
 * The seam is READ-ONLY, and that is deliberate rather than incidental:
 * `GarrisonService.evacuate` is right there on the same object and calling it
 * from a DOM handler would put the men on the ground on THIS machine and on no
 * other. The verb goes out as `OrderKind.Unload` through `channels.commands`
 * like every other order; the seam only answers "is anybody in there".
 */
export interface GarrisonSeamRead {
  occupantCount(building: EntityId): number;
}

function garrisonSeam(): GarrisonSeamRead | null {
  const g = globalThis as unknown as { __vmFeatures?: { garrison?: GarrisonSeamRead } };
  const s = g.__vmFeatures?.garrison;
  return s !== undefined && typeof s.occupantCount === 'function' ? s : null;
}

/* ==========================================================================
 * THE TWO OCCUPANCY ROWS, DERIVED FROM THE WHOLE SELECTION
 *
 * Pure over `(action, world, seam)` and exported so `tests/hud.spec.ts` can ask
 * them things: the rest of this file needs a `document` to exist and these two
 * do not, and before they were lifted out there was no coverage of the cargo
 * row at all.
 *
 * They are written as a pair and should be read as one, because the defect was
 * in both. Each hard-gated on `selection.count !== 1` while the ORDER layer
 * behind it had walked the whole selection since the day it shipped —
 * `gatherLoadedTransports` and `gatherOccupiedGarrisons` in
 * `src/input/Commands.ts`, feeding `issueUnload` / `issueEvacuate`, one order
 * per hull at that hull's own position. So the D key emptied N transports and
 * the button emptied one, which is what the player hit:
 *
 *   "when selecting multiple vehicles that can load and unload troops, add the
 *    unload button in the bottom mid HUD as well"
 *
 * THE ONE DIFFERENCE BETWEEN THEM IS DELIBERATE and is argued at `CargoAction`
 * in `src/ui/Sidebar.ts`: an empty transport keeps its row and reads "0 / 5",
 * because seats are a fixed property of a hull and this is the only place in
 * the product that says whether anybody is aboard; an empty building shows
 * nothing, because almost every building in the game can never be garrisoned
 * and a permanent "0 inside" on a Power Plant is noise on every structure the
 * player ever clicks.
 * ========================================================================== */

/**
 * Fill the cargo row from every selected hull of yours that has seats.
 *
 * THE NUMBER IS A SUM AND IT IS A SUM OVER EXACTLY WHAT THE BUTTON EMPTIES.
 * This is where the note saying otherwise used to be: one hull only, because
 * "4 / 5" across three transports "would be a number about nothing". That was
 * a true statement about a button that unloaded `sel.ids[0]` and nothing else.
 * It stops being true the moment the button issues one `OrderKind.Unload` per
 * loaded hull — "9 / 15" then names precisely the men who walk out and the
 * seats they walk out of, which is the number the player is deciding on.
 *
 * `enabled` is "somebody is aboard SOMETHING", not "aboard everything": a
 * loaded Hover Transport picked up alongside an empty one still unloads, and
 * the empty one is simply skipped. The row stays visible either way — see the
 * block above.
 *
 * Re-asked every frame, because men board and leave under a stationary
 * selection. `capacity` gates the expensive question, so the cost is one walk
 * of the infantry list per selected hull WITH SEATS per frame — not per
 * selected entity, and nothing at all for a selection of tanks. The panel's
 * signature gate then writes DOM only when an integer or the hint changes.
 */
export function computeCargoAction(
  action: CargoAction,
  world: World,
  seam: TransportSeamRead | null,
): void {
  if (seam === null) { action.visible = false; return; }

  const sel = world.selection;
  const store = world.store;
  const local = world.localPlayer as number;

  let hulls = 0;
  let loaded = 0;
  let slots = 0;
  let used = 0;
  let aboard = 0;

  for (let k = 0; k < sel.count; k++) {
    const id = sel.ids[k] as EntityId;
    const i = store.index(id);
    if (i < 0 || store.owner[i] !== local) continue;
    // Skipped for the reason `gatherLoadedTransports` skips it: a hull dying
    // this tick is one the button will not address, and a row that counts men
    // the button cannot put down is the exact disagreement between key and
    // button that this change exists to remove.
    if ((store.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
    const slotsHere = seam.capacity(id);
    if (slotsHere <= 0) continue;
    const menHere = seam.passengerCount(id);
    hulls++;
    slots += slotsHere;
    used += seam.usedSlots(id);
    aboard += menHere;
    if (menHere > 0) loaded++;
  }

  if (hulls === 0) { action.visible = false; return; }

  action.visible = true;
  // SLOTS on both sides of the slash. `aboard` is still the number the hint
  // talks about, because "put all 4 passengers down" is what a player is about
  // to do; "6 / 8" is what the hold actually looks like.
  action.capacity = slots;
  action.count = used;
  action.enabled = aboard > 0;
  if (aboard > 0) {
    const who = aboard === 1 ? 'the passenger' : `all ${aboard} passengers`;
    const where = loaded === 1 ? 'the hull' : `all ${loaded} hulls`;
    action.hint = `Put ${who} down around ${where}`;
  } else {
    action.hint = hulls === 1
      ? 'Empty. Right-click this hull with troops or vehicles selected to load it.'
      : 'Empty. Right-click a hull with troops or vehicles selected to load it.';
  }
}

/**
 * Fill the Evacuate row from every selected structure of yours with men in it.
 *
 * `computeCargoAction`'s twin, one entity kind over, and the same correction:
 * the note here also claimed the count was a property of one building and that
 * "3 inside" over four strongpoints "would be a number about nothing". It is a
 * number about the four squads the button is about to turn out.
 *
 * `hosts` is counted rather than taken from `sel.count` because the hint names
 * it and only OCCUPIED buildings are in it — so one strongpoint marquee'd up
 * with three empty barracks says "the building", not "their 4 buildings",
 * which is also exactly how many orders the click issues.
 */
export function computeGarrisonAction(
  action: GarrisonAction,
  world: World,
  seam: GarrisonSeamRead | null,
): void {
  if (seam === null) { action.visible = false; return; }

  const sel = world.selection;
  const store = world.store;
  const local = world.localPlayer as number;

  let hosts = 0;
  let inside = 0;

  for (let k = 0; k < sel.count; k++) {
    const id = sel.ids[k] as EntityId;
    const i = store.index(id);
    if (i < 0 || store.owner[i] !== local) continue;
    if (store.kind[i] !== EntityKind.Building) continue;
    if ((store.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
    const men = seam.occupantCount(id);
    if (men <= 0) continue;
    hosts++;
    inside += men;
  }

  // Hidden rather than greyed at zero, unlike the cargo row. See the block above.
  if (hosts === 0) { action.visible = false; return; }

  action.visible = true;
  action.count = inside;
  action.enabled = true;
  if (hosts === 1) {
    action.hint = inside === 1
      ? 'Turn the occupant out onto the ground around the building'
      : `Turn all ${inside} occupants out onto the ground around the building`;
  } else {
    // `hosts > 1` implies `inside >= 2`: an unoccupied building never gets
    // counted, so there is no singular case to spell out here.
    action.hint = `Turn all ${inside} occupants out onto the ground around their ${hosts} buildings`;
  }
}

/**
 * The commander-power service, duck-typed off `globalThis.__vmPowers.service`.
 *
 * Same rule as every seam above: `src/sim/CommanderPowers.ts` pulls in the
 * damage channel, the spatial index and the vision port, and a `?shot=` boot
 * that never registers the sim would take the whole HUD down with a hard
 * import. With the service absent the bar is simply never shown.
 *
 * TWO MEMBERS, AND NEITHER OF THEM FIRES. `chargeSecondsOf` and `isReady` are
 * reads; the call itself is `channels.commands.issueUsePower`, drained by the
 * ONE Phase.Command drain in `src/input/Commands.ts`. That is the same
 * discipline `armSuperweapon` follows and for the same reason — a HUD that
 * called `service.use()` from a click handler would be invisible to the replay
 * recorder and to the multiplayer link, and would ALSO race the tick, which is
 * the bug that discipline exists to prevent.
 *
 * `__vmPowers.charges()` is deliberately NOT used even though it exists: it
 * builds a fresh `Record` per call, and this is asked once per power per frame.
 */
interface CommanderPowerSeamRead {
  chargeSecondsOf(player: PlayerId, power: number): number;
  isReady(player: PlayerId, power: number): boolean;
}

function commanderPowerSeam(): CommanderPowerSeamRead | null {
  const g = globalThis as unknown as {
    __vmPowers?: { service?: CommanderPowerSeamRead };
  };
  const s = g.__vmPowers?.service;
  return s !== undefined && typeof s.chargeSecondsOf === 'function' ? s : null;
}

/* `POWER_ICONS` lives in `./Sidebar` beside the bar that draws it. */

/* ==========================================================================
 * SECTION 2B — THE TOP ROW'S FIT
 *
 * Reported as "The top middle main hud, its getting huge and sometimes almost
 * overlaaping with objectives".
 *
 * IT WAS NOT SOMETIMES. Measured in the real game at 1920x1080, on an empty
 * match with nothing but the starting bank on screen: `--vm-u` = 1.5px, the
 * resource strip runs x 369.75..1550.25, and the objective panel's left edge
 * sits at 1518. A 32.25 px overlap, and the objectives are `z-index: 5`, so
 * they paint over the INCOME readout. The strip is CENTRED, which makes the
 * overlap symmetric — the same panel moved to the left edge collides by the
 * same 32.25 px — so moving it is not a fix and this is where the fix belongs.
 *
 * WHY IT LOOKED INTERMITTENT, AND THE ONE REAL BUG UNDER IT
 * --------------------------------------------------------
 * `--vm-u` is `computeUiScale(viewportHeight)`. So EVERY width in the HUD is
 * proportional to the viewport's HEIGHT, while the two responsive rules that
 * were supposed to keep the top row from over-subscribing were written as
 * `@media (max-width: 1180px)` and `@media (max-width: 1000px)` — viewport
 * WIDTH, in CSS pixels. The two quantities are only equal at 720p. Measured
 * consequences, with the objective panel present:
 *
 *   2560x1440  u=2     strip 1597 px  overlap  55 px   query cannot fire
 *   1920x1080  u=1.5   strip 1199 px  overlap  42 px   query cannot fire
 *   1600x900   u=1.25  strip 1000 px  overlap  35 px   query cannot fire
 *   1280x720   u=1     strip  802 px  overlap  29 px   query cannot fire
 *   1152x864   u=1     strip  582 px  clear  +17 px    query fired anyway
 *
 * So the question has to be asked in DESIGN UNITS — `viewportWidth / uiScale`,
 * which is the same unit every dimension in `hud.css` is written in — and only
 * JS knows `uiScale`. `Hud.resize()` publishes the answer as `data-top-fit` on
 * the HUD root; `src/ui/hud.css` §5 carries the rules.
 *
 * THE THRESHOLDS ARE DERIVED, NOT CHOSEN
 * --------------------------------------
 * The strip is centred, so it may occupy the frame minus TWICE whatever the
 * widest corner panel claims. That is the objective panel: `right: 10u` plus
 * `--vm-rail-w` 240u, border-box, = 250u. Plus one house gutter (10u, the
 * `--vm-gap` the rest of the HUD is spaced by) so the two do not merely touch.
 *
 *     threshold(tier) = stripWidth(tier) + 2 * (OBJECTIVE_COLUMN + GUTTER)
 *
 * `tests/hud-top-row.spec.ts` re-derives OBJECTIVE_COLUMN out of `hud.css` and
 * re-runs that arithmetic against a viewport sweep, so a change to
 * `--vm-rail-w` or to the panel's offset fails there rather than in a match.
 * ========================================================================== */

/**
 * What the top row can hold at this width. Ordered widest-first; each tier is
 * the one before it minus the least valuable thing left in the strip.
 *
 *  - `wide`  all six cells
 *  - `tight` the three telltales (ARMY / BASE / INCOME) dropped — which is the
 *            content decision the old 1180 px query already made, kept verbatim
 *  - `bare`  also without the power STATE WORD; the meter beside it and the
 *            `is-tight` / `is-down` recolour already carry that state
 *  - `solo`  the row cannot hold both, so the objective panel goes — the rule
 *            the old 1000 px query expressed, at a threshold that is derived
 */
export type TopRowFit = 'wide' | 'tight' | 'bare' | 'solo';

/**
 * MEASURED, not modelled. Chromium 1280x720, `--vm-u` = 1px, Rajdhani loaded,
 * worst realistic content (bank at a seven-figure ceiling, four-figure power on
 * both sides of the slash, an hours-long clock, three-digit telltales).
 *
 * TO RE-MEASURE: mount `ResourceStrip` under a `.vm-hud` with `--vm-u: 1px`,
 * set `data-top-fit`, and read `.vm-resources`'s `getBoundingClientRect().width`.
 * These are ceilings — a tier that measures WIDER than its entry here silently
 * re-opens the overlap, so round up rather than down when you refresh them.
 */
export const TOP_STRIP_UNITS: Readonly<Record<Exclude<TopRowFit, 'solo'>, number>> = {
  wide: 819,
  tight: 599,
  bare: 531,
};

/**
 * The right-hand column the objective panel claims, in design units:
 * `right: 10u` + `--vm-rail-w: 240u`, border-box. Restated here because the
 * fit test needs it in TypeScript; the spec reads both numbers back out of
 * `hud.css` and fails if they drift apart.
 */
export const TOP_OBJECTIVE_COLUMN = 250;

/** One `--vm-gap`, so a fitting row has clearance rather than a shared edge. */
export const TOP_ROW_GUTTER = 10;

/** Design-unit width a tier needs, counting BOTH sides — the strip is centred. */
export function topRowNeeds(stripUnits: number): number {
  return stripUnits + 2 * (TOP_OBJECTIVE_COLUMN + TOP_ROW_GUTTER);
}

/**
 * The widest tier that fits `designWidth` = viewport width / `uiScale`.
 *
 * Note what is NOT here: viewport height, aspect ratio and CSS pixels. The
 * strip and the panel are both multiples of `--vm-u`, so once the width is
 * expressed in the same unit the answer is one comparison per tier.
 */
export function topRowFit(designWidth: number): TopRowFit {
  if (designWidth >= topRowNeeds(TOP_STRIP_UNITS.wide)) return 'wide';
  if (designWidth >= topRowNeeds(TOP_STRIP_UNITS.tight)) return 'tight';
  if (designWidth >= topRowNeeds(TOP_STRIP_UNITS.bare)) return 'bare';
  return 'solo';
}

/* ==========================================================================
 * SECTION 3 — THE HUD
 * ========================================================================== */

export interface HudOptions {
  mount: HTMLElement;
  world: World;
  channels: Channels;
  cameraRig: CameraRig;
  handle: RendererHandle;
  /** Ids of every registered sim system. Used to detect sibling modules. */
  simSystemIds: readonly string[];
}

export class Hud {
  readonly root: HTMLElement;
  readonly sidebar: Sidebar;
  readonly minimap: Minimap;
  readonly overlay: Overlay;
  readonly toasts: ToastStack;

  /** Input reads these; the HUD owns the toggle, never the gesture. */
  get armedMode(): ArmedMode { return this.sidebar.armedMode; }
  waypointMode = false;
  formationMove = false;

  /**
   * True when the HUD owns the order-confirmation ring.
   *
   * `src/input/input.system.ts` draws its own world-space rings on every order.
   * When it is registered we stay out of the way, because two rings for one
   * click reads as a bug. With input absent the HUD draws them itself, so the
   * affordance never simply disappears.
   */
  readonly orderMarkers: boolean;

  /** Fired when a completed structure is ready to be placed on the map. */
  onPlaceRequest: ((defId: number, key: string) => void) | null = null;

  private readonly world: World;
  private readonly channels: Channels;
  private readonly cameraRig: CameraRig;
  private readonly handle: RendererHandle;

  /** Live production, when the sim module registered one. */
  private production: ProductionSeam | null = null;
  /** The imported module, kept so `tryBindProduction` can re-ask each frame. */
  private productionMod: { production(): unknown } | null = null;
  /** Real def tables, when a data module published any. */
  private tables: DefTables | null = null;

  /**
   * Pooled local snapshot. Used while `production` is null, AND while a bound
   * production service has not yet published a grid — see `snapshot()`.
   */
  private readonly localSnapshot: HudSnapshot;
  private readonly localPool: HudCameo[][] = [[], [], [], [], []];
  private localTab: BuildTab = BuildTab.Structures;

  /** The grid the local snapshot renders: catalog rows when reachable. */
  private readonly gridRows: GridRow[][] = [[], [], [], [], []];
  private gridFaction = -1;
  private gridFromCatalog = false;
  /** content key -> display name, for the "Requires X" sentence. */
  private readonly keyNames = new Map<string, string>();

  /** Pooled telemetry. Rebuilt in place; never handed out. */
  private readonly telemetry: HudTelemetry = {
    army: 0, structures: 0, incomePerMin: 0, storageMax: 0,
    advice: 'All systems nominal', adviceKind: 'info',
  };
  /** Credits banked since the last income flush, and the smoothed rate. */
  private incomeBucket = 0;
  private incomeWindow = 0;
  private incomePerSec = 0;
  /** Sim time of the last `combat:underAttack` on something we own. */
  private lastAttackTime = -1e9;

  /** Pooled selection view. Never reallocated. */
  private readonly view: SelectionView;
  /**
   * Pooled superweapon countdowns, in the order the service pushed them.
   *
   * `rows` is allocated once at `HUD_SUPERWEAPON.maxRows` and never grows;
   * `superCount` is how many of them are live. `setSuperweapon` finds a row by
   * key or claims the next free one, so the list is stable frame to frame and
   * a countdown never jumps to a different position as its neighbour arrives.
   */
  private readonly supers: SuperweaponView;
  /**
   * Pooled commander-power rows, in `COMMANDER_POWERS` table order.
   *
   * Rebuilt in place every frame from `powersOwnedBy` — which takes a
   * caller-supplied array for exactly this reason — so the bar costs no
   * allocation whatever the player has bought.
   */
  private readonly powers: CommanderPowerView;
  /** Scratch for `powersOwnedBy`. Never handed out, never reallocated. */
  private readonly ownedPowers: CommanderPowerDef[] = [];
  /**
   * The `CommanderPowerId` currently on the cursor, or 0 for none.
   *
   * READ BY `src/input/input.system.ts` off `__vmHud`, exactly as `armedMode`
   * is: a power's target is a point on the ground, the ground click is a
   * GESTURE, and gestures belong to input. Nothing in this file consumes it.
   */
  private armedPowerId = 0;
  /** Sim seconds at which an armed self-destruct disarms itself. */
  private destructArmedUntil = -1e9;
  /** The entity the armed self-destruct was armed FOR. 0 when disarmed. */
  private destructArmedFor = 0;
  /** Scratch for the self-destruct sweep. Never handed out. */
  private readonly destructIds = new Int32Array(MAX_SELECTION);
  /**
   * Scratch for the Unload and Evacuate sweeps, and the one-entity buffer the
   * orders ride out on. Never handed out, never reallocated.
   *
   * Two buffers because the order is issued PER HULL: `issueUnload` in
   * `src/input/input.system.ts` does the same, and it has to — an unload has no
   * shared destination, the men come out around the vehicle they were riding
   * in, so each command carries that hull's own position. The sweep also fills
   * `unloadIds` BEFORE the issuing loop for the reason `selfDestructSelection`
   * spells out: reading the live selection while issuing commands against it is
   * the shape of the superweapon race, and one `Int32Array` copy forecloses it.
   *
   * The two handlers can never overlap — a click is one handler — so one buffer
   * serves both.
   */
  private readonly unloadIds = new Int32Array(MAX_SELECTION);
  private readonly oneId = new Int32Array(1);
  /** Scratch for grouping the selection into cards. */
  private readonly groupKeys: number[] = [];
  private readonly groupFirst: number[] = [];
  private readonly groupCount: number[] = [];
  private readonly groupHp: number[] = [];

  private faction: Faction = Faction.Allies;
  private uiScale = 1;
  private dpr = 1;
  private lastW = 0;
  private lastH = 0;
  /** Client-px top edge of the bottom docks. The world view ends here. */
  private dockTop = 0;

  private soundHook: ((cue: HudSoundCue) => void) | null = null;
  private readonly unsubs: Array<() => void> = [];
  private disposed = false;
  private time = 0;
  /** `world.players.length` the map key was last built for. -1 = never. */
  private armyRosterSize = -1;
  /** Sim seconds of the last brownout toast, so it cannot spam. */
  private lastBrownoutToast = -1e9;
  private brownout = false;

  constructor(opts: HudOptions) {
    this.world = opts.world;
    this.channels = opts.channels;
    this.cameraRig = opts.cameraRig;
    this.handle = opts.handle;

    const local = this.world.players[this.world.localPlayer as number];
    this.faction = local !== undefined ? local.faction : Faction.Allies;
    this.orderMarkers = !opts.simSystemIds.includes('input');

    /* -- shell ---------------------------------------------------------- */
    this.root = el('div', 'vm-hud', opts.mount);
    applyTheme(this.root, this.faction);

    const overlayCanvas = el('canvas', 'vm-world', this.root);

    this.overlay = new Overlay(overlayCanvas, {
      world: this.world,
      cameraRig: this.cameraRig,
      faction: this.faction,
      playfield: () => this.playfield(),
    });

    this.sidebar = new Sidebar({
      parent: this.root,
      faction: this.faction,
      /*
       * Lends the main renderer — EITHER backend — so build slots can show the
       * real model. The sidebar falls back to flat glyphs if this is absent or
       * unusable, which is what a headless build gets.
       *
       * THIS READ `this.handle.webgl` AND THAT WAS THE WHOLE BUG. `webgl` is
       * null under `?gpu=webgpu`, so every build slot on the node path fell
       * back to a flat glyph and a player could not tell what they were
       * building. `Cameos` renders each portrait into a render target and read
       * it back with `readRenderTargetPixels`, which is synchronous and exists
       * only on `WebGLRenderer`; the node `Renderer` has
       * `readRenderTargetPixelsAsync` and nothing synchronous.
       *
       * It has both paths now. `frame()` was already incremental, so the async
       * readback fits without changing its shape: a slot shows its glyph for a
       * frame or two and then resolves into the model. `??` and not a branch —
       * exactly one of these two is ever non-null (`RendererHandle.webgl`).
       */
      renderer: this.handle.webgl ?? this.handle.node,
      callbacks: {
        selectTab: (tab) => this.selectTab(tab),
        activate: (tab, cameo) => this.onSlotActivate(tab, cameo),
        cancel: (tab, cameo) => this.onSlotCancel(tab, cameo),
        setArmed: () => { /* the panel already applied the visual state */ },
        focusCard: (id) => this.focusEntity(id),
        setStance: (stance) => this.stanceSelection(stance),
        relocate: () => this.relocateSelection(),
        useAbility: () => this.useSelectedAbility(),
        unload: () => this.unloadSelection(),
        evacuate: () => this.evacuateSelection(),
        setPrimary: () => this.setPrimarySelection(),
        selfDestruct: () => this.selfDestructSelection(),
        fireSuperweapon: (key) => this.armSuperweapon(key),
        usePower: (key) => this.armPower(key),
        sound: (cue) => this.soundHook?.(cue),
      },
    });

    this.minimap = new Minimap(this.sidebar.minimapCanvas, {
      world: this.world,
      cameraRig: this.cameraRig,
      faction: this.faction,
      playfield: () => this.playfield(),
    });

    this.toasts = new ToastStack(this.root, (parent, kind) => {
      parent.appendChild(makeIcon(TOAST_ICONS[kind], 'vm-icon'));
    });

    /* -- pooled state ---------------------------------------------------- */
    this.localSnapshot = {
      credits: 0,
      creditsDisplay: 0,
      powerProduced: 0,
      powerConsumed: 0,
      brownout: false,
      hasRadar: false,
      activeTab: BuildTab.Structures,
      cameos: [[], [], [], [], []],
      tabAlert: [false, false, false, false, false],
      // THE FALLBACK GRID NEVER SHOWS THE POWERS TAB. It runs when no
      // production service has published a roster — a headless test, the first
      // frames of a boot, a build with `src/sim/**` stubbed — and in that state
      // there is no census, so nothing can answer whether a Command Post is
      // standing and powered. `false` is the honest answer and it is also the
      // safe one: a tab whose entries could not be bought would be a button
      // that does nothing.
      tabVisible: [true, true, true, true, false],
      selectionCount: 0,
      selectionPrimary: 0 as EntityId,
      gameTimeSec: 0,
      matchPhase: MatchPhase.Playing,
    };

    const cards: SelectionCard[] = [];
    for (let i = 0; i < MAX_SELECTION; i++) {
      cards.push({
        id: 0, icon: 'tank', cameoKey: '', isBuilding: false, name: '',
        hpFrac: 1, veterancy: 0, stack: 1, primary: false,
      });
    }
    this.view = {
      count: 0, title: '', subtitle: '', veterancy: 0,
      cards, cardCount: 0,
      hpFrac: 1, hpText: '', mending: false,
      stance: -1, stanceEnabled: false,
      relocate: { visible: false, enabled: false, cost: 0, hint: '', armed: false },
      ability: { visible: false, enabled: false, label: '', hint: '', cooldown: 0, cooldownTotal: 0 },
      cargo: { visible: false, enabled: false, count: 0, capacity: 0, hint: '' },
      garrison: { visible: false, enabled: false, count: 0, hint: '' },
      primary: { visible: false, enabled: false, isPrimary: false, hint: '' },
      selfDestruct: { visible: false, count: 0, armed: false, hint: '' },
      armour: '', damage: '', range: '', speed: '',
    };

    const superRows: SuperweaponRow[] = [];
    for (let i = 0; i < HUD_SUPERWEAPON.maxRows; i++) {
      superRows.push({ key: '', label: '', remaining: 0, total: 1, ready: false, armed: false });
    }
    this.supers = { count: 0, rows: superRows };

    const powerRows: CommanderPowerRow[] = [];
    for (let i = 0; i < COMMANDER_POWER_ROWS; i++) {
      powerRows.push({
        key: '', id: 0, label: '', hint: '', icon: 'superweapon',
        remaining: 0, total: 1, ready: false, armed: false,
      });
    }
    this.powers = { count: 0, rows: powerRows };

    this.sidebar.setExtrasProvider((key) => this.extrasFor(key));
    this.minimap.onJumpRequest((x, z) => this.cameraRig.setFocus(x, z, false));

    this.subscribe();
    window.addEventListener('keydown', this.onKeyDown);
    this.resize(true);
    this.sidebar.resetCredits(local !== undefined ? local.credits : 0);
  }

  /* ------------------------------------------------------------------ */
  /* build hotkeys                                                       */
  /*                                                                     */
  /* The HUD dispatches these because nothing else does: `src/input` binds */
  /* only order and camera keys. The LETTERS are not ours — they come from */
  /* `src/input/ActionCatalogue.ts`, which is also what the help screen    */
  /* renders, so the badge on a cameo and the row in Help are one array.   */
  /*                                                                      */
  /* The catalogue's letters dodge every stock binding, but a player may   */
  /* rebind an order onto one of them, and then two things want the same   */
  /* key. The rebind wins: it is the choice the player actually made, and  */
  /* Help prints the letter struck through with the order that took it.    */
  /* ------------------------------------------------------------------ */

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (this.disposed || ev.defaultPrevented || ev.repeat) return;
    // Every binding here is a BARE key. A chord belongs to someone else —
    // Ctrl+A is select-all-army — and swallowing one would be a real bug.
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;

    const tab = TAB_HOTKEY_CODES.indexOf(ev.code);
    const slot = tab >= 0 ? -1 : SLOT_HOTKEY_CODES.indexOf(ev.code);
    // Two array scans of fourteen strings, and out. Everything below this line
    // costs more, and the overwhelming majority of keystrokes are somebody
    // else's — the order keys, the camera keys, the control-group digits.
    if (tab < 0 && slot < 0) return;

    if (!this.keyboardOwned()) return;
    // A rebound order owns this letter now. Stand down here, before acting AND
    // before `preventDefault`, so the key is left intact for the input system.
    if (buildHotkeyBlockedBy(ev.code, liveBindings()) !== undefined) return;

    if (tab >= 0) {
      ev.preventDefault();
      this.soundHook?.('tab');
      this.selectTab(tab as BuildTab);
      return;
    }

    // An empty cell leaves the keystroke alone rather than eating it, so a key
    // that is unbound today stays available to whoever binds it tomorrow.
    if (this.sidebar.activateSlotByIndex(slot)) ev.preventDefault();
  };

  /** True when the build grid, and not a text field or a shell screen, has the keyboard. */
  private keyboardOwned(): boolean {
    if (!this.root.isConnected) return false;

    const active = document.activeElement as HTMLElement | null;
    if (active !== null) {
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
      if (active.isContentEditable) return false;
    }

    // `Shell` parks its root at `pointer-events: none` whenever no screen is
    // open and clears the inline value when one is. Rebinding a key on the
    // Controls tab must not also queue a tank behind the menu.
    const shell = document.querySelector('.vm-shell');
    if (shell instanceof HTMLElement && shell.style.pointerEvents !== 'none') return false;

    // `__VM.setUiVisible(false)` hides the HUD for the screenshot harness. A
    // hidden interface does not take keys.
    return getComputedStyle(this.root).visibility !== 'hidden';
  }

  /* ------------------------------------------------------------------ */
  /* async wiring — every one of these is allowed to fail                */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    await Promise.all([this.bindProduction(), this.bindDefs(), this.bindTerrain()]);
    this.resize(true);
  }

  /**
   * Live production, if the sim module registered one.
   *
   * KEEPS TRYING. `ui.hud.init()` and `sim.production.init()` are two systems
   * in one registry and the registry does not promise an order between them,
   * so a single attempt here is a coin flip — and when it lost, the HUD ran
   * permanently off `FALLBACK_ROSTER`. That is not a cosmetic downgrade: the
   * fallback is an Allied/Soviet-only table, so a Meridian player got an
   * EMPTY build grid, and both original armies got a tech tree that disagreed
   * with the real catalog (a buildable 2500-credit Construction Yard against a
   * real 3000-credit one that is `buildable: false`).
   *
   * So the module handle is kept and re-asked from `snapshot()` until it
   * answers. The retry is one function call and one null check, and it stops
   * for good the moment it binds.
   */
  private async bindProduction(): Promise<void> {
    try {
      this.productionMod = await import('../sim/Production');
      if (!this.tryBindProduction()) {
        console.info('[hud] production service not up yet — retrying every frame');
      }
    } catch (err) {
      console.info(`[hud] production module absent (${String(err)})`);
    }
  }

  /** @returns true once the live service is bound. */
  private tryBindProduction(): boolean {
    if (this.production !== null) return true;
    const service = this.productionMod?.production() ?? null;
    if (service === null) return false;
    this.production = service as unknown as ProductionSeam;
    // The overlay needs the door to anchor a rally tether. Pushed rather than
    // imported, like everything else this file hands it.
    this.overlay.setProduction(this.production);
    // The fallback grid may have been showing; drop its pooled rows so the
    // real roster cannot be shadowed by a longer stale one.
    for (const tab of this.localSnapshot.cameos) tab.length = 0;
    console.info('[hud] build grid bound to the live production service');
    return true;
  }

  /** Real def tables, for the selection panel's stat row. */
  private async bindDefs(): Promise<void> {
    try {
      const mod = await import('../game/Scenarios');
      const binding = await mod.resolveDefBinding();
      if (binding.tables === null) return;
      this.tables = binding.tables;
      console.info(
        `[hud] stats bound to real def tables ` +
        `(${binding.tables.units.length} units, ${binding.tables.buildings.length} buildings)`,
      );
    } catch (err) {
      console.info(`[hud] no def tables yet, the stat row stays blank (${String(err)})`);
    }
  }

  /** Map terrain, if the terrain module is present. */
  private async bindTerrain(): Promise<void> {
    try {
      const [terrainMod, cfg] = await Promise.all([
        import('../world/Terrain'),
        import('../core/config'),
      ]);
      const terrain = terrainMod.getTerrain();
      if (terrain === null) return;
      const cells = cfg.MAP_CELLS;
      const maxH = cfg.TERRAIN_MAX_HEIGHT;
      const sampler: TerrainSampler = {
        surface: (cx, cz) => terrain.surface[cz * cells + cx],
        water: (cx, cz) => terrain.waterGrid[cz * cells + cx] !== 0,
        height01: (cx, cz) => terrain.cellHeight[cz * cells + cx] / maxH,
      };
      this.minimap.setTerrain(sampler);
      console.info('[hud] tactical map bound to live terrain');
    } catch (err) {
      console.info(`[hud] no terrain yet, the map paints a flat field (${String(err)})`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* events                                                              */
  /* ------------------------------------------------------------------ */

  private subscribe(): void {
    const bus = this.channels.events;
    const isLocal = (p: PlayerId): boolean => (p as number) === (this.world.localPlayer as number);

    this.unsubs.push(bus.on('economy:credits', (e) => {
      if (!isLocal(e.player)) return;
      if (e.delta !== 0) this.sidebar.creditFlyout(e.delta);
      // INCOME only. Spending is not negative income, and counting it would
      // make the rate swing to zero every time a tank was ordered.
      if (e.delta > 0) this.incomeBucket += e.delta;
    }));

    this.unsubs.push(bus.on('combat:underAttack', (e) => {
      const mine = isLocal(e.player);
      // THE VICTIM'S SEAT, NOT A HOSTILE FLAG. This passed `!mine`, which the
      // map turned into one red ring for every army that is not yours — while
      // the blips under it had been per-seat since the four-army lobby landed.
      // `Minimap.ping` resolves the colour through the same `restyle` lookup
      // the blips use, so the ring cannot disagree with what it is drawn over.
      this.minimap.ping(e.x, e.z, e.player);
      if (mine) this.lastAttackTime = this.world.time;
    }));

    this.unsubs.push(bus.on('entity:damaged', (e) => {
      // Floating damage numbers only for hits the player can act on, or the
      // frame turns into a damage meter in any real battle.
      const local = this.world.localPlayer as number;
      if ((e.player as number) !== local && (e.attackerPlayer as number) !== local) return;
      if (e.amount < 1) return;
      const mine = (e.player as number) === local;
      this.overlay.floater(
        e.x, 2.4, e.z, `-${Math.round(e.amount)}`,
        mine ? SEMANTIC.danger : SEMANTIC.text,
      );
    }));

    this.unsubs.push(bus.on('production:ready', (e) => {
      if (!isLocal(e.player)) return;
      // Only the fallback snapshot needs poking; the real service sets its own.
      if (this.production === null) this.localSnapshot.tabAlert[e.tab as number] = true;
      if (!e.isBuilding) return;
      this.pingStructureReady(e.tab, e.defId);
    }));

    this.unsubs.push(bus.on('building:completed', (e) => {
      if (!isLocal(e.player)) return;
      this.minimap.invalidateTerrain();
    }));
    this.unsubs.push(bus.on('building:placed', () => this.minimap.invalidateTerrain()));
    this.unsubs.push(bus.on('building:sold', () => this.minimap.invalidateTerrain()));

    this.unsubs.push(bus.on('economy:power', (e) => {
      if (!isLocal(e.player)) return;
      const down = e.brownout || e.consumed > e.produced;
      // Edge-triggered, and rate-limited even on the edge: a base flickering in
      // and out of deficit must not produce a wall of chips.
      if (down && !this.brownout && this.world.time - this.lastBrownoutToast > 12) {
        this.lastBrownoutToast = this.world.time;
        this.toast('warn', 'power', 'Low power', `${e.consumed} drawn of ${e.produced}`);
      }
      this.brownout = down;
    }));

    this.unsubs.push(bus.on('eva:line', (e) => {
      if (!isLocal(e.player)) return;
      const spec = EVA_TOASTS[e.line as number];
      if (spec === undefined) return;
      this.toast(spec[0], `eva${e.line as number}`, spec[1]);
    }));

    this.unsubs.push(bus.on('match:started', () => {
      const p = this.world.players[this.world.localPlayer as number];
      if (p === undefined) return;
      this.setFaction(p.faction);
      this.sidebar.resetCredits(p.credits);
      this.toasts.clear();
    }));

    if (this.orderMarkers) {
      this.unsubs.push(bus.on('order:issued', (e) => {
        if (!isLocal(e.player)) return;
        const kind = e.order === 3 || e.order === 4 || e.order === 2 ? 'attack' : 'move';
        this.overlay.orderMarker(e.x, this.world.terrain.heightAt(e.x, e.z), e.z, kind);
      }));
    }
  }

  /* ------------------------------------------------------------------ */
  /* public surface                                                      */
  /* ------------------------------------------------------------------ */

  setFaction(faction: Faction): void {
    if (this.faction === faction) return;
    this.faction = faction;
    applyTheme(this.root, faction);
    this.sidebar.setFaction(faction);
    this.minimap.setFaction(faction);
    this.overlay.setFaction(faction);
    // The map key names the OTHER armies in their own blip colours, and the
    // local accent is one of the things those are held apart from — so a
    // faction swap invalidates it just as it invalidates the terrain bake.
    this.armyRosterSize = -1;
  }

  /**
   * Keep the map key in step with the player table.
   *
   * GATED ON THE TABLE'S LENGTH, not on a timer and not on an event. It changes
   * exactly twice in a session — when the shell seats the armies during the boot
   * (before this HUD's first frame) and when a save restore replaces the whole
   * table — and both are covered by one integer compare per frame, which is what
   * the zero-allocation rule for the frame loop leaves room for. `setArmies`
   * compares its argument as well, so a redundant call is free.
   *
   * A DUEL PASSES AN EMPTY LIST, which is the legend's "render the row you
   * always did" case: one swatch in `--vm-danger`, captioned "Hostile". Naming
   * the single opponent would be a gratuitous change to every existing match for
   * information the player already has.
   */
  private refreshArmyLegend(): void {
    const size = this.world.players.length;
    if (size === this.armyRosterSize) return;
    this.armyRosterSize = size;
    const hostiles = this.minimap.hostileArmies();
    this.sidebar.setArmies(hostiles.length > 1 ? hostiles : []);
  }

  setSoundHook(fn: ((cue: HudSoundCue) => void) | null): void {
    this.soundHook = fn;
  }

  /** Raise an event chip. Public so any module can post one. */
  toast(kind: ToastKind, key: string, title: string, detail = ''): void {
    this.toasts.push(kind, key, title, detail);
  }

  /**
   * Mark the sell tool as the thing to press, or stop.
   *
   * The seam `src/sim/orecrisis.system.ts` reaches through, alongside `toast`
   * and by the same structural rule: the sim names an intent, the HUD decides
   * what that looks like. It stays on `window.__vmHud`, so a headless boot or
   * the `?shot=` harness simply has nobody to call.
   */
  setOreCrisis(active: boolean): void {
    this.sidebar.setUrgentSell(active);
  }

  /* ------------------------------------------------------------------ */
  /* slot actions                                                        */
  /* ------------------------------------------------------------------ */

  private selectTab(tab: BuildTab): void {
    // A HIDDEN TAB IS NOT SELECTABLE. The sidebar already hides the button and
    // the Powers tab has no hotkey, so nothing reaches this with a hidden tab
    // today — but `selectTab` is the ONE choke point between every route in
    // (click, key, the sidebar's own correction when a tab goes away) and the
    // simulation's `activeTab`, and a refusal anywhere else would be a second
    // rule to keep in step.
    if (this.tabHidden(tab)) return;
    if (this.production !== null) {
      this.production.setActiveTab(tab);
      this.production.clearTabAlert(tab);
    } else {
      this.localTab = tab;
      this.localSnapshot.activeTab = tab;
      this.localSnapshot.tabAlert[tab as number] = false;
    }
  }

  private onSlotActivate(tab: BuildTab, cameo: HudCameo): void {
    const player = this.world.localPlayer;
    const p = this.world.players[player as number];
    if (p === undefined) return;

    if (cameo.ready) {
      if (!cameo.isBuilding) return;
      // A finished structure goes onto the cursor. Placement owns that gesture,
      // so the HUD asks rather than doing it — through the hook if anyone wired
      // one, and otherwise through the same global the input module uses.
      if (this.onPlaceRequest !== null) {
        this.onPlaceRequest(cameo.defId, cameo.key);
        return;
      }
      const g = globalThis as unknown as { __vmPlacement?: PlacementSeam };
      if (g.__vmPlacement !== undefined) g.__vmPlacement.begin(cameo.defId);
      return;
    }

    if (!cameo.available) {
      this.soundHook?.('error');
      return;
    }
    if (p.credits < cameo.cost) {
      this.soundHook?.('error');
      this.toast('warn', 'funds', 'Insufficient funds', cameo.name);
      return;
    }

    this.channels.commands.issueProductionStart(player, tab, cameo.defId, 1);
  }

  /**
   * THE PING. A structure finished; say so, name it, and say what to do.
   *
   * This chip is the whole replacement for the old behaviour, where a finished
   * structure jumped onto the cursor by itself and swallowed the next left
   * click. The player asked for the opposite: "just ping me when it's ready to
   * place, I will click and place." So nothing is armed, and instead three
   * surfaces that already existed all point at the same cameo — this chip, the
   * READY badge and `is-ready` on the cameo itself, and the alert dot on its
   * tab. `EvaLine.ConstructionComplete` still plays over the top of it.
   *
   * Keyed per structure, so two Power Plants finishing together coalesce into
   * one chip with a x2 rather than stacking.
   */
  private pingStructureReady(tab: BuildTab, defId: number): void {
    const list = this.snapshot().cameos[tab as number];
    let name = '';
    if (list !== undefined) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].defId === defId) { name = list[i].name; break; }
      }
    }
    if (name === '') name = 'Structure';
    this.toast('good', `ready-place:${defId}`, `${name} ready`, 'Click its cameo to place it');
  }

  private onSlotCancel(tab: BuildTab, cameo: HudCameo): void {
    if (cameo.queued <= 0 && !cameo.ready) return;
    this.channels.commands.issueProductionCancel(this.world.localPlayer, tab, cameo.defId, -1);
  }

  private stanceSelection(stance: Stance): void {
    const sel = this.world.selection;
    if (sel.count === 0) return;
    this.channels.commands.issueSetStance(this.world.localPlayer, sel.ids, sel.count, stance);
  }

  /**
   * A click on a unit card centres the camera on it.
   *
   * It deliberately does NOT change the selection: `SelectionState` is owned by
   * `src/input/Selection.ts`, and a HUD that writes it would fight every
   * marquee drag for the rest of the match.
   */
  private focusEntity(id: number): void {
    const store = this.world.store;
    const i = store.index(id as EntityId);
    if (i < 0) return;
    this.cameraRig.setFocus(store.posX[i], store.posZ[i], false);
  }

  /* ------------------------------------------------------------------ */
  /* per-frame                                                           */
  /* ------------------------------------------------------------------ */

  frame(dt: number): void {
    if (this.disposed) return;
    this.time += dt;

    this.resize(false);
    this.refreshArmyLegend();

    const snap = this.snapshot();
    this.buildSelectionView();
    this.buildTelemetry(snap, dt);
    this.fillPowers();

    this.sidebar.setRadarOnline(snap.hasRadar);
    // The armed flag is the one field on a countdown that can change without
    // the service pushing — Escape, a right-click and a fired shot all cancel
    // from inside `Superweapons`. Re-read it here so the highlight cannot
    // outlive the reticle.
    const armed = superweaponSeam()?.armedKey ?? null;
    for (let i = 0; i < this.supers.count; i++) {
      this.supers.rows[i].armed = this.supers.rows[i].key === armed;
    }
    this.sidebar.update(snap, this.view, this.telemetry, dt, this.supers, this.powers);
    // AFTER `update`, so a slot that just changed content has already bound its
    // new subject and can be rendered in the same frame rather than a frame
    // late. Costs nothing when the queue is empty, which is almost always.
    this.sidebar.frameCameos(this.time, dt);
    this.minimap.frame(this.time, dt);
    this.pushPlacementHint();
    this.overlay.frame(dt);
    this.toasts.frame(dt);
  }

  /**
   * Tell the overlay where the placement ghost is, so it can caption the rotate
   * keys under it.
   *
   * The keys work and always have — verified in Chromium at all four facings on
   * both a square and a 3x2 footprint — but nothing on screen ever said they
   * existed. They are in `ActionCatalogue` and on the help screen, and a player
   * mid-placement is looking at the ghost, not at either of those.
   *
   * Read off the same duck-typed `__vmPlacement` seam the relocate button uses,
   * and every field is optional: a controller without a `report` (or no
   * controller at all) simply gets no caption, which is what the HUD did before.
   */
  private pushPlacementHint(): void {
    const seam = placementSeam();
    const report = seam?.report;
    if (seam === null || !seam.active || report === undefined
      || seam.cx === undefined || seam.cz === undefined) {
      this.overlay.clearPlacementHint();
      return;
    }
    this.overlay.setPlacementHint(seam.cx, seam.cz, report.w, report.h);
  }

  /* ------------------------------------------------------------------ */
  /* telemetry — the numbers nobody else publishes                       */
  /* ------------------------------------------------------------------ */

  /**
   * Army size, base size, income rate and one line of advice.
   *
   * None of this is in `HudSnapshot`: that structure belongs to
   * `src/sim/Production.ts` and none of these four are production's business.
   * They are derived here, from the store and from the HUD's own event
   * subscriptions, which is also why the HUD keeps working when production is
   * absent.
   */
  private buildTelemetry(snap: HudSnapshot, dt: number): void {
    const tele = this.telemetry;
    const store = this.world.store;
    const local = this.world.localPlayer;

    let army = 0;
    for (const kind of MOBILE_KINDS) {
      const list = store.byKind[kind];
      const count = store.byKindCount[kind];
      for (let i = 0; i < count; i++) {
        const e = list[i];
        if ((store.owner[e] as PlayerId) !== local) continue;
        if ((store.flags[e] & EntityFlag.PendingDestroy) !== 0) continue;
        army++;
      }
    }
    tele.army = army;

    let structures = 0;
    const blist = store.byKind[EntityKind.Building];
    const bcount = store.byKindCount[EntityKind.Building];
    for (let i = 0; i < bcount; i++) {
      const e = blist[i];
      if ((store.owner[e] as PlayerId) !== local) continue;
      const f = store.flags[e];
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
      structures++;
    }
    tele.structures = structures;

    /* -- income ---------------------------------------------------------
     * A one-second bucket feeding an exponential average. A raw per-frame rate
     * is unreadable (a harvester unloads in one tick and the number spikes to
     * four figures), and a pure running total answers the wrong question. */
    this.incomeWindow += dt;
    if (this.incomeWindow >= 1) {
      const rate = this.incomeBucket / this.incomeWindow;
      this.incomePerSec += (rate - this.incomePerSec) * INCOME_SMOOTHING;
      this.incomeBucket = 0;
      this.incomeWindow = 0;
    }
    tele.incomePerMin = this.incomePerSec * 60;

    /* -- the storage ceiling --------------------------------------------
     * Straight off `PlayerState`. It is not in `HudSnapshot` because that
     * structure belongs to `src/sim/Production.ts` and a credit ceiling is not
     * production's business — the same argument that keeps army, structures and
     * income out of it. 0 when the player is somehow absent, which the strip
     * renders as no denominator at all rather than as a cap of zero. */
    const me = this.world.players[local as number];
    tele.storageMax = me !== undefined && me.storageMax > 0 ? me.storageMax : 0;

    /* -- the advice line ------------------------------------------------
     * Ordered by what would kill you soonest. Exactly one sentence shows, and
     * it names an ACTION wherever there is one to name. */
    const power = powerStateOf(snap.powerProduced, snap.powerConsumed, snap.brownout);
    if (this.world.time - this.lastAttackTime < ATTACK_ADVICE_SECONDS) {
      this.setAdvice('Base under attack — check the tactical map', 'alert');
    } else if (structures === 0) {
      this.setAdvice('No structures. Deploy an MCV to found a base', 'alert');
    } else if (power === 'down') {
      this.setAdvice('Low power — every queue is running slow. Build a power plant', 'warn');
    } else if (power === 'tight') {
      this.setAdvice('Power is tight — the next structure will brown you out', 'warn');
    } else if (!snap.hasRadar) {
      this.setAdvice('No radar. Build a Radar Dome to see enemy movement', 'info');
    } else if (tele.incomePerMin < 1 && snap.gameTimeSec > 45) {
      this.setAdvice('No ore income — check your harvesters and refinery', 'warn');
    } else if (army === 0) {
      this.setAdvice('No combat units in the field', 'warn');
    } else {
      this.setAdvice('All systems nominal', 'info');
    }
  }

  private setAdvice(text: string, kind: AdviceKind): void {
    this.telemetry.advice = text;
    this.telemetry.adviceKind = kind;
  }

  /* ------------------------------------------------------------------ */
  /* snapshot                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * The live snapshot, or the local one refreshed in place.
   *
   * THE COLD-START BRANCH IS NOT COSMETIC. `ProductionService.refreshSnapshot`
   * runs inside `simTick`, so until the simulation has ticked once, the live
   * snapshot is its constructed initial value: zero credits, zero power, a zero
   * clock and FOUR EMPTY CAMEO LISTS. A real match passes through that state
   * for one frame. `tools/shoot.mjs` never leaves it — `Bootstrap.start()`
   * pauses the loop in `?shot=` mode — which is why `shots/02-hud-full.png`
   * showed `$0 / +0 / 00:00` over an empty build grid and looked like a broken
   * HUD when the HUD was faithfully rendering a snapshot nobody had filled in.
   *
   * So a bound-but-unpublished snapshot falls through to the local one, which
   * reads its scalars straight off `PlayerState` and its grid off the live
   * catalog. The ids are the catalog's own `publicId`s, so a click in that
   * window issues exactly the command the live grid would have.
   */
  private snapshot(): HudSnapshot {
    const p = this.world.players[this.world.localPlayer as number];
    // Unconditional, and cheap: it early-returns unless the faction or the
    // catalog's availability changed. It also owns `keyNames`, which the
    // tooltip's "Requires ..." sentence needs on the LIVE path too.
    if (p !== undefined) this.ensureGridRows(p.faction);

    if (this.tryBindProduction()) {
      const live = this.production!.snapshot;
      let published = false;
      for (let t = 0; t < BUILD_TAB_COUNT; t++) {
        if (live.cameos[t] !== undefined && live.cameos[t].length > 0) { published = true; break; }
      }
      if (published) return live;
      this.localTab = live.activeTab;
    }

    const snap = this.localSnapshot;
    if (p === undefined) return snap;

    snap.credits = Math.round(p.credits);
    snap.creditsDisplay = snap.credits;
    snap.powerProduced = p.powerProduced;
    snap.powerConsumed = p.powerConsumed;
    snap.brownout = p.powerConsumed > p.powerProduced;
    snap.hasRadar = p.hasRadar || this.world.vision.hasRadar(this.world.localPlayer);
    snap.activeTab = this.localTab;
    snap.selectionCount = this.world.selection.count;
    snap.selectionPrimary = (this.world.selection.count > 0
      ? this.world.selection.ids[0] : 0) as EntityId;
    snap.gameTimeSec = this.world.time;

    this.countOwnedUnits(p);
    for (let t = 0; t < BUILD_TAB_COUNT; t++) this.fillLocalTab(p, t as BuildTab);
    return snap;
  }

  /**
   * Completed units the local player owns, bucketed by def id.
   *
   * ONE pass over the player's mobile entities per snapshot, not one per cameo:
   * the grid is ~60 cells across four tabs and a per-cell scan would be sixty
   * passes over the same arrays every frame.
   *
   * Buildings deliberately do NOT come through here — `PlayerState.buildingCount`
   * is already maintained by the sim and is an O(1) lookup, so scanning for them
   * would be both slower and a second source of truth for the same number.
   *
   * `UnderConstruction` is excluded on purpose: an entity still being built is
   * already shown by `queued` and the progress bar, and counting it in both
   * places reads as owning something that does not exist yet.
   */
  private countOwnedUnits(p: PlayerState): void {
    const owned = this.ownedByDef;
    owned.fill(0);
    const st = this.world.store;
    const local = p.id;
    for (let k = 0; k < MOBILE_KINDS.length; k++) {
      const kind = MOBILE_KINDS[k];
      const list = st.byKind[kind];
      const n = st.byKindCount[kind];
      for (let j = 0; j < n; j++) {
        const e = list[j];
        if ((st.owner[e] as PlayerId) !== local) continue;
        if ((st.flags[e] & EntityFlag.UnderConstruction) !== 0) continue;
        const d = st.defId[e];
        if (d >= 0 && d < owned.length) owned[d]++;
      }
    }
  }

  /** Scratch for `countOwnedUnits`. Indexed by def id, reused every frame. */
  private readonly ownedByDef = new Int32Array(256);

  /**
   * Resolve the grid the local snapshot renders.
   *
   * The live catalog wins whenever it is reachable, because `FALLBACK_ROSTER`
   * is an Allied/Soviet-only table with invented costs — a Meridian player got
   * an empty grid from it, and both original armies got a tech tree that
   * disagreed with the real one. Cold path: it runs on a faction change and on
   * the frame the catalog first answers, and never again.
   */
  private ensureGridRows(faction: Faction): void {
    const catalog = this.production?.catalog;
    const fromCatalog = typeof catalog?.roster === 'function';
    if (this.gridFaction === (faction as number) && this.gridFromCatalog === fromCatalog) return;
    this.gridFaction = faction as number;
    this.gridFromCatalog = fromCatalog;
    this.keyNames.clear();

    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const out = this.gridRows[t];
      out.length = 0;
      if (fromCatalog) {
        for (const e of catalog!.roster!(faction, t as BuildTab)) {
          out.push({
            defId: e.publicId,
            key: e.key,
            name: e.name,
            cost: e.cost,
            isBuilding: e.kind === 0,
            prereqs: e.prereqs,
          });
          this.keyNames.set(e.key, e.name);
        }
      } else {
        for (let i = 0; i < FALLBACK_ROSTER.length; i++) {
          const row = FALLBACK_ROSTER[i];
          if (row.tab !== t) continue;
          if (row.faction !== Faction.Neutral && row.faction !== faction) continue;
          // Without def tables the only id space in the building is this index.
          out.push({
            defId: i,
            key: row.key,
            name: row.name,
            cost: row.cost,
            isBuilding: row.isBuilding,
            prereqs: row.prereqs,
          });
          this.keyNames.set(row.key, row.name);
        }
      }
    }
    // Names for prerequisites that are not themselves buildable this game.
    for (const row of FALLBACK_ROSTER) {
      if (!this.keyNames.has(row.key)) this.keyNames.set(row.key, row.name);
    }
  }

  private fillLocalTab(p: PlayerState, tab: BuildTab): void {
    const pool = this.localPool[tab as number];
    const out = this.localSnapshot.cameos[tab as number];
    const rows = this.gridRows[tab as number];
    out.length = 0;

    for (let n = 0; n < rows.length; n++) {
      const row = rows[n];

      let c = pool[n];
      if (c === undefined) {
        c = {
          // `isUpgrade` is false for every row this path can produce and stays
          // false: this is the FALLBACK roster, used when no production catalog
          // bound, and upgrades exist only in `Production.CONTENT`. A pooled
          // object is reused across rows, so it is set once here rather than
          // per row below — there is nothing that could flip it.
          defId: -1, isBuilding: false, isUpgrade: false, isPower: false,
          key: '', name: '', cost: 0,
          progress: 0, queued: 0, ready: false, onHold: false, available: true, reason: '',
          owned: 0,
        };
        pool.push(c);
      }

      c.defId = row.defId;
      c.isBuilding = row.isBuilding;
      c.key = row.key;
      c.name = row.name;
      c.cost = row.cost;
      c.progress = 0;
      c.queued = 0;
      c.ready = false;
      c.onHold = false;

      const q = p.queues[tab as number];
      if (q !== undefined) {
        for (let i = 0; i < q.items.length; i++) {
          const item = q.items[i];
          if (item.defId !== c.defId || item.isBuilding !== c.isBuilding) continue;
          c.queued++;
          if (i === 0) {
            c.progress = item.progress;
            c.ready = item.ready;
            c.onHold = item.onHold;
          }
        }
      }

      let reason = '';
      for (const req of row.prereqs) {
        if (this.ownsStructure(p, req)) continue;
        reason = `Requires ${this.keyNames.get(req) ?? req}`;
        break;
      }
      c.available = reason === '';
      c.reason = reason;

      // Buildings have an O(1) count the sim already keeps; units are bucketed
      // once per snapshot by `countOwnedUnits`.
      //
      // `c.defId` CARRIES TWO DIFFERENT ID SPACES depending on which path built
      // this row: the catalog path stores `entry.publicId`, which for a unit is
      // `defId + UNIT_PUBLIC_ID_BASE`, while the fallback-roster path stores a
      // raw table index. `ownedByDef` is bucketed by the raw `store.defId`, so
      // the offset has to come back off or the lookup lands past the end of the
      // array and silently reads zero — which is exactly what it did.
      const rawDef = c.defId >= UNIT_PUBLIC_ID_BASE ? c.defId - UNIT_PUBLIC_ID_BASE : c.defId;
      c.owned = c.isBuilding
        ? (c.defId >= 0 && c.defId < p.buildingCount.length ? p.buildingCount[c.defId] : 0)
        : (rawDef >= 0 && rawDef < this.ownedByDef.length ? this.ownedByDef[rawDef] : 0);

      out.push(c);
    }
  }

  /**
   * Fallback prerequisite test: does the player own a completed structure whose
   * def name matches `key`? Without def tables this is a scan over the
   * building list, which only runs while the fallback roster is in use.
   */
  private ownsStructure(p: PlayerState, key: string): boolean {
    if (this.tables !== null) {
      const idx = this.tables.buildingByKey.get(key);
      if (idx === undefined) return false;
      return p.buildingCount[idx] > 0;
    }
    const store = this.world.store;
    const list = store.byKind[EntityKind.Building];
    const count = store.byKindCount[EntityKind.Building];
    for (let i = 0; i < count; i++) {
      const e = list[i];
      if ((store.owner[e] as PlayerId) !== p.id) continue;
      if ((store.flags[e] & EntityFlag.UnderConstruction) !== 0) continue;
      if (this.keyOf(e) === key) return true;
    }
    return false;
  }

  /** Tooltip extras: from the live catalog when there is one, else the roster. */
  private extrasFor(key: string): BuildExtras {
    const unlockHint = this.unlockHintFor(key);
    // The long form is a pure key -> string lookup with no dependency of its
    // own, so unlike production, terrain and the def tables it needs no
    // `import()` seam — there is nothing here that can fail to land. It falls
    // back to '' for an unknown key and the sidebar then prints the blurb, so
    // the fallback roster below is covered too.
    const description = describeBuildable(key);
    const entry = this.production?.catalog.byKey(key) ?? null;
    if (entry !== null) {
      return {
        buildTimeSec: entry.buildTime,
        powerDelta: entry.power,
        blurb: entry.blurb,
        description,
        prereq: this.prereqSentence(entry.prereqs),
        unlockHint,
      };
    }
    const row = FALLBACK_ROSTER.find((r) => r.key === key && r.faction === this.faction)
      ?? FALLBACK_ROSTER.find((r) => r.key === key);
    if (row === undefined) {
      return { buildTimeSec: 0, powerDelta: 0, blurb: '', description, prereq: '', unlockHint };
    }
    return {
      buildTimeSec: row.buildTime,
      powerDelta: row.power,
      blurb: row.blurb,
      description,
      prereq: this.prereqSentence(row.prereqs),
      unlockHint,
    };
  }

  /**
   * `Strip Mine: mine 70,000 credits of ore` for a progression-gated def, or ''.
   *
   * THE JOIN NOTHING WAS MAKING. `UnlockGate` refuses a def and puts one
   * constant sentence on the cameo — "Locked — complete a mission" — with no
   * mission in it, and a player who hovered a locked Battle Lab asked whether
   * they were supposed to guess. Both halves of the answer already existed: the
   * def carries `unlockedBy`, and exactly one mission grants each id. This is
   * the only place in the product that can see both, because it is the only
   * place holding the def tables AND the progression handle.
   *
   * TOTAL, and every failure is silent by design. No tables, no gate tag, no
   * progression layer, or a progression layer too old to answer — all give '',
   * and the palette then prints exactly what it printed before. A locked slot
   * losing its mission name is a worse tooltip; a locked slot throwing is a
   * dead HUD.
   *
   * Called only from `extrasFor`, which the palette reaches on a signature
   * change rather than per frame.
   */
  private unlockHintFor(key: string): string {
    const tables = this.tables;
    if (tables === null) return '';

    let unlockId: string | undefined;
    const bi = tables.buildingByKey.get(key);
    if (bi !== undefined) unlockId = tables.buildings[bi]?.unlockedBy;
    if (unlockId === undefined) {
      const ui = tables.unitByKey.get(key);
      if (ui !== undefined) unlockId = tables.units[ui]?.unlockedBy;
    }
    if (unlockId === undefined || unlockId === '') return '';

    const p = readProgression();
    // Optional on the interface: see `UnlockSource` in `src/ui/Objectives.ts`
    // for why the member is declared that way and what its absence means.
    if (p === null || typeof p.unlockSource !== 'function') return '';
    let src;
    try {
      src = p.unlockSource(unlockId);
    } catch {
      return '';
    }
    if (src === null || src === undefined) return '';
    return src.objective === '' ? src.title : `${src.title}: ${src.objective}`;
  }

  /**
   * `Requires Ore Refinery + Radar Dome`, or empty for a root-tier item.
   *
   * Stated whether or not it is satisfied: the tech tree has no other
   * documentation anywhere in the game, and a player reads this to plan, not
   * only to find out why a cell is grey.
   */
  private prereqSentence(prereqs: readonly string[] | undefined): string {
    if (prereqs === undefined || prereqs.length === 0) return '';
    let out = '';
    for (const key of prereqs) {
      out += (out === '' ? '' : ' + ') + (this.keyNames.get(key) ?? key);
    }
    return `Requires ${out}`;
  }

  /* ------------------------------------------------------------------ */
  /* the selection view                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Group the selection by def and fill the pooled view.
   *
   * Grouping is O(selection x distinct types), which for a 100-unit army of six
   * types is 600 integer compares — cheaper than a Map, and it allocates
   * nothing.
   */
  private buildSelectionView(): void {
    const view = this.view;
    const store = this.world.store;
    const sel = this.world.selection;

    view.count = sel.count;
    if (sel.count === 0) {
      view.cardCount = 0;
      view.stanceEnabled = false;
      view.hpFrac = 1;
      view.hpText = '';
      view.mending = false;
      view.relocate.visible = false;
      view.ability.visible = false;
      view.cargo.visible = false;
      return;
    }

    this.groupKeys.length = 0;
    this.groupFirst.length = 0;
    this.groupCount.length = 0;
    this.groupHp.length = 0;

    let stance = -2;
    let anyMobile = false;
    let allBuildings = true;
    let totalHp = 0;
    let totalMaxHp = 0;
    let mending = false;
    const now = this.world.time;

    for (let i = 0; i < sel.count; i++) {
      const idx = store.index(sel.ids[i] as EntityId);
      if (idx < 0) continue;

      totalHp += store.hp[idx];
      totalMaxHp += store.maxHp[idx];
      // The predicate is `src/sim/Regen.ts`'s, not a second copy of it. See the
      // import note in `src/ui/Overlay.ts`.
      //
      // `BeingRepaired` is the OTHER way something mends: the wrench on a
      // structure, or a Repair Depot's pad under a vehicle. Both are paid for
      // by the player, so both deserve the tag more than passive regen does —
      // and without this the depot would put 100 hp a second into a tank while
      // the panel said nothing was happening.
      if (!mending
        && (isRegenerating(store, idx, now)
          || (store.flags[idx] & EntityFlag.BeingRepaired) !== 0)) mending = true;

      const kind = store.kind[idx];
      if (kind !== EntityKind.Building) allBuildings = false;
      if ((store.flags[idx] & EntityFlag.CanMove) !== 0) {
        anyMobile = true;
        const s = store.stance[idx];
        stance = stance === -2 ? s : stance === s ? s : -1;
      }

      // Key on (kind, defId) so an Allied and a Soviet unit sharing a def index
      // in two tables never merge into one card.
      const gkey = kind * 8192 + (store.defId[idx] + 1);
      const frac = store.maxHp[idx] > 0 ? store.hp[idx] / store.maxHp[idx] : 1;

      let g = -1;
      for (let k = 0; k < this.groupKeys.length; k++) {
        if (this.groupKeys[k] === gkey) { g = k; break; }
      }
      if (g < 0) {
        this.groupKeys.push(gkey);
        this.groupFirst.push(idx);
        this.groupCount.push(1);
        // The bar shows the WORST unit in the stack: that is the actionable
        // number. An average hides the one tank about to die.
        this.groupHp.push(frac);
      } else {
        this.groupCount[g]++;
        if (frac < this.groupHp[g]) {
          this.groupHp[g] = frac;
          this.groupFirst[g] = idx;
        }
      }
    }

    /* -- cards --------------------------------------------------------- */
    const n = Math.min(this.groupKeys.length, view.cards.length);
    const primaryIdx = store.index(sel.ids[0] as EntityId);
    for (let k = 0; k < n; k++) {
      const idx = this.groupFirst[k];
      const card = view.cards[k];
      const info = this.describe(idx);
      card.id = store.handleOf(idx) as number;
      card.icon = info.icon;
      // `describe()` already resolves the content key — through the production
      // service first and the def tables second — so the model cameo costs
      // nothing extra to feed. It returns '' only when neither could name the
      // entity, which is the case that keeps the glyph.
      card.cameoKey = info.key;
      card.isBuilding = store.kind[idx] === EntityKind.Building;
      card.name = info.name;
      card.hpFrac = this.groupHp[k];
      card.stack = this.groupCount[k];
      card.veterancy = rankOf(store.flags[idx]);
      card.primary = primaryIdx >= 0
        && store.kind[idx] === store.kind[primaryIdx]
        && store.defId[idx] === store.defId[primaryIdx];
    }
    view.cardCount = n;

    /* -- aggregate health ---------------------------------------------- *
     * Absolute hit points, not an average of fractions: twelve conscripts and
     * one Apocalypse at the same 60% are not the same army, and the number the
     * player is deciding on is how much punishment the GROUP can still take. */
    view.hpFrac = totalMaxHp > 0 ? Math.max(0, Math.min(1, totalHp / totalMaxHp)) : 1;
    view.hpText = totalMaxHp > 0
      ? `${Math.round(totalHp)} / ${Math.round(totalMaxHp)} HP` : '';
    view.mending = mending;

    /* -- headline ------------------------------------------------------ */
    if (primaryIdx >= 0) {
      const info = this.describe(primaryIdx);
      view.title = n > 1 ? 'MIXED FORCE' : info.name.toUpperCase();
      view.subtitle = n > 1
        ? `${n} types selected`
        : allBuildings ? 'Structure' : info.role;
      view.veterancy = n > 1 ? 0 : rankOf(store.flags[primaryIdx]);
      this.fillStats(primaryIdx);
    } else {
      view.title = '';
      view.subtitle = '';
      view.veterancy = 0;
      view.armour = ''; view.damage = ''; view.range = ''; view.speed = '';
    }

    view.stanceEnabled = anyMobile;
    view.stance = stance < 0 ? -1 : (stance as Stance);
    this.fillRelocate(allBuildings);
    this.fillAbility();
    this.fillCargo();
    this.fillGarrison();
    this.fillPrimary();
    this.fillSelfDestruct();
  }

  /**
   * The Relocate button's whole state, re-derived every frame.
   *
   * ONE structure only. A relocation is a placement, a placement needs a cursor
   * and there is exactly one cursor; "move these four things" has no honest
   * answer about where the other three go. So the row appears for a single
   * selected structure and for nothing else — which is also the selection a
   * player who wants to move a building will actually have.
   *
   * The verdict is NOT computed here. `RelocateService.inspect` is the same
   * function the sim calls at commit, so the sentence on the button and the
   * reason the move is refused cannot drift apart. This file's whole job is to
   * turn that report into a label.
   *
   * It is re-asked every frame rather than cached on selection change, because
   * two of its inputs move under a stationary selection: the bank (a repair
   * drip can take you below the fee) and the garrison (a squad walking in
   * forbids the move). `inspect` allocates nothing; its one non-constant step
   * is a walk of the infantry list inside `Garrison.occupantCount`, and paying
   * that for ONE selected structure is the price of the button never lying.
   */
  private fillRelocate(allBuildings: boolean): void {
    const action = this.view.relocate;
    const sel = this.world.selection;
    const store = this.world.store;

    if (!allBuildings || sel.count !== 1) { action.visible = false; return; }

    const id = sel.ids[0] as EntityId;
    const idx = store.index(id);
    if (idx < 0 || store.owner[idx] !== (this.world.localPlayer as number)) {
      action.visible = false;
      return;
    }

    const seam = relocateSeam();
    if (seam === null) { action.visible = false; return; }

    const report = seam.inspect(this.world.localPlayer, id);
    action.visible = true;
    action.enabled = report.ok;
    action.cost = report.cost;
    action.armed = placementSeam()?.relocating === (id as number);
    action.hint = report.ok
      ? `Relocate for ${formatCost(report.cost)} credits — pick a new site`
      : report.reason;
  }

  /**
   * Put the selected structure on the cursor.
   *
   * Nothing is charged and nothing moves at this line: `beginRelocate` only
   * raises the ghost, the building keeps standing, shooting and producing, and
   * a cancel therefore costs nothing and CAN cost nothing. The fee is taken by
   * the sim on the commit click, once.
   */
  private relocateSelection(): void {
    const sel = this.world.selection;
    if (sel.count !== 1) return;
    const seam = placementSeam();
    if (seam === null) {
      this.soundHook?.('error');
      return;
    }
    if (!seam.beginRelocate(sel.ids[0])) {
      this.soundHook?.('error');
      this.toast('warn', 'relocate', 'Cannot relocate', this.view.relocate.hint);
    }
  }

  /**
   * The commander's ability row.
   *
   * ONE selected unit only, and it must be yours. A commander swept up in a
   * box-select alongside twenty conscripts does not put its button on screen:
   * with a mixed selection there is no answer to "whose cooldown is that", and
   * a button that fires an ability the player did not know was selected is
   * worse than no button. Click the hero, press the verb.
   *
   * Re-asked every frame rather than cached on selection change, because the
   * cooldown ticks down under a stationary selection. The panel's own signature
   * gate quantises that to whole seconds, so a steady cooldown writes DOM once
   * a second rather than once a frame.
   */
  private fillAbility(): void {
    const action = this.view.ability;
    const sel = this.world.selection;

    if (sel.count !== 1) { action.visible = false; return; }

    const seam = abilitySeam();
    if (seam === null) { action.visible = false; return; }

    const id = sel.ids[0] as EntityId;
    const idx = this.world.store.index(id);
    if (idx < 0 || this.world.store.owner[idx] !== (this.world.localPlayer as number)) {
      action.visible = false;
      return;
    }

    const ability = seam.abilityOf(id);
    // 0 is AbilityId.None, whose row exists only to keep the array a direct
    // lookup. Anything out of range means the seam and the table disagree,
    // which is a content bug and must not render a nameless button.
    if (ability <= 0 || ability >= ABILITIES.length) { action.visible = false; return; }
    const spec = ABILITIES[ability];

    const cooldown = seam.cooldownSecondsOf(id);
    action.visible = true;
    action.label = spec.label;
    action.hint = spec.hint;
    action.cooldown = cooldown;
    action.cooldownTotal = spec.cooldownSeconds;
    action.enabled = cooldown <= 0;
  }

  /**
   * The transport's cargo row — every selected hull with seats, summed.
   *
   * `computeCargoAction` holds the walk and the reasoning, including why the
   * sum is a number about something now that Unload empties all of them.
   */
  private fillCargo(): void {
    computeCargoAction(this.view.cargo, this.world, transportSeam());
  }

  /**
   * Unload every selected transport that has somebody aboard.
   *
   * `issueUnload` in `src/input/input.system.ts`, reached from the other end.
   * That function has answered the D key for N transports since it shipped;
   * this one only ever addressed `sel.ids[0]`, so the SAME gesture did two
   * different things depending on whether you reached it by key or by button.
   * The walk is reimplemented rather than imported because `src/ui` must not
   * take a dependency on `src/input` — see this file's header — and it asks the
   * seam's `passengerCount(id) > 0` where `gatherLoadedTransports` asks the
   * service's `isLoadedAt(i)`. Same question, and the seam is what the HUD has.
   *
   * Through `channels.commands` as ordinary Orders, for the same reason
   * `OrderKind.UseAbility` goes that way: the AI issues the identical command,
   * the replay records one thing rather than two, and the lockstep link carries
   * it without a special case.
   */
  private unloadSelection(): void {
    const action = this.view.cargo;
    if (!action.visible) return;
    if (!action.enabled) {
      this.soundHook?.('error');
      this.toast('warn', 'cargo', 'Unload', 'Nobody aboard');
      return;
    }
    const seam = transportSeam();
    if (seam === null) return;

    const store = this.world.store;
    const sel = this.world.selection;
    const local = this.world.localPlayer as number;
    let n = 0;
    for (let k = 0; k < sel.count && n < this.unloadIds.length; k++) {
      const id = sel.ids[k] as EntityId;
      const i = store.index(id);
      if (i < 0 || store.owner[i] !== local) continue;
      if ((store.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      // Already unloading: a second click must not re-issue, exactly as a
      // second D press must not. The row can still read `enabled` here —
      // passengers stay aboard until `TransportService` finds each of them a
      // standable cell — so this is the one way a lit button legitimately
      // issues nothing, and it says so rather than going quiet.
      if ((store.orderKind[i] as OrderKind) === OrderKind.Unload) continue;
      if (seam.passengerCount(id) <= 0) continue;
      this.unloadIds[n++] = sel.ids[k];
    }
    if (n === 0) {
      this.soundHook?.('error');
      this.toast('warn', 'cargo', 'Unload', 'Already unloading');
      return;
    }

    for (let k = 0; k < n; k++) {
      const i = store.index(this.unloadIds[k] as EntityId);
      if (i < 0) continue;
      this.oneId[0] = this.unloadIds[k];
      this.channels.commands.issueOrder(
        this.world.localPlayer, OrderKind.Unload, this.oneId, 1,
        store.posX[i], store.posZ[i], this.unloadIds[k] as EntityId,
      );
    }
    this.toast('info', 'cargo', 'Unload', action.hint);
  }

  /**
   * The garrisoned structure's Evacuate row — every occupied one, summed.
   *
   * `computeGarrisonAction` holds the walk, the reasoning, and the one place
   * this row deliberately differs from the cargo row.
   */
  private fillGarrison(): void {
    computeGarrisonAction(this.view.garrison, this.world, garrisonSeam());
  }

  /**
   * Empty every selected garrison.
   *
   * `OrderKind.Unload` ON THE BUILDING — the same order the transport's Unload
   * button issues, addressed to a structure instead of a hull. That is not a
   * pun: garrisoned infantry and transported infantry carry the identical
   * `EntityFlag.Garrisoned` and are put back on the ground by the identical
   * kind of call, so making them one order means the D key, this button, the
   * replay log and the lockstep wire all carry one verb rather than two.
   *
   * `src/input/Commands.ts` resolves it at the ONE Phase.Command drain: a
   * `Unload` landing on a Building reaches `GarrisonService.evacuate`, and on a
   * hull it does what it always did.
   *
   * `gatherOccupiedGarrisons`'s walk, for the reason given on
   * `unloadSelection` — and with its one asymmetry preserved: there is no
   * `orderKind` guard, because a building's evacuation is applied
   * SYNCHRONOUSLY inside the same drain, so a second click finds the occupant
   * count already 0 and gathers nothing.
   */
  private evacuateSelection(): void {
    const action = this.view.garrison;
    if (!action.visible) return;
    if (!action.enabled) {
      this.soundHook?.('error');
      this.toast('warn', 'garrison', 'Evacuate', 'Nobody inside');
      return;
    }
    const seam = garrisonSeam();
    if (seam === null) return;

    const store = this.world.store;
    const sel = this.world.selection;
    const local = this.world.localPlayer as number;
    let n = 0;
    for (let k = 0; k < sel.count && n < this.unloadIds.length; k++) {
      const id = sel.ids[k] as EntityId;
      const i = store.index(id);
      if (i < 0 || store.owner[i] !== local) continue;
      if (store.kind[i] !== EntityKind.Building) continue;
      if ((store.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      if (seam.occupantCount(id) <= 0) continue;
      this.unloadIds[n++] = sel.ids[k];
    }
    if (n === 0) { this.soundHook?.('error'); return; }

    for (let k = 0; k < n; k++) {
      const i = store.index(this.unloadIds[k] as EntityId);
      if (i < 0) continue;
      this.oneId[0] = this.unloadIds[k];
      this.channels.commands.issueOrder(
        this.world.localPlayer, OrderKind.Unload, this.oneId, 1,
        store.posX[i], store.posZ[i], this.unloadIds[k] as EntityId,
      );
    }
    this.toast('info', 'garrison', 'Evacuate', action.hint);
  }

  /**
   * The primary-factory row.
   *
   * ONE selected factory only, and it must be yours and finished. A factory
   * still under construction has no `producesTabs` entry yet, so
   * `Production.applyPrimary` would refuse the command — and a button that
   * silently does nothing is worse than no button.
   *
   * Everything here is read straight off the EntityStore rather than through a
   * seam, because `EntityFlag.IsFactory` and `EntityFlag.PrimaryFactory` are
   * CORE state: they are columns in `world.store`, not something production
   * owns, so there is nothing to duck-type and nothing to be absent.
   */
  private fillPrimary(): void {
    const action = this.view.primary;
    const sel = this.world.selection;

    if (sel.count !== 1) { action.visible = false; return; }

    const store = this.world.store;
    const idx = store.index(sel.ids[0] as EntityId);
    if (idx < 0 || store.owner[idx] !== (this.world.localPlayer as number)) {
      action.visible = false;
      return;
    }
    const flags = store.flags[idx];
    if ((flags & EntityFlag.IsFactory) === 0) { action.visible = false; return; }
    if ((flags & EntityFlag.UnderConstruction) !== 0) { action.visible = false; return; }

    const isPrimary = (flags & EntityFlag.PrimaryFactory) !== 0;
    action.visible = true;
    action.isPrimary = isPrimary;
    action.enabled = !isPrimary;
    action.hint = isPrimary
      ? 'This is your primary — everything of its type comes out of here'
      : 'Make this the factory everything of its type comes out of';
  }

  /** Hand the selected factory the primary flag. Through the bus, like all of it. */
  private setPrimarySelection(): void {
    const sel = this.world.selection;
    if (sel.count !== 1) return;
    const action = this.view.primary;
    if (!action.visible || !action.enabled) {
      this.soundHook?.('error');
      return;
    }
    this.channels.commands.issueSetPrimary(this.world.localPlayer, sel.ids[0] as EntityId);
    this.toast('info', 'primary', 'Primary Factory', action.hint);
  }

  /**
   * The self-destruct row.
   *
   * INFANTRY AND VEHICLES, and any number of them: unlike every other row on
   * this panel this one is happy with a whole column selected, because "blow up
   * this doomed group rather than hand the enemy the kills" is exactly the
   * situation it exists for. `RepairSell.selfDestruct` refuses every other
   * entity kind, so structures are filtered out here rather than offered a
   * button that would be ignored.
   *
   * THE LATCH IS TIMED AND IT IS TIED TO THE SELECTION. `destructArmedFor`
   * holds the entity the arming click was about; changing the selection drops
   * the arm on the next frame, which is what stops "arm, click elsewhere, click
   * again" from scuttling a group the player never meant.
   */
  private fillSelfDestruct(): void {
    const action = this.view.selfDestruct;
    const sel = this.world.selection;
    const store = this.world.store;
    const local = this.world.localPlayer as number;

    let count = 0;
    for (let k = 0; k < sel.count; k++) {
      const i = store.index(sel.ids[k] as EntityId);
      if (i < 0 || store.owner[i] !== local) continue;
      if ((store.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      const kind = store.kind[i];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
      count++;
    }

    if (count === 0) {
      action.visible = false;
      this.disarmSelfDestruct();
      return;
    }

    // The arm is dropped when the selection moves off what it was armed for,
    // or when its own clock runs out. Both are checked here rather than on the
    // click, so the button cannot sit armed on screen past either.
    const anchor = sel.count > 0 ? (sel.ids[0] as number) : 0;
    if (this.destructArmedFor !== 0
      && (this.destructArmedFor !== anchor || this.time > this.destructArmedUntil)) {
      this.disarmSelfDestruct();
    }

    const armed = this.destructArmedFor !== 0;
    action.visible = true;
    action.count = count;
    action.armed = armed;
    action.hint = armed
      ? `Click again to destroy ${count === 1 ? 'this unit' : `all ${count} units`} — there is no undo`
      : count === 1
        ? 'Destroy this unit. It explodes and splashes whatever is beside it.'
        : `Destroy all ${count} selected units. They explode where they stand.`;
  }

  private disarmSelfDestruct(): void {
    this.destructArmedFor = 0;
    this.destructArmedUntil = -1e9;
  }

  /**
   * Arm, then scuttle.
   *
   * The first click latches and the SECOND one issues, one
   * `CommandKind.SelfDestruct` per unit, because `issueSelfDestruct` addresses
   * exactly one target and the sim resolves each independently. The ids are
   * copied into scratch BEFORE the loop: `issueSelfDestruct` does not touch the
   * selection, but the sequence "read the live selection while issuing commands
   * against it" is precisely the shape of the superweapon race, and it costs
   * one `Int32Array` copy to make it impossible.
   */
  private selfDestructSelection(): void {
    const action = this.view.selfDestruct;
    if (!action.visible) return;

    const sel = this.world.selection;
    const anchor = sel.count > 0 ? (sel.ids[0] as number) : 0;

    if (this.destructArmedFor === 0) {
      this.destructArmedFor = anchor;
      this.destructArmedUntil = this.time + SELF_DESTRUCT_CONFIRM_SECONDS;
      this.toast(
        'warn', 'destruct', 'Self-Destruct',
        `Click again within ${SELF_DESTRUCT_CONFIRM_SECONDS}s to confirm`,
      );
      return;
    }

    const store = this.world.store;
    const local = this.world.localPlayer as number;
    let n = 0;
    for (let k = 0; k < sel.count && n < this.destructIds.length; k++) {
      const i = store.index(sel.ids[k] as EntityId);
      if (i < 0 || store.owner[i] !== local) continue;
      if ((store.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      const kind = store.kind[i];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
      this.destructIds[n++] = sel.ids[k];
    }
    this.disarmSelfDestruct();
    if (n === 0) { this.soundHook?.('error'); return; }

    for (let k = 0; k < n; k++) {
      this.channels.commands.issueSelfDestruct(
        this.world.localPlayer, this.destructIds[k] as EntityId,
      );
    }
    this.toast(
      'alert', 'destruct', 'Self-Destruct',
      n === 1 ? 'Unit destroyed' : `${n} units destroyed`,
    );
  }

  /* ------------------------------------------------------------------ */
  /* commander powers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Rebuild the power bar.
   *
   * POLLED, unlike the superweapon countdown, which the service PUSHES. There
   * is nothing to push here: `CommanderPowerService` has no HUD hook and adding
   * one would be a sim change to publish a number the service is already happy
   * to be asked for. Two reads per owned power per frame is five multiplies and
   * five comparisons, and the bar's own signature gate quantises the countdown
   * to whole seconds, so a charging power still writes DOM once a second.
   *
   * OWNERSHIP IS SIMULATION STATE and is read straight off the local player's
   * `commanderPowerMask`. It used to be a profile question answered here
   * because the simulation was forbidden to ask it; both halves of that changed
   * in v2.6.0, and the consequence for this function is that the bar and
   * `CommanderPowerService.use` now read the SAME bit. A row can no longer
   * appear for a power the simulation would refuse, which is the failure mode
   * the old arrangement could only avoid by agreeing with itself.
   */
  /** True when this tab is not on screen. Reads whichever snapshot is live. */
  private tabHidden(tab: BuildTab): boolean {
    const snap = this.production?.snapshot ?? this.localSnapshot;
    return snap.tabVisible[tab as number] === false;
  }

  private fillPowers(): void {
    const seam = commanderPowerSeam();
    const player = this.world.localPlayer;
    const me = this.world.players[player as number];
    if (seam === null || me === undefined) { this.powers.count = 0; return; }

    const owned = powersOwnedBy(me, this.ownedPowers);
    const rows = this.powers.rows;
    const n = Math.min(owned.length, rows.length);

    for (let i = 0; i < n; i++) {
      const spec = owned[i];
      const row = rows[i];
      row.key = spec.key;
      row.id = spec.id as number;
      row.label = spec.label;
      row.hint = spec.hint;
      row.icon = POWER_ICONS[spec.id as number] ?? 'superweapon';
      row.remaining = Math.max(0, seam.chargeSecondsOf(player, spec.id as number));
      row.total = spec.chargeSeconds > 0 ? spec.chargeSeconds : 1;
      row.ready = seam.isReady(player, spec.id as number);
      row.armed = this.armedPowerId === (spec.id as number);
    }
    this.powers.count = n;

    // A power that stopped being ready while it was on the cursor — the only
    // way that happens is a `dispose` between frames — must not leave a reticle
    // armed for something that can no longer be called.
    if (this.armedPowerId !== 0) {
      let stillThere = false;
      for (let i = 0; i < n; i++) {
        if (rows[i].id === this.armedPowerId && rows[i].ready) { stillThere = true; break; }
      }
      if (!stillThere) this.armedPowerId = 0;
    }
  }

  /**
   * A click on a power row: put the targeting cursor up.
   *
   * IT DOES NOT CALL THE POWER, and it deliberately has no way to. Arming sets
   * `armedPowerId`; `src/input/input.system.ts` reads it off `__vmHud` on the
   * next ground click and issues `CommandKind.UsePower` through
   * `channels.commands`, which the ONE Phase.Command drain resolves. That is
   * the discipline `armSuperweapon` follows, for the reason recorded on
   * `CommandKind.Relocate` in `core/types.ts`, and there is a second reason
   * here: writing sim state from a DOM event races the command it just issued.
   */
  private armPower(key: string): void {
    let row: CommanderPowerRow | null = null;
    for (let i = 0; i < this.powers.count; i++) {
      if (this.powers.rows[i].key === key) { row = this.powers.rows[i]; break; }
    }
    if (row === null) return;

    // Already armed: a second click on the same row is "put the cursor away",
    // which is what a player who changed their mind reaches for first.
    if (this.armedPowerId === row.id) {
      this.armedPowerId = 0;
      row.armed = false;
      return;
    }
    if (!row.ready) {
      this.soundHook?.('error');
      this.toast('warn', `power:${key}`, row.label, `Ready in ${formatClock(row.remaining)}`);
      return;
    }
    // One armed thing at a time. A superweapon reticle and a power reticle on
    // the same cursor is two commands for one click.
    superweaponSeam()?.cancelArm();
    this.armedPowerId = row.id;
    row.armed = true;
    this.toast('info', `power:${key}`, row.label, 'Pick a target on the map');
  }

  /**
   * The `CommanderPowerId` on the cursor, or 0. Read by `src/input` off
   * `__vmHud`, exactly as `armedMode` is.
   */
  get armedPower(): number { return this.armedPowerId; }

  /** Drop the armed power. Right-click and Escape both reach this from input. */
  cancelArmedPower(): boolean {
    if (this.armedPowerId === 0) return false;
    this.armedPowerId = 0;
    return true;
  }

  /**
   * Call the armed power at a world point. Returns false when nothing was armed.
   *
   * THE ONLY PLACE A POWER IS CALLED, and it puts one command on the bus and
   * writes no simulation state whatsoever. Disarms first, so a command that the
   * sim later refuses cannot leave the cursor armed for a second attempt the
   * player did not ask for.
   */
  firePowerAt(x: number, z: number): boolean {
    const id = this.armedPowerId;
    if (id === 0) return false;
    this.armedPowerId = 0;
    const spec = COMMANDER_POWERS[id];
    this.channels.commands.issueUsePower(this.world.localPlayer, id, x, z);
    if (spec !== undefined) {
      this.toast('info', `power:${spec.key}`, spec.label, spec.hint);
    }
    return true;
  }

  /**
   * Fire the selected commander's ability.
   *
   * Through `channels.commands` as an ordinary Order, exactly as a move or an
   * attack goes — which is the whole reason `OrderKind.UseAbility` exists
   * rather than a direct call into the service. The AI issues the same command,
   * and #57's replay log records one thing rather than two.
   */
  private useSelectedAbility(): void {
    const sel = this.world.selection;
    if (sel.count !== 1) return;
    const action = this.view.ability;
    if (!action.visible) return;
    if (!action.enabled) {
      this.soundHook?.('error');
      this.toast('warn', 'ability', action.label, `Ready in ${Math.ceil(action.cooldown)}s`);
      return;
    }
    const store = this.world.store;
    const idx = store.index(sel.ids[0] as EntityId);
    if (idx < 0) return;
    this.channels.commands.issueOrder(
      this.world.localPlayer, OrderKind.UseAbility, sel.ids, 1,
      store.posX[idx], store.posZ[idx],
    );
    this.toast('info', 'ability', action.label, action.hint);
  }

  /* ------------------------------------------------------------------ */
  /* superweapons                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Publish or refresh one superweapon countdown.
   *
   * PUSHED, NOT POLLED, and that is the whole reason the HUD needs no import of
   * the sim to show a timer: `Superweapons.pushHud` calls this on
   * `globalThis.__vmHud` three ticks out of ten for every weapon the local
   * player can field, and calls `clearSuperweapon` for every one it cannot.
   * With no sim registered nothing ever calls either and the dock stays empty,
   * which is the correct headless answer.
   *
   * Rows are claimed by KEY and never re-sorted. A weapon that arrives second
   * takes the second slot and keeps it, so a countdown cannot slide sideways
   * under the cursor when its neighbour's structure is destroyed.
   */
  setSuperweapon(id: string, label: string, remaining: number, total: number): void {
    if (id === '') return;
    const rows = this.supers.rows;
    let slot = -1;
    for (let i = 0; i < this.supers.count; i++) {
      if (rows[i].key === id) { slot = i; break; }
    }
    if (slot < 0) {
      if (this.supers.count >= rows.length) return;
      slot = this.supers.count++;
    }
    const row = rows[slot];
    row.key = id;
    row.label = label;
    row.remaining = Math.max(0, remaining);
    row.total = total > 0 ? total : 1;
    row.ready = row.remaining <= 0;
    // Re-read every push rather than caching on the click: `cancelArm` can
    // happen from Escape, from a right-click and from the service itself, and
    // none of those three come back through this file.
    row.armed = superweaponSeam()?.armedKey === id;
  }

  /** Retire a countdown — the structure is gone, or was never built. */
  clearSuperweapon(id: string): void {
    const rows = this.supers.rows;
    for (let i = 0; i < this.supers.count; i++) {
      if (rows[i].key !== id) continue;
      const last = --this.supers.count;
      // Compact by shifting, not by swapping with the tail: the order is what
      // keeps a live row under the cursor it was under last frame.
      for (let k = i; k < last; k++) {
        const a = rows[k];
        const b = rows[k + 1];
        a.key = b.key; a.label = b.label; a.remaining = b.remaining;
        a.total = b.total; a.ready = b.ready; a.armed = b.armed;
      }
      rows[last].key = '';
      rows[last].label = '';
      rows[last].ready = false;
      rows[last].armed = false;
      // The armed weapon just vanished from under the cursor. Put the cursor
      // back rather than leaving a reticle for a silo that no longer exists.
      const seam = superweaponSeam();
      if (seam !== null && seam.armedKey === id) seam.cancelArm();
      return;
    }
  }

  /**
   * A click on a countdown row: put the targeting cursor up.
   *
   * IT DOES NOT FIRE, and it deliberately has no way to. Arming installs the
   * service's own pointer listener; the click on the ground that follows issues
   * `OrderKind.UseAbility` on the silo through `channels.commands`, and the
   * simulation resolves it at Phase.Production. That is the same discipline
   * `useSelectedAbility` above follows and for the same reason — see the
   * comment on `CommandKind.Relocate` in `core/types.ts`. A HUD that called
   * `fireAt` directly would be invisible to the replay recorder and to the
   * multiplayer link, which is exactly the bug that comment exists to record.
   */
  private armSuperweapon(key: string): void {
    let row: SuperweaponRow | null = null;
    for (let i = 0; i < this.supers.count; i++) {
      if (this.supers.rows[i].key === key) { row = this.supers.rows[i]; break; }
    }
    if (row === null) return;

    const seam = superweaponSeam();
    if (seam === null) {
      this.soundHook?.('error');
      return;
    }
    // Already armed: a second click on the same row is "put the cursor away",
    // which is what a player who changed their mind reaches for first.
    if (seam.armedKey === key) {
      seam.cancelArm();
      row.armed = false;
      return;
    }
    if (!row.ready) {
      this.soundHook?.('error');
      this.toast('warn', `super:${key}`, row.label, `Ready in ${formatClock(row.remaining)}`);
      return;
    }
    if (!seam.arm(key)) {
      this.soundHook?.('error');
      this.toast('warn', `super:${key}`, row.label, 'Cannot fire right now');
      return;
    }
    // ONE ARMED THING AT A TIME, and this is the half `armPower` cannot do for
    // itself. A power and a superweapon are armed by different owners — the
    // power by this file, the superweapon by `sim/Superweapons.ts`'s own
    // pointer handler — so with both live the next ground click would be read
    // twice: once by `applyArmedPower` in input, once by the service. The power
    // yields, because the player's most recent gesture was this row.
    this.armedPowerId = 0;
    row.armed = true;
    this.toast('info', `super:${key}`, row.label, 'Pick a target on the map');
  }

  /** Armour / damage / range / speed for the primary entity. */
  private fillStats(idx: number): void {
    const store = this.world.store;
    const view = this.view;

    const armour = store.armorClass[idx];
    view.armour = ARMOUR_NAMES[armour] ?? ARMOUR_NAMES[ArmorClass.Light];
    view.speed = store.maxSpeed[idx] > 0 ? `${formatStat(store.maxSpeed[idx])} m/s` : '';

    const w = this.weaponOf(idx);
    if (w === null) {
      view.damage = '';
      view.range = '';
      return;
    }
    // Damage per SECOND, not per shot: a burst weapon and a single-shot weapon
    // with the same per-shot number are not remotely comparable, and DPS is the
    // question the player is actually asking.
    const shots = Math.max(1, w.burstCount);
    const cycle = Math.max(0.05, w.cooldown + (shots - 1) * w.burstDelay);
    view.damage = `${formatStat((w.damage * shots) / cycle)} dps`;
    view.range = `${formatStat(w.range)} m`;
  }

  private weaponOf(idx: number): WeaponDef | null {
    if (this.tables === null) return null;
    const wi = this.world.store.weaponIndex[idx];
    if (wi < 0 || wi >= this.tables.weapons.length) return null;
    return this.tables.weapons[wi];
  }

  /** Content key, display name, role line and icon for one entity slot. */
  private describe(idx: number): { key: string; name: string; role: string; icon: IconName } {
    const store = this.world.store;
    const kind = store.kind[idx] as EntityKind;
    const handle = store.handleOf(idx);

    // Production knows exactly what it built. Ask it first.
    const entry = this.production?.entryOf(handle) ?? null;
    if (entry !== null) {
      return {
        key: entry.key,
        name: entry.name,
        role: entry.blurb,
        icon: iconForUnitKey(entry.key, entry.name, kind),
      };
    }

    // Otherwise resolve through the def tables by the raw def index.
    const defId = store.defId[idx];
    if (this.tables !== null && defId >= 0) {
      if (kind === EntityKind.Building) {
        const d = this.tables.buildings[defId];
        if (d !== undefined) {
          return { key: d.key, name: d.name, role: d.blurb, icon: iconForUnitKey(d.key, d.name, kind) };
        }
      } else {
        const d: UnitDef | undefined = this.tables.units[defId];
        if (d !== undefined) {
          return { key: d.key, name: d.name, role: d.blurb, icon: iconForUnitKey(d.key, d.name, kind) };
        }
      }
    }

    // Last resort: a class name, which is still better than an empty card.
    const name = kind === EntityKind.Building
      ? 'Structure' : kind === EntityKind.Infantry ? 'Infantry' : 'Vehicle';
    return { key: '', name, role: '', icon: iconForUnitKey('', '', kind) };
  }

  /** Content key of a spawned entity, when the scenario module published one. */
  private entityKeyOf: ((id: EntityId) => string) | null = null;

  private keyOf(index: number): string {
    if (this.entityKeyOf === null) return '';
    return this.entityKeyOf(this.world.store.handleOf(index));
  }

  /** Wired by hud.system.ts once `src/game/Scenarios.ts` has loaded. */
  setEntityKeyResolver(fn: (id: EntityId) => string): void {
    this.entityKeyOf = fn;
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * The world view in client px: the full frame minus the bottom dock band.
   * Measured on resize only — never per frame, because reading
   * `getBoundingClientRect` inside the frame loop forces a synchronous layout.
   */
  private playfield(): { x: number; y: number; w: number; h: number } {
    return {
      x: 0,
      y: 0,
      w: Math.max(1, this.lastW),
      h: Math.max(1, this.dockTop > 0 ? this.dockTop : this.lastH),
    };
  }

  private resize(force: boolean): void {
    const w = this.handle.size.cssWidth;
    const h = this.handle.size.cssHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!force && w === this.lastW && h === this.lastH && dpr === this.dpr) return;

    this.lastW = w;
    this.lastH = h;
    this.dpr = dpr;
    this.uiScale = computeUiScale(h);

    // One design unit. Every dimension in hud.css is a multiple of it.
    this.root.style.setProperty('--vm-u', `${this.uiScale}px`);

    /* WHICH IS WHY THE NEXT LINE IS HERE AND NOT IN A MEDIA QUERY. Every width
     * in the HUD is a multiple of the unit above, and that unit comes from the
     * viewport's HEIGHT — so "does the top row fit" is a question about
     * `w / uiScale`, and CSS cannot ask it. See SECTION 2B. This runs on resize
     * only: the early return at the head of this method is what keeps it out of
     * the frame path, since `frame()` calls `resize(false)` every tick. */
    this.root.dataset.topFit = topRowFit(w / this.uiScale);

    this.overlay.resize(w, h, dpr, this.uiScale);

    const mapRect = this.sidebar.minimapField.getBoundingClientRect();
    this.minimap.resize(
      mapRect.width > 0 ? mapRect.width : 150 * this.uiScale,
      mapRect.height > 0 ? mapRect.height : 150 * this.uiScale,
      dpr,
    );

    const dockRect = this.sidebar.mapDock.getBoundingClientRect();
    this.dockTop = dockRect.height > 0 ? dockRect.top : h;
  }

  /**
   * Fraction of the frame the bottom band occupies. The bible §9 wants 12-16%.
   *
   * WHAT THIS NUMBER IS AND IS NOT. It is the full-width band from the top of
   * the map dock to the bottom of the frame — nothing else. It does not count
   * the resource strip, the objectives panel, the perf overlay or the toasts,
   * and it counts the whole width of the band even where the docks do not
   * reach across it. It is quoted against the §9 ceiling anyway because it is
   * the number every previous measurement in this repo used, and changing what
   * it means would make this change incomparable with the ones before it.
   *
   * `hudCoverage()` is the honest one. Read both.
   */
  hudFrameShare(): number {
    if (this.lastW <= 0 || this.lastH <= 0) return 0;
    const band = Math.max(0, this.lastH - this.dockTop);
    return (band * this.lastW) / (this.lastW * this.lastH);
  }

  /**
   * Fraction of the frame that actually has an opaque HUD panel over it.
   *
   * The union of every `.vm-panel` in the interface, measured rather than
   * modelled — so it counts the objectives panel and the resource strip, which
   * `hudFrameShare()` does not, and it does NOT count the empty air between
   * the three bottom docks, which `hudFrameShare()` does.
   *
   * Approximated as the sum of the panel rectangles. The HUD's panels do not
   * overlap by construction (three docks in a row, a centred strip, two corner
   * panels), so the sum IS the union unless someone parks one panel on top of
   * another — which would be a layout bug this number would then over-report,
   * which is the right direction to be wrong in for a budget.
   *
   * Cold path: it reads layout, so it must never be called from `frame()`.
   */
  hudCoverage(): number {
    if (this.lastW <= 0 || this.lastH <= 0) return 0;
    const panels = this.root.querySelectorAll('.vm-panel');
    let area = 0;
    for (let i = 0; i < panels.length; i++) {
      const node = panels[i];
      if (!(node instanceof HTMLElement) || node.hidden) continue;
      const r = node.getBoundingClientRect();
      area += Math.max(0, r.width) * Math.max(0, r.height);
    }
    return area / (this.lastW * this.lastH);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.toasts.dispose();
    this.minimap.dispose();
    this.overlay.dispose();
    this.sidebar.dispose();
    this.root.remove();
  }
}

/** Veterancy rank from an entity's flag word. */
function rankOf(flags: number): number {
  if ((flags & EntityFlag.Veteran2) !== 0) return 2;
  if ((flags & EntityFlag.Veteran1) !== 0) return 1;
  return 0;
}
