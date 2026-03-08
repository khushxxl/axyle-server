import { Router } from "express";
import OpenAI from "openai";
import { config } from "../config";
import {
  searchKeyword,
  calculateDifficulty,
  type KeywordResult,
} from "../services/keywordService";

const router = Router();

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// In-memory cache (24h TTL)
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

// POST /research — Full keyword research for a seed keyword
router.post("/research", async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
      return res.status(400).json({ success: false, error: "Keyword is required (min 2 characters)" });
    }

    const seed = keyword.trim().toLowerCase();
    const cacheKey = `kw:${seed}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Step 1: Get AI-generated related keywords
    const aiRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      seed: 42,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an App Store Optimization keyword research expert. Given a seed keyword, generate related keywords that iOS app developers would want to rank for.

Return JSON: { "keywords": string[] }

Rules:
- Return exactly 15 keywords (including the original seed keyword as the first one)
- Mix of: direct variations, long-tail versions, related terms, competitor-adjacent terms
- All keywords should be realistic App Store search terms (what real users type)
- Keep keywords concise (1-4 words each)
- Order by relevance to the seed keyword
- Focus on iOS App Store searches, not web SEO`,
        },
        {
          role: "user",
          content: `Seed keyword: "${seed}"`,
        },
      ],
    });

    let keywords: string[] = [seed];
    try {
      const parsed = JSON.parse(aiRes.choices[0]?.message?.content || "{}");
      if (Array.isArray(parsed.keywords)) {
        keywords = parsed.keywords.map((k: string) => k.toLowerCase().trim()).filter(Boolean);
        // Ensure seed is first
        keywords = [seed, ...keywords.filter((k) => k !== seed)].slice(0, 15);
      }
    } catch {
      // fallback to just the seed keyword
    }

    // Step 2: Search iTunes for each keyword in parallel (batch of 5 to avoid rate limiting)
    const results: KeywordResult[] = [];

    for (let i = 0; i < keywords.length; i += 5) {
      const batch = keywords.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(async (kw) => {
          const { apps, resultCount } = await searchKeyword(kw);
          const { score, difficulty } = calculateDifficulty(apps, resultCount);
          return {
            keyword: kw,
            score,
            difficulty,
            topApps: apps.slice(0, 3),
            resultCount,
          } as KeywordResult;
        }),
      );
      results.push(...batchResults);
    }

    const response = { success: true, seed, results };
    cache.set(cacheKey, { data: response, ts: Date.now() });
    res.json(response);
  } catch (error) {
    console.error("Error in keyword research:", error);
    res.status(500).json({ success: false, error: "Failed to perform keyword research" });
  }
});

// GET /suggest — Quick keyword suggestions (lightweight, no competition data)
router.get("/suggest", async (req, res) => {
  try {
    const term = (req.query.q as string || "").trim();
    if (term.length < 2) {
      return res.json({ success: true, suggestions: [] });
    }

    // Use iTunes Search to find apps, extract unique keywords from their names
    const searchRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=us&limit=25`,
    );
    if (!searchRes.ok) return res.json({ success: true, suggestions: [] });
    const json: any = await searchRes.json();
    const results = json.results || [];

    // Extract keywords from app names
    const wordSet = new Set<string>();
    for (const app of results) {
      const name = (app.trackName || "").toLowerCase();
      // Split by common separators
      const words = name.split(/[\s\-:,|&+]+/).filter((w: string) => w.length > 2);
      words.forEach((w: string) => wordSet.add(w));
    }

    // Also add full app names as suggestions
    const suggestions = results
      .slice(0, 8)
      .map((r: any) => r.trackName as string);

    res.json({ success: true, suggestions });
  } catch {
    res.json({ success: true, suggestions: [] });
  }
});

// GET /screenshots — Scrape screenshots from App Store page (fallback when iTunes API returns none)
router.get("/screenshots", async (req, res) => {
  try {
    const appId = (req.query.appId as string || "").trim();
    if (!appId) return res.json({ success: true, screenshots: [] });

    const pageRes = await fetch(`https://apps.apple.com/us/app/id${appId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    if (!pageRes.ok) return res.json({ success: true, screenshots: [] });

    const html = await pageRes.text();
    const regex = /https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/PurpleSource[^"'\s,]*?\/460x998bb(?:-60)?\.(?:jpg|webp|png)/g;
    const matches = html.match(regex);

    if (!matches || matches.length === 0) {
      return res.json({ success: true, screenshots: [] });
    }

    // Deduplicate by base path
    const seen = new Set<string>();
    const screenshots: string[] = [];
    for (const url of matches) {
      const base = url.replace(/\/460x998bb.*$/, "");
      if (!seen.has(base)) {
        seen.add(base);
        screenshots.push(`${base}/460x998bb.png`);
      }
    }

    res.json({ success: true, screenshots });
  } catch {
    res.json({ success: true, screenshots: [] });
  }
});

export default router;
