-- User Segments table
CREATE TABLE IF NOT EXISTS segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Segment type: 'static' (snapshot) or 'dynamic' (auto-updates)
  segment_type VARCHAR(20) DEFAULT 'dynamic',
  
  -- Criteria stored as JSON
  -- Structure: { conditions: [], logic: 'AND' | 'OR' }
  criteria JSONB NOT NULL DEFAULT '{"conditions": [], "logic": "AND"}',
  
  -- Cached segment size (updated periodically for dynamic segments)
  cached_size INT DEFAULT 0,
  last_calculated_at TIMESTAMP,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_segments_project ON segments(project_id);
CREATE INDEX IF NOT EXISTS idx_segments_type ON segments(segment_type);
CREATE INDEX IF NOT EXISTS idx_segments_active ON segments(is_active) WHERE is_active = true;

-- Segment users table (for caching segment membership)
CREATE TABLE IF NOT EXISTS segment_users (
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  anonymous_id VARCHAR(255),
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (segment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_segment_users_segment ON segment_users(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_users_user ON segment_users(user_id);

-- Trigger for segments table
CREATE TRIGGER update_segments_updated_at BEFORE UPDATE ON segments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

