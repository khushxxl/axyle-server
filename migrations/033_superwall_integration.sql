-- Superwall Integration
-- Adds columns to store Superwall API credentials and selected project/application

ALTER TABLE projects
  ADD COLUMN superwall_api_key TEXT,
  ADD COLUMN superwall_project_id TEXT,
  ADD COLUMN superwall_application_id TEXT,
  ADD COLUMN superwall_project_name TEXT,
  ADD COLUMN superwall_application_name TEXT,
  ADD COLUMN superwall_enabled BOOLEAN DEFAULT false;

CREATE INDEX idx_projects_superwall_enabled ON projects (superwall_enabled) WHERE superwall_enabled = true;
