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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#0f0f14; --card:#1a1a24; --fg:#e7e7ea; --muted:#9a9aa6; --accent:#8b5cf6; --sale:#22c55e; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:20px 24px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #ffffff14; gap:12px; flex-wrap:wrap; }
  header h1 { font-size:20px; margin:0; }
  .muted { color:var(--muted); font-size:14px; }
  a { color:var(--accent); }
  main { padding:24px; max-width:1200px; margin:0 auto; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid #ffffff10; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; }
  .card img { width:100%; aspect-ratio: 4/3; object-fit:cover; background:#000; }
  .card .body { padding:12px; display:flex; flex-direction:column; gap:6px; flex:1; }
  .card h3 { font-size:15px; margin:0; line-height:1.3; }
  .tag { display:inline-block; font-size:11px; padding:2px 8px; border-radius:99px; background:#ffffff14; color:var(--muted); }
  .sale { background:var(--sale)22; color:var(--sale); border:1px solid var(--sale)55; }
  .price { font-weight:600; }
  .btn { display:inline-block; text-align:center; padding:10px 14px; border-radius:8px; background:var(--accent); color:#fff; text-decoration:none; font-weight:600; border:0; cursor:pointer; font-size:14px; }
  .btn.sale { background:var(--sale); color:#04120a; }
  .btn.sm { padding:5px 10px; font-size:12px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .expansions { margin-top:8px; padding-top:8px; border-top:1px dashed #ffffff1f; display:flex; flex-direction:column; gap:8px; }
  .exp-label { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  .exp-row { display:flex; flex-direction:column; gap:4px; padding-left:10px; border-left:2px solid #ffffff1f; }
  .exp-row .name { font-size:13px; }
  form.login { max-width:380px; margin:10vh auto; background:var(--card); padding:28px; border-radius:14px; display:flex; flex-direction:column; gap:14px; }
  input[type=email] { padding:12px; border-radius:8px; border:1px solid #ffffff22; background:#00000033; color:var(--fg); font-size:15px; }
  .note { font-size:13px; color:var(--muted); }
  .badge { font-size:12px; padding:3px 9px; border-radius:99px; background:#ffffff14; }
  .lock { position:fixed; left:16px; bottom:16px; z-index:5; font-size:20px; opacity:.25; text-decoration:none; transition:opacity .2s; }
  .lock:hover { opacity:.7; }
  .invite { background:var(--card); border:1px solid #ffffff10; border-radius:12px; padding:16px 18px; margin-bottom:20px; }
  .invite h2 { font-size:16px; margin:0 0 4px; }
  .invite input, .invite select { padding:10px; border-radius:8px; border:1px solid #ffffff22; background:#00000033; color:var(--fg); font-size:14px; }
  .invite input[type=email] { min-width:240px; flex:1; }
  .page.blurred { filter: blur(6px); pointer-events:none; user-select:none; transition:filter .2s; }
  .overlay { position:fixed; inset:0; z-index:20; display:grid; place-items:center; background:#00000088; padding:20px; }
  .modal { position:relative; background:var(--card); border:1px solid #ffffff1a; border-radius:14px; padding:26px 28px; width:min(380px,100%); display:flex; flex-direction:column; gap:14px; box-shadow:0 24px 70px #000a; }
  .modal input { padding:12px; border-radius:8px; border:1px solid #ffffff22; background:#00000033; color:var(--fg); font-size:15px; }
  .modal .x { position:absolute; top:14px; right:16px; color:var(--muted); text-decoration:none; font-size:16px; }
  .modal .x:hover { color:var(--fg); }
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
  const showPrice = !!perm.canSeePrices || !!perm.admin;
  return showPrice && (g.salePrice || g.price) ? `<div class="price">${esc(g.salePrice ?? g.price)}</div>` : "";
}

function bidButton(g: Game, perm: Permission, whatsapp: string, small = false): string {
  if (!g.forSale || !perm.canBid) return "";
  const text = encodeURIComponent(`Hi! I'd like to make a bid on "${g.name}". My offer: R$ `);
  return `<a class="btn sale${small ? " sm" : ""}" href="https://wa.me/${esc(whatsapp)}?text=${text}" target="_blank" rel="noopener">Make a bid</a>`;
}

function linksOf(g: Game): string {
  return [
    g.urlBgg ? `<a href="${esc(g.urlBgg)}" target="_blank" rel="noopener">BGG</a>` : "",
    g.urlLudopedia ? `<a href="${esc(g.urlLudopedia)}" target="_blank" rel="noopener">Ludopedia</a>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function saleBadgeOf(g: Game, perm: Permission): string {
  const canSeeSale = !!perm.canSeePrices || !!perm.admin;
  return g.forSale && canSeeSale ? `<span class="tag sale">FOR SALE</span>` : "";
}

function expansionRow(g: Game, perm: Permission, whatsapp: string): string {
  const badge = saleBadgeOf(g, perm);
  const price = priceLineOf(g, perm);
  const bid = bidButton(g, perm, whatsapp, true);
  return `<div class="exp-row">
    <div class="row"><span class="name">+ ${esc(g.name)}</span>${badge}</div>
    ${price}
    ${bid}
  </div>`;
}

function groupCard(grp: GameGroup, perm: Permission, whatsapp: string): string {
  const g = grp.base;
  const img = g.hasCover
    ? `<img src="/covers/${esc(g.coverKey ?? "")}" alt="${esc(g.name)}" loading="lazy">`
    : g.image
    ? `<img src="${esc(g.image)}" alt="${esc(g.name)}" loading="lazy">`
    : `<div style="aspect-ratio:4/3;display:grid;place-items:center;color:#555">🎲</div>`;
  const saleBadge = saleBadgeOf(g, perm);
  const links = linksOf(g);
  const expansions = grp.expansions.length
    ? `<div class="expansions"><div class="exp-label">Expansions (${grp.expansions.length})</div>${grp.expansions
        .map((e) => expansionRow(e, perm, whatsapp))
        .join("")}</div>`
    : "";

  return `<article class="card">
    ${img}
    <div class="body">
      <div class="row">${saleBadge}${g.language ? `<span class="tag">${esc(g.language)}</span>` : ""}</div>
      <h3>${esc(g.name)}</h3>
      ${priceLineOf(g, perm)}
      ${links ? `<div class="muted">${links}</div>` : ""}
      ${bidButton(g, perm, whatsapp)}
      ${expansions}
      <div style="flex:1"></div>
    </div>
  </article>`;
}

function inviteForm(roles: string[], defaultRole: string): string {
  const opts = roles
    .map((r) => `<option value="${esc(r)}"${r === defaultRole ? " selected" : ""}>${esc(r)}</option>`)
    .join("");
  return `<section class="invite">
    <h2>Invite a temporary user</h2>
    <p class="note">Adds the user to the JSONL store and generates a login link (no expiry). Revoke later by removing them from the store.</p>
    <form class="row" method="post" action="/admin/invite">
      <input type="email" name="email" placeholder="guest@example.com" required>
      <select name="role">${opts}</select>
      <button class="btn" type="submit">Create invite link</button>
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
  login?: { error?: string };
}): string {
  const { groups, totalGames, forSaleCount, perm, email, whatsapp, roles, defaultRole, isAuthed, login } = opts;
  const cards = groups.map((grp) => groupCard(grp, perm, whatsapp)).join("\n");
  const isTemp = perm.roles.length > 0 && !perm.admin && !perm.name;
  const canSeeSale = !!perm.canSeePrices || !!perm.admin;
  const subtitle = canSeeSale ? `${totalGames} games · ${forSaleCount} for sale` : `${totalGames} games`;
  const showLogin = !!login;
  // Public visitors get a discreet lock link to the hidden login; signed-in
  // users get their identity + logout (+ the invite form for admins).
  const controls = isAuthed
    ? `<span class="badge">${esc(perm.name ?? email)}${perm.roles.length ? " · " + esc(perm.roles.join(", ")) : ""}${isTemp ? " · guest" : ""}</span>
       <a class="btn" href="/auth/logout">Log out</a>`
    : "";
  // Anonymous visitors get a discreet bottom-left lock linking to the hidden login.
  const lockBtn =
    !isAuthed && !showLogin
      ? `<a href="/login" class="lock" title="Sign in" aria-label="Sign in">🔒</a>`
      : "";
  const body = `
  <div class="page${showLogin ? " blurred" : ""}">
  <header>
    <div>
      <h1>🎲 Board Game Collection</h1>
      <div class="muted">${subtitle}</div>
    </div>
    <div class="row">${controls}</div>
  </header>
  <main>
    ${perm.admin ? inviteForm(roles, defaultRole) : ""}
    <div class="grid">${cards}</div>
  </main>
  </div>
  ${lockBtn}
  ${showLogin ? loginModal(login?.error) : ""}`;
  return layout("Board Game Collection", body);
}

export function invitePage(opts: { link: string; email: string; role: string }): string {
  const { link, email, role } = opts;
  const body = `
  <header><h1>🎲 Invite created</h1><a class="btn" href="/">← Back</a></header>
  <main>
    <section class="invite">
      <p>Share this link with <strong>${esc(email)}</strong> (role <strong>${esc(role)}</strong>). It does not expire.</p>
      <input type="text" readonly value="${esc(link)}" onclick="this.select()" style="width:100%">
      <p class="note">${esc(email)} is now in the temp-user store. Opening this link signs them in with the ${esc(role)} role. Remove them from the store to revoke access.</p>
    </section>
  </main>`;
  return layout("Invite created", body);
}
