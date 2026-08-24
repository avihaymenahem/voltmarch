import * as THREE from 'three';

/**
 * Convert normalized/quantized imported attributes to the float storage that
 * Three's WebGPU node-material layouts declare for them.
 *
 * WebGL can normalize integer vertex attributes while fetching them. WebGPU
 * instead validates the physical buffer against the declared float layout;
 * keeping a Uint16 vec2 behind a float2 declaration makes the buffer half the
 * required size and invalidates the entire render pass.
 */
export function promoteGeometryAttributeToFloat32(
  geometry: THREE.BufferGeometry,
  name: string,
): boolean {
  const attribute = geometry.getAttribute(name);
  if (attribute === undefined || attribute.array instanceof Float32Array) return false;

  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let component = 0; component < attribute.itemSize; component++) {
      values[i * attribute.itemSize + component] = attribute.getComponent(i, component);
    }
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  return true;
}

/**
 * Creased-normal reconstruction changes the tangent basis. Keeping an authored
 * tangent is both visually wrong and dangerous when a quantized Int16 tangent
 * is bound to WebGPU's float4 layout, so derivative tangents are used instead.
 */
export function removeStaleTangentAttribute(geometry: THREE.BufferGeometry): boolean {
  if (geometry.getAttribute('tangent') === undefined) return false;
  geometry.deleteAttribute('tangent');
  return true;
}
