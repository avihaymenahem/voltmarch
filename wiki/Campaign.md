# Campaign

Two different things share this page's name, and only one of them existed until this week.

**The campaign** is a story mode: authored operations, each with a briefing, a fixed map, fixed
objectives and a medal. It is reached from **Campaign** on the title screen, above Skirmish. It is
real, it is playable, and it is **partial** — §1 says exactly how partial, in numbers.

**Progression** is the other one: a 46-row mission table that watches every skirmish you play and
pays out when you hit a number. It is what actually widens your roster, and none of it has changed —
§4 onward is that table, exactly as it was.

**The two do not touch, and that is deliberate rather than unfinished.** An operation advances
nothing on your profile — no mission, no unlock, no win, no streak, no lifetime counter. §3 is that
rule and the reason for it. If what you want is the Refractor Tank, what you want is the mission table,
and you get it by playing skirmishes.

There is also a separate **26-step tutorial** on the main menu — a director that watches a real
match and verifies the full command vocabulary, from control groups and formations through
capture, garrison, amphibious transport, commander powers, superweapons and veterancy. It is
neither of the above, grants nothing, and temporarily exposes the complete roster only inside its
training match.

---

## 1. The campaign

### What an operation is

An operation is **authored, not generated**, and that is the whole difference. A skirmish rolls a
map, a landform seed, a layout seed and an opponent; an operation declares every one of them, plus
what stands on the ground when you arrive, what both sides are allowed to build, and a table of
triggers that is evaluated inside the simulation on every tick.

So the ground is the same for everybody. Two players on the same operation get the same hills, the
same chokepoint, the same enemy in the same place — which is what makes a briefing able to say
"take the seam" and mean a specific piece of dirt.

What an operation declares for itself:

- the map preset, the landform seed, the layout seed, the biome and the number of seats;
- **the opening** — a pre-built base, a construction vehicle, or a **fixed force**, which is the
  campaign's own and skips the base-building step entirely: what the layout put on the ground is
  what you have;
- **the starting bank, for both sides.** Most operations run on considerably less than a skirmish
  opens with — one of them on nothing at all — and that number binds the enemy identically;
- **your army and the enemy's.** Both are named on the operation, not taken from the lobby;
- **what either side may build** — see §3, because this one is not what you would guess;
- the objectives, and the triggers that complete, fail and reveal them.

A trigger is a condition and a list of effects. Conditions only ever *read*: is that structure still
alive, are four of your units standing inside this circle, has six minutes passed, does that
building belong to you now, is the enemy beaten. Effects *write*: reveal ground, land
reinforcements, order them somewhere, pay a bonus, speak a line, end the operation.

One consequence of that worth knowing before it happens to you: **a hold clock restarts when you
stop holding.** "Hold this for six minutes" is a condition about the last unbroken stretch, not
about the total, so losing the position at minute five puts you back at zero rather than at five.

**Destroying everything the enemy owns does not end an operation.** The annihilation rules that end
a skirmish are switched off for every operation that ships, because a scripted match breaks them in
both directions — an eight-minute hold would be "won" at minute three, and a commando insertion
whose base does not exist would be a defeat ten seconds in. An operation ends when its own triggers
say so, and not before.

### How you reach one

**Campaign** on the title screen opens the chapter list. Each chapter is a card showing how many of
its operations you have finished; each operation is a row with its par time and your medal on it.

- **Brief** opens the briefing — the chapter, the operation's one-line beat, and the objectives it
  declares, primaries first. **Hidden bonuses are not on it, and nothing stands in for one**: a
  briefing that named one, or even admitted it was there, would be the operation spoiling its own
  turn before you had pressed anything.
- **Deploy** starts the match. The loading transition carries the chapter, operation, commander
  portrait and current directive into shader compilation instead of falling back to a generic map
  name.
- An operation whose prerequisites are unfinished is shown **locked, with the reason spelled out**
  — "complete *First Tap*" rather than a padlock. A row you cannot see is a row you cannot plan
  toward.
- Every chapter is open from first launch. The order they are listed in is a recommendation and not
  a gate; within a chapter, the operations are a chain.
- **Combat grade is explicit on every briefing.** Easy, Normal, Hard and Brutal set enemy pressure
  and medal grading together; the choice persists and also becomes the default in Skirmish. The
  after-action report names the grade actually played, rather than reading whichever setting was
  changed later. Game speed is forced to 1x for the duration.
- **Deployment is explicit before Deploy.** The briefing says whether the operation opens on an
  established base, a mobile construction vehicle or a fixed task force, and names the starting
  credit reserve. A no-production, zero-credit operation therefore cannot masquerade as a normal
  base match until the player lands.
- **The field catalogue is explicit too.** “Standard issue only” means the operation's day-one
  roster replaces profile unlocks; named authorizations identify the raider, tech, specialist
  defence, support or superweapon tiers added for that operation. It describes permission to build,
  not every pre-placed unit on the field.
- **The medal standard is stated before Deploy**, not discovered on the results screen: Bronze for
  completing the operation, Silver for meeting every bonus objective, and Gold for doing the
  Silver work on Hard or Brutal. Briefing and after-action copy share the same source.

### What ships today

| # | Operation | Chapter | Par (min) | Primary | Bonus |
| --- | --- | --- | --- | --- | --- |
| 01 | First Tap | Hold the Seam | 13 | 1 | 1 |
| 02 | Common Standard | Hold the Seam | 14 | 1 | 1 |
| 03 | Deep Sector | Hold the Seam | 15 | 1 | 1 |
| 04 | Company Town | Hold the Seam | 16 | 1 | 2 |
| 05 | Short Allocation | Hold the Seam | 17 | 1 | 2 |
| 06 | Demolition Order | Hold the Seam | 18 | 1 | 2 |
| 07 | Right of Entry | Hold the Seam | 19 | 1 | 2 |
| 08 | Carriage Forward | Hold the Seam | 20 | 1 | 2 |
| 09 | Nil Return | Hold the Seam | 22 | 1 | 2 |
| 01 | Sounding Line | The Timetable | 13 | 2 | 1 |
| 02 | Instrument Room | The Timetable | 14 | 2 | 1 |
| 03 | Ground Truth | The Timetable | 15 | 1 | 1 |
| 04 | Misclosure | The Timetable | 16 | 1 | 2 |
| 05 | Forced Closure | The Timetable | 17 | 1 | 2 |
| 06 | Machine Time | The Timetable | 18 | 2 | 2 |
| 07 | Fair Copy | The Timetable | 19 | 2 | 1 |
| 08 | Standing Order | The Timetable | 20 | 1 | 2 |
| 09 | Made Good | The Timetable | 22 | 2 | 1 |
| 01 | The Shallow Road | The Crust | 13 | 1 | 2 |
| 02 | The Long Count | The Crust | 14 | 2 | 2 |
| 03 | The Concession | The Crust | 15 | 2 | 2 |
| 04 | In the Clear | The Crust | 16 | 2 | 2 |
| 05 | The Open Count | The Crust | 17 | 2 | 2 |
| 06 | Common Ground | The Crust | 18 | 2 | 2 |
| 07 | The Thin Place | The Crust | 19 | 2 | 2 |
| 08 | Struck Off | The Crust | 20 | 2 | 2 |
| 09 | Vacant Possession | The Crust | 22 | 2 | 2 |
| 01 | Held Paper | Salvage Rights | 13 | 1 | 2 |
| 02 | Written Off | Salvage Rights | 14 | 1 | 2 |
| 03 | Sold Twice | Salvage Rights | 15 | 1 | 2 |
| 04 | Served Notice | Salvage Rights | 16 | 2 | 1 |
| 05 | Closing Entry | Salvage Rights | 17 | 2 | 1 |
| 06 | In Duplicate | Salvage Rights | 18 | 3 | 1 |
| 07 | Payment in Kind | Salvage Rights | 19 | 2 | 2 |
| 08 | Contra Entry | Salvage Rights | 20 | 1 | 2 |
| 09 | Book Value | Salvage Rights | 21 | 2 | 2 |
| 10 | Without Recourse | Salvage Rights | 22 | 2 | 1 |

**That is 37 of a planned 37 operations, and the table is complete.** The thirty-seven add up to
637 minutes of authored par against a plan written to reach 10 hours. All four chapters now have a
card on the campaign screen and all four play end to end — Hold the Seam, The Timetable and
The Crust at nine operations each, Salvage Rights at ten. Soviets first is the order the screen
recommends. Each chapter card carries its opening commander's authored portrait behind the faction
treatment, so the four campaigns read as four commands before the player opens an operation. The
selected chapter dossier also names and shows the commander attached to the next briefing; a
completed chapter retains its finale command instead of collapsing to an empty identity panel.
Operation beats and prerequisite reasons wrap in that dossier rather than being clipped behind an
ellipsis, including at the desktop minimum.

**Every par in that table is an author's estimate, not a measured time.** One operation has ever
been played end to end by a person, and the harness figure for it sat four minutes under the play
time. So read the column as what the operation was designed around rather than as how long it will
take you — the table is now complete in the sense that every operation exists, is verified
against the engine and plays; it is not complete in the sense that anybody has timed it.

---

## 2. Objectives, medals and difficulty

Every operation has at least one **primary** objective — what the operation is *for* — and may have
**bonus** objectives, which are optional in the sense that skipping one costs you a medal tier and
nothing else.

- **A bonus may pay credits into that match**, immediately, straight into your bank. The ones that
  pay are worth 400 to 1200 credits and they are granted rather than deposited, so a full silo
  cannot eat one. Each is paid **once**: reloading a save taken before you finished a bonus does
  not pay it a second time. A visible payout is named on the briefing, live objective tower,
  completion banner, pause dossier and after-action report; a hidden bonus carries the same value
  only after its existing reveal trigger makes the objective itself visible.
- **Nineteen shipped bonuses pay no credits at all.** What they pay is inside the operation itself, which
  is the better kind of reward.
- **A primary never pays credits.** That is refused at build time rather than left to taste — being
  paid for playing the operation is not a bonus.
- Some bonuses are **hidden** until something in the match reveals them. A hidden one is kept off
  the briefing entirely, off the in-match panel until it is revealed, and off the results screen
  entirely if it never was — three screens telling one story, with no placeholder row anywhere
  hinting that something is there. **It still counts against your medal**, though: silver wants
  every bonus the operation declares, so one you never discovered costs you exactly what one you
  failed would have.

> ### Where the objectives actually appear
>
> The corner panel that lists *match objectives* in a skirmish lists **the operation's** objectives
> instead, for as long as one is armed, and hands itself back the moment it ends. Hidden bonuses
> are filtered out of it until something reveals them. The match-objective board is not merely
> covered up — it is switched off for the duration, because progression is (§3).
> The tower is headed by the **operation name**, carries that faction's command colour, and wraps
> authored objective titles rather than truncating them inside the panel. Its description line
> keeps **Primary objective** and **Bonus objective** explicit, and appends the payout where one
> exists, so optional work cannot masquerade as the condition that ends the operation.
>
> The same list is on the **briefing** before you deploy and on the **results screen** after, where
> each row names both its **Primary/Bonus** class and its **Complete/Failed/Not met** verdict rather
> than relying on a tick or cross alone. Neither is the *full* list where a hidden bonus is concerned: the
> briefing never shows one, and the results screen shows it only if the match revealed it.
> Reopening a completed operation also places its best medal on the briefing; a first attempt keeps
> that space empty rather than presenting a meaningless zero-record badge.
>
> **Pausing an operation opens its dossier**, not the generic skirmish card: chapter and operation,
> commander and current directive, combat grade, battlefield and the full currently revealed
> objective ledger remain readable over the frozen battle.
>
> In-mission dialogue arrives through the **campaign communications panel** above the selection
> dock, with the speaker's portrait, role and faction channel. Several lines fired on one tick are
> queued rather than overwritten; long lines page at sentence boundaries instead of clipping.
> One authored transmission may occupy at most three live-card pages, and each page remains for a
> length-derived reading hold of up to 15 seconds rather than advancing on a fixed timer. **LOG**
> keeps the original unbroken transmissions for the rest of the operation. A restrained radio cue
> sounds once when each new transmission reaches the panel; continuation pages do not repeat it,
> and the cue obeys the normal UI audio and mute settings.

Campaign save rows carry the chapter and operation identity as well as the battlefield. Two
operations that share terrain therefore remain distinguishable in both Load Game and the manual
save panel; an autosave plate without a screenshot names the operation rather than pretending it
was an ordinary skirmish.

Campaign recordings retain the same identity in the replay library, in the playback badge and in
the downloaded filename. The map remains visible as provenance, but it is no longer presented as
if it were the operation's name.

Medals are graded from the outcome, never stored as something payable:

| Medal | What it takes |
| --- | --- |
| Bronze | Win the operation |
| Silver | Win it with every bonus objective met |
| Gold | Silver, on **Hard** or **Brutal** |

**The best medal you have ever earned is kept, and it is never lowered.** Replaying a gold
operation on Easy scores silver and takes nothing away. A reward you can lose by playing more is a
reward nobody trusts, and the damage would be unrecoverable except by replaying on Hard.

Losing records nothing at all — no medal, no partial credit, and no mark against you.

---

## 3. What an operation touches, and what it does not

### Your profile is deaf for the duration

**No mission advances, no unlock is granted, and no lifetime counter moves while an operation is
running.** Not the match count, not wins, not the streak, not kills, not structures built, not ore
mined. However long you play it, the campaign leaves your skirmish roster exactly where it was, and
the results screen shows no Rewards Earned panel because there is nothing honest to put in one.

That is deliberate. A scripted operation's kill count and ore total are **authored** — they are
whatever the mission designer put on the map — so paying the profile chains at those rates would
be a farm rather than progress. The rule is enforced inside the tracker itself rather than at the
places that call it, because a guard at one call site cannot see a second one.

The two things an operation *does* record: **your medal**, and the fact that the next operation in
the chapter is now open.

### Your unlocks do not apply either — in both directions

An operation names what each side may build, and those lists **replace** your profile entirely for
the duration. They are allow-lists over gated content, so an operation that names nothing holds
*both* sides to the day-one catalogue: no tech building, no tier-3 specialist, no specialist
defence, no raider, whatever your profile says.

The point of that is that **the ground is identical on a finished account and a fresh one**. It
also means an operation can hand the enemy something you cannot build — "they have Tesla Coils and
you do not, go around them" is a mission, and it is stated on the operation rather than faked with
a difficulty number.

Your skirmish lobby is left alone too: the operation's map, seed, faction and starting bank are not
written back over the settings you chose for skirmishes.

### Saving, replaying and retrying

- **Saving mid-operation works**, from Save Game in the pause menu, into the same slots a skirmish
  uses. The save carries the operation with it and re-arms it on load, so the objectives, the
  triggers you have already fired and the bonuses you have already been paid all come back as they
  were. A save of an operation this build no longer contains is refused **by name** rather than
  loading as some other match.
- **Replays work.** Every match records itself, campaign included. The recording carries the
  operation's name and re-runs its script on playback rather than storing what the script did — the
  same trade the format already makes for the terrain. A build that does not have that operation
  refuses the file by name instead of playing a plausible skirmish on its ground.
- **Watching a replay of an operation records nothing**, for the same reason playing one records
  almost nothing: watching is not playing.
- The results screen offers **Retry** and, on a win, **Next Operation**. At the final operation it
  instead marks the chapter **Campaign Complete**, delivers a faction-specific authored epilogue,
  and returns to the campaign selector. Retry re-arms the operation properly; it is not the
  skirmish Rematch button wearing a different word. The forward action names the next operation in
  its hint, so leaving an after-action report is a deliberate continuation rather than a blind jump.

---

## 4. Two scopes

| | Profile missions | Match objectives |
| --- | --- | --- |
| Count | 33 | 13 |
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

## 5. The profile chains

### Combat

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| First Blood | destroy 25 units or structures | — | **Raider unit** |
| Field Command | destroy 150 | First Blood | **Specialist defence** |
| War Machine | destroy 500 | Field Command | **Tier-3 specialist unit** |
| Total War | destroy 1,500 | War Machine | Strategic superweapon *(see §9)* + Warlord insignia |
| Can Opener | destroy 60 vehicles | — | **Anti-air emplacement** |
| Demolition Crew | destroy 25 structures | — | **Support pad** |
| Scorched Earth | destroy 100 structures | Demolition Crew | Warhead decal |
| Blooded | promote 20 units to veteran | — | Veteran insignia |
| Old Guard | promote 15 units to elite | Blooded | **Commander hero** |

### Economy

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Prospector | mine 25,000 credits of ore | — | **Map: Frozen Sector** |
| Strip Mine | mine 70,000 | Prospector | **Tech centre** |
| War Chest | hold 20,000 credits at once | — | Magnate insignia |
| Grid Surplus | run a 300-point power surplus | — | Grid decal |

### Construction

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Groundworks | complete 50 structures | — | **Map: Industrial Grid** |
| Continental Engineering | complete 300 structures | Groundworks | Siege superweapon *(see §9)* |
| Production Line | train or build 100 units | — | Chevron decal |
| Total Mobilisation | train or build 750 units | Production Line | **Map: Coral Shore** |
| Motor Pool | build 200 vehicles | — | Laurel decal |
| Air Wing | build 400 vehicles | Motor Pool | **Aircraft — all four armies** |

### Tactics

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Opening Move | win a skirmish | — | Bronze insignia |
| Theatre Command | win 10 | Opening Move | Admiralty insignia |
| Fleet Admiral | win 40 | Theatre Command | Fleet decal |
| Blitz | win inside 15 minutes | — | **Map: Contested Strait** |
| Untouched | win without losing a structure | — | Unbroken insignia |
| On A Roll | win 3 in a row | Opening Move | Gold insignia |
| Undefeated | win 10 in a row | On A Roll | Centurion decal |

### Mastery

| Mission | Target | Requires | Reward |
| --- | --- | --- | --- |
| Allied Command | win 5 as the Allied Forces | — | Allied insignia |
| Displacement Ring Programme | win 20 as the Allied Forces | Allied Command | Displacement Ring superweapon *(see §9)* |
| Soviet Command | win 5 as the Soviet Union | — | Soviet insignia |
| Ironclad Field Programme | win 20 as the Soviet Union | Soviet Command | Ironclad Field superweapon *(see §9)* |
| Pact Command | win 5 as the Meridian Pact | — | Meridian insignia |
| Solar Lance Programme | win 20 as the Meridian Pact | Pact Command | Solar Lance superweapon *(see §9)* |
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

## 6. The match objectives

Five of these thirteen are on the board each match, drawn from the match seed.

| Objective | Target | Deferred value (not paid) |
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
> **All thirteen retain authored credit values, and nothing in the game pays them out.** Those values
> are now hidden from the live board, completion banner, pause ledger, Missions screen and end screen.
> Progress is still recorded, but the UI makes no currency promise while no code path adds the number
> to a player's bank. There is no credit reason for an objective payout and no deterministic consumer
> for a credits-shaped reward.
>
> Treat the objective board as a scoreboard and a set of suggestions, not as income. Do not plan a
> build around the 1,500 from *Lightning Campaign*; it will not arrive.
>
> The objectives are still worth reading, because they feed the profile chains that *do* pay.

---

## 7. What an unlock actually does

The rule is short: **a unit or structure with no unlock tag is available in your very first match.**
Unlocks are an allow-list of exceptions, not a permission system.

What every faction keeps on a fresh profile: a construction vehicle and the yard it deploys into,
power, refinery, barracks, vehicle factory, radar, silo, wall and gate, one cheap defence, a repair
depot, line infantry, an anti-armour infantryman, an engineer, a harvester, a main battle tank, and
the faction commander. That is a complete economy, a complete base and a complete army.

What is behind the gate, and therefore what an unlock *widens*:

| Unlock | What it opens |
| --- | --- |
| Raider unit | Sabre IFV · Attack Dog · Sandskiff · Arcspitter |
| Tier-3 specialist | Refractor Tank · Sledge Tank · Zenith Emitter · Slaghurler |
| Aircraft | Petrel Bomber · Interceptor · Kestrel Gunship · Swarmhornet — all four behind **Air Wing**, on the vehicle chain |
| Tech centre | Proving Ground · Reliquary · Crucible |
| Specialist defence | Refractor Tower · Tesla Coil · Helios Spire · Arc Pylon |
| Anti-air emplacement | AA Battery *(Allied only — no other faction has a dedicated AA structure)* |
| Support pad | Repair Depot · Solar Infirmary · Patch Yard |
| Commander hero | Field Marshal · War Commissar · Hierarch · Scrap Baron |

> ### The navy left this table
>
> Three groups used to sit in it — *Naval production* (all four docks, paid by
> **Theatre Command**), *Escort hulls* (**Untouched**) and *Capital ships*
> (**Fleet Admiral**) — and all three are gone. The three missions still exist
> and still pay; they pay cosmetics now, so nobody who had already earned one
> lost anything.
>
> **They made the maps sold as naval unplayable as such.** *Contested Strait* is
> unlocked by one win under fifteen minutes while the docks needed ten wins on
> an independent chain, so the lobby handed you a battlefield whose own blurb
> reads "Naval yards earn their cost here" and no way to build a naval yard.
> And because the AI resolves against **your** profile, both sides were equally
> stranded and the water was scenery. On [Sunder Atoll](/avihaymenahem/voltmarch/wiki/Sunder-Atoll),
> where the sea is the only road, four armies sat on four islands and the match
> could not end.
>
> The rule that replaced them is narrower than "ungate the navy": **content
> required to reach the enemy is never progression-gated.** What is left is the
> in-match tech gate, which was always the right one — a capital ship still
> needs the Proving Ground, Reliquary or Crucible, and every hull still needs a dock
> on a real coast.

Two things follow from this that are easy to miss:

**The tech centre is the biggest single unlock in the game.** Strip Mine — 70,000 credits of
lifetime *mined* ore, roughly one map's worth — opens the Proving Ground and its equivalents, and the tech
building is the prereq for the tier-3 specialists, the Refractor Tower, the capital ships and **every
superweapon in the game**. Until you have it, four of your five sidebar tabs stop one tier short and
you have no end-game at all. If you only chase one mission, chase this one.

That target was 250,000 until v2.4.0, which was three whole maps of ore and put a mid-game building
further out than any superweapon chain — so a new profile could not reach the late game from either
side, because the AI mirrors your unlocks. It is one map now. Progress already earned still counts:
the tracker keeps a raw total per mission and re-compares it, so nothing was reset.

**Every ore mission counts ore MINED, not credits banked.** Those are the same number only while you
have room for the load. Ore that lands in a full silo used to advance these missions by nothing while
the end screen credited it in full — one label over two numbers — so the target was priced in ore out
of the ground and scored in credits that fitted. It is mined ore on both sides now. Silos are still
worth building, because ore you cannot keep is still ore you cannot spend; they simply no longer
decide how fast the mission table moves. The end screen reports both halves: **Ore Harvested** and the
part of it that never fitted, **Ore Wasted**.

**Chains cost the sum of their rungs, not their last number.** A locked mission does not accumulate,
so Strip Mine only starts counting once Prospector's 25,000 is done — and Fleet Admiral's "win 40"
means 1 + 10 + 40 wins, not 40. Worth knowing before you plan a route.

**The AI mirrors your unlocks.** By default the opponent resolves against the *same profile you do*,
so unlocking the Sledge Tank also arms the enemy Soviets with it. This is deliberate: an AI
fielding a unit you have never seen reads as cheating. Multiplayer suppresses gating entirely — both
players get everything.

---

## 8. Maps

Four of the seven battlefields are earned. See [Maps](/avihaymenahem/voltmarch/wiki/Maps) for what each one plays like.

**Three ship open**: Temperate Valley, Airbase Flats and
[Sunder Atoll](/avihaymenahem/voltmarch/wiki/Sunder-Atoll). The atoll is open
deliberately — it is the map the navy exists for, and a battlefield that teaches
the sea has to be there before the missions that reward it.

| Map | Earned by |
| --- | --- |
| Frozen Sector | Prospector — mine 25,000 ore |
| Industrial Grid | Groundworks — complete 50 structures |
| Contested Strait | Blitz — win inside 15 minutes |
| Coral Shore | Total Mobilisation — build 750 units |

Locked maps are shown in the skirmish lobby, greyed out, with the reason on them. Map unlocking is
fully wired and works.

---

## 9. What the rewards actually do — the honest table

Most of the reward table is connected to something real. Three classes have a gap between what the
reward says and what happens, and one mission cannot be finished at all. Here is the state of each,
honestly.

| Reward class | Count | Works? |
| --- | --- | --- |
| Unit unlocks | 4 | **Yes.** The sidebar opens up. |
| Structure unlocks | 4 | **Yes.** |
| Map unlocks | 4 | **Yes.** The lobby unlocks the map. |
| Commander powers | 0 | **Not a mission reward any more** — they are bought in the match. See below. |
| Superweapon unlocks | 5 | **Gate nothing.** The superweapons themselves are real; these five ids are not what opens them. |
| Objective credits | 13 | **No.** Nothing pays them (§6). |
| Cosmetics | 17 | **Display only.** |

Those first two counts read 5 and 3 for a long time and were already too low
before the navy left — the commander hero and the support pad had landed and
nobody added them. They are the four unit groups (raider, tier-3 specialist,
aircraft, commander hero) and the four structure groups (tech centre, specialist
defence, anti-air emplacement, support pad). The naval groups that used to swell
them are gone; three cosmetics arrived to replace what those missions paid.

**Map unlocks read 7 for a while, and that was three cut battlefields still
being counted.** *Saltpan Reach*, *Foundry Line* and *Glacier Shelf* each reused
another map's preset verbatim and were removed from the roster; four earned maps
remain, which is the same four §8 lists. Every count in the table above is now
re-derived from the mission table by `apps/game/tests/wiki-numbers.spec.ts`, so a reward
class that gains or loses a payer fails a test instead of quietly rotting here.

### Commander powers

*Airstrike, Orbital Scan, Emergency Repair, Ore Boost, Chronoshift.* **These stopped being a mission
reward in v2.6.0 and are now bought inside the match**, which is why the table above pays them
nothing.

Build the **Command Post** — your army's is called a Command Post, a Command Bunker, a Pharos or a
Signal Rig — and it publishes a fifth sidebar tab, **PWR**, listing the five powers as one-off
purchases. Buy one and it is yours for the rest of that match: it charges on its own clock and is
callable from the powers bar as often as the clock allows.

| | |
| --- | --- |
| Structure | 1,500 credits, 20 s, **−80 power**, 750–800 HP, off the radar tier |
| Powers | Orbital Scan 800 · Emergency Repair 1,200 · Airstrike 1,500 · Ore Boost 2,000 · Chronoshift 2,500 |
| Whole set | 9,000 credits — most of a starting bank |

| Power | Charge | Radius | Effect |
| --- | --- | --- | --- |
| **Orbital Scan** | 2:00 | 90 m | Permanently charts a wide circle of the map |
| **Airstrike** | 2:30 | 20 m | 260 High Explosive on the marker. Friendly-fires. |
| **Emergency Repair** | 2:30 | 24 m | Restores 45 % of max HP to up to 24 units **and structures** |
| **Ore Boost** | 3:00 | — | 2,500 credits, immediately |
| **Chronoshift** | 4:00 | 30 m | Lifts up to 8 units from within 40 m of your base centroid to the marker |

The charge is spent whether or not the power catches anything.

**The tab is only on screen while a completed, POWERED Command Post is standing.** Lose it to a raid
or brown out your grid and the tab closes — the powers you already bought stay bought, but you
cannot buy another until the lights are back on.

> **Two caveats this page used to carry are now discharged.** There IS a button: the powers bar sits
> on the right rail with an arm-then-click reticle. And charges ARE written into a save, along with
> the purchases themselves, so a reload gives back exactly the match you left.

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
| Ironclad Field | Soviets | Ironclad Field | 2,000 | 5:00 |
| Displacement Ring | Allies | Displacement Ring | 2,000 | 5:00 |
| Lightning Storm | Allies | Weather Control Device | 2,500 | 6:40 |
| Solar Lance | Meridian Pact | Heliograph | 2,500 | 7:00 |
| Arc Storm | The Reclamation | Stormworks | 2,500 | 6:40 |

**But the five superweapon rewards in the mission table are not what unlocks them.** Every
superweapon structure is gated on its army's **tech building** — Proving Ground, Reliquary or Crucible —
and on nothing else. The tech building *is* a mission unlock (*Strip Mine*, 70,000 mined ore), so a
fresh profile genuinely has no superweapons; but the moment you have the tech building you can build
all of your faction's, whether or not you have finished *Total War*, *Continental Engineering* or the
20-win mastery chains that claim to award them.

So those five rewards are correct about the direction of travel and wrong about the mechanism. Earn
*Strip Mine* and the end-game is open.

### Cosmetics

Seventeen collectible honours: ten command insignia and seven field decals. Awarding one shows the
end-of-match reveal and permanently adds it to **Service Record → Honours Collection**, where its
vector mark, awarding mission and live progress remain visible. The same record also shows lifetime
matches, wins, losses, current and best streaks, faction wins and campaign medals. Three of the
seventeen are the newer payouts for Theatre Command, Fleet Admiral and Untouched.

### Old Guard used to be impossible

*Old Guard* asks you to promote 15 units to **elite rank**. Its rule used to require veterancy rank
3, and veterancy in this game caps at **rank 2** — rookie, veteran, elite, at 3 and 6 kills. The
counter could therefore never advance, and *Emergency Repair*, its reward, was permanently
unobtainable. The rule now asks for rank 2, so the mission completes normally and the power is
reachable like any other.

---

## 10. A sensible order

If you want the roster open quickly, the cheap end of the table is:

1. **Opening Move** — win one skirmish. Free.
2. **First Blood** — 25 kills. You will pass this in your first match.
3. **Can Opener** — 60 vehicles. Two or three matches. Opens the AA Battery, which matters the
   moment aircraft are in play.
4. **Prospector** — 25,000 ore. One long match, or two short ones. Frozen Sector.
5. **Groundworks** — 50 structures. Build silos and walls; they count. Industrial Grid.
6. **Field Command** — 150 kills. Opens the specialist defences, which is the first unlock that
   changes how you defend.
7. **Untouched** — win without losing a structure. Easiest against Easy with a turtle opening.
8. **Strip Mine** — 70,000 ore. Two or three matches, and it counts what you MINE rather than what
   fitted in your silos. Everything tier-3 sits behind it.

*Blitz* (win inside 15 minutes) is much easier than it sounds against an Easy opponent, which does
not commit its first attack until the five-minute mark — see [Strategy](/avihaymenahem/voltmarch/wiki/Strategy).

---

**Factions:** [Allied Forces](/avihaymenahem/voltmarch/wiki/Faction-Allies) · [Soviet Union](/avihaymenahem/voltmarch/wiki/Faction-Soviets) · [Meridian Pact](/avihaymenahem/voltmarch/wiki/Faction-Meridian-Pact) · [The Reclamation](/avihaymenahem/voltmarch/wiki/Faction-Reclamation)

**See also:** [Strategy](/avihaymenahem/voltmarch/wiki/Strategy) · [Maps](/avihaymenahem/voltmarch/wiki/Maps) · [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) ·
[How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) · [Controls](/avihaymenahem/voltmarch/wiki/Controls) · [Base Building](/avihaymenahem/voltmarch/wiki/Base-Building)
