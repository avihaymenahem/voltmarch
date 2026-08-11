# Maps

Every VOLTMARCH battlefield is generated. There are no hand-drawn maps in the build — a map is a
**biome** (what the ground is made of and how it folds), a **preset** (what grows on it, how rich the
ore is, how built-up it is) and a **fixed seed** that makes the same name produce the same land every
time. Change the seed and you get a different valley with the same character.

This page covers what the ground does to your army. For what you build on it see
[Base Building](Base-Building); for the economy that pays for it see [Economy](Economy).

---

## 1. The shape of a battlefield

| Property | Value |
| --- | --- |
| Map size | 512 × 512 m |
| Navigation grid | 128 × 128 cells of 4 m |
| Dead border | 2 cells (8 m) on every edge — nothing may enter it |
| Players | 2 |
| Start separation | ~193 m on the diagonal |
| Impassable to tracked vehicles | 26–33 % of cells (measured across all six shipped maps) |
| Buildable ground | 62–70 % of cells |

Two armies, two corners, on the classic diagonal. Each start sits on a **reserved shelf**: the
generator levels a 58 m disc, guarantees the inner 54 m is flat, dry, buildable and joined to the
main passable region, and then aprons the edges out at a walkable grade. You will never open a match
in a pit you cannot leave.

**Which corner you get is rolled from the match seed.** The two spots are fixed geometry — each is
paired with its own ore field and its own approach lane — but the owners rotate, so the same map
does not hand you the same opening every time.

Around each construction vehicle the scenario reserves 13 m of ground and around each escort group
12.5 m, so scattered rocks can never land on the square you have to deploy on.

---

## 2. The six battlefields

Two ship open. The other four are earned — see [Campaign](Campaign).

| Map | Biome | Character | Ore richness | Water | Unlocked by |
| --- | --- | --- | --- | --- | --- |
| **Temperate Valley** | Temperate | Low plateaus, scattered woodland | 0.85 | negligible | free |
| **Airbase Flats** | Arid | Bare, hot, long sightlines | **1.00** (richest) | none | free |
| **Frozen Sector** | Snowbound | Highest relief, cliffs channel everything | 0.90 | negligible | Prospector — mine 25,000 ore |
| **Industrial Grid** | Urban | Almost no relief, roads everywhere | **0.70** (poorest) | none | Groundworks — complete 50 structures |
| **Contested Strait** | Temperate | Temperate land, coast prop mix | 0.80 | **24.3 %** | Blitz — win inside 15 minutes |
| **Coral Shore** | Temperate | Densest prop cover in the game | 0.75 | **26.4 %** | Total Mobilisation — build 750 units |

Ore richness is a multiplier on the 900-unit-per-cell ceiling, so a field on Airbase Flats holds
roughly **43 % more ore per cell** than the same field on Industrial Grid. That difference compounds
over a long match and it is the single biggest map-level economic variable.

> **Read the water column carefully.** Four of the six are landlocked and mean it. The other two
> carry a quarter of the map in open sea, and they are the only two on which the naval arm is a
> real option — see §6.

---

## 3. The four biomes

### Temperate — the default

> Farmland that stopped being farmed. The terraces are old field boundaries cut into a shallow
> valley, and the grass on them is the dull yellow-green of late summer rather than the emerald of a
> postcard. Somebody's hedgerows are still standing. They will not be standing long.

Three terraces, 6.0 m step, base height 2.8 m. Moderate cliff coverage. Basins are carved 3.6 m
below the lowest tier at the bottom 11 % of the map, which is the only water the biome produces —
puddles, not lakes.

**Plays like:** the balanced case. Enough relief that flanks exist and enough open ground that armour
can be used properly. Woodland breaks sightlines visually but blocks nothing.

### Arid — Airbase Flats

> Hardpan and outcrop, one hue from horizon to horizon, laid out by people who valued a flat runway
> over a defensible position. There is no cover here and there was never meant to be any.

Three terraces, 6.5 m step — the largest step in the game — on low overall relief (0.28) with the
**highest cliff fraction of any preset** (0.55). What relief there is, is vertical. No basins at all:
the biome is bone dry.

**Plays like:** the armour map. Sightlines are long, the ore is the richest in the game, and the
mesas that do exist are hard walls rather than slopes. Long-ranged units earn their cost. Infantry
crossing open hardpan die to anything with splash.

### Snowbound — Frozen Sector

> Grey light, warm grey snow, and a terrain that has been shattered and re-frozen more than once. The
> passes between the shelves are the only reason two armies ever meet.

**Highest relief in the game** (0.50) on a short 5.5 m step — which means many terraces rather than
tall ones — and the strongest edge bias (0.56), pushing the rocky massifs to the rim and keeping the
centre contiguous. Small basins at the lowest 13 %.

**Plays like:** the chokepoint map. It carried 221 ramp cells on the shipped seed against Airbase
Flats' 97 — more than twice as many carved passes. Every push has to funnel, and a defence sited on
a pass is worth three sited in the open.

### Urban — Industrial Grid

> A works district. Someone poured the slabs, laid the kerbs, put up the retaining walls and then
> the front line arrived. The terrace faces here are brick with a concrete coping cap, because they
> were never cliffs — they were somebody's engineering.

Only **two** terraces at a 5.0 m step, and relief 0.14 — the flattest ground in the game. Urban
coverage 0.95, so roads, hardstanding and paving are nearly continuous. The shipped seed carried
**320 ramp cells**, the most of any map. No water.

**Plays like:** an open field with furniture. Almost nothing is impassable for terrain reasons, so
positioning is about your own walls and buildings rather than about the land. Poorest ore in the
game (0.70) — Industrial Grid punishes a greedy economy and rewards getting on with the fight.

---

## 4. Terraces, cliffs and ramps

The heightfield is **not** a smooth hill. It is a quantised set of terraces with near-vertical faces
between them, which is why a map reads as tiers rather than as noise.

**A cell is impassable when any of these is true:**

| Cause | Threshold |
| --- | --- |
| Slope | ≥ 0.62 rad (**35.5°**) anywhere in the 4 m cell — blocks *everything*, hover included |
| Water | cell centre below 2.0 m — blocks foot, track and wheel; hover crosses |
| Border | within 2 cells of the map edge |
| Occupancy | a finished structure's footprint |

A 6 m step across a 1 m sample is about an 80° face, so **every terrace edge is a wall**. There is no
"steep but climbable".

**Rough ground** is slope ≥ 0.28 rad (16°). It is passable, and it costs:

| Locomotor | Rough-ground path cost | Road path cost |
| --- | --- | --- |
| Foot | 1.25× | 0.88× |
| Track | 1.45× | 0.78× |
| Wheel | **2.05×** | **0.58×** |
| Hover | 1.00× (immune) | 1.00× |
| Naval / Air | n/a | n/a |

Wheeled hulls — the Multigunner IFV, the Arcspitter, the Grinder, the Scrapjaw, the Yardcrawler —
pay double to cross broken ground and are the units most rerouted by it. Tracked hulls barely
notice. Hover ignores slope entirely, which is the Meridian Pact's quiet mobility advantage.

> **Slope does not slow you down, it reroutes you.** Maximum speed is written once from the unit
> definition and nothing else ever touches it. A Grizzly on a hillside travels at exactly the same
> metres per second as one on a lawn. What changes is that the flow field steers the column around
> the hillside — so terrain costs you *distance*, not *velocity*.

### Ramps

Ramps are real, carved features, not decoration. Where the generator finds a stranded region it cuts
a corridor between it and the main map:

| Property | Value |
| --- | --- |
| Corridor width | 14 m total, 7 m of dead-flat core |
| Maximum grade | 0.24 rise/run — deliberately under the rough-ground threshold |
| Maximum length | 52 m (lifted for forced connectivity corridors, which are 24 m wide) |
| Budget | 30 per map, plus 12 for start-area rescue and 6 for the plateau guarantee |
| Path cost | 0.92× — 8 % cheaper than flat ground, so armies prefer them |

Two consequences you can plan around. First, **a ramp is a chokepoint that the map guarantees will
be used**, because pathfinding actively prefers it. Second, ramps are painted as worn dirt track in
the terrain splat, so you can read them off the minimap and off the ground.

---

## 5. Line of sight, elevation and cover

Three rules, and they do not agree with each other in the way you would expect:

1. **Vision ignores terrain completely.** Fog of war is a flat circle stamp. A unit at the bottom of
   a cliff sees exactly as far as one on top of it, and a mesa hides nothing.
2. **Direct fire does not.** Target acquisition walks the heightfield between muzzle and aim point
   and rejects the shot if the ground rises more than 0.9 m above the sight line. A ridge between you
   and a tank means the tank is visible and unshootable.
3. **Arcing shells ignore rule 2.** Anything firing `Shell`-class ordnance — the Slaghurler's mortar,
   the Kite Corvette's and Slag Scow's guns, the Slagger's satchel, naval deck guns — lobs over
   cover. That is the entire point of them.

**There is no high-ground bonus.** No range bonus, no damage bonus, no accuracy bonus. Searching the
combat, damage and targeting code for one finds nothing. Range is measured on the ground plane, so
altitude does not cost you reach either. A terrace is worth holding because of rule 2 and because of
the ramp bottleneck below it — not because the game rewards elevation.

**Props do not block movement.** Trees, bushes, rocks, boulders, containers and telegraph poles
placed by the scatter system are decorative as far as navigation is concerned. The only exceptions
are the handful of *entity* props a scenario places by hand near a base — those rocks and boulders
are solid.

**Crushing flattens scenery — and soldiers.** A vehicle with a crush level moving above 0.6 m/s
fells trees and shrubs under the front 70 % of its hull, permanently for the match, and kills any
enemy infantryman it drives over. Boulders and rocks are solid instead and will stop a column. Six
hulls crush: the Grizzly, the Rhino, the Apocalypse, the Ore Harvester, the Grinder and the
Scrapjaw. The whole Meridian Pact hovers and crushes nothing. See
[Units and Verbs](Units-and-Verbs#crushing-infantry) for the full rule.

The map consequence is that **broken ground is infantry country**. Wheeled and tracked hulls reroute
around rough cells; a squad on a terrace shelf or in a rock field is somewhere a tank has to arrive
slowly and in single file, which is the one situation where being crushable stops mattering.

---

## 6. Water — two seas and four dry maps

Water sits at a flat 2.0 m. Below it, ground units simply cannot go; there is no shallows, no wading,
no depth gradient in the navigation grid. Hover units cross land and water alike. Naval hulls can
*only* be on water. Aircraft ignore all of it.

**Two of the six maps carry a real sea. Four are landlocked.** Measured on all six, with their real
seeds and biomes, straight off the generator:

| Map | Water cells | Largest single body | Navigable for ships |
| --- | --- | --- | --- |
| Temperate Valley | 0.15 % | 9 cells (~144 m²) | nothing usable |
| Airbase Flats | 0.00 % | none | none |
| Frozen Sector | 0.16 % | 14 cells (~224 m²) | nothing usable |
| Industrial Grid | 0.00 % | none | none |
| **Contested Strait** | **24.3 %** | **3,973 cells (~63,600 m²)** | **3,622 cells** |
| **Coral Shore** | **26.4 %** | **4,319 cells (~69,100 m²)** | **3,952 cells** |

The four dry maps are dry because nothing declares a shoreline for them, and the biome noise alone
only ever produces puddles — the largest is smaller than a war factory. That is the correct answer
for those four. It used to be the answer for all six, which is what made the naval arm unreachable.

**On the two coastal maps the shoreline is authored, not accidental.** It is a single straight
coast with a low-frequency wander, laid along the perpendicular bisector of the two openings so both
armies are exactly the same distance from the water — 112 m on Contested Strait, 100 m on Coral
Shore. Every start still sits on flat, dry, guaranteed-buildable ground; the sea takes the far
quarter of the map and the land behind it stays one connected region, so nothing about the ground
war changed.

The two are deliberately not the same water. **Contested Strait** drops the full 8 m the heightfield
can express and reads as deep blue; **Coral Shore** is a 5 m lagoon on the opposite side of the map
and reads turquoise, because the absorption gradient is driven by depth.

**What this buys you.** Naval Yards, Naval Pens, Slipways and Breaker Docks have somewhere to stand:
178 legal 3×3 shore sites on Contested Strait, 81 on Coral Shore. The sea is one connected body on
both — 99.8 % of every navigable cell is in the main expanse — so a fleet can cross the map without
portaging. Amphibious hover movement finally has something to be amphibious across, and it is the
one chassis that can contest both the sea and the shore.

> **A caveat worth knowing.** Nothing forces a Naval Yard to be built on the coast. You can found
> one in the middle of the map, and the game will let you; it just will not put your hulls anywhere
> useful. Build it on the beach.

---

## 7. Roads

Roads generate on every map. The network is a jittered 4 × 4 lattice — blocks of roughly 100 m — plus
one arterial running the full width of the map and one running its full depth. Edges are refused
where the ground is wet, impassable or steeper than 0.14 rise/run, so the network bends around
terrain rather than through it.

A carriageway cell's path cost drops from 100 to 72, and then again by locomotor: **foot 63, tracked
56, wheeled 42**. Concrete pads and paving around your own base get the same discount.

> **A road is a route, not a throttle.** Nothing in the movement code reads the road mask when it
> computes speed. A column on a road is not faster in metres per second — the flow field simply
> prefers roads, so armies naturally take them. On Industrial Grid, where road coverage is near
> total, this means most armies funnel down the same handful of streets, and that is worth ambushing.

---

## 8. Ore fields

A skirmish lays out exactly **three** ore fields, derived from wherever the two starts ended up:

| Field | Position | Radius |
| --- | --- | --- |
| Home field, one per army | 44 m to the flank *away from the approach lane*, 18 m forward of the start | 30 m |
| Contested field | the exact midpoint between the two starts | 22 m |

The home fields sit beside your base rather than on the lane both armies are about to fight over.
That is deliberate: your opening economy is defensible and the third field is not.

**Richness** is 900 ore per centre cell multiplied by the map's ore-richness figure, falling off
towards the rim on a 1.55 exponent — so the field holds its value out to the edge and then drops
quickly. Cells under 14 ore round down to bare ground, so the visible edge of a patch is its real
edge.

**Fields regrow.** A cell recovers 0.6 ore per second, but only once the cell between it and the
field's centre node is at least 30 % full, and the node itself regrows three times faster. Mine the
near edge and it comes back first; strip the field to the rim and the regrowth has a long walk out.
A field is therefore renewable at a rate you can outpace but not exhaust, provided you leave it
alone occasionally.

Practical consequence: **the contested midpoint field is the map's tempo control.** Holding it is
worth roughly a third of the map's total income, and it is the one patch neither player can defend
from home.

---

## 9. Crates

Six supply crates are kept alive on the map at all times. The first drops at 25 seconds, and a
replacement drops every 40 seconds while the map is below six. Drive any unit within 2.6 m to open
one.

| Outcome | Chance | Effect |
| --- | --- | --- |
| Credits | 40 % | 300–900, rising to 2.5× that after ten minutes |
| Free unit | 18 % | One of your faction's cheap-to-mid hulls walks out |
| Heal | 20 % | The finder and every ally within 10 m go to full health |
| Promotion | 14 % | The finder gains a veterancy rank |
| Dud | 8 % | It was ammunition — 45 % of the finder's max HP, 5 m splash |

Crates are the reason an early cheap scout pays for itself twice. They spawn on passable, dry,
unoccupied ground, and after ten minutes a single credit crate is worth more than a Grizzly.

---

## 10. The civilian hamlets

Two mirrored settlements of three neutral buildings sit on the **perpendicular bisector of the lane
between the two openings** — the only line on the map where a point is equally far from both armies,
whatever the generator did to the start shelves. Each hamlet is 62 m off the midpoint, which puts it
about 115 m from each start: outside anybody's build radius, outside the sight of anything standing
in a base, and clear of the contested ore patch on the midpoint itself.

**Two of them, and you cannot hold both.** One hamlet would be a race the army whose ore field
happens to lie that way simply wins. Two is a decision.

Each hamlet is a derrick on the crossroads with the two garrisonable blocks flanking it about 23 m
out — close enough that a squad holding the derrick sits inside the other two buildings' field of
fire.

| Structure | Footprint | HP | What it is for |
| --- | --- | --- | --- |
| **Oil Derrick** | 2 × 2 (8 × 8 m) | 900 | Pays its holder **15 credits per second** |
| **Civilian Hospital** | 3 × 2 (12 × 8 m) | 1,100 | The widest garrison on the map |
| **Apartment Block** | 2 × 3 (8 × 12 m) | 800 | The tallest — a held block reads from across the map |

Nobody can build these. They exist only on the map, owned by the neutral player, and there are
exactly six of them per match.

### Taking one

**With an Engineer.** A neutral structure is captured **outright, at any health** — no softening,
one 500-credit engineer and a walk. (An *enemy* structure has to be beaten below 50 % health first,
or the engineer is spent knocking 25 % off it.)

**With infantry.** Walk five men in and the building flies your colours for as long as you hold it.
It reverts the instant the last man leaves or dies. An occupied structure also cannot be captured by
an enemy engineer, so a garrison is how you stop somebody walking an engineer into your derrick.

### What a derrick is worth

15 credits a second, paid once a second off the tick counter, for as long as you hold the deed. Over
a ten-minute match that is 9,000 credits — roughly one harvester's output, without the 1,400-credit
harvester, the War Factory, the escort or the micromanagement. What it costs instead is holding
ground in the middle of the map.

The income is a **drip, not a lump on capture**. Walking one rifleman in and out does not pay you
anything; only the holder at each interval is paid.

### Garrisoning generally

You can also garrison your own unarmed, non-production structures with a footprint of at least
2 × 2 cells — the **Power Plant**, the **Battle Lab** and the **Repair Depot**, plus each faction's
equivalents. The Ore Silo is 1 × 1 and is refused as too small; anything that builds, refines or
carries a radar is refused as a production structure; anything with a gun is refused because it does
not need the help.

| Garrison | Value |
| --- | --- |
| Capacity | 5 infantry |
| Range | occupants' own weapon range **+ 6 m** |
| Damage | 0.9× each occupant's field damage, summed into one volley |
| Risk | the building dies, everyone inside dies with it |
| Side effect | an occupied structure cannot be captured by an enemy Engineer |

---

## 11. Screenshot fixtures

The `?shot=` boot flag skips the menu, freezes the simulation and poses the camera on a fixed
composition. These are development fixtures rather than playable maps, but they are the fastest way
to look at something specific.

| Fixture | Biome | Shows |
| --- | --- | --- |
| `skirmish` | temperate | the real match layout (this is the default boot) |
| `allied-base` | temperate | a finished Allied base, refinery on ore, defended face |
| `soviet-base` | arid | a finished Soviet base and its tesla line |
| `terrain-showcase` | urban | close ground detail — road junction, kerbs, scatter |
| `unit-parade` | arid | two ranks of units at readable range |
| `battle` | temperate | two columns engaging, wrecks already burning |
| `economy` | temperate | an ore field and the full harvester loop |
| `naval` | coast | **the only composition in the build with a real shoreline** |
| `placement` | temperate | a build ghost over the placement grid |
| `selection` | temperate | selection rings, health bars, order markers |
| `blob` | temperate | 36 units against 30, the readability-under-load frame |

Other useful flags: `?map=` (preset), `?biome=`, `?seed=` (scenario and simulation), `?mapseed=`
(the landform roll), `?fog=off`, `?start=base` (open from a pre-built base instead of a construction
vehicle), `?roads=off`.

---

**Factions:** [Allied Forces](Faction-Allies) · [Soviet Union](Faction-Soviets) · [Meridian Pact](Faction-Meridian-Pact) · [The Reclamation](Faction-Reclamation)

**See also:** [Strategy](Strategy) · [Economy](Economy) · [Base Building](Base-Building) ·
[Combat](Combat) · [Units and Verbs](Units-and-Verbs) · [Controls](Controls) ·
[How to Play](How-to-Play)
