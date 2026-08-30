# Economy

There is one resource: **ore**, which becomes **credits** when a harvester unloads it at a
refinery. Everything you build is paid for out of that one number.

Power is a second, separate system that does not cost credits to run — it costs credits to
*build*, and running short of it makes everything slower. It is covered at the end of this page and
in more depth in [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building).

---

## Ore

Ore is not made of objects. The map is a 128 × 128 grid of four-metre cells, 512 metres square, and
an ore field is a patch of cells each holding a number of ore units.

| | |
| --- | --- |
| Ore units a cell can hold | up to **900** |
| Ore units at a field's richest cell when seeded | about **765** |
| Cells below 14 units at seed time | dropped, which is what gives a field its ragged edge |
| Credits per ore unit | **1.0** |

So a full cell is worth roughly 900 credits and a whole field is worth tens of thousands. The
starter map, Temperate Valley, has *"three ore fields on the diagonal"*, and on a measured start
those three held about **74,000 credits** between them across some 360 cells. Enough for a long
match, not enough for two.

**Ore visibly drains.** The crystals thin out as they are mined, and the field erodes outward from
the edge a harvester started on. That is not a cosmetic flourish — it is the readout. If a patch
looks bare, it is bare.

### Regrowth

Ore grows back, slowly and from the middle outward.

Every field has a **node cell** at its centre, and every other cell knows its upstream neighbour —
the one step nearer the node. A cell only regrows once its upstream neighbour is at least **2.5%
full**. The node itself regrows at three times the base rate, because nothing upstream can feed it.

The base rate is **0.6 ore units per cell per second**, and the gate above is what turns that into a
wave rolling out from the middle rather than the whole patch fading back in at once.

Measured on a field stripped to bare ground and then left completely alone:

| Left alone for | Recovered |
| --- | --- |
| 1 minute | 4 % |
| 2 minutes | 20 % |
| 5 minutes | 58 % |
| 10 minutes | 86 % |
| 20 minutes | 99 % |

So **a patch mined from the near edge fills back in behind you**, and a patch stripped to the rim
comes back from the middle outward — you can go home and return to it.

What a recovering field will *sustain* is the part that keeps expansion worth paying for. Its output
peaks early and then collapses as the cells cap out: about **60 ore a second two minutes in**, which
is roughly three harvesters' worth, down to **13 a second at ten minutes**, which is half of one.
A field you left alone is a good place to come back to. It is not a second economy.

---

## Harvesters

A harvester runs one loop forever: find ore → drive to it → scoop → drive home → dock → unload →
repeat. You almost never need to give one an order.

| | Ore Harvester | Sun Collector (Meridian) | Scrapjaw (Reclamation) |
| --- | --- | --- | --- |
| Cost | 1,400 | 1,000 | 1,150 |
| Build time | 16 s | 13 s | 14 s |
| Hopper | **700** | **450** | **600** |
| Hit points | 1,000 | 800 | 850 |
| Speed | 5.0 m/s | 7.0 m/s (hover) | 5.6 m/s |

The Pact trades half the load for twice the trips and a faster, cheaper hull. The Reclamation sits
between the two.

**Mining rate is 140 ore units per second** while parked on a cell, so a 700-unit hopper fills in
five seconds of actual scooping. **Unloading takes 2.2 seconds**, and the credits stream in over
that time rather than arriving in one lump. Everything else in the loop is driving, which is why
the distance from your refinery to your ore is the number that actually sets your income.

### Things the harvester does on its own that are worth knowing

- **It reserves the cell it is driving to** for four seconds at a time, refreshing the lease every
  tick. Two harvesters will not walk to the same cell and find one of them arriving at nothing. A
  harvester that dies mid-drive stops refreshing, and its cell frees itself four seconds later.
- **When a cell runs dry it hops to the next one** without a trip home. That hop is what makes a
  field visibly erode outward.
- **It re-scores about once a second** and will switch to a closer cell — but only on a clear win,
  25% closer, or harvesters oscillate between two cells a metre apart and never arrive at either.
- **It prefers a refinery whose dock is free**, even a slightly further one. Queueing behind a full
  hauler costs more than the extra drive.
- **Only one harvester docks at a time.** The next one waits about nine metres behind. They form a
  line rather than shoving each other off one point.
- **If there is nothing left to mine but something in the hopper, it banks it** rather than parking
  next to an empty field.
- **If it is shot at, EVA says so** — *"Ore miner under attack"* — at most once every twenty
  seconds. Harvesters are unarmed and expensive. They are the correct thing for an opponent to
  raid, and defending them is your job.

### Ordering a harvester manually

You can. Right-click ore to send it to a specific patch; right-click your own refinery to send it
home to unload. It will resume its own loop afterwards. A plain move order takes it off the job
until you give it a Harvest order or it goes idle.

---

## Refineries, silos and the credit cap

Credits do not accumulate without limit. Every player has a **storage cap**, and ore banked over it
is **thrown away, not clamped quietly** — the loss is counted, the number flashes, and EVA calls
for silos.

| Source | Storage |
| --- | --- |
| Base, before you build anything | **10,000** |
| Each Ore Refinery | **+2,000** |
| Each Ore Silo | **+1,500** |

The base figure is equal to the starting bank on purpose: nothing the match *hands* you can be
confiscated by a cap. With the default 10,000 start you begin exactly at the cap and the very first
harvester load is wasted until a refinery raises the ceiling — which is a reason to build the
refinery before you build much else.

**The Ore Silo costs 150 credits and 5 seconds**, draws 10 power, and occupies a single cell. Two
silos are worth more storage than a refinery. If you are seeing the **Silos needed** toast, build
some. (It is not the cheapest building in the game — walls are 100, in all three flavours: Concrete
Wall, Rampart and Scrap Barricade. The silo is joint fourth at 150 with the Gate and the two other
armies' silos.)

The cap works in both directions. **Lose a refinery or a silo and your cap shrinks immediately**,
and any credits above the new cap are lost on the spot. A player sitting at 14,900 credits with two
silos who loses one of them loses 1,400 credits with it.

### The free harvester

Every refinery **ships with a harvester** — the Ore Refinery with an Ore Harvester, the Meridian
Ore Cistern with a Sun Collector, the Reclamation Ore Sorter with a Scrapjaw. Free means free: no
charge, no queue slot, no build time. The unit appears when the refinery finishes.

This is not a bonus, it is load-bearing. From a construction-vehicle start your first harvester is
otherwise gated behind a War Factory *and* 1,400 credits, and a player who spends the opening bank
getting there earns nothing in the meantime.

---

## Reading your income

Three places tell you how the economy is doing.

- **Credits**, on the resource strip. A rolling counter that travels toward the true balance at
  1,400 credits per second rather than snapping, so a delivery visibly spins the number. Flyouts
  show each change: green for a gain, red for a loss.
- **Income / min**, at the right of the resource strip on wider displays. Credits per minute,
  rounded to the nearest ten, smoothed over a one-second window with a three-second settle. It is
  slow enough not to flicker between unload pulses and fast enough that losing a harvester shows up
  on it.
- **The advisory line** on the selection dock when nothing is selected. *"No ore income — check
  your harvesters and refinery"* means exactly what it says.

---

## Spending

**You pay by the tick, not up front.**

A queued item accumulates cost as it builds. Two consequences follow, and both are deliberate:

1. **A poor player does not stop, they crawl.** A tick that can only afford 40% of its increment
   advances 40% of its increment. Build speed tracks income, which is what makes a refinery feel
   like a build-speed upgrade rather than just a bigger number.
2. **Cancelling refunds exactly what you have paid so far** — never the full cost, never a
   percentage. Queue a Sledge Tank, cancel it at 90%, and you are out nothing but the time.
   Queueing things you may not want is genuinely free.

Only when you pay *literally nothing* for longer than about half a second does a queue flip to
**Insufficient funds** and stop. Any real payment, including a partial one, clears that hold.

Right-click a cameo to cancel one queued item. It removes the **most recent** one — you are undoing
your last click, not destroying the thing that is 95% built.

Other ways credits move:

| | |
| --- | --- |
| Selling a structure | **half** the build cost. A half-built structure refunds against the fraction actually built, so place-sell-repeat cannot print money |
| Relocating a structure | costs **35%** of its build cost, minimum 50 credits, refunded in full if the move fails |
| Repairing a structure | **0.25 credits per hit point**, paid in half-second pulses after 3 seconds out of combat |
| Repairing a vehicle at a depot | the same 0.25 per hit point |

---

## Crates

Boxes drop on open ground and drive-over pickups are a real, if minor, income stream — and the
reason an early scout is worth building.

The map holds up to **six** crates at a time. The first appears 25 seconds into the match and a
replacement drops every 40 seconds while below the cap. A unit opens one by coming within 2.6
metres of it.

Five outcomes, weighted:

| Outcome | Weight | Effect |
| --- | --- | --- |
| Credits | 40 | 300–900 credits, scaling up to ×2.5 by the ten-minute mark |
| Heal | 20 | The finder and every ally within 10 metres go to full health |
| Promotion | 14 | The finder gains a veterancy rank |
| Free unit | 18 | A unit of the finder's faction walks out of the box |
| Dud | 8 | It was ammunition. It goes off, for 45% of the finder's maximum health, with a five-metre splash |

Credits dominate so a crate never feels like a punishment; the dud is rare enough to be a story
rather than a tax. Crate credits respect your storage cap.

---

## Power and the economy

Power costs no credits to run. What it does is set your **build speed multiplier**, continuously,
from your supply ratio:

| Supply vs. draw | Build speed |
| --- | --- |
| Supply ≥ draw | **100%** |
| Partial supply | scales between the two |
| No supply at all | **25%** |

It never reaches zero. A build queue that stopped dead while your only power plant was on fire
would be a soft lock, and the way out of a blackout is always to build a power plant.

Note what this means at the start of a construction-vehicle match: the moment you deploy, the yard
draws 20 power and nothing supplies any, so your first Power Plant — nominally 8 seconds — takes
about 32. That is not a bug; it is the game telling you what to build first.

A brownout also **darkens structures** — defences first. That half is in
[Base Building](/avihaymenahem/voltmarch/wiki/Base-Building).

---

## Difficulty and the AI's economy

The difficulty setting is partly an economic handicap. It multiplies the AI's **harvested income
only** — never a refund, never a sale, never a crate:

| Difficulty | Income multiplier |
| --- | --- |
| Easy | ×0.65 |
| Normal | ×1.0 |
| Hard | ×1.15 |
| Brutal | ×1.35 |

A Brutal AI mines faster. It does not conjure credits.

---

See also: [How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) · [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building) · [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs)
