/**
 * The AI mends its base and replaces a lost Construction Yard.
 *
 * THE INVARIANTS, fast and seed-free. The end-to-end proof — a real match, a
 * real bombing, real HP restored — is `tests/ai-rebuild-repair.spec.ts`, which
 * is opt-in behind `VM_AI_REBUILD_PROBE` because it takes a minute and its
 * numbers are facts about one seed. What lives here is the part that must never
 * regress silently:
 *
 *   1. a damaged structure gets `CommandKind.RepairToggle` and nothing else;
 *   2. the toggle is never re-sent to a structure already repairing, because a
 *      toggle sent twice is a repair switched OFF;
 *   3. `AI_SKILL[].maxRepairs` is honoured, and every rung mends;
 *   4. a brain with no Construction Yard buys a Construction Vehicle instead of
 *      spending the bank on infantry.
 *
 * (2) and (4) are the two that were actually broken in the wild. (2) cost an
 * entire probe run: 954 toggles against zero HP restored, because each command
 * was reaching the service twice. (4) is the reported defect — "their buildings
 * destroyed, they are not rebuilding" — and the brain's own diagnostic string
 * said so out loud: "construction yard lost — throwing gi at them".
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, CommandKind, EntityFlag, EntityKind, Faction,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import { AI_BUILD, AI_CADENCE, AI_REPAIR, AI_SKILL, CELL, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import { BuildCatalog, BuildRole } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';
import { RepairSellService, setRepairSellService } from '../src/sim/RepairSell';

const P_HUMAN = 0 as PlayerId;
const P_AI = 1 as PlayerId;

/** Ids for every catalog key, so `entryForBuilding`/`forRole` resolve. */
function syntheticBinding(): DefLookup {
  const catalog = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 0;
  let b = 0;
  for (const e of catalog.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { tables: null, unitId, buildingId };
}

/**
 * `w` defaults to 2 and the WAR FACTORY MUST PASS 3.
 *
 * `AiBrain.roleOfBuilding` separates the two `IsFactory` structures by width —
 * "every infantry producer in BUILDING_DIMENSIONS is 2 cells wide, every
 * vehicle producer is 3" — so a 2-wide factory is counted as a BARRACKS, the
 * `warFactory` prereq on `mcv` is not met, and the brain correctly declines to
 * buy a construction vehicle it has nowhere to build.
 */
function spawnBuilding(
  world: World, owner: PlayerId, x: number, z: number, flags: number, hpFrac = 1, w = 2,
): EntityId {
  const st = world.store;
  const id = st.alloc(EntityKind.Building, -1, owner, Faction.Soviets, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= flags;
  st.footprintW[i] = w;
  st.footprintH[i] = 2;
  st.powerDraw[i] = -20;
  st.maxHp[i] = 1000;
  st.hp[i] = 1000 * hpFrac;
  st.armorClass[i] = ArmorClass.Concrete;
  st.buildProgress[i] = 1;
  world.terrain.markOccupied(
    Math.floor(x / CELL) - ((w / 2) | 0), Math.floor(z / CELL) - 1, w, 2, id,
  );
  return id;
}

interface Harness {
  world: World;
  channels: Channels;
  brain: AiBrain;
  repair: RepairSellService;
  commands: Command[];
  step(ticks: number): void;
}

/**
 * `applyRepairs` hands each toggle to the service the way
 * `src/sim/features.system.ts` does, so `isRepairing` becomes true and the
 * brain can see its own past decisions.
 *
 * IT IS AN OPTION RATHER THAN A SECOND `observe` CALL. `CommandBus.observe`
 * installs ONE observer and replaces whatever was there, so a test that adds
 * its own tap silently unhooks the recorder below and every assertion about
 * what was issued then reads an empty list. That cost three failures here.
 */
function makeHarness(difficulty = 1, credits = 20_000, applyRepairs = false): Harness {
  const world = new World();
  const channels = new Channels();
  // Installed for every case: `AiBrain.repairBase` returns immediately when
  // `repairSellService()` is null, so a test without one proves nothing.
  const repair = new RepairSellService(world, channels);
  setRepairSellService(repair);
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P_AI);
  ai.aiDifficulty = difficulty;
  ai.aiPersonality = 0;
  ai.credits = credits;
  ai.powerProduced = 400;
  ai.powerConsumed = 20;

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, 12345);
  brain.attach(channels.events);

  const commands: Command[] = [];
  channels.commands.observe((c) => {
    // Copy: `cmd` is a pooled struct, invalid the moment the drain returns.
    commands.push({ ...c, entities: c.entities.slice() } as Command);
    if (applyRepairs && c.kind === CommandKind.RepairToggle) repair.handleCommand(c);
  });

  const rng: IRng = new Rng(7);
  let tick = 0;
  return {
    world,
    channels,
    brain,
    repair,
    commands,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        brain.tick(s);
        // Nothing consumes the bus here on purpose: these tests are about what
        // the brain ASKS for. `drain` is what fires the observer tap.
        channels.commands.drain(() => {});
      }
    },
  };
}

/** The build clock has to come round for `repairBase` to run at all. */
const ENOUGH_TICKS = AI_CADENCE.build * 12;

function repairTargets(h: Harness): number[] {
  return h.commands
    .filter((c) => c.kind === CommandKind.RepairToggle)
    .map((c) => c.target as number);
}

describe('the AI mends its own buildings', () => {
  it('sends a repair toggle for a damaged structure', () => {
    const h = makeHarness();
    try {
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
      const hurt = spawnBuilding(h.world, P_AI, 380, 400, 0, 0.3);

      h.step(ENOUGH_TICKS);

      expect(repairTargets(h)).toContain(hurt as number);
    } finally {
      setRepairSellService(null);
    }
  });

  it('leaves a structure above the threshold alone', () => {
    const h = makeHarness();
    try {
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
      // Just healthier than the trigger — a graze is not worth an action.
      spawnBuilding(h.world, P_AI, 380, 400, 0, AI_REPAIR.startFraction + 0.05);

      h.step(ENOUGH_TICKS);

      expect(repairTargets(h)).toHaveLength(0);
    } finally {
      setRepairSellService(null);
    }
  });

  it('never toggles the same structure twice, because that would switch it off', () => {
    // The toggles are APPLIED here, so the service agrees the structure is
    // already mending and the brain can see its own past decision.
    const h = makeHarness(1, 20_000, true);
    try {
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
      const hurt = spawnBuilding(h.world, P_AI, 380, 400, 0, 0.3);

      h.step(ENOUGH_TICKS * 4);

      expect(h.repair.isRepairing(hurt)).toBe(true);
      const sent = repairTargets(h).filter((t) => t === (hurt as number));
      expect(sent).toHaveLength(1);
    } finally {
      setRepairSellService(null);
    }
  });

  it('honours maxRepairs, and every rung mends something', () => {
    for (let d = 0; d < AI_SKILL.length; d++) {
      const h = makeHarness(d, 20_000, true);
      try {
        spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
        // More damaged structures than any rung is allowed to mend at once.
        const cap = AI_SKILL[d].maxRepairs;
        for (let k = 0; k < cap + 4; k++) {
          spawnBuilding(h.world, P_AI, 340 + k * 12, 440, 0, 0.3);
        }
        h.step(ENOUGH_TICKS * 8);

        const sent = repairTargets(h);
        // Every rung mends: a base that never heals is a broken opponent, not
        // a gentle one.
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.length).toBeLessThanOrEqual(cap);
      } finally {
        setRepairSellService(null);
      }
    }
  });

  it('does not arm a repair it cannot pay for', () => {
    const h = makeHarness(1, AI_REPAIR.minCredits - 1);
    try {
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
      spawnBuilding(h.world, P_AI, 380, 400, 0, 0.3);

      h.step(ENOUGH_TICKS);

      expect(repairTargets(h)).toHaveLength(0);
    } finally {
      setRepairSellService(null);
    }
  });

  it('mends only its own buildings', () => {
    const h = makeHarness();
    try {
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
      const theirs = spawnBuilding(h.world, P_HUMAN, 120, 120, 0, 0.2);

      h.step(ENOUGH_TICKS);

      expect(repairTargets(h)).not.toContain(theirs as number);
    } finally {
      setRepairSellService(null);
    }
  });
});

describe('the AI replaces a Construction Yard it has lost', () => {
  /** The MCV entry this faction would buy. */
  function mcvDefId(): number {
    const catalog = new BuildCatalog();
    catalog.bind(syntheticBinding());
    return catalog.forRole(BuildRole.Mcv, Faction.Soviets)?.defId ?? -1;
  }

  function mcvStarts(h: Harness): Command[] {
    const want = mcvDefId();
    return h.commands
      .filter((c) => c.kind === CommandKind.ProductionStart && c.defId === want);
  }

  it('queues a construction vehicle when the yard is gone but a factory stands', () => {
    const h = makeHarness();
    try {
      // No `IsBuilder` anywhere: the yard is dead. A war factory survives,
      // which is the only thing that can sell the replacement.
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsFactory, 1, 3);

      h.step(ENOUGH_TICKS);

      expect(mcvDefId()).toBeGreaterThanOrEqual(0);
      expect(mcvStarts(h).length).toBeGreaterThan(0);
    } finally {
      setRepairSellService(null);
    }
  });

  it('asks once inside the in-flight window rather than every pass', () => {
    const h = makeHarness();
    try {
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsFactory, 1, 3);

      // STOPPING SHORT OF `AI_BUILD.requestTimeoutTicks` IS THE POINT. Nothing
      // consumes the bus here, so `production:started` never comes back and
      // `inFlight` is never acknowledged — after the timeout `build()`
      // deliberately assumes the request was lost and re-asks, which is a
      // feature and not a leak. Inside the window the ask must happen exactly
      // once, which is what `yardOnOrder` is for.
      h.step(AI_BUILD.requestTimeoutTicks - 1);

      expect(mcvStarts(h)).toHaveLength(1);
    } finally {
      setRepairSellService(null);
    }
  });

  it('does not ask for one while it still has a Construction Yard', () => {
    const h = makeHarness();
    try {
      spawnBuilding(h.world, P_AI, 400, 400, EntityFlag.IsBuilder | EntityFlag.IsFactory);
      spawnBuilding(h.world, P_AI, 424, 400, EntityFlag.IsFactory, 1, 3);

      h.step(ENOUGH_TICKS);

      expect(mcvStarts(h)).toHaveLength(0);
    } finally {
      setRepairSellService(null);
    }
  });
});
