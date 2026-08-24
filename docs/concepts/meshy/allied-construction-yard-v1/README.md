# Allied Construction Yard v1

Asset key: `allied_conyard`  
Frozen gameplay envelope: 3 x 3 cells, approximately 12 x 12 x 11 m (`BUILDING_DIMENSIONS.conYard`)  
Functional front: +Z, centered deploy bay  
Source: four-view orthographic geometry blueprint generated with the built-in image workflow

## Design contract

- Allied hero anchor built from two interlocking asymmetric ceramic vaults around a deep deployment bay.
- Curves and capsules dominate the silhouette; the recessed structural core keeps the shell from reading as a white blob.
- Compact folded construction manipulator at the rear-left replaces the procedural lattice crane.
- The manipulator must remain a secondary silhouette feature and must not read as a weapon.
- No rust, rivets, lattice trusses, antenna forest, thin cables, floating parts, or generic sci-fi box construction.

## Geometry gate

- LOD0 target: 32,000 triangles; hard range 25,000–40,000.
- Watertight hard-surface shell with clean bevels and stable normals.
- Large panel breaks must be geometry; no noisy micro-greebles.
- The front bay must remain broad and visibly functional from the RTS camera.
- Preserve the 3 x 3 placement envelope and 11 m maximum silhouette.
- Preserve gameplay sockets: exit, door, construction/VFX manipulator, stack/VFX, and flag pole.
- LOD1, LOD2, and a simplified shadow caster are mandatory before rollout.

## Material gate

- Geometry approval comes before any paid texture task.
- Allied two-material hard gate: at least two of white ceramic tile, polished chrome, and blue glass must read clearly.
- Structural recesses use blue-black, not neutral charcoal or Soviet olive.
- Team accent occupies only 2.5–4% of visible building area and appears as upper/front edge slabs or boundary stripes.
- No flat single-color body, roof wash, baked dramatic lighting, grime blanket, rust, or random color speckles.
- Runtime target: one or two materials; 2K base color, 2K normal, 1K packed ORM; KTX2/Basis compression before shipping.

## Integration contract

- Keep the procedural `allied_conyard` as the load-failure fallback.
- The imported body owns the complete visual shell; do not mash it together with the procedural model.
- Preserve construction rise, selection/damage behavior, casting/receiving shadows, and the existing footprint/pad alignment.
- The bay door may remain static in the imported mesh for the first geometry gate, but the `PartId.Door` gameplay socket remains authoritative.
- The rear-left manipulator replaces the old crane visually; `PartId.Crane` remains the construction/VFX socket.

## Source images

- `geometry-sheet.png`: approved four-view turnaround.
- `front.png`, `right.png`, `back.png`, `left.png`: Meshy multi-image inputs in that order.
