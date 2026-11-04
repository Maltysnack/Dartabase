-- Movement facet for /browse (#238, #275).
--
-- Adds p_movement to browse_artwork_ids, browse_artwork_count, and
-- browse_facets so users can filter works by the artist's movement
-- (e.g. "Impressionism", "Pop Art") and see how many works exist per movement.
--
-- Also drops the stale p_year_from/p_year_to overloads of these functions
-- (added by an earlier session for a year-range filter on /browse that was
-- superseded by the year filter on /search). This removes the ambiguous
-- overloads and leaves a single, canonical signature for each function.

-- Drop stale year-range overloads first.
drop function if exists public.browse_artwork_ids(int, uuid, boolean, text, int, int, int, int);
drop function if exists public.browse_artwork_count(int, uuid, boolean, text, int, int);
drop function if exists public.browse_facets(int, uuid, boolean, text, int, int);

-- ─── browse_artwork_ids ───────────────────────────────────────────────────────

create or replace function public.browse_artwork_ids(
  p_decade        int     default null,
  p_institution   uuid    default null,
  p_has_image     boolean default null,
  p_medium_bucket text    default null,
  p_nationality   text    default null,
  p_movement      text    default null,
  p_offset        int     default 0,
  p_limit         int     default 24
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
  where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
    and (p_institution is null or a.current_institution_id = p_institution)
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null
         or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
         or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
         or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
         or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
         or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
         or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
         or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
    )
    and (p_nationality is null or ar.nationality = p_nationality)
    and (p_movement is null or p_movement = any(ar.movements))
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.browse_artwork_ids(int, uuid, boolean, text, text, text, int, int)
  to anon, authenticated;


-- ─── browse_artwork_count ─────────────────────────────────────────────────────

create or replace function public.browse_artwork_count(
  p_decade        integer default null,
  p_institution   uuid    default null,
  p_has_image     boolean default null,
  p_medium_bucket text    default null,
  p_nationality   text    default null,
  p_movement      text    default null
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
  where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
    and (p_institution is null or a.current_institution_id = p_institution)
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null
         or (p_medium_bucket = 'Painting'    and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
         or (p_medium_bucket = 'Print'       and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
         or (p_medium_bucket = 'Drawing'     and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
         or (p_medium_bucket = 'Photography' and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
         or (p_medium_bucket = 'Sculpture'   and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
         or (p_medium_bucket = 'Ceramics'    and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
         or (p_medium_bucket = 'Textile'     and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
    )
    and (p_nationality is null or ar.nationality = p_nationality)
    and (p_movement is null or p_movement = any(ar.movements));
$$;

grant execute on function public.browse_artwork_count(integer, uuid, boolean, text, text, text)
  to anon, authenticated;


-- ─── browse_facets ────────────────────────────────────────────────────────────

create or replace function public.browse_facets(
  p_decade        int     default null,
  p_institution   uuid    default null,
  p_has_image     boolean default null,
  p_medium_bucket text    default null,
  p_nationality   text    default null,
  p_movement      text    default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  -- Shared WHERE macro as a lateral join would be ideal but SQL CTEs
  -- don't support that; each CTE applies the filters it needs with
  -- its own dimension excluded (so clicking an option shows live counts).
  decades as (
    select (a.date_year / 10) * 10 as decade, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null
           or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
           or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
           or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
           or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
           or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
           or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
           or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
      )
      and (p_nationality is null or ar.nationality = p_nationality)
      and (p_movement is null or p_movement = any(ar.movements))
      and a.date_year is not null
    group by 1
    order by 1 desc
  ),
  institutions as (
    select a.current_institution_id as id, i.name, count(*)::int as n
    from artworks a
    join institutions i on i.id = a.current_institution_id
    left join artists ar on ar.id = a.artist_id
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null
           or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
           or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
           or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
           or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
           or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
           or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
           or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
      )
      and (p_nationality is null or ar.nationality = p_nationality)
      and (p_movement is null or p_movement = any(ar.movements))
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
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_medium_bucket is null
           or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
           or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
           or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
           or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
           or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
           or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
           or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
      )
      and (p_nationality is null or ar.nationality = p_nationality)
      and (p_movement is null or p_movement = any(ar.movements))
  ),
  medium_counts as (
    select
      count(*) filter (where a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))::int as painting,
      count(*) filter (where a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))::int as print_n,
      count(*) filter (where a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))::int as drawing,
      count(*) filter (where a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))::int as photography,
      count(*) filter (where a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))::int as sculpture,
      count(*) filter (where a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))::int as ceramics,
      count(*) filter (where a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))::int as textile
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_nationality is null or ar.nationality = p_nationality)
      and (p_movement is null or p_movement = any(ar.movements))
  ),
  -- Nationality counts: all other filters applied, nationality dropped.
  nationalities as (
    select ar.nationality, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    where ar.nationality is not null
      and (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null
           or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
           or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
           or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
           or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
           or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
           or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
           or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
      )
      and (p_movement is null or p_movement = any(ar.movements))
    group by ar.nationality
    order by n desc, ar.nationality
    limit 30
  ),
  -- Movement counts: all other filters applied, movement dropped.
  movements as (
    select m.movement, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    cross join unnest(ar.movements) as m(movement)
    where array_length(ar.movements, 1) > 0
      and (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null
           or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
           or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
           or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
           or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
           or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
           or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
           or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
      )
      and (p_nationality is null or ar.nationality = p_nationality)
    group by m.movement
    order by n desc, m.movement
    limit 30
  ),
  total as (
    select count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null
           or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
           or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
           or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
           or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
           or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
           or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
           or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
      )
      and (p_nationality is null or ar.nationality = p_nationality)
      and (p_movement is null or p_movement = any(ar.movements))
  )
  select jsonb_build_object(
    'decades',       coalesce((select jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) from decades), '[]'::jsonb),
    'institutions',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'n', n)) from institutions), '[]'::jsonb),
    'nationalities', coalesce((select jsonb_agg(jsonb_build_object('nationality', nationality, 'n', n)) from nationalities), '[]'::jsonb),
    'movements',     coalesce((select jsonb_agg(jsonb_build_object('movement', movement, 'n', n)) from movements), '[]'::jsonb),
    'withImage',     (select with_image from image_counts),
    'withoutImage',  (select without_image from image_counts),
    'total',         (select n from total),
    'mediums', (
      select jsonb_build_array(
        jsonb_build_object('bucket', 'Painting',     'n', painting),
        jsonb_build_object('bucket', 'Print',        'n', print_n),
        jsonb_build_object('bucket', 'Drawing',      'n', drawing),
        jsonb_build_object('bucket', 'Photography',  'n', photography),
        jsonb_build_object('bucket', 'Sculpture',    'n', sculpture),
        jsonb_build_object('bucket', 'Ceramics',     'n', ceramics),
        jsonb_build_object('bucket', 'Textile',      'n', textile)
      )
      from medium_counts
    )
  );
$$;

grant execute on function public.browse_facets(int, uuid, boolean, text, text, text)
  to anon, authenticated;
