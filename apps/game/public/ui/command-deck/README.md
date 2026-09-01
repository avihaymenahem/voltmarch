# Command Deck HUD chrome

These PNGs are original ImageGen-authored interface plates created for
VOLTMARCH on 2026-09-01 from the approved Command Deck reference. They ship as
true RGBA assets; generated checker previews were removed with deterministic
alpha extraction and each output was validated to contain
both transparent and opaque pixels.

The plates own structural material only: dark gunmetal armor, bevels, fasteners,
recess shadows, cyan steel reflections and restrained violet identity lighting.
They never own labels, numbers, icons, minimap pixels, build cards, scroll thumbs,
hover, selection, disabled, active-command or active-tab state.

| File | Fixed responsibility |
| --- | --- |
| `top-wing-left.png` | Elastic left resource-bar wing |
| `top-wing-right.png` | Elastic right resource-bar wing |
| `operation.png` | Neutral center operation bay; live DOM supplies five pips |
| `objectives.png` | Objectives enclosure and empty content well |
| `minimap.png` | Minimap hardware with transparent live-canvas aperture |
| `selection.png` | Selection inspector enclosure and empty content well |
| `radar-dock-v2.png` | Fixed left half of the joined radar/data assembly; three empty functional switch wells |
| `selection-wide-v2.png` | Wide right half of the joined assembly; uninterrupted live data well and health trough |
| `commands.png` | Five identical neutral command bays |
| `build.png` | Fixed header zones and one uninterrupted scrollable content well |

Generation mode: built-in ImageGen, reference-conditioned standalone raster
components. The shared prompt contract requested a frontal orthographic,
production-ready HUD sprite on transparent RGBA, with no scene, text, symbols,
fake checker transparency or baked dynamic state. Component prompts then fixed
the silhouette and explicitly prohibited state inappropriate to each surface;
the build prompt additionally required one continuous well for more than eight
live items, and the command prompt required five identical neutral bays.

The v2 radar/data pair was generated as one matched two-component assembly,
then separated by connected alpha silhouettes. Imagen returned an opaque
checker preview twice, so a deterministic neutral-luminance key removed only
the checker pixels. The right plate was shortened by cutting and rejoining its
straight centre rails; no corners, controls, bevels or side artwork were scaled.
