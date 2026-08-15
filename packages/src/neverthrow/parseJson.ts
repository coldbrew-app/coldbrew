import { createTaggedError } from "errore";
import { err, ok, Result } from "neverthrow";

export class JsonParseError extends createTaggedError({
  name: "JsonParseError",
  message: "Invalid JSON:\n$source",
}) {}

export function parseJson(source: string): Result<unknown, JsonParseError> {
  try {
    return ok(JSON.parse(source));
  } catch (error) {
    return err(new JsonParseError({ source }));
  }
}
