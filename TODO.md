# TODO

**Outstanding work only.** A row here is open. When it closes, the row is deleted — there is no
"done" section, no changelog and no history, because this file has now rotted twice by accumulating
one.

**THE TASK LIST IS AUTHORITATIVE. THIS FILE IS A VIEW OF IT.** Every row carries its `#n`; a row
with no number is untracked, and that is itself the bug.

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

- **#57 — distribution and signing.** Research only.

---

## Renderer and docs

No open renderer/doc implementation items remain from this round. WebGPU GPU time now comes from
Three's real `timestamp-query` path; the intentionally unavailable colour-pass split still reads
`n/a`, because total draws are not a substitute for colour draws.

---

## Not on this list, deliberately

`docs/campaign/CAMPAIGN_BUILD_SPEC.md` §9's undecided items are author decisions rather than work. The largest,
**UNDECIDED-1**, is **CLOSED**: on 2026-08-19 the author took option B and twelve `name:` rows were
renamed — tier 1 (MiG, a live mark of a real aircraft manufacturer) and tier 2 (the eleven Westwood/EA
coinages). Tiers 3 and 4 stand: Tesla Coil, Conscript, G.I., War Factory, Barracks and the rest are
real-world terms or genre idiom that nobody owns. No `key:` moved, so no save or replay on disk was
invalidated. It landed before a word of briefing prose existed, which is what made it cost 666 lines
instead of 22,750 words. §2.5 carries the table and the survey that priced it.
