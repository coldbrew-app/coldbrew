import { err } from "neverthrow";
import { Simplify } from "type-fest";

const fmtErr = <const T extends { type: string }>(
  error: T,
): Simplify<T & { toString(): string }> => ({
  ...error,
  toString() {
    return JSON.stringify(this, null, 2);
  },
});

export const erro = <const T extends { type: string }>(error: T) => err(fmtErr(error));

erro.fmt = fmtErr;
