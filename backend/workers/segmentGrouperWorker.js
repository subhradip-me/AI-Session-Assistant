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

    const { mediaId, segments } = job.data;

    console.log("Grouping segments:", mediaId);

    const groups = SegmentGrouper.groupSegments(segments);

    console.log(`Grouped into ${groups.length} segments`);

    // ── Segment filter ────────────────────────────────────────────────────────
    // Skip low-information groups before paying for an LLM call.
    // Segments shorter than 120 chars are typically noise, filler phrases,
    // or single-sentence transitions that produce zero useful intelligence.
    const MIN_CHARS = 120;
    const validGroups = groups.filter(g => g.text.trim().length >= MIN_CHARS);

    if (validGroups.length < groups.length) {
      console.log(`🔍 Filtered ${groups.length - validGroups.length} low-information segment(s) (< ${MIN_CHARS} chars)`);
    }

    console.log(`📊 ${validGroups.length}/${groups.length} segments queued for AI analysis`);

    // Update MongoDB with ALL grouped segments for the transcript record
    await Transcript.findOneAndUpdate(
      { mediaId },
      {
        segments: groups,
        status: 'grouped',
        updatedAt: new Date()
      },
      { new: true }
    );

    console.log(`Saved grouped transcript to database for ${mediaId}`);

    await EventService.emit("GROUPED_SEGMENTS_READY", {
      mediaId,
      groups
    });

    if (validGroups.length === 0) {
      console.warn(`⚠️  All segments filtered for ${mediaId} — no AI analysis needed`);
      return;
    }

    // Enqueue only valid segments. totalSegments reflects the filtered count
    // so llmWorker knows exactly when all AI calls are done.
    // Add jobId to prevent dispatcher re-runs from creating duplicate jobs.
    console.log(`Enqueueing ${validGroups.length} segments for AI analysis`);
    for (let i = 0; i < validGroups.length; i++) {
      await analysisQueue.add(
        "analyze-segment",
        {
          mediaId,
          segmentId: i,
          text: validGroups[i].text,
          totalSegments: validGroups.length
        },
        {
          jobId: `analysis-${mediaId}-${i}`
        }
      );
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
  console.log(`Grouper job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Grouper job ${job?.id} failed`, err.message);
});