// Downloads a small pool of public-domain thumbnails for the home page wall, so
// it shows instantly and a fresh random set can be picked on every visit.
//
//   pnpm export && pnpm gallery:fetch
//
// Only works the source marks public domain or CC0, served from Wikimedia Commons,
// are used. Files go to public/gallery with an index.json holding the credit for
// each. This is the one place the repo holds image files; everything else is a link.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "gallery");
const TARGET = 72;
const PER_GALLERY = 2;
const WIDTH = 480;
const USER_AGENT =
  "Dartabase/1.0 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";

interface Candidate {
  id: string; title: string; artist: string; date: string | null;
  institution: string; image: string; licence: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(url: string): Promise<{ bytes: Buffer; ext: string } | null> {
  const sized = url.replace(/([?&])width=\d+/, "$1width=" + WIDTH);
  const full = sized.includes("width=") ? sized : `${sized}${sized.includes("?") ? "&" : "?"}width=${WIDTH}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(full, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!type.startsWith("image/") || bytes.length < 5_000 || bytes.length > 400_000) return null;
      return { bytes, ext: type.includes("png") ? "png" : "jpg" };
    } catch {
      await sleep(1000 * attempt);
    }
  }
  return null;
}

async function main() {
  const candidates: Candidate[] = JSON.parse(readFileSync(".gallery-candidates.json", "utf8"));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const perGallery = new Map<string, number>();
  const index: Record<string, unknown>[] = [];
  for (const c of candidates) {
    if (index.length >= TARGET) break;
    if ((perGallery.get(c.institution) ?? 0) >= PER_GALLERY) continue;
    const got = await download(c.image);
    await sleep(500);
    if (!got) continue;
    const file = `${String(index.length + 1).padStart(2, "0")}.${got.ext}`;
    writeFileSync(join(OUT, file), got.bytes);
    perGallery.set(c.institution, (perGallery.get(c.institution) ?? 0) + 1);
    index.push({ file, id: c.id, title: c.title, artist: c.artist, date: c.date, institution: c.institution, licence: c.licence });
    console.log(`${index.length}/${TARGET} ${c.institution}: ${c.title}`);
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
  console.log(`wrote ${index.length} images to public/gallery`);
}

main().catch((e) => { console.error(e); process.exit(1); });
