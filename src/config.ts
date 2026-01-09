/**
 * Configuration management
 */

import dotenv from "dotenv";

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    corsOrigin: process.env.CORS_ORIGIN || "*",
  },
  supabase: {
    url: process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
    apiKeyEncryptionKey:
      process.env.API_KEY_ENCRYPTION_KEY || "change-me-in-production",
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "1000", 10),
  },
  features: {
    enableAnalyticsApi: process.env.ENABLE_ANALYTICS_API !== "false",
    enableConfigApi: process.env.ENABLE_CONFIG_API !== "false",
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
  },
};
