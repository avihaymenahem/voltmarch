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
  one-primitive static GLBs, topology-safe reduced LODs, 12-triangle casters and one shared PBR atlas.
  Finish only the engine acceptance work in `docs/FOLIAGE_ENGINE_PLAN.md` Gate 3/4: camera-band LOD
  bucket repacking, authored PBR wind/depth parity, shared KTX2 promotion, dense-copse WebGL/WebGPU
  timings and clearing/save restoration. Keep dormant procedural failure builders until those gates pass.

---

## WebGPU visual performance

- **Compute-driven foliage visibility and LOD compaction.** *(untracked — implementation order is
  owned by `docs/WEBGPU_VISUAL_PERFORMANCE_PLAN.md`)* Prove immutable instance upload, GPU visibility,
  hysteretic LOD selection and indirect counts on trees/shrubs before expanding to neutral props.
  Placement, clearing and save identity stay authoritative on CPU and the current path remains the
  rollback arm.
- **Temporal reconstruction quality gate.** *(untracked)* TRAA and 75%/85% TAAU are lab-only URL
  paths. The short TAAU run saved 5.8–11.1% wall time but both scales lost infantry and panel-line
  definition. Do not promote either until edge-aware reconstruction/sharpening and moving-camera
  ghosting pass a fixed-seed readability scorecard.
- **Meshopt rollout decision.** *(untracked)* The Chrono Miner POC is 37.6% smaller and its shared
  SIMD decoder is fast in isolation. Measure packaged cold load including decoder startup, transfer,
  scene construction, KTX2 and GPU upload before compressing another imported family.

---

## Not on this list, deliberately

`docs/campaign/CAMPAIGN_BUILD_SPEC.md` §9's undecided items are author decisions rather than work. The largest,
**UNDECIDED-1**, is **CLOSED**: on 2026-08-19 the author took option B and twelve `name:` rows were
renamed — tier 1 (MiG, a live mark of a real aircraft manufacturer) and tier 2 (the eleven Westwood/EA
coinages). Tiers 3 and 4 stand: Tesla Coil, Conscript, G.I., War Factory, Barracks and the rest are
real-world terms or genre idiom that nobody owns. No `key:` moved, so no save or replay on disk was
invalidated. It landed before a word of briefing prose existed, which is what made it cost 666 lines
instead of 22,750 words. §2.5 carries the table and the survey that priced it.
