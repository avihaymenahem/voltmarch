# Base Building

Everything you own grows out of one building. This page covers the construction vehicle, the
Construction Yard, where a structure may go, the four build queues, power and brownouts, the tech
tree, and the three things you can do to a building that is already standing: repair it, sell it,
or move it.

---

## The MCV

A **Construction Vehicle** is a building folded up and driven around. Every faction has one:

| Faction | Vehicle | Unfolds into |
| --- | --- | --- |
| Allied Forces | Construction Vehicle | Construction Yard |
| Soviet Union | Construction Vehicle | Construction Yard |
| Meridian Pact | Pactworks Carryall | Conclave |
| The Reclamation | Yardcrawler | Foundry |

All three cost **3,000 credits and 32 seconds**, and all three are gated behind the vehicle
factory only — deliberately not behind the tech building, so losing your yard never strands you
behind a prerequisite you cannot reach.

### Deploying

**Deploy unpacks the vehicle where it stands.** It is not a move order with a building on the end.
Drive it into place first, then:

- press **D**, or
- **double-click** the vehicle, or
- **right-click** the vehicle while it is already selected

The unpack takes **1.6 seconds**, during which the vehicle is immobilised and throwing dust. Then
the vehicle quietly leaves — no explosion, no wreck, no "unit lost" — and a **finished**
Construction Yard is standing there. Not a building site. Finished.

The site is checked by the same rule that governs every other placement, with one exception: **the
build radius does not apply.** An MCV is how you get your first base; requiring it to be near one
would make the opening of every match impossible.

If the ground refuses, EVA says *"Cannot deploy here"* and the vehicle is left where it was. The
reasons you will see are the placement reasons listed below, plus:

- *This unit cannot deploy* — it is not a construction vehicle (silent when it is one unit in a
  mixed selection, so an MCV escorted by four tanks does not produce four complaints)
- *Too many units* — the world is full
- *Clear a space alongside* — a structure is trying to fold back down and there is nowhere for the
  vehicle to stand

The yard's facing is snapped to the nearest quarter turn, so it still roughly faces the way the
vehicle was pointing but sits square on the grid.

### Packing back down

Any structure that a construction vehicle unfolds into can fold back into one. Select it and press
**D**. It takes 1.6 seconds and you get the vehicle back. This is the only way to move a
Construction Yard — see [Relocating](#relocating-a-structure) below.

---

## The Construction Yard and the build radius

The yard is your base. It has 2,000 hit points — among the toughest things on the field — occupies
3 × 3 cells, draws 20 power, and is the only structure that can never be darkened by a brownout.

**It is also the only structure that projects a large build radius.**

| Projected by | Radius |
| --- | --- |
| A Construction Yard (or Conclave / Foundry) | **56 m** plus its own half-width, so about **62 m** from its centre |
| Any other finished structure of yours | **20 m** plus its own half-width |

Only your **own, alive, finished** structures project anything. A building still under
construction projects nothing, and neither does an ally's.

The practical consequence is the classic C&C creep: you cannot build wherever you like, but you can
walk your base outward one structure at a time, because each thing you plant extends the legal area
by 20 metres. Cheap 1 × 1 structures — walls at 100 credits, silos at 150 — are the standard tool
for that.

**There is no build-radius circle drawn anywhere.** Not in the world, not on the tactical map. The
only feedback that you have gone too far is the ghost turning red and the refusal *"Too far from
your base"*. This is genuinely fiddly and worth knowing about in advance.

---

## The four queues

You have exactly **four production queues**, one per sidebar tab, and they belong to **you**, not
to a building.

This is Command & Conquer's model, not StarCraft's, and the difference matters:

- Every Barracks feeds the same infantry queue. A second Barracks does not give you a second
  queue — it makes the one queue **35% faster**, additively, capped at **2× overall**. So one
  factory is 100%, two is 135%, three is 170%, and four reaches the cap. A fifth buys nothing.
- Losing your last Barracks does not lose the queue. It **freezes** it, with the cameo reading
  *No factory*, and it resumes when you build another.
- Each queue holds up to **nine** items.

| Tab | Key | Serviced by |
| --- | --- | --- |
| **BLD** Structures | `B` | Construction Yard |
| **DEF** Defence | `T` | Construction Yard |
| **INF** Infantry | `I` | Barracks / Chapterhouse / Rookery |
| **VEH** Vehicles | `V` | War Factory, Naval Yard, and their equivalents |

A queue can be in one of these states, and the cameo says which:

| State | Meaning |
| --- | --- |
| *(building)* | Normal. The progress bar fills along the bottom of the cameo |
| **On hold** | You paused it. Only you can clear it |
| **Insufficient funds** | You have paid literally nothing for longer than about half a second |
| **No factory** | Every structure that services this tab is dead or still under construction |
| **READY — choose a location** | A finished structure is waiting to be placed |

### Units

A finished unit drives out of a factory on its own and heads for that factory's **rally flag**.
Every new factory gets a default flag a short walk in front of its exit, so the first unit has
somewhere to go before you ever touch it.

Move the flag by selecting the factory and right-clicking the ground, or by pressing **Y** and
clicking. Selecting only structures makes a plain right-click mean "move the rally flag" — you do
not need the key.

Aircraft lift off the pad directly. Ground units spiral outward from the factory door looking for
somewhere they fit, and retry a few times a second if the doorway is blocked. **A unit that cannot
get out blocks the queue behind it**, so keep the front of your War Factory clear.

**You cannot choose which factory a unit comes out of.** With two War Factories, the game picks
one. There is no primary-factory control in the interface.

### Structures

A finished structure does **not** jump onto your cursor. Its cameo reads **READY** and waits
indefinitely, with the queue behind it held. Clicking that cameo is what picks it up. Nothing is
lost by leaving it there — this is deliberate, so a building never lands on your pointer in the
middle of a fight.

---

## Placing a structure

With a structure on the cursor you get a translucent hologram of it and a **carpet of cells**
underneath, one square per footprint cell: **green where that cell is legal, red where it is not.**
A partly blocked footprint shows a mix, which tells you exactly which corner is the problem.

A dark band with a warm-white arrowhead marks the **front edge** — the side units will come out of.
Under the ghost, a `< ROTATE >` caption reminds you of the two rotate keys.

**Left-click places it. Right-click cancels**, and cancelling puts the structure back in the queue
still finished, costing nothing to place again.

### What makes a cell legal

Every cell of the footprint must pass all of:

| Test | Rule |
| --- | --- |
| On the map | Inside the grid, and outside the two-cell map border |
| Unoccupied | No other structure's footprint |
| Buildable ground | Not water, not a cliff, and no more than **1.1 metres** of height variation across the four-metre cell |
| Clear of bodies | No living unit's hull overlapping it — **yours or the enemy's**. Wrecks and crates are ignored; the foundation crushes them. A scenery prop only blocks if it blocks navigation |

And the footprint's **centre** must be inside one of your build radii.

Fog of war is **not** checked. You can plant a building on ground you have never explored, as long
as it is inside your radius.

### The refusal messages

The worst problem across the footprint wins:

| Message | Means |
| --- | --- |
| *Off the map* | Part of the footprint is outside the playable area |
| *Ground is not flat enough* | Slope, height variation, **or water** — there is no separate water message |
| *Something is already there* | Another structure's footprint |
| *Clear your units off the site* | A unit is standing on it |
| *Too far from your base* | Outside every build radius you own |

If you click anyway, the order is still sent and EVA answers *"Cannot deploy here."* The ghost is
dropped for a fresh build; a refused **relocation** stays on the cursor so you can try again.

### Rotation

`,` turns the ghost a quarter turn anticlockwise, `.` clockwise. Quarter turns only — the
occupancy grid can only express cell-aligned rectangles.

**At 90° and 270° the footprint swaps.** A 3 × 2 War Factory takes 2 × 3 cells, and the carpet
changes shape with it in the same frame.

**The facing sticks** for the next structure you place. That is how a line of walls or defences all
ends up pointing the same way. Picking up an existing building to relocate adopts *that* building's
facing instead.

### Walls

There is no line-drag wall tool. Walls are ordinary 1 × 1 structures placed one click at a time —
100 credits, two seconds each. The only concession to wall-laying is the sticky facing. A **Gate**
(150 credits) is a way through your own wall that friendly units can pass.

---

## Power and brownouts

Power plants supply. Most other structures draw. There is no upkeep in credits — power is bought
once, when you build the plant.

| | Cost | Time | Output |
| --- | --- | --- | --- |
| Power Plant (Allies / Soviets) | 300 | 8 s | **+100** |
| Solar Array (Meridian) | 350 | 8 s | **+160** |
| Scrap Furnace (Reclamation) | 240 | 7 s | **+80** |

The shape of those three numbers *is* the faction. One Solar Array opens the Pact's Chapterhouse
where the other armies need a second plant — and it has 420 hit points against a Power Plant's 800.

Typical draws: Construction Yard 20, Barracks 20, Ore Silo 10, Ore Refinery 30, Naval Yard 30,
Repair Depot 30, Radar 40, War Factory 40, Battle Lab 60, Tesla Coil 75, Arc Pylon 90,
any superweapon 150.

### What a deficit costs you

Two things at once, and the double bind is the whole point of the system.

**1. Everything you build gets slower.** Your build speed multiplier is a continuous function of
your supply ratio: 100% at parity, sliding down to **25%** with no supply at all. It never reaches
zero, because a queue that stopped dead while your only power plant was on fire would be a soft
lock with no way out.

**2. Structures go dark, in a fixed order.** The deficit picks victims until their combined draw
covers the shortfall. Within each class, the biggest consumer goes first.

| Order | Class |
| --- | --- |
| 1 | Defences |
| 2 | Radar |
| 3 | Tech buildings |
| 4 | Factories |
| 5 | Refineries |
| never | **The Construction Yard** |

A 20-point deficit kills one emplacement. A 300-point deficit takes your whole defensive line and
your radar with it. **A dark defence does not shoot.** A dark radar means the tactical map stops
showing the enemy.

Two things that are *not* true, and are worth knowing:

- **Darkening a structure does not remove its draw.** If it did, the grid would heal itself the
  instant it broke and you would never need a second reactor.
- **A brownout does not revoke a prerequisite.** You can still build everything the darkened
  structure unlocked. Gating construction on power would soft-lock a player whose only route out of
  a blackout is the power plant they were now forbidden from building.

The HUD tells you where you stand with a one-word chip: **OPTIMAL**, **STRAINED** (above 86% of
supply — the next building will tip you over) or **BROWNOUT**.

---

## The tech tree

Three tiers, never four. RA2's real shape: power, then economy, then army, then one tech building
that opens the top of every tab at once.

### Allied Forces and Soviet Union

Both armies share the same spine and differ in the leaves.

| Structure | Cost | Time | Power | Size | Requires |
| --- | --- | --- | --- | --- | --- |
| Construction Yard | 3,000 | 40 s | −20 | 3×3 | *(deployed from an MCV)* |
| Power Plant | 300 | 8 s | +100 | 2×2 | Construction Yard |
| Ore Refinery | 2,000 | 24 s | −30 | 3×2 | Power Plant |
| Barracks | 500 | 10 s | −20 | 2×2 | Power Plant |
| War Factory | 2,000 | 24 s | −40 | 3×2 | Ore Refinery |
| Radar Dome | 1,000 | 14 s | −40 | 2×2 | Ore Refinery |
| Ore Silo | 150 | 5 s | −10 | 1×1 | Ore Refinery |
| Naval Yard *(Allies)* / Naval Pen *(Soviets)* | 1,000 | 14 s | −30 | 3×3 | Ore Refinery |
| Repair Depot | 800 | 10 s | −30 | 2×2 | War Factory |
| Battle Lab | 2,000 | 24 s | −60 | 2×2 | Radar Dome |

Defences:

| Structure | Faction | Cost | Time | Power | Requires |
| --- | --- | --- | --- | --- | --- |
| Concrete Wall | both | 100 | 2 s | — | Barracks |
| Gate | both | 150 | 3 s | — | Barracks |
| Pillbox | Allies | 400 | 8 s | — | Barracks |
| Sentry Gun | Soviets | 400 | 8 s | — | Barracks |
| Flame Tower | Soviets | 600 | 10 s | −20 | Barracks |
| Multigunner AA | Allies | 800 | 12 s | −30 | Radar Dome |
| Prism Tower | Allies | 1,500 | 16 s | −50 | Battle Lab |
| Tesla Coil | Soviets | 1,500 | 16 s | −75 | Radar Dome |

Note that the Pillbox, the Sentry Gun and the walls draw **no power at all** and therefore cannot
be browned out. The Tesla Coil draws 75 and is first in the shedding order — it is the structure
the phrase "dies in a brownout" was written for.

### Meridian Pact

| Structure | Cost | Time | Power | Size | Requires |
| --- | --- | --- | --- | --- | --- |
| Conclave | 3,000 | 40 s | −20 | 3×3 | *(deployed)* |
| Solar Array | 350 | 8 s | **+160** | 2×2 | Conclave |
| Ore Cistern | 2,000 | 24 s | −30 | 3×2 | Solar Array |
| Chapterhouse | 500 | 10 s | −20 | 2×2 | Solar Array |
| Forgeyard | 2,000 | 24 s | −40 | 3×2 | Ore Cistern |
| Oculus | 1,000 | 14 s | −40 | 2×2 | Ore Cistern |
| Sun Vault | 150 | 5 s | −10 | 1×1 | Ore Cistern |
| Slipway | 1,000 | 14 s | −30 | 3×3 | Ore Cistern |
| Solar Infirmary | 800 | 10 s | −30 | 2×2 | Forgeyard |
| Reliquary | 2,000 | 24 s | −60 | 2×2 | Oculus |
| Rampart *(wall)* | 100 | 2 s | — | 1×1 | Chapterhouse |
| Glaive Post | 450 | 8 s | −10 | 1×1 | Chapterhouse |
| Helios Spire | 1,500 | 16 s | −55 | 1×1 | Reliquary |

### The Reclamation

Read the Requires column, because it is the whole faction: the Arcspitter and the Grinder need
**only** the Breaker Yard. Four structures and the Reclamation's line army exists, where an Allied
or Soviet player needs six before a Grizzly. It pays for that tempo with an 80-power plant and the
softest hulls in the game.

| Structure | Cost | Time | Power | Size | Requires |
| --- | --- | --- | --- | --- | --- |
| Foundry | 3,000 | 40 s | −20 | 3×3 | *(deployed)* |
| Scrap Furnace | 240 | 7 s | **+80** | 2×2 | Foundry |
| Ore Sorter | 2,000 | 24 s | −30 | 3×2 | Scrap Furnace |
| Rookery | 450 | 9 s | −20 | 2×2 | Scrap Furnace |
| Breaker Yard | 1,900 | 22 s | −40 | 3×2 | Ore Sorter |
| Spotter Mast | 1,000 | 14 s | −40 | 2×2 | Ore Sorter |
| Slag Heap | 150 | 5 s | −10 | 1×1 | Ore Sorter |
| Breaker Dock | 1,000 | 14 s | −30 | 3×3 | Ore Sorter |
| Patch Yard | 800 | 10 s | −30 | 2×2 | Breaker Yard |
| Crucible | 2,000 | 24 s | −60 | 2×2 | Spotter Mast |
| Scrap Barricade *(wall)* | 100 | 2 s | — | 1×1 | Rookery |
| Spitpost | 420 | 8 s | — | 1×1 | Rookery |
| Arc Pylon | 1,450 | 16 s | −90 | 1×1 | Spotter Mast |

The Spitpost draws no power at all — it *"fires through a blackout"*, which no other faction's
mid-tier emplacement does.

### Why a cameo is greyed out

Hover it. The description strip at the foot of the build rail prints the actual reason in amber,
and the tooltip repeats it:

| Reason | Means |
| --- | --- |
| *Requires Ore Refinery* | You are missing that structure. It names the first one it finds missing |
| *Requires a Construction Yard* | You have no yard (Structures and Defence tabs) |
| *Requires a production structure* | You have no factory for that tab |
| *Insufficient funds* | You have the tech but not the money |
| *You already have a Field Marshal* | Commanders are one at a time |
| *Locked* | A progression gate — complete missions to unlock it |

---

## Repairing

Structures and vehicles are repaired by two completely different mechanisms.

### Structures — the wrench

Arm the **repair tool** in the sidebar, then click one of your structures to start or stop mending
it. Right-click or Escape disarms the tool. You can arm it once and toggle several buildings.

- **30 hit points per second**, flat
- **0.25 credits per hit point**, charged continuously — so **7.5 credits per second**
- Running out of money **stops the repair** rather than healing free. A partial payment heals a
  proportional amount
- You can repair a building while it is being shot at. Nothing checks for combat
- The selection panel tags a mending structure **Repairing** and the health bar gets a green sweep

The tool silently does nothing on a building that is not yours, not finished, or already at full
health. There is no message for those.

An **Engineer** (or Artificer / Tinker) can also repair: right-click a damaged friendly structure
with one selected and it walks in.

### Vehicles — the Repair Depot

800 credits, 10 seconds, −30 power, needs a vehicle factory. It has **no order, no button and no
interface**: park a damaged vehicle you own within **10 metres** of one and it is serviced.

- **10% of the vehicle's maximum health per second** — so a full hull in about ten seconds,
  regardless of whether it is a 190-hit-point scout or an 800-hit-point Apocalypse
- The same **0.25 credits per hit point**
- **Eight** vehicles at once per depot
- A depot that is unfinished, dying, or **dark from a brownout** services nothing

---

## Selling

Arm the **sell tool**, then click one of your structures. **There is no confirmation.** The sell is
instantaneous and irreversible on the click, and the armed sell cursor is deliberately red.

- You get back **half** the build cost. A partly built structure refunds against the fraction
  actually built, so place-sell-repeat cannot print money
- The structure coughs up a **crew**: one to four line infantry, scaled by footprint area, who
  appear ringed around the site and run
- EVA says *"Structure sold."*

**Selling a damaged building before it dies is how you keep half the cost.** A structure at 5%
health is worth exactly as much sold as one at 100%.

### The one sell that is refused

You may sell your Construction Yard — but **not if it is your last way to build**. If selling it
would leave you with no producing structure *and* no construction vehicle to unpack, the game
refuses with a toast titled *"Cannot sell"* reading *"<Name> is your last way to build. Selling it
would end the match."*

The classic play — sell the yard because you already have an MCV parked next to it — still works.

---

## Relocating a structure

You can pick up a building that is already standing and put it somewhere else.

Select **exactly one** of your own finished structures. A **Relocate** row appears on the selection
panel with the fee printed on the button. Click it, and the building goes onto your cursor as an
ordinary placement ghost. Left-click the new site to commit; right-click or Escape cancels and
nothing at all happens.

Nothing is charged and nothing moves until you commit. The building keeps standing, shooting and
producing the whole time you are choosing.

| | |
| --- | --- |
| Fee | **35%** of build cost, minimum 50 credits. A 2,000-credit War Factory costs 700 to move |
| Time in transit | **4 seconds**, plus 2 seconds to rise at the far end |
| Charged | once, atomically, after every check has passed |
| Refunded | in full if the move cannot be completed |

**While in transit the structure is nowhere at all.** No power, no production, no prerequisite, no
vision, no target. Moving a Power Plant browns out your base for six seconds; moving your only
Barracks locks infantry out behind its own prerequisite for six seconds.

It keeps its **health as a fraction** (you move a wreck, you get a wreck — this is deliberate, so
that 35% of cost is not the cheapest repair in the game), its veterancy, its rally point, and its
repair drip. It does **not** keep a build queue, and because it leaves quietly there is **no refund
and no free crew** the way a sale gives you.

The button stays visible and greyed with the reason as its tooltip rather than vanishing:

| Refusal | Means |
| --- | --- |
| *Select one of your own structures* | |
| *Wait until it is finished* | Still under construction, deploying, or being sold |
| *Pack it into its vehicle and drive it* | **A Construction Yard cannot be relocated.** Fold it back into an MCV and drive it — that route already exists, the opponent can see it crossing the map, and a yard that teleported would strand every structure whose build radius it was providing |
| *Evacuate the garrison first* | Infantry are inside it |
| *Not while the superweapon is charging* | A finished charge is banked and does not block the move |
| *Insufficient funds* | |
| *Cannot relocate here* | The destination fails the placement rule |

Two details of the destination rule are worth knowing. Your own footprint is exempt ground, so a
two-cell nudge is not refused for colliding with itself. And the structure does **not** project a
build radius around itself while it is being moved — otherwise a building could walk across the map
one hop at a time. The new site has to be covered by the rest of your base.

If the site is taken while the building is in transit, it retries for two seconds — long enough for
a tank to drive off — and then **goes home and refunds the fee**. It is never simply lost.

---

## Superweapons

Every faction has one buildable superweapon structure, gated behind its tech building.

| Structure | Faction | Cost | Time | Power | Requires | Weapon | Charge |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Nuclear Missile Silo | Soviets | 2,500 | 32 s | −150 | Battle Lab | Nuclear Missile | 7:00 |
| Iron Curtain Device | Soviets | 2,000 | 28 s | −150 | Battle Lab | Iron Curtain | 5:00 |
| Chronosphere | Allies | 2,000 | 28 s | −150 | Battle Lab | Chronosphere | 5:00 |
| Weather Control Device | Allies | 2,500 | 32 s | −150 | Battle Lab | Lightning Storm | 6:40 |
| Heliograph | Meridian | 2,500 | 32 s | −150 | Reliquary | Solar Lance | 7:00 |
| Stormworks | Reclamation | 2,500 | 32 s | −150 | Crucible | Arc Storm | 6:40 |

All six are **3 × 3** — the same footprint as a Construction Yard, and taller than the Radar Dome.
That is on purpose: this is the only structure in the game that decides a match on its own, and an
opponent has to be able to read that it exists from the far side of the map.

**150 power each** is more than a Power Plant makes. Budget a reactor for it before you start.

### The countdown

Once one is standing, a small dock appears **just left of the build rail, above the selection
panel**, with one row per superweapon: the weapon's name, a charge bar filling behind it, and the
time remaining. When it finishes charging the time is replaced by **READY** and the row flashes.

- **Charge only advances while the structure is standing, finished and lit.** A dark superweapon
  charges nothing. Lose the building and the countdown stops where it is
- **A second silo is a spare, not a second charge**
- Firing resets the charge to full

### Firing

Click the ready row. The row arms and a toast tells you *"Pick a target on the map."* Then click
the ground.

The Chronosphere is the exception: it wants **two** clicks — a source point, then a destination —
because it lifts up to nine of your units out of one place and sets them down in another.

Radii, for aiming: Nuclear Missile 26 m, Solar Lance 24 m, Arc Storm 17 m, Lightning Storm 16 m,
Iron Curtain 13 m, Chronosphere 11 m. The nuke and the Solar Lance are announced before they land.

For what each one actually does to what it hits, see [Combat](/avihaymenahem/voltmarch/wiki/Combat).

---

See also: [How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) · [Economy](/avihaymenahem/voltmarch/wiki/Economy) · [Controls](/avihaymenahem/voltmarch/wiki/Controls) · [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs)
