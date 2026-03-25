/**
 * Superwall routes - manage Superwall integration and fetch revenue data
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";
import {
  validateApiKey,
  getApplicationStatistics,
  getRecentTransactions,
  getChartDefinitions,
  getChartData,
  registerWebhook,
  SuperwallConfig,
} from "../services/superwallService";
import { encrypt, decrypt } from "../utils/encryption";
import { emitProjectEvent } from "../services/eventBus";
import { sendPaymentNotification, sendSuperwallConnectedNotification } from "../services/slackService";

const router = Router();

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

/**
 * Helper to get decrypted Superwall config from a project
 */
async function getProjectSuperwallConfig(
  projectId: string,
): Promise<{
  config:
    | (SuperwallConfig & {
        superwallProjectId: string;
        superwallApplicationId: string;
      })
    | null;
  project: any;
  error?: string;
}> {
  const project = await storage.getProject(projectId);

  if (!project) {
    return { config: null, project: null, error: "Project not found" };
  }

  if (!project.superwall_enabled) {
    return {
      config: null,
      project,
      error: "Superwall integration is not enabled for this project",
    };
  }

  if (
    !project.superwall_api_key ||
    !project.superwall_project_id ||
    !project.superwall_application_id
  ) {
    return {
      config: null,
      project,
      error: "Superwall credentials are not configured",
    };
  }

  let decryptedApiKey: string;
  try {
    decryptedApiKey = decrypt(project.superwall_api_key);
  } catch (error) {
    console.error("Failed to decrypt Superwall API key:", error);
    return {
      config: null,
      project,
      error: "Failed to decrypt credentials",
    };
  }

  return {
    config: {
      apiKey: decryptedApiKey,
      superwallProjectId: project.superwall_project_id,
      superwallApplicationId: project.superwall_application_id,
    },
    project,
  };
}

/**
 * POST /api/v1/projects/:projectId/superwall/validate
 * Validate Superwall API key and return list of projects
 */
router.post(
  "/:projectId/superwall/validate",
  async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: "API key is required",
        });
      }

      const validation = await validateApiKey({ apiKey });

      if (validation.valid) {
        res.json({
          success: true,
          projects: validation.projects,
        });
      } else {
        res.status(400).json({
          success: false,
          error: validation.error || "Invalid API key",
        });
      }
    } catch (error: any) {
      console.error("Error validating Superwall credentials:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to validate credentials",
      });
    }
  },
);

/**
 * PUT /api/v1/projects/:projectId/superwall/config
 * Configure Superwall integration for a project
 */
router.put(
  "/:projectId/superwall/config",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const {
        apiKey,
        superwallProjectId,
        superwallApplicationId,
        superwallProjectName,
        superwallApplicationName,
      } = req.body;

      const project = await storage.getProject(projectId);

      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      if (
        !apiKey ||
        !superwallProjectId ||
        !superwallApplicationId
      ) {
        return res.status(400).json({
          success: false,
          error:
            "API key, Superwall project ID, and application ID are required",
        });
      }

      // Validate credentials before saving
      const validation = await validateApiKey({ apiKey });
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid Superwall credentials: ${validation.error}`,
        });
      }

      const encryptedApiKey = encrypt(apiKey);

      await storage.updateProjectSuperwallConfig(projectId, {
        superwall_api_key: encryptedApiKey,
        superwall_project_id: superwallProjectId,
        superwall_application_id: superwallApplicationId,
        superwall_project_name: superwallProjectName || null,
        superwall_application_name: superwallApplicationName || null,
        superwall_enabled: true,
      });

      // Auto-register webhook with Superwall (fire-and-forget)
      const webhookUrl = `${API_BASE_URL}/api/v1/projects/${projectId}/superwall/webhooks`;
      registerWebhook(
        { apiKey },
        superwallProjectId,
        webhookUrl,
        `Axyle – ${superwallProjectName || project.name}`,
      )
        .then((result) => {
          if ("error" in result) {
            console.warn("Superwall webhook registration warning:", result.error);
          } else {
            console.log("Superwall webhook registered:", result.id);
          }
        })
        .catch((err) => console.error("Superwall webhook registration error:", err));

      // Notify Slack if connected
      console.log("Slack check:", { slack_enabled: project.slack_enabled, has_webhook: !!project.slack_webhook_url });
      if (project.slack_enabled && project.slack_webhook_url) {
        try {
          const slackUrl = decrypt(project.slack_webhook_url);
          console.log("Sending Superwall connected notification to Slack");
          sendSuperwallConnectedNotification(slackUrl, project.name, superwallProjectName || "");
        } catch (e) {
          console.error("Slack Superwall connect notification error:", e);
        }
      }

      res.json({
        success: true,
        message: "Superwall integration configured successfully",
        config: {
          enabled: true,
          superwallProjectId,
          superwallApplicationId,
          superwallProjectName,
          superwallApplicationName,
        },
      });
    } catch (error) {
      console.error("Error configuring Superwall:", error);
      res.status(500).json({
        success: false,
        error: "Failed to configure Superwall integration",
      });
    }
  },
);

/**
 * GET /api/v1/projects/:projectId/superwall/config
 * Get Superwall configuration status (not the actual credentials)
 */
router.get(
  "/:projectId/superwall/config",
  async (req: Request, res: Response) => {
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
        config: {
          enabled: project.superwall_enabled || false,
          hasApiKey: !!project.superwall_api_key,
          superwallProjectId: project.superwall_project_id || null,
          superwallApplicationId: project.superwall_application_id || null,
          superwallProjectName: project.superwall_project_name || null,
          superwallApplicationName:
            project.superwall_application_name || null,
        },
      });
    } catch (error) {
      console.error("Error getting Superwall config:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get Superwall configuration",
      });
    }
  },
);

/**
 * DELETE /api/v1/projects/:projectId/superwall/config
 * Remove Superwall integration from a project
 */
router.delete(
  "/:projectId/superwall/config",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const project = await storage.getProject(projectId);

      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      await storage.updateProjectSuperwallConfig(projectId, {
        superwall_api_key: null,
        superwall_project_id: null,
        superwall_application_id: null,
        superwall_project_name: null,
        superwall_application_name: null,
        superwall_enabled: false,
      });

      res.json({
        success: true,
        message: "Superwall integration removed",
      });
    } catch (error) {
      console.error("Error removing Superwall config:", error);
      res.status(500).json({
        success: false,
        error: "Failed to remove Superwall integration",
      });
    }
  },
);

/**
 * GET /api/v1/projects/:projectId/superwall/statistics
 * Get application statistics from Superwall
 */
router.get(
  "/:projectId/superwall/statistics",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const from = req.query.from as string;
      const to = req.query.to as string;
      const environment =
        (req.query.environment as "PRODUCTION" | "SANDBOX") || "PRODUCTION";

      if (!from || !to) {
        return res.status(400).json({
          success: false,
          error: "'from' and 'to' query parameters are required",
        });
      }

      const { config, project, error } =
        await getProjectSuperwallConfig(projectId);

      if (error || !config) {
        return res.status(project ? 400 : 404).json({
          success: false,
          error: error || "Superwall not configured",
        });
      }

      const statistics = await getApplicationStatistics(
        config,
        config.superwallProjectId,
        config.superwallApplicationId,
        from,
        to,
        environment,
      );

      res.json({
        success: true,
        statistics,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching Superwall statistics:", error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.message || "Failed to fetch Superwall statistics",
      });
    }
  },
);

/**
 * GET /api/v1/projects/:projectId/superwall/transactions
 * Get recent transactions from Superwall
 */
router.get(
  "/:projectId/superwall/transactions",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const from = req.query.from as string;
      const to = req.query.to as string;
      const environment =
        (req.query.environment as "PRODUCTION" | "SANDBOX") || "PRODUCTION";

      if (!from || !to) {
        return res.status(400).json({
          success: false,
          error: "'from' and 'to' query parameters are required",
        });
      }

      const { config, project, error } =
        await getProjectSuperwallConfig(projectId);

      if (error || !config) {
        return res.status(project ? 400 : 404).json({
          success: false,
          error: error || "Superwall not configured",
        });
      }

      const transactions = await getRecentTransactions(
        config,
        config.superwallProjectId,
        config.superwallApplicationId,
        from,
        to,
        environment,
      );

      res.json({
        success: true,
        transactions,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching Superwall transactions:", error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.message || "Failed to fetch Superwall transactions",
      });
    }
  },
);

/**
 * GET /api/v1/projects/:projectId/superwall/overview
 * Get full revenue overview: statistics + recent transactions
 */
router.get(
  "/:projectId/superwall/overview",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const { config, project, error } =
        await getProjectSuperwallConfig(projectId);

      if (error || !config) {
        return res.status(project ? 400 : 404).json({
          success: false,
          error: error || "Superwall not configured",
        });
      }

      const now = new Date();
      const from28d = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

      const [statistics, transactions, chartDefs] = await Promise.all([
        getApplicationStatistics(
          config,
          config.superwallProjectId,
          config.superwallApplicationId,
          from28d.toISOString(),
          now.toISOString(),
          "PRODUCTION",
        ).catch(() => []),
        getRecentTransactions(
          config,
          config.superwallProjectId,
          config.superwallApplicationId,
          from28d.toISOString(),
          now.toISOString(),
          "PRODUCTION",
        ).catch(() => []),
        getChartDefinitions(config, config.superwallApplicationId).catch(() => []),
      ]);

      // Also fetch all-time stats for lifetime revenue
      const allTimeStats = await getApplicationStatistics(
        config,
        config.superwallProjectId,
        config.superwallApplicationId,
        "2020-01-01",
        now.toISOString(),
        "PRODUCTION",
      ).catch(() => []);

      const lifetimeRevenue = allTimeStats
        .filter((s: any) => s.value?.type === "currency")
        .reduce((sum: number, s: any) => sum + (s.value?.value || 0), 0);

      // Compute summary from statistics
      const totalRevenue = statistics
        .filter((s: any) => s.value?.type === "currency")
        .reduce((sum: number, s: any) => sum + (s.value?.value || 0), 0);

      const totalTransactions = transactions.length;

      // Superwall event types: "Direct Sub Start", "Sub Cancel", "Free Trial Start",
      // "Non Renewing Purchase", "Renewal", etc.
      const cancelKeywords = ["cancel", "expire", "expiration"];
      const refundKeywords = ["refund"];

      const purchases = transactions.filter((t: any) => {
        const et = (t.event_type || "").toLowerCase();
        return (
          !cancelKeywords.some((k) => et.includes(k)) &&
          !refundKeywords.some((k) => et.includes(k)) &&
          (t.price || 0) > 0
        );
      });
      const refunds = transactions.filter((t: any) => {
        const et = (t.event_type || "").toLowerCase();
        return refundKeywords.some((k) => et.includes(k));
      });
      const cancellations = transactions.filter((t: any) => {
        const et = (t.event_type || "").toLowerCase();
        return cancelKeywords.some((k) => et.includes(k));
      });

      const purchaseRevenue = purchases.reduce(
        (sum: number, t: any) => sum + (t.price || 0),
        0,
      );
      const refundAmount = refunds.reduce(
        (sum: number, t: any) => sum + (t.price || 0),
        0,
      );

      res.json({
        success: true,
        summary: {
          mrr: totalRevenue || purchaseRevenue,
          netRevenue: lifetimeRevenue || (totalRevenue || purchaseRevenue),
          totalTransactions,
          totalPurchases: purchases.length,
          totalRefunds: refunds.length,
          totalCancellations: cancellations.length,
          totalRevenue: totalRevenue || purchaseRevenue,
          averageTransactionValue:
            purchases.length > 0 ? purchaseRevenue / purchases.length : 0,
        },
        statistics,
        transactions: transactions.slice(0, 20),
        lastUpdated: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching Superwall overview:", error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.message || "Failed to fetch Superwall overview",
      });
    }
  },
);

/**
 * POST /api/v1/projects/:projectId/superwall/webhooks
 * Receive webhook events from Superwall and forward to Slack + SSE
 *
 * Superwall sends events like: initial_purchase, renewal, cancellation,
 * billing_issue, expiration, uncancellation, non_renewing_purchase,
 * product_change, subscription_extended, subscription_paused
 */
router.post(
  "/:projectId/superwall/webhooks",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const payload = req.body;

      console.log("Received Superwall webhook:", {
        projectId,
        type: payload.event?.type || payload.type,
        timestamp: new Date().toISOString(),
      });

      // Acknowledge immediately
      res.status(200).send("OK");

      // Normalize event data from Superwall webhook payload
      const event = payload.event || payload;
      const eventType = (
        event.type ||
        event.event_type ||
        "UNKNOWN"
      ).toUpperCase().replace(/\s+/g, "_");

      // Broadcast for real-time SSE listeners
      emitProjectEvent({
        projectId,
        type: "payment",
        data: {
          eventName: eventType,
          timestamp: Date.now(),
          paymentType: eventType,
          product_id: event.product_id || event.product?.id,
          price_in_purchased_currency: event.price,
          currency: event.currency,
          store: event.store || "superwall",
        },
      });

      // Forward to Slack if connected
      try {
        const project = await storage.getProject(projectId);
        if (
          project?.slack_enabled &&
          project.slack_notify_payments &&
          project.slack_webhook_url
        ) {
          const webhookUrl = decrypt(project.slack_webhook_url);
          sendPaymentNotification(webhookUrl, {
            type: eventType,
            app_user_id: event.user?.app_user_id || event.app_user_id,
            product_id: event.product_id || event.product?.id,
            price_in_purchased_currency: event.price,
            currency: event.currency,
            store: event.store || "Superwall",
          });
        }
      } catch (slackErr) {
        console.error("Superwall → Slack notification error:", slackErr);
      }
    } catch (error) {
      console.error("Superwall webhook processing error:", error);
      res.status(200).send("Error logged");
    }
  },
);

export default router;
