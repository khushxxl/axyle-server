/**
 * Events routes - handle event ingestion
 */

import { Router, Request, Response } from 'express';
import { validateApiKey } from '../middleware/auth';
import { eventRateLimiter } from '../middleware/rateLimit';
import { insertEventsBatch, updateProjectStats, validateEvent } from '../services/eventService';
import { storage } from '../db';
import { EventsRequest, EventsResponse } from '../types';

const router = Router();

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

