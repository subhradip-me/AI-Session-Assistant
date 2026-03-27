import { Worker } from "bullmq";
import redis from "../src/config/redis.js";
import SegmentGrouper from "../src/services/SegmentGrouper.js";
import EventService from "../src/services/EventService.js";
import Transcript from "../src/models/Transcript.js";
import { analysisQueue } from "../src/queues/analysisQueue.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

// Connect to MongoDB
connectDB();

console.log("📊 Segment Grouper Worker Started");

const worker = new Worker(
  "segment-grouper",
  async (job) => {
    try {
      const { mediaId, segments, windowId, userId } = job.data;

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
        // upsert:true ensures the Transcript doc is created even if Path B's
        // speakerDiarizationWorker never ran (e.g. Path A-only sessions).
        await Transcript.findOneAndUpdate(
          { mediaId },
          {
            segments: groups,
            status: 'grouped',
            updatedAt: new Date()
          },
          { new: true, upsert: true }
        );

        console.log(`  Saved grouped transcript to database for ${mediaId}`);

        await EventService.emit("GROUPED_SEGMENTS_READY", {
          mediaId,
          groups
        });
      } else {
        // For window: emit window-specific event
        await EventService.emit("WINDOW_GROUPED_READY", { mediaId, windowId, groups });
      }

      if (!isWindowJob) {
        await updatePipelineState(mediaId, {
          "steps.grouping.status":  "completed",
          "steps.analysis.status": "running",
          "steps.analysis.totalSegments": validGroups.length
        });
        await publishPipelineEvent(mediaId, "grouping", "completed", { totalSegments: validGroups.length });
      }

      if (validGroups.length === 0) {
        console.warn(`⚠️  All segments filtered — no AI analysis needed`);
        return { groupCount: 0, validCount: 0 };
      }

      // Build the segment list to send as a SINGLE batch job.
      // analysisWorker will process each segment sequentially inside the job,
      // waiting for all llmWorker completions before the batch job is marked done.
      // This ensures window-2 never starts dispatching to llmWorker until
      // window-1's batch job has fully completed.
      const batchSegments = validGroups.map((group, i) => ({
        segmentId: group.segmentId ?? i,
        text: group.text
      }));

      const batchJobId = isWindowJob
        ? `analysis-batch-${windowId}`
        : `analysis-batch-${mediaId}`;

      console.log(
        `  → Enqueueing 1 batch job (${batchSegments.length} segments) → analysisQueue [${batchJobId}]`
      );

      await analysisQueue.add(
        "analyze-batch",
        {
          mediaId,
          userId,
          windowId,
          totalSegments: batchSegments.length,
          segments: batchSegments
        },
        { jobId: batchJobId }
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
    connection: redis,
    lockDuration:    120_000,  // 2 min — grouping can be slow for large transcripts
    maxStalledCount: 2
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Grouper job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Grouper job ${job?.id} failed:`, err.message);
  const { mediaId, windowId } = job?.data || {};
  if (mediaId && !windowId) {
    await markSessionFailed(mediaId, "grouping", job.id, err);
  }
});