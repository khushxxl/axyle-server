import { Router } from "express";
import { randomBytes } from "crypto";
import { storage } from "../db";
import { encrypt, decrypt } from "../utils/encryption";
import {
  validateCredentials,
  getRevenueSummary,
  getProjectName,
  type RevenueCatConfig,
} from "../services/revenuecatService";

const router = Router();

function generateToken(): string {
  return randomBytes(8).toString("base64url");
}

// POST /validate — Validate RevenueCat credentials and return current metrics (no save)
router.post("/validate", async (req, res) => {
  try {
    const { secretKey, revenuecatProjectId } = req.body;
    if (!secretKey || !revenuecatProjectId) {
      return res
        .status(400)
        .json({ success: false, error: "secretKey and revenuecatProjectId are required" });
    }

    const config: RevenueCatConfig = {
      secretKey,
      projectId: revenuecatProjectId,
    };

    const validation = await validateCredentials(config);
    if (!validation.valid) {
      return res
        .status(400)
        .json({ success: false, error: validation.error });
    }

    // Fetch current metrics + project name
    const [summary, projectName] = await Promise.all([
      getRevenueSummary(config),
      getProjectName(config),
    ]);

    res.json({
      success: true,
      metrics: summary,
      appName: projectName,
    });
  } catch (error) {
    console.error("Error validating RevenueCat credentials:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to validate credentials" });
  }
});

// POST / — Create a new shareable MRR card
router.post("/", async (req, res) => {
  try {
    const { secretKey, revenuecatProjectId, styleConfig } = req.body;
    if (!secretKey || !revenuecatProjectId) {
      return res
        .status(400)
        .json({ success: false, error: "secretKey and revenuecatProjectId are required" });
    }

    // Validate credentials first
    const config: RevenueCatConfig = {
      secretKey,
      projectId: revenuecatProjectId,
    };
    const validation = await validateCredentials(config);
    if (!validation.valid) {
      return res
        .status(400)
        .json({ success: false, error: validation.error });
    }

    // Fetch project name from RevenueCat
    const appName = await getProjectName(config);

    // Encrypt credentials
    const encryptedCredentials = encrypt(
      JSON.stringify({ secretKey, projectId: revenuecatProjectId })
    );

    const token = generateToken();
    const card = await storage.createShareMRRCard({
      token,
      revenuecatCredentials: encryptedCredentials,
      styleConfig: styleConfig || {},
      appName,
    });

    res.json({
      success: true,
      token: card.token,
      id: card.id,
    });
  } catch (error) {
    console.error("Error creating ShareMRR card:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to create share link" });
  }
});

// GET /:token — Fetch live metrics for a shareable card
router.get("/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const card = await storage.getShareMRRCard(token);

    if (!card) {
      return res
        .status(404)
        .json({ success: false, error: "Card not found" });
    }

    // Decrypt credentials and fetch live metrics
    const credentials = JSON.parse(decrypt(card.revenuecat_credentials));
    const rcConfig: RevenueCatConfig = {
      secretKey: credentials.secretKey,
      projectId: credentials.projectId,
    };

    const [summary, projectName] = await Promise.all([
      getRevenueSummary(rcConfig),
      getProjectName(rcConfig),
    ]);

    res.json({
      success: true,
      metrics: summary,
      styleConfig: card.style_config,
      appName: projectName || card.app_name,
      createdAt: card.created_at,
    });
  } catch (error) {
    console.error("Error fetching ShareMRR card:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch card data" });
  }
});

export default router;
