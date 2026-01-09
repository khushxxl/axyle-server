-- Fix VARCHAR length constraints that are too restrictive
-- This migration increases field sizes to accommodate longer values

-- Increase environment field size in projects table
ALTER TABLE projects 
  ALTER COLUMN environment TYPE VARCHAR(50);

-- Increase environment field size in events table
ALTER TABLE events 
  ALTER COLUMN environment TYPE VARCHAR(50);

-- Increase locale field size (e.g., "en-US" is 5 chars, but some locales can be longer)
ALTER TABLE events 
  ALTER COLUMN locale TYPE VARCHAR(20);

-- Increase environment field size in sessions table
ALTER TABLE sessions 
  ALTER COLUMN environment TYPE VARCHAR(50);

