import { Worker } from "bullmq";
import SpeakerService from "../src/services/SpeakerService.js";
import EventService from "../src/services/EventService.js";
import connectDB from "../src/config/db.js";
import cleanerQueue from "../src/queues/cleanerQueue.js";

// Connect to MongoDB
connectDB();

console.log("🎙️ Speaker Diarization Worker Started");

const worker = new Worker(
  "speaker-diarization",
  async (job) => {

    const { mediaId, transcript } = job.data;

    console.log("Processing speaker segmentation:", mediaId);

    const structuredTranscript =
      await SpeakerService.process(mediaId, transcript);

    console.log("Structured transcript generated");

    await EventService.emit("SPEAKERS_READY", structuredTranscript);

    // Enqueue transcript cleaning job
    await cleanerQueue.add("clean", {
      mediaId,
      segments: structuredTranscript.segments
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
  console.log(`Diarization job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Diarization job ${job?.id} failed`, err.message);
});