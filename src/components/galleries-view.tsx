"use client";

import { useEffect, useState } from "react";
import { getGalleries, REPO, type GalleryRow } from "@/lib/data";

const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted";

export function GalleriesView() {
  const [rows, setRows] = useState<GalleryRow[]>([]);
  useEffect(() => {
    getGalleries().then((g) => setRows(g ?? []));
  }, []);

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
          Images are never stored here. Where an institution has openly licensed an image, your browser
          loads it directly from the museum or Wikimedia Commons, which means those hosts can see your
          IP address. Works without an openly licensed image show metadata only.
        </p>
        <p>
          First Nations material is flagged, and a standing advisory appears on every page. To request
          removal or restriction of a record, use the link on the record, or{" "}
          <a
            href={`https://github.com/${REPO}/issues`}
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            open an issue
          </a>
          . Licences for each source are listed in DATA-SOURCES.md in the{" "}
          <a
            href={`https://github.com/${REPO}`}
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            repository
          </a>
          .
        </p>
      </div>

      <p className="mt-6 max-w-2xl font-display text-[15px] leading-relaxed text-ink">
        The counts below are samples, not whole collections. To add more of any gallery, or
        another gallery altogether, see the{" "}
        <a
          href={`https://github.com/${REPO}/blob/main/docs/ADDING-GALLERIES.md`}
          className="underline underline-offset-4"
          target="_blank"
          rel="noopener noreferrer"
        >
          guide to adding galleries
        </a>
        , which lists a ready-made script for each.
      </p>

      <GalleryList title="Australia" rows={rows.filter((g) => g.country === "Australia")} />
      <GalleryList title="Elsewhere" rows={rows.filter((g) => g.country !== "Australia")} />
    </div>
  );
}

function GalleryList({ title, rows }: { title: string; rows: GalleryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className={label}>{title}</h2>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {rows.map((g) => (
          <li key={g.name} className="flex flex-col gap-1 py-3 md:flex-row md:items-baseline md:justify-between md:gap-6">
            <span className="font-display text-ink">
              {g.website ? (
                <a href={g.website} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                  {g.name} ↗
                </a>
              ) : (
                g.name
              )}
            </span>
            <span className={label}>
              {[g.city, g.country].filter(Boolean).join(", ")} · {g.works.toLocaleString("en-AU")} works
              {g.images === 0 ? " · metadata only" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
