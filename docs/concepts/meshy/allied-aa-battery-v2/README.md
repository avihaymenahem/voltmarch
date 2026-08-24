# Allied AA Battery V2

Articulated twin-barrel Allied anti-air defence. The approved silhouette has a wide anchored base, a sealed turret ring, exactly two elevated barrels, a compact radar blade, a central optic, and side ammo housings.

## Contracts

- Preserve exactly two barrels and the clean separation at the turret ring.
- Runtime hierarchy must be restored deterministically as `Body` and `Turret`; the turret pivots without gaps at 0, 45, 90, and 180 degrees.
- Front is the twin-gun face; origin is centered at ground level; runtime forward is `+Z`.
- Warm off-white ceramic is dominant. Cobalt follows large armor panels, graphite follows rings/recesses/housings, cyan is limited to optics, and exposed gun hardware uses satin metal.
- Avoid random faction-color spots, flat single-color treatment, baked lighting, glossy toy-plastic paint, and added weapons.
- Combined defence budget: 8,000–14,000 triangles, one shared PBR material, 1K base/normal and 512 packed metal-rough for shipping.

`geometry-sheet.png` is the cardinal geometry contract. `base-color.png` is the approved material reference. The procedural version remains a load-failure fallback only after integration.
