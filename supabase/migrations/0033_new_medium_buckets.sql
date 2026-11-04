-- medium_bucket was added out-of-band on the cloud project; declare it so a
-- fresh database (local stack) can apply this migration.
alter table artworks add column if not exists medium_bucket text;

-- Add Video and Installation medium buckets (#456, #409).
--
-- Extends all three browse RPCs with two new p_medium_bucket values:
--   Video        -- matches: video, dvd, animation, moving image, motion picture
--   Installation -- matches: installation
--
-- Also backfills the medium_bucket column on existing records whose medium
-- currently has no bucket (IS NULL) but matches the new patterns.
-- The backfill runs Video first so "video installation" is filed under Video.

-- Backfill existing records.
update artworks
set medium_bucket = 'Video'
where medium_bucket is null
  and medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']);

update artworks
set medium_bucket = 'Installation'
where medium_bucket is null
  and medium ilike any(array['%installation%']);


-- Drop current signatures before replacing.
drop function if exists public.browse_artwork_ids(int, uuid, boolean, text, text[], text, text, boolean, int, int);
drop function if exists public.browse_artwork_count(integer, uuid, boolean, text, text[], text, text, boolean);
drop function if exists public.browse_facets(int, uuid, boolean, text, text[], text, text, boolean);


-- browse_artwork_ids ----------------------------------------------------------

create or replace function public.browse_artwork_ids(
  p_decade                int      default null,
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
         or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
         or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
    )
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null
         or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
         or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.browse_artwork_ids(int, uuid, boolean, text, text[], text, text, boolean, int, int)
  to anon, authenticated;


-- browse_artwork_count --------------------------------------------------------

create or replace function public.browse_artwork_count(
  p_decade                integer  default null,
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
         or (p_medium_bucket = 'Video'       and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
         or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
    )
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null
         or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
         or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)));
$$;

grant execute on function public.browse_artwork_count(integer, uuid, boolean, text, text[], text, text, boolean)
  to anon, authenticated;


-- browse_facets ---------------------------------------------------------------

create or replace function public.browse_facets(
  p_decade                int      default null,
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
      and (p_medium_bucket is null
           or (p_medium_bucket = 'Painting'     and a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
           or (p_medium_bucket = 'Print'        and a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
           or (p_medium_bucket = 'Drawing'      and a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
           or (p_medium_bucket = 'Photography'  and a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
           or (p_medium_bucket = 'Sculpture'    and a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
           or (p_medium_bucket = 'Ceramics'     and a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
           or (p_medium_bucket = 'Textile'      and a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
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
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
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
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
  ),
  exhibition_counts as (
    select
      count(*) filter (
        where exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)
      )::int as with_exhibition
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
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
  ),
  medium_counts as (
    select
      count(*) filter (where a.medium ilike any(array['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))::int as painting,
      count(*) filter (where a.medium ilike any(array['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))::int as print_n,
      count(*) filter (where a.medium ilike any(array['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))::int as drawing,
      count(*) filter (where a.medium ilike any(array['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))::int as photography,
      count(*) filter (where a.medium ilike any(array['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))::int as sculpture,
      count(*) filter (where a.medium ilike any(array['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))::int as ceramics,
      count(*) filter (where a.medium ilike any(array['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))::int as textile,
      count(*) filter (where a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))::int as video_n,
      count(*) filter (where a.medium ilike any(array['%installation%']))::int as installation_n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
  ),
  -- Nationalities deliberately omits p_nationalities from its own filter so the
  -- facet rail shows counts for all nationalities under the other active filters,
  -- not just the ones already selected (same pattern as Medium).
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
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
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
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
    group by m.movement
    order by n desc, m.movement
    limit 30
  ),
  cultural_attributions as (
    select a.cultural_attribution as attribution, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where a.cultural_attribution is not null
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
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
    group by a.cultural_attribution
    order by n desc, a.cultural_attribution
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
           or (p_medium_bucket = 'Video'        and a.medium ilike any(array['%video%','%dvd%','%animation%','%moving image%','%motion picture%']))
           or (p_medium_bucket = 'Installation' and a.medium ilike any(array['%installation%']))
      )
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
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

grant execute on function public.browse_facets(int, uuid, boolean, text, text[], text, text, boolean)
  to anon, authenticated;
