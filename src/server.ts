/**
 * Main Express server
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { validateSupabaseAuth } from "./middleware/supabaseAuth";
import { enforceHttps } from "./middleware/security";
import { generalRateLimiter } from "./middleware/rateLimiting";
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
import webhooksRouter from "./routes/webhooks";
import teamMembersRouter from "./routes/team-members";
import revenuecatRouter from "./routes/revenuecat";
import inviteRouter from "./routes/invite";
import emailsRouter from "./routes/emails";

const app = express();

// Security middleware (must be first)
app.use(enforceHttps);

// Helmet security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
    frameguard: {
      action: "deny",
    },
  })
);

// Additional security headers for sensitive endpoints
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Prevent caching of sensitive responses
  if (req.path.includes("/api-keys") || req.path.includes("/revenuecat")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// CORS middleware
app.use(
  cors({
    origin: config.server.corsOrigin,
    credentials: true,
  }),
);

// Body parsing middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting middleware (apply before routes)
app.use(generalRateLimiter);

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
app.use("/api/v1/webhooks", webhooksRouter); // Webhooks (new user, etc.)
app.use("/api/v1/projects", teamMembersRouter); // Team members
app.use("/api/v1/projects", revenuecatRouter); // RevenueCat integration
app.use("/api/v1/invite", inviteRouter); // Project invite accept
app.use("/api/v1/emails", emailsRouter);

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
