/**
 * Slack integration routes — configure webhook, test connection, manage notification toggles
 */

import { Router, Request, Response } from "express";

import { storage } from "../db";
import { encrypt, decrypt } from "../utils/encryption";
import { testWebhook } from "../services/slackService";

const router = Router();

const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/";

/**
 * PUT /api/v1/projects/:projectId/slack/config
 * Save webhook URL (encrypted) + notification toggles
 */
router.put("/:projectId/slack/config", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const {
      webhookUrl,
      notifyPayments = true,
      notifyCrashes = true,
      notifyQuota = true,
    } = req.body;

    const project = await storage.getProject(projectId);
    if (!project) {
      return res
        .status(404)
        .json({ success: false, error: "Project not found" });
    }

    if (!webhookUrl || !webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
      return res.status(400).json({
        success: false,
        error: "Invalid webhook URL. Must start with https://hooks.slack.com/",
      });
    }

    const encryptedUrl = encrypt(webhookUrl);

    await storage.updateProjectSlackConfig(projectId, {
      slack_webhook_url: encryptedUrl,
      slack_enabled: true,
      slack_notify_payments: notifyPayments,
      slack_notify_crashes: notifyCrashes,
      slack_notify_quota: notifyQuota,
    });

    res.json({
      success: true,
      message: "Slack integration configured successfully",
      config: {
        enabled: true,
        notifyPayments,
        notifyCrashes,
        notifyQuota,
      },
    });
  } catch (error) {
    console.error("Error configuring Slack:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to configure Slack integration" });
  }
});

/**
 * GET /api/v1/projects/:projectId/slack/config
 * Return status (URL never exposed, only hasWebhookUrl boolean)
 */
router.get("/:projectId/slack/config", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const project = await storage.getProject(projectId);
    if (!project) {
      return res
        .status(404)
        .json({ success: false, error: "Project not found" });
    }

    res.json({
      success: true,
      config: {
        enabled: project.slack_enabled || false,
        hasWebhookUrl: !!project.slack_webhook_url,
        notifyPayments: project.slack_notify_payments ?? true,
        notifyCrashes: project.slack_notify_crashes ?? true,
        notifyQuota: project.slack_notify_quota ?? true,
      },
    });
  } catch (error) {
    console.error("Error getting Slack config:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to get Slack configuration" });
  }
});

/**
 * DELETE /api/v1/projects/:projectId/slack/config
 * Disconnect — reset all Slack fields
 */
router.delete(
  "/:projectId/slack/config",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const project = await storage.getProject(projectId);
      if (!project) {
        return res
          .status(404)
          .json({ success: false, error: "Project not found" });
      }

      await storage.updateProjectSlackConfig(projectId, {
        slack_webhook_url: null,
        slack_enabled: false,
        slack_notify_payments: true,
        slack_notify_crashes: true,
        slack_notify_quota: true,
      });

      res.json({ success: true, message: "Slack integration removed" });
    } catch (error) {
      console.error("Error removing Slack config:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to remove Slack integration" });
    }
  },
);

/**
 * POST /api/v1/projects/:projectId/slack/test
 * Decrypt URL and send a test message
 */
router.post("/:projectId/slack/test", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const project = await storage.getProject(projectId);
    if (!project) {
      return res
        .status(404)
        .json({ success: false, error: "Project not found" });
    }

    if (!project.slack_enabled || !project.slack_webhook_url) {
      return res.status(400).json({
        success: false,
        error: "Slack integration is not configured for this project",
      });
    }

    let webhookUrl: string;
    try {
      webhookUrl = decrypt(project.slack_webhook_url);
    } catch {
      return res
        .status(500)
        .json({ success: false, error: "Failed to decrypt webhook URL" });
    }

    const sent = await testWebhook(webhookUrl);
    if (sent) {
      res.json({ success: true, message: "Test message sent to Slack" });
    } else {
      res.status(502).json({
        success: false,
        error: "Failed to send test message to Slack",
      });
    }
  } catch (error) {
    console.error("Error testing Slack webhook:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to test Slack connection" });
  }
});

export default router;
