# Soviet Naval Pen v1

Content key: `soviet_subpen`  
Display name: Naval Pen  
Faction: Soviet Union  
Class: 3x3 waterline warship factory  
Frozen gameplay dimensions: 12 x 12 x 6 m (`BUILDING_DIMENSIONS.subPen`)  
Ship exit / facade: +Z

## Art brief

The Naval Pen is a low armored submarine bunker built around a visibly open flooded berth. It must
read as a shoreline warship factory from the RTS camera without a crane, lattice gantry or generic
industrial shed silhouette.

Non-negotiable geometry:

1. A broad central berth mouth on +Z, at least 4.8 m wide and 3.2 m high, remaining visibly open and
   unobstructed through the front half of the structure. The berth floor is a recessed dark channel;
   no generated water, boat, blast door, gate or prop may occupy it.
2. Two massive asymmetric armored vault shoulders flank the berth. Their inward-curving upper shells
   form a shallow protected arch over only the rear half, leaving the front mouth and exit clear.
3. Low side quays with modeled bollard housings, ribbed service strips and recessed maintenance bays
   establish the waterline footprint. All details must be thick enough for RTS readability.
4. The left rear shoulder carries a short armored exhaust stack. The right rear shoulder carries a
   compact solid signal mast and box antenna. Neither may become a lattice, truss or thin cable array.
5. The silhouette stays broad and low: no element above 6 m and no long overhang outside the 3x3 pad.

Soviet materials follow the approved family: olive armored vaults, coherent crimson mouth/shoulder
plates, charcoal berth and recesses, gunmetal quay hardware, restrained brass couplers and amber lamps.

Reject boats, submarines, water surfaces, enclosed/blocked berth mouths, doors across the exit, cranes,
lattice/truss gantries, long catwalks, thin railings, loose props, text, stars, logos, floating pieces,
melted geometry, camouflage, excessive damage and baked lighting.

## Runtime contracts

- Preserve the 3x3 footprint, +Z ship exit, 6 m silhouette and central ship-clearance channel.
- Preserve `PartId.DockEntry`, `PartId.Door`, base sockets and `PartId.Crane` as nonvisual gameplay/VFX sockets.
- The imported static body replaces all procedural visual masses.
- Preserve construction rise, instancing, shadow path and WebGL/WebGPU parity.

## Production route and budgets

1. Four-view multi-image geometry (`latest`, untextured, no auto-remesh) - 20 credits.
2. Cardinal/clearance audit, local reduction and xatlas unwrap - no paid remesh.
3. Retexture exact approved UV mesh (`latest`, PBR, original UV, no HD, remove lighting) - 10 credits.

Maximum spend: 30 credits.

- 18,000-28,000 LOD0 triangles; one static mesh/material.
- 2048 base, 2048 tangent-space normal, 1024 packed metal-roughness.
- 6 MiB maximum shipping GLB.

## Delivered asset

- Geometry task: `01a02d45-cd06-709e-b584-afced660a521` (20 credits).
- PBR retexture task: `01a02d49-c6ac-7e21-a779-b050fe6de07b` (10 credits).
- The coherent 1,970,982-triangle source was locally reduced to 24,542 triangles, then xatlas
  unwrapped at 2048 resolution and 8 px padding with zero bounds drift.
- Shipping body: `src/assets/buildings/soviets/naval-pen.glb`; 14,606 triangles, one static
  primitive/material, 3.91 MiB.
- Material maps: 2K base colour, 2K normal and 1K packed metal-roughness. The deterministic Soviet
  field pass restores olive paint to neutral shell plates while preserving the authored continuous
  crimson berth surround and shoulder panels.
- The berth mouth remains open from both directions after reduction. The imported model is the full
  visual structure; legacy procedural masses remain only as a load-failure fallback while dock, door,
  base and service sockets remain nonvisual.
- Meshy credits: 30 total. Balance after delivery: 600.
