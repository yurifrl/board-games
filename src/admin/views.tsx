/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { Game } from "../games.ts";
import type { Face } from "../asset/box-contract.ts";
import type { Candidate } from "../asset/studio.ts";
import { displayKey } from "../asset/studio.ts";
import { boxArtKey } from "../asset/box-contract.ts";
import { sign } from "../asset/auth.ts";

export type Studio = { game: Game; front: Candidate[]; spine: Candidate[] };
export type GenProvider = "openai" | "google";
export type Opts = { gcs: boolean; providers: GenProvider[]; obsidian: boolean };
const PROVIDER_LABEL: Record<GenProvider, string> = { openai: "OpenAI", google: "Gemini" };

// Which source group a provider belongs to (drives the section toggle).
const groupOf = (provider: string): "downloaded" | "gen" | "upload" =>
  provider === "bgg" || provider === "ludopedia" ? "downloaded" : provider === "upload" ? "upload" : "gen";

const candidateUrl = (c: Candidate, w: number): string =>
  `/asset/${c.key.entity}/${c.key.kind}/${c.key.source}/${c.key.variant}.${c.key.ext}?${sign(c.key, { w })}`;

const displayUrl = (id: string, face: Face, w: number): string =>
  `/asset/${id}/display/${face}/latest.png?${sign(displayKey(id, face), { w })}`;

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

const VRow: FC<{ c: Candidate; gcs: boolean }> = ({ c, gcs }) => {
  const when = new Date(Number(c.version) || 0);
  const label = when.getTime() ? when.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "";
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
      data-ongcs={gcs && c.onGcs ? "1" : ""}
      title={`${c.provider}${label ? " · " + label : ""}`}
    >
      <img src={candidateUrl(c, 200)} alt="" loading="lazy" />
      <span class="vprov">{c.provider}</span>
      {c.chosen ? <span class="vchosen" title="No ar">★</span> : null}
      {gcs && c.onGcs ? <span class="vsaved" title="salva no GCS">☁</span> : null}
    </button>
  );
};

const FacePane: FC<{ g: Game; face: Face; history: Candidate[]; opts: Opts }> = ({ g, face, history, opts }) => {
  const fb = face === "front" ? coverFallback(g, 900) : genSpineFallback(g.id);
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
          <button type="button" data-g="all" class="on">Todas <b>{history.length}</b></button>
          <button type="button" data-g="downloaded">Baixadas</button>
          <button type="button" data-g="gen">Geradas</button>
          <button type="button" data-g="upload">Enviadas</button>
        </div>
        <div class="vlist">
          <form class="add" method="post" action={`/studio/${g.id}/${face}/upload`} enctype="multipart/form-data">
            <label title="Enviar imagem do computador">＋<input type="file" name="file" accept="image/*" onchange="this.form.submit()" /></label>
          </form>
          {history.map((c) => <VRow c={c} gcs={opts.gcs} />)}
          {history.length === 0 ? <div class="empty">sem histórico ainda</div> : null}
        </div>
      </div>
      <div class="stage">
        <div class="preview">
          <img src={displayUrl(g.id, face, 900)} alt="" data-fb={fb || undefined} onerror={fbChain(fb)} />
        </div>
        <div class="actbar" hidden>
          <form method="post" action={`/studio/${g.id}/${face}/promote`}>{hidden}<button class="btn primary" title="Tornar esta a imagem exibida">★ Promover</button></form>
          <form method="post" action={`/studio/${g.id}/${face}/save`} class="act-save">{hidden}<button class="btn">☁ Salvar no GCS</button></form>
          <form method="post" action={`/studio/${g.id}/${face}/gcs-delete`} class="act-gdel" onsubmit="return confirm('Remover do GCS? (mantém a cópia local)')">{hidden}<button class="btn warn">☁ Remover do GCS</button></form>
          <form method="post" action={`/studio/${g.id}/${face}/delete`} onsubmit="return confirm(this.dataset.msg)" data-msg={opts.gcs ? "Apagar a cópia local?" : "Apagar esta imagem?"}>{hidden}<button class="btn danger">🗑 Apagar</button></form>
        </div>
      </div>
      {opts.providers.length > 0 ? (
        <aside class="side">
          <div class="gptitle">Gerar {face === "front" ? "frente" : "lombada"}</div>
          <form method="post" action={`/studio/${g.id}/${face}/generate`} onsubmit="var b=this.querySelector('.gengo');b.disabled=true;b.textContent='gerando…';">
            <textarea name="prompt" class="prompt" rows={8} placeholder="carregando prompt padrão…"></textarea>
            <div class="gpcontrols">
              {opts.providers.length > 1 ? (
                <select name="provider" class="provsel">{opts.providers.map((p) => <option value={p}>{PROVIDER_LABEL[p]}</option>)}</select>
              ) : (
                <input type="hidden" name="provider" value={opts.providers[0]} />
              )}
              <span class="gpaspect">proporção automática</span>
              <button type="submit" class="gengo">Gerar</button>
            </div>
          </form>
        </aside>
      ) : null}
    </div>
  );
};

const Tile: FC<{ s: Studio; opts: Opts }> = ({ s, opts }) => {
  const g = s.game;
  const ar = g.dimensions ? `${g.dimensions.widthCm}/${g.dimensions.heightCm}` : "3/4";
  return (
    <section class="card" data-id={g.id} data-name={g.name.toLowerCase()} style={`--tint:${g.tint ?? "#3a3a44"}`}>
      <input type="checkbox" class="pick" title="Selecionar" />
      <button class="tile" type="button">
        <span class="front" style={`aspect-ratio:${ar}`}>
          <img src={displayUrl(g.id, "front", 300)} alt="" loading="lazy" data-fb={coverFallback(g, 300) || undefined} onerror={fbChain(coverFallback(g, 300))} />
          <span class="nm">{g.name}</span>
        </span>
        <span class="spine">
          <span class="snm">{g.name}</span>
          <img src={displayUrl(g.id, "spine", 240)} alt="" loading="lazy" data-fb={genSpineFallback(g.id)} onerror={fbChain(genSpineFallback(g.id))} />
        </span>
      </button>
      <div class="detail" data-id={g.id} data-face="front">
        <div class="dhead">
          <b>{g.name}</b>
          <div class="facetabs">
            <button type="button" data-f="front" class="on">Frente</button>
            <button type="button" data-f="spine">Lombada</button>
          </div>
          <form method="post" action={`/studio/${g.id}/download`} class="dlform" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='baixando…';"><button type="submit" class="dlbtn" title="Rebaixar capas BGG/Ludopedia">⬇ Baixar capas</button></form>
          <button type="button" class="close" title="Fechar">✕</button>
        </div>
        {opts.obsidian ? (
          <details class="artnote">
            <summary>✎ Nota de arte (Obsidian · aplica-se aos prompts)</summary>
            <form method="post" action={`/studio/${g.id}/art-note`}>
              <textarea name="text" class="prompt" rows={2} placeholder="direção de arte específica deste jogo…">{g.boxArtDescription ?? ""}</textarea>
              <div class="genrow"><button type="submit" class="gengo">Salvar no Obsidian</button></div>
            </form>
          </details>
        ) : null}
        <div class="panes">
          <FacePane g={g} face="front" history={s.front} opts={opts} />
          <FacePane g={g} face="spine" history={s.spine} opts={opts} />
        </div>
      </div>
    </section>
  );
};

export const studioPage = (items: Studio[], opts: Opts): string =>
  "<!doctype html>" +
  (
    <html lang="pt-BR">
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
            <button data-v="front">Frente</button>
            <button data-v="spine">Lombada</button>
            <button data-v="both" class="on">Ambos</button>
          </div>
          <input id="q" type="search" placeholder="filtrar jogos…" />
          {opts.providers.length > 0 ? <button id="selBtn" class="gstyle">Selecionar</button> : null}
          {opts.obsidian ? <button id="globalStyleBtn" class="gstyle">Estilo global</button> : null}
        </header>
        {opts.providers.length > 0 ? (
          <div id="bulkbar">
            <input id="pat" type="text" placeholder="regex p/ marcar (ex: ^cat|arcs)" />
            <button type="button" id="patGo">Marcar</button>
            <span id="selCount">0 marcados</span>
            <select id="bulkFace">
              <option value="front">Frente</option>
              <option value="spine">Lombada</option>
              <option value="both">Ambos</option>
            </select>
            {opts.providers.length > 1 ? (
              <select id="bulkProv">{opts.providers.map((p) => <option value={p}>{PROVIDER_LABEL[p]}</option>)}</select>
            ) : null}
            <button type="button" id="bulkGo" class="gengo">Gerar</button>
            <button type="button" id="bulkDl">⬇ Baixar</button>
            <span id="bulkProg"></span>
          </div>
        ) : null}
        {opts.obsidian ? (
          <dialog id="globalStyleDlg">
            <form method="post" action="/global-style">
              <h3>Estilo global <span class="hint">(Obsidian · Inventory.md · aplica-se à frente)</span></h3>
              <textarea name="style" class="prompt" rows={10} placeholder="estilo da casa…"></textarea>
              <div class="genrow">
                <button type="button" class="gsclose">Cancelar</button>
                <button type="submit" class="gengo">Salvar no Obsidian</button>
              </div>
            </form>
          </dialog>
        ) : null}
        <main>{items.map((s) => <Tile s={s} opts={opts} />)}</main>
        <script dangerouslySetInnerHTML={{ __html: JS }} />
      </body>
    </html>
  );

const CSS = `
*{box-sizing:border-box}
html,body{max-width:100%;overflow-x:hidden}
body{margin:0;font:14px/1.4 system-ui,sans-serif;background:#14141a;color:#e8e8ee}
header{position:sticky;top:0;z-index:10;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:#1c1c26cc;backdrop-filter:blur(8px);border-bottom:1px solid #2a2a38}
header h1{font-size:17px;margin:0}
.views{display:flex;gap:6px}
.views button{background:#2a2a38;color:#cfcfe0;border:0;border-radius:999px;padding:6px 14px;cursor:pointer}
.views button.on{background:#5b6cff;color:#fff}
#q{flex:1;min-width:160px;background:#0f0f16;border:1px solid #2a2a38;color:#e8e8ee;border-radius:8px;padding:8px 12px}
.gstyle{background:#2a2a38;color:#cfcfe0;border:0;border-radius:999px;padding:6px 14px;cursor:pointer}
.gstyle.on{background:#5b6cff;color:#fff}
#bulkbar{display:none;width:100%;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#181822;border-bottom:1px solid #2a2a38}
body[data-sel] #bulkbar{display:flex}
#bulkbar input,#bulkbar select{background:#0f0f16;border:1px solid #2a2a38;color:#e8e8ee;border-radius:8px;padding:6px 10px}
#bulkbar #pat{flex:1;min-width:160px}
#bulkbar button{border:0;border-radius:8px;padding:6px 12px;cursor:pointer}
#patGo{background:#2a2a38;color:#cfcfe0}
#bulkDl,.dlbtn{background:#2a2a38;color:#cfcfe0}
.dlform{display:inline;margin:0 auto 0 0}
.dlbtn{border:0;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px}
#selCount,#bulkProg{color:#9a9ab0;font-size:12px}
.card .pick{display:none;position:absolute;top:8px;left:8px;z-index:3;width:20px;height:20px;cursor:pointer}
body[data-sel] .card{position:relative}
body[data-sel] .card .pick{display:block}
body[data-sel] .card.marked{outline:2px solid #5b6cff;outline-offset:3px;border-radius:6px}
dialog#globalStyleDlg{width:min(680px,92vw);background:#1c1c26;color:#e8e8ee;border:1px solid #2a2a38;border-radius:14px;padding:18px}
dialog#globalStyleDlg::backdrop{background:#0009}
dialog#globalStyleDlg h3{margin:0 0 10px;font-size:15px}
dialog#globalStyleDlg .hint{color:#8a8a9a;font-weight:400;font-size:12px}

/* List: flat, shelf-less — front covers and/or spines, sized like the app */
main{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;padding:20px}
.card{--h:210px}
.tile{all:unset;cursor:pointer;display:flex;gap:8px;align-items:flex-end}
.tile:hover{transform:translateY(-4px)}
.tile{transition:transform .15s}
/* front cover */
.tile .front{position:relative;height:var(--h);border-radius:8px;overflow:hidden;background:var(--tint);box-shadow:0 8px 18px #0006}
.tile .front img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tile .front .nm{position:absolute;left:0;right:0;bottom:0;padding:6px 8px;font-size:12px;font-weight:700;color:#fff;background:linear-gradient(0deg,#000b,transparent);text-shadow:0 1px 2px #000}
/* spine */
.tile .spine{position:relative;width:44px;height:var(--h);border-radius:3px;overflow:hidden;background:var(--tint);box-shadow:0 8px 18px #0006}
.tile .spine img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}
.tile .spine .snm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;transform:rotate(180deg);color:#fff;font-weight:700;font-size:12px;text-shadow:0 1px 2px #000;padding:10px 0;text-align:center}
/* per-view visibility */
body[data-view=front] .tile .spine,body[data-view=spine] .tile .front{display:none}

/* Detail overlay (opens on tile click) */
.detail{display:none}
.card.open .detail{display:flex;flex-direction:column;position:fixed;inset:0;z-index:50;background:#15151d;padding:0;overflow:hidden}
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
.empty{color:#55556e;font-size:12px;padding:8px 4px;grid-column:1/-1}

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
  .fpane{grid-template-columns:1fr;grid-template-rows:auto auto auto;overflow:auto}
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
    ta.value='carregando\u2026';dlg.showModal();
    fetch('/global-style').then(function(r){return r.text();}).then(function(t){ta.value=t;});
  };
  dlg.querySelector('.gsclose').onclick=function(){dlg.close();};
})();
document.querySelectorAll('.views button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('.views button').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');body.dataset.view=b.dataset.v;localStorage.setItem('studioView',b.dataset.v);};});
var sv=localStorage.getItem('studioView');if(sv){var t=document.querySelector('.views button[data-v="'+sv+'"]');if(t)t.click();}

var q=document.getElementById('q');q.oninput=function(){var v=q.value.toLowerCase();
  document.querySelectorAll('.card').forEach(function(c){c.style.display=c.dataset.name.indexOf(v)>=0?'':'none';});};

// open/close detail (in select mode, a card click toggles its checkbox instead)
document.querySelectorAll('.card').forEach(function(card){
  var pick=card.querySelector('.pick');
  card.querySelector('.tile').onclick=function(){
    if(body.dataset.sel!==undefined){pick.checked=!pick.checked;pick.onchange();return;}
    card.classList.add('open');
    var det=card.querySelector('.detail');
    initPane(det.querySelector('.fpane[data-face="'+det.dataset.face+'"]'));
  };
  card.querySelector('.close').onclick=function(){card.classList.remove('open');};
  if(pick)pick.onchange=function(){card.classList.toggle('marked',pick.checked);bulkCount();};
});

// ---- bulk selection + generation ----
function picked(){return Array.prototype.slice.call(document.querySelectorAll('.card .pick:checked')).map(function(p){return p.closest('.card').dataset.id;});}
function bulkCount(){var el=document.getElementById('selCount');if(el)el.textContent=picked().length+' marcados';}
(function(){
  var selBtn=document.getElementById('selBtn');if(!selBtn)return;
  selBtn.onclick=function(){
    if(body.dataset.sel!==undefined){delete body.dataset.sel;selBtn.classList.remove('on');}
    else{body.dataset.sel='';selBtn.classList.add('on');}
  };
  var patGo=document.getElementById('patGo'),pat=document.getElementById('pat');
  if(patGo)patGo.onclick=function(){
    var re;try{re=new RegExp(pat.value,'i');}catch(e){alert('regex inv\u00e1lida');return;}
    document.querySelectorAll('.card').forEach(function(c){
      if(c.style.display==='none')return;
      var m=re.test(c.dataset.name);var pk=c.querySelector('.pick');pk.checked=m;c.classList.toggle('marked',m);
    });
    bulkCount();
  };
  var go=document.getElementById('bulkGo'),dl=document.getElementById('bulkDl'),prog=document.getElementById('bulkProg');
  function runBulk(url,extra){
    var ids=picked();if(!ids.length){alert('nada marcado');return;}
    var fd=new URLSearchParams();fd.set('ids',ids.join(','));for(var k in extra)fd.set(k,extra[k]);
    if(go)go.disabled=true;if(dl)dl.disabled=true;prog.textContent='iniciando\u2026';
    fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()})
      .then(function(r){return r.json();}).then(function(d){
        var t=setInterval(function(){
          fetch('/bulk/status/'+d.jobId).then(function(r){return r.json();}).then(function(s){
            prog.textContent=s.done+'/'+s.total+(s.current?(' \u00b7 '+s.current):'')+(s.errors.length?(' \u00b7 '+s.errors.length+' erro(s)'):'');
            if(!s.running){clearInterval(t);if(go)go.disabled=false;if(dl)dl.disabled=false;prog.textContent='conclu\u00eddo '+s.done+'/'+s.total+(s.errors.length?(' ('+s.errors.length+' erro)'):'');setTimeout(function(){location.reload();},900);}
          });
        },1000);
      }).catch(function(e){if(go)go.disabled=false;if(dl)dl.disabled=false;prog.textContent='falhou: '+e;});
  }
  if(go)go.onclick=function(){
    var face=document.getElementById('bulkFace').value;
    var pv=document.getElementById('bulkProv');var provider=pv?pv.value:'';
    var extra={face:face};if(provider)extra.provider=provider;
    runBulk('/bulk/generate',extra);
  };
  if(dl)dl.onclick=function(){runBulk('/bulk/download',{});};
})();
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.querySelectorAll('.card.open').forEach(function(c){c.classList.remove('open');});});

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
  var onGcs=row.dataset.ongcs==='1';
  var save=bar.querySelector('.act-save'),gdel=bar.querySelector('.act-gdel');
  if(save)save.style.display=onGcs?'none':'';
  if(gdel)gdel.style.display=onGcs?'':'none';
}

function initPane(pane){
  if(!pane||pane.dataset.init)return;pane.dataset.init='1';
  // rows -> selection
  pane.querySelectorAll('.vrow').forEach(function(r){r.addEventListener('click',function(){selectRow(pane,r);});});
  // source filter
  pane.querySelectorAll('.srcfilter button').forEach(function(b){
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
`;
