/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from "hono/jsx";
import type { Game, GameGroup } from "./games.ts";
import type { Permission } from "./whitelist.ts";
import type { SlotView } from "./slots.ts";
import type { Member } from "./members.ts";
import { sign } from "./asset/auth.ts";

// Signed cover URL: prefer BGG's full-res original, fall back to Ludopedia,
// else the note's raw image / a placeholder.
export function signedCover(entity: string, source: "bgg" | "ludopedia", w = 400, h?: number): string {
  const key = { entity, kind: "cover", source, variant: "original", ext: "jpg" };
  return `/asset/${entity}/cover/${source}/original.jpg?${sign(key, { w, h })}`;
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
  <html lang="en">
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

const CoverImg: FC<{ g: Game; cls: string; w?: number; h?: number }> = ({ g, cls, w, h }) => {
  const src = coverSrc(g, w, h);
  return src ? (
    <img class={cls} src={src} alt={g.name} loading="lazy" />
  ) : (
    <div class={cls} style="display:grid;place-items:center;font-size:64px">🎲</div>
  );
};

const SaleBadge: FC<{ g: Game; perm: Permission }> = ({ g, perm }) =>
  g.forSale && canSeeSale(perm) ? <span class="tag sale">FOR SALE</span> : null;

const PriceLine: FC<{ g: Game; perm: Permission }> = ({ g, perm }) =>
  canSeeSale(perm) && (g.salePrice || g.price) ? <div class="price">{g.salePrice ?? g.price}</div> : null;

const waHref = (g: Game, whatsapp: string) =>
  `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi! I'd like to make a bid on "${g.name}". My offer: R$ `)}`;

const BidButton: FC<{ g: Game; perm: Permission; whatsapp: string; cls?: string }> = ({ g, perm, whatsapp, cls = "bid" }) =>
  g.forSale && perm.canBid ? (
    <a class={cls} href={waHref(g, whatsapp)} target="_blank" rel="noopener">
      {cls === "ebid" ? "Bid" : "Make a bid"}
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

const providerDump = (data: unknown): string => typeof data === "string" ? data : JSON.stringify(data, null, 2);

function providerUrls(data: unknown): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) urls.add(match[0].replace(/&amp;/g, "&"));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(data);
  return [...urls];
}

const ProviderFacts: FC<{ g: Game }> = ({ g }) => {
  const f = g.facts;
  if (!f) return null;
  const values = [
    ["Year", f.year], ["Players", f.minPlayers && f.maxPlayers ? `${f.minPlayers}–${f.maxPlayers}` : f.minPlayers ?? f.maxPlayers],
    ["Time", f.playTime ? `${f.playTime} min` : undefined], ["Age", f.minAge ? `${f.minAge}+` : undefined],
    ["Complexity", f.complexity?.toFixed(2)], ["Rating", f.rating?.toFixed(2)], ["Rank", f.rank ? `#${f.rank}` : undefined],
    ["Language", f.languageDependency], ["Mechanics", f.mechanics.join(", ")], ["Categories", f.categories.join(", ")],
    ["Designers", f.designers.join(", ")], ["Publishers", f.publishers.join(", ")],
  ].filter(([, value]) => value !== undefined && value !== "");
  return <dl class="provider-facts">{values.map(([label, value]) => <div><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
};

const ProviderPane: FC<{ g: Game; provider: "bgg" | "ludopedia" }> = ({ g, provider }) => {
  const snapshot = g.providerData?.[provider];
  if (!snapshot) return null;
  return (
    <section class="pane provider-pane" data-p={provider}>
      <ProviderFacts g={g} />
      <details><summary>Complete {provider === "bgg" ? "BGG" : "Ludopedia"} response</summary><pre>{providerDump(snapshot.data)}</pre></details>
    </section>
  );
};

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
  const size = g.siteSize;
  const sizeStyle = size ? `;width:${cmToPx(size.widthCm)}px;aspect-ratio:${size.widthCm}/${size.heightCm}` : "";
  const coverWidth = size ? Math.ceil(cmToPx(size.widthCm) * 2) : undefined;
  const coverHeight = size ? Math.ceil(cmToPx(size.heightCm) * 2) : undefined;
  const colon = g.name.indexOf(":");
  return (
    <a
      class={`box${size ? " sized" : ""}`}
      href={`#g-${g.id}`}
      style={`--tint:${tint}${sizeStyle}`}
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
      {g.forSale && canSeeSale(perm) ? <span class="tsale">SALE</span> : null}
      <span class="box-name">
        {colon === -1 ? g.name : <>{g.name.slice(0, colon + 1)}<br />{g.name.slice(colon + 1).trimStart()}</>}
      </span>
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
  const media = [...new Set([providerUrls(g.providerData?.bgg?.data), providerUrls(g.providerData?.ludopedia?.data)].flat())];
  return (
    <div class="detail" id={`g-${g.id}`} style={`--tint:${tint}`}>
      <a class="detail-bg" href="#" aria-label="Close" style={bg ? `background-image:url("${bg}")` : ""}></a>
      <div class="hub">
        <div class="hub-inner">
          <a class="close" href="#" aria-label="Close">✕</a>
          <div class="hub-head">
            <CoverImg g={g} cls="cover" />
            <div>
              <h1>{g.name}</h1>
              <div class="tags">
                <SaleBadge g={g} perm={perm} />
                <Tags g={g} />
              </div>
              <Links g={g} />
            </div>
          </div>

          <div class="tabs">
            <button class="active" data-t="overview">Overview</button>
            {g.providerData?.bgg ? <button data-t="bgg">BGG</button> : null}
            {g.providerData?.ludopedia ? <button data-t="ludopedia">Ludopedia</button> : null}
            {media.length ? <button data-t="media">Files / Media</button> : null}
            {g.notes ? <button data-t="notes">Notes</button> : null}
          </div>

          <section class="pane active" data-p="overview">
            {showSale ? <><h2>This copy</h2><PriceLine g={g} perm={perm} /><BidButton g={g} perm={perm} whatsapp={whatsapp} /></> : null}
            {grp.expansions.length ? (
              <div class="exps">
                <div class="exp-label">Expansions ({grp.expansions.length})</div>
                {grp.expansions.map((e) => <ExpansionRow g={e} perm={perm} whatsapp={whatsapp} />)}
              </div>
            ) : null}
            {!showSale && !grp.expansions.length ? <p class="note">No extra details yet.</p> : null}
          </section>

          <ProviderPane g={g} provider="bgg" />
          <ProviderPane g={g} provider="ludopedia" />
          {media.length ? (
            <section class="pane provider-pane" data-p="media">
              <ul class="provider-links">{media.map((url) => <li><a href={url} target="_blank" rel="noopener">{url}</a></li>)}</ul>
            </section>
          ) : null}
          {g.notes ? (
            <section class="pane" data-p="notes">
              <div class="notes-body">{g.notes}</div>
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
      <a class="x" href="/" title="Close" aria-label="Close">✕</a>
      <h2 style="margin:0;font-size:18px">🎲 Sign in</h2>
      {error ? <p class="note" style="color:#f87171;margin:0">{error}</p> : null}
      <input type="email" name="email" placeholder="you@example.com" autocomplete="username" required autofocus />
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
      <button class="btn" type="submit">Sign in</button>
    </form>
  </div>
);

const InviteForm: FC<{ roles: string[]; defaultRole: string }> = ({ roles, defaultRole }) => (
  <section class="invite" id="invitePanel">
    <h2>Invite a temporary user</h2>
    <form method="post" action="/admin/invite">
      <input type="email" name="email" placeholder="guest@example.com" required />
      <select name="role">
        {roles.map((r) => <option value={r} selected={r === defaultRole}>{r}</option>)}
      </select>
      <button class="btn" type="submit">Create link</button>
    </form>
  </section>
);

// ---- Play: game slots synced from the owner's calendar (shown on the home page) ----

const slotFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});
const whenStr = (iso: string): string => {
  try {
    return slotFmt.format(new Date(iso));
  } catch {
    return iso;
  }
};

const SlotCard: FC<{ s: SlotView; authed: boolean; mine: boolean; big?: boolean }> = ({ s, authed, mine, big }) => (
  <article class={`slot${big ? " big" : ""}`}>
    <div class="slot-cover">
      {s.gameOpen ? (
        <div class="open-cover">🎲<span>Game to be picked</span></div>
      ) : s.coverGameId && s.coverSource ? (
        <img src={signedCover(s.coverGameId, s.coverSource)} alt={s.gameName ?? ""} loading="lazy" />
      ) : (
        <div class="open-cover">🎲<span>{s.gameName}</span></div>
      )}
    </div>
    <div class="slot-body">
      <div class="slot-title">{s.gameOpen ? "Open slot" : s.gameName}</div>
      <div class="slot-meta">
        <span>🗓 {whenStr(s.start)}</span>
        {s.location ? <span>📍 {s.location}</span> : null}
      </div>
      <div class="slot-count">
        <span class={`spots${s.over ? " over" : ""}`}>{s.taken} playing</span>
        {s.capacity != null ? <span class="tag">{s.capacity} seats</span> : null}
        {s.over ? <span class="tag warn">+{s.taken - (s.capacity ?? 0)} waitlist</span> : null}
      </div>
      {authed ? (
        mine ? (
          <form method="post" action={`/slot/${s.id}/leave`}>
            <button class="btn leave" type="submit">Leave</button>
          </form>
        ) : (
          <form method="post" action={`/slot/${s.id}/join`} class="join">
            {s.gameOpen ? <input name="gamePref" placeholder="Game you'd like (optional)" autocomplete="off" /> : null}
            <button class="btn play" type="submit">I want to play</button>
          </form>
        )
      ) : (
        <a class="btn play" href="/auth/google">Sign in to play</a>
      )}
    </div>
  </article>
);

const SlotsSection: FC<{ slots: SlotView[]; authed: boolean; mine: Set<string> }> = ({ slots, authed, mine }) => {
  if (slots.length === 0) return null;
  return (
    <section class="play-section">
      <h2 class="sec">🗓 Upcoming game nights</h2>
      <div class="slots">{slots.map((s) => <SlotCard s={s} authed={authed} mine={mine.has(s.id)} />)}</div>
    </section>
  );
};

const FilterChoice: FC<{ id: string; label: string; options: { value: string; label: string }[] }> = ({ id, label, options }) => (
  <fieldset id={id} class="filter-choice">
    <legend>{label}</legend>
    <div class="choice-options">
      {options.map((option, index) => (
        <label>
          <input type="radio" name={id} value={option.value} checked={index === 0} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

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
    <section class="collection-tools" aria-label="Search and filter games">
      <div class="search-row">
        <label class="search-box">
          <span aria-hidden="true">⌕</span>
          <input id="game-search" type="search" placeholder="Search games or categories…" autocomplete="off" />
        </label>
        <label class="sort-box">
          <span>Sort</span>
          <select id="game-sort">
            <option value="newest">Newest</option>
            <option value="name">Name A–Z</option>
            <option value="playtime-asc">Shortest first</option>
            <option value="playtime-desc">Longest first</option>
          </select>
        </label>
      </div>
      <div id="filter-backdrop" class="filter-backdrop" hidden></div>
      <div id="filter-panel" class="filter-panel" role="dialog" aria-modal="true" aria-labelledby="filter-title" hidden>
        <div class="filter-head">
          <strong id="filter-title">Filters</strong>
          <button id="filter-close" type="button" aria-label="Close filters">✕</button>
        </div>
        <div class="filter-grid">
          <FilterChoice id="game-type" label="Type" options={[{ value: "", label: "All" }, ...types.map((type) => ({ value: type.toLowerCase(), label: type }))]} />
          <FilterChoice id="game-category" label="Your category" options={[{ value: "", label: "All" }, ...categories.map((category) => ({ value: category.toLowerCase(), label: category }))]} />
          {providerCategories.length ? <FilterChoice id="game-provider-category" label="Provider category" options={[{ value: "", label: "All" }, ...providerCategories.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          <FilterChoice id="game-playtime" label="Play time" options={[{ value: "", label: "Any" }, { value: "30", label: "≤ 30m" }, { value: "60", label: "31–60m" }, { value: "120", label: "61–120m" }, { value: "121", label: "2h+" }]} />
          {maxPlayers ? <FilterChoice id="game-players" label="Players" options={[{ value: "", label: "Any" }, ...Array.from({ length: maxPlayers }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))]} /> : null}
          <FilterChoice id="game-complexity" label="Complexity" options={[{ value: "", label: "Any" }, { value: "2", label: "≤ 2" }, { value: "3", label: "2–3" }, { value: "4", label: "3–4" }, { value: "5", label: "4+" }]} />
          <FilterChoice id="game-rating" label="Rating" options={[{ value: "", label: "Any" }, { value: "6", label: "6+" }, { value: "7", label: "7+" }, { value: "8", label: "8+" }, { value: "9", label: "9+" }]} />
          {years.length ? <FilterChoice id="game-year" label="Published" options={[{ value: "", label: "Any" }, ...years.map((year) => ({ value: String(year), label: String(year) }))]} /> : null}
          {mechanics.length ? <FilterChoice id="game-mechanic" label="Mechanic" options={[{ value: "", label: "All" }, ...mechanics.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          {designers.length ? <FilterChoice id="game-designer" label="Designer" options={[{ value: "", label: "All" }, ...designers.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          {publishers.length ? <FilterChoice id="game-publisher" label="Publisher" options={[{ value: "", label: "All" }, ...publishers.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          {languageDependencies.length ? <FilterChoice id="game-language-dependency" label="Language dependency" options={[{ value: "", label: "All" }, ...languageDependencies.map((value) => ({ value: value.toLowerCase(), label: value }))]} /> : null}
          <FilterChoice id="game-played" label="Played" options={[{ value: "", label: "Any" }, { value: "yes", label: "Played" }, { value: "no", label: "Not played" }, { value: "unknown", label: "Not set" }]} />
          {languages.length ? <FilterChoice id="game-language" label="Language" options={[{ value: "", label: "All" }, ...languages.map((language) => ({ value: language.toLowerCase(), label: language }))]} /> : null}
          {canFilterSale ? <FilterChoice id="game-sale" label="Availability" options={[{ value: "", label: "All" }, { value: "yes", label: "For sale" }]} /> : null}
        </div>
      </div>
      <div class="filter-status">
        <span id="game-results" aria-live="polite">{groups.length} {groups.length === 1 ? "game" : "games"}</span>
        <div id="filter-chips" class="filter-chips"></div>
        <button id="clear-filters" type="button" hidden>Clear all</button>
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
  const sized = groups.flatMap(({ base }) => base.siteSize ? [base.siteSize] : []);
  const colw = Math.max(BOX_WIDTH_PX, ...sized.map(({ widthCm }) => cmToPx(widthCm)));
  const rowh = Math.max(SHELF_HEIGHT_PX, ...sized.map(({ heightCm }) => cmToPx(heightCm)));
  const shelfStyle = colw > BOX_WIDTH_PX || rowh > SHELF_HEIGHT_PX
    ? `--colw:${colw}px;--rowh:${rowh}px`
    : undefined;

  return doc(
    <Layout title="Board Game Collection">
      <div class="topbar collection-topbar">
        <div class="right">
          <button id="filter-toggle" class="btn filter-toggle" type="button" aria-controls="filter-panel" aria-expanded="false">
            Filters <span id="filter-count" class="filter-count" hidden>0</span>
          </button>
          {perm.admin ? (
            <a class="btn" href="/admin/requests">Requests</a>
          ) : null}
          {perm.admin ? (
            <a
              class="btn"
              href="#invitePanel"
              onclick="document.getElementById('invitePanel').classList.toggle('open');return false"
            >
              Invite
            </a>
          ) : null}
          {isAuthed ? (
            <>
              <span class="badge">
                {perm.name ?? email}
                {perm.roles.length ? " · " + perm.roles.join(", ") : ""}
                {isTemp ? " · guest" : ""}
              </span>
              <a class="btn" href="/auth/logout">Exit</a>
            </>
          ) : null}
        </div>
      </div>
      <CollectionTools groups={groups} canFilterSale={canSeeSale(perm)} />
      <SlotsSection slots={slots} authed={isAuthed} mine={mineSlots} />
      <div class="shelf" style={shelfStyle}>{groups.map((grp) => <Box grp={grp} perm={perm} />)}</div>
      <div id="filter-empty" class="filter-empty" hidden><b>No games found</b><span>Try clearing a filter or searching for something else.</span></div>
      {groups.map((grp) => <Detail grp={grp} perm={perm} whatsapp={whatsapp} />)}
      {perm.admin ? <InviteForm roles={roles} defaultRole={defaultRole} /> : null}
      {!isAuthed && !showLogin ? (
        <a href="/login" class="lock" title="Sign in" aria-label="Sign in">🔒</a>
      ) : null}
      {showLogin ? <LoginModal error={login?.error} /> : null}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            var boxes=Array.from(document.querySelectorAll('.box')),shelf=document.querySelector('.shelf');
            boxes.forEach(function(b){if(b.classList.contains('sized'))return;var i=b.querySelector('img');if(!i)return;var size=function(){if(i.naturalWidth)b.style.aspectRatio=i.naturalWidth+'/'+i.naturalHeight;};i.complete?size():i.addEventListener('load',size);});
            var controls={search:document.querySelector('#game-search'),type:document.querySelector('#game-type'),category:document.querySelector('#game-category'),providerCategory:document.querySelector('#game-provider-category'),playtime:document.querySelector('#game-playtime'),players:document.querySelector('#game-players'),complexity:document.querySelector('#game-complexity'),rating:document.querySelector('#game-rating'),year:document.querySelector('#game-year'),mechanic:document.querySelector('#game-mechanic'),designer:document.querySelector('#game-designer'),publisher:document.querySelector('#game-publisher'),languageDependency:document.querySelector('#game-language-dependency'),played:document.querySelector('#game-played'),language:document.querySelector('#game-language'),sale:document.querySelector('#game-sale')};
            var sort=document.querySelector('#game-sort'),results=document.querySelector('#game-results'),empty=document.querySelector('#filter-empty'),clear=document.querySelector('#clear-filters'),count=document.querySelector('#filter-count'),chips=document.querySelector('#filter-chips');
            var panel=document.querySelector('#filter-panel'),backdrop=document.querySelector('#filter-backdrop'),filterToggle=document.querySelector('#filter-toggle'),filterClose=document.querySelector('#filter-close');
            function setFilterOpen(open){panel.hidden=!open;backdrop.hidden=!open;filterToggle.setAttribute('aria-expanded',String(open));document.body.classList.toggle('filters-open',open);}
            filterToggle.addEventListener('click',function(){setFilterOpen(panel.hidden);});filterClose.addEventListener('click',function(){setFilterOpen(false);});backdrop.addEventListener('click',function(){setFilterOpen(false);});document.addEventListener('keydown',function(e){if(e.key==='Escape')setFilterOpen(false);});
            function matchesTime(value,range){var n=Number(value);if(!range)return true;if(!n)return false;if(range==='30')return n<=30;if(range==='60')return n>30&&n<=60;if(range==='120')return n>60&&n<=120;return n>120;}
            function includes(value,selected){return !selected||(value||'').split('|').includes(selected);}
            function matchesPlayers(d,value){var n=Number(value);return !n||(Number(d.playersMin)<=n&&Number(d.playersMax)>=n);}
            function matchesComplexity(value,range){var n=Number(value);if(!range)return true;if(!n)return false;if(range==='2')return n<=2;if(range==='3')return n>2&&n<=3;if(range==='4')return n>3&&n<=4;return n>4;}
            function applyFilters(){
              var values={};Object.keys(controls).forEach(function(k){var c=controls[k],input=c&&c.matches('fieldset')?c.querySelector('input:checked'):c;values[k]=input?input.value.trim().toLowerCase():'';});
              var visible=boxes.filter(function(b){var d=b.dataset;var show=(!values.search||d.search.includes(values.search))&&includes(d.type,values.type)&&includes(d.category,values.category)&&includes(d.providerCategory,values.providerCategory)&&includes(d.mechanic,values.mechanic)&&includes(d.designer,values.designer)&&includes(d.publisher,values.publisher)&&includes(d.languageDependency,values.languageDependency)&&(!values.played||d.played===values.played)&&includes(d.language,values.language)&&(!values.sale||d.sale===values.sale)&&matchesTime(d.playtime,values.playtime)&&matchesPlayers(d,values.players)&&matchesComplexity(d.complexity,values.complexity)&&(!values.rating||Number(d.rating)>=Number(values.rating))&&(!values.year||d.year===values.year);b.hidden=!show;return show;});
              visible.sort(function(a,b){if(sort.value==='name')return a.dataset.name.localeCompare(b.dataset.name);var av=Number(sort.value==='newest'?a.dataset.purchased:a.dataset.playtime)||0,bv=Number(sort.value==='newest'?b.dataset.purchased:b.dataset.playtime)||0;return sort.value==='playtime-asc'?(av||Infinity)-(bv||Infinity):bv-av;}).forEach(function(b){shelf.appendChild(b);});
              var active=Object.keys(values).filter(function(k){return values[k];});results.textContent=visible.length+(visible.length===1?' game':' games');empty.hidden=visible.length!==0;clear.hidden=active.length===0;count.hidden=active.length===0;count.textContent=String(active.length);
              chips.replaceChildren();active.forEach(function(k){var control=controls[k],input=control.matches('fieldset')?control.querySelector('input:checked'):control,label=k==='search'?'“'+input.value+'”':input.nextElementSibling.textContent;var chip=document.createElement('button');chip.type='button';chip.textContent=label+' ×';chip.onclick=function(){if(control.matches('fieldset'))control.querySelector('input').checked=true;else control.value='';applyFilters();};chips.appendChild(chip);});
            }
            Object.keys(controls).forEach(function(k){if(controls[k])controls[k].addEventListener(k==='search'?'input':'change',applyFilters);});sort.addEventListener('change',applyFilters);clear.addEventListener('click',function(){Object.keys(controls).forEach(function(k){var c=controls[k];if(!c)return;if(c.matches('fieldset'))c.querySelector('input').checked=true;else c.value='';});applyFilters();});
            document.addEventListener('click',function(e){var t=e.target.closest('.tabs button');if(t){var h=t.closest('.hub-inner'),n=t.getAttribute('data-t');h.querySelectorAll('.tabs button').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-t')===n);});h.querySelectorAll('.pane').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-p')===n);});var sc=h.closest('.hub');if(sc)sc.scrollTop=0;}});
          `,
        }}
      ></script>
    </Layout>,
  );
}

export function slotPage(opts: { slot: SlotView; authed: boolean; mine: boolean }): string {
  const { slot, authed, mine } = opts;
  return doc(
    <Layout title={slot.gameOpen ? "Open slot" : slot.gameName ?? "Slot"}>
      <div class="topbar">
        <div class="title">🗓 {slot.gameOpen ? "Open slot" : slot.gameName}</div>
        <a class="btn" href="/">Home</a>
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
  const text = encodeURIComponent(`Hi! I'd like to play a board game. My WhatsApp: ${phone}`);
  return doc(
    <Layout title={approved ? "You're in" : "Request sent"}>
      <div class="topbar">
        <div class="title">🎲 {approved ? "You're in" : "Request sent"}</div>
        <a class="btn" href="/">Home</a>
      </div>
      <main class="play one">
        <div class="notice">
          {approved ? (
            <>
              <h2>You're approved 🎉</h2>
              <p class="note">You can join any game night now.</p>
              <a class="btn play" href="/">See the slots</a>
            </>
          ) : (
            <>
              <h2>Request received</h2>
              <p class="note">The owner will approve you shortly. Tap below to ping them on WhatsApp now.</p>
              {ownerWa ? <a class="btn play" href={`https://wa.me/${ownerWa}?text=${text}`} target="_blank" rel="noopener">Message the owner</a> : null}
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
    <Layout title="Access requests">
      <div class="topbar">
        <div class="title">🎲 Access requests</div>
        <a class="btn" href="/">Home</a>
      </div>
      <main class="play">
        <h2 class="sec">Pending ({pending.length})</h2>
        {pending.length === 0 ? <p class="note">Nothing pending.</p> : null}
        {pending.map((m) => (
          <div class="req">
            <div class="req-info">
              <b>{m.name ?? "Someone"}</b>
              <span class="note">✉️ {m.email}</span>
            </div>
            <div class="req-actions">
              <form method="post" action="/admin/requests/approve">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn play" type="submit">Approve</button>
              </form>
              <form method="post" action="/admin/requests/deny">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn leave" type="submit">Deny</button>
              </form>
            </div>
          </div>
        ))}
        <h2 class="sec">Approved &amp; denied</h2>
        {others.map((m) => (
          <div class="req">
            <div class="req-info">
              <b>{m.name ?? m.email}</b>
              <span class="note">✉️ {m.email} · {m.status}</span>
            </div>
            {m.status === "approved" ? (
              <form method="post" action="/admin/requests/deny">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn leave" type="submit">Revoke</button>
              </form>
            ) : (
              <form method="post" action="/admin/requests/approve">
                <input type="hidden" name="email" value={m.email} />
                <button class="btn play" type="submit">Allow</button>
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
    <Layout title="Waiting for approval">
      <div class="topbar">
        <div class="title">🎲 Almost there</div>
        <a class="btn" href="/">Home</a>
      </div>
      <main class="play one">
        <div class="notice">
          <h2>Thanks{opts.name ? `, ${opts.name}` : ""} 👋</h2>
          <p class="note">You're signed in with Google. The owner has been pinged and will approve you shortly — then you can join game nights. This page will let you in once you're approved.</p>
          <a class="btn play" href="/">Check again</a>
        </div>
      </main>
    </Layout>,
  );
}

export function deniedPage(): string {
  return doc(
    <Layout title="No access">
      <div class="topbar">
        <div class="title">🎲 Board Games</div>
        <a class="btn" href="/">Home</a>
      </div>
      <main class="play one">
        <div class="notice">
          <h2>Access not granted</h2>
          <p class="note">Your account doesn't have access. If you think that's a mistake, reach out to the owner.</p>
        </div>
      </main>
    </Layout>,
  );
}

export function invitePage(opts: { link: string; email: string; role: string }): string {
  const { link, email, role } = opts;
  return doc(
    <Layout title="Invite created">
      <div class="topbar">
        <div class="title">Invite created</div>
        <a class="btn" href="/">← Back</a>
      </div>
      <div class="card">
        <div class="info">
          <div class="name">Invite created</div>
          <p class="note">
            Share with <strong>{email}</strong> (role <strong>{role}</strong>). Does not expire.
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
