# Dartabase

Reference data for artworks is scattered across museum sites, each with its own
schema, its own API and its own idea of what a date or a medium is. Dartabase
normalises about 128,000 artwork records from open museum collections into one
schema, makes them searchable in the browser, and formats a citation for any
record in Chicago, MLA, APA or Harvard, with BibTeX and RIS. Every field is
attributable to a named source.

It is a personal project, built solo, and it is not a business. The site is
fully static: HTML, JavaScript and JSON files on GitHub Pages. There is no
server, no database and no account.

## Using it

**Find a work or an artist.** Type in the search box on the home page. Results
appear as you type; press Enter for the full list. Search by a title ("water
lilies"), an artist ("Degas"), or both ("degas dancers"). Type at least three
letters.

**Artist pages** show a portrait where one exists, life dates, and a plain list
of known works by title and date. They draw on every collection in Dartabase, so
the list is wider than any one museum's website. Edgar Degas, for example, is 206
works in 28 collections. Click a work to open it.

**Artwork pages** show the image where the museum has openly licensed one, the
catalogue details (artist, date, medium, dimensions, location, credit), and a
**Cite this work** panel. Pick Chicago, MLA, APA or Harvard, copy the citation,
or download it as BibTeX (.bib) or RIS (.ris) for a reference manager. Click the
artist's name to go to their page. "View source record" opens the museum's own
page for the work.

**When there is no image.** Many works, including most Australian ones, are
still in copyright, so the museum has not released an image. The page says
"Metadata only", keeps the full record and citation, and links to the source.

**Cultural advisory.** Works connected to Aboriginal and Torres Strait Islander
art carry an advisory, and a notice that names and works of people who have died
may appear sits at the foot of every page. If something should be restricted or
removed, use the link on the record or open an issue.

**Galleries and sources** (footer link) lists every collection covered, with a
link to each institution.

Coverage is a sample, not everything a museum holds: 71 collections, 128,331
artworks, 20,180 artists. If a work is missing it may exist at the source but not
here. The Australian galleries (QAGOMA, NGV, AGNSW, NGA, AGSA, AGWA) are metadata
only and link back to the gallery. Corrections: use "Suggest a correction" on any
record.

## How it works

```
museum APIs, CSV dumps, Wikidata
        │  pnpm ingest:*   (run by hand, bounded, dry-run first)
        ▼
local Postgres (Supabase in Docker)  ──  pnpm dedup, pnpm flag:icip
        │  pnpm export
        ▼
public/data/   ~20,000 small JSON files, ~175 MB
public/gallery/  72 public-domain thumbnails for the home page (pnpm gallery:fetch)
        │  pnpm build        (Next.js static export)
        ▼
out/  ──►  GitHub Pages
```

The database is a workbench on one laptop. It exists to normalise and
deduplicate. The published site only reads files: a record is one fetch of a
~30 KB shard named by the first characters of its id, and search is a fetch of a
small index file named by the first letters of the word you typed. Nothing runs
on a server, so nothing can be exhausted, billed or suspended.

Images are not stored, apart from 72 public-domain thumbnails that make the home page
wall instant. A record holds a link and the visitor's browser loads
the image from the museum or Wikimedia Commons. An image link is exported only
where the source licence is open (CC0, public domain, CC BY, Commons).
`DATA-SOURCES.md` lists every source, its terms, and how First Nations material
is flagged.

## Why static

The first version ran on Vercel and Supabase free tiers and was suspended on both
more than once. Every incident was work done per request that nobody had
priced: a query plan that went from 35 ms to 46 s once the table passed 50,000
rows, an OFFSET-paginated sitemap that drained the disk IO budget, crawlers
exploring a combinatorial space of faceted URLs and exhausting 5 GB of egress, and
285 open branches each holding a running preview deployment. All of them were
invisible in code review and obvious in metrics. Static files remove the whole
class: bots can only download files from a CDN.

## Run it

Requirements: Node 20+ and pnpm.

```bash
pnpm install
pnpm dev
```

The data is committed under `public/data`, so the site works straight after
cloning. Deploy by pushing to `main` with Pages set to "GitHub Actions"
(Settings, Pages, Source). The workflow builds with the right base path for a
project page and refuses to publish a site over 900 MB.

### Custom domain (dartabase.art)

`dartabase.art` is registered at Name.com, with nameservers pointing at Vercel, so
the old Vercel project may still be serving it. To move it to GitHub Pages:

1. In Vercel, open the Dartabase project, then Settings, Domains, and remove
   `dartabase.art` (or delete the project). DNS stays at Vercel until you change it.
2. In Vercel, open Domains, then `dartabase.art`, then DNS Records. Delete the
   existing apex A or ALIAS record. Add four A records for the apex
   (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and
   a CNAME `www` pointing to `<your-github-username>.github.io`. Check these
   against GitHub's Pages documentation before saving. Alternatively, change the
   nameservers back at Name.com and add the same records there.
3. In the GitHub repository, open Settings, Pages. Set Source to "GitHub Actions",
   enter `dartabase.art` under Custom domain, save, and tick Enforce HTTPS once
   the DNS check passes (it can take from minutes to a few hours).
4. In Settings, Secrets and variables, Actions, Variables, add `CUSTOM_DOMAIN` with
   the value `dartabase.art`. This builds the site for the domain root instead
   of `/Dartabase`. Re-run the "Deploy to GitHub Pages" workflow.

### Rebuilding the data, or adding galleries

See [docs/ADDING-GALLERIES.md](docs/ADDING-GALLERIES.md) for every gallery's script, what it needs and how much room is left.

Needs Docker (Colima on macOS) running. The ingestion scripts are the original
pipeline; each takes `--dry-run` and a required `--limit`.

```bash
pnpm db:start                                   # local Postgres in Docker
pnpm db:env                                     # writes .env.local for it
pnpm db:restore                                 # loads the published data snapshot
pnpm ingest:tate -- --limit 500                 # or any ingest:* script
pnpm ingest:ngv -- --limit 7000
pnpm dedup                                      # fold cross-source duplicates
pnpm flag:icip -- --apply                       # conservative First Nations flags
pnpm export                                     # writes public/data
pnpm build                                      # writes out/
```

Never run an unbounded ingestion. Set `NEXT_PUBLIC_BASE_PATH=/Dartabase` (or your
repository name) when building for a project page.

## Known gaps

- Coverage is a sample, not the whole of any collection (see `docs/ADDING-GALLERIES.md`).
- First Nations flags are heuristic. They add to what Wikidata and the source
  institutions record and will miss some records and over-flag others, so a human
  review of a sample is still needed.
- Wikidata coverage of the Australian galleries is partial and thin on images.
- Hotlinked images can disappear if a museum moves them; the frame then stays empty.

## Principles

- No accounts, no user data, no analytics, no cookies.
- Mirror, do not exceed: only what an institution has already published.
- First Nations cultural material (ICIP) is handled conservatively, and a
  standing advisory appears on every page.
- The site supports institutions and does not replace them: every record links
  back to its source.

## Stack

Next.js (static export) and TypeScript, Tailwind CSS, Vitest. Ingestion in
TypeScript against museum APIs, CSV dumps and Wikidata SPARQL. Local Postgres via
the Supabase CLI.

## Licence

The code is MIT licensed (see `LICENSE`). The museum records and images it indexes
belong to their institutions and sources and are not covered by that licence; see
`DATA-SOURCES.md`.
