import { Queue } from "bullmq";
import redis from "./src/config/redis.js";

const queues = [
  "analysisQueue",
  "llm-calls",
  "block-aggregation",
  "insight-aggregation",
  "transcriptionQueue",
  "transcript-aggregation",
  "speaker-diarization",
  "transcript-cleaner",
  "segment-grouper",
  "global-context"
];

async function clearQueues() {
  try {
    for (const name of queues) {
      const queue = new Queue(name, { connection: redis });
      await queue.drain();
      await queue.clean(0, "failed");
      await queue.clean(0, "waiting");
      console.log(`✅ Cleared ${name}`);
    }
    console.log("All queues cleared successfully!");
  } catch (err) {
    console.error("Error clearing queues:", err.message);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

clearQueues();
