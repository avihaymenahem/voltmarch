# Reclamation Carrion Roost v1

Status: ImageGen reference accepted for Meshy reconstruction · updated 2026-08-31

## Contract

- Content key: `rclCarrionRoost`; model key: `reclaim_airbase`.
- Role: one-per-player Reclamation strategic bomber producer and four-bay home.
- Footprint: 8 × 8 cells (32 × 32 m). Forward/facade: +Z. Runtime root: `Body`.
- Simulation owns bay sockets, approach lanes, capacity, collision and selection.

## Non-negotiable silhouette

1. Exactly four repaired launch decks in a clear 2 × 2 arrangement with open outward lanes.
2. One intentionally offset heavy salvage crane and one compact service furnace.
3. Composed asymmetric centre machinery without covering or shrinking any landing deck.

## Reclamation material language

- Oxide graphite frame, mismatched dark/warm deck plates, violet arc panels and hazard amber rails.
- Broad dry plate regions and contextual work wear; no uniform rust wash.
- Top-down deck variation must survive normal RTS distance.

## Budgets and gates

- Landmark LOD0 ceiling: 50k triangles, one material, 9 MiB compressed GLB.
- 2K base colour, 1K normal and packed MR; LOD1/LOD2 plus shadow proxy mandatory.
- Reject an incorrect deck count, obstructed lanes, centred clean symmetry or a junk-pile silhouette.

The authoritative input is `carrion-roost-meshy-reference.png`, generated with ImageGen.
