# VOLTMARCH social cards

This library contains one portrait collectible card for every authored faction entity in the
production roster. Neutral capturable buildings, civilian buildings and vehicles, scenery,
foliage, pickups, and environment props are intentionally excluded.

## Folder contract

Cards are grouped as:

`<faction>/<type>/<asset-key>.png`

Factions:

- `allies`
- `soviets`
- `meridian-pact`
- `reclamation`

Types:

- `buildings` — economy, production, technology, support, and superweapon structures
- `defences` — walls, gates, turrets, fixed weapons, and defensive emitters
- `infantry` — soldiers, specialists, commanders, and military creatures
- `vehicles` — ground and hover vehicles
- `aircraft` — fixed-wing aircraft, bombers, and gunships
- `ships` — surface vessels, submarines, transports, and landing craft

## Card art direction

The cards combine old-school creature-battler collectibility with VOLTMARCH's own command-shell
visual language. Every card must retain the official VOLTMARCH logo, readable entity name,
faction and type, gameplay-facing stats, two concise role/ability callouts, rarity, collector ID,
and a short in-world line. The official logo source is
`packages/assets/brand/logo-full.png`; do not redraw or replace it with generated lettering.

The approved master is `allies/aircraft/allied-albatross.png`. It is the layout and finish
reference for the full set, not a source for copying the Albatross silhouette into other cards.

`manifest.json` is the roster and generation ledger. Its expected count is 139 cards: 36 Allies,
38 Soviets, 33 Meridian Pact, and 32 Reclamation. Every faction includes its dedicated strategic
bomber and four-bay bomber base.
