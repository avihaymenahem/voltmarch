/**
 * GPU pass timing seam.
 *
 * The concrete timers live with the performance HUD because that module owns
 * the WebGL extension and Three's WebGPU timestamp resolver. Render code only
 * needs these allocation-free begin/end calls. Keeping the seam structural
 * also preserves the WebGPU bundle split: this file imports no Three module.
 */

export const GPU_PASS_IDS = [
  'total',
  'shadow',
  'scene',
  'water',
  'particles',
  'ao',
  'gi',
  'bloom',
  'grade',
  'smaa',
  // DOM compositing is outside the renderer device; this stays null by design.
  'ui',
] as const;

export type GpuPassId = (typeof GPU_PASS_IDS)[number];

export const GPU_PASS_COUNT = GPU_PASS_IDS.length;

export function gpuPassIndex(id: GpuPassId): number {
  switch (id) {
    case 'total': return 0;
    case 'shadow': return 1;
    case 'scene': return 2;
    case 'water': return 3;
    case 'particles': return 4;
    case 'ao': return 5;
    case 'gi': return 6;
    case 'bloom': return 7;
    case 'grade': return 8;
    case 'smaa': return 9;
    case 'ui': return 10;
  }
}

/** Live, reused snapshot. Null means the pass has not produced a query yet. */
export interface GpuPassSnapshot {
  readonly revision: number;
  readonly values: ReadonlyArray<number | null>;
}

export interface GpuPassTimerSink {
  beginPass(id: GpuPassId): void;
  endPass(id: GpuPassId): void;
  readonly passSnapshot: GpuPassSnapshot;
}

let sink: GpuPassTimerSink | null = null;

/** Install the one live timer. Returns a disposer that cannot clear a successor. */
export function installGpuPassTimer(next: GpuPassTimerSink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

export function beginGpuPass(id: GpuPassId): void {
  sink?.beginPass(id);
}

export function endGpuPass(id: GpuPassId): void {
  sink?.endPass(id);
}

export function gpuPassSnapshot(): GpuPassSnapshot | null {
  return sink?.passSnapshot ?? null;
}

/** A compact recommendation; policy remains in adaptive-res.system.ts. */
export type GpuBottleneck =
  | 'unknown' | 'shadow' | 'ao' | 'water' | 'particles' | 'fill-rate' | 'scene';

/**
 * Classify only when a pass materially dominates the measured frame. A stale
 * or partial snapshot returns unknown instead of steering quality from a guess.
 */
export function classifyGpuBottleneck(snapshot: GpuPassSnapshot | null): GpuBottleneck {
  if (snapshot === null) return 'unknown';
  const total = snapshot.values[gpuPassIndex('total')];
  if (total === null || total <= 0) return 'unknown';

  const shadow = snapshot.values[gpuPassIndex('shadow')] ?? 0;
  const ao = snapshot.values[gpuPassIndex('ao')] ?? 0;
  const gi = snapshot.values[gpuPassIndex('gi')] ?? 0;
  const bloom = snapshot.values[gpuPassIndex('bloom')] ?? 0;
  const grade = snapshot.values[gpuPassIndex('grade')] ?? 0;
  const smaa = snapshot.values[gpuPassIndex('smaa')] ?? 0;
  const scene = snapshot.values[gpuPassIndex('scene')] ?? 0;
  const water = snapshot.values[gpuPassIndex('water')] ?? 0;
  const particles = snapshot.values[gpuPassIndex('particles')] ?? 0;
  if (shadow === 0 && ao === 0 && gi === 0 && bloom === 0 && grade === 0 && smaa === 0 && scene === 0 && water === 0 && particles === 0) {
    return 'unknown';
  }

  if (shadow / total >= 0.30) return 'shadow';
  if (ao / total >= 0.22) return 'ao';
  // SSGI is an opt-in full-screen experiment with fixed ray counts. Resolution
  // is its safe adaptive lever; GTAO's sample-count lever does not control it.
  if (gi / total >= 0.22) return 'fill-rate';
  if (water / total >= 0.22) return 'water';
  if (particles / total >= 0.22) return 'particles';
  if ((bloom + grade + smaa) / total >= 0.30) return 'fill-rate';
  if (scene / total >= 0.45) return 'scene';
  return 'fill-rate';
}
