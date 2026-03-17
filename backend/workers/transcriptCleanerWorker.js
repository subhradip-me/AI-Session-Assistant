import { Worker } from "bullmq";
import TranscriptCleaner from "../src/services/TranscriptCleaner.js";
import EventService from "../src/services/EventService.js";
import grouperQueue from "../src/queues/grouperQueue.js";

console.log("🧹 Transcript Cleaner Worker Started");

const worker = new Worker(
  "transcript-cleaner",
  async (job) => {
    try {
      const { mediaId, segments, windowId } = job.data;

      // Check if this is a window-based cleaning (from windowDiarizationWorker)
      const isWindowJob = !!windowId;

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
          windowId, // pass through if present
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
    connection: {
      host: "127.0.0.1",
      port: 6379
    }
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Cleaner job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Cleaner job ${job?.id} failed:`, err.message);
});