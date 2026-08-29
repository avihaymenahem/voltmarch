import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const INFANTRY_ATTACHMENT_TRIANGLE_LIMIT = 200;

export function infantryAttachmentTriangles(geometry) {
  return geometry.index
    ? geometry.index.count / 3
    : geometry.getAttribute('position').count / 3;
}

export function assertInfantryAttachmentBudget(geometry, label) {
  const triangles = infantryAttachmentTriangles(geometry);
  if (triangles > INFANTRY_ATTACHMENT_TRIANGLE_LIMIT) {
    geometry.dispose();
    throw new Error(
      `${label} exceeds the ${INFANTRY_ATTACHMENT_TRIANGLE_LIMIT}-triangle modular attachment ceiling (${triangles}).`,
    );
  }
  return geometry;
}

function mergeAttachment(parts, label) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (geometry === null) throw new Error(`${label} attachment geometry could not be merged.`);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return assertInfantryAttachmentBudget(geometry, label);
}

export function createInfantryWeaponGeometry(kind) {
  const parts = [];
  const box = (size, position) => {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.translate(...position);
    parts.push(geometry);
  };
  const tube = (radiusTop, radiusBottom, length, z, segments = 10) => {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, z);
    parts.push(geometry);
  };
  const ring = (radius, tubeRadius, z) => {
    const geometry = new THREE.TorusGeometry(radius, tubeRadius, 4, 8);
    geometry.translate(0, 0, z);
    parts.push(geometry);
  };

  switch (kind) {
    case 'launcher':
      tube(0.082, 0.082, 0.92, -0.18, 12); tube(0.13, 0.105, 0.16, -0.68, 12);
      box([0.12, 0.22, 0.25], [0, -0.05, 0.28]); break;
    case 'flak':
      box([0.18, 0.18, 0.68], [0, 0, -0.14]); tube(0.042, 0.042, 0.56, -0.68, 10);
      tube(0.14, 0.14, 0.16, -0.05, 12); box([0.10, 0.22, 0.20], [0, -0.15, 0.25]); break;
    case 'lance':
      tube(0.035, 0.035, 1.18, -0.28, 10); ring(0.12, 0.025, -0.79);
      tube(0.018, 0.075, 0.22, -0.94, 10); box([0.11, 0.17, 0.22], [0, -0.06, 0.27]); break;
    case 'satchel':
      tube(0.07, 0.095, 0.66, -0.18, 10); tube(0.13, 0.13, 0.20, -0.50, 10);
      box([0.19, 0.20, 0.30], [0, -0.04, 0.27]); break;
    case 'prod':
      tube(0.028, 0.040, 1.02, -0.27, 8); ring(0.11, 0.022, -0.72);
      box([0.10, 0.16, 0.24], [0, -0.05, 0.27]); break;
    case 'wrench':
      box([0.07, 0.10, 0.70], [0, 0, -0.08]); box([0.24, 0.08, 0.12], [0, 0, -0.45]);
      box([0.07, 0.20, 0.12], [-0.085, 0.06, -0.45]); break;
    case 'cutter':
      tube(0.055, 0.075, 0.62, -0.14, 8); tube(0.12, 0.07, 0.18, -0.53, 8);
      box([0.11, 0.17, 0.22], [0, -0.05, 0.28]); break;
    case 'calibrator':
      box([0.10, 0.14, 0.58], [0, 0, -0.08]); ring(0.10, 0.025, -0.40);
      box([0.12, 0.18, 0.18], [0, -0.03, 0.27]); break;
    case 'salvage-tool':
      box([0.13, 0.14, 0.54], [0, 0, -0.05]); tube(0.035, 0.060, 0.30, -0.44, 8);
      box([0.18, 0.10, 0.16], [0.07, -0.04, 0.27]); break;
    case 'carbine':
      box([0.12, 0.14, 0.58], [0, 0, -0.08]); tube(0.022, 0.022, 0.36, -0.52, 8);
      box([0.11, 0.18, 0.20], [0, -0.03, 0.28]); break;
    default:
      box([0.12, 0.13, 0.64], [0, 0, 0]); tube(0.025, 0.025, 0.44, -0.48, 8);
      box([0.10, 0.16, 0.22], [0, 0, 0.36]); break;
  }
  return mergeAttachment(parts, `weapon ${kind}`);
}

export function createInfantryPackGeometry(kind) {
  const parts = [];
  const box = (size, position) => {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.translate(...position);
    parts.push(geometry);
  };
  const cylinder = (radius, length, position, rotation = [Math.PI / 2, 0, 0], segments = 10) => {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
    geometry.rotateX(rotation[0]); geometry.rotateY(rotation[1]); geometry.rotateZ(rotation[2]);
    geometry.translate(...position); parts.push(geometry);
  };

  switch (kind) {
    case 'missile-pack':
      box([0.42, 0.54, 0.16], [0, 1.35, 0.28]);
      cylinder(0.055, 0.48, [-0.12, 1.37, 0.38], [0, 0, 0], 8);
      cylinder(0.055, 0.48, [0.12, 1.37, 0.38], [0, 0, 0], 8); break;
    case 'toolcase':
      box([0.46, 0.38, 0.16], [0, 1.34, 0.28]); box([0.20, 0.055, 0.08], [0, 1.56, 0.30]); break;
    case 'drum':
      cylinder(0.22, 0.16, [0, 1.40, 0.31], [Math.PI / 2, 0, 0], 12);
      cylinder(0.07, 0.20, [0, 1.40, 0.34], [Math.PI / 2, 0, 0], 10); break;
    case 'gas-bottle':
      cylinder(0.13, 0.58, [0, 1.48, 0.28], [0, 0, Math.PI / 2], 12);
      box([0.05, 0.20, 0.05], [0.32, 1.48, 0.28]); break;
    case 'cells':
      box([0.15, 0.54, 0.13], [-0.105, 1.42, 0.28]); box([0.15, 0.54, 0.13], [0.105, 1.42, 0.28]); break;
    case 'instrument-case':
      box([0.22, 0.62, 0.13], [0, 1.43, 0.27]); box([0.30, 0.08, 0.15], [0, 1.72, 0.27]); break;
    case 'hopper':
      box([0.48, 0.50, 0.22], [0, 1.36, 0.30]); box([0.34, 0.16, 0.26], [0.10, 1.68, 0.32]); break;
    case 'tool-roll':
      cylinder(0.16, 0.46, [0, 1.40, 0.28], [0, 0, Math.PI / 2], 10);
      box([0.06, 0.38, 0.05], [-0.13, 1.40, 0.39]); box([0.06, 0.38, 0.05], [0.13, 1.40, 0.39]); break;
    default: throw new Error(`Unknown infantry attachment kind: ${kind}`);
  }
  return mergeAttachment(parts, `pack ${kind}`);
}
