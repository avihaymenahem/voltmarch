# Target look — two user-supplied references

## 2026-09-01 approved HUD direction — Command Deck

The current HUD authority is the user-approved Command Deck concept supplied in
the implementation thread. It supersedes the older cyan-sidebar composition in
§A wherever the two conflict. The approved desktop composition is:

- a continuous gunmetal top status bar with a deep centred operation/crest bay;
- objectives at upper left;
- a large armoured minimap at lower left with the live selection inspector
  immediately beside it;
- five large orders centred along the bottom: Guard, Attack, Move, Stop,
  Scatter;
- a wide lower-right build console with an explicit BUILD title, category tabs,
  and four columns by two visible rows of live mesh cameos;
- neutral blue-black armour, mint interaction/selection light, amber warnings,
  and violet reserved mainly for operation identity.

The live HUD remains DOM + CSS, the icons are SVG, the minimap is canvas, and
build/selection cameos are rendered from the game's actual meshes. The outer
gunmetal shell now uses one project-local ImageGen material plate so the bevels,
fasteners, wear and recess shadows reproduce the approved render instead of
being approximated with flat CSS gradients. It contains no labels, gameplay
data, minimap pixels, icons or baked interaction states.

Supplied 2026-08-05 with: *"Thats the new HUD design i was hoping for"* and *"this is what the game
should look like as well (hopefully)"*.

**The images are NOT in this repository.** They live at `docs/refs/target-hud.png` and
`docs/refs/target-base.png` on the author's machine only — `docs/refs/` is caught by the `refs/`
rule in `.gitignore`. What follows is a transcription written while they were on screen, kept
because it names the specific things worth copying and ranks them by cost. It is not a substitute
for the files: **read the pixels.** Where this document and the images disagree, the images win —
so if you are reading this from a clone, treat every impression below as second-hand.

This file used to live beside them in `docs/refs/` and was therefore ignored too. It was moved out
on 2026-08-07 because seven places in `apps/game/src/ui/` cite it as the authority for the HUD's construction,
and a design authority that exists on exactly one unbacked-up disk is one reformat away from
leaving those citations pointing at nothing.

Both images are AI-generated reference art (the HUD image's text is garbled — "DAJFCTVES",
"HLAVERS", "HEADRUARTERS"). They are **direction, not assets**. Nothing here ships as a bitmap.

Relationship to [`RA3_LOOK_BIBLE.md`](RA3_LOOK_BIBLE.md): the bible remains the measurable law and
its scorecard still decides pass/fail. These references say what to aim the dials *at*. Where the
bible has a measured target and this document has an impression, the bible wins.

---

## A. The HUD reference

### A.1 Panel construction — this is the whole identity

Every panel is the same object at different sizes, and getting this one construction right is most
of the redesign:

- **Fill**: near-black with a blue cast, roughly `#080d18` at the centre lifting to about `#0d1526`
  toward the edges. Effectively opaque — this is not a light frosted glass.
- **Frame**: a *double* line. A thin dark outer rim, a gap, then a brighter cyan-blue inner bevel
  around `#3da9f5`, with the brightest value on the top and left edges and a cooler `#2b7fd4` on the
  bottom and right. The bevel reads as a lit metal channel, not a CSS border.
- **Corners are cut, not rounded.** Each corner is chamfered at 45°, and a short bright segment runs
  along the chamfer. Several panels additionally carry **corner brackets** — small bright L-shapes
  inset from the frame, detached from it.
- **Glow**: the cyan lines carry a soft bloom. Restrained — it reads as emissive, not as a blur.

Current `hud.css` reaches for bevel and gradient in a way the user has already called "SUPER
outdated". The difference is not "less bevel": it is that here the bevel is a **single crisp lit
edge** rather than a soft multi-stop gradient ramp.

### A.2 Layout

- **Top strip** — full width, one continuous bar. Faction crest in a shield at far left, game name
  above a small "Level 12" line. Then resource groups, each `icon + large value + small-caps label`
  (POWER, credits, ore, SUPPLY, and a match clock), separated by thin vertical dividers. Two icon
  buttons at the far right.
- **Objectives, top left** — header "OBJECTIVES" with a horizontal rule running right from the word.
  Then **two labelled sections, "PRIMARY OBJECTIVES" and "SECONDARY OBJECTIVES"**, each in
  letterspaced small-caps grey, separated by a thin rule. Each row is a small round icon plus text.
  **Four objectives are visible at once.** See §C.
- **Players, top right** — header "PLAYERS", then one row per player: faction colour chip, name,
  right-aligned score. Four players.
- **Minimap** — the map is drawn as its **actual irregular shape**, not a rectangle, with territory
  as soft colour glows. Framed in its own panel.
- **Command bar** — a short strip of four icon buttons in its own small panel, above the minimap.
- **Selection card** — name in caps under a rule, cameo image left, description text right, and a
  full-width green health bar at the bottom with `2500 / 2500` overlaid on it.
- **Build palette, bottom right** — a row of **notched tabs rising above the panel body**
  (BUILD / UNITS / UPGRADES / COMMAND), active tab lit. Below it a grid of cameo cells, each with a
  cost badge (credit icon + number) at bottom left. The item under construction spans **two cells
  wide**, showing a progress bar and label instead of a cameo.

### A.3 The cameos — the most important detail in the image

**Every cameo is a small three-quarter render of the actual structure.** Not a glyph, not an
outline, not a silhouette. This is precisely the gap already recorded in `TODO.md` §2:

> Cameos are generic outline glyphs with no names — a flask for Proving Ground, an anchor for Naval
> Yard. In RA2/RA3 the cameo *is* a picture of the thing.

**This does not require generated image assets, and therefore does not break the README's
"every asset generated from code" claim.** `apps/game/src/ui/Cameos.ts` already renders cameos from the real
game mesh into a cached render target — its header says so. So the fix is to make the real path work
for every def rather than to import bitmaps. The 29 hand-drawn vector fallbacks in that file exist
because "a def key may not resolve to a model, and until every art module lands most of them will
not". **The measurement that matters is what fraction of defs still hit the fallback.** If that
number is high, the mockup's look is unreachable and that is the reason.

---

## B. The base reference

A dense violet-faction base seen from a high oblique angle. This is the harder of the two targets.

### B.1 What actually makes it read — ordered by cost

Most of the difference is not triangle count. That ordering matters because the game is GPU-bound
today (77.9 ms median at native 2560x1440, 203 draws, 1.75M triangles), so anything expensive is
gated behind the performance work.

**Near-free — material and texture only:**
1. **Team colour is the dominant surface, not an accent.** Saturated violet covers the majority of
   every structure, ranging from near-black violet in shadow to bright lilac in the key light. Ours
   currently treats faction colour as trim. This single change is probably the largest perceptual
   delta in the whole image.
2. **Emissive strips everywhere.** Small linear magenta/pink glowing vents, window slits and panel
   seams on nearly every building. Numerous, small, and thin — never large glowing areas.
3. **Yellow/amber hazard accents.** Kerb edging, platform lips, short stripes. Sparse per building
   but present on most of them, and the only warm hue in a cool scene — which is exactly why it
   reads.

**Cheap geometry, large silhouette gain:**
4. **Every structure sits on a raised concrete plinth** with a chamfered edge, a lighter top face,
   and often a kerb or railing around it. This is a handful of triangles per building and it is what
   makes the base read as *built* rather than *placed*.
5. **Strong verticals.** Masts, spires, dish antennae, hanging banners on poles, chimneys. They
   break the horizontal skyline and cost almost nothing.

**Expensive — gated behind the GPU work:**
6. High organised greeble density: pipes running along roof edges, catwalks, ladders, vent rows.
   Dense, but *organised* — it follows edges and repeats, it is not scattered.

### B.2 Ground, roads and props

- **Grass is vividly saturated green**, in hard contrast against grey concrete. Not muted, not
  olive.
- **Roads**: dark grey asphalt, **yellow centre lines**, **white crosswalk bars**, light grey kerbs,
  and concrete slab paving with visible joints in the plaza areas. Directly relevant to TODO #4 —
  note that in this reference the pavement is **cut cleanly at every junction**, which is the bug.
- **Props**: red/orange/brown shipping crates, civilian parasols, rocks, palm and broadleaf trees,
  all sitting on grass — never intersecting a structure. Directly relevant to TODO #5.
- **Steam**: two or three thin white vertical plumes from stacks. Cheap, and they add life.

### B.3 Camera and light

- High oblique, roughly 50° from horizontal, **perspective**, close enough to read building sides
  clearly while still reading the layout from above.
- Strong key from the upper left, crisp dark shadows with visible contact shadows under everything.
- Warm sun on the grass against cool shadow. No fog. (Fog on daylight maps remains banned.)

---

## C. What these references change about work already in flight

- **TODO #3 (buildings)** — the running agent was told its triangle and draw-call delta must be
  `<= 0`, because the user is at 100% GPU. That constraint still stands. Items B.1 §1–5 are all
  reachable inside it; item 6 is not. **Do not relax the constraint to chase the reference.**
- **TODO #4 (roads)** — the reference confirms the intended junction behaviour: pavement cut back
  cleanly, corner islands planted with scatter.
- **TODO #5 (props)** — the reference shows props abutting structures but never intersecting them,
  which is the target state.
- **TODO #6 (objectives)** — the reference shows **four objectives visible at once, grouped into
  PRIMARY and SECONDARY sections.** Our panel caps at `MAX_VISIBLE_OBJECTIVES = 3` and the overflow
  line replaces the third row, so two show. The grouping is a better answer than a flat expander and
  the agent should consider it — but the §38 HUD frame budget (12–16%, panel already at 16.3%) is a
  measured constraint and the reference is not, so measure before adopting.
- **TODO #2 (HUD)** — the ambiguity is resolved. It is a **visual treatment and layout** redesign
  (§A.1, §A.2) plus **making the existing model-render cameo path work for every def** (§A.3). It is
  *not* a request to import generated image assets, and the README's claim survives.
