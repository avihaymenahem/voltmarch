# VOLTMARCH brand assets

**TWO supplied sources, two scripts, one output directory.**

1. `logo.png` — the lockup. Already transparent (RGBA, alpha 0 background); the grey you
   see in some image viewers is the viewer's own backdrop, not the file. Original
   1536x1024, trimming to 1513x700 of actual artwork. Derived by `tools/brand.mjs`.
2. `load.png` — the key art, supplied 2026-08-18. 1672x941, 2.83 MB. Derived by
   `tools/splash.mjs`. It is the loading curtain's backdrop and it carries its own
   VOLTMARCH lockup, which is why the curtain hides its DOM wordmark on any viewport
   wide enough to keep the painted one — see the derivation in `index.html` and
   `tests/boot-splash.spec.ts`.

**Neither source image is in this directory.** They are `tools/brand-source/logo-source.png`
and `tools/brand-source/splash-source.png`, beside the scripts that read them. The first
lived here until 2026-08-07, which meant Vite copied 2.4 MB of an input nobody loads into
every deploy — it was the single largest file on the published site after the JS bundle,
and no markup or code referenced it. The second was never allowed to repeat that.

Everything below is generated. Nothing should be added to this directory by hand.

| File | Size | Use |
|---|---|---|
| `logo-full.png` | 1400x648 | Main menu title |
| `logo-720.png` | 720x333 | Loading curtain (narrow viewports), pause menu, victory/defeat header |
| `logo-360.png` | 360x167 | Small placements, README, docs |
| `splash-1600.webp` | 1600x900 | Loading curtain backdrop |
| `splash-640.webp` | 640x360 | The same, `srcset` entry for small viewports |
| `mark-512.png` | 512x512 | `<link rel="icon" sizes="512x512">` — Android add-to-home-screen |
| `mark-180.png` | 180x180 | Apple touch icon |
| `mark-64.png` | 64x64 | Favicon (hi-dpi) |
| `mark-32.png` | 32x32 | Favicon |

`logo-full.png` was credited here as "Main menu title, loading curtain" and the curtain has
never used it — the markup has always pointed at `logo-720.png`. Corrected rather than left,
because a table that says where a file is used is only worth having if it is right.

**WebP for the splash, PNG for everything else**, and that is not an inconsistency. The rest
of this directory is flat colour, hard edges and alpha, which is what PNG is for. The key art
is a photographic illustration, where PNG is simply the wrong codec: the source is 2.83 MB and
the shipped WebP is 265 kB with nothing visible lost. It is also the one asset here that
blocks a first paint, so its weight is the only weight in this directory that a player waits
on. `tests/boot-splash.spec.ts` holds a ceiling over it.

This table used to credit `mark-512.png` to "App icon, PWA, social card". There is no web
manifest and no `og:image` in `index.html`, so two thirds of that was aspiration and the
file shipped unreferenced. It is linked as an icon now, which is the part that was real.

`mark-*` is the crystalline bolt alone, not the full lockup — the wordmark is
unreadable below roughly 200px, so anything icon-sized has to be one bold shape.

## Palette

The logo's cyan is a near-match for the HUD accent already in use
(`--accent: #35C8F0`), so the title screen, sidebar and in-world selection rings
read as one system. Keep them in sync: if the accent changes, re-check it against
the bolt.

Regenerate the derivatives with `tools/brand.mjs` if the source logo is replaced, or
`tools/splash.mjs` if the key art is. If the key art changes, **re-measure the lockup box**
— `tests/boot-splash.spec.ts` carries it as four constants and derives the curtain's crop
thresholds from them, so a new illustration with its title somewhere else needs those four
numbers updated or the curtain will hide the DOM wordmark on viewports that no longer show
the painted one.
