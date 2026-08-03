/**
 * ============================================================================
 * RED ALERT — src/ui/Hud.ts
 * ============================================================================
 * The HUD's owner. Assembles the sidebar, the radar, the world overlay, the
 * command bar and the superweapon readout; builds the `HudSnapshot` the
 * sidebar renders; and translates every click into a `Command` on the bus.
 *
 * WHAT THIS FILE IS CAREFUL ABOUT
 * ------------------------------
 * 1. **It has no hard dependency on any sibling module.** Def tables, unit
 *    models and terrain are all resolved through `import()` inside `init()`,
 *    each in its own try/catch. If the data module never lands, the sidebar
 *    runs off a built-in catalogue; if the art module never lands, the cameos
 *    are procedural dioramas; if terrain never lands, the radar paints a flat
 *    field. Nothing in here can take the interface down.
 *
 * 2. **It never writes state another module owns** — except in the one case
 *    documented at `localProduction`, which self-disables the instant a real
 *    production system is registered.
 *
 * 3. **Zero allocation per frame.** The snapshot, its four cameo arrays and
 *    every `HudCameo` inside them are pooled and mutated in place.
 *
 * PUBLIC HOOKS FOR THE MODULES THAT LAND AFTER ME
 * -----------------------------------------------
 *   hud.overlay.setMarquee(x0,y0,x1,y1) / clearMarquee()   input: drag select
 *   hud.armedMode                                          input: repair/sell cursor
 *   hud.waypointMode / hud.formationMove                   input: order modifiers
 *   hud.onPlaceRequest = (defId, key) => {}                input/placement
 *   hud.setSuperweapon(id, label, remaining, total)        superweapons
 *   hud.overlay.floater(x,y,z,text,color)                  anyone
 *   hud.setSoundHook(fn)                                   audio
 * Also published as `globalThis.__raHud` for the console and the harness.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  CELL,
  HUD_COMMAND_BAR,
  HUD_SUPERWEAPON,
  FACTION_PALETTE,
  MAP_CELLS,
  TERRAIN_MAX_HEIGHT,
} from '../core/config';
import {
  BuildTab,
  BUILD_TAB_COUNT,
  EntityFlag,
  EntityKind,
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
  type SimContext,
} from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import type { CameraRig } from '../render/camera';
import type { RendererHandle } from '../render/renderer';
import type { SceneRig } from '../render/scene';
// One constant, no runtime coupling: the id space the sidebar speaks in.
import { UNIT_PUBLIC_ID_BASE } from '../sim/Production';

import {
  CameoRenderer,
  primeCameoPrototype,
  theatreFor,
  type CameoSubject,
  type ModelProvider,
} from './Cameos';
import { Minimap, type TerrainSampler } from './Minimap';
import { Overlay } from './Overlay';
import { Sidebar, type ArmedMode, type CameoCell, type CameoExtras, type HudSoundCue } from './Sidebar';
import {
  computeUiScale,
  el,
  factionKey,
  formatClock,
  makeGlyph,
  sidebarWidthPx,
  textNode,
  type GlyphName,
} from './Chrome';

import './hud.css';

/* ==========================================================================
 * SECTION 1 — THE CATALOGUE
 *
 * One row per buildable. Sourced from the real def tables when they exist and
 * from FALLBACK_CATALOGUE when they do not, so the sidebar is never an empty
 * grid waiting on another agent.
 * ========================================================================== */

interface CatalogEntry {
  key: string;
  name: string;
  blurb: string;
  cost: number;
  buildTime: number;
  power: number;
  tab: BuildTab;
  isBuilding: boolean;
  /** Index into the def tables, or -1 when running off the fallback. */
  defId: number;
  sortOrder: number;
  prereqs: readonly string[];
  footprintW: number;
  footprintH: number;
  faction: Faction;
}

/**
 * The built-in roster. Keys match the content vocabulary `src/game/Scenarios.ts`
 * publishes and the model keys `src/art/UnitDefs.ts` builds, so cameos resolve
 * to real meshes for units the moment the art module is present. Costs and
 * build times are RA-typical and are replaced wholesale by the real tables.
 */
const FALLBACK_CATALOGUE: readonly Omit<CatalogEntry, 'defId'>[] = [
  /* -- Allied structures ------------------------------------------------ */
  b('conyard', 'Construction Yard', 'Unpacks from an MCV. Everything starts here.', 2500, 20, -0, BuildTab.Structures, 0, [], 3, 3, Faction.Allies),
  b('power', 'Power Plant', 'Supplies the base. Build these before you need them.', 800, 8, +100, BuildTab.Structures, 1, ['conyard'], 2, 2, Faction.Allies),
  b('refinery', 'Ore Refinery', 'Processes ore and ships with a free miner.', 2000, 18, -30, BuildTab.Structures, 2, ['power'], 3, 3, Faction.Allies),
  b('barracks', 'Barracks', 'Trains infantry.', 500, 7, -20, BuildTab.Structures, 3, ['power'], 2, 2, Faction.Allies),
  b('warfactory', 'War Factory', 'Builds vehicles.', 2000, 16, -30, BuildTab.Structures, 4, ['refinery'], 3, 3, Faction.Allies),
  b('radar', 'Airfield Command', 'Brings the radar online.', 1000, 10, -50, BuildTab.Structures, 5, ['refinery'], 2, 2, Faction.Allies),
  b('silo', 'Ore Silo', 'Stores 1500 credits of unprocessed ore.', 150, 4, -10, BuildTab.Structures, 6, ['refinery'], 2, 2, Faction.Allies),
  b('lab', 'Battle Lab', 'Unlocks the top of the tech tree.', 2000, 20, -100, BuildTab.Structures, 7, ['radar'], 2, 2, Faction.Allies),

  /* -- Allied defences --------------------------------------------------- */
  b('wall', 'Fortress Wall', 'Cheap, blocks vehicles, does not stop a shell.', 100, 2, 0, BuildTab.Defense, 0, ['conyard'], 1, 1, Faction.Allies),
  b('pillbox', 'Pillbox', 'Anti-infantry emplacement.', 400, 5, -10, BuildTab.Defense, 1, ['barracks'], 1, 1, Faction.Allies),
  b('patriot', 'Patriot Missiles', 'Anti-air battery.', 1000, 9, -50, BuildTab.Defense, 2, ['radar'], 1, 1, Faction.Allies),
  b('prismtower', 'Prism Tower', 'Refracting beam tower. Chains to its neighbours.', 1500, 12, -75, BuildTab.Defense, 3, ['lab'], 1, 1, Faction.Allies),

  /* -- Allied infantry --------------------------------------------------- */
  u('allied_rifle', 'Peacekeeper', 'Line infantry. Cheap, numerous, crushable.', 200, 4, BuildTab.Infantry, 0, ['barracks'], Faction.Allies),
  u('allied_engineer', 'Engineer', 'Captures structures and mends damage.', 500, 6, BuildTab.Infantry, 1, ['barracks'], Faction.Allies),

  /* -- Allied vehicles --------------------------------------------------- */
  u('allied_harvester', 'Chrono Miner', 'Mines ore. The economy is this unit.', 1400, 12, BuildTab.Vehicles, 0, ['refinery'], Faction.Allies),
  u('allied_dozer', 'Construction Dozer', 'Mobile builder for forward bases.', 900, 9, BuildTab.Vehicles, 1, ['warfactory'], Faction.Allies),
  u('allied_guardian', 'Guardian Tank', 'Main battle tank. Fast, thin armour.', 700, 8, BuildTab.Vehicles, 2, ['warfactory'], Faction.Allies),
  u('allied_ifv', 'Multigunner IFV', 'Weapon changes with its passenger.', 600, 7, BuildTab.Vehicles, 3, ['warfactory'], Faction.Allies),
  u('allied_prism', 'Prism Tank', 'Long-range beam armour. Fragile.', 1200, 13, BuildTab.Vehicles, 4, ['lab'], Faction.Allies),
  u('allied_destroyer', 'Assault Destroyer', 'Naval gun platform.', 1000, 11, BuildTab.Vehicles, 5, ['warfactory'], Faction.Allies),
  u('allied_vindicator', 'Vindicator', 'Ground-attack bomber.', 1200, 12, BuildTab.Vehicles, 6, ['radar'], Faction.Allies),

  /* -- Soviet structures -------------------------------------------------- */
  b('conyard', 'Construction Yard', 'Unpacks from an MCV. Everything starts here.', 2500, 20, 0, BuildTab.Structures, 0, [], 3, 3, Faction.Soviets),
  b('power', 'Tesla Reactor', 'Supplies the base.', 600, 7, +150, BuildTab.Structures, 1, ['conyard'], 2, 2, Faction.Soviets),
  b('refinery', 'Ore Refinery', 'Processes ore and ships with a free collector.', 2000, 18, -30, BuildTab.Structures, 2, ['power'], 3, 3, Faction.Soviets),
  b('barracks', 'Barracks', 'Trains infantry.', 500, 7, -20, BuildTab.Structures, 3, ['power'], 2, 2, Faction.Soviets),
  b('warfactory', 'War Factory', 'Builds vehicles.', 2000, 16, -30, BuildTab.Structures, 4, ['refinery'], 3, 3, Faction.Soviets),
  b('radar', 'Super Reactor', 'Brings the radar online.', 1000, 10, -50, BuildTab.Structures, 5, ['refinery'], 2, 2, Faction.Soviets),
  b('silo', 'Ore Silo', 'Stores 1500 credits of unprocessed ore.', 150, 4, -10, BuildTab.Structures, 6, ['refinery'], 2, 2, Faction.Soviets),
  b('lab', 'Battle Lab', 'Unlocks the top of the tech tree.', 2000, 20, -100, BuildTab.Structures, 7, ['radar'], 2, 2, Faction.Soviets),

  /* -- Soviet defences ---------------------------------------------------- */
  b('wall', 'Concrete Wall', 'Cheap, blocks vehicles.', 100, 2, 0, BuildTab.Defense, 0, ['conyard'], 1, 1, Faction.Soviets),
  b('pillbox', 'Sentry Gun', 'Anti-infantry emplacement.', 500, 5, -20, BuildTab.Defense, 1, ['barracks'], 1, 1, Faction.Soviets),
  b('patriot', 'Flak Cannon', 'Anti-air battery.', 1000, 9, -50, BuildTab.Defense, 2, ['radar'], 1, 1, Faction.Soviets),
  b('tesla', 'Tesla Coil', 'Needs power. Deletes infantry.', 1500, 12, -100, BuildTab.Defense, 3, ['lab'], 1, 1, Faction.Soviets),

  /* -- Soviet infantry ---------------------------------------------------- */
  u('soviet_conscript', 'Conscript', 'Line infantry. Very cheap.', 100, 3, BuildTab.Infantry, 0, ['barracks'], Faction.Soviets),
  u('soviet_flak', 'Flak Trooper', 'Anti-air infantry.', 300, 5, BuildTab.Infantry, 1, ['barracks'], Faction.Soviets),

  /* -- Soviet vehicles ---------------------------------------------------- */
  u('soviet_harvester', 'Ore Collector', 'Mines ore. The economy is this unit.', 1400, 12, BuildTab.Vehicles, 0, ['refinery'], Faction.Soviets),
  u('soviet_dozer', 'Sputnik Dozer', 'Mobile builder for forward bases.', 900, 9, BuildTab.Vehicles, 1, ['warfactory'], Faction.Soviets),
  u('soviet_rhino', 'Rhino Heavy Tank', 'Slow, heavy, and it wins the trade.', 900, 10, BuildTab.Vehicles, 2, ['warfactory'], Faction.Soviets),
  u('soviet_sickle', 'Sickle', 'Legged scout. Hops over obstacles.', 700, 8, BuildTab.Vehicles, 3, ['warfactory'], Faction.Soviets),
  u('soviet_v4', 'V4 Rocket Launcher', 'Siege artillery. Cannot defend itself.', 1400, 14, BuildTab.Vehicles, 4, ['radar'], Faction.Soviets),
  u('soviet_dreadnought', 'Dreadnought', 'Naval missile platform.', 1800, 16, BuildTab.Vehicles, 5, ['warfactory'], Faction.Soviets),
  u('soviet_mig', 'MiG Fighter', 'Interceptor.', 1200, 12, BuildTab.Vehicles, 6, ['radar'], Faction.Soviets),
];

function b(
  key: string, name: string, blurb: string, cost: number, buildTime: number, power: number,
  tab: BuildTab, sortOrder: number, prereqs: readonly string[], fw: number, fh: number, faction: Faction,
): Omit<CatalogEntry, 'defId'> {
  return { key, name, blurb, cost, buildTime, power, tab, isBuilding: true, sortOrder, prereqs, footprintW: fw, footprintH: fh, faction };
}

function u(
  key: string, name: string, blurb: string, cost: number, buildTime: number,
  tab: BuildTab, sortOrder: number, prereqs: readonly string[], faction: Faction,
): Omit<CatalogEntry, 'defId'> {
  return { key, name, blurb, cost, buildTime, power: 0, tab, isBuilding: false, sortOrder, prereqs, footprintW: 0, footprintH: 0, faction };
}

/**
 * Content key -> unit-model key. `src/game/Scenarios.ts` publishes the left
 * column and `src/art/UnitDefs.ts` builds the right one; nothing today maps
 * between them for the HUD, so the map lives here and misses degrade to the
 * procedural cameo rather than to nothing.
 */
const MODEL_ALIASES: Readonly<Record<string, readonly [string, string]>> = {
  // key            [allied model,          soviet model]
  rifle:            ['allied_rifle', 'soviet_conscript'],
  conscript:        ['allied_rifle', 'soviet_conscript'],
  engineer:         ['allied_engineer', 'allied_engineer'],
  flaktrooper:      ['soviet_flak', 'soviet_flak'],
  grizzly:          ['allied_guardian', 'soviet_rhino'],
  guardian:         ['allied_guardian', 'soviet_rhino'],
  rhino:            ['allied_guardian', 'soviet_rhino'],
  ifv:              ['allied_ifv', 'allied_ifv'],
  prism:            ['allied_prism', 'allied_prism'],
  sickle:           ['soviet_sickle', 'soviet_sickle'],
  v4:               ['soviet_v4', 'soviet_v4'],
  harvester:        ['allied_harvester', 'soviet_harvester'],
  miner:            ['allied_harvester', 'soviet_harvester'],
  dozer:            ['allied_dozer', 'soviet_dozer'],
  mcv:              ['allied_dozer', 'soviet_dozer'],
  destroyer:        ['allied_destroyer', 'soviet_dreadnought'],
  dreadnought:      ['allied_destroyer', 'soviet_dreadnought'],
  vindicator:       ['allied_vindicator', 'soviet_mig'],
  mig:              ['allied_vindicator', 'soviet_mig'],
};

/**
 * Content key -> structure-model key (`src/art/BuildingDefs.ts`). An empty
 * string means "this faction has no model for it yet" and drops the cameo to
 * the procedural diorama, which is the honest read for a defence the art
 * module has not authored.
 */
const BUILDING_MODEL_ALIASES: Readonly<Record<string, readonly [string, string]>> = {
  conyard:    ['allied_conyard', 'soviet_conyard'],
  power:      ['allied_power', 'soviet_power'],
  refinery:   ['allied_refinery', 'soviet_refinery'],
  barracks:   ['allied_barracks', 'soviet_barracks'],
  warfactory: ['allied_warfactory', 'soviet_warfactory'],
  radar:      ['allied_radar', 'soviet_radar'],
  lab:        ['allied_tech', 'soviet_tech'],
  techcentre: ['allied_tech', 'soviet_tech'],
  pillbox:    ['allied_pillbox', 'soviet_sentry'],
  sentry:     ['allied_pillbox', 'soviet_sentry'],
  patriot:    ['allied_aa', ''],
  aa:         ['allied_aa', ''],
  tesla:      ['', 'soviet_tesla'],
  teslacoil:  ['', 'soviet_tesla'],
};

/* ==========================================================================
 * SECTION 2 — THE HUD
 * ========================================================================== */

export interface HudOptions {
  mount: HTMLElement;
  world: World;
  channels: Channels;
  cameraRig: CameraRig;
  handle: RendererHandle;
  sceneRig: SceneRig;
  /** Ids of every registered sim system; used to detect a real production module. */
  simSystemIds: readonly string[];
  /** Biome/theatre name for the cameo backdrops. */
  theatre: string | null;
}

export class Hud {
  readonly root: HTMLElement;
  readonly sidebar: Sidebar;
  readonly minimap: Minimap;
  readonly overlay: Overlay;
  readonly cameos: CameoRenderer;

  /** Input reads these; the HUD only owns the toggle, never the gesture. */
  get armedMode(): ArmedMode { return this.sidebar.armedMode; }
  waypointMode = false;
  formationMove = false;

  /** Fired when a completed structure is ready to be placed on the map. */
  onPlaceRequest: ((defId: number, key: string) => void) | null = null;

  private readonly world: World;
  private readonly channels: Channels;
  private readonly cameraRig: CameraRig;
  private readonly handle: RendererHandle;
  private readonly sceneRig: SceneRig;

  private readonly cmdButtons: HTMLButtonElement[] = [];
  private readonly swRoot: HTMLElement;
  private readonly swRows: Array<{ root: HTMLElement; label: Text; time: Text; id: string }> = [];
  private readonly superweapons = new Map<string, { label: string; remaining: number; total: number }>();

  /** Pooled snapshot — never reallocated. */
  private readonly snapshot: HudSnapshot;
  private readonly cameoPool: HudCameo[][] = [];

  private catalogue: CatalogEntry[] = [];
  private readonly catalogueByKey = new Map<string, CatalogEntry>();
  private tables: DefTables | null = null;

  private faction: Faction = Faction.Allies;
  private uiScale = 1;
  private dpr = 1;
  private lastW = 0;
  private lastH = 0;

  private soundHook: ((cue: HudSoundCue) => void) | null = null;
  private readonly prototypeCache = new Map<string, THREE.Object3D>();

  /**
   * Stand-in production ticker. Enabled ONLY when no system claims Phase
   * Production/Economy at boot, so the sidebar is a working build queue today
   * and hands the columns straight back the moment a real module registers.
   * Writes `player.credits` and `player.queues` — both owned by production —
   * which is why the gate is checked once at init and never re-opened.
   */
  private localProduction = false;

  private readonly unsubs: Array<() => void> = [];
  private disposed = false;
  private time = 0;

  constructor(opts: HudOptions) {
    this.world = opts.world;
    this.channels = opts.channels;
    this.cameraRig = opts.cameraRig;
    this.handle = opts.handle;
    this.sceneRig = opts.sceneRig;

    const local = this.world.players[this.world.localPlayer as number];
    this.faction = local ? local.faction : Faction.Allies;

    this.localProduction = !opts.simSystemIds.some(
      (id) => /produc|econom|build/i.test(id),
    );

    /* -- shell ---------------------------------------------------------- */
    this.root = el('div', 'ra-hud', opts.mount);
    this.root.dataset.faction = factionKey(this.faction);

    const overlayCanvas = el('canvas', 'ra-overlay', this.root) as HTMLCanvasElement;

    const playfield = (): { x: number; y: number; w: number; h: number } => {
      const sw = sidebarWidthPx(this.uiScale);
      const ch = Math.round(HUD_COMMAND_BAR.height * this.uiScale);
      return {
        x: 0,
        y: 0,
        w: Math.max(1, this.lastW - sw),
        h: Math.max(1, this.lastH - ch),
      };
    };

    this.overlay = new Overlay(overlayCanvas, {
      world: this.world,
      cameraRig: this.cameraRig,
      faction: this.faction,
      playfield,
    });

    this.sidebar = new Sidebar({
      parent: this.root,
      faction: this.faction,
      onCameoHover: (canvas, hovered) => this.cameos.setHovered(canvas, hovered),
      callbacks: {
        selectTab: (tab) => { this.snapshot.activeTab = tab; this.snapshot.tabAlert[tab as number] = false; },
        activate: (tab, cameo) => this.onCameoActivate(tab, cameo),
        cancel: (tab, cameo) => this.onCameoCancel(tab, cameo),
        setArmed: () => { /* the sidebar already applied the visual + cursor */ },
        diplomacy: () => console.info('[hud] diplomacy panel is not implemented yet'),
        options: () => console.info('[hud] options panel is not implemented yet'),
        sound: (cue) => this.soundHook?.(cue),
      },
    });

    this.minimap = new Minimap(this.sidebar.radarCanvas, {
      world: this.world,
      cameraRig: this.cameraRig,
      faction: this.faction,
      playfield,
    });

    this.cameos = new CameoRenderer(this.handle.renderer);
    this.cameos.setTheatre(theatreFor(opts.theatre));

    this.buildCommandBar();
    this.swRoot = el('div', 'ra-superweapons', this.root);

    /* -- pooled snapshot ------------------------------------------------- */
    const cameos: HudCameo[][] = [];
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      cameos.push([]);
      this.cameoPool.push([]);
    }
    this.snapshot = {
      credits: 0,
      creditsDisplay: 0,
      powerProduced: 0,
      powerConsumed: 0,
      brownout: false,
      hasRadar: false,
      activeTab: BuildTab.Structures,
      cameos,
      tabAlert: [false, false, false, false],
      selectionCount: 0,
      selectionPrimary: 0 as EntityId,
      gameTimeSec: 0,
      matchPhase: MatchPhase.Playing,
    };

    this.sidebar.setExtrasProvider((key) => this.extrasFor(key));
    this.minimap.onJumpRequest((x, z) => this.cameraRig.setFocus(x, z, false));

    this.buildCatalogue();
    this.subscribe();
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* async wiring — every one of these is allowed to fail                */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    await Promise.all([this.bindDefs(), this.bindModels(), this.bindTerrain()]);
    this.cameos.setEnvironment(this.sceneRig.scene.environment);
    this.resize();
  }

  /** Real def tables, if a data module published any. */
  private async bindDefs(): Promise<void> {
    try {
      const mod = await import('../game/Scenarios');
      const binding = await mod.resolveDefBinding();
      if (binding.tables === null) return;
      this.tables = binding.tables;
      this.buildCatalogue();
      console.info(
        `[hud] catalogue bound to real def tables ` +
        `(${binding.tables.units.length} units, ${binding.tables.buildings.length} buildings)`,
      );
    } catch (err) {
      console.info(`[hud] no def tables yet, using the built-in catalogue (${String(err)})`);
    }
  }

  /**
   * Live cameo meshes. Units and structures live in two independent libraries
   * owned by two different modules; either may be missing, and a miss on both
   * falls through to the procedural diorama rather than to an empty cell.
   */
  private async bindModels(): Promise<void> {
    // Structural, not nominal: the two libraries are owned by two other agents
    // and only need to agree on these three members.
    type ModelLib = {
      has(k: string): boolean;
      get(k: string): { prototype(): THREE.Object3D } | undefined;
    };
    let units: ModelLib | null = null;
    let buildings: ModelLib | null = null;
    let unitCount = 0;
    let buildingCount = 0;

    try {
      const mod = await import('../art/UnitFactory');
      units = mod.unitLibrary;
      unitCount = mod.unitLibrary.count();
    } catch (err) {
      console.info(`[hud] no unit models yet (${String(err)})`);
    }
    try {
      const mod = await import('../art/BuildingFactory');
      buildings = mod.buildingLibrary;
      buildingCount = mod.buildingLibrary.count();
    } catch (err) {
      console.info(`[hud] no structure models yet (${String(err)})`);
    }
    if (units === null && buildings === null) return;

    const provider: ModelProvider = (key, faction) => {
      const lib = buildings !== null && this.catalogueByKey.get(key)?.isBuilding === true ? buildings : units;
      const alt = lib === units ? buildings : units;

      const modelKey =
        (lib !== null ? this.resolveModelKey(key, faction, (k) => lib.has(k), lib === buildings) : null) ??
        (alt !== null ? this.resolveModelKey(key, faction, (k) => alt.has(k), alt === buildings) : null);
      if (modelKey === null) return null;

      let proto = this.prototypeCache.get(modelKey);
      if (proto === undefined) {
        const model = (lib?.has(modelKey) ? lib : alt)?.get(modelKey);
        if (model === undefined) return null;
        // A raw prototype renders BLACK: the art materials read per-instance
        // `aState`/`aTeamColor`, and a structure with buildProgress 0 sinks
        // below the ground clip. See primeCameoPrototype.
        proto = primeCameoPrototype(model.prototype(), this.teamColorLinear());
        this.prototypeCache.set(modelKey, proto);
      }
      return proto;
    };

    this.cameos.setModelProvider(provider);
    console.info(`[hud] cameos bound to ${unitCount} unit models and ${buildingCount} structure models`);
  }

  /** Radar terrain, if the terrain module is present. */
  private async bindTerrain(): Promise<void> {
    try {
      const mod = await import('../world/Terrain');
      const terrain = mod.getTerrain();
      if (terrain === null) return;
      const sampler: TerrainSampler = {
        surface: (cx, cz) => terrain.surface[cz * MAP_CELLS + cx],
        water: (cx, cz) => terrain.waterGrid[cz * MAP_CELLS + cx] !== 0,
        height01: (cx, cz) => terrain.cellHeight[cz * MAP_CELLS + cx] / TERRAIN_MAX_HEIGHT,
      };
      this.minimap.setTerrain(sampler);
      console.info('[hud] radar bound to live terrain');
    } catch (err) {
      console.info(`[hud] no terrain yet, radar paints a flat field (${String(err)})`);
    }
  }

  /**
   * Content key -> model key, trying the direct key, the alias table, and a
   * faction-prefixed form. Returns null when nothing matches, which is the
   * signal for the procedural cameo.
   */
  private resolveModelKey(
    key: string, faction: Faction, has: (k: string) => boolean, isBuilding: boolean,
  ): string | null {
    if (has(key)) return key;
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const alias = (isBuilding ? BUILDING_MODEL_ALIASES : MODEL_ALIASES)[norm];
    if (alias) {
      const pick = faction === Faction.Soviets ? alias[1] : alias[0];
      if (pick !== '' && has(pick)) return pick;
    }
    const prefixed = `${faction === Faction.Soviets ? 'soviet' : 'allied'}_${norm}`;
    if (has(prefixed)) return prefixed;
    return null;
  }

  /**
   * The player's team colour in LINEAR rgb, matching the RenderBridge's
   * `aTeamColor` contract. Cameo prototypes bake it per vertex.
   */
  private teamColorLinear(): THREE.Color {
    const hex = FACTION_PALETTE[factionKey(this.faction)].team;
    return this.teamColor.setStyle(hex, THREE.SRGBColorSpace).convertSRGBToLinear();
  }

  private readonly teamColor = new THREE.Color();

  /* ------------------------------------------------------------------ */
  /* catalogue                                                           */
  /* ------------------------------------------------------------------ */

  private buildCatalogue(): void {
    this.catalogue.length = 0;
    this.catalogueByKey.clear();

    if (this.tables !== null) {
      const t = this.tables;
      for (let i = 0; i < t.buildings.length; i++) {
        const d = t.buildings[i];
        this.catalogue.push({
          key: d.key, name: d.name, blurb: d.blurb, cost: d.cost, buildTime: d.buildTime,
          power: d.power, tab: d.tab, isBuilding: true, defId: i, sortOrder: d.sortOrder,
          prereqs: d.prereqs, footprintW: d.footprintW, footprintH: d.footprintH, faction: d.faction,
        });
      }
      for (let i = 0; i < t.units.length; i++) {
        const d = t.units[i];
        this.catalogue.push({
          key: d.key, name: d.name, blurb: d.blurb, cost: d.cost, buildTime: d.buildTime,
          power: 0, tab: d.tab, isBuilding: false,
          // Offset, not the bare `i`. `DefTables` has two independent index
          // spaces, and the ids on this row travel out through
          // `issueProductionStart` and come BACK on `ProductionItem.defId`,
          // which is a `BuildEntry.publicId`. Comparing a bare unit index
          // against a publicId is how the "queued" pip on a unit cameo goes
          // dark forever. See BuildEntry.publicId in src/sim/Production.ts.
          defId: i + UNIT_PUBLIC_ID_BASE, sortOrder: d.sortOrder,
          prereqs: d.prereqs, footprintW: 0, footprintH: 0, faction: d.faction,
        });
      }
    } else {
      for (const row of FALLBACK_CATALOGUE) this.catalogue.push({ ...row, defId: -1 });
    }

    this.catalogue.sort((a, b2) => (a.tab as number) - (b2.tab as number) || a.sortOrder - b2.sortOrder);
    for (const e of this.catalogue) {
      // Buildings and units can share a key across factions; the per-faction
      // filter runs later, so first-wins here is only a tooltip fallback.
      if (!this.catalogueByKey.has(e.key)) this.catalogueByKey.set(e.key, e);
    }
  }

  private extrasFor(key: string): CameoExtras {
    const e = this.catalogueByKey.get(key);
    if (!e) return { buildTimeSec: 0, powerDelta: 0, blurb: '' };
    return { buildTimeSec: e.buildTime, powerDelta: e.power, blurb: e.blurb };
  }

  /* ------------------------------------------------------------------ */
  /* command bar (§2.12)                                                 */
  /* ------------------------------------------------------------------ */

  private buildCommandBar(): void {
    const bar = el('div', 'ra-cmdbar', this.root);
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Unit commands');
    el('div', 'ra-cmd-endcap', bar);
    const icons = el('div', 'ra-cmd-icons', bar);

    // Six icons, 52 design px pitch, LEFT-ALIGNED. The right two thirds of the
    // bar stays empty black — that emptiness is part of the composition.
    const SPEC: ReadonlyArray<[GlyphName, string, () => void]> = [
      ['cmdStop', 'Stop', () => this.orderSelection(OrderKind.Stop)],
      ['cmdGuardHold', 'Hold ground', () => this.stanceSelection(Stance.HoldGround)],
      ['cmdFormation', 'Formation move', () => { this.formationMove = !this.formationMove; this.syncCmdToggles(); }],
      ['cmdScatter', 'Scatter', () => this.orderSelection(OrderKind.Scatter)],
      ['cmdGuard', 'Guard', () => this.orderSelection(OrderKind.Guard)],
      ['cmdWaypoint', 'Waypoint mode', () => { this.waypointMode = !this.waypointMode; this.syncCmdToggles(); }],
    ];

    for (let i = 0; i < SPEC.length; i++) {
      const [glyph, label, action] = SPEC[i];
      const btn = el('button', 'ra-cmd-btn', icons) as HTMLButtonElement;
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      const cx = HUD_COMMAND_BAR.firstIconCx - HUD_COMMAND_BAR.endCapW + i * HUD_COMMAND_BAR.iconPitch;
      btn.style.left = `calc(${cx - HUD_COMMAND_BAR.iconW * 0.5} * var(--ra-d))`;
      btn.appendChild(makeGlyph(glyph, 'ra-glyph'));
      btn.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        this.soundHook?.('click');
        action();
      });
      this.cmdButtons.push(btn);
    }
  }

  private syncCmdToggles(): void {
    this.cmdButtons[2]?.classList.toggle('is-active', this.formationMove);
    this.cmdButtons[5]?.classList.toggle('is-active', this.waypointMode);
  }

  private orderSelection(order: OrderKind): void {
    const sel = this.world.selection;
    if (sel.count === 0) return;
    this.channels.commands.issueOrder(
      this.world.localPlayer, order, sel.ids, sel.count, 0, 0, 0 as EntityId, false,
    );
  }

  private stanceSelection(stance: Stance): void {
    const sel = this.world.selection;
    if (sel.count === 0) return;
    this.channels.commands.issueSetStance(this.world.localPlayer, sel.ids, sel.count, stance);
  }

  /* ------------------------------------------------------------------ */
  /* superweapon readout (§2.12)                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Publish or update one countdown row. `remaining <= 0` puts the row into the
   * red<->gold flash. Call `clearSuperweapon` when the charge is spent.
   */
  setSuperweapon(id: string, label: string, remaining: number, total: number): void {
    this.superweapons.set(id, { label, remaining, total: Math.max(1, total) });
    this.syncSuperweapons();
  }

  clearSuperweapon(id: string): void {
    if (!this.superweapons.delete(id)) return;
    this.syncSuperweapons();
  }

  private syncSuperweapons(): void {
    const ids = [...this.superweapons.keys()].slice(0, HUD_SUPERWEAPON.maxRows);

    while (this.swRows.length > ids.length) {
      this.swRows.pop()?.root.remove();
    }
    while (this.swRows.length < ids.length) {
      const root = el('div', 'ra-sw-row', this.swRoot);
      const label = textNode(el('span', 'ra-sw-label', root));
      const time = textNode(el('span', 'ra-sw-time', root));
      this.swRows.push({ root, label, time, id: '' });
    }

    for (let i = 0; i < ids.length; i++) {
      const row = this.swRows[i];
      const data = this.superweapons.get(ids[i]);
      if (!data) continue;
      row.id = ids[i];
      row.label.nodeValue = data.label.toUpperCase();
      row.time.nodeValue = formatClock(data.remaining);
      row.root.classList.toggle('is-ready', data.remaining <= 0);
      const pct = 100 * Math.max(0, Math.min(1, 1 - data.remaining / data.total));
      row.root.style.setProperty('--ra-sw-progress', `${pct.toFixed(1)}%`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* events                                                              */
  /* ------------------------------------------------------------------ */

  private subscribe(): void {
    const bus = this.channels.events;

    this.unsubs.push(bus.on('economy:credits', (e) => {
      if ((e.player as number) !== (this.world.localPlayer as number)) return;
      if (e.delta !== 0) this.sidebar.creditFlyout(e.delta);
    }));

    this.unsubs.push(bus.on('combat:underAttack', (e) => {
      const mine = (e.player as number) === (this.world.localPlayer as number);
      this.minimap.ping(e.x, e.z, !mine);
    }));

    this.unsubs.push(bus.on('entity:damaged', (e) => {
      // Floating damage numbers: only for hits the player can act on, or the
      // frame turns into a damage-meter overlay in any real battle.
      const local = this.world.localPlayer as number;
      if ((e.player as number) !== local && (e.attackerPlayer as number) !== local) return;
      if (e.amount < 1) return;
      const mine = (e.player as number) === local;
      this.overlay.floater(e.x, 2.4, e.z, `-${Math.round(e.amount)}`, mine ? '#E8534F' : '#F0E0A0');
    }));

    this.unsubs.push(bus.on('production:ready', (e) => {
      if ((e.player as number) !== (this.world.localPlayer as number)) return;
      this.snapshot.tabAlert[e.tab as number] = true;
    }));

    this.unsubs.push(bus.on('building:placed', () => this.minimap.invalidateTerrain()));
    this.unsubs.push(bus.on('building:sold', () => this.minimap.invalidateTerrain()));

    this.unsubs.push(bus.on('match:started', () => {
      const p = this.world.players[this.world.localPlayer as number];
      if (!p) return;
      this.setFaction(p.faction);
    }));
  }

  setFaction(faction: Faction): void {
    if (this.faction === faction) return;
    this.faction = faction;
    this.root.dataset.faction = factionKey(faction);
    this.sidebar.setFaction(faction);
    this.minimap.setFaction(faction);
    this.overlay.setFaction(faction);
    this.cameos.invalidateAll();
    this.buildCatalogue();
  }

  setSoundHook(fn: ((cue: HudSoundCue) => void) | null): void {
    this.soundHook = fn;
  }

  /* ------------------------------------------------------------------ */
  /* cameo actions                                                       */
  /* ------------------------------------------------------------------ */

  private onCameoActivate(tab: BuildTab, cameo: HudCameo): void {
    const player = this.world.localPlayer;
    const p = this.world.players[player as number];
    if (!p) return;

    if (cameo.ready) {
      if (cameo.isBuilding) {
        // A finished structure waits for the player to choose a cell; placement
        // is the input module's gesture, so the HUD only raises the request.
        this.onPlaceRequest?.(cameo.defId, cameo.key);
      }
      return;
    }

    if (p.credits < cameo.cost) {
      this.soundHook?.('error');
      return;
    }

    this.channels.commands.issueProductionStart(player, tab, cameo.defId, 1);
    if (this.localProduction) this.localEnqueue(p, tab, cameo);
  }

  private onCameoCancel(tab: BuildTab, cameo: HudCameo): void {
    const player = this.world.localPlayer;
    this.channels.commands.issueProductionCancel(player, tab, cameo.defId, -1);
    if (this.localProduction) {
      const p = this.world.players[player as number];
      if (p) this.localCancel(p, tab, cameo.defId);
    }
  }

  /* ------------------------------------------------------------------ */
  /* the stand-in production ticker                                      */
  /* ------------------------------------------------------------------ */

  private localEnqueue(p: PlayerState, tab: BuildTab, cameo: HudCameo): void {
    const q = p.queues[tab as number];
    if (!q || q.items.length >= 9) return;
    q.items.push({
      defId: cameo.defId,
      isBuilding: cameo.isBuilding,
      progress: 0,
      spent: 0,
      cost: cameo.cost,
      ready: false,
      onHold: false,
    });
  }

  private localCancel(p: PlayerState, tab: BuildTab, defId: number): void {
    const q = p.queues[tab as number];
    if (!q) return;
    for (let i = q.items.length - 1; i >= 0; i--) {
      if (q.items[i].defId !== defId) continue;
      p.credits += q.items[i].spent;
      q.items.splice(i, 1);
      return;
    }
  }

  /**
   * Deterministic — no wall clock, no `Math.random`. Runs at 30 Hz inside the
   * fixed step exactly like a real production system would, so switching to the
   * real one changes nothing the player can see.
   */
  simTick(s: SimContext): void {
    if (!this.localProduction || this.disposed) return;
    const p = this.world.players[this.world.localPlayer as number];
    if (!p) return;

    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const q = p.queues[t];
      if (!q || q.items.length === 0) continue;
      const item = q.items[0];
      if (item.ready) continue;

      const entry = this.entryForDefId(item.defId, item.isBuilding);
      const seconds = entry ? entry.buildTime : 10;
      const step = s.dt / Math.max(0.5, seconds);
      const owed = step * item.cost;

      if (p.credits < owed) {
        item.onHold = true;
        continue;
      }
      item.onHold = false;
      p.credits -= owed;
      item.spent += owed;
      item.progress = Math.min(1, item.progress + step);

      if (item.progress >= 1) {
        item.ready = true;
        if (!item.isBuilding) {
          // No factory exists to spawn from, so a finished unit simply clears
          // and refunds nothing — the queue keeps flowing and the sidebar's
          // "Ready" state is still exercised for one second.
          q.items.shift();
          this.snapshot.tabAlert[t] = true;
        } else {
          q.awaitingPlacement = true;
          this.snapshot.tabAlert[t] = true;
        }
      }
    }
  }

  private entryForDefId(defId: number, isBuilding: boolean): CatalogEntry | null {
    for (const e of this.catalogue) {
      if (e.defId === defId && e.isBuilding === isBuilding) return e;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* per-frame                                                           */
  /* ------------------------------------------------------------------ */

  frame(dt: number): void {
    if (this.disposed) return;
    this.time += dt;

    this.resize();
    this.buildSnapshot();

    this.sidebar.update(this.snapshot, dt, (cell) => this.rebindCameoArt(cell));
    this.minimap.frame(this.time, dt);
    this.overlay.frame(dt);
    this.cameos.frame(this.time, dt);

    if (this.superweapons.size > 0) this.tickSuperweapons(dt);
  }

  private tickSuperweapons(dt: number): void {
    for (const data of this.superweapons.values()) {
      if (data.remaining > 0) data.remaining = Math.max(0, data.remaining - dt);
    }
    this.syncSuperweapons();
  }

  private rebindCameoArt(cell: CameoCell): void {
    const c = cell.cameo;
    if (!c) return;
    const entry = this.catalogueByKey.get(c.key);
    const subject: CameoSubject = {
      key: c.key,
      name: c.name,
      faction: this.faction,
      tab: cell.tab,
      isBuilding: c.isBuilding,
      footprintW: entry ? entry.footprintW : 0,
      footprintH: entry ? entry.footprintH : 0,
    };
    this.cameos.bind(cell.art, subject);
  }

  /* ------------------------------------------------------------------ */
  /* snapshot                                                            */
  /* ------------------------------------------------------------------ */

  private buildSnapshot(): void {
    const snap = this.snapshot;
    const p = this.world.players[this.world.localPlayer as number];
    if (!p) return;

    snap.credits = Math.round(p.credits);
    snap.powerProduced = p.powerProduced;
    snap.powerConsumed = p.powerConsumed;
    snap.brownout = p.powerConsumed > p.powerProduced;
    snap.hasRadar = p.hasRadar || this.world.vision.hasRadar(this.world.localPlayer);
    snap.selectionCount = this.world.selection.count;
    snap.selectionPrimary = (this.world.selection.count > 0
      ? this.world.selection.ids[0]
      : 0) as EntityId;
    snap.gameTimeSec = this.world.time;

    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      this.fillTab(p, t as BuildTab);
    }
  }

  private fillTab(p: PlayerState, tab: BuildTab): void {
    const pool = this.cameoPool[tab as number];
    const out = this.snapshot.cameos[tab as number];
    out.length = 0;

    const q = p.queues[tab as number];
    let n = 0;

    for (const entry of this.catalogue) {
      if (entry.tab !== tab) continue;
      // Neutral-faction content is shared; everything else is filtered so the
      // Allied player never sees a Tesla Coil cameo.
      if (entry.faction !== Faction.Neutral && entry.faction !== p.faction) continue;

      let c = pool[n];
      if (c === undefined) {
        c = {
          defId: -1, isBuilding: false, key: '', name: '', cost: 0,
          progress: 0, queued: 0, ready: false, onHold: false, available: true, reason: '',
        };
        pool.push(c);
      }
      n++;

      c.defId = entry.defId;
      c.isBuilding = entry.isBuilding;
      c.key = entry.key;
      c.name = entry.name;
      c.cost = entry.cost;
      c.progress = 0;
      c.queued = 0;
      c.ready = false;
      c.onHold = false;

      // Queue state: the HEAD item drives the wipe; everything behind it only
      // adds to the badge count, which is exactly how the original behaved.
      if (q) {
        for (let i = 0; i < q.items.length; i++) {
          const item = q.items[i];
          if (item.defId !== entry.defId || item.isBuilding !== entry.isBuilding) continue;
          c.queued++;
          if (i === 0) {
            c.progress = item.progress;
            c.ready = item.ready;
            c.onHold = item.onHold;
          }
        }
      }

      const avail = this.availability(p, entry);
      c.available = avail === '';
      c.reason = avail;

      out.push(c);
    }
  }

  /** Empty string when buildable; otherwise the player-facing reason. */
  private availability(p: PlayerState, entry: CatalogEntry): string {
    for (const req of entry.prereqs) {
      if (!this.hasStructure(p, req)) {
        const named = this.catalogueByKey.get(req);
        return `Requires ${named ? named.name : req}`;
      }
    }
    if (p.credits < entry.cost) return 'Insufficient funds';
    return '';
  }

  private hasStructure(p: PlayerState, key: string): boolean {
    if (this.tables !== null) {
      const idx = this.tables.buildingByKey.get(key);
      if (idx === undefined) return false;
      return p.buildingCount[idx] > 0;
    }
    // No def tables: count live buildings by scanning, which is O(buildings)
    // and only runs while a cameo's availability is being recomputed.
    const store = this.world.store;
    const list = store.byKind[EntityKind.Building];
    const count = store.byKindCount[EntityKind.Building];
    for (let i = 0; i < count; i++) {
      const e = list[i];
      if ((store.owner[e] as PlayerId) !== p.id) continue;
      if ((store.flags[e] & EntityFlag.UnderConstruction) !== 0) continue;
      if (this.keyOfEntity(e) === key) return true;
    }
    return false;
  }

  /** Content key of a spawned entity, via the scenario's own label map. */
  private entityKeyOf: ((id: EntityId) => string) | null = null;

  private keyOfEntity(index: number): string {
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

  private resize(): void {
    const w = this.handle.size.cssWidth;
    const h = this.handle.size.cssHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.lastW && h === this.lastH && dpr === this.dpr) return;

    this.lastW = w;
    this.lastH = h;
    this.dpr = dpr;
    this.uiScale = computeUiScale(h);

    const sw = sidebarWidthPx(this.uiScale);
    this.root.style.setProperty('--ra-d', `${this.uiScale}px`);
    this.root.style.setProperty('--ra-w', `${sw}px`);

    this.sidebar.layout(this.uiScale, dpr, h);
    this.overlay.resize(w, h, dpr, this.uiScale);

    // The radar field is 142 x 110 design px inside a 168-wide sidebar.
    const radarRect = this.sidebar.radarField.getBoundingClientRect();
    this.minimap.resize(
      radarRect.width > 0 ? radarRect.width : 142 * this.uiScale,
      radarRect.height > 0 ? radarRect.height : 110 * this.uiScale,
      dpr,
    );
    this.cameos.invalidateAll();
  }

  /** Fraction of the frame the HUD occupies. Bible §9 wants 12-16%. */
  hudFrameShare(): number {
    if (this.lastW <= 0 || this.lastH <= 0) return 0;
    const sw = sidebarWidthPx(this.uiScale);
    const ch = HUD_COMMAND_BAR.height * this.uiScale;
    const area = sw * this.lastH + ch * (this.lastW - sw);
    return area / (this.lastW * this.lastH);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.cameos.dispose();
    this.minimap.dispose();
    this.overlay.dispose();
    this.sidebar.dispose();
    for (const proto of this.prototypeCache.values()) proto.clear();
    this.prototypeCache.clear();
    this.root.remove();
  }
}

/** Cell size in metres, used by nothing here but kept honest against config. */
void CELL;
