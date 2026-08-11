/**
 * ============================================================================
 * src/net/applyCommand.ts — put a flat command back onto the live bus
 * ============================================================================
 * ONE FUNCTION, TWO CALLERS, AND THAT IS THE POINT.
 *
 *   `ReplayPlayer.issue`  re-issues a command recorded to a file.
 *   `net.system.ts`       re-issues a command received from a peer.
 *
 * Those are the same operation. They were about to become two copies of one
 * `switch` over `CommandKind`, and the failure mode of two copies is already
 * documented in this repo: a new command kind gets added to one and not the
 * other, and the symptom is a replay that plays a slightly different match, or
 * a multiplayer game that desyncs only when somebody uses the new verb.
 *
 * `tests/replay.spec.ts` already asserts "every command kind the game can issue
 * is replayable" by walking `CommandKind` and demanding a branch for each. That
 * test now guards BOTH paths, because there is only one path.
 *
 * THE DEFAULT CASE RETURNS FALSE RATHER THAN THROWING OR IGNORING. An unknown
 * kind means the enum grew without the format version or the protocol version
 * being bumped, and both callers need to say so loudly in their own words — the
 * replay blames the file, the network blames the peer. Silently dropping it
 * would be the worst of the three: in a replay it plays a different match, and
 * in a lockstep match it desyncs one client against another with no cause
 * anybody can find.
 * ============================================================================
 */

import { CommandKind } from '../core/types';
import type { Command, EntityId, PlayerId } from '../core/types';
import type { CommandBus } from '../core/events';
import { WIRE_LIMITS, type WireCommand } from './protocol';

/**
 * Copy a pooled `Command` out of the bus into a flat, JSON-safe object.
 *
 * THE COPY IS NOT OPTIONAL, and the reason is trap 3 in `src/game/Replay.ts`:
 * `cmd.entities` is a subarray VIEW into the bus's shared arena and is invalid
 * the moment the harvest returns. A scheduler that retained the view would send
 * whatever the next tick happened to write there.
 *
 * `player` is copied as the client believes it, and the relay overwrites it
 * from the socket. A client cannot usefully lie here, but it is not trusted to
 * be honest either.
 */
export function toWire(cmd: Command): WireCommand {
  const entities: number[] = new Array<number>(cmd.entityCount);
  for (let i = 0; i < cmd.entityCount; i++) entities[i] = cmd.entities[i];
  return {
    kind: cmd.kind as number,
    player: cmd.player as number,
    order: cmd.order as number,
    target: cmd.target as number,
    x: cmd.x,
    z: cmd.z,
    defId: cmd.defId,
    tab: cmd.tab as number,
    cx: cmd.cx,
    cz: cmd.cz,
    stance: cmd.stance as number,
    queued: cmd.queued,
    arg: cmd.arg,
    entities,
  };
}

/**
 * Scratch for entity lists, so the common path allocates nothing.
 *
 * Safe to share because every `issue*` overload copies the ids into the bus's
 * own arena before returning — the buffer is dead the moment the call is made.
 * Sized to the wire limit; anything longer (only reachable from a replay file
 * recorded before that limit existed) allocates rather than truncating, because
 * a truncated order is a DIFFERENT order and would replay a different match.
 */
const SCRATCH = new Int32Array(WIRE_LIMITS.maxEntitiesPerCommand);

function idsOf(entities: readonly number[]): Int32Array {
  const n = entities.length;
  const buf = n <= SCRATCH.length ? SCRATCH : new Int32Array(n);
  for (let i = 0; i < n; i++) buf[i] = entities[i]!;
  return buf;
}

/**
 * Re-issue one flat command onto `bus`.
 *
 * Returns false only for a `kind` this build has no branch for. Every other
 * outcome — including a command the simulation will refuse on ownership or
 * affordability grounds — is a successful ISSUE, and that distinction matters:
 * a refused command must still reach the bus, because `CommandBus.drain`
 * records it and a replay that omitted refusals would diverge the moment a
 * refusal depended on state reconstructed a tick differently.
 */
export function applyCommand(bus: CommandBus, c: WireCommand): boolean {
  const player = c.player as PlayerId;
  switch (c.kind) {
    case CommandKind.Order: {
      const ids = idsOf(c.entities);
      bus.issueOrder(player, c.order, ids, c.entities.length, c.x, c.z, c.target as EntityId, c.queued);
      return true;
    }
    case CommandKind.ProductionStart:
      bus.issueProductionStart(player, c.tab, c.defId, c.arg);
      return true;
    case CommandKind.ProductionPause:
      bus.issueProductionPause(player, c.tab, c.arg !== 0);
      return true;
    case CommandKind.ProductionCancel:
      bus.issueProductionCancel(player, c.tab, c.defId, c.arg);
      return true;
    case CommandKind.PlaceBuilding:
      bus.issuePlaceBuilding(player, c.defId, c.cx, c.cz, c.arg);
      return true;
    case CommandKind.SetRally:
      bus.issueSetRally(player, c.target as EntityId, c.x, c.z);
      return true;
    case CommandKind.SellBuilding:
      bus.issueSell(player, c.target as EntityId);
      return true;
    case CommandKind.RepairToggle:
      bus.issueRepairToggle(player, c.target as EntityId);
      return true;
    case CommandKind.SetStance: {
      const ids = idsOf(c.entities);
      bus.issueSetStance(player, ids, c.entities.length, c.stance);
      return true;
    }
    case CommandKind.SetPrimary:
      bus.issueSetPrimary(player, c.target as EntityId);
      return true;
    case CommandKind.SelfDestruct:
      bus.issueSelfDestruct(player, c.target as EntityId);
      return true;
    case CommandKind.Relocate:
      bus.issueRelocate(player, c.target as EntityId, c.cx, c.cz, c.arg);
      return true;
    case CommandKind.UsePower:
      // `arg` is the CommanderPowerId. Re-issued unvalidated on purpose: the
      // simulation refuses an id it does not know, and a command a peer sent
      // must reach the bus even when it will be refused — see the header.
      bus.issueUsePower(player, c.arg, c.x, c.z);
      return true;
    default:
      return false;
  }
}
