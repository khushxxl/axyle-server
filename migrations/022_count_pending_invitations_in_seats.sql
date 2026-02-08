-- Update seat counting to include pending invitations
-- and fix can_add_team_member to use the project owner's plan

-- get_project_team_count now counts both actual members AND pending invitations
CREATE OR REPLACE FUNCTION get_project_team_count(p_project_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT (
      (SELECT COUNT(*) FROM project_team_members WHERE project_id = p_project_id)
      +
      (SELECT COUNT(*) FROM project_invitations
       WHERE project_id = p_project_id
       AND status = 'pending'
       AND expires_at > NOW())
    )::INTEGER
  );
END;
$$ LANGUAGE plpgsql;

-- can_add_team_member now uses the project OWNER's plan (not the requesting user's)
-- and plan limits match api/src/config/plan-limits.ts
CREATE OR REPLACE FUNCTION can_add_team_member(p_user_id UUID, p_project_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_subscription_plan VARCHAR(50);
  v_current_count INTEGER;
  v_max_members INTEGER;
BEGIN
  -- Get the project owner's subscription plan
  SELECT u.subscription_plan INTO v_subscription_plan
  FROM project_team_members ptm
  JOIN users u ON u.id = ptm.user_id
  WHERE ptm.project_id = p_project_id AND ptm.role = 'owner'
  LIMIT 1;

  -- Get current count (members + pending invitations)
  v_current_count := get_project_team_count(p_project_id);

  -- Determine max members based on owner's plan (matching plan-limits.ts)
  CASE v_subscription_plan
    WHEN 'free' THEN v_max_members := 1;
    WHEN 'starter' THEN v_max_members := 1;
    WHEN 'pro' THEN v_max_members := 5;
    WHEN 'scale' THEN v_max_members := 15;
    ELSE v_max_members := 1;
  END CASE;

  RETURN v_current_count < v_max_members;
END;
$$ LANGUAGE plpgsql;
