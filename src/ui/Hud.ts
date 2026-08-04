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

import {
  SEMANTIC,
  ToastStack,
  applyTheme,
  computeUiScale,
  el,
  formatStat,
  type ToastKind,
} from './Chrome';
import { Minimap, type TerrainSampler } from './Minimap';
import { Overlay } from './Overlay';
import {
  Sidebar,
  type ArmedMode,
  type BuildExtras,
  type HudSoundCue,
  type SelectionCard,
  type SelectionView,
} from './Sidebar';
import { iconForUnitKey, makeIcon, type IconName } from './icons';

import './hud.css';

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

/** EVA line -> a toast. Anything not listed here stays audio-only. */
const EVA_TOASTS: Readonly<Record<number, readonly [ToastKind, string]>> = {
  [EvaLine.ConstructionComplete]: ['good', 'Construction complete'],
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

interface ProductionSeam {
  readonly snapshot: HudSnapshot;
  setActiveTab(tab: BuildTab): void;
  clearTabAlert(tab: BuildTab): void;
  entryOf(id: EntityId): { key: string; name: string; blurb: string; buildTime: number; power: number } | null;
  catalog: { byKey(key: string): { buildTime: number; power: number; blurb: string } | null };
}

/** The placement controller, reached the same way `src/input` reaches it. */
interface PlacementSeam {
  readonly active: boolean;
  begin(defId: number): boolean;
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

  /** Pooled fallback snapshot. Only used while `production` is null. */
  private readonly localSnapshot: HudSnapshot;
  private readonly localPool: HudCameo[][] = [[], [], [], []];
  private localTab: BuildTab = BuildTab.Structures;

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
      stance: -1, stanceEnabled: false,
      armour: '', damage: '', range: '', speed: '',
    };

    this.sidebar.setExtrasProvider((key) => this.extrasFor(key));
    this.minimap.onJumpRequest((x, z) => this.cameraRig.setFocus(x, z, false));

    this.subscribe();
    this.resize(true);
    this.sidebar.resetCredits(local !== undefined ? local.credits : 0);
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
    }));

    this.unsubs.push(bus.on('combat:underAttack', (e) => {
      const mine = isLocal(e.player);
      this.minimap.ping(e.x, e.z, !mine);
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

    this.sidebar.setRadarOnline(snap.hasRadar);
    this.sidebar.update(snap, this.view, dt);
    this.minimap.frame(this.time, dt);
    this.overlay.frame(dt);
    this.toasts.frame(dt);
  }

  /* ------------------------------------------------------------------ */
  /* snapshot                                                            */
  /* ------------------------------------------------------------------ */

  /** The live snapshot, or the fallback one refreshed in place. */
  private snapshot(): HudSnapshot {
    if (this.tryBindProduction()) return this.production!.snapshot;

    const snap = this.localSnapshot;
    const p = this.world.players[this.world.localPlayer as number];
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

    for (let t = 0; t < BUILD_TAB_COUNT; t++) this.fillFallbackTab(p, t as BuildTab);
    return snap;
  }

  private fillFallbackTab(p: PlayerState, tab: BuildTab): void {
    const pool = this.localPool[tab as number];
    const out = this.localSnapshot.cameos[tab as number];
    out.length = 0;
    let n = 0;

    for (const row of FALLBACK_ROSTER) {
      if (row.tab !== tab) continue;
      if (row.faction !== Faction.Neutral && row.faction !== p.faction) continue;

      let c = pool[n];
      if (c === undefined) {
        c = {
          defId: -1, isBuilding: false, key: '', name: '', cost: 0,
          progress: 0, queued: 0, ready: false, onHold: false, available: true, reason: '',
        };
        pool.push(c);
      }
      n++;

      // Without def tables the only id space in the building is this index.
      c.defId = FALLBACK_ROSTER.indexOf(row);
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
        const named = FALLBACK_ROSTER.find((r) => r.key === req && r.faction === p.faction);
        reason = `Requires ${named !== undefined ? named.name : req}`;
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
      return { buildTimeSec: entry.buildTime, powerDelta: entry.power, blurb: entry.blurb };
    }
    const row = FALLBACK_ROSTER.find((r) => r.key === key && r.faction === this.faction)
      ?? FALLBACK_ROSTER.find((r) => r.key === key);
    if (row === undefined) return { buildTimeSec: 0, powerDelta: 0, blurb: '' };
    return { buildTimeSec: row.buildTime, powerDelta: row.power, blurb: row.blurb };
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
      return;
    }

    this.groupKeys.length = 0;
    this.groupFirst.length = 0;
    this.groupCount.length = 0;
    this.groupHp.length = 0;

    let stance = -2;
    let anyMobile = false;
    let allBuildings = true;

    for (let i = 0; i < sel.count; i++) {
      const idx = store.index(sel.ids[i] as EntityId);
      if (idx < 0) continue;

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

  /** Fraction of the frame the HUD occupies. The bible §9 wants 12-16%. */
  hudFrameShare(): number {
    if (this.lastW <= 0 || this.lastH <= 0) return 0;
    const band = Math.max(0, this.lastH - this.dockTop);
    return (band * this.lastW) / (this.lastW * this.lastH);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
