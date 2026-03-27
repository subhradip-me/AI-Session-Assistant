import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import redis from "../src/config/redis.js";
import { embed } from "../src/services/embeddingService.js";
import {
  initCollectionByName,
  insertVectorToCollection,
  BLOCK_COLLECTION,
  SEGMENT_COLLECTION
} from "../src/services/vectorService.js";
import BlockAnalysis from "../src/models/BlockAnalysis.js";
import SegmentAnalysis from "../src/models/SegmentAnalysis.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

// Connect to MongoDB
connectDB();

// Ensure both Qdrant collections exist before accepting jobs
Promise.all([
  initCollectionByName(BLOCK_COLLECTION),
  initCollectionByName(SEGMENT_COLLECTION)
]).catch(err =>
  console.warn("⚠️  Could not init Qdrant collection(s):", err.message)
);

console.log("📌 Embedding Worker started");
console.log("   model : nomic-embed-text (768-dim via Ollama)");
console.log(`   store : Qdrant — "${BLOCK_COLLECTION}" + "${SEGMENT_COLLECTION}"`);

// ─────────────────────────────────────────────────────────────────────────────
// Embed a BlockAnalysis document → session_blocks
// ─────────────────────────────────────────────────────────────────────────────
async function embedBlock(mediaId, blockId, userId) {
  const block = await BlockAnalysis.findOne({ mediaId, blockId }).lean();

  if (!block) {
    console.warn(`⚠️  Block ${blockId} not found for ${mediaId} — skipping`);
    return;
  }

  // Rich embedding text: labelled fields improve vector clustering quality
  const text = [
    block.summary             ? `Summary: ${block.summary}`                           : null,
    block.topics?.length      ? `Topics: ${block.topics.join(", ")}`                  : null,
    block.insights?.length    ? `Insights: ${block.insights.join(". ")}`              : null,
    block.decisions?.length   ? `Decisions: ${block.decisions.join(". ")}`            : null,
    block.action_items?.length ? `Action Items: ${block.action_items.join(". ")}`     : null,
  ].filter(Boolean).join("\n");

  if (!text) {
    console.warn(`⚠️  Block ${blockId} has no embeddable content — skipping`);
    return;
  }

  console.log(`   📝 Embedding block ${blockId} (${text.length} chars) for ${mediaId}`);

  const vector = await embed(text);

  await insertVectorToCollection(
    BLOCK_COLLECTION,
    `${mediaId}-block-${blockId}`,
    vector,
    {
      mediaId,
      userId,
      blockId,
      type:    "block",
      topics:  block.topics  || [],
      summary: block.summary || "",
      start:   block.start,
      end:     block.end
    }
  );

  console.log(`✅ Embedded block ${blockId} for ${mediaId} (dim=${vector.length})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed a SegmentAnalysis document → session_segments
//
// Cost guard: only numeric segmentIds (Path B full-transcript) are embedded.
// Path A window-based string IDs are skipped — they are partial/redundant and
// would pollute the segment collection with lower-quality interim data.
// ─────────────────────────────────────────────────────────────────────────────
async function embedSegment(mediaId, segmentId, blockId, userId) {
  // Safety: only embed full-transcript (numeric) segment IDs
  if (typeof segmentId !== "number") {
    console.log(`   ⏭  Segment ${segmentId} is a window-based ID (string) — skipping`);
    return;
  }

  const seg = await SegmentAnalysis.findOne({ mediaId, segmentId }).lean();

  if (!seg) {
    console.warn(`⚠️  SegmentAnalysis ${segmentId} not found for ${mediaId} — skipping`);
    return;
  }

  // Compact but informative embedding text for segment-level granularity
  const text = [
    seg.summary             ? `Summary: ${seg.summary}`                          : null,
    seg.topics?.length      ? `Topics: ${seg.topics.join(", ")}`                 : null,
    seg.insights?.length    ? `Insights: ${seg.insights.join(". ")}`             : null,
    seg.action_items?.length ? `Action Items: ${seg.action_items.join(". ")}`    : null,
  ].filter(Boolean).join("\n");

  if (!text) {
    console.warn(`⚠️  Segment ${segmentId} has no embeddable content — skipping`);
    return;
  }

  console.log(`   📝 Embedding segment ${segmentId} (${text.length} chars) for ${mediaId}`);

  const vector = await embed(text);

  await insertVectorToCollection(
    SEGMENT_COLLECTION,
    `${mediaId}-seg-${segmentId}`,
    vector,
    {
      mediaId,
      userId,
      segmentId,
      type:    "segment",
      blockId: blockId ?? null,
      topics:  seg.topics  || [],
      summary: seg.summary || ""
    }
  );

  console.log(`✅ Embedded segment ${segmentId} for ${mediaId} (dim=${vector.length})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker — dispatches on job.data.type
// ─────────────────────────────────────────────────────────────────────────────
const worker = new Worker(
  "embedding",
  async (job) => {
    const { mediaId, blockId, segmentId, type = "block", userId } = job.data;

    await updatePipelineState(mediaId, { "steps.embedding.status": "running" });
    await publishPipelineEvent(mediaId, "embedding", "running");

    if (type === "segment") {
      await embedSegment(mediaId, segmentId, blockId, userId);
    } else {
      await embedBlock(mediaId, blockId, userId);
    }
  },
  { connection: redis }
);

worker.on("completed", async (job) => {
  console.log(`Embedding job ${job.id} completed`);
  // If no more embedding jobs for this session, mark embedding step completed
  const { mediaId } = job.data || {};
  if (mediaId) {
    await updatePipelineState(mediaId, { "steps.embedding.status": "completed" });
    await publishPipelineEvent(mediaId, "embedding", "completed");
  }
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Embedding job ${job?.id} failed:`, err.message);
  const { mediaId } = job?.data || {};
  if (mediaId) {
    await markSessionFailed(mediaId, "embedding", job.id, err);
  }
});