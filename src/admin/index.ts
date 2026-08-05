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
import { addCandidate, history, promote, type Provider } from "../asset/studio.ts";
import { generateFace, composePrompt } from "../asset/gen/generate.ts";
import { obsidianEnabled, readGlobalStyleRaw, saveGlobalStyle, DEFAULT_GLOBAL_STYLE, readGameArtNote, saveGameArtNote } from "../asset/gen/prompt-store.ts";
import type { AssetKey } from "../asset/key.ts";
import type { Face } from "../asset/box-contract.ts";
import { studioPage, type Studio } from "./views.tsx";

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

app.get("/", async (c) => {
  const games = await loadCatalog(DATA_DIR);
  const items: Studio[] = await Promise.all(
    games.map(async (game) => ({
      game,
      front: await history(service, game.id, "front"),
      spine: await history(service, game.id, "spine"),
    })),
  );
  return c.html(studioPage(items, { gcs: tiered, providers: PROVIDERS, obsidian: OBSIDIAN }));
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
  return c.redirect("/");
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
  return c.redirect("/");
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
  return c.redirect("/");
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
  await promote(service, r.key, r.face);
  return c.redirect("/");
});

// Persist a candidate to the durable origin (GCS).
app.post("/studio/:id/:face/save", async (c) => {
  const r = await keyFromForm(c);
  if (!r) return c.text("bad request", 400);
  await service.save(r.key);
  return c.redirect("/");
});

// Delete from the durable origin (GCS) only — keeps the local copy.
app.post("/studio/:id/:face/gcs-delete", async (c) => {
  const r = await keyFromForm(c);
  if (!r) return c.text("bad request", 400);
  await service.removeOrigin(r.key);
  return c.redirect("/");
});

// Delete the local copy. When GCS is off this is the only tier, so it's a full
// delete; when GCS is on the durable copy stays until gcs-delete.
app.post("/studio/:id/:face/delete", async (c) => {
  const r = await keyFromForm(c);
  if (!r) return c.text("bad request", 400);
  if (tiered) await service.removeCache(r.key);
  else await service.remove(r.key);
  return c.redirect("/");
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
  return c.redirect("/");
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
export default { port: PORT, fetch: app.fetch };
