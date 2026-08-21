import { erro } from "@lebedevna/neverthrow-utils";
import { ok, safeTry } from "neverthrow";

export function divide(a: number, b: number) {
  return safeTry(function* () {
    const res = a / b;

    if (isNaN(res) || !Number.isFinite(res)) {
      return erro({ type: "division error", a, b, result: res });
    }

    return ok(res);
  });
}
