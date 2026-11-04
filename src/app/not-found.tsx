import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 md:px-10">
      <h1 className="font-display text-3xl text-ink">Page not found</h1>
      <p className="mt-4 font-display italic text-muted">
        <Link href="/" className="underline underline-offset-4 hover:text-ink">
          Search from the home page
        </Link>
        .
      </p>
    </div>
  );
}
