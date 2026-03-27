import { Worker } from "bullmq";
import redis from "../src/config/redis.js";
import TranscriptService from "../src/services/TranscriptService.js";
import EventService from "../src/services/EventService.js";
import diarizationQueue from "../src/queues/diarizationQueue.js";
import globalContextQueue from "../src/queues/globalContextQueue.js";
import connectDB from "../src/config/db.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

connectDB();
console.log("📦 Transcript Aggregator Started");

const worker = new Worker(
    "transcript-aggregation",
    async (job) => {

        const { mediaId, userId } = job.data;

        await updatePipelineState(mediaId, { "steps.transcription.status": "completed" });
        await publishPipelineEvent(mediaId, "transcription", "completed");
        console.log("Aggregating transcript for:", mediaId);

        const transcript = await TranscriptService.merge(mediaId);

        console.log("Final transcript generated");
   
        // Emit event for frontend and other services
        await EventService.emit("TRANSCRIPT_READY", {
            mediaId,
            transcript
        });

        // Enqueue diarization job (existing pipeline)
        await diarizationQueue.add("diarize", {
            mediaId,
            userId,
            transcript
        });

        // Enqueue global context job (parallel pipeline)
        // jobId prevents duplicate jobs if the aggregator retries
        await globalContextQueue.add(
            "generate-global-context",
            { mediaId, userId, transcript },
            {
                jobId: `context-${mediaId}`,
                attempts: 1,
                removeOnComplete: true
            }
        );

        console.log(`Enqueued diarization + global context jobs for ${mediaId}`);
        await updatePipelineState(mediaId, { "steps.diarization.status": "running" }, "diarizing");
        await publishPipelineEvent(mediaId, "diarization", "running");
    },
    {
        connection: redis
    }
);

worker.on("completed", job => {
    console.log(`Aggregation job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
    console.error(`Aggregation job ${job.id} failed`, err);
    const { mediaId } = job?.data || {};
    if (mediaId) {
        await markSessionFailed(mediaId, "transcription", job.id, err);
    }
});
