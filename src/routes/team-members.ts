/**
 * Team members routes - manage project team members
 */

import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import { storage } from "../db";
import { emailService } from "../services/emailService";
import { getPlanLimits, isUnlimited } from "../config/plan-limits";

const router = Router();

const INVITE_EXPIRY_DAYS = 7;
const WEB_URL = process.env.WEB_URL || "http://localhost:3000";

/**
 * GET /api/v1/projects/:projectId/team-members
 * Get all team members for a project
 * Requires Supabase authentication and project membership
 */
router.get("/:projectId/team-members", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { projectId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Check if user is a member of this project
    const isMember = await storage.isProjectMember(projectId, userId);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Access denied. You are not a member of this project.",
      });
    }

    const teamMembers = await storage.getProjectTeamMembers(projectId);

    res.json({
      success: true,
      teamMembers,
    });
  } catch (error) {
    console.error("Error getting team members:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/v1/projects/:projectId/team-members
 * Add a team member to a project
 * Requires Supabase authentication and owner role
 */
router.post("/:projectId/team-members", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { projectId } = req.params;
    const { userEmail } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const email = typeof userEmail === "string" ? userEmail.trim().toLowerCase() : "";
    if (!email) {
      return res.status(400).json({
        success: false,
        error: "User email is required",
      });
    }

    // Check if user is owner of this project
    const isOwner = await storage.isProjectOwner(projectId, userId);
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: "Access denied. Only project owners can add team members.",
      });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const project = await storage.getProject(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    // Enforce plan team-seat limit (owner's plan applies to the project)
    const owner = await storage.getUser(project.user_id);
    const limits = getPlanLimits(owner?.subscription_plan);
    if (!isUnlimited(limits.teamSeatsPerProject)) {
      const currentCount = await storage.getProjectTeamCount(projectId);
      if (currentCount >= limits.teamSeatsPerProject) {
        return res.status(402).json({
          success: false,
          error: `Team limit reached (${limits.teamSeatsPerProject} seat${limits.teamSeatsPerProject === 1 ? "" : "s"} per project on your plan). Upgrade to add more.`,
        });
      }
    }

    // If invitee already has an account and is not a member, add them directly and send email
    const memberUser = await storage.getUserByEmail(email);
    if (memberUser) {
      const alreadyMember = await storage.isProjectMember(projectId, memberUser.id);
      if (alreadyMember) {
        return res.status(400).json({
          success: false,
          error: "This person is already a member of this project",
        });
      }
      const canAdd = await storage.canAddTeamMember(userId, projectId);
      if (!canAdd) {
        return res.status(403).json({
          success: false,
          error: "Cannot add this team member.",
        });
      }
      await storage.addTeamMember({
        projectId,
        userId: memberUser.id,
        invitedBy: userId,
      });
      const acceptLink = `${WEB_URL}/dashboard/projects/${projectId}`;
      try {
        await emailService.sendProjectInviteEmail({
          email,
          projectName: project.name,
          inviterName: (user as { name?: string }).name,
          acceptLink,
        });
      } catch (e) {
        console.error("Failed to send added email:", e);
      }
      const teamMembers = await storage.getProjectTeamMembers(projectId);
      const teamMember = teamMembers.find((m) => m.user_id === memberUser.id);
      return res.json({
        success: true,
        teamMember: teamMember || null,
        message: "Team member added. They've been sent an email with a link to the project.",
      });
    }

    // Invitee does not have an account: create invitation and send invite email
    const canAdd = await storage.canAddTeamMember(userId, projectId);
    if (!canAdd) {
      const limits = {
        free: "Free plan does not support team members",
        pro: "Pro plan allows up to 3 additional team members (4 total including owner)",
        business: "Business plan allows up to 10 additional team members (11 total including owner)",
      };
      return res.status(403).json({
        success: false,
        error: limits[user.subscription_plan as keyof typeof limits] || "Team member limit reached",
        currentPlan: user.subscription_plan,
      });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    try {
      await storage.createInvitation({
        projectId,
        email,
        invitedBy: userId,
        token,
        expiresAt,
      });
    } catch (inviteError: unknown) {
      const msg = inviteError && typeof (inviteError as { message?: string }).message === "string"
        ? (inviteError as { message: string }).message
        : "";
      if (msg.includes("duplicate") || msg.includes("unique")) {
        return res.status(400).json({
          success: false,
          error: "This email has already been invited to this project.",
        });
      }
      throw inviteError;
    }

    const acceptLink = `${WEB_URL}/invite/accept?token=${token}`;
    try {
      await emailService.sendProjectInviteEmail({
        email,
        projectName: project.name,
        inviterName: (user as { name?: string }).name,
        acceptLink,
      });
    } catch (emailError) {
      console.error("Failed to send invite email:", emailError);
      return res.status(500).json({
        success: false,
        error: "Invitation was created but the email could not be sent. Please try again or check your email configuration.",
      });
    }

    res.status(201).json({
      success: true,
      message: "Invitation sent. They'll receive an email with a link to sign in or create an account and join the project.",
      teamMember: null,
    });
  } catch (error) {
    console.error("Error adding team member:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * DELETE /api/v1/projects/:projectId/team-members/:memberId
 * Remove a team member from a project
 * Requires Supabase authentication and owner role
 */
router.delete("/:projectId/team-members/:memberId", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { projectId, memberId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Check if user is owner of this project
    const isOwner = await storage.isProjectOwner(projectId, userId);
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: "Access denied. Only project owners can remove team members.",
      });
    }

    // Prevent removing the owner
    const memberToRemove = await storage.getTeamMember(memberId);
    if (memberToRemove?.role === "owner") {
      return res.status(400).json({
        success: false,
        error: "Cannot remove the project owner",
      });
    }

    await storage.removeTeamMember(memberId);

    res.json({
      success: true,
      message: "Team member removed successfully",
    });
  } catch (error) {
    console.error("Error removing team member:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/v1/projects/:projectId/team-members/pending
 * List pending invitations for a project (owner only)
 */
router.get("/:projectId/team-members/pending", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { projectId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const isOwner = await storage.isProjectOwner(projectId, userId);
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: "Access denied. Only project owners can view pending invitations.",
      });
    }

    const pending = await storage.listPendingInvitations(projectId);

    res.json({
      success: true,
      pending,
    });
  } catch (error) {
    console.error("Error listing pending invitations:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/v1/projects/:projectId/team-members/limits
 * Get team member limits for current user's subscription
 */
router.get("/:projectId/team-members/limits", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;
    const { projectId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const currentCount = await storage.getProjectTeamCount(projectId);
    const limits = {
      free: { max: 1, additional: 0 },
      pro: { max: 4, additional: 3 },
      business: { max: 11, additional: 10 },
    };

    const planLimits = limits[user.subscription_plan as keyof typeof limits] || limits.free;

    res.json({
      success: true,
      currentPlan: user.subscription_plan,
      currentCount,
      maxMembers: planLimits.max,
      additionalSeats: planLimits.additional,
      canAddMore: currentCount < planLimits.max,
      remainingSeats: Math.max(0, planLimits.max - currentCount),
    });
  } catch (error) {
    console.error("Error getting team limits:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
