/**
 * ============================================================================
 * WEBGPU BUNDLE ISOLATION — a WebGL player must not download the node system.
 * ============================================================================
 * Stage F of the WebGPU migration. Stage B measured `three/webgpu` at
 * **literally zero occurrences** in `dist/` and that was easy then, because
 * nothing imported the node chain. The cutover wires it in, and the whole point
 * of `src/render/gpu-path.ts` is that it stays zero.
 *
 * `three/webgpu` is the entire node system — both backends, the WGSL and GLSL
 * builders, the node material library, the render pipeline. It is ~760 kB of
 * emitted JavaScript. A WebGL player who never types `?gpu=webgpu` must not pay
 * for one byte of it.
 *
 * ── WHY A SOURCE SCAN AND NOT A `dist/` SCAN ────────────────────────────────
 * `npm test` does not build, and a test that silently passes when `dist/` is
 * absent is worse than none — that is the shape of half the defects
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues. So this checks the INVARIANT that
 * produces the property, in source, where it is always checkable:
 *
 *   1. exactly one module in `src/` reaches `three/webgpu` other than through a
 *      dynamic import, and that module is `gpu-path-install.ts`;
 *   2. nothing imports `gpu-path-install` statically;
 *   3. every OTHER `three/webgpu` importer is reachable only from it.
 *
 * If `dist/` happens to exist, §4 also reads the real emitted chunks — the
 * measurement, when it is available, rather than instead of the invariant.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'apps/game/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);

/** Static `import ... from 'three/webgpu'` or `'three/tsl'`, not a comment. */
const STATIC_NODE_IMPORT = /^\s*import\s[^;]*?\sfrom\s+['"]three\/(webgpu|tsl)['"]/m;

/** Files that pull the node system in at module scope. */
const NODE_IMPORTERS = FILES.filter((f) => STATIC_NODE_IMPORT.test(readFileSync(f, 'utf8')))
  .map((f) => relative(SRC, f).split(sep).join('/'))
  .sort();

describe('the node system is behind one dynamic import', () => {
  it('every node-importing module is a *-nodes / *NodeMaterial / install file', () => {
    /*
     * NOT A HARD-CODED LIST. A list would have to be edited by whoever adds the
     * next node material, and an edit is exactly what does not happen — the
     * naming rule is what a reader can check. `gpu-path-install.ts` is the only
     * exception and it is the entry point itself.
     */
    const offenders = NODE_IMPORTERS.filter(
      (f) =>
        f !== 'render/gpu-path-install.ts' &&
        !/(^|\/)[A-Za-z0-9]*Node[A-Za-z]*\.ts$/.test(f) &&
        !/-nodes\.ts$/.test(f) &&
        !/node-materials\.ts$/.test(f) &&
        // Stage B's three post passes live in `render/nodes/` and are named
        // `ao-node.ts` / `bloom-node.ts` / `grade-node.ts` — the directory is
        // the marker there rather than the suffix.
        !/^render\/nodes\//.test(f),
    );
    expect(offenders, `these import three/webgpu but are not node modules: ${offenders.join(', ')}`)
      .toEqual([]);
    // Non-vacuity: the scan must actually be finding the node modules.
    expect(NODE_IMPORTERS.length).toBeGreaterThan(10);
    expect(NODE_IMPORTERS).toContain('render/gpu-path-install.ts');
    expect(NODE_IMPORTERS).toContain('world/TerrainNodeMaterial.ts');
    expect(NODE_IMPORTERS).toContain('vfx/vfx-node-materials.ts');
  });

  it('nothing imports gpu-path-install statically', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (rel === 'render/gpu-path-install.ts') continue;
      const src = readFileSync(f, 'utf8');
      // A static import of it would drag the whole node system into the entry.
      if (/^\s*import\s[^;]*?\sfrom\s+['"][^'"]*gpu-path-install['"]/m.test(src)) bad.push(rel);
    }
    expect(bad, `static importers of gpu-path-install: ${bad.join(', ')}`).toEqual([]);
  });

  it('gpu-path.ts reaches it by dynamic import, behind requestedBackend', () => {
    const src = readFileSync(join(SRC, 'render/gpu-path.ts'), 'utf8');
    expect(src).toMatch(/await import\(['"]\.\/gpu-path-install['"]\)/);
    expect(src).toMatch(/requestedBackend\(/);
    // The branch is what makes the chunk unreachable on the WebGL path. Without
    // the guard the import still splits the chunk but every boot fetches it.
    expect(src).toMatch(/if \(want !== 'webgpu'\) return 'webgl';/);
    // And it must not import three itself except as erased types.
    expect(src).not.toMatch(/^\s*import\s+\*\s+as\s+THREE\s+from\s+'three'/m);
    expect(src).toMatch(/^import type \* as THREE from 'three';/m);
  });

  it('gpu-path.ts is what the material sites import, not a node module', () => {
    /*
     * The routers. If one of these ever imported its node twin directly the
     * bundle would grow by the whole node system and nothing else would fail.
     */
    const sites = [
      'art/UnitFactory.ts', 'art/BuildingFactory.ts', 'world/Terrain.ts', 'world/Water.ts',
      'world/Roads.ts', 'world/Scatter.ts', 'world/Decals.ts', 'render/FogOfWar.ts',
      'render/ContactShadows.ts', 'vfx/Beams.ts', 'vfx/Particles.ts', 'render/scene.ts',
      'render/post.ts', 'render/renderer.ts',
    ];
    for (const rel of sites) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src, `${rel} must route through gpu-path`).toMatch(/from '\.{1,2}\/(render\/)?gpu-path'/);
      expect(src, `${rel} must not import the node system`).not.toMatch(STATIC_NODE_IMPORT);
    }
  });
});

/* ==========================================================================
 * 4. THE MEASUREMENT, WHEN dist/ IS THERE
 * ========================================================================== */

const DIST = join(ROOT, 'apps/game/dist', 'assets');

/**
 * A STALE `dist/` MUST SKIP, NOT FAIL — and this cost a red `npm test` once.
 *
 * `npm test` does not build. During the Stage F verification `dist/` was left
 * holding a PRE-CUTOVER bundle (built deliberately, to measure what the seam
 * costs a WebGL player), and the two assertions below correctly reported that it
 * has no node chunk — a red suite for a reason that had nothing to do with the
 * change under test. CLAUDE.md's "`npm test` has no known flake" is a promise
 * about exactly this, and a test whose result depends on which build happens to
 * be on disk breaks it.
 *
 * So the freshness question is asked directly: is the entry chunk newer than
 * every `.ts` under `src/`? The INVARIANT tests above run unconditionally and
 * are the real gate; this block is the measurement, taken when it is available
 * and honest about when it is not.
 */
function distIsCurrent(): boolean {
  if (!existsSync(DIST)) return false;
  const entry = readdirSync(DIST).find((f) => /^index-.*\.js$/.test(f));
  if (entry === undefined) return false;
  const built = statSync(join(DIST, entry)).mtimeMs;
  let newestSource = 0;
  for (const f of FILES) {
    const m = statSync(f).mtimeMs;
    if (m > newestSource) newestSource = m;
  }
  return built >= newestSource;
}

const haveDist = distIsCurrent();

describe.runIf(haveDist)('the built entry chunk carries no node system', () => {
  const files = haveDist ? readdirSync(DIST).filter((f) => f.endsWith('.js')) : [];
  const entry = files.find((f) => /^index-.*\.js$/.test(f));
  const install = files.find((f) => /^gpu-path-install-.*\.js$/.test(f));

  it('emits gpu-path-install as its own chunk', () => {
    expect(entry, 'no index-*.js in dist/assets — rebuild').toBeDefined();
    expect(install, 'the node path did not split into its own chunk').toBeDefined();
  });

  it('has zero node-system symbols in the entry chunk', () => {
    const src = readFileSync(join(DIST, entry!), 'utf8');
    /*
     * `WebGPURenderer`, `WebGPUBackend` and `NodeMaterial` are DELIBERATELY NOT
     * on this list and would fail if they were:
     *   - the first two appear as STRING LITERALS in `backend.ts`'s error
     *     messages and `renderer.ts`'s refusal, which have been in the entry
     *     chunk since Stage A and are the whole point of the tripwire;
     *   - `isNodeMaterial` is three's OWN WebGLRenderer checking whether the
     *     material it was handed is a node one. It ships in `three` core.
     * These six are code that only exists inside `three/webgpu`.
     */
    for (const sym of [
      'WGSLNodeBuilder', 'GLSLNodeBuilder', 'RenderPipeline',
      'MeshPhysicalNodeMaterial', 'MeshStandardNodeMaterial', 'castShadowPositionNode',
    ]) {
      expect(src.includes(sym), `"${sym}" leaked into the entry chunk`).toBe(false);
    }
  });

  it('and the install chunk carries all of them — the non-vacuity half', () => {
    // Without this the test above would pass just as happily if the node path
    // had been deleted, which is the failure mode of every absence assertion.
    const src = readFileSync(join(DIST, install!), 'utf8');
    for (const sym of [
      'GLSLNodeBuilder', 'RenderPipeline', 'MeshPhysicalNodeMaterial',
      'MeshStandardNodeMaterial', 'castShadowPositionNode',
    ]) {
      expect(src.includes(sym), `"${sym}" missing from the node chunk`).toBe(true);
    }
  });
});
