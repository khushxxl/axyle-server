/**
 * Analytics routes - query analytics data
 */

import { Router, Request, Response } from 'express';
import { validateApiKey } from '../middleware/auth';
import { storage } from '../db';
import { onProjectEvent } from '../services/eventBus';

const router = Router();

/**
 * GET /api/v1/projects/:projectId/analytics/events
 * Get events for a project
 */
router.get(
  '/:projectId/analytics/events',
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { startDate, endDate, eventName, limit = '100' } = req.query;

      // Verify project belongs to the API key
      if (req.projectId !== projectId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      const events = await storage.getEvents(projectId, {
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        eventName: eventName as string | undefined,
        limit: parseInt(limit as string, 10),
      });

      res.json({
        success: true,
        events,
        count: events.length,
      });
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch events',
      });
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/analytics/stats
 * Get analytics statistics for a project
 */
router.get(
  '/:projectId/analytics/stats',
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { startDate, endDate } = req.query;

      // Verify project belongs to the API key
      if (req.projectId !== projectId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      const stats = await storage.getEventStats(projectId, {
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...stats,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch statistics',
      });
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/events/stream
 * Server-Sent Events endpoint for real-time event notifications
 */
router.get(
  '/:projectId/events/stream',
  (req: Request, res: Response) => {
    const { projectId } = req.params;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Initial OK comment
    res.write(':ok\n\n');

    // 30s keepalive ping
    const keepalive = setInterval(() => {
      res.write(':ping\n\n');
    }, 30000);

    // Subscribe to project events
    const unsubscribe = onProjectEvent(projectId, (payload) => {
      res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload.data)}\n\n`);
    });

    req.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  }
);

export default router;

