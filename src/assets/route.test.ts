import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildAssetsRoute } from "./route.ts";
import { AssetStore } from "./store.ts";
import { GcsStore, type GcsBucketLike } from "./gcs.ts";
import { sign } from "./signing.ts";

process.env.ASSETS_SIGNING_SECRET = "test-secret";

function fakeBucket(seed: Record<string, Buffer> = {}): GcsBucketLike {
  const blobs = new Map(Object.entries(seed));
  return {
    file(key: string) {
      return {
        async exists(): Promise<[boolean]> { return [blobs.has(key)]; },
        async download(): Promise<[Buffer]> { return [blobs.get(key)!]; },
        async save(data: Buffer | Uint8Array) { blobs.set(key, Buffer.from(data)); },
        async getMetadata(): Promise<[{ metadata?: Record<string, string> }]> { return [{}]; },
      };
    },
  };
}

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: "blue" } }).jpeg().toBuffer();
}

async function build(seed: Record<string, Buffer> = {}, fillable = new Set<string>()) {
  const root = await mkdtemp(join(tmpdir(), "route-"));
  return buildAssetsRoute({
    store: new AssetStore(root),
    gcs: new GcsStore(undefined, fakeBucket(seed)),
    isFillable: (id) => fillable.has(id),
  });
}

const url = (id: string, w?: number, h?: number) => `http://x/${id}?${sign({ id, w, h })}`;

test("401 without valid signature", async () => {
  const app = await build();
  expect((await app.request("http://x/uuid-1?w=100")).status).toBe(401);
});

test("resizes GCS original and serves 200", async () => {
  const app = await build({ "uuid-1/original.jpg": await jpeg() });
  const res = await app.request(url("uuid-1", 300, 300));
  expect(res.status).toBe(200);
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  expect(meta.width).toBe(300);
  expect(meta.height).toBe(300);
});

test("202 when fillable but not in GCS", async () => {
  const app = await build({}, new Set(["uuid-1"]));
  expect((await app.request(url("uuid-1", 300))).status).toBe(202);
});

test("404 when not fillable", async () => {
  const app = await build({}, new Set());
  expect((await app.request(url("uuid-1", 300))).status).toBe(404);
});
