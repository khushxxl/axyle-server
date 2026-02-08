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
    if (!userId) {
      // If no userId, return all projects (admin view)
      const { data, error } = await this.supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }

    // Get projects where user is a team member
    const { data: teamMemberships, error: teamError } = await this.supabase
      .from("project_team_members")
      .select("project_id, role")
      .eq("user_id", userId);

    if (teamError) throw teamError;

    if (!teamMemberships || teamMemberships.length === 0) {
      return [];
    }

    const projectIds = teamMemberships.map((m) => m.project_id);

    // Get project details
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .in("id", projectIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Enrich with role information
    const enrichedProjects = (data || []).map((project) => {
      const membership = teamMemberships.find(
        (m) => m.project_id === project.id
      );
      return {
        ...project,
        role: membership?.role || "member",
      };
    });

    return enrichedProjects;
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
    // Look up by key_hash only. The "key" column is UUID type (legacy); plain keys
    // are not stored — we only store key_hash, so comparing key to a non-UUID string
    // would cause "invalid input syntax for type uuid" in PostgreSQL.
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
      .eq("key_hash", keyHash)
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

    // Apply limit and offset using range
    const limit = filters?.limit || 100;
    const offset = filters?.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getEventStats(projectId: string, filters?: any): Promise<any> {
    // Use count-only RPC so we never hit PostgREST default row limit (1000)
    const startDate = filters?.startDate
      ? new Date(filters.startDate + "T00:00:00").toISOString()
      : null;
    const endDate = filters?.endDate
      ? new Date(filters.endDate + "T23:59:59.999").toISOString()
      : null;

    const { data: rpcData, error: rpcError } = await this.supabase.rpc(
      "get_project_event_stats",
      {
        p_project_id: projectId,
        start_date: startDate,
        end_date: endDate,
      }
    );

    if (!rpcError && rpcData) {
      return rpcData;
    }

    // Fallback: fetch rows (capped by Supabase default 1000 - run migration 020 to fix)
    if (rpcError) {
      console.warn(
        "get_project_event_stats not available, using fallback (count may be capped at 1000):",
        rpcError.message
      );
    }

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

    // Generate eventsOverTime with appropriate granularity based on date range
    // - Today/Yesterday (1-2 days): Hourly (00:00, 01:00, ...)
    // - 7 days (8 days inclusive): Daily (Mon, Tue, Wed, ...)
    // - 30 days: Weekly (Week 1, Week 2, ...)
    // - 90 days: Weekly (Week 1, Week 2, ...)
    // - All time (no filters): Monthly (Jan, Feb, ...)

    const now = new Date();
    let dateRangeDays = 0; // 0 means "all time" (no date filters)

    if (filters?.startDate && filters?.endDate) {
      const start = new Date(filters.startDate);
      const end = new Date(filters.endDate);
      dateRangeDays =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
    } else if (filters?.startDate) {
      const start = new Date(filters.startDate);
      dateRangeDays =
        Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
    }

    // Determine granularity
    // Note: "7 days" selection gives 8 days inclusive (7 days ago through today)
    type Granularity = "hourly" | "daily" | "weekly" | "monthly";
    let granularity: Granularity;

    if (dateRangeDays === 0) {
      // All time - use monthly
      granularity = "monthly";
    } else if (dateRangeDays <= 2) {
      // Today or Yesterday - use hourly
      granularity = "hourly";
    } else if (dateRangeDays <= 8) {
      // 7 days (8 days inclusive) - use daily (Mon, Tue, Wed...)
      granularity = "daily";
    } else if (dateRangeDays <= 91) {
      // 30-90 days (up to 91 days inclusive) - use weekly
      granularity = "weekly";
    } else {
      // More than 90 days - use monthly
      granularity = "monthly";
    }

    const eventsByTime: Record<string, number> = {};
    const weekStartDates: Record<string, Date> = {}; // Track actual start dates for sorting

    allEvents?.forEach((event) => {
      const eventDate = new Date(event.created_at);
      let timeKey: string;

      switch (granularity) {
        case "hourly":
          // Format: "00:00", "01:00", etc.
          timeKey = `${String(eventDate.getHours()).padStart(2, "0")}:00`;
          break;
        case "daily":
          // Format: "Mon", "Tue", etc.
          timeKey = eventDate.toLocaleDateString("en-US", { weekday: "short" });
          break;
        case "weekly":
          // Format: "Week 1", "Week 2", etc. (based on start date)
          const startDate = filters?.startDate
            ? new Date(filters.startDate)
            : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          const daysSinceStart = Math.floor(
            (eventDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          const weekNumber = Math.floor(daysSinceStart / 7) + 1;
          timeKey = `Week ${weekNumber}`;
          if (!weekStartDates[timeKey]) {
            weekStartDates[timeKey] = new Date(
              startDate.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000
            );
          }
          break;
        case "monthly":
          // Format: "Jan", "Feb", etc.
          timeKey = eventDate.toLocaleDateString("en-US", { month: "short" });
          break;
      }

      eventsByTime[timeKey] = (eventsByTime[timeKey] || 0) + 1;
    });

    // Sort by time based on granularity
    const eventsOverTime = Object.entries(eventsByTime)
      .sort(([a], [b]) => {
        switch (granularity) {
          case "hourly":
            return a.localeCompare(b);
          case "daily":
            const dayOrder: Record<string, number> = {
              Mon: 1,
              Tue: 2,
              Wed: 3,
              Thu: 4,
              Fri: 5,
              Sat: 6,
              Sun: 7,
            };
            return (dayOrder[a] || 0) - (dayOrder[b] || 0);
          case "weekly":
            // Sort by week number
            const weekA = parseInt(a.replace("Week ", ""));
            const weekB = parseInt(b.replace("Week ", ""));
            return weekA - weekB;
          case "monthly":
            const monthOrder: Record<string, number> = {
              Jan: 1,
              Feb: 2,
              Mar: 3,
              Apr: 4,
              May: 5,
              Jun: 6,
              Jul: 7,
              Aug: 8,
              Sep: 9,
              Oct: 10,
              Nov: 11,
              Dec: 12,
            };
            return (monthOrder[a] || 0) - (monthOrder[b] || 0);
          default:
            return 0;
        }
      })
      .map(([hour, count]) => ({ hour, count }));

    return {
      overview: {
        total_events: totalEvents,
        unique_users: uniqueUsers,
        unique_sessions: uniqueSessions,
        unique_devices: uniqueDevices,
      },
      topEvents,
      eventsOverTime,
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
    // Use database functions for efficient count-only aggregation (no full row fetch)
    const rpcName =
      filters?.startDate || filters?.endDate
        ? "get_global_event_stats_filtered"
        : "get_global_event_stats";

    const rpcParams: Record<string, unknown> =
      rpcName === "get_global_event_stats_filtered"
        ? {
            project_ids:
              projectIds && projectIds.length > 0 ? projectIds : null,
            start_date: filters?.startDate
              ? new Date(filters.startDate + "T00:00:00").toISOString()
              : null,
            end_date: filters?.endDate
              ? new Date(filters.endDate + "T23:59:59.999").toISOString()
              : null,
          }
        : {
            project_ids:
              projectIds && projectIds.length > 0 ? projectIds : null,
          };

    const { data, error } = await this.supabase.rpc(rpcName, rpcParams);

    if (error) {
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
    // Get ALL events in a single query
    let query = this.supabase
      .from("events")
      .select("event_name, user_id, session_id, anonymous_id, created_at");

    if (projectIds && projectIds.length > 0) {
      query = query.in("project_id", projectIds);
    }

    const { data: allEvents, error } = await query;
    if (error) throw error;

    const allEventList = allEvents || [];

    // Calculate overview stats from ALL events (not filtered)
    const totalEvents = allEventList.length;
    const uniqueUsers = new Set(
      allEventList.filter((e) => e.user_id).map((e) => e.user_id)
    ).size;
    const uniqueSessions = new Set(allEventList.map((e) => e.session_id)).size;
    const uniqueDevices = new Set(allEventList.map((e) => e.anonymous_id)).size;

    // Event counts by name (from all events)
    const eventCounts: Record<string, number> = {};
    allEventList.forEach((event) => {
      const eventName = event.event_name;
      if (eventName) {
        eventCounts[eventName] = (eventCounts[eventName] || 0) + 1;
      }
    });

    const topEvents = Object.entries(eventCounts)
      .map(([event_name, count]) => ({ event_name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Filter events in memory for eventsOverTime (to avoid second query)
    const eventList =
      filters?.startDate || filters?.endDate
        ? allEventList.filter((event) => {
            const eventDate = new Date(event.created_at);
            // Parse dates in local timezone, not UTC
            const startDate = filters.startDate
              ? new Date(filters.startDate + "T00:00:00")
              : null;
            const endDate = filters.endDate
              ? new Date(filters.endDate + "T23:59:59.999")
              : null;

            if (startDate && endDate) {
              return eventDate >= startDate && eventDate <= endDate;
            } else if (startDate) {
              return eventDate >= startDate;
            } else if (endDate) {
              return eventDate <= endDate;
            }
            return true;
          })
        : allEventList;

    // Generate eventsOverTime with appropriate granularity based on date range
    // - Today/Yesterday (1-2 days): Hourly (00:00, 01:00, ...)
    // - 7 days: Daily (Mon, Tue, Wed, ...)
    // - 30 days: Weekly (Week 1, Week 2, ...)
    // - 90 days: Weekly (Week 1, Week 2, ...)
    // - All time (no filters): Monthly (Jan, Feb, ...)

    const now = new Date();
    let dateRangeDays = 0; // 0 means "all time" (no date filters)

    if (filters?.startDate && filters?.endDate) {
      const start = new Date(filters.startDate);
      const end = new Date(filters.endDate);
      dateRangeDays =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
    } else if (filters?.startDate) {
      const start = new Date(filters.startDate);
      dateRangeDays =
        Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
    }

    // Determine granularity
    // Note: "7 days" selection gives 8 days inclusive (7 days ago through today)
    type Granularity = "hourly" | "daily" | "weekly" | "monthly";
    let granularity: Granularity;

    if (dateRangeDays === 0) {
      // All time - use monthly
      granularity = "monthly";
    } else if (dateRangeDays <= 2) {
      // Today or Yesterday - use hourly
      granularity = "hourly";
    } else if (dateRangeDays <= 8) {
      // 7 days (8 days inclusive) - use daily (Mon, Tue, Wed...)
      granularity = "daily";
    } else if (dateRangeDays <= 91) {
      // 30-90 days (up to 91 days inclusive) - use weekly
      granularity = "weekly";
    } else {
      // More than 90 days - use monthly
      granularity = "monthly";
    }

    const eventsByTime: Record<string, number> = {};

    // eventList is already filtered by the query above, so use it directly
    eventList.forEach((event) => {
      const eventDate = new Date(event.created_at);
      let timeKey: string;

      switch (granularity) {
        case "hourly":
          // Format: "00:00", "01:00", etc.
          timeKey = `${String(eventDate.getHours()).padStart(2, "0")}:00`;
          break;
        case "daily":
          // Format: "Mon", "Tue", etc.
          timeKey = eventDate.toLocaleDateString("en-US", { weekday: "short" });
          break;
        case "weekly":
          // Format: "Week 1", "Week 2", etc. (based on start date)
          const startDate = filters?.startDate
            ? new Date(filters.startDate)
            : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          const daysSinceStart = Math.floor(
            (eventDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          const weekNumber = Math.floor(daysSinceStart / 7) + 1;
          timeKey = `Week ${weekNumber}`;
          break;
        case "monthly":
          // Format: "Jan", "Feb", etc.
          timeKey = eventDate.toLocaleDateString("en-US", { month: "short" });
          break;
      }

      eventsByTime[timeKey] = (eventsByTime[timeKey] || 0) + 1;
    });

    // Sort by time based on granularity
    const eventsOverTime = Object.entries(eventsByTime)
      .sort(([a], [b]) => {
        switch (granularity) {
          case "hourly":
            return a.localeCompare(b);
          case "daily":
            const dayOrder: Record<string, number> = {
              Mon: 1,
              Tue: 2,
              Wed: 3,
              Thu: 4,
              Fri: 5,
              Sat: 6,
              Sun: 7,
            };
            return (dayOrder[a] || 0) - (dayOrder[b] || 0);
          case "weekly":
            // Sort by week number
            const weekA = parseInt(a.replace("Week ", ""));
            const weekB = parseInt(b.replace("Week ", ""));
            return weekA - weekB;
          case "monthly":
            const monthOrder: Record<string, number> = {
              Jan: 1,
              Feb: 2,
              Mar: 3,
              Apr: 4,
              May: 5,
              Jun: 6,
              Jul: 7,
              Aug: 8,
              Sep: 9,
              Oct: 10,
              Nov: 11,
              Dec: 12,
            };
            return (monthOrder[a] || 0) - (monthOrder[b] || 0);
          default:
            return 0;
        }
      })
      .map(([hour, count]) => ({ hour, count }));

    return {
      overview: {
        total_events: totalEvents,
        unique_users: uniqueUsers,
        unique_sessions: uniqueSessions,
        unique_devices: uniqueDevices,
      },
      topEvents,
      eventsOverTime,
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
        pinned: data.pinned !== undefined ? data.pinned : true,
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

  async countFunnelsForProjectIds(projectIds: string[]): Promise<number> {
    if (!projectIds.length) return 0;
    const { count, error } = await this.supabase
      .from("funnels")
      .select("*", { count: "exact", head: true })
      .in("project_id", projectIds);
    if (error) throw error;
    return count ?? 0;
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
    let isNewUser = false;

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
          welcome_email_sent: false,
        })
        .select()
        .single();

      if (error) throw error;
      user = data as PlatformUser;
      isNewUser = true;
    }

    // Check if welcome email needs to be sent (for both new and existing users)
    // Use atomic update to prevent duplicate sends
    if (!user.welcome_email_sent) {
      // Try to atomically mark as "sending" to prevent race conditions
      const { data: updateResult } = await this.supabase
        .from("users")
        .update({ welcome_email_sent: true })
        .eq("id", userId)
        .eq("welcome_email_sent", false)
        .select()
        .single();

      // Only send email if we successfully updated (no race condition)
      if (updateResult) {
        this.sendWelcomeEmailAsync(userId).catch((err) => {
          console.error("Failed to send welcome email:", err);
          // Revert the flag if email fails
          this.supabase
            .from("users")
            .update({ welcome_email_sent: false })
            .eq("id", userId)
            .then(() => {});
        });
      }
    }

    return user;
  }

  private async sendWelcomeEmailAsync(userId: string): Promise<void> {
    try {
      // Import email service dynamically to avoid circular dependencies
      const { emailService } = await import("../services/emailService");

      // Get user's email from auth.users
      const { data: authUser, error } =
        await this.supabase.auth.admin.getUserById(userId);

      if (error || !authUser?.user?.email) {
        console.warn(`Unable to get email for user ${userId}`);
        throw new Error("Unable to get user email");
      }

      // Extract name from user metadata if available
      const name =
        authUser.user.user_metadata?.full_name ||
        authUser.user.user_metadata?.name ||
        undefined;

      // Send the welcome email
      await emailService.sendWelcomeEmail({
        email: authUser.user.email,
        name,
      });

      // Update timestamp after successful send
      await this.supabase
        .from("users")
        .update({
          welcome_email_sent_at: new Date().toISOString(),
        })
        .eq("id", userId);

      console.log(`Welcome email sent successfully to ${authUser.user.email}`);
    } catch (error) {
      console.error("Error in sendWelcomeEmailAsync:", error);
      throw error;
    }
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

  async getUserByEmail(email: string): Promise<PlatformUser | null> {
    // Get user from auth.users by email
    const { data: authUsers, error: authError } =
      await this.supabase.auth.admin.listUsers();

    if (authError) throw authError;

    const authUser = authUsers.users.find((u) => u.email === email);
    if (!authUser) return null;

    // Get platform user data
    return this.getUser(authUser.id);
  }

  // Team Members
  async getProjectTeamMembers(
    projectId: string
  ): Promise<import("./storage").TeamMember[]> {
    const { data, error } = await this.supabase
      .from("project_team_members")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Enrich with user data
    const enrichedMembers = await Promise.all(
      (data || []).map(async (member) => {
        const { data: authUser } = await this.supabase.auth.admin.getUserById(
          member.user_id
        );

        return {
          ...member,
          user: authUser?.user
            ? {
                id: authUser.user.id,
                email: authUser.user.email,
                name:
                  authUser.user.user_metadata?.full_name ||
                  authUser.user.user_metadata?.name ||
                  authUser.user.email?.split("@")[0],
                avatar_url:
                  authUser.user.user_metadata?.avatar_url ||
                  authUser.user.user_metadata?.picture,
              }
            : undefined,
        };
      })
    );

    return enrichedMembers;
  }

  async getTeamMember(
    memberId: string
  ): Promise<import("./storage").TeamMember | null> {
    const { data, error } = await this.supabase
      .from("project_team_members")
      .select("*")
      .eq("id", memberId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  }

  async addTeamMember(data: {
    projectId: string;
    userId: string;
    invitedBy: string;
  }): Promise<import("./storage").TeamMember> {
    const { data: member, error } = await this.supabase
      .from("project_team_members")
      .insert({
        project_id: data.projectId,
        user_id: data.userId,
        role: "member",
        invited_by: data.invitedBy,
      })
      .select()
      .single();

    if (error) throw error;
    return member;
  }

  async removeTeamMember(memberId: string): Promise<void> {
    const { error } = await this.supabase
      .from("project_team_members")
      .delete()
      .eq("id", memberId);

    if (error) throw error;
  }

  async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("project_team_members")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return !!data;
  }

  async isProjectOwner(projectId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("project_team_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("role", "owner")
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return !!data;
  }

  async canAddTeamMember(userId: string, projectId: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc("can_add_team_member", {
      p_user_id: userId,
      p_project_id: projectId,
    });

    if (error) throw error;
    return data;
  }

  async getProjectTeamCount(projectId: string): Promise<number> {
    const { data, error } = await this.supabase.rpc("get_project_team_count", {
      p_project_id: projectId,
    });

    if (error) throw error;
    return data || 0;
  }

  async hasTeamMemberships(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("project_team_members")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "member")
      .limit(1);

    if (error) throw error;
    return !!data && data.length > 0;
  }

  // Project invitations
  async createInvitation(data: {
    projectId: string;
    email: string;
    invitedBy: string;
    token: string;
    expiresAt: Date;
  }): Promise<{ id: string; token: string; expires_at: string }> {
    const { data: row, error } = await this.supabase
      .from("project_invitations")
      .insert({
        project_id: data.projectId,
        email: data.email.toLowerCase().trim(),
        invited_by: data.invitedBy,
        token: data.token,
        expires_at: data.expiresAt.toISOString(),
        status: "pending",
      })
      .select("id, token, expires_at")
      .single();

    if (error) throw error;
    return {
      id: row.id,
      token: row.token,
      expires_at: row.expires_at,
    };
  }

  async getInvitationByToken(token: string): Promise<{
    id: string;
    project_id: string;
    project_name: string;
    email: string;
    invited_by: string;
    status: string;
    expires_at: string;
  } | null> {
    const { data, error } = await this.supabase
      .from("project_invitations")
      .select(
        "id, project_id, email, invited_by, status, expires_at, projects(name)"
      )
      .eq("token", token)
      .single();

    if (error || !data) return null;
    const project = (data as any).projects;
    if (!project?.name) return null;
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date() || data.status !== "pending") return null;
    return {
      id: data.id,
      project_id: data.project_id,
      project_name: (project as { name: string }).name,
      email: data.email,
      invited_by: data.invited_by,
      status: data.status,
      expires_at: data.expires_at,
    };
  }

  async listPendingInvitations(
    projectId: string
  ): Promise<
    Array<{
      id: string;
      email: string;
      invited_by: string;
      expires_at: string;
      created_at: string;
    }>
  > {
    const { data, error } = await this.supabase
      .from("project_invitations")
      .select("id, email, invited_by, expires_at, created_at")
      .eq("project_id", projectId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      email: row.email,
      invited_by: row.invited_by,
      expires_at: row.expires_at,
      created_at: row.created_at,
    }));
  }

  async acceptInvitation(
    token: string,
    userId: string
  ): Promise<{ projectId: string; projectName: string } | { error: string }> {
    const inv = await this.getInvitationByToken(token);
    if (!inv) return { error: "Invalid or expired invitation" };

    const { data: authUser } = await this.supabase.auth.admin.getUserById(
      userId
    );
    if (!authUser?.user?.email) return { error: "User not found" };
    const userEmail = authUser.user.email.toLowerCase().trim();
    if (userEmail !== inv.email.toLowerCase()) {
      return { error: "This invitation was sent to a different email address" };
    }

    const alreadyMember = await this.isProjectMember(inv.project_id, userId);
    if (alreadyMember) {
      await this.supabase
        .from("project_invitations")
        .update({ status: "accepted" })
        .eq("id", inv.id);
      return { projectId: inv.project_id, projectName: inv.project_name };
    }

    await this.addTeamMember({
      projectId: inv.project_id,
      userId,
      invitedBy: inv.invited_by,
    });

    await this.supabase
      .from("project_invitations")
      .update({ status: "accepted" })
      .eq("id", inv.id);

    return { projectId: inv.project_id, projectName: inv.project_name };
  }

  // RevenueCat Integration
  async updateProjectRevenueCatConfig(
    projectId: string,
    config: {
      revenuecat_secret_key: string | null;
      revenuecat_project_id: string | null;
      revenuecat_enabled: boolean;
    }
  ): Promise<void> {
    const { error } = await this.supabase
      .from("projects")
      .update({
        revenuecat_secret_key: config.revenuecat_secret_key,
        revenuecat_project_id: config.revenuecat_project_id,
        revenuecat_enabled: config.revenuecat_enabled,
      })
      .eq("id", projectId);

    if (error) throw error;
  }
}
