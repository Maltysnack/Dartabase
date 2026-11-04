import type { NextConfig } from "next";

// A fully static site: `pnpm build` writes out/, which GitHub Pages serves.
// For a project page (https://user.github.io/Dartabase) build with
// NEXT_PUBLIC_BASE_PATH=/Dartabase; leave it unset for a user site or custom domain.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  turbopack: { root: __dirname },
};

export default nextConfig;
