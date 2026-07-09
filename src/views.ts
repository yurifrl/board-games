import type { Game, GameGroup } from "./games.ts";
import type { Permission } from "./whitelist.ts";

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#000; --fg:#fff; --muted:#ffffffa0; --accent:#8b5cf6; --sale:#22c55e; }
  * { box-sizing: border-box; margin:0; padding:0; }
  html, body { height:100%; background:var(--bg); color:var(--fg); font-family: system-ui, -apple-system, sans-serif; }
  body { overflow-y: scroll; -webkit-overflow-scrolling: touch; }
  body.view-feed { scroll-snap-type: y mandatory; }
  body::-webkit-scrollbar { display:none; }

  /* Grid view (default). Feed hidden until toggled. */
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2px;
    padding: calc(58px + env(safe-area-inset-top)) 0 env(safe-area-inset-bottom);
  }
  @media (min-width: 640px) { .grid { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 960px) { .grid { grid-template-columns: repeat(4, 1fr); } }
  .tile { position:relative; aspect-ratio: 3/4; overflow:hidden; background:#111; text-decoration:none; }
  .tile img { width:100%; height:100%; object-fit:cover; display:block; }
  .tile .tname {
    position:absolute; left:0; right:0; bottom:0; padding:22px 10px 8px;
    font-size:13px; font-weight:600; color:#fff; line-height:1.2;
    background: linear-gradient(to top, #000d, transparent);
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
  }
  .tile .tsale { position:absolute; top:8px; left:8px; font-size:10px; font-weight:700; padding:3px 7px; border-radius:99px; background:var(--sale); color:#04120a; }

  .feed { display:none; }
  body.view-feed .grid { display:none; }
  body.view-feed .feed { display:block; }
  .card {
    position: relative;
    height: 100vh; height: 100dvh;
    width: 100%;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    overflow: hidden;
    display: flex;
    align-items: flex-end;
    background:#111;
  }
  .card .cover {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    background:#000;
  }
  .card .shade {
    position: absolute; inset: 0;
    background: linear-gradient(to top, #000e 0%, #0009 12%, #0000 38%);
    pointer-events: none;
  }
  .card .info {
    position: relative;
    width: 100%;
    padding: 24px 22px calc(22px + env(safe-area-inset-bottom));
    display: flex; flex-direction: column; gap: 10px;
  }
  .name { font-size: 26px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 12px #000a; }
  .tags { display:flex; gap:8px; flex-wrap:wrap; }
  .tag { font-size:12px; padding:4px 10px; border-radius:99px; background:#ffffff22; backdrop-filter: blur(6px); color:#fff; }
  .tag.sale { background: var(--sale); color:#04120a; font-weight:600; }
  .price { font-size:18px; font-weight:600; }
  .links { display:flex; gap:14px; font-size:13px; }
  .links a { color:#fff; opacity:.8; text-decoration:none; }
  .links a:hover { opacity:1; text-decoration:underline; }
  .bid { display:inline-block; margin-top:4px; padding:11px 18px; border-radius:99px; background:var(--sale); color:#04120a; text-decoration:none; font-weight:700; font-size:14px; }

  .exps { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  .exp { display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; background:#ffffff14; backdrop-filter: blur(6px); }
  .exp .ename { font-size:13px; font-weight:500; flex:1; }
  .exp .eprice { font-size:12px; font-weight:600; }
  .exp .ebid { font-size:11px; font-weight:700; color:var(--sale); text-decoration:none; }

  /* Floating top bar */
  .topbar {
    position: fixed; top:0; left:0; right:0; z-index:10;
    display:flex; justify-content:space-between; align-items:center;
    padding: calc(12px + env(safe-area-inset-top)) 18px 16px;
    background: linear-gradient(to bottom, #000a, transparent);
    gap:10px;
  }
  .topbar .title { font-size:17px; font-weight:700; }
  .topbar .sub { font-size:12px; color:var(--muted); }
  .topbar .right { display:flex; gap:8px; align-items:center; }
  .badge { font-size:12px; padding:4px 10px; border-radius:99px; background:#ffffff22; backdrop-filter: blur(6px); }
  .btn { display:inline-block; padding:8px 14px; border-radius:99px; background:#ffffff22; color:#fff; text-decoration:none; font-weight:600; font-size:13px; backdrop-filter: blur(6px); border:0; cursor:pointer; }

  /* Admin invite panel (floating) */
  .invite {
    position: fixed; left:18px; right:18px; bottom: calc(22px + env(safe-area-inset-bottom)); z-index:15;
    background:#000c; backdrop-filter: blur(14px); border:1px solid #ffffff22; border-radius:14px; padding:16px;
    display:none;
  }
  .invite.open { display:block; }
  .invite h2 { font-size:15px; margin-bottom:8px; }
  .invite form { display:flex; gap:8px; flex-wrap:wrap; }
  .invite input, .invite select { padding:10px 12px; border-radius:8px; border:1px solid #ffffff33; background:#0009; color:#fff; font-size:14px; }
  .invite input[type=email] { flex:1; min-width:180px; }
  .invite .btn { background:var(--accent); }

  /* Login modal */
  .overlay { position:fixed; inset:0; z-index:20; display:grid; place-items:center; background:#000b; padding:20px; }
  .modal { position:relative; background:#1a1a24; border:1px solid #ffffff1a; border-radius:16px; padding:28px; width:min(380px,100%); display:flex; flex-direction:column; gap:14px; box-shadow:0 24px 70px #000a; }
  .modal input { padding:13px; border-radius:10px; border:1px solid #ffffff22; background:#0006; color:#fff; font-size:15px; }
  .modal .btn { background:var(--accent); text-align:center; padding:13px; }
  .modal .x { position:absolute; top:14px; right:16px; color:var(--muted); text-decoration:none; font-size:16px; }
  .note { font-size:13px; color:var(--muted); }

  .lock { position:fixed; right:18px; bottom: calc(22px + env(safe-area-inset-bottom)); z-index:10; font-size:22px; opacity:.3; text-decoration:none; transition:opacity .2s; }
  .lock:hover { opacity:.9; }
</style>
</head>
<body>${body}</body>
</html>`;
}

export function loginModal(error?: string): string {
  return `<div class="overlay">
    <form class="modal" method="post" action="/auth/login">
      <a class="x" href="/" title="Close" aria-label="Close">✕</a>
      <h2 style="margin:0;font-size:18px">🎲 Sign in</h2>
      ${error ? `<p class="note" style="color:#f87171;margin:0">${esc(error)}</p>` : ""}
      <input type="email" name="email" placeholder="you@example.com" autocomplete="username" required autofocus>
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
      <button class="btn" type="submit">Sign in</button>
    </form>
  </div>`;
}

function priceLineOf(g: Game, perm: Permission): string {
  const show = !!perm.canSeePrices || !!perm.admin;
  return show && (g.salePrice || g.price) ? `<div class="price">${esc(g.salePrice ?? g.price)}</div>` : "";
}

function bidButton(g: Game, perm: Permission, whatsapp: string): string {
  if (!g.forSale || !perm.canBid) return "";
  const text = encodeURIComponent(`Hi! I'd like to make a bid on "${g.name}". My offer: R$ `);
  return `<a class="bid" href="https://wa.me/${esc(whatsapp)}?text=${text}" target="_blank" rel="noopener">Make a bid</a>`;
}

function linksOf(g: Game): string {
  return [
    g.urlBgg ? `<a href="${esc(g.urlBgg)}" target="_blank" rel="noopener">BGG</a>` : "",
    g.urlLudopedia ? `<a href="${esc(g.urlLudopedia)}" target="_blank" rel="noopener">Ludopedia</a>` : "",
  ].filter(Boolean).join("");
}

function saleBadgeOf(g: Game, perm: Permission): string {
  const canSee = !!perm.canSeePrices || !!perm.admin;
  return g.forSale && canSee ? `<span class="tag sale">FOR SALE</span>` : "";
}

function tagsOf(g: Game): string {
  const t: string[] = [];
  if (g.language) t.push(`<span class="tag">${esc(g.language)}</span>`);
  if (g.purchaseDate) t.push(`<span class="tag">📅 ${esc(g.purchaseDate)}</span>`);
  return t.join("");
}

function expansionRow(g: Game, perm: Permission, whatsapp: string): string {
  const price = (perm.canSeePrices || perm.admin) && (g.salePrice || g.price) ? `<span class="eprice">${esc(g.salePrice ?? g.price)}</span>` : "";
  const bid = bidButton(g, perm, whatsapp).replace('class="bid"', 'class="ebid"');
  return `<div class="exp"><span class="ename">+ ${esc(g.name)}</span>${saleBadgeOf(g, perm)}${price}${bid}</div>`;
}

function feedCard(grp: GameGroup, perm: Permission, whatsapp: string): string {
  const g = grp.base;
  const cover = coverImg(g, "cover");
  const exps = grp.expansions.length
    ? `<div class="exps">${grp.expansions.map((e) => expansionRow(e, perm, whatsapp)).join("")}</div>`
    : "";
  const links = linksOf(g);
  return `<section class="card" id="g-${esc(g.id)}">
    ${cover}
    <div class="shade"></div>
    <div class="info">
      <div class="tags">${saleBadgeOf(g, perm)}${tagsOf(g)}</div>
      <div class="name">${esc(g.name)}</div>
      ${priceLineOf(g, perm)}
      ${links ? `<div class="links">${links}</div>` : ""}
      ${bidButton(g, perm, whatsapp)}
      ${exps}
    </div>
  </section>`;
}

function coverImg(g: Game, cls: string): string {
  const src = g.hasCover ? `/covers/${esc(g.coverKey ?? "")}` : g.image ? esc(g.image) : "";
  return src
    ? `<img class="${cls}" src="${src}" alt="${esc(g.name)}" loading="lazy">`
    : `<div class="${cls}" style="display:grid;place-items:center;font-size:64px">🎲</div>`;
}

function gridTile(grp: GameGroup, perm: Permission): string {
  const g = grp.base;
  return `<a class="tile" href="#g-${esc(g.id)}" onclick="setView('feed')">${coverImg(g, "timg")}${saleBadgeOf(g, perm) ? `<span class="tsale">SALE</span>` : ""}<span class="tname">${esc(g.name)}</span></a>`;
}

function inviteForm(roles: string[], defaultRole: string): string {
  const opts = roles.map((r) => `<option value="${esc(r)}"${r === defaultRole ? " selected" : ""}>${esc(r)}</option>`).join("");
  return `<section class="invite" id="invitePanel">
    <h2>Invite a temporary user</h2>
    <form method="post" action="/admin/invite">
      <input type="email" name="email" placeholder="guest@example.com" required>
      <select name="role">${opts}</select>
      <button class="btn" type="submit">Create link</button>
    </form>
  </section>`;
}

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
  const cards = groups.map((grp) => feedCard(grp, perm, whatsapp)).join("\n");
  const tiles = groups.map((grp) => gridTile(grp, perm)).join("");
  const isTemp = perm.roles.length > 0 && !perm.admin && !perm.name;
  const canSeeSale = !!perm.canSeePrices || !!perm.admin;
  const subtitle = canSeeSale ? `${totalGames} games · ${forSaleCount} for sale` : `${totalGames} games`;
  const showLogin = !!login;

  const filterToggle = showAll
    ? `<a class="btn" href="/">🎲 Games</a>`
    : hiddenCount > 0
    ? `<a class="btn" href="/?show=all">All +${hiddenCount}</a>`
    : "";
  const controls = isAuthed
    ? `<span class="badge">${esc(perm.name ?? email)}${perm.roles.length ? " · " + esc(perm.roles.join(", ")) : ""}${isTemp ? " · guest" : ""}</span>
       <a class="btn" href="/auth/logout">Exit</a>`
    : "";
  const adminBtn = perm.admin ? `<a class="btn" href="#invitePanel" onclick="document.getElementById('invitePanel').classList.toggle('open');return false">Invite</a>` : "";
  const viewToggle = `<button class="btn" onclick="setView(document.body.classList.contains('view-feed')?'grid':'feed')" title="Toggle grid / feed" aria-label="Toggle view">☷</button>`;
  const lockBtn = !isAuthed && !showLogin ? `<a href="/login" class="lock" title="Sign in" aria-label="Sign in">🔒</a>` : "";

  const body = `
  <div class="topbar">
    <div><div class="title">🎲 Collection</div><div class="sub">${esc(subtitle)}</div></div>
    <div class="right">${viewToggle}${filterToggle}${adminBtn}${controls}</div>
  </div>
  <div class="grid">${tiles}</div>
  <div class="feed">${cards}</div>
  ${perm.admin ? inviteForm(roles, defaultRole) : ""}
  ${lockBtn}
  ${showLogin ? loginModal(login?.error) : ""}
  <script>function setView(v){document.body.className=v==='feed'?'view-feed':'';localStorage.setItem('view',v);}if(localStorage.getItem('view')==='feed')setView('feed');</script>`;
  return layout("Board Game Collection", body);
}

export function invitePage(opts: { link: string; email: string; role: string }): string {
  const { link, email, role } = opts;
  const body = `
  <div class="topbar"><div class="title">Invite created</div><a class="btn" href="/">← Back</a></div>
  <div class="card"><div class="info">
    <div class="name">Invite created</div>
    <p class="note">Share with <strong>${esc(email)}</strong> (role <strong>${esc(role)}</strong>). Does not expire.</p>
    <input class="note" readonly value="${esc(link)}" onclick="this.select()" style="width:100%;padding:12px;border-radius:8px;border:1px solid #ffffff33;background:#0009;color:#fff">
  </div></div>`;
  return layout("Invite created", body);
}
