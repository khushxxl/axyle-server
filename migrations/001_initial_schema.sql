-- Initial database schema for Expo Analytics API

-- Projects/Apps table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  environment VARCHAR(10) DEFAULT 'prod',
  base_url VARCHAR(255),
  debug BOOLEAN DEFAULT false,
  max_queue_size INT DEFAULT 100,
  flush_interval INT DEFAULT 10000,
  session_timeout INT DEFAULT 1800000,
  total_events BIGINT DEFAULT 0,
  last_event_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API Keys table (for authentication)
CREATE TABLE IF NOT EXISTS api_keys ( 
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(255) PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Event data
  event_name VARCHAR(255) NOT NULL,
  properties JSONB,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- User identification
  user_id VARCHAR(255),
  anonymous_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  
  -- Denormalized context (for query performance)
  app_name VARCHAR(255),
  app_version VARCHAR(50),
  app_build VARCHAR(50),
  app_namespace VARCHAR(255),
  
  device_type VARCHAR(20),
  device_model VARCHAR(100),
  device_manufacturer VARCHAR(100),
  device_brand VARCHAR(100),
  
  os_name VARCHAR(50),
  os_version VARCHAR(50),
  
  screen_width INT,
  screen_height INT,
  screen_density DECIMAL(5,2),
  
  locale VARCHAR(10),
  timezone VARCHAR(50),
  
  environment VARCHAR(10),
  schema_version VARCHAR(20),
  
  -- Full context as JSONB for flexibility
  context JSONB
);

-- Indexes for events table
CREATE INDEX IF NOT EXISTS idx_events_project_timestamp ON events(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_anonymous_id ON events(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_environment ON events(environment);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id VARCHAR(255),
  anonymous_id VARCHAR(255) NOT NULL,
  
  start_time BIGINT NOT NULL,
  end_time BIGINT,
  duration_ms BIGINT,
  
  total_events INT DEFAULT 0,
  first_event_name VARCHAR(255),
  last_event_name VARCHAR(255),
  
  device_type VARCHAR(20),
  os_name VARCHAR(50),
  app_version VARCHAR(50),
  environment VARCHAR(10),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_anonymous_id ON sessions(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time DESC);

-- Platform tokens (for SDK config endpoint)
CREATE TABLE IF NOT EXISTS platform_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_tokens_token ON platform_tokens(token);

-- App users (for linking user IDs to projects)
CREATE TABLE IF NOT EXISTS app_users (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_users_project ON app_users(project_id);
CREATE INDEX IF NOT EXISTS idx_app_users_user ON app_users(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for projects table
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for sessions table
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

