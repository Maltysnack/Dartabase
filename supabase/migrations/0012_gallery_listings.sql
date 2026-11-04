-- gallery_listings: exhibition listings for the "Now" homepage section.
-- Populated by Artsy ingestion (source='artsy') and manual entry (source='manual').
-- Keyed on (source, source_id) so re-runs are idempotent.

create table public.gallery_listings (
  id                   uuid primary key default gen_random_uuid(),
  source               text not null default 'manual',
  source_id            text,
  gallery_name         text not null,
  exhibition_title     text not null,
  image_url            text,
  city                 text not null,
  country              text,
  start_date           date,
  end_date             date,
  link_url             text not null,
  discount_code        text,
  discount_description text,
  is_featured          boolean not null default false,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source, source_id)
);

-- listing_clicks: anonymised click events for gallery pitch analytics.
create table public.listing_clicks (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.gallery_listings(id) on delete cascade,
  city        text,
  clicked_at  timestamptz not null default now()
);

create index idx_gallery_listings_city_active
  on public.gallery_listings (city, is_active, end_date);
create index idx_listing_clicks_listing
  on public.listing_clicks (listing_id, clicked_at);

create function public.gallery_listings_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;
create trigger trg_gallery_listings_updated_at
  before update on public.gallery_listings
  for each row execute function public.gallery_listings_updated_at();

alter table public.gallery_listings enable row level security;
alter table public.listing_clicks enable row level security;

create policy "public read" on public.gallery_listings
  for select to anon, authenticated using (true);

grant select on public.gallery_listings to anon, authenticated;
grant insert on public.listing_clicks to anon, authenticated;
