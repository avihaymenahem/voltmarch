# VOLTMARCH environment realism and prop renewal

Status: in progress · owner: world/art pipeline · updated 2026-08-26

## Intent

Make maps feel inhabited, weathered, and specific without covering the battlefield in noise or
turning environmental dressing into the dominant GPU cost. The target is authored composition:
clean gameplay lanes surrounded by clustered evidence of traffic, industry, weather, and civilian
life.

The current baseline is already strong technically: 31 procedural prop archetypes share one
renderer-neutral material, each live type is one instanced colour draw, placement is chunk-culled,
and static/transient ground marks are pooled into two bounded decal draws. This plan extends those
systems. It does not replace them with thousands of independent GLBs or unique 2K textures.

## What is missing

- Context. Dirt, oil, leaves, rubble, and props are not yet arranged as small stories around roads,
  depots, civilian blocks, resource sites, shorelines, and faction bases.
- Contact variation. The existing dust wear outside some buildings is useful, but there are too few
  families of edge grime, rust runoff, mud, leaf litter, gravel, and service stains.
- Prop fidelity. Cars, crate stacks, umbrellas, rocks, and some civic props have good silhouettes at
  ordinary RTS distance but lack the larger secondary forms that survive close inspection.
- Biome aging. The same object should collect dust in desert, damp grime in temperate maps, exposed
  rust around salt water, and dirty snow at roadsides without requiring a unique material per object.
- Destruction continuity. Scorch, craters, tracks, and construction clearing exist; persistent small
  rubble and disturbed-ground compositions need to connect them visually.

## The five-layer solution

### 1. Surface variation — existing terrain, no extra object draws

Add only low-frequency, context-driven splat edits: dusty road shoulders, compacted depot dirt,
muddy drainage, exposed earth under autumn canopies, salt-stained shoreline strips, and gravel near
ore fields. These are irregular stamps tied to features, not a repeated texture applied everywhere.

Rules:

- keep the terrain hue/tone contract in `docs/VISUAL_DNA.md`;
- never add screen-visible uniform noise or a globally repeated grime texture;
- reserve clean negative space around selection, building exits, and primary combat lanes;
- deterministic placement from map/scenario seed only.

### 2. Ground story decals — extend the existing two-draw atlas

Add atlas kinds for leaf litter, mud/road-edge dirt, rust runoff, gravel scatter, curb grime, paper
litter, and demolition dust. Stamp them in small compositions around authored anchors. The existing
decal field supplies pooled geometry, terrain conformance, eviction, mipmaps, and WebGL/WebGPU paths;
the new kinds should not add a draw call.

Density is measured in clusters, not specks. A leaf patch is one readable 2–5 m mass with a few edge
leaves, not hundreds of alpha cards. Rust is placed beneath metal or drainage points, not randomly
on grass. Oil appears near factories, depots, wrecks, and parked vehicles.

### 3. Instanced prop families — improve silhouettes, preserve batching

Every promoted prop remains one cached geometry per archetype and one `InstancedMesh` per live type.
Imported candidates are conditioned into the shared prop material or a shared family atlas; they do
not retain Meshy's arbitrary material stack. Per-instance hue/value variation remains available.

| Family | Route | LOD0 target | LOD1 | Shadow proxy | Texture rule |
| --- | --- | ---: | ---: | ---: | --- |
| Civilian sedan/van/pickup | Meshy pilot, then local hard-surface conditioning | 1.5k–3k tris | 600–1.2k | 200–400 | one shared 1K KTX2 vehicle atlas |
| Umbrella/table/bench | local authored kit; Meshy only if silhouette review fails | 300–900 | 120–350 | 80–200 | shared civic trim/vertex colour |
| Crates/pallets/barrels | local modular kit | 150–700 per composition | 80–250 | 60–160 | shared yard trim/vertex colour |
| Boulder/rock cluster | local sculpted family or one Meshy source conditioned into 3 variants | 300–1.2k | 120–450 | 80–250 | vertex colour; no unique map |
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

Add restrained pooled effects after the static pass proves itself: movement dust, a few wind-driven
leaf groups, drifting industrial dust, and debris settling. These effects are presentation-only,
renderer-neutral, bounded by a strict particle ceiling, and disabled or reduced by the measured
particle pass on lower tiers.

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

## Rollout order

1. Baseline captures and metrics for temperate, desert, snow, urban, and an MCV opening.
2. Leaf/mud/rust/gravel/litter decal atlas extension plus deterministic context stamps.
3. Civilian sedan Meshy pilot complete; build and validate the shared vehicle-prop integration path.
4. Local crate/pallet/barrel and umbrella/civic kit refresh.
5. Rock and ore cluster refresh with biome variants.
6. Wreck/debris compositions and destruction continuity.
7. Dynamic dust/leaves, then quality scaling from measured GPU timings.

## Gates

- No change may raise the live prop-type ceiling above 30 or add per-instance materials.
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
