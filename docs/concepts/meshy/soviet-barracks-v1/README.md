# Soviet Barracks v1

Content key: `soviet_barracks`  
Display name: Barracks  
Faction: Soviet Union  
Class: 2x2 infantry production building  
Frozen gameplay dimensions: 8 x 8 x 6.4 m (`BUILDING_DIMENSIONS.barracks`)  
Facade / infantry exit: +Z

## Art brief

The Barracks is a compact armoured troop billet: lower and simpler than the War Factory, but more
fortified than a utility building. It must read instantly as the Soviet infantry-production anchor
at the normal RTS camera distance, with a deep, unmistakable personnel entrance.

Non-negotiable silhouette cues:

1. A low, wide chamfered bunker with a stepped roof cap and firm, continuous ground contact.
2. A deep central personnel portal framed by two thick angular front buttresses.
3. One compact roof ventilation block with a few short, heavy exhaust ducts; no thin roof clutter.

Soviet faction cues:

1. Deep field-olive riveted armour and ochre structural inserts form the dominant shell.
2. Contiguous crimson vertical slabs sit on the front buttresses and selected outer edges, occupying
   roughly 2.5-4% of the visible surface; never use a red hull wash or random red flecks.
3. Charcoal recesses, exposed gunmetal pipes, restrained brass fasteners and tiny amber practical
   lights separate the forms without muddy photoreal grunge.

Reject domes, long chimneys, lattice, railings, wires, cables, loose props, weapons, antennas,
floating parts, paper-thin plates, rounded blob forms, melted seams, camouflage, baked lighting and
photoreal-grey materials.

## Gameplay and animation contracts

- Preserve the 2x2 footprint, 6.4 m silhouette ceiling, selection, collision and infantry exit
  clearance.
- Preserve the front `PartId.Door` socket and the existing construction-rise, damage and shadow
  paths.
- The generated asset supplies the complete static building body. It deliberately contains a deep
  empty door pocket but no door panel.
- A small locally authored sliding door is the only modular gameplay accessory. This is an explicit
  animated boundary, not a legacy-shell mashup or arbitrary procedural repair.
- Keep the old procedural Barracks as a load-failure fallback until geometry, material, animation,
  budget and runtime gates pass.

## Production route

Generate the static body from four body-only orthographic references. Audit the dense reconstruction
before any retopology or texture spend. If the silhouette passes, reduce and unwrap it locally,
author the sliding door around the preserved portal, then retexture the exact approved UV model.

Budgets:

- Static body: 15,000-25,000 LOD0 triangles; one PBR material; 2K base/normal + 1K packed MR.
- Sliding door: 100-500 triangles; shared family material language and stable local pivot.
- Shipping GLB: 6 MiB target before later KTX2/LOD work.
- Mandatory shadow proxy and LODs if the final static body remains above 20,000 triangles.

## Approved geometry references

`geometry-sheet.png` is the complete neutral four-view reconstruction sheet. `front.png`,
`right.png`, `back.png` and `left.png` are its exact 768x768 quadrants and are the only images to be
supplied to the geometry task. All four depict the same untextured building, scale, mechanism state
and baseline. The front reference fixes the deep empty personnel portal; the door is intentionally
absent so the runtime can retain a clean animated panel without combining two competing bodies.

The reference targets the Radar Tower's approved geometry standard: crisp planar armour, readable
bevels, distinct components, restrained roof machinery and no fused decorative noise.

## Staged Meshy plan

1. Approve the neutral four-view geometry sheet and frozen animated-door boundary.
2. Multi-image static-body geometry only (`latest`, no texture, no automatic remesh) - 20 credits.
3. Stop and audit all cardinal views, portal depth, ground contact, component integrity, bounds and
   triangles before any downstream spend.
4. Deterministically reduce and unwrap the approved source locally; author the modular door locally.
5. Stop and verify the door, exit, shadow and construction rise in WebGL and WebGPU.
6. Retexture the exact approved UV model with PBR, original UVs preserved and no HD texture -
   10 credits.
7. Condition textures, integrate and compare beside the approved War Factory, Refinery and Radar.

Maximum planned Meshy spend: 30 credits. Every paid call remains a separate approval gate.

## Geometry delivery

- Meshy multi-image task: `01a02bcc-276b-7e44-82ab-8cdf0ea164fe`.
- Consumed credits: 20; account balance after delivery: 880.
- Dense source: 1,984,626 triangles, 992,221 vertices, one dominant coherent shell plus two small
  front service-panel components, 34.07 MiB.
- The first 16,852-triangle reduction was rejected because it weakened the defining entrance depth.
- Approved local body candidate: `local-25k-candidate.glb`, 24,994 triangles, 12,432 vertices and
  0.29 MiB. Preparation uses the `building` profile, ratio `0.0126`, error `0.0015` and static merge.
- Geometry gate: the dense reconstruction preserves the chamfered bunker, deep central portal,
  paired front buttresses, short roof ducts, side hatches, rear intake and continuous ground line.
  There is no lattice, crane, thin clutter or generated door competing with the runtime panel.
- Final local UV candidate: `local-25k-uv.glb`, exactly 24,994 triangles with zero bounds drift;
  xatlas produces 25,550 seam-split vertices with 8 px padding at 2048 resolution.

## Material reference

`material-sheet.png` is the approved-body colour target. It applies the War Factory and Radar's
field-olive armour, coherent crimson buttress and edge slabs, charcoal portal/vents, gunmetal pipes,
restrained brass fasteners and tiny amber practical lights. Random red spots, global red tint,
heavy wear, baked lighting and geometry changes are explicitly rejected.

## Material delivery and runtime integration

- Meshy retexture task: `01a02bd6-082f-7402-852d-88a842fa5db1`.
- Consumed credits: 10; account balance after the complete Barracks: 870.
- Shipping body: 24,917 triangles, 25,332 vertices, one mesh/primitive/material and 3.67 MiB.
- Shipping maps: 2048 base colour, 2048 tangent-space normal and 1024 packed metal-roughness.
- Runtime asset: `src/assets/buildings/soviets/barracks.glb`.
- The imported body replaces the old procedural shell completely. Only the explicitly authored
  sliding-door geometry is extracted by `STRUCTURE_FEATURE.door`, retaining the existing GPU door
  cycle, construction rise and animated depth shadow.
- `runtime-webgpu.png` verifies the recessed open state and roster match; `runtime-webgl.png`
  verifies the closed crimson door, correct facade and renderer parity.
