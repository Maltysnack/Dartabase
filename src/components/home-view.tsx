"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { artworkHref, getFeatured, getStats, type Stats, type Work } from "@/lib/data";
import { SearchBox } from "./search-box";
import { WorkImage } from "./work-image";

export function HomeView() {
  const [featured, setFeatured] = useState<Work[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getFeatured().then((f) => setFeatured(f ?? []));
    getStats().then(setStats);
  }, []);

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-16 md:px-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Art reference database</p>
      <h1 className="mt-4 max-w-2xl font-display text-xl leading-relaxed text-ink md:text-2xl">
        Dartabase gathers artwork records from museum collections into one place. Built for art
        students and academics.
      </h1>
      <div className="mt-10 max-w-xl">
        <SearchBox size="large" />
        <p className="mt-3 min-h-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {stats
            ? `${stats.artworks.toLocaleString("en-AU")} artworks from ${stats.institutions} collections`
            : ""}
        </p>
        <p className="mt-2 font-display text-sm text-muted">
          Includes the Queensland, Victorian, New South Wales, South Australian, Western Australian
          and National galleries.{" "}
          <Link href="/galleries/" className="underline underline-offset-4 hover:text-ink">
            See all galleries
          </Link>
        </p>
      </div>

      <h2 className="mt-20 font-display text-lg text-ink">In the collection</h2>
      <ul className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
        {featured.map((w) => (
          <li key={w.id}>
            <Link href={artworkHref(w.id)} className="group block border border-line bg-raised">
              <div className="relative aspect-[4/5] overflow-hidden bg-raised">
                <WorkImage src={w.image} alt={w.title} fit="contain" />
              </div>
              <div className="px-3 py-3">
                <p className="font-display italic text-ink group-hover:underline">{w.title}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  {[w.artist?.name, w.date].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  {w.institution?.name}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
