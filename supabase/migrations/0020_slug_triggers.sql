-- unaccent was enabled out-of-band on the cloud project; declare it so a
-- fresh database (local stack) can apply this migration.
create extension if not exists unaccent with schema extensions;

-- Auto-generate slugs for new artists and artworks on INSERT.
-- Fires BEFORE INSERT so the slug is set atomically with the row.
-- Skips rows where slug is already explicitly provided.
-- Collision strategy: appends -2, -3, ... until a free slot is found.

-- Strips accents, lowercases, collapses non-alnum runs to single dashes,
-- trims leading/trailing dashes, and truncates to max_len characters.
create or replace function auto_slug(input text, max_len integer default 80)
returns text
language sql
immutable
as $$
  select regexp_replace(
    substring(
      regexp_replace(
        regexp_replace(lower(unaccent(input)), '[^a-z0-9]+', '-', 'g'),
        '^-+|-+$', '', 'g'
      )
      from 1 for max_len
    ),
    '-+$', ''
  )
$$;

create or replace function unique_slug_artists(base text)
returns text
language plpgsql
as $$
declare
  candidate text := base;
  n integer := 2;
begin
  while exists (select 1 from public.artists where slug = candidate) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function unique_slug_artworks(base text)
returns text
language plpgsql
as $$
declare
  candidate text := base;
  n integer := 2;
begin
  while exists (select 1 from public.artworks where slug = candidate) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function trg_set_artist_slug()
returns trigger
language plpgsql
as $$
declare
  base text;
begin
  if new.slug is not null then
    return new;
  end if;
  base := auto_slug(coalesce(new.name, ''), 80);
  if base = '' then
    return new;
  end if;
  new.slug := unique_slug_artists(base);
  return new;
end;
$$;

create or replace function trg_set_artwork_slug()
returns trigger
language plpgsql
as $$
declare
  base text;
  title_part text;
  artist_part text;
  year_part text;
  artist_name text;
begin
  if new.slug is not null then
    return new;
  end if;

  title_part := regexp_replace(auto_slug(coalesce(new.title, ''), 60), '-+$', '');

  if new.artist_id is not null then
    select name into artist_name from public.artists where id = new.artist_id;
    if found and artist_name is not null then
      artist_part := regexp_replace(auto_slug(artist_name, 40), '-+$', '');
    end if;
  end if;

  if new.date_year is not null then
    year_part := new.date_year::text;
  end if;

  base := title_part;
  if artist_part is not null and artist_part <> '' then
    base := base || '-' || artist_part;
  end if;
  if year_part is not null then
    base := base || '-' || year_part;
  end if;

  base := regexp_replace(substring(base from 1 for 80), '-+$', '');

  if base = '' then
    return new;
  end if;

  new.slug := unique_slug_artworks(base);
  return new;
end;
$$;

create trigger artists_auto_slug
  before insert on public.artists
  for each row execute function trg_set_artist_slug();

create trigger artworks_auto_slug
  before insert on public.artworks
  for each row execute function trg_set_artwork_slug();
