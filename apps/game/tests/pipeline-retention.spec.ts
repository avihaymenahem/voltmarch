import { describe, expect, it, vi } from 'vitest';
import {
  installPersistentPipelineCache,
  markBattlefieldPipelinesWarm,
  pipelineCacheStats,
} from '../src/render/pipeline-retention';

function fakeRenderer() {
  const pipeline = { id: 'pipeline' };
  const vertex = { id: 'vertex' };
  const fragment = { id: 'fragment' };
  const compute = { id: 'compute' };
  const releasePipeline = vi.fn();
  const releaseProgram = vi.fn();
  return {
    renderer: {
      _pipelines: {
        caches: new Map([['p', pipeline]]),
        programs: {
          vertex: new Map([['v', vertex]]),
          fragment: new Map([['f', fragment]]),
          compute: new Map([['c', compute]]),
        },
        _releasePipeline: releasePipeline,
        _releaseProgram: releaseProgram,
      },
    },
    pipeline,
    vertex,
    releasePipeline,
    releaseProgram,
  };
}

describe('process-lifetime WebGPU pipeline retention', () => {
  it('refuses an unknown Three.js internal shape', () => {
    expect(installPersistentPipelineCache({})).toBe(false);
    expect(installPersistentPipelineCache({ _pipelines: { caches: new Map() } })).toBe(false);
  });

  it('keeps pipelines and shader programs when render objects are disposed', () => {
    const f = fakeRenderer();
    expect(installPersistentPipelineCache(f.renderer)).toBe(true);

    f.renderer._pipelines._releasePipeline(f.pipeline);
    f.renderer._pipelines._releaseProgram(f.vertex);

    expect(f.releasePipeline).not.toHaveBeenCalled();
    expect(f.releaseProgram).not.toHaveBeenCalled();
    expect(f.renderer._pipelines.caches.size).toBe(1);
    expect(f.renderer._pipelines.programs.vertex.size).toBe(1);
  });

  it('is idempotent and reports bounded cache counts', () => {
    const f = fakeRenderer();
    expect(installPersistentPipelineCache(f.renderer)).toBe(true);
    const retainedRelease = f.renderer._pipelines._releasePipeline;
    expect(installPersistentPipelineCache(f.renderer)).toBe(true);
    expect(f.renderer._pipelines._releasePipeline).toBe(retainedRelease);

    expect(pipelineCacheStats(f.renderer)).toEqual({
      retained: true,
      battlefieldWarm: false,
      pipelines: 1,
      vertexPrograms: 1,
      fragmentPrograms: 1,
      computePrograms: 1,
    });

    markBattlefieldPipelinesWarm(f.renderer);
    expect(pipelineCacheStats(f.renderer).battlefieldWarm).toBe(true);
  });
});
