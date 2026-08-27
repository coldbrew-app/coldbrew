import { erro } from "@lebedevna/neverthrow-utils";
import type { Result } from "neverthrow";
import { describe, expect, it } from "vitest";

import { propagateError } from "./propagate-error.js";

describe("propagateError", () => {
  it("preserves the original Err instance while widening its success type", () => {
    const $source = erro({ type: "source error" });
    const $propagated: Result<string, { readonly type: "source error" }> = propagateError($source);

    expect($propagated).toBe($source);
  });
});
