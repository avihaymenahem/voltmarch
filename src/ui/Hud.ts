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
import { MAX_SELECTION } from '../core/config';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import type { CameraRig } from '../render/camera';
import type { RendererHandle } from '../render/renderer';
// One statement of the self-repair rule, shared with the overlay. See the note
// on the import in `src/ui/Overlay.ts`.
import { isRegenerating } from '../sim/Regen';

import {
  SEMANTIC,
  ToastStack,
  applyTheme,
  computeUiScale,
  el,
  formatCost,
  formatStat,
  type ToastKind,
} from './Chrome';
import { Minimap, type TerrainSampler } from './Minimap';
import { Overlay } from './Overlay';
import {
  SLOT_HOTKEY_CODES,
  Sidebar,
  TAB_HOTKEY_CODES,
  powerStateOf,
  type AdviceKind,
  type ArmedMode,
  type BuildExtras,
  type HudSoundCue,
  type HudTelemetry,
  type SelectionCard,
  type SelectionView,
} from './Sidebar';
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
  ru('soviet_flak', 'Flak Trooper', 'Anti-air infantry.', 300, 5, BuildTab.Infantry, ['barracks'], Faction.Soviets),
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
};

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
  entryOf(id: EntityId): { key: string; name: string; blurb: string; buildTime: number; power: number } | null;
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
  private readonly localPool: HudCameo[][] = [[], [], [], []];
  private localTab: BuildTab = BuildTab.Structures;

  /** The grid the local snapshot renders: catalog rows when reachable. */
  private readonly gridRows: GridRow[][] = [[], [], [], []];
  private gridFaction = -1;
  private gridFromCatalog = false;
  /** content key -> display name, for the "Requires X" sentence. */
  private readonly keyNames = new Map<string, string>();

  /** Pooled telemetry. Rebuilt in place; never handed out. */
  private readonly telemetry: HudTelemetry = {
    army: 0, structures: 0, incomePerMin: 0,
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
      callbacks: {
        selectTab: (tab) => this.selectTab(tab),
        activate: (tab, cameo) => this.onSlotActivate(tab, cameo),
        cancel: (tab, cameo) => this.onSlotCancel(tab, cameo),
        setArmed: () => { /* the panel already applied the visual state */ },
        focusCard: (id) => this.focusEntity(id),
        setStance: (stance) => this.stanceSelection(stance),
        relocate: () => this.relocateSelection(),
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
      cameos: [[], [], [], []],
      tabAlert: [false, false, false, false],
      selectionCount: 0,
      selectionPrimary: 0 as EntityId,
      gameTimeSec: 0,
      matchPhase: MatchPhase.Playing,
    };

    const cards: SelectionCard[] = [];
    for (let i = 0; i < MAX_SELECTION; i++) {
      cards.push({ id: 0, icon: 'tank', name: '', hpFrac: 1, veterancy: 0, stack: 1, primary: false });
    }
    this.view = {
      count: 0, title: '', subtitle: '', veterancy: 0,
      cards, cardCount: 0,
      hpFrac: 1, hpText: '', mending: false,
      stance: -1, stanceEnabled: false,
      relocate: { visible: false, enabled: false, cost: 0, hint: '', armed: false },
      armour: '', damage: '', range: '', speed: '',
    };

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
      this.minimap.ping(e.x, e.z, !mine);
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
  }

  setSoundHook(fn: ((cue: HudSoundCue) => void) | null): void {
    this.soundHook = fn;
  }

  /** Raise an event chip. Public so any module can post one. */
  toast(kind: ToastKind, key: string, title: string, detail = ''): void {
    this.toasts.push(kind, key, title, detail);
  }

  /* ------------------------------------------------------------------ */
  /* slot actions                                                        */
  /* ------------------------------------------------------------------ */

  private selectTab(tab: BuildTab): void {
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

    const snap = this.snapshot();
    this.buildSelectionView();
    this.buildTelemetry(snap, dt);

    this.sidebar.setRadarOnline(snap.hasRadar);
    this.sidebar.update(snap, this.view, this.telemetry, dt);
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

    for (let t = 0; t < BUILD_TAB_COUNT; t++) this.fillLocalTab(p, t as BuildTab);
    return snap;
  }

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
          defId: -1, isBuilding: false, key: '', name: '', cost: 0,
          progress: 0, queued: 0, ready: false, onHold: false, available: true, reason: '',
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
    const entry = this.production?.catalog.byKey(key) ?? null;
    if (entry !== null) {
      return {
        buildTimeSec: entry.buildTime,
        powerDelta: entry.power,
        blurb: entry.blurb,
        prereq: this.prereqSentence(entry.prereqs),
      };
    }
    const row = FALLBACK_ROSTER.find((r) => r.key === key && r.faction === this.faction)
      ?? FALLBACK_ROSTER.find((r) => r.key === key);
    if (row === undefined) return { buildTimeSec: 0, powerDelta: 0, blurb: '', prereq: '' };
    return {
      buildTimeSec: row.buildTime,
      powerDelta: row.power,
      blurb: row.blurb,
      prereq: this.prereqSentence(row.prereqs),
    };
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
      if (!mending && isRegenerating(store, idx, now)) mending = true;

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
