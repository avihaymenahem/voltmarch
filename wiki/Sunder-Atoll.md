# Sunder Atoll

Four islands, no land route. Every other battlefield in VOLTMARCH is one piece of ground with
water on it somewhere; this one is water with four pieces of ground in it. Nothing you build can
walk to an enemy. If you want to reach them you cross, and if you cannot cross you lose slowly and
in full view of three people who can.

It is a **four-player** map and it is **open from your first launch** — no mission unlocks it. For
the ground rules that apply to every map see [Maps](/avihaymenahem/voltmarch/wiki/Maps); for the
fleet you will need see [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs).

---

## 1. The shape of it

| Property | Value |
| --- | --- |
| Players | **4** |
| Biome | Temperate |
| Preset | `atoll` |
| Water | **53.8 %** of the map |
| Land masses | **4**, within 1 % of each other in size |
| Island radius | 98 m |
| Start separation | 268 m at the closest pair, 385 m across the diagonal |
| Narrowest channel | 71 m |
| Ore richness | 0.80 |
| Buildable ground per island | 1,211–1,291 cells (~20,000 m²) |

The islands sit at the corners of a rectangle, 138 m east–west and 134 m north–south of the map
centre. Each one carries exactly one army. The centre of the map is open water.

> **There is no fifth island and there is no bridge.** The generator carves four land masses and
> refuses to link them — the corridor carver that rescues a stranded region on every other map is
> switched off here, and the channels are 71–83 m wide against a carver that can only span 52 m.
> Two independent reasons for the same thing, because it is the kind of failure that would ship
> silently.

---

## 2. Why it is temperate, and why that was the second choice

An arid atoll is the obvious call and it was tried first. The case for it was good: the arid
biome's water palette is the tropical one, palm trees weight eight times heavier on arid ground than
on any other biome, and a hue-locked desert produces no green at all.

It lost on the scorecard, and the same cause showed up twice. This map is more than half water over
a seabed the biome colours, and a bright sand bed both fills the dry half of the frame with sunlit
hardpan and lights the **shallows from below** — which walks the turquoise straight round into
green over the shoals. Measured on the same frame with the biome as the only variable, frame median
luminance went 0.446 → 0.523 (ceiling 0.491) and the green-hue fraction went 0.018 → 0.041 (ceiling
0.020). Two fatal failures against none.

So the atoll is temperate: an olive-green island in turquoise water, with the shoals a paler band
through the middle of the lagoon. The shoal colour is not a second material or a different mesh —
it is the same water reading brighter because at 0.7 m the light reaches the bottom and comes back,
against 7 m in open sea.

---

## 3. Your island

Each island is a low shelf, flat and fully buildable across its middle, sloping gently through
scrub to the sand on every side. It is **not** a plateau with cliffs — you can drive off it in any direction and
straight into the sea, which is exactly the point.

| Feature | Distance from your Construction Yard |
| --- | --- |
| Guaranteed flat, buildable shelf | 0–58 m |
| Build radius of the opening yard | 56 m |
| Home ore field (radius 30 m) | centred **44 m outward** |
| Expansion ore field (radius 22 m) | centred **62 m inward** |
| Waterline | ~98 m |

**Ore, per island, measured through the real seeder on the shipped seed:**

| Island | Home field | Expansion | Total |
| --- | --- | --- | --- |
| (118, 390) | 28,304 | 14,161 | **42,465** |
| (394, 122) | 27,081 | 14,094 | **41,175** |
| (394, 390) | 28,508 | 13,300 | **41,808** |
| (118, 122) | 28,081 | 14,723 | **42,804** |

**168,252 credits** on the map, ~42,000 an army, and the poorest island holds **96 %** of what the
richest does. All of that remainder is per-cell jitter: both patches are placed as pure radial
offsets from the island centre, so the four islands are the same layout rotated.

### The two fields are not the same proposition

The **home field is outward**, on the face pointing at the map rim. The water beyond it is a dead
end nobody sails through, and the whole patch is inside your build radius from turn one: refinery,
wall and defence all go up without moving.

The **expansion is inward**, on the face that borders the lagoon — and its centre is 62 m out
against a 56 m build radius. You cannot reach it from the opening base. To hold it you have to creep
your base *toward the beach a landing arrives on*, and the ground out there is the patchiest on the
island, where the levelled start shelf's apron meets the natural landform.

> **That is the map in one sentence.** Roughly a third of your income is on the side of your island
> facing everybody else's, and taking it means putting buildings where you can be landed on.

---

## 4. The lagoon and the shoals

The middle of the map is a bank of shallow water 88 × 84 m, with two more bars in the north and
south straits. They are 0.7 m and 1.1 m deep against 7 m in open water.

They never dry — a shoal that broke the surface would be a fifth island, split the sea and stop
routing ships — so **every hull can cross them**. What they change is exposure. The two east–west
lanes are deep, fast water; the two north–south lanes run over bars, in the shallows, in plain
sight, and are slow to get out of.

> **Read the water.** Colour is depth here, and depth is cover. A fleet crossing the pale water in
> the middle is a fleet you can see coming and a fleet with nowhere to be.

---

## 5. Naval is not optional

On [Contested Strait](/avihaymenahem/voltmarch/wiki/Maps) and Coral Shore the navy is a wing you can
decline; the land route is shorter and an army that walks wins. Here there is no land route at all.

**Every island has a coast a yard can stand on.** Measured with the placement rule the game
actually runs — a fully buildable 3×3 with eight navigable water cells within 24 m — the map offers
**532 legal Naval Yard sites**, split 146 / 155 / 125 / 106 across the four islands. For comparison
Contested Strait offers 237. Nobody is locked out of the water.

> **It very nearly shipped with none.** The generator levels each start onto the terrace its ground
> already sits on, which on these islands was 9.9 m — and a coast that has to fall 7.9 m in its last
> 26 m is a 0.23 slope, which is too steep to build on. Buildable ground stopped 34 m short of the
> water, the legal-site count over the whole map was **zero**, and every naval structure and hull in
> the game would have been unreachable on the one map that exists to need them. An island shelf is
> levelled to the lowest terrace now, so the beach is real ground.

**The sea is one body.** Over 99 % of every cell a ship can route through belongs to a single
connected expanse, so a fleet can reach any island from any other without portaging.

**Land is deliberately four regions.** The main tracked region holds about a quarter of the drivable
ground — every other map in the game guarantees over 90 % in one piece. The invariant that replaces
it is amphibious: dry ground you can drive on plus water you can sail is **one** connected world, so
every army can reach every other army. That is the property that actually matters, and on a
continent it merely happens to be spelled "one land region".

### What that means for your build

- **A Naval Yard is a tech requirement, not a luxury.** It gates the Transport, which is how
  infantry leave your island at all.
- **A Transport carries five.** Two is the sensible ceiling on how many you own — one operation and
  a spare.
- **Hover crosses on its own.** The Meridian Pact's entire roster is amphibious and can drive from
  island to island without a hull to carry it. On this map that is not a quiet mobility advantage,
  it is the single biggest faction asymmetry in the game.
- **Aircraft ignore all of it.** An air force is the other answer to "there is no road".

---

## 6. How it plays

**The first five minutes are uncontested.** Nobody can reach you. Take the home field, get power up,
and decide whether you are going out or digging in — because the decision is made early and it is
expensive to change.

**Expand toward the fight or don't expand.** The second ore patch is on your exposed face. There is
no safe expansion on this map; there is only the one you defend.

**Three opponents, not one.** Four-player free-for-all means the army that commits hardest to a
crossing is the army with the emptiest island. Your neighbours know that too.

**Losing the sea is losing.** An enemy fleet parked off your beach is not a raid, it is a siege: it
cuts your expansion, kills your harvesters on the inward face, and escorts the landing that follows.
Contesting the lane is cheaper than repelling the landing.

**The narrow straits are the north and south ones**, 71–76 m across and shallow. They are the
shortest crossing between adjacent islands and the worst place to be caught.

---

## 7. The screenshot fixture

`?shot=atoll` poses the development fixture for this map: a dock on the sand, a transport nosed into
the surf with its squad already ashore, and the escort still out over the shoal. It is the only
fixture in the build not framed on the map centre, for the obvious reason — on this map the centre
is the middle of the lagoon and there is no land within 94 m of it.

---

**See also:** [Maps](/avihaymenahem/voltmarch/wiki/Maps) ·
[Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) ·
[Base Building](/avihaymenahem/voltmarch/wiki/Base-Building) ·
[Economy](/avihaymenahem/voltmarch/wiki/Economy) ·
[Strategy](/avihaymenahem/voltmarch/wiki/Strategy) ·
[Meridian Pact](/avihaymenahem/voltmarch/wiki/Faction-Meridian-Pact) ·
[Campaign](/avihaymenahem/voltmarch/wiki/Campaign)
