/**
 * Webhook routes - handle external webhooks
 */

import { Router, Request, Response } from "express";
import { emailService } from "../services/emailService";
import { supabase } from "../db/supabase";

const router = Router();

/**
 * POST /api/v1/webhooks/new-user
 * Handle new user creation webhook from Supabase
 * This is called by a database webhook when a new user is created
 */
router.post("/new-user", async (req: Request, res: Response) => {
  try {
    const { type, table, record, old_record } = req.body;

    // Validate webhook payload
    if (type !== "INSERT" || table !== "users") {
      return res.status(400).json({
        success: false,
        error: "Invalid webhook payload",
      });
    }

    const userId = record?.id;
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "Missing user ID in webhook payload",
      });
    }

    // Get user's email from auth.users
    const { data: authUser, error } =
      await supabase.auth.admin.getUserById(userId);

    if (error || !authUser?.user?.email) {
      console.warn(`Unable to get email for user ${userId}`);
      return res.status(200).json({
        success: true,
        message: "Webhook received but no email found",
      });
    }

    // Extract name from user metadata if available
    const name =
      authUser.user.user_metadata?.full_name ||
      authUser.user.user_metadata?.name ||
      undefined;

    // Send welcome email asynchronously
    emailService
      .sendWelcomeEmail({
        email: authUser.user.email,
        name,
      })
      .catch((err) => {
        console.error("Failed to send welcome email:", err);
      });

    res.status(200).json({
      success: true,
      message: "Welcome email queued",
    });
  } catch (error) {
    console.error("Error handling new user webhook:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
