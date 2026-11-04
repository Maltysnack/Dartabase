#!/bin/sh
# Maintainer tool: writes the local database out as newline-delimited JSON and
# packs it for the "data-snapshot" release, which scripts/restore-dump.sh downloads.
#
#   pnpm db:dump-ndjson     (then upload dartabase-data.tar.gz to the release)
set -e
CONTAINER="${DB_CONTAINER:-supabase_db_Dartabase}"
DIR="supabase/dump"
mkdir -p "$DIR"
for t in institutions artists artworks; do
  docker exec -i "$CONTAINER" psql -U postgres -At -c "select row_to_json(t) from public.$t t" > "$DIR/$t.ndjson"
  echo "$t: $(wc -l < "$DIR/$t.ndjson") rows"
done
tar -czf dartabase-data.tar.gz -C "$DIR" institutions.ndjson artists.ndjson artworks.ndjson
ls -lh dartabase-data.tar.gz
