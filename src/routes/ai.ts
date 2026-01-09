/**
 * AI routes - OpenAI-powered analytics assistant
 */

import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { storage } from "../db";
import { requireSupabaseAuth } from "../middleware/supabaseAuth";

const router = Router();

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

      // For "All Projects" view, use all-time data (no date filter)
      // For specific project, use last 7 days for more focused analysis
      const dateRange = selectedProject
        ? (() => {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            return {
              startDate: startDate.toISOString().split("T")[0],
              endDate: endDate.toISOString().split("T")[0],
            };
          })()
        : undefined; // No date filter for all projects = all-time data

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
        // Fetch recent events for trend analysis
        projectIds && projectIds.length > 0
          ? Promise.all(
              projectIds.map((pid) =>
                storage
                  .getAllEvents({
                    ...(dateRange && {
                      startDate: dateRange.startDate,
                      endDate: dateRange.endDate,
                    }),
                    limit: 10000,
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
                limit: 10000,
              })
              .catch(() => []),
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
      const timeRangeText = dateRange ? ` (last 7 days)` : ` (all-time)`;
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

      // Helper function to extract country from timezone or locale
      const getCountryFromContext = (event: any): string | null => {
        const context = event.context || {};
        const timezone = context.timezone || event.timezone;
        const locale = context.locale || event.locale;

        // Try to extract country from timezone (e.g., "America/New_York" -> "US")
        if (timezone) {
          // Common timezone to country mappings
          const timezoneToCountry: Record<string, string> = {
            "America/New_York": "US",
            "America/Chicago": "US",
            "America/Denver": "US",
            "America/Los_Angeles": "US",
            "America/Phoenix": "US",
            "America/Anchorage": "US",
            "America/Honolulu": "US",
            "Europe/London": "UK",
            "Europe/Paris": "FR",
            "Europe/Berlin": "DE",
            "Europe/Rome": "IT",
            "Europe/Madrid": "ES",
            "Europe/Amsterdam": "NL",
            "Europe/Stockholm": "SE",
            "Europe/Copenhagen": "DK",
            "Europe/Oslo": "NO",
            "Europe/Helsinki": "FI",
            "Europe/Dublin": "IE",
            "Europe/Athens": "GR",
            "Europe/Lisbon": "PT",
            "Europe/Vienna": "AT",
            "Europe/Brussels": "BE",
            "Europe/Warsaw": "PL",
            "Europe/Prague": "CZ",
            "Europe/Budapest": "HU",
            "Europe/Bucharest": "RO",
            "Asia/Tokyo": "JP",
            "Asia/Shanghai": "CN",
            "Asia/Hong_Kong": "HK",
            "Asia/Singapore": "SG",
            "Asia/Seoul": "KR",
            "Asia/Dubai": "AE",
            "Asia/Mumbai": "IN",
            "Asia/Bangkok": "TH",
            "Asia/Jakarta": "ID",
            "Asia/Manila": "PH",
            "Australia/Sydney": "AU",
            "Australia/Melbourne": "AU",
            "Australia/Brisbane": "AU",
            "Pacific/Auckland": "NZ",
            "America/Toronto": "CA",
            "America/Vancouver": "CA",
            "America/Mexico_City": "MX",
            "America/Sao_Paulo": "BR",
            "America/Buenos_Aires": "AR",
            "Africa/Cairo": "EG",
            "Africa/Johannesburg": "ZA",
          };

          if (timezoneToCountry[timezone]) {
            return timezoneToCountry[timezone];
          }

          // Try to infer from timezone string pattern
          if (timezone.includes("America")) return "US";
          if (timezone.includes("Europe")) return "EU";
          if (timezone.includes("Asia")) return "ASIA";
          if (timezone.includes("Australia") || timezone.includes("Pacific"))
            return "AU";
        }

        // Try to extract country from locale (e.g., "en-US" -> "US", "fr-FR" -> "FR")
        if (locale) {
          const localeParts = String(locale).split(/[-_]/);
          if (localeParts.length >= 2) {
            const countryCode = localeParts[1].toUpperCase();
            // Validate it's a 2-letter country code
            if (countryCode.length === 2 && /^[A-Z]{2}$/.test(countryCode)) {
              return countryCode;
            }
          }
        }

        return null;
      };

      // Extract users by country from events
      const usersByCountry: Record<string, Set<string>> = {};
      const eventsByCountry: Record<string, number> = {};

      if (recentEvents && recentEvents.length > 0) {
        recentEvents.forEach((event: any) => {
          const country = getCountryFromContext(event);
          if (country) {
            // Track unique users by country
            const userId = event.user_id || event.anonymous_id;
            if (userId) {
              if (!usersByCountry[country]) {
                usersByCountry[country] = new Set();
              }
              usersByCountry[country].add(userId);
            }
            // Track event counts by country
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
          .slice(0, 20); // Top 20 countries

        let countryText = `## Users by Country\n`;
        countryText += `Location data is extracted from event context (timezone and locale fields). Here are the top countries:\n\n`;
        countryStats.forEach((stat, index) => {
          countryText += `${index + 1}. **${
            stat.country
          }**: ${stat.userCount.toLocaleString()} unique users, ${stat.eventCount.toLocaleString()} events\n`;
        });
        countryText += `\n**Important**: All events in the dataset include location metadata in their context object. Each event has a \`context\` field containing \`timezone\` and \`locale\` properties that can be used to determine the user's country. You can answer questions about user distribution by country, geographic trends, location-based analytics, and country-specific metrics. When asked about countries, locations, or geographic data, use this country distribution information to provide detailed, data-driven answers.`;
        contextSections.push(countryText);
      } else if (recentEvents && recentEvents.length > 0) {
        // Even if we couldn't extract countries, mention that location data exists
        contextSections.push(
          `## Location Data Availability\nAll events include location metadata in their context (timezone and locale fields). While country extraction may not be available for all events, the raw location data is present in each event's context object and can be analyzed for geographic insights.`
        );
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
          let trendsText = `## Event Trends (Last 7 Days)\n\n`;
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
      const projectContext = selectedProject
        ? `You are analyzing data for the project "${selectedProject.name}" (${selectedProject.environment}). **CRITICAL**: Focus ALL your responses exclusively on this specific project only. When mentioning metrics, events, users, or any data, always specify that it's for the "${selectedProject.name}" project. Do NOT mention or reference other projects unless explicitly asked. Do NOT use cumulative language like "across all projects" - speak only about this project.`
        : `You are analyzing data across ALL projects cumulatively. **CRITICAL**: When mentioning metrics, events, users, or any data, always clarify that these are cumulative totals across all projects. Use language like "across all your projects", "total across all projects", or "combined from all projects". You can reference individual projects when relevant, but default to cumulative/aggregate language.`;

      const projectSpecificGuidance = selectedProject
        ? `**IMPORTANT**: Always speak about the "${selectedProject.name}" project specifically. Use phrases like "in this project", "for ${selectedProject.name}", or "in the ${selectedProject.name} project". Never use cumulative language unless explicitly asked about other projects.`
        : `**IMPORTANT**: Always speak about cumulative/aggregate data across all projects. Use phrases like "across all your projects", "total across all projects", "combined from all projects", or "aggregate across all projects". When mentioning specific numbers, clarify they are totals across all projects.`;

      const systemPrompt = `You are an AI analytics assistant helping users understand their app analytics data. ${projectContext}

${contextSections.join("\n\n")}

Your role:
- Answer questions about analytics data clearly and concisely
- Provide insights based on the actual data provided above
- ${projectSpecificGuidance}
- Reference specific funnels, flows, segments, and events by name when relevant
- Suggest best practices for analytics tracking
- Help users understand their user behavior patterns
- Be helpful, friendly, and professional
- If data is missing or insufficient, explain what's needed and how to get it
- Format responses with markdown for better readability (use **bold** for emphasis, bullet points with •, numbered lists)
- When discussing funnels, mention the specific steps and conversion rates
- When discussing flows, reference completion rates and drop-off points
- When discussing segments, mention the criteria and user counts
- When discussing events, reference specific event names and their occurrence counts
- **IMPORTANT: Location Data Availability**: All events include location metadata in their context (timezone and locale fields). You can answer questions about:
  - User distribution by country
  - Geographic trends and patterns
  - Country-specific analytics (e.g., "users by country", "events from US", "conversion by country")
  - Location-based user behavior
  Use the "Users by Country" section above to provide specific country-level insights. If a user asks about countries, locations, or geographic data, analyze the country distribution data provided and give detailed, data-driven answers.
- **CRITICAL: Always end every response with a follow-up question.** After providing your answer, ask a related or unrelated question that could help the user discover more insights or explore other aspects of their analytics. The follow-up question should be engaging and encourage further conversation. Examples: "Would you like me to analyze which events correlate with user retention?" or "Have you considered tracking conversion funnels for your top events?" or "What other metrics would you like to explore?"

Keep responses focused and actionable. Use the data provided to give specific, data-driven answers. Always conclude with a thoughtful follow-up question to keep the conversation going.`;

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
        model: "gpt-4o-mini", // Using cost-effective model, can be changed to gpt-4 if needed
        messages,
        temperature: 0.7,
        max_tokens: 2000, // Increased to allow more detailed responses with comprehensive context
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
