"use client";

import { useState } from "react";
import {
  CITATION_LABELS,
  CITATION_STYLES,
  bibtex,
  buildCitation,
  citationToText,
  ris,
  type CitationStyle,
} from "@/lib/cite";
import { artworkHref, BASE, type Work } from "@/lib/data";

const btn =
  "font-mono text-[10px] uppercase tracking-[0.12em] text-muted underline underline-offset-4 transition-colors hover:text-ink";

function storedStyle(): CitationStyle {
  try {
    const stored = localStorage.getItem("dartabase_citation_style") as CitationStyle | null;
    if (stored && (CITATION_STYLES as readonly string[]).includes(stored)) return stored;
  } catch {
    // storage unavailable; the default style is fine
  }
  return "chicago";
}

// Cite a work in the major styles. Everything runs in the browser.
export function CitationPanel({ work }: { work: Work }) {
  const [style, setStyle] = useState<CitationStyle>(storedStyle);
  const [copied, setCopied] = useState<"" | "citation" | "url">("");

  // The shape the formatters expect.
  const cite = {
    id: work.id,
    title: work.title,
    date_text: work.date,
    date_year: work.year,
    medium: work.medium,
    source: work.source,
    source_id: work.sourceId,
    artist: work.artist ? { name: work.artist.name, sort_name: work.artist.sort } : null,
    institution: work.institution ? { name: work.institution.name, city: work.institution.city } : null,
  };
  const url = `${window.location.origin}${BASE}${artworkHref(work.id)}`;
  const parts = buildCitation(style, cite);
  const slug = (work.sourceId ?? work.id).replace(/[^A-Za-z0-9]/g, "_");

  function download(content: string, filename: string, mime: string) {
    const href = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
  }

  async function copy(text: string, what: "citation" | "url") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      // clipboard unavailable; the text is still visible to copy
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {CITATION_STYLES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setStyle(option);
              try {
                localStorage.setItem("dartabase_citation_style", option);
              } catch {
                // ignore
              }
            }}
            aria-pressed={option === style}
            className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
              option === style ? "bg-ink text-paper" : "text-muted hover:text-ink"
            }`}
          >
            {CITATION_LABELS[option]}
          </button>
        ))}
      </div>

      <p className="mt-4 font-display text-[15px] leading-relaxed text-ink">
        {parts.map((part, i) =>
          part.italic ? <em key={i}>{part.text}</em> : <span key={i}>{part.text}</span>,
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => copy(citationToText(parts), "citation")} aria-live="polite" className={btn}>
          {copied === "citation" ? "Copied" : "Copy citation"}
        </button>
        <button type="button" onClick={() => download(bibtex(cite, url), `${slug}.bib`, "text/plain")} className={btn}>
          .bib
        </button>
        <button
          type="button"
          onClick={() => download(ris(cite, url), `${slug}.ris`, "application/x-research-info-systems")}
          className={btn}
        >
          .ris
        </button>
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Page URL</p>
        <p className="mt-2 break-all font-mono text-[11px] text-ink">{url}</p>
        <button type="button" onClick={() => copy(url, "url")} aria-live="polite" className={`${btn} mt-2`}>
          {copied === "url" ? "Copied" : "Copy URL"}
        </button>
      </div>
    </div>
  );
}
