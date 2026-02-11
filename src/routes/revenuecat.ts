/**
 * RevenueCat routes - manage RevenueCat integration and fetch metrics
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";
import {
  getOverviewMetrics,
  parseOverviewMetrics,
  getSpecificMetric,
  getRevenueSummary,
  validateCredentials,
  getAvailableMetricIds,
  registerWebhook,
  deleteWebhook,
  RevenueCatConfig,
} from "../services/revenuecatService";
import { encrypt, decrypt } from "../utils/encryption";
import { sendPaymentNotification } from "../services/slackService";
import broadcaster from "../services/eventBroadcaster";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

const router = Router();

/**
 * Helper to get RevenueCat config from project
 */
async function getProjectRevenueCatConfig(
  projectId: string
): Promise<{ config: RevenueCatConfig | null; project: any; error?: string }> {
  const project = await storage.getProject(projectId);

  if (!project) {
    return { config: null, project: null, error: "Project not found" };
  }

  if (!project.revenuecat_enabled) {
    return {
      config: null,
      project,
      error: "RevenueCat integration is not enabled for this project",
    };
  }

  if (!project.revenuecat_secret_key || !project.revenuecat_project_id) {
    return {
      config: null,
      project,
      error: "RevenueCat credentials are not configured",
    };
  }

  // Decrypt the secret key for API calls
  let decryptedSecretKey: string;
  try {
    decryptedSecretKey = decrypt(project.revenuecat_secret_key);
  } catch (error) {
    console.error("Failed to decrypt RevenueCat secret key:", error);
    return {
      config: null,
      project,
      error: "Failed to decrypt credentials",
    };
  }

  return {
    config: {
      secretKey: decryptedSecretKey,
      projectId: project.revenuecat_project_id,
    },
    project,
  };
}

/**
 * PUT /api/v1/projects/:projectId/revenuecat/config
 * Configure RevenueCat integration for a project
 */
router.put("/:projectId/revenuecat/config", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { secretKey, revenuecatProjectId, enabled = true } = req.body;

    // Verify project exists
    const project = await storage.getProject(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    // If enabling, validate credentials
    if (enabled && secretKey && revenuecatProjectId) {
      const validation = await validateCredentials({
        secretKey,
        projectId: revenuecatProjectId,
      });

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid RevenueCat credentials: ${validation.error}`,
        });
      }
    }

    // Encrypt the secret key before storing (we never store plain keys)
    const encryptedSecretKey = secretKey ? encrypt(secretKey) : null;

    // Auto-register our webhook endpoint with RevenueCat
    let webhookIntegrationId: string | null = null;
    if (enabled && secretKey && revenuecatProjectId) {
      const webhookUrl = `${API_BASE_URL}/api/v1/projects/${projectId}/revenuecat/webhooks`;
      const result = await registerWebhook(
        { secretKey, projectId: revenuecatProjectId },
        webhookUrl,
        project.name || "App"
      );
      if ("id" in result) {
        webhookIntegrationId = result.id;
        console.log(
          `Registered RevenueCat webhook ${result.id} for project ${projectId}`
        );
      } else {
        console.warn(
          `Failed to auto-register webhook: ${result.error}. Continuing without webhook.`
        );
      }
    }

    // Update project with RevenueCat config
    await storage.updateProjectRevenueCatConfig(projectId, {
      revenuecat_secret_key: encryptedSecretKey,
      revenuecat_project_id: revenuecatProjectId || null,
      revenuecat_enabled: enabled,
      revenuecat_webhook_integration_id: webhookIntegrationId,
    });

    res.json({
      success: true,
      message: enabled
        ? "RevenueCat integration configured successfully"
        : "RevenueCat integration disabled",
      config: {
        enabled,
        projectId: revenuecatProjectId,
        webhookRegistered: !!webhookIntegrationId,
      },
    });
  } catch (error) {
    console.error("Error configuring RevenueCat:", error);
    res.status(500).json({
      success: false,
      error: "Failed to configure RevenueCat integration",
    });
  }
});

/**
 * GET /api/v1/projects/:projectId/revenuecat/config
 * Get RevenueCat configuration status (not the actual credentials)
 */
router.get("/:projectId/revenuecat/config", async (req: Request, res: Response) => {
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
        enabled: project.revenuecat_enabled || false,
        hasSecretKey: !!project.revenuecat_secret_key,
        revenuecatProjectId: project.revenuecat_project_id || null,
      },
    });
  } catch (error) {
    console.error("Error getting RevenueCat config:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get RevenueCat configuration",
    });
  }
});

/**
 * DELETE /api/v1/projects/:projectId/revenuecat/config
 * Remove RevenueCat integration from a project
 */
router.delete(
  "/:projectId/revenuecat/config",
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

      // Delete the webhook from RevenueCat if we registered one
      if (
        project.revenuecat_webhook_integration_id &&
        project.revenuecat_secret_key &&
        project.revenuecat_project_id
      ) {
        try {
          const decryptedKey = decrypt(project.revenuecat_secret_key);
          await deleteWebhook(
            { secretKey: decryptedKey, projectId: project.revenuecat_project_id },
            project.revenuecat_webhook_integration_id
          );
          console.log(
            `Deleted RevenueCat webhook ${project.revenuecat_webhook_integration_id} for project ${projectId}`
          );
        } catch (e) {
          console.warn("Failed to delete RevenueCat webhook:", e);
        }
      }

      await storage.updateProjectRevenueCatConfig(projectId, {
        revenuecat_secret_key: null,
        revenuecat_project_id: null,
        revenuecat_enabled: false,
        revenuecat_webhook_integration_id: null,
      });

      res.json({
        success: true,
        message: "RevenueCat integration removed",
      });
    } catch (error) {
      console.error("Error removing RevenueCat config:", error);
      res.status(500).json({
        success: false,
        error: "Failed to remove RevenueCat integration",
      });
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/revenuecat/metrics
 * Get all RevenueCat metrics for a project
 */
router.get("/:projectId/revenuecat/metrics", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const currency = (req.query.currency as string) || "USD";

    const { config, project, error } = await getProjectRevenueCatConfig(projectId);

    if (error || !config) {
      return res.status(project ? 400 : 404).json({
        success: false,
        error: error || "RevenueCat not configured",
      });
    }

    const rawData = await getOverviewMetrics(config, currency);
    const metrics = parseOverviewMetrics(rawData);

    res.json({
      success: true,
      projectId,
      currency,
      metrics,
      rawData,
    });
  } catch (error: any) {
    console.error("Error fetching RevenueCat metrics:", error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || "Failed to fetch RevenueCat metrics",
      details: error.response?.data,
    });
  }
});

/**
 * GET /api/v1/projects/:projectId/revenuecat/metrics/:metricId
 * Get a specific RevenueCat metric
 */
router.get(
  "/:projectId/revenuecat/metrics/:metricId",
  async (req: Request, res: Response) => {
    try {
      const { projectId, metricId } = req.params;
      const currency = (req.query.currency as string) || "USD";

      const { config, project, error } = await getProjectRevenueCatConfig(projectId);

      if (error || !config) {
        return res.status(project ? 400 : 404).json({
          success: false,
          error: error || "RevenueCat not configured",
        });
      }

      const metric = await getSpecificMetric(config, metricId, currency);

      if (!metric) {
        return res.status(404).json({
          success: false,
          error: `Metric '${metricId}' not found`,
          availableMetrics: getAvailableMetricIds(),
        });
      }

      res.json({
        success: true,
        metric: {
          id: metric.id,
          name: metric.name,
          description: metric.description,
          value: metric.value,
          unit: metric.unit,
          period: metric.period,
          lastUpdated: metric.last_updated_at_iso8601,
        },
      });
    } catch (error: any) {
      console.error("Error fetching RevenueCat metric:", error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.message || "Failed to fetch RevenueCat metric",
      });
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/revenuecat/revenue-summary
 * Get simplified revenue summary
 */
router.get(
  "/:projectId/revenuecat/revenue-summary",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const currency = (req.query.currency as string) || "USD";

      const { config, project, error } = await getProjectRevenueCatConfig(projectId);

      if (error || !config) {
        return res.status(project ? 400 : 404).json({
          success: false,
          error: error || "RevenueCat not configured",
        });
      }

      const summary = await getRevenueSummary(config, currency);

      res.json({
        success: true,
        currency,
        summary,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching revenue summary:", error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.message || "Failed to fetch revenue summary",
      });
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/revenuecat/webhooks
 * Webhook endpoint for RevenueCat events
 */
router.post(
  "/:projectId/revenuecat/webhooks",
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const payload = req.body;

      console.log("Received RevenueCat webhook:", {
        projectId,
        type: payload.event?.type,
        timestamp: new Date().toISOString(),
      });

      // Acknowledge receipt immediately (RevenueCat disconnects after 60s)
      res.status(200).send("OK");

      if (payload.event?.type) {
        const eventData = {
          type: payload.event.type,
          app_user_id: payload.event.app_user_id,
          product_id: payload.event.product_id,
          price_in_purchased_currency:
            payload.event.price_in_purchased_currency,
          currency: payload.event.currency,
          store: payload.event.store,
          country_code: payload.event.country_code,
        };

        // Broadcast to SSE clients for real-time toast
        broadcaster.emit(`payment:${projectId}`, eventData);

        // Fire-and-forget: Slack payment notification
        try {
          const project = await storage.getProject(projectId);
          if (
            project?.slack_enabled &&
            project.slack_notify_payments &&
            project.slack_webhook_url
          ) {
            const webhookUrl = decrypt(project.slack_webhook_url);
            sendPaymentNotification(webhookUrl, eventData);
          }
        } catch (e) {
          console.error("Slack payment notification error:", e);
        }
      }
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(200).send("Error logged");
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/revenuecat/validate
 * Validate RevenueCat credentials without saving
 */
router.post(
  "/:projectId/revenuecat/validate",
  async (req: Request, res: Response) => {
    try {
      const { secretKey, revenuecatProjectId } = req.body;

      if (!secretKey || !revenuecatProjectId) {
        return res.status(400).json({
          success: false,
          error: "Both secretKey and revenuecatProjectId are required",
        });
      }

      const validation = await validateCredentials({
        secretKey,
        projectId: revenuecatProjectId,
      });

      if (validation.valid) {
        res.json({
          success: true,
          message: "Credentials are valid",
        });
      } else {
        res.status(400).json({
          success: false,
          error: validation.error || "Invalid credentials",
        });
      }
    } catch (error: any) {
      console.error("Error validating RevenueCat credentials:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to validate credentials",
      });
    }
  }
);

export default router;
