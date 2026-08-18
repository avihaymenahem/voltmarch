# Controls

Every control in the game, by category. The **Binding** column says how you reach it:

- **Rebindable** — you can change it, on the Controls tab of Options
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
| `H` | Centre on base | Rebindable |
| Two-finger swipe | Trackpad pan | Gesture |
| Pinch · `Ctrl`+wheel · `Alt`+wheel | Zoom | Gesture |
| Mouse wheel | Zoom toward the cursor | Gesture |
| `Shift` + wheel | Pan sideways | Gesture |
| Middle-drag · `Space`+left-drag · right-drag | Drag the world | Gesture |
| Push into a screen edge | Edge scrolling | Gesture, **off by default** |
| Click the tactical map | Jump the camera there | Gesture |
| Drag on the tactical map | Scrub the camera | Gesture |

Notes that matter:

- **The arrow keys always pan**, whatever the four pan rows are bound to. Clearing them cannot
  leave you without a camera. `W A S D` also pan as the camera rig's own fallback, which is why
  none of those four letters is available as an order key.
- **Pan speed scales with zoom.** The further out you are, the faster a keypress moves you.
- **Right-drag is both a camera drag and an order.** The button becomes a drag only once it has
  travelled a few pixels; a right-click that never moves is still an order.
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
- **Rotation is quarter turns only.** At 90° and 270° the footprint swaps, so a 3×2 War Factory
  takes 2×3 cells and the green carpet changes shape with it. The facing sticks for the next
  structure you place, which is how a line of walls all ends up pointing the same way.

---

## Interface

| Control | Action | Binding |
| --- | --- | --- |
| `Esc` | Pause menu | Rebindable |
| `F3` | Performance overlay | Fixed |
| `\` | Cycle game speed | Rebindable, **reserved** |
| `F12` | Save screenshot | Rebindable, **reserved** |
| Pause → Controls | The full command reference | Gesture |

The two rows marked *reserved* are honest about themselves: the binding is stored and you can
change it, but nothing in the engine reads it yet. They do nothing.

`F3` is read straight off the key code by the debug layer, so it cannot be rebound.

---

## Rebinding

**Options → Controls**, or **Pause → Controls** during a match.

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
| Pointing device | Auto | Reads the shape of your scroll events. Force one if a two-finger swipe zooms instead of panning, or a wheel notch pans instead of zooming |
| Pan sensitivity | 100% | Trackpad swipe and drag pan. 100% means the ground tracks your fingers exactly |
| Zoom sensitivity | 100% | Wheel notches and pinch |
| Zoom to cursor | 75% | How strongly a zoom pulls the point under the cursor toward the centre |
| Keyboard pan speed | 42 m/s | Arrow keys and WASD at the default zoom; scales as you pull back |
| Pan momentum | On | The camera carries a little inertia and settles instead of stopping dead |
| Drag grabs the world | On | On, the ground follows your cursor. Off, the camera does |
| Invert pan — horizontal / vertical | Off | |
| Invert zoom | Off | For anyone whose scroll direction is already reversed by the OS |
| Edge scrolling | Off | See the note under Camera |

### Elsewhere in Options

The **Gameplay** tab carries Tooltips, Floating Damage Numbers, EVA Subtitles and a Screen Shake
slider. Camera and navigation are deliberately *not* there — they are on Controls, which is where
you would go looking for "why does my trackpad zoom instead of pan".

---

## What has no control at all

Stated plainly so you do not go hunting:

- **There is no player-placed map ping or marker.** The rings you see on the tactical map are
  automatic "under attack" pings.
- **There is no in-game chat.**

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
