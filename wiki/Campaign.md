# Campaign

VOLTMARCH has no story campaign. There are no scripted missions, no briefings, no map-by-map
progression and no cutscenes. What it has instead is a **49-row mission table** that watches every
skirmish you play and pays out when you hit a number.

That is a design decision rather than a shortfall, and it has one consequence worth stating up
front: **nothing is gated behind a mission you have to go and find.** You play skirmishes, the
missions tick, and the roster widens.

There is also a separate **tutorial** on the main menu — a director that watches a real match and
prompts you through the verbs. It is not part of the mission table and grants nothing.

---

## 1. Two scopes

| | Profile missions | Match objectives |
| --- | --- | --- |
| Count | 36 | 13 |
| Persist between matches | yes | no — reset every match |
| Shown | Missions screen | objective panel, in match |
| How many at once | all of them | **5**, drawn from the seed |
| Pay | unlocks, maps, cosmetics | credits |
| Grant unlocks | **yes — all of them** | never |

Profile missions are the chains. Match objectives are the per-match board: five are drawn
deterministically from the match seed, so the same seed always draws the same five, and a replay
shows the same board.

Both listen to the same events, which is why the objective board also advances your profile chains.
A player who never opens the objective panel loses nothing permanent.

Progress is tracked **for the local player only**, and stored per browser profile. Deleting site data
resets it.

---

## 2. The profile chains

### Combat

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| First Blood | destroy 25 units or structures | — | **Raider unit** |
| Field Command | destroy 150 | First Blood | **Specialist defence** |
| War Machine | destroy 500 | Field Command | **Tier-3 specialist unit** |
| Total War | destroy 1,500 | War Machine | Strategic superweapon *(see §6)* + Warlord insignia |
| Can Opener | destroy 60 vehicles | — | **Anti-air emplacement** |
| Armour Column | destroy 250 vehicles | Can Opener | Airstrike power *(see §6)* |
| Demolition Crew | destroy 25 structures | — | Orbital Scan power *(see §6)* |
| Scorched Earth | destroy 100 structures | Demolition Crew | Warhead decal |
| Blooded | promote 20 units to veteran | — | Veteran insignia |
| Old Guard | promote 15 units to elite | Blooded | Emergency Repair power |

### Economy

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Prospector | mine 25,000 credits of ore | — | **Map: Frozen Sector** |
| Strip Mine | mine 70,000 | Prospector | **Tech centre** |
| Continental Yield | mine 1,000,000 | Strip Mine | Ore Boost power *(see §6)* |
| War Chest | hold 20,000 credits at once | — | Magnate insignia |
| Grid Surplus | run a 300-point power surplus | — | Grid decal |

### Construction

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Groundworks | complete 50 structures | — | **Map: Industrial Grid** |
| Continental Engineering | complete 300 structures | Groundworks | Siege superweapon *(see §6)* |
| Production Line | train or build 100 units | — | Chevron decal |
| Total Mobilisation | train or build 750 units | Production Line | **Map: Coral Shore** |
| Motor Pool | build 200 vehicles | — | Laurel decal |
| Air Wing | build 400 vehicles | Motor Pool | **Aircraft — all four armies** |
| Hostile Takeover | capture 10 enemy structures | — | Chronoshift power *(see §6)* |

### Tactics

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Opening Move | win a skirmish | — | Bronze insignia |
| Theatre Command | win 10 | Opening Move | **Naval production** |
| Fleet Admiral | win 40 | Theatre Command | **Capital ships** |
| Blitz | win inside 15 minutes | — | **Map: Contested Strait** |
| Untouched | win without losing a structure | — | **Escort hulls** |
| On A Roll | win 3 in a row | Opening Move | Gold insignia |
| Undefeated | win 10 in a row | On A Roll | Centurion decal |

### Mastery

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Allied Command | win 5 as the Allied Forces | — | Allied insignia |
| Chronosphere Programme | win 20 as the Allied Forces | Allied Command | Chronosphere superweapon *(see §6)* |
| Soviet Command | win 5 as the Soviet Union | — | Soviet insignia |
| Iron Curtain Programme | win 20 as the Soviet Union | Soviet Command | Iron Curtain superweapon *(see §6)* |
| Pact Command | win 5 as the Meridian Pact | — | Meridian insignia |
| Solar Lance Programme | win 20 as the Meridian Pact | Pact Command | Solar Lance superweapon *(see §6)* |
| Career Officer | finish 100 skirmishes | — | Star decal |

> **There is no Reclamation mastery chain.** The Reclamation is fully playable from the first launch
> and has no faction-specific missions and no insignia. (It does have a superweapon — the Stormworks
> — which is gated on its tech building like everyone else's.)
>
> **The air arm used to live here, and it was the oddest gate in the table.** All four aircraft share
> one unlock id, and it was paid by a mission asking for twelve wins **as the Meridian Pact** — so a
> Reclamation player had to go and win a dozen games as somebody else's army to earn their own
> gunship. It now sits on the vehicle chain instead, as **Air Wing** (build 400 vehicles), which is
> where the air arm actually lives: all four aircraft are built by the War Factory off a Radar Dome.
> The Meridian chain is two steps like the other two, and a player who had banked wins against the
> old middle rung kept them — the superweapon step reuses the same mission id and the same metric.

---

## 3. The match objectives

Five of these thirteen are on the board each match, drawn from the match seed.

| Objective | Target | Pays |
| --- | --- | --- |
| Draw Blood | destroy 10 enemy units | 400 |
| Attrition | destroy 30 enemy units | 900 |
| Break The Column | destroy 12 enemy vehicles | 700 |
| Structural Damage | destroy 5 enemy structures | 700 |
| Field Promotion | promote 3 units to veteran | 600 |
| Ore Quota | mine 5,000 credits of ore | 500 |
| Liquidity | hold 15,000 credits at once | 600 |
| Keep The Lights On | reach a 150-point power surplus | 400 |
| Base Of Operations | complete 8 structures | 500 |
| Standing Army | train or build 20 units | 500 |
| Seize The Asset | capture an enemy structure | 800 |
| Intact | finish the match without losing a structure | 1,200 |
| Lightning Campaign | win inside 15 minutes | 1,500 |

> ### The credits are not paid
>
> **All thirteen of these award credits, and nothing in the game pays them out.** The reward is
> recorded, the completion banner fires, the end screen lists it — and no code path ever adds the
> number to a player's bank. There is no credit reason for an objective payout and no consumer for a
> credits-shaped reward.
>
> Treat the objective board as a scoreboard and a set of suggestions, not as income. Do not plan a
> build around the 1,500 from *Lightning Campaign*; it will not arrive.
>
> The objectives are still worth reading, because they feed the profile chains that *do* pay.

---

## 4. What an unlock actually does

The rule is short: **a unit or structure with no unlock tag is available in your very first match.**
Unlocks are an allow-list of exceptions, not a permission system.

What every faction keeps on a fresh profile: a construction vehicle and the yard it deploys into,
power, refinery, barracks, vehicle factory, radar, silo, wall and gate, one cheap defence, a repair
depot, line infantry, an anti-armour infantryman, an engineer, a harvester, a main battle tank, and
the faction commander. That is a complete economy, a complete base and a complete army.

What is behind the gate, and therefore what an unlock *widens*:

| Unlock | What it opens |
| --- | --- |
| Raider unit | Multigunner IFV · Attack Dog · Sandskiff · Arcspitter |
| Tier-3 specialist | Prism Tank · Apocalypse Tank · Zenith Emitter · Slaghurler |
| Aircraft | Vindicator · MiG Fighter · Kestrel Gunship · Swarmhornet — all four behind **Air Wing**, on the vehicle chain |
| Tech centre | Battle Lab · Reliquary · Crucible |
| Specialist defence | Prism Tower · Tesla Coil · Helios Spire · Arc Pylon |
| Anti-air emplacement | Multigunner AA *(Allied only — no other faction has a dedicated AA structure)* |
| Naval production | Naval Yard · Naval Pen · Slipway · Breaker Dock |
| Escort hulls | Hover Transport · Assault Destroyer · Attack Submarine · Kite Corvette · Slag Scow |
| Capital ships | Aircraft Cruiser · Dreadnought · Sunmonitor · Reclaimed Hulk |

Two things follow from this that are easy to miss:

**The tech centre is the biggest single unlock in the game.** Strip Mine — 70,000 credits of
lifetime banked ore, roughly one map's worth — opens the Battle Lab and its equivalents, and the tech
building is the prereq for the tier-3 specialists, the Prism Tower, the capital ships and **every
superweapon in the game**. Until you have it, four of your five sidebar tabs stop one tier short and
you have no end-game at all. If you only chase one mission, chase this one.

That target was 250,000 until v2.4.0, which was three whole maps of ore and put a mid-game building
further out than any superweapon chain — so a new profile could not reach the late game from either
side, because the AI mirrors your unlocks. It is one map now. Progress already banked still counts:
the tracker keeps a raw total per mission and re-compares it, so nothing was reset.

**Chains cost the sum of their rungs, not their last number.** A locked mission does not accumulate,
so Strip Mine only starts counting once Prospector's 25,000 is done — and Fleet Admiral's "win 40"
means 1 + 10 + 40 wins, not 40. Worth knowing before you plan a route.

**The AI mirrors your unlocks.** By default the opponent resolves against the *same profile you do*,
so unlocking the Apocalypse Tank also arms the enemy Soviets with it. This is deliberate: an AI
fielding a unit you have never seen reads as cheating. Multiplayer suppresses gating entirely — both
players get everything.

---

## 5. Maps

Four of the seven battlefields are earned. See [Maps](/avihaymenahem/voltmarch/wiki/Maps) for what each one plays like.

| Map | Earned by |
| --- | --- |
| Frozen Sector | Prospector — mine 25,000 ore |
| Industrial Grid | Groundworks — complete 50 structures |
| Contested Strait | Blitz — win inside 15 minutes |
| Coral Shore | Total Mobilisation — build 750 units |

Locked maps are shown in the skirmish lobby, greyed out, with the reason on them. Map unlocking is
fully wired and works.

---

## 6. What the rewards actually do — the honest table

Most of the reward table is connected to something real. Three classes have a gap between what the
reward says and what happens, and one mission cannot be finished at all. Here is the state of each,
honestly.

| Reward class | Count | Works? |
| --- | --- | --- |
| Unit unlocks | 5 | **Yes.** The sidebar opens up. |
| Structure unlocks | 3 | **Yes.** |
| Map unlocks | 4 | **Yes.** The lobby unlocks the map. |
| Commander powers | 5 | **Implemented, but there is no button** — see below. |
| Superweapon unlocks | 5 | **Gate nothing.** The superweapons themselves are real; these five ids are not what opens them. |
| Objective credits | 13 | **No.** Nothing pays them (§3). |
| Cosmetics | 14 | **Display only.** |

### Commander powers

*Airstrike, Orbital Scan, Emergency Repair, Ore Boost, Chronoshift.* These are **real, implemented
and distinct from the four hero abilities**. They belong to the player rather than to a unit, they
charge from the start of every match, they work with every commander dead, and they land on a point
you name anywhere on the map.

| Power | Earned by | Charge | Radius | Effect |
| --- | --- | --- | --- | --- |
| **Orbital Scan** | Demolition Crew — raze 25 structures | 2:00 | 90 m | Permanently charts a wide circle of the map |
| **Airstrike** | Armour Column — kill 250 vehicles | 2:30 | 20 m | 260 High Explosive on the marker. Friendly-fires. |
| **Emergency Repair** | Old Guard — promote 15 units to elite | 2:30 | 24 m | Restores 45 % of max HP to up to 24 units **and structures** |
| **Ore Boost** | Continental Yield — mine 1,000,000 ore | 3:00 | — | 2,500 credits, immediately |
| **Chronoshift** | Hostile Takeover — capture 10 structures | 4:00 | 30 m | Lifts up to 8 units from within 40 m of your base centroid to the marker |

The charge is spent whether or not the power catches anything.

> **The honest caveat: there is no button for these yet.** The verb, the command bus, the
> multiplayer relay, the replay recorder and all five effects are implemented and tested — a power
> fired in a PvP match or a replay resolves identically on every machine — but nothing in the
> interface draws the five buttons or the arm-then-click that aims them. Today they are reachable
> only from the browser console (`__vmPowers.fire('airstrike', x, z)`). Charges are also not written
> into a save, so a loaded game starts every power charging from full.

Do not confuse them with the **four commander abilities**, which are on the HUD, have a hotkey and a
cooldown ring, and work. Those come free with your faction's 1,500-credit hero and are not in the
unlock table at all — see [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs#the-four-commander-abilities).

### Superweapons

**Six superweapons are buildable and fully wired** — a structure, a countdown row on the HUD, an
arming click and a targeting cursor. See [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs#superweapons) for the
effects and [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building#superweapons) for siting them.

| Weapon | Army | Structure | Cost | Charge |
| --- | --- | --- | --- | --- |
| Nuclear Missile | Soviets | Nuclear Missile Silo | 2,500 | 7:00 |
| Iron Curtain | Soviets | Iron Curtain Device | 2,000 | 5:00 |
| Chronosphere | Allies | Chronosphere | 2,000 | 5:00 |
| Lightning Storm | Allies | Weather Control Device | 2,500 | 6:40 |
| Solar Lance | Meridian Pact | Heliograph | 2,500 | 7:00 |
| Arc Storm | The Reclamation | Stormworks | 2,500 | 6:40 |

**But the five superweapon rewards in the mission table are not what unlocks them.** Every
superweapon structure is gated on its army's **tech building** — Battle Lab, Reliquary or Crucible —
and on nothing else. The tech building *is* a campaign unlock (*Strip Mine*, 250,000 mined ore), so a
fresh profile genuinely has no superweapons; but the moment you have the tech building you can build
all of your faction's, whether or not you have finished *Total War*, *Continental Engineering* or the
20-win mastery chains that claim to award them.

So those five rewards are correct about the direction of travel and wrong about the mechanism. Earn
*Strip Mine* and the end-game is open.

### Cosmetics

Fourteen insignia and decals. Awarding one shows a banner and adds a line to the Missions screen.
Nothing renders them — no unit, structure or HUD element reads a cosmetic id.

### Old Guard used to be impossible

*Old Guard* asks you to promote 15 units to **elite rank**. Its rule used to require veterancy rank
3, and veterancy in this game caps at **rank 2** — rookie, veteran, elite, at 3 and 6 kills. The
counter could therefore never advance, and *Emergency Repair*, its reward, was permanently
unobtainable. The rule now asks for rank 2, so the mission completes normally and the power is
reachable like any other.

---

## 7. A sensible order

If you want the roster open quickly, the cheap end of the table is:

1. **Opening Move** — win one skirmish. Free.
2. **First Blood** — 25 kills. You will pass this in your first match.
3. **Can Opener** — 60 vehicles. Two or three matches. Opens the Multigunner AA, which matters the
   moment aircraft are in play.
4. **Prospector** — 25,000 ore. One long match, or two short ones. Frozen Sector.
5. **Groundworks** — 50 structures. Build silos and walls; they count. Industrial Grid.
6. **Field Command** — 150 kills. Opens the specialist defences, which is the first unlock that
   changes how you defend.
7. **Untouched** — win without losing a structure. Easiest against Easy with a turtle opening.
8. **Strip Mine** — 250,000 ore. This is the wall. Expect a dozen matches. Everything tier-3 sits
   behind it.

*Blitz* (win inside 15 minutes) is much easier than it sounds against an Easy opponent, which does
not commit its first attack until the five-minute mark — see [Strategy](/avihaymenahem/voltmarch/wiki/Strategy).

---

**Factions:** [Allied Forces](/avihaymenahem/voltmarch/wiki/Faction-Allies) · [Soviet Union](/avihaymenahem/voltmarch/wiki/Faction-Soviets) · [Meridian Pact](/avihaymenahem/voltmarch/wiki/Faction-Meridian-Pact) · [The Reclamation](/avihaymenahem/voltmarch/wiki/Faction-Reclamation)

**See also:** [Strategy](/avihaymenahem/voltmarch/wiki/Strategy) · [Maps](/avihaymenahem/voltmarch/wiki/Maps) · [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) ·
[How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) · [Controls](/avihaymenahem/voltmarch/wiki/Controls) · [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building)
