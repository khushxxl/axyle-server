/**
 * Segments routes - manage user segments
 */

import { Router, Request, Response } from "express";
import { storage } from "../db";
import { randomUUID } from "crypto";

const router = Router();

/**
 * POST /api/v1/segments
 * Create a new segment
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      projectId,
      name,
      description,
      segmentType = "dynamic",
      criteria = { conditions: [], logic: "AND" },
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Segment name is required",
      });
    }

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: "Project ID is required",
      });
    }

    // Create segment
    const segment = await storage.createSegment({
      project_id: projectId,
      name,
      description,
      segment_type: segmentType,
      criteria,
    });

    // Calculate initial segment size
    const size = await storage.calculateSegmentSize(segment.id, criteria);
    await storage.updateSegmentSize(segment.id, size);

    res.status(201).json({
      success: true,
      segment: {
        ...segment,
        cached_size: size,
      },
    });
  } catch (error) {
    console.error("Error creating segment:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/v1/segments
 * List all segments (optionally filtered by project)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;

    const segments = await storage.listSegments(
      projectId as string | undefined
    );

    res.json({
      success: true,
      segments,
    });
  } catch (error) {
    console.error("Error listing segments:", error);
    res.status(500).json({
      success: false,
      error: "Failed to list segments",
    });
  }
});

/**
 * GET /api/v1/segments/:segmentId
 * Get a specific segment
 */
router.get("/:segmentId", async (req: Request, res: Response) => {
  try {
    const { segmentId } = req.params;

    const segment = await storage.getSegment(segmentId);

    if (!segment) {
      return res.status(404).json({
        success: false,
        error: "Segment not found",
      });
    }

    res.json({
      success: true,
      segment,
    });
  } catch (error) {
    console.error("Error getting segment:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * PUT /api/v1/segments/:segmentId
 * Update a segment
 */
router.put("/:segmentId", async (req: Request, res: Response) => {
  try {
    const { segmentId } = req.params;
    const { name, description, criteria, segmentType } = req.body;

    const segment = await storage.getSegment(segmentId);

    if (!segment) {
      return res.status(404).json({
        success: false,
        error: "Segment not found",
      });
    }

    const updatedSegment = await storage.updateSegment(segmentId, {
      name,
      description,
      criteria,
      segment_type: segmentType,
    });

    // Recalculate segment size if criteria changed
    if (criteria) {
      const size = await storage.calculateSegmentSize(segmentId, criteria);
      await storage.updateSegmentSize(segmentId, size);
      updatedSegment.cached_size = size;
    }

    res.json({
      success: true,
      segment: updatedSegment,
    });
  } catch (error) {
    console.error("Error updating segment:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * DELETE /api/v1/segments/:segmentId
 * Delete a segment
 */
router.delete("/:segmentId", async (req: Request, res: Response) => {
  try {
    const { segmentId } = req.params;

    const segment = await storage.getSegment(segmentId);

    if (!segment) {
      return res.status(404).json({
        success: false,
        error: "Segment not found",
      });
    }

    await storage.deleteSegment(segmentId);

    res.json({
      success: true,
      message: "Segment deleted",
    });
  } catch (error) {
    console.error("Error deleting segment:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/v1/segments/:segmentId/users
 * Get users in a segment
 */
router.get("/:segmentId/users", async (req: Request, res: Response) => {
  try {
    const { segmentId } = req.params;
    const { limit = "100", offset = "0" } = req.query;

    const segment = await storage.getSegment(segmentId);

    if (!segment) {
      return res.status(404).json({
        success: false,
        error: "Segment not found",
      });
    }

    const users = await storage.getSegmentUsers(segmentId, {
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    res.json({
      success: true,
      users,
      segment: {
        id: segment.id,
        name: segment.name,
        cached_size: segment.cached_size,
      },
    });
  } catch (error) {
    console.error("Error getting segment users:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get segment users",
    });
  }
});

/**
 * POST /api/v1/segments/:segmentId/calculate
 * Recalculate segment size and membership
 */
router.post("/:segmentId/calculate", async (req: Request, res: Response) => {
  try {
    const { segmentId } = req.params;

    const segment = await storage.getSegment(segmentId);

    if (!segment) {
      return res.status(404).json({
        success: false,
        error: "Segment not found",
      });
    }

    const size = await storage.calculateSegmentSize(
      segmentId,
      segment.criteria
    );
    await storage.updateSegmentSize(segmentId, size);

    res.json({
      success: true,
      segment: {
        ...segment,
        cached_size: size,
        last_calculated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error calculating segment:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate segment",
    });
  }
});

/**
 * POST /api/v1/segments/preview
 * Preview segment size without saving
 */
router.post("/preview", async (req: Request, res: Response) => {
  try {
    const { projectId, criteria } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: "Project ID is required",
      });
    }

    const size = await storage.previewSegmentSize(projectId, criteria);

    res.json({
      success: true,
      previewSize: size,
    });
  } catch (error) {
    console.error("Error previewing segment:", error);
    res.status(500).json({
      success: false,
      error: "Failed to preview segment",
    });
  }
});

/**
 * GET /api/v1/segments/:segmentId/export
 * Export segment users as JSON
 */
router.get("/:segmentId/export", async (req: Request, res: Response) => {
  try {
    const { segmentId } = req.params;

    const segment = await storage.getSegment(segmentId);

    if (!segment) {
      return res.status(404).json({
        success: false,
        error: "Segment not found",
      });
    }

    const users = await storage.getSegmentUsers(segmentId, { limit: 10000 });

    res.json({
      success: true,
      segment: {
        id: segment.id,
        name: segment.name,
        criteria: segment.criteria,
      },
      users,
      exportedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error exporting segment:", error);
    res.status(500).json({
      success: false,
      error: "Failed to export segment",
    });
  }
});

export default router;
