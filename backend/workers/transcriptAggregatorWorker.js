import { Worker } from "bullmq";
import TranscriptService from "../src/services/TranscriptService.js";
import EventService from "../src/services/EventService.js";
import diarizationQueue from "../src/queues/diarizationQueue.js";
import globalContextQueue from "../src/queues/globalContextQueue.js";


console.log("📦 Transcript Aggregator Started");

const worker = new Worker(
    "transcript-aggregation",
    async (job) => {

        const { mediaId, userId } = job.data;

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

    },
    {
        connection: {
            host: "127.0.0.1",
            port: 6379
        }
    }
);

worker.on("completed", job => {
    console.log(`Aggregation job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
    console.error(`Aggregation job ${job.id} failed`, err);
});
