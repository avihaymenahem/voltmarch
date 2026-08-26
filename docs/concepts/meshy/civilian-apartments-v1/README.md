# Civilian Apartment Block v1

Neutral capturable four-storey apartment block for the civilian building set.
The model preserves the authoritative 8 x 12 x 15 metre gameplay envelope and
uses no faction colours, insignia, weapons, or military silhouettes.

## Art direction

- Brutalist precast-concrete massing with crisp planar walls and stepped stair cores.
- Recessed entrance, open balcony gaps, deep window bays, and a dark structural plinth.
- Galvanized rails and fire stairs, rooftop water tank, vents, and service housings.
- Warm desaturated beige-grey concrete with restrained dirt, runoff, and edge wear.
- Dark blue-grey glass and charcoal utility surfaces keep the facade readable at RTS distance.

The four-view geometry sheet is split into `front.png`, `right.png`, `back.png`,
and `left.png`. `material-reference.png` is the approved elevated material target.

## Generation record

- Geometry task: `01a03eab-d27f-7ece-baf9-7caa397bc084` (Meshy 6 multi-image, standard, untextured).
- Rejected remesh: `01a03eb0-8ce8-7956-988f-ef0869a4e272`; it rounded the facade and collapsed balcony recesses.
- Approved geometry: conservative local reduction of the raw result to 33,638 triangles.
- Texture task: `01a03eb7-ad43-7b59-bd6f-e708b6e0744e` (Meshy 6 retexture, PBR, generated UVs, lighting removed).
- Textured result: 33,363 triangles before shipping conditioning.

Raw provider outputs and review renders remain under `meshy_output/`; only the
approved conditioned asset is promoted into the runtime tree.
