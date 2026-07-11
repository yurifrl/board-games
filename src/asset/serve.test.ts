import { expect, test } from "bun:test";
import sharp from "sharp";
import { buildAssetRoutes } from "./serve.ts";
import { buildIngestRoute } from "./ingest.ts";
import { AssetService } from "./service.ts";
import { InMemoryBlobStore } from "./store/memory.ts";
import { buildRenderers } from "./render/registry.ts";
import { sign } from "./auth.ts";
import type { AssetKey } from "./key.ts";

process.env.ASSETS_SIGNING_SECRET = "test-secret";
process.env.ASSET_TOKEN = "tok-123";

function setup() {
  const service = new AssetService(new InMemoryBlobStore(), new InMemoryBlobStore(), buildRenderers());
  return { service, serve: buildAssetRoutes(service), ingest: buildIngestRoute(service) };
}

async function jpeg(w = 800, h = 600): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: "red" } }).jpeg().toBuffer());
}

const coverKey: AssetKey = { entity: "g1", kind: "cover", source: "bgg", variant: "original", ext: "jpg" };

test("signed cover request resizes and serves 200", async () => {
  const { service, serve } = setup();
  await service.put(coverKey, { bytes: await jpeg(), contentType: "image/jpeg" });
  const q = sign(coverKey, { w: 300, h: 300 });
  const res = await serve.request(`http://x/asset/g1/cover/bgg/original.jpg?${q}`);
  expect(res.status).toBe(200);
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  expect([meta.width, meta.height]).toEqual([300, 300]);
});

test("unsigned cover request is 401", async () => {
  const { service, serve } = setup();
  await service.put(coverKey, { bytes: await jpeg(), contentType: "image/jpeg" });
  const res = await serve.request(`http://x/asset/g1/cover/bgg/original.jpg?w=300`);
  expect(res.status).toBe(401);
});

test("ingest requires the token, then stores + lists + serves the pdf", async () => {
  const { service, serve, ingest } = setup();
  const pdf = new Uint8Array([37, 80, 68, 70]); // %PDF

  const noAuth = await ingest.request("http://x/ingest/g1/rulebook", { method: "POST", body: pdf, headers: { "content-type": "application/pdf", "x-asset-name": "base.pdf" } });
  expect(noAuth.status).toBe(401);

  const ok = await ingest.request("http://x/ingest/g1/rulebook", {
    method: "POST",
    body: pdf,
    headers: { "content-type": "application/pdf", "x-asset-name": "base.pdf", authorization: "Bearer tok-123" },
  });
  expect(ok.status).toBe(201);
  expect(await ok.json()).toEqual({ stored: "g1/rulebook/hermes/base.pdf" });

  // agent lists it
  const list = await serve.request("http://x/agent/g1?kind=rulebook", { headers: { authorization: "Bearer tok-123" } });
  expect(list.status).toBe(200);
  const body = (await list.json()) as { assets: { path: string }[] };
  expect(body.assets.map((a) => a.path)).toEqual(["g1/rulebook/hermes/base.pdf"]);

  // agent fetches the bytes, unchanged (identity renderer for rulebook)
  const fetched = await serve.request("http://x/agent/g1/rulebook/hermes/base.pdf", { headers: { authorization: "Bearer tok-123" } });
  expect(fetched.status).toBe(200);
  expect(fetched.headers.get("content-type")).toBe("application/pdf");
  expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(pdf);
});

test("agent endpoints reject a missing/wrong token", async () => {
  const { serve } = setup();
  expect((await serve.request("http://x/agent/g1")).status).toBe(401);
  expect((await serve.request("http://x/agent/g1", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
});
