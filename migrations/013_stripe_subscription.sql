-- Stripe subscription fields on users for webhook sync.
-- Requires: public.users exists (e.g. from 007_users_onboarding.sql).
-- The webhook updates: subscription_status, subscription_plan, stripe_customer_id,
-- stripe_subscription_id, current_period_end. subscription_status/subscription_plan
-- are created in 007; this migration adds the Stripe linkage + period end.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP;

-- If users was created without 007, ensure subscription columns exist for webhook updates
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50) DEFAULT 'free';

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_subscription_plan ON users(subscription_plan);
