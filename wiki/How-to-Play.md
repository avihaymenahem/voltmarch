# How to Play

Your first fifteen minutes. This page covers starting a match, reading the screen, giving orders,
and the shape a match takes from the opening to the end of it.

If you have played Command & Conquer, most of this will be familiar and you can skim to
[Controls](/avihaymenahem/voltmarch/wiki/Controls). If you have never played a real-time strategy game, read it in order.

---

## Starting a match

The main menu offers **Tutorial**, **Campaign**, **Skirmish**, **Multiplayer**,
**Service Record**, **Load Game**, **Replays**, **Settings** and **Support**. The top-right Support
button opens the VOLTMARCH Discord, while **News & Events** opens the live command feed and release status.
After the Tutorial is completed its menu item is hidden;
**Settings → Gameplay → Training → Restore Tutorial** brings it back without erasing the rest of
the profile. The commander identity button opens the Service Record, which holds lifetime stats, faction wins,
operation totals and the honours collection; its **View Missions** action opens the complete progression
catalogue. The credits are a tab inside Settings.

**Campaign** is the story mode — authored operations with a briefing, a fixed map, fixed objectives
and a medal. Thirty-seven of them, across four chapters:
[Campaign](/avihaymenahem/voltmarch/wiki/Campaign) lists every one, and says why none of them
advances your missions or unlocks.

The **Tutorial** is a 26-step, spotlit field school that watches a real match and points at the
thing it is talking about. Its first half covers camera movement, selection, control groups,
orders, stances, formations, MCV deployment, power, ore, production and rally points. Its second
half teaches the verbs that make VOLTMARCH distinct: garrisoning civilian cover, engineer capture,
repair and sell, amphibious transports, commander abilities, base-wide powers, superweapons and
veterancy. It runs on Contested Strait so the civilian and naval lessons have real targets, opens
the complete training roster without changing your profile, and gives you 30,000 training credits
so late-tech instruction is not an ore waiting room. Every lesson is still skippable.

**Skirmish** is a single match against the computer. The setup screen has four blocks:

| Block | What you choose |
| --- | --- |
| **Your Faction** | Allied Forces, Soviet Union, Meridian Pact, The Reclamation |
| **Opponent** | Enemy faction (mirror matches allowed), difficulty, and an AI personality that "biases the AI's strategy scoring, not its rules" |
| **Battlefield** | Temperate Valley and Airbase Flats are available from the start; four more are locked behind missions |
| **Rules** | Starting condition, starting credits, game speed, opponent tech, map seed |

Two of the Rules matter more than the rest.

**Starting Condition** is either **Construction Vehicle** or **Pre-built Base**.

- *Construction Vehicle* — you get one construction vehicle and a small escort (three to five
  infantry and one or two tanks, depending on faction) and nothing else. No power, no refinery,
  no harvester. This is the default and it is the honest version of the game.
- *Pre-built Base* — yard, power, refinery, factories and defences already standing, with
  harvesters already working. It skips the first three minutes.

**Starting Credits** offers 2,000 / 5,000 / 10,000 / 20,000 / 50,000, defaulting to **10,000**.
From a construction vehicle the 2,000 option is withheld: with no income until a refinery stands,
5,000 is the smallest bank that can reach one.

**Map Seed** is worth knowing about. The same seed produces the same battle — same terrain, same
ore, same everything. Set it deliberately if you want to replay a start.

Skirmish game speed can be set as high as **2.5×**. The in-match speed binding cycles 0.5×, 1×,
1.5×, 2× and 2.5×; multiplayer remains fixed at 1×.

---

## The screen

Take a moment before you touch anything. Nothing on the HUD is decorative.

```
 ┌──────────────────────────────────────────────────────────────┐
 │ toasts        ══ resource strip ══            OBJECTIVES     │
 │                                                              │
 │                                                     ┌──────┐ │
 │                                                     │ BUILD│ │
 │                     the battlefield                 │ RAIL │ │
 │                                                     │      │ │
 │                                          ┌────────┐ │      │ │
 │ ┌─────┐ ┌──────────────────────────────┐ │ SUPERS │ └──────┘ │
 │ │ MAP │ │       SELECTION              │ └────────┘          │
 │ └─────┘ └──────────────────────────────┘                     │
 └──────────────────────────────────────────────────────────────┘
```

### The resource strip (top centre)

Left to right: your faction crest, then

- **Credits** — a rolling counter that travels toward the true balance rather than snapping, so
  banking a load visibly spins. A green `+250` or red `-1000` flies off it whenever the balance
  changes.
- **Power — draw / supply** — a fourteen-segment meter, the raw numbers as `draw/supply`, and a
  one-word state chip: **OPTIMAL**, **STRAINED** (you are above 86% of supply, the next building
  will tip you over) or **BROWNOUT** (draw exceeds supply). The chip pulses red in a brownout.
- **Time** — elapsed match time, counting up, `MM:SS`.

On displays wider than about 1180 px three more readouts appear: **Army** (living infantry and
vehicles you own), **Base** (completed structures you own) and **Income / min** (credits per
minute, rounded to the nearest ten, green when it is actually running). Below that width they
are hidden to keep the strip from crowding the battlefield.

There is no storage readout on the strip. If you want to know how close you are to your credit
cap, watch for the **Silos needed** toast — see [Economy](/avihaymenahem/voltmarch/wiki/Economy).

### The build rail (right)

Four tabs — **BLD** (Structures), **DEF** (Defence), **INF** (Infantry), **VEH** (Vehicles) —
over a two-column grid of cameos, over a permanently visible description strip.

Every cameo is a small 3-D render of the thing itself. It can carry, all at once:

| Badge | Where | Meaning |
| --- | --- | --- |
| Cost | bottom left | Credits. Turns amber when you cannot afford it |
| Hotkey letter | top right | Only the first ten slots have one |
| Queue count | top left | How many are queued, including the one being built |
| ETA | bottom right | `M:SS` at the rate it is actually building, not the nominal one |
| Owned count | bottom right | How many you already have — replaced by the ETA while building |
| **READY** | across the bottom | A finished structure waiting for you to place it |
| Progress bar | along the bottom edge | A flat bar, not a clock wipe |

An item you cannot build yet is dimmed, not disabled — you can still hover it. It carries a
banner reading **Locked**, **Funds** or **Power**, and the description strip at the foot of the
rail swaps the blurb for the actual reason in amber, e.g. *"Requires Ore Refinery"*.

At the right end of the tab strip are the only two tool buttons in the game: a **wrench**
(*"Repair structure — click a damaged building"*) and a **dollar sign** (*"Sell structure — click
a building to refund it"*). Arming either changes the cursor. Armed sell is red, because it is
destructive. Both are covered in [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building).

### The tactical map (bottom left)

Titled **MAP**. It draws terrain, water, ore in gold, your structures as territory glows, units
as small blips, attack pings as expanding rings, and your camera's viewport as an outlined
rectangle. Click it to jump the camera there; drag to scrub the camera across the field.

Right-click it with units selected to issue the same contextual order as a battlefield
right-click: move on ground, attack a visible hostile, capture with an engineer, repair a friendly
target, and so on. Shift queues, Ctrl force-fires and Alt force-moves. In mixed co-op, a right-click
that produces no unit order falls back to a teammate ping.

Without a working Radar Dome it goes grey, the title is replaced by a red **NO RADAR**, and the
field carries **RADAR OFFLINE / Build a Radar Dome**. It is not blank — you still see your own
units and buildings. What you lose is the enemy.

### The selection dock (bottom, next to the map)

With nothing selected it shrinks to a single line. That line is a live advisory, not decoration:

- *Select a unit or a structure to command it* — everything is fine
- *Low power — every queue is running slow. Build a power plant*
- *Power is tight — the next structure will brown you out*
- *No ore income — check your harvesters and refinery*
- *No radar. Build a Radar Dome to see enemy movement*
- *No combat units in the field*
- *Base under attack — check the tactical map*
- *No structures. Deploy an MCV to found a base*

With something selected it shows the name (or **MIXED FORCE**), a count, a scrolling row of unit
cards, four armour/damage/range/speed chips, and a health bar with the absolute total written
over it. A compact tactics strip beside the selection keeps stance and formation actions available
without doubling the panel's height. Depending on what is selected you also get:

- **Stance** — four buttons, covered below
- **Relocate** — for exactly one owned structure; see [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building)
- **Ability** — for exactly one commander; prints the ability name when ready and a countdown
  in seconds while cooling
- **Cargo / Unload** — for any selected hulls with a hold, summed across all of them; see
  [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs)
- **Evacuate** — for any selected structures with somebody garrisoned inside

The tactics strip adds four formation diagrams whenever at least two mobile units are selected:
**Line**, **Rectangle**, **V**, and **Triangle**. Clicking one immediately arranges the group around
its current centre. Later group moves preserve the resulting shape; **Scatter** deliberately breaks it.

### Objectives (top left) and toasts

The objectives panel mixes three clearly labelled kinds of work: **MAIN** match priorities,
optional **SIDE** challenges, and long-running **GLOBAL** Service Record goals. Match objectives can
shape the current battle; global goals continue across games. Drag the panel's lower edge to choose
how much of the board stays visible—the height is remembered on this device, and overflow scrolls
without squeezing or overlapping rows.

Toasts carry battlefield alerts and repeat events merge into one colour-coded chip rather than
stacking up. Spoken EVA and unit responses also have a dedicated bottom-centre subtitle strip when
**Voice Subtitles** is enabled, so captions never displace an attack warning or objective update.

---

## Selecting things

| You want | Do this |
| --- | --- |
| One unit or building | Left-click it. A unit parked on a pad beats the building under it |
| A group | Left-drag a marquee. If the box contains any of your own mobile units, only those come back — dragging over your base never hands you six buildings you cannot order |
| Everything of one type on screen | Double-click one of them. It deliberately stops at the screen edge |
| Add to what you have | Hold Shift while clicking or dragging |
| Drop one out | Hold Ctrl and click it |
| Your whole army | Ctrl+A. Structures are never included |
| Nothing | Left-click bare ground |

**Escape does not clear the selection.** It first cancels a live placement, repair/sell tool or armed
order; with no modal battlefield action active it opens pause. Click empty ground to clear selection.

Control groups work the way you expect: **Ctrl + a digit** stores the current selection as that
group, the **digit alone** recalls it, and **tapping the same digit twice quickly** centres the
camera on it. Ten groups, 0 through 9.

---

## Giving orders

**Right-click is the whole game.** What it means comes entirely from what is under the cursor, and
the cursor tells you which it will be *before* you click — the pointer and the order come from one
function, so the pointer cannot promise something the unit will not do.

The rules, in priority order:

| Under the cursor | With this selected | Result |
| --- | --- | --- |
| Anything | An armed mode (A / F / Y) | That mode fires |
| Anything | Ctrl held, with something armed selected | Force-fire on that point, even your own units, even into shroud |
| Anything | Alt held | A plain move, ignoring whatever is there |
| Ground | Only structures that produce | Move the rally flag |
| Your own construction vehicle | Construction vehicles | Deploy it |
| An enemy structure | An engineer | Capture |
| An enemy | Anything armed | Attack |
| An enemy | Nothing armed | Walk there anyway |
| Your own hull with a hold | Infantry, plus any vehicles selected with them | Board it — and the hull comes to the shore to collect them |
| A neutral civilian structure | An engineer | Capture it permanently |
| A neutral civilian structure | Infantry | Garrison it |
| A damaged friendly structure | An engineer | Walk in and repair it |
| Your own refinery | A harvester | Go and unload |
| Ore | A harvester | Mine there |
| Plain ground | Anything mobile | Move |

Two things worth internalising early:

- **Right-click is always an order during a match.** Camera drag uses middle-drag or
  `Space`+left-drag, so a small hand movement cannot turn a command into a camera pan.
- **A right-click cancels an armed mode** instead of firing it. Attack-move, force-fire and rally
  are therefore safe to press speculatively — if you change your mind, right-click.

**Shift queues.** Hold Shift while ordering and the order is appended rather than replacing what
the unit was doing. Up to eight waypoints per unit; each starts when the previous is reached.

### Stances

Every mobile unit has one of four stances. Press **Z** to cycle, or click one of the four icons
under the selection panel to set it directly.

| Stance | Behaviour |
| --- | --- |
| Aggressive | Chase targets of opportunity |
| Defensive | Fire at anything in range, never leave position |
| Hold fire | Move to the target but never fire unless force-fired |
| Hold ground | Fire freely, but never move for any reason |

Z cycles in that order. The four buttons are drawn Aggressive, Defensive, Hold ground, Hold fire,
which is a different order — click the one you want rather than counting.

---

## The shape of a match

### Minute zero to one — get a base down

From a construction vehicle start you have an MCV, an escort, and 10,000 credits.

Drive the MCV somewhere worth building. "Worth building" means near ore and not in a valley the
enemy overlooks. **Deploy unpacks it where it stands** — it is not a move order with a building on
the end. Drive first, then press **D**, or double-click the vehicle, or right-click it while it is
selected. The unpack takes 1.6 seconds and you get a *finished* Construction Yard, not a building
site.

The instant it lands you are in **BROWNOUT**: the yard draws 20 power and nothing supplies any.
Everything you build runs at a quarter speed until you fix that, which is the game telling you
what to build first.

### Minute one to three — power, then ore

Build a **Power Plant** (300 credits, 8 seconds, +100 power). At a quarter speed that first one
takes about 32 seconds. Place it, and the brownout clears.

Then the **Ore Refinery** (2,000 credits, 24 seconds). It **ships with a free harvester** — no
charge, no queue slot, no build time — which is the only reason the opening works at all. The
harvester finds ore on its own and starts a loop you should mostly leave alone.

A **Barracks** (500 credits) unlocks infantry and, more importantly, unlocks walls and your
faction's cheap defensive emplacement.

The AI's own opening for the Allies and Soviets is: power plant, refinery, barracks, war factory,
a second power plant, radar, ore silo, proving ground. It is a perfectly good opening for you too.

### Minute three to eight — an army and a second harvester

The **War Factory** (2,000 credits) needs a refinery standing and is the gate to everything with
tracks — including more harvesters at 1,400 each, and a replacement MCV at 3,000.

More harvesters is almost always the right answer to "what should I build". More refineries is the
answer after that: a second refinery is a second dock, a second free harvester, and 2,000 more
credits of storage.

**Radar Dome** (1,000 credits) turns the tactical map back on and opens tier two of every tab.

### Minute eight onward — tech and pressure

The **Proving Ground** (2,000 credits, needs Radar) opens the top of every tab at once — the
specialist tank, the specialist defence, the capital ship, and the superweapons. The tree is
deliberately shallow: three tiers, never four.

By now you should be attacking. Use **attack-move** (**A**, then click) rather than plain move for
anything crossing the map: an attack-moving column engages what it meets instead of driving past
the fight and dying at the far end of it.

### How a match ends

There is no timer and no score threshold. The match resolves on **viability**, checked twice a
second after a ten-second opening grace:

- **You lose immediately** if you own no buildings and no units at all.
- **You are STRANDED** — warned, repeatedly, not ended — if you have units but nothing that can
  build. The toast reads *"Nothing left that can build. Destroy the enemy or the match is lost."*
  An army with no base can still walk into the enemy's and win, so the game does not take that
  away from you.
- **You are BEATEN** when you have nothing that can build *and* nothing but harvesters left.
  There is no sequence of inputs that changes the result from there. Held for eight seconds, so a
  mid-deploy blink cannot trigger it, then the match resolves.

Victory is the same test applied to everyone else: when every hostile player has been beaten for
eight consecutive seconds, you win. When both sides are finished at once, the one still standing
gets the better ending.

---

## Where to go next

- [Controls](/avihaymenahem/voltmarch/wiki/Controls) — every binding, and which of them you can change
- [Economy](/avihaymenahem/voltmarch/wiki/Economy) — ore, harvesters, credits, storage, income
- [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building) — placement, power, the tech tree, repair, sell, relocate
- [Combat](/avihaymenahem/voltmarch/wiki/Combat) — armour, damage, veterancy, crushing, garrisons
- [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) — transports, capture, aircraft, commander abilities
