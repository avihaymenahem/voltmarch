/**
 * VOLTMARCH — src/render/post-order.ts
 * =============================================================================
 * THE CANONICAL POST ORDER, AND NOTHING ELSE.
 *
 * One declaration, two chains: `post.ts` re-exports it (so every existing
 * importer is unchanged) and `post-nodes.ts` imports it directly. It lives here
 * rather than in either of them because importing it from `post.ts` would drag
 * the whole WebGL chain — `EffectComposer`, `UnrealBloomPass`, `GTAOPass`,
 * `SMAAPass` and the build of `three` they come from — into the node chain's
 * module graph, to read a five-element array.
 *
 * The RATIONALE for the order is in `post.ts`'s file header and stays there:
 * tonemapping off the renderer so HDR survives to the bloom threshold, AO before
 * bloom so an occluded crevice cannot bloom, grade doing the tonemap, SMAA last
 * on the finished LDR sRGB image. Nobody edits this array without editing that
 * comment first — and `demoteSmaaTargets` in both chains is only correct while
 * `smaa` is the tail.
 */

export type PassId = 'render' | 'ao' | 'bloom' | 'grade' | 'smaa';

export const PASS_ORDER: readonly PassId[] = ['render', 'ao', 'bloom', 'grade', 'smaa'] as const;
