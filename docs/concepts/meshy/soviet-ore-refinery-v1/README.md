# Soviet Ore Refinery v1

Content key: `soviet_refinery`  
Display name: Ore Refinery  
Faction: Soviet Union  
Class: 3x2 economy landmark  
Frozen gameplay dimensions: 12 x 8 x 9 m (`BUILDING_DIMENSIONS.refinery`)  
Facade / harvester dock: +Z, offset toward the front-right

## Art brief

The refinery is a squat armoured processing bunker dominated by one faceted ore hopper. It must
read as the economy building at normal RTS distance without borrowing the War Factory's twin drums
or giant vehicle door.

Non-negotiable silhouette cues:

1. One large faceted ore hopper at the rear-left, physically tied into the bunker by a thick pipe.
2. A deep protected unloading intake at the front-right with a short ground-level receiving tray.
3. A low central crusher housing, one compact exhaust and heavy perimeter buttresses.

Reject cranes, long external conveyors, lattice, railings, cables, thin rods, antenna farms,
floating parts, loose props, giant garage doors, random roof clutter, rounded blob forms and
machinery that exceeds the frozen footprint.

## Gameplay contracts

- Preserve the 3x2 footprint and 9 m silhouette ceiling.
- Keep the +Z harvester approach and at least five metres of clear apron in front of the intake.
- Preserve `PartId.DockEntry` at the front-right and `PartId.Conveyor` at the receiving intake.
- The imported art is visual only; docking, ownership, storage and unloading remain simulation data.
- Keep the procedural model as a load-failure fallback until all acceptance gates pass.

## Geometry references

`orthographic-sheet.png` is the approved source sheet. `front.png`, `right.png`, `back.png`, and
`left.png` are exact 768x512 quadrants supplied to Meshy in that order. The long side projection
from the first ImageGen draft was explicitly rejected and removed before these files were frozen.

The accepted design uses clean neutral clay, consistent orthographic scale, planar armour, a
contained silhouette and physically connected medium/large forms. Colour is deliberately deferred
until geometry approval.

## Geometry delivery

- Meshy multi-image task: `01a02b72-5b87-7d99-b997-d16699e62815`.
- Dense source: 1,948,730 triangles, 974,353 vertices, one coherent component, 33.45 MiB.
- Local production candidate: 35,076 triangles, 17,526 vertices, one static primitive, 0.40 MiB.
- Local reduction: `building`, ratio `0.018`, error `0.001`, static merge.
- Runtime orientation correction: yaw `+90deg`; the source intake faces Meshy's left axis and must
  face VOLTMARCH `+Z`.
- Geometry gate: approved in neutral front/right/back/left and hero views. The hopper, recessed
  front-right intake, crusher housing, exhaust, perimeter armour and ground contact all survive the
  reduction; no crane, long conveyor, detached prop or swollen shell remains.
- Local xatlas UV0: 35,076 triangles preserved exactly, 29,802 seam-split UV vertices, 2048 packing
  target with 8 px padding, zero bounds drift, one primitive and one temporary placeholder material.

## Material direction

`material-sheet-v1.png` preserves the approved four-view geometry and adopts the War Factory's
accepted clean PBR language: deep field olive armour, contiguous crimson structural bands and
buttress plates, charcoal intake/vents, gunmetal tray, restrained brass pipe collars and tiny amber
dock lights. Red follows complete panels and reinforcement bands; random freckles, global tinting,
heavy grunge and baked lighting are explicitly rejected.

The approved retexture payload used the exact local UV model, preserved original UVs, requested PBR,
kept 4K HD disabled, removed lighting and asked only for GLB.

## Texture delivery and integration

- Meshy retexture task: `01a02b7f-1f75-709f-bd19-5f736e5b3809`.
- Consumed credits: 10; account balance after delivery: 930.
- Raw result: 35,046 triangles, 29,720 vertices, one coherent mesh, one PBR material, 8.69 MiB.
  Meshy discarded 30 degenerate source triangles while generating normals/tangents and normalized
  the box; the approved visible geometry remains intact.
- Textures: 2048 base colour, 2048 normal and 2048 packed metal/roughness.
- Conditioned shipping result: `apps/game/src/assets/buildings/soviets/ore-refinery.glb`, 4.04 MiB. Base colour
  and normal remain 2048; packed metal/roughness is reduced to 1024. Geometry is unchanged from the
  retexture delivery.
- Runtime fit: yaw `+90deg`, 0.94 footprint width, 0.90 footprint depth and 0.92 height, preserving
  the 12x8x9 m gameplay contract and +Z front-right intake.
- Runtime material: front-side PBR, 38-degree crease normals and the War Factory's restrained
  painted-metal response. All procedural visual parts are filtered; sockets, docking and simulation
  contracts remain authoritative.
- Visual gate: passed neutral hero/front/right/back/left reviews and a close WebGL in-game noon
  capture with clean ground contact, coherent red zones, readable olive panels, intact normals and
  no UV contamination. WebGPU remains live in the desktop dev instance for user review.

## Staged pipeline

1. Multi-image geometry only (`latest`, no texture, no automatic remesh) — 20 credits.
2. Stop and audit cardinal views, components, intake depth, apron clearance, bounds and triangles.
3. Deterministically reduce the approved dense source locally into the 25k-40k landmark envelope.
4. Generate 38-degree crease normals and local xatlas UV0; repeat neutral and WebGPU geometry gates.
5. Create a roster-matched olive/crimson/charcoal material sheet from the approved geometry.
6. Retexture the exact local UV model with PBR, original UVs preserved and no HD texture — 10 credits.
7. Condition textures to the building budget, integrate, and compare against the Construction Yard,
   War Factory and Tesla Reactor under the same Soviet-base fixture.

Maximum planned Meshy spend: 30 credits. Every paid call remains a separate approval gate.
