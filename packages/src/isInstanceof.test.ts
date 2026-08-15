import { createTaggedError } from "errore";
import { describe, expect, expectTypeOf, it } from "vitest";

import { isInstanceof } from "./isInstanceof.js";

class Error1 extends createTaggedError({
  name: "Error1",
}) {}

class Error2 extends createTaggedError({
  name: "Error2",
}) {}

class Error3 extends createTaggedError({
  name: "Error3",
}) {}

describe("isInstanceOf", { tags: ["unit"] }, () => {
  const b: Error1 | Error2 = new Error1({ message: "error 1" }) as any;

  it("works", () => {
    if (isInstanceof(b, Error1)) {
      expectTypeOf(b).toEqualTypeOf<Error1>();
      expect(b).toBeInstanceOf(Error1);
    }

    if (isInstanceof(b, Error2)) {
      expectTypeOf(b).toEqualTypeOf<Error2>();
      expect(b).not.toBeInstanceOf(Error2);
    }

    // @ts-expect-error
    if (isInstanceof(b, Error3)) {
      // @ts-expect-error
      expectTypeOf(b).toEqualTypeOf<Error3>();
      expect(b).not.toBeInstanceOf(Error3);
    }
  });

  it("handles array", () => {
    expect(isInstanceof(b, [Error1, Error2])).toBe(true);
  });
});
