/**
 * Map work concurrently without the memory/network spike of an unbounded
 * `Promise.all`. Results preserve input order and the first rejection aborts
 * the caller, matching normal `Promise.all` semantics.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, received ${concurrency}`);
  }
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index], index);
    }
  };

  const count = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}
