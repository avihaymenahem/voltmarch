# Soviet Proving Ground v1

Content key: `soviet_tech`  
Display name: Proving Ground  
Faction: Soviet Union  
Class: 2x2 advanced technology building  
Frozen gameplay dimensions: 8 x 8 x 8 m (`BUILDING_DIMENSIONS.battleLab`)  
Facade: +Z

## Art brief

The Proving Ground is a compact armoured research bunker built around one unmistakable high-voltage
test chamber. It must read as advanced Soviet science at normal RTS distance without becoming a
second Tesla Coil, Power Plant or Radar Tower.

Non-negotiable silhouette cues:

1. A broad, nearly square bunker with deeply chamfered corner buttresses and a recessed front blast
   door / test-chamber portal.
2. One stout central experiment chamber in a heavy polygonal collar, flanked by two large horizontal
   transformer drums.
3. A short, broad accelerator crown made from nested metal rings and a solid terminal. It must remain
   much wider and shorter than the Tesla Coil.
4. Two compact rear exhaust stacks and thick, visibly connected roof conduits.

Soviet faction cues:

1. Field-olive armour is the dominant shell material.
2. Contiguous crimson vertical buttress plates, front portal bands and selected transformer collars
   occupy 3-5% of the visible building, never a red hull tint or random red speckles.
3. Charcoal doors and vents, gunmetal mechanisms, restrained brass electrical contacts and tiny amber
   practical lamps provide separation without muddy grunge.

Reject cranes, lattice towers, dishes, antenna forests, thin wires, loose props, text, stars, logos,
floating pieces, rounded blob forms, camouflage, baked lighting and photoreal-grey materials.

## Gameplay and runtime contracts

- Preserve the 2x2 footprint, +Z facade, 8 m authored height and existing selection/collision contract.
- Preserve the procedural structure's nonvisual base sockets and `PartId.CoilTip` VFX socket.
- The approved imported body replaces all legacy procedural visual masses; there is no moving part.
- Keep the procedural structure as the load-failure fallback.
- Preserve construction rise, instancing, shadow pass and WebGL/WebGPU parity.

## Production route

`geometry-sheet.png` is a four-view neutral-clay sheet. `front.png`, `right.png`, `back.png` and
`left.png` are its exact quadrants and are the only images supplied to the geometry task.

1. Multi-image geometry (`latest`, texture off, automatic remesh off) - 20 credits.
2. Audit all cardinal views, facade, bounds, watertight ground contact and component integrity.
3. Reduce and unwrap locally; no paid remesh.
4. Retexture the exact approved UV model (`latest`, original UV, PBR, no HD, remove lighting) -
   10 credits.
5. Condition to a single static mesh/material and integrate only after both renderer gates pass.

Maximum planned Meshy spend: 30 credits.

## Shipping budgets

- 20,000-30,000 LOD0 triangles, one static mesh, one PBR material.
- 2048 base colour, 2048 tangent-space normal, 1024 packed metal-roughness.
- 6 MiB maximum shipping GLB.
- Strong silhouette and material grouping must remain readable at 35-70 screen pixels.

## Geometry delivery

- Meshy multi-image task: `01a02d1a-320b-7a38-b5fd-5d05a9481db4`.
- Consumed credits: 20; account balance after geometry delivery: 700.
- Dense source: 1,977,626 triangles, 988,537 vertices, one coherent watertight shell and 33.95 MiB.
- Approved local body: 24,716 triangles and 12,130 vertices after the `building` profile at ratio
  `0.0125`, error `0.002` and static merge.
- Local xatlas unwrap: 25,637 seam-split vertices, 2048 resolution, 8 px padding and zero bounds drift.
- Geometry gate: passed front/right/back/left review. The portal, chamfered buttresses, transformer
  drums, roof conduits, rear stacks and accelerator crown remain clean and structurally connected.

## Material delivery and runtime integration

- Meshy retexture task: `01a02d1f-ef7b-7797-93e1-fd03013db416`.
- Consumed credits: 10; account balance after the complete Proving Ground: 690.
- Shipping body: 14,790 triangles, 17,690 vertices, one static mesh/material and 3.28 MiB.
- Shipping maps: 2048 base colour, 2048 tangent-space normal and 1024 packed metal-roughness.
- Runtime asset: `src/assets/buildings/soviets/proving-ground.glb`.
- The imported body replaces every procedural visual mass. Existing base and coil-tip sockets,
  construction rise, instancing and shadow behaviour remain under the normal structure path.
