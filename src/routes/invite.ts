/**
 * Invite routes - accept project invitation by token
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";

const router = Router();

/**
 * POST /api/v1/invite/accept
 * Accept a project invitation (requires auth; current user email must match invitation email)
 */
router.post("/accept", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { token } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error:
          "Authentication required. Sign in or create an account to accept this invitation.",
      });
    }

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        error: "Invalid invitation link. Missing token.",
      });
    }

    const result = await storage.acceptInvitation(token.trim(), userId);

    if ("error" in result) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      projectId: result.projectId,
      projectName: result.projectName,
      message: `You've joined ${result.projectName}`,
    });
  } catch (error) {
    console.error("Error accepting invite:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/v1/invite/accept?token=xxx
 * Get invitation details (for pre-auth display; token required)
 */
router.get("/accept", async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Invalid invitation link. Missing token.",
      });
    }

    const inv = await storage.getInvitationByToken(token);

    if (!inv) {
      return res.status(404).json({
        success: false,
        error: "Invalid or expired invitation",
      });
    }

    res.json({
      success: true,
      projectName: inv.project_name,
      email: inv.email,
    });
  } catch (error) {
    console.error("Error fetching invite:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
