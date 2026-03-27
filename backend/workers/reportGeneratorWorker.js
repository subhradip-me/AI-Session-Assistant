import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import SessionReport from "../src/models/SessionReport.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

// Load environment variables relative to this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("📄 Report Generator Worker Started");

// ─────────────────────────────────────────────────────────────────────────────
// Static fallback formatter
//
// Produces a well-structured markdown report without an LLM call.
// Used when AIAnalysisService.generateReport() throws or returns null.
// ─────────────────────────────────────────────────────────────────────────────
function buildStaticReport(intelligence) {
  const {
    topics       = [],
    insights     = [],
    decisions    = [],
    action_items = [],
    summaries    = [],
    questions    = []
  } = intelligence;

  const bullet   = items => items.map(x => `- ${x}`).join("\n");
  const numbered = items => items.map((x, i) => `${i + 1}. ${x}`).join("\n");

  // Build a narrative overview from summaries
  const overviewText = summaries.length
    ? summaries.slice(0, 3).join(" ")
    : `This session covered key discussions around ${topics.slice(0, 3).join(", ") || "various topics"}.`;

  const sections = [
    `The session covered the following topics: ${topics.slice(0, 5).join("; ") || "see below"}.`,
    overviewText,
    ""
  ];

  if (topics.length) {
    sections.push("### Key Topics", numbered(topics), "");
  }

  if (insights.length) {
    sections.push("### Key Insights", bullet(insights), "");
  }

  if (decisions.length) {
    sections.push("### Decisions Made", bullet(decisions), "");
  }

  if (action_items.length) {
    sections.push("### Action Items", bullet(action_items), "");
  }

  if (questions.length) {
    sections.push("### Open Questions", bullet(questions), "");
  }

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────────────
const worker = new Worker(
  "report-generator",
  async (job) => {
    const { mediaId, intelligence, userId } = job.data;

    console.log(`📄 Generating report for ${mediaId}...`);

    // Attempt AI-structured report first; fall back to static if it fails.
    let content = null;

    try {
      content = await AIAnalysisService.generateReport(intelligence);
    } catch (err) {
      console.warn(`⚠️  AI report generation failed for ${mediaId}:`, err.message);
    }

    if (!content) {
      console.warn(`📄 Falling back to static report formatter for ${mediaId}`);
      content = buildStaticReport(intelligence);
    }

    await SessionReport.findOneAndUpdate(
      { mediaId },
      { mediaId, userId, content, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    console.log(`📄 Report saved for ${mediaId} (${content.length} chars)`);

    // ✔ Mark session as fully completed
    await updatePipelineState(mediaId, { "steps.report.status": "completed" }, "completed");
    await publishPipelineEvent(mediaId, "report", "completed");
    await logJobAudit(mediaId, "reportGeneratorWorker", job.id, "completed");
  },
  {
    connection: redis,
    removeOnComplete: { count: 10 },
    removeOnFail:     { count: 20 }
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Report generator job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Report generator job ${job?.id} failed:`, err.message);
  const { mediaId } = job?.data || {};
  if (mediaId) {
    await markSessionFailed(mediaId, "report", job.id, err);
  }
});