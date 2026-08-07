# VOLTMARCH brand assets

Source: `logo.png`, supplied by the user. Already transparent (RGBA, alpha 0 background);
the grey you see in some image viewers is the viewer's own backdrop, not the file.
Original 1536x1024, trimming to 1513x700 of actual artwork.

**The source image is not in this directory.** It is `tools/brand-source/logo-source.png`,
beside the script that reads it. It lived here until 2026-08-07, which meant Vite copied
2.4 MB of an input nobody loads into every deploy — it was the single largest file on the
published site after the JS bundle, and no markup or code referenced it.

Everything below is generated. Nothing should be added to this directory by hand.

| File | Size | Use |
|---|---|---|
| `logo-full.png` | 1400x648 | Main menu title, loading curtain |
| `logo-720.png` | 720x333 | Pause menu, victory/defeat header |
| `logo-360.png` | 360x167 | Small placements, README, docs |
| `mark-512.png` | 512x512 | `<link rel="icon" sizes="512x512">` — Android add-to-home-screen |
| `mark-180.png` | 180x180 | Apple touch icon |
| `mark-64.png` | 64x64 | Favicon (hi-dpi) |
| `mark-32.png` | 32x32 | Favicon |

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

Regenerate the derivatives with `tools/brand.mjs` if the source logo is replaced.
