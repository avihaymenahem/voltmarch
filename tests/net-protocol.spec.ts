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
import { BUILD_TAB_COUNT, CommandKind, FACTION_COUNT } from '../src/core/types';
import { Channels } from '../src/core/events';
import {
  PROTOCOL_VERSION, TURN_DELAY, TURN_LOOKAHEAD, TURN_TICKS, VOCABULARY_SIZES, WIRE_LIMITS,
  isKnownCommandKind, normalizeChatText, normalizeCommanderName, parseMessage, parseSeatPlan,
  validateCommand,
} from '../src/net/protocol';
import { ProductionCatalog, UNIT_PUBLIC_ID_BASE } from '../src/sim/Production';
import { resolveDefBinding } from '../src/game/Scenarios';
import type { WireCommand } from '../src/net/protocol';
import { applyCommand, toWire } from '../src/net/applyCommand';

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** A structurally valid command, for tests that vary exactly one field. */
const WIRE_TEMPLATE: WireCommand = {
  kind: CommandKind.Order, player: 0, order: 0, target: 0, x: 1, z: 1,
  defId: -1, tab: 0, cx: 1, cz: 1, stance: 0, queued: false, arg: 0, entities: [],
};

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

  /**
   * THE ONE LIMIT THAT MIRRORED NOTHING, AND IT WAS THE ONE THAT WAS WRONG.
   *
   * `maxDefId` was 4095 while `UNIT_PUBLIC_ID_BASE` is 4096, so EVERY unit in
   * the game carried a `Command.defId` one above the ceiling and `validateCommand`
   * answered `{ fault: 'bounds' }` for all sixty of them. `TurnRelay` empties the
   * whole submission on one bad command, so a multiplayer player could not buy a
   * hull and lost every other order issued in the same 100 ms turn with it.
   *
   * It was invisible because the reasoning existed everywhere except here:
   * `Production.ts` argues that upgrades sit at 2048 and powers at 3072 BECAUSE
   * of this ceiling, `tests/upgrades.spec.ts` and `tests/command-post.spec.ts`
   * each assert their own half against it, and `tests/net-lockstep.spec.ts` only
   * ever constructs `Order` and `SetStance`. Nobody asserted the unit half.
   *
   * Driven through the REAL bound catalog rather than `4096 + index`, because a
   * re-implemented formula nobody checks is the same defect wearing the other
   * hat — and asserted in BOTH directions, so removing the ceiling to "fix" a
   * future overflow fails here too.
   */
  it('leaves room for every buildable the catalog can name, units included', async () => {
    const catalog = new ProductionCatalog(await resolveDefBinding());
    const ids = catalog.entries.map((e) => e.publicId);
    const highest = Math.max(...ids);

    expect(ids.length).toBeGreaterThan(100);
    expect(highest).toBeGreaterThanOrEqual(UNIT_PUBLIC_ID_BASE);
    expect(highest, `publicId ${highest} is above WIRE_LIMITS.maxDefId ${WIRE_LIMITS.maxDefId}`)
      .toBeLessThanOrEqual(WIRE_LIMITS.maxDefId);

    // And the real command, through the real validator: the failure was never
    // visible in the number, only in the verdict.
    for (const defId of [Math.min(...ids), UNIT_PUBLIC_ID_BASE, highest]) {
      const check = validateCommand({
        ...WIRE_TEMPLATE, kind: CommandKind.ProductionStart, defId,
      });
      expect(check.ok, `defId ${defId} must be relayable`).toBe(true);
    }

    // The other direction. This is a structural ceiling, not an absent one.
    expect(WIRE_LIMITS.maxDefId).toBeLessThan(UNIT_PUBLIC_ID_BASE * 2);
    expect(validateCommand({ ...WIRE_TEMPLATE, defId: WIRE_LIMITS.maxDefId + 1 }).ok).toBe(false);
  });

  /**
   * ONE LEGAL GESTURE EMITS UP TO `MAX_SELECTION` COMMANDS.
   *
   * Self-destruct fans out to one command per selected unit, and deploy and
   * set-primary have the same shape — so at the old cap of 32 a player who
   * box-selected 33 hulls and confirmed had the entire turn emptied. A cap that
   * bites legitimate play is a worse defect than the one it closes.
   */
  it('leaves room for a full selection to fan out inside one turn', () => {
    expect(WIRE_LIMITS.maxCommandsPerTurn).toBeGreaterThanOrEqual(MAX_SELECTION);
    // And the frame it produces still fits what `ws` will accept, which is the
    // limit that actually protects the server. Worst realistic turn: a full
    // selection of self-destructs plus one order carrying every id.
    const worst = JSON.stringify({
      t: 'turn',
      turn: 1,
      check: { tick: 1, hash: 1 },
      commands: [
        ...Array.from({ length: MAX_SELECTION }, () => WIRE_TEMPLATE),
        { ...WIRE_TEMPLATE, entities: Array.from({ length: MAX_SELECTION }, (_, i) => i + 1) },
      ],
    });
    expect(worst.length).toBeLessThan(WIRE_LIMITS.maxMessageBytes);
  });
});

/**
 * The version, and the mechanism that makes bumping it non-optional.
 *
 * `PROTOCOL_VERSION` sat at 1 through three separate widenings of the wire
 * vocabulary — `OrderKind.Unload`, `CommandKind.UsePower` and `BuildTab.Powers`
 * — because a number nobody is forced to look at is a number nobody looks at.
 * Pinning the SIZE of each allowlist is the forcing function: adding an enum
 * member fails here, and the only way to make it pass is to state whether the
 * wire changed.
 */
describe('the protocol version is pinned to the vocabulary it describes', () => {
  it('names the vocabulary it was last bumped for', () => {
    // v5 adds bounded commander identity plus presentation-only chat and pings.
    // None may be confused with a deterministic command or turn frame.
    expect(PROTOCOL_VERSION).toBe(5);
    expect(VOCABULARY_SIZES.kinds, 'a CommandKind was added or removed').toBe(13);
    expect(VOCABULARY_SIZES.orders, 'an OrderKind was added or removed').toBe(17);
    expect(VOCABULARY_SIZES.tabs, 'a BuildTab was added or removed').toBe(BUILD_TAB_COUNT);
    expect(VOCABULARY_SIZES.stances, 'a Stance was added or removed').toBe(4);
  });
});

describe('player-controlled presentation text is normalized at both ends', () => {
  it('accepts readable commander handles and canonicalises spacing', () => {
    expect(normalizeCommanderName('  Major   Vega  ')).toBe('Major Vega');
    expect(normalizeCommanderName('Командир-7')).toBe('Командир-7');
  });

  it.each(['A', 'a/b', '<script>', 'admin', 'fuck'])('refuses unsafe name %s', (name) => {
    expect(normalizeCommanderName(name)).toBeNull();
  });

  it('flattens chat, caps it, and rejects control characters', () => {
    expect(normalizeChatText('  hold\n  the ridge  ')).toBe('hold the ridge');
    expect(normalizeChatText('x'.repeat(181))).toBeNull();
    expect(normalizeChatText(`bad${String.fromCharCode(1)}text`)).toBeNull();
  });
});

describe('mixed-match seat plans are closed and rebuilt', () => {
  const mixed = {
    factions: [2, 3, 1, 4], teams: [0, 0, 1, 1], ai: [2, 3],
    difficulty: [0, 0, 2, 2],
  };

  it('accepts 2v2 and does not retain caller-owned arrays', () => {
    const plan = parseSeatPlan(mixed);
    expect(plan).toEqual(mixed);
    expect(plan?.factions).not.toBe(mixed.factions);
    expect(plan?.teams).not.toBe(mixed.teams);
  });

  it.each([
    ['four humans', { ...mixed, ai: [] }],
    ['AI in a human seat', { ...mixed, ai: [1, 3] }],
    ['humans on opposite teams', { ...mixed, teams: [0, 1, 1, 1] }],
    ['AI allied to the humans', { ...mixed, teams: [0, 0, 0, 1] }],
    ['out-of-range difficulty', { ...mixed, difficulty: [0, 0, 4, 2] }],
    ['neutral faction', { ...mixed, factions: [0, 3, 1, 4] }],
    ['parallel arrays out of step', { ...mixed, teams: [0, 0, 1] }],
  ])('refuses %s rather than clamping it', (_name, plan) => {
    expect(parseSeatPlan(plan)).toBeNull();
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

describe('an off-map click does not cost the player the whole turn', () => {
  /**
   * `screenToGround` unprojects onto the ground plane and returns the raw
   * intersection — no clamp anywhere between it and `CommandBus.issueOrder`.
   * With the camera at a map edge that leaves real, clickable ground OUTSIDE
   * the map under the cursor: 30.4 m past the focus at `CAMERA.defaultDistance`
   * 55, 77.4 m at `maxDistance` 140, computed from the shipped pitch (52) and
   * fov (36) with `clampWorld`'s zero margin letting the focus sit on x = 0.
   *
   * `validateCommand` requires `0 <= x <= MAP_SIZE` and `TurnRelay` empties the
   * WHOLE submission on one bad command, so a single stray right-click near the
   * border took every other order in that 100 ms turn with it.
   */
  it('sends an on-map coordinate for a click past the border', () => {
    const ch = new Channels();
    ch.commands.issueOrder(0 as never, 1 as never, [1], 1, -12.5, MAP_SIZE + 40, 0 as never, false);
    let sent: WireCommand | null = null;
    ch.commands.harvest((cmd) => { sent = toWire(cmd); });
    const wire = sent as WireCommand | null;
    expect(wire).not.toBeNull();
    expect(wire?.x).toBe(0);
    expect(wire?.z).toBe(MAP_SIZE);
    expect(validateCommand(wire).ok, 'and the relay must accept it').toBe(true);
  });

  it('leaves an ordinary coordinate exactly as it was', () => {
    // The falsifier. A clamp that moved a legal order would be a worse defect
    // than the one it closes, and it would be invisible.
    const ch = new Channels();
    ch.commands.issueOrder(0 as never, 1 as never, [1], 1, 123.456, 0, 0 as never, false);
    let sent: WireCommand | null = null;
    ch.commands.harvest((cmd) => { sent = toWire(cmd); });
    const wire = sent as WireCommand | null;
    expect(wire?.x).toBe(123.456);
    expect(wire?.z).toBe(0);
  });
});
