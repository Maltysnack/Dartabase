-- Rate limiting support for API keys and free-tier IP tracking.
--
-- Adds daily_count / daily_reset_at columns to api_keys for per-key daily
-- limits, and a rate_limit_free table for anonymous IP-based limiting.
--
-- Replaces the fire-and-forget increment_api_key_usage RPC with an atomic
-- check_and_increment_api_key RPC that validates and enforces limits in a
-- single round-trip. The old RPC is kept as a thin wrapper for backward
-- compatibility.
--
-- Tier daily limits:
--   researcher  = 1000 req/day
--   institution = unlimited (-1)
--   anything else = 100 req/day

-- ── api_keys daily tracking columns ──────────────────────────────────────────

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS daily_count     INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_reset_at  DATE NOT NULL DEFAULT CURRENT_DATE;

-- ── Free-tier IP rate limit table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate_limit_free (
  ip    TEXT NOT NULL,
  date  DATE NOT NULL DEFAULT CURRENT_DATE,
  count INT  NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, date)
);

ALTER TABLE rate_limit_free ENABLE ROW LEVEL SECURITY;
-- No public access; only service role via RPCs.

-- ── check_and_increment_api_key ───────────────────────────────────────────────
-- Atomic key validation + rate-limit enforcement + usage increment.
-- Returns a JSONB object:
--   {"allowed": true,  "tier": "...", "remaining": N}
--   {"allowed": false, "reason": "invalid"}
--   {"allowed": false, "reason": "rate_limit", "tier": "...", "remaining": 0}

CREATE OR REPLACE FUNCTION check_and_increment_api_key(p_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id          UUID;
  v_tier        TEXT;
  v_daily_count INT;
  v_reset_at    DATE;
  v_tier_limit  INT;
BEGIN
  -- Lock the row for update to make the check+increment atomic.
  SELECT id, tier, daily_count, daily_reset_at
  INTO   v_id, v_tier, v_daily_count, v_reset_at
  FROM   api_keys
  WHERE  key_hash     = p_hash
    AND  revoked_at   IS NULL
    AND  (expires_at  IS NULL OR expires_at > now())
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid');
  END IF;

  -- Resolve tier limit.
  IF v_tier = 'researcher' THEN
    v_tier_limit := 1000;
  ELSIF v_tier = 'institution' THEN
    v_tier_limit := -1;  -- unlimited
  ELSE
    v_tier_limit := 100;
  END IF;

  -- Reset daily counter if the reset date is in the past.
  IF v_reset_at < CURRENT_DATE THEN
    UPDATE api_keys
    SET
      daily_count    = 1,
      daily_reset_at = CURRENT_DATE,
      request_count  = request_count + 1,
      last_used_at   = now()
    WHERE id = v_id;

    IF v_tier_limit = -1 THEN
      RETURN jsonb_build_object('allowed', true, 'tier', v_tier, 'remaining', -1);
    END IF;
    RETURN jsonb_build_object('allowed', true, 'tier', v_tier, 'remaining', v_tier_limit - 1);
  END IF;

  -- Check limit (unlimited tiers always pass).
  IF v_tier_limit <> -1 AND v_daily_count >= v_tier_limit THEN
    RETURN jsonb_build_object(
      'allowed',    false,
      'reason',     'rate_limit',
      'tier',       v_tier,
      'remaining',  0
    );
  END IF;

  -- Increment and return updated remaining.
  UPDATE api_keys
  SET
    daily_count   = daily_count + 1,
    request_count = request_count + 1,
    last_used_at  = now()
  WHERE id = v_id;

  IF v_tier_limit = -1 THEN
    RETURN jsonb_build_object('allowed', true, 'tier', v_tier, 'remaining', -1);
  END IF;
  RETURN jsonb_build_object(
    'allowed',   true,
    'tier',      v_tier,
    'remaining', v_tier_limit - v_daily_count - 1
  );
END;
$$;

-- ── check_free_tier_usage ─────────────────────────────────────────────────────
-- Atomic IP-based free-tier check + increment.
-- Returns:
--   {"allowed": true,  "remaining": N}
--   {"allowed": false, "remaining": 0}

CREATE OR REPLACE FUNCTION check_free_tier_usage(p_ip TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count INTO v_count
  FROM   rate_limit_free
  WHERE  ip = p_ip AND date = CURRENT_DATE;

  IF FOUND AND v_count >= 100 THEN
    RETURN jsonb_build_object('allowed', false, 'remaining', 0);
  END IF;

  INSERT INTO rate_limit_free (ip, date, count)
  VALUES (p_ip, CURRENT_DATE, 1)
  ON CONFLICT (ip, date)
  DO UPDATE SET count = rate_limit_free.count + 1
  RETURNING count INTO v_count;

  RETURN jsonb_build_object('allowed', true, 'remaining', 100 - v_count);
END;
$$;

-- ── Backward-compatible wrapper ───────────────────────────────────────────────
-- Any code still calling increment_api_key_usage continues to work; it just
-- triggers the new atomic function and discards the JSONB result.

CREATE OR REPLACE FUNCTION increment_api_key_usage(p_hash TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT check_and_increment_api_key(p_hash);
$$;
