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
| Old Guard | promote 15 units to elite | Blooded | Emergency Repair power *(**unreachable — see §6**)* |

### Economy

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Prospector | mine 25,000 credits of ore | — | **Map: Frozen Sector** |
| Strip Mine | mine 250,000 | Prospector | **Tech centre** |
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
| Pactworks Aviation | win 12 as the Meridian Pact | Pact Command | **Aircraft — both of them** |
| Solar Lance Programme | win 20 as the Meridian Pact | Pactworks Aviation | Solar Lance superweapon *(see §6)* |
| Career Officer | finish 100 skirmishes | — | Star decal |

> **There is no Reclamation mastery chain.** The Reclamation is fully playable from the first launch
> and has no faction-specific missions, no insignia and no superweapon. It also means the
> **Swarmhornet** — the Reclamation's only aircraft — is unlocked by *Pactworks Aviation*, which asks
> for twelve wins **as the Meridian Pact**. Both gunships share one unlock id. If you want to fly as
> the Reclamation, you have to go and win a dozen games as somebody else first.

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
| Aircraft | Kestrel Gunship · Swarmhornet |
| Tech centre | Battle Lab · Reliquary · Crucible |
| Specialist defence | Prism Tower · Tesla Coil · Helios Spire · Arc Pylon |
| Anti-air emplacement | Multigunner AA *(Allied only — no other faction has a dedicated AA structure)* |
| Naval production | Naval Yard · Naval Pen · Slipway · Breaker Dock |
| Escort hulls | Hover Transport · Assault Destroyer · Attack Submarine · Kite Corvette · Slag Scow |
| Capital ships | Aircraft Cruiser · Dreadnought · Sunmonitor · Reclaimed Hulk |

Two things follow from this that are easy to miss:

**The tech centre is the biggest single unlock in the game.** Strip Mine — 250,000 credits of
lifetime mined ore — opens the Battle Lab and its equivalents, and the Battle Lab is the prereq
for the tier-3 specialists, the Prism Tower, the capital ships and (in the simulation) every
superweapon. Until you have it, four of your five sidebar tabs stop one tier short.

**The AI mirrors your unlocks.** By default the opponent resolves against the *same profile you do*,
so unlocking the Apocalypse Tank also arms the enemy Soviets with it. This is deliberate: an AI
fielding a unit you have never seen reads as cheating. Multiplayer suppresses gating entirely — both
players get everything.

---

## 5. Maps

Four of the six battlefields are earned. See [Maps](Maps) for what each one plays like.

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

Not every reward in the table above is connected to something. Here is the state of each class.

| Reward class | Count | Works? |
| --- | --- | --- |
| Unit unlocks | 5 | **Yes.** The sidebar opens up. |
| Structure unlocks | 3 | **Yes.** |
| Map unlocks | 4 | **Yes.** The lobby unlocks the map. |
| Objective credits | 13 | **No.** Nothing pays them (§3). |
| Commander powers | 5 | **No consumer exists.** |
| Superweapons | 5 | **No structure exists.** |
| Cosmetics | 14 | **Display only.** |

### Commander powers

*Airstrike, Orbital Scan, Emergency Repair, Ore Boost, Chronoshift.* These five are awarded, stored
on your profile and listed on the Missions screen. Nothing reads them. There is no power bar, no
hotkey, no button and no effect.

Do not confuse them with the **commander abilities**, which are real and which you get for free by
building your faction's hero. Those are on the HUD, have a hotkey and a cooldown ring, and work:

| Commander | Ability | Radius | Cooldown | Effect |
| --- | --- | --- | --- | --- |
| Field Marshal (Allies) | Chrono Rally | 34 m | 50 s | Teleports up to 6 nearby friendlies to the commander |
| War Commissar (Soviets) | Iron Will | 16 m | 60 s | 5 seconds of true invulnerability for friendlies in radius |
| Hierarch (Meridian) | Prism Focus | 18 m | 45 s | 210 damage to every enemy in radius |
| Scrap Baron (Reclamation) | Salvage Call | 22 m | 40 s | Consumes up to 8 wrecks for 120 credits each; heals friendlies 30 % |

The commanders are **not** in the unlock table. They are capped at one alive, cost 1,500, and need a
barracks and a radar — which means you can field one in your first match. That is deliberate: the
point of a hero is that it is the thing you build as soon as you can.

### Superweapons

Five superweapon unlocks are authored, and **no superweapon structure exists in the roster.** The
unlock ids were written ahead of the content on purpose.

Separately, the simulation *does* implement four superweapons — Nuclear Missile (Soviet, 7 min
charge), Iron Curtain (Soviet, 5 min), Chronosphere (Allied, 5 min) and Lightning Storm (Allied,
6 min 40) — and they charge off a live, powered **Battle Lab** as a fallback for the structures that
do not exist. But there is no countdown row on the HUD, no arming button and no hotkey. In the
shipped build they are only reachable from the browser console. They are also Allied/Soviet only: the
Pact's Reliquary and the Reclamation's Crucible do not satisfy the gate, so those two factions have
no superweapon at all even in the simulation.

### Cosmetics

Fourteen insignia and decals. Awarding one shows a banner and adds a line to the Missions screen.
Nothing renders them — no unit, structure or HUD element reads a cosmetic id.

### Old Guard cannot be completed

*Old Guard* asks you to promote 15 units to **elite rank**, and its rule requires veterancy rank 3.
Veterancy in this game caps at **rank 2** — rookie, veteran, elite, at 3 and 6 kills. The mission's
counter can therefore never advance, and *Emergency Repair* — its reward — is permanently
unobtainable. It would have done nothing anyway (see above), so nothing playable is behind it, but
the mission will sit at 0/15 forever.

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
not commit its first attack until the five-minute mark — see [Strategy](Strategy).

---

**Factions:** [Allied Forces](Allied-Forces) · [Soviet Union](Soviet-Union) · [Meridian Pact](Meridian-Pact) · [The Reclamation](The-Reclamation)

**See also:** [Strategy](Strategy) · [Maps](Maps) · [Units and Verbs](Units-and-Verbs) ·
[How to Play](How-to-Play) · [Base Building](Base-Building)
