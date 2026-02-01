/**
 * Security middleware
 * Enforces HTTPS, adds security headers, and validates requests
 */

import { Request, Response, NextFunction } from "express";
import { config } from "../config";

/**
 * Enforces HTTPS in production
 * Rejects non-HTTPS requests to prevent man-in-the-middle attacks
 */
export function enforceHttps(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip in development
  if (config.server.nodeEnv !== "production") {
    return next();
  }

  // Check if request is secure
  // req.secure checks if connection is TLS/SSL
  // Also check X-Forwarded-Proto header for proxied requests (Heroku, AWS, etc.)
  const isSecure =
    req.secure ||
    req.headers["x-forwarded-proto"] === "https" ||
    req.headers["x-forwarded-proto"]?.includes("https");

  if (!isSecure) {
    console.warn(
      `⚠️  Rejected non-HTTPS request in production: ${req.method} ${req.path}`
    );
    res.status(403).json({
      success: false,
      error: "HTTPS required",
      message:
        "This API requires HTTPS in production for security. Please use https:// instead of http://",
    });
    return;
  }

  next();
}

/**
 * Adds security headers to all responses
 * Note: For more comprehensive security headers, consider using helmet.js
 */
export function addSecurityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Enable XSS protection
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy (basic)
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; frame-ancestors 'none'"
  );

  // Strict Transport Security (HSTS) - only in production with HTTPS
  if (config.server.nodeEnv === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  // Prevent caching of sensitive responses
  if (req.path.includes("/api-keys") || req.path.includes("/revenuecat")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
}

/**
 * Logs security events for monitoring
 */
export function logSecurityEvent(event: {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  metadata?: Record<string, any>;
}): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[SECURITY ${event.severity.toUpperCase()}] ${timestamp} - ${event.type}: ${event.message}`;

  if (event.severity === "critical" || event.severity === "high") {
    console.error(logMessage, event.metadata || {});
  } else if (event.severity === "medium") {
    console.warn(logMessage, event.metadata || {});
  } else {
    console.log(logMessage, event.metadata || {});
  }

  // In production, you might want to send these to a monitoring service
  // e.g., Sentry, DataDog, CloudWatch, etc.
}
