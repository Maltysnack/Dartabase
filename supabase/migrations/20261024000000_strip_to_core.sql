-- Strip to core: drop the tables and RPCs that only served features removed
-- from the app (gallery "On now" listings and click tracking, saved
-- collections, the daily game, the public API's rate limiting, and the
-- faceted /browse and /movements pages).
--
-- Safe on any database that has run the earlier migrations, local or cloud:
-- every drop is IF EXISTS, and nothing kept references these objects. Trigger
-- functions (slugs, search vectors, exhibition sync) are kept.

drop table if exists public.listing_clicks cascade;
drop table if exists public.gallery_listings cascade;
drop table if exists public.gallery_url_templates cascade;
drop table if exists public.saved_collections cascade;
drop table if exists public.play_stats cascade;
drop table if exists public.rate_limit_free cascade;
drop table if exists public.api_keys cascade;

drop materialized view if exists public.browse_facets_default_mv cascade;

-- Several of these have accumulated overloads across migrations, so drop every
-- signature by name rather than listing argument types.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'browse_artwork_count',
        'browse_artwork_exhibitions',
        'browse_artwork_ids',
        'browse_facets',
        'refresh_browse_facets_mv',
        'check_and_increment_api_key',
        'check_free_tier_usage',
        'gallery_listings_updated_at',
        'gallery_url_templates_updated_at',
        'record_play',
        'list_movements',
        'movement_artists',
        'movement_exhibition_decades',
        'movement_periods',
        'movement_top_institutions'
      )
  loop
    execute format('drop function if exists %s cascade', fn);
  end loop;
end
$$;
