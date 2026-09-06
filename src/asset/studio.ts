/**
 * Cover Studio model — the admin control-plane over a game's images.
 *
 * Every image is addressed on the existing asset key scheme with these axes:
 *
 *   candidate:  <id>/<format>/<provider>/<version>.<ext>   (history)
 *   chosen:     <id>/display/<format>/latest.<ext>          (what the app shows)
 *
 * where format = "front" | "spine" (a Face), provider is uniform across every
 * source ("upload" | "openai" | "google" | "ludopedia" | "bgg"), and version is
 * an epoch-ms timestamp so a format's history accumulates instead of
 * overwriting. Promote copies a candidate's bytes onto the stable `latest`
 * slot (a real standalone object, so Obsidian can embed a URL that never
 * changes); the shared PVC + the service's fingerprint-tagged derivative cache
 * make the app pick up the new pick on its next request with no explicit
 * invalidation.
 */
import type { Face } from "./box-contract.ts";
import type { AssetKey } from "./key.ts";
import { keyPath } from "./key.ts";
import type { AssetService } from "./service.ts";
import type { AssetBlob } from "./types.ts";
import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "../store.ts";

export type Provider = "upload" | "openai" | "google" | "ludopedia" | "bgg";

/** A single stored candidate image, with which tiers currently hold it. */
export interface Candidate {
  key: AssetKey;
  provider: string;
  version: string;
  ext: string;
  onGcs: boolean;
  onDisk: boolean;
  /** True when this exact candidate is the one currently promoted to display. */
  chosen: boolean;
}

/** The chosen-image slot the public app + Obsidian read. */
export function displayKey(id: string, face: Face, ext = "png"): AssetKey {
  return { entity: id, kind: "display", source: face, variant: "latest", ext };
}

/** A new candidate slot for (game, face, provider); version is an epoch-ms stamp. */
export function candidateKey(id: string, face: Face, provider: Provider, ext: string, at = Date.now()): AssetKey {
  return { entity: id, kind: face, source: provider, variant: String(at), ext };
}

/** The stored `kind`s that make up a face's candidate pool. "front" includes
 * downloaded covers (kind="cover", provider bgg/ludopedia) so they show as
 * selectable/promotable candidates next to generated + uploaded art. */
const FACE_KINDS: Record<Face, string[]> = { front: ["front", "cover"], spine: ["spine"] };

/** All candidates for a game+face, every provider, newest first. Each candidate
 * is flagged with the tiers that hold it (disk cache and/or durable GCS). */
export async function history(service: AssetService, id: string, face: Face): Promise<Candidate[]> {
  const kinds = FACE_KINDS[face] ?? [face];
  const byPath = new Map<string, Candidate>();
  const ensure = (k: AssetKey): Candidate => {
    const p = keyPath(k);
    let e = byPath.get(p);
    if (!e) {
      e = { key: k, provider: k.source, version: k.variant, ext: k.ext, onGcs: false, onDisk: false, chosen: false };
      byPath.set(p, e);
    }
    return e;
  };
  // One listing per tier for the whole entity (not per kind): the admin index
  // renders every game's history, and kind-scoped prefixes multiply the GCS
  // round-trips by the number of stored kinds.
  const [orig, cache] = await Promise.all([
    service.listOrigin({ entity: id }),
    service.listCache({ entity: id }),
  ]);
  for (const k of orig) if (kinds.includes(k.kind)) ensure(k).onGcs = true;
  for (const k of cache) if (kinds.includes(k.kind)) ensure(k).onDisk = true;
  // Flag the candidate currently promoted to the display slot (recorded as the
  // display blob's fingerprint at promote time).
  const chosen = await chosenSourcePath(service, id, face);
  if (chosen && byPath.has(chosen)) byPath.get(chosen)!.chosen = true;
  return [...byPath.values()].sort((a, b) => (a.version < b.version ? 1 : -1));
}

/** The candidate keyPath currently promoted for a face, or null. */
export async function chosenSourcePath(service: AssetService, id: string, face: Face): Promise<string | null> {
  const rec = await service.head(displayKey(id, face));
  const fp = rec?.fingerprint ?? "";
  return fp.startsWith("chosen:") ? fp.slice("chosen:".length) : null;
}

/** Store a candidate on DISK ONLY (upload/generate). It is not durable until
 * {@link AssetService.save} pushes it to GCS. Returns its key. */
export async function addCandidate(
  service: AssetService,
  id: string,
  face: Face,
  provider: Provider,
  blob: AssetBlob,
  ext: string,
): Promise<AssetKey> {
  const key = candidateKey(id, face, provider, ext);
  await service.putLocal(key, blob);
  return key;
}

/** Copy a candidate's bytes onto the chosen slot for the given face. The
 * candidate may live under any kind (front/cover/spine); the promotion target
 * is the explicit `face`, never the candidate's own kind. The display slot is
 * always addressed as `.png` so the Obsidian/app URL never changes; the real
 * content-type rides along in the stored blob and is what the serve route
 * sends. */
export async function promote(service: AssetService, candidate: AssetKey, face: Face, dataDir?: string): Promise<AssetKey> {
  const blob = await service.render(candidate, new URLSearchParams());
  if (!blob) throw new Error(`candidate not found: ${candidate.entity}/${candidate.kind}/${candidate.source}/${candidate.variant}`);
  const dest = displayKey(candidate.entity, face);
  // Record the source candidate so the admin can badge the promoted version.
  await service.put(dest, { ...blob, fingerprint: `chosen:${keyPath(candidate)}` });
  // Cache-busting marker: the display URL is permanent (`.png`, signed, no
  // expiry), so promotions bump `<entity>/<face>` -> epoch-ms in displays.json.
  // The app embeds it as `&v=` to defeat browser/CDN caching (see views.tsx).
  if (dataDir) await notePromotion(dataDir, candidate.entity, face);
  return dest;
}

/** `<entity>/<face>` -> promotion epoch-ms, persisted so the public app (a
 * separate process on the same volume) can version display URLs. */
export type DisplayVersions = Record<string, number>;

const DISPLAYS_FILE = "displays.json";

async function readDisplays(dataDir: string): Promise<DisplayVersions> {
  try {
    return JSON.parse(await readFile(`${dataDir}/${DISPLAYS_FILE}`, "utf8")) as DisplayVersions;
  } catch {
    return {};
  }
}

/** Record a promotion epoch for a game+face. */
export async function notePromotion(dataDir: string, entity: string, face: Face): Promise<void> {
  const map = await readDisplays(dataDir);
  map[`${entity}/${face}`] = Date.now();
  await writeJsonAtomic(`${dataDir}/${DISPLAYS_FILE}`, map);
}

/** Promoted-version map with a small TTL cache — mirrors loadGames(): the file
 * only changes on promotion, so a stale window of seconds is fine. */
const TTL_MS = 30_000;
let displaysCache: { at: number; map: DisplayVersions } | null = null;

export async function displayVersions(dataDir: string): Promise<DisplayVersions> {
  if (displaysCache && Date.now() - displaysCache.at < TTL_MS) return displaysCache.map;
  const map = await readDisplays(dataDir);
  displaysCache = { at: Date.now(), map };
  return map;
}
