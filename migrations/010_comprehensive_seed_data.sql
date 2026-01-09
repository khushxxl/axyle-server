-- Comprehensive seed data for testing dashboard features
-- WARNING: Only use in development environment!
-- This seed data includes events, sessions, and projects spread over the last 14 days
-- to test trends, eventsOverTime, and session time calculations

-- First, ensure we have a test project (reuse existing or create new)
INSERT INTO projects (id, user_id, name, environment, debug, total_events)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '133e5b09-f708-4d6d-9159-ceb6eb224b75',
  'E-Commerce App',
  'prod',
  false,
  0
)
ON CONFLICT (id) DO UPDATE SET total_events = 0;

-- Create a second project for comparison
INSERT INTO projects (id, user_id, name, environment, debug, total_events)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '133e5b09-f708-4d6d-9159-ceb6eb224b75',
  'Mobile Game',
  'dev',
  true,
  0
)
ON CONFLICT (id) DO UPDATE SET total_events = 0;

-- Helper function to generate timestamps
DO $$
DECLARE
  project1_id UUID := '00000000-0000-0000-0000-000000000001';
  project2_id UUID := '00000000-0000-0000-0000-000000000002';
  base_timestamp BIGINT;
  event_timestamp BIGINT;
  created_at_ts TIMESTAMP;
  session_start BIGINT;
  session_end BIGINT;
  session_duration_ms BIGINT;
  i INT;
  day_offset INT;
  hour_offset INT;
  user_id_val VARCHAR;
  session_id_val VARCHAR;
  anonymous_id_val VARCHAR;
  event_id_val VARCHAR;
  event_count INT := 0;
BEGIN
  -- Generate events for the last 14 days (to test trends)
  -- Current week: last 7 days, Previous week: 7-14 days ago
  
  FOR day_offset IN 0..13 LOOP
    -- Create 3-8 events per day, with more events in recent days
    event_count := CASE 
      WHEN day_offset < 7 THEN 5 + (7 - day_offset) -- More events in recent days
      ELSE 3 + (13 - day_offset) -- Fewer events in older days
    END;
    
    FOR i IN 1..event_count LOOP
      -- Random hour in the day
      hour_offset := floor(random() * 24)::INT;
      created_at_ts := NOW() - (day_offset || ' days')::INTERVAL - (hour_offset || ' hours')::INTERVAL;
      base_timestamp := EXTRACT(EPOCH FROM created_at_ts)::BIGINT * 1000;
      
      -- Alternate between projects
      IF (day_offset + i) % 2 = 0 THEN
        -- Project 1: E-Commerce events
        user_id_val := 'user_' || (i % 10 + 1);
        session_id_val := 'session_' || (day_offset * 10 + i);
        anonymous_id_val := 'anon_' || (i % 20 + 1);
        event_id_val := 'event_' || project1_id || '_' || day_offset || '_' || i;
        
        -- Different event types for e-commerce
        INSERT INTO events (
          id, project_id, event_name, properties, timestamp, created_at,
          user_id, anonymous_id, session_id,
          app_name, device_type, os_name, environment
        ) VALUES (
          event_id_val,
          project1_id,
          CASE (i % 5)
            WHEN 0 THEN 'Product Viewed'
            WHEN 1 THEN 'Add to Cart'
            WHEN 2 THEN 'Checkout Started'
            WHEN 3 THEN 'Purchase Completed'
            ELSE 'Page Viewed'
          END,
          jsonb_build_object(
            'product_id', 'prod_' || (i % 50),
            'category', CASE (i % 4) WHEN 0 THEN 'Electronics' WHEN 1 THEN 'Clothing' WHEN 2 THEN 'Books' ELSE 'Home' END,
            'price', (random() * 200 + 10)::NUMERIC(10,2)
          ),
          base_timestamp,
          created_at_ts,
          user_id_val,
          anonymous_id_val,
          session_id_val,
          'E-Commerce App',
          CASE (i % 3) WHEN 0 THEN 'ios' WHEN 1 THEN 'android' ELSE 'web' END,
          CASE (i % 2) WHEN 0 THEN 'iOS 17.0' ELSE 'Android 14' END,
          'prod'
        );
      ELSE
        -- Project 2: Mobile Game events
        user_id_val := 'gamer_' || (i % 15 + 1);
        session_id_val := 'game_session_' || (day_offset * 10 + i);
        anonymous_id_val := 'game_anon_' || (i % 25 + 1);
        event_id_val := 'event_' || project2_id || '_' || day_offset || '_' || i;
        
        INSERT INTO events (
          id, project_id, event_name, properties, timestamp, created_at,
          user_id, anonymous_id, session_id,
          app_name, device_type, os_name, environment
        ) VALUES (
          event_id_val,
          project2_id,
          CASE (i % 6)
            WHEN 0 THEN 'Game Started'
            WHEN 1 THEN 'Level Completed'
            WHEN 2 THEN 'Achievement Unlocked'
            WHEN 3 THEN 'In-App Purchase'
            WHEN 4 THEN 'Ad Watched'
            ELSE 'Game Over'
          END,
          jsonb_build_object(
            'level', (i % 50 + 1),
            'score', (random() * 10000)::INT,
            'coins_earned', (random() * 100)::INT
          ),
          base_timestamp,
          created_at_ts,
          user_id_val,
          anonymous_id_val,
          session_id_val,
          'Mobile Game',
          CASE (i % 2) WHEN 0 THEN 'ios' ELSE 'android' END,
          CASE (i % 2) WHEN 0 THEN 'iOS 17.0' ELSE 'Android 14' END,
          'dev'
        );
      END IF;
    END LOOP;
  END LOOP;
  
  -- Create sessions with duration data (last 7 days)
  -- Sessions should have realistic durations (30 seconds to 30 minutes)
  FOR day_offset IN 0..6 LOOP
    FOR i IN 1..15 LOOP
      -- Random time in the day
      hour_offset := floor(random() * 24)::INT;
      created_at_ts := NOW() - (day_offset || ' days')::INTERVAL - (hour_offset || ' hours')::INTERVAL;
      session_start := EXTRACT(EPOCH FROM created_at_ts)::BIGINT * 1000;
      
      -- Session duration: 30 seconds to 30 minutes (in milliseconds)
      session_duration_ms := (30000 + random() * 1770000)::BIGINT;
      session_end := session_start + session_duration_ms;
      
      -- Alternate between projects
      IF (day_offset + i) % 2 = 0 THEN
        session_id_val := 'session_' || (day_offset * 10 + i);
        anonymous_id_val := 'anon_' || (i % 20 + 1);
        user_id_val := 'user_' || (i % 10 + 1);
        
        INSERT INTO sessions (
          session_id, project_id, user_id, anonymous_id,
          start_time, end_time, duration_ms,
          total_events, first_event_name, last_event_name,
          device_type, os_name, app_version, environment,
          created_at, updated_at
        ) VALUES (
          session_id_val,
          project1_id,
          user_id_val,
          anonymous_id_val,
          session_start,
          session_end,
          session_duration_ms,
          (2 + random() * 8)::INT, -- 2-10 events per session
          'Product Viewed',
          'Purchase Completed',
          CASE (i % 3) WHEN 0 THEN 'ios' WHEN 1 THEN 'android' ELSE 'web' END,
          CASE (i % 2) WHEN 0 THEN 'iOS 17.0' ELSE 'Android 14' END,
          '1.0.0',
          'prod',
          created_at_ts,
          created_at_ts + (session_duration_ms || ' milliseconds')::INTERVAL
        )
        ON CONFLICT (session_id) DO NOTHING;
      ELSE
        session_id_val := 'game_session_' || (day_offset * 10 + i);
        anonymous_id_val := 'game_anon_' || (i % 25 + 1);
        user_id_val := 'gamer_' || (i % 15 + 1);
        
        INSERT INTO sessions (
          session_id, project_id, user_id, anonymous_id,
          start_time, end_time, duration_ms,
          total_events, first_event_name, last_event_name,
          device_type, os_name, app_version, environment,
          created_at, updated_at
        ) VALUES (
          session_id_val,
          project2_id,
          user_id_val,
          anonymous_id_val,
          session_start,
          session_end,
          session_duration_ms,
          (3 + random() * 12)::INT, -- 3-15 events per session (games have more events)
          'Game Started',
          'Game Over',
          CASE (i % 2) WHEN 0 THEN 'ios' ELSE 'android' END,
          CASE (i % 2) WHEN 0 THEN 'iOS 17.0' ELSE 'Android 14' END,
          '2.1.0',
          'dev',
          created_at_ts,
          created_at_ts + (session_duration_ms || ' milliseconds')::INTERVAL
        )
        ON CONFLICT (session_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
  
  -- Update project total_events counts
  UPDATE projects 
  SET total_events = (
    SELECT COUNT(*) 
    FROM events 
    WHERE events.project_id = projects.id
  )
  WHERE id IN (project1_id, project2_id);
  
  RAISE NOTICE 'Seed data created: Events and sessions for last 14 days';
END $$;

-- Create some sample funnels for testing
-- Note: user_id matches the project user_id
INSERT INTO funnels (id,  project_id, name, steps, chart_type, pinned, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'E-Commerce Conversion Funnel',
  '["Product Viewed", "Add to Cart", "Checkout Started", "Purchase Completed"]'::jsonb,
  'funnel',
  true,
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '5 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO funnels (id,  project_id, name, steps, chart_type, pinned, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  'Product Discovery Flow',
  '["Page Viewed", "Product Viewed", "Add to Cart"]'::jsonb,
  'bar',
  false,
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO funnels (id,, project_id, name, steps, chart_type, pinned, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000002',
  'Game Engagement Funnel',
  '["Game Started", "Level Completed", "Achievement Unlocked"]'::jsonb,
  'area',
  true,
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '2 days'
)
ON CONFLICT (id) DO NOTHING;

