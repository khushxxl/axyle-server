/**
 * MCP (Model Context Protocol) server route
 * Allows users to connect Claude Desktop / Claude Code / Cursor to their Axyle analytics
 * via: npx mcp-remote https://api.axyle.app/api/mcp --header "X-API-Key:<api_key>"
 */

import { Router, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { storage } from "../db";

const router = Router();

// Pre-define param shapes to avoid TS2589 deep type instantiation
const dateRangeParams = {
  startDate: z.string().optional().describe("Start date (ISO 8601, e.g. 2024-01-01)"),
  endDate: z.string().optional().describe("End date (ISO 8601, e.g. 2024-01-31)"),
} as const;

const getEventsParams = {
  eventName: z.string().optional().describe("Filter by event name"),
  startDate: z.string().optional().describe("Start date (ISO 8601)"),
  endDate: z.string().optional().describe("End date (ISO 8601)"),
  limit: z.number().optional().describe("Max number of events to return (default 50)"),
} as const;

const funnelIdParams = {
  funnelId: z.string().describe("The funnel ID"),
} as const;

/**
 * Validate API key from X-API-Key header and return projectId
 */
async function resolveProjectId(req: Request): Promise<string | null> {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) return null;

  try {
    const apiKeyData = await storage.getApiKey(apiKey);
    if (!apiKeyData) return null;

    await storage.updateApiKeyLastUsed(apiKeyData.id);
    return apiKeyData.project_id;
  } catch {
    return null;
  }
}

/**
 * Create an MCP server instance with all tools scoped to a project
 */
function createMcpServer(projectId: string): McpServer {
  const server = new McpServer({
    name: "axyle",
    version: "1.0.0",
  });

  // --- Project ---

  server.tool(
    "get_project",
    "Get project details including name, total events, last activity, platform, and environment",
    {},
    async () => {
      const project = await storage.getProject(projectId);
      if (!project) {
        return { content: [{ type: "text" as const, text: "Project not found." }] };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: project.id,
                name: project.name,
                platform: project.platform,
                environment: project.environment,
                total_events: project.total_events,
                last_event_at: project.last_event_at,
                created_at: project.created_at,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- Analytics ---

  server.tool(
    "get_event_stats",
    "Get analytics overview: total events, unique users, sessions, devices, top events, and events over time for a date range",
    dateRangeParams,
    // @ts-ignore MCP SDK deep type instantiation with optional zod params
    async ({ startDate, endDate }: { startDate?: string; endDate?: string }) => {
      const filters: { startDate?: string; endDate?: string } = {};
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const stats = await storage.getEventStats(projectId, filters);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
      };
    },
  );

  server.tool(
    "get_events",
    "Get recent events, optionally filtered by event name and date range",
    getEventsParams,
    async ({ eventName, startDate, endDate, limit }: { eventName?: string; startDate?: string; endDate?: string; limit?: number }) => {
      const events = await storage.getEvents(projectId, {
        eventName,
        startDate,
        endDate,
        limit: limit ?? 50,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: events.length, events }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "get_event_names",
    "List all unique event names tracked in this project",
    {},
    async () => {
      const names = await storage.getEventNames(undefined, projectId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ event_names: names }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "get_top_events",
    "Get events aggregated by name with counts, sorted by frequency",
    dateRangeParams,
    // @ts-ignore MCP SDK deep type instantiation with optional zod params
    async ({ startDate, endDate }: { startDate?: string; endDate?: string }) => {
      const filters: { startDate?: string; endDate?: string } = {};
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const stats = await storage.getEventStats(projectId, filters);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ top_events: stats.topEvents ?? [] }, null, 2),
          },
        ],
      };
    },
  );

  // --- Funnels ---

  server.tool(
    "list_funnels",
    "List all funnels configured for this project",
    {},
    async () => {
      const funnels = await storage.listFunnels(projectId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: funnels.length,
                funnels: funnels.map((f: any) => ({
                  id: f.id,
                  name: f.name,
                  steps: f.steps,
                  chart_type: f.chart_type,
                  pinned: f.pinned,
                  created_at: f.created_at,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "get_funnel",
    "Get a specific funnel with its steps and configuration",
    funnelIdParams,
    // @ts-ignore MCP SDK deep type instantiation with optional zod params
    async ({ funnelId }: { funnelId: string }) => {
      const funnel = await storage.getFunnel(funnelId);
      if (!funnel) {
        return { content: [{ type: "text" as const, text: "Funnel not found." }] };
      }
      if (funnel.project_id !== projectId) {
        return {
          content: [
            { type: "text" as const, text: "Funnel does not belong to this project." },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(funnel, null, 2) }],
      };
    },
  );

  return server;
}

/**
 * POST /api/mcp - Handle MCP JSON-RPC requests
 */
router.post("/", async (req: Request, res: Response) => {
  const projectId = await resolveProjectId(req);
  if (!projectId) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Invalid or missing API key" },
      id: null,
    });
    return;
  }

  try {
    const server = createMcpServer(projectId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

/**
 * GET /api/mcp - Required by MCP spec for SSE transport (not used in stateless mode)
 */
router.get("/", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST for stateless MCP requests.",
    },
    id: null,
  });
});

/**
 * DELETE /api/mcp - Required by MCP spec for session cleanup (not used in stateless mode)
 */
router.delete("/", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This server runs in stateless mode.",
    },
    id: null,
  });
});

export default router;
