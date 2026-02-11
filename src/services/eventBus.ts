/**
 * EventBus — in-process pub/sub for real-time SSE notifications.
 * Uses Node.js EventEmitter to broadcast events per project.
 */

import { EventEmitter } from "events";

export interface SSEPayload {
  projectId: string;
  type: "event" | "payment";
  data: {
    eventName: string;
    timestamp: number;
    userId?: string;
    anonymousId?: string;
    sessionId?: string;
    // Payment-specific fields
    paymentType?: string;
    product_id?: string;
    price_in_purchased_currency?: number;
    currency?: string;
    store?: string;
  };
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitProjectEvent(payload: SSEPayload): void {
  bus.emit(`project:${payload.projectId}`, payload);
}

export function onProjectEvent(
  projectId: string,
  listener: (payload: SSEPayload) => void
): () => void {
  const channel = `project:${projectId}`;
  bus.on(channel, listener);
  return () => {
    bus.off(channel, listener);
  };
}
