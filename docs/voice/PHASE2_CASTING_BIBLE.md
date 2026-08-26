# VOLTMARCH Phase 2 Voice Casting Bible

Status: generation-ready specification
Owner: game/audio
Last audited: 2026-08-25

This document defines the sound of the four playable armies before a voice is
generated or recorded. It is a casting brief, not a request for broad accents.
Performances must communicate doctrine, hierarchy, and working environment
without impersonating a real person or turning a culture into a joke.

## Shared performance contract

- Language: international English.
- Perspective: the speaker is inside the world, never narrating a videogame.
- Length: routine acknowledgements should finish in 0.7-1.6 seconds; urgent
  lines may reach 2.1 seconds.
- Delivery: begin on the first useful consonant. No greetings, throat clearing,
  dramatic inhalation, ad-libs, or appended callsigns.
- Intensity: selection 2/5, movement 3/5, attack 4/5, damage 5/5. Do not shout
  every line; contrast is what makes danger audible.
- Exactness: perform the supplied transcript verbatim. A changed word creates
  a subtitle and localisation defect.
- Restrictions: no celebrity imitation, recognisable franchise imitation,
  comedy accent, profanity, contemporary military unit name, music, ambience,
  weapon sound, reverb, or baked radio static.
- Squad rule: one response represents the selected group. Never perform a
  chorus or stack multiple voices into one file.

## Stable voice IDs

Every generated take is assigned one of these IDs. Provider voice IDs are
metadata attached to them and may change; these game IDs must not.

| Suffix | Role | Roster responsibility |
| --- | --- | --- |
| `INF-A`, `INF-B` | Line infantry | Rifle, anti-armour, amphibious infantry |
| `SPEC` | Specialist | Engineer, Artificer, Tinker |
| `CMD` | Commander | Field Marshal, Commissar, Hierarch, Scrap Baron |
| `ARM` | Armour | Raider, line tank, artillery or siege vehicle |
| `AIR` | Aircraft | Bomber, interceptor, gunship, lifting-body attacker |
| `NAV` | Naval combat | Scout, escort and capital combat hulls |
| `HARV` | Harvester | Ore Harvester, Sun Collector, Scrapjaw |
| `BUILD` | Builder | Construction Vehicle, Carryall, Yardcrawler |
| `TRANS` | Transport | Every four- or eight-slot carrier |

The prefix is `AL` (Allied), `SV` (Soviet), `MR` (Meridian), or `RC`
(Reclamation). Examples: `AL-ARM`, `MR-SPEC`, `RC-TRANS`.

`INF-A` and `INF-B` are two compatible performers or clearly different voice
variants. The engine alternates them within squads. The other roles use one
lead voice in the first production pass; variants can be added only after the
core matrix is complete.

## Allied Forces — precision under pressure

**Family:** clear, contemporary expeditionary professionals. Neutral
international English with crisp consonants and light contractions. Confidence
comes from preparation, not swagger.

**Pace:** 155-175 spoken words per minute. Orders are acknowledged quickly,
with a slight upward pickup at the start and a clean stop.

**Texture:** cleanest signal of the four. Minimal saturation, narrow cockpit or
helmet filtering for aircraft and armour, almost no audible room.

**Direction by role:**

- Infantry: alert, mobile, mutually protective. Never action-movie bravado.
- Specialist: practical engineer; sees a site as a solvable system.
- Commander: calm operational authority, decisive without grandstanding.
- Armour: crew chief reading instruments and fire-control solutions.
- Aircraft: fastest cadence, disciplined brevity, no pilot clichés.
- Naval: composed bridge officer, wider pauses than aircraft.
- Logistics: capable operators who understand they are priority targets.

**Forbidden read:** aristocratic, superheroic, sarcastic, or sterile synthetic
assistant.

## Soviet Union — weight and collective resolve

**Family:** low, deliberate industrial-military voices. A restrained Eastern
European colour is acceptable when natural to the performer; exaggerated
rolled consonants and parody pronunciation are not.

**Pace:** 125-150 spoken words per minute. Let nouns carry weight. Urgency
shortens the pauses rather than raising every pitch.

**Texture:** heavier midrange, mild transmitter compression, audible machinery
bleed only in the in-engine bus—not in source masters.

**Direction by role:**

- Infantry: collective confidence; “we” is more common than “I.”
- Specialist: experienced field technician, economical and unsentimental.
- Commander: ideological certainty held under control.
- Armour: the hull is a moving fortification; measured, physically grounded.
- Aircraft: terse interception language with less ceremony than ground crews.
- Naval: deep bridge authority; never a theatrical submarine captain.
- Logistics: overworked but dependable, never comic relief.

**Forbidden read:** cartoon villain, drunkenness, fatalistic comedy, or slogans
copied from another franchise.

## Meridian Pact — ceremonial precision

**Family:** measured, educated, luminous rather than mystical. Carefully formed
vowels, soft starts, and deliberate stress on operational nouns. The Pact treats
war as ordered work with ritual discipline, not fantasy spellcasting.

**Pace:** 135-155 spoken words per minute. Smooth legato phrasing, then a firm
final consonant. Damage lines break that composure.

**Texture:** open upper midrange, very light harmonic sheen, the least low-end
machinery. Hover and solar sounds remain separate effects.

**Direction by role:**

- Infantry: observant, restrained, aware of distance and formation.
- Specialist: patient craftsperson, precise about restoration and capture.
- Commander: ceremonial authority with no whispering mysticism.
- Armour: navigator/fire-control operator speaking in course and alignment.
- Aircraft: fluid and fast, but never casual.
- Naval: formal watch officer; horizon and bearing language fits naturally.
- Logistics: custodians of energy and material, not civilian truck drivers.

**Forbidden read:** cultist whisper, generic fantasy priest, robotic monotone,
or vague pseudo-spiritual improvisation.

## The Reclamation — working violence

**Family:** workshop crews who turned salvage into an army. Textured, direct,
and practical, with varied natural regional colour rather than one prescribed
accent. Humour may be dry, never broad.

**Pace:** 145-170 spoken words per minute. Lines should feel spoken over active
tools: clipped setup, strong operative verb, rough stop.

**Texture:** strongest radio abrasion of the four, controlled upper-mid grit,
occasional breath effort. Do not bake distortion into the source master.

**Direction by role:**

- Infantry: numerous, close-range, impatient to get to work.
- Specialist: improviser who trusts tools more than doctrine.
- Commander: scrapyard proprietor and battlefield organiser, not a pirate.
- Armour: driver/gunner crew wrestling a fixed weapon onto target.
- Aircraft: unstable machine, fully competent operator.
- Naval: workboat and salvage-ship cadence, grounded rather than nautical camp.
- Logistics: knows the value and condition of everything being carried.

**Forbidden read:** pirate, scavenger caricature, manic laughter, stupidity, or
constant jokes about rubbish.

## Pronunciation ledger

The first approved take for each term becomes the reference clip. Keep stressed
syllables consistent across all speakers.

| Term | Direction |
| --- | --- |
| G.I. | “gee-eye” |
| Warden | `WAR-dən` |
| Sabre | `SAY-bər` |
| Refractor | `ree-FRAK-tər` |
| Petrel | `PET-rəl` |
| V4 | “vee-four” |
| Commissar | `kom-ih-SAR` |
| Meridian | `muh-RID-ee-ən` |
| Wayfarer | `WAY-fair-er` |
| Sunlancer | `SUN-lan-ser` |
| Artificer | `ar-TIF-ih-ser` |
| Solarch | `SOH-lark` |
| Zenith | `ZEE-nith` |
| Hierarch | `HIGH-er-ark` |
| Reclamation | `rek-luh-MAY-shən` |
| Slagger | `SLAG-er` |
| Scrapjaw | `SCRAP-jaw` |
| Arcspitter | `ARK-spit-er` |
| Slaghurler | `SLAG-hur-ler` |
| Yardcrawler | `YARD-crawl-er` |

## Recording and delivery specification

Keep a lossless dry master and derive the game file from it.

- Master: mono WAV, 48 kHz, 24-bit PCM.
- Game derivative: mono Ogg Vorbis, 48 kHz, quality 5 unless listening tests
  prove a lower setting transparent in the battle mix.
- Loudness: normalise the dry dialogue set around -20 LUFS short-term; never
  exceed -3 dBTP. Runtime gain remains authoritative.
- Silence: 35-70 ms clean lead, 90-160 ms tail. No clipped plosive or word.
- Noise: no denoiser warble, audible room change, stereo widening, limiter
  pumping, or DC offset.
- Naming: `<voice-id>.<category>.<take>.ogg`, lowercase on disk. Example:
  `al-arm.select.01.ogg`.
- Provenance sidecar: transcript, provider, provider voice ID, model, settings,
  generation date, licence, source hash, master hash, derivative hash, duration,
  loudness, and true peak.

## Approval rubric

Score each representative pack from 1-5 in the actual battle mix:

1. Faction is identifiable with the screen hidden.
2. Words remain intelligible under weapons, engines, EVA, and music.
3. Routine lines do not become irritating over twenty repeated orders.
4. Urgent lines are unmistakable without being painfully louder.
5. The performance matches its role and does not sound like a named character
   from another property.

Any score below 4 blocks bulk generation for that voice family.
