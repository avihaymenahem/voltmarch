# VOLTMARCH launch site

Standalone Cloudflare Pages site for `voltmarch.com`. It does not import the game bundle and can be deployed independently.

## Build

```bash
npm run build
```

Cloudflare Pages settings:

- Root directory: `launch-site`
- Build command: `npm run build`
- Build output: `dist`
- Pages Function binding: D1 database `voltmarch-launch-waitlist` as `WAITLIST`
- Production custom domain: `voltmarch.com`

Apply `migrations/0001_subscribers.sql` to the bound D1 database before opening signups.

## Key art

`public/assets/hero-1920.webp`, `hero-1100.webp`, and `og-voltmarch.webp` are delivery derivatives of an original poster generated for VOLTMARCH with OpenAI's built-in image-generation tool on 24 August 2026. The final prompt intentionally reserves the left side for live HTML copy and forbids baked text, logos, watermarks, UI, screenshots, and recognizable third-party designs.
