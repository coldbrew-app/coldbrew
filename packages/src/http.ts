import { z } from "zod";

export type RequestErrorType = "fetch error" | "http error" | "invalid json" | "validation error";

export class RequestError extends Error {
  readonly type: RequestErrorType;
  readonly status?: number;
  readonly body?: string;

  constructor(
    type: RequestErrorType,
    message: string,
    options: ErrorOptions & { status?: number; body?: string } = {},
  ) {
    super(message, options);
    this.name = "RequestError";
    this.type = type;
    this.status = options.status;
    this.body = options.body;
  }
}

export async function requestText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    throw new RequestError("fetch error", "Request failed before receiving a response.", {
      cause,
    });
  }

  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    throw new RequestError("fetch error", "Could not read the response body.", {
      cause,
      status: response.status,
    });
  }

  if (!response.ok) {
    throw new RequestError("http error", `Request returned HTTP ${response.status}.`, {
      status: response.status,
      body,
    });
  }

  return body;
}

export function parseJson<Output>(body: string, schema: z.ZodType<Output>): Output {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (cause) {
    throw new RequestError("invalid json", "Response body is not valid JSON.", { cause, body });
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new RequestError("validation error", "Response body does not match its schema.", {
      cause: result.error,
      body,
    });
  }

  return result.data;
}

export async function requestJson<Output>(
  input: RequestInfo | URL,
  schema: z.ZodType<Output>,
  init?: RequestInit,
): Promise<Output> {
  return parseJson(await requestText(input, init), schema);
}
