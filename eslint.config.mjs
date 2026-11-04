import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Artwork images are served straight from museum image servers.
      // next/image optimization needs a host that provides it; we serve
      // museum thumbnails straight from their CDNs instead.
      "@next/next/no-img-element": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "zotero/**", ".claude/**", "supabase/dump/**"]),
]);

export default eslintConfig;
