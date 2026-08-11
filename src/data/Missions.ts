/**
 * ============================================================================
 * VOLTMARCH — src/data/Missions.ts
 * ============================================================================
 * THE MISSION TABLE. Data, not code — the same shape of file as `Defs.ts`, for
 * the same reason: authoring a mission should be adding a row, and a row can be
 * validated at module load. There are no callbacks in this file. Every mission
 * is a `MissionRule`, which is a declarative predicate over events the engine
 * already emits (`src/core/events.ts`).
 *
 * TWO SCOPES
 * ----------
 * `profile` — cross-game. Persisted, tracked across every match, and the only
 *   scope that grants unlocks. These are the chains.
 * `match` — the per-match objective board. Reset at match start, paid in
 *   credits, capped at five on screen. They ALSO feed profile progress, because
 *   the profile missions are listening to the same events — nothing special
 *   wires the two together, which is why they do not feel bolted on.
 *
 * THE UNLOCK CURVE — READ `docs/MISSIONS_DESIGN.md` BEFORE RETUNING ANYTHING
 * -------------------------------------------------------------------------
 * Three rules this table is built on, all of them load-bearing:
 *
 *   1. The starting army is COMPLETE. Full building line, infantry, a main
 *      battle tank, harvesters, a dozer and a basic defence, for every faction.
 *      Nobody grinds before the game is fun.
 *   2. Unlocks are VARIETY, not power. A Prism Tank is not better than a
 *      Grizzly, it is different. Superweapons are the one deliberate exception
 *      and sit at the end of the longest chains in the file.
 *   3. FACTIONS ARE NOT GATED. All four are available from the first launch.
 *      That was decided against the recommendation, it is not up for
 *      relitigation, and it is why the reward table below has to carry the
 *      motivation on its own.
 *
 * Every unlock id is granted by EXACTLY ONE mission, and the self-check at the
 * bottom enforces it. A second grant would silently make one of the two
 * missions pay nothing, which reads to a player as a bug in the reward they
 * just earned.
 *
 * TARGETS ARE DELIBERATELY GENEROUS
 * ---------------------------------
 * Raising a number is easy; lowering one after players have earned things is
 * hostile. The first four chain steps are all reachable inside a handful of
 * matches on purpose.
 * ============================================================================
 */

import { BuildTab, CreditReason, EntityKind, Faction } from '../core/types';
import type { MissionDef, Reward } from '../progression/types';
import { RULE_METRIC } from '../progression/types';
// The commander power table. Imported for the SELF-CHECK, not for the rows: a
// `power` reward names a power by its unlock id, and until this edge existed
// nothing anywhere compared the two strings. `progression/powers.ts` imports
// nothing at all, so this keeps Missions.ts the leaf its header claims.
import { COMMANDER_POWER_LIST, powerByUnlockId } from '../progression/powers';

/* ==========================================================================
 * 1. THE UNLOCK IDS
 *
 * One table so a typo is a compile error rather than a permanently unbuildable
 * unit. `src/data/Defs.ts` tags its rows with `unlockedBy: UNLOCKS.<x>`; the
 * gate compares the two strings and nothing else.
 * ========================================================================== */

export const UNLOCKS = {
  /* -- units: sidegrades, one per faction each ---------------------------- */
  /** Fast harass: Multigunner IFV / Attack Dog / Sandskiff. */
  unitRaider: 'unit.raider',
  /** The faction's tier-3 specialist: Prism Tank / Apocalypse / Zenith Emitter. */
  unitSpecialist: 'unit.specialist',
  /** Escort hulls: Hover Transport, Assault Destroyer, Attack Sub, Kite Corvette. */
  unitNaval: 'unit.naval',
  /** Capital ships: Aircraft Cruiser / Dreadnought / Sunmonitor. */
  unitNavalCapital: 'unit.naval.capital',
  /** Rotary wing. Meridian only today — the Pactworks Kestrel. */
  unitAir: 'unit.air',

  /* -- structures --------------------------------------------------------- */
  /** Tech centre: Battle Lab / Reliquary. Opens the top of every tab. */
  structTech: 'struct.tech',
  /** Naval production: Naval Yard / Naval Pen / Slipway. */
  structNaval: 'struct.naval',
  /** Advanced defences: Flame Tower, Prism Tower, Tesla Coil, Helios Spire. */
  structDefenceSpecialist: 'struct.defence.specialist',
  /** Anti-air emplacement: Multigunner AA. */
  structDefenceAA: 'struct.defence.aa',

  /* -- superweapons: the end of the longest chains ------------------------ *
   * No def carries these yet — there are no superweapon structures in
   * `Defs.ts`. The ids are authored ahead of the content on purpose: a reward
   * the player can see and not yet use is a content gap, whereas a reward the
   * table cannot express is a save migration.                                */
  superSiege: 'struct.superweapon.siege',
  superStrategic: 'struct.superweapon.strategic',
  superChronosphere: 'struct.superweapon.chronosphere',
  superIronCurtain: 'struct.superweapon.ironcurtain',
  superSolarLance: 'struct.superweapon.solarlance',

  /* -- maps: two starters, four earned ------------------------------------ */
  mapFrozenSector: 'map.frozen-sector',
  mapIndustrialGrid: 'map.industrial-grid',
  mapContestedStrait: 'map.contested-strait',
  mapCoralShore: 'map.coral-shore',

  /* -- commander powers ----------------------------------------------------
   * THESE FIVE ARE REAL AND THESE FIVE STRINGS ARE THE JOIN. Each one is the
   * `unlockId` of a row in `src/progression/powers.ts`, which is what
   * `src/sim/CommanderPowers.ts` implements and what the HUD asks about before
   * it offers the button. `validateMissions` refuses to load a `power` reward
   * naming an id no power carries, and refuses to load a power no mission pays
   * — because for a long time these ids WERE only strings: granted, written to
   * the profile, printed on the end screen as "Callable once charged, in any
   * match", and read by nothing whatsoever.                                  */
  powerAirstrike: 'power.airstrike',
  powerOrbitalScan: 'power.orbital-scan',
  powerEmergencyRepair: 'power.emergency-repair',
  powerOreBoost: 'power.ore-boost',
  powerChronoshift: 'power.chronoshift',

  /* -- cosmetics ---------------------------------------------------------- */
  insigniaBronze: 'cosmetic.insignia.bronze',
  insigniaGold: 'cosmetic.insignia.gold',
  insigniaVeteran: 'cosmetic.insignia.veteran',
  insigniaMagnate: 'cosmetic.insignia.magnate',
  insigniaWarlord: 'cosmetic.insignia.warlord',
  insigniaAllies: 'cosmetic.insignia.allies',
  insigniaSoviets: 'cosmetic.insignia.soviets',
  insigniaMeridian: 'cosmetic.insignia.meridian',
  decalWarhead: 'cosmetic.decal.warhead',
  decalGrid: 'cosmetic.decal.grid',
  decalChevron: 'cosmetic.decal.chevron',
  decalLaurel: 'cosmetic.decal.laurel',
  decalCenturion: 'cosmetic.decal.centurion',
  decalStar: 'cosmetic.decal.star',
} as const;

export type UnlockId = (typeof UNLOCKS)[keyof typeof UNLOCKS];

/* -- reward constructors, so a row reads as prose --------------------------
 *
 * EVERY reward that grants something the player then OWNS is emitted as an
 * `unlock` PLUS its typed twin. The `unlock` half is the one `UnlockGate` and
 * `isUnlocked()` read — one uniform answer for "do I have this?" whether the
 * thing is a tank, a map, a commander power or a shoulder patch. The typed half
 * is what the consuming screen reads (the map list wants a map id, not a
 * generic unlock). Authoring them as one helper is the only thing stopping the
 * two from drifting apart.                                                   */

const unlock = (unlockId: string): Reward => ({ kind: 'unlock', unlockId });
const credits = (amount: number): Reward => ({ kind: 'credits', amount });

/** A plain unlock: a unit, a structure, a superweapon. */
const grant = (id: string): Reward[] => [unlock(id)];
const mapUnlock = (id: string): Reward[] => [unlock(id), { kind: 'map', mapId: id.replace(/^map\./, '') }];
/**
 * A commander power: the `unlock` half lands on the profile, the `power` half
 * is what the end screen prints. `id` must be the `unlockId` of a row in
 * `src/progression/powers.ts` — the self-check at the bottom of this file
 * enforces that in both directions, and it exists because these five rewards
 * shipped for a long time as strings nothing read.
 */
const powerUnlock = (id: string): Reward[] => [unlock(id), { kind: 'power', powerId: id }];
const cosmeticUnlock = (id: string): Reward[] => [unlock(id), { kind: 'cosmetic', cosmeticId: id }];

const VEHICLES: readonly EntityKind[] = [EntityKind.Vehicle];
const STRUCTURES: readonly EntityKind[] = [EntityKind.Building];

/* ==========================================================================
 * 2. PROFILE CHAINS
 *
 * Authored grouped by chain, and the tracker preserves table order in the
 * missions screen, so the file reads top-to-bottom the way the screen does.
 * ========================================================================== */

const COMBAT: readonly MissionDef[] = [
  /* -- the spine: total kills ---------------------------------------------- */
  {
    id: 'combat.kills.1',
    scope: 'profile', category: 'combat', difficulty: 1,
    title: 'First Blood',
    description: 'Destroy 25 enemy units or structures.',
    target: 25,
    rule: { on: 'kill' },
    reward: grant(UNLOCKS.unitRaider),
  },
  {
    id: 'combat.kills.2',
    scope: 'profile', category: 'combat', difficulty: 1,
    title: 'Field Command',
    description: 'Destroy 150 enemy units or structures.',
    target: 150,
    requires: ['combat.kills.1'],
    rule: { on: 'kill' },
    reward: grant(UNLOCKS.structDefenceSpecialist),
  },
  {
    id: 'combat.kills.3',
    scope: 'profile', category: 'combat', difficulty: 2,
    title: 'War Machine',
    description: 'Destroy 500 enemy units or structures.',
    target: 500,
    requires: ['combat.kills.2'],
    rule: { on: 'kill' },
    reward: grant(UNLOCKS.unitSpecialist),
  },
  {
    id: 'combat.kills.4',
    scope: 'profile', category: 'combat', difficulty: 3,
    title: 'Total War',
    description: 'Destroy 1,500 enemy units or structures.',
    target: 1500,
    requires: ['combat.kills.3'],
    rule: { on: 'kill' },
    reward: [...grant(UNLOCKS.superStrategic), ...cosmeticUnlock(UNLOCKS.insigniaWarlord)],
  },

  /* -- armour --------------------------------------------------------------- */
  {
    id: 'combat.armour.1',
    scope: 'profile', category: 'combat', difficulty: 1,
    title: 'Can Opener',
    description: 'Destroy 60 enemy vehicles.',
    target: 60,
    rule: { on: 'kill', kinds: VEHICLES },
    reward: grant(UNLOCKS.structDefenceAA),
  },
  {
    id: 'combat.armour.2',
    scope: 'profile', category: 'combat', difficulty: 2,
    title: 'Armour Column',
    description: 'Destroy 250 enemy vehicles.',
    target: 250,
    requires: ['combat.armour.1'],
    rule: { on: 'kill', kinds: VEHICLES },
    reward: powerUnlock(UNLOCKS.powerAirstrike),
  },

  /* -- demolition ---------------------------------------------------------- */
  {
    id: 'combat.razed.1',
    scope: 'profile', category: 'combat', difficulty: 1,
    title: 'Demolition Crew',
    description: 'Destroy 25 enemy structures.',
    target: 25,
    rule: { on: 'kill', kinds: STRUCTURES },
    reward: powerUnlock(UNLOCKS.powerOrbitalScan),
  },
  {
    id: 'combat.razed.2',
    scope: 'profile', category: 'combat', difficulty: 2,
    title: 'Scorched Earth',
    description: 'Destroy 100 enemy structures.',
    target: 100,
    requires: ['combat.razed.1'],
    rule: { on: 'kill', kinds: STRUCTURES },
    reward: cosmeticUnlock(UNLOCKS.decalWarhead),
  },

  /* -- veterancy ----------------------------------------------------------- */
  {
    id: 'combat.veteran.1',
    scope: 'profile', category: 'combat', difficulty: 1,
    title: 'Blooded',
    description: 'Promote 20 units to veteran rank.',
    target: 20,
    rule: { on: 'veterancy', rank: 1 },
    reward: cosmeticUnlock(UNLOCKS.insigniaVeteran),
  },
  {
    id: 'combat.veteran.2',
    scope: 'profile', category: 'combat', difficulty: 3,
    title: 'Old Guard',
    description: 'Promote 15 units to elite rank.',
    target: 15,
    requires: ['combat.veteran.1'],
    rule: { on: 'veterancy', rank: 3 },
    reward: powerUnlock(UNLOCKS.powerEmergencyRepair),
  },
];

const ECONOMY: readonly MissionDef[] = [
  {
    id: 'economy.harvest.1',
    scope: 'profile', category: 'economy', difficulty: 1,
    title: 'Prospector',
    description: 'Mine 25,000 credits of ore.',
    target: 25_000,
    rule: { on: 'earn', reasons: [CreditReason.Harvest] },
    reward: mapUnlock(UNLOCKS.mapFrozenSector),
  },
  {
    id: 'economy.harvest.2',
    scope: 'profile', category: 'economy', difficulty: 2,
    title: 'Strip Mine',
    description: 'Mine 250,000 credits of ore.',
    target: 250_000,
    requires: ['economy.harvest.1'],
    rule: { on: 'earn', reasons: [CreditReason.Harvest] },
    reward: grant(UNLOCKS.structTech),
  },
  {
    id: 'economy.harvest.3',
    scope: 'profile', category: 'economy', difficulty: 3,
    title: 'Continental Yield',
    description: 'Mine 1,000,000 credits of ore.',
    target: 1_000_000,
    requires: ['economy.harvest.2'],
    rule: { on: 'earn', reasons: [CreditReason.Harvest] },
    reward: powerUnlock(UNLOCKS.powerOreBoost),
  },
  {
    id: 'economy.bank.1',
    scope: 'profile', category: 'economy', difficulty: 2,
    title: 'War Chest',
    description: 'Hold 20,000 credits at one time.',
    target: 20_000,
    rule: { on: 'bank' },
    reward: cosmeticUnlock(UNLOCKS.insigniaMagnate),
  },
  {
    id: 'economy.power.1',
    scope: 'profile', category: 'economy', difficulty: 1,
    title: 'Grid Surplus',
    description: 'Run a 300-point power surplus.',
    target: 300,
    rule: { on: 'power' },
    reward: cosmeticUnlock(UNLOCKS.decalGrid),
  },
];

const CONSTRUCTION: readonly MissionDef[] = [
  {
    id: 'construction.build.1',
    scope: 'profile', category: 'construction', difficulty: 1,
    title: 'Groundworks',
    description: 'Complete 50 structures.',
    target: 50,
    rule: { on: 'build' },
    reward: mapUnlock(UNLOCKS.mapIndustrialGrid),
  },
  {
    id: 'construction.build.2',
    scope: 'profile', category: 'construction', difficulty: 3,
    title: 'Continental Engineering',
    description: 'Complete 300 structures.',
    target: 300,
    requires: ['construction.build.1'],
    rule: { on: 'build' },
    reward: grant(UNLOCKS.superSiege),
  },
  {
    id: 'construction.produce.1',
    scope: 'profile', category: 'construction', difficulty: 1,
    title: 'Production Line',
    description: 'Train or build 100 units.',
    target: 100,
    rule: { on: 'produce' },
    reward: cosmeticUnlock(UNLOCKS.decalChevron),
  },
  {
    id: 'construction.produce.2',
    scope: 'profile', category: 'construction', difficulty: 2,
    title: 'Total Mobilisation',
    description: 'Train or build 750 units.',
    target: 750,
    requires: ['construction.produce.1'],
    rule: { on: 'produce' },
    reward: mapUnlock(UNLOCKS.mapCoralShore),
  },
  {
    id: 'construction.armour.1',
    scope: 'profile', category: 'construction', difficulty: 2,
    title: 'Motor Pool',
    description: 'Build 200 vehicles.',
    target: 200,
    rule: { on: 'produce', tab: BuildTab.Vehicles },
    reward: cosmeticUnlock(UNLOCKS.decalLaurel),
  },
  {
    id: 'construction.capture.1',
    scope: 'profile', category: 'construction', difficulty: 2,
    title: 'Hostile Takeover',
    description: 'Capture 10 enemy structures with engineers.',
    target: 10,
    rule: { on: 'capture' },
    reward: powerUnlock(UNLOCKS.powerChronoshift),
  },
];

const TACTICS: readonly MissionDef[] = [
  {
    id: 'tactics.wins.1',
    scope: 'profile', category: 'tactics', difficulty: 1,
    title: 'Opening Move',
    description: 'Win a skirmish.',
    target: 1,
    rule: { on: 'win' },
    reward: cosmeticUnlock(UNLOCKS.insigniaBronze),
  },
  {
    id: 'tactics.wins.2',
    scope: 'profile', category: 'tactics', difficulty: 2,
    title: 'Theatre Command',
    description: 'Win 10 skirmishes.',
    target: 10,
    requires: ['tactics.wins.1'],
    rule: { on: 'win' },
    reward: grant(UNLOCKS.structNaval),
  },
  {
    id: 'tactics.wins.3',
    scope: 'profile', category: 'tactics', difficulty: 3,
    title: 'Fleet Admiral',
    description: 'Win 40 skirmishes.',
    target: 40,
    requires: ['tactics.wins.2'],
    rule: { on: 'win' },
    reward: grant(UNLOCKS.unitNavalCapital),
  },
  {
    id: 'tactics.fast.1',
    scope: 'profile', category: 'tactics', difficulty: 2,
    title: 'Blitz',
    description: 'Win a skirmish in under 15 minutes.',
    target: 1,
    rule: { on: 'win', withinSec: 900 },
    reward: mapUnlock(UNLOCKS.mapContestedStrait),
  },
  {
    id: 'tactics.flawless.1',
    scope: 'profile', category: 'tactics', difficulty: 2,
    title: 'Untouched',
    description: 'Win a skirmish without losing a single structure.',
    target: 1,
    rule: { on: 'noLoss', kinds: STRUCTURES, requireWin: true },
    reward: grant(UNLOCKS.unitNaval),
  },
  {
    id: 'tactics.streak.1',
    scope: 'profile', category: 'tactics', difficulty: 2,
    title: 'On A Roll',
    description: 'Win 3 skirmishes in a row.',
    target: 3,
    requires: ['tactics.wins.1'],
    rule: { on: 'winStreak' },
    reward: cosmeticUnlock(UNLOCKS.insigniaGold),
  },
  {
    id: 'tactics.streak.2',
    scope: 'profile', category: 'tactics', difficulty: 3,
    title: 'Undefeated',
    description: 'Win 10 skirmishes in a row.',
    target: 10,
    requires: ['tactics.streak.1'],
    rule: { on: 'winStreak' },
    reward: cosmeticUnlock(UNLOCKS.decalCenturion),
  },
];

const MASTERY: readonly MissionDef[] = [
  /* -- Allied chain -------------------------------------------------------- */
  {
    id: 'mastery.allies.1',
    scope: 'profile', category: 'mastery', difficulty: 2, faction: Faction.Allies,
    title: 'Allied Command',
    description: 'Win 5 skirmishes as the Allied Forces.',
    target: 5,
    rule: { on: 'win', faction: Faction.Allies },
    reward: cosmeticUnlock(UNLOCKS.insigniaAllies),
  },
  {
    id: 'mastery.allies.2',
    scope: 'profile', category: 'mastery', difficulty: 3, faction: Faction.Allies,
    title: 'Chronosphere Programme',
    description: 'Win 20 skirmishes as the Allied Forces.',
    target: 20,
    requires: ['mastery.allies.1'],
    rule: { on: 'win', faction: Faction.Allies },
    reward: grant(UNLOCKS.superChronosphere),
  },

  /* -- Soviet chain -------------------------------------------------------- */
  {
    id: 'mastery.soviets.1',
    scope: 'profile', category: 'mastery', difficulty: 2, faction: Faction.Soviets,
    title: 'Soviet Command',
    description: 'Win 5 skirmishes as the Soviet Union.',
    target: 5,
    rule: { on: 'win', faction: Faction.Soviets },
    reward: cosmeticUnlock(UNLOCKS.insigniaSoviets),
  },
  {
    id: 'mastery.soviets.2',
    scope: 'profile', category: 'mastery', difficulty: 3, faction: Faction.Soviets,
    title: 'Iron Curtain Programme',
    description: 'Win 20 skirmishes as the Soviet Union.',
    target: 20,
    requires: ['mastery.soviets.1'],
    rule: { on: 'win', faction: Faction.Soviets },
    reward: grant(UNLOCKS.superIronCurtain),
  },

  /* -- Meridian chain ------------------------------------------------------ */
  {
    id: 'mastery.meridian.1',
    scope: 'profile', category: 'mastery', difficulty: 2, faction: Faction.Meridian,
    title: 'Pact Command',
    description: 'Win 5 skirmishes as the Meridian Pact.',
    target: 5,
    rule: { on: 'win', faction: Faction.Meridian },
    reward: cosmeticUnlock(UNLOCKS.insigniaMeridian),
  },
  {
    id: 'mastery.meridian.2',
    scope: 'profile', category: 'mastery', difficulty: 3, faction: Faction.Meridian,
    title: 'Pactworks Aviation',
    description: 'Win 12 skirmishes as the Meridian Pact.',
    target: 12,
    requires: ['mastery.meridian.1'],
    rule: { on: 'win', faction: Faction.Meridian },
    reward: grant(UNLOCKS.unitAir),
  },
  {
    id: 'mastery.meridian.3',
    scope: 'profile', category: 'mastery', difficulty: 3, faction: Faction.Meridian,
    title: 'Solar Lance Programme',
    description: 'Win 20 skirmishes as the Meridian Pact.',
    target: 20,
    requires: ['mastery.meridian.2'],
    rule: { on: 'win', faction: Faction.Meridian },
    reward: grant(UNLOCKS.superSolarLance),
  },

  /* -- the long tail ------------------------------------------------------- */
  {
    id: 'mastery.veteran',
    scope: 'profile', category: 'mastery', difficulty: 3,
    title: 'Career Officer',
    description: 'Finish 100 skirmishes.',
    target: 100,
    rule: { on: 'play' },
    reward: cosmeticUnlock(UNLOCKS.decalStar),
  },
];

/* ==========================================================================
 * 3. MATCH OBJECTIVES
 *
 * The per-match board. Five are drawn per match from the sim seed, so a replay
 * of the same seed draws the same board. They pay credits and nothing else:
 * every unlock in the game is behind a profile chain, so a player who never
 * looks at the objective panel is not locked out of any content.
 * ========================================================================== */

const OBJECTIVES: readonly MissionDef[] = [
  {
    id: 'obj.kills.10',
    scope: 'match', category: 'combat', difficulty: 1,
    title: 'Draw Blood',
    description: 'Destroy 10 enemy units.',
    target: 10,
    rule: { on: 'kill', kinds: [EntityKind.Infantry, EntityKind.Vehicle] },
    reward: [credits(400)],
  },
  {
    id: 'obj.kills.30',
    scope: 'match', category: 'combat', difficulty: 2,
    title: 'Attrition',
    description: 'Destroy 30 enemy units.',
    target: 30,
    rule: { on: 'kill', kinds: [EntityKind.Infantry, EntityKind.Vehicle] },
    reward: [credits(900)],
  },
  {
    id: 'obj.armour.12',
    scope: 'match', category: 'combat', difficulty: 2,
    title: 'Break The Column',
    description: 'Destroy 12 enemy vehicles.',
    target: 12,
    rule: { on: 'kill', kinds: VEHICLES },
    reward: [credits(700)],
  },
  {
    id: 'obj.raze.5',
    scope: 'match', category: 'combat', difficulty: 2,
    title: 'Structural Damage',
    description: 'Destroy 5 enemy structures.',
    target: 5,
    rule: { on: 'kill', kinds: STRUCTURES },
    reward: [credits(700)],
  },
  {
    id: 'obj.veteran.3',
    scope: 'match', category: 'combat', difficulty: 2,
    title: 'Field Promotion',
    description: 'Promote 3 units to veteran rank.',
    target: 3,
    rule: { on: 'veterancy', rank: 1 },
    reward: [credits(600)],
  },
  {
    id: 'obj.harvest.5000',
    scope: 'match', category: 'economy', difficulty: 1,
    title: 'Ore Quota',
    description: 'Mine 5,000 credits of ore this match.',
    target: 5000,
    rule: { on: 'earn', reasons: [CreditReason.Harvest] },
    reward: [credits(500)],
  },
  {
    id: 'obj.bank.15000',
    scope: 'match', category: 'economy', difficulty: 2,
    title: 'Liquidity',
    description: 'Hold 15,000 credits at one time.',
    target: 15_000,
    rule: { on: 'bank' },
    reward: [credits(600)],
  },
  {
    id: 'obj.power.150',
    scope: 'match', category: 'economy', difficulty: 1,
    title: 'Keep The Lights On',
    description: 'Reach a 150-point power surplus.',
    target: 150,
    rule: { on: 'power' },
    reward: [credits(400)],
  },
  {
    id: 'obj.build.8',
    scope: 'match', category: 'construction', difficulty: 1,
    title: 'Base Of Operations',
    description: 'Complete 8 structures.',
    target: 8,
    rule: { on: 'build' },
    reward: [credits(500)],
  },
  {
    id: 'obj.produce.20',
    scope: 'match', category: 'construction', difficulty: 1,
    title: 'Standing Army',
    description: 'Train or build 20 units.',
    target: 20,
    rule: { on: 'produce' },
    reward: [credits(500)],
  },
  {
    id: 'obj.capture.1',
    scope: 'match', category: 'tactics', difficulty: 2,
    title: 'Seize The Asset',
    description: 'Capture an enemy structure.',
    target: 1,
    rule: { on: 'capture' },
    reward: [credits(800)],
  },
  {
    id: 'obj.noLoss.structures',
    scope: 'match', category: 'tactics', difficulty: 3,
    title: 'Intact',
    description: 'Finish the match without losing a structure.',
    target: 1,
    rule: { on: 'noLoss', kinds: STRUCTURES },
    reward: [credits(1200)],
  },
  {
    id: 'obj.fast.win',
    scope: 'match', category: 'tactics', difficulty: 3,
    title: 'Lightning Campaign',
    description: 'Win inside 15 minutes.',
    target: 1,
    rule: { on: 'win', withinSec: 900 },
    reward: [credits(1500)],
  },
];

/* ==========================================================================
 * 4. THE TABLE
 * ========================================================================== */

/** Every mission, in display order: chains first, then the objective pool. */
export const MISSIONS: readonly MissionDef[] = [
  ...COMBAT, ...ECONOMY, ...CONSTRUCTION, ...TACTICS, ...MASTERY, ...OBJECTIVES,
];

export const PROFILE_MISSIONS: readonly MissionDef[] = MISSIONS.filter((m) => m.scope === 'profile');
export const MATCH_OBJECTIVES: readonly MissionDef[] = MISSIONS.filter((m) => m.scope === 'match');

/** Category display order, so the missions screen cannot disagree with this file. */
export const MISSION_CATEGORY_ORDER = ['combat', 'economy', 'construction', 'tactics', 'mastery'] as const;

const BY_ID = new Map<string, MissionDef>(MISSIONS.map((m) => [m.id, m]));

export function missionById(id: string): MissionDef | undefined {
  return BY_ID.get(id);
}

/** Every unlock id any mission grants. Fed to `UnlockGate` as its known set. */
export const MISSION_UNLOCK_IDS: readonly string[] = (() => {
  const out: string[] = [];
  for (const m of MISSIONS) {
    for (const r of m.reward) if (r.kind === 'unlock' && !out.includes(r.unlockId)) out.push(r.unlockId);
  }
  return out.sort();
})();

export default MISSIONS;

/* ==========================================================================
 * 5. SELF-CHECK
 *
 * Runs at import in every environment, exactly like `Defs.ts`. Every failure
 * below is one that would otherwise present as a balance decision: a mission
 * that never advances, a chain that can never open, a reward that pays nothing.
 * ========================================================================== */

export function validateMissions(defs: readonly MissionDef[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const scopeById = new Map<string, string>();

  for (const m of defs) {
    if (ids.has(m.id)) problems.push(`duplicate mission id "${m.id}"`);
    ids.add(m.id);
    scopeById.set(m.id, m.scope);
  }

  for (const m of defs) {
    if (m.title.length === 0) problems.push(`mission "${m.id}" has no title`);
    if (m.description.length === 0) problems.push(`mission "${m.id}" has no description`);
    if (!Number.isFinite(m.target) || m.target <= 0) {
      problems.push(`mission "${m.id}" has a non-positive target`);
    }
    if (m.reward.length === 0) problems.push(`mission "${m.id}" pays nothing`);
    if (m.difficulty !== undefined && (m.difficulty < 1 || m.difficulty > 3)) {
      problems.push(`mission "${m.id}" has difficulty ${m.difficulty}`);
    }

    const rule = m.rule;
    if (rule === undefined) {
      problems.push(`mission "${m.id}" has no rule — it could never advance`);
      continue;
    }
    if (RULE_METRIC[rule.on] === undefined) {
      problems.push(`mission "${m.id}" uses unknown rule "${String(rule.on)}"`);
      continue;
    }
    // A flag latches at 1; any other target is unreachable by construction.
    if (RULE_METRIC[rule.on] === 'flag' && m.target !== 1) {
      problems.push(`mission "${m.id}" is a flag rule with target ${m.target} (must be 1)`);
    }
    if (m.scope === 'match' && (rule.on === 'winStreak' || rule.on === 'play')) {
      problems.push(`mission "${m.id}" uses "${rule.on}", which only makes sense at profile scope`);
    }
    if (rule.on === 'win' && rule.faction !== undefined && m.faction !== rule.faction) {
      problems.push(`mission "${m.id}" filters on faction ${rule.faction} but is tagged ${String(m.faction)}`);
    }

    for (const req of m.requires ?? []) {
      if (!ids.has(req)) {
        problems.push(`mission "${m.id}" requires unknown mission "${req}"`);
        continue;
      }
      // A profile chain that hangs off a match objective would reset every time
      // the player quits to the menu, and the chain would never open.
      if (m.scope === 'profile' && scopeById.get(req) === 'match') {
        problems.push(`profile mission "${m.id}" requires match objective "${req}"`);
      }
      if (req === m.id) problems.push(`mission "${m.id}" requires itself`);
    }

    for (const r of m.reward) {
      if (r.kind === 'credits' && m.scope !== 'match') {
        problems.push(`mission "${m.id}" pays credits at profile scope`);
      }
      if (r.kind === 'unlock' && r.unlockId.length === 0) {
        problems.push(`mission "${m.id}" grants an empty unlock id`);
      }
      if (r.kind === 'cosmetic' && r.cosmeticId.length === 0) {
        problems.push(`mission "${m.id}" grants an empty cosmetic id`);
      }
      /* -- a power reward has to name a power ------------------------------
       * The defect this closes: `{ kind: 'power', powerId: 'power.airstrike' }`
       * type-checks against any string, so five rewards named five powers that
       * did not exist and the only symptom was a player pressing nothing.    */
      if (r.kind === 'power') {
        if (powerByUnlockId(r.powerId) === undefined) {
          problems.push(
            `mission "${m.id}" grants power "${r.powerId}", which no row in `
            + 'src/progression/powers.ts implements — it would pay nothing',
          );
        }
        // The `power` half is display; the `unlock` half is what the profile
        // stores and what the HUD asks about. One without the other is a power
        // the player is told about and can never call.
        if (!m.reward.some((o) => o.kind === 'unlock' && o.unlockId === r.powerId)) {
          problems.push(
            `mission "${m.id}" grants power "${r.powerId}" without the matching `
            + 'unlock — nothing would ever record that the player owns it',
          );
        }
      }
    }
  }

  /* -- cycles ------------------------------------------------------------- *
   * A requires-cycle is a chain nobody can ever start, and it presents as
   * "these four missions are greyed out forever".                            */
  const state = new Map<string, number>(); // 0 unvisited, 1 on stack, 2 done
  const byId = new Map(defs.map((d) => [d.id, d]));
  const visit = (id: string, trail: string[]): void => {
    const s = state.get(id) ?? 0;
    if (s === 2) return;
    if (s === 1) {
      problems.push(`mission chain cycle: ${[...trail, id].join(' -> ')}`);
      return;
    }
    state.set(id, 1);
    for (const req of byId.get(id)?.requires ?? []) {
      if (byId.has(req)) visit(req, [...trail, id]);
    }
    state.set(id, 2);
  };
  for (const m of defs) visit(m.id, []);

  /* -- one grant per unlock ----------------------------------------------- */
  const grantedBy = new Map<string, string>();
  for (const m of defs) {
    for (const r of m.reward) {
      if (r.kind !== 'unlock') continue;
      const prev = grantedBy.get(r.unlockId);
      if (prev !== undefined) {
        problems.push(`unlock "${r.unlockId}" is granted by both "${prev}" and "${m.id}"`);
      } else {
        grantedBy.set(r.unlockId, m.id);
      }
    }
  }

  /* -- every declared unlock id is actually reachable ---------------------- */
  for (const key of Object.keys(UNLOCKS) as (keyof typeof UNLOCKS)[]) {
    const id = UNLOCKS[key];
    if (!grantedBy.has(id)) problems.push(`unlock "${id}" (UNLOCKS.${key}) is declared but no mission grants it`);
  }

  /* -- and every implemented power is actually paid for --------------------
   * The other direction of the same join. A power the simulation can fire but
   * no mission awards is content nobody can reach, which looks exactly like a
   * balance decision — the most expensive kind of content bug to find.       */
  for (const power of COMMANDER_POWER_LIST) {
    if (!grantedBy.has(power.unlockId)) {
      problems.push(
        `commander power "${power.key}" (${power.unlockId}) is implemented but no mission grants it`,
      );
    }
  }

  return problems;
}

{
  const problems = validateMissions(MISSIONS);
  if (problems.length > 0) throw new Error(`[data] mission errors:\n  ${problems.join('\n  ')}`);
}
