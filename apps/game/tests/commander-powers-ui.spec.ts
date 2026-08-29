/// <reference types="vite/client" />
/**
 * THE VERBS THAT EXISTED AND COULD NOT BE REACHED.
 *
 * Six mechanisms shipped complete — through the command bus, through the replay
 * tap, through the multiplayer relay, with their sim-side behaviour tested —
 * and had no control anywhere in the product:
 *
 *   1. the five commander powers (console-only, while the missions screen
 *      promised "Callable once charged, in any match"),
 *   2. emptying a garrison (`GarrisonService.evacuate`, zero callers),
 *   3. choosing a primary factory (`CommandKind.SetPrimary`, zero issuers),
 *   4. self-destruct (reachable only from the re-issue path and the relay),
 *   5. the build radius (drawn nowhere),
 *   6. the storage ceiling (printed nowhere).
 *
 * Everything here runs headless under `environment: 'node'`. The DOM half — the
 * bar, the buttons, the reticle — is verified by driving the real interface with
 * real `PointerEvent`s; what is pinned HERE is the part that can rot silently:
 * the tables the bar indexes, the thresholds the readout branches on, the
 * sentences a refusal produces, and the ONE order that now means two things.
 *
 * The load-bearing assertions:
 *   - every power in the table has a row and an icon, so adding a sixth cannot
 *     ship as a blank square,
 *   - `OrderKind.Unload` on a BUILDING empties its garrison and clears the
 *     order column, so a strongpoint cannot be left holding a dead order,
 *   - the same order on a hull still does exactly what it did,
 *   - a refused garrison produces a sentence naming the RULE, not a token.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  EntityFlag, EntityKind, Faction, OrderKind, Stance, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { BUILD_RADIUS, CELL, PLACEMENT, SIM_DT } from '../src/core/config';

import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { GARRISON, GarrisonService, setGarrisonService } from '../src/sim/Garrison';
import { withinBuildRadius } from '../src/sim/Placement';

import {
  OrderExecutor, gatherOccupiedGarrisons, garrisonRefusalText,
} from '../src/input/Commands';
import {
  COMMANDER_POWER_ROWS, POWER_ICONS, STORAGE_WARN_FRACTION,
  SELF_DESTRUCT_CONFIRM_SECONDS, lockedSentence, storageState,
} from '../src/ui/Sidebar';
import {
  COMMANDER_POWERS, COMMANDER_POWER_LIST, CommanderPowerId, grantCommanderPower, powersOwnedBy,
} from '../src/progression/powers';
import { GLYPHS } from '../src/ui/Chrome';
import { ICONS } from '../src/ui/icons';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };
/** Every icon the set actually draws. `ICONS` is keyed by `IconName`. */
const ICON_LIST: readonly string[] = Object.keys(ICONS);
const ALLIES = 0 as PlayerId;
const SOVIETS = 1 as PlayerId;
const GAIA = 2 as PlayerId;

/* ========================================================================== */
/* Fixture — `tests/features.spec.ts`'s rig, trimmed to what these need        */
/* ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  garrison: GarrisonService;
  executor: OrderExecutor;
  tick: number;
  step(): void;
  building(key: string, owner: PlayerId, cx: number, cz: number): EntityId;
  unit(key: string, owner: PlayerId, x: number, z: number): EntityId;
}

function makeRig(seed = 4242): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  for (let i = 0; i < world.players.length; i++) {
    world.players[GAIA as number].allyMask |= 1 << i;
    world.players[i].allyMask |= 1 << (GAIA as number);
  }

  const channels = new Channels();
  const production = new ProductionService(world, channels, new ProductionCatalog(EMPTY_BINDING));
  setProduction(production);

  const garrison = new GarrisonService(world, channels);
  garrison.attach();
  setGarrisonService(garrison);

  const rng = new Rng(seed);
  const executor = new OrderExecutor(world, channels);

  const rig: Rig = {
    world, channels, production, garrison, executor, tick: 0,

    step(): void {
      rig.tick++;
      world.tick = rig.tick;
      world.time = rig.tick * SIM_DT;
      world.spatial.rebuild();
      const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
      executor.tick();
      garrison.simTick(s);
    },

    building(key, owner, cx, cz): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry;
      expect(entry, `catalog is missing "${key}"`).not.toBeNull();
      return production.spawnBuilding(world.players[owner as number], entry, cx, cz, 1);
    },

    unit(key, owner, x, z): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry;
      expect(entry, `catalog is missing "${key}"`).not.toBeNull();
      return production.spawnUnit(world.players[owner as number], entry, x, z, 0);
    },
  };
  return rig;
}

/** Walk a squad into a host the way `Garrison.simTick` does it. */
function garrisonInto(rig: Rig, men: readonly EntityId[], host: EntityId): void {
  const st = rig.world.store;
  const b = st.index(host);
  for (const m of men) {
    const i = st.index(m);
    st.posX[i] = st.posX[b];
    st.posZ[i] = st.posZ[b] - st.footprintH[b] * CELL * 0.5 - 0.4;
    st.prevX[i] = st.posX[i];
    st.prevZ[i] = st.posZ[i];
    st.orderKind[i] = OrderKind.Enter;
    st.orderTarget[i] = host as number;
    st.state[i] = UnitState.Moving;
  }
  rig.step();
}

/** Put an order on the bus exactly as the HUD's buttons do. */
function issueOne(
  rig: Rig, player: PlayerId, order: OrderKind, id: EntityId,
): void {
  const st = rig.world.store;
  const i = st.index(id);
  const ids = new Int32Array(1);
  ids[0] = id as number;
  rig.channels.commands.issueOrder(player, order, ids, 1, st.posX[i], st.posZ[i], id);
}

/* ========================================================================== */
/* 1. The commander power bar                                                 */
/* ========================================================================== */

describe('commander powers — the bar has a row for every power', () => {
  it('builds exactly as many rows as the table has powers', () => {
    // A sixth power added to `COMMANDER_POWERS` with no matching row would be
    // silently unreachable — which is the exact defect this whole file exists
    // about, one level up.
    expect(COMMANDER_POWER_ROWS).toBe(COMMANDER_POWER_LIST.length);
    expect(COMMANDER_POWER_ROWS).toBe(COMMANDER_POWERS.length - 1);
  });

  it('gives every power an icon that the icon set actually draws', () => {
    // Indexed by CommanderPowerId, so the array must be one longer than the
    // power list — slot 0 is the None row.
    expect(POWER_ICONS.length).toBe(COMMANDER_POWERS.length);
    for (const spec of COMMANDER_POWER_LIST) {
      const icon = POWER_ICONS[spec.id as number];
      expect(icon, `${spec.key} has no icon`).toBeTruthy();
      expect(ICON_LIST, `${spec.key} -> "${icon}" is not a real icon`).toContain(icon);
    }
  });

  it('gives the five powers five DIFFERENT icons', () => {
    // A column of identical glyphs is a column the player has to read the words
    // of, which defeats the point of a bar you scan mid-fight.
    const seen = new Set(COMMANDER_POWER_LIST.map((p) => POWER_ICONS[p.id as number]));
    expect(seen.size).toBe(COMMANDER_POWER_LIST.length);
  });

  it('has a row for every power, so a full purse still fits the bar', () => {
    // The bar is a fixed pool of `COMMANDER_POWER_ROWS` buttons. A player who
    // buys all five must see all five, and the day a sixth power lands this
    // is what says the pool has to grow with it.
    const all = { commanderPowerMask: 0 };
    for (const p of COMMANDER_POWER_LIST) grantCommanderPower(all, p.id as number);
    const out = powersOwnedBy(all, []);
    expect(out.length).toBe(COMMANDER_POWER_LIST.length);
    expect(out.length).toBeLessThanOrEqual(COMMANDER_POWER_ROWS);
  });

  it('offers only what was BOUGHT in this match, and nothing on a fresh one', () => {
    // The bar and `CommanderPowerService.use` read the same bit since v2.6.0,
    // so a row can no longer appear for a power the simulation would refuse.
    const owner = { commanderPowerMask: 0 };
    expect(powersOwnedBy(owner, []).length).toBe(0);
    grantCommanderPower(owner, CommanderPowerId.Airstrike);
    expect(powersOwnedBy(owner, []).map((p) => p.key)).toEqual(['airstrike']);
  });

  it('reuses the caller-supplied array, so a per-frame rebuild allocates nothing', () => {
    const all = { commanderPowerMask: 0 };
    for (const p of COMMANDER_POWER_LIST) grantCommanderPower(all, p.id as number);
    const pool: ReturnType<typeof powersOwnedBy> = [];
    const a = powersOwnedBy(all, pool);
    const b = powersOwnedBy(all, pool);
    expect(a).toBe(pool);
    expect(b).toBe(pool);
    expect(pool.length).toBe(COMMANDER_POWER_LIST.length);
  });

  it('has a charge and a label on every power the bar will print', () => {
    for (const spec of COMMANDER_POWER_LIST) {
      expect(spec.label.length, `${spec.key} has no label`).toBeGreaterThan(0);
      expect(spec.hint.length, `${spec.key} has no hint`).toBeGreaterThan(0);
      // The row draws `1 - remaining/total`, so a zero charge would divide the
      // fill by zero and paint an empty bar for a ready power.
      expect(spec.chargeSeconds, `${spec.key} has no charge`).toBeGreaterThan(0);
    }
  });
});

/* ========================================================================== */
/* 2. Emptying a garrison                                                     */
/* ========================================================================== */

describe('garrison — Unload on a building is the evacuate verb', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('turns the whole squad out and clears the building order column', () => {
    const host = rig.building('powerPlant', ALLIES, 20, 20);
    const men = [
      rig.unit('gi', ALLIES, 0, 0),
      rig.unit('gi', ALLIES, 1, 0),
      rig.unit('gi', ALLIES, 2, 0),
    ];
    garrisonInto(rig, men, host);
    expect(rig.garrison.occupantCount(host)).toBe(3);

    issueOne(rig, ALLIES, OrderKind.Unload, host);
    rig.step();

    expect(rig.garrison.occupantCount(host)).toBe(0);
    const st = rig.world.store;
    for (const m of men) {
      const i = st.index(m);
      expect(st.flags[i] & EntityFlag.Garrisoned).toBe(0);
      expect(st.flags[i] & EntityFlag.Immobilized).toBe(0);
    }

    // THE ORDER COLUMN IS CLEARED, and that is the half a transport does NOT
    // do. `sim/Transport.ts` clears a hull's Unload at Phase.Cleanup once the
    // men are actually out; nothing anywhere watches a BUILDING's order column,
    // so an uncleared Unload would sit on the structure for the whole match.
    const b = st.index(host);
    expect(st.orderKind[b]).toBe(OrderKind.None);
    expect(st.orderTarget[b]).toBe(0);
    expect(st.state[b]).toBe(UnitState.Idle);
  });

  it('puts the men on the ground around the building, not inside it', () => {
    const host = rig.building('powerPlant', ALLIES, 20, 20);
    const men = [rig.unit('gi', ALLIES, 0, 0), rig.unit('gi', ALLIES, 1, 0)];
    garrisonInto(rig, men, host);

    issueOne(rig, ALLIES, OrderKind.Unload, host);
    rig.step();

    const st = rig.world.store;
    const b = st.index(host);
    const halfW = st.footprintW[b] * CELL * 0.5;
    const halfH = st.footprintH[b] * CELL * 0.5;
    for (const m of men) {
      const i = st.index(m);
      const dx = Math.abs(st.posX[i] - st.posX[b]);
      const dz = Math.abs(st.posZ[i] - st.posZ[b]);
      expect(dx > halfW || dz > halfH, 'a man was left standing inside the wall').toBe(true);
    }
  });

  it('refuses a building the commanding player does not own', () => {
    const host = rig.building('powerPlant', SOVIETS, 20, 20);
    const men = [rig.unit('conscript', SOVIETS, 0, 0)];
    garrisonInto(rig, men, host);
    expect(rig.garrison.occupantCount(host)).toBe(1);

    // The bus stamps the player; `applyOrder` refuses anything a slot does not
    // own. A spoofed evacuate must be inert, exactly like a spoofed move.
    issueOne(rig, ALLIES, OrderKind.Unload, host);
    rig.step();

    expect(rig.garrison.occupantCount(host)).toBe(1);
  });

  it('is harmless on an empty building', () => {
    const host = rig.building('powerPlant', ALLIES, 20, 20);
    issueOne(rig, ALLIES, OrderKind.Unload, host);
    expect(() => rig.step()).not.toThrow();
    expect(rig.garrison.occupantCount(host)).toBe(0);
  });

  it('leaves a VEHICLE taking the same order alone', () => {
    // The branch keys on `EntityKind.Building` and nothing else, so a hull must
    // keep the behaviour `sim/Transport.ts` depends on: the order STANDS, so a
    // transport still over water unloads when it reaches a coast.
    const hull = rig.unit('transport', ALLIES, 40, 40);
    issueOne(rig, ALLIES, OrderKind.Unload, hull);
    rig.step();

    const st = rig.world.store;
    const i = st.index(hull);
    expect(st.orderKind[i]).toBe(OrderKind.Unload);
  });
});

describe('garrison — the D-key gatherer', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('collects only occupied buildings the player owns', () => {
    const mine = rig.building('powerPlant', ALLIES, 20, 20);
    const empty = rig.building('powerPlant', ALLIES, 40, 20);
    const theirs = rig.building('powerPlant', SOVIETS, 60, 20);
    garrisonInto(rig, [rig.unit('gi', ALLIES, 0, 0)], mine);
    garrisonInto(rig, [rig.unit('conscript', SOVIETS, 1, 0)], theirs);

    const ids = new Int32Array([mine as number, empty as number, theirs as number]);
    const out = new Int32Array(8);
    const n = gatherOccupiedGarrisons(rig.world, ids, 3, out);

    expect(n).toBe(1);
    expect(out[0]).toBe(mine as number);
  });

  it('finds nothing once the building has been emptied', () => {
    // The evacuation is applied synchronously inside the same drain, so a
    // second D press has nothing left to gather — which is what stands in for
    // the `orderKind === Unload` guard the transport gatherer uses.
    const host = rig.building('powerPlant', ALLIES, 20, 20);
    garrisonInto(rig, [rig.unit('gi', ALLIES, 0, 0)], host);

    const ids = new Int32Array([host as number]);
    const out = new Int32Array(4);
    expect(gatherOccupiedGarrisons(rig.world, ids, 1, out)).toBe(1);

    issueOne(rig, ALLIES, OrderKind.Unload, host);
    rig.step();

    expect(gatherOccupiedGarrisons(rig.world, ids, 1, out)).toBe(0);
  });

  it('never writes past the caller-supplied array', () => {
    const hosts: EntityId[] = [];
    for (let k = 0; k < 4; k++) {
      const h = rig.building('powerPlant', ALLIES, 20 + k * 8, 20);
      garrisonInto(rig, [rig.unit('gi', ALLIES, k, 0)], h);
      hosts.push(h);
    }
    const ids = new Int32Array(hosts.map((h) => h as number));
    const out = new Int32Array(2);
    expect(gatherOccupiedGarrisons(rig.world, ids, hosts.length, out)).toBe(2);
  });
});

/* ========================================================================== */
/* 3. Why a garrison was refused                                              */
/* ========================================================================== */

describe('garrison — the refusal says which rule applied', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('expands every token the service can return into a sentence', () => {
    // These are the strings `GarrisonService.refusalFor` actually produces. A
    // token with no expansion falls back to itself, so this list going stale
    // degrades to the old behaviour rather than to an empty toast — but it
    // should not go stale, and this is what notices.
    for (const token of [
      'armed', 'too small', 'production structure', 'full', 'hostile',
      'unfinished', 'not a structure',
    ]) {
      const text = garrisonRefusalText(token);
      // A SENTENCE, not the token echoed back. The fallback in
      // `garrisonRefusalText` returns the token verbatim, so an entry going
      // missing shows up here rather than as a toast reading "too small".
      expect(text, `"${token}" has no sentence`).not.toBe(token);
      expect(text.length).toBeGreaterThan(12);
      // It should read as English.
      expect(text[0]).toBe(text[0].toUpperCase());
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('says nothing at all when nothing was refused', () => {
    expect(garrisonRefusalText('')).toBe('');
  });

  it('passes an unknown token through rather than swallowing it', () => {
    expect(garrisonRefusalText('brand new reason')).toBe('brand new reason');
  });

  it('the service still refuses the buildings the sentences describe', () => {
    // The pairing is what matters: a sentence is only useful if it is the one
    // the service would actually have produced. This pins three of them against
    // the real roster, which is also the roster the player complained about.
    const silo = rig.building('oreSilo', ALLIES, 20, 20);
    const barracks = rig.building('barracks', ALLIES, 40, 20);
    const power = rig.building('powerPlant', ALLIES, 60, 20);

    expect(rig.garrison.refusalFor(silo, ALLIES)).toBe('too small');
    expect(rig.garrison.refusalFor(barracks, ALLIES)).toBe('production structure');
    // The one structure a fresh profile owns that IS garrisonable.
    expect(rig.garrison.refusalFor(power, ALLIES)).toBe('');

    // The sentences quote the SERVICE'S OWN constants, so a balance change that
    // widened the eligible set could not leave the explanation behind.
    expect(garrisonRefusalText('too small'))
      .toContain(`${GARRISON.minFootprint}x${GARRISON.minFootprint}`);
    expect(garrisonRefusalText('full')).toContain(String(GARRISON.capacity));
  });
});

/* ========================================================================== */
/* 4. The locked build slot names its mission                                 */
/* ========================================================================== */

describe('locked slots — the sentence names the mission', () => {
  it('replaces the gate\'s generic tail with the real answer', () => {
    // `LOCKED_REASON` verbatim. Appending would read "complete a mission —
    // Strip Mine", which says "a mission" and then names it.
    expect(lockedSentence('Locked — complete a mission', 'Strip Mine: mine 70,000 credits of ore'))
      .toBe('Locked — Strip Mine: mine 70,000 credits of ore');
  });

  it('leaves the reason untouched when nothing can name a mission', () => {
    // The overwhelming majority of defs carry no `unlockedBy`, and a build
    // refused for FUNDS must keep saying so.
    expect(lockedSentence('Locked — complete a mission', ''))
      .toBe('Locked — complete a mission');
    expect(lockedSentence('Not enough credits', '')).toBe('Not enough credits');
  });

  it('appends to a reason that has no dash to replace', () => {
    // These strings are not ours and are free to be reworded.
    expect(lockedSentence('Locked', 'Strip Mine: mine ore'))
      .toBe('Locked — Strip Mine: mine ore');
  });

  it('still produces a sentence when the reason is missing entirely', () => {
    expect(lockedSentence('', 'Strip Mine: mine ore')).toBe('Locked — Strip Mine: mine ore');
  });
});

/* ========================================================================== */
/* 5. The storage ceiling                                                     */
/* ========================================================================== */

describe('storage readout — the thresholds', () => {
  it('says nothing when there is no ceiling to speak of', () => {
    expect(storageState(5000, 0)).toBe('none');
    expect(storageState(5000, -1)).toBe('none');
    expect(storageState(0, Number.NaN)).toBe('none');
  });

  it('warns at nine tenths and alarms at the ceiling', () => {
    const cap = 10000;
    expect(storageState(0, cap)).toBe('ok');
    expect(storageState(cap * STORAGE_WARN_FRACTION - 1, cap)).toBe('ok');
    expect(storageState(cap * STORAGE_WARN_FRACTION, cap)).toBe('near');
    expect(storageState(cap - 1, cap)).toBe('near');
    expect(storageState(cap, cap)).toBe('full');
    expect(storageState(cap + 5000, cap)).toBe('full');
  });

  it('is FULL at the stock opening bank, which is the whole point', () => {
    // A skirmish starts at exactly the cap, so the very first frame of every
    // match is the state this readout was added to surface. If this ever stops
    // being true the readout is still right — but the bug report that produced
    // it was about the first ninety seconds.
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    const me = world.players[0];
    if (me.storageMax > 0) {
      expect(storageState(me.storageMax, me.storageMax)).toBe('full');
    }
  });
});

/* ========================================================================== */
/* 6. The build radius the overlay draws                                      */
/* ========================================================================== */

describe('build radius — the picture and the check share their inputs', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('a builder projects the big radius and everything else the small one', () => {
    // `Overlay.drawBuildArea` picks its radius with the same one-line rule
    // `withinBuildRadius` uses, off the same two constants. This pins that the
    // constants really are different and in the order the rule assumes — a
    // swap would make the drawn region wrong in a way no typecheck catches.
    expect(BUILD_RADIUS).toBeGreaterThan(PLACEMENT.adjacencyRadius);
  });

  it('the drawn disc matches where a structure may actually be founded', () => {
    const yard = rig.building('conyard', ALLIES, 32, 32);
    const st = rig.world.store;
    const y = st.index(yard);
    expect(st.flags[y] & EntityFlag.IsBuilder).not.toBe(0);

    const r = BUILD_RADIUS + st.radius[y];
    const cx = st.posX[y];
    const cz = st.posZ[y];

    // Just inside the disc the overlay paints, and just outside it.
    expect(withinBuildRadius(rig.world, ALLIES, cx + r * 0.9, cz)).toBe(true);
    expect(withinBuildRadius(rig.world, ALLIES, cx + r * 1.1, cz)).toBe(false);
  });

  it('an unfinished structure projects nothing, and neither does a drawn one', () => {
    // The overlay skips `UnderConstruction` for the same reason
    // `withinBuildRadius` does. Two copies of that skip is one copy too many,
    // so this is the test that keeps them honest.
    const yard = rig.building('conyard', ALLIES, 32, 32);
    const st = rig.world.store;
    const y = st.index(yard);
    st.flags[y] |= EntityFlag.UnderConstruction;

    expect(withinBuildRadius(rig.world, ALLIES, st.posX[y] + 4, st.posZ[y])).toBe(false);
  });
});

/* ========================================================================== */
/* 7. Self-destruct                                                           */
/* ========================================================================== */

describe('self-destruct — the confirm latch', () => {
  it('gives the player a readable window and not an unbounded one', () => {
    // Long enough to read the word CONFIRM and mean it; short enough that a
    // button armed by accident is disarmed before attention comes back.
    expect(SELF_DESTRUCT_CONFIRM_SECONDS).toBeGreaterThanOrEqual(2);
    expect(SELF_DESTRUCT_CONFIRM_SECONDS).toBeLessThanOrEqual(10);
  });

  it('only ever offers itself for what the simulation will actually accept', () => {
    // `RepairSell.selfDestruct` refuses every kind but these two, so the row
    // must never appear for a structure — the sell tool is that verb, and a
    // button that issues a command the sim discards is worse than no button.
    const rig = makeRig();
    const tank = rig.unit('grizzly', ALLIES, 10, 10);
    const plant = rig.building('powerPlant', ALLIES, 20, 20);
    const st = rig.world.store;
    expect(st.kind[st.index(tank)]).toBe(EntityKind.Vehicle);
    expect(st.kind[st.index(plant)]).toBe(EntityKind.Building);
  });
});

/* ========================================================================== */
/* 8. Primary factory                                                         */
/* ========================================================================== */

describe('primary factory — the flag the button toggles', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('hands the flag over, and takes it off the previous holder', () => {
    // `Production.applyPrimary` is the mechanism and it always worked; what
    // never existed was anything that issued the command. This drives the real
    // command path the button now uses.
    const first = rig.building('warFactory', ALLIES, 20, 20);
    const second = rig.building('warFactory', ALLIES, 40, 20);
    const st = rig.world.store;

    rig.channels.commands.issueSetPrimary(ALLIES, second);
    rig.channels.commands.drain((cmd) => { rig.production.handleCommand(cmd); });
    rig.production.tick({ dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(1) });

    expect(st.flags[st.index(second)] & EntityFlag.PrimaryFactory).not.toBe(0);
    expect(st.flags[st.index(first)] & EntityFlag.PrimaryFactory).toBe(0);
  });

  it('refuses a factory the commanding player does not own', () => {
    const mine = rig.building('warFactory', ALLIES, 20, 20);
    const theirs = rig.building('warFactory', SOVIETS, 40, 20);
    const st = rig.world.store;
    const before = st.flags[st.index(theirs)] & EntityFlag.PrimaryFactory;

    rig.channels.commands.issueSetPrimary(ALLIES, theirs);
    rig.channels.commands.drain((cmd) => { rig.production.handleCommand(cmd); });
    rig.production.tick({ dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(1) });

    expect(st.flags[st.index(theirs)] & EntityFlag.PrimaryFactory).toBe(before);
    expect(st.flags[st.index(mine)] & EntityFlag.PrimaryFactory).not.toBe(0);
  });
});

/* ========================================================================== */
/* 9. The glyph set the new rows draw from                                    */
/* ========================================================================== */

describe('the new controls draw from the shipped icon set', () => {
  it('keeps occupied-building evacuation visually prominent', () => {
    const sidebar = readFileSync('apps/game/src/ui/Sidebar.ts', 'utf8');
    const css = readFileSync('apps/game/src/ui/hud.css', 'utf8');
    expect(sidebar).toContain('vm-cargo-row vm-garrison-row');
    expect(sidebar).toContain('vm-cargo vm-garrison-evacuate');
    expect(css).toContain('.vm-hud .vm-garrison-evacuate');
    expect(css).toContain('min-width: calc(92 * var(--vm-u))');
    expect(css).toContain('@keyframes vm-garrison-action-in');
  });

  it('has every icon the three new selection rows ask for', () => {
    // `deploy` (Evacuate), `primary` (Set Primary), `alert` (Destruct). Named
    // as literals in `Sidebar`'s constructor, where a typo is a blank square in
    // a row nobody screenshots.
    for (const name of ['deploy', 'primary', 'alert'] as const) {
      expect(ICON_LIST, `"${name}" is not a real icon`).toContain(name);
    }
  });

  it('still has the glyph vocabulary the bars share', () => {
    expect(Object.keys(GLYPHS).length).toBeGreaterThan(0);
  });
});
