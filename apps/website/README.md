# VOLTMARCH launch site

Standalone Cloudflare Pages site for `voltmarch.com`. It does not import the game bundle and can be deployed independently.

## Build

```bash
npm run build
```

Cloudflare Pages settings:

- Root directory: `apps/website`
- Build command: `npm run build`
- Build output: `dist`
- Pages Function binding: D1 database `voltmarch-launch-waitlist` as `WAITLIST`
- Production custom domain: `voltmarch.com`
- Build variable: `CF_WEB_ANALYTICS_TOKEN` (the public Cloudflare Web Analytics site token)

The Pages Function creates the subscribers table and index defensively on first use. The SQL in
`migrations/0001_subscribers.sql` is the canonical schema for inspection or manual provisioning;
running it before launch is optional and idempotent.

## Domain topology

`voltmarch.com` is marketing only. The playable GitHub Pages build lives at
`play.voltmarch.com`, and the multiplayer relay remains at `relay.voltmarch.com`. Do not point the
apex back at the game or attach `play` to this Pages project.

Every push to `main` that changes `apps/website/` triggers the Cloudflare project. The root game
workflow deploys independently to GitHub Pages from `apps/game/dist/`.

The public community invite is `https://discord.gg/pvJGJyafU3`, and the public source and release
page is `https://github.com/avihaymenahem/voltmarch`; keep the header, hero community CTAs, and
footer links in `public/index.html` aligned if either destination changes.

## Key art

`public/assets/hero-1920.webp`, `hero-1100.webp`, and `og-voltmarch.webp` are delivery derivatives of an original poster generated for VOLTMARCH with OpenAI's built-in image-generation tool on 24 August 2026. The final prompt intentionally reserves the left side for live HTML copy and forbids baked text, logos, watermarks, UI, screenshots, and recognizable third-party designs.

## Field archive

The interactive archive on the home page is generated from `marketing/social-cards/manifest.json`.
During each website build, all card masters are validated and converted to 720-pixel-wide WebP
delivery assets under `dist/cards/`. The originals remain untouched; Cloudflare Pages serves and
caches the optimized derivatives alongside the site. Do not hand-edit `dist/cards/`.
