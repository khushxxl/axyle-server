-- Add TrustMRR as a second data source for ShareMRR cards
ALTER TABLE sharemrr_cards
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'revenuecat',
  ADD COLUMN trustmrr_slug VARCHAR(255);

-- Allow revenuecat_credentials to be null (TrustMRR cards don't have them)
ALTER TABLE sharemrr_cards ALTER COLUMN revenuecat_credentials DROP NOT NULL;
