import { Worker } from "bullmq";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { llmQueue } from "../src/queues/llmQueue.js";
import EventService from "../src/services/EventService.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

console.log("🤖 Analysis Dispatcher Worker started");
console.log("   role       : bridge analysisQueue → llm-calls");
console.log("   concurrency: 5");

// ─────────────────────────────────────────────────────────────────────────────
// This worker is intentionally lightweight — it receives segment jobs and
// forwards them to the llm-calls queue where rate limiting and provider
// routing are enforced by llmWorker.
// ─────────────────────────────────────────────────────────────────────────────

const worker = new Worker(
    "analysisQueue",
    async (job) => {
        const { mediaId, segmentId, text, totalSegments } = job.data;

        console.log(`📋 Dispatching segment ${segmentId}/${totalSegments - 1} for ${mediaId} → llm-calls`);

        await llmQueue.add(
            "segment-analysis",
            { mediaId, segmentId, text, totalSegments },
            {
                // Deduplicate: if the same segment is re-dispatched (e.g. on retry),
                // BullMQ will reuse the existing queued job rather than add a duplicate.
                jobId: `llm-${mediaId}-${segmentId}`
            }
        );

        console.log(`✅ Segment ${segmentId} queued to llm-calls`);

        await EventService.emit("SEGMENT_DISPATCHED", {
            mediaId,
            segmentId,
            totalSegments
        });
    },
    {
        connection: { host: "127.0.0.1", port: 6379 },
        // High concurrency here is fine — these jobs do nothing but add to a queue
        concurrency: 5
    }
);

worker.on("completed", (job) => {
    console.log(`Dispatch job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
    console.error(`Dispatch job ${job?.id} failed:`, err.message);
});