/**
 * Funnels routes - manage user-defined conversion funnels
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";

const router = Router();

/**
 * POST /api/v1/funnels
 * Create a new funnel
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { name, steps, chart_type, project_id, pinned } = req.body;

    if (!name || !steps || !Array.isArray(steps) || steps.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Name and at least 2 steps are required",
      });
    }

    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: "project_id is required",
      });
    }

    // Verify user owns the project
    const project = await storage.getProject(project_id);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    if (project.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    const funnel = await storage.createFunnel({
      project_id,
      name,
      steps,
      chart_type: chart_type || "funnel",
      pinned: pinned !== undefined ? pinned : true,
    });

    res.status(201).json({
      success: true,
      funnel: {
        id: funnel.id,
        name: funnel.name,
        steps: funnel.steps,
        chartType: funnel.chart_type,
        pinned: funnel.pinned,
        createdAt: funnel.created_at,
        updatedAt: funnel.updated_at,
      },
    });
  } catch (error) {
    console.error("Error creating funnel:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create funnel",
    });
  }
});

/**
 * GET /api/v1/funnels
 * List all funnels for a project
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { project_id } = req.query;

    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: "project_id query parameter is required",
      });
    }

    // Verify user owns the project
    const project = await storage.getProject(project_id as string);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    if (project.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    const funnels = await storage.listFunnels(project_id as string);

    res.json({
      success: true,
      funnels: funnels.map((f) => ({
        id: f.id,
        name: f.name,
        steps: f.steps,
        chartType: f.chart_type,
        pinned: f.pinned,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      })),
    });
  } catch (error) {
    console.error("Error listing funnels:", error);
    res.status(500).json({
      success: false,
      error: "Failed to list funnels",
    });
  }
});

/**
 * GET /api/v1/funnels/:funnelId
 * Get a specific funnel
 */
router.get("/:funnelId", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { funnelId } = req.params;
    const funnel = await storage.getFunnel(funnelId);

    if (!funnel) {
      return res.status(404).json({
        success: false,
        error: "Funnel not found",
      });
    }

    // Verify user owns the project that the funnel belongs to
    const project = await storage.getProject(funnel.project_id);
    if (!project || project.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    res.json({
      success: true,
      funnel: {
        id: funnel.id,
        name: funnel.name,
        steps: funnel.steps,
        chartType: funnel.chart_type,
        pinned: funnel.pinned,
        createdAt: funnel.created_at,
        updatedAt: funnel.updated_at,
      },
    });
  } catch (error) {
    console.error("Error getting funnel:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get funnel",
    });
  }
});

/**
 * PUT /api/v1/funnels/:funnelId
 * Update a funnel
 */
router.put("/:funnelId", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { funnelId } = req.params;
    const { name, steps, chart_type, pinned } = req.body;

    // Verify user owns the project that the funnel belongs to
    const existingFunnel = await storage.getFunnel(funnelId);
    if (!existingFunnel) {
      return res.status(404).json({
        success: false,
        error: "Funnel not found",
      });
    }

    const project = await storage.getProject(existingFunnel.project_id);
    if (!project || project.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    const funnel = await storage.updateFunnel(funnelId, {
      name,
      steps,
      chart_type,
      pinned,
    });

    res.json({
      success: true,
      funnel: {
        id: funnel.id,
        name: funnel.name,
        steps: funnel.steps,
        chartType: funnel.chart_type,
        pinned: funnel.pinned,
        createdAt: funnel.created_at,
        updatedAt: funnel.updated_at,
      },
    });
  } catch (error) {
    console.error("Error updating funnel:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update funnel",
    });
  }
});

/**
 * DELETE /api/v1/funnels/:funnelId
 * Delete a funnel
 */
router.delete("/:funnelId", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { funnelId } = req.params;

    // Verify user owns the project that the funnel belongs to
    const existingFunnel = await storage.getFunnel(funnelId);
    if (!existingFunnel) {
      return res.status(404).json({
        success: false,
        error: "Funnel not found",
      });
    }

    const project = await storage.getProject(existingFunnel.project_id);
    if (!project || project.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    await storage.deleteFunnel(funnelId);

    res.json({
      success: true,
      message: "Funnel deleted",
    });
  } catch (error) {
    console.error("Error deleting funnel:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete funnel",
    });
  }
});

export default router;
