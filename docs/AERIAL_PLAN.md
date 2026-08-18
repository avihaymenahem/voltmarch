# AERIAL COMBAT PLAN

**Written 2026-08-18, at v2.14.0, on `webgpu-migration`.** Requested directly:

> *"I want us to replan a bit the whole aerial combat:*
> * *Set up a new building per faction that will be a landing zone for planes, only this building
>   can produce planes*
> * *Redecide who can shoot drones and planes, they are being destroyed in nano seconds, makes no
>   sense"*

And one hard constraint that arrived from a separate investigation of *"i killed every visible
building and troops and game didnt finish"*, recorded in `src/game/outcome.system.ts`'s header:

> **An enemy reduced to nothing but aircraft is unkillable by a ground-only army, because
> `WeaponDef.canTargetAir` defaults to FALSE by design. That hangs a match forever.** It was
> deliberately not fixed there — it is a content question about AA availability. It is this
> document's question.

So the second ask and that constraint pull in opposite directions, and **the whole design problem is
that the obvious response to "planes die too fast" — make fewer things shoot up — is the one change
that makes an unendable match reachable more often.** Everything below is arranged around that.

---

## 0. THE HONEST VERDICT, UP FRONT

**Ask 1 needs a PREREQUISITE STRUCTURE, not a new `BuildTab`. That is not a close call and §1 shows
the arithmetic.** A dedicated Aircraft tab would contain **exactly one cameo per army**, refuse
every save file on disk, and require a line in the multiplayer command allowlist whose omission ends
every match at the moment somebody queues a plane. A prereq structure needs none of that and
satisfies the user's words — *"only this building can produce planes"* is a statement about
permission, and permission is what `prereqs` is.

**Ask 2's report is TRUE in the massed case and FALSE in the single-shooter case, and the gap between
those two is the entire finding.**

```
                                                    seconds to kill an aircraft
  one AA turret (800 cr, purpose-built)                    1.81 - 2.41
  one Flak Trooper (300 cr, the Soviet AA infantryman)     6.95 - 9.27
  one Sunlancer (450 cr, the Pact's)                       9.80 - 13.07
  --------------------------------------------------------------------
  EIGHT CONSCRIPTS (800 cr, the cheapest thing in the game) 0.98 - 1.36
  TWELVE CONSCRIPTS (1200 cr)                               0.65 - 0.91
```

Eight riflemen — half the price of the aircraft, and a thing a player owns twenty of without ever
deciding to — delete any aircraft in the game in about **one second**. In that second the aircraft
deals **22 to 104 credits** of damage back on a **900 to 1200 credit** hull.

The cause is one inversion, and it is measurable in one line:

> **A 100-credit Conscript is the most cost-efficient anti-aircraft weapon in the game — 220.0 dps
> per 1000 credits against `ArmorClass.Light`, which is 2.55x the Flak Trooper that exists to be the
> Soviet answer to a gunship, and 1.77x the Multigunner AA turret.** The Reclamation's 90-credit
> Scrap Picker is second at 209.1, and is **3.49x** its army's best dedicated answer.

That is not "too many rows carry `canTargetAir`". It is four rows out of twenty-one — the four line-
infantry rifles — attached to the units a player has the most of. The doctrine sentence at the head
of `DEFAULT_WEAPONS` is right that *a soldier can point his own weapon up*; what nothing ever said is
that he should be **better at it than a flak battery**.

**And the second ask cannot be answered by deleting `canTargetAir` from those four rows, because
they are the anti-hang floor.** §4 is the sweep: **on a land map, on a fresh profile, every static AA
emplacement in the game is progression-gated, and the Reclamation's ONLY ungated anti-air of any kind
is `rclPicker`/`rclDredger` firing `arcProd` — the line rifle.** Strip it and that army has no answer
to an aircraft at all, which is the unendable match by construction.

> **RECOMMENDATION.** Ship **S1** (the airbase, prereq route) and **S2a+S2b together** (a per-weapon
> air multiplier on the four line rifles, paired with a cheap purpose-built AA emplacement for the
> three armies that have none). Those two are the answer to both asks and to the constraint. **S3**
> (return-to-pad) is the behaviour half and is genuinely optional. **S4** (rearm/ammo) is a new
> subsystem and should not be in the same conversation.
>
> **Do not ship S2a without S2b.** Cutting incidental AA without adding deliberate AA is the
> unendable match.

### 0b. THE INSTRUMENT

Every number in this document comes from bundling the real `src/data/Defs.ts`, `src/sim/Combat.ts`
and `src/core/config.ts` with esbuild and reading the shipped tables, on the working tree of
2026-08-18. Scripts are in the session scratchpad (`aa.ts` … `aa6.ts`) and are throwaway; the
derivations below are written out so nobody has to re-run them.

**That tree had uncommitted work in it, and I checked whether any of it moves these numbers.** The
only weapon rows edited are `pillboxMg` (11) and `glaiveRepeater` (23) — the emplacement retune —
and **neither carries `canTargetAir`**, so nothing below is measuring somebody else's in-flight
change. Every air row is at its committed value.

The dps convention matches the one `Defs.ts` already uses:

```
  cycle  = burstCount > 1 ? (burstCount - 1) * burstDelay + cooldown : cooldown
  raw    = burstCount * damage / cycle
  vsAir  = raw * ARMOR_MATRIX[warhead][ArmorClass.Light] * COMBAT_DAMAGE.globalMul
```

`COMBAT_DAMAGE.globalMul` is **0.80** as of today, applied once in `Damage.applyOne`. **Every
`seconds` figure below is through it; no `dps/1000cr` ratio is affected by it, because a global
scalar cancels out of a ratio.** That is the exact trap `Defs.ts` records having fallen into six
times, so it is stated once here.

---

## 1. THE DECISION THAT DECIDES ASK 1 — TAB OR PREREQ

**A PREREQUISITE STRUCTURE. Aircraft stay on `BuildTab.Vehicles`.**

The user asked for *"a landing zone for planes, only this building can produce planes"*. Both halves
of that are satisfied by a building the aircraft names in `prereqs`. Neither half asks for a separate
queue, and the arithmetic says a separate queue is a bad trade.

### 1.1 A dedicated Aircraft tab would hold ONE button

Measured over `ProductionCatalog.roster(faction, tab)` on the shipped catalog:

```
faction     Structures   Defence   Infantry   Vehicles   Powers      grid cap = BUILD_COLUMNS 2 x BUILD_ROWS 7 = 14
Allies              13         5          6         12        5
Soviets             13         5          7         11        5
Meridian            12         3          6         12        5
Reclaim             12         3          6         11        5
```

`tests/air-layer.spec.ts` asserts *"all four armies field exactly one aircraft"*. So the new tab
holds **one entry per army**, and the Vehicles tab it was carved out of drops from 12 to 11 — nowhere
near its 14-slot cap. A tab is a container for a decision between several things; there is nothing to
decide between.

### 1.2 What the last tab actually cost, empirically

Two commits in this repo bracket the question:

```
b553857  the Repair Depot — a new building per faction, existing tab, plus a whole new
         servicing mechanic in RepairSell.ts            19 files, 1400 insertions
dc106e2  the Command Post + BuildTab.Powers + the whole commander-powers rework
                                                        51 files, 2873 insertions
```

Much of `dc106e2` is the powers feature rather than the tab. But the tab's own surface is
enumerable, and it is bigger than it looks: **fourteen hard-coded five-element literals exist in the
tree right now**, which is the same shape as the hard-coded four that CLAUDE.md records banking
thirty thousand credits on a silent Brutal brain.

```
  src/core/config.ts          BUILD_TAB_ORDER = [0, 1, 2, 3, 4]        <- GUARDED by command-post.spec:493
  src/net/protocol.ts:330     TABS allowlist, 5 members                <- see 1.3
  src/sim/Production.ts:2033  cameoPool     [[], [], [], [], []]
  src/sim/Production.ts:2044  cameoEntries  [[], [], [], [], []]
  src/sim/Production.ts:2102  cameos        [[], [], [], [], []]
  src/sim/Production.ts:2103  tabAlert      [false, false, false, false, false]
  src/ui/Hud.ts:779           localPool     [[], [], [], [], []]
  src/ui/Hud.ts:783           gridRows      [[], [], [], [], []]
  src/ui/Hud.ts:961           cameos        [[], [], [], [], []]
  src/ui/Hud.ts:962           tabAlert      [false, false, false, false, false]
  src/ui/Sidebar.ts:653       TAB_LABELS    ['Structures','Defence','Infantry','Vehicles','Powers']
  src/ui/Sidebar.ts:663       TAB_SHORT     ['BLD','DEF','INF','VEH','PWR']
  src/ui/Sidebar.ts:2123      tabVisible    [true, true, true, true, false]
  src/input/ActionCatalogue.ts:252  BUILD_TAB_HOTKEYS ['KeyB','KeyT','KeyI','KeyV','']
```

Exactly **one** of those is guarded by a test. `tests/command-post.spec.ts` did close three real
holes — it asserts `BUILD_TAB_ORDER.length === BUILD_TAB_COUNT`, that `queues.length` is sized from
the constant, and it reads `src/sim/AI.ts` as text and refuses `tab >= 3` and `Int32Array(4)`. It
guards none of the other thirteen.

**The silent one is `Sidebar.ts:2123`.** A sixth tab defaults to `undefined` there, which is falsy,
which means the tab is never drawn — with no error, no log and a full queue behind it. That is the
`BuildTab.Powers` failure verbatim, re-armed and waiting.

And a grep cannot find these reliably: `src/sim/AIStrategy.ts:300` holds
`NO_ANSWER = [0, 0, 0, 0, 0]`, which is a five-element **ThreatClass** array and has nothing to do
with tabs. Any regex that catches the thirteen also catches that one, so the audit is manual.

### 1.3 Two costs that a prereq does not pay at all

**Every save file on disk would be refused.** `SaveGame.structuralHash()` hashes `BUILD_TAB_COUNT`
(along with `ARMOR_CLASS_COUNT`, `MAX_ENTITIES`, `ENTITY_KIND_COUNT` and five others), and CLAUDE.md
already records this happening: *"adding a column does NOT refuse an older save — `BUILD_TAB_COUNT`
is in there, which is why the Powers tab did."* A mismatch **refuses**, by design. Replays survive
(a `Command.tab` of 0..4 still means what it meant, because the member is appended), but saves do
not.

**And the multiplayer failure mode is asymmetric and severe.** `src/net/protocol.ts` deliberately
uses an ALLOWLIST rather than a range check, and its own header says why. Forget the one line and
`validateCommand` rejects every aircraft order — which the server FILTERS and the client
**TRIPWIRES**, ending the match. So a one-line omission in a file nobody would think to open turns
"I queued a plane" into "the match ended for both of us".

### 1.4 What a prereq route costs instead

Files touched: `src/data/Defs.ts` (3 building rows, 4 aircraft `prereqs` edits),
`src/sim/Production.ts` (`PRODUCTION_CONTENT`, 3 specs), `src/game/Scenarios.ts` (fallback rows),
`src/art/BuildingDefs.ts` + `Faction3Buildings.ts` + `Faction4Buildings.ts` (4 mass lists),
`src/core/config.ts` (footprint + dimensions), `src/sim/AIStrategy.ts` (`BuildRole.Airbase` + 4
catalog entries), `src/sim/AI.ts` (one `considerAirbase`, the `considerCommandPost` twin),
`src/ui/Cameos.ts`, one new spec file. **Zero changes to `core/types.ts`, `net/protocol.ts`,
`SaveGame.ts`, or any of the fourteen literals.**

That is the Repair Depot's shape minus its new mechanic — call it 12–15 files.

### 1.5 THREE ROWS FOR FOUR ARMIES, following the Command Post exactly

`Faction.Neutral` means "both original armies" in this table. So: one shared `airbase` for the
Allies and the Soviets with two mass lists behind it, plus one each for the Pact and the
Reclamation. Same shape as `commandPost` / `mrdPharos` / `rclSignalRig` and as
`battleLab` / `mrdReliquary` / `rclCrucible`.

**APPENDED to `BUILDINGS`, never inserted.** `store.defId` is a raw array index and `Replay.ts`
records it raw. The three rows go after the Ore Mine, which is currently the tail.

**The prereq must be the radar tier, and the aircraft's own prereq list must change with it.**
`tests/air-layer.spec.ts` currently asserts every aircraft has **exactly two** prereqs, one a vehicle
factory and one a radar, and none a tech building. The new list is `['airbase', 'radar']` (and the
per-faction equivalents) — still two, still no tech building, and the airbase itself carries
`prereqs: ['radar']`. That keeps the tier depth identical and keeps the spec's *intent* while
requiring its *literal* factory-name set to be updated. **That test edit is a deliberate design
change and must be argued in the commit message, not slipped in.**

### 1.6 THE ONE THING THAT IS GENUINELY UNDECIDED: `producesTab`

Three options, and the third is the one I would take.

| | `producesTab` | Plane spawns at | Side effect |
|---|---|---|---|
| A | `BuildTab.Vehicles` | the WAR FACTORY | +35% `FACTORY_SPEED_BONUS` on the whole ground line |
| B | `-1` (pure prereq) | the WAR FACTORY | none |
| C | `-1` + a pad array | **the airbase** | none |

**Option A is what the naval yards already do**, and it is not free:
`BuildQueue.speedFor(n) = min(2.0, 1 + 0.35 * (n - 1))`, so buying an airbase makes every tank,
harvester and MCV 35% faster to build. A second War Factory costs ~2000 credits for that; the
airbase would sell it for whatever the airbase costs. That is a real, unintended economy change and
it should not be shipped by accident.

**Option C is the `navalFactory` precedent, verbatim.** `Production.ts` already carries a second
per-`(player, tab)` array, populated in the same census pass, keyed off an entry bit (`needsShore`),
for exactly this reason — its own comment says *"`primaryFactory` cannot tell a slipway from a war
factory because both declare the same tab"*. An `airFactory` array keyed off an `isAirPad` bit is
~30 lines in a function that already does it once.

**The aircraft egress bug does NOT reopen here, and I checked.** `Production.findEgressSpot` gained
an explicit `Locomotor.Air` branch that returns the door point after an `isInMap` test — the ground
ring scan is never reached. So a plane lifts off whichever pad it is given, and the choice above is
about *which* pad, not *whether* it can leave. The failure CLAUDE.md documents (a finished unit at
`ready: true` blocking the queue, player already charged) is closed for Air and would only reopen if
someone introduced a new locomotor.

### 1.7 The grid is nearly full, and this is the last free slot

Adding one structure per army to the Structures tab:

```
  Allies    13 -> 14     (cap 14)
  Soviets   13 -> 14     (cap 14)
  Meridian  12 -> 13
  Reclaim   12 -> 13
```

**The airbase spends the last slot in the Allied and Soviet Structures tabs.** `command-post.spec.ts`
already has the assertion that catches an overflow (*"pools enough sidebar slots for the biggest tab
any army has"*), and it will pass at exactly 14. **The next structure either army gains needs
`BUILD_ROWS` raised first.** Note that S2b below puts its new AA emplacements on the **Defence** tab
(5/5/3/3 against 14), which has room.

### 1.8 When to revisit the tab decision

Not "never" — a stated trigger:

> **Revisit the tab when any army's air roster reaches three or more airframes AND the Vehicles tab
> is within one slot of `BUILD_COLUMNS * BUILD_ROWS`.** Vehicles is at 12/14 for the Allies and the
> Pact today, so two more vehicles of any kind spends the margin.

---

## 2. THE MEASURED AA TABLE

### 2.1 The four aircraft

```
key           faction   cost   hp   armour  speed  sight  gun                range  raw dps
rclHornet     Reclaim    900  180   Light    11.0    34   hornetArc (Tesla)     17     29.3
mig           Soviets   1000  190   Light    13.5    32   migCannon (AutoCan)   21     94.7
mrdKestrel    Meridian  1100  210   Light    12.0    36   kestrelPod (Rocket)   22     42.7
vindicator    Allies    1200  240   Light    11.5    38   vindicatorMissile     23     48.1
```

All four are `ArmorClass.Light`, which `air-layer.spec.ts` pins deliberately: the air/ground split is
a targeting gate, never a seventh armour row. **So the Light column of `ARMOR_MATRIX` IS the
anti-aircraft column**, and it is generous — AutoCannon 1.00, Rocket 0.95, Tesla 0.95, Prism 0.95,
SmallArms 0.55.

### 2.2 Every `canTargetAir` row, and who carries it

**22 of 42 rows**, of which **`chaingun` (row 6) has no shipped carrier** — it is one of the two
orphan `DEFAULT_WEAPONS` rows CLAUDE.md already names. So **21 live**.

```
idx  row                warhead        raw   vsLight  range  carriers (cost)
  0  rifle              SmallArms     52.4     23.1     18   gi:200  frogman:350
  1  conscriptRifle     SmallArms     50.0     22.0     17   conscript:100  navalInfantry:320
  6  chaingun           AutoCannon   115.8     92.6     22   (ORPHAN)
  8  prismTowerBeam     Prism         38.3     29.1     34   prismTower:1500
  9  teslaBolt          Tesla         50.0     38.0     30   commissar:1500  teslaCoil:1500
 14  shipMissile        Rocket        55.2     41.9     42   dreadnought:2000
 16  rocketLauncher     Rocket        27.3     20.7     24   javelin:500
 17  aaCannon           AutoCannon   124.4     99.5     26   aaTurret:800
 18  pulseCarbine       SmallArms     46.9     20.6     20   mrdWayfarer:175  mrdTidewalker:380
 19  sunLance           Rocket        24.2     18.4     26   mrdLancer:450
 20  arcRepeater        AutoCannon    68.4     54.7     23   mrdSkiff:550
 24  heliosLance        Prism         41.4     31.5     33   mrdHelios:1500
 26  kestrelPod         Rocket        42.7     32.5     22   mrdKestrel:1100
 27  monitorLance       Rocket        53.4     40.6     40   mrdMonitor:1900
 28  arcProd            Tesla         24.8     18.8     14   rclPicker:90  rclDredger:300
 30  spitCoil           Tesla         31.6     24.0     16   rclSpitter:420  rclSkimmer:400
 33  hornetArc          Tesla         29.3     22.3     17   rclHornet:900
 37  pylonArc           Tesla         42.7     32.5     28   rclPylon:1450
 38  flakBurst          AutoCannon    32.4     25.9     20   flakTrooper:300
 39  vindicatorMissile  Rocket        48.1     36.5     23   vindicator:1200
 40  migCannon          AutoCannon    94.7     75.8     21   mig:1000
 41  ifvChaingun        AutoCannon    65.5     52.4     22   ifv:600  hydrofoil:450
```

### 2.3 Single-shooter time-to-kill

```
shooter                cost   dpsLight   mrdKestrel   rclHornet   vindicator      mig
aaTurret (bld)          800       99.5         2.11        1.81         2.41     1.91
mig (veh)              1000       75.8         2.77        2.38         3.17     2.51
mrdSkiff (veh)          550       54.7         3.84        3.29         4.38     3.47
ifv / hydrofoil         600/450   52.4         4.01        3.44         4.58     3.63
dreadnought (veh)      2000       41.9         5.01        4.29         5.72     4.53
mrdMonitor (veh)       1900       40.6         5.17        4.44         5.91     4.68
commissar / teslaCoil  1500       38.0         5.53        4.74         6.32     5.00
vindicator (veh)       1200       36.5         5.75        4.93         6.57     5.20
rclPylon / mrdKestrel  1450/1100  32.5         6.47        5.54         7.39     5.85
mrdHelios (bld)        1500       31.5         6.67        5.72         7.62     6.03
prismTower (bld)       1500       29.1         7.21        6.18         8.24     6.52
flakTrooper (inf)       300       25.9         8.11        6.95         9.27     7.34
rclSpitter/rclSkimmer   420/400   24.0         8.75        7.50        10.00     7.92
gi / frogman            200/350   23.1         9.10        7.80        10.40     8.24
rclHornet (veh)         900       22.3         9.42        8.07        10.77     8.52
conscript/navalInfantry 100/320   22.0         9.55        8.18        10.91     8.64
javelin (inf)           500       20.7        10.13        8.68        11.58     9.17
mrdWayfarer/Tidewalker  175/380   20.6        10.18        8.73        11.64     9.21
rclPicker/rclDredger     90/300   18.8        11.16        9.56        12.75    10.10
mrdLancer (inf)         450       18.4        11.43        9.80        13.07    10.34
```

**Nothing here is a nanosecond.** The worst case in the whole table is 1.81 s, and that is an 800-
credit purpose-built AA turret against a 900-credit aircraft, which is what an AA turret is for.

### 2.4 The massed case, which is where the report lives

```
squad                     credits    dps    mrdKestrel  rclHornet  vindicator     mig
 4x gi                        800     92         2.28       1.95        2.60      2.06
 8x gi                       1600    185         1.14       0.98        1.30      1.03
12x gi                       2400    277         0.76       0.65        0.87      0.69
 4x conscript                 400     88         2.39       2.05        2.73      2.16
 8x conscript                 800    176         1.19       1.02        1.36      1.08
12x conscript                1200    264         0.80       0.68        0.91      0.72
16x conscript                1600    352         0.60       0.51        0.68      0.54
 8x mrdWayfarer              1400    165         1.27       1.09        1.45      1.15
 8x rclPicker                 720    151         1.39       1.20        1.59      1.26
12x rclPicker                1080    226         0.93       0.80        1.06      0.84
```

**The report is literally true here.** Twelve Conscripts cost 1200 credits and delete a 1200-credit
Vindicator in 0.91 seconds.

### 2.5 The trade, both directions

An aircraft attacking a target that eight of the enemy's line infantry happen to be standing near.
Generous to the aircraft: the squad's dps is held constant even as its men die.

```
aircraft      screen           screenCr   aircraft TTK   men killed   credits returned   net
mrdKestrel    8x gi                1600          1.14 s        0.18                 36   -1064
rclHornet     8x gi                1600          0.98 s        0.31                 61    -839
vindicator    8x gi                1600          1.30 s        0.23                 46   -1154
mig           8x gi                1600          1.03 s        0.52                104    -896
mig           8x conscript          800          1.08 s        0.65                 65    -935
```

**A MiG flown at an infantry screen loses 935 credits and kills two thirds of one conscript.**

### 2.6 The structural half: aircraft are the thinnest hulls in the game

Sorted by hp per 1000 credits, over all 38 buildable `EntityKind.Vehicle` rows:

```
  harvester      714      grizzly        486      rhino         467      apocalypse   457
  ifv            367      mrdSkiff       345      mcv           333      prismTank    217
  rclHornet      200  <-- rclSlaghurler  200      vindicator    200  <--
  mrdKestrel     191  <--  mig           190  <--  mrdZenith     160
```

All four aircraft sit at the bottom, above only the Pact's siege hull. This is **deliberate and
pinned**: `air-layer.spec.ts` asserts *"every one of them is the thinnest-skinned thing its army can
build for the money"* and caps `maxHp < 300`. It is defensible on its own — an aircraft is bought for
where it can stand — but it multiplies with §2.4 rather than offsetting it.

---

## 3. DIAGNOSIS — WHICH OF THE FIVE CANDIDATE CAUSES ARE REAL

| # | Candidate | Verdict |
|---|---|---|
| 1 | Too many rows carry `canTargetAir` | **PARTLY — and not the way it reads.** 21 live rows is fine. Four of them are the problem. |
| 2 | The AA rows hit too hard for what an aircraft costs | **FALSE.** The purpose-built rows are OUT-PERFORMED by the incidental ones. |
| 3 | The armour matrix row is unfavourable | **REAL but the wrong instrument.** |
| 4 | Aircraft HP is too low for their price | **TRUE, deliberate, and pinned by a test.** Contributory, not causal. |
| 5 | Aircraft loiter instead of making a pass | **TRUE, and it is the largest single multiplier.** |

### 3.1 (1) is real, and it is exactly four rows

The offenders are the four **line-infantry rifles** — the weapon each army's cheapest, most numerous
soldier carries:

```
 idx  row              vsLight   carriers
   0  rifle              23.1    gi (200)          frogman (350)
   1  conscriptRifle     22.0    conscript (100)   navalInfantry (320)
  18  pulseCarbine       20.6    mrdWayfarer (175) mrdTidewalker (380)
  28  arcProd            18.8    rclPicker (90)    rclDredger (300)
```

Per credit, against `ArmorClass.Light`, in each army's own roster:

```
army       LINE infantryman           its best DEDICATED answer          inversion
Allies     gi            115.3        aaTurret        124.4  (ifv 87.3)    0.93x   (only army not inverted)
Soviets    conscript     220.0        flakTrooper      86.3                2.55x
Meridian   mrdWayfarer   117.9        mrdSkiff         99.5  (lancer 40.8) 1.18x
Reclaim    rclPicker     209.1        rclSpitter       57.1                3.49x
```

**A dedicated answer that loses to the incidental one is not a counter; it is a worse purchase with a
flavour text.** Two of the four armies are inverted by more than 2.5x.

The mechanism is not the multiplier — it is the RAW dps. A rifle is balanced to kill infantry
(SmallArms 1.00 vs Infantry) and therefore has 46–52 raw dps; 55% of that is still 20–23. The Flak
Trooper's `flakBurst` is balanced as an infantryman and has 32.4 raw; 100% of that is 25.9. The
purpose-built weapon's whole advantage is a **1.6x multiplier over a 1.6x raw deficit.** They cancel.

### 3.2 (2) is FALSE, and the measurement says so

The Multigunner AA turret is the single hardest-hitting AA thing in the game, and at **124.4 dps per
1000 credits** it is *less* cost-efficient than a Conscript at 220.0. No dedicated AA row is
over-scaled. Cutting them would make the inversion worse, not better.

### 3.3 (3) is real but the instrument is wrong

`ARMOR_MATRIX[SmallArms][Light] = 0.55` is the specific cell doing the damage. It is also the cell
that governs riflemen versus the **IFV, Sandskiff, Spitter, Prism Tank, Zenith, Solarch, Slaghurler,
Hydrofoil, Skimmer, transports and every landing ship** — twelve-plus ground hulls. Moving it to fix
air moves all of them.

`tests/combat.spec.ts:176` pins `armorMultiplier(SmallArms, Infantry)` to exactly 1 as the
counter-triangle's reference cell, and `tests/emplacement-band.spec.ts` builds on that. The Light
cell is not pinned, so it *could* move — which is exactly why it should not: it is a load-bearing
ground relationship with no test holding it, and it would move silently.

**Use a gate that only sees the air case.** See S2a.

### 3.4 (4) is true, deliberate, and should NOT be the lever

190–200 hp per 1000 credits, bottom of the roster. To make eight GIs need 3.7 s to kill a Vindicator
by HP alone you would need **685 hp** — 2.9x, three times a Grizzly's hp-per-credit, on a Light hull
that cannot be shot by two thirds of the army. It also breaks the AA turret in the other direction:
2.41 s becomes 6.9 s, and the purpose-built answer stops working. Raising HP fixes the symptom by
deleting the counter.

### 3.5 (5) is true, and it is the largest multiplier — but "force a pass" is the wrong fix

`src/sim/Targeting.ts` closes any attacker to `range * 0.80` and **parks** it there
(`APPROACH_STOP_FRAC = 0.80`, `APPROACH_PARKED`), publishing the goal exactly once. An aircraft
therefore flies to 13.6–18.4 m from its target and stays until one of them is dead. Nothing retreats
it: CLAUDE.md already records `flee = 0` at every sample of every AI rung, and the AI retreats
armies, never units.

Altitude buys nothing. `Combat.engage` computes `flat = sqrt(dx² + dz²)` and
`surfaceDist = flat - hitRadius(target)`; **`dy` is not in it.** So `AIR_CRUISE_ALTITUDE = 22` m of
vertical separation costs a ground shooter exactly zero range. A rifleman standing directly beneath
an aircraft is at `flat = 0`.

What a pass WOULD cost, if the aircraft flew through instead of stopping (`2R / v`, R = 19 m, the
rifle envelope):

```
  mrdKestrel  3.2 s      rclHornet  3.5 s      vindicator  3.3 s      mig  2.8 s
```

**But here is the part that stops "force a pass" from being the fix.** What one pass is *worth* to
the attacker, at today's damage:

```
aircraft      pass    grizzly   rhino   powerPlant   harvester
mrdKestrel    3.2 s      29%     24%          12%          10%
rclHornet     3.5 s      20%     17%           6%           7%
vindicator    3.3 s      34%     29%          14%          12%
mig           2.8 s      41%     18%           9%           7%
```

A Vindicator's whole attack run takes **14% off a Power Plant**. Force a pass and the unit class
stops existing.

> **The loiter is a problem because it is the ONLY behaviour, not because loitering is wrong.** The
> fix is a way OUT — a return order the player and the AI can both issue — not a way to forbid
> staying. That is S3, and it is genuinely optional relative to S2.

---

## 4. THE HARD CONSTRAINT — CAN EVERY FACTION ALWAYS BUILD SOMETHING THAT SHOOTS UP?

Swept over the shipped `UNITS`, `BUILDINGS`, `UNLOCK_TAGS` and the transitive prereq closure of every
air-capable entry, from a bare Construction Yard.

### 4.1 The answer today: YES — but only through infantry, and for one army only through the line rifle

Cheapest ungated, non-naval route to something that can shoot up:

```
army       route                                            total credits (structure chain + the unit)
Allies     powerPlant > barracks > gi                                 1000
Soviets    powerPlant > barracks > conscript                           900
Meridian   mrdConclave > mrdSolarArray > mrdChapterhouse > Wayfarer   4025
Reclaim    rclFoundry > rclFurnace > rclRookery > rclPicker           3780
```

The complete ungated, non-naval AA roster, per army:

```
Allies     gi, frogman, javelin                    (3)
Soviets    conscript, navalInfantry, flakTrooper    (3)
Meridian   mrdWayfarer, mrdTidewalker, mrdLancer    (3)
Reclaim    rclPicker, rclDredger                    (2)  <-- BOTH fire arcProd, the line rifle
```

**Two findings fall straight out of that.**

**(a) Every static AA emplacement in the game is progression-gated.** `aaTurret` behind
`struct.defence.aa`; `teslaCoil`, `mrdHelios` and `rclPylon` behind `struct.defence.specialist`. A
fresh profile has **zero** static anti-air in every army. The only reason this is not already
producing hung matches is an accident of mission ordering: `struct.defence.aa` is paid by
`combat.armour.1` ("destroy 60 enemy vehicles", difficulty 1, no `requires`) while `unit.air` is paid
by `construction.armour.2` ("build 400 vehicles", difficulty 3, requires `construction.armour.1`).
Static AA arrives long before anyone can fly. **That is an ordering guarantee, not a design
guarantee, and `aiMirrorsUnlocks: false` removes it** — the AI is then ungated against whatever the
human happens to have earned.

**(b) Three of four armies have no cheap purpose-built AA emplacement at all.** `aaTurret` is
`Faction.Allies`, 800 credits. The Soviets, the Pact and the Reclamation have only their 1450–1500
credit tier-3 dual-purpose tower.

### 4.2 The state that actually hangs, and it is reachable

`Viability.isBeaten` = no producer AND no contesting unit. So a player holding a War Factory and
tanks is *not* beaten, and if their opponent is down to aircraft:

- the ground player cannot hurt the aircraft (`canTargetAir` false on every tank gun);
- the aircraft player is not declared beaten (aircraft are `EntityKind.Vehicle`, so `UNIT_KINDS`
  counts them — the `outcome.system.ts` header states this and it is correct);
- and neither side's state changes.

**The dead state is: no Construction Yard, no barracks-equivalent, and no surviving air-capable
unit.** With a Construction Yard you rebuild the barracks; with a War Factory you build an ungated
`mcv` and get the yard back (the `AI_REBUILD` route — `mcv` carries no unlock tag precisely so a
fresh profile can replace one). Lose both and the route is gone, and you are not beaten.

This is the `OreCrisis` dead end wearing a different hat, and it has the same shape: two exits that
each require the thing you have lost.

### 4.3 What this constrains, stated as a rule

> **THE FLOOR: from every reachable tech state, every army must be able to produce something whose
> weapon carries `canTargetAir`, with no progression gate and no map dependency.**
>
> Today the floor is held up entirely by the four line-infantry rifles. **Any change that removes
> `canTargetAir` from them removes the floor**, and for the Reclamation it removes the last thing
> holding it.

That single sentence is why §5 chooses a **multiplier** over deleting the flag. A weapon at
`airDamageMul = 0.30` still kills an aircraft — twenty Scrap Pickers still take one down in about two
seconds — so the floor survives by construction, while the incidental screen stops being the best AA
in the game.

### 4.4 Where the fix belongs

**Here, not in the victory condition, and I agree with `outcome.system.ts`'s refusal.** Making
`isBeaten` ask "can my opponent even be hurt" would require `Viability` — a deliberately structural
survey with no content knowledge — to walk the weapon table and the production catalog and ask a
counterfactual about what the *other* player could build. That is a content question wearing a
victory-condition costume, and answering it there would give a second copy of a rule the sell guard
also reads (the exact hazard `Viability`'s own header names).

The content fixes are cheaper and truer:

- **S2a preserves the floor by construction** (a multiplier, never a deletion).
- **S2b gives every army a cheap purpose-built AA emplacement**, so "answer a gunship" is a 800-credit
  decision rather than a 1500-credit tier-3 one, in all four armies.
- **S3b, if taken, ungates them** — the mirror of the navy's rule, stated below.

**One thing worth flagging as still open even after all three:** none of this closes the *specific*
state in §4.2 (no yard, no barracks, no air-capable unit). It makes it rarer, not impossible. If it
turns out to matter, the honest fix is the `OreCrisis` shape — a narrow, four-clause predicate with a
standing structure redeeming a promise — and **not** a change to `isBeaten`. It is not in this plan
because I have no evidence the state occurs in practice, and `OreCrisis` was written only after the
dead end was enumerated exhaustively over the real catalog. Enumerate first.

---

## 5. WHAT A "LANDING ZONE" IMPLIES — AND WHAT ALREADY EXISTS

Two things I checked because the word "landing" invites them, and the answers are not what you would
guess.

### 5.1 Nothing today makes an aircraft return anywhere, and there is no ammo

`src/sim/Movement.ts` holds `MoveClass.Air` at `ground + AIR_CRUISE_ALTITUDE` **every tick**, with an
exponential approach — there is no landing state, no descent, no fuel and no ammunition anywhere in
the project. `Defs.ts` says so explicitly and correctly: *"IT NEVER LANDS… adding one would be a new
subsystem rather than a def row."* A landing zone that planes actually land on is therefore a real
mechanic, not a building.

### 5.2 BUT: repair-on-station already works, by accident, and nobody has written it down

`RepairSell.tickDepots` walks `store.byKind[EntityKind.Vehicle]` and tests

```
  dx * dx + dz * dz > r2        // REPAIR_DEPOT.radius = 10.0
```

— **horizontal distance only.** Aircraft are `EntityKind.Vehicle` (there is no `EntityKind.Aircraft`;
`UnitDef.kind` is typed `Infantry | Vehicle` at `types.ts:868`, and that is now pinned by a test). No
part of `RepairSell.ts` mentions `Locomotor`, `Air` or altitude.

> **So an aircraft loitering 22 m directly above one of your Repair Depots is being repaired right
> now**, at `REPAIR_COST_PER_HP`, at 10% of max HP per second, without landing, and with the
> `BeingRepaired` tag showing in the selection panel.

I have not observed this in a running match — it is a code read, and it should be verified before it
is quoted anywhere else. If it holds, it changes the cost of S3 a lot: **"repair on the pad" is
mostly a re-skin of behaviour that already happens**, and what is missing is only the *order* that
sends the aircraft there.

### 5.3 So the landing zone splits into four independently shippable things

1. **The building** — a prereq and (optionally) an egress pad. This is the literal ask. **S1.**
2. **A return order** — `OrderKind.Enter` on the pad, or a new `Return`. **S3a.**
3. **Repair on the pad** — largely already there via §5.2, or a depot bit on the airbase. **S3a.**
4. **Ammunition and rearm** — a per-unit shot counter, an out-of-ammo state, a forced return, a
   reload timer, UI for all of it, AI that understands it, a save column, a checksum column, and a
   replay-visible state. **S4, and it should not be in this conversation.**

---

## 6. STAGES AND COST

Competent developer with an AI pair. Each stage is independently shippable and leaves the four gates
green on its own — **except that S2a must not ship without S2b**, for the reason in §4.

| | Stage | Hours | Notes |
|---|---|---|---|
| **S1** | **The airbase — three defs, four mass lists, prereq route** | **10–16** | The Repair Depot's shape minus its mechanic. Most of it is art: `MassList` rejects a silhouette more than ~85% axis-aligned rectangle, and a pad is the single easiest shape to fail that on. Budget half of it for `src/art/`. |
| S1b | `producesTab` decision + `airFactory` pad array | 2–4 | Only if option C in §1.6. ~30 lines mirroring `navalFactory`, in the census loop that already does it. |
| **S2a** | **`WeaponDef.airDamageMul`, on four rows** | **4–8** | One field, one default of 1, one multiply. Four authored values. The hours are the derivation and the probe, not the code. |
| **S2b** | **A cheap AA emplacement for the three armies without one** | **12–18** | Three defs, three mass lists, three AI catalog entries with `BuildRole.AntiAir`. Defence tab has room (5/5/3/3 against 14). Same shape as S1, one more army. |
| S3a | Return-to-pad order + repair on the pad | 8–14 | Depends on §5.2 being verified. If the depot already services aircraft, this is an order and a rally point. |
| S3b | Ungate the AA emplacements | 3–6 | Delete `struct.defence.aa` from `UNLOCK_TAGS`, never add one to the S2b rows, **retire `combat.armour.1`** and update the survey block inside `UNLOCKS`. See the warning below. |
| S3c | Retreat-when-hurt for aircraft | 6–12 | The only unit class that would have it. Genuinely new behaviour; see §8. |
| S4 | Ammunition and rearm | **30–50** | A new subsystem. Save column, checksum column, replay-visible state, AI, UI. |

**S3b carries a cost that must be paid explicitly.** The navy's rule was *content required to REACH
the enemy is never progression-gated*, and the mirror here is *content required to ANSWER the enemy is
never progression-gated*. Applying it means `struct.defence.aa` is deleted from `UNLOCK_TAGS` — which
leaves `combat.armour.1` ("Can Opener", destroy 60 enemy vehicles) paying nothing. The survey written
into `UNLOCKS` in `src/data/Missions.ts` records that **the def catalogue has nothing left a new
group could legally cover**, so the mission must be RETIRED, exactly as Armour Column, Continental
Yield and Hostile Takeover were. **Do not "fix" it by paying it cosmetics or credits** — both are
declared gaps in `tests/reward-wiring.spec.ts` and paying into one is the original defect with a
different noun. Retiring a difficulty-1 mission with no `requires` costs a rung near the start of the
curve, and that is a product call, not an engineering one.

### 6.1 Deriving `airDamageMul`, because a picked number is not a plan

Two anchors, following the method `tests/emplacement-band.spec.ts` established: derive the target
from a trade you can describe.

**Anchor P1 — the counter must be the counter.** For each army, the line infantryman must not
out-perform his army's best dedicated air answer, per credit. Solving `line * p < best`:

```
Allies     p < 1.078   (already satisfied — gi 115.3 vs aaTurret 124.4)
Meridian   p < 0.844
Soviets    p < 0.392
Reclaim    p < 0.287
```

**Anchor P2 — a screen should hurt, an AA position should kill.** Damage landed on one 19 m pass
(`2R / v`), by a screen of eight line infantry, as a percentage of the aircraft's health:

```
  p = 1.00     249% - 289%      (today — the pass is fatal twice over)
  p = 0.40     100% - 116%
  p = 0.35      87% - 101%
  p = 0.30      75% -  87%
  p = 0.25      62% -  72%
```

For comparison, unaffected by `p` because it is purpose-built: **one 800-credit AA turret does
187%–261% of an aircraft's health on a single 26 m pass.** The purpose-built answer keeps working.

**Both anchors land in 0.25–0.40. I would take 0.30 and probe it.** At 0.30: a screen takes an
aircraft to a quarter health on the first pass and kills it on the second; the AA turret kills on the
first; the Flak Trooper becomes 1.31x better anti-air per credit than a Conscript instead of 0.39x;
and twenty Scrap Pickers still take a Hornet down in ~2 s, so the §4.3 floor holds.

**Where I am uncertain, and it is worth naming:** P1's Reclamation bound (0.287) is driven by a
90-credit unit, and a per-credit test will always flatter the cheapest thing in the game. If the
Reclamation gets a proper AA emplacement in S2b, its bound relaxes to whatever that emplacement is
priced at, and 0.35 may be the better number. **Derive the final value AFTER S2b's prices are set,
not before.**

### 6.2 Which rows get the multiplier

**The four line rifles only:** `rifle` (0), `conscriptRifle` (1), `pulseCarbine` (18), `arcProd` (28).
Every other row keeps 1.0.

That is the doctrine sentence at the head of `DEFAULT_WEAPONS`, refined rather than reversed. It
currently reads: *A SOLDIER CAN POINT HIS OWN WEAPON UP, AN AUTOCANNON TRACKS, A GUIDED ROCKET
FOLLOWS, AND A PURPOSE-BUILT AA MOUNT IS WHAT IT SAYS ON THE TIN.* Three of those four clauses
describe a **tracking or purpose-built system**. The first describes a man with iron sights. The
multiplier says: *and he is bad at it* — which is the only clause of the four that was ever making a
claim about accuracy rather than about elevation.

**`arcProd` is the awkward one and should be argued, not assumed.** It is the Reclamation's line
rifle AND its doctrine block says the army's answer to a gunship is *"THE SOLDIER AND THE PYLON,
nothing else"*. Penalising it makes that sentence false unless S2b gives that army something else,
which is another reason S2a and S2b travel together. Rewrite the block; do not work around it.

---

## 7. THE TESTS EACH STAGE NEEDS

**S1 — `tests/airbase.spec.ts`,** modelled on `tests/command-post.spec.ts`:

- Three defs, four armies, each army resolving to exactly one; `Faction.Neutral` covers Allies +
  Soviets and neither Pact nor Reclaim draws from the Neutral pool.
- **All four aircraft name the airbase in `prereqs`, and NOTHING else in the game does.** That is the
  whole of *"only this building can produce planes"* and it is one assertion.
- `air-layer.spec.ts`'s tier-depth test updated in place — still exactly two prereqs, still a radar,
  still no tech building — with the factory-name set replaced by the pad-name set. **Edit it; do not
  add a second test that contradicts it.**
- The sidebar grid assertion in `command-post.spec.ts` still passes at 14/14. Add an explicit
  `toBe(14)` so the next structure fails loudly rather than silently not drawing.
- `building-shape.spec.ts` roster ratchet rebased, including the MEAN-triangles cap that exists so
  growing the roster cannot buy slack for what is already in it.
- The def/fallback digit-for-digit agreement (`Scenarios.FALLBACK_BUILDINGS`), which is the check that
  catches a build bar reaching 100% and delivering nothing.
- **If option C:** an aircraft ordered from a base holding both a war factory and an airbase egresses
  at the AIRBASE. The `navalFactory` bug is the template — it took a live match to find.

**S2a — extend `tests/air-layer.spec.ts` §"canTargetAir — the gate, and its default":**

- `airDamageMul` defaults to 1 and is applied in exactly one place, after the armour matrix.
- **A ground target is bit-identical** with the field present. This is the property the whole change
  rests on and it is the one an off-by-one in `applyOne` would break.
- The four penalised rows are named explicitly and the list is asserted CLOSED — a fifth row gaining
  the field fails the test, in the `OVER_BAND` style that fails in both directions.
- **The inversion test, which is the real gate:** for every army, the best dedicated air answer must
  beat the line infantryman in dps-per-credit against `ArmorClass.Light`. That is the property; the
  number 0.30 is an implementation detail of it.
- **The floor test, and it is the most important one in this document:** for every faction, the set
  of buildable entries with `canTargetAir`, filtered to those with no `unlockedBy` and no naval
  prereq, is **non-empty**. Written against the catalog, not against a hard-coded list, so it fails
  when someone deletes the last one.

**S2b — same file:** every army has an AA emplacement whose price is within a band of the others'
(the `air-layer.spec.ts` price-band shape), on `BuildTab.Defense`, carrying `BuildRole.AntiAir`, and
`air-layer.spec.ts`'s existing rule — every `BuildRole.AntiAir` structure has a weapon that can shoot
up — still holds.

**S3b — `tests/reward-wiring.spec.ts`:** `struct.defence.aa` is gone from `UNLOCK_TAGS`, no mission
grants it, and the retirement is recorded in the `UNLOCKS` survey block. Plus the sea-crossing
analogue: **no air-answering entry may name an unlock id.**

**S3a/S3c — a probe, not a unit test.** Whether an aircraft that can leave is *better* is a fact
about a match, not an invariant. Follow `tests/amphibious-landing.spec.ts`: opt-in behind an env var,
because a landing count is a fact about one seed.

**What no test can see, and must be checked by hand:**

- **`npm run shots` cannot regress any of this.** No fixture poses an aircraft, `?shot=` boots the
  sim frozen, and the harness photographs a static frame. A green scorecard says nothing about a new
  building's silhouette in motion or about a plane on a pad.
- **Boot a match.** The `BuildTab.Powers` lesson is that the whole suite can be green while a Brutal
  brain banks thirty thousand credits. Verify: the airbase places and lights, a plane comes out of
  IT, the AI builds one, and an aircraft flown into eight riflemen survives the first pass.

---

## 8. WHAT I WOULD NOT DO, AND WHY

1. **A new `BuildTab.Aircraft`.** §1. One cameo per army, every save on disk refused, thirteen
   unguarded five-element literals, and a wire-allowlist line whose omission ends multiplayer
   matches. Revisit only at the trigger in §1.8.

2. **A seventh `ArmorClass` for aircraft.** It looks like the clean fix for §3.3 and it is not.
   `ARMOR_CLASS_COUNT` is 6, the matrix is 7x6, `setArmorMatrix` hard-refuses anything else, and
   `ARMOR_CLASS_COUNT` is **in `structuralHash`** — so it refuses every save exactly as a new tab
   does, and it costs seven new authored cells that every future warhead must also fill.
   `air-layer.spec.ts` and `Defs.ts` both state the rule outright: *the air/ground distinction is a
   TARGETING gate, never a seventh armour row.* Overturn that by rewriting it with an argument, or
   not at all.

3. **A distinct `EntityKind.Aircraft`.** `UnitDef.kind` is typed `Infantry | Vehicle` at
   `types.ts:868`, `ENTITY_KIND_COUNT` is in `structuralHash`, and a sweep of every `Locomotor.Air`
   unit confirming the current state is now pinned by a test. It would also silently change
   `Viability.UNIT_KINDS`, the Repair Depot's `byKind` walk, and every `st.byKind[EntityKind.Vehicle]`
   loop in the tree. Nothing in either ask needs it.

4. **Deleting `canTargetAir` from the line rifles.** §4. It is the cleanest-looking answer to *"too
   many things shoot planes"* and it removes the anti-hang floor in all four armies and removes the
   Reclamation's only ungated answer outright. The multiplier gets the same feel and keeps the floor
   by construction.

5. **Moving `ARMOR_MATRIX[SmallArms][Light]`.** §3.3. It governs twelve-plus ground hulls, it is not
   pinned by any test, and it would move them silently.

6. **Raising aircraft HP to fix this.** §3.4. Needs 2.9x, contradicts a pinned test, and breaks the
   AA turret in the other direction.

7. **Forcing an attack run — an aircraft that cannot stop.** §3.5. A Vindicator's entire pass takes
   14% off a Power Plant. Forcing the pass deletes the unit class. Give it a way out instead.

8. **Nerfing the Multigunner AA turret.** It is the correct shape and is currently *less* efficient
   per credit than a Conscript. **After S2a lands it becomes the dominant answer and should be
   RE-MEASURED** — 187%–261% of an aircraft's health on one pass may well be hot then. Measure after,
   not before, and never both in the same commit.

9. **Ammunition and rearm in the same change as the building.** §5.3. It is 30–50 hours, a save
   column, a checksum column and a replay-visible state, and it is the thing that makes the landing
   zone a *mechanic* rather than a *place*. It deserves its own decision.

10. **Making `Viability.isBeaten` ask whether an opponent can be hurt.** §4.4. It is a content
    question in a structural survey, and it would give the sell guard and the outcome poll two
    different copies of one rule — the exact failure `Viability`'s own header exists to prevent.

11. **Quoting "the AI has no air micro" as a new finding.** CLAUDE.md already records `flee = 0` at
    every sample of every rung, and that the AI retreats armies rather than units. S3c would make
    aircraft the first exception, and a one-unit-class exception to a whole-game behaviour rule is a
    thing to argue for, not to slip in.

---

## 9. OPEN QUESTIONS

Named rather than guessed.

1. ~~**Is §5.2 true in a running match?**~~ **ANSWERED — YES. A Repair Depot already services an
   aircraft loitering above it, today, on the shipped build.** Read straight off
   `RepairSell.tickRepairs`: the candidate loop is `st.byKind[EntityKind.Vehicle]`, which is where
   every flyer lives (there is no `EntityKind.Aircraft`); the filters are `maxHp`, `hp`, `Alive` and
   `PendingDestroy`, none of which an aircraft fails; and the pad test is
   `dx * dx + dz * dz > r2` — **no Y term and no `Locomotor.Air` check anywhere in the file.**

   So the "return to base to repair" half of a landing zone is not a new mechanic. It is a mechanic
   the game already has and never advertised, and S3a is correspondingly cheaper: the work is making
   it DELIBERATE (a pad the aircraft flies to, a reason to go) rather than building repair.

   Whether the current behaviour is a bug is a separate question this plan does not settle, and it
   should be settled before S3a rather than during it. An aircraft parked over any depot healing for
   free — no landing, no vulnerability, and only the XZ radius to respect — is almost certainly not
   what anyone designed, and it is exactly the kind of thing that reads as intended once a landing
   zone exists to justify it. Decide first, then build.

2. **`producesTab`: A, B or C?** §1.6. C is my recommendation and it is the only one where the plane
   comes out of the building the user asked for. A ships a silent +35% on the ground line.

3. **What is `airDamageMul` exactly?** 0.30 is derived from two anchors that both land in 0.25–0.40,
   and the tighter of the two is set by a 90-credit unit. **Re-derive after S2b's prices exist.**

4. **Should `arcProd` take the penalty?** It is the Reclamation's line rifle and its doctrine block
   names it as half the army's entire air answer. If S2b gives that army an emplacement, yes. If S2b
   is deferred, **no** — and then S2a covers three rows, not four, and the Reclamation stays inverted
   at 3.49x on purpose and with a comment saying so.

5. **Does the AI understand any of this?** `AiBrain` has `BuildRole.AntiAir`, an air-reaction ladder
   and `AI_SKILL[].maxAntiAir`, so S2b's emplacements slot in. S1 needs a `considerAirbase` (the
   `considerCommandPost` twin). **S3a's return order has no AI consumer at all** and would be a brain
   that flies planes away — that is a strategy-layer addition, and the strategy layer is already
   documented as unfinished.

6. **Is the §4.2 dead state (no yard, no barracks, no air-capable unit) actually reachable in play?**
   I proved it is reachable *in principle* from the rules. I have no evidence it occurs. **Enumerate
   it exhaustively over the real catalog before writing any rule for it**, exactly as
   `tests/ore-crisis.spec.ts` did before `OreCrisis.ts` was written.

7. **Does retiring `combat.armour.1` leave a hole in the early curve?** It is difficulty 1 with no
   `requires`, so it is one of the first missions a new profile can complete. §6's S3b says retire
   it; whether that is acceptable is a product call nobody has made.

8. **Should the airbase be a Structures-tab building at all, given it spends the last grid slot?**
   §1.7. The alternative is raising `BUILD_ROWS`, which changes the sidebar's whole vertical budget
   and is a look-bible question, not a gameplay one.
