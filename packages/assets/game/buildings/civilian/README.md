# Civilian imported buildings

The four LOD0 files in this directory are the approved, texture-normalized sources for capturable
civilian landmarks. Runtime loads their KTX2 copies from `compressed/`; `derived/` contains reviewed
geometry-only colour LODs and shadow casters. Procedural structures remain loading/failure fallbacks
and gameplay/socket authorities only.

| Runtime key | Source | LOD0 triangles | Colour LOD | Shadow triangles |
| --- | --- | ---: | ---: | ---: |
| `civ_derrick` | `oil-derrick.glb` | 19,673 | none approved | 2,880 |
| `civ_hospital` | `hospital.glb` | 39,291 | none approved | 2,112 |
| `civ_apartments` | `apartment-block.glb` | 33,363 | LOD1 14,981 | 2,112 |
| `civ_mine` | `ore-mine.glb` | 22,073 | LOD1 16,438 | 1,812 |

The compressed family reduces the four GLBs from 18.93 MiB to 14.44 MiB and conservative texture
residency from 192 MiB RGBA8 to 32 MiB at an 8-bpp target. Blocked colour LOD candidates are absent
from runtime references. Meshy task IDs, rejection notes and per-asset provenance are recorded in
`docs/ASSET_CONVERSION_MAP.md`.

Regenerate the reports and approved derivatives from the repository root:

```bash
node tools/compress-asset-textures.mjs --manifest tools/asset-families/civilian-buildings.json --write
node tools/optimize-asset-family.mjs --manifest tools/asset-families/civilian-buildings.json --write
```
