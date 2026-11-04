-- Add p_materials filter to browse_artwork_ids
CREATE OR REPLACE FUNCTION public.browse_artwork_ids(
  p_year_from         integer  DEFAULT NULL::integer,
  p_year_to           integer  DEFAULT NULL::integer,
  p_institution       uuid     DEFAULT NULL::uuid,
  p_institutions      uuid[]   DEFAULT NULL::uuid[],
  p_has_image         boolean  DEFAULT NULL::boolean,
  p_medium_bucket     text     DEFAULT NULL::text,
  p_medium_sub_bucket text     DEFAULT NULL::text,
  p_nationalities     text[]   DEFAULT NULL::text[],
  p_movement          text     DEFAULT NULL::text,
  p_cultural_attribution text  DEFAULT NULL::text,
  p_has_exhibition    boolean  DEFAULT NULL::boolean,
  p_offset            integer  DEFAULT 0,
  p_limit             integer  DEFAULT 24,
  p_materials         text[]   DEFAULT NULL::text[]
)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  select a.id
  from artworks a
  left join artists ar on ar.id = a.artist_id
  where (p_year_from is null or a.date_year >= p_year_from)
    and (p_year_to   is null or a.date_year <= p_year_to)
    and (
      (p_institution is null and p_institutions is null)
      or (p_institution is not null and a.current_institution_id = p_institution)
      or (p_institutions is not null and a.current_institution_id = any(p_institutions))
    )
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
    and (
      p_medium_sub_bucket is null or (
        (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
        (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
        (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
        (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
        (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
      )
    )
    and (p_materials is null or a.materials && p_materials)
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

-- Add p_materials filter + materials facet to browse_facets
CREATE OR REPLACE FUNCTION public.browse_facets(
  p_year_from         integer  DEFAULT NULL::integer,
  p_year_to           integer  DEFAULT NULL::integer,
  p_institution       uuid     DEFAULT NULL::uuid,
  p_institutions      uuid[]   DEFAULT NULL::uuid[],
  p_has_image         boolean  DEFAULT NULL::boolean,
  p_medium_bucket     text     DEFAULT NULL::text,
  p_medium_sub_bucket text     DEFAULT NULL::text,
  p_nationalities     text[]   DEFAULT NULL::text[],
  p_movement          text     DEFAULT NULL::text,
  p_cultural_attribution text  DEFAULT NULL::text,
  p_has_exhibition    boolean  DEFAULT NULL::boolean,
  p_materials         text[]   DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  with
  decades as (
    select (a.date_year / 10) * 10 as decade, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
      and a.date_year is not null
    group by 1
    order by 1 desc
  ),
  institutions as (
    -- Does NOT apply p_institution / p_institutions so users can add/remove institution filters
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
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
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
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
  ),
  exhibition_counts as (
    select count(*) filter (where a.has_exhibition)::int as with_exhibition
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
  ),
  medium_counts as (
    -- Does NOT apply p_medium_bucket or p_medium_sub_bucket so users can switch mediums
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
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (p_materials is null or a.materials && p_materials)
  ),
  nationalities as (
    select ar.nationality, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    where ar.nationality is not null
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
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
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
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
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
    group by a.cultural_attribution
    order by n desc, a.cultural_attribution
  ),
  total as (
    select count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
      and (p_materials is null or a.materials && p_materials)
  ),
  materials as (
    -- Does NOT apply p_materials so the user can see all available materials under current filters
    select mat, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    cross join unnest(a.materials) as mat
    where array_length(a.materials, 1) > 0
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (
        (p_institution is null and p_institutions is null)
        or (p_institution is not null and a.current_institution_id = p_institution)
        or (p_institutions is not null and a.current_institution_id = any(p_institutions))
      )
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
      and (
        p_medium_sub_bucket is null or (
          (p_medium_sub_bucket = 'Oil'        and lower(a.medium) like '%oil%') or
          (p_medium_sub_bucket = 'Watercolor' and (lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')) or
          (p_medium_sub_bucket = 'Gouache'    and lower(a.medium) like '%gouache%') or
          (p_medium_sub_bucket = 'Tempera'    and lower(a.medium) like '%tempera%') or
          (p_medium_sub_bucket = 'Acrylic'    and lower(a.medium) like '%acrylic%')
        )
      )
    group by mat
    order by n desc, mat
    limit 15
  )
  select jsonb_build_object(
    'decades',               coalesce((select jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) from decades), '[]'::jsonb),
    'institutions',          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'n', n)) from institutions), '[]'::jsonb),
    'nationalities',         coalesce((select jsonb_agg(jsonb_build_object('nationality', nationality, 'n', n)) from nationalities), '[]'::jsonb),
    'movements',             coalesce((select jsonb_agg(jsonb_build_object('movement', movement, 'n', n)) from movements), '[]'::jsonb),
    'cultural_attributions', coalesce((select jsonb_agg(jsonb_build_object('attribution', attribution, 'n', n)) from cultural_attributions), '[]'::jsonb),
    'materials',             coalesce((select jsonb_agg(jsonb_build_object('material', mat, 'n', n)) from materials), '[]'::jsonb),
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
    ),
    'paintingSubBuckets', case
      when p_medium_bucket = 'Painting' then (
        select jsonb_build_array(
          jsonb_build_object('subBucket', 'Oil',        'n', count(*) filter (where lower(a.medium) like '%oil%')::int),
          jsonb_build_object('subBucket', 'Watercolor', 'n', count(*) filter (where lower(a.medium) like '%watercolor%' or lower(a.medium) like '%watercolour%')::int),
          jsonb_build_object('subBucket', 'Gouache',    'n', count(*) filter (where lower(a.medium) like '%gouache%')::int),
          jsonb_build_object('subBucket', 'Tempera',    'n', count(*) filter (where lower(a.medium) like '%tempera%')::int),
          jsonb_build_object('subBucket', 'Acrylic',    'n', count(*) filter (where lower(a.medium) like '%acrylic%')::int)
        )
        from artworks a
        left join artists ar on ar.id = a.artist_id
        where a.medium_bucket = 'Painting'
          and (p_year_from is null or a.date_year >= p_year_from)
          and (p_year_to   is null or a.date_year <= p_year_to)
          and (
            (p_institution is null and p_institutions is null)
            or (p_institution is not null and a.current_institution_id = p_institution)
            or (p_institutions is not null and a.current_institution_id = any(p_institutions))
          )
          and (p_has_image is null
               or (p_has_image and a.image_url is not null)
               or (not p_has_image and a.image_url is null))
          and (p_nationalities is null or ar.nationality = any(p_nationalities))
          and (p_movement is null or p_movement = any(ar.movements))
          and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
          and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
          and (p_materials is null or a.materials && p_materials)
      )
      else '[]'::jsonb
    end
  );
$$;
