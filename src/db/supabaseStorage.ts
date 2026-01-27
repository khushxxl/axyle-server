/**
 * Supabase storage adapter
 * Used when Supabase is configured
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  StorageAdapter,
  Segment,
  SegmentCriteria,
  SegmentUser,
  PlatformUser,
} from "./storage";
import { AnalyticsEvent } from "../types";
import { hashApiKey } from "../utils/hash";

export class SupabaseStorage implements StorageAdapter {
  constructor(private supabase: SupabaseClient) {}

  // Projects
  async createProject(data: any): Promise<any> {
    const { data: project, error } = await this.supabase
      .from("projects")
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return project;
  }

  async getProject(id: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  async listProjects(userId?: string): Promise<any[]> {
    let query = this.supabase.from("projects").select("*");
    if (userId) {
      query = query.eq("user_id", userId);
    }
    const { data, error } = await query.order("created_at", {
      ascending: false,
    });
    if (error) throw error;
    return data || [];
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("projects")
      .delete()
      .eq("id", id);

    if (error) throw error;
  }

  // API Keys — we store only the hash. Plain key is shown once at creation and never again.
  async createApiKey(projectId: string, key: string): Promise<any> {
    const keyHash = hashApiKey(key);
    const { data, error } = await this.supabase
      .from("api_keys")
      .insert({
        project_id: projectId,
        key: null, // never store plain key
        key_hash: keyHash,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getApiKey(plainKey: string): Promise<any | null> {
    const keyHash = hashApiKey(plainKey);
    const { data, error } = await this.supabase
      .from("api_keys")
      .select(
        `
        id,
        project_id,
        key,
        key_hash,
        is_active,
        projects!inner(id)
      `
      )
      .or(`key_hash.eq.${keyHash},key.eq.${plainKey}`)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async getApiKeyById(id: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("api_keys")
      .select("id, project_id, key, key_hash, is_active")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  async listApiKeys(projectId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("api_keys")
      .select("id, is_active, created_at, last_used_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await this.supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", id);
  }

  async deactivateApiKey(id: string): Promise<void> {
    await this.supabase
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", id);
  }

  // Events
  async insertEvents(
    events: AnalyticsEvent[],
    projectId: string
  ): Promise<void> {
    const eventsToInsert = events.map((event) => ({
      id: event.id,
      project_id: projectId,
      event_name: event.name,
      properties: event.properties,
      timestamp: event.timestamp,
      created_at: new Date(event.timestamp).toISOString(),
      user_id: event.userId || null,
      anonymous_id: event.anonymousId,
      session_id: event.sessionId,
      app_name: event.context.app.name,
      app_version: event.context.app.version,
      app_build: event.context.app.build,
      app_namespace: event.context.app.namespace,
      device_type: event.context.device.type,
      device_model: event.context.device.model || null,
      device_manufacturer: event.context.device.manufacturer || null,
      device_brand: event.context.device.brand || null,
      os_name: event.context.os.name,
      os_version: event.context.os.version,
      screen_width: event.context.screen?.width || null,
      screen_height: event.context.screen?.height || null,
      screen_density: event.context.screen?.density || null,
      locale: event.context.locale
        ? String(event.context.locale).substring(0, 20)
        : null,
      timezone: event.context.timezone || null,
      environment: event.context.environment
        ? String(event.context.environment).substring(0, 50)
        : null,
      schema_version: event.schemaVersion,
      context: event.context,
    }));

    const batchSize = 100;
    for (let i = 0; i < eventsToInsert.length; i += batchSize) {
      const batch = eventsToInsert.slice(i, i + batchSize);
      const { error } = await this.supabase.from("events").upsert(batch, {
        onConflict: "id",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    }

    // Populate app_users table with unique user_id + project_id combinations
    const uniqueUsers = new Map<
      string,
      { project_id: string; user_id: string }
    >();
    events.forEach((event) => {
      if (event.userId) {
        // Use project_id + user_id as key to ensure uniqueness
        const key = `${projectId}:${event.userId}`;
        if (!uniqueUsers.has(key)) {
          uniqueUsers.set(key, {
            project_id: projectId,
            user_id: event.userId,
          });
        }
      }
    });

    // Upsert unique users into app_users table
    if (uniqueUsers.size > 0) {
      const usersToInsert = Array.from(uniqueUsers.values());
      const { error: appUsersError } = await this.supabase
        .from("app_users")
        .upsert(usersToInsert, {
          onConflict: "project_id,user_id",
          ignoreDuplicates: false,
        });

      if (appUsersError) {
        // Log error but don't fail the event insertion
        console.warn("Failed to update app_users table:", appUsersError);
      }
    }
  }

  async updateProjectStats(
    projectId: string,
    eventCount: number
  ): Promise<void> {
    const { data: project } = await this.supabase
      .from("projects")
      .select("total_events")
      .eq("id", projectId)
      .single();

    const newTotalEvents = (project?.total_events || 0) + eventCount;

    await this.supabase
      .from("projects")
      .update({
        total_events: newTotalEvents,
        last_event_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
  }

  async getEvents(projectId: string, filters?: any): Promise<any[]> {
    let query = this.supabase
      .from("events")
      .select(
        "id, event_name, properties, timestamp, user_id, session_id, app_name, device_type, os_name, environment, created_at"
      )
      .eq("project_id", projectId)
      .order("timestamp", { ascending: false });

    if (filters?.startDate) {
      query = query.gte(
        "created_at",
        new Date(filters.startDate).toISOString()
      );
    }
    if (filters?.endDate) {
      query = query.lte("created_at", new Date(filters.endDate).toISOString());
    }
    if (filters?.eventName) {
      query = query.eq("event_name", filters.eventName);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getEventStats(projectId: string, filters?: any): Promise<any> {
    let baseQuery = this.supabase
      .from("events")
      .select("*")
      .eq("project_id", projectId);

    if (filters?.startDate) {
      baseQuery = baseQuery.gte(
        "created_at",
        new Date(filters.startDate).toISOString()
      );
    }
    if (filters?.endDate) {
      baseQuery = baseQuery.lte(
        "created_at",
        new Date(filters.endDate).toISOString()
      );
    }

    const { data: allEvents, error } = await baseQuery;
    if (error) throw error;

    const totalEvents = allEvents?.length || 0;
    const uniqueUsers = new Set(
      allEvents?.filter((e) => e.user_id).map((e) => e.user_id)
    ).size;
    const uniqueSessions = new Set(allEvents?.map((e) => e.session_id)).size;
    const uniqueDevices = new Set(allEvents?.map((e) => e.anonymous_id)).size;

    const eventCounts: Record<string, number> = {};
    allEvents?.forEach((event) => {
      eventCounts[event.event_name] = (eventCounts[event.event_name] || 0) + 1;
    });

    const topEvents = Object.entries(eventCounts)
      .map(([event_name, count]) => ({ event_name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      overview: {
        total_events: totalEvents,
        unique_users: uniqueUsers,
        unique_sessions: uniqueSessions,
        unique_devices: uniqueDevices,
      },
      topEvents,
    };
  }

  async getAllEvents(filters?: any): Promise<any[]> {
    let query = this.supabase
      .from("events")
      .select("*")
      .order("timestamp", { ascending: false });

    if (filters?.projectId) {
      query = query.eq("project_id", filters.projectId);
    }
    if (filters?.startDate) {
      query = query.gte(
        "created_at",
        new Date(filters.startDate).toISOString()
      );
    }
    if (filters?.endDate) {
      query = query.lte("created_at", new Date(filters.endDate).toISOString());
    }
    if (filters?.eventName) {
      query = query.eq("event_name", filters.eventName);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(
        filters.offset,
        filters.offset + (filters.limit || 100) - 1
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getGlobalEventStats(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any> {
    // If date filters are provided, use fallback method with date filtering
    // Otherwise use the database function for efficiency
    if (filters?.startDate || filters?.endDate) {
      return this.getGlobalEventStatsFallback(projectIds, filters);
    }

    // Use database function for efficient aggregation
    // This is much faster than fetching all events and processing in JavaScript
    const { data, error } = await this.supabase.rpc("get_global_event_stats", {
      project_ids: projectIds && projectIds.length > 0 ? projectIds : null,
    });

    if (error) {
      // Fallback to manual calculation if function doesn't exist yet
      console.warn(
        "Database function not available, using fallback:",
        error.message
      );
      return this.getGlobalEventStatsFallback(projectIds, filters);
    }

    return (
      data || {
        overview: {
          total_events: 0,
          unique_users: 0,
          unique_sessions: 0,
          unique_devices: 0,
        },
        topEvents: [],
      }
    );
  }

  // Fallback method if database function is not available or date filters are needed
  private async getGlobalEventStatsFallback(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any> {
    // Use optimized query with only needed fields
    let query = this.supabase
      .from("events")
      .select("event_name, user_id, session_id, anonymous_id, created_at");

    if (projectIds && projectIds.length > 0) {
      query = query.in("project_id", projectIds);
    }

    // Apply date filters
    if (filters?.startDate) {
      query = query.gte("created_at", filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte("created_at", filters.endDate);
    }

    const { data: events, error } = await query;
    if (error) throw error;

    const eventList = events || [];
    const totalEvents = eventList.length;
    const uniqueUsers = new Set(
      eventList.filter((e) => e.user_id).map((e) => e.user_id)
    ).size;
    const uniqueSessions = new Set(eventList.map((e) => e.session_id)).size;
    const uniqueDevices = new Set(eventList.map((e) => e.anonymous_id)).size;

    // Event counts by name
    const eventCounts: Record<string, number> = {};
    eventList.forEach((event) => {
      const eventName = event.event_name;
      if (eventName) {
        eventCounts[eventName] = (eventCounts[eventName] || 0) + 1;
      }
    });

    const topEvents = Object.entries(eventCounts)
      .map(([event_name, count]) => ({ event_name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Generate eventsOverTime if date range is provided
    let eventsOverTime: any[] = [];
    if (filters?.startDate || filters?.endDate) {
      const eventsByDay: Record<string, number> = {};
      eventList.forEach((event) => {
        const day = new Date(event.created_at).toLocaleDateString("en-US", {
          weekday: "short",
        });
        eventsByDay[day] = (eventsByDay[day] || 0) + 1;
      });
      eventsOverTime = Object.entries(eventsByDay).map(([hour, count]) => ({
        hour,
        count,
      }));
    }

    return {
      overview: {
        total_events: totalEvents,
        unique_users: uniqueUsers,
        unique_sessions: uniqueSessions,
        unique_devices: uniqueDevices,
      },
      topEvents,
      ...(eventsOverTime.length > 0 && { eventsOverTime }),
    };
  }

  async getRecentEvents(filters?: any): Promise<any[]> {
    // Only select needed fields
    let query = this.supabase
      .from("events")
      .select(
        "id, event_name, properties, timestamp, user_id, anonymous_id, session_id, project_id, app_name, device_type, os_name, environment, created_at"
      )
      .order("timestamp", { ascending: false });

    if (filters?.projectId) {
      query = query.eq("project_id", filters.projectId);
    }
    if (filters?.since) {
      query = query.gte("created_at", new Date(filters.since).toISOString());
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getEventNames(
    projectIds?: string[],
    projectId?: string
  ): Promise<string[]> {
    // Optimized query - only select event_name column
    let query = this.supabase
      .from("events")
      .select("event_name")
      .not("event_name", "is", null);

    // Filter by specific project if provided
    if (projectId) {
      query = query.eq("project_id", projectId);
    } else if (projectIds && projectIds.length > 0) {
      // Filter by user's projects
      query = query.in("project_id", projectIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Get unique event names
    const uniqueNames = [
      ...new Set(data?.map((e) => e.event_name).filter(Boolean) || []),
    ];
    return uniqueNames;
  }

  async getEventTrends(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any> {
    // If date filters are provided, use fallback method
    if (filters?.startDate || filters?.endDate) {
      return this.getEventTrendsFallback(projectIds, filters);
    }

    // Use database function for efficient trend calculation
    const { data, error } = await this.supabase.rpc("get_event_trends", {
      project_ids: projectIds && projectIds.length > 0 ? projectIds : null,
    });

    if (error) {
      console.warn(
        "Database function not available, using fallback:",
        error.message
      );
      return this.getEventTrendsFallback(projectIds, filters);
    }

    return (
      data || {
        total_events: { current: 0, previous: 0 },
        unique_users: { current: 0, previous: 0 },
      }
    );
  }

  private async getEventTrendsFallback(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any> {
    const now = new Date();
    let currentStart: Date;
    let previousStart: Date;
    let previousEnd: Date;

    if (filters?.startDate && filters?.endDate) {
      // Use provided date range
      const endDate = new Date(filters.endDate);
      const startDate = new Date(filters.startDate);
      const rangeMs = endDate.getTime() - startDate.getTime();

      currentStart = startDate;
      previousEnd = startDate;
      previousStart = new Date(startDate.getTime() - rangeMs);
    } else {
      // Default to last 7 days vs previous 7 days
      currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      previousEnd = currentStart;
    }

    let currentQuery = this.supabase
      .from("events")
      .select("id, user_id", { count: "exact" })
      .gte("created_at", currentStart.toISOString());

    let previousQuery = this.supabase
      .from("events")
      .select("id, user_id", { count: "exact" })
      .gte("created_at", previousStart.toISOString())
      .lt("created_at", previousEnd.toISOString());

    if (projectIds && projectIds.length > 0) {
      currentQuery = currentQuery.in("project_id", projectIds);
      previousQuery = previousQuery.in("project_id", projectIds);
    }

    const [currentRes, previousRes] = await Promise.all([
      currentQuery,
      previousQuery,
    ]);

    // Get unique users for current period
    let currentUsersQuery = this.supabase
      .from("events")
      .select("user_id")
      .gte("created_at", currentStart.toISOString())
      .not("user_id", "is", null);

    let previousUsersQuery = this.supabase
      .from("events")
      .select("user_id")
      .gte("created_at", previousStart.toISOString())
      .lt("created_at", previousEnd.toISOString())
      .not("user_id", "is", null);

    if (projectIds && projectIds.length > 0) {
      currentUsersQuery = currentUsersQuery.in("project_id", projectIds);
      previousUsersQuery = previousUsersQuery.in("project_id", projectIds);
    }

    const [currentUsersRes, previousUsersRes] = await Promise.all([
      currentUsersQuery,
      previousUsersQuery,
    ]);

    const currentUsers = new Set(
      (currentUsersRes.data || []).map((e) => e.user_id)
    ).size;
    const previousUsers = new Set(
      (previousUsersRes.data || []).map((e) => e.user_id)
    ).size;

    return {
      total_events: {
        current: currentRes.count || 0,
        previous: previousRes.count || 0,
      },
      unique_users: {
        current: currentUsers,
        previous: previousUsers,
      },
    };
  }

  async getAverageSessionTime(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any> {
    // If date filters are provided, use fallback method
    if (filters?.startDate || filters?.endDate) {
      return this.getAverageSessionTimeFallback(projectIds, filters);
    }

    // Use database function for efficient calculation
    const { data, error } = await this.supabase.rpc(
      "get_average_session_time",
      {
        project_ids: projectIds && projectIds.length > 0 ? projectIds : null,
      }
    );

    if (error) {
      console.warn(
        "Database function not available, using fallback:",
        error.message
      );
      return this.getAverageSessionTimeFallback(projectIds, filters);
    }

    return data || { average_duration_ms: 0, average_duration_seconds: 0 };
  }

  private async getAverageSessionTimeFallback(
    projectIds?: string[],
    filters?: { startDate?: string; endDate?: string }
  ): Promise<any> {
    let startTimestamp: number;

    if (filters?.startDate) {
      const startDate = new Date(filters.startDate);
      startTimestamp = Math.floor(startDate.getTime() / 1000) * 1000;
    } else {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      startTimestamp = Math.floor(sevenDaysAgo.getTime() / 1000) * 1000;
    }

    let query = this.supabase
      .from("sessions")
      .select("duration_ms")
      .not("duration_ms", "is", null)
      .gt("duration_ms", 0)
      .gte("start_time", startTimestamp.toString());

    if (filters?.endDate) {
      const endDate = new Date(filters.endDate);
      const endTimestamp = Math.floor(endDate.getTime() / 1000) * 1000;
      query = query.lte("start_time", endTimestamp.toString());
    }

    if (projectIds && projectIds.length > 0) {
      query = query.in("project_id", projectIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    const sessions = data || [];
    if (sessions.length === 0) {
      return { average_duration_ms: 0, average_duration_seconds: 0 };
    }

    const totalDuration = sessions.reduce(
      (sum, s) => sum + (s.duration_ms || 0),
      0
    );
    const averageDurationMs = Math.round(totalDuration / sessions.length);
    const averageDurationSeconds = Math.round(averageDurationMs / 1000);

    return {
      average_duration_ms: averageDurationMs,
      average_duration_seconds: averageDurationSeconds,
    };
  }

  // Platform tokens
  async getPlatformToken(token: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("platform_tokens")
      .select("user_id")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  // App users
  async getAppUser(projectId: string, userId: string): Promise<any | null> {
    if (!userId) return null;

    const { data, error } = await this.supabase
      .from("app_users")
      .select("user_id, project_id, created_at")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  async getProjectUsers(
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
  > {
    const limit = filters?.limit || 100;
    const offset = filters?.offset || 0;

    // Get distinct users from events for this project with aggregated stats
    const { data: userData, error: userError } = await this.supabase
      .from("events")
      .select("user_id, anonymous_id, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10000); // Reasonable limit for aggregation

    if (userError) throw userError;

    // Aggregate user data
    const userMap = new Map<
      string,
      {
        user_id: string;
        anonymous_id?: string;
        first_seen: string;
        last_seen: string;
        event_count: number;
      }
    >();

    (userData || []).forEach((event: any) => {
      const userId = event.user_id || event.anonymous_id;
      if (!userId) return;

      const key = event.user_id
        ? `user:${event.user_id}`
        : `anon:${event.anonymous_id}`;
      const existing = userMap.get(key);

      if (!existing) {
        userMap.set(key, {
          user_id: event.user_id || "",
          anonymous_id: event.anonymous_id || undefined,
          first_seen: event.created_at,
          last_seen: event.created_at,
          event_count: 1,
        });
      } else {
        existing.event_count++;
        if (new Date(event.created_at) < new Date(existing.first_seen)) {
          existing.first_seen = event.created_at;
        }
        if (new Date(event.created_at) > new Date(existing.last_seen)) {
          existing.last_seen = event.created_at;
        }
      }
    });

    const users = Array.from(userMap.values())
      .sort(
        (a, b) =>
          new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
      )
      .slice(offset, offset + limit);

    return users;
  }

  // Funnels
  async createFunnel(data: {
    project_id: string;
    name: string;
    steps: string[];
    chart_type: string;
    pinned?: boolean;
  }): Promise<any> {
    const { data: funnel, error } = await this.supabase
      .from("funnels")
      .insert({
        project_id: data.project_id,
        name: data.name,
        steps: data.steps,
        chart_type: data.chart_type,
        pinned: data.pinned || false,
      })
      .select()
      .single();

    if (error) throw error;
    return funnel;
  }

  async getFunnel(id: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("funnels")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  async listFunnels(projectId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("funnels")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async updateFunnel(
    id: string,
    data: {
      name?: string;
      steps?: string[];
      chart_type?: string;
      pinned?: boolean;
    }
  ): Promise<any> {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.steps !== undefined) updateData.steps = data.steps;
    if (data.chart_type !== undefined) updateData.chart_type = data.chart_type;
    if (data.pinned !== undefined) updateData.pinned = data.pinned;

    const { data: funnel, error } = await this.supabase
      .from("funnels")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return funnel;
  }

  async deleteFunnel(id: string): Promise<void> {
    const { error } = await this.supabase.from("funnels").delete().eq("id", id);

    if (error) throw error;
  }

  // Advanced Analytics
  async getFlowAnalytics(projectId: string, filters?: any): Promise<any> {
    let query = this.supabase
      .from("events")
      .select("*")
      .eq("project_id", projectId)
      .in("event_name", [
        "Flow Started",
        "Flow Step Viewed",
        "Flow Step Completed",
        "Flow Step Exited",
        "Flow Completed",
        "Flow Abandoned",
        "Onboarding Started",
        "Onboarding Step Viewed",
        "Onboarding Step Completed",
        "Onboarding Step Exited",
        "Onboarding Completed",
        "Onboarding Abandoned",
      ]);

    if (filters?.startDate) {
      query = query.gte(
        "created_at",
        new Date(filters.startDate).toISOString()
      );
    }
    if (filters?.endDate) {
      query = query.lte("created_at", new Date(filters.endDate).toISOString());
    }

    const { data: events, error } = await query;
    if (error) throw error;

    // Filter by flowId or flowType if provided
    let filteredEvents = events || [];
    if (filters?.flowId) {
      filteredEvents = filteredEvents.filter((e) => {
        const props = e.properties || {};
        return props.flow_id === filters.flowId;
      });
    }
    if (filters?.flowType) {
      filteredEvents = filteredEvents.filter((e) => {
        const props = e.properties || {};
        return props.flow_type === filters.flowType;
      });
    }

    // Process flow analytics from events
    const flows: Record<string, any> = {};
    const flowTotalSteps: Record<string, number> = {};

    // Initialize flows from any flow event
    filteredEvents.forEach((event) => {
      const props = event.properties || {};
      const flowId = props.flow_id;
      if (!flowId) return;

      // Store total_steps from any event that has it
      if (props.total_steps && !flowTotalSteps[flowId]) {
        flowTotalSteps[flowId] = props.total_steps;
      }

      if (!flows[flowId]) {
        flows[flowId] = {
          flow_id: flowId,
          flow_type: props.flow_type || "custom",
          total_starts: 0,
          total_completions: 0,
          total_abandonments: 0,
          completion_rate: 0,
          drop_off_by_step: {} as Record<number, number>,
          average_step_duration: {} as Record<number, number>,
          step_views: {} as Record<number, number>,
        };
      }
    });

    const flowStarts = filteredEvents.filter(
      (e) =>
        e.event_name === "Flow Started" || e.event_name === "Onboarding Started"
    );
    const flowCompletions = filteredEvents.filter(
      (e) =>
        e.event_name === "Flow Completed" ||
        e.event_name === "Onboarding Completed"
    );
    const flowAbandonments = filteredEvents.filter(
      (e) =>
        e.event_name === "Flow Abandoned" ||
        e.event_name === "Onboarding Abandoned"
    );

    // Count step views to infer starts
    const stepViews = filteredEvents.filter(
      (e) =>
        e.event_name === "Flow Step Viewed" ||
        e.event_name === "Onboarding Step Viewed"
    );

    stepViews.forEach((view) => {
      const props = view.properties || {};
      const flowId = props.flow_id;
      const step = props.step;
      if (flowId && flows[flowId] && step) {
        flows[flowId].step_views[step] =
          (flows[flowId].step_views[step] || 0) + 1;
      }
    });

    flowStarts.forEach((start) => {
      const props = start.properties || {};
      const flowId = props.flow_id;
      if (flows[flowId]) {
        flows[flowId].total_starts++;
      }
    });

    // If no explicit starts, use step 1 views as starts
    Object.values(flows).forEach((flow: any) => {
      if (flow.total_starts === 0 && flow.step_views[1]) {
        flow.total_starts = flow.step_views[1];
      }
    });

    flowCompletions.forEach((completion) => {
      const props = completion.properties || {};
      const flowId = props.flow_id;
      if (flows[flowId]) {
        flows[flowId].total_completions++;
      }
    });

    // Infer completions from step completions on the last step
    const stepCompletions = filteredEvents.filter(
      (e) =>
        e.event_name === "Flow Step Completed" ||
        e.event_name === "Onboarding Step Completed"
    );

    stepCompletions.forEach((completion) => {
      const props = completion.properties || {};
      const flowId = props.flow_id;
      const step = props.step;
      // Get total_steps from flowTotalSteps map (from step viewed events) or from this event
      const totalSteps = props.total_steps || flowTotalSteps[flowId];

      // If this is the last step and we haven't already counted a completion
      if (
        flowId &&
        flows[flowId] &&
        step &&
        totalSteps &&
        step === totalSteps
      ) {
        // Check if we already have a "Flow Completed" event for this flow
        const hasExplicitCompletion = flowCompletions.some((c) => {
          const cProps = c.properties || {};
          return cProps.flow_id === flowId;
        });

        // If no explicit completion, infer it from completing the last step
        if (!hasExplicitCompletion) {
          // Only count once per unique session/user combination
          const sessionId = completion.session_id;
          const userId = completion.user_id;
          const completionKey = `${flowId}_${sessionId}_${userId}`;

          if (!flows[flowId]._inferredCompletions) {
            flows[flowId]._inferredCompletions = new Set();
          }

          if (!flows[flowId]._inferredCompletions.has(completionKey)) {
            flows[flowId].total_completions++;
            flows[flowId]._inferredCompletions.add(completionKey);
          }
        }
      }
    });

    flowAbandonments.forEach((abandonment) => {
      const props = abandonment.properties || {};
      const flowId = props.flow_id;
      const step = props.abandoned_at_step;
      if (flows[flowId]) {
        flows[flowId].total_abandonments++;
        if (step) {
          flows[flowId].drop_off_by_step[step] =
            (flows[flowId].drop_off_by_step[step] || 0) + 1;
        }
      }
    });

    Object.values(flows).forEach((flow: any) => {
      if (flow.total_starts > 0) {
        flow.completion_rate =
          (flow.total_completions / flow.total_starts) * 100;
      }
    });

    const stepCompletedEvents = filteredEvents.filter(
      (e) =>
        e.event_name === "Flow Step Completed" ||
        e.event_name === "Onboarding Step Completed"
    );

    stepCompletedEvents.forEach((event) => {
      const props = event.properties || {};
      const flowId = props.flow_id;
      const step = props.step;
      const duration =
        props.step_duration_ms || props.step_duration_seconds * 1000;

      if (flowId && step && flows[flowId]) {
        if (!flows[flowId].average_step_duration[step]) {
          flows[flowId].average_step_duration[step] = { total: 0, count: 0 };
        }
        flows[flowId].average_step_duration[step].total += duration;
        flows[flowId].average_step_duration[step].count++;
      }
    });

    Object.values(flows).forEach((flow: any) => {
      Object.keys(flow.average_step_duration).forEach((step) => {
        const data = flow.average_step_duration[step];
        if (data.count > 0) {
          flow.average_step_duration[step] = Math.round(
            data.total / data.count
          );
        }
      });

      // Clean up internal tracking fields before returning
      delete flow._inferredCompletions;
      delete flow.step_views; // Optional: remove if you don't want to expose this
    });

    // Calculate overall stats from flows (not just explicit events)
    const totalStarts = Object.values(flows).reduce(
      (sum: number, flow: any) => sum + flow.total_starts,
      0
    );
    const totalCompletions = Object.values(flows).reduce(
      (sum: number, flow: any) => sum + flow.total_completions,
      0
    );
    const totalAbandonments = Object.values(flows).reduce(
      (sum: number, flow: any) => sum + flow.total_abandonments,
      0
    );

    return {
      flows: Object.values(flows),
      total_flows: Object.keys(flows).length,
      total_starts: totalStarts,
      total_completions: totalCompletions,
      total_abandonments: totalAbandonments,
      overall_completion_rate:
        totalStarts > 0 ? (totalCompletions / totalStarts) * 100 : 0,
    };
  }

  async getScreenTimeAnalytics(projectId: string, filters?: any): Promise<any> {
    let query = this.supabase
      .from("events")
      .select("*")
      .eq("project_id", projectId)
      .eq("event_name", "Screen Time");

    if (filters?.startDate) {
      query = query.gte(
        "created_at",
        new Date(filters.startDate).toISOString()
      );
    }
    if (filters?.endDate) {
      query = query.lte("created_at", new Date(filters.endDate).toISOString());
    }

    const { data: events, error } = await query;
    if (error) throw error;

    let filteredEvents = events || [];
    if (filters?.screen) {
      filteredEvents = filteredEvents.filter((e) => {
        const props = e.properties || {};
        return props.screen === filters.screen;
      });
    }

    const screenStats: Record<string, any> = {};

    filteredEvents.forEach((event) => {
      const props = event.properties || {};
      const screen = props.screen;
      const duration = props.duration_ms || props.duration_seconds * 1000;

      if (!screen) return;

      if (!screenStats[screen]) {
        screenStats[screen] = {
          screen,
          total_views: 0,
          total_time_ms: 0,
          average_time_ms: 0,
          min_time_ms: Infinity,
          max_time_ms: 0,
        };
      }

      screenStats[screen].total_views++;
      screenStats[screen].total_time_ms += duration;
      screenStats[screen].min_time_ms = Math.min(
        screenStats[screen].min_time_ms,
        duration
      );
      screenStats[screen].max_time_ms = Math.max(
        screenStats[screen].max_time_ms,
        duration
      );
    });

    Object.values(screenStats).forEach((stat: any) => {
      if (stat.total_views > 0) {
        stat.average_time_ms = Math.round(
          stat.total_time_ms / stat.total_views
        );
        stat.average_time_seconds = Math.round(stat.average_time_ms / 1000);
      }
      if (stat.min_time_ms === Infinity) {
        stat.min_time_ms = 0;
      }
    });

    return {
      screens: Object.values(screenStats).sort(
        (a: any, b: any) => b.average_time_ms - a.average_time_ms
      ),
      total_screens: Object.keys(screenStats).length,
      total_screen_views: filteredEvents.length,
    };
  }

  async getFeatureUsageAnalytics(
    projectId: string,
    filters?: any
  ): Promise<any> {
    let query = this.supabase
      .from("events")
      .select("*")
      .eq("project_id", projectId)
      .in("event_name", ["Feature Used", "Feature Viewed"]);

    if (filters?.startDate) {
      query = query.gte(
        "created_at",
        new Date(filters.startDate).toISOString()
      );
    }
    if (filters?.endDate) {
      query = query.lte("created_at", new Date(filters.endDate).toISOString());
    }

    const { data: events, error } = await query;
    if (error) throw error;

    let filteredEvents = events || [];
    if (filters?.feature) {
      filteredEvents = filteredEvents.filter((e) => {
        const props = e.properties || {};
        return props.feature === filters.feature;
      });
    }

    const featureStats: Record<string, any> = {};

    filteredEvents.forEach((event) => {
      const props = event.properties || {};
      const feature = props.feature;
      const eventName = event.event_name;
      const isUsed = eventName === "Feature Used";
      const isViewed = eventName === "Feature Viewed";

      if (!feature) return;

      if (!featureStats[feature]) {
        featureStats[feature] = {
          feature,
          total_uses: 0,
          total_views: 0,
          unique_users: new Set<string>(),
          screens: new Set<string>(),
          categories: new Set<string>(),
        };
      }

      if (isUsed) {
        featureStats[feature].total_uses++;
      }
      if (isViewed) {
        featureStats[feature].total_views++;
      }

      const userId = event.user_id;
      if (userId) {
        featureStats[feature].unique_users.add(userId);
      }

      if (props.screen) {
        featureStats[feature].screens.add(props.screen);
      }

      if (props.feature_category) {
        featureStats[feature].categories.add(props.feature_category);
      }
    });

    const features = Object.values(featureStats).map((stat: any) => ({
      feature: stat.feature,
      total_uses: stat.total_uses,
      total_views: stat.total_views,
      unique_users: stat.unique_users.size,
      screens: Array.from(stat.screens),
      categories: Array.from(stat.categories),
      usage_rate:
        stat.total_views > 0 ? (stat.total_uses / stat.total_views) * 100 : 0,
    }));

    return {
      features: features.sort((a: any, b: any) => b.total_uses - a.total_uses),
      total_features: features.length,
      total_feature_uses: filteredEvents.filter(
        (e) => e.event_name === "Feature Used"
      ).length,
      total_feature_views: filteredEvents.filter(
        (e) => e.event_name === "Feature Viewed"
      ).length,
    };
  }

  async getScrollAnalytics(projectId: string, filters?: any): Promise<any> {
    let query = this.supabase
      .from("events")
      .select("*")
      .eq("project_id", projectId)
      .in("event_name", ["Scroll Depth", "Scroll Event"]);

    if (filters?.startDate) {
      query = query.gte(
        "created_at",
        new Date(filters.startDate).toISOString()
      );
    }
    if (filters?.endDate) {
      query = query.lte("created_at", new Date(filters.endDate).toISOString());
    }

    const { data: events, error } = await query;
    if (error) throw error;

    let filteredEvents = events || [];
    if (filters?.screen) {
      filteredEvents = filteredEvents.filter((e) => {
        const props = e.properties || {};
        return props.screen === filters.screen;
      });
    }

    const scrollStats: Record<string, any> = {};

    filteredEvents.forEach((event) => {
      const props = event.properties || {};
      const screen = props.screen;
      const threshold = props.scroll_threshold;
      const percentage = props.scroll_percentage;

      if (!screen) return;

      if (!scrollStats[screen]) {
        scrollStats[screen] = {
          screen,
          total_scroll_events: 0,
          unique_users: new Set<string>(),
          threshold_reached: {} as Record<number, number>,
          average_scroll_depth: 0,
          scroll_depths: [] as number[],
        };
      }

      scrollStats[screen].total_scroll_events++;

      const userId = event.user_id;
      if (userId) {
        scrollStats[screen].unique_users.add(userId);
      }

      if (threshold !== undefined) {
        scrollStats[screen].threshold_reached[threshold] =
          (scrollStats[screen].threshold_reached[threshold] || 0) + 1;
      }

      if (percentage !== undefined) {
        scrollStats[screen].scroll_depths.push(percentage);
      }
    });

    const screens = Object.values(scrollStats).map((stat: any) => {
      const avgDepth =
        stat.scroll_depths.length > 0
          ? Math.round(
              stat.scroll_depths.reduce((a: number, b: number) => a + b, 0) /
                stat.scroll_depths.length
            )
          : 0;

      return {
        screen: stat.screen,
        total_scroll_events: stat.total_scroll_events,
        unique_users: stat.unique_users.size,
        threshold_reached: stat.threshold_reached,
        average_scroll_depth: avgDepth,
      };
    });

    return {
      screens: screens.sort(
        (a: any, b: any) => b.average_scroll_depth - a.average_scroll_depth
      ),
      total_screens: screens.length,
      total_scroll_events: filteredEvents.length,
    };
  }

  // Segments
  async createSegment(data: any): Promise<Segment> {
    const { data: segment, error } = await this.supabase
      .from("segments")
      .insert({
        project_id: data.project_id,
        name: data.name,
        description: data.description || null,
        segment_type: data.segment_type || "dynamic",
        criteria: data.criteria || { conditions: [], logic: "AND" },
        cached_size: 0,
        is_active: data.is_active !== undefined ? data.is_active : true,
      })
      .select()
      .single();

    if (error) throw error;
    return segment;
  }

  async getSegment(id: string): Promise<Segment | null> {
    const { data, error } = await this.supabase
      .from("segments")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  async listSegments(projectId?: string): Promise<Segment[]> {
    let query = this.supabase.from("segments").select("*");

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });
    if (error) throw error;
    return data || [];
  }

  async updateSegment(id: string, data: any): Promise<Segment> {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.segment_type !== undefined)
      updateData.segment_type = data.segment_type;
    if (data.criteria !== undefined) updateData.criteria = data.criteria;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const { data: segment, error } = await this.supabase
      .from("segments")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return segment;
  }

  async deleteSegment(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("segments")
      .delete()
      .eq("id", id);

    if (error) throw error;
  }

  async getSegmentUsers(
    segmentId: string,
    filters?: { limit?: number; offset?: number }
  ): Promise<SegmentUser[]> {
    let query = this.supabase
      .from("segment_users")
      .select("user_id, anonymous_id, added_at")
      .eq("segment_id", segmentId)
      .order("added_at", { ascending: false });

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(
        filters.offset,
        filters.offset + (filters.limit || 100) - 1
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async calculateSegmentSize(
    segmentId: string,
    criteria: SegmentCriteria
  ): Promise<number> {
    // Get the segment's project
    const segment = await this.getSegment(segmentId);
    if (!segment) throw new Error("Segment not found");

    // Calculate matching users using the same logic as previewSegmentSize
    const matchingUsers = await this.calculateMatchingUsers(
      segment.project_id,
      criteria
    );

    // Clear existing segment users
    const { error: deleteError } = await this.supabase
      .from("segment_users")
      .delete()
      .eq("segment_id", segmentId);

    if (deleteError) throw deleteError;

    // Insert matching users into segment_users table
    if (matchingUsers.length > 0) {
      const usersToInsert = matchingUsers.map((userKey) => {
        const [type, id] = userKey.split(":");
        if (type === "user") {
          return {
            segment_id: segmentId,
            user_id: id,
            anonymous_id: null,
          };
        } else {
          return {
            segment_id: segmentId,
            user_id: id, // Use anonymous_id as user_id for anonymous users
            anonymous_id: id,
          };
        }
      });

      // Insert in batches to avoid hitting limits
      const batchSize = 1000;
      for (let i = 0; i < usersToInsert.length; i += batchSize) {
        const batch = usersToInsert.slice(i, i + batchSize);
        const { error: insertError } = await this.supabase
          .from("segment_users")
          .insert(batch);

        if (insertError) throw insertError;
      }
    }

    return matchingUsers.length;
  }

  private async calculateMatchingUsers(
    projectId: string,
    criteria: SegmentCriteria
  ): Promise<string[]> {
    if (!criteria.conditions || criteria.conditions.length === 0) {
      // No conditions means all users match
      // Get distinct users from events for this project
      const { data: userData, error: userError } = await this.supabase
        .from("events")
        .select("user_id, anonymous_id")
        .eq("project_id", projectId)
        .limit(10000); // Reasonable limit

      if (userError) throw userError;

      const uniqueUsers = new Set<string>();
      (userData || []).forEach((event: any) => {
        if (event.user_id) {
          uniqueUsers.add(`user:${event.user_id}`);
        } else if (event.anonymous_id) {
          uniqueUsers.add(`anon:${event.anonymous_id}`);
        }
      });

      return Array.from(uniqueUsers);
    }

    // Build queries for each condition
    const conditionQueries: Promise<Set<string>>[] = criteria.conditions.map(
      async (condition) => {
        let query = this.supabase
          .from("events")
          .select(
            "user_id, anonymous_id, event_name, properties, timestamp, created_at"
          )
          .eq("project_id", projectId);

        // Apply timeframe filter if specified
        if (condition.timeframe) {
          const timeframe = condition.timeframe;
          if (
            timeframe.type === "last_n_days" &&
            typeof timeframe.value === "number"
          ) {
            const daysAgo = new Date();
            daysAgo.setDate(daysAgo.getDate() - timeframe.value);
            query = query.gte("created_at", daysAgo.toISOString());
          } else if (
            timeframe.type === "between" &&
            typeof timeframe.value === "object" &&
            timeframe.value.start &&
            timeframe.value.end
          ) {
            query = query
              .gte("created_at", new Date(timeframe.value.start).toISOString())
              .lte("created_at", new Date(timeframe.value.end).toISOString());
          } else if (
            timeframe.type === "since" &&
            typeof timeframe.value === "string"
          ) {
            query = query.gte(
              "created_at",
              new Date(timeframe.value).toISOString()
            );
          } else if (
            timeframe.type === "before" &&
            typeof timeframe.value === "string"
          ) {
            query = query.lte(
              "created_at",
              new Date(timeframe.value).toISOString()
            );
          }
        }

        // Apply condition-specific filters
        if (condition.type === "event") {
          if (condition.operator === "performed" && condition.field) {
            query = query.eq("event_name", condition.field);
          } else if (
            condition.operator === "not_performed" &&
            condition.field
          ) {
            query = query.neq("event_name", condition.field);
          }
        }
        // Note: Property conditions will be filtered in memory after fetching

        // Fetch events (with reasonable limit for calculation)
        const { data: events, error } = await query.limit(10000);

        if (error) throw error;

        // Filter events based on condition
        let filteredEvents = events || [];

        if (condition.type === "property" && condition.field) {
          filteredEvents = filteredEvents.filter((event: any) => {
            const props = event.properties || {};
            const propValue = props[condition.field];

            if (condition.operator === "equals") {
              return propValue === condition.value;
            } else if (condition.operator === "not_equals") {
              return propValue !== condition.value;
            } else if (condition.operator === "contains") {
              return (
                propValue && String(propValue).includes(String(condition.value))
              );
            } else if (condition.operator === "not_contains") {
              return (
                !propValue ||
                !String(propValue).includes(String(condition.value))
              );
            } else if (condition.operator === "exists") {
              return propValue !== undefined && propValue !== null;
            } else if (condition.operator === "not_exists") {
              return propValue === undefined || propValue === null;
            } else if (condition.operator === "greater_than") {
              return (
                propValue !== undefined &&
                Number(propValue) > Number(condition.value)
              );
            } else if (condition.operator === "less_than") {
              return (
                propValue !== undefined &&
                Number(propValue) < Number(condition.value)
              );
            }
            return false;
          });
        }

        // Extract unique users from matching events
        const uniqueUsers = new Set<string>();
        filteredEvents.forEach((event: any) => {
          if (event.user_id) {
            uniqueUsers.add(`user:${event.user_id}`);
          } else if (event.anonymous_id) {
            uniqueUsers.add(`anon:${event.anonymous_id}`);
          }
        });

        return uniqueUsers;
      }
    );

    // Wait for all condition queries
    const conditionResults = await Promise.all(conditionQueries);

    // Apply logic (AND or OR)
    if (criteria.logic === "AND") {
      // Intersection: users that match ALL conditions
      if (conditionResults.length === 0) return [];

      let intersection = conditionResults[0];
      for (let i = 1; i < conditionResults.length; i++) {
        intersection = new Set(
          [...intersection].filter((user) => conditionResults[i].has(user))
        );
      }
      return Array.from(intersection);
    } else {
      // OR: users that match ANY condition
      const union = new Set<string>();
      conditionResults.forEach((userSet) => {
        userSet.forEach((user) => union.add(user));
      });
      return Array.from(union);
    }
  }

  async updateSegmentSize(segmentId: string, size: number): Promise<void> {
    const { error } = await this.supabase
      .from("segments")
      .update({
        cached_size: size,
        last_calculated_at: new Date().toISOString(),
      })
      .eq("id", segmentId);

    if (error) throw error;
  }

  async previewSegmentSize(
    projectId: string,
    criteria: SegmentCriteria
  ): Promise<number> {
    // Reuse the same calculation logic
    const matchingUsers = await this.calculateMatchingUsers(
      projectId,
      criteria
    );
    return matchingUsers.length;
  }

  // Platform Users
  async getUser(userId: string): Promise<PlatformUser | null> {
    const { data, error } = await this.supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  async getOrCreateUser(userId: string): Promise<PlatformUser> {
    // Try to get existing user
    let user: PlatformUser | null = await this.getUser(userId);

    // If user doesn't exist, create it (fallback if trigger didn't fire)
    if (!user) {
      const { data, error } = await this.supabase
        .from("users")
        .insert({
          id: userId,
          onboarding_answers: {},
          onboarding_completed: false,
          subscription_status: "free",
          subscription_plan: "free",
        })
        .select()
        .single();

      if (error) throw error;
      user = data as PlatformUser;
    }

    return user;
  }

  async updateUser(
    userId: string,
    data: {
      onboarding_answers?: Record<string, any>;
      onboarding_completed?: boolean;
      subscription_status?: string;
      subscription_plan?: string;
    }
  ): Promise<PlatformUser> {
    const updateData: any = {};

    if (data.onboarding_answers !== undefined) {
      updateData.onboarding_answers = data.onboarding_answers;
    }
    if (data.onboarding_completed !== undefined) {
      updateData.onboarding_completed = data.onboarding_completed;
    }
    if (data.subscription_status !== undefined) {
      updateData.subscription_status = data.subscription_status;
    }
    if (data.subscription_plan !== undefined) {
      updateData.subscription_plan = data.subscription_plan;
    }

    const { data: updatedUser, error } = await this.supabase
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    return updatedUser;
  }
}
