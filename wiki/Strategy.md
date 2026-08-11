# Strategy

Everything below is derived from the game's actual numbers — the weapon table, the armour matrix,
the build costs and the AI's own doctrine tables — not from RTS folklore. Where a claim is arithmetic
it is stated as arithmetic. Where it is a judgement call it says so.

New here? Read [How to Play](How-to-Play) and [Controls](Controls) first. This page assumes you know
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

### The same opening, per faction

**Meridian Pact.** Solar Array → **Chapterhouse** → Ore Cistern → Forgeyard → Solar Array → Oculus.
Barracks second is the whole faction identity: the array's surplus buys a screen of Wayfarers
(175 cr, 5 s) before the first refinery has paid for itself, and the Pact's line is too fragile to
survive an early rush with nothing on the field.

**The Reclamation.** Scrap Furnace → **Rookery** → Ore Sorter → Scrap Furnace → Breaker Yard →
Spotter Mast. Same shape, and for the same reason: three Scrap Pickers cost 270 credits and nine
seconds. The Breaker Yard is 1,900/22 s against everyone else's 2,000/24, and a Grinder is 600/9 s
against a Grizzly's 700/11 and a Rhino's 900/13. The Reclamation's whole case is that it arrives
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
cancelling refunds exactly what was paid — never a percentage. Queueing an Apocalypse and cancelling
it at 90 % costs nothing but the time. Use the queue as a bank when you are saving for a structure.

**Extra factories are build speed, not extra queues.** All Barracks feed one infantry queue; each
additional one adds 35 % to its rate, capped at 2.0×. A second War Factory is a 2,000-credit build
speed upgrade, not a second production line.

---

## 4. Scouting

Fog of war is a flat circle stamp. **Terrain does not block vision** — a unit at the bottom of a cliff
sees exactly as far as one on top of it. Structures see 3 m further than their listed sight.

Sight radii worth knowing: Radar Dome 44 · Oculus 46 · Spotter Mast 42 · Kestrel 36 · Multigunner IFV
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
3. The count of enemy refineries. Two means they are teching; one means they are massing.
4. Static defence. The AI's own target scoring values enemy defences *above everything else*, and so
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

- **Small arms cannot fight vehicles.** 0.10 against heavy armour. A lone G.I. needs eighty seconds
  to kill a Rhino Tank and one hundred and fifty-three to kill an Apocalypse.
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
- **Multigunner IFVs and Sandskiffs deprioritise heavy tanks and structures.**

Force-fire overrides it. So does an explicit attack order — the air veto is the only gate that
survives an explicit click.

Other targeting weights, in case you wonder why your army picked what it picked: something that can
shoot back scores ×1.6, whoever last hit you ×1.5, a defensive structure ×1.3, a harvester ×1.15, a
target under 40 % health ×1.25, the target you already had ×1.35, and a non-defensive building ×0.55.
**Your army will ignore an enemy's power plants while anything armed is alive.**

### Effective damage per second

Cycle time is `(burst − 1) × burst delay + cooldown`; effective DPS is raw DPS times the matrix cell.
These are single-unit, no-veterancy figures against a stationary target in range.

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
| **Multigunner IFV** | 600 | 220 Light | 22 | **93** | **116** | **75** | 41 | 41 |
| Sandskiff | 550 | 190 Light | 23 | 80 | 100 | 65 | 35 | 35 |
| Arcspitter | 420 | 170 Light | 16 | 51 | 30 | 27 | 28 | 19 |
| Grizzly Tank | 700 | 340 Med | 24 | 13 | 31 | 37 | 37 | 20 |
| Rhino Tank | 900 | 420 Heavy | 26 | 14 | 33 | 39 | 39 | 22 |
| Solarch | 800 | 330 Light | 26 | 13 | 32 | 38 | 38 | 21 |
| Grinder | 600 | 270 Med | **18** | 59 | 35 | 31 | 33 | 22 |
| Apocalypse | 1,750 | 800 Heavy | 28 | 16 | 40 | 47 | 47 | 26 |
| Prism Tank | 1,200 | 260 Light | 30 | 39 | 34 | 34 | 32 | 28 |
| Zenith Emitter | 1,500 | 240 Light | 33 | 36 | 31 | 31 | 29 | 26 |
| Slaghurler | 1,150 | 230 Light | **42** | 26 | 23 | 19 | 14 | **29** |
| Kestrel Gunship | 1,100 | 210 Light | 22 | 24 | 41 | 38 | 41 | 38 |
| Swarmhornet | 900 | 180 Light | 17 | 47 | 28 | 25 | 26 | 18 |

Add to that: **Tesla weapons chain.** Each arc jumps up to 9 m from its last victim, retaining 60 %
of the damage per link. A Grinder chains twice and a Scrap Picker once, so the table above understates
every Reclamation unit against a blob and states it correctly against a single target.

Add also: **splash.** The Slaghurler's mortar is 5.8 m, the Slagger's satchel 2.6 m, the Rhino's gun
2.1 m, the Javelin's rocket 2.4 m. Massed infantry against splash is a donation.

### The duels that actually come up

| Matchup | Result |
| --- | --- |
| Grizzly vs Rhino | **Rhino wins** 1v1 (8.7 s vs 11.4 s) and outranges by 2 m. But at equal credits three Grizzlies beat two-and-a-third Rhinos on both HP and DPS. |
| IFV vs Grizzly | **IFV wins**, 4.5 s to 7.1 s, at 100 credits less and 1.8 m/s faster. |
| IFV vs Rhino | **Rhino wins**, 6.6 s to 10.4 s. Autocannon at 0.35 against heavy armour is the whole answer. |
| Solarch vs Grizzly | **Solarch wins** narrowly and outranges by 2 m. |
| IFV vs Solarch | **Not close.** 2.9 s to 6.9 s. Autocannon at 1.00 against light armour deletes the entire Pact line. |
| Grinder vs Grizzly | **Grizzly wins** 1v1 and gets six metres of free fire first. At equal credits it is a coin flip, and the Grinder chains. |
| Javelins vs Rhinos | **Javelins win on credits by a wide margin** — four Javelins (2,000 cr) kill a Rhino in 4.1 s. The counter-play the game clearly intends (drive over them) does not exist: see §11. |

### The three holes worth exploiting

1. **Meridian's whole line is Light armour.** Every Pact vehicle and ship is light-armoured with a
   deep HP pool. Autocannon rises from 0.65 against medium to 1.00 against light, and small arms from
   0.28 to 0.55. IFVs, Sandskiffs, Flak Troopers and massed infantry all get roughly double value
   against the Pact.
2. **The Reclamation cannot take a base apart.** Tesla is 0.60 against concrete and every arc is
   14–20 m ranged. Its only real answers to a structure are the Slaghurler and the Slagger. Kill
   those two and a Reclamation army can stand in your base achieving very little.
3. **Half the good weapons need power.** The Tesla Coil, Prism Tower, Helios Spire, Zenith Emitter and
   both Pact beams all stop firing in a brownout. Kill power plants — Solar Arrays have 420 hp — and
   a defensive belt goes dark without a single shot at the towers themselves. The exceptions are the
   Reclamation's Spitpost (draws no power) and Arc Pylon (draws 90 and fires regardless).

### Aircraft

Only the Meridian Pact and the Reclamation have aircraft, and only after twelve wins as the Pact.
Aircraft ignore terrain, water, cliffs and buildings entirely and cruise at 22 m.

**A weapon can only shoot up if its row says so.** Tank cannons, artillery, flamethrowers, torpedoes,
naval deck guns, siege beams and the emplaced MG in a pillbox cannot. What can:

| Answer | Range | Notes |
| --- | --- | --- |
| Rifles / Carbines (G.I., Conscript, Wayfarer) | 17–20 | Free, but weak |
| Multigunner IFV, Sandskiff | 22 / 23 | Autocannon at 0.95 against light-armoured aircraft |
| Flak Trooper | 20 | 300 cr, 32 DPS against light |
| Javelin, Sunlancer | 24 / 26 | 0.95 rocket multiplier |
| Scrap Picker, Arcspitter, Swarmhornet | 14–17 | Reclamation's only answers, all short |
| **Multigunner AA** | 26 | The only dedicated AA structure — **Allied only** |
| Tesla Coil, Prism Tower, Helios Spire, Arc Pylon | 28–34 | All double as AA |
| Kestrel Gunship | 22 | Air-to-air, which is why owning the only aircraft is not unanswerable |

Note the asymmetry: the Pact and the Reclamation have **no dedicated AA emplacement at all**. Their
answer to a gunship is the Sunlancer and the Arcspitter, which are units and have to be somewhere.

---

## 6. Army composition

The honest general rule is a **2:1 line-to-answer ratio**, with the answer chosen from what you
scouted. Concretely:

**[Allied Forces](Allied-Forces).** Grizzlies are the line. The Multigunner IFV is, on the numbers, the better tank
against everything except heavy armour — cheaper, faster, longer-sighted and nearly twice the damage.
Mix them roughly evenly and use Grizzlies as the anti-Rhino element. Javelins behind the armour, not
in front: they have 24 m of range against a Rhino's 26 and have to walk into the gun. Prism Tanks
must stop to fire and die to anything that reaches them — keep them behind the line at 30 m.

**[Soviet Union](Soviet-Union).** Rhinos win fights and lose exchange rates. Conscripts are the best anti-infantry
value in the game at 0.50 DPS per credit — screen with them and let the Rhinos shoot armour.
Flak Troopers are the light-armour answer, not the heavy one: 1.00 against light and 0.35 against
heavy. The Soviet answer to heavy armour is heavier armour. The Apocalypse is poor per credit (0.027
DPS per credit against medium) and good where concentration matters — 800 HP, 28 m, and it cannot be
crushed by anything.

**[Meridian Pact](Meridian-Pact).** A Pact line wins a standoff and loses a brawl: every Pact gun outranges its
opposite number by 1–3 m and under-damages it. Fight at maximum range, retreat rather than trade, and
screen with Wayfarers, because massed infantry is what the army is worst against. Everything hovers,
so slope costs you nothing and you can take routes tracked armies will not. Never let an IFV or a
conscript wave reach the line.

**[The Reclamation](The-Reclamation).** Nothing you field has a turret, so every hull must point its chassis at what it
wants to kill, inside a range band where everyone else is already shooting. The compensation is a full
extra radian per second of hull turn and the cheapest units in the game. Play it as swarm-and-replace:
Pickers and Grinders in numbers, arcs chaining through the enemy line, Slaghurlers held back at 42 m
for anything made of concrete. Never fight at 24 m — close or leave.

**Numbers that scale.** Veterancy is worth more than it looks. Three kills gives rank 1 (×1.15
damage, ×1.10 HP, ×0.9 cooldown); six gives rank 2 (×1.35 damage, ×1.25 HP, ×0.8 cooldown). An elite
unit does **1.69×** the damage of a rookie and takes 25 % more to kill. Keeping a damaged veteran
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
| Multigunner AA | Allies | 800 | 550 | 26 | −30 | **yes** |
| Tesla Coil | Soviets | 1,500 | 700 | 30 | −75 | yes |
| Prism Tower | Allies | 1,500 | 600 | **34** | −50 | yes |
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

**Repair.** The repair wrench mends structures at 30 HP/s for 0.25 credits per HP. The **Repair
Depot** (800 cr, prereq: vehicle factory) mends *vehicles* with no order at all — park inside 10 m and
it services you at 10 % of max HP per second, up to eight at once, at the same 0.25 per HP. A Grizzly
at 1 HP costs about 85 credits to repair against 700 to replace, and takes ten seconds. It is the
cheapest structure in the game per credit saved, and most players never build one.

**Stances** matter more than they look. *Aggressive* chases; *Defensive* fires but never moves;
*Hold Ground* fires freely and never moves for any reason; *Hold Fire* moves and never shoots. Put
your defensive line on Hold Ground so it does not chase a raider out of position, and put engineers
and harvester escorts on Hold Fire so they do not wander.

**Relocating beats rebuilding.** Moving a structure costs 35 % of its build cost (minimum 50) plus
four seconds in transit and two to rise. Selling and rebuilding costs 50 % *and* the full build time
*and* a queue slot. A badly sited War Factory costs 700 to fix, not 1,000 plus 24 seconds.

---

## 8. Attacking

**Take the midpoint ore field first.** It is 22 m of contested ore on the exact line between the two
starts, and neither player can cover it from home. Denying it is worth more than most raids.

**Engineers are the best value attack in the game — conditionally.**

- A **neutral** structure is captured outright at any health. (There are none on the shipped maps —
  see [Maps](Maps).)
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
before anything else does.

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
- **Do not build a Naval Yard.** No playable map carves a sea. Measured across all six shipped maps,
  water covers 0.0–0.6 % of cells and the largest body in the game is about 1,000 m². The entire
  naval branch — two unlock chains, five structures and eight hulls — has nowhere to float.

---

## 10. The opponent you are actually playing

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

---

## 11. Mistakes new players make

1. **Not deploying the construction vehicle first.** Nothing exists until the yard does — no build
   radius, no power, no income.
2. **Buying the second power plant late.** A brownout turns your defences off *before* it slows your
   economy, and it quarters your build rate.
3. **Massing riflemen against armour.** 0.10 against heavy armour, and they will not even aim at it
   while anything else is in view. Build the anti-armour infantryman: Javelin, Sunlancer, or just
   more tanks.
4. **Massing infantry against splash.** A Rhino's gun has 2.1 m of splash, a Slaghurler's 5.8, and
   Tesla arcs chain 9 m from every victim.
5. **Skipping the second refinery.** 2,000 credits for 2,000 storage and a free 1,400-credit
   harvester.
6. **Letting ore overflow.** Anything above your storage cap is burned. A silo is 150 credits.
7. **Never building a Repair Depot.** 800 credits, and a full hull repair costs 25 % of the unit's
   HP in credits and ten seconds.
8. **Ignoring the midpoint ore field.**
9. **Selling instead of relocating.** 35 % beats 50 % plus the rebuild time.
10. **Expecting objective credits to arrive.** They do not. See [Campaign](Campaign).

### Things that look like tools and are not

Be aware of these before you build a plan around one:

- **Transports do not carry anything.** The Hover Transport exists, is unlockable, and has zero cargo
  capacity. Right-clicking a transport with infantry selected issues an Enter order which the garrison
  system refuses because a transport is not a structure. There is no load, no unload, no passenger.
- **Infantry cannot be crushed.** Every foot unit is authored as crushable and every tank has a crush
  level; the code deliberately does not read them. Vehicles flatten trees and shrubs, permanently,
  and drive around boulders. A wall of riflemen is a wall.
- **Superweapons are not reachable.** Four are implemented in the simulation — Nuclear Missile, Iron
  Curtain, Chronosphere, Lightning Storm — and none of them has a button, a hotkey or a countdown on
  the HUD. They also gate on the Battle Lab specifically, so the Meridian Pact and the Reclamation
  have none at all.
- **Commander *powers* do nothing; commander *abilities* work.** The five power rewards from the
  mission table have no consumer. The four hero abilities — Chrono Rally, Iron Will, Prism Focus,
  Salvage Call — are on the HUD, have a hotkey and a cooldown ring, and are excellent. Build your
  commander: 1,500 credits, one at a time, needs only a barracks and a radar.
- **Roads are not a speed bonus.** They change routing, not velocity.
- **There is no high-ground advantage.** Terrain blocks direct fire; it does not buff it.
- **Naval is unusable.** See §9.

---

**Factions:** [Allied Forces](Allied-Forces) · [Soviet Union](Soviet-Union) · [Meridian Pact](Meridian-Pact) · [The Reclamation](The-Reclamation)

**See also:** [Maps](Maps) · [Campaign](Campaign) · [Combat](Combat) · [Economy](Economy) ·
[Base Building](Base-Building) · [Units and Verbs](Units-and-Verbs) · [Multiplayer](Multiplayer)
