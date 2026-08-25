<p align="center">
  <img src="apps/game/public/brand/logo-360.png" alt="VOLTMARCH" width="380" />
</p>

<p align="center">
  <strong>An original real-time strategy game that runs in the browser.</strong><br>
  Four factions · ore economy · base building · massed armour battles · fog of war
</p>

<p align="center">
  <a href="https://play.voltmarch.com/">
    <img src="https://img.shields.io/badge/▶_PLAY_IN_BROWSER-play.voltmarch.com-35C8F0?style=for-the-badge&labelColor=0B1017" alt="Play in browser" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/avihaymenahem/voltmarch/actions/workflows/deploy.yml">
    <img src="https://github.com/avihaymenahem/voltmarch/actions/workflows/deploy.yml/badge.svg" alt="Build and deploy" />
  </a>
</p>

<p align="center">
  <img src="docs/hero.png" alt="VOLTMARCH key art: an amphibious assault on a contested coast" width="900" />
</p>

<p align="center">
  <sub><i>Key art — an illustration, not a screenshot. The game looks like the shot below.</i></sub>
</p>

<p align="center">
  <img src="docs/progress/03-faction-architecture.png" alt="In-engine architecture showcase: Allied Forces, Soviet Union, Meridian Pact and Reclamation bases" width="820" />
</p>

<p align="center">
  <sub>In-engine faction architecture — four live deterministic captures from this build.</sub>
</p>

---

## What this is

A full RTS built for the browser: a main menu and settings shell, skirmish setup, four playable
factions with distinct rosters and tech trees, an AI opponent that plays a real game, harvesters and
refineries, power grids that gate production, base placement, fog of war, superweapons, engineer
capture, neutral civilian structures worth fighting over, commander powers bought in the match,
free-for-alls of up to four armies, online duels and two-human co-op against one or two AI armies,
and a modern bottom-anchored HUD.

Cold start is split deliberately: the title menu paints over lightweight key art and accepts input
before the match engine is fetched or initialized. Engine code is prefetched after first paint; the
optional live title battlefield starts only after a 12-second quiet window and crossfades over the
art when ready. Starting a match during that window cancels the decorative work, and boot logs
report system initialization and shader compilation separately so regressions have an owner.

The civilian block is the thing engineer capture and infantry garrisons point AT: two mirrored
hamlets sit on the perpendicular bisector between the two openings — equidistant from both armies —
each with an Oil Derrick that pays its holder every second, a hospital and an apartment block that
five riflemen can turn into a firing position. Nobody builds them; you take them, or you clear them
out.

Seven battlefields, three of which carry a real sea. **Sunder Atoll** is the one the navy exists for —
four islands, one army each, 53.8% of the map underwater and no land route between any two of them,
so every crossing is by ship or it does not happen.

The skirmish lobby paints a deterministic tactical survey for the selected battlefield before the
match loads: land/water split, lanes, ore and every available start. In battle, `W` cycles idle
harvesters and four camera bookmarks live on `Ctrl + F5–F8` / `F5–F8`. Every match records itself,
and the result screen can launch that recording immediately with **Watch Replay**.

Interface text defaults to a more readable **115%** across menus, the tactical HUD, tutorials and
notifications. **Settings → Gameplay → Accessibility** offers 90–150% text scaling, a high-contrast
presentation and reduced interface motion; all three apply immediately and persist with the player
settings. **Settings → Updates** shows the running version and update state, exposes desktop
download/install actions where the build supports them, and links directly to the latest release
and the complete [GitHub release archive](https://github.com/avihaymenahem/voltmarch/releases).
Version-tag releases are also announced automatically in the official Discord after GitHub has
published every Windows artifact; the post carries the generated summary and attaches the complete
release log.

Every army fields a full naval line: a recon hull with the widest sight in the game, a four-slot
landing ship, an eight-slot heavy, an escort, a capital ship, and infantry who swim across on their
own. Cargo is measured in **slots** rather than seats — a rifleman costs one and a vehicle costs two
— so an eight-slot hull is four tanks, and putting armour on another island is a thing you can
actually do. **None of it is progression-gated.** A dock still needs a real coast and a capital ship
still needs the army's tech structure, but no part of the navy is behind a profile unlock, because a
battlefield that sells itself on naval yards and then hides them is not a hard match, it is a
stalemate with extra steps.

<p align="center">
  <img src="docs/progress/13-atoll-crossing.png" alt="A dock on an island coast, a landing party crossing the shoal, and warships holding the lane" width="820" />
</p>

VOLTMARCH is not a port or a clone. It is a new title in the tradition of late-90s and 2000s
base-building RTS — the conventions it adopts (harvester economy, tech tiers, build queues) are the
shared vocabulary of that genre.

**Most art in the game world is generated from code.** Every unit and the full structure roster,
including fallbacks for imported landmarks, is built from Three.js geometry, custom shaders and
procedural canvas generators. Authored landmark structures across all four factions use original
Meshy AI models conditioned and optimized by the local VOLTMARCH asset pipeline, with procedural
fallbacks retained for every imported family.

The deliberate non-runtime-generated shipped content is:

- **Rajdhani** (OFL-1.1), the UI text face, self-hosted in `apps/game/public/fonts/` — Latin subset, four
  weights, 60 kB — rather than loaded from a CDN, so there is no third-party request and the build
  still runs offline and from a `file://` path.
- **The brand lockup** in `apps/game/public/brand/` — the wordmark on the title screen, and the favicons and
  app icons, derived by `tools/brand.mjs` from a supplied `logo.png`.
- **The loading screen key art**, also in `apps/game/public/brand/` — a supplied illustration, derived to
  WebP by `tools/splash.mjs` and used full-bleed behind the boot curtain. It carries its own
  painted wordmark, so the curtain hides the DOM one on any viewport whose crop keeps the painted
  one whole; that threshold is measured off the artwork rather than picked, and
  `apps/game/tests/boot-splash.spec.ts` re-derives it. A missing or corrupt file degrades to exactly the
  curtain that shipped before it, wordmark included.
- **Campaign character portraits** in `apps/game/public/campaign/portraits/` — the nineteen-character authored
  command cast, original AI-assisted artwork generated for VOLTMARCH's briefing, debrief and
  in-match communications surfaces.
  They are interface art, not meshes or textures used by the procedural game world; provenance and
  delivery details live in `apps/game/public/campaign/README.md`.
- **Authored faction landmark structures** in `apps/game/src/assets/buildings/{allies,meridian,reclamation,soviets}/`
  — original Meshy AI generations made for VOLTMARCH, with locally simplified geometry,
  conditioned faction palettes, budgeted PBR maps, LOD/shadow meshes and procedural runtime
  fallbacks. Exact task provenance and performance budgets live beside the assets and in
  `docs/ASSET_CONVERSION_MAP.md`.
- **Campaign command surfaces** — faction-authored briefing and loading transitions, portrait
  communications with a persistent transmission log, operation-aware pause dossiers, save-row
  identity and medal-bearing after-action reports across all 37 operations. Briefings disclose
  deployment, starting reserve, field-catalogue authorization, medal standards and visible bonus
  payouts; live objectives carry those payouts through completion and after action.
- **Persistent Service Record** — lifetime matches, victories, defeats, current and best streaks,
  wins by faction, campaign medals and mission completion, plus a durable honours gallery derived
  from all 17 earnable insignia and field decals. Every locked honour names its awarding mission and
  live progress; every earned one remains visible after its end-of-match reveal.
- **Recorded audio** in `apps/game/public/audio/` — 184 Ogg files, 6.7 MB. `sfx/` covers **all 39 sound-effect
  families** and `voice/` gives the unit barks two real voices, all CC0 from
  [Kenney](https://kenney.nl), several CC0 libraries and Warfork by Team Forbidden. `eva/` is the
  announcer, rendered offline with [Piper](https://github.com/OHF-Voice/piper1-gpl) and a
  public-domain LibriVox voice, because no CC0 pack contains "Insufficient funds." `music/` is a
  three-tier adaptive score by Kevin MacLeod, **CC-BY 4.0** — the one attribution obligation in the
  product. Only ambience is still synthesised. A recorded take is decoded once and
  rendered through the same offline bake as a synthesised recipe, inheriting the same saturation,
  normalisation and variant set, and every one keeps its recipe as a fallback so a missing file
  degrades to the synthesised bank rather than to silence. See
  [`apps/game/public/audio/README.md`](apps/game/public/audio/README.md).

"Shipped" means `apps/game/public/` — what the browser downloads. Three PNGs in `docs/` on this page are a
different thing, and the product loads none of them.

Two are screenshots of the running game, captured by `npm run shots` and downscaled to 1640 px:
photographs of procedurally generated art rather than art. The third is `docs/hero.png`, the
illustration at the top, which is **key art and not a screenshot** — it was drawn, not rendered by
this engine, which is why it is captioned as such and why the in-engine capture sits directly
beneath it. None of them is in the credits screen, because that screen is checked against `apps/game/public/`
and a line for a file the game never loads would make it less true, not more. They are still binary
files in the repository and this list would be dishonest by omission without them.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The repository is an npm workspace managed by
Turborepo; one root install supplies every app and package.

| script | what it does |
| --- | --- |
| `npm run dev` | dev server on port 5173 |
| `npm run build` | production bundle into `apps/game/dist/` |
| `npm run preview` | serve the built bundle |
| `npm run typecheck` | typecheck every workspace through Turborepo |
| `npm test` | every workspace's complete test suite |
| `npm run check:affected` | typecheck, scoped-test and build only workspaces changed from the Git base |
| `npm run check:all` | the complete release-equivalent monorepo gate |
| `npm run shots` | capture the visual-critique screenshot set into `shots/` |
| `npm run soak` | the determinism suite alone, for when only that is in question |
| `npm run server` | build and run the multiplayer relay on `127.0.0.1:8787` |
| `npm run server:test` | the relay's own suite, via `node --test` |
| `npm run desync-probe` | compare the unspecified `Math.*` functions across browser engines |
| `npm run replay-probe` | replay a recorded match and require a deleted command to diverge |
| `npm run naval-proof` | drive a live match until a hull is floating, and photograph it |

`npm run build` deliberately does **not** run `tsc`. esbuild strips types, so a type error must never
be able to stop the game from running; type errors are caught by `npm run typecheck` instead.

`npm run shots` additionally needs Playwright: `npx playwright install chromium`.

### Production analytics

The hosted game uses Cloudflare Web Analytics when the GitHub Pages build receives the public
`CF_WEB_ANALYTICS_TOKEN` repository variable. The launch site injects the same token during its
Cloudflare Pages build. The beacon is allowed only on HTTPS pages at
`voltmarch.com` and its subdomains; local development, GitHub previews and the Electron app never
load it. Tracking uses Cloudflare's cookie-free analytics beacon and does not write browser storage.

### Production topology

The public hosts have separate jobs and must not be collapsed back onto one domain:

- [`voltmarch.com`](https://voltmarch.com/) is the standalone coming-soon site from `apps/website/`,
  deployed by Cloudflare Pages with the waitlist stored in D1.
- [`play.voltmarch.com`](https://play.voltmarch.com/) is the latest game bundle, deployed by
  `.github/workflows/deploy.yml` to GitHub Pages. `apps/game/public/CNAME` preserves that custom domain.
- `relay.voltmarch.com` is the production lockstep WebSocket relay. It is not a website.

Pushing `main` updates both static deployments from their own roots. Relay releases remain an
explicit workflow because a relay restart ends live matches.

## Multiplayer

Online duels and mixed **2v1 / 2v2 co-op**, as deterministic lockstep: two human sockets run the
identical simulation while the server authors up to four logical seats and relays turn frames
without simulating anything. In co-op, the AI work is split between the two clients and every AI
order crosses the same validated frame stream as human input. Quick Match deliberately remains a
1v1 queue.

Each player brings a validated commander handle. Enter opens a compact in-match chat, while mixed
co-op adds teammate-only right-click minimap pings. Both are presentation channels outside the
lockstep command stream: they cannot alter a tick, checksum or replayed order. Replay headers retain
commander names for meaningful post-match and browser labels while older recordings remain valid.

It was largely already built. [`apps/game/src/game/Replay.ts`](apps/game/src/game/Replay.ts) records the command stream
by apply tick and re-issues it into a live bus; [`apps/game/src/game/Checksum.ts`](apps/game/src/game/Checksum.ts)
fingerprints the simulation per tick with per-block divergence reporting. Those are exactly a
lockstep client and a desync detector, written for replay and pointed at a socket here — so a PvP
match also produces a correct replay, with no extra machinery.

If a socket disappears, the relay retires that command source and delegates both its human army and
any AI army it hosted to the survivor. The existing AI takes over on the next simulation step and
its orders continue through validated lockstep frames. There is still no reconnect or late join:
the dropped client cannot catch up without replaying the stream it missed.

```bash
npm run server          # the relay, on 127.0.0.1:8787
npm run desync-probe    # do the unspecified Math.* functions agree across engines?
```

The relay lives in [`apps/relay/`](apps/relay/README.md) and depends only on the shared
[`packages/protocol/`](packages/protocol/) and [`packages/game-types/`](packages/game-types/)
workspaces. Importing `three` or `apps/game/src/sim/**` is a build error rather than a review note.
Its README carries the threat model, the limits, and the defects an audit of it
found. Multiplayer only appears in the menu when a relay actually answers a handshake; set
`VITE_RELAY_URL` at build time, or `?relay=` for a one-off.

**The honest limit:** in lockstep every client holds the whole world, so a modified client can
reveal fog and script its own input. Resource, spawn and damage cheats are all closed — a client can
only issue commands, and one that fudges its own state diverges and is named by the checksum within
100 ms. Closing the rest means a server-authoritative simulation, which this deliberately is not.

## Saves, replays, and one break worth announcing

A save is a binary snapshot of the world; a replay is the command stream plus the header needed to
rebuild the boot. Both refuse rather than load wrong, and both say why in a sentence meant for a
person. The just-finished recording is offered directly on the result screen as well as in the
title-screen replay browser.

**Commander powers shipped as a fifth build tab, and that invalidates every earlier save.**
`BUILD_TAB_COUNT` went from 4 to 5, and it is one of the ten constants in `structuralHash()` — the
numbers that decide what a column index or an enum value *means*. So a save written before the
Powers tab is refused on load with `build-mismatch` and "This save was written by a different build
of the game, and the world it describes no longer fits this one." That is the gate working, not a
bug: the alternative is a file that loads with every index past the new tab shifted by one. Replays
are versioned separately (`REPLAY_FORMAT_VERSION` 2) and a v1 file is refused for the same reason.

## Boot flags

Appended to the URL, e.g. `?art=dusk&seed=1234`.

| flag | effect |
| --- | --- |
| `?shot=<id>` | skip the menu, freeze the sim and pose the camera for a diffable screenshot |
| `?map=<preset>` | map preset |
| `?art=<mood>` | lighting mood — `noon`, `dusk`, `night`, `overcast`, `dust` |
| `?tier=<tier>` | quality override — `low`, `medium`, `high`, `ultra` |
| `?seed=<int>` | deterministic RNG seed — the scenario layout and every draw of `s.rng` |
| `?mapseed=<int>` | the terrain roll, which is a *different* seed: reproduce or skip a landform |
| `?biome=<name>` | `temperate`, `desert`, `snow`, `urban` |
| `?fog=off` | disable fog of war |
| `?relay=<url>` | point multiplayer at one relay for a single session |
| `?unlockall` | developer flag: treat every mission-gated unit and structure as owned |

`?unlockall` (or `?unlock=all`) is read-only — it changes what the unlock gate *answers*, never what
the profile *stores* — so it cannot grant itself anything and reloading without it restores your real
progression. It logs a warning on boot so a session running with it is never mistaken for a normal
one. It deliberately works in production builds too: the deployed Pages bundle is where bugs get
reproduced, and a flag that only worked on localhost would be useless there.

## How the art direction is enforced

The look is held to a measured target rather than to opinion.

[`docs/RA3_LOOK_BIBLE.md`](docs/RA3_LOOK_BIBLE.md) specifies the visual language in falsifiable
terms — camera pitch, light angles and colours, palette hexes, material response, prop density — and
ends in a weighted scorecard where every criterion has an explicit pass condition.

[`tools/metrics.mjs`](tools/metrics.mjs) turns the measurable half of that scorecard into numbers
sampled straight off a rendered PNG: median luminance, mean saturation, black and highlight
percentiles, hue distribution, edge density, aerial-perspective delta. `tools/shoot.mjs` captures a
fixed set of scenarios at 1440p so the two can be run together on every change.

This exists because the failure mode it guards against is invisible from the inside: a render drifts
bright, flat and grey-green while everyone looking at it insists it is fine. A median luminance of
0.53 against a target of 0.34 is not a matter of taste.

## Layout

```
apps/game/      browser game, public assets, Vite config and the complete game test corpus
apps/desktop/   Electron shell, packaging and desktop-only boundary tests
apps/relay/     deterministic WebSocket relay and host deployment scripts
apps/website/   standalone Cloudflare Pages marketing site and waitlist function
packages/game-types/ dependency-free simulation and wire-facing type vocabulary
packages/protocol/   validated multiplayer protocol and deterministic turn merge
apps/game/src/core/      simulation spine — config, EntityStore/World, event buses, fixed-step loop
apps/game/src/core/config.ts   art direction + world scale; the single values file that drives the look
apps/game/src/render/    renderer, scene rig, camera rig, post chain, RenderBridge, __VM debug handle
apps/game/src/game/      Bootstrap, GameContext, glob system discovery, scenario router
apps/game/src/shell/     main menu, skirmish setup, multiplayer lobby, settings, pause, victory/defeat
apps/game/src/ui/        the in-match HUD and in-world overlay
apps/game/src/input/     action catalogue, key binding, selection, order issuing — every player command
apps/game/src/sim/       pathfinding, combat, economy, production, AI, vision, superweapons, capture
apps/game/src/progression/ missions, objectives, unlocks, campaign save state
apps/game/src/art/       procedural geometry — shape primitives, greeble, unit and building factories
apps/game/src/world/     terrain, water, roads, decals, prop scatter
apps/game/src/vfx/       particles, beams, explosions, tracers, pooled scene lights
apps/game/src/audio/     WebAudio mixer, recorded SFX/voice/announcer banks, adaptive streamed score
apps/game/src/net/       lockstep protocol, turn scheduling, relay merge rules, socket, session
apps/game/src/data/      unit/building/faction/armour tables
tools/         screenshot harness, grade probe, cross-engine desync probe, brand assets
docs/          look bible, visual DNA, architecture
```

A module joins the game by existing: drop a `*.system.ts` under `apps/game/src/` that default-exports a
`SystemModule` and [`apps/game/src/game/Systems.ts`](apps/game/src/game/Systems.ts) discovers it by glob. Nothing has to
be registered by hand.

## Stack

Vite · TypeScript · Three.js (pinned exact). No React, no game engine, no external art pipeline.

## License and third-party notices

VOLTMARCH's original source code and assets are proprietary and all rights are reserved. Public
source access and the deployed browser build do not grant permission to copy, redistribute, or
create derivative works. See [`LICENSE`](LICENSE) for the project terms.

Bundled third-party material keeps its own licence. The required Kevin MacLeod music attribution,
Rajdhani's SIL Open Font License, the CC0 sound-bank provenance, EVA voice provenance, and the
OpenAI/Meshy asset disclosures are collected in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The music credit is a **CC BY 4.0 licence
condition** and must remain in every web, desktop, and store distribution.
