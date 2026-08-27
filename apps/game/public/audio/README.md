# Shipped audio

Everything here is a **downloaded, recorded** asset — the third declared exception to the
"generated from code" rule, after `public/fonts/` and `public/brand/`. `CLAUDE.md`, `README.md` and
the credits screen in `src/shell/MainMenu.ts` all name it, and `tests/credits-truthful.spec.ts`
checks those three against what is actually in this directory.

**697 Ogg files, 17.33 MiB.** Every one of the 39 sound-effect families is a recording, unit barks
combine two CC0 performers with original faction armour and infantry packs, and the EVA announcer is rendered
speech. Nothing a player hears from the SFX or voice buses comes from an oscillator.

## The announcer

EVA's 33 lines are the only audio here that had to be **made** rather than found — no CC0 pack
contains "Insufficient funds." They are rendered by [`tools/render-eva.py`](../../../../tools/render-eva.py)
using **Piper** with the **`en_GB-cori-high`** voice, and re-rendering is a single command.

That voice was chosen on its licence chain, not its sound:

- **Dataset** — the voice's `MODEL_CARD` names LibriVox, `License: public domain`. LibriVox's own
  policy permits selling, broadcasting and remixing, with "no need to credit LibriVox".
- **Weights** — trained *from scratch* (500 epochs, ~24 h), so it does **not** inherit the
  research-only Blizzard/Lessac terms that encumber most of Piper's English catalogue.
- **Engine** — GPL-3.0, but a rendered WAV embeds no engine code and the engine never ships.

Nothing in that chain grants, restricts or even discusses rights in the generated audio. Two things
to know before someone re-opens this:

1. **Do not cite the HuggingFace repo tag.** `rhasspy/piper-voices` carries a repo-level
   `license: mit` that is provably false about its own contents — the same repo holds
   `en_US-lessac`, whose real terms are a non-sublicensable research-only agreement. Cite the
   specific `MODEL_CARD`.
2. **Most popular Piper voices are encumbered**, including `hfc_female`, which is what nearly every
   "best Piper voice" guide recommends. Also `lessac`, `amy`, `ryan`, `alba`, `jenny_dioco`, and
   several fine-tuned *from* lessac that inherit its terms.

Residual footnotes, recorded rather than hidden: LibriVox asserts public domain **in the USA** and
does not warrant it elsewhere; and a public-domain dedication disposes of copyright in a recording
without transferring the reader's voice likeness. For an unnamed announcer in a free game the
exposure is negligible, but no licence in the chain addresses it.

The voice model is ~109 MB and is **gitignored** (`tools/tts-voices/`). Only the ~405 kB of `.ogg`
is committed.

## Provenance

| Sounds | Source | Author | Licence |
|---|---|---|---|
| `ui.*` — interface (21) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney | CC0 1.0 |
| `impact.concrete`, `debris.grain`, `ore.dump` (16) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | CC0 1.0 |
| **Unit barks** — `voice/*` (34), both voices | [Voiceover Pack](https://kenney.nl/assets/voiceover-pack) | Kenney | CC0 1.0 |
| **Allied armour** — `voice/al-arm.*` (12) | Original generation under the owner's paid ElevenLabs account | VOLTMARCH | Original material; see [`AL-ARM_v1.json`](../../../../docs/voice/generated/AL-ARM_v1.json) |
| **Soviet armour** — `voice/sv-arm.*` (12) | Original generation under the owner's paid ElevenLabs account | VOLTMARCH | Original material; see [`SV-ARM_v1.json`](../../../../docs/voice/generated/SV-ARM_v1.json) |
| **Meridian armour** — `voice/mr-arm.*` (12) | Original generation under the owner's paid ElevenLabs account | VOLTMARCH | Original material; see [`MR-ARM_v1.json`](../../../../docs/voice/generated/MR-ARM_v1.json) |
| **Reclamation armour** — `voice/rc-arm.*` (12) | Original generation under the owner's paid ElevenLabs account | VOLTMARCH | Original material; see [`RC-ARM_v1.json`](../../../../docs/voice/generated/RC-ARM_v1.json) |
| **Allied infantry A** — `voice/al-inf-a.*` (17) | Original generation under the owner's paid ElevenLabs account | VOLTMARCH | Original material; see [`AL-INF-A_v1.json`](../../../../docs/voice/generated/AL-INF-A_v1.json) |
| **Allied infantry B** — `voice/al-inf-b.*` (17) | Original generation through the owner's ElevenLabs API account | VOLTMARCH | Original material; see [`AL-INF-B_v1.json`](../../../../docs/voice/generated/AL-INF-B_v1.json) |
| **Soviet infantry A** — `voice/sv-inf-a.*` (17) | Original generation through the owner's ElevenLabs API account; audition candidate 2 selected | VOLTMARCH | Original material; see [`SV-INF-A_v1.json`](../../../../docs/voice/generated/SV-INF-A_v1.json) |
| **Soviet infantry B** — `voice/sv-inf-b.*` (17) | Original generation through the owner's ElevenLabs API account; audition candidate 2 selected | VOLTMARCH | Original material; see [`SV-INF-B_v1.json`](../../../../docs/voice/generated/SV-INF-B_v1.json) |
| **Meridian infantry A** — `voice/mr-inf-a.*` (17) | Original generation through the owner's ElevenLabs API account; audition candidate 2 selected | VOLTMARCH | Original material; see [`MR-INF-A_v1.json`](../../../../docs/voice/generated/MR-INF-A_v1.json) |
| **Meridian infantry B** — `voice/mr-inf-b.*` (17) | Original generation through the owner's ElevenLabs API account; audition candidate 3 selected | VOLTMARCH | Original material; see [`MR-INF-B_v1.json`](../../../../docs/voice/generated/MR-INF-B_v1.json) |
| **Reclamation infantry A** — `voice/rc-inf-a.*` (17) | Original generation through the owner's ElevenLabs API account; audition candidate 3 selected | VOLTMARCH | Original material; see [`RC-INF-A_v1.json`](../../../../docs/voice/generated/RC-INF-A_v1.json) |
| **Reclamation infantry B** — `voice/rc-inf-b.*` (17) | Original generation through the owner's ElevenLabs API account; audition candidate 1 selected | VOLTMARCH | Original material; see [`RC-INF-B_v1.json`](../../../../docs/voice/generated/RC-INF-B_v1.json) |
| **Allied Harvester** — `voice/al-harv.*` (22) | Original generation through the owner's ElevenLabs API account; audition candidate 1 selected | VOLTMARCH | Original material; see [`AL-HARV_v1.json`](../../../../docs/voice/generated/AL-HARV_v1.json) |
| `cannon.*`, `mg.round`, `artillery.fire`, `explosion.small/medium` (19) | `25-CC0-bang-sfx` via [CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds) | — | CC0 1.0 |
| `tesla.*`, `prism.fire` (10) | `50-cc0-sci-fi-sfx` via the same collection | — | CC0 1.0 |
| `ui.thunk`, `shell.casing`, `spark.repair`, `crush.squish` (13) | `100-CC0-SFX`, `100-CC0-wood-metal-SFX` | — | CC0 1.0 |
| `impact.armor/dirt`, `sell.puff`, `ui.sell` (10) | `100-cc0-sfx-2` | — | CC0 1.0 |
| `impact.water` (4) | `40-cc0-water-splash-slime-sfx` | — | CC0 1.0 |
| `flame.jet`, `engine.light`, `engine.heavy` (5) | `30-cc0-sfx-loops` | — | CC0 1.0 |
| `dog.bark` (4) | `angerdog` | — | CC0 1.0 |
| `flak.round`, `rocket.launch`, `explosion.large`, `build.rise`, `death.infantry` (13) | Warfork | Team Forbidden | CC0 1.0 |

CC0 waives all rights and requires no attribution. Everyone is credited anyway, here and in the
credits screen, because a licence that asks for nothing is not a reason to say nothing.

**Verify the bundled licence, never the listing page.** A gunshot pack advertised as CC0 on
OpenGameArt carried a `creativecommons.txt` reading *"Copyright (c) 2009 Vincent Sevedge …
Creative Commons Attribution 3.0"* — a different licence and a different author than the page
credited. It was rejected. Kenney's `License.txt` and Warfork's `warfork_assets_cc0.txt` were both
read before anything was committed.

## Naming

`sfx/<sound-id>.<take>.ogg`, where `<sound-id>` is an id from `SFX` in `src/audio/Weapons.ts`.
`SAMPLE_MANIFEST` in `src/audio/Samples.ts` records the take count per family, and
`tests/audio-samples.spec.ts` checks that table against this directory in both directions — a file
with no manifest entry is dead weight, a manifest entry with no file is a 404 at load.

## How these are used

Not a second playback path. A take is decoded once, then rendered through the same offline bake as
a synthesised recipe, so it inherits the bake-time saturation, the peak normalisation and the
variant set; at runtime it is the same `BufferSource -> gain -> panner -> bus`. The mixer, both
reverb rooms, crowd summation, the voice budget and the distance model never learn where the buffer
came from.

Every sample-backed sound **keeps its recipe as a fallback**. A 404, an offline player or a
container the browser refuses degrades to the synthesised bank, never to silence.

Unit identity is resolved from the entity's real content key before broad flags are considered.
That distinguishes all four faction families as well as engineers, commanders, aircraft, naval
units, transports, harvesters and builders. Allied combat armour now uses the first original
faction pack; other classes retain the two CC0 performers until their reviewed packs land. The
finer classes are the stable routing destinations for the faction packs tracked in
[`docs/VOICEOVER_PLAN.md`](../../../../docs/VOICEOVER_PLAN.md).
Phase 2 generation must follow the
[`casting bible`](../../../../docs/voice/PHASE2_CASTING_BIBLE.md) and
[`response matrix`](../../../../docs/voice/PHASE2_RESPONSE_MATRIX.md); together they define stable
voice IDs, exact transcripts, delivery specifications, role coverage, and the first 48-file review
batch.

Options → Audio independently controls the strategic announcer and unit-response frequency (Full,
Selection Only, or Off). Options → Gameplay → Voice Subtitles captions both systems on a dedicated
bottom-centre surface; captions never consume or retire an alert toast.

## Two things that must not be undone

**Takes are trimmed on an Ogg page boundary**, which lands mid-waveform, so `sampleInto` fades the
last 20 ms of every take unconditionally. Remove that fade and the whole bank clicks — a step
discontinuity has energy across the entire spectrum, the saturator hardens it, and the reverb send
puts a copy of it in the room.

**`engine.light` and `engine.heavy` are looped, not fired.** They are designed loops and were
deliberately not trimmed. Cutting them puts a seam in the loop that repeats for as long as a
vehicle is on screen.

## The score

`music/` is the original VOLTMARCH score: **Silent Horizon**, **Disciplined Ostinato**,
**Echoes of the Siege**, and **Endless Warfront**. The project owner supplied the 48 kHz stereo PCM masters after generating
them under a paid Suno Pro account and asserts the commercial rights to use them in VOLTMARCH.
They are original project material, not third-party CC-BY content and require no external credit.

`tools/prepare-music.py` makes the delivery files reproducibly: it removes DC, overlaps the final
four seconds with the opening four seconds and applies a codec-safe 20 ms edge taper, level-matches
to -17 dBFS stereo RMS with a -1.5 dBFS peak ceiling, and writes Ogg/Vorbis in one-second chunks. The WAV
masters stay archival and are not committed or shipped; their hashes and measurements live in
[`docs/MUSIC_PROVENANCE.md`](../../../../docs/MUSIC_PROVENANCE.md).

Only one cue is streamed through one `MediaElementSource` at a time. A match chooses a fresh cue
locally, loops it for the entire battle, and the title/pause controls can cycle it manually. The
main-menu control can also pause and resume the active cue; that user-paused state survives route
changes and suppresses automatic load-retry playback until the player resumes. The longest delivery
cue would occupy roughly 85 MB as decoded stereo Float32 by itself; streaming keeps it out of the
resident sound-effect budget.

## What is still generated

Ambience, and nothing else by default. The five-layer procedural sequencer is still in the tree as
the automatic fallback if a soundtrack cue fails to load, but it is no longer what normally plays.

Every synthesised recipe also survives as a **fallback**. If a file 404s or the browser refuses the
container, the oscillator version renders instead — including EVA, where an offline player gets a
robot voice rather than silence, because silence on "Our base is under attack" loses the match.
