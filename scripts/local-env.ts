// Writes .env.local for the local Supabase stack started by `pnpm db:start`.
//
// The CLI only prints API keys when its auth service runs, and Dartabase
// disables auth (no accounts, ever). The keys are still minted for the local
// API gateway, so read them from its config. They are the CLI's fixed local
// development keys and only work against 127.0.0.1.
//
// Usage: pnpm db:env            (refuses to overwrite an existing .env.local)
//        pnpm db:env -- --force (backs the old file up to .env.local.bak first)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";

const GATEWAY = "supabase_kong_Dartabase";
const ENV_FILE = ".env.local";

function gatewayConfig(): string {
  try {
    return execFileSync("docker", ["exec", GATEWAY, "cat", "/home/kong/kong.yml"], {
      encoding: "utf8",
    });
  } catch {
    throw new Error(`Cannot read ${GATEWAY}. Start the stack first: pnpm db:start`);
  }
}

function key(config: string, prefix: string): string {
  const match = config.match(new RegExp(`${prefix}[A-Za-z0-9_-]+`));
  if (!match) throw new Error(`No ${prefix}* key found in the gateway config.`);
  return match[0];
}

const force = process.argv.includes("--force");
if (existsSync(ENV_FILE)) {
  if (!force) {
    console.error(`${ENV_FILE} exists. Re-run with --force to replace it (a .bak copy is kept).`);
    process.exit(1);
  }
  copyFileSync(ENV_FILE, `${ENV_FILE}.bak`);
}

const config = gatewayConfig();
writeFileSync(
  ENV_FILE,
  [
    "# Local Supabase stack (pnpm db:start). Written by pnpm db:env.",
    "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
    `SUPABASE_SERVICE_ROLE_KEY=${key(config, "sb_secret_")}`,
    "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
    "",
  ].join("\n"),
);
console.log(`Wrote ${ENV_FILE} for the local stack.`);
