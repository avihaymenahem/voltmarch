/**
 * ============================================================================
 * VOLTMARCH — src/input/ActionCatalogue.ts
 * ============================================================================
 * EVERY THING A PLAYER CAN DO, IN ONE TABLE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The order hotkeys are rebindable. `input.system.ts` resolves them against the
 * live settings store on every keystroke, so the moment a player moves Attack
 * Move off `A`, any hand-written list of controls somewhere else in the product
 * becomes a lie. A help screen that lies is worse than no help screen: it costs
 * the player a match before they stop believing it.
 *
 * So the action surface is DATA, and it lives here. Three modules read it and
 * none of them keeps a second copy:
 *
 *   src/input/input.system.ts  derives its default chord tables from
 *                              `defaultCommandChords()` and
 *                              `defaultCameraCodes()`. There is no hard-coded
 *                              scheme left in that file.
 *   src/shell/Settings.ts      renders the Controls tab's rebind rows from
 *                              `rebindableActions()`, so a new action appears
 *                              on the options screen the day it is added here.
 *   src/shell/Help.ts          renders the whole catalogue and resolves each
 *                              rebindable row against the CURRENT binding, so
 *                              the screen shows what the player actually has.
 *   src/ui/Sidebar.ts          takes the build-tab and build-slot key codes and
 *                              their badge letters from `BUILD_TAB_HOTKEYS` /
 *                              `BUILD_SLOT_HOTKEYS` below, and `src/ui/Hud.ts`
 *                              matches keystrokes against the same arrays. The
 *                              letters printed on a cameo and the letters on the
 *                              help screen are therefore one array, not two
 *                              lists that agreed on the day they were written.
 *
 * WHAT COUNTS AS AN ACTION
 * ------------------------
 * Not just the eight rebindable order keys. Everything: pointer gestures,
 * trackpad gestures, the control-group digits, the sidebar tools, the debug
 * overlay. If a player can do it, it has a row. Each row is honest about how
 * it is reached:
 *
 *   'rebindable'  a chord resolved from the settings store by `id`. The id is
 *                 also a `KeybindDef.id` in src/shell/settings-store.ts — that
 *                 store owns persistence and normalisation, and
 *                 `tests/action-catalogue.spec.ts` asserts the two tables agree
 *                 on ids, defaults and surfaces so they cannot drift.
 *   'fixed'       a key or chord the engine hard-codes. F3 is read straight off
 *                 `KeyboardEvent.code` in src/render/debug.ts; the control-group
 *                 digits are resolved in input.system.ts ahead of the binding
 *                 table. Neither can be rebound, and neither pretends it can.
 *   'gesture'     mouse, trackpad or on-screen control. No key involved.
 *
 * NO IMPORTS, ON PURPOSE
 * ----------------------
 * `input.system.ts` is in the main chunk and a `?shot=` boot never loads the
 * shell at all, so this file must not reach into `src/shell/**`. It is pure
 * data plus pure functions over that data, which is also what makes it
 * testable under `environment: 'node'`.
 *
 * THE DESCRIPTIONS ARE MEASURED, NOT GUESSED
 * ------------------------------------------
 * Every row below was read out of the code that implements it —
 * `src/input/Input.ts`, `Selection.ts`, `Commands.ts`, `input.system.ts`,
 * `src/render/camera.ts`, `src/ui/Minimap.ts`, `src/ui/Sidebar.ts` and
 * `src/sim/Placement.ts`. Where the engine's behaviour is surprising (Escape
 * belongs to the pause menu during a match; edge scrolling ships OFF) the row
 * says so rather than describing the behaviour someone might expect.
 * ============================================================================
 */

/* ==========================================================================
 * 1. SHAPES
 * ========================================================================== */

/** Display grouping. The order of this tuple is the order screens render in. */
export const ACTION_CATEGORY_IDS = [
  'camera', 'selection', 'orders', 'building', 'interface',
] as const;

export type ActionCategory = (typeof ACTION_CATEGORY_IDS)[number];

export interface ActionCategoryDef {
  readonly id: ActionCategory;
  readonly label: string;
  /** One line under the heading. Never decorative — it says what the group is. */
  readonly blurb: string;
  /** Icon name from the shell's icon set. */
  readonly icon: string;
}

export const ACTION_CATEGORIES: readonly ActionCategoryDef[] = [
  {
    id: 'camera',
    label: 'Camera',
    icon: 'map',
    blurb: 'Moving the view. Keys, trackpad, wheel and the tactical map.',
  },
  {
    id: 'selection',
    label: 'Selection',
    icon: 'target',
    blurb: 'Choosing what you are about to give an order to.',
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: 'swords',
    blurb: 'Telling the selection what to do.',
  },
  {
    id: 'building',
    label: 'Building',
    icon: 'folder',
    blurb: 'Production, placement, repair and sell.',
  },
  {
    id: 'interface',
    label: 'Interface',
    icon: 'sliders',
    blurb: 'The menus and the diagnostic overlays.',
  },
];

/** One physical chord. `code` is a `KeyboardEvent.code`, never a `key`. */
export interface ActionChord {
  readonly code: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

/**
 * Which keyboard surface an action lives on.
 *
 *   'command'  dispatched on a keystroke by input.system.ts
 *   'camera'   POLLED every frame while held — a pan is not a chord, you do
 *              not hold Ctrl to keep panning, so modifiers are ignored and only
 *              the `code` is read
 *   'hud'      dispatched by the HUD's own window listener in src/ui/Hud.ts.
 *              A separate surface because the HUD only takes a key while the
 *              build grid actually has the keyboard, and it stands down the
 *              moment the live binding table claims that code — see
 *              `buildHotkeyBlockedBy` at the bottom of this file
 *   'placement' handled by `PlacementController` in src/sim/Placement.ts, and
 *              ONLY while a structure is on the cursor. A separate surface
 *              because that controller owns its own window listener and
 *              `input.system.ts` deliberately stands out of its way (it already
 *              does exactly this for Escape) — two handlers for one key would
 *              turn the ghost twice on every tap
 *   'global'   handled by the shell, above the match
 *   'pointer'  no keyboard involvement at all
 */
export type ActionSurface =
  'command' | 'camera' | 'hud' | 'placement' | 'global' | 'pointer';

/** How the player reaches the action. See the header. */
export type ActionBinding = 'rebindable' | 'fixed' | 'gesture';

/** Canonical modifier tokens usable inside `fixedChips`. */
export type ModifierName = 'Ctrl' | 'Shift' | 'Alt' | 'Meta';

export interface ActionDef {
  /**
   * Stable id. For a rebindable action this is also the settings-store
   * `KeybindDef.id` the chord is stored under.
   */
  readonly id: string;
  readonly label: string;
  /** One sentence. What it does, and anything about it that would surprise. */
  readonly description: string;
  readonly category: ActionCategory;
  readonly surface: ActionSurface;
  readonly binding: ActionBinding;
  /** The stock chord. Null for a pointer gesture or a multi-key fixed row. */
  readonly defaultChord: ActionChord | null;
  /**
   * Literal chips for a fixed binding no single chord can express — the
   * control-group digits, or a modifier that only means anything alongside a
   * mouse button. A chip equal to a `ModifierName` is rendered with the
   * platform's own symbol; anything else is printed verbatim.
   *
   * Mutually exclusive with `gesture`: a row shows key caps or a phrase, never
   * both, because "SHIFT" next to "Shift + right-click" reads as two bindings.
   */
  readonly fixedChips?: readonly string[];
  /**
   * How `fixedChips` are joined when drawn.
   *
   *   'plus'  (default) `CTRL + 0 – 9` — one chord, held together.
   *   'list'  `B  T  I  V` — a SET of alternatives, each its own key. Joining
   *           these with `+` would claim the player must hold all four.
   */
  readonly chipJoin?: 'plus' | 'list';
  /**
   * The `KeyboardEvent.code` each `fixedChips` entry stands for, index-aligned.
   *
   * Present only where a renderer needs to reason about the individual keys
   * rather than print them — the build rows supply it so the help screen can ask
   * `buildHotkeyBlockedBy` whether a rebind has taken that specific letter. A
   * chip with no code (`Ctrl`, `0 – 9`) is prose and gets none.
   */
  readonly fixedCodes?: readonly string[];
  /** Pointer / trackpad phrasing, shown in place of the key caps. */
  readonly gesture?: string;
  /**
   * False when the binding is stored and rebindable but nothing in the engine
   * reads it yet. Surfaced to the player rather than hidden.
   */
  readonly live?: boolean;
}

/* ==========================================================================
 * 2. THE BUILD KEYBOARD
 *
 * The HUD binds the sidebar to the keyboard, and it is the only surface that
 * does — `src/input/input.system.ts` binds orders and the camera and nothing
 * else. These two arrays are the whole of it, and they live HERE rather than in
 * `src/ui/Sidebar.ts` for the reason at the top of the file: the badge drawn on
 * a cameo and the row printed on the help screen have to be the same letters,
 * and the only way to guarantee that is for there to be one array.
 *
 * WHY THESE FOURTEEN LETTERS
 * --------------------------
 * Everything else is spoken for. A S G X F Y Z H are the `ord.*` rows and
 * `cam.home` above; Q and E are camera yaw; W A S D are the camera rig's own
 * fallback pan for when the input module is absent; the digits are control
 * groups; Escape belongs to the shell. B T I V are the only four mnemonic
 * letters left for the tabs, and the remainder leaves exactly ten free for the
 * slots — which is why ten cameos carry a badge and the eleventh does not. A
 * badge on a key that does nothing is worse than no badge.
 *
 * These are FIXED, not rebindable, and the honest consequence is that a player
 * who rebinds an order onto one of them creates a collision. The engine does not
 * pretend otherwise: `buildHotkeyBlockedBy` resolves it at the bottom of this
 * file, the HUD stands down for that key, and the help screen says which order
 * took it.
 * ========================================================================== */

/** Tab hotkeys, in `BuildTab` order, as `KeyboardEvent.code`. */
export const BUILD_TAB_HOTKEYS: readonly string[] = ['KeyB', 'KeyT', 'KeyI', 'KeyV'];

/** Slot hotkeys for the first ten cells of the open tab, in reading order. */
export const BUILD_SLOT_HOTKEYS: readonly string[] = [
  'KeyC', 'KeyR', 'KeyU', 'KeyO', 'KeyP', 'KeyN',
  'KeyJ', 'KeyK', 'KeyL', 'KeyM',
];

/**
 * Turning the placement ghost: anticlockwise, then clockwise.
 *
 * NOT letters, and that is forced rather than chosen. Read the paragraph above:
 * all twenty-six are already spoken for between the orders, the camera, the
 * camera rig's WASD fallback and the fourteen build letters. A rotate bound to
 * one of them would ALSO fire that order every time the player turned a
 * building, because placement does not suppress the order layer — only Escape
 * is special-cased in `input.system.ts#onKeyDown`. `,` and `.` are free, they
 * are a natural left/right pair, and `codeLabel` in settings-store already
 * prints them as `,` and `.`.
 *
 * `src/sim/Placement.ts` reads these codes; they are FIXED, like the build
 * keyboard, and for the same reason — the surface they live on only exists
 * while a structure is on the cursor.
 */
export const PLACEMENT_ROTATE_HOTKEYS: readonly string[] = ['Comma', 'Period'];

/** Badge text for the two rotate keys, index-aligned. */
export const PLACEMENT_ROTATE_HOTKEY_LABELS: readonly string[] = [',', '.'];

/**
 * Badge text for a bare `KeyboardEvent.code`.
 *
 * Deliberately narrow: it handles the letter and digit codes these two arrays
 * are made of and returns the code untouched for anything else. The full,
 * layout-independent table is `codeLabel` in `src/shell/settings-store.ts` — but
 * that module is in the lazily loaded shell chunk, and this file must stay
 * import-free so `input.system.ts` and `Sidebar.ts` can both read it during a
 * `?shot=` boot that never loads the shell at all.
 */
export function bareKeyLabel(code: string): string {
  if (code.length === 4 && code.startsWith('Key')) return code.slice(3);
  if (code.length === 6 && code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Badge letters for the tabs, index-aligned with `BUILD_TAB_HOTKEYS`. */
export const BUILD_TAB_HOTKEY_LABELS: readonly string[] = BUILD_TAB_HOTKEYS.map(bareKeyLabel);

/** Badge letters for the slots, index-aligned with `BUILD_SLOT_HOTKEYS`. */
export const BUILD_SLOT_HOTKEY_LABELS: readonly string[] = BUILD_SLOT_HOTKEYS.map(bareKeyLabel);

/* ==========================================================================
 * 3. THE CATALOGUE
 * ========================================================================== */

function chord(code: string, mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean }): ActionChord {
  return {
    code,
    ctrl: mods?.ctrl === true,
    shift: mods?.shift === true,
    alt: mods?.alt === true,
  };
}

export const ACTIONS: readonly ActionDef[] = [
  /* ---------------------------------------------------------------- camera */

  {
    id: 'cam.panUp',
    label: 'Pan Forward',
    description:
      'Slide the view forward. Speed scales with how far you are zoomed out. The ' +
      'arrow keys always pan, whatever this row is bound to — clearing it can never ' +
      'leave you without a camera.',
    category: 'camera',
    surface: 'camera',
    binding: 'rebindable',
    defaultChord: chord('ArrowUp'),
  },
  {
    id: 'cam.panDown',
    label: 'Pan Back',
    description: 'Slide the view back. The arrow keys always pan as well.',
    category: 'camera',
    surface: 'camera',
    binding: 'rebindable',
    defaultChord: chord('ArrowDown'),
  },
  {
    id: 'cam.panLeft',
    label: 'Pan Left',
    description: 'Slide the view left. The arrow keys always pan as well.',
    category: 'camera',
    surface: 'camera',
    binding: 'rebindable',
    defaultChord: chord('ArrowLeft'),
  },
  {
    id: 'cam.panRight',
    label: 'Pan Right',
    description: 'Slide the view right. The arrow keys always pan as well.',
    category: 'camera',
    surface: 'camera',
    binding: 'rebindable',
    defaultChord: chord('ArrowRight'),
  },
  {
    id: 'cam.rotateLeft',
    label: 'Rotate Left',
    description: 'Swing the camera around the point you are looking at.',
    category: 'camera',
    surface: 'camera',
    binding: 'rebindable',
    defaultChord: chord('KeyQ'),
  },
  {
    id: 'cam.rotateRight',
    label: 'Rotate Right',
    description: 'Swing the camera the other way. A base reads differently from every angle.',
    category: 'camera',
    surface: 'camera',
    binding: 'rebindable',
    defaultChord: chord('KeyE'),
  },
  {
    id: 'cam.home',
    label: 'Centre On Base',
    description:
      'Jump the camera to your construction yard, or to the centre of your army if ' +
      'every structure is gone.',
    category: 'camera',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyH'),
  },
  {
    id: 'cam.trackpadPan',
    label: 'Trackpad Pan',
    description:
      'Two fingers on the trackpad drag the ground. This is the primary pan gesture ' +
      'on a laptop; sensitivity and inversion are on the Controls tab.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Two-finger swipe',
  },
  {
    id: 'cam.pinchZoom',
    label: 'Pinch Zoom',
    description:
      'Pinch the trackpad to dolly in and out. Ctrl + wheel and Alt + wheel do the ' +
      'same thing, for a trackpad whose pinch the browser swallows.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Pinch · Ctrl + wheel · Alt + wheel',
  },
  {
    id: 'cam.wheelZoom',
    label: 'Wheel Zoom',
    description:
      'A mouse wheel notch dollies toward the point under the cursor. How strongly it ' +
      'pulls is the Zoom To Cursor slider.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Mouse wheel',
  },
  {
    id: 'cam.wheelPanX',
    label: 'Pan Sideways',
    description:
      'Shift held while scrolling pans horizontally instead — the only sideways pan ' +
      'available on a mouse with no tilt wheel.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Shift + wheel',
  },
  {
    id: 'cam.dragPan',
    label: 'Drag The World',
    description:
      'Grab the ground and pull it. Three ways in: the middle button, Space held with ' +
      'the left button, or the right button once it has travelled a few pixels — a ' +
      'right-click that never moves is still an order.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Middle-drag · Space + left-drag · right-drag',
  },
  {
    id: 'cam.edgeScroll',
    label: 'Edge Scrolling',
    description:
      'OFF by default, because on a laptop the cursor reaches an edge every time you ' +
      'touch the sidebar. Turn it on in Options; it then scrolls only while the ' +
      'pointer is MOVING into the edge, never while it is parked there.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Push into a screen edge',
  },
  {
    id: 'cam.minimapJump',
    label: 'Jump To Map Point',
    description: 'Click the tactical map to move the camera there.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Click the tactical map',
  },
  {
    id: 'cam.minimapDrag',
    label: 'Scrub The Map',
    description: 'Hold and drag on the tactical map to sweep the camera across the field.',
    category: 'camera',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Drag on the tactical map',
  },

  /* ------------------------------------------------------------- selection */

  {
    id: 'sel.click',
    label: 'Select',
    description:
      'Click a unit or structure. A tank parked on a pad beats the structure under it — ' +
      'units always win a tie.',
    category: 'selection',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Left-click',
  },
  {
    id: 'sel.box',
    label: 'Box Select',
    description:
      'Drag a marquee. If the box contains any of your own mobile units, only those come ' +
      'back — dragging over your base never hands you six buildings you cannot order.',
    category: 'selection',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Left-drag',
  },
  {
    id: 'sel.sameType',
    label: 'Select All Of Type',
    description:
      'Double-click a unit to take every one of the same type that is currently ON SCREEN. ' +
      'It deliberately stops at the screen edge rather than pulling in the tank guarding ' +
      'your second refinery.',
    category: 'selection',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Double-click',
  },
  {
    id: 'sel.add',
    label: 'Add To Selection',
    description: 'Shift held while clicking or dragging adds to the selection instead of replacing it.',
    category: 'selection',
    surface: 'pointer',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Shift', 'Click or drag'],
  },
  {
    id: 'sel.toggle',
    label: 'Toggle One',
    description: 'Ctrl held while clicking drops that one entity out of the selection, or adds it back.',
    category: 'selection',
    surface: 'pointer',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Ctrl', 'Click'],
  },
  {
    id: 'sel.allArmy',
    label: 'Select All Army',
    description: 'Every mobile unit you own, anywhere on the map. Structures are never included.',
    category: 'selection',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyA', { ctrl: true }),
  },
  {
    id: 'sel.groupSet',
    label: 'Store Control Group',
    description: 'The group becomes exactly what is selected right now. Ten groups, 0 through 9.',
    category: 'selection',
    surface: 'command',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Ctrl', '0 – 9'],
  },
  {
    id: 'sel.groupAppend',
    label: 'Append To Control Group',
    description: 'Add the current selection to a group without disturbing what is already in it.',
    category: 'selection',
    surface: 'command',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Ctrl', 'Shift', '0 – 9'],
  },
  {
    id: 'sel.groupRecall',
    label: 'Recall Control Group',
    description: 'Select the group. Members that have died are dropped, never resurrected.',
    category: 'selection',
    surface: 'command',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['0 – 9'],
  },
  {
    id: 'sel.groupAdd',
    label: 'Recall And Add',
    description: 'Add a stored group to the current selection rather than replacing it.',
    category: 'selection',
    surface: 'command',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Shift', '0 – 9'],
  },
  {
    id: 'sel.groupCentre',
    label: 'Jump To Control Group',
    description: 'Tap the same digit TWICE, quickly, to centre the camera on that group.',
    category: 'selection',
    surface: 'command',
    binding: 'fixed',
    defaultChord: null,
    // One chip, not two: `0-9 + 0-9` reads as a chord you hold, which is the
    // opposite of a double tap. The word "twice" does that job in the sentence.
    fixedChips: ['0 – 9'],
  },
  {
    id: 'sel.clear',
    label: 'Clear Selection',
    description:
      'Click bare ground. Escape does NOT clear the selection during a match — the pause ' +
      'menu claims that key before the battlefield ever sees it.',
    category: 'selection',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Left-click empty ground',
  },

  /* ---------------------------------------------------------------- orders */

  {
    id: 'ord.context',
    label: 'Contextual Order',
    description:
      'Right-click. What it means comes from what is under the cursor: move on ground, ' +
      'attack on an enemy, capture with an engineer, enter a transport, harvest on ore, ' +
      'repair a damaged structure, or move the rally flag when only factories are selected.',
    category: 'orders',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Right-click',
  },
  {
    id: 'ord.queue',
    label: 'Queue Waypoint',
    description:
      'Shift held while ordering appends to the queue instead of replacing it. Up to eight ' +
      'waypoints per unit; each one starts when the previous is reached.',
    category: 'orders',
    surface: 'pointer',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Shift', 'Right-click'],
  },
  {
    id: 'ord.forceFireMod',
    label: 'Force Fire (modifier)',
    description:
      'Ctrl held turns the next right-click into a force-fire, on bare ground or on your ' +
      'own units. The same thing the Force Fire key arms, without the mode.',
    category: 'orders',
    surface: 'pointer',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Ctrl', 'Right-click'],
  },
  {
    id: 'ord.forceMove',
    label: 'Force Move',
    description:
      'Alt held ignores whatever is under the cursor and issues a plain move — how you ' +
      'drive through a target instead of stopping to shoot it.',
    category: 'orders',
    surface: 'pointer',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: ['Alt', 'Right-click'],
  },
  {
    id: 'ord.attackMove',
    label: 'Attack Move',
    description:
      'Arms the cursor; the next click sets the destination. The column engages what it ' +
      'meets on the way instead of driving past the fight.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyA'),
  },
  {
    id: 'ord.stop',
    label: 'Stop',
    description: 'Cancel every order and hold position. The one order a structure also accepts.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyS'),
  },
  {
    id: 'ord.guard',
    label: 'Guard',
    description: 'Hold where you stand and engage anything that comes into range.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyG'),
  },
  {
    id: 'ord.scatter',
    label: 'Scatter',
    description:
      'Break formation and disperse three to seven metres — how a stack gets out from ' +
      'under artillery.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyX'),
  },
  {
    id: 'ord.deploy',
    label: 'Deploy',
    description:
      'Unpack a construction vehicle into its Construction Yard WHERE IT STANDS — drive ' +
      'it into place first, this is not a move order. Double-clicking the vehicle does ' +
      'the same thing, and so does right-clicking it while it is selected. A structure ' +
      'that can fold back into a vehicle takes the same key; so does a transport with a ' +
      'squad aboard, and so does a building with a squad inside — the men get out around ' +
      'the hull or around the walls. All three are the same verb, and a mixed selection ' +
      'does all three at once. The selection panel has a button for each.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyD'),
  },
  {
    id: 'ord.forceAttack',
    label: 'Force Fire',
    description:
      'Arms the cursor to fire on the next click, whatever is there — ground, wreckage or ' +
      'your own hardware.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyF'),
  },
  {
    id: 'ord.rally',
    label: 'Set Rally Point',
    description:
      'Arms the cursor to move the rally flag of every selected factory. Selecting only ' +
      'structures does the same thing on a plain right-click.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyY'),
  },
  {
    id: 'ord.ability',
    label: 'Commander Ability',
    description:
      'Fires the selected commander’s faction ability, centred on wherever they are ' +
      'standing. Each army has a different one and none of them needs a target — where ' +
      'you walked the commander IS the aim. The same verb is a button on the selection ' +
      'panel, which also prints the seconds left when it is cooling.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    // SHIFT+F, and the shift is not a compromise. Every unmodified letter on the
    // keyboard is already an order, a tab, a build slot or a camera pan; F is
    // Force Fire, which is the nearest neighbour in meaning, so the ability
    // lands one modifier away from the verb a player already associates with
    // "do the special thing on purpose".
    defaultChord: chord('KeyF', { shift: true }),
  },
  {
    id: 'ord.stance',
    label: 'Cycle Stance',
    description:
      'Rotate the selection through aggressive, defensive, hold fire and hold ground. The ' +
      'same four are buttons on the selection panel.',
    category: 'orders',
    surface: 'command',
    binding: 'rebindable',
    defaultChord: chord('KeyZ'),
  },
  {
    id: 'ord.stanceButtons',
    label: 'Set Stance Directly',
    description: 'The four stance icons under the selection panel set a stance rather than cycling.',
    category: 'orders',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Click a stance icon',
  },
  {
    id: 'ord.cancelMode',
    label: 'Cancel Armed Order',
    description:
      'A right-click drops an armed attack-move, force-fire or rally mode instead of firing ' +
      'it. The universal never mind, and the reason those keys are safe to press ' +
      'speculatively.',
    category: 'orders',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Right-click',
  },

  /* -------------------------------------------------------------- building */

  {
    id: 'bld.tab',
    label: 'Switch Build Category',
    description: 'The sidebar tabs: structures, defences, infantry, vehicles.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Click a sidebar tab',
  },
  {
    id: 'bld.tabKeys',
    label: 'Build Tab Keys',
    description:
      'Jump straight to structures, defences, infantry and vehicles without reaching for the ' +
      'tabs. Bare keys only — a modifier belongs to an order, so Ctrl+B is left alone.',
    category: 'building',
    surface: 'hud',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: [...BUILD_TAB_HOTKEY_LABELS],
    fixedCodes: [...BUILD_TAB_HOTKEYS],
    chipJoin: 'list',
  },
  {
    id: 'bld.queue',
    label: 'Start Production',
    description:
      'Click a cameo to queue one. Click again to queue another. A finished structure does NOT ' +
      'jump onto the cursor — its cameo reads READY and waits, and clicking that cameo is what ' +
      'picks it up.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Left-click a cameo',
  },
  {
    id: 'bld.pickUp',
    label: 'Pick Up A Finished Structure',
    description:
      'A structure that finishes building waits on its cameo, marked READY, until you ask for ' +
      'it. Clicking that cameo puts it on the cursor. Nothing is lost by leaving it there.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Left-click a READY cameo',
  },
  {
    id: 'bld.slotKeys',
    label: 'Build Slot Keys',
    description:
      'The first ten cameos of the OPEN tab, in reading order — so the same letter builds a ' +
      'different thing on each tab. The badge drawn on a cameo is its key; a cameo with no ' +
      'badge has none, and pressing a letter over an empty cell passes the keystroke on ' +
      'rather than swallowing it.',
    category: 'building',
    surface: 'hud',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: [...BUILD_SLOT_HOTKEY_LABELS],
    fixedCodes: [...BUILD_SLOT_HOTKEYS],
    chipJoin: 'list',
  },
  {
    id: 'bld.cancel',
    label: 'Cancel Production',
    description: 'Right-click a cameo to cancel one queued item and refund it.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Right-click a cameo',
  },
  {
    id: 'bld.place',
    label: 'Place Structure',
    description:
      'With a finished structure on the cursor, click the ground to put it down. The ghost ' +
      'shows whether the footprint is legal before you commit.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Left-click the ground',
  },
  {
    id: 'bld.rotateLeft',
    label: 'Rotate Structure Left',
    description:
      'Turns the structure on the cursor a quarter turn anticlockwise. At 90 and 270 degrees ' +
      'the footprint SWAPS, so a 3x2 War Factory takes 2x3 cells and the green carpet changes ' +
      'shape with it. The chevron on the ghost points at the edge units will come out of.',
    category: 'building',
    surface: 'placement',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: [PLACEMENT_ROTATE_HOTKEY_LABELS[0]],
    fixedCodes: [PLACEMENT_ROTATE_HOTKEYS[0]],
  },
  {
    id: 'bld.rotateRight',
    label: 'Rotate Structure Right',
    description:
      'Turns the structure on the cursor a quarter turn clockwise. The facing sticks for the ' +
      'next structure you place, which is how a line of walls or defences all end up pointing ' +
      'the same way; picking up an existing building to relocate adopts its own facing instead.',
    category: 'building',
    surface: 'placement',
    binding: 'fixed',
    defaultChord: null,
    fixedChips: [PLACEMENT_ROTATE_HOTKEY_LABELS[1]],
    fixedCodes: [PLACEMENT_ROTATE_HOTKEYS[1]],
  },
  {
    id: 'bld.cancelPlace',
    label: 'Cancel Placement',
    description:
      'Right-click puts the structure back in the queue — it stays finished and costs ' +
      'nothing to place again.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Right-click',
  },
  {
    id: 'bld.repair',
    label: 'Repair Structure',
    description:
      'Arm the repair tool in the sidebar, then click one of your structures to start or ' +
      'stop mending it. Right-click disarms the tool.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Repair tool, then a structure',
  },
  {
    id: 'bld.sell',
    label: 'Sell Structure',
    description:
      'Arm the sell tool, then click one of your structures. Selling a damaged building ' +
      'before it dies is how you keep half the cost.',
    category: 'building',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Sell tool, then a structure',
  },

  /* ------------------------------------------------------------- interface */

  {
    id: 'sys.menu',
    label: 'Pause Menu',
    description:
      'Freezes the match and opens the pause menu. This key is taken before the ' +
      'battlefield sees it, which is why it never doubles as clear-selection.',
    category: 'interface',
    surface: 'global',
    binding: 'rebindable',
    defaultChord: chord('Escape'),
  },
  {
    id: 'sys.perf',
    label: 'Performance Overlay',
    description:
      'Frame time, draw calls, entity counts and the per-phase sim budget. Read straight ' +
      'off the key code by the debug layer, so it cannot be rebound.',
    category: 'interface',
    surface: 'global',
    binding: 'fixed',
    defaultChord: chord('F3'),
  },
  {
    id: 'sys.speed',
    label: 'Cycle Game Speed',
    description: 'Reserved. The binding is stored, but nothing in the engine reads it yet.',
    category: 'interface',
    surface: 'global',
    binding: 'rebindable',
    defaultChord: chord('Backslash'),
    live: false,
  },
  {
    id: 'sys.screenshot',
    label: 'Save Screenshot',
    description: 'Reserved. The binding is stored, but nothing in the engine reads it yet.',
    category: 'interface',
    surface: 'global',
    binding: 'rebindable',
    defaultChord: chord('F12'),
    live: false,
  },
  {
    id: 'ui.help',
    label: 'This Screen',
    description:
      'Reachable from the pause menu, and from Options under the Controls tab. It always ' +
      'shows your CURRENT bindings, not the defaults.',
    category: 'interface',
    surface: 'pointer',
    binding: 'gesture',
    defaultChord: null,
    gesture: 'Pause → Controls',
  },
];

/* ==========================================================================
 * 4. THE DERIVED TABLES
 *
 * `input.system.ts` builds both of its runtime maps from these, so the engine's
 * default scheme and this catalogue are the same object rather than two lists
 * that agree today.
 * ========================================================================== */

const BY_ID = new Map<string, ActionDef>(ACTIONS.map((a) => [a.id, a]));

export function actionById(id: string): ActionDef | undefined {
  return BY_ID.get(id);
}

/** Every action in a category, in catalogue order. */
export function actionsIn(category: ActionCategory): ActionDef[] {
  return ACTIONS.filter((a) => a.category === category);
}

/** The rows the options screen offers as rebind buttons. */
export function rebindableActions(): ActionDef[] {
  return ACTIONS.filter((a) => a.binding === 'rebindable');
}

/**
 * Actions dispatched on a keystroke. `input.system.ts` resolves a pressed chord
 * against these; the ids are the switch labels in its `onKeyDown`.
 */
export const COMMAND_ACTION_IDS: readonly string[] =
  ACTIONS.filter((a) => a.binding === 'rebindable' && a.surface === 'command').map((a) => a.id);

/**
 * Camera keys, which are POLLED while held rather than dispatched, so only the
 * `code` matters — you do not hold Ctrl to keep panning.
 */
export const CAMERA_KEY_IDS: readonly string[] =
  ACTIONS.filter((a) => a.binding === 'rebindable' && a.surface === 'camera').map((a) => a.id);

/** `id -> default chord` for every command action. A fresh object per call. */
export function defaultCommandChords(): Record<string, ActionChord> {
  const out: Record<string, ActionChord> = {};
  for (const id of COMMAND_ACTION_IDS) {
    const c = BY_ID.get(id)?.defaultChord;
    if (c !== undefined && c !== null) out[id] = { ...c };
  }
  return out;
}

/** `id -> default KeyboardEvent.code` for every polled camera key. */
export function defaultCameraCodes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of CAMERA_KEY_IDS) {
    const c = BY_ID.get(id)?.defaultChord;
    if (c !== undefined && c !== null) out[id] = c.code;
  }
  return out;
}

/* ==========================================================================
 * 5. PRESENTATION HELPERS
 *
 * Shared by the help screen and the options screen so a modifier is spelled the
 * same way in both. The KEY name itself is `codeLabel` in
 * `src/shell/settings-store.ts` — that table is layout-independent and already
 * correct, and duplicating it here to avoid one import would be the exact
 * mistake this file exists to prevent.
 * ========================================================================== */

const MAC_MODIFIERS: Readonly<Record<ModifierName, string>> = {
  Ctrl: '⌃',
  Shift: '⇧',
  Alt: '⌥',
  Meta: '⌘',
};

const PC_MODIFIERS: Readonly<Record<ModifierName, string>> = {
  Ctrl: 'CTRL',
  Shift: 'SHIFT',
  Alt: 'ALT',
  Meta: 'WIN',
};

/**
 * True on macOS and iOS/iPadOS.
 *
 * Deliberately `userAgent`-based with a `platform` fallback: `navigator.platform`
 * is deprecated and reports `MacIntel` for an iPad, while the UA string is the
 * signal every browser still ships. The argument is injectable so the unit test
 * does not have to fake a global.
 */
export function isApplePlatform(nav?: { userAgent?: string; platform?: string }): boolean {
  const n = nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (n === undefined) return false;
  const s = `${n.userAgent ?? ''} ${n.platform ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(s);
}

/** Platform-correct name for one modifier. */
export function modifierLabel(mod: ModifierName, mac: boolean): string {
  return mac ? MAC_MODIFIERS[mod] : PC_MODIFIERS[mod];
}

/** True when a `fixedChips` entry is a modifier token rather than literal text. */
export function isModifierName(s: string): s is ModifierName {
  return s === 'Ctrl' || s === 'Shift' || s === 'Alt' || s === 'Meta';
}

/**
 * The modifier chips of a chord, in the canonical order Ctrl, Shift, Alt.
 * The key name itself is the caller's job — see the section header.
 */
export function modifierChips(c: ActionChord, mac: boolean): string[] {
  const out: string[] = [];
  if (c.ctrl) out.push(modifierLabel('Ctrl', mac));
  if (c.shift) out.push(modifierLabel('Shift', mac));
  if (c.alt) out.push(modifierLabel('Alt', mac));
  return out;
}

/** True when two chords are the same physical press. */
export function sameChord(a: ActionChord | undefined | null, b: ActionChord | undefined | null): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return a.code === b.code && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;
}

/* ==========================================================================
 * 6. THE FIXED / REBINDABLE COLLISION
 *
 * The build keyboard is fixed and the order keyboard is not, so a player CAN
 * rebind Attack Move onto `B` and put two actions on one key. Three ways to
 * handle that, and only one of them is honest:
 *
 *   - Let both fire. The player changes tab every time they attack-move.
 *   - Let the HUD win. The player's own rebind silently does nothing.
 *   - Let the rebind win, and SAY SO. The order the player deliberately chose
 *     keeps the key, the HUD stands down for that one letter, and the help
 *     screen prints the letter struck through with the name of the order that
 *     took it.
 *
 * The third is what ships. `src/ui/Hud.ts` calls this before acting on a
 * keystroke and `src/shell/Help.ts` calls it while drawing the chips, so the
 * behaviour and its explanation come from one function.
 * ========================================================================== */

/**
 * A chord as the settings store hands it over. Structurally minimal and
 * duck-typed on purpose — the store lives in the shell chunk, this file has no
 * imports, and a `?shot=` boot loads the second without ever loading the first.
 */
export interface StoredChord {
  readonly code: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/** Live bindings keyed by action id, exactly `settings.controls.bindings`. */
export type StoredBindings = Readonly<Record<string, StoredChord | undefined>>;

/**
 * The chord an action is on right now.
 *
 * A stored row with an empty `code` is a real answer — the player cleared it —
 * and returns null rather than falling back to the default. Only a MISSING row
 * means "never touched, use the default".
 */
export function liveChordFor(id: string, bindings?: StoredBindings): ActionChord | null {
  const def = BY_ID.get(id);
  if (def === undefined) return null;
  const stored = bindings?.[id];
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

/**
 * The rebindable action holding a BARE key code, or undefined when it is free.
 *
 * Bare because that is the only kind of press the build keyboard reacts to: the
 * HUD returns early on any modifier, so `Ctrl+B` cannot collide with the
 * structures tab and is not reported here. Camera rows count even though they
 * are polled rather than dispatched — a pan key is read by `code` alone, so a
 * camera row on `B` really would fight the tab.
 */
export function buildHotkeyBlockedBy(code: string, bindings?: StoredBindings): ActionDef | undefined {
  for (const a of ACTIONS) {
    if (a.binding !== 'rebindable') continue;
    const live = liveChordFor(a.id, bindings);
    if (live === null) continue;
    if (live.code !== code) continue;
    // The camera surface ignores modifiers entirely, so a stored modifier on a
    // camera row does not save the key from colliding.
    if (a.surface !== 'camera' && (live.ctrl || live.shift || live.alt)) continue;
    return a;
  }
  return undefined;
}

/** Every build hotkey a rebind has taken, in `BUILD_*_HOTKEYS` order. */
export function buildHotkeyConflicts(
  bindings?: StoredBindings,
): Array<{ code: string; label: string; takenBy: ActionDef }> {
  const out: Array<{ code: string; label: string; takenBy: ActionDef }> = [];
  for (const code of [...BUILD_TAB_HOTKEYS, ...BUILD_SLOT_HOTKEYS]) {
    const takenBy = buildHotkeyBlockedBy(code, bindings);
    if (takenBy !== undefined) out.push({ code, label: bareKeyLabel(code), takenBy });
  }
  return out;
}
