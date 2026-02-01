-- Update eventsOverTime to use monthly granularity for "all time" queries
-- This provides better visualization when viewing all historical data

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
  -- eventsOverTime uses monthly granularity for all-time view
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
          'hour', TO_CHAR(month, 'Mon'),
          'count', cnt
        )
        ORDER BY month
      )
      FROM (
        SELECT 
          DATE_TRUNC('month', created_at) as month,
          COUNT(*) as cnt
        FROM events
        WHERE CASE 
          WHEN project_ids IS NULL OR array_length(project_ids, 1) IS NULL 
          THEN true
          ELSE project_id = ANY(project_ids)
        END
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month
      ) monthly
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
