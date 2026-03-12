import { Worker } from "bullmq";
import TranscriptCleaner from "../src/services/TranscriptCleaner.js";
import EventService from "../src/services/EventService.js";
import grouperQueue from "../src/queues/grouperQueue.js";

console.log("🧹 Transcript Cleaner Worker Started");

const worker = new Worker(
  "transcript-cleaner",
  async (job) => {

    const { mediaId, segments } = job.data;

    console.log("Cleaning transcript:", mediaId);

    const cleanedSegments = TranscriptCleaner.cleanSegments(segments);

    console.log(`Cleaned ${cleanedSegments.length} segments`);

    await EventService.emit("CLEAN_TRANSCRIPT_READY", {
      mediaId,
      segments: cleanedSegments
    });

    // Enqueue grouping job
    await grouperQueue.add("group", {
      mediaId,
      segments: cleanedSegments
    });

  },
  {
    connection: {
      host: "127.0.0.1",
      port: 6379
    }
  }
);

worker.on("completed", (job) => {
  console.log(`Cleaner job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Cleaner job ${job?.id} failed`, err.message);
});