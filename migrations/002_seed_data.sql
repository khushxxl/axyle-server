-- Seed data for development/testing
-- WARNING: Only use in development environment!

-- Insert a test project
INSERT INTO projects (id, user_id, name, environment, debug)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'Test Project',
  'dev',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Insert a test API key for the test project
INSERT INTO api_keys (id, project_id, key, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '550e8400-e29b-41d4-a716-446655440000',
  true
)
ON CONFLICT (key) DO NOTHING;

-- Insert a test platform token
INSERT INTO platform_tokens (id, user_id, token, expires_at)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'test-platform-token-12345',
  NOW() + INTERVAL '1 year'
)
ON CONFLICT (token) DO NOTHING;

