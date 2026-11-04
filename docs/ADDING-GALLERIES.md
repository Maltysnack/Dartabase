# Adding or expanding galleries

The published site is a fixed sample: a static set of JSON files in `public/data`.
A static site cannot download more records on demand, so growing a collection is
done on your own machine, and then you rebuild and redeploy. This guide explains
how.

## The idea

```
ingest script  ->  local Postgres  ->  dedup, flag  ->  export  ->  public/data  ->  build
```

Every gallery has one ingestion script. Each pulls from the museum's own open-data
feed (or from Wikidata) and writes into a local database. `pnpm export` then writes
the whole database out as the static files the site reads.

## One-time setup

You need Node 20+, pnpm and Docker (on macOS, Colima: `colima start`).

```bash
pnpm install
pnpm db:start        # local Postgres in Docker, schema applied
pnpm db:env          # writes .env.local pointing at it
```

The local database starts empty. To keep the existing sample, restore it first
(see "Restoring the current sample" below), then add to it. Skipping that step
works too: the export will then contain only what you ingest.

## Expanding one gallery

1. Pick the script from the tables below.
2. Always preview first, with a limit:

   ```bash
   pnpm ingest:met -- --dry-run --limit 50
   ```

3. Run it for real, bounded:

   ```bash
   pnpm ingest:met -- --limit 5000
   ```

4. Fold duplicates, flag First Nations material, export and build:

   ```bash
   pnpm dedup
   pnpm flag:icip -- --apply
   pnpm export
   pnpm build
   ```

5. Commit `public/data` and push. The Pages workflow publishes it.

Every ingestion script requires `--limit`. Never run an unbounded pull.

## How much room there is

The site costs about 1.8 KB per work in `public/data`. GitHub Pages allows 1 GB, and
the export and the deploy both stop at 900 MB. That is roughly 500,000 works in
total, about 370,000 more than today. The big feeds are larger than that (the Met
alone has around 490,000 open-access objects, the Rijksmuseum around 800,000, mostly
prints), so choose what you add: works with an image and a named artist are the most
useful. `pnpm export` prints the size and fails if you are over budget.

## Direct feeds

| Command | Gallery | Access | Notes |
|---|---|---|---|
| `ingest:met` | The Metropolitan Museum of Art | Public API | CC0. Public-domain works with images. |
| `ingest:aic` | Art Institute of Chicago | Public API | CC0 metadata. Only public-domain images are shown. |
| `ingest:cleveland` | Cleveland Museum of Art | Open Access API | CC0. |
| `ingest:nga` | National Gallery of Art, Washington | CSV dump on GitHub | CC0. |
| `ingest:moma` | Museum of Modern Art | CSV dump on GitHub | CC0 metadata. MoMA's images are not openly licensed, so no image is shown. |
| `ingest:tate` | Tate | CSV dump on GitHub | CC0 metadata. Tate's images are not openly licensed, so no image is shown. |
| `ingest:whitney` | Whitney Museum | CSV dump on GitHub | CC0, metadata only. |
| `ingest:mia` | Minneapolis Institute of Art | JSON on GitHub | CC0. |
| `ingest:walters` | Walters Art Museum | CSV dump on GitHub | CC0. |
| `ingest:smk` | SMK, National Gallery of Denmark | Public API | CC0. |
| `ingest:staedel` | Städel Museum | OAI-PMH | CC0 / Public Domain Mark. |
| `ingest:smithsonian` | Smithsonian art museums | API, free key (`SMITHSONIAN_API_KEY`) | CC0. |
| `ingest:harvard` | Harvard Art Museums | API, free key (`HARVARD_API_KEY`) | Only Harvard-cleared images are shown. |
| `ingest:rijks` | Rijksmuseum | API, free key | CC0 metadata. Very large. |
| `ingest:vam` | Victoria and Albert Museum | Public API | |
| `ingest:europeana` | Europeana | API, free key | Aggregator; rights vary per record. |
| `ingest:nmk` | Nasjonalmuseet, Norway | DigitaltMuseum API | CC BY-NC images (non-commercial). |
| `ingest:ateneum`, `ingest:kiasma`, `ingest:sinebrychoff`, `ingest:serlachius`, `ingest:gallenkallela` | Finnish museums | Finna API | Per-record image licence. |
| `ingest:ntmofa`, `ingest:kmfa` | Taiwanese museums | collections.culture.tw | CC BY 4.0, metadata only. |
| `ingest:joconde`, `ingest:tomuco` | French national collections, Tokyo museums | Open-data downloads | Metadata only. |
| `ingest:qagoma` | QAGOMA, Brisbane | Queensland open-data CSV | Metadata only. Flags First Nations records by department. |

A free key goes in `.env.local`. The script's header comment says where to register.

## Wikidata collections

Many museums have no usable API but are well catalogued on Wikidata, with Commons
images for public-domain works. These share one script, `ingest-wikidata-art.ts`, with
one entry per museum:

```bash
pnpm ingest:uffizi -- --dry-run --limit 100
```

Available: `uffizi`, `nationalmuseum-se`, `ng-london`, `prado`, `fitzwilliam`,
`scottish-national-gallery`, `petit-palais`, `npm-taipei`, `hermitage`, `belvedere`,
`mauritshuis`, `wallace-collection`, `frick`, `thyssen`, `kunsthistorisches`,
`gemaeldegalerie-berlin`, `hamburger-kunsthalle`, `boijmans`, `brera`,
`alte-nationalgalerie`, `masp`, `bellas-artes-buenos-aires`, `capodimonte`,
`npg-london`, `getty`, `lenbachhaus`, `van-gogh-museum`, `frans-hals-museum`,
`accademia-florence`, `kroller-muller`, `national-museum-warsaw`, `orsay`,
`kunsthaus-zurich`, `kunstmuseum-basel`, `ng-prague`, `albertina`,
`bavarian-state-paintings`.

### Australian galleries

NGV, the Art Gallery of NSW, the National Gallery of Australia, the Art Gallery of South
Australia and the Art Gallery of Western Australia publish no open collection feed that
was found, so they come from Wikidata as metadata only (no image is ever stored):

```bash
pnpm ingest:ngv -- --limit 7000
pnpm ingest:agnsw -- --limit 7000
pnpm ingest:nga-au -- --limit 7000
pnpm ingest:agsa -- --limit 7000
pnpm ingest:agwa -- --limit 100
```

These run with `--metadata-only --require-artist`, so a work appears only if Wikidata
names its artist. If a gallery later publishes an open dataset, a direct adapter would
give better data.

### Adding a museum that is not listed

1. Find its Wikidata item (the museum's own QID).
2. Check how many works it holds, and how many have images:

   ```sparql
   SELECT (COUNT(DISTINCT ?w) AS ?works) (COUNT(DISTINCT ?i) AS ?images) WHERE {
     ?w wdt:P195 wd:Q000000 . OPTIONAL { ?w wdt:P18 ?i }
   }
   ```

   Run it at https://query.wikidata.org.
3. Add an entry to `MUSEUMS` in `scripts/ingest-wikidata-art.ts` (copy a neighbour) and
   a line to `package.json`.
4. Dry-run, then run, then export.

## Before you publish more

- **Licences.** `pnpm export` keeps an image link only where the source licence is open.
  Add the new source and its terms to `DATA-SOURCES.md`.
- **First Nations material.** Run `pnpm flag:icip -- --apply` after every ingestion and
  read a sample of what it flagged and what it did not. It is a safety net.
- **Be polite to sources.** Use `--limit`, do not hammer an API, and keep the
  `User-Agent` the scripts set.

## Restoring the current sample

The live sample is rebuilt from a database backup that is not committed (it is large).
If you have `supabase/dump/*.ndjson`, run:

```bash
pnpm db:start
pnpm db:load-ndjson
```

If you do not, ingest what you want from the tables above, or edit nothing and keep
using the committed `public/data` as it is.
