# Soviet Repair Depot v1

Content key: `soviet_depot`  
Display name: Repair Depot  
Faction: Soviet Union  
Class: 2x2 vehicle service structure  
Frozen gameplay dimensions: 8 x 8 x 6.5 m (`BUILDING_DIMENSIONS.repairDepot`)  
Vehicle entry / facade: +Z

## Art brief

The Repair Depot is an open vehicle service deck, not a shed. A parked tank must remain visible from
the RTS camera. Its silhouette comes from two heavy side service pylons, a low rear workshop and one
compact telescoping repair arm rather than a crane or lattice derrick.

Non-negotiable geometry:

1. A broad open central deck at least 4.2 m wide and 5.5 m deep with a flat unobstructed vehicle lane
   entering from +Z. Nothing may roof over or block the front/middle of the lane.
2. One low rear workshop wall, maximum about 2.6 m high, with a dark tool recess and three large
   service cabinets.
3. Two thick asymmetric side pylons outside the vehicle lane. The left pylon carries one short,
   chunky two-segment telescoping repair arm reaching only toward the deck centre, ending in a broad
   welding/service head. No lattice, truss, hook, chain or long crane jib.
4. Exposed deck rails, recessed grating and two broad wheel-guide strips supply the service read.

Soviet materials follow the approved family: olive armour, coherent crimson pylon/arm plates,
charcoal deck and recesses, gunmetal rails/arm joints, restrained brass couplers and amber work lamps.

Reject sheds, enclosed garages, roof canopies, cranes, lattice/truss frames, thin cables, loose props,
text, stars, logos, floating parts, melted geometry, camouflage and baked lighting.

## Runtime contracts

- Preserve the 2x2 footprint, +Z vehicle entry, 6.5 m maximum silhouette and service clearance.
- Preserve base sockets and `PartId.Crane` as the nonvisual repair VFX/service-head socket.
- The imported static body replaces all procedural visual masses.
- Preserve construction rise, instancing, shadow path and WebGL/WebGPU parity.

## Production route and budgets

1. Four-view multi-image geometry (`latest`, untextured, no auto-remesh) - 20 credits.
2. Cardinal and clearance audit, local reduction, xatlas unwrap - no paid remesh.
3. Retexture exact approved UV mesh (`latest`, PBR, original UV, no HD, remove lighting) - 10 credits.

Maximum spend: 30 credits.

- 18,000-28,000 LOD0 triangles; one static mesh/material.
- 2048 base, 2048 tangent-space normal, 1024 packed metal-roughness.
- 6 MiB maximum shipping GLB.

## Delivered asset

- Geometry task: `01a02d39-8889-7f3d-aa97-2301ee14a7a2` (20 credits).
- PBR retexture task: `01a02d3d-764e-7fdb-a7c0-7128338855aa` (10 credits).
- The coherent 1,958,094-triangle source was locally reduced to 24,458 triangles, then xatlas
  unwrapped at 2048 resolution and 8 px padding with zero bounds drift.
- Shipping body: `apps/game/src/assets/buildings/soviets/repair-depot.glb`; 15,524 triangles, one static
  primitive/material, 4.00 MiB.
- Material maps: 2K base colour, 2K normal and 1K packed metal-roughness. The final deterministic
  Soviet field pass restores olive paint to Meshy's neutral plates while preserving authored crimson
  service panels and the dark deck.
- The imported model is the full visual structure. The old procedural body and crane are retained
  only as a load-failure fallback; `PartId.Crane` remains a nonvisual repair/VFX socket.
- Meshy credits: 30 total. Balance after delivery: 630.
