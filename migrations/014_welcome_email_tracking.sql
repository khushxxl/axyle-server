-- Add welcome email tracking to users table
-- This allows us to track whether a welcome email has been sent

ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMP;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_users_welcome_email_sent ON users(welcome_email_sent);

-- Function to send welcome email notification
-- This function will be called by the trigger and can notify the API
CREATE OR REPLACE FUNCTION notify_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Send a notification that a new user was created
  -- This can be picked up by the API or a worker process
  PERFORM pg_notify('new_user_created', json_build_object(
    'user_id', NEW.id,
    'created_at', NEW.created_at
  )::text);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to notify when a new user is created
DROP TRIGGER IF EXISTS on_new_user_notify ON users;
CREATE TRIGGER on_new_user_notify
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_user();
