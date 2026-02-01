/**
 * Supabase JWT authentication middleware
 * Validates Supabase JWT tokens from web app
 */

import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      supabaseUserId?: string;
      supabaseUser?: any;
      supabaseAuthError?: string;
    }
  }
}

let supabaseAdmin: ReturnType<typeof createClient> | null = null;

// Initialize Supabase admin client for JWT verification
if (config.supabase.url && config.supabase.serviceRoleKey) {
  supabaseAdmin = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Validate Supabase JWT token from Authorization header
 * Extracts user ID and attaches to request
 */
export async function validateSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip if no Supabase configured
  if (!supabaseAdmin || !config.supabase.url) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Not an error - just no auth provided
    return next();
  }

  const token = authHeader.substring(7);

  try {
    // Verify the JWT token and get user
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      // Invalid token, but don't fail - just continue without user
      console.warn('⚠️  Invalid Supabase token:', error?.message);
      req.supabaseAuthError = error?.message || 'Invalid Supabase token';
      return next();
    }

    // Attach user info to request
    req.supabaseUserId = user.id;
    req.supabaseUser = user;

    next();
  } catch (error) {
    console.error('Supabase auth validation error:', error);
    // Don't fail the request, just continue without user
    req.supabaseAuthError =
      error instanceof Error ? error.message : 'Supabase auth validation error';
    next();
  }
}

/**
 * Optional middleware - requires Supabase auth
 * Use this for routes that MUST have authenticated user
 */
export async function requireSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.supabaseUserId) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  next();
}

