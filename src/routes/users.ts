/**
 * Users routes - manage platform users and onboarding
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";

const router = Router();

/**
 * GET /api/v1/users/me
 * Get current user's profile and onboarding status
 * Requires Supabase authentication
 */
router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: req.supabaseAuthError
          ? `Authentication failed: ${req.supabaseAuthError}`
          : "Authentication required",
      });
    }

    // Get or create user (fallback if trigger didn't fire)
    const user = await storage.getOrCreateUser(userId);

    res.json({
      success: true,
      user: {
        id: user.id,
        onboarding_answers: user.onboarding_answers || {},
        onboarding_completed: user.onboarding_completed,
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    console.error("Error getting user:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * PUT /api/v1/users/me
 * Update current user's onboarding data or subscription
 * Requires Supabase authentication
 */
router.put("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: req.supabaseAuthError
          ? `Authentication failed: ${req.supabaseAuthError}`
          : "Authentication required",
      });
    }

    const {
      onboarding_answers,
      onboarding_completed,
      subscription_status,
      subscription_plan,
    } = req.body;

    // Build update data
    const updateData: {
      onboarding_answers?: Record<string, any>;
      onboarding_completed?: boolean;
      subscription_status?: string;
      subscription_plan?: string;
    } = {};

    if (onboarding_answers !== undefined) {
      updateData.onboarding_answers = onboarding_answers;
    }
    if (onboarding_completed !== undefined) {
      updateData.onboarding_completed = onboarding_completed;
    }
    if (subscription_status !== undefined) {
      updateData.subscription_status = subscription_status;
    }
    if (subscription_plan !== undefined) {
      updateData.subscription_plan = subscription_plan;
    }

    // Ensure user exists
    await storage.getOrCreateUser(userId);

    // Update user
    const updatedUser = await storage.updateUser(userId, updateData);

    res.json({
      success: true,
      user: {
        id: updatedUser.id,
        onboarding_answers: updatedUser.onboarding_answers || {},
        onboarding_completed: updatedUser.onboarding_completed,
        subscription_status: updatedUser.subscription_status,
        subscription_plan: updatedUser.subscription_plan,
        created_at: updatedUser.created_at,
        updated_at: updatedUser.updated_at,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
