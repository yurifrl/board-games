import { expect, test } from "bun:test";
import { groupGames, type Game } from "./games.ts";

const game = (values: Partial<Game> & Pick<Game, "id" | "name">): Game => ({
  tags: [],
  isGame: true,
  purchasedAt: null,
  forSale: false,
  ...values,
});

test("groups expansions by base slug", () => {
  const base = game({ id: "base", name: "The Base Game", slug: "base-game" });
  const expansion = game({
    id: "expansion",
    name: "An Expansion",
    type: "expansion",
    expansionOf: "BASE-GAME",
  });

  expect(groupGames([base, expansion])).toEqual([{ base, expansions: [expansion] }]);
});
