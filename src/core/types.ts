/**
 * ============================================================================
 * VOLTMARCH — src/core/types.ts
 * ============================================================================
 * THE CONTRACT LAYER.
 *
 * Every type that crosses a module boundary lives here. This file has ZERO
 * runtime imports and ZERO dependencies, so it can be imported from anywhere
 * (sim, render, ui, worker, test) without creating a cycle.
 *
 * RULES FOR PARALLEL AGENTS
 * -------------------------
 * 1. You may READ this file freely. You may NOT edit it. If you believe a type
 *    is missing, the answer is a module-private type in your own file, or a
 *    `PerEntity*` side array (see world.ts) — not an edit here.
 * 2. An agent implementing combat must never need to open pathfinding. That is
 *    the acceptance test for this file: every cross-module surface is described
 *    here as an interface (see the "PORTS" section) so implementations stay
 *    private.
 * 3. All event payloads are FLAT PRIMITIVES. They are pooled and reused; they
 *    are valid only for the duration of the dispatch call. Never retain one.
 *
 * NAMING
 * ------
 * `*Id`      — a branded integer handle.
 * `*Kind`    — a closed const enum of variants.
 * `*Def`     — static, immutable, data-table content (loaded once at boot).
 * `*State`   — mutable runtime state owned by exactly one module.
 * `I*`       — a port: an interface with a stub implementation in the
 *              foundation and a real implementation in one owning module.
 *
 * COORDINATE CONVENTIONS (normative — violating these is a bug)
 * ------------------------------------------------------------
 * - 1 world unit = 1 metre. Y is up. The ground plane is XZ.
 * - Model origin is the GROUND-PLANE CENTRE of the footprint, +Z is forward.
 * - `yaw` is rotation about +Y in radians, 0 = facing +Z, increasing toward +X,
 *   always stored wrapped to [-PI, PI) by `wrapAngle`. Because that range is
 *   half-open, never compare two yaws for equality — use `isFacing`.
 * - Grid cells are integer (cx, cz) with cx growing toward +X, cz toward +Z.
 *   Cell (0,0) covers world x,z in [0, CELL). Cell CENTRE is (cx+0.5)*CELL.
 * ============================================================================
 */

/* ==========================================================================
 * SECTION 1 — BRANDED HANDLES AND ID PACKING
 * ========================================================================== */

declare const __brand: unique symbol;
/** Nominal typing helper. `Brand<number,'X'>` is a number that only accepts Xs. */
type Brand<T, B extends string> = T & { readonly [__brand]: B };

/**
 * A generation-stamped entity handle: `[gen:12][index:20]`.
 *
 * - index (low 20 bits) addresses a slot in the EntityStore's parallel arrays.
 * - gen (high 12 bits) is bumped every time a slot is recycled, so a stale
 *   handle held across a death resolves to "dead" instead of silently
 *   addressing whatever unit took the slot.
 * - The value `0` is NEVER a valid entity. Generations start at 1, so a
 *   zero-filled array reads as "no entity" for free.
 */
export type EntityId = Brand<number, 'EntityId'>;

/** Index into the flat `players[]` array. 0..MAX_PLAYERS-1. */
export type PlayerId = Brand<number, 'PlayerId'>;

/** Index into a def table (UnitDef[] / BuildingDef[] / WeaponDef[]). */
export type DefId = Brand<number, 'DefId'>;

/** Key into the ModelRegistry. Produced only by MODEL_IDS. */
export type ModelId = Brand<number, 'ModelId'>;

/** Slot in the projectile store. Separate space from EntityId — NOT an entity. */
export type ProjectileId = Brand<number, 'ProjectileId'>;

/** The null handle. Always falsy, always invalid, always safe to compare. */
export const NONE = 0 as EntityId;

/** Bits reserved for the slot index. 2^20 = 1,048,576 addressable slots. */
export const ENTITY_INDEX_BITS = 20;
/** Mask for the slot index portion of an EntityId. */
export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1;
/** Generations wrap at 4096. A stale handle can only alias after 4095 reuses. */
export const ENTITY_GEN_MASK = 0xfff;

/**
 * Pack a slot index and a generation into an EntityId.
 * `gen` must be >= 1; gen 0 would produce handle 0 for slot 0, which is NONE.
 */
export function makeHandle(index: number, gen: number): EntityId {
  return (((gen & ENTITY_GEN_MASK) << ENTITY_INDEX_BITS) | (index & ENTITY_INDEX_MASK)) as EntityId;
}

/** Extract the slot index. Meaningless unless the handle is validated first. */
export function handleIndex(h: EntityId): number {
  return (h as number) & ENTITY_INDEX_MASK;
}

/** Extract the generation stamp. */
export function handleGen(h: EntityId): number {
  return ((h as number) >>> ENTITY_INDEX_BITS) & ENTITY_GEN_MASK;
}

/* ==========================================================================
 * SECTION 2 — PLAIN GEOMETRY / VALUE TYPES
 * ========================================================================== */

/** A 2D point on the ground plane. Field names are x/z, never x/y. */
export interface Vec2 { x: number; z: number; }

/** A 3D point. */
export interface Vec3 { x: number; y: number; z: number; }

/** Integer grid cell. */
export interface Cell { cx: number; cz: number; }

/** Axis-aligned rect in world metres. */
export interface Rect { minX: number; minZ: number; maxX: number; maxZ: number; }

/** Axis-aligned rect in grid cells. `w`/`h` are counts, not maxima. */
export interface CellRect { cx: number; cz: number; w: number; h: number; }

/** RGB in 0..1 linear space. */
export interface Rgb { r: number; g: number; b: number; }

/** Recursive partial, for mood presets and art patches. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/* ==========================================================================
 * SECTION 3 — CORE GAMEPLAY ENUMS
 *
 * All const enums: they compile to plain integers at the use site under
 * esbuild, and they can be stored directly in Uint8Arrays.
 * ========================================================================== */

/**
 * The four armies plus the neutral/Gaia side that owns ore, rocks and wrecks.
 * Faction drives ART (palette, silhouette language) and DEFS (tech tree).
 * Ownership is a PlayerId — two players may share a faction.
 *
 * Members are APPEND-ONLY. The value is stored in a Uint8Array column, indexes
 * `FACTION_PALETTE_KEYS`, `FACTION_PALETTE` (which is declared in this order),
 * `RenderBridge.TEAM_RGB` and every `FACTION_KEY_MAP` row in
 * `src/game/Scenarios.ts`. Inserting rather than appending re-points all five
 * at once with no error message.
 */
export const enum Faction {
  Neutral = 0,
  Allies = 1,
  Soviets = 2,
  Meridian = 3,
  /** The Reclamation. Salvage frames, arc weapons, no turret on anything. */
  Reclaim = 4,
}
/**
 * Number of members in `Faction`, i.e. the length any array indexed BY a
 * faction id must have. (Neutral occupies slot 0, so the number of playable
 * armies is `FACTION_COUNT - 1`.)
 */
export const FACTION_COUNT = 5;

/**
 * Diplomatic relation between two players. Computed from PlayerState.allyMask.
 */
export const enum Relation {
  Self = 0,
  Ally = 1,
  Enemy = 2,
  Neutral = 3,
}

/**
 * What an entity fundamentally IS. Selects which dense list it lives in and
 * which systems iterate it. Immutable for an entity's whole life EXCEPT the
 * Unit/Vehicle -> Wreck transition, which is a fresh entity, not a mutation.
 */
export const enum EntityKind {
  None = 0,
  /** Walks. One InstancedMesh, 8 baked vertex poses. */
  Infantry = 1,
  /** Drives. Hull + independently-slewing turret. */
  Vehicle = 2,
  /** Occupies a footprint on the nav grid. Never moves. */
  Building = 3,
  /** Burning husk left by a dead vehicle. Blocks nothing, decays. */
  Wreck = 4,
  /** Rock / tree / bush. Static, may be crushable, never owned. */
  Prop = 5,
  /** Pickup crate. */
  Crate = 6,
}
export const ENTITY_KIND_COUNT = 7;

/**
 * The unit's current behavioural state. Written ONLY by the system that owns
 * the behaviour (see the write-ownership table in loop.ts). Read by anyone.
 */
export const enum UnitState {
  Idle = 0,
  /** Following a flow field toward orderX/orderZ. */
  Moving = 1,
  /** Moving, but acquires and engages targets en route. */
  AttackMoving = 2,
  /** Stationary or closing on targetId, weapon hot. */
  Attacking = 3,
  /**
   * Holding a post, engaging anything in range, returning to the post
   * afterwards. The post is `guardX/guardZ`.
   *
   * THIS STATE WAS INERT. Its docstring described the behaviour the whole
   * stance system needed and nothing implemented it: `seeksGoal` omitted it, so
   * a unit given `OrderKind.Guard` did not even drive to the point it was told
   * to guard, and `Regen`/`AI` read it only as a synonym for `Idle`. It is now
   * a SEEKING state whose goal (`orderX/orderZ`) is owned by `sim/Targeting.ts`
   * — the chase goal while engaging, the post while coming home.
   */
  Guarding = 4,
  /** Harvester: driving to an ore cell. */
  SeekOre = 5,
  /** Harvester: parked on ore, cargo filling. */
  Harvesting = 6,
  /** Harvester: full, driving to a refinery. */
  ReturnToRefinery = 7,
  /** Harvester: parked at the dock socket, credits streaming in. */
  Docked = 8,
  /** MCV unfolding into a Construction Yard (or a building folding up). */
  Deploying = 9,
  /** Building ramping buildProgress 0->1. Cannot fire, cannot be captured. */
  UnderConstruction = 10,
  /** Engineer entering a structure. */
  Capturing = 11,
  /** Running away from a threat with weapons cold. */
  Fleeing = 12,
  /** Death animation playing; damage no longer applies. */
  Dying = 13,
  /** Repair drone / engineer mending a target. */
  Repairing = 14,
  /** Sold or self-destructing; refund already paid. */
  Selling = 15,
}

/**
 * How an entity resists damage. Paired with WarheadClass in the 7x6 matrix
 * that IS the counter-triangle of this game.
 */
export const enum ArmorClass {
  /** Unarmoured flesh. Shredded by small arms, immune-ish to AP shells. */
  Infantry = 0,
  /** Jeeps, harvesters, APCs. */
  Light = 1,
  /** Medium tanks. */
  Medium = 2,
  /** Heavy tanks. Small arms are nearly useless. */
  Heavy = 3,
  /** Structures. Only HE and AP meaningfully hurt these. */
  Concrete = 4,
  /** Props, crates, wrecks, walls. */
  Wood = 5,
}
export const ARMOR_CLASS_COUNT = 6;

/**
 * What a weapon fires. Selects the row of the damage matrix.
 * Exactly 7 — the matrix is 7 warheads x 6 armors.
 */
export const enum WarheadClass {
  /** Rifles, MGs. Great vs Infantry, terrible vs Heavy. */
  SmallArms = 0,
  /** Chain guns, autocannon. Good vs Light. */
  AutoCannon = 1,
  /** Solid shot. The anti-tank answer, poor splash. */
  ArmorPiercing = 2,
  /** Shells and bombs. Splash, good vs Concrete. */
  HighExplosive = 3,
  /** Guided warheads. Good vs Heavy and Concrete both. */
  Rocket = 4,
  /** Tesla. Instantly lethal to Infantry, strong vs Heavy, needs power. */
  Tesla = 5,
  /** Prism / directed energy. Ignores most armour scaling, weak splash. */
  Prism = 6,
}
export const WARHEAD_CLASS_COUNT = 7;

/**
 * How a unit occupies and traverses the world. Drives the nav cost lookup,
 * the tread/foot dust FX, and whether it can be crushed.
 */
export const enum Locomotor {
  /** Infantry. Ignores soft obstacles, cannot cross water or cliffs. */
  Foot = 0,
  /** Tracked vehicle. Crushes infantry. Slowed on rough terrain. */
  Track = 1,
  /** Wheeled vehicle. Faster on roads, worse off-road, does not crush. */
  Wheel = 2,
  /** Hovercraft. Crosses water and shallow terrain, ignores slope cost. */
  Hover = 3,
  /** Buildings, props. Never pathfinds. */
  Static = 4,
  /**
   * Aircraft. Ignores the nav grid entirely and holds `AIR_CRUISE_ALTITUDE`
   * metres over the heightfield.
   *
   * Added late, and appended rather than inserted: `SaveGame` persists this
   * column as a raw U8 (column 28) and `Terrain.passGrid` packs one bit per
   * locomotor, so renumbering an existing member would silently reinterpret
   * every saved unit and every cached passability bit. Nothing sets bit 5 of
   * `passGrid`, which is correct — `ITerrain.isPassable(_, _, Air)` is false
   * everywhere and no air code path asks it. `MoveClass.Air` is the vocabulary
   * that answers passability for flyers, and `moveClassForLocomotor` is the
   * one place the two meet.
   *
   * "NO AIR CODE PATH ASKS IT" WAS NOT TRUE, and the exception cost every
   * aircraft in the game its ability to leave a factory.
   * `Production.findEgressSpot` asked exactly this, got `false` for every cell
   * on the map, and returned no spot — so a finished aircraft sat at
   * `ready: true` with the player already charged, forever, silently. It is
   * fixed at that call site (see the block above it) rather than by lighting
   * bit 5, because a passability BIT for a class that ignores passability is a
   * lie that the next reader would have to disprove all over again. The clause
   * above is true again; it is load-bearing, and it is the kind of claim that
   * has to be re-checked whenever a new caller passes a locomotor to the grid.
   */
  Air = 5,
}

/**
 * How a projectile travels. ProjectileSystem branches on this.
 */
export const enum ProjectileKind {
  /** No projectile at all — damage applies the same tick it is fired. */
  Instant = 0,
  /** Fast flat tracer. Swept segment test, no gravity. */
  Bullet = 1,
  /** Ballistic arc under gravity. Lobbed over low obstacles. */
  Shell = 2,
  /** Turn-rate-limited homing missile with a smoke ribbon. */
  Rocket = 3,
  /** Rendered beam, applies damage instantly, persists visually for a moment. */
  Beam = 4,
  /** Chained lightning that may arc to N extra targets. */
  TeslaBolt = 5,
  /** Short-range cone of burning particles. */
  Flame = 6,
}

/** The four sidebar tabs, in display order. */
export const enum BuildTab {
  Structures = 0,
  Defense = 1,
  Infantry = 2,
  Vehicles = 3,
}
export const BUILD_TAB_COUNT = 4;

/* --------------------------------------------------------------------------
 * IN-MATCH UPGRADES — the vocabulary only. The table is `UPGRADES` in
 * config.ts and the runtime is `src/sim/Upgrades.ts`.
 *
 * THREE LAYERS THAT ARE EASY TO CONFUSE, so they are named here once:
 *
 *   VETERANCY    per-UNIT, EARNED by kills. `EntityFlag.Veteran1/2`.
 *   UNLOCKS      cross-MATCH meta, tied to the local profile. `UNLOCK_TAGS`.
 *   UPGRADES     per-PLAYER, BOUGHT with credits, lasts one match. This.
 *
 * An upgrade never re-stats an existing entity. It moves a multiplier that the
 * consuming system reads AT THE POINT OF USE, which is the only version that
 * covers units built after the purchase without a second source of truth.
 * ------------------------------------------------------------------------ */

/**
 * What an upgrade moves. One lever per authored effect; a lever is a
 * multiplier and never an absolute.
 *
 * READ THE DIRECTION OF EACH ONE — two of them are "lower is better", which is
 * exactly the sort of thing that inverts silently under a refactor:
 *   Damage      out-going damage         >1 is stronger
 *   Cooldown    seconds between shots    <1 is FASTER
 *   Armour      IN-coming damage         <1 is TOUGHER
 *   Speed       max speed                >1 is faster
 *   Sight       sight radius             >1 sees further
 *   BuildSpeed  queue progress rate      >1 builds faster
 *   Yield       credits per ore unit     >1 earns more
 */
export const enum UpgradeLever {
  Damage = 0,
  Cooldown = 1,
  Armour = 2,
  Speed = 3,
  Sight = 4,
  BuildSpeed = 5,
  Yield = 6,
}
export const UPGRADE_LEVER_COUNT = 7;

/** Which of a player's things an upgrade reaches. */
export const enum UpgradeScope {
  /** `EntityKind.Infantry` only. */
  Infantry = 0,
  /** `EntityKind.Vehicle` only. */
  Vehicle = 1,
  /** Every kind slot, including `EntityKind.None` — see UPGRADE_MUL_SLOTS. */
  All = 2,
}

/**
 * Length of `PlayerState.upgradeMul`: one float per (lever, EntityKind) pair.
 *
 * A LEVER THAT IS NOT KIND-SCOPED (BuildSpeed, Yield) is authored as
 * `UpgradeScope.All`, which writes every slot including `EntityKind.None`, and
 * its readers pass `EntityKind.None`. That keeps one array and one index
 * function rather than a second set of scalar fields that could disagree.
 */
export const UPGRADE_MUL_SLOTS = UPGRADE_LEVER_COUNT * ENTITY_KIND_COUNT;

/**
 * What the player (or AI) asked a unit to do. Produced ONLY by
 * `resolveContextOrder` so the cursor, the HUD and the AI can never disagree
 * about what a right-click means.
 */
export const enum OrderKind {
  None = 0,
  Move = 1,
  AttackMove = 2,
  /** Attack a specific entity; auto-reacquire on death is allowed. */
  Attack = 3,
  /** Attack a ground position even if empty. Never auto-reacquires. */
  ForceAttack = 4,
  Stop = 5,
  /** Hold this spot; engage in range; return here afterwards. */
  Guard = 6,
  /** Harvester: go mine, preferring the cell/field under the cursor. */
  Harvest = 7,
  /** MCV: unfold here. */
  Deploy = 8,
  /** Engineer: enter and capture. */
  Capture = 9,
  /** Engineer/mechanic: mend the target. */
  Repair = 10,
  /** Enter a transport / garrison a structure. */
  Enter = 11,
  /** Break formation and disperse (dodging splash). */
  Scatter = 12,
  /** Cycle waypoints forever. */
  Patrol = 13,
  /** Building only: move the rally flag. */
  SetRally = 14,
  /**
   * Commander only: fire the faction ability, centred on the unit itself.
   *
   * Carries no target — every commander ability is self-centred, so the order
   * needs nothing but the entity it lands on. `src/sim/Abilities.ts` consumes
   * it at Phase.Command order 9600 and clears it back to `None` the same tick,
   * exactly as `sim/deploy.system.ts` does at 9500.
   */
  UseAbility = 15,
  /**
   * Transport only: put every passenger back on the ground, here.
   *
   * APPENDED, NEVER INSERTED, for the same reason `CommandKind` carries that
   * warning: this enum is written into replay files and into the lockstep wire
   * format, so renumbering a member makes every existing recording play back a
   * different game.
   *
   * It is NOT `Deploy` with a transport on the end. Deploy means "convert into
   * the structure your def names" and `sim/Deploy.ts` validates a footprint to
   * do it; unloading validates nothing of the sort and produces no building.
   * Overloading one order with two unrelated meanings would have put the
   * distinction in an `if` inside `deploy.system.ts` instead of in the type,
   * and `Deploy.ts`'s own header is explicit that the deploy verb has exactly
   * one failure mode it is willing to own.
   */
  Unload = 16,
}

/**
 * Auto-engagement policy. Set per unit from the SelectionPanel.
 *
 * FOUR MEMBERS, FOUR BEHAVIOURS — and for a long time that was a claim rather
 * than a fact. `Aggressive` and `Defensive` were the same code path: nothing
 * read `GUARD_LEASH`, nothing read `guardX/guardZ`, and `Targeting.managesGoal`
 * only ever moved a unit that was already in `UnitState.Attacking`, so a unit
 * with an enemy 34 m away moved 0.00 m whichever of the two it was set to.
 *
 * The three tables that make these four distinct now live in `core/config.ts`
 * (`STANCE_CHASE_METRES`, `STANCE_RETURNS`, `STANCE_RETURN_SLACK`) and are read
 * by `sim/Targeting.ts`. Adding a fifth stance means adding a row to each.
 *
 * NONE OF THIS APPLIES TO AN EXPLICIT ORDER. `Attack`, `ForceAttack` and
 * `Move` are the player speaking, and the leash is about what a unit does when
 * nobody is speaking. The single exception is `HoldGround`, which refuses to
 * close even on an ordered target — see `Targeting.approach`.
 */
export const enum Stance {
  /**
   * Chase targets of opportunity, out to `GUARD_LEASH` metres from the post,
   * then come home.
   */
  Aggressive = 0,
  /**
   * Fire at anything in range, never leave position to start a fight — but do
   * walk back to position after being pushed off it.
   */
  Defensive = 1,
  /** Move to the target but never fire unless force-fired. */
  HoldFire = 2,
  /**
   * Fire freely, but never move for any reason: no chase, no return, and no
   * closing on an ordered target either.
   */
  HoldGround = 3,
}

/** Match lifecycle. Owned by MatchModule. */
export const enum MatchPhase {
  Menu = 0,
  Loading = 1,
  Playing = 2,
  Paused = 3,
  Victory = 4,
  Defeat = 5,
}

/** Auto-detected or user-selected fidelity bucket. */
export const enum QualityTier {
  Low = 0,
  Medium = 1,
  High = 2,
  Ultra = 3,
}

/* ==========================================================================
 * SECTION 4 — PRESENTATION ENUMS (sim -> vfx/audio vocabulary)
 *
 * The sim NEVER imports the VFX module. It pushes one of these ids into the
 * PresentationQueue and forgets. VFX and Audio each map the id to their own
 * recipe table. Adding an FxKind is the ONLY coupling point.
 * ========================================================================== */

export const enum FxKind {
  None = 0,
  MuzzleFlashSmall = 1,
  MuzzleFlashMedium = 2,
  MuzzleFlashLarge = 3,
  TracerBullet = 4,
  TracerCannon = 5,
  RocketTrail = 6,
  TeslaArc = 7,
  PrismBeam = 8,
  FlameJet = 9,
  ImpactDirt = 10,
  ImpactMetal = 11,
  ImpactConcrete = 12,
  ImpactWater = 13,
  ExplosionSmall = 14,
  ExplosionMedium = 15,
  ExplosionLarge = 16,
  ExplosionBuilding = 17,
  SmokePlumeSmall = 18,
  SmokePlumeLarge = 19,
  DustPuff = 20,
  DustTrail = 21,
  ShellCasing = 22,
  Debris = 23,
  Sparks = 24,
  Embers = 25,
  BuildComplete = 26,
  BuildRise = 27,
  RepairSpark = 28,
  OreSparkle = 29,
  CrushSquish = 30,
  UnitDeathInfantry = 31,
  Splash = 32,
  SellPuff = 33,
  /**
   * Three weapon kinds that had no FxKind of their own and therefore no sound.
   *
   * Flak and artillery both borrowed `MuzzleFlashLarge`, so an artillery piece
   * fired the tank-cannon report — and `flak.round`, `artillery.fire` and
   * `tesla.charge` sat baked in the audio bank, unreachable, because
   * `FX_SOUND` is keyed on this enum and nothing pointed at them.
   *
   * APPEND ONLY, and keep `FX_KIND_COUNT` in step: the value is an index into
   * parallel arrays sized by it, so inserting in the middle silently
   * renumbers every kind after it.
   */
  MuzzleFlashFlak = 34,
  MuzzleFlashArtillery = 35,
  TeslaCharge = 36,
}
export const FX_KIND_COUNT = 37;

/** Ground-projected decals. Pooled, aged, never allocated at runtime. */
export const enum DecalKind {
  Scorch = 0,
  Crater = 1,
  TreadMark = 2,
  FootPrint = 3,
  Squish = 4,
  OreStain = 5,
  Rubble = 6,
}

/**
 * Named sub-parts of a model that the sim/anim can drive at runtime.
 * `ModelBuild.sockets` maps these to local transforms.
 */
export const enum PartId {
  Root = 0,
  Turret = 1,
  Barrel = 2,
  MuzzleA = 3,
  MuzzleB = 4,
  Exhaust = 5,
  Antenna = 6,
  Hopper = 7,
  Scoop = 8,
  Dish = 9,
  Door = 10,
  Crane = 11,
  Conveyor = 12,
  CoilTip = 13,
  Turbine = 14,
  Stack = 15,
  DockEntry = 16,
  ExitPoint = 17,
  FlagPole = 18,
  Emitter = 19,
}
export const PART_ID_COUNT = 20;

/** EVA announcer lines. Faction-skinned by the audio module. */
export const enum EvaLine {
  ConstructionComplete = 0,
  UnitReady = 1,
  NewConstructionOptions = 2,
  InsufficientFunds = 3,
  LowPower = 4,
  BaseUnderAttack = 5,
  UnitLost = 6,
  BuildingLost = 7,
  SiloNeeded = 8,
  RadarOnline = 9,
  RadarOffline = 10,
  CannotDeployHere = 11,
  MissionAccomplished = 12,
  MissionFailed = 13,
  BuildingCaptured = 14,
  OreMinerUnderAttack = 15,
  /**
   * No ore miner, no money for one. The line that names the way out.
   *
   * APPENDED, never inserted — see `EVA_LINE_ID`, which is keyed by these
   * numbers, and `SaveGame`, which does not store them but would be the next
   * thing to break if this enum were ever renumbered.
   */
  NoOreMiner = 16,
  /** A gift arrived. Used by the ore-crisis rescue; see `OreCrisis.ts`. */
  Reinforcements = 17,
}

/* ==========================================================================
 * SECTION 5 — ENTITY FLAG BITFIELD
 *
 * One Uint32 per entity. Bit tests are the cheapest possible filter, so any
 * predicate a system checks every tick belongs here rather than in a branchy
 * def lookup.
 * ========================================================================== */

export const enum EntityFlag {
  /** Slot is in use. Cleared only by flushDestroyed. */
  Alive            = 1 << 0,
  /** markDead() was called. Systems must treat this as already gone. */
  PendingDestroy   = 1 << 1,
  /** In the local player's selection. Written ONLY by input/Selection.ts. */
  Selected         = 1 << 2,
  /** Under the cursor right now. Written ONLY by input/Picking.ts. */
  Hovered          = 1 << 3,
  /** buildProgress < 1. Cannot fire, cannot be captured, renders dissolving. */
  UnderConstruction= 1 << 4,
  /** Has a functioning power supply (buildings) / is not EMP'd (units). */
  Powered          = 1 << 5,
  /** Cannot move this tick (tesla stun, deploying, docked). */
  Immobilized      = 1 << 6,
  /** Inside a transport or a garrison; not rendered, not targetable. */
  Garrisoned       = 1 << 7,
  /** Has a weapon and a live weaponIndex. */
  CanAttack        = 1 << 8,
  /** Locomotor != Static and maxSpeed > 0. */
  CanMove          = 1 << 9,
  /** Has a turret that slews independently of the hull. */
  HasTurret        = 1 << 10,
  /** Dies instantly under a Crusher with a higher crushLevel. */
  Crushable        = 1 << 11,
  /** Crushes Crushable entities it drives over. */
  Crusher          = 1 << 12,
  /** Goes dark and stops firing during a brownout. */
  NeedsPower       = 1 << 13,
  /** Harvests ore. HarvesterSystem iterates exactly these. */
  IsHarvester      = 1 << 14,
  /** Can place structures (Construction Yard). */
  IsBuilder        = 1 << 15,
  /** Provides radar to its owner while powered and alive. */
  IsRadar          = 1 << 16,
  /** Produces units; the target of production spawn + rally. */
  IsFactory        = 1 << 17,
  /** The "primary" factory of its type for this player (spawn goes here). */
  PrimaryFactory   = 1 << 18,
  /** Refinery: harvesters may dock here. */
  IsRefinery       = 1 << 19,
  /** MCV that has unfolded / building that can fold back up. */
  Deployed         = 1 << 20,
  /** On fire — emits smoke, ticks damage-over-time. */
  Burning          = 1 << 21,
  /** Being repaired this tick (drives the repair spark FX). */
  BeingRepaired    = 1 << 22,
  /** Sellable for a refund. */
  Sellable         = 1 << 23,
  /** Veterancy rank 1 (one chevron). */
  Veteran1         = 1 << 24,
  /** Veterancy rank 2 (two chevrons / elite). */
  Veteran2         = 1 << 25,
  /** Not rendered and not targetable (cloak / submerged). */
  Cloaked          = 1 << 26,
  /** Contributes to this player's vision stamp. */
  ProvidesVision   = 1 << 27,
  /** Blocks the nav grid over its footprint. */
  BlocksNav        = 1 << 28,
  /** Excluded from auto-target acquisition (wrecks, props, crates). */
  NotATarget       = 1 << 29,
  /** Never selectable by a drag box (props, wrecks). */
  NotSelectable    = 1 << 30,
}

/** Convenience: everything a targeting scan must reject outright. */
export const TARGETABLE_REJECT_MASK =
  EntityFlag.PendingDestroy | EntityFlag.Cloaked | EntityFlag.Garrisoned | EntityFlag.NotATarget;

/* ==========================================================================
 * SECTION 6 — STATIC DEFINITION TABLES (frozen content)
 * ========================================================================== */

/** A weapon. Referenced by index from UnitDef/BuildingDef. */
export interface WeaponDef {
  readonly key: string;
  readonly name: string;
  /** Base damage before the armour matrix multiplier. */
  readonly damage: number;
  readonly warhead: WarheadClass;
  /** Max engagement range in metres. */
  readonly range: number;
  /** Cannot fire closer than this (artillery). 0 for most weapons. */
  readonly minRange: number;
  /** Seconds between shots (or between bursts when burstCount > 1). */
  readonly cooldown: number;
  /** Shots per trigger pull. */
  readonly burstCount: number;
  /** Seconds between shots inside a burst. */
  readonly burstDelay: number;
  readonly projectile: ProjectileKind;
  /** m/s. Ignored for Instant/Beam. */
  readonly projectileSpeed: number;
  /** Splash radius in metres; 0 = single target. */
  readonly splashRadius: number;
  /** Damage fraction at the splash edge (linear falloff to this). */
  readonly splashFalloff: number;
  /** Degrees/sec the turret slews to bear. */
  readonly turretTurnRate: number;
  /** True if the shooter must be stationary to fire. */
  readonly requiresStop: boolean;
  /** True if firing is gated on the owner not being in brownout. */
  readonly needsPower: boolean;
  /** Can this weapon shoot at all when the target is Infantry armour? */
  readonly canTargetInfantry: boolean;
  /**
   * Can this weapon engage an AIRBORNE target (`Locomotor.Air`)?
   *
   * The sibling of `canTargetInfantry` and enforced beside it, but the DEFAULT
   * is the opposite: `false`. Aircraft are a separate layer, and a layer every
   * gun in the game already answers is not one — it is a reskinned ground unit
   * that happens to be drawn 22 m up. `sim/AI.ts` has carried a complete
   * anti-air doctrine since before anything could fly, and it only means
   * something if a tank column genuinely cannot look up.
   *
   * The tags themselves are authored in the two weapon tables (`sim/Combat.ts`
   * and `data/Defs.ts`) under one rule: a soldier's own weapon and a dedicated
   * AA mount can elevate; a tank cannon, an artillery piece, a flamethrower, a
   * torpedo tube, a naval deck gun and an emplaced MG cannot.
   */
  readonly canTargetAir: boolean;
  readonly muzzleFx: FxKind;
  readonly travelFx: FxKind;
  readonly impactFx: FxKind;
  /** Which muzzle socket to alternate from. */
  readonly muzzleParts: readonly PartId[];
  /** Extra chained targets for TeslaBolt. 0 for everything else. */
  readonly chainCount: number;
}

/** Shared fields of anything buildable. */
export interface BuildableDef {
  readonly key: string;
  readonly name: string;
  /** One-line role description shown in the tooltip. */
  readonly blurb: string;
  readonly faction: Faction;
  readonly cost: number;
  /** Seconds at full power with one factory. */
  readonly buildTime: number;
  readonly tab: BuildTab;
  /** Keys of structures that must exist (and be powered) to unlock this. */
  readonly prereqs: readonly string[];
  /** Sidebar sort order inside its tab. */
  readonly sortOrder: number;
  /** ModelRegistry key. */
  readonly model: string;
  /**
   * Progression gate. Omitted (the overwhelming majority) means "available in
   * the very first match" — see `src/progression/UnlockGate.ts`. When present
   * it is an id from `UNLOCKS` in `src/data/Missions.ts`, and the def is only
   * buildable once a mission has granted that id. Inverting this default would
   * mean one forgotten tag locks a unit forever, so the default is open.
   */
  readonly unlockedBy?: string;
}

export interface UnitDef extends BuildableDef {
  readonly kind: EntityKind.Infantry | EntityKind.Vehicle;
  readonly maxHp: number;
  readonly armor: ArmorClass;
  /** Metres per second at full speed on clear ground. */
  readonly maxSpeed: number;
  /** m/s^2. Low accel is what makes a heavy tank feel heavy. */
  readonly accel: number;
  /** Radians/sec the hull turns. */
  readonly turnRate: number;
  readonly locomotor: Locomotor;
  /** Collision/separation radius in metres. */
  readonly radius: number;
  /** Vision radius in metres. */
  readonly sight: number;
  /** Indices into the weapon table. Empty = unarmed. */
  readonly weapons: readonly number[];
  readonly hasTurret: boolean;
  /** 0 = not a crusher. Higher crushes lower. */
  readonly crushLevel: number;
  /** Minimum crushLevel required to crush THIS unit. 0 = uncrushable. */
  readonly crushableBy: number;
  /** Ore capacity. 0 for non-harvesters. */
  readonly cargoMax: number;
  /**
   * Infantry seats. 0 means "not a transport", which is 41 of the 44 rows.
   *
   * Deliberately NOT `cargoMax`, which is ore by the tonne and is read as a
   * float fill fraction by every line of `sim/Harvesting.ts`. A harvester with
   * 600 units of ore aboard is not a transport with 600 passengers, and one
   * column meaning both would have made `store.cargo` mean two things at once.
   */
  readonly passengers: number;
  /** Population/queue cost. Always 1 in this build. */
  readonly popCost: number;
  /** Set for MCV: the building key it deploys into. */
  readonly deploysInto: string | null;
  /** Set for Engineer: can capture enemy structures. */
  readonly canCapture: boolean;
  /**
   * Hard cap on how many of this def one player may have ALIVE AT ONCE.
   * 0 means unlimited, which is every unit in the game except the four
   * commanders.
   *
   * "Alive" here counts what is on the field PLUS what is queued or on the
   * production line, and that second half is the part that actually matters:
   * a cap enforced only against living units lets a player queue five
   * commanders while the first is still building, and then five arrive. The
   * check lives in `ProductionService.availabilityOf` so the sidebar greys the
   * cameo, the tooltip explains why, and the AI — which asks the same function
   * — is bound by it too.
   */
  readonly maxAlive: number;
  /**
   * Faction ability this unit carries, or `AbilityId.None`.
   *
   * A number rather than an import so `core/types.ts` keeps depending on
   * nothing; `src/sim/Abilities.ts` owns the enum and the effects.
   */
  readonly ability: number;
  /** Extra flags OR'd in at spawn. */
  readonly flags: number;
}

export interface BuildingDef extends BuildableDef {
  readonly maxHp: number;
  readonly armor: ArmorClass;
  /** Footprint in CELLS, not metres. */
  readonly footprintW: number;
  readonly footprintH: number;
  /** Positive = generates power. Negative = consumes. */
  readonly power: number;
  readonly sight: number;
  readonly weapons: readonly number[];
  readonly hasTurret: boolean;
  /** Keys of units this structure can produce. Empty = not a factory. */
  readonly produces: readonly string[];
  /** Which tab this factory services (a War Factory owns BuildTab.Vehicles). */
  readonly producesTab: BuildTab | -1;
  /** Local-space offset (metres, +Z forward) where produced units appear. */
  readonly exitOffsetX: number;
  readonly exitOffsetZ: number;
  /*
   * `dockOffsetX/Z` USED TO LIVE HERE. Deleted, not wired.
   *
   * It was filled for every building in `Defs.ts` and read by NOTHING in
   * `src/` — `docs/SPEC_DRIFT_AUDIT.md` finding 40 — while `config.ts`
   * described a fallback branch "when the def table carries no explicit
   * dockOffset" that had never existed. No building ever overrode the default.
   *
   * `Harvesting.ts` now derives the unload apron from the DOCKING HULL's own
   * radius, which is strictly better than a per-building constant: it is
   * correct for every harvester in the game and for the next one authored,
   * where the dead field's default was a single number that happened to suit
   * none of them.
   */
  /** Ore storage this structure adds to the player cap. */
  readonly storage: number;
  /** Radius in metres within which this structure permits new construction. */
  readonly buildRadius: number;
  readonly flags: number;
}

/**
 * The art-side name for a faction. One entry per `Faction` member; every
 * palette table in config.ts and in src/art/** is keyed by this, so adding a
 * faction is `Faction` + this union + a row in each table.
 */
export type FactionPaletteKey = 'neutral' | 'allies' | 'soviets' | 'meridian' | 'reclaim';

/**
 * `FactionPaletteKey` indexed by `Faction`, for the id -> key direction.
 *
 * ORDER IS THE ENUM'S ORDER, and `ui/Chrome.paletteKeyFor` additionally relies
 * on `Object.keys(FACTION_PALETTE)` producing the same sequence — so a new row
 * goes on the END of this array AND on the end of `DEFAULT_ART.factions`.
 */
export const FACTION_PALETTE_KEYS: readonly FactionPaletteKey[] = [
  'neutral', 'allies', 'soviets', 'meridian', 'reclaim',
];

/** Everything the game needs to know about a side. */
export interface FactionDef {
  readonly id: Faction;
  readonly key: string;
  readonly name: string;
  /** Key into FACTION_PALETTE in config.ts. */
  readonly paletteKey: FactionPaletteKey;
  /** Unit keys spawned at match start alongside the MCV. */
  readonly startLoadout: readonly string[];
  /** Structure the MCV becomes. */
  readonly conYardKey: string;
  /** Default AI build order (structure keys). */
  readonly defaultBuildOrder: readonly string[];
}

/** The whole content layer, indexed once at boot by DefRegistry. */
export interface DefTables {
  readonly units: readonly UnitDef[];
  readonly buildings: readonly BuildingDef[];
  readonly weapons: readonly WeaponDef[];
  readonly factions: readonly FactionDef[];
  /** [warhead][armor] -> damage multiplier. 7 x 6. */
  readonly armorMatrix: readonly (readonly number[])[];
  /** key -> index in `units`. */
  readonly unitByKey: ReadonlyMap<string, number>;
  /** key -> index in `buildings`. */
  readonly buildingByKey: ReadonlyMap<string, number>;
}

/** Result of a buildability query — the reason string drives the tooltip. */
export interface AvailabilityResult {
  ok: boolean;
  /** Empty when ok. Otherwise a player-facing sentence. */
  reason: string;
  /**
   * True when the ONLY thing standing in the way is a per-army cap that is
   * already met — a hero limit, or `Limit N` on anything else.
   *
   * Every other refusal means "not yet" and describes a state that resolves;
   * this one means "you already do" and, for a hero, never resolves at all.
   * The AI needs to tell those apart: it reports the first refusal of a build
   * pass as the reason it is stuck, and a permanent one pins that diagnostic
   * for the rest of the match the moment its commander walks out of the
   * barracks. Callers that only care whether they may build ignore this and
   * read `ok`.
   */
  capped: boolean;
}

/* ==========================================================================
 * SECTION 7 — COMMANDS (the intent channel)
 *
 * Human input and the AI issue the IDENTICAL Command struct. There is no
 * privileged AI API. This is what makes the opponent feel fair, and what makes
 * the match replayable from a seed plus a command log.
 *
 * Commands are POOLED MUTABLE STRUCTS in a ring buffer. Never retain one past
 * the drain that delivered it; copy the fields you need.
 * ========================================================================== */

export const enum CommandKind {
  None = 0,
  /** Issue an OrderKind to a set of entities. */
  Order = 1,
  /** Enqueue a buildable in the tab's queue. */
  ProductionStart = 2,
  /** Pause/resume the head of a tab queue. */
  ProductionPause = 3,
  /** Cancel one item (refunds exactly what was spent). */
  ProductionCancel = 4,
  /** Commit a ready structure at a grid cell. */
  PlaceBuilding = 5,
  /** Move a factory's rally flag. */
  SetRally = 6,
  /** Sell a structure for 50%. */
  SellBuilding = 7,
  /** Toggle the drip-cost repair on a structure. */
  RepairToggle = 8,
  /** Change auto-engagement policy on a selection. */
  SetStance = 9,
  /** Make a factory the spawn point for its type. */
  SetPrimary = 10,
  /** Self-destruct a unit. */
  SelfDestruct = 11,
  /**
   * Pick up a standing structure and put it down somewhere else.
   *
   * APPENDED, NEVER INSERTED. This enum is encoded into replay files and every
   * value below is load-bearing; renumbering one would make every existing
   * recording play back a different game.
   *
   * It exists because relocation was the last ordinary gameplay verb reaching
   * the simulation WITHOUT passing the bus: the HUD called
   * `globalThis.__vmRelocate.commit(...)` directly, so the action was invisible
   * to anything watching the command stream — a replay recorder, a spectator,
   * a multiplayer link — while the AI's every move was visible.
   */
  Relocate = 12,
  /**
   * Call one of the five commander powers at a point on the map.
   *
   * APPENDED, for the reason stated above. `arg` carries the
   * `CommanderPowerId`, `x`/`z` the target point; there is no target entity and
   * no entity list.
   *
   * It exists because a commander power is a PLAYER-level verb — no unit
   * carries one, so there is no entity for `CommandKind.Order` to address — and
   * because five mission rewards had been promising them since the mission
   * table was written while nothing in the simulation could receive one. See
   * `src/sim/CommanderPowers.ts`.
   */
  UsePower = 13,
}

/**
 * One command. Pooled and reused — the `entities` view is a WINDOW into a
 * shared Int32Array arena and is only valid during the drain callback.
 */
export interface Command {
  kind: CommandKind;
  /** Who issued it. The bus stamps this; never trust a client-set value. */
  player: PlayerId;
  /** The sim tick this was issued on (for replay ordering). */
  tick: number;
  /**
   * True when this is a consumer PUTTING A COMMAND BACK, not a player or the
   * AI issuing a new one.
   *
   * Two consumers park commands they cannot handle and re-issue them for a
   * later phase — `input/Commands.ts#reissueParked` and
   * `sim/features.system.ts`. Each re-issue is a genuinely new command object
   * that passes `CommandBus.drain` again, so anything counting at the drain
   * sees ONE player action as two or three.
   *
   * That is not hypothetical: the replay recorder logged every human placement
   * three times and would have replayed three power plants for one click. The
   * flag is what lets a recorder tell a continuation from an intent.
   */
  reissued: boolean;
  /** For Order commands. */
  order: OrderKind;
  /** Target entity, or NONE. */
  target: EntityId;
  /** Target world position (or cell centre for PlaceBuilding). */
  x: number;
  z: number;
  /** Buildable/def index for production commands. */
  defId: number;
  /** Tab for production commands. */
  tab: BuildTab;
  /** Grid cell for PlaceBuilding. */
  cx: number;
  cz: number;
  /** Stance for SetStance. */
  stance: Stance;
  /** True to append to the unit's order queue instead of replacing it. */
  queued: boolean;
  /** Generic small integer payload (queue slot, count, toggle). */
  arg: number;
  /** Number of valid entries in `entities`. */
  entityCount: number;
  /**
   * Subarray view into the bus's shared entity arena. Read-only in practice.
   * INVALID after the drain returns.
   */
  entities: Int32Array;
}

/* ==========================================================================
 * SECTION 8 — EVENTS (the gameplay-rate notification channel)
 *
 * Flat primitives only, so payloads can be pooled and reused. Valid ONLY
 * during dispatch. If you need it later, copy the numbers out.
 * ========================================================================== */

export interface EvEntitySpawned {
  id: EntityId; kind: EntityKind; defId: number; player: PlayerId; x: number; z: number;
}
export interface EvEntityKilled {
  id: EntityId; kind: EntityKind; defId: number; player: PlayerId;
  killer: EntityId; killerPlayer: PlayerId; x: number; z: number;
  /** Value in credits, for the end-of-match stats. */
  value: number;
}
export interface EvEntityDamaged {
  id: EntityId; player: PlayerId; attacker: EntityId; attackerPlayer: PlayerId;
  amount: number; hpAfter: number; hpFrac: number; warhead: WarheadClass;
  x: number; z: number;
}
export interface EvBuildingPlaced {
  id: EntityId; defId: number; player: PlayerId; cx: number; cz: number; w: number; h: number;
}
export interface EvBuildingCompleted {
  id: EntityId; defId: number; player: PlayerId; x: number; z: number;
}
export interface EvBuildingCaptured {
  id: EntityId; defId: number; fromPlayer: PlayerId; toPlayer: PlayerId;
}
export interface EvBuildingSold {
  id: EntityId; defId: number; player: PlayerId; refund: number;
}
export interface EvProductionStarted {
  player: PlayerId; tab: BuildTab; defId: number; isBuilding: boolean; cost: number;
}
export interface EvProductionProgress {
  player: PlayerId; tab: BuildTab; defId: number; progress: number;
}
export interface EvProductionReady {
  player: PlayerId; tab: BuildTab; defId: number; isBuilding: boolean;
}
export interface EvProductionCancelled {
  player: PlayerId; tab: BuildTab; defId: number; refund: number;
}
export interface EvCredits {
  player: PlayerId; credits: number; delta: number; storage: number; storageMax: number;
  /** Machine-readable cause: 'harvest' | 'build' | 'refund' | 'sell' | 'init' | 'waste'. */
  reason: number;
  /**
   * Credits of ore taken OUT OF THE GROUND this tick, before the storage cap.
   *
   * `delta` and `reason` describe the BANK; this describes the MINE, and the
   * two are different numbers whenever a load lands in a full silo. One
   * coalesced event carries one net delta and one reason, so a tick that mixed
   * a harvest with anything else — the overflow's own `Waste` mark, a repair
   * drip, a crate — lost the harvest entirely: `reason` was overwritten and the
   * `earn` mission rule counted nothing. Every ore mission in `data/Missions.ts`
   * says "Mine N credits of ore", so this is the number they are about.
   *
   * ALWAYS SET IT, including to 0 — the payload is pooled and a stale value
   * from the previous emitter would be read as ore nobody mined.
   */
  mined: number;
}
export interface EvPower {
  player: PlayerId; produced: number; consumed: number;
  /** 1.0 at full power, down to 0.25 in deep brownout. */
  buildSpeedMul: number;
  /** True the tick the player crosses into deficit. */
  brownout: boolean;
}
export interface EvTechChanged {
  player: PlayerId;
}
export interface EvSelectionChanged {
  /** Number of entities now selected (0 = cleared). */
  count: number;
  /** The first selected entity, for the portrait. NONE when count is 0. */
  primary: EntityId;
  /** True when the selection is a single structure. */
  isBuilding: boolean;
}
export interface EvOrderIssued {
  player: PlayerId; order: OrderKind; count: number; x: number; z: number; target: EntityId;
}
export interface EvRadarChanged {
  player: PlayerId; online: boolean;
}
export interface EvVisionChanged {
  player: PlayerId;
}
export interface EvUnderAttack {
  player: PlayerId; x: number; z: number; isBuilding: boolean;
}
export interface EvEva {
  player: PlayerId; line: EvaLine;
}
export interface EvMatchStarted {
  seed: number; playerCount: number; localPlayer: PlayerId;
}
export interface EvMatchEnded {
  winner: PlayerId; localWon: boolean; durationSec: number;
}
export interface EvQualityChanged {
  tier: QualityTier; resolutionScale: number;
}
export interface EvArtChanged {
  /** Dot-paths that changed, e.g. 'sun.intensity'. Valid during dispatch only. */
  paths: readonly string[];
}
export interface EvVeterancy {
  id: EntityId; player: PlayerId; rank: number;
}

/**
 * THE COMPLETE EVENT MAP. `EventBus` is typed over this: `bus.on('entity:killed', fn)`
 * gives `fn` a correctly typed `EvEntityKilled` with no casting anywhere.
 */
export interface GameEvents {
  'entity:spawned': EvEntitySpawned;
  'entity:killed': EvEntityKilled;
  'entity:damaged': EvEntityDamaged;
  'entity:veterancy': EvVeterancy;
  'building:placed': EvBuildingPlaced;
  'building:completed': EvBuildingCompleted;
  'building:captured': EvBuildingCaptured;
  'building:sold': EvBuildingSold;
  'production:started': EvProductionStarted;
  'production:progress': EvProductionProgress;
  'production:ready': EvProductionReady;
  'production:cancelled': EvProductionCancelled;
  'economy:credits': EvCredits;
  'economy:power': EvPower;
  'tech:changed': EvTechChanged;
  'selection:changed': EvSelectionChanged;
  'order:issued': EvOrderIssued;
  'radar:changed': EvRadarChanged;
  'vision:changed': EvVisionChanged;
  'combat:underAttack': EvUnderAttack;
  'eva:line': EvEva;
  'match:started': EvMatchStarted;
  'match:ended': EvMatchEnded;
  'quality:changed': EvQualityChanged;
  'art:changed': EvArtChanged;
}

/** Every valid event name. */
export type EventName = keyof GameEvents;

/** Handler signature. The payload is pooled — do not retain it. */
export type EventHandler<K extends EventName> = (payload: Readonly<GameEvents[K]>) => void;

/** Reason codes for EvCredits.reason (kept numeric so the payload stays flat). */
export const enum CreditReason {
  Init = 0, Harvest = 1, Build = 2, Refund = 3, Sell = 4, Waste = 5, Bounty = 6, Cheat = 7,
}

/* ==========================================================================
 * SECTION 9 — PLAYER / MATCH STATE
 * ========================================================================== */

/** One item queued in one tab. */
export interface ProductionItem {
  /** Index into units[] or buildings[]. */
  defId: number;
  isBuilding: boolean;
  /** 0..1. */
  progress: number;
  /** Credits already drip-paid; refunded exactly on cancel. */
  spent: number;
  /** Total cost, cached so a def table read is not needed per frame. */
  cost: number;
  /** True when progress hit 1 and it is waiting for placement / exit. */
  ready: boolean;
  /** True when the player paused it or ran out of money. */
  onHold: boolean;
}

/** One tab's queue. Max 9 deep. */
export interface ProductionQueue {
  tab: BuildTab;
  items: ProductionItem[];
  /** Number of factories servicing this tab (drives the speed bonus). */
  factoryCount: number;
  /** True while a completed structure waits for the player to place it. */
  awaitingPlacement: boolean;
}

/** Per-player accumulated statistics for the results screen. */
export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsBuilt: number;
  buildingsLost: number;
  buildingsKilled: number;
  /** Credits of ore taken out of the ground, banked or not. */
  oreMined: number;
  /**
   * The part of `oreMined` that never reached the bank because there was no
   * room for it. `oreMined - oreWasted` is what the player actually got.
   *
   * Deposit overflow ONLY. `Economy.wasted()` also counts credits confiscated
   * when a silo dies and the cap shrinks under a standing balance; that money
   * was banked, not ore, and putting it under an "Ore Wasted" label would be
   * the same category error this field exists to close.
   */
  oreWasted: number;
  creditsSpent: number;
  peakArmyValue: number;
}

/** Everything about one participant. Index in `world.players`. */
export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  name: string;
  /** False for AI. */
  isHuman: boolean;
  /** True for the player whose HUD is on screen. Exactly one per match. */
  isLocal: boolean;
  /** True once Victory has eliminated them. */
  defeated: boolean;
  /** Bit i set = allied with player i. Always includes self. */
  allyMask: number;

  credits: number;
  /** Credits currently held; anything above this is wasted on harvest. */
  storageMax: number;
  powerProduced: number;
  powerConsumed: number;
  /** 1.0 full, scaling to 0.25 at total blackout. */
  buildSpeedMul: number;

  /** Four independent queues, indexed by BuildTab. */
  queues: ProductionQueue[];
  /** Availability bitmask recomputed only on building complete/destroy. */
  techMask: Uint8Array;
  /** True while a powered Radar Dome lives. Gates enemy minimap blips. */
  hasRadar: boolean;

  /**
   * IN-MATCH UPGRADES BOUGHT SO FAR. Bit `UpgradeDef.bit` set = installed.
   *
   * SIM STATE, and the ONLY authority on what this player owns. It is hashed by
   * `Checksum.hashPlayers`, saved by name in `SaveGame`, and never read from the
   * local profile — a purchase is a thing that happened in THIS match on BOTH
   * clients, not a fact about whose browser this is.
   *
   * 32 bits, and `UPGRADES` is asserted to fit by `tests/upgrades.spec.ts`.
   */
  upgradeMask: number;
  /**
   * DERIVED from `upgradeMask`, never authored and never saved.
   *
   * `UPGRADE_MUL_SLOTS` floats indexed by `upgradeSlot(lever, kind)`, all 1 when
   * nothing is bought. Recomputed in exactly one place
   * (`Upgrades.recomputeUpgradeMuls`) whenever the mask changes and on load, so
   * the mask cannot drift out of step with the numbers the sim reads.
   */
  upgradeMul: Float32Array;

  /** Per-factory rally points, keyed by factory EntityId. */
  rallyX: Map<number, number>;
  rallyZ: Map<number, number>;

  /** Cached counts so systems never rescan. Indexed by EntityKind. */
  entityCount: Int32Array;
  /** Count of live buildings by def index. Drives prereqs and Victory. */
  buildingCount: Int32Array;

  stats: PlayerStats;

  /** AI-only knobs; ignored for humans. */
  aiDifficulty: number;
  aiPersonality: number;
}

/** The local player's selection. Owned by input/Selection.ts. */
export interface SelectionState {
  /** Dense list of selected handles. */
  ids: Int32Array;
  count: number;
  /** Cached: true when everything selected is a structure. */
  isBuilding: boolean;
  /** Cached: the def index if the whole selection is homogeneous, else -1. */
  homogeneousDef: number;
  /** Ctrl+N groups. Each is a dense Int32Array with its own count. */
  groups: Int32Array[];
  groupCounts: Int32Array;
}

/** One sidebar cameo's live state, produced by HudFeed, consumed by BuildTabs. */
export interface HudCameo {
  defId: number;
  isBuilding: boolean;
  /**
   * True for a purchasable in-match upgrade rather than a unit or a structure.
   *
   * `isBuilding` alone described the world when there were two kinds of thing
   * in the grid. There are three now, so a cell that is neither has to say so:
   * the sidebar picks a different silhouette for it and reads `owned` as a
   * yes/no rather than a count.
   */
  isUpgrade: boolean;
  key: string;
  name: string;
  cost: number;
  /** 0..1 build progress of the head item matching this def. */
  progress: number;
  /** How many of this def are queued. */
  queued: number;
  ready: boolean;
  onHold: boolean;
  available: boolean;
  /** Player-facing reason when !available. */
  reason: string;
  /**
   * How many of this def the local player ALREADY OWNS and has finished.
   *
   * Counts completed entities only — anything still `UnderConstruction` is
   * already represented by `queued` and the progress bar, and counting it in
   * both places would read as two of something the player has none of yet.
   */
  owned: number;
}

/** The one-way snapshot production writes and hud reads. Neither imports the other. */
export interface HudSnapshot {
  credits: number;
  creditsDisplay: number;
  powerProduced: number;
  powerConsumed: number;
  brownout: boolean;
  hasRadar: boolean;
  activeTab: BuildTab;
  cameos: HudCameo[][];
  /** Per-tab "something finished" badge. */
  tabAlert: boolean[];
  selectionCount: number;
  selectionPrimary: EntityId;
  gameTimeSec: number;
  matchPhase: MatchPhase;
}

/* ==========================================================================
 * SECTION 10 — PORTS
 *
 * This is the section that makes parallel development possible. Each of these
 * has a null-object stub in the foundation and exactly one real implementation
 * in exactly one owning module. Combat imports ITerrain and IVision; it never
 * imports the terrain or fog-of-war implementations.
 * ========================================================================== */

/** Ground queries. Implemented by world/terrain/Terrain.ts. */
export interface ITerrain {
  /** Bilinear-sampled ground height in metres at a world position. */
  heightAt(x: number, z: number): number;
  /** Ground normal, written into `out` as [nx, ny, nz]. Returns `out`. */
  normalAt(x: number, z: number, out: Float32Array): Float32Array;
  /** Slope in radians, 0 = flat. */
  slopeAt(x: number, z: number): number;
  /** True if `loco` can traverse the cell. */
  isPassable(cx: number, cz: number, loco: Locomotor): boolean;
  /** True if a structure may be founded on the cell (flat, dry, unoccupied). */
  isBuildable(cx: number, cz: number): boolean;
  /** True if a structure or impassable prop occupies the cell. */
  isOccupied(cx: number, cz: number): boolean;
  /** Claim/release a footprint. The ONLY writer of the occupancy grid. */
  markOccupied(cx: number, cz: number, w: number, h: number, id: EntityId): void;
  clearOccupied(cx: number, cz: number, w: number, h: number): void;
  /** Bumped whenever occupancy changes, so nav can lazily invalidate fields. */
  occupancyVersion(): number;
  /** True if the cell is water. */
  isWater(cx: number, cz: number): boolean;
  /**
   * Intersect a ray with the heightfield. Writes [x,y,z] into `out`.
   * Returns false if the ray misses.
   */
  raycastGround(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    out: Float32Array,
  ): boolean;
}

/** Ore queries. Implemented by world/terrain/OreField.ts. */
export interface IOreField {
  /** Remaining ore units in a cell. */
  oreAt(cx: number, cz: number): number;
  /**
   * Remove up to `amount` from a cell. Returns what was actually taken, so a
   * harvester never mines a field into negative numbers.
   */
  takeOre(cx: number, cz: number, amount: number): number;
  /** Credits per ore unit for the cell's ore type. */
  oreValue(cx: number, cz: number): number;
  /**
   * Nearest cell with ore, searched from (cx,cz) out to `maxCells`.
   * Writes [cx, cz] into `out`. False if nothing found.
   */
  findOre(cx: number, cz: number, maxCells: number, out: Int32Array): boolean;
  /** Total ore left on the map — the AI uses this to decide to expand. */
  totalOre(): number;
}

/** Pathfinding. Implemented by sim/nav/PathService.ts. */
export interface INav {
  /**
   * Ask for a flow field toward a goal. Goals are quantized into buckets so a
   * 40-unit order shares one field. Returns an opaque field handle, or -1.
   * You MUST call `release` when the order ends.
   */
  requestField(goalCx: number, goalCz: number, loco: Locomotor): number;
  addRef(field: number): void;
  release(field: number): void;
  /** False while the field is still being expanded under the tick budget. */
  isReady(field: number): boolean;
  /**
   * Sample the field's direction at a world position, bilinearly blended.
   * Writes [dx, dz] (unit length) into `out`. False if outside the field.
   */
  sample(field: number, x: number, z: number, out: Float32Array): boolean;
  /** Bresenham walk — true if a straight line is unobstructed. */
  isDirectPathClear(x0: number, z0: number, x1: number, z1: number, loco: Locomotor): boolean;
  /**
   * Nearest reachable cell to (cx,cz) for `loco`. Writes [cx,cz] into `out`.
   * Used so a move order onto a cliff still does something sensible.
   */
  nearestReachable(cx: number, cz: number, loco: Locomotor, out: Int32Array): boolean;
}

/**
 * HOW MUCH OF AN ENTITY ONE PLAYER IS ENTITLED TO.
 *
 * There is exactly one visibility question in this game and it has three
 * answers, not two. Splitting it into a pair of booleans is what produced the
 * reported bug: the renderer drew a scouted structure from memory, `canSee`
 * answered false for the same structure, and input — asking neither — let the
 * player right-click something the simulation then refused to shoot at.
 *
 * Every consumer picks its own threshold off this one ladder:
 *
 *   `Hidden`      not there as far as this viewer is concerned. Not drawn, not
 *                 clickable, not targetable, no minimap blip.
 *   `Remembered`  the silhouette every RTS keeps: a STATIC object (structure,
 *                 prop, wreck) standing on ground this player has explored but
 *                 cannot currently see. Drawn, clickable and orderable —
 *                 because it is ON THE SCREEN, and something drawn that cannot
 *                 be clicked is a worse bug than the one this replaced. NOT
 *                 auto-acquirable, and it carries no health bar: you know it is
 *                 there, you do not know how hurt it is.
 *   `Live`        lit right now, or yours. Everything is permitted.
 *
 * The ordering is meaningful: `level >= Remembered` is "may the screen show it
 * and may the player click it", `level === Live` is "may the simulation act on
 * it". Test against those, never against the numbers.
 */
export const enum VisionLevel {
  Hidden = 0,
  Remembered = 1,
  Live = 2,
}

/** Fog of war. Implemented by sim/Vision.ts. */
export interface IVision {
  /** True if `player` can see the cell RIGHT NOW. */
  isVisibleAt(player: PlayerId, cx: number, cz: number): boolean;
  /** True if `player` has ever seen the cell. */
  isExplored(player: PlayerId, cx: number, cz: number): boolean;
  /**
   * THE visibility predicate. Every other entity-visibility question in the
   * codebase — what the bridge draws, what input may click, what targeting may
   * acquire, what the minimap blips — is a threshold on this one answer, so
   * they cannot drift apart. See `VisionLevel`.
   */
  visibilityOf(player: PlayerId, target: EntityId): VisionLevel;
  /**
   * `visibilityOf(...) === VisionLevel.Live`. The call targeting and combat
   * make, kept as its own name because "may the simulation act on it" is asked
   * far more often than the full ladder is.
   */
  canSee(player: PlayerId, target: EntityId): boolean;
  /** True while the player has a powered Radar Dome (gates enemy blips). */
  hasRadar(player: PlayerId): boolean;
  /** Raw 2-bit grid for the shroud shader upload. */
  gridFor(player: PlayerId): Uint8Array;
}

/**
 * Presentation. The sim pushes FX through the PresentationQueue, never through
 * this; this is for the render-side modules that need direct control.
 */
export interface IVfx {
  /** Fire a one-shot effect at a world position with an optional direction. */
  play(kind: FxKind, x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number): void;
  /** Attach a persistent emitter to an entity (burning, smoking). Returns a handle. */
  attach(kind: FxKind, id: EntityId): number;
  detach(handle: number): void;
  /** Stamp a ground decal. */
  decal(kind: DecalKind, x: number, z: number, rot: number, size: number): void;
  /** Add camera shake, 0..1. */
  shake(amount: number): void;
  /** Live particle count, for the quality governor. */
  particleCount(): number;
}

/** Audio. Implemented by audio/AudioModule.ts. */
export interface IAudio {
  /** Positional one-shot. */
  play(kind: FxKind, x: number, z: number, volume: number): void;
  /** Non-positional UI blip. */
  ui(kind: FxKind): void;
  /** Announcer line for a player (silently dropped if not the local player). */
  eva(player: PlayerId, line: EvaLine): void;
  /** 0..1 combat intensity driving the music crossfade. */
  setIntensity(v: number): void;
}

/** Selection queries other modules need without importing input. */
export interface ISelection {
  readonly state: Readonly<SelectionState>;
  /** True if the handle is in the local selection. */
  isSelected(id: EntityId): boolean;
  clear(): void;
}

/* ==========================================================================
 * SECTION 11 — SYSTEM / MODULE SHAPE
 *
 * Every parallel module default-exports exactly one SystemModule. That is the
 * whole plugin contract.
 * ========================================================================== */

/**
 * Simulation phases. Numeric so nobody has to negotiate ordering in a meeting;
 * you pick a slot and the registry sorts. Systems within a phase are ordered by
 * their `order` field, then by registration order.
 *
 * The normative WRITE-OWNERSHIP TABLE lives in loop.ts. File-disjointness alone
 * does not stop two modules writing `velX` — the table does.
 */
export const enum Phase {
  /** Drain the CommandBus, translate intent into unit orders. */
  Command = 100,
  /** Credit drip, queue advance, construction progress. */
  Production = 200,
  /** Harvest FSM, refinery docking, power recompute. */
  Economy = 300,
  /** AI brains. May ONLY call commandBus.issue(). */
  AI = 400,
  /** Flow field requests and budgeted expansion. */
  PathRequest = 500,
  /** Desired velocity: flow follow + separation + arrival. */
  Steering = 600,
  /** Integrate position, relax overlaps, clamp to nav, update yaw. */
  Movement = 700,
  /** Counting-sort rebuild of the spatial hash. Nothing may move after this. */
  SpatialRebuild = 800,
  /** Round-robin sliced target acquisition. */
  Targeting = 900,
  /** Cooldowns, turret slew, firing, muzzle FX. */
  Weapons = 1000,
  /** Projectile integration and swept hit tests. */
  Projectiles = 1100,
  /** Drain the DamageQueue through the armour matrix. */
  Damage = 1200,
  /** Vision stamping (every 3rd tick). */
  Vision = 1300,
  /** Death events, wrecks, generation bump, free-list return. */
  Cleanup = 1400,
}

/** Render-side ordering bands. PostFX always presents last. */
export const enum RenderPhase {
  Lighting = 0,
  Terrain = 10,
  FowUpload = 20,
  Bridge = 30,
  UnitAnim = 40,
  BuildingAnim = 50,
  Vfx = 60,
  Overlay = 70,
  Hud = 80,
  Present = 900,
}

/** Everything a sim system is allowed to touch. Passed to `simTick`. */
export interface SimContext {
  /** Fixed timestep in seconds. Always SIM_DT — never a variable frame time. */
  readonly dt: number;
  /** Monotonically increasing tick counter since match start. */
  readonly tick: number;
  /** Simulated seconds since match start (tick * SIM_DT). */
  readonly time: number;
  /** Deterministic RNG. `Math.random()` is BANNED inside src/sim/**. */
  readonly rng: IRng;
}

/** Everything a render module is allowed to touch. Passed to `frame`. */
export interface RenderContext {
  /** Real elapsed seconds since the last rendered frame. */
  readonly dt: number;
  /** Wall-clock seconds since boot. */
  readonly time: number;
  /** Interpolation factor 0..1 between the previous and current sim tick. */
  readonly alpha: number;
  /** Frame counter since boot. */
  readonly frame: number;
  readonly quality: QualityTier;
}

/**
 * The one shape every parallel module default-exports.
 * `init` runs once at boot in manifest order; `simTick` runs at 30 Hz inside
 * the fixed step; `frame` runs once per rendered frame.
 */
export interface SystemModule {
  /** Unique, stable, used by the profiler and the write-ownership assert. */
  readonly id: string;
  /** Sim phase. Omit if this module has no simTick. */
  readonly phase?: Phase;
  /** Render phase. Omit if this module has no frame. */
  readonly renderPhase?: RenderPhase;
  /** Tie-breaker inside a phase. Default 0. */
  readonly order?: number;
  /** One-time setup: register ports, build meshes, subscribe to events. */
  init?(): void | Promise<void>;
  /** Fixed-step simulation. Must be deterministic. */
  simTick?(ctx: SimContext): void;
  /** Per-rendered-frame work. May be skipped when the sim is paused. */
  frame?(ctx: RenderContext): void;
  /** Teardown between matches. Must leave no listeners behind. */
  dispose?(): void;
}

/** Minimal deterministic RNG surface (implemented in math.ts). */
export interface IRng {
  /** Uniform [0,1). */
  next(): number;
  /** Uniform [min,max). */
  range(min: number, max: number): number;
  /** Uniform integer [min,max]. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform element of a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Approximately normal, mean 0 stddev 1. */
  gauss(): number;
  /** A fresh independent stream (for a subsystem that must not perturb ours). */
  fork(): IRng;
  /** Current internal state, for save/replay. */
  getState(): number;
  setState(s: number): void;
}

/* ==========================================================================
 * SECTION 12 — ART DIRECTION SHAPES
 *
 * Interfaces only, zero values. Values live in config.ts, which is the ONE
 * file a visual critic edits. Every `applyArt` implementation must mutate
 * uniforms only — allocating a texture inside applyArt turns a slider drag
 * into a slideshow and destroys the reason this layer exists.
 * ========================================================================== */

/** Every material archetype in the game. */
export type SurfaceArchetype =
  | 'vehicleArmor' | 'vehicleTread' | 'vehicleGlass'
  | 'buildingConcrete' | 'buildingPanel' | 'construction'
  | 'infantryCloth'
  | 'terrainDirt' | 'terrainGrass' | 'terrainRock' | 'terrainRoad'
  | 'oreCrystal' | 'water' | 'wreck' | 'debris' | 'foliage' | 'overlay' | 'particle' | 'decal';

/** The falsifiable PBR range for one archetype. */
export interface SurfaceLook {
  roughnessMin: number;
  roughnessMax: number;
  /** Per-instance random variation added to roughness. */
  roughnessVariance: number;
  /** Painted steel is a dielectric over metal. NEVER 1.0 for armour. */
  metalness: number;
  /** 0..1 how much edges wear through to bare metal. */
  edgeWear: number;
  /** 0..1 how much dirt collects in cavities. */
  grime: number;
  /** 0..1 clearcoat layer strength. */
  clearcoat: number;
  /** 0..1 rust bloom weight. */
  rust: number;
  /** 0..1 cloth sheen. */
  sheen: number;
}

export interface SunLook {
  /** Compass degrees. 0 = +Z, increasing clockwise. */
  azimuthDeg: number;
  /** Degrees above the horizon. Negative for moonlight. */
  elevationDeg: number;
  color: string;
  intensity: number;
  shadowColor: string;
  /** Poisson PCF radius in shadow-map texels. */
  shadowSoftness: number;
  shadowBias: number;
  shadowNormalBias: number;
  /** 0..1 — how black shadows go. 1.0 reads as a hole in the world. */
  shadowIntensity: number;
  /** Fitted world-space extent of each cascade, in metres. */
  cascadeNear: number;
  cascadeFar: number;
  cascadeResolution: number;
}

export interface AtmosphereLook {
  hemiSky: string;
  hemiSkyIntensity: number;
  hemiGround: string;
  hemiGroundIntensity: number;
  skyZenith: string;
  skyHorizon: string;
  skyGround: string;
  sunDiskDeg: number;
  hazeWidthDeg: number;
  fogColor: string;
  /** Density at ground level. */
  fogDensity: number;
  /** Exponential falloff per metre of altitude. */
  fogHeightFalloff: number;
  /** Metres before fog begins to accumulate. */
  fogStart: number;
  /** 0..1 blend of distant geometry toward the sky colour. */
  aerialPerspective: number;
  /** Image-based lighting multiplier. */
  envIntensity: number;
}

export interface ToneLook {
  /** 'agx' | 'aces' | 'reinhard' | 'linear'. */
  mode: string;
  exposure: number;
  contrast: number;
  saturation: number;
  /** Separate saturation multiplier applied only to shadows. */
  shadowSaturation: number;
  shadowTint: string;
  midTint: string;
  highlightTint: string;
  lift: string;
  gain: string;
  vignette: number;
  vignetteSoftness: number;
  grain: number;
  grainSize: number;
  chromaticAberration: number;
  sharpen: number;
  /** Edge length of the baked 3D LUT. */
  lutSize: number;
}

export interface BloomLook {
  /** HDR threshold, applied BEFORE tonemap so white concrete never hazes. */
  threshold: number;
  strength: number;
  radius: number;
  mips: number;
  /** Extra multiplier applied to emissive-flagged pixels. */
  emissiveBoost: number;
  lensDirt: number;
}

export interface AoLook {
  enabled: boolean;
  samples: number;
  /** World-space sampling radius in metres. */
  radius: number;
  intensity: number;
  power: number;
  /** Half-res AO buffer. */
  halfRes: boolean;
}

export interface OutlineLook {
  widthPx: number;
  selected: string;
  hovered: string;
  hoveredAlpha: number;
  enemy: string;
  ally: string;
}

export interface VfxLook {
  /** Fire colour ramp: [stop, hexColor] pairs, ascending. */
  fireGradient: readonly (readonly [number, string])[];
  smokeColor: string;
  smokeOpacity: number;
  smokeRise: number;
  smokeSpread: number;
  dustOpacity: number;
  muzzleColor: string;
  muzzleMs: number;
  muzzleSize: number;
  teslaCore: string;
  teslaArc: string;
  teslaJitter: number;
  teslaBranches: number;
  prismCore: string;
  prismHalo: string;
  sparkColor: string;
  emberColor: string;
  shockwaveStrength: number;
  scorchColor: string;
  scorchOpacity: number;
  treadOpacity: number;
  decalFadeSec: number;
  screenShake: number;
}

export interface TerrainLook {
  grass: string;
  dirt: string;
  rock: string;
  sand: string;
  road: string;
  cliff: string;
  /** Metres per repeat of the detail normal. */
  detailScale: number;
  /** Metres per repeat of the macro breakup noise. */
  macroScale: number;
  puddles: number;
}

export interface WaterLook {
  shallow: string;
  deep: string;
  fresnelPower: number;
  foamColor: string;
  foamWidth: number;
  waveSpeed: number;
  waveScale: number;
  roughness: number;
}

export interface ShroudLook {
  /** Colour multiplied into explored-but-not-visible terrain. */
  exploredTint: string;
  /** 0..1 desaturation applied to explored terrain. */
  exploredDesat: number;
  /** Colour of never-explored area. */
  unexploredColor: string;
  /** Metres of soft ramp at the shroud edge. */
  edgeSoftness: number;
  noiseScale: number;
  noiseSpeed: number;
}

export interface HudLook {
  metalDark: string;
  metalMid: string;
  metalLight: string;
  bevelLight: string;
  bevelDark: string;
  rivet: string;
  screenGlow: string;
  scanline: number;
  textPrimary: string;
  textDim: string;
  danger: string;
  warn: string;
  ok: string;
  cornerRadiusPx: number;
  rivetSpacingPx: number;
  panelNoise: number;
  fontStack: string;
}

/** One faction's complete visual identity. */
export interface FactionLook {
  armorBase: string;
  armorSecondary: string;
  /** Team colour: the per-instance tint that separates the two armies. */
  team: string;
  accentStripe: string;
  emissivePanel: string;
  emissiveIntensity: number;
  glass: string;
  concrete: string;
  trimMetal: string;
  bareMetal: string;
  rust: string;
  tracer: string;
  explosionTint: string;
  hudAccent: string;
  /** Three-tone camo. */
  camo: readonly [string, string, string];
  /** Metres per camo blob. */
  camoScale: number;
  /**
   * 0 = fully chamfered/aero (Allies), 1 = fully slab/brutalist (Soviets).
   * MeshKit reads this to pick greeble and bevel sizes, which is the mechanism
   * that makes 20 independently-authored models read as two coherent armies.
   */
  silhouetteBias: number;
  /** Allies use none; Soviets rivet every seam. */
  useRivets: boolean;
  rivetSpacing: number;
  chamfer: number;
}

/** The complete art surface. `DEFAULT_ART` in config.ts is the one instance. */
export interface ArtDirection {
  sun: SunLook;
  atmosphere: AtmosphereLook;
  tone: ToneLook;
  bloom: BloomLook;
  ao: AoLook;
  outline: OutlineLook;
  vfx: VfxLook;
  terrain: TerrainLook;
  water: WaterLook;
  shroud: ShroudLook;
  hud: HudLook;
  surfaces: Record<SurfaceArchetype, SurfaceLook>;
  factions: Record<FactionPaletteKey, FactionLook>;
}

/** A dot-path into ArtDirection, e.g. 'sun.intensity'. Used for diff dispatch. */
export type ArtPath = string;

/** Anything that reacts to a live art change. */
export interface ArtAware {
  /** Prefixes this listener cares about, e.g. ['sun', 'atmosphere']. */
  readonly artDeps: readonly ArtPath[];
  /** MUTATE UNIFORMS ONLY. Never allocate a texture or rebuild geometry here. */
  applyArt(art: Readonly<ArtDirection>, changed: readonly ArtPath[]): void;
}

/* ==========================================================================
 * SECTION 13 — RENDER CONTRACT SHAPES
 * ========================================================================== */

/** Stable cache key for a shared material. Never build the same key twice. */
export type MaterialKey = string;

/** A socket on a model: a named local-space transform the sim can query. */
export interface SocketDef {
  part: PartId;
  /** Local offset in metres from the model origin (ground-plane centre). */
  x: number; y: number; z: number;
  /** Local yaw/pitch in radians (a muzzle usually points +Z with 0,0). */
  yaw: number; pitch: number;
}

/** One drawable piece of a model. */
export interface ModelPart {
  /** Which sub-part this belongs to, so BuildingAnim can rotate just the dish. */
  part: PartId;
  materialKey: MaterialKey;
  /** Index into the ModelBuild's geometry list. */
  geometry: number;
  /** Local offset from the model origin. */
  x: number; y: number; z: number;
  /** True if this part rotates with the turret rather than the hull. */
  followsTurret: boolean;
}

/** A completed, validated model. Produced by a ModelFactory, cached per faction. */
export interface ModelBuild {
  key: string;
  parts: ModelPart[];
  sockets: SocketDef[];
  /** Axis-aligned bounds in metres, validated against WorldScale by the registry. */
  boundsX: number; boundsY: number; boundsZ: number;
  /** Footprint in cells (buildings) or 0 (units). */
  footprintW: number; footprintH: number;
  /** Screen-space-error thresholds for LOD switching, descending. */
  lodDistances: number[];
}

/** Per-frame data the RenderBridge writes for one instance. */
export interface InstanceState {
  /** 0..1 health, drives damage soot and smoke. */
  hpFrac: number;
  /** 0..1 construction reveal. */
  buildProgress: number;
  /** 1 when selected (drives the rim), 0 otherwise. */
  selected: number;
  /** Stable per-entity random, so two tanks never wear identically. */
  seed: number;
}

/* ==========================================================================
 * SECTION 14 — QUEUE RECORD SHAPES (documentation for the SoA queues)
 *
 * The queues themselves are SoA typed arrays in events.ts. These interfaces
 * exist so the field order and meaning are documented in exactly one place.
 * ========================================================================== */

/** One entry in the DamageQueue. Damage is QUEUED, never applied inline. */
export interface DamageRecord {
  target: EntityId;
  attacker: EntityId;
  amount: number;
  warhead: WarheadClass;
  /** Impact position (splash origin, FX position). */
  x: number; y: number; z: number;
  /** 0 = direct hit; > 0 = apply splash from this point. */
  splashRadius: number;
  splashFalloff: number;
}

/** One entry in the PresentationQueue — the ONLY sim -> VFX channel. */
export interface FxRecord {
  kind: FxKind;
  x: number; y: number; z: number;
  /** Direction (usually the shot vector). Not necessarily normalized. */
  dx: number; dy: number; dz: number;
  scale: number;
  /** Owning entity, for attaching or for team-tinted tracers. NONE if none. */
  source: EntityId;
  /** Faction for tracer/explosion tinting. */
  faction: Faction;
}
