/**
 * THE AO G-BUFFER, THE OCCLUDER FILTER, AND THE DRAW-CALL INSTRUMENT BESIDE THEM.
 *
 * READ THIS FIRST, BECAUSE THE FILTER'S SCOPE NARROWED. `installAoDepthGBuffer`
 * hands `GTAOPass` the depth the colour pass already wrote and clears
 * `_renderGBuffer`, so THERE IS NO NORMAL PREPASS on any path where three's
 * internals are where `post.ts` expects them — and `_overrideVisibility`, which
 * is where the filter lives, is that prepass's own fence. The filter therefore
 * governs a FALLBACK, and `userData.vmAoOccluder` does not decide a shipped
 * pixel. It is still tested, at full strength, because the fallback is what a
 * three upgrade lands on and an unfiltered prepass is the black-decal defect.
 *
 * Three things are pinned here, and none has any other guard.
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

const ROOT = join(__dirname, '..', '..', '..');
const POST_SRC = readFileSync(join(ROOT, 'apps/game/src/render/post.ts'), 'utf8');
const DEBUG_SRC = readFileSync(join(ROOT, 'apps/game/src/render/debug.ts'), 'utf8');
const SHOOT_SRC = readFileSync(join(ROOT, 'tools/shoot.mjs'), 'utf8');

/** Prose must not be able to satisfy an assertion about code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const POST_CODE = stripComments(POST_SRC);
const DEBUG_CODE = stripComments(DEBUG_SRC);
const SHOOT_CODE = stripComments(SHOOT_SRC);

describe('AO G-buffer from the scene depth', () => {
  /*
   * THE WHOLE SAVING IS ONE CALL. `setGBuffer(depth, normal)` is what sets
   * `_renderGBuffer = false`; without it `GTAOPass.render` opens with
   * `_renderOverride(renderer, this.normalMaterial, ...)`, which is
   * `renderer.render(scene, camera)` — 39-57 draw calls on the capture
   * fixtures, 26.8-29.4% of the frame. Nothing throws if the call goes missing and
   * nothing looks different; the draws simply come back. That is the exact
   * shape of defect this repo keeps rediscovering, so it gets a test.
   */
  it('hands GTAO a depth texture instead of letting it re-render the scene', () => {
    expect(POST_CODE).toContain('installAoDepthGBuffer');
    expect(POST_CODE, 'setGBuffer is the only thing that clears _renderGBuffer')
      .toMatch(/setGBuffer\.call\(p, seedDepth, normalTarget\.texture\)/);
  });

  it('attaches a depth texture to BOTH composer targets', () => {
    /*
     * `EffectComposer.render()` does not reset `readBuffer` between frames and
     * this chain swaps an odd number of times, so the target `RenderPass` draws
     * into alternates. One attachment would give the AO a correct depth buffer
     * every other frame — a flicker with no error attached to it.
     */
    expect(POST_CODE).toMatch(/renderTarget1\.depthTexture = makeSceneDepthTexture\(/);
    expect(POST_CODE).toMatch(/renderTarget2\.depthTexture = makeSceneDepthTexture\(/);
  });

  it('gives the MSAA scene target its own depth, and reads that when it is live', () => {
    /*
     * With MSAA on the scene goes into `sceneMsaa`, and the composer's read
     * buffer receives a colour-only transfer quad through `renderer.render`,
     * which CLEARS. So the read buffer's depth at AO time is 1.0, not the
     * scene, and the depth has to come off the multisampled target — whose
     * texture three fills by blitting `DEPTH_BUFFER_BIT` during the one resolve.
     */
    expect(POST_CODE).toMatch(/depthTexture: makeSceneDepthTexture\('SceneMSAADepth'\)/);
    expect(POST_CODE).toMatch(
      /sceneMsaa !== null \? sceneMsaa\.depthTexture : readBuffer\.depthTexture/,
    );
  });

  it('reads the depth per frame rather than capturing it', () => {
    // A captured texture survives a resize (which reallocates both composer
    // targets) and a MSAA toggle (which allocates a new scene target) as a
    // dangling reference to a buffer nothing draws into any more.
    expect(POST_CODE, 'the live depth must be derived inside the render wrapper')
      .toMatch(/p\.render = function depthGBufferRender/);
    expect(POST_CODE).toMatch(/normalMat\.uniforms\.tDepth\.value = depth/);
    expect(POST_CODE).toMatch(/gtao\.uniforms\.tDepth\.value = depth/);
    expect(POST_CODE).toMatch(/pd\.uniforms\.tDepth\.value = depth/);
  });

  it('allocates nothing in the reconstruction path', () => {
    /*
     * `depthGBufferRender` runs once per frame. The projection inverse is the
     * only thing that changes, and it is copied into a `Matrix4` built at
     * install time — `new THREE.Matrix4()` inside the wrapper would be a
     * per-frame allocation, which CLAUDE.md forbids outright.
     */
    const wrapper = POST_CODE.slice(POST_CODE.indexOf('function depthGBufferRender'));
    const body = wrapper.slice(0, wrapper.indexOf('return true;'));
    expect(body).toMatch(/\.copy\(p\.camera\.projectionMatrixInverse\)/);
    expect(body, 'nothing may be constructed inside the per-frame wrapper')
      .not.toMatch(/new THREE\./);
  });

  it('packs the reconstructed normal the way unpackRGBToNormal reads it', () => {
    /*
     * `setGBuffer` derives `NORMAL_VECTOR_TYPE = 1` from being given a normal
     * texture, and that branch is `unpackRGBToNormal(texel.rgb)`, i.e.
     * `2 * rgb - 1`. A quad writing a raw signed normal would come back
     * doubled and biased, which is AO that looks plausible and is wrong.
     */
    expect(POST_CODE).toMatch(/normalize\(cross\(dpdx, dpdy\)\) \* 0\.5 \+ 0\.5/);
  });

  it('keeps the prepass as a real fallback rather than half-installing', () => {
    // Six internals are resolved before anything is rewired. A partially
    // installed G-buffer is a black or inverted AO term; the prepass it would
    // have replaced still works, so returning false costs draws and nothing else.
    expect(POST_CODE).toMatch(/function installAoDepthGBuffer\(pass: unknown\): boolean/);
    expect(POST_CODE).toMatch(/if \(DEV\) console\.warn\('\[post\] AO depth G-buffer unavailable/);
    // And the filter is installed BEFORE the attempt, so the fallback is the
    // filtered prepass rather than the raw one.
    expect(POST_CODE.indexOf('installAoOccluderFilter(p)'))
      .toBeLessThan(POST_CODE.indexOf('installAoDepthGBuffer(p)'));
  });
});

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
    /*
     * `info` IS `handle.frameInfo()` NOW, NOT `renderer.info`, and that is the
     * point of the change rather than a rename. Under the node renderer
     * `info.render.calls` is a MONOTONIC COUNT OF `render()` INVOCATIONS since
     * page load that `reset()` never clears — so the old expression would have
     * put a number that only ever climbs into `_report.json` under the name
     * "draw calls", silently. `normaliseInfo()` in `src/render/backend.ts` is
     * where that trap is written down; `frameInfo()` is the only safe read.
     */
    expect(DEBUG_CODE, 'three consumers read this field by this name')
      .toMatch(/drawCalls: info\.drawCalls/);
    expect(DEBUG_CODE, 'and it must come through the backend-normalising seam')
      .toMatch(/const info = handle\.frameInfo\(\);/);
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
