/**
 * ============================================================================
 * tests/net-protocol.spec.ts — the wire contract, and the promises it rests on
 * ============================================================================
 * `src/net/protocol.ts` makes three structural claims that nothing else can
 * check at runtime, and all three are load-bearing:
 *
 *   1. Its limits MIRROR engine constants. A mirrored constant nobody checks is
 *      a constant that drifts — `Bootstrap.ts` says exactly that about the
 *      shot harness's copy of SIM_HZ. If `WIRE_LIMITS.mapCells` and MAP_CELLS
 *      ever disagree, the relay starts refusing legal commands or accepting
 *      illegal ones, and neither failure names itself.
 *
 *   2. Its import closure is TWO FILES. That is what lets `server/` compile
 *      without `three` and without `src/sim/**`, which is how "the server runs
 *      no game code" becomes a compiler guarantee instead of a promise. One
 *      convenience import into `src/core/config.ts` would quietly end it.
 *
 *   3. `applyCommand` handles every `CommandKind`. It is now the only path for
 *      BOTH replay playback and multiplayer, so a kind without a branch is a
 *      replay that plays a different match AND a lockstep game that desyncs the
 *      first time somebody uses the new verb.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAP_CELLS, MAP_SIZE, MAX_PLAYERS, MAX_SELECTION } from '../src/core/config';
import { CommandKind, FACTION_COUNT } from '../src/core/types';
import { Channels } from '../src/core/events';
import {
  PROTOCOL_VERSION, TURN_DELAY, TURN_LOOKAHEAD, TURN_TICKS, WIRE_LIMITS,
  isKnownCommandKind, parseMessage,
} from '../src/net/protocol';
import type { WireCommand } from '../src/net/protocol';
import { applyCommand } from '../src/net/applyCommand';

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/* ========================================================================== */

describe('the wire limits mirror the engine, and are checked for it', () => {
  it('caps an entity list at the selection cap', () => {
    expect(WIRE_LIMITS.maxEntitiesPerCommand).toBe(MAX_SELECTION);
  });

  it('bounds grid coordinates by the real grid', () => {
    expect(WIRE_LIMITS.mapCells).toBe(MAP_CELLS);
  });

  it('bounds world coordinates by the real map', () => {
    expect(WIRE_LIMITS.mapSize).toBe(MAP_SIZE);
  });

  it('bounds the slot index by the real player cap', () => {
    expect(WIRE_LIMITS.maxPlayers).toBe(MAX_PLAYERS);
  });

  it('bounds a faction by the real faction count, NOT by the player cap', () => {
    // These two were confused in the relay, which accepted faction indices 5..7
    // because 8 was the player cap and the numbers looked interchangeable. A
    // faction of 7 relayed to both clients gets seated and then used to index
    // the faction-keyed art and def tables: undefined, then NaN, then the black
    // frame CLAUDE.md records losing a day to — identically on both machines,
    // so the checksum agrees the entire way down and never says a word.
    expect(WIRE_LIMITS.factions).toBe(FACTION_COUNT);
    expect(WIRE_LIMITS.factions).toBeLessThan(WIRE_LIMITS.maxPlayers);
  });
});

describe('the turn schedule is coherent', () => {
  it('sends far enough ahead to survive the latency it is buying', () => {
    // The whole point of a delay is that a frame can be late. A delay of 1
    // would leave one turn of budget, which is not a budget.
    expect(TURN_DELAY).toBeGreaterThanOrEqual(2);
  });

  it('leaves room for a peer to run ahead without letting it run away', () => {
    expect(TURN_LOOKAHEAD).toBeGreaterThan(TURN_DELAY);
    // An unbounded window is a memory attack; a huge one is the same attack
    // slower. This keeps the relay's per-match buffer to single-digit turns.
    expect(TURN_LOOKAHEAD).toBeLessThanOrEqual(TURN_DELAY + 4);
  });

  it('keeps a turn short enough that orders do not feel queued', () => {
    // SIM_HZ is 30, so TURN_TICKS 3 is 100 ms. Beyond ~5 the quantisation
    // itself becomes visible, independent of any network latency.
    expect(TURN_TICKS).toBeGreaterThanOrEqual(1);
    expect(TURN_TICKS).toBeLessThanOrEqual(5);
  });
});

describe('the server can only reach two files', () => {
  /**
   * Enforced by reading the source, because there is no runtime moment at which
   * this could be observed. `server/tsconfig.json` restricts the include list;
   * this makes the reason survive somebody widening it.
   */
  it('protocol.ts imports nothing but core/types', () => {
    const src = read('src/net/protocol.ts');
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec, `protocol.ts must not import ${spec}`).toBe('../core/types');
    }
  });

  it('core/types.ts imports nothing at all, so the closure really is two files', () => {
    const src = read('src/core/types.ts');
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports, 'core/types.ts is the floor of the import graph').toEqual([]);
  });

  it('TurnRelay.ts stays inside the same closure', () => {
    // The relay's merge logic is compiled into the server too — see the header
    // of src/net/TurnRelay.ts for why it is not duplicated there.
    const src = read('src/net/TurnRelay.ts');
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    for (const spec of imports) {
      expect(['./protocol', '../core/types']).toContain(spec);
    }
  });
});

describe('applyCommand covers every command the game can issue', () => {
  /** A structurally valid command of the given kind. */
  function commandOf(kind: number): WireCommand {
    return {
      kind, player: 0, order: 1, target: 0, x: 10, z: 10, defId: 1,
      tab: 0, cx: 2, cz: 2, stance: 0, queued: false, arg: 0, entities: [1],
    };
  }

  /**
   * Every CommandKind except `None`, PARSED FROM THE SOURCE rather than listed,
   * so a kind added tomorrow is covered by this test the day it lands.
   *
   * `Object.values(CommandKind)` is what one would reach for and it does not
   * compile: `CommandKind` is a `const enum`, so it has no runtime object at
   * all and TS2475 rejects using the name as a value. Same family as the
   * TS2476 that CLAUDE.md records shipping a broken deploy — `npm run build`
   * strips types and would never have said a word.
   *
   * This is the same parse `tests/replay.spec.ts` performs, for the same
   * reason: the enum declaration is the only source of truth there is.
   */
  const KINDS = ((): number[] => {
    const types = read('src/core/types.ts');
    const start = types.indexOf('export const enum CommandKind');
    const block = types.slice(start, types.indexOf('\n}', start));
    return Array.from(block.matchAll(/^\s{2}(\w+)\s*=\s*(\d+),/gm))
      .filter((m) => m[1] !== 'None')
      .map((m) => Number(m[2]));
  })();

  it('has a branch for each one', () => {
    // Guards against the enum being erased to nothing by a build change — an
    // empty list would make every assertion below vacuous.
    expect(KINDS.length).toBeGreaterThanOrEqual(12);
    const ch = new Channels();
    for (const kind of KINDS) {
      expect(applyCommand(ch.commands, commandOf(kind)), `CommandKind ${kind}`).toBe(true);
      ch.commands.clear();
    }
  });

  it('returns false for a kind it does not know, rather than dropping it quietly', () => {
    const ch = new Channels();
    expect(applyCommand(ch.commands, commandOf(250))).toBe(false);
  });

  it('agrees with the validator about which kinds exist', () => {
    // Two allowlists that disagree would mean the relay forwards a command the
    // client cannot apply — a silent no-op on one machine.
    for (const kind of KINDS) expect(isKnownCommandKind(kind), `kind ${kind}`).toBe(true);
    expect(isKnownCommandKind(CommandKind.None)).toBe(false);
    expect(isKnownCommandKind(250)).toBe(false);
  });
});

describe('parseMessage refuses what it cannot route', () => {
  it('accepts a well-formed message', () => {
    const res = parseMessage(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, build: 'x' }));
    expect(res.ok).toBe(true);
  });

  it.each([
    ['not JSON', 'not json at all'],
    ['an array', '[1,2,3]'],
    ['a bare number', '42'],
    ['null', 'null'],
    ['no discriminant', '{"protocol":1}'],
    ['a non-string discriminant', '{"t":7}'],
  ])('refuses %s', (_label, text) => {
    expect(parseMessage(text).ok).toBe(false);
  });

  it('refuses an oversized payload without parsing it', () => {
    // The cost of JSON.parse on a 10 MB string is the attack; the length check
    // has to come first or the guard is decorative.
    const huge = `{"t":"turn","pad":"${'a'.repeat(WIRE_LIMITS.maxMessageBytes + 10)}"}`;
    const res = parseMessage(huge);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('too large');
  });

  it('does not let a __proto__ key reach Object.prototype', () => {
    parseMessage('{"t":"hello","__proto__":{"pwned":true}}');
    expect(({} as Record<string, unknown>).pwned).toBeUndefined();
  });
});
