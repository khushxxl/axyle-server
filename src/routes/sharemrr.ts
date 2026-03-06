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
import {
  searchStartups,
  getStartupBySlug,
  extractMetrics,
} from "../services/trustmrrService";

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

// POST /trustmrr/search — Search TrustMRR startups by X handle
router.post("/trustmrr/search", async (req, res) => {
  try {
    const { xHandle } = req.body;
    if (!xHandle) {
      return res
        .status(400)
        .json({ success: false, error: "xHandle is required" });
    }

    const startups = await searchStartups(xHandle);
    res.json({
      success: true,
      startups: startups.map((s: any) => ({
        slug: s.slug,
        name: s.name,
        icon: s.icon,
        mrr: (s.revenue?.mrr ?? s.mrr ?? 0),
        totalRevenue: (s.revenue?.total ?? s.total ?? 0),
      })),
    });
  } catch (error) {
    console.error("Error searching TrustMRR startups:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to search startups" });
  }
});

// POST /trustmrr/connect — Connect to a TrustMRR startup by slug, return full metrics
router.post("/trustmrr/connect", async (req, res) => {
  try {
    const { slug } = req.body;
    if (!slug) {
      return res
        .status(400)
        .json({ success: false, error: "slug is required" });
    }

    const startup = await getStartupBySlug(slug);
    if (!startup) {
      return res
        .status(404)
        .json({ success: false, error: "Startup not found" });
    }

    const metrics = extractMetrics(startup);
    res.json({
      success: true,
      metrics,
      appName: startup.name,
      icon: startup.icon,
      xHandle: startup.xHandle || null,
    });
  } catch (error) {
    console.error("Error connecting TrustMRR startup:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to connect startup" });
  }
});

// POST / — Create a new shareable MRR card
router.post("/", async (req, res) => {
  try {
    const { source = "revenuecat", secretKey, revenuecatProjectId, trustmrrSlug, styleConfig } = req.body;

    if (source === "trustmrr") {
      if (!trustmrrSlug) {
        return res
          .status(400)
          .json({ success: false, error: "trustmrrSlug is required for TrustMRR source" });
      }

      // Validate slug exists
      const startup = await getStartupBySlug(trustmrrSlug);
      if (!startup) {
        return res
          .status(400)
          .json({ success: false, error: "Startup not found on TrustMRR" });
      }

      const token = generateToken();
      const card = await storage.createShareMRRCard({
        token,
        styleConfig: styleConfig || {},
        appName: startup.name,
        source: "trustmrr",
        trustmrrSlug,
      });

      res.json({
        success: true,
        token: card.token,
        id: card.id,
      });
    } else {
      // RevenueCat flow (existing)
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

      const appName = await getProjectName(config);
      const encryptedCredentials = encrypt(
        JSON.stringify({ secretKey, projectId: revenuecatProjectId })
      );

      const token = generateToken();
      const card = await storage.createShareMRRCard({
        token,
        revenuecatCredentials: encryptedCredentials,
        styleConfig: styleConfig || {},
        appName,
        source: "revenuecat",
      });

      res.json({
        success: true,
        token: card.token,
        id: card.id,
      });
    }
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

    const cardSource = card.source || "revenuecat";

    if (cardSource === "trustmrr") {
      if (!card.trustmrr_slug) {
        return res
          .status(500)
          .json({ success: false, error: "TrustMRR slug missing from card" });
      }

      const startup = await getStartupBySlug(card.trustmrr_slug);
      if (!startup) {
        return res
          .status(404)
          .json({ success: false, error: "Startup no longer found on TrustMRR" });
      }

      const metrics = extractMetrics(startup);
      res.json({
        success: true,
        source: "trustmrr",
        metrics,
        styleConfig: card.style_config,
        appName: startup.name || card.app_name,
        icon: startup.icon,
        xHandle: startup.xHandle || null,
        createdAt: card.created_at,
      });
    } else {
      // RevenueCat flow (existing)
      if (!card.revenuecat_credentials) {
        return res
          .status(500)
          .json({ success: false, error: "RevenueCat credentials missing from card" });
      }

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
        source: "revenuecat",
        metrics: summary,
        styleConfig: card.style_config,
        appName: projectName || card.app_name,
        createdAt: card.created_at,
      });
    }
  } catch (error) {
    console.error("Error fetching ShareMRR card:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch card data" });
  }
});

export default router;
