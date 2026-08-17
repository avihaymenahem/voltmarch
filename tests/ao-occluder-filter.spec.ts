/**
 * THE AO OCCLUDER FILTER, AND THE DRAW-CALL INSTRUMENT BESIDE IT.
 *
 * Two things are pinned here, and neither has any other guard.
 *
 * 1. THE OPT-OUT IS A CROSS-FILE CONTRACT. A mesh stamps
 *    `userData.vmAoOccluder = false` where it is built; `aoOccluder` in
 *    `src/render/post.ts` is the only thing that reads it. A producer and a
 *    consumer in different files, with nothing between them but a string, is
 *    exactly the arrangement that rots silently — the stamp keeps being written,
 *    the filter stops asking, and the only symptom is AO darkening under a sheet
 *    nobody photographs.
 *
 * 2. THE FILTER RUNS INSIDE THE FRAME LOOP. It is called from
 *    `_overrideVisibility` (GTAOPass.js:504), once per frame, over the whole
 *    scene graph — so `Array.isArray(mat) ? mat : [mat]` allocated an array per
 *    visible mesh per frame, and the wrapper that delegated to GTAOPass's own
 *    filter and then traversed AGAIN allocated a closure and walked ~300 nodes
 *    twice. CLAUDE.md's zero-allocation rule is not advisory here.
 *
 * 3. `drawCalls` IS A SUM OVER THREE SCENE SUBMISSIONS and always has been. The
 *    breakdown that says so is additive: three consumers read `drawCalls` by
 *    that name (`tools/shoot.mjs`, the F3 overlay, `EngineSource.read`), and a
 *    dozen releases of `shots/_report.json` are comparable only while it keeps
 *    its meaning.
 *
 * NODE ENVIRONMENT, so this reads the sources as text — the same reasoning
 * `tests/perf-budget.spec.ts` gives at length: importing `post.ts` pulls in
 * three's postprocessing passes, several of which allocate at module scope.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const POST_SRC = readFileSync(join(ROOT, 'src/render/post.ts'), 'utf8');
const DEBUG_SRC = readFileSync(join(ROOT, 'src/render/debug.ts'), 'utf8');
const SHOOT_SRC = readFileSync(join(ROOT, 'tools/shoot.mjs'), 'utf8');

/** Prose must not be able to satisfy an assertion about code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const POST_CODE = stripComments(POST_SRC);
const DEBUG_CODE = stripComments(DEBUG_SRC);
const SHOOT_CODE = stripComments(SHOOT_SRC);

describe('AO occluder filter', () => {
  it('honours the vmAoOccluder opt-out, and does so strictly', () => {
    /*
     * `=== false`, never truthiness: `userData` is empty on the overwhelming
     * majority of meshes, and `!mesh.userData.vmAoOccluder` would exclude every
     * one of them from the G-buffer — which is AO off, arrived at by accident.
     */
    expect(POST_CODE).toMatch(/mesh\.userData\.vmAoOccluder === false/);
    expect(POST_CODE, 'the opt-out must not be read as truthiness')
      .not.toMatch(/!\s*mesh\.userData\.vmAoOccluder/);
  });

  it('does not wrap a single material in a fresh array', () => {
    // One array per visible mesh per frame. The branch below costs nothing.
    expect(POST_CODE).not.toMatch(/Array\.isArray\(mat\)\s*\?\s*mat\s*:\s*\[mat\]/);
    expect(POST_CODE).toContain('materialOccludes(');
  });

  it('walks the scene once, with a callback created once', () => {
    /*
     * The old shape was `base.call(this)` — which runs GTAOPass's own full
     * traverse — followed by `this.scene.traverse((o) => {...})`, a second walk
     * behind a freshly allocated arrow. Both halves are gone: one traverse, one
     * hoisted callback, and `base` is still resolved so a GTAOPass whose
     * internals moved installs nothing rather than half of this.
     */
    expect(POST_CODE).toContain('this.scene.traverse(hideAoNonOccluders)');
    expect(POST_CODE, 'the traverse callback must be hoisted, not per-call')
      .toMatch(/const hideAoNonOccluders\s*=\s*\(o: THREE\.Object3D\)/);
    expect(POST_CODE, 'no inline arrow may be handed to scene.traverse in this file')
      .not.toMatch(/scene\.traverse\(\s*\(/);
  });

  it('keeps the points/lines rule ahead of the mesh rule', () => {
    // `Line2` extends `LineSegments2` extends `Mesh`, so it answers true to
    // `isMesh` as well. Testing the mesh rule first would put every wide line
    // through `aoOccluder` and into the G-buffer.
    const lineAt = POST_CODE.indexOf('c.isPoints === true');
    const meshAt = POST_CODE.indexOf('c.isMesh !== true');
    expect(lineAt, 'the points/lines rule was not found').toBeGreaterThan(-1);
    expect(meshAt, 'the mesh rule was not found').toBeGreaterThan(-1);
    expect(lineAt).toBeLessThan(meshAt);
  });
});

describe('draw calls, split by pass', () => {
  it('brackets the three scene submissions', () => {
    // The shadow map (inside `renderer.render`), the colour pass (the composer's
    // RenderPass) and GTAO's normal prepass (between the pass's own visibility
    // fences). Nothing else submits the scene.
    expect(POST_CODE).toMatch(/shadowMap\.render\s*=\s*function meteredShadowRender/);
    expect(POST_CODE).toContain('installSceneCallMeter');
    expect(POST_CODE).toContain('installAoPrepassMeter');
  });

  it('restores the shadow meter on dispose', () => {
    // The renderer outlives the chain. Without this, chain N counts every frame
    // N times and the shadow bucket grows one boot at a time.
    expect(POST_CODE).toMatch(/shadowMap\.render\s*=\s*baseShadowRender/);
  });

  it('makes post the residual, so the buckets are exhaustive', () => {
    // shadow + colour + ao + post === total, by construction. A meter that stops
    // firing then shows up as an implausible `post` instead of a wrong total.
    expect(POST_CODE).toMatch(
      /drawCallsByPass\.post\s*=\s*total - shadowCalls - sceneCalls - aoCalls/,
    );
  });

  it('is additive: drawCalls keeps its name and its meaning', () => {
    expect(DEBUG_CODE, 'three consumers read this field by this name')
      .toMatch(/drawCalls: info\.render\.calls/);
    expect(DEBUG_CODE).toMatch(/drawCallsByPass: readDrawCallsByPass\(/);
    expect(SHOOT_CODE, 'the report block must carry both').toMatch(/drawCalls: s\.drawCalls/);
    expect(SHOOT_CODE).toMatch(/drawCallsByPass: s\.drawCallsByPass/);
  });

  it('hands out a copy, not the record the frame loop rewrites', () => {
    // `PostChain` mutates one object in place every frame because it runs in the
    // frame loop. A consumer holding that object holds a value that changes
    // underneath it — including `_report.json`, which claims to describe ONE
    // captured frame.
    expect(POST_CODE).toMatch(/const drawCallsByPass: DrawCallBreakdown = \{/);
    expect(DEBUG_CODE).toMatch(/return \{ shadow: d\.shadow, colour: d\.colour/);
  });
});
