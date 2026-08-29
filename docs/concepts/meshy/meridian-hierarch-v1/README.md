# Meridian Hierarch v1

Status: Accepted, conditioned, PBR-textured, rigged and integrated.

- Content key: `meridian_hierarch`
- Gameplay unit: `mrdHierarch`
- Character: Hierarch Calvane
- Runtime height: 2.2 m
- Forward axis: `+Z`
- Hero budget: at most 50,000 triangles at gameplay LOD0; one instance per player
- Rig contract: compatible with the Meridian humanoid proportions and locomotion clips
- Weapon contract: separate runtime focus lance; no weapon fused into the body

## Locked cues

- Tall enclosed conical helmet with finial and a ceremonial hexagonal torso.
- Long hexagonal back vestment, oversized left mantle and compact collector-cell assembly.
- Warm bone ceramic, deep jade glass, brushed-gold trim and restrained oxblood cloth.
- Engineering liturgy without religious symbols or a generic fantasy-wizard silhouette.

`orthographic-sheet.png` is the original OpenAI ImageGen concept. `views/` contains deterministic front/right/back/left crops used for reconstruction.

## Paid ceiling

- Meshy-6 multi-image geometry-only gate: 20 credits.
- Reference-led PBR retexture after geometry acceptance: 10 credits.
- Auto-rig after topology acceptance: 5 credits.
- Maximum: 35 credits.

## Accepted delivery

- Geometry: `01a04f42-be77-74ad-9f39-aa31d41bc357`.
- Reference-led PBR: `01a04f47-2f7d-7386-8266-09372c438c47`.
- Humanoid rig: `01a04f4a-6ae5-7281-8724-1bdb0b8a79b4`.
- Spend: 35 credits.
- Gameplay LOD0: 47,225 triangles, 6.26 MiB, one 24-joint skin and one material with 1024 base/normal plus 512 metallic-roughness maps.
- Animation deliveries: mesh-free 72-channel walk and run clips. Gameplay bakes the walk pose at load and discards the live rig.
