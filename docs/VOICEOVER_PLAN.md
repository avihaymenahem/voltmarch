# VOLTMARCH Voiceover Plan

Status: paused at Aircraft casting; campaign excluded from the active production round
Owner: game/audio
Last audited: 2026-08-26

This is the source of truth for recorded speech in VOLTMARCH. It tracks what
the game already ships, what is actually reachable in play, and what must be
finished before more voice generation is commissioned.

## Current inventory

- 33 recorded EVA/announcer lines, all present in the runtime manifest.
- 34 generic recorded unit-response clips plus 512 original takes: the complete
  four-faction armour slice, two infantry performers per faction, four harvesters,
  four construction vehicles, four faction specialists and four transport crews.
- 561 authored fallback bark lines across 39 unit voice classes after the
  Phase 1 faction/role routing pass.
- 37 campaign operations containing 648 text transmissions (about 23,500
  words) from 19 portrayed speakers. Campaign dialogue is not voiced yet.
- Voice subtitles, announcer speech, and unit-response frequency are now
  independently configurable and applied live.

The generic samples remain as category-level fallbacks for roles that do not yet
have dedicated packs. The completed armour, infantry and logistics sets prove the
generation, processing, provenance and runtime route across all four factions.

## Resume checkpoint — 2026-08-26

The non-campaign production round is intentionally paused here.

- Complete and integrated: `ARM`, `INF-A`, `INF-B`, `HARV`, `BUILD`, `SPEC`
  and `TRANS` for all four factions.
- Generated but not selected: the four `AIR` auditions under
  `C:/Users/Administrator/Downloads/Voltmarch/casting/{al,sv,mr,rc}-air`.
- Next owner input: choose candidate 1, 2 or 3 for Allied, Soviet, Meridian and
  Reclamation aircraft.
- After Aircraft: produce the four `NAV` packs, then the four `CMD` packs.
- Final step: consolidated subtitle, routing, duration, hash, provenance,
  documentation and full audio test gates.
- Campaign dialogue remains explicitly excluded.

## Phase tracker

### Phase 1 — make the existing system truthful and complete

- [x] Route unit identity from the real content key rather than faction plus
  broad entity flags.
- [x] Give Meridian Pact, Reclamation League, engineers, aircraft, naval units,
  harvesters, builders, transports, and commanders explicit voice classes.
- [x] Route meaningful order acknowledgements for deploy, capture, repair,
  patrol, scatter, transport entry/unload, harvesting, and abilities.
- [x] Connect the existing voice-subtitle setting to EVA and unit responses.
- [x] Add player-facing controls for announcer and unit-response frequency.
- [x] Connect every useful dormant EVA line to a real event; mark genuinely
  obsolete lines explicitly rather than pretending they are live.
- [x] Add regression tests for routing, settings migration, subtitles, and
  newly connected events.
- [x] Update the audio documentation with the runtime contract.

Exit condition: every existing recorded clip is either reachable through a
documented event or explicitly listed below as intentionally reserved, and a
player can independently control and caption announcer and unit speech.

### Phase 2 — faction and role voice packs

- [x] Define one coherent voice family per faction and define pronunciation,
  processing, pace, intensity, and accent guides before generating takes.
- [x] Split unit responses by role: line infantry, specialist/engineer,
  commander, armour, aircraft, naval, harvester, builder, and transport.
- [x] Write complete response matrices per role: select, move, attack, special
  order, damage, veterancy, cargo state, and rare contextual variants. Authored
  categories are not automatically live: runtime unit speech is restricted to
  selection and explicit player orders so simulation state cannot chatter.
- [x] Define the exact four-faction armour vertical slice and generation gates.
- [x] Generate a small representative pack for one role in each faction and
  review it in a noisy match before producing the remaining matrix.
- [x] Replace generic armour recordings only after transcript, loudness,
  duration, subtitle, provenance, and licence checks pass.

Exit condition: all four factions are recognisable by voice alone without
relying on colour, and no frequently heard category has fewer than three takes.

Phase 2 production references:

- [`voice/PHASE2_CASTING_BIBLE.md`](voice/PHASE2_CASTING_BIBLE.md) — stable
  voice IDs, faction direction, pronunciation, processing, delivery and review.
- [`voice/PHASE2_RESPONSE_MATRIX.md`](voice/PHASE2_RESPONSE_MATRIX.md) — every
  shipped unit mapped to a role, category quotas, runtime landing status, exact
  48-line vertical slice and expansion order.
- [`voice/PHASE2_LOGISTICS_PACKS.md`](voice/PHASE2_LOGISTICS_PACKS.md) — locked
  Harvester and Builder transcripts for all four factions, plus their runtime
  edge-event and production checklist.
- [`voice/PHASE2_SPECIALIST_PACKS.md`](voice/PHASE2_SPECIALIST_PACKS.md) — the
  four integrated engineer, Artificer and Tinker packs.
- [`voice/PHASE2_TRANSPORT_PACKS.md`](voice/PHASE2_TRANSPORT_PACKS.md) — locked
  carrier scripts and the current casting checkpoint.
- [`voice/generated/AL-ARM_v1.json`](voice/generated/AL-ARM_v1.json),
  [`voice/generated/SV-ARM_v1.json`](voice/generated/SV-ARM_v1.json),
  [`voice/generated/MR-ARM_v1.json`](voice/generated/MR-ARM_v1.json),
  [`voice/generated/RC-ARM_v1.json`](voice/generated/RC-ARM_v1.json),
  [`voice/generated/AL-INF-A_v1.json`](voice/generated/AL-INF-A_v1.json), and
  [`voice/generated/AL-INF-B_v1.json`](voice/generated/AL-INF-B_v1.json), and
  [`voice/generated/SV-INF-A_v1.json`](voice/generated/SV-INF-A_v1.json), and
  [`voice/generated/SV-INF-B_v1.json`](voice/generated/SV-INF-B_v1.json), and
  [`voice/generated/MR-INF-A_v1.json`](voice/generated/MR-INF-A_v1.json), and
  [`voice/generated/MR-INF-B_v1.json`](voice/generated/MR-INF-B_v1.json), and
  [`voice/generated/RC-INF-A_v1.json`](voice/generated/RC-INF-A_v1.json), and
  [`voice/generated/RC-INF-B_v1.json`](voice/generated/RC-INF-B_v1.json),
  [`voice/generated/AL-HARV_v1.json`](voice/generated/AL-HARV_v1.json),
  [`voice/generated/SV-HARV_v1.json`](voice/generated/SV-HARV_v1.json),
  [`voice/generated/MR-HARV_v1.json`](voice/generated/MR-HARV_v1.json),
  [`voice/generated/RC-HARV_v1.json`](voice/generated/RC-HARV_v1.json),
  [`voice/generated/AL-BUILD_v1.json`](voice/generated/AL-BUILD_v1.json),
  [`voice/generated/SV-BUILD_v1.json`](voice/generated/SV-BUILD_v1.json),
  [`voice/generated/MR-BUILD_v1.json`](voice/generated/MR-BUILD_v1.json),
  [`voice/generated/RC-BUILD_v1.json`](voice/generated/RC-BUILD_v1.json),
  [`voice/generated/AL-SPEC_v1.json`](voice/generated/AL-SPEC_v1.json),
  [`voice/generated/SV-SPEC_v1.json`](voice/generated/SV-SPEC_v1.json),
  [`voice/generated/MR-SPEC_v1.json`](voice/generated/MR-SPEC_v1.json), and
  [`voice/generated/RC-SPEC_v1.json`](voice/generated/RC-SPEC_v1.json) — exact
  transcripts, source and delivery hashes, provider disclosure and processing
  measurements for every integrated original unit pack.

The account permits ten saved custom voices. Once a completed pack's source WAVs,
delivery Oggs, prompts, selected audition and hashes are preserved, its provider
entry may be retired to make room for the next performer. This affects only the
provider's saved-voice slot; no shipped or source audio is deleted.

### Phase 3 — campaign performance

- [ ] Lock the campaign script before recording.
- [ ] Build a casting sheet for the 19 portrayed speakers and assign stable
  voice IDs, pronunciations, emotional ranges, and relationships.
- [ ] Record in operation-sized batches, beginning with one vertical slice.
- [ ] Add per-line timing metadata and preserve text-only playback as an
  accessibility and localisation fallback.
- [ ] Add campaign dialogue voice controls only when voiced dialogue exists.
- [ ] Update third-party notices and source/provenance records for every voice.

Exit condition: every authored transmission has a validated audio take or an
explicit text-only exception, and campaign playback survives missing or corrupt
assets without blocking a mission.

## Phase 1 EVA disposition

These nine lines existed as recorded assets but had no general gameplay route
at audit time. Phase 1 connected eight and deliberately reserved one:

| Line | Phase 1 disposition | Runtime route |
| --- | --- | --- |
| `cannotBuildHere` | Reserved | Waiting for placement to publish a reasoned rejection event. |
| `allyUnderAttack` | Connected | Non-local allied player's base-under-attack event. |
| `battleControlTerminated` | Connected | Queued after the match verdict. |
| `building` | Connected | Local structure production starts. |
| `repairing` | Connected | A successful local repair activation. |
| `primaryBuildingSelected` | Connected | A production structure becomes primary. |
| `newRallyPoint` | Connected | A production rally point is set. |
| `superweaponReady` | Connected | A local superweapon reaches full charge. |
| `nuclearMissileLaunched` | Connected | A nuclear strike is launched. |

`cannotBuildHere` must not be substituted for `cannotDeployHere`: those are
different failures and misleading audio is worse than silence. If the placement
layer cannot publish the distinction in Phase 1, the line remains documented as
reserved rather than being triggered speculatively.

The recorded generic `cargoFull` response is reserved. Its audio says
“Reloading,” which does not describe a harvester reaching capacity, so runtime
resolution explicitly refuses that take. All four faction harvesters now have
exact recorded cargo reports, but economy-state speech remains silent by default:
selection and explicit player orders are the only unit-speech triggers. The
recorded `capture` response is triggered when the local player successfully
captures a building.

## Runtime contract for new recordings

Every new voice asset must provide:

1. A stable semantic ID and exact transcript.
2. Speaker/faction/role and response category metadata.
3. A subtitle that exactly matches the audible take.
4. Duration, integrated loudness, true peak, and leading/trailing-silence data.
5. Source, generator/actor, model or recording-session identifier, licence, and
   generation date for the third-party notice trail.
6. A real runtime call site and a test proving the asset is reachable.
7. A fallback path when decoding or loading fails.

Voice generation should be done in small approved batches. A representative
take is evaluated in the actual battle mix before a full role pack is paid for.

## Campaign scale and production order

The campaign corpus is large enough to treat as a production project, not a
single generation job: about 175 minutes at 135 spoken words per minute before
pauses and performance direction. The highest-volume roles should be cast and
tested first because inconsistency there is the most expensive to repair:

1. Cregg
2. Vosk
3. Aubray
4. Calvane
5. Tallow
6. Wend
7. Nael

The first voiced vertical slice should contain briefing, in-mission radio,
urgent interruption, and debrief material so it validates every presentation
surface before broader generation begins.
