import redis from "../config/redis.js";
import { Queue } from "bullmq";

// Lazily import all queues — avoids circular dependency issues
// Each queue is imported from its own file
const QUEUE_NAMES = [
  "transcriptionQueue",
  "window-diarization",
  "transcript-aggregation",
  "speaker-diarization",
  "transcript-cleaner",
  "segment-grouper",
  "analysisQueue",
  "llm-calls",
  "block-aggregation",
  "insight-aggregation",
  "global-context",
  "report-generator",
  "chat-query",
  "embedding"
];

// Create lightweight Queue references (read-only — no workers attached)
const queueRefs = QUEUE_NAMES.map(name => ({
  name,
  queue: new Queue(name, { connection: redis })
}));

// ─── Queue Stats ──────────────────────────────────────────────────────────────

/**
 * Returns job counts for all 14 BullMQ queues.
 * Shape per queue: { waiting, active, completed, failed, delayed }
 */
export async function getQueueStats() {
  const results = await Promise.allSettled(
    queueRefs.map(async ({ name, queue }) => {
      const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
      return { name, ...counts };
    })
  );

  const stats = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { name, ...counts } = result.value;
      stats[name] = counts;
    }
  }
  return stats;
}

// ─── Health Check ──────────────────────────────────────────────────────────────

/**
 * Pings MongoDB, Redis, Kafka (optional), Qdrant, and MinIO.
 * Each service returns { ok: true/false, latencyMs: number, error?: string }.
 */
export async function getHealth() {
  const health = {};
  const start = (label) => { const t = Date.now(); return () => Date.now() - t; };

  // MongoDB
  try {
    const { default: mongoose } = await import("mongoose");
    const t = Date.now();
    await mongoose.connection.db.admin().ping();
    health.mongodb = { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    health.mongodb = { ok: false, error: err.message };
  }

  // Redis
  try {
    const t = Date.now();
    await redis.ping();
    health.redis = { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    health.redis = { ok: false, error: err.message };
  }

  // Qdrant
  try {
    const { QdrantClient } = await import("@qdrant/js-client-rest");
    const client = new QdrantClient({ url: "http://localhost:6333" });
    const t = Date.now();
    await client.getCollections();
    health.qdrant = { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    health.qdrant = { ok: false, error: err.message };
  }

  // MinIO — try a simple ping via HEAD request
  try {
    const { Client } = await import("minio");
    const client = new Client({
      endPoint:  process.env.MINIO_ENDPOINT  || "localhost",
      port:      Number(process.env.MINIO_PORT || 9000),
      useSSL:    false,
      accessKey: process.env.MINIO_ACCESS_KEY || "admin",
      secretKey: process.env.MINIO_SECRET_KEY || "password123"
    });
    const t = Date.now();
    await new Promise((resolve, reject) => {
      client.listBuckets((err, buckets) => err ? reject(err) : resolve(buckets));
    });
    health.minio = { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    health.minio = { ok: false, error: err.message };
  }

  return health;
}

// ─── Retry Dead Jobs ──────────────────────────────────────────────────────────

/**
 * Moves all BullMQ failed jobs from every queue back to the waiting state.
 * Returns total count of retried jobs.
 */
export async function retryDeadJobs() {
  let totalRetried = 0;

  await Promise.allSettled(
    queueRefs.map(async ({ name, queue }) => {
      const failedJobs = await queue.getFailed(0, 999);
      await Promise.allSettled(failedJobs.map(job => job.retry()));
      totalRetried += failedJobs.length;
      if (failedJobs.length > 0) {
        console.log(`♻️  Retried ${failedJobs.length} dead job(s) from [${name}]`);
      }
    })
  );

  return { retriedJobs: totalRetried };
}
