-- Add p_sort parameter to browse_artwork_ids (#548).
--
-- Supported values:
--   'date_desc'     (default) newest first
--   'date_asc'               oldest first
--   'most_exhibited'         has_exhibition=true first, then newest

CREATE OR REPLACE FUNCTION public.browse_artwork_ids(
  p_year_from            integer  DEFAULT NULL::integer,
  p_year_to              integer  DEFAULT NULL::integer,
  p_institution          uuid     DEFAULT NULL::uuid,
  p_institutions         uuid[]   DEFAULT NULL::uuid[],
  p_has_image            boolean  DEFAULT NULL::boolean,
  p_medium_bucket        text     DEFAULT NULL::text,
  p_medium_sub_bucket    text     DEFAULT NULL::text,
  p_nationalities        text[]   DEFAULT NULL::text[],
  p_movement             text     DEFAULT NULL::text,
  p_cultural_attribution text     DEFAULT NULL::text,
  p_has_exhibition       boolean  DEFAULT NULL::boolean,
  p_offset               integer  DEFAULT 0,
  p_limit                integer  DEFAULT 24,
  p_materials            text[]   DEFAULT NULL::text[],
  p_sort                 text     DEFAULT 'date_desc'
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
  order by
    -- most_exhibited: works with exhibition records first, then by date
    case when p_sort = 'most_exhibited' and a.has_exhibition then 0 else 1 end asc,
    -- date_asc: oldest first
    case when p_sort = 'date_asc' then a.date_year end asc nulls last,
    -- date_desc / most_exhibited fallback: newest first
    case when p_sort != 'date_asc' then a.date_year end desc nulls last,
    a.id
  offset p_offset
  limit p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.browse_artwork_ids(
  integer, integer, uuid, uuid[], boolean, text, text, text[], text, text, boolean, integer, integer, text[], text
) TO anon, authenticated;
