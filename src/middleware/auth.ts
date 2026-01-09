/**
 * Authentication middleware
 */

import { Request, Response, NextFunction } from 'express';
import { storage } from '../db';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      projectId?: string;
      apiKeyId?: string;
    }
  }
}

/**
 * Validate API key from X-API-Key header
 */
export async function validateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      success: false,
      error: 'API key required',
    });
    return;
  }

  try {
    console.log(`🔑 Validating API key: ${apiKey.substring(0, 8)}...`);
    
    // Check if API key exists and is active
    const apiKeyData = await storage.getApiKey(apiKey);

    if (!apiKeyData) {
      console.warn(`❌ Invalid API key: ${apiKey.substring(0, 8)}...`);
      res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
      return;
    }

    console.log(`✅ API key validated for project: ${apiKeyData.project_id}`);

    // Update last used timestamp
    await storage.updateApiKeyLastUsed(apiKeyData.id);

    // Attach project info to request
    req.projectId = apiKeyData.project_id;
    req.apiKeyId = apiKeyData.id;

    next();
  } catch (error) {
    console.error('API key validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

/**
 * Validate Bearer token for platform API
 */
export async function validatePlatformToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authorization required',
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    // Validate platform token
    const tokenData = await storage.getPlatformToken(token);

    if (!tokenData) {
      res.status(401).json({
        error: 'Invalid or expired token',
      });
      return;
    }

    // Attach user ID to request
    (req as Request & { userId?: string }).userId = tokenData.user_id;
    next();
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({
      error: 'Internal server error',
    });
  }
}

