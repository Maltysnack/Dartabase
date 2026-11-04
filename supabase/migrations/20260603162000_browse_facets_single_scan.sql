-- Rewrite browse_facets to scan artworks+artists exactly once by using
-- a MATERIALIZED base CTE. Previously the function ran 9 independent
-- full-table scans (one per facet CTE), each also probing exhibition_artworks
-- via a correlated EXISTS. Cold cache made this take 60-90s, consistently
-- exceeding the anon role statement timeout and crashing the browse page.
--
-- New approach:
-- 1. exhibiting_ids: join distinct artwork IDs from exhibition_artworks once
-- 2. base (MATERIALIZED): one scan of artworks + artists + exhibition status,
--    with per-row boolean columns for each filter dimension
-- 3. filtered (MATERIALIZED): base filtered by all active dimensions
-- 4. All facet CTEs (decades, institutions, mediums, etc.) read from the
--    in-memory base/filtered -- no additional disk I/O
--
-- Also adds Video and Installation to the mediums facet (they were missing
-- from the year_range migration that last rewrote browse_facets). (#681)

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
security definer
set search_path = public
set statement_timeout = 0
as $$
  with
  exhibiting_ids as (
    select distinct artwork_id from exhibition_artworks
  ),
  base as materialized (
    select
      a.date_year,
      a.current_institution_id,
      a.image_url,
      a.medium_bucket,
      a.cultural_attribution,
      ar.nationality,
      ar.movements,
      (ei.artwork_id is not null)                                             as has_exhibition,
      (p_year_from is null or a.date_year >= p_year_from)                    as m_yr_from,
      (p_year_to   is null or a.date_year <= p_year_to)                      as m_yr_to,
      (p_institution is null or a.current_institution_id = p_institution)    as m_inst,
      (p_has_image is null
       or (p_has_image     and a.image_url is not null)
       or (not p_has_image and a.image_url is null))                         as m_img,
      (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)         as m_med,
      (p_nationalities is null or ar.nationality = any(p_nationalities))     as m_nat,
      (p_movement is null or p_movement = any(ar.movements))                 as m_mov,
      (p_cultural_attribution is null
       or a.cultural_attribution = p_cultural_attribution)                   as m_cult,
      (p_has_exhibition is null
       or (p_has_exhibition     and ei.artwork_id is not null)
       or (not p_has_exhibition and ei.artwork_id is null))                  as m_exh
    from artworks a
    left join artists ar on ar.id = a.artist_id
    left join exhibiting_ids ei on ei.artwork_id = a.id
  ),
  filtered as materialized (
    select * from base
    where m_yr_from and m_yr_to and m_inst and m_img
      and m_med and m_nat and m_mov and m_cult and m_exh
  ),
  decades as (
    select (date_year / 10) * 10 as decade, count(*)::int as n
    from base
    where date_year is not null
      and m_inst and m_img and m_med and m_nat and m_mov and m_cult and m_exh
    group by 1
    order by 1 desc
  ),
  institutions_agg as (
    select current_institution_id, count(*)::int as n
    from base
    where current_institution_id is not null
      and m_yr_from and m_yr_to and m_img and m_med and m_nat and m_mov and m_cult and m_exh
    group by current_institution_id
    order by n desc
    limit 25
  ),
  medium_counts as (
    select medium_bucket as bucket, count(*)::int as n
    from base
    where medium_bucket is not null
      and m_yr_from and m_yr_to and m_inst and m_img and m_nat and m_mov and m_cult and m_exh
    group by medium_bucket
  ),
  nationalities as (
    select nationality, count(*)::int as n
    from base
    where nationality is not null
      and m_yr_from and m_yr_to and m_inst and m_img and m_med and m_mov and m_cult and m_exh
    group by nationality
    order by n desc
    limit 30
  ),
  movements as (
    select m.movement, count(*)::int as n
    from base
    cross join unnest(movements) as m(movement)
    where movements is not null and cardinality(movements) > 0
      and m_yr_from and m_yr_to and m_inst and m_img and m_med and m_nat and m_cult and m_exh
    group by m.movement
    order by n desc
    limit 30
  ),
  cultural_attributions as (
    select cultural_attribution as attribution, count(*)::int as n
    from base
    where cultural_attribution is not null
      and m_yr_from and m_yr_to and m_inst and m_img and m_med and m_nat and m_mov and m_exh
    group by cultural_attribution
    order by n desc
  )
  select jsonb_build_object(
    'decades',
      coalesce(
        (select jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) from decades),
        '[]'::jsonb
      ),
    'institutions',
      coalesce(
        (select jsonb_agg(jsonb_build_object('id', ia.current_institution_id, 'name', i.name, 'n', ia.n)
                 order by ia.n desc)
         from institutions_agg ia
         join institutions i on i.id = ia.current_institution_id),
        '[]'::jsonb
      ),
    'nationalities',
      coalesce(
        (select jsonb_agg(jsonb_build_object('nationality', nationality, 'n', n)) from nationalities),
        '[]'::jsonb
      ),
    'movements',
      coalesce(
        (select jsonb_agg(jsonb_build_object('movement', movement, 'n', n)) from movements),
        '[]'::jsonb
      ),
    'cultural_attributions',
      coalesce(
        (select jsonb_agg(jsonb_build_object('attribution', attribution, 'n', n)) from cultural_attributions),
        '[]'::jsonb
      ),
    'withImage',      (select count(*) filter (where image_url is not null)::int from filtered),
    'withoutImage',   (select count(*) filter (where image_url is null)::int from filtered),
    'withExhibition', (select count(*) filter (where has_exhibition)::int from filtered),
    'total',          (select count(*)::int from filtered),
    'mediums',
      coalesce(
        (select jsonb_agg(jsonb_build_object('bucket', bucket, 'n', n) order by n desc)
         from medium_counts),
        '[]'::jsonb
      )
  );
$$;

grant execute on function public.browse_facets(int, int, uuid, boolean, text, text[], text, text, boolean)
  to anon, authenticated;
