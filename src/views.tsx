/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from "hono/jsx";
import type { Game, GameGroup } from "./games.ts";
import type { Permission } from "./whitelist.ts";
import { sign } from "./asset/auth.ts";

// Signed cover URL: prefer BGG's full-res original, fall back to Ludopedia,
// else the note's raw image / a placeholder.
const coverSrc = (g: Game): string => {
  const source = g.bggId ? "bgg" : g.ludopediaId ? "ludopedia" : null;
  if (source) {
    const key = { entity: g.id, kind: "cover", source, variant: "original", ext: "jpg" };
    return `/asset/${g.id}/cover/${source}/original.jpg?${sign(key, { w: 400 })}`;
  }
  return g.image ?? "";
};

const canSeeSale = (perm: Permission) => !!perm.canSeePrices || !!perm.admin;

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

const doc = (el: { toString(): string }): string => "<!doctype html>" + el.toString();

const CoverImg: FC<{ g: Game; cls: string }> = ({ g, cls }) => {
  const src = coverSrc(g);
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

const ExpansionRow: FC<{ g: Game; perm: Permission; whatsapp: string }> = ({ g, perm, whatsapp }) => (
  <div class="exp">
    <span class="ename">+ {g.name}</span>
    <SaleBadge g={g} perm={perm} />
    {canSeeSale(perm) && (g.salePrice || g.price) ? <span class="eprice">{g.salePrice ?? g.price}</span> : null}
    <BidButton g={g} perm={perm} whatsapp={whatsapp} cls="ebid" />
  </div>
);

const Info: FC<{ grp: GameGroup; perm: Permission; whatsapp: string }> = ({ grp, perm, whatsapp }) => {
  const g = grp.base;
  return (
    <>
      <div class="tags">
        <SaleBadge g={g} perm={perm} />
        <Tags g={g} />
      </div>
      <div class="name">{g.name}</div>
      <PriceLine g={g} perm={perm} />
      <Links g={g} />
      <BidButton g={g} perm={perm} whatsapp={whatsapp} />
      {grp.expansions.length ? (
        <div class="exps">
          {grp.expansions.map((e) => <ExpansionRow g={e} perm={perm} whatsapp={whatsapp} />)}
        </div>
      ) : null}
    </>
  );
};

// Closed 3D box on the shelf. Cover art is the front face; tinted top + right
// faces give it depth. `--tint` colors the faces and the stage glow; `box--mN`
// picks one of 4 box proportions (index % 4). Links to the detail overlay.
const Box: FC<{ grp: GameGroup; perm: Permission; i: number }> = ({ grp, perm, i }) => {
  const g = grp.base;
  const tint = g.tint ?? "#3a3a44";
  return (
    <a class={`box box--m${i % 4}`} href={`#g-${g.id}`} style={`--tint:${tint}`}>
      <span class="stage"></span>
      <span class="box3d">
        <span class="face front"><CoverImg g={g} cls="faceimg" /></span>
        <span class="face side"></span>
        <span class="face top"></span>
      </span>
      {g.forSale && canSeeSale(perm) ? <span class="tsale">SALE</span> : null}
      <span class="box-name">{g.name}</span>
    </a>
  );
};

// Full-screen detail, shown via :target when its box is tapped. The box sits
// behind a translucent panel with its lid lifted off the tray (open animation).
const Detail: FC<{ grp: GameGroup; perm: Permission; whatsapp: string }> = ({ grp, perm, whatsapp }) => {
  const g = grp.base;
  const tint = g.tint ?? "#3a3a44";
  return (
    <div class="detail" id={`g-${g.id}`} style={`--tint:${tint}`}>
      <a class="detail-bg" href="#" aria-label="Close"></a>
      <div class="obox">
        <span class="face tfront"></span>
        <span class="face side"></span>
        <span class="face top"></span>
        <span class="face lid"><CoverImg g={g} cls="faceimg" /></span>
      </div>
      <div class="panel">
        <a class="close" href="#" aria-label="Close">✕</a>
        <Info grp={grp} perm={perm} whatsapp={whatsapp} />
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
  login?: { error?: string };
}): string {
  const { groups, totalGames, forSaleCount, perm, email, whatsapp, roles, defaultRole, isAuthed, showAll, hiddenCount, login } = opts;
  const isTemp = perm.roles.length > 0 && !perm.admin && !perm.name;
  const subtitle = canSeeSale(perm) ? `${totalGames} games · ${forSaleCount} for sale` : `${totalGames} games`;
  const showLogin = !!login;

  return doc(
    <Layout title="Board Game Collection">
      <div class="topbar">
        <div>
          <div class="title">🎲 Collection</div>
          <div class="sub">{subtitle}</div>
        </div>
        <div class="right">
          {showAll ? (
            <a class="btn" href="/">🎲 Games</a>
          ) : hiddenCount > 0 ? (
            <a class="btn" href="/?show=all">All +{hiddenCount}</a>
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
      <div class="shelf">{groups.map((grp, i) => <Box grp={grp} perm={perm} i={i} />)}</div>
      {groups.map((grp) => <Detail grp={grp} perm={perm} whatsapp={whatsapp} />)}
      {perm.admin ? <InviteForm roles={roles} defaultRole={defaultRole} /> : null}
      {!isAuthed && !showLogin ? (
        <a href="/login" class="lock" title="Sign in" aria-label="Sign in">🔒</a>
      ) : null}
      {showLogin ? <LoginModal error={login?.error} /> : null}
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
