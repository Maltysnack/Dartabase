-- Play one-game redesign: recurate the daily pool to recognizable works only.
--
-- The old pool flagged EVERY work by 27 famous artists, which surfaced the
-- museums' print-and-study holdings (portfolio plates, lithograph studies,
-- "untitled" sketches) far more often than the recognizable paintings. No
-- guess-the-artist game is fun when the answer is "Plate VII from The Ring of
-- Dawn Suite".
--
-- This resets game_eligible and flags a hand-curated, junk-free set of
-- recognizable works, capped per artist for daily variety. Curation is BY WORK,
-- not by medium: iconic prints are kept (Warhol screenprints, Munch woodcuts),
-- portfolio plates and studies are dropped. The list extends as more icons are
-- ingested. ICIP guard unchanged: cultural_notice = false and an image are
-- required here and re-asserted at query time.

UPDATE artworks SET game_eligible = false WHERE game_eligible = true;

WITH clean AS (
  SELECT a.id, a.artist_id, ar.name AS artist, a.title, lower(coalesce(a.medium, '')) AS med
  FROM artworks a
  JOIN artists ar ON a.artist_id = ar.id
  WHERE a.cultural_notice = false
    AND a.image_url IS NOT NULL
    AND length(a.title) <= 45
    AND a.title NOT ILIKE ALL (ARRAY[
      '%plate %', 'plate %', '%suite%', '%portfolio%', '%from the series%', '%from twelve%',
      '%lithograph%', '%study%', '%sketch%', '%untitled%', '%no title%', '%recto%', '%verso%',
      '%cancelled%', '%printing plate%', '%fragment%', '%sheet%', '%album%', '%variant%',
      '%no. %', '%vestnik%', '%folio%', '%origin%', '%compositional%'
    ])
),
keep AS (
  SELECT * FROM clean
  WHERE (
      med LIKE ANY (ARRAY['%oil%', '%canvas%', '%tempera%', '%acrylic%', '%panel%', '%board%', '%fabric%', '%linen%', '%on wood%'])
      AND artist = ANY (ARRAY[
        'Claude Monet', 'David Hockney', 'Edgar Degas', 'Paul Cezanne', 'Paul Cézanne',
        'Paul Gauguin', 'Pierre-Auguste Renoir', 'Henri Matisse', 'Vincent van Gogh', 'Grant Wood',
        'Georgia O''Keeffe', 'Piet Mondrian', 'James McNeill Whistler', 'James McNeill Whistler (1834-1903)'
      ])
    )
    OR (artist = 'Andy Warhol' AND med LIKE '%screenprint%')
    OR (artist = 'Edvard Munch' AND med LIKE '%woodcut%')
    OR (artist = 'Yayoi Kusama')
    OR (artist = 'Pablo Picasso' AND title IN ('Head of a Woman', 'Woman with a Helmet of Hair', 'Two Nudes, Standing'))
),
capped AS (
  SELECT id, row_number() OVER (PARTITION BY artist_id ORDER BY title) AS rn
  FROM keep
)
UPDATE artworks SET game_eligible = true
WHERE id IN (SELECT id FROM capped WHERE rn <= 6);
