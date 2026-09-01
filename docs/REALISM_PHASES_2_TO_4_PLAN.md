# VOLTMARCH realism phases 2–4

**Status:** all-map WebGPU implementation and local NVIDIA acceptance complete; release/device-matrix gates remain separate
**Scope:** 2. indirect lighting; 3. authored map composition; 4. material and ground-contact cohesion
**First vertical slice:** Industrial Grid (`MAP_PRESETS.urban`); subsequently rolled out to all seven shipped map presets
**Renderer:** desktop WebGPU only; it is the normal no-query product default
**Legacy:** WebGL parity, tuning and testing are out of scope pending its separate removal
**Planning date:** 2026-09-01

This document starts the next visual-realism workstream. It does not authorize a release or production
deployment. Each stage must survive its own visual, deterministic, performance, and rollback gates. Product
features are integrated through the normal renderer/capability policy, not exposed as query-flag modes;
critic-only URL controls remain acceptable for repeatable capture and backend comparison.

The intended result is not a busier image. It is a more coherent one:

- bounced light varies with the part of the battlefield instead of acting as one global fill;
- depots, homes, resource sites, shorelines, woodland and ruins form readable places rather than isolated
  props;
- dust, moisture, salt, snow contamination and contact wear follow physical causes;
- structures, units, vegetation and terrain appear to share one atmosphere and one ground plane;
- tactical silhouettes, faction colours and the locked camera/readability rules remain clearer than the
  realism treatment.

## 1. Current foundation

The work starts from a substantial existing renderer, not a blank slate:

- `render/scene.ts` owns one shadow-casting sun, a `HemisphereLight`, a dim ground-bounce directional light,
  the procedural sky and a boot-time PMREM environment probe.
- `render/nodes/ssgi-node.ts` owns the accepted bounded WebGPU screen-space layer. High defaults to low SSGI
  and Ultra to medium at 0.5 resolution with a deterministic non-temporal denoise. Its first candidate was
  rejected for horizontal ground bands, muddy faction-colour bleeding and whole-scene dulling; the final
  receiver-tinted/contact-only-AO formulation passed colour and timing acceptance. It still cannot provide
  stable off-screen radiance, which remains the retained irradiance field's job.
- `world/time-of-day.ts` and `world/weather.system.ts` already provide presentation-only day phase and
  weather state without entering simulation checksums.
- terrain, roads, props, structures, units, water and VFX already have explicit WebGPU/TSL ownership seams.
- `world/structure-wear.ts`, `world/scatter.system.ts` and `world/Decals.ts` already produce deterministic,
  cause-linked base wear inside fixed pools.
- `render/ContactShadows.ts` and authored structure foundations already address the smallest contact scale.

The missing layer is the connective tissue between these systems.

## 2. Locked decisions

These are architecture decisions, not open implementation questions.

1. **GI is a world-space irradiance field, not a second global light.** It must be stable while the camera
   pans and must contain useful information that screen-space GI cannot see.
2. **The irradiance field is presentation-only.** It may read terrain, visual structure bounds, time of day,
   weather and emissive anchors, but it never writes simulation state, pathing, visibility or placement.
3. **No runtime PMREM rebakes.** The current measured hitch makes that unsuitable for day/night or weather.
   The existing probe remains the specular environment; low-frequency diffuse change comes from live
   uniforms and the irradiance field.
4. **SSGI is a bounded near-field layer, not the foundation.** The first candidate failed the motion/colour
   scorecard; the accepted version multiplies incident radiance by receiving scene colour, limits long-range
   AO to 0.18 of configured AO, and uses deterministic non-temporal denoising. High defaults to low and Ultra
   to medium, while world-space irradiance remains authoritative for stable off-screen radiance.
5. **Map composition is planned from semantic causes.** “Depot,” “civilian block,” “shore,” “resource yard,”
   “woodland” and “ruin” are inputs. Random stains and evenly distributed props are not.
6. **Composition remains deterministic and bounded.** Pure planners consume an explicit seed and immutable
   descriptors, return fingerprints, and feed existing or explicitly budgeted pools.
7. **Material aging uses shared state and shared materials.** No per-instance material clones and no unique
   texture set for each prop. Geometry, UVs and textures fix geometry/UV defects; shaders do not hide them.
8. **Grime is causal.** There is no global uniform grunge/noise pass. Dust settles on exposed and lower
   surfaces, dampness follows rain and ground contact, salt belongs near water, snow contamination follows
   biome and orientation, and damage follows actual damage/destruction state.
9. **Faction and gameplay channels stay independent.** Team colour, emissive recognition, selection,
   shroud, construction, damage and the new aging channels cannot overwrite one another.
10. **WebGPU is the only acceptance target.** Normal boot selects WebGPU with no query flag. Legacy WebGL
    parity, screenshots and performance are not gates for this workstream.
11. **No product rollout query flags.** Accepted graphics work affects the game directly. Capability and
    quality policies choose valid implementations; URLs may control only deterministic critic fixtures and
    explicit renderer comparison outside normal play.

Rejected foundations remain rejected: no CSM expansion in this workstream, no TAAU promotion, no default
GPU foliage path, no Meshopt family rollout, no compute-driven simulation/world generation, no per-prop
2K-texture explosion, and no new full-screen effect without measured benefit.

## 3. Dependency order

```text
baseline fixtures and counters
        |
        v
2A irradiance data contract --> 2B WebGPU reconstruction/composite --> 2C local emissive updates
        |                                  |
        +------------------+---------------+
                           v
3A semantic context planner --> 3B pooled composition --> 3C destruction continuity
                           |
                           v
4A shared surface state --> 4B material-family pilots --> 4C roster/biome rollout
                           |
                           v
                 combined acceptance + default decision
```

Lighting comes first because material and composition tuning against the current flat fill would be retuned
again after spatial bounce lands. Composition comes before the full material rollout because it supplies the
context masks and causes the material system should consume.

## 4. Stage 0 — baseline and acceptance harness

### Deliverables

- Add a fixed Industrial Grid realism fixture with a locked map seed, camera pose and representative base,
  civilian, road, ore and tree-line regions. Do not change the authored map default.
- Capture the same pose at `?dayphase=day|dusk|night|dawn` and at clear/light/heavy precipitation.
- Preserve one desert, one snow and one shoreline fixture so the vertical slice cannot overfit urban night.
- Record WebGPU screenshots at close, normal and far tactical zoom.
- Record warm-frame median and p95 GPU time, pass timings, draw calls, shadow draws, visible triangles,
  material/program count, texture residency, boot time and shader compilation after reveal.
- Record the current simulation checksum/placement fingerprints for the same seed.

### Baseline outputs

Place run artifacts outside source ownership, under a date-stamped `.codex-artifacts/realism-phase-2-4/`
folder. The checked-in plan records commands and thresholds; large captures and traces do not enter git.

### Gate

No implementation starts until the fixture is repeatable and captures can distinguish:

- global fill from local bounce;
- broad composition from circular decal stamps;
- material response from post-grade changes;
- contact cohesion from simply darkening the whole image.

## 5. Phase 2 — stable indirect lighting

### 5.1 Target architecture

Use a low-resolution, map-aligned **2D irradiance cache** because VOLTMARCH battlefields are heightfield-led
and viewed from an elevated tactical camera. A 3D voxel volume would pay for empty air while complicating
sampling and updates.

The cache stores low-frequency diffuse information, not final colour:

- RGB indirect irradiance;
- sky visibility / broad occlusion;
- validity or update age;
- optional local-emissive contribution in a separate channel or texture if profiling shows it is cheaper
  than rebuilding the static field.

Initial target resolution is 64×64 over the battlefield. 128×128 is an experiment, not the assumed ship
value. Filtering must hide cell boundaries at normal zoom without erasing district-scale variation.

### 5.2 Inputs

The static build reads renderer-owned or immutable presentation data:

- terrain height and splat/material response;
- biome ground-bounce palette;
- coarse visual bounds for cliffs and placed structures;
- sun direction and authored day-phase profile;
- the existing sky/ground palette;
- semantic context masks from phase 3 when available.

The dynamic layer reads:

- day/night blend as live uniform state;
- weather intensity and precipitation type;
- a bounded list of existing lamp/emissive anchors;
- dirty visual bounds when structures are completed or destroyed.

The cache never reads fog-of-war visibility and never becomes hidden information for gameplay.

### 5.3 Sampling and composite

The first implementation is WebGPU-only and integrates into the existing node post graph:

1. reconstruct world position from the existing depth path;
2. obtain or reuse the existing reconstructed normal;
3. sample the map-aligned irradiance texture;
4. apply a conservative diffuse-only contribution using normal orientation, sky visibility and scene colour;
5. preserve emissive pixels and keep terrain bloom at zero;
6. run before the final grade so weather and art direction grade direct and indirect light together.

A material-integrated sample is a later option only if the post composite cannot preserve metal/dielectric
separation. Do not start by modifying every material family.

### 5.4 Update policy

- Build the static field once behind the loading curtain after terrain and staged structures are available.
- Day phase and weather change uniforms only; they do not recreate textures or pipelines.
- Maintain a small dirty-rectangle queue for construction/destruction changes.
- Process no more than one bounded update budget per rendered frame and coalesce overlapping rectangles.
- Camera motion never invalidates the field.
- Device loss recreates GPU resources from the retained CPU descriptors or re-runs the bounded builder.

### 5.5 Proposed code ownership

- New pure contract/builder: `apps/game/src/render/irradiance-cache.ts`
- New WebGPU node/composite: `apps/game/src/render/nodes/irradiance-node.ts`
- Lifecycle system: `apps/game/src/render/irradiance-cache.system.ts`
- Graph integration: `apps/game/src/render/post-nodes.ts`
- Shared renderer interface: `apps/game/src/render/post.ts`
- Pass accounting: `apps/game/src/render/gpu-pass-timings.ts` and
  `apps/game/src/render/node-pass-accounting.ts`
- Presentation inputs only: `apps/game/src/world/time-of-day.ts`,
  `apps/game/src/world/weather.system.ts`, and the terrain/structure render bridges

The stable irradiance cache is a default part of the WebGPU graph. A neutral retained field is an exact no-op
until the worker result is uploaded. Normal High play combines it with low SSGI and Ultra with medium SSGI;
lower tiers retain their bounded AO path. SSGI runs at 0.5 resolution with deterministic non-temporal denoise,
receiver-tinted incident radiance, and only 0.18 of configured AO at long range. Low/medium/high GI intensity
is 3.4/3.8/4.2. These are product defaults rather than a query-gated rollout.

### 5.6 Phase 2 acceptance

- Camera pans and zooms reveal no screen-space swimming, edge loss or lighting reset.
- A building moving on/off screen does not make its surrounding bounce vanish.
- Dusk/night transitions cause no PMREM hitch and no shader compile after warm-up.
- Indirect light does not brighten tactical shadows beyond the locked shadow-colour/readability envelope.
- Metal does not receive diffuse-looking chalk; bright faction and emissive channels remain legible.
- At normal tactical zoom, the result is visibly superior to the existing hemi/bounce rig in a blind A/B.
- `probes` has a distinct GPU timing label and survives the representative NVIDIA and AMD WebGPU closure.
- The entire Medium-quality visual stack remains within the existing ≤10% GPU-regression rule. Phase 2
  receives at most half of that envelope until phases 3–4 are measured together.

If the post composite cannot avoid materially incorrect metal response, stop and run a small material-node
pilot. Do not conceal the failure with lower intensity.

## 6. Phase 3 — authored map composition

### 6.1 Semantic context model

Generalize the pure-planner pattern in `world/structure-wear.ts` into a context plan. Sources name the place
and its causes instead of requesting individual props.

Initial context kinds:

| Context | Required story | Typical outputs |
|---|---|---|
| depot / factory | traffic, service and storage | egress wear, pallets/crates, barriers, oil/grime, utility props |
| civilian block | habitation and access | pavement breakup, paper litter, lamps, fences, sparse street furniture |
| resource yard | extraction and hauling | gravel apron, disturbed soil, loader clutter, directional traffic wear |
| shoreline | wet edge and salt exposure | damp band, drift/debris, reeds/rocks, salt-weather context |
| woodland | canopy and understorey | leaf litter, fallen limbs, bush/grass hierarchy, canopy-edge thinning |
| ruin / wreck field | collapse and disturbed ground | rubble clusters, soot, exposed soil, persistent wreck context |

Each biome needs at least three approved context families before broad rollout. A family is a composition
grammar with several seeded variants, not a single repeated stamp.

### 6.2 Planner output

The planner returns bounded descriptors for:

- broad irregular ground masks;
- pooled decal marks where a decal is the right representation;
- clustered geometry props from the existing environment catalogue;
- local light/emissive anchors;
- an optional context mask consumed by phase 4 material aging;
- persistent destruction replacements.

Every descriptor carries `contextId`, `cause`, `sourceId`, world bounds, priority and deterministic seed.
The plan is sorted by authored priority and admitted round-robin so one district cannot consume the entire
budget before another receives its primary story.

### 6.3 Placement rules

- Reject navigation-critical cells, building footprints, production exits, roads unless the context allows
  roadside furniture, water unless shoreline-qualified, and protected start clearances.
- Validate full oriented bounds, not only descriptor centres.
- Prefer clusters with negative space; do not fill every valid point.
- Broad ground composition must use terrain/control masks or large irregular fields. Do not scale up the
  4×4 decal atlas into visible circular stains.
- Props use the current environment family, LOD, batching and shadow policies.
- Small story props never become collision, targeting or cover unless separately authored as simulation data.

### 6.4 Destruction continuity

Extend the existing `layRubbleStory()` scale ladder:

1. transient smoke/dust and ballistic debris;
2. the large wreck silhouette;
3. persistent rubble geometry from a bounded shared pool;
4. broad disturbed-ground mask;
5. context transition from active site to ruined site.

The transition consumes a presentation event already emitted by destruction. It never changes the wreck or
pathing rules. Repeated destruction must saturate instead of forming a black decal carpet.

### 6.5 Proposed code ownership

- New pure planner: `apps/game/src/world/world-context-plan.ts`
- New descriptor/config vocabulary: `apps/game/src/core/config/world-context.ts`
- Integration initially alongside current scatter initialization:
  `apps/game/src/world/scatter.system.ts`
- Existing consumers: `apps/game/src/world/Scatter.ts`, `apps/game/src/world/Decals.ts`,
  `apps/game/src/world/EnvironmentAssetCatalog.ts`, `apps/game/src/world/EnvironmentAssetLoader.ts`
- Existing wear becomes one source rather than being replaced:
  `apps/game/src/world/structure-wear.ts`
- Destruction bridge: the current VFX/decal event path and `layRubbleStory()`

Industrial Grid is the first bounded rollout target. Accepted context descriptors enter the existing pooled
world presentation directly; rollback is a source/config revert, not a player-visible URL mode.

### 6.6 Phase 3 acceptance

- The same seed and source list produce the same plan and fingerprint in WebGPU and headless tests.
- No simulation checksum, map generation, occupancy or placement fingerprint changes.
- At least depot, civilian and resource contexts are identifiable in blind screenshots without labels.
- Industrial Grid no longer reads as isolated buildings placed on generic terrain.
- Normal play adds no more than the environment plan's existing allowance of +2 colour and +2 shadow draws.
- Static decal admission preserves at least 128 protected combat-damage slots.
- Existing asset LOD, texture-budget and family-coherence tests remain green.
- Human approval rejects any result that is simply “more clutter.” The target is stronger hierarchy and
  environmental cause.

## 7. Phase 4 — material state and ground-contact cohesion

### 7.1 Shared surface-state contract

Create one presentation state consumed by material families:

```ts
interface SurfaceEnvironmentState {
  dayPhase: number;
  wetness: number;
  snow: number;
  dust: number;
  salt: number;
  contextTexture: Texture | null;
  contextWorldToUv: Matrix3;
}
```

The exact representation may change during implementation, but the ownership may not: one allocation-free
state source, shared live uniform slots, no material clones and no independent systems writing competing
weather values.

Object-local damage remains a separate existing per-instance channel. The shared environment state may
modulate how damage reads, but never invent damage.

### 7.2 Physically motivated responses

- **Wetness:** darkens porous dielectric albedo modestly, lowers roughness, strengthens contact dampness and
  dries over authored presentation time. Painted metal changes mainly in roughness, not black albedo.
- **Dust:** accumulates on upward-facing and sheltered lower-frequency regions, desaturates reflections and
  is reduced by rain. Desert receives the strongest coefficient.
- **Snow contamination:** uses upward orientation, height/exposure and biome context; it does not become a
  white world-space gradient pasted across every mesh.
- **Salt:** only appears within shoreline context and mainly changes painted/ferrous roughness and edge wear.
- **Damp grime:** follows ground proximity, service/runoff context and temperate/urban weather.
- **Damage:** soot and heat remain event-linked and saturate; they are not a global age slider.

All response magnitudes stay subordinate to authored albedo, faction material split and team colour.

### 7.3 Pilot order

Do not patch the whole roster at once. Validate one material family at a time:

1. terrain and roads;
2. foundation pads and one procedural structure per faction;
3. one imported structure per faction;
4. one imported vehicle and one procedural vehicle per faction;
5. rocks, debris and hard-surface environment props;
6. vegetation with a restricted wetness/dust response;
7. remaining structures, units and props by shared family.

Each pilot uses the same Industrial Grid day/rain matrix plus desert and snow counterexamples.

### 7.4 Ground-contact stack

Contact is solved at several scales, each by the cheapest existing owner:

- centimetres/pixels: existing contact-shadow system;
- foundation edge: pad material and pad-to-terrain fit;
- 1–5 metres: broad contact/damp/grime field and existing decals;
- site scale: phase 3 context masks and clustered props;
- destruction scale: rubble/wreck/disturbed-ground continuity.

Do not increase contact-shadow darkness to compensate for missing site composition. Do not place a uniform
dark halo under every object.

### 7.5 Proposed code ownership

- New shared state: `apps/game/src/world/surface-environment.ts`
- Weather/day publication: `apps/game/src/world/weather.system.ts` and
  `apps/game/src/world/time-of-day.ts`
- Terrain twins: `apps/game/src/world/TerrainMaterial.ts` and
  `apps/game/src/world/TerrainNodeMaterial.ts`, with shared numeric slots in
  `apps/game/src/world/terrain-uniforms.ts`
- Road twins: `apps/game/src/world/Roads.ts` and `apps/game/src/world/RoadNodeMaterial.ts`
- Prop twins: `apps/game/src/world/PropLibrary.ts` and `apps/game/src/world/PropNodeMaterial.ts`
- Procedural unit/structure twins: `apps/game/src/art/UnitFactory.ts`,
  `apps/game/src/art/UnitNodeMaterial.ts`, `apps/game/src/art/BuildingFactory.ts`, and
  `apps/game/src/art/StructureNodeMaterial.ts`
- Imported families: the existing import normalization seams in `ImportedUnitAssets.ts`,
  `buildings.system.ts`, `ImportedInfantryAssets.ts`, `ImportedWreckAssets.ts`, and
  `EnvironmentAssetLoader.ts`

Material pilots use the normal shared environment state and renderer twins directly. Rollback is kept at the
material-family integration boundary rather than exposed as a product URL mode.

GLSL `customProgramCacheKey` values must change whenever injected source changes. Node materials must use
node ownership points and must not copy GLSL `onBeforeCompile` cache-key patterns.

### 7.6 Phase 4 acceptance

- No per-instance material or texture allocation and no material/program count growth with unit count.
- Weather/day changes mutate uniforms only and cause no pipeline build after reveal.
- Wet ground and dry metal remain distinct; metal does not look chalky or uniformly varnished.
- Dust, salt, snow and dampness are absent where their causes are absent.
- Team-colour and emissive coverage remain inside their locked readability ranges.
- Every changed material has a tested TSL/WebGPU ownership path.
- No normal-play draw-call increase from the material system itself.
- Shared texture additions remain inside the normal family residency allowance; any new context texture is
  map-shared and replaces an equivalent temporary buffer before rollout.

## 8. Test matrix

### Pure and contract tests

- irradiance cache key, bounds, dirty-rectangle coalescing and deterministic CPU inputs;
- world-context planner fingerprints, priority admission, clearance and pool reserve;
- surface-state clamping, rain/dry transitions and biome coefficients;
- WebGPU neutral-resource behavior and device/resource lifecycle;
- TSL source contracts and render-path ownership.

Likely existing suites to extend:

- `apps/game/tests/structure-wear.spec.ts`
- `apps/game/tests/scatter.spec.ts`
- `apps/game/tests/terrain-surfaces.spec.ts`
- `apps/game/tests/terrain-node-material.spec.ts`
- `apps/game/tests/road-node-material.spec.ts`
- `apps/game/tests/stage-d-node-materials.spec.ts`
- `apps/game/tests/weather.spec.ts`
- `apps/game/tests/render-backend.spec.ts`

Add focused suites for `irradiance-cache`, `world-context-plan` and `surface-environment` rather than
turning one integration spec into a catch-all.

### Runtime and visual tests

- repeat captures for all Stage 0 fixtures;
- WebGPU fixed-fixture A/B against the recorded pre-change baseline and the accepted default-tier SSGI path;
- AMD and NVIDIA representative-device timing closure;
- device-loss recovery with irradiance resources active;
- 30-unit and mass-battle readability;
- construction/destruction stress to prove bounded dirty updates and pool saturation;
- full build, typecheck, render tests, asset tests and dependency checks before default promotion.

## 9. Budgets and stop conditions

The existing limits remain authoritative: 130 normal colour draws, no normal-play draw increase from authored
unit/structure assets, ≤10% Medium-quality GPU regression for visual art changes, shared texture families,
and the existing environment allowance of +2 colour/+2 shadow draws.

Additional workstream rules:

- Phase 2 is default on WebGPU once its boot, visual and whole-stack frame gates pass.
- Phase 3 admits descriptors to fixed budgets; it never grows pools at runtime.
- Phase 4 adds zero draws and zero per-instance resources.
- Any single stage that causes visible tactical mud, post-reveal shader compile, recurring upload spikes or
  unexplained deterministic drift is rolled back behind its switch before more content is added.
- A visual gain that exists only in close-up asset inspection and disappears at normal tactical zoom does not
  justify runtime cost.
- A result that passes metrics but fails human A/B review does not ship. A result that looks better but fails
  deterministic, device or budget gates also does not ship.

## 10. Rollout and deployment gates

| Gate | Default state | Required evidence | Rollback |
|---|---|---|---|
| R0 baseline | current game | repeatable fixture/counters | none |
| R1 irradiance prototype | WebGPU graph | stable baseline comparison, truthful total A/B timing, no PMREM hitch | revert graph integration |
| R2 Industrial Grid stories | bounded urban descriptors | fingerprints, pool reserve, screenshot approval | revert descriptor/config batch |
| R3 material pilot | selected shared family | TSL ownership, no program growth, weather matrix | revert family integration |
| R4 combined vertical slice | normal game paths | whole-stack timing, mass battle, destruction, device loss | revert each ownership seam independently |
| R5 biome rollout | one biome at a time | three approved context families/biome and counterexample shots | retain prior biome defaults |
| R6 default candidate | staged build | AMD/NVIDIA WebGPU closure, full CI, human scorecard | hold/revert the owning batch |
| R7 production release | explicit release authorization | release checklist and deployment health | normal release rollback |

No gate bundles its rollback. Lighting, stories and surface aging retain independent code/config ownership
so one failed batch can be reverted without unwinding the others.

## 11. First implementation batch

The first code batch should be deliberately narrow:

1. add the baseline fixture and measurements;
2. add pure irradiance-cache descriptors and worker generation with tests;
3. transfer one fixed field from the existing terrain worker job without adding a boot-time fetch or pool;
4. integrate a conservative default WebGPU composite with a neutral retained field;
5. capture day/dusk/night plus camera-pan A/B evidence;
6. decide whether the composite is materially sound before beginning semantic context work.

This creates the lighting foundation without touching the current in-progress foliage rollout or performing
a broad material rewrite. Phase 3 begins only after the Phase 2 composite passes that decision gate.

## 12. Second implementation batch

The next bounded batch extends the same default WebGPU path without adding product switches:

1. **Retained context light.** Up to 18 deterministic depot, civilian and resource anchors compose once
   into the existing 64×64 irradiance backing store. The renderer reuploads its retained 32 KiB RGBA16F
   source without replacing the texture, graph or pipeline. Time-of-day response remains uniform-only.
2. **Destruction continuity.** A structure lays one attacker-facing pooled scorch at the existing heavy-
   damage threshold. Its later rubble decal and wreck inherit that angle and source seed, including
   scripted, one-shot and attacker-handoff deaths. Destroyed-building pool cost remains unchanged.
3. **Procedural structure-family material pilot.** Foundation concrete and shared faction structure
   materials consume the existing surface-weather state in their WebGPU node graph. ORM alpha preserves
   the authored paint/exposed-surface split: paint responds mainly through roughness, porous material takes
   restrained wet/dust colour, and contact contamination is confined to the model-space foundation band.
4. **Boot recovery.** Imported foliage settles before the one intentional WebGPU pipeline compile, so asset
   rebuilds no longer contend with Dawn's shader workers or create a post-reveal first-use compile. This
   changes scheduling only; the authored default and deterministic placement remain unchanged.

The batch adds no render pass, draw call, runtime asset, material clone, shader variant or worker pool. The
late context-light job touches only a few hundred retained texels once; worker messaging or WASM startup
would cost more than its bounded scalar work. The structure response executes on the GPU. Destruction adds
one 24 KiB generation-stamped side array per `DamageSystem` and no per-frame/per-hit allocation.

## 13. Final all-map implementation batch

The normal WebGPU game path now completes the rollout across Temperate Valley, Airbase Flats, Frozen
Sector, Industrial Grid, Contested Strait, Coral Shore and Sunder Atoll:

1. **Map-specific place grammar.** Every preset plans deterministic, capped depot, civilian, resource,
   woodland and ruin context marks from real structures, resources, wrecks and accepted vegetation
   clusters. Each preset owns a grammar fingerprint and a fixed admission cap; no camera-dependent or
   unbounded scatter work was added.
2. **Shared contextual irradiance.** Compatible active-place anchors feed the retained 64×64 field and its
   bounded context-light set on every map. The existing terrain warm worker and WASM loader are reused;
   this batch adds no worker pool, fetch, texture or render pass.
3. **Causal climate state.** Inland, coast, tropical, atoll and snow causes expose retained shoreline
   wetness, salt and snow contamination. Rain washes salt, shoreline dampness persists locally, and dirty
   snow is limited to snow-bearing surfaces.
4. **WebGPU material-family closure.** Terrain, roads, procedural structures, units, procedural props and
   the default authored environment catalogue consume one shared TSL climate state. Terrain confines salt
   and shore dampness to its shore layer; roads exclude traffic/paint from fresh deposition; faction paint
   and authored mapped roughness remain authoritative.

The seven-map acceptance matrix passes on the current real WebGPU device with 4,096 irradiance probes on
every map, stable simulation hashes through a 40 m camera pan, zero post-warmup program growth and 47–57
colour draws (well below the 130-draw ceiling). Accepted semantic context counts are 24, 21, 18, 30, 16,
25 and 14 respectively in the map order above. Frozen Sector was rerun after the final road-snow change and
retained hash `1145686088`, 18 contextual wear marks and the same 18 semantic contexts.

This closure adds no runtime asset, material clone, shader variant, product query flag, render pass or draw
call. The pure context planners are small, late and fixed-budget; dispatching them to a worker or starting a
new WASM module would cost more boot time than their scalar work. GPU-owned weather response stays in shared
uniform nodes. AMD/Intel and packaged-device validation remain release gates, not unfinished map content.
