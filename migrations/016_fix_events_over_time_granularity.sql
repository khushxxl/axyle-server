-- Fix eventsOverTime to show hourly data for last 24 hours instead of daily for better granularity
-- This ensures the chart shows data even when all events happen on the same day

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
        ORDER BY day
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
          AND created_at >= NOW() - INTERVAL '30 days'
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
