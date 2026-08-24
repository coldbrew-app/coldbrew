import { describe, expect, test } from "vitest";

import { getPaginationItems } from "./page-pagination";

describe("getPaginationItems", () => {
  test("returns every page for short ranges", () => {
    expect(getPaginationItems(1, 0)).toEqual([]);
    expect(getPaginationItems(2, 4)).toEqual([1, 2, 3, 4]);
  });

  test("condenses a long range around the first page", () => {
    expect(getPaginationItems(1, 12)).toEqual([1, 2, "ellipsis", 12]);
  });

  test("condenses a long range around a middle page", () => {
    expect(getPaginationItems(6, 12)).toEqual([1, "ellipsis", 5, 6, 7, "ellipsis", 12]);
  });

  test("condenses a long range around the last page", () => {
    expect(getPaginationItems(12, 12)).toEqual([1, "ellipsis", 11, 12]);
  });
});
