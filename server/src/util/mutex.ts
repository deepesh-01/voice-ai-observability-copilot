/**
 * A minimal FIFO async mutex. `run(fn)` queues `fn` so that only ONE critical
 * section executes at a time — later callers wait for earlier ones to finish,
 * whether they resolve or reject. Used to serialize live agent writes so two
 * "Apply" requests can never PATCH the same agent in parallel.
 */
export interface Mutex {
  /** True while a critical section is currently executing. */
  isLocked(): boolean;
  /** Run `fn` once the queue ahead of it has drained; resolves/rejects with its result. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createMutex(): Mutex {
  // The tail of the queue: each new section chains off it, and we never let a
  // rejection break the chain (swallowed here; the caller still sees its own error).
  let tail: Promise<unknown> = Promise.resolve();
  let depth = 0;

  return {
    isLocked: () => depth > 0,
    run<T>(fn: () => Promise<T>): Promise<T> {
      depth += 1; // counts queued + running; reflected synchronously in isLocked()
      const result = tail.then(fn);
      // Advance the queue regardless of this section's outcome (a rejection here
      // must not wedge later callers).
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      // Decrement before the caller's await settles, so isLocked() is accurate the
      // instant `await run(...)` returns.
      return result.then(
        (value) => {
          depth -= 1;
          return value;
        },
        (err) => {
          depth -= 1;
          throw err;
        },
      );
    },
  };
}
