# Data sources and licences

Dartabase mirrors what institutions have chosen to publish, and nothing else. It stores metadata and image **links**, never image files. This page records where each group of records comes from, under what terms, and how images are treated. Facts are as understood on 2026-11-04; where a licence could not be confirmed it says so. This is a good-faith record, not legal advice. If you are a rights holder and want a record changed or removed, open an issue (see the end).

## Rules the data must satisfy

- **Programmatic access only.** Public APIs, SPARQL, or published datasets. No scraping of rendered pages.
- **Metadata first.** Titles, dates, media and credit lines are stored. Bare facts carry little or no copyright protection in Australia (*IceTV v Nine Network*, *Telstra v Desktop Marketing*); descriptions and credit lines can, so source and licence are recorded.
- **Images only where openly licensed.** `scripts/export-static.ts` keeps an image link only when the source licence is CC0, public domain, no known copyright restrictions, CC BY, or a Wikimedia Commons file. Rights-reserved images, "see source" images, and bare institution names are dropped at export; the record then shows metadata only and links to the source. 15,517 image links were dropped on the first export (Tate 8,269, MoMA 6,000, Art Institute of Chicago 709, Harvard 495 and a few others).
- **One exception to "links only".** The home page keeps 72 small thumbnails in `public/gallery`, chosen only from works the source marks public domain or CC0 and served from Wikimedia Commons, so the wall loads instantly and can show a new random set each visit. Each has its credit in `public/gallery/index.json`.
- **First Nations material (ICIP).** See the section below.

## Which galleries are published

Only galleries with a real sample are listed. The export (`scripts/export-static.ts`) leaves out any gallery with fewer than 50 works and the whole of the Joconde source, which scatters a handful of records across many small French museums and has no images. A scattering is not useful to a reader and cannot be expanded sensibly. The French national feed (`pnpm ingest:joconde`) remains in the repository for anyone who wants it.

Several large Australian galleries could not be added because there is nothing to ingest: the MCA Sydney, MONA, the Art Gallery of Western Australia (9 works on Wikidata), TMAG, Ballarat and Newcastle. See `docs/ADDING-GALLERIES.md`.

## Where records come from

| Group | Access | Metadata terms | Images |
|---|---|---|---|
| Art Institute of Chicago, The Met, Cleveland, National Gallery of Art (Washington), MoMA, Minneapolis Institute of Art, Walters, Smithsonian art museums, SMK, Städel, Whitney, Tate | Public APIs or CC0 open-data dumps | CC0 | Public-domain or CC0 images only (see rules above) |
| Harvard Art Museums | REST API with a free key | Harvard API terms | Only Harvard-cleared images; links otherwise dropped |
| V&A | Public API | V&A API terms | Linked where marked CC0 |
| Finnish National Gallery (Ateneum, Sinebrychoff), Serlachius, Gallen-Kallela | Finna API | CC0 | Per record: CC0 or CC BY 4.0 |
| Nationalmuseum Norway | DigitaltMuseum | Per source | Per record: CC BY-NC (non-commercial, credit required) |
| Europeana (sample) | REST API | CC0 | Per record: CC BY-SA or public domain |
| National Taiwan Museum of Fine Arts, Kaohsiung Museum of Fine Arts | collections.culture.tw open data | CC BY 4.0 | None published |
| Tokyo metropolitan museums (TOMuCo) | Open-data download | Per source (not confirmed) | None |
| QAGOMA (Queensland) | Queensland open-data CSV | Queensland Government open data (published as CC BY 4.0; confirm at the dataset page) | None published |
| Wikidata collections: Uffizi, Capodimonte, Hermitage, Frick, Prado, National Gallery London, Fitzwilliam, Scottish National Gallery, Nationalmuseum Stockholm, National Palace Museum Taipei, Warsaw, Bavarian State Painting Collections, and about 30 more | Wikidata SPARQL (`P195` collection) | CC0 (Wikidata) | Wikimedia Commons file, linked directly; the per-file licence applies and is one click away |
| NGV, Art Gallery of NSW, National Gallery of Australia, Art Gallery of South Australia, Art Gallery of Western Australia | Wikidata SPARQL, `--metadata-only` | CC0 (Wikidata) | None ever stored |

National Gallery London records here come from Wikidata, not from the gallery's own API, whose metadata is CC BY-NC-ND. Do not mix the two without checking the no-derivatives term.

Australian gallery websites were checked in November 2026 and none of NGV, AGNSW, NGA, AGSA or AGWA publishes an open collection API or dataset that was found. Wikidata coverage of these collections is partial and uneven, which is why they appear as metadata-only records with a link to the Wikidata item and, through it, the gallery.

## Images

Each record holds a URL. The visitor's browser fetches the image directly from the museum or Wikimedia Commons, so those hosts see the visitor's IP address. Dartabase serves no image, runs no image proxy, and collects nothing about visitors.

Wikimedia Commons asks reusers to follow each file's licence and credit; the record links to the Commons file page through its Wikidata item. Hotlinking is permitted by Commons but discouraged because files can be renamed or removed, in which case the frame stays empty.

## First Nations material (ICIP)

Aboriginal and Torres Strait Islander material is governed by community protocol, not only by copyright.

- A standing advisory about names and works of people who have died appears on every page.
- Records are flagged `icip` and show a Cultural advisory with a removal link when any of these hold: the source marks the record as First Nations (QAGOMA's Indigenous Australian Art department), Wikidata records the creator's ethnic group as First Nations, the creator already has a flagged work, the creator's name carries a Western Desert, Warlpiri, Yolngu or Tiwi skin or clan name, or the title names a Dreaming or Tjukurrpa (`scripts/flag-first-nations.ts`).
- This is a safety net, not a classification. It will miss records and over-flag some. Nothing here replaces the holding institution's own cultural process, and the project never publishes anything an institution has not already published.
- Sacred or restricted records marked as such by a source must not be exported. If you find one, report it.

## Corrections and removal

Open an issue on the repository. Takedown and ICIP requests are read first. Records can be removed or restricted at the next export.
