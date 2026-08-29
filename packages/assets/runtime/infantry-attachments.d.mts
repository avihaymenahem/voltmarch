import type { BufferGeometry } from 'three';

export const INFANTRY_ATTACHMENT_TRIANGLE_LIMIT: 200;
export function infantryAttachmentTriangles(geometry: BufferGeometry): number;
export function assertInfantryAttachmentBudget(geometry: BufferGeometry, label: string): BufferGeometry;
export function createInfantryWeaponGeometry(kind: string): BufferGeometry;
export function createInfantryPackGeometry(kind: string): BufferGeometry;
