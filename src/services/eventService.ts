/**
 * Event service - handles event processing and storage
 */

import { StorageAdapter } from '../db/storage';
import { AnalyticsEvent } from '../types';
import { emitProjectEvent } from './eventBus';

/**
 * Insert events batch into database
 */
export async function insertEventsBatch(
  storage: StorageAdapter,
  events: AnalyticsEvent[],
  projectId: string
): Promise<void> {
  if (events.length === 0) return;
  await storage.insertEvents(events, projectId);

  // Upsert sessions from event data (fire-and-forget to not slow down ingestion)
  storage
    .upsertSessions(
      events.map((e) => ({
        sessionId: e.sessionId,
        projectId,
        userId: e.userId,
        anonymousId: e.anonymousId,
        timestamp: e.timestamp,
        name: e.name,
        deviceType: e.context?.device?.type,
        osName: e.context?.os?.name,
        appVersion: e.context?.app?.version,
        environment: e.context?.environment,
      })),
    )
    .catch((err) => console.error("Session upsert error:", err));

  // Broadcast each event for real-time SSE listeners
  for (const event of events) {
    emitProjectEvent({
      projectId,
      type: "event",
      data: {
        eventName: event.name,
        timestamp: event.timestamp,
        userId: event.userId,
        anonymousId: event.anonymousId,
        sessionId: event.sessionId,
      },
    });
  }
}

/**
 * Update project statistics
 */
export async function updateProjectStats(
  storage: StorageAdapter,
  projectId: string,
  eventCount: number
): Promise<void> {
  await storage.updateProjectStats(projectId, eventCount);
}

/**
 * Validate event structure
 */
export function validateEvent(event: any): {
  valid: boolean;
  error?: string;
} {
  if (!event.id || typeof event.id !== 'string') {
    return { valid: false, error: 'Event ID is required' };
  }

  if (!event.name || typeof event.name !== 'string') {
    return { valid: false, error: 'Event name is required' };
  }

  if (!event.timestamp || typeof event.timestamp !== 'number') {
    return { valid: false, error: 'Event timestamp is required' };
  }

  if (!event.anonymousId || typeof event.anonymousId !== 'string') {
    return { valid: false, error: 'Anonymous ID is required' };
  }

  if (!event.sessionId || typeof event.sessionId !== 'string') {
    return { valid: false, error: 'Session ID is required' };
  }

  // Check event size (32KB limit)
  const eventSize = JSON.stringify(event).length;
  if (eventSize > 32 * 1024) {
    return { valid: false, error: 'Event exceeds size limit (32KB)' };
  }

  return { valid: true };
}

