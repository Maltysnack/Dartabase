-- RPC: exhibition_medium_buckets()
--
-- Returns medium buckets that appear in at least one exhibition,
-- sorted by exhibition count descending. Used to populate the
-- medium filter chips on the exhibitions browse page.

create or replace function public.exhibition_medium_buckets()
returns table(
  medium_bucket    text,
  exhibition_count bigint
)
language sql
stable
security definer
as $$
  select
    a.medium_bucket,
    count(distinct ea.exhibition_id) as exhibition_count
  from   artworks a
  join   exhibition_artworks ea on ea.artwork_id = a.id
  where  a.medium_bucket is not null
  group  by a.medium_bucket
  order  by exhibition_count desc, a.medium_bucket asc;
$$;
