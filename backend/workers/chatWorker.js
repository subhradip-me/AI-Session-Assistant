import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import AIAnalysisService from "../src/services/AIAnalysisService.js";
import { retrieve } from "../src/services/retrieverService.js";
import { buildContext } from "../src/services/contextBuilder.js";
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

    console.log(`💬 [${mediaId}] Question: "${question}"`);

    // ── 1. Retrieve most relevant blocks via semantic + topic-boosted search ──
    let retrieved = [];
    try {
      retrieved = await retrieve(mediaId, question);
      console.log(`   🔍 Retrieved ${retrieved.length} relevant block(s)`);
    } catch (err) {
      console.warn(`   ⚠️  Retrieval failed (${err.message}) — falling back to report-only mode`);
    }

    // ── 2. Build structured context from retrieved blocks ─────────────────────
    let context = "";
    try {
      if (retrieved.length > 0) {
        context = await buildContext(mediaId, retrieved);
      }
    } catch (err) {
      console.warn(`   ⚠️  Context build failed (${err.message})`);
    }

    if (!context) {
      context = "No relevant context could be retrieved for this query.";
    }

    // ── 3. Compose LLM prompt ─────────────────────────────────────────────────
    const prompt = `You are an AI session assistant. Your job is to answer questions about a recorded meeting or session.

Context (retrieved from the session):
${context}

User Question:
${question}

Instructions:
- Answer clearly and specifically based only on the context above.
- If the answer is not present in the context, say so honestly — do not invent information.
- Keep the answer concise but complete.
- Reference specific blocks or timestamps where relevant.

Answer:`;

    // ── 4. Generate answer ────────────────────────────────────────────────────
    const answer = await AIAnalysisService.groqChat(prompt, 0.3);

    console.log(`✅ Chat answer generated for ${mediaId}`);

    return { answer, retrievedBlocks: retrieved.length };
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
