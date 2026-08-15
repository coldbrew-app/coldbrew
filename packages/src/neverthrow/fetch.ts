import { createTaggedError } from "errore";
import { err, ok, ResultAsync, safeTry } from "neverthrow";

import { isInstanceof } from "../isInstanceof.js";
import { parseJson } from "./parseJson.js";

export class HttpError extends createTaggedError({
  name: "HttpError",
  message: "http status: $status",
}) {
  get isUnauthorized() {
    return this.status == 401;
  }
  get isTooManyRequests() {
    return this.status == 429;
  }
}

export class NetworkError extends createTaggedError({
  name: "NetworkError",
}) {
  constructor(cause: unknown) {
    const message = isInstanceof(cause, Error) ? cause.message : String(cause);
    super({ message, cause });
  }
}

function getText(response: Response) {
  return ResultAsync.fromPromise(response.text(), (e) => new NetworkError(e));
}

export function fetchText(input: RequestInfo | URL, init?: RequestInit) {
  return safeTry(async function* () {
    const res = yield* ResultAsync.fromPromise(fetch(input, init), (e) => new NetworkError(e));
    const text = yield* getText(res);
    if (!res.ok) return err(new HttpError({ status: res.status }));
    return ok(text);
  });
}

export function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  return fetchText(input, init).andThen((text) => parseJson(text));
}
