-- Play: widen the daily answer space (point #1, retention).
--
-- The first curation (20260608000000) flagged ~57 works across ~15 artists, so
-- a daily player could pattern-match the small set of possible answers within a
-- couple of weeks. This additively flags clean, recognizable painting works by
-- ~28 more canonical artists already in the database (Vermeer, Rembrandt,
-- Turner, Manet, Toulouse-Lautrec, Klee, Bacon, Goya, Botticelli, and others),
-- taking the pool to ~179 works across ~43 artists (~6 months before any
-- repeat).
--
-- Same rules as before: by-work curation (clean titles, painting media), capped
-- per artist for daily balance, ICIP guard intact (cultural_notice = false,
-- image required, re-asserted at query time). Artist matching strips
-- parenthetical life-date suffixes and includes accented/unaccented variants so
-- duplicate source records are all caught.

WITH clean AS (
  SELECT a.id, a.artist_id,
         regexp_replace(lower(ar.name), '\s*\(.*\)', '') AS aname,
         a.title, lower(coalesce(a.medium, '')) AS med
  FROM artworks a
  JOIN artists ar ON a.artist_id = ar.id
  WHERE a.cultural_notice = false
    AND a.image_url IS NOT NULL
    AND coalesce(a.game_eligible, false) = false
    AND length(a.title) <= 45
    AND a.title NOT ILIKE ALL (ARRAY[
      '%plate %', 'plate %', '%suite%', '%portfolio%', '%from the series%', '%from twelve%',
      '%lithograph%', '%study%', '%sketch%', '%untitled%', '%no title%', '%recto%', '%verso%',
      '%cancelled%', '%printing plate%', '%fragment%', '%sheet%', '%album%', '%variant%',
      '%no. %', '%folio%', '%origin%', '%panel (dress%'
    ])
    AND lower(coalesce(a.medium, '')) LIKE ANY (ARRAY[
      '%oil%', '%canvas%', '%tempera%', '%acrylic%', '%panel%', '%board%', '%fabric%', '%linen%', '%on wood%'
    ])
),
keep AS (
  SELECT * FROM clean WHERE aname = ANY (ARRAY[
    'paul klee', 'francis bacon', 'gustave courbet', 'rembrandt van rijn', 'gerhard richter', 'lucian freud',
    'eugène delacroix', 'eugene delacroix', 'thomas eakins', 'édouard manet', 'edouard manet', 'john constable',
    'joseph mallord william turner', 'titian', 'henri de toulouse-lautrec', 'francisco goya', 'francisco de goya',
    'john singer sargent', 'camille pissarro', 'édouard vuillard', 'edouard vuillard', 'el greco', 'sandro botticelli',
    'willem de kooning', 'winslow homer', 'albrecht dürer', 'albrecht durer', 'diego velázquez', 'diego velazquez',
    'georges braque', 'gustave caillebotte', 'johannes vermeer', 'juan gris', 'max ernst'
  ])
),
capped AS (
  SELECT id, row_number() OVER (PARTITION BY artist_id ORDER BY title) AS rn FROM keep
)
UPDATE artworks SET game_eligible = true WHERE id IN (SELECT id FROM capped WHERE rn <= 6);
