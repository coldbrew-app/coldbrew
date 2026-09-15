import { AlertAssetIdSchema, AlertOverlayTokenSchema } from "@streambrew/packages/alerts.js";
import { parseJson, RequestError } from "@streambrew/packages/http.js";
import { logError } from "@streambrew/packages/server-logger.js";
import { z, type ZodType } from "zod";

import { getUserId } from "../api/_util.js";
import { env } from "../env.js";
import {
  BoundedRequestBodyError,
  readBoundedRequestBody,
  validateContentLength,
} from "../request-body.js";
import { donationAlertService, DonationAlertServiceError } from "./client.js";

const MEBIBYTE = 1024 * 1024;
const maxMediaRequestBytes = 256;
const maxStreamRequestBytes = 512;
const maxUploadRequestBytes = 11 * MEBIBYTE;
const uploadTimeoutMs = 45_000;
const maxConcurrentUploads = 1;
let activeUploads = 0;
const activeUploadUsers = new Set<number>();
const uploadRules = {
  image: {
    maxBytes: 4 * MEBIBYTE,
    contentTypes: new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]),
  },
  sound: {
    maxBytes: 10 * MEBIBYTE,
    contentTypes: new Set([
      "audio/mpeg",
      "audio/ogg",
      "audio/opus",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
    ]),
  },
} as const;

const StreamRequestSchema = z.object({
  token: AlertOverlayTokenSchema,
  playerId: z.uuid(),
  generation: z.int().positive(),
});

const MediaRequestSchema = z.object({
  token: AlertOverlayTokenSchema,
});

class AlertRequestBodyError extends Error {
  readonly status: number;

  constructor(status: number, options: ErrorOptions = {}) {
    super("Invalid alert request body.", options);
    this.name = "AlertRequestBodyError";
    this.status = status;
  }
}

function acquireUpload(userId: number) {
  if (activeUploads >= maxConcurrentUploads || activeUploadUsers.has(userId)) return null;
  activeUploads += 1;
  activeUploadUsers.add(userId);
  return () => {
    activeUploads -= 1;
    activeUploadUsers.delete(userId);
  };
}

function translateBodyError(error: unknown): never {
  if (!(error instanceof BoundedRequestBodyError)) throw error;
  const status = error.kind === "too-large" ? 413 : error.kind === "aborted" ? 408 : 400;
  throw new AlertRequestBodyError(status, { cause: error });
}

async function readBoundedMultipartForm(request: Request, maxBytes: number, signal: AbortSignal) {
  if (request.body === null) throw new AlertRequestBodyError(400);
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedRequestBody(request.body, maxBytes, signal);
  } catch (error) {
    translateBodyError(error);
  }

  try {
    return await new Response(body, { headers: request.headers }).formData();
  } catch (cause) {
    throw new AlertRequestBodyError(400, { cause });
  }
}

async function readBoundedJson<Output>(
  request: Request,
  maxBytes: number,
  schema: ZodType<Output>,
): Promise<Output> {
  try {
    validateContentLength(request, maxBytes, true);
  } catch (error) {
    translateBodyError(error);
  }
  if (request.body === null) throw new AlertRequestBodyError(400);

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedRequestBody(request.body, maxBytes);
  } catch (error) {
    translateBodyError(error);
  }

  try {
    return parseJson(new TextDecoder().decode(body), schema);
  } catch (cause) {
    if (cause instanceof RequestError) throw new AlertRequestBodyError(400, { cause });
    throw cause;
  }
}

function requestBodyErrorResponse(error: unknown, message: string) {
  if (error instanceof AlertRequestBodyError) {
    return Response.json({ error: message }, { status: error.status });
  }
  throw error;
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof DonationAlertServiceError) {
    const status =
      error.status !== undefined && error.status >= 400 && error.status < 500 ? error.status : 503;
    return Response.json({ error: fallback }, { status });
  }
  return Response.json({ error: fallback }, { status: 500 });
}

function streamJson(value: unknown) {
  return JSON.stringify(value, (_key, field: unknown) =>
    typeof field === "bigint" ? field.toString() : field,
  );
}

function rejectInvalidUploadBoundary(request: Request) {
  const requestOrigin = request.headers.get("origin");
  if (
    requestOrigin !== new URL(env.APP_DOMAIN).origin ||
    request.headers.get("x-streambrew-upload") !== "1"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return Response.json({ error: "Content length required" }, { status: 411 });
  }
  if (contentLength > maxUploadRequestBytes) {
    return Response.json({ error: "Upload too large" }, { status: 413 });
  }
  return null;
}

function createUploadOperation(request: Request) {
  const controller = new AbortController();
  const cancelFromRequest = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) cancelFromRequest();
  request.signal.addEventListener("abort", cancelFromRequest, { once: true });
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException("Upload timed out", "TimeoutError")),
    uploadTimeoutMs,
  );
  return {
    close() {
      globalThis.clearTimeout(timeout);
      request.signal.removeEventListener("abort", cancelFromRequest);
      controller.abort();
    },
    signal: controller.signal,
  };
}

function validateUploadForm(
  form: FormData,
): Response | { file: File; kind: keyof typeof uploadRules } {
  const kind = form.get("kind");
  const file = form.get("file");
  if (kind !== "image" && kind !== "sound") {
    return Response.json({ error: "Invalid upload" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "Invalid upload" }, { status: 400 });
  }
  const rule = uploadRules[kind];
  if (file.size === 0 || file.size > rule.maxBytes || !rule.contentTypes.has(file.type)) {
    return Response.json({ error: "Unsupported file" }, { status: 400 });
  }
  return { file, kind };
}

async function uploadAsset(
  userId: number,
  upload: { file: File; kind: keyof typeof uploadRules },
  signal: AbortSignal,
) {
  try {
    const contentBase64 = Buffer.from(await upload.file.arrayBuffer()).toString("base64");
    if (signal.aborted) return Response.json({ error: "Upload timed out" }, { status: 504 });
    const asset = await donationAlertService.uploadAsset(
      userId,
      upload.kind,
      upload.file.type,
      contentBase64,
      signal,
    );
    return Response.json(asset, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (signal.aborted) return Response.json({ error: "Upload timed out" }, { status: 504 });
    logError("Donation alert upload failed", error, { kind: upload.kind, userId });
    return errorResponse(error, "Upload failed");
  }
}

async function processUpload(request: Request, userId: number, signal: AbortSignal) {
  let form: FormData;
  try {
    form = await readBoundedMultipartForm(request, maxUploadRequestBytes, signal);
  } catch (error) {
    return requestBodyErrorResponse(error, "Invalid upload");
  }
  const upload = validateUploadForm(form);
  if (upload instanceof Response) return upload;
  return uploadAsset(userId, upload, signal);
}

export async function handleAlertUpload(request: Request) {
  const invalidBoundary = rejectInvalidUploadBoundary(request);
  if (invalidBoundary !== null) return invalidBoundary;
  const userId = await getUserId(request);
  if (userId === null) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const releaseUpload = acquireUpload(userId);
  if (releaseUpload === null) {
    return Response.json(
      { error: "Another upload is already being processed" },
      { headers: { "Retry-After": "2" }, status: 429 },
    );
  }

  const operation = createUploadOperation(request);
  try {
    return await processUpload(request, userId, operation.signal);
  } finally {
    operation.close();
    releaseUpload();
  }
}

async function getMediaPrincipal(request: Request) {
  if (request.method === "GET") {
    const userId = await getUserId(request);
    if (userId === null) return new Response("Unauthorized", { status: 401 });
    return { userId };
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { headers: { Allow: "GET, POST" }, status: 405 });
  }
  try {
    return await readBoundedJson(request, maxMediaRequestBytes, MediaRequestSchema);
  } catch (error) {
    return requestBodyErrorResponse(error, "Invalid media request");
  }
}

function mediaResponse(upstream: Response) {
  const headers = new Headers({
    "Accept-Ranges": upstream.headers.get("accept-ranges") ?? "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { headers, status: upstream.status });
}

async function proxyAlertMedia(
  request: Request,
  assetId: string,
  principal: { userId: number } | { token: string },
) {
  try {
    const upstream = await donationAlertService.asset(
      assetId,
      principal,
      request.headers.get("range") ?? undefined,
      request.signal,
    );
    return mediaResponse(upstream);
  } catch (error) {
    if (error instanceof DonationAlertServiceError && error.status === 404) {
      return new Response("Not found", { status: 404 });
    }
    logError("Donation alert media proxy failed", error, { assetId });
    return new Response("Media unavailable", { status: 503 });
  }
}

export async function handleAlertMedia(request: Request) {
  const pathPart = new URL(request.url).pathname.split("/").at(-1);
  const assetId = AlertAssetIdSchema.safeParse(pathPart);
  if (!assetId.success) return new Response("Not found", { status: 404 });
  const principal = await getMediaPrincipal(request);
  if (principal instanceof Response) return principal;
  return proxyAlertMedia(request, assetId.data, principal);
}

export async function handleAlertStream(request: Request) {
  let identity: z.infer<typeof StreamRequestSchema>;
  try {
    identity = await readBoundedJson(request, maxStreamRequestBytes, StreamRequestSchema);
  } catch (error) {
    return requestBodyErrorResponse(error, "Invalid stream request");
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of donationAlertService.streamOverlay(
          identity.token,
          identity.playerId,
          identity.generation,
          abort.signal,
        )) {
          controller.enqueue(encoder.encode(`${streamJson(event)}\n`));
        }
        controller.close();
      } catch (error) {
        if (!abort.signal.aborted) {
          logError("Donation alert stream failed", error, {
            generation: identity.generation,
            playerId: identity.playerId,
          });
          controller.error(error);
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
