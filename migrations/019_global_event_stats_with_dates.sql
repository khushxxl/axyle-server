-- Add date-filtered global event stats (count-only, no full row fetch)
-- Use this when dashboard requests stats with startDate/endDate so we never pull all event rows

CREATE OR REPLACE FUNCTION get_global_event_stats_filtered(
  project_ids UUID[] DEFAULT NULL,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  date_filter TEXT := 'true';
BEGIN
  -- Build date filter
  IF start_date IS NOT NULL AND end_date IS NOT NULL THEN
    date_filter := 'created_at >= $2 AND created_at <= $3';
  ELSIF start_date IS NOT NULL THEN
    date_filter := 'created_at >= $2';
  ELSIF end_date IS NOT NULL THEN
    date_filter := 'created_at <= $2';
  END IF;

  -- Get stats using SQL aggregations only (no full row fetch)
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
        WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
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
          'hour', TO_CHAR(day, 'Dy'),
          'count', cnt
        )
        ORDER BY day
      )
      FROM (
        SELECT 
          DATE_TRUNC('day', created_at) as day,
          COUNT(*) as cnt
        FROM events e
        WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
          AND (start_date IS NULL OR e.created_at >= start_date)
          AND (end_date IS NULL OR e.created_at <= end_date)
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY day
      ) daily
    ), '[]'::json)
  ) INTO result
  FROM events e
  WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
    AND (start_date IS NULL OR e.created_at >= start_date)
    AND (end_date IS NULL OR e.created_at <= end_date);
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;
