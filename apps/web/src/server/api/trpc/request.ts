import {
  BoundedRequestBodyError,
  readBoundedRequestBody,
  validateContentLength,
} from "../../request-body.js";

const maxTrpcRequestBytes = 1024 * 1024;

function requestError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function boundTrpcRequest(request: Request): Promise<Request | Response> {
  if (request.method !== "POST") return request;

  try {
    validateContentLength(request, maxTrpcRequestBytes, false);
  } catch (error) {
    if (!(error instanceof BoundedRequestBodyError)) throw error;
    return error.kind === "too-large"
      ? requestError("Request too large", 413)
      : requestError("Invalid content length", 400);
  }
  if (request.body === null) return request;

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedRequestBody(request.body, maxTrpcRequestBytes);
  } catch (error) {
    if (!(error instanceof BoundedRequestBodyError)) throw error;
    return error.kind === "too-large"
      ? requestError("Request too large", 413)
      : requestError("Invalid request body", 400);
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, { body, headers, method: "POST" });
}
