# Soviet Ore Collector v1

Content key: `soviet_harvester`
Display name: Ore Collector
Faction: Soviets
Class: heavy tracked resource vehicle
Frozen gameplay dimensions: 8.6 x 4.0 x 3.3 m
Forward / intake direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. A broad flared hopper is the dominant mass and remains legible at normal RTS distance.
2. A full-width open mining scoop, one crusher-tooth row and paired hydraulic arms form the front read.
3. Six-road-wheel tracked running gear, a deep rear unload hatch and two compact pressure vessels communicate weight and function.

Soviet cues are forged olive armour masses, gunmetal machinery, restrained crimson identity panels,
protected joints and external industrial hardware. There is no turret, weapon, crane, lattice or decorative
antenna farm.

## Gameplay contracts

- Preserve the current `harvester` role, 8.6 x 4.0 x 3.3 m fit, selection radius, collision and +Z heading.
- Preserve ore collection, cargo, unload, damage, death/wreck and team-colour presentation.
- The scoop assembly must remain mechanically separable even if the first runtime pass is static.
- Keep the procedural `soviet_harvester` model as the automatic loading-failure fallback.

## Geometry references

`orthographic-sheet.png` is the source sheet. `front.png`, `right.png`, `back.png` and `left.png` are its
exact quadrants for multi-image reconstruction. They use neutral clay, one mechanism state, a common scale
and common baseline.

Reject a result with fused tracks, a filled intake, extra tooth rows, swollen hopper planes, inconsistent
wheel counts, open backsides or an inseparable scoop/body seam.

## Staged Meshy plan

1. Meshy 6 multi-image geometry only, GLB, no texture - 20 credits.
2. Stop for raw/cardinal/triangle audit and an untextured in-game geometry gate.
3. Remesh only if the approved dense source cannot reach the user-approved 40k-50k hero-harvester ceiling locally - 5 credits.
4. Stop and repeat the geometry, bounds, component and normals gates on final topology.
5. Retexture only the final approved topology from a separate material reference - 10 credits.

Maximum planned pilot spend: 35 credits. Any failed geometry gate cancels downstream spend.

The 40k-50k LOD0 ceiling is an intentional project override for the economy hero family. LOD1, LOD2,
a shadow proxy, shared KTX2 material residency and realistic multi-harvester stress metrics are mandatory
before integration; the higher close-range ceiling is not permission to regress normal-play frame time.

## Delivered result

- Meshy geometry task: `01a03db8-9098-7a64-8736-63d8b5c3c0c5` (20 credits).
- Exact-topology retexture task: `01a03dc6-d9f9-7c0b-b4a8-485da2a289da` (10 credits).
- Paid remesh skipped: the dense source reduced locally without losing the hopper, scoop or track silhouette.
- Shipping geometry: 49,715 / 22,371 / 12,085 triangles for LOD0/LOD1/LOD2, plus a 1,344-triangle shadow proxy.
- Texture delivery: required KTX2; 5,369,188-byte source reduced to 4,538,968 bytes and estimated 48 MiB RGBA residency reduced to 8 MiB at 8 bpp.
- Runtime: `packages/assets/game/units/soviets/compressed/ore-collector.glb`, with automatic procedural fallback.
- Validation: asset and render gates plus WebGL/WebGPU faction-scene captures passed on 2026-08-26.

Final Meshy spend: 30 credits.
