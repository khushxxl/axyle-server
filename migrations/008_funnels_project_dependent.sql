-- Migration to make funnels project-dependent instead of user-dependent
-- This aligns funnels with segments, events, and other project-scoped resources

-- Step 1: Update existing funnels to have a project_id if they don't have one
-- For funnels without project_id, we'll need to assign them to a project
-- This assumes the user has at least one project. If not, those funnels will be orphaned.
UPDATE funnels
SET project_id = (
  SELECT id FROM projects 
  WHERE projects.user_id = funnels.user_id 
  LIMIT 1
)
WHERE project_id IS NULL;

-- Step 2: Delete funnels that can't be assigned to a project (orphaned)
DELETE FROM funnels
WHERE project_id IS NULL;

-- Step 3: Drop the user_id column and make project_id required
ALTER TABLE funnels
  DROP COLUMN IF EXISTS user_id,
  ALTER COLUMN project_id SET NOT NULL;

-- Step 4: Drop the user_id index (no longer needed)
DROP INDEX IF EXISTS idx_funnels_user;

-- Step 5: Update the primary index to focus on project_id
-- The existing idx_funnels_project index is sufficient

-- Note: The foreign key constraint on project_id already exists and will cascade delete
-- when a project is deleted, which is the desired behavior

