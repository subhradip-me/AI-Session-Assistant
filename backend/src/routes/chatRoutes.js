import express from "express";
import { QueueEvents } from "bullmq";
import { chatQueue } from "../queues/chatQueue.js";
import Session from "../models/Session.js";
import SessionReport from "../models/SessionReport.js";
import redis from "../config/redis.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// QueueEvents is required by BullMQ for job.waitUntilFinished()
const chatQueueEvents = new QueueEvents("chat-query", { connection: redis });

/**
 * POST /api/chat
 * Protected — requires: Authorization: Bearer <token>
 * Body: { mediaId, question }
 *
 * Enqueues a chat-query job, passes userId from JWT so the chatWorker
 * can scope its Qdrant retrieval to this user's vectors only.
 */
router.post("/chat", authenticate, async (req, res) => {
  try {
    const { mediaId, question } = req.body;
    const userId = req.user.userId;

    if (!mediaId || !question) {
      return res.status(400).json({ error: "mediaId and question are required" });
    }

    const job = await chatQueue.add(
      "chat",
      { mediaId, userId, question },   // userId propagated to chatWorker
      { removeOnComplete: true, removeOnFail: false }
    );

    // Wait for the worker to process and return the answer (30s timeout)
    const result = await job.waitUntilFinished(chatQueueEvents, 30_000);

    res.json(result);
  } catch (err) {
    console.error("❌ Chat route error:", err.message);
    res.status(500).json({ error: "Failed to process chat query", details: err.message });
  }
});

/**
 * GET /api/report/:mediaId
 * Protected — requires: Authorization: Bearer <token>
 *
 * Fetches the session report. Queries by BOTH mediaId AND userId to
 * guarantee that users can only access their own session reports.
 */
router.get("/report/:mediaId", authenticate, async (req, res) => {
  try {
    const { mediaId } = req.params;
    const userId = req.user.userId;

    // 🔒 NEVER query by mediaId alone — always include userId
    const report = await SessionReport.findOne({ mediaId, userId });

    if (!report) {
      return res.status(404).json({
        error: "Report not found. The session may still be processing, or you don't have access."
      });
    }

    res.json({
      mediaId:    report.mediaId,
      content:    report.content,
      createdAt:  report.createdAt,
      updatedAt:  report.updatedAt,
      suggestedQuestions: [
        "What were the key decisions made in this session?",
        "What should I do next based on this session?",
        "What topics were discussed?",
        "Give me a brief summary of the session.",
        "What action items were identified?"
      ]
    });
  } catch (err) {
    console.error("❌ Report route error:", err.message);
    res.status(500).json({ error: "Failed to fetch report", details: err.message });
  }
});

/**
 * GET /api/sessions
 * Protected — requires: Authorization: Bearer <token>
 *
 * Returns a list of all sessions belonging to the user,
 * sorted by most recent first.
 */
router.get("/sessions", authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessions = await Session.find({ userId }).sort({ createdAt: -1 });
    res.json(sessions);
  } catch (err) {
    console.error("❌ Sessions list error:", err.message);
    res.status(500).json({ error: "Failed to fetch sessions", details: err.message });
  }
});

export default router;
