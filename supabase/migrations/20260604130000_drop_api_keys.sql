-- Drop the unused api_keys table and supporting objects.
-- This infrastructure was planned for a subscription/API-key revenue model
-- that was abandoned on 2026-05-27. Dartabase is free for all users; the
-- only revenue stream is gallery featured listings. No code ever used this
-- table, so there is no data to migrate.

DROP FUNCTION IF EXISTS increment_api_key_usage(TEXT);
DROP TABLE IF EXISTS api_keys;
