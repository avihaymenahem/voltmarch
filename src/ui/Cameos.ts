/**
 * ============================================================================
 * VOLTMARCH — src/ui/Cameos.ts
 * ============================================================================
 * LIVE CAMEO RENDERS (VISUAL_DNA I10 / §2.8).
 *
 * The original's cameos were pre-rendered bitmaps. Ours are rendered from the
 * ACTUAL game mesh into a cached render target, which is the one modernisation
 * the references physically cannot show. What we keep, because it is identity
 * and not limitation, is the **mini-diorama**: three-quarter view, key light
 * upper-left, visible ground contact shadow, and a full-bleed environment
 * backdrop matching the current theatre. The cameo grid must read as twenty
 * tiny photographs, never twenty flat icons.
 *
 * COST MODEL
 * ----------
 * A cameo is rendered when it becomes dirty and then never again — the result
 * lives in the cell's own 2D canvas. `frame()` spends at most
 * `HUD_CAMEO.perFrameBudget` renders, so a tab switch that dirties 20 cameos
 * costs 10 frames of trickle instead of one 20 ms hitch. Hover re-renders at
 * 30 Hz with a 12 deg/s turntable and is charged against the same budget.
 *
 * We deliberately reuse the MAIN renderer rather than creating a second WebGL
 * context: a second context doubles VRAM for the shared unit atlases and loses
 * the environment map. Everything we touch on the renderer (render target,
 * tone-mapping exposure, scissor/viewport) is saved and restored inside one
 * call, and all of it happens at RenderPhase.Hud — strictly before Bootstrap's
 * `present()` runs the real frame.
 *
 * RESOLUTION — MEASURED, NOT ASSUMED
 * ----------------------------------
 * The header used to say the fallback existed because "a def key may not
 * resolve to a model, and until every art module lands most of them will not".
 * `tools/cameo-audit.mjs` measured that claim against the running game and it
 * was wrong in the worst direction: the art HAD landed — 79 of 79 def keys have
 * a real model built at boot — and the resolution rate was **0 %**, because
 * `provider` defaulted to `() => null` and `setModelProvider` had ZERO call
 * sites anywhere in `src/**`. Every cameo in the game took the 2D path, and the
 * one capability this module exists to provide was never once exercised.
 *
 * That is the repo's signature failure — a capability that exists and is not
 * used — so the fix is structural, not another call site to forget. §3B is a
 * complete content-key -> model-key table for all four armies, and
 * `createCameoModelProvider()` reads the art libraries directly. The renderer
 * DEFAULTS to it. `setModelProvider` survives only as a test/harness override.
 * `tests/cameos-coverage.spec.ts` fails the day a faction is added without its
 * mappings, which is exactly how this broke.
 *
 * WHY THIS FILE MAY IMPORT `src/art/**` NOW
 * -----------------------------------------
 * The old rule was that the HUD must not import the art modules, because "a
 * missing sibling breaks the whole interface". The injected lookup that rule
 * produced is what shipped 0 %. The libraries are module-level singletons that
 * the `*.system.ts` glob already pulls into every build, so importing them here
 * adds no bundle weight and cannot fail independently — and the resolver treats
 * an empty library as a miss, so a library that never gets built degrades to
 * the 2D fallback exactly as before instead of throwing.
 *
 * FALLBACK
 * --------
 * Still here, and still correct, for the two cases that remain: a def whose
 * model genuinely does not exist, and a frame before the art systems have run
 * their `init()`. `paintFallback` draws the cameo in 2D — same backdrop, same
 * contact shadow, same three-quarter read, same crisp frame — from a library of
 * VECTOR SILHOUETTES (§6): 29 small assemblies of boxes, cylinders and domes
 * posed in a true isometric projection and painted as flat faces with crisp
 * panel lines. No per-pixel noise anywhere in the cell.
 * ============================================================================
 */

import * as THREE from 'three';

import { FACTION_PALETTE, HUD_CAMEO } from '../core/config';
import { hexToLinearRgb } from '../core/math';
import { BuildTab, Faction, FACTION_PALETTE_KEYS } from '../core/types';
import { buildingLibrary } from '../art/BuildingFactory';
import { unitLibrary } from '../art/UnitFactory';
import { shroudUniforms } from '../render/FogOfWar';
import { meridianUnitLibrary } from '../art/Faction3Units';
import { meridianBuildingLibrary } from '../art/Faction3Buildings';
import { reclaimUnitLibrary } from '../art/Faction4Units';
import { reclaimBuildingLibrary } from '../art/Faction4Buildings';
import { mixHex, rgba } from './Chrome';

/* ==========================================================================
 * SECTION 1 — BACKDROPS
 *
 * Two families, and the split is deliberate.
 *
 * `panel` is the DEFAULT and it is what `docs/refs/target-hud.png` actually
 * shows: the cameo cells there are not landscapes. They are the same near-black
 * blue panel as every other surface in that interface — `#080d18` at the centre
 * lifting toward `#0d1526` at the edges (TARGET_LOOK §A.1) — with the structure
 * standing on it, evenly lit, under a soft contact shadow. No sky, no horizon,
 * no sun bloom. Against a bright sky the pale concrete of a Construction Yard
 * loses its silhouette entirely, which is the single largest legibility
 * difference between our grid and the reference.
 *
 * The four THEATRE backdrops are the original's "full-bleed environment
 * backdrop matching the current theatre" (§2.8) and are kept intact, because a
 * mission briefing or a codex screen may still want the diorama read. They are
 * reached by asking for them; nothing gets one by default.
 * ========================================================================== */

export type Theatre = 'panel' | 'temperate' | 'desert' | 'snow' | 'urban';

interface Backdrop {
  /** Sky, top to horizon. On a panel backdrop this is the outer field. */
  skyTop: string;
  skyBottom: string;
  /** Ground, horizon to bottom. On a panel backdrop this is the inner field. */
  groundFar: string;
  groundNear: string;
  /** Warm sun bloom centre, upper left. */
  sun: string;
  /**
   * A panel has no horizon and no sun disc: it is one radial ramp plus the
   * frame's own falloff. Drawing the horizon rule on it would invent a ground
   * plane the reference does not have.
   */
  panel?: true;
}

const BACKDROPS: Readonly<Record<Theatre, Backdrop>> = {
  // Centre `#0D1526` -> edge `#080D18`, i.e. TARGET_LOOK §A.1 read inward: the
  // reference panels are lightest in the middle and sink at the rim.
  panel:     { skyTop: '#0D1526', skyBottom: '#0B1220', groundFar: '#0A101C', groundNear: '#070B14', sun: '#1B2C48', panel: true },
  temperate: { skyTop: '#2E5C93', skyBottom: '#8CB4D6', groundFar: '#5E6418', groundNear: '#3A3F10', sun: '#FFE4A8' },
  desert:    { skyTop: '#3E6EA8', skyBottom: '#C9A46A', groundFar: '#A8874E', groundNear: '#6E5628', sun: '#FFD08C' },
  snow:      { skyTop: '#6E8CAE', skyBottom: '#E9F2F4', groundFar: '#CBDEE6', groundNear: '#8EA2AE', sun: '#FFFFFF' },
  urban:     { skyTop: '#1A2138', skyBottom: '#4A4258', groundFar: '#3E3C33', groundNear: '#232022', sun: '#FFC98A' },
};

/**
 * Terrain/scenario biome names map onto the four THEATRE backdrops.
 *
 * Deliberately never returns `panel`: this function answers "which landscape",
 * and the panel is the absence of one. The HUD does not call it — a
 * `CameoRenderer` is born on `panel` and stays there unless something asks for
 * a diorama, which is what keeps the reference's dark cell the default that
 * nobody has to remember.
 */
export function theatreFor(name: string | null | undefined): Theatre {
  switch ((name ?? '').toLowerCase()) {
    case 'desert':
    case 'arid':
      return 'desert';
    case 'snow':
    case 'arctic':
      return 'snow';
    case 'urban':
    case 'city':
      return 'urban';
    default:
      return 'temperate';
  }
}

/* ==========================================================================
 * SECTION 2 — WHAT A CAMEO NEEDS TO KNOW
 * ========================================================================== */

export interface CameoSubject {
  /** Content/def key, e.g. `grizzly`, `soviet_rhino`, `conyard`. */
  key: string;
  /** Display name, used only by the fallback painter's silhouette choice. */
  name: string;
  faction: Faction;
  tab: BuildTab;
  isBuilding: boolean;
  /** Footprint in cells for buildings; 0 for units. Sizes the fallback mass. */
  footprintW: number;
  footprintH: number;
}

/**
 * A model provider: content key + army -> a posed, primed prototype.
 *
 * `createCameoModelProvider()` (§3B) is the real one and the renderer's default.
 * The type stays injectable so a test or a contact-sheet harness can substitute
 * a stub — that is now its ONLY remaining purpose. It is no longer a hole for
 * somebody else to fill: filling it was left undone for the entire life of this
 * module and the result was a 0 % model-cameo rate.
 */
export type ModelProvider = (key: string, faction: Faction) => THREE.Object3D | null;

/* ==========================================================================
 * SECTION 3 — PRIMING A PROTOTYPE FOR NON-INSTANCED RENDERING
 *
 * The art modules author their materials for the RenderBridge's InstancedMesh
 * path: `onBeforeCompile` injects `attribute vec4 aState` (hpFrac,
 * buildProgress, selected, seed) and `attribute vec3 aTeamColor`, both supplied
 * per INSTANCE. A plain `THREE.Mesh` has neither, so WebGL feeds the shader the
 * default (0,0,0,1) — and `src/art/BuildingFactory.ts` reads `aState.y` as the
 * construction reveal:
 *
 *     raSink = (1.0 - bp) * aFeature.y * rises;
 *
 * With `bp = 0` every mass sinks by its own model height and is then clipped at
 * the ground plane, so a cameo of a Construction Yard renders as a black cell.
 * That is the bug this function exists to prevent, and it is the reason a cameo
 * cannot simply call `prototype()` and render the result.
 *
 * The fix is per-VERTEX attributes of the same names. The geometry is rebuilt as
 * a shell that SHARES every original buffer — position, normal, uv, aFeature —
 * and adds only the two small arrays, so priming a 3000-vertex structure costs
 * ~84 KB rather than a full geometry clone.
 * ========================================================================== */

/** Values a finished, undamaged, unselected model wants: hp 1, built 1. */
const CAMEO_STATE: readonly [number, number, number, number] = [1, 1, 0, 0.5];

/**
 * Walk a prototype and give every mesh the per-instance channels its material
 * expects. Idempotent — a geometry that already carries `aState` is left alone.
 * `teamColor` is LINEAR rgb, matching the RenderBridge's `aTeamColor` contract.
 */
export function primeCameoPrototype(root: THREE.Object3D, teamColor: THREE.Color): THREE.Object3D {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || mesh.geometry === undefined) return;
    const src = mesh.geometry;
    if (src.getAttribute('aState') !== undefined) return;

    const count = src.getAttribute('position')?.count ?? 0;
    if (count === 0) return;

    const shell = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      shell.setAttribute(name, src.attributes[name]);
    }
    if (src.index !== null) shell.setIndex(src.index);
    for (const g of src.groups) shell.addGroup(g.start, g.count, g.materialIndex);
    shell.boundingBox = src.boundingBox;
    shell.boundingSphere = src.boundingSphere;

    const state = new Float32Array(count * 4);
    const team = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      state[i * 4] = CAMEO_STATE[0];
      state[i * 4 + 1] = CAMEO_STATE[1];
      state[i * 4 + 2] = CAMEO_STATE[2];
      state[i * 4 + 3] = CAMEO_STATE[3];
      team[i * 3] = teamColor.r;
      team[i * 3 + 1] = teamColor.g;
      team[i * 3 + 2] = teamColor.b;
    }
    shell.setAttribute('aState', new THREE.BufferAttribute(state, 4));
    shell.setAttribute('aTeamColor', new THREE.BufferAttribute(team, 3));

    mesh.geometry = shell;
  });
  return root;
}

/* ==========================================================================
 * SECTION 3B — CONTENT KEY -> MODEL KEY, FOR ALL FOUR ARMIES
 *
 * The two vocabularies are separate on purpose and they do not agree by
 * construction: `src/data/Defs.ts` says `battleLab`, the art says `allied_tech`
 * and `soviet_tech`; `oreSilo` is `allied_silo`; `powerPlant` is `allied_power`.
 * Somewhere has to hold the join, and today that somewhere is
 * `src/art/{units,buildings}.system.ts` — in MODULE-PRIVATE constants that the
 * HUD cannot see. This table is the same join, readable from the UI side.
 *
 * WHY NOT `BuildableDef.model`, WHICH IS RIGHT THERE
 * -------------------------------------------------
 * Because it is wrong. `BuildableDef.model` is documented as "ModelRegistry
 * key" and has ZERO readers in `src/**` — the render path binds through
 * `CONTENT_TO_MODEL` instead — so nothing has ever checked it, and five unit
 * rows have quietly rotted:
 *
 *     attackDog  -> 'soviet_conscript'   (the dog model is `soviet_dog`)
 *     apocalypse -> 'soviet_rhino'       (`soviet_apocalypse` exists)
 *     submarine  -> 'soviet_dreadnought' (`soviet_sub` exists)
 *     gunboat    -> 'allied_destroyer'   (`allied_gunboat` exists)
 *     transport  -> 'allied_harvester'   (`allied_transport` exists)
 *
 * A cameo grid built on that field would show an Attack Dog as a conscript and
 * a Submarine as a Dreadnought — five wrong pictures, and no test anywhere
 * would have noticed. `tests/cameos-coverage.spec.ts` cross-checks this table
 * against the mass lists AND against the art modules' own exported maps, so the
 * join below cannot rot the same way.
 *
 * A PAIR is a def one model cannot serve: `conyard` is one row in `Defs.ts`
 * but two buildings, and which one you get is the player's army.
 * ========================================================================== */

/** `key` for a def with one model; `[allied, soviet]` for a faction-shared def. */
type ModelBinding = string | readonly [string, string];

/**
 * Unit content key -> model key. Mirrors `CONTENT_TO_MODEL` +
 * `SHARED_CONTENT_TO_MODEL` in `src/art/units.system.ts` for the two original
 * armies, and `MERIDIAN_UNIT_MODELS` / `RECLAIM_UNIT_MODELS` verbatim.
 */
export const CAMEO_UNIT_MODELS: Readonly<Record<string, ModelBinding>> = {
  /* -- Allies ------------------------------------------------------------ */
  gi: 'allied_rifle',
  javelin: 'allied_javelin',
  grizzly: 'allied_guardian',
  ifv: 'allied_ifv',
  prismTank: 'allied_prism',
  fieldMarshal: 'allied_marshal',
  gunboat: 'allied_gunboat',
  destroyer: 'allied_destroyer',

  /* -- Soviets ----------------------------------------------------------- */
  conscript: 'soviet_conscript',
  flakTrooper: 'soviet_flak',
  attackDog: 'soviet_dog',
  commissar: 'soviet_commissar',
  rhino: 'soviet_rhino',
  apocalypse: 'soviet_apocalypse',
  submarine: 'soviet_sub',
  dreadnought: 'soviet_dreadnought',

  /* -- shared between the two original armies ---------------------------- */
  // The Engineer is one model for both, which is a content fact and not an
  // omission: `src/art/UnitDefs.ts` builds exactly one `allied_engineer`.
  engineer: 'allied_engineer',
  harvester: ['allied_harvester', 'soviet_harvester'],
  mcv: ['allied_dozer', 'soviet_dozer'],
  transport: ['allied_transport', 'soviet_transport'],

  /* -- the Meridian Pact ------------------------------------------------- */
  mrdWayfarer: 'meridian_wayfarer',
  mrdLancer: 'meridian_lancer',
  mrdArtificer: 'meridian_artificer',
  mrdHierarch: 'meridian_hierarch',
  mrdCollector: 'meridian_collector',
  mrdSkiff: 'meridian_skiff',
  mrdSolarch: 'meridian_solarch',
  mrdZenith: 'meridian_zenith',
  mrdCarryall: 'meridian_carryall',
  mrdKestrel: 'meridian_kestrel',
  mrdCorvette: 'meridian_corvette',
  mrdMonitor: 'meridian_monitor',

  /* -- the Reclamation --------------------------------------------------- */
  rclPicker: 'reclaim_picker',
  rclSlagger: 'reclaim_slagger',
  rclTinker: 'reclaim_tinker',
  rclBaron: 'reclaim_baron',
  rclScrapper: 'reclaim_scrapper',
  rclSpitter: 'reclaim_spitter',
  rclGrinder: 'reclaim_grinder',
  rclSlaghurler: 'reclaim_slaghurler',
  rclCrawler: 'reclaim_crawler',
  rclHornet: 'reclaim_hornet',
  rclScow: 'reclaim_scow',
  rclHulk: 'reclaim_hulk',
};

/**
 * Building content key -> model key. Mirrors `SHARED_KEYS` + `FACTION_KEYS` in
 * `src/art/buildings.system.ts`, and `MERIDIAN_STRUCTURE_MODELS` /
 * `RECLAIM_STRUCTURE_MODELS` verbatim.
 */
export const CAMEO_BUILDING_MODELS: Readonly<Record<string, ModelBinding>> = {
  /* -- shared between the two original armies ---------------------------- */
  conyard: ['allied_conyard', 'soviet_conyard'],
  powerPlant: ['allied_power', 'soviet_power'],
  refinery: ['allied_refinery', 'soviet_refinery'],
  barracks: ['allied_barracks', 'soviet_barracks'],
  warFactory: ['allied_warfactory', 'soviet_warfactory'],
  radar: ['allied_radar', 'soviet_radar'],
  battleLab: ['allied_tech', 'soviet_tech'],
  oreSilo: ['allied_silo', 'soviet_silo'],
  repairDepot: ['allied_depot', 'soviet_depot'],
  wall: ['allied_wall', 'soviet_wall'],
  // No `gate` row exists in `Defs.ts` today, but both models are built and the
  // key is already bound in `buildings.system.ts`. Listed so the def that
  // eventually lands does not arrive glyph-only.
  gate: ['allied_gate', 'soviet_gate'],

  /* -- single-army --------------------------------------------------------*/
  navalYard: 'allied_navalyard',
  subPen: 'soviet_subpen',
  pillbox: 'allied_pillbox',
  aaTurret: 'allied_aa',
  prismTower: 'allied_prismtower',
  teslaCoil: 'soviet_tesla',
  flameTower: 'soviet_flametower',
  sentryGun: 'soviet_sentry',

  /* -- the Meridian Pact ------------------------------------------------- */
  mrdConclave: 'meridian_conclave',
  mrdSolarArray: 'meridian_solararray',
  mrdChapterhouse: 'meridian_chapterhouse',
  mrdCistern: 'meridian_cistern',
  mrdForgeyard: 'meridian_forgeyard',
  mrdOculus: 'meridian_oculus',
  mrdReliquary: 'meridian_reliquary',
  mrdSlipway: 'meridian_slipway',
  mrdVault: 'meridian_vault',
  mrdGlaive: 'meridian_glaive',
  mrdHelios: 'meridian_helios',
  mrdRampart: 'meridian_rampart',
  mrdDepot: 'meridian_depot',

  /* -- the Reclamation --------------------------------------------------- */
  rclFoundry: 'reclaim_foundry',
  rclFurnace: 'reclaim_furnace',
  rclSorter: 'reclaim_sorter',
  rclRookery: 'reclaim_rookery',
  rclBreakerYard: 'reclaim_breakeryard',
  rclSpotter: 'reclaim_spotter',
  rclCrucible: 'reclaim_crucible',
  rclDrydock: 'reclaim_drydock',
  rclHeap: 'reclaim_heap',
  rclBarricade: 'reclaim_barricade',
  rclSpitpost: 'reclaim_spitpost',
  rclPylon: 'reclaim_pylon',
  rclDepot: 'reclaim_depot',
};

/**
 * Which half of a pair an army takes.
 *
 * Only the two original armies share defs, and Neutral content (the Engineer,
 * the Harvester, the Construction Yard) appears in BOTH their sidebars — so a
 * Soviet player's `conyard` cameo has to be the Soviet one. Anything that is
 * not the Soviet army reads the first slot, which keeps Neutral-owned entities
 * (crates, civilian structures) on the Allied architecture exactly as
 * `buildings.system.ts` registers them.
 */
function bindingFor(binding: ModelBinding, faction: Faction): string {
  if (typeof binding === 'string') return binding;
  return faction === Faction.Soviets ? binding[1] : binding[0];
}

/**
 * The model key a def draws, or null when the content key is unknown.
 *
 * Pure and synchronous — no library, no GPU, no art module. This is the half of
 * resolution that `tests/cameos-coverage.spec.ts` can assert without a canvas.
 */
export function cameoModelKey(key: string, faction: Faction, isBuilding: boolean): string | null {
  const table = isBuilding ? CAMEO_BUILDING_MODELS : CAMEO_UNIT_MODELS;
  const binding = table[key];
  return binding === undefined ? null : bindingFor(binding, faction);
}

/**
 * The read side of an art library. `UnitLibrary` and `BuildingLibrary` both
 * satisfy it; declaring the shape rather than importing the classes is what
 * lets a fifth army's library join by being passed in.
 */
export interface CameoModelLibrary {
  get(key: string): { prototype(): THREE.Object3D } | undefined;
}

/** Which library owns a model key, by prefix. */
interface LibrarySet {
  units: CameoModelLibrary;
  buildings: CameoModelLibrary;
}

/**
 * Model-key prefix -> the pair of libraries that army built.
 *
 * The Pact and the Reclamation each keep a PRIVATE library on a private
 * `GreebleFactory` (their own modules explain why at length), so there is no
 * one map to ask. Prefix dispatch is the cheapest correct join and it is
 * self-describing: `meridian_oculus` can only have come out of the Pact's
 * structure library.
 */
const LIBRARIES: ReadonlyArray<readonly [string, LibrarySet]> = [
  ['meridian_', { units: meridianUnitLibrary, buildings: meridianBuildingLibrary }],
  ['reclaim_', { units: reclaimUnitLibrary, buildings: reclaimBuildingLibrary }],
  ['allied_', { units: unitLibrary, buildings: buildingLibrary }],
  ['soviet_', { units: unitLibrary, buildings: buildingLibrary }],
];

function libraryFor(modelKey: string, isBuilding: boolean): CameoModelLibrary | null {
  for (const [prefix, set] of LIBRARIES) {
    if (modelKey.startsWith(prefix)) return isBuilding ? set.buildings : set.units;
  }
  return null;
}

const TEAM_RGB = new Float32Array(3);

/**
 * LINEAR team colour for an army, matching the RenderBridge `aTeamColor`
 * contract. A faction id past the end of the palette table resolves to Neutral
 * rather than to `undefined` — that exact overflow is what once fed `NaN` into
 * an instance colour attribute and blacked out the whole frame through the
 * bloom mip chain, and a cameo writes the same channel.
 */
function teamColorOf(faction: Faction, out: THREE.Color): THREE.Color {
  const i = faction as number;
  const paletteKey = i >= 0 && i < FACTION_PALETTE_KEYS.length ? FACTION_PALETTE_KEYS[i] : 'neutral';
  hexToLinearRgb(FACTION_PALETTE[paletteKey].team, TEAM_RGB);
  return out.setRGB(TEAM_RGB[0], TEAM_RGB[1], TEAM_RGB[2]);
}

/**
 * The real provider. Resolves a def key to a primed prototype through the art
 * libraries, caching one prototype per (model, army).
 *
 * CACHING IS NOT AN OPTIMISATION HERE, IT IS THE CONTRACT. `prototype()` mints
 * fresh `THREE.Mesh` objects and `primeCameoPrototype` allocates a per-vertex
 * `aState`/`aTeamColor` shell for each. A hovered cameo re-renders at
 * `HUD_CAMEO.hoverHz`, so an uncached provider would allocate ~84 KB of buffers
 * thirty times a second at the exact moment the player is looking at it.
 *
 * A miss is a legitimate answer at two moments and only two: before the art
 * systems have run `init()` (the libraries are empty, and every cameo bound in
 * that window repaints when `invalidateAll()` fires), and for a def whose model
 * genuinely does not exist. Both fall through to the 2D silhouette.
 */
export function createCameoModelProvider(): ModelProvider {
  const cache = new Map<string, THREE.Object3D>();
  const colour = new THREE.Color();

  return (key: string, faction: Faction): THREE.Object3D | null => {
    // The subject's class is not on the provider's signature, so try the
    // structure table first and the unit table second. The two key spaces are
    // disjoint (`refinery` is never a unit, `grizzly` is never a building), so
    // the order cannot produce a wrong answer — only a wasted map lookup.
    const isBuilding = CAMEO_BUILDING_MODELS[key] !== undefined;
    const modelKey = cameoModelKey(key, faction, isBuilding);
    if (modelKey === null) return null;

    const cacheKey = `${modelKey}|${faction}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;

    const library = libraryFor(modelKey, isBuilding);
    if (library === null) return null;
    const model = library.get(modelKey);
    if (model === undefined) return null;

    const built = primeCameoPrototype(model.prototype(), teamColorOf(faction, colour));
    cache.set(cacheKey, built);
    return built;
  };
}

/* ==========================================================================
 * SECTION 4 — THE RENDERER
 * ========================================================================== */

interface Job {
  canvas: HTMLCanvasElement;
  subject: CameoSubject;
  /** Turntable angle in radians, advanced only while hovered. */
  spin: number;
  hovered: boolean;
  /** Wall-clock seconds of the last render; throttles the hover turntable. */
  lastRender: number;
  dirty: boolean;
}

export class CameoRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1.25, 0.5, 200);
  private readonly pivot = new THREE.Group();
  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly fill: THREE.HemisphereLight;

  private readonly backdropMesh: THREE.Mesh;
  private readonly backdropTex: THREE.CanvasTexture;
  private readonly backdropCanvas: HTMLCanvasElement;

  private readonly shadowMesh: THREE.Mesh;

  private rt: THREE.WebGLRenderTarget | null = null;
  private rtW = 0;
  private rtH = 0;
  private pixels = new Uint8Array(0);
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;

  // `panel`, not `temperate`: docs/refs/target-hud.png §A.1. See §1.
  private theatre: Theatre = 'panel';
  // The REAL provider by default. This field used to be `() => null` with no
  // caller anywhere, which is how a live-model cameo grid shipped as 100 %
  // hand-drawn 2D for the whole life of the module.
  private provider: ModelProvider = createCameoModelProvider();
  private current: THREE.Object3D | null = null;

  /** Keyed by canvas, so a cell that scrolls to a new def just re-registers. */
  private readonly jobs = new Map<HTMLCanvasElement, Job>();
  private readonly queue: Job[] = [];

  /** Model bounds are static; measuring one every hover frame is pure waste. */
  private readonly boundsCache = new WeakMap<THREE.Object3D, THREE.Box3>();
  private readonly scratchSize = new THREE.Vector3();
  private readonly scratchCentre = new THREE.Vector3();

  private disposed = false;
  /** Diagnostics for the boot log / debug overlay. */
  rendersThisFrame = 0;
  totalRenders = 0;
  meshHits = 0;
  fallbacks = 0;
  /**
   * Every def key that took the 2D path, for `tools/cameo-audit.mjs`.
   *
   * A Set and not a counter, because the counter alone is the number that let
   * this ship: "some cameos fall back" is a shrug, "`attackDog` and
   * `rclPylon` fall back" is a bug report. Bounded by the roster, so it cannot
   * grow without bound in a long match.
   */
  readonly fellBack = new Set<string>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Key light upper-LEFT at ~35 deg elevation, per §2.8. The rim is what
    // stops a dark hull dissolving into a dark backdrop; the hemisphere is the
    // fill (AmbientLight is banned engine-wide by the look bible).
    this.key = new THREE.DirectionalLight(0xfff0d8, 3.4);
    this.key.position.set(-2.2, 2.4, 3.0);
    this.rim = new THREE.DirectionalLight(0xbcd8ff, 1.5);
    this.rim.position.set(2.6, 1.2, -2.4);
    this.fill = new THREE.HemisphereLight(0x8fb4e8, 0x6a5c3c, 0.85);
    this.scene.add(this.key, this.rim, this.fill, this.pivot);

    // Backdrop: a plane parked behind the subject, textured from a 2D canvas so
    // the theatre swap is a repaint rather than a shader.
    // 5:4 and 4x the logical cell, because the backdrop now carries a CRISP
    // horizon rule. At 64x64 that rule was three blurred texels stretched over
    // the full plane; at 240x192 it lands inside one output pixel at every
    // shipping uiScale, which is the whole point of drawing it rather than
    // fading one gradient into the next.
    this.backdropCanvas = document.createElement('canvas');
    this.backdropCanvas.width = 240;
    this.backdropCanvas.height = 192;
    this.backdropTex = new THREE.CanvasTexture(this.backdropCanvas);
    this.backdropTex.colorSpace = THREE.SRGBColorSpace;
    this.backdropMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.backdropTex, depthWrite: false, toneMapped: false }),
    );
    this.backdropMesh.renderOrder = -100;
    this.scene.add(this.backdropMesh);

    // Contact shadow: one soft radial blob on the ground plane. Every reference
    // cameo has one and a subject without it floats instantly.
    this.shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: makeBlobTexture(),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        color: 0x000000,
        opacity: 0.55,
      }),
    );
    this.shadowMesh.rotation.x = -Math.PI * 0.5;
    this.scene.add(this.shadowMesh);

    this.scratch = document.createElement('canvas');
    const sctx = this.scratch.getContext('2d');
    if (!sctx) throw new Error('[hud] 2D context unavailable for the cameo blitter');
    this.scratchCtx = sctx;

    this.paintBackdrop();
  }

  /* -- configuration ------------------------------------------------------ */

  setModelProvider(fn: ModelProvider): void {
    this.provider = fn;
    // Every cached cameo was drawn against the OLD provider; a model landing
    // mid-match must replace the fallbacks rather than wait for a tab switch.
    for (const job of this.jobs.values()) this.markDirty(job);
  }

  setTheatre(t: Theatre): void {
    if (this.theatre === t) return;
    this.theatre = t;
    this.paintBackdrop();
    for (const job of this.jobs.values()) this.markDirty(job);
  }

  /** Environment map for the physical materials the unit factory produces. */
  setEnvironment(env: THREE.Texture | null): void {
    this.scene.environment = env;
  }

  /* -- registration ------------------------------------------------------- */

  /**
   * Bind a cell canvas to a subject. Cheap and idempotent: re-binding the same
   * subject does nothing, re-binding a different one queues one render.
   */
  bind(canvas: HTMLCanvasElement, subject: CameoSubject): void {
    const existing = this.jobs.get(canvas);
    if (existing && existing.subject.key === subject.key && existing.subject.faction === subject.faction) {
      existing.subject = subject;
      return;
    }
    // `dirty` starts FALSE on purpose: markDirty() is what pushes the job onto
    // the render queue, and it early-outs on an already-dirty job. Being born
    // dirty means being born unqueued, i.e. never rendered at all.
    const job: Job = existing ?? {
      canvas,
      subject,
      spin: 0,
      hovered: false,
      lastRender: 0,
      dirty: false,
    };
    job.subject = subject;
    job.spin = 0;
    this.jobs.set(canvas, job);
    this.markDirty(job);
  }

  unbind(canvas: HTMLCanvasElement): void {
    const job = this.jobs.get(canvas);
    if (!job) return;
    this.jobs.delete(canvas);
    const i = this.queue.indexOf(job);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /** Hover starts the turntable; leaving it freezes the pose where it stopped. */
  setHovered(canvas: HTMLCanvasElement, hovered: boolean): void {
    const job = this.jobs.get(canvas);
    if (!job || job.hovered === hovered) return;
    job.hovered = hovered;
    if (!hovered) this.markDirty(job); // one last frame at the resting pose
  }

  /** Force a repaint, e.g. after a device-pixel-ratio change resized the canvas. */
  invalidateAll(): void {
    for (const job of this.jobs.values()) this.markDirty(job);
  }

  private markDirty(job: Job): void {
    if (job.dirty) return;
    job.dirty = true;
    this.queue.push(job);
  }

  /* -- per-frame ---------------------------------------------------------- */

  frame(time: number, dt: number): void {
    if (this.disposed) return;
    this.rendersThisFrame = 0;

    /*
     * SUSPEND THE WORLD'S FOG OF WAR FOR THE DURATION OF THIS FRAME'S RENDERS.
     *
     * Cameo prototypes are the SAME materials the world draws with, and those
     * materials now self-tint from the shroud mask (`FogOfWar` §1b). The tint is
     * sampled at world XZ — and a cameo prototype sits at the ORIGIN, i.e. the
     * corner of the map, which is unexplored in every normal match. So every
     * cameo resolved to `uFogDark` at alpha 1.0 and rendered as a black
     * silhouette.
     *
     * Measured: mean luminance 18/255 with the tint live, 57-80/255 with it
     * suspended, peak 182 -> 254.
     *
     * Suspending here rather than at the call site is deliberate: this is a
     * property of rendering a cameo at all, not of who asked for one, and a
     * second caller would otherwise reintroduce the bug. Safe on ordering
     * because the world has already drawn by the time the HUD's render phase
     * runs, and the value is restored before returning.
     */
    const fogAmount = shroudUniforms.uFogAmount.value;
    shroudUniforms.uFogAmount.value = 0;
    try {
      this.drainQueue(time, dt);
    } finally {
      shroudUniforms.uFogAmount.value = fogAmount;
    }
  }

  private drainQueue(time: number, dt: number): void {

    // Hovered cameos re-arm themselves at HUD_CAMEO.hoverHz. Everything else is
    // pure cache, which is why an idle sidebar costs zero GPU.
    const hoverPeriod = 1 / HUD_CAMEO.hoverHz;
    const spinStep = THREE.MathUtils.degToRad(HUD_CAMEO.turntableDegPerSec) * dt;
    for (const job of this.jobs.values()) {
      if (!job.hovered) continue;
      job.spin += spinStep;
      if (time - job.lastRender >= hoverPeriod) this.markDirty(job);
    }

    let budget = HUD_CAMEO.perFrameBudget;
    while (budget > 0 && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job || !job.dirty) continue;
      job.dirty = false;
      if (!this.jobs.has(job.canvas)) continue;
      this.render(job, time);
      // `rendersThisFrame` was zeroed at the top of `frame()` and then never
      // incremented, so the field the debug overlay and every harness read to
      // answer "is the queue still draining?" was permanently 0. A drain loop
      // written against it exits on its first iteration and reports a tab
      // switch as costing one frame.
      this.rendersThisFrame++;
      budget--;
    }
  }

  /* -- the render --------------------------------------------------------- */

  private render(job: Job, time: number): void {
    const canvas = job.canvas;
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    job.lastRender = time;
    this.totalRenders++;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const model = this.provider(job.subject.key, job.subject.faction);
    if (model === null) {
      this.fallbacks++;
      this.fellBack.add(job.subject.key);
      paintFallback(ctx, w, h, job.subject, BACKDROPS[this.theatre]);
      return;
    }
    this.meshHits++;
    this.fellBack.delete(job.subject.key);

    this.ensureTarget(w * HUD_CAMEO.supersample, h * HUD_CAMEO.supersample);
    const rt = this.rt;
    if (rt === null) {
      this.fallbacks++;
      this.fellBack.add(job.subject.key);
      paintFallback(ctx, w, h, job.subject, BACKDROPS[this.theatre]);
      return;
    }

    // --- pose ------------------------------------------------------------
    this.pivot.clear();
    // Reset BEFORE measuring: Box3.setFromObject reads matrixWorld, and the
    // pivot still carries the previous cameo's offset and turntable angle.
    // Measuring through that produces a box that drifts a little further off
    // every hover frame, which reads as the subject slowly sliding out of shot.
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.add(model);
    this.pivot.updateMatrixWorld(true);
    this.current = model;

    const box = this.boundsOf(model);
    const size = this.scratchSize;
    const centre = this.scratchCentre;
    box.getSize(size);
    box.getCenter(centre);
    // Framing radius for the lights and the backdrop only. The CAMERA is fitted
    // per axis below — a single bounding radius pads a wide flat War Factory as
    // if it were a sphere and leaves it filling barely half the cell.
    const radius = Math.max(0.35, 0.5 * Math.max(size.x, size.y, size.z));

    // Recentre horizontally, keep the model standing ON the ground plane so the
    // contact shadow lands where the tracks are.
    this.pivot.position.set(-centre.x, -box.min.y, -centre.z);
    this.pivot.rotation.y = THREE.MathUtils.degToRad(HUD_CAMEO.yawDeg) + job.spin;

    const aspect = w / h;
    this.camera.aspect = aspect;
    // Fit per axis and take the binding one, so the subject fills
    // HUD_CAMEO.subjectFill of whichever dimension runs out first. The width
    // term uses the FOOTPRINT DIAGONAL because the three-quarter yaw turns a
    // 12 x 12 m pad into a ~17 m wide silhouette; using max(x, z) would clip
    // the corners of every square structure.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const tanHalf = Math.tan(vFov * 0.5);
    const halfW = 0.5 * Math.hypot(size.x, size.z);
    const halfH = 0.5 * size.y;
    const fitH = halfH / tanHalf;
    const fitW = halfW / (tanHalf * Math.max(0.001, aspect));
    const dist = Math.max(0.6, Math.max(fitH, fitW) / HUD_CAMEO.subjectFill);

    const pitch = THREE.MathUtils.degToRad(HUD_CAMEO.pitchDeg);
    // Aim a little below the box centre so the subject sits high enough for the
    // name label, which is drawn straight over the bottom of the art.
    const cy = size.y * 0.42;
    this.camera.position.set(0, cy + dist * Math.sin(pitch), dist * Math.cos(pitch));
    this.camera.lookAt(0, cy, 0);
    this.camera.near = Math.max(0.05, dist - radius * 3);
    this.camera.far = dist + radius * 8;
    this.camera.updateProjectionMatrix();

    // Lights scale with the subject or a 60 m warship gets a 2 m key light.
    this.key.position.set(-radius * 1.8, radius * 2.0, radius * 2.4);
    this.rim.position.set(radius * 2.2, radius * 1.0, -radius * 2.0);

    // Backdrop plane parked just in front of the far clip, sized to fill.
    const bz = this.camera.far * 0.82;
    const bh = 2 * bz * Math.tan(vFov * 0.5);
    this.backdropMesh.position.set(0, cy, 0);
    this.backdropMesh.scale.set(bh * aspect * 1.05, bh * 1.05, 1);
    this.backdropMesh.quaternion.copy(this.camera.quaternion);
    this.backdropMesh.position.copy(this.camera.position);
    this.backdropMesh.translateZ(-bz);

    this.shadowMesh.position.set(0, 0.012, 0);
    this.shadowMesh.scale.set(radius * 3.1, radius * 3.1, 1);

    // --- draw ------------------------------------------------------------
    const prevTarget = this.renderer.getRenderTarget();
    const prevExposure = this.renderer.toneMappingExposure;
    const prevScissorTest = this.renderer.getScissorTest();
    // Cameos are the "twenty tiny photographs" exception to the frame's tone
    // contract; at the world's exposure they read as twenty dark smudges.
    this.renderer.toneMappingExposure = prevExposure * 1.42;
    this.renderer.setScissorTest(false);
    this.renderer.setRenderTarget(rt);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(rt, 0, 0, this.rtW, this.rtH, this.pixels);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMappingExposure = prevExposure;
    this.renderer.setScissorTest(prevScissorTest);

    this.pivot.clear();
    this.current = null;

    // --- blit -------------------------------------------------------------
    // GL reads bottom-up; flip while copying rows so the ImageData is upright.
    const img = this.scratchCtx.createImageData(this.rtW, this.rtH);
    const dst = img.data;
    const src = this.pixels;
    const stride = this.rtW * 4;
    for (let y = 0; y < this.rtH; y++) {
      const s = (this.rtH - 1 - y) * stride;
      dst.set(src.subarray(s, s + stride), y * stride);
    }
    this.scratchCtx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.scratch, 0, 0, this.rtW, this.rtH, 0, 0, w, h);

    // The same crisp frame the fallback draws, so a grid that is half meshes
    // and half fallbacks still reads as one set of framed photographs. It goes
    // on the ART canvas rather than in CSS on purpose: the disabled state is a
    // filter on this canvas, and §2.8 requires that tint to be uniform with no
    // wipe boundary — a CSS frame would stay cold inside a sepia cameo.
    paintCameoFrame(ctx, w, h, job.subject.faction);
  }

  /** Local-space bounds of a prototype, measured once and cached. */
  private boundsOf(model: THREE.Object3D): THREE.Box3 {
    let box = this.boundsCache.get(model);
    if (box === undefined) {
      box = new THREE.Box3().setFromObject(model);
      this.boundsCache.set(model, box);
    }
    return box;
  }

  private ensureTarget(w: number, h: number): void {
    const tw = Math.max(8, Math.round(w));
    const th = Math.max(8, Math.round(h));
    if (this.rt !== null && this.rtW === tw && this.rtH === th) return;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(tw, th, {
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rtW = tw;
    this.rtH = th;
    this.pixels = new Uint8Array(tw * th * 4);
    this.scratch.width = tw;
    this.scratch.height = th;
  }

  /** Repaint the backdrop for the current theatre. */
  private paintBackdrop(): void {
    const c = this.backdropCanvas;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    paintDiorama(ctx, c.width, c.height, BACKDROPS[this.theatre]);
    this.backdropTex.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pivot.clear();
    this.current = null;
    this.jobs.clear();
    this.queue.length = 0;
    this.rt?.dispose();
    this.rt = null;
    this.backdropTex.dispose();
    (this.backdropMesh.material as THREE.Material).dispose();
    this.backdropMesh.geometry.dispose();
    const sm = this.shadowMesh.material as THREE.MeshBasicMaterial;
    sm.map?.dispose();
    sm.dispose();
    this.shadowMesh.geometry.dispose();
    this.scene.clear();
  }
}

/* ==========================================================================
 * SECTION 5 — THE DIORAMA BACKDROP AND FRAME
 *
 * Shared by BOTH cameo paths. The 3D path textures its backdrop plane from
 * `paintDiorama`; the fallback painter calls the same function straight onto
 * the cell canvas. One function, so a grid that is half real meshes and half
 * fallbacks cannot drift into two different-looking sets of pictures.
 *
 * NO NOISE. Every value here is either a broad two-stop ramp across the whole
 * cell or a hard-edged rule exactly one design pixel thick. The old backdrop
 * faded sky into ground over ~15 texels of a 64 px canvas, which at cell size
 * read as a soft brown smear where the horizon should be; a horizon is a LINE.
 * ========================================================================== */

/** Fraction of the cell height at which sky meets ground. */
const HORIZON = 0.62;

/** One design pixel of the 60 x 48 art box, in this canvas's own pixels. */
function designPx(h: number): number {
  return Math.max(1, Math.round(h / 48));
}

/**
 * The reference's cell: near-black blue, brightest just behind the subject,
 * sinking to the rim. One radial ramp and one broad vertical ramp over it —
 * TARGET_LOOK §A.1's `#0d1526` -> `#080d18`, read inward.
 *
 * No horizon and no sun disc, and both omissions are the point. The theatre
 * backdrops put a bright sky behind a pale concrete structure, and at 60 x 48
 * an Allied Construction Yard against `#8CB4D6` has no silhouette left. The
 * reference solves it the way every modern command interface does: the subject
 * is the only lit thing in the cell.
 */
function paintPanel(ctx: CanvasRenderingContext2D, w: number, h: number, b: Backdrop): void {
  ctx.fillStyle = b.groundNear;
  ctx.fillRect(0, 0, w, h);

  // The lift behind the subject. Centred slightly above middle because the
  // subject stands on the lower two-thirds of the cell and the glow wants to be
  // behind its mass, not under its feet.
  const lift = ctx.createRadialGradient(w * 0.5, h * 0.44, 0, w * 0.5, h * 0.44, w * 0.72);
  lift.addColorStop(0, b.skyTop);
  lift.addColorStop(0.55, b.groundFar);
  lift.addColorStop(1, b.groundNear);
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, w, h);

  // A single cool wash from the upper left, at the same angle as the key light.
  // This is what stops the cell reading as flat black card; it is one broad
  // ramp at low alpha, never a texture.
  const wash = ctx.createLinearGradient(0, 0, w * 0.9, h);
  wash.addColorStop(0, b.sun);
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

function paintDiorama(ctx: CanvasRenderingContext2D, w: number, h: number, b: Backdrop): void {
  if (b.panel === true) {
    paintPanel(ctx, w, h, b);
    return;
  }

  const horizon = Math.round(h * HORIZON);
  const px = designPx(h);

  // --- sky: one broad two-stop ramp, nothing else ------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, b.skyTop);
  sky.addColorStop(1, b.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  // Sun bloom upper-left, matching the key light. Tight and weak on purpose: a
  // wide high-alpha wash lifts the whole sky into the subject's value range and
  // the silhouette stops reading against it. The cameo is allowed to be
  // saturated (§2.8) but it still has to have a figure and a ground.
  const sun = ctx.createRadialGradient(w * 0.24, h * 0.16, 0, w * 0.24, h * 0.16, w * 0.36);
  sun.addColorStop(0, b.sun);
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, horizon);
  ctx.globalAlpha = 1;

  // --- ground ------------------------------------------------------------
  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, b.groundFar);
  ground.addColorStop(1, b.groundNear);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);

  // --- the horizon, drawn as a rule -------------------------------------
  // A pale haze band immediately above it and a hard dark rule on it. Two
  // integer-aligned fills, so the boundary is exactly as sharp as the canvas
  // can make it at every uiScale.
  const haze = ctx.createLinearGradient(0, horizon - px * 5, 0, horizon);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(1, 'rgba(255,255,255,0.22)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - px * 5, w, px * 5);
  ctx.fillStyle = 'rgba(12,14,18,0.55)';
  ctx.fillRect(0, horizon, w, px);

  // --- corner falloff ----------------------------------------------------
  // The darkest pixels in the cell belong at the edges; that is what pushes the
  // eye to the middle where the subject is.
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.24, w * 0.5, h * 0.5, w * 0.80);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.40)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

/**
 * The crisp cell frame.
 *
 * TARGET_LOOK §A.1: a DOUBLE line — a thin dark outer rim, a gap, then a
 * brighter lit inner bevel, brightest on the top and left edges and cooler on
 * the bottom and right. "The bevel reads as a lit metal channel, not a CSS
 * border", and the difference from what we had is that the lit edge is a single
 * crisp line rather than a soft multi-stop ramp.
 *
 * Every edge is an integer-aligned `fillRect`, never `strokeRect`, so no line
 * lands on a half pixel and doubles its width into a grey smear.
 *
 * The accent comes from `FACTION_PALETTE[...].hudAccent`, which is READ and
 * never written — the same rule `ui/Chrome.accentFor()` follows. The old code
 * picked between two hard-coded skins, so the Meridian Pact and the
 * Reclamation both drew an Allied frame; a fifth army now gets its own by
 * existing in the palette table.
 */
function paintCameoFrame(ctx: CanvasRenderingContext2D, w: number, h: number, faction: Faction): void {
  const i = faction as number;
  const paletteKey = i >= 0 && i < FACTION_PALETTE_KEYS.length ? FACTION_PALETTE_KEYS[i] : 'neutral';
  const accent = FACTION_PALETTE[paletteKey].hudAccent;
  const t = designPx(h);

  // 1. Dark outer rim, all four sides. This is the terminator that separates
  //    one cell from the next when the grid has no gaps.
  ctx.fillStyle = 'rgba(3,5,10,0.94)';
  ctx.fillRect(0, 0, w, t);
  ctx.fillRect(0, h - t, w, t);
  ctx.fillRect(0, 0, t, h);
  ctx.fillRect(w - t, 0, t, h);

  // 2. The gap is simply not drawn: one design pixel of backdrop between the
  //    rim and the bevel is what makes the pair read as two lines rather than
  //    as one thick one.

  // 3. The lit inner bevel. Top and left carry the brightest value, bottom and
  //    right a cooler, dimmer one — the light is upper-left everywhere in this
  //    interface and the cell frame is not an exception.
  const inset = t * 2;
  ctx.fillStyle = rgba(accent, 0.85);
  ctx.fillRect(inset, inset, w - inset * 2, t);
  ctx.fillRect(inset, inset, t, h - inset * 2);

  ctx.fillStyle = rgba(mixHex(accent, '#0A1220', 0.45), 0.85);
  ctx.fillRect(inset, h - inset - t, w - inset * 2, t);
  ctx.fillRect(w - inset - t, inset, t, h - inset * 2);

  // 4. Corner brackets: short bright L-shapes on the two lit corners only.
  //    §A.1 lists them as a per-panel option; on a 60 x 48 cell two is the most
  //    that reads, and four turns the frame into a ladder.
  const arm = Math.max(t * 3, Math.round(w * 0.14));
  ctx.fillStyle = rgba(mixHex(accent, '#FFFFFF', 0.45), 0.95);
  ctx.fillRect(inset, inset, arm, t);
  ctx.fillRect(inset, inset, t, arm);
  ctx.fillRect(w - inset - arm, h - inset - t, arm, t);
  ctx.fillRect(w - inset - t, h - inset - arm, t, arm);
}

/* ==========================================================================
 * SECTION 6 — THE VECTOR SILHOUETTE LIBRARY
 *
 * A cameo with no mesh behind it used to be one grey box, one darker box and
 * one lighter box, identical for all twenty slots bar a stick on top. That is
 * the "flat grey box with a tiny icon" read, and it is what this section
 * replaces: every subject now resolves to a small ASSEMBLY of solids posed in
 * a true isometric projection and painted as clean flat faces.
 *
 * THE PROJECTION
 * --------------
 *     sx = (x - z) * cos30            sy = (x + z) * sin30 - y
 *
 * The two rows are orthogonal and both have norm sqrt(2)*cos30 = 1.2247, so
 * this is a uniformly scaled orthographic view from 35.26 deg elevation — real
 * isometric, not a faked shear. Consequences used below:
 *   - a ground circle of radius r becomes an axis-aligned ellipse with
 *     semi-axes 1.2247r and 0.7071r,
 *   - a sphere of radius r becomes a circle of radius 1.2247r.
 *
 * WHICH FACE IS LIT
 * -----------------
 * +x projects to the lower-RIGHT and +z to the lower-LEFT, so a box shows its
 * top, its +z face (lower-left) and its +x face (lower-right). With the key
 * light upper-left — the same light as every other surface in this project —
 * the +z face is lit and the +x face is in shadow. Three flat values per solid,
 * a crisp panel line on every edge, and a one-pixel specular on the two upper
 * edges of the top face. That is the whole shading model: no gradients on flat
 * faces, no noise anywhere, exactly the "clean painted plastic toys" reading
 * the look bible asks for.
 *
 * Curved solids (cylinders, domes) DO get a gradient across the surface,
 * because a curved surface genuinely has one. It is a single low-frequency
 * ramp between the same three tones, never a texture.
 * ========================================================================== */

const ISO_X = Math.cos(Math.PI / 6);          // 0.8660
const ISO_Y = 0.5;
const ISO_A = Math.SQRT2 * ISO_X;             // 1.2247 — ellipse semi-major
const ISO_B = Math.SQRT2 * ISO_Y;             // 0.7071 — ellipse semi-minor

/**
 * Vertical exaggeration. True isometric at 35.26 deg squashes a tank into a
 * plate: the elevation that makes a building read is the one that makes a
 * vehicle look like a floor tile with a gun on it. Sprite-era isometric art
 * solved this by drawing everything taller than the projection says, and so do
 * we — one constant, applied inside `projY` so the bounds, the fit, the faces
 * and the ellipses all agree and nothing has to know about it.
 */
const Y_GAIN = 1.3;

function projX(x: number, z: number): number {
  return (x - z) * ISO_X;
}
function projY(x: number, z: number, y: number): number {
  return (x + z) * ISO_Y - y * Y_GAIN;
}

/** Material slots. A silhouette never names a colour, only a role. */
type Tone = 'body' | 'trim' | 'dark' | 'metal' | 'team' | 'glass' | 'tread';

interface BoxPart {
  readonly k: 'box';
  readonly x: number; readonly z: number; readonly y: number;
  readonly w: number; readonly d: number; readonly h: number;
  readonly t: Tone;
}
interface CylPart {
  readonly k: 'cyl';
  readonly x: number; readonly z: number; readonly y: number;
  readonly r: number; readonly h: number;
  readonly t: Tone;
}
interface DiscPart {
  readonly k: 'disc';
  readonly x: number; readonly z: number; readonly y: number;
  readonly r: number;
  readonly t: Tone;
}
interface DomePart {
  readonly k: 'dome';
  readonly x: number; readonly z: number; readonly y: number;
  readonly r: number;
  readonly t: Tone;
}
type Part = BoxPart | CylPart | DiscPart | DomePart;

/* Constructors. `x`/`z` are the CENTRE in plan, `y` is the BASE height. */
const bx = (x: number, z: number, y: number, w: number, d: number, h: number, t: Tone): BoxPart =>
  ({ k: 'box', x, z, y, w, d, h, t });
const cy = (x: number, z: number, y: number, r: number, h: number, t: Tone): CylPart =>
  ({ k: 'cyl', x, z, y, r, h, t });
const dc = (x: number, z: number, y: number, r: number, t: Tone): DiscPart =>
  ({ k: 'disc', x, z, y, r, t });
const dm = (x: number, z: number, y: number, r: number, t: Tone): DomePart =>
  ({ k: 'dome', x, z, y, r, t });

/** A flat ground pad, shared by every structure so they all sit on something. */
const pad = (w: number, d: number): BoxPart => bx(0, 0, -0.34, w, d, 0.34, 'dark');

export type CameoArchetype =
  | 'conyard' | 'power' | 'refinery' | 'barracks' | 'warfactory' | 'radar'
  | 'lab' | 'superweapon' | 'silo' | 'helipad' | 'wall' | 'repairbay' | 'depot'
  | 'turret' | 'aa' | 'tesla' | 'prism'
  | 'tank' | 'heavyTank' | 'artillery' | 'harvester' | 'apc' | 'mcv'
  | 'aircraft' | 'helicopter' | 'ship' | 'rifleman' | 'rocketeer' | 'dog';

/**
 * PARTS ARE AUTHORED IN DRAW ORDER, back to front. No depth sort runs.
 *
 * A painter's-algorithm sort on `x + z` is right for solids that do not
 * interpenetrate and wrong the moment one does — a barrel entering a turret, a
 * team slab lying on a wall, a rotor over a fuselage. Twenty-eight hand-ordered
 * lists are both cheaper and more controllable than a sort plus the special
 * cases needed to correct it.
 */
const SILHOUETTES: Readonly<Record<CameoArchetype, readonly Part[]>> = {
  /* --- structures ------------------------------------------------------- */

  conyard: [
    pad(9.4, 9.0),
    cy(2.7, -2.7, 0, 0.24, 5.0, 'metal'),                       // crane mast
    bx(0.4, -2.7, 4.86, 4.8, 0.24, 0.24, 'metal'),              // jib
    bx(-1.5, -2.7, 3.9, 0.16, 0.16, 0.96, 'metal'),             // hook line
    bx(-1.2, -0.4, 0, 5.2, 5.6, 3.0, 'body'),                   // main hall
    bx(-1.2, 2.46, 0.9, 3.6, 0.12, 0.85, 'team'),               // team slab
    bx(-1.2, -0.4, 3.0, 5.4, 5.8, 0.26, 'trim'),                // roof lip
    bx(2.7, 2.2, 0, 3.4, 3.6, 1.6, 'trim'),                     // front wing
  ],

  power: [
    pad(7.8, 7.8),
    cy(1.9, -2.2, 0, 0.72, 4.6, 'metal'),
    cy(3.1, -0.5, 0, 0.54, 3.4, 'metal'),
    bx(-0.8, 0.2, 0, 5.0, 5.4, 2.2, 'body'),
    bx(-0.8, 0.2, 2.2, 3.2, 3.6, 0.34, 'trim'),                 // roof vent
    bx(-0.8, 2.96, 0.7, 3.2, 0.12, 0.7, 'team'),
  ],

  refinery: [
    pad(9.4, 8.4),
    cy(2.6, -1.8, 0, 1.45, 3.4, 'metal'),                       // ore silo
    dm(2.6, -1.8, 3.4, 1.45, 'metal'),
    bx(-1.4, 0.2, 0, 5.4, 5.0, 2.1, 'body'),
    bx(-1.4, 0.2, 2.1, 5.6, 5.2, 0.24, 'trim'),
    bx(-1.4, 2.76, 0.7, 3.4, 0.12, 0.7, 'team'),
    bx(-1.4, 3.6, 0, 4.2, 2.2, 0.36, 'dark'),                   // unload ramp
  ],

  barracks: [
    pad(8.4, 7.4),
    cy(-2.8, -2.4, 0, 0.14, 4.4, 'metal'),                      // flag mast
    bx(-2.05, -2.4, 3.5, 1.5, 0.08, 0.82, 'team'),
    bx(0, -0.4, 0, 6.0, 4.6, 1.9, 'body'),
    bx(0, -0.4, 1.9, 6.2, 4.8, 0.28, 'trim'),
    bx(0, 1.95, 0, 1.5, 0.14, 1.35, 'dark'),                    // doorway
    bx(-2.1, 1.95, 1.2, 1.1, 0.1, 0.42, 'team'),
  ],

  warfactory: [
    pad(9.6, 8.6),
    bx(-0.4, -0.6, 0, 6.4, 5.2, 2.4, 'body'),
    bx(-0.4, -0.6, 2.4, 6.6, 5.4, 0.3, 'trim'),
    cy(2.5, -2.2, 2.7, 0.46, 1.2, 'metal'),                     // roof extract
    bx(-0.4, 2.06, 0, 3.6, 0.16, 1.85, 'dark'),                 // roller door
    bx(-0.4, 2.06, 1.85, 3.6, 0.16, 0.4, 'team'),
  ],

  radar: [
    pad(8.0, 8.0),
    cy(2.0, -1.8, 0, 0.42, 3.2, 'metal'),
    dm(2.0, -1.8, 3.2, 1.5, 'trim'),                            // dish
    bx(-0.8, 0.4, 0, 4.8, 4.8, 2.2, 'body'),
    bx(-0.8, 0.4, 2.2, 5.0, 5.0, 0.24, 'trim'),
    bx(-0.8, 2.86, 0.7, 3.0, 0.12, 0.7, 'team'),
  ],

  lab: [
    pad(8.0, 8.0),
    bx(0, 0.2, 0, 5.0, 5.0, 1.8, 'body'),
    dc(0, 0.2, 1.82, 2.4, 'trim'),                              // collar
    dm(0, 0.2, 1.86, 2.0, 'glass'),
    bx(0, 2.76, 0.6, 3.0, 0.12, 0.62, 'team'),
  ],

  superweapon: [
    pad(9.0, 9.0),
    cy(0, 0, 0, 3.0, 1.5, 'body'),
    dc(0, 0, 1.52, 3.05, 'team'),                               // emitter ring
    dm(0, 0, 1.56, 2.5, 'glass'),
    bx(-3.3, 0, 0, 0.7, 0.7, 2.6, 'metal'),
    bx(3.3, 0, 0, 0.7, 0.7, 2.6, 'metal'),
  ],

  silo: [
    pad(7.6, 6.2),
    cy(-1.5, -0.2, 0, 1.25, 2.9, 'metal'), dm(-1.5, -0.2, 2.9, 1.25, 'trim'),
    cy(1.5, 0.2, 0, 1.25, 2.9, 'metal'), dm(1.5, 0.2, 2.9, 1.25, 'trim'),
    bx(0, 2.4, 0, 4.6, 0.5, 0.5, 'team'),
  ],

  helipad: [
    pad(8.6, 8.6),
    bx(0, 0, 0, 7.0, 7.0, 0.42, 'trim'),
    bx(-1.05, 0, 0.42, 0.46, 2.8, 0.06, 'team'),                // the H
    bx(1.05, 0, 0.42, 0.46, 2.8, 0.06, 'team'),
    bx(0, 0, 0.42, 2.2, 0.46, 0.06, 'team'),
  ],

  wall: [
    bx(0, 0, -0.3, 7.4, 2.6, 0.3, 'dark'),
    bx(-2.35, 0, 0, 1.9, 1.9, 1.5, 'trim'),
    bx(0, 0, 0, 1.9, 1.9, 1.5, 'trim'),
    bx(2.35, 0, 0, 1.9, 1.9, 1.5, 'trim'),
  ],

  repairbay: [
    pad(8.8, 8.8),
    bx(0, 0, 0, 6.8, 6.8, 0.32, 'trim'),                        // repair deck
    bx(0, 0, 0.32, 4.4, 4.4, 0.05, 'team'),                     // painted pad
    bx(0, -2.5, 0.32, 1.8, 1.5, 1.5, 'body'),                   // control box
    bx(-2.7, 0.2, 0.32, 0.6, 0.6, 2.6, 'metal'),                // gantry posts
    bx(2.7, 0.2, 0.32, 0.6, 0.6, 2.6, 'metal'),
    bx(0, 0.2, 2.92, 6.0, 0.6, 0.5, 'metal'),                   // gantry beam
  ],

  depot: [
    pad(8.2, 7.6),
    bx(0, -0.2, 0, 5.4, 5.0, 2.0, 'body'),
    bx(0, -0.2, 2.0, 5.6, 5.2, 0.26, 'trim'),
    bx(0, 2.36, 0, 1.6, 0.14, 1.3, 'dark'),
    bx(-1.8, 2.36, 1.45, 1.5, 0.12, 0.42, 'team'),
  ],

  /* --- defences --------------------------------------------------------- */

  turret: [
    pad(5.0, 5.0),
    bx(0, 0, 0, 2.9, 2.9, 0.95, 'body'),
    bx(0, 0, 0.95, 2.2, 2.2, 0.95, 'body'),
    bx(0, 1.16, 1.2, 1.3, 0.1, 0.42, 'team'),
    bx(2.0, 0, 1.32, 2.7, 0.34, 0.34, 'metal'),                 // barrel
  ],

  aa: [
    pad(5.0, 5.0),
    bx(0, 0, 0, 2.9, 2.9, 0.9, 'body'),
    bx(0, 0, 0.9, 1.9, 1.9, 0.75, 'body'),
    bx(0.45, -0.45, 1.55, 0.28, 0.28, 2.5, 'metal'),
    bx(0.45, 0.45, 1.55, 0.28, 0.28, 2.5, 'metal'),
    bx(-0.75, 0.98, 1.05, 0.9, 0.1, 0.4, 'team'),
  ],

  tesla: [
    pad(4.6, 4.6),
    bx(0, 0, 0, 2.4, 2.4, 1.05, 'body'),
    cy(0, 0, 1.05, 0.3, 2.5, 'metal'),
    dc(0, 0, 3.55, 1.2, 'metal'),
    dc(0, 0, 3.95, 0.85, 'metal'),
    dm(0, 0, 4.05, 0.62, 'glass'),
  ],

  prism: [
    pad(4.6, 4.6),
    bx(0, 0, 0, 2.5, 2.5, 1.0, 'body'),
    bx(0, 0, 1.0, 1.5, 1.5, 1.4, 'body'),
    bx(0, 0, 2.4, 0.95, 0.95, 1.25, 'trim'),
    bx(0, 0, 3.65, 0.55, 0.55, 1.0, 'glass'),
  ],

  /* --- vehicles --------------------------------------------------------- */

  /* Vehicles run their LONG AXIS ALONG +z, i.e. nose toward the lower-left.
     Authored along +x first, they came out nose-right with the gun barrel
     projecting into the lower-right corner and the near track drawn as a black
     slab across the hull — every vehicle read as a shed with a ramp. Along z
     the lit (+z) face is the one the nose presents to the camera, the tracks
     flank left and right where the eye expects them, and the barrel exits into
     the empty lower-left of the cell instead of off the edge. */

  tank: [
    bx(-1.2, 0, 0, 0.95, 3.5, 0.95, 'tread'),
    bx(0, 0, 0.62, 1.85, 3.3, 0.55, 'body'),                    // hull, ON the tracks
    bx(0, -1.05, 1.17, 1.6, 1.2, 0.3, 'trim'),                  // engine deck
    bx(0, 1.5, 0.62, 1.6, 0.75, 0.36, 'body'),                  // glacis
    bx(1.2, 0, 0, 0.95, 3.5, 0.95, 'tread'),
    bx(0, 0.2, 1.17, 1.55, 1.7, 0.8, 'body'),                   // turret
    bx(0, 0.2, 1.97, 0.95, 1.05, 0.05, 'team'),   // turret roof plate
    bx(0, 1.95, 1.5, 0.3, 2.2, 0.3, 'metal'),                   // barrel
  ],

  heavyTank: [
    bx(-1.45, 0, 0, 1.15, 4.0, 1.1, 'tread'),
    bx(0, 0, 0.72, 2.2, 3.8, 0.62, 'body'),
    bx(0, -1.2, 1.34, 1.9, 1.4, 0.34, 'trim'),
    bx(0, 1.75, 0.72, 1.9, 0.85, 0.4, 'body'),
    bx(1.45, 0, 0, 1.15, 4.0, 1.1, 'tread'),
    bx(0, 0.25, 1.34, 1.95, 2.0, 0.95, 'body'),                 // turret
    bx(0, 0.25, 2.29, 1.2, 1.25, 0.05, 'team'),   // turret roof plate
    bx(-0.42, 2.2, 1.72, 0.3, 2.4, 0.3, 'metal'),
    bx(0.42, 2.2, 1.72, 0.3, 2.4, 0.3, 'metal'),
  ],

  artillery: [
    bx(-1.2, -0.3, 0, 0.95, 3.4, 0.95, 'tread'),
    bx(0, -0.3, 0.62, 1.85, 3.2, 0.5, 'body'),
    bx(1.2, -0.3, 0, 0.95, 3.4, 0.95, 'tread'),
    bx(0, -1.15, 1.12, 1.6, 1.5, 0.85, 'body'),                 // cradle
    bx(0, -0.38, 1.34, 0.85, 0.06, 0.34, 'team'),
    bx(0, -1.0, 1.62, 0.66, 0.9, 0.62, 'dark'),                 // breech
    bx(0, 1.3, 1.72, 0.34, 3.8, 0.34, 'metal'),                 // tube
  ],

  harvester: [
    bx(-1.45, -0.2, 0, 1.1, 3.6, 1.0, 'tread'),
    bx(0, -0.5, 0.66, 2.2, 3.1, 0.9, 'body'),
    bx(1.45, -0.2, 0, 1.1, 3.6, 1.0, 'tread'),
    bx(0, -1.0, 1.56, 2.1, 2.2, 1.3, 'trim'),                   // ore bin
    bx(0, 0.14, 1.86, 1.2, 0.06, 0.5, 'team'),
    bx(0, 1.6, 0.5, 2.3, 1.3, 0.6, 'metal'),                    // intake head
    bx(0, 1.6, 1.1, 2.4, 1.4, 0.14, 'dark'),
  ],

  apc: [
    bx(-1.15, 0, 0, 0.9, 3.3, 0.9, 'tread'),
    bx(0, -0.4, 0.6, 1.85, 2.9, 1.0, 'body'),
    bx(0, 1.35, 0.6, 1.6, 0.85, 0.62, 'body'),                  // sloped nose
    bx(1.15, 0, 0, 0.9, 3.3, 0.9, 'tread'),
    bx(0, 1.78, 0.78, 1.05, 0.06, 0.3, 'team'),
    bx(0, -0.7, 1.6, 0.95, 0.95, 0.44, 'trim'),                 // cupola
    bx(0, 0.2, 1.76, 0.18, 1.5, 0.18, 'metal'),
  ],

  mcv: [
    bx(-1.55, 0, 0, 1.1, 4.2, 1.05, 'tread'),
    bx(0, -0.5, 0.72, 2.4, 3.5, 1.55, 'body'),
    bx(1.55, 0, 0, 1.1, 4.2, 1.05, 'tread'),
    bx(0, 1.26, 0.82, 1.5, 0.06, 0.42, 'team'),
    bx(0, -1.0, 2.27, 2.1, 2.1, 0.42, 'trim'),                  // folded gantry
    bx(0, 1.6, 1.35, 1.9, 0.9, 0.8, 'glass'),                   // cab
    cy(0, -1.8, 2.69, 0.18, 1.2, 'metal'),
  ],

  /* Wings and engines are SPLIT LEFT AND RIGHT and drawn either side of the
     fuselage. As one full-span box the wing straddled the fuselage in z and the
     painter's algorithm had no valid order for it — the aircraft came out as a
     pile of loose plates. */
  aircraft: [
    bx(0, -2.9, 3.25, 0.85, 0.2, 1.1, 'trim'),                  // fin
    bx(0, -2.55, 2.72, 3.1, 1.0, 0.22, 'trim'),                 // tailplane
    bx(-2.95, -0.1, 2.3, 0.7, 1.5, 0.5, 'metal'),               // port nacelle
    bx(-2.0, -0.1, 2.5, 2.5, 1.9, 0.3, 'trim'),                 // port wing
    bx(0, 0.1, 2.24, 1.35, 5.0, 1.05, 'body'),                  // fuselage
    bx(0, 1.9, 2.46, 0.9, 1.3, 0.62, 'glass'),                  // canopy
    bx(0, 0.1, 3.29, 1.05, 1.3, 0.05, 'team'),
    bx(2.0, -0.1, 2.5, 2.5, 1.9, 0.3, 'trim'),                  // starboard wing
    bx(2.95, -0.1, 2.3, 0.7, 1.5, 0.5, 'metal'),                // starboard nacelle
  ],

  /* The rotor is TWO BLADES, not a disc. A filled 3.4-radius ellipse is 40% of
     the cell and swallowed the airframe whole. */
  helicopter: [
    bx(0, -2.6, 2.5, 0.3, 2.6, 0.3, 'trim'),                    // tail boom
    bx(0, -3.7, 2.55, 0.14, 0.26, 0.95, 'trim'),                // fin
    bx(-1.15, -0.4, 1.2, 0.16, 2.6, 0.5, 'metal'),              // skids
    bx(0, -0.1, 1.7, 1.85, 3.5, 1.5, 'body'),
    bx(0, 1.86, 1.95, 1.05, 0.6, 0.62, 'glass'),                // nose glazing
    bx(0, 0, 3.2, 1.1, 1.4, 0.05, 'team'),
    bx(1.15, -0.4, 1.2, 0.16, 2.6, 0.5, 'metal'),
    cy(0, 0.1, 3.25, 0.16, 0.45, 'metal'),                      // rotor mast
    bx(0, 0.1, 3.66, 6.6, 0.24, 0.08, 'dark'),                  // blades
    bx(0, 0.1, 3.66, 0.24, 6.6, 0.08, 'dark'),
  ],

  ship: [
    bx(0, 0, 0, 2.4, 7.0, 1.05, 'body'),
    bx(0, 2.9, 0, 1.5, 1.6, 1.05, 'body'),                      // bow taper
    bx(0, -0.6, 1.05, 2.0, 4.2, 0.45, 'trim'),                  // deck house
    bx(0, -1.2, 1.5, 1.5, 1.9, 0.9, 'body'),                    // bridge
    bx(0, -0.24, 1.72, 0.9, 0.06, 0.4, 'team'),
    cy(0, -1.9, 2.4, 0.13, 1.5, 'metal'),                       // mast
    bx(0, 2.1, 1.05, 0.9, 1.5, 0.5, 'metal'),                   // fore gun
    bx(0, 3.1, 1.2, 0.2, 1.5, 0.2, 'metal'),
  ],

  /* --- infantry ---------------------------------------------------------
     Narrow stance, real shoulders, small head, and the weapon carried across
     the body pointing down-left. The previous figure was one wide slab on two
     black posts wearing a full-width team panel, which read as a cabinet. */

  rifleman: [
    bx(-0.17, 0, 0.16, 0.29, 0.32, 0.62, 'trim'),               // legs
    bx(0.17, 0, 0.16, 0.29, 0.32, 0.62, 'trim'),
    bx(-0.17, 0.04, 0, 0.31, 0.42, 0.16, 'dark'),               // boots
    bx(0.17, 0.04, 0, 0.31, 0.42, 0.16, 'dark'),
    bx(0, 0, 0.78, 0.64, 0.46, 0.66, 'body'),                   // torso
    bx(0, 0.26, 0.92, 0.36, 0.06, 0.26, 'team'),
    bx(0, 0, 1.44, 0.86, 0.5, 0.24, 'body'),                    // shoulders
    bx(-0.42, 0.1, 0.92, 0.2, 0.24, 0.52, 'body'),              // arms
    bx(0.42, 0.1, 0.92, 0.2, 0.24, 0.52, 'body'),
    bx(0, 0, 1.68, 0.24, 0.24, 0.1, 'trim'),                    // neck
    dm(0, 0.02, 1.78, 0.23, 'trim'),                            // helmet
    bx(0.26, 0.62, 1.0, 0.11, 1.05, 0.11, 'metal'),             // rifle
  ],

  rocketeer: [
    bx(-0.17, 0, 0.16, 0.29, 0.32, 0.62, 'trim'),
    bx(0.17, 0, 0.16, 0.29, 0.32, 0.62, 'trim'),
    bx(-0.17, 0.04, 0, 0.31, 0.42, 0.16, 'dark'),
    bx(0.17, 0.04, 0, 0.31, 0.42, 0.16, 'dark'),
    bx(0, -0.36, 0.94, 0.64, 0.3, 0.62, 'trim'),                // backpack
    bx(0, 0, 0.78, 0.64, 0.46, 0.66, 'body'),
    bx(0, 0.26, 0.92, 0.36, 0.06, 0.26, 'team'),
    bx(0, 0, 1.44, 0.86, 0.5, 0.24, 'body'),
    bx(-0.42, 0.1, 0.92, 0.2, 0.24, 0.52, 'body'),
    bx(0.42, 0.1, 0.92, 0.2, 0.24, 0.52, 'body'),
    bx(0, 0, 1.68, 0.24, 0.24, 0.1, 'trim'),
    dm(0, 0.02, 1.78, 0.23, 'trim'),                            // helmet
    bx(0, 0.2, 1.86, 0.3, 0.06, 0.14, 'glass'),                 // visor
    bx(0.28, 0.5, 1.2, 0.2, 1.5, 0.2, 'metal'),                 // launcher tube
  ],

  dog: [
    bx(-0.26, -0.5, 0, 0.19, 0.2, 0.42, 'trim'),
    bx(0.26, -0.5, 0, 0.19, 0.2, 0.42, 'trim'),
    bx(0, -0.86, 0.72, 0.13, 0.5, 0.13, 'trim'),                // tail
    bx(0, -0.05, 0.42, 0.56, 1.4, 0.52, 'trim'),                // body
    bx(0, 0.23, 0.56, 0.06, 0.42, 0.22, 'team'),                // harness
    bx(-0.26, 0.45, 0, 0.19, 0.2, 0.42, 'trim'),
    bx(0.26, 0.45, 0, 0.19, 0.2, 0.42, 'trim'),
    bx(0, 0.82, 0.5, 0.46, 0.5, 0.48, 'trim'),                  // head
    bx(-0.14, 0.72, 0.96, 0.13, 0.15, 0.18, 'dark'),            // ears
    bx(0.14, 0.72, 0.96, 0.13, 0.15, 0.18, 'dark'),
    bx(0, 1.16, 0.5, 0.26, 0.34, 0.24, 'dark'),                 // muzzle
  ],
};

/**
 * Subjects that are in the air. The assembly is lifted by this fraction of the
 * cell height and the contact shadow stays on the ground, which is the only
 * cue at 60 x 48 that separates an aircraft from a very odd-looking tank.
 */
const AIRBORNE: Partial<Record<CameoArchetype, number>> = {
  aircraft: 0.13,
  helicopter: 0.11,
};

/**
 * Keyword resolution. Matched against `${key} ${name}` lowercased, FIRST RULE
 * WINS, so the order below is the specificity order — `war factory` must beat
 * `factory`, `tesla` must beat `tower`, and the bare `tank` catch-all sits at
 * the very bottom of the vehicle block.
 */
const ARCHETYPE_RULES: ReadonlyArray<readonly [RegExp, CameoArchetype]> = [
  // structures
  [/con.?yard|construction/, 'conyard'],
  [/refin|ore.?proc|processor/, 'refinery'],
  [/power|reactor|generator/, 'power'],
  [/war.?factory|vehicle.?fact|factory/, 'warfactory'],
  [/barrack|infantry.?prod|clon/, 'barracks'],
  [/radar|comm(and)?.?cent|spy.?sat/, 'radar'],
  [/lab|tech.?cent|battle.?lab|research/, 'lab'],
  // `nuclear` as well as `nuke`: "Nuclear Missile" carries neither `nuke` nor
  // `missile silo`, and without it the franchise's most recognisable structure
  // fell through to the generic block.
  [/chrono|nuke|nuclear|atom|missile.?silo|weather|super|iron.?curtain|vertex/, 'superweapon'],
  [/silo|storage|ore.?dump/, 'silo'],
  [/heli.?pad|air.?pad|airfield|air.?force/, 'helipad'],
  [/wall|fence|barrier|gate/, 'wall'],
  [/ship.?yard|naval|dock|sub.?pen/, 'ship'],
  [/repair|service.?depot|maintenance/, 'repairbay'],
  [/depot|outpost|garrison|storage.?shed/, 'depot'],
  // defences
  [/tesla.?coil|tesla/, 'tesla'],
  [/prism.?tower|prism|laser/, 'prism'],
  [/flak|aa.?gun|anti.?air|sam|patriot|missile.?def/, 'aa'],
  [/pillbox|turret|sentry|cannon|gun.?tower|bunker|tower/, 'turret'],
  // vehicles
  [/harvest|miner|ore.?truck|chrono.?miner/, 'harvester'],
  [/mcv|deploy|mobile.?const/, 'mcv'],
  [/artiller|v[234]|siege|catapult|howitz|mortar/, 'artillery'],
  [/apc|transport|ifv|carrier|hummer|humvee|scout|ranger/, 'apc'],
  [/apoc|mammoth|rhino|heavy.?tank|battle.?tank|kirov/, 'heavyTank'],
  [/heli|copter|hind|chinook|twinblade|rotor/, 'helicopter'],
  [/plane|jet|bomber|fighter|harrier|badger|migs?\b|aircraft/, 'aircraft'],
  [/destroyer|cruiser|frigate|gunboat|sub(marine)?\b|dreadnought|boat/, 'ship'],
  [/tank|grizzly|guardian|hammer|bull.?frog/, 'tank'],
  // infantry
  [/dog|bear|hound|k9/, 'dog'],
  [/rocket|bazooka|missile|flak.?troop|tesla.?troop|desolator|javelin/, 'rocketeer'],
  [/engineer|conscript|rifle|gi\b|guardian.?gi|soldier|sniper|spy|infantry|peacekeeper/, 'rifleman'],
];

export function archetypeFor(subject: CameoSubject): CameoArchetype {
  const hay = `${subject.key} ${subject.name}`.toLowerCase();
  for (const [re, arch] of ARCHETYPE_RULES) {
    if (re.test(hay)) {
      // A rule may fire on a name shared by a structure and a unit ("naval
      // yard" vs "destroyer"). The class flag is authoritative: a building
      // never resolves to a vehicle silhouette and vice versa.
      if (subject.isBuilding && UNIT_ARCHETYPES.has(arch)) continue;
      if (!subject.isBuilding && !UNIT_ARCHETYPES.has(arch)) continue;
      return arch;
    }
  }
  if (subject.isBuilding) return subject.tab === BuildTab.Defense ? 'turret' : 'depot';
  if (subject.tab === BuildTab.Infantry) return 'rifleman';
  return 'tank';
}

const UNIT_ARCHETYPES: ReadonlySet<CameoArchetype> = new Set<CameoArchetype>([
  'tank', 'heavyTank', 'artillery', 'harvester', 'apc', 'mcv',
  'aircraft', 'helicopter', 'ship', 'rifleman', 'rocketeer', 'dog',
]);

/**
 * The generic structure scales with its real footprint, so a 2x2 outpost and a
 * 5x5 hall do not produce the identical picture. Everything else is a fixed
 * authored assembly.
 */
function partsFor(subject: CameoSubject, arch: CameoArchetype): readonly Part[] {
  if (arch !== 'depot') return SILHOUETTES[arch];
  const fw = Math.max(1, Math.min(6, subject.footprintW || 3));
  const fh = Math.max(1, Math.min(6, subject.footprintH || 3));
  const w = 1.5 + fw * 1.15;
  const d = 1.5 + fh * 1.15;
  const ht = 1.3 + Math.min(fw, fh) * 0.32;
  return [
    pad(w + 2.4, d + 2.4),
    bx(0, -0.2, 0, w, d, ht, 'body'),
    bx(0, -0.2, ht, w + 0.22, d + 0.22, 0.26, 'trim'),
    bx(0, d * 0.5 - 0.27, 0, Math.min(1.8, w * 0.35), 0.14, ht * 0.66, 'dark'),
    bx(-w * 0.28, d * 0.5 - 0.27, ht * 0.72, w * 0.34, 0.12, 0.42, 'team'),
  ];
}

/* ==========================================================================
 * SECTION 7 — THE SILHOUETTE PAINTER
 * ========================================================================== */

interface CameoPalette {
  body: string; trim: string; dark: string;
  metal: string; team: string; glass: string; tread: string;
}

/**
 * Structure paint is a concrete/khaki neutral and vehicle paint is the faction
 * hull colour. Neither is ever the TEAM colour: R12 keeps team colour to a
 * 7-10% accent slab, which is exactly what the `team` tone is used for.
 */
function paletteFor(faction: Faction, isBuilding: boolean): CameoPalette {
  if (faction === Faction.Soviets) {
    return {
      body: isBuilding ? '#8C8368' : '#6C7444',
      trim: isBuilding ? '#A29878' : '#565C36',
      dark: '#26241E',
      metal: '#9A9086',
      team: '#C0201C',
      glass: '#E8A83C',
      tread: '#2C2A24',
    };
  }
  return {
    body: isBuilding ? '#C2C4C0' : '#B9BCC4',
    trim: isBuilding ? '#9DA0A2' : '#8E939D',
    dark: '#23242A',
    metal: '#9AA0A6',
    team: '#3B90F7',
    glass: '#7ED8FC',
    tread: '#2A2B30',
  };
}

/**
 * How far a tone is allowed to travel between its lit and shaded face.
 *
 * Team colour and glass get the shallowest ramp: they are the two things in the
 * cell that must stay saturated at cell size, and a 44% darkened team slab on
 * the shaded face reads as brown rather than as the player's colour.
 */
const TONE_LIFT: Readonly<Record<Tone, number>> = {
  body: 0.24, trim: 0.24, dark: 0.30, metal: 0.28, team: 0.18, glass: 0.30, tread: 0.22,
};
const TONE_DROP: Readonly<Record<Tone, number>> = {
  body: 0.44, trim: 0.44, dark: 0.38, metal: 0.46, team: 0.28, glass: 0.32, tread: 0.34,
};

/** [top, lit face, shaded face] for one tone. Three flat values, no texture. */
function toneRamp(pal: CameoPalette, t: Tone): readonly [string, string, string] {
  const base = pal[t];
  return [mixHex(base, '#FFFFFF', TONE_LIFT[t]), base, mixHex(base, '#0A0C12', TONE_DROP[t])];
}

interface Fit {
  /** Model units to canvas pixels. */
  s: number;
  ox: number;
  oy: number;
  /** Canvas-space centre and half-width of the ground contact patch. */
  shadowX: number;
  shadowY: number;
  shadowR: number;
}

function projectBounds(parts: readonly Part[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const push = (sx: number, sy: number): void => {
    if (sx < x0) x0 = sx;
    if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy;
    if (sy > y1) y1 = sy;
  };
  for (const p of parts) {
    if (p.k === 'box') {
      const ax = p.x - p.w * 0.5, bxx = p.x + p.w * 0.5;
      const az = p.z - p.d * 0.5, bz = p.z + p.d * 0.5;
      for (const x of [ax, bxx]) {
        for (const z of [az, bz]) {
          push(projX(x, z), projY(x, z, p.y));
          push(projX(x, z), projY(x, z, p.y + p.h));
        }
      }
    } else {
      const cx = projX(p.x, p.z);
      const rx = ISO_A * p.r;
      const ry = ISO_B * p.r;
      const top = p.k === 'cyl' ? p.y + p.h : p.y;
      const capUp = p.k === 'dome' ? rx * Y_GAIN : ry;
      push(cx - rx, projY(p.x, p.z, top) - capUp);
      push(cx + rx, projY(p.x, p.z, p.y) + ry);
    }
  }
  if (x0 > x1) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
  return { x0, x1, y0, y1 };
}

function fitAssembly(parts: readonly Part[], w: number, h: number, lift: number): Fit {
  const b = projectBounds(parts);
  const bw = Math.max(0.001, b.x1 - b.x0);
  const bh = Math.max(0.001, b.y1 - b.y0);
  // §2.8: the subject occupies 70-85% of the frame. Fit the binding axis.
  // The vertical budget is reduced by `lift` FIRST: an airborne subject is
  // raised off the ground line after fitting, so a budget that ignores the
  // lift pushes the wingtips straight out through the top of the cell.
  const vBudget = Math.max(h * 0.30, h * (0.78 - lift));
  const s = Math.min((w * 0.87) / bw, vBudget / bh);
  const groundY = h * 0.845;
  const ox = w * 0.5 - s * (b.x0 + b.x1) * 0.5;
  const oy = groundY - h * lift - s * b.y1;
  return {
    s, ox, oy,
    shadowX: w * 0.5 + s * bw * 0.05,
    shadowY: groundY,
    shadowR: Math.min(w * 0.44, s * bw * 0.40),
  };
}

/** Project a model point into canvas space. */
function sx(f: Fit, x: number, z: number): number {
  return f.ox + f.s * projX(x, z);
}
function sy(f: Fit, x: number, z: number, y: number): number {
  return f.oy + f.s * projY(x, z, y);
}

function poly(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function fillPoly(
  ctx: CanvasRenderingContext2D,
  pts: readonly (readonly [number, number])[],
  fill: string,
  line: number,
): void {
  poly(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  // The panel line. One stroke per face, at the same width as every other line
  // in the cell, drawn from a real path — never derived from a value threshold.
  ctx.strokeStyle = 'rgba(6,8,12,0.46)';
  ctx.lineWidth = line;
  ctx.stroke();
}

function drawBox(ctx: CanvasRenderingContext2D, p: BoxPart, f: Fit, pal: CameoPalette, line: number): void {
  const [top, lit, dark] = toneRamp(pal, p.t);
  const x0 = p.x - p.w * 0.5, x1 = p.x + p.w * 0.5;
  const z0 = p.z - p.d * 0.5, z1 = p.z + p.d * 0.5;
  const y0 = p.y, y1 = p.y + p.h;
  const P = (x: number, y: number, z: number): readonly [number, number] => [sx(f, x, z), sy(f, x, z, y)];

  // Top rhombus. A = back vertex, B = right, C = front, D = left.
  const A = P(x0, y1, z0), B = P(x1, y1, z0), C = P(x1, y1, z1), D = P(x0, y1, z1);
  fillPoly(ctx, [A, B, C, D], top, line);

  if (p.h > 0.0001) {
    // Lit face: z = z1, the lower-LEFT one. Shaded face: x = x1, lower-right.
    fillPoly(ctx, [P(x0, y0, z1), P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1)], lit, line);
    fillPoly(ctx, [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], dark, line);
  }

  // Law 2 on a solid: a one-line specular on the two UPPER edges of the top
  // face only. Highlighting all four turns the box into a wireframe.
  ctx.strokeStyle = rgba(mixHex(pal[p.t], '#FFFFFF', 0.62), 0.75);
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.moveTo(D[0], D[1]);
  ctx.lineTo(A[0], A[1]);
  ctx.lineTo(B[0], B[1]);
  ctx.stroke();
}

function drawCyl(ctx: CanvasRenderingContext2D, p: CylPart, f: Fit, pal: CameoPalette, line: number): void {
  const [top, lit, dark] = toneRamp(pal, p.t);
  const cx = sx(f, p.x, p.z);
  const yb = sy(f, p.x, p.z, p.y);
  const yt = sy(f, p.x, p.z, p.y + p.h);
  const rx = f.s * ISO_A * p.r;
  const ry = f.s * ISO_B * p.r;

  // Body: left edge up, front half of the top rim, right edge down, front half
  // of the bottom rim. The back halves are hidden by the solid itself.
  ctx.beginPath();
  ctx.moveTo(cx - rx, yb);
  ctx.lineTo(cx - rx, yt);
  ctx.ellipse(cx, yt, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rx, yb);
  ctx.ellipse(cx, yb, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
  g.addColorStop(0, mixHex(pal[p.t], '#FFFFFF', TONE_LIFT[p.t] * 0.5));
  g.addColorStop(0.38, lit);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(6,8,12,0.46)';
  ctx.lineWidth = line;
  ctx.stroke();

  // Top cap, flat.
  ctx.beginPath();
  ctx.ellipse(cx, yt, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = top;
  ctx.fill();
  ctx.stroke();
}

function drawDisc(ctx: CanvasRenderingContext2D, p: DiscPart, f: Fit, pal: CameoPalette, line: number): void {
  const [top] = toneRamp(pal, p.t);
  ctx.beginPath();
  ctx.ellipse(
    sx(f, p.x, p.z), sy(f, p.x, p.z, p.y),
    f.s * ISO_A * p.r, f.s * ISO_B * p.r, 0, 0, Math.PI * 2,
  );
  ctx.fillStyle = top;
  ctx.fill();
  ctx.strokeStyle = 'rgba(6,8,12,0.46)';
  ctx.lineWidth = line;
  ctx.stroke();
}

function drawDome(ctx: CanvasRenderingContext2D, p: DomePart, f: Fit, pal: CameoPalette, line: number): void {
  const [top, lit, dark] = toneRamp(pal, p.t);
  const cx = sx(f, p.x, p.z);
  const cyy = sy(f, p.x, p.z, p.y);
  // A sphere of radius r projects to a CIRCLE of radius 1.2247r under this
  // projection (the rows are orthogonal and equal-norm), which is why the cap
  // uses ISO_A and not the raw radius — then Y_GAIN stretches it into the same
  // ellipsoid every box in the scene has already been stretched into.
  const R = f.s * ISO_A * p.r;
  const rc = R * Y_GAIN;
  const ry = f.s * ISO_B * p.r;

  ctx.beginPath();
  ctx.ellipse(cx, cyy, R, rc, 0, Math.PI, 0, false);
  ctx.ellipse(cx, cyy, R, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - R * 0.7, cyy - rc, cx + R * 0.7, cyy + ry);
  g.addColorStop(0, top);
  g.addColorStop(0.5, lit);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(6,8,12,0.46)';
  ctx.lineWidth = line;
  ctx.stroke();
}

function drawAssembly(
  ctx: CanvasRenderingContext2D,
  parts: readonly Part[],
  f: Fit,
  pal: CameoPalette,
  line: number,
): void {
  ctx.lineJoin = 'round';
  for (const p of parts) {
    switch (p.k) {
      case 'box': drawBox(ctx, p, f, pal, line); break;
      case 'cyl': drawCyl(ctx, p, f, pal, line); break;
      case 'disc': drawDisc(ctx, p, f, pal, line); break;
      case 'dome': drawDome(ctx, p, f, pal, line); break;
    }
  }
}

/* ==========================================================================
 * SECTION 8 — THE FALLBACK CAMEO
 *
 * Same diorama grammar as the 3D path — graded backdrop, drawn horizon, ground
 * contact shadow, three-quarter subject, crisp cell frame — so a sidebar that
 * is half real meshes and half fallbacks still reads as one set of framed
 * photographs rather than a mixture of art and placeholder.
 * ========================================================================== */

/**
 * Draw one fallback cameo into an arbitrary 2D context. Exported so a contact
 * sheet of the whole silhouette library can be rendered without a WebGL
 * context or a live sidebar — the only way to review 28 miniatures at once.
 */
export function paintCameoFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  subject: CameoSubject,
  theatre: Theatre = 'temperate',
): void {
  paintFallback(ctx, w, h, subject, BACKDROPS[theatre]);
}

function paintFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  subject: CameoSubject,
  b: Backdrop,
): void {
  paintDiorama(ctx, w, h, b);

  const arch = archetypeFor(subject);
  const parts = partsFor(subject, arch);
  const fit = fitAssembly(parts, w, h, AIRBORNE[arch] ?? 0);
  const pal = paletteFor(subject.faction, subject.isBuilding);
  // Panel lines at 0.7 design px: heavy enough to survive the mip-free blit at
  // uiScale 1, light enough not to become a cage at uiScale 4.
  const line = Math.max(1, (w / 60) * 0.7);

  // Contact shadow first — the cue that stops the mass floating. Soft on
  // purpose: it is the one place in the cell where a gradient is the honest
  // answer, because a real contact shadow has a penumbra.
  const sh = ctx.createRadialGradient(
    fit.shadowX, fit.shadowY, 0,
    fit.shadowX, fit.shadowY, Math.max(1, fit.shadowR),
  );
  sh.addColorStop(0, 'rgba(0,0,0,0.52)');
  sh.addColorStop(0.55, 'rgba(0,0,0,0.34)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(fit.shadowX, fit.shadowY);
  ctx.scale(1, 0.32);
  ctx.translate(-fit.shadowX, -fit.shadowY);
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(fit.shadowX, fit.shadowY, Math.max(1, fit.shadowR), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawAssembly(ctx, parts, fit, pal, line);
  paintCameoFrame(ctx, w, h, subject.faction);
}

/* ==========================================================================
 * SECTION 9 — HELPERS
 * ========================================================================== */

/** Soft radial blob used as the ground contact shadow in the 3D path. */
function makeBlobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.72)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
