"use client";

import { useLoaded } from "@/lib/use-loaded";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { artistHref, artworkHref, lifeSpan, search } from "@/lib/data";

const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted";

export function SearchView() {
  const q = useSearchParams().get("q") ?? "";
  const results = useLoaded(q, () => search(q));

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:px-10">
      <p className={label}>Results for</p>
      <h1 className="mt-2 font-display text-3xl italic text-ink">{q}</h1>

      {results === undefined && <p className="mt-10 font-display italic text-muted">Searching…</p>}
      {results?.tooShort && (
        <p className="mt-10 font-display italic text-muted">Type at least three letters.</p>
      )}
      {results && !results.tooShort && results.artists.length === 0 && results.works.length === 0 && (
        <p className="mt-10 max-w-xl font-display italic text-muted">
          Nothing matches. Dartabase holds a sample of open museum collections, so a work may exist
          that is not indexed here. See the list of galleries and sources in the footer.
        </p>
      )}

      {results && results.artists.length > 0 && (
        <section className="mt-12">
          <h2 className={label}>Artists</h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {results.artists.map((a) => (
              <li key={a[0]}>
                <Link
                  href={artistHref(a[0])}
                  className="flex flex-col gap-1 py-3 md:flex-row md:items-baseline md:justify-between"
                >
                  <span className="font-display text-lg text-ink hover:underline">{a[1]}</span>
                  <span className={label}>
                    {[a[4], lifeSpan(a[2], a[3]), `${a[5]} works`].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.works.length > 0 && (
        <section className="mt-12">
          <h2 className={label}>Artworks</h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {results.works.map((w) => (
              <li key={w[0]}>
                <Link
                  href={artworkHref(w[0])}
                  className="flex flex-col gap-1 py-3 md:flex-row md:items-baseline md:justify-between md:gap-6"
                >
                  <span className="font-display italic text-ink hover:underline">{w[1]}</span>
                  <span className={label}>
                    {[w[2], w[3]].filter(Boolean).join(" · ")}
                    {w[4] ? "" : " · no image"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
