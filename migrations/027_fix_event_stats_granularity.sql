-- Fix eventsOverTime granularity in both get_project_event_stats and
-- get_global_event_stats_filtered. Previously get_project_event_stats always
-- used monthly bucketing and get_global_event_stats_filtered always used daily,
-- regardless of date range. Now both use dynamic granularity:
-- ≤2 days → hourly, ≤8 days → daily, ≤91 days → weekly, else → monthly.

CREATE OR REPLACE FUNCTION get_project_event_stats(
  p_project_id UUID,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  overview_json JSON;
  top_events_json JSON;
  events_over_time_json JSON;
  date_range_days INTEGER;
  granularity TEXT;
BEGIN
  -- Determine date range in days
  IF start_date IS NOT NULL AND end_date IS NOT NULL THEN
    date_range_days := CEIL(EXTRACT(EPOCH FROM (end_date - start_date)) / 86400) + 1;
  ELSIF start_date IS NOT NULL THEN
    date_range_days := CEIL(EXTRACT(EPOCH FROM (NOW() - start_date)) / 86400) + 1;
  ELSE
    date_range_days := 0;
  END IF;

  -- Determine granularity (matches frontend/backend JS logic)
  IF date_range_days = 0 THEN
    granularity := 'monthly';
  ELSIF date_range_days <= 2 THEN
    granularity := 'hourly';
  ELSIF date_range_days <= 8 THEN
    granularity := 'daily';
  ELSIF date_range_days <= 91 THEN
    granularity := 'weekly';
  ELSE
    granularity := 'monthly';
  END IF;

  -- Overview counts
  SELECT json_build_object(
    'total_events', COUNT(*),
    'unique_users', COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL),
    'unique_sessions', COUNT(DISTINCT session_id),
    'unique_devices', COUNT(DISTINCT anonymous_id)
  ) INTO overview_json
  FROM events e
  WHERE e.project_id = p_project_id
    AND (start_date IS NULL OR e.created_at >= start_date)
    AND (end_date IS NULL OR e.created_at <= end_date);

  -- Top events
  SELECT COALESCE(json_agg(
    json_build_object('event_name', sub.event_name, 'count', sub.cnt)
    ORDER BY sub.cnt DESC
  ), '[]'::json)
  INTO top_events_json
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
  ) sub;

  -- eventsOverTime with dynamic granularity
  IF granularity = 'hourly' THEN
    SELECT COALESCE(json_agg(
      json_build_object('hour', TO_CHAR(bucket, 'HH24:00'), 'count', cnt)
      ORDER BY bucket
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        DATE_TRUNC('hour', e.created_at) as bucket,
        COUNT(*) as cnt
      FROM events e
      WHERE e.project_id = p_project_id
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY bucket
      ORDER BY bucket
    ) by_hour;

  ELSIF granularity = 'daily' THEN
    SELECT COALESCE(json_agg(
      json_build_object('hour', day_name, 'count', cnt)
      ORDER BY day_num
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        TO_CHAR(e.created_at, 'Dy') as day_name,
        EXTRACT(DOW FROM e.created_at) as day_num,
        COUNT(*) as cnt
      FROM events e
      WHERE e.project_id = p_project_id
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY day_name, day_num
      ORDER BY day_num
    ) by_day;

  ELSIF granularity = 'weekly' THEN
    SELECT COALESCE(json_agg(
      json_build_object('hour', 'Week ' || week_num::TEXT, 'count', cnt)
      ORDER BY week_num
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        (FLOOR(EXTRACT(EPOCH FROM (e.created_at - COALESCE(start_date, e.created_at))) / (7 * 86400)) + 1)::INTEGER as week_num,
        COUNT(*) as cnt
      FROM events e
      WHERE e.project_id = p_project_id
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY week_num
      ORDER BY week_num
    ) by_week;

  ELSE
    -- monthly
    SELECT COALESCE(json_agg(
      json_build_object('hour', TO_CHAR(bucket, 'Mon'), 'count', cnt)
      ORDER BY bucket
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        DATE_TRUNC('month', e.created_at) as bucket,
        COUNT(*) as cnt
      FROM events e
      WHERE e.project_id = p_project_id
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY bucket
      ORDER BY bucket
    ) by_month;
  END IF;

  -- Build final result
  result := json_build_object(
    'overview', overview_json,
    'topEvents', top_events_json,
    'eventsOverTime', events_over_time_json
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql;


-- Also fix get_global_event_stats_filtered (used when no project is selected)
-- Previously always used daily granularity regardless of date range.

CREATE OR REPLACE FUNCTION get_global_event_stats_filtered(
  project_ids UUID[] DEFAULT NULL,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  overview_json JSON;
  top_events_json JSON;
  events_over_time_json JSON;
  date_range_days INTEGER;
  granularity TEXT;
BEGIN
  -- Determine date range in days
  IF start_date IS NOT NULL AND end_date IS NOT NULL THEN
    date_range_days := CEIL(EXTRACT(EPOCH FROM (end_date - start_date)) / 86400) + 1;
  ELSIF start_date IS NOT NULL THEN
    date_range_days := CEIL(EXTRACT(EPOCH FROM (NOW() - start_date)) / 86400) + 1;
  ELSE
    date_range_days := 0;
  END IF;

  -- Determine granularity
  IF date_range_days = 0 THEN
    granularity := 'monthly';
  ELSIF date_range_days <= 2 THEN
    granularity := 'hourly';
  ELSIF date_range_days <= 8 THEN
    granularity := 'daily';
  ELSIF date_range_days <= 91 THEN
    granularity := 'weekly';
  ELSE
    granularity := 'monthly';
  END IF;

  -- Overview counts
  SELECT json_build_object(
    'total_events', COUNT(*),
    'unique_users', COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL),
    'unique_sessions', COUNT(DISTINCT session_id),
    'unique_devices', COUNT(DISTINCT anonymous_id)
  ) INTO overview_json
  FROM events e
  WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
    AND (start_date IS NULL OR e.created_at >= start_date)
    AND (end_date IS NULL OR e.created_at <= end_date);

  -- Top events
  SELECT COALESCE(json_agg(
    json_build_object('event_name', sub.event_name, 'count', sub.cnt)
    ORDER BY sub.cnt DESC
  ), '[]'::json)
  INTO top_events_json
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
  ) sub;

  -- eventsOverTime with dynamic granularity
  IF granularity = 'hourly' THEN
    SELECT COALESCE(json_agg(
      json_build_object('hour', TO_CHAR(bucket, 'HH24:00'), 'count', cnt)
      ORDER BY bucket
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        DATE_TRUNC('hour', e.created_at) as bucket,
        COUNT(*) as cnt
      FROM events e
      WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY bucket
      ORDER BY bucket
    ) by_hour;

  ELSIF granularity = 'daily' THEN
    SELECT COALESCE(json_agg(
      json_build_object('hour', day_name, 'count', cnt)
      ORDER BY day_num
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        TO_CHAR(e.created_at, 'Dy') as day_name,
        EXTRACT(DOW FROM e.created_at) as day_num,
        COUNT(*) as cnt
      FROM events e
      WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY day_name, day_num
      ORDER BY day_num
    ) by_day;

  ELSIF granularity = 'weekly' THEN
    SELECT COALESCE(json_agg(
      json_build_object('hour', 'Week ' || week_num::TEXT, 'count', cnt)
      ORDER BY week_num
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        (FLOOR(EXTRACT(EPOCH FROM (e.created_at - COALESCE(start_date, e.created_at))) / (7 * 86400)) + 1)::INTEGER as week_num,
        COUNT(*) as cnt
      FROM events e
      WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY week_num
      ORDER BY week_num
    ) by_week;

  ELSE
    -- monthly
    SELECT COALESCE(json_agg(
      json_build_object('hour', TO_CHAR(bucket, 'Mon'), 'count', cnt)
      ORDER BY bucket
    ), '[]'::json) INTO events_over_time_json
    FROM (
      SELECT
        DATE_TRUNC('month', e.created_at) as bucket,
        COUNT(*) as cnt
      FROM events e
      WHERE (project_ids IS NULL OR array_length(project_ids, 1) IS NULL OR e.project_id = ANY(project_ids))
        AND (start_date IS NULL OR e.created_at >= start_date)
        AND (end_date IS NULL OR e.created_at <= end_date)
      GROUP BY bucket
      ORDER BY bucket
    ) by_month;
  END IF;

  -- Build final result
  result := json_build_object(
    'overview', overview_json,
    'topEvents', top_events_json,
    'eventsOverTime', events_over_time_json
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql;
