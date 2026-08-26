# Meridian Sun Collector v1

Content key: `meridian_collector`
Display name: Sun Collector
Faction: Meridian Pact
Class: light hover resource vehicle
Frozen gameplay dimensions: 8.4 x 3.9 x 3.25 m
Forward / intake direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A visible uninterrupted hover gap - no wheel, track, leg or hidden ground-contact substitute.
2. A suspended faceted ore drum is the dominant mass above a layered hexagonal levitation chassis.
3. Two thick crescent collector mandibles, one open intake throat and two supported solar fins establish the function.

Meridian cues are hexagonal/crescent construction, suspended layers and purposeful negative space. The
vehicle must read as a balanced solar instrument in greyscale, not an Allied hull with fins.

## Gameplay contracts

- Preserve hover locomotion, the faster light-harvester profile, current fit, collision, cargo and +Z heading.
- Preserve unload, damage, wreck and team-colour hooks plus the runtime hover gap/drift.
- Keep paired fins and intake mandibles count-stable across every view and derived LOD.
- Keep the procedural `meridian_collector` model as the automatic loading-failure fallback.

## Geometry references

`orthographic-sheet.png` and its four cardinal crops are the neutral-clay reconstruction authority.
Reject ground contact, paper-thin fins, filled hover/intake voids, duplicate mandibles, organic inflation,
floating debris or mismatched mechanism counts.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A conditional final-topology remesh is 5 credits and
retexture is 10 credits. Both downstream tasks remain blocked until the previous geometry gate passes.
Maximum planned spend: 35 credits.

Shipping LOD0 targets 40k-50k triangles by explicit art-direction approval, with mandatory LOD1/LOD2,
shadow proxy, KTX2 and dense economy-fixture validation.

## Delivered result

- Meshy geometry task: `01a03deb-2f14-7db5-9a9b-b56d4e083c99` (20 credits).
- Exact-topology retexture task: `01a03def-2786-79fe-9dd9-d0ff785b241c` (10 credits).
- Paid remesh skipped after the local hover-gap, mandible and silhouette gates passed.
- Shipping geometry: 49,837 / 22,425 / 8,968 triangles for LOD0/LOD1/LOD2, plus a 1,656-triangle shadow proxy.
- Texture delivery: required KTX2; 5,357,424-byte source reduced to 4,077,580 bytes and estimated 48 MiB RGBA residency reduced to 8 MiB at 8 bpp.
- Runtime: `src/assets/units/meridian/compressed/sun-collector.glb`, loaded by the private Meridian registry with automatic procedural fallback.
- Validation: asset and render gates plus WebGL/WebGPU faction-scene captures passed on 2026-08-26.

Final Meshy spend: 30 credits.
