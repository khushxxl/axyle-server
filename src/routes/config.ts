/**
 * Configuration routes - provide SDK configuration
 */

import { Router, Request, Response } from 'express';
import { validatePlatformToken } from '../middleware/auth';
import { configRateLimiter } from '../middleware/rateLimit';
import { storage } from '../db';
import { SDKConfigResponse } from '../types';

const router = Router();

/**
 * GET /api/v1/apps/:appId/sdk-config
 * Get SDK configuration for an app
 */
router.get(
  '/:appId/sdk-config',
  configRateLimiter,
  validatePlatformToken,
  async (req: Request, res: Response<SDKConfigResponse | { error: string }>) => {
    try {
      const { appId } = req.params;
      const userId = (req as Request & { userId?: string }).userId;

      // Get app configuration
      const projectData = await storage.getProject(appId);

      if (!projectData || projectData.user_id !== userId) {
        return res.status(404).json({ error: 'App not found' });
      }

      // Get active API key
      const apiKeys = await storage.listApiKeys(appId);
      const activeApiKey = apiKeys.find(k => k.is_active);
      
      if (!activeApiKey) {
        return res.status(404).json({ error: 'No active API key found' });
      }

      // Get the actual key data by ID
      const apiKeyData = await storage.getApiKeyById(activeApiKey.id);
      if (!apiKeyData || !apiKeyData.key) {
        return res.status(404).json({ error: 'No active API key found' });
      }

      // Get user ID from app_users if exists
      const appUserData = await storage.getAppUser(appId, userId || '');

      const app = {
        ...projectData,
        api_key: apiKeyData.key,
        user_id: appUserData?.user_id || undefined,
      };

      res.json({
        apiKey: app.api_key,
        userId: app.user_id || undefined,
        environment: (app.environment || 'prod') as 'dev' | 'prod',
        baseUrl: app.base_url || 'https://api.expo-analytics.com',
        debug: app.debug || false,
        settings: {
          maxQueueSize: app.max_queue_size,
          flushInterval: app.flush_interval,
          sessionTimeout: app.session_timeout,
        },
      });
    } catch (error) {
      console.error('Error loading config:', error);
      res.status(500).json({ error: 'Failed to load configuration' });
    }
  }
);

export default router;

