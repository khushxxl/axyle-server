/**
 * Main Express server
 */

import express from "express";
import cors from "cors";
import { config } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { validateSupabaseAuth } from "./middleware/supabaseAuth";
import eventsRouter from "./routes/events";
import configRouter from "./routes/config";
import analyticsRouter from "./routes/analytics";
import advancedAnalyticsRouter from "./routes/advanced-analytics";
import projectsRouter from "./routes/projects";
import dashboardRouter from "./routes/dashboard";
import segmentsRouter from "./routes/segments";
import funnelsRouter from "./routes/funnels";
import usersRouter from "./routes/users";
import aiRouter from "./routes/ai";

const app = express();

// Middleware
app.use(
  cors({
    origin: config.server.corsOrigin,
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Supabase authentication middleware (optional - extracts user if token provided)
app.use(validateSupabaseAuth);

// Request logging
app.use(
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  },
);

// Health check
app.get("/health", (req: express.Request, res: express.Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Routes
app.use("/api/events", eventsRouter);
app.use("/api/v1/apps", configRouter);
app.use("/api/v1/projects", projectsRouter); // Project management (create, list, API keys)
app.use("/api/v1/projects", analyticsRouter); // Analytics queries (must come after projectsRouter)
app.use("/api/v1/projects", advancedAnalyticsRouter); // Advanced analytics (flows, screen time, features, scroll)
app.use("/api/v1/dashboard", dashboardRouter); // Dashboard queries (no API key required)
app.use("/api/v1/segments", segmentsRouter); // User segments
app.use("/api/v1/funnels", funnelsRouter); // Funnels
app.use("/api/v1/users", usersRouter); // Platform users and onboarding
app.use("/api/v1/ai", aiRouter); // AI assistant

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = Number(process.env.PORT) || 8000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  process.exit(0);
});
