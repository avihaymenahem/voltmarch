/**
 * ============================================================================
 * tests/capture-selection.spec.ts — ONE ENGINEER DOES NOT MAKE AN ARMY
 * ============================================================================
 * `resolveContextOrder` reads the SELECTION, not the unit. `caps.canCapture` is
 * an OR over every selected entity (`Commands.ts:462`) and both capture
 * branches read it for the whole group, so ONE engineer anywhere in a selection
 * turned every right-click on a building into `OrderKind.Capture` for every
 * unit in it.
 *
 * That is not exotic. `buildAlliedBase` spawns an engineer at t=0, so an Allied
 * player pressing Ctrl+A and right-clicking the enemy base is the ordinary way
 * to reach it.
 *
 * ── WHAT THE ORDER DID, PER KIND ────────────────────────────────────────────
 * `src/sim/Capture.ts` is the only consumer of `OrderKind.Capture` in
 * `src/sim/**`, and its `simTick` walks `byKind[Infantry]` alone:
 *
 *   - non-engineer INFANTRY hit `if (!this.isEngineerSlot(i)) clearOrder(i)`,
 *     so the squad stops dead one tick after the click;
 *   - VEHICLES are never visited, and `Steering.finishOrder`'s own comment says
 *     `orderKind` "belongs to Command and is deliberately left alone" — so the
 *     tank drives to the building's footprint carrying a `Capture` it can never
 *     discharge, arrives, goes Idle, and only then acquires. It closes to point
 *     blank instead of engaging at range, and the stale order stays in the
 *     column for the rest of the match.
 *
 * Neither is "attack the building I clicked".
 *
 * ── WHY THE FIX IS IN `write()` AND NOT IN THE CURSOR ───────────────────────
 * One command crosses the wire for the whole selection — that is the design,
 * and changing it would touch `src/net/protocol.ts` and the replay format. The
 * executor is the last point at which the selection is still individuals, and
 * `Commands.ts` already resolves TWO other instances of this exact defect
 * there: the Harvest case ("a tank told to go to the ore should go to the ore")
 * and the unarmed-Attack case, whose block opens by naming the cause —
 * "`resolveContextOrder` reads the SELECTION, not the unit". This is the third.
 *
 * ── THIS FILE DRIVES THE REAL EXECUTOR ──────────────────────────────────────
 * `tests/attack-building.spec.ts` MIRRORS `write()` in a local helper, which
 * cannot see a change to `write()` at all. Every order here goes through
 * `channels.commands.issueOrder` and `OrderExecutor.tick()`, which is the path
 * a right-click actually takes.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import {
  EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { OrderExecutor, setRoleResolver } from '../src/input/Commands';
import type { RoleResolver } from '../src/input/Commands';

/* -------------------------------------------------------------------------- */

interface Rig {
  readonly world: World;
  readonly channels: Channels;
  readonly exec: OrderExecutor;
  readonly me: PlayerId;
  readonly foe: PlayerId;
  readonly gaia: PlayerId;
}

function rig(): Rig {
  const world = new World();
  const me = world.addPlayer(Faction.Allies, 'Commander', true, true);
  const foe = world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const gaia = world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  // Gaia is allied to everyone in both directions, exactly as
  // `ScenarioBuilder.gaia` wires it — that is what makes a civilian structure
  // "not hostile" to the test below rather than merely "not mine".
  for (const p of [me, foe]) {
    world.player(p).allyMask |= 1 << (gaia as number);
    world.player(gaia).allyMask |= 1 << (p as number);
  }
  const channels = new Channels();
  return { world, channels, exec: new OrderExecutor(world, channels), me, foe, gaia };
}

function spawn(
  r: Rig, kind: EntityKind, player: PlayerId, flags: number, x: number, z: number,
): EntityId {
  const s = r.world.store;
  const id = s.alloc(kind, 0, player, r.world.player(player).faction, x, 0, z);
  const i = s.index(id);
  s.flags[i] |= flags;
  s.locomotor[i] = kind === EntityKind.Building ? Locomotor.Foot : Locomotor.Wheel;
  s.hp[i] = 100;
  s.maxHp[i] = 100;
  return id;
}

const MOBILE_ARMED = EntityFlag.Alive | EntityFlag.CanMove | EntityFlag.CanAttack;
const MOBILE_UNARMED = EntityFlag.Alive | EntityFlag.CanMove;
const HARVESTER = MOBILE_UNARMED | EntityFlag.IsHarvester;

/**
 * A resolver that answers `canCapture` from an explicit set.
 *
 * REQUIRED, NOT A CONVENIENCE. The default `HEURISTIC_ROLES` has no def tables
 * here, so without this every unit would answer the same way and the whole file
 * would be measuring one case twice.
 */
function withEngineers(world: World, ids: readonly EntityId[]): () => void {
  const slots = new Set(ids.map((id) => world.store.index(id)));
  const r: RoleResolver = {
    canCapture: (_w, i) => slots.has(i),
    canRepair: (_w, i) => slots.has(i),
    isHarvester: (w, i) => (w.store.flags[i] & EntityFlag.IsHarvester) !== 0,
  };
  setRoleResolver(r);
  return () => setRoleResolver(null);
}

/** Right-click `target` with `ids` selected, and run the executor. */
function rightClick(r: Rig, ids: readonly EntityId[], order: OrderKind, target: EntityId): void {
  const s = r.world.store;
  const t = s.index(target);
  r.channels.commands.issueOrder(
    r.me, order, ids as unknown as number[], ids.length, s.posX[t], s.posZ[t], target,
  );
  r.exec.tick();
}

const orderOf = (r: Rig, id: EntityId): OrderKind => r.world.store.orderKind[r.world.store.index(id)] as OrderKind;
const stateOf = (r: Rig, id: EntityId): UnitState => r.world.store.state[r.world.store.index(id)] as UnitState;
const targetOf = (r: Rig, id: EntityId): number => r.world.store.orderTarget[r.world.store.index(id)];

/* ========================================================================== */

describe('a Capture order aimed at a mixed selection resolves per unit', () => {
  it('the rig can tell an engineer from a tank at all', () => {
    // THE VACUITY GUARD. Every assertion below turns on `roles.canCapture`
    // answering differently for two entities; a resolver that answered the same
    // for both would make half this file pass for the wrong reason.
    const r = rig();
    const eng = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 0, 0);
    const tank = spawn(r, EntityKind.Vehicle, r.me, MOBILE_ARMED, 4, 0);
    const restore = withEngineers(r.world, [eng]);
    try {
      const bld = spawn(r, EntityKind.Building, r.foe, EntityFlag.Alive, 40, 0);
      rightClick(r, [eng, tank], OrderKind.Capture, bld);
      expect(orderOf(r, eng), 'the engineer keeps the capture').toBe(OrderKind.Capture);
      expect(orderOf(r, tank), 'the tank does not').not.toBe(OrderKind.Capture);
    } finally { restore(); }
  });

  it('the engineer captures and the escort ATTACKS the same enemy building', () => {
    const r = rig();
    const eng = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 0, 0);
    const tank = spawn(r, EntityKind.Vehicle, r.me, MOBILE_ARMED, 4, 0);
    const rifle = spawn(r, EntityKind.Infantry, r.me, MOBILE_ARMED, 8, 0);
    const restore = withEngineers(r.world, [eng]);
    try {
      const bld = spawn(r, EntityKind.Building, r.foe, EntityFlag.Alive, 40, 0);
      rightClick(r, [eng, tank, rifle], OrderKind.Capture, bld);

      expect(orderOf(r, eng)).toBe(OrderKind.Capture);
      expect(stateOf(r, eng), 'and walks in').toBe(UnitState.Moving);

      for (const [name, id] of [['tank', tank], ['rifleman', rifle]] as const) {
        expect(orderOf(r, id), `${name} attacks`).toBe(OrderKind.Attack);
        expect(stateOf(r, id), `${name} is Attacking`).toBe(UnitState.Attacking);
        expect(targetOf(r, id), `${name} keeps the building as its target`).toBe(bld as number);
      }
    } finally { restore(); }
  });

  it('a NEUTRAL building demotes to Move, so nobody opens fire on a civilian block', () => {
    /*
     * THE BRANCH THAT MAKES THE FIX SAFE. `areAllied` answers TRUE for Gaia in
     * both directions on purpose, so the hostility test catches a civilian
     * structure and an ally's building alike. Without this a select-all group
     * walking past a hamlet would start shelling it.
     */
    const r = rig();
    const eng = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 0, 0);
    const tank = spawn(r, EntityKind.Vehicle, r.me, MOBILE_ARMED, 4, 0);
    const restore = withEngineers(r.world, [eng]);
    try {
      const civ = spawn(r, EntityKind.Building, r.gaia, EntityFlag.Alive, 40, 0);
      rightClick(r, [eng, tank], OrderKind.Capture, civ);

      expect(orderOf(r, eng), 'the engineer still takes it').toBe(OrderKind.Capture);
      expect(orderOf(r, tank), 'the tank moves, it does not attack').toBe(OrderKind.Move);
      expect(stateOf(r, tank)).toBe(UnitState.Moving);
      expect(targetOf(r, tank), 'and carries no target it could re-acquire from').toBe(NONE);
    } finally { restore(); }
  });

  it('a Repair order never demotes to Attack, whoever it lands on', () => {
    // `RoleResolver.canRepair` IS `canCapture`, so Repair rides the identical
    // OR-over-the-selection. It is aimed at a FRIENDLY structure by
    // construction, so the hostility test is false for it by name rather than
    // by accident — asserted, because "it happens not to arise" is how a branch
    // like this quietly starts arising.
    const r = rig();
    const eng = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 0, 0);
    const tank = spawn(r, EntityKind.Vehicle, r.me, MOBILE_ARMED, 4, 0);
    const restore = withEngineers(r.world, [eng]);
    try {
      const mine = spawn(r, EntityKind.Building, r.me, EntityFlag.Alive, 40, 0);
      r.world.store.hp[r.world.store.index(mine)] = 40;
      rightClick(r, [eng, tank], OrderKind.Repair, mine);

      expect(orderOf(r, eng)).toBe(OrderKind.Repair);
      expect(orderOf(r, tank), 'never Attack on your own building').toBe(OrderKind.Move);
    } finally { restore(); }
  });

  it('a harvester in the group is a true no-op, not a Move into the enemy base', () => {
    /*
     * THE ORDER OF THE TWO BLOCKS IN `write()` IS WHAT BUYS THIS. The capture
     * demotion runs FIRST and produces an Attack; the unarmed-Attack rule
     * immediately below then refuses it for a harvester, exactly as it does for
     * a right-click on an enemy unit. If the demotion ran second — or wrote the
     * column itself — this would be a Move, and a miner driving into the enemy
     * base is the `§ANCHOR` report `sim/Harvesting.ts` already carries.
     */
    const r = rig();
    const eng = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 0, 0);
    const miner = spawn(r, EntityKind.Vehicle, r.me, HARVESTER, 4, 0);
    const restore = withEngineers(r.world, [eng]);
    try {
      const bld = spawn(r, EntityKind.Building, r.foe, EntityFlag.Alive, 40, 0);
      const before = orderOf(r, miner);
      rightClick(r, [eng, miner], OrderKind.Capture, bld);
      expect(orderOf(r, miner), 'the miner keeps whatever it had').toBe(before);
      expect(orderOf(r, eng), 'and the engineer is unaffected by it').toBe(OrderKind.Capture);
    } finally { restore(); }
  });

  it('an unarmed non-engineer moves rather than freezing', () => {
    // An empty transport, or a swimmer with no gun. It should still go where it
    // was pointed; it simply must not sit in a combat state it can never leave.
    const r = rig();
    const eng = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 0, 0);
    const truck = spawn(r, EntityKind.Vehicle, r.me, MOBILE_UNARMED, 4, 0);
    const restore = withEngineers(r.world, [eng]);
    try {
      const bld = spawn(r, EntityKind.Building, r.foe, EntityFlag.Alive, 40, 0);
      rightClick(r, [eng, truck], OrderKind.Capture, bld);
      expect(orderOf(r, truck)).toBe(OrderKind.Move);
      expect(stateOf(r, truck)).toBe(UnitState.Moving);
    } finally { restore(); }
  });

  it('an engineer-only selection is bit-identical to what it always did', () => {
    // THE NO-REGRESSION CLAIM. The whole point is that the capture path itself is
    // untouched — a player who selects their engineer alone and clicks a
    // building gets exactly the order they got before this existed.
    const r = rig();
    const a = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 0, 0);
    const b = spawn(r, EntityKind.Infantry, r.me, MOBILE_UNARMED, 4, 0);
    const restore = withEngineers(r.world, [a, b]);
    try {
      const bld = spawn(r, EntityKind.Building, r.foe, EntityFlag.Alive, 40, 0);
      rightClick(r, [a, b], OrderKind.Capture, bld);
      for (const id of [a, b]) {
        expect(orderOf(r, id)).toBe(OrderKind.Capture);
        expect(stateOf(r, id)).toBe(UnitState.Moving);
        expect(targetOf(r, id)).toBe(bld as number);
      }
    } finally { restore(); }
  });
});
