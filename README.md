# Expo Analytics API Server

Backend API server for the Expo Analytics SDK. Handles event ingestion, storage, and analytics queries.

## Features

- ✅ Event ingestion with batch processing
- ✅ Secure API key authentication (SHA-256 hashing)
- ✅ Rate limiting (general + per-endpoint)
- ✅ HTTPS enforcement in production
- ✅ Comprehensive security headers (Helmet.js)
- ✅ AES-256-GCM encryption for sensitive data
- ✅ SDK configuration endpoint
- ✅ Analytics query endpoints
- ✅ PostgreSQL database integration
- ✅ Error handling and logging
- ✅ Welcome email system with Resend

## 🔐 Security

This API implements enterprise-grade security features:

- **API Key Storage**: SHA-256 hashing (one-way, cannot be reversed)
- **Sensitive Data**: AES-256-GCM encryption for third-party API keys
- **HTTPS**: Enforced in production
- **Rate Limiting**: Protection against brute force and abuse
- **Security Headers**: HSTS, CSP, XSS protection, and more

**⚠️ Important**: Before deploying to production, review [SECURITY.md](./SECURITY.md) for required environment variables and security best practices.

## Prerequisites

- Node.js 18+
- npm or yarn
- **Supabase account and project** (required for persistent storage)

## Installation

1. Install dependencies:

```bash
npm install
```

2. Set up Supabase (required):

   - Create a new Supabase project at https://supabase.com
   - Run the migration SQL in your Supabase SQL editor (in order):
     ```bash
     # Copy and paste migrations/001_initial_schema.sql into Supabase SQL editor
     # Copy and paste migrations/003_segments.sql into Supabase SQL editor
     # Copy and paste migrations/007_users_onboarding.sql into Supabase SQL editor
     # Optionally run migrations/002_seed_data.sql for development
     ```
   - Get your Supabase credentials from Project Settings → API

3. Set up environment variables:

For **development**:
```bash
# Copy the development example
cp .env.development.example .env

# Generate secure secrets
./scripts/generate-secrets.sh

# Edit .env and add:
# - Generated JWT_SECRET
# - Generated API_KEY_ENCRYPTION_KEY
# - Your Supabase credentials
# - (Optional) OpenAI API key
```

For **production**, see [SECURITY.md](./SECURITY.md) for complete setup instructions.

## Configuration

Edit `.env` file with your settings:

```bash
# Server
PORT=3000
NODE_ENV=development

# Supabase (REQUIRED)
# API requires Supabase for persistent storage
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# OpenAI (OPTIONAL)
# Required for AI assistant feature in the dashboard
OPENAI_API_KEY=your-openai-api-key
```

**Note:** The API requires Supabase configuration. The server will not start without valid Supabase credentials.

## Running

### Development

```bash
npm run dev
```

### Production

**⚠️ Before deploying to production:**
1. Review [SECURITY.md](./SECURITY.md) for security requirements
2. Generate production secrets: `./scripts/generate-secrets.sh`
3. Set all required environment variables
4. Enable HTTPS on your hosting platform

```bash
npm run build
npm start
```

## API Endpoints

### Health Check

```
GET /health
```

### Event Ingestion

```
POST /api/events
Headers:
  X-API-Key: {api-key}
  Content-Type: application/json

Body:
{
  "events": [AnalyticsEvent[]],
  "sentAt": "2024-01-01T00:00:00.000Z"
}
```

### SDK Configuration

```
GET /api/v1/apps/:appId/sdk-config
Headers:
  Authorization: Bearer {platform-token}
```

### Analytics Queries

```
GET /api/v1/projects/:projectId/analytics/events
GET /api/v1/projects/:projectId/analytics/stats
Headers:
  X-API-Key: {api-key}
```

### AI Assistant

```
POST /api/v1/ai/chat
Headers:
  Authorization: Bearer {supabase-token}
  Content-Type: application/json

Body:
{
  "message": "What are my top events?",
  "conversationHistory": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" }
  ]
}

Response:
{
  "success": true,
  "response": "Based on your analytics data..."
}
```

**Note:** AI assistant requires `OPENAI_API_KEY` environment variable to be set. If not configured, the endpoint will return an error.

## Storage

The API uses **Supabase PostgreSQL** for persistent storage (required).

**Database Schema:**

- `projects` - Analytics projects/apps
- `api_keys` - API keys for authentication
- `events` - Analytics events
- `sessions` - User sessions
- `platform_tokens` - Tokens for platform API
- `segments` - User segment definitions
- `segment_users` - Segment membership cache
- `app_users` - User-project mappings
- `users` - Platform users with onboarding and subscription data

See migration files in `migrations/` directory for full schema. Run these SQL files in your Supabase SQL editor:

- `001_initial_schema.sql` - Core tables
- `003_segments.sql` - User segments
- `007_users_onboarding.sql` - Platform users with onboarding and subscriptions

## Testing

After running the seed data migration, you can use:

- API Key: `550e8400-e29b-41d4-a716-446655440000`
- Project ID: `00000000-0000-0000-0000-000000000001`

Note: Seed data is optional and only for development/testing.

## Security

See [SECURITY.md](./SECURITY.md) for:
- Required environment variables
- Security features and implementation details
- Deployment checklist
- Vulnerability reporting
- Best practices for production

## Environment Variables

### Required
- `JWT_SECRET` - Min 32 characters, cryptographically random
- `API_KEY_ENCRYPTION_KEY` - Min 32 characters, cryptographically random
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `CORS_ORIGIN` - Your web app domain (production only)

### Optional
- `OPENAI_API_KEY` - For AI assistant feature
- `RESEND_API_KEY` - For email notifications
- Rate limiting configuration (see `.env.example`)

Generate secure secrets with:
```bash
./scripts/generate-secrets.sh
```

## License

MIT
