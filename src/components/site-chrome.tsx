import Link from "next/link";
import { Wordmark } from "./wordmark";
import { SearchBox } from "./search-box";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-6 py-5 md:gap-8 md:px-10 md:py-4">
        <Link href="/" aria-label="Dartabase home" className="shrink-0">
          <Wordmark />
        </Link>
        <div className="ml-auto w-full max-w-md">
          <SearchBox size="compact" />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto max-w-[1500px] px-6 py-10 md:px-10">
        <p className="font-display text-[13px] leading-relaxed text-muted">
          Aboriginal and Torres Strait Islander peoples are advised that
          Dartabase may contain images, names, and works of people who have
          died.
        </p>
        <div className="mt-8 flex flex-col gap-6 border-t border-line pt-8 font-mono text-[10px] uppercase tracking-[0.12em] text-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="leading-relaxed">Dartabase, a reference for art and its makers</p>
          <Link href="/galleries/" className="ext transition-colors hover:text-ink">
            Galleries and sources
          </Link>
        </div>
      </div>
    </footer>
  );
}
