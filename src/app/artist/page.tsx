import { Suspense } from "react";
import type { Metadata } from "next";
import { ArtistView } from "@/components/artist-view";

export const metadata: Metadata = { title: "Artist" };

export default function Page() {
  return (
    <Suspense>
      <ArtistView />
    </Suspense>
  );
}
