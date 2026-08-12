import { describe, expectTypeOf, test } from "vitest";

import { fetchJson, HttpError, NetworkError } from "./fetch.js";
import { JsonParseError } from "./parseJson.js";

describe("fetchJson", { tags: ["unit"] }, () => {
  test("types", async () => {
    const res = await fetchJson("");
    const err = res._unsafeUnwrapErr();

    expectTypeOf<JsonParseError>().toExtend<typeof err>();
    expectTypeOf<NetworkError>().toExtend<typeof err>();
    expectTypeOf<HttpError>().toExtend<typeof err>();
  });
});
