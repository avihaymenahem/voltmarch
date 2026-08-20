/**
 * Foundation seam tests.
 *
 * These are not gameplay tests. Every case here guards a place where two
 * independently-authored modules have to agree, and where a silent
 * disagreement would show up as a black screen or a wrong-looking frame rather
 * than as a crash.
 *
 * Node environment: nothing here may touch WebGL, `document`, or `window`.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CAMERA, DEFAULT_ART, MAP_SIZE, MOODS, SIM_DT, SIM_HZ } from '../src/core/config';
import { EntityStore, World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { GameLoop, Profiler, SystemRegistry } from '../src/core/loop';
import { Rng, hexToInt, wrapAngle } from '../src/core/math';
import { EntityKind, Faction, RenderPhase } from '../src/core/types';
import type { PlayerId, SystemModule } from '../src/core/types';

import { RENDER_CONFIG } from '../src/render/renderer';
import { artPatch, cameraPatch, resolveArt } from '../src/game/ArtBridge';

/* -------------------------------------------------------------------------- */

describe('core/config invariants', () => {
  it('derives SIM_DT from SIM_HZ', () => {
    expect(SIM_DT).toBeCloseTo(1 / SIM_HZ, 12);
  });

  it('is a 512 m map on 4 m cells', () => {
    expect(MAP_SIZE).toBe(512);
  });

  it('has a complete art bible — every mood patches a real key', () => {
    for (const [name, patch] of Object.entries(MOODS)) {
      for (const key of Object.keys(patch)) {
        expect(DEFAULT_ART, `mood "${name}" patches unknown key "${key}"`).toHaveProperty(key);
      }
    }
  });
});

describe('ArtBridge — core/config.ts -> render/RENDER_CONFIG', () => {
  it('produces a patch whose every path exists in RENDER_CONFIG', () => {
    // A typo'd path would be silently merged in as a new property and would
    // never reach a uniform. This is the failure this whole file exists for.
    const walk = (patch: unknown, target: unknown, path: string): void => {
      if (typeof patch !== 'object' || patch === null) return;
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        expect(target, `RENDER_CONFIG is missing "${p}"`).toHaveProperty(k);
        const cur = (target as Record<string, unknown>)[k];
        if (typeof v === 'object' && v !== null) walk(v, cur, p);
        else expect(typeof v, `type mismatch at "${p}"`).toBe(typeof cur);
      }
    };
    walk(artPatch(DEFAULT_ART), RENDER_CONFIG, '');
    walk(cameraPatch(), RENDER_CONFIG, '');
  });

  it('converts hex strings to packed ints', () => {
    const patch = artPatch(DEFAULT_ART);
    expect(patch.sun?.color).toBe(hexToInt(DEFAULT_ART.sun.color));
    expect(patch.sun?.color).toBe(0xffe7c4);
  });

  it('resolves a mood on top of the shipping look without mutating it', () => {
    const noonElevation = DEFAULT_ART.sun.elevationDeg;
    const dusk = resolveArt('dusk');
    expect(dusk.sun.elevationDeg).toBe(MOODS.dusk!.sun!.elevationDeg);
    // The patched value comes from MOODS, not from a literal copied into the
    // test — a grade retune must not have to edit an assertion to stay green.
    // What is being asserted is that the override HAPPENED and differs from
    // the shipping look, which is the behaviour resolveArt owns.
    expect(dusk.tone.exposure).toBe(MOODS.dusk!.tone!.exposure);
    expect(dusk.tone.exposure).not.toBe(DEFAULT_ART.tone.exposure);
    // Untouched keys still come from the default bible.
    expect(dusk.ao.radius).toBe(DEFAULT_ART.ao.radius);
    // And the bible itself is unharmed — resolveArt deep-clones.
    expect(DEFAULT_ART.sun.elevationDeg).toBe(noonElevation);
  });

  it('falls back to the shipping look for an unknown ?art= value', () => {
    expect(resolveArt('not-a-mood').sun.elevationDeg).toBe(DEFAULT_ART.sun.elevationDeg);
  });

  it('turns exponential fog density into a finite linear end distance', () => {
    const patch = artPatch(DEFAULT_ART);
    expect(patch.fog?.end).toBeGreaterThan(patch.fog!.start!);
    expect(Number.isFinite(patch.fog!.end!)).toBe(true);
  });

  it('carries the camera bounds out to the map edge plus the pan margin', () => {
    const b = cameraPatch().camera?.bounds;
    expect(b?.maxX).toBe(MAP_SIZE + CAMERA.panMargin);
    expect(b?.minZ).toBe(-CAMERA.panMargin);
  });
});

describe('core/world — handles survive slot recycling', () => {
  it('invalidates a stale handle after the slot is reused', () => {
    const store = new EntityStore();
    const spawn = () =>
      store.alloc(EntityKind.Vehicle, 0, 0 as PlayerId, Faction.Allies, 10, 0, 10);
    const a = spawn();
    expect(store.isAlive(a)).toBe(true);
    store.markDead(a);
    store.flushDestroyed();
    expect(store.isAlive(a)).toBe(false);
    const b = spawn();
    // Same index, new generation: the old handle must not resolve.
    expect(store.index(a)).toBe(-1);
    expect(store.index(b)).toBeGreaterThanOrEqual(0);
  });
});

describe('core/math — documented contracts', () => {
  it('wrapAngle produces [-PI, PI), NOT (-PI, PI]', () => {
    // Documented reversal. Consequence: never compare two yaws for equality.
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI, 12);
  });

  it('Rng is deterministic from a seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Rng(1235).next()).not.toBe(seqA[0]);
  });
});

describe('core/loop — headless determinism', () => {
  function harness(seed: number) {
    const world = new World();
    const channels = new Channels();
    const registry = new SystemRegistry(new Profiler());
    const samples: number[] = [];
    const mod: SystemModule = {
      id: 'test.sampler',
      simTick(ctx) {
        samples.push(ctx.rng.next());
      },
    };
    registry.add(mod);
    const loop = new GameLoop(world, channels, registry, {}, seed);
    return { loop, samples, world };
  }

  it('runHeadless produces identical streams for identical seeds', () => {
    const a = harness(7);
    const b = harness(7);
    a.loop.runHeadless(90);
    b.loop.runHeadless(90);
    expect(a.samples).toHaveLength(90);
    expect(a.samples).toEqual(b.samples);
    expect(a.loop.tick).toBe(90);
    expect(a.loop.simTime).toBeCloseTo(90 * SIM_DT, 10);
  });

  it('registers frame systems in RenderPhase order', () => {
    const registry = new SystemRegistry(new Profiler());
    registry.add({ id: 'late', renderPhase: RenderPhase.Present, frame() {} });
    registry.add({ id: 'early', renderPhase: RenderPhase.Terrain, frame() {} });
    expect(registry.frameOrder()).toEqual(['early', 'late']);
  });

  it('seats two players with opposing factions', () => {
    const world = new World();
    const a = world.addPlayer(Faction.Allies, 'A', true, true);
    const b = world.addPlayer(Faction.Soviets, 'B', false, false);
    expect(world.localPlayer).toBe(a);
    expect(world.areAllied(a, b)).toBe(false);
    expect(world.areAllied(a, a)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The determinism grep gate the architecture makes normative.                */
/* -------------------------------------------------------------------------- */

function walkTs(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory does not exist yet
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('determinism gate', () => {
  const BANNED = [/\bMath\s*\.\s*random\s*\(/, /\bDate\s*\.\s*now\s*\(/, /\bperformance\s*\.\s*now\s*\(/];

  it('src/sim/** contains no wall clock and no Math.random', () => {
    const files = walkTs(join(process.cwd(), 'src', 'sim'), []);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const rx of BANNED) if (rx.test(src)) offenders.push(`${f}: ${rx}`);
    }
    expect(offenders).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The markup gate.                                                           */
/*                                                                            */
/* THIS PROPERTY IS ALREADY TRUE AND WAS NEVER ENFORCED. There is not one     */
/* `innerHTML` anywhere in src/**; `Shell.el()` builds nodes with             */
/* `textContent`, and `src/ui/Chrome.ts` states the rule in a comment: "no    */
/* framework, no virtual DOM, no innerHTML with interpolated content".        */
/*                                                                            */
/* A comment is not a mechanism, and the multiplayer work is exactly what     */
/* turns this from tidiness into security: the relay forwards strings that    */
/* another player controls — a room code echoed back, an opponent's slot, a   */
/* server status — into this UI. The moment one of those reaches an           */
/* `innerHTML`, a peer can run script in their opponent's page.               */
/*                                                                            */
/* So the rule gets a gate, in the same shape as the determinism one above,   */
/* while it still costs nothing to add.                                       */
/* -------------------------------------------------------------------------- */

describe('markup gate', () => {
  const BANNED: readonly [RegExp, string][] = [
    [/\.\s*innerHTML\s*=/, 'assigns innerHTML'],
    [/\.\s*outerHTML\s*=/, 'assigns outerHTML'],
    [/\.\s*insertAdjacentHTML\s*\(/, 'calls insertAdjacentHTML'],
    [/\bdocument\s*\.\s*write\s*\(/, 'calls document.write'],
    [/\bnew\s+Function\s*\(/, 'builds a function from a string'],
    // `eval(` only — `.eval` on some other object is not the global eval.
    [/(^|[^.\w])eval\s*\(/, 'calls eval'],
  ];

  it('src/** never turns a string into markup or into code', () => {
    const files = walkTs(join(process.cwd(), 'src'), []);
    expect(files.length, 'the walker must actually find the source').toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const [rx, what] of BANNED) {
        if (rx.test(src)) offenders.push(`${f.replace(process.cwd(), '')}: ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the gate would actually catch one', () => {
    // A gate nobody has seen fail is a gate nobody knows works.
    const sample = 'node.innerHTML = untrusted;';
    expect(BANNED.some(([rx]) => rx.test(sample))).toBe(true);
  });
});
