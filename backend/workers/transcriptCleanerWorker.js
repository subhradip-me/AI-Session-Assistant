import { Worker } from "bullmq";
import redis from "../src/config/redis.js";
import TranscriptCleaner from "../src/services/TranscriptCleaner.js";
import EventService from "../src/services/EventService.js";
import grouperQueue from "../src/queues/grouperQueue.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

connectDB();
console.log("🧹 Transcript Cleaner Worker Started");

const worker = new Worker(
  "transcript-cleaner",
  async (job) => {
    try {
      const { mediaId, segments, windowId, userId } = job.data;
      const isWindowJob = !!windowId;

      if (!isWindowJob) {
        // Only update state for full-path cleaning (not window path)
        await updatePipelineState(mediaId, { "steps.grouping.status": "running" });
        await publishPipelineEvent(mediaId, "grouping", "running");
      }

      if (isWindowJob) {
        console.log(`🪟 [Window Cleaner] Processing: ${windowId}`);
      } else {
        console.log(`🧹 [Full Cleaner] Processing full transcript: ${mediaId}`);
      }

      const cleanedSegments = TranscriptCleaner.cleanSegments(segments);

      console.log(
        `  → Cleaned ${cleanedSegments.length} segments (from ${segments.length})`
      );

      if (isWindowJob) {
        // Window-based: emit window-specific event
        await EventService.emit("WINDOW_CLEAN_READY", {
          mediaId,
          windowId,
          segments: cleanedSegments
        });
      } else {
        // Full transcript: emit full-transcript event
        await EventService.emit("CLEAN_TRANSCRIPT_READY", {
          mediaId,
          segments: cleanedSegments
        });
      }

      // Enqueue grouping job (both paths use same grouper)
      await grouperQueue.add(
        "group",
        {
          mediaId,
          userId,
          windowId,
          segments: cleanedSegments
        },
        {
          jobId: isWindowJob ? `group-${windowId}` : `group-${mediaId}`
        }
      );

      return {
        mediaId,
        windowId,
        cleanedSegmentCount: cleanedSegments.length
      };

    } catch (err) {
      console.error("❌ Error in transcript cleaner:", err);
      throw err;
    }
  },
  {
    connection: redis,
    lockDuration:    90_000,   // 90s — cleaning is fast, fail if stuck
    maxStalledCount: 2
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Cleaner job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Cleaner job ${job?.id} failed:`, err.message);
  const { mediaId, windowId } = job?.data || {};
  if (mediaId && !windowId) {
    await markSessionFailed(mediaId, "grouping", job.id, err);
  }
});