/**
 * ============================================================================
 * tests/credits-truthful.spec.ts — the credits screen must not overstate
 * ============================================================================
 * The credits are a list of ASSERTIONS ABOUT THE PRODUCT, shown to the player.
 * One of them was false.
 *
 * "No downloaded assets, anywhere in the product" was true when it was written
 * and stopped being true on 2026-08-05, when the UI text face was self-hosted
 * into `public/fonts/` — a deliberate change, made because the stack had named
 * Rajdhani since the day it was written and never shipped it, so every menu and
 * HUD in the game had been rendering in the fourth fallback. Correct decision;
 * nobody updated the boast.
 *
 * `README.md` and `CLAUDE.md` both carry the caveat, and `CLAUDE.md` explicitly
 * says "If you add another downloaded asset, update this line and `README.md` in
 * the same commit". The credits screen was not on that list and so drifted.
 *
 * WHY A TEST AND NOT JUST A FIX. This is the defect class
 * `docs/SPEC_DRIFT_AUDIT.md` exists to catalogue: a claim in the repo that is
 * false and load-bearing. Fixing the sentence fixes today. Checking the sentence
 * against the filesystem fixes the next time — the whole point is that nobody
 * noticed, so a reviewer noticing is not the mechanism to rely on.
 * ============================================================================
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CREDITS } from '../src/shell/MainMenu';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const IMPORTED_WORLD_ASSETS = join(ROOT, 'src', 'assets');

function rootText(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

/** Every file under `public/`, recursively, relative to it. */
function publicAssets(dir = PUBLIC, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...publicAssets(full, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

function importedWorldAssets(dir = IMPORTED_WORLD_ASSETS, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...importedWorldAssets(full, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

const allText = CREDITS.flatMap((g) => [g.title, ...g.lines]).join('\n');

describe('the credits describe the product that actually ships', () => {
  it('ships an explicit project licence and machine-readable package policy', () => {
    expect(existsSync(join(ROOT, 'LICENSE')), 'public source needs an explicit root LICENSE').toBe(true);
    expect(rootText('LICENSE')).toMatch(/Copyright \(c\) 2026 Avihay Menahem/i);
    expect(rootText('LICENSE')).toMatch(/all rights reserved/i);

    for (const file of ['package.json', 'desktop/package.json', 'server/package.json']) {
      const packageJson = JSON.parse(rootText(file)) as { private?: boolean; license?: string };
      expect(packageJson.private, `${file} must remain private`).toBe(true);
      expect(packageJson.license, `${file} must not imply an open-source grant`).toBe('UNLICENSED');
    }

    expect(rootText('README.md')).toMatch(/^## License and third-party notices$/m);
    expect(rootText('README.md')).toContain('[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)');
  });

  it('keeps every mandatory music attribution in source and distribution notices', () => {
    const musicSource = rootText('src/audio/TrackMusic.ts');
    const notices = rootText('THIRD_PARTY_NOTICES.md');

    expect(musicSource, 'the playback owner must not call CC BY music CC0').not.toMatch(/three CC0 tracks/i);
    expect(musicSource).toMatch(/Kevin MacLeod tracks licensed under CC BY 4\.0/i);

    for (const title of ['Colossus', 'Industrial Revolution', 'Clash Defiant']) {
      expect(notices, `third-party notices omit the shipped score cue ${title}`).toContain(title);
      expect(allText, `in-game credits omit the shipped score cue ${title}`).toContain(title);
    }
    expect(notices).toMatch(/creativecommons\.org\/licenses\/by\/4\.0/);
    expect(notices).toMatch(/trimmed to a 72-second Ogg\s+loop/i);
  });

  it('catalogues the font, CC0 banks, voice provenance, and generated assets', () => {
    const notices = rootText('THIRD_PARTY_NOTICES.md');
    expect(notices).toMatch(/Rajdhani/i);
    expect(notices).toMatch(/Indian Type Foundry/i);
    expect(notices).toMatch(/SIL Open Font License 1\.1/i);
    expect(existsSync(join(ROOT, 'licenses', 'Rajdhani-OFL-1.1.txt'))).toBe(true);
    expect(notices).toMatch(/Recorded sound effects and unit voices — CC0 1\.0/i);
    expect(notices).toMatch(/Kenney/i);
    expect(notices).toMatch(/Warfork[\s\S]*Team Forbidden/i);
    expect(notices).toMatch(/LibriVox public-domain material/i);
    expect(notices).toMatch(/OpenAI image generation/i);
    expect(notices).toMatch(/Meshy AI/i);
  });

  it('copies the canonical notices into the web tree that Electron embeds', () => {
    const vite = rootText('vite.config.ts');
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'Rajdhani-OFL-1.1.txt']) {
      expect(vite, `the production bundle does not copy ${file}`).toContain(file);
    }
    expect(vite).toMatch(/plugins:\s*\[releaseNoticesPlugin\(\)\]/);

    const desktop = rootText('desktop/electron-builder.yml');
    expect(desktop, 'Electron must embed the same legal-bearing dist tree as the web release')
      .toMatch(/extraResources:[\s\S]*from:\s*\.\.\/dist[\s\S]*to:\s*dist/);
  });

  it('does not claim there are NO downloaded assets while shipping one', () => {
    const assets = publicAssets();
    const unqualified = /no downloaded assets,? anywhere/i.test(allText);

    // The claim is only false if something is actually shipped. If `public/`
    // is ever emptied, the absolute claim becomes true again and is allowed.
    if (assets.length > 0) {
      expect(
        unqualified,
        `public/ ships ${assets.length} file(s) — ${assets.slice(0, 5).join(', ')} — `
        + 'so the credits must not claim "no downloaded assets, anywhere"',
      ).toBe(false);
    }
  });

  it('names the shipped audio, its author and its licence', () => {
    const audio = publicAssets().filter((f) => f.startsWith('audio/') && /\.(ogg|mp3|wav|m4a)$/i.test(f));
    if (audio.length === 0) return;

    // CC0 asks for nothing. Crediting anyway is the point of a credits screen,
    // and naming the LICENCE is what makes the claim checkable by a player who
    // wants to know what they are running.
    expect(allText, `public/audio ships ${audio.length} file(s) but no author is credited`)
      .toMatch(/kenney/i);
    expect(allText, 'shipped CC0 audio must have its licence named in the credits')
      .toMatch(/CC0/i);

    // The Art group must no longer claim the whole soundscape is synthesised.
    expect(
      /every sound synthesi[sz]ed/i.test(allText),
      'the credits still claim EVERY sound is synthesised while shipping recorded audio',
    ).toBe(false);

    // Nor may it claim the WEAPONS are synthesised — cannon, machine gun,
    // artillery, rockets and all three explosions are recorded. This is the
    // second time a credits line about audio went stale inside one week, and
    // both times the sentence was true when written.
    const weaponSamples = audio.filter((f) => /\/(cannon|mg|artillery|rocket|explosion)\./.test(f));
    if (weaponSamples.length > 0) {
      expect(
        /weapons[^.]*synthesi[sz]ed/i.test(allText),
        `public/audio ships ${weaponSamples.length} recorded weapon take(s), so the credits `
        + 'must not say weapons are synthesised',
      ).toBe(false);
    }
  });

  it('names the shipped interface artwork and typeface', () => {
    const assets = publicAssets();
    const fonts = assets.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
    const brand = assets.filter((f) => f.startsWith('brand/') && /\.(png|jpe?g|webp|svg)$/i.test(f));

    if (fonts.length > 0) {
      // Rajdhani is OFL-1.1. Redistribution is exactly what that licence is
      // for, and naming the face and the licence is the courtesy it asks.
      expect(allText, `public/ ships ${fonts.length} font file(s) but no font is credited`)
        .toMatch(/rajdhani/i);
      expect(allText, 'a shipped OFL font must have its licence named in the credits')
        .toMatch(/open font license|OFL/i);
    }

    const campaignPortraits = assets.filter((f) => /^campaign\/portraits\/.*\.(png|jpe?g|webp)$/i.test(f));
    if (campaignPortraits.length > 0) {
      expect(
        allText,
        `public/campaign ships ${campaignPortraits.length} character portrait(s), so the `
        + 'credits must identify the non-procedural campaign artwork',
      ).toMatch(/campaign portraits|Rakhalt|Vosk|AI-assisted artwork/i);
    }

    if (brand.length > 0) {
      // `logo-full.png` IS the main-menu title, and the `mark-*` files are
      // every favicon. Calling the wordmark "generated" was false for as long
      // as these have shipped.
      expect(
        allText,
        `public/brand ships ${brand.length} image(s) — the wordmark and app icons — `
        + 'so the credits must say so',
      ).toMatch(/wordmark|logo|brand/i);
    }

    // THE KEY ART IS A SECOND SUPPLIED IMAGE AND A SEPARATE CLAIM. It ships in
    // the same directory as the lockup, so the assertion above passes on the
    // lockup's own credit line whether or not the illustration is mentioned —
    // which is precisely how a credit goes stale without anything noticing.
    // Checked on its own filename instead.
    const splash = assets.filter((f) => /^brand\/splash-/.test(f));
    if (splash.length > 0) {
      expect(
        allText,
        `public/brand ships ${splash.length} splash image(s) — a supplied illustration, `
        + 'not generated art — so the credits must name it',
      ).toMatch(/key art|illustration/i);
    }
  });

  it('names imported game-world models instead of claiming every mesh is procedural', () => {
    const models = importedWorldAssets().filter((file) => /\.(glb|gltf|fbx|obj|dae)$/i.test(file));
    if (models.length === 0) return;
    expect(allText, `src/assets ships ${models.length} imported model(s) but the credits omit them`)
      .toMatch(/Meshy|imported .*model|landmark structure/i);
    expect(
      /every mesh generated procedurally|no downloaded models/i.test(allText),
      'the credits claim every mesh is procedural while imported world models ship',
    ).toBe(false);
  });

  it('THE GENERAL GUARD: every absolute "no X anywhere" claim is checked or absent', () => {
    // Absolute claims are the ones that rot: the product changes and the
    // sentence does not. If someone adds a new one they have to come here and
    // say how it is verified — the conversation that did not happen last time.
    const KNOWN_VERIFIED: readonly RegExp[] = [];

    const absolutes = CREDITS.flatMap((g) => g.lines)
      .filter((l) => /no.+(anywhere|at all|whatsoever)/i.test(l))
      .filter((l) => !KNOWN_VERIFIED.some((k) => k.test(l)));

    expect(
      absolutes,
      'a new absolute claim was added to the credits with nothing checking it — '
      + 'either verify it here or soften it',
    ).toEqual([]);
  });

  it('ships no undeclared binary asset from public/', () => {
    // Public asset families are declared. Imported world assets are bundled from
    // `src/assets/` and checked independently above.
    // `fonts/`, `brand/` and `audio/`
    // are the DECLARED exceptions — named in the credits, README.md and
    // CLAUDE.md. Anything appearing elsewhere in public/ is a new undeclared
    // asset and fails here rather than silently making three documents wrong.
    //
    // AUDIO JOINED THIS LIST on 2026-08-09 and the test title changed with it.
    // That rename is the honest half of the change: this test asserted "no
    // downloaded AUDIO asset" and would now be a lie by its own name. Widening
    // `DECLARED` while leaving the title alone would have left the same species
    // of false claim this file exists to catch, one level up.
    const BANNED = /\.(gltf|glb|fbx|obj|dae|png|jpe?g|webp|ktx2?|dds|tga|mp3|ogg|wav|m4a)$/i;
    // CAMPAIGN joined in the gold-master vertical slice. These are interface
    // portraits, named in credits and provenance, never world textures.
    const DECLARED = /^(brand|fonts|audio|campaign)\//;
    const offenders = publicAssets().filter((f) => BANNED.test(f) && !DECLARED.test(f));
    expect(
      offenders,
      'an undeclared binary asset appeared in public/ — declare it in the credits, '
      + 'README.md and CLAUDE.md, then allow it here',
    ).toEqual([]);
  });
});
