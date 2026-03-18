import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import { embed } from "../src/services/embeddingService.js";
import { initCollection, insertVector } from "../src/services/vectorService.js";
import BlockAnalysis from "../src/models/BlockAnalysis.js";
import connectDB from "../src/config/db.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

// Ensure Qdrant collection exists with correct dimensions (768) before accepting jobs
initCollection().catch(err =>
  console.warn("⚠️  Could not init Qdrant collection:", err.message)
);

console.log("📌 Embedding Worker started");
console.log("   model : nomic-embed-text (768-dim via Ollama)");
console.log("   store : Qdrant — session_blocks collection");

const worker = new Worker(
  "embedding",
  async (job) => {
    const { mediaId, blockId } = job.data;

    const block = await BlockAnalysis.findOne({ mediaId, blockId }).lean();

    if (!block) {
      console.warn(`⚠️  Block ${blockId} not found for ${mediaId} — skipping embedding`);
      return;
    }

    // ── Rich embedding text (improves retrieval quality significantly) ────────
    // Including structured labels helps the model understand the fields.
    // This produces much tighter clustering than plain concatenation.
    const text = [
      block.summary   ? `Summary: ${block.summary}`                           : null,
      block.topics?.length    ? `Topics: ${block.topics.join(", ")}`          : null,
      block.insights?.length  ? `Insights: ${block.insights.join(". ")}`      : null,
      block.decisions?.length ? `Decisions: ${block.decisions.join(". ")}`    : null,
      block.action_items?.length ? `Action Items: ${block.action_items.join(". ")}` : null,
    ].filter(Boolean).join("\n");

    if (!text) {
      console.warn(`⚠️  Block ${blockId} has no embeddable content — skipping`);
      return;
    }

    console.log(`   📝 Embedding block ${blockId} (${text.length} chars) for ${mediaId}`);

    const vector = await embed(text);

    await insertVector(
      `${mediaId}-${blockId}`,
      vector,
      {
        mediaId,
        blockId,
        topics:       block.topics       || [],
        summary:      block.summary      || "",
        start:        block.start,
        end:          block.end
      }
    );

    console.log(`✅ Embedded block ${blockId} for ${mediaId} (dim=${vector.length})`);
  },
  { connection: redis }
);

worker.on("completed", (job) => {
  console.log(`Embedding job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Embedding job ${job?.id} failed:`, err.message);
});