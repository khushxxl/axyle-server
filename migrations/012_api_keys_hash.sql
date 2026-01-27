-- Store API keys as SHA-256 hashes only. Plain keys are shown once at creation and never again.
-- Existing rows keep 'key' for backward compatibility; new keys use key_hash only.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_hash VARCHAR(64) UNIQUE;
ALTER TABLE api_keys ALTER COLUMN key DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash) WHERE is_active = true;

-- Optional: drop the unique constraint on key so we can have multiple rows with key=NULL
-- (PostgreSQL allows multiple NULLs in a UNIQUE column, so we're fine)
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the API key. Plain key is never stored.';
COMMENT ON COLUMN api_keys.key IS 'Deprecated: plain key for legacy rows only. New keys use key_hash.';
