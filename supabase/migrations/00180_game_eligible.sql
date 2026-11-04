-- Dartabase Play: flag the artworks eligible for the daily guessing game.
-- Curated to famous, recognisable works. The daily puzzle is chosen
-- deterministically from this pool (see src/lib/play.ts).
--
-- Eligibility (enforced again at query time in getEligiblePool):
--   game_eligible = true, cultural_notice = false, image_url present.
-- Culturally-flagged works are never used in the game (ICIP).

ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS game_eligible boolean NOT NULL DEFAULT false;

-- Partial index: the game only ever reads the eligible subset.
CREATE INDEX IF NOT EXISTS artworks_game_eligible_idx
  ON artworks (id)
  WHERE game_eligible = true;

-- Seed: flag works by a curated set of famous, recognisable artists that have
-- an image and no cultural notice. Matching is EXACT on artist name (not a
-- substring) so the pool can never accidentally include an Indigenous artist
-- through a coincidental substring collision (e.g. "Mir" matching both Miró
-- and Mirdidingkingathi). cultural_notice = false is a second guard. The
-- artist-name strings below were verified against the live table; extend the
-- list, or tighten to specific titles, over time.
UPDATE artworks a
SET game_eligible = true
FROM artists ar
WHERE a.artist_id = ar.id
  AND a.image_url IS NOT NULL
  AND a.cultural_notice = false
  AND ar.name = ANY (ARRAY[
    'David Hockney',
    'Edgar Degas',
    'Andy Warhol',
    'Joan Miró',
    'Pierre-Auguste Renoir',
    'James McNeill Whistler',
    'James McNeill Whistler (1834-1903)',
    'Gustav Klimt',
    'Paul Cezanne',
    'Claude Monet',
    'Pablo Picasso',
    'Paul Gauguin',
    'Edvard Munch',
    'Henri Matisse',
    'Vincent van Gogh',
    'Kazimir Malevich',
    'Vasily Kandinsky',
    'Piet Mondrian',
    'Marc Chagall',
    'Grant Wood',
    'Edward Hopper',
    'Salvador Dalí',
    'Jackson Pollock',
    'Georgia O''Keeffe',
    'Yayoi Kusama',
    'Katsushika Hokusai',
    'Katsushika Hokusai 葛飾北斎 (1760-1849)'
  ]);
