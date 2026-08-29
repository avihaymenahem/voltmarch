# Allied Field Marshal v1

Status: Accepted, conditioned, PBR-textured, rigged and integrated.

- Content key: `allied_marshal`
- Gameplay unit: `fieldMarshal`
- Character: Field Marshal Ines Aubray
- Runtime height: 2.2 m
- Forward axis: `+Z`
- Hero budget: at most 50,000 triangles at gameplay LOD0; one instance per player
- Rig contract: compatible with the Allied humanoid proportions and locomotion clips
- Weapon contract: separate runtime bullpup; no weapon fused into the body

## Locked cues

- Precision-aerospace white ceramic armour over a graphite undersuit.
- Tailored split command cape, oversized left pauldron and compact longitudinal crest.
- Cobalt optical panels and narrow cyan channels; quiet macro surfaces remain dominant.
- The silhouette reads as a surveyor-command officer rather than ceremonial royalty.

`orthographic-sheet.png` is the original OpenAI ImageGen concept. `views/` contains deterministic front/right/back/left crops used for reconstruction.

## Paid ceiling

- Meshy-6 multi-image geometry-only gate: 20 credits.
- Reference-led PBR retexture after geometry acceptance: 10 credits.
- Auto-rig after topology acceptance: 5 credits.
- Maximum: 35 credits.

## Accepted delivery

- Geometry: `01a04f42-bd2a-7762-9431-5908a5631d12`.
- Reference-led PBR: `01a04f47-2e16-74e4-ad96-29a47a1f507d`.
- Humanoid rig: `01a04f4a-6935-7095-a4dc-7b5c7add8385`.
- Spend: 35 credits.
- Gameplay LOD0: 47,618 triangles, 6.05 MiB, one 24-joint skin and one material with 1024 base/normal plus 512 metallic-roughness maps.
- Animation deliveries: mesh-free 72-channel walk and run clips. Gameplay bakes the walk pose at load and discards the live rig.
