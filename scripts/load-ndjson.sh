#!/bin/sh
# Loads a backup made as newline-delimited JSON (supabase/dump/<table>.ndjson)
# into the local Supabase database, then rebuilds the search vectors.
#
#   pnpm db:start && pnpm db:load-ndjson
#
# Needs Docker running. Local database only.
set -e
CONTAINER="${DB_CONTAINER:-supabase_db_Dartabase}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/dump"

for t in institutions artists artworks exhibitions exhibition_artworks; do
  [ -f "$DIR/$t.ndjson" ] || { echo "skip $t (no file)"; continue; }
  docker cp "$DIR/$t.ndjson" "$CONTAINER:/tmp/$t.ndjson"
  docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<SQL
SET session_replication_role = replica;
CREATE TEMP TABLE raw(j jsonb);
\copy raw FROM '/tmp/$t.ndjson' CSV QUOTE E'\x01' DELIMITER E'\x02'
DO \$\$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='$t' AND is_generated='NEVER' AND column_name <> 'search_vector';
  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM raw r, jsonb_populate_record(NULL::public.%I, r.j) x ON CONFLICT DO NOTHING',
    '$t', cols, (SELECT string_agg('x.'||quote_ident(column_name), ',' ORDER BY ordinal_position)
      FROM information_schema.columns WHERE table_schema='public' AND table_name='$t' AND is_generated='NEVER' AND column_name <> 'search_vector'), '$t');
END \$\$;
SELECT '$t', count(*) FROM public.$t;
SQL
done

# Triggers are off during the load, so re-fire them to fill search_vector.
docker exec -i "$CONTAINER" psql -U postgres -c "update artists set name=name; update artworks set title=title;"
