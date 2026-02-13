-- Returns real event counts per project from the events table.
-- Used by listProjects to show accurate event totals.

CREATE OR REPLACE FUNCTION get_project_event_counts(project_ids UUID[])
RETURNS TABLE(project_id UUID, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT e.project_id, COUNT(*) as count
  FROM events e
  WHERE e.project_id = ANY(project_ids)
  GROUP BY e.project_id;
END;
$$ LANGUAGE plpgsql;
