import { Worker, QueueEvents } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { llmQueue } from "../src/queues/llmQueue.js";
import EventService from "../src/services/EventService.js";
import redis from "../src/config/redis.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

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
        console.log(`\n📋 [Analysis] Batch received for: ${label}`);
        console.log(`   Segments in batch: ${segments.length}`);

        // ── Dispatch every segment to llmQueue and wait for each one ──────────
        // We wait for each LLM job *individually* so that the overall batch job
        // doesn't complete until the last LLM call is done.  This is what makes
        // the next window wait.
        for (const seg of segments) {
            const { segmentId, text } = seg;

            const jobId = `llm-${mediaId}-${segmentId}`;

            console.log(
                `  ⏩ Dispatching segment ${segmentId} → llm-calls [jobId=${jobId}]`
            );

            const llmJob = await llmQueue.add(
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
                    // Inherit retry / backoff settings already set on llmQueue defaults.
                    removeOnComplete: true,
                    removeOnFail: { count: 50 }
                }
            );

            // ── Wait for the LLM job to finish ────────────────────────────────
            // waitUntilFinished resolves with the return value of llmWorker,
            // or throws if the job fails all retries.
            //
            // Edge-case guard: if llmQueue.add() returned an EXISTING job that
            // is already complete (BullMQ deduplication), waitUntilFinished would
            // throw "Missing lock" / "Job not found".  We detect this by checking
            // the job state before waiting.
            try {
                const state = await llmJob.getState();
                if (state === "completed" || state === "failed") {
                    console.log(`  ⏭️  Segment ${segmentId} already ${state} — skipping wait`);
                } else {
                    await llmJob.waitUntilFinished(llmQueueEvents, 300_000); // 5 min max
                    console.log(`  ✅ Segment ${segmentId} LLM done`);
                }
            } catch (llmErr) {
                console.error(
                    `  ❌ Segment ${segmentId} LLM failed (will continue batch): ${llmErr.message}`
                );
            }

            await EventService.emit("SEGMENT_DISPATCHED", {
                mediaId,
                windowId,
                segmentId,
                totalSegments: segments.length
            });
        }

        console.log(
            `✅ [Analysis] Batch complete for ${label} — all ${segments.length} segments dispatched & finished`
        );
    },
    {
        connection: redis,

        // concurrency=1 is the heart of this change.
        // Only one batch job runs at a time across the entire worker process,
        // so window-2 stays in the analysisQueue (waiting) until window-1's
        // batch job handler returns — which only happens after all LLM calls finish.
        concurrency: 1
    }
);

worker.on("completed", (job) => {
    console.log(`[Analysis] Batch job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
    console.error(`❌ [Analysis] Batch job ${job?.id} failed:`, err.message);
});