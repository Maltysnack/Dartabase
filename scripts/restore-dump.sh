#!/bin/sh
# Downloads the published data snapshot and loads it into the local database, so
# you can add galleries on top of the existing sample instead of starting empty.
#
#   pnpm db:start && pnpm db:restore
#
# Needs Docker running and curl. The snapshot is a release asset on the repository.
set -e
REPO="${DARTABASE_REPO:-Maltysnack/Dartabase}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/dump"
mkdir -p "$DIR"
URL="https://github.com/$REPO/releases/download/data-snapshot/dartabase-data.tar.gz"
echo "downloading $URL"
curl -fL "$URL" -o "$DIR/dartabase-data.tar.gz" || {
  echo "curl failed (private repository?), trying the GitHub CLI"
  gh release download data-snapshot -R "$REPO" -p dartabase-data.tar.gz -D "$DIR" --clobber
}
tar -xzf "$DIR/dartabase-data.tar.gz" -C "$DIR"
rm "$DIR/dartabase-data.tar.gz"
sh "$(dirname "$0")/load-ndjson.sh"
