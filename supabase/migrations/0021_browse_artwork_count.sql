-- Companion to browse_artwork_ids: returns the total matching row count
-- for the same filter combination, without offset/limit.
-- Used by /api/v1/artworks to populate meta.total.

CREATE OR REPLACE FUNCTION public.browse_artwork_count(
  p_decade integer DEFAULT NULL,
  p_institution uuid DEFAULT NULL,
  p_has_image boolean DEFAULT NULL,
  p_medium_bucket text DEFAULT NULL
) RETURNS bigint
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)
  FROM artworks a
  WHERE (p_decade IS NULL OR (a.date_year >= p_decade AND a.date_year < p_decade + 10))
    AND (p_institution IS NULL OR a.current_institution_id = p_institution)
    AND (p_has_image IS NULL
         OR (p_has_image     AND a.image_url IS NOT NULL)
         OR (NOT p_has_image AND a.image_url IS NULL))
    AND (p_medium_bucket IS NULL
         OR (p_medium_bucket = 'Painting'    AND a.medium ILIKE ANY(ARRAY['%oil%','%watercolour%','%watercolor%','%gouache%','%tempera%','%polymer paint%','%öl auf%','%mischtechnik%','%acrylic%','%distemper%','%encaustic%']))
         OR (p_medium_bucket = 'Print'       AND a.medium ILIKE ANY(ARRAY['%etching%','%radering%','%engraving%','%kobberstik%','%lithograph%','%screenprint%','%woodcut%','%træsnit%','%linocut%','%aquatint%','%mezzotint%','%drypoint%','%intaglio%','%monotype%']))
         OR (p_medium_bucket = 'Drawing'     AND a.medium ILIKE ANY(ARRAY['%graphite%','%chalk%','%charcoal%','%pencil%','%crayon%','%pastel%','%ink on paper%','%brush and%']))
         OR (p_medium_bucket = 'Photography' AND a.medium ILIKE ANY(ARRAY['%photograph%','%gelatin silver%','%chromogenic%','%daguerreotype%','%albumen%','%cyanotype%','%palladium print%','%pigment print%','%silver print%']))
         OR (p_medium_bucket = 'Sculpture'   AND a.medium ILIKE ANY(ARRAY['%bronze%','%marble%','%ivory%','%granite%','%sandstone%','%limestone%','%alabaster%','%basalt%']))
         OR (p_medium_bucket = 'Ceramics'    AND a.medium ILIKE ANY(ARRAY['%earthenware%','%porcelain%','%stoneware%','%ceramic%','%faience%','%majolica%','%terracotta%']))
         OR (p_medium_bucket = 'Textile'     AND a.medium ILIKE ANY(ARRAY['%wool%','%silk%','%tapestry%','%weave%','%embroid%','%lace%','%cotton%','%linen%']))
    );
$$;
