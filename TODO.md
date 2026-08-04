# TODO

Requested work, not yet started. Each item carries the pointers I already have, so picking one up
does not mean rediscovering where it lives.

---

## 1. Beginner tutorial

New players currently get a main menu and a skirmish. Nothing teaches selection, orders, build order
or the economy loop.

Worth knowing before starting:
- `src/shell/Help.ts` already lists every command, generated from `src/input/ActionCatalogue.ts` —
  the tutorial should drive from that same catalogue so it can never teach a stale binding.
- The missions system (`src/progression/`, `src/data/Missions.ts`) already has match-scope
  objectives with live HUD tracking. A tutorial is arguably a scripted mission chain rather than a
  separate subsystem — worth deciding that first, because it changes the whole shape.
- `docs/MISSIONS_DESIGN.md` deliberately scoped *out* scripted triggers and authored maps. A
  tutorial probably needs both, so that decision may need revisiting.

## 2. HUD overhaul using GPT resources

**Ambiguous as written — resolve before starting.** Two readings:
(a) generate image assets (cameo art, icons, panel textures) with an image model, or
(b) use a model to redesign the HUD layout itself.

If (a), it maps onto a known and specific gap. From the last HUD verify pass, verbatim:

> Cameos are generic outline glyphs with no names — a flask for Battle Lab, an anchor for Naval
> Yard. In RA2/RA3 the cameo *is* a picture of the thing. You must hover to learn what you are
> buying.

Generated cameo art per unit and structure would fix exactly that. Note it would break the
"every asset generated from code" property the README currently claims — that claim would need
updating, or the assets confining to the HUD only.

Also still open from the same pass: the BASE STATUS dock is **~47% empty and fully redundant** —
all five of its stats already appear in the top strip.

## 3. Buildings are still a bit ugly

Art quality pass on structures. The shape language (`src/art/Shapes.ts`) and the clean-painted
texture law are both in place, so this is about using them harder, not new infrastructure.

- Owners: `src/art/BuildingFactory.ts`, `BuildingDefs.ts`, and the per-faction
  `Faction3Buildings.ts` / `Faction4Buildings.ts`.
- The Reclamation's structures are the newest and were built to seven explicit shape rules
  (RCL-1..7 in `Faction4Buildings.ts`) — worth reading as a template for what "designed" looks like
  versus "assembled from primitives".
- Measurable bar: bible §13 wants 40–46% Sobel coverage on buildings. The Reclamation measures
  19–26%, which is *below* the Pact and the Soviets. That is a concrete number to push.

## 4. Overlapping roads also overlap pavements

Bug. Where two road splines cross, the pavement geometry appears to overlap as well instead of
being cut back at the junction.

- `src/world/Roads.ts`. The network is spline-based with extruded kerbs and flanking pavements;
  junction handling is where the seam will be.
- Related note already in that file: corner "islands" carved out of pads are deliberately left for
  scatter to plant into, so any fix must not fill those.

## 5. Building on terrain should destroy props

Placing a structure on trees, rocks, crates or other scatter currently leaves them intersecting the
building instead of clearing them.

- `src/sim/Placement.ts` commits the placement; `src/world/Scatter.ts` owns the instanced props and
  already has the masks that stop props spawning on roads and buildable areas.
- Needs a "clear props in this footprint" call at commit time, and the instanced buffers updating
  without a full rebuild.
- Worth deciding whether clearing is silent or has a small effect (a puff, a felled tree) — RA3
  flattens vegetation visibly.

---

## Carried over — already known, not from this list

Kept here so they survive the session that found them.

- **The visual critic loop has never completed a round.** Built and validated, launched twice,
  stopped both times to avoid file collisions. Script at `scratchpad/ra-critique.mjs`. This is the
  outstanding piece of the original brief: nine per-piece critics scoring our renders side by side
  against real RA3, with adversarial verification.
- **Opening base placement is terrain-dependent and can produce an unplayable match.** One live
  Reclamation match on `temperate-valley` generated with no refinery, no defences and 6 of 9 walls
  ("No ore income" banner). Not reproducible headlessly across six seeds because the lobby threads
  `MapChoice.mapSeed` into terrain and the probe did not.
- **Three fatal scorecard failures remain** at 89.0%: `05-combat` #6 p99 highlights,
  `07-soviet-base` #9 green hue leak, `08-naval-water` #12 aerial perspective.
- **Unverified on the reporter's hardware:** the macOS Chrome black-flash fixes, and whether the
  rebuilt audio synthesis actually sounds good. Both have A/B procedures in the session notes.
