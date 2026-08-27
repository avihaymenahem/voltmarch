# Strategy

Everything below is derived from the game's actual numbers — the weapon table, the armour matrix,
the build costs and the AI's own doctrine tables — not from RTS folklore. Where a claim is arithmetic
it is stated as arithmetic. Where it is a judgement call it says so.

New here? Read [How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) and [Controls](/avihaymenahem/voltmarch/wiki/Controls) first. This page assumes you know
which button builds a tank.

---

## 1. How a match is won

By annihilation. The match ends when one side has no living units and no living structures. There is
a ten-second grace period at the start and then the check runs twice a second.

There is one softer rule: a player who has nothing that can build **and** nothing left but harvesters
is *beaten*, and after eight seconds the match resolves. A player who has an army but no base is
*stranded* — warned, not ended, because an army with no base can still walk into yours and win.

There is no timer, no score victory and no surrender.

---

## 2. The first ninety seconds

A match opens with **one construction vehicle and a small escort**. No power, no refinery, no
harvester. Default bank is 10,000 credits, and the lobby will not let you open from a construction
vehicle with less than 5,000.

Your escort, by faction:

| Faction | Escort |
| --- | --- |
| Allied Forces | 3 infantry, 2 vehicles |
| Soviet Union | 4 infantry, 2 vehicles |
| Meridian Pact | 4 infantry, 2 vehicles |
| The Reclamation | 5 infantry, 1 vehicle |

The vehicle deploys **where it stands** — it is not a move order with a building on the end. Drive
first, then deploy. Deploying takes 1.6 seconds.

### The one rule that governs every opening: power

Structures build one at a time per tab, and build speed is multiplied by your power satisfaction —
down to **0.25×** at total blackout. Worse, when the grid browns out the shed order is **defence
first**, then radar, then tech, then factories, then refineries. Your Construction Yard never sheds.

So a brownout does not gently slow you down. It turns your defences off and quarters your build rate,
in that order.

| | Allies / Soviets | Meridian Pact | The Reclamation |
| --- | --- | --- | --- |
| Plant | Power Plant, 300 cr, 8 s, **+100**, 800 hp | Solar Array, 350 cr, 8 s, **+160**, 420 hp | Scrap Furnace, 240 cr, 7 s, **+80**, 950 hp |
| Yard draw | −20 | −20 | −20 |
| Refinery | −30 | −30 | −30 |
| Barracks | −20 | −20 | −20 |
| Vehicle factory | −40 | −40 | −40 |
| **Plants needed to reach the vehicle factory** | **2** | **1** | **2** |

That single row is most of the difference between the three economies. The Pact reaches its Forgeyard
on one Solar Array and saves 300 credits and eight seconds; it pays for that with a 420 hp plant that
four Sandskiffs can delete, and with two defences and a siege tank whose weapons stop working the
moment the grid dips.

### A standard opening — Allies or Soviets, 10,000 credits

| Step | Cost | Build time | Notes |
| --- | --- | --- | --- |
| Deploy the construction vehicle | — | 1.6 s | Do this immediately |
| Power Plant | 300 | 8 s | |
| Ore Refinery | 2,000 | 24 s | **Arrives with a free harvester** |
| Barracks | 500 | 10 s | Start infantry at once |
| Power Plant | 300 | 8 s | Before the factory, not after |
| War Factory | 2,000 | 24 s | |
| Radar Dome | 1,000 | 14 s | Opens the Javelin / Flak Trooper and the commander |

**Cost 6,100 of 10,000. Elapsed roughly 90 seconds** if you can pay the drip the whole way, which you
can from a 10,000 bank. The free harvester starts running at about the 35-second mark and pays
roughly **22 credits per second** — about 1,300 a minute — on a 32-second round trip.

Infantry and vehicles queue on their own tabs and run *in parallel* with structures, so from the
44-second mark you should be producing infantry continuously and from about 76 seconds you should
have a second harvester on order (1,400 cr, 16 s).

At 90 seconds a clean opening has: a yard, two plants, a refinery, a barracks, a war factory, a
radar, one or two harvesters, and roughly 4,000–5,000 credits of headroom.

**Add one engineer.** The moment the barracks and refinery are both up, a 500-credit engineer walking
to the nearer civilian hamlet buys you an Oil Derrick — captured outright, at full health, no
softening — and 15 credits a second for the rest of the match. On a two-minute walk it has paid for
itself before your second harvester finishes. See §9.

### The same opening, per faction

**Meridian Pact.** Solar Array → **Chapterhouse** → Ore Cistern → Forgeyard → Solar Array → Oculus.
Barracks second is the whole faction identity: the array's surplus buys a screen of Wayfarers
(175 cr, 5 s) before the first refinery has paid for itself, and the Pact's line is too fragile to
survive an early rush with nothing on the field.

**The Reclamation.** Scrap Furnace → **Rookery** → Ore Sorter → Scrap Furnace → Breaker Yard →
Spotter Mast. Same shape, and for the same reason: three Scrap Pickers cost 270 credits and nine
seconds. The Breaker Yard is 1,900/22 s against everyone else's 2,000/24, and a Grinder is 600/9 s
against a Warden's 700/11 and an Anvil's 900/13. The Reclamation's whole case is that it arrives
first and arrives again.

The Reclamation's bill comes later: a full base (Foundry, Sorter, Rookery, Breaker Yard, Spotter,
Crucible, Heap, Patch Yard) draws 250 power, which is **four** Scrap Furnaces — 960 credits and four
more targets. Add one Arc Pylon at −90 and you need a fifth.

### Against Hard and Brutal, buy a defence

The AI's first attack is gated on the clock, divided by its aggression:

| Difficulty | First attack | Gap between waves | Wave size (Turtle / Rusher / Boomer) |
| --- | --- | --- | --- |
| Easy | 5:00 | 2:00 | 7 / 2 / 5 |
| Normal | 2:51 | 1:09 | 12 / 4 / 8 |
| Hard | 2:00 | 0:48 | 17 / 5 / 11 |
| Brutal | **1:32** | 0:37 | 22 / 7 / 14 |

On Brutal, the first wave lands about the time your Radar Dome finishes. Insert your faction's cheap
defence after the barracks — **Pillbox 400 / Sentry Gun 400 / Glaive Post 450 / Spitpost 420** — and
run line infantry out of the barracks while the factory builds.

The grace period is a head start, not a truce: hit the AI's base hard enough and it cancels
immediately and comes home.

---

## 3. Economy

| Number | Value |
| --- | --- |
| Starting bank | 10,000 (2,000–50,000 in the lobby; floor 5,000 from a construction vehicle) |
| Harvester load | 700 ore (Sun Collector 450, Scrapjaw 600) |
| Scoop rate | 140 ore/s while parked |
| Unload | 2.2 s |
| Target round trip | 32 s → **≈ 22 credits/s per harvester** |
| Storage | 10,000 base (a 1,000 floor raised so the opening bank is never over cap); +2,000 per refinery; +1,500 per silo |
| Ore regrowth | 0.6/s per cell, spreading outward from the field's centre |

**A held Oil Derrick is a free harvester.** 15 credits a second, paid every second, for one
500-credit engineer and the ground to keep it on. That is roughly what one harvester earns, without
the 1,400-credit hull, the War Factory prerequisite or the round trip. There are two derricks on the
map. See §9.

**Every refinery ships with a free harvester.** A second refinery is therefore 2,000 credits for
2,000 storage *and* a 1,400-credit vehicle — a 3,400-credit package for 2,000. That is the single
best purchase in the game and it is why every AI opening buys two.

Three harvesters per refinery is the saturation point the AI aims for. Past that they queue at the
dock.

**Overflow is burned.** Credits above your storage cap are destroyed on arrival, and the HUD says so.
An Ore Silo costs 150 credits — under a quarter of one harvester load — and adds 1,500 storage. If
you are banking above 85 % of cap, buy one.

If you picked a 20,000 or 50,000 starting bank in the lobby, note that the opening grant ignores the
cap entirely — you begin the match **over** it, and every credit your first harvester brings home is
destroyed until you have spent back down below 10,000. Spend fast or build silos early.

**Money is paid by the drip.** A queued item accumulates only what you can afford this tick, and
cancelling refunds exactly what was paid — never a percentage. Queueing a Sledge and cancelling
it at 90 % costs nothing but the time. Use the queue as a bank when you are saving for a structure.

**Extra factories are build speed, not extra queues.** All Barracks feed one infantry queue; each
additional one adds 35 % to its rate, capped at 2.0×. A second War Factory is a 2,000-credit build
speed upgrade, not a second production line.

---

## 4. Scouting

Fog of war is a flat circle stamp. **Terrain does not block vision** — a unit at the bottom of a cliff
sees exactly as far as one on top of it. Structures see 3 m further than their listed sight.

Sight radii worth knowing: Radar Dome 44 · Oculus 46 · Spotter Mast 42 · Kestrel 36 · Sabre IFV
32 · Sandskiff 32 · Arcspitter 28 · Attack Dog 26 · Wayfarer 26 · G.I. 24 · Conscript 22 · Scrap
Picker 22.

On a fresh profile every fast scout is locked (Attack Dog, IFV, Sandskiff and Arcspitter all sit
behind *First Blood*), so your first scout is a rifleman. Send one anyway: **six crates are alive on
the map at all times**, the first drops at 25 seconds, and a credit crate after ten minutes is worth
750–2,250. A 90-credit Scrap Picker that finds two crates has paid for a Grinder.

What to look for, in order:
1. Which corner the enemy took — start slots rotate with the seed, so do not assume.
2. Whether the **midpoint ore field** is contested yet. It is roughly a third of the map's income and
   neither player can defend it from home.
3. **Which hamlet they went for.** There are two mirrored settlements roughly 54–69 m either side
   of that midpoint, with a small seed-driven lane shift. If their
   engineer is walking to one, the other is free — and if both derricks are theirs, you are losing
   30 credits a second you are not paying for.
4. The count of enemy refineries. Two means they are teching; one means they are massing.
5. Static defence. The AI's own target scoring values enemy defences *above everything else*, and so
   should yours — see §7.

The AI scouts you on a timer: first sweep at about 8 seconds scaled by difficulty (Easy ~18 s,
Brutal ~4 s), repeating every 40 seconds. It remembers enemy structures for two minutes after losing
sight of them.

---

## 5. What counters what

### The armour matrix

This table is the counter-triangle. Rows are warheads, columns are the armour classes they hit.
Multiply the weapon's raw damage by the cell.

| Warhead | Infantry | Light | Medium | Heavy | Concrete | Wood |
| --- | --- | --- | --- | --- | --- | --- |
| Small Arms | **1.00** | 0.55 | 0.28 | **0.10** | 0.18 | 0.60 |
| Autocannon | 0.80 | **1.00** | 0.65 | 0.35 | 0.35 | 0.80 |
| Armour-Piercing | 0.35 | 0.85 | **1.00** | **1.00** | 0.55 | 0.75 |
| High Explosive | 0.90 | 0.80 | 0.65 | 0.50 | **1.00** | 1.00 |
| Rocket | 0.55 | 0.95 | 0.90 | **0.95** | 0.90 | 0.85 |
| Tesla | **1.60** | 0.95 | 0.85 | 0.90 | 0.60 | 0.70 |
| Prism | 1.10 | 0.95 | 0.95 | 0.90 | 0.80 | 0.90 |

Read the shape:

- **Small arms cannot fight vehicles.** 0.10 against heavy armour. A lone G.I. needs **100 seconds**
  to kill an Anvil Tank and 191 to kill a Sledge.
- **Autocannon owns light armour** and is helpless against heavy (0.35) and against buildings (0.35).
- **AP owns tanks** and wastes itself on infantry (0.35).
- **HE is the building-killer** and the only warhead at 1.00 against concrete.
- **Rocket is the generalist** — nothing below 0.55, nothing above 0.95. It never wins a matchup and
  it never loses one.
- **Tesla deletes infantry** (1.60) and bounces off structures (0.60). That one pair is the entire
  Reclamation.

### Units will refuse a bad matchup

If a weapon's multiplier against a target is **0.35 or below**, that target's targeting score is cut
to 35 %. A unit will not voluntarily aim at something it cannot hurt while anything else is nearby.
In practice:

- Riflemen and Conscripts will not shoot at tanks or buildings.
- Tank guns deprioritise infantry.
- **Sabre IFVs and Sandskiffs deprioritise heavy tanks and structures.**

Force-fire overrides it. So does an explicit attack order — the air veto is the only gate that
survives an explicit click.

Other targeting weights, in case you wonder why your army picked what it picked: something that can
shoot back scores ×1.6, whoever last hit you ×1.5, a defensive structure ×1.3, a harvester ×1.15, a
target under 40 % health ×1.25, the target you already had ×1.35, and a non-defensive building ×0.55.
**Your army will ignore an enemy's power plants while anything armed is alive.**

### Effective damage per second

Cycle time is `(burst − 1) × burst delay + cooldown`; effective DPS is raw DPS times the matrix cell.
These are single-unit, no-veterancy figures against a stationary target in range, and they are stated
**before** the game's global x0.80 damage scalar — so every *time* on this page is a quarter longer
than dividing hit points by one of these columns would suggest. See
[Combat](/avihaymenahem/voltmarch/wiki/Combat).

| Unit | Cost | HP / armour | Range | vs Infantry | vs Light | vs Medium | vs Heavy | vs Concrete |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G.I. | 200 | 120 Inf | 18 | **52** | 29 | 15 | 5 | 9 |
| Conscript | 100 | 100 Inf | 17 | **50** | 28 | 14 | 5 | 9 |
| Wayfarer | 175 | 110 Inf | 20 | 47 | 26 | 13 | 5 | 8 |
| Scrap Picker | 90 | 85 Inf | 14 | 40 | 24 | 21 | 22 | 15 |
| Javelin | 500 | 125 Inf | 24 | 15 | 26 | 25 | **26** | 25 |
| Sunlancer | 450 | 130 Inf | 26 | 13 | 23 | 22 | 23 | 22 |
| Flak Trooper | 300 | 110 Inf | 20 | 26 | 32 | 21 | 11 | 11 |
| Slagger | 380 | 115 Inf | 12 | 25 | 22 | 18 | 14 | **27** |
| Sabre IFV | 600 | 220 Light | 22 | 52 | 65 | 43 | 23 | 23 |
| Sandskiff | 550 | 190 Light | 23 | 55 | 68 | 44 | 24 | 24 |
| Arcspitter | 420 | 170 Light | 16 | 51 | 30 | 27 | 28 | 19 |
| Warden Tank | 700 | 340 Med | 24 | 13 | 31 | 37 | 37 | 20 |
| Anvil Tank | 900 | 420 Heavy | 26 | 14 | 33 | 39 | 39 | 21 |
| Solarch | 800 | 330 Light | 26 | 13 | 32 | 38 | 38 | 21 |
| Grinder | 600 | 270 Med | **18** | 59 | 35 | 31 | 33 | 22 |
| Sledge | 1,750 | 800 Heavy | 28 | 16 | 40 | 47 | 47 | 26 |
| Refractor Tank | 1,200 | 260 Light | 38 | 39 | 34 | 34 | 32 | 28 |
| Zenith Emitter | 1,500 | 240 Light | 40 | 36 | 31 | 31 | 29 | 26 |
| V4 Rocket Launcher | 1,400 | 270 Light | **48** | 26 | 23 | 19 | 14 | 29 |
| Slaghurler | 1,150 | 230 Light | **42** | 26 | 23 | 19 | 14 | **29** |
| Swarmhornet *(air)* | 900 | 180 Light | 17 | 47 | 28 | 25 | 26 | 18 |
| Interceptor *(air)* | 1,000 | 190 Light | 21 | 76 | **95** | 62 | 33 | 33 |
| Kestrel Gunship *(air)* | 1,100 | 210 Light | 22 | 23 | 41 | 38 | 41 | 38 |
| Petrel Bomber *(air)* | 1,200 | 240 Light | 23 | 26 | 46 | 43 | **46** | **43** |

Add to that: **Tesla weapons chain.** Each arc jumps up to 9 m from its last victim, retaining 60 %
of the damage per link. A Grinder chains twice and a Scrap Picker once, so the table above understates
every Reclamation unit against a blob and states it correctly against a single target.

Add also: **splash.** The Slaghurler's mortar is 5.8 m, the Slagger's satchel 2.6 m, the Anvil's gun
2.1 m, the Javelin's rocket 2.4 m. Massed infantry against splash is a donation.

### The duels that actually come up

| Matchup | Result |
| --- | --- |
| Warden vs Anvil | **Anvil wins** 1v1 (10.9 s vs 14.3 s) and outranges by 2 m. But at equal credits three Wardens beat two-and-a-third Anvils on both HP and DPS. |
| IFV vs Warden | **Warden wins**, 8.8 s to 10.0 s. The IFV is 100 credits cheaper, 1.8 m/s faster and sees two metres further, and it still loses the straight fight — autocannon falls to 0.65 against medium armour and the tank has 120 more hit points. Raid with it; do not trade with it. |
| IFV vs Anvil | **Anvil wins**, 8.3 s to 22.9 s. Autocannon at 0.35 against heavy armour is the whole answer. |
| Solarch vs Warden | **Solarch wins** narrowly and outranges by 2 m. |
| IFV vs Solarch | **IFV wins**, 6.3 s to 8.6 s. Autocannon at 1.00 against light armour is why a raider beats a main battle tank here and loses to the Allied one. |
| Grinder vs Warden | **Warden wins** 1v1 and gets six metres of free fire first. At equal credits it is a coin flip, and the Grinder chains. |
| Javelins vs Anvils | **Javelins win on credits by a wide margin** — four Javelins (2,000 cr) kill an Anvil in 5.1 s. The counter-play is to drive over them: an Anvil crushes any infantryman it lines up on, which is why a Javelin screen needs its own screen. |

### The three holes worth exploiting

1. **Meridian's whole line is Light armour.** Every Pact vehicle and ship is light-armoured with a
   deep HP pool. Autocannon rises from 0.65 against medium to 1.00 against light, and small arms from
   0.28 to 0.55. IFVs, Sandskiffs, Flak Troopers and massed infantry all get roughly double value
   against the Pact.
2. **The Reclamation cannot take a base apart.** Tesla is 0.60 against concrete and every arc is
   14–20 m ranged. Its only real answers to a structure are the Slaghurler and the Slagger. Kill
   those two and a Reclamation army can stand in your base achieving very little.
3. **Almost every emplacement in the game stops on a dead grid.** Seven of the ten armed structures
   draw power, and a building that draws power and is not getting any cannot shoot, whatever gun it
   holds. Kill power plants — Solar Arrays have 420 hp — and a defensive belt goes dark without a
   single shot at the towers themselves. The three exceptions all draw *nothing*: the Allied Pillbox,
   the Soviet Sentry Gun and the Reclamation Spitpost. The Pact has no such gun. Electric weapons go
   further and refuse on any deficit at all — the Tesla Coil, the Refractor Tower, the Helios Spire and
   the Glaive Post — so a shallow shortfall disarms the Pact belt before the shed order reaches it.
   The Zenith Emitter is the one beam that never cares: it is a vehicle, and a hull has no grid.

### Aircraft

**All four armies have one**, unlocked together by a single Meridian mission (see
[Campaign](/avihaymenahem/voltmarch/wiki/Campaign)). Every aircraft is Light armour — the air/ground split is a targeting rule, not
a seventh armour class. Aircraft ignore terrain, water, cliffs, buildings and each other entirely,
cruise at 22 m, never land, never rearm and travel in a straight line to wherever you send them.
Newly produced aircraft start in **Defensive** stance, so a short retreat holds instead of being
reclaimed by Aggressive auto-chase; an explicit attack order still closes to firing range.

| Aircraft | Army | Cost | HP | Speed | Warhead | What it is for |
| --- | --- | --- | --- | --- | --- | --- |
| Swarmhornet | Reclamation | 900 | 180 | 11.0 | Tesla, chains ×2 | Deleting infantry from above |
| **Interceptor** | Soviets | 1,000 | 190 | **13.5** | Autocannon | **Air superiority.** 1.00 against Light, and every aircraft is Light |
| Kestrel Gunship | Meridian | 1,100 | 210 | 12.0 | Rocket | The generalist raider |
| **Petrel Bomber** | Allies | 1,200 | 240 | 11.5 | Rocket | **Opening a base.** 0.90 against Concrete, 0.95 against Heavy |

Every one is gated on the **vehicle factory plus a radar** — one tier below the tech building, the
same shape for all four armies — and on the *unit.air* unlock, which is one mission for everybody.

The two Allied and Soviet rows are deliberately different questions. An Interceptor at 95 DPS against
Light beats any other aircraft in the game, but its autocannon does not acquire ground targets — it
is air superiority and nothing else. A Petrel Bomber does 43 to a structure and 46 to heavy armour
and will lose a dogfight to the Interceptor. Buy the one that answers what you scouted.

**Range is measured on the ground plane**, so cruising altitude costs an aircraft nothing and costs
the gun shooting at it nothing either. Direct fire crossing between ground and air follows the real
vertical bearing, so parking directly overhead is not an invisible safe zone.

**A weapon can only shoot up if its row says so.** Tank cannons, artillery, flamethrowers, torpedoes,
naval deck guns, siege beams and the emplaced MG in a pillbox cannot. What can:

| Answer | Range | Notes |
| --- | --- | --- |
| Rifles / carbines (G.I., Conscript, Wayfarer) | 17–20 | Free, and weak — but every army has them from minute one |
| Scrap Picker, Arcspitter | 14 / 16 | The Reclamation's ground answers, both very short |
| Flak Trooper | 20 | 300 cr, 32 DPS against Light |
| Sabre IFV, Sandskiff | 22 / 23 | Autocannon at 1.00 against an aircraft's Light armour |
| Javelin, Sunlancer | 24 / 26 | 0.95 rocket multiplier, and they hit tanks too |
| **AA Battery** | 26 | The only dedicated AA structure in the game — **Allied only**. Draws 30, so it stops with the grid |
| Arc Pylon | 28 | Chains three ways. Draws 90 — the heaviest load in the game, and the first thing off in a brownout |
| Tesla Coil, Helios Spire, Refractor Tower | 30–34 | All double as AA, all stop in a brownout |
| Every aircraft | 17–23 | Air answers air — which is why owning the only gunship is not a win condition |

The asymmetry that matters: **the Pact and the Reclamation have no dedicated AA emplacement at all.**
Their static answer is the Helios Spire and the Arc Pylon, which are tier-3 defences; their real
answer is the Sunlancer and the Arcspitter, which are units and have to be somewhere. If you are
flying against either of them, go around the towers.

Against the Allies and the Soviets, assume an AA Battery or a Tesla Coil is covering anything
worth bombing.

---

## 6. Army composition

The honest general rule is a **2:1 line-to-answer ratio**, with the answer chosen from what you
scouted. Concretely:

**[Allied Forces](/avihaymenahem/voltmarch/wiki/Faction-Allies).** Wardens are the line, and the Sabre IFV is not a cheap substitute for
one: it loses the 1v1 both ways round, to a Warden and to an Anvil. What it is, is the best raider in
the army — 1.00 against Light armour, faster than anything else with a turret, and two metres more
sight than the tank. Point it at aircraft, at other raiders and at harvesters, and keep the Wardens
for armour. Javelins behind the armour, not in front: they have 24 m of range against an Anvil's 26
and have to walk into the gun. Refractor Tanks
must stop to fire and die to anything that reaches them — keep them behind the line at 30 m, and
remember the Refractor Tank is the one Allied hull that does **not** crush infantry. The Petrel Bomber is
your base-opener. On a map with a sea, the Heavy Transport is how four Wardens arrive on somebody
else's beach at the same moment — eight slots at two per vehicle — and the Hydrofoil is 450 credits
for 44 m of sight, which is every metre the Radar Dome you paid a thousand for can see.

**[Soviet Union](/avihaymenahem/voltmarch/wiki/Faction-Soviets).** Anvils win fights and lose exchange rates. Conscripts are the best anti-infantry
value in the game at 0.50 DPS per credit — screen with them and let the Anvils shoot armour.
Flak Troopers are the light-armour answer, not the heavy one: 1.00 against light and 0.35 against
heavy. The Soviet answer to heavy armour is heavier armour. The Sledge is poor per credit (0.027
DPS per credit against medium) and good where concentration matters — 800 HP, 28 m, uncrushable, and
a crush level of 6, which is the highest in the game. The Interceptor is the answer to anybody else's air and
nothing else: 33 DPS against an Anvil is not a tank. Soviet armour is also the best crushing armour in
the game — an Anvil column driving through a Conscript screen is a real Soviet play.

**[Meridian Pact](/avihaymenahem/voltmarch/wiki/Faction-Meridian-Pact).** A Pact line wins a standoff and loses a brawl: every Pact gun outranges its
opposite number by 1–3 m and under-damages it. Fight at maximum range, retreat rather than trade, and
screen with Wayfarers, because massed infantry is what the army is worst against. Everything hovers,
so slope costs you nothing and you can take routes tracked armies will not. Never let an IFV or a
conscript wave reach the line.

The Pact pays for hovering twice: nothing it fields can crush, so it never wins a ram and never
clears an infantry screen by driving through it. The Sandskiff holds two slots on a 550-credit armed
raider and is the only hull in the game with a hold that still crosses a beach — use it to put two
Sunlancers somewhere nobody expects them, not to move an army. Moving an army is what the Argosy is
for: eight slots, 1250 credits, and a Slipway on a coast. Pact VEHICLES do not need it — they hover
across on their own — but every Pact infantryman walks, and the Sunlancers you want on the far shore
are exactly the units that cannot get there without a hull.

**[The Reclamation](/avihaymenahem/voltmarch/wiki/Faction-Reclamation).** Nothing you field has a turret, so every hull must point its chassis at what it
wants to kill, inside a range band where everyone else is already shooting. The compensation is a full
extra radian per second of hull turn and the cheapest units in the game. Play it as swarm-and-replace:
Pickers and Grinders in numbers, arcs chaining through the enemy line, Slaghurlers held back at 42 m
for anything made of concrete. Never fight at 24 m — close or leave.

Two hulls crush — the Grinder and the Scrapjaw, both at level 5 — which is the army's cheapest answer
to a mass of infantry after its arcs. The Slag Scow holds four slots and keeps its bow gun, so a
Reclamation landing is four Slaggers arriving at a wall nothing else in the army can hurt, under
covering fire from the barge that brought them. The Slag Hauler is the cheapest eight-slot hull in
the game at 1100 and the only carrier anywhere behind Heavy armour — which matters, because the
Reclamation has **no escort hull** to screen a crossing with.

**Numbers that scale.** Veterancy is worth more than it looks. Three kills gives rank 1 (×1.12
damage, ×1.12 HP, ×0.95 cooldown); six gives rank 2 (×1.22 damage, ×1.28 HP, ×0.90 cooldown). An elite
unit does **1.36×** the damage of a rookie and takes 28 % more to kill. Keeping a damaged veteran
alive — see the Repair Depot below — is worth more than replacing it.

---

## 7. Defending

**Static defences.**

| Structure | Faction | Cost | HP | Range | Power | Hits air |
| --- | --- | --- | --- | --- | --- | --- |
| Pillbox | Allies | 400 | 500 | 22 | 0 | no |
| Sentry Gun | Soviets | 400 | 480 | 22 | 0 | no |
| Flame Tower | Soviets | 600 | 550 | 18 | −20 | no |
| Glaive Post | Meridian | 450 | 480 | 24 | −10 | no |
| Spitpost | Reclamation | 420 | 520 | 20 | **0** | no |
| AA Battery | Allies | 800 | 550 | 26 | −30 | **yes** |
| Tesla Coil | Soviets | 1,500 | 700 | 30 | −75 | yes |
| Refractor Tower | Allies | 1,500 | 600 | **34** | −50 | yes |
| Helios Spire | Meridian | 1,500 | 600 | 33 | −55 | yes |
| Arc Pylon | Reclamation | 1,450 | 560 | 28 | **−90** | yes |
| Concrete Wall | all | 100 | 300 | — | 0 | — |
| Gate | all | 150 | 400 | — | 0 | — |

Placement rules: new structures must be within 20 m of another finished friendly structure, or
within 56 m of a Construction Yard. A base therefore creeps outward one building at a time. Walls
count, so a wall run is also a cheap way to extend where you can build.

**Walls block movement, not fire.** The Concrete Wall's own description says it "stops vehicles,
stops nothing else" — in the simulation an occupied cell is impassable to *everything*, infantry
included, so a wall run is a real barrier that has to be shot down or walked around. What it does not
do is block a shot: guns fire over it freely. A Gate is 150 credits and lets your own units through.

**Site defences to be shot at.** The AI's target scoring values an enemy static defence at **3.0** —
higher than a refinery (2.4), a war factory (1.8), a construction yard (1.6) or a power plant (1.3) —
divided by distance. A defence placed forward of your base *pulls the whole wave onto it*. That is a
tool: put a Pillbox where you want the attack to happen, and your army where you want it to be
answered from.

**The corollary is unkind.** After defences, the AI goes for **refineries and harvesters**. Your
economy is the second thing it wants, not the last.

**Repair.** The repair wrench mends structures at 30 HP/s for 0.25 credits per HP, in paid
half-second pulses, but only after the target has gone **3 seconds without taking a hit**. The **Repair
Depot** (800 cr, prereq: vehicle factory) mends *vehicles* with no order at all — park inside 10 m and
it services you at 10 % of max HP per second, up to eight at once, at the same 0.25 per HP. A Warden
at 1 HP costs about 85 credits to repair against 700 to replace, and takes ten seconds. It is the
cheapest structure in the game per credit saved, and most players never build one.

**All four stances differ, and Aggressive is the one that moves.** Setting a stance stamps a post
where the selection stands. *Aggressive* leaves that post to chase a target of opportunity, out to
its firing standoff plus eighteen metres measured from the post, then walks back. *Defensive* never
leaves, but does walk home if something displaces it. *Hold Fire* moves like Defensive and never
pulls the trigger. *Hold Ground* fires freely and never repositions for any reason. So: put your
defensive line on **Hold Ground** so it does not walk off a wall to close on a raider — on
Aggressive it genuinely will — and put engineers, harvester escorts and loaded carriers on
**Hold Fire** so they do not start fights they are not there for.

**Relocating beats rebuilding.** Moving a structure costs 35 % of its build cost (minimum 50) plus
four seconds in transit and two to rise. Selling and rebuilding costs 50 % *and* the full build time
*and* a queue slot. A badly sited War Factory costs 700 to fix, not 1,000 plus 24 seconds. A
superweapon part-way through a charge cannot be relocated at all; a fully charged one can.

**Defend against crushing.** Six hulls flatten infantry — Warden, Anvil, Sledge, Ore Harvester,
Grinder, Scrapjaw. A Javelin or Sunlancer screen standing in the open in front of an armour column is
free kills for the column, and the counter is geometry rather than more infantry: put them behind a
wall run, on rough ground, inside a garrison, or 4 m off the lane the tanks are pathing down. The
pathfinder aims at the attacker's order point, not at your men, so being a metre off the line is
often enough.

---

## 8. Attacking

**Take the midpoint ore field first.** It is 22 m of contested ore on the exact line between the two
starts, and neither player can cover it from home. Denying it is worth more than most raids.

**Engineers are the best value attack in the game — conditionally.**

- A **neutral** structure — the six civilian buildings in the two hamlets — is captured outright at
  any health, by one engineer, with no softening at all.
- An **enemy** structure is captured only at or below **50 % health**. Above it, the engineer is spent
  and knocks 25 % of max HP off instead.
- So a full-health Construction Yard costs exactly three engineers: 100 % → 75 % → 50 % → captured.
  That is 1,500 credits to take a 3,000-credit building, and you get everything built off it.
- A yard your tanks already chewed on costs one engineer.
- An **occupied garrison** cannot be captured. Clear it first.

**Artillery arcs over terrain; nothing else does.** Direct fire is rejected if the ground rises more
than 0.9 m above the sight line — so a tank on the far side of a ridge is visible and unshootable.
`Shell`-firing weapons skip that check entirely. The Slaghurler (42 m, 11 m minimum, 5.8 m splash) is
the only true siege hull in the game, and it can shell a base from behind a terrace face that stops
everything else.

**Harvesters are legitimate targets and the game knows it.** Killing them scores ×1.15 in the
targeting weights, and the AI pulls a harvester home below 55 % health. Two raiders parked on an ore
field cost more than they will ever cost you.

**Push into a brownout.** Nothing in this game punishes a wide push more cheaply than killing power.
Each Soviet or Allied plant is 800 HP, a Solar Array is 420, and every high-end defence goes dark
before anything else does. Once superweapons are on the map this gets sharper still: a silo draws
−150, so the power plants keeping it lit are the countdown, and killing them **pauses** the charge.

**Drive over the screen.** A tank column that lines up on an enemy infantry line kills it for free —
no ammunition, no cooldown, no exposure. It has to actually line up: right-click the ground *behind*
the target, not on him, because the pathfinder aims at your click. The kill radius is about 2.2 m for
a Warden.

**Land a squad where the wall is not.** Every army has a four-slot landing ship and an eight-slot
carrier, and **a slot is not a seat** — infantry cost one, a vehicle costs two — so eight slots is
four tanks or eight riflemen or any mix. Every one of those hulls is water-only and unloads onto the
sand from open water; only the Sandskiff crosses a beach, and it holds two.

The things worth putting aboard are engineers (a hamlet, or an enemy structure your tanks already
softened past 50 %), the anti-structure infantry the Reclamation and the Allies otherwise cannot get
into a base — a Slagger does 27 DPS to concrete for 380 credits, the best rate in the game, and
cannot walk there alive — and, now that vehicles ride, the siege hull that was never going to reach
the far shore under its own power.

**The carrier comes to the shore when you load it.** Select the squad, right-click the hull lying
offshore, and it moves in to collect them. You do not have to drive it onto the beach first, and
before this you could not: the squad walked to the sand and stood there.

---

## 9. Using the map

- **Ramps are guaranteed chokepoints.** They cost 8 % less to path over, which means the flow field
  actively prefers them. On Frozen Sector there are twice as many carved passes as on Airbase Flats;
  on Industrial Grid there are three times as many. Fewer ramps means a more predictable enemy.
- **Wheeled hulls pay double on rough ground.** IFVs, Arcspitters, Grinders, Scrapjaws and
  construction vehicles all reroute around broken terrain that tracked armour drives straight over.
  If you are the wheeled army, the flat route is your route, and your enemy knows where it is.
- **Hover ignores slope entirely.** The Meridian Pact can take lines nobody else can, including
  straight across the small basins on temperate and snow maps.
- **A terrace is worth holding for line of sight, not for a bonus.** There is no high-ground damage or
  range bonus. What you get is a face your enemy's direct fire cannot cross and a ramp they have to
  come up.
- **Roads route, they do not accelerate.** A carriageway is up to 2.4× cheaper to path over for a
  wheeled hull, which means armies funnel down them without being told to. On Industrial Grid that is
  most of the map, and it is the single best place to be waiting.
- **The two civilian hamlets are the only neutral ground worth fighting for.** They sit on the
  perpendicular bisector of the lane between the two openings, mirrored **54–69 m** either side of
  the midpoint with a small seed-driven lane shift and spread. Each is an Oil Derrick flanked by two
  garrisonable blocks and a prop-free forward build pad.
- **A derrick is 15 credits a second, forever, for as long as you hold it.** Over ten minutes that is
  9,000 credits — roughly a free harvester with no War Factory, no 1,400-credit hull and no escort.
  One 500-credit engineer takes one outright at any health.
- **You cannot hold both hamlets, and neither can they.** That is the point of there being two. The
  correct opening play is usually one engineer to the nearer derrick as soon as a barracks and a
  refinery are up, with three or four bodies garrisoning the block beside it — a garrisoned building
  fires with the sum of its occupants' weapons at +6 m range, and an occupied structure cannot be
  captured out from under you.
- **Build a dock on three maps, and you cannot build one anywhere else.** Contested Strait and Coral
  Shore each carry a quarter of the map in open sea — 24.3 % and 26.4 % of cells, one connected body
  of roughly 63,000 and 69,000 m² — and [Sunder Atoll](/avihaymenahem/voltmarch/wiki/Sunder-Atoll) is
  53.8 % water with no land route at all. On the other seven, water covers 0.00–0.23 % in puddles
  smaller than a war factory, and the whole branch is not offered: the sidebar leaves the docks and
  every hull behind them out. Even on a wet map the yard must go on the coast — an inland site is
  refused.
- **The swimmers are the exception and they are cheap.** Frogman 350, Naval Infantry 320, Tidewalker
  380, Dredger 300 — built at the barracks, on any map, and they cross open water under their own
  power. They are slower and dearer than the rifleman standing next to them, so they are a raiding
  tool and the answer to losing your last carrier, not a main line.

---

## 10. The end game

Once your tech building is up — Proving Ground, Reliquary or Crucible — two things change.

**Superweapons.** One or two per army, 2,000–2,500 credits, and the real price is **−150 power**, the
heaviest single draw in the game. Charge times run 5:00 to 7:00 and the countdown only advances while
you own the structure **finished and powered**. Losing it *pauses* the charge rather than resetting
it, so a rebuild resumes where you stopped.

| Weapon | Army | Charge | Radius | What it changes |
| --- | --- | --- | --- | --- |
| Nuclear Missile | Soviets | 7:00 | 26 m | 1,400 HE. Announced 3.5 s early, and the marker is visible to **both** sides |
| Solar Lance | Meridian | 7:00 | 24 m | The same, slightly tighter |
| Lightning Storm | Allies | 6:40 | 16 m | 9 s of Tesla bolts, ~190 each. Devastating on infantry (1.60), poor on a base (0.60) |
| Arc Storm | Reclamation | 6:40 | 17 m | The same |
| Ironclad Field | Soviets | 5:00 | 13 m | **20 seconds of true invulnerability** for everything friendly in the radius |
| Displacement Ring | Allies | 5:00 | 11 m | Nine units from anywhere to anywhere, two clicks |

The two that decide games are not the damage ones. **Ironclad Field plus a Sledge column walks
through a defensive belt that would otherwise stop it**, and a **Displacement Ring puts nine units inside
a base with no approach at all**. Plan the push around the timer rather than firing it when it
happens to be ready.

Because a nuke announces itself 3.5 seconds early *to the target*, it is not an army-killer against
anyone paying attention — it is a structure-killer and an area-denial threat. Aim it at things that
cannot move.

**Commander powers** — Airstrike, Orbital Scan, Emergency Repair, Ore Boost, Chronoshift — are
**bought in the match, from a Command Post**, and they are a real third late-game layer beside the
superweapons and the upgrades. The structure is 1,500 credits and **−80 power** off the radar tier;
the powers are 800 to 2,500 each. Nine thousand credits buys all five, which is most of a starting
bank — so the honest question mid-game is whether that money is better spent on hardware.

Two things make it a decision rather than a shopping list. The **−80** is the third-heaviest draw in
the game, so a Post on top of a Proving Ground wants generation paid for first. And the tab is published
only while the Post is standing and POWERED, so it is a structure worth raiding and a grid worth
protecting (see [Campaign](/avihaymenahem/voltmarch/wiki/Campaign#commander-powers)).

**Commander abilities** are the ones you can actually press, and they are free with your faction's
1,500-credit hero. Iron Will (5 s of invulnerability, 60 s cooldown) is a small Ironclad Field you can
have in the first five minutes, and Chrono Rally pulls six units to the Field Marshal — which is a
retreat button, an ambush button, and the cheapest teleport in the game.

---

## 11. The opponent you are actually playing

The AI issues the same commands you do, through the same command bus. It cannot see through fog, it
cannot reach into entity state and it plays by the same production rules — the sidebar's own
"is this available" and the build ghost's own "can this go here" are the exact calls it makes.

What difficulty changes:

| | Easy | Normal | Hard | Brutal |
| --- | --- | --- | --- | --- |
| Reaction time | 2.4 s | 1.2 s | 0.6 s | 0.3 s |
| Actions per minute | 40 | 90 | 160 | 260 |
| Harvest income | **×0.8** | ×1.0 | ×1.15 | ×1.35 |
| Harvesters it will field | 5 | 7 | 9 | 9 |
| Refineries | 2 | 3 | 3 | 3 |
| Credits it leaves idle | 1,400 | 600 | 250 | 0 |
| Composition quality | 0.15 | 0.55 | 0.85 | 1.00 |
| Static defences | 3 | 6 | 8 | 10 |
| Seconds before it answers aircraft | 12 | 6 | 2.5 | 0 |
| Retreat discipline | 0.35 | 0.65 | 0.85 | 1.00 |

The **economy** is the difficulty. Everything downstream is paced by income, and the composition
figure is the honest skill axis: at 0.15 an Easy AI rolls a flat army and loses to its own decisions;
at 1.00 every unit is picked to answer the threat mix it has actually observed.

Personality biases the scoring rather than the rules. **Turtle** builds defences and masses a large
wave slowly; **Rusher** puts the barracks first, drops the greedy second refinery and commits with
four units; **Boomer** takes a third refinery and the tech lab and pushes late with a fat army.

Behaviours worth knowing:
- It holds **30 % of its army home** as a reserve, minimum two units.
- It pulls a strike group back once it has lost 45 % of its starting size or drops below 40 % average
  health, then regroups for ten seconds.
- Heavy pressure on its base recalls the strike group. A Rusher will trade bases with you; a Turtle
  comes straight home.
- Its wave threshold grows by 2 every time a wave is wiped out, up to a ceiling of ten times its
  difficulty's wave-size multiplier (6 on Easy, 10 on Normal, 14 on Hard, 18 on Brutal). **Beating it
  repeatedly makes the next push bigger.**
- With no Construction Yard it goes all-in with everything, immediately.
- It **mirrors your unlocks**. Anything you have earned, it can build.
- From Normal upward, if it can currently see a legal capturable structure and has four escorts
  available without leaving its base under pressure, it may buy one engineer, escort it with
  Attack-Move, and attempt the capture. Hidden and campaign-vetoed targets are ignored.
- If its last harvester is destroyed and the ordinary economy survey proves that selling can fund
  a replacement, it waits at least twelve seconds, then sells one non-producing structure at a
  time through the same Sell command and for the same 50% refund you receive. It never receives
  the refund bonus used for harvested income, and it will not sell a prerequisite needed by its
  chosen recovery route. Authored campaign opponents keep their scripted bases instead of using
  this generic skirmish recovery.
- **It builds superweapons, and it earns its commander powers the same way you do.** From Normal
  upward it will raise a Command Post and buy the powers its difficulty allows — Normal gets Ore
  Boost and Emergency Repair, Hard adds the Airstrike and the Orbital Scan, Brutal gets all five —
  and then call them off live measurements. Easy builds no Post and buys nothing.
- **It runs amphibious operations.** On a map where the sea is the only road it surveys the water,
  puts a dock on a shore it can walk to, holds a lane with warships and then boards, crosses and
  lands a squad — the same Enter, Move and Unload orders you would issue. It still does not garrison
  a building.

---

## 12. Mistakes new players make

1. **Not deploying the construction vehicle first.** Nothing exists until the yard does — no build
   radius, no power, no income.
2. **Buying the second power plant late.** A brownout turns your defences off *before* it slows your
   economy, and it quarters your build rate.
3. **Massing riflemen against armour.** 0.10 against heavy armour, and they will not even aim at it
   while anything else is in view. Build the anti-armour infantryman: Javelin, Sunlancer, or just
   more tanks.
4. **Massing infantry against splash.** An Anvil's gun has 2.1 m of splash, a Slaghurler's 5.8, and
   Tesla arcs chain 9 m from every victim.
5. **Skipping the second refinery.** 2,000 credits for 2,000 storage and a free 1,400-credit
   harvester.
6. **Letting ore overflow.** Anything above your storage cap is burned. A silo is 150 credits.
7. **Never building a Repair Depot.** 800 credits, and a full hull repair costs 25 % of the unit's
   HP in credits and ten seconds.
8. **Ignoring the midpoint ore field.**
9. **Selling instead of relocating.** 35 % beats 50 % plus the rebuild time.
10. **Never sending an engineer to a derrick.** 500 credits, one walk, 15 credits a second for the
    rest of the match. It is the cheapest income in the game and most players never take one.
11. **Standing a Javelin screen in front of an armour column.** Infantry are crushable now. Put them
    behind a wall, on rough ground, or off the lane.
12. **Building a superweapon without buying the generation first.** −150 power browns out a base that
    was comfortable, which turns your defences off and stops the countdown you just paid for.
13. **Expecting objective credits to arrive.** They do not. See [Campaign](/avihaymenahem/voltmarch/wiki/Campaign).

### Things that look like tools and are not

Be aware of these before you build a plan around one:

- **Naval is map-dependent.** Contested Strait, Coral Shore and Sunder Atoll carve a real sea; the
  other seven carry 0.00–0.23 % in puddles and are not offered the branch at all. Pick a wet map or
  plan without it — and note that a carrier no longer works on land, so there is no such thing as
  using one as a fast land ferry. The four swimmer infantry are the exception: barracks-built, on
  every map.
- **The Refractor Tank does not crush**, despite carrying a crush level of 2. It is missing the flag the
  crush resolver actually reads. Every other Allied and Soviet tank crushes; this one does not.
- **Vehicles cannot ram vehicles.** Eleven hulls carry a crushable-by number and nothing reads it.
  Only infantry are crushable.
- **Aggressive really does chase, and it is worst on aircraft.** The envelope is the unit's firing
  standoff plus eighteen metres from its post, so the four airframes re-engage from thirty-two to
  thirty-six metres out. Aircraft now leave the factory on Defensive; if you deliberately switch one
  to Aggressive, use Defensive again before relying on a short retreat.
- **Roads are not a speed bonus.** They change routing, not velocity.
- **There is no high-ground advantage.** Terrain blocks direct fire; it does not buff it.
- **Objective credits are never paid.** See [Campaign](/avihaymenahem/voltmarch/wiki/Campaign).
- **Cosmetic rewards are profile honours, not unit paint.** All seventeen insignia and decals render
  in the [Service Record](/avihaymenahem/voltmarch/wiki/Service-Record), with their paying mission
  and live progress. They are not projected onto vehicles or buildings.
- **Passengers do not shoot.** A loaded carrier fires with its own gun and nothing else. A
  *garrison* volleys with everyone inside; a carrier is a delivery.

---

**Factions:** [Allied Forces](/avihaymenahem/voltmarch/wiki/Faction-Allies) · [Soviet Union](/avihaymenahem/voltmarch/wiki/Faction-Soviets) · [Meridian Pact](/avihaymenahem/voltmarch/wiki/Faction-Meridian-Pact) · [The Reclamation](/avihaymenahem/voltmarch/wiki/Faction-Reclamation)

**See also:** [Maps](/avihaymenahem/voltmarch/wiki/Maps) · [Campaign](/avihaymenahem/voltmarch/wiki/Campaign) · [Combat](/avihaymenahem/voltmarch/wiki/Combat) · [Economy](/avihaymenahem/voltmarch/wiki/Economy) ·
[Base Building](/avihaymenahem/voltmarch/wiki/Base-Building) · [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) · [Multiplayer](/avihaymenahem/voltmarch/wiki/Multiplayer)
