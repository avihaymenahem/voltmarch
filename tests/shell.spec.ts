/**
 * SHELL — the falsifiable half.
 *
 * Everything in `src/shell/**` that does not need a DOM: settings migration and
 * clamping, the keybind conflict detector, the match-query builder and the
 * store's persistence and diffing. The suite runs under `environment: 'node'`
 * like the rest of the repo, so `settings-store.ts` deliberately imports
 * nothing from the engine and nothing from the document — these tests are the
 * reason that constraint exists.
 *
 * The classes that DO build DOM (Shell, the five screens) are not exercised
 * here; they are covered by booting the page, which is the screenshot
 * harness's job.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defaultCameraCodes } from '../src/input/ActionCatalogue';
import { MAP_SEAS } from '../src/game/Scenarios';

import {
  CREDIT_OPTIONS,
  DIFFICULTIES,
  KEYBINDS,
  MANAGED_FLAGS,
  MAPS,
  MAX_ARMIES,
  PERSONALITIES,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  SETUP_STORAGE_KEY,
  SPEEDS,
  SettingsStore,
  armyCount,
  buildMatchQuery,
  chordEquals,
  chordLabel,
  cloneSetup,
  codeLabel,
  conflictingIds,
  controllerLabel,
  defaultBindings,
  defaultSettings,
  defaultSetup,
  diffSettings,
  findConflicts,
  isBindableCode,
  keybindCategories,
  mapById,
  memoryStorage,
  normalizeSettings,
  normalizeSetup,
  opponentChips,
  rollSeed,
  touched,
  withArmyCount,
  type Chord,
  type OpponentSummary,
  type StorageLike,
} from '../src/shell/settings-store';

/* ========================================================================== */

describe('settings — normalisation is total', () => {
  it('returns a complete settings object for any garbage', () => {
    for (const junk of [null, undefined, 0, 'nope', [], true, { graphics: 7 }]) {
      const s = normalizeSettings(junk);
      expect(s.graphics.tier).toBe('auto');
      expect(s.audio.master).toBeGreaterThan(0);
      expect(Object.keys(s.controls.bindings).length).toBe(KEYBINDS.length);
    }
  });

  it('clamps out-of-range numbers instead of accepting them', () => {
    const s = normalizeSettings({
      audio: { master: 4000, music: -12 },
      graphics: { resolutionScale: 99, fov: 1 },
      gameplay: { panSpeed: -5, zoomToCursor: 8 },
    });
    expect(s.audio.master).toBe(100);
    expect(s.audio.music).toBe(0);
    expect(s.graphics.resolutionScale).toBe(2);
    expect(s.graphics.fov).toBe(24);
    expect(s.gameplay.panSpeed).toBe(10);
    expect(s.gameplay.zoomToCursor).toBe(1);
  });

  it('replaces NaN with the default rather than storing it', () => {
    const s = normalizeSettings({ audio: { sfx: NaN }, graphics: { fov: Number.POSITIVE_INFINITY } });
    expect(s.audio.sfx).toBe(defaultSettings().audio.sfx);
    expect(s.graphics.fov).toBe(defaultSettings().graphics.fov);
  });

  it('keeps the zoom limits ordered whatever it is handed', () => {
    const s = normalizeSettings({ graphics: { minZoom: 200, maxZoom: 40 } });
    expect(s.graphics.minZoom).toBeLessThan(s.graphics.maxZoom);
  });

  it('drops unknown keybind ids and fills missing ones from the defaults', () => {
    const s = normalizeSettings({
      controls: { bindings: { 'ord.stop': { code: 'KeyK', ctrl: false, shift: false, alt: false }, 'gone.away': { code: 'KeyP' } } },
    });
    expect(s.controls.bindings['ord.stop'].code).toBe('KeyK');
    expect(s.controls.bindings['gone.away']).toBeUndefined();
    expect(s.controls.bindings['cam.panUp'].code).toBe('ArrowUp');
  });

  it('migrates an untouched v1 WASD pan scheme onto the arrows', () => {
    const v1 = {
      version: 1,
      controls: {
        bindings: {
          'cam.panUp': { code: 'KeyW', ctrl: false, shift: false, alt: false },
          'cam.panDown': { code: 'KeyS', ctrl: false, shift: false, alt: false },
          'cam.panLeft': { code: 'KeyA', ctrl: false, shift: false, alt: false },
          'cam.panRight': { code: 'KeyD', ctrl: false, shift: false, alt: false },
        },
      },
    };
    const s = normalizeSettings(v1);
    expect(s.controls.bindings['cam.panUp'].code).toBe('ArrowUp');
    expect(s.controls.bindings['cam.panRight'].code).toBe('ArrowRight');
    // Every load stamps the CURRENT version, whichever migrations ran. Pinned
    // against the constant rather than a literal, so bumping the schema does
    // not send someone hunting through the keybind migration.
    expect(s.version).toBe(SETTINGS_VERSION);
  });

  it('leaves a v1 pan scheme alone once the player has touched it', () => {
    // One row changed means the group is the player's, not the old default.
    const s = normalizeSettings({
      version: 1,
      controls: {
        bindings: {
          'cam.panUp': { code: 'KeyW', ctrl: false, shift: false, alt: false },
          'cam.panDown': { code: 'KeyS', ctrl: false, shift: false, alt: false },
          'cam.panLeft': { code: 'KeyA', ctrl: false, shift: false, alt: false },
          'cam.panRight': { code: 'KeyL', ctrl: false, shift: false, alt: false },
        },
      },
    });
    expect(s.controls.bindings['cam.panUp'].code).toBe('KeyW');
    expect(s.controls.bindings['cam.panRight'].code).toBe('KeyL');
  });

  it('does not re-run the v2 migration on an already-migrated blob', () => {
    // A v2 player who deliberately chose WASD keeps it across every later load.
    const chosen = {
      version: 2,
      controls: {
        bindings: {
          'cam.panUp': { code: 'KeyW', ctrl: false, shift: false, alt: false },
          'cam.panDown': { code: 'KeyS', ctrl: false, shift: false, alt: false },
          'cam.panLeft': { code: 'KeyA', ctrl: false, shift: false, alt: false },
          'cam.panRight': { code: 'KeyD', ctrl: false, shift: false, alt: false },
        },
      },
    };
    const once = normalizeSettings(chosen);
    expect(once.controls.bindings['cam.panUp'].code).toBe('KeyW');
    expect(normalizeSettings(once).controls.bindings['cam.panUp'].code).toBe('KeyW');
  });

  it('refuses a binding on a key the browser owns', () => {
    const s = normalizeSettings({ controls: { bindings: { 'ord.stop': { code: 'F5' } } } });
    expect(s.controls.bindings['ord.stop'].code).toBe('KeyS');
    expect(isBindableCode('F5')).toBe(false);
    expect(isBindableCode('ShiftLeft')).toBe(false);
    expect(isBindableCode('KeyS')).toBe(true);
  });
});

/* ========================================================================== */

describe('keybinds', () => {
  it('ships with no conflicts', () => {
    expect(findConflicts(defaultBindings())).toEqual([]);
  });

  it('does not flag a key shared between the camera and order surfaces', () => {
    const b = defaultBindings();
    // The SHIPPED scheme no longer overlaps — pan is on the arrows precisely so
    // that holding a pan key cannot also arm an order (see KEYBINDS). But a
    // player is still allowed to put pan-left back on KeyA, and when they do it
    // must not be reported as a conflict: two keyboard surfaces, one physical
    // key, and that is deliberate.
    expect(b['cam.panLeft'].code).toBe('ArrowLeft');
    expect(b['ord.attackMove'].code).toBe('KeyA');

    b['cam.panLeft'] = { code: 'KeyA', ctrl: false, shift: false, alt: false };
    expect(conflictingIds(b).size).toBe(0);
  });

  it('the shipped camera pan scheme is what the engine actually polls', () => {
    // This used to grep `input.system.ts` for a hard-coded DEFAULT_CAMERA_KEYS
    // literal, because that file could not import the shell (a `?shot=` boot
    // never loads that chunk) and therefore kept a second copy of these codes.
    // The copy is gone: the engine now derives its table from
    // `src/input/ActionCatalogue.ts`, which has no imports at all, so the
    // agreement can be asserted on real values instead of on source text.
    // `tests/action-catalogue.spec.ts` owns the rest of that contract.
    const b = defaultBindings();
    const codes = defaultCameraCodes();
    for (const id of ['cam.panUp', 'cam.panDown', 'cam.panLeft', 'cam.panRight',
      'cam.rotateLeft', 'cam.rotateRight']) {
      expect(codes[id], id).toBe(b[id].code);
    }
  });

  it('flags both sides of a real conflict', () => {
    const b = defaultBindings();
    b['ord.guard'] = { ...b['ord.stop'] };
    const ids = conflictingIds(b);
    expect(ids.has('ord.guard')).toBe(true);
    expect(ids.has('ord.stop')).toBe(true);
  });

  it('treats a global binding as conflicting with every surface', () => {
    const b = defaultBindings();
    b['sys.perf'] = { code: 'KeyG', ctrl: false, shift: false, alt: false };
    const ids = conflictingIds(b);
    expect(ids.has('sys.perf')).toBe(true);
    expect(ids.has('ord.guard')).toBe(true);
  });

  it('ignores unbound commands', () => {
    const b = defaultBindings();
    b['ord.guard'] = { code: '', ctrl: false, shift: false, alt: false };
    b['ord.scatter'] = { code: '', ctrl: false, shift: false, alt: false };
    // Two commands sharing "no key" is not two commands sharing a key.
    expect(findConflicts(b)).toEqual([]);
  });

  it('does not offer a command the engine cannot reach', () => {
    // The shell claims Escape for the pause menu in the capture phase, so the
    // engine's own Escape handling never fires during a match. See KEYBINDS.
    expect(KEYBINDS.some((k) => k.id === 'sel.clear')).toBe(false);
    expect(KEYBINDS.find((k) => k.id === 'sys.menu')?.def.code).toBe('Escape');
  });

  it('distinguishes chords by modifier', () => {
    const plain: Chord = { code: 'KeyA', ctrl: false, shift: false, alt: false };
    const withCtrl: Chord = { code: 'KeyA', ctrl: true, shift: false, alt: false };
    expect(chordEquals(plain, withCtrl)).toBe(false);
    expect(chordEquals(plain, { ...plain })).toBe(true);
  });

  it('labels codes by physical key, not by layout', () => {
    expect(codeLabel('KeyW')).toBe('W');
    expect(codeLabel('Digit4')).toBe('4');
    expect(codeLabel('ArrowLeft')).toBe('Left Arrow');
    expect(codeLabel('Escape')).toBe('Esc');
    expect(chordLabel({ code: 'KeyA', ctrl: true, shift: true, alt: false })).toBe('CTRL + SHIFT + A');
    expect(chordLabel({ code: '', ctrl: false, shift: false, alt: false })).toBe('UNBOUND');
  });

  it('groups every binding under a declared category', () => {
    const categories = keybindCategories();
    for (const k of KEYBINDS) expect(categories).toContain(k.category);
  });
});

/* ========================================================================== */

describe('match setup', () => {
  /*
   * THIS TEST USED TO ASSERT THE OPPOSITE, and it was pinning a rule rather
   * than a requirement: "never lets the opponent mirror the player", against
   * two lines that moved `aiFaction` off the player's own side.
   *
   * The rule is deleted (see `normalizeSetup`) and this is rewritten rather
   * than removed, because the interesting half of it survives: the setup that
   * comes out has to be the setup that was ASKED FOR. What changed is that a
   * mirror is now one of the things a player is allowed to ask for — the reason
   * the rule existed (a mirror handed both scripted bases to one player) was
   * fixed in `ScenarioBuilder`, and with four seats over four factions a
   * no-repeat rule is not satisfiable in general anyway.
   *
   * Both halves are falsifiers: restore the rule and the first two expectations
   * fail; leave the rule out but let the mirror leak past `opponents[0]` and the
   * third fails.
   */
  it('lets a player fight their own side — a mirror is a legitimate match', () => {
    const setup = normalizeSetup({ playerFaction: 'soviets', aiFaction: 'soviets' }, ['allies', 'soviets']);
    expect(setup.playerFaction).toBe('soviets');
    expect(setup.aiFaction).toBe('soviets');
    // The mirror fields and `opponents[0]` are one fact, so the army list must
    // carry the mirror too — a lobby that painted Soviets and booted Allies is
    // the defect the deleted rule actually was.
    expect(setup.opponents[0].faction).toBe('soviets');
  });

  it('mirrors every seat when that is what was stored, not only seat 0', () => {
    const roster = ['allies', 'soviets', 'meridian', 'reclaim'];
    const setup = normalizeSetup({
      playerFaction: 'reclaim',
      aiFaction: 'reclaim',
      map: 'sunder-atoll',
      opponents: [
        { faction: 'reclaim', difficulty: 1, personality: -1 },
        { faction: 'reclaim', difficulty: 1, personality: -1 },
        { faction: 'reclaim', difficulty: 1, personality: -1 },
      ],
    }, roster);
    // Seats 1 and 2 could ALREADY mirror the player before this change —
    // `normalizeOpponent` only ever clamped a faction to the roster — which is
    // why the old rule was incoherent rather than merely strict.
    expect(setup.opponents.map((o) => o.faction)).toEqual(['reclaim', 'reclaim', 'reclaim']);
  });

  it('accepts a faction it has never heard of only if the roster names it', () => {
    const known = normalizeSetup({ playerFaction: 'empire' }, ['allies', 'soviets', 'empire']);
    expect(known.playerFaction).toBe('empire');
    const unknown = normalizeSetup({ playerFaction: 'empire' }, ['allies', 'soviets']);
    expect(unknown.playerFaction).toBe('allies');
  });

  it('clamps every index into its table', () => {
    const s = normalizeSetup({ difficulty: 99, personality: -50, speed: 12 }, ['allies', 'soviets']);
    expect(s.difficulty).toBe(DIFFICULTIES.length - 1);
    expect(s.personality).toBe(-1);
    expect(s.speed).toBe(SPEEDS.length - 1);
  });

  it('falls back to the first map for an unknown id', () => {
    expect(mapById('does-not-exist').id).toBe(MAPS[0].id);
    expect(mapById(MAPS[2].id).id).toBe(MAPS[2].id);
  });

  it('offers only credit amounts the lobby lists', () => {
    expect(CREDIT_OPTIONS).toContain(defaultSetup().startingCredits);
  });

  it('rolls a non-zero seed', () => {
    expect(rollSeed(() => 0)).toBe(1);
    expect(rollSeed(() => 0.5)).toBeGreaterThan(0);
    expect(Number.isInteger(rollSeed(() => 0.25))).toBe(true);
  });
});

/* ==========================================================================
 * FOUR ARMIES
 *
 * `MatchSetup` carried one opponent and every `MAPS` entry declared `players: 2`
 * with nothing reading the field, so the product could only ever set up a duel.
 * These are the falsifiable half of the fix: the shape, the migration, the map
 * ceiling, and the mirror that keeps a `voltmarch.setup.v1` blob written by an
 * older build loading unchanged.
 * ========================================================================== */

describe('free-for-all setup', () => {
  const ROSTER = ['allies', 'soviets', 'meridian', 'reclaim'];

  it('defaults to a 1v1 — a four-way is a choice, never a surprise', () => {
    const d = defaultSetup();
    expect(armyCount(d)).toBe(2);
    expect(d.opponents).toHaveLength(1);
    expect(d.opponents[0].faction).toBe(d.aiFaction);
  });

  it('migrates a stored setup that predates the army list', () => {
    // Exactly what an older build wrote: no `opponents` key at all.
    const legacy = {
      playerFaction: 'meridian', aiFaction: 'reclaim', map: MAPS[0].id,
      difficulty: 2, personality: 1, startingCredits: 5000, speed: 1, seed: 42,
    };
    const s = normalizeSetup(legacy, ROSTER);
    expect(armyCount(s)).toBe(2);
    expect(s.opponents).toEqual([{ faction: 'reclaim', difficulty: 2, personality: 1 }]);
    // …and every singular field it used to carry still says what it said.
    expect(s.playerFaction).toBe('meridian');
    expect(s.aiFaction).toBe('reclaim');
    expect(s.difficulty).toBe(2);
    expect(s.personality).toBe(1);
    expect(s.seed).toBe(42);
  });

  it('round-trips a four-way through storage', () => {
    const four = withArmyCount(
      { ...defaultSetup(), map: 'airbase-flats' }, 4, ROSTER,
    );
    expect(armyCount(four)).toBe(4);
    const back = normalizeSetup(JSON.parse(JSON.stringify(four)), ROSTER);
    expect(back.opponents).toEqual(four.opponents);
  });

  it('keeps the singular fields mirroring opponent one', () => {
    const s = normalizeSetup({
      playerFaction: 'allies', aiFaction: 'meridian', difficulty: 3, personality: 2,
      map: 'airbase-flats',
      opponents: [
        { faction: 'IGNORED', difficulty: 99, personality: 99 },
        { faction: 'reclaim', difficulty: 0, personality: -1 },
      ],
    }, ROSTER);
    // Entry 0 is rebuilt from the singular fields, not read from the array —
    // they are the half an older build and a save row can reach.
    expect(s.opponents[0]).toEqual({ faction: 'meridian', difficulty: 3, personality: 2 });
    expect(s.opponents[1]).toEqual({ faction: 'reclaim', difficulty: 0, personality: -1 });
  });

  it('clamps the army list to what the battlefield can seat', () => {
    const twoPlayerMap = MAPS.find((m) => m.players === 2);
    expect(twoPlayerMap).toBeDefined();
    const s = normalizeSetup({
      map: twoPlayerMap!.id,
      opponents: [
        { faction: 'soviets', difficulty: 1, personality: -1 },
        { faction: 'meridian', difficulty: 1, personality: -1 },
        { faction: 'reclaim', difficulty: 1, personality: -1 },
      ],
    }, ROSTER);
    expect(armyCount(s)).toBe(2);
  });

  it('reads MapChoice.players instead of declaring it and ignoring it', () => {
    // The regression this guards: every entry said 2, nothing read it, and the
    // lobby could not have offered a four-way if it had wanted to.
    expect(MAPS.some((m) => m.players >= 4)).toBe(true);
    expect(MAX_ARMIES).toBe(Math.max(...MAPS.map((m) => m.players)));
    for (const m of MAPS) expect(m.players).toBeGreaterThanOrEqual(2);
  });

  it('offers at least one four-army battlefield on a fresh profile', () => {
    // `SkirmishSetup.STARTER_MAPS` — a four-way gated behind a mission would be
    // a feature no new player can reach.
    const starters = ['temperate-valley', 'airbase-flats', 'sunder-atoll'];
    const open = MAPS.filter((m) => starters.includes(m.id));
    expect(open.length).toBe(3);
    expect(open.some((m) => m.players >= 4)).toBe(true);
    // ...and at least one of them has water, or the naval half of the build is
    // content a new player cannot reach. Both half-plane sea maps are gated.
    expect(open.some((m) => MAP_SEAS[m.preset] !== undefined)).toBe(true);
  });

  it('grows into unclaimed factions and shrinks from the end', () => {
    const base = { ...defaultSetup(), playerFaction: 'allies', map: 'airbase-flats' };
    const four = withArmyCount(base, 4, ROSTER);
    const sides = [four.playerFaction, ...four.opponents.map((o) => o.faction)];
    expect(new Set(sides).size).toBe(4);
    // Down and back up returns the same table, so flicking the row is not
    // destructive.
    const two = withArmyCount(four, 2, ROSTER);
    expect(two.opponents).toEqual(four.opponents.slice(0, 1));
    expect(withArmyCount(two, 4, ROSTER).opponents).toEqual(four.opponents);
  });

  it('never returns an empty army list', () => {
    expect(withArmyCount(defaultSetup(), 1, ROSTER).opponents.length).toBe(1);
    expect(withArmyCount(defaultSetup(), -5, ROSTER).opponents.length).toBe(1);
    expect(normalizeSetup({ opponents: [] }, ROSTER).opponents.length).toBe(1);
  });

  it('clones the army list rather than sharing it', () => {
    const a = withArmyCount(defaultSetup(), 3, ROSTER);
    const b = cloneSetup(a);
    b.opponents[1].difficulty = 3;
    expect(a.opponents[1].difficulty).not.toBe(3);
  });
});

/* ========================================================================== */

describe('boot flags with more than one AI', () => {
  const settings = defaultSettings();
  const ROSTER = ['allies', 'soviets', 'meridian', 'reclaim'];

  it('writes ?ai= when the whole table agrees', () => {
    const four = withArmyCount({ ...defaultSetup(), map: 'airbase-flats' }, 4, ROSTER);
    expect(buildMatchQuery(four, settings, '').get('ai'))
      .toBe(DIFFICULTIES[four.difficulty].toLowerCase());
  });

  /*
   * `sim/ai.system.ts#init` applies `?ai=` to EVERY non-human player — one
   * value, no slot — and it runs after the shell has written each army's own
   * difficulty onto its own PlayerState. So writing the flag for a mixed table
   * would flatten a Brutal and two Easies into three Brutals.
   */
  it('omits ?ai= when the armies were given different difficulties', () => {
    const four = withArmyCount({ ...defaultSetup(), map: 'airbase-flats' }, 4, ROSTER);
    four.opponents[1].difficulty = 0;
    four.opponents[2].difficulty = 3;
    expect(buildMatchQuery(four, settings, '').has('ai')).toBe(false);
    // And a 1v1 can never reach that branch, so its query is unchanged.
    expect(buildMatchQuery(defaultSetup(), settings, '').get('ai')).toBe('normal');
  });

  it('omits ?aip= when the armies were given different personalities', () => {
    const four = withArmyCount({ ...defaultSetup(), map: 'airbase-flats' }, 4, ROSTER);
    four.personality = 0;
    four.opponents[0].personality = 0;
    four.opponents[1].personality = 2;
    expect(buildMatchQuery(four, settings, '').has('aip')).toBe(false);
  });
});

/* ==========================================================================
 * THE END SCREEN'S OPPONENT CHIP
 *
 * It printed `MatchSetup.difficulty` — the mirror of opponent ONE — beside a
 * name string that listed EVERY hostile army. In a duel that is exactly true;
 * in a four-way it announces whichever setting happened to be seated first as
 * though it were the table's, and nothing on the screen gives it away.
 *
 * `opponentChips` lives in `settings-store.ts` rather than in `EndScreen.ts`
 * for the reason its own header gives: this is the shell module a node test can
 * import. `src/shell/EndScreen.ts` pulls `Shell.ts` and therefore three and the
 * whole engine — measured at over two minutes to transform, i.e. a timeout, so
 * a selector left in there could not be tested at all.
 * ========================================================================== */

describe('opponent chips', () => {
  const ai = (name: string, difficulty: number): OpponentSummary =>
    ({ name, difficulty, isHuman: false });

  it('collapses to the chip that always shipped when the table agrees', () => {
    const chips = opponentChips([ai('Soviet AI', 1)], 'Soviet AI', 1);
    expect(chips).toHaveLength(1);
    expect(chips[0].text).toBe(`Soviet AI · ${DIFFICULTIES[1]}`);
  });

  it('keeps ONE chip for three armies that all played at one setting', () => {
    const chips = opponentChips(
      [ai('Soviet AI 1', 3), ai('Pact AI 2', 3), ai('Reclaim AI 3', 3)], 'x', 0,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].text).toBe(`Soviet AI 1 · Pact AI 2 · Reclaim AI 3 · ${DIFFICULTIES[3]}`);
  });

  it('gives a chip PER SEAT the moment the difficulties differ', () => {
    const list = [ai('Soviet AI 1', 0), ai('Pact AI 2', 1), ai('Reclaim AI 3', 3)];
    const chips = opponentChips(list, 'x', 0);
    expect(chips.map((c) => c.text)).toEqual([
      `Soviet AI 1 · ${DIFFICULTIES[0]}`,
      `Pact AI 2 · ${DIFFICULTIES[1]}`,
      `Reclaim AI 3 · ${DIFFICULTIES[3]}`,
    ]);
    // THE FALSIFIER FOR THE OLD BEHAVIOUR. Seat 0's setting is what the screen
    // used to print for the whole table; here it appears once, on seat 0.
    const easy = chips.filter((c) => c.text.includes(DIFFICULTIES[0]));
    expect(easy).toHaveLength(1);
  });

  it('never prints a difficulty for a human, and a PvP seat forces the split', () => {
    const chips = opponentChips(
      [{ name: 'Commander B', difficulty: 1, isHuman: true }, ai('Soviet AI 2', 1)], 'x', 0,
    );
    expect(chips.map((c) => c.text)).toEqual(['Commander B · Human', `Soviet AI 2 · ${DIFFICULTIES[1]}`]);
    expect(controllerLabel({ name: 'p', difficulty: 3, isHuman: true })).toBe('Human');
  });

  it('carries the whole table on the tooltip even when it folds to one chip', () => {
    const chips = opponentChips([ai('A', 2), ai('B', 2)], 'x', 0);
    expect(chips).toHaveLength(1);
    expect(chips[0].title).toBe(`Opponents:\nA · ${DIFFICULTIES[2]}\nB · ${DIFFICULTIES[2]}`);
  });

  it('falls back to the singular pair when there is no world to read', () => {
    // `Shell.endMatch` builds a base result with `opponents: []` when no game is
    // live. A chip that vanished there would be a worse regression than a coarse
    // one, so the old single-chip shape is the floor.
    const chips = opponentChips([], 'Soviet AI', 2);
    expect(chips).toEqual([
      { text: `Soviet AI · ${DIFFICULTIES[2]}`, title: 'Opponents: Soviet AI' },
    ]);
  });

  it('never crashes on a difficulty index outside the table', () => {
    expect(opponentChips([ai('Ghost', 99)], 'x', 0)[0].text).toBe('Ghost · —');
  });
});

/* ========================================================================== */

describe('boot flags', () => {
  const settings = defaultSettings();

  it('writes every flag the engine modules read', () => {
    const q = buildMatchQuery(defaultSetup(), settings, '', 1234);
    expect(q.get('map')).toBe(mapById(defaultSetup().map).preset);
    expect(q.get('biome')).toBe(mapById(defaultSetup().map).biome);
    expect(q.get('seed')).toBe('1234');
    expect(q.get('mapseed')).toBeTruthy();
    expect(q.get('ai')).toBe('normal');
  });

  it('NEVER writes ?shot= — that flag belongs to the screenshot harness', () => {
    const q = buildMatchQuery(defaultSetup(), settings, 'shot=allied-base');
    expect(MANAGED_FLAGS).not.toContain('shot');
    // buildMatchQuery preserves unmanaged flags; the Shell deletes `shot`
    // explicitly. What matters here is that it never ADDS one.
    expect(q.getAll('shot').length).toBeLessThanOrEqual(1);
  });

  it('preserves developer flags it does not own', () => {
    const q = buildMatchQuery(defaultSetup(), settings, 'perf=1&audio=off&keepPlaceholder=1');
    expect(q.get('perf')).toBe('1');
    expect(q.get('audio')).toBe('off');
    expect(q.get('keepPlaceholder')).toBe('1');
  });

  it('replaces stale values of the flags it does own', () => {
    const q = buildMatchQuery(defaultSetup(), settings, 'map=urban&seed=7&ai=brutal', 99);
    expect(q.getAll('map').length).toBe(1);
    expect(q.get('seed')).toBe('99');
    expect(q.get('ai')).toBe('normal');
  });

  it('only pins ?tier= when the player chose one', () => {
    expect(buildMatchQuery(defaultSetup(), settings, '').has('tier')).toBe(false);
    const pinned = normalizeSettings({ ...settings, graphics: { ...settings.graphics, tier: 'ultra' } });
    expect(buildMatchQuery(defaultSetup(), pinned, '').get('tier')).toBe('ultra');
  });

  it('writes a personality only when one was chosen', () => {
    const setup = { ...defaultSetup(), personality: 1 };
    expect(buildMatchQuery(setup, settings, '').get('aip')).toBe(PERSONALITIES[1].toLowerCase());
    expect(buildMatchQuery(defaultSetup(), settings, '').has('aip')).toBe(false);
  });
});

/* ========================================================================== */

describe('SettingsStore', () => {
  function store(seed?: Record<string, string>): { s: SettingsStore; storage: StorageLike } {
    const storage = memoryStorage();
    for (const k of Object.keys(seed ?? {})) storage.setItem(k, seed![k]);
    return { s: new SettingsStore(storage), storage };
  }

  it('starts from the defaults with empty storage', () => {
    const { s } = store();
    expect(s.get()).toEqual(defaultSettings());
  });

  it('survives corrupt JSON', () => {
    const { s } = store({ [SETTINGS_STORAGE_KEY]: '{not json', [SETUP_STORAGE_KEY]: '][' });
    expect(s.get().graphics.tier).toBe('auto');
    expect(s.setup().map).toBe(defaultSetup().map);
  });

  it('persists a patch and reports the changed paths', () => {
    const { s, storage } = store();
    const changed = s.patch({ audio: { music: 12 } });
    expect(changed).toEqual(['audio.music']);
    expect(s.get().audio.music).toBe(12);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!).audio.music).toBe(12);
  });

  it('reports nothing for a no-op patch', () => {
    const { s } = store();
    expect(s.patch({ audio: { music: s.get().audio.music } })).toEqual([]);
  });

  it('notifies subscribers exactly once per real change', () => {
    const { s } = store();
    let calls = 0;
    let lastChanged: readonly string[] = [];
    const off = s.subscribe((_settings, changed) => { calls++; lastChanged = changed; });
    s.patch({ graphics: { bloom: false } });
    s.patch({ graphics: { bloom: false } });
    expect(calls).toBe(1);
    // `graphics.calibrated` rides along because turning bloom off is a decision
    // about the picture, and a decision retires the one-time hardware
    // calibration — see `retiresCalibration`. That is ONE patch producing TWO
    // changed paths, which is the point of this test: still one notification.
    expect(lastChanged).toEqual(['graphics.calibrated', 'graphics.bloom']);
    off();
    s.patch({ graphics: { bloom: true } });
    expect(calls).toBe(1);
  });

  it('resets one section without touching the others', () => {
    const { s } = store();
    s.patch({ audio: { music: 3 }, graphics: { bloom: false } });
    s.reset('audio');
    expect(s.get().audio.music).toBe(defaultSettings().audio.music);
    expect(s.get().graphics.bloom).toBe(false);
  });

  it('round-trips the match setup', () => {
    const { s, storage } = store();
    s.setSetup({ ...defaultSetup(), map: MAPS[3].id, difficulty: 3 }, ['allies', 'soviets']);
    expect(s.setup().map).toBe(MAPS[3].id);
    const reloaded = new SettingsStore(storage);
    expect(reloaded.setup().difficulty).toBe(3);
  });

  it('diffs keybinds by chord, not by identity', () => {
    const a = defaultSettings();
    const b = normalizeSettings(a);
    expect(diffSettings(a, b)).toEqual([]);
    b.controls.bindings['ord.stop'] = { code: 'KeyK', ctrl: false, shift: false, alt: false };
    expect(diffSettings(a, b)).toEqual(['controls.ord.stop']);
  });
});

/* ========================================================================== */

describe('touched', () => {
  it('matches a path and its children, and nothing else', () => {
    const changed = ['graphics.bloom', 'audio.master'];
    expect(touched(changed, 'graphics')).toBe(true);
    expect(touched(changed, 'graphics.bloom')).toBe(true);
    expect(touched(changed, 'graphics.bloomier')).toBe(false);
    expect(touched(changed, 'gameplay')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The page-layout gate.                                                      */
/* -------------------------------------------------------------------------- */

/**
 * EVERY FULL-PAGE SCREEN MUST CLAIM `.vm-page` ON ITS HOST.
 *
 * `.vm-screen` — the layer `Shell.show` builds for a screen — is a bare flex
 * container with no alignment of its own. `.vm-page` is what supplies
 * `align-items: center`, `justify-content: center` and the outer padding, and
 * a screen that forgets it does not fail: it renders perfectly, pinned to the
 * top-left corner of the viewport and stretched to the full height.
 *
 * That is exactly how the multiplayer lobby shipped, and it is a defect no
 * amount of type checking can see — the class is a string, the layout is CSS,
 * and the only witness is a human looking at the screen. The `?shot=` harness
 * cannot catch it either: those fixtures never load the shell chunk, which is
 * the same blind spot `tests/shell-scope.spec.ts` was written for.
 *
 * So: read the source, find every `implements Screen` that builds a `pageFrame`,
 * and require the class. Both `add('vm-page')` and the multi-argument
 * `add('vm-page', 'is-modal')` count — `Missions` legitimately uses the latter.
 */
describe('page layout gate', () => {
  const SHELL_DIR = join(process.cwd(), 'src', 'shell');

  it('every Screen that builds a pageFrame centres itself', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(SHELL_DIR)) {
      if (!name.endsWith('.ts')) continue;
      const src = readFileSync(join(SHELL_DIR, name), 'utf8');
      // Only Screens. `HelpPanel` builds a pageFrame too, but it is not a
      // Screen — it mounts its own `.vm-help` root with its own layout.
      if (!/implements Screen\b/.test(src)) continue;
      // `pageFrame('` — a CALL, which always passes a string title. Matching
      // `pageFrame(` alone also matches the DECLARATION in Shell.ts, which
      // happens to sit in the same file as `LoadingScreen implements Screen`
      // and made this gate report a screen that renders its own `.vm-load`
      // layer and never touches a page frame.
      if (!/pageFrame\('/.test(src)) continue;
      if (/classList\.add\((?:[^)]*,\s*)?'vm-page'|classList\.add\('vm-page'/.test(src)) continue;
      offenders.push(name);
    }
    expect(offenders, 'these screens will render pinned to the top-left corner').toEqual([]);
  });

  it('would actually catch one', () => {
    // A gate nobody has seen fail is a gate nobody knows works. This is the
    // exact shape MultiplayerSetup.ts had when the lobby rendered off-centre.
    const broken = `class X implements Screen {\n  mount(host: HTMLElement) {\n    const f = pageFrame('X', () => {});\n  }\n}`;
    const centred = `class X implements Screen {\n  mount(host: HTMLElement) {\n    host.classList.add('vm-page');\n    const f = pageFrame('X', () => {});\n  }\n}`;
    const passes = (s: string): boolean =>
      !/implements Screen\b/.test(s) || !/pageFrame\('/.test(s)
      || /classList\.add\((?:[^)]*,\s*)?'vm-page'|classList\.add\('vm-page'/.test(s);
    expect(passes(broken)).toBe(false);
    expect(passes(centred)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The re-enable trap.                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A BUTTON BUILT DISABLED MUST STILL WORK ONCE IT IS ENABLED.
 *
 * `button()` used to attach `onClick` only on the enabled branch, so a button
 * created disabled never got a handler. Nothing noticed for the life of the
 * function because every disabled button in the product was disabled
 * PERMANENTLY — Load Game with no saves, and nothing else.
 *
 * The Multiplayer entry is the first that starts disabled and enables itself
 * when the relay answers. It came up enabled, correctly labelled, and
 * completely dead to the touch, and it took a browser and a confused minute to
 * work out why. Asserted here so it cannot come back.
 */
describe('a button built disabled', () => {
  /*
   * ASSERTED FROM THE SOURCE, because this suite runs under `environment:
   * 'node'` and there is no DOM to click — see this file's header. Adding jsdom
   * for one assertion would be a dependency for a behaviour a five-line read
   * can pin exactly.
   */
  const shellSrc = readFileSync(join(process.cwd(), 'src', 'shell', 'Shell.ts'), 'utf8');
  const body = shellSrc.slice(
    shellSrc.indexOf('export function button('),
    shellSrc.indexOf('export function setButtonEnabled('),
  );

  it('gets its click handler unconditionally, not on the enabled branch', () => {
    expect(body.length, 'button() must be findable').toBeGreaterThan(100);
    const attach = body.indexOf("addEventListener('click'");
    const apply = body.indexOf('setButtonEnabled(b,');
    expect(attach, 'button() must attach onClick').toBeGreaterThan(-1);
    expect(apply, 'button() must route its disabled state through setButtonEnabled').toBeGreaterThan(-1);
    // Attached BEFORE the enabled state is applied, and therefore outside any
    // branch on it. The old shape put the listener inside `else { ... }`, so a
    // button created disabled never got one and stayed inert forever once
    // something re-enabled it — which is exactly how the Multiplayer entry
    // shipped: enabled, correctly labelled, and dead to the touch.
    expect(attach).toBeLessThan(apply);
    expect(body).not.toMatch(/else\s*\{[\s\S]*addEventListener\('click'/);
    // And the listener checks `disabled` ITSELF rather than trusting the DOM to
    // suppress the event. `savegame-ux.spec.ts` drives a stub that does not
    // model the suppression, and it caught the first version of this that did.
    expect(body).toMatch(/if\s*\(!b\.disabled\)/);
  });

  it('has one place that knows enabling also means the focus ring', () => {
    // `focusable()` only assigns a tabindex when there is none, so flipping
    // `disabled` by hand leaves a re-enabled button at -1: mouse-reachable and
    // keyboard-invisible. `setButtonEnabled` is the one place that does both.
    const setter = shellSrc.slice(shellSrc.indexOf('export function setButtonEnabled('));
    expect(setter).toContain('removeAttribute');
    expect(setter).toContain('tabindex');
    expect(setter).toContain('focusable(b)');
  });

  it('is what the Multiplayer entry actually uses', () => {
    const menu = readFileSync(join(process.cwd(), 'src', 'shell', 'MainMenu.ts'), 'utf8');
    expect(menu).toContain('setButtonEnabled(b, ok)');
    // COMMENTS STRIPPED FIRST. The line explaining why not to write
    // `b.disabled = ...` contains `b.disabled = ...`, so a naive search over the
    // whole file fails on its own documentation — which it duly did.
    const code = menu.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code, 'the probe must not flip `disabled` by hand').not.toMatch(/b\.disabled\s*=/);
  });
});
