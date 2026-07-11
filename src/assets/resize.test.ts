import { expect, test } from "bun:test";
import sharp from "sharp";
import { resize } from "./resize.ts";

async function source(): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buf);
}

test("cover-crop to exact WxH", async () => {
  const out = await resize(await source(), 300, 300);
  const meta = await sharp(out).metadata();
  expect(meta.width).toBe(300);
  expect(meta.height).toBe(300);
});

test("single dimension keeps aspect ratio", async () => {
  const out = await resize(await source(), 400);
  const meta = await sharp(out).metadata();
  expect(meta.width).toBe(400);
  expect(meta.height).toBe(300);
});
