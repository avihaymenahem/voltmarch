# VOLTMARCH environment realism and prop renewal

Status: authored catalogue and first atmosphere slice shipped; composition/aging acceptance remains · owner: world/art pipeline · updated 2026-08-30

## Intent

Make maps feel inhabited, weathered, and specific without covering the battlefield in noise or
turning environmental dressing into the dominant GPU cost. The target is authored composition:
clean gameplay lanes surrounded by clustered evidence of traffic, industry, weather, and civilian
life.

The current baseline is asset-driven: all 32 stable Scatter identities resolve to audited authored
LOD/caster families and shared PBR atlases, while placement is still chunk-culled and static/transient
ground marks remain pooled into two bounded decal draws. Dormant procedural builders exist only for
explicit diagnostics and load failure. The direction keeps those placement, batching and budget
contracts; it does not replace them with thousands of independent runtime objects or unique 2K textures.

## What remains

- More context families. Dirt, oil, rubble and props now form a first set of small stories around
  roads, openings and structures; depots, civilian blocks, shorelines and resource sites still need
  more authored combinations.
- More context-specific contact variation. Continuous terrain-space dust, grit and sparse cracks are
  live without added draws; mud, leaf litter and loose gravel still need geometry or broad material
  composition that cannot read as repeated circular stamps.
- Final foliage-engine acceptance. Asset delivery now covers every stable Scatter identity; the
  remaining work is camera-band LOD dispatch, wind/depth parity, dense-scene performance and saved
  clearing restoration before dormant failure builders can be deleted.
- Biome aging. The same object should collect dust in desert, damp grime in temperate maps, exposed
  rust around salt water, and dirty snow at roadsides without requiring a unique material per object.
- Destruction continuity. Scorch, craters, tracks, and construction clearing exist; persistent small
  rubble and disturbed-ground compositions need to connect them visually.

## Current implementation checkpoint

The first static composition slice is live, with one important correction from in-product visual QA:

- leaf, gravel and paper atlas stamps were rejected. At RTS distance their authored lobes read as
  rings of dark circles, so normal map generation no longer has any runtime spawn site for those
  three physical-debris decal kinds;
- physical debris is geometry-only: a new low-profile batched debris pile combines stones, timber,
  rusted plate and pale scraps, settles deterministically around MCV openings and does not block nav;
- deterministic ground stories are restricted to marks the multiply layer represents truthfully:
  tyre tracks, oil, faint dust/grime, scorch and craters;
- road and ore edges no longer receive gravel atlas stamps. A future pass must solve those edges
  with terrain composition or real geometry, not by restoring oval decal clusters;
- structure footprints receive bounded dust, grime, rust and occasional oil outside their gameplay
  clearance;
- a destroyed structure leaves fading demolition dust and faint permanent grime beneath its
  existing faction-specific rubble geometry; the rejected broken-stone decal fans are gone;
- composition remains deterministic and idempotent, and the shared ground-story ceiling remains 92
  marks before base wear and combat effects;
- WebGPU terrain and scatter objects are batched by shadow policy, so the additional composition
  does not restore the cold-start pipeline duplication removed during the Electron boot pass.
- both terrain backends now add continuous world-space dust sweeps, meso grit and sparse crooked
  cracks in the base material. Coverage anti-aliasing changes only crack edges, never whole-feature
  opacity, so panning cannot make a patch pulse in and out;
- both terrain backends also sample the project-owner-supplied tileable grayscale detail mask at a
  72 m world-space repeat. It is a deliberately restrained base-surface exception to the normal
  ban on global grime: natural surfaces receive a readable but bounded +/-22% extreme luminance
  range plus a small roughness response, multiplied by normalized ground/dirt/sand/rock ownership;
  a separate colour-quiet but roughness-forward pass reuses the same GPU texture on asphalt and
  sidewalk paving before road markings, while raised kerbs remain untouched;
- the pooled decal field conforms every mark with a 6 × 6 grid. Marks remain bounded to the same two
  draws while following local height changes closely enough not to shimmer against the terrain;
- roads carry restrained shoulder ageing in their own material, taper valid interior termini and
  enforce one owner per sustained corridor: directional A* reservations, whole-chain rerouting and
  a post-bend audit remove independent near-parallel routes, shared approaches coalesce at divergence,
  and full-width cliff/water validation cuts both safe banks with an authored end fade before the
  overlap-triangle culler is needed as a final safety fuse;
- roadside amenities now follow exact kerb runs with sparse independent layout policies. Lamps face
  inward over the carriageway, most runs remain empty, and only deterministic faulty lamps flicker;
- the approved imported wreck is conditioned as a reusable debris family with procedural fallback;
  repeated roadside cars/planters/benches were reduced so limited prop diversity is not amplified by
  uniform spacing;
- all 32 stable Scatter identities now resolve through audited imported families. The successful
  imported path constructs zero procedural Scatter archetypes, while scenario-spawned trees, bushes,
  rocks, barrels and crates bind to the same loaded PBR geometry/materials;
- the old rectangular `debrisPile` blocks are removed from imported presentation; that identity now
  reuses the approved rounded and striated rock-cluster LOD/caster family;
- autumn tree, conifer, palm and both grass tufts share one ImageGen-derived alpha PBR atlas. The
  remaining yard, street and civic props share a separate neutral PBR atlas and offline static GLBs;
  barrels, cafe umbrellas and sedan/van/pickup families have explicit WebGL/WebGPU cardinal proofs;
- civilian apartments are six separately scattered, mirrored strongpoints hidden until scouted;
  Oil Derrick, Hospital and Ore Mine counts are unchanged.

The original 2026-08-26 matrix was technically clean but failed later in-product readability review:
the physical-debris stamps were visibly artificial. The corrected contract is now pinned by tests:
no leaf/gravel/paper decal can spawn from openings, roads, ore edges, semantic scatter stories or
demolition rubble. The geometry replacement remains inside the existing WebGPU prop batches.

Dynamic atmosphere is also live. Skirmish Advanced settings can disable weather; when enabled, seeded
presentation state selects clear, light-rain or heavy-rain windows without entering the deterministic
simulation. Rain uses narrow camera-projected streaks in WebGPU and WebGL, windows last 84–114 seconds
to avoid rapid switching, and occasional lightning briefly raises the existing sun and hemisphere
lights so the flash affects the world and its shadows. Film grain is a separate restrained post layer
at 0.006 strength and 12 Hz, capped by the look bible at 0.008.

Desktop WebGPU additionally ships the first cinematic atmosphere slice on Medium through Ultra:
world-locked cloud cover and capped height-aware far haze are fused into the existing HDR composite,
preserve emissive peaks, exclude sky depth and never lift undiscovered shroud. Sparse ambient dust
reuses the lit-particle draw, emits only over visible non-water cells, yields to combat smoke and is
scrubbed almost completely by rain. Low and the browser fallback disable this desktop-only slice.

## The five-layer solution

### 1. Surface variation — existing terrain, no extra object draws

The live baseline uses low-frequency world-space dust sweeps, material-filtered cracks, meso grit,
the restrained owner-supplied natural-terrain detail mask and road-shoulder ageing. Future additions remain context-driven: compacted depot dirt, muddy drainage,
exposed earth under autumn canopies, salt-stained shoreline strips, and gravel near ore fields. They
must be broad irregular compositions tied to features, not a repeated texture applied everywhere.

Rules:

- keep the terrain hue/tone contract in `docs/VISUAL_DNA.md`;
- never add screen-visible uniform noise or a globally repeated grime texture;
- reserve clean negative space around selection, building exits, and primary combat lanes;
- deterministic placement from map/scenario seed only.

### 2. Ground story decals — preserve the bounded two-draw atlas

The atlas is reserved for shapes its multiply/additive layers represent honestly: tyre tracks, oil,
scorch, craters, faint dust/grime and demolition dust. It supplies pooled geometry, 6 × 6 terrain
conformance, eviction, mipmaps, and WebGL/WebGPU paths without adding a draw call. Leaf litter,
paper, gravel and broken stone remain excluded after their lobed stamps read as dark circles; those
materials require broad terrain composition or actual batched geometry.

Density is measured in clusters, not specks. Rust belongs beneath metal or drainage points, oil near
factories, depots, wrecks and parked vehicles, and physical litter must have a visible source.

### 3. Foliage engine families — improve silhouettes, preserve batching

Every promoted prop remains cached and instanced through the shared foliage engine. Deterministic
placement, 32 m chunk culling and bounded clearing remain under Scatter's existing contract while
the engine owns loading, material families, LOD buckets, shadow proxies and packaged fallback
derivatives. Imported candidates are conditioned into a shared family atlas; they do not retain
Meshy's arbitrary material stack. Per-instance hue/value variation remains available.

| Family | Route | LOD0 target | LOD1 | Shadow proxy | Texture rule |
| --- | --- | ---: | ---: | ---: | --- |
| Civilian sedan/van/pickup | Meshy pilot, then local hard-surface conditioning | 1.5k–3k tris | 600–1.2k | 200–400 | one shared 1K KTX2 vehicle atlas |
| Umbrella/table/bench | local authored kit; Meshy only if silhouette review fails | 300–900 | 120–350 | 80–200 | shared civic trim/vertex colour |
| Crates/pallets/barrels | local modular kit | 150–700 per composition | 80–250 | 60–160 | shared yard trim/vertex colour |
| Crate stack/flower box pilot | deterministic local box kit; ImageGen surface/canopy | 16–60 | 14–60 | 12–24 | one shared 1K/512/512 alpha PBR atlas; forged-iron mask is metallic, timber/soil/flowers remain dielectric |
| Autumn/conifer/palm/grass | compact authored card/trunk families | 8–170 | 4–168 | 24–40 | one shared ImageGen alpha-tested 1K/512/512 PBR atlas |
| Remaining yard/street/civic props | offline bake of reviewed authored silhouettes | 164–2,376 | topology-safe ~30–58% far deliveries | 12 | one shared ImageGen-derived metal/wood/hay/stone 1K/512/512 PBR atlas |
| Bush/clipped hedge | deterministic local cards; separate ImageGen branch/panel sources | 12–28 | 10–16 | 12–48 | one shared alpha-tested 1K/512/512 PBR atlas plus biome vertex tint |
| Boulder/rock cluster | deterministic local closed family; shared ImageGen-refined surface | 450–576 | 224–240 | 144–150 | one shared 1K/512/512 PBR set plus biome vertex tint; no unique map |
| Ore shards/field clutter | local authored gameplay kit | 150–800 per cluster | 60–250 | 40–140 | shared ore material/emissive mask |
| Wrecks/hero roadside objects | Meshy where a distinct silhouette earns it | 2k–5k | 700–1.8k | 250–600 | shared 1K KTX2 family atlas |

These are prop-specific working budgets beneath the building/vehicle ceilings in the imported-asset
pipeline. At ordinary RTS zoom the silhouette and colour blocks must justify every triangle.

### 4. Context stamps — composition instead of random scatter

Create deterministic templates that combine a few existing systems:

- parked car + tyre/oil mark + curb litter;
- depot crates + pallet + dust/oil stain;
- autumn tree + leaf-litter patch + sparse grass;
- ore field + gravel stain + broken shard cluster;
- civilian cafe + umbrellas + tables + paper/leaf edge litter;
- industrial building + service path + rust runoff + two utility props;
- wreck + scorch + debris fan + disturbed ground.

Templates own exclusion radii and gameplay clearance. Scatter still owns biome legality and chunk
culling. The template system only makes placements correlate.

### 5. Dynamic atmosphere — pooled and quality-scaled

The first restrained slice is shipped: weather rain/lightning on both renderers plus WebGPU cloud
cover, far haze and ambient dust on Medium–Ultra. These effects are presentation-only, deterministic
from render state rather than simulation authority, and bounded by existing post/particle passes.
Future wind-driven leaf groups, movement dust and debris settling must follow the same ceilings and
yield to combat readability instead of creating another full-screen layer.

## Meshy pilot: one vehicle before a roster

The best first use of Meshy is one civilian sedan, because its curved hard-surface silhouette is more
expensive to improve procedurally and its normal-map/roughness response can be judged clearly on snow,
desert, and temperate ground. Crates, ore pieces, umbrellas, and most rocks are cheaper, cleaner, and
more batchable as local modular geometry.

Proposed paid sequence:

1. Generate four consistent orthographic concept views outside Meshy.
2. Meshy 6 multi-image geometry only, no texture: **20 credits**.
3. Audit cardinal views, negative spaces, wheel arches, glazing, underside, actual triangle count, and
   normal RTS silhouette. Reject here if it is swollen or fused.
4. Only after geometry approval, request PBR texturing: **10 credits**.
5. Use a Meshy remesh only if local conditioning cannot reach the budget without breaking the form:
   optional **5 credits**.

Maximum approved pilot spend: **35 credits**; normal successful route: **30 credits**. Balance at
planning time: **1,870 credits**.

### Pilot result - civilian sedan

The full approved pilot completed on 2026-08-26 and consumed the 35-credit ceiling:

- Meshy 6 multi-image geometry (`01a03d71-9a34-7f70-a29d-07e289471f78`): **20 credits**;
- dedicated triangle retopo (`01a03d7b-0e83-777a-baaa-8c3b23cb5fa3`): **5 credits**;
- PBR retexture (`01a03d7f-a09f-753b-984c-ffc95d0cb13f`): **10 credits**.

Geometry review found six coherent components: one body shell, four separate wheels, and one
underside plate. The 3,125-triangle retopo retained the silhouette and all four wheel gaps. Local
conditioning brought the approved source to **2,963 triangles**, inside the 3k LOD0 target, without
changing those components.

The material pass uses faded blue-grey civilian paint, dark glazing, rubber tyres, steel hubs,
restrained road dust, and localized seam grime. It avoids faction markings, broad rust washes,
baked lighting, and random accent spots. Texture conditioning reduced the maps to a 1K base and
normal plus 512px packed metal/roughness. KTX2/Basis promotion reduced the candidate from **0.72 MiB
to 0.62 MiB** and the conservative decoded texture estimate from **12 MiB to 2 MiB**.

The candidate and full task history live in the ignored `meshy_output/20260826_124103_*` project.
It is approved as an integration candidate, not yet a runtime replacement. The procedural sedan
remains the fallback until the shared prop-family material, instancing, shadow proxy, LOD1, WebGL,
WebGPU, and scene-budget gates pass.

## Foliage engine pilot: one broadleaf before the environment roster

The next pilot is the existing `tree` key, a 10–12 m temperate broadleaf. Its complete architecture,
art brief, budgets, credit stops and acceptance matrix live in `docs/FOLIAGE_ENGINE_PLAN.md`.

The pilot deliberately precedes bulk conversion. It must prove the asset-driven runtime while
retaining the existing placement fingerprint, chunk culling, wind/shadow agreement, crushing,
felling persistence and coverage gate. The procedural broadleaf remains a development fallback only
until the approved source produces LODs, a shadow proxy and a packaged emergency derivative.

## Rollout order

1. Baseline the procedural temperate broadleaf and build the asset-driven foliage-engine POC.
2. Promote the broadleaf only after the WebGL/WebGPU art, LOD, wind, clearing and scene-budget gates.
3. Continue the foliage family after the integrated bush/hedge pair, then yard, street and civic
   families; boulder/rock-cluster mineral anchors are already integrated.
4. Civilian sedan pilot: integrate it through the same engine's rigid-prop path and shared vehicle atlas.
5. Continue context-specific terrain composition and destruction continuity around approved families.
6. Dynamic dust/leaves, then quality scaling from measured GPU timings.

## Gates

- No change may raise the live prop-type ceiling above 30 or add per-instance materials.
- Asset loading must never influence placement fingerprints, clearing masks or simulation state.
- Every migrated family ships LOD/shadow/emergency derivatives before its local builder is removed.
- Capture colour draws, shadow draws, visible instances, library triangles, upload bytes, decoded
  texture memory, and GPU pass time before/after.
- Imported geometry must pass close, normal RTS, and far zoom in WebGL and WebGPU, noon and dusk.
- New assets retain the procedural fallback until art and performance parity pass.
- No unique 2K texture for a small prop; use shared atlases, KTX2/Basis, or vertex colour.
- No globally uniform grime/noise pass. Dirt and wear must answer “why is it here?”
- Preserve build footprints, nav clearances, resource readability, faction colour, and selection cues.

## Definition of done for the first realism milestone

- All four biomes show at least three distinct context-stamp families.
- Roads, industrial bases, civilian areas, ore fields, and autumn vegetation each carry a specific
  grounded wear treatment.
- The normal RTS frame gains no more than two colour draws and two shadow draws over baseline.
- Visible prop triangles stay inside the existing scene budget at the stock and dense-base fixtures.
- The screenshot grader and a human close/normal/far review show more authored variation without a
  busier or noisier battlefield.
