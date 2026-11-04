"use client";

import { useEffect, useMemo, useState } from "react";
import { getGalleries, REPO, type GalleryRow } from "@/lib/data";

const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted";
const link = "ext hover:text-ink";
// Galleries with at least this many works show a count; the rest are smaller
// samples that can be expanded.
const COUNT_FROM = 1000;

export function GalleriesView() {
  const [rows, setRows] = useState<GalleryRow[]>([]);
  useEffect(() => {
    getGalleries().then((g) => setRows(g ?? []));
  }, []);

  const countries = useMemo(() => {
    const by = new Map<string, GalleryRow[]>();
    for (const g of rows) {
      const c = g.country ?? "Other";
      by.set(c, [...(by.get(c) ?? []), g]);
    }
    const total = (list: GalleryRow[]) => list.reduce((n, g) => n + g.works, 0);
    return [...by.entries()].sort(([a, x], [b, y]) =>
      a === "Australia" ? -1 : b === "Australia" ? 1 : total(y) - total(x),
    );
  }, [rows]);

  const repo = `https://github.com/${REPO}`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:px-10">
      <p className={label}>Galleries and sources</p>
      <h1 className="mt-2 font-display text-3xl text-ink">What Dartabase covers</h1>
      <div className="mt-6 max-w-2xl space-y-4 font-display text-[15px] leading-relaxed text-ink">
        <p>
          Dartabase indexes a sample of open museum collections: records the institutions, or Wikidata
          on their behalf, have published for reuse. It is not complete, and it is not a substitute
          for any museum. Every record links back to its source.
        </p>
        <p>
          Images are not stored here, with the exception of a small set of public-domain pictures on
          the home page. Where an institution has openly licensed an image, your browser loads it
          directly from the museum or Wikimedia Commons, which means those hosts can see your IP
          address. Works without an openly licensed image show metadata only.
        </p>
        <p>
          First Nations material is flagged, and a standing advisory appears on every page. To request
          removal or restriction of a record, use the link on the record, or{" "}
          <a href={`${repo}/issues`} className={link} target="_blank" rel="noopener noreferrer">
            open an issue
          </a>
          .
        </p>
      </div>

      <h2 className="mt-14 font-display text-2xl text-ink">Open source and contributing</h2>
      <div className="mt-4 max-w-2xl space-y-4 font-display text-[15px] leading-relaxed text-ink">
        <p>
          Dartabase is open source under the MIT licence. The{" "}
          <a href={repo} className={link} target="_blank" rel="noopener noreferrer">
            code and data
          </a>{" "}
          are on GitHub, and the museum records keep the terms their sources set, listed in{" "}
          <a href={`${repo}/blob/main/DATA-SOURCES.md`} className={link} target="_blank" rel="noopener noreferrer">
            DATA-SOURCES
          </a>
          .
        </p>
        <p>
          This site is a sample, and anyone can grow it. Each gallery has a script that pulls more
          records from the museum&apos;s own open data. Clone the repository, run the script for the
          gallery you care about, and rebuild. The{" "}
          <a
            href={`${repo}/blob/main/docs/ADDING-GALLERIES.md`}
            className={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            guide to adding galleries
          </a>{" "}
          explains each step, how much room there is, and which galleries are still missing.
        </p>
        <p>
          Contributions are welcome: a new gallery adapter, a correction, a better way to handle
          First Nations material, or a fix to the site. Open an{" "}
          <a href={`${repo}/issues`} className={link} target="_blank" rel="noopener noreferrer">
            issue
          </a>{" "}
          or a pull request.
        </p>
      </div>

      <h2 className="mt-14 font-display text-2xl text-ink">Galleries</h2>
      <p className="mt-3 max-w-2xl font-display text-[15px] leading-relaxed text-muted">
        A count is shown where Dartabase holds at least a thousand works. The others are smaller
        samples that can be expanded with the guide above.
      </p>

      {countries.map(([country, list]) => (
        <section key={country} className="mt-10">
          <h3 className="font-display text-xl text-ink">{country}</h3>
          {country === "Australia" && (
            <p className="mt-2 max-w-2xl font-display text-sm leading-relaxed text-muted">
              NGV, the National Gallery of Australia, the Art Gallery of NSW and the Art Gallery of South
              Australia publish no open collection feed, so their records come from Wikidata as metadata
              only. Several other Australian galleries, including the MCA, cannot be added yet; the guide
              explains why.
            </p>
          )}
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {list.map((g) => (
              <li
                key={g.name}
                className="flex flex-col gap-1 py-3 md:flex-row md:items-baseline md:justify-between md:gap-6"
              >
                <span className="font-display text-ink">
                  {g.website ? (
                    <a href={g.website} target="_blank" rel="noopener noreferrer" className="ext hover:text-muted">
                      {g.name}
                    </a>
                  ) : (
                    g.name
                  )}
                </span>
                <span className={label}>
                  {[g.city, g.works >= COUNT_FROM ? `${g.works.toLocaleString("en-AU")} works` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
