# VOLTMARCH brand assets

Source: `logo.png`, supplied by the user. Already transparent (RGBA, alpha 0 background);
the grey you see in some image viewers is the viewer's own backdrop, not the file.
Original 1536x1024, trimming to 1513x700 of actual artwork.

| File | Size | Use |
|---|---|---|
| `logo-full.png` | 1400x648 | Main menu title, loading curtain |
| `logo-720.png` | 720x333 | Pause menu, victory/defeat header |
| `logo-360.png` | 360x167 | Small placements, README, docs |
| `mark-512.png` | 512x512 | App icon, PWA, social card |
| `mark-180.png` | 180x180 | Apple touch icon |
| `mark-64.png` | 64x64 | Favicon (hi-dpi) |
| `mark-32.png` | 32x32 | Favicon |

`mark-*` is the crystalline bolt alone, not the full lockup — the wordmark is
unreadable below roughly 200px, so anything icon-sized has to be one bold shape.

## Palette

The logo's cyan is a near-match for the HUD accent already in use
(`--accent: #35C8F0`), so the title screen, sidebar and in-world selection rings
read as one system. Keep them in sync: if the accent changes, re-check it against
the bolt.

Regenerate the derivatives with `tools/brand.mjs` if the source logo is replaced.
