import { describe, expect, it } from 'vitest';
import { observePipelineCompile } from '../src/render/pipeline-profile';

function fakeRenderer() {
  const objectData = new WeakMap<object, { nodeBuilderState?: unknown }>();
  const nodeBuilderCache = new Map<unknown, unknown>();
  const nodes = {
    nodeBuilderCache,
    get(object: object) {
      let data = objectData.get(object);
      if (data === undefined) {
        data = {};
        objectData.set(object, data);
      }
      return data;
    },
    getForRenderCacheKey(object: object) { return object; },
    async getForRenderAsync(object: object) {
      const state = {};
      this.get(object).nodeBuilderState = state;
      this.nodeBuilderCache.set(object, state);
      return state;
    },
  };
  const pipelines = {
    caches: new Map<unknown, unknown>(),
    programs: {
      vertex: new Map<unknown, unknown>(),
      fragment: new Map<unknown, unknown>(),
    },
    getForRender(object: object, promises: Promise<unknown>[] | null = null) {
      this.caches.set(object, {});
      this.programs.vertex.set(object, {});
      this.programs.fragment.set(object, {});
      promises?.push(Promise.resolve());
      return {};
    },
  };
  return { renderer: { _nodes: nodes, _pipelines: pipelines }, nodes, pipelines };
}

describe('opt-in WebGPU pipeline attribution', () => {
  it('is inert when profiling is disabled', () => {
    const fixture = fakeRenderer();
    const originalNode = fixture.nodes.getForRenderAsync;
    const result = observePipelineCompile(fixture.renderer, false).finish();
    expect(result.enabled).toBe(false);
    expect(fixture.nodes.getForRenderAsync).toBe(originalNode);
  });

  it('counts cache misses, programs and GPU promises then restores Three internals', async () => {
    const fixture = fakeRenderer();
    const originalNode = fixture.nodes.getForRenderAsync;
    const originalPipeline = fixture.pipelines.getForRender;
    const observer = observePipelineCompile(fixture.renderer, true);
    const renderObject = { material: { name: 'terrain' } };

    await fixture.nodes.getForRenderAsync(renderObject);
    const promises: Promise<unknown>[] = [];
    fixture.pipelines.getForRender(renderObject, promises);
    await Promise.all(promises);

    const result = observer.finish();
    expect(result).toMatchObject({
      enabled: true,
      supported: true,
      nodeCalls: 1,
      nodeCacheHits: 0,
      nodeCacheMisses: 1,
      pipelineCalls: 1,
      newPipelines: 1,
      newVertexPrograms: 1,
      newFragmentPrograms: 1,
      gpuPromises: 1,
      topFamilies: 'terrain:1/1',
    });
    expect(fixture.nodes.getForRenderAsync).toBe(originalNode);
    expect(fixture.pipelines.getForRender).toBe(originalPipeline);
    expect(observer.finish()).toEqual(result);
  });

  it('reports a cache hit without manufacturing another pipeline', async () => {
    const fixture = fakeRenderer();
    const renderObject = { material: { type: 'MeshStandardNodeMaterial' } };
    await fixture.nodes.getForRenderAsync(renderObject);
    fixture.pipelines.caches.set(renderObject, {});
    fixture.pipelines.getForRender = () => ({});

    const observer = observePipelineCompile(fixture.renderer, true);
    await fixture.nodes.getForRenderAsync(renderObject);
    fixture.pipelines.getForRender(renderObject, []);
    const result = observer.finish();
    expect(result.nodeCacheHits).toBe(1);
    expect(result.newPipelines).toBe(0);
  });
});
