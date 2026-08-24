# Soviet Command Bunker v1

Content key: `soviet_commandpost`  
Display name: Command Bunker  
Faction: Soviet Union  
Class: 2x2 command / commander-power building  
Frozen gameplay dimensions: 8 x 8 x 10.5 m (`BUILDING_DIMENSIONS.commandPost`)  
Facade: +Z

## Art brief

The Command Bunker is a low, deeply armoured operations slab carrying one off-centre hardened signal
pylon. The body must read heavier than the Radar Tower while its asymmetrical mast makes the purpose
clear at RTS distance.

Non-negotiable silhouette cues:

1. A low square bunker with a deeply recessed front command door, massive corner buttresses and a
   visible horizontal observation embrasure above the door.
2. One compact polygonal map-room drum sunk into the roof, never a dome or dish.
3. One off-centre rear-left armoured communications pylon reaching the 10.5 m roofline, terminating in
   a thick cross-dipole and amber beacon. The pylon is solid/boxed, not a high-triangle lattice.
4. One roof transformer pod and two thick busbars visibly feeding the pylon.

Soviet faction cues follow the approved family: field-olive armour, coherent crimson vertical
buttress/door bands, charcoal doors and vents, gunmetal communications hardware, restrained brass
contacts and tiny amber practical lamps.

Reject radar dishes, cranes, lattice trusses, thin antenna forests, loose props, text, stars, logos,
floating pieces, melted panels, rounded blob forms, camouflage, heavy grime and baked lighting.

## Runtime contracts

- Preserve the 2x2 footprint, +Z facade, 10.5 m authored height and existing selection/collision.
- Preserve base sockets and `PartId.Antenna` at the pylon head as nonvisual gameplay/VFX sockets.
- The imported static body replaces all legacy procedural visual masses.
- Preserve construction rise, instancing, shadow pass and WebGL/WebGPU parity.

## Production route and budgets

1. Four-view multi-image geometry (`latest`, untextured, no auto-remesh) - 20 credits.
2. Cardinal audit, local reduction and xatlas unwrap - no paid remesh.
3. Retexture exact approved UV mesh (`latest`, PBR, original UV, no HD, remove lighting) - 10 credits.

Maximum spend: 30 credits.

- 18,000-28,000 LOD0 triangles; one static mesh/material.
- 2048 base, 2048 tangent-space normal, 1024 packed metal-roughness.
- 6 MiB maximum shipping GLB.

## Geometry delivery

- Meshy multi-image task: `01a02d2e-4403-7ce3-a76e-57764b54f19a`.
- Consumed credits: 20; account balance after geometry delivery: 670.
- Dense source: 1,986,702 triangles, 993,319 vertices, one coherent shell and 34.10 MiB.
- Approved local body: 24,828 triangles and 12,387 vertices after the `building` profile at ratio
  `0.0125`, error `0.002` and static merge.
- Local xatlas unwrap: 21,109 seam-split vertices, 2048 resolution, 8 px padding and zero bounds drift.
- Geometry gate: passed all cardinal views. Door, embrasure, buttresses, map room, roof busbars and
  solid stepped communications pylon remain structurally connected and crisp.

## Material delivery and runtime integration

- Meshy retexture task: `01a02d31-afcf-7d61-8efb-a2fe6f6b4885`.
- Consumed credits: 10; account balance after the complete Command Bunker: 660.
- Shipping body: 14,883 triangles, 14,597 vertices, one static mesh/material and 3.07 MiB.
- Shipping maps: 2048 base colour, 2048 tangent-space normal and 1024 packed metal-roughness.
- Runtime asset: `src/assets/buildings/soviets/command-bunker.glb`.
- All procedural visual masses are replaced. Base and antenna sockets remain nonvisual and the normal
  instancing, construction rise and backend-neutral shadow path remain intact.
