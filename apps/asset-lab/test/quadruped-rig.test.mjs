import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOG = path.join(ROOT, 'packages/assets/game/units/soviets/animation/attack-dog-rigged.glb');

test('Soviet Attack Dog ships a bounded quadruped rig and complete clip set', async () => {
  const document = await new NodeIO().read(DOG);
  const root = document.getRoot();
  const primitive = root.listMeshes()[0]?.listPrimitives()[0];
  const skin = root.listSkins()[0];
  assert.ok(primitive, 'missing dog primitive');
  assert.ok(skin, 'missing dog skin');
  assert.deepEqual(skin.listJoints().map((joint) => joint.getName()), [
    'Body', 'Head', 'Jaw', 'Tail',
    'ForeLeg.L', 'ForeLeg.R', 'HindLeg.L', 'HindLeg.R',
  ]);
  assert.equal(skin.getInverseBindMatrices()?.getCount(), 8);
  assert.deepEqual(root.listAnimations().map((animation) => animation.getName()), [
    'Idle', 'Walk', 'Run', 'Bite',
  ]);

  for (const animation of root.listAnimations().filter((clip) => clip.getName() !== 'Idle')) {
    const foreChannels = animation.listChannels().filter((channel) =>
      channel.getTargetNode()?.getName().startsWith('ForeLeg.'));
    assert.equal(foreChannels.length, 2, `${animation.getName()} must carry both forelegs`);
    for (const channel of foreChannels) {
      assert.equal(
        channel.getTargetPath(),
        'rotation',
        `${animation.getName()} must swing each rigid paw with its foreleg`,
      );
      const values = channel.getSampler().getOutput().getArray();
      for (let offset = 0; offset < values.length; offset += 4) {
        const angle = 2 * Math.acos(Math.min(1, Math.abs(values[offset + 3])));
        assert.ok(angle <= 0.55, `${animation.getName()} foreleg swing exceeds its safe bound`);
      }
    }
  }

  const position = primitive.getAttribute('POSITION');
  const joints = primitive.getAttribute('JOINTS_0');
  const weights = primitive.getAttribute('WEIGHTS_0');
  assert.equal(position?.getCount(), 6300);
  assert.equal(joints?.getCount(), position.getCount());
  assert.equal(weights?.getCount(), position.getCount());

  const jointValues = joints.getArray();
  const weightValues = weights.getArray();
  const positionValues = position.getArray();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < position.getCount(); vertex++) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positionValues[vertex * 3 + axis]);
      max[axis] = Math.max(max[axis], positionValues[vertex * 3 + axis]);
    }
  }
  const size = max.map((value, axis) => value - min[axis]);
  const influence = new Array(8).fill(0);
  let rigidForeCore = 0;
  for (let vertex = 0; vertex < weights.getCount(); vertex++) {
    let sum = 0;
    for (let slot = 0; slot < 4; slot++) {
      const offset = vertex * 4 + slot;
      assert.ok(jointValues[offset] >= 0 && jointValues[offset] < 8);
      assert.ok(weightValues[offset] >= 0 && weightValues[offset] <= 1);
      influence[jointValues[offset]] += weightValues[offset];
      sum += weightValues[offset];
    }
    assert.ok(Math.abs(sum - 1) < 1e-5, `vertex ${vertex} weights sum to ${sum}`);

    const x = positionValues[vertex * 3];
    const y = positionValues[vertex * 3 + 1];
    const z = positionValues[vertex * 3 + 2];
    const nx = (x - (min[0] + max[0]) * 0.5) / (size[0] * 0.5);
    const ny = (y - min[1]) / size[1];
    const nz = (z - min[2]) / size[2];
    if (ny <= 0.42 && Math.abs(nx) >= 0.25 && Math.abs(nz - 0.60) <= 0.14) {
      assert.equal(jointValues[vertex * 4], nx < 0 ? 4 : 5, `paw vertex ${vertex} uses the wrong foreleg`);
      assert.ok(weightValues[vertex * 4] > 0.999, `paw vertex ${vertex} is not rigidly bound`);
      rigidForeCore++;
    }
  }
  assert.ok(rigidForeCore > 100, `expected a meaningful rigid fore-paw core, found ${rigidForeCore} vertices`);
  influence.forEach((sum, index) => assert.ok(sum > 1, `joint ${index} has no meaningful influence`));

  const triangles = primitive.getIndices().getCount() / 3;
  assert.equal(triangles, 5987);
  assert.ok((await stat(DOG)).size < 2 * 1024 * 1024, 'rigged dog exceeds the 2 MiB creature ceiling');
});
