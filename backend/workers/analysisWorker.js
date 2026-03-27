import { Worker, QueueEvents } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { llmQueue } from "../src/queues/llmQueue.js";
import EventService from "../src/services/EventService.js";
import redis from "../src/config/redis.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

connectDB();

console.log("🤖 Analysis Buffer Worker started");
console.log("   role       : sequential window dispatcher — one window at a time");
console.log("   concurrency: 1  (window-2 waits until window-1 LLM calls are done)");

// ─────────────────────────────────────────────────────────────────────────────
// ROLE: Sequential Window Dispatcher
//
// segmentGrouperWorker now writes ONE "analyze-batch" job per window to
// analysisQueue. Each batch carries all segments for that window.
//
// This worker (concurrency=1) picks one batch at a time, dispatches every
// segment inside it to llmQueue, then WAITS for each llmQueue job to complete
// (via QueueEvents / waitUntilFinished) before returning.
//
// Because concurrency=1 and we block until all LLM calls finish, the NEXT
// window's batch job cannot start until this one is fully done.
//
// ► No two windows ever dispatch to llmWorker simultaneously.
// ─────────────────────────────────────────────────────────────────────────────

// QueueEvents is required by BullMQ so we can call job.waitUntilFinished().
// It subscribes to Redis key-space notifications for the llm-calls queue.
const llmQueueEvents = new QueueEvents("llm-calls", { connection: redis });

const worker = new Worker(
    "analysisQueue",
    async (job) => {
        const { mediaId, userId, windowId, segments, totalSegments } = job.data;

        const label = windowId ?? mediaId;
        console.log(`\n📋 [Analysis] Batch received for: ${label} (${segments.length} segments)`);

        // ── Dispatch all segments to llmQueue in parallel ─────────────────────
        // We fire-and-forget each LLM job — the llmWorker handles:
        //   • per-segment progress updates
        //   • idempotency (skip if already done)
        //   • block aggregation trigger (every 8 segments)
        //   • final aggregation safety-net (when all segments complete)
        //
        // We do NOT waitUntilFinished here. That caused the batch job to hold
        // a BullMQ lock for hours during rate-limit backoffs, eventually hitting
        // the stall timeout and re-running the whole batch from scratch.
        const dispatched = await Promise.allSettled(
            segments.map(async (seg) => {
                const { segmentId, text } = seg;
                const jobId = `llm-${mediaId}-${segmentId}`;

                await llmQueue.add(
                    "segment-analysis",
                    {
                        mediaId,
                        userId,
                        windowId,
                        segmentId,
                        text,
                        totalSegments: segments.length
                    },
                    {
                        jobId,
                        removeOnComplete: true,
                        removeOnFail: { count: 50 }
                    }
                );

                return segmentId;
            })
        );

        const queued  = dispatched.filter(r => r.status === "fulfilled").length;
        const skipped = dispatched.filter(r => r.status === "rejected").length;

        console.log(
            `✅ [Analysis] Batch dispatched for ${label}: ${queued} queued, ${skipped} failed to enqueue`
        );

        return { mediaId, windowId, queued, skipped };
    },
    {
        connection: redis,
        concurrency:     4,        // non-blocking now — can handle multiple batches
        lockDuration:    120_000,  // 2 min max per batch dispatch
        maxStalledCount: 2         // fail after 2 stalls, not retry forever
    }
);

worker.on("completed", (job) => {
    console.log(`[Analysis] Batch job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
    console.error(`❌ [Analysis] Batch job ${job?.id} failed:`, err.message);
    const { mediaId, windowId } = job?.data || {};
    if (mediaId && !windowId) {
        await markSessionFailed(mediaId, "analysis", job.id, err);
    }
});