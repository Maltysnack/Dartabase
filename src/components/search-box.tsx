"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { artistHref, artworkHref, lifeSpan, search } from "@/lib/data";
import { useLoaded } from "@/lib/use-loaded";

// Type-ahead over the static search files. Enter opens the full results page.
export function SearchBox({
  size = "large",
  initial = "",
}: {
  size?: "large" | "compact";
  initial?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(initial);
  const box = useRef<HTMLDivElement>(null);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), 150);
    return () => clearTimeout(t);
  }, [value]);

  const found = useLoaded(settled, () => (settled.trim().length < 3 ? Promise.resolve(null) : search(settled)));
  const results = found ?? null;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const big = size === "large";
  const hits = results ? [...results.artists.slice(0, 3), ...results.works.slice(0, 5)] : [];

  return (
    <div ref={box} className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) {
            setOpen(false);
            router.push(`/search/?q=${encodeURIComponent(value.trim())}`);
          }
        }}
        className={`flex items-center border-b border-ink ${big ? "pb-2" : "pb-1"}`}
      >
        <input
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder={big ? "Search artworks, artists" : "Search"}
          aria-label="Search artworks and artists"
          autoComplete="off"
          className={`w-full bg-transparent text-ink placeholder:text-muted focus:outline-none ${
            big ? "font-display text-2xl" : "font-mono text-[11px] uppercase tracking-wider"
          }`}
        />
        <button type="submit" aria-label="Search" className="pl-3 text-muted hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="m11 11 3.5 3.5" />
          </svg>
        </button>
      </form>
      {open && hits.length > 0 && results && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-[70vh] overflow-y-auto border border-line bg-raised shadow-sm">
          {results.artists.slice(0, 3).map((a) => (
            <li key={a[0]}>
              <Link
                href={artistHref(a[0])}
                onClick={() => setOpen(false)}
                className="flex items-baseline justify-between gap-4 px-4 py-2 hover:bg-paper"
              >
                <span className="font-display text-ink">{a[1]}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  Artist {lifeSpan(a[2], a[3])}
                </span>
              </Link>
            </li>
          ))}
          {results.works.slice(0, 5).map((w) => (
            <li key={w[0]}>
              <Link
                href={artworkHref(w[0])}
                onClick={() => setOpen(false)}
                className="flex items-baseline justify-between gap-4 px-4 py-2 hover:bg-paper"
              >
                <span className="font-display italic text-ink">{w[1]}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
                  {[w[2], w[3]].filter(Boolean).join(", ")}
                </span>
              </Link>
            </li>
          ))}
          <li className="border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted">
            Press Enter for all results
          </li>
        </ul>
      )}
    </div>
  );
}
