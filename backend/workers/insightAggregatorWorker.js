import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import SegmentAnalysis from "../src/models/SegmentAnalysis.js";
import SessionContext from "../src/models/SessionContext.js";
import EventService from "../src/services/EventService.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import connectDB from "../src/config/db.js";

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

  const analyses = await SegmentAnalysis.find({ mediaId }).sort({ segmentId: 1 });

  if (!analyses.length) return null;

  const intelligence = {

    topics: [],
    insights: [],
    questions: [],
    decisions: [],
    action_items: [],
    summaries: []

  };

  for (const a of analyses) {

    intelligence.topics.push(...(a.topics || []));
    intelligence.insights.push(...(a.insights || []));
    intelligence.questions.push(...(a.questions || []));
    intelligence.decisions.push(...(a.decisions || []));
    intelligence.action_items.push(...(a.action_items || []));
    if (a.summary) intelligence.summaries.push(a.summary);

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

  // Pass 1: exact-string deduplication
  intelligence.topics       = unique(intelligence.topics);
  intelligence.insights     = unique(intelligence.insights);
  intelligence.questions    = unique(intelligence.questions);
  intelligence.decisions    = unique(intelligence.decisions);
  intelligence.action_items = unique(intelligence.action_items);

  // Pass 2: AI-powered semantic deduplication — all categories in a single LLM call
  console.log(`🧹 Running semantic deduplication (single-call)...`);
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

    const { mediaId, totalSegments } = job.data;

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

  },
  {
    connection: {
      host: "127.0.0.1",
      port: 6379
    }
  }
);

worker.on("completed", (job) => {
  console.log(`Session insight aggregation job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Session insight aggregation job ${job?.id} failed:`, err.message);
});