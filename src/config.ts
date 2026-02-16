/**
 * Configuration management
 */

import dotenv from "dotenv";

dotenv.config();

/**
 * Validates that a required environment variable is set
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `❌ SECURITY ERROR: Required environment variable ${name} is not set. ` +
        `Please set it in your .env file or environment. See SECURITY.md for details.`,
    );
  }
  return value;
}

/**
 * Validates encryption key meets minimum security requirements
 */
function validateEncryptionKey(key: string): string {
  if (key.length < 32) {
    throw new Error(
      `❌ SECURITY ERROR: API_KEY_ENCRYPTION_KEY must be at least 32 characters long. ` +
        `Current length: ${key.length}. Use a cryptographically random string.`,
    );
  }
  // Check for common weak patterns
  if (
    key.includes("change-me") ||
    key.includes("password") ||
    key.includes("secret") ||
    key === "a".repeat(key.length)
  ) {
    throw new Error(
      `❌ SECURITY ERROR: API_KEY_ENCRYPTION_KEY appears to be a weak or default value. ` +
        `Use a cryptographically random string (e.g., generated with: openssl rand -base64 32)`,
    );
  }
  return key;
}

/**
 * Validates JWT secret meets minimum security requirements
 */
function validateJwtSecret(secret: string): string {
  if (secret.length < 32) {
    throw new Error(
      `❌ SECURITY ERROR: JWT_SECRET must be at least 32 characters long. ` +
        `Current length: ${secret.length}. Use a cryptographically random string.`,
    );
  }
  if (
    secret.includes("change-me") ||
    secret.includes("password") ||
    secret.includes("secret") ||
    secret === "a".repeat(secret.length)
  ) {
    throw new Error(
      `❌ SECURITY ERROR: JWT_SECRET appears to be a weak or default value. ` +
        `Use a cryptographically random string (e.g., generated with: openssl rand -base64 32)`,
    );
  }
  return secret;
}

/**
 * Parses CORS origin(s) from environment variable
 * Supports single origin or comma-separated multiple origins
 */
function parseCorsOrigin(origin: string, nodeEnv: string): string | string[] {
  if (!origin || origin === "*") {
    if (nodeEnv === "production" && origin === "*") {
      console.warn(
        `⚠️  WARNING: CORS_ORIGIN is set to "*" in production. ` +
          `This allows any website to access your API. ` +
          `Set CORS_ORIGIN to your specific domain (e.g., https://yourdomain.com)`,
      );
    }
    return origin || "*";
  }

  // Check if multiple origins (comma-separated)
  if (origin.includes(",")) {
    const origins = origin
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    console.log(
      `✅ CORS configured for ${origins.length} origin(s): ${origins.join(", ")}`,
    );
    return origins;
  }

  // Single origin
  console.log(`✅ CORS configured for origin: ${origin}`);
  return origin;
}

const nodeEnv = process.env.NODE_ENV || "development";
const corsOriginRaw =
  process.env.CORS_ORIGIN ||
  (nodeEnv === "development" ? "*" : "https://axyle.app,https://www.axyle.app");

// Validate CORS origin
if (nodeEnv === "production" && !corsOriginRaw) {
  throw new Error(
    `❌ SECURITY ERROR: CORS_ORIGIN must be set in production. ` +
      `Set it to your web app's domain (e.g., https://yourdomain.com) ` +
      `or multiple domains separated by commas (e.g., https://app.com,https://admin.app.com)`,
  );
}

const corsOrigin = parseCorsOrigin(corsOriginRaw, nodeEnv);

export const config = {
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv,
    corsOrigin,
  },
  supabase: {
    url: process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  },
  security: {
    jwtSecret: validateJwtSecret(requireEnv("JWT_SECRET")),
    apiKeyEncryptionKey: validateEncryptionKey(
      requireEnv("API_KEY_ENCRYPTION_KEY"),
    ),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "1000", 10),
    // Stricter limits for sensitive endpoints
    apiKeyCreation: {
      windowMs: parseInt(
        process.env.API_KEY_RATE_LIMIT_WINDOW_MS || "3600000",
        10,
      ), // 1 hour
      maxRequests: parseInt(
        process.env.API_KEY_RATE_LIMIT_MAX_REQUESTS || "10",
        10,
      ),
    },
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
