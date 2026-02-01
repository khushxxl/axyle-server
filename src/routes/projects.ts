/**
 * Projects routes - manage projects and API keys
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";
import { randomUUID, randomBytes } from "crypto";
import { apiKeyCreationRateLimiter } from "../middleware/rateLimiting";

const router = Router();

/**
 * POST /api/v1/projects
 * Create a new project
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      name,
      userId,
      environment = "dev",
      baseUrl,
      debug = false,
      maxQueueSize = 100,
      flushInterval = 10000,
      sessionTimeout = 1800000,
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Project name is required",
      });
    }

    // Use authenticated user_id if available, otherwise use provided userId or generate
    const projectUserId = req.supabaseUserId || userId || randomUUID();

    // Create project
    const project = await storage.createProject({
      name,
      user_id: projectUserId,
      environment,
      base_url: baseUrl,
      debug,
      max_queue_size: maxQueueSize,
      flush_interval: flushInterval,
      session_timeout: sessionTimeout,
    });

    res.status(201).json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        userId: project.user_id,
        environment: project.environment,
        createdAt: project.created_at,
      },
    });
  } catch (error) {
    console.error("Error in create project:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/v1/projects
 * List all projects (for a user if userId provided or authenticated user)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    // Use authenticated user_id if available, otherwise use query param
    const userId =
      req.supabaseUserId || (req.query.userId as string | undefined);

    const projects = await storage.listProjects(userId);

    res.json({
      success: true,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        environment: p.environment,
        created_at: p.created_at,
        total_events: p.total_events,
        last_event_at: p.last_event_at,
      })),
    });
  } catch (error) {
    console.error("Error listing projects:", error);
    res.status(500).json({
      success: false,
      error: "Failed to list projects",
    });
  }
});

/**
 * GET /api/v1/projects/:projectId
 * Get a specific project
 */
router.get("/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const project = await storage.getProject(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    res.json({
      success: true,
      project,
    });
  } catch (error) {
    console.error("Error getting project:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/v1/projects/:projectId/api-keys
 * Create a new API key for a project
 */
router.post(
  "/:projectId/api-keys",
  apiKeyCreationRateLimiter,
  async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { name } = req.body;

    // Verify project exists
    const project = await storage.getProject(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    // Generate API key (cryptographically random). Storage saves only the hash; we return the plain key here once.
    // Using 32 random bytes encoded as base64url (URL-safe base64 without padding)
    // This gives us 256 bits of entropy, making brute force attacks infeasible
    const apiKey = randomBytes(32).toString("base64url");
    const apiKeyData = await storage.createApiKey(projectId, apiKey);

    res.status(201).json({
      success: true,
      apiKey: {
        id: apiKeyData.id,
        key: apiKey, // Plain key shown only in this response — never stored or returned again
        projectId: apiKeyData.project_id,
        isActive: apiKeyData.is_active,
        createdAt: apiKeyData.created_at,
      },
      message:
        "Save this API key securely. It will not be shown again. You can only regenerate it.",
    });
  } catch (error) {
    console.error("Error creating API key:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
  }
);

/**
 * GET /api/v1/projects/:projectId/api-keys
 * List all API keys for a project
 */
router.get("/:projectId/api-keys", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const apiKeys = await storage.listApiKeys(projectId);

    // Don't return the actual key for security
    res.json({
      success: true,
      apiKeys: apiKeys.map((key) => ({
        id: key.id,
        isActive: key.is_active,
        createdAt: key.created_at,
        lastUsedAt: key.last_used_at,
      })),
    });
  } catch (error) {
    console.error("Error listing API keys:", error);
    res.status(500).json({
      success: false,
      error: "Failed to list API keys",
    });
  }
});

/**
 * DELETE /api/v1/projects/:projectId/api-keys/:apiKeyId
 * Deactivate an API key
 */
router.delete(
  "/:projectId/api-keys/:apiKeyId",
  async (req: Request, res: Response) => {
    try {
      const { projectId, apiKeyId } = req.params;

      // Verify API key belongs to project
      const apiKeys = await storage.listApiKeys(projectId);
      const apiKey = apiKeys.find((k) => k.id === apiKeyId);

      if (!apiKey) {
        return res.status(404).json({
          success: false,
          error: "API key not found",
        });
      }

      // Deactivate instead of deleting
      await storage.deactivateApiKey(apiKeyId);

      res.json({
        success: true,
        message: "API key deactivated",
      });
    } catch (error) {
      console.error("Error deactivating API key:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  },
);

/**
 * GET /api/v1/projects/:projectId/users
 * Get users for a project
 */
router.get("/:projectId/users", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { limit = "100", offset = "0" } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);
    
    console.log(`Fetching project users: limit=${parsedLimit}, offset=${parsedOffset}`);

    // Verify project exists
    const project = await storage.getProject(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    const users = await storage.getProjectUsers(projectId, {
      limit: parsedLimit,
      offset: parsedOffset,
    });

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Error getting project users:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get project users",
    });
  }
});

/**
 * DELETE /api/v1/projects/:projectId
 * Delete a project
 */
router.delete("/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.supabaseUserId;

    // Verify project exists
    const project = await storage.getProject(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    // Verify user owns the project (if authenticated)
    if (userId && project.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    await storage.deleteProject(projectId);

    res.json({
      success: true,
      message: "Project deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete project",
    });
  }
});

export default router;
