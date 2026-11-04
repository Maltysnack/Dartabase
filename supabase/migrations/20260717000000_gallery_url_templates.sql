-- gallery_url_templates: per-gallery URL pattern for constructing a specific
-- exhibition page link, instead of falling back to the gallery's homepage.
-- Populated by hand (see docs/superpowers/plans/2026-07-17-gallery-exhibition-url-resolution.md
-- Task 6) for the top galleries by listing count; galleries with no row here
-- simply keep using gallery_listings.link_url as scraped (the gallery
-- homepage). url_template contains the literal substring "{slug}" where a
-- slugified exhibition title is substituted at resolution time.

create table public.gallery_url_templates (
  id            uuid primary key default gen_random_uuid(),
  gallery_name  text not null unique,
  url_template  text not null,
  verified_at   timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create function public.gallery_url_templates_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;
create trigger trg_gallery_url_templates_updated_at
  before update on public.gallery_url_templates
  for each row execute function public.gallery_url_templates_updated_at();

-- Service-role only (ingestion scripts/cron): no anon/authenticated policy,
-- matching the api_keys table's pattern for internal-only tables.
alter table public.gallery_url_templates enable row level security;
