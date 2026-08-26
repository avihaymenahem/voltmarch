# VOLTMARCH Phase 2 Transport Voice Packs

Status: complete; runtime and provenance gated
Owner: game/audio
Last audited: 2026-08-26

These four packs cover troop carriers across all four factions. They respond
only to selection and explicit player orders. Loading completion and cargo
state remain silent; the player-issued unload order has its own acknowledgement.

Each pack contains 24 takes: four select, three move, three attack, two stop,
two guard, two patrol, three under-fire, two critical-damage and three unload.
Attack lines apply only to armed carriers; unarmed carriers never request them.

## `AL-TRANS` — Allied transport crew

| Category | Approved transcripts |
| --- | --- |
| `select` | Lift crew online. / Transport systems green. / Passenger deck ready. / Carrier standing by. |
| `move` | Plotting the crossing. / Transport moving. / Route to shore confirmed. |
| `attack` | Defensive weapons live. / Engaging from the carrier. / Covering the landing. |
| `stop` | Holding the transport. / Carrier stopped. |
| `guard` | Screening the formation. / Guard route accepted. |
| `patrol` | Beginning coastal patrol. / Running the patrol line. |
| `underFire` | Transport taking fire! / Passenger deck under attack! / We need escort now! |
| `criticalDamage` | Carrier integrity critical! / Transport is going down! |
| `unload` | Deploying the passengers. / Landing party away. / Clearing the passenger deck. |

Casting: Allied expeditionary loadmaster; clear, brisk and protective, with
technical confidence and no pilot or action-hero clichés.

## `SV-TRANS` — Soviet transport crew

| Category | Approved transcripts |
| --- | --- |
| `select` | Transport crew ready. / The troop deck is prepared. / Carrier awaiting orders. / We carry the advance. |
| `move` | Set course for the crossing. / Transport advancing. / Take us to the shore. |
| `attack` | Carrier guns engaging. / Protect the troop deck. / Fire across the landing. |
| `stop` | Holding the carrier. / Engines to idle. |
| `guard` | We screen the formation. / Guard course set. |
| `patrol` | Begin the water patrol. / We hold the crossing lane. |
| `underFire` | Transport under fire! / They are hitting the troop deck! / Escort the carrier! |
| `criticalDamage` | Carrier hull critical! / We will not stay afloat! |
| `unload` | Put the troops ashore. / Landing force away. / Clear the troop deck. |

Casting: Soviet assault-barge master; deliberate industrial authority, focused
on collective survival, never a theatrical naval captain.

## `MR-TRANS` — Meridian carrier navigator

| Category | Approved transcripts |
| --- | --- |
| `select` | Passage vessel aligned. / The passenger measure is ready. / Carrier attentive. / Embarkation systems balanced. |
| `move` | Course across the water. / Carrying the formation onward. / Approach to shore aligned. |
| `attack` | Defensive array committed. / Screening the passage. / Fire along the landing line. |
| `stop` | Holding the passage. / Carrier at rest. |
| `guard` | Maintaining the protective course. / Formation screen aligned. |
| `patrol` | Beginning the horizon circuit. / Holding the patrol measure. |
| `underFire` | Passage vessel under fire! / The passenger deck is exposed! / We require an escort! |
| `criticalDamage` | Carrier balance critical! / The passage vessel is failing! |
| `unload` | Releasing the landing group. / Passage complete, deploy. / Clearing the passenger measure. |

Casting: Meridian watch officer and custodian; measured, warm and exact, formal
without mysticism or synthetic calm.

## `RC-TRANS` — Reclamation hauler crew

| Category | Approved transcripts |
| --- | --- |
| `select` | Hauler crew checked in. / Passenger rack ready. / The lift rig is running. / Show us the next crossing. |
| `move` | Hauling for the far bank. / Carrier moving. / Taking the wet road. |
| `attack` | Deck gun on the job. / Cover the unloading side. / Firing across the beach. |
| `stop` | Parking the hauler. / Carrier holding. |
| `guard` | Keeping the convoy covered. / Guarding the loaded rig. |
| `patrol` | Working the water line. / Running the crossing route. |
| `underFire` | Hauler taking hits! / They're tearing up the passenger rack! / Need cover on the carrier! |
| `criticalDamage` | Lift rig critical! / We're losing the whole hauler! |
| `unload` | Get the crew off the rack. / Dropping the landing party. / Empty the carrier, now. |

Casting: seasoned Reclamation workboat operator; clipped, practical and
protective, with dry confidence and no pirate or comic-trucker performance.

## Production checklist

- [x] `AL-TRANS` — candidate 2, voice `oAfbu7R1tAjeYwX48wGh`
- [x] `SV-TRANS` — candidate 2, voice `YUJe4GNA3qIat6BLJTvQ`
- [x] `MR-TRANS` — candidate 2, voice `my89qXcGRg549bfaYeob`
- [x] `RC-TRANS` — candidate 1, voice `twmU7x0N00CcI5Ompbpw`

For each pack: select one audition, lock provider metadata, generate one exact
`wav_48000` take per transcript, process through `prepare-voice-pack.py`, register
the runtime manifest, and pass subtitle, duration, hash and routing contracts.
