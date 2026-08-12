import { createTaggedError } from "errore";
import { err, ok, ResultAsync } from "neverthrow";

import { isInstanceof } from "../isInstanceof.js";
import { parseJson } from "./parseJson.js";

export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  TOO_MANY_REQUESTS: 429,
};

export class HttpError extends createTaggedError({
  name: "HttpError",
  message: "http status: $status",
}) {}

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
  return ResultAsync.fromPromise(fetch(input, init), (e) => new NetworkError(e)).andThen((res) =>
    getText(res).andThen((text) => {
      if (!res.ok) return err(new HttpError({ status: res.status }));
      return ok(text);
    }),
  );
}

export function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  return fetchText(input, init).andThen((text) => parseJson(text));
}
