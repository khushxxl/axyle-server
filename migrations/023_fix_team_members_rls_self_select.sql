-- Fix: Allow users to see their own team memberships directly.
-- The existing SELECT policy is self-referencing (requires membership to view memberships),
-- which fails for newly-added members when queried via the anon key (e.g. in Next.js middleware).
-- RLS combines policies with OR, so this additional policy won't break the existing one.

CREATE POLICY "Users can view own memberships"
  ON project_team_members FOR SELECT
  USING (user_id = auth.uid());
