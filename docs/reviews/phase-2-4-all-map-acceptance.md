# Phase 2-4 all-map WebGPU acceptance

The Phase 2-4 realism batch is a default-on WebGPU product change. The
all-map evidence runner does not add or set a product feature flag. It uses the
existing `weather`, `dayphase`, `gpupasses`, `bootprofile`, `skipmenu`, and
deterministic-start critic/diagnostic controls only to select reproducible
evidence. In particular, there is no `?gi=probes` (or equivalent) gate.

## Deterministic cells

`tools/lib/realism-map-matrix.mjs` is checked against `MAPS`, `MAP_PRESETS`,
and `MAP_START_TABLES` by `realism-map-matrix.spec.ts`, so a shipped map cannot
be added, renamed, or repointed without updating its evidence cell.

| Map | Preset / terrain biome | Authored light | Weather cell | Expected surface | Semantic grammar |
| --- | --- | --- | --- | --- | --- |
| Temperate Valley | temperate / temperate | noon | heavy | rain | temperate |
| Airbase Flats | arid / desert | noon | off | dry dust | arid |
| Frozen Sector | snow / snow | overcast | heavy | snow | snow |
| Industrial Grid | urban / urban | night | off | dry urban | urban |
| Contested Strait | coast / temperate | noon | heavy | rain | coast |
| Coral Shore | tropical / temperate | noon | light | rain | tropical |
| Sunder Atoll | atoll / temperate | noon | heavy | rain | atoll |

Each runtime cell reaches exact simulation tick 120, captures a 1920x1080 PNG,
pans 40 metres without advancing simulation, and records the following:

- renderer backend and first-stable-frame boot report;
- replay tick/hash at centre, pan, and returned camera poses;
- colour draws and shader-program count before/after the pan;
- installed irradiance pixels and whether the field came from a worker;
- contextual structure-wear source/mark counts and deterministic fingerprint;
- weather kind/precipitation;
- semantic-context and retained context-light counts/fingerprints.

Run `node tools/realism-map-matrix.mjs` for a fresh build or add `--no-build`
to use the current `apps/game/dist`. `--map=frozen-sector` selects one cell.
The runner starts its own preview server; it does not stop or reuse the live
Vite development server.

## Gates

Every map must use WebGPU, install at least 4,096 irradiance probes, spawn at
least one causal structure-wear mark with a non-zero fingerprint, preserve the
simulation hash through the camera move, remain at or below 130 colour draws,
and add zero shader programs after warm-up. Weather must match the cell. Every
cell additionally requires its own preset grammar, non-zero semantic marks,
contextual-light anchors, and deterministic grammar/mark/light fingerprints.
Worker adoption is evidence, not a correctness gate: the
deterministic main-thread irradiance fallback remains valid after a worker
timeout or unavailable Worker API.

## Remaining acceptance/runtime limits

1. The runner proves that each map publishes the right weather classification
   and deterministic counters, then saves a screenshot for critic inspection.
   It does not yet compute a pixel-space wetness/salt/snow metric. A later image
   scorer should use authored ground regions rather than a whole-frame colour
   average, which would be dominated by units, water, and sky.
2. Terrain now applies causal shoreline dampness/salt and snow contamination,
   and surface-environment causes distinguish coast, tropical, atoll, and snow.
   Road node materials still carry the snow scalar as reserved rather than
   applying deposited snow to road pixels; Frozen Sector is therefore not a
   complete road-snow pilot.
3. Only Industrial Grid authors a day/night cycle. The other six cells validate
   their fixed authored mood; expanding dynamic time coverage is a content and
   lighting decision, not something the acceptance tool should force with a
   product query switch.
