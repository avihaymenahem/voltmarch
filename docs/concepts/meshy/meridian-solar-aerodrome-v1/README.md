# Meridian Solar Aerodrome v1

Status: ImageGen reference accepted for Meshy reconstruction · updated 2026-08-31

## Contract

- Content key: `mrdSolarAerodrome`; model key: `meridian_aerodrome`.
- Role: one-per-player Meridian strategic bomber producer and four-bay home.
- Footprint: 8 × 8 cells (32 × 32 m). Forward/facade: +Z. Runtime root: `Body`.
- Simulation owns bay sockets, approach lanes, capacity, collision and selection.

## Non-negotiable silhouette

1. Exactly four open crescent levitation cradles in a legible 2 × 2 radial plan.
2. One compact central heliostat/astrolabe control spire.
3. Clear outward approach lanes and deliberate negative space between every bay.

## Meridian material language

- Warm bone ceramic and pale stone, dark jade/cobalt glass and brushed-gold collectors.
- Restrained turquoise accents and thin cyan solar paths; no gold monochrome roof.
- Broad top surfaces carry readable value separation under the RTS camera.

## Budgets and gates

- Landmark LOD0 ceiling: 50k triangles, one material, 9 MiB compressed GLB.
- 2K base colour, 1K normal and packed MR; LOD1/LOD2 plus shadow proxy mandatory.
- Reject an incorrect bay count, filled lanes, conventional runway slabs or a cropped footprint.

The authoritative input is `solar-aerodrome-meshy-reference.png`, generated with ImageGen.
