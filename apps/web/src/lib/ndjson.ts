type NdjsonStreamOptions = {
  maximumLineLength: number;
  readError: (cause: unknown) => Error;
  lineTooLongError: () => Error;
};

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  readError: NdjsonStreamOptions["readError"],
) {
  try {
    return await reader.read();
  } catch (cause) {
    if (signal.aborted) return null;
    throw readError(cause);
  }
}

function completeLines(buffer: string) {
  const lines = buffer.split("\n");
  return { lines: lines.slice(0, -1), remainder: lines.at(-1) ?? "" };
}

function assertLineLength(line: string, options: NdjsonStreamOptions) {
  if (line.length > options.maximumLineLength) throw options.lineTooLongError();
}

export async function* readNdjsonLines(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  options: NdjsonStreamOptions,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await readChunk(reader, signal, options.readError);
      if (chunk === null) return;

      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const { lines, remainder } = completeLines(buffer);
      buffer = remainder;
      for (const line of lines) {
        assertLineLength(line, options);
        if (line.trim().length > 0) yield line;
      }
      assertLineLength(buffer, options);
      if (!chunk.done) continue;
      if (buffer.trim().length > 0) yield buffer;
      return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
