import { Worker } from "bullmq";
import redis from "../src/config/redis.js";
import SpeakerService from "../src/services/SpeakerService.js";
import EventService from "../src/services/EventService.js";
import connectDB from "../src/config/db.js";
import cleanerQueue from "../src/queues/cleanerQueue.js";
import { updatePipelineState, publishPipelineEvent, logJobAudit, markSessionFailed } from "../src/utils/workerObservability.js";

connectDB();
console.log("🎙️ Speaker Diarization Worker Started");

const worker = new Worker(
  "speaker-diarization",
  async (job) => {

    const { mediaId, transcript, userId } = job.data;

    console.log("Processing speaker segmentation:", mediaId);

    const structuredTranscript =
      await SpeakerService.process(mediaId, transcript);

    console.log("Structured transcript generated");

    await EventService.emit("SPEAKERS_READY", structuredTranscript);

    await updatePipelineState(mediaId, { "steps.diarization.status": "completed", "steps.grouping.status": "running" });
    await publishPipelineEvent(mediaId, "diarization", "completed");

    // Enqueue transcript cleaning job
    await cleanerQueue.add("clean", {
      mediaId,
      userId,
      segments: structuredTranscript.segments
    });

  },
  {
    connection: redis
  }
);

worker.on("completed", (job) => {
  console.log(`Diarization job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`Diarization job ${job?.id} failed`, err.message);
  const { mediaId } = job?.data || {};
  if (mediaId) {
    await markSessionFailed(mediaId, "diarization", job.id, err);
  }
});