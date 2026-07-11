import { expect, test } from "bun:test";
import { runPipeline } from "./pipeline.ts";
import { AssetService } from "./service.ts";
import { InMemoryBlobStore } from "./store/memory.ts";
import { SourceUnavailableError, type AssetSource, type Entity } from "./types.ts";

const entity: Entity = { id: "g1", name: "G1" };

/** A source with a controllable fingerprint and fetch counter. */
function source(id: string, fingerprint: string): AssetSource & { fetches: number } {
  const s = {
    id,
    kind: "cover",
    priority: 10,
    fetches: 0,
    async discover(e: Entity) {
      return [
        {
          key: { entity: e.id, kind: "cover", source: id, variant: "original", ext: "jpg" },
          fingerprint,
          fetch: async () => {
            s.fetches++;
            return { bytes: new Uint8Array([1]), contentType: "image/jpeg" };
          },
        },
      ];
    },
  };
  return s;
}

function service() {
  return new AssetService(new InMemoryBlobStore(), new InMemoryBlobStore(), new Map());
}

test("stores an asset from EVERY source, not just one", async () => {
  const svc = service();
  const res = await runPipeline([entity], [source("bgg", "a"), source("ludopedia", "b")], svc);
  expect(res.filter((r) => r.outcome === "stored").map((r) => r.source).sort()).toEqual(["bgg", "ludopedia"]);
  expect(await svc.list({ entity: "g1", kind: "cover" })).toHaveLength(2);
});

test("unchanged fingerprint is not refetched; changed one is", async () => {
  const svc = service();
  const s1 = source("bgg", "fp1");
  await runPipeline([entity], [s1], svc);
  expect(s1.fetches).toBe(1);

  const again = source("bgg", "fp1"); // same fingerprint
  const r1 = await runPipeline([entity], [again], svc);
  expect(again.fetches).toBe(0);
  expect(r1[0].outcome).toBe("unchanged");

  const changed = source("bgg", "fp2"); // image changed in Obsidian
  const r2 = await runPipeline([entity], [changed], svc);
  expect(changed.fetches).toBe(1);
  expect(r2[0].outcome).toBe("stored");
});

test("a rate-limited source is deferred without dropping the others", async () => {
  const svc = service();
  const flaky: AssetSource = {
    id: "ludopedia",
    kind: "cover",
    priority: 30,
    async discover() {
      throw new SourceUnavailableError("ludopedia", "429");
    },
  };
  const res = await runPipeline([entity], [source("bgg", "a"), flaky], svc);
  expect(res.find((r) => r.source === "bgg")?.outcome).toBe("stored");
  expect(res.find((r) => r.source === "ludopedia")?.outcome).toBe("deferred");
});
