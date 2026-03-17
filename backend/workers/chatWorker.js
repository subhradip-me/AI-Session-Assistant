import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import SessionReport from "../src/models/SessionReport.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import connectDB from "../src/config/db.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

console.log("💬 Chat Worker Started");

const worker = new Worker(
  "chat-query",
  async (job) => {
    const { mediaId, question } = job.data;

    // Fetch the session report to use as context
    const report = await SessionReport.findOne({ mediaId });

    if (!report) {
      console.warn(`⚠️  No report found for ${mediaId} — answering without context`);
    }

    const context = report?.content || "No session report available yet.";

    const prompt = `You are an AI session assistant. A user is asking a question about a recorded session.

Session Report:
${context}

User Question:
${question}

Instructions:
- Answer clearly and specifically based on the session content above.
- If the answer is not covered in the session, say so honestly.
- Keep the answer concise but complete.
- Do not make up information not present in the report.

Answer:`;

    const answer = await AIAnalysisService.groqChat(prompt, 0.3);

    console.log(`💬 Chat answer generated for ${mediaId}`);

    return { answer };
  },
  {
    connection: redis,
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 20 }
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Chat job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Chat job ${job?.id} failed:`, err.message);
});
