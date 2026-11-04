"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  artworkHref,
  BASE,
  getGalleryTiles,
  getStats,
  type GalleryTile,
  type Stats,
} from "@/lib/data";
import { SearchBox } from "./search-box";

const TILES = 24;

export function HomeView() {
  const [tiles, setTiles] = useState<GalleryTile[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getGalleryTiles(TILES).then(setTiles);
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
          Includes the Queensland, Victorian, New South Wales, South Australian and National galleries.{" "}
          <Link href="/galleries/" className="ext hover:text-ink">
            See all galleries
          </Link>
        </p>
      </div>

      <h2 className="mt-20 font-display text-lg text-ink">In the collection</h2>
      <ul className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.id}>
            <Link href={artworkHref(t.id)} className="group block border border-line bg-raised">
              <div className="relative aspect-[4/5] overflow-hidden bg-raised">
                <img
                  src={`${BASE}/gallery/${t.file}`}
                  alt={t.title}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>
              <div className="px-3 py-3">
                <p className="font-display italic text-ink group-hover:underline">{t.title}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  {[t.artist, t.date].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  {t.institution}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
