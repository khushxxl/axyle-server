-- Migration to add RevenueCat integration fields to projects table
-- RevenueCat integration is optional - users can add their RevenueCat credentials to fetch revenue metrics

-- Add RevenueCat fields to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS revenuecat_secret_key TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS revenuecat_project_id VARCHAR(255);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS revenuecat_enabled BOOLEAN DEFAULT false;

-- Index for querying projects with RevenueCat enabled
CREATE INDEX IF NOT EXISTS idx_projects_revenuecat_enabled ON projects(revenuecat_enabled) WHERE revenuecat_enabled = true;

-- Add comment explaining the fields
COMMENT ON COLUMN projects.revenuecat_secret_key IS 'RevenueCat API secret key (encrypted) - optional integration';
COMMENT ON COLUMN projects.revenuecat_project_id IS 'RevenueCat project ID - optional integration';
COMMENT ON COLUMN projects.revenuecat_enabled IS 'Whether RevenueCat integration is enabled for this project';
