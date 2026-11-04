"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { artworkHref, getArtist, lifeSpan, prefetchWork } from "@/lib/data";
import { useLoaded } from "@/lib/use-loaded";

const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted";

export function ArtistView() {
  const id = useSearchParams().get("id") ?? "";
  const artist = useLoaded(id, () => getArtist(id));

  const collections = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of artist?.works ?? []) {
      if (w[4]) counts.set(w[4], (counts.get(w[4]) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [artist]);

  if (artist === undefined) {
    return <p className="mx-auto max-w-4xl px-6 py-12 font-display italic text-muted md:px-10">Loading…</p>;
  }
  if (artist === null) {
    return (
      <p className="mx-auto max-w-4xl px-6 py-12 font-display italic text-muted md:px-10">
        Artist not found. Try searching from the home page.
      </p>
    );
  }

  const facts = [artist.nationality, lifeSpan(artist.birth, artist.death)].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:px-10">
      <div className="flex flex-col gap-8 sm:flex-row">
        {artist.image && (
          <figure className="w-40 shrink-0">
            <img src={artist.image} alt={artist.name} referrerPolicy="no-referrer" className="block w-full" />
            <figcaption className={`${label} mt-2`}>Portrait: Wikimedia Commons</figcaption>
          </figure>
        )}
        <div>
          <p className={label}>Artist</p>
          <h1 className="mt-2 font-display text-4xl text-ink">{artist.name}</h1>
          {artist.aka.length > 0 && (
            <p className="mt-2 font-display text-sm italic text-muted">also: {artist.aka.join(" · ")}</p>
          )}
          {facts && <p className={`${label} mt-3`}>{facts}</p>}
          <p className={`${label} mt-1`}>
            {artist.works.length} works in {collections.length} collection{collections.length === 1 ? "" : "s"}
          </p>
          {collections.length > 1 && (
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
              {collections.map(([name, n]) => (
                <li key={name} className="font-display text-sm text-ink">
                  {name} <span className="text-muted">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <h2 className={`${label} mt-14`}>Known works</h2>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {artist.works.map((w) => (
          <li key={w[0]}>
            <Link
              href={artworkHref(w[0])}
              onPointerEnter={() => prefetchWork(w[0])}
              className="flex flex-col gap-1 py-2.5 md:flex-row md:items-baseline md:justify-between md:gap-6"
            >
              <span className="font-display italic text-ink hover:underline">{w[1]}</span>
              <span className={label}>{[w[2], w[4]].filter(Boolean).join(" · ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
