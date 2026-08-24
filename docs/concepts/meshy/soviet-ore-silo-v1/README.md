# Soviet Ore Silo v1

Content key: `soviet_silo`  
Display name: Ore Silo  
Faction: Soviet Union  
Class: 1x1 resource-storage building  
Frozen gameplay dimensions: 4 x 4 x 5 m (`BUILDING_DIMENSIONS.oreSilo`)  
Facade / service gauge: +Z

## Art brief

The Ore Silo is a compact fortified storage vessel, not a miniature bunker. Its vertical drum and
fill hardware must identify it at normal RTS distance while staying materially and geometrically
lighter than the nearby Refinery.

Non-negotiable silhouette cues:

1. One stout faceted storage drum with a shallow armoured hopper roof and flat inspection cap.
2. Four thick angular base buttresses and a continuous lower service skirt anchoring the 1x1 form.
3. A short heavy side fill pipe, front recessed ore-level gauge/intake and rear maintenance hatch.

Soviet faction cues:

1. Deep field-olive riveted armour is the dominant shell material.
2. Controlled contiguous crimson vertical ribs and one cap band occupy roughly 2.5-4% of the visible
   surface; never use a red hull wash or random red flecks.
3. Charcoal service recesses, gunmetal pipework, restrained brass fittings and tiny amber gauge lights
   separate the mechanisms without photoreal grime.

Reject bunker doors, turrets, radar dishes, giant chimneys, lattice, railings, cables, loose props,
paper-thin plates, floating parts, melted seams, rounded blob forms, baked lighting and noisy wear.

## Gameplay contracts

- Preserve the 1x1 footprint, 5 m silhouette ceiling, selection, collision and 1,500-credit storage
  behaviour.
- Preserve `PartId.Hopper` and `PartId.DockEntry` sockets as nonvisual gameplay contracts.
- No moving visual part is required. The generated asset is one complete static body.
- Keep the procedural Silo as a load-failure fallback until geometry, material, budget and runtime
  gates pass.

## Production route and budgets

Generate one static body from the four approved orthographic references. Audit the dense source before
local retopology, unwrap locally, then retexture only the approved final topology.

- Static body: 8,000-14,000 LOD0 triangles; one material.
- Texture target: 1K base colour, 1K normal and 512 packed metal-roughness.
- Shipping GLB: 3 MiB target.
- Shadow proxy target: below 1,500 triangles; derive locally from the approved body.
- Runtime draw delta: one imported instanced body, with no accessory draw.

## Approved geometry references

`geometry-sheet.png` is the complete neutral four-view reconstruction sheet. `front.png`,
`right.png`, `back.png` and `left.png` are its exact 768x768 quadrants and are the only images supplied
to Meshy. Every view uses the same object, scale, baseline, service hardware and mechanism state.

## Staged Meshy plan

1. Multi-image geometry only (`latest`, no texture, no automatic remesh) - 20 credits.
2. Stop and audit cardinal form, drum planarity, buttresses, pipe separation, bounds and triangles.
3. Reduce and unwrap the approved source locally; reject any sealed recesses or fused pipework.
4. Retexture the exact approved UV model with PBR, original UVs preserved and no HD texture -
   10 credits.
5. Condition to the 1K/1K/512 profile, integrate, and validate beside the Refinery and Radar.

Maximum planned Meshy spend: 30 credits. The user granted standing approval for this complete staged
asset pass before the first paid call; failed geometry still stops all downstream spend.

## Delivery

- Multi-image geometry task: `01a02be4-b796-7507-bbaf-d6da6c18a5e7` (20 credits).
- PBR retexture task: `01a02bee-5f05-74f6-9a18-9131bb0463e8` (10 credits).
- The 1.97M-triangle recovery source was reduced and unwrapped locally; no paid remesh was used.
- Shipping body: 13,264 triangles, one primitive/material, 1.58 MiB.
- Shipping maps: 1K base colour, 1K normal and 512 packed metal-roughness.
- Runtime replacement is complete and keeps the procedural model only as a load-failure fallback.
- Total Meshy spend: 30 credits. Balance after delivery: 840.
