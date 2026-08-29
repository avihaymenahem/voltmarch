# Soviet Ironclad Field v1

Content key: `soviet_curtain`  
Display name: Ironclad Field  
Faction: Soviet Union  
Class: 3x3 strategic superweapon  
Frozen gameplay dimensions: 12 x 12 x 13 m (`BUILDING_DIMENSIONS.superweapon`)  
Facade: +Z

## Art brief

The Ironclad Field is a paired invulnerability-field projector. Its identity is the large, clean
negative space held between two opposing emitter heads; it must not become a power plant, Tesla Coil
or two unrelated towers.

Non-negotiable geometry:

1. A broad low armored capacitor bunker fills the 3x3 pad, with a recessed central activation dais.
2. Two massive asymmetric side pylons rise from opposite sides and lean inward on short solid
   cantilever shoulders. Each ends in a thick horizontal emitter drum aimed at its opposite number.
3. Preserve a clearly visible open air gap at least 2.6 m wide between emitter faces. No beam, bar,
   cable, geometry or prop may bridge the gap. The gap is the primary landmark.
4. A slim but solid faceted discharge spire rises behind the gap on the rear centerline, reaching the
   13 m silhouette. It must remain visually separate from the emitter gap.
5. Two low armored capacitor banks and chunky bus housings sit on the bunker roof. Macro detail must
   remain thick enough for the RTS camera.

Soviet materials follow the approved family: olive armor, coherent crimson pylon/capacitor plates,
charcoal emitter bores and recesses, gunmetal drums/buswork, restrained brass couplers and cyan-white
field cores/amber status lamps.

Reject connected emitters, blocked/filled gap, Tesla-coil rings, generic smokestacks, lattice/truss
scaffolds, cranes, gantries, thin wires, floating parts, people, vehicles, loose props, text, stars,
logos, melted geometry, heavy damage, camouflage and baked lighting.

## Runtime contracts

- Preserve the 3x3 footprint, +Z facade, 13 m silhouette and central negative-space gap.
- Preserve base, `PartId.Emitter` and `PartId.CoilTip` sockets as nonvisual gameplay/VFX points.
- The imported static body replaces all procedural visual masses.
- Preserve construction rise, instancing, shadow path and WebGL/WebGPU parity.

## Production route and budgets

1. Four-view multi-image geometry (`latest`, untextured, no auto-remesh) - 20 credits.
2. Cardinal/gap audit, local reduction and xatlas unwrap - no paid remesh.
3. Retexture exact approved UV mesh (`latest`, PBR, original UV, no HD, remove lighting) - 10 credits.

Maximum spend: 30 credits.

- 20,000-32,000 LOD0 triangles; one static mesh/material.
- 2048 base, 2048 tangent-space normal, 1024 packed metal-roughness.
- 7 MiB maximum shipping GLB.

## Delivered asset

- Geometry task: `01a02d57-eeaf-70b1-960b-e1b5e4717264` (20 credits).
- PBR retexture task: `01a02d5b-549a-74d2-a6ac-10a2c15685ce` (10 credits).
- The coherent 1,975,884-triangle source was locally reduced to 27,554 triangles, then xatlas
  unwrapped at 2048 resolution and 8 px padding with zero bounds drift.
- Shipping body: `packages/assets/game/buildings/soviets/ironclad-field.glb`; 16,437 triangles, one static
  primitive/material, 4.01 MiB.
- Material maps: 2K base colour, 2K normal and 1K packed metal-roughness. The deterministic Soviet
  field pass restores olive armour while retaining continuous crimson pylon/emitter/capacitor panels
  and the pale field-core faces.
- The opposing emitter faces remain separated by a clean air gap after both reduction passes. The rear
  discharge spire stays visually separate; legacy procedural masses remain only as a load-failure
  fallback while field and coil-tip sockets remain nonvisual.
- Meshy credits: 30 total. Balance after delivery: 540.
