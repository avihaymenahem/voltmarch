# Controls

Every control in the game, by category. The **Binding** column says how you reach it:

- **Rebindable** — you can change it, on the Controls tab of Settings
- **Fixed** — the engine reads this key directly and it cannot be changed
- **Gesture** — mouse, trackpad or an on-screen control; no key involved

Keys below are the stock scheme. If you have rebound anything, the truth is on screen: open
**Pause → Controls → All Commands**, which resolves every row against your current bindings rather
than printing the defaults.

---

## Camera

| Control | Action | Binding |
| --- | --- | --- |
| `↑` | Pan forward | Rebindable |
| `↓` | Pan back | Rebindable |
| `←` | Pan left | Rebindable |
| `→` | Pan right | Rebindable |
| `Q` | Rotate left | Rebindable |
| `E` | Rotate right | Rebindable |
| `=` | Zoom in | Rebindable |
| `-` | Zoom out | Rebindable |
| `H` | Centre on base | Rebindable |
| Two-finger swipe | Zoom, on a trackpad | Gesture |
| `Shift` + two-finger swipe | Trackpad pan | Gesture |
| Pinch · `Ctrl`+wheel · `Alt`+wheel | Zoom | Gesture |
| Mouse wheel | Zoom toward the cursor | Gesture |
| `Shift` + wheel | Pan sideways | Gesture |
| Middle-drag · `Space`+left-drag | Drag the world | Gesture |
| Push into a screen edge | Edge scrolling | Gesture, **off by default** |
| Click the tactical map | Jump the camera there | Gesture |
| Drag on the tactical map | Scrub the camera | Gesture |

Notes that matter:

- **The arrow keys always pan**, whatever the four pan rows are bound to. Clearing them cannot
  leave you without a camera. `W A S D` also pan as the camera rig's own fallback, which is why
  none of those four letters is available as an order key.
- **`=` and `-` zoom, and they are the only zoom that needs no pointing device.** Hold them; they
  are polled while down, like the pan keys. If a scroll gesture is behaving strangely on your
  machine, these still work.
- **On a trackpad, two fingers zoom.** That is the default. Hold `Shift` to pan with two fingers
  instead, or swipe mostly sideways, which pans without any modifier. If you would rather have the
  macOS convention — two fingers pan, only a pinch zooms — set **Trackpad Scroll** to **Pan** on the
  Controls tab. Pinch, `Ctrl` + scroll and `Alt` + scroll zoom under either setting.
- **`Shift` + wheel pans instead of zooming.** On a mouse that means sideways, which is the only
  horizontal pan a wheel with no tilt can reach.
- **Pan speed scales with zoom.** The further out you are, the faster a keypress moves you.
- **Right-click belongs to battlefield orders.** It never becomes a camera drag during a match;
  use middle-drag or `Space`+left-drag to move the camera without stealing a command.
- **Lock Mouse To Window is on by default.** It confines the pointer only
  during live gameplay, keeps contextual cursors, HUD hover and internal panel scrolling intact, and
  releases for menus, pause, focus loss and visibility changes.
- **Edge scrolling ships off**, because on a laptop the cursor reaches an edge every time you
  touch the sidebar. Turned on, it scrolls only while the pointer is *moving* into the edge, never
  while it is parked there.

---

## Selection

| Control | Action | Binding |
| --- | --- | --- |
| Left-click | Select a unit or structure | Gesture |
| Left-drag | Box select | Gesture |
| Double-click | Select all of that type **on screen** | Gesture |
| `Shift` + click or drag | Add to selection | Fixed |
| `Ctrl` + click | Toggle one entity in or out | Fixed |
| `Ctrl` + `A` | Select all army | Rebindable |
| `Ctrl` + `0`–`9` | Store control group | Fixed |
| `Ctrl` + `Shift` + `0`–`9` | Append to control group | Fixed |
| `0`–`9` | Recall control group | Fixed |
| `Shift` + `0`–`9` | Recall and add | Fixed |
| `0`–`9` twice, quickly | Jump the camera to that group | Fixed |
| Left-click empty ground | Clear selection | Gesture |

- Box select is **units-first**: if the marquee contains any of your own mobile units, only those
  come back. Dragging over your base never hands you six buildings you cannot order.
- Select-all-of-type stops at the **screen edge**. It will not pull in the tank guarding your
  second refinery.
- Control groups drop members that have died. They never resurrect them.
- **Escape does not clear the selection.** The pause menu claims that key first.

---

## Orders

| Control | Action | Binding |
| --- | --- | --- |
| Right-click | Contextual order | Gesture |
| `Shift` + right-click | Queue a waypoint | Fixed |
| `Ctrl` + right-click | Force fire on that point | Fixed |
| `Alt` + right-click | Force move, ignoring what is there | Fixed |
| `A` | Attack move (arms the cursor) | Rebindable |
| `S` | Stop | Rebindable |
| `G` | Guard | Rebindable |
| `X` | Scatter | Rebindable |
| `D` | Deploy / unload | Rebindable |
| `F` | Force fire (arms the cursor) | Rebindable |
| `Y` | Set rally point (arms the cursor) | Rebindable |
| `Shift` + `F` | Commander ability | Rebindable |
| `Z` | Cycle stance | Rebindable |
| Click a stance icon | Set that stance directly | Gesture |
| Click a formation diagram | Arrange the selected group as Line, Rectangle, V, or Triangle | Gesture |
| Right-click | Cancel an armed order | Gesture |

What each of the letters actually does:

- **A — Attack move.** Arms the cursor; the next click sets the destination. The column engages
  what it meets on the way instead of driving past the fight.
- **S — Stop.** Cancels every order and holds position. The one order a structure also accepts.
- **G — Guard.** Hold where you stand and engage anything that comes into range.
- **X — Scatter.** Break formation and disperse three to seven metres. How a stack gets out from
  under artillery.
- **D — Deploy.** Unpacks a construction vehicle into its Construction Yard **where it stands**.
  It is not a move order — drive it into place first. A structure that folds back into a vehicle
  takes the same key; so does a loaded hull, which puts its cargo down around itself; and so does
  an occupied structure, which turns its garrison out the same way. All three act on the whole
  selection, so one press empties every loaded hull you have. Double-clicking a construction
  vehicle does the same thing, and so does right-clicking it while it is selected.
- **F — Force fire.** Arms the cursor to fire on the next click, whatever is there — ground,
  wreckage or your own hardware. It works into unexplored shroud, which nothing else does.
- **Y — Set rally point.** Arms the cursor to move the rally flag of every selected factory.
  Selecting only structures does the same thing on a plain right-click.
- **Shift+F — Commander ability.** Fires the selected commander's faction ability, centred on
  wherever they are standing. None of the four needs a target — where you walked the commander is
  the aim. The same verb is a button on the selection panel, which prints the seconds left while
  it is cooling.
- **Z — Cycle stance.** Rotates through Aggressive → Defensive → Hold fire → Hold ground.

**A right-click cancels an armed mode** rather than firing it. That is the universal never-mind,
and it is why A, F and Y are safe to press speculatively.

---

## Building

| Control | Action | Binding |
| --- | --- | --- |
| Click a sidebar tab | Switch build category | Gesture |
| `B` `T` `I` `V` | Structures / Defence / Infantry / Vehicles | Fixed |
| Left-click a cameo | Queue one | Gesture |
| Left-click a **READY** cameo | Put the finished structure on the cursor | Gesture |
| `C` `R` `U` `O` `P` `N` `J` `K` `L` `M` | The first ten cameos of the open tab | Fixed |
| Right-click a cameo | Cancel one queued item and refund it | Gesture |
| Left-click the ground | Place the structure on the cursor | Gesture |
| `,` | Rotate the ghost anticlockwise | Fixed |
| `.` | Rotate the ghost clockwise | Fixed |
| Right-click | Cancel placement | Gesture |
| `Escape` | Cancel placement, sell/repair tool or armed order before opening pause | Fixed |
| Repair tool, then a structure | Toggle repair on that building | Gesture |
| Sell tool, then a structure | Sell it | Gesture |

- The ten slot letters are **positional**: they address the first ten cameos of whichever tab is
  open, in reading order, so the same letter builds a different thing on each tab. The badge drawn
  on a cameo is its key. A cameo with no badge has no key, and pressing a letter over an empty
  cell passes the keystroke on rather than swallowing it.
- Modifiers are ignored by the build keyboard, so `Ctrl+B` is left alone for anything you want to
  bind it to.
- **A finished structure does not jump onto the cursor.** Its cameo reads READY and waits
  indefinitely. Clicking that cameo is what picks it up, and nothing is lost by leaving it there.
- Cancelling placement with right-click puts the structure back in the queue still finished. It
  costs nothing to place again.
- Walls and gates are valid sell targets even though ordinary selection treats them as terrain-like
  perimeter pieces. Right-click or Escape disarms sell without selling anything.
- **Rotation is quarter turns only.** At 90° and 270° the footprint swaps, so a 3×2 War Factory
  takes 2×3 cells and the green carpet changes shape with it. The facing sticks for the next
  structure you place, which is how a line of walls all ends up pointing the same way.

---

## Interface

| Control | Action | Binding |
| --- | --- | --- |
| `Esc` | Pause menu | Rebindable |
| `F3` | Performance overlay | Fixed |
| `\` | Cycle game speed | Rebindable |
| `F12` | Save screenshot | Rebindable, **reserved** |
| Pause → Controls | The full command reference | Gesture |

Game-speed cycling is live in skirmish and campaign: each press walks **0.5× → 1× → 1.5× → 2× →
2.5× → 0.5×** and reports the new speed. Multiplayer is fixed at 1× and refuses the command rather
than letting two simulations choose different clocks.

The screenshot row remains *reserved*: the binding is stored and can be changed, but the engine
does not read it yet.

`F3` is read straight off the key code by the debug layer, so it cannot be rebound.

---

## Rebinding

**Settings → Controls**, or **Pause → Controls** during a match.

Select a command, then press the key or chord. **Backspace** clears a binding; **Escape** cancels
the capture. **Restore Defaults** puts the whole scheme back.

Three things about the rebind screen you should know before you use it:

1. **Camera keys and order keys are separate surfaces.** Sharing a key between them is intentional
   and is not flagged as a conflict. Camera keys are polled while held, which is also why
   modifiers are ignored on them — you do not hold Ctrl to keep panning.
2. **The build keyboard is fixed, and a rebind can steal from it.** If you bind an order onto one
   of the fourteen build letters, *the order wins*. The sidebar stands down for that letter and
   the screen tells you so, with a note reading something like *"1 build key taken — B by Attack
   Move. The order keeps the key; the sidebar cameo it used to build no longer answers to it."*
   This is deliberate: your own deliberate rebind should not silently do nothing.
3. **Fixed rows appear as flat chips, not buttons.** A rebind button that does nothing would be
   the same class of lie as a help screen that shows the defaults.

### Pointer and camera settings

Above the key list on the same tab:

| Setting | Default | What it does |
| --- | --- | --- |
| Pointing device | Auto | Reads the shape of your scroll events. Both kinds zoom on a plain scroll, so this only changes how far one goes |
| Trackpad scroll | Zoom | What two fingers do on their own. Pan is the macOS maps convention; pinch, `Ctrl` + scroll and `Alt` + scroll zoom either way |
| Pan sensitivity | 100% | Trackpad swipe and drag pan. 100% means the ground tracks your fingers exactly |
| Zoom sensitivity | 100% | Wheel notches, two-finger scroll and pinch |
| Zoom to cursor | 75% | How strongly a zoom pulls the point under the cursor toward the centre |
| Keyboard pan speed | 42 m/s | Arrow keys and WASD at the default zoom; scales as you pull back |
| Pan momentum | On | The camera carries a little inertia and settles instead of stopping dead |
| Drag grabs the world | On | On, the ground follows your cursor. Off, the camera does |
| Invert pan — horizontal / vertical | Off | |
| Invert zoom | Off | For anyone whose scroll direction is already reversed by the OS |
| Edge scrolling | Off | See the note under Camera |

### Elsewhere in Settings

The **Gameplay** tab begins with Accessibility: text scaling from 90–150% (115% by default), a
high-contrast presentation and reduced interface motion. The same tab carries Tooltips, Floating
Damage Numbers, Voice Subtitles and a Screen Shake slider. Voice Subtitles covers both EVA and
unit responses. Camera and navigation are deliberately
*not* there — they are on Controls, which is where you would go looking for "why does my trackpad
pan instead of zoom".

The **Updates** tab reports the running version, edition and release status. Installed desktop
builds can check, download, and restart into an update there; portable builds open the matching
manual download. The tab also links to the latest release and the full GitHub release archive.
The complete map of every tab is in
[Settings and Accessibility](/avihaymenahem/voltmarch/wiki/Settings-and-Accessibility).

---

## Multiplayer communication

- **Enter** opens in-match text chat. Enter sends the one-line message and Escape cancels it.
- **Right-click the tactical map** with units selected to issue the same contextual ground or
  target order as a right-click on the battlefield. Shift queues it; Ctrl force-fires and Alt
  force-moves when those modifiers make sense.
- In mixed co-op, a tactical-map right-click that produces no valid unit order becomes a position
  ping for the human ally. A duel has no ally receiver. Automatic under-attack rings remain too.

## What has no control at all

Stated plainly so you do not go hunting:

- There is no world-space ping wheel, emote wheel or taunt menu; the multiplayer marker is minimap-only.

Two entries that used to be on this list are **no longer true**, and they are corrected on their
own pages rather than left here:

- **Choosing a primary factory** now has a control. Select one finished factory you own and press
  **Set Primary** in the selection panel — see
  [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building).
- **Commander support powers** are bought in a match from the Powers tab once you have a Command
  Post, and are fired from the powers bar with the mouse. They stopped being mission rewards. See
  [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building). The per-unit **faction ability** on
  `Shift+F` remains a different thing — see
  [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs).

---

See also: [How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) · [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building) · [Economy](/avihaymenahem/voltmarch/wiki/Economy)
