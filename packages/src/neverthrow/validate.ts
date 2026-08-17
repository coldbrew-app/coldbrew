import { ok, safeTry } from "neverthrow";
import { ZodType } from "zod";

import { erro } from "../erro.js";

export type ValidationError = {
  type: "validation error";
  input: string;
  stack: string;
};

export function validate<T>(schema: ZodType<T>, value: unknown) {
  return safeTry(function* () {
    const res = schema.safeParse(value);

    if (!res.success) {
      return erro<ValidationError>({
        type: "validation error",
        input: JSON.stringify(value, null, 2),
        stack: res.error.stack ?? "",
      });
    }

    return ok(res.data);
  });
}
