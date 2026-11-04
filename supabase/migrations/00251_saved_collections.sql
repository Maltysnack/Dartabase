-- saved_collections: anonymous, server-side-persisted lightbox selections.
--
-- Researchers can save their current lightbox to a stable shareable URL
-- without logging in. Collections expire after 90 days.
--
-- Slug format: 7-char lowercase alphanumeric, e.g. "ax3bq9f"
-- Share URL: /collections/<slug>

create table public.saved_collections (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        not null unique,
  title       text,
  artwork_ids uuid[]      not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '90 days'),
  constraint  saved_collections_slug_format
    check (slug ~ '^[a-z0-9]{4,12}$'),
  constraint  saved_collections_artwork_ids_nonempty
    check (array_length(artwork_ids, 1) > 0)
);

create index idx_saved_collections_slug    on public.saved_collections (slug);
create index idx_saved_collections_expires on public.saved_collections (expires_at);

alter table public.saved_collections enable row level security;

-- Anyone can read a collection that has not expired.
create policy "public read" on public.saved_collections
  for select to anon, authenticated
  using (expires_at > now());

-- Anyone can create a collection; no auth required.
create policy "public insert" on public.saved_collections
  for insert to anon, authenticated
  with check (true);

grant select on public.saved_collections to anon, authenticated;
grant insert on public.saved_collections to anon, authenticated;
