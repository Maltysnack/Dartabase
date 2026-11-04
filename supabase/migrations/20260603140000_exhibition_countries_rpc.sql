-- RPC: exhibition_countries(p_limit integer)
--
-- Returns countries that host at least one institution with exhibitions,
-- sorted by exhibition count descending, then alphabetically. Used to
-- populate the country filter chips on the exhibitions browse page.
-- Server-side aggregation prevents the silent undercounting that would
-- occur if the count were done in JavaScript against a capped result set.

create or replace function public.exhibition_countries(p_limit integer default 20)
returns table(
  country          text,
  exhibition_count bigint
)
language sql
stable
security definer
as $$
  select
    i.country,
    count(distinct e.id) as exhibition_count
  from   exhibitions e
  join   institutions i on i.id = e.institution_id
  where  i.country is not null
  group  by i.country
  order  by exhibition_count desc, i.country asc
  limit  p_limit;
$$;
