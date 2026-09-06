import { expect, test } from "bun:test";
import { signedDisplay, signedSpine } from "./views.tsx";

test("signedDisplay embeds the promotion version when provided", () => {
  const url = signedDisplay("clank", "front", 400, undefined, 1725500000000);
  expect(url).toMatch(/^\/asset\/clank\/display\/front\/latest\.png\?w=400&sig=[0-9a-f]{64}&v=1725500000000$/);
});

test("signedDisplay omits v when no version is known — URL stays stable", () => {
  const url = signedDisplay("clank", "front", 400);
  expect(url).toMatch(/^\/asset\/clank\/display\/front\/latest\.png\?w=400&sig=[0-9a-f]{64}$/);
  expect(signedDisplay("clank", "front")).toBe(signedDisplay("clank", "front"));
});

test("signedSpine reads the module version map (empty by default)", () => {
  expect(signedSpine("clank")).toMatch(/^\/asset\/clank\/display\/spine\/latest\.png\?w=208&h=628&sig=[0-9a-f]{64}$/);
});
