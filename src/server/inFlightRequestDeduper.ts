export type InFlightRequestResult<T> = {
  promise: Promise<T>;
  reused: boolean;
};

/**
 * Deduplicate identical work while it is still in flight.
 *
 * The entry is removed as soon as the shared promise settles, so a later
 * explicit user action can start fresh work. This is intentionally an
 * in-memory concurrency guard, not a persistent cache.
 */
export function createInFlightRequestDeduper<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    getOrRun(key: string, task: () => Promise<T>): InFlightRequestResult<T> {
      const existing = inFlight.get(key);
      if (existing) return { promise: existing, reused: true };

      // Invoke the task immediately so callers observe that the work has
      // started before getOrRun returns. Convert a synchronous throw into a
      // rejected promise so cleanup still follows the same path.
      const taskPromise = (() => {
        try {
          return task();
        } catch (error) {
          return Promise.reject(error);
        }
      })();
      const promise = taskPromise.finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return { promise, reused: false };
    },
  };
}
