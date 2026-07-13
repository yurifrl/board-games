import { describe, expect, test } from "bun:test";
import type { Game } from "./games.ts";
import { collectionPage } from "./views.tsx";
import { parseGameNote } from "./worker/parse.ts";

const game: Game = {
  id: "ark-nova",
  name: "Ark Nova",
  type: "base",
  language: "English",
  tags: ["strategy", "animals"],
  playTime: 120,
  played: true,
  isGame: true,
  purchasedAt: 1,
  forSale: false,
};

const render = (games: Game[], expansions: Game[] = []) => collectionPage({
  groups: games.map((base, index) => ({ base, expansions: index === 0 ? expansions : [] })),
  totalGames: games.length + expansions.length,
  forSaleCount: 0,
  perm: { email: "", roles: [], canSeePrices: false, canBid: false, admin: false },
  email: "",
  whatsapp: "",
  roles: [],
  defaultRole: "viewer",
  isAuthed: false,
  showAll: false,
  hiddenCount: 0,
  slots: [],
  mineSlots: new Set(),
});

describe("collection filters", () => {
  test("shows complete shelf names without splitting words", async () => {
    const css = await Bun.file(new URL("./public/styles.css", import.meta.url)).text();
    expect(css).toContain("--colgap: 60px");
    expect(css).toContain("width: min(calc(var(--colw) + var(--colgap) - 24px), calc(100vw - 24px))");
    expect(css).not.toContain("overflow-wrap: anywhere");
    expect(css).not.toContain("-webkit-line-clamp");
  });

  test("breaks shelf labels after a colon", () => {
    const html = render([{ ...game, name: "Series: Subtitle" }]);
    expect(html).toContain('<span class="box-name">Series:<br/>Subtitle</span>');
  });

  test("reads filter fields from Obsidian frontmatter", () => {
    const parsed = parseGameNote(`---\nid: ark-nova\nname: Ark Nova\ntype: base\ntags: [strategy, animals]\nplay_time: 120\nplayed: true\n---\nNotes`);

    expect(parsed?.playTime).toBe(120);
    expect(parsed?.played).toBe(true);
  });

  test("reads physical shelf size from Obsidian frontmatter", () => {
    const parsed = parseGameNote(`---\nid: sized-game\nname: Sized Game\nsite/size: " 10 X 7 CM "\n---`);
    expect(parsed?.siteSize).toEqual({ widthCm: 10, heightCm: 7 });

    const unitless = parseGameNote(`---\nid: sized-game\nname: Sized Game\nsite/size: 10x7\n---`);
    expect(unitless?.siteSize).toEqual({ widthCm: 10, heightCm: 7 });

    const decimalComma = parseGameNote(`---\nid: sized-game\nname: Sized Game\nsite/size: 9,5x6,5\n---`);
    expect(decimalComma?.siteSize).toEqual({ widthCm: 9.5, heightCm: 6.5 });

    const invalid = parseGameNote(`---\nid: sized-game\nname: Sized Game\nsite/size: 0x7cm\n---`);
    expect(invalid?.siteSize).toBeUndefined();

    const missing = parseGameNote(`---\nid: jenga\nname: Jenga\n---`);
    expect(missing?.siteSize).toBeUndefined();
  });

  test("renders declared dimensions and expands only oversized shelves", () => {
    const sized = { ...game, bggId: "sized-cover", siteSize: { widthCm: 10, heightCm: 7 } };
    const oversized = { ...game, id: "large", siteSize: { widthCm: 25, heightCm: 35 } };

    const sizedHtml = render([sized]);
    expect(sizedHtml).toContain('class="box sized"');
    expect(sizedHtml).toContain("width:126.67px;aspect-ratio:10/7");
    expect(sizedHtml).toContain("w=254&amp;h=178");
    expect(sizedHtml).toContain("if(b.classList.contains('sized'))return");
    expect(sizedHtml).not.toContain("--colw:");

    const oversizedHtml = render([oversized]);
    expect(oversizedHtml).toContain("--colw:316.67px;--rowh:443.33px");

    const defaultHtml = render([game]);
    expect(defaultHtml).not.toContain('class="box sized"');
    expect(defaultHtml).not.toContain("--colw:");

    const expansionHtml = render([game], [{
      ...oversized,
      type: "expansion",
      expansionOf: game.name,
    }]);
    expect(expansionHtml).not.toContain("--colw:");
  });

  test("renders provider dumps, media, and normalized filter fields", () => {
    const enriched: Game = {
      ...game,
      facts: {
        year: 2021,
        minPlayers: 1,
        maxPlayers: 4,
        playTime: 150,
        complexity: 3.72,
        rating: 8.5,
        rank: 4,
        type: "boardgame",
        mechanics: ["Hand Management"],
        categories: ["Animals"],
        designers: ["Mathias Wigge"],
        publishers: ["Feuerland"],
        languageDependency: "Moderate text",
      },
      providerData: {
        bgg: { id: "1", fetchedAt: 1, data: '<item><image>https://img.test/cover.jpg</image><description>A & B</description></item>' },
        ludopedia: { id: "2", fetchedAt: 2, data: { videos: [{ url: "https://video.test/watch/2" }], title: "Ark Nova BR" } },
      },
    };
    const html = render([enriched]);

    expect(html).toContain('data-t="bgg"');
    expect(html).toContain('data-t="ludopedia"');
    expect(html).toContain('data-t="media"');
    expect(html).toContain("Ark Nova BR");
    expect(html).toContain("&lt;item&gt;");
    expect(html).toContain('href="https://video.test/watch/2"');
    expect(html).toContain('data-players-min="1"');
    expect(html).toContain('data-players-max="4"');
    expect(html).toContain('data-complexity="3.72"');
    expect(html).toContain('data-rating="8.5"');
    expect(html).toContain('data-year="2021"');
    expect(html).toContain('data-mechanic="hand management"');
    expect(html).toContain('data-designer="mathias wigge"');
    expect(html).toContain('id="game-players"');
    expect(html).toContain('id="game-complexity"');
    expect(html).toContain('id="game-rating"');
    expect(html).toContain('id="game-year"');
    expect(html).toContain('id="game-mechanic"');
    expect(html).toContain('id="game-provider-category"');
    expect(html).toContain('id="game-designer"');
    expect(html).toContain('id="game-publisher"');
    expect(html).toContain('id="game-language-dependency"');
  });

  test("renders searchable game metadata and mobile filter controls", () => {
    const html = render([game]);

    expect(html).toContain('id="filter-toggle"');
    expect(html).toContain('id="filter-backdrop"');
    expect(html).toContain('id="filter-panel"');
    expect(html).not.toContain('<div class="title">🎲 Collection</div>');
    expect(html).not.toContain('All +');
    expect(html).toContain('id="game-search"');
    expect(html).toContain('id="game-type"');
    expect(html).toContain('id="game-category"');
    expect(html).toContain('id="game-playtime"');
    expect(html).toContain('name="game-playtime"');
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('<select id="game-playtime">');
    expect(html).toContain('id="game-played"');
    expect(html).toContain('id="game-sort"');
    expect(html).toContain('data-search="ark nova strategy animals base"');
    expect(html).toContain('data-playtime="120"');
    expect(html).toContain('data-played="yes"');
  });
});
