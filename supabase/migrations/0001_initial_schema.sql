-- Dartabase initial schema
-- Public, read-only art reference database. Writes happen only via the
-- service role (ingestion); the anon role gets read-only access.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'museum' check (type in ('museum','gallery','other')),
  city text,
  country text,
  website text,
  wikidata_id text,
  source text not null,
  source_id text,
  source_url text,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);

create table public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_name text,
  also_known_as text[] not null default '{}',
  birth_year int,
  death_year int,
  nationality text,
  bio text,
  wikidata_id text,
  source text not null,
  source_id text,
  source_url text,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);

create table public.artworks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist_id uuid references public.artists(id) on delete set null,
  date_text text,
  date_year int,
  medium text,
  materials text[] not null default '{}',
  dimensions text,
  current_institution_id uuid references public.institutions(id) on delete set null,
  credit_line text,
  image_url text,
  image_license text,
  wikidata_id text,
  source text not null,
  source_id text,
  source_url text,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);

create table public.exhibitions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  institution_id uuid references public.institutions(id) on delete set null,
  start_date date,
  end_date date,
  description text,
  source text not null,
  source_id text,
  source_url text,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);

create table public.exhibition_artworks (
  exhibition_id uuid not null references public.exhibitions(id) on delete cascade,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  primary key (exhibition_id, artwork_id)
);

-- search_vector + updated_at maintenance triggers (one per table)
create function public.institutions_tsv() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.name,'') || ' ' || coalesce(new.city,'') || ' ' || coalesce(new.country,''));
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;
create trigger trg_institutions_tsv before insert or update on public.institutions
  for each row execute function public.institutions_tsv();

create function public.artists_tsv() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.name,'') || ' ' ||
    array_to_string(new.also_known_as, ' ') || ' ' ||
    coalesce(new.nationality,'') || ' ' ||
    coalesce(new.bio,''));
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;
create trigger trg_artists_tsv before insert or update on public.artists
  for each row execute function public.artists_tsv();

create function public.artworks_tsv() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.title,'') || ' ' || coalesce(new.medium,'') || ' ' || coalesce(new.date_text,''));
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;
create trigger trg_artworks_tsv before insert or update on public.artworks
  for each row execute function public.artworks_tsv();

create function public.exhibitions_tsv() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.title,'') || ' ' || coalesce(new.description,''));
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;
create trigger trg_exhibitions_tsv before insert or update on public.exhibitions
  for each row execute function public.exhibitions_tsv();

-- full-text search indexes
create index idx_institutions_search on public.institutions using gin (search_vector);
create index idx_artists_search on public.artists using gin (search_vector);
create index idx_artworks_search on public.artworks using gin (search_vector);
create index idx_exhibitions_search on public.exhibitions using gin (search_vector);

-- fuzzy name/title matching
create index idx_institutions_name_trgm on public.institutions using gin (name extensions.gin_trgm_ops);
create index idx_artists_name_trgm on public.artists using gin (name extensions.gin_trgm_ops);
create index idx_artworks_title_trgm on public.artworks using gin (title extensions.gin_trgm_ops);

-- foreign keys and sorting
create index idx_artworks_artist on public.artworks (artist_id);
create index idx_artworks_institution on public.artworks (current_institution_id);
create index idx_artworks_date_year on public.artworks (date_year);
create index idx_artists_sort_name on public.artists (sort_name);
create index idx_exhibitions_institution on public.exhibitions (institution_id);
create index idx_exhibitions_start_date on public.exhibitions (start_date);
create index idx_exhibition_artworks_artwork on public.exhibition_artworks (artwork_id);

-- row level security: public read-only
alter table public.institutions enable row level security;
alter table public.artists enable row level security;
alter table public.artworks enable row level security;
alter table public.exhibitions enable row level security;
alter table public.exhibition_artworks enable row level security;

create policy "public read" on public.institutions for select to anon, authenticated using (true);
create policy "public read" on public.artists for select to anon, authenticated using (true);
create policy "public read" on public.artworks for select to anon, authenticated using (true);
create policy "public read" on public.exhibitions for select to anon, authenticated using (true);
create policy "public read" on public.exhibition_artworks for select to anon, authenticated using (true);

grant select on public.institutions, public.artists, public.artworks, public.exhibitions, public.exhibition_artworks to anon, authenticated;
