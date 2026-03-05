-- ShareMRR cards — public shareable MRR revenue cards
-- Credentials are encrypted with AES-256-GCM, metrics are fetched live from RevenueCat
CREATE TABLE IF NOT EXISTS sharemrr_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(16) UNIQUE NOT NULL,
  revenuecat_credentials TEXT NOT NULL,
  style_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  app_name VARCHAR(255) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sharemrr_cards_token ON sharemrr_cards(token);
