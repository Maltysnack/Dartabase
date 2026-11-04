import { Suspense } from "react";
import type { Metadata } from "next";
import { GalleriesView } from "@/components/galleries-view";

export const metadata: Metadata = { title: "Galleries and sources" };

export default function Page() {
  return (
    <Suspense>
      <GalleriesView />
    </Suspense>
  );
}
