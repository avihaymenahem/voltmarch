/**
 * Camera-frustum culling for the instanced render bridge.
 *
 * The extra margin is intentional: the colour camera cannot see an off-screen
 * aircraft, but its sun shadow can still land inside the viewport. Callers
 * choose that shadow-safe margin when updating the volume.
 */

import * as THREE from 'three';

export interface RenderCullVolume {
  intersectsSphere(x: number, y: number, z: number, radius: number): boolean;
}

export class CameraRenderCullVolume implements RenderCullVolume {
  private readonly clip = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private margin = 0;

  update(camera: THREE.PerspectiveCamera, margin = 0): void {
    // CameraRig normally owns these updates. Repeating them here makes the
    // volume correct in tools/tests that move the camera directly.
    camera.updateMatrixWorld();
    this.clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.clip);
    this.margin = Math.max(0, margin);
  }

  intersectsSphere(x: number, y: number, z: number, radius: number): boolean {
    const planes = this.frustum.planes;
    const limit = -(Math.max(0, radius) + this.margin);
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < limit) return false;
    }
    return true;
  }
}
