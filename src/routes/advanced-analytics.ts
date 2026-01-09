/**
 * Advanced Analytics routes
 * Provides analytics for flows, screen time, feature usage, and scroll tracking
 */

import { Router, Request, Response } from 'express';
import { validateApiKey } from '../middleware/auth';
import { storage } from '../db';

const router = Router();

/**
 * GET /api/v1/projects/:projectId/analytics/flows
 * Get flow analytics (onboarding, checkout, tutorials, etc.)
 * Query params:
 *   - flowId: Filter by specific flow ID
 *   - flowType: Filter by flow type (onboarding, checkout, etc.)
 *   - startDate: Start date filter
 *   - endDate: End date filter
 */
router.get(
  '/:projectId/analytics/flows',
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { flowId, flowType, startDate, endDate } = req.query;

      // Verify project belongs to the API key
      if (req.projectId !== projectId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      const analytics = await storage.getFlowAnalytics(projectId, {
        flowId: flowId as string | undefined,
        flowType: flowType as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
      });
    } catch (error) {
      console.error('Error fetching flow analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch flow analytics',
      });
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/analytics/screen-time
 * Get screen time analytics
 * Query params:
 *   - screen: Filter by specific screen name
 *   - startDate: Start date filter
 *   - endDate: End date filter
 */
router.get(
  '/:projectId/analytics/screen-time',
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { screen, startDate, endDate } = req.query;

      // Verify project belongs to the API key
      if (req.projectId !== projectId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      const analytics = await storage.getScreenTimeAnalytics(projectId, {
        screen: screen as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
      });
    } catch (error) {
      console.error('Error fetching screen time analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch screen time analytics',
      });
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/analytics/features
 * Get feature usage analytics
 * Query params:
 *   - feature: Filter by specific feature name
 *   - startDate: Start date filter
 *   - endDate: End date filter
 */
router.get(
  '/:projectId/analytics/features',
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { feature, startDate, endDate } = req.query;

      // Verify project belongs to the API key
      if (req.projectId !== projectId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      const analytics = await storage.getFeatureUsageAnalytics(projectId, {
        feature: feature as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
      });
    } catch (error) {
      console.error('Error fetching feature usage analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch feature usage analytics',
      });
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/analytics/scroll
 * Get scroll analytics
 * Query params:
 *   - screen: Filter by specific screen name
 *   - startDate: Start date filter
 *   - endDate: End date filter
 */
router.get(
  '/:projectId/analytics/scroll',
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { screen, startDate, endDate } = req.query;

      // Verify project belongs to the API key
      if (req.projectId !== projectId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      const analytics = await storage.getScrollAnalytics(projectId, {
        screen: screen as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
      });
    } catch (error) {
      console.error('Error fetching scroll analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch scroll analytics',
      });
    }
  }
);

export default router;

