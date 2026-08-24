# Soviet Flame Tower v1

Content key: `soviet_flametower` / `flameTower`  
Faction: Soviet Union  
Class: static 1x1 incendiary defence  
Frozen gameplay dimensions: 4 x 4 x 5.5 m  
Facade: +Z

## Art and gameplay contract

The replacement is a complete static visual body. It keeps the procedural model only as a load-failure
fallback and preserves the three nonvisual sockets: `MuzzleA`, `MuzzleB`, and `Emitter`. The content does
not set `hasTurret`; therefore no visible component may imply a directional slewing gun.

Non-negotiable silhouette cues:

1. A low octagonal armoured plinth with four broad corner feet.
2. One central pressure vessel and two clearly separate low side fuel pods.
3. A flared burner crown with four short radial nozzle arms and genuinely open bores.

Soviet faction cues:

1. Planar field-olive riveted armour and charcoal burner hardware dominate.
2. Contiguous crimson vertical foot/pod straps occupy 2.5-4% of the visible surface.
3. Exposed gunmetal fuel pipes, muted brass valve blocks and a restrained orange pilot glow supply the
   secondary read without noisy micro-detail.

Reject a cannon barrel, rotating turret, fused side pods, sealed nozzle bores, boiler/silo proportions,
soft blob geometry, thin wires, lattice, railings, loose props, baked lighting, random red speckles,
rust blankets and photoreal surface noise.

## Production budget and approved route

- Geometry: multi-image generation from `front.png`, `right.png`, `back.png`, and `left.png`.
- LOD0 ceiling: 14,000 triangles; one static primitive/material.
- Textures: 1K base colour, 1K normal, 512 packed metal-roughness.
- Shipping GLB ceiling: 3 MiB.
- Shadow proxy: below 1,000 triangles.
- Meshy cap: 20 credits geometry plus 10 credits retexture; no paid remesh.

`geometry-sheet.png` is the locked geometry source. All four views show the same object at identical
scale, baseline, camera height and mechanism state. Geometry is reviewed in neutral clay before any
texture spend.
