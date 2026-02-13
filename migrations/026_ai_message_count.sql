-- AI message usage tracking per calendar month
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_message_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_message_count_month VARCHAR(7) DEFAULT '';
