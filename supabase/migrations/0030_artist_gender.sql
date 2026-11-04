-- Add gender to the artists table (issue #463).
--
-- Stores the artist's gender as a short controlled-vocabulary string.
-- Populated from Wikidata P21 via scripts/backfill-gender.ts.
-- Values: 'female', 'male', 'non-binary'. NULL means unknown.

alter table public.artists
  add column if not exists gender text
    check (gender in ('female', 'male', 'non-binary'));

-- Index for filter queries (search page gender chip).
create index if not exists artists_gender_idx on public.artists (gender)
  where gender is not null;
