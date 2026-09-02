import { assert, describe, expect, expectTypeOf, it } from "vitest";

import { isInstanceof } from "./isInstanceof.js";

class Error1 extends Error {
  override readonly name = "Error1";
}

class Error2 extends Error {
  override readonly name = "Error2";
}

class Error3 extends Error {
  override readonly name = "Error3";
}

describe("isInstanceOf", { tags: ["unit"] }, () => {
  const b = ((): Error1 | Error2 => new Error1("error 1"))();

  it("works", () => {
    assert(!isInstanceof(b, Error2));
    assert(isInstanceof(b, Error1));
    expectTypeOf(b).toExtend<Error>();
    expectTypeOf(b).toEqualTypeOf<Error1>();
    expect(b).toBeInstanceOf(Error1);

    // @ts-expect-error
    isInstanceof(b, Error3);
  });

  it("handles array", () => {
    expect(isInstanceof(b, [Error1, Error2])).toBe(true);
  });
});
