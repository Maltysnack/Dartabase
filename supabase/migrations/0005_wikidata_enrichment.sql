-- Wikidata enrichment columns on artists (issue #13).
--
-- image_url: portrait pulled from Wikidata P18 -> Wikimedia Commons.
-- movements: art movements from Wikidata P135, English labels.
-- gnd_id:    Deutsche Nationalbibliothek person identifier. Carried natively
--            by Städel records (encoded in source_id as "gnd:..."), promoted
--            into a column so cross-source artists can pick it up via the
--            dedup chain.

alter table artists
  add column if not exists image_url text,
  add column if not exists movements text[] default '{}'::text[] not null,
  add column if not exists gnd_id text;

-- One-time backfill from Städel rows that already encode the GND in source_id.
update artists
   set gnd_id = substring(source_id from 5)
 where source = 'staedel' and source_id like 'gnd:%';
