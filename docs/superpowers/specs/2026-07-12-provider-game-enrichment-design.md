# Provider Game Enrichment Design

## Goal

Enrich Obsidian games that have explicit BGG or Ludopedia IDs, expose each provider's complete returned data in game-detail tabs, and use normalized provider facts for collection filters.

## Data flow

Every worker cycle reads Obsidian first. For each explicit provider ID it loads `DATA_DIR/providers/<provider>/<id>.json`; a snapshot younger than 24 hours is reused, while a missing or stale snapshot is fetched. Because the provider ID is part of the cache path, changing an incorrect ID immediately fetches the replacement. A failed refresh retains a stale snapshot and never blocks catalog generation.

BGG uses the official XML API2 `thing` endpoint with statistics, versions, and videos. Ludopedia uses its authenticated game-detail endpoint. Full source payloads and fetch timestamps are attached to the corresponding catalog game for rendering. Filterable facts are normalized with BGG preferred and Ludopedia used as fallback.

## Catalog facts

Normalized facts include publication year, minimum/maximum players, play time, minimum age, complexity, rating, rank, type, mechanics, categories, designers, publishers, and language dependency. Obsidian-owned values remain authoritative where they already exist.

## UI

The detail hub retains Overview and Notes, and adds BGG, Ludopedia, and Files/Media when data exists. Provider tabs show normalized facts followed by the complete escaped provider payload. Files/Media lists provider-returned URLs; externally hosted video remains linked rather than downloaded.

The existing collection filter panel adds player count, complexity, rating, publication year, mechanics, provider categories, designers, publishers, and language dependency. Existing play-time and type filters use provider facts as fallback.

## Failure behavior and verification

Missing IDs perform no provider request. Missing credentials skip that provider. Provider errors preserve stale data when available and otherwise leave the provider tab absent. Tests cover fresh cache reuse, ID-driven cache misses, stale fallback, normalization, rendered tabs, and filter attributes.
