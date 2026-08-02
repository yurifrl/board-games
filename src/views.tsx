/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from "hono/jsx";
import type { Game, GameGroup } from "./games.ts";
import type { Permission } from "./whitelist.ts";
import type { SlotView } from "./slots.ts";
import type { Member } from "./members.ts";
import { sign } from "./asset/auth.ts";
import { boxArtKey } from "./asset/box-contract.ts";
import { ProviderPane } from "./provider-view.tsx";
import { renderNote } from "./note-render.ts";

// Signed cover URL: prefer BGG's full-res original, fall back to Ludopedia,
// else the note's raw image / a placeholder.
export function signedCover(entity: string, source: "bgg" | "ludopedia", w = 400, h?: number): string {
  const key = { entity, kind: "cover", source, variant: "original", ext: "jpg" };
  return `/asset/${entity}/cover/${source}/original.jpg?${sign(key, { w, h })}`;
}

// Signed URL for a game's generated spine face. Missing art 404s and the <img>
// drops itself (onerror), revealing the tinted default spine underneath.
export function signedSpine(entity: string): string {
  const key = boxArtKey(entity, "spine");
  return `/asset/${entity}/spine/gen/${key.variant}.${key.ext}?${sign(key)}`;
}

const coverSrc = (g: Game, w = 400, h?: number): string => {
  const source = g.bggId ? "bgg" : g.ludopediaId ? "ludopedia" : null;
  return source ? signedCover(g.id, source, w, h) : g.image ?? "";
};

const canSeeSale = (perm: Permission) => !!perm.canSeePrices || !!perm.admin;
const SHELF_HEIGHT_PX = 380;
const SHELF_HEIGHT_CM = 30;
const BOX_WIDTH_PX = 250;
const cmToPx = (cm: number) => Math.round(cm * SHELF_HEIGHT_PX / SHELF_HEIGHT_CM * 100) / 100;

const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <title>{title}</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>{children}</body>
  </html>
);

export const doc = (el: { toString(): string }): string => "<!doctype html>" + el.toString();
export { Layout };

// Tinted title-card placeholder shows when a game has no cover source or the
// image 404s (onerror drops the img, revealing the card underneath).
const CoverImg: FC<{ g: Game; cls: string; w?: number; h?: number }> = ({ g, cls, w, h }) => {
  const src = coverSrc(g, w, h);
  return (
    <span class={`${cls} cover-ph`} style={`--tint:${g.tint ?? "#3a3a44"}`} data-name={g.name}>
      {src ? <img src={src} alt={g.name} loading="lazy" onerror="this.remove()" /> : null}
    </span>
  );
};

const SaleBadge: FC<{ g: Game; perm: Permission }> = ({ g, perm }) =>
  g.forSale && canSeeSale(perm) ? <span class="tag sale">À VENDA</span> : null;

const PriceLine: FC<{ g: Game; perm: Permission }> = ({ g, perm }) =>
  canSeeSale(perm) && (g.salePrice || g.price) ? <div class="price">{g.salePrice ?? g.price}</div> : null;

const waHref = (g: Game, whatsapp: string) =>
  `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Gostaria de fazer uma oferta por "${g.name}". Minha oferta: R$ `)}`;

const BidButton: FC<{ g: Game; perm: Permission; whatsapp: string; cls?: string }> = ({ g, perm, whatsapp, cls = "bid" }) =>
  g.forSale && perm.canBid ? (
    <a class={cls} href={waHref(g, whatsapp)} target="_blank" rel="noopener">
      {cls === "ebid" ? "Ofertar" : "Fazer uma oferta"}
    </a>
  ) : null;

const Links: FC<{ g: Game }> = ({ g }) => {
  if (!g.urlBgg && !g.urlLudopedia) return null;
  return (
    <div class="links">
      {g.urlBgg ? <a href={g.urlBgg} target="_blank" rel="noopener">BGG</a> : null}
      {g.urlLudopedia ? <a href={g.urlLudopedia} target="_blank" rel="noopener">Ludopedia</a> : null}
    </div>
  );
};

const Tags: FC<{ g: Game }> = ({ g }) => (
  <>
    {g.language ? <span class="tag">{g.language}</span> : null}
    {g.purchaseDate ? <span class="tag">📅 {g.purchaseDate}</span> : null}
  </>
);

const ExpansionRow: FC<{ g: Game; perm: Permission; whatsapp: string }> = ({ g, perm, whatsapp }) => (
  <div class="exp">
    <span class="ename">+ {g.name}</span>
    <SaleBadge g={g} perm={perm} />
    {canSeeSale(perm) && (g.salePrice || g.price) ? <span class="eprice">{g.salePrice ?? g.price}</span> : null}
    <BidButton g={g} perm={perm} whatsapp={whatsapp} cls="ebid" />
  </div>
);

// Closed 3D box on the shelf. Cover art is the front face; darker tinted top +
// right faces give it depth. `--tint` colors the faces/stage. The box takes the
// cover's own shape (set from the image on the client). Links to the detail.
const Box: FC<{ grp: GameGroup; perm: Permission }> = ({ grp, perm }) => {
  const g = grp.base;
  const tint = g.tint ?? "#3a3a44";
  const games = [g, ...grp.expansions];
  const facts = games.map((game) => game.facts);
  const terms = (field: "mechanics" | "categories" | "designers" | "publishers") => facts.flatMap((fact) => fact?.[field] ?? []);
  const search = games.flatMap((game) => [game.name, ...game.tags, game.type ?? game.facts?.type ?? "", ...terms("mechanics"), ...terms("categories"), ...terms("designers"), ...terms("publishers")]).join(" ").toLowerCase();
  const size = g.dimensions;
  const sizeStyle = size ? `;width:${cmToPx(size.widthCm)}px;aspect-ratio:${size.widthCm}/${size.heightCm}` : "";
  const coverWidth = size ? Math.ceil(cmToPx(size.widthCm) * 2) : undefined;
  const coverHeight = size ? Math.ceil(cmToPx(size.heightCm) * 2) : undefined;
  const colon = g.name.indexOf(":");
  return (
    <a
      class={`box${size ? " sized" : ""}${grp.expansions.length ? " has-expansions" : ""}`}
      href={`#g-${g.slug}`}
      style={`--tint:${tint}${sizeStyle}`}
      data-id={g.id}
      data-search={search}
      data-type={games.map((game) => (game.type ?? game.facts?.type ?? "game").toLowerCase()).join("|")}
      data-category={games.flatMap((game) => game.tags.map((tag) => tag.toLowerCase())).join("|")}
      data-provider-category={terms("categories").map((value) => value.toLowerCase()).join("|")}
      data-language={games.map((game) => (game.language ?? "").toLowerCase()).join("|")}
      data-language-dependency={facts.map((fact) => fact?.languageDependency?.toLowerCase() ?? "").join("|")}
      data-playtime={g.playTime ?? g.facts?.playTime ?? ""}
      data-players-min={g.facts?.minPlayers ?? ""}
      data-players-max={g.facts?.maxPlayers ?? ""}
      data-complexity={g.facts?.complexity ?? ""}
      data-rating={g.facts?.rating ?? ""}
      data-year={g.facts?.year ?? ""}
      data-mechanic={terms("mechanics").map((value) => value.toLowerCase()).join("|")}
      data-designer={terms("designers").map((value) => value.toLowerCase()).join("|")}
      data-publisher={terms("publishers").map((value) => value.toLowerCase()).join("|")}
      data-played={g.played === true ? "yes" : g.played === false ? "no" : "unknown"}
      data-sale={games.some((game) => game.forSale) && canSeeSale(perm) ? "yes" : "no"}
      data-purchased={g.purchasedAt ?? 0}
      data-name={g.name.toLowerCase()}
    >
      <span class="stage"></span>
      <span class="box3d">
        <span class="face front"><CoverImg g={g} cls="faceimg" w={coverWidth} h={coverHeight} /></span>
        <span class="face side"></span>
        <span class="face top"></span>
      </span>
      {g.forSale && canSeeSale(perm) ? <span class="tsale">VENDA</span> : null}
      <span class="box-labels">
        <span class="box-name">
          {colon === -1 ? g.name : <>{g.name.slice(0, colon + 1)}<br />{g.name.slice(colon + 1).trimStart()}</>}
        </span>
        {grp.expansions.length ? (
          <>
            <span class="expansion-mark" aria-label={`Inclui ${grp.expansions.length} expansões`}>+</span>
            <span class="expansion-tags" aria-hidden="true">
              {grp.expansions.map((expansion, index) => (
                <span class="expansion-tag" style={`--i:${index}`}>{expansion.name}</span>
              ))}
            </span>
          </>
        ) : null}
      </span>
    </a>
  );
};

// Full-screen game hub, shown via :target when its box is tapped. Cover top-left,
// One shelved spine (spine view). The tinted strip with the vertical name is the
// default; the generated spine art covers it when present. Links to the same detail.
const Spine: FC<{ grp: GameGroup }> = ({ grp }) => {
  const g = grp.base;
  return (
    <a class="spine" href={`#g-${g.slug}`} data-id={g.id} style={`--tint:${g.tint ?? "#3a3a44"}`} title={g.name}>
      <span class="spine-name">{g.name}</span>
      <img class="spine-art" src={signedSpine(g.id)} alt={g.name} loading="lazy" onerror="this.remove()" />
    </a>
  );
};

// Full-screen game hub, shown via :target when its box is tapped. Cover top-left,
// then real data only: overview (facts/price/expansions) and your vault notes.
const Detail: FC<{ grp: GameGroup; perm: Permission; whatsapp: string }> = ({ grp, perm, whatsapp }) => {
  const g = grp.base;
  const tint = g.tint ?? "#3a3a44";
  const bg = coverSrc(g);
  const showSale = canSeeSale(perm) && (!!g.salePrice || !!g.price);
  return (
    <div class="detail" id={`g-${g.slug}`} style={`--tint:${tint}`}>
      <a class="detail-bg" href="#" aria-label="Fechar" style={bg ? `background-image:url("${bg}")` : ""}></a>
      <div class="hub">
        <div class="hub-inner">
          <a class="close" href="#" aria-label="Fechar">✕</a>
          <div class="hub-head">
            <div class="hub-cover">
              <CoverImg g={g} cls="cover" />
              <a class="btn play declare" href={perm.email ? `/game/${g.id}/play` : `/auth/google?game=${g.id}`}>🗓 Quero jogar</a>
            </div>
            <div>
              <h1>{g.name}</h1>
              <div class="tags">
                <SaleBadge g={g} perm={perm} />
                <Tags g={g} />
              </div>
              <Links g={g} />
            </div>
          </div>

          <div class="tabs" role="tablist" aria-label={`${g.name}: detalhes`}>
            <button id={`tab-${g.id}-overview`} class="active" data-t="overview" role="tab" aria-selected="true" aria-controls={`panel-${g.id}-overview`}>Visão geral</button>
            {g.bggId || g.providerData?.bgg ? <button id={`tab-${g.id}-bgg`} data-t="bgg" role="tab" aria-selected="false" aria-controls={`panel-${g.id}-bgg`} tabindex={-1}>BGG</button> : null}
            {g.ludopediaId || g.providerData?.ludopedia ? <button id={`tab-${g.id}-ludopedia`} data-t="ludopedia" role="tab" aria-selected="false" aria-controls={`panel-${g.id}-ludopedia`} tabindex={-1}>Ludopedia</button> : null}
            {g.notes ? <button id={`tab-${g.id}-notes`} data-t="notes" role="tab" aria-selected="false" aria-controls={`panel-${g.id}-notes`} tabindex={-1}>Anotações</button> : null}
          </div>

          <section id={`panel-${g.id}-overview`} class="pane active" data-p="overview" role="tabpanel" aria-labelledby={`tab-${g.id}-overview`}>
            {showSale ? <><h2>Este exemplar</h2><PriceLine g={g} perm={perm} /><BidButton g={g} perm={perm} whatsapp={whatsapp} /></> : null}
            {grp.expansions.length ? (
              <div class="exps">
                <div class="exp-label">Expansões ({grp.expansions.length})</div>
                {grp.expansions.map((e) => <ExpansionRow g={e} perm={perm} whatsapp={whatsapp} />)}
              </div>
            ) : null}
            {!showSale && !grp.expansions.length ? <p class="note">Ainda não há outros detalhes.</p> : null}
          </section>

          <ProviderPane game={g} provider="bgg" />
          <ProviderPane game={g} provider="ludopedia" />
          {g.notes ? (
            <section id={`panel-${g.id}-notes`} class="pane" data-p="notes" role="tabpanel" aria-labelledby={`tab-${g.id}-notes`}>
              <article class="notes-document" dangerouslySetInnerHTML={{ __html: renderNote(g.notes) }}></article>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const LoginModal: FC<{ error?: string }> = ({ error }) => (
  <div class="overlay">
    <form class="modal" method="post" action="/auth/login">
      <a class="x" href="/" title="Fechar" aria-label="Fechar">✕</a>
      <h2 style="margin:0;font-size:18px">🎲 Entrar</h2>
      {error ? <p class="note" style="color:#f87171;margin:0">{error}</p> : null}
      <input type="email" name="email" placeholder="voce@exemplo.com" autocomplete="username" required autofocus />
      <input type="password" name="password" placeholder="Senha" autocomplete="current-password" required />
      <button class="btn" type="submit">Entrar</button>
    </form>
  </div>
);

const InviteForm: FC<{ roles: string[]; defaultRole: string }> = ({ roles, defaultRole }) => (
  <section class="invite" id="invitePanel">
    <h2>Convidar usuário temporário</h2>
    <form method="post" action="/admin/invite">
      <input type="email" name="email" placeholder="convidado@exemplo.com" required />
      <select name="role">
        {roles.map((r) => <option value={r} selected={r === defaultRole}>{r}</option>)}
      </select>
      <button class="btn" type="submit">Criar link</button>
    </form>
  </section>
);

// ---- Play: game slots synced from the owner's calendar (shown on the home page) ----

const slotFmt = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});
const whenStr = (iso: string): string => {
  try {
    return slotFmt.format(new Date(iso));
  } catch {
    return iso;
  }
};

// A booked game session (a calendar event with a game assigned). `mine` = the
// current member is already seated. Joining/leaving edits the calendar event.
const SlotCard: FC<{ s: SlotView; authed: boolean; mine: boolean; big?: boolean }> = ({ s, authed, mine, big }) => (
  <article class={`slot${big ? " big" : ""}`}>
    <div class="slot-cover">
      {s.coverGameId && s.coverSource ? (
        <img src={signedCover(s.coverGameId, s.coverSource)} alt={s.gameName ?? ""} loading="lazy" />
      ) : (
        <div class="open-cover">🎲<span>{s.gameName}</span></div>
      )}
    </div>
    <div class="slot-body">
      <div class="slot-title">{s.gameName}</div>
      <div class="slot-meta">
        <span>🗓 {whenStr(s.start)}</span>
        {s.location ? <span>📍 {s.location}</span> : null}
      </div>
      <div class="slot-count">
        <span class="spots">{s.taken} jogando</span>
      </div>
      {authed ? (
        mine ? (
          <form method="post" action={`/session/${s.id}/leave`}>
            <button class="btn leave" type="submit">Sair</button>
          </form>
        ) : (
          <form method="post" action={`/session/${s.id}/join`}>
            <button class="btn play" type="submit">Eu vou</button>
          </form>
        )
      ) : (
        <a class="btn play" href="/auth/google">Entre para participar</a>
      )}
    </div>
  </article>
);

const SlotsSection: FC<{ slots: SlotView[]; authed: boolean; mine: Set<string> }> = ({ slots, authed, mine }) => {
  if (slots.length === 0) return null;
  return (
    <section class="play-section">
      <h2 class="sec">🗓 Próximas noites de jogos</h2>
      <div class="slots">{slots.map((s) => <SlotCard s={s} authed={authed} mine={mine.has(s.id)} />)}</div>
    </section>
  );
};

// Booking page: pick one of the owner's open availability blocks for this game.
// Start pre-fills to the block start, duration to the game's registered play
// time — both adjustable.
export function bookingPage(opts: { game: Game; blocks: SlotView[] }): string {
  const { game, blocks } = opts;
  const dur = game.playTime ?? 120;
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return doc(
    <Layout title={`Jogar ${game.name}`}>
      <div class="topbar">
        <div class="title">🎲 Jogar {game.name}</div>
        <a class="btn" href="/">Início</a>
      </div>
      <main class="play">
        <h2 class="sec">Escolha um horário</h2>
        {blocks.length === 0 ? (
          <p class="note">Não há horários disponíveis no momento — o responsável ainda não publicou a disponibilidade. Volte em breve.</p>
        ) : (
          <div class="slots">
            {blocks.map((b) => (
              <article class="slot">
                <div class="slot-body">
                  <div class="slot-meta"><span>🗓 {whenStr(b.start)}</span>{b.location ? <span>📍 {b.location}</span> : null}</div>
                  <form method="post" action={`/game/${game.id}/book`} class="join">
                    <input type="hidden" name="blockId" value={b.id} />
                    <label class="note">Início<input type="datetime-local" name="start" value={toLocal(b.start)} required /></label>
                    <label class="note">Minutos<input type="number" name="durationMin" value={String(dur)} min="15" step="15" required /></label>
                    <button class="btn play" type="submit">Reservar este horário</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </Layout>,
  );
}

const FilterChoice: FC<{ id: string; label: string; options: { value: string; label: string }[] }> = ({ id, label, options }) => {
  const searchable = options.length > 10;
  return (
    <fieldset id={id} class={`filter-choice${searchable ? " filter-choice-long" : ""}`}>
      <legend>{label}</legend>
      {searchable ? <input class="choice-search" type="search" placeholder={`Buscar ${label.toLowerCase()}…`} aria-label={`Buscar ${label.toLowerCase()}`} autocomplete="off" /> : null}
      <div class="choice-options" data-filter-options={searchable ? "" : undefined}>
        {options.map((option, index) => (
          <label>
            <input type="radio" name={id} value={option.value} checked={index === 0} />
            <span data-filter-label={option.label}>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

const CollectionTools: FC<{ groups: GameGroup[]; canFilterSale: boolean }> = ({ groups, canFilterSale }) => {
  const games = groups.flatMap((group) => [group.base, ...group.expansions]);
  const unique = (values: (string | undefined)[]) =>
    [...new Set(values.filter((value): value is string => !!value).map((value) => value.trim()))]
      .sort((a, b) => a.localeCompare(b));
  const types = unique(games.map((game) => game.type ?? game.facts?.type ?? "game"));
  const categories = unique(games.flatMap((game) => game.tags));
  const providerCategories = unique(games.flatMap((game) => game.facts?.categories ?? []));
  const mechanics = unique(games.flatMap((game) => game.facts?.mechanics ?? []));
  const designers = unique(games.flatMap((game) => game.facts?.designers ?? []));
  const publishers = unique(games.flatMap((game) => game.facts?.publishers ?? []));
  const languageDependencies = unique(games.map((game) => game.facts?.languageDependency));
  const languages = unique(games.map((game) => game.language));
  const years = [...new Set(games.flatMap((game) => game.facts?.year ? [game.facts.year] : []))].sort((a, b) => b - a);
  const maxPlayers = Math.max(0, ...games.map((game) => game.facts?.maxPlayers ?? 0));

  return (
    <section class="collection-tools" aria-label="Buscar e filtrar jogos">
      <div class="collection-bar">
        <div id="search-shell" class="search-shell">
          <button id="search-open" class="search-open" type="button" aria-label="Buscar" aria-expanded="false">
            <span class="mag" aria-hidden="true">⌕</span>
            <span id="game-results" class="search-metric" aria-live="polite">{groups.length} {groups.length === 1 ? "jogo" : "jogos"}</span>
          </button>
          <label class="search-box">
            <span class="mag" aria-hidden="true">⌕</span>
            <input id="game-search" type="search" placeholder="Buscar jogos ou categorias…" autocomplete="off" />
            <button id="search-close" class="search-close" type="button" aria-label="Fechar busca">✕</button>
          </label>
          <button id="filter-toggle" class="btn filter-toggle" type="button" aria-controls="filter-panel" aria-expanded="false">
            Ordenar e filtrar <span id="filter-count" class="filter-count" hidden>0</span>
          </button>
        </div>
      </div>
      <div id="filter-backdrop" class="filter-backdrop" hidden></div>
      <div id="filter-panel" class="filter-panel" role="dialog" aria-modal="true" aria-labelledby="filter-title" hidden>
        <div class="filter-head">
          <strong id="filter-title">Ordenar e filtrar</strong>
          <div class="filter-head-actions">
            <button id="clear-panel-filters" type="button">Limpar filtros</button>
            <button id="filter-close" type="button" aria-label="Fechar ordenação e filtros">✕</button>
          </div>
        </div>
        <div class="filter-panel-body">
          <fieldset id="game-sort" class="sort-section">
            <legend class="zone-title"><span class="zone-icon" aria-hidden="true">↕</span><strong>Ordenação</strong><small>Altera a ordem dos resultados</small></legend>
            <div class="sort-options">
              {[
                ["newest", "Mais recentes"],
                ["name", "Nome A–Z"],
                ["playtime-asc", "Menor duração"],
                ["playtime-desc", "Maior duração"],
              ].map(([value, label], index) => (
                <label><input type="radio" name="game-sort" value={value} checked={index === 0} /><span>{label}</span></label>
              ))}
            </div>
          </fieldset>
          <div class="filter-section-head"><span class="zone-icon" aria-hidden="true">◇</span><strong>Filtros</strong><small>Refina os resultados</small></div>
          <div class="filter-grid">
          <FilterChoice id="game-type" label="Tipo" options={[{ value: "", label: "Todos" }, ...types.map((type) => ({ value: type.toLowerCase(), label: type }))]} />
          <FilterChoice id="game-category" label="Sua categoria" options={[{ value: "", label: "Todos" }, ...categories.map((category) => ({ value: category.toLowerCase(), label: category }))]} />
          {providerCategories.length ? <FilterChoice id="game-provider-category" label="Categoria do provedor" options={[{ value: "", label: "Todos" }, ...providerCategories.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          <FilterChoice id="game-playtime" label="Duração" options={[{ value: "", label: "Qualquer" }, { value: "30", label: "≤ 30m" }, { value: "60", label: "31–60m" }, { value: "120", label: "61–120m" }, { value: "121", label: "2h+" }]} />
          {maxPlayers ? <FilterChoice id="game-players" label="Jogadores" options={[{ value: "", label: "Qualquer" }, ...["1", "2", "3", "4", "4+", "8+", "12+"].map((value) => ({ value, label: value }))]} /> : null}
          <FilterChoice id="game-complexity" label="Complexidade" options={[{ value: "", label: "Qualquer" }, { value: "2", label: "≤ 2" }, { value: "3", label: "2–3" }, { value: "4", label: "3–4" }, { value: "5", label: "4+" }]} />
          <FilterChoice id="game-rating" label="Avaliação" options={[{ value: "", label: "Qualquer" }, { value: "6", label: "6+" }, { value: "7", label: "7+" }, { value: "8", label: "8+" }, { value: "9", label: "9+" }]} />
          {years.length ? <FilterChoice id="game-year" label="Publicação" options={[{ value: "", label: "Qualquer" }, ...years.map((year) => ({ value: String(year), label: String(year) }))]} /> : null}
          {mechanics.length ? <FilterChoice id="game-mechanic" label="Mecânica" options={[{ value: "", label: "Todos" }, ...mechanics.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          {designers.length ? <FilterChoice id="game-designer" label="Designer" options={[{ value: "", label: "Todos" }, ...designers.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          {publishers.length ? <FilterChoice id="game-publisher" label="Editora" options={[{ value: "", label: "Todos" }, ...publishers.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          {languageDependencies.length ? <FilterChoice id="game-language-dependency" label="Dependência de idioma" options={[{ value: "", label: "Todos" }, ...languageDependencies.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          <FilterChoice id="game-played" label="Jogado" options={[{ value: "", label: "Qualquer" }, { value: "yes", label: "Jogado" }, { value: "no", label: "Não jogado" }, { value: "unknown", label: "Não informado" }]} />
          {languages.length ? <FilterChoice id="game-language" label="Idioma" options={[{ value: "", label: "Todos" }, ...languages.map((language) => ({ value: language.toLowerCase(), label: language }))]} /> : null}
          {canFilterSale ? <FilterChoice id="game-sale" label="Disponibilidade" options={[{ value: "", label: "Todos" }, { value: "yes", label: "À venda" }]} /> : null}
          </div>
        </div>
      </div>
      <div class="filter-status">
        <div id="filter-chips" class="filter-chips"></div>
        <button id="clear-filters" type="button" hidden>Limpar tudo</button>
      </div>
    </section>
  );
};

export function collectionPage(opts: {
  groups: GameGroup[];
  totalGames: number;
  forSaleCount: number;
  perm: Permission;
  email: string;
  whatsapp: string;
  roles: string[];
  defaultRole: string;
  isAuthed: boolean;
  showAll: boolean;
  hiddenCount: number;
  slots: SlotView[];
  mineSlots: Set<string>;
  login?: { error?: string };
}): string {
  const { groups, perm, email, whatsapp, roles, defaultRole, isAuthed, slots, mineSlots, login } = opts;
  const isTemp = perm.roles.length > 0 && !perm.admin && !perm.name;
  const showLogin = !!login;
  const sized = groups.flatMap(({ base }) => base.dimensions ? [base.dimensions] : []);
  const colw = Math.max(BOX_WIDTH_PX, ...sized.map(({ widthCm }) => cmToPx(widthCm)));
  const rowh = Math.max(SHELF_HEIGHT_PX, ...sized.map(({ heightCm }) => cmToPx(heightCm)));
  const shelfStyle = colw > BOX_WIDTH_PX || rowh > SHELF_HEIGHT_PX
    ? `--colw:${colw}px;--rowh:${rowh}px`
    : undefined;

  return doc(
    <Layout title="Coleção de jogos de tabuleiro">
      <div class="topbar collection-topbar">
        <div class="right">
          <button id="view-toggle" class="btn view-toggle" type="button" aria-pressed="false">Lombadas</button>
          {perm.admin ? (
            <a class="btn" href="/admin/requests">Solicitações</a>
          ) : null}
          {perm.admin ? (
            <a
              class="btn"
              href="#invitePanel"
              onclick="document.getElementById('invitePanel').classList.toggle('open');return false"
            >
              Convidar
            </a>
          ) : null}
          {isAuthed ? (
            <>
              <span class="badge">
                {perm.name ?? email}
                {perm.roles.length ? " · " + perm.roles.join(", ") : ""}
                {isTemp ? " · convidado" : ""}
              </span>
              <a class="btn" href="/auth/logout">Sair</a>
            </>
          ) : null}
        </div>
      </div>
      <CollectionTools groups={groups} canFilterSale={canSeeSale(perm)} />
      <SlotsSection slots={slots} authed={isAuthed} mine={mineSlots} />
      <div class="shelf" style={shelfStyle}>{groups.map((grp) => <Box grp={grp} perm={perm} />)}</div>
      <div class="spines">{groups.map((grp) => <Spine grp={grp} />)}</div>
      <div id="filter-empty" class="filter-empty" hidden><b>Nenhum jogo encontrado</b><span>Tente limpar um filtro ou buscar outra coisa.</span></div>
      {groups.map((grp) => <Detail grp={grp} perm={perm} whatsapp={whatsapp} />)}
      {perm.admin ? <InviteForm roles={roles} defaultRole={defaultRole} /> : null}
      {!isAuthed && !showLogin ? (
        <a href="/login" class="lock" title="Entrar" aria-label="Entrar">🔒</a>
      ) : null}
      {showLogin ? <LoginModal error={login?.error} /> : null}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function(){var vt=document.querySelector('#view-toggle');if(!vt)return;function apply(v){var spine=v==='spine';document.body.classList.toggle('view-spine',spine);vt.setAttribute('aria-pressed',String(spine));vt.textContent=spine?'Estante':'Lombadas';}apply(localStorage.getItem('gameView')||'shelf');vt.addEventListener('click',function(){var v=document.body.classList.contains('view-spine')?'shelf':'spine';localStorage.setItem('gameView',v);apply(v);});})();
            var boxes=Array.from(document.querySelectorAll('.box')),shelf=document.querySelector('.shelf');
            var spinesEl=document.querySelector('.spines'),spineById={};if(spinesEl)Array.from(spinesEl.querySelectorAll('.spine')).forEach(function(s){spineById[s.dataset.id]=s;});function spineOf(b){return spineById[b.dataset.id];}
            boxes.forEach(function(b){if(b.classList.contains('sized'))return;var i=b.querySelector('img');if(!i)return;var size=function(){if(i.naturalWidth)b.style.aspectRatio=i.naturalWidth+'/'+i.naturalHeight;};i.complete?size():i.addEventListener('load',size);});
            if(matchMedia('(hover: none), (pointer: coarse)').matches){var expansionObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){entry.target.classList.toggle('exp-active',entry.isIntersecting);});},{rootMargin:'-35% 0px -35% 0px'});boxes.filter(function(b){return b.classList.contains('has-expansions');}).forEach(function(b){expansionObserver.observe(b);});}
            var controls={search:document.querySelector('#game-search'),type:document.querySelector('#game-type'),category:document.querySelector('#game-category'),providerCategory:document.querySelector('#game-provider-category'),playtime:document.querySelector('#game-playtime'),players:document.querySelector('#game-players'),complexity:document.querySelector('#game-complexity'),rating:document.querySelector('#game-rating'),year:document.querySelector('#game-year'),mechanic:document.querySelector('#game-mechanic'),designer:document.querySelector('#game-designer'),publisher:document.querySelector('#game-publisher'),languageDependency:document.querySelector('#game-language-dependency'),played:document.querySelector('#game-played'),language:document.querySelector('#game-language'),sale:document.querySelector('#game-sale')};
            var sort=document.querySelector('#game-sort'),results=document.querySelector('#game-results'),empty=document.querySelector('#filter-empty'),clear=document.querySelector('#clear-filters'),panelClear=document.querySelector('#clear-panel-filters'),count=document.querySelector('#filter-count'),chips=document.querySelector('#filter-chips');
            var panel=document.querySelector('#filter-panel'),backdrop=document.querySelector('#filter-backdrop'),filterToggle=document.querySelector('#filter-toggle'),filterClose=document.querySelector('#filter-close'),optionSearches=Array.from(document.querySelectorAll('.choice-search'));
            var searchShell=document.querySelector('#search-shell'),searchOpen=document.querySelector('#search-open'),searchClose=document.querySelector('#search-close'),searchInput=document.querySelector('#game-search');
            function setSearchOpen(open){searchShell.classList.toggle('open',open);searchOpen.setAttribute('aria-expanded',String(open));if(open){requestAnimationFrame(function(){searchInput.focus();});}else{searchInput.value='';applyFilters();}}
            searchOpen.addEventListener('click',function(){setSearchOpen(true);});
            searchClose.addEventListener('click',function(){setSearchOpen(false);});
            searchInput.addEventListener('input',function(){searchShell.classList.toggle('searching',!!searchInput.value.trim());});
            searchInput.addEventListener('keydown',function(e){if(e.key==='Escape'){e.stopPropagation();setSearchOpen(false);}});
            function resetOptionSearches(){optionSearches.forEach(function(input){input.value='';input.closest('.filter-choice').querySelectorAll('[data-filter-options] label').forEach(function(label){label.hidden=false;});});}
            function positionFilterPanel(){if(innerWidth<700){panel.style.removeProperty('--filter-panel-top');panel.style.removeProperty('--filter-panel-height');return;}var rect=filterToggle.getBoundingClientRect(),top=rect.bottom+12;panel.style.setProperty('--filter-panel-top',top+'px');panel.style.setProperty('--filter-panel-height',Math.max(0,innerHeight-top)+'px');}
            function setFilterOpen(open){panel.hidden=!open;backdrop.hidden=!open;filterToggle.setAttribute('aria-expanded',String(open));document.body.classList.toggle('filters-open',open);if(open){positionFilterPanel();requestAnimationFrame(function(){filterClose.focus();});}else{resetOptionSearches();filterToggle.focus();}}
            function trapPanelFocus(e){if(e.key!=='Tab')return;var focusable=Array.from(panel.querySelectorAll('button:not(:disabled),input:not(:disabled):not([type="radio"]),input[type="radio"]:checked')),first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
            function filterOptions(input){var q=input.value.trim().toLowerCase();input.closest('.filter-choice').querySelectorAll('[data-filter-options] label').forEach(function(label){var radio=label.querySelector('input');label.hidden=!!q&&radio.value!==''&&!radio.checked&&!radio.nextElementSibling.dataset.filterLabel.toLowerCase().includes(q);});}
            optionSearches.forEach(function(input){input.addEventListener('input',function(){filterOptions(input);});});
            filterToggle.addEventListener('click',function(){setFilterOpen(panel.hidden);});filterClose.addEventListener('click',function(){setFilterOpen(false);});backdrop.addEventListener('click',function(){setFilterOpen(false);});addEventListener('resize',function(){if(!panel.hidden)positionFilterPanel();});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!panel.hidden)setFilterOpen(false);});
            function matchesTime(value,range){var n=Number(value);if(!range)return true;if(!n)return false;if(range==='30')return n<=30;if(range==='60')return n>30&&n<=60;if(range==='120')return n>60&&n<=120;return n>120;}
            function includes(value,selected){return !selected||(value||'').split('|').includes(selected);}
            function matchesPlayers(d,value){if(!value)return true;var max=Number(d.playersMax);if(value.endsWith('+'))return max>=Number(value.slice(0,-1));var n=Number(value);return Number(d.playersMin)<=n&&max>=n;}
            function matchesComplexity(value,range){var n=Number(value);if(!range)return true;if(!n)return false;if(range==='2')return n<=2;if(range==='3')return n>2&&n<=3;if(range==='4')return n>3&&n<=4;return n>4;}
            function getValues(){var values={};Object.keys(controls).forEach(function(k){var c=controls[k],input=c&&c.matches('fieldset')?c.querySelector('input:checked'):c;values[k]=input?input.value.trim().toLowerCase():'';});return values;}
            function matchesBox(b,values){var d=b.dataset;return(!values.search||d.search.includes(values.search))&&includes(d.type,values.type)&&includes(d.category,values.category)&&includes(d.providerCategory,values.providerCategory)&&includes(d.mechanic,values.mechanic)&&includes(d.designer,values.designer)&&includes(d.publisher,values.publisher)&&includes(d.languageDependency,values.languageDependency)&&(!values.played||d.played===values.played)&&includes(d.language,values.language)&&(!values.sale||d.sale===values.sale)&&matchesTime(d.playtime,values.playtime)&&matchesPlayers(d,values.players)&&matchesComplexity(d.complexity,values.complexity)&&(!values.rating||Number(d.rating)>=Number(values.rating))&&(!values.year||d.year===values.year);}
            function updateFacets(values){Object.keys(controls).forEach(function(k){var control=controls[k];if(!control||!control.matches('fieldset'))return;control.querySelectorAll('.choice-options input').forEach(function(radio){var candidate=Object.assign({},values);candidate[k]=radio.value.toLowerCase();var total=boxes.filter(function(b){return matchesBox(b,candidate);}).length;radio.disabled=total===0&&!radio.checked;var label=radio.nextElementSibling;label.textContent=label.dataset.filterLabel+' ('+total+')';});});}
            function applyFilters(){
              var values=getValues(),sortValue=sort.querySelector('input:checked').value,visible=boxes.filter(function(b){var show=matchesBox(b,values);b.hidden=!show;var s=spineOf(b);if(s)s.hidden=!show;return show;});
              visible.sort(function(a,b){if(sortValue==='name')return a.dataset.name.localeCompare(b.dataset.name);var av=Number(sortValue==='newest'?a.dataset.purchased:a.dataset.playtime)||0,bv=Number(sortValue==='newest'?b.dataset.purchased:b.dataset.playtime)||0;return sortValue==='playtime-asc'?(av||Infinity)-(bv||Infinity):bv-av;}).forEach(function(b){shelf.appendChild(b);var s=spineOf(b);if(s&&spinesEl)spinesEl.appendChild(s);});
              updateFacets(values);optionSearches.forEach(filterOptions);var active=Object.keys(values).filter(function(k){return values[k];});results.textContent=visible.length+(visible.length===1?' jogo':' jogos');empty.hidden=visible.length!==0;clear.hidden=active.length===0;count.hidden=active.length===0;count.textContent=String(active.length);
              chips.replaceChildren();active.forEach(function(k){var control=controls[k],input=control.matches('fieldset')?control.querySelector('input:checked'):control,label=k==='search'?'“'+input.value+'”':input.nextElementSibling.dataset.filterLabel;var chip=document.createElement('button');chip.type='button';chip.textContent=label+' ×';chip.onclick=function(){if(control.matches('fieldset'))control.querySelector('.choice-options input').checked=true;else control.value='';applyFilters();};chips.appendChild(chip);});
            }
            function clearFilters(){Object.keys(controls).forEach(function(k){var c=controls[k];if(!c)return;if(c.matches('fieldset'))c.querySelector('.choice-options input').checked=true;else c.value='';});resetOptionSearches();applyFilters();}
            function rememberChecked(e){var label=e.target.closest('.choice-options label');if(label)label.dataset.wasChecked=String(label.querySelector('input').checked);}
            panel.addEventListener('pointerdown',rememberChecked);panel.addEventListener('keydown',trapPanelFocus);panel.addEventListener('keydown',function(e){if(e.key===' '||e.key==='Enter')rememberChecked(e);});
            panel.addEventListener('click',function(e){var label=e.target.closest('.choice-options label');if(!label)return;var wasChecked=label.dataset.wasChecked==='true';delete label.dataset.wasChecked;var radio=label.querySelector('input');if(wasChecked&&radio.value){e.preventDefault();label.closest('fieldset').querySelector('.choice-options input').checked=true;applyFilters();}});
            Object.keys(controls).forEach(function(k){if(controls[k])controls[k].addEventListener(k==='search'?'input':'change',applyFilters);});sort.addEventListener('change',applyFilters);clear.addEventListener('click',clearFilters);panelClear.addEventListener('click',clearFilters);applyFilters();
            document.addEventListener('click',function(e){var more=e.target.closest('[data-video-more]');if(more){var section=more.closest('[data-video-section]'),hidden=Array.from(section.querySelectorAll('[data-video-extra][hidden]'));hidden.slice(0,6).forEach(function(card){card.hidden=false;});var left=Math.max(0,hidden.length-6);more.hidden=left===0;more.textContent='Carregar mais '+Math.min(6,left);more.setAttribute('aria-expanded','true');return;}var t=e.target.closest('.tabs button');if(t){var h=t.closest('.hub-inner'),n=t.getAttribute('data-t');h.querySelectorAll('.tabs button').forEach(function(b){var active=b.getAttribute('data-t')===n;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});h.querySelectorAll('.pane').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-p')===n);});var sc=h.closest('.hub');if(sc)sc.scrollTop=0;}});
          `,
        }}
      ></script>
    </Layout>,
  );
}

export function slotPage(opts: { slot: SlotView; authed: boolean; mine: boolean }): string {
  const { slot, authed, mine } = opts;
  return doc(
    <Layout title={slot.gameName ?? "Sessão"}>
      <div class="topbar">
        <div class="title">🗓 {slot.gameName ?? "Noite de jogos"}</div>
        <a class="btn" href="/">Início</a>
      </div>
      <main class="play one">
        <div class="slots">
          <SlotCard s={slot} authed={authed} mine={mine} big />
        </div>
      </main>
    </Layout>,
  );
}

export function requestSentPage(opts: { phone: string; ownerWa: string; approved: boolean }): string {
  const { phone, ownerWa, approved } = opts;
  const text = encodeURIComponent(`Olá! Gostaria de jogar um jogo de tabuleiro. Meu WhatsApp: ${phone}`);
  return doc(
    <Layout title={approved ? "Você entrou" : "Solicitação enviada"}>
      <div class="topbar">
        <div class="title">🎲 {approved ? "Você entrou" : "Solicitação enviada"}</div>
        <a class="btn" href="/">Início</a>
      </div>
      <main class="play one">
        <div class="notice">
          {approved ? (
            <>
              <h2>Sua solicitação foi aprovada 🎉</h2>
              <p class="note">Agora você pode participar de qualquer noite de jogos.</p>
              <a class="btn play" href="/">Ver os horários</a>
            </>
          ) : (
            <>
              <h2>Solicitação recebida</h2>
              <p class="note">O responsável aprovará sua solicitação em breve. Toque abaixo para avisá-lo pelo WhatsApp agora.</p>
              {ownerWa ? <a class="btn play" href={`https://wa.me/${ownerWa}?text=${text}`} target="_blank" rel="noopener">Falar com o responsável</a> : null}
            </>
          )}
        </div>
      </main>
    </Layout>,
  );
}

export function membersAdminPage(opts: { members: Member[] }): string {
  const { members } = opts;
  const pending = members.filter((m) => m.status === "pending");
  const others = members.filter((m) => m.status !== "pending");
  return doc(
    <Layout title="Solicitações de acesso">
      <div class="topbar">
        <div class="title">🎲 Solicitações de acesso</div>
        <a class="btn" href="/">Início</a>
      </div>
      <main class="play">
        <h2 class="sec">Pendentes ({pending.length})</h2>
        {pending.length === 0 ? <p class="note">Nenhuma solicitação pendente.</p> : null}
        {pending.map((m) => (
          <div class="req">
            <div class="req-info">
              <b>{m.name ?? "Alguém"}</b>
              <span class="note">✉️ {m.email}</span>
            </div>
            <div class="req-actions">
              <form method="post" action="/admin/requests/approve">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn play" type="submit">Aprovar</button>
              </form>
              <form method="post" action="/admin/requests/deny">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn leave" type="submit">Negar</button>
              </form>
            </div>
          </div>
        ))}
        <h2 class="sec">Aprovados e negados</h2>
        {others.map((m) => (
          <div class="req">
            <div class="req-info">
              <b>{m.name ?? m.email}</b>
              <span class="note">✉️ {m.email} · {m.status === "approved" ? "aprovado" : "negado"}</span>
            </div>
            {m.status === "approved" ? (
              <form method="post" action="/admin/requests/deny">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn leave" type="submit">Revogar</button>
              </form>
            ) : (
              <form method="post" action="/admin/requests/approve">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn play" type="submit">Permitir</button>
              </form>
            )}
          </div>
        ))}
      </main>
    </Layout>,
  );
}

export function pendingPage(opts: { name?: string }): string {
  return doc(
    <Layout title="Aguardando aprovação">
      <div class="topbar">
        <div class="title">🎲 Quase lá</div>
        <a class="btn" href="/">Início</a>
      </div>
      <main class="play one">
        <div class="notice">
          <h2>Olá{opts.name ? `, ${opts.name}` : ""} 👋</h2>
          <p class="note">Você entrou com o Google. O responsável foi avisado e aprovará sua solicitação em breve — depois disso, você poderá participar das noites de jogos. Esta página liberará seu acesso assim que ela for aprovada.</p>
          <a class="btn play" href="/">Verificar novamente</a>
        </div>
      </main>
    </Layout>,
  );
}

export function deniedPage(): string {
  return doc(
    <Layout title="Sem acesso">
      <div class="topbar">
        <div class="title">🎲 Jogos de tabuleiro</div>
        <a class="btn" href="/">Início</a>
      </div>
      <main class="play one">
        <div class="notice">
          <h2>Acesso não concedido</h2>
          <p class="note">Sua conta não tem acesso. Se você acha que isso é um engano, fale com o responsável.</p>
        </div>
      </main>
    </Layout>,
  );
}

export function noticePage(opts: { title: string; message: string }): string {
  return doc(
    <Layout title={opts.title}>
      <div class="topbar">
        <div class="title">🎲 Jogos de tabuleiro</div>
        <a class="btn" href="/">Início</a>
      </div>
      <main class="play one">
        <div class="notice">
          <h2>{opts.title}</h2>
          <p class="note">{opts.message}</p>
        </div>
      </main>
    </Layout>,
  );
}

export function invitePage(opts: { link: string; email: string; role: string }): string {
  const { link, email, role } = opts;
  return doc(
    <Layout title="Convite criado">
      <div class="topbar">
        <div class="title">Convite criado</div>
        <a class="btn" href="/">← Voltar</a>
      </div>
      <div class="card">
        <div class="info">
          <div class="name">Convite criado</div>
          <p class="note">
            Compartilhe com <strong>{email}</strong> (perfil <strong>{role}</strong>). Não expira.
          </p>
          <input
            class="note"
            readonly
            value={link}
            onclick="this.select()"
            style="width:100%;padding:12px;border-radius:8px;border:1px solid #ffffff33;background:#0009;color:#fff"
          />
        </div>
      </div>
    </Layout>,
  );
}
