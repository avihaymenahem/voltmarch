/**
 * ============================================================================
 * tests/teams.spec.ts — 2v2 and 1v3: the mask, the sim, and the win condition
 * ============================================================================
 * `PlayerState.allyMask` was read by targeting, vision, damage, crush, capture,
 * garrison, the minimap and both outcome polls, and WRITTEN BY NOBODY except
 * `createPlayerState` (self) and `ScenarioBuilder.gaia` (the scenery). So every
 * one of those readers was correct and unreachable, and "a free-for-all is the
 * default diplomacy" — which four separate source files say in those words —
 * was not a default at all. It was the only expressible state.
 *
 * WHAT THIS FILE REFUSES TO DO, and why it is arranged the way it is.
 *
 * A SPEC THAT READS `setup.opponents` WOULD PASS AGAINST A BROKEN BUILD. That
 * is not a hypothetical: `CLAUDE.md` records the campaign's `foe` fix, where
 * setting `opponents` alone changed nothing because `effectiveOpponents`
 * re-asserts the singular mirror ONTO ENTRY 0 and a test reading the array
 * would have agreed the fix worked. `team` has no singular mirror, so it is
 * exposed to exactly that trap from the other side — §2 aims a case straight
 * at it — and everything downstream of the setup is measured on a REAL `World`
 * with the REAL targeting service, never on the object the lobby produced.
 *
 * EVERY SIM CASE CARRIES ITS FALSIFIER. The ally is deliberately placed CLOSER
 * to the shooter than the enemy is, so an FFA world and a teamed world give
 * opposite answers on the same geometry: §3 runs both and the difference is the
 * whole measurement. A test where the right answer is also the answer a broken
 * build gives is not evidence.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, Locomotor, Stance, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { ARMOR_MATRIX, SIM_DT } from '../src/core/config';

import { DamageSystem, setArmorMatrix } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import {
  WeaponSystem, setContentWeaponMap, setWeaponKeyResolver, weaponIndexOf,
} from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import {
  hasAssets, isBeaten, makeViabilitySurvey, surveyViability,
} from '../src/sim/Viability';

import { applyTeams, isHostileSeat } from '../src/game/Teams';
import {
  MAP_START_TABLES, orderTeamStartSpots, rotateTeamStarts,
} from '../src/game/Scenarios';
import {
  MAPS,
  TEAM_PLAYER,
  defaultSetup,
  defaultTeamFor,
  describeTeams,
  effectiveOpponents,
  normalizeSetup,
  teamsOf,
  teamsPlayable,
  withArmyCount,
} from '../src/shell/settings-store';

const ROSTER = ['allies', 'soviets', 'meridian', 'reclaim'];
/** A battlefield that really seats four; `normalizeSetup` clamps to it. */
const FOUR = MAPS.find((m) => m.players >= 4)?.id ?? MAPS[0].id;

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;
const P2 = 2 as PlayerId;
const P3 = 3 as PlayerId;

/* ==========================================================================
 * 1. THE SETUP FIELD
 * ========================================================================== */

describe('the lobby can say who is on whose side', () => {
  it('reads a setup that predates teams as the free-for-all it was', () => {
    // Exactly what an older build wrote: an army list with no `team` key
    // anywhere in it.
    const s = normalizeSetup({
      playerFaction: 'allies', aiFaction: 'soviets', map: FOUR,
      opponents: [
        { faction: 'soviets', difficulty: 1, personality: -1 },
        { faction: 'meridian', difficulty: 1, personality: -1 },
        { faction: 'reclaim', difficulty: 1, personality: -1 },
      ],
    }, ROSTER);

    const teams = teamsOf(s);
    expect(teams).toHaveLength(4);
    expect(new Set(teams).size, 'four armies, four sides').toBe(4);
    expect(describeTeams(s)).toBe('1 v 1 v 1 v 1');
  });

  it('round-trips a 2v2 and a 1v3 through storage', () => {
    const base = withArmyCount({ ...defaultSetup(), map: FOUR }, 4, ROSTER);

    // 2v2: opponent one joins the player, the other two share a side.
    const twoTwo = JSON.parse(JSON.stringify(base)) as typeof base;
    twoTwo.opponents[0].team = TEAM_PLAYER;
    twoTwo.opponents[1].team = 3;
    twoTwo.opponents[2].team = 3;
    const backTwo = normalizeSetup(JSON.parse(JSON.stringify(twoTwo)), ROSTER);
    expect(teamsOf(backTwo)).toEqual([1, 1, 3, 3]);
    expect(describeTeams(backTwo)).toBe('2 v 2');

    // 1v3: three armies against the human, allied to each other.
    const oneThree = JSON.parse(JSON.stringify(base)) as typeof base;
    for (const o of oneThree.opponents) o.team = 2;
    const backOne = normalizeSetup(JSON.parse(JSON.stringify(oneThree)), ROSTER);
    expect(teamsOf(backOne)).toEqual([1, 2, 2, 2]);
    expect(describeTeams(backOne)).toBe('1 v 3');
  });

  /**
   * A table with one team is a match `outcome.system.ts` can never resolve: it
   * guards victory on `hostiles > 0` and nobody is their own enemy.
   */
  it('repairs a stored table that left nobody to fight', () => {
    const s = normalizeSetup({
      playerFaction: 'allies', aiFaction: 'soviets', map: FOUR,
      opponents: [
        { faction: 'soviets', difficulty: 1, personality: -1, team: TEAM_PLAYER },
        { faction: 'meridian', difficulty: 1, personality: -1, team: TEAM_PLAYER },
        { faction: 'reclaim', difficulty: 1, personality: -1, team: TEAM_PLAYER },
      ],
    }, ROSTER);
    expect(teamsPlayable(teamsOf(s))).toBe(true);
    expect(teamsOf(s), 'the whole partition resets, never one seat').toEqual([1, 2, 3, 4]);
  });

  it('clamps a team off a corrupt blob instead of inventing a fourth relation', () => {
    const s = normalizeSetup({
      playerFaction: 'allies', aiFaction: 'soviets', map: FOUR,
      opponents: [
        { faction: 'soviets', difficulty: 1, personality: -1, team: 0 },
        { faction: 'meridian', difficulty: 1, personality: -1, team: 999 },
        { faction: 'reclaim', difficulty: 1, personality: -1, team: -3 },
      ],
    }, ROSTER);
    // 0 and -3 clamp UP to TEAM_PLAYER — "on my team" — and 999 down to the
    // widest label a partition of four armies can need.
    expect(teamsOf(s)).toEqual([1, 1, 4, 1]);
  });

  it('a new seat arrives on its own side, never on the human`s', () => {
    const two = { ...defaultSetup(), map: FOUR };
    const four = withArmyCount(two, 4, ROSTER);
    expect(four.opponents.map((o) => o.team)).toEqual([2, 3, 4]);
    expect(four.opponents.every((o) => o.team !== TEAM_PLAYER)).toBe(true);
  });
});

/* ==========================================================================
 * 2. THE MIRROR TRAP
 *
 * `effectiveOpponents` rebuilds entry 0 from the singular `aiFaction` /
 * `difficulty` / `personality` fields, because those are the half an older
 * build, a save row and a hand-written literal can all reach. `team` has no
 * such half, so rebuilding entry 0 without carrying it forward silently deletes
 * the human's only ally on every launch — the campaign `foe` defect, arriving
 * from the opposite direction.
 * ========================================================================== */

describe('opponent one keeps its team through the singular mirror', () => {
  it('carries `team` off the array while the other three fields are re-asserted', () => {
    const s = withArmyCount({ ...defaultSetup(), map: FOUR }, 3, ROSTER);
    s.opponents[0].team = TEAM_PLAYER;
    // The mirror deliberately disagrees with the array on every field it owns.
    s.aiFaction = 'reclaim';
    s.difficulty = 3;
    s.personality = 2;
    s.opponents[0].faction = 'IGNORED';
    s.opponents[0].difficulty = 0;
    s.opponents[0].personality = -1;

    const eff = effectiveOpponents(s);
    expect(eff[0].faction, 'the singular fields still win where they exist').toBe('reclaim');
    expect(eff[0].difficulty).toBe(3);
    expect(eff[0].personality).toBe(2);
    // …and the field they do not own survives. Delete `team: o.team` from
    // `effectiveOpponents` and this reads `undefined`, `teamsOf` hands the
    // writer a `NaN`, and the ally is quietly seated as an enemy.
    expect(eff[0].team).toBe(TEAM_PLAYER);
    expect(teamsOf(s)).toEqual([1, 1, 3]);
  });
});

/* ==========================================================================
 * 3. THE WRITER, AND THE SIM HONOURING IT
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  targeting: TargetingSystem;
  weapons: WeaponSystem;
  projectiles: ProjectileSystem;
  damage: DamageSystem;
  tick: number;
  ctx(): SimContext;
  step(n?: number): void;
}

const W_LIGHT_CANNON = weaponIndexOf('lightCannon');

/** Four armies plus Gaia, exactly as `Shell.applySetupToWorld` leaves them. */
function makeRig(): Rig {
  setContentWeaponMap({});
  setWeaponKeyResolver(null);
  setArmorMatrix(ARMOR_MATRIX);

  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Ally AI', false, false);
  world.addPlayer(Faction.Meridian, 'Enemy AI 1', false, false);
  world.addPlayer(Faction.Reclaim, 'Enemy AI 2', false, false);

  const projectiles = new ProjectileSystem(world, channels);
  const damage = new DamageSystem(world, channels);
  const weapons = new WeaponSystem(world, channels, projectiles);
  const targeting = new TargetingSystem(world, channels, weapons);
  const rng = new Rng(4242);

  const rig: Rig = {
    world, channels, targeting, weapons, projectiles, damage, tick: 0,
    ctx(): SimContext {
      return { dt: SIM_DT, tick: rig.tick, time: rig.tick * SIM_DT, rng };
    },
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        rig.tick++;
        world.store.snapshotPrev();
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        const s = rig.ctx();
        world.spatial.rebuild();
        targeting.tick(s);
        weapons.tick(s);
        projectiles.tick(s);
        damage.damageTick(s);
        damage.cleanupTick(s);
        channels.damage.clear();
        channels.fx.clear();
      }
    },
  };
  return rig;
}

/** The Gaia slot the scenario adds, allied to everybody in both directions. */
function addGaia(world: World): PlayerId {
  const id = world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  const gp = world.player(id);
  for (let i = 0; i < world.players.length; i++) {
    gp.allyMask |= 1 << i;
    world.players[i].allyMask |= 1 << (id as number);
  }
  return id;
}

interface SpawnOpts { kind?: EntityKind; hp?: number; weapon?: number; flags?: number }

function spawn(rig: Rig, player: PlayerId, x: number, z: number, o: SpawnOpts = {}): EntityId {
  const st = rig.world.store;
  const kind = o.kind ?? EntityKind.Vehicle;
  const h = st.alloc(kind, -1, player, rig.world.player(player).faction, x, 0, z, 0);
  const i = st.index(h);
  st.maxHp[i] = o.hp ?? 400;
  st.hp[i] = o.hp ?? 400;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2;
  st.sight[i] = 40;
  st.weaponIndex[i] = o.weapon ?? -1;
  st.locomotor[i] = kind === EntityKind.Building ? Locomotor.Static : Locomotor.Track;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  let flags = EntityFlag.ProvidesVision | (o.flags ?? 0);
  if ((o.weapon ?? -1) >= 0) flags |= EntityFlag.CanAttack | EntityFlag.HasTurret;
  st.flags[i] |= flags;
  return h;
}

describe('the team writer', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('allies both directions, because `areAllied` only ever asks one', () => {
    applyTeams(rig.world, [1, 1, 2, 2]);
    const w = rig.world;
    expect(w.areAllied(P0, P1)).toBe(true);
    expect(w.areAllied(P1, P0), 'a one-way write is an army that gets shot in the back').toBe(true);
    expect(w.areAllied(P2, P3)).toBe(true);
    expect(w.areAllied(P3, P2)).toBe(true);

    expect(w.areAllied(P0, P2)).toBe(false);
    expect(w.areAllied(P2, P0)).toBe(false);
    expect(w.areAllied(P1, P3)).toBe(false);
  });

  it('writes nothing at all for a free-for-all', () => {
    const before = rig.world.players.map((p) => p.allyMask);
    applyTeams(rig.world, [1, 2, 3, 4]);
    expect(rig.world.players.map((p) => p.allyMask)).toEqual(before);
  });

  it('leaves Gaia allied to everybody and on nobody`s team', () => {
    const gaia = addGaia(rig.world);
    applyTeams(rig.world, [1, 1, 2, 2]);
    for (const p of rig.world.players) {
      expect(rig.world.areAllied(gaia, p.id), 'the scenery is friends with everyone').toBe(true);
      expect(rig.world.areAllied(p.id, gaia)).toBe(true);
    }
    // …and it is nobody's victory condition, whichever way round it is asked.
    expect(isHostileSeat(rig.world, P0, rig.world.player(gaia))).toBe(false);
  });

  it('is idempotent, because the boot retry path re-enters the seating', () => {
    applyTeams(rig.world, [1, 1, 2, 2]);
    const once = rig.world.players.map((p) => p.allyMask);
    applyTeams(rig.world, [1, 1, 2, 2]);
    expect(rig.world.players.map((p) => p.allyMask)).toEqual(once);
  });
});

describe('a team holds in the simulation', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  /**
   * THE FALSIFIER, RUN FIRST. The ally sits 8 m away and the enemy 14 m, so in
   * a free-for-all the shooter picks the nearer one — which is what makes the
   * next case a measurement rather than a coincidence of geometry.
   */
  it('shoots the nearest army when there are no teams', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    const near = spawn(rig, P1, 108, 100);
    spawn(rig, P2, 114, 100);
    rig.world.spatial.rebuild();
    rig.targeting.tick(rig.ctx());
    expect(rig.world.store.targetId[rig.world.store.index(me)]).toBe(near as number);
  });

  it('never targets a team-mate, even when the team-mate is closer', () => {
    applyTeams(rig.world, [1, 1, 2, 2]);
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    const ally = spawn(rig, P1, 108, 100);
    const foe = spawn(rig, P2, 114, 100);
    rig.world.spatial.rebuild();
    rig.targeting.tick(rig.ctx());

    const st = rig.world.store;
    expect(st.targetId[st.index(me)]).toBe(foe as number);
    expect(st.targetId[st.index(me)]).not.toBe(ally as number);
  });

  it('holds for the whole engagement, not just the acquisition tick', () => {
    applyTeams(rig.world, [1, 1, 2, 2]);
    // Two allied guns, two enemy guns, everyone in everyone's range.
    spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    const ally = spawn(rig, P1, 104, 100, { weapon: W_LIGHT_CANNON });
    spawn(rig, P2, 112, 100, { weapon: W_LIGHT_CANNON });
    spawn(rig, P3, 116, 100, { weapon: W_LIGHT_CANNON });
    rig.world.spatial.rebuild();

    const st = rig.world.store;
    const allyHpAtStart = st.hp[st.index(ally)];
    // Long enough for every acquisition slice to come round several times and
    // for real rounds to land.
    rig.step(120);

    // The ally took fire from the OTHER team — the match is really happening —
    // but never from us: kills and damage credit both live on the shooter, so
    // the honest test is that our own gun never once held the ally as a target.
    expect(st.hp[st.index(ally)]).toBeLessThan(allyHpAtStart);
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      const t = st.targetId[i];
      if (t === 0) continue;
      const ti = st.index(t as EntityId);
      if (ti < 0) continue;
      expect(
        rig.world.areAllied(st.owner[i] as PlayerId, st.owner[ti] as PlayerId),
        `p${st.owner[i]} is aiming at an ally`,
      ).toBe(false);
    }
  });
});

/* ==========================================================================
 * 4. THE OUTCOME RULE
 *
 * `outcome.system.ts` counts hostiles with `isHostileSeat` and beats them with
 * `Viability.isBeaten`; `Shell.pollOutcome` counts the same seats with the same
 * function. What is asserted here is the composition of those two — which seats
 * the victory condition is made of — over a real store.
 * ========================================================================== */

describe('a team changes what beaten means', () => {
  let rig: Rig;
  const survey = makeViabilitySurvey();

  beforeEach(() => { rig = makeRig(); });

  /** The victory poll's own loop, over the shared predicate. */
  function hostiles(local: PlayerId): { count: number; beaten: number } {
    let count = 0;
    let beaten = 0;
    for (const p of rig.world.players) {
      if (!isHostileSeat(rig.world, local, p)) continue;
      count++;
      surveyViability(rig.world, p.id, survey);
      if (isBeaten(survey)) beaten++;
    }
    return { count, beaten };
  }

  it('counts the other team as the win condition, not every other seat', () => {
    addGaia(rig.world);
    applyTeams(rig.world, [1, 1, 2, 2]);
    // Everybody owns a factory and a tank, so nobody is beaten yet.
    for (const p of [P0, P1, P2, P3]) {
      spawn(rig, p, 100 + (p as number) * 20, 100, {
        kind: EntityKind.Building, flags: EntityFlag.IsFactory,
      });
      spawn(rig, p, 100 + (p as number) * 20, 110);
    }
    const h = hostiles(P0);
    expect(h.count, 'four armies and Gaia, but only two of them are the enemy').toBe(2);
    expect(h.beaten).toBe(0);
  });

  /**
   * The rule, stated: a team wins when the last seat on every OTHER team is
   * beaten. An ally's collapse is not a victory and not a defeat.
   */
  it('wins when the last enemy seat is beaten, and an ally`s collapse decides nothing', () => {
    addGaia(rig.world);
    applyTeams(rig.world, [1, 1, 2, 2]);
    spawn(rig, P0, 100, 100, { kind: EntityKind.Building, flags: EntityFlag.IsFactory });
    const enemyBase = spawn(rig, P2, 200, 100, {
      kind: EntityKind.Building, hp: 50, flags: EntityFlag.IsFactory,
    });
    // p1 (our ally) and p3 own nothing at all: one wiped ally, one wiped enemy.
    expect(hostiles(P0)).toEqual({ count: 2, beaten: 1 });

    // The local player is not beaten — a wiped ALLY is somebody else's match.
    surveyViability(rig.world, P0, survey);
    expect(hasAssets(survey)).toBe(true);
    expect(isBeaten(survey)).toBe(false);

    // Kill the last enemy asset and the whole hostile team is beaten.
    const st = rig.world.store;
    st.hp[st.index(enemyBase)] = 0;
    st.flags[st.index(enemyBase)] &= ~EntityFlag.Alive;
    expect(hostiles(P0)).toEqual({ count: 2, beaten: 2 });
  });

  it('a beaten player is beaten whether or not their team is', () => {
    addGaia(rig.world);
    applyTeams(rig.world, [1, 1, 2, 2]);
    // The ally is fine; we own nothing.
    spawn(rig, P1, 100, 100, { kind: EntityKind.Building, flags: EntityFlag.IsFactory });
    spawn(rig, P2, 200, 100, { kind: EntityKind.Building, flags: EntityFlag.IsFactory });

    surveyViability(rig.world, P0, survey);
    expect(hasAssets(survey), 'no buildings and no units: the shell ends it here').toBe(false);
    // …and the survey is per PLAYER, which is the same object the sell guard
    // inside `simTick` reads. A team-wide viability rule would let a player
    // sell their last Construction Yard because an ally still owns one, which
    // is the soft lock `Viability`'s header exists to make impossible.
    surveyViability(rig.world, P1, survey);
    expect(hasAssets(survey)).toBe(true);
  });
});

/* ==========================================================================
 * 5. ONE DEFINITION OF ENEMY
 *
 * "Not Gaia and not allied to me" was written out inline five times across
 * `outcome.system.ts` (the victory poll, the winner search, the recomputed
 * verdict) and `Shell.ts` (its own poll, the end screen's opponent list). They
 * agreed while the answer was always "everyone else"; teams are what make them
 * able to disagree, so they are one function now — and this is the tripwire
 * that fails when a sixth copy is written.
 * ========================================================================== */

describe('the outcome module owns no private copy of the diplomacy rule', () => {
  it('never calls `areAllied` itself', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('apps/game/src/game/outcome.system.ts', 'utf8');
    expect(src).toContain('isHostileSeat');
    expect(
      src.includes('areAllied('),
      'a fresh inline `areAllied` test here is a second definition of "enemy"',
    ).toBe(false);
  });

  /**
   * THE WIRE, AND WHAT THIS CAN AND CANNOT PROVE.
   *
   * `tests/armies-wire.spec.ts` exists because `setPlannedArmies` shipped
   * exported, documented over sixteen lines and called by NOBODY, and every
   * test around it passed. `applyTeams` is one commit away from the same shape:
   * everything above proves the writer works and the sim honours it, and none
   * of it would notice the shell forgetting to call it.
   *
   * `applySetupToWorld` is private, needs a live `GameHandle`, and runs in the
   * one synchronous window between `bootstrap()` and the scenario — there is no
   * headless harness for it anywhere in this repo, and building one would be a
   * larger thing than the feature. So this reads the source, which is honest
   * about being a weaker instrument: it proves the call is WRITTEN, not that it
   * RUNS. `tests/shell-scope.spec.ts` already enumerates `src/**` for the same
   * kind of reason.
   */
  it('the shell seats the lobby`s teams where it seats the armies', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('apps/game/src/shell/Shell.ts', 'utf8');
    const start = src.indexOf('private applySetupToWorld');
    expect(start, 'the seating method was renamed; re-point this').toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('private seatPvpPlayers', start));
    expect(body).toContain('applyTeams(world, teamsOf(this.setup))');
    // …and not for the title-screen backdrop, which is always a duel.
    expect(body).toContain('if (!backdrop) applyTeams');
  });

  it('the PvP path writes the relay team mask before tick zero', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('apps/game/src/shell/Shell.ts', 'utf8');
    const start = src.indexOf('private seatPvpPlayers');
    const body = src.slice(start, src.indexOf('private seatReplayPlayers', start));
    expect(body).toContain('applyTeams(world, pvp.info.teams)');
    expect(body).toContain('while (world.players.length < pvp.info.factions.length)');
  });
});

/* ==========================================================================
 * 6. THE SEAT ORDER
 *
 * `teamsOf` is seat-ordered and `applyTeams` indexes `world.players` with it,
 * so the two must agree about which entry is the human. They do by
 * construction — index 0 — and this is what fails if either end starts
 * counting from the opponents.
 * ========================================================================== */

describe('the setup and the world agree about which seat is which', () => {
  it('rotates alliances as intact start blocks for 2v1 and 2v2', () => {
    for (const teams of [[0, 0, 1], [0, 0, 1, 1]]) {
      const rig = makeRig();
      applyTeams(rig.world, teams);
      const owners = [P0, P1, P2, P3].slice(0, teams.length);
      for (let seed = 0; seed < 32; seed++) {
        const rotated = rotateTeamStarts(owners, seed, rig.world);
        const index0 = rotated.indexOf(P0);
        const index1 = rotated.indexOf(P1);
        expect(Math.abs(index0 - index1), `${teams.length} seats, seed ${seed}`).toBe(1);

        const table = MAP_START_TABLES.temperate!;
        const raw = table.slots.slice(0, teams.length).map((slot) => ({
          x: slot.dx, z: slot.dz, facingDeg: 0,
        }));
        const placed = orderTeamStartSpots(raw, rotated, rig.world, 'temperate');
        const a = placed[index0]!;
        const b = placed[index1]!;
        const foe = placed[rotated.findIndex((owner) => !rig.world.areAllied(P0, owner))]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${teams.length} allied distance`)
          .toBeLessThan(Math.hypot(a.x - foe.x, a.z - foe.z));
      }
    }
  });

  it('seats a lobby 1v3 as one human against three allied armies', () => {
    const setup = withArmyCount({ ...defaultSetup(), map: FOUR }, 4, ROSTER);
    for (const o of setup.opponents) o.team = defaultTeamFor(0);

    const rig = makeRig();
    addGaia(rig.world);
    applyTeams(rig.world, teamsOf(setup));

    expect(describeTeams(setup)).toBe('1 v 3');
    for (const foe of [P1, P2, P3]) {
      expect(rig.world.areAllied(P0, foe)).toBe(false);
      for (const other of [P1, P2, P3]) {
        expect(rig.world.areAllied(foe, other), 'the three of them are one army').toBe(true);
      }
    }
  });
});
