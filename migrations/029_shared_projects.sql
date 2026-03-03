-- Public shareable project dashboards
CREATE TABLE shared_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  share_token VARCHAR(32) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  visible_metrics JSONB NOT NULL DEFAULT '{"totalEvents":true,"uniqueUsers":true,"sessions":true,"crashes":true,"mrr":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One share per project
CREATE UNIQUE INDEX idx_shared_projects_project ON shared_projects(project_id);

-- Fast public token lookups
CREATE INDEX idx_shared_projects_token ON shared_projects(share_token) WHERE is_active = true;
