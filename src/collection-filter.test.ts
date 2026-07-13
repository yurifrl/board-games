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
    expect(css).toContain("max-width: min(calc(var(--colw) + var(--colgap) - 24px), calc(100vw - 24px))");
    expect(css).toContain("width: max-content");
    expect(css).not.toContain("overflow-wrap: anywhere");
    expect(css).not.toContain("-webkit-line-clamp");
    expect(css).toContain(".notes-document table { width:100%; margin:18px 0; border-collapse:collapse; display:block; overflow-x:auto;");
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
        bgg: { id: "1", fetchedAt: 1, data: `<item type="boardgame" id="1"><name type="primary" value="Ark Nova"/><image>https://img.test/cover.jpg</image><description>Build &amp; manage a zoo.</description>${Array.from({ length: 8 }, (_, index) => `<video id="v${index}" title="Video ${index + 1}" category="instructional" link="https://www.youtube.com/watch?v=video${index}"/>`).join("")}<video id="bad" title="Bad" link="javascript:alert(1)"/></item>` },
        ludopedia: { id: "2", fetchedAt: 2, data: { detail: { nm_jogo: "Ark Nova BR", descricao: "Construa um zoológico." }, videos: { videos: [{ nm_video: "Como jogar", link: "https://www.youtube.com/watch?v=xyz789" }] }, images: { imagens: [{ link: "https://img.test/ludo.jpg" }] }, files: { arquivos: [{ titulo: "Manual", link: "https://files.test/manual.pdf" }] } } },
      },
    };
    const html = render([enriched]);

    expect(html).toContain('data-t="bgg"');
    expect(html).toContain('data-t="ludopedia"');
    expect(html).not.toContain('data-t="media"');
    expect(html).not.toContain("Complete BGG response");
    expect(html).toContain("Ark Nova BR");
    expect(html).toContain("Build &amp; manage a zoo.");
    expect(html.match(/class="provider-video-card/g)).toHaveLength(9);
    expect(html).toContain('src="https://i.ytimg.com/vi/video0/hqdefault.jpg"');
    expect(html.match(/provider-video-extra/g)).toHaveLength(2);
    expect(html.match(/data-video-extra=""/g)).toHaveLength(2);
    expect(html).toContain('class="provider-video-more"');
    expect(html).toContain('data-video-more=""');
    expect(html).toContain("Load 2 more");
    expect(html).toContain('src="https://i.ytimg.com/vi/xyz789/hqdefault.jpg"');
    expect(html).toContain('href="https://boardgamegeek.com/boardgame/1/-/files"');
    expect(html).toContain('href="https://files.test/manual.pdf"');
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-controls="panel-ark-nova-bgg"');
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

  test("renders notes as styled markdown with highlighted JSON", () => {
    const html = render([{ ...game, notes: '# Setup\n\nUse **three cards**.\n\n```json\n{"players": 3}\n```' }]);

    expect(html).toContain('class="notes-document"');
    expect(html).toContain("<h1>Setup</h1>");
    expect(html).toContain("<strong>three cards</strong>");
    expect(html).toContain('class="note-code language-json"');
    expect(html).toContain('class="json-key">&quot;players&quot;</span>');
  });

  test("keeps explicit provider tabs visible while data is unavailable", () => {
    const html = render([{ ...game, bggId: "1", ludopediaId: "2" }]);

    expect(html).toContain('data-t="bgg"');
    expect(html).toContain('data-t="ludopedia"');
    expect(html).toContain("Provider data has not been fetched yet.");
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
