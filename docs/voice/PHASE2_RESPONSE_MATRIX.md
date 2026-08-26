# VOLTMARCH Phase 2 Response Matrix

Status: armour, infantry, logistics, specialist and transport packs integrated; Aircraft casting paused
Owner: game/audio
Last audited: 2026-08-26

This is the production map for unit speech. It separates semantic events from
spoken wording so a line is never generated without an event that can actually
play it.

## Shipped roster to voice-role map

| Faction | Line infantry (`INF`) | Specialist (`SPEC`) | Commander (`CMD`) |
| --- | --- | --- | --- |
| Allies | G.I., Javelin, Frogman | Engineer | Field Marshal |
| Soviets | Conscript, Flak Trooper, Naval Infantry | Engineer | War Commissar |
| Meridian | Wayfarer, Sunlancer, Tidewalker | Artificer | Hierarch |
| Reclamation | Scrap Picker, Slagger, Dredger | Tinker | Scrap Baron |

| Faction | Armour (`ARM`) | Aircraft (`AIR`) | Naval combat (`NAV`) |
| --- | --- | --- | --- |
| Allies | Warden, Sabre, Refractor | Petrel | Hydrofoil, Assault Destroyer, Aircraft Cruiser |
| Soviets | Anvil, Sledge, V4 | Interceptor | Picket Boat, Attack Submarine, Dreadnought |
| Meridian | Sandskiff, Solarch, Zenith | Kestrel | Sun Cutter, Kite Corvette, Sunmonitor |
| Reclamation | Arcspitter, Grinder, Slaghurler | Swarmhornet | Scrap Skimmer, armed Slag Scow, Reclaimed Hulk |

| Faction | Harvester (`HARV`) | Builder (`BUILD`) | Transport (`TRANS`) |
| --- | --- | --- | --- |
| Allies | Ore Harvester | Construction Vehicle | Landing Craft, Heavy Transport |
| Soviets | Ore Harvester | Construction Vehicle | Assault Barge, Heavy Transport |
| Meridian | Sun Collector | Pactworks Carryall | Sandskiff, Sun Lighter, Argosy |
| Reclamation | Scrapjaw | Yardcrawler | Slag Scow, Slag Hauler |

The Sandskiff and Slag Scow use `ARM`/`NAV` for combat and `TRANS` for cargo
events. One entity can therefore use two role packs without inventing a hybrid
performer.

The Attack Dog is deliberately absent: it needs nonverbal animal responses,
not a human bark hidden inside the dog. That is an SFX expansion, not casting.

## Semantic category matrix

Counts are the minimum approved takes per voice ID before a pack is complete.
`—` means the event does not apply. A number in parentheses is deliberately
rare and must have a long cooldown.

| Category | INF | SPEC | CMD | ARM | AIR | NAV | HARV | BUILD | TRANS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `select` | 4 | 4 | 5 | 4 | 4 | 4 | 3 | 3 | 3 |
| `move` | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 3 | 3 |
| `attack` | 4 | — | 4 | 4 | 4 | 4 | — | — | 3 if armed |
| `attack_move` | 3 | 2 | 3 | 3 | 3 | 3 | — | — | 2 if armed |
| `stop` | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| `guard` | 2 | 2 | 3 | 2 | 2 | 2 | — | — | 3 |
| `patrol` | 2 | 2 | 2 | 2 | 2 | 3 | — | — | 2 |
| `scatter` | 2 | 2 | 2 | 2 | 2 | 2 | — | — | — |
| `under_fire` | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `critical_damage` | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| `veterancy` | 2 | — | — | 2 | 2 | 2 | — | — | — |
| `ability` | — | — | 4 | unit-specific | unit-specific | unit-specific | — | `deploy` | `unload` |
| `capture` | — | 3 | — | — | — | — | — | — | — |
| `repair` | — | 3 | — | — | — | — | — | — | — |
| `harvest` | — | — | — | — | — | — | 3 | — | — |
| `cargo_full` | — | — | — | — | — | — | 3 | — | 2 |
| `return_to_refinery` | — | — | — | — | — | — | 3 | — | — |
| `deploy` | 2 where valid | — | 2 | 2 where valid | — | — | — | 3 | 2 |
| `enter_transport` | 2 | 2 | 2 | 2 | — | — | — | — | — |
| `load` / `unload` | — | — | — | — | — | — | — | — | 3 each |
| `rare_idle` | (2) | (2) | (2) | (2) | (2) | (2) | (2) | (2) | (2) |

At full scope this is a production ceiling, not a command to generate every
cell at once. Each role ships category by category after its runtime event and
mix review exist.

## Runtime landing status

`BarkDirector` now has semantic destinations for tactical orders, repair,
abilities, transport intent, critical damage, veterancy, and harvester state.
Unrecorded categories deliberately fall back to truthful broad responses.
Harvester extraction, capacity, and refinery-return cues are edge-triggered by
the simulation and never emitted as per-tick streams.

Still missing at runtime: transport load/unload *completion* events and rare
idle responses with a separate long-cooldown scheduler. Player order intent for
both already has a semantic destination.

The existing recorded `cargoFull` file says “Reloading.” It remains disabled
and must never be relabelled. The first real cargo line is generated from this
matrix with an exact matching transcript.

The locked logistics scripts and production checklist live in
`PHASE2_LOGISTICS_PACKS.md`.

## Writing rules by category

- `select`: identity or readiness, never an order the player did not give.
- `move`: confirm motion or course; do not imply an attack.
- `attack`: confirm target engagement; do not announce a kill in advance.
- `attack_move`: communicate advancing contact, distinct from direct fire.
- `stop` / `guard`: confirm state, not success.
- `under_fire`: urgent condition report, no melodramatic death prediction.
- `critical_damage`: unmistakably more severe than ordinary fire.
- `veterancy`: earned competence, not a fourth-wall level-up announcement.
- `ability`: say what the unit is committing, not the keyboard shortcut.
- Logistics: state cargo and route truthfully. Never say “full” before the sim
  reaches capacity or “returning” before the return state begins.
- Rare idle: character colour only. Never critical gameplay information.

## First vertical slice — armour

The first paid batch is 48 files: four factions × four live categories × three
takes. It uses `ARM` because every faction has a frequently selected line hull,
all four runtime events already exist, and the voices can be compared in the
same combat situation.

Production status:

- [x] `AL-ARM` — generated, processed, provenance-locked and integrated.
- [x] `SV-ARM` — generated, processed, provenance-locked and integrated.
- [x] `MR-ARM` — generated, processed, provenance-locked and integrated.
- [x] `RC-ARM` — generated, processed, provenance-locked and integrated.

### `AL-ARM`

| Category | Take 1 | Take 2 | Take 3 |
| --- | --- | --- | --- |
| select | Armour crew online. | Armour ready. | Systems green. |
| move | Rolling on your mark. | Route locked. | Armour moving. |
| attack | Target solution confirmed. | Engage the target. | Precision fire. |
| under_fire | Taking armour hits! | Hull breach warning! | We need a screen! |

### `SV-ARM`

| Category | Take 1 | Take 2 | Take 3 |
| --- | --- | --- | --- |
| select | Heavy armour ready. | Steel standing by. | Engines awake. |
| move | Advance the line. | Treads forward. | We move. |
| attack | Load for battle. | Break their line. | Weapons, fire! |
| under_fire | Armour holding! | Taking heavy fire! | Comrade, support the advance! |

### `MR-ARM`

| Category | Take 1 | Take 2 | Take 3 |
| --- | --- | --- | --- |
| select | Pact hull aligned. | Hull in balance. | Weapon array ready. |
| move | Course accepted. | Gliding to station. | We follow the light. |
| attack | Mark the distant target. | Weapon array committed. | Solution held. |
| under_fire | Shield skin failing! | They have closed the distance! | Reform the line! |

### `RC-ARM`

| Category | Take 1 | Take 2 | Take 3 |
| --- | --- | --- | --- |
| select | Line rig fired up. | Crew and weapon ready. | Point us at the work. |
| move | Tracks turning. | Taking the short way. | Closing the gap. |
| attack | Break them down. | Weapon live, face the target. | Strip it to frame. |
| under_fire | Plate coming loose! | We are taking it hard! | Welders, stand by! |

## Vertical-slice generation constraints

- Generate one take at a time while establishing a voice; do not pay for all 12
  until selection take 1 passes the casting rubric.
- Lock provider voice ID, model, seed (when supported), stability, style, and
  similarity settings in the provenance sidecar before take 2.
- No prompt may request a named actor, public figure, or existing game
  character.
- Generate dry mono speech. The VOLTMARCH pipeline owns loudness, trimming,
  radio treatment, encoding, manifests, and subtitles.
- Reject any take that changes a word, adds breathy lead-in longer than 70 ms,
  clips a transient, or makes the faction less identifiable than the fallback.
- Integrate only one faction pack first, verify fallback and shuffle behaviour,
  then land the other three through the same path.

## Expansion order after the slice

1. Finish `ARM` core and intent categories for all factions.
2. `INF-A` and `INF-B`, because infantry generate the most repeated speech.
3. `HARV` and `BUILD`, because their stateful lines carry useful information.
4. `SPEC` and `TRANS`, after capture/repair/cargo events are distinct.
5. `AIR` and `NAV`, validated on maps that actually exercise them.
6. `CMD`, only after each ability has its own semantic event.
7. Rare idle lines last; they add flavour but no tactical information.

### Infantry production status

- [x] `AL-INF-A` — 17 core takes generated, processed, provenance-locked and integrated.
- [x] `AL-INF-B` — 17 core takes API-generated, processed, provenance-locked and integrated.
- [x] `SV-INF-A` — candidate 2 selected; 17 core takes API-generated, processed, provenance-locked and integrated.
- [x] `SV-INF-B` — candidate 2 selected; 17 core takes API-generated, processed, provenance-locked and integrated.
- [x] `MR-INF-A` — candidate 2 selected; 17 core takes API-generated, processed, provenance-locked and integrated.
- [x] `MR-INF-B` — candidate 3 selected; 17 core takes API-generated, processed, provenance-locked and integrated.
- [x] `RC-INF-A` — candidate 3 selected; 17 core takes API-generated, processed, provenance-locked and integrated.
- [x] `RC-INF-B` — candidate 1 selected; 17 core takes API-generated, processed, provenance-locked and integrated.

## ElevenLabs cost estimate

Pricing snapshot: 2026-08-25. ElevenLabs currently lists API TTS at **$0.10
per 1,000 characters** for Multilingual v2 / v3 and **$0.05 per 1,000
characters** for Flash / Turbo, before tax. Commercial use requires a paid
plan; the current Starter entry point is about **$6/month**. Voice Library
voices with a legacy custom-rate multiplier can cost more, so the production
voices must be checked for a multiplier before they are locked.

Official references:

- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api?price.platform=api)
- [ElevenLabs TTS model guide](https://elevenlabs.io/docs/eleven-api/choosing-the-right-model)
- [Voice Library credit multipliers](https://elevenlabs.io/docs/help-center/product/voices/voice-library/what-are-custom-rates-and-credit-multipliers)

### The 48-file armour slice

The exact transcripts above contain **879 characters** across 48 files.

| Work | Estimated billable characters | v3 / Multilingual v2 | Flash / Turbo |
| --- | ---: | ---: | ---: |
| One perfect pass | 879 | $0.09 | $0.04 |
| Four voice auditions | 300-600 | $0.03-$0.06 | $0.02-$0.03 |
| Direction tags and controlled retries | 1,300-3,500 | $0.13-$0.35 | $0.07-$0.18 |
| **Realistic slice total** | **2,500-5,000** | **$0.25-$0.50** | **$0.13-$0.25** |

The practical minimum is therefore the paid-plan floor, roughly **$6 plus
tax**, not the metered generation cost. The slice fits easily inside that
allowance. ElevenLabs currently allows up to two free regenerations when text
and parameters are unchanged; a changed setting, prompt, voice, or transcript
is a new paid generation and is included in the retry range above.

### Full Phase 2 faction packs

The completed role matrix represents roughly **1,250-1,300 clips**. At an
expected 18-28 characters per short bark, the clean script is approximately
**23,000-36,000 characters**. Auditions, direction tags, rejected reads and
changed-setting retries bring the useful production budget to about
**60,000-100,000 billable characters**.

| Scope | v3 / Multilingual v2 | Flash / Turbo | Sensible plan |
| --- | ---: | ---: | --- |
| Clean single pass | $2.30-$3.60 | $1.15-$1.80 | Starter can cover the generation volume |
| Realistic reviewed production | $6-$10 | $3-$5 | Creator is safer for iterative casting |
| With a 2× custom voice multiplier | $12-$20 | $6-$10 | Avoid the multiplier unless the voice is irreplaceable |

Recommendation: use **v3 for the four-faction slice** because identifying
performance is the point of the test. If v3 wins clearly, keep it for high-
character roles and commanders. If the difference disappears under the battle
mix, use Flash for routine movement/selection volume and reserve v3 for damage,
abilities and commanders. Do not buy Pro for Phase 2 volume alone.

### Not included: campaign dialogue

Phase 3's approximately 23,500 written words are on another scale: roughly
140,000-165,000 characters before direction tags. A clean v3 pass is about
$14-$17 by API meter; a properly reviewed production with character auditions
and retakes should reserve **$40-$85**, or more if custom-rate voices are used.
That campaign budget must not be mixed into the unit-pack approval.
