/**
 * ============================================================================
 * src/shell/Tutorial.ts — the beginner tutorial's director and its coach card
 * ============================================================================
 * WHAT THIS IS
 * ------------
 * A self-contained director that watches a REAL match and walks a new player
 * through fourteen steps: camera, selection, orders, deploying the MCV, the
 * power/refinery/harvest economy loop, production, rally points, and how a
 * match ends. It drives its own step list from `tutorial-steps.ts`, resolves
 * every key it names against the live settings store, and rings the HUD element
 * a step is talking about from its own layer.
 *
 * Read the header of `tutorial-steps.ts` for why this is a director rather than
 * a mission chain, and for the rule that no step may ever spell a key.
 *
 * THREE FILES, THREE JOBS, AND WHY THE SPLIT IS NOT COSMETIC
 * ---------------------------------------------------------
 *   tutorial-steps.ts   pure data and rules. One import (the action
 *                       catalogue). Runs under vitest's node environment.
 *   Tutorial.ts         this file. Owns the DOM and the presentation. Lives in
 *                       the lazily-loaded SHELL chunk.
 *   tutorial.system.ts  the engine wiring. Lives in the MAIN chunk, because
 *                       `src/game/Systems.ts` globs every `*.system.ts` eagerly.
 *
 * That last line is the constraint the whole shape hangs off. If the system
 * module imported this file, the shell chunk — Shell, five screens, shell.css,
 * the settings store — would be pulled into the main bundle, and a `?shot=`
 * boot, which must never load the shell at all, would load all of it. So the
 * system reaches the director through `globalThis.__vmTutorial` and a
 * structural interface, exactly as `src/ui/Objectives.ts` reaches the
 * progression handle and `src/input/input.system.ts` reaches the settings
 * store. The director speaks only numbers and strings; it never sees a `World`.
 *
 * WHERE IT MOUNTS, AND WHY NOT IN THE SHELL'S OWN LAYER
 * ----------------------------------------------------
 * Into `#hud-root`, alongside the HUD rather than inside it. Three consequences
 * and all three are wanted: the shell's `show()` calls `replaceChildren()` on
 * its host and would wipe a layer parked there; `Shell.setHudVisible(false)`
 * hides `#hud-root`, so opening the pause menu hides the coach card for free;
 * and `#hud-root` is `pointer-events: none`, so only the card itself is
 * hit-tested and the battlefield keeps every pixel the card does not cover.
 *
 * IT NEVER MODIFIES THE HUD
 * -------------------------
 * The spotlight is a ring drawn in this layer over coordinates read from
 * `getBoundingClientRect()` on selectors `src/ui/Hud.ts` and
 * `src/ui/Sidebar.ts` already emit. Nothing here writes to a HUD element, and a
 * selector that matches nothing simply hides the ring rather than pointing at
 * the origin.
 * ============================================================================
 */

import './tutorial.css';

import { isApplePlatform } from '../input/ActionCatalogue';
import { computeUiScale } from '../ui/Chrome';
import { codeLabel, type MatchSetup, type SettingsStore } from './settings-store';

import {
  CameraProbe,
  TUTORIAL_STEPS,
  copyFacts,
  emptyFacts,
  noteAcknowledge,
  noteHarvestDeposit,
  noteOrder,
  noteRallyMove,
  noteSelection,
  noteStructure,
  noteUnitProduced,
  progressHint,
  readTutorialProgress,
  resumeIndex,
  stepComplete,
  stepKeyRows,
  withStepCompleted,
  writeTutorialProgress,
  type StructureRole,
  type TutorialFacts,
  type TutorialProgress,
  type TutorialStep,
} from './tutorial-steps';

/* ==========================================================================
 * 1. THE SEAM
 *
 * Everything `tutorial.system.ts` is allowed to call. Restated structurally in
 * that file so it can duck-type this without importing it — see the header.
 * ========================================================================== */

export interface TutorialFeed {
  /** False once the tutorial has ended; the system then stops feeding it. */
  readonly wantsMatch: boolean;
  /** The engine has finished wiring a match. */
  matchStarted(): void;
  /** The engine is being torn down. */
  matchEnded(): void;

  selectionChanged(count: number): void;
  orderIssued(order: number, count: number): void;
  structureCompleted(role: StructureRole): void;
  unitProduced(): void;
  harvestDeposit(): void;
  rallyMoved(): void;
  cameraSample(x: number, z: number, distance: number, homeX: number, homeZ: number): void;

  /** Per rendered frame, from `RenderPhase.Hud`. */
  frame(dt: number): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmTutorial: TutorialFeed | undefined;
}

/* ==========================================================================
 * 2. DOM HELPERS
 *
 * Local, three lines each, deliberately not imported from `./Shell`: this
 * module is constructed while a match is running and must not participate in
 * the Shell <-> screens import cycle that the hoisted-declaration comment in
 * `Shell.ts` exists to manage.
 * ========================================================================== */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pushButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `vt-btn ${className}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/* ==========================================================================
 * 3. THE DIRECTOR
 * ========================================================================== */

export interface TutorialOptions {
  /** Live bindings. The card re-renders whenever a `controls.*` value moves. */
  readonly settings: SettingsStore;
  /**
   * Called once the run is over: `done` is true when the last step was
   * acknowledged, false when the player ended it early. The shell uses this to
   * take the player back to the title screen.
   */
  readonly onEnded: (done: boolean) => void;
  /** Injected for tests and for a host that is not `#hud-root`. */
  readonly mount?: HTMLElement | null;
}

/** How often the spotlight re-measures the HUD, in seconds. */
const SPOT_INTERVAL = 0.12;
/** Metres of padding around the spotlit element, in design units. */
const SPOT_PAD_U = 5;

export class TutorialDirector implements TutorialFeed {
  readonly root: HTMLElement;

  /* -- DOM ------------------------------------------------------------- */
  private readonly card: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly railCells: HTMLElement[] = [];
  private readonly body: HTMLElement;
  private readonly keys: HTMLElement;
  private readonly goals: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly advanceButton: HTMLButtonElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly spot: HTMLElement;

  /* -- state ----------------------------------------------------------- */
  private readonly steps: readonly TutorialStep[];
  private readonly mac = isApplePlatform();
  private index = 0;
  private facts: TutorialFacts = emptyFacts();
  private baseline: TutorialFacts = emptyFacts();
  private probe = new CameraProbe();
  private progress: TutorialProgress;

  /** True between `matchStarted` and `matchEnded`. */
  private attached = false;
  /**
   * True once the shell has finished framing the camera. Feed calls before
   * this are DISCARDED: `Shell.applyCameraPostBoot` jumps the camera onto the
   * player's base six frames after the boot, and counting that jump would pay
   * for the pan lesson before the player had touched anything.
   */
  private observing = false;
  private ended = false;
  private disposed = false;
  private collapsed = false;

  private spotIn = 0;
  private signature = '';
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: TutorialOptions) {
    this.steps = TUTORIAL_STEPS;
    this.progress = readTutorialProgress();
    this.index = Math.min(this.steps.length - 1, resumeIndex(this.progress, this.steps));

    this.root = el('div', 'vt-layer');
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;

    /* -- spotlight, first so the card paints over it -------------------- */
    this.spot = el('div', 'vt-spot');
    this.spot.hidden = true;
    this.root.appendChild(this.spot);

    /* -- card ----------------------------------------------------------- */
    this.card = el('section', 'vt-card');
    this.card.setAttribute('aria-label', 'Tutorial');

    const head = el('div', 'vt-head');
    this.eyebrow = el('span', 'vt-eyebrow', '');
    this.title = el('h2', 'vt-title', '');
    head.appendChild(this.eyebrow);
    head.appendChild(this.title);
    this.card.appendChild(head);

    this.rail = el('div', 'vt-rail');
    for (let i = 0; i < this.steps.length; i++) {
      const cell = el('i');
      this.rail.appendChild(cell);
      this.railCells.push(cell);
    }
    this.card.appendChild(this.rail);

    this.body = el('p', 'vt-body', '');
    this.card.appendChild(this.body);

    this.goals = el('ul', 'vt-goals');
    this.card.appendChild(this.goals);

    this.keys = el('div', 'vt-keys');
    this.card.appendChild(this.keys);

    this.foot = el('div', 'vt-foot');
    this.advanceButton = pushButton('Skip step', '', () => this.advance());
    this.collapseButton = pushButton('Hide', '', () => this.setCollapsed(!this.collapsed));
    this.foot.appendChild(this.advanceButton);
    this.foot.appendChild(el('span', 'vt-spacer'));
    this.foot.appendChild(this.collapseButton);
    this.foot.appendChild(pushButton('End', '', () => this.end(false)));
    this.card.appendChild(this.foot);

    this.root.appendChild(this.card);

    const host = options.mount ?? document.getElementById('hud-root');
    host?.appendChild(this.root);

    this.applyScale();
    this.render();

    window.addEventListener('resize', this.onResize, { passive: true });
    this.unsubscribe = options.settings.subscribe((_s, changed) => {
      for (const path of changed) {
        // A rebind must move the key caps immediately, or the tutorial is
        // teaching a chord the player has already changed.
        if (path.startsWith('controls.')) { this.signature = ''; this.render(); return; }
      }
    });
  }

  /* -------------------------------------------------------------------- */
  /* the feed                                                              */
  /* -------------------------------------------------------------------- */

  get wantsMatch(): boolean {
    return !this.ended && !this.disposed;
  }

  /**
   * A match's systems have initialised. The world exists; the camera has not
   * been posed yet, so observation stays off until the shell says otherwise.
   */
  matchStarted(): void {
    if (!this.wantsMatch) return;
    this.attached = true;
    this.observing = false;
    this.facts = emptyFacts();
    this.baseline = copyFacts(this.facts);
    this.probe = new CameraProbe();
  }

  matchEnded(): void {
    this.attached = false;
    this.observing = false;
    this.root.hidden = true;
    this.spot.hidden = true;
  }

  /**
   * The shell has finished `applyCameraPostBoot` and the player has the camera.
   * Everything observed from here on is the player's doing.
   */
  beginObserving(): void {
    if (!this.wantsMatch || !this.attached) return;
    this.facts = emptyFacts();
    this.baseline = copyFacts(this.facts);
    this.probe = new CameraProbe();
    this.observing = true;
    this.root.hidden = false;
    this.signature = '';
    this.render();
  }

  selectionChanged(count: number): void {
    if (!this.live()) return;
    noteSelection(this.facts, count);
  }

  orderIssued(order: number, count: number): void {
    if (!this.live()) return;
    noteOrder(this.facts, order, count);
  }

  structureCompleted(role: StructureRole): void {
    if (!this.live()) return;
    noteStructure(this.facts, role);
  }

  unitProduced(): void {
    if (!this.live()) return;
    noteUnitProduced(this.facts);
  }

  harvestDeposit(): void {
    if (!this.live()) return;
    noteHarvestDeposit(this.facts);
  }

  rallyMoved(): void {
    if (!this.live()) return;
    noteRallyMove(this.facts);
  }

  cameraSample(x: number, z: number, distance: number, homeX: number, homeZ: number): void {
    if (!this.live()) return;
    this.probe.sample(this.facts, x, z, distance, homeX, homeZ);
  }

  /* -------------------------------------------------------------------- */
  /* frame                                                                 */
  /* -------------------------------------------------------------------- */

  frame(dt: number): void {
    if (!this.live()) return;

    const step = this.steps[this.index];
    if (step !== undefined && stepComplete(step, this.facts, this.baseline)) {
      this.completeStep();
      return;
    }

    this.render();

    this.spotIn -= dt;
    if (this.spotIn <= 0) {
      this.spotIn = SPOT_INTERVAL;
      this.placeSpotlight();
    }
  }

  /* -------------------------------------------------------------------- */
  /* public control                                                        */
  /* -------------------------------------------------------------------- */

  /** The current step index, 0-based. For the harness and the tests. */
  get currentIndex(): number {
    return this.index;
  }

  /** The current step's id, or '' once the run has ended. */
  get currentStepId(): string {
    return this.ended ? '' : (this.steps[this.index]?.id ?? '');
  }

  /** A copy of the observation record. Diagnostics only. */
  snapshot(): TutorialFacts {
    return copyFacts(this.facts);
  }

  /** End the run. `done` distinguishes "finished it" from "walked away". */
  end(done: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.root.hidden = true;
    this.spot.hidden = true;
    if (done) {
      this.progress = { ...this.progress, done: true, furthest: this.steps.length };
      writeTutorialProgress(this.progress);
    }
    this.options.onEnded(done);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.attached = false;
    this.observing = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    if (globalThis.__vmTutorial === this) globalThis.__vmTutorial = undefined;
  }

  /** Publish the seam. The system module finds the director here. */
  publish(): void {
    globalThis.__vmTutorial = this;
  }

  /* -------------------------------------------------------------------- */
  /* internals                                                             */
  /* -------------------------------------------------------------------- */

  private live(): boolean {
    return !this.disposed && !this.ended && this.attached && this.observing;
  }

  /**
   * Advance past the step the player just satisfied.
   *
   * Recorded first, so a run that is abandoned on the next step still keeps
   * what was learned. The new baseline is taken from the CURRENT facts, which
   * is what makes "one more of these since I asked" the completion rule for
   * every step rather than "one of these has ever happened".
   */
  private completeStep(): void {
    const step = this.steps[this.index];
    if (step === undefined) return;
    this.progress = withStepCompleted(this.progress, step, this.index, this.steps);
    writeTutorialProgress(this.progress);

    if (this.index >= this.steps.length - 1) {
      this.end(true);
      return;
    }
    this.index++;
    this.baseline = copyFacts(this.facts);
    this.signature = '';
    this.render();
    this.placeSpotlight();
  }

  /**
   * The escape hatch on every step.
   *
   * A skipped step is NOT recorded as completed — a tutorial that ticks off
   * lessons the player skipped would tell the menu they are done when they are
   * not, and there is no reason to lie about it.
   */
  private skipStep(): void {
    if (!this.live()) return;
    if (this.index >= this.steps.length - 1) {
      this.end(false);
      return;
    }
    this.index++;
    this.progress = {
      ...this.progress,
      furthest: Math.max(this.progress.furthest, this.index),
    };
    writeTutorialProgress(this.progress);
    this.baseline = copyFacts(this.facts);
    this.signature = '';
    this.render();
    this.placeSpotlight();
  }

  /**
   * The advance button. One handler, decided here rather than rebound in
   * `render` — a button that carries both an `addEventListener` and a
   * reassigned `onclick` fires twice, which on the last step would acknowledge
   * the tutorial AND skip past it in the same press.
   */
  private advance(): void {
    if (!this.live()) return;
    if (this.index >= this.steps.length - 1) {
      // The final step is the only one the player asserts himself: there is no
      // world state that means "you have read this".
      noteAcknowledge(this.facts);
      return;
    }
    this.skipStep();
  }

  private setCollapsed(value: boolean): void {
    this.collapsed = value;
    this.body.hidden = value;
    this.keys.hidden = value || this.keys.childElementCount === 0;
    this.goals.hidden = value;
    this.collapseButton.textContent = value ? 'Show' : 'Hide';
  }

  private readonly onResize = (): void => {
    this.applyScale();
    this.placeSpotlight();
  };

  /**
   * One design unit, from the SAME function `src/ui/Hud.ts` feeds `--vm-u`.
   * Two scales that agreed on the day they were written is the failure this
   * avoids; there is one `computeUiScale` and both layers call it.
   */
  private applyScale(): void {
    const h = globalThis.innerHeight || 720;
    this.root.style.setProperty('--vt-u', `${computeUiScale(h)}px`);
  }

  /** Rebuild the card, but only when something visible actually moved. */
  private render(): void {
    const step = this.steps[this.index];
    if (step === undefined) return;

    let sig = `${this.index}`;
    for (const g of step.goals) {
      sig += (this.facts[g.fact] - this.baseline[g.fact] >= g.delta) ? '|1' : '|0';
    }
    if (sig === this.signature) return;
    this.signature = sig;

    this.eyebrow.textContent = `${this.index + 1} / ${this.steps.length}`;
    this.title.textContent = step.title;
    this.body.textContent = step.body;

    for (let i = 0; i < this.railCells.length; i++) {
      const cell = this.railCells[i];
      cell.classList.toggle('is-done', i < this.index);
      cell.classList.toggle('is-now', i === this.index);
    }

    /* -- goals ---------------------------------------------------------- */
    this.goals.replaceChildren();
    for (const g of step.goals) {
      const met = this.facts[g.fact] - this.baseline[g.fact] >= g.delta;
      const row = el('li', met ? 'vt-goal is-done' : 'vt-goal');
      row.appendChild(el('i', 'vt-goal-box'));
      row.appendChild(el('span', undefined, g.label));
      this.goals.appendChild(row);
    }

    /* -- keys ----------------------------------------------------------- */
    const bindings = this.options.settings.get().controls.bindings;
    const rows = stepKeyRows(step, bindings, this.mac, codeLabel);
    this.keys.replaceChildren();
    this.keys.hidden = this.collapsed || rows.length === 0;
    for (const row of rows) {
      const line = el('div', 'vt-keyrow');
      line.appendChild(el('span', 'vt-keyrow-name', row.label));
      const caps = el('div', 'vt-keyrow-caps');
      for (const chip of row.chips) {
        const cls =
          chip.kind === 'plus' ? 'vt-cap is-plus'
            : chip.kind === 'gesture' ? 'vt-cap is-gesture'
              : chip.kind === 'unbound' ? 'vt-cap is-unbound'
                : 'vt-cap';
        caps.appendChild(el('span', cls, chip.text));
      }
      line.appendChild(caps);
      this.keys.appendChild(line);
    }

    /* -- foot ----------------------------------------------------------- */
    const last = this.index >= this.steps.length - 1;
    this.advanceButton.textContent = last ? 'Finish' : 'Skip step';
    this.advanceButton.classList.toggle('is-primary', last);
  }

  /**
   * Move the ring onto whatever the step is pointing at.
   *
   * `transform` rather than `left`/`top` so a re-measure costs a composite and
   * not a layout, and the whole thing is throttled to `SPOT_INTERVAL` because
   * `getBoundingClientRect` is a forced synchronous layout and the HUD is a few
   * hundred nodes.
   */
  private placeSpotlight(): void {
    const step = this.steps[this.index];
    if (step === undefined || !this.live()) {
      this.spot.hidden = true;
      return;
    }

    let rect: DOMRect | null = null;
    for (const selector of step.spotlight) {
      const node = document.querySelector(selector);
      if (node === null) continue;
      const r = node.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      rect = r;
      break;
    }

    if (rect === null) {
      this.spot.hidden = true;
      return;
    }

    const pad = SPOT_PAD_U * computeUiScale(globalThis.innerHeight || 720);
    this.spot.hidden = false;
    this.spot.style.width = `${Math.round(rect.width + pad * 2)}px`;
    this.spot.style.height = `${Math.round(rect.height + pad * 2)}px`;
    this.spot.style.transform =
      `translate(${Math.round(rect.left - pad)}px, ${Math.round(rect.top - pad)}px)`;
  }
}

/* ==========================================================================
 * 4. THE MATCH THE TUTORIAL RUNS OVER
 * ========================================================================== */

/**
 * Sim seed for every tutorial run.
 *
 * The landscape is already pinned by `MapChoice.mapSeed`; this pins everything
 * the simulation rolls on top of it, so the ore field a step points at is in
 * the same place for every player who ever opens the tutorial.
 */
export const TUTORIAL_SEED = 0x7010a1;

/** The starter map. Wooded, three ore fields, the gentlest terrain we ship. */
export const TUTORIAL_MAP = 'temperate-valley';

/**
 * The tutorial's match configuration, laid over whatever the player last used.
 *
 * Their FACTION is deliberately kept: every step is written against structure
 * ROLES rather than content keys (see `classifyStructure`), so the lesson is
 * correct for all four armies, and a first-time player who picked the
 * Reclamation should be taught the Reclamation.
 *
 * Difficulty is Easy and the personality is Turtle — the least aggressive
 * opponent in `AI_DIFFICULTY` x `AI_PERSONALITY`. The opponent cannot simply be
 * switched off: `?ai=off` is rule 1 of `chooseStart` in `game/Scenarios.ts` and
 * forces a pre-built base, which would delete the deploy lesson.
 */
export function tutorialSetup(base: Readonly<MatchSetup>): MatchSetup {
  return {
    ...base,
    map: TUTORIAL_MAP,
    difficulty: 0,
    personality: 0,
    startingCredits: 10000,
    speed: 1,
    seed: TUTORIAL_SEED,
    // ONE OPPONENT, EXPLICITLY. The lesson is written against a single enemy
    // base and a single threat axis, and `...base` would otherwise carry a
    // four-way lobby into it — three Easy Turtles is not the tutorial, and the
    // steps that say "the enemy" would have three answers.
    opponents: [{ faction: base.aiFaction, difficulty: 0, personality: 0 }],
  };
}

/* ==========================================================================
 * 5. MENU HELPERS
 *
 * So `MainMenu.ts` never has to know the storage layout.
 * ========================================================================== */

/** True when the player has never opened the tutorial. Drives the menu accent. */
export function tutorialUntouched(): boolean {
  const p = readTutorialProgress();
  return !p.done && p.furthest <= 0 && p.completed.length === 0;
}

/** The hint under the menu button, from the stored record. */
export function tutorialMenuHint(): string {
  return progressHint(readTutorialProgress());
}
