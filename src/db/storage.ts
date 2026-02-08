/**
 * Storage abstraction layer
 * Uses Supabase for persistent storage (required)
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { AnalyticsEvent } from "../types";

export interface SegmentCriteria {
  conditions: SegmentCondition[];
  logic: "AND" | "OR";
}

export interface SegmentCondition {
  id: string;
  type: "event" | "property" | "user" | "session";
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "greater_than"
    | "less_than"
    | "between"
    | "in"
    | "not_in"
    | "exists"
    | "not_exists"
    | "performed"
    | "not_performed";
  value: any;
  timeframe?: {
    type: "last_n_days" | "between" | "since" | "before";
    value: number | string | { start: string; end: string };
  };
}

export interface Segment {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  segment_type: "static" | "dynamic";
  criteria: SegmentCriteria;
  cached_size: number;
  last_calculated_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SegmentUser {
  user_id: string;
  anonymous_id?: string;
  added_at: string;
}

export interface PlatformUser {
  id: string;
  onboarding_answers: Record<string, any>;
  onboarding_completed: boolean;
  subscription_status: string;
  subscription_plan: string;
  welcome_email_sent: boolean;
  welcome_email_sent_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  project_id: string;
  user_id: string;
  role: "owner" | "member";
  invited_by: string;
  invited_at: string;
  created_at: string;
  user?: {
    id: string;
    email?: string;
    name?: string;
    avatar_url?: string;
  };
}

export interface StorageAdapter {
  // Projects
  createProject(data: any): Promise<any>;
  getProject(id: string): Promise<any | null>;
  listProjects(userId?: string): Promise<any[]>;
  deleteProject(id: string): Promise<void>;

  // API Keys
  createApiKey(projectId: string, key: string): Promise<any>;
  getApiKey(keyOrId: string): Promise<any | null>;
  getApiKeyById(id: string): Promise<any | null>;
  listApiKeys(projectId: string): Promise<any[]>;
  updateApiKeyLastUsed(id: string): Promise<void>;
  deactivateApiKey(id: string): Promise<void>;

  // Events
  insertEvents(events: AnalyticsEvent[], projectId: string): Promise<void>;
  updateProjectStats(projectId: string, eventCount: number): Promise<void>;
  getEvents(projectId: string, filters?: any): Promise<any[]>;
  getEventStats(projectId: string, filters?: any): Promise<any>;

  // Dashboard events (cross-project)
  getAllEvents(filters?: any): Promise<any[]>;
  getGlobalEventStats(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any>;
  getRecentEvents(filters?: any): Promise<any[]>;
  getEventNames(projectIds?: string[], projectId?: string): Promise<string[]>;
  getEventTrends(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any>;
  getAverageSessionTime(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any>;

  // Platform tokens
  getPlatformToken(token: string): Promise<any | null>;

  // App users
  getAppUser(projectId: string, userId: string): Promise<any | null>;
  getProjectUsers(
    projectId: string,
    filters?: { limit?: number; offset?: number }
  ): Promise<
    Array<{
      user_id: string;
      anonymous_id?: string;
      first_seen: string;
      last_seen: string;
      event_count: number;
    }>
  >;

  // Segments
  createSegment(data: any): Promise<Segment>;
  getSegment(id: string): Promise<Segment | null>;
  listSegments(projectId?: string): Promise<Segment[]>;
  updateSegment(id: string, data: any): Promise<Segment>;
  deleteSegment(id: string): Promise<void>;
  getSegmentUsers(
    segmentId: string,
    filters?: { limit?: number; offset?: number }
  ): Promise<SegmentUser[]>;
  calculateSegmentSize(
    segmentId: string,
    criteria: SegmentCriteria
  ): Promise<number>;
  updateSegmentSize(segmentId: string, size: number): Promise<void>;
  previewSegmentSize(
    projectId: string,
    criteria: SegmentCriteria
  ): Promise<number>;

  // Funnels
  createFunnel(data: {
    project_id: string;
    name: string;
    steps: string[];
    chart_type: string;
    pinned?: boolean;
  }): Promise<any>;
  getFunnel(id: string): Promise<any | null>;
  listFunnels(projectId: string): Promise<any[]>;
  countFunnelsForProjectIds(projectIds: string[]): Promise<number>;
  updateFunnel(
    id: string,
    data: {
      name?: string;
      steps?: string[];
      chart_type?: string;
      pinned?: boolean;
    }
  ): Promise<any>;
  deleteFunnel(id: string): Promise<void>;

  // Advanced Analytics
  getFlowAnalytics(projectId: string, filters?: any): Promise<any>;
  getScreenTimeAnalytics(projectId: string, filters?: any): Promise<any>;
  getFeatureUsageAnalytics(projectId: string, filters?: any): Promise<any>;
  getScrollAnalytics(projectId: string, filters?: any): Promise<any>;

  // Platform Users
  getUser(userId: string): Promise<PlatformUser | null>;
  getOrCreateUser(userId: string): Promise<PlatformUser>;
  updateUser(
    userId: string,
    data: {
      onboarding_answers?: Record<string, any>;
      onboarding_completed?: boolean;
      subscription_status?: string;
      subscription_plan?: string;
    }
  ): Promise<PlatformUser>;
  getUserByEmail(email: string): Promise<PlatformUser | null>;

  // Team Members
  getProjectTeamMembers(projectId: string): Promise<TeamMember[]>;
  getTeamMember(memberId: string): Promise<TeamMember | null>;
  addTeamMember(data: {
    projectId: string;
    userId: string;
    invitedBy: string;
  }): Promise<TeamMember>;
  removeTeamMember(memberId: string): Promise<void>;
  isProjectMember(projectId: string, userId: string): Promise<boolean>;
  isProjectOwner(projectId: string, userId: string): Promise<boolean>;
  canAddTeamMember(userId: string, projectId: string): Promise<boolean>;
  getProjectTeamCount(projectId: string): Promise<number>;

  // Project invitations (invite by email; no account required)
  createInvitation(data: {
    projectId: string;
    email: string;
    invitedBy: string;
    token: string;
    expiresAt: Date;
  }): Promise<{ id: string; token: string; expires_at: string }>;
  getInvitationByToken(token: string): Promise<{
    id: string;
    project_id: string;
    project_name: string;
    email: string;
    invited_by: string;
    status: string;
    expires_at: string;
  } | null>;
  listPendingInvitations(projectId: string): Promise<
    Array<{ id: string; email: string; invited_by: string; expires_at: string; created_at: string }>
  >;
  acceptInvitation(
    token: string,
    userId: string,
  ): Promise<{ projectId: string; projectName: string } | { error: string }>;

  // RevenueCat Integration
  updateProjectRevenueCatConfig(
    projectId: string,
    config: {
      revenuecat_secret_key: string | null;
      revenuecat_project_id: string | null;
      revenuecat_enabled: boolean;
    }
  ): Promise<void>;
}
