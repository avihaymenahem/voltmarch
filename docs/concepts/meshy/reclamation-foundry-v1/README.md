# Reclamation Foundry v1 — hero geometry contract

The Foundry establishes the imported Reclamation building language. The sheet is a geometry reference;
material generation must preserve its broad intentional regions instead of adding uniform texture noise.

## Runtime target

- Footprint: heavy 3x3 construction headquarters, about 11 metres wide.
- Silhouette: low asymmetric body, clear front deployment bay, offset fabrication mast.
- Mast: solid box-girder construction with a compact jib; no lattice crane, cables, or fragile trusses.
- Faction cue: one subordinate offset arc coil with two armored rings and a clean lit gap.
- Surface hierarchy: oxide-blackened charcoal steel, warm bare metal, restrained violet slabs, amber
  approach hazards, and thin magenta emissive lines.
- Geometry budget: 22k-35k triangles at LOD0; the mast and jib together stay below 12% of visible
  complexity.
- Integration: preserve the procedural Foundry as the fallback until the imported asset passes silhouette,
  topology, texture, shadow, WebGL, and WebGPU gates.

