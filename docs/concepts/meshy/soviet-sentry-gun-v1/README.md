# Soviet Sentry Gun v1

Content key: `soviet_sentry` / `sentryGun`  
Faction: Soviet Union  
Class: rotating 1x1 anti-infantry defence  
Frozen gameplay dimensions: 4 x 4 x 2.2 m  
Forward: +Z

## Art and gameplay contract

The complete replacement has two visual assemblies: a fixed lower bunker and a generated rotating upper
gun head. The upper assembly follows the existing turret yaw and retains the turret-local `MuzzleA`
socket. The procedural model remains only as a load-failure fallback.

Non-negotiable silhouette cues:

1. A low broad octagonal bunker with four splayed feet and a recessed ammunition/service bay.
2. A compact asymmetric faceted turret separated from the bunker by a visible turntable gap.
3. Twin short parallel heavy-machine-gun barrels with open bores and an offset optical sensor.

Soviet cues are field-olive riveted armour, charcoal turntable/mantlet, restrained crimson vertical foot
and turret-edge plates, gunmetal barrels, muted brass feed hardware and a tiny green sensor lens.

Reject a static one-piece result, sealed turntable gap, fused barrels, long tank cannon, dome/tripod form,
inflated armour, random accent speckles, baked lighting and photoreal grime.

## Production route and budget

- Multi-image geometry, locally reduced and split at the clear turntable boundary.
- Combined LOD0 ceiling: 14,000 triangles; one shared material, two runtime draws because turret motion is
  a gameplay requirement.
- Texture target: shared 1K base, 1K normal and 512 packed metal-roughness.
- Shipping GLB ceiling: 3 MiB; shadow proxy below 1,000 triangles.
- Meshy cap: 20 credits geometry plus 10 credits retexture; no paid remesh.

`geometry-sheet.png` and its four cardinal crops are the locked geometry source. Geometry and moving-part
separation must pass before texturing.

## Delivery

- Geometry task: `01a02c29-443e-7a45-a226-d6373f21096b`
- Retexture task: `01a02c30-6d1a-72bd-8c64-1162ee28ddd8`
- Final split: 5,763 body + 2,564 turret triangles (`8,327` total)
- Shipping GLB: `1.24 MiB`, two meshes, one shared material, 1K/1K/512 maps
- Runtime: generated body and generated turret only; procedural visuals removed
