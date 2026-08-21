# TODO

**Outstanding work only.** A row here is open. When it closes, the row is deleted — there is no
"done" section, no changelog and no history, because this file has now rotted twice by accumulating
one.

**THE TASK LIST IS AUTHORITATIVE. THIS FILE IS A VIEW OF IT.** Every row carries its `#n`; a row
with no number is untracked, and that is itself the bug.

---

## Tips

- **Situational in-match tips — THE SURFACE is all that remains.** *(untracked; the plan is
  `TIPS_BUILD_SPEC.md`, whose §6 is down to one row and which names its own deletion condition.)*
  Commits 1, 2 and 3 shipped: the loading-screen tips no longer lie about rebound keys, and the
  feature is now a seven-row corpus (`src/sim/tip-rows.ts`) driven by a table in
  `src/sim/tips.system.ts`, with an entry-chunk weight cap, an arbiter that yields to alerts, and a
  per-row mute persisted at `PROFILE_VERSION` 4.

  What is left is ONE question, and it is not "build the card": a tip has one surface and two
  candidate replacements at very different prices. **A wider chip** (`is-tip` on `.vm-toast`, the
  detail wrapping) fixes §2.1's actual cause inside a claimant the frame-share budget already pays
  for. **A card** is a fourth claimant on a budget measured at 15.83% against a 12-16% ceiling, and
  it cannot be photographed at all — `simTick` does not run under `advanceFrames`, so no `?shot=`
  fixture can show a tip without a new harness affordance.

  **The trigger for widening is measured and has not fired.** The chip holds 26 characters of title
  and 44 of detail, and seven of seven shipped rows fit — titles 22-25, details 27-40. The evidence
  that would open this is a row that cannot say something true and useful inside those two numbers.

---

## Multiplayer

- **Teams shipped; three follow-ups it deliberately did not do.** *(untracked — the task tool was
  disconnected when these were found)*
  1. ~~**The minimap paints an ally in your own accent**~~ — **CLOSED 2026-08-19.**
     `SEMANTIC.ally` is the third blip class, `Minimap.alliedArmies()` publishes the legend rows,
     and `Sidebar.setArmies` takes two lists. The hue is DERIVED rather than picked: swept 0..359
     against the four faction accents, the four `HOSTILE_COLORS` and `SEMANTIC.ore`, the freest hue
     is 93 degrees at 47 degrees of clearance, and the shipped colour sits at 96.
     `tests/hud-palette.spec.ts` pins that floor at 40 and drives the real class; both mutations —
     dropping the "yours" branch and putting the ally back on the accent — were run and fail it.
     **A duel cannot reach the new branch**, so no `?shot=` fixture and no 1v1 pixel moved.
  2. Start placement does not seat team-mates near each other. **It must not be fixed by rotating
     the start table** — ECMA-262 does not pin `sin`/`cos` to bit precision and terrain generates
     independently on both machines of a lockstep match, so that is a tick-zero desync.
  3. A campaign operation with 3+ seats still makes its extra foes mutually hostile. Nothing is
     wrong today — no shipped operation has more than two armies — but an operation that grows one
     should declare alliances next to `foe`.
- **#51 — 3-4 player PvP.** The merge layer is free; the drop rules and the removal signal are not.
  PvP seats exactly two today.
- **#55 — LAN and self-hosted multiplayer.** The desktop shell makes it possible and it did not ship.

---

## Desktop

- **#56 — desktop players start with an empty profile.** Partly closed: export/import verified
  working under `app://` on a real Electron launch. What remains is that nothing migrates
  automatically, the buttons sit on the Missions screen rather than Options, and an empty profile
  also disarms the AI (`UnlockGate.mirrorAI` resolves it against the human's profile).
- **#57 — distribution and signing.** Research only.

---

## Gameplay

- **#48 — per-map spawn geometry.** A `StartTable` keyed like `MAP_SEAS`, plus `seaOffMapCentre`
  taking the normal as a parameter. **It must not be authored by rotating the table** — ECMA-262 does
  not pin `sin`/`cos` to bit precision, terrain generates independently on both machines of a
  lockstep match, and that is a tick-zero desync. Permutation and power-of-two scaling are exact.

---

## Renderer and docs

No open renderer/doc implementation items remain from this round. WebGPU GPU time now comes from
Three's real `timestamp-query` path; the intentionally unavailable colour-pass split still reads
`n/a`, because total draws are not a substitute for colour draws.

---

## Cleanup: calls that were left for a human, and still are

Decisions, not work. Nobody should sweep them without an answer.

- **`docs/surface-refs/ours-*.png`** — 4 files, 4.6 MB, tracked and unreferenced. Reference captures
  of our own output. Cite them from the look bible or delete them.
- **The selection-card portrait API** — `kindMeshFor`, `kindMeshVersion`, `HUD_PORTRAIT`.
- **Further dead exports** — this round removed 56 declarations only after repository-wide symbol
  searches and typecheck. Automated scans still include dynamic entrypoints and intentionally public
  types, so any further removal remains a per-symbol review rather than a bulk cleanup.

---

## Not on this list, deliberately

`CAMPAIGN_BUILD_SPEC.md` §9's undecided items are author decisions rather than work. The largest,
**UNDECIDED-1**, is **CLOSED**: on 2026-08-19 the author took option B and twelve `name:` rows were
renamed — tier 1 (MiG, a live mark of a real aircraft manufacturer) and tier 2 (the eleven Westwood/EA
coinages). Tiers 3 and 4 stand: Tesla Coil, Conscript, G.I., War Factory, Barracks and the rest are
real-world terms or genre idiom that nobody owns. No `key:` moved, so no save or replay on disk was
invalidated. It landed before a word of briefing prose existed, which is what made it cost 666 lines
instead of 22,750 words. §2.5 carries the table and the survey that priced it.
