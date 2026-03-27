import { Worker } from "bullmq";
import redis from "../src/config/redis.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import SegmentAnalysis from "../src/models/SegmentAnalysis.js";
import BlockAnalysis from "../src/models/BlockAnalysis.js";
import SessionContext from "../src/models/SessionContext.js";
import TranscriptBufferService from "../src/services/TranscriptBufferService.js";
import EventService from "../src/services/EventService.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import reportQueue from "../src/queues/reportQueue.js";
import { updateMemory } from "../src/services/memoryService.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("📊 Insight Aggregator Worker Started");

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

async function aggregateSession(mediaId) {

  // ─────────────────────────────────────────────────────────────────────────────
  // Hierarchical Intelligence Aggregation
  //
  // PHASE 1: Try to aggregate from blocks (new path)
  //   If blocks exist, use them as the primary source. This is 8x smaller
  //   than segments, reducing noise and focusing on high-level patterns.
  //
  // PHASE 2: Fallback to segments (legacy path)
  //   If no blocks (e.g., pipeline still running), aggregate segment analyses
  //   directly. This maintains backward compatibility.
  // ─────────────────────────────────────────────────────────────────────────────

  // Try to fetch block analyses first
  let blocks = await BlockAnalysis.find({ mediaId }).sort({ blockId: 1 });

  let intelligence = {
    topics: [],
    insights: [],
    questions: [],
    decisions: [],
    action_items: [],
    summaries: []
  };

  let dataSource = "blocks";

  if (blocks.length > 0) {
    console.log(`📊 Aggregating from ${blocks.length} blocks (hierarchical path)`);

    // Aggregate from blocks
    for (const block of blocks) {
      intelligence.topics.push(...(block.topics || []));
      intelligence.insights.push(...(block.insights || []));
      intelligence.questions.push(...(block.questions || []));
      intelligence.decisions.push(...(block.decisions || []));
      intelligence.action_items.push(...(block.action_items || []));
      if (block.summary) intelligence.summaries.push(block.summary);
    }

  } else {
    console.log(`📊 No blocks found — falling back to segments (legacy path)`);
    dataSource = "segments";

    // Fallback: aggregate from segments
    const analyses = await SegmentAnalysis.find({ mediaId }).sort({ segmentId: 1 });

    if (!analyses.length) return null;

    for (const a of analyses) {
      intelligence.topics.push(...(a.topics || []));
      intelligence.insights.push(...(a.insights || []));
      intelligence.questions.push(...(a.questions || []));
      intelligence.decisions.push(...(a.decisions || []));
      intelligence.action_items.push(...(a.action_items || []));
      if (a.summary) intelligence.summaries.push(a.summary);
    }
  }

  // Cap summaries — for long sessions keep only the most evenly-spaced highlights
  const MAX_SUMMARIES = 10;
  if (intelligence.summaries.length > MAX_SUMMARIES) {
    const step = intelligence.summaries.length / MAX_SUMMARIES;
    intelligence.summaries = Array.from({ length: MAX_SUMMARIES }, (_, i) =>
      intelligence.summaries[Math.round(i * step)]
    );
  }

  // Seed with global context so the full-transcript view informs deduplication
  const globalCtx = await SessionContext.findOne({ mediaId });
  if (globalCtx) {
    console.log(`🌍 Global context found for ${mediaId} — seeding topics (${globalCtx.topics?.length || 0}) and insights (${globalCtx.insights?.length || 0})`);
    intelligence.topics.push(...(globalCtx.topics || []));
    intelligence.insights.push(...(globalCtx.insights || []));
  } else {
    console.log(`⚠️  No global context yet for ${mediaId} — running without it`);
  }

  // Validate we have data before proceeding
  if (!intelligence.topics.length && !intelligence.insights.length && !intelligence.questions.length && !intelligence.decisions.length && !intelligence.action_items.length) {
    console.warn(`⚠️  No intelligence gathered for ${mediaId} from ${dataSource} (${blocks.length} blocks / ${dataSource === 'segments' ? 'fallback' : 'primary'})`);
    return null;
  }

  // Pass 1: exact-string deduplication
  intelligence.topics       = unique(intelligence.topics);
  intelligence.insights     = unique(intelligence.insights);
  intelligence.questions    = unique(intelligence.questions);
  intelligence.decisions    = unique(intelligence.decisions);
  intelligence.action_items = unique(intelligence.action_items);

  // Pass 2: AI-powered semantic deduplication — all categories in a single LLM call
  console.log(`🧹 Running semantic deduplication (single-call) from ${dataSource}...`);
  console.log(`   Before: topics=${intelligence.topics.length}, insights=${intelligence.insights.length}, questions=${intelligence.questions.length}, action_items=${intelligence.action_items.length}`);

  const deduped = await AIAnalysisService.deduplicateAll(intelligence);
  intelligence.topics       = deduped.topics;
  intelligence.insights     = deduped.insights;
  intelligence.questions    = deduped.questions;
  intelligence.action_items = deduped.action_items;

  console.log(`   After:  topics=${intelligence.topics.length}, insights=${intelligence.insights.length}, questions=${intelligence.questions.length}, action_items=${intelligence.action_items.length}`);

  return intelligence;
}

const worker = new Worker(
  "insight-aggregation",
  async (job) => {

    const { mediaId, totalSegments, userId } = job.data;

    await updatePipelineState(mediaId, { "steps.blocks.status": "completed" }, "aggregating");
    await publishPipelineEvent(mediaId, "aggregating", "running");
    console.log(`🔄 Aggregating insights for ${mediaId} (${totalSegments} segments)`);

    const intelligence = await aggregateSession(mediaId);

    if (!intelligence) {
      console.warn(`⚠️  No analyses found for ${mediaId}, skipping aggregation`);
      return;
    }

    console.log(`📊 Session intelligence compiled for ${mediaId}:`);
    console.log(`   Topics:       ${intelligence.topics.length}`);
    console.log(`   Insights:     ${intelligence.insights.length}`);
    console.log(`   Questions:    ${intelligence.questions.length}`);
    console.log(`   Decisions:    ${intelligence.decisions.length}`);
    console.log(`   Action Items: ${intelligence.action_items.length}`);
    console.log(`   Summaries:    ${intelligence.summaries.length}`);

    await EventService.emit("SESSION_INTELLIGENCE_READY", {
      mediaId,
      intelligence
    });

    console.log(`✅ SESSION_INTELLIGENCE_READY emitted for ${mediaId}`);

    // === CLEANUP BUFFER ===
    // Memory cleanup: release the sliding window buffer for this session
    TranscriptBufferService.cleanup(mediaId);

    // === CREATE SESSION REPORT ===
      
    await reportQueue.add("create-session-report", {
      mediaId,
      userId,
      intelligence
    },
    {
      jobId: `create-session-report-${mediaId}`,
      removeOnComplete: true,
      removeOnFail: true
    });

    console.log(`✅ Session report job added for ${mediaId}`);

    // === UPDATE LONG-TERM MEMORY ===
    // Fire-and-forget: memory failure must never block or crash this worker.
    // userId may be undefined for anonymous sessions — updateMemory guards that.
    updateMemory(userId, intelligence).catch(err =>
      console.error(`❌ Memory update failed for ${mediaId}:`, err.message)
    );

  },
  {
    connection: redis,
    // Prevent completed/failed jobs from accumulating in Redis indefinitely.
    // Without this, old jobs can re-trigger on worker restart and cause
    // SESSION_INTELLIGENCE_READY to be emitted multiple times for old sessions.
    removeOnComplete: { count: 10 },
    removeOnFail:     { count: 20 }
  }
);

worker.on("completed", (job) => {
  console.log(`Session insight aggregation job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`Session insight aggregation job ${job?.id} failed:`, err.message);
  const { mediaId } = job?.data || {};
  if (mediaId) {
    await markSessionFailed(mediaId, "aggregating", job.id, err);
  }
});