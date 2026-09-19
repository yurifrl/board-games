/**
 * OpenRouter's image-gen model catalog for the studio, TTL-cached in memory.
 * The OpenRouter model list is the only source of truth for what the Generate
 * pane can call — the admin never hardcodes model ids.
 */

/** One OpenRouter model as the studio renders it. */
export type ImageModel = { id: string; name: string };

/** The public models endpoint, pre-filtered by OpenRouter to image-output models. */
const MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=image";

/** How long a good catalog fetch is reused. */
const MODELS_TTL_MS = 10 * 60 * 1000;

type RawModel = { id: string; name?: string; architecture?: { output_modalities?: string[] } };

let cache: { at: number; models: ImageModel[] } | null = null;

/** Image-output models from OpenRouter's catalog (newest catalog every ~10 min).
 * The server-side `output_modalities=image` filter is authoritative; the
 * client-side re-filter is defense in depth. Fetch failures degrade gracefully:
 * they are not cached, so the next call retries and page renders meanwhile fall
 * back to the last good list (or empty → default-model-only input). */
export async function openRouterImageModels(ttlMs = MODELS_TTL_MS): Promise<ImageModel[]> {
  if (cache && Date.now() - cache.at < ttlMs) return cache.models;
  try {
    const res = await fetch(MODELS_URL);
    if (!res.ok) throw new Error(`openrouter models ${res.status}`);
    const data = (await res.json()) as { data?: RawModel[] };
    const models = (data.data ?? []).filter(hasImageOutput).map(({ id, name }) => ({ id, name: name ?? id }));
    cache = { at: Date.now(), models };
    return models;
  } catch {
    return cache?.models ?? [];
  }
}

/** Test seam: drop the in-memory catalog cache. */
export function resetModelsCache(): void {
  cache = null;
}

/** Keep only models whose architecture declares image output. */
function hasImageOutput(m: RawModel): boolean {
  return typeof m.id === "string" && m.id.length > 0 && (m.architecture?.output_modalities ?? []).includes("image");
}
