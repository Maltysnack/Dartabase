-- Add human-readable slug columns to artists and artworks.
-- Slugs are URL-safe identifiers (kebab-case, ASCII only) generated at
-- ingest time and immutable once set. The unique constraint prevents
-- collisions; the backfill script appends -2, -3, etc. for duplicates.
-- Nullable so existing rows are not blocked from insert before backfill.

alter table public.artists
  add column if not exists slug text unique;

alter table public.artworks
  add column if not exists slug text unique;

create index if not exists artists_slug_idx on public.artists (slug)
  where slug is not null;

create index if not exists artworks_slug_idx on public.artworks (slug)
  where slug is not null;
