import { Router } from "express";
import OpenAI from "openai";
import { randomBytes } from "crypto";
import { config } from "../config";
import { storage } from "../db";

const router = Router();

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Simple IP-based rate limiting: max 10 generations per hour
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function generateToken(): string {
  return randomBytes(8).toString("base64url");
}

function buildSystemPrompt(formData: {
  appName: string;
  platform: string;
  companyName: string;
  contactEmail: string;
  websiteUrl?: string;
  dataCollected: string[];
  thirdPartySdks: string[];
  childrenData: boolean;
  dataSharing: boolean;
  dataSharingDescription?: string;
  effectiveDate: string;
}): string {
  const dataList = formData.dataCollected.length > 0
    ? formData.dataCollected.map((d) => `- ${d}`).join("\n")
    : "- No specific data categories selected";

  const sdkList = formData.thirdPartySdks.length > 0
    ? formData.thirdPartySdks.map((s) => `- ${s}`).join("\n")
    : "- No third-party SDKs specified";

  const platformLabel: Record<string, string> = {
    ios: "iOS",
    android: "Android",
    both: "iOS and Android",
    web: "Web",
    all: "iOS, Android, and Web",
  };

  return `You are a legal document generator specializing in mobile and web application privacy policies. Generate a comprehensive, professional privacy policy that is compliant with GDPR, CCPA, and applicable privacy regulations.

## App Details
- **App Name**: ${formData.appName}
- **Platform**: ${platformLabel[formData.platform] || formData.platform}
- **Company/Developer**: ${formData.companyName}
- **Contact Email**: ${formData.contactEmail}
${formData.websiteUrl ? `- **Website**: ${formData.websiteUrl}` : ""}
- **Effective Date**: ${formData.effectiveDate}

## Data Collected
${dataList}

## Third-Party Services/SDKs
${sdkList}

## Additional Information
- **Collects children's data (under 13)**: ${formData.childrenData ? "Yes" : "No"}
- **Shares data with third parties**: ${formData.dataSharing ? "Yes" : "No"}
${formData.dataSharing && formData.dataSharingDescription ? `- **Data sharing details**: ${formData.dataSharingDescription}` : ""}

## Instructions
Generate a complete privacy policy in clean Markdown format. Include these sections:

1. **Introduction** - Brief overview of the policy
2. **Information We Collect** - Detail each type of data collected based on the categories above
3. **How We Use Your Information** - Purposes for data collection
4. **Third-Party Services** - Detail each SDK/service listed and what data they access
5. **Data Sharing and Disclosure** - When and why data may be shared
6. **Data Retention** - How long data is kept
7. **Data Security** - Security measures in place
${formData.childrenData ? "8. **Children's Privacy** - COPPA compliance section for users under 13\n" : ""}${formData.childrenData ? "9" : "8"}. **Your Rights** - GDPR/CCPA rights (access, deletion, opt-out, portability)
${formData.childrenData ? "10" : "9"}. **Changes to This Policy** - How users will be notified of changes
${formData.childrenData ? "11" : "10"}. **Contact Us** - Contact information

Rules:
- Use professional, clear language that is easy to understand
- Be specific about the data types and SDKs mentioned
- Include specific rights under GDPR and CCPA where applicable
- Use the app name, company name, and contact email throughout
- Format with proper Markdown headings (##), bullet points, and bold text
- Do NOT include markdown code fences around the output - just output the policy directly`;
}

// POST /generate - Generate a privacy policy using AI
router.post("/generate", async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
      });
    }

    const {
      appName,
      platform,
      companyName,
      contactEmail,
      websiteUrl,
      dataCollected,
      thirdPartySdks,
      childrenData,
      dataSharing,
      dataSharingDescription,
      effectiveDate,
    } = req.body;

    if (!appName || !companyName || !contactEmail) {
      return res.status(400).json({
        success: false,
        error: "App name, company name, and contact email are required.",
      });
    }

    const systemPrompt = buildSystemPrompt({
      appName,
      platform: platform || "both",
      companyName,
      contactEmail,
      websiteUrl,
      dataCollected: dataCollected || [],
      thirdPartySdks: thirdPartySdks || [],
      childrenData: childrenData || false,
      dataSharing: dataSharing || false,
      dataSharingDescription,
      effectiveDate: effectiveDate || new Date().toISOString().split("T")[0],
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Generate the privacy policy now. Output only the policy in Markdown format, nothing else.",
        },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });

    const content = completion.choices[0]?.message?.content ?? "";

    res.json({ success: true, content });
  } catch (error) {
    console.error("Error generating privacy policy:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to generate privacy policy" });
  }
});

// POST / - Save a generated policy and get a shareable token
router.post("/", async (req, res) => {
  try {
    const { appName, content, formData, effectiveDate } = req.body;

    if (!appName || !content) {
      return res.status(400).json({
        success: false,
        error: "App name and content are required.",
      });
    }

    const token = generateToken();
    if (!storage) {
      return res.status(503).json({ success: false, error: "Storage not configured" });
    }

    await storage.createPrivacyPolicy({
      token,
      appName,
      policyContent: content,
      formData: formData || {},
      effectiveDate: effectiveDate || new Date().toISOString().split("T")[0],
    });

    res.json({ success: true, token });
  } catch (error) {
    console.error("Error saving privacy policy:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to save privacy policy" });
  }
});

// GET /:token - Fetch a saved privacy policy
router.get("/:token", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, error: "Token is required" });
    }

    if (!storage) {
      return res.status(503).json({ success: false, error: "Storage not configured" });
    }
    const policy = await storage.getPrivacyPolicy(token);

    if (!policy) {
      return res.status(404).json({ success: false, error: "Policy not found" });
    }

    res.json({
      success: true,
      appName: policy.app_name,
      policyContent: policy.policy_content,
      effectiveDate: policy.effective_date,
      createdAt: policy.created_at,
    });
  } catch (error) {
    console.error("Error fetching privacy policy:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch privacy policy" });
  }
});

export default router;
