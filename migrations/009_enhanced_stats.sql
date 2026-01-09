-- Enhanced stats migration: Add eventsOverTime, trends, and session time calculations

-- Update function to include eventsOverTime (last 7 days by day)
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
    ), '[]'::json),
    'eventsOverTime', COALESCE((
      SELECT json_agg(
        json_build_object(
          'hour', TO_CHAR(day, 'Dy'),
          'count', cnt
        )
      )
      FROM (
        SELECT 
          DATE_TRUNC('day', created_at) as day,
          COUNT(*) as cnt
        FROM events
        WHERE CASE 
          WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
          THEN true
          ELSE project_id = ANY(project_ids)
        END
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY day
      ) daily
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

-- Function to get trend data (current period vs previous period)
CREATE OR REPLACE FUNCTION get_event_trends(project_ids UUID[] DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  result JSON;
  project_filter TEXT;
  current_start TIMESTAMP;
  current_end TIMESTAMP;
  previous_start TIMESTAMP;
  previous_end TIMESTAMP;
BEGIN
  -- Calculate date ranges: current week (last 7 days) vs previous week (7-14 days ago)
  current_end := NOW();
  current_start := NOW() - INTERVAL '7 days';
  previous_end := NOW() - INTERVAL '7 days';
  previous_start := NOW() - INTERVAL '14 days';

  -- Build filter condition
  IF project_ids IS NULL OR array_length(project_ids, 1) IS NULL THEN
    project_filter := 'true';
  ELSE
    project_filter := 'project_id = ANY($1)';
  END IF;

  SELECT json_build_object(
    'total_events', json_build_object(
      'current', COALESCE((
        SELECT COUNT(*)
        FROM events
        WHERE CASE 
          WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
          THEN true
          ELSE project_id = ANY(project_ids)
        END
          AND created_at >= current_start AND created_at < current_end
      ), 0),
      'previous', COALESCE((
        SELECT COUNT(*)
        FROM events
        WHERE CASE 
          WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
          THEN true
          ELSE project_id = ANY(project_ids)
        END
          AND created_at >= previous_start AND created_at < previous_end
      ), 0)
    ),
    'unique_users', json_build_object(
      'current', COALESCE((
        SELECT COUNT(DISTINCT user_id)
        FROM events
        WHERE CASE 
          WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
          THEN true
          ELSE project_id = ANY(project_ids)
        END
          AND created_at >= current_start AND created_at < current_end
          AND user_id IS NOT NULL
      ), 0),
      'previous', COALESCE((
        SELECT COUNT(DISTINCT user_id)
        FROM events
        WHERE CASE 
          WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
          THEN true
          ELSE project_id = ANY(project_ids)
        END
          AND created_at >= previous_start AND created_at < previous_end
          AND user_id IS NOT NULL
      ), 0)
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to get average session time
CREATE OR REPLACE FUNCTION get_average_session_time(project_ids UUID[] DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  result JSON;
  avg_duration_ms BIGINT;
BEGIN
  IF project_ids IS NULL OR array_length(project_ids, 1) IS NULL THEN
    SELECT AVG(duration_ms) INTO avg_duration_ms
    FROM sessions
    WHERE duration_ms IS NOT NULL
      AND duration_ms > 0
      AND start_time >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 days')) * 1000;
  ELSE
    SELECT AVG(duration_ms) INTO avg_duration_ms
    FROM sessions
    WHERE project_id = ANY(project_ids)
      AND duration_ms IS NOT NULL
      AND duration_ms > 0
      AND start_time >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 days')) * 1000;
  END IF;

  SELECT json_build_object(
    'average_duration_ms', COALESCE(avg_duration_ms, 0),
    'average_duration_seconds', COALESCE(ROUND(avg_duration_ms / 1000.0), 0)
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

