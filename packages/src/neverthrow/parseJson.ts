import { ok, safeTry } from "neverthrow";

import { erro } from "../erro.js";

export function parseJson(source: string) {
  return safeTry(function* () {
    try {
      return ok(JSON.parse(source));
    } catch (error) {
      return erro({ type: "invalid json", source });
    }
  });
}
