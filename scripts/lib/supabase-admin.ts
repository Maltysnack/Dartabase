import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// supabase-js builds a Realtime client that expects a WebSocket. Node 20, used
// by these standalone scripts, has no native WebSocket, so provide one. We do
// not use Realtime; this only satisfies the constructor. Node 22+ has
// WebSocket natively, so this is a no-op there.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = ws;
}

// Service-role Supabase client for ingestion scripts only.
// This bypasses Row Level Security, so it must never be imported into app code
// or shipped to the browser. Scripts run server-side only.
export function createAdminClient(): SupabaseClient {
  // Load .env.local if present. Absent file is fine; vars may already be set.
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local, fall back to the existing environment
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Add them to .env.local. The service role key comes from the Supabase\n" +
        "dashboard: Project Settings > API keys > service_role.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
