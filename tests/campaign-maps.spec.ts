/**
 * ============================================================================
 * tests/campaign-maps.spec.ts — every operation is BUILT, headless, and the
 * ground is checked against what its triggers assume
 * ============================================================================
 * `campaign-validate.spec.ts` proves the trigger table is well formed. It
 * cannot prove the ground exists: a layout that declares `tags: ['tap']` and
 * then fails to place the tap — because the def key was wrong, because the
 * footprint would not fit, because the spot came out under water — validates
 * perfectly and ships an operation nobody can win.
 *
 * So this file builds each operation for real, with a real `Terrain` and a real
 * `ScenarioBuilder`, and asks the questions only a built world can answer.
 *
 * THE DECLARATION IS CHECKED IN BOTH DIRECTIONS, WHICH IS THE POINT
 * -----------------------------------------------------------------
 * A layout DECLARES its tags rather than having them discovered, because a
 * layout that stamps a tag on only one branch — a seat that is not always
 * seated, a structure only placed on four-army maps — would otherwise validate
 * on whichever seed happened to run. Declaring it makes the claim explicit;
 * this file makes it true:
 *
 *   - every declared tag actually landed on at least one entity, so a
 *     misspelled def key or an impossible placement is caught here rather than
 *     by a player at minute nine;
 *   - every tag a TRIGGER names is one the layout declared — which
 *     `validateCampaign` also checks, deliberately twice, because the two
 *     checks fail at different times and the import-time one is the cheap one.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * "Winnable in practice" is not answerable by building a world; it is answered
 * by playing it, and Gate M's definition of done says so. This file answers
 * "does the ground the operation was authored against actually exist".
 *
 * **AND IT ANSWERS IT UNROSTERED, WHICH IS A SECOND THING IT DOES NOT CLAIM.**
 * `buildOperation` below installs the plan and the layout and nothing else: no
 * `setCampaignRoster`, and no `defs`. Both omissions point the same way — an
 * operation's roster is an ALLOW-LIST and `spawnBuilding` hands `isBuildable`
 * the RESOLVED def, which is `undefined` under the empty binding and which
 * `rosterAllows` therefore permits — so every structure lands here whatever the
 * roster says, and a roster typo that deletes a tagged structure leaves this
 * whole file green. That is `tests/campaign-roster-ground.spec.ts`'s job: the
 * same builds with the tables bound and each operation's own roster armed,
 * against an unrostered control. Do not read a pass here as a statement about
 * the world a player actually gets.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, planScenario, resolveDefBinding, setCampaignLayout,
  setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import { TagRegistry, makeEffectSink } from '../src/campaign/runtime';
import { tagsUsedByCondition } from '../src/campaign/validate';
import type { Condition, OperationDef } from '../src/campaign/types';

const ROOT = process.cwd();

/* -- the harness ---------------------------------------------------------- */

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

interface Built {
  world: World;
  /** tag -> entities the layout stamped. */
  tags: Map<string, EntityId[]>;
}

/**
 * Build one operation exactly the way `campaign-install.ts` arms it: plan
 * first, layout second, THEN the world. Getting that order wrong is the same
 * mistake as installing the roster after the boot, and it would show up here as
 * an empty tag set rather than as an error.
 */
function buildOperation(op: OperationDef): Built {
  const sea = MAP_SEAS[op.map.preset] ?? null;
  const terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: op.map.mapSeed,
    biome: op.map.biome as never,
    anisotropy: 1,
    starts: startPointsFor(op.map.armies, sea, op.map.simSeed).map((p) => ({ x: p.x, z: p.z })),
    sea,
  });
  setActiveTerrain(terrain);

  const world = new World();
  world.addPlayer(FACTION_OF[op.chapter], 'Commander', true, true);
  // SEATED FROM `op.foe`, EXACTLY AS `Shell.startOperation` NOW DOES.
  // This was a hard-coded `Faction.Allies` — which was the shell's behaviour
  // only by accident, because the shell took the opponent from the SKIRMISH
  // LOBBY and the lobby's default happens to be an Allied/Soviet pair. So
  // `reclamation.01.held-paper` was never once built against the army it is
  // written for until this line changed.
  for (let seat = 1; seat < op.map.armies; seat++) {
    world.addPlayer(op.foe, 'Opponent', false, false);
  }
  world.terrain = terrain;

  const tags = new Map<string, EntityId[]>();
  const l = LAYOUTS.get(op.layout);
  expect(l, `operation ${op.id} names layout '${op.layout}'`).toBeDefined();

  setPlannedOperation({
    id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
  });
  setCampaignLayout((b, cx, cz, start) => {
    l!.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (name, id) => {
        if (id === NONE) return;
        const list = tags.get(name);
        if (list === undefined) tags.set(name, [id]);
        else list.push(id);
      },
      seat: (i) => b.armySlot(i),
    });
  });

  try {
    buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies });
  } finally {
    setCampaignLayout(null);
    setPlannedOperation(null);
    clearScenario();
    terrain.dispose?.();
  }
  return { world, tags };
}

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);

/* ==========================================================================
 * 0. THE GUARD ON THE GUARD
 * ========================================================================== */

describe('there is a campaign to build', () => {
  it('at least one operation and one layout exist', () => {
    // Without this the whole file passes vacuously the day somebody's glob
    // stops matching — which is the exact failure `Systems.ts` records having
    // shipped once already.
    expect(ALL.length).toBeGreaterThan(0);
    expect(LAYOUTS.size).toBeGreaterThan(0);
  });

  it('every registered layout is used by an operation', () => {
    const used = new Set(ALL.map((o) => o.layout));
    for (const id of LAYOUTS.keys()) {
      expect(used.has(id), `layout '${id}' is registered and no operation names it`).toBe(true);
    }
  });
});

/* ==========================================================================
 * 1. THE PLAN
 * ========================================================================== */

describe('an armed operation decides the plan, and nothing else can', () => {
  it('takes its preset, seats and opening from the operation', () => {
    for (const op of ALL) {
      setPlannedOperation({
        id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
      });
      try {
        const plan = planScenario('campaign');
        expect(plan.map, op.id).toBe(op.map.preset);
        expect(plan.armies, op.id).toBe(op.map.armies);
        expect(plan.start, op.id).toBe(op.map.opening === 'mcv' ? 'mcv' : 'base');
      } finally {
        setPlannedOperation(null);
      }
    }
  });

  it('THE FALLBACK: `campaign` with nothing armed is a total router, not a hole', () => {
    setPlannedOperation(null);
    const plan = planScenario('campaign');
    expect(plan.start, 'an unarmed campaign boot still gets a pre-built opening').toBe('base');
    expect(plan.armies).toBeGreaterThanOrEqual(2);
  });

  it('and no OTHER scenario name can be talked out of `base`', () => {
    // The campaign exception is narrow on purpose. This is the half of it that
    // could rot silently: a later edit widening the condition would leave every
    // posed fixture taking a lobby opening.
    for (const name of ['atoll', 'naval', 'battle', 'economy', 'blob']) {
      expect(planScenario(name, null, null, 'mcv').start, name).toBe('base');
    }
    // …while `skirmish` still honours it, or the test above proves nothing.
    expect(planScenario('skirmish', null, null, 'mcv').start).toBe('mcv');
  });
});

/* ==========================================================================
 * 2. THE GROUND
 * ========================================================================== */

describe('every operation builds a world its triggers can read', () => {
  for (const op of ALL) {
    describe(op.id, () => {
      const built = buildOperation(op);

      it('every declared tag landed on something', () => {
        const l = LAYOUTS.get(op.layout);
        for (const tag of l?.tags ?? []) {
          const spawned = op.triggers.some((t) => t.then.some(
            (e) => e.do === 'spawnUnits' && e.tag === tag,
          ));
          // A tag a `spawnUnits` PRODUCES is not the layout's to place. It is
          // still declared, so a reader looking for "where does this come from"
          // finds the answer in the file that owns the ground.
          if (spawned) continue;
          expect(
            built.tags.get(tag)?.length ?? 0,
            `layout '${op.layout}' declares tag '${tag}' and stamped it on nothing — `
            + 'a wrong def key or an impossible placement, and entityDead reads TRUE '
            + 'for it on tick one',
          ).toBeGreaterThan(0);
        }
      });

      it('every tag a trigger names was stamped or is spawned', () => {
        const named = new Set<string>();
        for (const t of op.triggers) {
          tagsUsedByCondition(t.when, named);
          for (const e of t.then) if (e.do === 'orderTagged') named.add(e.tag);
        }
        for (const tag of named) {
          const spawned = op.triggers.some((t) => t.then.some(
            (e) => e.do === 'spawnUnits' && e.tag === tag,
          ));
          if (spawned) continue;
          expect(built.tags.has(tag), `trigger names tag '${tag}', nothing stamps it`).toBe(true);
        }
      });

      it('every seated army opens with at least one asset', () => {
        const st = built.world.store;
        const owned = new Map<number, number>();
        for (let a = 0; a < st.aliveCount; a++) {
          const i = st.alive[a];
          const k = st.kind[i];
          if (k !== EntityKind.Building && k !== EntityKind.Infantry && k !== EntityKind.Vehicle) continue;
          owned.set(st.owner[i], (owned.get(st.owner[i]) ?? 0) + 1);
        }
        for (let seat = 0; seat < op.map.armies; seat++) {
          expect(owned.get(seat) ?? 0, `seat ${seat} of ${op.id} opens with nothing`).toBeGreaterThan(0);
        }
      });

      it('stays well inside the entity budget with room for production', () => {
        // 4096 is the hard cap and a real base was measured at 104 units. A
        // layout that opened near the cap would fail its first reinforcement
        // wave silently, because `spawnUnit` returns NONE on an exhausted
        // budget and both existing sim callers ignore that.
        expect(built.world.store.aliveCount).toBeLessThan(1200);
      });

      it('the tagged entities are where a trigger could count them', () => {
        // Not off the map, not stacked on one point, and — for anything a
        // `role: 'building'` condition counts — actually a building.
        const st = built.world.store;
        for (const [tag, ids] of built.tags) {
          for (const id of ids) {
            const i = st.index(id);
            expect(i, `${tag} handle does not resolve`).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(st.posX[i]) && Number.isFinite(st.posZ[i]), tag).toBe(true);
          }
        }
      });

      /*
       * A TAG AN `entity*` CONDITION READS ON AN AI SEAT MUST BE A BUILDING,
       * BECAUSE A HULL ON AN AI SEAT BELONGS TO THE AI AND WILL BE MARCHED OFF.
       *
       * `AiBrain.census` walks `store.owner === me` and files every
       * non-harvester, non-naval Infantry/Vehicle into `armyIds`;
       * `regroupSquads` then files everything in `armyIds` into the strike group
       * or the reserve and orders it to the rally point. Nothing on that path
       * knows the campaign exists, and a layout has no way to opt out — the
       * three tags that exist for exactly this purpose (`GROUP_SCOUT`,
       * `GROUP_WITHDRAW`, `GROUP_RAID`, each with a header in `src/sim/AI.ts`
       * saying why) are AI-internal state set by the brain itself.
       *
       * MEASURED, NOT REASONED. `soviets.02.common-standard` parked two Wardens
       * on the Works vehicle park and hung its secondary on
       * `all: [entityDead 'guard', unitsInArea DEPOT]`. A headless boot on
       * 2026-08-19 read their positions off the store through the armed session's
       * own `TagRegistry`: an `OrderKind.Move` to the AI rally was already
       * standing at the first sample, and by t+20 s they were 116.6 m and 129.2 m
       * from the park they were placed to guard. They died at t+240 s, 127 m
       * away, having never been on it — so `entityDead` resolved, `unitsInArea`
       * counted hulls in an empty lot, and the secondary silently became "drive
       * two hulls to an empty park".
       *
       * THE OWNER CLAUSE IS WHAT KEEPS THIS RULE TRUE RATHER THAN TIDY. A
       * PLAYER-owned tagged unit is fine — nothing re-tasks it — which is why
       * `allies.01.sounding-line`'s `party` is exempt and must stay exempt. And
       * it is scoped to the `entity*` conditions because those are the ones that
       * treat the tag as a fixed feature of the ground; a tag a trigger only ever
       * `orderTagged`s is a tag whose whole purpose is to move (that is
       * `reclamation.01.held-paper`'s `watch`, which is walked off its post
       * deliberately).
       */
      it('a tag an entity condition reads on an AI seat is a building, not a hull', () => {
        const st = built.world.store;
        const read = new Set<string>();
        for (const t of op.triggers) {
          const walk = (c: Condition): void => {
            if (c.on === 'entityDead' || c.on === 'entityAlive' || c.on === 'entityHpBelow') {
              read.add(c.tag);
            } else if (c.on === 'all' || c.on === 'any') {
              for (const sub of c.of) walk(sub);
            } else if (c.on === 'not') {
              walk(c.of);
            }
          };
          walk(t.when);
        }
        for (const tag of read) {
          for (const id of built.tags.get(tag) ?? []) {
            const i = st.index(id);
            if (i < 0) continue;
            // Seat 0 is the player and Neutral is Gaia; neither has a brain.
            // `st.faction` rather than a `world.player()` lookup because
            // `store.owner` is a raw index and `PlayerId` is branded — the cast
            // would be the only `as` in this file, to answer a question the
            // store already holds a column for.
            if (st.owner[i] === 0 || st.faction[i] === Faction.Neutral) continue;
            expect(
              st.kind[i],
              `${op.id}: '${tag}' is read by an entity condition and is carried by a MOBILE hull `
              + `(kind ${String(st.kind[i])}) on AI seat ${String(st.owner[i])}. `
              + '`AiBrain.regroupSquads` files it into a squad on the first brain pass and drives '
              + 'it to the rally point, so the trigger stops describing the ground the layout '
              + 'dressed. Make it an emplacement, or give the AI a way to be told to leave it '
              + 'alone — there is no third option a layout can reach.',
            ).toBe(EntityKind.Building);
          }
        }
      });
    });
  }
});

/* ==========================================================================
 * 3. THE FOE
 *
 * `OperationDef.foe` is the army every non-player seat is fought against.
 * Before it existed, `Shell.startOperation` authored the PLAYER's army from
 * `op.faction` and took the ENEMY's from `this.setup.aiFaction` — the skirmish
 * lobby — so `soviets.02.common-standard`, whose dialogue names the enemy
 * "Allied" four times, was fought against the Reclamation whenever that was the
 * last row the player touched on the skirmish screen.
 *
 * Two halves, and they fail for different reasons:
 *
 *   - the SHELL has to put the declared army on the seat, which is source-gated
 *     because `Shell.ts` builds DOM and cannot be imported under
 *     `environment: 'node'` — the same shape and the same reason as
 *     `tests/save-army-count.spec.ts`;
 *   - the OPERATION has to author hulls that army actually fields, which is
 *     measured on a real built world through the real catalog.
 * ========================================================================== */

describe('the shell seats the operation’s foe, not the lobby’s opponent', () => {
  const src = readFileSync(join(ROOT, 'src/shell/Shell.ts'), 'utf8');

  /** Lift one method's text out by brace matching. Same as `save-army-count`. */
  const methodBody = (signature: string): string => {
    const at = src.indexOf(signature);
    expect(at, `Shell.ts no longer has ${signature}`).toBeGreaterThan(0);
    let parens = 0;
    let i = src.indexOf('(', at);
    for (; i < src.length; i++) {
      if (src[i] === '(') parens++;
      else if (src[i] === ')' && --parens === 0) break;
    }
    let depth = 0;
    for (i = src.indexOf('{', i); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
    }
    throw new Error(`${signature} never closes`);
  };

  const body = methodBody('async startOperation(');

  it('every opponent seat it creates takes its faction from `op.foe`', () => {
    expect(
      body,
      'the `opponents` factory is what `armyCount` and `applySetupToWorld` read',
    ).toMatch(/opponents:[\s\S]*keyOf\(op\.foe/);
  });

  it('AND `aiFaction` moves with it, or `effectiveOpponents` puts the lobby back', () => {
    /*
     * THE HALF THAT LOOKS REDUNDANT AND IS NOT, AND IT WOULD HAVE SHIPPED.
     *
     * `MatchSetup.aiFaction` is documented as a MIRROR of `opponents[0]`, and
     * `effectiveOpponents` — which `applySetupToWorld` seats through — rebuilds
     * entry 0 from the singular fields on every read, because "when they
     * disagree the SINGULAR fields win". So setting only the array changes
     * nothing at all on a two-army operation, which is all five of them: seat 1
     * would go on taking the lobby's army with the array saying otherwise, and
     * a test that read `setup.opponents` would agree the fix had worked.
     */
    expect(body).toMatch(/aiFaction:\s*keyOf\(op\.foe/);
  });

  it('and the lobby’s opponent survives only as the unreachable fallback', () => {
    // `validateCampaign` refuses a Neutral or out-of-range `foe` and all four
    // playable armies are in `playableFactions()`, so `keyOf` cannot miss. The
    // `??` is kept for symmetry with `playerFaction`, which is why this asserts
    // the SHAPE rather than the absence of the string.
    expect(body).not.toMatch(/faction:\s*this\.setup\.aiFaction/);
    expect(body).not.toMatch(/aiFaction:\s*this\.setup\.aiFaction\s*,/);
  });
});

describe('the built world fields the operation’s foe, and only hulls that army has', () => {
  const bindingPromise = resolveDefBinding();

  for (const op of ALL) {
    describe(op.id, () => {
      const built = buildOperation(op);

      it('every non-player seat carries the declared foe', () => {
        const players = built.world.players.filter((p) => p.faction !== Faction.Neutral);
        expect(players.length, 'the seated armies').toBe(op.map.armies);
        expect(players[0].faction, 'seat 0 is the player').toBe(FACTION_OF[op.chapter]);
        for (let seat = 1; seat < op.map.armies; seat++) {
          expect(players[seat].faction, `seat ${seat} of ${op.id}`).toBe(op.foe);
        }
      });

      it('a scripted spawn lands the authored hull, and it belongs to that seat’s army', async () => {
        /*
         * THE PROOF `validateCampaign`'s STATIC RULE CANNOT GIVE.
         *
         * The validator reads `FALLBACK_UNITS`. `EffectSink.spawnUnits` reads
         * `ProductionCatalog.byKey`, then `ProductionService.spawnUnit` reads
         * `FALLBACK_UNITS` again and calls `store.alloc(kind, entry.defId,
         * p.id, p.faction, …)` — the DEF from the key, the COLOUR from the
         * seat. Three tables and one allocation, and this drives all of them.
         */
        const waves = op.triggers.flatMap((t) => t.then.filter((e) => e.do === 'spawnUnits'));
        if (waves.length === 0) return;

        const binding = await bindingPromise;
        const catalog = new ProductionCatalog(binding);
        expect(catalog.bound, 'the catalog must be bound to the real def tables').toBe(true);
        const channels = new Channels();
        const svc = new ProductionService(built.world, channels, catalog);
        svc.bindingTables = binding.tables;
        const tags = new TagRegistry();
        const faults: string[] = [];
        const sink = makeEffectSink(built.world, channels, tags, [], {
          onObjective: () => {},
          onEnd: () => {},
          onSpawnFault: (key, asked, placed, why) => faults.push(`${key} ${placed}/${asked}: ${why}`),
        });

        setProduction(svc);
        try {
          for (const w of waves) {
            if (w.do !== 'spawnUnits') continue;
            const army = w.player === 0 ? op.faction : op.foe;
            const entry = catalog.byKey(w.key);
            expect(entry, `'${w.key}' has no catalog entry — byKey returns null and the wave is empty`)
              .not.toBeNull();
            if (entry === null) continue;
            // The catalog is a SECOND table from the one the validator reads
            // and it carries its own `faction`. A row where the two disagree
            // would pass validation and still put the wrong army's hull down.
            expect(
              entry.faction === Faction.Neutral || entry.faction === army,
              `${op.id} spawns '${w.key}' (catalog faction ${String(entry.faction)}) `
              + `on seat ${String(w.player)}, which fields faction ${String(army)}`,
            ).toBe(true);

            const probe = `probe.${w.key}.${String(w.player)}`;
            const report = sink.spawnUnits(
              w.player, w.key, w.count, w.at, w.spread ?? 0, w.facingDeg ?? 0, probe,
            );
            expect(report.placed, `'${w.key}' placed nothing: ${faults.join('; ')}`)
              .toBeGreaterThan(0);

            const st = built.world.store;
            for (const id of tags.live(st, probe)) {
              const i = st.index(id);
              // THE AUTHORED HULL, UNREMAPPED. `keyFor` is deliberately not on
              // this path — see `runtime.ts#spawnUnits` — so a `rhino` stays a
              // Anvil whoever owns it. If this ever starts remapping, the
              // authored key stops meaning the authored hull and this fails.
              expect(st.defId[i], `'${w.key}' did not land as itself`).toBe(entry.defId);
              // …and it flies the seat's colours, which is the other half of
              // why the two have to agree in the first place.
              expect(st.faction[i], `'${w.key}' on seat ${String(w.player)}`).toBe(army);
            }
          }
        } finally {
          setProduction(null);
        }
      });
    });
  }
});
