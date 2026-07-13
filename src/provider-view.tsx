/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { Game } from "./games.ts";
import { normalizeBgg, normalizeLudopedia, type ProviderFacts, type ProviderSnapshot } from "./worker/provider-data.ts";

type Provider = "bgg" | "ludopedia";
type Media = { title: string; url: string; thumbnail?: string; meta?: string };
type Edition = { title: string; image?: string; meta: string };

const decodeXml = (value: string): string => value
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
  .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

const xmlAttrs = (tag: string): Record<string, string> => Object.fromEntries(
  [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], decodeXml(match[2])]),
);
const xmlValue = (xml: string, tag: string): string | undefined => xmlAttrs(xml.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "").value;
const xmlText = (xml: string, tag: string): string | undefined => {
  const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1];
  return value ? decodeXml(value).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim() : undefined;
};
const safeUrl = (value?: string, base?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};
const youtubeId = (url: string): string | undefined => url.match(/(?:youtu\.be\/|[?&]v=)([\w-]{6,})/)?.[1];
const youtubeThumbnail = (url: string): string | undefined => {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
};
const dateLabel = (timestamp: number): string => new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(timestamp));

function bggLinks(xml: string, type: string): { id: string; name: string; inbound?: string }[] {
  return [...xml.matchAll(/<link\b[^>]*>/g)].flatMap((match) => {
    const link = xmlAttrs(match[0]);
    return link.type === type && link.value ? [{ id: link.id, name: link.value, inbound: link.inbound }] : [];
  });
}

function bggVideos(xml: string): Media[] {
  return [...xml.matchAll(/<video\b[^>]*>/g)].flatMap((match) => {
    const video = xmlAttrs(match[0]);
    const url = safeUrl(video.link);
    if (!url) return [];
    return [{
      title: video.title || "BGG video",
      url,
      thumbnail: youtubeThumbnail(url),
      meta: [video.category, video.language].filter(Boolean).join(" · "),
    }];
  });
}

function bggEditions(xml: string): Edition[] {
  const versions = xml.match(/<versions>([\s\S]*?)<\/versions>/)?.[1] ?? "";
  return [...versions.matchAll(/<item\b[^>]*type="boardgameversion"[^>]*>([\s\S]*?)<\/item>/g)].map((match) => {
    const body = match[1];
    const name = [...body.matchAll(/<name\b[^>]*>/g)].map((item) => xmlAttrs(item[0])).find((item) => item.type === "primary")?.value
      ?? xmlAttrs(body.match(/<name\b[^>]*>/)?.[0] ?? "").value
      ?? "Edition";
    const language = bggLinks(body, "language")[0]?.name;
    const publisher = bggLinks(body, "boardgamepublisher")[0]?.name;
    return {
      title: name,
      image: safeUrl(xmlText(body, "thumbnail") ?? xmlText(body, "image")),
      meta: [xmlValue(body, "yearpublished"), language, publisher].filter(Boolean).join(" · "),
    };
  });
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const nested = Object.values(object).flatMap(records);
  return Object.values(object).some((item) => typeof item !== "object" || item === null) ? [object, ...nested] : nested;
}

const field = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
};
const absoluteLudopedia = (url?: string): string | undefined => safeUrl(url, "https://ludopedia.com.br/");

function ludopediaMedia(value: unknown, kind: "video" | "image" | "file"): Media[] {
  const urls = kind === "image" ? ["imagem", "image", "url_imagem", "link", "url", "thumb"] : ["link", "url", "arquivo", "download"];
  return records(value).flatMap((record) => {
    const url = absoluteLudopedia(field(record, urls));
    if (!url) return [];
    const title = field(record, ["titulo", "title", "nm_video", "nm_imagem", "nm_arquivo", "nome", "descricao"]) ?? (kind === "file" ? "Download" : kind === "video" ? "Video" : "Image");
    const thumb = absoluteLudopedia(field(record, ["thumb", "thumbnail", "imagem", "url_imagem"]));
    return [{ title, url, thumbnail: kind === "video" ? thumb ?? youtubeThumbnail(url) : thumb ?? (kind === "image" ? url : undefined), meta: field(record, ["categoria", "idioma", "usuario", "autor"]) }];
  });
}

const FactStrip: FC<{ facts: ProviderFacts }> = ({ facts }) => {
  const values = [
    ["Players", facts.minPlayers && facts.maxPlayers ? `${facts.minPlayers}–${facts.maxPlayers}` : facts.minPlayers ?? facts.maxPlayers],
    ["Time", facts.playTime ? `${facts.playTime} min` : undefined],
    ["Age", facts.minAge ? `${facts.minAge}+` : undefined],
    ["Complexity", facts.complexity ? `${facts.complexity.toFixed(2)} / 5` : undefined],
  ].filter(([, value]) => value !== undefined);
  return <div class="provider-fact-strip">{values.map(([label, value]) => <div><span>{label}</span><strong>{value}</strong></div>)}</div>;
};

const Score: FC<{ facts: ProviderFacts }> = ({ facts }) => facts.rating || facts.rank ? (
  <div class="provider-score">
    {facts.rating ? <div><strong>{facts.rating.toFixed(1)}</strong><span>rating</span></div> : null}
    {facts.rank ? <div><strong>#{facts.rank}</strong><span>BGG rank</span></div> : null}
  </div>
) : null;

const Chips: FC<{ title: string; values: string[] }> = ({ title, values }) => values.length ? (
  <section class="provider-section"><h3>{title}</h3><div class="provider-chips">{values.map((value) => <span>{value}</span>)}</div></section>
) : null;

const VIDEO_PAGE_SIZE = 6;
const VideoGrid: FC<{ videos: Media[] }> = ({ videos }) => videos.length ? (
  <section class="provider-section" data-video-section=""><h3>Videos</h3><div class="provider-video-grid">{videos.map((video, index) => (
    <a class={`provider-video-card${index >= VIDEO_PAGE_SIZE ? " provider-video-extra" : ""}`} data-video-extra={index >= VIDEO_PAGE_SIZE ? "" : undefined} hidden={index >= VIDEO_PAGE_SIZE} href={video.url} target="_blank" rel="noopener">
      <div class="provider-video-image">{video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" /> : <span>▶</span>}<i>▶</i></div>
      <strong>{video.title}</strong>{video.meta ? <small>{video.meta}</small> : null}
    </a>
  ))}</div>{videos.length > VIDEO_PAGE_SIZE ? <button class="provider-video-more" data-video-more="" type="button" aria-expanded="false">Load {Math.min(VIDEO_PAGE_SIZE, videos.length - VIDEO_PAGE_SIZE)} more</button> : null}</section>
) : null;

const ImageGrid: FC<{ title: string; images: Media[] }> = ({ title, images }) => images.length ? (
  <section class="provider-section"><h3>{title}</h3><div class="provider-image-grid">{images.map((image) => (
    <a href={image.url} target="_blank" rel="noopener"><img src={image.thumbnail ?? image.url} alt={image.title} loading="lazy" /><span>{image.title}</span></a>
  ))}</div></section>
) : null;

const FileList: FC<{ files: Media[] }> = ({ files }) => files.length ? (
  <section class="provider-section"><h3>Files</h3><div class="provider-file-list">{files.map((file) => <a href={file.url} target="_blank" rel="noopener"><span>⇩</span><strong>{file.title}</strong></a>)}</div></section>
) : null;

const SourceHeader: FC<{ provider: Provider; id: string; snapshot?: ProviderSnapshot; title?: string; image?: string; facts: ProviderFacts }> = ({ provider, id, snapshot, title, image, facts }) => {
  const isBgg = provider === "bgg";
  const href = isBgg ? `https://boardgamegeek.com/boardgame/${id}` : `https://ludopedia.com.br/jogo/${id}`;
  return (
    <header class="provider-header">
      {image ? <img src={image} alt="" loading="lazy" /> : null}
      <div class="provider-header-main"><span class={`provider-mark ${provider}`}>{isBgg ? "BGG" : "LUDOPEDIA"}</span><h2>{title ?? (isBgg ? "BoardGameGeek" : "Ludopedia")}</h2>{facts.year ? <p>{facts.year}</p> : null}</div>
      <Score facts={facts} />
      <a class="provider-open" href={href} target="_blank" rel="noopener">Open ↗</a>
      {snapshot ? <small class="provider-freshness">Updated {dateLabel(snapshot.fetchedAt)}</small> : null}
    </header>
  );
};

const EmptyProvider: FC<{ provider: Provider; id: string }> = ({ provider, id }) => {
  const facts = { mechanics: [], categories: [], designers: [], publishers: [] };
  return <><SourceHeader provider={provider} id={id} facts={facts} /><div class="provider-empty"><strong>Provider data has not been fetched yet.</strong><span>Run the worker with this provider's API token configured.</span></div></>;
};

const BggPane: FC<{ id: string; snapshot?: ProviderSnapshot }> = ({ id, snapshot }) => {
  if (!snapshot) return <EmptyProvider provider="bgg" id={id} />;
  const xml = String(snapshot.data);
  const facts = normalizeBgg(xml);
  const title = [...xml.matchAll(/<name\b[^>]*>/g)].map((match) => xmlAttrs(match[0])).find((name) => name.type === "primary")?.value;
  const description = xmlText(xml, "description");
  const image = safeUrl(xmlText(xml, "thumbnail") ?? xmlText(xml, "image"));
  const videos = bggVideos(xml);
  const editions = bggEditions(xml);
  const images: Media[] = [];
  if (image) images.push({ title: title ?? "Game image", url: safeUrl(xmlText(xml, "image")) ?? image, thumbnail: image });
  for (const edition of editions) if (edition.image) images.push({ title: edition.title, url: edition.image, thumbnail: edition.image, meta: edition.meta });
  const designers = bggLinks(xml, "boardgamedesigner").map((link) => link.name);
  const artists = bggLinks(xml, "boardgameartist").map((link) => link.name);
  const publishers = bggLinks(xml, "boardgamepublisher").map((link) => link.name);
  const related = bggLinks(xml, "boardgameexpansion");
  return <>
    <SourceHeader provider="bgg" id={id} snapshot={snapshot} title={title} image={image} facts={facts} />
    <FactStrip facts={facts} />
    {description ? <section class="provider-section provider-about"><h3>About</h3><p>{description}</p></section> : null}
    <section class="provider-columns">
      <Chips title="Mechanics" values={facts.mechanics} /><Chips title="Categories" values={facts.categories} />
      <Chips title="Designers" values={designers} /><Chips title="Artists" values={artists} /><Chips title="Publishers" values={publishers} />
    </section>
    <VideoGrid videos={videos} />
    <ImageGrid title="Images & editions" images={images} />
    {editions.length ? <section class="provider-section"><h3>Editions</h3><div class="provider-editions">{editions.map((edition) => <article>{edition.image ? <img src={edition.image} alt="" loading="lazy" /> : null}<div><strong>{edition.title}</strong><small>{edition.meta}</small></div></article>)}</div></section> : null}
    {related.length ? <section class="provider-section"><h3>Related games</h3><div class="provider-related">{related.map((item) => <a href={`https://boardgamegeek.com/boardgame/${item.id}`} target="_blank" rel="noopener"><strong>{item.name}</strong><small>{item.inbound === "true" ? "Expansion for this game" : "Expansion"}</small></a>)}</div></section> : null}
    <section class="provider-section"><h3>More on BGG</h3><div class="provider-actions"><a href={`https://boardgamegeek.com/boardgame/${id}/-/images`} target="_blank" rel="noopener">Image gallery ↗</a><a href={`https://boardgamegeek.com/boardgame/${id}/-/videos/all`} target="_blank" rel="noopener">All videos ↗</a><a href={`https://boardgamegeek.com/boardgame/${id}/-/files`} target="_blank" rel="noopener">Community files ↗</a></div></section>
  </>;
};

const LudopediaPane: FC<{ id: string; snapshot?: ProviderSnapshot }> = ({ id, snapshot }) => {
  if (!snapshot) return <EmptyProvider provider="ludopedia" id={id} />;
  const data = snapshot.data as Record<string, unknown>;
  const detail = (data.detail as Record<string, unknown> | undefined) ?? data;
  const facts = normalizeLudopedia(data);
  const title = field(detail, ["nm_jogo", "nome", "title"]);
  const description = field(detail, ["descricao", "ds_jogo", "description"]);
  const image = absoluteLudopedia(field(detail, ["imagem", "image", "thumb", "url_imagem"]));
  const videos = ludopediaMedia(data.videos, "video");
  const images = ludopediaMedia(data.images, "image");
  const files = ludopediaMedia(data.files, "file");
  return <>
    <SourceHeader provider="ludopedia" id={id} snapshot={snapshot} title={title} image={image} facts={facts} />
    <FactStrip facts={facts} />
    {description ? <section class="provider-section provider-about"><h3>Sobre</h3><p>{description}</p></section> : null}
    <section class="provider-columns"><Chips title="Mecânicas" values={facts.mechanics} /><Chips title="Categorias" values={facts.categories} /><Chips title="Designers" values={facts.designers} /><Chips title="Editoras" values={facts.publishers} /></section>
    <VideoGrid videos={videos} />
    <ImageGrid title="Images" images={images} />
    <FileList files={files} />
    <section class="provider-section"><div class="provider-actions"><a href={`https://ludopedia.com.br/jogo/${id}`} target="_blank" rel="noopener">Open on Ludopedia ↗</a></div></section>
  </>;
};

export const ProviderPane: FC<{ game: Game; provider: Provider }> = ({ game, provider }) => {
  const id = provider === "bgg" ? game.bggId : game.ludopediaId;
  const snapshot = game.providerData?.[provider];
  if (!id && !snapshot) return null;
  return <section id={`panel-${game.id}-${provider}`} class="pane provider-pane" data-p={provider} role="tabpanel" aria-labelledby={`tab-${game.id}-${provider}`}>{provider === "bgg" ? <BggPane id={id ?? snapshot!.id} snapshot={snapshot} /> : <LudopediaPane id={id ?? snapshot!.id} snapshot={snapshot} />}</section>;
};
