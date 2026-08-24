# Soviet Tesla Reactor v2

Content key: `soviet_power`  
Display name: Tesla Reactor / Power Plant  
Faction: Soviet Union  
Class: standard 2x2 power-generation building  
Frozen gameplay dimensions: 8 x 8 x 9 m (`BUILDING_DIMENSIONS.powerPlant`)  
Facade: +Z

## Rebuild boundary

V2 is a clean restart. The rejected Tesla Reactor baseline supplies no geometry, material, texture,
accessory or silhouette component to this model. V2 has replaced it in the runtime asset slot.

## Art brief

The new Power Plant is a compact Soviet induction station rather than a boiler with roof clutter. Its
paired transformer drums and open busbar span must identify power generation at normal RTS distance,
while the low armored plinth keeps it visibly cheaper and smaller than the Refinery and War Factory.

Non-negotiable silhouette cues:

1. Two identical broad octagonal induction drums on the rear half, each divided by three thick solid
   transformer collars.
2. One heavy busbar bridge joining the drums, with a clean open negative space below it.
3. A low square generator plinth with a deep front conversion chamber and four broad corner capacitor
   fins integrated into the outer buttresses.

Soviet faction cues:

1. Deep field-olive riveted armor and charcoal lower machinery dominate the material read.
2. Four contiguous crimson capacitor slabs sit on vertical silhouette-facing fins and occupy 2.5-4%
   of visible area; red never becomes a roof wash or random wear.
3. Dark gunmetal transformer collars, restrained brass bus contacts and a tiny radioactive-green
   energy read provide the second material family without noisy micro-detail.

Reject chimneys, boiler tanks, silo proportions, domes, bunker doors, cranes, dishes, wires, cables,
lattice, railings, floating parts, rounded blob forms, fused drums, sealed busbar negative space,
baked lighting and photoreal grime.

## Gameplay contracts

- Preserve the 2x2 footprint, 9 m height target, selection, collision, 800 HP and +100 power output.
- Preserve `PartId.Stack` near the left-rear induction drum and `PartId.ExitPoint` as nonvisual sockets.
- The generated building is one complete static body; no moving visual part is required.
- Keep the gameplay sockets nonvisual; the imported V2 shell is the complete visual building.

## Production budgets

- Static LOD0 body: 15,000-20,000 triangles preferred, 25,000 hard ceiling; one material.
- Texture target: 2K base colour, 2K normal and 1K packed metal-roughness.
- Shipping GLB: 6 MiB ceiling.
- Shadow proxy: below 2,000 triangles, derived locally from the approved body.
- No accessory draw. Staying at or below 20K avoids mandatory visual LODs for this repeated base unit.

## Approved geometry references

`geometry-sheet.png` is the complete neutral four-view reconstruction sheet. `front.png`, `right.png`,
`back.png` and `left.png` are exact quadrants and are the only images supplied to Meshy. Every panel
uses the same object, scale, baseline, camera height and mechanism state.

## Staged Meshy plan

1. Multi-image geometry only (`latest`, no texture, no automatic remesh) - 20 credits.
2. Stop and audit drum separation, busbar opening, planar armor, footprint, bounds and triangles.
3. Reduce and unwrap the passing dense source locally; no paid remesh.
4. Retexture the exact approved UV mesh with PBR, original UVs preserved and no HD texture - 10 credits.
5. Condition to the 2K/2K/1K profile, derive the shadow proxy, integrate and validate against the
   Construction Yard, Radar, War Factory and Refinery in WebGL and WebGPU.

Maximum Meshy spend: 30 credits. Balance before V2: 840. The user's explicit request to discard the old
Power Plant and execute the full better-quality rebuild is the approval for this capped pipeline.

## Delivery

- Geometry task: `01a02c02-8084-7cc4-83bc-0afdc39073fe` (20 credits).
- Retexture task: `01a02c0c-63bd-7e9a-aa5b-97bfd0969b8f` (10 credits).
- Final balance: 810 credits; no paid remesh or retry was used.
- Shipping model: 15,025 triangles, 14,472 vertices, one static primitive/material, 3.44 MiB.
- Maps: 2K base colour, 2K tangent-space normal and 1K packed metal-roughness.
- Runtime: `src/assets/buildings/soviets/tesla-reactor.glb`; all procedural visual parts are disabled.
- Review artifacts: `geometry-gate-webgpu.png`, `textured-cardinals.png` and `final-webgpu-bright2.png`.
