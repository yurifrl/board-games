import { expect, test } from "bun:test";
import { sign, verify } from "./signing.ts";

process.env.ASSETS_SIGNING_SECRET = "test-secret";

test("sign -> verify round-trip", () => {
  const q = new URLSearchParams(sign({ id: "uuid-1", w: 300, h: 300 }));
  expect(verify("uuid-1", q)).toBe(true);
});

test("tampered params fail", () => {
  const q = new URLSearchParams(sign({ id: "uuid-1", w: 300, h: 300 }));
  q.set("w", "9999");
  expect(verify("uuid-1", q)).toBe(false);
});

test("wrong id fails", () => {
  const q = new URLSearchParams(sign({ id: "uuid-1", w: 300 }));
  expect(verify("uuid-2", q)).toBe(false);
});

test("expired signature fails", () => {
  const q = new URLSearchParams(sign({ id: "uuid-1", w: 300 }, -1));
  expect(verify("uuid-1", q)).toBe(false);
});

test("source is part of the signature", () => {
  const q = new URLSearchParams(sign({ id: "uuid-1", source: "bgg", w: 300 }));
  expect(verify("uuid-1", q)).toBe(true);
  q.set("source", "ludopedia"); // tampering the source invalidates it
  expect(verify("uuid-1", q)).toBe(false);
});
