import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import SegmentAnalysis from "../src/models/SegmentAnalysis.js";
import BlockAnalysis from "../src/models/BlockAnalysis.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import EventService from "../src/services/EventService.js";
import { insightAggregationQueue } from "../src/queues/insightAggregationQueue.js";
import { embeddingQueue } from "../src/queues/embeddingQueue.js";
import connectDB from "../src/config/db.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("🧱 Block Aggregator Worker started");
console.log("   role       : group 8 segments → block intelligence");
console.log("   concurrency: 3");
console.log("   block size : 8 segments");

// ─────────────────────────────────────────────────────────────────────────────
// Block Aggregator Worker
//
// Receives: segment IDs (e.g. [0,1,2,3,4,5,6,7])
// Does:
//   1. Fetch SegmentAnalysis docs for all segments
//   2. Merge topics, insights, questions, decisions, action_items
//   3. Create a block summary text from segment summaries
//   4. Call LLM to analyze the block
//   5. Store BlockAnalysis
//   6. Trigger aggregation when all blocks are done
// ─────────────────────────────────────────────────────────────────────────────

const worker = new Worker(
  "block-aggregation",
  async (job) => {
    const { mediaId, blockId, segmentIds, totalBlocks } = job.data;

    console.log(`🧱 Processing block ${blockId}/${totalBlocks - 1} (segments ${segmentIds[0]}-${segmentIds[segmentIds.length - 1]}) for ${mediaId}`);

    // ── 1. Fetch all segment analyses for this block ─────────────────────────
    const segmentAnalyses = await SegmentAnalysis.find({
      mediaId,
      segmentId: { $in: segmentIds }
    }).sort({ segmentId: 1 });

    if (!segmentAnalyses.length) {
      console.warn(`⚠️  No segment analyses found for block ${blockId} (${mediaId})`);
      return;
    }

    // ── 2. Aggregate intelligence from segments ────────────────────────────
    const blockIntelligence = {
      topics: [],
      insights: [],
      questions: [],
      decisions: [],
      action_items: [],
      summaries: []
    };

    for (const seg of segmentAnalyses) {
      blockIntelligence.topics.push(...(seg.topics || []));
      blockIntelligence.insights.push(...(seg.insights || []));
      blockIntelligence.questions.push(...(seg.questions || []));
      blockIntelligence.decisions.push(...(seg.decisions || []));
      blockIntelligence.action_items.push(...(seg.action_items || []));
      if (seg.summary) blockIntelligence.summaries.push(seg.summary);
    }

    // ── 3. Create block context text from segment summaries ────────────────
    const blockContextText = blockIntelligence.summaries.join(" ");

    // ── 4. Merge block-level intelligence with AI refinement ────────────────
    console.log(`   📝 Merging ${segmentAnalyses.length} segments into block ${blockId}...`);
    console.log(`      Topics: ${blockIntelligence.topics.length}, Insights: ${blockIntelligence.insights.length}, Questions: ${blockIntelligence.questions.length}`);

    // ── 5. Run semantic deduplication at block level ───────────────────────
    let refinedIntelligence;
    try {
      refinedIntelligence = await AIAnalysisService.deduplicateAll(blockIntelligence);
      console.log(`   ✅ Block ${blockId} deduplication: topics=${refinedIntelligence.topics.length}, insights=${refinedIntelligence.insights.length}`);
    } catch (err) {
      console.warn(`⚠️  Block ${blockId} deduplication failed:`, err.message);
      // Use un-deduplicated data on fallback
      refinedIntelligence = blockIntelligence;
    }

    // ── 6. Fetch time window from first and last segment ──────────────────
    const firstSeg = segmentAnalyses[0];
    const lastSeg = segmentAnalyses[segmentAnalyses.length - 1];

    // ── 7. Persist block analysis ────────────────────────────────────────
    const blockDoc = await BlockAnalysis.findOneAndUpdate(
      { mediaId, blockId },
      {
        mediaId,
        blockId,
        segments: segmentIds,
        start: firstSeg.start || 0,
        end: lastSeg.end || 0,
        duration: (lastSeg.end || 0) - (firstSeg.start || 0),
        topics: refinedIntelligence.topics || [],
        insights: refinedIntelligence.insights || [],
        questions: refinedIntelligence.questions || [],
        decisions: refinedIntelligence.decisions || [],
        action_items: refinedIntelligence.action_items || [],
        summary: blockContextText
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Block ${blockId} analysis stored (${blockDoc._id})`);

    await EventService.emit("BLOCK_ANALYSIS_READY", {
      mediaId,
      blockId,
      blockAnalysis: blockDoc
    });

    // ── 8. Check if all blocks are complete ──────────────────────────────
    const completedBlocks = await BlockAnalysis.countDocuments({ mediaId });

    if (completedBlocks >= totalBlocks) {
      console.log(`✅ All ${totalBlocks} blocks analyzed for ${mediaId} — triggering final aggregation`);

      // Idempotent aggregation job.
      // IMPORTANT: jobId must match llmWorker.js exactly — both code paths
      // can trigger the final aggregation and BullMQ deduplication prevents
      // double-processing only when the jobId is identical in both callers.
      const agg = await insightAggregationQueue.add(
        "aggregate-insights",
        { mediaId, totalBlocks },
        {
          jobId: `final-aggregate-${mediaId}`,
          removeOnComplete: true,
          removeOnFail: { count: 20 }
        }
      );
      console.log(`📊 Block aggregation job enqueued: ${agg.id}`);
    }

    // ── 9. Enqueue embedding for this block ───────────────────────────────
    await embeddingQueue.add(
      "embed-block",
      { mediaId, blockId },
      {
        jobId: `embed-${mediaId}-${blockId}`,
        removeOnComplete: true
      }
    );
  },
  {
    connection: redis,
    concurrency: 3,
    settings: {
      backoffStrategy: (attemptsMade) => {
        // Exponential backoff: 5s, 25s, 125s, ...
        return Math.min(5000 * Math.pow(5, attemptsMade - 1), 300000);
      }
    }
  }
);

worker.on("completed", (job) => {
  console.log(`Block aggregation job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Block aggregation job ${job?.id} failed:`, err.message);
});
