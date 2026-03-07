import { Router } from "express";
import OpenAI from "openai";
import { config } from "../config";
import {
  parseAppId,
  fetchAppStoreInfo,
  extractASOMetrics,
  fetchBadReviews,
  type AppStoreInfo,
  type ASOMetrics,
} from "../services/asoService";

const router = Router();

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// In-memory audit cache — keyed by appId (no competitors) or appId+competitorIds
// TTL: 24 hours. Prevents inconsistent scores for the same app.
const auditCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function getCacheKey(appId: string, competitorIds?: string[]): string {
  const base = `aso:${appId}`;
  if (competitorIds && competitorIds.length > 0) {
    return `${base}:${competitorIds.sort().join(",")}`;
  }
  return base;
}

function buildSystemPrompt(
  app: AppStoreInfo,
  metrics: ASOMetrics,
  competitors?: Array<{ app: AppStoreInfo; metrics: ASOMetrics }>,
): string {
  let prompt = `You are an expert App Store Optimization (ASO) analyst. Analyze the following iOS app listing and provide a detailed ASO audit.

## App Metadata
- **Name**: ${app.trackName}
- **Seller**: ${app.sellerName}
- **Primary Genre**: ${app.primaryGenreName}
- **Genres**: ${app.genres.join(", ")}
- **Price**: ${app.formattedPrice || "Free"}
- **Rating**: ${metrics.averageRating.toFixed(1)}/5 (${metrics.ratingCount.toLocaleString()} ratings)
- **Version**: ${app.version}
- **Content Rating**: ${app.contentAdvisoryRating}
- **Minimum OS**: ${app.minimumOsVersion}
- **App Size**: ${metrics.appSizeMB} MB
- **Localizations**: ${metrics.localizationCount} languages
- **Days Since Last Update**: ${metrics.daysSinceUpdate >= 0 ? metrics.daysSinceUpdate : "Unknown"}
- **Has Release Notes**: ${metrics.hasReleaseNotes ? "Yes" : "No"}
- **Release Notes Length**: ${metrics.releaseNotesLength} chars

## Title
${app.trackName}

## Description (first 500 chars)
${app.description.slice(0, 500)}${app.description.length > 500 ? "..." : ""}

## Release Notes
${app.releaseNotes ? app.releaseNotes.slice(0, 300) : "None provided"}`;

  if (competitors && competitors.length > 0) {
    prompt += `\n\n## Competitor Apps`;
    for (const c of competitors) {
      prompt += `\n\n### ${c.app.trackName}
- **Genre**: ${c.app.primaryGenreName}
- **Rating**: ${c.metrics.averageRating.toFixed(1)}/5 (${c.metrics.ratingCount.toLocaleString()} ratings)
- **App Size**: ${c.metrics.appSizeMB} MB
- **Localizations**: ${c.metrics.localizationCount}
- **Days Since Update**: ${c.metrics.daysSinceUpdate >= 0 ? c.metrics.daysSinceUpdate : "Unknown"}
- **Description (first 300 chars)**: ${c.app.description.slice(0, 300)}...`;
    }
  }

  prompt += `

## Instructions
Provide your analysis as a JSON object with this exact structure:
{
  "overallScore": <number 0-100>,
  "categories": [
    {
      "name": "Title & Subtitle",
      "score": <number 0-100>,
      "findings": ["finding1", "finding2", ...],
      "recommendations": ["rec1", "rec2", ...]
    },
    {
      "name": "Description",
      "score": <number 0-100>,
      "findings": [...],
      "recommendations": [...]
    },
    {
      "name": "Ratings & Reviews",
      "score": <number 0-100>,
      "findings": [...],
      "recommendations": [...]
    },
    {
      "name": "Technical",
      "score": <number 0-100>,
      "findings": [...],
      "recommendations": [...]
    }
  ]${
    competitors && competitors.length > 0
      ? `,
  "competitorComparison": {
    "metrics": [
      { "label": "Metric Name", "mainApp": "value", "competitors": [{ "name": "CompName", "value": "value" }] }
    ],
    "summary": "Brief competitive analysis summary"
  }`
      : ""
  }
}

Rules:
- Score each category 0-100 based on ASO best practices
- Provide 2-4 specific findings per category (prefix good findings with ✓ and issues with ✗)
- Provide 2-3 actionable recommendations per category
- The overall score should be a weighted average of category scores
- Be specific and actionable — reference actual data from the listing
${competitors && competitors.length > 0 ? "- Compare metrics side-by-side with competitors and highlight advantages/disadvantages" : ""}
- Return ONLY valid JSON, no markdown fences or extra text`;

  return prompt;
}

// GET /search — Search App Store by name
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 2) {
      return res.json({ success: true, results: [] });
    }

    const response = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=software&country=us&limit=6`,
    );
    if (!response.ok) {
      return res.json({ success: true, results: [] });
    }

    const json: any = await response.json();
    const results = (json.results || []).map((r: any) => ({
      trackId: r.trackId,
      trackName: r.trackName ?? "",
      sellerName: r.sellerName ?? "",
      primaryGenreName: r.primaryGenreName ?? "",
      artworkUrl100: r.artworkUrl100 ?? "",
      averageUserRating: r.averageUserRating ?? 0,
    }));

    res.json({ success: true, results });
  } catch (error) {
    console.error("Error searching App Store:", error);
    res.json({ success: true, results: [] });
  }
});

// POST /audit — Run ASO audit
router.post("/audit", async (req, res) => {
  try {
    const { appId: rawAppId, competitors: rawCompetitors } = req.body;

    if (!rawAppId) {
      return res
        .status(400)
        .json({ success: false, error: "appId is required" });
    }

    const appId = parseAppId(rawAppId);
    if (!appId) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid App Store URL or ID" });
    }

    // Parse competitor IDs early for cache key
    const competitorIds = (rawCompetitors && Array.isArray(rawCompetitors))
      ? rawCompetitors.slice(0, 2).map((c: string) => parseAppId(c)).filter((id): id is string => id !== null)
      : [];

    // Check cache
    const cacheKey = getCacheKey(appId, competitorIds);
    const cached = auditCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    // Fetch main app
    let app: AppStoreInfo;
    try {
      app = await fetchAppStoreInfo(appId);
    } catch (err: any) {
      return res
        .status(404)
        .json({ success: false, error: err.message || "App not found" });
    }

    const metrics = extractASOMetrics(app);

    // Fetch competitors (optional, max 2)
    let competitorData: Array<{ app: AppStoreInfo; metrics: ASOMetrics }> | undefined;
    if (competitorIds.length > 0) {
      const results = await Promise.allSettled(
        competitorIds.map((id) => fetchAppStoreInfo(id)),
      );
      competitorData = results
        .filter(
          (r): r is PromiseFulfilledResult<AppStoreInfo> =>
            r.status === "fulfilled",
        )
        .map((r) => ({
          app: r.value,
          metrics: extractASOMetrics(r.value),
        }));
    }

    // Build prompt and call OpenAI (temperature 0 + seed for determinism)
    const systemPrompt = buildSystemPrompt(app, metrics, competitorData);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Analyze this app listing and return the ASO audit JSON." },
      ],
      temperature: 0,
      seed: 42,
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```\n?$/g, "").trim();

    let audit;
    try {
      audit = JSON.parse(jsonStr);
    } catch {
      return res
        .status(500)
        .json({ success: false, error: "Failed to parse AI response" });
    }

    const responseData = {
      success: true,
      app: {
        trackId: app.trackId,
        trackName: app.trackName,
        sellerName: app.sellerName,
        primaryGenreName: app.primaryGenreName,
        averageUserRating: app.averageUserRating,
        userRatingCount: app.userRatingCount,
        artworkUrl512: app.artworkUrl512,
        screenshotUrls: app.screenshotUrls,
        version: app.version,
        formattedPrice: app.formattedPrice,
      },
      metrics,
      audit,
      competitors: competitorData?.map((c) => ({
        trackId: c.app.trackId,
        trackName: c.app.trackName,
        artworkUrl512: c.app.artworkUrl512,
        primaryGenreName: c.app.primaryGenreName,
        averageUserRating: c.app.averageUserRating,
        userRatingCount: c.app.userRatingCount,
      })),
    };

    // Cache the result for 24h
    auditCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + CACHE_TTL });

    res.json(responseData);
  } catch (error) {
    console.error("Error running ASO audit:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to run ASO audit" });
  }
});

// GET /reviews — Fetch bad reviews for an app
router.get("/reviews", async (req, res) => {
  try {
    const rawId = (req.query.appId as string || "").trim();
    if (!rawId) {
      return res.status(400).json({ success: false, error: "appId is required" });
    }

    const appId = parseAppId(rawId);
    if (!appId) {
      return res.status(400).json({ success: false, error: "Invalid App Store URL or ID" });
    }

    const reviews = await fetchBadReviews(appId, 10);
    res.json({ success: true, reviews });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.json({ success: true, reviews: [] });
  }
});

export default router;
