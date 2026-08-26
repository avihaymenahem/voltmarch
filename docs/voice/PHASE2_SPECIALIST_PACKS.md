# VOLTMARCH Phase 2 Specialist Voice Packs

Status: complete; runtime and provenance gated
Owner: game/audio
Last audited: 2026-08-26

These four packs cover engineers, Artificers and Tinkers. Speech is triggered
only by selection or explicit player orders. Capture and repair acknowledgements
confirm intent, not success; EVA owns the successful-building announcement.

Each pack contains 20 takes: four select, three move, two stop, three under-fire,
two critical-damage, three capture and three repair responses.

## `AL-SPEC` — Allied Engineer

| Category | Approved transcripts |
| --- | --- |
| `select` | Engineer on station. / Field kit ready. / Systems specialist here. / Site diagnostics online. |
| `move` | Moving to inspect. / Route to site confirmed. / Engineer en route. |
| `stop` | Holding for instructions. / Field kit standing by. |
| `underFire` | Engineer taking fire! / Site team under attack! / I need security here! |
| `criticalDamage` | Field suit critical! / Engineer is going down! |
| `capture` | Securing the structure. / Taking control of the site. / Beginning systems takeover. |
| `repair` | Starting field repairs. / Restoring the system. / Repair protocol active. |

Casting: contemporary expeditionary systems engineer; quick, exact and calm,
with urgency grounded in procedure rather than action-hero bravado.

## `SV-SPEC` — Soviet Engineer

| Category | Approved transcripts |
| --- | --- |
| `select` | Field engineer ready. / Tools prepared. / Technical crew standing by. / The work can begin. |
| `move` | Take me to the site. / Engineer advancing. / Moving with the tools. |
| `stop` | Holding position. / Tools remain ready. |
| `underFire` | Engineer under fire! / They are hitting the technical crew! / Protect the specialist! |
| `criticalDamage` | Field equipment critical! / I will not hold much longer! |
| `capture` | Taking the structure for us. / Their systems will answer to us. / Beginning the takeover. |
| `repair` | Restoring the machinery. / Begin field repair. / The system will run again. |

Casting: experienced Soviet field technician; economical, collective and
physically grounded, with restrained Eastern European colour and no parody.

## `MR-SPEC` — Meridian Artificer

| Category | Approved transcripts |
| --- | --- |
| `select` | Artificer attentive. / Instruments aligned. / Restoration kit prepared. / The site can be measured. |
| `move` | Course to the work. / Approaching the site. / Instruments in motion. |
| `stop` | Holding the measure. / Artificer at rest. |
| `underFire` | Artificer under fire! / The instrument team is exposed! / We require a screen! |
| `criticalDamage` | Instrument integrity critical! / My field rig is failing! |
| `capture` | Rewriting the site alignment. / Bringing the structure into accord. / The new control pattern begins. |
| `repair` | Restoring structural balance. / Beginning the repair measure. / The system returns to alignment. |

Casting: patient Meridian craftsperson; educated and precise, luminous but
operational, never mystical, breathy or synthetic.

## `RC-SPEC` — Reclamation Tinker

| Category | Approved transcripts |
| --- | --- |
| `select` | Tinker checked in. / Tools are live. / Patch kit ready. / Show me what broke. |
| `move` | Heading to the job. / Taking the tool road. / Tinker moving. |
| `stop` | Setting the kit down. / Holding for the next job. |
| `underFire` | Tinker taking hits! / They're shooting up the tools! / Need cover on this job! |
| `criticalDamage` | Patch rig critical! / I'm losing the whole kit! |
| `capture` | Taking their controls apart. / This site works for us now. / Cutting into the control box. |
| `repair` | Patching the frame. / Putting the machine back together. / Give me a moment with it. |

Casting: competent salvage technician with dry confidence and controlled grit;
never a comic mechanic, pirate or feral scavenger.

## Production checklist

- [x] `AL-SPEC` — candidate 1, voice `bH9xAZrOURm8vX0Cin4q`
- [x] `SV-SPEC` — candidate 3, voice `w3tQTg1fMb132sKWlppW`
- [x] `MR-SPEC` — candidate 1, voice `uWCJB4cZr2qmoSriVFSP`
- [x] `RC-SPEC` — candidate 2, voice `8t91ZRcCsF2NyYBUV5bl`

For each pack: select one audition, lock provider metadata, generate one exact
`wav_48000` take per transcript, process through `prepare-voice-pack.py`, register
the runtime manifest, and pass subtitle, duration, hash and routing contracts.
