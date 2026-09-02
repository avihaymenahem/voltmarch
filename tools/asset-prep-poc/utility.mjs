import { runJob } from './geometry.mjs';
process.parentPort.once('message', ({ ports }) => {
  const port = ports[0];
  port.on('message', async ({ data }) => {
    if (!data || typeof data.id !== 'number') { port.postMessage({ fatal: 'Invalid native message envelope' }); return; }
    const { id, op, payload } = data;
    try {
      const result = op === 'echo' ? { echo: payload } : await runJob(payload);
      // MessagePortMain transfers ports only. Typed-array results are CLONED here.
      port.postMessage({ id, ...result, memory: process.memoryUsage() });
    } catch (error) {
      port.postMessage({ id, error: String(error.message) });
    }
  });
  port.start();
  port.postMessage({ ready: true });
});
