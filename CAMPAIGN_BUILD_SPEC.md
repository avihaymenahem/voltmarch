# VOLTMARCH CAMPAIGN MODE — BUILD SPEC

**Status:** merged from five reviewed workstreams (lore, missions, engine, progression, delivery). Every contradiction below is resolved, with the overruled position named. Code claims re-verified against the tree at `04ee0a5`, v2.15.1 — the verification log is §8.6.

**This document is not durable. Read §10.4 for where it lives and when it is deleted.**

---

## 1. WHAT WE ARE BUILDING

A four-faction story campaign of **37 operations** — 9 Allied, 9 Soviet, 9 Meridian Pact, 10 Reclamation — running **10.7 hours** at authored par on a first playthrough, on Normal, at par, excluding retries and briefing reading time.

Each operation is a real match on a real generated battlefield with a scripted objective layer: a data-declared trigger table evaluated by a pure director inside `simTick`. There are no cutscenes, no new art assets, no fifth non-generated asset, and no new resource, unit or building. The campaign is **a second consumer of the engine that already exists**, not a widening of the mission system.

### 1.1 The numbers, and where each comes from

```
37 operations           9 / 9 / 9 / 10          spine is the lore workstream's beat grid
642 min authored par    10.70 h                 ramped 13→24 min, finale 24
36,000 s test floor     10.00 h                 sum(parSec) >= 36000, gated at import
~23,000 words           37 × ~450 + 6,100       briefing + debrief + in-mission + lore
35 battlefields          7 shipped + 28 seeds   two operations share ground
7 map presets            unchanged               no new MAP_PRESET in v1
11 trigger conditions    frozen end of Phase 1
11 trigger effects       frozen end of Phase 1
```

**Engine cost: 45–65 person-days.** **Content cost: 180–320 person-hours**, of which **~35 hours is human play that cannot be delegated to an agent.** The content is 3–5× the engine. That ratio is the single most important fact in this document.

### 1.2 What was overruled on count

| Workstream | Said | Verdict |
|---|---|---|
| lore | 37 (9/9/9/10) | **ADOPTED.** Only fully-authored beat grid; its floor argument (9/faction) is the only one derived rather than asserted. |
| missions | 44 (11×4) | Overruled. 200–350 h of authoring bought as slack nobody costed. |
| engine | ~50 | Overruled, same reason, worse. |
| progression | 40–50 | Overruled on count; its **par-first inversion is adopted** (§5.4). |
| delivery | 32 | Overruled. Clears 10 h only if operations average ≥18.75 min, which is a bet on an unmeasured number. |

### 1.3 The shape of the risk, stated once

Nobody has ever timed a VOLTMARCH campaign operation, because none exists. So **the 10.7-hour figure is authored, not measured**, and the plan is built so that the claim is falsifiable before most of the content is written: par is authored per operation, a test enforces the sum, and the first four operations are timed before operation 5 is authored (§7, Gate M).

---

## 2. THE FICTION

Adopted from the lore workstream substantially unchanged. It is derived from mechanics the engine already pays for — the shared Allied/Soviet building pool, hover, scrap, arcs, ore regrowth, the power grid's independence from credits — and from nothing in Cold War history, so it survived the naming decision in §2.5 untouched.

### 2.1 The setting

**Ore grows.** It is a slow crystalline propagation carrying a measurable electrical charge, and its leading edge advances a few metres a season across a continent. That front is **the Voltmarch**; short form, **the March**.

This is the only free-standing invention and it does three jobs the code already does:

- It makes the product's title diegetic. Nothing in the game is currently named Voltmarch in-fiction.
- It explains `Economy.ts`'s **node cell** and its `ORE_REGROW_NODE_BONUS = 3.0` without inventing a mechanic: a node is where the March surfaced, and regrowth propagates downstream from it.
- It explains why **power costs credits to build and nothing to run**. A plant does not burn fuel; it taps the charge in the ground. Grid capacity is how many taps you have sunk.

What is fought over is not the ore, which is fungible into anything. It is **predictability** — where the March surfaces next, how fast a worked field returns, and whether working it changes the answer.

**The Continental Works** catalogued the March and wrote the engineering standard every serious operator still builds to. That standard *is* the shared Allied/Soviet pool — the same fifteen designs at the same prices, because they are the same designs. The shipped mission `Continental Engineering` now means something. **The Split** — for which Sunder Atoll is named — divided the Works into two administrations that disagreed about what the March is for. The Allies took the survey office and the instruments; their two superweapons move and deny. The Soviets took the yards and the plate mills; theirs annihilate and make invulnerable. **The Meridian Pact never signed**: they read the March correctly four hundred years earlier and concluded that cutting it is what makes it spread — hence power from the sun, nothing touching the ground, `crushLevel: 0` on every hull. **The Reclamation is what the Split left behind**, the Works' salvage arm, unassigned when the assets divided.

**Map names are Survey designations, not place names.** The Works catalogued the continent into sectors and everybody uses its labels. Seven flat functional names become deliberate worldbuilding at zero cost.

### 2.2 The hinge — no villain

> **Does working the March make it worse?**

Soviets measure the symptom first and are told it is an output problem. Allies build the model that would answer it, get the answer, and suppress it. The Pact knew for four hundred years and are the ones who started it. The Reclamation hold the only continent-wide dataset that is not a model and are not looking for it. Nobody is wrong and nobody is clean.

A fifth antagonist faction is refused on engineering grounds: `Faction.Neutral` is civilian and `MAX_PLAYERS` seats belong to the AI, so a fifth army is a systems change. A hinge is free.

### 2.3 The four commanders

Each is the player's commander-in-chief and briefs. The player is the field commander and is never named. The hero *unit* appears only where that person is physically present — pre-placed, queue suppressed by `aliveOf`, death is a fail condition.

**Field Marshal Ines Aubray (Allies).** Career Works surveyor, not a soldier; ran the modelling section for eleven years and signed the forecasts every refinery was sited from. Clipped, precise, unsentimental — measurements and confidence intervals, corrects herself in public immediately, highest praise is *"That matches."* **Arc: right about the mechanism, wrong about the sign.** Her model predicts regrowth correctly and predicts the effect of extraction not at all. By A7 she has the data. She is the only one who could publish it and does not, because publishing hands the Pact the argument and the Soviets the sectors. An honest person choosing, once, not to be. Present: A3, A8, A9.

**War Commissar Zoya Rakhalt (Soviets).** Third-generation plate-mill crew, a foreman before she was anything; got the post by keeping the northern yards running nine weeks with no orders. Plain, heavy, patient; quotes tonnage; "we" for the work and "I" for the decisions, never to take credit. **Arc: the first person to see the real problem, and she sees it as a production problem, which is why nobody listens.** From S7 she runs a campaign she has stopped believing in — not disillusionment but something harder: she keeps going, competently, because forty thousand people work her sectors. She ends where she started and knows it is worthless. Present: S1, S6, S9.

**Hierarch Calvane, born Oris Tey (Pact).** An Artificer for twenty-two years before elevation — two decades *undoing damage*, promoted to the office that decides where damage happens. Formal, warm, unhurried, completely unmoved; ecclesiastical cadence without piety, because there are no gods here and the liturgy is engineering discipline that calcified. **Arc: the campaign's most obviously correct character, made unbearable.** P4 reads the ice and finds the March has been accelerating for four hundred years — since the Pact's own first taps. Calvane fights to stop a thing the Pact started, against three armies who would stop if shown why, and cannot make the argument without conceding it. Present: P2, P7, P9.

**Scrap Baron Wren Tallow (Reclamation).** Nobody appointed her; she holds nine breaking yards and can keep holding them. The only commander who has personally been inside every faction's base, because she has been paid to clear all of them. Fast, funny, transactional, three degrees warmer than expected until you notice she has priced you. **Arc: comic relief to the person holding the only complete account.** R5 she discovers she has been sheltering Bramm for six weeks. R8 she realises the Reclamation is now the largest standing army on the continent and nobody has noticed, because it is made of things the others wrote off. R10 is the only operation set after the convergence. Present: R1, R5, R9, R10.

**Surveyor-General Ilse Bramm** is the hinge made a person: author of the only complete node map, and of an appendix nobody has read showing four hundred years of rate change. She refused all four. **Never a playable or hero unit** — where she is pre-placed she uses an existing civilian or infantry def with a mission tag. No new def, no new art. She is a different person in each campaign, and **absent from the Soviet one**, which reaches its truth by working rather than reading. That absence is its dignity.

One liaison per campaign so briefings carry two voices: **Petra Wend** (Allied analyst), **Grigor Vosk** (Soviet ordnance), **Artificer Nael** (Calvane's former apprentice, the only person who uses the born name, once), **Boz Cregg** (second yard, thinks Tallow is too sentimental, is wrong).

### 2.4 Register

The house voice already exists in `Descriptions.ts` and the shipped mission titles: short declaratives, a fact then its consequence, no adjective doing a number's job. *"The end of an argument." · "Ninety credits. Three seconds. Bring forty." · "Sees far. Dies fast."* Titles live in `First Blood / Can Opener / Scorched Earth / Prospector / Blitz` territory.

**One author, or the register breaks.** If it must be split, split by **campaign**, never by operation, so each writer holds one commander's voice end to end.

### 2.5 THE NAMING DECISION — DECIDED 2026-08-19: OPTION B, TIERS 1 AND 2, TWELVE ROWS

**The author's call: rename tier 1 and tier 2, keep tiers 3 and 4 exactly as they are.** Executed 2026-08-19, before a word of briefing prose was authored, which is the whole reason the question had a deadline. The survey that priced it is §2.5.1 and §2.5.2 below and is kept in place — it is the evidence for the decision, not a record of an open question.

The twelve, approved verbatim. **`key:` did not change on any row** — keys are in `store.defId` ordering, save blobs, replay streams and `UNLOCK_TAGS`, so changing one invalidates every save and replay on disk:

| `key:` | was | is |
|---|---|---|
| `grizzly` | Grizzly Tank | **Warden Tank** |
| `rhino` | Rhino Tank | **Anvil Tank** |
| `apocalypse` | Apocalypse Tank | **Sledge Tank** |
| `prismTank` | Prism Tank | **Refractor Tank** |
| `prismTower` | Prism Tower | **Refractor Tower** |
| `ifv` | Multigunner IFV | **Sabre IFV** |
| `aaTurret` | Multigunner AA | **AA Battery** |
| `battleLab` | Battle Lab | **Proving Ground** |
| `ironCurtain` | Iron Curtain Device | **Ironclad Field** |
| `chronosphere` | Chronosphere | **Displacement Ring** |
| `vindicator` | Vindicator | **Petrel Bomber** |
| `mig` | MiG Fighter | **Interceptor** |

Three display strings moved with them because they embed a renamed noun rather than a real-world term: `vindicatorMissile` "Vindicator AGM" → **Petrel AGM**, `migCannon` "MiG Autocannon" → **Interceptor Autocannon**, `ifvChaingun` "25 mm Multigunner" → **25 mm Sabre**.

**`WarheadClass.Prism` and the two beam rows that carry its name — `prismBeam` "Prism Emitter" and `prismTowerBeam` "Prism Cannon" — did NOT move**, and neither did `AbilityId.PrismFocus`'s "Prism Focus" label. A prism is an optical device nobody owns, which is tier 3 by this section's own test; the coined thing was the unit name. The warhead is also shared with the Meridian Pact's Zenith Emitter and the Reclamation's Helios Lance, so it is original-faction vocabulary as much as Allied vocabulary. A Refractor Tank firing a Prism Emitter is coherent; a Zenith Emitter firing a "Refractor" warhead would not be.

**Tiers 3 and 4 were not touched.** Tesla Coil, Conscript, G.I., Flak Trooper, Attack Dog, Dreadnought, Hydrofoil, Attack Submarine, Pillbox, Engineer, Barracks, Power Plant, War Factory, Construction Yard, Ore Refinery, Ore Harvester, Ore Silo, Radar Dome, Naval Yard, Naval Pen, Sentry Gun, Nuclear Missile Silo and Weather Control Device all stand.

What it actually cost, measured: `Defs.ts` (12 `name:` rows plus 3 weapon names and ~30 argued comment blocks), the `Production.ts` fallback catalog which carries the same 12 rows, `Descriptions.ts` (gated by `content-truthful.spec.ts`), 14 `wiki/` pages including the four `Faction-*.md` roster tables (gated by `wiki-numbers.spec.ts` and `manual.spec.ts`), ~40 argued comment blocks across `src/`, 30 spec files, `CLAUDE.md`, `RA3_LOOK_BIBLE.md`, `VISUAL_DNA.md` and `SPEC_DRIFT_AUDIT.md` — 103 files, 666 changed lines.

**Alias tables were deliberately left alone.** `UNIT_ALIASES` / `BUILDING_ALIASES` in `Scenarios.ts` and the keyword tables in `ui/icons.ts` match against `key:`, not `name:`, and are already written wide enough to hold other games' spellings. Every icon still resolves through its key, which is why the rename moved no glyph.

**The two manual pages that name Command & Conquer directly (`Base-Building.md:94`, `How-to-Play.md:6`) are UNTOUCHED and remain an open question.** Renaming twelve units does not decide what to do about a page that names the genre's ancestor in prose; that is a separate call for the author.

#### 2.5.1 The ~20 are not one thing, and the tiers have different urgency — surveyed 2026-08-19

The list above reads as one uniform block of twenty, which makes the decision look bigger and flatter than it is. Counted against the 122 `name:` rows actually in `Defs.ts`:

| Tier | What it is | Names | Who could object |
|---|---|---|---|
| 1 | **A live mark of a real company** | **MiG Fighter** | Mikoyan. Not Westwood's to have lent in the first place, so this one does not turn on any view about C&C. |
| 2 | Coined by Westwood/EA, distinctive, strongly associated | Grizzly Tank · Rhino Tank · Apocalypse Tank · Prism Tank · Prism Tower · Multigunner IFV · Multigunner AA · Battle Lab · Iron Curtain Device · Chronosphere · Vindicator | EA |
| 3 | Real-world terms Westwood *used* and nobody owns | Tesla Coil (Nikola Tesla's actual device) · Conscript · G.I. · Flak Trooper · Attack Dog · Dreadnought · Hydrofoil · Attack Submarine · Pillbox · Engineer · Barracks · Power Plant | nobody |
| 4 | Genre idiom, now used across the whole RTS field | War Factory · Construction Yard · Ore Refinery · Ore Harvester · Ore Silo · Radar Dome · Naval Yard · Sentry Gun · Nuclear Missile Silo | nobody |

**So option B is ~12 rows, not ~20**, and tier 1 is a single row that is arguably a separate decision with its own answer. Tiers 3 and 4 are the ones that make the list look long, and renaming them buys nothing — an RTS that refuses to say "Barracks" is not more original, it is harder to read.

#### 2.5.2 The cost estimate has a precedent nobody quoted, and it is in this repo

**Two of the four shipped factions are already named entirely from scratch: the Meridian Pact carries 31 original names and The Reclamation 30.** Arcspitter · Slaghurler · Sunlancer · Wayfarer · Solarch · Yardcrawler · Scrapjaw · Sandskiff · Heliograph · Helios Spire · Pharos · Crucible · Reliquary · Conclave · Chapterhouse · Hierarch · Rookery · Tidewalker · Kite Corvette · Argosy · Forgeyard · Stormworks — none of it borrowed, all of it in register, all of it already through `content-truthful.spec.ts` and the four `wiki/Faction-*.md` roster tables.

Every borrowed name is confined to the Allied and Soviet rosters — verified per row, `faction:` field by `faction:` field, not inferred. So option B is *"do again, for twelve rows, the thing this project has already done twice for sixty-one"*, which is a materially different proposition from the open-ended rename §2.5 currently implies. It does not decide the question; it prices it honestly.

> **UNDECIDED-1 IS CLOSED. The author chose B on 2026-08-19 and it shipped the same day — tiers 1 and 2, twelve rows, keys untouched.** The table is at the head of §2.5. Nothing below this line is an open question; it is why the answer was cheap.

---

## 3. THE OPERATIONS

Lore's beat grid is the spine. The missions workstream's `primaryType` field, its adjacency rule and its three re-authored premises are the mechanical layer laid over it. `primaryType` is a **field on the row, not prose** — an unresolvable value cannot be checked, and `validateCampaign` throws at import when two adjacent operations in one campaign share one.

Dated in **Survey Year 12**, the Works' calendar, which is why all four use it despite hating each other. ⚑ marks a revelation beat.

### 3.1 SOVIET UNION — *Hold the Seam* — 157 min

| # | Wk | Title / beat | `primaryType` | Preset | Seats | Par |
|---|---|---|---|---|---|---|
| S1 | 1 | The March surfaces in a new place. Sink the first tap. *(Rakhalt)* | `assault` | arid | 2 | 13 |
| S2 | 2 | The Split becomes shooting — an armour column, no base | `fixed-force` | temperate | 2 | 14 |
| S3 | 3 | Take the deep sector before it is surveyed | `race` | snow | 2 | 15 |
| S4 | 4 | Hold a worked town — civilian derricks, held | `capture-hold` | urban | 3 | 16 |
| S5 | 5 | The Allied schedule cuts your allocation | `defend` | temperate | 2 | 17 |
| S6 | 6 | ⚑ **The field stops regrowing** *(Rakhalt)* | `economy` | snow | 2 | 18 |
| S7 | 7 | Cross for a second seam | `landing` | coast | 2 | 19 |
| S8 | 8 | Defend the richest sector against two | `defend` | arid | 3 | 21 |
| S9 | 11 | ⚑ **SUNDER ATOLL — north island** *(Rakhalt)* | `assault` | atoll | 4 | 24 |

### 3.2 ALLIED FORCES — *The Timetable* — 157 min

| # | Wk | Title / beat | `primaryType` | Preset | Seats | Par |
|---|---|---|---|---|---|---|
| A1 | 2 | Escort the first survey party | `escort` | temperate | 2 | 13 |
| A2 | 3 | Recover a Works survey office | `infiltrate` | urban | 2 | 14 |
| A3 | 4 | Reach Bramm's field station *(Aubray)* | `race` | tropical | 2 | 15 |
| A4 | 5 | Your deep sector is Soviet now | `assault` | snow | 2 | 16 |
| A5 | 6 | Meter every coastal tap | `capture-hold` | coast | 2 | 17 |
| A6 | 7 | The schedule goes live — the Pact comes to shut it | `defend` | urban | 3 | 18 |
| A7 | 8 | ⚑ **The schedule is failing. Enforce it anyway.** | `superweapon` | arid | 2 | 19 |
| A8 | 10 | ⚑ **Take the archive. Do not publish it.** *(Aubray)* | `infiltrate` | tropical | 2 | 21 |
| A9 | 11 | ⚑ **SUNDER ATOLL — west island** *(Aubray)* | `assault` | atoll | 4 | 24 |

### 3.3 MERIDIAN PACT — *The Crust* — 157 min

| # | Wk | Title / beat | `primaryType` | Preset | Seats | Par |
|---|---|---|---|---|---|---|
| P1 | 3 | A tap has been sunk on Pact ground. **Your vehicles never touch the ground and your infantry do — that split is the doctrine.** | `assault` | tropical | 2 | 13 |
| P2 | 4 | Shut a tap without breaking the field *(Calvane)* | `assassination` | temperate | 2 | 14 |
| P3 | 5 | The Pact goes to sea, and does not need a boat — Solarchs ford it, Tidewalkers wade it | `landing` | coast | 2 | 15 |
| P4 | 6 | ⚑ **Read the ice: four hundred years of acceleration** | `race` | snow | 2 | 16 |
| P5 | 7 | The town that will not stop | `capture-hold` | urban | 3 | 17 |
| P6 | 8 | Burn the richest tap on the continent | `assault` | arid | 2 | 18 |
| P7 | 9 | ⚑ **Bramm confirms it** *(Calvane)* | `escort` | tropical | 2 | 19 |
| P8 | 10 | ⚑ The other three come for you | `defend` | arid | 3 | 21 |
| P9 | 11 | ⚑ **SUNDER ATOLL — east island** *(Calvane)* | `assault` | atoll | 4 | 24 |

P1's premise was checked against the sim rather than assumed: Pact **infantry are `Locomotor.Foot`** (Wayfarer, Sunlancer, Artificer, Hierarch, Tidewalker) and only vehicles hover. P3's premise survives because **`mrdTidewalker` is `Foot` + `amphibious: true` with no `unlockedBy`** — a day-one Pact infantryman that crosses water on its feet. P8 was moved off Contested Strait: it is `players: 2` and the beat is "the other three come for you."

### 3.4 THE RECLAMATION — *Salvage Rights* — 171 min

| # | Wk | Title / beat | `primaryType` | Preset | Seats | Par |
|---|---|---|---|---|---|---|
| R1 | 1 | The yards are already yours. Nobody has noticed. *(Tallow)* | `assault` | urban | 2 | 13 |
| R2 | 3 | Pull the field the Soviets left in week 2 | `economy` | temperate | 2 | 14 |
| R3 | 5 | Sell to both sides in the same week | `capture-hold` | arid | 3 | 15 |
| R4 | 6 | The Allies want your yard | `defend` | snow | 2 | 16 |
| R5 | 7 | ⚑ **You have been sheltering Ilse Bramm** | `infiltrate` | tropical | 2 | 17 |
| R6 | 8 | The sea yards | `landing` | coast | 2 | 18 |
| R7 | 9 | Everyone comes for the yards at once | `defend` | urban | 3 | 19 |
| R8 | 10 | ⚑ **You are the largest army on the continent** | `superweapon` | temperate | 3 | 21 |
| R9 | 11 | ⚑ **SUNDER ATOLL — south island** *(Tallow)* | `assault` | atoll | 4 | 24 |
| R10 | 12 | **After.** The only operation past the convergence. *(Tallow)* | `fixed-force` | arid | 1 | 14 |

### 3.5 Arithmetic

```
Soviets      157 min   2.62 h      Allies       157 min   2.62 h
Pact         157 min   2.62 h      Reclamation  171 min   2.85 h
                                   TOTAL        642 min  10.70 h

test floor   sum(parSec) >= 36000 s = 600 min       headroom 42 min ≈ 2 operations
```

**Type spread over 37:** assault 9 (24%) · defend 6 · capture-hold 4 · race 3 · landing 3 · infiltrate 3 · economy 2 · escort 2 · superweapon 2 · fixed-force 2 · assassination 1. Four of the nine assaults are the mandatory finales.

**Excluded from the 10.7 h, deliberately:** briefing reading time (real but unmeasured, and the story is carried by it) and **retries — an operation replayed three times is not three operations of content.** Padding a schedule with the player's failures is how a claim quietly stops being true.

### 3.6 Cross-campaign spoilage and play order

Pact P4/P7 spoil the Allied campaign retroactively; Pact P4 spoils Soviet S6 (tragedy if unseen first, inevitability if seen — tragedy is better); Reclamation R5/R10 spoil everything. **Nothing spoils the Soviet campaign**, because it reaches its truth by working. That is why the recommended order is **Soviets → Allies → Pact → Reclamation** — which is already exactly the learning order `wiki/Factions.md` recommends, so the difficulty curve and the revelation curve are the same curve.

> **THE ORDER IS A LINE OF COPY, NOT A GATE.** `docs/MISSIONS_DESIGN.md` says all four factions are available from the start and that the call "is not up for re-litigation." **All four campaigns open from first launch.**

### 3.7 Archetype triage — the number that makes this affordable

Every operation declares one archetype. It determines whether the expensive half is needed at all.

| Archetype | Sim writes | Mechanism | Count |
|---|---|---|---|
| **A — Posed skirmish** | none | Fixed seeds, scripted starting force via `ScenarioBuilder`, win by annihilation. **Zero triggers.** | 12 |
| **B — Conditional objective** | none | Triggers *read only*. Effects are objective state and `endOperation`. | 14 |
| **C — Timed reinforcement** | one effect kind | `spawnUnits` + `orderTagged` at a declared tick or condition. | 8 |
| **D — Bespoke** | multiple | Escort, convoy, multi-phase defence. | 3 |

**26 of 37 need no sim writes at all.** That is also a constraint on the writers: an archetype-A operation's drama comes from the starting force and the ground, not from a script.

---

## 4. THE ENGINE

### 4.1 Naming — settled, and it is not cosmetic

`src/data/Missions.ts` holds 46 mission rows; `src/shell/Missions.ts` owns a five-category frozen contract; `tests/reward-wiring.spec.ts` iterates `ALL_REWARDS` keyed by mission. **The campaign unit is an `Operation`. A campaign is a `Chapter` of operations.** Nothing in the campaign is called a mission, in data, files, tests or prose. This also settles half of a separate question: an operation is not a mission, therefore not a sixth `MissionCategory`.

### 4.2 File layout

```
src/campaign/
  types.ts             OperationDef, Condition, Effect, WorldQuery, EffectSink, minutes()
                       TYPES AND POD CONSTANTS ONLY — safe in the entry graph. FROZEN end of Phase 1.
  policy.ts            campaignOutcomePolicy() / setCampaignOutcomePolicy(). Imports nothing.
  Director.ts          pure: (state, WorldQuery, tick, rng) -> Effect[]
  validate.ts          module-load self-check, in validateMissions' shape
  campaign-install.ts  THE DYNAMIC BOUNDARY. The only importer of Director/index/layouts.
  campaign-store.ts    operation completion + medals on the profile (v3, migrating)
  layouts/<id>.ts      build(b: ScenarioBuilder, cx, cz, start): void  — one per operation
  operations/<faction>/NN-<slug>.ts    export default op({...})
  index.ts             CAMPAIGNS: readonly ChapterDef[]  (import.meta.glob)

src/game/campaign.system.ts    Phase.Cleanup order 9000 (sim half) + RenderPhase order 901 (shell half)
src/shell/Campaign.ts          chapter + operation select   ShellState 'campaign'
src/shell/Briefing.ts          briefing / debrief            ShellState 'briefing'
```

### 4.3 The script format, and its defence

**A declarative trigger table, one TypeScript module per operation, each default-exporting a validated `OperationDef`, evaluated by a pure director.**

```ts
export default op({
  id: 'soviets.04.worked-town',
  chapter: Faction.Soviets, index: 4, primaryType: 'capture-hold',
  parSec: 960,
  map: { preset: 'urban', seed: 'urban.c2', armies: 3, biome: 'urban', start: 'base' },
  layout: 'soviets-worked-town',
  outcome: { annihilationWin: false, assetLossDefeat: true, ignoreSeats: [] },
  roster: { player: [], ai: ['struct.defence.aa'] },
  objectives: [
    { id: 'hold',  kind: 'primary',   title: 'Hold three derricks for 6 minutes' },
    { id: 'plant', kind: 'secondary', title: 'Keep the town power plant standing', credits: 500 },
  ],
  triggers: [
    { id: 't.hold', when: { on: 'all', of: [
        { on: 'ownerCount', player: 0, role: 'civilian', tag: 'derrick', min: 3 },
        { on: 'elapsedSinceArmed', ticks: minutes(6) } ] },
      then: [{ do: 'completeObjective', id: 'hold' }, { do: 'endOperation', result: 'win' }] },
    { id: 't.plantDies', when: { on: 'entityDead', tag: 'townPlant' },
      then: [{ do: 'failObjective', id: 'plant' }] },
  ],
});
```

**Against free-form callbacks.** A callback can call `Math.random()`, `Date.now()`, read `localStorage` or allocate in the loop. There is a test asserting the first two are banned inside `simTick` — and it would need extending once per authored callback, 37 times, to stay meaningful. A data row is validated **once, at module load**, for every row that will ever exist. This is the argument `Defs.ts` and `Missions.ts` already make, and it is stronger here because content authoring is the workstream most likely to be split across agents who have not read CLAUDE.md.

**Against extending `MissionRule`.** `RULE_KINDS` is 13 counters/max/flags over `GameEvents`, evaluated **outside** `simTick`, over the *event stream*. A campaign needs **state predicates over the world**, evaluated **inside** `simTick`. Two languages on opposite sides of the determinism boundary. `src/shell/tutorial-steps.ts` already refused this exact merge for weaker reasons and paid for a separate director across three files rather than widen `MissionRule`. **The campaign is the third system to want scripted triggers and it takes the same shape.**

### 4.4 The vocabulary — 11 conditions, 11 effects, frozen

**Conditions (read-only):** `elapsed` · `elapsedSinceArmed` · `entityAlive` · `entityDead` · `entityHpBelow` · `unitsInArea` · `ownerCount` · `structureCaptured` · `credits` · `playerBeaten` · `objectiveComplete` / `objectiveFailed`, plus the combinators `all` / `any` / `not`.

The lore workstream's six missing verbs are all expressible here, and this is the merge that matters: `reach` = `unitsInArea` · `protect` = `entityDead` → fail · `holdFor` = `unitsInArea` + `elapsedSinceArmed` · `surviveUntil` = `elapsed` · `destroyTagged` = `entityDead` · `preserveTagged` = `entityHpBelow`. **No new verb is needed beyond this list**, and no briefing may be authored against one that is not on it.

**Effects (writes):** `setObjective` · `completeObjective` · `failObjective` · `spawnUnits` · `orderTagged` · `grantCredits` · `endOperation` · `revealArea` · `dialogue` · `eva` · `cameraMove`.

Cut deliberately, with reasons, so nobody re-derives them:
- **`spawnBuildings` — DEFERRED.** There is no runtime equivalent of `ScenarioBuilder.spawnBuilding`; structures come through `Production`'s placement path. Author them into the layout and reveal or repair instead. *UNDECIDED-6.*
- **`setRoster` mid-operation — CUT.** The roster is per-operation and set at launch. Changing it mid-match forces a `census`/`Production` re-derivation for a premise nothing in §3 needs.
- **`setAllyMask` — CUT.** Overlaps task #52 and is checksum-visible; do it there or not at all.
- **`setInvulnerable` — CUT unless an escort needs it.** *UNDECIDED-7, decided before `types.ts` freezes.*

> **`types.ts` FREEZES at the end of Phase 1. Adding a twelfth effect after that is a schema change with a migration, not a convenience.** Four content agents authoring against a moving vocabulary is the expensive failure mode.

### 4.5 The two halves, and where they run

`outcome.system.ts` is the in-tree precedent: a `RenderPhase` system that reaches the shell through a duck-typed `globalThis.__vmShell`, whose own header says *"it writes nothing the sim reads, so `npm run soak`'s AI-vs-AI replays are byte-identical with it loaded."* `campaign.system.ts` is that shape.

| Half | Where | Does |
|---|---|---|
| **sim** | `Phase.Cleanup` **order 9000** | Evaluates conditions, applies effects, writes `OperationState` and `outcome: 'won'\|'lost'\|null`. Runs **after** `combat.cleanup` (Phase.Cleanup order 0) flushes destroyed entities, so a dead entity is genuinely gone and cannot be counted twice. Tagged-entity deaths are observed via the `entity:killed` event, which fires *before* the flush. Below `scenarios.system.ts` (10,000) and `save.system.ts` (30,000). |
| **shell** | `RenderPhase` **order 901**, immediately after `outcome.system` | Reads that state, calls `shellHost().endMatch({won})`, publishes objective rows, drives dialogue and camera. Writes nothing the sim reads. |

`campaign.system.ts` imports **`types.ts` and `policy.ts` only** and is inert without an armed operation — one null check, exactly as `tutorial.system.ts` costs one.

**Determinism, mechanically enforced (Guard G3):**
- `Math.random`, `Date.now`, `performance.now`, `localStorage`, `document.`, `window.` banned across `src/campaign/**` and `src/game/campaign.system.ts`, using `reward-wiring.spec.ts`'s comment-stripping technique so prose describing a call is not a call.
- **Every timer is a tick count.** `minutes(n) => n * 60 * 30` lives in `types.ts`; nobody hand-multiplies.
- Any randomness draws from `s.rng`.
- **The Director may never call `isBuildable`, read the profile, the DOM, or the camera.** This is the tick-zero desync CLAUDE.md documents twice.

**Orders go through `channels.command` via `CommandBus.harvest`** — the non-recording route, because the Director re-runs under playback and a recorded-*and*-re-derived order applies twice (trap 2 in `Replay.ts`). **Spawns do NOT go through the bus.** They call `ProductionService.spawnUnit` directly, inside `simTick`, deterministically.

> **NO NEW `CommandKind`. `src/net/protocol.ts` IS NOT TOUCHED.** `CommandKind` ends at `UsePower = 13` and holds nothing that creates an entity. A wire-legal spawn command would travel to the relay, whose contract is *"stamps identity; the simulation enforces authority"* — and the sim has no authority test that would refuse a PvP client conjuring an army. One workstream proposed exactly this; it is overruled.

### 4.6 Replays — re-derive, do not record

**Design (A): the Director re-runs under playback.** This is the pattern the project already accepts for the largest piece of state in the game — the heightfield is not in the replay file, `mapSeed` is. Rejected alternative (B), making every effect a wire `Command`, grows the most dangerous file in `src/net/` and is the security hole above.

- `ReplayHeader` gains `campaign?: { chapter: string; operation: string }`, taken by `ReplayRecorder.captureStart` on the first sim tick alongside factions and bank.
- **`REPLAY_FORMAT_VERSION` STAYS 2.** Verified: `missingHeaderField` checks required fields **by name**, and `Replay.ts`'s own bump criterion is that a version bumps when this build would have to *guess*. A v2 file was recorded before any operation existed, so `campaign: undefined` on it is **a fact, not a guess** — the identical argument `SaveSlotInfo.extra` / `extraOf` runs on, which CLAUDE.md endorses as *"additive rather than a schema break."* **Two workstreams said bump to 3; overruled, because a bump refuses every file on disk to buy nothing.**
- `campaign.system.ts` registers on every boot including playback, reads the header field and arms the same operation.
- **`npm run replay-probe` gains a campaign arm, in CI, with both phases** — including the load-bearing second one: delete one command, require divergence. A matching hash alone is also produced by a playback that fed the world nothing.
- **Stated cost: this forecloses a co-op campaign without rework.** Co-op is explicitly out of scope and is not half-built — `allyMask` has one writer, PvP seats exactly two.
- Residual: `Replays.replayMap` identifies a battlefield **by seed first**, so a campaign seed renders unnamed in the Replays list until `campaign` is read there. One line, Phase 4.

### 4.7 Saves

Verified: `structuralHash()` hashes `MAX_ENTITIES, MAP_CELLS, MAP_CELL_COUNT, MAX_PLAYERS, MAX_SELECTION, CONTROL_GROUP_COUNT, CELL, ENTITY_KIND_COUNT, FACTION_COUNT, BUILD_TAB_COUNT, ARMOR_CLASS_COUNT, WARHEAD_CLASS_COUNT` and three flag bits — **no chunk list** — and unknown chunks are skipped, not fatal. So:

- **New chunk `CHUNK_CMPN = fourcc('CMPN')`** holding trigger armed/fired state, wave cursors, tag registry and the **paid mask** (one bit per objective that has already paid, §5.2). **No `SAVE_SCHEMA_VERSION` bump. No save on disk is invalidated.**
- **Trigger state is keyed by stable string id, never by array index.** Reordering triggers in an operation file must not change what a save restores.
- **Tags store the raw slot plus the generation and re-validate on restore.** A load bumps every `store.gen[i]` — that is exactly how the `carrierId` bug presented, and a service-private `PerEntityU32` was two live bugs there.
- **`requireMatchingWorld` must compare `operationId`.** It compares scenario, map and seed only, so two operations sharing a preset and seed compare **equal** and a save from operation 3 restores into operation 7's world with no refusal.
- **`ServiceContext` gains `campaignOperationId?: string` — OPTIONAL IN THE TYPE.** CLAUDE.md says `extraOf` "falls back field by field"; that is true of `kind` and `thumbnail` and **false of `context`**, which is a whole-object `??` fallback. A row on disk has a `context` object, so the `??` does not fire and a *required* new field reads `undefined` at runtime while typechecking as present. **Correct that sentence in CLAUDE.md in the same commit.**
- The load-screen row writes `mapId: 'campaign:<operationId>'` and the label resolver prints the operation's display name, falling back to the raw string. **It must never call `mapById()` on it.**
- **`Shell.loadGame` must rebuild `opponents` from the operation's authored seat count.** `startReplay` already does this correctly from the header; copy it.

### 4.8 Scenario routing

**One scenario name, `'campaign'`, inside `SCENARIO_NAMES`.** Not 37 names. The per-operation `layout` key carries the variation. `setPlannedOperation(id | null)` mirrors `setPlannedArmies` exactly, including the `resetScenarioPlan()` / `resetTerrainPlan()` ordering before `bootstrap()`.

Three real gates, each with a named answer:

1. **The opening is forced to `'base'` for every non-`skirmish` name**, at two sites in `Scenarios.ts` — and `plan.frozen` alone does not cover it, because `battle`/`economy`/`naval`/`atoll` are `frozen: false`. The campaign plan's opening comes from `OperationDef.map.start` and **defaults to `'base'` with no operation planned**, so `tests/match-start.spec.ts` passes unchanged. **That is exactly the smell this repo distrusts, so the test is strengthened in the same commit**: assert that with an operation planned, `planScenario('campaign').start` equals its declared start, and that no other name can be talked out of `'base'`.
2. **`buildScenario(world, 'campaign', …)` runs headless with no planned operation.** `setPlannedOperation(null)` delegates to `PLANS.skirmish.build` with `start: 'base'`, two armies, `anchor: 'centre'`. Unreachable from the product; it exists so the router is total.
3. **`SCENARIO_PITCH_DEG['campaign']`** must exist and equal `canonicalPitchDeg(planScenario('campaign').distance)`. One row, and it binds **only** under `?shot=campaign` — `applyCanonicalPose` writes pitch only when `enforced`, and off the harness path *"pitch is NOT ours."* So this is a fixture-table row, not a design constraint on 37 operations.

**`StartCondition` is NOT widened.** `START_CONDITIONS` is `['mcv','base']`, iterated by `resolveStartCondition`, imported wholesale by `SkirmishSetup.ts` and pinned by `match-start.spec.ts`. Adding `'force'` puts a **"Fixed force"** row in the skirmish lobby where `buildBaseFor` never runs. `OperationDef.opening: 'mcv' | 'base' | 'force'` lives on the campaign row and `'force'` is honoured by the layout simply not calling `buildBaseFor`.

**Boot flag `?campaign=<chapter>.<operation>`** must be added to `main.ts`'s documented flag list and **handed to `Shell`, not to `options`** — `?tier=` is this exact failure, harness-only for its whole life while the docs implied otherwise. **Do not add it to `MANAGED_FLAGS`** or `buildMatchQuery` deletes it on every boot. It survives today only by accident.

### 4.9 The two shipped defects this feature inherits

Both are live bugs in the current build and both are **prerequisites**, not scope.

**(a) `beginMatch` has two callers, and the shell's carve-out is already defeated.** `MissionTracker.attach` subscribes to `match:started` and calls `this.beginMatch({...})` whenever no matching match is open. `outcome.system.ts` is the sole emitter, edge-triggered on the shell entering `'playing'`, with **no replay, campaign or tutorial exclusion** — the only `tutorialRunning()` guard sits *after* the emit block. Meanwhile `Shell.startMatch` deliberately skips `beginMatch` for a replay under a nine-line comment: *"Watching a recording is not playing a match: it must not count towards 'play 10 skirmishes'…"* One frame later the bus opens the match anyway. **Watching a replay of a win advances `matchesPlayed`, `wins`, `currentStreak` and every kill/build/earn chain today.**

Fix: **`suppressProgression(on: boolean)`, a module-level latch in `progression.system.ts`, in the exact shape of `suppressUnlockGate`.** It gates `beginMatch` **and** `endMatch` regardless of caller. Set by `startReplay` and by `startOperation`; cleared where `suppressUnlockGate(false)` is cleared. **Test it through the bus** — emit `match:started` and assert `inMatch() === false` — never by checking that `Shell` skipped a call. A test that checks the caller cannot see the second caller; that is how this shipped.

**(b) Nothing disarms annihilation, so most scripted operations cannot work.** `Shell.pollOutcome` runs at 2 Hz for every match and, after a 10-second grace, declares victory when every non-Neutral non-allied player has zero living assets, and defeat at zero local assets. `outcome.system.ts` adds a second route through `Viability`. Four reachable failures: an eight-minute hold won at minute three; a scripted seat whose forces arrive at t+3 min holding zero assets at t+10 s → instant victory; a commando insertion landing at t+30 s → instant defeat; a defecting militia counted hostile forever.

Fix, in two parts, both needed:
- **`OperationDef.outcome: { annihilationWin: boolean; assetLossDefeat: boolean; ignoreSeats: readonly number[] }`**, defaults false/false/[] for campaign, read by `pollOutcome` and by the `outcome.system` watcher through `campaign-policy`. **Validator clause: every operation declares an authored win path AND an authored lose path, or explicitly opts into annihilation/asset-loss. An operation with neither is a match that cannot end, and that must be a build error.**
- **Generalise `tutorialRunning()` to `scriptedRunning()`** covering `__vmTutorial` and `__vmCampaign`. Four lines, and it buys three things at once: the `isStranded` nag is silenced for a no-base squad, `hasAssets` auto-defeat stops firing on an operation that legally has no buildings, and the all-enemies-dead auto-win stops pre-empting an objective the player has not met.

**(c) A three- or four-army save restores onto two-army ground.** CLAUDE.md documents it and no guard catches it. **Ten of the 37 operations are three- or four-seat**, and a campaign is the first feature where a player routinely saves mid-mission on a four-army map. The `SaveContext` army-count fix lands **before** campaign saves ride on it.

**(d) Desktop players start with an empty profile** (task #56). `app://voltmarch` is a different storage partition. Losing mission counters is annoying; losing 10.7 hours of campaign is a refund request. **HARD DEPENDENCY: the campaign must not ship until profile export/import is reachable from the desktop Options screen.** The plumbing exists (`serializeProfile` / `parseProfileExport`); the desktop route does not.

### 4.10 The roster — how a campaign restricts what the player may build

Four workstreams proposed four mechanisms. Merged:

```ts
// src/progression/UnlockGate.ts — a second module-level override beside `suppressed`
let campaignRoster: { player: ReadonlySet<string>; ai: ReadonlySet<string> } | null = null;
export function setCampaignRoster(r: { player: readonly string[]; ai: readonly string[] } | null): void;
```
consulted by `isBuildable` / `filterBuildable` **before** `suppressed`. A human player resolves against `player`; a non-human resolves against `ai`. An untagged def (no `unlockedBy`) is always allowed.

- **`suppressUnlockGate(true)` is NEVER used by the campaign.** It authors nothing — `isBuildable` short-circuits on it — and it opens both superweapons to a Brutal AI on operation 1. One workstream proposed it; overruled.
- **A module-level flag, not `setUnlockGate(campaignGate)`**, for the boot-order reason the file already documents for `suppressed`: `progression.system.ts` constructs a fresh profile-built gate during the same boot and silently undoes anything installed earlier.
- **Non-human seats resolve against `ai`, which is how asymmetry is expressed** — "the enemy has Tesla Coils and you do not, go around them." This is the `readForAI` semantics one workstream proposed, collapsed into the same flag.
- **A deny-list on *untagged* defs is CUT.** `UNLOCK_TAGS` is 33 defs across 10 tags; every other def is day-one open. Nothing in §3 needs to withhold an ungated Barracks, and the cost is an edit to the one module CLAUDE.md describes as importing nothing, plus a `census`/`Production` re-derivation at launch. **Authoring rule enforced at import: an operation may restrict only tagged content, and no briefing copy may claim otherwise.**
- **Cleared by `Shell.startMatch` on any ordinary launch**, on the same line that clears `suppressUnlockGate` — the leak CLAUDE.md records happening once already.
- **All four heroes ARE progression-gated** (`fieldMarshal`/`commissar`/`mrdHierarch`/`rclBaron` → `unit.commander`), and **`Defs.ts`'s own comment saying "NOT IN `UNLOCK_TAGS`, so a fresh profile can field one" is FALSE.** Verified: the tag rows and the contradicting comment are both in that file today. **Delete the false claim in the commit that lands the first operation carrying a hero.**
- A pre-placed commander **suppresses its own queue entry for free**, because `Production` caps the queue from `aliveOf(player, entry.defId)` against `maxAlive: 1`. No new field.

### 4.11 The objective surface

Verified: `MAX_VISIBLE_OBJECTIVES = 3` (summary fold), `MAX_EXPANDED_OBJECTIVES = 12` (a *fuse*, per its own comment, not a design constraint), `MATCH_OBJECTIVE_LIMIT = 5` (the seed-drawn skirmish board).

- **An operation publishes at most 3 concurrent objectives**, so nothing changes in `Objectives.ts`. **Never put a fail condition past the summary cap.**
- **Injection, not a global swap.** `ObjectivesPanel` already accepts an injected `progression`; `src/ui/objectives.system.ts` injects the campaign's source for the duration. `globalThis.__vmProgression` is never touched, so the pause menu's Missions board and `EndScreen.drainPending()` keep reading the real profile. One workstream proposed adding `setCampaignObjectives` to `ProgressionControl`; overruled — injection touches no shipped singleton.
- The seed-drawn skirmish board cannot compete for those three rows, because `suppressProgression(true)` means no match is open at the tracker (§5.1).
- **`drainPending()` returns `{ rewards, achievements }` in one call.** `EndScreen` drains it exactly once in its constructor and the file's own header calls that the most breakable line in it; two destructive drains in one constructor is worse.

### 4.12 Retry, abandon, and the fail screen

Retry is the most-pressed button in any campaign and no workstream but one costed it.

- **`EndScreen` has win and loss; it does not have "objective failed — retry."** `MatchResult` gains `reason?: string` carrying **an objective id, never free prose**. Real UI work.
- `Shell.retryOperation()` relaunches from the briefing with no lobby round-trip.
- `Shell.abandonOperation()` clears the outcome policy, the roster flag, both progression latches, the injected objective source and the tag registry. **A latch with no clearing branch is the `suppressUnlockGate` leak, again.**
- `endMatch`'s internal order is load-bearing (latch → complete → push rewards → screen). **Pin the ordering in a test.**
- **Retry and abandon are in the vertical slice's definition of done**, beside save/reload and replay.

### 4.13 Shell states, and the rule that decides how many

```
MID_MATCH_STATES = ['playing', 'paused', 'settings', 'missions']
if (state === 'playing' && !MID_MATCH_STATES.includes(lastState)) { resetMatchState(); emitStarted(shell); }
```

> **ANY NEW `ShellState` REACHABLE FROM `'playing'` AND BACK MUST BE ADDED TO `MID_MATCH_STATES`**, or the return trip emits a second `match:started` mid-operation and re-arms the campaign's own start triggers.

Two new states: **`'campaign'`** (faction cards → chapter list → briefing → debrief; *not* in the list, none of it is reachable from `'playing'`) and **`'briefing-mid'`** *only if* an in-match objectives/dialogue log screen is built (**mandatory** in the list). Tested by driving the state machine, not by reading the array.

### 4.14 The bundle boundary — a Phase-1 deliverable, not a cleanup

`src/game/Systems.ts` globs `'../**/*.system.ts'` with **`eager: true` from the entry chunk**. Anything statically reachable from `campaign.system.ts` is downloaded by every player before first paint, including on the title backdrop and every `?shot=` boot.

- `campaign.system.ts` imports `types.ts` + `policy.ts` only.
- `campaign-install.ts` is the **only** importer of `Director.ts`, `index.ts` and `layouts/`, reached by exactly one `await import()` from `Shell.startOperation` before `bootstrap()`.
- **No `*.system.ts` may statically import anything under `src/shell/**`.**
- **Prose splits per chapter**: `campaign-corpus-allies.ts` and three siblings, each the target of exactly one `await import()` in `Briefing.ts`, memoised, **rejection not cached**. The manual's `eager: true` premise — *"the page rail would have to fetch all of them anyway"* — **does not transfer**, because the campaign screen draws its list from `Operations.ts`.

Measured: `wiki/` is 57,166 words → a 319,643 B emitted chunk = **5.59 B/word emitted**. At ~23,000 words the campaign corpus is **~129 kB, split four ways ≈ 32 kB per chapter.**

**Budget:**

| Piece | Chunk | Delta |
|---|---|---|
| `Campaign.ts`, `Briefing.ts`, campaign shell glue | `Shell-*.js` | +30–50 kB |
| Campaign screen styling | `Shell-*.css` (54,966 B today) | +6–10 kB |
| `src/campaign/{types,policy}.ts` + `campaign.system.ts` | **entry** (2,719,810 B today) | **+8–15 kB** |
| Director, validate, operations, layouts | `campaign-install-*.js` | ~80–140 kB, lazy |
| Four corpus chunks | own | ~32 kB each, lazy |

---

## 5. PROGRESSION, REWARDS AND ACHIEVEMENTS

### 5.1 The campaign feeds NOTHING on the profile

Two workstreams wanted the counter chains (kill/build/earn) to advance off campaign play; one wanted total isolation. **Total isolation wins**, and the deciding argument is not the obvious one:

1. A scripted operation's kill count is **authored**. An operation handing out 200 free kills is a farm for `combat.kills.4`.
2. Three profile missions say "skirmish" verbatim and `tests/content-truthful.spec.ts` checks description truth.
3. **The decider:** CLAUDE.md records that `struct.defence.aa` arriving before `unit.air` is *an ordering accident of the mission curve*, and that it is the only thing preventing a match hanging forever against an all-aircraft opponent. A campaign that completes profile chains at authored rates can invert that ordering. "Feed everything except three rules" is the middle position that breaks it quietly.
4. It is the only option that is **safe by construction** rather than by a subset nobody can verify.

Mechanism: the `suppressProgression` latch of §4.9(a), which the campaign needs anyway.

> **CONSEQUENCE, STATED PLAINLY: ten hours of campaign advances no skirmish unlock and no profile counter.** *UNDECIDED-2 preserves the question as a measurement task, not an opinion: instrument one playthrough and report which profile missions would have completed. If the answer is "most of them", the skirmish curve is vestigial and that is a design decision, not a bug.*

### 5.2 What an operation may pay — the honest answer

Verified against `tests/reward-wiring.spec.ts`: `credits` is a declared gap (*"NOTHING PAYS THESE"*), `cosmetic` is a declared gap (*"NOTHING WEARS THESE"* — fourteen ids, no path to a pixel), and `map` is fully wired (`consumer: SkirmishSetup#mapAvailable`, `isMapUnlockId` is a prefix test, `MAP_CATALOGUE` is regex-scraped from `settings-store.ts`).

| Route | Decision |
|---|---|
| **The next operation** | **PRIMARY REWARD.** Not a `Reward` variant at all — `requires: readonly string[]` on the operation row, a graph edge validated at import (resolves, acyclic, no forward reference). **Zero exposure to `reward-wiring.spec.ts`.** |
| **Credits on a SECONDARY objective, paid in-match** | **ADOPTED.** `Economy.grant(owner, n, CreditReason.Bounty)` — `grant`, not `deposit`, because a scripted reward must never evaporate at a full silo; the permanent `capFloor` lift is its accepted cost. `oreWasted` is **not** touched (verified: it increments only for `CreditReason.Harvest`), so "Zero Waste" needs no re-derivation. Primaries pay nothing — paying for the primary is paying for playing. |
| **Medals** | **DERIVED, never stored as payable.** `medalFor(result)`: bronze = won · silver = bronze + every secondary complete · gold = silver at Hard or above. Profile stores the **best** per operation; monotonic, compared with `>`, never lowered. |
| **`UNLOCK_TAGS` id** | **NO.** The `UNLOCKS` survey proves the def catalogue has nothing left a new tag group can legally cover, and reassigning an existing id breaks the exactly-one-granter invariant. Also: `UnlockGate.mirrorAI` is default-true, so a campaign-granted unlock silently arms every future skirmish opponent. |
| **Cosmetic** | **NO in v1.** Closing that gap needs `MassRole.Insignia` to become per-profile (a union widening + a texture-cache-key change + fourteen re-declarations with real `resolves` predicates — a `resolves: () => true` re-creates the exact defect that file exists to catch). *UNDECIDED-5.* |
| **A skirmish map** | **NO in v1**, because it requires a genuinely new `MAP_PRESET` that differs on all seven balance numbers, which is §6.2's deferred item. Legal the day one ships. |

**Overruled:** a `map` unlock at operation 11 (blocked on a preset that is itself undecided — it cannot be scheduled); a `codex` `Reward` variant (ship the codex as content the campaign screen renders; making it a `Reward` buys a `claimFor` branch for nothing, and the `power` variant was **deleted** rather than left inert for precisely this reason).

**`tests/campaign-wiring.spec.ts`** is a hard deliverable in both directions: every objective declaring `credits` resolves to the one named payout call site; no primary declares credits; every `requires` id resolves and the graph is acyclic; and **the payout module contains exactly one `grant(` call reachable only from the campaign objective path.** Separately, **rewrite `reward-wiring.spec.ts`'s `stillMissing` three-file path enumeration into a repo-wide `\.grant\s*\(|getEconomy\s*\(` scan minus a named allowlist** — the four existing sim callers plus the one campaign file — so a second payment route cannot appear silently.

### 5.3 Achievements

A **separate table with no `reward` field at all**, so no `Reward` value is ever constructed and `reward-wiring.spec.ts` correctly never sees them. `src/data/Achievements.ts` (self-checking at import) + `src/progression/achievements.ts` (same bus subscription and bucketing as `MissionTracker`).

**Rule union isolation:** `AchievementRule = MissionRule | CampaignRule`, a union `MissionDef` cannot reference, **plus** one line in `validateMissions` refusing `on: 'campaignOperation'` outright, **plus** a test that fails when that line is removed. The type half evaporates under an `as` cast; the runtime half is what ships.

Storage: `achievements: Record<string, {value, earnedAt}>` on `Profile`, `PROFILE_VERSION` 2 → 3 with a real `MigrationStep`, `normalizeProfile` branching explicitly (it rebuilds from `defaultProfile()` and copies only what it recognises), bounded like the existing maps.

**Tiering, honestly:** 30 rows → **14 shippable today** on existing rule kinds and events; **8 gated on the campaign existing**; **4 needing one new field**; **2 needing a new event or a pooled-payload field**; **2 cut**.

Two cuts, both with reasons so nobody re-derives them:
- **"Air Marshal"** — blocked on `defKey` (`EvEntityKilled.defId` is the real def index on some paths and `BuildEntry.publicId` on others). The fix has a precedent (`EvCredits.mined`, added with *"ALWAYS SET IT, including to 0 — the payload is pooled"*) and is worth doing on its own merits, **not as campaign scope creep**. *UNDECIDED-8.*
- **"Comeback"** — `building:completed` has exactly one emitter and **scenario-spawned structures emit nothing**, so on a `base` opening the running count starts at 0 while five structures stand and "dropped below 3" latches on tick 0 of every match. **It would pass a synthetic-trace test, because the trace also starts at zero.** The honest alternative is a 2 Hz sampler on the render side; not worth one achievement.

Two shipped facts to honour: **"Elite Guard" is rank 2, not 3** (`VETERANCY_KILLS.length` is 2 and `content-truthful.spec.ts` pins it — writing rank 3 is the shipped bug this repo already paid for once); **"Deep Seam" counts `EvCredits.mined`**, not the banked delta.

> **`tests/achievements.spec.ts` MUST DRIVE EVERY ACHIEVEMENT TO COMPLETION FROM A SYNTHETIC EVENT TRACE.** CLAUDE.md records three shipped counters that could never move — veterancy rank 3 against a two-rung ladder, `flee=0` for a state written by nothing, `sw=0/0` from a stubbed `UnlockGate`. **An achievement with no completing trace does not ship.** "Comeback" proves this test is necessary and not sufficient.

Surface: **not** in `Objectives.ts` — that panel answers one question and its budget is already against the look bible's 16% interface ceiling. Achievements fire on the end screen and live on a **Service Record** screen off the main menu, reusing `MissionsPanel`, with **Export / Import profile buttons** against the desktop partition problem until task #56 lands.

### 5.4 The 10-hour claim — par-first, and the test is writable on day one

The wrong version makes a player-facing claim depend on a blind measurement of three operations. Inverted:

1. Every operation row carries an authored **`parSec`**. It is not dead weight — it is also the Gold time threshold and the reinforcement-timing anchor.
2. **`tests/campaign-length.spec.ts` asserts `sum(parSec) >= 36000`.** Writable the day the table exists; depends on no human. Authored sum is 38,520 s, so **the floor absorbs about two operations being cut.**
3. **K = actual ÷ par** is measured afterwards on the three structurally most different operations (assault, defend, escort) and published as `n=3, range x–y`. It is used **only to decide whether the claim can be raised, never to reach it.**
4. **The figure counts first-playthrough time, at par, on Normal.** Write that sentence next to the number wherever it is printed.

### 5.5 Difficulty

Campaign difficulty is **the `DIFFICULTIES` rung plus authored per-operation parameters** (starting bank, enemy roster, wave table, secondary pars). An operation that changes only the rung is the same operation with a faster opponent.

Three shipped facts that constrain the tuning:
- **`AI_DIFFICULTY[].resourceBonus` multiplies HARVESTED income**, so it is **dead for every wave-only opponent with no refinery.** Campaign difficulty must scale the authored wave table directly.
- **`AI_SKILL[].queueDepth` changes no rate.** `BuildQueue.advanceTab` only ever advances `items[0]`. Only more factories move throughput.
- **`AI_SKILL[0].creditFloor` is 1400, the largest reserve on the ladder, and Easy has `powerMask` 0 and builds no Command Post at all.** Any operation whose premise involves commander powers is silently a different operation at the lowest rung, and any spending restraint is tested at Easy first — that is where a new constraint turned into a measured, reproduced deadlock.

---

## 6. PRODUCTION

### 6.1 Art — no fifth non-generated asset

| Item | Answer |
|---|---|
| **Commander portraits** | **Procedural, zero new asset.** `src/ui/Cameos.ts` already renders the actual game mesh into a cached render target as a mini-diorama — three-quarter view, key light, contact shadow, theatre backdrop — and all four heroes already exist as units. **A portrait is a cameo at a closer framing.** No human faces: a three-quarter diorama of a unit mesh is a *figure*, which is both on-brand and the only procedurally honest option. Two traps: the cameo renderer reuses the main renderer at `RenderPhase.Hud` and needs a booted engine behind the briefing — **verify on the between-operations route, not just the menu route** — and on WebGPU the readback is async, so hold the reveal rather than popping. |
| **Briefing backdrop** | **Free.** The title screen already boots a real match with AI off and a slow orbit — *"the background is the game."* |
| **Theatre map** | **Procedural 2D**, in the `src/ui/icons.ts` idiom (1.7 px stroke, round caps, `currentColor`) at a larger viewBox, themed from `FACTION_PALETTE`. Inline SVG, no sprite sheet, no request. |
| **Insignia / heraldry** | **Deferred to `UNDECIDED-5`**, because it is the same generator the fourteen dead `cosmetic.*` ids want and it is the render workstream's cost, not this one's. |
| **Cutscenes** | **CUT.** The look bible bans depth of field and motion blur — the cinematic toolkit — and a pre-rendered cutscene is a downloaded asset by definition. **No video in `public/`.** |
| **A fifth exception** | **Recommend NO.** If the author wants painted portraits, take it **once, at the start, for portraits only**, on the `tools/brand.mjs` pattern: sources outside `public/`, a generator resolving paths **from the script's own location, never the caller's cwd** (that bug has shipped three times), a `README.md`, and CLAUDE.md's numbered list + `README.md` + the credits screen edited in the **same commit** — `tests/credits-truthful.spec.ts` checks the credits against `public/` recursively. |

**`npm run shots` cannot see any of this.** Thirteen posed fixtures, `?shot=` never constructs a Shell, `__vmProgression` is never published. **Do not read an unchanged 91.1% grade as evidence anything campaign-related is fine.** That is bounded and honest, and it is not "no gate": `tests/campaign-screens.spec.ts` mounts each screen under vitest and asserts structure and word survival, exactly as `manual.spec.ts` does for 17 pages.

### 6.2 Maps — 7 presets, 35 battlefields, no new preset in v1

**The key unlock, and it overrules a caution two workstreams carried:** the three preset-clone maps were cut because **the lobby sold a reroll of a battlefield as an unlockable reward** — `settings-store.ts`'s own deletion block says so. **An operation is a designed battlefield, not a reward.** So novel `mapSeed` values on existing presets are legal here in a way they were not there.

- **`CAMPAIGN_SEEDS`: 4 frozen alternates per preset = 28**, plus the 7 shipped = **35 validated battlefields for 37 operations.** Two operations share ground and must differ in seat, army count and starting force.
- **The validation pass is real work, not zero.** Each seed runs the same per-map assertions the shipped seven already carry: `naval-maps` (start shelves dry), `naval-shore` (dock sites — coral-shore had **zero** legal sites before the beach fix), `roads-drape` (buried carriageway, prop density), `scatter`, `terrain-lod`. Each must also be unique against every shipped `mapSeed`, because `Replays.replayMap` identifies a battlefield by seed first.
- **NO NEW `MAP_PRESET` IN V1.** A preset is seven balance numbers plus a biome and a mood, it enters the look bible's jurisdiction, and **no existing capture fixture will notice it is untuned.** Each new preset needs its own `?shot=` fixture or it ships ungraded. *UNDECIDED-4.*

> **THE SEAT RULE — the sharpest finding in the whole merge, and it is verified.** `seatedSlots(armies, seed, sea)` opens `if (n !== 2) return Array.from({length: n}, (_, i) => i);` — **the dry filter is consulted for two-army matches only.** At three or four armies every slot is seated regardless of water, and `dryPairs`'s own measured table puts **slot 3 on `coast` at −78.10 m and slot 2 on `tropical` at −90.10 m**. The lobby is protected by `normalizeSetup`'s `map.players` clamp; **a campaign that authors its own opponents never calls it.**
>
> **RULE: an operation whose preset carries a `MAP_SEAS` half-plane placed by `seaOffMapCentre` is TWO-SEAT. No exceptions, no playtest revision — it is the projection of the start rectangle onto `START_BISECTOR`.** Presets with `sea.islands` (atoll) and landlocked presets are unaffected. This is `tests/campaign-maps.spec.ts`'s first assertion.

Under that rule the seat budget in §3 is legal: `coast` and `tropical` operations are all 2-seat; every 3-seat operation is on `temperate`, `arid` or `urban` (landlocked, no `MAP_SEAS` row, so `dryPairs` is never reached); every 4-seat operation is on `atoll`.

**`frozen-sector: players 2 → 4` is RECOMMENDED but not required by §3.** Its 2 is an authored judgement CLAUDE.md calls revisable (83–89% buildable, zero shelf push at all four starts), and the field's own "no reserved terrain shelf" clause is **stale** — `plannedStartPoints` reserves per seated slot now. **It is not a one-integer change:** it is one integer, one stale comment clause, and a re-baseline of `tests/terrain-lod.spec.ts`, whose per-map chunk counts **already fired once** when the start spread moved. Read that spec's header first.

**THE TERRAIN IS NOT AUTHORABLE, and this is a design constraint on the writers.** `ScenarioBuilder`'s full public surface has **no heightfield method**. "A chokepoint at the north pass" is not authored, it is *found* by re-rolling a seed — so **one generator change silently re-routes every operation at once.** Two mandated consequences: a **per-operation terrain fingerprint** in `campaign-maps.spec.ts` (hash the heightfield the operation's `(preset, seed, armies, biome)` produces, pinned per operation, in the shape of the pinned LOD chunk counts); and a rule in `layouts/`'s header — **objectives key to authored entities and named markers, never to a ridge.** *UNDECIDED-9 assigns the re-authoring cost.*

**Never rotate a layout with `sin`/`cos`.** ECMA-262 pins only `+ - * /` and `Math.sqrt`; terrain generates independently on both machines of a lockstep match.

### 6.3 Voice — text-first, and it is a decision rather than a hedge

**Text is the product; voice is layered on finished text, never the reverse.** The briefing screen is complete with text alone, which is the only degrade path that always works.

Re-measured from the Ogg page structure rather than dividing bytes by seconds:

```
public/audio/  185 files  6,716,198 B      (eva 405,170 / sfx 2,635,981 / voice 336,405 / music 3,330,715)
EVA bank: 33 files, 44.73 s, mean line 1.36 s
  Vorbis id/comment/setup headers  113,718 B = 28.1% of the bank
  gross rate     9,057 B/s  <- INVALID to extrapolate; the bank is header-dominated
  audio-only     6,515 B/s  = 52.1 kbps      per-file header tax ~3,446 B

bytes = seconds x 6,515 + files x 3,446
37 ops x 1 line x 45 s     = 10.98 MB   1.63x the whole current bank
37 ops x 3 lines x 45 s    = 33.0 MB    4.9x
```

Consequences: **briefings are lazy-loaded per operation, never preloaded**, via `import.meta.env.BASE_URL` (never a leading slash). A 404 leaves the panel with **no play control at all**, following the Multiplayer-button precedent — a control that appears only once the resource is known good. **`EvaLine.MissionAccomplished` / `MissionFailed` already exist and already fire, so the win/lose stinger is free.** The `render-eva.py` shape is copied including its parse guard, and it must read the **campaign** line table, not `EVA_LINES`, or the guard fires against the wrong count. **Every one of the 33 shipped EVA lines carries a hand-authored `phones` string**, so 37 briefings at four lines each is ~148 phonetic transcriptions.

**Licence.** The chain extends cleanly for **one** narrator: `en_GB-cori-high` is LibriVox (public-domain) data trained from scratch, avoiding the research-only Blizzard/Lessac terms. **Never cite the `rhasspy/piper-voices` repo tag** — it says `license: mit` over voices whose real terms are non-sublicensable research-only. Cite the specific `MODEL_CARD`. Two residuals the audio README already records: LibriVox asserts public domain **in the USA only**, and a PD dedication disposes of copyright in a recording without transferring the reader's **voice likeness** — negligible for an unnamed announcer, a slightly larger surface for a *named commander character*.

> **VOICE IS A SEPARATE RELEASE AFTER ALL TEXT SHIPS AND AFTER THE AUTHOR HAS HEARD A SAMPLE**, so a rejected voice is never in git history. *UNDECIDED-3.* **The dossiers in §2.3 specify voice in register terms — cadence, vocabulary, sentence shape — precisely so they survive a text-only outcome.** And the survey must complete before the *prose* is written, not before the audio pass: dialogue between four commanders delivered by one flat announcer is worse than prose written for an announcer.

### 6.4 Words

```
37 operations x (briefing ~250 + debrief ~100 + 6-10 in-mission lines ~100)  =  16,650 w
4 commander dossiers (~800) + 4 chapter framings (~700) + shared canon           6,100 w
                                                                        TOTAL  ~22,750 w
```

**Nobody is assigned to write them.** *UNDECIDED-10.*

### 6.5 The wiki, and the rename that must not happen

`wiki/` **is a build input** — `manual.spec.ts` renders every page word-for-word, `wiki-numbers.spec.ts` re-derives numeric claims, and the entry chunk grew by **10 bytes** when the whole manual landed.

**Do NOT rename `wiki/Campaign.md`.** Measured inbound links: `Strategy.md` 5 · `Units-and-Verbs.md` 4 · `Home.md` 2 · `Maps.md` 1 · `Sunder-Atoll.md` 1 = **13**. Two of those are **cross-page anchors** (`wiki/Campaign#commander-powers`), and `wiki-links.spec.ts` only resolves **same-page** fragments — the gate cannot see them. **Rewrite the body in place**, preserve the `### Commander powers` heading text, and let `Manual.ts` pick the new title off the `#` heading so the rail label changes with zero href edits.

**Its two counts are already wrong today.** It says a *"49-row mission table"* and *"36"* profile missions; **measured, `MISSIONS` is 46 rows — 33 profile, 13 match** — since the three retirements. `wiki-numbers.spec.ts` imports `Defs`/`config`/`Combat` and never touches `MISSIONS`, which is exactly how a build input came to be lying inside the in-game manual. **Fix the numbers AND extend the gate to re-derive `MISSIONS.length` and the per-scope counts**, or the campaign's own counts rot the same way within a release.

**Per-chapter wiki pages: recommended against at first ship.** They are a second copy of the campaign's own corpus and nothing gates their numbers.

**`tests/campaign-text.spec.ts`**, in `wiki-numbers.spec.ts`'s shape: every page parses; every word of four letters or more survives into the rendered tree; **no briefing body contains a bare integer that an `Operations.ts` field also holds**; and a minimum-row assertion so a parser matching nothing fails loudly. Objectives render from data, beneath the prose, never inside it.

---

## 7. THE BUILD ORDER

Phases are sized so one agent can take one. **‖ marks work that can run in parallel.** Days are person-days.

### Phase 0 — PREREQUISITES (all ‖, all shippable alone, all worth landing regardless)

| # | Work | Days |
|---|---|---|
| 0a | **Rewrite `docs/MISSIONS_DESIGN.md`'s content-model row in place** — it currently reads *"Objective-driven skirmish. No hand-authored story maps, no scripted triggers, no narrative,"* and `tutorial-steps.ts` cites it as reason 1 for an existing architectural decision. Rewrite that reason too (the tutorial stays a director because of reasons 2 and 3). **Replace the by-line-number citation with a section anchor** — it already points at line 18 for a line now at 23. | 0.5 |
| 0b | **Fix the shipped progression leak** — `suppressProgression` latch, set for replay. Bus-level test. §4.9(a) | 1–2 |
| 0c | **Desktop profile export/import** (task #56). HARD DEPENDENCY. §4.9(d) | 2–3 |
| 0d | **`SaveContext` army count** (the 3–4 army save defect). §4.9(c) | 1–2 |
| 0e | **Extend `wiki-links.spec.ts` to resolve cross-page fragments**, and fix `wiki/Campaign.md`'s two wrong counts + extend `wiki-numbers.spec.ts` to cover `MISSIONS` | 1 |

### Phase 1 — THE VOCABULARY (‖ with Phase 2)

| # | Work | Days |
|---|---|---|
| 1a | `types.ts` + `policy.ts` + `Director.ts` + `validate.ts`. Pure, node-only. **`types.ts` FREEZES at the end of this phase.** | 4–6 |
| 1b | **`tests/campaign-bundle-isolation.spec.ts` + the `campaign-install.ts` boundary.** §4.14. **Before operation one, not after.** | 1–2 |
| 1c | `tests/campaign-data.spec.ts` (the import-time validator) + `tests/campaign-determinism.spec.ts` | 2–3 |

### Phase 2 — THE RUNTIME

| # | Work | Days | Dep |
|---|---|---|---|
| 2a | `WorldQuery` / `EffectSink` implementations + `campaign.system.ts` (both halves) + the `spawnUnits` fault path | 5–7 | 1a |
| 2b | **Outcome policy + `scriptedRunning()`.** §4.9(b) | 2–3 | 2a |
| 2c | **`setCampaignRoster`** + `tests/campaign-roster.spec.ts`. §4.10 | 1 | — ‖ |
| 2d | Scenario routing: the `'campaign'` name, both start-forcing sites, `setPlannedOperation`, the default plan, the pitch row, the `CampaignLayout` contract. §4.8 | 3–5 | 1a |

### Phase 3 — THE SHELL

| # | Work | Days |
|---|---|---|
| 3a | Two `ShellState`s, four screens, `startOperation` / `retryOperation` / `abandonOperation`, main-menu entry, `MID_MATCH_STATES`, every latch clear at the one line that clears `suppressUnlockGate`. **Extract the block→DOM walker out of `Manual.ts`** so briefing and manual share one renderer. | 8–12 |
| 3b | Objective injection through `objectives.system.ts` ‖ | 2–3 |
| 3c | `EndScreen` `reason` field + the fail screen with **Retry** ‖ | 2–3 |

### Phase 4 — PERSISTENCE

| # | Work | Days |
|---|---|---|
| 4a | Profile v3 + migration; `CHUNK_CMPN`; `requireMatchingWorld` operation compare; `ServiceContext.campaignOperationId?`; load-screen row; `Shell.loadGame` route; autosave | 5–7 |
| 4b | `ReplayHeader.campaign` (**version stays 2**) + the `startReplay` branch + `Replays.replayMap` + **the `replay-probe` campaign arm, in CI** | 3–4 |

### Gate M — ★ THE VERTICAL SLICE. One operation: **S1**. ★

**S1, not A1** — the recommended play order starts with the Soviets, and S1 is archetype A (`assault`, zero triggers), which is the smallest thing the author can actually play. The escort verb lands in Phase 6 with the runtime proven under it.

**Definition of done, and every clause is a seam most likely to be silently broken:**
- Main menu → Campaign → four chapter cards → operation list → briefing → Deploy → boots with a scripted opening
- Two objectives, one firing reinforcements on an `elapsed` trigger
- **A win condition that is not annihilation, proven by wiping the enemy and NOT winning**
- End screen → profile v3 written → operation 2 unlocks
- **Saved mid-operation, reloaded, finished**
- **Recorded and replayed to matching checkpoint hashes, and the delete-one-command phase diverges**
- **Retried after a deliberate loss**
- **Abandoned and re-entered**
- **TIMED.** Actual clear time recorded against authored `parSec`. *(2–3 days of play and fix.)*

> **NOTHING IN PHASES 5–7 STARTS UNTIL GATE M PASSES AND K IS MEASURED.** CLAUDE.md's first entry under *Things that have gone wrong before* is *"A green build proving nothing"* — `npm run build` once succeeded while `main.ts` imported neither core nor render. Gate M is the same lesson applied to 22,750 words.

### Phase 5 — CHAPTER 1 (four operations, one per faction: S1–S3, A1, R1)

Four operations across all four factions, plus the **`tools/op-harness`** — `?campaign=<id>&trigger=<n>&speed=<x>` to arm an operation at trigger N with preconditions satisfied at compressed sim speed. **Without it a designer cannot reach minute 14 of a 19-minute operation in under 14 minutes and the QA numbers below are fiction.** 5–8 days plus content.

**RE-DERIVATION GATE:** with 5 operations timed, recompute. If mean actual < 16.2 min, the 37-operation table does not clear 10 h and the author chooses between more operations and longer ones **before 32 more are authored.**

### Phase 6 — CONTENT — ‖ ×4, and the only genuinely parallel workstream

**Four agents, one chapter each.** They cannot collide: separate directories, separate operation ids, every file validated at import, `types.ts` frozen. **Phases 1–5 must land *complete* first** — four agents authoring against a moving effect vocabulary is the expensive failure mode.

**Per operation: 4–8 hours** (a 60–150 line layout against `ScenarioBuilder`, a 15–40 line trigger table, ~450 words, and two or three real playthroughs). **37 operations = 180–320 person-hours**, of which **~35 hours is human play across three passes** that no agent can do.

### Phase 7 — CLOSE-OUT

Achievements (14 T0 rows can ship any time from Phase 4; the 8 campaign rows land here) · `wiki/Campaign.md` rewritten **in the same commit as the last operation** · `README.md` · the CLAUDE.md section · `docs/CAMPAIGN_CANON.md`.

### Totals

```
ENGINE   45-65 person-days      (Phases 0-5, including the shell, which four workstreams under-costed)
CONTENT  180-320 person-hours   (Phase 6) = 23-40 person-days, of which ~35 h is human play
```

---

## 8. THE GUARDS

Every test in this repo's style: it must be able to fail, and it must fail at the source rather than at the symptom.

| # | Spec | Asserts |
|---|---|---|
| **G1** | `campaign-data.spec.ts` — **runs at import, so it is a build error** | Operation ids unique; trigger ids unique within an operation; every `map.preset` real and `armies` legal under **the seat rule**; **every def key resolves in `FALLBACK_UNITS`, not `UNITS`, and against the faction of the seat it spawns for**; every objective referenced exists and every objective is referenced; every `Condition.on` / `Effect.do` in the frozen table; `requires` acyclic and every operation reachable; every marker and tag used is produced by that operation's layout; **every operation declares an authored win path AND an authored lose path, or opts into annihilation/asset-loss**; **no operation restricts an untagged def**; `primaryType` never repeats adjacently within a chapter. |
| **G2** | `campaign-reachability.spec.ts` — **two gates, named honestly** | **(a) Connectivity:** ≥1 `endOperation('win')` reachable with all conditions free; no unavoidable lose; no objective whose arming condition is unreachable. **(b) Domain — the gate that catches the veterancy-rank-3 shape:** every condition's constants checked against the world it runs in — `ownerCount` targets ≤ what the layout plus roster plus production can produce; `elapsed` ticks ≤ any authored limit on the same path; `credits` thresholds reachable from the starting bank plus the ore actually seeded. **(c) Conceded: "unwinnable in practice" is only answerable by playing it.** |
| **G3** | `campaign-determinism.spec.ts` | Director purity — same `(state, facts, tick)` twice → deep-equal effect list; **source scan** over `src/campaign/**` and `campaign.system.ts` for `Math\.random\|Date\.now\|performance\.now\|localStorage\|document\.\|window\.` with comment stripping; **import boundary — the Director imports no `three`, no DOM, no `src/shell/**`, and never `UnlockGate`.** |
| **G4** | `campaign-maps.spec.ts` — build every operation headless | **The seat rule first.** Then: every seated army opens with ≥1 asset; every declared spawn point is ground the unit's locomotor can stand on **and leave** (the aircraft-egress bug); every start's `buildableFraction` ≥ `START_CORE_MIN` (the `contested-strait` slot-3 case); worst-case concurrent entities + layout + expected production < `MAX_ENTITIES` (4096); **per-operation terrain fingerprint**; clean `auditConnectivity()`; no scatter prop on a carriageway (`isCarriageway`, **never `isRoad`**). |
| **G5** | `campaign-save.spec.ts` | Trigger state round-trips exactly; a save with no `CHUNK_CMPN` loads with default state; **reordering triggers changes nothing a save restores**; **a save from operation A is REFUSED against operation B on the same preset and seed**; `structuralHash()` unchanged, asserted **by value**; **a paid secondary does not pay twice after save-scum.** |
| **G6** | `campaign-replay.spec.ts` + the `replay-probe` campaign arm **in CI** | A recorded operation replays to matching checkpoint hashes **and deleting one command diverges**; a campaign header round-trips through a v2 file; a genuinely v2-era file still parses. |
| **G7** | `campaign-gate.spec.ts` | **`suppressProgression` asserted through the BUS** (emit `match:started`, assert `inMatch() === false`); `setCampaignRoster` cleared on **every** exit — win, loss, retry, abandon, quit; **every new `ShellState` reachable from `'playing'` and back is in `MID_MATCH_STATES`**, driven through the state machine rather than read off the array. |
| **G8** | `campaign-wiring.spec.ts` + `reward-wiring.spec.ts` extension | Every objective declaring `credits` resolves to the one payout site; no primary declares credits; **no campaign operation constructs a `Reward`**; `stillMissing` rewritten as a repo-wide `grant(` scan with a named allowlist. |
| **G9** | `campaign-bundle-isolation.spec.ts` | No operation id or fingerprint phrase in `index-*.js`; **the non-vacuity half — one other chunk carries every operation**, so the test cannot pass by the campaign having been deleted; a static import from `campaign.system.ts` to `Director.ts` fails on purpose; **no `*.system.ts` statically imports `src/shell/**`.** |
| **G10** | `campaign-text.spec.ts` + `campaign-screens.spec.ts` | Every page parses; every word ≥4 letters survives into the rendered tree; **no bare integer in prose that a data field also holds**; a minimum-row floor; every screen mounts and its structure holds. |
| **G11** | `campaign-length.spec.ts` | `sum(parSec) >= 36000`. |
| **G12** | `achievements.spec.ts` | **Every achievement driven to completion from a synthetic trace.** One with no completing trace does not ship. |
| **G13** | `wiki-numbers.spec.ts` extension | Operation and chapter counts re-derived from `CAMPAIGNS`; `MISSIONS.length` and per-scope counts re-derived. |

**The standing gates, unchanged, at every step:** `npm run typecheck` (four invocations — run **`npm ci --prefix server`** first in any fresh worktree or the fourth dies on `TS2307: Cannot find module 'ws'`), `npm test`, `npm run build`, `npm run server:test`. **G5, G6, G9 and G13 add to the `distIsCurrent()`-gated count CLAUDE.md tracks — update that number in the same commit.**

**Nothing here should move a pixel.** `npm run shots` should be byte-identical for the ten non-HUD fixtures; if it is not, something reached the render path that should not have.

### 8.6 Verification log

Re-checked in this pass against `04ee0a5`: `REPLAY_FORMAT_VERSION = 2` and `missingHeaderField` exists · `MID_MATCH_STATES` at `outcome.system.ts:242`, `tutorialRunning():212`, the *"a future campaign trigger"* comment at `:54`, `emitStarted` at `:498` · `MissionTracker.ts:351` is the second `beginMatch` caller · `UnlockGate`'s `suppressed` short-circuits ahead of the active gate · `MAX_VISIBLE_OBJECTIVES = 3` / `MAX_EXPANDED_OBJECTIVES = 12` / `MATCH_OBJECTIVE_LIMIT = 5` · `MAPS[].players` = 4,4,2,4,2,2,4 · `seatedSlots` returns early at `n !== 2` · `Production.spawnUnit` returns `NONE` on a missing `FALLBACK_UNITS` row **before** touching the def table · `Systems.ts` globs `*.system.ts` with `eager: true` · `manual-corpus.ts` splits despite `eager: true` · `Defs.ts` tags all four heroes `unit.commander` **and** contains a comment claiming they are not · `MISSIONS` is 46 rows / 33 profile / 13 match while `wiki/Campaign.md` says 49 and 36 · `public/audio/` is 6,716,198 B over 185 files · `Economy` increments `oreWasted` only for `CreditReason.Harvest` · `grantUnlock` is exported and `MAX_UNLOCKS` is 512 · `reward-wiring.spec.ts` declares the credits and cosmetic gaps and wires `map`.

---

## 9. WHAT IS UNDECIDED

Ordered by how much rework a wrong guess causes.

| # | Question | Who decides | When |
|---|---|---|---|
| **1** | ~~**Naming — rename the ~20 Westwood/EA proper nouns (B), keep (A), or keep-and-acknowledge (C)?**~~ **CLOSED 2026-08-19: B, twelve rows, keys untouched.** Shipped the same day, so it never reached the prose it could have invalidated. §2.5 | **The author** | **DECIDED** |
| **2** | **Does campaign play ever feed the profile chains?** Default is **no** (§5.1). The question is preserved as a *measurement*: instrument one playthrough and report which profile missions would have completed. If "most of them", the skirmish curve is vestigial. | **The author**, on data this plan can produce | After Gate M |
| **3** | **Voice: how many Piper voices have individually-verified clean `MODEL_CARD` chains?** The survey has not been run. **If the answer is one, the writing must be shaped for an announcer from the first word** — four commanders delivered by one flat narrator is worse than prose written for one. §6.3 | **The author**, after hearing samples | **Before Phase 6 prose** |
| **4** | **Does the author fund one or two genuinely new `MAP_PRESET` rows?** Without it, 37 operations sit on 7 landforms and 28 validated seeds. **Cloning a preset is not an option — that was tried, shipped as three maps, and undone.** Each new preset needs its own `?shot=` fixture. §6.2 | **The author**, with a graphics-fluent agent | Phase 6 |
| **5** | **Do the fourteen unworn cosmetics finally get worn?** Needs `MassRole.Insignia` per-profile (a render change) plus fourteen `reward-wiring` re-declarations with real `resolves` predicates. **Do not add a fifteenth id.** §5.2, §6.1 | **The render workstream** | Post-v1 |
| **6** | **Does any operation require a structure to appear mid-match (`spawnBuildings`)?** If yes, budget 1–2 days for a `placeStructureDirect`. §4.4 | **The content workstream** | **Before `types.ts` freezes** |
| **7** | **Does any escort operation need `setInvulnerable`?** One entity flag. §4.4 | **The content workstream** | **Before `types.ts` freezes** |
| **8** | **Is `defKey` on `EvEntityKilled` / `EvProductionReady` worth it?** Unblocks "Air Marshal" and the whole build/kill-N-of-X family; costs an audit of every emitter, with `EvCredits.mined` as the documented precedent. **Decide on its own merits, not as campaign scope creep.** §5.3 | **The author** | Any time |
| **9** | **Who re-authors an operation whose chokepoint moved** when a generator change re-rolls the ground? The fingerprint makes it loud; it does not make it cheap. §6.2 | **The author** | Phase 6 |
| **10** | **WHO WRITES 22,750 WORDS, AND WHO PLAYS 35 HOURS OF QA?** Unassigned. Options: (a) the author, ~12–16 sessions producing no code; (b) an agent drafts per chapter and the author edits — fast, risks tonally flat filler; (c) cut to 8 per faction and **say out loud that it is 8.7 h, not 10.** **Recommend (b) for the drafting and non-negotiable author time for the register pass and the QA.** | **The author** | **Before Phase 6** |
| **11** | Does the standalone Tutorial entry survive once S1 exists? Recommend yes — the director grants nothing and costs one menu row. | The author | Phase 7 |
| **12** | Does Ilse Bramm survive? Written so the Reclamation campaign answers it and the other three do not. **Write it last**, once all 37 exist. | The author | Phase 6 end |
| **13** | Is four campaigns ending on one landform acceptable? It is the only staging the shipped `MAP_SEAS` / start arithmetic permits for a four-way, and each is a different island, seat, ally pattern and objective. **Flagged rather than sold.** | The author | Phase 6 |
| **14** | Does a reload replay the last dialogue line, drop it, or resume the queue? The queue is presentation state, not sim state, so it is not in `CHUNK_CMPN`. | The author | Phase 3 |

---

## 10. THE HONEST RISKS

Ranked. The last one is the one nobody wants to say.

### 10.1 The content is the project, and nobody is assigned to it

180–320 person-hours of authoring plus ~35 hours of irreducible human play, against 45–65 person-days of engine. **The engine is the part an agent can do unsupervised and it is under a third of the cost.** Every other risk on this list is smaller than this one. *UNDECIDED-10.*

### 10.2 The match ends itself

`pollOutcome` fires a win at minute three of an eight-minute hold, or a defeat at t+10 s on an insertion. Four reachable shapes, all in shipped code. Closed by §4.9(b), by G1's win/lose-path clause, and by the slice's requirement to **wipe the enemy and not win**.

### 10.3 Progression opens itself

The bus is a second caller of `beginMatch` and the shell's replay carve-out is **already defeated in the shipped build**. The campaign inherits it and multiplies it by 37. Closed by §4.9(a) and a **bus-level** test — a test that checks the caller cannot see the second caller, which is how this shipped.

### 10.4 A reinforcement wave silently spawns nothing

Three distinct silent failures, all in `spawnUnit`'s `return NONE` paths: a missing `FALLBACK_UNITS` row (a def with a flawless row *"would take the player's 500 credits, run its build bar to 100%, and never walk out of the barracks. Silently. Forever."*), entity-budget exhaustion at 4096 against a base measured at 104 units, and a spawn point with no egress. Closed by G1 and G4 — and by `EffectSink.spawnUnits` **counting `NONE` returns and raising them as a mission-level fault**, never a silent `continue`, which is what both existing sim callers do.

### 10.5 The Director reads something presentation-side and the replay diverges

Caught only by the probe. **Which is why the probe is a shipping requirement and must run in CI, not by hand.** Design (A) also **forecloses a co-op campaign without rework**, stated as a cost rather than hidden.

### 10.6 The whole corpus lands in the entry chunk

`Systems.ts` globs eagerly from the entry, so this is a live defect from operation number one. Closed by §4.14 and G9 — **before operation one, not after.**

### 10.7 One generator change re-routes 37 operations at once

The terrain is not authorable; a chokepoint is *found*, not made. Bounded — not prevented — by the per-operation fingerprint. *UNDECIDED-9.*

### 10.8 The ten-hour claim is authored, not measured

37 × 17 min is a table, not a stopwatch. The par-first test makes the arithmetic honest and Gate M plus the Phase-5 re-derivation gate make it falsifiable, but until five operations are timed the number is a bet.

### 10.9 What is irreversible, and what is not

**Irreversible or expensive to reverse — decide with care:**
- The **naming decision**, once prose exists. Taken 2026-08-19 with no prose in the tree, which is why it cost 666 lines instead of 22,750 words (§2.5).
- **`PROFILE_VERSION` 3** — a migration written once, and a player's medals live in it.
- The **`types.ts` effect union freeze** — a twelfth effect after Phase 6 starts is a migration across 37 authored files.
- **`ReplayHeader.campaign`** — additive and version-safe, but once files exist in the wild the field's meaning is fixed.
- The **`suppressProgression` decision** — a campaign that shipped feeding nothing cannot start feeding later without a player's counters jumping.

**Cheap to reverse, so do not agonise:** operation count above the 36,000 s floor, `parSec` values, map seeds, `primaryType` assignments, the recommended play order, the achievement table, whether frozen-sector seats four.

### 10.10 The one nobody wants to say

**This is the first feature in this project that can make a shipped, correct game worse, and there is no test for it.**

Every gate in §8 answers "does it work". None answers "is it good". The repo's entire quality apparatus — the look bible's weighted scorecard, `tools/metrics.mjs`, `wiki-numbers.spec.ts`, `reward-wiring.spec.ts`, `content-truthful.spec.ts` — is built to catch **claims that stopped being true**, and it is superb at it. It cannot catch 37 competent, correct, tested, forgettable missions. A skirmish that is merely fine is a game working as designed; **a campaign that is merely fine is ten hours of a player's time that a review will describe accurately and unkindly, and it will be the first thing anyone says about VOLTMARCH.**

The mitigations are not technical. They are: **one author holds the register** (§2.4); **Gate M is played, not just passed** (§7); **the archetype triage is a content constraint, not just a cost model** — 12 operations whose drama is entirely in the starting force and the ground is a bet that the *simulation* is interesting, which is the bet this project has already won everywhere else; and **the author must be willing to cut to 8 per faction and say 8.7 hours** rather than pad to 10 with two operations nobody wanted to write. *UNDECIDED-10 option (c) exists for exactly that.*

---

## 11. WHERE THIS DOCUMENT LIVES, AND WHEN IT DIES

`docs/` holds durable data and decisions and **never plans**. Five plan documents were deleted this week with their measurements extracted first; `MEMORY.md` records the rule.

| Content | Home | Why |
|---|---|---|
| **§7 the build order, §9 the undecided list** | **The task list** (`TaskCreate`) — one parent task plus one per phase row | CLAUDE.md names it: *"the unexecuted design went to the task list, which is this repo's record-of-intent mechanism."* |
| **§2 the fiction** — setting, dossiers, hinge, timeline, coined-name register | **`docs/CAMPAIGN_CANON.md`** | Durable data. It is what the next author consults to check whether a new operation contradicts something. House style: assertions with provenance, overturned by rewriting rather than appending. **It must never contain a schedule, a phase list or a rollout. The moment it does, it is a plan and it should be deleted.** |
| **§4, §5 the arguments** | **File headers** — `types.ts` (the script-format defence), `campaign.system.ts` (determinism + phase placement), `campaign-install.ts` (the bundle boundary), `Campaign.ts` (the reward model + the seat rule), `campaign-store.ts` (storage) | This repo puts reasoning where the next reader hits it. `Missions.ts`, `UnlockGate.ts`, `tutorial-steps.ts` are the models. |
| **The design rationale, once shipped** | **`docs/MISSIONS_DESIGN.md`, rewritten in place** | It survived the purge by being relabelled *"the design rationale for code that exists."* The content-model row is edited there in Phase 0a with the argument beside it. |
| **Measurements that cost real time** | **`docs/CAMPAIGN_FINDINGS.md`, in `RENDER_FINDINGS.md`'s shape** — measured operation length, measured K, the 6,515 B/s audio-only rate and the 3,446 B header tax, the 5.59 B/word emitted ratio, the seed validation results. **Never a schedule.** | Overturn an entry by rewriting it, not by appending a contradiction. |
| **Player-facing** | `wiki/Campaign.md` **rewritten in place** (never renamed), plus optional `Lore.md` and `Commanders.md` | `wiki/` is a build input. |

> **DO NOT CREATE `docs/CAMPAIGN_PLAN.md`.**
>
> **DELETION CONDITION FOR THIS DOCUMENT: it is deleted the day Phase 6 completes.** By then §2 lives in `docs/CAMPAIGN_CANON.md`, §4–§5 live in file headers, §7 and §9 are closed tasks, and §6's measurements live in `docs/CAMPAIGN_FINDINGS.md`. Anything still only in here at that point was never durable and should not survive. If it is still on disk a release after the last operation ships, it has become the sixth plan document, and the person who notices should delete it without asking.