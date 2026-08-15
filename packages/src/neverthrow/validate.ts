import { createTaggedError } from "errore";
import { err, ok, Result } from "neverthrow";
import { ZodType } from "zod";

export class ValidationError extends createTaggedError({
  name: "ValidationError",
  message: "$_message\n$_stack\n\nsource: $input",
}) {}

export function validate<T>(schema: ZodType<T>, value: unknown): Result<T, ValidationError> {
  const res = schema.safeParse(value);
  return res.success
    ? ok(res.data)
    : err(
        new ValidationError({
          _message: "validation error",
          input: JSON.stringify(value, null, 2),
          _stack: res.error.stack ?? "",
        }),
      );
}
