/**
 * Internal email triggers (e.g. thank-you after paid plan).
 * Called by the Next.js Stripe webhook; protect with x-internal-secret when set.
 */

import { Router, Request, Response } from "express";
import { supabase } from "../db/supabase";
import { emailService } from "../services/emailService";

const router = Router();

function checkInternalSecret(req: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return true;
  return req.headers["x-internal-secret"] === secret;
}

/**
 * POST /api/v1/emails/thank-you-joining
 * Send "Thank you for joining" email after user gets a paid plan.
 * Body: { userId: string, planName?: string }
 * Optional header: x-internal-secret (required if INTERNAL_API_SECRET is set)
 */
router.post("/thank-you-joining", async (req: Request, res: Response) => {
  if (!checkInternalSecret(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const { userId, planName } = req.body as {
      userId?: string;
      planName?: string;
    };

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.admin.getUserById(userId);

    if (authError || !authUser?.email) {
      console.warn(
        "Thank-you email: could not get user email for",
        userId,
        authError?.message,
      );
      return res.status(404).json({
        success: false,
        error: "User not found or has no email",
      });
    }

    const name =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      undefined;

    await emailService.sendThankYouJoiningEmail({
      email: authUser.email,
      name,
      planName: planName || "your plan",
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("Thank-you joining email route error:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
