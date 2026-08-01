import { expect, test } from "bun:test";
import { buildAssetRoutes } from "./asset/serve.ts";
import { collectionPage, deniedPage, invitePage, membersAdminPage, pendingPage, requestSentPage } from "./views.tsx";

const collection = () => collectionPage({
  groups: [],
  totalGames: 0,
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

test("renders pages in Brazilian Portuguese", () => {
  const html = [
    collection(),
    deniedPage(),
    invitePage({ link: "https://example.com", email: "pessoa@exemplo.com", role: "viewer" }),
    membersAdminPage({ members: [] }),
    pendingPage({ name: "Alex" }),
    requestSentPage({ phone: "5511999999999", ownerWa: "5511888888888", approved: false }),
  ].join("\n");

  expect(html).toContain('<html lang="pt-BR">');
  expect(html).toContain("Ordenar e filtrar");
  expect(html).toContain("Nenhum jogo encontrado");
  expect(html).toContain("Solicitações de acesso");
  expect(html).toContain("Acesso não concedido");
  expect(html).toContain("Solicitação recebida");
  expect(html).toContain("Olá, Alex");
  expect(html).not.toContain("Sort &amp; filters");
  expect(html).not.toContain("No games found");
  expect(html).not.toContain("Access not granted");
});

test("keeps remaining static interface copy and locales in pt-BR", async () => {
  const source = await Promise.all([
    "./views.tsx",
    "./provider-view.tsx",
    "./index.ts",
  ].map((path) => Bun.file(new URL(path, import.meta.url)).text())).then((files) => files.join("\n"));

  for (const copy of [
    'lang="pt-BR"',
    'DateTimeFormat("pt-BR"',
    "Configure o acesso à API do provedor",
    "E-mail ou senha inválidos",
    "Carregar mais",
    "Buscar jogos ou categorias",
  ]) expect(source).toContain(copy);

  for (const copy of [
    'lang="en"',
    'DateTimeFormat("en-US"',
    "Provider data has not been fetched yet",
    "Invalid email or password",
    "Load '+Math.min",
    "Search games or categories",
  ]) expect(source).not.toContain(copy);
});

test("returns pt-BR errors from browser asset routes", async () => {
  const response = await buildAssetRoutes({} as never).request("http://x/asset/game/cover/bgg/invalid");

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Chave inválida");
});
