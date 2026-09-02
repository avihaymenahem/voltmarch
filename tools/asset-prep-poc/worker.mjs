import { runJob, buffersOf } from './geometry.mjs';
self.onmessage = async ({ data }) => {
  const { id, op, payload } = data;
  try {
    const result = op === 'echo' ? { echo: payload } : await runJob(payload);
    self.postMessage({ id, ...result }, buffersOf(result));
  } catch (error) {
    self.postMessage({ id, error: String(error.message) });
  }
};
self.postMessage({ ready: true });
