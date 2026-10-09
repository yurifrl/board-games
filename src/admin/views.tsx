/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { Game } from "../games.ts";
import type { Face } from "../asset/box-contract.ts";
import type { Candidate } from "../asset/studio.ts";
import { displayKey, isManaged } from "../asset/studio.ts";
import { boxArtKey } from "../asset/box-contract.ts";
import { sign } from "../asset/auth.ts";
import type { ImageModel } from "./models.ts";

export type Studio = { game: Game; front: Candidate[]; spine: Candidate[] };
export type Opts = { gcs: boolean; gen: boolean; models: ImageModel[]; defaultModel: string; obsidian: boolean; versions?: Record<string, number> };

// Which source group a provider belongs to (drives the section toggle).
// Downloaded covers group PER SOURCE (bgg / ludopedia), not as one bucket —
// the filter tabs name each source so auto-managed art is obvious.
const groupOf = (provider: string): string =>
  isManaged(provider) ? provider : provider === "upload" ? "upload" : "gen";

const candidateUrl = (c: Candidate, w: number): string =>
  `/asset/${c.key.entity}/${c.key.kind}/${c.key.source}/${c.key.variant}.${c.key.ext}?${sign(c.key, { w })}`;

const displayUrl = (id: string, face: Face, w: number, v?: number): string =>
  `/asset/${id}/display/${face}/latest.png?${sign(displayKey(id, face), { w })}${v ? "&v=" + v : ""}`;

// Fallbacks so a tile isn't empty before anything is promoted (mirrors the app).
const coverFallback = (g: Game, w: number): string => {
  const source = g.bggId ? "bgg" : g.ludopediaId ? "ludopedia" : null;
  if (!source) return g.image ?? "";
  const key = { entity: g.id, kind: "cover", source, variant: "original", ext: "jpg" };
  return `/asset/${g.id}/cover/${source}/original.jpg?${sign(key, { w })}`;
};
const genSpineFallback = (id: string): string => {
  const key = boxArtKey(id, "spine");
  return `/asset/${id}/spine/gen/${key.variant}.${key.ext}?${sign(key, { w: 240 })}`;
};

// Fallback chain: try display, then the provider cover / generated spine, then hide.
const fbChain = (fb: string) =>
  fb
    ? "if(this.dataset.fb){this.src=this.dataset.fb;this.removeAttribute('data-fb')}else{this.style.visibility='hidden'}"
    : "this.style.visibility='hidden'";

const VRow: FC<{ c: Candidate; gcs: boolean; mixed: boolean }> = ({ c, gcs, mixed }) => {
  const when = new Date(Number(c.version) || 0);
  const label = when.getTime() ? when.toLocaleDateString("en-US", { day: "2-digit", month: "short" }) : "";
  const prov = `${c.managed ? "⇣ " : ""}${c.provider}${mixed ? " · " + c.ext.toUpperCase() : ""}`;
  return (
    <button
      type="button"
      class={`vrow${c.chosen ? " chosen" : ""}`}
      data-group={groupOf(c.provider)}
      data-src={candidateUrl(c, 900)}
      data-provider={c.provider}
      data-version={c.version}
      data-ext={c.ext}
      data-kind={c.key.kind}
      data-ongcs={c.onGcs ? "1" : ""}
      data-managed={c.managed ? "1" : ""}
      title={`${prov}${label ? " · " + label : ""}${c.managed ? " · auto-downloaded (sync) — cannot be deleted" : ""}`}
    >
      <input type="checkbox" class="vpick" title="Select" disabled={c.managed} />
      <img src={candidateUrl(c, 200)} alt="" loading="lazy" />
      <span class="vprov">{prov}</span>
      {gcs && c.onGcs ? <span class="vsaved" title="saved to GCS">☁</span> : null}
    </button>
  );
};

const FacePane: FC<{ g: Game; face: Face; history: Candidate[]; opts: Opts }> = ({ g, face, history, opts }) => {
  const fb = face === "front" ? coverFallback(g, 900) : genSpineFallback(g.id);
  // Downloaded sources present in THIS pane get their own tab (bgg, ludopedia),
  // instead of one merged "Baixadas" — matches how the rows are grouped.
  const srcs = [...new Set(history.filter((c) => isManaged(c.provider)).map((c) => c.provider))];
  const mixed = new Set(history.map((c) => c.ext)).size > 1;
  const hidden = (
    <>
      <input type="hidden" name="provider" value="" />
      <input type="hidden" name="version" value="" />
      <input type="hidden" name="ext" value="" />
      <input type="hidden" name="kind" value="" />
    </>
  );
  return (
    <div class="fpane" data-id={g.id} data-face={face}>
      <div class="rail">
        <div class="srcfilter">
          <button type="button" data-g="all" class="on">All <b>{history.length}</b></button>
          {srcs.map((s) => <button type="button" data-g={s}>{s} <b>{history.filter((c) => c.provider === s).length}</b></button>)}
          <button type="button" data-g="gen">Generated</button>
          <button type="button" data-g="upload">Uploaded</button>
          <button type="button" class="vbulkdel" hidden>🗑 Delete (<b class="vmarked">0</b>)</button>
        </div>
        <div class="vlist">
          <form class="add" method="post" action={`/studio/${g.id}/${face}/upload`} enctype="multipart/form-data">
            <label title="Upload an image from your computer">＋<input type="file" name="file" accept="image/*" onchange="this.form.requestSubmit()" /></label>
          </form>
          {history.map((c) => <VRow c={c} gcs={opts.gcs} mixed={mixed} />)}
          {history.length === 0 ? <div class="empty">no history yet</div> : null}
        </div>
      </div>
      <div class="stage">
        <div class="preview">
          <img src={displayUrl(g.id, face, 900, opts.versions?.[g.id + "/" + face])} alt="" data-fb={fb || undefined} onerror={fbChain(fb)} />
        </div>
        <div class="actbar" hidden>
          <span class="selmeta"></span>
          <form method="post" action={`/studio/${g.id}/${face}/promote`}>{hidden}<button class="btn primary" title="Make this the displayed image">★ Promote</button></form>
          <form method="post" action={`/studio/${g.id}/${face}/save`} class="act-save">{hidden}<button class="btn">☁ Save to GCS</button></form>
          <form method="post" action={`/studio/${g.id}/${face}/gcs-delete`} class="act-gdel">{hidden}<button class="btn warn">☁ Remove from GCS</button></form>
          <form method="post" action={`/studio/${g.id}/${face}/delete`} class="act-del">{hidden}<button class="btn danger">🗑 Delete</button></form>
          <span class="managednote" hidden>⇣ auto-downloaded (sync) — cannot be deleted; use ⬇ Download covers to refresh</span>
        </div>
      </div>
      {opts.gen ? (
        <aside class="side">
          <div class="gptitle">Generate {face === "front" ? "front" : "spine"}</div>
          <form method="post" action={`/studio/${g.id}/${face}/generate`}>
            <input type="hidden" name="model" value={opts.defaultModel} />
            <textarea name="prompt" class="prompt" rows={8} placeholder="type a prompt — blank uses the saved default prompt"></textarea>
            <div class="gpcontrols">
              <span class="gpaspect">automatic aspect ratio</span>
              <button type="submit" class="gengo">Generate</button>
            </div>
          </form>
        </aside>
      ) : null}
    </div>
  );
};

// Fragment renderer: one face pane's HTML, for in-place AJAX refresh after an action.
export const renderFacePane = (g: Game, face: Face, history: Candidate[], opts: Opts): string =>
  "" + (<FacePane g={g} face={face} history={history} opts={opts} />);

// One studio card. The tile links to /studio/<id>; the detail overlay is
// rendered (open) only for the active game on that route.
const Tile: FC<{ g: Game; opts: Opts; active?: Studio }> = ({ g, opts, active }) => {
  const ar = g.dimensions ? `${g.dimensions.widthCm}/${g.dimensions.heightCm}` : "3/4";
  return (
    <section class={`card${active ? " open" : ""}`} data-id={g.id} data-name={g.name.toLowerCase()} data-purchased={g.purchasedAt ?? ""} style={`--tint:${g.tint ?? "#3a3a44"}`}>
      <input type="checkbox" class="pick" title="Select" />
      <a class="tile" href={`/studio/${g.id}`}>
        <span class="front" style={`aspect-ratio:${ar}`}>
          <img src={displayUrl(g.id, "front", 600, opts.versions?.[g.id + "/front"])} alt="" loading="lazy" data-fb={coverFallback(g, 300) || undefined} onerror={fbChain(coverFallback(g, 300))} />
          <span class="nm">{g.name}</span>
        </span>
        <span class="spine">
          <span class="snm">{g.name}</span>
          <img src={displayUrl(g.id, "spine", 480, opts.versions?.[g.id + "/spine"])} alt="" loading="lazy" data-fb={genSpineFallback(g.id)} onerror={fbChain(genSpineFallback(g.id))} />
        </span>
      </a>
      {active ? (
        <div class="detail open" data-id={g.id} data-face="spine">
          <div class="dhead">
            <b>{g.name}</b>
            <div class="facetabs">
              <button type="button" data-f="front">Front</button>
              <button type="button" data-f="spine" class="on">Spine</button>
            </div>
            <form method="post" action={`/studio/${g.id}/download`} class="dlform"><button type="submit" class="dlbtn" title="Re-download BGG/Ludopedia covers">⬇ Download covers</button></form>
            <a class="close" href="/" title="Close">✕</a>
          </div>
          {opts.obsidian ? (
            <details class="artnote">
              <summary>✎ Art note (Obsidian · applied to prompts)</summary>
              <form method="post" action={`/studio/${g.id}/art-note`}>
                <textarea name="text" class="prompt" rows={2} placeholder="game-specific art direction…">{g.boxArtDescription ?? ""}</textarea>
                <div class="genrow"><button type="submit" class="gengo">Save to Obsidian</button></div>
              </form>
            </details>
          ) : null}
          <div class="panes">
            <FacePane g={g} face="front" history={active.front} opts={opts} />
            <FacePane g={g} face="spine" history={active.spine} opts={opts} />
          </div>
        </div>
      ) : null}
    </section>
  );
};

export const studioPage = (games: Game[], opts: Opts, active?: Studio): string =>
  "<!doctype html>" +
  (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Cover Studio</title>
        <style>{CSS}</style>
      </head>
      <body data-view="both">
        <header>
          <h1>Cover Studio</h1>
          <div class="views">
            <button data-v="front">Front</button>
            <button data-v="spine">Spine</button>
            <button data-v="both" class="on">Both</button>
          </div>
          <div class="sizes" title="Tile size">
            <button data-s="s" class="on">S</button>
            <button data-s="m">M</button>
            <button data-s="l">L</button>
          </div>
          <select id="sortSel" class="provsel" title="Tile order">
            <option value="default">Collection order</option>
            <option value="name">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
            <option value="newest">Newest purchase</option>
            <option value="oldest">Oldest purchase</option>
          </select>
          <input id="q" type="search" placeholder="filter games…" />
          {opts.gen && opts.models.length ? (
            <select id="globalModel" class="provsel" title="AI model used by every Generate action">
              {opts.models.map((m) => (
                <option value={m.id} selected={m.id === opts.defaultModel}>{m.name}</option>
              ))}
            </select>
          ) : null}
          {opts.gen ? <button id="selBtn" class="gstyle">Select</button> : null}
          {opts.gen ? <button id="exBtn" class="gstyle" title="Mark games whose cover is sent as a style example with the next generation">Examples</button> : null}
          {opts.obsidian ? <button id="globalStyleBtn" class="gstyle">Global style</button> : null}
        </header>
        {opts.gen ? (
          <div id="bulkbar">
            <span id="selCount">0 marked</span>
            <span id="exCount" class="exmeta"></span>
            <select id="bulkFace">
              <option value="front">Front</option>
              <option value="spine">Spine</option>
              <option value="both">Both</option>
            </select>
            <button type="button" id="bulkGo" class="gengo">Generate</button>
            <button type="button" id="bulkDl">⬇ Download</button>
            <span id="bulkProg"></span>
          </div>
        ) : null}
        {opts.obsidian ? (
          <dialog id="globalStyleDlg">
            <form method="post" action="/global-style">
              <h3>Global style <span class="hint">(Obsidian · Inventory.md · applies to the front)</span></h3>
              <textarea name="style" class="prompt" rows={10} placeholder="house style…"></textarea>
              <div class="genrow">
                <button type="button" class="gsclose">Cancel</button>
                <button type="submit" class="gengo">Save to Obsidian</button>
              </div>
            </form>
          </dialog>
        ) : null}
        {opts.gcs ? (
          <dialog id="delDlg">
            <h3>Delete image</h3>
            <p class="hint" id="delHint">This copy exists locally and on GCS (☁). What should be deleted?</p>
            <div class="genrow">
              <button type="button" id="delCancel" class="gsclose">Cancel</button>
              <button type="button" id="delLocal" class="btn">🗑 Local only</button>
              <button type="button" id="delBoth" class="btn danger">☁ Local + GCS</button>
            </div>
          </dialog>
        ) : null}
        <main>{games.map((g) => <Tile g={g} opts={opts} active={active?.game.id === g.id ? active : undefined} />)}</main>
        <script dangerouslySetInnerHTML={{ __html: JS }} />
      </body>
    </html>
  );

const CSS = `
*{box-sizing:border-box}
html,body{max-width:100%;overflow-x:hidden}
/* Tile size tokens: overridden by data-size below; the mobile media query keeps
   fixed .card overrides, so the size buttons only apply on desktop. */
body{margin:0;font:14px/1.4 system-ui,sans-serif;background:#14141a;color:#e8e8ee;--h:210px;--sw:44px}
body[data-size=m]{--h:290px;--sw:61px}
body[data-size=l]{--h:380px;--sw:104px}
header{position:sticky;top:0;z-index:10;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:#1c1c26cc;backdrop-filter:blur(8px);border-bottom:1px solid #2a2a38}
header h1{font-size:17px;margin:0}
.views{display:flex;gap:6px}
.sizes{display:flex;gap:6px}
.views button,.sizes button{background:#2a2a38;color:#cfcfe0;border:0;border-radius:999px;padding:6px 14px;cursor:pointer}
.views button.on,.sizes button.on{background:#5b6cff;color:#fff}
#q{flex:1;min-width:160px;background:#0f0f16;border:1px solid #2a2a38;color:#e8e8ee;border-radius:8px;padding:8px 12px}
.gstyle{background:#2a2a38;color:#cfcfe0;border:0;border-radius:999px;padding:6px 14px;cursor:pointer}
.gstyle.on{background:#5b6cff;color:#fff}
#bulkbar{display:none;width:100%;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#181822;border-bottom:1px solid #2a2a38}
body[data-sel] #bulkbar{display:flex}
#bulkbar select{background:#0f0f16;border:1px solid #2a2a38;color:#e8e8ee;border-radius:8px;padding:6px 10px}
dialog#globalStyleDlg,dialog#delDlg{width:min(680px,92vw);background:#1c1c26;color:#e8e8ee;border:1px solid #2a2a38;border-radius:14px;padding:18px}
dialog#globalStyleDlg::backdrop,dialog#delDlg::backdrop{background:#0009}
dialog#globalStyleDlg h3,dialog#delDlg h3{margin:0 0 10px;font-size:15px}
dialog#globalStyleDlg .hint,dialog#delDlg .hint{color:#8a8a9a;font-weight:400;font-size:12px}
.dlbtn{border:0;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px}
#selCount,#bulkProg{color:#9a9ab0;font-size:12px}
.card .pick{display:none;position:absolute;top:8px;left:8px;z-index:3;width:20px;height:20px;cursor:pointer}
body[data-sel] .card{position:relative}
body[data-sel] .card .pick{display:block}
body[data-sel] .card.marked{outline:2px solid #5b6cff;outline-offset:3px;border-radius:6px}
/* Examples mode: click a tile to mark (orange) the game whose displayed cover
   rides along as a style reference on the next generation. Select and Examples
   coexist: a tile can be both a target (blue outline) and an example (orange
   ring), so the two marks use different ring mechanics. */
body[data-ex] #bulkbar{display:flex}
body[data-ex] .card{position:relative}
body[data-ex] .card .tile{cursor:crosshair}
body[data-ex] .card.exd{box-shadow:0 0 0 3px #e8a04c;border-radius:6px}
#exCount.exmeta{color:#e8a04c;font-size:12px}
dialog#globalStyleDlg{width:min(680px,92vw);background:#1c1c26;color:#e8e8ee;border:1px solid #2a2a38;border-radius:14px;padding:18px}
dialog#globalStyleDlg::backdrop{background:#0009}
dialog#globalStyleDlg h3{margin:0 0 10px;font-size:15px}
dialog#globalStyleDlg .hint{color:#8a8a9a;font-weight:400;font-size:12px}

/* List: flat, shelf-less — front covers and/or spines, sized like the app */
main{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;padding:20px}
.tile{all:unset;cursor:pointer;display:flex;gap:8px;align-items:flex-end}
.tile:hover{transform:translateY(-4px)}
.tile{transition:transform .15s}
/* front cover */
.tile .front{position:relative;height:var(--h);border-radius:8px;overflow:hidden;background:var(--tint);box-shadow:0 8px 18px #0006}
.tile .front img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tile .front .nm{position:absolute;left:0;right:0;bottom:0;padding:6px 8px;font-size:12px;font-weight:700;color:#fff;background:linear-gradient(0deg,#000b,transparent);text-shadow:0 1px 2px #000}
/* spine */
.tile .spine{position:relative;width:var(--sw);height:var(--h);border-radius:3px;overflow:hidden;background:var(--tint);box-shadow:0 8px 18px #0006}
.tile .spine img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}
.tile .spine .snm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;transform:rotate(180deg);color:#fff;font-weight:700;font-size:calc(var(--sw)*0.27);text-shadow:0 1px 2px #000;padding:10px 0;text-align:center}
/* per-view visibility */
body[data-view=front] .tile .spine,body[data-view=spine] .tile .front{display:none}
/* Detail overlay: server-rendered open on /studio/<id> */
.detail{display:none}
.card.open .detail{display:flex;flex-direction:column;position:fixed;inset:0;z-index:50;background:#15151d;padding:0;overflow:hidden}
.close{background:#2a2a38;color:#cfcfe0;border:0;border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:14px;display:grid;place-items:center;text-decoration:none}
.dhead{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid #2a2a38;background:#1c1c26;flex-wrap:wrap}
.dhead b{font-size:16px}
.facetabs{display:flex;gap:6px}
.facetabs button{background:#2a2a38;color:#cfcfe0;border:0;border-radius:999px;padding:5px 14px;cursor:pointer;font-size:13px}
.facetabs button.on{background:#5b6cff;color:#fff}
.dlform{margin:0 0 0 auto}
.dlbtn{background:#2a2a38;color:#cfcfe0;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px}
.close{background:#2a2a38;color:#cfcfe0;border:0;border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:14px}
.artnote{margin:0;padding:10px 16px;border-bottom:1px solid #2a2a38;background:#181820}
.artnote summary{cursor:pointer;color:#9a9ab0;font-size:12px;user-select:none}
.artnote form{margin-top:8px;display:flex;gap:8px;align-items:flex-start}
.artnote textarea{flex:1}
.artnote .genrow{margin:0}

.panes{flex:1;min-height:0;overflow:auto}
.fpane{display:none;height:100%}
.detail[data-face=front] .fpane[data-face=front]{display:grid}
.detail[data-face=spine] .fpane[data-face=spine]{display:grid}
.fpane{grid-template-columns:260px minmax(0,1fr) 320px;gap:0}

/* rail: wrapping thumbnail grid (never horizontal-scrolls) */
.rail{border-right:1px solid #2a2a38;display:flex;flex-direction:column;min-height:0}
.srcfilter{display:flex;gap:6px;flex-wrap:wrap;padding:12px;border-bottom:1px solid #2a2a38}
.srcfilter button{background:#22222e;color:#9a9ab0;border:0;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer}
.srcfilter button.on{background:#5b6cff;color:#fff}
.srcfilter b{font-weight:700}
.vlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;padding:12px;overflow:auto;align-content:start}
.add label{display:flex;align-items:center;justify-content:center;aspect-ratio:1;border:1px dashed #3a3a52;border-radius:8px;color:#8a8aa0;font-size:22px;cursor:pointer}
.add label:hover{border-color:#5b6cff;color:#5b6cff}
.add input{display:none}
.vrow{all:unset;position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:#0f0f16;cursor:pointer;outline:2px solid transparent;outline-offset:1px}
.vrow img{width:100%;height:100%;object-fit:cover}
.vrow.sel{outline-color:#5b6cff}
.vrow .vprov{position:absolute;left:0;right:0;bottom:0;font-size:9px;text-align:center;color:#cfcfe0;background:#000a;padding:1px 0}
.vrow .vchosen{position:absolute;top:3px;left:3px;font-size:10px;background:#2f9e59;color:#fff;border-radius:5px;padding:0 4px;line-height:15px}
.vrow .vsaved{position:absolute;top:3px;right:3px;font-size:10px;color:#bcd;background:#0009;border-radius:5px;padding:0 3px}
.vrow[hidden]{display:none}
.vrow .vpick{position:absolute;top:4px;left:4px;z-index:3;width:18px;height:18px;margin:0;cursor:pointer;opacity:0;transition:opacity .12s}
.vrow:hover .vpick,.vrow.marked .vpick{opacity:1}
.vrow.marked{outline-color:#7a2f34}
.srcfilter .vbulkdel{margin-left:auto;background:#7a2f34;color:#fff;border:0;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer}
.srcfilter .vbulkdel[hidden]{display:none}
.actbar{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.actbar .selmeta{width:100%;text-align:center;color:#8a8a9a;font-size:12px}
.actbar .managednote{width:100%;text-align:center;color:#c9a227;font-size:12px}
.actbar form{margin:0}
/* stage: big preview + action toolbar on the selected version */
.stage{display:flex;flex-direction:column;min-height:0;padding:16px;gap:12px}
.preview{flex:1;min-height:0;border-radius:12px;background:#0f0f16;border:1px solid #2a2a38;display:flex;align-items:center;justify-content:center;overflow:hidden}
.preview img{max-width:100%;max-height:100%;object-fit:contain}
.actbar{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.actbar form{margin:0}
.btn{border:0;border-radius:9px;padding:9px 16px;cursor:pointer;font-size:13px;background:#2a2a38;color:#e8e8ee}
.btn.primary{background:#5b6cff;color:#fff;font-weight:600}
.btn.warn{background:#8a5a1f;color:#fff}
.btn.danger{background:#7a2f34;color:#fff}

/* side: generate panel (Gamma-style) */
.side{border-left:1px solid #2a2a38;padding:16px;display:flex;flex-direction:column;gap:10px;overflow:auto}
.gptitle{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8a8aa0}
.side form{display:flex;flex-direction:column;gap:10px}
.gpcontrols{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.gpaspect{color:#8a8a9a;font-size:11px;margin-right:auto}
.provsel{background:#0f0f16;border:1px solid #2a2a38;color:#e8e8ee;border-radius:8px;padding:6px 8px}
.prompt{width:100%;background:#0f0f16;border:1px solid #2a2a38;color:#e8e8ee;border-radius:8px;padding:8px;font:12px/1.4 ui-monospace,monospace;resize:vertical}
.genrow{display:flex;gap:8px;justify-content:flex-end}
.genrow button,.gengo{border:0;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;background:#5b6cff;color:#fff}
.gengo:disabled{opacity:.6;cursor:default}

@media(max-width:900px){
  .fpane{grid-template-columns:1fr;grid-template-rows:auto auto auto;height:auto;overflow:auto}
  .rail{border-right:0;border-bottom:1px solid #2a2a38}
  .side{border-left:0;border-top:1px solid #2a2a38}
  .preview{min-height:44vh}
  .dhead b{width:100%}
  .card{--h:150px}
  .tile .front{max-width:calc(100vw - 40px)}
}
`;

const JS = `
var body=document.body;
// global style dialog (Obsidian)
(function(){
  var btn=document.getElementById('globalStyleBtn'),dlg=document.getElementById('globalStyleDlg');
  if(!btn||!dlg)return;var ta=dlg.querySelector('textarea');
  btn.onclick=function(){
    ta.value='loading\u2026';dlg.showModal();
    fetch('/global-style').then(function(r){return r.text();}).then(function(t){ta.value=t;});
  };
  dlg.querySelector('.gsclose').onclick=function(){dlg.close();};
})();
document.querySelectorAll('.views button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('.views button').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');body.dataset.view=b.dataset.v;localStorage.setItem('studioView',b.dataset.v);};});
var sv=localStorage.getItem('studioView')||'both';var t=document.querySelector('.views button[data-v="'+sv+'"]');if(t)t.click();

// tile size buttons (S/M/L) -> body[data-size], persisted in 'studioSize'.
// Mobile keeps fixed tile heights (media query), so this only affects desktop.
document.querySelectorAll('.sizes button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('.sizes button').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');body.dataset.size=b.dataset.s;localStorage.setItem('studioSize',b.dataset.s);};});
var ss=localStorage.getItem('studioSize');if(ss){var st=document.querySelector('.sizes button[data-s="'+ss+'"]');if(st)st.click();}

// tile sort: 'default' keeps the server-rendered order (same as the site home);
// the other options re-order the cards in place. Persisted in 'studioSort'.
// Unknown purchase dates go last, then by name — mirroring the site's ordering.
var sortSel=document.getElementById('sortSel');
if(sortSel){
  var mainEl=document.querySelector('main');
  var cardsInDefault=[].slice.call(mainEl.querySelectorAll('.card'));
  var purchasedOf=function(c){var v=c.dataset.purchased;return v===''?null:Number(v);};
  var byPurchase=function(a,b){
    var pa=purchasedOf(a),pb=purchasedOf(b);
    if(pa===null&&pb===null)return a.dataset.name.localeCompare(b.dataset.name);
    if(pa===null)return 1;if(pb===null)return -1;
    return pa-pb||a.dataset.name.localeCompare(b.dataset.name);
  };
  var sortCmps={
    'name':function(a,b){return a.dataset.name.localeCompare(b.dataset.name);},
    'name-desc':function(a,b){return b.dataset.name.localeCompare(a.dataset.name);},
    'newest':function(a,b){
      var pa=purchasedOf(a),pb=purchasedOf(b);
      if(pa===null&&pb===null)return a.dataset.name.localeCompare(b.dataset.name);
      if(pa===null)return 1;if(pb===null)return -1;
      return pb-pa||a.dataset.name.localeCompare(b.dataset.name);
    },
    'oldest':function(a,b){return byPurchase(a,b);}
  };
  var applySort=function(){
    var v=sortSel.value,ordered=cardsInDefault.slice();
    if(v!=='default')ordered.sort(sortCmps[v]);
    ordered.forEach(function(c){mainEl.appendChild(c);});
    localStorage.setItem('studioSort',v);
  };
  sortSel.addEventListener('change',applySort);
  var savedSort=localStorage.getItem('studioSort');
  if(savedSort&&sortSel.querySelector('option[value="'+savedSort+'"]')){sortSel.value=savedSort;applySort();}
}

// global default AI model (single + bulk): stored in 'studioDefaultModel',
// restored on load, and propagated into every generate form's hidden input.
var globalSel=document.getElementById('globalModel');
function applyGlobalModel(){
  if(!globalSel||!globalSel.value)return; // empty selection must not clobber the server default
  document.querySelectorAll('.side form input[name="model"]').forEach(function(i){i.value=globalSel.value;});
}
if(globalSel){
  var sd=localStorage.getItem('studioDefaultModel');
  if(sd&&globalSel.querySelector('option[value="'+sd+'"]'))globalSel.value=sd;
  globalSel.addEventListener('change',function(){localStorage.setItem('studioDefaultModel',globalSel.value);applyGlobalModel();});
  applyGlobalModel();
}

var q=document.getElementById('q');q.oninput=function(){var v=q.value.toLowerCase();
  document.querySelectorAll('.card').forEach(function(c){c.style.display=c.dataset.name.indexOf(v)>=0?'':'none';});};

// Tiles are links to /studio/<id>; in select mode a click toggles the
// checkbox instead of navigating. Opening/closing is real navigation now.
document.querySelectorAll('.card').forEach(function(card){
  var pick=card.querySelector('.pick');
  card.querySelector('.tile').addEventListener('click',function(e){
    if(body.dataset.mode!=='sel')return;
    e.preventDefault();pick.checked=!pick.checked;pick.onchange();
  });
  if(pick)pick.onchange=function(){card.classList.toggle('marked',pick.checked);bulkCount();};
});

// ---- bulk selection + generation ----
function picked(){return Array.prototype.slice.call(document.querySelectorAll('.card .pick:checked')).map(function(p){return p.closest('.card').dataset.id;});}
function bulkCount(){var el=document.getElementById('selCount');if(el)el.textContent=picked().length+' marked';}
(function(){
  var selBtn=document.getElementById('selBtn'),exBtn=document.getElementById('exBtn');
  if(!selBtn&&!exBtn)return;
  // Modes coexist and marks persist: examples are refs, select marks are
  // targets — generation needs both at once. data-mode is the active one:
  // the button clicked last wins; tile clicks apply to it. Deactivating a
  // mode falls back to the other while it is still on.
  var setMode=function(m){
    if(m){body.dataset.mode=m;return;}
    if(body.dataset.sel!==undefined)body.dataset.mode='sel';
    else if(body.dataset.ex!==undefined)body.dataset.mode='ex';
    else delete body.dataset.mode;
  };
  selBtn.onclick=function(){
    var on=body.dataset.sel===undefined;
    if(on){body.dataset.sel='';selBtn.classList.add('on');}
    else{delete body.dataset.sel;selBtn.classList.remove('on');}
    setMode(on?'sel':'');
  };
  if(exBtn)exBtn.onclick=function(){
    var on=body.dataset.ex===undefined;
    if(on){body.dataset.ex='';exBtn.classList.add('on');}
    else{delete body.dataset.ex;exBtn.classList.remove('on');}
    setMode(on?'ex':'');
  };
  // Example tiles: in Examples mode a tile click toggles the example mark.
  document.querySelectorAll('.card').forEach(function(card){
    var tile=card.querySelector('.tile');if(!tile)return;
    tile.addEventListener('click',function(e){
      if(body.dataset.mode!=='ex')return;
      e.preventDefault();
      card.classList.toggle('exd');
      exCount();
    });
  });
  function exCount(){var el=document.getElementById('exCount');if(el){var n=document.querySelectorAll('.card.exd').length;el.textContent=n?(n+' example'+(n>1?'s':'')):'';}}
  exCount();
  var go=document.getElementById('bulkGo'),dl=document.getElementById('bulkDl'),prog=document.getElementById('bulkProg');
  var bulkJob=null; // set while a cancellable (generate) run is in flight; its click then cancels
  function runBulk(url,extra,cancellable){
    var ids=picked();if(!ids.length){alert('nothing marked');return;}
    var fd=new URLSearchParams();fd.set('ids',ids.join(','));for(var k in extra)fd.set(k,extra[k]);
    if(go&&!cancellable)go.disabled=true;if(dl)dl.disabled=true;prog.textContent='starting\u2026';
    // Errors must surface, never swallow: a non-JSON body (503 "openrouter not
    // configured", 404 "no job" after an admin restart, proxy 502 HTML) would
    // otherwise die as a cryptic SyntaxError, or in the poller, silently.
    function readJson(r){
      return r.text().then(function(tx){
        try{return JSON.parse(tx);}catch(e){throw new Error('HTTP '+r.status+(tx?(' \u2014 '+tx.slice(0,300)):''));}
      });
    }
    fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()})
      .then(readJson).then(function(d){
        bulkJob=cancellable?d.jobId:null;
        if(go&&cancellable){go.dataset.o=go.dataset.o||go.textContent;go.textContent='Cancel';}
        var restoreGo=function(){if(!go)return;go.disabled=false;if(go.dataset.o){go.textContent=go.dataset.o;delete go.dataset.o;}};
        var t=setInterval(function(){
          fetch('/bulk/status/'+d.jobId).then(readJson).then(function(s){
            if(!s.cancelled)prog.textContent=s.done+'/'+s.total+(s.current?(' \u00b7 '+s.current):'')+(s.errors.length?(' \u00b7 '+s.errors.length+' error(s)'):'');
            if(!s.running){
              clearInterval(t);bulkJob=null;restoreGo();if(dl)dl.disabled=false;
              prog.textContent=(s.cancelled?'cancelled ':'done ')+s.done+'/'+s.total+(s.errors.length?(' \u00b7 '+s.errors.length+' error(s)'):'');
              if(s.errors.length)alert(s.errors.join('\\n'));
              setTimeout(function(){location.reload();},900);
            }
          },function(e){ // poll failed (admin restarted mid-job, proxy error, network blip)
            clearInterval(t);bulkJob=null;restoreGo();if(dl)dl.disabled=false;prog.textContent='failed: '+e.message;
          });
        },1000);
      }).catch(function(e){bulkJob=null;restoreGo();if(dl)dl.disabled=false;prog.textContent='failed: '+(e.message||e);});
  }
  if(go)go.onclick=function(){
    if(bulkJob){ // generate running -> this click cancels it
      fetch('/bulk/cancel/'+bulkJob,{method:'POST'}).then(function(){prog.textContent='cancelling\u2026';}).catch(function(){});
      return;
    }
    var face=document.getElementById('bulkFace').value;
    var extra={face:face};
    if(globalSel&&globalSel.value)extra.model=globalSel.value;
    var ex=[].slice.call(document.querySelectorAll('.card.exd')).map(function(c){return c.dataset.id;});if(ex.length)extra.ex=ex.join(',');
    runBulk('/bulk/generate',extra,true);
  };
  if(dl)dl.onclick=function(){runBulk('/bulk/download',{});};
})();
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(document.querySelector('dialog[open]'))return; // dialogs close themselves
  if(document.querySelector('.card.open'))location.href='/';
});
// Delete/Backspace: delete the marked rows, else the selected row (not while typing).
document.addEventListener('keydown',function(e){
  if(e.key!=='Delete'&&e.key!=='Backspace')return;
  var t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable))return;
  var det=document.querySelector('.card.open .detail');if(!det)return;
  var pane=det.querySelector('.fpane[data-face="'+det.dataset.face+'"]');if(!pane)return;
  var marked=[].slice.call(pane.querySelectorAll('.vrow.marked'));
  if(marked.length){e.preventDefault();requestDeleteRows(pane,marked);return;}
  var row=pane.querySelector('.vrow.sel');
  if(row){e.preventDefault();requestDeleteRows(pane,[row]);}
});

// ---- keep every detail action IN-PLACE (no navigation, no reload) ----
// The detail is a client overlay; a form POST used to 302 -> / and blow it away.
// Intercept all detail-form submits, fetch() them, and re-render the touched
// face pane from a server fragment so the overlay never closes.
function skipDeleteConfirm(){return localStorage.getItem('studioSkipDelete')==='1';}
function flash(btn,txt){if(!btn)return;var o=btn.dataset.o||btn.textContent;btn.dataset.o=o;btn.textContent=txt;setTimeout(function(){btn.textContent=o;},1200);}
function updateTile(id,face,row){
  if(!row)return;var card=document.querySelector('.card[data-id="'+id+'"]');if(!card)return;
  var img=card.querySelector(face==='front'?'.tile .front img':'.tile .spine img');
  if(img){img.removeAttribute('data-fb');img.src=row.dataset.src;}
}
function refreshPane(det,id,face){
  return fetch('/studio/'+id+'/pane/'+face).then(function(r){return r.text();}).then(function(html){
    var old=det.querySelector('.fpane[data-face="'+face+'"]');if(!old)return;
    var tmp=document.createElement('div');tmp.innerHTML=html;var neu=tmp.querySelector('.fpane');
    if(neu){old.replaceWith(neu);initPane(neu);}
  });
}

// delete choice: a GCS-backed candidate (☁) can go local-only or local+GCS.
// delForm = single-row form flow; delFn = bulk callback from multi-select.
var delDlg=document.getElementById('delDlg'),delForm=null,delFn=null,DEL_HINT='';
function setDelHint(t){if(delDlg)delDlg.querySelector('#delHint').textContent=t;}
if(delDlg){
  DEL_HINT=delDlg.querySelector('#delHint').textContent;
  var delGo=function(alsoGcs){
    var f=delForm,fn=delFn;delForm=null;delFn=null;delDlg.close();
    if(fn)return fn(alsoGcs?'gcs':'');
    if(!f)return;
    if(alsoGcs){var i=document.createElement('input');i.type='hidden';i.name='also';i.value='gcs';f.appendChild(i);}
    f.dataset.confirmed='1';submitDetailForm(f);
  };
  delDlg.querySelector('#delCancel').onclick=function(){delForm=null;delFn=null;delDlg.close();};
  delDlg.addEventListener('close',function(){delForm=null;delFn=null;});
  delDlg.querySelector('#delLocal').onclick=function(){delGo(false);};
  delDlg.querySelector('#delBoth').onclick=function(){delGo(true);};
}
// bulk path: any picked row is GCS-backed -> offer local-only vs local+GCS
function askDelScope(n,fn){
  if(!delDlg)return fn('');
  setDelHint(n+(n>1?' images':' image')+(n>1?' exist':' exists')+' locally and on GCS (☁). What should be deleted?');
  delFn=fn;delDlg.showModal();
}
// delete the given rows of one face pane in a single request, then refresh it.
// Managed rows (⇣ auto-downloaded) are skipped: the sync re-pulls them, so
// deleting is a no-op — the server refuses them too.
function requestDeleteRows(pane,rows,scope){
  if(!rows.length)return;
  var locked=rows.filter(function(r){return r.dataset.managed==='1';});
  rows=rows.filter(function(r){return r.dataset.managed!=='1';});
  if(!rows.length){alert(locked.length+' managed image(s) \u2014 re-downloaded by the sync and cannot be deleted');return;}
  var keys=[],anyGcs=false;
  rows.forEach(function(r){
    anyGcs=anyGcs||r.dataset.ongcs==='1';
    keys.push({provider:r.dataset.provider,version:r.dataset.version,ext:r.dataset.ext,kind:r.dataset.kind});
  });
  var go=function(scp){
    var fd=new FormData();fd.set('keys',JSON.stringify(keys));if(scp)fd.set('also',scp);
    fetch('/studio/'+pane.dataset.id+'/'+pane.dataset.face+'/delete-many',{method:'POST',body:fd})
      .then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(t||('HTTP '+r.status));});return r.json();})
      .then(function(d){
        var msgs=[];
        if(d.errors&&d.errors.length)msgs.push(d.errors.length+' error(s)');
        if(d.skipped&&d.skipped.length)msgs.push(d.skipped.length+' managed image(s) kept');
        if(msgs.length)alert('deleted '+d.deleted+' \u00b7 '+msgs.join(' \u00b7 '));
      })
      .then(function(){return refreshPane(pane.closest('.detail'),pane.dataset.id,pane.dataset.face);})
      .catch(function(e){alert('failed: '+e.message);});
  };
  if(scope!==undefined)return go(scope);
  if(!skipDeleteConfirm()){
    var extra=locked.length?(' (keeping '+locked.length+' managed image'+(locked.length>1?'s':'')+')'):'';
    if(anyGcs)return askDelScope(rows.length,go);
    if(!confirm('Delete '+rows.length+' image'+(rows.length>1?'s':'')+extra+'?'))return;
  }
  go('');
}
function vdelCount(pane){
  var btn=pane.querySelector('.vbulkdel');if(!btn)return;
  var n=pane.querySelectorAll('.vrow.marked').length;
  btn.hidden=!n;
  var b=btn.querySelector('.vmarked');if(b)b.textContent=n;
}
function toggleMark(pane,row,on){
  if(row.dataset.managed==='1')return; // locked: re-downloaded by the sync
  row.classList.toggle('marked',on);
  var pk=row.querySelector('.vpick');if(pk)pk.checked=on;
  vdelCount(pane);
}
// One in-flight generate per detail pane: re-clicking the button aborts it.
// The server aborts the paid OpenRouter call too (keyed on game+face).
var genCtl=null;
function submitDetailForm(form){
  var act=form.getAttribute('action')||'';
  var det=form.closest('.detail');var id=det.dataset.id;
  var pane=form.closest('.fpane');var face=pane?pane.dataset.face:null;
  var isGen=act.indexOf('/generate')>=0;
  if(isGen&&genCtl){ // a generate is running -> this click is a cancel
    genCtl.abort();genCtl=null;return;
  }
  var isGdel=act.indexOf('/gcs-delete')>=0,isDel=!isGdel&&act.indexOf('/delete')>=0;
  if((isDel||isGdel)&&!skipDeleteConfirm()&&!form.dataset.confirmed){
    var row=pane?pane.querySelector('.vrow.sel'):null;
    // GCS-backed pick: offer local-only vs local+GCS instead of a plain confirm
    if(isDel&&row&&row.dataset.ongcs==='1'){setDelHint(DEL_HINT);delForm=form;delDlg.showModal();return;}
    if(!confirm(isGdel?'Remove from GCS? (keeps the local copy)':'Delete this image?'))return;
  }
  if(form.dataset.confirmed)delete form.dataset.confirmed;
  var btn=form.querySelector('button[type=submit],button:not([type])');
  if(btn){btn.dataset.o=btn.dataset.o||btn.textContent;}
  if(isGen){
    if(btn){btn.disabled=false;btn.textContent='cancel';}
    genCtl=new AbortController();
    fetch(act,{method:'POST',body:new FormData(form),signal:genCtl.signal}).then(function(r){
      if(!r.ok)return r.text().then(function(t){throw new Error(t||('HTTP '+r.status));});
      return r.json();
    }).then(function(d){
      if(d&&d.promoted===false)alert('generation succeeded, but the auto-promote failed — pick the new version and promote it manually');
      if(face)return refreshPane(det,id,face);
    }).catch(function(e){
      if(e.name!=='AbortError')alert('failed: '+e.message);
      else if(face)refreshPane(det,id,face);
    }).finally(function(){
      genCtl=null;
      if(btn){btn.disabled=false;if(btn.dataset.o)btn.textContent=btn.dataset.o;}
    });
    return;
  }
  if(btn){btn.disabled=true;}
  fetch(act,{method:'POST',body:new FormData(form)}).then(function(r){
    if(!r.ok)return r.text().then(function(t){throw new Error(t||('HTTP '+r.status));});
  }).then(function(d){
    if(d&&d.promoted===false)alert('generation succeeded, but the auto-promote failed — pick the new version and promote it manually');
    if(act.indexOf('/promote')>=0&&pane)updateTile(id,face,pane.querySelector('.vrow.sel'));
    if(act.indexOf('/art-note')>=0){flash(btn,'saved ✓');return;}
    if(act.indexOf('/download')>=0)return Promise.all([refreshPane(det,id,'front'),refreshPane(det,id,'spine')]);
    if(face)return refreshPane(det,id,face);
  }).catch(function(e){alert('failed: '+e.message);}).finally(function(){
    if(btn){btn.disabled=false;if(act.indexOf('/art-note')<0&&btn.dataset.o){btn.textContent=btn.dataset.o;}}
  });
}
document.addEventListener('submit',function(e){
  var form=e.target;if(!form||!form.closest||!form.closest('.detail'))return;
  e.preventDefault();submitDetailForm(form);
});

// face tabs inside a detail
document.querySelectorAll('.detail .facetabs button').forEach(function(b){
  b.onclick=function(){
    var det=b.closest('.detail');
    det.querySelectorAll('.facetabs button').forEach(function(x){x.classList.remove('on')});
    b.classList.add('on');det.dataset.face=b.dataset.f;
    initPane(det.querySelector('.fpane[data-face="'+b.dataset.f+'"]'));
  };
});

// select a version -> preview it + point the action toolbar at it
function selectRow(pane,row){
  if(!row)return;
  pane.querySelectorAll('.vrow').forEach(function(x){x.classList.remove('sel')});
  row.classList.add('sel');
  var prev=pane.querySelector('.preview img');
  if(prev&&row.dataset.src){prev.style.visibility='visible';prev.removeAttribute('data-fb');prev.src=row.dataset.src;}
  var bar=pane.querySelector('.actbar');if(!bar)return;
  bar.hidden=false;
  bar.querySelectorAll('form').forEach(function(f){
    var set=function(n,v){var el=f.querySelector('[name='+n+']');if(el)el.value=v;};
    set('provider',row.dataset.provider);set('version',row.dataset.version);set('ext',row.dataset.ext);set('kind',row.dataset.kind);
  });
  var onGcs=row.dataset.ongcs==='1',managed=row.dataset.managed==='1';
  var save=bar.querySelector('.act-save'),gdel=bar.querySelector('.act-gdel'),del=bar.querySelector('.act-del');
  if(save)save.style.display=onGcs?'none':'';
  // managed rows: no delete anywhere (the sync would undo it) — promote/save only
  if(del)del.style.display=managed?'none':'';
  if(gdel)gdel.style.display=onGcs&&!managed?'':'none';
  var note=bar.querySelector('.managednote');
  if(note)note.hidden=!managed;
  var meta=bar.querySelector('.selmeta');
  if(meta){
    var t=Number(row.dataset.version);
    meta.textContent=row.dataset.provider.toUpperCase()+' \u00b7 '+row.dataset.ext.toUpperCase()+(!t||isNaN(t)?'':' \u00b7 '+new Date(t).toLocaleDateString('en-US')+(managed?' \u00b7 re-downloaded on every sync':''));
  }
}

function initPane(pane){
  if(!pane||pane.dataset.init)return;pane.dataset.init='1';
  applyGlobalModel(); // fresh pane renders the server default — re-apply the browser's global choice
  // rows -> selection (click) or mark for bulk delete (ctrl/cmd/shift-click)
  pane.querySelectorAll('.vrow').forEach(function(r){r.addEventListener('click',function(e){
    if(e.target.closest('.vpick'))return;
    if(e.shiftKey||e.metaKey||e.ctrlKey)return toggleMark(pane,r,!r.classList.contains('marked'));
    selectRow(pane,r);
  });});
  pane.querySelectorAll('.vpick').forEach(function(pk){pk.addEventListener('change',function(){toggleMark(pane,pk.closest('.vrow'),pk.checked);});});
  var vdel=pane.querySelector('.vbulkdel');
  if(vdel)vdel.onclick=function(){requestDeleteRows(pane,[].slice.call(pane.querySelectorAll('.vrow.marked')));};
  // source filter
  pane.querySelectorAll('.srcfilter button[data-g]').forEach(function(b){
    b.onclick=function(){
      pane.querySelectorAll('.srcfilter button').forEach(function(x){x.classList.remove('on')});
      b.classList.add('on');var g=b.dataset.g;
      pane.querySelectorAll('.vrow').forEach(function(r){r.hidden=g!=='all'&&r.dataset.group!==g;});
    };
  });
  // auto-load the default composed prompt (localStorage draft wins)
  var ta=pane.querySelector('.prompt');
  if(ta){
    var lk='studioPrompt:'+pane.dataset.id+':'+pane.dataset.face;
    var saved=localStorage.getItem(lk);
    if(saved){ta.value=saved;}
    else{fetch('/studio/'+pane.dataset.id+'/'+pane.dataset.face+'/prompt').then(function(r){return r.text();}).then(function(t){if(!ta.value)ta.value=t;});}
    ta.addEventListener('input',function(){localStorage.setItem(lk,ta.value);});
  }
  // default selection: the promoted version, else the first
  selectRow(pane,pane.querySelector('.vrow.chosen')||pane.querySelector('.vrow'));
}
// Direct load of /studio/<id>: init the open detail's active pane.
document.querySelectorAll('.card.open .detail').forEach(function(det){
  initPane(det.querySelector('.fpane[data-face="'+det.dataset.face+'"]'));
});
`;
