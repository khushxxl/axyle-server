/**
 * Type definitions for the Analytics API
 */

export interface AnalyticsEvent {
  id: string;
  name: string;
  properties: Record<string, any>;
  timestamp: number;
  userId: string;
  anonymousId: string;
  sessionId: string;
  context: EventContext;
  schemaVersion: string;
}

export interface EventContext {
  app: {
    name: string;
    version: string;
    build: string;
    namespace: string;
  };
  device: {
    id: string | null;
    manufacturer: string | null;
    model: string | null;
    name: string | null;
    type: 'PHONE' | 'TABLET' | 'DESKTOP' | 'TV' | 'UNKNOWN';
    brand: string | null;
  };
  os: {
    name: string;
    version: string;
  };
  screen: {
    width: number;
    height: number;
    density: number;
  };
  locale: string;
  timezone: string;
  network?: {
    carrier: string | null;
    wifi: boolean;
  };
  environment: 'dev' | 'prod';
}

export interface EventsRequest {
  events: AnalyticsEvent[];
  sentAt: string;
}

export interface EventsResponse {
  success: boolean;
  received: number;
  processed: number;
  errors?: string[];
}

export interface SDKConfigResponse {
  apiKey: string;
  userId?: string;
  environment: 'dev' | 'prod';
  baseUrl: string;
  debug: boolean;
  settings: {
    maxQueueSize?: number;
    flushInterval?: number;
    sessionTimeout?: number;
  };
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  apiKey: string;
  environment: string;
  baseUrl: string | null;
  debug: boolean;
  maxQueueSize: number;
  flushInterval: number;
  sessionTimeout: number;
  totalEvents: number;
  lastEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  projectId: string;
  key: string;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

