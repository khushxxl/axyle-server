/**
 * AI routes - OpenAI-powered analytics assistant
 */

import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { storage } from "../db";
import { requireSupabaseAuth } from "../middleware/supabaseAuth";

const router = Router();

/**
 * Parse a user message for date range intent (e.g. "last 30 days", "past 2 weeks", "this month")
 * Returns { days, label } or null if no date range detected
 */
function parseDateRangeFromMessage(message: string): { days: number; label: string } | null {
  const msg = message.toLowerCase();

  // "last/past N days"
  const daysMatch = msg.match(/(?:last|past|previous)\s+(\d+)\s*days?/);
  if (daysMatch) {
    const days = Math.min(parseInt(daysMatch[1], 10), 365);
    return { days, label: `last ${days} days` };
  }

  // "last/past N weeks"
  const weeksMatch = msg.match(/(?:last|past|previous)\s+(\d+)\s*weeks?/);
  if (weeksMatch) {
    const weeks = Math.min(parseInt(weeksMatch[1], 10), 52);
    return { days: weeks * 7, label: `last ${weeks} week${weeks > 1 ? "s" : ""}` };
  }

  // "last/past N months"
  const monthsMatch = msg.match(/(?:last|past|previous)\s+(\d+)\s*months?/);
  if (monthsMatch) {
    const months = Math.min(parseInt(monthsMatch[1], 10), 12);
    return { days: months * 30, label: `last ${months} month${months > 1 ? "s" : ""}` };
  }

  // "this week" / "this month" / "this year"
  if (/\bthis\s+week\b/.test(msg)) return { days: 7, label: "this week" };
  if (/\bthis\s+month\b/.test(msg)) return { days: 30, label: "this month" };
  if (/\bthis\s+year\b/.test(msg)) return { days: 365, label: "this year" };

  // "last week" / "last month" (without a number)
  if (/\blast\s+week\b/.test(msg) && !daysMatch && !weeksMatch) return { days: 7, label: "last week" };
  if (/\blast\s+month\b/.test(msg) && !monthsMatch) return { days: 30, label: "last month" };

  // "past year" / "last year"
  if (/(?:last|past)\s+year\b/.test(msg)) return { days: 365, label: "last year" };

  // "today"
  if (/\btoday\b/.test(msg)) return { days: 1, label: "today" };

  // "yesterday"
  if (/\byesterday\b/.test(msg)) return { days: 2, label: "last 2 days" };

  return null;
}

// Initialize OpenAI client
const openai = config.openai.apiKey
  ? new OpenAI({
      apiKey: config.openai.apiKey,
    })
  : null;

/**
 * POST /api/v1/ai/chat
 * Chat with AI assistant about analytics
 */
router.post(
  "/chat",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.supabaseUserId;
      const { message, conversationHistory, projectId } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: "Message is required",
        });
      }

      if (!openai) {
        return res.status(503).json({
          success: false,
          error:
            "AI service is not configured. Please set OPENAI_API_KEY environment variable.",
        });
      }

      // Get user's projects
      const projects = await storage.listProjects(userId);

      // If projectId is provided, validate it belongs to the user and filter to that project
      let selectedProject: any = null;
      let projectIds: string[] | undefined = undefined;

      if (projectId) {
        selectedProject = projects.find((p) => p.id === projectId);
        if (!selectedProject) {
          return res.status(404).json({
            success: false,
            error: "Project not found or access denied",
          });
        }
        projectIds = [projectId];
      } else {
        // If no projectId provided, use all projects (backward compatibility)
        projectIds =
          projects.length > 0 ? projects.map((p) => p.id) : undefined;
      }

      // Detect date range from the user's message, or default to 7 days for a project
      const parsedRange = parseDateRangeFromMessage(message);
      const rangeDays = parsedRange ? parsedRange.days : 7;
      const rangeLabel = parsedRange ? parsedRange.label : "last 7 days";

      const dateRange = selectedProject
        ? (() => {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - rangeDays);
            return {
              startDate: startDate.toISOString().split("T")[0],
              endDate: endDate.toISOString().split("T")[0],
            };
          })()
        : parsedRange
          ? (() => {
              const endDate = new Date();
              const startDate = new Date();
              startDate.setDate(startDate.getDate() - rangeDays);
              return {
                startDate: startDate.toISOString().split("T")[0],
                endDate: endDate.toISOString().split("T")[0],
              };
            })()
          : undefined; // No date filter for all projects when no range mentioned

      // Fetch analytics data for the selected project(s)
      const [
        stats,
        eventNames,
        allFunnels,
        allFlows,
        allSegments,
        recentEvents,
      ] = await Promise.all([
        storage.getGlobalEventStats(projectIds, dateRange),
        storage.getEventNames(projectIds).catch(() => []),
        // Fetch funnels for selected project(s)
        projectIds && projectIds.length > 0
          ? Promise.all(
              projectIds.map((pid) => storage.listFunnels(pid).catch(() => []))
            ).then((results) => results.flat())
          : Promise.resolve([]),
        // Fetch flows analytics for selected project(s)
        projectIds && projectIds.length > 0
          ? Promise.all(
              projectIds.map((pid) =>
                storage.getFlowAnalytics(pid).catch(() => ({
                  flows: [],
                  total_flows: 0,
                  total_starts: 0,
                  total_completions: 0,
                  total_abandonments: 0,
                  overall_completion_rate: 0,
                }))
              )
            )
          : Promise.resolve([]),
        // Fetch segments for selected project(s)
        projectIds && projectIds.length > 0
          ? storage
              .listSegments()
              .then((segments) =>
                segments.filter((s: any) => projectIds!.includes(s.project_id))
              )
              .catch(() => [])
          : Promise.resolve([]),
        // Fetch recent events for trend analysis (cap to avoid overloading)
        (() => {
          const eventLimit = rangeDays > 90 ? 5000 : 10000;
          return projectIds && projectIds.length > 0
            ? Promise.all(
                projectIds.map((pid) =>
                  storage
                    .getAllEvents({
                      ...(dateRange && {
                        startDate: dateRange.startDate,
                        endDate: dateRange.endDate,
                      }),
                      limit: eventLimit,
                      projectId: pid,
                    })
                    .catch(() => [])
                )
              ).then((results) => results.flat())
            : storage
                .getAllEvents({
                  ...(dateRange && {
                    startDate: dateRange.startDate,
                    endDate: dateRange.endDate,
                  }),
                  limit: eventLimit,
                })
                .catch(() => []);
        })(),
      ]);

      // Build comprehensive system prompt with analytics context for selected project
      let contextSections: string[] = [];

      // Project context - focus on selected project if provided
      if (selectedProject) {
        contextSections.push(`## Current Project
**${selectedProject.name}** (${selectedProject.environment})
- Project ID: ${selectedProject.id}
- Total Events: ${(selectedProject.total_events || 0).toLocaleString()}`);
      } else if (projects.length > 0) {
        contextSections.push(`## Projects (${projects.length})
${projects
  .map(
    (p) =>
      `- **${p.name}** (${p.environment}): ${(
        p.total_events || 0
      ).toLocaleString()} events`
  )
  .join("\n")}`);
      } else {
        contextSections.push("## Projects\nNo projects yet.");
      }

      // Overview stats (for selected project or all projects)
      const timeRangeText = dateRange ? ` (${rangeLabel})` : ` (all-time)`;
      const scopeText = selectedProject
        ? `for the "${selectedProject.name}" project`
        : `across ALL your projects (cumulative totals)`;

      contextSections.push(`## Overview Statistics${timeRangeText}
These statistics are ${scopeText}:
- Total Events: ${stats.overview?.total_events || 0}
- Unique Users: ${stats.overview?.unique_users || 0}
- Unique Sessions: ${stats.overview?.unique_sessions || 0}
- Unique Devices: ${stats.overview?.unique_devices || 0}`);

      // Top Events
      if (stats.topEvents && stats.topEvents.length > 0) {
        contextSections.push(`## Top Events (Top 15)
${stats.topEvents
  .slice(0, 15)
  .map(
    (e: any, i: number) =>
      `${i + 1}. **${e.event_name}**: ${e.count.toLocaleString()} occurrences`
  )
  .join("\n")}`);
      }

      // All Event Names
      if (eventNames && eventNames.length > 0) {
        contextSections.push(`## Available Events (${
          eventNames.length
        } unique events)
${eventNames.slice(0, 50).join(", ")}${eventNames.length > 50 ? "..." : ""}`);
      }

      // Funnels (for selected project)
      if (allFunnels && allFunnels.length > 0) {
        let funnelsText = `## Funnels (${allFunnels.length} total)\n`;
        allFunnels.forEach((funnel: any) => {
          funnelsText += `- **${funnel.name}**${
            funnel.pinned ? " (Pinned)" : ""
          }: ${funnel.steps.join(" → ")}\n`;
        });
        contextSections.push(funnelsText);
      } else {
        contextSections.push("## Funnels\nNo funnels created yet.");
      }

      // Flows Analytics (for selected project)
      if (allFlows && allFlows.length > 0) {
        let flowsText = `## User Flows Analytics\n`;
        // If single project selected, show data directly; otherwise aggregate
        const flowData =
          selectedProject && allFlows.length === 1
            ? allFlows[0]
            : allFlows.reduce((acc: any, curr: any) => {
                if (!acc) return curr;
                return {
                  flows: [...(acc.flows || []), ...(curr.flows || [])],
                  total_flows: (acc.total_flows || 0) + (curr.total_flows || 0),
                  total_starts:
                    (acc.total_starts || 0) + (curr.total_starts || 0),
                  total_completions:
                    (acc.total_completions || 0) +
                    (curr.total_completions || 0),
                  total_abandonments:
                    (acc.total_abandonments || 0) +
                    (curr.total_abandonments || 0),
                  overall_completion_rate:
                    acc.total_starts > 0
                      ? acc.total_completions / acc.total_starts
                      : 0,
                };
              }, null);

        if (flowData && flowData.flows) {
          flowsText += `- Total Flows: ${flowData.total_flows}\n`;
          flowsText += `- Total Starts: ${flowData.total_starts.toLocaleString()}\n`;
          flowsText += `- Total Completions: ${flowData.total_completions.toLocaleString()}\n`;
          flowsText += `- Total Abandonments: ${flowData.total_abandonments.toLocaleString()}\n`;
          flowsText += `- Overall Completion Rate: ${(
            (flowData.overall_completion_rate || 0) * 100
          ).toFixed(1)}%\n`;
          if (flowData.flows.length > 0) {
            flowsText += `\n**Top Flows:**\n`;
            flowData.flows.slice(0, 5).forEach((flow: any) => {
              flowsText += `- **${flow.flow_type}** (${flow.flow_id}): ${
                flow.total_starts
              } starts, ${(flow.completion_rate * 100).toFixed(
                1
              )}% completion rate\n`;
            });
          }
        }
        contextSections.push(flowsText);
      }

      // Segments (for selected project)
      if (allSegments && allSegments.length > 0) {
        let segmentsText = `## User Segments (${allSegments.length} total)\n`;
        allSegments.forEach((segment: any) => {
          segmentsText += `- **${segment.name}**: ${
            segment.user_count || 0
          } users`;
          if (segment.criteria) {
            const criteriaDesc = JSON.stringify(segment.criteria, null, 2);
            segmentsText += `\n  Criteria: ${criteriaDesc.substring(0, 200)}${
              criteriaDesc.length > 200 ? "..." : ""
            }`;
          }
          segmentsText += "\n";
        });
        contextSections.push(segmentsText);
      } else {
        contextSections.push("## User Segments\nNo segments created yet.");
      }

      // Extract country from locale string (e.g., "en-GB" -> "GB", "fr-FR" -> "FR")
      const getCountryFromLocale = (locale: string | null | undefined): string | null => {
        if (!locale) return null;
        const parts = String(locale).split(/[-_]/);
        if (parts.length >= 2) {
          const code = parts[1].toUpperCase();
          if (code.length === 2 && /^[A-Z]{2}$/.test(code)) return code;
        }
        return null;
      };

      // Extract location data from events using locale and timezone fields
      const usersByCountry: Record<string, Set<string>> = {};
      const eventsByCountry: Record<string, number> = {};
      const localeDistribution: Record<string, number> = {};
      const timezoneDistribution: Record<string, number> = {};

      if (recentEvents && recentEvents.length > 0) {
        // Debug: log a sample event to verify locale/timezone fields
        const sample = recentEvents[0];
        console.log("[AI] Sample event fields:", {
          locale: sample.locale,
          timezone: sample.timezone,
          contextType: typeof sample.context,
          contextLocale: typeof sample.context === "object" ? sample.context?.locale : "string-context",
        });

        recentEvents.forEach((event: any) => {
          // Parse context if needed (Supabase JSONB returns object, but handle string too)
          let ctx: any = {};
          if (typeof event.context === "string") {
            try { ctx = JSON.parse(event.context); } catch { ctx = {}; }
          } else if (event.context && typeof event.context === "object") {
            ctx = event.context;
          }

          // Get locale from top-level column OR context object
          const locale = event.locale || ctx.locale;
          const timezone = event.timezone || ctx.timezone;

          // Track locale distribution
          if (locale) {
            localeDistribution[locale] = (localeDistribution[locale] || 0) + 1;
          }
          // Track timezone distribution
          if (timezone) {
            timezoneDistribution[timezone] = (timezoneDistribution[timezone] || 0) + 1;
          }

          // Extract country from locale
          const country = getCountryFromLocale(locale);
          if (country) {
            const userId = event.user_id || event.anonymous_id;
            if (userId) {
              if (!usersByCountry[country]) {
                usersByCountry[country] = new Set();
              }
              usersByCountry[country].add(userId);
            }
            eventsByCountry[country] = (eventsByCountry[country] || 0) + 1;
          }
        });
      }

      // Add Users by Country section
      if (Object.keys(usersByCountry).length > 0) {
        const countryStats = Object.entries(usersByCountry)
          .map(([country, users]) => ({
            country,
            userCount: users.size,
            eventCount: eventsByCountry[country] || 0,
          }))
          .sort((a, b) => b.userCount - a.userCount)
          .slice(0, 20);

        let countryText = `## Users by Country (from locale data)\n`;
        countryStats.forEach((stat, index) => {
          countryText += `${index + 1}. **${stat.country}**: ${stat.userCount.toLocaleString()} unique users, ${stat.eventCount.toLocaleString()} events\n`;
        });

        // Add locale breakdown
        const topLocales = Object.entries(localeDistribution)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10);
        if (topLocales.length > 0) {
          countryText += `\n**Locale breakdown:** ${topLocales.map(([l, c]) => `${l} (${c})`).join(", ")}\n`;
        }

        // Add timezone breakdown
        const topTimezones = Object.entries(timezoneDistribution)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10);
        if (topTimezones.length > 0) {
          countryText += `**Timezone breakdown:** ${topTimezones.map(([t, c]) => `${t} (${c})`).join(", ")}\n`;
        }

        contextSections.push(countryText);
      } else if (recentEvents && recentEvents.length > 0) {
        // Fallback: show raw locale/timezone data even if country extraction failed
        const topLocales = Object.entries(localeDistribution)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10);
        const topTimezones = Object.entries(timezoneDistribution)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10);

        let locText = `## User Location Data\n`;
        locText += `${recentEvents.length} events analyzed.\n`;
        if (topLocales.length > 0) {
          locText += `**Locales:** ${topLocales.map(([l, c]) => `${l} (${c} events)`).join(", ")}\n`;
        }
        if (topTimezones.length > 0) {
          locText += `**Timezones:** ${topTimezones.map(([t, c]) => `${t} (${c} events)`).join(", ")}\n`;
        }
        if (topLocales.length === 0 && topTimezones.length === 0) {
          locText += `No locale or timezone data found in events.\n`;
        }
        contextSections.push(locText);
      }

      // Event Trends - Daily breakdown for last 7 days
      if (recentEvents && recentEvents.length > 0) {
        // Group events by date and event name
        const eventsByDate: Record<
          string,
          { total: number; byEvent: Record<string, number> }
        > = {};

        recentEvents.forEach((event: any) => {
          const eventDate = new Date(event.timestamp || event.created_at)
            .toISOString()
            .split("T")[0];
          if (!eventsByDate[eventDate]) {
            eventsByDate[eventDate] = { total: 0, byEvent: {} };
          }
          eventsByDate[eventDate].total += 1;
          const eventName = event.event_name || event.name || "unknown";
          eventsByDate[eventDate].byEvent[eventName] =
            (eventsByDate[eventDate].byEvent[eventName] || 0) + 1;
        });

        // Sort dates
        const sortedDates = Object.keys(eventsByDate).sort();

        if (sortedDates.length > 0) {
          let trendsText = `## Event Trends (${rangeLabel})\n\n`;
          trendsText += `**Daily Event Counts:**\n`;
          sortedDates.forEach((date) => {
            const dayData = eventsByDate[date];
            const dateObj = new Date(date);
            const dayName = dateObj.toLocaleDateString("en-US", {
              weekday: "short",
            });
            trendsText += `- **${date}** (${dayName}): ${dayData.total.toLocaleString()} total events\n`;

            // Show top 5 events for each day
            const topEventsForDay = Object.entries(dayData.byEvent)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5);
            if (topEventsForDay.length > 0) {
              trendsText += `  Top events: ${topEventsForDay
                .map(([name, count]) => `${name} (${count})`)
                .join(", ")}\n`;
            }
          });

          // Calculate trend summary
          if (sortedDates.length >= 2) {
            const firstDay = eventsByDate[sortedDates[0]].total;
            const lastDay =
              eventsByDate[sortedDates[sortedDates.length - 1]].total;
            const change = lastDay - firstDay;
            const changePercentValue =
              firstDay > 0 ? (change / firstDay) * 100 : 0;
            const changePercent = changePercentValue.toFixed(1);
            trendsText += `\n**Trend Summary:**\n`;
            trendsText += `- First day (${
              sortedDates[0]
            }): ${firstDay.toLocaleString()} events\n`;
            trendsText += `- Last day (${
              sortedDates[sortedDates.length - 1]
            }): ${lastDay.toLocaleString()} events\n`;
            trendsText += `- Change: ${
              change >= 0 ? "+" : ""
            }${change.toLocaleString()} events (${
              changePercentValue >= 0 ? "+" : ""
            }${changePercent}%)\n`;
          }

          contextSections.push(trendsText);
        }
      } else if (stats.eventsOverTime && stats.eventsOverTime.length > 0) {
        contextSections.push(`## Recent Event Trends
Showing activity over the last ${stats.eventsOverTime.length} time periods.`);
      }

      // Build system prompt with analytics context
      const projectScope = selectedProject
        ? `You are analyzing data specifically for the **"${selectedProject.name}"** project (${selectedProject.environment}). All numbers and insights refer to this project only. Never say "across all projects" — speak only about "${selectedProject.name}".`
        : `You are analyzing aggregate data across ALL of the user's projects. Always clarify that numbers are cumulative totals. You may reference individual projects when helpful.`;

      const systemPrompt = `You are Axyle AI — a sharp, senior-level analytics advisor embedded inside an analytics platform. You have deep expertise in product analytics, growth metrics, and user behavior. You speak with confidence, specificity, and clarity. You're not a generic chatbot — you're the user's personal data analyst.

${projectScope}

# Analytics Context
${contextSections.join("\n\n")}

# Response Guidelines

**Personality & Tone:**
- Be direct and confident. Lead with the insight, not a preamble.
- Sound like a smart colleague who just pulled up the data — not a customer support bot.
- Use natural language. Avoid phrases like "Based on the data provided" or "I can see that" — just state the insight.
- Be concise but thorough. Every sentence should add value.

**Data & Insights:**
- Always ground responses in the actual numbers above. Cite specific event names, counts, rates, and percentages.
- When you spot something interesting (anomaly, trend, drop-off), proactively call it out even if the user didn't ask.
- Compare and contextualize: "That's a 23% completion rate, which is below typical benchmarks of ~35% for onboarding flows."
- If data is missing or insufficient, be honest and suggest what to track.

**Formatting:**
- Use markdown effectively: **bold** key metrics, numbered lists for rankings.
- When showing trends, describe the direction clearly: "up 12% day-over-day" or "declining steadily since Monday."
- Keep paragraphs short (2-3 sentences max). Use line breaks generously.

**Charts & Visualizations:**
When your response involves numerical data that would be clearer as a visual (rankings, distributions, trends over time, funnel steps, comparisons), include a chart block. Use this exact format — a fenced code block with the language tag \`chart\`:

\`\`\`chart
{"type":"bar","title":"Top Events","data":[{"name":"screen_view","value":1234},{"name":"button_click","value":890}]}
\`\`\`

Chart types available:
- \`bar\` — for rankings, comparisons, distributions (e.g. top events, users by country). Use keys: \`name\` and \`value\`.
- \`line\` — for trends over time (e.g. daily event counts). Use keys: \`name\` (date/label) and \`value\`.
- \`pie\` — for proportional breakdowns (e.g. event share, device split). Use keys: \`name\` and \`value\`.
- \`funnel\` — for sequential drop-off (e.g. funnel steps, flow completion). Use keys: \`name\` and \`value\` in descending order.

Rules:
- The JSON must be valid and on a single line inside the code block.
- Always include a \`title\` field.
- Keep data arrays to 10 items max for readability. Aggregate smaller items into an "Other" entry if needed.
- Place the chart block inline in your response where it fits naturally — after introducing the data, before your analysis of it.
- You can include multiple chart blocks in one response if the user asks about different datasets.
- Still include a brief text summary of the key numbers — don't rely solely on the chart.

**Scope:**
- Reference funnels by name and their specific steps and conversion rates.
- Reference flows with completion rates and drop-off points.
- Reference segments with their criteria and user counts.
- Reference events by their exact names and occurrence counts.
- Location/geographic data is available via timezone and locale fields — use the country distribution data to answer geographic questions.

**Engagement:**
- End every response with a brief, genuinely useful follow-up question. Make it specific to their data, not generic. Good: "Your sign_up → first_purchase funnel has a 12% drop at step 2 — want me to dig into what's happening there?" Bad: "What else would you like to know?"
- If you notice something the user should investigate, mention it.`;

      // Build conversation messages
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: systemPrompt,
        },
      ];

      // Add conversation history if provided
      if (Array.isArray(conversationHistory)) {
        conversationHistory.forEach((msg: any) => {
          if (msg.role && msg.content) {
            messages.push({
              role: msg.role === "user" ? "user" : "assistant",
              content: msg.content,
            });
          }
        });
      }

      // Add current user message
      messages.push({
        role: "user",
        content: message.trim(),
      });

      // Call OpenAI API
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.5,
        max_tokens: 3000,
      });

      const aiResponse =
        completion.choices[0]?.message?.content ||
        "I apologize, but I couldn't generate a response. Please try again.";

      res.json({
        success: true,
        response: aiResponse,
      });
    } catch (error: any) {
      console.error("Error in AI chat:", error);

      // Handle OpenAI API errors
      if (error instanceof OpenAI.APIError) {
        return res.status(error.status || 500).json({
          success: false,
          error: error.message || "OpenAI API error",
        });
      }

      res.status(500).json({
        success: false,
        error: "Failed to process AI request",
      });
    }
  }
);

export default router;
