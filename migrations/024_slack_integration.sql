-- Migration to add Slack integration fields to projects table
-- Slack integration sends notifications via Incoming Webhooks for payment events, crashes, and quota warnings

-- Add Slack fields to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slack_enabled BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slack_notify_payments BOOLEAN DEFAULT true;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slack_notify_crashes BOOLEAN DEFAULT true;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slack_notify_quota BOOLEAN DEFAULT true;

-- Index for querying projects with Slack enabled
CREATE INDEX IF NOT EXISTS idx_projects_slack_enabled ON projects(slack_enabled) WHERE slack_enabled = true;

-- Add comments explaining the fields
COMMENT ON COLUMN projects.slack_webhook_url IS 'Slack Incoming Webhook URL (encrypted) - optional integration';
COMMENT ON COLUMN projects.slack_enabled IS 'Whether Slack integration is enabled for this project';
COMMENT ON COLUMN projects.slack_notify_payments IS 'Whether to send Slack notifications for payment events (RevenueCat)';
COMMENT ON COLUMN projects.slack_notify_crashes IS 'Whether to send Slack notifications for app crashes/errors';
COMMENT ON COLUMN projects.slack_notify_quota IS 'Whether to send Slack notifications for event quota warnings';
