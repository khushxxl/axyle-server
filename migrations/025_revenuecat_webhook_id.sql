-- Add column to store the RevenueCat webhook integration ID
-- so we can delete it when the user disconnects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS revenuecat_webhook_integration_id TEXT;
