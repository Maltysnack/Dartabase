-- Add human-readable slug column to institutions.
-- Uses the same auto_slug() and trigger pattern as artists/artworks (migration 0020).
-- Backfills all existing rows inline.

alter table public.institutions
  add column if not exists slug text unique;

create index if not exists institutions_slug_idx on public.institutions (slug)
  where slug is not null;

-- Uniqueness helper for institutions
create or replace function unique_slug_institutions(base text)
returns text
language plpgsql
as $$
declare
  candidate text := base;
  n integer := 2;
begin
  while exists (select 1 from public.institutions where slug = candidate) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;

-- Auto-generate slug on INSERT
create or replace function trg_set_institution_slug()
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
  new.slug := unique_slug_institutions(base);
  return new;
end;
$$;

drop trigger if exists institutions_auto_slug on public.institutions;
create trigger institutions_auto_slug
  before insert on public.institutions
  for each row execute function trg_set_institution_slug();

-- Backfill slugs for all existing institutions
do $$
declare
  r record;
  base_slug text;
begin
  for r in select id, name from public.institutions where slug is null order by name loop
    base_slug := auto_slug(coalesce(r.name, ''), 80);
    if base_slug <> '' then
      update public.institutions
      set slug = unique_slug_institutions(base_slug)
      where id = r.id;
    end if;
  end loop;
end;
$$;
