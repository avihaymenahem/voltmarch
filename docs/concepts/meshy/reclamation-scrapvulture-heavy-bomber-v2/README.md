# Reclamation Scrapvulture Heavy Bomber v2

Status: integrated from a clean ImageGen multi-view reconstruction · updated 2026-08-31

## Contract

- Content key: `rclScrapvulture`; model key: `reclaim_scrapvulture`.
- Role: Reclamation four-slot strategic bomber; one slag-cask payload, automatic return and a
  300-tick rearm.
- Runtime envelope: `12.8 × 3.8 × 13.2 m`; source fuselage axis `X`; runtime root `Hull`.
- Silhouette: one clean centre spine, one oversized left nacelle, one smaller right booster,
  broad patched wings, one vertical tail and one armored belly payload cradle.

The rejected v1 model and its perspective concept were not inputs to this rebuild. V1 let the
generator interpret dense trusses and overlapping appendages as parts of the aircraft, producing
the fused/self-intersecting topology visible in the live game.

## Authoritative references

- `scrapvulture-orthographic-reference.png`: accepted four-view neutral-clay ImageGen sheet.
- `scrapvulture-top.png`, `scrapvulture-front.png`, `scrapvulture-right.png` and
  `scrapvulture-left.png`: exact Meshy multi-image inputs.
- `scrapvulture-material-reference.png`: accepted high-angle ImageGen material reference with
  mid-value gunmetal, restrained violet panels, brass repairs and readable weathering.

## Paid task ledger

| Stage | Task | Credits | Result |
| --- | --- | ---: | --- |
| Meshy 6 multi-image geometry | `01a0560c-3b32-71b8-8ff3-8a143124b2b6` | 20 | 321,070-triangle preserved raw source; cardinal and top-down geometry gate passed |
| Triangle remesh | `01a05612-d958-7398-85d5-e9be1a8cbb95` | 5 | 18,108-triangle, one-mesh/one-primitive runtime topology |
| Image-reference PBR | `01a05615-9fac-7173-a694-5db372c63093` | 10 | 2K base/normal plus packed metallic-roughness maps |

Total Meshy spend: 35 credits. No paid retries were made after the accepted geometry.

## Shipping result

- Source GLB: 18,108 triangles, one material, 3.77 MiB after profile conditioning.
- Runtime KTX2 GLB: 2.79 MiB; conservative decoded texture budget reduced from 48 MiB RGBA8
  source maps to the family's 8 MiB 8-bpp target.
- LOD1: 8,147 triangles (45.0%).
- LOD2: 6,336 triangles (35.0%). A more aggressive 4,968-triangle candidate was rejected because
  it visibly kinked the tail plane; the accepted far LOD keeps the top-down flight silhouette.
- Shadow proxy: 1,248 triangles (6.9%).
- Live WebGPU fixture: `?shot=reclamation-carrion-roost&tier=ultra&seed=1337`; four docked bombers
  import through the LOD/shadow path with no procedural fallback.
