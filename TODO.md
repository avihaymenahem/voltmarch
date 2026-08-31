# TODO

**Outstanding work only.** A row here is open. When it closes, the row is deleted — there is no
"done" section, no changelog and no history, because this file has now rotted twice by accumulating
one.

**THE TASK LIST IS AUTHORITATIVE. THIS FILE IS A VIEW OF IT.** Every row carries its `#n`; a row
with no number is untracked, and that is itself the bug.

---

## Multiplayer

- **Teams shipped; two follow-ups it deliberately did not do.** *(untracked — the task tool was
  disconnected when these were found)*
  1. Start placement does not seat team-mates near each other. **It must not be fixed by rotating
     the start table** — ECMA-262 does not pin `sin`/`cos` to bit precision and terrain generates
     independently on both machines of a lockstep match, so that is a tick-zero desync.
  2. A campaign operation with 3+ seats still makes its extra foes mutually hostile. Nothing is
     wrong today — no shipped operation has more than two armies — but an operation that grows one
     should declare alliances next to `foe`.
- **#51 — 3-4 player PvP.** The merge layer is free; the drop rules and the removal signal are not.
  PvP seats exactly two today.
- **#55 — LAN and self-hosted multiplayer.** The desktop shell makes it possible and it did not ship.

---

## Desktop

- **#57 — production Windows signing and reputation.** The packaging and release workflow are
  signing-ready and now publish checksums/provenance, but the owner still needs to provision a
  trusted publisher certificate and CI secrets. Until consecutive releases are Authenticode-signed,
  SmartScreen and low-prevalence antivirus warnings remain expected; follow
  `docs/DESKTOP_DISTRIBUTION.md` for verification and false-positive submissions.

---

## Maps

- **Larger battlefields.** *(untracked — noted from tester feedback; explicitly deferred from the
  current bug-fix round)* Revisit map dimensions only with terrain generation, start clearance,
  camera limits, AI/pathfinding cost, ore density and multiplayer determinism measured together.

---

## Environment assets

- **Foliage engine final runtime acceptance.** Asset rollout is complete for all 32 stable Scatter
  identities and exact registry/catalogue equality is test-enforced. The imported path now starts with
  zero procedural Scatter archetypes; dormant builders are created only after an asset-load failure or
  an explicit `?foliage=procedural` request. `debrisPile` reuses the approved rounded rock-cluster
  family, so the old rectangular block rocks are gone. Extended vegetation shares one alpha PBR atlas;
  the remaining yard/street/civic set—including barrels, cafe umbrellas and all three cars—ships
  one-primitive static GLBs, topology-safe reduced LODs and one shared PBR atlas. Compact static props
  use 12-triangle casters; the component-separated tent and barrel compositions use audited 84- and
  128-triangle proxies so their shadows cannot collapse into giant AABBs.
  Finish only the engine acceptance work in `docs/FOLIAGE_ENGINE_PLAN.md` Gate 3/4: camera-band LOD
  bucket repacking, authored PBR wind/depth parity, shared KTX2 promotion, dense-copse WebGL/WebGPU
  timings and clearing/save restoration. Keep dormant procedural failure builders until those gates pass.

---

## Strategic air wing

- **Strategic air-wing failure handling and shipping gate.** *(untracked — planning requested directly;
  no task number assigned)* The deterministic four-faction gameplay catalogue, one-base cap, four-slot
  sortie contract, faction-specific ImageGen-to-Meshy art, KTX2/LOD/shadow assets, cameos and procedural
  fallbacks are complete. Finish only the remaining rehome/orphan, sale/capture, blackout,
  mid-production host-loss, bay-rack accessibility, balance and dense-base performance gates owned by
  `docs/STRATEGIC_AIRBASE_PLAN.md` Slice 1/3.

---

## WebGPU visual performance

- **Frame-graph representative-device closure.** *(untracked — Batch 9 follow-up owned by
  `docs/reviews/batch9-10-framegraph-visual-depth.md`)* The bloom-input reuse is default-on after
  improving median GPU time 6.96%/8.25%/13.57% at 1080p/1440p/4K on NVIDIA Ampere, with
  `?postreuse=legacy` retained. Repeat the native 1440p dynamic visual and timestamp cells on AMD,
  Intel/iGPU and packaged Electron WebGPU. The corrected native comparison has 0.00173/255 mean and
  zero p99 delta but two isolated pixels reach 18; do not remove the rollback until the device
  matrix and moving-emissive review remain stable.
- **GPU foliage expansion remains promotion-gated.** *(untracked — implementation order is owned by
  `docs/WEBGPU_VISUAL_PERFORMANCE_PLAN.md`)* The 1,648-instance tree/bush indirect pilot now proves
  immutable source upload, stable-ID/LOD/clearing parity, no steady readback and bounded storage, but
  remains lab-only behind `?foliagecompute=gpu`: upload/event falls 44.83%, but corrected compaction
  p95 regresses 50%, moving whole-frame wall time regresses 11.42% and static wall time regresses
  27.27%, with both bootstrap intervals entirely above zero. Do not expand to
  neutral props or temporal modes until a lower-dispatch/stable-output design produces a material
  whole-frame win. CPU placement, chunk broad phase, clearing and save identity remain authoritative.
- **Temporal reconstruction quality gate.** *(untracked)* TRAA and 75%/85% TAAU are lab-only URL
  paths. The short TAAU run saved 5.8–11.1% wall time but both scales lost infantry and panel-line
  definition. Do not promote either until edge-aware reconstruction/sharpening and moving-camera
  ghosting pass a fixed-seed readability scorecard.
- **Meshopt rollout remains latency-gated.** *(untracked)* A deterministic six-file Allied land/air
  candidate saves 11,228,312 bytes (-43.34%) and passes structural/visual parity, but complete
  family-ready p95 regressed 3.81% on WebGL and 3.27% on native WebGPU. The source GLBs remain the
  default. Revisit only with an upstream worker-decode A/B, a different measured family or changed
  delivery conditions, and require at least 10% p95 improvement including request, decode and scene
  construction before rollout. The rejected Float32 cook remains a separate counterexample.
- **WebGPU pipeline exercise and retention soak.** *(untracked)* The opt-in attribution now measures
  the mixed compile span and first-paint submission. Exercise VFX, LOD, construction and weather
  after reveal and require zero unexpected new pipelines, then run 10-20 same-process matches and
  prove program/pipeline counts and renderer RSS plateau before changing cache retention or keys.
  Include fresh Meridian boot, retained-renderer dispose/reboot and a development teardown during
  `compileAsync()` with fatal-console capture. A stale HMR window exposed a disposed-depth-texture
  context once; fresh isolated Electron/WebGPU passed, so this is a lifecycle regression gate rather
  than a material fix.

---

## Package boundaries

- **Batch 12 — extract the narrow audio runtime seam.** *(untracked — order and gates owned by
  `docs/AAA_TECHNICAL_ROADMAP.md`)* Break the `AudioEngine`/`Samples` cycle first, then extract only
  WebAudio lifecycle, buses and buffer utilities shared by Game and the browser audio probe into
  `@voltmarch/audio-runtime`. Keep recipes, EVA, barks, music policy, positional integration and
  `audio.system.ts` local. Require pre/post graph, production closure, audio-readiness and accepted
  first-use-event evidence; package movement alone is not a boot optimization.

---

## Not on this list, deliberately

`docs/campaign/CAMPAIGN_BUILD_SPEC.md` §9's undecided items are author decisions rather than work. The largest,
**UNDECIDED-1**, is **CLOSED**: on 2026-08-19 the author took option B and twelve `name:` rows were
renamed — tier 1 (MiG, a live mark of a real aircraft manufacturer) and tier 2 (the eleven Westwood/EA
coinages). Tiers 3 and 4 stand: Tesla Coil, Conscript, G.I., War Factory, Barracks and the rest are
real-world terms or genre idiom that nobody owns. No `key:` moved, so no save or replay on disk was
invalidated. It landed before a word of briefing prose existed, which is what made it cost 666 lines
instead of 22,750 words. §2.5 carries the table and the survey that priced it.
