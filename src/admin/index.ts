/**
 * bg-admin — the isolated cover-studio control plane. Runs as its own container
 * (no Ingress; reachable only inside the cluster), shares the app's PVC + GCS
 * bucket, and is the ONLY place cover/spine images are chosen. It reads the
 * catalog the worker writes and drives the asset store via the studio model.
 */
import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { loadCatalog } from "../store.ts";
import { buildAssetPlatform } from "../asset/platform.ts";
import { runPipeline } from "../asset/pipeline.ts";
import type { Entity } from "../asset/types.ts";
import { addCandidate, history, promote, isManaged, type Provider } from "../asset/studio.ts";
import { generateFace, composePrompt } from "../asset/gen/generate.ts";
import { obsidianEnabled, readGlobalStyleRaw, saveGlobalStyle, DEFAULT_GLOBAL_STYLE, readGameArtNote, saveGameArtNote } from "../asset/gen/prompt-store.ts";
import type { AssetKey } from "../asset/key.ts";
import type { Face } from "../asset/box-contract.ts";
import { studioPage, renderFacePane } from "./views.tsx";

const env = (k: string, d?: string): string => process.env[k] ?? d ?? "";
const DATA_DIR = env("DATA_DIR", "./data");
const PORT = Number(env("ADMIN_PORT", "3001"));
const GCS = !!env("ASSETS_GCS_BUCKET");
const OPENAI = !!env("OPENAI_API_KEY");
const GEMINI = !!env("GEMINI_API_KEY");
const OBSIDIAN = obsidianEnabled();
const PROVIDERS: ("openai" | "google")[] = [
  ...(GEMINI ? ["google" as const] : []),
  ...(OPENAI ? ["openai" as const] : []),
];

const { service, serve, tiered, sources } = buildAssetPlatform({
  dataDir: DATA_DIR,
  bgg: { bearerToken: env("BGG_BEARER_TOKEN") },
  ludopedia: {
    token: env("LUDOPEDIA_ACCESS_TOKEN") || env("LUDOPEDIA_ACESS_TOKEN"),
    cookie: env("LUDOPEDIA_COOKIE"),
  },
});
const app = new Hono();

const slugOf = (url?: string) => url?.match(/jogo\/([^/?#]+)/)?.[1]?.toLowerCase();
const toEntity = (g: Awaited<ReturnType<typeof gameById>> & {}): Entity => ({
  id: g.id,
  name: g.name,
  bggId: g.bggId,
  ludopediaId: g.ludopediaId,
  ludopediaSlug: slugOf(g.urlLudopedia),
});

const isFace = (s: string): s is Face => s === "front" || s === "spine";
const gameById = async (id: string) => (await loadCatalog(DATA_DIR)).find((g) => g.id === id);
const extFor = (name: string, contentType: string): string => {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return name.slice(dot + 1).toLowerCase();
  return contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "png";
};

const studioOpts = { gcs: tiered, providers: PROVIDERS, obsidian: OBSIDIAN };

// Index: tiles only — candidate histories load per game on the detail route,
// which is what made the old all-in-one index slow enough to need idleTimeout.
app.get("/", async (c) => c.html(studioPage(await loadCatalog(DATA_DIR), studioOpts)));

// Per-game studio detail under its own path (shareable /studio/<id>).
app.get("/studio/:id", async (c) => {
  const games = await loadCatalog(DATA_DIR);
  const game = games.find((g) => g.id === c.req.param("id"));
  if (!game) return c.text("Jogo não encontrado", 404);
  const [front, spine] = await Promise.all([
    history(service, game.id, "front"),
    history(service, game.id, "spine"),
  ]);
  return c.html(studioPage(games, studioOpts, { game, front, spine }));
});

// Global house style (Obsidian Inventory note). GET prefills the editor with the
// stored value, or the built-in default when unset.
app.get("/global-style", async (c) => {
  if (!OBSIDIAN) return c.text(DEFAULT_GLOBAL_STYLE);
  const raw = await readGlobalStyleRaw();
  return c.text(raw.trim() || DEFAULT_GLOBAL_STYLE);
});
app.post("/global-style", async (c) => {
  if (!OBSIDIAN) return c.text("Obsidian not configured", 503);
  const form = await c.req.parseBody();
  await saveGlobalStyle(String(form["style"] ?? ""));
  return c.redirect("/");
});

// Per-game art note (`box-art/description`) — read live and write back to Obsidian.
app.get("/studio/:id/art-note", async (c) => {
  if (!OBSIDIAN) return c.text("");
  return c.text(await readGameArtNote(c.req.param("id")));
});
app.post("/studio/:id/art-note", async (c) => {
  if (!OBSIDIAN) return c.text("Obsidian not configured", 503);
  const form = await c.req.parseBody();
  const ok = await saveGameArtNote(c.req.param("id"), String(form["text"] ?? ""));
  if (!ok) return c.text("note not found in vault", 404);
  return c.json({ ok: true });
});

// Single face-pane fragment — for in-place AJAX refresh after a detail action.
app.get("/studio/:id/pane/:face", async (c) => {
  const face = c.req.param("face");
  if (!isFace(face)) return c.text("bad face", 400);
  const game = await gameById(c.req.param("id"));
  if (!game) return c.text("not found", 404);
  const hist = await history(service, game.id, face);
  return c.html(renderFacePane(game, face, hist, { gcs: tiered, providers: PROVIDERS, obsidian: OBSIDIAN }));
});

app.post("/studio/:id/:face/upload", async (c) => {
  const id = c.req.param("id");
  const face = c.req.param("face");
  if (!isFace(face)) return c.text("bad face", 400);
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) return c.text("no file", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return c.text("empty file", 400);
  const contentType = file.type || "image/png";
  const ext = extFor(file.name, contentType);
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  await addCandidate(service, id, face, "upload", { bytes, contentType, fingerprint }, ext);
  return c.json({ ok: true });
});

// Composed default prompt (for prefilling the live-edit box).
app.get("/studio/:id/:face/prompt", async (c) => {
  const face = c.req.param("face");
  if (!isFace(face)) return c.text("bad face", 400);
  const game = await gameById(c.req.param("id"));
  if (!game) return c.text("not found", 404);
  return c.text(await composePrompt(service, game, face));
});

// Generate a face (disk-only candidate). Optional `prompt` overrides the default.
app.post("/studio/:id/:face/generate", async (c) => {
  const face = c.req.param("face");
  if (!isFace(face)) return c.text("bad face", 400);
  const game = await gameById(c.req.param("id"));
  if (!game) return c.text("not found", 404);
  const form = await c.req.parseBody();
  const prompt = String(form["prompt"] ?? "");
  const provider = String(form["provider"] ?? PROVIDERS[0] ?? "") as "openai" | "google";
  if (!PROVIDERS.includes(provider)) return c.text("no generation provider configured", 503);
  const apiKey = provider === "google" ? env("GEMINI_API_KEY") : env("OPENAI_API_KEY");
  const model = provider === "google" ? env("GEMINI_IMAGE_MODEL") : env("OPENAI_IMAGE_MODEL");
  try {
    await generateFace(service, game, face, { provider, apiKey, model: model || undefined, promptOverride: prompt });
  } catch (e) {
    return c.text(`generation failed: ${(e as Error).message}`, 502);
  }
  return c.json({ ok: true });
});

const keyFromForm = async (c: { req: { parseBody: () => Promise<Record<string, unknown>>; param: (n: string) => string } }): Promise<{ key: AssetKey; face: Face } | null> => {
  const id = c.req.param("id");
  const face = c.req.param("face");
  if (!isFace(face)) return null;
  const form = await c.req.parseBody();
  const provider = String(form["provider"] ?? "") as Provider;
  const version = String(form["version"] ?? "");
  const ext = String(form["ext"] ?? "");
  const kind = String(form["kind"] ?? face); // where the candidate is stored (front/cover/spine)
  if (!provider || !version || !ext) return null;
  return { key: { entity: id, kind, source: provider, variant: version, ext }, face };
};

app.post("/studio/:id/:face/promote", async (c) => {
  const r = await keyFromForm(c);
  if (!r) return c.text("bad request", 400);
  await promote(service, r.key, r.face, DATA_DIR);
  return c.json({ ok: true });
});

// Persist a candidate to the durable origin (GCS).
app.post("/studio/:id/:face/save", async (c) => {
  const r = await keyFromForm(c);
  if (!r) return c.text("bad request", 400);
  await service.save(r.key);
  return c.json({ ok: true });
});

// Delete from the durable origin (GCS) only — keeps the local copy. Managed
// candidates are refused (same reason as delete: the sync re-pulls them).
app.post("/studio/:id/:face/gcs-delete", async (c) => {
  const r = await keyFromForm(c);
  if (!r) return c.text("bad request", 400);
  if (isManaged(r.key.source)) return c.text(`capa automática (${r.key.source}) — re-baixada pelo sync; não pode ser apagada`, 409);
  await service.removeOrigin(r.key);
  return c.json({ ok: true });
});

// Delete the local copy. Managed candidates (bgg/ludopedia covers) are refused:
// the worker re-pulls them on every sync, so deleting is a confusing no-op —
// use "Baixar capas" to refresh instead. When GCS is on the durable copy stays
// until gcs-delete — or the delete dialog sends also=gcs to remove both tiers.
app.post("/studio/:id/:face/delete", async (c) => {
  const r = await keyFromForm(c);
  if (!r) return c.text("bad request", 400);
  if (isManaged(r.key.source)) return c.text(`capa automática (${r.key.source}) — re-baixada pelo sync; não pode ser apagada`, 409);
  const form = await c.req.parseBody(); // cached: keyFromForm already parsed it
  await service.removeDerivativesOf(r.key); // sweep its resizes first; else they linger as phantom rows
  if (tiered) {
    await service.removeCache(r.key);
    if (String(form["also"] ?? "") === "gcs") await service.removeOrigin(r.key);
  } else await service.remove(r.key);
  return c.json({ ok: true });
});

// Bulk delete the marked candidates (multi-select in the version list). Body:
// `keys` = JSON array of {provider, version, ext, kind}, optional `also=gcs`
// to drop the durable copies too. Same tier semantics as the single delete.
app.post("/studio/:id/:face/delete-many", async (c) => {
  const face = c.req.param("face");
  if (!isFace(face)) return c.text("bad request", 400);
  const form = await c.req.parseBody();
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(form["keys"] ?? "[]"));
  } catch {
    return c.text("bad request", 400);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return c.text("bad request", 400);
  const keys: AssetKey[] = [];
  for (const k of parsed) {
    if (typeof k !== "object" || k === null) return c.text("bad request", 400);
    const o = k as Record<string, unknown>; // shape asserted below, field by field
    const provider = typeof o.provider === "string" ? o.provider : "";
    const version = typeof o.version === "string" ? o.version : "";
    const ext = typeof o.ext === "string" ? o.ext : "";
    const kind = typeof o.kind === "string" && o.kind ? o.kind : face;
    if (!provider || !version || !ext) return c.text("bad request", 400);
    keys.push({ entity: c.req.param("id"), kind, source: provider as Provider, variant: version, ext });
  }
  const alsoGcs = String(form["also"] ?? "") === "gcs";
  const errors: string[] = [];
  const skipped: string[] = []; // managed (bgg/ludopedia) — sync re-pulls them
  let deleted = 0;
  await Promise.all(keys.map(async (key) => {
    if (isManaged(key.source)) {
      skipped.push(`${key.source}/${key.variant}`);
      return;
    }
    try {
      await service.removeDerivativesOf(key); // sweep resizes first; else phantom rows
      if (tiered) {
        await service.removeCache(key);
        if (alsoGcs) await service.removeOrigin(key);
      } else await service.remove(key);
      deleted++;
    } catch (e) {
      errors.push(`${key.source}/${key.variant}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
  return c.json({ ok: errors.length === 0, deleted, skipped, errors });
});

// ---- Bulk generation (background job + progress polling) --------------------
type BulkJob = { total: number; done: number; current: string; errors: string[]; running: boolean };
const bulkJobs = new Map<string, BulkJob>();

app.post("/bulk/generate", async (c) => {
  const body = await c.req.parseBody();
  const ids = String(body["ids"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const faceSel = String(body["face"] ?? "front");
  const faces: Face[] = faceSel === "both" ? ["front", "spine"] : isFace(faceSel) ? [faceSel] : ["front"];
  const provider = String(body["provider"] ?? PROVIDERS[0] ?? "") as "openai" | "google";
  if (!ids.length) return c.text("no games selected", 400);
  if (!PROVIDERS.includes(provider)) return c.text("no generation provider configured", 503);
  const apiKey = provider === "google" ? env("GEMINI_API_KEY") : env("OPENAI_API_KEY");
  const model = provider === "google" ? env("GEMINI_IMAGE_MODEL") : env("OPENAI_IMAGE_MODEL");

  const tasks = ids.flatMap((id) => faces.map((f) => ({ id, f })));
  const jobId = randomUUID();
  const job: BulkJob = { total: tasks.length, done: 0, current: "", errors: [], running: true };
  bulkJobs.set(jobId, job);
  void (async () => {
    for (const t of tasks) {
      const game = await gameById(t.id);
      job.current = `${game?.name ?? t.id} · ${t.f}`;
      try {
        if (game) await generateFace(service, game, t.f, { provider, apiKey, model: model || undefined });
      } catch (e) {
        job.errors.push(`${game?.name ?? t.id}/${t.f}: ${(e as Error).message}`);
      }
      job.done++;
    }
    job.running = false;
    job.current = "";
  })();
  return c.json({ jobId });
});

app.get("/bulk/status/:job", (c) => {
  const j = bulkJobs.get(c.req.param("job"));
  return j ? c.json(j) : c.text("no job", 404);
});

// Fetch cover candidates (BGG + Ludopedia) for one game on demand (force refresh).
app.post("/studio/:id/download", async (c) => {
  const game = await gameById(c.req.param("id"));
  if (!game) return c.text("not found", 404);
  await runPipeline([toEntity(game)], sources, service, undefined, { force: true });
  return c.json({ ok: true });
});

// Bulk download / refresh cover candidates for selected games (background job).
app.post("/bulk/download", async (c) => {
  const body = await c.req.parseBody();
  const ids = String(body["ids"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return c.text("no games selected", 400);
  const jobId = randomUUID();
  const job: BulkJob = { total: ids.length, done: 0, current: "", errors: [], running: true };
  bulkJobs.set(jobId, job);
  void (async () => {
    for (const id of ids) {
      const game = await gameById(id);
      job.current = game?.name ?? id;
      try {
        if (game) await runPipeline([toEntity(game)], sources, service, undefined, { force: true });
      } catch (e) {
        job.errors.push(`${game?.name ?? id}: ${(e as Error).message}`);
      }
      job.done++;
    }
    job.running = false;
    job.current = "";
  })();
  return c.json({ jobId });
});

app.get("/healthz", (c) => c.json({ ok: true }));
app.route("/", serve); // signed asset rendering (shared secret with the app)

console.log(`bg-admin listening on :${PORT} (data ${DATA_DIR}, tiered=${tiered}, gcs=${GCS}, openai=${OPENAI}, gemini=${GEMINI}, obsidian=${OBSIDIAN})`);
export default { port: PORT, fetch: app.fetch, idleTimeout: 60 }; // /studio/:id lists a game's GCS tier; default 10s can be tight on cold buckets
