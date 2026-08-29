# Allied Chrono Miner v1

Content key: `allied_harvester`
Display name: Chrono Miner
Faction: Allies
Class: heavy tracked resource vehicle
Frozen gameplay dimensions: 8.6 x 4.0 x 3.3 m
Forward / intake direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A symmetrical forward-swept ceramic cargo capsule is the dominant mass over a visible graphite chassis.
2. One deep full-width collector throat and paired enclosed lifts make the front unmistakably industrial.
3. Shrouded tracks, a deep rear unload door and one low integrated chrono ring separate it from a conventional truck.

Allied cues are continuous precision shells, controlled symmetry, hidden running hardware and exact panel
alignment. The chrono ring is thick, supported and low; it is not a turret, antenna or loose floating hoop.

## Gameplay contracts

- Preserve the shared `harvester` role, current fit, selection, collision, cargo and +Z heading.
- Preserve unload, damage, wreck and team-colour hooks.
- Keep the front collector mechanism separable and the graphite understructure visibly closed.
- Keep the procedural `allied_harvester` model as the automatic loading-failure fallback.

## Geometry references

`orthographic-sheet.png` and its four cardinal crops are the neutral-clay reconstruction authority.
Reject exposed busy wheel clutter, a filled intake, a floating chrono ring, inflated ceramic panels,
inconsistent running gear or any design that becomes Soviet after colour is removed.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A conditional final-topology remesh is 5 credits and
retexture is 10 credits. Both downstream tasks remain blocked until the previous geometry gate passes.
Maximum planned spend: 35 credits.

Shipping LOD0 targets 40k-50k triangles by explicit art-direction approval, with mandatory LOD1/LOD2,
shadow proxy, KTX2 and dense economy-fixture validation.

## Delivered result

- Meshy geometry task: `01a03de1-2df6-704a-991d-830c2bfeb609` (20 credits).
- Exact-topology retexture task: `01a03de5-d024-7683-9a45-7599fbc8c5ce` (10 credits).
- Paid remesh skipped after the local silhouette and topology gates passed.
- Shipping geometry: 49,825 / 22,416 / 8,968 triangles for LOD0/LOD1/LOD2, plus a 1,728-triangle shadow proxy.
- Texture delivery: required KTX2; 5,323,820-byte source reduced to 4,106,272 bytes and estimated 48 MiB RGBA residency reduced to 8 MiB at 8 bpp.
- Runtime: `packages/assets/game/units/allies/compressed/chrono-miner.glb`, with automatic procedural fallback.
- Validation: asset and render gates plus WebGL/WebGPU economy-scene captures passed on 2026-08-26.

Final Meshy spend: 30 credits.
