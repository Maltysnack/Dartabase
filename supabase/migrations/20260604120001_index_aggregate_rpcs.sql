-- Server-side aggregation RPCs to replace full-table client-side pagination
-- in listInstitutionsWithCounts / listArtistsWithCounts / listArtworksByDecade.
-- Each previously paged through ~32k artwork rows over dozens of sequential
-- round trips; these do the grouping once in Postgres and return small results.

-- Artwork counts + image coverage per institution.
create or replace function institution_work_counts()
returns table(institution_id uuid, total int, imaged int)
language sql
stable
as $$
  select current_institution_id,
         count(*)::int as total,
         count(*) filter (where image_url is not null)::int as imaged
  from artworks
  where current_institution_id is not null
  group by current_institution_id
$$;

-- Artwork counts grouped by decade. Uses floor division to match the
-- decadeFromYear() helper (Math.floor(year / 10) * 10) for negative years.
create or replace function artwork_decade_counts()
returns table(decade int, n int)
language sql
stable
as $$
  select (floor(date_year / 10.0) * 10)::int as decade,
         count(*)::int as n
  from artworks
  where date_year is not null
  group by 1
  order by 1
$$;

-- Artwork counts + most common medium bucket per artist.
create or replace function artist_work_counts()
returns table(artist_id uuid, total int, primary_medium_bucket text)
language sql
stable
as $$
  with counts as (
    select artist_id, count(*)::int as total
    from artworks
    where artist_id is not null
    group by artist_id
  ),
  medium_ranked as (
    select distinct on (artist_id) artist_id, medium_bucket
    from (
      select artist_id, medium_bucket, count(*) as n
      from artworks
      where artist_id is not null and medium_bucket is not null
      group by artist_id, medium_bucket
    ) t
    order by artist_id, n desc, medium_bucket
  )
  select c.artist_id, c.total, m.medium_bucket
  from counts c
  left join medium_ranked m on m.artist_id = c.artist_id
$$;
