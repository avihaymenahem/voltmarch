# Codex handoff

Last refreshed: 2026-08-31

This is the first document to read when a new Codex chat takes over VOLTMARCH. It is a jump table
and a current-state snapshot, not a second copy of every design document. If this file and the
runtime disagree, code plus tests win; update this file in the same change that makes an important
project decision obsolete.

## Start a new chat here

1. Work in `C:/Users/Administrator/projects/voltmarch` or a dedicated `codex/` worktree created from
   `origin/main`. Do not assume the app-selected working directory is the repository.
2. Read `CLAUDE.md` completely before changing code. It contains the architectural invariants,
   deployment topology, failure history and hard rules that are too detailed to repeat here.
3. Read `TODO.md`. It contains **outstanding work only**; completed work does not stay there.
4. Read the workstream document relevant to the request from the source map below.
5. Run `git fetch origin`, `git status --short`, `git rev-parse HEAD` and
   `git rev-parse origin/main` before editing. Preserve unrelated user changes.
6. Use affected workspace gates during development. Use the complete release gate only for a real
   release or a cross-cutting architectural change.

## Current shipped state

- Public version: **3.15.0**.
- The `v3.15.0` tag is the coordinated desktop/web/relay release baseline.
- `voltmarch.com` is the Cloudflare Pages marketing/coming-soon site.
- `play.voltmarch.com` is the playable GitHub Pages build.
- `relay.voltmarch.com` is the Hostinger/nginx WebSocket relay.
- GitHub Wiki is generated from the repository's `wiki/` directory by
  `.github/workflows/wiki.yml`. Never edit the detached wiki repository as a second source of truth.
- The in-game Manual uses the same 19 files and remains a lazy build input. Wiki changes trigger
  the game Pages workflow and the GitHub Wiki publisher.
- The old `marketing/facebook-screenshots/` set was deliberately deleted because it no longer
  represented the game. Do not restore it; create new captures against the current build when a
  new marketing set is requested.
- Release 3.15 completes the current imported unit wave and the 32-key authored environment
  catalogue, makes those environment families the default presentation, adds the first cinematic
  WebGPU atmosphere slice, fixes terrain/decal depth fighting and restores the right-button command
  boundary under desktop pointer confinement.
- The title menu exposes top-right Support and News & Events actions. Support opens the stable
  Discord invite; News & Events opens the Updates tab, whose validated `voltmarch.com/news.json`
  feed can change independently of an installed client and falls back to a bundled release bulletin.
- Easy skirmish now uses a 0.65 harvest multiplier, 28 APM, a 6:40 first-push floor and no advanced
  tactics. A player who loses both yard and factory may buy the normal 3,000-credit/32-second MCV
  through one off-map recovery queue if any owned rendezvous asset survives.

The repository should be clean and `origin/main` should match the working branch at this handoff.
Verify rather than trusting that sentence after time has passed.

## Source-of-truth map

| Subject | Authority |
| --- | --- |
| Architecture, hard rules, renderer history, deployment topology | `CLAUDE.md` |
| Open engineering work only | `TODO.md` |
| Player-visible rules and numbers | `wiki/`; guarded by wiki/manual tests |
| Visual identity and faction language | `docs/VISUAL_DNA.md`, `docs/ART_DIRECTION_V2.md`, `docs/RA3_LOOK_BIBLE.md` |
| Imported model roster and status | `docs/ASSET_CONVERSION_MAP.md` |
| Canonical shared models, brand art and fonts | `packages/assets/`; boundaries guarded by `npm run lint` and `npm run check:ownership` |
| Standalone WebGPU model catalog and infantry stress tooling | `apps/asset-lab/` |
| In-match DEV-only load controls (Cheat Engine) | `apps/game/src/dev/CheatEngine.ts`; boundary guard in `apps/game/vite.config.ts` |
| Windows signing, SmartScreen, checksums and antivirus disputes | `docs/DESKTOP_DISTRIBUTION.md` |
| Model conditioning, LOD, texture and shadow budgets | `docs/ASSET_OPTIMIZATION_PIPELINE.md` |
| Environment dirt/decals/props/atmosphere rollout | `docs/ENVIRONMENT_REALISM_PLAN.md` |
| Audio inventory and remaining voice work | `docs/VOICEOVER_PLAN.md` and `docs/voice/` |
| Soundtrack rights and masters | `docs/MUSIC_PROVENANCE.md` |
| Third-party rights | root `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/` |
| Campaign implementation contract | `docs/campaign/CAMPAIGN_BUILD_SPEC.md` and `wiki/Campaign.md` |
| Graphics measurements and rejected approaches | `docs/RENDER_FINDINGS.md`, `docs/SPEC_DRIFT_AUDIT.md` |
| Cross-cutting AAA technical roadmap and ordered batches | `docs/AAA_TECHNICAL_ROADMAP.md`; Batches 9-10 evidence in `docs/reviews/batch9-10-framegraph-visual-depth.md` |
| Boot phase definitions and current browser/Electron baselines | `docs/BOOT_BASELINE.md`, compact reports in `artifacts/perf/boot-baseline-*.json` |
| Rejected Chrono Miner offline runtime-cook proof | `docs/RUNTIME_ASSET_COOK_POC.md`, `tools/asset-cooks/` |

Do not turn this handoff into another backlog. Put durable decisions in the owning document and open
work in `TODO.md`; keep this page as the discovery layer.

The Asset Lab currently indexes 110 model families / 434 GLB delivery files. Its character surface
exposes four humanoid roles per faction while loading eight canonical faction bodies and animation sets;
the Soviet selector additionally exposes the separately rigged Attack Dog quadruped.
Specialist and engineer identity comes from code-native instanced weapons and packs, with a hard
200-triangle ceiling per attachment. Redundant paid specialist bodies are archived under ignored
`meshy_output/`, not shipped. The bounded 512-unit WebGPU / 48-unit WebGL validation sweeps remain the
acceptance gate; do not copy GLBs or animation code back into an app-local asset directory.

The fourth humanoid role is a unique hero commander: Allied Field Marshal, Soviet War Commissar,
Meridian Hierarch and Reclamation Scrap Baron. Each ships below the user-approved 50,000-triangle
ceiling with one 24-joint skin, full base/normal/metallic-roughness PBR and separate mesh-free walk/run
clips. Gameplay samples a clip once during loading, maps the cheap instanced gait from limb skin weights
so capes and vestments do not flap like arms, then discards the skeleton. Asset Lab groups each commander
under the normal Infantry category. Geometry, PBR and rigging cost exactly 140 Meshy credits total;
accepted task IDs and measured budgets are recorded in `docs/ASSET_CONVERSION_MAP.md` and the four
commander concept READMEs.

The game development server mounts a draggable **Cheat Engine** (`Ctrl+Shift+C`) for bulk unit load
tests, free/instant production, 4,096-deep local queues, max-alive bypass, test-batch cleanup, ore
grants and army healing. It is deliberately not a `*.system.ts`: Bootstrap reaches it only through
an `__DEV__` dynamic import, the simulation mutators independently refuse calls when `__DEV__` is
false, and the production Vite build fails if any Cheat Engine UI marker reaches emitted assets.
Its X removes the panel completely, the shortcut restores it, and a header double-click is the only
compact/collapsed mode; do not restore a persistent launcher chip.

## Installed Codex capabilities used by this project

These are host-level tools, not repository dependencies. A new host may need them installed again.

- **`voltmarch-asset-pipeline` skill**:
  `C:/Users/Administrator/.codex/skills/voltmarch-asset-pipeline/SKILL.md`.
  It is mandatory for VOLTMARCH building, unit, vehicle, ship, aircraft, wreck, LOD, imported-model
  and texture-budget work. Read the whole skill before touching those assets.
- **Meshy plugin**, package `meshy-openai-plugin` version 0.4.1, currently installed from the curated plugin cache.
  Use its `meshy-3d-generation` skill for paid geometry/retexture/remesh calls.
- **Image generation skill** is used for coherent concept art and cardinal-view sheets before Meshy
  when a bitmap reference is needed. It is not a substitute for the local 3D conditioning pipeline.
- Browser and Windows-control plugins are available for live web/desktop validation. Keep one game
  browser instance unless a multiplayer test explicitly needs two.

The Meshy API key is local, gitignored configuration. Never print it, commit it, place it in this
document or copy it into prompts/logs.

## Paid asset-generation decision

The user granted standing approval for the Meshy actions required by the approved VOLTMARCH asset
pipeline, but credits are expensive and must not be spent speculatively. Current discipline:

1. Produce one coherent object in consistent front/right/back/left views.
2. Generate geometry **without texture first**.
3. Reject fused, swollen, gooey, asymmetrically hallucinated or hierarchy-breaking geometry before
   buying texture or remesh work.
4. Buy a texture pass only after geometry survives close, ordinary RTS and far-zoom review.
5. Prefer local retopology, node separation, normal repair, palette conditioning, LODs, shadow proxy
   and KTX2/Basis conversion over another paid call.
6. Record Meshy task IDs, credits, source views, chosen outputs and measured shipping budgets in the
   asset's concept README and conversion map.

The normal successful route has been 20 Meshy credits for multi-image geometry plus 10 for PBR
texture. Paid remesh is exceptional. The current account balance is intentionally not copied here;
read it from Meshy immediately before spending.

The current imported-unit checkpoint adds all four construction vehicles, all four aircraft, the
Soviet Attack Dog and the final seven naval transport/support hulls as faction-distinct Meshy shells.
The naval wave comprises both Soviet and Allied hover transports, the Soviet Assault Barge, Allied
Landing Craft, Meridian Sun Lighter and Argosy, and Reclamation Slag Hauler. Each ships through
`ImportedUnitAssets.ts` with a 24k-25k-triangle `Hull`, KTX2 PBR textures, a bounded shadow proxy,
reviewed colour LODs where simplification preserved the silhouette, and the procedural model as the
load/deploy/socket fallback. The private Meridian and Reclamation registries must list every imported
naval key before publication; their older warship imports were previously specified but omitted from
those registry key sets. The original naval wave used 210 Meshy credits (seven 20-credit geometry tasks
and seven 10-credit texture tasks). A later live Asset Lab review rejected those seven texture passes as
material-flat; seven ImageGen-authored material references and seven 10-credit Meshy PBR retextures replaced
them. The first corrected Slag Hauler reference also drifted into generic rust/orange, so that 10-credit pass
was rejected and a canonical graphite/violet replacement was generated. A later user art gate rejected
Argosy, Slag Hauler and Scrap Skimmer outright; all three were rebuilt from new ImageGen concept sheets
with new 20-credit geometry and 10-credit PBR tasks, without reusing rejected meshes or textures. Total
naval generation and texture spend is therefore 380 credits; accepted task IDs and measured budgets are
recorded in `docs/ASSET_CONVERSION_MAP.md` and the concept READMEs. The dog also has a local eight-joint review rig
with shared Idle/Walk/Run/Bite clips in Asset Lab; gameplay still uses its instanced gait. Vehicles and aircraft ship through
`ImportedUnitAssets.ts` with reviewed colour LODs, a geometry-only shadow proxy, required KTX2
textures and their original procedural model as the load/deploy/socket fallback. The dog uses the
same imported boundary with a 5,987-triangle LOD0, 2,561-triangle LOD1, 720-triangle proxy and the
shared instanced gait shader extended by a local longitudinal joint pivot; do not replace it with a
per-entity skeleton or mixer. The two paid construction-vehicle remesh attempts are recorded as
rejected in `docs/ASSET_CONVERSION_MAP.md`; do not revive those smoothed outputs. The first
Swarmhornet import also failed the live art gate and was archived outside the runtime. Its V2 replacement
uses geometry task `01a0448a-33fb-7d12-a912-52e9c04799f5` and texture task
`01a04490-df81-76d3-b463-f7382d144820`; do not restore the folded V1 fan/body geometry.
The Sputnik Dozer's front claw keeps its approved source-local rotation and receives only a -0.18
source-X mount translation, leaving a small mechanical overlap instead of a visible air gap. The
runtime yaw rotates the complete connected vehicle 180 degrees together. Do not rotate the claw again.
On MCV-only openings, every faction's imported construction vehicle must be loaded before its first
registry publication. All other seated-faction imports are also prepared before the curtain by
default: measured post-reveal GLTF parse/publication caused 150-270 ms visible freezes that an FPS
average hid. `?liveassetstream=on` is diagnostic-only until parsing can move to a worker or an
offline-conditioned runtime format. Do not restore runtime catalogue streaming as the shipping fast
path, and do not restore the former all-deferred path that visibly morphed the starting procedural
dozer into its imported shell.

## Non-negotiable art decisions

- Four factions must remain identifiable by silhouette, material language and accent colour, not
  merely by repainting one mesh.
- Imported hard-surface models need readable planes, creases and sharp mechanical edges. Gooey,
  uniformly smoothed geometry is a failed asset even when the triangle count passes.
- Do not ship a flat single-colour material. Preserve deliberate secondary materials, controlled
  wear, panel separation and faction accents without random red/purple spots.
- Do not mash an imported Meshy building together with the old procedural model to hide defects.
  Fix or regenerate the imported source, while keeping the procedural model as a loading/failure
  fallback.
- Turrets, barrels, ramps and other rotating/animated parts need separate closed geometry and stable
  pivots. Open cuts, transparent walls, broken normals and residual removed props are release blockers.
- Every imported asset needs normal-RTS readability, LODs, shadow behavior, WebGL/WebGPU compatibility,
  triangle/byte/texture caps and a procedural fallback. A close-up beauty shot is not validation.
- Dirt, grime, rust, leaves and dust must answer “why is it here?”. Use deterministic context stamps,
  shared atlases and instancing; never restore a uniform repeated ground-noise texture.
- Performance is part of the art gate. Spend triangles where silhouette earns them and recover cost
  through LODs, shadow proxies, shared materials, KTX2/Basis and batching.

## Platform and UX decisions

- Desktop is **WebGPU-first and WebGPU-locked** for normal play. Do not silently fall back to WebGL
  there. Browser builds retain the supported renderer negotiation/fallback path.
- Title/menu presentation is image-first. Show the key art and interactive menu before loading or
  compiling the game scene. Returning from a match must not block on shader preparation again.
- Out-of-game pages, overlays and the pause menu share the command-shell chrome in `shell.css`;
  extend that vocabulary instead of creating route-local modal skins. The Service Record owns the
  always-available Commander Identity editor and persists the same `gameplay.commanderName` consumed
  by Multiplayer, chat, results and replays.
- Browser builds do not show Quit because a page cannot reliably close its own tab. Desktop keeps a
  real Quit action through the validated Electron bridge. The pause exit is the prominent
  `Evacuate To Main Menu` danger action, not a low-contrast generic row.
- Do not pause loading, rendering or simulation solely because the desktop window loses focus.
- Electron disables renderer backgrounding at the process, window-construction and live-WebContents
  layers. This is the fix for cold Skirmish initialization appearing frozen after an Alt-Tab.
- Placement uses the real resolved structure silhouette, a faction-accent terrain grid and one
  unified allied build boundary. Completed structures rise from below grade.
- Use Electron native fullscreen semantics. Escape belongs to the game/pause UI; Alt+Enter is the
  explicit desktop fullscreen toggle. Starting a match never changes window mode.
- Windowed desktop play uses native Windows chrome and restores its last safe normal bounds/maximised
  state. Pointer confinement is enabled by default, remains desktop-only and releases on every menu,
  pause, focus-loss and visibility transition. An explicit saved `false` preference remains off.
- HUD density matters. Selection, stance and formation actions must remain compact; clicking a build
  card must not double the panel height or cover the battlefield.
- Plain Move is weapons-cold; Attack Move is the explicit move-and-fire order. An explicit Guard
  travels to its post cold, then fires from that post without inheriting Aggressive chase. Defensive
  aircraft keep a live Move authoritative and resume autonomous sight-envelope combat after arrival.
- The Objective and Construction panels are vertically resizable and persist their chosen heights;
  the Performance panel is draggable and persists its position. Objective rows are non-shrinking
  scroll items, so resizing a panel must never compress wrapped titles into the next row.
- The top command node reports current mode, difficulty and map. It does not duplicate an objective;
  the objective board remains the one source for main, side and global objective progress.
- Text defaults to 115% and is adjustable through accessibility settings. Fix clipping and layout at
  every supported scale rather than shrinking text locally.
- Performance diagnostics belong under Objectives, not in the middle of the battlefield.
- Desktop persistence uses Electron app-data storage, not IndexedDB/localStorage. Browser and desktop
  profiles remain separate and are not automatically migrated.
- `Unlock Everything` persists, opens skirmish content and campaign operations, and must not fabricate
  earned career statistics or honours.

## Audio decisions

- The original score is Silent Horizon, Disciplined Ostinato, Echoes of the Siege and Endless
  Warfront. The title rotates all four cues, beginning from a local random choice; matches choose a
  local random cue and loop it. In-match music is intentionally lower than menu music. The main-menu
  player can pause/resume without navigation or retry timers silently restarting it. Decorative
  title-world voices and explosions never duck the menu score.
- Finishing background WebGPU preparation must not restart, stop or duck the menu soundtrack.
- Unit speech is caused by selection or an explicit player action. Do not reintroduce periodic/random
  chatter, economy-state chatter or duplicated “unit ready” announcements.
- Effects, voices and ambience must survive rematch/retry and long sessions; stale match-end timers
  must not mute non-music buses in the next match.
- `AudioEngine.playBuffer` owns `source.onended` so every completed speech source releases its shared
  voice-budget slot. EVA and bark directors attach completion work through `PlayedBufferVoice.onEnded`;
  replacing the engine callback recreates the long-session total-voice-loss bug.
- `docs/VOICEOVER_PLAN.md` is the current production checkpoint. Campaign recording is explicitly
  outside the active non-campaign round until the user resumes it.

## Multiplayer and simulation decisions

- Multiplayer is deterministic lockstep. Chat and minimap pings are presentation messages and never
  enter `WireCommand`, turn frames, checksums or replay commands.
- Commander identity is a local handle, not an account. It appears in lobbies, matches, chat, end
  screens, Service Record and new replay headers.
- A departed opponent's seat transfers to AI so the survivor can finish. Reconnect/rejoin is still
  not shipped.
- Multiplayer speed is fixed at 1×. Single-player speed cycles through 0.5×, 1×, 1.5×, 2× and 2.5×.
- Profile-based unlocks are suppressed in multiplayer to prevent divergent local rosters.
- Relay deployments are deliberate/manual because activating one disconnects live rooms. A web-only
  or documentation-only change must not redeploy the relay.

## Release and deployment decisions

- SemVer policy: patch for fixes/polish without a new player-facing capability; minor for meaningful
  features, content or workflow-visible behavior. Ask when the classification is genuinely mixed.
- Never change a version merely to deploy documentation or a website-only correction.
- `main` pushes deploy only affected public surfaces through path-filtered workflows. Tagging a release
  is what produces desktop artifacts and release messaging.
- Keep the Discord release post aligned with what actually deployed. Do not claim relay, desktop or
  website changes when only the game shipped.
- The installed desktop updater checks after launch and every four hours, downloads in the background
  and asks before restart. Portable builds link to the manual download.
- Do not expose server passwords, SSH private keys, Meshy keys, Cloudflare tokens or Discord webhooks
  in tracked files. Public build identifiers/tokens belong only where their documented workflow
  explicitly treats them as public.

## Current open workstreams

This is an index, not a duplicate checklist:

- **Engineering backlog:** `TODO.md` — currently multiplayer seat/topology follow-ups, 3–4 player PvP,
  LAN/self-hosting, desktop distribution/signing and the bounded WebGPU visual-performance
  experiments below.
- **Asset conversion:** `docs/ASSET_CONVERSION_MAP.md` — continue imported assets only through the
  approved pipeline; do not infer completion from concept folders alone.
- **Environment realism:** `docs/ENVIRONMENT_REALISM_PLAN.md` — contextual dirt/leaf/rust/gravel
  composition, physical geometry debris, the completed authored prop-family catalogue and bounded
  atmosphere. Dynamic rain/lightning, snow-biome snowfall, cloud cover, far haze and ambient dust are
  shipped; one of the first two seeded weather windows is guaranteed heavy so the full presentation
  path is observable in ordinary matches. Industrial
  Grid is the deterministic eight-minute day/night pilot; it animates existing uniforms and one
  pooled lamp-decal gain only, with runtime PMREM rebakes explicitly forbidden after a measured
  ~90 ms WebGPU hitch. Correlation, biome aging and destruction continuity remain open.
- **Strategic air wing:** `docs/STRATEGIC_AIRBASE_PLAN.md` — all four faction-specific airbase/heavy-
  bomber pairs now have conditioned ImageGen-to-Meshy PBR assets, KTX2/LOD/shadow derivatives,
  procedural fallbacks, catalogue bindings and deterministic fixtures. Each base costs 3,000 credits,
  is capped at one per player and owns four single-payload bombers. Slice 1 failure handling and Slice 3
  balance/performance review remain open; do not regenerate the accepted meshes without a recorded
  visual or budget failure.
- **WebGPU visual performance:** `docs/WEBGPU_VISUAL_PERFORMANCE_PLAN.md` — desktop rendering is the
  product target. Use WASM for coarse CPU decode/SIMD work and WebGPU compute for render-owned
  culling, particles and temporal reconstruction. The live Chrono Miner is the one-asset Meshopt
  proof. A reproducible six-file Allied candidate saves 43.34% of its source bytes but missed the
  complete family-ready p95 gate on both renderers, so those source GLBs remain the default.
- **AAA technical roadmap:** `docs/AAA_TECHNICAL_ROADMAP.md` — Batches 1-10 have completed their bounded
  implementation/decision passes on local
  `main`: boot telemetry/baselines, static title policy, one honestly rejected
  offline runtime cook, broadleaf CPU foliage Gate 3/4, and dependency architecture Stage 0. This is
  generated match-content closure now gates reveal on complete definition/faction provider proofs;
  generic meshes cannot mask an exact RenderBridge miss, direct replay starts are revalidated, and
  registered first-use SFX no longer disappear during background baking. Batch 7 promotes the
  deterministic terrain ETC1S KTX2 (-71.30% transfer, -87.50% estimated full-mip residency) with
  fresh-Electron boot parity, rejects the six-file Meshopt default on latency, and adds opt-in
  mixed WebGPU compile/first-paint attribution. Batch 8 retains a correct 0.560 MiB tree/bush
  indirect-compute lab arm but rejects it as the default: CPU upload/event falls 44.83%, while
  corrected compaction-event p95 regresses 50%, moving whole-frame wall time regresses 11.42% and
  static wall time regresses 27.27%; CPU remains authoritative/default. Batch 9 reuses the
  full-resolution HDR bloom input in grade, removes four AO-accounted draws and improves measured
  native-WebGPU median 6.96%/8.25%/13.57% at 1080p/1440p/4K; retain `?postreuse=legacy` until AMD,
  Intel and packaged-Electron validation closes. Batch 10 replaces random base grime with
  deterministic role/biome/exit-aligned wear through the existing one-draw decal pool: the fixed
  fixture moves 41 -> 14 live marks and leaves 318 rather than 291 static slots with identical
  WebGL/WebGPU accepted-mark fingerprints and exact paired GPU/wall median parity. Continue at Batch
  11's narrow Game/Asset-Lab GLTF runtime
  extraction. Do not expand the compute pilot, promote either rejected cook, create generic
  `core`/`engine` packages or infer that package extraction is itself a boot optimization.
- **Voice production:** `docs/VOICEOVER_PLAN.md` — resume from its explicit checkpoint; campaign voice
  work remains excluded unless the user reopens it.
- **Campaign author decisions:** `docs/campaign/CAMPAIGN_BUILD_SPEC.md` §9. These are choices for the
  owner, not silent implementation tasks.

## User collaboration preferences worth preserving

- For large visual changes, show screenshots after meaningful milestones rather than waiting until
  the entire round is over.
- Keep working through an approved batch; do not stop after every tiny change for another approval.
- If a result is visibly wrong, do not keep layering patches over a bad foundation. Revert/regenerate
  from a clean source and record why the previous attempt was rejected.
- Use a separate worktree for invasive or long-running rounds so other programs/tasks are not
  interrupted.
- Keep only one browser/game instance unless the test itself requires more; stale Electron/browser
  processes have previously caused 100% GPU usage and misleading failures.
- When asked to open desktop dev mode, use the actual Electron desktop path and WebGPU, not a locked
  screenshot fixture. Confirm camera and live 3D updates rather than only confirming that HUD input
  reacts.
- Preserve evidence: screenshots, measurements, task IDs, source hashes and rejection reasons belong
  beside the feature/asset they explain, not only in chat.

## Before ending another long chat

- Update the owning decision documents and this index if discovery changed.
- Update `TODO.md` only for genuinely open work; remove completed rows.
- Ensure `README.md`, player wiki, `CLAUDE.md`, licences/credits and provenance match shipped behavior.
- Run the proportional gate, commit, push, and report what actually deployed.
- Leave the worktree clean or explicitly list every remaining local change and why it is uncommitted.
