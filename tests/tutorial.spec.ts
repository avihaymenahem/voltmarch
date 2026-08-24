/**
 * ============================================================================
 * TUTORIAL — the falsifiable half
 * ============================================================================
 * The tutorial's whole risk profile is two failures, and this file exists for
 * both:
 *
 *   1. IT TEACHES A KEY THAT IS NOT BOUND TO THAT ACTION. This product has
 *      already shipped an Options screen advertising W/A/S/D against arrow-key
 *      code, and it reached a player. A tutorial is the first thing a new
 *      player reads, so the blast radius is larger. Section 2 asserts that
 *      every key the tutorial names comes out of `ActionCatalogue` resolved
 *      against the live bindings, and section 3 asserts that no step's PROSE
 *      spells a key at all — the only way the first assertion can be bypassed.
 *
 *   2. A STEP THAT CANNOT BE COMPLETED, or one that completes on its own. Every
 *      step's condition is a delta on a monotonic counter, and section 4 drives
 *      each one with the exact call `src/shell/tutorial.system.ts` makes from
 *      the real event, then asserts (a) that it flips the step, and (b) that
 *      driving every OTHER signal does not. A step with no driver here fails
 *      the suite, so a fourteenth step cannot be added untested.
 *
 * Runs under `environment: 'node'` like the rest of the repo, which is why the
 * rules live in `src/shell/tutorial-steps.ts` and not in the DOM director.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACTIONS,
  BUILD_TAB_HOTKEY_LABELS,
  actionById,
} from '../src/input/ActionCatalogue';
import { BuildTab, Faction } from '../src/core/types';
import { BuildKind, createCatalog } from '../src/sim/Production';
import { codeLabel, defaultBindings, type Chord } from '../src/shell/settings-store';

import {
  CAM_HOME_FAR,
  CameraProbe,
  ORDER_ATTACK_MOVE,
  ORDER_MOVE,
  TUTORIAL_STEPS,
  TUTORIAL_STORAGE_KEY,
  actionKeyRow,
  classifyStructure,
  copyFacts,
  decodeProgress,
  emptyFacts,
  emptyProgress,
  encodeProgress,
  noteAcknowledge,
  noteHarvestDeposit,
  noteOrder,
  noteRallyMove,
  noteSelection,
  noteStructure,
  noteTutorialAction,
  noteUnitProduced,
  progressHint,
  resumeIndex,
  stepComplete,
  stepIndex,
  stepKeyRows,
  withStepCompleted,
  type StructureRole,
  type TutorialFacts,
  type TutorialProgress,
  type TutorialStep,
} from '../src/shell/tutorial-steps';

/* ==========================================================================
 * 1. SHAPE
 * ========================================================================== */

describe('tutorial — the step list is well formed', () => {
  it('has a lesson for every part of the loop the brief names', () => {
    expect(TUTORIAL_STEPS).toHaveLength(26);
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    for (const wanted of [
      'camera.move', 'camera.home',
      'select.one', 'select.group',
      'select.controlGroups',
      'order.move', 'order.attackMove', 'order.stance', 'order.formation',
      'build.deploy', 'build.power', 'build.refinery',
      'economy.harvest', 'build.factory', 'build.produce', 'build.rally',
      'field.garrison', 'field.capture', 'base.repair', 'base.sell',
      'naval.transport', 'powers.commanderAbility', 'powers.commander',
      'powers.superweapon', 'combat.veterancy',
      'match.victory',
    ]) {
      expect(ids).toContain(wanted);
    }
  });

  it('has unique ids, real fact keys and positive deltas', () => {
    const seen = new Set<string>();
    const factKeys = new Set(Object.keys(emptyFacts()));
    for (const step of TUTORIAL_STEPS) {
      expect(seen.has(step.id), `duplicate step id ${step.id}`).toBe(false);
      seen.add(step.id);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(40);
      expect(step.goals.length).toBeGreaterThan(0);
      for (const goal of step.goals) {
        expect(factKeys.has(goal.fact), `${step.id} names unknown fact ${goal.fact}`).toBe(true);
        expect(goal.delta).toBeGreaterThan(0);
        expect(goal.label.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The one ordering the ENGINE forces. `powerPlant` is the refinery's
   * prerequisite in the real catalogue, so teaching the economy before the
   * power grid would park the player in front of a locked cameo.
   */
  it('teaches power before the refinery, because the tech tree says so', async () => {
    expect(stepIndex('build.power')).toBeLessThan(stepIndex('build.refinery'));
    expect(stepIndex('build.refinery')).toBeLessThan(stepIndex('economy.harvest'));
    expect(stepIndex('build.deploy')).toBeLessThan(stepIndex('build.power'));

    const { catalog } = await createCatalog();
    const refineries = catalog.entries.filter((e) => e.shipsWith !== '');
    expect(refineries.length).toBeGreaterThanOrEqual(3);
    for (const refinery of refineries) {
      const prereqRoles = refinery.prereqs
        .map((k) => catalog.byKey(k))
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => classifyStructure(e));
      expect(prereqRoles, `${refinery.key} should require a power source`).toContain('power');
    }
  });

  /** World-state lessons can only be re-run; pure input drills can be resumed. */
  it('marks every lesson that needs the rebuilt match as world-dependent', () => {
    const worldDependent = TUTORIAL_STEPS.filter((s) => s.worldDependent).map((s) => s.id);
    expect(worldDependent).toEqual([
      'build.deploy', 'build.power', 'build.refinery',
      'economy.harvest', 'build.factory', 'build.produce', 'build.rally',
      'field.garrison', 'field.capture', 'base.repair', 'base.sell',
      'naval.transport', 'powers.commanderAbility', 'powers.commander',
      'powers.superweapon', 'combat.veterancy',
    ]);
  });
});

/* ==========================================================================
 * 2. EVERY NAMED BINDING RESOLVES THROUGH THE CATALOGUE
 *
 * This is the section the task exists for.
 * ========================================================================== */

describe('tutorial — bindings come from ActionCatalogue, never from prose', () => {
  const bindings = defaultBindings();

  it('every action a step names is a real catalogue row', () => {
    const known = new Set(ACTIONS.map((a) => a.id));
    for (const step of TUTORIAL_STEPS) {
      for (const id of step.actions) {
        expect(known.has(id), `${step.id} names unknown action ${id}`).toBe(true);
        expect(actionById(id)).toBeDefined();
      }
    }
  });

  it('every named action renders at least one chip', () => {
    for (const step of TUTORIAL_STEPS) {
      const rows = stepKeyRows(step, bindings, false, codeLabel);
      expect(rows.length, `${step.id} dropped a row`).toBe(step.actions.length);
      for (const row of rows) {
        expect(row.label.length).toBeGreaterThan(0);
        expect(row.chips.length).toBeGreaterThan(0);
        for (const chip of row.chips) expect(chip.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('follows a rebind instead of printing the default', () => {
    const stock = actionKeyRow('ord.attackMove', bindings, false, codeLabel);
    expect(stock?.chips.map((c) => c.text)).toEqual(['A']);

    const rebound: Record<string, Chord> = {
      ...bindings,
      'ord.attackMove': { code: 'KeyV', ctrl: false, shift: false, alt: false },
    };
    const moved = actionKeyRow('ord.attackMove', rebound, false, codeLabel);
    expect(moved?.chips.map((c) => c.text)).toEqual(['V']);

    // ...and the step that teaches it moves with it, which is the whole point.
    const step = TUTORIAL_STEPS[stepIndex('order.attackMove')];
    const texts = stepKeyRows(step, rebound, false, codeLabel)
      .flatMap((r) => r.chips.map((c) => c.text));
    expect(texts).toContain('V');
    expect(texts).not.toContain('A');
  });

  /**
   * THE FIRST STEP OF THE TUTORIAL WAS UNWINNABLE ON A TRACKPAD.
   *
   * `camera.move` gates on `camZoomTravel >= 0.3` and its `actions` named
   * exactly one zoom — `cam.wheelZoom` — beside two gestures that PAN. So a
   * laptop player was shown a chip reading "Mouse wheel", plus "Two-finger
   * swipe" and "Middle-drag", and asked to dolly the camera. Reported from a
   * Mac as "cant zoom or scroll on z".
   *
   * WRITTEN AS A RULE, NOT AS A LIST, because a literal list is how the gap
   * shipped: the step named a set that was correct on the day it was authored
   * and nothing re-examined it when the camera scheme changed. Any step gated
   * on a zoom must name a zoom a KEYBOARD can perform — `binding:
   * 'rebindable'` is exactly "this has a chord", and a key needs no pointing
   * device, no classifier verdict and no browser event shape.
   */
  it('never gates a step on an input the player has no key for', () => {
    // THE ZOOM ACTIONS, DERIVED. `tests/action-catalogue.spec.ts` pins that
    // this filter selects exactly the five zoom rows and no pan row, in both
    // directions — so a sixth zoom added later cannot slip past this rule by
    // being invisible to it.
    const zooms = new Set(ACTIONS.filter((a) => /zoom/i.test(a.id)).map((a) => a.id));

    for (const step of TUTORIAL_STEPS) {
      if (!step.goals.some((g) => g.fact === 'camZoomTravel')) continue;
      const keyed = step.actions
        .filter((id) => zooms.has(id))
        .map((id) => actionById(id))
        .filter((a) => a !== undefined && a.binding === 'rebindable');
      expect(
        keyed.length,
        `${step.id} asks the player to zoom and names no KEY that zooms — `
        + 'every other route depends on a wheel or a gesture, which is what '
        + 'left this step unwinnable on a trackpad. Filtering to the zoom rows '
        + 'is load-bearing: the first draft of this rule accepted `cam.panUp`, '
        + 'which is rebindable and does not zoom, and passed against the '
        + 'broken step.',
      ).toBeGreaterThan(0);
    }
  });

  /**
   * And the chips must describe the machine the player is on. The trackpad
   * gesture that dollies is `cam.trackpadZoom`; `cam.trackpadPan` is now the
   * SHIFT-held gesture, so naming only the latter would print a pan under a
   * heading asking for a zoom — the same defect one layer down.
   */
  it('names the trackpad zoom on the step that teaches zooming', () => {
    const step = TUTORIAL_STEPS[stepIndex('camera.move')];
    expect(step.actions).toContain('cam.trackpadZoom');
    expect(step.actions).toContain('cam.pinchZoom');
  });

  it('reports a cleared binding as unbound rather than falling back', () => {
    const cleared: Record<string, Chord> = {
      ...bindings,
      'ord.deploy': { code: '', ctrl: false, shift: false, alt: false },
    };
    const row = actionKeyRow('ord.deploy', cleared, false, codeLabel);
    expect(row?.chips).toEqual([{ text: 'Unbound', kind: 'unbound' }]);
  });

  it('renders modifiers with the platform glyph', () => {
    const pc = actionKeyRow('sel.allArmy', bindings, false, codeLabel);
    expect(pc?.chips.map((c) => c.text)).toEqual(['CTRL', '+', 'A']);
    const mac = actionKeyRow('sel.allArmy', bindings, true, codeLabel);
    expect(mac?.chips.map((c) => c.text)).toEqual(['⌃', '+', 'A']);
  });

  it('takes the build-tab letters from the catalogue arrays, not a copy', () => {
    const row = actionKeyRow('bld.tabKeys', bindings, false, codeLabel);
    // The Powers tab's slot is the empty string — every letter is spoken for
    // and a badge on a key that does nothing is worse than no badge, which is
    // this catalogue's own rule. `bld.tabKeys` filters it, so the help screen
    // shows keys that exist and the arrays stay index-aligned with `BuildTab`.
    expect(row?.chips.map((c) => c.text))
      .toEqual(BUILD_TAB_HOTKEY_LABELS.filter((c) => c !== ''));
  });

  it('renders a pointer action as its gesture phrase', () => {
    const row = actionKeyRow('sel.box', bindings, false, codeLabel);
    expect(row?.chips).toHaveLength(1);
    expect(row?.chips[0].kind).toBe('gesture');
    expect(row?.chips[0].text).toBe(actionById('sel.box')?.gesture);
  });

  it('returns null for an id the catalogue does not know', () => {
    expect(actionKeyRow('ord.doesNotExist', bindings, false, codeLabel)).toBeNull();
  });
});

/* ==========================================================================
 * 3. NO STEP SPELLS A KEY
 *
 * The escape hatch that would defeat section 2 is prose: a step that says
 * "press A to attack-move" is stale the moment the player rebinds, and no
 * amount of correct chip rendering saves it. So the prose is linted.
 *
 * The pattern is an imperative followed by something that looks like a key.
 * "Click one of your vehicles" and "Drag a box" survive it; "press A", "hold
 * Shift", "hit Escape" and "tap the D key" do not.
 * ========================================================================== */

const IMPERATIVE_THEN_KEY =
  /\b(?:press|hit|tap|hold|push|strike|type)\s+(?:and\s+hold\s+)?(?:the\s+)?(?:[A-Za-z0-9]\b|ctrl|control|shift|alt|option|cmd|command|space|spacebar|enter|return|escape|esc|tab|arrow|arrows|f\d)\b/i;

/** "the D key", "key A", "A-key" — the other spelling of the same mistake. */
const NAMED_KEY_NOUN = /\b(?:[A-Za-z0-9]\s*[-–]\s*key|key\s+[A-Za-z0-9]\b|\b[A-Za-z0-9]\s+key\b)/i;

describe('tutorial — the prose never names a key', () => {
  it('has no imperative followed by a key name in any step', () => {
    const offenders: string[] = [];
    for (const step of TUTORIAL_STEPS) {
      for (const text of [step.title, step.body, ...step.goals.map((g) => g.label)]) {
        const hit = IMPERATIVE_THEN_KEY.exec(text);
        if (hit !== null) offenders.push(`${step.id}: ${hit[0]}`);
        const noun = NAMED_KEY_NOUN.exec(text);
        if (noun !== null) offenders.push(`${step.id}: ${noun[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** The lint has to be capable of catching the bug, or it proves nothing. */
  it('the lint catches the bug it exists for', () => {
    expect(IMPERATIVE_THEN_KEY.test('Press W to pan the camera.')).toBe(true);
    expect(IMPERATIVE_THEN_KEY.test('Hold Shift and right-click.')).toBe(true);
    expect(IMPERATIVE_THEN_KEY.test('Hit Escape to go back.')).toBe(true);
    expect(NAMED_KEY_NOUN.test('Use the D key to deploy.')).toBe(true);
    // ...and does not fire on the phrasing the steps actually use.
    expect(IMPERATIVE_THEN_KEY.test('Click one of your vehicles.')).toBe(false);
    expect(IMPERATIVE_THEN_KEY.test('Drag a box across your units.')).toBe(false);
    expect(NAMED_KEY_NOUN.test('Drive it onto open ground and unpack it.')).toBe(false);
  });
});

/* ==========================================================================
 * 4. COMPLETION CONDITIONS
 *
 * Each driver below is EXACTLY what `src/shell/tutorial.system.ts` calls from
 * the event it subscribes to. The comment on each names the event, so a reader
 * can check the wiring against the subscription list in one pass.
 * ========================================================================== */

/** Everything the system can push into the record, one call each. */
const SIGNALS: Readonly<Record<string, (f: TutorialFacts) => void>> = {
  /** `selection:changed`, count 1. */
  selectOne: (f) => noteSelection(f, 1),
  /** `selection:changed`, count 4. */
  selectGroup: (f) => noteSelection(f, 4),
  /** `order:issued`, OrderKind.Move. */
  moveOrder: (f) => noteOrder(f, ORDER_MOVE, 3),
  /** `order:issued`, OrderKind.AttackMove. */
  attackMoveOrder: (f) => noteOrder(f, ORDER_ATTACK_MOVE, 3),
  controlGroupStore: (f) => noteTutorialAction(f, 'control-group-store'),
  controlGroupRecall: (f) => noteTutorialAction(f, 'control-group-recall'),
  stance: (f) => noteTutorialAction(f, 'stance-change'),
  formation: (f) => noteTutorialAction(f, 'formation-use'),
  garrison: (f) => noteTutorialAction(f, 'garrison-enter'),
  capture: (f) => noteTutorialAction(f, 'building-capture'),
  repair: (f) => noteTutorialAction(f, 'repair-start'),
  sell: (f) => noteTutorialAction(f, 'building-sell'),
  transportBoard: (f) => noteTutorialAction(f, 'transport-board'),
  transportUnload: (f) => noteTutorialAction(f, 'transport-unload'),
  commanderAbility: (f) => noteTutorialAction(f, 'commander-ability'),
  commanderPower: (f) => noteTutorialAction(f, 'commander-power'),
  superweapon: (f) => noteTutorialAction(f, 'superweapon-fire'),
  veterancy: (f) => noteTutorialAction(f, 'veterancy-rank'),
  /** `building:completed` -> classifyStructure -> 'conyard'. */
  conyard: (f) => noteStructure(f, 'conyard'),
  /** ...'power'. */
  power: (f) => noteStructure(f, 'power'),
  /** ...'refinery'. */
  refinery: (f) => noteStructure(f, 'refinery'),
  /** ...'factory'. */
  factory: (f) => noteStructure(f, 'factory'),
  /** ...'other' — a radar dome, a silo, a wall. Must teach nothing. */
  otherStructure: (f) => noteStructure(f, 'other'),
  /** `production:ready` with isBuilding false. */
  unitProduced: (f) => noteUnitProduced(f),
  /** `economy:credits`, positive delta, CreditReason.Harvest. */
  harvest: (f) => noteHarvestDeposit(f),
  /** The polled rally map moved a flag that already existed. */
  rally: (f) => noteRallyMove(f),
  /** The card's own Finish button. */
  acknowledge: (f) => noteAcknowledge(f),
  /** A camera pan of 60 m, sampled in six frames. */
  cameraPan: (f) => {
    const probe = new CameraProbe();
    for (let i = 0; i <= 6; i++) probe.sample(f, i * 10, 0, 90, 0, 0);
  },
  /** A dolly from 90 m to 30 m and back. */
  cameraZoom: (f) => {
    const probe = new CameraProbe();
    probe.sample(f, 0, 0, 90, 0, 0);
    probe.sample(f, 0, 0, 30, 0, 0);
    probe.sample(f, 0, 0, 90, 0, 0);
  },
  /** Leave the base, then come back to it. */
  cameraHome: (f) => {
    const probe = new CameraProbe();
    probe.sample(f, 0, 0, 90, 0, 0);
    probe.sample(f, CAM_HOME_FAR + 30, 0, 90, 0, 0);
    probe.sample(f, 0, 0, 90, 0, 0);
  },
};

/** The signals that complete each step. Every step must appear. */
const DRIVERS: Readonly<Record<string, readonly string[]>> = {
  'camera.move': ['cameraPan', 'cameraZoom'],
  'camera.home': ['cameraHome'],
  'select.one': ['selectOne'],
  'select.group': ['selectGroup'],
  'select.controlGroups': ['controlGroupStore', 'controlGroupRecall'],
  'order.move': ['moveOrder'],
  'order.attackMove': ['attackMoveOrder'],
  'order.stance': ['stance'],
  'order.formation': ['formation'],
  'build.deploy': ['conyard'],
  'build.power': ['power'],
  'build.refinery': ['refinery'],
  'economy.harvest': ['harvest'],
  'build.factory': ['factory'],
  'build.produce': ['unitProduced'],
  'build.rally': ['rally'],
  'field.garrison': ['garrison'],
  'field.capture': ['capture'],
  'base.repair': ['repair'],
  'base.sell': ['sell'],
  'naval.transport': ['transportBoard', 'transportUnload'],
  'powers.commanderAbility': ['commanderAbility'],
  'powers.commander': ['commanderPower'],
  'powers.superweapon': ['superweapon'],
  'combat.veterancy': ['veterancy'],
  'match.victory': ['acknowledge'],
};

/**
 * Signals that legitimately ALSO satisfy a step, and therefore are not
 * "foreign" to it.
 *
 * Exactly one entry, and it is a design statement rather than a loophole:
 * boxing four units is selecting a unit, and a tutorial that refused to accept
 * it would be insisting the player do something worse than what they did.
 */
const ALSO_SATISFIES: Readonly<Record<string, readonly string[]>> = {
  'select.one': ['selectGroup'],
};

function runStep(step: TutorialStep, signals: readonly string[]): boolean {
  const facts = emptyFacts();
  const baseline = copyFacts(facts);
  for (const name of signals) SIGNALS[name](facts);
  return stepComplete(step, facts, baseline);
}

describe('tutorial — every step completes from the signal it claims to watch', () => {
  it('has a driver for every step, so a new step cannot ship untested', () => {
    expect(Object.keys(DRIVERS).sort()).toEqual(TUTORIAL_STEPS.map((s) => s.id).sort());
  });

  it('completes each step from its own signals', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(runStep(step, DRIVERS[step.id]), `${step.id} never completed`).toBe(true);
    }
  });

  it('completes NO step from any other signal', () => {
    for (const step of TUTORIAL_STEPS) {
      const own = new Set([...DRIVERS[step.id], ...(ALSO_SATISFIES[step.id] ?? [])]);
      const foreign = Object.keys(SIGNALS).filter((s) => !own.has(s));
      // Fire every foreign signal three times over — enough to satisfy any
      // delta in the list if the step were watching the wrong counter.
      const facts = emptyFacts();
      const baseline = copyFacts(facts);
      for (let i = 0; i < 3; i++) for (const name of foreign) SIGNALS[name](facts);
      expect(stepComplete(step, facts, baseline), `${step.id} completed from foreign signals`)
        .toBe(false);
    }
  });

  it('needs BOTH halves of the camera lesson', () => {
    const step = TUTORIAL_STEPS[stepIndex('camera.move')];
    expect(runStep(step, ['cameraPan'])).toBe(false);
    expect(runStep(step, ['cameraZoom'])).toBe(false);
    expect(runStep(step, ['cameraPan', 'cameraZoom'])).toBe(true);
  });

  /**
   * The baseline is what makes a step an instruction rather than a history
   * lookup. A player who deployed before being asked still has to build the
   * power plant they are asked for next.
   */
  it('measures against the baseline, not against the whole match', () => {
    const step = TUTORIAL_STEPS[stepIndex('build.power')];
    const facts = emptyFacts();
    SIGNALS.power(facts);              // built one before the step opened
    const baseline = copyFacts(facts); // ...step opens here
    expect(stepComplete(step, facts, baseline)).toBe(false);
    SIGNALS.power(facts);
    expect(stepComplete(step, facts, baseline)).toBe(true);
  });

  it('accepts a group selection for the single-selection lesson', () => {
    const step = TUTORIAL_STEPS[stepIndex('select.one')];
    expect(runStep(step, ['selectGroup'])).toBe(true);
    // ...but not the other way round: one unit is not a group.
    expect(runStep(TUTORIAL_STEPS[stepIndex('select.group')], ['selectOne'])).toBe(false);
  });

  it('counts a two-unit selection as both a selection and a group', () => {
    const facts = emptyFacts();
    noteSelection(facts, 2);
    expect(facts.selections).toBe(1);
    expect(facts.groupSelections).toBe(1);
    noteSelection(facts, 1);
    expect(facts.selections).toBe(2);
    expect(facts.groupSelections).toBe(1);
    noteSelection(facts, 0);
    expect(facts.selections).toBe(2);
  });

  it('ignores an order issued to nothing', () => {
    const facts = emptyFacts();
    noteOrder(facts, ORDER_MOVE, 0);
    expect(facts.moveOrders).toBe(0);
  });
});

/* ==========================================================================
 * 5. THE CAMERA PROBE
 * ========================================================================== */

describe('tutorial — camera probe', () => {
  it('accumulates pan distance and ignores the first sample', () => {
    const facts = emptyFacts();
    const probe = new CameraProbe();
    probe.sample(facts, 100, 100, 90, 0, 0);
    expect(facts.camPanTravel).toBe(0);
    probe.sample(facts, 103, 104, 90, 0, 0);
    expect(facts.camPanTravel).toBeCloseTo(5, 5);
  });

  /**
   * `Shell.applyCameraPostBoot` jumps the camera onto the player's base with an
   * immediate pose. Counting that as a pan would hand the player the camera
   * lesson before they had touched anything.
   */
  it('discards a single-frame teleport', () => {
    const facts = emptyFacts();
    const probe = new CameraProbe();
    probe.sample(facts, 0, 0, 90, 0, 0);
    probe.sample(facts, 900, 0, 90, 0, 0);
    expect(facts.camPanTravel).toBe(0);
  });

  it('measures zoom as a ratio, so it reads the same at both ends of the range', () => {
    const near = emptyFacts();
    const nearProbe = new CameraProbe();
    nearProbe.sample(near, 0, 0, 30, 0, 0);
    nearProbe.sample(near, 0, 0, 60, 0, 0);

    const far = emptyFacts();
    const farProbe = new CameraProbe();
    farProbe.sample(far, 0, 0, 60, 0, 0);
    farProbe.sample(far, 0, 0, 120, 0, 0);

    expect(far.camZoomTravel).toBeCloseTo(near.camZoomTravel, 6);
  });

  it('only counts a homecoming after a real departure', () => {
    const facts = emptyFacts();
    const probe = new CameraProbe();
    // Fidgeting near the base is not leaving it.
    probe.sample(facts, 0, 0, 90, 0, 0);
    probe.sample(facts, 5, 0, 90, 0, 0);
    probe.sample(facts, 0, 0, 90, 0, 0);
    expect(facts.homeReturns).toBe(0);

    probe.sample(facts, CAM_HOME_FAR + 20, 0, 90, 0, 0);
    expect(facts.homeReturns).toBe(0);
    probe.sample(facts, 1, 1, 90, 0, 0);
    expect(facts.homeReturns).toBe(1);

    // ...and it re-arms, rather than counting every frame you sit at home.
    probe.sample(facts, 2, 2, 90, 0, 0);
    expect(facts.homeReturns).toBe(1);
  });

  it('survives a NaN pose without poisoning the record', () => {
    const facts = emptyFacts();
    const probe = new CameraProbe();
    probe.sample(facts, 0, 0, 90, 0, 0);
    probe.sample(facts, Number.NaN, 0, 90, 0, 0);
    probe.sample(facts, 10, 0, 90, 0, 0);
    expect(Number.isFinite(facts.camPanTravel)).toBe(true);
    expect(facts.camPanTravel).toBeCloseTo(10, 5);
  });
});

/* ==========================================================================
 * 6. STRUCTURE CLASSIFICATION, AGAINST THE REAL CATALOGUE
 *
 * Four armies spell every structure differently. The classifier reads the
 * SHAPE of a catalogue entry rather than its key, and this is where that claim
 * is checked against the content that actually ships.
 * ========================================================================== */

describe('tutorial — structure roles come from shape, not from key names', () => {
  it('classifies each faction\'s opening chain exactly once', async () => {
    const { catalog } = await createCatalog();
    const buildings = catalog.entries.filter((e) => e.kind === BuildKind.Building);
    expect(buildings.length).toBeGreaterThan(20);

    const factions = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim];
    for (const faction of factions) {
      const own = buildings.filter((e) => e.faction === faction || e.faction === Faction.Neutral);
      const roles = own.map((e) => classifyStructure(e));
      // Neutral rows are shared by three of the four armies, so a per-faction
      // count is only meaningful for the roles; what matters is that each role
      // is reachable and that nothing in the chain falls through to 'other'.
      expect(roles, `${faction} has no construction yard`).toContain('conyard');
      expect(roles, `${faction} has no power source`).toContain('power');
      expect(roles, `${faction} has no refinery`).toContain('refinery');
      expect(roles, `${faction} has no unit factory`).toContain('factory');
    }
  });

  it('gives the named opening structures the roles the steps assume', async () => {
    const { catalog } = await createCatalog();
    const expected: ReadonlyArray<readonly [string, StructureRole]> = [
      ['conyard', 'conyard'], ['powerPlant', 'power'], ['refinery', 'refinery'],
      ['barracks', 'factory'], ['warFactory', 'factory'],
      ['mrdConclave', 'conyard'], ['mrdSolarArray', 'power'], ['mrdCistern', 'refinery'],
      ['mrdChapterhouse', 'factory'], ['mrdForgeyard', 'factory'],
      ['rclFoundry', 'conyard'], ['rclFurnace', 'power'], ['rclSorter', 'refinery'],
      ['rclRookery', 'factory'], ['rclBreakerYard', 'factory'],
    ];
    for (const [key, role] of expected) {
      const entry = catalog.byKey(key);
      expect(entry, `${key} is missing from the catalogue`).not.toBeNull();
      if (entry === null) continue;
      expect(classifyStructure(entry), `${key} classified wrong`).toBe(role);
    }
  });

  it('never mistakes a wall, a silo or a radar for a lesson', async () => {
    const { catalog } = await createCatalog();
    for (const key of ['wall', 'oreSilo', 'radar', 'battleLab', 'pillbox', 'teslaCoil']) {
      const entry = catalog.byKey(key);
      if (entry === null) continue;
      expect(classifyStructure(entry), `${key} should teach nothing`).toBe('other');
    }
  });

  it('is total over every structure in the catalogue', async () => {
    const { catalog } = await createCatalog();
    for (const entry of catalog.entries) {
      if (entry.kind !== BuildKind.Building) continue;
      const role = classifyStructure(entry);
      expect(['conyard', 'power', 'refinery', 'factory', 'other']).toContain(role);
      if (role === 'refinery') expect(entry.shipsWith).not.toBe('');
      if (role === 'power') expect(entry.power).toBeGreaterThan(0);
      if (role === 'factory') {
        const tabs = entry.producesTabs as readonly number[];
        expect(
          tabs.includes(BuildTab.Infantry) || tabs.includes(BuildTab.Vehicles),
        ).toBe(true);
      }
      if (role === 'conyard') expect(entry.buildRadius).toBeGreaterThan(0);
    }
  });
});

/* ==========================================================================
 * 7. PERSISTENCE AND RESUME
 * ========================================================================== */

describe('tutorial — progress survives a reload and never traps the player', () => {
  it('uses one versioned key', () => {
    expect(TUTORIAL_STORAGE_KEY).toBe('vm.tutorial.v1');
  });

  it('decodes any garbage into a usable record', () => {
    for (const junk of [null, undefined, '', 'not json', '[]', '7', '{"completed":3}']) {
      const p = decodeProgress(junk as string | null);
      expect(p.furthest).toBe(0);
      expect(p.done).toBe(false);
      expect(p.completed).toEqual([]);
    }
  });

  it('round-trips a real record', () => {
    const p: TutorialProgress = {
      version: 2, furthest: 4, completed: ['camera.move', 'select.one'], done: false,
    };
    expect(decodeProgress(encodeProgress(p))).toEqual(p);
  });

  it('reopens a finished v1 tutorial at the first new lesson without losing old steps', () => {
    const old = decodeProgress(JSON.stringify({
      version: 1,
      furthest: 14,
      completed: [
        'camera.move', 'camera.home', 'select.one', 'select.group',
        'order.move', 'order.attackMove', 'build.deploy', 'build.power',
        'build.refinery', 'economy.harvest', 'build.factory', 'build.produce',
        'build.rally', 'match.victory',
      ],
      done: true,
    }));
    expect(old.version).toBe(2);
    expect(old.done).toBe(false);
    expect(old.completed).toContain('camera.move');
    expect(resumeIndex(old)).toBe(stepIndex('select.controlGroups'));
  });

  it('drops step ids that no longer exist and clamps the cursor', () => {
    const p = decodeProgress(JSON.stringify({
      version: 1,
      furthest: 9999,
      completed: ['camera.move', 'step.that.was.deleted', 'camera.move'],
      done: false,
    }));
    expect(p.completed).toEqual(['camera.move']);
    expect(p.furthest).toBe(TUTORIAL_STEPS.length);
  });

  it('records a completed step without losing the earlier ones', () => {
    let p = emptyProgress();
    p = withStepCompleted(p, TUTORIAL_STEPS[0], 0);
    p = withStepCompleted(p, TUTORIAL_STEPS[1], 1);
    p = withStepCompleted(p, TUTORIAL_STEPS[1], 1); // idempotent
    expect(p.completed).toEqual([TUTORIAL_STEPS[0].id, TUTORIAL_STEPS[1].id]);
    expect(p.furthest).toBe(2);
    expect(p.done).toBe(false);
  });

  it('marks the record done only when every step has been completed', () => {
    let p = emptyProgress();
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
      p = withStepCompleted(p, TUTORIAL_STEPS[i], i);
    }
    expect(p.done).toBe(true);
    expect(progressHint(p)).toBe('Complete');
  });

  /**
   * The honest resume rule. A tutorial run rebuilds the world from an MCV, so
   * a build lesson cannot be resumed into — but the input drill in front of it
   * can be, and a returning player should not have to prove they can pan twice.
   */
  it('skips completed input lessons on a replay and stops at the build chain', () => {
    expect(resumeIndex(emptyProgress())).toBe(0);

    const inputSteps = TUTORIAL_STEPS.filter((s) => !s.worldDependent).map((s) => s.id);
    const all: TutorialProgress = {
      version: 2, furthest: TUTORIAL_STEPS.length, completed: inputSteps, done: false,
    };
    // Stops at the first world-dependent step, never past it.
    expect(resumeIndex(all)).toBe(stepIndex('build.deploy'));

    // A gap in the input drill stops the cursor at the gap.
    const partial: TutorialProgress = {
      version: 2, furthest: 5, completed: ['camera.move', 'select.one'], done: false,
    };
    expect(resumeIndex(partial)).toBe(stepIndex('camera.home'));
  });

  it('never resumes past the end of the list', () => {
    const done: TutorialProgress = {
      version: 2,
      furthest: TUTORIAL_STEPS.length,
      completed: TUTORIAL_STEPS.map((s) => s.id),
      done: true,
    };
    expect(resumeIndex(done)).toBeLessThan(TUTORIAL_STEPS.length);
  });

  it('prints a hint the menu can use at every stage', () => {
    expect(progressHint(emptyProgress())).toBe('Start here');
    expect(progressHint({ version: 2, furthest: 4, completed: [], done: false }))
      .toBe(`Step 5 of ${TUTORIAL_STEPS.length}`);
    expect(progressHint({ version: 2, furthest: 2, completed: [], done: true })).toBe('Complete');
  });
});

/* ==========================================================================
 * 8. THE SPOTLIGHT SELECTORS ARE A CONTRACT
 *
 * The tutorial is not allowed to edit `src/ui/**`, so it rings a HUD element by
 * querying a class that module already emits. That is the standard product-tour
 * approach and it has the standard product-tour failure: the HUD renames a
 * class in a refactor nobody thinks twice about, the ring silently stops
 * appearing, and no test anywhere notices — because the tutorial's own code is
 * still perfectly correct.
 *
 * So the dependency is asserted from THIS side. Every class the step list rings
 * must still be emitted by the module that owns it, and the list of them is
 * pinned so that adding a new dependency is a deliberate edit to a named
 * contract rather than a quiet new coupling.
 * ========================================================================== */

const ROOT = join(__dirname, '..');

/** Where each spotlit class is emitted. Both halves are asserted below. */
const SPOTLIGHT_CONTRACT: Readonly<Record<string, string>> = {
  'vm-dock-map': 'src/ui/Sidebar.ts',
  'vm-dock-selection': 'src/ui/Sidebar.ts',
  'vm-dock-build': 'src/ui/Sidebar.ts',
  'vm-grid': 'src/ui/Sidebar.ts',
  'vm-resources': 'src/ui/Sidebar.ts',
  'vm-res-credits': 'src/ui/Sidebar.ts',
  'vm-objectives': 'src/ui/Objectives.ts',
};

/** Every class token named by any step's spotlight selectors. */
function spotlightClasses(): string[] {
  const out = new Set<string>();
  for (const step of TUTORIAL_STEPS) {
    for (const selector of step.spotlight) {
      const tokens = selector.match(/\.[A-Za-z][\w-]*/g) ?? [];
      for (const t of tokens) out.add(t.slice(1));
    }
  }
  return [...out].sort();
}

describe('tutorial — the HUD classes it rings still exist', () => {
  it('uses only classes on the pinned contract', () => {
    expect(spotlightClasses()).toEqual(Object.keys(SPOTLIGHT_CONTRACT).sort());
  });

  it('every spotlight selector is a plain class selector', () => {
    for (const step of TUTORIAL_STEPS) {
      for (const selector of step.spotlight) {
        expect(selector, `${step.id}: "${selector}"`).toMatch(/^\.[\w-]+( \.[\w-]+)*$/);
      }
    }
  });

  /**
   * The assertion that actually catches the rename. Reading the owning module's
   * source is the only way to check a coupling that is expressed as a string on
   * one side and a `class` attribute on the other.
   */
  it('the owning module still emits each class', () => {
    const cache = new Map<string, string>();
    for (const [cls, owner] of Object.entries(SPOTLIGHT_CONTRACT)) {
      let src = cache.get(owner);
      if (src === undefined) {
        src = readFileSync(join(ROOT, owner), 'utf8');
        cache.set(owner, src);
      }
      // Inside a quoted string, as a whole word: `'vm-dock vm-dock-build'`.
      const rx = new RegExp(`['"\`][^'"\`]*\\b${cls}\\b[^'"\`]*['"\`]`);
      expect(rx.test(src), `${owner} no longer emits .${cls}`).toBe(true);
    }
  });

  /** A step that rings nothing is a choice; a step that rings a typo is a bug. */
  it('only the steps with nothing to point at have an empty spotlight', () => {
    const empty = TUTORIAL_STEPS.filter((s) => s.spotlight.length === 0).map((s) => s.id);
    expect(empty).toEqual(['camera.move', 'order.move', 'order.attackMove']);
  });
});

/* ==========================================================================
 * 9. THE SHELL WIRING
 *
 * Four couplings that cannot be exercised under `environment: 'node'` — they
 * live in a class that owns a WebGL boot — and that each cost a whole run when
 * they were wrong. Asserted against the source, the way
 * `tests/panel-blur-wiring.spec.ts` asserts its own. A source assertion is a
 * weak test; it is still stronger than the nothing that was here before, and
 * `tools/tutorial-playthrough.mjs` covers the same four end to end in a browser.
 * ========================================================================== */

describe('tutorial — the shell launches and tears it down correctly', () => {
  const shell = readFileSync(join(ROOT, 'src/shell/Shell.ts'), 'utf8');
  const menu = readFileSync(join(ROOT, 'src/shell/MainMenu.ts'), 'utf8');
  const tutorial = readFileSync(join(ROOT, 'src/shell/Tutorial.ts'), 'utf8');
  const progression = readFileSync(join(ROOT, 'src/progression/progression.system.ts'), 'utf8');
  const tutorialSystem = readFileSync(join(ROOT, 'src/shell/tutorial.system.ts'), 'utf8');
  const inputSystem = readFileSync(join(ROOT, 'src/input/input.system.ts'), 'utf8');
  const hud = readFileSync(join(ROOT, 'src/ui/Hud.ts'), 'utf8');

  /**
   * `?start=` is the only channel that outranks the lobby's last choice, and
   * the deploy lesson does not exist without it — a pre-built base opening has
   * no construction vehicle to unpack.
   */
  it('forces the MCV opening for a tutorial boot', () => {
    expect(shell).toMatch(/if \(!backdrop && this\.tutorial !== null\) query\.set\('start', 'mcv'\)/);
  });

  it('runs the complete curriculum on a coast with training capital', () => {
    expect(tutorial).toMatch(/TUTORIAL_MAP = 'contested-strait'/);
    expect(tutorial).toMatch(/startingCredits: 30000/);
  });

  it('opens the complete roster only while the tutorial director is live', () => {
    expect(progression).toMatch(/const tutorial = isTutorialRun\(\)/);
    expect(progression).toMatch(/unrestricted: harness \|\| unlockAll \|\| tutorial/);
    expect(shell).not.toMatch(/this\.tutorial !== null[^\n]*unlockall/);
  });

  it('wires the input-only advanced verbs on every shipped control surface', () => {
    for (const action of ['control-group-store', 'control-group-recall', 'formation-use']) {
      expect(inputSystem, `${action} is not emitted by input`).toContain(`'${action}'`);
    }
    expect(inputSystem).toContain("'stance-change'");
    expect(hud).toContain("'stance-change'");
    expect(inputSystem).toContain("'commander-ability'");
    expect(hud).toContain("'commander-ability'");
    expect(hud).toContain("'commander-power'");
  });

  it('confirms world verbs from simulation events or authoritative state', () => {
    for (const event of ['building:captured', 'building:sold', 'entity:veterancy', 'order:issued']) {
      expect(tutorialSystem, `${event} is not observed`).toContain(`'${event}'`);
    }
    expect(tutorialSystem).toContain('EntityFlag.BeingRepaired');
    expect(tutorialSystem).toContain("'garrison-enter'");
    expect(tutorialSystem).toContain("'transport-board'");
    expect(tutorialSystem).toContain("'transport-unload'");
    expect(tutorialSystem).toContain("'superweapon-fire'");
  });

  /** Writing the tutorial's forced map and seed over the lobby would reset it. */
  it('does not persist the tutorial setup over the player\'s lobby', () => {
    expect(shell).toMatch(/startMatch\(tutorialSetup\(this\.setup\), \{ persist: false \}\)/);
  });

  /**
   * Observation starts only after the boot has posed the camera. Before that,
   * `applyCameraPostBoot`'s jump onto the player's base would pay for the entire
   * camera lesson before the player had touched anything.
   */
  it('starts observing after the match boot, not before', () => {
    const start = shell.indexOf('async startTutorial(');
    expect(start).toBeGreaterThan(0);
    const body = shell.slice(start, start + 2400);
    const boot = body.indexOf('await this.startMatch(');
    const observe = body.indexOf('director.beginObserving()');
    expect(boot).toBeGreaterThan(0);
    expect(observe).toBeGreaterThan(boot);
  });

  /**
   * Restart Battle is reachable from the pause menu and from the end screen
   * DURING a tutorial. The plain path rolls a fresh seed — different terrain
   * from the one the steps describe — and never re-arms the director.
   */
  it('restarts a tutorial run as a tutorial run', () => {
    const start = shell.indexOf('async restartMatch(');
    expect(start).toBeGreaterThan(0);
    const body = shell.slice(start, start + 400);
    expect(body).toMatch(/if \(this\.tutorial !== null\) \{\s*await this\.startTutorial\(\);/);
  });

  /** The whole point of the item is the player who has never played an RTS. */
  it('puts the tutorial first on the title screen, accented until it is opened', () => {
    const tutorial = menu.indexOf("button('Tutorial'");
    const skirmish = menu.indexOf("button('Skirmish'");
    expect(tutorial).toBeGreaterThan(0);
    expect(tutorial).toBeLessThan(skirmish);
    expect(menu).toMatch(/const fresh = tutorialUntouched\(\)/);
    expect(menu).toMatch(/variant: fresh \? 'primary' : 'default'/);
    expect(menu).toMatch(/hint: tutorialMenuHint\(\)/);
    expect(menu).toMatch(/void this\.shell\.startTutorial\(\)/);
  });
});
