-- Flagged Events table
-- Allows users to flag specific events to track their stats over time

CREATE TABLE IF NOT EXISTS flagged_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  label VARCHAR(255),
  flagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Unique constraint: one flag per user per event per project (or global if project_id is null)
  UNIQUE(user_id, event_name, project_id)
);

-- Indexes for flagged_events table
CREATE INDEX IF NOT EXISTS idx_flagged_events_user_id ON flagged_events(user_id);
CREATE INDEX IF NOT EXISTS idx_flagged_events_project_id ON flagged_events(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flagged_events_event_name ON flagged_events(event_name);
CREATE INDEX IF NOT EXISTS idx_flagged_events_user_project ON flagged_events(user_id, project_id);

-- Trigger for updated_at timestamp
CREATE TRIGGER update_flagged_events_updated_at BEFORE UPDATE ON flagged_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE flagged_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own flagged events
CREATE POLICY "Users can view own flagged events"
  ON flagged_events FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own flagged events
CREATE POLICY "Users can insert own flagged events"
  ON flagged_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own flagged events
CREATE POLICY "Users can update own flagged events"
  ON flagged_events FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own flagged events
CREATE POLICY "Users can delete own flagged events"
  ON flagged_events FOR DELETE
  USING (auth.uid() = user_id);

