/**
 * Rate limiting middleware
 * Protects against brute force attacks and API abuse
 */

import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { logSecurityEvent } from "./security";

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

// In-memory store for rate limiting
// In production, consider using Redis for distributed rate limiting
const store: RateLimitStore = {};

// Clean up old entries periodically to prevent memory leaks
setInterval(
  () => {
    const now = Date.now();
    Object.keys(store).forEach((key) => {
      if (store[key].resetTime < now) {
        delete store[key];
      }
    });
  },
  60000 // Clean up every minute
);

/**
 * Creates a rate limiter middleware with custom settings
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Generate unique key for this client
    const key = options.keyGenerator
      ? options.keyGenerator(req)
      : `${req.ip}:${req.path}`;

    const now = Date.now();
    const limit = store[key];

    // Initialize or reset if window expired
    if (!limit || limit.resetTime < now) {
      store[key] = {
        count: 1,
        resetTime: now + options.windowMs,
      };
      next();
      return;
    }

    // Increment count
    limit.count++;

    // Check if limit exceeded
    if (limit.count > options.maxRequests) {
      const retryAfter = Math.ceil((limit.resetTime - now) / 1000);

      logSecurityEvent({
        type: "rate_limit_exceeded",
        severity: "medium",
        message: `Rate limit exceeded for ${key}`,
        metadata: {
          ip: req.ip,
          path: req.path,
          count: limit.count,
          limit: options.maxRequests,
        },
      });

      res.status(429).json({
        success: false,
        error: options.message || "Too many requests",
        retryAfter,
      });
      return;
    }

    next();
  };
}

/**
 * General API rate limiter
 */
export const generalRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.windowMs,
  maxRequests: config.rateLimit.maxRequests,
  message: "Too many requests from this IP. Please try again later.",
});

/**
 * Stricter rate limiter for API key creation
 * Prevents abuse of API key generation
 */
export const apiKeyCreationRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.apiKeyCreation.windowMs,
  maxRequests: config.rateLimit.apiKeyCreation.maxRequests,
  message:
    "Too many API key creation attempts. Please try again later. If you need more API keys, contact support.",
  keyGenerator: (req: Request) => {
    // Rate limit by authenticated user if available, otherwise by IP
    return req.supabaseUserId
      ? `apikey:user:${req.supabaseUserId}`
      : `apikey:ip:${req.ip}`;
  },
});

/**
 * Rate limiter for authentication attempts
 * Prevents brute force attacks on API keys
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 900000, // 15 minutes
  maxRequests: 100, // 100 auth attempts per 15 minutes
  message: "Too many authentication attempts. Please try again later.",
  keyGenerator: (req: Request) => `auth:${req.ip}`,
});
