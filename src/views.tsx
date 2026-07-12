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

// Closed 3D box on the shelf. Cover art is the front face; darker tinted top +
// right faces give it depth. `--tint` colors the faces/stage. The box takes the
// cover's own shape (set from the image on the client). Links to the detail.
const Box: FC<{ grp: GameGroup; perm: Permission }> = ({ grp, perm }) => {
  const g = grp.base;
  const tint = g.tint ?? "#3a3a44";
  return (
    <a class="box" href={`#g-${g.id}`} style={`--tint:${tint}`}>
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

// Full-screen game hub, shown via :target when its box is tapped. Cover top-left,
// tabbed pages. Overview/Notes/Links use real data; 0→Hero, Cheat Sheet, Manuals
// and Ask AI are placeholder content until the worker fills them.
const Detail: FC<{ grp: GameGroup; perm: Permission; whatsapp: string }> = ({ grp, perm, whatsapp }) => {
  const g = grp.base;
  const tint = g.tint ?? "#3a3a44";
  const bg = coverSrc(g);
  const showSale = canSeeSale(perm) && (!!g.salePrice || !!g.price);
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
                <span class="tag">🎲 2–4</span>
                <span class="tag">⏱ 45 min</span>
                <span class="tag">🎯 Medium (2.8)</span>
                <SaleBadge g={g} perm={perm} />
                <Tags g={g} />
              </div>
              <Links g={g} />
            </div>
          </div>

          <div class="tabs">
            <button class="active" data-t="overview">Overview</button>
            <button data-t="hero">0 → Hero</button>
            <button data-t="cheat">Cheat Sheet</button>
            <button data-t="manuals">Manuals</button>
            <button data-t="notes">Notes</button>
            <button data-t="ask">Ask AI</button>
          </div>

          <section class="pane active" data-p="overview">
            <div class="facts">
              <div class="f"><b>2–4</b><span>Players</span></div>
              <div class="f"><b>45m</b><span>Playtime</span></div>
              <div class="f"><b>2.8</b><span>Weight</span></div>
              <div class="f"><b>12+</b><span>Age</span></div>
              <div class="f"><b>2023</b><span>Year</span></div>
            </div>
            <p class="lead">Race to build the most valuable engine before the deck runs out — every card you take is a card you deny your rivals.</p>
            <h2>The gist</h2>
            <p>A tight tableau-builder about tempo and denial. On your turn you draft, place, and trigger combos; the tension is that the best card for you is usually the best card for someone else too. Games are short, decisions are sharp, and the winner is often decided by who read the endgame first.</p>
            {showSale ? <><h2>This copy</h2><PriceLine g={g} perm={perm} /><BidButton g={g} perm={perm} whatsapp={whatsapp} /></> : null}
            {grp.expansions.length ? (
              <div class="exps">
                {grp.expansions.map((e) => <ExpansionRow g={e} perm={perm} whatsapp={whatsapp} />)}
              </div>
            ) : null}
          </section>

          <section class="pane" data-p="hero">
            <p>A guided path from never-seen-it to teaching it at the table. Each step has a goal — clear the step when you can do the goal without looking.</p>
            <ol class="ladder">
              <li><div class="st">What are we even doing?</div><div class="goal">Goal: say the theme + win condition in one breath</div><p>You're rival engine-builders. Most points when the deck empties wins. Everything else is detail.</p><div class="chips"><span class="chip">engine</span><span class="chip">win = most VP</span></div></li>
              <li><div class="st">Setup</div><div class="goal">Goal: get the table ready from memory</div><p>Shuffle the main deck, deal 5 to each player, seed the 4-card market, give each player a starting tile. First player is whoever last cooked dinner.</p><div class="chips"><span class="chip">5 cards</span><span class="chip">4-card market</span><span class="chip">start tile</span></div></li>
              <li><div class="st">Your turn (the core loop)</div><div class="goal">Goal: list your turn options without prompting</div><p>Do two of three: <b>Draft</b> a card from the market, <b>Build</b> a card from hand (pay its cost), or <b>Activate</b> a row to collect resources. Refill the market at end of turn.</p><div class="chips"><span class="chip">draft</span><span class="chip">build</span><span class="chip">activate</span><span class="chip">2 of 3</span></div></li>
              <li><div class="st">Scoring</div><div class="goal">Goal: know where every point comes from</div><p>VP come from built cards, completed sets (color majorities), and leftover resources at 3:1. Bonus tiles reward the longest chain.</p><div class="chips"><span class="chip">built cards</span><span class="chip">set majorities</span><span class="chip">chain bonus</span></div></li>
              <li><div class="st">Play it well</div><div class="goal">Goal: make choices on purpose, not by default</div><p>Tempo beats greed early. Deny the card that completes an opponent's set even if it's dead in your hand. Count the deck — when ~8 cards remain, stop building and start cashing out.</p><div class="chips"><span class="chip">tempo</span><span class="chip">denial</span><span class="chip">count the deck</span></div></li>
              <li><div class="st">Teach it back</div><div class="goal">Goal: explain the whole game in 3 minutes</div><p>If you can walk a new player through theme → turn → scoring → “one tip” without notes, you're a hero. Use the Cheat Sheet as your teaching script.</p><div class="chips"><span class="chip">theme</span><span class="chip">turn</span><span class="chip">scoring</span><span class="chip">one tip</span></div></li>
            </ol>
          </section>

          <section class="pane remember" data-p="cheat">
            <p>Everything you keep forgetting mid-game, in one place. Glance here, don't dig through the rulebook.</p>
            <div class="card"><b>Before you start</b><ul><li>Deal 5 cards each, seed the 4-card market.</li><li>Everyone takes exactly one starting tile.</li><li>Agree on the tiebreaker: fewest cards built wins ties.</li></ul></div>
            <div class="card"><b>Every turn (in order)</b><ul><li>Do <b>two of three</b>: Draft / Build / Activate.</li><li>You may repeat the same action twice.</li><li>Refill the market to 4 before passing.</li></ul></div>
            <div class="card"><b>Easy to forget</b><ul><li>Building costs resources <em>and</em> discards the card from hand.</li><li>Activating a row activates the <em>whole</em> row, left to right.</li><li>Hand limit is 7 at end of turn — discard down.</li></ul></div>
            <div class="card"><b>Endgame trigger</b><ul><li>Game ends when the main deck can't refill the market.</li><li>Finish the current round so everyone has equal turns.</li><li>Then score: cards → sets → chain bonus → 3:1 resources.</li></ul></div>
          </section>

          <section class="pane" data-p="manuals">
            <p>Downloaded manuals and references for this game.</p>
            <div class="card man"><span class="ic">📕</span><div class="meta"><b>Official Rulebook</b><span>EN · 24 pages · 4.2 MB · PDF</span></div><a class="dl" href="#">Open</a></div>
            <div class="card man"><span class="ic">📗</span><div class="meta"><b>Regras Oficiais</b><span>PT-BR · 24 páginas · 4.5 MB · PDF</span></div><a class="dl" href="#">Abrir</a></div>
            <div class="card man"><span class="ic">📄</span><div class="meta"><b>Quick Reference (2 pages)</b><span>EN · 380 KB · PDF</span></div><a class="dl" href="#">Open</a></div>
            <div class="card man"><span class="ic">❓</span><div class="meta"><b>FAQ &amp; Errata</b><span>EN · community · updated 2024 · PDF</span></div><a class="dl" href="#">Open</a></div>
          </section>

          <section class="pane" data-p="notes">
            <div class="notes-body">
              <div class="tagline">From your Obsidian vault · Board Games/Inventory</div>
              {g.notes ? g.notes : "House rules, personal takeaways and table notes will appear here once synced from your vault."}
            </div>
          </section>

          <section class="pane" data-p="ask">
            <p>Ask anything about the rules — grounded on the manuals and your notes above.</p>
            <div class="suggest">
              <button>Can I build and activate the same card in one turn?</button>
              <button>How exactly does the chain bonus score?</button>
              <button>What triggers the end of the game?</button>
            </div>
            <div class="chat">
              <div class="msg ai">Hi! I've read the rulebook, the quick reference, and your notes for this game. Ask me anything — I'll point you to the rule.</div>
            </div>
            <form class="ask">
              <input placeholder="Ask about a rule…" autocomplete="off" />
              <button type="submit">Ask</button>
            </form>
          </section>
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
      <div class="shelf">{groups.map((grp) => <Box grp={grp} perm={perm} />)}</div>
      {groups.map((grp) => <Detail grp={grp} perm={perm} whatsapp={whatsapp} />)}
      {perm.admin ? <InviteForm roles={roles} defaultRole={defaultRole} /> : null}
      {!isAuthed && !showLogin ? (
        <a href="/login" class="lock" title="Sign in" aria-label="Sign in">🔒</a>
      ) : null}
      {showLogin ? <LoginModal error={login?.error} /> : null}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.querySelectorAll('.box').forEach(function(b){var i=b.querySelector('img');if(!i)return;var s=function(){if(i.naturalWidth)b.style.aspectRatio=i.naturalWidth+'/'+i.naturalHeight;};i.complete?s():i.addEventListener('load',s);});" +
            "var CANNED={" +
            "'Can I build and activate the same card in one turn?':'Yes — Build then Activate counts as your two actions. The card is built first, then it activates with its row the same turn.|Rulebook p.7, Action timing'," +
            "'How exactly does the chain bonus score?':'The longest unbroken row of same-colour cards scores 1 VP per card in it; only the single longest chain counts.|Rulebook p.11 + your note: deny Ana the long row'," +
            "'What triggers the end of the game?':'The game ends the moment the main deck cannot refill the market to 4. Finish the round so everyone has equal turns, then score.|Quick Reference, Game end'" +
            "};" +
            "function addMsg(chat,text,cls,src){var m=document.createElement('div');m.className='msg '+cls;m.textContent=text;if(src){var s=document.createElement('span');s.className='src';s.textContent='📖 '+src;m.appendChild(s);}chat.appendChild(m);m.scrollIntoView({block:'nearest'});}" +
            "function askQ(hub,q){var chat=hub.querySelector('.chat');addMsg(chat,q,'you');var a=CANNED[q]||'(mock) I would answer from the rulebook here — wire me to a real model and I will cite the page.|mock';var p=a.split('|');setTimeout(function(){addMsg(chat,p[0],'ai',p[1]);},300);}" +
            "document.addEventListener('click',function(e){var t=e.target.closest('.tabs button');if(t){var h=t.closest('.hub-inner');var n=t.getAttribute('data-t');h.querySelectorAll('.tabs button').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-t')===n);});h.querySelectorAll('.pane').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-p')===n);});var sc=h.closest('.hub');if(sc)sc.scrollTop=0;return;}var s=e.target.closest('.suggest button');if(s){askQ(s.closest('.hub-inner'),s.textContent);}});" +
            "document.addEventListener('submit',function(e){if(e.target.classList.contains('ask')){e.preventDefault();var inp=e.target.querySelector('input');var q=inp.value.trim();if(q){askQ(e.target.closest('.hub-inner'),q);inp.value='';}}});",
        }}
      ></script>
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
