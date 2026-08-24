# Soviet Anvil Heavy Tank v2

Content key: `soviet_rhino`  
Geometry task: `01a02ebe-dfe0-7eda-b39f-2f93dbaa75a8` (20 credits)  
Retexture task: `01a02ee9-337d-73f4-a320-c242c8d4a089` (10 credits)

## Approved art contract

- Hard-surface heavy-tank silhouette with a single gun and a mechanically separate turret.
- Broad material hierarchy remains readable at RTS distance: dark charcoal-olive turret, medium/lighter olive hull regions, near-black running gear and bounded crimson skirt boxes.
- Surface detail comes from authored seams, welds, fasteners, localized grime, restrained wear and PBR response; it must never collapse to one flat olive material plus procedural scratches.

`soviet-anvil-v2-turnaround.png` is the geometry blueprint. `soviet-anvil-v2-material-reference.png` is the approved retexture target. Texture spend was gated on the latter after rejecting an earlier material reference that remained too uniform.

## Shipping conditioning

- Meshy's retexture flattened the named nodes, so the approved seam was restored deterministically as `Hull` and `Turret`.
- The articulation cut uses an exact cap and tight collar. A broad deck-plate repair was rejected after rotation exposed it as a flat wing.
- Closure UVs use a reserved dark-olive atlas-corner swatch; white unused padding cannot appear as the turret rotates.
- A conservative local simplification reduced the final source to 23,790 triangles without changing the texture hierarchy.
- Source PBR: 2048 base colour, 2048 normal, 1024 metallic/roughness.
- KTX2 output: 5.13 MiB; conservative decoded texture memory falls from about 48 MiB RGBA8 to 8 MiB at the 8-bpp target.
- Runtime uses the offline seal and measured source pivot `[0.1416566, 0.09, 0.0002384]`; the legacy runtime cap is disabled.
- The old derived LOD was removed. Current UV/normal seams block a truthful simplified LOD, so a texture-reprojected LOD is deferred rather than shipping a stale silhouette.

The procedural Anvil remains the automatic load-failure fallback. The generated project and raw task outputs remain under `meshy_output/20260823_161054_soviet-anvil-heavy-tank-v2-geo_01a02ebe/`.
