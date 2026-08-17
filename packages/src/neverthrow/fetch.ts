import { ok, ResultAsync, safeTry } from "neverthrow";

import { erro } from "../erro.js";
import { parseJson } from "./parseJson.js";

export function fetchText(input: RequestInfo | URL, init?: RequestInit) {
  return safeTry(async function* () {
    const res = yield* ResultAsync.fromPromise(fetch(input, init), (e) =>
      erro.fmt({ type: "fetch error", cause: e }),
    );
    const text = yield* ResultAsync.fromPromise(res.text(), (e) =>
      erro.fmt({ type: "fetch error", cause: e }),
    );
    if (!res.ok) {
      return erro({
        type: "http error",
        statusCode: res.status,
        get status() {
          switch (this.statusCode) {
            case 401:
              return "unauthorized";
            case 429:
              return "too many requests";
            default:
              return "other";
          }
        },
      });
    }
    return ok(text);
  });
}

export function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  return fetchText(input, init).andThen((text) => parseJson(text));
}
