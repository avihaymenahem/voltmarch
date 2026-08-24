# Allied imported buildings

The twelve LOD0 files in this directory are the approved, texture-normalized
sources for the Allied production-building and landmark waves. Runtime loads their KTX2 copies
from `compressed/`; `derived/` contains geometry-only colour LODs and shadow
casters. The procedural structures remain fallback/socket authorities only.

| Runtime key | Source | LOD0 tris | Colour LODs | Shadow tris |
| --- | --- | ---: | --- | ---: |
| `allied_conyard` | `construction-yard.glb` | 39,166 | LOD1 17,624 | 2,268 |
| `allied_power` | `power-plant.glb` | 31,099 | LOD1 13,993 | 1,968 |
| `allied_barracks` | `barracks.glb` | 26,130 | LOD1 11,758; LOD2 4,712 | 1,716 |
| `allied_refinery` | `ore-refinery.glb` | 37,165 | LOD1 19,928 | 1,476 |
| `allied_warfactory` | `war-factory.glb` | 39,115 | LOD1 17,600 | 2,376 |
| `allied_radar` | `radar-dome.glb` | 27,572 | none (candidate blocked) | 2,352 |
| `allied_tech` | `tech-centre.glb` | 26,554 | LOD1 11,949 | 1,632 |
| `allied_commandpost` | `command-post.glb` | 24,543 | none (candidate blocked) | 2,472 |
| `allied_depot` | `repair-depot.glb` | 26,643 | LOD1 11,988 | 1,992 |
| `allied_navalyard` | `naval-yard.glb` | 39,462 | LOD1 18,888 | 2,148 |
| `allied_chrono` | `displacement-ring.glb` | 39,469 | LOD1 17,760 | 1,848 |
| `allied_weather` | `weather-device.glb` | 39,602 | LOD1 19,119 | 2,568 |

The compressed family reduces the twelve GLBs from 64.68 MiB to 50.00 MiB and
conservative texture residency from 576 MiB RGBA8 to 96 MiB at an 8-bpp target.
Blocked LOD2 candidates are intentionally absent; the simplifier could not
reach their geometry ceiling without violating the reusable pipeline gate.

Rebuild the derivatives with:

```powershell
node tools/compress-asset-textures.mjs --manifest tools/asset-families/allied-buildings.json --write
node tools/optimize-asset-family.mjs --manifest tools/asset-families/allied-buildings.json --write
```
