/**
 * Rate limiting middleware
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Rate limiter for event ingestion endpoint
 */
export const eventRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  keyGenerator: (req) => {
    // Use API key as the key for rate limiting
    return (req.headers['x-api-key'] as string) || req.ip || 'anonymous';
  },
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
    retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for config endpoint
 */
export const configRateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => {
    return req.ip || 'anonymous';
  },
  message: {
    error: 'Too many requests, please try again later.',
  },
});

