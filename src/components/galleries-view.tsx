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
    <div className="lg:flex lg:h-[calc(100dvh-4.5rem)] lg:overflow-hidden">
      <aside className="px-6 py-10 md:px-10 lg:w-[26rem] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-line xl:w-[30rem]">
        <p className={label}>Galleries and sources</p>
        <h1 className="mt-2 font-display text-3xl text-ink">What Dartabase covers</h1>
        <div className="mt-6 space-y-4 font-display text-[15px] leading-relaxed text-ink">
          <p>
            A sample of open museum collections, gathered from what each museum, or Wikidata on its
            behalf, has published for reuse. It is not complete, and every record links back to its
            source.
          </p>
          <p>
            Images load straight from the museum or Wikimedia Commons, so they appear only where the
            museum has openly licensed them. Everything else is catalogue information.
          </p>
          <p>
            First Nations material is flagged, and a notice appears on every page. To ask for a
            record to be restricted or removed, use the link on the record.
          </p>
          <p className="border-t border-line pt-4 text-muted">
            Dartabase is open source.{" "}
            <a href={repo} className={link} target="_blank" rel="noopener noreferrer">
              Add galleries or fix records on GitHub
            </a>
            .
          </p>
        </div>
      </aside>

      <section className="px-6 pb-12 md:px-10 lg:flex-1 lg:overflow-y-auto lg:py-10">
        <p className="max-w-2xl font-display text-sm leading-relaxed text-muted">
          A count is shown where Dartabase holds a thousand works or more. The others are smaller
          samples.
        </p>
        {countries.map(([country, list]) => (
          <div key={country} className="mt-8">
            <h2 className="font-display text-xl text-ink">{country}</h2>
            {country === "Australia" && (
              <p className="mt-1 max-w-2xl font-display text-sm leading-relaxed text-muted">
                These galleries publish no open collection feed, so most records are catalogue
                information only. The MCA and a few others cannot be added yet.
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
          </div>
        ))}
      </section>
    </div>
  );
}
