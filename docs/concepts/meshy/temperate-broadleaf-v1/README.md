# Temperate broadleaf V1 concept source

Status: Meshy geometry captured; local LOD2 rejected · content key: `tree` · created 2026-08-29

## Role and fit contract

- Neutral crushable canopy prop; never a navigation blocker.
- 10–12 m tall, 7–9 m crown diameter, Y-up, ground-centred origin.
- Temperate/urban pilot for `FoliageEngine`; the current procedural `tree` remains the runtime fallback.
- The accepted source must produce LOD0/1/2, shadow and emergency deliveries from one geometry authority.

## Art gate

The sheet passes the concept gate because the trunk fork is visible below the crown, open negative
space survives front/back, the crown is asymmetric, and the lower canopy reveals enough trunk to
read at normal RTS distance. Bark and canopy are separate broad material/value regions. Cardinal
geometry still has to prove that these views reconstruct as one closed tree rather than as fused or
floating foliage masses.

Reject a generated source with a hollow trunk, fused ground slab, unsupported foliage, a spherical
crown, paper-thin card walls, or cardinal silhouettes that no longer describe the same tree.

## Source files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `orthographic-sheet.png` | 1,597,018 | `d960015f119b3a325d300c5f7739c1ffcaac144ae4643e3ba2c29079f566c2ba` |
| `views/front.png` | 463,748 | `3089847e2aac6c212a25ba21f5fd0f843abcbf1cea908485f1a578fa3793ba4c` |
| `views/right.png` | 385,512 | `9dc7e51bbfe8a9ca42a68f0c773a9c380e191b01a6091cbd46319d6ba025ea8f` |
| `views/back.png` | 435,299 | `98af9bb7bfd6196ca859edbe3adf8fb40c4706b2f38c4285dda55f02211987de` |
| `views/left.png` | 396,487 | `723ebcd4290d1a3de4f7cc9f08e4032fa9c9c8a13b9983d2ab1bde16b6aed013` |

The four views were split from the single horizontal source with an 8 px inset gutter. The right
view's remaining neighbor-panel sliver was removed by a deterministic 16 px edge crop and warm-white
pad; tree pixels begin beyond that repair. No view was independently regenerated.

## Generation record

Tool: built-in ImageGen (`stylized-concept`), one image generation, no Meshy credits.

Final prompt:

> Use case: stylized-concept  
> Asset type: VOLTMARCH 3D reconstruction blueprint for a game foliage asset  
> Primary request: a single clean four-view orthographic turnaround sheet of the SAME exact
> temperate broadleaf tree, arranged as four equal panels in this order: front, right, back, left.
> Every view must depict one physically consistent tree at identical scale, identical ground
> baseline, identical camera height, and true orthographic projection with no perspective
> distortion.  
> Scene/backdrop: plain warm-white studio background in every panel, no horizon, no landscape  
> Subject: one 10–12 metre temperate broadleaf tree with a 7–9 metre crown. A readable trunk forks
> below the crown with visible open negative space between two primary boughs. Broad asymmetric
> crown with one dominant lateral mass and an uneven lower canopy line that exposes portions of the
> trunk. Root flare is compact and clean at the ground plane.  
> Style/medium: polished stylized-realism game-asset geometry blueprint, simple low-frequency forms
> suitable for 3D reconstruction, restrained matte clay-like rendering  
> Composition/framing: complete tree visible with generous padding in all four panels; exact
> matching height and baseline; cardinal views only; no three-quarter views  
> Lighting/mood: broad neutral studio light, restrained ambient occlusion, minimal soft contact
> shadow directly under the trunk  
> Color palette: dark warm-brown bark, muted olive-green canopy divided into three or four broad
> coherent value masses  
> Materials/textures: large readable bark and canopy regions only; canopy constructed as coherent
> foliage masses, not thousands of visible individual leaves  
> Constraints: the same exact tree and component placement in every view; closed solid forms; clean
> silhouette; no text, no labels, no numbers, no watermark  
> Avoid: perspective, camera-angle changes, mismatched trees, spherical crown, ball-on-a-stick
> silhouette, floating canopy pieces, fused ground roots, hollow trunk, paper-thin leaf cards, loose
> leaves, background vegetation, grass, rocks, props, people, tiny leaf noise, photoreal microtexture

## Paid-task checkpoint

The worktree-local `.env` passed the bundled environment check and the live balance was 314 credits.
After explicit approval, one geometry-only multi-image task was created from the four ordered views:

- task: `01a04ec2-a4bb-77e8-b54f-400b74c82c33`;
- cost: 20 credits;
- settings: latest model, texture disabled, PBR disabled;
- result: one 33.97 MiB GLB with 1,979,710 triangles and no materials or images;
- stopping point: raw download, metadata record and local cardinal/LOD audit.

After a second explicit approval capped at 15 credits, the source completed the paid production
route:

- remesh `01a04ee5-dad8-7580-bf04-c71684f6957e` — 5 credits, 3,363 triangles, one connected
  primitive, 11 m high and grounded at Y=0;
- PBR retexture `01a04ee7-71ee-7606-b7c6-8d0f2572306d` — 10 credits, topology preserved, baked
  lighting removed, dark warm bark and muted olive foliage;
- realistic PBR retexture `01a04f0c-bb38-7124-bc66-71452613b30b` — 10 credits, topology and UVs
  preserved, stronger bark/foliage separation and no baked lighting;
- ImageGen base-colour refinement — the generated atlas stayed registered to Meshy's UV layout,
  then only its high-frequency bark and leaf detail was transferred onto the original atlas to
  protect seams and island placement;
- local final — 1.30 MiB single-sided GLB with 1K base, 1K micro-normal and 512 packed
  metallic/roughness maps. The normal map's channel deviation rose from about 2.3 to 8.6, making
  the material respond to grazing light instead of reading as flat paint.

The tracked family adds an 802-triangle LOD1, 384-triangle vertex-colour crossed silhouette for
LOD2/emergency and the accepted 802-triangle silhouette as caster. Lower direct simplifications were
rejected after cardinal review because they collapsed into slabs. The complete family is integrated
behind `?foliage=imported`; exact hashes, sizes and rejection history live in
`packages/assets/game/environment/foliage/temperate-broadleaf-v1.provenance.json`.
