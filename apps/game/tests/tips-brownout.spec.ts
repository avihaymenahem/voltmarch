/**
 * ============================================================================
 * tests/tips-brownout.spec.ts — ONE SITUATIONAL TIP, END TO END
 * ============================================================================
 * The first feature slice was one trigger, one string and
 * one surface, and it exists to prove four properties that every later tip
 * inherits. Each has a section here, and each has a falsifier, because a gate
 * nobody has seen fail is a gate nobody knows works.
 *
 *   §1  THE TIP IS TRUE. Both halves are re-derived from `POWER_SHED_ORDER`
 *       and `shedPriority`'s `never` for `IsBuilder`, so a retuned shed order
 *       fails here rather than turning shipped copy into a lie.
 *   §2  THE TRIGGER. Fifteen continuous seconds, local player, once per match,
 *       and the counter resets when the lights come back.
 *   §3  THE ACCEPTANCE TEST THE SPEC WROTE FOR ITSELF: *"if that tip fires
 *       while the player is already dragging a Power Plant onto the ground,
 *       the feature has failed for nothing"*. It is measured in the engine
 *       here, and the answer is that WITHOUT the `answeringPower` gate it does
 *       exactly that — a player who reacts on the brownout's first tick is
 *       still holding an unplaced plant fifteen seconds later.
 *   §4  THE SURFACE. Tip keys select the wider chip variant and its detail can
 *       wrap to three lines without changing ordinary event toasts.
 *   §5  THE TOGGLE, BY DELETION. `gameplay.tips: false` posts nothing.
 *   §6  SUPPRESSION, THROUGH THE REAL MODULE. Campaign, replay and tutorial;
 *       PvP deliberately NOT suppressed.
 *   §7  INERTNESS. No shell handle is OFF, not default-on.
 *
 * All headless. No renderer, no clock, no RNG outside the seeded one.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { BuildTab, EntityFlag, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { POWER_SHED_ORDER, SIM_DT } from '../src/core/config';

import { resolveDefBinding } from '../src/game/Scenarios';
import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import { PowerGrid } from '../src/sim/Power';
import { bindDeployTables } from '../src/sim/Deploy';
import { setGameContext } from '../src/game/context';
import type { GameContext } from '../src/game/Bootstrap';

import { setCampaignOutcomePolicy } from '../src/campaign/policy';
import { adoptPreparedPlayback, preparePlayback } from '../src/game/Playback';
import { REPLAY_FORMAT_VERSION } from '../src/game/Replay';
import type { ReplayFile, ReplayHeader } from '../src/game/Replay';

import tipsSystem, {
  BROWNOUT_HOLD_TICKS, TIP_BROWNOUT, TIP_SURVEY_INTERVAL, postTip, tipsPosted,
} from '../src/sim/tips.system';

const P0 = 0 as PlayerId;

/* ==========================================================================
 * THE RIG
 *
 * `orecrisis.system.ts`'s test rig plus a real `PowerGrid`, because the whole
 * trigger is a field that grid writes. Nothing here is stubbed: the brownout
 * comes from real structures with real `power` values, the queue is the real
 * `BuildQueue` drip, and the tip module is the shipped default export.
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  power: PowerGrid;
  tick: number;
}

async function makeRig(): Promise<Rig> {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const binding = await resolveDefBinding();
  const catalog = new ProductionCatalog(binding);
  const production = new ProductionService(world, channels, catalog);
  production.bindingTables = binding.tables;
  setProduction(production);
  bindDeployTables(null);
  world.audio.eva = (): void => { /* no announcer in a headless rig */ };

  return { world, channels, production, power: new PowerGrid(world, channels), tick: 0 };
}

function step(rig: Rig, steps = 1): void {
  const rng = new Rng(99);
  for (let n = 0; n < steps; n++) {
    rig.tick++;
    rig.world.tick = rig.tick;
    rig.world.time = rig.tick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.world.time, rng };
    rig.production.tick(s);
    rig.power.simTick(s.time);
    tipsSystem.simTick?.(s);
  }
}

function building(rig: Rig, key: string, cx: number, cz: number, player: PlayerId = P0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  return rig.production.spawnBuilding(rig.world.player(player), entry!, cx, cz, 1);
}

/**
 * A base that draws more than it makes.
 *
 * One Power Plant (+100) against a refinery (-30), a barracks, a war factory
 * and a radar. Real defs, so the deficit is whatever the shipped content says
 * it is; §2's first case asserts the brownout rather than assuming it, so a
 * rebalance that makes this base solvent fails loudly instead of silently
 * testing nothing.
 */
function brownoutBase(rig: Rig): void {
  building(rig, 'conyard', 40, 40);
  building(rig, 'powerPlant', 52, 40);
  building(rig, 'refinery', 64, 40);
  building(rig, 'warFactory', 76, 40);
  building(rig, 'barracks', 88, 40);
  building(rig, 'radar', 100, 40);
}

/** A solvent base: a second plant covers the draw. */
function healthyBase(rig: Rig): void {
  brownoutBase(rig);
  building(rig, 'powerPlant', 112, 40);
  building(rig, 'powerPlant', 124, 40);
}

/** Structures owned by anyone that are still going up. */
function rising(rig: Rig): number {
  const st = rig.world.store;
  const list = st.byKind[EntityKind.Building];
  let n = 0;
  for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
    if ((st.flags[list[a]] & EntityFlag.UnderConstruction) !== 0) n++;
  }
  return n;
}

interface Toast { kind: string; key: string; title: string; detail: string }

function captureToasts(): Toast[] {
  const out: Toast[] = [];
  (globalThis as unknown as Record<string, unknown>).__vmHud = {
    toast(kind: string, key: string, title: string, detail = '') {
      out.push({ kind, key, title, detail });
    },
  };
  return out;
}

/** Install a settings store exactly shaped like the one the shell publishes. */
function installSettings(tips: boolean): void {
  (globalThis as unknown as Record<string, unknown>).__vmSettings = {
    get: () => ({ gameplay: { tips } }),
  };
}

function clearHost(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__vmHud;
  delete g.__vmSettings;
  delete g.__vmTutorial;
}

const REPLAY: ReplayFile = {
  header: {
    formatVersion: REPLAY_FORMAT_VERSION,
    buildVersion: 'test',
    mapSeed: 1, simSeed: 2,
    mapPreset: 'temperate', biome: 'grass', art: 'noon', start: 'base',
    scenario: 'base', localPlayer: 0,
    players: [
      { faction: Faction.Allies, isHuman: true, aiDifficulty: 0, aiPersonality: 0, credits: 10000 },
      { faction: Faction.Soviets, isHuman: false, aiDifficulty: 1, aiPersonality: 0, credits: 10000 },
    ],
  } satisfies ReplayHeader,
  commands: [],
  checks: [],
};

/* ==========================================================================
 * 1. THE TIP IS TRUE
 *
 * Both halves of the string are claims about shipped code, and this is where
 * they are re-derived rather than trusted. The corpus survey found
 * three of six spot-checked candidate tips were wrong about their own facts;
 * the digit ban deletes the arithmetic class of that error and this deletes
 * the ordering class.
 * ========================================================================== */

describe('the brownout tip says something true about this build', () => {
  it('defences really are shed before the economy', () => {
    expect(POWER_SHED_ORDER.defence).toBeLessThan(POWER_SHED_ORDER.refinery);
    expect(POWER_SHED_ORDER.defence).toBeLessThan(POWER_SHED_ORDER.factory);
    // Lowest goes dark first, and defence is the floor of the whole table.
    const classes = [
      POWER_SHED_ORDER.radar, POWER_SHED_ORDER.tech,
      POWER_SHED_ORDER.factory, POWER_SHED_ORDER.refinery, POWER_SHED_ORDER.never,
    ];
    for (const c of classes) expect(POWER_SHED_ORDER.defence).toBeLessThan(c);
  });

  /**
   * "A power plant is the way out" is only true because the route cannot close
   * behind you: `shedPriority` answers `never` for `EntityFlag.IsBuilder`, so a
   * Construction Yard cannot be darkened, and `Production.census` exempts the
   * Structures tab from the blackout gate. A plant is buildable from any
   * brownout however deep.
   */
  it('the Construction Yard is in the class that is never shed', () => {
    expect(POWER_SHED_ORDER.never).toBeGreaterThan(POWER_SHED_ORDER.refinery);
  });

  it('a power plant is a Structures-tab entry with positive power', async () => {
    const catalog = new ProductionCatalog(await resolveDefBinding());
    for (const key of ['powerPlant', 'mrdSolarArray', 'rclFurnace']) {
      const e = catalog.byKey(key);
      expect(e, key).not.toBeNull();
      expect(e!.power, key).toBeGreaterThan(0);
      expect(e!.tab, key).toBe(BuildTab.Structures);
    }
  });
});

/* ==========================================================================
 * 2. THE TRIGGER
 * ========================================================================== */

describe('tips.system — the brownout trigger', () => {
  let rig: Rig;
  let toasts: Toast[];

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    toasts = captureToasts();
    installSettings(true);
    tipsSystem.init?.();
  });

  afterEach(() => {
    tipsSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
    setCampaignOutcomePolicy(null);
    preparePlayback(null);
    clearHost();
  });

  const tips = (): Toast[] => toasts.filter((t) => t.key.startsWith('tip.'));

  it('the fixture really is a brownout', () => {
    brownoutBase(rig);
    step(rig, 2);
    const p = rig.world.player(P0);
    expect(p.powerConsumed, 'the base must draw more than it makes').toBeGreaterThan(p.powerProduced);
  });

  it('says nothing before the hold has run', () => {
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS - TIP_SURVEY_INTERVAL);
    expect(tips()).toEqual([]);
  });

  it('posts the tip once the brownout has held fifteen seconds', () => {
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS + TIP_SURVEY_INTERVAL);
    expect(tips()).toHaveLength(1);
    expect(tips()[0].title).toBe(TIP_BROWNOUT.title);
    expect(tips()[0].detail).toBe(TIP_BROWNOUT.detail);
    expect(tips()[0].kind).toBe('info');
  });

  it('says it once per match, not once every fifteen seconds', () => {
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 4);
    expect(tips()).toHaveLength(1);
  });

  /**
   * THE FALSIFIER FOR THE HOLD. A healthy grid never reaches the tip however
   * long the match runs, so the case above is measuring the brownout rather
   * than merely the passage of time.
   */
  it('never fires on a base that has enough power', () => {
    healthyBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 3);
    const p = rig.world.player(P0);
    expect(p.powerConsumed).toBeLessThanOrEqual(p.powerProduced);
    expect(tips()).toEqual([]);
  });

  /**
   * CONTINUOUS, not cumulative. Fourteen seconds of brownout, the lights come
   * back, and the clock starts again from zero — which is the difference
   * between "you are in trouble" and "you have been in trouble twice".
   */
  it('resets the clock when power comes back', () => {
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS - TIP_SURVEY_INTERVAL * 2);
    expect(tips()).toEqual([]);

    const plant = building(rig, 'powerPlant', 112, 40);
    const extra = building(rig, 'powerPlant', 124, 40);
    step(rig, TIP_SURVEY_INTERVAL * 4);
    expect(tips(), 'the deficit is gone, so the hold is void').toEqual([]);

    // Blow both replacements up and the clock has to run the full fifteen
    // seconds again from here.
    rig.world.store.markDead(plant);
    rig.world.store.markDead(extra);
    rig.world.store.flushDestroyed();
    step(rig, BROWNOUT_HOLD_TICKS - TIP_SURVEY_INTERVAL * 2);
    expect(tips(), 'a fresh brownout gets a fresh clock').toEqual([]);
    step(rig, TIP_SURVEY_INTERVAL * 3);
    expect(tips()).toHaveLength(1);
  });

  /**
   * LOCAL PLAYER ONLY. The opponent's base is blacked out and nothing is said,
   * because a tip is advice to the person holding the mouse. It is also what
   * makes the module safe in PvP: nothing here reads a fact a peer does not
   * have about themselves.
   */
  it('ignores an opponent in brownout', () => {
    const p1 = 1 as PlayerId;
    building(rig, 'conyard', 200, 200, p1);
    building(rig, 'powerPlant', 212, 200, p1);
    building(rig, 'refinery', 224, 200, p1);
    building(rig, 'warFactory', 236, 200, p1);
    building(rig, 'barracks', 248, 200, p1);
    building(rig, 'radar', 260, 200, p1);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    const foe = rig.world.player(p1);
    expect(foe.powerConsumed).toBeGreaterThan(foe.powerProduced);
    expect(tips()).toEqual([]);
  });

  /** Nothing about this module touches the world. */
  it('writes nothing to the simulation', () => {
    brownoutBase(rig);
    const before = rig.world.store.aliveCount;
    const credits = rig.world.player(P0).credits;
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips()).toHaveLength(1);
    expect(rig.world.store.aliveCount).toBe(before);
    expect(rig.world.player(P0).credits).toBe(credits);
  });
});

/* ==========================================================================
 * 3. THE ACCEPTANCE TEST THE SPEC WROTE FOR ITSELF
 *
 * *"If that tip fires while the player is already dragging a Power Plant onto
 * the ground, the feature has failed for nothing."*
 *
 * IT DOES, AND THIS IS THE MEASUREMENT. `powerPlant` is `buildTime: 8`, and
 * `BuildQueue.advanceTab` divides that by `player.buildSpeedMul`, which
 * `PowerGrid` drives down toward `POWER_BLACKOUT_MUL` 0.25 as the deficit
 * deepens — the shortage that caused the brownout is what slows the cure. Then
 * placement, then `CONSTRUCTION_RISE_SECONDS`. So a player who reacts on the
 * FIRST tick of the brownout is still mid-answer at fifteen seconds.
 *
 * The first case below measures that with the tip module out of the picture,
 * so it is a fact about the game and not about this feature. The second and
 * third are the gate.
 * ========================================================================== */

describe('the player who is already answering', () => {
  let rig: Rig;
  let toasts: Toast[];

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    toasts = captureToasts();
    installSettings(true);
    tipsSystem.init?.();
  });

  afterEach(() => {
    tipsSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
    clearHost();
  });

  const tips = (): Toast[] => toasts.filter((t) => t.key.startsWith('tip.'));

  /**
   * THE NUMBER THAT JUSTIFIES THE GATE. No assertion about tips at all: this
   * one measures the game. Queue a plant on the brownout's first tick, run the
   * hold, and look at what the player is holding when the tip would fire.
   */
  it('is still holding an unplaced Power Plant when the hold expires', () => {
    brownoutBase(rig);
    rig.world.player(P0).credits = 10_000;
    step(rig, 1);
    rig.production.enqueueByKey(P0, 'powerPlant');
    step(rig, BROWNOUT_HOLD_TICKS);

    const q = rig.world.player(P0).queues[BuildTab.Structures as number];
    expect(q.items.length, 'the plant is still in the queue at fifteen seconds').toBe(1);
    // AND IT IS FINISHED AND UNPLACED — the reported failure case verbatim,
    // "already dragging a Power Plant onto the ground". The drip is 8 s of
    // `buildTime` divided by a `buildSpeedMul` of 0.75 on this fixture's
    // deficit, so it lands at about eleven seconds and then waits for a click.
    expect(q.items[0].ready, 'finished, in the player\'s hand, waiting for ground').toBe(true);
    expect(q.awaitingPlacement).toBe(true);
    const p = rig.world.player(P0);
    expect(p.powerConsumed, 'and the brownout has not lifted').toBeGreaterThan(p.powerProduced);
  });

  it('is not told to build a power plant while one is in the queue', () => {
    brownoutBase(rig);
    rig.world.player(P0).credits = 10_000;
    step(rig, 1);
    rig.production.enqueueByKey(P0, 'powerPlant');
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips(), 'they are already doing the thing the tip asks for').toEqual([]);
  });

  /**
   * THE FALSIFIER, AND IT IS THE ONE THAT MATTERS. Cancel the plant and the
   * tip arrives — so the silence above is the gate working rather than the
   * trigger being broken by the extra credits or the extra queue traffic.
   */
  it('speaks the moment they abandon the answer', () => {
    brownoutBase(rig);
    rig.world.player(P0).credits = 10_000;
    step(rig, 1);
    rig.production.enqueueByKey(P0, 'powerPlant');
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips()).toEqual([]);

    const plant = rig.production.catalog.byKey('powerPlant')!;
    rig.production.cancel(P0, plant.publicId, -1, true);
    step(rig, TIP_SURVEY_INTERVAL * 2);
    expect(tips(), 'the hold already ran; only the gate was holding it back').toHaveLength(1);
  });

  /**
   * The second pass of the gate. Between leaving the queue and making power a
   * plant spends `CONSTRUCTION_RISE_SECONDS` rising, and during those two
   * seconds it is in neither the queue nor the grid — `PowerGrid.recompute`'s
   * pass 1 skips it explicitly, so a half-built reactor supplies nothing.
   *
   * THE HOLD IS RUN TO ONE SURVEY SHORT FIRST, deliberately. The rise is two
   * seconds and the hold is fifteen, so a plant seeded at tick zero would be
   * finished long before the tip is due and this would be measuring nothing.
   */
  it('is not told while the plant is still rising', () => {
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS - TIP_SURVEY_INTERVAL);
    expect(tips()).toEqual([]);

    const entry = rig.production.catalog.byKey('powerPlant')!;
    rig.production.spawnBuilding(rig.world.player(P0), entry, 112, 40, 0.5);
    step(rig, TIP_SURVEY_INTERVAL);
    expect(rising(rig), 'the fixture must have something under construction').toBe(1);
    expect(tips()).toEqual([]);
  });

  /**
   * THE FALSIFIER FOR THAT PASS. The identical sequence with a BARRACKS rising
   * instead posts the tip — so the gate keys on `entry.power > 0` and not on
   * "this player has a building site".
   */
  it('a rising barracks is not an answer to a brownout', () => {
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS - TIP_SURVEY_INTERVAL);
    expect(tips()).toEqual([]);

    const entry = rig.production.catalog.byKey('barracks')!;
    rig.production.spawnBuilding(rig.world.player(P0), entry, 112, 40, 0.5);
    step(rig, TIP_SURVEY_INTERVAL);
    expect(rising(rig)).toBe(1);
    expect(tips()).toHaveLength(1);
  });
});

/* ==========================================================================
 * 4. THE SURFACE — TWO BUDGETS, NOT ONE, AND BOTH MEASURED IN A BROWSER
 *
 * The original surface survey quotes the CSS: both lines are
 * `white-space: nowrap` + `text-overflow: ellipsis` at
 * `font-size: calc(10 * var(--vm-u))` inside `.vm-toasts { max-width: calc(250
 * * var(--vm-u)) }`. Reasoning from that — 250 less 22 of padding, 13 of icon
 * and 8 of gap — gives 207 design units and ONE budget of about forty-three
 * characters for both lines.
 *
 * THAT IS WRONG, AND IT IS WRONG IN A DIRECTION THAT SHIPS A CLIPPED TITLE.
 * `.vm-toast-title` inherits `text-transform: uppercase`, weight 600 and
 * `letter-spacing: 0.18em`; the detail is as authored, weight 400, 0.02em. So
 * one box holds two very different amounts of prose. Measured in Chromium at
 * 1280x720 with `--vm-u: 1px` and Rajdhani loaded, text box 203 px, by growing
 * an ordinary English sentence until `scrollWidth > clientWidth`:
 *
 *     title    26 characters      detail    44 characters
 *
 * The 44 is the figure `orecrisis.system.ts` records having found live ("about
 * 45 characters") — that chip's long line is its DETAIL, which is why the
 * error survived until somebody put a sentence in a TITLE.
 *
 * THE NUMBERS BELOW ARE THE MEASUREMENT, NOT A DERIVATION, and the first draft
 * of this file had the derivation instead: a single `CHIP_CHARS = 43` that
 * cheerfully passed a thirty-six-character title which renders 300 px wide in
 * a 203 px box. Re-measure rather than re-derive if the chip's type changes;
 * the ratio is scale-invariant, because the box and the type are both
 * multiples of `--vm-u`.
 * ========================================================================== */

describe('the tip surface', () => {
  /** Measured, not derived. See the section header. */
  const TITLE_CHARS = 26;
  const DETAIL_CHARS = 44;

  it('both lines are inside their own measured budget', () => {
    expect(TIP_BROWNOUT.title.length, 'uppercase and tracked — half the room')
      .toBeLessThanOrEqual(TITLE_CHARS);
    expect(TIP_BROWNOUT.detail.length).toBeLessThanOrEqual(DETAIL_CHARS);
  });

  it('namespaces tips into the wider wrapping chip without widening events', () => {
    const chrome = readFileSync(join(import.meta.dirname, '../src/ui/Chrome.ts'), 'utf8');
    const css = readFileSync(join(import.meta.dirname, '../src/ui/hud.css'), 'utf8');
    expect(chrome).toContain("key.startsWith('tip.') ? ' is-tip' : ''");
    expect(css).toMatch(/\.vm-hud \.vm-toast\.is-tip\s*\{[^}]*width:\s*calc\(330 \* var\(--vm-u\)\)/s);
    expect(css).toMatch(/\.vm-toast\.is-tip \.vm-toast-detail\s*\{[^}]*white-space:\s*normal/s);
    expect(css).toMatch(/\.vm-toast\.is-tip \.vm-toast-detail\s*\{[^}]*-webkit-line-clamp:\s*3/s);
  });

  /**
   * THE FALSIFIER, AND IT IS A REAL ONE. Two strings that nearly shipped.
   *
   * The spec's authored draft is one sentence of seventy-one characters —
   * *"Your defences go dark before your economy does. A plant is the way
   * out."* — 337 px, fitting neither line. And this file's own first title,
   * *"Defences go dark before your economy"*, is 300 px against the title's
   * 203 px box: it passed a single shared budget of 43 and would have been
   * drawn as "DEFENCES GO DARK BEFORE YOUR E…".
   */
  it('the two clipped drafts are refused by the budget that replaced them', () => {
    const sentence = 'Your defences go dark before your economy does. A plant is the way out.';
    expect(sentence.length).toBeGreaterThan(DETAIL_CHARS);
    const firstTitle = 'Defences go dark before your economy';
    expect(firstTitle.length).toBeGreaterThan(TITLE_CHARS);
    // …and it is under the single 43-character budget that let it through.
    expect(firstTitle.length).toBeLessThanOrEqual(43);
  });

  /** The detail leads with the verb, which is the whole instruction. */
  it('the detail line starts with what to do', () => {
    expect(TIP_BROWNOUT.detail.startsWith('Build ')).toBe(true);
  });

  /** The dedupe key is namespaced, so no tip can ever collide with an alert. */
  it('posts under a namespaced key', () => {
    installSettings(true);
    const toasts = captureToasts();
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(toasts[0].key).toBe('tip.brownout');
    clearHost();
  });
});

/* ==========================================================================
 * 5. THE TOGGLE, BY DELETION
 *
 * `gameplay.tips` had to arrive WITH its reader or be the fifth settings row
 * nothing consumes. This is the proof that it is read: the identical fixture
 * that posts a tip in §2 posts nothing with the row turned off.
 * ========================================================================== */

describe('gameplay.tips', () => {
  let rig: Rig;
  let toasts: Toast[];

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    toasts = captureToasts();
    tipsSystem.init?.();
  });

  afterEach(() => {
    tipsSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
    clearHost();
  });

  it('posts nothing when the player has turned tips off', () => {
    installSettings(false);
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(toasts.filter((t) => t.key.startsWith('tip.'))).toEqual([]);
  });

  it('posts with the row on — the same fixture, one field apart', () => {
    installSettings(true);
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(toasts.filter((t) => t.key.startsWith('tip.'))).toHaveLength(1);
  });

  /**
   * A store that exists but predates the row is not a request for tips. The
   * shipped `normalizeSettings` fills the default in before anything reads it;
   * this is the belt to that brace, and it is the reason the read is
   * `=== true` rather than `?? true`.
   */
  it('treats a store with no such field as off', () => {
    (globalThis as unknown as Record<string, unknown>).__vmSettings = { get: () => ({ gameplay: {} }) };
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(toasts.filter((t) => t.key.startsWith('tip.'))).toEqual([]);
  });
});

/* ==========================================================================
 * 6. SUPPRESSION
 *
 * IN THE POST FUNCTION, NEVER AT A CALL SITE. `CLAUDE.md`'s `beginMatch`
 * section is the reason: a nine-line carve-out in `Shell.startMatch` did
 * nothing for every shipped build because a second caller reached the same
 * code one frame later. So every case here drives the REAL module through a
 * real brownout — never `postTip` on its own — because a test that asks
 * whether the caller skipped a call passes against exactly that defect.
 *
 * THREE PREDICATES, NOT FOUR. PvP is deliberately not one of them
 * (the suppression contract in `tips.system.ts`), and the last case pins that so nobody "fixes" it
 * back on the assumption that a suppression list should be as long as
 * possible.
 * ========================================================================== */

describe('scripted content silences tips', () => {
  let rig: Rig;
  let toasts: Toast[];

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    toasts = captureToasts();
    installSettings(true);
    tipsSystem.init?.();
  });

  afterEach(() => {
    tipsSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
    setCampaignOutcomePolicy(null);
    preparePlayback(null);
    clearHost();
  });

  const tips = (): Toast[] => toasts.filter((t) => t.key.startsWith('tip.'));

  it('is silent inside a campaign operation', () => {
    setCampaignOutcomePolicy({ annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] });
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips(), 'an operation authors its own guidance').toEqual([]);
  });

  it('is silent while a replay is driving the match', () => {
    preparePlayback(REPLAY);
    adoptPreparedPlayback();
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips(), 'a recording is not the viewer\'s match to advise on').toEqual([]);
  });

  it('is silent while the tutorial is talking', () => {
    (globalThis as unknown as Record<string, unknown>).__vmTutorial = { step: 0 };
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips(), 'the tutorial is already saying something').toEqual([]);
  });

  /**
   * THE FALSIFIERS FOR ALL THREE. Clearing each latch lets the identical
   * fixture through, so the silence above is the predicate rather than a rig
   * that never posts anything.
   */
  it('speaks again once the campaign latch is cleared', () => {
    setCampaignOutcomePolicy({ annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] });
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips()).toEqual([]);
    setCampaignOutcomePolicy(null);
    step(rig, TIP_SURVEY_INTERVAL * 2);
    expect(tips()).toHaveLength(1);
  });

  it('speaks again once playback is detached', () => {
    preparePlayback(REPLAY);
    adoptPreparedPlayback();
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips()).toEqual([]);
    preparePlayback(null);
    step(rig, TIP_SURVEY_INTERVAL * 2);
    expect(tips()).toHaveLength(1);
  });

  it('speaks again once the tutorial hands the session back', () => {
    (globalThis as unknown as Record<string, unknown>).__vmTutorial = { step: 0 };
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips()).toEqual([]);
    delete (globalThis as unknown as Record<string, unknown>).__vmTutorial;
    step(rig, TIP_SURVEY_INTERVAL * 2);
    expect(tips()).toHaveLength(1);
  });

  /**
   * PvP IS NOT ON THE LIST, AND THAT WAS A DECISION. Two surveys assumed
   * opposite answers in silence; the suppression contract decided ON. A tip is
   * local-only DOM that cannot desync, and the player most likely to want
   * ore-crisis-shaped advice is the one being beaten by a person. This case
   * exists so the decision has to be re-argued rather than quietly reversed.
   */
  it('does NOT consult any multiplayer predicate', () => {
    // A PvP match differs from this fixture in exactly one way: `net.system.ts`
    // holds a session. Nothing in the module can see that, and asserting it on
    // the SOURCE is the only honest form of the claim — a fake global would
    // prove that a predicate nobody wrote does not fire.
    const src = readFileSync(join(process.cwd(), 'apps/game/src', 'sim', 'tips.system.ts'), 'utf8');
    expect(src).not.toContain('activeSession');
    expect(src).not.toContain('net.system');
    // And the ordinary skirmish it would otherwise be still posts.
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(tips()).toHaveLength(1);
  });
});

/* ==========================================================================
 * 7. INERTNESS — AND IT IS THE INVERSION THAT IS BEING TESTED
 *
 * `src/ui/Hud.ts` and `src/input/input.system.ts` both read `__vmSettings` and
 * FALL BACK TO THE DEFAULT when it is absent, which is right for them. It is
 * wrong here: `gameplay.tips` defaults to `true`, so the same idiom makes a
 * shell-less boot — the `?shot=` harness, a headless test, a dedicated
 * server — default to SHOWING tips. That is the no-shell trap documented in `tips.system.ts`
 * and nobody had written the inversion down.
 * ========================================================================== */

describe('a boot with no shell is silent', () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    tipsSystem.init?.();
  });

  afterEach(() => {
    tipsSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
    clearHost();
  });

  it('posts nothing when there is no settings store', () => {
    const toasts = captureToasts();
    delete (globalThis as unknown as Record<string, unknown>).__vmSettings;
    brownoutBase(rig);
    step(rig, BROWNOUT_HOLD_TICKS * 2);
    expect(toasts, 'absence is OFF, not the default').toEqual([]);
  });

  it('does not throw when there is no HUD', () => {
    installSettings(true);
    delete (globalThis as unknown as Record<string, unknown>).__vmHud;
    brownoutBase(rig);
    expect(() => step(rig, BROWNOUT_HOLD_TICKS * 2)).not.toThrow();
  });

  /**
   * A store that throws is also OFF. The shell publishes a live object and a
   * torn-down one can reject a read mid-match; a tip is not worth an exception
   * inside `simTick`.
   */
  it('survives a settings store that throws', () => {
    (globalThis as unknown as Record<string, unknown>).__vmSettings = {
      get: () => { throw new Error('torn down'); },
    };
    captureToasts();
    brownoutBase(rig);
    expect(() => step(rig, BROWNOUT_HOLD_TICKS * 2)).not.toThrow();
    expect(tipsPosted).toBe(0);
  });
});
