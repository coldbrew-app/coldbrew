import { createTaggedError } from "errore";
import { err, ok, Result } from "neverthrow";

export class DivisionError extends createTaggedError({
  name: "DivisionError",
  message: "division error: $a / $b = $result",
}) {}

export function divide(a: number, b: number): Result<number, DivisionError> {
  const res = a / b;

  if (isNaN(res) || !Number.isFinite(res)) {
    return err(new DivisionError({ a, b, result: res }));
  }

  return ok(res);
}
