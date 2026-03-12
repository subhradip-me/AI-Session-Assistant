import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import { getProvider } from "../src/services/providerRouter.js";
import SegmentAnalysis from "../src/models/SegmentAnalysis.js";
import SessionContext from "../src/models/SessionContext.js";
import EventService from "../src/services/EventService.js";
import { insightAggregationQueue } from "../src/queues/insightAggregationQueue.js";
import connectDB from "../src/config/db.js";

// ─── Rate-limit helpers ───────────────────────────────────────────────────────
// Local copies — avoids circular imports from AIAnalysisService.

function isRateLimit(err) {
  const msg = String(err?.message || "");
  return (
    err?.status === 429 || err?.statusCode === 429 ||
    msg.includes("rate_limit_exceeded") ||
    msg.includes("Rate limit") ||
    msg.includes("Too Many Requests") ||
    msg.includes("exceeded your current quota")
  );
}

/**
 * Returns how many ms to wait before retrying a rate-limited provider.
 *
 * Key cases:
 *  - Gemini PerDay quota exhausted → 2 hours  (RetryInfo only gives ~54s which
 *    is the per-minute window; the daily limit won't recover that fast)
 *  - Gemini RetryInfo JSON embedded in error message → exact seconds
 *  - Groq "try again in Xm Ys" text → exact ms
 */
function parseRetryDelay(err) {
  const msg = String(err?.message || "");

  if (msg.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier")) {
    return 2 * 60 * 60 * 1000; // 2 hours — daily quota needs a real reset
  }

  try {
    const jsonStart = msg.indexOf("[{");
    if (jsonStart !== -1) {
      const arr = JSON.parse(msg.substring(jsonStart));
      for (const item of arr) {
        if (item["@type"]?.includes("RetryInfo") && item.retryDelay) {
          const secs = parseFloat(item.retryDelay);
          if (!isNaN(secs) && secs > 0) return secs * 1000;
        }
      }
    }
  } catch { }

  const minSec = msg.match(/try again in (\d+)m([\d.]+)s/);
  if (minSec) return (parseInt(minSec[1]) * 60 + parseFloat(minSec[2])) * 1000;

  const sec = msg.match(/try again in ([\d.]+)s/);
  if (sec) return parseFloat(sec[1]) * 1000;

  return 65_000;
}

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("🧠 LLM Router Worker started");
console.log("   concurrency : 2");
console.log("   rate limit  : 20 requests / 60 s");
console.log("   providers   : Groq (70%) + Gemini (30%)");

// ─────────────────────────────────────────────────────────────────────────────

const worker = new Worker(
  "llm-calls",
  async (job) => {
    const { mediaId, segmentId, text, totalSegments } = job.data;

    // ── 1. Fetch rolling context just before LLM call ────────────────────────
    //   Query the last 2 completed segments so the LLM has continuity.
    //   Done here (not in analysisWorker) so context reflects actual DB state
    //   at processing time, not at dispatch time.
    const prevAnalyses = await SegmentAnalysis.find(
      { mediaId, segmentId: { $lt: segmentId } }
    )
      .sort({ segmentId: -1 })
      .limit(2);

    const previousContext = prevAnalyses
      .reverse()
      .map(a => a.summary)
      .filter(Boolean)
      .join("\n");

    // ── 2. Provider routing with automatic fallback ───────────────────────────
    // Try the chosen provider first. If it is rate-limited, immediately try
    // the other one. If both are exhausted, throw an error that encodes
    // max(groqDelay, geminiDelay) — the BullMQ backoffStrategy reads it and
    // waits exactly that long before the next attempt.
    const primary   = getProvider();
    const secondary = primary === "groq" ? "gemini" : "groq";

    console.log(`🔀 Segment ${segmentId}/${totalSegments - 1} → ${primary.toUpperCase()} (${mediaId})`);

    let result;
    let primaryErr;

    // ── Try primary ───────────────────────────────────────────────────────────
    try {
      result = primary === "groq"
        ? await AIAnalysisService.analyzeGroq(text, previousContext)
        : await AIAnalysisService.analyzeGemini(text, previousContext);
    } catch (err) {
      if (!isRateLimit(err)) throw err;   // non-429 error — don't retry
      primaryErr = err;
      console.warn(`⚠️  ${primary} rate-limited — falling back to ${secondary}`);
    }

    // ── Try secondary if primary failed ───────────────────────────────────────
    if (!result) {
      try {
        result = secondary === "groq"
          ? await AIAnalysisService.analyzeGroq(text, previousContext)
          : await AIAnalysisService.analyzeGemini(text, previousContext);
        console.log(`   ✅ ${secondary} fallback succeeded`);
      } catch (secondaryErr) {
        if (!isRateLimit(secondaryErr)) throw secondaryErr;

        // Both providers exhausted — wait for the SHORTEST recovery time.
        // We only need ONE provider available, so we back off for min(d1, d2).
        // Example: Groq needs 300s, Gemini PerDay needs 7200s → wait 300s,
        // then next attempt Groq is ready again.
        const d1 = parseRetryDelay(primaryErr);
        const d2 = parseRetryDelay(secondaryErr);
        const minDelay  = Math.min(d1, d2);
        const fastProv  = d1 <= d2 ? primary : secondary;

        const bothErr = new Error(
          `Both providers rate-limited — ` +
          `${primary}: ${Math.ceil(d1 / 1000)}s, ` +
          `${secondary}: ${Math.ceil(d2 / 1000)}s — ` +
          `backing off ${Math.ceil(minDelay / 1000)}s (waiting for ${fastProv})`
        );
        bothErr.retryAfterMs = minDelay;
        throw bothErr;
      }
    }

    console.log(`✅ Segment ${segmentId} done via ${result._provider ?? primary} | topics: ${result.topics?.length ?? 0}, insights: ${result.insights?.length ?? 0}`);

    // ── 3. Persist result ────────────────────────────────────────────────────
    await SegmentAnalysis.findOneAndUpdate(
      { mediaId, segmentId },
      { mediaId, segmentId, ...result },
      { upsert: true, new: true }
    );

    await EventService.emit("SEGMENT_ANALYSIS_READY", {
      mediaId,
      segmentId,
      analysis: result
    });

    // ── 4. Aggregation trigger ───────────────────────────────────────────────
    //   Check if this was the last segment. Use >= (not ===) as a safety net
    //   in case a previous run left orphaned docs.
    const analysisCount = await SegmentAnalysis.countDocuments({ mediaId });

    if (analysisCount >= totalSegments) {
      console.log(`✅ All ${totalSegments} segments analyzed for ${mediaId} — waiting for global context...`);

      // Poll for SessionContext (up to 60 s) before triggering aggregation
      let globalCtx = await SessionContext.findOne({ mediaId });
      let attempts = 0;

      while (!globalCtx && attempts < 30) {
        console.log(`⏳ Global context not ready (${attempts + 1}/30), retrying in 2 s...`);
        await new Promise(r => setTimeout(r, 2000));
        globalCtx = await SessionContext.findOne({ mediaId });
        attempts++;
      }

      if (!globalCtx) {
        console.warn(`⚠️  Global context timed out for ${mediaId} — proceeding without it`);
      } else {
        console.log(`🌍 Global context ready — triggering aggregation`);
      }

      await insightAggregationQueue.add(
        "aggregate-insights",
        { mediaId, totalSegments },
        {
          jobId: `aggregate-${mediaId}`,
          removeOnComplete: true
        }
      );
    }
  },
  {
    connection: redis,

    // Only 2 LLM calls in-flight at any time — prevents API burst
    concurrency: 2,

    // BullMQ rate limiter: queue processes at most 20 jobs per 60 s globally
    // across ALL llmWorker instances. This maps to ~1 call every 3 s on average,
    // well under both Groq (6000 RPM free) and Gemini (15 RPM free) limits.
    limiter: {
      max: 20,
      duration: 60_000
    },

    // Custom backoff — reads the exact retry delay encoded in the thrown error.
    // err.retryAfterMs is set when both providers fail simultaneously.
    // Handles: Groq TPD (~4-8 min), Gemini per-minute (~54s), Gemini PerDay (2h).
    settings: {
      backoffStrategy: (attemptsMade, type, err) => {
        const delay = err?.retryAfterMs ?? parseRetryDelay(err);
        console.warn(`   ⏳ BullMQ backoff: waiting ${Math.ceil(delay / 1000)}s before attempt ${attemptsMade + 1}...`);
        return delay;
      }
    }
  }
);

worker.on("completed", (job) => {
  console.log(`LLM job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ LLM job ${job?.id} failed:`, err.message);
});
