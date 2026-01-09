/**
 * Event service - handles event processing and storage
 */

import { StorageAdapter } from '../db/storage';
import { AnalyticsEvent } from '../types';

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

