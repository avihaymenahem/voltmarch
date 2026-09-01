/**
 * ============================================================================
 * src/ui/Sidebar.ts — THE BOTTOM BAR
 * ============================================================================
 * The file keeps its name so no other module's import breaks; it is no longer a
 * sidebar. The classic right-hand rail is gone and the command surface is now
 * bottom-anchored in three docks plus one strip:
 *
 *   TOP CENTRE   `ResourceStrip`   credits, power, clock, and three telltales
 *   BOTTOM LEFT  `.vm-dock-map`    the minimap's glass panel plus its legend
 *   BOTTOM CENTRE`SelectionPanel`  the selection, OR the base status board
 *   BOTTOM RIGHT `BuildPanel`      4 named tabs over a 6-column slot grid
 *
 * WHY BOTTOM-ANCHORED
 * -------------------
 * A right rail costs 13% of the frame at every resolution and it costs it in
 * the WIDEST part of a 16:9 image, which is exactly where the battlefield is.
 * Three bottom docks cost the same pixels in the least valuable band and leave
 * the horizon clean. It also puts the build grid, the selection and the minimap
 * within one short mouse travel of each other.
 *
 * WHAT THE CLARITY PASS CHANGED
 * -----------------------------
 * 1. **Everything is named.** The resource cells carry CREDITS / POWER / TIME
 *    labels, the build tabs carry words, and every readout that was a bare
 *    glyph and a number now says what the number is.
 * 2. **Every blocked state explains itself.** A locked slot carries a banner
 *    that says which of the three reasons it is — tech, funds, power — and the
 *    tooltip carries the whole sentence. "NO RADAR" tells the player to build a
 *    Radar Dome.
 * 3. **Keys are visible.** Tabs and the first ten slots of the active tab carry
 *    a key badge, and those keys are live — `Hud` owns the listener.
 * 4. **The empty centre dock does work.** With nothing selected it shows army
 *    strength, structures, power, income and one line of advice, instead of
 *    fading to an invisible slab.
 *
 * ZERO ALLOCATION IN `update`
 * ---------------------------
 * Every slot, card and segment is built once and pooled. `update` writes
 * `nodeValue`, toggles classes and sets custom properties; it never calls
 * `createElement`, never builds a template string for the DOM, and never
 * touches a layout-reading API like `getBoundingClientRect`. The few strings it
 * does build (a countdown, a health fraction) are guarded by a signature
 * comparison, so a steady frame builds none of them.
 * ============================================================================
 */

import {
  BUILD_TAB_COUNT,
  BuildTab,
  Faction,
  Stance,
  type HudCameo,
  type HudSnapshot,
} from '../core/types';
import { HUD_SUPERWEAPON } from '../core/config';
import type * as THREE from 'three';
import {
  BUILD_SLOT_HOTKEYS,
  BUILD_SLOT_HOTKEY_LABELS,
  BUILD_TAB_HOTKEYS,
  BUILD_TAB_HOTKEY_LABELS,
} from '../input/ActionCatalogue';
import type { FormationShape } from '../input/Formations';
// The power table, for the cameo glyph. `src/progression/powers.ts` imports
// nothing, so the shell chunk and a node test both keep loading this file.
import { powerByContentKey } from '../progression/powers';

import {
  RollingCounter,
  Tooltip,
  applyTheme,
  button,
  el,
  formatClock,
  formatCountdown,
  formatCredits,
  formatElapsed,
  formatRate,
  label,
  panel,
  textNode,
  type TooltipContent,
} from './Chrome';
import {
  CameoRenderer, createCameoModelProvider,
  type CameoRendererTarget, type CameoSubject,
} from './Cameos';
import { iconForBuildable, makeIcon, setIcon, type IconName } from './icons';
import {
  BUILD_PANEL_HEIGHT_KEY,
  VerticalPanelResize,
} from './VerticalPanelResize';

/* ==========================================================================
 * SECTION 1 — THE SHARED VOCABULARY
 * ========================================================================== */

/** The sidebar's two modal tools. Read by src/input/input.system.ts. */
export type ArmedMode = 'none' | 'repair' | 'sell';

/** The five primary verbs exposed by the perimeter command deck. */
export type HudCommandAction = 'move' | 'attack' | 'guard' | 'stop' | 'scatter';

/**
 * Abstract UI sounds. The HUD refuses to invent a sound and the audio module
 * refuses to reach into the HUD; `hud.system.ts` owns the cue mapping.
 */
export type HudSoundCue = 'hover' | 'click' | 'error' | 'signal' | 'tab';

/** Tooltip content the HUD can supply but `HudCameo` does not carry. */
export interface BuildExtras {
  buildTimeSec: number;
  powerDelta: number;
  blurb: string;
  /**
   * THE LONG FORM, for the strip along the foot of the rail — one to three
   * sentences saying what the thing is, why you would build it instead of
   * something else, and what it needs and leads to.
   *
   * `blurb` and this are DIFFERENT TEXT ON PURPOSE, and the reason is the bug
   * that created this field: the brief printed the blurb, the hover card
   * printed the same blurb, so the strip was a second copy of the card and a
   * player reading both learned nothing the second time. Worse, a blurb is
   * written for somebody who already knows the game — "Unlocks the top of
   * every tab" is exactly right about a Reliquary and tells a new player
   * nothing about what a Reliquary IS.
   *
   * Empty is a legal answer and the caller falls back to `blurb`, which is
   * what a headless build with no def tables gets. Coverage is a TEST
   * (`tests/build-descriptions.spec.ts`), not a runtime concern.
   */
  description: string;
  /** Human sentence naming what this needs, e.g. `Requires Radar Dome`. */
  prereq: string;
  /**
   * WHICH MISSION UNLOCKS THIS — `Strip Mine: mine 70,000 credits of ore` —
   * or '' when the def is not progression-gated, or when nothing can say.
   *
   * A player hovered a locked Proving Ground, read the gate's generic "Locked —
   * complete a mission", and asked whether they were meant to guess. This is
   * the sentence that answers them. It is computed in `src/ui/Hud.ts`, which is
   * the one place that can see BOTH the def tables (for `unlockedBy`) and the
   * progression handle (for the mission behind that id).
   *
   * Empty is the correct and common answer: the overwhelming majority of defs
   * carry no `unlockedBy` at all, and a build refused for FUNDS or POWER must
   * keep showing the funds or power sentence rather than a mission name.
   */
  unlockHint: string;
}

/** One card in the selection panel. Pooled — never retained by the caller. */
export interface SelectionCard {
  /** `EntityId` as a plain number, so the panel can echo a click back. */
  id: number;
  icon: IconName;
  /**
   * Content key, for the MODEL cameo. Empty when the entity's def could not be
   * resolved, which is the one case that still has to fall back to `icon`.
   *
   * `icon` is not dead weight: it is what shows before the art modules have
   * registered, in a headless build with no GL, and for anything whose model
   * does not resolve. The build rail has worked exactly this way since the
   * cameo renderer landed; the selection dock simply never asked.
   */
  cameoKey: string;
  isBuilding: boolean;
  name: string;
  /** 0..1. */
  hpFrac: number;
  /** 0, 1 or 2. */
  veterancy: number;
  /** How many identical units this card stands for. 1 = not stacked. */
  stack: number;
  /** True for the card the stat row is describing. */
  primary: boolean;
}

/** Everything the selection panel renders. Rebuilt in place each frame. */
export interface SelectionView {
  /** Entities selected. 0 swaps the dock over to the status board. */
  count: number;
  /** Headline: the primary's name, or "MIXED FORCE". */
  title: string;
  /** Sub-line: role or the mixed-selection breakdown. */
  subtitle: string;
  /** Veterancy of the primary, 0..2. Drives the chevrons beside the title. */
  veterancy: number;
  /** Pooled cards. Only the first `cardCount` are valid. */
  cards: SelectionCard[];
  cardCount: number;
  /** Aggregate health of the WHOLE selection, 0..1. */
  hpFrac: number;
  /** `1240 / 1600` — absolute hit points across the selection. */
  hpText: string;
  /**
   * At least one selected unit is currently self-repairing (`sim.regen`).
   *
   * Drives the sweep on the health bar and the REPAIRING tag beside it. It is a
   * property of the SELECTION, not of the primary: with six units selected and
   * one of them mending, something is happening and the panel should say so.
   */
  mending: boolean;
  /** Current stance of the selection, or -1 when it is mixed. */
  stance: Stance | -1;
  /** False for a selection that cannot take a stance (structures). */
  stanceEnabled: boolean;
  /** The Relocate button. Pooled and mutated in place, never replaced. */
  relocate: RelocateAction;
  /** The commander's ability button. Pooled and mutated in place. */
  ability: AbilityAction;
  /** The transport's cargo readout and Unload button. Pooled, mutated in place. */
  cargo: CargoAction;
  /** The garrison's occupancy readout and Evacuate button. Pooled. */
  garrison: GarrisonAction;
  /** The Primary Factory toggle. Pooled and mutated in place. */
  primary: PrimaryAction;
  /** The Self-Destruct button and its confirm latch. Pooled. */
  selfDestruct: SelfDestructAction;
  /** Stat row. An empty string blanks its chip. */
  armour: string;
  damage: string;
  range: string;
  speed: string;
}

/**
 * The Relocate action, as the selection panel needs to render it.
 *
 * WHY THIS IS A SELECTION ACTION AND NOT A THIRD `ArmedMode`
 * ---------------------------------------------------------
 * Repair and sell are modal tools: you arm the wrench, then click any building.
 * The click is a GESTURE, and gestures belong to `src/input/input.system.ts`,
 * which reads `hud.armedMode` and issues the command. Relocation has no such
 * gesture — its subject is the building you already selected, and its target is
 * chosen by the placement ghost, which owns the cursor for the duration. Adding
 * `'relocate'` to `ArmedMode` would hand input a mode it has no code for and
 * would arm a wrench-like cursor that never gets clicked.
 *
 * So it lives on the selection panel, beside the stance buttons, where every
 * other per-selection verb would go. `enabled` is false when the structure
 * cannot be moved and `hint` is then the sentence explaining why — the button
 * stays VISIBLE and greyed rather than vanishing, because a control that
 * disappears teaches nothing and a control that explains itself teaches the
 * rule (a Construction Yard travels by packing into an MCV; a garrison must get
 * out first).
 */
export interface RelocateAction {
  /** False hides the row entirely: nothing relocatable is selected. */
  visible: boolean;
  /** False greys the button. `hint` says why. */
  enabled: boolean;
  /** Fee in credits. Printed on the button so the price precedes the click. */
  cost: number;
  /** Tooltip / aria description. Never empty while `visible`. */
  hint: string;
  /** True while the ghost is already carrying this structure. */
  armed: boolean;
}

/**
 * The commander's active ability, as the selection panel needs to render it.
 *
 * WHY IT SITS BESIDE RELOCATE AND NOT IN THE BUILD PALETTE
 * --------------------------------------------------------
 * Its subject is the unit you already selected, exactly like Relocate's, and
 * exactly unlike everything in the palette — which is a catalogue of things you
 * do not own yet. Putting it in the palette would also have meant one slot per
 * faction in a grid that is already the same shape for all four.
 *
 * `cooldown` / `cooldownTotal` are SECONDS and are only ever printed. The sim
 * counts in integer ticks (see `src/sim/Abilities.ts`) precisely so that the
 * float never gets anywhere near the decision; this is the presentation end of
 * that number and nothing branches on it but the label.
 */
export interface AbilityAction {
  /** False hides the row: nothing with an ability is selected. */
  visible: boolean;
  /** False greys the button — still cooling, or not yours. */
  enabled: boolean;
  /** 'Chrono Rally'. Never empty while visible. */
  label: string;
  /** One line saying what it does. The tooltip and the aria description. */
  hint: string;
  /** Seconds left, 0 when ready. */
  cooldown: number;
  /** The full cooldown, so the button can draw a proportion. */
  cooldownTotal: number;
}

/**
 * A transport's occupancy, as the selection panel needs to render it.
 *
 * WHY THE COUNT IS ALWAYS SHOWN AND THE BUTTON IS ONLY EVER GREYED
 * ---------------------------------------------------------------
 * Passengers are invisible by construction: `EntityFlag.Garrisoned` is checked
 * by the render bridge, the minimap, the world overlay and selection, so a
 * loaded transport looks exactly like an empty one on the field. This row is
 * the ONLY place the player can find out whether anybody is aboard, which is
 * why it appears for every transport rather than only for loaded ones — an
 * empty transport reading "0 / 5" is information, and a row that is absent
 * until it is full teaches nothing.
 *
 * The button follows Relocate's rule for the same reason: greyed with a hint,
 * never hidden and never `disabled`.
 *
 * BOTH NUMBERS ARE SUMS OVER THE WHOLE SELECTION, not readings off a primary
 * entity. Unload issues one order per loaded hull, so "9 / 15" describes the
 * men that one click puts on the ground and the seats they came out of; see
 * `computeCargoAction` in `src/ui/Hud.ts` for why the row used to insist on a
 * single hull and why that stopped being right.
 */
export interface CargoAction {
  /** False hides the row: nothing of yours with seats is selected. */
  visible: boolean;
  /** False greys the button — every selected hull is empty. */
  enabled: boolean;
  /** Men aboard, summed over every selected hull that has seats. */
  count: number;
  /** Seats, summed over those same hulls. Never 0 while `visible`. */
  capacity: number;
  /** One line for the tooltip and the aria description. Never empty. */
  hint: string;
}

/**
 * A garrisoned structure's occupancy, as the selection panel needs it.
 *
 * THE TRANSPORT'S CARGO ROW, ONE ENTITY KIND OVER, and that is the whole
 * design. Infantry inside a building carry `EntityFlag.Garrisoned` exactly as
 * passengers in a hull do, so they are invisible to the render bridge, the
 * minimap, the world overlay and selection by the identical mechanism — and
 * before this row existed there was no way at all to get them out again.
 * `GarrisonService.evacuate` shipped with a doc comment naming "the HUD's
 * evacuate button" and no such button was ever built.
 *
 * The verb goes out on `OrderKind.Unload` — the SAME order the Unload button
 * issues, addressed to a building instead of a hull — so the two gestures are
 * one verb all the way down to the wire, and the D key drives both.
 *
 * NO CAPACITY FIELD, unlike `CargoAction`. `GARRISON.capacity` lives in
 * `src/sim/Garrison.ts`, which this file must not import (see the seam note in
 * `Hud.ts`), and the service publishes no reader for it. A count with no
 * denominator is honest; a denominator guessed at from a constant copied over
 * here is the kind of quiet drift `docs/SPEC_DRIFT_AUDIT.md` catalogues.
 */
export interface GarrisonAction {
  /** False hides the row: no occupied structure of yours is selected. */
  visible: boolean;
  /** False greys the button — nobody inside. */
  enabled: boolean;
  /** Men inside, summed over every occupied structure in the selection. */
  count: number;
  /** One line for the tooltip and the aria description. Never empty. */
  hint: string;
}

/**
 * The primary-factory toggle, as the selection panel needs to render it.
 *
 * WHY THIS IS A BUTTON AND NOT A RIGHT-CLICK ON THE CAMEO
 * -------------------------------------------------------
 * `CommandKind.SetPrimary` has existed since the command enum was written,
 * `Production.applyPrimary` implements it and `EntityFlag.PrimaryFactory` is
 * read at every spawn — and nothing in the interface or on the keyboard ever
 * issued it. With two War Factories the player could not choose which one their
 * tanks came out of, which is a decision every base with a forward factory
 * needs to make.
 *
 * It follows Relocate's rule rather than the stance row's: VISIBLE and greyed
 * once this factory is already primary, because a control that disappears the
 * moment it succeeds leaves the player unsure whether it worked. `isPrimary`
 * drives the lit state, so the row doubles as the readout for "which one is it
 * right now" — the question that has no other answer on screen.
 */
export interface PrimaryAction {
  /** False hides the row: no owned, finished factory is selected. */
  visible: boolean;
  /** False greys the button — this one is already primary. */
  enabled: boolean;
  /** True when the selected factory is the current primary. Lights the row. */
  isPrimary: boolean;
  /** One line for the tooltip and the aria description. Never empty. */
  hint: string;
}

/**
 * The self-destruct button and its confirm latch.
 *
 * TWO CLICKS, AND THE SECOND ONE IS THE COMMAND. Every other verb on this panel
 * is recoverable — a relocation can be cancelled, a stance re-set, a transport
 * re-loaded. This one kills your own hardware and there is no undo, so the
 * button arms on the first click, prints CONFIRM, and disarms itself after
 * `SELF_DESTRUCT_CONFIRM_SECONDS` of being ignored. That timer is what stops a
 * stray armed button from eating a unit three minutes later.
 *
 * INFANTRY AND VEHICLES ONLY. `RepairSell.selfDestruct` refuses every other
 * entity kind outright, so offering the row on a structure would be offering a
 * button that does nothing — a structure is disposed of with the sell tool, and
 * that tool already exists.
 */
export interface SelfDestructAction {
  /** False hides the row: nothing you own that can be scuttled is selected. */
  visible: boolean;
  /** How many of the selection would go up. Never 0 while `visible`. */
  count: number;
  /** True once the first click has landed and the next one fires. */
  armed: boolean;
  /** One line for the tooltip and the aria description. Never empty. */
  hint: string;
}

/**
 * Seconds an armed self-destruct waits for its confirming click.
 *
 * Long enough to read the word CONFIRM and mean it, short enough that a button
 * armed by accident is disarmed again before the player's attention comes back
 * to this corner of the screen.
 */
export const SELF_DESTRUCT_CONFIRM_SECONDS = 4;

/**
 * One commander power, as the powers bar needs to render it.
 *
 * THE SUPERWEAPON ROW'S TWIN, and deliberately so: both are player-level,
 * both charge on a clock nothing but time advances, both are called by arming a
 * cursor and clicking the ground. A player who has learned one has learned the
 * other, which is the entire argument for giving them the same row shape and
 * standing them in the same corner of the frame.
 *
 * WHERE THEY DIFFER IS WHO OWNS THE ARMING. A superweapon's cursor is installed
 * by `src/sim/Superweapons.ts`, which owns its own pointer handler; a power has
 * no such service, so the HUD holds `armedPower` and `src/input/input.system.ts`
 * reads it on the ground click — exactly how `hud.armedMode` drives the repair
 * and sell tools. Neither path lets this file fire anything: the shot is
 * `channels.commands.issueUsePower` and nothing else.
 *
 * `remaining` / `total` are SECONDS and are only ever printed.
 */
export interface CommanderPowerRow {
  /** Stable power key — `airstrike`, `chronoshift`. Also the pool identity. */
  key: string;
  /** `CommanderPowerId`. Rides on `Command.arg` when the power is called. */
  id: number;
  /** 'Orbital Scan'. Never empty. */
  label: string;
  /** One line saying what it does. The tooltip and the aria description. */
  hint: string;
  /** Icon for the row. Chosen per power, so five rows are five silhouettes. */
  icon: IconName;
  /** Seconds left, 0 when ready. */
  remaining: number;
  /** The full charge, so the row can draw a proportion. */
  total: number;
  ready: boolean;
  /** True while this power owns the cursor and the next ground click calls it. */
  armed: boolean;
}

/** Every commander power this profile has earned. Pooled. */
export interface CommanderPowerView {
  /** Live rows. Only the first `count` of `rows` are valid. */
  count: number;
  rows: CommanderPowerRow[];
}

/**
 * One superweapon countdown, as the bar needs to render it.
 *
 * WHY THIS IS NOT A SELECTION ACTION LIKE THE TWO ABOVE
 * -----------------------------------------------------
 * Relocate and the commander ability belong to a thing you have selected. A
 * superweapon does not: it belongs to the BASE, it counts down whether or not
 * anything is selected, and the whole point of the row is that the player can
 * see the timer while doing something else entirely. So it gets a dock of its
 * own beside the build rail rather than a row in the selection panel.
 *
 * `remaining` / `total` are SECONDS and are only ever printed. `Superweapons.ts`
 * counts in `dt` against a per-player float and pushes this three ticks out of
 * ten; nothing here branches on the value except `ready`.
 */
export interface SuperweaponRow {
  /** Stable superweapon id — `nuke`, `chronosphere`. Also the pool identity. */
  key: string;
  /** 'Nuclear Missile'. Never empty. */
  label: string;
  /** Seconds left, 0 when ready. */
  remaining: number;
  /** The full charge, so the row can draw a proportion. */
  total: number;
  ready: boolean;
  /** True while this weapon owns the cursor and the next click fires it. */
  armed: boolean;
}

/** Every superweapon the local player can currently field. Pooled. */
export interface SuperweaponView {
  /** Live rows. Only the first `count` of `rows` are valid. */
  count: number;
  rows: SuperweaponRow[];
}

/** Severity of the status board's advice line. */
export type AdviceKind = 'info' | 'warn' | 'alert';

/** Two legend lists, compared by value. Cheap enough to call every refresh. */
function same(a: readonly ArmyLegendEntry[], b: readonly ArmyLegendEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].color !== b[i].color || a[i].label !== b[i].label) return false;
  }
  return true;
}

/**
 * One named army in the map legend — an ally or an opponent.
 *
 * `color` is whatever `Minimap` is actually painting that army's blips in, and
 * it is passed rather than recomputed on purpose — a legend that derives its own
 * colours is a legend that can disagree with the map it is a key for.
 */
export interface ArmyLegendEntry {
  /** The blip colour, from `Chrome.hostileColor` or `SEMANTIC.ally`. */
  readonly color: string;
  /** Short caption, e.g. `Soviet AI 2`. */
  readonly label: string;
}

/**
 * The base-wide numbers. They are not in `HudSnapshot` because that structure
 * is owned by `src/sim/Production.ts`, and none of this is production's
 * business — the HUD derives all four from the world and its own event
 * subscriptions.
 */
export interface HudTelemetry {
  /** Mobile units the local player owns. */
  army: number;
  /** Completed structures the local player owns. */
  structures: number;
  /** Smoothed credit income, per minute. */
  incomePerMin: number;
  /**
   * THE CREDIT CEILING — `PlayerState.storageMax`, and everything above it is
   * thrown away on the next harvest.
   *
   * Read straight off the player rather than out of `HudSnapshot`, because that
   * structure belongs to `src/sim/Production.ts` and a storage cap is not
   * production's business. `world.players[localPlayer]` is core state the HUD
   * already holds a reference to, so this costs one array read a frame.
   *
   * The strip showed CREDITS with no denominator, so the only signal that
   * income was being binned was EVA saying so — and with the stock 10,000 bank
   * the player STARTS exactly at the cap, which makes this the first thing that
   * goes wrong in every match and the last thing that was visible.
   *
   * 0 means "no cap known" and the readout falls back to the bare number.
   */
  storageMax: number;
  /** One sentence about the state of the base. Never empty. */
  advice: string;
  adviceKind: AdviceKind;
  /** Stable match identity shown in the top-centre command node. */
  matchMode: string;
  matchDifficulty: string;
  mapName: string;
  /** Empty unless a campaign transmission with a real portrait is live. */
  commandPortrait: string;
  commandSpeaker: string;
  /** Dynamic weather, or clear when no weather system is active. */
  weather: 'clear' | 'light' | 'heavy';
  /** Current simulation multiplier. Normal speed is 1. */
  gameSpeed: number;
}

/** Everything the bottom bar hands back up. */
export interface SidebarCallbacks {
  selectTab(tab: BuildTab): void;
  /** Left click on a build slot. */
  activate(tab: BuildTab, cameo: HudCameo): void;
  /** Right click on a build slot. */
  cancel(tab: BuildTab, cameo: HudCameo): void;
  /** The repair / sell tool changed. */
  setArmed(mode: ArmedMode): void;
  /** A selection card was clicked — make it the primary, or focus it. */
  focusCard(id: number, additive: boolean): void;
  /** The stance buttons. */
  setStance(stance: Stance): void;
  /** Relocate was pressed. The HUD puts the selected structure on the cursor. */
  relocate(): void;
  /** The commander's ability button was pressed. */
  useAbility(): void;
  /** The transport's Unload button was pressed. */
  unload(): void;
  /** The garrison's Evacuate button was pressed. */
  evacuate(): void;
  /** The Primary Factory button was pressed. */
  setPrimary(): void;
  /** The Self-Destruct button was pressed. Arms first, fires on the second. */
  selfDestruct(): void;
  /** A superweapon countdown row was clicked. `key` is `SuperweaponRow.key`. */
  fireSuperweapon(key: string): void;
  /** A commander power row was clicked. `key` is `CommanderPowerRow.key`. */
  usePower(key: string): void;
  /** A primary battlefield command was clicked. Input owns the gesture. */
  command(action: HudCommandAction): void;
  /** Arrange the selected mobile group into one of the explicit shapes. */
  formation(shape: FormationShape): void;
  sound(cue: HudSoundCue): void;
}

export interface SidebarOptions {
  parent: HTMLElement;
  faction: Faction;
  callbacks: SidebarCallbacks;
  /**
   * The main renderer — EITHER backend — so build slots can show the ACTUAL
   * MODEL instead of a flat glyph.
   *
   * This was `THREE.WebGLRenderer | null` and `Hud.ts` passed `handle.webgl`,
   * which is null under `?gpu=webgpu`. The result was a whole sidebar of flat
   * glyphs on the node path: you could not tell what you were building. Both
   * renderers are accepted now; `CameoRenderer` picks the readback that exists.
   *
   * Optional, and the flat glyph stays underneath as the fallback: a headless
   * test, a context-lost frame, and any def whose model does not resolve all
   * have to keep producing a usable sidebar. `CameoRenderer` renders each
   * cameo once into a cached render target and then never again, so an idle
   * sidebar costs zero GPU — see the header of `Cameos.ts`.
   */
  renderer?: CameoRendererTarget | null;
}

/**
 * Columns in the build grid. TWO, which is what RA2 itself used.
 *
 * The history is worth keeping because each step was measured. SIX was right
 * while this was a 332u-wide dock across the bottom. THREE was right the moment
 * it became a 240u vertical rail — six would have given a 36u cell. TWO is
 * right now for a reason neither of those had: the LARGEST roster any faction
 * has in any tab is EIGHT (measured off `catalog.roster` for all four armies
 * and all four tabs), so a third column was never buying capacity — it was
 * spending a third of the rail's width on air, and taking it out of the cameo.
 *
 * Two columns take the cell from ~73x56u to ~111x84u, which is 2.3x the pixel
 * area in the cameo's backing store. That is real resolution, not an upscale:
 * `bindCameo` sizes the canvas from the cell's own box.
 */
export const BUILD_COLUMNS = 2;
/**
 * Rows built up front. The grid scrolls internally past this.
 *
 * SEVEN, and it is a measurement rather than a guess — `tests/hud.spec.ts` reads
 * the real rosters and fails here if any tab of any faction outgrows the pool,
 * because a grid with fewer slots than its tab has entries simply DOES NOT DRAW
 * the overflow: no error, no scrollbar worth noticing, a structure that quietly
 * stops being buildable.
 *
 * It was 6 (=12 slots) against a largest roster of eight, "with four to spare".
 * The Command Post spent one of them and the SOVIET Structures tab is the one
 * that ran out: it holds thirteen entries, because the two original armies each
 * carry the whole Neutral pool plus their own naval yard and defences. 2x7 = 14
 * covers it with one to spare. A row costs a DOM subtree and a cameo canvas at
 * boot and nothing per frame — `refreshSnapshot` only ever touches the slots
 * that are live.
 */
export const BUILD_ROWS = 7;
/** Cards built up front in the selection panel. */
const CARD_POOL = 14;
/** Segments in the power meter. */
const POWER_SEGMENTS = 14;
/**
 * Fraction of the storage ceiling at which the credit readout starts warning.
 *
 * 90%, and it is a WARNING rather than the alarm: at nine tenths there is still
 * a refinery-load of headroom and a silo takes four seconds to build, so the
 * player has time to act. The full state is the separate `is-capped` class,
 * because "you are about to waste money" and "you are wasting money right now"
 * are different sentences and a readout with one state for both teaches
 * neither.
 */
export const STORAGE_WARN_FRACTION = 0.9;

/** Tab titles, in `BuildTab` order. */
const TAB_LABELS: readonly string[] = ['Structures', 'Defence', 'Infantry', 'Vehicles', 'Powers'];
/**
 * What the tab STRIP shows, as opposed to what the tab IS.
 *
 * The full words fitted a 332u dock across the bottom. In a 240u rail four of
 * them get about 55u each and the browser truncated them to "STR..", "DEF..",
 * "INF..", "VE.." — an ellipsis is not a label. These are the same words at a
 * length that fits, and `TAB_LABELS` is still what the tooltip and the
 * `aria-label` say, so nothing that has to be read aloud got shortened.
 */
const TAB_SHORT: readonly string[] = ['ALL', 'STRUCTURES', 'DEFENSE', 'UNITS', 'SUPPORT'];

/**
 * The glyph a build cell draws.
 *
 * A COMMANDER POWER IS NAMED FOR ITS EFFECT, and `iconForBuildable` matches on
 * exactly that kind of prose — the same hazard `Cameos.archetypeFor` calls out
 * for upgrades. "Airstrike" would land on the aircraft rule by luck and "Ore
 * Boost" on the ore rule, but "Chronoshift" and "Orbital Scan" match nothing and
 * would fall through to the tab default. So a power is looked up in the table
 * that already decides this once, for the powers BAR — one set of five
 * silhouettes, so the cameo the player buys and the button it becomes are the
 * same picture.
 */
function iconForCameo(c: HudCameo, tab: BuildTab): IconName {
  if (c.isPower) {
    const power = powerByContentKey(c.key);
    if (power !== undefined) return POWER_ICONS[power.id as number] ?? 'superweapon';
  }
  return iconForBuildable(c.key, c.name, tab, c.isBuilding);
}

/**
 * The build keyboard.
 *
 * NOT DECLARED HERE. Both the codes and the badge letters come from
 * `src/input/ActionCatalogue.ts`, which is also what the help screen renders —
 * so the letter printed on a cameo and the letter the help screen promises are
 * the same array element, and there is no second list to drift. The reasoning
 * behind the fourteen letters, and what happens when a rebind takes one, is in
 * that file's section 2.
 *
 * Re-exported under the old names because `src/ui/Hud.ts` matches keystrokes
 * against them and a HUD-local alias keeps that import off the shell chunk.
 */
export {
  BUILD_TAB_HOTKEYS as TAB_HOTKEY_CODES,
  BUILD_SLOT_HOTKEYS as SLOT_HOTKEY_CODES,
};

const TAB_HOTKEY_LABELS: readonly string[] = BUILD_TAB_HOTKEY_LABELS;
const SLOT_HOTKEY_LABELS: readonly string[] = BUILD_SLOT_HOTKEY_LABELS;

/**
 * The three fields a build countdown needs to remember between frames.
 * `BuildSlot` satisfies this structurally; a test can pass a plain object.
 */
export interface EtaSampler {
  /** `progress` at the previous sample, or -1 when there is none. */
  lastProgress: number;
  /** SIM milliseconds of that sample. Never a wall clock — see the header. */
  lastAt: number;
  /** Smoothed progress-per-second. 0 until two samples exist. */
  rate: number;
}

/** How much of each new instantaneous rate reading folds into the average. */
const ETA_SMOOTHING = 0.12;
/** A gap longer than this means frames were dropped; the sample is unusable. */
const ETA_MAX_SAMPLE_GAP_SEC = 2;
/** Beyond this the number stops informing and starts looking broken. */
const ETA_MAX_SECONDS = 600;
/**
 * How long progress must sit still before it counts as stalled.
 *
 * Not zero, and that is the important part: a single sim tick can legitimately
 * fail to advance a build — `BuildQueue` charges per tick and a tick that can
 * afford nothing advances nothing — so an immediate verdict would flash STALLED
 * every time a player dipped below the per-tick cost for an instant.
 *
 * This used to read "the HUD samples at frame rate while the sim ticks at
 * 30 Hz, so most samples show no change". That was true of the wall clock and
 * is no longer true of anything: `nowMs` is sim time now, so a sample with no
 * elapsed sim time contributes `dt === 0` and is skipped by the guards, and
 * every sample that DOES carry elapsed time also carries whatever progress that
 * time bought. The dwell now measures a genuinely stalled build rather than the
 * renderer outrunning the simulation.
 */
const ETA_STALL_SEC = 1.5;

/** `rate` sentinel: nothing measured yet, so fall back to the nominal time. */
const RATE_NO_SAMPLE = 0;
/** `rate` sentinel: measured, and the build is not moving. Show nothing. */
const RATE_STALLED = -1;

/** Authored build time adjusted by the live queue-rate multiplier. */
export function effectiveBuildSeconds(baseSeconds: number, rate: number): number {
  if (!(baseSeconds > 0)) return 0;
  return baseSeconds / Math.max(0.05, rate);
}

/**
 * Seconds left on a build, derived from how fast it is ACTUALLY progressing.
 *
 * Returns 0 for "show nothing": not building, already ready, or moving so
 * slowly that any figure would be a lie. A stalled build already announces
 * itself through the ON HOLD flag and EVA — a countdown reading 9999 beside it
 * would be noise, and one reading 5s while nothing moves is the bug this
 * replaces.
 *
 * WHY MEASURED AND NOT CALCULATED
 * -------------------------------
 * The old formula was `buildTime * (1 - progress)`: the time a build takes at
 * its NOMINAL rate. Three things move the real rate and it knew none of them.
 *
 *   - `player.buildSpeedMul` — a continuous function of the power supply ratio
 *     (`src/sim/Power.ts`), so a brownout stretches every build.
 *   - `factorySpeed(factoryCount)` — more factories build FASTER.
 *   - Affordability. `src/sim/BuildQueue.ts` charges per tick and advances only
 *     the slice it managed to pay for: "a poor player does not stop - they
 *     crawl. A tick that can only afford 40% of its increment advances 40% of
 *     its increment." Deliberate, and invisible to a nominal countdown.
 *
 * Two of the three make a build take LONGER than advertised, which is the
 * report: the timer says 5s and it takes twice that. Mirroring the sim's rate
 * arithmetic up here would be a second copy of a formula that drifts the first
 * time either side changes — the same defect class `docs/SPEC_DRIFT_AUDIT.md`
 * catalogues. Measuring the observed rate is correct for all three causes at
 * once, and for any cause added later.
 *
 * The estimate assumes current conditions hold, which is what every ETA
 * assumes. Power returning or a harvester cashing in will beat it, and early is
 * the right direction to be wrong in.
 *
 * ── `nowMs` IS SIM TIME, AND THAT IS THE WHOLE SECOND FIX ──────────────────
 * It used to be `performance.now()`, and a countdown built on a wall clock
 * measures a 30 Hz quantity with a 60-plus Hz ruler. The interval between two
 * observed progress CHANGES is then quantised to frame boundaries rather than
 * sim ticks, so the instantaneous rate carries the frame timer's jitter — and
 * `remaining / rate` turns that jitter into seconds.
 *
 * Reported as "the building timer is freaking off, going back and forth in
 * time". Measured against a simulated 30 Hz sim with realistic rAF jitter, over
 * one 30-second build:
 *
 *     60 fps, no jitter     the countdown rose  0 times
 *     60 fps, 25% jitter                       83
 *     60 fps, 60% jitter                       85
 *     30 fps, 40% jitter                       72
 *     144 fps, 25% jitter                      29
 *
 * The no-jitter row is why this survived: on a perfectly regular clock at
 * exactly 2 frames per tick it is monotonic, and that is the only case a
 * synthetic test had ever driven it with. Every real machine jitters.
 *
 * Sim time removes the error rather than smoothing it: progress and the clock
 * it is measured against now advance together, so the interval between changes
 * is an exact multiple of the tick and the rate is exact. It also fixes the
 * hidden-tab case for free — sim time is frozen while the game is paused (see
 * `Shell.onVisibility`), so returning to the tab yields `dt === 0` and no
 * sample, instead of one enormous bogus interval.
 *
 * A countdown that rises is a bug REGARDLESS of the rate being honest, which is
 * what `tests/build-eta.spec.ts` now asserts directly.
 */
export function estimateBuildEta(
  s: EtaSampler,
  progress: number,
  ready: boolean,
  buildTime: number,
  nowMs: number,
): number {
  if (ready || progress <= 0 || progress >= 1) {
    s.lastProgress = -1;
    s.rate = 0;
    return 0;
  }

  const prev = s.lastProgress;
  const dt = (nowMs - s.lastAt) / 1000;

  if (prev < 0 || progress < prev) {
    // A new item or a restart. `progress` going DOWN means the head of the
    // queue changed, so any retained rate describes a different build.
    s.lastProgress = progress;
    s.lastAt = nowMs;
    s.rate = RATE_NO_SAMPLE;
  } else if (progress > prev) {
    // Only measure across a plausible gap. A dropped frame or a tab switch
    // produces a delta over a long interval that is not a rate.
    if (dt > 0 && dt <= ETA_MAX_SAMPLE_GAP_SEC) {
      const inst = (progress - prev) / dt;
      // Heavily smoothed on purpose: production is charged per sim tick against
      // a credit balance that jumps every time a harvester docks, so the
      // instantaneous rate is spiky and a raw countdown would swing by seconds
      // between frames.
      s.rate = s.rate > 0 ? s.rate + (inst - s.rate) * ETA_SMOOTHING : inst;
    }
    s.lastProgress = progress;
    s.lastAt = nowMs;
  } else if (dt > ETA_STALL_SEC) {
    // Progress has not moved for long enough that this is a genuine stall
    // rather than a render frame that simply outran the 30 Hz sim tick.
    //
    // The distinction matters: the HUD samples at frame rate, so during a
    // perfectly healthy build most samples show no change at all. Folding those
    // in as zero would halve the measured rate and the countdown would read
    // roughly double. Hence a dwell rather than an immediate decay.
    s.rate = RATE_STALLED;
  }

  const remaining = 1 - progress;
  if (s.rate > 1e-5) {
    const secs = remaining / s.rate;
    return secs > ETA_MAX_SECONDS ? 0 : Math.ceil(secs);
  }
  // Stalled: show nothing. ON HOLD and EVA already say so, and a countdown
  // frozen at "5s" while nothing happens is the reported bug.
  if (s.rate === RATE_STALLED) return 0;

  // No usable sample yet. The nominal time is the best guess available, and it
  // is right whenever nothing is throttling the build — the common case in the
  // first frames after queueing.
  return buildTime > 0 ? Math.ceil(buildTime * remaining) : 0;
}

/** Stance buttons, in display order. */
const STANCES: ReadonlyArray<readonly [Stance, IconName, string]> = [
  [Stance.Aggressive, 'stanceAggressive', 'Aggressive'],
  [Stance.Defensive, 'stanceDefensive', 'Defensive'],
  [Stance.HoldGround, 'stanceHoldGround', 'Hold ground'],
  [Stance.HoldFire, 'stanceHoldFire', 'Hold fire'],
];

/** Power pressure, derived once and used by the strip and the status board. */
export type PowerState = 'ok' | 'tight' | 'down';

export function powerStateOf(produced: number, consumed: number, brownout: boolean): PowerState {
  if (brownout || consumed > produced) return 'down';
  if (produced > 0 && consumed / produced > 0.86) return 'tight';
  return 'ok';
}

const POWER_WORDS: Readonly<Record<PowerState, string>> = {
  ok: 'Optimal',
  tight: 'Strained',
  down: 'Brownout',
};

/* ==========================================================================
 * SECTION 2 — THE RESOURCE STRIP  (top centre)
 *
 * Six labelled cells. The three on the left are the ones a decision depends on
 * — money, power headroom, elapsed time — and the three on the right are
 * telltales: how big is my army, how big is my base, how fast is money coming
 * in. Each carries a word, because the previous strip was a coin, a bolt and a
 * clock, and nothing told a new player which number was which.
 * ========================================================================== */

export class ResourceStrip {
  readonly root: HTMLElement;

  private readonly creditsNode: Text;
  private readonly creditsEl: HTMLElement;
  private readonly capNode: Text;
  private readonly deltaEl: HTMLElement;
  private readonly deltaNode: Text;
  private readonly powerEl: HTMLElement;
  private readonly powerNode: Text;
  private readonly stateEl: HTMLElement;
  private readonly stateNode: Text;
  private readonly segments: HTMLElement[] = [];
  private readonly clockNode: Text;
  private readonly armyNode: Text;
  private readonly baseNode: Text;
  private readonly incomeEl: HTMLElement;
  private readonly incomeNode: Text;
  private readonly commandEmblem: HTMLElement;
  private readonly commandPortrait: HTMLImageElement;
  private readonly commandKicker: Text;
  private readonly commandMap: Text;
  private readonly commandWeather: HTMLElement;
  private readonly commandSpeed: HTMLElement;

  private readonly counter = new RollingCounter();
  /** Seconds since the last credit flyout, or a large number when idle. */
  private deltaAge = 1e9;
  private lastLit = -1;
  private lastState: PowerState | '' = '';
  private lastClock = '';
  private lastPower = '';
  private lastArmy = -1;
  private lastBase = -1;
  private lastIncome = '';
  /** `credits|cap|capped` — the storage readout's signature. */
  private lastCap = '';
  private lastCommand = '';

  constructor(parent: HTMLElement) {
    this.root = panel(parent, 'vm-resources', 'ends');
    this.root.setAttribute('role', 'status');

    /* -- the crest ------------------------------------------------------ *
     * The reference anchors its top strip with a faction crest, and it is the
     * one piece of the whole interface whose job is identity rather than
     * information. It is drawn from `icons.ts` like everything else and takes
     * its colour from `--vm-accent-hi`, so a faction swap recolours it and
     * nothing here knows a faction exists. */
    this.root.appendChild(makeIcon('crest', 'vm-icon vm-res-crest'));
    el('span', 'vm-res-rule', this.root);

    /* -- hybrid command node -------------------------------------------
     * The former silhouette reserved a large central cut and then put nothing
     * in it. This node pays that space back with stable match identity:
     * faction/commander portrait, mode + difficulty, map name, and only
     * exceptional live context. It deliberately does not duplicate the
     * objectives panel or become a seventh resource cell. --------------- */
    // The operation bay visually drops below the top armour.  It must be a
    // sibling of the clipped resource strip: CSS overflow cannot escape an
    // ancestor clip-path, so nesting it in `this.root` made the approved deep
    // centre silhouette impossible at runtime.
    const command = el('section', 'vm-command-node', parent);
    command.setAttribute('aria-label', 'Command status');
    this.commandEmblem = el('span', 'vm-command-emblem', command);
    this.commandEmblem.appendChild(makeIcon('crest', 'vm-icon'));
    this.commandPortrait = document.createElement('img');
    this.commandPortrait.className = 'vm-command-portrait';
    this.commandPortrait.alt = '';
    this.commandPortrait.decoding = 'async';
    this.commandPortrait.hidden = true;
    command.appendChild(this.commandPortrait);
    const commandBody = el('div', 'vm-command-body', command);
    const kicker = el('span', 'vm-command-kicker', commandBody);
    this.commandKicker = textNode(kicker, 'Skirmish · Normal');
    const map = el('strong', 'vm-command-map', commandBody);
    this.commandMap = textNode(map, 'Battlefield');
    const context = el('div', 'vm-command-context', command);
    this.commandWeather = el('span', 'vm-command-chip is-weather', context);
    this.commandSpeed = el('span', 'vm-command-chip is-speed', context);
    this.commandWeather.hidden = true;
    this.commandSpeed.hidden = true;
    const commandPips = el('span', 'vm-command-pips', command);
    commandPips.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 5; i++) el('i', '', commandPips);

    /* -- credits -------------------------------------------------------
     * BANKED / STORED, on the power cell's model. The label said "Credits" and
     * the value was a bare number, so the one fact a player needs in the first
     * ninety seconds — that the bank is FULL and the harvesters are running for
     * nothing — was not on screen anywhere. The cap rides in a second node
     * beside the balance rather than in a tooltip, because the moment it
     * matters is the moment nobody is hovering the strip.
     * ------------------------------------------------------------------ */
    const credits = el('div', 'vm-res vm-res-credits', this.root);
    this.creditsEl = credits;
    credits.appendChild(makeIcon('credits', 'vm-icon vm-res-icon'));
    const cBody = el('div', 'vm-res-body', credits);
    label(cBody, 'vm-res-label', 'Credits');
    const cLine = el('div', 'vm-credit-line', cBody);
    this.creditsNode = label(cLine, 'vm-res-value vm-num', '0');
    this.capNode = label(cLine, 'vm-res-cap vm-num', '');
    this.deltaEl = el('span', 'vm-res-delta vm-num', credits);
    this.deltaNode = textNode(this.deltaEl);
    this.deltaEl.hidden = true;

    el('span', 'vm-res-rule', this.root);

    /* -- power ---------------------------------------------------------
     * DRAW / SUPPLY, a segmented load meter and a state word. `+0` was
     * technically the surplus and told the player nothing: it does not say how
     * much headroom there is, and it never said that a deficit is what is
     * quietly halving every build time in the base.
     * ------------------------------------------------------------------ */
    const power = el('div', 'vm-res vm-res-power', this.root);
    power.appendChild(makeIcon('bolt', 'vm-icon vm-res-icon'));
    const pBody = el('div', 'vm-res-body', power);
    label(pBody, 'vm-res-label', 'Power');
    const pLine = el('div', 'vm-power-line', pBody);
    const meter = el('div', 'vm-power', pLine);
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', 'Power load');
    for (let i = 0; i < POWER_SEGMENTS; i++) {
      this.segments.push(el('i', 'vm-power-seg', meter));
    }
    this.powerEl = el('span', 'vm-res-value vm-num vm-power-value', pLine);
    this.powerNode = textNode(this.powerEl, '0/0');
    this.stateEl = el('span', 'vm-power-state', pLine);
    this.stateNode = textNode(this.stateEl, POWER_WORDS.ok);

    el('span', 'vm-res-rule', this.root);

    /* -- clock --------------------------------------------------------- */
    const clock = el('div', 'vm-res vm-res-clock', this.root);
    clock.appendChild(makeIcon('clock', 'vm-icon vm-res-icon'));
    const tBody = el('div', 'vm-res-body', clock);
    label(tBody, 'vm-res-label', 'Time');
    this.clockNode = label(tBody, 'vm-res-value vm-num', '00:00');

    el('span', 'vm-res-rule is-tell', this.root);

    /* -- telltales ------------------------------------------------------ */
    this.armyNode = textNode(this.buildTell('army', 'Army'), '0');
    this.baseNode = textNode(this.buildTell('base', 'Structures'), '0');
    this.incomeEl = this.buildTell('trend', 'Income / min');
    this.incomeNode = textNode(this.incomeEl, '0');
  }

  /** One telltale cell. Returns its value span so the caller can restyle it. */
  private buildTell(icon: IconName, name: string): HTMLElement {
    const cell = el('div', `vm-res vm-res-tell vm-res-${icon}`, this.root);
    cell.appendChild(makeIcon(icon, 'vm-icon vm-res-icon'));
    const body = el('div', 'vm-res-body', cell);
    label(body, 'vm-res-label', name);
    return el('span', 'vm-res-value vm-num', body);
  }

  /** Jump the counter — match start, or a faction swap. */
  reset(credits: number): void {
    this.counter.reset(credits);
    this.creditsNode.nodeValue = formatCredits(credits);
  }

  /** Raise the +/- flyout above the credits readout. */
  flyout(delta: number): void {
    const rounded = Math.round(delta);
    if (rounded === 0) return;
    this.deltaNode.nodeValue = `${rounded > 0 ? '+' : ''}${rounded}`;
    this.deltaEl.classList.toggle('is-gain', rounded > 0);
    this.deltaEl.hidden = false;
    // Restart the animation even when one is already running.
    this.deltaEl.classList.remove('is-live');
    void this.deltaEl.offsetWidth;
    this.deltaEl.classList.add('is-live');
    this.deltaAge = 0;
  }

  update(snap: HudSnapshot, tele: HudTelemetry, dt: number): void {
    /* -- credits ------------------------------------------------------- */
    this.counter.setTarget(snap.credits);
    if (this.counter.step(dt)) {
      this.creditsNode.nodeValue = formatCredits(this.counter.value);
    }
    if (this.deltaAge < 1e8) {
      this.deltaAge += dt;
      if (this.deltaAge > 0.8) {
        this.deltaAge = 1e9;
        this.deltaEl.hidden = true;
        this.deltaEl.classList.remove('is-live');
      }
    }

    /* -- the storage ceiling ------------------------------------------- *
     * Gated on the CAP and the two threshold states, never on the balance:
     * `snap.credits` moves on every harvest tick and a signature carrying it
     * would rewrite this node sixty times a second for a denominator that
     * changes only when a silo is built or lost.
     *
     * The states are measured against the TRUE balance rather than the rolling
     * counter's animated value — the counter is a presentation device and the
     * warning is a fact about the simulation, so a bank that has just hit the
     * ceiling must not wait for the digits to catch up before it says so. */
    const cap = Math.max(0, Math.round(tele.storageMax));
    const store = storageState(snap.credits, cap);
    const capSig = `${cap}|${store}`;
    if (capSig !== this.lastCap) {
      this.lastCap = capSig;
      this.capNode.nodeValue = store === 'none' ? '' : ` / ${formatCredits(cap)}`;
      this.creditsEl.classList.toggle('is-capped', store === 'full');
      this.creditsEl.classList.toggle('is-nearly-capped', store === 'near');
      this.creditsEl.title = store === 'none'
        ? 'Credits banked'
        : store === 'full'
          ? `Storage FULL at ${formatCredits(cap)} — every credit mined from now `
            + 'on is thrown away. Build an Ore Silo.'
          : `Credits banked, against ${formatCredits(cap)} of storage. `
            + 'Anything over the ceiling is wasted on harvest.';
    }

    /* -- power --------------------------------------------------------- */
    const produced = Math.max(0, Math.round(snap.powerProduced));
    const consumed = Math.max(0, Math.round(snap.powerConsumed));
    // The meter shows DRAW against SUPPLY. A full bar means the next structure
    // browns you out — which is precisely the moment the player must notice.
    const load = produced <= 0 ? (consumed > 0 ? 1 : 0) : Math.min(1, consumed / produced);
    const lit = Math.min(POWER_SEGMENTS, Math.round(load * POWER_SEGMENTS));
    const state = powerStateOf(produced, consumed, snap.brownout);

    if (lit !== this.lastLit || state !== this.lastState) {
      this.lastLit = lit;
      for (let i = 0; i < POWER_SEGMENTS; i++) {
        this.segments[i].classList.toggle('is-lit', i < lit);
      }
    }
    if (state !== this.lastState) {
      this.lastState = state;
      const mod = state === 'ok' ? '' : state === 'tight' ? 'is-tight' : 'is-down';
      this.powerEl.className = `vm-res-value vm-num vm-power-value ${mod}`;
      this.stateEl.className = `vm-power-state ${mod}`;
      this.stateNode.nodeValue = POWER_WORDS[state];
      this.root.classList.toggle('is-brownout', state === 'down');
    }
    const powerText = `${consumed}/${produced}`;
    if (powerText !== this.lastPower) {
      this.lastPower = powerText;
      this.powerNode.nodeValue = powerText;
    }

    /* -- clock --------------------------------------------------------- */
    const clock = formatElapsed(snap.gameTimeSec);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clockNode.nodeValue = clock;
    }

    /* -- telltales ------------------------------------------------------ */
    if (tele.army !== this.lastArmy) {
      this.lastArmy = tele.army;
      this.armyNode.nodeValue = String(tele.army);
    }
    if (tele.structures !== this.lastBase) {
      this.lastBase = tele.structures;
      this.baseNode.nodeValue = String(tele.structures);
    }
    const income = formatRate(tele.incomePerMin);
    if (income !== this.lastIncome) {
      this.lastIncome = income;
      this.incomeNode.nodeValue = income;
      this.incomeEl.classList.toggle('is-live', tele.incomePerMin > 5);
    }

    const portrait = tele.commandPortrait;
    const weather = tele.weather === 'heavy' ? 'HEAVY RAIN'
      : tele.weather === 'light' ? 'LIGHT RAIN' : '';
    const speed = Number.isFinite(tele.gameSpeed) && Math.abs(tele.gameSpeed - 1) > 0.001
      ? `${tele.gameSpeed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`
      : '';
    const commandSig = `${tele.matchMode}|${tele.matchDifficulty}|${tele.mapName}|${portrait}|`
      + `${tele.commandSpeaker}|${weather}|${speed}`;
    if (commandSig !== this.lastCommand) {
      this.lastCommand = commandSig;
      this.commandMap.nodeValue = tele.mapName || 'Battlefield';
      this.commandKicker.nodeValue = `${tele.matchMode || 'Skirmish'} · `
        + `${tele.matchDifficulty || 'Normal'}`;
      this.commandPortrait.hidden = portrait === '';
      this.commandEmblem.hidden = portrait !== '';
      if (portrait !== '') {
        this.commandPortrait.src = portrait;
        this.commandPortrait.alt = tele.commandSpeaker;
      } else {
        this.commandPortrait.removeAttribute('src');
        this.commandPortrait.alt = '';
      }
      this.commandWeather.hidden = weather === '';
      this.commandWeather.textContent = weather;
      this.commandSpeed.hidden = speed === '';
      this.commandSpeed.textContent = speed;
      this.root.classList.toggle('has-command-portrait', portrait !== '');
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 3 — THE SELECTION CARD  (bottom centre)
 *
 * Laid out the way docs/refs/target-hud.png lays it out: the NAME in caps with
 * a rule running right from it, the cameo on the left, the description on the
 * right, and a full-width health bar along the bottom with the absolute hit
 * points laid over it.
 *
 * WHAT THE BASE STATUS BOARD WAS, AND WHY IT IS GONE
 * -------------------------------------------------
 * With nothing selected this dock used to fill the whole 106-unit band with a
 * board reading ARMY / STRUCTURES / POWER / INCOME / CREDITS plus one line of
 * advice. Every one of those five numbers is already in the resource strip at
 * the top of the frame, and the board measured ~47% empty — it was the single
 * largest redundant area in the interface, in the widest dock of the band.
 *
 * All that survives is the advice, because that IS new information: it is
 * derived in `Hud.buildTelemetry` from the world and from the HUD's own event
 * subscriptions, and nothing else in the frame says "your power is tight" in a
 * sentence. It is now one 13-unit line, and the dock shrinks to fit it.
 * ========================================================================== */

interface CardCell {
  root: HTMLButtonElement;
  icon: SVGSVGElement;
  /** The rendered model. Hidden until a bind succeeds, revealing `icon`. */
  cameoCanvas: HTMLCanvasElement;
  bar: HTMLElement;
  nameNode: Text;
  stackEl: HTMLElement;
  stackNode: Text;
  vetEl: HTMLElement;
  id: number;
  sig: string;
}

/** Shown in place of the advice when the base is nominal. */
const IDLE_HINT = 'Select a unit or a structure to command it';

class SelectionPanel {
  readonly root: HTMLElement;

  private readonly live: HTMLElement;

  /** The name-and-verbs row. Held so `fitHead` can measure its overflow. */
  private readonly headNode: HTMLElement;

  /**
   * What the last `fitHead` measured, so the common case costs one string
   * compare instead of a forced reflow.
   *
   * `update()` runs every HUD tick and `fitHead` reads `scrollWidth`, which
   * flushes layout. Doing that unconditionally would put a synchronous reflow
   * in the frame path of a project whose stated budget is zero allocation and
   * 200 units at 60 fps. Everything that can change the row's width is in the
   * signature: which verb groups are shown, the name, the count, and the width
   * the panel has to spend.
   */
  private lastFitSig = '';

  /** Null in jsdom, which has no `ResizeObserver`. */
  private fitObserver: ResizeObserver | null = null;
  private readonly idle: HTMLElement;

  private readonly titleNode: Text;
  private readonly subtitleNode: Text;
  private readonly countEl: HTMLElement;
  private readonly countNode: Text;
  private readonly chevrons: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly hpTextNode: Text;
  /** The bar's wrapper, so the self-repair sweep can be toggled on it rather
   *  than on the inner fill — the fill carries a `scaleX`, which would squash
   *  a sweeping highlight into whatever the current health fraction is. */
  private readonly hpRoot: HTMLElement;
  private readonly mendTag: HTMLElement;
  private readonly cardRow: HTMLElement;
  private readonly cards: CardCell[] = [];
  private readonly statValues: Text[] = [];
  private readonly statChips: HTMLElement[] = [];
  private readonly stanceRow: HTMLElement;
  private readonly stanceLabelNode: Text;
  private readonly stanceButtons: HTMLButtonElement[] = [];
  private readonly relocateRow: HTMLElement;
  private readonly relocateButton: HTMLButtonElement;
  private readonly relocateCostNode: Text;
  private readonly abilityRow: HTMLElement;
  private readonly abilityButton: HTMLButtonElement;
  private readonly abilityLabelNode: Text;
  private readonly abilityNameNode: Text;
  private readonly cargoRow: HTMLElement;
  private readonly cargoButton: HTMLButtonElement;
  private readonly cargoCountNode: Text;
  private readonly garrisonRow: HTMLElement;
  private readonly garrisonButton: HTMLButtonElement;
  private readonly garrisonCountNode: Text;
  private readonly primaryRow: HTMLElement;
  private readonly primaryButton: HTMLButtonElement;
  private readonly primaryLabelNode: Text;
  private readonly destructRow: HTMLElement;
  private readonly destructButton: HTMLButtonElement;
  private readonly destructLabelNode: Text;

  /** The idle advisory line — all that is left of the status board. */
  private readonly adviceNode: Text;
  private lastAdvice = '';

  /**
   * THE SHARED CAMEO RENDERER, handed over by `Sidebar` once the build panel has
   * built it. Not a second instance: `CameoRenderer` owns a render target, a
   * light rig and a model cache, and standing up a second one to draw the same
   * eighteen models into smaller squares would double all of it.
   */
  private cameos: CameoRenderer | null = null;
  private faction: Faction = Faction.Allies;

  private empty = true;
  private lastTitle = '';
  private lastSubtitle = '';
  private lastCount = -1;
  private lastVet = -1;
  private lastStance = -2;
  private lastHp = '';
  private lastMending = false;
  private liveCards = 0;
  private lastRelocate = '';
  private lastAbility = '';
  private lastCargo = '';
  private lastGarrison = '';
  private lastPrimary = '';
  private lastDestruct = '';

  constructor(parent: HTMLElement, private readonly cb: SidebarCallbacks) {
    this.root = panel(parent, 'vm-dock vm-dock-selection', 'diag');
    this.root.dataset.brackets = 'on';
    this.root.setAttribute('aria-label', 'Selection');
    this.root.classList.add('is-empty');

    this.live = el('div', 'vm-sel-live', this.root);
    this.idle = el('div', 'vm-sel-idle', this.root);

    /* -- the name row -------------------------------------------------- *
     * Name, veterancy, then a rule running right to the count and the verbs.
     * The rule is the reference's one consistent header device and it is what
     * ties this panel to the objectives panel and the build palette. */
    const head = el('div', 'vm-sel-head', this.live);
    this.headNode = head;
    const idBlock = el('div', 'vm-sel-id', head);
    this.titleNode = label(idBlock, 'vm-sel-title');
    this.chevrons = el('span', 'vm-sel-vet', idBlock);
    for (let i = 0; i < 2; i++) {
      this.chevrons.appendChild(makeIcon('veterancy', 'vm-icon vm-sel-chevron'));
    }
    this.chevrons.hidden = true;

    el('i', 'vm-sel-rule', head);

    this.countEl = el('div', 'vm-sel-count vm-num', head);
    this.countNode = textNode(this.countEl, '0');
    this.countEl.hidden = true;

    /* -- the verbs, in the head's right end ---------------------------- *
     * Stance and Relocate are mutually exclusive in practice — the stance row
     * is hidden for a selection that cannot move, which is exactly the
     * selection Relocate applies to — so they share the slot and whichever is
     * relevant is the one that is there.
     *
     * The classes are `vm-stances` / `vm-stance-label` / `vm-stance` on
     * purpose: the relocate row IS the stance row's layout and needs no
     * stylesheet of its own. */
    this.stanceRow = el('div', 'vm-stances vm-stance-actions', head);
    this.stanceRow.setAttribute('role', 'radiogroup');
    this.stanceRow.setAttribute('aria-label', 'Stance');
    this.stanceLabelNode = label(this.stanceRow, 'vm-stance-label', 'Stance');
    for (const [stance, icon, name] of STANCES) {
      const b = button(this.stanceRow, 'vm-stance', name);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.title = name;
      b.appendChild(makeIcon(icon, 'vm-icon'));
      b.addEventListener('pointerenter', () => this.cb.sound('hover'));
      b.addEventListener('click', () => {
        this.cb.sound('click');
        this.cb.setStance(stance);
      });
      this.stanceButtons.push(b);
    }

    this.relocateRow = el('div', 'vm-stances', head);
    // "Relocate", not "Move": every other surface — the tooltip, the toast, the
    // refusal sentences — uses that word, and a control whose label disagrees
    // with its own tooltip is a control the player has to read twice.
    label(this.relocateRow, 'vm-stance-label', 'Relocate');
    this.relocateButton = button(this.relocateRow, 'vm-stance', 'Relocate structure');
    this.relocateButton.style.width = 'auto';
    this.relocateButton.style.gap = 'calc(3 * var(--vm-u))';
    this.relocateButton.style.padding = '0 calc(4 * var(--vm-u))';
    this.relocateButton.appendChild(makeIcon('deploy', 'vm-icon'));
    this.relocateCostNode = label(this.relocateButton, 'vm-num', '0');
    this.relocateRow.hidden = true;
    this.relocateButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.relocateButton.addEventListener('click', () => {
      // Dimmed, never `disabled` — the same rule the locked build slot follows.
      // A control that goes unhoverable cannot explain itself, and "why can I
      // not move my Construction Yard" is the whole question the hint answers.
      if (this.relocateButton.getAttribute('aria-disabled') === 'true') {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.relocate();
    });

    /* -- the commander's ability --------------------------------------- *
     * A third occupant of the same slot. It is NOT mutually exclusive with the
     * stance row the way Relocate is — a commander is a mobile unit and takes a
     * stance like any other — so this row sits under it rather than instead of
     * it, and is hidden for the 43 units out of 44 that have no ability.
     *
     * The label carries the ability's NAME rather than a generic "Ability",
     * because the four are genuinely different verbs and a player switching
     * armies has to learn which one they now have. When it is cooling the same
     * node prints the seconds instead — one node, two states, no layout shift. */
    this.abilityRow = el('div', 'vm-stances vm-ability-row', head);
    this.abilityLabelNode = label(this.abilityRow, 'vm-stance-label', 'Ability');
    this.abilityButton = button(this.abilityRow, 'vm-stance vm-ability', 'Use ability');
    this.abilityButton.style.width = 'auto';
    this.abilityButton.style.gap = 'calc(3 * var(--vm-u))';
    this.abilityButton.style.padding = '0 calc(4 * var(--vm-u))';
    this.abilityButton.appendChild(makeIcon('veterancy', 'vm-icon'));
    this.abilityNameNode = label(this.abilityButton, '', '');
    this.abilityRow.hidden = true;
    this.abilityButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.abilityButton.addEventListener('click', () => {
      // Dimmed, never `disabled`, for the reason spelled out on Relocate above.
      if (this.abilityButton.getAttribute('aria-disabled') === 'true') {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.useAbility();
    });

    /* -- the transport's cargo ----------------------------------------- *
     * A fourth occupant of the same slot, hidden for everything without seats.
     * The count node reads "3 / 5" and is the only place in the entire product
     * that says whether a transport is carrying anything — its passengers are
     * flagged `Garrisoned`, which the render bridge, the minimap, the overlay
     * and selection all treat as "not there". */
    this.cargoRow = el('div', 'vm-stances vm-cargo-row', head);
    label(this.cargoRow, 'vm-stance-label', 'Cargo');
    this.cargoButton = button(this.cargoRow, 'vm-stance vm-cargo', 'Unload passengers');
    this.cargoButton.style.width = 'auto';
    this.cargoButton.style.gap = 'calc(3 * var(--vm-u))';
    this.cargoButton.style.padding = '0 calc(4 * var(--vm-u))';
    this.cargoButton.appendChild(makeIcon('deploy', 'vm-icon'));
    label(this.cargoButton, '', 'Unload');
    this.cargoCountNode = label(this.cargoButton, 'vm-num', '0 / 0');
    this.cargoRow.hidden = true;
    this.cargoButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.cargoButton.addEventListener('click', () => {
      // Dimmed, never `disabled`, for the reason spelled out on Relocate above.
      if (this.cargoButton.getAttribute('aria-disabled') === 'true') {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.unload();
    });

    /* -- the garrison's occupancy -------------------------------------- *
     * The cargo row, one entity kind over. Infantry walked into a building
     * could never come out: `GarrisonService.evacuate` shipped with a comment
     * naming "the HUD's evacuate button" and no caller anywhere in `src/ui` or
     * `src/input`. Same shape as Cargo, same word on the label rail, and the
     * same D key drives both — a garrison and a transport are one verb. */
    this.garrisonRow = el('div', 'vm-stances vm-cargo-row vm-garrison-row', head);
    label(this.garrisonRow, 'vm-stance-label', 'Garrison');
    this.garrisonButton = button(
      this.garrisonRow,
      'vm-stance vm-cargo vm-garrison-evacuate',
      'Evacuate the garrison',
    );
    this.garrisonButton.appendChild(makeIcon('deploy', 'vm-icon'));
    label(this.garrisonButton, '', 'Evacuate');
    this.garrisonCountNode = label(this.garrisonButton, 'vm-num', '0');
    this.garrisonRow.hidden = true;
    this.garrisonButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.garrisonButton.addEventListener('click', () => {
      // Dimmed, never `disabled`, for the reason spelled out on Relocate above.
      if (this.garrisonButton.getAttribute('aria-disabled') === 'true') {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.evacuate();
    });

    /* -- the primary factory ------------------------------------------- *
     * `CommandKind.SetPrimary` has existed since the enum was written and
     * nothing ever issued it. The button stays visible and lit once this
     * factory IS the primary, because that lit state is the only readout in the
     * product for "which of my two War Factories do tanks come out of". */
    this.primaryRow = el('div', 'vm-stances vm-primary-row', head);
    label(this.primaryRow, 'vm-stance-label', 'Factory');
    this.primaryButton = button(this.primaryRow, 'vm-stance vm-primary', 'Set primary factory');
    this.primaryButton.style.width = 'auto';
    this.primaryButton.style.gap = 'calc(3 * var(--vm-u))';
    this.primaryButton.style.padding = '0 calc(4 * var(--vm-u))';
    this.primaryButton.appendChild(makeIcon('primary', 'vm-icon'));
    this.primaryLabelNode = label(this.primaryButton, '', 'Set Primary');
    this.primaryRow.hidden = true;
    this.primaryButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.primaryButton.addEventListener('click', () => {
      // Dimmed, never `disabled`, for the reason spelled out on Relocate above.
      if (this.primaryButton.getAttribute('aria-disabled') === 'true') {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.setPrimary();
    });

    /* -- self destruct -------------------------------------------------- *
     * The one irreversible verb on the panel, so it is the one that asks
     * twice. The HUD owns the latch; the second click is what reaches
     * `channels.commands`. See `SelfDestructAction`.
     *
     * `vm-destruct` rather than the plain stance treatment: this is the only
     * control in the interface that destroys something of yours on purpose, and
     * it should not look like the button next to it. */
    this.destructRow = el('div', 'vm-stances vm-destruct-row', head);
    label(this.destructRow, 'vm-stance-label', 'Scuttle');
    this.destructButton = button(this.destructRow, 'vm-stance vm-destruct', 'Self-destruct');
    this.destructButton.style.width = 'auto';
    this.destructButton.style.gap = 'calc(3 * var(--vm-u))';
    this.destructButton.style.padding = '0 calc(4 * var(--vm-u))';
    this.destructButton.appendChild(makeIcon('alert', 'vm-icon'));
    this.destructLabelNode = label(this.destructButton, '', 'Destruct');
    this.destructRow.hidden = true;
    this.destructButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.destructButton.addEventListener('click', () => {
      this.cb.sound('click');
      this.cb.selfDestruct();
    });

    /* -- the body: cameo left, description right ----------------------- */
    const body = el('div', 'vm-sel-body', this.live);

    this.cardRow = el('div', 'vm-sel-cards', body);
    this.cardRow.setAttribute('role', 'listbox');
    this.cardRow.setAttribute('aria-label', 'Selected units');
    for (let i = 0; i < CARD_POOL; i++) this.cards.push(this.buildCard());

    const info = el('div', 'vm-sel-info', body);
    this.subtitleNode = label(info, 'vm-sel-sub');

    const stats = el('div', 'vm-sel-stats', info);
    const STAT_SPEC: ReadonlyArray<readonly [IconName, string, string]> = [
      ['armour', 'Armour', 'Arm'],
      ['damage', 'Damage per second', 'Dps'],
      ['range', 'Weapon range', 'Rng'],
      ['speed', 'Movement speed', 'Spd'],
    ];
    for (const [icon, title, key] of STAT_SPEC) {
      const chip = el('div', 'vm-stat', stats);
      chip.title = title;
      chip.appendChild(makeIcon(icon, 'vm-icon vm-stat-icon'));
      label(chip, 'vm-stat-key', key);
      this.statValues.push(label(chip, 'vm-stat-value vm-num', '—'));
      this.statChips.push(chip);
    }

    /* -- the health bar ------------------------------------------------ *
     * Full width along the bottom with the absolute hit points laid over it,
     * exactly as the reference draws it. The old panel put a 54-unit stub and
     * a right-aligned number in the header, where it competed with the name
     * for the eye and lost. Absolute points, not an average of fractions:
     * twelve conscripts and one Sledge at 60% are not the same army, and
     * how much punishment the GROUP can still take is the question. */
    const hp = el('div', 'vm-sel-hp', this.live);
    this.hpRoot = hp;
    const hpTrack = el('span', 'vm-sel-hp-track', hp);
    this.hpBar = el('i', '', hpTrack);
    this.hpTextNode = label(hp, 'vm-sel-hp-text vm-num', '');
    /* SELF-REPAIR, said in a word.
     *
     * The player reported idle healing as invisible. `src/ui/Overlay.ts` marks
     * it on the world bar for every unit; this is the same fact on the panel the
     * player is already looking at when they have the unit selected. The sweep
     * animation on `.vm-sel-hp.is-regen` carries it at a glance and this tag is
     * what makes it unambiguous — a moving highlight alone could be read as a
     * loading state. */
    this.mendTag = el('span', 'vm-sel-hp-mend', hp);
    this.mendTag.textContent = 'Repairing';
    this.mendTag.hidden = true;

    /* -- the idle advisory --------------------------------------------- */
    this.idle.appendChild(makeIcon('info', 'vm-icon'));
    this.adviceNode = label(this.idle, 'vm-sel-advice', IDLE_HINT);

    /* The only thing that tells `fitHead` the available width moved.
     *
     * It cannot come from `update()`: the signature there is deliberately free
     * of layout reads, so a window resize with an unchanged selection would
     * otherwise never re-measure and the row would keep whichever fit it
     * happened to have. Clearing the signature is enough — the next tick
     * re-measures. Guarded because `ResizeObserver` is absent in jsdom, where
     * `tests/hud-top-row.spec.ts` builds this panel. */
    if (typeof ResizeObserver === 'function') {
      this.fitObserver = new ResizeObserver(() => { this.lastFitSig = ''; });
      this.fitObserver.observe(this.root);
    }
  }

  private buildCard(): CardCell {
    const root = button(this.cardRow, 'vm-card', 'Unit');
    root.setAttribute('role', 'option');
    root.setAttribute('aria-selected', 'false');
    root.hidden = true;

    const icon = makeIcon('tank', 'vm-icon vm-card-icon');
    root.appendChild(icon);

    // Same arrangement as a build slot: the canvas sits over the glyph and is
    // revealed only on a successful bind, so a def with no model leaves the
    // pictogram showing and this cannot make the dock worse than it was.
    const cameoCanvas = document.createElement('canvas');
    cameoCanvas.className = 'vm-card-cameo';
    cameoCanvas.hidden = true;
    root.appendChild(cameoCanvas);

    const nameNode = label(root, 'vm-card-name', '');

    const stackEl = el('span', 'vm-card-stack vm-num', root);
    const stackNode = textNode(stackEl);
    stackEl.hidden = true;

    const vetEl = el('span', 'vm-card-vet', root);
    vetEl.hidden = true;

    const barTrack = el('span', 'vm-card-bar', root);
    const bar = el('i', 'is-ok', barTrack);

    const cell: CardCell = {
      root, icon, cameoCanvas, bar, nameNode, stackEl, stackNode, vetEl, id: 0, sig: '',
    };

    root.addEventListener('pointerenter', () => this.cb.sound('hover'));
    root.addEventListener('click', (ev) => {
      this.cb.sound('click');
      this.cb.focusCard(cell.id, ev.shiftKey || ev.ctrlKey);
    });
    return cell;
  }

  /**
   * Hand over the build panel's cameo renderer, and keep the army colours in
   * step. Both are no-ops in a headless build, where `cameos` stays null.
   */
  setCameos(cameos: CameoRenderer | null): void {
    this.cameos = cameos;
    for (const c of this.cards) c.sig = '';
  }

  setFaction(faction: Faction): void {
    if (this.faction === faction) return;
    this.faction = faction;
    // Every bound cameo is now wearing the wrong army's colours.
    for (const c of this.cards) c.sig = '';
  }

  /**
   * Render one card's actual model into its canvas.
   *
   * Called only from the signature-gated branch above, so this is once per card
   * per CHANGE — not per frame. `CameoRenderer.bind` queues the render and the
   * HUD's existing `frameCameos` pump drains it, which is the same path the
   * build rail has always used.
   */
  private bindCardCameo(cell: CardCell, data: SelectionCard): void {
    const cameos = this.cameos;
    if (cameos === null || data.cameoKey === '') {
      cell.cameoCanvas.hidden = true;
      return;
    }
    try {
      // Size the backing store to the cell and the device ratio, capped at 2 so
      // a 4x display does not quietly quadruple the cost — the same reasoning,
      // and the same bug, as `BuildPanel.bindCameo`, where a default 300x150
      // canvas was being squashed into the cell at the wrong aspect.
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const w = Math.max(16, Math.round(cell.root.clientWidth * dpr));
      const h = Math.max(16, Math.round(cell.root.clientHeight * dpr));
      if (w > 16 && cell.cameoCanvas.width !== w) cell.cameoCanvas.width = w;
      if (h > 16 && cell.cameoCanvas.height !== h) cell.cameoCanvas.height = h;
      cameos.bind(cell.cameoCanvas, {
        key: data.cameoKey,
        name: data.name,
        faction: this.faction,
        tab: data.isBuilding ? BuildTab.Structures : BuildTab.Infantry,
        isBuilding: data.isBuilding,
        footprintW: 0,
        footprintH: 0,
      });
      cell.cameoCanvas.hidden = false;
    } catch (err) {
      console.warn(`[hud] selection cameo bind failed for "${data.cameoKey}"`, err);
      cell.cameoCanvas.hidden = true;
    }
  }

  update(view: SelectionView, _snap: HudSnapshot, tele: HudTelemetry): void {
    const empty = view.count === 0;
    if (empty !== this.empty) {
      this.empty = empty;
      this.root.classList.toggle('is-empty', empty);
      this.root.setAttribute('aria-label', empty ? 'Base advisory' : 'Selection');
    }
    if (empty) {
      for (let i = 0; i < this.liveCards; i++) this.cards[i].root.hidden = true;
      this.liveCards = 0;
      // The whole live half is display:none while empty, but the row is left in
      // a clean state so re-selecting the same structure cannot flash a stale
      // price for one frame.
      if (!this.relocateRow.hidden) {
        this.relocateRow.hidden = true;
        this.lastRelocate = '';
      }
      if (!this.abilityRow.hidden) {
        this.abilityRow.hidden = true;
        this.lastAbility = '';
      }
      if (!this.cargoRow.hidden) {
        this.cargoRow.hidden = true;
        this.lastCargo = '';
      }
      if (!this.garrisonRow.hidden) {
        this.garrisonRow.hidden = true;
        this.lastGarrison = '';
      }
      if (!this.primaryRow.hidden) {
        this.primaryRow.hidden = true;
        this.lastPrimary = '';
      }
      if (!this.destructRow.hidden) {
        this.destructRow.hidden = true;
        this.lastDestruct = '';
      }
      this.updateAdvice(tele);
      return;
    }

    if (view.title !== this.lastTitle) {
      this.lastTitle = view.title;
      this.titleNode.nodeValue = view.title;
    }
    if (view.subtitle !== this.lastSubtitle) {
      this.lastSubtitle = view.subtitle;
      this.subtitleNode.nodeValue = view.subtitle;
    }
    if (view.count !== this.lastCount) {
      this.lastCount = view.count;
      this.countNode.nodeValue = `x${view.count}`;
      this.countEl.hidden = view.count < 2;
    }
    if (view.veterancy !== this.lastVet) {
      this.lastVet = view.veterancy;
      const kids = this.chevrons.children;
      for (let i = 0; i < kids.length; i++) {
        (kids[i] as HTMLElement).hidden = i >= view.veterancy;
      }
      this.chevrons.hidden = view.veterancy <= 0;
    }

    /* -- aggregate health ---------------------------------------------- */
    if (view.hpText !== this.lastHp) {
      this.lastHp = view.hpText;
      this.hpTextNode.nodeValue = view.hpText;
      const f = Math.max(0, Math.min(1, view.hpFrac));
      this.hpBar.style.transform = `scaleX(${f.toFixed(3)})`;
      this.hpBar.className = f > 0.6 ? '' : f > 0.3 ? 'is-hurt' : 'is-critical';
    }
    // Guarded separately from `hpText`: at 2.5%/s the hit-point STRING can go
    // several frames without changing, and the tag has to appear on the tick
    // the healing starts rather than on the next whole point of hp.
    if (view.mending !== this.lastMending) {
      this.lastMending = view.mending;
      this.hpRoot.classList.toggle('is-regen', view.mending);
      this.mendTag.hidden = !view.mending;
    }

    /* -- cards --------------------------------------------------------- */
    const n = Math.min(view.cardCount, CARD_POOL);
    for (let i = 0; i < n; i++) {
      const cell = this.cards[i];
      const data = view.cards[i];
      cell.id = data.id;

      const pct = Math.max(0, Math.min(1, data.hpFrac));
      const sig = `${data.icon}|${data.name}|${(pct * 100) | 0}|${data.stack}|` +
        `${data.veterancy}|${data.primary ? 1 : 0}|${data.cameoKey}|${this.faction}`;
      if (sig === cell.sig && !cell.root.hidden) continue;
      cell.sig = sig;

      cell.root.hidden = false;
      cell.root.setAttribute('aria-label', data.name);
      cell.root.setAttribute('aria-selected', data.primary ? 'true' : 'false');
      cell.root.classList.toggle('is-primary', data.primary);
      setIcon(cell.icon, data.icon);
      this.bindCardCameo(cell, data);
      cell.nameNode.nodeValue = data.name;

      cell.bar.style.transform = `scaleX(${pct.toFixed(3)})`;
      cell.bar.className = pct > 0.6 ? 'is-ok' : pct > 0.3 ? 'is-hurt' : 'is-critical';

      if (data.stack > 1) {
        cell.stackNode.nodeValue = `x${data.stack}`;
        cell.stackEl.hidden = false;
      } else {
        cell.stackEl.hidden = true;
      }

      cell.vetEl.hidden = data.veterancy <= 0;
      if (data.veterancy > 0) cell.vetEl.dataset.rank = String(data.veterancy);
    }
    for (let i = n; i < this.liveCards; i++) {
      this.cards[i].root.hidden = true;
      this.cards[i].sig = '';
    }
    this.liveCards = n;

    /* -- stats --------------------------------------------------------- */
    this.setStat(0, view.armour);
    this.setStat(1, view.damage);
    this.setStat(2, view.range);
    this.setStat(3, view.speed);

    /* -- stance -------------------------------------------------------- */
    const stance = view.stanceEnabled ? (view.stance as number) : -1;
    if (stance !== this.lastStance) {
      this.lastStance = stance;
      this.stanceRow.hidden = !view.stanceEnabled;
      let name = 'Mixed';
      for (let i = 0; i < this.stanceButtons.length; i++) {
        const on = (STANCES[i][0] as number) === stance;
        if (on) name = STANCES[i][2];
        this.stanceButtons[i].classList.toggle('is-active', on);
        this.stanceButtons[i].setAttribute('aria-checked', on ? 'true' : 'false');
      }
      this.stanceLabelNode.nodeValue = stance < 0 ? 'Stance' : name;
    }

    this.updateRelocate(view.relocate);
    this.updateAbility(view.ability);
    this.updateCargo(view.cargo);
    this.updateGarrison(view.garrison);
    this.updatePrimary(view.primary);
    this.updateDestruct(view.selfDestruct);
    this.fitHead();
  }

  /**
   * Keep the name-and-verbs row inside the panel.
   *
   * WHY THIS IS MEASURED AND NOT A BREAKPOINT. Which verb groups a selection
   * shows is a property of the SELECTION, not of the viewport — a lone
   * commander in a transport shows Ability and Cargo, a War Factory shows
   * Factory, a mixed force shows neither — so the width the row wants changes
   * without the window moving. No media query can see that. Reported as "hud
   * contents being cut": SELF-DESTRUCT drawn 431 px past the panel's own frame,
   * because `.vm-dock-selection` was capped at 520 px of a 1280 px frame while
   * the row wanted 944 and nothing in it could shrink.
   *
   * ORDER MATTERS. `is-tight` is the thing that makes the row narrow, so
   * measuring with it still applied reports the tight width, `scrollWidth`
   * fits, and the class can never come back off — the row would stay
   * captionless forever after one narrow moment. Strip it, measure the natural
   * width, then decide.
   *
   * THE SIGNATURE HOLDS NO LAYOUT READ, deliberately. Putting `clientWidth` in
   * it looks like the obvious way to notice a resize and is a trap: the rows
   * above have already written text this tick, so reading any geometry flushes
   * layout, and a HP readout that ticks would then force a synchronous reflow
   * every frame. Width changes arrive through the `ResizeObserver` below
   * instead, which fires only when the panel actually resizes.
   */
  private fitHead(): void {
    const head = this.headNode;
    const cards = this.cardRow;
    const sig = `${this.stanceRow.hidden ? 0 : 1}${this.relocateRow.hidden ? 0 : 1}`
      + `${this.abilityRow.hidden ? 0 : 1}${this.cargoRow.hidden ? 0 : 1}`
      + `${this.garrisonRow.hidden ? 0 : 1}${this.primaryRow.hidden ? 0 : 1}`
      + `${this.destructRow.hidden ? 0 : 1}`
      + `|${this.titleNode.nodeValue ?? ''}|${this.countNode.nodeValue ?? ''}`;
    if (sig === this.lastFitSig) return;
    this.lastFitSig = sig;

    head.classList.remove('is-tight');
    if (head.scrollWidth > head.clientWidth) head.classList.add('is-tight');

    // The strip has always scrolled; nothing ever said so. One pixel of slack
    // because a fractional layout width rounds `scrollWidth` up on its own and
    // would otherwise fade a strip that fits exactly.
    cards.classList.toggle('is-clipped', cards.scrollWidth > cards.clientWidth + 1);
  }

  /**
   * The garrison's occupancy readout and Evacuate button.
   *
   * Signature-gated like every other row here, on an INTEGER count, so a
   * strongpoint with a steady squad in it writes no DOM at all.
   */
  private updateGarrison(action: GarrisonAction): void {
    const sig = action.visible
      ? `${action.enabled ? 1 : 0}|${action.count}|${action.hint}`
      : '';
    if (sig === this.lastGarrison) return;
    this.lastGarrison = sig;

    this.garrisonRow.hidden = !action.visible;
    if (!action.visible) return;

    this.garrisonCountNode.nodeValue = String(action.count);
    this.garrisonButton.title = action.hint;
    this.garrisonButton.setAttribute('aria-label', `Evacuate — ${action.hint}`);
    this.garrisonButton.setAttribute('aria-disabled', action.enabled ? 'false' : 'true');
    this.garrisonButton.style.opacity = action.enabled ? '1' : '0.4';
  }

  /**
   * The primary-factory toggle.
   *
   * Two states in one node — SET PRIMARY and PRIMARY — because the second is
   * the readout and the first is the verb, and giving them separate elements
   * would shift the layout every time the player pressed it.
   */
  private updatePrimary(action: PrimaryAction): void {
    const sig = action.visible
      ? `${action.enabled ? 1 : 0}|${action.isPrimary ? 1 : 0}|${action.hint}`
      : '';
    if (sig === this.lastPrimary) return;
    this.lastPrimary = sig;

    this.primaryRow.hidden = !action.visible;
    if (!action.visible) return;

    this.primaryLabelNode.nodeValue = action.isPrimary ? 'Primary' : 'Set Primary';
    this.primaryButton.title = action.hint;
    this.primaryButton.setAttribute('aria-label', action.hint);
    this.primaryButton.setAttribute('aria-pressed', action.isPrimary ? 'true' : 'false');
    this.primaryButton.setAttribute('aria-disabled', action.enabled ? 'false' : 'true');
    this.primaryButton.classList.toggle('is-active', action.isPrimary);
    this.primaryButton.style.opacity = action.enabled || action.isPrimary ? '1' : '0.4';
  }

  /**
   * The self-destruct button.
   *
   * NOT dimmed-when-disabled like its neighbours, because it has no disabled
   * state: the row is either absent (nothing scuttleable selected) or live. Its
   * two states are ARMED and not, and the armed one is the loud one.
   */
  private updateDestruct(action: SelfDestructAction): void {
    const sig = action.visible
      ? `${action.count}|${action.armed ? 1 : 0}|${action.hint}`
      : '';
    if (sig === this.lastDestruct) return;
    this.lastDestruct = sig;

    this.destructRow.hidden = !action.visible;
    if (!action.visible) return;

    this.destructLabelNode.nodeValue = action.armed ? 'Confirm' : 'Destruct';
    this.destructButton.title = action.hint;
    this.destructButton.setAttribute('aria-label', action.hint);
    this.destructButton.classList.toggle('is-armed', action.armed);
  }

  /**
   * The commander's ability button.
   *
   * Signature-gated like every other row here, and the signature deliberately
   * quantises the cooldown to WHOLE SECONDS. The raw value changes every frame,
   * so a signature carrying it would defeat the gate entirely and rewrite three
   * DOM nodes 60 times a second for a label that only ever shows integers.
   */
  private updateAbility(action: AbilityAction): void {
    const secs = Math.ceil(action.cooldown);
    const sig = action.visible
      ? `${action.enabled ? 1 : 0}|${action.label}|${secs}|${action.hint}`
      : '';
    if (sig === this.lastAbility) return;
    this.lastAbility = sig;

    this.abilityRow.hidden = !action.visible;
    if (!action.visible) return;

    const cooling = secs > 0;
    this.abilityLabelNode.nodeValue = cooling ? 'Cooling' : 'Ability';
    this.abilityNameNode.nodeValue = cooling ? `${secs}s` : action.label;
    this.abilityButton.title = action.hint;
    this.abilityButton.setAttribute('aria-label', `${action.label} — ${action.hint}`);
    this.abilityButton.setAttribute('aria-disabled', action.enabled ? 'false' : 'true');
    this.abilityButton.classList.toggle('is-cooling', cooling);
    this.abilityButton.style.opacity = action.enabled ? '1' : '0.4';
  }

  /**
   * The transport's cargo readout and Unload button.
   *
   * Signature-gated like every other row here. The count is INTEGER men, so
   * unlike the ability cooldown there is nothing to quantise: a steady
   * transport writes no DOM at all until somebody gets in or out.
   *
   * NO FIELD IN THE SIGNATURE COUNTS HULLS, and none is needed: both numbers
   * are sums across the selection and how many hulls they came from is already
   * spelled out in `hint`, which the gate hashes. A field that changed without
   * changing the gate would leave the row stale — the reason this string exists
   * at all — so anything added to `CargoAction` has to be added here too.
   */
  private updateCargo(action: CargoAction): void {
    const sig = action.visible
      ? `${action.enabled ? 1 : 0}|${action.count}/${action.capacity}|${action.hint}`
      : '';
    if (sig === this.lastCargo) return;
    this.lastCargo = sig;

    this.cargoRow.hidden = !action.visible;
    if (!action.visible) return;

    this.cargoCountNode.nodeValue = `${action.count} / ${action.capacity}`;
    this.cargoButton.title = action.hint;
    this.cargoButton.setAttribute('aria-label', `Unload — ${action.hint}`);
    this.cargoButton.setAttribute('aria-disabled', action.enabled ? 'false' : 'true');
    this.cargoRow.classList.toggle('is-ready', action.enabled);
    this.cargoButton.classList.toggle('is-ready', action.enabled);
    this.cargoButton.style.opacity = action.enabled ? '1' : '0.4';
  }

  /**
   * The Relocate button.
   *
   * Signature-gated like every other row in this panel: a steady selection
   * performs no DOM writes at all, which matters because this runs every frame
   * and the price it prints is recomputed from the sim every frame.
   */
  private updateRelocate(action: RelocateAction): void {
    const sig = action.visible
      ? `${action.enabled ? 1 : 0}|${action.cost}|${action.hint}|${action.armed ? 1 : 0}`
      : '';
    if (sig === this.lastRelocate) return;
    this.lastRelocate = sig;

    this.relocateRow.hidden = !action.visible;
    if (!action.visible) return;

    this.relocateCostNode.nodeValue = formatCredits(action.cost);
    this.relocateButton.title = action.hint;
    this.relocateButton.setAttribute('aria-label', action.hint);
    this.relocateButton.setAttribute('aria-disabled', action.enabled ? 'false' : 'true');
    this.relocateButton.classList.toggle('is-active', action.armed);
    this.relocateButton.style.opacity = action.enabled ? '1' : '0.4';
  }

  /**
   * The one line the status board left behind.
   *
   * A nominal base has nothing to report, so it gets the hint instead — a
   * sentence that teaches the panel rather than one that says "everything is
   * fine" in a slot the player has already learned to ignore.
   */
  private updateAdvice(tele: HudTelemetry): void {
    const nominal = tele.adviceKind === 'info';
    const text = nominal ? IDLE_HINT : tele.advice;
    const sig = `${text}|${tele.adviceKind}`;
    if (sig === this.lastAdvice) return;
    this.lastAdvice = sig;
    this.adviceNode.nodeValue = text;
    this.idle.className = `vm-sel-idle${nominal ? '' : ` is-${tele.adviceKind}`}`;
  }

  private setStat(i: number, value: string): void {
    const node = this.statValues[i];
    const next = value === '' ? '—' : value;
    if (node.nodeValue === next) return;
    node.nodeValue = next;
    this.statChips[i].classList.toggle('is-blank', value === '');
  }

  dispose(): void {
    // Before `this.root.remove()`, so the observer is not left holding a
    // detached node for the rest of the session.
    this.fitObserver?.disconnect();
    this.fitObserver = null;
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 4 — THE BUILD PALETTE  (bottom right)
 *
 * The reference's tab strip RISES ABOVE the panel body: the notched tabs sit
 * on top of the palette rather than inside it. That cannot be done from inside
 * one clipped box, so `.vm-dock-build` is a bare container holding the strip
 * and then `.vm-build-body`, which is the panel. Both class names are
 * unchanged, which matters — `src/shell/tutorial-steps.ts` spotlights
 * `.vm-dock-build` and `.vm-dock-build .vm-grid`.
 * ========================================================================== */

/** Why a slot cannot be clicked right now. Drives the banner and its colour. */
type BlockKind = '' | 'tech' | 'funds' | 'power' | 'owned';

/**
 * Classify a production `reason` string into one of three banners.
 *
 * The strings come from `src/sim/Production.ts`, which is not ours and is free
 * to reword them, so this is deliberately keyword matching with a safe default
 * rather than an equality table: an unrecognised sentence still shows LOCKED and
 * still puts the full text in the tooltip.
 */
function blockKindOf(reason: string): BlockKind {
  if (reason === '') return '';
  const r = reason.toLowerCase();
  // OWNED IS TESTED BEFORE EVERYTHING, because it is the only refusal in the
  // list that is GOOD NEWS. An installed upgrade is unbuildable for the best
  // possible reason, and the default at the bottom of this function is
  // 'tech' -> "Locked" — so without this line a player who had just spent 1200
  // credits would watch the cameo they bought start reading LOCKED.
  if (r.includes('installed')) return 'owned';
  // TECH IS TESTED FIRST OF THE REST, and specifically before `power`.
  // "Requires Power Plant" is a missing prerequisite, not a power shortage —
  // matching on the bare word "power" labelled half the Allied structure tab
  // POWER in amber when the player's grid was at 280 of 400 and perfectly
  // healthy.
  if (r.includes('require') || r.includes('need') || r.includes('build ')) return 'tech';
  if (r.includes('fund') || r.includes('credit') || r.includes('afford')) return 'funds';
  if (r.includes('power') || r.includes('brownout')) return 'power';
  return 'tech';
}

/**
 * The sentence a locked slot shows, with the granting mission folded in.
 *
 * `reason` is whatever `src/sim/Production.ts` and `UnlockGate` produced.
 * `hint` is `BuildExtras.unlockHint` — `Strip Mine: mine 70,000 credits of
 * ore` — and is '' for the overwhelming majority of defs, which carry no
 * progression tag at all.
 *
 * WHY THE MISSION REPLACES THE TAIL RATHER THAN BEING APPENDED. The gate's
 * constant is `Locked — complete a mission`, and appending would produce
 * "Locked — complete a mission — Strip Mine: ...", which says "a mission"
 * and then names it. The em-dash tail is cut and the real answer put in its
 * place, so the line reads `Locked — Strip Mine: mine 70,000 credits of ore`.
 *
 * A reason with no dash, or an unrecognised one, keeps its whole self and gains
 * the mission after a dash. That is the same "unrecognised sentence still shows
 * something useful" default `blockKindOf` above takes, and for the same reason:
 * these strings are not ours and are free to be reworded.
 */
export function lockedSentence(reason: string, hint: string): string {
  if (hint === '') return reason;
  if (reason === '') return `Locked — ${hint}`;
  const dash = reason.indexOf('—');
  const head = dash > 0 ? reason.slice(0, dash).trimEnd() : reason;
  return `${head} — ${hint}`;
}

const BLOCK_WORDS: Readonly<Record<Exclude<BlockKind, ''>, string>> = {
  tech: 'Locked',
  funds: 'Funds',
  power: 'Power',
  owned: 'Installed',
};

interface BuildSlot {
  root: HTMLButtonElement;
  icon: SVGSVGElement;
  nameNode: Text;
  costNode: Text;
  keyEl: HTMLElement;
  keyNode: Text;
  queueEl: HTMLElement;
  queueNode: Text;
  readyEl: HTMLElement;
  etaEl: HTMLElement;
  etaNode: Text;
  /** The 3D cameo surface. Hidden until a model actually binds to it. */
  cameoCanvas: HTMLCanvasElement;
  /** "how many of these do I already have" — see `vm-slot-owned`. */
  ownedEl: HTMLElement;
  ownedNode: Text;
  flagEl: HTMLElement;
  flagNode: Text;
  progress: HTMLElement;
  /** The live cameo this slot renders, or null when the slot is empty. */
  cameo: HudCameo | null;
  /** Cached state, so a steady slot performs no DOM writes at all. */
  sig: string;
  key: string;
  /** Build time in seconds for `key`, resolved once per content change. */
  buildTime: number;

  /* -- observed build rate, for an honest countdown -------------------------
   * The countdown used to be `buildTime * (1 - progress)`, which is the time a
   * build takes at its NOMINAL rate. Three things move the real rate and the
   * formula knew about none of them:
   *
   *   - `player.buildSpeedMul`, a continuous function of the power supply ratio
   *     (`src/sim/Power.ts`), so a brownout stretches every build;
   *   - `factorySpeed(factoryCount)`, which makes builds FASTER with more
   *     factories;
   *   - affordability. `BuildQueue` charges per tick and advances only the
   *     slice it managed to pay for: "a poor player does not stop - they crawl.
   *     A tick that can only afford 40% of its increment advances 40% of its
   *     increment." Deliberate, and invisible to a nominal countdown.
   *
   * Two of those three make a build take LONGER than advertised, which is the
   * report: "the timer shows 5s but takes twice and more". Rather than mirror
   * the sim's rate arithmetic up here — a second copy of a formula that would
   * drift the first time either changes — the slot MEASURES how fast progress
   * is actually moving and extrapolates. That is correct for every cause at
   * once, including causes added later.
   * ---------------------------------------------------------------------- */
  /** `progress` at the previous sample, or -1 when there is no sample yet. */
  lastProgress: number;
  /** `performance.now()` of that sample. Render-side only; never the sim. */
  lastAt: number;
  /** Smoothed progress-per-second. 0 until two samples exist. */
  rate: number;
}

class BuildPanel {
  readonly root: HTMLElement;

  private readonly heightResize: VerticalPanelResize;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly tabAlerts: HTMLElement[] = [];
  private readonly grid: HTMLElement;
  private readonly slots: BuildSlot[] = [];
  private readonly tools: HTMLButtonElement[] = [];
  /** See `setUrgentSell`. Mirrors the class so the DOM is touched only on a change. */
  private urgentSell = false;
  private readonly tooltip: Tooltip;

  /* -- the brief -------------------------------------------------------- *
   * The one-line description, permanently on screen. See `setBrief`.      */
  private readonly briefNameNode: Text;
  private readonly briefTextEl: HTMLElement;
  private readonly briefTextNode: Text;
  /** Signature of what the brief currently says. Gates every DOM write. */
  private briefSig = '';
  /**
   * The entry the brief is following: the last one hovered or focused, and ''
   * until something has been. It is deliberately NOT cleared on pointerleave —
   * see `setBrief`.
   */
  private briefKey = '';

  private activeTab: BuildTab = BuildTab.Structures;
  /** Same live rate multiplier BuildQueue uses for the active tab. */
  private currentBuildRate = 1;
  /**
   * Which tabs are on screen, in `BuildTab` order.
   *
   * Mirrors `HudSnapshot.tabVisible`, kept as a field because three things ask
   * it — the strip's `hidden` flags, the arrow-key walk, and the guard that
   * pulls `activeTab` off a tab that has just gone away. Seeded to the four
   * that are always there so the constructor can read it before any snapshot
   * has arrived.
   */
  private readonly tabVisible: boolean[] = [true, true, true, true, false];
  private armed: ArmedMode = 'none';
  private extras: ((key: string) => BuildExtras) | null = null;
  private liveSlots = 0;

  /**
   * Renders each slot's ACTUAL MODEL into its canvas. Null in any build with no
   * GL context; the flat glyph underneath is the fallback and must keep working.
   */
  private cameos: CameoRenderer | null = null;
  /** Whose colours the cameos wear. Kept in step by `setFaction`. */
  private faction: Faction;

  /**
   * The one cameo renderer in the HUD, so the selection dock can draw the same
   * models without standing up a second render target and light rig.
   */
  get cameoRenderer(): CameoRenderer | null { return this.cameos; }

  constructor(
    parent: HTMLElement,
    private readonly cb: SidebarCallbacks,
    tipHost: HTMLElement,
    faction: Faction = Faction.Allies,
    renderer: CameoRendererTarget | null = null,
  ) {
    this.faction = faction;
    if (renderer !== null) {
      try {
        this.cameos = new CameoRenderer(renderer);
        this.cameos.setModelProvider(createCameoModelProvider());
      } catch (err) {
        console.warn('[hud] cameo renderer unavailable; slots keep their glyphs', err);
        this.cameos = null;
      }
    }
    this.root = el('div', 'vm-dock vm-dock-build', parent);
    this.root.setAttribute('aria-label', 'Construction');
    this.tooltip = new Tooltip(tipHost);

    /* -- tab strip, above the body ------------------------------------- */
    const strip = el('div', 'vm-tabs', this.root);
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Build categories');

    // The command-deck composition gives the palette an explicit instrument
    // title.  It is presentation only: the tablist and all existing keyboard
    // semantics remain unchanged.
    const buildTitle = el('div', 'vm-build-title', strip);
    buildTitle.setAttribute('aria-hidden', 'true');
    buildTitle.appendChild(makeIcon('repair', 'vm-icon vm-build-title-icon'));
    label(buildTitle, 'vm-build-title-label', 'BUILD');

    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const tab = t as BuildTab;
      const b = button(strip, `vm-tab${t === 0 ? ' is-active' : ''}`, TAB_LABELS[t]);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t === 0 ? 'true' : 'false');
      b.tabIndex = t === 0 ? 0 : -1;
      // BUILT ONCE, HIDDEN UNTIL EARNED. `CommanderPowerBar` is the precedent
      // and the reason: build the whole pool up front, park what is not wanted,
      // and let `update` flip `hidden`. Creating the button lazily would mean a
      // DOM insertion in the middle of a frame the first time a Command Post
      // finished, and `this.tabs` is indexed by `BuildTab` everywhere below.
      b.hidden = !this.tabVisible[t];
      const key = TAB_HOTKEY_LABELS[t] ?? '';
      b.title = key === '' ? TAB_LABELS[t] : `${TAB_LABELS[t]}  (${key})`;
      // The word and the key badge, one line, no icon. The icon-over-label
      // stack cost 22 design units of band height to draw a picture that the
      // word beside it already said — and the band is the thing this redesign
      // had to give back. The badge stays paired with the word for the reason
      // it was paired with the icon: a badge floating in the gutter between two
      // tabs is owned by neither.
      // The Powers tab has no letter (see `BUILD_TAB_HOTKEYS`), and an empty
      // badge would still draw its border and its padding — so it gets no
      // element at all rather than a hidden one.
      if (key !== '') label(b, 'vm-hk', key);
      label(b, 'vm-tab-label', TAB_SHORT[t]);
      const alert = el('span', 'vm-tab-alert', b);
      alert.hidden = true;
      this.tabAlerts.push(alert);

      b.addEventListener('pointerenter', () => this.cb.sound('hover'));
      b.addEventListener('click', () => {
        this.cb.sound('tab');
        this.cb.selectTab(tab);
      });
      b.addEventListener('keydown', (ev) => this.onTabKey(ev, t));
      this.tabs.push(b);
    }

    /* -- tools (repair / sell) ----------------------------------------- */
    const toolRow = el('div', 'vm-tools', strip);
    const TOOLS: ReadonlyArray<readonly [ArmedMode, IconName, string]> = [
      ['repair', 'repair', 'Repair structure — click a damaged building'],
      ['sell', 'sell', 'Sell structure — click a building to refund it'],
    ];
    for (const [mode, icon, name] of TOOLS) {
      const b = button(toolRow, 'vm-tool', name);
      b.title = name;
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(makeIcon(icon, 'vm-icon'));
      b.addEventListener('pointerenter', () => this.cb.sound('hover'));
      b.addEventListener('click', () => {
        this.cb.sound('click');
        const next: ArmedMode = this.armed === mode ? 'none' : mode;
        this.setArmed(next);
        this.cb.setArmed(next);
      });
      this.tools.push(b);
    }

    /* -- the panel body, under the strip -------------------------------- */
    const body = panel(this.root, 'vm-build-body', 'diag');
    body.dataset.brackets = 'on';

    /* -- slot grid ----------------------------------------------------- */
    this.grid = el('div', 'vm-grid', body);
    this.grid.setAttribute('role', 'grid');
    this.grid.style.setProperty('--vm-grid-cols', String(BUILD_COLUMNS));
    for (let i = 0; i < BUILD_COLUMNS * BUILD_ROWS; i++) this.slots.push(this.buildSlot(i));

    /* -- the brief, along the foot of the panel -------------------------- *
     * Every def in the game already carries a one-sentence `blurb`, and every
     * one of them was already correct — but the ONLY way to read one was to
     * put the pointer on a cameo and hold it still for the tooltip delay. So
     * the text existed, was maintained, and was invisible.
     *
     * A strip at the foot fixes that without touching the cameo we just spent
     * a version enlarging. It follows the pointer, follows keyboard focus, and
     * RESTS on the first entry of the tab rather than blanking — a strip that
     * empties itself teaches the player to stop looking at it.
     *
     * Its height is FIXED at two text lines whether or not the sentence needs
     * both. A box that grows and shrinks with the sentence would resize the
     * scrolling grid above it on every hover, which is worse than a blank
     * half-line by a wide margin.                                           */
    const brief = el('div', 'vm-brief', body);
    this.briefNameNode = label(brief, 'vm-brief-name');
    this.briefTextEl = el('span', 'vm-brief-text', brief);
    this.briefTextNode = textNode(this.briefTextEl);

    this.heightResize = new VerticalPanelResize(this.root, {
      storageKey: BUILD_PANEL_HEIGHT_KEY,
      label: 'Resize construction panel height',
      minHeightPx: 260,
      maxViewportShare: 0.75,
    });
  }

  get slotCount(): number { return this.slots.length; }

  /**
   * Point a slot's canvas at the model for the content it now holds.
   *
   * Called only when a slot's CONTENT changes — a tab switch or a roster
   * rebuild — never per frame. `CameoRenderer` renders a bound cameo once and
   * then never again unless it is hovered or invalidated.
   *
   * The canvas is revealed only on a successful bind, so a def whose model does
   * not resolve leaves it hidden and the flat glyph showing. That is the right
   * answer for the placeholder and for anything the art libraries have not
   * registered — and it is why this cannot make the sidebar worse than it was.
   */
  private bindCameo(slot: BuildSlot, c: HudCameo): void {
    const cameos = this.cameos;
    if (cameos === null) return;
    /*
     * A COMMANDER POWER DRAWS ITS FLAT GLYPH AND NOTHING ELSE, and this early
     * return is the whole of that decision.
     *
     * There is no mesh for "Airstrike", so the 3D path resolves null and the
     * fallback painter draws the `upgrade` badge — a plinth, a cap and three
     * chevrons. That is right for an upgrade and wrong for these: the Powers
     * tab is FIVE entries and the badge is the same picture five times, so the
     * grid reads as a column the player has to read the words of. Measured in a
     * running match: five identical blue plinths, distinguishable only by price.
     *
     * `POWER_ICONS` already solves exactly this problem one panel over, for the
     * powers BAR — an aircraft, a dish, a wrench, a coin and a prism — and
     * `iconForCameo` above puts the same five under these cells. Leaving the
     * canvas unbound is what lets them through, and it means the cameo a player
     * buys and the button it becomes are the same silhouette.
     */
    if (c.isPower) {
      cameos.unbind(slot.cameoCanvas);
      slot.cameoCanvas.hidden = true;
      return;
    }
    const subject: CameoSubject = {
      key: c.key,
      name: c.name,
      faction: this.faction,
      tab: this.activeTab,
      isBuilding: c.isBuilding,
      // An upgrade has no model in either binding table, so the 3D path
      // resolves null and the painter draws the `upgrade` badge instead. That
      // is the intended outcome, not a fallback: there is no mesh for
      // "Composite Armour" and inventing one would be a lie about what the
      // player is buying.
      isUpgrade: c.isUpgrade,
      footprintW: 0,
      footprintH: 0,
    };
    try {
      // SIZE THE BACKING STORE TO THE CELL. `CameoRenderer.bind` renders into
      // whatever the canvas already is, and a fresh canvas is the HTML default
      // 300x150 — so every cameo was rendering at 2:1 and being squashed into a
      // ~3.3:1 cell, at the wrong resolution in both directions. Match the cell
      // and the device pixel ratio instead, capped so a 4x display does not
      // quietly quadruple the render cost of sixty cells.
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const cw = Math.max(16, Math.round(slot.root.clientWidth * dpr));
      const ch = Math.max(16, Math.round(slot.root.clientHeight * dpr));
      if (slot.cameoCanvas.width !== cw) slot.cameoCanvas.width = cw;
      if (slot.cameoCanvas.height !== ch) slot.cameoCanvas.height = ch;
      cameos.bind(slot.cameoCanvas, subject);
      slot.cameoCanvas.hidden = false;
    } catch (err) {
      console.warn(`[hud] cameo bind failed for "${c.key}"`, err);
      slot.cameoCanvas.hidden = true;
    }
  }

  /**
   * Pump the cameo render queue. Driven from the HUD's render frame.
   *
   * Cheap by construction: the queue is empty unless something was marked
   * dirty, so an idle sidebar does no GPU work at all.
   */
  frameCameos(time: number, dt: number): void {
    this.cameos?.frame(time, dt);
  }

  /** Re-render every bound cameo — e.g. once the art libraries finish loading. */
  invalidateCameos(): void {
    this.cameos?.invalidateAll();
  }

  /**
   * Hand the cameo scene the world's environment map.
   *
   * NOT OPTIONAL POLISH — without it the cameos render as BLACK SILHOUETTES.
   * Unit and structure materials are `MeshPhysicalMaterial` driven by an ORM
   * map whose metalness runs to 0.82 on bare metal, and a metal surface with no
   * IBL has nothing to reflect, so it resolves to near-black no matter how many
   * direct lights the scene carries. `UnitFactory` asserts this in DEV for the
   * world renderer — "envMapIntensity is 0, units go matte and the silhouette
   * rim dies" — and the cameo scene is subject to exactly the same physics.
   *
   * Measured before the fix: mean luminance 17.5/255 with the three most common
   * colours all within a whisker of black.
   *
   * Re-applied whenever the texture identity changes, because the PMREM bake
   * finishes after the HUD mounts and a mood change re-bakes it.
   */
  setCameoEnvironment(env: THREE.Texture | null): void {
    if (env === this.cameoEnv) return;
    this.cameoEnv = env;
    this.cameos?.setEnvironment(env);
    this.cameos?.invalidateAll();
  }

  private cameoEnv: THREE.Texture | null = null;

  private buildSlot(index: number): BuildSlot {
    const root = button(this.grid, 'vm-slot', '');
    root.setAttribute('role', 'gridcell');
    root.hidden = true;
    root.tabIndex = -1;

    const icon = makeIcon('depot', 'vm-icon vm-slot-icon');
    root.appendChild(icon);

    // THE MODEL. Sits over the glyph, and stays `hidden` until a cameo has
    // actually been bound to it — so a slot whose model does not resolve keeps
    // showing the glyph rather than a blank rectangle.
    const cameoCanvas = document.createElement('canvas');
    cameoCanvas.className = 'vm-slot-cameo';
    cameoCanvas.hidden = true;
    root.appendChild(cameoCanvas);

    const nameEl = el('span', 'vm-slot-name', root);
    const nameNode = textNode(nameEl);

    const queueEl = el('span', 'vm-slot-queue vm-num', root);
    const queueNode = textNode(queueEl);
    queueEl.hidden = true;

    // The cost badge, bottom-left with its credit glyph — the reference's
    // placement. A bare number bottom-right read as a quantity, not a price.
    const costEl = el('span', 'vm-slot-cost vm-num', root);
    costEl.appendChild(makeIcon('credits', 'vm-icon'));
    const costNode = textNode(costEl);

    const keyEl = el('span', 'vm-hk vm-slot-key', root);
    const keyNode = textNode(keyEl, SLOT_HOTKEY_LABELS[index] ?? '');
    keyEl.hidden = index >= SLOT_HOTKEY_LABELS.length;

    const readyEl = el('span', 'vm-slot-ready', root);
    textNode(readyEl, 'READY');
    readyEl.hidden = true;

    const etaEl = el('span', 'vm-slot-eta vm-num', root);
    etaEl.appendChild(makeIcon('timer', 'vm-icon'));
    const etaNode = textNode(etaEl);
    etaEl.hidden = true;

    // HOW MANY YOU ALREADY OWN. Shares the bottom-right corner with the build
    // countdown and yields to it: while something is on the line, "how long"
    // is the live question and the inventory can wait the few seconds out.
    const ownedEl = el('span', 'vm-slot-owned vm-num', root);
    const ownedNode = textNode(ownedEl);
    ownedEl.hidden = true;

    const flagEl = el('span', 'vm-slot-flag', root);
    flagEl.appendChild(makeIcon('lock', 'vm-icon'));
    const flagNode = textNode(flagEl);
    flagEl.hidden = true;

    const track = el('span', 'vm-slot-track', root);
    const progress = el('i', '', track);
    progress.style.transform = 'scaleX(0)';

    const slot: BuildSlot = {
      root, icon, nameNode, costNode, keyEl, keyNode, queueEl, queueNode, readyEl,
      etaEl, etaNode, cameoCanvas, ownedEl, ownedNode, flagEl, flagNode, progress,
      cameo: null, sig: '', key: '', buildTime: 0,
      lastProgress: -1, lastAt: 0, rate: 0,
    };

    root.addEventListener('pointerenter', () => {
      if (slot.cameo === null) return;
      this.cb.sound('hover');
      // The turntable only spins while hovered — see `Job.hovered` in Cameos.
      this.cameos?.setHovered(cameoCanvas, true);
      this.tooltip.schedule(root, this.tipFor(slot.cameo, index), 'above');
      // The brief answers on the FIRST frame of the hover; the tooltip is on a
      // delay by design and that delay is the whole reason the brief exists.
      this.briefKey = slot.cameo.key;
      this.setBrief(slot.cameo);
    });
    root.addEventListener('pointerleave', () => {
      this.cameos?.setHovered(cameoCanvas, false);
      this.tooltip.hide();
      // The brief is NOT released here. See `setBrief`.
    });
    root.addEventListener('focus', () => {
      if (slot.cameo === null) return;
      this.tooltip.show(root, this.tipFor(slot.cameo, index), 'above');
      this.briefKey = slot.cameo.key;
      this.setBrief(slot.cameo);
    });
    root.addEventListener('blur', () => this.tooltip.hide());

    root.addEventListener('click', (ev) => {
      // Pointer-lock adapters and embedded runtimes are not all consistent
      // about suppressing `click` after button 2. A build cameo's primary
      // action must never run alongside its context-menu cancellation.
      if (ev.button !== 0) { ev.preventDefault(); return; }
      if (slot.cameo === null) return;
      ev.preventDefault();
      this.cb.sound('click');
      this.cb.activate(this.activeTab, slot.cameo);
    });
    // Right-click cancels one queued item. `contextmenu` is the event that
    // fires reliably for button 2 on a focusable element, and preventing it is
    // also what keeps the OS menu off the build grid.
    root.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (slot.cameo === null) return;
      this.cb.sound('click');
      this.cb.cancel(this.activeTab, slot.cameo);
    });
    root.addEventListener('keydown', (ev) => this.onSlotKey(ev, index));

    return slot;
  }

  /* -- keyboard -------------------------------------------------------- */

  /**
   * The next VISIBLE tab from `from`, walking by `step` and wrapping.
   *
   * Every arrow-key move goes through this rather than through `% BUILD_TAB_COUNT`
   * arithmetic, because a hidden tab is still a `<button>` in `this.tabs` and
   * plain modulo would happily focus one — a focus ring on nothing, and a
   * `selectTab` the HUD would refuse. Returns `from` when nothing else is
   * visible, which cannot happen (four tabs are permanent) but is the answer
   * that does not loop forever if it ever did.
   */
  private nextVisibleTab(from: number, step: number): number {
    for (let i = 1; i <= BUILD_TAB_COUNT; i++) {
      const t = (from + step * i + BUILD_TAB_COUNT * i) % BUILD_TAB_COUNT;
      if (this.tabVisible[t]) return t;
    }
    return from;
  }

  private onTabKey(ev: KeyboardEvent, index: number): void {
    let next = -1;
    if (ev.key === 'ArrowRight') next = this.nextVisibleTab(index, 1);
    else if (ev.key === 'ArrowLeft') next = this.nextVisibleTab(index, -1);
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = this.nextVisibleTab(0, -1);
    else if (ev.key === 'ArrowDown') {
      if (this.liveSlots > 0) { ev.preventDefault(); this.slots[0].root.focus(); }
      return;
    }
    if (next < 0) return;
    ev.preventDefault();
    this.cb.sound('tab');
    this.cb.selectTab(next as BuildTab);
    this.tabs[next].focus();
  }

  private onSlotKey(ev: KeyboardEvent, index: number): void {
    if (this.liveSlots === 0) return;
    let next = -1;
    switch (ev.key) {
      case 'ArrowRight': next = index + 1; break;
      case 'ArrowLeft': next = index - 1; break;
      case 'ArrowDown': next = index + BUILD_COLUMNS; break;
      case 'ArrowUp':
        next = index - BUILD_COLUMNS;
        if (next < 0) {
          ev.preventDefault();
          this.tabs[this.activeTab as number].focus();
          return;
        }
        break;
      case 'Delete':
      case 'Backspace': {
        const slot = this.slots[index];
        if (slot !== undefined && slot.cameo !== null) {
          ev.preventDefault();
          this.cb.cancel(this.activeTab, slot.cameo);
        }
        return;
      }
      default: return;
    }
    if (next < 0 || next >= this.liveSlots) return;
    ev.preventDefault();
    this.slots[next].root.focus();
  }

  /**
   * Fire the slot a global hotkey names. Returns false when that cell is empty,
   * so the caller can leave the keystroke for someone else rather than
   * swallowing it.
   */
  activateSlotByIndex(index: number): boolean {
    const slot = this.slots[index];
    if (slot === undefined || slot.cameo === null || slot.root.hidden) return false;
    this.cb.sound('click');
    this.cb.activate(this.activeTab, slot.cameo);
    return true;
  }

  /* -- state ----------------------------------------------------------- */

  setExtrasProvider(fn: (key: string) => BuildExtras): void {
    this.extras = fn;
    // A provider that arrives after the first paint must be allowed to fill in
    // the build times, so drop the per-slot cache rather than waiting for the
    // content of every cell to change.
    for (const slot of this.slots) { slot.key = ''; slot.sig = ''; }
  }

  setArmed(mode: ArmedMode): void {
    if (this.armed === mode) return;
    this.armed = mode;
    for (let i = 0; i < this.tools.length; i++) {
      const on = (i === 0 && mode === 'repair') || (i === 1 && mode === 'sell');
      this.tools[i].classList.toggle('is-active', on);
      this.tools[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  get armedMode(): ArmedMode { return this.armed; }

  /**
   * Draw the eye to the sell tool while the economy is stopped.
   *
   * Called from `Hud.setOreCrisis`, which `orecrisis.system.ts` drives. The
   * chip in the corner already says "Use the SELL tool"; a player who has
   * never armed it is then looking at a row of two unlabelled icons, and
   * naming a control the player cannot pick out is the same defect one layer
   * down. Idempotent and free when nothing changes — `classList.toggle` with
   * an explicit boolean writes only on a real transition.
   *
   * Deliberately NOT armed automatically. Arming a destructive modal tool for
   * someone is how a misclick sells the Construction Yard, which is the bug
   * `tests/sell-lockout.spec.ts` exists for.
   */
  setUrgentSell(on: boolean): void {
    if (this.urgentSell === on) return;
    this.urgentSell = on;
    this.tools[1]?.classList.toggle('is-urgent', on);
  }

  /**
   * Seconds left on this build, from the rate it is ACTUALLY moving at.
   *
   * Returns 0 for "show nothing" — not building, already ready, or moving so
   * slowly that any figure would be a lie. A stalled build is already announced
   * by the ON HOLD flag and EVA; a countdown reading 9999 next to it would be
   * noise, and one reading 5s while nothing happens is the bug this replaces.
   *
   * The estimate assumes current conditions hold, which is what every ETA
   * assumes. Power coming back or a refinery cashing in will beat it, and that
   * is the right direction to be wrong in.
   */
  private estimateEta(slot: BuildSlot, c: HudCameo, simSec: number): number {
    // SIM TIME, NOT `performance.now()`. See the header of `estimateBuildEta`.
    const effectiveTime = effectiveBuildSeconds(slot.buildTime, this.currentBuildRate);
    return estimateBuildEta(slot, c.progress, c.ready, effectiveTime, simSec * 1000);
  }

  /**
   * Point the brief at one entry, or at nothing.
   *
   * WHY THE LINE STICKS AFTER THE POINTER LEAVES
   * --------------------------------------------
   * While you are actually hovering a cameo, the TOOLTIP is up and it says
   * strictly more than this line does — cost, build time, power, prerequisite,
   * hotkey. So a brief that only tracked the live hover would be redundant for
   * the whole time it was legible and blank the instant it was not.
   *
   * Its real job starts when the pointer moves away: the tooltip vanishes, and
   * the sentence you were half way through stays. Sweep the palette, then read
   * the last thing you looked at without a card covering the rail. It resets to
   * the tab's first entry only when the tab's contents no longer contain it,
   * which happens for free — the lookup below simply misses.
   *
   * WHY A LOCKED ENTRY GETS ITS REASON INSTEAD OF ITS DESCRIPTION
   * -------------------------------------------------------------
   * The slot banner already says the ONE WORD — LOCKED, FUNDS, POWER — and the
   * whole sentence ("Requires Radar Dome") lived only in the tooltip. At the
   * moment you cannot build a thing, that sentence is the single most useful
   * line the panel can show, and the paragraph describing what the thing does
   * once you have it can wait. So the reason wins the rows while it applies.
   *
   * WHY IT PRINTS `description` AND THE CARD PRINTS `blurb`
   * ------------------------------------------------------
   * Because it used to print the blurb, and so does the card, and the two were
   * therefore the same sentence twice. See `BuildExtras.description`. The
   * fallback to `blurb` is not decoration: a build with no def tables bound
   * has no descriptions either, and a strip that empties itself teaches the
   * player to stop looking at it — which is the same argument that makes this
   * rest on the tab's first entry rather than blanking.
   *
   * `extras` allocates an object per call — see `Hud.entryOf` — so it is
   * reached only when the signature actually changed, never per frame. THAT IS
   * THE WHOLE ZERO-DOM-WRITE STORY HERE and lengthening the text does not
   * touch it: `briefSig` is still the key plus the locked reason, so a steady
   * selection writes nothing however long the sentence is.
   */
  private setBrief(c: HudCameo | null): void {
    const locked = c !== null && !c.available && c.reason !== '';
    const sig = c === null ? '' : `${c.key}|${locked ? c.reason : ''}`;
    if (sig === this.briefSig) return;
    this.briefSig = sig;

    if (c === null) {
      // Blank, not hidden. The box keeps its height so an empty tab does not
      // resize the grid above it.
      this.briefNameNode.nodeValue = '';
      this.briefTextNode.nodeValue = '';
      this.briefTextEl.classList.remove('is-locked');
      return;
    }

    const extra = this.extras?.(c.key) ?? null;
    this.briefNameNode.nodeValue = c.name;
    this.briefTextNode.nodeValue = locked
      ? lockedSentence(c.reason, extra?.unlockHint ?? '')
      : (extra === null ? '' : (extra.description !== '' ? extra.description : extra.blurb));
    this.briefTextEl.classList.toggle('is-locked', locked);
  }

  private tipFor(c: HudCameo, index: number): TooltipContent {
    // The CARD keeps the one-clause `blurb`; the strip at the foot of the rail
    // is the one that got the paragraph. See `BuildExtras.description`.
    const extra = this.extras?.(c.key)
      ?? { buildTimeSec: 0, powerDelta: 0, blurb: '', description: '', prereq: '', unlockHint: '' };
    const effectiveTime = effectiveBuildSeconds(extra.buildTimeSec, this.currentBuildRate);
    return {
      title: c.name,
      cost: c.cost,
      buildTimeSec: effectiveTime,
      baseBuildTimeSec: extra.buildTimeSec,
      powerDelta: extra.powerDelta,
      blurb: extra.blurb,
      prereq: extra.prereq,
      // The tooltip is the LONG form and gets the mission too. A player who has
      // stopped to hover is the one most likely to act on it, and the tooltip
      // has the room the two-line brief does not.
      requirement: c.available ? '' : lockedSentence(c.reason, extra.unlockHint),
      hotkey: SLOT_HOTKEY_LABELS[index] ?? '',
    };
  }

  update(snap: HudSnapshot): void {
    /* -- tab visibility ------------------------------------------------ *
     * Before the active-tab compare, because a tab that has just gone away
     * must not stay selected: `BuildPanel` reads `snap.cameos[activeTab]`, and
     * a Command Post sold or shot out from under a player looking at the
     * Powers tab would otherwise leave them staring at an empty grid with no
     * highlighted tab to click away from. The snapshot's `activeTab` is the
     * simulation's, so the correction is pushed back through `selectTab`
     * rather than written locally — one authority, as everywhere else here. */
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const on = snap.tabVisible[t] !== false;
      if (this.tabVisible[t] === on) continue;
      this.tabVisible[t] = on;
      this.tabs[t].hidden = !on;
      if (!on && (this.activeTab as number) === t) this.cb.selectTab(BuildTab.Structures);
    }

    /* -- tabs ---------------------------------------------------------- */
    if (snap.activeTab !== this.activeTab) {
      this.activeTab = snap.activeTab;
      for (let t = 0; t < BUILD_TAB_COUNT; t++) {
        const on = t === (this.activeTab as number);
        this.tabs[t].classList.toggle('is-active', on);
        this.tabs[t].setAttribute('aria-selected', on ? 'true' : 'false');
        this.tabs[t].tabIndex = on ? 0 : -1;
      }
      // A tab swap re-points every slot; invalidate so `key` comparison fires.
      for (const slot of this.slots) { slot.key = ''; slot.sig = ''; }
    }
    this.currentBuildRate = snap.buildRateByTab[this.activeTab as number] ?? 1;
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const alert = this.tabAlerts[t];
      const on = snap.tabAlert[t] === true;
      if (alert.hidden === on) alert.hidden = !on;
    }

    /* -- slots --------------------------------------------------------- */
    const list = snap.cameos[this.activeTab as number] ?? [];
    const n = Math.min(list.length, this.slots.length);
    const credits = snap.credits;

    for (let i = 0; i < n; i++) {
      const slot = this.slots[i];
      const c = list[i];
      slot.cameo = c;

      if (slot.key !== c.key) {
        slot.key = c.key;
        slot.root.hidden = false;
        slot.root.setAttribute(
          'aria-label',
          `${c.name}, ${c.cost} credits${i < SLOT_HOTKEY_LABELS.length ? `, key ${SLOT_HOTKEY_LABELS[i]}` : ''}`,
        );
        slot.root.tabIndex = 0;
        slot.nameNode.nodeValue = c.name;
        setIcon(slot.icon, iconForCameo(c, this.activeTab));
        this.bindCameo(slot, c);
        slot.costNode.nodeValue = String(c.cost);
        slot.buildTime = this.extras?.(c.key).buildTimeSec ?? 0;
        slot.keyNode.nodeValue = SLOT_HOTKEY_LABELS[i] ?? '';
        slot.keyEl.hidden = i >= SLOT_HOTKEY_LABELS.length;
      }

      // One string comparison replaces a dozen DOM writes for a slot that has
      // not changed — which is nearly every slot, nearly every frame. The
      // progress term is quantized to half a percent so a build does not thrash
      // the DOM at 60 Hz for sub-pixel motion; the countdown is quantized to a
      // whole second for the same reason.
      const poor = credits < c.cost;
      const eta = this.estimateEta(slot, c, snap.gameTimeSec);
      const sig = `${c.queued}|${c.ready ? 1 : 0}|${c.onHold ? 1 : 0}|` +
        `${c.available ? 1 : 0}|${poor ? 1 : 0}|${eta}|${c.reason}|${(c.progress * 200) | 0}` +
        `|${c.owned}`;
      if (sig === slot.sig) continue;
      slot.sig = sig;

      if (c.queued > 0) {
        slot.queueNode.nodeValue = String(c.queued);
        slot.queueEl.hidden = false;
      } else if (!slot.queueEl.hidden) {
        slot.queueEl.hidden = true;
      }

      // The countdown owns the top-right while a build runs. "How long" is the
      // only open question once an item is on the line.
      if (eta > 0) {
        slot.etaNode.nodeValue = formatCountdown(eta);
        slot.etaEl.hidden = false;
      } else if (!slot.etaEl.hidden) {
        slot.etaEl.hidden = true;
      }

      // Inventory. Hidden at zero rather than showing "0": sixty cells each
      // announcing a nought is noise, and "no badge" already reads as none.
      // Yields the corner to the countdown while a build is running.
      const showOwned = c.owned > 0 && eta <= 0;
      if (showOwned) {
        slot.ownedNode.nodeValue = c.owned > 999 ? '999+' : String(c.owned);
        slot.ownedEl.hidden = false;
      } else if (!slot.ownedEl.hidden) {
        slot.ownedEl.hidden = true;
      }

      slot.readyEl.hidden = !c.ready;
      slot.root.classList.toggle('is-ready', c.ready);
      slot.root.classList.toggle('is-held', c.onHold);
      // A locked slot is DIMMED, never disabled: it must stay hoverable so the
      // tooltip can explain what unlocks it. That reason is the tech tree's
      // only tutorial — and the banner below is its one-word summary, so the
      // player does not have to hover twenty cells to find the one live one.
      slot.root.classList.toggle('is-locked', !c.available);
      slot.root.classList.toggle('is-poor', poor && c.available && !c.ready);

      const block: BlockKind = !c.available
        ? blockKindOf(c.reason) || 'tech'
        : poor && !c.ready ? 'funds' : '';
      if (block === '') {
        slot.flagEl.hidden = true;
      } else {
        slot.flagNode.nodeValue = BLOCK_WORDS[block];
        slot.flagEl.className = `vm-slot-flag is-${block}`;
        slot.flagEl.hidden = c.ready || c.progress > 0;
      }

      const p = c.ready ? 1 : Math.max(0, Math.min(1, c.progress));
      slot.progress.style.transform = `scaleX(${p.toFixed(3)})`;
      slot.root.classList.toggle('is-building', p > 0 && !c.ready);
    }

    for (let i = n; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.root.hidden) continue;
      slot.root.hidden = true;
      slot.root.tabIndex = -1;
      // Release the cameo job with the slot. Leaving it bound would keep a
      // render target alive for a cell nobody can see, and every tab switch
      // would add another.
      this.cameos?.unbind(slot.cameoCanvas);
      slot.cameoCanvas.hidden = true;
      slot.cameo = null;
      slot.key = '';
      slot.sig = '';
    }
    this.liveSlots = n;

    /* -- the brief ------------------------------------------------------- *
     * Resolved here rather than only in the hover handler so the line tracks
     * STATE as well as the pointer: park on a locked Radar Dome, build the
     * Power Plant it wants, and the sentence changes under your cursor. The
     * scan is over at most a dozen live entries and compares interned keys;
     * `setBrief`'s own signature gate means a steady frame writes no DOM.   */
    let brief: HudCameo | null = n > 0 ? list[0] : null;
    if (this.briefKey !== '') {
      for (let i = 0; i < n; i++) {
        if (list[i].key === this.briefKey) { brief = list[i]; break; }
      }
    }
    this.setBrief(brief);
  }

  dispose(): void {
    this.heightResize.dispose();
    this.tooltip.dispose();
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 5 — THE BOTTOM BAR
 * ========================================================================== */

/* ==========================================================================
 * SECTION 5B — THE SUPERWEAPON BAR  (right edge, above the build rail)
 *
 * Up to `HUD_SUPERWEAPON.maxRows` countdowns, one per superweapon the local
 * player can field. Each row is a BUTTON: while it is charging the button is
 * inert and prints MM:SS, and the moment it reads READY a click arms the
 * targeting cursor.
 *
 * WHY IT LIVES HERE AND NOT IN THE BUILD PALETTE. The palette is a catalogue of
 * things you do not own yet and its slots are all one shape; a countdown is a
 * live readout on something you already built. It sits directly above the build
 * rail — `HUD_SUPERWEAPON.sidebarClearance` is the gap — because that is the
 * one part of the frame the player's cursor is already in.
 *
 * ZERO ALLOCATION, like everything else in this file: `maxRows` rows are built
 * once at construction and every update is a signature compare, a `nodeValue`
 * write and a class toggle. A charging weapon rewrites two text nodes once a
 * second, because the signature quantises the countdown to whole seconds.
 * ========================================================================== */

interface SuperRow {
  root: HTMLButtonElement;
  labelNode: Text;
  timeNode: Text;
  fill: HTMLElement;
  /** The key this row is currently bound to. '' when parked. */
  key: string;
  sig: string;
}

export class SuperweaponBar {
  readonly root: HTMLElement;
  private readonly rows: SuperRow[] = [];
  private live = 0;

  constructor(parent: HTMLElement, private readonly cb: SidebarCallbacks) {
    this.root = panel(parent, 'vm-dock vm-dock-super', 'diag-rev');
    this.root.setAttribute('aria-label', 'Superweapons');
    this.root.hidden = true;

    for (let i = 0; i < HUD_SUPERWEAPON.maxRows; i++) {
      const btn = button(this.root, 'vm-super-row', 'Superweapon');
      // The charge bar is a real element behind the text rather than a
      // background gradient, so the fill can be transformed instead of
      // repainted — a `background-size` animation on four rows is four style
      // recalcs a frame for a readout that changes once a second.
      const fill = el('i', 'vm-super-fill', btn);
      btn.appendChild(makeIcon('superweapon', 'vm-icon vm-super-icon'));
      const body = el('span', 'vm-super-body', btn);
      const labelNode = label(body, 'vm-super-label', '');
      const timeNode = label(body, 'vm-super-time vm-num', '');
      const row: SuperRow = { root: btn, labelNode, timeNode, fill, key: '', sig: '' };
      btn.addEventListener('click', () => {
        if (row.key === '') return;
        this.cb.sound('click');
        this.cb.fireSuperweapon(row.key);
      });
      btn.addEventListener('pointerenter', () => this.cb.sound('hover'));
      btn.hidden = true;
      this.rows.push(row);
    }
  }

  update(view: SuperweaponView): void {
    const n = Math.min(view.count, this.rows.length);
    if ((n === 0) !== this.root.hidden) this.root.hidden = n === 0;

    for (let i = 0; i < n; i++) {
      const row = this.rows[i];
      const data = view.rows[i];
      // Whole seconds, deliberately: the raw float changes every frame and a
      // signature carrying it would defeat the gate entirely.
      const secs = Math.ceil(Math.max(0, data.remaining));
      const sig = `${data.key}|${data.label}|${secs}|${data.ready ? 1 : 0}|${data.armed ? 1 : 0}`;
      if (sig === row.sig && !row.root.hidden) continue;
      row.sig = sig;
      row.key = data.key;
      row.root.hidden = false;

      const hint = data.ready
        ? `${data.label} ready — click, then pick a target`
        : `${data.label} charging — ${formatClock(secs)} remaining`;
      row.labelNode.nodeValue = data.label;
      row.timeNode.nodeValue = data.ready ? 'READY' : formatClock(secs);
      row.root.title = hint;
      row.root.setAttribute('aria-label', hint);
      row.root.setAttribute('aria-disabled', data.ready ? 'false' : 'true');
      row.root.classList.toggle('is-ready', data.ready);
      row.root.classList.toggle('is-armed', data.armed);
      // 0 while charging is a full-width bar at rest, so the fill grows toward
      // the right as the charge completes.
      const frac = data.total > 0 ? 1 - Math.max(0, Math.min(1, data.remaining / data.total)) : 1;
      row.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
    }

    for (let i = n; i < this.live; i++) {
      this.rows[i].root.hidden = true;
      this.rows[i].key = '';
      this.rows[i].sig = '';
    }
    this.live = n;
  }

  dispose(): void {
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 5C — THE COMMANDER POWER BAR  (right edge, beside the superweapons)
 *
 * One row per power the local profile has EARNED. Each row is a button: while
 * it is charging the button is inert and prints MM:SS, and the moment it reads
 * READY a click arms the cursor for a ground click.
 *
 * WHY THIS BAR EXISTS AT ALL. All five powers were fully implemented — through
 * the bus, through the replay, through the multiplayer relay, with their
 * effects tested — and the ONLY way to call one was `__vmPowers.fire()` from a
 * devtools console. Meanwhile `src/shell/Missions.ts` printed "Callable once
 * charged, in any match" on the reward card of every mission that paid one out.
 * That is the product lying to the player about a campaign reward, and it is
 * the reason this file grew a second dock rather than a corner of an existing
 * one.
 *
 * WHY IT IS THE SUPERWEAPON BAR'S TWIN AND NOT PART OF IT. Same row shape, same
 * width, same bottom line, standing immediately to its left — because the two
 * mechanisms genuinely rhyme and a player who has learned one has learned the
 * other. They are separate DOCKS because they are separate services with
 * separate lifetimes: a superweapon row exists while its STRUCTURE stands, a
 * power row exists because a MISSION was completed, and one can be empty while
 * the other is full.
 *
 * ZERO ALLOCATION, like everything else here: `COMMANDER_POWER_ROWS` rows are
 * built once and every update is a signature compare, a `nodeValue` write and a
 * class toggle. The signature quantises the countdown to whole seconds, so a
 * charging power rewrites two text nodes once a second.
 * ========================================================================== */

/**
 * Rows built up front in the power bar.
 *
 * Five, which is `COMMANDER_POWER_LIST.length` — every power in the table, not
 * a cap on how many can be shown. It is stated as a literal rather than
 * imported so this file keeps no edge into `src/progression/**`;
 * `tests/commander-powers-ui.spec.ts` asserts the two agree, which is the same
 * bargain `BUILD_ROWS` makes with the roster.
 */
export const COMMANDER_POWER_ROWS = 5;

/**
 * Which icon stands for which power. Indexed by `CommanderPowerId`, so slot 0
 * is the `None` row — the same direct-lookup shape the power table itself uses,
 * and for the same reason.
 *
 * Five different silhouettes rather than five copies of one glyph: the bar is
 * read at a glance mid-fight, and a column of identical icons is a column the
 * player has to read the WORDS of.
 *
 * Here rather than in `Hud.ts` because this is the presentation half and this
 * file is the one that draws it — and because it makes the table reachable from
 * `environment: 'node'`, where `tests/commander-powers-ui.spec.ts` asserts every
 * power in `COMMANDER_POWERS` has an entry. A power added to the table with no
 * icon would otherwise ship as a blank square nobody noticed.
 */
export const POWER_ICONS: readonly IconName[] = [
  'superweapon',   // None — never drawn
  'aircraft',      // Airstrike
  'radar',         // Orbital Scan
  'repair',        // Emergency Repair
  'credits',       // Ore Boost
  'prism',         // Chronoshift
];

/** How full the bank is, as the credit readout renders it. */
export type StorageState = 'none' | 'ok' | 'near' | 'full';

/**
 * Classify a balance against its ceiling.
 *
 * Pure, and split out of `ResourceStrip.update` so the rule is falsifiable
 * without a DOM: "at what point does the strip start warning" is a design
 * decision, and a design decision buried in a render method is one nobody can
 * check. `tests/commander-powers-ui.spec.ts` pins the boundaries.
 *
 * `'none'` means there is no ceiling to speak of — a cap of 0 or less, which is
 * what a player record that has not been initialised looks like. The readout
 * then shows the bare balance, exactly as it did before there was a cap at all.
 */
export function storageState(credits: number, cap: number): StorageState {
  if (!(cap > 0)) return 'none';
  if (credits >= cap) return 'full';
  if (credits >= cap * STORAGE_WARN_FRACTION) return 'near';
  return 'ok';
}

interface PowerRowCell {
  root: HTMLButtonElement;
  labelNode: Text;
  timeNode: Text;
  fill: HTMLElement;
  iconEl: SVGSVGElement;
  /** The key this row is currently bound to. '' when parked. */
  key: string;
  sig: string;
}

export class CommanderPowerBar {
  readonly root: HTMLElement;
  private readonly rows: PowerRowCell[] = [];
  private live = 0;

  constructor(parent: HTMLElement, private readonly cb: SidebarCallbacks) {
    this.root = panel(parent, 'vm-dock vm-dock-powers', 'diag-rev');
    this.root.setAttribute('aria-label', 'Commander powers');
    this.root.hidden = true;

    for (let i = 0; i < COMMANDER_POWER_ROWS; i++) {
      const btn = button(this.root, 'vm-super-row vm-power-row', 'Commander power');
      const fill = el('i', 'vm-super-fill', btn);
      const iconEl = makeIcon('superweapon', 'vm-icon vm-super-icon');
      btn.appendChild(iconEl);
      const body = el('span', 'vm-super-body', btn);
      const labelNode = label(body, 'vm-super-label', '');
      const timeNode = label(body, 'vm-super-time vm-num', '');
      const row: PowerRowCell = { root: btn, labelNode, timeNode, fill, iconEl, key: '', sig: '' };
      btn.addEventListener('click', () => {
        if (row.key === '') return;
        this.cb.sound('click');
        this.cb.usePower(row.key);
      });
      btn.addEventListener('pointerenter', () => this.cb.sound('hover'));
      btn.hidden = true;
      this.rows.push(row);
    }
  }

  update(view: CommanderPowerView): void {
    const n = Math.min(view.count, this.rows.length);
    if ((n === 0) !== this.root.hidden) this.root.hidden = n === 0;

    for (let i = 0; i < n; i++) {
      const row = this.rows[i];
      const data = view.rows[i];
      // Whole seconds, deliberately: the raw float changes every frame and a
      // signature carrying it would defeat the gate entirely.
      const secs = Math.ceil(Math.max(0, data.remaining));
      const sig = `${data.key}|${secs}|${data.ready ? 1 : 0}|${data.armed ? 1 : 0}`;
      if (sig === row.sig && !row.root.hidden) continue;
      const rebound = row.key !== data.key;
      row.sig = sig;
      row.key = data.key;
      row.root.hidden = false;

      const hint = data.ready
        ? `${data.label} ready — click, then pick a target. ${data.hint}`
        : `${data.label} charging — ${formatClock(secs)} remaining. ${data.hint}`;
      if (rebound) {
        row.labelNode.nodeValue = data.label;
        setIcon(row.iconEl, data.icon);
      }
      row.timeNode.nodeValue = data.ready ? 'READY' : formatClock(secs);
      row.root.title = hint;
      row.root.setAttribute('aria-label', hint);
      row.root.setAttribute('aria-disabled', data.ready ? 'false' : 'true');
      row.root.classList.toggle('is-ready', data.ready);
      row.root.classList.toggle('is-armed', data.armed);
      const frac = data.total > 0 ? 1 - Math.max(0, Math.min(1, data.remaining / data.total)) : 1;
      row.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
    }

    for (let i = n; i < this.live; i++) {
      this.rows[i].root.hidden = true;
      this.rows[i].key = '';
      this.rows[i].sig = '';
    }
    this.live = n;
  }

  dispose(): void {
    this.root.remove();
  }
}

/* ========================================================================== */

const COMMAND_DECK: ReadonlyArray<readonly [
  HudCommandAction, IconName, string, string,
]> = [
  ['guard', 'guard', 'Guard', 'G'],
  ['attack', 'attack', 'Attack', 'A'],
  ['move', 'move', 'Move', 'RMB'],
  ['stop', 'stop', 'Stop', 'S'],
  ['scatter', 'scatter', 'Scatter', 'X'],
];

const FORMATIONS: ReadonlyArray<readonly [FormationShape, string, readonly number[]]> = [
  ['line', 'Line formation', [4,9, 10,9, 16,9, 22,9]],
  ['box', 'Rectangle formation', [7,5, 15,5, 7,13, 15,13]],
  ['wedge', 'V formation', [4,4, 8,8, 12,12, 16,8, 20,4]],
  ['triangle', 'Triangle formation', [12,3, 8,8, 16,8, 4,13, 12,13, 20,13]],
];

function formationGlyph(points: readonly number[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 18');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('vm-formation-icon');
  for (let i = 0; i < points.length; i += 2) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(points[i])); dot.setAttribute('cy', String(points[i + 1]));
    dot.setAttribute('r', '1.65'); dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
  }
  return svg;
}

/**
 * The large, selection-aware command surface from the perimeter HUD.
 *
 * It deliberately does not issue commands itself. A click crosses the same
 * input seam as a key binding, and input decides whether the verb arms a
 * target cursor or can execute immediately. The HUD only owns presentation.
 */
class CommandDeck {
  readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private active: HudCommandAction | 'none' = 'none';
  private lastState = '';

  constructor(parent: HTMLElement, cb: SidebarCallbacks) {
    this.root = panel(parent, 'vm-command-deck', 'diag-rev');
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Unit commands');

    const formationRow = el('div', 'vm-formation-row', this.root);
    formationRow.setAttribute('role', 'group');
    formationRow.setAttribute('aria-label', 'Formation orders');
    label(formationRow, 'vm-formation-label', 'Formation');
    for (const [shape, name, points] of FORMATIONS) {
      const control = button(formationRow, 'vm-formation', name);
      control.dataset.formation = shape;
      control.title = name;
      control.appendChild(formationGlyph(points));
      control.addEventListener('click', () => {
        if (control.disabled) return;
        cb.sound('click'); cb.formation(shape);
      });
      control.addEventListener('pointerenter', () => cb.sound('hover'));
    }

    for (const [action, icon, labelText, hotkey] of COMMAND_DECK) {
      const control = button(this.root, 'vm-command', labelText);
      control.dataset.command = action;
      control.appendChild(makeIcon(icon, 'vm-icon vm-command-icon'));
      label(control, 'vm-command-label', labelText);
      label(control, 'vm-command-key', hotkey);
      control.setAttribute('aria-pressed', 'false');
      control.addEventListener('click', () => {
        if (control.disabled) return;
        cb.sound('click');
        cb.command(action);
      });
      control.addEventListener('pointerenter', () => cb.sound('hover'));
      this.buttons.push(control);
    }
  }

  update(view: SelectionView): void {
    const hasSelection = view.count > 0;
    const canMove = hasSelection && view.stanceEnabled;
    const canAttack = canMove && view.damage !== '' && view.damage !== '—';
    // Formation availability changes when a single mobile selection becomes a
    // group even though every other command capability stays identical. Keep
    // that bit in the render key or the buttons remain disabled after the
    // tutorial's natural click-one -> box-select progression.
    const canForm = canMove && view.count >= 2;
    const state = `${hasSelection ? 1 : 0}${canMove ? 1 : 0}${canAttack ? 1 : 0}${canForm ? 1 : 0}`;
    if (state === this.lastState) return;
    this.lastState = state;
    this.root.classList.toggle('is-idle', !hasSelection);
    for (const control of this.root.querySelectorAll<HTMLButtonElement>('.vm-formation')) {
      control.disabled = !canForm;
      control.setAttribute('aria-disabled', !control.disabled ? 'false' : 'true');
    }

    for (let i = 0; i < COMMAND_DECK.length; i++) {
      const action = COMMAND_DECK[i][0];
      const enabled = action === 'move' || action === 'scatter'
        ? canMove
        : action === 'attack'
          ? canAttack
          : hasSelection;
      this.buttons[i].disabled = !enabled;
      this.buttons[i].setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }
  }

  setActive(action: HudCommandAction | 'none'): void {
    if (action === this.active) return;
    this.active = action;
    for (let i = 0; i < COMMAND_DECK.length; i++) {
      const on = COMMAND_DECK[i][0] === action;
      this.buttons[i].classList.toggle('is-active', on);
      this.buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  dispose(): void { this.root.remove(); }
}

/* ========================================================================== */

export class Sidebar {
  readonly root: HTMLElement;
  /** The minimap's glass panel. `Minimap` draws into `minimapCanvas`. */
  readonly mapDock: HTMLElement;
  readonly minimapField: HTMLElement;
  readonly minimapCanvas: HTMLCanvasElement;
  readonly resources: ResourceStrip;

  private readonly selection: SelectionPanel;
  private readonly build: BuildPanel;
  private readonly supers: SuperweaponBar;
  private readonly powers: CommanderPowerBar;
  private readonly commands: CommandDeck;
  private readonly titleEl: HTMLElement;
  private readonly offlineEl: HTMLElement;
  private readonly mapHintEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  /** Hostile armies, in the minimap's seat order. Empty = the default row. */
  private hostiles: readonly ArmyLegendEntry[] = [];
  private allies: readonly ArmyLegendEntry[] = [];
  private faction: Faction;
  private radarOnline = true;

  constructor(opts: SidebarOptions) {
    this.faction = opts.faction;

    this.root = el('div', 'vm-bar', opts.parent);

    // The strip is top-centre and the docks are bottom; they share one root so
    // `__VM.setUiVisible(false)` hides the whole interface with one toggle.
    this.resources = new ResourceStrip(this.root);

    const docks = el('div', 'vm-docks', this.root);

    /* -- bottom left: the minimap dock ---------------------------------- */
    this.mapDock = panel(docks, 'vm-dock vm-dock-map', 'diag');
    this.mapDock.dataset.brackets = 'on';
    this.mapDock.setAttribute('aria-label', 'Tactical map');
    const mapHead = el('div', 'vm-dock-head', this.mapDock);
    // The two labels SWAP rather than sit side by side: the head is 67 design
    // units wide and two tracked-out uppercase words do not fit at any size a
    // player can read. One word, not two — "TACTICAL MAP" measured 84u at the
    // house label's tracking and clipped mid-word against the legend. The
    // dock's `aria-label` still says what it is.
    this.titleEl = el('span', 'vm-dock-title', mapHead);
    textNode(this.titleEl, 'MAP');
    this.offlineEl = el('span', 'vm-map-offline', mapHead);
    textNode(this.offlineEl, 'NO RADAR');
    this.offlineEl.hidden = true;

    // The legend used to be a 52-unit rail beside the map, which is a great
    // deal of width for four colours — width the selection card's stat row was
    // overflowing for want of. Four swatches fit in the head; the WORDS moved
    // onto its tooltip, where a player who does not already know what red means
    // will look and a player who does will never have to see them again.
    //
    // IT IS REBUILT RATHER THAN AUTHORED NOW, because in a free-for-all the one
    // "Hostile" swatch becomes one per opposing ARMY and each of them has to
    // carry that army's own colour and name. `setArmies` is the only writer;
    // the default it renders with is byte-for-byte the old four rows.
    this.legendEl = el('div', 'vm-map-legend', mapHead);
    this.renderLegend();

    const mapBody = el('div', 'vm-map-body', this.mapDock);
    this.minimapField = el('div', 'vm-map-field', mapBody);
    this.minimapCanvas = el('canvas', 'vm-map-canvas', this.minimapField);

    // The approved command-deck shell carries a short hardware rail under the
    // tactical glass. These are deliberately status ornaments rather than
    // fake buttons: the map already owns pointer recentering, while exposing
    // controls with no corresponding game command would be dishonest UI.
    const mapHardware = el('div', 'vm-map-hardware', this.mapDock);
    mapHardware.setAttribute('aria-hidden', 'true');
    for (const iconName of ['move', 'primary', 'radar'] as const) {
      const pod = el('span', 'vm-map-hardware-pod', mapHardware);
      pod.append(makeIcon(iconName, 'vm-icon vm-map-hardware-icon'));
    }

    // The offline state now says what to DO. "NO RADAR" named the symptom and
    // left the player staring at a grey square with no idea it was a build
    // order away from working.
    this.mapHintEl = el('div', 'vm-map-hint', this.minimapField);
    // Short, because the field is only ~67 design units wide. The full sentence
    // lives on the selection dock's advisory line, which has the room for it.
    const hintTitle = el('b', '', this.mapHintEl);
    textNode(hintTitle, 'RADAR OFFLINE');
    textNode(this.mapHintEl, 'Build a Radar Dome');
    this.mapHintEl.hidden = true;

    /* -- bottom centre: selection / status ------------------------------ */
    this.selection = new SelectionPanel(docks, opts.callbacks);

    /* -- bottom right: build -------------------------------------------- */
    // MOUNTED ON THE ROOT, NOT IN `docks`. The build palette is the right rail
    // now, and it positions itself absolutely against the HUD root. Left inside
    // `.vm-docks` — which is itself absolutely positioned as a thin strip along
    // the bottom — its `top` would resolve against that strip and put the rail
    // off the bottom of the screen. It is a peer of the docks, not one of them.
    this.build = new BuildPanel(
      this.root, opts.callbacks, this.root, opts.faction, opts.renderer ?? null,
    );

    // MOUNTED ON THE ROOT for the same reason the build rail is: it positions
    // itself absolutely against the HUD root, directly above the rail. Inside
    // `.vm-docks` its `bottom` would resolve against that thin strip.
    // THE TWO CHARGE BARS SHARE ONE COLUMN, and the column is what carries the
    // absolute position. Standing them side by side was the first attempt and
    // it was wrong for the common case: most matches never build a superweapon,
    // so the powers bar sat 150 units out over open ground with a hole beside
    // it. Stacking needs whichever is on top to know how tall the other one
    // currently is — which is exactly what a flex column anchored by its BOTTOM
    // edge works out for free. Auto height plus a fixed `bottom` grows upward.
    //
    // POWERS ABOVE SUPERWEAPONS. The rail is the anchor the eye returns to, and
    // a superweapon countdown is the rarer, louder thing; it keeps the slot
    // nearest the rail so its position never moves as powers are earned.
    const railStack = el('div', 'vm-rail-stack', this.root);
    this.powers = new CommanderPowerBar(railStack, opts.callbacks);
    this.supers = new SuperweaponBar(railStack, opts.callbacks);
    this.commands = new CommandDeck(this.root, opts.callbacks);
    // AFTER the build panel, because it is the one that constructs the
    // renderer. Null in any headless build, where both panels keep their glyphs.
    this.selection.setCameos(this.build.cameoRenderer);
    this.selection.setFaction(this.faction);

    applyTheme(this.root, this.faction);
  }

  /* -- configuration --------------------------------------------------- */

  setFaction(faction: Faction): void {
    if (this.faction === faction) return;
    this.faction = faction;
    this.selection.setFaction(faction);
    applyTheme(this.root, faction);
  }

  setExtrasProvider(fn: (key: string) => BuildExtras): void {
    this.build.setExtrasProvider(fn);
  }

  /**
   * Name and colour the allied and opposing armies in the map legend.
   *
   * Hand it two empty lists for a duel and the legend renders exactly the four
   * rows it always did — a hostile swatch in `--vm-danger`, captioned "Hostile".
   * Hand it three hostiles and the map key names all three, which is the
   * difference between four colours on the radar and four colours nobody can
   * identify.
   *
   * CHEAP TO CALL WITH THE SAME THING TWICE: it compares first and returns
   * without touching the DOM, so the caller does not need its own dirty flag.
   */
  setArmies(allies: readonly ArmyLegendEntry[], hostiles: readonly ArmyLegendEntry[]): void {
    if (same(allies, this.allies) && same(hostiles, this.hostiles)) return;
    this.allies = allies.map((h) => ({ ...h }));
    this.hostiles = hostiles.map((h) => ({ ...h }));
    this.renderLegend();
  }

  /**
   * Repaint the map key.
   *
   * The three fixed rows are Yours, Ore and View. ALLY rows sit directly under
   * Yours and the hostile rows under those, which is the order the player reads
   * the fight in — mine, ours, theirs. A custom colour is an INLINE style rather
   * than a class, because there is no fixed set of them to write CSS for —
   * `Chrome.hostileColor` owns the hostile table and the seat index picks a row
   * out of it.
   *
   * AN ALLY IS ALWAYS NAMED WHEN ONE EXISTS, unlike a hostile, which is named
   * only once there are two or more (`Hud.refreshArmyLegend`). The asymmetry is
   * deliberate: "Hostile" in red is a complete key when there is one opponent,
   * but a green swatch with no name is not — the player has to be told whose it
   * is, and there is exactly one thing it can be.
   */
  private renderLegend(): void {
    const legend = this.legendEl;
    legend.replaceChildren();

    const rows: Array<{ mod: string; name: string; color?: string }> = [{ mod: '', name: 'Yours' }];
    for (const a of this.allies) rows.push({ mod: 'is-ally', name: a.label, color: a.color });
    if (this.hostiles.length === 0) {
      rows.push({ mod: 'is-enemy', name: 'Hostile' });
    } else {
      for (const h of this.hostiles) rows.push({ mod: 'is-enemy', name: h.label, color: h.color });
    }
    rows.push({ mod: 'is-ore', name: 'Ore' }, { mod: 'is-view', name: 'View' });

    let tip = '';
    for (const r of rows) {
      const row = el('div', `vm-legend-row${r.mod === '' ? '' : ` ${r.mod}`}`, legend);
      const swatch = el('i', 'vm-legend-swatch', row);
      if (r.color !== undefined) swatch.style.background = r.color;
      label(row, 'vm-legend-text', r.name);
      tip += `${tip === '' ? '' : '   '}${r.name}`;
    }
    legend.title = `Map key:  ${tip}`;
  }

  /** Radar dome online? Drives the map dock's offline state and its hint. */
  setRadarOnline(online: boolean): void {
    if (online === this.radarOnline) return;
    this.radarOnline = online;
    this.mapDock.classList.toggle('is-offline', !online);
    this.offlineEl.hidden = online;
    this.titleEl.hidden = !online;
    this.mapHintEl.hidden = online;
  }

  /** The repair / sell tool. Also called by input on Escape and right-click. */
  setArmed(mode: ArmedMode): void {
    this.build.setArmed(mode);
    this.root.dataset.armed = mode;
  }

  get armedMode(): ArmedMode { return this.build.armedMode; }

  /** Mirror input's armed cursor state into the command deck. */
  setCommandActive(action: HudCommandAction | 'none'): void {
    this.commands.setActive(action);
  }

  /** Flag the sell tool as the thing to press. See `BuildPanel.setUrgentSell`. */
  setUrgentSell(on: boolean): void { this.build.setUrgentSell(on); }

  /** Build slots the grid can show at once. Diagnostics only. */
  get slotCount(): number { return this.build.slotCount; }

  /** Pump the build slots' cameo render queue. Driven from the HUD frame. */
  frameCameos(time: number, dt: number): void { this.build.frameCameos(time, dt); }

  /** Force every bound cameo to repaint — e.g. once the art libraries land. */
  invalidateCameos(): void { this.build.invalidateCameos(); }

  /** See `BuildPanel.setCameoEnvironment` — without this the cameos are black. */
  setCameoEnvironment(env: THREE.Texture | null): void {
    this.build.setCameoEnvironment(env);
  }

  /** Fire the slot a global hotkey names. False when that cell is empty. */
  activateSlotByIndex(index: number): boolean {
    return this.build.activateSlotByIndex(index);
  }

  /* -- frame ------------------------------------------------------------ */

  update(
    snap: HudSnapshot, view: SelectionView, tele: HudTelemetry, dt: number,
    supers: SuperweaponView, powers: CommanderPowerView,
  ): void {
    this.resources.update(snap, tele, dt);
    this.selection.update(view, snap, tele);
    this.build.update(snap);
    this.supers.update(supers);
    this.powers.update(powers);
    this.commands.update(view);
  }

  /** Raise the credits flyout. Driven by `economy:credits`. */
  creditFlyout(delta: number): void {
    this.resources.flyout(delta);
  }

  /** Jump the credits counter — match start, or a faction swap. */
  resetCredits(credits: number): void {
    this.resources.reset(credits);
  }

  dispose(): void {
    this.build.dispose();
    this.selection.dispose();
    this.resources.dispose();
    this.supers.dispose();
    this.powers.dispose();
    this.commands.dispose();
    this.root.remove();
  }
}
