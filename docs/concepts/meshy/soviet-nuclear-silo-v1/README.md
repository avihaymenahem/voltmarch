# Soviet Nuclear Missile Silo v1

Content key: `soviet_nuke`  
Display name: Nuclear Missile Silo  
Faction: Soviet Union  
Class: 3x3 strategic superweapon  
Frozen gameplay dimensions: 12 x 12 x 13 m (`BUILDING_DIMENSIONS.superweapon`)  
Facade: +Z

## Art brief

The Nuclear Missile Silo is a hardened launch complex built around a deep recessed tube. It is a hero
landmark, but its silhouette comes from the launch well, open blast-door slabs and visible warhead—not
from scaffolding or a generic factory tower.

Non-negotiable geometry:

1. A broad, low, faceted armored fortress slab fills the 3x3 pad. Its central/off-centre launch well is
   a clearly modeled circular recess with a thick segmented collar and a dark inner tube.
2. One solid missile nose projects 2.5-3.5 m above the collar. It has a clean conical/ogive warhead,
   two armored body bands and no fins above the launch well.
3. Two massive rectangular blast-door slabs are parked fully open on opposite sides of the well,
   lying on shallow armored guide beds. They never cover or intersect the tube or missile.
4. Three low battered service bastions define the outer slab; one rear bastion supports a short solid
   armored exhaust, another a compact boxy launch-control cupola. Keep all macro forms crisp and thick.
5. Maximum silhouette is 13 m. No long pieces overhang the square footprint.

Soviet materials follow the approved family: olive armor, coherent crimson launch-collar/door plates,
charcoal well and guide beds, gunmetal missile bands/hardware, restrained brass couplers and amber lamps.

Reject closed blast doors, hidden/missing missile, rockets standing on a generic platform, cranes,
lattice/truss scaffolds, gantries, thin catwalks, wires, fins outside the well, smoke/flame, scenery,
people, loose props, text, stars, logos, floating pieces, melted geometry, heavy damage and baked lighting.

## Runtime contracts

- Preserve the 3x3 footprint, +Z facade and 13 m maximum silhouette.
- Preserve base, `PartId.Emitter` and `PartId.Antenna` sockets as nonvisual gameplay/VFX points.
- The imported static body replaces all procedural visual masses. Open doors are authored into the body.
- Preserve construction rise, instancing, shadow path and WebGL/WebGPU parity.

## Production route and budgets

1. Four-view multi-image geometry (`latest`, untextured, no auto-remesh) - 20 credits.
2. Cardinal/clearance audit, local reduction and xatlas unwrap - no paid remesh.
3. Retexture exact approved UV mesh (`latest`, PBR, original UV, no HD, remove lighting) - 10 credits.

Maximum spend: 30 credits.

- 20,000-32,000 LOD0 triangles; one static mesh/material.
- 2048 base, 2048 tangent-space normal, 1024 packed metal-roughness.
- 7 MiB maximum shipping GLB.

## Delivered asset

- Geometry task: `01a02d4f-e9af-7367-bd4c-fe3fbdb3aed5` (20 credits).
- PBR retexture task: `01a02d53-4dad-7fd6-8710-933f822ce8f1` (10 credits).
- The coherent 1,903,696-triangle source was locally reduced to 26,642 triangles, then xatlas
  unwrapped at 2048 resolution and 8 px padding with zero bounds drift.
- Shipping body: `apps/game/src/assets/buildings/soviets/nuclear-silo.glb`; 15,923 triangles, one static
  primitive/material, 3.94 MiB.
- Material maps: 2K base colour, 2K normal and 1K packed metal-roughness. The deterministic Soviet
  field pass restores olive shell paint while retaining the authored continuous crimson launch-ring,
  door-bed and portal plates.
- The imported model is the full visual landmark. The recessed well, missile and parked-open door
  slabs are authored into its static body; legacy procedural masses remain only as a load-failure
  fallback while launch and antenna sockets remain nonvisual.
- Meshy credits: 30 total. Balance after delivery: 570.
