# Maps

Every VOLTMARCH battlefield is generated. There are no hand-drawn maps in the build — a map is a
**biome** (what the ground is made of and how it folds), a **preset** (what grows on it, how rich the
ore is, how built-up it is) and a **fixed seed** that makes the same name produce the same land every
time. Change the seed and you get a different valley with the same character.

This page covers what the ground does to your army. For what you build on it see
[Base Building](/avihaymenahem/voltmarch/wiki/Base-Building); for the economy that pays for it see [Economy](/avihaymenahem/voltmarch/wiki/Economy).

---

## 1. The shape of a battlefield

| Property | Value |
| --- | --- |
| Map size | 512 × 512 m |
| Navigation grid | 128 × 128 cells of 4 m |
| Dead border | 2 cells (8 m) on every edge — nothing may enter it |
| Players | **4** on four maps, 2 on the other three |
| Start separation | ~193 m on the diagonal |
| Impassable to tracked vehicles | 21.6–27.3 % on the four landlocked maps; 40.8–54.6 % on the three with a sea |
| Buildable ground | 68.5–74.1 % landlocked; 49.0–51.4 % on the coastal pair, 30.7 % on Sunder Atoll |

Four maps seat four armies — Temperate Valley, Airbase Flats, Industrial Grid and
Sunder Atoll. The other three are two-army. Every figure above was measured through the real
generator on the shipped lobby row: the map's preset, biome, pinned `mapSeed` and its own army
count, which matters because the start shelves are levelled per army and a map seating four is a
measurably different piece of ground from the same seed seating two.

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

## 2. The seven battlefields

Three ship open. The other four are earned — see [Campaign](/avihaymenahem/voltmarch/wiki/Campaign).

It was ten. Saltpan Reach, Foundry Line and Glacier Shelf arrived in v2.6.0 as payloads — the five
missions that used to grant commander powers needed something real once the powers became an
in-match purchase — and each one reused an existing terrain preset **verbatim**, on its own landform
roll. That was the point at the time: a preset is a balance surface, so cloning three was cheaper
than tuning three. It is also why they went. Every balance number a preset carries — relief, cliffs,
water, scatter, urban density, ore richness, props — was identical to a map already in the list, so
the lobby was selling a reroll of a battlefield you already owned as a reward for a long mission.
The three missions that paid them were retired with them.

| Map | Biome | Character | Ore richness | Water | Unlocked by |
| --- | --- | --- | --- | --- | --- |
| **Temperate Valley** | Temperate | Low plateaus, scattered woodland | 0.85 | negligible | free |
| **Airbase Flats** | Arid | Bare, hot, long sightlines | **1.00** (richest) | none | free |
| **Frozen Sector** | Snowbound | Highest relief, cliffs channel everything | 0.90 | negligible | Prospector — mine 25,000 ore |
| **Industrial Grid** | Urban | Almost no relief, roads everywhere | **0.70** (poorest) | none | Groundworks — complete 50 structures |
| **Contested Strait** | Temperate | Temperate land, coast prop mix | 0.80 | **24.3 %** | Blitz — win inside 15 minutes |
| **Coral Shore** | Temperate | Densest prop cover in the game | 0.75 | **26.4 %** | Total Mobilisation — build 750 units |
| **[Sunder Atoll](/avihaymenahem/voltmarch/wiki/Sunder-Atoll)** | Temperate | **Four islands, no land route.** 4 players | 0.80 | **53.8 %** | free |

Ore richness is a multiplier on the 900-unit-per-cell ceiling, so a field on Airbase Flats holds
roughly **43 % more ore per cell** than the same field on Industrial Grid. That difference compounds
over a long match and it is the single biggest map-level economic variable.

> **Read the water column carefully.** Four of the seven are landlocked and mean it. Two carry a
> quarter of the map in open sea. The seventh is more than half water and has no land route at
> all — see §6.

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
a pass is worth three sited in the open. Dynamic weather becomes snowfall here rather than rain;
light and heavy events are presentation-only and do not change movement or visibility.

### Urban — Industrial Grid

> A works district. Someone poured the slabs, laid the kerbs, put up the retaining walls and then
> the front line arrived. The terrace faces here are brick with a concrete coping cap, because they
> were never cliffs — they were somebody's engineering.

Only **two** terraces at a 5.0 m step, and relief 0.14 — the flattest ground in the game. Urban
coverage 0.95, so roads, hardstanding and paving are nearly continuous. The shipped seed carried
**320 ramp cells**, the most of any map. No water. It is also the first battlefield with a dynamic
presentation clock: an eight-minute day/dusk/night/dawn shift driven by simulation time. Pausing
freezes the light and changing game speed advances it proportionally; it does not alter visibility,
AI, commands or replay checksums. At night the elevated moon is deliberately restrained and the
working street lamps, vehicle panels and building emissives carry the local contrast.

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

Wheeled hulls — the Sabre IFV, the Arcspitter, the Grinder, the Scrapjaw, the Yardcrawler —
pay double to cross broken ground and are the units most rerouted by it. Tracked hulls barely
notice. Hover ignores slope entirely, which is the Meridian Pact's quiet mobility advantage.

> **Slope does not slow you down, it reroutes you.** Maximum speed is written once from the unit
> definition and nothing else ever touches it. A Warden on a hillside travels at exactly the same
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
   the Sun Cutter's, Kite Corvette's and Slag Scow's guns, the Slagger's satchel, naval deck guns —
   lobs over cover. That is the entire point of them.

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
hulls crush: the Warden, the Anvil, the Sledge, the Ore Harvester, the Grinder and the
Scrapjaw. The whole Meridian Pact hovers and crushes nothing. See
[Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs#crushing-infantry) for the full rule.

The map consequence is that **broken ground is infantry country**. Wheeled and tracked hulls reroute
around rough cells; a squad on a terrace shelf or in a rock field is somewhere a tank has to arrive
slowly and in single file, which is the one situation where being crushable stops mattering.

---

## 6. Water — three seas and four dry maps

Water sits at a flat 2.0 m. Below it, ground units simply cannot go; there is no shallows, no wading,
no depth gradient in the navigation grid. Hover units cross land and water alike. Aircraft ignore all
of it. **Every hull a shipyard builds can *only* be on water** — carriers included, so a landing is
made from open water onto the sand rather than by driving the hull up the beach.

Two things cross under their own power without hovering or flying: the **Sandskiff**, which is
gated on a land structure, and the four **swimmer infantry** — Frogman, Naval Infantry, Tidewalker,
Dredger — who are built at a barracks rather than a dock and are therefore offered on a dry map too.

**No sea means no naval content is offered at all.** On a landlocked map the four docks and the
eighteen hull types behind them are left out of the sidebar entirely rather than shown and refused —
and so is anything whose prerequisite chain runs through a dock. The measure is 300 cells in the
largest connected navigable body: the dry maps top out at 14, the three seas carry 3,622 to 7,784,
and the threshold sits in the gap with a decade of margin on each side.

**Three of the seven maps carry a real sea. Four are landlocked.** All seven measured straight off the
generator on their shipped lobby row — preset, biome, pinned `mapSeed` and the map's own army count:

| Map | Water | Largest single body | Navigable for ships |
| --- | --- | --- | --- |
| Temperate Valley | 0.00 % | none | none |
| Airbase Flats | 0.00 % | none | none |
| Frozen Sector | 0.16 % | 14 cells (~224 m²) | nothing usable |
| Industrial Grid | 0.00 % | none | none |
| **Contested Strait** | **24.3 %** | **3,973 cells (~63,600 m²)** | **3,622 cells** |
| **Coral Shore** | **26.4 %** | **4,319 cells (~69,100 m²)** | **3,952 cells** |
| **Sunder Atoll** | **53.8 %** | **8,798 cells (~141,000 m²)** | **7,784 cells** |

The four dry maps are dry because nothing declares a shoreline for them, and the biome noise alone
only ever produces puddles — the largest anywhere is 14 cells, smaller than a war factory. That is
the correct answer for those four. It used to be the answer for all six maps that existed then,
which is what made the naval arm unreachable.

**Do not read the puddle rows as stable.** A start shelf is a levelled disc, so the army count a map
seats changes which cells end up under the 2.0 m line: Temperate Valley reads 0.00 % seating four
and carried a few wet cells back when it seated two. This is exactly why the engine's test is
`NAVAL_MIN_SEA_CELLS` — 300 cells in the largest connected navigable body — and not "is there any
water at all". The two clusters are four orders of magnitude apart, so nothing about a puddle
count is load-bearing.

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
178 legal 3×3 shore sites on Contested Strait, 81 on Coral Shore — counted as buildable footprints
from which a yard's production spiral can reach the sea, which is the stricter of the two site
tests in the repo. [Sunder Atoll](/avihaymenahem/voltmarch/wiki/Sunder-Atoll) quotes 237 for
Contested Strait against its 532, using the looser placement rule (a buildable 3×3 with eight
navigable cells within 24 m). Neither number is wrong; they answer different questions, and a
figure from one is not comparable with a figure from the other. The sea is one connected body on
both — 99.8 % of every navigable cell is in the main expanse — so a fleet can cross the map without
portaging. Amphibious hover movement finally has something to be amphibious across, and it is the
one chassis that can contest both the sea and the shore.

> **A yard must be on the coast, and the game enforces it.** All four docks carry a placement rule
> that demands eight navigable water cells within 24 m of the footprint, and an inland site is refused
> outright with *Must be founded on the coast* — or, on a landlocked map, with a different sentence,
> *No navigable water on this battlefield*, because there is nowhere to move the ghost to. The rule and the launch search are two statements of one fact:
> a hull leaves the yard onto water, so a yard with no water beside it would be a permanently
> stalled production queue. This page used to say nothing stopped you; something does.

---

## 7. Roads

Roads generate as one connected network on every map. The route search begins from a jittered block
grid and map-crossing arterial candidates, refuses wet, impassable and steep ground, then removes
sustained near-parallel duplicates before the visible chains are built. A short bend or a real
crossing remains; two separate roads running beside each other through the same corridor do not.

The mesh drapes to the terrain at sub-cell intervals. Junction pads are accepted only when their
interior and outer pavement skirt stay on valid ground, and road triangles already owned by another
chain or junction are culled rather than layered into cracked-looking fragments. A legitimate
interior terminus narrows, lowers and fades into the surrounding ground instead of ending as a hard
rectangular cut. Sidewalk shoulders carry restrained terrain-coloured wear so paving meets the map
without a pasted-on edge.

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
field's centre node is at least 2.5 % full, and the node itself regrows three times faster, because
nothing upstream can feed it. Recovery therefore rolls outward from the middle: mine the near edge
and it comes back first. A field stripped to bare ground and then left completely alone is about a
fifth back after two minutes and effectively full after twenty. A field is renewable at a rate you
can outpace but not exhaust, provided you leave it alone occasionally.

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
unoccupied ground, and after ten minutes a single credit crate is worth more than a Warden.

---

## 10. Civilian landmarks

Two mirrored capture pockets sit on the **perpendicular bisector of the lane between the two
openings**—the line where a point is equally far from both armies. Their exact position varies with
the map seed: the pair sits **54–69 m** either side of the midpoint and slides up to 8 m along the
lane. Each pocket keeps one Oil Derrick and one Civilian Hospital, preserving the economic and
garrison contest without repeating the old three-building formation.

**Two of them, and you cannot hold both.** One hamlet would be a race the army whose ore field
happens to lie that way simply wins. Two is a decision.

Six Apartment Blocks spawn separately as three point-mirrored pairs across approaches and outer
flanks. They are tactical cover, not extra income, so the numbers of Oil Derricks, Hospitals and Ore
Mines do not increase. Neutral landmarks grant no shared vision and stay absent from the minimap
until scouted. Every civilian footprint is validated against the complete road corridor, including
kerb and pavement, before it is accepted.

| Structure | Footprint | HP | What it is for |
| --- | --- | --- | --- |
| **Oil Derrick** | 2 × 2 (8 × 8 m) | 900 | Pays its holder **15 credits per second** |
| **Civilian Hospital** | 3 × 2 (12 × 8 m) | 1,100 | The widest garrison on the map |
| **Apartment Block** | 2 × 3 (8 × 12 m) | 800 | The tallest — a held block reads from across the map |

Nobody can build these. They exist only on the map, owned by the neutral player. A standard match
contains two Oil Derricks, two Civilian Hospitals and six Apartment Blocks; Ore Mine placement is
unchanged.

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
2 × 2 cells — the **Power Plant**, the **Proving Ground** and the **Repair Depot**, plus each faction's
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

**Factions:** [Allied Forces](/avihaymenahem/voltmarch/wiki/Faction-Allies) · [Soviet Union](/avihaymenahem/voltmarch/wiki/Faction-Soviets) · [Meridian Pact](/avihaymenahem/voltmarch/wiki/Faction-Meridian-Pact) · [The Reclamation](/avihaymenahem/voltmarch/wiki/Faction-Reclamation)

**See also:** [Strategy](/avihaymenahem/voltmarch/wiki/Strategy) · [Economy](/avihaymenahem/voltmarch/wiki/Economy) · [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building) ·
[Combat](/avihaymenahem/voltmarch/wiki/Combat) · [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) · [Controls](/avihaymenahem/voltmarch/wiki/Controls) ·
[How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play)
