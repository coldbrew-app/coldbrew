export function createAbortableStream<T>(
  open: (signal: AbortSignal) => AsyncIterable<T>,
  parentSignal?: AbortSignal,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const controller = new AbortController();
      const signal = parentSignal
        ? AbortSignal.any([parentSignal, controller.signal])
        : controller.signal;
      const iterator = open(signal)[Symbol.asyncIterator]();
      let returning: Promise<IteratorResult<T>> | undefined;

      return {
        async next() {
          let resolved = false;
          try {
            const result = await iterator.next();
            resolved = true;
            if (result.done === true) {
              controller.abort();
            }
            return result;
          } finally {
            if (!resolved) {
              controller.abort();
            }
          }
        },
        return() {
          if (returning) {
            return returning;
          }
          controller.abort();
          returning = iterator.return
            ? iterator.return()
            : Promise.resolve({ done: true, value: undefined });
          return returning;
        },
      };
    },
  };
}
