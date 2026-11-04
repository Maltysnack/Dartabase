"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
const GAP = 16;
const CAPTION_H = 52;
// Extreme proportions are eased so one very long panorama or sliver cannot
// take over a row.
const MIN_RATIO = 0.55;
const MAX_RATIO = 2.4;

interface Placed {
  tile: GalleryTile;
  w: number;
  h: number;
}

// Justified rows: tiles are packed left to right and each row is scaled so it
// exactly fills the width. Every picture keeps its proportions, and the tiles in
// a row share a top and a bottom edge.
function layout(tiles: GalleryTile[], width: number, target: number): Placed[][] {
  const ratio = (t: GalleryTile) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, t.w / t.h));
  const rows: Placed[][] = [];
  let row: GalleryTile[] = [];
  let sum = 0;
  const flush = (last: boolean) => {
    if (row.length === 0) return;
    const free = width - GAP * (row.length - 1);
    const fit = free / sum;
    const h = last ? Math.min(fit, target) : fit;
    rows.push(row.map((tile) => ({ tile, w: ratio(tile) * h, h })));
    row = [];
    sum = 0;
  };
  for (const tile of tiles) {
    row.push(tile);
    sum += ratio(tile);
    if ((width - GAP * (row.length - 1)) / sum <= target) flush(false);
  }
  flush(true);
  return rows;
}

export function HomeView() {
  const [tiles, setTiles] = useState<GalleryTile[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [width, setWidth] = useState(0);
  const wall = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getGalleryTiles(TILES).then(setTiles);
    getStats().then(setStats);
  }, []);

  useLayoutEffect(() => {
    const el = wall.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(
    () => (width > 0 ? layout(tiles, width, width < 640 ? 230 : width < 1024 ? 240 : 280) : []),
    [tiles, width],
  );

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
      <div ref={wall} className="mt-6">
        {rows.map((row, i) => (
          <div key={i} className="flex" style={{ gap: GAP, marginBottom: GAP }}>
            {row.map(({ tile, w, h }) => (
              <Link
                key={tile.id}
                href={artworkHref(tile.id)}
                className="group block shrink-0"
                style={{ width: w }}
              >
                <div className="overflow-hidden bg-raised" style={{ width: w, height: h }}>
                  <img
                    src={`${BASE}/gallery/${tile.file}`}
                    alt={tile.title}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="overflow-hidden pt-2" style={{ height: CAPTION_H }}>
                  <p className="line-clamp-1 font-display text-sm italic text-ink group-hover:underline">
                    {tile.title}
                  </p>
                  <p className="mt-0.5 line-clamp-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                    {[tile.artist, tile.date].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
