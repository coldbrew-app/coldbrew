export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiting: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(value: T) {
    if (this.closed) return;
    const resolve = this.waiting.shift();
    if (resolve) resolve({ done: false, value });
    else this.values.push(value);
  }

  close() {
    this.closed = true;
    for (const resolve of this.waiting.splice(0)) resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.closed) return { done: true, value: undefined };
        return await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
      },
    };
  }
}
