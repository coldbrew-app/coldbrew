import type { Err } from "neverthrow";

export function propagateError<E>($error: Err<unknown, E>): Err<never, E> {
  return $error as Err<never, E>;
}
