import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Game } from "../games.ts";
import { enrichProviderData, normalizeBgg, normalizeLudopedia } from "./provider-data.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const game = (values: Partial<Game> = {}): Game => ({
  id: "ark-nova",
  name: "Ark Nova",
  tags: [],
  isGame: true,
  purchasedAt: null,
  forSale: false,
  ...values,
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "provider-data-"));
  roots.push(path);
  return path;
}

async function snapshot(root: string, provider: string, id: string, fetchedAt: number, data: unknown) {
  const dir = join(root, "providers", provider);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ id, fetchedAt, data }));
}

const bggXml = (id = "1") => `<items><item type="boardgame" id="${id}">
  <thumbnail>https://img.test/thumb.jpg</thumbnail><image>https://img.test/full.jpg</image>
  <name type="primary" sortindex="1" value="Ark Nova"/><description>Build &amp; manage a zoo.</description>
  <yearpublished value="2021"/><minplayers value="1"/><maxplayers value="4"/><playingtime value="150"/><minage value="14"/>
  <link type="boardgamemechanic" id="2040" value="Hand Management"/><link type="boardgamecategory" id="1089" value="Animals"/>
  <link type="boardgamedesigner" id="123" value="Mathias Wigge"/><link type="boardgamepublisher" id="456" value="Feuerland"/>
  <poll name="language_dependence"><results><result value="Moderate in-game text" numvotes="10"/></results></poll>
  <statistics><ratings><average value="8.5"/><averageweight value="3.72"/><ranks><rank name="boardgame" value="4"/></ranks></ratings></statistics>
</item></items>`;

describe("provider cache", () => {
  test("reuses a fresh snapshot without fetching", async () => {
    const dataDir = await root();
    await snapshot(dataDir, "bgg", "1", 1_000, bggXml());
    const calls: string[] = [];
    const g = game({ bggId: "1" });

    await enrichProviderData([g], {
      dataDir,
      now: () => 2_000,
      fetch: async (url) => { calls.push(String(url)); return new Response("unexpected"); },
    });

    expect(calls).toEqual([]);
    expect(g.providerData?.bgg?.id).toBe("1");
    expect(g.facts?.complexity).toBe(3.72);
  });

  test("changing an id fetches the new provider record", async () => {
    const dataDir = await root();
    await snapshot(dataDir, "bgg", "wrong", 1_000, bggXml("wrong"));
    const calls: string[] = [];
    const g = game({ bggId: "correct" });

    await enrichProviderData([g], {
      dataDir,
      bggToken: "token",
      now: () => 2_000,
      fetch: async (url) => { calls.push(String(url)); return new Response(bggXml("correct")); },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("id=correct");
    expect(g.providerData?.bgg?.id).toBe("correct");
  });

  test("keeps stale data when refresh fails", async () => {
    const dataDir = await root();
    await snapshot(dataDir, "bgg", "1", 1_000, bggXml());
    const g = game({ bggId: "1" });

    await enrichProviderData([g], {
      dataDir,
      bggToken: "token",
      ttlMs: 10,
      now: () => 2_000,
      fetch: async () => new Response("rate limited", { status: 429 }),
    });

    expect(g.providerData?.bgg?.fetchedAt).toBe(1_000);
    expect(g.facts?.rating).toBe(8.5);
  });

  test("keeps a complete BGG item when versions contain nested items", async () => {
    const dataDir = await root();
    const xml = `<items><item type="boardgame" id="1"><versions><item type="boardgameversion" id="v1"><name value="Edition"/></item></versions><videos><video id="9" title="How to play"/></videos></item></items>`;
    const g = game({ bggId: "1" });

    await enrichProviderData([g], {
      dataDir,
      bggToken: "token",
      fetch: async () => new Response(xml),
    });

    expect(g.providerData?.bgg?.data).toContain('<item type="boardgameversion"');
    expect(g.providerData?.bgg?.data).toContain('<video id="9"');
  });

  test("keeps stale Ludopedia data when one enrichment endpoint fails", async () => {
    const dataDir = await root();
    const old = { detail: { nm_jogo: "Old complete record" }, videos: [{ url: "https://old.test/video" }] };
    await snapshot(dataDir, "ludopedia", "2", 1_000, old);
    const g = game({ ludopediaId: "2" });

    await enrichProviderData([g], {
      dataDir,
      ludopediaToken: "token",
      ttlMs: 10,
      now: () => 2_000,
      fetch: async (url) => String(url).includes("/videos")
        ? new Response("unavailable", { status: 500 })
        : Response.json({ ok: true }),
    });

    expect(g.providerData?.ludopedia?.fetchedAt).toBe(1_000);
    expect(g.providerData?.ludopedia?.data).toEqual(old);
  });
});

test("normalizes requested BGG facts", () => {
  expect(normalizeBgg(bggXml())).toEqual({
    year: 2021,
    minPlayers: 1,
    maxPlayers: 4,
    playTime: 150,
    minAge: 14,
    complexity: 3.72,
    rating: 8.5,
    rank: 4,
    type: "boardgame",
    mechanics: ["Hand Management"],
    categories: ["Animals"],
    designers: ["Mathias Wigge"],
    publishers: ["Feuerland"],
    languageDependency: "Moderate in-game text",
  });
});

test("normalizes requested Ludopedia facts", () => {
  expect(normalizeLudopedia({
    tp_jogo: "Base",
    ano_publicacao: 2021,
    qt_jogadores_min: 1,
    qt_jogadores_max: 4,
    vl_tempo_jogo: 150,
    idade_minima: 14,
    mecanicas: [{ nm_mecanica: "Gestão de Mão" }],
    categorias: [{ nm_categoria: "Animais" }],
    designers: [{ nm_designer: "Mathias Wigge" }],
    editoras: [{ nm_editora: "Grok" }],
  })).toMatchObject({
    year: 2021,
    minPlayers: 1,
    maxPlayers: 4,
    playTime: 150,
    minAge: 14,
    type: "Base",
    mechanics: ["Gestão de Mão"],
    categories: ["Animais"],
    designers: ["Mathias Wigge"],
    publishers: ["Grok"],
  });
});
