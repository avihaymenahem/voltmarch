# VOLTMARCH third-party notices

Last updated: 24 August 2026

This file records the provenance and licence terms of third-party material
deliberately included in the VOLTMARCH web and desktop distributions. The root
[`LICENSE`](LICENSE) applies only to VOLTMARCH's original material; it does not
replace or narrow any licence below.

## Music — attribution required

The adaptive score includes these works by **Kevin MacLeod
([incompetech.com](https://incompetech.com/))**:

| Shipped cue | Work | Source |
| --- | --- | --- |
| `public/audio/music/idle.ogg` | "Colossus" — ISRC USUAN1100358 | [track page](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100358) |
| `public/audio/music/mid.ogg` | "Industrial Revolution" — ISRC USUAN1100811 | [track page](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100811) |
| `public/audio/music/combat.ogg` | "Clash Defiant" — ISRC USUAN1600003 | [track page](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1600003) |

> "Colossus", "Industrial Revolution", and "Clash Defiant" — Kevin MacLeod
> (incompetech.com). Licensed under Creative Commons Attribution 4.0
> International ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).

**Modifications:** each source work was excerpted, trimmed to a 72-second Ogg
loop, level-conditioned, and given an equal-power boundary crossfade for
adaptive playback. The three works are crossfaded against one another according
to combat intensity. No endorsement by the composer is implied.

This credit is a condition of CC BY 4.0, not an optional courtesy. It must remain
visible in every distribution and in the in-game credits.

## Typeface — SIL Open Font License 1.1

**Rajdhani**, four Latin-subset WOFF2 weights in `public/fonts/`.

Copyright (c) 2014, Indian Type Foundry (info@indiantypefoundry.com).

Rajdhani is redistributed under the **SIL Open Font License 1.1**. The complete
licence text shipped with this repository is in
[`licenses/Rajdhani-OFL-1.1.txt`](licenses/Rajdhani-OFL-1.1.txt). Upstream:
[Google Fonts metadata](https://github.com/google/fonts/tree/main/ofl/rajdhani)
and [Indian Type Foundry's Rajdhani repository](https://github.com/itfoundry/rajdhani).

## Recorded sound effects and unit voices — CC0 1.0

The following recordings are distributed under the
[Creative Commons CC0 1.0 Universal dedication](https://creativecommons.org/publicdomain/zero/1.0/).
CC0 does not require attribution; the credits below are retained for provenance.

| Material | Creator / source |
| --- | --- |
| Interface sounds | Kenney, [Interface Sounds](https://kenney.nl/assets/interface-sounds) |
| Concrete impacts, debris and ore dump | Kenney, [Impact Sounds](https://kenney.nl/assets/impact-sounds) |
| Male and female unit barks | Kenney, [Voiceover Pack](https://kenney.nl/assets/voiceover-pack) |
| Gunfire, artillery and small/medium explosions | `25-CC0-bang-sfx` via [lavenderdotpet/CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds) |
| Tesla and prism effects | `50-cc0-sci-fi-sfx` via the same archive |
| UI thunk, shell casing, repair spark and crush | `100-CC0-SFX` and `100-CC0-wood-metal-SFX` via the same archive |
| Armour/dirt impacts and sell effects | `100-cc0-sfx-2` via the same archive |
| Water impacts | `40-cc0-water-splash-slime-sfx` via the same archive |
| Flame jet and light/heavy engine loops | `30-cc0-sfx-loops` via the same archive |
| Dog barks | `angerdog` via the same archive |
| Flak, rocket, large explosion, construction and infantry-death effects | Warfork, Team Forbidden |

The file-level family map and the exact pack names are maintained in
[`public/audio/README.md`](public/audio/README.md). Bundled source licence files
were checked when these recordings were selected; a pack whose listing and
bundled licence disagreed was rejected.

## EVA announcer provenance

The shipped EVA lines were rendered specifically for VOLTMARCH with Piper's
`en_GB-cori-high` voice. The voice model identifies its training recordings as
LibriVox public-domain material and was trained from scratch. LibriVox states
that its recordings are public domain in the United States; public-domain
status can differ by jurisdiction. Neither the Piper engine nor its model
weights are included in the game distribution—only the rendered Ogg lines are.

Piper build tooling and the voice provenance are documented in
[`public/audio/README.md`](public/audio/README.md). LibriVox's public-domain
policy is at <https://librivox.org/pages/public-domain/>.

## AI-assisted original art and models

These entries are provenance disclosures rather than third-party attribution
licences:

- **Campaign command portraits:** original images generated for VOLTMARCH with
  OpenAI image generation, then selected, cropped, colour-conditioned, and
  exported locally for the campaign interface. The shipped cast manifest is in
  [`public/campaign/README.md`](public/campaign/README.md).
- **Coming-soon poster:** original marketing art generated for VOLTMARCH with
  OpenAI image generation, then composed and exported locally into responsive
  WebP derivatives. Its delivery manifest is in
  [`launch-site/README.md`](launch-site/README.md).
- **Faction landmark structures and selected units:** original Meshy AI
  generations made for VOLTMARCH, then retopologized, retextured,
  colour-conditioned, LODed, compressed, and integrated through the local asset
  pipeline. Asset-specific provenance and budgets live beside the models in
  `src/assets/` and in [`docs/ASSET_CONVERSION_MAP.md`](docs/ASSET_CONVERSION_MAP.md).

No third-party source artwork is represented by these disclosures as being
licensed under VOLTMARCH's proprietary licence. Service names are trademarks of
their respective owners; their mention does not imply endorsement.

The VOLTMARCH wordmark, app marks, and loading-screen key art were supplied by
the project owner and transformed locally into delivery derivatives. They are
recorded here for provenance and are not offered under a third-party licence.

## Shipped software

VOLTMARCH also contains or distributes open-source runtime software, including
Three.js (MIT), Electron (MIT), Chromium and its components, `electron-updater`,
and `ws` (MIT). Their authoritative versions are pinned in the applicable
`package.json` and lock files. The desktop package preserves Electron's
generated `LICENSE.electron.txt` and `LICENSES.chromium.html` files; those files
contain the complete Chromium component notices for that build.

Build and test dependencies are not incorporated into the game merely by being
listed in a lock file. Each dependency remains subject to its own licence.

The production web bundle copies this file, the project licence, and Rajdhani's
OFL text into `legal/`. The desktop package contains that unchanged web bundle,
so the same notices travel with both distributions.
