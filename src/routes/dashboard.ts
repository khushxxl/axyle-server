/**
 * Dashboard routes - query data for the web dashboard (no API key auth)
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";
import { requireSupabaseAuth } from "../middleware/supabaseAuth";

const router = Router();

/**
 * GET /api/v1/dashboard/events
 * Get all events across all projects
 */
router.get("/events", async (req: Request, res: Response) => {
  try {
    const {
      limit = "100",
      offset = "0",
      eventName,
      projectId,
      startDate,
      endDate,
    } = req.query;

    const events = await storage.getAllEvents({
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
      eventName: eventName as string | undefined,
      projectId: projectId as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });

    // Get project names for display - filter by authenticated user if available
    const userId = req.supabaseUserId;
    const projects = await storage.listProjects(userId);
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    // Filter events by user's projects if authenticated
    let filteredEvents = events;
    if (userId && projects.length > 0) {
      const userProjectIds = new Set(projects.map((p) => p.id));
      filteredEvents = events.filter((e) => userProjectIds.has(e.project_id));
    }

    const eventsWithProject = filteredEvents.map((event) => ({
      ...event,
      project_name: projectMap.get(event.project_id)?.name || "Unknown",
      project_environment:
        projectMap.get(event.project_id)?.environment || "unknown",
    }));

    res.json({
      success: true,
      events: eventsWithProject,
      count: eventsWithProject.length,
    });
  } catch (error) {
    console.error("Error fetching all events:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch events",
    });
  }
});

/**
 * GET /api/v1/dashboard/events/stats
 * Get event statistics across all projects (filtered by user if authenticated)
 */
router.get("/events/stats", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { startDate, endDate } = req.query;

    // Get user's projects if authenticated
    let projectIds: string[] | undefined;
    if (userId) {
      const projects = await storage.listProjects(userId);
      projectIds = projects.map((p) => p.id);

      // If user has no projects, return empty stats
      if (projectIds.length === 0) {
        return res.json({
          success: true,
          overview: {
            total_events: 0,
            unique_users: 0,
            unique_sessions: 0,
            unique_devices: 0,
          },
          topEvents: [],
        });
      }
    }

    // Build filters object
    const filters: { startDate?: string; endDate?: string } = {};
    if (startDate) filters.startDate = startDate as string;
    if (endDate) filters.endDate = endDate as string;

    // Get stats filtered by user's projects (uses optimized database function)
    const stats = await storage.getGlobalEventStats(projectIds, filters);

    // Get trends and session time
    const [trends, sessionTime] = await Promise.all([
      storage.getEventTrends(projectIds, filters),
      storage.getAverageSessionTime(projectIds, filters),
    ]);

    res.json({
      success: true,
      ...stats,
      trends,
      sessionTime,
    });
  } catch (error) {
    console.error("Error fetching global stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch statistics",
    });
  }
});

/**
 * GET /api/v1/dashboard/events/names
 * Get unique event names (optimized endpoint for event name lists)
 */
router.get("/events/names", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { project_id } = req.query;

    // Get user's projects if authenticated
    let projectIds: string[] | undefined;
    if (userId) {
      const projects = await storage.listProjects(userId);
      projectIds = projects.map((p) => p.id);

      if (projectIds.length === 0) {
        return res.json({
          success: true,
          eventNames: [],
        });
      }
    }

    // Use optimized query - only select distinct event names
    const eventNames = await storage.getEventNames(
      projectIds,
      project_id as string | undefined
    );

    res.json({
      success: true,
      eventNames,
    });
  } catch (error) {
    console.error("Error fetching event names:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch event names",
    });
  }
});

/**
 * GET /api/v1/dashboard/projects/:projectId/events
 * Get events for a specific project (dashboard access - no API key required)
 */
router.get(
  "/projects/:projectId/events",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const {
        limit = "100",
        offset = "0",
        eventName,
        startDate,
        endDate,
      } = req.query;

      // Verify project exists
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      const events = await storage.getEvents(projectId, {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        eventName: eventName as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        events,
        count: events.length,
        project: {
          id: project.id,
          name: project.name,
          environment: project.environment,
        },
      });
    } catch (error) {
      console.error("Error fetching project events:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch events",
      });
    }
  }
);

/**
 * GET /api/v1/dashboard/projects/:projectId/events/stats
 * Get event statistics for a specific project
 */
router.get(
  "/projects/:projectId/events/stats",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { startDate, endDate } = req.query;

      // Verify project exists
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      // Build filters object
      const filters: { startDate?: string; endDate?: string } = {};
      if (startDate) filters.startDate = startDate as string;
      if (endDate) filters.endDate = endDate as string;

      // Get stats, trends, and session time
      const [statsData, trends, sessionTime] = await Promise.all([
        storage.getEventStats(projectId, filters),
        storage.getEventTrends([projectId], filters),
        storage.getAverageSessionTime([projectId], filters),
      ]);

      res.json({
        success: true,
        ...statsData,
        trends,
        sessionTime,
        project: {
          id: project.id,
          name: project.name,
          environment: project.environment,
        },
      });
    } catch (error) {
      console.error("Error fetching project stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch statistics",
      });
    }
  }
);

/**
 * GET /api/v1/dashboard/events/stream
 * Get recent events for live updates (polling endpoint)
 */
router.get("/events/stream", async (req: Request, res: Response) => {
  try {
    const { since, projectId, limit = "50" } = req.query;

    const events = await storage.getRecentEvents({
      since: since as string | undefined,
      projectId: projectId as string | undefined,
      limit: parseInt(limit as string, 10),
    });

    // Get project names for display - filter by authenticated user if available
    const userId = req.supabaseUserId;
    const projects = await storage.listProjects(userId);
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    // Filter events by user's projects if authenticated
    let filteredEvents = events;
    if (userId && projects.length > 0) {
      const userProjectIds = new Set(projects.map((p) => p.id));
      filteredEvents = events.filter((e) => userProjectIds.has(e.project_id));
    }

    const eventsWithProject = filteredEvents.map((event) => ({
      ...event,
      project_name: projectMap.get(event.project_id)?.name || "Unknown",
      project_environment:
        projectMap.get(event.project_id)?.environment || "unknown",
    }));

    res.json({
      success: true,
      events: eventsWithProject,
      count: eventsWithProject.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching stream events:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch events",
    });
  }
});

/**
 * GET /api/v1/dashboard/projects/:projectId/analytics/flows
 * Get flow analytics for a specific project (dashboard access - requires auth)
 */
router.get(
  "/projects/:projectId/analytics/flows",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { flowId, flowType, startDate, endDate } = req.query;
      const userId = req.supabaseUserId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      // Verify project exists and belongs to user
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      // Verify project ownership
      const userProjects = await storage.listProjects(userId);
      const hasAccess = userProjects.some((p) => p.id === projectId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
        });
      }

      const analytics = await storage.getFlowAnalytics(projectId, {
        flowId: flowId as string | undefined,
        flowType: flowType as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
        project: {
          id: project.id,
          name: project.name,
          environment: project.environment,
        },
      });
    } catch (error) {
      console.error("Error fetching flow analytics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch flow analytics",
      });
    }
  }
);

/**
 * GET /api/v1/dashboard/projects/:projectId/analytics/screen-time
 * Get screen time analytics for a specific project (dashboard access - requires auth)
 */
router.get(
  "/projects/:projectId/analytics/screen-time",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { screen, startDate, endDate } = req.query;
      const userId = req.supabaseUserId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      // Verify project exists and belongs to user
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      // Verify project ownership
      const userProjects = await storage.listProjects(userId);
      const hasAccess = userProjects.some((p) => p.id === projectId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
        });
      }

      const analytics = await storage.getScreenTimeAnalytics(projectId, {
        screen: screen as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
        project: {
          id: project.id,
          name: project.name,
          environment: project.environment,
        },
      });
    } catch (error) {
      console.error("Error fetching screen time analytics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch screen time analytics",
      });
    }
  }
);

/**
 * GET /api/v1/dashboard/projects/:projectId/analytics/features
 * Get feature usage analytics for a specific project (dashboard access - requires auth)
 */
router.get(
  "/projects/:projectId/analytics/features",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { feature, startDate, endDate } = req.query;
      const userId = req.supabaseUserId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      // Verify project exists and belongs to user
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      // Verify project ownership
      const userProjects = await storage.listProjects(userId);
      const hasAccess = userProjects.some((p) => p.id === projectId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
        });
      }

      const analytics = await storage.getFeatureUsageAnalytics(projectId, {
        feature: feature as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
        project: {
          id: project.id,
          name: project.name,
          environment: project.environment,
        },
      });
    } catch (error) {
      console.error("Error fetching feature usage analytics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch feature usage analytics",
      });
    }
  }
);

/**
 * GET /api/v1/dashboard/projects/:projectId/analytics/scroll
 * Get scroll analytics for a specific project (dashboard access - requires auth)
 */
router.get(
  "/projects/:projectId/analytics/scroll",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { screen, startDate, endDate } = req.query;
      const userId = req.supabaseUserId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      // Verify project exists and belongs to user
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      // Verify project ownership
      const userProjects = await storage.listProjects(userId);
      const hasAccess = userProjects.some((p) => p.id === projectId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
        });
      }

      const analytics = await storage.getScrollAnalytics(projectId, {
        screen: screen as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        ...analytics,
        project: {
          id: project.id,
          name: project.name,
          environment: project.environment,
        },
      });
    } catch (error) {
      console.error("Error fetching scroll analytics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch scroll analytics",
      });
    }
  }
);

export default router;
