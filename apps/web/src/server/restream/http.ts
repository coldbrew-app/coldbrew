import { timingSafeEqual } from "node:crypto";

import {
  RestreamMediaAuthorizeResponseSchema,
  RestreamMediaRequestSchema,
} from "@streambrew/packages/restream.js";

import { env } from "../env.js";
import {
  BoundedRequestBodyError,
  readBoundedRequestBody,
  validateContentLength,
} from "../request-body.js";
import { restreamStore } from "./index.js";

const MAX_REQUEST_BYTES = 16 * 1024;

function hasValidAuthorization(request: Request) {
  const provided = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.RESTREAM_MEDIA_SHARED_SECRET}`;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

async function parseRequest(request: Request) {
  validateContentLength(request, MAX_REQUEST_BYTES, true);
  if (request.body === null) throw new BoundedRequestBodyError("invalid");
  const body = await readBoundedRequestBody(request.body, MAX_REQUEST_BYTES, request.signal);
  try {
    return RestreamMediaRequestSchema.parse(JSON.parse(new TextDecoder().decode(body)));
  } catch (cause) {
    throw new BoundedRequestBodyError("invalid", { cause });
  }
}

export async function handleRestreamMedia(request: Request) {
  if (!hasValidAuthorization(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: ReturnType<typeof RestreamMediaRequestSchema.parse>;
  try {
    input = await parseRequest(request);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      return Response.json(
        { error: "Invalid request" },
        { status: error.kind === "too-large" ? 413 : 400 },
      );
    }
    throw error;
  }

  if (input.type === "authorize") {
    const result = await restreamStore.authorizePublisher(
      input.nodeId,
      input.publisherId,
      input.path,
    );
    if (result === null) {
      return Response.json({ error: "Publisher is not authorized" }, { status: 403 });
    }
    return Response.json(RestreamMediaAuthorizeResponseSchema.parse(result));
  }

  const found =
    input.type === "heartbeat"
      ? await restreamStore.heartbeat(input.nodeId, input.sessionId, input.destinations)
      : await restreamStore.endSession(input.nodeId, input.sessionId);
  return found
    ? new Response(null, { status: 204 })
    : Response.json({ error: "Restream session not found" }, { status: 404 });
}
