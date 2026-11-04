-- Foreign-key covering indexes flagged by the Supabase performance advisor.
-- Speeds the merged_into pointer lookups (dedup folds + the canonical-artist
-- redirect in getArtist) and FK integrity checks. Partial because merged_into
-- is null for all but cross-source duplicate rows.
create index if not exists idx_artists_merged_into
  on public.artists (merged_into) where merged_into is not null;
create index if not exists idx_institutions_merged_into
  on public.institutions (merged_into) where merged_into is not null;
