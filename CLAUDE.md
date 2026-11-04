# Dartabase

A static, searchable index of open museum collections with one-click citations,
deployed as a GitHub Pages portfolio piece. See `README.md` for the design and
`DATA-SOURCES.md` for licences.

**Status (2026-11-04): static site, no server.** The Vercel and Supabase
deployments were suspended repeatedly on free-tier quotas and are gone. The site
is HTML, JavaScript and JSON in `out/`. The local Supabase stack is a workbench for
ingestion and export only and is never deployed.

Do not add features. The whole site is: home with search, search results, an
artist page, an artwork page, and a galleries and sources page. Removed and not
to be re-added without a decision from the maintainer: exhibitions, institution pages, the
lightbox, the API and demo console, saved collections, accounts, analytics,
faceted browse, feeds, and anything that needs a server.

## What lives where

- `src/app` and `src/components`: the five screens. Client components fetch JSON
  from `/data`; there is no server code.
- `src/lib/shard.ts`: how records map to files. Shared by the export script and
  the browser; change both or neither.
- `src/lib/data.ts`: the browser's data access and search.
- `src/lib/cite.ts`: citation formatters (Chicago, MLA, APA, Harvard, BibTeX, RIS).
- `scripts/export-static.ts`: the only thing that decides what is public. Image
  links are kept only where the licence is open.
- `scripts/ingest-*.ts`, `scripts/dedup.ts`, `scripts/flag-first-nations.ts`: the
  data pipeline against the local database.
- `public/data`: the generated dataset, committed. Regenerate with `pnpm export`.

## Commands

- `pnpm dev`, `pnpm build` (writes `out/`), `pnpm lint`, `pnpm test`
- `pnpm db:start`, `db:stop`, `db:env`, `db:restore`, `db:load-ndjson`: local database
- `pnpm gallery:fetch`: refresh the home page image pool after an export
- `pnpm ingest:<source> -- --limit <n>`: always bounded; `--dry-run` first
- `pnpm dedup`, `pnpm flag:icip -- --apply`, `pnpm export`

macOS needs Docker via Colima (`colima start`). The data backup is
`supabase/dump/*.ndjson`, which is gitignored and the only full copy of the
corpus. Keep it backed up outside this machine.

## Guards

- Crawlers are shut out: `public/robots.txt` disallows everything and every page
  has `noindex`. Lift only as a deliberate decision.
- `pnpm export` fails above 900 MB; the Pages workflow fails the same way. GitHub
  Pages allows 1 GB.
- Never run an unbounded ingestion. Never serve or proxy images. Never
  OFFSET-paginate.

## Indigenous Cultural and Intellectual Property (ICIP)

Non-negotiable. Aboriginal and Torres Strait Islander material is governed by
community protocol, not only copyright.

- Mirror, do not exceed: only what the source institution has published.
- Keep the standing footer advisory on every page and the per-record cultural
  advisory with its removal link.
- Sacred or restricted records marked by a source must not be exported.
- `scripts/flag-first-nations.ts` only ever adds flags, and is a safety net, not
  a classification. When unsure, flag and leave it for human review.
- Takedown and ICIP requests are read first.

## Principles

- No accounts, no user data, no analytics, no cookies, ever.
- Free, and not a business. No paid tier, no advertising.
- Provenance on every field; every record links to its source.
- Metadata first. Never host images; link to the rights holder, and only show
  images that are openly licensed. The one exception is the small public-domain
  pool in `public/gallery` for the home page.
- Stand back: the interface is quiet so the artworks are the beauty on the page.

## Conventions

- No em dashes anywhere (chat, code, comments, commits). Use commas, periods or
  semicolons. En dashes are fine.
- Australian English: organise, behaviour, colour, licence (noun), centre.
