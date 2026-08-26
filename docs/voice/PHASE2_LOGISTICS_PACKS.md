# VOLTMARCH Phase 2 Logistics Voice Packs

Status: complete — four faction harvesters and four faction builders integrated
Owner: game/audio
Last audited: 2026-08-26

These are the production transcripts for the four `HARV` and four `BUILD`
packs. A line may be generated only after its semantic category exists in the
runtime. Transcripts are exact subtitle text: generation direction must never
be baked into the spoken words.

## Runtime event and playback contract

- `harvest` fires when the harvester FSM enters extraction.
- `cargoFull` fires on the tick cargo reaches capacity.
- `returnToRefinery` fires when a valid refinery route is committed.
- All three remain presentation events outside replay and lockstep commands,
  available for telemetry, captions or a future opt-in chatter mode.
- They do **not** trigger unit speech automatically. A normal economy cycle has
  no player intent and several harvesters made these lines recur indefinitely.
- Unit speech is player-driven: selection and explicit orders only. A direct
  harvest order uses `harvest`; `cargoFull` and `returnToRefinery` are reserved
  recordings rather than unsolicited status reports.
- `deploy` is the player's builder deployment order.
- `stop`, `underFire`, and `criticalDamage` use their dedicated bark categories.
- No state event may fire continuously while the unit remains in that state.

The legacy generic `cargoFull` recording says “Reloading.” It is intentionally
blocked in `Barks.ts`; the synthetic exact transcript remains active until a
faction's dedicated pack is integrated.

## `AL-HARV` — Allied Ore Harvester

| Category | Approved transcripts |
| --- | --- |
| `select` | Allied ore crew ready. / Collector systems green. / Hauler standing by. |
| `move` | Rolling to the field. / Route to ore locked. / Hauler moving. |
| `stop` | Parking the rig. / Ore crew holding. |
| `underFire` | Hauler taking fire! / Ore truck under attack! / We need an escort! |
| `criticalDamage` | Hopper rig critical! / We're losing the hauler! |
| `harvest` | Starting extraction. / Ore intake active. / Working this deposit. |
| `cargoFull` | Hopper full. / Cargo at capacity. / Full load secured. |
| `returnToRefinery` | Returning to refinery. / Hauling the load home. / Route to the refinery. |

Casting: clean contemporary expeditionary logistics operator; calm technical
reports, disciplined urgency, never a comic trucker.

## `SV-HARV` — Soviet Ore Harvester

| Category | Approved transcripts |
| --- | --- |
| `select` | Ore crew standing by. / Hauler ready for work. / Hopper is empty. |
| `move` | Wheels to the field. / Taking the ore road. / We haul. |
| `stop` | Brakes set. / Holding the hauler. |
| `underFire` | Ore truck under fire! / They are hitting the hauler! / Escort, close on us! |
| `criticalDamage` | Hauler is critical! / The rig will not hold! |
| `harvest` | Cutting into the seam. / Ore intake running. / Begin the load. |
| `cargoFull` | Hopper is full. / Full Soviet load. / Cargo secured. |
| `returnToRefinery` | Returning with ore. / Take the load home. / Refinery route set. |

Casting: experienced industrial operator, low and dependable; urgency shortens
the pauses rather than becoming parody.

## `MR-HARV` — Meridian Sun Collector

| Category | Approved transcripts |
| --- | --- |
| `select` | Sun Collector aligned. / Reservoir ready. / Collection crew attentive. |
| `move` | Course to the seam. / Collector in motion. / We follow the deposit. |
| `stop` | Holding alignment. / Collector at rest. |
| `underFire` | Collector under fire! / Our reservoir is exposed! / We require a screen! |
| `criticalDamage` | Collector integrity critical! / The reservoir is failing! |
| `harvest` | Drawing from the seam. / Collection cycle active. / The deposit yields. |
| `cargoFull` | Reservoir at capacity. / Full measure secured. / Collection complete. |
| `returnToRefinery` | Returning to the receiver. / Carrying the measure home. / Receiver course aligned. |

Casting: measured custodian of energy and material, luminous but operational;
no mystic whisper or synthetic-assistant delivery.

## `RC-HARV` — Reclamation Scrapjaw

| Category | Approved transcripts |
| --- | --- |
| `select` | Scrapjaw crew ready. / Crusher checked. / Empty jaw, ready to work. |
| `move` | Rolling to the cut. / Taking the salvage road. / Jaw on the move. |
| `stop` | Setting the brakes. / Holding the rig. |
| `underFire` | Scrapjaw taking hits! / They're punching through the rig! / Need cover on the hauler! |
| `criticalDamage` | Crusher frame critical! / We're shedding the rig! |
| `harvest` | Biting into the seam. / Crusher running. / Pulling value out. |
| `cargoFull` | Jaw is full. / Full load strapped. / Hopper packed tight. |
| `returnToRefinery` | Taking the load back. / Sorter route marked. / Hauling value home. |

Casting: practical salvage-machine operator with controlled grit; competent,
dry and physical, never pirate or scavenger caricature.

## `AL-BUILD` — Allied Construction Vehicle

| Category | Approved transcripts |
| --- | --- |
| `select` | Construction vehicle online. / Site crew ready. / Survey systems green. |
| `move` | Moving to the site. / Construction route locked. / Rolling on your mark. |
| `stop` | Site vehicle holding. / Parking the construction rig. |
| `underFire` | Construction vehicle taking fire! / Site crew under attack! / We need protection! |
| `criticalDamage` | Construction rig critical! / We're losing the site vehicle! |
| `deploy` | Establishing construction yard. / Deploying the site package. / Building the command site. |

## `SV-BUILD` — Soviet Construction Vehicle

| Category | Approved transcripts |
| --- | --- |
| `select` | Construction column ready. / Builder crew standing by. / Heavy rig prepared. |
| `move` | Take us to the site. / Builder rolling. / Advance the construction rig. |
| `stop` | Brakes set. / Builder holding. |
| `underFire` | Builder under fire! / They are striking the construction rig! / Protect the crew! |
| `criticalDamage` | Construction rig critical! / The builder will not hold! |
| `deploy` | Raise the construction yard. / Unfold the works. / Establish the base. |

## `MR-BUILD` — Pactworks Carryall

| Category | Approved transcripts |
| --- | --- |
| `select` | Pactworks Carryall aligned. / Foundation crew attentive. / Site instruments ready. |
| `move` | Course to the foundation. / Carryall in motion. / We approach the site. |
| `stop` | Holding site alignment. / Carryall at rest. |
| `underFire` | Carryall under fire! / The foundation package is exposed! / We require protection! |
| `criticalDamage` | Carryall integrity critical! / The site package is failing! |
| `deploy` | Establishing the Conclave. / Unfold the foundation. / The new site begins. |

## `RC-BUILD` — Reclamation Yardcrawler

| Category | Approved transcripts |
| --- | --- |
| `select` | Yardcrawler checked in. / Foundry crew ready. / Mobile yard fired up. |
| `move` | Crawling to the lot. / Taking the yard road. / Hauling the works over. |
| `stop` | Setting the crawler down. / Yard rig holding. |
| `underFire` | Yardcrawler taking hits! / They're tearing into the works! / Need cover on the crawler! |
| `criticalDamage` | Yard frame critical! / We're losing the crawler! |
| `deploy` | Setting up the Foundry. / Drop the braces and build. / Turning this lot into a yard. |

## Production checklist

- [x] `AL-HARV` — candidate 1 selected; 22 takes generated, processed, provenance-locked and integrated.
- [x] `SV-HARV` — candidate 3 selected; 22 takes generated, processed, provenance-locked and integrated.
- [x] `MR-HARV` — candidate 3 selected; 22 takes generated, processed, provenance-locked and integrated.
- [x] `RC-HARV` — candidate 2 selected; 22 takes generated, processed, provenance-locked and integrated.
- [x] `AL-BUILD` — candidate 3 selected; 16 takes generated, processed, provenance-locked and integrated.
- [x] `SV-BUILD` — candidate 2 selected; 16 takes generated, processed, provenance-locked and integrated.
- [x] `MR-BUILD` — candidate 2 selected; 16 takes generated, processed, provenance-locked and integrated.
- [x] `RC-BUILD` — candidate 3 selected; 16 takes generated, processed, provenance-locked and integrated.

For each pack: select one audition, lock provider metadata, generate dry
`wav_48000`, process through `prepare-voice-pack.py`, register the exact manifest
keys, test subtitle/audio agreement, and listen in a real economy cycle.
