import express from "express";
import { QueueEvents } from "bullmq";
import { chatQueue } from "../queues/chatQueue.js";
import SessionReport from "../models/SessionReport.js";
import redis from "../config/redis.js";

const router = express.Router();

// QueueEvents is required by BullMQ for job.waitUntilFinished()
const chatQueueEvents = new QueueEvents("chat-query", { connection: redis });

/**
 * POST /api/chat
 * Body: { mediaId: string, question: string }
 *
 * Enqueues a chat-query job and waits for the worker to return an answer.
 * The worker fetches the SessionReport as context and answers via AIAnalysisService.
 */
router.post("/chat", async (req, res) => {
  try {
    const { mediaId, question } = req.body;

    if (!mediaId || !question) {
      return res.status(400).json({ error: "mediaId and question are required" });
    }

    const job = await chatQueue.add(
      "chat",
      { mediaId, question },
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
 *
 * Returns the generated session report for a given mediaId,
 * along with suggested starter questions for the chat interface.
 */
router.get("/report/:mediaId", async (req, res) => {
  try {
    const { mediaId } = req.params;

    const report = await SessionReport.findOne({ mediaId });

    if (!report) {
      return res.status(404).json({
        error: "Report not found. The session may still be processing."
      });
    }

    res.json({
      mediaId: report.mediaId,
      content: report.content,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
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

export default router;
