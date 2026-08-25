/**
 * ============================================================================
 * src/render/Gait.ts — the infantry walk cycle
 * ============================================================================
 * "Troops walking animation doesnt exist at all."
 *
 * It did not, and the machinery to say so had been sitting in the engine since
 * the foundation commit. `RenderPhase.UnitAnim = 40` exists in core/types.ts.
 * `core/loop.ts`'s write-ownership table assigns `animClip` / `animTime` to
 * "unit-art" at render-frame cadence. `core/world.ts` allocates both columns
 * over MAX_ENTITIES. `SaveGame` persists `animTime` at column 92. NOTHING EVER
 * WROTE OR READ EITHER, and no module registered at phase 40 — `buildings.system.ts`
 * takes 50 and that was the whole animation layer.
 *
 * WHY A VERTEX SHADER AND NOT A SKELETON
 * --------------------------------------
 * Infantry are ONE MERGED INSTANCED MESH. That is not an accident to be worked
 * around, it is the budget: 200+ units at 60 fps under 130 draw calls, which
 * rules out a scene-graph joint per limb per soldier and rules out skinning
 * (four bone indices and four weights per vertex, plus a bone texture, for a
 * model whose entire articulation is "two legs and two arms swing").
 *
 * So the swing is baked as geometry metadata and resolved on the GPU:
 *
 *   PER VERTEX   `aGait = (swingSign, pivotY)`, written by `UnitFactory`'s
 *                MeshBuilder over exactly the vertices each `MassDef.gait` mass
 *                emitted. `(0, 0)` means welded to the body, which is what
 *                every vertex of every vehicle gets — and the attribute is not
 *                emitted at all when nothing in the model swings, so a tank
 *                pays nothing.
 *   PER INSTANCE `aState.w` — see below.
 *
 * THE PHASE RIDES `aState`, IT DOES NOT ADD AN ATTRIBUTE
 * -----------------------------------------------------
 * `InstanceBatcher` already carries `aState = (hpFrac, buildProgress, selected,
 * seed)` and uploads it every frame. `seed` is per-entity noise that only the
 * BUILDING shader reads (for door phase and burn flicker) and that the unit
 * shader has never touched. Rather than add a fifth per-instance channel — a
 * new Float32Array, a new attribute, a new upload range, on every batch in the
 * game including the ones that will never walk — the walk phase is written into
 * that slot for infantry and the building shader is none the wiser, because no
 * entity is both.
 *
 * WHAT THE PHASE MEANS. `aState.w` is the gait phase in TURNS (0..1), already
 * multiplied by the swing amplitude's sign. The vertex stage takes
 * `sin(2*pi*phase)`, scales by `uGaitSwing`, and rotates the limb about the X
 * axis through `pivotY`. A soldier standing still gets phase 0 and amplitude 0
 * and is bit-identical to the pre-animation model, which is the property that
 * makes this safe to ship: nothing that is not walking changes at all.
 * ============================================================================
 */

import { UNIT_GAIT } from '../core/config';

/** The subset of `THREE.WebGLProgramParametersWithUniforms` this needs. */
export interface GaitShaderHost {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/** Shared so a single write reaches every unit batch. */
export const gaitUniforms = {
  /** Peak limb swing in radians. */
  uGaitSwing: { value: UNIT_GAIT.swingRadians },
};

/**
 * `aState.w` is a phase in TURNS; the shader wants radians. Exported so the TSL
 * port in `./gait-nodes.ts` multiplies by the SAME number rather than by a
 * second copy of tau typed out to a different precision — the drift
 * `terrain-uniforms.ts` exists to prevent, at its smallest possible scale.
 *
 * It is interpolated into the GLSL below and prints as `6.2831853`, which is
 * character-for-character what that shader has always contained.
 */
export const GAIT_TURNS_TO_RADIANS = 6.2831853;

/**
 * Inject the walk cycle into a unit material.
 *
 * ORDER MATTERS AND IS NOT NEGOTIABLE: this must run BEFORE `applyShroudTint`,
 * because the shroud reads `transformed` after `#include <project_vertex>` to
 * derive its world XZ, and a limb that has not been swung yet would shroud-
 * sample at the wrong place. In practice the error is millimetres — but the
 * real reason is simpler: `project_vertex` CONSUMES `transformed` into
 * `mvPosition`, so anything that edits `transformed` has to do it earlier or it
 * edits a value nobody reads again. That is the bug this comment exists to
 * prevent, and it fails silently and completely.
 */
export function applyGait(shader: GaitShaderHost): void {
  shader.uniforms.uGaitSwing = gaitUniforms.uGaitSwing;

  shader.vertexShader = shader.vertexShader
    .replace(
      'void main() {',
      `attribute vec2 aGait;
uniform float uGaitSwing;
void main() {`,
    )
    // `begin_vertex` is where `transformed` is first assigned from `position`.
    // Editing it here means morph targets, instancing and projection all see
    // the swung limb, and nothing downstream needs to know this happened.
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  {
    // aGait.x is 0 for every welded vertex, which is the overwhelming majority
    // of them and every single one on a vehicle. The multiply costs less than
    // the branch would.
    float vmSwing = sin(aStateGaitPhase * ${GAIT_TURNS_TO_RADIANS}) * uGaitSwing * aGait.x;
    float vmC = cos(vmSwing);
    float vmS = sin(vmSwing);
    float vmY = transformed.y - aGait.y;
    float vmZ = transformed.z;
    transformed.y = aGait.y + vmC * vmY - vmS * vmZ;
    transformed.z = vmS * vmY + vmC * vmZ;
  }`,
    );

  // The normal has to turn with the limb or a swinging leg lights as though it
  // were still pointing straight down, which reads as a shading flicker at
  // exactly the cadence of the walk — more distracting than no animation.
  shader.vertexShader = shader.vertexShader.replace(
    '#include <beginnormal_vertex>',
    `#include <beginnormal_vertex>
  {
    float vmSwingN = sin(aStateGaitPhase * ${GAIT_TURNS_TO_RADIANS}) * uGaitSwing * aGait.x;
    float vmCN = cos(vmSwingN);
    float vmSN = sin(vmSwingN);
    float vmNy = objectNormal.y;
    objectNormal.y = vmCN * vmNy - vmSN * objectNormal.z;
    objectNormal.z = vmSN * vmNy + vmCN * objectNormal.z;
  }`,
  );
}

/**
 * Declare `aStateGaitPhase` from the batcher's `aState.w`.
 *
 * Split out from `applyGait` because `aState` is declared by whoever owns the
 * material: the building shader already declares `attribute vec4 aState;` and
 * a second declaration is a compile error, while a unit material declares it
 * nowhere and a missing one is also a compile error. Units call both; nothing
 * else calls either.
 */
export function declareGaitPhase(shader: GaitShaderHost): void {
  shader.vertexShader = shader.vertexShader.replace(
    'void main() {',
    `attribute vec4 aState;
#define aStateGaitPhase aState.w
void main() {`,
  );
}
