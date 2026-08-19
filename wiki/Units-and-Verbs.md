# Units and Verbs

Every special thing a unit or a structure can do, what it is for, and how to do
it. For damage, armour and targeting see [Combat](/avihaymenahem/voltmarch/wiki/Combat); for the full key list
see [Controls](/avihaymenahem/voltmarch/wiki/Controls).

---

## The verbs at a glance

| Verb | How | Who |
|---|---|---|
| Attack-move | **A**, then click | Anything that shoots |
| Force-fire | **F**, or Ctrl + right-click | Anything that shoots |
| Force-move | Alt + right-click | Anything that moves |
| Stop | **S** | Anything, structures included |
| Guard | **G** | Anything that moves |
| Scatter | **X** | Anything that moves |
| Cycle stance | **Z** | Anything that moves |
| Deploy / Unload / Evacuate | **D** | Construction vehicles, loaded hulls, occupied structures |
| Set rally point | **Y**, or right-click with only factories selected | Factories |
| Capture | Right-click an enemy or neutral structure | Engineers |
| Repair a structure | Right-click a damaged friendly structure | Engineers |
| Garrison | Right-click a garrisonable structure | Infantry |
| Evacuate a garrison | **D**, or the button on the selection panel | Occupied structures |
| Board a carrier | Right-click a friendly hull with a hold | Infantry, and any vehicles selected with them |
| Harvest | Right-click ore, or your own refinery | Harvesters |
| Commander ability | **Shift + F**, or the button on the selection panel | Commanders |
| Repair tool / Sell tool | Sidebar buttons, then click a structure | Any structure |
| Relocate | Button on the selection panel | Most structures |
| Fire a superweapon | Click its countdown, then click the ground | The owning player |

**The right-click cursor never lies.** One rule set produces both the cursor and
the order, so if the pointer promises a capture, a capture is what gets issued.
Priority, highest first: armed mode (A/F/Y) → Ctrl force-fire → Alt force-move →
rally flag if only structures are selected → whatever is under the cursor →
ore → plain ground.

### What a fresh profile cannot do yet

Some of the verbs below are behind mission unlocks, and on a brand-new profile
they simply are not in the sidebar. See [Campaign](/avihaymenahem/voltmarch/wiki/Campaign) for which mission
pays out what.

| Locked at the start | What it takes away |
|---|---|
| The tech building (Proving Ground, Reliquary, Crucible) | **Every superweapon**, and every tier-3 unit |
| The air tier | All four aircraft |
| The AA emplacement | The Allied AA Battery |

Everything else — engineers, garrisons, deploy, harvesting, repair, sell,
relocate, crushing, crates and all four commanders — is available in your very
first skirmish.

**The navy is not one of them.** Docks, landing ships, carriers, recon hulls and
the swimmer infantry are all buildable on a fresh profile; the only naval gate
left is in the match, where a capital ship still needs your army's tech
building and every hull still needs a dock standing on a real coast. Three
missions used to pay those unlocks out and now pay cosmetics instead — see
[Campaign](/avihaymenahem/voltmarch/wiki/Campaign). The **Sandskiff** is still
behind the raider unlock, but it is a raider that happens to hold two, not the
Pact's only way across water.

---

## Engineer capture

Every army has one, they all cost **500**, they are all unarmed, and they are
all consumed by whatever they do.

| Unit | Army |
|---|---|
| Engineer | Allies and Soviets |
| Artificer | Meridian Pact |
| Tinker | The Reclamation |

Right-click a structure with an engineer selected. What happens depends on whose
it is:

**A neutral structure is taken outright, at any health.** Oil derricks,
hospitals and apartment blocks flip to you the moment the engineer walks in.
This is the cheapest thing an engineer ever does and it is what makes the middle
of the map worth walking to.

**An enemy structure is only captured at or below 50% health.** Above that, the
engineer is spent "softening" it: it knocks **25% of max HP** off and dies in the
attempt. So a full-health Construction Yard costs exactly three engineers
(100% → 75% → 50% → captured) and a yard your tanks already chewed on costs one.
Bring the engineer *after* the push, not with it.

**A damaged friendly structure is repaired to full instantly**, and the engineer
is consumed. An undamaged one refuses the order and hands the engineer back
rather than silently eating 500 credits.

**Refusals:** a structure still under construction, and any structure with
somebody garrisoned inside it. Clear the garrison first — that is the whole
tactical point of holding one.

### What a captured building gives you

- Its production, its prerequisites and its build radius, immediately.
- Its storage capacity, if it is a refinery or a silo.
- **Its income, if it is a refinery.** Ore is sold at the dock that takes it and the money goes to
  whoever holds that dock's deed — so a hopper already emptying into the bay when you take it pays
  *you*, not the previous owner. Their other harvesters turn round and drive home; a refinery is a
  place, not a fleet.
- It is **never** automatically your primary factory.
- Its rally point is discarded.

**It does not change how it looks.** A captured Soviet Power Plant still looks
like a Soviet Power Plant, in Soviet colours. Two things are going on, and
neither of them repaints it:

- The **model** is bound once at spawn, and capture does not re-bind it.
- The **team colour** does follow the new owner as far as the render data goes,
  but on a structure that value is only ever spent on the selection glow. Team
  markings on a building come out of a per-faction texture baked at build time,
  so they stay whatever they were.

**The minimap blip is the reliable tell** — it turns from neutral grey to the
holder's colour the moment the deed changes. If you are trying to work out who
owns a distant building, that is what to look at.

---

## Garrisoning structures

Infantry can occupy a structure and shoot out of it. Right-click a garrisonable
building with infantry selected.

**What can be garrisoned:** any structure that is finished, unarmed, at least
2 cells on both axes, and not a Construction Yard, factory, refinery or radar.
In practice that is:

- the three **neutral civilian buildings** — Oil Derrick, Civilian Hospital,
  Apartment Block;
- your own Power Plant, Ore Silo and Proving Ground.

**Capacity is 5 men.** A sixth is refused and stays outside.

**What a garrison does:**

- The **building** fires, not the men. One target, one volley, at **90% of the
  summed damage** of everyone inside, on the cooldown of the longest-ranged
  rifle in the room.
- It gets **+6 m of range** over that rifle. Five G.I.s in a hospital reach 24 m.
- Occupants vanish from the field. Nothing can target them, nothing can crush
  them, they do not block anything.
- **A neutral building flies your flag while you hold it**, and reverts to
  neutral the instant the last man leaves or dies.
- **Killing the building kills everyone inside**, quietly — no five separate
  fireballs, but five entries on your losses.
- An occupied structure cannot be captured by an enemy engineer.

**They can be turned out again.** Press **D** with the structure selected, or
use the **Evacuate** button on the selection panel; the occupants are placed on
a ring around the building exactly as a carrier unloads. Both the key and the
button work across a whole selection, so four garrisoned strongpoints empty on
one press, and the panel's count is the sum over all of them.

This page used to say there was no way out, because for a long time there was
not: `GarrisonService.evacuate` existed with no caller anywhere in the
interface.

### The civilian buildings

Two mirrored hamlets sit on the line between the two starting positions, so they
are equidistant from both armies.

| Building | Footprint | HP | What it is for |
|---|---|---|---|
| **Oil Derrick** | 2x2 | 900 | **Pays its holder 15 credits every second.** |
| **Civilian Hospital** | 3x2 | 1100 | The widest firing position on the map |
| **Apartment Block** | 2x3 | 800 | A strongpoint that already exists |

The derrick is worth roughly one harvester's throughput — without the 1400
credits, the War Factory, the escort or the micromanagement, in exchange for
holding ground in the open. It pays whoever holds the deed, so a single
infantryman standing inside one earns the same as an engineer capture; the
difference is that the engineer's claim is permanent and the garrison's ends the
moment he dies.

---

## Carriers, and the cargo slot

**A slot is not a seat.** Infantry cost **one** slot and a vehicle costs
**two**, so an eight-slot hull is four tanks, or eight riflemen, or any mix that
adds up. The number on the hull is a hold rather than a bench.

That is the change that matters. Cargo used to be infantry only, and on
[Sunder Atoll](/avihaymenahem/voltmarch/wiki/Sunder-Atoll) — where no two armies
share a land route — it meant your entire vehicle roster was unusable against
three of your four opponents.

Eight hulls have a hold:

| Hull | Army | Slots | Cost | Time | Built at |
|---|---|---|---|---|---|
| **Landing Craft** | Allies | **4** | 700 | 10 s | Naval Yard |
| **Assault Barge** | Soviets | **4** | 680 | 10 s | Naval Pen |
| **Sun Lighter** | Meridian Pact | **4** | 720 | 10 s | Slipway |
| **Slag Scow** | The Reclamation | **4** | 850 | 12 s | Breaker Dock |
| **Heavy Transport** | Allies and Soviets | **8** | 1200 | 15 s | Naval Yard / Naval Pen |
| **Argosy** | Meridian Pact | **8** | 1250 | 15 s | Slipway |
| **Slag Hauler** | The Reclamation | **8** | 1100 | 14 s | Breaker Dock |
| **Sandskiff** | Meridian Pact | **2** | 550 | 9 s | Forgeyard |

Only two of the eight are armed: the Slag Scow's bow gun (68, high explosive,
32 m) and the Sandskiff's arc repeater.

**Every hull a shipyard builds is water-only, carriers included.** A carrier
does not beach itself — it stands off the shore and puts its cargo on the sand
from open water. The **Sandskiff** is the one exception and it is the case that
proves the rule: it is gated on the Forgeyard, a land structure, and the whole
Pact army hovers, so it is a land raider that can swim rather than a ship that
can walk.

The Slag Scow used to be able to drive to the middle of an island and shell a
base with a dock-built gun. It keeps the gun and has lost the beach.

### Boarding

Right-click a friendly hull with a hold. The passengers walk to it and disappear
inside.

- **The carrier comes to you.** Order a squad onto a hull lying offshore and the
  hull moves in to collect them. Water is impassable to a rifleman, so before
  this the squad walked to the sand and stood there for as long as you were
  willing to watch.
- A boarding order chases: a unit told to enter a moving hull follows it rather
  than walking to where it used to be.
- **A carrier cannot board a carrier.** Everything else that moves can, which
  includes harvesters and construction vehicles.
- The board cursor only appears when at least one **infantryman** is in the
  selection. Vehicles ride perfectly well; select them together with a rifleman
  and the whole group boards.

**Passengers do not fire.** This is deliberate and it is the difference between a
carrier and a garrison: a garrison volleys with the sum of its occupants'
rifles, a carrier is a delivery. A loaded Sandskiff shoots with its own arc
repeater and nothing else.

The squad rides *at* the hull, so if the hull dies mid-lagoon the squad dies
mid-lagoon. Every passenger counts as a separate loss.

### Unloading

Press **D** with the hull selected, or use the Unload button on the selection
panel. Both work across a whole selection, so a fleet of four empties on one
press, and the panel's readout is slots used over slots available summed over
every selected hull.

Passengers are placed on a widening ring around the hull, and only on ground
each one can actually stand on — a carrier sitting over water holds its cargo
rather than drowning it, a tank is not put down on foot-only ground, and a
swimmer *can* be put down in the sea. If nothing works the order stands for
another tick and unloads the moment the hull touches something usable.

Unloading is per-passenger, not per-hold: if the fourth finds nowhere to stand,
the first three still got out.

---

## MCV deploy

A match opens with a construction vehicle. Drive it somewhere and press **D** —
**deploy happens where the vehicle stands**, it is not a move order with a
building on the end.

| Vehicle | Becomes | Cost |
|---|---|---|
| Construction Vehicle | Construction Yard | 3000 |
| Pactworks Carryall | Conclave | 3000 |
| Yardcrawler | Foundry | 3000 |

Three ways to trigger it: the **D** key, double-clicking the vehicle, or
right-clicking it while it is already selected (the cursor turns into the deploy
glyph).

- The unpack takes **1.6 seconds** and the vehicle is immobilised for it.
- The footprint is checked where the vehicle is standing, and re-checked when the
  unpack finishes. If a tank parked on the site in the meantime, the deploy is
  refused and the vehicle is handed back.
- **The build radius does not apply.** An MCV is how you get your first base.
- The yard arrives **finished**, snapped to a quarter turn roughly matching the
  direction the vehicle was pointing.
- In a mixed selection, only the construction vehicles deploy. The escort stays
  where it is and says nothing.

**Undeploy.** Press **D** on a Construction Yard and it folds back into a
vehicle over 1.6 seconds. This is how a yard moves — it is refused by
[Relocate](#relocating-a-structure) for exactly that reason.

---

## Harvesting

Right-click ore with a harvester selected, or right-click your own refinery to
send it home early. Harvesters find their own ore and their own dock if you
leave them alone; see [Economy](/avihaymenahem/voltmarch/wiki/Economy) for the field mechanics.

| Harvester | Army | Load | Cost | Speed |
|---|---|---|---|---|
| Ore Harvester | Allies and Soviets | 700 | 1400 | 5.0 |
| Sun Collector | Meridian Pact | 450 | 1000 | 7.0 |
| Scrapjaw | The Reclamation | 600 | 1150 | 5.6 |

- Ore is scooped at **140 units a second** while parked, and one unit is one
  credit.
- Unloading streams the load in over **2.2 seconds** at a refinery.
- A refinery ships with a free harvester.
- **The Ore Harvester and the Scrapjaw are crushers** (crush level 5), so they
  flatten infantry they drive over. The hovering Sun Collector is not.
- Every harvester is unarmed and sees only 20 m. They will drive into things.

---

## Repair and sell

### The wrench

Arm the repair tool in the sidebar, then click one of your own damaged
structures. Click it again to stop; right-click disarms the tool.

- **30 HP a second**, charged at **0.25 credits per HP**.
- Running out of money stops the repair and clears the flag. It never heals for
  free.
- The drip stops on its own at full health.

### The Repair Depot

A pad, not a button. Every army has one and it costs **800** with a War Factory
as its prerequisite.

| Structure | Army |
|---|---|
| Repair Depot | Allies and Soviets |
| Solar Infirmary | Meridian Pact |
| Patch Yard | The Reclamation |

Park a damaged **vehicle** inside **10 m** of one you own and it is serviced with
no order, no button and no state on the unit — which also means the AI gets it
for free. The rate is **10% of max HP per second**, so a scout and a siege hull
both take about ten seconds; the price is the same 0.25 credits per HP the wrench
charges. One depot services **8 vehicles at once**, and a depot that is dark
because your grid browned out services nobody.

It does not repair infantry and it does not repair structures.

### Selling

Arm the sell tool, then click one of your own structures.

- You get back **50% of the build cost**.
- The structure coughs up a **crew of 1–4 line infantrymen** of your own army,
  scaled by footprint. Selling a damaged building before it dies is how you keep
  half the cost *and* get bodies.
- A sale is not a death: no explosion, no wreck, no "building lost", and it does
  not count against you on the scoreboard.

---

## Relocating a structure

Select one of your own finished structures and press the Relocate button on the
selection panel. The placement ghost comes up; click where you want it.

- The fee is **35% of build cost**, minimum 50. A 2000-credit War Factory costs
  700 to move. That is deliberately cheaper than selling and rebuilding (which
  costs 50% plus the full build time plus a queue slot) and dear enough that a
  bad base layout is still a mistake you paid for.
- The structure is uprooted immediately and spends **4 seconds in transit**,
  nowhere at all — no power, no production, no prerequisite, no vision, no
  target — and then rises at the new site like any new building.
- **Damage travels with it.** You move a wreck, you get a wreck. Otherwise
  relocation would be the cheapest repair in the game.
- Rally point, primary-factory flag, veterancy and an armed repair wrench all
  survive the move.
- If the destination is blocked when it arrives, it retries for **2 seconds** and
  then goes home and refunds the fee. It is never simply lost.

**Refused for:** anything still under construction, anything with a garrison
inside it, anything charging a superweapon, and **anything that folds into a
vehicle** — a Construction Yard travels by packing into an MCV, and that route
keeps its build radius honest.

Moving a Power Plant browns out your base for the duration. Moving your only
Barracks locks infantry behind their own prerequisite until it lands. That is the
cost, and it is why the transit exists.

---

## Self-destruct

Blowing up your own unit deals **max(2x current HP, 80% of max HP)** as a High
Explosive blast with a **5 m** splash radius, killing the volunteer and hurting
whatever is standing next to it.

**There is no button and no hotkey for this.** The command exists, the
simulation implements it, the multiplayer relay accepts it — nothing in the
interface issues it. Consider it unavailable until a build wires it up.

---

## Crushing infantry

Tracked and wheeled hulls flatten foot soldiers they drive over. It is a real
kill: the armour matrix runs, the driver gets the credit and the veterancy, and
the victim shows up as a loss.

The rule is a straight comparison. Every vehicle has a **crush level**; every
foot unit has a **crushable-by** number. The hull must be **moving at 0.6 m/s or
faster**, must not be allied to the victim, and its crush level must be **greater
than or equal to** the victim's crushable-by.

**Exactly six hulls in the game actually crush:**

| Hull | Army | Crush level |
|---|---|---|
| Warden Tank | Allies | 3 |
| Anvil Tank | Soviets | 4 |
| **Sledge Tank** | Soviets | **6** |
| Ore Harvester | Allies and Soviets | 5 |
| Grinder | Reclamation | 5 |
| Scrapjaw | Reclamation | 5 |

Every foot unit in the game — riflemen, engineers, all four commanders — is
crushable-by **1**, so **any of those six flattens any infantryman**.

Everything else crushes nothing. The whole Meridian Pact hovers and therefore
never wins a ram; the IFV, the Arcspitter and the Sandskiff are wheeled but not
crushers.

**The Refractor Tank does not crush, despite carrying a crush level of 2.** Its data
says 2 and the resolver never asks, because the Refractor Tank is missing the flag
that marks a hull as a crusher in the first place. Treat the Refractor Tank as
harmless to infantry underfoot.

**Nothing can crush the Sledge Tank, either harvester, the Scrapjaw, any
construction vehicle, any aircraft, or any hull a shipyard builds** — all of
them carry a crushable-by of 0, which means uncrushable. The Sandskiff is the
one carrier that does not: it is a land raider, and it carries a 4.

**Vehicles cannot crush vehicles at all.** Eleven hulls carry a crushable-by
number in the 4–6 range and nothing reads it — the roster only ever marks
infantry as crushable. Ramming a tank with a bigger tank does nothing.

**You have to actually line it up.** A rolling hull does not steer around, brake
for, or bounce off a man it is entitled to crush — that carve-out is real and
measurable: with and without an infantryman in its path, a Warden's route is
identical. But the pathfinder aims at your *order point*, not at the man, so a
tank sent past a rifleman will often miss him by a metre or two. The kill radius
is about **2.2 m** for a Warden. If you want the crush, right-click the ground
directly behind him.

A **parked** tank keeps its collision and shoves infantry aside instead of
letting them stand inside its hull.

---

## Aircraft

All four armies have one now. Every aircraft is **Light armour** — the air/ground
split is a targeting rule, not a seventh armour class.

| Aircraft | Army | Cost | HP | Speed | Sight | Gun |
|---|---|---|---|---|---|---|
| Swarmhornet | Reclamation | 900 | 180 | 11.0 | 34 | Chained arc |
| Interceptor | Soviets | 1000 | 190 | **13.5** | 32 | Autocannon |
| Kestrel Gunship | Meridian | 1100 | 210 | 12.0 | 36 | Guided pods |
| Petrel Bomber | Allies | 1200 | **240** | 11.5 | **38** | Guided AGM |

The asymmetry is the warhead. The **Petrel Bomber** carries Rocket (0.90 against
Concrete): a strike aircraft, bought to open a base. The **Interceptor** carries
Autocannon (1.00 against Light, 0.35 against Heavy and Concrete): the best
air-superiority unit in the game and useless against a tank line or a wall.

**What an aircraft does that a tank does not:**

- **It never lands.** There is no airfield, no rearm and no fuel. An idle
  aircraft loiters at **22 m** over whatever it is standing above. The cost of
  owning one is that an aircraft with no order is safe and also doing nothing.
- **It shares no space.** Aircraft fly through each other and through ground
  units, ignore the navigation grid entirely, and travel in a straight line. No
  pathing, no queueing, no traffic.
- **Most guns cannot touch it.** See [Combat §2](/avihaymenahem/voltmarch/wiki/Combat#which-guns-can-shoot-up).
  Only the Allies have a dedicated AA emplacement (AA Battery); the Pact and
  the Reclamation answer aircraft with units — the Sunlancer and the Arcspitter.
- **Killed over water it sinks**, from altitude, leaving a splash at the
  waterline rather than a wreck in the air.

Aircraft are gated on the War Factory plus a Radar Dome — one tier below the tech
building, the same shape for every army.

---

## Crates

Six crates are kept on the map at any time. The first drops **25 seconds** into
the match and another every **40 seconds** while the count is below six. Drive
any mobile unit within **2.6 m** to open one; if two units arrive on the same
tick, the resolution is deterministic and identical on every machine.

| Reward | Chance | What you get |
|---|---|---|
| **Credits** | 40% | 300–900, scaled by how long the match has run — up to **x2.5** at ten minutes |
| **Heal** | 20% | The finder and every ally within **10 m** go to full HP |
| **Free unit** | 18% | A unit of your faction walks out of the box |
| **Promotion** | 14% | The finder gains one veterancy rank |
| **Dud** | 8% | It was ammunition. **45% of the finder's max HP** as a 5 m HE blast |

Crates are the reason an early scout pays for itself. The dud is rare enough to
be a story rather than a tax, and it hurts a Conscript far less than it hurts an
Sledge.

---

## Superweapons

Six buildable end-game weapons, one or two per army. Each needs its own
structure, and every structure costs **-150 power** — by a wide margin the
heaviest single draw in the game.

| Weapon | Army | Structure | Cost | Charge | Radius | Aiming |
|---|---|---|---|---|---|---|
| **Nuclear Missile** | Soviets | Nuclear Missile Silo | 2500 | 7:00 | 26 m | One click |
| **Ironclad Field** | Soviets | Ironclad Field | 2000 | 5:00 | 13 m | One click |
| **Displacement Ring** | Allies | Displacement Ring | 2000 | 5:00 | 11 m | **Two clicks** |
| **Lightning Storm** | Allies | Weather Control Device | 2500 | 6:40 | 16 m | One click |
| **Solar Lance** | Meridian | Heliograph | 2500 | 7:00 | 24 m | One click |
| **Arc Storm** | Reclamation | Stormworks | 2500 | 6:40 | 17 m | One click |

Every one is gated on its army's tech building — Proving Ground, Reliquary or
Crucible — so a superweapon is the last thing on the tree and never an opening.
That tech building is itself a mission unlock, so a fresh profile has no
superweapons at all.

**2500 credits is not the real price; the grid is.** -150 power is the heaviest
single draw in the game, and a base that builds one browns out unless it has
already paid for the generation. A raid on your power plants stops the countdown
dead.

### What each one does

**Nuclear Missile / Solar Lance.** One annihilating blast: **1400 damage**, High
Explosive, across the radius. It is announced **3.5 seconds** before it lands,
with a marker beam standing on the target that **both sides can see**. That
warning is the mechanic — the target has time to be afraid and to scatter.

**Ironclad Field.** Every friendly infantryman and vehicle in the radius becomes
**genuinely invulnerable for 20 seconds**. Not damage reduction — nothing in the
game can hurt them. Their original health is restored on expiry, so it is
invulnerability and not a heal. Twenty seconds is long enough to walk an
Sledge column through a defensive belt.

**Displacement Ring.** Click a **source**, then a **destination**. Up to **nine**
friendly ground units are lifted out of one and set down in a spiral around the
other, anywhere on the map. They arrive idle with no orders.

**Lightning Storm / Arc Storm.** Nine seconds of area denial after a 1.2 second
delay: a **Tesla** bolt roughly every 0.42 seconds, scattered randomly inside the
radius, **190 damage** with 4.5 m splash each. The total exceeds a nuke and none
of it lands where you thought it would. Against infantry (Tesla, 1.60) it is
devastating; against a base (0.60) it is not.

### Charging and firing

- **The charge only runs while you own a live, finished, powered structure.** A
  browned-out silo charges nothing. Confirmed in play: a Displacement Ring built with
  no spare generation reads unavailable and refuses to fire even with the timer
  at zero.
- **Losing the structure pauses the charge, it does not reset it.** Rebuild and
  the countdown resumes where it stopped.
- **Firing:** click the countdown row in the HUD to arm the targeting cursor,
  then click the ground. Clicking the row again, pressing Escape, or
  right-clicking puts the cursor away. Arming does not fire.
- A structure that is part-way through a charge **cannot be relocated**. A
  finished charge is banked and can be.

---

## The four commander abilities

Each army can build **one hero, one at a time**, for **1500** from its barracks
with a radar built. Each carries one active ability.

Fire it with **Shift + F**, or with the button on the selection panel, which also
prints the seconds left while it is cooling.

**None of them takes a target.** The effect always lands on a circle around the
commander, which means one button fires any of them and **where you walked the
commander is the aim**.

| Commander | Army | Ability | Radius | Cooldown | Effect |
|---|---|---|---|---|---|
| **Field Marshal** | Allies | Chrono Rally | 34 m | 50 s | Up to **6** friendly units in radius blink to a ring around the commander |
| **War Commissar** | Soviets | Iron Will | 16 m | 60 s | Friendlies in radius are **invulnerable for 5 seconds** |
| **Hierarch** | Meridian | Prism Focus | 18 m | 45 s | **210 Prism damage** to everything hostile in radius |
| **Scrap Baron** | Reclamation | Salvage Call | 22 m | 40 s | Consumes up to **8 wrecks** for **120 credits each**, and heals friendlies in radius by **30% of max HP** |

Commanders are mission-locked, and all four by the same one — *Old Guard*,
promote 15 units to elite rank — so a fresh profile cannot build any of them.
They are also real combat units in their own right: 430–520 HP and a serious gun
(the Field Marshal carries a Prism Emitter, the Commissar a Tesla bolt).

Prism Focus is ordinary damage — the armour matrix applies, the kill is credited
to the Hierarch, and a unit already at 1 HP dies to it exactly as it dies to a
rifle. Iron Will works the way the Ironclad Field does, at a quarter of the
duration.

---

## The five commander powers

**These are not the same thing as commander abilities.** Read the difference,
because it is the whole design:

| | Commander ability | Commander power |
|---|---|---|
| Belongs to | a **hero unit** | the **player** |
| Aimed at | a circle around the commander | **a point you name on the map** |
| Needs | the hero alive and standing in the right place | nothing at all |
| Earned by | building the hero | **buying it from a Command Post, in the match** |
| How many | 4, one per army | 5, shared across every army |

Powers work with every hero dead. Each one is a ONE-OFF PURCHASE from your
army's Command Post (Command Bunker / Pharos / Signal Rig), which publishes a
fifth sidebar tab, **PWR**. Bought once, it is yours for the rest of that match
and recharges on its own clock. The structure is 1,500 credits and −80 power off
the radar tier; the five powers are 800 / 1,200 / 1,500 / 2,000 / 2,500. See
[Campaign](/avihaymenahem/voltmarch/wiki/Campaign#commander-powers).

| Power | Charge | Radius | Effect |
|---|---|---|---|
| **Orbital Scan** | 2:00 | 90 m | Permanently charts a wide circle. Terrain and structures are remembered; live units are not handed over. |
| **Airstrike** | 2:30 | 20 m | **260 High Explosive damage** on the marker. It friendly-fires your own units in the blast. |
| **Emergency Repair** | 2:30 | 24 m | Restores **45% of max HP** to up to 24 friendly units **and structures**. The only mend in the game that reaches a building with no wrench and no engineer. |
| **Ore Boost** | 3:00 | – | **2500 credits**, immediately. The only power with no position. |
| **Chronoshift** | 4:00 | 30 m | Lifts up to **8** units standing near your base (within 40 m of the centroid of your buildings) to the marker. |

**The charge is spent whether or not the power catches anything.** A power that
refunded itself on a miss would be a free map probe.

**The powers bar is on the right rail**, under the superweapon countdowns: one
row per power you have BOUGHT, showing its clock. Click a ready row to arm it,
then click the map to aim. Right-click or Escape puts it away. A power you have
not bought has no row and the simulation refuses it.

**The tab needs the lights on.** It is published only by a completed, POWERED
Command Post, so a raid on the structure or a brownout closes it. What you have
already bought stays bought.

---

## Things that surprise people

- **A Warden will drive straight past an infantryman it could have crushed**,
  because the pathfinder aims at your click, not at him. Click the ground
  *behind* the target.
- **Riflemen will not voluntarily shoot a tank** while any softer target is
  nearby. That is the targeting scorer doing its job. Build Javelins or Flak
  Troopers.
- **Aggressive and Defensive stance behave identically.** Nothing chases a target
  of opportunity in this build. Hold Fire and Hold Ground are the two that
  matter.
- **Passengers in a carrier contribute nothing.** Unload them first.
- **A slot is not a seat.** Eight slots is four tanks or eight riflemen.
- **A superweapon that is not powered is not charging**, and the HUD row simply
  will not be there.
- **An engineer sent at a healthy enemy building dies and accomplishes 25%.**
  Soften first.

---

**See also:** [Combat](/avihaymenahem/voltmarch/wiki/Combat) · [Controls](/avihaymenahem/voltmarch/wiki/Controls) ·
[Base Building](/avihaymenahem/voltmarch/wiki/Base-Building) · [Economy](/avihaymenahem/voltmarch/wiki/Economy) · [Campaign](/avihaymenahem/voltmarch/wiki/Campaign) ·
[Strategy](/avihaymenahem/voltmarch/wiki/Strategy) · [Home](/avihaymenahem/voltmarch/wiki/Home)
