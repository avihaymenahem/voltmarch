# VOLTMARCH foliage engine and environment-asset migration

Status: all 32 Scatter identities are the production default; runtime LOD dispatch and final performance/save acceptance remain · owner: world/art pipeline · opened 2026-08-29

## Decision

Replace the runtime-generated foliage and neutral-prop geometry in `PropLibrary.ts` with a single
asset-driven environment engine. The existing procedural broadleaf is retained only while the first
tree proves the new path. After an asset family passes its art, performance and failure-path gates,
its legacy builder is removed; the production fallback becomes a small packaged derivative of the
approved source asset, not another local procedural model.

The first proof is the existing `tree` key: a temperate broadleaf approximately 10–12 m tall. It is
the right pilot because it exercises the whole difficult surface at once: trunk and canopy material
regions, wind, shadow motion, crushing/felling, save/load persistence, chunk culling, LODs, biome
variation and normal-RTS silhouette readability.

This plan changes the source and presentation of environment geometry. It does not change terrain,
navigation, seeded placement, map composition or simulation authority.

## Current baseline to preserve

The current system already has valuable contracts that must survive the migration:

- `Scatter` is the deterministic placement authority. It owns biome legality, density, clustering,
  road and structure exclusions, opening compositions, the 25 × 25 m coverage gate, placement
  fingerprints, clearing/felling and one-bit save masks.
- A live prop type is one cached geometry and one `InstancedMesh`; instances are sorted into 32 m
  chunks and only visible prefixes are uploaded.
- The roster shares renderer-neutral material behavior, per-instance colour/value jitter and wind
  phase. WebGL and WebGPU use the same placement matrices.
- The hard limits remain 9,000 map props, at most 30 live types, zero frame-loop allocation and a
  130-colour-draw scene budget.
- Props never write navigation state. `blocksNav` remains placement metadata only, and no scatter
  prop receives `EntityFlag.BlocksNav`.

The new engine replaces geometry construction and rendering ownership without invalidating those
contracts.

## Target architecture

```text
EnvironmentAssetCatalog (manifests + URLs + budgets)
                    |
                    v
FoliageEngine (load/cache/validate/material/LOD/shadow/fallback)
                    ^
                    |
ScatterPlanner (seeded placement, masks, coverage, clearing, save identity)
                    |
                    v
EnvironmentInstanceStore (chunk-sorted transforms, colour, wind, alive bits)
                    |
                    v
WebGL/WebGPU instanced LOD batches + telemetry
```

The names describe ownership rather than new systems for their own sake:

- `EnvironmentAssetCatalog` replaces the geometry builder half of `PropLibrary`. Each manifest owns
  asset URLs, scale/origin, family, placement metadata, LODs, shadow policy, material family, wind
  profile and an engine-owned emergency derivative.
- `ScatterPlanner` is the placement/clearing portion of today's `Scatter`. Its output is independent
  of whether an asset is loaded, so a slow or failed GLB can never change the placement fingerprint
  or a multiplayer map.
- `FoliageEngine` is the umbrella runtime for foliage, rocks, yard, street and civic props. Foliage
  gets wind and canopy rules; rigid props use the same cache, batching, LOD and telemetry path with
  wind disabled.
- `EnvironmentInstanceStore` retains the current flat chunk arrays and O(1) within-chunk removals.
  Loading a prettier tree must not turn felling into a rebuild of every instance matrix.

The POC should first introduce these seams around the existing `Scatter` data structures. A broad
rewrite of placement and asset loading in one change would make visual, deterministic and performance
regressions impossible to attribute.

## Manifest contract

The initial manifest needs the following data, with no runtime inference from filenames:

```ts
interface EnvironmentArchetypeManifest {
  key: string;
  family: 'canopy' | 'shrub' | 'grass' | 'rock' | 'yard' | 'street' | 'civic';
  lod0: string;
  lod1?: string;
  lod2?: string;
  shadow?: string;
  emergency: string;
  materialFamily: string;
  origin: 'ground-centre';
  metres: { radius: number; height: number };
  placement: EnvironmentPlacementPolicy;
  wind: 'none' | 'grass' | 'canopy';
  bounds: EnvironmentAssetBounds;
  budget: EnvironmentAssetBudget;
}
```

`placement` deliberately mirrors the stable `PropDef` fields. During migration the catalogue may
adapt the old table rather than duplicating it. The end state is one manifest record per key and no
runtime `build(m, rng, palette)` callback.

## Rendering and performance design

### Geometry and materials

- Ship closed, front-side geometry. Do not make double-sided leaf-card soup the default; its shadow
  and overdraw cost is paid once per visible leaf cluster.
- One primitive and one material per ordinary archetype. Trunk, branches and canopy share an atlas;
  extra draws require measured benefit at the normal RTS camera.
- Reuse one KTX2/Basis family atlas across related variants. The POC may use a dedicated 1K atlas to
  prove the path, but that file is a pilot input, not permission for one unique texture set per tree.
- Base colour is colour data; normal and packed metal/roughness are linear. Vegetation stays matte,
  non-metallic and restrained in clearcoat.
- Condition one explicit wind-weight channel during the local production pass. The engine converts
  it to the shared runtime attribute once at load; wind weight is never guessed every frame.
- Keep per-instance hue/value variation in the instance buffer. Seasonal changes use approved atlas
  regions or family variants, not a global tint that turns bark orange with the leaves.

### LOD and culling

- Preserve the current 32 m CPU chunk cull and allocation-free visible-prefix upload.
- LOD classification happens only when the visible chunk set or camera band changes, not for every
  tree every frame.
- Maintain at most three colour buckets for a foliage archetype. Transitions use a short stochastic
  or dithered band driven by stable instance identity; do not alpha-crossfade whole forests.
- The broadleaf POC may cost at most two additional colour submissions over the current single tree
  draw and at most one additional shadow submission. A full roster cannot multiply all 30 live
  archetypes by three; low-cost rigid props remain single-LOD or use only a far cull.
- Shadow LOD is independent of colour LOD. The caster keeps the canopy silhouette and trunk mass but
  discards interior foliage.
- The engine exposes visible instances and visible triangles per LOD, upload bytes, draw calls,
  parse time and CPU cull/upload time through the existing diagnostic surface.

### Loading and fallback

- One renderer-configured KTX2 loader/transcoder pool is shared across environment families.
- Asset loading never blocks boot or map generation. The POC uses the old procedural `tree` while
  the imported family is loading or rejected.
- Promotion replaces that development fallback with `tree.emergency.glb`, derived from the accepted
  source and kept small enough to be synchronously available with the family. It is asset-pipeline
  output, so deleting the old builder does not weaken failure behavior.
- A missing LOD degrades toward the nearest valid packaged LOD. A missing complete family uses the
  emergency derivative and emits one bounded diagnostic; it does not alter placement or silently
  disappear.

## Broadleaf POC art brief

Content key: `tree`  
Display name: Temperate Broadleaf  
Gameplay role: neutral crushable canopy prop; never a navigation blocker  
Dimensions: 10–12 m high, 7–9 m crown diameter, ground-centred origin, Y-up  
Primary biomes: temperate and urban; rare dry/snow use comes only after the pilot

Three non-negotiable silhouette cues:

1. A readable trunk fork below the crown, with open negative space between two primary boughs.
2. A broad, asymmetric crown with one dominant lateral mass; never a sphere on a cylinder.
3. A slightly uneven lower canopy line that leaves portions of the trunk visible at normal RTS zoom.

Three material cues:

1. Dark warm bark separated clearly from an olive canopy without relying on micro-noise.
2. Three or four broad canopy value masses; tiny individual leaves must not turn into shimmer.
3. Matte foliage with restrained edge response and no waxy automotive clearcoat.

Reject geometry with fused ground roots, a hollow/open trunk, unsupported floating crown pieces,
paper-thin card walls, a perfectly spherical crown, or detail that disappears into one noisy blob at
the normal camera.

## POC asset budgets

These are ceilings, not targets. The accepted silhouette decides where the triangles go.

| Delivery | Ceiling | Material/texture rule |
| --- | ---: | --- |
| Raw geometry review source | 12k triangles | geometry only; no texture purchase before approval |
| LOD0 | 3.5k triangles | one primitive/material; 1K base, 1K normal, 512 packed MR maximum |
| LOD1 | 900 triangles | preserve crown asymmetry and trunk fork |
| LOD2 | 400 triangles | crossed silhouette derivative; no unique texture sampler |
| Shadow proxy | 900 triangles | reuse accepted LOD1 silhouette; no material maps |
| Emergency derivative | 400 triangles | packaged LOD2 derivative, same fit contract |
| Shipping family bytes | 1.5 MiB | KTX2 payload included; every promoted file smaller than source |

The LOD0 ceiling is intentionally below the existing procedural broadleaf test floor of 4k triangles,
while the far buckets recover substantially more. If simplification cannot reach these numbers without
rounding away the trunk fork or crown asymmetry, the candidate fails and needs deliberate retopology;
the budget is not raised to make an automatic simplifier pass.

## POC sequence

### Gate 0 — baseline

Capture the existing `tree` on the same commit in five views:

- a single close tree in neutral light;
- normal RTS temperate gameplay;
- a dense temperate copse;
- an MCV opening where trees exercise exclusions;
- dusk/night with moving canopy shadows.

Record current LOD0/library triangles, visible tree instances, colour and shadow draws, total visible
triangles, upload bytes, scatter bake/place time, CPU frame cost, GPU time, and WebGL/WebGPU screenshots.
Also record felling, save/load restoration and the placement fingerprint.

Engineering checkpoint, 2026-08-29: the fixed temperate seed-7 procedural `tree` contains 4,520
triangles, 9,780 vertices and 13,560 indices. Its measured XZ radius is 4.656 m, height is 8.930 m
and three-dimensional sphere radius is 5.051 m. The focused scatter, clearing, wind-phase and WebGPU
vertex-layout suite passes unchanged through the new presentation boundary. Renderer screenshots,
dense-copse frame timings and the recorded placement fingerprint remain open before Gate 0 closes.

### Gate 1 — concept and paid geometry

Create a coherent front/right/back/left reference set at identical scale and baseline. Use a neutral
bright background and broad material masses; avoid loose leaves and background vegetation that can be
misread as geometry.

Run one geometry-only multi-image task through the approved Meshy workflow. Before that call, inspect
the live credit balance and present the exact task/cost. The expected normal route is 20 credits for
geometry and, only after approval, 10 for PBR texture; an optional 5-credit remesh is a separate stop
and is not pre-approved by geometry success.

Download the raw GLB into its structured ignored task directory, record task metadata and run
`npm run asset:audit`. Reject before texture if the cardinal silhouette or component structure fails.

Geometry checkpoint, 2026-08-29: the coherent horizontal source sheet and its front/right/back/left
inputs are preserved under `docs/concepts/meshy/temperate-broadleaf-v1/`, including the exact
ImageGen prompt and SHA-256 hashes. After a live 314-credit balance check and explicit approval,
geometry-only multi-image task `01a04ec2-a4bb-77e8-b54f-400b74c82c33` succeeded for exactly 20
credits. The ignored task directory contains the untouched 33.97 MiB GLB, thumbnail, task JSON and
history metadata. A later separately approved 5-credit remesh and 10-credit PBR retexture completed
the production route; their exact outputs are recorded below and in the tracked provenance file.

### Gate 2 — local foliage production profile

Add a real `foliage` profile to the repository asset tools instead of borrowing `vehicle` or
`infantry`. The profile must:

- normalize Y-up, ground-centred origin and metres;
- merge only after trunk/canopy roles have been used to author wind weights;
- condition one shared atlas and single-sided material;
- create LOD1, LOD2, shadow and emergency derivatives from the approved source;
- stamp audited triangle, bound, texture and byte facts into provenance;
- validate that all visible LOD attributes use the WebGPU-compatible float layouts expected by the
  runtime material path.

Do not enable Meshopt or Draco until the live loader configures and packages their decoders.

Production checkpoint, 2026-08-29: remesh task
`01a04ee5-dad8-7580-bf04-c71684f6957e` reduced the accepted source to 3,363 triangles for 5
credits, retained one connected primitive, fitted it to 11 m height and grounded Y=0. PBR retexture
task `01a04ee7-71ee-7606-b7c6-8d0f2572306d` cost 10 credits, preserved that topology and produced
base-colour, normal and metallic/roughness maps with baked lighting removed. Local conditioning
made the material single-sided and resized it to 1K base, 1K normal and 512 packed MR.

The shipping family is 1,038,948 bytes: 3,363-triangle PBR LOD0, 802-triangle geometry-only LOD1,
384-triangle crossed vertex-colour LOD2/emergency and an 802-triangle geometry-only caster. Direct
387/376-triangle simplification candidates passed numerical bounds gates but failed cardinal review
as collapsed slabs; neither ships. The deliberate far derivative preserves crown/trunk masses without
a texture sampler, while the caster reuses the visually accepted LOD1 silhouette.

### Gate 3 — engine integration behind a pilot switch

Register the imported archetype under the existing `tree` key. Keep every placement and gameplay
field unchanged. A development switch may select `procedural`, `imported` or `emergency` presentation
from the same placement list for exact A/B captures; it must never enter simulation or seeded
placement logic.

The first integration must prove:

- asynchronous load with immediate fallback;
- shared cached geometry, material and KTX2 loader;
- LOD bucket repacking without per-frame allocation;
- matching wind in colour and shadow passes in WebGL and WebGPU;
- clearing/crushing updates all LOD buckets in O(local instances);
- saved felling masks apply to the same placement fingerprint;
- shroud/fog tinting remains correct.

Integration checkpoint, updated 2026-08-30: the complete family is registered atomically through
`EnvironmentAssetCatalog` and `FoliageEngine`; `Scatter` remains placement and save authority. Normal
boots load the audited family and its PBR materials. `?foliage=imported` remains an explicit diagnostic
alias for that production route, while `?foliage=procedural` and any load/audit error instantiate the
dormant procedural presentation.
A live WebGL match reports `tree source=imported, 3,363 tris, ... PBR=yes` with no new console errors.
The first loader fault found during browser validation—interleaved quantized LOD attributes passed to
the index weld—was corrected by promoting them to writable Float32 attributes before indexing.

This checkpoint proves the asset-pipeline and close-tree presentation seam. Non-blocking background
replacement, camera-band LOD bucket repacking, matching authored wind on the PBR shader, KTX2 family-
atlas conversion and WebGPU/dense-copse performance acceptance remain Gate 3/4 rollout work before
the procedural builder is deleted.

### Gate 4 — acceptance

The pilot passes only when all of the following are true:

- close, normal and far captures are approved in WebGL and WebGPU at noon and dusk/night;
- normal RTS silhouette is materially better than the procedural broadleaf, not merely more detailed
  in a model viewer;
- the same seed produces the same placement fingerprint and clearing/save behavior;
- normal-game colour draws rise by no more than two and shadow draws by no more than one;
- at equal visible tree counts, median CPU and GPU frame cost do not regress by more than 3%; the
  dense-copse stress case must improve visible triangle count and remain within the same frame-time
  envelope;
- no frame-loop allocation, per-instance material, per-instance loader, double-sided default,
  texture-colour-space warning or WebGPU vertex-layout warning is introduced;
- `npm run typecheck`, focused environment/asset tests and `npm run build` pass;
- screenshots, metrics, task IDs, source hashes and rejection notes are stored beside the asset.

Passing Gate 4 promotes the imported broadleaf and its emergency derivative. The later family rollout
has now produced and registered every catalogue delivery, but does not waive the same runtime
performance, save/clearing and visual acceptance gates.

## Rollout after the POC

Migrate by reusable family, not by one-off asset:

1. Foliage family: broadleaf, autumn broadleaf, conifer, palm, two grass identities, bush and hedge
   are integrated. Autumn/conifer/palm/grass share one ImageGen-derived 1024/512/512 alpha PBR atlas;
   bush/hedge share their separate continuous-shrub atlas.
2. Mineral/debris family: boulder and rock cluster are integrated. `debrisPile` deliberately resolves
   to the same approved rounded rock-cluster family, removing the old single rectangular blocks from
   imported presentation without changing its stable placement identity.
3. Yard family: crate stacks, flower boxes, hay, container stacks and barrels are integrated. Crates
   retain their dedicated iron/timber/flower atlas; the other manufactured props share the neutral
   prop-surface atlas.
4. Street family: both lamps, bench, three cars, traffic light, fence, railing, telegraph pole and
   both road signs are integrated as static one-primitive GLB families.
5. Civic family: cafe umbrella/table/chairs, flower bed, both statues and water tower are integrated.

Each family keeps the same promotion gate: one anchor first, shared atlas/material decision and a
measured batch. Catalogue coverage is now exact and test-enforced against `PROP_KEYS`. Successful
imported boots construct zero Scatter `PropLibrary` archetypes and bind scenario-spawned props to the
same loaded families; the procedural builders remain dormant source-level failure fallbacks and are
instantiated only when imported loading fails or `?foliage=procedural` is explicitly selected.

Mineral checkpoint, 2026-08-29: `boulder` and `rockCluster` keep their stable Scatter identities and
procedural failure fallback. LOD0 is 576/450 triangles, LOD1 is 224/240, LOD2 is 100/120 and the
casters are 144/150. The runtime loads one shared front-sided PBR material and three maps for both
families, applies restrained biome tint through `COLOR_0`, and leaves distant/caster deliveries
texture-free. Focused tests, TypeScript, the production Vite bundle, cardinal review and a live
Electron/WebGPU skirmish passed. Legacy rock builders remain until camera-band LOD dispatch and the
full Gate 4 performance/save acceptance remove the procedural escape path.

Shrub checkpoint, 2026-08-29: `bush` and `hedge` now keep their stable Scatter identities while the
imported presentation loads through the same atomic family catalogue. Bush deliveries are
28/16/6 triangles with a 48-triangle closed caster; hedge deliveries are 12/10/10 with a 12-triangle
box caster. Both keys share one cached alpha-tested, vertex-tinted PBR material. The atlas was built
from separate ImageGen branch-cluster and continuous-hedge sources, with semi-transparent fringe
decontamination before WebP delivery. Focused tests, TypeScript, lint, production build and final
cardinal review pass. A live Electron/WebGPU roadside review also caught the imported hedge's local
+X long axis being fed through the generic local-Z street yaw: the narrow end read as a post. The
hedge-only quarter-turn fix leaves positions, stable keys, counts and save fingerprints unchanged,
and its side-on WebGPU proof is stored with the family. The initial horizontal bush caps and
segmented hedge layout were rejected; procedural builders remain only as failure fallbacks until
the complete Gate 4 runtime acceptance.

Box-prop checkpoint, 2026-08-30: `crateStack` and `flowerBed` now keep their stable Scatter
identities while eight deterministic LOD/caster GLBs share one cached 1K/512/512 PBR atlas. Crate
LOD0/1/2 deliveries are 60 triangles with a 24-triangle caster; flower-box deliveries are 16/16/14
with a 12-triangle caster. The accepted ImageGen crate edit keeps realistic timber dominant while
adding dark forged-iron corner straps, one narrow band, plates and fasteners; the packed metal mask
marks only those iron regions. Real pickup-crate entities are rebound to the same loaded LOD0
geometry/material, preventing the entity/scatter seam from reviving the procedural crate. The
flower canopy uses measured source-alpha bounds instead of extra geometry. Cardinal and live
Electron/WebGPU reviews pass, the complete shipping family is 360,201 bytes, and Meshy spend was
zero. Procedural builders remain failure fallbacks until the complete Gate 4 runtime acceptance.

Full-catalogue checkpoint, 2026-08-30: `EnvironmentAssetCatalog` covers all 32 stable Scatter keys,
and a focused test compares that set directly with `PROP_KEYS`. Five additional vegetation identities
ship compact card/trunk LOD families through one shared ImageGen PBR atlas. Nineteen manufactured yard,
street and civic identities ship offline-baked one-primitive GLBs, topology-safe reduced LOD1/LOD2
deliveries and 12-triangle caster proxies through one cached prop-surface PBR atlas. WebGL and WebGPU
cardinal reviews cover the previously easy-to-miss barrels, cafe umbrella set and all three cars.
Live Electron/WebGPU reports 32 registered imported families, 4,894 seeded props, 18 biome-selected
types, 13 visible colour draws, zero empty coverage patches and a zero-count procedural Scatter
library. Runtime camera-band LOD bucket dispatch, authored PBR wind/depth parity and final dense-copse
performance plus clearing/save acceptance remain open; asset delivery and eager-fallback removal do not.

## Explicit non-goals for the POC

- Rewriting terrain scatter density or map composition.
- Changing navigation, crush rules, placement keys or save schema.
- Converting every prop before one tree proves the runtime.
- Spending texture/remesh credits before raw geometry approval.
- Unique 2K textures for small environment objects.
- WebGPU-only compute placement, culling or LOD decisions; placement remains deterministic CPU work.
- Treating a beauty-shot improvement as sufficient without dense-scene performance evidence.
