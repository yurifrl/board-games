import { expect, test } from "bun:test";
import { CoverResolver } from "./resolver.ts";
import type { CoverMeta, CoverProvider, CoverResult, CoverStore, GameRef } from "./types.ts";

/** In-memory cover store. */
class MemStore implements CoverStore {
  meta_ = new Map<string, CoverMeta>();
  async has(id: string) {
    return this.meta_.has(id);
  }
  async meta(id: string) {
    return this.meta_.get(id) ?? null;
  }
  async write(id: string, r: CoverResult) {
    const m: CoverMeta = {
      source: r.source,
      tier: r.tier,
      sourceUrl: r.sourceUrl,
      contentType: r.contentType,
      bytes: r.bytes.byteLength,
      sha256: "",
      fetchedAt: "",
      sourceFingerprint: r.fingerprint,
    };
    this.meta_.set(id, m);
    return m;
  }
}

/** Provider whose fingerprint comes from the game's bggImageUrl. */
class FakeProvider implements CoverProvider {
  readonly name = "fake";
  readonly tier = 20;
  fetches = 0;
  keyFor(g: GameRef) {
    return g.bggId ? `fake-${g.bggId}` : null;
  }
  fingerprint(g: GameRef) {
    return g.bggImageUrl ?? null;
  }
  async fetch(g: GameRef): Promise<CoverResult | null> {
    if (!g.bggId) return null;
    this.fetches++;
    return {
      bytes: new Uint8Array([1]),
      contentType: "image/jpeg",
      source: this.name,
      tier: this.tier,
      sourceUrl: g.bggImageUrl ?? "",
      cacheKey: `fake-${g.bggId}`,
      fingerprint: g.bggImageUrl ?? undefined,
    };
  }
}

const game = (url: string): GameRef => ({ id: "g1", name: "G", bggId: "1", bggImageUrl: url });

test("fetches when nothing cached", async () => {
  const p = new FakeProvider();
  const r = new CoverResolver([p], new MemStore());
  expect((await r.resolveOne(game("url-v1"))).outcome).toBe("fetched");
  expect(p.fetches).toBe(1);
});

test("does not refetch when source unchanged", async () => {
  const p = new FakeProvider();
  const r = new CoverResolver([p], new MemStore());
  await r.resolveOne(game("url-v1"));
  const res = await r.resolveOne(game("url-v1"));
  expect(res.outcome).toBe("cached");
  expect(p.fetches).toBe(1); // no second fetch
});

test("refetches when the source image changed in Obsidian", async () => {
  const p = new FakeProvider();
  const r = new CoverResolver([p], new MemStore());
  await r.resolveOne(game("url-v1"));
  const res = await r.resolveOne(game("url-v2")); // image URL changed
  expect(res.outcome).toBe("fetched");
  expect(p.fetches).toBe(2); // refetched the new source
});
