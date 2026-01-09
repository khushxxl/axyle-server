-- Funnels table for storing user-defined conversion funnels
CREATE TABLE IF NOT EXISTS funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,  -- Supabase user ID (from auth.users)
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  steps JSONB NOT NULL,  -- Array of event names: ["event1", "event2", ...]
  chart_type VARCHAR(20) DEFAULT 'funnel',  -- 'bar' | 'funnel' | 'area'
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_funnels_user ON funnels(user_id);
CREATE INDEX IF NOT EXISTS idx_funnels_project ON funnels(project_id);
CREATE INDEX IF NOT EXISTS idx_funnels_pinned ON funnels(pinned) WHERE pinned = true;

-- Trigger for updated_at
CREATE TRIGGER update_funnels_updated_at BEFORE UPDATE ON funnels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

