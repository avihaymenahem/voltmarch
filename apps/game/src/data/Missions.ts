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
 *   scope that grants unlocks. Two unlocked, unfinished rows are pinned to the
 *   in-match HUD as global objectives.
 * `match` — the per-match objective board. Reset at match start, split into
 *   main and side work, with eight drawn per match. They ALSO feed profile progress, because
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
 *   2. Unlocks are VARIETY, not power. A Refractor Tank is not better than a
 *      Warden, it is different. Superweapons are the one deliberate exception
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
// NO EDGE TO `progression/powers.ts` ANY MORE, and its absence is the change.
// This file used to import the power table for a self-check, because a `power`
// reward named a power by its unlock id and nothing else compared the two
// strings. A commander power is bought in the match now, from a Command Post,
// so the mission table has nothing to say about one.

/* ==========================================================================
 * 1. THE UNLOCK IDS
 *
 * One table so a typo is a compile error rather than a permanently unbuildable
 * unit. `src/data/Defs.ts` tags its rows with `unlockedBy: UNLOCKS.<x>`; the
 * gate compares the two strings and nothing else.
 * ========================================================================== */

export const UNLOCKS = {
  /* -- units: sidegrades, one per faction each ---------------------------- */
  /** Fast harass: Sabre IFV / Attack Dog / Sandskiff. */
  unitRaider: 'unit.raider',
  /** The faction's tier-3 specialist: Refractor Tank / Sledge / Zenith Emitter. */
  unitSpecialist: 'unit.specialist',
  /*
   * THREE NAVAL IDS USED TO SIT HERE — `unit.naval`, `unit.naval.capital` and
   * `struct.naval` — and they are deleted rather than left as ids nothing
   * gates. See the block that replaced them in `UNLOCK_TAGS`: they made both
   * maps advertised as naval unplayable as such, for the human and, through
   * `UnlockGate.mirrorAI`, for the AI as well.
   *
   * Deleted and not merely unreferenced, for the reason the `power` `Reward`
   * variant was deleted when commander powers moved into the match: a schema
   * member nothing produces is the next reader's false lead.
   *
   * The three missions that paid them still exist and still pay — cosmetics
   * now. A mission whose reward evaporates is worse than a mission that never
   * existed, because a profile that already completed it would silently lose
   * what it earned.
   */
  /**
   * The air arm, and ALL FOUR armies have one: Kestrel Gunship, Swarmhornet,
   * Petrel Bomber, Interceptor.
   *
   * This read "Meridian only today — the Pactworks Kestrel" and was paid by
   * `mastery.meridian.2`, "win 12 skirmishes as the Meridian Pact". That was
   * true when the Pact owned the only gunship; the moment the Reclamation,
   * Allied and Soviet aircraft landed it meant a Reclamation player had to win
   * a dozen games as a DIFFERENT ARMY to unlock their own. It is paid by
   * `construction.armour.2` now, which is faction-agnostic — see the rule three
   * paragraphs down in `UNLOCK_TAGS`: one mission grants a group and every army
   * gets its member, so switching faction never sends a player back to the
   * start of a curve they already paid for.
   */
  unitAir: 'unit.air',

  /* -- structures --------------------------------------------------------- */
  /** Tech centre: Proving Ground / Reliquary. Opens the top of every tab. */
  structTech: 'struct.tech',
  /** Advanced defences: Flame Tower, Refractor Tower, Tesla Coil, Helios Spire. */
  structDefenceSpecialist: 'struct.defence.specialist',
  /** Anti-air emplacement: AA Battery. */
  structDefenceAA: 'struct.defence.aa',

  /* -- superweapons: the end of the longest chains ------------------------ *
   * FIVE IDS, SIX STRUCTURES, AND EVERY ONE OF THEM IS NOW GATED.
   *
   * This block used to read "No def carries these yet — there are no
   * superweapon structures in `Defs.ts`", which stopped being true the release
   * the six rows landed: `nuclearSilo`, `ironCurtain`, `chronosphere`,
   * `weatherControl`, `mrdHeliograph` and `rclStormworks` shipped with no
   * `unlockedBy`, so they were day-one buildable and all five rewards below
   * paid into nothing.
   *
   * The mapping is by EFFECT, which is the grouping `src/sim/Superweapons.ts`
   * itself uses (six rows, four effects):
   *
   *   superStrategic     nuclearSilo                 the warned annihilation
   *   superSolarLance    mrdHeliograph               the same effect, Pact
   *   superSiege         weatherControl + rclStormworks   the scattered storm
   *   superChronosphere  chronosphere                two-click translocation
   *   superIronCurtain   ironCurtain                 true invulnerability
   *
   * `superSiege` covers TWO structures because they run one effect
   * (`SuperweaponId.LightningStorm`) for two armies, exactly as `unit.raider`
   * covers four hulls. Its id STRING is not renamed: `struct.superweapon.siege`
   * is written into every profile that has earned it, and a rename would orphan
   * it. Read "siege" as the sustained bombardment it gates.                   */
  superSiege: 'struct.superweapon.siege',
  superStrategic: 'struct.superweapon.strategic',
  superChronosphere: 'struct.superweapon.chronosphere',
  superIronCurtain: 'struct.superweapon.ironcurtain',
  superSolarLance: 'struct.superweapon.solarlance',

  /* -- maps: seven ship, three are starters, these four are earned ---------
   * The starters are `temperate-valley`, `airbase-flats` and `sunder-atoll`;
   * `STARTER_MAPS` in `src/shell/SkirmishSetup.ts` is the list and
   * `tests/progression-gate.spec.ts` §8 checks the two agree in both
   * directions — every non-starter pays out, and no starter does. */
  mapFrozenSector: 'map.frozen-sector',
  mapIndustrialGrid: 'map.industrial-grid',
  mapContestedStrait: 'map.contested-strait',
  mapCoralShore: 'map.coral-shore',

  /* -- the two new def groups ----------------------------------------------
   * THESE REPLACED THE FIVE COMMANDER POWERS, which stopped being a mission
   * reward in v2.6.0: a power is bought inside the match now, from a Command
   * Post, so `power.airstrike` and its four siblings were deleted from this
   * table along with the `power` reward variant that carried them.
   *
   * That left five missions — Armour Column, Demolition Crew, Old Guard,
   * Continental Yield and Hostile Takeover — with nothing to pay, and
   * `validateMissions` refuses a mission that pays nothing. It could not be
   * fixed by reassignment: every id in this table is already granted by exactly
   * one mission and the validator enforces it in both directions. So five new
   * payloads had to exist, and every one of them had to be GENUINELY CONSUMED —
   * the defect the powers themselves were an example of ("granted, written to
   * the profile, printed on the end screen, and read by nothing whatsoever") is
   * not one to repeat while fixing it.
   *
   * Two are new `UNLOCK_TAGS` groups over content that was ungated, is mirrored
   * one-per-army, and is nowhere near the opening path. THE OTHER THREE WERE
   * NEW BATTLEFIELDS AND DID NOT LAST — the maps were preset-clones and have
   * since been cut, taking their three missions with them; the block below this
   * one records the survey that found nothing left to gate in their place.
   * Cosmetics were NOT an option: all fourteen are
   * already paid, and nothing in the game renders one — `tests/reward-wiring.spec.ts`
   * asserts that gap explicitly, so paying a sixth into it would have been the
   * same bug with a different noun.
   *
   * unit.commander — `fieldMarshal` / `commissar` / `mrdHierarch` / `rclBaron`.
   *   Four defs, one per army, `maxAlive: 1`, 1500 credits off a barracks and a
   *   radar. `src/data/Defs.ts` used to argue these should stay ungated because
   *   "a unit a player cannot build on day one is a unit most players never
   *   meet"; that argument is answered by WHICH mission pays it. Old Guard is
   *   "promote 15 units to elite rank", which nobody completes without meeting
   *   the game properly first, and the hero is the officer those veterans get.
   *
   * struct.support — `repairDepot` / `mrdDepot` / `rclDepot`.
   *   Three defs for four armies, the Neutral shape. Gated behind Demolition
   *   Crew, the EASIEST of the five (raze 25 enemy structures — a couple of
   *   matches), because the depot's own note asked for exactly that: "a support
   *   structure gated behind mission progress would be a tutorial for a
   *   mechanic nobody had met". At difficulty 1 the player has met it. Nothing
   *   about repair becomes impossible meanwhile — the repair toggle and the
   *   engineer are both day-one — so this gates convenience, not capability. */
  unitCommander: 'unit.commander',
  structSupport: 'struct.support',

  /* -- THREE MAP IDS ARE GONE, AND SO ARE THE THREE MISSIONS THAT PAID THEM --
   * `map.saltpan-reach`, `map.foundry-line` and `map.glacier-shelf` were the
   * other half of the v2.6.0 rescue described above: three new battlefields for
   * three of the five missions the commander powers had orphaned. The maps were
   * cut from `MAPS` because every one of them reused an existing `MAP_PRESET`
   * verbatim, so all seven balance numbers matched a battlefield already in the
   * roster (see the block at the end of `MAPS` in
   * `src/shell/settings-store.ts`).
   *
   * DELETED, not left as ids nothing grants, for the reason the three naval ids
   * above were deleted: a schema member nothing produces is the next reader's
   * false lead. A profile that already earned one keeps the string; nothing
   * reads it, exactly as with `unit.naval`.
   *
   * THE THREE MISSIONS ARE RETIRED WITH THEM — Armour Column
   * (`combat.armour.2`), Continental Yield (`economy.harvest.3`) and Hostile
   * Takeover (`construction.capture.1`). That is a real loss and it is recorded
   * here rather than glossed, because the obvious repair — invent three new
   * `UNLOCK_TAGS` groups, the way `unit.commander` and `struct.support` repaid
   * two of the original five — WAS SURVEYED AND THERE IS NOTHING LEFT TO GATE.
   *
   * The survey, so nobody pays to run it twice. A valid group has to be built,
   * mirrored across all four armies, off the opening path, and not naval
   * (`UNLOCK_TAGS` has the rules; CLAUDE.md has the naval prohibition). Every
   * def in `Defs.ts` that is currently ungated falls into one of four buckets:
   *
   *   1. THE OPENING PATH — construction vehicle, yard, power, refinery,
   *      harvester, barracks, war factory, radar, silo, wall, one cheap
   *      defence, line infantry, engineer, main battle tank, and their twins in
   *      all four armies. `tests/match-start.spec.ts` and
   *      `tests/progression-gate.spec.ts` §5 both forbid gating these.
   *   2. NAVAL AND AMPHIBIOUS — four yards, eighteen hulls, four swimmers.
   *      Off limits: `tests/sea-crossing-gate.spec.ts` pins that no sea-bound
   *      entry may name an unlock id.
   *   3. NOT MIRRORED — `gate` and `flameTower` reach two armies and one. A
   *      group covering a subset of the roster is the `unit.air` defect, which
   *      this table has already had to fix once.
   *   4. DELIBERATELY AND PERMANENTLY OPEN — the three Command Posts. Their def
   *      rows say so in as many words: gating the only route to a commander
   *      power puts the powers back behind the profile.
   *
   * The one family that nearly qualified is the anti-armour infantryman —
   * `javelin` / `flakTrooper` / `mrdLancer`. It has no fourth member:
   * `tests/anti-armour-infantry.spec.ts` §1b records the Reclamation's foot
   * answer to armour as `rclPicker`, its LINE RIFLEMAN, and
   * `Scenarios.ts`'s role remap says the same thing by substituting `rclPicker`
   * for the javelin role. Gating the other three would leave three of four
   * armies with no infantry answer to a tank on a fresh profile, which is a
   * CAPABILITY hole rather than a widening — rule 2 at the top of this file.
   *
   * The twelve `UPGRADES` are a perfect four-army mirror and are ruled out by
   * the same rule 2, not by plumbing: every one of them is a flat multiplier on
   * damage, armour, speed, sight, reload, ore value or build time. "Unlocks are
   * VARIETY, not power" is the sentence that forbids it. `src/sim/Production.ts`
   * also hard-codes `unlockedBy: ''` for them, and it should stay that way.
   *
   * So the arithmetic, which is the honest summary: after the cut there are
   * three more profile missions than there are things left to pay them with. */

  /* -- cosmetics ---------------------------------------------------------- */
  insigniaBronze: 'cosmetic.insignia.bronze',
  insigniaGold: 'cosmetic.insignia.gold',
  insigniaVeteran: 'cosmetic.insignia.veteran',
  insigniaMagnate: 'cosmetic.insignia.magnate',
  insigniaWarlord: 'cosmetic.insignia.warlord',
  insigniaAllies: 'cosmetic.insignia.allies',
  insigniaSoviets: 'cosmetic.insignia.soviets',
  insigniaMeridian: 'cosmetic.insignia.meridian',
  /* -- what the three naval missions pay now ------------------------------ */
  insigniaAdmiralty: 'cosmetic.insignia.admiralty',
  insigniaUnbroken: 'cosmetic.insignia.unbroken',
  decalFleet: 'cosmetic.decal.fleet',
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
  // RETIRED: `combat.armour.2` — Armour Column, destroy 250 enemy vehicles.
  // Its whole reward was `map.saltpan-reach`, an arid preset-clone that is no
  // longer in `MAPS`. `combat.armour.1` (60 vehicles -> the AA emplacement) is
  // the chain now, and nothing required this step. See the retirement block
  // inside `UNLOCKS` for why it was not simply repaid.

  /* -- demolition ---------------------------------------------------------- */
  {
    id: 'combat.razed.1',
    scope: 'profile', category: 'combat', difficulty: 1,
    title: 'Demolition Crew',
    description: 'Destroy 25 enemy structures.',
    target: 25,
    rule: { on: 'kill', kinds: STRUCTURES },
    reward: grant(UNLOCKS.structSupport),
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
  // RANK 2 IS ELITE, AND IT IS THE TOP OF THE LADDER.
  //
  // This said `rank: 3` and could therefore never complete. `Damage.ts`'s
  // promotion loop is `while (rank < 2 && kills >= VETERANCY_KILLS[rank])` and
  // `Crates.ts` refuses to promote past 2 in the same words, so no
  // `entity:veterancy` event has ever carried a rank above 2 — and
  // `MissionTracker` advances only when `p.rank >= (rule.rank ?? 1)`. The
  // config agrees: `VETERANCY_KILLS` is two entries (3 and 6 kills) and
  // `VETERANCY_HP`/`VETERANCY_DAMAGE` are three (index 0 is the rookie), so the
  // ladder is rookie -> veteran(1) -> elite(2) and stops.
  //
  // The consequence was not a stuck row: this mission is the ONLY payer of
  // `power.emergency-repair`, so a fully implemented commander power was
  // permanently unreachable. LOWERED rather than raising the cap, because the
  // description already says "elite" and rank 2 IS elite — the number was the
  // typo, not the design. `tests/content-truthful.spec.ts` §1 now bounds every
  // veterancy rule against `VETERANCY_KILLS.length`.
  {
    id: 'combat.veteran.2',
    scope: 'profile', category: 'combat', difficulty: 3,
    title: 'Old Guard',
    description: 'Promote 15 units to elite rank.',
    target: 15,
    requires: ['combat.veteran.1'],
    rule: { on: 'veterancy', rank: 2 },
    reward: grant(UNLOCKS.unitCommander),
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
  // THE TECH CENTRE, AND THE NUMBER IS ONE MAP'S WORTH OF ORE.
  //
  // This was 250,000 and it was the single worst-priced row in the file. What it
  // gates is not a superweapon: `struct.tech` is `battleLab`/`mrdReliquary`/
  // `rclCrucible`, the building whose own blurb is "Unlocks the top of every
  // tab" — every tier-3 specialist, every capital hull, every advanced defence
  // tower, and (through `prereqs`) all six superweapon structures. A MID-game
  // building was priced above every superweapon chain in the file, so a fresh
  // profile could not reach the late-game layer from either side: the AI mirrors
  // the human's unlocks, so the whole v2.3.0 superweapon tier — models, HUD
  // countdown, firing path, AI targeting — was invisible to both.
  //
  // WHY 70,000. It is not picked from the air: it is ONE MAP'S WORTH OF ORE,
  // with margin. `addStartOre` lays three fields for a 1v1 — one R=30 m per army
  // and one R=22 m at the centroid — and running the real `OreField.seedField`
  // over that layout totals 74,538 credits, of which a player's own uncontested
  // field is about 30,000. `tests/content-truthful.spec.ts` §1 seeds it and
  // holds this row to it, so the yardstick is a mechanism rather than a claim.
  //
  // 70,000 rather than 74,000 because the test seeds with no `accept` predicate,
  // which is the GENEROUS reading: a real map rejects water and impassable
  // cells, so `coast` at `water: 0.45` seeds materially less than the ceiling.
  // A target sitting flush against the best case would be unreachable on the
  // wettest map in the set.
  //
  // So "Strip Mine" now means what it says: mine out a map. At 250,000 it meant
  // mine out THREE AND A THIRD MAPS, or eight times your own field.
  //
  // Measured against play rather than against the constants: `npm run soak` does
  // not report harvest totals, but `tests/harvester-soak.spec.ts` does deliver
  // real loads over real terrain, and across seeds 4242/1337/90210 twelve
  // harvesters returned 36 loads in 240 s — 429-700 credits per harvester per
  // minute, against the 1,312 that `HARVESTER_TARGET_ROUNDTRIP` implies. Three
  // harvesters over a 25-minute match is therefore ~41,000 banked, not the
  // ~98,000 the config's own target rate would predict, which is most of why
  // this number read as reasonable when it was written. 250,000 was ~6-7 matches
  // ON TOP of the 25,000 for `economy.harvest.1`, which does not carry over —
  // `MissionTracker.advance` refuses to accumulate a locked mission, so a chain
  // costs the sum of its rungs. 70,000 is ~2-3 matches, which is what the header
  // of this file means by "the first four chain steps are all reachable inside a
  // handful of matches".
  //
  // AND THE UNIT THIS ROW IS PRICED IN IS NOW THE UNIT IT IS COUNTED IN.
  //
  // The paragraph above derives 70,000 from two MINED quantities — 74,538 is
  // what `OreField.seedField` puts IN THE GROUND, and the 429-700 credits per
  // harvester per minute is `HarvesterController.deliveredTotal`, which takes
  // the full pre-cap payout. The rule, meanwhile, used to count BANKED credits:
  // `Economy.deposit` marked only the banked part `Harvest` and dumped the
  // overflow as `Waste`, so ore mined into a full silo advanced this mission by
  // nothing while the end screen's "Ore Harvested" credited every unit of it.
  // Worse, a PARTIAL overflow lost the banked part too, because the `Waste`
  // mark overwrote the tick's reason — and so did any repair drip or crate that
  // shared the tick. Measured on the real ledger: 100 loads of 700 into a full
  // bank moved this mission by 0 of 70,000.
  //
  // `EvCredits.mined` now carries the mined figure and `MissionTracker` counts
  // that, so the derivation above is exact rather than optimistic. Nothing
  // about the target moved; what moved is that the target is now reachable by
  // the argument that set it. A player CANNOT bank 100% of what they mine, so
  // under the old rule "one map's worth of ore" was a number no map could pay.
  //
  // ORE SILOS ARE THEREFORE NOT A PROGRESSION GATE ANY MORE. They still do
  // exactly what their blurb says — raise the cap, so you keep what you mine —
  // and they only recently started really doing it: `Economy.recomputeStorage`
  // used to overwrite the spawners' running total, so a silo raised the ceiling
  // for five ticks and then un-raised it. The two defects compounded, because a
  // silo that did nothing meant more overflow and more overflow meant a slower
  // ore mission. What a silo no longer does is silently decide how fast that
  // mission moves. The end screen shows both halves: "Ore Harvested" and the
  // part of it that never fitted, "Ore Wasted".
  //
  // LOWERING COSTS NO PLAYER ANY PROGRESS. `MissionTracker` stores raw
  // accumulated `value` per mission id and compares it to `def.target` on each
  // event, so a profile sitting at 90,000/250,000 completes on its next
  // delivered load. Nothing is reset and no id changes.
  {
    id: 'economy.harvest.2',
    scope: 'profile', category: 'economy', difficulty: 2,
    title: 'Strip Mine',
    description: 'Mine 70,000 credits of ore.',
    target: 70_000,
    requires: ['economy.harvest.1'],
    rule: { on: 'earn', reasons: [CreditReason.Harvest] },
    reward: grant(UNLOCKS.structTech),
  },
  // RETIRED: `economy.harvest.3` — Continental Yield, mine 1,000,000 credits of
  // ore. Paid `map.glacier-shelf` and nothing else. This was the file's longest
  // single target and the harvest chain now ends at `economy.harvest.2` (70,000
  // -> the tech building). `tests/content-truthful.spec.ts` cites the million
  // as its example of a career-spanning target and has been updated to name
  // `construction.produce.2` instead.
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
  // THE AIR ARM, AND IT IS DELIBERATELY FACTION-AGNOSTIC.
  //
  // `unit.air` was paid by `mastery.meridian.2` — "win 12 skirmishes as the
  // Meridian Pact" — which was right while the Kestrel was the only aircraft in
  // the game and wrong the moment `rclHornet`, `vindicator` and `mig` joined
  // it. A Reclamation player had to win a dozen matches as somebody else's army
  // to unlock their own gunship, which is the exact failure the mirroring rule
  // in `Defs.ts#UNLOCK_TAGS` exists to prevent.
  //
  // It sits on the VEHICLE chain because that is where the air arm actually
  // lives: all four aircraft are `BuildTab.Vehicles`, built by the war factory
  // off a radar, so "the top of the vehicle line" is what the reward is. 400 is
  // twice `construction.armour.1` and roughly half `construction.produce.2`'s
  // 750 all-units, which puts it at the same reach as the other difficulty-3
  // widenings without being a grind.
  {
    id: 'construction.armour.2',
    scope: 'profile', category: 'construction', difficulty: 3,
    title: 'Air Wing',
    description: 'Build 400 vehicles.',
    target: 400,
    requires: ['construction.armour.1'],
    rule: { on: 'produce', tab: BuildTab.Vehicles },
    reward: grant(UNLOCKS.unitAir),
  },
  // RETIRED: `construction.capture.1` — Hostile Takeover, capture 10 enemy
  // structures with engineers. Paid `map.foundry-line` and nothing else.
  //
  // THIS ONE COST THE MOST AND IS WORTH FLAGGING: it was the only PROFILE
  // mission with `rule: { on: 'capture' }`, so nothing in the cross-game curve
  // points a player at the engineer any more. `obj.capture.1` ("Seize The
  // Asset") still carries the metric on the per-match objective board, so the
  // event, `RULE_METRIC` and the tracking are all still exercised and a future
  // mission can use them without new plumbing — what is missing is something
  // for it to pay.
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
    reward: cosmeticUnlock(UNLOCKS.insigniaAdmiralty),
  },
  {
    id: 'tactics.wins.3',
    scope: 'profile', category: 'tactics', difficulty: 3,
    title: 'Fleet Admiral',
    description: 'Win 40 skirmishes.',
    target: 40,
    requires: ['tactics.wins.2'],
    rule: { on: 'win' },
    reward: cosmeticUnlock(UNLOCKS.decalFleet),
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
    reward: cosmeticUnlock(UNLOCKS.insigniaUnbroken),
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
    title: 'Displacement Ring Programme',
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
    title: 'Ironclad Field Programme',
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
  // TWO STEPS, LIKE THE OTHER TWO MASTERY CHAINS.
  //
  // This was three: 5 wins -> insignia, 12 wins -> `unit.air`, 20 wins ->
  // `superSolarLance`. The middle rung was the only faction-locked mission in
  // the file paying a group every army owns a member of (see
  // `construction.armour.2`), so it is gone and the superweapon step keeps the
  // id `mastery.meridian.2`.
  //
  // KEEPING THE ID RATHER THAN DELETING IT IS THE POINT. `MissionTracker`
  // stores progress per id and the metric is unchanged — wins as the Pact — so
  // a player sitting on 12 keeps 12 and now reads 12/20 against the same target
  // the Allied and Soviet superweapon steps use. Deleting `mastery.meridian.2`
  // and renumbering `.3` down would have thrown that progress away.
  {
    id: 'mastery.meridian.2',
    scope: 'profile', category: 'mastery', difficulty: 3, faction: Faction.Meridian,
    title: 'Solar Lance Programme',
    description: 'Win 20 skirmishes as the Meridian Pact.',
    target: 20,
    requires: ['mastery.meridian.1'],
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
 * The per-match board. Eight are drawn per match from the sim seed — normally
 * four main and four side — so a replay of the same seed draws the same board.
 * Their credit values are retained as
 * deferred design metadata, but are not advertised: no deterministic economy
 * consumer pays them yet. Every unlock remains behind a profile chain, so a
 * player who ignores the board is not locked out of content.
 * ========================================================================== */

const OBJECTIVES: readonly MissionDef[] = [
  {
    id: 'obj.kills.10',
    scope: 'match', category: 'combat', difficulty: 1, objectiveTier: 'side',
    title: 'Draw Blood',
    description: 'Destroy 10 enemy units.',
    target: 10,
    rule: { on: 'kill', kinds: [EntityKind.Infantry, EntityKind.Vehicle] },
    reward: [credits(400)],
  },
  {
    id: 'obj.kills.30',
    scope: 'match', category: 'combat', difficulty: 2, objectiveTier: 'main',
    title: 'Attrition',
    description: 'Destroy 30 enemy units.',
    target: 30,
    rule: { on: 'kill', kinds: [EntityKind.Infantry, EntityKind.Vehicle] },
    reward: [credits(900)],
  },
  {
    id: 'obj.armour.12',
    scope: 'match', category: 'combat', difficulty: 2, objectiveTier: 'main',
    title: 'Break The Column',
    description: 'Destroy 12 enemy vehicles.',
    target: 12,
    rule: { on: 'kill', kinds: VEHICLES },
    reward: [credits(700)],
  },
  {
    id: 'obj.raze.5',
    scope: 'match', category: 'combat', difficulty: 2, objectiveTier: 'main',
    title: 'Structural Damage',
    description: 'Destroy 5 enemy structures.',
    target: 5,
    rule: { on: 'kill', kinds: STRUCTURES },
    reward: [credits(700)],
  },
  {
    id: 'obj.veteran.3',
    scope: 'match', category: 'combat', difficulty: 2, objectiveTier: 'side',
    title: 'Field Promotion',
    description: 'Promote 3 units to veteran rank.',
    target: 3,
    rule: { on: 'veterancy', rank: 1 },
    reward: [credits(600)],
  },
  {
    id: 'obj.infantry.20',
    scope: 'match', category: 'combat', difficulty: 1, objectiveTier: 'side',
    title: 'Thin The Ranks',
    description: 'Destroy 20 enemy infantry.',
    target: 20,
    rule: { on: 'kill', kinds: [EntityKind.Infantry] },
    reward: [credits(550)],
  },
  {
    id: 'obj.asset-value.15000',
    scope: 'match', category: 'combat', difficulty: 3, objectiveTier: 'main',
    title: 'Costly Exchange',
    description: 'Destroy 15,000 credits worth of enemy assets.',
    target: 15_000,
    rule: { on: 'kill', metric: 'value' },
    reward: [credits(1100)],
  },
  {
    id: 'obj.elite.2',
    scope: 'match', category: 'combat', difficulty: 3, objectiveTier: 'main',
    title: 'Decorated Corps',
    description: 'Promote 2 units to elite rank.',
    target: 2,
    rule: { on: 'veterancy', rank: 2 },
    reward: [credits(1000)],
  },
  {
    id: 'obj.harvest.5000',
    scope: 'match', category: 'economy', difficulty: 1, objectiveTier: 'side',
    title: 'Ore Quota',
    description: 'Mine 5,000 credits of ore this match.',
    target: 5000,
    rule: { on: 'earn', reasons: [CreditReason.Harvest] },
    reward: [credits(500)],
  },
  {
    id: 'obj.bank.15000',
    scope: 'match', category: 'economy', difficulty: 2, objectiveTier: 'main',
    title: 'Liquidity',
    description: 'Hold 15,000 credits at one time.',
    target: 15_000,
    rule: { on: 'bank' },
    reward: [credits(600)],
  },
  {
    id: 'obj.power.150',
    scope: 'match', category: 'economy', difficulty: 1, objectiveTier: 'side',
    title: 'Keep The Lights On',
    description: 'Reach a 150-point power surplus.',
    target: 150,
    rule: { on: 'power' },
    reward: [credits(400)],
  },
  {
    id: 'obj.harvest.20000',
    scope: 'match', category: 'economy', difficulty: 3, objectiveTier: 'main',
    title: 'Industrial Appetite',
    description: 'Mine 20,000 credits of ore this match.',
    target: 20_000,
    rule: { on: 'earn', reasons: [CreditReason.Harvest] },
    reward: [credits(1000)],
  },
  {
    id: 'obj.power.300',
    scope: 'match', category: 'economy', difficulty: 2, objectiveTier: 'main',
    title: 'Reserve Capacity',
    description: 'Reach a 300-point power surplus.',
    target: 300,
    rule: { on: 'power' },
    reward: [credits(750)],
  },
  {
    id: 'obj.build.8',
    scope: 'match', category: 'construction', difficulty: 1, objectiveTier: 'main',
    title: 'Base Of Operations',
    description: 'Complete 8 structures.',
    target: 8,
    rule: { on: 'build' },
    reward: [credits(500)],
  },
  {
    id: 'obj.produce.20',
    scope: 'match', category: 'construction', difficulty: 1, objectiveTier: 'main',
    title: 'Standing Army',
    description: 'Train or build 20 units.',
    target: 20,
    rule: { on: 'produce' },
    reward: [credits(500)],
  },
  {
    id: 'obj.infantry-production.12',
    scope: 'match', category: 'construction', difficulty: 1, objectiveTier: 'side',
    title: 'Boots On The Ground',
    description: 'Train 12 infantry units.',
    target: 12,
    rule: { on: 'produce', tab: BuildTab.Infantry },
    reward: [credits(500)],
  },
  {
    id: 'obj.vehicle-production.12',
    scope: 'match', category: 'construction', difficulty: 2, objectiveTier: 'side',
    title: 'Motorised Force',
    description: 'Build 12 vehicles.',
    target: 12,
    rule: { on: 'produce', tab: BuildTab.Vehicles },
    reward: [credits(650)],
  },
  {
    id: 'obj.capture.1',
    scope: 'match', category: 'tactics', difficulty: 2, objectiveTier: 'side',
    title: 'Seize The Asset',
    description: 'Capture an enemy structure.',
    target: 1,
    rule: { on: 'capture' },
    reward: [credits(800)],
  },
  {
    id: 'obj.capture.3',
    scope: 'match', category: 'tactics', difficulty: 3, objectiveTier: 'main',
    title: 'Hostile Acquisition',
    description: 'Capture 3 enemy structures.',
    target: 3,
    rule: { on: 'capture' },
    reward: [credits(1300)],
  },
  {
    id: 'obj.noLoss.structures',
    scope: 'match', category: 'tactics', difficulty: 3, objectiveTier: 'main',
    title: 'Intact',
    description: 'Finish the match without losing a structure.',
    target: 1,
    rule: { on: 'noLoss', kinds: STRUCTURES },
    reward: [credits(1200)],
  },
  {
    id: 'obj.fast.win',
    scope: 'match', category: 'tactics', difficulty: 3, objectiveTier: 'main',
    title: 'Lightning Campaign',
    description: 'Win inside 15 minutes.',
    target: 1,
    rule: { on: 'win', withinSec: 900 },
    reward: [credits(1500)],
  },
  {
    id: 'obj.noLoss.vehicles',
    scope: 'match', category: 'tactics', difficulty: 3, objectiveTier: 'side',
    title: 'Preserve The Spearhead',
    description: 'Win without losing a vehicle.',
    target: 1,
    rule: { on: 'noLoss', kinds: VEHICLES, requireWin: true },
    reward: [credits(1200)],
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

/* ==========================================================================
 * 4b. WHICH MISSION PAYS THIS UNLOCK
 *
 * WHY THIS EXISTS. A locked build slot used to say `Locked — complete a
 * mission` — one constant, no mission name, on every padlocked cameo in the
 * sidebar. A player hovering a Proving Ground was told to complete "a mission" and
 * had no way to find out which one, and every piece of data needed to answer
 * was already here: the def carries `unlockedBy: 'struct.tech'`, and exactly
 * one mission (`economy.harvest.2`, "Strip Mine") pays that id out.
 *
 * WHY THE MAP LIVES HERE AND NOT IN THE GATE. `src/progression/UnlockGate.ts`
 * imports nothing but its own type-only module, deliberately, so that
 * `src/sim/**` can call `isBuildable` without dragging the mission table (or
 * `localStorage`, or the profile) into the simulation bundle. That property is
 * worth more than the convenience of a direct import, so the reverse map is
 * built where the table already is and INJECTED into the gate by
 * `progression.system.ts`. The gate takes it as data; it never reaches for it.
 *
 * ONE MISSION PER ID IS AN INVARIANT, NOT AN ASSUMPTION — the self-check below
 * already refuses a second grant, because a reward paid twice makes one of the
 * two missions pay nothing.
 * ========================================================================== */

/** Everything a locked tooltip needs to name the mission that opens a def. */
export interface UnlockSource {
  readonly unlockId: string;
  readonly missionId: string;
  /** `Strip Mine`. */
  readonly title: string;
  /** `Mine 70,000 credits of ore.` */
  readonly description: string;
}

/** Every granted unlock id, with the one mission that pays it. Table order. */
export const UNLOCK_SOURCES: readonly UnlockSource[] = (() => {
  const out: UnlockSource[] = [];
  const seen = new Set<string>();
  for (const m of MISSIONS) {
    for (const r of m.reward) {
      if (r.kind !== 'unlock' || seen.has(r.unlockId)) continue;
      seen.add(r.unlockId);
      out.push({ unlockId: r.unlockId, missionId: m.id, title: m.title, description: m.description });
    }
  }
  return out;
})();

const SOURCE_BY_UNLOCK = new Map<string, UnlockSource>(UNLOCK_SOURCES.map((s) => [s.unlockId, s]));

/** The mission that pays `unlockId`, or undefined when nothing does. */
export function unlockSource(unlockId: string): UnlockSource | undefined {
  return SOURCE_BY_UNLOCK.get(unlockId);
}

/**
 * `Strip Mine: mine 70,000 credits of ore` — the requirement in one line.
 *
 * The description's trailing full stop is dropped and its first letter lowered,
 * so the two halves read as one sentence after whatever prefix the caller uses
 * ("Locked — "). Returns '' when no mission grants the id, which is the honest
 * answer for a def gated behind something nothing pays; the caller falls back
 * to the generic line rather than printing a half-empty one.
 */
export function unlockRequirementText(unlockId: string): string {
  const src = SOURCE_BY_UNLOCK.get(unlockId);
  if (src === undefined) return '';
  const body = src.description.replace(/\.\s*$/, '');
  const lowered = body.length > 0 && body[0] === body[0].toUpperCase() && body[1] !== undefined
    && body[1] === body[1].toLowerCase()
    ? body[0].toLowerCase() + body.slice(1)
    : body;
  return `${src.title}: ${lowered}`;
}

/**
 * The whole map as plain pairs, for injection into `UnlockGate`.
 *
 * Pairs rather than the `UnlockSource` objects because the gate only ever wants
 * the sentence — handing it the mission records would invite it to grow a
 * dependency on their shape.
 */
export const UNLOCK_REQUIREMENTS: readonly (readonly [string, string])[] =
  UNLOCK_SOURCES.map((s) => [s.unlockId, unlockRequirementText(s.unlockId)] as const);

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
    if (m.scope === 'match' && m.objectiveTier !== 'main' && m.objectiveTier !== 'side') {
      problems.push(`match objective "${m.id}" has no main/side objective tier`);
    }
    if (m.scope === 'profile' && m.objectiveTier !== undefined) {
      problems.push(`profile mission "${m.id}" declares a match-only objective tier`);
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

  return problems;
}

{
  const problems = validateMissions(MISSIONS);
  if (problems.length > 0) throw new Error(`[data] mission errors:\n  ${problems.join('\n  ')}`);
}
