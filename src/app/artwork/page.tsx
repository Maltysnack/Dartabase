import { Suspense } from "react";
import type { Metadata } from "next";
import { ArtworkView } from "@/components/artwork-view";

export const metadata: Metadata = { title: "Artwork" };

export default function Page() {
  return (
    <Suspense>
      <ArtworkView />
    </Suspense>
  );
}
