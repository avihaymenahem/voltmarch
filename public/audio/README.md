# Shipped audio

Everything here is a **downloaded, recorded** asset — the third declared exception to the
"generated from code" rule, after `public/fonts/` and `public/brand/`. `CLAUDE.md`, `README.md` and
the credits screen in `src/shell/MainMenu.ts` all name it, and `tests/credits-truthful.spec.ts`
checks those three against what is actually in this directory.

**184 files, 6.9 MB.** Every one of the 39 sound-effect families is a recording, the unit barks are
two real human voices, and the EVA announcer is rendered speech. Nothing a player hears from the
SFX or voice buses comes from an oscillator.

## The announcer

EVA's 32 lines are the only audio here that had to be **made** rather than found — no CC0 pack
contains "Insufficient funds." They are rendered by [`tools/render-eva.py`](../../tools/render-eva.py)
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

The voice model is ~109 MB and is **gitignored** (`tools/tts-voices/`). Only the ~460 kB of `.ogg`
The voice model is ~109 MB and is **gitignored** (`tools/tts-voices/`). Only the ~450 kB of `.ogg`
is committed.

## Provenance

| Sounds | Source | Author | Licence |
|---|---|---|---|
| `ui.*` — interface (21) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney | CC0 1.0 |
| `impact.concrete`, `debris.grain`, `ore.dump` (16) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | CC0 1.0 |
| **Unit barks** — `voice/*` (34), both voices | [Voiceover Pack](https://kenney.nl/assets/voiceover-pack) | Kenney | CC0 1.0 |
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

## Two things that must not be undone

**Takes are trimmed on an Ogg page boundary**, which lands mid-waveform, so `sampleInto` fades the
last 20 ms of every take unconditionally. Remove that fade and the whole bank clicks — a step
discontinuity has energy across the entire spectrum, the saturator hardens it, and the reverb send
puts a copy of it in the room.

**`engine.light` and `engine.heavy` are looped, not fired.** They are designed loops and were
deliberately not trimmed. Cutting them puts a seam in the loop that repeats for as long as a
vehicle is on screen.

## The score

`music/` is three CC-BY 4.0 tracks by **Kevin MacLeod (incompetech.com)**, trimmed to 72-second
loops and crossfaded by combat heat: `idle` = "Colossus" (86 BPM), `mid` = "Industrial Revolution"
(140 BPM), `combat` = "Clash Defiant" (170 BPM). One composer on purpose — an adaptive score does
nothing but crossfade, and crossfades between different ensembles and rooms announce themselves.

**This is the only attribution OBLIGATION in the product.** Everything else here is CC0 or public
domain and is credited as a courtesy; omit the credit on these and the licence does not grant the
use. The exact block is in the credits screen.

Each loop is equal-power crossfaded against the three seconds FOLLOWING its cut point, so
`loop = true` does not produce an audible seam every 72 seconds.

Streamed via `MediaElementSource`, never decoded into `SampleBank`: three 72-second stereo buffers
would be **83 MB** of resident Float32, against a 28 MB budget for the entire sound-effect bank.

Re-encoding note for whoever does this next: `libsndfile` **crashes the interpreter** on a single
`sf.write()` of ~3.2M frames — exit 253, no traceback, a truncated file. Write in one-second chunks
through `sf.SoundFile`; the stream is identical.

## What is still generated

**Nothing.** Ambience was the last of it and it is deleted.

It was a pink-noise wind bed under a wandering lowpass, and a base hum of three SAWTOOTH oscillators
at 50, 50.6 and 75 Hz through a 220 Hz lowpass and a waveshaper. The 50 and the 50.6 beat against
each other at 0.6 Hz, so it throbbed about once every two seconds, and the shaper made it growl.

It was reported as the weirdest sound in the game, heard on the INITIAL PAGE LOAD — and that is the
part worth recording, because the hum was gated on powered plants and should have been silent at the
menu. The title screen boots a real world behind itself just to have something moving. Measured: 31
buildings. So plants existed, the camera sat among them, and a base hum came up over the main menu
with no base on screen to explain it.

Removed rather than gated to a match, because the verdict is the same one the other 39 families got:
the synthesised bank measured correct on every number `tools/audio-measure.mjs` reports and still
read as a synth patch. **The measurement is a proxy; the ear is not.** The `ambience` BUS went with
it — a fader in the options screen that moves nothing is worse than a missing feature, because the
player cannot tell it is missing.

The five-layer procedural music sequencer is still in the tree and is still the automatic fallback
if a music track fails to load, but it is not what plays.

Every synthesised recipe also survives as a **fallback**. If a file 404s or the browser refuses the
container, the oscillator version renders instead — including EVA, where an offline player gets a
robot voice rather than silence, because silence on "Our base is under attack" loses the match.
