/**
 * Server-Sent Events (SSE) route for real-time notifications
 * Streams payment events and other notifications to connected dashboard clients.
 */

import { Router, Request, Response } from "express";
import broadcaster from "../services/eventBroadcaster";

const router = Router();

/**
 * GET /api/v1/projects/:projectId/events/stream
 * SSE endpoint — streams real-time events for a project
 */
router.get("/:projectId/events/stream", (req: Request, res: Response) => {
  const { projectId } = req.params;

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  // Keep-alive every 30s
  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30000);

  // Listen for payment events for this project
  const onPayment = (data: any) => {
    res.write(`event: payment\ndata: ${JSON.stringify(data)}\n\n`);
  };

  broadcaster.on(`payment:${projectId}`, onPayment);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(keepAlive);
    broadcaster.off(`payment:${projectId}`, onPayment);
  });
});

export default router;
