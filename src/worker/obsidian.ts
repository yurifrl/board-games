/**
 * Obsidian Local REST API client. The worker's only link to the vault.
 * Self-signed cert: TLS verification is disabled here (and only here).
 */
const AUTH = "9f58933d377249b0117972991ae5765f6cc174e7b2ef215b8ceb4eb10974f9d7";
const BASE = "https://localhost:27124";

// ponytail: disable TLS check for the self-signed Obsidian cert; only this client, worker-only.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export type ObsidianConfig = {
  url: string;
  apiKey: string;
};

export const defaultObsidianConfig = (): ObsidianConfig => ({
  url: process.env.OBSIDIAN_API_URL ?? BASE,
  apiKey: process.env.OBSIDIAN_API_KEY ?? AUTH,
});

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
