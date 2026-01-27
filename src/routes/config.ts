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

      // Get active API key (we never return the raw key — it's hashed and shown only at creation)
      const apiKeys = await storage.listApiKeys(appId);
      const activeApiKey = apiKeys.find(k => k.is_active);

      if (!activeApiKey) {
        return res.status(404).json({ error: 'No active API key found' });
      }

      const apiKeyData = await storage.getApiKeyById(activeApiKey.id);
      if (!apiKeyData) {
        return res.status(404).json({ error: 'No active API key found' });
      }

      const appUserData = await storage.getAppUser(appId, userId || '');

      const hasLegacyKey = !!apiKeyData.key;

      res.json({
        ...(hasLegacyKey && { apiKey: apiKeyData.key }),
        apiKeyConfigured: true,
        userId: appUserData?.user_id || undefined,
        environment: (projectData.environment || 'prod') as 'dev' | 'prod',
        baseUrl: projectData.base_url || 'https://api.expo-analytics.com',
        debug: projectData.debug || false,
        settings: {
          maxQueueSize: projectData.max_queue_size,
          flushInterval: projectData.flush_interval,
          sessionTimeout: projectData.session_timeout,
        },
      });
    } catch (error) {
      console.error('Error loading config:', error);
      res.status(500).json({ error: 'Failed to load configuration' });
    }
  }
);

export default router;

