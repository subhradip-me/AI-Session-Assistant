import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import SessionReport from "../src/models/SessionReport.js";
import connectDB from "../src/config/db.js";

// Load environment variables relative to this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("📄 Report Generator Worker Started");

const worker = new Worker(
  "report-generator",
  async (job) => {
    const { mediaId, intelligence } = job.data;

    const {
      topics = [],
      insights = [],
      decisions = [],
      action_items = []
    } = intelligence;

    const report = [
      "📌 Session Overview",
      `This session covered key discussions around ${topics.slice(0, 3).join(", ") || "various topics"}.`,
      "",
      "🧠 Key Topics",
      topics.length
        ? topics.map((t, i) => `${i + 1}. ${t}`).join("\n")
        : "No specific topics identified.",
      "",
      "💡 Insights",
      insights.length
        ? insights.map((ins) => `- ${ins}`).join("\n")
        : "No insights captured.",
      "",
      "✅ Decisions",
      decisions.length
        ? decisions.map((d) => `- ${d}`).join("\n")
        : "No explicit decisions recorded.",
      "",
      "🚀 Action Items",
      action_items.length
        ? action_items.map((a) => `- ${a}`).join("\n")
        : "No action items identified."
    ].join("\n");

    await SessionReport.findOneAndUpdate(
      { mediaId },
      { mediaId, content: report, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    console.log(`📄 Report generated for ${mediaId}`);
  },
  {
    connection: redis,
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 }
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Report generator job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Report generator job ${job?.id} failed:`, err.message);
});