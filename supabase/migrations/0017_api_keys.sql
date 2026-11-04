-- API key table for institutional and researcher API access.
-- Keys are never stored in plain text; only a SHA-256 hex hash is persisted.
-- The key itself is generated outside the DB and delivered to the customer
-- by email. On each request the route handler hashes the presented key and
-- checks it here.
--
-- Tiers:
--   free        - no key, rate-limited by IP (enforced in middleware)
--   researcher  - key required, higher rate limit
--   institution - key required, highest rate limit, custom per contract

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash     TEXT NOT NULL UNIQUE,   -- SHA-256(raw_key) as hex
  email        TEXT NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'researcher'
                 CHECK (tier IN ('researcher', 'institution')),
  label        TEXT,                  -- human note, e.g. "University of Melbourne"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,           -- NULL = never expires
  revoked_at   TIMESTAMPTZ,           -- non-NULL = revoked
  last_used_at TIMESTAMPTZ,
  request_count BIGINT NOT NULL DEFAULT 0
);

-- Index for the hot path: hash lookup on every authenticated API request.
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash);

-- Only the service role can read or write this table.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- No public access; service-role bypasses RLS by default in Supabase.
-- (No GRANT to anon or authenticated intentionally.)

-- Usage increment RPC called from middleware (fire-and-forget, SECURITY DEFINER
-- so it bypasses RLS on api_keys for the service role caller).
CREATE OR REPLACE FUNCTION increment_api_key_usage(p_hash TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE api_keys
  SET
    last_used_at  = now(),
    request_count = request_count + 1
  WHERE key_hash = p_hash;
$$;
