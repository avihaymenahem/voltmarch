# Shore and snow surface-environment contract

This contract extends the retained presentation-only surface state without changing simulation,
render passes, textures, material instances, or per-frame allocation. It covers the authored
`coast`, `tropical`, `atoll`, and `snow` map identities through frozen cause profiles; unknown map
names resolve to a zeroed inland profile.

## State and lifecycle

`surfaceEnvironmentCauseForMap(map)` returns one shared frozen `SurfaceEnvironmentCause` containing
the map's shoreline-dampness, marine-salt, and persistent-snow envelopes. World initialization
passes that object to `resetSurfaceEnvironment(biome, dayPhase, cause)` once. The existing
`stepSurfaceEnvironment` call remains unchanged and mutates the same retained state object.

The added state scalars are:

- `shoreWetness`: persistent tidal/spray dampness, raised further by rain;
- `salt`: slow clear-weather marine deposition, rapidly washed by rain or fresh snow;
- `snowContamination`: dirt/grit visible through persistent snow, buried by fresh snowfall and
  gradually revealed again through contact, dust, and thaw.

These are global cause envelopes, not spatial classifications. Coastal materials must multiply
`shoreWetness` and `salt` by an existing local shoreline/beach mask. Snow materials must multiply
`snowContamination` by their existing snow-layer and upward-facing masks. Applying the values
uniformly across a map would violate the causal-material rule.

## Narrow integration requirements

The integration owner should make two small changes:

1. In `weather.system.ts`, resolve the planned map once and pass
   `surfaceEnvironmentCauseForMap(plannedScenario().map)` to every match reset. No query flag or
   per-frame lookup is needed.
2. Add one retained `vec3` uniform to the WebGPU surface consumers that need this slice, packed as
   `(shoreWetness, salt, snowContamination)`. Mutate its existing value in each
   `setSurfaceEnvironment` implementation beside the current `(wetness, dust, snow, contact)`
   vector. Terrain can gate shore response with its sand/shore splat and snow contamination with its
   snow layer. A structure must not consume shore salt until it has a world-position shoreline mask;
   do not substitute one material per instance.

No worker is appropriate: profile lookup is one switch at reset, while each frame performs only
retained scalar approaches already owned by the weather system.
