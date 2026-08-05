/**
 * Obsidian Local REST API client. The worker's only link to the vault.
 * Self-signed cert: TLS verification is disabled here (and only here).
 */

// ponytail: disable TLS check for the self-signed Obsidian cert; only this client, worker-only.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export type ObsidianConfig = {
  url: string;
  apiKey: string;
};

export const defaultObsidianConfig = (): ObsidianConfig => {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) throw new Error("OBSIDIAN_API_KEY is not set");
  const url = process.env.OBSIDIAN_API_URL;
  if (!url) throw new Error("OBSIDIAN_API_URL is not set");
  return { url, apiKey };
};

async function req(path: string, cfg: ObsidianConfig, init?: RequestInit): Promise<Response> {
  const url = `${cfg.url}${path}`;
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(init?.headers ?? {}) },
  });
}

/** List `.md` filenames in a vault folder (non-recursive). Returns bare names. */
export async function listNotes(folder: string, cfg: ObsidianConfig = defaultObsidianConfig()): Promise<string[]> {
  const path = `/vault/${encodeURI(folder)}/`;
  const res = await req(path, cfg, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`list ${folder}: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { files: string[] };
  return (data.files ?? []).filter((f) => f.endsWith(".md"));
}

/** Fetch a single note's raw markdown. */
export async function getNote(path: string, cfg: ObsidianConfig = defaultObsidianConfig()): Promise<string> {
  const res = await req(`/vault/${encodeURI(path)}`, cfg, { headers: { Accept: "text/markdown" } });
  if (!res.ok) throw new Error(`get ${path}: ${res.status}`);
  return res.text();
}

/** Find a note's path via the simple full-text search (e.g. by unique id). */
export async function findNotePath(
  query: string,
  cfg: ObsidianConfig = defaultObsidianConfig(),
): Promise<string | null> {
  const res = await req(`/search/simple/?query=${encodeURIComponent(query)}&contextLength=0`, cfg, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`search ${query}: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { filename: string }[];
  return data[0]?.filename ?? null;
}

/** Read a note's frontmatter object. */
export async function getFrontmatter(
  path: string,
  cfg: ObsidianConfig = defaultObsidianConfig(),
): Promise<Record<string, unknown>> {
  const res = await req(`/vault/${encodeURI(path)}`, cfg, {
    headers: { Accept: "application/vnd.olrapi.note+json" },
  });
  if (!res.ok) throw new Error(`get frontmatter ${path}: ${res.status}`);
  const data = (await res.json()) as { frontmatter?: Record<string, unknown> };
  return data.frontmatter ?? {};
}

/** Set (replace or create) a single frontmatter field on a note via PATCH. */
export async function setFrontmatter(
  path: string,
  field: string,
  value: string,
  cfg: ObsidianConfig = defaultObsidianConfig(),
): Promise<void> {
  const res = await req(`/vault/${encodeURI(path)}`, cfg, {
    method: "PATCH",
    headers: {
      Operation: "replace",
      "Target-Type": "frontmatter",
      Target: field,
      "Create-Target-If-Missing": "true",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`patch ${path} (${field}): ${res.status} ${await res.text()}`);
}
