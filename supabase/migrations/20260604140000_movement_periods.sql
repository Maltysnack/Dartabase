-- Active period per movement, derived empirically from the dated works of the
-- artists tagged with that movement. p10..p90 of work years is the "active
-- span" (robust to a few outlier dates); median is the centre of mass. Powers
-- the movements timeline. Only movements with enough dated works to be
-- meaningful (>= 5) are returned.
create or replace function movement_periods()
returns table(movement text, works int, p10 int, median int, p90 int)
language sql
stable
as $$
  with m as (
    select unnest(ar.movements) as movement, a.date_year
    from artists ar
    join artworks a on a.artist_id = ar.id
    where ar.movements is not null and a.date_year is not null
  )
  select movement,
    count(*)::int as works,
    percentile_disc(0.1) within group (order by date_year)::int as p10,
    percentile_disc(0.5) within group (order by date_year)::int as median,
    percentile_disc(0.9) within group (order by date_year)::int as p90
  from m
  group by movement
  having count(*) >= 5
$$;
