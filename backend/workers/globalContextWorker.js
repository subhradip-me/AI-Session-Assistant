import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import SessionContext from "../src/models/SessionContext.js";
import EventService from "../src/services/EventService.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("🌍 Global Context Worker Started");

/**
 * Split a transcript into word-capped chunks.
 * 1500 words ≈ 5 min of speech — stays well within token limits while
 * drastically reducing the number of analyzeGlobal() LLM calls.
 */
function chunkByWords(text, maxWords = 1500) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }

  return chunks;
}

/**
 * Merge per-chunk summaries into a single session-level context document
 * by sending all chunk summaries back to the LLM.
 * Only called when there are multiple chunks.
 */
async function buildGlobalContext(chunkResults) {
  const summaries = chunkResults.map(c => c.summary).filter(Boolean);

  const prompt = summaries.join("\n");

  const res = await AIAnalysisService.analyze(prompt);

  return {
    summary: res.session_summary || res.summary || summaries.join(" "),
    topics:  res.key_topics   || res.topics   || [],
    insights: res.core_insights || res.insights || []
  };
}

const worker = new Worker(
  "global-context",
  async (job) => {

    const { mediaId, userId, transcript } = job.data;

    console.log(`🌍 Generating global context for ${mediaId}`);

    const chunks = chunkByWords(transcript, 1500);

    console.log(`   Split into ${chunks.length} chunk(s) of ≤1500 words`);

    let finalContext;

    if (chunks.length === 1) {
      // Single chunk — analyse directly, skip the merge call
      console.log(`   Single chunk — analysing directly (no merge needed)`);
      finalContext = await AIAnalysisService.analyzeGlobal(chunks[0]);
    } else {
      // Multiple chunks — analyse each, then merge summaries
      const chunkResults = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(`   Analyzing chunk ${i + 1}/${chunks.length}`);
        const analysis = await AIAnalysisService.analyzeGlobal(chunks[i]);
        chunkResults.push(analysis);
      }
      finalContext = await buildGlobalContext(chunkResults);
    }

    await SessionContext.findOneAndUpdate(
      { mediaId },
      {
        mediaId,
        userId,
        summary:  finalContext.summary,
        topics:   finalContext.topics,
        insights: finalContext.insights
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Global context saved for ${mediaId}`);
    console.log(`   Topics: ${finalContext.topics.length}, Insights: ${finalContext.insights.length}`);

    await EventService.emit("GLOBAL_CONTEXT_READY", { mediaId, summary: finalContext.summary, topics: finalContext.topics, insights: finalContext.insights });
    await publishPipelineEvent(mediaId, "globalContext", "completed");

  },
  {
    connection: redis,
    concurrency: 1    // one job at a time — prevents parallel duplicate runs
  }
);

worker.on("failed", async (job, err) => {
  console.error(`❌ Global Context job ${job?.id} failed:`, err.message);
  const { mediaId } = job?.data || {};
  if (mediaId) {
    await markSessionFailed(mediaId, "globalContext", job.id, err);
  }
});
