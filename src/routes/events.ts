/**
 * Events routes - handle event ingestion
 */

import { Router, Request, Response } from 'express';
import { validateApiKey } from '../middleware/auth';
import { eventRateLimiter } from '../middleware/rateLimit';
import { insertEventsBatch, updateProjectStats, validateEvent } from '../services/eventService';
import { storage } from '../db';
import { EventsRequest, EventsResponse } from '../types';
import { getPlanLimits, isUnlimited } from '../config/plan-limits';

const router = Router();

function getCurrentMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * POST /api/events
 * Receive and process analytics events
 */
router.post(
  '/',
  eventRateLimiter,
  validateApiKey,
  async (req: Request, res: Response<EventsResponse>) => {
    try {
      const { events, sentAt } = req.body as EventsRequest;
      const projectId = req.projectId!;

      console.log(`📥 Received ${events?.length || 0} events for project ${projectId}`);

      // Validate request
      if (!Array.isArray(events) || events.length === 0) {
        console.warn('⚠️  Invalid request: events array is empty or not an array');
        return res.status(400).json({
          success: false,
          received: 0,
          processed: 0,
          errors: ['Events array is required and must not be empty'],
        });
      }

      // Validate each event
      const validEvents: typeof events = [];
      const errors: string[] = [];

      for (const event of events) {
        const validation = validateEvent(event);
        if (!validation.valid) {
          errors.push(`Event ${event.id || 'unknown'}: ${validation.error}`);
          continue;
        }

        validEvents.push(event);
      }

      // Batch insert to database
      if (validEvents.length > 0) {
        try {
          // Enforce plan event limit (per account / billing owner)
          const project = await storage.getProject(projectId);
          if (project?.user_id) {
            const owner = await storage.getUser(project.user_id);
            const limits = getPlanLimits(owner?.subscription_plan);
            if (!isUnlimited(limits.eventsPerMonth)) {
              const ownerProjects = await storage.listProjects(project.user_id);
              const ownerProjectIds = ownerProjects.map((p: { id: string }) => p.id);
              const { startDate, endDate } = getCurrentMonthRange();
              const stats = await storage.getGlobalEventStats(ownerProjectIds, {
                startDate,
                endDate,
              });
              const currentMonthEvents = stats?.overview?.total_events ?? 0;
              if (currentMonthEvents + validEvents.length > limits.eventsPerMonth) {
                return res.status(402).json({
                  success: false,
                  received: events.length,
                  processed: 0,
                  errors: [
                    `Event limit exceeded. Your plan allows ${limits.eventsPerMonth.toLocaleString()} events per month. Upgrade to increase the limit.`,
                  ],
                });
              }
            }
          }

          console.log(`💾 Storing ${validEvents.length} events to storage...`);
          await insertEventsBatch(storage, validEvents, projectId);
          await updateProjectStats(storage, projectId, validEvents.length);
          console.log(`✅ Successfully stored ${validEvents.length} events`);
        } catch (dbError) {
          console.error('❌ Database error:', dbError);
          return res.status(500).json({
            success: false,
            received: events.length,
            processed: 0,
            errors: ['Failed to store events'],
          });
        }
      } else {
        console.warn('⚠️  No valid events to store');
      }

      const response = {
        success: true,
        received: events.length,
        processed: validEvents.length,
        ...(errors.length > 0 && { errors }),
      };

      console.log(`✅ Response:`, response);
      res.json(response);
    } catch (error) {
      console.error('Error processing events:', error);
      res.status(500).json({
        success: false,
        received: 0,
        processed: 0,
        errors: ['Internal server error'],
      });
    }
  }
);

export default router;

