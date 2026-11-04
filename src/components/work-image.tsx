"use client";

import { useState } from "react";

// An image hotlinked from the source museum or Wikimedia. If it is missing or
// fails to load, the frame stays empty rather than showing a broken icon.
export function WorkImage({
  src,
  alt,
  fit = "contain",
}: {
  src: string | null;
  alt: string;
  fit?: "contain" | "cover";
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`absolute inset-0 h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
    />
  );
}
