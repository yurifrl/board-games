import { expect, test } from "bun:test";
import { picIdFromUrl } from "./bgg.ts";

test("extracts pic id from a geekdo grid URL", () => {
  const url = "https://cf.geekdo-images.com/nC6i__small/img/x=/fit-in/200x150/filters:strip_icc()/pic8907965.jpg";
  expect(picIdFromUrl(url)).toBe("8907965");
});

test("returns null when no pic id present", () => {
  expect(picIdFromUrl("https://example.com/image.jpg")).toBeNull();
});
