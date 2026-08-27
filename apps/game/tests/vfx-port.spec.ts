/**
 * ============================================================================
 * tests/vfx-port.spec.ts
 * ============================================================================
 * `World.vfx` was a declared port that nothing ever assigned.
 *
 * `world.ts` declares `vfx: IVfx = new NullVfx()` — a null object whose every
 * method is an empty body — under a comment reading "ports: default null
 * objects, replaced by owning modules at init". No module replaced it. Twenty
 * call sites across five sim modules were silent no-ops for the whole life of
 * the project:
 *
 *   Abilities.ts     four shakes and a scorch
 *   Crates.ts        shake on pickup
 *   Damage.ts        three scorches, a rubble decal, three shakes
 *   Production.ts    BuildComplete, SellPuff
 *   RepairSell.ts    shake when a structure is sold
 *   Superweapons.ts  the nuke's crater, its scorch, and its shake
 *
 * WHY IT SURVIVED. Explosions DID shake the camera, because `Explosions.ts`
 * reaches `cameraRig.addShake` through `setShakeSink` instead. So the one case
 * anyone would notice by playing worked, and the nuke — the single effect in
 * the game most deserving of a camera shake — did nothing at all.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE TWO `DecalKind` ENUMS DO NOT AGREE, and they collide in the worst
 *     possible way: core's `Scorch = 0` is the decal field's `Tread = 0`. A
 *     pass-through cast would have laid a tyre mark where a tank exploded. This
 *     is the case that matters most in the whole file, because the failure is
 *     invisible — it looks like "the decals are a bit odd", not like a bug.
 *   - THE PORT IS ACTUALLY ASSIGNED. A test that only checked `IVfx` was
 *     implementable would have passed for the entire time this was broken.
 *   - THE NULL OBJECT STILL WORKS. Headless sim tests construct a `World` with
 *     no render module, and every one of those twenty call sites has to keep
 *     being safe there.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { DecalKind, FxKind } from '../src/core/types';
import { DecalKind as WorldDecalKind } from '../src/world/Decals';

const ROOT = join(__dirname, '..', '..', '..');
const VFX_SYSTEM = readFileSync(join(ROOT, 'apps/game/src/vfx/vfx.system.ts'), 'utf8');

/* ========================================================================== */

describe('the port is assigned by somebody', () => {
  it('is assigned in the vfx system\'s init', () => {
    // The whole report. `world.vfx` had no assignment anywhere in `src/`.
    expect(VFX_SYSTEM).toMatch(/world\.vfx = \{/);
  });

  it('implements every method the interface declares', () => {
    for (const m of ['play:', 'attach:', 'detach:', 'decal:', 'shake:', 'particleCount:']) {
      expect(VFX_SYSTEM, `IVfx.${m} must be provided`).toContain(m);
    }
  });

  it('routes shake to the camera rig, which is where trauma lives', () => {
    expect(VFX_SYSTEM).toMatch(/shake: \(amount\) => \{ cameraRig\.addShake\(amount\); \}/);
  });

  it('routes play() onto the same fx channel the weapons use', () => {
    // One code path for a sim-issued effect and a weapon-issued one, so the two
    // cannot drift into behaving differently.
    expect(VFX_SYSTEM).toMatch(/play: \([^)]*\) => \{[\s\S]{0,400}?channels\.fx\.push\(/);
  });
});

/* ========================================================================== */

describe('the two DecalKind enums do not agree', () => {
  it('numbers them differently, which is the trap', () => {
    // If this ever starts passing by coincidence the map below stops being
    // load-bearing and someone will delete it. Assert the collision itself.
    expect(DecalKind.Scorch as number).toBe(0);
    expect(WorldDecalKind.Tread as number).toBe(0);
    expect(WorldDecalKind.Scorch as number).toBe(2);
    expect(DecalKind.Crater as number).toBe(1);
    expect(WorldDecalKind.Tyre as number).toBe(1);
    expect(WorldDecalKind.Crater as number).toBe(3);
  });

  it('translates rather than casting', () => {
    // A cast would compile, run, and quietly lay the wrong decal forever.
    expect(VFX_SYSTEM).toMatch(/const DECAL_PORT_MAP/);
    expect(VFX_SYSTEM).toMatch(/DECAL_PORT_MAP\[kind as number\]/);
  });

  it('maps the three one-to-one kinds the sim actually emits', () => {
    // grep of `src/sim/**`: Scorch (Abilities, Damage x3, Superweapons),
    // Crater (Superweapons, CommanderPowers), Squish (Crush). Rubble is the
    // explicit one-to-many composition asserted below.
    for (const k of [
      'DecalKind.Scorch]', 'DecalKind.Crater]', 'DecalKind.Squish]',
    ]) {
      expect(VFX_SYSTEM, `${k} must be mapped`).toContain(k);
    }
  });

  it('expands rubble into its persistent ground composition', () => {
    expect(VFX_SYSTEM).toContain('layRubbleStory');
    expect(VFX_SYSTEM).toMatch(/kind === DecalKind\.Rubble/);
  });

  it('lands Squish on the field tile that was authored for it', () => {
    /*
     * THE KIND THAT WAS DROPPED AFTER THE VERB SHIPPED. Infantry crushing landed
     * with `unitsCrushed`, `FxKind.CrushSquish` and a real `SFX.crush` sample —
     * and no mark, because the field enum stopped at `Patch = 9` and an
     * unmapped kind is silently a no-op by design. The field owns tile 10 now.
     *
     * Asserting the NUMBER as well as the mapping, because "the value IS the
     * atlas tile index" in `world/Decals.ts` — a renumber here is a wrong tile,
     * not a compile error.
     */
    expect(WorldDecalKind.Squish as number).toBe(10);
    expect(DecalKind.Squish as number).toBe(4);
    expect(VFX_SYSTEM).toMatch(/\[DecalKind\.Squish\]:\s*WorldDecalKind\.Squish/);
  });

  it('drops the kinds the field does not own, rather than guessing', () => {
    // TreadMark is laid by `layTread` from Movement; FootPrint and OreStain were
    // never drawn. Mapping them to something plausible would invent art nobody
    // asked for — which is a different thing from Squish, where the verb exists,
    // fires, and had nothing to show for itself.
    expect(VFX_SYSTEM).not.toContain('DecalKind.TreadMark]');
    expect(VFX_SYSTEM).not.toContain('DecalKind.FootPrint]');
    expect(VFX_SYSTEM).not.toContain('DecalKind.OreStain]');
    // And an unmapped kind must be a no-op, not an undefined index into layDecal.
    expect(VFX_SYSTEM).toMatch(/if \(mapped !== undefined\)/);
  });
});

/* ========================================================================== */

describe('the null object still holds up a headless world', () => {
  it('swallows every call without a render module', () => {
    // Every sim test in the suite constructs a bare `World`. All twenty call
    // sites have to stay safe there, which is what the null object is for —
    // the defect was never that it existed, only that nothing replaced it.
    const w = new World();
    expect(() => {
      w.vfx.play(FxKind.ExplosionLarge, 1, 2, 3, 0, 1, 0, 1);
      w.vfx.decal(DecalKind.Crater, 1, 2, 0, 4);
      w.vfx.shake(0.5);
      w.vfx.detach(w.vfx.attach(FxKind.ExplosionSmall, 0 as never));
    }).not.toThrow();
    expect(w.vfx.particleCount()).toBe(0);
  });
});

/* ========================================================================== */

describe('the call sites this unblocks', () => {
  it('are still there and still going through the port', () => {
    // If someone "fixes" a dead call by deleting it, the port goes quiet again
    // and nothing notices. Pin the ones that were reported.
    const files: ReadonlyArray<readonly [string, RegExp]> = [
      ['apps/game/src/sim/Crush.ts', /vfx\.decal\(\s*\n?\s*DecalKind\.Squish/],
      ['apps/game/src/sim/Superweapons.ts', /vfx\.decal\(DecalKind\.Crater/],
      ['apps/game/src/sim/Superweapons.ts', /vfx\.shake\(SUPERWEAPON_FX\.nukeShake\)/],
      ['apps/game/src/sim/Damage.ts', /vfx\.decal\(DecalKind\.Rubble/],
      ['apps/game/src/sim/Crates.ts', /vfx\.shake\(/],
      ['apps/game/src/sim/RepairSell.ts', /vfx\.shake\(/],
      ['apps/game/src/sim/Production.ts', /vfx\.play\(FxKind\.SellPuff/],
      ['apps/game/src/sim/Abilities.ts', /vfx\.shake\(/],
    ];
    for (const [rel, re] of files) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(re.test(src), `${rel} must still call ${re}`).toBe(true);
    }
  });
});
