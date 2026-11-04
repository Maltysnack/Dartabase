"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { artistHref, artworkHref, BASE, getWork, lifeSpan } from "@/lib/data";
import { useLoaded } from "@/lib/use-loaded";
import { artworkRights } from "@/lib/format";
import { correctionIssueUrl, takedownIssueUrl } from "@/lib/correction";
import { FieldList } from "./field-list";
import { CitationPanel } from "./citation-panel";
import { WorkImage } from "./work-image";

const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted";

export function ArtworkView() {
  const id = useSearchParams().get("id") ?? "";
  const work = useLoaded(id, () => getWork(id));

  if (work === undefined) {
    return <p className="mx-auto max-w-[1500px] px-6 py-12 font-display italic text-muted md:px-10">Loading…</p>;
  }
  if (work === null) {
    return (
      <p className="mx-auto max-w-[1500px] px-6 py-12 font-display italic text-muted md:px-10">
        Artwork not found. Try searching from the home page.
      </p>
    );
  }

  const pageUrl = `${window.location.origin}${BASE}${artworkHref(work.id)}`;
  const rights = artworkRights(work.licence, !!work.image);

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-12 md:px-10">
      {work.icip && (
        <div className="mb-8 border border-ink bg-raised px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink">Cultural advisory</p>
          <p className="mt-2 max-w-2xl font-display text-sm leading-relaxed text-ink/85">
            This record relates to First Nations art. Aboriginal and Torres Strait Islander peoples are
            advised it may include the names or works of people who have died. Cultural rights in this
            material may rest with a community; refer to the holding institution.
          </p>
          {work.attribution && (
            <p className="mt-2 font-display text-sm text-ink/85">Cultural attribution: {work.attribution}</p>
          )}
          <a
            href={takedownIssueUrl({ recordTitle: work.title, recordUrl: pageUrl })}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block font-mono text-[10px] uppercase tracking-wider text-ink underline underline-offset-4 hover:opacity-70"
          >
            Request removal or restriction ↗
          </a>
        </div>
      )}

      <div className="grid gap-12 lg:grid-cols-[1.45fr_1fr]">
        <div className="relative h-[60vh] min-h-[360px] self-start border border-line bg-raised lg:sticky lg:top-6 lg:h-[78vh]">
          <WorkImage src={work.image} alt={work.title} />
          {!work.image && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
              <p className={label}>Metadata only</p>
              <p className="max-w-sm font-display text-sm italic leading-relaxed text-muted">
                We mirror only what an institution has openly published. This work has no openly
                licensed image here.
                {work.sourceUrl ? " Follow the link below to view it at the source." : ""}
              </p>
            </div>
          )}
        </div>

        <div>
          <h1 className="font-display text-3xl italic leading-tight text-ink md:text-4xl">{work.title}</h1>
          {work.artist && (
            <p className="mt-2 font-display text-lg text-muted">
              <Link href={artistHref(work.artist.id)} className="underline-offset-4 hover:text-ink hover:underline">
                {work.artist.name}
              </Link>
            </p>
          )}

          <div className="mt-8">
            <FieldList
              fields={[
                {
                  label: "Artist",
                  value: work.artist ? (
                    <Link href={artistHref(work.artist.id)} className="underline-offset-4 hover:underline">
                      {work.artist.name}
                      {lifeSpan(work.artist.birth, work.artist.death)
                        ? ` (${lifeSpan(work.artist.birth, work.artist.death)})`
                        : ""}
                    </Link>
                  ) : (
                    "Unknown"
                  ),
                },
                { label: "Date", value: work.date ?? "" },
                { label: "Medium", value: work.medium ?? "" },
                { label: "Classification", value: work.classification ?? "" },
                { label: "Dimensions", value: work.dimensions ?? "" },
                {
                  label: "Location",
                  value: work.institution
                    ? [work.institution.name, work.institution.city].filter(Boolean).join(", ")
                    : "",
                },
                { label: "Credit", value: work.credit ?? "" },
              ]}
            />
          </div>

          <div className="mt-8">
            <h2 className={label}>Cite this work</h2>
            <div className="mt-3">
              <CitationPanel work={work} />
            </div>
          </div>

          <div className="mt-8 space-y-2 border-t border-line pt-5">
            {work.institution && (
              <p className={`${label} leading-relaxed`}>
                Metadata sourced from {work.institution.name} open data
              </p>
            )}
            <p className={`${label} leading-relaxed`}>
              <span className="text-ink">{rights.label}</span>
              {" – "}
              {rights.description}.
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
              {work.sourceUrl && (
                <a
                  href={work.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${label} underline underline-offset-4 hover:text-ink`}
                >
                  View source record ↗
                </a>
              )}
              <a
                href={correctionIssueUrl({ recordType: "artwork", recordTitle: work.title, recordUrl: pageUrl })}
                target="_blank"
                rel="noopener noreferrer"
                className={`${label} underline underline-offset-4 hover:text-ink`}
              >
                Suggest a correction ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
