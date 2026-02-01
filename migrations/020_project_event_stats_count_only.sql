-- Per-project event stats using SQL aggregations only (no row fetch)
-- Fixes dashboard showing 1,000 events when project has 3k+ (PostgREST default limit was capping rows)

CREATE OR REPLACE FUNCTION get_project_event_stats(
  p_project_id UUID,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
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
        FROM events e
        WHERE e.project_id = p_project_id
          AND (start_date IS NULL OR e.created_at >= start_date)
          AND (end_date IS NULL OR e.created_at <= end_date)
          AND event_name IS NOT NULL
        GROUP BY event_name
        ORDER BY cnt DESC
        LIMIT 20
      ) sub
    ), '[]'::json),
    'eventsOverTime', COALESCE((
      SELECT json_agg(
        json_build_object(
          'hour', TO_CHAR(bucket, 'Mon'),
          'count', cnt
        )
        ORDER BY bucket
      )
      FROM (
        SELECT 
          DATE_TRUNC('month', created_at) as bucket,
          COUNT(*) as cnt
        FROM events e
        WHERE e.project_id = p_project_id
          AND (start_date IS NULL OR e.created_at >= start_date)
          AND (end_date IS NULL OR e.created_at <= end_date)
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY bucket
      ) by_month
    ), '[]'::json)
  ) INTO result
  FROM events e
  WHERE e.project_id = p_project_id
    AND (start_date IS NULL OR e.created_at >= start_date)
    AND (end_date IS NULL OR e.created_at <= end_date);
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;
