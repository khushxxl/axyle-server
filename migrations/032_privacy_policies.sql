-- Privacy Policy Generator: store generated policies with shareable tokens
CREATE TABLE IF NOT EXISTS privacy_policies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  app_name TEXT NOT NULL,
  policy_content TEXT NOT NULL,
  form_data JSONB DEFAULT '{}'::jsonb,
  effective_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_policies_token ON privacy_policies(token);

-- Allow public read/write (no auth required for this free tool)
ALTER TABLE privacy_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert on privacy_policies"
  ON privacy_policies FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public select on privacy_policies"
  ON privacy_policies FOR SELECT
  USING (true);
