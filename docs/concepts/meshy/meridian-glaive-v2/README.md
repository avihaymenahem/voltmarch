# Meridian Glaive Post v2 — geometry contract

This replaces the rejected v1 reference. The four-view sheet locks a single fixed cannon inside a deep
front recess; any generation that creates a second barrel, turret ring, floating fin, or fused muzzle is
rejected before retopology or texture spend.

## Runtime target

- Footprint: compact 1x1 defensive casemate.
- Silhouette: low octagonal ivory shell, dark teal recesses, restrained gold trim.
- Weapon: exactly one centered fixed cannon; no rotating turret.
- Secondary cue: one small rear-right solar fin, thick enough to survive retopology.
- Geometry budget: 8k-14k triangles at LOD0, with clean hard planar normals.
- Integration: preserve the procedural Glaive as the fallback until the imported asset passes WebGL and
  WebGPU validation.

