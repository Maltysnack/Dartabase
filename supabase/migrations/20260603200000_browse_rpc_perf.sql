-- Fix browse RPC statement timeout (issue #681).
--
-- Root cause: browse_facets runs 10 CTEs, each scanning all ~33k artworks with
-- (a) multi-pattern ilike any(array[...]) medium matching, and (b) a correlated
-- exists() subquery against exhibition_artworks, per row. Together these hit the
-- statement timeout on every page load.
--
-- Fix in two parts:
--
--   1. Add has_exhibition boolean to artworks. Eliminates the per-row correlated
--      subquery. A trigger keeps it current as exhibition_artworks rows are inserted
--      or deleted. After any bulk exhibition load, run:
--        UPDATE artworks a SET has_exhibition = EXISTS (
--          SELECT 1 FROM exhibition_artworks ea WHERE ea.artwork_id = a.id
--        );
--
--   2. Rewrite all three browse RPCs to use column equality (medium_bucket =
--      p_medium_bucket, has_exhibition = p_has_exhibition) instead of ilike
--      patterns and correlated subqueries. The medium_bucket column already exists,
--      is indexed, and is populated by the ingestion scripts -- the RPCs simply
--      never used it.

-- 1. has_exhibition column + index + maintenance trigger ----------------------

alter table public.artworks
  add column if not exists has_exhibition boolean not null default false;

update public.artworks a
set has_exhibition = true
where exists (
  select 1 from public.exhibition_artworks ea where ea.artwork_id = a.id
);

create index if not exists artworks_has_exhibition_idx
  on public.artworks (id)
  where has_exhibition = true;

create or replace function public.sync_artwork_has_exhibition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update artworks set has_exhibition = true where id = new.artwork_id;
  elsif tg_op = 'DELETE' then
    update artworks
    set has_exhibition = exists (
      select 1 from exhibition_artworks ea where ea.artwork_id = old.artwork_id
    )
    where id = old.artwork_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_exhibition_artworks_sync on public.exhibition_artworks;
create trigger trg_exhibition_artworks_sync
  after insert or delete on public.exhibition_artworks
  for each row execute function public.sync_artwork_has_exhibition();


-- 2. Drop current RPC signatures ---------------------------------------------

drop function if exists public.browse_artwork_ids(int, int, uuid, boolean, text, text[], text, text, boolean, int, int);
drop function if exists public.browse_artwork_count(integer, integer, uuid, boolean, text, text[], text, text, boolean);
drop function if exists public.browse_facets(int, int, uuid, boolean, text, text[], text, text, boolean);


-- 3. browse_artwork_ids ------------------------------------------------------

create or replace function public.browse_artwork_ids(
  p_year_from             int      default null,
  p_year_to               int      default null,
  p_institution           uuid     default null,
  p_has_image             boolean  default null,
  p_medium_bucket         text     default null,
  p_nationalities         text[]   default null,
  p_movement              text     default null,
  p_cultural_attribution  text     default null,
  p_has_exhibition        boolean  default null,
  p_offset                int      default 0,
  p_limit                 int      default 24
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id
  from artworks a
  left join artists ar on ar.id = a.artist_id
  where (p_year_from is null or a.date_year >= p_year_from)
    and (p_year_to   is null or a.date_year <= p_year_to)
    and (p_institution is null or a.current_institution_id = p_institution)
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.browse_artwork_ids(int, int, uuid, boolean, text, text[], text, text, boolean, int, int)
  to anon, authenticated;


-- 4. browse_artwork_count ----------------------------------------------------

create or replace function public.browse_artwork_count(
  p_year_from             integer  default null,
  p_year_to               integer  default null,
  p_institution           uuid     default null,
  p_has_image             boolean  default null,
  p_medium_bucket         text     default null,
  p_nationalities         text[]   default null,
  p_movement              text     default null,
  p_cultural_attribution  text     default null,
  p_has_exhibition        boolean  default null
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
  from artworks a
  left join artists ar on ar.id = a.artist_id
  where (p_year_from is null or a.date_year >= p_year_from)
    and (p_year_to   is null or a.date_year <= p_year_to)
    and (p_institution is null or a.current_institution_id = p_institution)
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition);
$$;

grant execute on function public.browse_artwork_count(integer, integer, uuid, boolean, text, text[], text, text, boolean)
  to anon, authenticated;


-- 5. browse_facets -----------------------------------------------------------
-- Each CTE uses column equality instead of ilike patterns.
-- medium_counts uses medium_bucket column directly.
-- exhibition_counts reads has_exhibition instead of running a correlated subquery.

create or replace function public.browse_facets(
  p_year_from             int      default null,
  p_year_to               int      default null,
  p_institution           uuid     default null,
  p_has_image             boolean  default null,
  p_medium_bucket         text     default null,
  p_nationalities         text[]   default null,
  p_movement              text     default null,
  p_cultural_attribution  text     default null,
  p_has_exhibition        boolean  default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  decades as (
    select (a.date_year / 10) * 10 as decade, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and a.date_year is not null
    group by 1
    order by 1 desc
  ),
  institutions as (
    select a.current_institution_id as id, i.name, count(*)::int as n
    from artworks a
    join institutions i on i.id = a.current_institution_id
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and a.current_institution_id is not null
    group by a.current_institution_id, i.name
    order by n desc, i.name asc
    limit 25
  ),
  image_counts as (
    select
      count(*) filter (where a.image_url is not null)::int as with_image,
      count(*) filter (where a.image_url is null)::int     as without_image
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  ),
  exhibition_counts as (
    select count(*) filter (where a.has_exhibition)::int as with_exhibition
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
  ),
  medium_counts as (
    select
      count(*) filter (where a.medium_bucket = 'Painting')::int     as painting,
      count(*) filter (where a.medium_bucket = 'Print')::int        as print_n,
      count(*) filter (where a.medium_bucket = 'Drawing')::int      as drawing,
      count(*) filter (where a.medium_bucket = 'Photography')::int  as photography,
      count(*) filter (where a.medium_bucket = 'Sculpture')::int    as sculpture,
      count(*) filter (where a.medium_bucket = 'Ceramics')::int     as ceramics,
      count(*) filter (where a.medium_bucket = 'Textile')::int      as textile,
      count(*) filter (where a.medium_bucket = 'Video')::int        as video_n,
      count(*) filter (where a.medium_bucket = 'Installation')::int as installation_n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  ),
  nationalities as (
    select ar.nationality, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    where ar.nationality is not null
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
    group by ar.nationality
    order by n desc, ar.nationality
    limit 30
  ),
  movements as (
    select m.movement, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    cross join unnest(ar.movements) as m(movement)
    where array_length(ar.movements, 1) > 0
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
    group by m.movement
    order by n desc, m.movement
    limit 30
  ),
  cultural_attributions as (
    select a.cultural_attribution as attribution, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where a.cultural_attribution is not null
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
    group by a.cultural_attribution
    order by n desc, a.cultural_attribution
  ),
  total as (
    select count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  )
  select jsonb_build_object(
    'decades',               coalesce((select jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) from decades), '[]'::jsonb),
    'institutions',          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'n', n)) from institutions), '[]'::jsonb),
    'nationalities',         coalesce((select jsonb_agg(jsonb_build_object('nationality', nationality, 'n', n)) from nationalities), '[]'::jsonb),
    'movements',             coalesce((select jsonb_agg(jsonb_build_object('movement', movement, 'n', n)) from movements), '[]'::jsonb),
    'cultural_attributions', coalesce((select jsonb_agg(jsonb_build_object('attribution', attribution, 'n', n)) from cultural_attributions), '[]'::jsonb),
    'withImage',             (select with_image from image_counts),
    'withoutImage',          (select without_image from image_counts),
    'withExhibition',        (select with_exhibition from exhibition_counts),
    'total',                 (select n from total),
    'mediums', (
      select jsonb_build_array(
        jsonb_build_object('bucket', 'Painting',      'n', painting),
        jsonb_build_object('bucket', 'Print',         'n', print_n),
        jsonb_build_object('bucket', 'Drawing',       'n', drawing),
        jsonb_build_object('bucket', 'Photography',   'n', photography),
        jsonb_build_object('bucket', 'Sculpture',     'n', sculpture),
        jsonb_build_object('bucket', 'Ceramics',      'n', ceramics),
        jsonb_build_object('bucket', 'Textile',       'n', textile),
        jsonb_build_object('bucket', 'Video',         'n', video_n),
        jsonb_build_object('bucket', 'Installation',  'n', installation_n)
      )
      from medium_counts
    )
  );
$$;

grant execute on function public.browse_facets(int, int, uuid, boolean, text, text[], text, text, boolean)
  to anon, authenticated;
