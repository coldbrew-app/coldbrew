export class BoundedRequestBodyError extends Error {
  readonly kind: "aborted" | "invalid" | "too-large";

  constructor(kind: "aborted" | "invalid" | "too-large", options: ErrorOptions = {}) {
    super("Invalid request body.", options);
    this.name = "BoundedRequestBodyError";
    this.kind = kind;
  }
}

export function validateContentLength(
  request: Request,
  maxBytes: number,
  requirePositive: boolean,
) {
  const header = request.headers.get("content-length");
  if (header === null) return;

  if (!/^\d+$/.test(header)) throw new BoundedRequestBodyError("invalid");
  const length = Number(header);
  if (!Number.isSafeInteger(length) || (requirePositive && length <= 0)) {
    throw new BoundedRequestBodyError("invalid");
  }
  if (length > maxBytes) throw new BoundedRequestBodyError("too-large");
}

function joinChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(new ArrayBuffer(totalBytes));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedRequestBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancel = () => void reader.cancel(signal?.reason).catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    while (true) {
      if (signal?.aborted) throw new BoundedRequestBodyError("aborted");
      const chunk = await reader.read();
      if (signal?.aborted) throw new BoundedRequestBodyError("aborted");
      if (chunk.done) return joinChunks(chunks, totalBytes);
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedRequestBodyError("too-large");
      }
      chunks.push(chunk.value);
    }
  } catch (cause) {
    if (cause instanceof BoundedRequestBodyError) throw cause;
    throw new BoundedRequestBodyError(signal?.aborted ? "aborted" : "invalid", { cause });
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
