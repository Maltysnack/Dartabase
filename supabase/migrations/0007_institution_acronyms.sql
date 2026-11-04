-- Institution acronym search.
--
-- Users almost always reach for the acronym first ("MONA", "NGV", "AGNSW",
-- "MoMA") rather than typing the full institution name. Adds an `acronyms`
-- array plus a generated `search_blob` column so the existing ilike-based
-- search path picks acronyms up with zero query restructuring.
--
-- Storage shape:
--   acronyms     text[] not null, default '{}'. Display capitalisation
--                preserved ("MoMA", "QAGOMA"); the match is case-insensitive.
--   search_blob  generated, stored: name + acronyms joined by spaces.
--
-- Backfill is data-driven per known institution and runs idempotently.

alter table institutions
  add column if not exists acronyms text[] not null default '{}'::text[];

alter table institutions
  add column if not exists search_blob text;

-- Trigger keeps search_blob in sync. array_to_string is not immutable so
-- search_blob can't be a generated column; the trigger pattern matches the
-- search_vector trigger already on this table.
create or replace function institutions_set_search_blob() returns trigger
language plpgsql as $$
begin
  new.search_blob := new.name ||
    case
      when array_length(new.acronyms, 1) is null then ''
      else ' ' || array_to_string(new.acronyms, ' ')
    end;
  return new;
end$$;

drop trigger if exists institutions_search_blob_trg on institutions;
create trigger institutions_search_blob_trg
  before insert or update of name, acronyms on institutions
  for each row execute function institutions_set_search_blob();

-- One-time backfill of the existing rows.
update institutions
   set search_blob = name ||
     case
       when array_length(acronyms, 1) is null then ''
       else ' ' || array_to_string(acronyms, ' ')
     end
 where search_blob is null;

-- Trigram index on the search blob so ilike '%mona%' is fast even on
-- larger institution counts later.
create extension if not exists pg_trgm;
create index if not exists institutions_search_blob_trgm
  on institutions using gin (search_blob gin_trgm_ops);
