"use client";

import { useState } from "react";

// An image hotlinked from the source museum or Wikimedia. If it is missing or
// fails to load, the frame stays empty rather than showing a broken icon. An
// optional local placeholder (a thumbnail already in the browser) shows at once
// and the full image fades in over it.
export function WorkImage({
  src,
  alt,
  fit = "contain",
  placeholder,
}: {
  src: string | null;
  alt: string;
  fit?: "contain" | "cover";
  placeholder?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const fitClass = fit === "cover" ? "object-cover" : "object-contain";
  const base = `absolute inset-0 h-full w-full ${fitClass}`;
  return (
    <>
      {placeholder && !(loaded && !failed) && <img src={placeholder} alt={alt} className={base} />}
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`${base} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </>
  );
}
