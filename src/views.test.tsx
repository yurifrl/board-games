import { expect, test } from "bun:test";
import { signedDisplay, collectionPage } from "./views.tsx";
import type { Game, GameGroup } from "./games.ts";
import type { Permission } from "./whitelist.ts";

test("signedDisplay embeds the promotion version when provided", () => {
  const url = signedDisplay("clank", "front", 400, undefined, 1725500000000);
  expect(url).toMatch(/^\/asset\/clank\/display\/front\/latest\.png\?w=400&sig=[0-9a-f]{64}&v=1725500000000$/);
});

test("signedDisplay omits v when no version is known — URL stays stable", () => {
  const url = signedDisplay("clank", "front", 400);
  expect(url).toMatch(/^\/asset\/clank\/display\/front\/latest\.png\?w=400&sig=[0-9a-f]{64}$/);
  expect(signedDisplay("clank", "front")).toBe(signedDisplay("clank", "front"));
});

const PERM: Permission = { email: "", roles: [], canSeePrices: false, canBid: false, admin: false };
const base = (over: Partial<Game> = {}): GameGroup => ({
  base: { id: "g1", name: "Clank", tags: [], isGame: true, purchasedAt: 0, forSale: false, ...over },
  expansions: [],
});
const page = (opts: { group?: GameGroup; displays?: Record<string, number> } = {}) =>
  collectionPage({
    groups: [opts.group ?? base()],
    totalGames: 1,
    forSaleCount: 0,
    perm: PERM,
    email: "",
    whatsapp: "",
    roles: [],
    defaultRole: "viewer",
    isAuthed: false,
    showAll: true,
    hiddenCount: 0,
    slots: [],
    mineSlots: new Set(),
    displayVersions: opts.displays,
  });

test("unpromoted cover: shelf hits the provider cover directly, no guessed display URL", () => {
  const html = page({ group: base({ bggId: "42" }) });
  expect(html).toContain("/asset/g1/cover/bgg/original.jpg");
  expect(html).not.toContain("/asset/g1/display/front");
});

test("promoted display: shelf primary src is versioned, provider cover stays as data-fb", () => {
  const html = page({
    group: base({ bggId: "42" }),
    displays: { "g1/front": 1725500000000 },
  });
  expect(html).toContain('/asset/g1/display/front/latest.png');
  expect(html).toContain('&amp;v=1725500000000"');
  expect(html).toMatch(/data-fb="\/asset\/g1\/cover\/bgg\/original\.jpg/);
});

test("unpromoted spine: shelf spine uses the generated spine face, not display/spine", () => {
  const html = page();
  expect(html).toContain("/asset/g1/spine/gen/");
  expect(html).not.toContain("/asset/g1/display/spine");
});

test("promoted spine: spine img switches to the versioned display face", () => {
  const html = page({ displays: { "g1/spine": 1725500000000 } });
  expect(html).toContain('src="/asset/g1/display/spine/latest.png');
  expect(html).toContain('&amp;v=1725500000000"');
  expect(html).toContain('data-fb="/asset/g1/spine/gen/');
});
