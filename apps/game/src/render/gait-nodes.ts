/**
 * ============================================================================
 * VOLTMARCH — src/render/gait-nodes.ts
 * ============================================================================
 * THE INFANTRY WALK CYCLE, AS A TSL NODE GRAPH. Stage D of
 * the WebGPU migration.
 *
 * `./Gait.ts` is the shipping WebGL injection and carries the whole argument for
 * why the swing is a vertex shader rather than a skeleton. Read it first; this
 * file is the same arithmetic expressed for the node path and nothing else.
 *
 * THE ONE THING THAT IS GENUINELY DIFFERENT, AND IT DECIDES THE SHAPE OF EVERY
 * STAGE D MATERIAL
 * ---------------------------------------------------------------------------
 * The GLSL edits `transformed` at `<begin_vertex>`, which is MODEL SPACE: three
 * does not apply `instanceMatrix` until `<project_vertex>`. So the limb rotates
 * about the MODEL's X axis, through the model-space pivot height in `aGait.y`,
 * and every soldier swings his legs forward along his own heading no matter
 * which way the instance faces him.
 *
 * `material.positionNode` — the obvious node hook — is applied by
 * `NodeMaterial.setupPosition` AFTER `instancedMesh( object )` has already
 * rewritten `positionLocal` to the instanced position. Rotating about the X axis
 * there is rotating about a WORLD axis: a soldier facing +X would swing his legs
 * sideways. It is not a subtle difference and it is not a tuning question.
 *
 * The hook that lands in the right space is `setupPosition` itself, overridden,
 * doing the model-space edit BEFORE calling `super` — which then applies
 * instancing on top exactly as `<project_vertex>` does. `positionLocal` is a
 * varying-backed var and `normalLocal` is a var, both assignable; three's own
 * `Instance.js` assigns both, which is the precedent.
 *
 * **THE COST OF THAT CHOICE WAS THE SHADOW PASS**, which never calls our
 * `setupPosition`. `render/cast-shadow-nodes.ts` closes that for the materials
 * whose GLSL twins carry a `customDepthMaterial`; this one's does not, so the
 * unit material deliberately leaves the swing out of the shadow map and matches
 * the shipping renderer. The argument is in `UnitNodeMaterial.ts` beside the
 * line that would add it. See `STAGE_D_TSL_GAPS` #1.
 * ============================================================================
 */

import type { Node } from 'three/webgpu';
import { attribute, normalLocal, positionLocal, step, uniform, vec3 } from 'three/tsl';
import { UNIT_GAIT } from '../core/config';
import {
  GAIT_TURNS_TO_RADIANS, gaitUniforms, QUADRUPED_GAIT_PIVOT_Z,
} from './Gait';

type FloatN = Node<'float'>;

/* ==========================================================================
 * 1. THE UNIFORM
 * ========================================================================== */

/**
 * Peak limb swing in radians, mirroring `gaitUniforms.uGaitSwing`.
 *
 * Same pull-not-push rule as `shroud-nodes.ts`: `Gait.ts` owns the value and
 * must never learn about `three/webgpu`, so the node reads across rather than
 * the writer reaching over. This one is written once at load rather than per
 * frame, but the mirror is kept live anyway — `?tier=` and the debug handle can
 * both move it, and a knob that works on one renderer and not the other is
 * exactly the two-baseline problem §4.5 of the plan warns about.
 */
export const gaitSwingNode = uniform(UNIT_GAIT.swingRadians);
gaitSwingNode.onRenderUpdate(() => { gaitSwingNode.value = gaitUniforms.uGaitSwing.value; });

/* ==========================================================================
 * 2. THE ATTRIBUTES
 * ========================================================================== */

/**
 * `(swingSign, pivotY)`, per vertex, written by `UnitFactory`'s MeshBuilder.
 *
 * NOT EMITTED AT ALL when nothing in the model swings — a tank's geometry has no
 * `aGait` — and that is the deliberate design recorded in `Gait.ts`. On the
 * WebGL path a missing attribute reads as zero and the multiply below is a
 * no-op. On the node path three WARNS and substitutes a default, which is the
 * same picture with a console line; the substitution is why `swingSign` is
 * multiplied in rather than branched on, and why a vehicle costs nothing.
 */
const aGait = attribute<'vec2'>('aGait', 'vec2');

/** `aState.w` — the walk phase in TURNS, sign-carrying. See `Gait.ts`. */
const gaitPhase = attribute<'vec4'>('aState', 'vec4').w;

/* ==========================================================================
 * 3. THE SWING
 * ========================================================================== */

/**
 * `sin( phase * 2pi ) * swing * swingSign`, solved once.
 *
 * The GLSL solves this TWICE — once in `<begin_vertex>` as `vmSwing` and again
 * in `<beginnormal_vertex>` as `vmSwingN` — because the two chunks are separate
 * strings with no shared scope. A node graph has one scope, so it is solved
 * once and both consumers read the same var. That is a strict improvement and
 * the only place this port is not line-for-line.
 */
function swingAngle(): FloatN {
  return gaitPhase.mul(GAIT_TURNS_TO_RADIANS).sin().mul(gaitSwingNode).mul(aGait.x.sign());
}

/** Decode magnitude 2/3 quadruped end codes; biped magnitude 0/1 stays at Z=0. */
function longitudinalPivot(): FloatN {
  const code = aGait.x.abs();
  const quadruped = step(1.5, code);
  const end = step(2.5, code).mul(-2).add(1);
  return quadruped.mul(end).mul(QUADRUPED_GAIT_PIVOT_Z);
}

/**
 * Rotate the limb about the model X axis through `aGait.y`, and turn the normal
 * with it.
 *
 * CALL FROM `setupPosition`, BEFORE `super.setupPosition( builder )`. The normal
 * has to turn or a swinging leg lights as though it were still pointing straight
 * down, which reads as a shading flicker at exactly the cadence of the walk —
 * `Gait.ts` records that as more distracting than no animation at all.
 */
export function applyGaitNodes(): void {
  const a = swingAngle().toVar('vmSwing');
  const c = a.cos().toVar('vmC');
  const s = a.sin().toVar('vmS');

  const y = positionLocal.y.sub(aGait.y).toVar('vmY');
  const pivotZ = longitudinalPivot().toVar('vmPivotZ');
  const z = positionLocal.z.sub(pivotZ).toVar('vmZ');
  positionLocal.assign(vec3(
    positionLocal.x,
    aGait.y.add(c.mul(y)).sub(s.mul(z)),
    pivotZ.add(s.mul(y)).add(c.mul(z)),
  ));

  const ny = normalLocal.y.toVar('vmNy');
  const nz = normalLocal.z.toVar('vmNz');
  normalLocal.assign(vec3(
    normalLocal.x,
    c.mul(ny).sub(s.mul(nz)),
    s.mul(ny).add(c.mul(nz)),
  ));
}
