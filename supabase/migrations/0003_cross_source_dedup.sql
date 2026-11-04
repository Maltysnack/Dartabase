-- Cross-source deduplication (GitHub issue #2).
--
-- The same artist or institution arrives from several source APIs. Rather than
-- delete duplicate rows (which would break the idempotent (source, source_id)
-- upserts that ingestion relies on), each duplicate keeps its row and points at
-- the surviving canonical row via merged_into. A null merged_into means the row
-- is itself canonical. The dedup pass (scripts/dedup.ts) maintains this column;
-- the app reads only canonical rows.

alter table public.artists
  add column if not exists merged_into uuid references public.artists(id);

alter table public.institutions
  add column if not exists merged_into uuid references public.institutions(id);

comment on column public.artists.merged_into is
  'When set, this row is a cross-source duplicate folded into the referenced canonical artist. Null means canonical. Maintained by scripts/dedup.ts.';
comment on column public.institutions.merged_into is
  'When set, this row is a cross-source duplicate folded into the referenced canonical institution. Null means canonical. Maintained by scripts/dedup.ts.';

-- The app filters listings and search to canonical rows only; index that path.
create index if not exists idx_artists_canonical
  on public.artists (sort_name) where merged_into is null;
create index if not exists idx_institutions_canonical
  on public.institutions (name) where merged_into is null;
