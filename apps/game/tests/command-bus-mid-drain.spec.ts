/**
 * ============================================================================
 * tests/command-bus-mid-drain.spec.ts — a command issued during a drain
 * ============================================================================
 * THE DEFECT WAS THE SILENCE, NOT THE DROP.
 *
 * `CommandBus` declared an `overflowBuffer`, cleared it in two places, never
 * wrote to it, and carried a comment promising to "re-issue anything that
 * arrived during the drain". `claim()` was not guarded by `draining`, so a
 * command issued from inside a drain handler landed in the ring past the `n`
 * the drain loop had already captured, was never delivered, and was then erased
 * by the `count = 0` reset in the `finally` — WITHOUT incrementing
 * `droppedCommands`, the one counter that surfaces on the F3 overlay and the
 * one number that would have made it visible.
 *
 * A command lost on one client and not another is a lockstep desync with no
 * findable cause; a command lost during recording and not during playback is a
 * replay divergence. Either way the first requirement is that it be COUNTABLE.
 *
 * SO EVERY CASE HERE IS "DELIVERED OR COUNTED", NEVER "DROPPED".
 * The invariant a lockstep peer needs is not "no command is ever refused" — the
 * ring has a fixed capacity and always could refuse — it is that
 * `issued === delivered + droppedCommands`, exactly, with no third bucket.
 *
 * AGAINST THE OLD CODE the first three cases go red on the counter, not on the
 * delivery: `droppedCommands` reads 0 while a command has vanished.
 *
 * THE LAST TWO CASES ARE THE FALSIFIERS and they pass on BOTH sides. They pin
 * the two shapes that must NOT change: the park-and-re-issue pattern all four
 * consumers use (re-issue AFTER `drain()` returns), and the campaign shape —
 * `campaign.system.ts` is Phase.Cleanup order 9000 and issues onto the bus
 * outside any drain, deliberately, so its order lands on tick N+1. A fix that
 * made mid-drain commands apply in the same tick would make every scripted
 * campaign order apply twice under playback (trap 2 in `src/game/Replay.ts`).
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';

import { CommandBus } from '../src/core/events';
import { BuildTab, CommandKind, OrderKind } from '../src/core/types';
import type { Command, EntityId, PlayerId } from '../src/core/types';

const P0 = 0 as PlayerId;

/** Silence the one-shot warning the guard prints; the counter is the assertion. */
function quiet(): { restore: () => void } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { restore: () => { spy.mockRestore(); } };
}

describe('CommandBus: a command issued during a drain', () => {
  it('is never lost silently — it is either delivered or counted', () => {
    const q = quiet();
    const bus = new CommandBus();

    // One command issued the ordinary way, outside any drain.
    bus.issueProductionStart(P0, BuildTab.Structures, 7);
    expect(bus.pending).toBe(1);

    let issued = 1;
    let delivered = 0;
    bus.drain(() => {
      delivered++;
      // A handler that itself issues. This is the whole case.
      if (issued === 1) {
        issued++;
        bus.issueProductionStart(P0, BuildTab.Vehicles, 9);
      }
    });

    // THE ASSERTION THAT GOES RED ON THE OLD CODE. The mid-drain command is
    // legitimately not delivered (see below for why it must not be), but it
    // must appear in the ledger. The old code left this at 0.
    expect(bus.droppedCommands).toBe(1);
    expect(bus.droppedMidDrain).toBe(1);

    // No third bucket: everything issued is accounted for.
    expect(delivered + bus.droppedCommands).toBe(issued);
    q.restore();
  });

  it('does not resurface on a later drain in the same tick', () => {
    const q = quiet();
    const bus = new CommandBus();
    bus.issueOrder(P0, OrderKind.Move, [1, 2], 2, 10, 20);

    const first: number[] = [];
    bus.drain((cmd: Command) => {
      first.push(cmd.kind as number);
      bus.issuePlaceBuilding(P0, 3, 4, 5);
    });
    expect(first).toEqual([CommandKind.Order as number]);

    // The bus is empty the instant the drain returns, and stays empty. This is
    // what stops a refused command from applying at Phase.Production -100 or 0
    // — past the lockstep harvest at Phase.Command 0 and the playback harvest
    // at order 1, both of which have already run by then.
    expect(bus.pending).toBe(0);

    const second: number[] = [];
    bus.drain((cmd: Command) => { second.push(cmd.kind as number); });
    expect(second).toEqual([]);

    expect(bus.droppedCommands).toBe(1);
    expect(bus.droppedMidDrain).toBe(1);
    q.restore();
  });

  it('is refused and counted inside a harvest too, not only a drain', () => {
    const q = quiet();
    const bus = new CommandBus();
    // The recording tap must not fire on a harvest; it must not fire on a
    // refusal either, since nothing was delivered.
    let observed = 0;
    bus.observe(() => { observed++; });

    bus.issueSell(P0, 12 as EntityId);

    let harvested = 0;
    bus.harvest(() => {
      harvested++;
      bus.issueSell(P0, 13 as EntityId);
    });

    expect(harvested).toBe(1);
    expect(observed).toBe(0);
    expect(bus.pending).toBe(0);
    expect(bus.droppedCommands).toBe(1);
    expect(bus.droppedMidDrain).toBe(1);
    q.restore();
  });

  /* -- falsifiers: these pass before AND after, and pin what must not move -- */

  it('still lets a consumer PARK and re-issue after the drain returns', () => {
    const bus = new CommandBus();
    bus.issueProductionStart(P0, BuildTab.Infantry, 21);

    // Exactly the shape of `input/Commands.ts#reissueParked` and
    // `sim/features.system.ts#reissue`: capture inside, re-issue outside.
    let parkedDef = -1;
    bus.drain((cmd: Command) => { parkedDef = cmd.defId; });
    expect(parkedDef).toBe(21);

    bus.markReissue(() => { bus.issueProductionStart(P0, BuildTab.Infantry, parkedDef); });
    expect(bus.pending).toBe(1);

    const seen: Command[] = [];
    bus.drain((cmd: Command) => { seen.push({ ...cmd }); });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.defId).toBe(21);
    expect(seen[0]!.reissued).toBe(true);

    // Nothing was refused: the supported route is not affected by the guard.
    expect(bus.droppedCommands).toBe(0);
    expect(bus.droppedMidDrain).toBe(0);
  });

  it('leaves the campaign order-9000 shape alone: issued after a drain, applied next drain', () => {
    const bus = new CommandBus();

    // Tick N. Phase.Command 9000: the drain. Nothing queued.
    let deliveredN = 0;
    bus.drain(() => { deliveredN++; });
    expect(deliveredN).toBe(0);

    // Tick N, Phase.Cleanup 9000: the Director issues. `draining` is false —
    // this is a system update, not a drain callback — so it queues normally.
    bus.issueOrder(P0, OrderKind.AttackMove, [5], 1, 30, 40);
    expect(bus.pending).toBe(1);
    expect(bus.droppedCommands).toBe(0);
    expect(bus.droppedMidDrain).toBe(0);

    // Tick N+1: it applies, exactly once, which is what makes the recording and
    // the playback agree.
    const kinds: number[] = [];
    bus.drain((cmd: Command) => { kinds.push(cmd.kind as number); });
    expect(kinds).toEqual([CommandKind.Order as number]);

    // And it is gone afterwards, so playback's harvest at Phase.Command order 1
    // has one copy to throw away and one recorded copy to feed, never two.
    expect(bus.pending).toBe(0);
  });
});
