import { ok, safeTry } from "neverthrow";

import { erro } from "../erro.js";

export function divide(a: number, b: number) {
  return safeTry(function* () {
    const res = a / b;

    if (isNaN(res) || !Number.isFinite(res)) {
      return erro({ type: "division error", a, b, result: res });
    }

    return ok(res);
  });
}
