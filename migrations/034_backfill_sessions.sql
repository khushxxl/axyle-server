-- Backfill sessions table from existing events data
-- Computes session start/end times and duration from events grouped by session_id
-- Uses a CTE with DISTINCT ON to avoid duplicate session_id rows

WITH session_data AS (
  SELECT DISTINCT ON (e.session_id)
    e.session_id,
    e.project_id,
    agg.user_id,
    agg.anonymous_id,
    agg.start_time,
    agg.end_time,
    agg.duration_ms,
    agg.total_events,
    agg.first_event_name,
    agg.last_event_name,
    agg.device_type,
    agg.os_name,
    agg.app_version,
    agg.environment,
    agg.created_at
  FROM events e
  INNER JOIN (
    SELECT
      session_id,
      MAX(user_id) AS user_id,
      MAX(anonymous_id) AS anonymous_id,
      MIN(timestamp) AS start_time,
      MAX(timestamp) AS end_time,
      CASE
        WHEN MAX(timestamp) > MIN(timestamp) THEN MAX(timestamp) - MIN(timestamp)
        ELSE 0
      END AS duration_ms,
      COUNT(*) AS total_events,
      (ARRAY_AGG(event_name ORDER BY timestamp ASC))[1] AS first_event_name,
      (ARRAY_AGG(event_name ORDER BY timestamp DESC))[1] AS last_event_name,
      MAX(device_type) AS device_type,
      MAX(os_name) AS os_name,
      MAX(app_version) AS app_version,
      MAX(environment) AS environment,
      MIN(created_at) AS created_at
    FROM events
    WHERE session_id IS NOT NULL
    GROUP BY session_id
  ) agg ON agg.session_id = e.session_id
  WHERE e.session_id IS NOT NULL
  ORDER BY e.session_id, e.timestamp ASC
)
INSERT INTO sessions (
  session_id,
  project_id,
  user_id,
  anonymous_id,
  start_time,
  end_time,
  duration_ms,
  total_events,
  first_event_name,
  last_event_name,
  device_type,
  os_name,
  app_version,
  environment,
  created_at,
  updated_at
)
SELECT
  session_id,
  project_id,
  user_id,
  anonymous_id,
  start_time,
  end_time,
  duration_ms,
  total_events,
  first_event_name,
  last_event_name,
  device_type,
  os_name,
  app_version,
  environment,
  created_at,
  NOW() AS updated_at
FROM session_data
ON CONFLICT (session_id) DO UPDATE SET
  end_time = GREATEST(sessions.end_time, EXCLUDED.end_time),
  start_time = LEAST(sessions.start_time, EXCLUDED.start_time),
  duration_ms = GREATEST(sessions.end_time, EXCLUDED.end_time) - LEAST(sessions.start_time, EXCLUDED.start_time),
  total_events = EXCLUDED.total_events,
  last_event_name = EXCLUDED.last_event_name,
  updated_at = NOW();
