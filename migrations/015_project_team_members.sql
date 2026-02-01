-- Project team members table
-- Allows multiple users to collaborate on projects based on subscription tier

-- Team member roles
CREATE TYPE team_member_role AS ENUM ('owner', 'member');

-- Project team members table
CREATE TABLE IF NOT EXISTS project_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role team_member_role NOT NULL DEFAULT 'member',
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure unique user per project
  UNIQUE(project_id, user_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_team_members_project ON project_team_members(project_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON project_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_role ON project_team_members(project_id, role);

-- Function to get team member count for a project
CREATE OR REPLACE FUNCTION get_project_team_count(p_project_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM project_team_members
    WHERE project_id = p_project_id
  );
END;
$$ LANGUAGE plpgsql;

-- Function to check if user can add team members based on subscription
CREATE OR REPLACE FUNCTION can_add_team_member(p_user_id UUID, p_project_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_subscription_plan VARCHAR(50);
  v_current_count INTEGER;
  v_max_members INTEGER;
BEGIN
  -- Get user's subscription plan
  SELECT subscription_plan INTO v_subscription_plan
  FROM users
  WHERE id = p_user_id;
  
  -- Get current team member count
  v_current_count := get_project_team_count(p_project_id);
  
  -- Determine max members based on plan
  -- free: 1 (owner only), pro: 4 (owner + 3), business: 11 (owner + 10)
  CASE v_subscription_plan
    WHEN 'free' THEN v_max_members := 1;
    WHEN 'pro' THEN v_max_members := 4;
    WHEN 'business' THEN v_max_members := 11;
    ELSE v_max_members := 1;
  END CASE;
  
  RETURN v_current_count < v_max_members;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically add project creator as owner
CREATE OR REPLACE FUNCTION add_project_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO project_team_members (project_id, user_id, role, invited_by)
  VALUES (NEW.id, NEW.user_id, 'owner', NEW.user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to add owner when project is created
DROP TRIGGER IF EXISTS on_project_created ON projects;
CREATE TRIGGER on_project_created
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION add_project_owner();

-- Row Level Security
ALTER TABLE project_team_members ENABLE ROW LEVEL SECURITY;

-- Users can view team members of projects they belong to
CREATE POLICY "Users can view team members of their projects"
  ON project_team_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_team_members ptm
      WHERE ptm.project_id = project_team_members.project_id
      AND ptm.user_id = auth.uid()
    )
  );

-- Only owners can add team members
CREATE POLICY "Owners can add team members"
  ON project_team_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_team_members ptm
      WHERE ptm.project_id = project_team_members.project_id
      AND ptm.user_id = auth.uid()
      AND ptm.role = 'owner'
    )
  );

-- Only owners can remove team members
CREATE POLICY "Owners can remove team members"
  ON project_team_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM project_team_members ptm
      WHERE ptm.project_id = project_team_members.project_id
      AND ptm.user_id = auth.uid()
      AND ptm.role = 'owner'
    )
  );

-- Update projects table to add owner_id for clarity (optional, user_id already exists)
-- Add index on user_id for projects
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
