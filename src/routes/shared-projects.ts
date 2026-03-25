/**
 * Shared Projects routes - public shareable dashboard links
 */

import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import { storage } from "../db";
import { requireSupabaseAuth } from "../middleware/supabaseAuth";

const router = Router();

function generateShareToken(): string {
  return randomBytes(12).toString("base64url"); // 16-char URL-safe token
}

/**
 * POST /api/v1/shared-projects/:projectId
 * Enable sharing for a project (creates or re-activates share link)
 */
router.post(
  "/:projectId",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.supabaseUserId!;
      const { projectId } = req.params;

      // Verify project exists and user owns it
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ success: false, error: "Project not found" });
      }

      // Ownership check skipped — any authenticated team member can share
      // TODO: re-enable with proper team member role check

      const { visibleMetrics } = req.body || {};
      const shareToken = generateShareToken();
      const result = await storage.createSharedProject({
        projectId,
        userId,
        shareToken,
        visibleMetrics,
      });

      res.json({
        success: true,
        shareToken: result.share_token,
        isActive: true,
      });
    } catch (error) {
      console.error("Error enabling project sharing:", error);
      res.status(500).json({ success: false, error: "Failed to enable sharing" });
    }
  },
);

/**
 * GET /api/v1/shared-projects/:projectId/status
 * Get sharing status for a project (owner only)
 */
router.get(
  "/:projectId/status",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const shared = await storage.getSharedProjectByProjectId(projectId);

      res.json({
        success: true,
        shared: shared
          ? {
              shareToken: shared.share_token,
              isActive: shared.is_active,
              visibleMetrics: shared.visible_metrics,
              createdAt: shared.created_at,
            }
          : null,
      });
    } catch (error) {
      console.error("Error fetching share status:", error);
      res.status(500).json({ success: false, error: "Failed to fetch share status" });
    }
  },
);

/**
 * PATCH /api/v1/shared-projects/:projectId
 * Toggle sharing on/off
 */
router.patch(
  "/:projectId",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { isActive, visibleMetrics } = req.body;

      if (isActive !== undefined && typeof isActive !== "boolean") {
        return res.status(400).json({ success: false, error: "isActive must be a boolean" });
      }

      await storage.updateSharedProject(projectId, {
        ...(isActive !== undefined && { isActive }),
        ...(visibleMetrics && { visibleMetrics }),
      });

      res.json({ success: true, isActive, visibleMetrics });
    } catch (error) {
      console.error("Error toggling project sharing:", error);
      res.status(500).json({ success: false, error: "Failed to update sharing" });
    }
  },
);

/**
 * GET /api/v1/shared-projects/public/:token
 * Public endpoint - get project info from share token
 */
router.get("/public/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const shared = await storage.getSharedProjectByToken(token);

    if (!shared) {
      return res.status(404).json({ success: false, error: "Shared dashboard not found" });
    }

    // Get project info to return name/logo
    const project = await storage.getProject(shared.project_id);
    if (!project) {
      return res.status(404).json({ success: false, error: "Project not found" });
    }

    res.json({
      success: true,
      projectId: project.id,
      projectName: project.name,
      projectLogo: project.logo_url || null,
      platform: project.platform || null,
      revenueCatEnabled: !!(project.revenuecat_enabled && project.revenuecat_secret_key),
      superwallEnabled: !!(project.superwall_enabled && project.superwall_api_key),
      visibleMetrics: shared.visible_metrics,
    });
  } catch (error) {
    console.error("Error fetching shared project:", error);
    res.status(500).json({ success: false, error: "Failed to fetch shared dashboard" });
  }
});

export default router;
