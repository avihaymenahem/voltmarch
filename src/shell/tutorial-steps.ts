/**
 * ============================================================================
 * src/shell/tutorial-steps.ts — THE TUTORIAL, AS DATA
 * ============================================================================
 * The beginner tutorial is a **director that observes a real match**, not a
 * scripted mission chain. This file is its falsifiable half: the step list, the
 * observation record, the completion rules, the key resolution and the
 * persistence codec — all pure, all import-free except for the action
 * catalogue, and therefore all testable under vitest's `environment: 'node'`.
 * `src/shell/Tutorial.ts` owns the DOM; `src/shell/tutorial.system.ts` owns the
 * engine wiring. Neither owns a rule.
 *
 * WHY A DIRECTOR AND NOT A MISSION CHAIN
 * --------------------------------------
 * `src/progression/**` already has match-scope objectives with live HUD
 * tracking, so a tutorial looks like a mission chain from a distance. It is
 * not, for three reasons. The first has since been RETIRED by the very document
 * it cited; the other two are load-bearing and are the whole reason this file
 * exists:
 *
 *   1. RETIRED — AND KEPT, BECAUSE IT IS A RECORD OF HOW A CITATION ROTS.
 *      `docs/MISSIONS_DESIGN.md` §"Agreed scope" scoped missions to
 *      "objective-driven skirmish — no hand-authored story maps, NO SCRIPTED
 *      TRIGGERS", and this header read that as a prohibition on the ENGINE. It
 *      was a scope fence around THAT DOCUMENT. The campaign is the second
 *      system to want scripted triggers, it is a separate consumer rather than
 *      a widening of the mission model, and the row now says so — see that
 *      file's §"The content-model row said no scripted triggers". Nothing about
 *      the tutorial changed when it moved: reasons 2 and 3 always did the work,
 *      and widening `MissionRule` is still refused for exactly them.
 *      The citation also read "line 18" for a line that had drifted to 23 by
 *      the time anybody checked. **Cite a section, never a line number.**
 *   2. A mission advances a COUNTER off an event. A tutorial step has to know
 *      "the camera has travelled 30 m since this step began", "the rally flag
 *      of a factory that already had one has moved", "one harvester load has
 *      landed since you were told to watch for it". Those are deltas against a
 *      per-step baseline, which the mission rule language has no concept of.
 *   3. The objectives panel reads ONE global provider, `__vmProgression`,
 *      owned by the progression system. Rendering tutorial steps through it
 *      means a second writer on a singleton another module owns — and the
 *      panel caps at three rows, has no room for a key cap, a spotlight or a
 *      skip button. Display goes in the tutorial's own layer instead.
 *
 * THE ONE RULE THAT MATTERS: NO STEP MAY NAME A KEY
 * -------------------------------------------------
 * This product has already shipped an Options screen advertising W/A/S/D while
 * the code read the arrow keys, and it reached a player. So a step never spells
 * a key in its prose. It lists CATALOGUE ACTION IDS, and `actionKeyRow` below
 * resolves each one against the live settings store exactly as
 * `src/shell/Help.ts` does. Rebind Attack Move and the tutorial teaches the new
 * chord on the next frame. `tests/tutorial.spec.ts` asserts both halves: every
 * id resolves, and no step's prose contains an imperative followed by a key
 * name.
 *
 * EVERY FACT IS MONOTONIC
 * -----------------------
 * `TutorialFacts` is a bag of counters that only ever go up. A step is complete
 * when `facts[goal.fact] - baseline[goal.fact] >= goal.delta`, where `baseline`
 * is a copy taken the instant the step opened. That single shape is why there
 * is not one timer anywhere in this feature: a player who deployed their MCV
 * before being asked still has to do the NEXT thing, and a player who did
 * nothing is never advanced past a step they did not perform.
 * ============================================================================
 */

import {
  actionById,
  isModifierName,
  modifierChips,
  modifierLabel,
  type ActionDef,
  type StoredBindings,
} from '../input/ActionCatalogue';
import { persistentStorage } from '../platform/storage';
import type { TutorialAction } from '../core/tutorial';
export type { TutorialAction } from '../core/tutorial';

/* ==========================================================================
 * 1. THE OBSERVATION RECORD
 * ========================================================================== */

/**
 * Everything the director has seen since the match began.
 *
 * Every field is a monotonically non-decreasing counter, which is what makes a
 * per-step baseline subtraction a correct completion test. Nothing here is a
 * clock and nothing here is sampled from `Date.now()`.
 */
export interface TutorialFacts {
  /** `selection:changed` dispatches that left at least one thing selected. */
  selections: number;
  /** ...that left two or more selected. */
  groupSelections: number;
  /** `order:issued` with `OrderKind.Move`, from the local player. */
  moveOrders: number;
  /** `order:issued` with `OrderKind.AttackMove`, from the local player. */
  attackMoveOrders: number;
  /** A selection was stored into one of the ten control groups. */
  controlGroupsStored: number;
  /** A stored control group was recalled. */
  controlGroupsRecalled: number;
  /** The selected force was assigned a combat stance. */
  stanceChanges: number;
  /** The explicit formation planner arranged a multi-unit selection. */
  formationsUsed: number;
  /** An `Enter` order addressed a garrisonable structure. */
  garrisonOrders: number;
  /** A building actually changed hands to the local player. */
  buildingsCaptured: number;
  /** A damaged local structure actually entered drip-repair. */
  repairsStarted: number;
  /** A local structure was sold and paid its refund. */
  buildingsSold: number;
  /** An `Enter` order addressed a troop transport. */
  transportBoards: number;
  /** A loaded transport received an unload order. */
  transportUnloads: number;
  /** A selected commander's personal ability was fired. */
  commanderAbilities: number;
  /** A base-wide commander power was called from the Powers bar. */
  commanderPowers: number;
  /** A charged superweapon received its committed fire order. */
  superweaponsFired: number;
  /** A local unit gained a veterancy rank through combat. */
  veterancyRanks: number;
  /** `building:completed` classified as a construction yard. */
  conyards: number;
  /** ...classified as a power source. */
  powerPlants: number;
  /** ...classified as a refinery. */
  refineries: number;
  /** ...classified as a unit factory (infantry or vehicles). */
  unitFactories: number;
  /** `production:ready` for something that is not a structure. */
  unitsProduced: number;
  /** `economy:credits` with a positive delta and a harvest reason. */
  harvestDeposits: number;
  /** A factory's EXISTING rally flag moved. See `noteRallyMove`. */
  rallyMoves: number;
  /** Metres of camera focus travel, accumulated per frame. */
  camPanTravel: number;
  /** Accumulated |ln(distance ratio)| of camera dolly, per frame. */
  camZoomTravel: number;
  /** Times the camera came back to the base after being well away from it. */
  homeReturns: number;
  /** Times the player pressed the card's own confirm button. */
  acknowledged: number;
}

/** A fresh record. Every counter starts at zero. */
export function emptyFacts(): TutorialFacts {
  return {
    selections: 0,
    groupSelections: 0,
    moveOrders: 0,
    attackMoveOrders: 0,
    controlGroupsStored: 0,
    controlGroupsRecalled: 0,
    stanceChanges: 0,
    formationsUsed: 0,
    garrisonOrders: 0,
    buildingsCaptured: 0,
    repairsStarted: 0,
    buildingsSold: 0,
    transportBoards: 0,
    transportUnloads: 0,
    commanderAbilities: 0,
    commanderPowers: 0,
    superweaponsFired: 0,
    veterancyRanks: 0,
    conyards: 0,
    powerPlants: 0,
    refineries: 0,
    unitFactories: 0,
    unitsProduced: 0,
    harvestDeposits: 0,
    rallyMoves: 0,
    camPanTravel: 0,
    camZoomTravel: 0,
    homeReturns: 0,
    acknowledged: 0,
  };
}

/** A snapshot, for use as a step baseline. */
export function copyFacts(f: Readonly<TutorialFacts>): TutorialFacts {
  return { ...f };
}

/* -- event feeders. Pure functions over the record; no engine types. ------- */

/** `selection:changed`. */
export function noteSelection(f: TutorialFacts, count: number): void {
  if (count >= 1) f.selections++;
  if (count >= 2) f.groupSelections++;
}

/**
 * `order:issued`. `order` is a raw `OrderKind` value, deliberately taken as a
 * number: this module must stay importable with no engine dependency, and the
 * two constants it cares about are frozen in `src/core/types.ts`.
 */
export const ORDER_MOVE = 1;
export const ORDER_ATTACK_MOVE = 2;

export function noteOrder(f: TutorialFacts, order: number, count: number): void {
  if (count <= 0) return;
  if (order === ORDER_MOVE) f.moveOrders++;
  else if (order === ORDER_ATTACK_MOVE) f.attackMoveOrders++;
}

/**
 * Player verbs that are not all represented by one engine event.
 *
 * The strings are deliberately semantic rather than tied to a button: stance
 * can be changed from a key or a HUD icon, commander ability can be fired from
 * either surface, and the tutorial must accept both. The bridge below is also
 * used by input/HUD actions that write directly to the command bus and
 * therefore never produce `order:issued`.
 */
export function noteTutorialAction(f: TutorialFacts, action: TutorialAction): void {
  switch (action) {
    case 'control-group-store': f.controlGroupsStored++; break;
    case 'control-group-recall': f.controlGroupsRecalled++; break;
    case 'stance-change': f.stanceChanges++; break;
    case 'formation-use': f.formationsUsed++; break;
    case 'garrison-enter': f.garrisonOrders++; break;
    case 'building-capture': f.buildingsCaptured++; break;
    case 'repair-start': f.repairsStarted++; break;
    case 'building-sell': f.buildingsSold++; break;
    case 'transport-board': f.transportBoards++; break;
    case 'transport-unload': f.transportUnloads++; break;
    case 'commander-ability': f.commanderAbilities++; break;
    case 'commander-power': f.commanderPowers++; break;
    case 'superweapon-fire': f.superweaponsFired++; break;
    case 'veterancy-rank': f.veterancyRanks++; break;
  }
}

/** `building:completed`, already classified by `classifyStructure`. */
export function noteStructure(f: TutorialFacts, role: StructureRole): void {
  switch (role) {
    case 'conyard': f.conyards++; break;
    case 'power': f.powerPlants++; break;
    case 'refinery': f.refineries++; break;
    case 'factory': f.unitFactories++; break;
    default: break;
  }
}

/** `production:ready` with `isBuilding === false`. */
export function noteUnitProduced(f: TutorialFacts): void {
  f.unitsProduced++;
}

/** `economy:credits`, positive delta, harvest reason. */
export function noteHarvestDeposit(f: TutorialFacts): void {
  f.harvestDeposits++;
}

/** A rally flag that already existed has been moved. */
export function noteRallyMove(f: TutorialFacts): void {
  f.rallyMoves++;
}

/** The card's confirm button. The only completion the player asserts himself. */
export function noteAcknowledge(f: TutorialFacts): void {
  f.acknowledged++;
}

/* ==========================================================================
 * 2. STRUCTURE CLASSIFICATION
 *
 * `building:completed` carries a def index and nothing else, and four armies
 * spell every structure differently — `refinery`, `mrdCistern`, `rclSorter`.
 * Matching keys with a regular expression is how a fifth faction silently
 * breaks the tutorial, so the roles are read off the SHAPE of the catalogue
 * entry instead. Every property below is already load-bearing gameplay data:
 * `buildRadius` is what `Placement.ts` tests, `shipsWith` exists on exactly the
 * three refineries, `power` is what the brownout maths reads.
 * ========================================================================== */

/** The four structures the tutorial has something to say about. */
export type StructureRole = 'conyard' | 'power' | 'refinery' | 'factory' | 'other';

/** The catalogue fields the classifier reads. Structural on purpose. */
export interface StructureShape {
  /** Positive generates power. */
  readonly power: number;
  /** Content key of a unit this structure hands over free. Refineries only. */
  readonly shipsWith: string;
  /** Metres within which this structure permits new construction. */
  readonly buildRadius: number;
  /** `BuildTab` values this structure services. */
  readonly producesTabs: readonly number[];
}

/** `BuildTab` values, restated so this module needs no engine import. */
const TAB_STRUCTURES = 0;
const TAB_INFANTRY = 2;
const TAB_VEHICLES = 3;

/**
 * Which lesson a finished structure belongs to.
 *
 * Order matters. A construction yard also services the structures tab and a
 * refinery may also store credits, so the most specific test wins: only a
 * construction yard opens a build radius, and only a refinery ships a
 * harvester.
 */
export function classifyStructure(s: StructureShape): StructureRole {
  if (s.buildRadius > 0 && s.producesTabs.includes(TAB_STRUCTURES)) return 'conyard';
  if (s.shipsWith !== '') return 'refinery';
  if (s.producesTabs.includes(TAB_INFANTRY) || s.producesTabs.includes(TAB_VEHICLES)) return 'factory';
  if (s.power > 0) return 'power';
  return 'other';
}

/* ==========================================================================
 * 3. THE CAMERA PROBE
 *
 * The camera publishes no events — it is a render-side rig that a player drags
 * with the mouse — so the two camera lessons are measured by sampling its pose
 * once per frame. This is state, not a timer: a player who never moves the view
 * never advances, however long they sit there.
 * ========================================================================== */

/** Metres from home that counts as "you have left the base". */
export const CAM_HOME_FAR = 42;
/** Metres from home that counts as "you are back". */
export const CAM_HOME_NEAR = 6;
/** A single frame's focus jump beyond this is ignored as a teleport. */
const CAM_JUMP_CLAMP = 400;

/**
 * Turns a stream of camera poses into two monotonic counters and a
 * left-then-returned edge detector.
 *
 * Stateful, and deliberately a class rather than four module-level variables:
 * a match teardown throws the instance away, which is the whole of its reset.
 */
export class CameraProbe {
  private hasPrev = false;
  private prevX = 0;
  private prevZ = 0;
  private prevDistance = 1;
  /** True once the camera has been further than `CAM_HOME_FAR` from home. */
  private away = false;

  /**
   * Fold one pose into the record.
   *
   * @param x        camera target focus X, metres
   * @param z        camera target focus Z, metres
   * @param distance camera dolly distance, metres
   * @param homeX    where "centre on base" goes
   * @param homeZ    ditto
   */
  sample(
    f: TutorialFacts,
    x: number,
    z: number,
    distance: number,
    homeX: number,
    homeZ: number,
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(distance)) return;
    const d = distance > 0.01 ? distance : 0.01;

    if (this.hasPrev) {
      const dx = x - this.prevX;
      const dz = z - this.prevZ;
      const travel = Math.sqrt(dx * dx + dz * dz);
      // A pose set by the shell's own framing (`applyCameraPostBoot` jumps the camera
      // onto the player's base) would otherwise pay for the whole pan lesson.
      if (travel < CAM_JUMP_CLAMP) f.camPanTravel += travel;
      f.camZoomTravel += Math.abs(Math.log(d / this.prevDistance));
    }

    this.prevX = x;
    this.prevZ = z;
    this.prevDistance = d;
    this.hasPrev = true;

    const hx = x - homeX;
    const hz = z - homeZ;
    const fromHome = Math.sqrt(hx * hx + hz * hz);
    if (fromHome > CAM_HOME_FAR) {
      this.away = true;
    } else if (this.away && fromHome <= CAM_HOME_NEAR) {
      this.away = false;
      f.homeReturns++;
    }
  }
}

/* ==========================================================================
 * 4. STEPS
 * ========================================================================== */

/** One measurable thing a step asks for. */
export interface TutorialGoal {
  /** Shown as a checklist row. Never names a key. */
  readonly label: string;
  readonly fact: keyof TutorialFacts;
  /** How far the fact must move since the step opened. */
  readonly delta: number;
}

export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  /** Two or three sentences. What to do, and why it matters. No key names. */
  readonly body: string;
  /**
   * `ActionDef.id`s whose CURRENT binding this step teaches. Rendered as key
   * caps by `actionKeyRow`; never written out in `body`.
   */
  readonly actions: readonly string[];
  /**
   * CSS selectors for the HUD element to ring, most specific first. The
   * tutorial may not modify `src/ui/**`, so these are a CONTRACT against the
   * classes `Hud.ts` and `Sidebar.ts` already emit — see the module report.
   */
  readonly spotlight: readonly string[];
  readonly goals: readonly TutorialGoal[];
  /**
   * True when the step can only be satisfied by a world that has been built
   * up. Those steps always re-run on a replay, because the tutorial rebuilds
   * the match from scratch and there is no honest way to resume into a base
   * that no longer exists. See `resumeIndex`.
   */
  readonly worldDependent: boolean;
}

/**
 * The lesson plan.
 *
 * Ordered by what the ENGINE forces, not by what reads tidily. Power comes
 * before the refinery because `powerPlant` is the refinery's prerequisite in
 * `src/sim/Production.ts`; teaching the economy first and the power grid last
 * would put the player in front of a greyed-out cameo with no explanation.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'camera.move',
    title: 'Move The View',
    body:
      'The battlefield is several times wider than the screen. Slide the view across it, ' +
      'and dolly the camera in and out — you fight zoomed in and you read the map zoomed out. ' +
      'Do both before moving on.',
    /* THE ZOOM HALF OF THIS STEP WAS UNWINNABLE ON A TRACKPAD. The goal gates
     * on `camZoomTravel >= 0.3`, and the only zoom this list named was
     * `cam.wheelZoom` — so a laptop player was shown a chip reading "Mouse
     * wheel", plus two chips for gestures that PAN, and asked to dolly. Every
     * zoom route the game has is named here now, keyboard first, because
     * `stepKeyRows` renders one chip per listed action and the first thing a
     * stuck player reads should be one they can definitely perform.
     * `tests/tutorial.spec.ts` holds the RULE — this step must name a zoom that
     * needs no wheel — rather than the list, because a literal list is how the
     * gap shipped. */
    actions: [
      'cam.panUp', 'cam.panLeft', 'cam.zoomIn', 'cam.zoomOut',
      'cam.wheelZoom', 'cam.trackpadZoom', 'cam.pinchZoom', 'cam.trackpadPan', 'cam.dragPan',
    ],
    spotlight: [],
    goals: [
      { label: 'Slide the view across the field', fact: 'camPanTravel', delta: 30 },
      { label: 'Zoom the camera in and out', fact: 'camZoomTravel', delta: 0.3 },
    ],
    worldDependent: false,
  },
  {
    id: 'camera.home',
    title: 'Find Your Way Home',
    body:
      'Losing track of your own base is the classic beginner mistake, so there is one command ' +
      'that always brings the view back to it. The tactical map in the corner takes you anywhere ' +
      'else. Travel well away from your base, then come back.',
    actions: ['cam.home', 'cam.minimapJump', 'cam.minimapDrag'],
    spotlight: ['.vm-dock-map'],
    goals: [
      { label: 'Leave the base, then return to it', fact: 'homeReturns', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'select.one',
    title: 'Select A Unit',
    body:
      'Nothing takes an order until it is selected. Click one of your vehicles — the panel at the ' +
      'bottom of the screen fills in with what you picked, its health and its stance.',
    actions: ['sel.click', 'sel.sameType', 'sel.clear'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Select a single unit', fact: 'selections', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'select.group',
    title: 'Select The Whole Group',
    body:
      'Drag a box across your units to take all of them at once. Dragging over your own base is ' +
      'safe: if the box holds any mobile units, only those come back, so you never end up with six ' +
      'buildings you cannot order.',
    actions: ['sel.box', 'sel.add', 'sel.toggle', 'sel.allArmy'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Select two or more units at once', fact: 'groupSelections', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'select.controlGroups',
    title: 'Make The Army Recallable',
    body:
      'A drag box is for assembling a force once; a control group is how you keep that force ' +
      'for the whole battle. Store the current selection in any numbered group, clear or change ' +
      'the selection, then recall the group. Double-recalling it also takes the camera there.',
    actions: ['sel.groupSet', 'sel.groupAppend', 'sel.groupRecall', 'sel.groupAdd', 'sel.groupCentre'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Store the selected force as a control group', fact: 'controlGroupsStored', delta: 1 },
      { label: 'Recall a stored control group', fact: 'controlGroupsRecalled', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'order.move',
    title: 'Give A Move Order',
    body:
      'With something selected, the contextual order sends it to the ground under the cursor. The ' +
      'same order means attack on an enemy, harvest on ore, and capture with an engineer — it reads ' +
      'whatever is beneath the pointer, so it is the only order you need most of the time.',
    actions: ['ord.context', 'ord.queue', 'ord.forceMove', 'ord.stop'],
    spotlight: [],
    goals: [
      { label: 'Send a unit somewhere', fact: 'moveOrders', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'order.attackMove',
    title: 'Attack Move',
    body:
      'A plain move drives your column straight past a fight and into the enemy base with half its ' +
      'health gone. Attack move arms the cursor instead: the next click sets the destination, and ' +
      'the column engages whatever it meets on the way. New players never find this one, and it ' +
      'wins more fights than any unit does.',
    actions: ['ord.attackMove', 'ord.cancelMode', 'ord.guard'],
    spotlight: [],
    goals: [
      { label: 'Issue one attack-move order', fact: 'attackMoveOrders', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'order.stance',
    title: 'Choose How They Fight',
    body:
      'Stance controls what units do when you are looking elsewhere. Aggressive pursues, ' +
      'defensive answers nearby fire, hold fire preserves concealment, and hold ground refuses ' +
      'the chase. Change the selected group once and watch the stance badge update.',
    actions: ['ord.stance', 'ord.stanceButtons'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Change the selection stance', fact: 'stanceChanges', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'order.formation',
    title: 'Shape The Formation',
    body:
      'A column is fast through a road and terrible under artillery. Use the formation strip to ' +
      'turn a selected group into a line, box, wedge or arc; the game assigns a real destination ' +
      'to every unit, so this is positioning rather than a cosmetic icon.',
    actions: ['ord.formations', 'ord.scatter'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Arrange at least two units into a formation', fact: 'formationsUsed', delta: 1 },
    ],
    worldDependent: false,
  },
  {
    id: 'build.deploy',
    title: 'Deploy The Construction Vehicle',
    body:
      'A match begins as one vehicle. Drive it onto open, flat ground and unpack it — it becomes ' +
      'your Construction Yard, and nothing at all can be built until it does. It unfolds exactly ' +
      'where it stands, so this is not a move order: position it first, then deploy.',
    actions: ['ord.deploy', 'ord.context'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Deploy into a Construction Yard', fact: 'conyards', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'build.power',
    title: 'Power Comes First',
    body:
      'A power plant is the cheapest thing on the list and always the first build. Everything you ' +
      'put down draws power, and the moment consumption passes production you brown out: ' +
      'construction slows to a crawl and beam and tesla defences go dark while the enemy is still ' +
      'shooting. Queue one, and when its cameo reads READY, click that cameo to pick it up and ' +
      'click the ground to put it down.',
    actions: [
      'bld.tabKeys', 'bld.slotKeys', 'bld.queue', 'bld.pickUp',
      'bld.rotateLeft', 'bld.rotateRight', 'bld.place', 'bld.cancelPlace',
    ],
    spotlight: ['.vm-dock-build .vm-grid', '.vm-dock-build'],
    goals: [
      { label: 'Finish a power plant', fact: 'powerPlants', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'build.refinery',
    title: 'Build A Refinery',
    body:
      'Ore is the only income in this game. A refinery arrives with one harvester of its own, and ' +
      'that harvester — not your tanks — is your economy. The second refinery is usually worth more ' +
      'than the second war factory.',
    actions: ['bld.slotKeys', 'bld.queue', 'bld.place'],
    spotlight: ['.vm-dock-build .vm-grid', '.vm-dock-build'],
    goals: [
      { label: 'Finish an ore refinery', fact: 'refineries', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'economy.harvest',
    title: 'Watch The Money Arrive',
    body:
      'Your harvester drives to the nearest ore field, fills up, and drives back to unload. Credits ' +
      'only move when it docks, which is why a harvester lost on the way costs you far more than it ' +
      'was worth. Watch the credit readout and wait for the first load to land.',
    actions: ['cam.minimapJump'],
    spotlight: ['.vm-res-credits', '.vm-resources'],
    goals: [
      { label: 'Bank one harvester load', fact: 'harvestDeposits', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'build.factory',
    title: 'Build Something That Produces',
    body:
      'A barracks trains infantry and is cheap; a war factory builds vehicles, including more ' +
      'harvesters, and is not. Put one of them down — until you do, the infantry and vehicle tabs ' +
      'have nothing in them.',
    actions: ['bld.tabKeys', 'bld.slotKeys', 'bld.place'],
    spotlight: ['.vm-dock-build .vm-grid', '.vm-dock-build'],
    goals: [
      { label: 'Finish a barracks or a war factory', fact: 'unitFactories', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'build.produce',
    title: 'Produce A Unit',
    body:
      'Switch to the tab your new factory feeds and pick a cameo to queue one. Pick it again to ' +
      'queue another; the contextual cancel on a cameo removes one from the queue and refunds it.',
    actions: ['bld.tabKeys', 'bld.queue', 'bld.cancel', 'bld.slotKeys'],
    spotlight: ['.vm-dock-build .vm-grid', '.vm-dock-build'],
    goals: [
      { label: 'Finish producing one unit', fact: 'unitsProduced', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'build.rally',
    title: 'Set A Rally Point',
    body:
      'New units walk to their factory rally flag instead of piling up in the doorway. Select the ' +
      'factory and move its flag to where you want the army to gather — somewhere covered, not in ' +
      'the middle of your refinery traffic.',
    actions: ['ord.rally', 'ord.context'],
    spotlight: ['.vm-dock-selection', '.vm-dock-build'],
    goals: [
      { label: 'Move a factory rally flag', fact: 'rallyMoves', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'field.garrison',
    title: 'Occupy Civilian Cover',
    body:
      'The civilian blocks around the central lane are battlefield cover, not scenery. Send an ' +
      'infantry squad into one to protect it behind the building armour; selecting the occupied ' +
      'block exposes the same deploy command to evacuate its defenders.',
    actions: ['ord.context', 'ord.deploy'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Order infantry into a civilian structure', fact: 'garrisonOrders', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'field.capture',
    title: 'Capture With An Engineer',
    body:
      'Engineers take structures instead of merely damaging them. Select one, send it to a ' +
      'neutral or hostile building, and keep it alive until the deed changes hands; captured ' +
      'civilian income and production both work for their new owner.',
    actions: ['ord.context'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Capture one structure with an engineer', fact: 'buildingsCaptured', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'base.repair',
    title: 'Repair Before It Falls',
    body:
      'Damaged structures do not heal by waiting. Arm the repair tool and click one of your ' +
      'damaged buildings; it spends credits over time and can be toggled off the same way. The ' +
      'lesson advances only after a real damaged structure begins repairing.',
    actions: ['bld.repair'],
    spotlight: ['.vm-dock-build'],
    goals: [
      { label: 'Start repairing a damaged structure', fact: 'repairsStarted', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'base.sell',
    title: 'Sell What You Cannot Hold',
    body:
      'A doomed or misplaced building is still money and crew. Arm the sell tool and choose a ' +
      'structure you can spare; damaged structures refund less, so selling before the final hit ' +
      'is an economic decision rather than a surrender animation.',
    actions: ['bld.sell'],
    spotlight: ['.vm-dock-build'],
    goals: [
      { label: 'Sell one of your structures', fact: 'buildingsSold', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'naval.transport',
    title: 'Make An Amphibious Crossing',
    body:
      'This strait has no safe land shortcut. Build a naval yard and transport, order troops ' +
      'aboard by sending them to the hull, cross the water, then unload on the far shore. The ' +
      'cargo row on a selected transport shows exactly how many seats are occupied.',
    actions: ['ord.context', 'ord.deploy'],
    spotlight: ['.vm-dock-selection', '.vm-dock-build'],
    goals: [
      { label: 'Order troops aboard a transport', fact: 'transportBoards', delta: 1 },
      { label: 'Unload a transport after the crossing', fact: 'transportUnloads', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'powers.commanderAbility',
    title: 'Use The Commander In The Field',
    body:
      'Each faction commander carries a personal ability centred on their current position. ' +
      'Produce and select the commander, move them where the effect matters, then fire the ' +
      'ability from the selection panel or its live binding.',
    actions: ['ord.ability'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Fire a commander ability', fact: 'commanderAbilities', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'powers.commander',
    title: 'Call A Commander Power',
    body:
      'A Command Post opens the Powers tab. Buy one base-wide power there, wait for its charge, ' +
      'then arm the ready row and choose a target point; unlike the commander ability, this ' +
      'belongs to the whole army and still works when the commander is elsewhere.',
    actions: ['bld.tab', 'bld.queue', 'power.call'],
    spotlight: ['.vm-dock-build'],
    goals: [
      { label: 'Call one charged commander power', fact: 'commanderPowers', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'powers.superweapon',
    title: 'Commit A Superweapon',
    body:
      'Superweapons are structures with a global countdown, not ordinary unit abilities. Build ' +
      'one from the late-tech chain, protect it until the countdown is ready, then arm its row ' +
      'and commit the target. The enemy sees the same race and can destroy the structure first.',
    actions: ['bld.queue', 'bld.place', 'power.superweapon'],
    spotlight: ['.vm-dock-build'],
    goals: [
      { label: 'Fire one charged superweapon', fact: 'superweaponsFired', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'combat.veterancy',
    title: 'Keep Veterans Alive',
    body:
      'Units that survive combat earn veterancy ranks and become better assets than fresh ' +
      'replacements. Let one of your units secure enough combat experience to gain a chevron, ' +
      'then pull damaged veterans back instead of feeding them into the next exchange.',
    actions: ['ord.attackMove', 'ord.guard', 'ord.stanceButtons'],
    spotlight: ['.vm-dock-selection'],
    goals: [
      { label: 'Promote one unit through combat', fact: 'veterancyRanks', delta: 1 },
    ],
    worldDependent: true,
  },
  {
    id: 'match.victory',
    title: 'How A Match Ends',
    body:
      'The match is over when one side has no buildings and no units left standing. Optional ' +
      'objectives — extra goals that pay out unlocks — appear in the panel at the top right, and the ' +
      'pause menu lists them in full alongside every command in the game. You now know both loops: ' +
      'harvest, build and push — then preserve, reposition and spend the advantages you earned.',
    actions: ['sys.menu', 'ui.help'],
    spotlight: ['.vm-objectives', '.vm-resources'],
    goals: [
      { label: 'Finish the tutorial', fact: 'acknowledged', delta: 1 },
    ],
    worldDependent: false,
  },
];

/** True when this goal has been met since `baseline`. */
export function goalMet(
  goal: TutorialGoal,
  facts: Readonly<TutorialFacts>,
  baseline: Readonly<TutorialFacts>,
): boolean {
  return facts[goal.fact] - baseline[goal.fact] >= goal.delta;
}

/** True when every goal on the step has been met since `baseline`. */
export function stepComplete(
  step: TutorialStep,
  facts: Readonly<TutorialFacts>,
  baseline: Readonly<TutorialFacts>,
): boolean {
  for (const g of step.goals) if (!goalMet(g, facts, baseline)) return false;
  return true;
}

/** Index of a step by id, or -1. */
export function stepIndex(id: string, steps: readonly TutorialStep[] = TUTORIAL_STEPS): number {
  for (let i = 0; i < steps.length; i++) if (steps[i].id === id) return i;
  return -1;
}

/* ==========================================================================
 * 5. KEY RESOLUTION
 *
 * The whole point of the feature. Nothing below invents a label: chords come
 * from the live settings store through `liveChordFor`, modifier glyphs from
 * `modifierLabel`, and the key name itself from a `labelFor` the caller
 * supplies — `codeLabel` in `src/shell/settings-store.ts`, which is the
 * layout-independent table Help.ts and the Options screen already share.
 * Passing it in rather than importing it is what keeps this module's only
 * import the catalogue, so `tutorial.system.ts` can read the classifier above
 * without dragging the shell chunk into the main bundle.
 * ========================================================================== */

/** One drawn token. `plus` is a separator, not a key. */
export type TutorialChipKind = 'key' | 'plus' | 'gesture' | 'unbound';

export interface TutorialChip {
  readonly text: string;
  readonly kind: TutorialChipKind;
}

export interface TutorialKeyRow {
  /** The action's own name, from the catalogue. */
  readonly label: string;
  readonly chips: readonly TutorialChip[];
}

function key(text: string): TutorialChip { return { text, kind: 'key' }; }
const PLUS: TutorialChip = { text: '+', kind: 'plus' };

/** Join key names with `+` separators. */
function joinPlus(names: readonly string[]): TutorialChip[] {
  const out: TutorialChip[] = [];
  for (let i = 0; i < names.length; i++) {
    if (i > 0) out.push(PLUS);
    out.push(key(names[i]));
  }
  return out;
}

/**
 * The chips for one catalogue action, against the bindings the player has RIGHT
 * NOW.
 *
 * Returns null for an id the catalogue does not know, which is a programming
 * error the test catches rather than a state to render. The four cases mirror
 * `renderKeys` in `src/shell/Help.ts` exactly, because two screens disagreeing
 * about what a key is called is the same bug in a smaller font.
 */
export function actionKeyRow(
  actionId: string,
  bindings: StoredBindings,
  mac: boolean,
  labelFor: (code: string) => string,
): TutorialKeyRow | null {
  const def = actionById(actionId);
  if (def === undefined) return null;

  if (def.binding === 'rebindable') {
    const live = liveChord(def, bindings);
    if (live === null) {
      return { label: def.label, chips: [{ text: 'Unbound', kind: 'unbound' }] };
    }
    return { label: def.label, chips: joinPlus([...modifierChips(live, mac), labelFor(live.code)]) };
  }

  if (def.fixedChips !== undefined) {
    const names = def.fixedChips.map((c) => (isModifierName(c) ? modifierLabel(c, mac) : c));
    if (def.chipJoin === 'list') {
      return { label: def.label, chips: names.map(key) };
    }
    return { label: def.label, chips: joinPlus(names) };
  }

  if (def.defaultChord !== null) {
    return {
      label: def.label,
      chips: joinPlus([...modifierChips(def.defaultChord, mac), labelFor(def.defaultChord.code)]),
    };
  }

  return { label: def.label, chips: [{ text: def.gesture ?? '—', kind: 'gesture' }] };
}

/**
 * The chord an action is on right now.
 *
 * A stored row with an empty `code` means the player deliberately cleared the
 * binding and must be reported as unbound, never silently replaced by the
 * default — the same rule `liveChordFor` in the catalogue applies, restated
 * here only so this function can take an `ActionDef` it has already resolved.
 */
function liveChord(
  def: ActionDef,
  bindings: StoredBindings,
): { code: string; ctrl: boolean; shift: boolean; alt: boolean } | null {
  const stored = bindings[def.id];
  if (stored !== undefined && typeof stored.code === 'string') {
    if (stored.code === '') return null;
    return {
      code: stored.code,
      ctrl: stored.ctrl === true,
      shift: stored.shift === true,
      alt: stored.alt === true,
    };
  }
  return def.defaultChord;
}

/** Every key row a step teaches, in the order the step listed them. */
export function stepKeyRows(
  step: TutorialStep,
  bindings: StoredBindings,
  mac: boolean,
  labelFor: (code: string) => string,
): TutorialKeyRow[] {
  const out: TutorialKeyRow[] = [];
  for (const id of step.actions) {
    const row = actionKeyRow(id, bindings, mac, labelFor);
    if (row !== null) out.push(row);
  }
  return out;
}

/* ==========================================================================
 * 6. PERSISTENCE
 *
 * One versioned key in platform storage — the same treatment the objectives
 * panel gives its collapse state and for the same reason: the settings store
 * lives in a chunk the HUD is not allowed to depend on, and this is one small
 * record that has to survive a reload.
 * ========================================================================== */

export const TUTORIAL_STORAGE_KEY = 'vm.tutorial.v1';
// Version 2 is the complete 26-step curriculum. Version 1's `done` meant the
// old fourteen-step opening drill and must not hide the new field school.
export const TUTORIAL_PROGRESS_VERSION = 2;

export interface TutorialProgress {
  readonly version: number;
  /** Furthest step index reached, for the menu hint. */
  readonly furthest: number;
  /** Ids of steps completed in any run. */
  readonly completed: readonly string[];
  /** True once the final step has been acknowledged. */
  readonly done: boolean;
}

export function emptyProgress(): TutorialProgress {
  return { version: TUTORIAL_PROGRESS_VERSION, furthest: 0, completed: [], done: false };
}

/**
 * Parse a stored record. Total: any garbage yields a fresh record rather than
 * throwing, because a corrupt key must never be able to stop the menu painting.
 */
export function decodeProgress(raw: string | null | undefined): TutorialProgress {
  if (raw === null || raw === undefined || raw === '') return emptyProgress();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyProgress();
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyProgress();
  const r = parsed as Record<string, unknown>;
  const known = new Set(TUTORIAL_STEPS.map((s) => s.id));
  const completed: string[] = [];
  if (Array.isArray(r.completed)) {
    for (const v of r.completed) {
      if (typeof v === 'string' && known.has(v) && !completed.includes(v)) completed.push(v);
    }
  }
  const furthestRaw = typeof r.furthest === 'number' && Number.isFinite(r.furthest) ? r.furthest : 0;
  const furthest = Math.max(0, Math.min(TUTORIAL_STEPS.length, Math.floor(furthestRaw)));
  const storedVersion = typeof r.version === 'number' ? Math.floor(r.version) : 0;
  return {
    version: TUTORIAL_PROGRESS_VERSION,
    furthest,
    completed,
    // Preserve the old completed ids for resume, but an old 14-step Finish is
    // not completion of the newly added curriculum.
    done: storedVersion === TUTORIAL_PROGRESS_VERSION && r.done === true,
  };
}

export function encodeProgress(p: TutorialProgress): string {
  return JSON.stringify({
    version: TUTORIAL_PROGRESS_VERSION,
    furthest: p.furthest,
    completed: p.completed,
    done: p.done,
  });
}

/** Read the stored record. Storage being unavailable is not an error. */
export function readTutorialProgress(): TutorialProgress {
  try {
    return decodeProgress(persistentStorage().getItem(TUTORIAL_STORAGE_KEY));
  } catch {
    return emptyProgress();
  }
}

/** Write it back. Private mode and a full quota both fail silently. */
export function writeTutorialProgress(p: TutorialProgress): void {
  try {
    persistentStorage().setItem(TUTORIAL_STORAGE_KEY, encodeProgress(p));
  } catch {
    /* The tutorial still runs; only the menu hint forgets. */
  }
}

/** Fold one finished step into the record. Returns a NEW record. */
export function withStepCompleted(
  p: TutorialProgress,
  step: TutorialStep,
  index: number,
  steps: readonly TutorialStep[] = TUTORIAL_STEPS,
): TutorialProgress {
  const completed = p.completed.includes(step.id) ? p.completed : [...p.completed, step.id];
  return {
    version: TUTORIAL_PROGRESS_VERSION,
    furthest: Math.max(p.furthest, Math.min(steps.length, index + 1)),
    completed,
    done: p.done || completed.length >= steps.length,
  };
}

/**
 * Where a replay picks up.
 *
 * The honest answer, and it is worth stating why it is not "the furthest step".
 * A tutorial that runs over a real match cannot resume into a base that no
 * longer exists — launching rebuilds the world from an MCV, so every
 * `worldDependent` step has to be performed again. What CAN be skipped is the
 * input drill at the front: a player who has already learned to pan, select and
 * attack-move does not need to prove it twice. So the pointer walks forward
 * over completed, world-independent steps and stops at the first step that is
 * either unfinished or depends on the world.
 */
export function resumeIndex(
  p: TutorialProgress,
  steps: readonly TutorialStep[] = TUTORIAL_STEPS,
): number {
  let i = 0;
  while (i < steps.length && !steps[i].worldDependent && p.completed.includes(steps[i].id)) i++;
  return i;
}

/** The hint printed under the main menu's Tutorial button. */
export function progressHint(
  p: TutorialProgress,
  steps: readonly TutorialStep[] = TUTORIAL_STEPS,
): string {
  if (p.done) return 'Complete';
  if (p.furthest <= 0) return 'Start here';
  return `Step ${Math.min(steps.length, p.furthest + 1)} of ${steps.length}`;
}
