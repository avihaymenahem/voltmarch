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

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CREDITS } from '../src/shell/MainMenu';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');

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

const allText = CREDITS.flatMap((g) => [g.title, ...g.lines]).join('\n');

describe('the credits describe the product that actually ships', () => {
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

  it('names the shipped typeface and the brand lockup', () => {
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

    if (brand.length > 0) {
      // `logo-full.png` IS the main-menu title and the loading curtain, and the
      // `mark-*` files are every favicon. Calling the wordmark "generated" was
      // false for as long as these have shipped.
      expect(
        allText,
        `public/brand ships ${brand.length} image(s) — the wordmark and app icons — `
        + 'so the credits must say so',
      ).toMatch(/wordmark|logo|brand/i);
    }
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

  it('ships no downloaded MODEL or WORLD TEXTURE asset, as the credits say', () => {
    // The qualified claim, actually enforced. `fonts/`, `brand/` and `audio/`
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
    const DECLARED = /^(brand|fonts|audio)\//;
    const offenders = publicAssets().filter((f) => BANNED.test(f) && !DECLARED.test(f));
    expect(
      offenders,
      'an undeclared binary asset appeared in public/ — declare it in the credits, '
      + 'README.md and CLAUDE.md, then allow it here',
    ).toEqual([]);
  });
});
