# Combat

Everything about how a shot becomes a kill: the armour matrix, weapon ranges and
cooldowns, how units pick targets, stances, veterancy, fog of war, and what a
corpse leaves behind.

If you have not built a base yet, start with [How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) and
[Base Building](/avihaymenahem/voltmarch/wiki/Base-Building). For which unit to build against which army, see
[Strategy](/avihaymenahem/voltmarch/wiki/Strategy).

---

## 1. The armour matrix

Every shot carries a **warhead**. Every target has an **armour class**. The
multiplier where they meet is the whole counter-triangle of this game.

Damage dealt = `weapon damage x matrix multiplier x veterancy bonus x splash falloff`.

| Warhead \ Armour | Infantry | Light | Medium | Heavy | Concrete | Wood |
|---|---|---|---|---|---|---|
| **Small Arms** | 1.00 | 0.55 | 0.28 | **0.10** | 0.18 | 0.60 |
| **Autocannon** | 0.80 | **1.00** | 0.65 | 0.35 | 0.35 | 0.80 |
| **Armour-Piercing** | 0.35 | 0.85 | **1.00** | **1.00** | 0.55 | 0.75 |
| **High Explosive** | 0.90 | 0.80 | 0.65 | 0.50 | **1.00** | 1.00 |
| **Rocket** | 0.55 | 0.95 | 0.90 | 0.95 | 0.90 | 0.85 |
| **Tesla** | **1.60** | 0.95 | 0.85 | 0.90 | 0.60 | 0.70 |
| **Prism** | 1.10 | 0.95 | 0.95 | 0.90 | 0.80 | 0.90 |

Read it as shapes, not as numbers:

- **Small arms shred flesh and bounce off tanks.** A G.I.'s rifle does 18 damage
  a round; against a Rhino that is 1.8. Riflemen are not a mistake against
  armour, they are nothing at all.
- **Armour-piercing is the anti-tank answer and wastes itself on infantry.**
  A Grizzly's 90 mm does 55 to another tank and 19 to a conscript.
- **High explosive is the building-killer** and the only warhead at 1.00 against
  Concrete. Artillery, naval guns, mortars.
- **Autocannon owns Light.** Every aircraft in the game is Light armour, so the
  Autocannon column is also the anti-air column.
- **Tesla deletes infantry** at 1.60 and bounces off bases at 0.60.
- **Prism ignores most armour scaling** — 0.80 to 1.10 across the board — which
  is exactly why it is slow and expensive.

### Armour classes, by what wears them

| Class | Who has it |
|---|---|
| Infantry | Every foot unit, including all four commanders |
| Light | IFV, Prism Tank, all aircraft, most Pact hulls, most Reclamation hulls, escort ships, all four recon hulls, and every carrier except the Slag Hauler |
| Medium | Grizzly, Grinder, Aircraft Cruiser, Sunmonitor |
| Heavy | Rhino, Apocalypse, harvesters, construction vehicles, Dreadnought, Reclaimed Hulk, **Slag Hauler** |
| Concrete | Every structure |
| Wood | Wrecks, crates, trees and rocks |

A Meridian design note that matters at the table: the Pact's main line is
**Light with a deep health pool** rather than Medium with a shallow one. A
Solarch trades evenly with a Grizzly (AP falls 1.00 to 0.85) and is deleted by
an IFV or a squad of conscripts (Autocannon rises 0.65 to 1.00, small arms 0.28
to 0.55).

---

## 2. Weapons

Damage is **per round, before the matrix**. "Cycle" is the full trigger pull
including the gaps inside a burst; raw DPS is `damage x rounds / cycle` and is
what the gun does *before* armour is applied. Chain weapons do more than this
column says — see [Chain lightning](#chain-lightning).

### Infantry

| Weapon | Carried by | Damage | Warhead | Range | Cycle | Raw DPS | Splash | Hits air |
|---|---|---|---|---|---|---|---|---|
| M1 Carbine | G.I., Frogman | 18 x3 | Small Arms | 18 | 1.03 s | 52 | – | yes |
| AK Pattern | Conscript, Naval Infantry | 16 x3 | Small Arms | 17 | 0.96 s | 50 | – | yes |
| Pulse Carbine | Wayfarer, Tidewalker | 15 x3 | Small Arms | 20 | 0.96 s | 47 | – | yes |
| Arc Prod | Scrap Picker, Dredger | 26 | Tesla | 14 | 1.05 s | 25 | – | yes |
| Jaws | Attack Dog | 55 | Small Arms | 3.6 | 1.10 s | 50 | – | no |
| Shoulder Rocket | Javelin | 60 | Rocket | 24 | 2.20 s | 27 | 2.4 | yes |
| Flak Burst | Flak Trooper | 11 x4 | Autocannon | 20 | 1.36 s | 32 | 1.1 | yes |
| Sun Lance | Sunlancer | 58 | Rocket | 26 | 2.40 s | 24 | 2.0 | yes |
| Slag Charge | Slagger | 74 | High Explosive | 12 | 2.70 s | 27 | 2.6 | no |

The two anti-armour infantrymen are deliberately asymmetric. The **Javelin**
buys the warhead (Rocket, 0.95 against Heavy) and deletes an Apocalypse. The
**Flak Trooper** buys volume (Autocannon, 1.00 against Light, 0.35 against
Heavy) and only chips one — the Soviet answer to a heavy tank is still a heavier
tank. Both elevate, so both are also anti-air.

### Vehicles and aircraft

| Weapon | Carried by | Damage | Warhead | Range | Cycle | Raw DPS | Splash | Hits air |
|---|---|---|---|---|---|---|---|---|
| 90 mm Cannon | Grizzly, Picket Boat | 55 | Armour-Piercing | 24 | 1.50 s | 37 | 1.6 | no |
| 125 mm Cannon | Rhino | 78 | Armour-Piercing | 26 | 2.00 s | 39 | 2.1 | no |
| Twin 125 mm | Apocalypse | 60 x2 | Armour-Piercing | 28 | 2.58 s | 47 | 2.2 | no |
| 25 mm Multigunner | Multigunner IFV, Hydrofoil | 11 x5 | Autocannon | 22 | 0.84 s | 65 | – | yes |
| Prism Emitter | Prism Tank, Field Marshal | 92 | Prism | 30 | 2.60 s | 35 | – | no |
| Focus Lance | Solarch, Hierarch | 60 | Armour-Piercing | 26 | 1.60 s | 38 | 1.4 | no |
| Arc Repeater | Sandskiff | 13 x4 | Autocannon | 23 | 0.76 s | 68 | – | yes |
| Zenith Emitter | Zenith Emitter | 94 | Prism | 33 | 2.90 s | 32 | – | no |
| Spit Coil | Arcspitter, Scrap Skimmer | 30 | Tesla | 16 | 0.95 s | 32 | – | yes |
| Grinder Arc | Grinder, Scrap Baron | 70 | Tesla | 18 | 1.90 s | 37 | – | no |
| Slag Mortar | Slaghurler | 124 | High Explosive | 42 (min 11) | 4.30 s | 29 | 5.8 | no |
| Vindicator AGM | Vindicator | 62 x2 | Rocket | 23 | 2.58 s | 48 | 2.2 | yes |
| MiG Autocannon | MiG Fighter | 24 x3 | Autocannon | 21 | 0.76 s | 95 | 0.9 | yes |
| Kestrel Pod | Kestrel Gunship | 44 x2 | Rocket | 22 | 2.06 s | 43 | 1.8 | yes |
| Hornet Arc | Swarmhornet | 44 | Tesla | 17 | 1.50 s | 29 | – | yes |
| Tesla Coil (bolt) | War Commissar | 120 | Tesla | 30 | 2.40 s | 50 | – | yes |

### Naval

| Weapon | Carried by | Damage | Warhead | Range | Cycle | Raw DPS | Splash | Hits air |
|---|---|---|---|---|---|---|---|---|
| 5 in Deck Gun | Assault Destroyer, Aircraft Cruiser | 74 | High Explosive | 34 | 2.20 s | 34 | 3.6 | no |
| Torpedo Tube | Attack Submarine | 105 | Rocket | 30 | 3.40 s | 31 | 3.0 | no |
| Cruise Battery | Dreadnought | 120 x2 | Rocket | 42 | 4.35 s | 55 | 4.5 | yes |
| Mirror Battery | Kite Corvette, Sun Cutter | 70 | High Explosive | 33 | 2.10 s | 33 | 3.4 | no |
| Monitor Lance | Sunmonitor | 110 x2 | Rocket | 40 | 4.12 s | 53 | 4.2 | yes |
| Scow Gun | Slag Scow | 68 | High Explosive | 32 | 2.30 s | 30 | 3.2 | no |
| Hulk Battery | Reclaimed Hulk | 116 x2 | High Explosive | 38 | 3.90 s | 59 | 4.4 | no |

### Emplacements

| Weapon | Structure | Damage | Warhead | Range | Cycle | Raw DPS | Needs power | Hits air |
|---|---|---|---|---|---|---|---|---|
| Emplaced MG | Pillbox, Sentry Gun | 20 x5 | Small Arms | 22 | 0.69 s | 145 | no | no |
| Flame Nozzle | Flame Tower | 26 | High Explosive | 18 | 0.50 s | 52 | no | no |
| Glaive Repeater | Glaive Post | 21 x5 | Small Arms | 24 | 0.69 s | 152 | no | no |
| Post Coil | Spitpost | 34 | Tesla | 20 | 0.85 s | 40 | no | no |
| Flak Battery | Multigunner AA | 34 x3 | Autocannon | 26 | 0.82 s | 124 | no | **yes** |
| Prism Cannon | Prism Tower | 115 | Prism | 34 | 3.00 s | 38 | **yes** | **yes** |
| Tesla Coil | Tesla Coil | 120 | Tesla | 30 | 2.40 s | 50 | **yes** | **yes** |
| Helios Lance | Helios Spire | 116 | Prism | 33 | 2.80 s | 41 | **yes** | **yes** |
| Pylon Arc | Arc Pylon | 94 | Tesla | 28 | 2.20 s | 43 | no | **yes** |

The V4 Launcher (130 HE, 48 m, 6.5 splash, 12 m minimum range) exists in the
armoury and no unit in the current roster carries it.

### Which guns can shoot up

Air is a hard veto applied *before* the armour matrix, and an explicit attack
order does not bypass it — a tank ordered onto a gunship will track it with the
turret and never pull the trigger.

**Can hit air:** every rifle and carbine — which includes all four swimmer
infantry — the Arc Prod, the Javelin, the Flak Trooper, the Sunlancer, the IFV
chaingun and the Hydrofoil that shares it, the Sandskiff's repeater, the Scrap
Skimmer's coil, all four aircraft, the Dreadnought and the Sunmonitor, and the
Multigunner AA, Prism Tower, Tesla Coil, Helios Spire and Arc Pylon.

**Cannot:** every tank cannon — including the one the Picket Boat carries to
sea — every artillery piece, the flamethrower, the torpedo, the naval deck guns,
the Mirror Battery on both the Corvette and the Sun Cutter, the siege beams, the
emplaced MG, the Glaive Post and the Spitpost.

That gap is the point of owning aircraft: an armoured column with no escort
genuinely cannot answer one.

---

## 3. How a shot resolves

**Range is measured to the target's surface, not its centre.** A 3x3
Construction Yard reaches about 8.5 m from its middle, so a 24 m gun opens fire
at 32 m from the centre of one.

**Bursts.** A weapon with `x3` fires three rounds separated by its burst delay
(0.06–0.35 s), then pays the full cooldown. The cycle column above is the whole
loop.

**Turret traverse.** A unit with a turret may fire within **5 degrees** of the
correct bearing. A unit without one welds its gun to the hull and may fire
within **14 degrees** — it has to point its whole chassis at the target. This is
the entire signature of the Reclamation: not one of their eleven hulls has a
turret, and they pay for it with a full extra radian per second of hull turn.
Armed structures always traverse, whatever their model looks like.

**Stop-to-fire.** The Prism Tank, the Zenith Emitter, the Slaghurler and the V4
launcher must be stationary (under 0.45 m/s) to shoot.

**Minimum range.** The Slag Mortar (11 m) and the V4 (12 m) cannot fire at
anything closer. A target that walks inside the dead zone stops being a target
at all.

**Power.** A weapon marked *needs power* is silent while its owner's grid is
browned out. That covers both Pact beams, the Soviet Tesla Coil and the Allied
Prism Tower — but **not** the Reclamation's coils, which fire through a
blackout. The Pact pays for its cheap power by having its best guns go dark.

**Lead.** Travelling projectiles (bullets, shells, rockets) are aimed ahead of a
moving target. Beams, hitscan and Tesla bolts are instantaneous and are not.

**Line of sight is terrain only.** Units and buildings never block fire — a
second rank shoots through the first. A ridge does block it, and **arcing
weapons skip the check entirely**, which is the whole reason to own artillery.

---

## 4. Acquiring targets

A unit re-scans for a target roughly every eighth tick, and immediately if the
one it held just died. What it picks is scored:

| Factor | Multiplier |
|---|---|
| Target can shoot back | x1.6 |
| Target is a defensive structure | x1.3 |
| Target is a harvester | x1.15 |
| Target is under 40% health | x1.25 |
| Target damaged us in the last 4 s | x1.5 |
| Target we are already shooting | x1.35 |
| Target is a non-defensive building | **x0.55** |
| Our warhead scores 0.35 or less against it | **x0.35** |

Then divided by distance. Net effect: units shoot things that shoot back,
prefer things they can actually hurt, finish wounded targets, take revenge, and
leave undefended buildings for last.

The "ineffective" penalty is why **your riflemen will not voluntarily shoot a
tank** while any softer target is nearby. That is working as intended; it is
also why the Javelin and the Flak Trooper exist.

**Hysteresis.** A unit acquires at 1.08x its weapon range and does not drop the
target until 1.28x. The gap stops an army on a range boundary from twitching.

**Closing on an ordered target.** A unit given an explicit attack order drives
until the target's surface is at **80%** of its weapon range, then parks. It
only starts moving again if the target escapes past **95%**. A 42 m mortar
therefore halts 33.6 m from a wall rather than driving onto it. Artillery with a
minimum range never parks inside its own dead zone.

---

## 5. Stances

Four stances, cycled with **Z** or set directly from the icons under the
selection panel.

| Stance | What it actually does |
|---|---|
| **Aggressive** | Fires at anything in range. |
| **Defensive** | Fires at anything in range. Stamps a guard point where you set it. |
| **Hold Fire** | Never acquires and never fires unless you force-fire it. Still moves and still closes on an attack order. |
| **Hold Ground** | Fires freely, and **never moves for any reason** — including refusing to close on an attack order. |

Be honest about this one: **Aggressive and Defensive are the same thing in this
build.** No stance makes a unit chase a target of opportunity — a unit that
acquires something out of range simply tracks it and waits. Only an explicit
attack order or attack-move makes a unit advance. The guard point Defensive
stamps is written and nothing reads it; there is no leash. Hold Fire and Hold
Ground are real and both are worth using — Hold Fire on a scout keeps it from
picking fights, Hold Ground on a chokepoint garrison means it.

**Guard (G)** puts a unit into a holding state: it stays put, engages whatever
comes into range, and counts as resting for regeneration. It does not return to
a guard point afterwards, because it never left it.

---

## 6. Veterancy

Kills promote. Ranks are shown as chevrons on the unit.

| Rank | Kills needed | Damage | Max HP | Reload |
|---|---|---|---|---|
| Rookie | – | x1.00 | x1.00 | x1.00 |
| Veteran | 3 | x1.15 | x1.10 | x0.90 |
| Elite | 6 | x1.35 | x1.25 | x0.80 |

A promotion raises max HP and heals by **exactly the amount gained** — it is
never a free full heal. An elite unit is roughly 1.7x the damage output of a
rookie once the reload bonus is counted, on top of 25% more health. Keeping
veterans alive is the single cheapest upgrade in the game.

Kills on your own allies do not count. A **Promotion crate** grants one rank
immediately.

---

## 7. Splash and friendly fire

Splash is resolved against each victim's **hull**, not its centre, so a shell
landing against a wall damages the building even though its middle is 12 m away.

- Falloff is concentrated near the crater: a victim at the rim takes the
  weapon's stated rim fraction (usually 25–30%), and the curve is steeper than
  linear, so one artillery shell does not delete a loose formation.
- **Friendly fire is real** and is halved. Your own artillery clipping your own
  tanks hurts; it just hurts half as much. Direct fire never friendly-fires —
  only blasts do.
- One blast touches at most 64 things.

This is why artillery has a minimum range, and why **Scatter (X)** exists.

### Chain lightning

Tesla weapons jump. The bolt hits its target, then hops to the nearest un-hit
hostile within **9 m of the previous victim**, carrying **60%** of the damage
each link — and it follows the victims, not the shooter, so it walks down a
column.

| Weapon | Extra links | Damage sequence |
|---|---|---|
| Arc Prod, Spit Coil, Post Coil | 1 | 100%, 60% |
| Tesla Coil, Grinder Arc, Hornet Arc | 2 | 100%, 60%, 36% |
| Arc Pylon | 3 | 100%, 60%, 36%, 21.6% |

Against Tesla's 1.60 multiplier on Infantry, an Arc Pylon aimed into a squad is
doing 150 to the first man and still 32 to the fourth. Do not walk infantry into
the Reclamation in a clump.

---

## 8. Fog of war and vision

Three states per cell:

| State | What you see |
|---|---|
| **Unexplored** | Black. The terrain itself is not drawn. |
| **Explored** | Terrain and **static** objects you have seen — buildings, wrecks, props — drawn from memory. Nothing that moves. |
| **Visible** | Lit right now. Everything. |

A remembered structure is drawn and can be clicked, but **cannot be auto-targeted** —
a Construction Yard you scouted an hour ago is not a legal target of opportunity.
Force-fire (Ctrl + right-click, or **F**) works into pitch black; it shells a
*point*, not a unit.

Vision is stamped ten times a second, and a cell stays lit for **2 seconds**
after the last thing leaves it. Structures get **+3 m** on top of their listed
sight.

Sight radii worth knowing:

| Unit / structure | Sight |
|---|---|
| Radar Dome / Oculus / Spotter Mast | 44 / 46 / 42 |
| Vindicator | 38 |
| Dreadnought, Sunmonitor | 38 |
| Kestrel Gunship | 36 |
| Field Marshal, Hierarch | 34 / 36 |
| Prism Tank, Swarmhornet | 34 |
| Multigunner IFV, Sandskiff, MiG | 32 |
| Grizzly, Solarch | 30 |
| Rhino, Arcspitter | 28 |
| Attack Dog | 26 |
| Conscript | 22 |
| Harvester, Scrapjaw | 20 |

A harvester sees 20 m. It will drive into things.

**Radar and detection.** A live, powered radar structure gives its owner a
detection radius of **1.6x its sight**, which is what strips cloaked and
submerged units. A cloaked unit that fires or takes a hit is exposed for
3 seconds regardless.

`?fog=off` on the URL turns the shroud off for screenshots. It does **not**
defeat cloaking.

---

## 9. When things die

**Before death.** A unit starts smoking below **50%** health and catches fire
below **25%**. Burning costs **4 HP a second** and stops the moment repairs push
it back above the threshold.

**Infantry** leave a body, a puff and a stain. No wreck.

**Vehicles** leave a burning hulk for **26 seconds** — actively on fire for the
first 10, smoking for the rest. A hulk is scenery: it blocks nothing, cannot be
targeted and cannot be selected. It can be cashed in by the Reclamation's
[Salvage Call](/avihaymenahem/voltmarch/wiki/Units-and-Verbs#the-four-commander-abilities).

**Anything killed over water sinks.** Splash, no wreck. An aircraft shot down
over a lake makes its splash at the waterline, not at cruising altitude.

**Structures** throw a large blast, then **five secondary cook-off explosions**
over the next 1.25 seconds, then leave permanent rubble and scorch. The
footprint is released immediately, so you can build over the ruin.

**Kill credit** goes to whoever fired the last shot, which is what advances
their veterancy and their score. A unit that self-destructs or is sold credits
nobody.

**Regeneration.** Mobile units — infantry and vehicles, yours and the AI's —
recover **2.5% of max HP per second**, all the way to full, but only when both
are true:

1. Nothing has hit them for **8 seconds**, and
2. they are Idle or Guarding. Moving, attacking, harvesting or capturing all
   count as working.

That is roughly 40 seconds from a sliver to full. Structures do not self-repair;
see [Repair and sell](/avihaymenahem/voltmarch/wiki/Units-and-Verbs#repair-and-sell).

---

## 10. Numbers to keep in your head

| | |
|---|---|
| Simulation rate | 30 Hz |
| Longest gun in the roster | V4 Launcher, 48 m (unused) — then the Slag Mortar at 42 m |
| Shortest | Attack Dog's jaws, 3.6 m |
| Guard-range acquire / drop | 1.08x / 1.28x weapon range |
| Attack-order stop / resume | 0.80x / 0.95x weapon range |
| Turret firing cone / hull firing cone | 5 deg / 14 deg |
| Tesla chain hop / falloff | 9 m / 60% per link |
| Friendly splash | 50% |
| Veterancy | 3 kills, then 6 |
| Burn threshold / burn rate | 25% health / 4 HP per second |
| Wreck lifetime | 26 s |
| Out-of-combat regeneration | 2.5% max HP/s after 8 s idle |

---

**See also:** [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) ·
[Controls](/avihaymenahem/voltmarch/wiki/Controls) · [Economy](/avihaymenahem/voltmarch/wiki/Economy) · [Strategy](/avihaymenahem/voltmarch/wiki/Strategy) ·
[Home](/avihaymenahem/voltmarch/wiki/Home)
