import { Worker } from "bullmq";
import SegmentGrouper from "../src/services/SegmentGrouper.js";
import EventService from "../src/services/EventService.js";
import Transcript from "../src/models/Transcript.js";
import { analysisQueue } from "../src/queues/analysisQueue.js";
import connectDB from "../src/config/db.js";

// Connect to MongoDB
connectDB();

console.log("📊 Segment Grouper Worker Started");

const worker = new Worker(
  "segment-grouper",
  async (job) => {
    try {
      const { mediaId, segments, windowId } = job.data;

      // Check if this is a window-based grouping
      const isWindowJob = !!windowId;

      if (isWindowJob) {
        console.log(`🪟 [Window Grouper] Processing: ${windowId}`);
      } else {
        console.log(`📊 [Full Grouper] Processing full transcript: ${mediaId}`);
      }

      const groups = SegmentGrouper.groupSegments(segments);

      console.log(`  → Grouped into ${groups.length} segments`);

      // ── Segment filter ────────────────────────────────────────────────────────
      // Skip low-information groups before paying for an LLM call.
      // Segments shorter than 120 chars are typically noise, filler phrases,
      // or single-sentence transitions that produce zero useful intelligence.
      const MIN_CHARS = 120;
      const validGroups = groups.filter(g => g.text.trim().length >= MIN_CHARS);

      if (validGroups.length < groups.length) {
        console.log(
          `  🔍 Filtered ${groups.length - validGroups.length} low-info segments (< ${MIN_CHARS} chars)`
        );
      }

      console.log(`  ✓ ${validGroups.length}/${groups.length} segments queued for AI analysis`);

      if (!isWindowJob) {
        // For full transcript: update MongoDB with ALL grouped segments
        await Transcript.findOneAndUpdate(
          { mediaId },
          {
            segments: groups,
            status: 'grouped',
            updatedAt: new Date()
          },
          { new: true }
        );

        console.log(`  Saved grouped transcript to database for ${mediaId}`);

        await EventService.emit("GROUPED_SEGMENTS_READY", {
          mediaId,
          groups
        });
      } else {
        // For window: emit window-specific event
        await EventService.emit("WINDOW_GROUPED_READY", {
          mediaId,
          windowId,
          groups
        });
      }

      if (validGroups.length === 0) {
        console.warn(`⚠️  All segments filtered — no AI analysis needed`);
        return { groupCount: 0, validCount: 0 };
      }

      // Enqueue all valid segments in PARALLEL for AI analysis.
      // Promise.all fires all queue.add() calls simultaneously so grouper
      // never stalls waiting for Redis round-trips one-by-one.
      console.log(`  → Enqueueing ${validGroups.length} segments for AI analysis (parallel)`);

      await Promise.all(
        validGroups.map((group, i) => {
          // Generate segment ID based on context
          // Window: already has segmentId from earlier (e.g., "window-0-3-0")
          // Full: needs numeric ID
          const segmentId = group.segmentId ?? i;

          return analysisQueue.add(
            "analyze-segment",
            {
              mediaId,
              windowId, // pass through if present
              segmentId,
              text: group.text,
              totalSegments: validGroups.length
            },
            {
              jobId: isWindowJob
                ? `analysis-${segmentId}`
                : `analysis-${mediaId}-${i}`
            }
          );
        })
      );

      return {
        mediaId,
        windowId,
        groupCount: groups.length,
        validCount: validGroups.length
      };

    } catch (err) {
      console.error("❌ Error in segment grouper:", err);
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
  console.log(`✅ Grouper job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Grouper job ${job?.id} failed:`, err.message);
});