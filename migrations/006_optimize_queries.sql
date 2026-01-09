-- Optimization migration: Add database functions and indexes for better performance

-- Function to get global event stats efficiently using SQL aggregations
CREATE OR REPLACE FUNCTION get_global_event_stats(project_ids UUID[] DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  result JSON;
  project_filter TEXT;
BEGIN
  -- Build filter condition
  IF project_ids IS NULL OR array_length(project_ids, 1) IS NULL THEN
    project_filter := 'true';
  ELSE
    project_filter := 'project_id = ANY($1)';
  END IF;

  -- Get stats using SQL aggregations (much faster than fetching all rows)
  SELECT json_build_object(
    'overview', json_build_object(
      'total_events', COUNT(*),
      'unique_users', COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL),
      'unique_sessions', COUNT(DISTINCT session_id),
      'unique_devices', COUNT(DISTINCT anonymous_id)
    ),
    'topEvents', COALESCE((
      SELECT json_agg(json_build_object('event_name', event_name, 'count', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT event_name, COUNT(*) as cnt
        FROM events
        WHERE CASE 
          WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
          THEN true
          ELSE project_id = ANY(project_ids)
        END
          AND event_name IS NOT NULL
        GROUP BY event_name
        ORDER BY cnt DESC
        LIMIT 20
      ) sub
    ), '[]'::json)
  ) INTO result
  FROM events
  WHERE CASE 
    WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
    THEN true
    ELSE project_id = ANY(project_ids)
  END;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Composite indexes for common query patterns
-- Index for project + timestamp queries (most common)
CREATE INDEX IF NOT EXISTS idx_events_project_timestamp_created 
ON events(project_id, timestamp DESC, created_at DESC);

-- Index for stats queries (event name counting)
CREATE INDEX IF NOT EXISTS idx_events_project_name 
ON events(project_id, event_name) 
WHERE event_name IS NOT NULL;

-- Partial index for user events
CREATE INDEX IF NOT EXISTS idx_events_project_user 
ON events(project_id, user_id) 
WHERE user_id IS NOT NULL;

-- Index for session queries
CREATE INDEX IF NOT EXISTS idx_events_project_session 
ON events(project_id, session_id);

-- Index for anonymous_id queries
CREATE INDEX IF NOT EXISTS idx_events_project_anonymous 
ON events(project_id, anonymous_id);

