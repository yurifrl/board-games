/**
 * On-demand box-art generation for the admin. Builds the same prompt the batch
 * generator uses (house style + palette from the real cover + theme/description),
 * calls the image model, and stores the result as a DISK-ONLY candidate so it
 * shows up in the game's history and can be promoted / saved to GCS by hand.
 *
 * A caller may pass `promptOverride` (the admin's live-editable prompt) to bypass
 * the composed default entirely.
 */
import type { Face } from "../box-contract.ts";
import { aspectRatioFor, BOX_ART_FORMAT } from "../box-contract.ts";
import { openrouterImageGen, facePrompt, themeHint } from "./box-art.ts";
import { loadGlobalStyle } from "./prompt-store.ts";
import { palette as extractPalette } from "../tint.ts";
import type { AssetService } from "../service.ts";
import type { AssetKey } from "../key.ts";
import { candidateKey } from "../studio.ts";
import type { Game } from "../../games.ts";

/** The default composed prompt for a face — the same one the batch tool builds. */
export async function composePrompt(service: AssetService, game: Game, face: Face): Promise<string> {
  const source = game.bggId ? "bgg" : game.ludopediaId ? "ludopedia" : null;
  let palette: string[] = [];
  if (source) {
    const cover = await service.render(
      { entity: game.id, kind: "cover", source, variant: "original", ext: "jpg" },
      new URLSearchParams(),
    );
    if (cover) palette = await extractPalette(cover);
  }
  const theme = themeHint({
    id: game.id,
    name: game.name,
    categories: game.facts?.categories,
    mechanics: game.facts?.mechanics,
  });
  const style = await loadGlobalStyle();
  return facePrompt(face, game.name, {
    theme,
    description: game.description,
    artNote: game.boxArtDescription,
    palette,
    style,
  });
}

export interface GenerateOpts {
  /** OPENROUTER_API_KEY. */
  apiKey: string;
  /** An OpenRouter image-gen model id (e.g. from GET /gen/models). */
  model: string;
  promptOverride?: string;
}

/** Generate one face for a game and store it as a disk-only candidate. */
export async function generateFace(
  service: AssetService,
  game: Game,
  face: Face,
  opts: GenerateOpts,
): Promise<AssetKey> {
  const prompt = opts.promptOverride?.trim() || (await composePrompt(service, game, face));
  const ratio = aspectRatioFor(face, game.dimensions);
  const bytes = await openrouterImageGen(opts.apiKey, opts.model)(prompt, ratio);
  const key = candidateKey(game.id, face, "openrouter", BOX_ART_FORMAT);
  await service.putLocal(key, {
    bytes,
    contentType: `image/${BOX_ART_FORMAT}`,
    fingerprint: `gen:${key.variant}`,
  });
  return key;
}
