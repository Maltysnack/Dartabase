-- Medium bucket facets for /browse (#67).
--
-- Adds a p_medium_bucket parameter to both browse RPCs. Seven buckets are
-- defined by ILIKE patterns directly in SQL; no vocabulary table is needed
-- since the patterns are stable and cover the main production medium strings.
--
-- Bucket definitions are intentionally exclusive: an artwork can match at most
-- one bucket in the UI (the first matching bucket wins when listing counts).
-- ILIKE ANY() is case-insensitive in Postgres, so "oil on canvas" and
-- "Oil on Canvas" and "Öl auf Leinwand" are all caught by the Painting patterns.

create or replace function public.browse_artwork_ids(
  p_decade int default null,
  p_institution uuid default null,
  p_has_image boolean default null,
  p_medium_bucket text default null,
  p_offset int default 0,
  p_limit int default 24
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id
  from artworks a
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
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.browse_artwork_ids(int, uuid, boolean, text, int, int)
  to anon, authenticated;

create or replace function public.browse_facets(
  p_decade int default null,
  p_institution uuid default null,
  p_has_image boolean default null,
  p_medium_bucket text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  -- Decade counts: institution + image + medium filters applied, decade dropped.
  decades as (
    select (a.date_year / 10) * 10 as decade, count(*)::int as n
    from artworks a
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
      and a.date_year is not null
    group by 1
    order by 1 desc
  ),
  -- Institution counts: decade + image + medium filters applied, institution dropped.
  institutions as (
    select a.current_institution_id as id, i.name, count(*)::int as n
    from artworks a
    join institutions i on i.id = a.current_institution_id
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
      and a.current_institution_id is not null
    group by a.current_institution_id, i.name
    order by n desc, i.name asc
    limit 25
  ),
  -- Image-presence counts: decade + institution + medium filters applied, image dropped.
  image_counts as (
    select
      count(*) filter (where a.image_url is not null)::int as with_image,
      count(*) filter (where a.image_url is null)::int as without_image
    from artworks a
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
  ),
  -- Medium bucket counts: decade + institution + image filters applied, medium dropped.
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
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
  ),
  -- Total matching the full filter set.
  total as (
    select count(*)::int as n
    from artworks a
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
  )
  select jsonb_build_object(
    'decades', coalesce((select jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) from decades), '[]'::jsonb),
    'institutions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'n', n)) from institutions), '[]'::jsonb),
    'withImage', (select with_image from image_counts),
    'withoutImage', (select without_image from image_counts),
    'total', (select n from total),
    'mediums', (
      select jsonb_build_array(
        jsonb_build_object('bucket', 'Painting',    'n', painting),
        jsonb_build_object('bucket', 'Print',       'n', print_n),
        jsonb_build_object('bucket', 'Drawing',     'n', drawing),
        jsonb_build_object('bucket', 'Photography', 'n', photography),
        jsonb_build_object('bucket', 'Sculpture',   'n', sculpture),
        jsonb_build_object('bucket', 'Ceramics',    'n', ceramics),
        jsonb_build_object('bucket', 'Textile',     'n', textile)
      )
      from medium_counts
    )
  );
$$;

grant execute on function public.browse_facets(int, uuid, boolean, text)
  to anon, authenticated;
