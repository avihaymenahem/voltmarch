# Reclamation Scrapjaw v1

Content key: `reclaim_scrapper`
Display name: Scrapjaw
Faction: Reclamation
Class: heavy wheeled resource crusher
Frozen gameplay dimensions: 8.6 x 4.0 x 3.35 m
Forward / jaw direction: +Z

## Art brief

Non-negotiable silhouette cues:

1. Four large outboard wheel stations per side expose suspension and frame negative space.
2. A purposeful asymmetric hopper is the dominant mass, not a random heap of scrap.
3. A full-width two-plate crusher jaw, one deep open throat, one tooth row and twin lift rams form the front read.

Reclamation cues are an open load-bearing frame, mismatched armour with structural purpose, one offset
protected crusher drum and a rear side-discharge chute. Random greeble carpets, cables and ornamental junk
are rejected.

## Gameplay contracts

- Preserve the Reclamation harvester/crusher flags, wheeled locomotion, crush level, current fit, cargo and +Z heading.
- Preserve unload, damage, wreck and team-colour hooks.
- Keep jaw plates and lift rams mechanically separable and opaque through their full useful motion.
- Keep the procedural `reclaim_scrapper` model as the automatic loading-failure fallback.

## Geometry references

`orthographic-sheet.png` is the source sheet. The four crops remove sheet labels and are the actual
multi-image inputs. Reject fused wheels, a sealed crusher throat, inconsistent asymmetry, duplicated parts,
open frame backsides or a melted scrap-blob silhouette.

## Staged Meshy plan

Geometry-only multi-image generation is 20 credits. A conditional final-topology remesh is 5 credits and
retexture is 10 credits. Both downstream tasks remain blocked until the previous geometry gate passes.
Maximum planned spend: 35 credits.

Shipping LOD0 targets 40k-50k triangles by explicit art-direction approval, with mandatory LOD1/LOD2,
shadow proxy, KTX2 and dense economy-fixture validation.

## Delivered result

- Meshy geometry task: `01a03df5-7ced-706b-be38-754366092900` (20 credits).
- Exact-topology retexture task: `01a03dfa-9619-7d5c-a79d-5c90d059e101` (10 credits).
- Paid remesh skipped; the conservative first local reduction was rejected at 72,758 triangles and the corrected pass preserved the open frame at 44,402.
- Shipping geometry: 44,402 / 19,913 / 12,267 triangles for LOD0/LOD1/LOD2, plus a 1,104-triangle shadow proxy.
- Texture delivery: required KTX2; 4,874,188-byte source reduced to 3,949,648 bytes and estimated 48 MiB RGBA residency reduced to 8 MiB at 8 bpp.
- Runtime: `src/assets/units/reclamation/compressed/scrapjaw.glb`, loaded by the private Reclamation registry with automatic procedural fallback.
- Validation: asset and render gates plus WebGL/WebGPU faction-scene captures passed on 2026-08-26.

Final Meshy spend: 30 credits.
